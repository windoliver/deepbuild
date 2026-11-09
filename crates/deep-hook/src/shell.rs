//! The shell reader behind deep-hook's guards: what a command line runs, read through quoting, wrappers,
//! nested shells, sequencing, subshells, substitutions and heredocs, without running any of it. A guard
//! matches what a call does, so `p''kill`, `env pkill` and `sh -c 'pkill'` all read as one run of pkill,
//! while `rg 'pkill'`, a commit message or a heredoc written to a file read as an argument or as data.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::inline::{holds, interpreter, Program, INTERPRETERS};

/// How deep shells, substitutions and evals nest before the reader reads no further in.
pub const DEPTH: usize = 12;

/// The largest script file the reader reads.
const SCRIPT: u64 = 256 * 1024;

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
    /// The files its redirections read.
    pub reads: Vec<PathBuf>,
    /// Whether it is one a script file runs, read from the file: what a script reaches can change before it runs.
    pub scripted: bool,
    /// Whether what it reads on stdin, or one of its arguments, comes from a lookup by name or port.
    pub looked_up: bool,
    /// What the reader couldn't know of it, when it couldn't read it whole.
    pub unread: Option<Unread>,
    /// The paths the program text it's given inline holds, when it is an interpreter (`python3 -c`, `node -e`, a
    /// heredoc): it may read or write any of them.
    pub held: Vec<PathBuf>,
}

/// Why the reader couldn't read a run whole.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unread {
    /// The line computes its program, as with `"$(printf git)"` or a variable the line doesn't set.
    Program,
    /// It nests deeper than DEPTH shells, substitutions and evals: the reader read no further in, so it may run
    /// anything.
    Depth,
    /// A shell or an interpreter that reads its program on stdin from a pipe or a file whose text the reader can't
    /// know, as in `curl … | sh`: it may run anything.
    Piped,
    /// A shell or an interpreter whose program is a value the line computes, as with `eval "$X"`, `sh -c "$(curl …)"`
    /// or `bash <(curl …)`: it may run anything.
    Computed,
    /// An interpreter that runs a program it fetches from a URL, as `deno run https://…` does: it may run anything.
    Fetched,
    /// A shell that runs a script the line writes before it, as `curl -o f … && sh f` does: it may run anything.
    Written,
}

