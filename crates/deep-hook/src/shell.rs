//! The shell reader behind deep-hook's guards: what a command line runs, read through quoting, wrappers,
//! nested shells, sequencing, subshells, substitutions and heredocs, without running any of it. A guard
//! matches what a call does, so `p''kill`, `env pkill` and `sh -c 'pkill'` all read as one run of pkill,
//! while `rg 'pkill'`, a commit message or a heredoc written to a file read as an argument or as data.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// How deep shells, substitutions and evals nest before the reader reads no further in.
const DEPTH: usize = 12;

/// The programs that look processes up by name or port: a kill fed from one of them kills by name.
const LOOKUPS: &[&str] = &["pgrep", "pidof", "lsof", "fuser", "ps", "pstree"];

/// One program a command line runs.
#[derive(Debug, Clone, Default)]
pub struct Run {
    /// The program's name, the last part of its path, lowercased, since macOS finds `PKILL` as pkill. Empty
    /// when the line computes it, as with `$(…)` or a variable the line doesn't set.
    pub program: String,
    /// Whether `program` is a pattern the shell expands, such as `pk?ll`.
    pub glob: bool,
    pub args: Vec<Arg>,
    /// The environment the line gives it: prefix assignments, `export`s and `env`'s.
    pub env: Vec<(String, String)>,
    /// The folder it runs in, when the line says; None when it can't be known.
    pub cwd: Option<PathBuf>,
    /// The files its redirections write.
    pub writes: Vec<PathBuf>,
    /// Whether what it reads on stdin, or one of its arguments, comes from a lookup by name or port.
    pub looked_up: bool,
}

#[derive(Debug, Clone)]
pub struct Arg {
    /// The word after quote removal; None when it holds a value the line can't know.
    pub text: Option<String>,
    pub looked_up: bool,
}

impl Run {
    /// Whether the run is `name`, or a pattern that expands to it.
    pub fn is(&self, name: &str) -> bool {
        if self.glob {
            glob(self.program.as_bytes(), name.as_bytes())
        } else {
            self.program == name
        }
    }

    /// Its arguments' texts, an unknown one as an empty string.
    pub fn words(&self) -> Vec<&str> {
        self.args
            .iter()
            .map(|a| a.text.as_deref().unwrap_or(""))
            .collect()
    }

    fn looks_up(&self) -> bool {
        self.looked_up || LOOKUPS.iter().any(|name| self.is(name))
    }
}

/// What `line` runs, read in the folder `cwd` with the home folder `home`.
pub fn runs(line: &str, cwd: Option<&Path>, home: &Path) -> Vec<Run> {
    if cfg!(feature = "plant-issue-spellings") {
        return spelled(line, cwd);
    }
    let mut reader = Reader { runs: Vec::new() };
    let mut ctx = Ctx {
        cwd: cwd.map(Path::to_path_buf),
        home: home.to_path_buf(),
        vars: HashMap::new(),
        exported: Vec::new(),
        stdin: Stdin::default(),
        depth: 0,
        links: Vec::new(),
    };
    reader.script(line, &mut ctx);
    reader.runs
}

/// The planted twin for #316's AC9: a reader that knows only the issue's own spellings. It reads the line as one
/// command split on spaces, takes quotes and backslashes off its first word and its path off, and steps over at
/// most one wrapper; it follows no nested shell, sequence, subshell or pipe.
fn spelled(line: &str, cwd: Option<&Path>) -> Vec<Run> {
    let mut words: Vec<String> = line.split_whitespace().map(str::to_string).collect();
    let name = |w: &str| {
        let bare: String = w
            .chars()
            .filter(|c| !matches!(c, '\'' | '"' | '\\'))
            .collect();
        bare.rsplit('/').next().unwrap_or("").to_lowercase()
    };
    match words.first().map(|w| name(w)).as_deref() {
        Some("env" | "command" | "exec" | "nohup" | "sudo" | "xargs") => {
            words.remove(0);
        }
        Some("timeout") => {
            words.drain(..2.min(words.len()));
        }
        _ => {}
    }
    let Some(first) = words.first() else {
        return Vec::new();
    };
    vec![Run {
        program: name(first),
        args: words[1..]
            .iter()
            .map(|w| Arg {
                text: Some(w.clone()),
                looked_up: false,
            })
            .collect(),
        cwd: cwd.map(Path::to_path_buf),
        ..Run::default()
    }]
}

/// Whether `text` matches the shell pattern `pattern` whole: `*` any run, `?` one character, `[…]` a class.
pub fn glob(pattern: &[u8], text: &[u8]) -> bool {
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        if p < pattern.len() && pattern[p] == b'*' {
            star = Some((p, t));
            p += 1;
            continue;
        }
        if p < pattern.len() {
            if let Some((hit, next)) = one(pattern, p, text[t]) {
                if hit {
                    p = next;
                    t += 1;
                    continue;
                }
            }
        }
        match star {
            Some((sp, st)) => {
                p = sp + 1;
                t = st + 1;
                star = Some((sp, st + 1));
            }
            None => return false,
        }
    }
    pattern[p..].iter().all(|&c| c == b'*')
}

/// Whether the pattern item at `p` matches `c`, and where the next item starts.
fn one(pattern: &[u8], p: usize, c: u8) -> Option<(bool, usize)> {
    match pattern[p] {
        b'?' => Some((true, p + 1)),
        b'[' => {
            let mut i = p + 1;
            let negate = matches!(pattern.get(i), Some(b'!' | b'^'));
            if negate {
                i += 1;
            }
            let mut hit = false;
            let first = i;
            while i < pattern.len() && (pattern[i] != b']' || i == first) {
                if i + 2 < pattern.len() && pattern[i + 1] == b'-' && pattern[i + 2] != b']' {
                    hit |= pattern[i] <= c && c <= pattern[i + 2];
                    i += 3;
                } else {
                    hit |= pattern[i] == c;
                    i += 1;
                }
            }
            if i >= pattern.len() {
                return Some((pattern[p] == c, p + 1));
            }
            Some((hit != negate, i + 1))
        }
        b'\\' if p + 1 < pattern.len() => Some((pattern[p + 1] == c, p + 2)),
        other => Some((other == c, p + 1)),
    }
}

/// `path` with `..` and every link it passes through resolved, as far as the path exists, and lexically past
/// that: the file a write to it would change.
pub fn real(path: &Path) -> PathBuf {
    let mut done = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => done.push("/"),
            Component::CurDir | Component::Prefix(_) => {}
            Component::ParentDir => {
                done = fs::canonicalize(&done).unwrap_or(done);
                done.pop();
            }
            Component::Normal(name) => {
                done.push(name);
                if let Ok(resolved) = fs::canonicalize(&done) {
                    done = resolved;
                } else if let Ok(target) = fs::read_link(&done) {
                    // A link to a file that doesn't exist yet: the write makes its target.
                    let parent = done.parent().map(Path::to_path_buf).unwrap_or_default();
                    done = real(&parent.join(target));
                }
            }
        }
    }
    done
}

