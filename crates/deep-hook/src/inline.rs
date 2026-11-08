//! An interpreter's program, read as text (#1503): where `python3`, `node`, `ruby`, `perl`, `php`, `osascript`,
//! `deno` and `bun` take it from (inline after `-c` or `-e`, on stdin, or from a file), and the paths its text holds.
//! The text isn't run or parsed as its language: a path it holds, spelled out, from `~` or `$HOME`, or joined to the
//! home folder by `expanduser` or `homedir()`, counts as one it may read or write. A program that builds its path at
//! run time still gets past this; the guard is a first refusal.

use std::path::{Path, PathBuf};

/// Where an interpreter's program comes from, as its arguments say.
pub enum Program {
    /// Text given inline (`-c`, `-e`, `deno eval`), each None when the line computes it.
    Inline(Vec<Option<String>>),
    /// Its stdin: it names no script file, or names `-`.
    Stdin,
    /// A script file, None when the line computes its name.
    File(Option<String>),
    /// No program: a module (`python3 -m`), a version or help, or a subcommand that runs none.
    None,
}

/// How one interpreter takes its program from its arguments.
pub struct Lang {
    /// The options whose value is program text: `-c`, `-e`, `--eval`.
    inline: &'static [&'static str],
    /// The other options that take the next argument as their value.
    valued: &'static [&'static str],
    /// The options that run no program: a module, a version, help.
    none: &'static [&'static str],
    /// In a cluster of short options such as `-pe`, the letters whose value is program text.
    inline_letters: &'static str,
    /// In a cluster, the letters whose value is the rest of the cluster, or the next argument when nothing follows.
    valued_letters: &'static str,
    /// In a cluster, the letters whose value can only be the rest of the cluster.
    attached_letters: &'static str,
    /// In a cluster, the letters that run no program (`python3 -m`).
    none_letters: &'static str,
    /// Whether it reads its program on stdin when it names no script.
    stdin: bool,
    /// The subcommand whose first argument is program text (`deno eval`).
    eval: Option<&'static str>,
    /// The subcommand that runs a script, or stdin for `-` (`deno run`, `bun run`).
    run: Option<&'static str>,
}

const PYTHON: Lang = Lang {
    inline: &["-c"],
    valued: &["-W", "-X", "--check-hash-based-pycs"],
    none: &["-m", "-V", "--version", "-h", "--help"],
    inline_letters: "c",
    valued_letters: "WX",
    attached_letters: "",
    none_letters: "m",
    stdin: true,
    eval: None,
    run: None,
};

const NODE: Lang = Lang {
    inline: &["-e", "--eval", "-p", "--print"],
    valued: &[
        "-r",
        "--require",
        "--import",
        "--loader",
        "--experimental-loader",
        "--input-type",
        "-C",
        "--conditions",
    ],
    none: &["-v", "--version", "-h", "--help"],
    inline_letters: "ep",
    valued_letters: "",
    attached_letters: "",
    none_letters: "",
    stdin: true,
    eval: None,
    run: None,
};

const RUBY: Lang = Lang {
    inline: &["-e"],
    valued: &["-I", "-r", "-C", "-E", "--encoding"],
    none: &["-v", "--version", "-h", "--help"],
    inline_letters: "e",
    valued_letters: "IrCE",
    attached_letters: "0Fxi",
    none_letters: "",
    stdin: true,
    eval: None,
    run: None,
};

const PERL: Lang = Lang {
    inline: &["-e", "-E"],
    valued: &["-I", "-M", "-m"],
    none: &["-v", "--version", "-h", "--help"],
    inline_letters: "eE",
    valued_letters: "IMm",
    attached_letters: "il0FCxdD",
    none_letters: "",
    stdin: true,
    eval: None,
    run: None,
};

const PHP: Lang = Lang {
    inline: &["-r", "-B", "-R", "-E"],
    valued: &["-d", "-c", "-z", "-t", "-S"],
    none: &["-v", "--version", "-h", "--help", "-m", "-i"],
    inline_letters: "",
    valued_letters: "",
    attached_letters: "",
    none_letters: "",
    stdin: true,
    eval: None,
    run: None,
};

const OSASCRIPT: Lang = Lang {
    inline: &["-e"],
    valued: &["-l", "-s"],
    none: &[],
    inline_letters: "",
    valued_letters: "",
    attached_letters: "",
    none_letters: "",
    stdin: true,
    eval: None,
    run: None,
};

const DENO: Lang = Lang {
    inline: &[],
    valued: &[
        "--ext",
        "--import-map",
        "--config",
        "-c",
        "--env-file",
        "--location",
    ],
    none: &["-V", "--version", "-h", "--help"],
    inline_letters: "",
    valued_letters: "",
    attached_letters: "",
    none_letters: "",
    stdin: false,
    eval: Some("eval"),
    run: Some("run"),
};