#[derive(Debug, Clone)]
pub struct Arg {
    /// The word after quote removal; None when it holds a value the line can't know.
    pub text: Option<String>,
    pub looked_up: bool,
    /// Whether it is a pattern the shell expands, such as `build/*`.
    pub glob: bool,
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
    let mut reader = Reader {
        runs: Vec::new(),
        written: Vec::new(),
    };
    let mut ctx = Ctx {
        cwd: cwd.map(Path::to_path_buf),
        home: home.to_path_buf(),
        vars: HashMap::new(),
        exported: Vec::new(),
        stdin: Stdin::default(),
        depth: 0,
        links: Vec::new(),
        scripted: false,
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
        same_name(bare.rsplit('/').next().unwrap_or("")).to_lowercase()
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
                glob: false,
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
            let (hit, next) = one(pattern, p, text[t]);
            if hit {
                p = next;
                t += 1;
                continue;
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
fn one(pattern: &[u8], p: usize, c: u8) -> (bool, usize) {
    match pattern[p] {
        b'?' => (true, p + 1),
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
                return (pattern[p] == c, p + 1);
            }
            (hit != negate, i + 1)
        }
        b'\\' if p + 1 < pattern.len() => (pattern[p + 1] == c, p + 2),
        other => (other == c, p + 1),
    }
}

/// A path or program name as a Mac's volume compares it, so `.PI/settings.json` in a repo with no `.pi` yet reads as the file later
/// opens as. The folds are ASCII and the few letters that fold to ASCII, all a guarded name can be spelled with. A
/// case-sensitive volume on a Mac is held a little too often; other systems take names as they are.
pub fn same_name(path: &str) -> String {
    if !cfg!(target_os = "macos") {
        return path.to_string();
    }
    let mut out = String::with_capacity(path.len());
    for c in path.chars() {
        match c {
            'ſ' => out.push('s'),
            '\u{212A}' => out.push('k'),
            'ß' | 'ẞ' => out.push_str("ss"),
            'ﬀ' => out.push_str("ff"),
            'ﬁ' => out.push_str("fi"),
            'ﬂ' => out.push_str("fl"),
            'ﬃ' => out.push_str("ffi"),
            'ﬄ' => out.push_str("ffl"),
            'ﬅ' | 'ﬆ' => out.push_str("st"),
            c => out.push(c.to_ascii_lowercase()),
        }
    }
    out
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
    feed: Feed,
}

/// What a command reads on stdin, as far as the line says: the pipe reader's answer for what flows into it.
#[derive(Clone, Default)]
enum Feed {
    /// The line doesn't say: the stdin the call itself was given.
    #[default]
    Inherited,
    /// Text the line writes: a heredoc, a here-string, or what `echo` or `printf` prints into the pipe.
    Text(String),
    /// Plain files on disk, in order: what `cat` of them pipes, or a `<` from one.
    Files(Vec<PathBuf>),
    /// A pipe or a file whose text the reader can't know, such as what `curl` or `base64 -d` prints.
    Unknown,
}

impl Stdin {
    /// The text it carries, its files read from disk; None when the line doesn't say it or the reader can't know it.
    fn text(&self) -> Option<String> {
        match &self.feed {
            Feed::Text(text) => Some(text.clone()),
            Feed::Files(paths) => {
                let mut text = String::new();
                for path in paths {
                    text.push_str(&script_text(
                        path,
                        SCRIPT.saturating_sub(text.len() as u64),
                    )?);
                }
                Some(text)
            }
            Feed::Inherited | Feed::Unknown => None,
        }
    }
}

/// The text of the plain file at `path` when it holds at most `most` bytes of text.
fn script_text(path: &Path, most: u64) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > most {
        return None;
    }
    fs::read_to_string(path).ok()
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
    /// Whether this is the text of a script file the line runs.
    scripted: bool,
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
                .find(|(link, _)| {
                    same_name(&lexical(link).to_string_lossy())
                        == same_name(&lexical(&path).to_string_lossy())
                })
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
    /// The files the line has written so far, in order, as their paths or, where the folder can't be known, as the
    /// line spells them: each with the text it now holds when the reader knows all of it (a `>` of what `echo`,
    /// `printf` or `cat` of a heredoc prints).
    written: Vec<(PathBuf, Option<String>)>,
}

impl Reader {
    fn script(&mut self, text: &str, ctx: &mut Ctx) {
        if ctx.depth > DEPTH {
            return self.too_deep(ctx);
        }
        let toks = Lexer::new(text).tokens(false);
        self.walk(&toks, ctx);
    }