/// `path` with `.` and `..` taken lexically, links left as they are: the path as written.
pub fn lexical(path: &Path) -> PathBuf {
    let mut done = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                done.pop();
            }
            Component::CurDir => {}
            other => done.push(other),
        }
    }
    done
}

// ---- Tokens.

#[derive(Debug, Clone)]
enum Part {
    /// Text, and whether it was quoted: quoted text is never a pattern, a keyword or an assignment's name.
    Lit(String, bool),
    Tilde,
    Var(String, Option<Vec<Part>>),
    /// A command substitution or a process substitution: it runs.
    Sub(Vec<Tok>),
    Unknown,
}

#[derive(Debug, Clone)]
enum Tok {
    Word(Vec<Part>),
    Op(&'static str),
    Redir {
        op: &'static str,
        target: Vec<Part>,
        body: Option<Body>,
    },
}

/// A heredoc's text, and the substitutions in it that run, which only an unquoted delimiter allows.
#[derive(Debug, Clone)]
struct Body {
    text: String,
    subs: Vec<Vec<Tok>>,
}

struct Lexer {
    s: Vec<char>,
    i: usize,
}

const SEPARATORS: &[&str] = &[";", "\n", "&"];

impl Lexer {
    fn new(text: &str) -> Lexer {
        Lexer {
            s: text.chars().collect(),
            i: 0,
        }
    }

    fn peek(&self, k: usize) -> Option<char> {
        self.s.get(self.i + k).copied()
    }

    fn starts(&self, text: &str) -> bool {
        text.chars()
            .enumerate()
            .all(|(k, c)| self.peek(k) == Some(c))
    }