const BUN: Lang = Lang {
    inline: &["-e", "--eval", "-p", "--print"],
    valued: &["--cwd", "--env-file", "-r", "--preload", "--config", "-c"],
    none: &["-v", "--version", "-h", "--help"],
    inline_letters: "",
    valued_letters: "",
    attached_letters: "",
    none_letters: "",
    stdin: false,
    eval: None,
    run: Some("run"),
};

/// The interpreters' plain names, which a pattern for a program name is matched against.
pub const INTERPRETERS: &[&str] = &[
    "python",
    "python3",
    "python2",
    "pypy",
    "pypy3",
    "node",
    "nodejs",
    "ruby",
    "perl",
    "php",
    "osascript",
    "deno",
    "bun",
];

/// The interpreter a program name is: `python3.12`, `pypy3` and `nodejs` among them.
pub fn interpreter(name: &str) -> Option<&'static Lang> {
    let versioned = |base: &str| {
        name.strip_prefix(base)
            .is_some_and(|v| v.chars().all(|c| c.is_ascii_digit() || c == '.'))
    };
    Some(match name {
        _ if versioned("python") || versioned("pypy") => &PYTHON,
        "node" | "nodejs" => &NODE,
        _ if versioned("ruby") => &RUBY,
        _ if versioned("perl") => &PERL,
        _ if versioned("php") => &PHP,
        "osascript" => &OSASCRIPT,
        "deno" => &DENO,
        "bun" => &BUN,
        _ => return None,
    })
}

impl Lang {
    /// Where the program comes from, given the interpreter's arguments (None for one the line computes).
    pub fn program(&self, args: &[Option<String>]) -> Program {
        let mut texts = Vec::new();
        let mut eval = false;
        let mut k = 0;
        let value = |k: usize| args.get(k).cloned().unwrap_or(Some(String::new()));
        while k < args.len() {
            let Some(a) = args[k].as_deref() else { break };
            if a == "--" {
                k += 1;
                break;
            }
            if a == "-" {
                return if texts.is_empty() {
                    Program::Stdin
                } else {
                    Program::Inline(texts)
                };
            }
            if !a.starts_with('-') {
                if eval {
                    texts.push(Some(a.to_string()));
                    return Program::Inline(texts);
                }
                if texts.is_empty() && self.eval == Some(a) {
                    eval = true;
                    k += 1;
                    continue;
                }
                if texts.is_empty() && self.run == Some(a) {
                    k += 1;
                    continue;
                }
                break;
            }
            let (flag, attached) = match a.split_once('=') {
                Some((flag, v)) if a.starts_with("--") => (flag, Some(v)),
                _ => (a, None),
            };
            if self.inline.contains(&flag) {
                match attached {
                    Some(v) => texts.push(Some(v.to_string())),
                    None => {
                        texts.push(value(k + 1));
                        k += 1;
                    }
                }
                k += 1;
                continue;
            }
            if self.none.contains(&flag) {
                return Program::None;
            }
            if self.valued.contains(&flag) && attached.is_none() {
                k += 2;
                continue;
            }
            if !a.starts_with("--") {
                let letters: Vec<char> = a[1..].chars().collect();
                for (p, c) in letters.iter().enumerate() {
                    let rest: String = letters[p + 1..].iter().collect();
                    if self.inline_letters.contains(*c) {
                        // node's `-pe` is `-p -e`: one text, the next argument.
                        if rest.chars().all(|r| self.inline_letters.contains(r)) {
                            texts.push(value(k + 1));
                            k += 1;
                        } else {
                            texts.push(Some(rest));
                        }
                        break;
                    }
                    if self.none_letters.contains(*c) {
                        return Program::None;
                    }
                    if self.valued_letters.contains(*c) {
                        if rest.is_empty() {
                            k += 1;
                        }
                        break;
                    }
                    if self.attached_letters.contains(*c) {
                        break;
                    }
                }
            }
            k += 1;
        }
        if !texts.is_empty() {
            Program::Inline(texts)
        } else if eval {
            Program::Inline(vec![args.get(k).cloned().flatten()])
        } else if k < args.len() {
            Program::File(args[k].clone())
        } else if self.stdin {
            Program::Stdin
        } else {
            Program::None
        }
    }
}