    /// Records that what runs here nests past DEPTH, so it is unread.
    fn too_deep(&mut self, ctx: &Ctx) {
        self.runs.push(Run {
            cwd: ctx.cwd.clone(),
            scripted: ctx.scripted,
            unread: Some(Unread::Depth),
            ..Run::default()
        });
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
                    feed: printed,
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

    /// Reads one command, and returns what it prints into a pipe.
    fn command(&mut self, cur: &mut Cursor, ctx: &mut Ctx, stops: &[&str]) -> Feed {
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
            return Feed::Unknown;
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
        Feed::Unknown
    }

    /// The redirections after a compound command: its writes, and what its heredocs run.
    fn after(&mut self, cur: &mut Cursor, ctx: &mut Ctx) {
        let mut writes = Vec::new();
        let mut reads = Vec::new();
        while let Some(Tok::Redir { op, target, body }) = cur.peek() {
            self.redirection(
                op,
                target,
                body.as_ref(),
                ctx,
                (&mut writes, &mut reads),
                &mut ctx.stdin.clone(),
            );
            cur.i += 1;
        }
        if !writes.is_empty() || !reads.is_empty() {
            self.runs.push(Run {
                cwd: ctx.cwd.clone(),
                writes,
                reads,
                scripted: ctx.scripted,
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
        (writes, reads): (&mut Vec<PathBuf>, &mut Vec<PathBuf>),
        stdin: &mut Stdin,
    ) {
        let value = self.value(target, ctx);
        if matches!(op, "<" | "<>") {
            if let Some(path) = value.text.as_deref().and_then(|t| ctx.path(t)) {
                reads.push(path);
            }
        }
        match op {
            ">" | ">>" | ">|" | "&>" | "&>>" | "<>" => {
                if let Some(t) = value.text.as_deref() {
                    self.written
                        .push((ctx.path(t).unwrap_or_else(|| PathBuf::from(t)), None));
                }
                if let Some(path) = value.text.as_deref().and_then(|t| ctx.path(t)) {
                    writes.push(path);
                }
            }
            // `>&file` writes the file; `>&2` and `>&-` only move a descriptor.
            ">&" => match value.text.as_deref() {
                Some(t) if !t.is_empty() && t != "-" && !t.chars().all(|c| c.is_ascii_digit()) => {
                    self.written
                        .push((ctx.path(t).unwrap_or_else(|| PathBuf::from(t)), None));
                    if let Some(path) = ctx.path(t) {
                        writes.push(path);
                    }
                }
                _ => {}
            },
            "<" => {
                *stdin = Stdin {
                    looked_up: false,
                    feed: match value.text.as_deref().and_then(|t| ctx.path(t)) {
                        Some(path) if path == Path::new("/dev/null") => Feed::Text(String::new()),
                        Some(path) => Feed::Files(vec![path]),
                        None => Feed::Unknown,
                    },
                }
            }
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
                        feed: Feed::Text(body.text.clone()),
                    };
                }
            }
            "<<<" => {
                *stdin = Stdin {
                    looked_up: value.looked_up,
                    feed: value.text.map_or(Feed::Unknown, |t| Feed::Text(t + "\n")),
                }
            }
            _ => {}
        }
    }

    fn simple(&mut self, cur: &mut Cursor, ctx: &mut Ctx) -> Feed {
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
        let mut reads = Vec::new();
        let mut stdin = ctx.stdin.clone();
        let from = self.written.len();
        let plain = redirs
            .iter()
            .all(|(op, ..)| !op.contains('>') || matches!(*op, ">" | ">|"));
        for (op, target, body) in redirs {
            self.redirection(op, target, body, ctx, (&mut writes, &mut reads), &mut stdin);
        }
        if argv.is_empty() {
            for (name, value) in assigned {
                ctx.vars.insert(name, value);
            }
            if !writes.is_empty() || !reads.is_empty() {
                self.runs.push(Run {
                    cwd: ctx.cwd.clone(),
                    writes,
                    reads,
                    scripted: ctx.scripted,
                    ..Run::default()
                });
            }
            return Feed::Unknown;
        }
        let mut env = ctx.exported.clone();
        env.extend(
            assigned
                .iter()
                .filter_map(|(name, value)| value.text.clone().map(|t| (name.clone(), t))),
        );
        let printed = printed(&argv, &stdin, ctx);
        // What a lone `>` writes is known when the command prints known text.
        if let (true, [(_, text)], Feed::Text(t)) = (plain, &mut self.written[from..], &printed) {
            *text = Some(t.clone());
        }
        self.resolve(argv.clone(), env, ctx, stdin, (writes, reads));
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
                    } else {
                        self.too_deep(&inner);
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
        (writes, reads): (Vec<PathBuf>, Vec<PathBuf>),
    ) {
        let mut cwd = ctx.cwd.clone();
        let mut looked_up = stdin.looked_up;
        let mut unread = None;
        let mut held = Vec::new();
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
                    } else if a == "--split-string" || env_split(&a) == Some("") {
                        match text(k + 1) {
                            Some(s) => spliced = Some((s, k + 2)),
                            None if argv.get(i + 2 + k).is_some() => {
                                unread = Some(Unread::Computed)
                            }
                            None => {}
                        }
                        break;
                    } else if let Some(s) = a.strip_prefix("--split-string=").or(env_split(&a)) {
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
                // A word the line computes where env reads its options may be `-S` and the program it splits.
                if text(k).is_none() && argv.get(i + 1 + k).is_some() {
                    unread = Some(Unread::Computed);
                }
                if unread.is_some() {
                    break;
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
                if argv[(i + 1 + k).min(argv.len())..]
                    .iter()
                    .any(|v| v.text.is_none())
                {
                    unread = Some(Unread::Computed);
                    break;
                }
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
                        let Some(script) = text(k + 1) else {
                            unread = argv.get(i + 2 + k).map(|_| Unread::Computed);
                            break;
                        };
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
                if unread.is_some() {
                    break;
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
            // A project's runner runs the command after its options in the project's environment.
            let runner_options = |mut k: usize| {
                while let Some(a) = text(k) {
                    if !a.starts_with('-') || a == "-" || a == "--" {
                        break;
                    }
                    k += if RUNNER_VALUED.contains(&a.as_str()) {
                        2
                    } else {
                        1
                    };
                }
                k
            };
            let run = runner_options(0);
            if RUNNERS.iter().any(|n| is(n)) && text(run).as_deref() == Some("run") {
                let mut k = runner_options(run + 1);
                if text(k).as_deref() == Some("--") {
                    k += 1;
                }
                // `hatch run test:pytest` names the environment before the command.
                if is("hatch") {
                    if let Some(Val { text: Some(t), .. }) = argv.get_mut(i + 1 + k) {
                        if let Some((_, command)) = t.split_once(':') {
                            *t = command.to_string();
                        }
                    }
                }
                // An option the list doesn't know may take a value, so a shell or an interpreter named later is
                // read as the command too.
                for at in i + 2 + run..argv.len() {
                    let (later, _) = program(&argv[at]);
                    if at != i + 1 + k
                        && (SHELLS.contains(&later.as_str()) || interpreter(&later).is_some())
                    {
                        self.resolve(
                            argv[at..].to_vec(),
                            env.clone(),
                            ctx,
                            stdin.clone(),
                            (Vec::new(), Vec::new()),
                        );
                    }
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
                if let Some(script) = stdin.text() {
                    let words = self.split(&script, ctx);
                    argv.extend(words);
                } else if !matches!(stdin.feed, Feed::Inherited) {
                    // Words the line can't say, handed to a shell or an interpreter, are a program it can't read.
                    let (next, glob) = program(&argv[i + 1 + k]);
                    let runs = |n: &str| {
                        if glob {
                            self::glob(next.as_bytes(), n.as_bytes())
                        } else {
                            next == n
                        }
                    };
                    if SHELLS.iter().chain(INTERPRETERS).any(|n| runs(n))
                        || interpreter(&next).is_some()
                    {
                        unread = Some(Unread::Piped);
                        break;
                    }
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
                            (Vec::new(), Vec::new()),
                        );
                        n = end;
                    }
                    n += 1;
                }
                break;
            }
            if SHELLS.iter().any(|n| is(n)) {
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
                let given = argv.get(i + 1 + k).is_some();
                if command {
                    match text(k) {
                        Some(script) => self.shell(&script, ctx, &cwd, &env, stdin.clone()),
                        None if given => unread = Some(Unread::Computed),
                        None => {}
                    }
                } else if !given || read_stdin || text(k).is_some_and(|f| stdin_device(&f)) {
                    unread = self.piped(&stdin, ctx, &cwd, &env);
                } else {
                    match text(k) {
                        Some(file) => unread = self.file(&file, true, ctx, &cwd, &env),
                        None => unread = Some(Unread::Computed),
                    }
                }
                break;
            }
            if is("source") || is(".") {
                match text(0) {
                    Some(file) => unread = self.file(&file, true, ctx, &cwd, &env),
                    None if argv.get(i + 1).is_some() => unread = Some(Unread::Computed),
                    None => {}
                }
                break;
            }
            if is("eval") {
                if argv[i + 1..].iter().any(|v| v.text.is_none()) {
                    unread = Some(Unread::Computed);
                    break;
                }
                let script = joined(0);
                self.shell(&script, ctx, &cwd, &env, stdin.clone());
                return;
            }
            // A pattern for a name is each interpreter it may name.
            let lang = match glob {
                false => interpreter(&name),
                true => INTERPRETERS
                    .iter()
                    .find(|n| is(n))
                    .and_then(|n| interpreter(n)),
            };
            if let Some(lang) = lang {
                if cfg!(feature = "plant-any-pipe-unread") && !matches!(stdin.feed, Feed::Inherited)
                {
                    unread = Some(Unread::Piped);
                }
                let args: Vec<Option<String>> =
                    argv[i + 1..].iter().map(|v| v.text.clone()).collect();
                let program = match lang.program(&args) {
                    Program::File(Some(f)) if stdin_device(&f) => Program::Stdin,
                    program => program,
                };
                match program {
                    Program::Inline(texts) => match texts.into_iter().collect::<Option<Vec<_>>>() {
                        Some(texts) => {
                            for text in texts {
                                held.extend(holds(&text, &ctx.home, cwd.as_deref()));
                            }
                        }
                        None => unread = Some(Unread::Computed),
                    },
                    Program::Stdin => match stdin.feed {
                        Feed::Inherited => {}
                        _ => match stdin.text() {
                            Some(text) => held.extend(holds(&text, &ctx.home, cwd.as_deref())),
                            None => unread = Some(Unread::Piped),
                        },
                    },
                    Program::File(None) => unread = Some(Unread::Computed),
                    Program::File(Some(f))
                        if ["https://", "http://"].iter().any(|s| {
                            f.get(..s.len()).is_some_and(|p| p.eq_ignore_ascii_case(s))
                        }) =>
                    {
                        unread = Some(Unread::Fetched)
                    }
                    Program::File(Some(_)) | Program::None => {}
                }
                break;
            }
            if is("su") {
                if let Some(at) = (0..argv.len())
                    .find(|&n| matches!(text(n).as_deref(), Some("-c" | "--command")))
                {
                    match text(at + 1) {
                        Some(script) => self.shell(&script, ctx, &cwd, &env, stdin.clone()),
                        None if argv.get(i + 2 + at).is_some() => unread = Some(Unread::Computed),
                        None => {}
                    }
                }
                break;
            }
            break;
        }
        let Some(first) = argv.get(i) else { return };
        // A program named by its path may be a script: what it runs is read from the file.
        if let Some(path) = first.text.as_deref().filter(|t| t.contains('/')) {
            unread = unread.or(self.file(path, false, ctx, &cwd, &env));
        }
        let (program, glob) = program(first);
        let args: Vec<Arg> = argv[i + 1..]
            .iter()
            .map(|v| Arg {
                text: v.text.clone(),
                looked_up: v.looked_up,
                glob: v.glob,
            })
            .collect();
        let looked_up = looked_up || first.looked_up || args.iter().any(|a| a.looked_up);
        // A program the line computes may be an interpreter: `"$PY" -c '…'` holds what its words hold.
        if first.text.is_none() {
            for text in args.iter().filter_map(|a| a.text.as_deref()) {
                held.extend(holds(text, &ctx.home, cwd.as_deref()));
            }
        }
        let later = !self.runs.is_empty();
        self.runs.push(Run {
            unread: (first.text.is_none() && !cfg!(feature = "plant-computed-misses"))
                .then_some(Unread::Program)
                .or(unread)
                .or((cfg!(feature = "plant-every-pipe-unread")
                    && !matches!(stdin.feed, Feed::Inherited))
                .then_some(Unread::Piped))
                .or((cfg!(feature = "plant-later-command-unread") && later)
                    .then_some(Unread::Written)),
            held,
            program,
            glob,
            args,
            env,
            cwd,
            writes,
            reads,
            scripted: ctx.scripted,
            looked_up,
        });
    }

    /// Reads the script file `name` the line runs, in `cwd` with `env`, as a shell started by this line: a text
    /// file of at most SCRIPT bytes, with no `#!` line or one that names a shell. One the line writes before it is
    /// read as the text written when the reader knows it, and is unread otherwise. So is one an earlier command names
    /// while it doesn't exist yet, as `curl -o f … && sh f` does: any command when a shell runs it, a fetcher's when
    /// it runs by its path (`gcc -o hello … && ./hello` runs what it built). Where the folder can't be known, a file
    /// whose path ends as `name` does counts as it.
    fn file(
        &mut self,
        name: &str,
        shell: bool,
        ctx: &Ctx,
        cwd: &Option<PathBuf>,
        env: &[(String, String)],
    ) -> Option<Unread> {
        let mut at = ctx.clone();
        at.cwd = cwd.clone();
        let path = at.path(name);
        let is = |p: &Path, from: Option<&PathBuf>| {
            let p = match (p.is_absolute(), from) {
                (false, Some(dir)) => dir.join(p),
                _ => p.to_path_buf(),
            };
            match &path {
                Some(path) if p.is_absolute() => {
                    same_name(&lexical(&p).to_string_lossy())
                        == same_name(&lexical(path).to_string_lossy())
                }
                _ => {
                    let (p, n) = (lexical(&p), lexical(Path::new(name)));
                    p.ends_with(&n) || n.ends_with(&p)
                }
            }
        };
        if let Some((_, text)) = self.written.iter().rev().find(|(w, _)| is(w, None)) {
            let Some(text) = text.clone() else {
                return Some(Unread::Written);
            };
            return self.script_file(&text, at, cwd, env);
        }
        let named = self.runs.iter().any(|run| {
            (shell || FETCHERS.iter().any(|n| run.is(n)))
                && run
                    .args
                    .iter()
                    .filter_map(|a| a.text.as_deref())
                    .flat_map(named_paths)
                    .any(|a| is(Path::new(a), run.cwd.as_ref()))
        });
        if named && !path.as_ref().is_some_and(|p| p.exists()) {
            return Some(Unread::Written);
        }
        let text = script_text(&path?, SCRIPT)?;
        self.script_file(&text, at, cwd, env)
    }

    /// Runs the text of a script file the line runs, with no `#!` line or one that names a shell.
    fn script_file(
        &mut self,
        text: &str,
        mut at: Ctx,
        cwd: &Option<PathBuf>,
        env: &[(String, String)],
    ) -> Option<Unread> {
        if let Some(line) = text.strip_prefix("#!").and_then(|t| t.lines().next()) {
            let shells = ["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"];
            if !line
                .split_whitespace()
                .any(|w| shells.contains(&same_name(w.rsplit('/').next().unwrap_or(w)).as_str()))
            {
                return None;
            }
        }
        at.scripted = true;
        self.shell(text, &at, cwd, env, Stdin::default());
        None
    }

    /// Reads the program a shell reads on `stdin`: the text the line writes into it, or the plain files a pipe or a
    /// `<` carries, as a script file is read. What it reads unread when the reader can't know its text.
    fn piped(
        &mut self,
        stdin: &Stdin,
        ctx: &Ctx,
        cwd: &Option<PathBuf>,
        env: &[(String, String)],
    ) -> Option<Unread> {
        if matches!(stdin.feed, Feed::Inherited) {
            return None;
        }
        let Some(text) = stdin.text() else {
            return Some(Unread::Piped);
        };
        let mut at = ctx.clone();
        at.scripted |= matches!(stdin.feed, Feed::Files(_));
        self.shell(&text, &at, cwd, env, Stdin::default());
        None
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

/// The string an `env` option cluster splits, as `-S'…'` or `-vS '…'` (empty when it is the next word): its letters
/// before `S` are flags that take no value.
fn env_split(word: &str) -> Option<&str> {
    let (flags, rest) = word.strip_prefix('-')?.split_once('S')?;
    flags.chars().all(|c| "iv0".contains(c)).then_some(rest)
}

/// The programs that fetch or copy a file to a path an argument names, as `curl -o f` and `wget URL` do.
const FETCHERS: &[&str] = &[
    "curl", "wget", "aria2c", "scp", "rsync", "sftp", "cp", "mv", "install", "dd", "tee", "http",
    "xh",
];

/// The paths an argument may name: itself, what follows `=` (`--output=f`, `of=f`), what follows a short option
/// (`-of`), and a URL's last part (`curl -O`, `wget`).
fn named_paths(arg: &str) -> Vec<&str> {
    let mut out = vec![arg];
    if let Some((_, v)) = arg.split_once('=') {
        out.push(v);
    }
    if arg.starts_with('-') && !arg.starts_with("--") && arg.len() > 2 {
        out.push(&arg[2..]);
    }
    if arg.contains("://") {
        let path = arg.split(['?', '#']).next().unwrap_or(arg);
        out.extend(path.rsplit('/').next().filter(|n| !n.is_empty()));
    }
    out
}

/// The project runners whose `run` runs a command in the project's environment, as `uv run python -c …` does.
const RUNNERS: &[&str] = &[
    "uv",
    "poetry",
    "pipenv",
    "pdm",
    "hatch",
    "rye",
    "pixi",
    "conda",
    "mamba",
    "micromamba",
];

/// The runners' options before the command that take the next argument as their value.
const RUNNER_VALUED: &[&str] = &[
    "--with",
    "--with-editable",
    "--with-requirements",
    "-p",
    "--python",
    "--project",
    "--directory",
    "--package",
    "--extra",
    "--group",
    "--env-file",
    "--index",
    "--default-index",
    "-i",
    "--index-url",
    "--extra-index-url",
    "-f",
    "--find-links",
    "-C",
    "-P",
    "-e",
    "--environment",
    "--manifest-path",
    "-n",
    "--name",
    "--prefix",
    "--pyproject",
];

/// The shells the reader reads a script for.
const SHELLS: &[&str] = &[
    "sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "yash", "posh", "fish",
];

/// Whether `path` names the standard input: a program read from it is read from the pipe.
fn stdin_device(path: &str) -> bool {
    matches!(path, "/dev/stdin" | "/dev/fd/0" | "/proc/self/fd/0")
}

/// The program a word names: the last part of its path, lowercased, and whether it is a pattern.
fn program(word: &Val) -> (String, bool) {
    match &word.text {
        Some(text) => {
            let base = same_name(text.rsplit('/').next().unwrap_or(text)).to_lowercase();
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

/// What a command prints into a pipe: what `echo` and `printf` print, and what `cat` passes on of its stdin or of the
/// plain files it names. Anything else prints what the reader can't know.
fn printed(argv: &[Val], stdin: &Stdin, ctx: &Ctx) -> Feed {
    let (name, _) = program(&argv[0]);
    let texts: Option<Vec<String>> = argv[1..].iter().map(|v| v.text.clone()).collect();
    let Some(texts) = texts else {
        return Feed::Unknown;
    };
    let text = match name.as_str() {
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
            let Some(format) = words.next() else {
                return Feed::Unknown;
            };
            let format = format.replace("\\n", "\n").replace("\\t", "\t");
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
        "cat" if texts.is_empty() => return stdin.feed.clone(),
        "cat" if texts.iter().all(|t| !t.starts_with('-')) => {
            return texts
                .iter()
                .map(|t| ctx.path(t))
                .collect::<Option<Vec<_>>>()
                .map_or(Feed::Unknown, Feed::Files)
        }
        _ => None,
    };
    text.map_or(Feed::Unknown, Feed::Text)
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