    fn op(&mut self, options: &[&'static str]) -> &'static str {
        let op = options
            .iter()
            .copied()
            .find(|op| self.starts(op))
            .unwrap_or(options[options.len() - 1]);
        self.i += op.chars().count();
        op
    }

    fn ends_word(c: char) -> bool {
        matches!(
            c,
            ' ' | '\t' | '\r' | '\n' | ';' | '&' | '|' | '(' | ')' | '<' | '>'
        )
    }

    /// Tokens to the end of the text or, `inside` a `$(`, to its closing parenthesis.
    fn tokens(&mut self, inside: bool) -> Vec<Tok> {
        let mut out = Vec::new();
        let mut pending: Vec<usize> = Vec::new();
        let mut level = 0usize;
        while let Some(c) = self.peek(0) {
            match c {
                ' ' | '\t' | '\r' => self.i += 1,
                '\\' if self.peek(1) == Some('\n') => self.i += 2,
                '\n' => {
                    self.i += 1;
                    out.push(Tok::Op("\n"));
                    for at in std::mem::take(&mut pending) {
                        self.heredoc(&mut out[at]);
                    }
                }
                '#' => {
                    while self.peek(0).is_some_and(|c| c != '\n') {
                        self.i += 1;
                    }
                }
                ';' => out.push(Tok::Op(self.op(&[";;&", ";;", ";&", ";"]))),
                '&' if self.peek(1) == Some('>') => self.redirect(&mut out, &mut pending),
                '&' => out.push(Tok::Op(self.op(&["&&", "&"]))),
                '|' => out.push(Tok::Op(self.op(&["||", "|&", "|"]))),
                '(' => {
                    level += 1;
                    self.i += 1;
                    out.push(Tok::Op("("));
                }
                ')' => {
                    self.i += 1;
                    if inside && level == 0 {
                        return out;
                    }
                    level = level.saturating_sub(1);
                    out.push(Tok::Op(")"));
                }
                '<' | '>' if self.peek(1) == Some('(') => {
                    let word = self.word();
                    out.push(Tok::Word(word));
                }
                '<' | '>' => self.redirect(&mut out, &mut pending),
                c if c.is_ascii_digit() && self.fd_redirect() => {
                    self.redirect(&mut out, &mut pending)
                }
                _ => {
                    let word = self.word();
                    out.push(Tok::Word(word));
                }
            }
        }
        out
    }

    /// Whether digits here run straight into a redirection, as in `2>`.
    fn fd_redirect(&self) -> bool {
        let mut k = 0;
        while self.peek(k).is_some_and(|c| c.is_ascii_digit()) {
            k += 1;
        }
        matches!(self.peek(k), Some('<' | '>'))
    }

    fn redirect(&mut self, out: &mut Vec<Tok>, pending: &mut Vec<usize>) {
        while self.peek(0).is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
        }
        let op = self.op(&[
            "<<<", "<<-", "<<", "<>", "<&", "<", "&>>", "&>", ">>", ">&", ">|", ">",
        ]);
        while matches!(self.peek(0), Some(' ' | '\t')) {
            self.i += 1;
        }
        let target = match self.peek(0) {
            Some(c)
                if !Self::ends_word(c) || (matches!(c, '<' | '>') && self.peek(1) == Some('(')) =>
            {
                self.word()
            }
            _ => Vec::new(),
        };
        out.push(Tok::Redir {
            op,
            target,
            body: None,
        });
        if op == "<<" || op == "<<-" {
            pending.push(out.len() - 1);
        }
    }

    /// Reads a heredoc's lines, after the newline that ends its command, up to its delimiter.
    fn heredoc(&mut self, tok: &mut Tok) {
        let Tok::Redir { op, target, body } = tok else {
            return;
        };
        let quoted = target.iter().any(|p| matches!(p, Part::Lit(_, true)));
        let delim: String = target
            .iter()
            .map(|p| match p {
                Part::Lit(s, _) => s.as_str(),
                _ => "",
            })
            .collect();
        let mut text = String::new();
        while self.i < self.s.len() {
            let start = self.i;
            while self.peek(0).is_some_and(|c| c != '\n') {
                self.i += 1;
            }
            let line: String = self.s[start..self.i].iter().collect();
            if self.peek(0) == Some('\n') {
                self.i += 1;
            }
            let compared = if *op == "<<-" {
                line.trim_start_matches('\t')
            } else {
                line.as_str()
            };
            if compared == delim {
                break;
            }
            text.push_str(&line);
            text.push('\n');
        }
        let subs = if quoted {
            Vec::new()
        } else {
            Lexer::new(&text).substitutions()
        };
        *body = Some(Body { text, subs });
    }

    /// The substitutions in an unquoted heredoc's text, which run when the heredoc is read.
    fn substitutions(&mut self) -> Vec<Vec<Tok>> {
        let mut subs = Vec::new();
        while let Some(c) = self.peek(0) {
            match c {
                '\\' => self.i += 2,
                '$' if self.peek(1) == Some('(') && self.peek(2) != Some('(') => {
                    self.i += 2;
                    subs.push(self.tokens(true));
                }
                '`' => subs.push(self.backtick()),
                _ => self.i += 1,
            }
        }
        subs
    }

    fn word(&mut self) -> Vec<Part> {
        let mut parts = Vec::new();
        let start = self.i;
        while let Some(c) = self.peek(0) {
            match c {
                '<' | '>' if self.peek(1) == Some('(') => {
                    self.i += 2;
                    parts.push(Part::Sub(self.tokens(true)));
                }
                c if Self::ends_word(c) => break,
                '\\' => {
                    match self.peek(1) {
                        Some('\n') => {}
                        Some(next) => parts.push(Part::Lit(next.to_string(), true)),
                        None => {}
                    }
                    self.i += 2;
                }
                '\'' => {
                    self.i += 1;
                    let text = self.until('\'');
                    parts.push(Part::Lit(text, true));
                }
                '"' => {
                    self.i += 1;
                    self.dquote(&mut parts);
                }
                '$' => self.dollar(&mut parts, false),
                '`' => {
                    let sub = self.backtick();
                    parts.push(Part::Sub(sub));
                }
                '~' if self.i == start
                    && self.peek(1).is_none_or(|n| n == '/' || Self::ends_word(n)) =>
                {
                    self.i += 1;
                    parts.push(Part::Tilde);
                }
                _ => {
                    parts.push(Part::Lit(c.to_string(), false));
                    self.i += 1;
                }
            }
        }
        parts
    }

    fn until(&mut self, end: char) -> String {
        let mut text = String::new();
        while let Some(c) = self.peek(0) {
            self.i += 1;
            if c == end {
                break;
            }
            text.push(c);
        }
        text
    }

    fn dquote(&mut self, parts: &mut Vec<Part>) {
        parts.push(Part::Lit(String::new(), true));
        while let Some(c) = self.peek(0) {
            match c {
                '"' => {
                    self.i += 1;
                    return;
                }
                '\\' => match self.peek(1) {
                    Some('\n') => self.i += 2,
                    Some(n @ ('$' | '`' | '"' | '\\')) => {
                        parts.push(Part::Lit(n.to_string(), true));
                        self.i += 2;
                    }
                    _ => {
                        parts.push(Part::Lit("\\".into(), true));
                        self.i += 1;
                    }
                },
                '$' => self.dollar(parts, true),
                '`' => {
                    let sub = self.backtick();
                    parts.push(Part::Sub(sub));
                }
                _ => {
                    parts.push(Part::Lit(c.to_string(), true));
                    self.i += 1;
                }
            }
        }
    }

    fn dollar(&mut self, parts: &mut Vec<Part>, quoted: bool) {
        self.i += 1;
        match self.peek(0) {
            Some('(') if self.peek(1) == Some('(') => {
                self.i += 2;
                let mut level = 2;
                while let Some(c) = self.peek(0) {
                    self.i += 1;
                    match c {
                        '(' => level += 1,
                        ')' => {
                            level -= 1;
                            if level == 0 {
                                break;
                            }
                        }
                        _ => {}
                    }
                }
                parts.push(Part::Unknown);
            }
            Some('(') => {
                self.i += 1;
                let sub = self.tokens(true);
                parts.push(Part::Sub(sub));
            }
            Some('{') => {
                self.i += 1;
                self.brace(parts);
            }
            Some('\'') if !quoted => {
                self.i += 1;
                let text = self.ansi();
                parts.push(Part::Lit(text, true));
            }
            Some('"') if !quoted => {
                self.i += 1;
                self.dquote(parts);
            }
            Some(c) if c == '_' || c.is_ascii_alphabetic() => {
                let mut name = String::new();
                while let Some(c) = self
                    .peek(0)
                    .filter(|c| *c == '_' || c.is_ascii_alphanumeric())
                {
                    name.push(c);
                    self.i += 1;
                }
                parts.push(Part::Var(name, None));
            }
            Some(c) if c.is_ascii_digit() || "@*#?$!-".contains(c) => {
                self.i += 1;
                parts.push(Part::Unknown);
            }
            _ => parts.push(Part::Lit("$".into(), quoted)),
        }
    }

    /// `${…}`: a variable, with its default when it has one; any other expansion is unknown.
    fn brace(&mut self, parts: &mut Vec<Part>) {
        let mut name = String::new();
        while let Some(c) = self
            .peek(0)
            .filter(|c| *c == '_' || c.is_ascii_alphanumeric())
        {
            name.push(c);
            self.i += 1;
        }
        if name.is_empty()
            || self.peek(0) != Some('}')
                && !self.starts(":-")
                && !self.starts("-")
                && !self.starts(":=")
                && !self.starts("=")
        {
            self.skip_brace();
            parts.push(Part::Unknown);
            return;
        }
        if self.peek(0) == Some('}') {
            self.i += 1;
            parts.push(Part::Var(name, None));
            return;
        }
        self.op(&[":-", ":=", "-", "="]);
        let mut default = Vec::new();
        while let Some(c) = self.peek(0) {
            match c {
                '}' => {
                    self.i += 1;
                    break;
                }
                '\\' => {
                    if let Some(n) = self.peek(1) {
                        default.push(Part::Lit(n.to_string(), true));
                    }
                    self.i += 2;
                }
                '\'' => {
                    self.i += 1;
                    let text = self.until('\'');
                    default.push(Part::Lit(text, true));
                }
                '"' => {
                    self.i += 1;
                    self.dquote(&mut default);
                }
                '$' => self.dollar(&mut default, false),
                '`' => {
                    let sub = self.backtick();
                    default.push(Part::Sub(sub));
                }
                _ => {
                    default.push(Part::Lit(c.to_string(), false));
                    self.i += 1;
                }
            }
        }
        parts.push(Part::Var(name, Some(default)));
    }

    fn skip_brace(&mut self) {
        let mut level = 1;
        while let Some(c) = self.peek(0) {
            self.i += 1;
            match c {
                '\\' => self.i += 1,
                '\'' => {
                    self.until('\'');
                }
                '{' => level += 1,
                '}' => {
                    level -= 1;
                    if level == 0 {
                        return;
                    }
                }
                _ => {}
            }
        }
    }

    /// `$'…'`, its escapes decoded.
    fn ansi(&mut self) -> String {
        let mut text = String::new();
        while let Some(c) = self.peek(0) {
            self.i += 1;
            match c {
                '\'' => break,
                '\\' => {
                    let Some(e) = self.peek(0) else { break };
                    self.i += 1;
                    let radix = |me: &mut Lexer, radix: u32, most: usize| {
                        let mut value = 0u32;
                        let mut n = 0;
                        while n < most {
                            match me.peek(0).and_then(|c| c.to_digit(radix)) {
                                Some(d) => {
                                    value = value * radix + d;
                                    me.i += 1;
                                    n += 1;
                                }
                                None => break,
                            }
                        }
                        char::from_u32(value).unwrap_or('\u{FFFD}')
                    };
                    match e {
                        'n' => text.push('\n'),
                        't' => text.push('\t'),
                        'r' => text.push('\r'),
                        'a' => text.push('\u{7}'),
                        'b' => text.push('\u{8}'),
                        'e' | 'E' => text.push('\u{1b}'),
                        'f' => text.push('\u{c}'),
                        'v' => text.push('\u{b}'),
                        'x' => text.push(radix(self, 16, 2)),
                        'u' => text.push(radix(self, 16, 4)),
                        'U' => text.push(radix(self, 16, 8)),
                        '0'..='7' => {
                            self.i -= 1;
                            text.push(radix(self, 8, 3));
                        }
                        'c' => {
                            if let Some(n) = self.peek(0) {
                                self.i += 1;
                                text.push(char::from_u32(n as u32 & 0x1f).unwrap_or('?'));
                            }
                        }
                        other => text.push(other),
                    }
                }
                _ => text.push(c),
            }
        }
        text
    }

    /// A backquoted command, its own backslashes taken off, as the tokens it runs.
    fn backtick(&mut self) -> Vec<Tok> {
        self.i += 1;
        let mut raw = String::new();
        while let Some(c) = self.peek(0) {
            self.i += 1;
            match c {
                '`' => break,
                '\\' if matches!(self.peek(0), Some('`' | '$' | '\\')) => {
                    raw.push(self.peek(0).unwrap_or('\\'));
                    self.i += 1;
                }
                _ => raw.push(c),
            }
        }
        Lexer::new(&raw).tokens(false)
    }
}

/// A word's text when it is plain, unquoted text with nothing to expand: how keywords are told apart.
fn plain(parts: &[Part]) -> Option<String> {
    let mut text = String::new();
    for part in parts {
        match part {
            Part::Lit(s, false) => text.push_str(s),
            _ => return None,
        }
    }
    Some(text)
}

/// A leading `NAME=value` word, as its name and its value's parts.
fn assignment(parts: &[Part]) -> Option<(String, Vec<Part>)> {
    let mut name = String::new();
    for (k, part) in parts.iter().enumerate() {
        match part {
            Part::Lit(s, false) if s == "=" && !name.is_empty() => {
                return Some((name, parts[k + 1..].to_vec()));
            }
            Part::Lit(s, false)
                if s.chars().all(|c| c == '_' || c.is_ascii_alphanumeric())
                    && !(name.is_empty() && s.starts_with(|c: char| c.is_ascii_digit())) =>
            {
                name.push_str(s)
            }
            _ => return None,
        }
    }
    None
}

// ---- What runs.

#[derive(Clone, Default)]
struct Stdin {
    looked_up: bool,
    /// What it reads, when the line says: a heredoc, a here-string or what `echo` prints into the pipe.
    script: Option<String>,
}

#[derive(Clone)]
struct Val {
    text: Option<String>,
    looked_up: bool,
    glob: bool,
}

#[derive(Clone)]
struct Ctx {
    cwd: Option<PathBuf>,
    home: PathBuf,
    vars: HashMap<String, Val>,
    exported: Vec<(String, String)>,
    stdin: Stdin,
    depth: usize,
    /// Links the line makes before it writes through them: `ln -s <target> <link>`.
    links: Vec<(PathBuf, PathBuf)>,
}

impl Ctx {
    fn path(&self, text: &str) -> Option<PathBuf> {
        let path = Path::new(text);
        let path = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.cwd.as_ref()?.join(path)
        };
        Some(
            self.links
                .iter()
                .rev()
                .find(|(link, _)| lexical(link) == lexical(&path))
                .map(|(_, target)| target.clone())
                .unwrap_or(path),
        )
    }
}

struct Cursor<'a> {
    toks: &'a [Tok],
    i: usize,
}