/// The paths program `text` holds: each string in it and each word in one that is a path, spelled out or from `~` or
/// `$HOME`; strings next to each other joined as one path's parts, as `os.path.join` and `path.join` join them; and,
/// where the text reaches the home folder (`expanduser`, `homedir()`, `HOME`), each of those taken from it too.
pub fn holds(text: &str, home: &Path, cwd: Option<&Path>) -> Vec<PathBuf> {
    let reach = [
        "homedir",
        "expanduser",
        "Path.home",
        "Dir.home",
        "expand_path",
        "HOME",
    ]
    .iter()
    .any(|word| text.contains(word));
    let (strings, bare) = pieces(text);
    let mut out = Vec::new();
    for piece in strings.iter().chain(&bare) {
        path_of(piece, home, cwd, reach, &mut out);
        for word in piece.split_whitespace() {
            path_of(word, home, cwd, reach, &mut out);
        }
    }
    // A join's later parts are plain names; one that starts with a bare name, as `path.join(homedir(), 'Library', …)`
    // does, is taken from the home folder only.
    let name = |p: &String| {
        !p.is_empty()
            && p.chars().all(|c| c.is_alphanumeric() || "._-/".contains(c))
            && !p.starts_with('/')
    };
    for len in 2..=4 {
        for parts in strings.windows(len) {
            if parts[0].is_empty()
                || parts[0].contains(char::is_whitespace)
                || !parts[1..].iter().all(name)
            {
                continue;
            }
            let path = parts.join("/");
            if parts[0].starts_with(['/', '~', '$', '#', '{', '%', '.']) {
                path_of(&path, home, cwd, reach, &mut out);
            } else if reach {
                out.push(home.join(path));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The strings in program text, quoted with `'`, `"` or a backquote, and its unquoted words that hold a `/`.
fn pieces(text: &str) -> (Vec<String>, Vec<String>) {
    let mut strings = Vec::new();
    let mut bare = Vec::new();
    let mut word = String::new();
    let mut chars = text.chars();
    let end_word = |word: &mut String, bare: &mut Vec<String>| {
        if word.contains('/') {
            bare.push(std::mem::take(word));
        }
        word.clear();
    };
    while let Some(c) = chars.next() {
        match c {
            '\'' | '"' | '`' => {
                end_word(&mut word, &mut bare);
                let mut s = String::new();
                while let Some(d) = chars.next() {
                    match d {
                        '\\' => s.extend(chars.next()),
                        _ if d == c => break,
                        _ => s.push(d),
                    }
                }
                strings.push(s);
            }
            c if c.is_alphanumeric() || "._-/~${}#@%+:".contains(c) => word.push(c),
            _ => end_word(&mut word, &mut bare),
        }
    }
    end_word(&mut word, &mut bare);
    (strings, bare)
}

/// The paths one piece of program text may name, pushed to `out`.
fn path_of(piece: &str, home: &Path, cwd: Option<&Path>, reach: bool, out: &mut Vec<PathBuf>) {
    // Perl's two-argument open puts its mode before the path: `">$ENV{HOME}/…"`.
    let piece = piece
        .trim_start_matches(['<', '>', '+', '|', '&', ' '])
        .trim_end();
    // A URL names no file here.
    if piece.is_empty() || piece.len() > 4096 || piece.contains('\n') || piece.contains("://") {
        return;
    }
    let joined = |base: &Path, rest: &str| {
        let mut path = base.to_path_buf();
        path.extend(rest.split('/').filter(|part| !part.is_empty()));
        path
    };
    if piece == "~" || piece.starts_with("~/") {
        out.push(joined(home, &piece[1..]));
    } else if let Some((lead, rest)) = piece
        .split_once('/')
        .filter(|(lead, _)| lead.starts_with(['$', '#', '{', '%']))
    {
        // `$HOME/…`, `${os.homedir()}/…`, `#{Dir.home}/…`, `{Path.home()}/…`, `$ENV{HOME}/…`.
        if lead.to_lowercase().contains("home") {
            out.push(joined(home, rest));
        } else if let Some(cwd) = cwd.filter(|_| matches!(lead, "$PWD" | "${PWD}")) {
            out.push(joined(cwd, rest));
        }
    } else if piece.starts_with('/') {
        // `homedir() + '/.deepbuild/…'`: no folder at the root starts with a dot.
        if !(reach && piece.starts_with("/.")) {
            out.push(joined(Path::new("/"), piece));
        }
        if reach {
            out.push(joined(home, piece));
        }
    } else if piece.contains('/') || piece.starts_with('.') {
        if let Some(cwd) = cwd {
            out.push(joined(cwd, piece));
        }
        if reach {
            out.push(joined(home, piece));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(line: &[&str]) -> Vec<Option<String>> {
        line.iter().map(|w| Some(w.to_string())).collect()
    }

    fn inline(lang: &Lang, line: &[&str]) -> Vec<String> {
        match lang.program(&words(line)) {
            Program::Inline(texts) => texts.into_iter().flatten().collect(),
            _ => Vec::new(),
        }
    }

    #[test]
    fn the_program_text_is_found_where_each_interpreter_takes_it() {
        assert_eq!(inline(&PYTHON, &["-c", "print(1)"]), ["print(1)"]);
        assert_eq!(inline(&PYTHON, &["-Bc", "print(1)"]), ["print(1)"]);
        assert_eq!(inline(&PYTHON, &["-W", "ignore", "-c", "x"]), ["x"]);
        assert_eq!(inline(&NODE, &["-pe", "1"]), ["1"]);
        assert_eq!(inline(&NODE, &["--eval=1"]), ["1"]);
        assert_eq!(inline(&RUBY, &["-e", "a", "-e", "b"]), ["a", "b"]);
        assert_eq!(inline(&PERL, &["-i.bak", "-pe", "s/a/b/", "f"]), ["s/a/b/"]);
        assert_eq!(inline(&PERL, &["-Mstrict", "-e", "1"]), ["1"]);
        assert_eq!(inline(&PHP, &["-r", "echo 1;"]), ["echo 1;"]);
        assert_eq!(inline(&OSASCRIPT, &["-l", "JavaScript", "-e", "1"]), ["1"]);
        assert_eq!(inline(&DENO, &["eval", "--ext=ts", "1"]), ["1"]);
        assert_eq!(inline(&BUN, &["-e", "1"]), ["1"]);
        let is = |lang: &Lang, line: &[&str], want: fn(&Program) -> bool| {
            want(&lang.program(&words(line)))
        };
        assert!(is(&PYTHON, &[], |p| matches!(p, Program::Stdin)));
        assert!(is(&PYTHON, &["-"], |p| matches!(p, Program::Stdin)));
        assert!(is(&PYTHON, &["-m", "json.tool"], |p| matches!(
            p,
            Program::None
        )));
        assert!(is(&PYTHON, &["x.py"], |p| matches!(
            p,
            Program::File(Some(_))
        )));
        assert!(is(&DENO, &["run", "-"], |p| matches!(p, Program::Stdin)));
        assert!(is(&DENO, &[], |p| matches!(p, Program::None)));
        assert!(is(&NODE, &["--version"], |p| matches!(p, Program::None)));
        assert!(matches!(
            PYTHON.program(&[Some("-c".into()), None]),
            Program::Inline(t) if t == [None]
        ));
        assert!(interpreter("python3.12").is_some() && interpreter("pythonista").is_none());
    }

    #[test]
    fn a_path_counts_however_the_text_reaches_home() {
        let home = Path::new("/h");
        let held = |text: &str| holds(text, home, Some(Path::new("/w")));
        let rules = PathBuf::from("/h/.deepbuild/rules.json");
        for text in [
            "open('/h/.deepbuild/rules.json','w').write('{}')",
            "open('~/.deepbuild/rules.json','w')",
            "import os; open(os.path.expanduser('~/.deepbuild/rules.json'),'w')",
            "import os; open(os.path.join(os.path.expanduser('~'), '.deepbuild', 'rules.json'), 'w')",
            "require('fs').writeFileSync(require('os').homedir() + '/.deepbuild/rules.json', '{}')",
            "const p = require('path'); p.join(require('os').homedir(), '.deepbuild', 'rules.json')",
            "fs.writeFileSync(`${os.homedir()}/.deepbuild/rules.json`, '')",
            "open(F, \">$ENV{HOME}/.deepbuild/rules.json\")",
            "File.write(File.join(Dir.home, '.deepbuild/rules.json'), '')",
            "do shell script \"rm ~/.deepbuild/rules.json\"",
            "open('$HOME/.deepbuild/rules.json')",
        ] {
            assert!(held(text).contains(&rules), "{text}: {:?}", held(text));
        }
        assert!(held("print(1)").is_empty());
        assert!(held("console.log(1)").is_empty());
        assert!(held("import json,sys; print(json.load(sys.stdin))").is_empty());
        assert!(held("open('.mcp.json','w')").contains(&PathBuf::from("/w/.mcp.json")));
        assert!(held("open('$PWD/.mcp.json','w')").contains(&PathBuf::from("/w/.mcp.json")));
        let launch = "p.join(os.homedir(), 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist')";
        assert!(held(launch).contains(&PathBuf::from(
            "/h/Library/LaunchAgents/com.deepbuild.hub.plist"
        )));
        // A join's later part is a plain name: `fs` before a path doesn't make it a folder of the checkout.
        assert!(
            !held("require('fs').writeFileSync('$HOME/.deepbuild/rules.json')")
                .iter()
                .any(|p| p.starts_with("/w"))
        );
    }
}