impl<'a> Cursor<'a> {
    fn peek(&self) -> Option<&'a Tok> {
        self.toks.get(self.i)
    }

    fn op_in(&self, ops: &[&str]) -> bool {
        matches!(self.peek(), Some(Tok::Op(op)) if ops.contains(op))
    }

    fn plain(&self) -> Option<String> {
        match self.peek() {
            Some(Tok::Word(parts)) => plain(parts),
            _ => None,
        }
    }

    fn eat(&mut self, keyword: &str) -> bool {
        let hit = self.plain().as_deref() == Some(keyword) || self.op_in(&[keyword]);
        if hit {
            self.i += 1;
        }
        hit
    }

    fn newlines(&mut self) {
        while self.op_in(&["\n"]) {
            self.i += 1;
        }
    }

    fn at_stop(&self, stops: &[&str]) -> bool {
        match self.peek() {
            Some(Tok::Op(op)) => stops.contains(op),
            Some(Tok::Word(parts)) => plain(parts).is_some_and(|w| stops.contains(&w.as_str())),
            _ => false,
        }
    }
}

const KEYWORDS: &[&str] = &[
    "then", "elif", "else", "fi", "do", "done", "esac", "}", "in", "]]",
];

struct Reader {
    runs: Vec<Run>,
}

impl Reader {
    fn script(&mut self, text: &str, ctx: &mut Ctx) {
        if ctx.depth > DEPTH {
            return;
        }
        let toks = Lexer::new(text).tokens(false);
        self.walk(&toks, ctx);
    }

    fn walk(&mut self, toks: &[Tok], ctx: &mut Ctx) {
        let mut cur = Cursor { toks, i: 0 };
        while cur.peek().is_some() {
            let at = cur.i;
            self.list(&mut cur, ctx, &[]);
            if cur.i == at {
                cur.i += 1;
            }
        }
    }

    fn list(&mut self, cur: &mut Cursor, ctx: &mut Ctx, stops: &[&str]) {
        loop {
            while cur.op_in(SEPARATORS) {
                cur.i += 1;
            }
            if cur.peek().is_none() || cur.at_stop(stops) {
                return;
            }
            let at = cur.i;
            self.and_or(cur, ctx, stops);
            if cur.i == at {
                cur.i += 1;
            }
        }
    }

    fn and_or(&mut self, cur: &mut Cursor, ctx: &mut Ctx, stops: &[&str]) {
        self.pipeline(cur, ctx, stops);
        while cur.op_in(&["&&", "||"]) {
            cur.i += 1;
            cur.newlines();
            self.pipeline(cur, ctx, stops);
        }
    }

    fn pipeline(&mut self, cur: &mut Cursor, ctx: &mut Ctx, stops: &[&str]) {
        while cur.eat("!") {}
        let mut stdin = ctx.stdin.clone();
        let mut stages = 0;
        loop {
            let mut stage = ctx.clone();
            stage.stdin = stdin.clone();
            let from = self.runs.len();
            let printed = self.command(cur, &mut stage, stops);
            stages += 1;
            if cur.op_in(&["|", "|&"]) {
                cur.i += 1;
                cur.newlines();
                stdin = Stdin {
                    looked_up: stdin.looked_up || self.runs[from..].iter().any(Run::looks_up),
                    script: printed,
                };
                continue;
            }
            // Only a command that is a pipeline of its own runs in this shell, so only its cd and variables last.
            if stages == 1 {
                stage.stdin = ctx.stdin.clone();
                *ctx = stage;
            }
            return;
        }
    }

    /// Reads one command, and returns what it prints when the line says.
    fn command(&mut self, cur: &mut Cursor, ctx: &mut Ctx, stops: &[&str]) -> Option<String> {
        let within = |own: &[&'static str]| -> Vec<&str> {
            let mut all: Vec<&str> = stops.to_vec();
            all.extend_from_slice(own);
            all
        };
        if cur.op_in(&["("]) {
            cur.i += 1;
            let mut sub = ctx.clone();
            self.list(cur, &mut sub, &within(&[")"]));
            cur.eat(")");
            self.after(cur, ctx);
            return None;
        }
        let word = cur.plain();
        match word.as_deref() {
            Some("{") => {
                cur.i += 1;
                self.list(cur, ctx, &within(&["}"]));
                cur.eat("}");
                self.after(cur, ctx);
            }
            Some("if") => {
                cur.i += 1;
                loop {
                    self.list(cur, ctx, &within(&["then", "elif", "else", "fi"]));
                    if cur.eat("fi") || !(cur.eat("then") || cur.eat("elif") || cur.eat("else")) {
                        break;
                    }
                }
                self.after(cur, ctx);
            }
            Some("while" | "until") => {
                cur.i += 1;
                self.list(cur, ctx, &within(&["do"]));
                cur.eat("do");
                self.list(cur, ctx, &within(&["done"]));
                cur.eat("done");
                self.after(cur, ctx);
            }
            Some("for" | "select") => {
                cur.i += 1;
                if cur.op_in(&["("]) {
                    while cur.peek().is_some() && cur.plain().as_deref() != Some("do") {
                        cur.i += 1;
                    }
                } else {
                    let name = cur.plain();
                    cur.i += 1;
                    cur.newlines();
                    let mut looked_up = false;
                    if cur.eat("in") {
                        while let Some(Tok::Word(parts)) = cur.peek() {
                            looked_up |= self.value(parts, ctx).looked_up;
                            cur.i += 1;
                        }
                    }
                    if let Some(name) = name {
                        ctx.vars.insert(
                            name,
                            Val {
                                text: None,
                                looked_up,
                                glob: false,
                            },
                        );
                    }
                }
                while cur.op_in(SEPARATORS) {
                    cur.i += 1;
                }
                cur.eat("do");
                self.list(cur, ctx, &within(&["done"]));
                cur.eat("done");
                self.after(cur, ctx);
            }
            Some("case") => {
                cur.i += 1;
                if let Some(Tok::Word(parts)) = cur.peek() {
                    self.value(parts, ctx);
                    cur.i += 1;
                }
                cur.newlines();
                cur.eat("in");
                loop {
                    cur.newlines();
                    if cur.peek().is_none() || cur.eat("esac") {
                        break;
                    }
                    cur.eat("(");
                    while cur.peek().is_some() && !cur.op_in(&[")"]) {
                        cur.i += 1;
                    }
                    cur.eat(")");
                    self.list(cur, ctx, &within(&[";;", ";&", ";;&", "esac"]));
                    let _ = cur.eat(";;") || cur.eat(";&") || cur.eat(";;&");
                }
                self.after(cur, ctx);
            }
            Some("function") => {
                cur.i += 2;
                if cur.op_in(&["("]) {
                    cur.i += 1;
                    cur.eat(")");
                }
                cur.newlines();
                return self.command(cur, ctx, stops);
            }
            Some("[[") => {
                cur.i += 1;
                while let Some(tok) = cur.peek() {
                    if let Tok::Word(parts) = tok {
                        if plain(parts).as_deref() == Some("]]") {
                            cur.i += 1;
                            break;
                        }
                        self.value(parts, ctx);
                    }
                    cur.i += 1;
                }
            }
            Some(k) if KEYWORDS.contains(&k) => cur.i += 1,
            // A function's body runs whenever the function is called, so it reads as run.
            Some(_)
                if matches!(cur.toks.get(cur.i + 1), Some(Tok::Op("(")))
                    && matches!(cur.toks.get(cur.i + 2), Some(Tok::Op(")"))) =>
            {
                cur.i += 3;
                cur.newlines();
                return self.command(cur, ctx, stops);
            }
            _ => return self.simple(cur, ctx),
        }
        None
    }

    /// The redirections after a compound command: its writes, and what its heredocs run.
    fn after(&mut self, cur: &mut Cursor, ctx: &mut Ctx) {
        let mut writes = Vec::new();
        while let Some(Tok::Redir { op, target, body }) = cur.peek() {
            self.redirection(
                op,
                target,
                body.as_ref(),
                ctx,
                &mut writes,
                &mut ctx.stdin.clone(),
            );
            cur.i += 1;
        }
        if !writes.is_empty() {
            self.runs.push(Run {
                cwd: ctx.cwd.clone(),
                writes,
                ..Run::default()
            });
        }
    }

    fn redirection(
        &mut self,
        op: &str,
        target: &[Part],
        body: Option<&Body>,
        ctx: &Ctx,
        writes: &mut Vec<PathBuf>,
        stdin: &mut Stdin,
    ) {
        let value = self.value(target, ctx);
        match op {
            ">" | ">>" | ">|" | "&>" | "&>>" | "<>" => {
                if let Some(path) = value.text.as_deref().and_then(|t| ctx.path(t)) {
                    writes.push(path);
                }
            }
            // `>&file` writes the file; `>&2` and `>&-` only move a descriptor.
            ">&" => match value.text.as_deref() {
                Some(t) if !t.is_empty() && t != "-" && !t.chars().all(|c| c.is_ascii_digit()) => {
                    if let Some(path) = ctx.path(t) {
                        writes.push(path);
                    }
                }
                _ => {}
            },
            "<" => *stdin = Stdin::default(),
            "<<" | "<<-" => {
                if let Some(body) = body {
                    for sub in &body.subs {
                        let mut inner = ctx.clone();
                        inner.depth += 1;
                        inner.stdin = Stdin::default();
                        self.walk(sub, &mut inner);
                    }
                    *stdin = Stdin {
                        looked_up: false,
                        script: Some(body.text.clone()),
                    };
                }
            }
            "<<<" => {
                *stdin = Stdin {
                    looked_up: value.looked_up,
                    script: value.text.map(|t| t + "\n"),
                }
            }
            _ => {}
        }
    }

    fn simple(&mut self, cur: &mut Cursor, ctx: &mut Ctx) -> Option<String> {
        let mut words: Vec<&Vec<Part>> = Vec::new();
        let mut redirs = Vec::new();
        while let Some(tok) = cur.peek() {
            match tok {
                Tok::Word(parts) => words.push(parts),
                Tok::Redir { op, target, body } => redirs.push((*op, target, body.as_ref())),
                Tok::Op(_) => break,
            }
            cur.i += 1;
        }
        let mut k = 0;
        let mut assigned = Vec::new();
        while let Some((name, parts)) = words.get(k).and_then(|w| assignment(w)) {
            assigned.push((name, self.value(&parts, ctx)));
            k += 1;
        }
        let argv: Vec<Val> = words[k..].iter().map(|w| self.value(w, ctx)).collect();
        let mut writes = Vec::new();
        let mut stdin = ctx.stdin.clone();
        for (op, target, body) in redirs {
            self.redirection(op, target, body, ctx, &mut writes, &mut stdin);
        }
        if argv.is_empty() {
            for (name, value) in assigned {
                ctx.vars.insert(name, value);
            }
            if !writes.is_empty() {
                self.runs.push(Run {
                    cwd: ctx.cwd.clone(),
                    writes,
                    ..Run::default()
                });
            }
            return None;
        }
        let mut env = ctx.exported.clone();
        env.extend(
            assigned
                .iter()
                .filter_map(|(name, value)| value.text.clone().map(|t| (name.clone(), t))),
        );
        let printed = printed(&argv, &stdin);
        self.resolve(argv.clone(), env, ctx, stdin, writes);
        self.builtin(&argv, ctx);
        printed
    }

    fn value(&mut self, parts: &[Part], ctx: &Ctx) -> Val {
        let mut text = String::new();
        let mut known = true;
        let mut looked_up = false;
        let mut glob = false;
        for part in parts {
            match part {
                Part::Lit(s, quoted) => {
                    glob |= !quoted && s.contains(['*', '?', '[']);
                    text.push_str(s);
                }
                Part::Tilde => text.push_str(&ctx.home.to_string_lossy()),
                Part::Var(name, default) => {
                    let set = match name.as_str() {
                        "HOME" if !ctx.vars.contains_key("HOME") => Some(Val {
                            text: Some(ctx.home.to_string_lossy().into_owned()),
                            looked_up: false,
                            glob: false,
                        }),
                        "PWD" => Some(Val {
                            text: ctx.cwd.as_ref().map(|c| c.to_string_lossy().into_owned()),
                            looked_up: false,
                            glob: false,
                        }),
                        _ => ctx.vars.get(name).cloned(),
                    };
                    let value = match (set, default) {
                        (Some(v), _) => v,
                        (None, Some(d)) => self.value(d, ctx),
                        (None, None) => Val {
                            text: None,
                            looked_up: false,
                            glob: false,
                        },
                    };
                    looked_up |= value.looked_up;
                    match value.text {
                        Some(t) => text.push_str(&t),
                        None => known = false,
                    }
                }
                Part::Sub(toks) => {
                    let from = self.runs.len();
                    let mut inner = ctx.clone();
                    inner.depth += 1;
                    inner.stdin = Stdin::default();
                    if inner.depth <= DEPTH {
                        self.walk(toks, &mut inner);
                    }
                    looked_up |= self.runs[from..].iter().any(Run::looks_up);
                    known = false;
                }
                Part::Unknown => known = false,
            }
        }
        Val {
            text: known.then_some(text),
            looked_up,
            glob,
        }
    }

    /// Reads the words of `text` as the shell would split them, as `env -S` does.
    fn split(&mut self, text: &str, ctx: &Ctx) -> Vec<Val> {
        Lexer::new(text)
            .tokens(false)
            .iter()
            .filter_map(|tok| match tok {
                Tok::Word(parts) => Some(self.value(parts, ctx)),
                _ => None,
            })
            .collect()
    }

    /// Runs `text` as a shell script started by this line, in `cwd` with `env`.
    fn shell(
        &mut self,
        text: &str,
        ctx: &Ctx,
        cwd: &Option<PathBuf>,
        env: &[(String, String)],
        stdin: Stdin,
    ) {
        let mut inner = ctx.clone();
        inner.depth += 1;
        inner.cwd = cwd.clone();
        inner.stdin = stdin;
        inner.exported = env.to_vec();
        for (name, value) in env {
            inner.vars.insert(
                name.clone(),
                Val {
                    text: Some(value.clone()),
                    looked_up: false,
                    glob: false,
                },
            );
        }
        self.script(text, &mut inner);
    }

    /// Follows wrappers (`env`, `sudo`, `xargs`, `sh -c` …) to what they run, and records each program.
    fn resolve(
        &mut self,
        mut argv: Vec<Val>,
        mut env: Vec<(String, String)>,
        ctx: &Ctx,
        stdin: Stdin,
        writes: Vec<PathBuf>,
    ) {
        let mut cwd = ctx.cwd.clone();
        let mut looked_up = stdin.looked_up;
        let mut i = 0;
        loop {
            let Some(first) = argv.get(i) else { return };
            let (name, glob) = program(first);
            let text = |k: usize| argv.get(i + 1 + k).and_then(|v| v.text.clone());
            let joined = |from: usize| {
                argv[(i + 1 + from).min(argv.len())..]
                    .iter()
                    .map(|v| v.text.clone().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            // Skips the options of a wrapper: `with` lists those that take a value.
            let options = |with: &[&str]| {
                let mut k = 0;
                while let Some(a) = text(k) {
                    if a == "--" {
                        return k + 1;
                    }
                    if !a.starts_with('-') || a == "-" {
                        break;
                    }
                    k += if with.contains(&a.as_str()) { 2 } else { 1 };
                }
                k
            };
            let is = |n: &str| {
                if glob {
                    self::glob(name.as_bytes(), n.as_bytes())
                } else {
                    name == n
                }
            };
            if is("env") {
                let mut k = 0;
                let mut spliced = None;
                while let Some(a) = text(k) {
                    if a == "--" {
                        k += 1;
                        break;
                    }
                    if let Some(dir) = a.strip_prefix("--chdir=") {
                        cwd = within(&cwd, dir);
                        k += 1;
                    } else if a == "-C" || a == "--chdir" {
                        cwd = text(k + 1).and_then(|d| within(&cwd, &d));
                        k += 2;
                    } else if a == "-S" || a == "--split-string" {
                        spliced = Some((text(k + 1).unwrap_or_default(), k + 2));
                        break;
                    } else if let Some(s) = a
                        .strip_prefix("--split-string=")
                        .or(a.strip_prefix("-S").filter(|s| !s.is_empty()))
                    {
                        spliced = Some((s.to_string(), k + 1));
                        break;
                    } else if a == "-u" || a == "--unset" || a == "-P" {
                        k += 2;
                    } else if a.starts_with('-') && a.len() > 1 {
                        k += 1;
                    } else if let Some((n, v)) = a.split_once('=').filter(|(n, _)| {
                        !n.is_empty() && n.chars().all(|c| c == '_' || c.is_ascii_alphanumeric())
                    }) {
                        env.push((n.to_string(), v.to_string()));
                        k += 1;
                    } else {
                        break;
                    }
                }
                if let Some((s, after)) = spliced {
                    let mut words = self.split(&s, ctx);
                    words.extend(argv[(i + 1 + after).min(argv.len())..].iter().cloned());
                    argv = words;
                    i = 0;
                    continue;
                }
                i += 1 + k;
                continue;
            }
            if is("command") {
                let k = options(&[]);
                if (0..k).any(|n| matches!(text(n).as_deref(), Some("-v" | "-V"))) {
                    break;
                }
                i += 1 + k;
                continue;
            }
            if [
                "builtin",
                "nohup",
                "noglob",
                "nocorrect",
                "unbuffer",
                "chronic",
                "setsid",
                "time",
                "exec",
                "nice",
                "stdbuf",
                "caffeinate",
                "ionice",
                "arch",
                "busybox",
                "toybox",
                "doas",
                "sudo",
                "timeout",
                "gtimeout",
            ]
            .iter()
            .any(|n| is(n))
            {
                let with: &[&str] = if is("exec") {
                    &["-a"]
                } else if is("nice") {
                    &["-n"]
                } else if is("stdbuf") {
                    &["-i", "-o", "-e"]
                } else if is("caffeinate") {
                    &["-t", "-w"]
                } else if is("ionice") {
                    &["-c", "-n", "-p"]
                } else if is("arch") {
                    &["-arch"]
                } else if is("doas") {
                    &["-u", "-C"]
                } else if is("sudo") {
                    &[
                        "-u",
                        "-g",
                        "-h",
                        "-p",
                        "-C",
                        "-D",
                        "-r",
                        "-t",
                        "-U",
                        "-T",
                        "--user",
                        "--group",
                        "--host",
                        "--prompt",
                        "--close-from",
                        "--chdir",
                        "--role",
                        "--type",
                        "--other-user",
                        "--command-timeout",
                    ]
                } else if is("timeout") || is("gtimeout") {
                    &["-s", "-k", "--signal", "--kill-after"]
                } else {
                    &[]
                };
                let k = options(with);
                if is("sudo") {
                    let mut shell = false;
                    for n in 0..k {
                        let a = text(n).unwrap_or_default();
                        if a == "-D" || a == "--chdir" {
                            cwd = text(n + 1).and_then(|d| within(&cwd, &d));
                        } else if let Some(d) = a.strip_prefix("--chdir=") {
                            cwd = within(&cwd, d);
                        } else if a == "--shell"
                            || a == "--login"
                            || (!a.starts_with("--")
                                && (a.contains('s') || a.contains('i'))
                                && !with.contains(&a.as_str()))
                        {
                            shell = true;
                        }
                    }
                    let mut at = k;
                    while let Some((n, v)) = text(at)
                        .as_deref()
                        .and_then(|a| a.split_once('='))
                        .filter(|(n, _)| {
                            !n.is_empty()
                                && n.chars().all(|c| c == '_' || c.is_ascii_alphanumeric())
                        })
                    {
                        env.push((n.to_string(), v.to_string()));
                        at += 1;
                    }
                    if shell && text(at).is_some() {
                        let script = joined(at);
                        self.shell(&script, ctx, &cwd, &env, stdin.clone());
                        return;
                    }
                    i += 1 + at;
                    continue;
                }
                // timeout takes its duration before the command; nice takes `-N` too.
                let k = if is("timeout") || is("gtimeout") {
                    k + 1
                } else {
                    k
                };
                i += 1 + k;
                continue;
            }
            if is("watch") {
                let k = options(&["-n", "--interval", "-q", "--equexit"]);
                let script = joined(k);
                self.shell(&script, ctx, &cwd, &env, Stdin::default());
                return;
            }
            if ["npx", "bunx", "pnpx"].iter().any(|n| is(n))
                || (is("npm") && matches!(text(0).as_deref(), Some("exec" | "x")))
                || ((is("pnpm") || is("yarn") || is("bun"))
                    && matches!(text(0).as_deref(), Some("dlx" | "exec" | "x")))
            {
                let skip = usize::from(!["npx", "bunx", "pnpx"].iter().any(|n| is(n)));
                let mut k = skip;
                while let Some(a) = text(k) {
                    if a == "--" {
                        k += 1;
                        break;
                    }
                    if a == "-c" || a == "--call" {
                        let script = text(k + 1).unwrap_or_default();
                        self.shell(&script, ctx, &cwd, &env, stdin.clone());
                        return;
                    }
                    if a == "-p" || a == "--package" {
                        k += 2;
                        continue;
                    }
                    if !a.starts_with('-') {
                        break;
                    }
                    k += 1;
                }
                // The package's name, past any scope and version, is the program it runs.
                if let Some(Val { text: Some(t), .. }) = argv.get(i + 1 + k).cloned() {
                    let base = t.rsplit('/').next().unwrap_or(&t).to_string();
                    let base = base
                        .split('@')
                        .find(|s| !s.is_empty())
                        .unwrap_or("")
                        .to_string();
                    argv[i + 1 + k].text = Some(base);
                }
                i += 1 + k;
                continue;
            }
            if is("xargs") {
                let k = options(&[
                    "-I",
                    "-L",
                    "-n",
                    "-P",
                    "-s",
                    "-d",
                    "-E",
                    "-a",
                    "--arg-file",
                    "--delimiter",
                    "--max-args",
                    "--max-procs",
                    "--max-lines",
                    "--max-chars",
                    "--replace",
                    "--eof",
                ]);
                looked_up |= stdin.looked_up;
                if argv.len() <= i + 1 + k {
                    break;
                }
                // The words piped in become the command's arguments.
                if let Some(script) = &stdin.script {
                    let words = self.split(script, ctx);
                    argv.extend(words);
                }
                i += 1 + k;
                continue;
            }
            if is("find") {
                let words: Vec<Val> = argv[i + 1..].to_vec();
                let mut n = 0;
                while n < words.len() {
                    if matches!(
                        words[n].text.as_deref(),
                        Some("-exec" | "-execdir" | "-ok" | "-okdir")
                    ) {
                        let end = (n + 1..words.len())
                            .find(|&e| matches!(words[e].text.as_deref(), Some(";" | "+")))
                            .unwrap_or(words.len());
                        self.resolve(
                            words[n + 1..end].to_vec(),
                            env.clone(),
                            ctx,
                            Stdin::default(),
                            Vec::new(),
                        );
                        n = end;
                    }
                    n += 1;
                }
                break;
            }
            if [
                "sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "yash", "posh", "fish",
            ]
            .iter()
            .any(|n| is(n))
            {
                let mut k = 0;
                let mut command = false;
                let mut read_stdin = false;
                while let Some(a) = text(k) {
                    if a == "--" || a == "-" {
                        k += 1;
                        break;
                    }
                    if a == "--command" {
                        command = true;
                        k += 1;
                        break;
                    }
                    if a == "-o"
                        || a == "+o"
                        || a == "-O"
                        || a == "+O"
                        || a == "--rcfile"
                        || a == "--init-file"
                        || a == "-C" && is("fish")
                    {
                        k += 2;
                        continue;
                    }
                    if a.starts_with("--") {
                        k += 1;
                        continue;
                    }
                    if (a.starts_with('-') || a.starts_with('+')) && a.len() > 1 {
                        command |= a.contains('c');
                        read_stdin |= a.contains('s');
                        k += 1;
                        continue;
                    }
                    break;
                }
                if command {
                    if let Some(script) = text(k) {
                        self.shell(&script, ctx, &cwd, &env, stdin.clone());
                    }
                } else if text(k).is_none() || read_stdin {
                    if let Some(script) = stdin.script.clone() {
                        self.shell(&script, ctx, &cwd, &env, Stdin::default());
                    }
                }
                break;
            }
            if is("eval") {
                let script = joined(0);
                self.shell(&script, ctx, &cwd, &env, stdin.clone());
                return;
            }
            if is("su") {
                if let Some(at) = (0..argv.len())
                    .find(|&n| matches!(text(n).as_deref(), Some("-c" | "--command")))
                {
                    if let Some(script) = text(at + 1) {
                        self.shell(&script, ctx, &cwd, &env, stdin.clone());
                    }
                }
                break;
            }
            break;
        }
        let Some(first) = argv.get(i) else { return };
        let (program, glob) = program(first);
        let args: Vec<Arg> = argv[i + 1..]
            .iter()
            .map(|v| Arg {
                text: v.text.clone(),
                looked_up: v.looked_up,
            })
            .collect();
        let looked_up = looked_up || first.looked_up || args.iter().any(|a| a.looked_up);
        self.runs.push(Run {
            program,
            glob,
            args,
            env,
            cwd,
            writes,
            looked_up,
        });
    }

    /// What a builtin changes for the commands after it: `cd`, `pushd`, `export`, `unset`, `ln -s`.
    fn builtin(&mut self, argv: &[Val], ctx: &mut Ctx) {
        let words: Vec<Option<&str>> = argv.iter().map(|v| v.text.as_deref()).collect();
        let (name, _) = program(&argv[0]);
        let mut args = &words[1..];
        if (name == "builtin" || name == "command") && argv.len() > 1 {
            return self.builtin(&argv[1..], ctx);
        }
        match name.as_str() {
            "cd" | "pushd" => {
                while matches!(args.first(), Some(Some(a)) if a.starts_with('-') && a.len() > 1) {
                    args = &args[1..];
                }
                ctx.cwd = match args.first() {
                    None => Some(ctx.home.clone()),
                    Some(Some(dir)) if *dir != "-" => within(&ctx.cwd, dir),
                    _ => None,
                };
            }
            "popd" => ctx.cwd = None,
            "export" | "declare" | "typeset" | "local" | "readonly" => {
                for value in &argv[1..] {
                    let Some(text) = &value.text else { continue };
                    if let Some((n, v)) = text.split_once('=') {
                        ctx.vars.insert(
                            n.to_string(),
                            Val {
                                text: Some(v.to_string()),
                                looked_up: value.looked_up,
                                glob: false,
                            },
                        );
                        if name == "export" {
                            ctx.exported.push((n.to_string(), v.to_string()));
                        }
                    }
                }
            }
            "unset" => {
                for a in args.iter().flatten() {
                    ctx.vars.remove(*a);
                }
            }
            "ln" => {
                let plain: Vec<&str> = args
                    .iter()
                    .flatten()
                    .filter(|a| !a.starts_with('-'))
                    .copied()
                    .collect();
                if let [target, link] = plain.as_slice() {
                    if let (Some(link), Some(target)) = (ctx.path(link), ctx.path(target)) {
                        ctx.links.push((link, target));
                    }
                }
            }
            _ => {}
        }
    }
}

/// The program a word names: the last part of its path, lowercased, and whether it is a pattern.
fn program(word: &Val) -> (String, bool) {
    match &word.text {
        Some(text) => {
            let base = text.rsplit('/').next().unwrap_or(text).to_lowercase();
            (base, word.glob)
        }
        None => (String::new(), false),
    }
}

/// `dir` taken from `cwd`; None when it can't be known.
fn within(cwd: &Option<PathBuf>, dir: &str) -> Option<PathBuf> {
    let path = Path::new(dir);
    if path.is_absolute() {
        Some(path.to_path_buf())
    } else {
        cwd.as_ref().map(|c| c.join(path))
    }
}

/// What a command prints into a pipe, when the line says: `echo`, `printf` and `cat` of a heredoc.
fn printed(argv: &[Val], stdin: &Stdin) -> Option<String> {
    let (name, _) = program(&argv[0]);
    let texts: Option<Vec<String>> = argv[1..].iter().map(|v| v.text.clone()).collect();
    let texts = texts?;
    match name.as_str() {
        "echo" => {
            let words: Vec<&str> = texts
                .iter()
                .map(String::as_str)
                .skip_while(|w| matches!(*w, "-n" | "-e" | "-E" | "-ne" | "-en"))
                .collect();
            Some(words.join(" ").replace("\\n", "\n") + "\n")
        }
        "printf" => {
            let mut words = texts.iter();
            let format = words.next()?.replace("\\n", "\n").replace("\\t", "\t");
            let mut out = String::new();
            let mut rest = format.as_str();
            while let Some(at) = rest.find("%s") {
                out.push_str(&rest[..at]);
                out.push_str(words.next().map(String::as_str).unwrap_or(""));
                rest = &rest[at + 2..];
            }
            out.push_str(rest);
            Some(out)
        }
        "cat" if texts.is_empty() => stdin.script.clone(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(line: &str) -> Vec<String> {
        runs(line, Some(Path::new("/w")), Path::new("/h"))
            .into_iter()
            .map(|r| {
                let mut s = r.program.clone();
                for a in r.words() {
                    s.push(' ');
                    s.push_str(a);
                }
                if r.looked_up {
                    s.push_str(" [looked]");
                }
                s
            })
            .collect()
    }

    #[test]
    fn lookups_feed_kills() {
        assert_eq!(
            names("lsof -ti:3000 | xargs kill -9"),
            ["lsof -ti:3000", "kill -9 [looked]"]
        );
        assert!(names("for p in $(pgrep node); do kill $p; done")
            .last()
            .unwrap()
            .ends_with("[looked]"));
        assert!(names("pgrep node | while read p; do kill \"$p\"; done")
            .iter()
            .any(|n| n.starts_with("kill") && n.ends_with("[looked]")));
        assert!(names("kill $(lsof -t -i :3000)")
            .last()
            .unwrap()
            .ends_with("[looked]"));
        assert_eq!(names("kill 4242"), ["kill 4242"]);
    }

    #[test]
    fn a_glob_matches_like_the_shell() {
        assert!(glob(b"pk?ll", b"pkill"));
        assert!(glob(b"pk[i]ll", b"pkill"));
        assert!(glob(b"p*", b"pkill"));
        assert!(!glob(b"pk[!i]ll", b"pkill"));
    }
}
