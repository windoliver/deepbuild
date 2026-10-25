//! The one matcher for guard@1 entries: whether an entry's `match` reads what a call does. A `match` is one
//! predicate over the call as the shell reader reads it:
//!
//! - `shell:<glob>`: the shell command, whole, matches the glob (`*` any run, spaces included).
//! - `run:<program> [<arg>…]`: a program the call runs, through any wrapper or nested shell, is `<program>`,
//!   and its arguments that aren't options match the `<arg>` globs in order; an `<arg>` that starts with `-`
//!   matches any of its arguments instead.
//! - `write:<path>…`: the call writes a path matching one of the globs, by Edit, Write, a patch or a
//!   recognizable shell write, the path as written and as its links and `..` resolve, against each glob and
//!   the file it links to. `~` is the home folder, `*` matches any run, slashes included, a glob that
//!   doesn't start with `/` or `~` matches a path's end, and a glob after `!` takes the paths it matches out.
//! - `kill:by-name`: a kill by name or port: pkill, killall, `fuser -k`, kill-port, or `kill` fed from a
//!   lookup by name or port (pgrep, lsof, …) through a pipe, a substitution, a variable or a loop.
//! - `dispatch:workflow`: a workflow dispatch: `gh workflow run`, or a `gh api`, `curl` or `wget` call to a
//!   `…/dispatches` endpoint.
//! - `git:stash-unnamed`: `git stash` with no message, `git stash push` or `save` with none, or `git stash pop`.
//! - `git:other-checkout`: git aimed at a worktree of the session's repository other than its own, by `cd`,
//!   `-C`, `--git-dir`, `--work-tree`, `GIT_DIR` or `GIT_WORK_TREE`.
//!
//! deep-hook reads rules.json as unreadable when an entry's `match` isn't one of these, so an entry newer than
//! deep-hook never fails open.

use std::fs;
use std::path::{Path, PathBuf};

use crate::shell::{self, glob, lexical, real, Run};

/// What deep-hook reads from one call: the runs of its shell command and the paths it writes.
pub struct Call {
    pub command: Option<String>,
    pub runs: Vec<Run>,
    pub writes: Vec<PathBuf>,
    pub cwd: Option<PathBuf>,
    pub home: PathBuf,
}

/// What a match found: the entry matched, with what a person needs to act on it, when there's more to say.
pub struct Hit {
    pub detail: Option<String>,
}

/// Whether deep-hook can read `pattern`.
pub fn known(pattern: &str) -> bool {
    let (kind, rest) = pattern.split_once(':').unwrap_or((pattern, ""));
    match kind {
        "shell" | "write" => !rest.is_empty(),
        "run" => !rest.trim().is_empty(),
        "kill" => rest == "by-name",
        "dispatch" => rest == "workflow",
        "git" => rest == "stash-unnamed" || rest == "other-checkout",
        _ => false,
    }
}

impl Call {
    /// A call as deep-hook reads it: a shell command (`tool_input.command`), a file tool's path, or a patch.
    pub fn new(
        tool: &str,
        command: Option<&str>,
        paths: &[String],
        cwd: Option<&Path>,
        home: &Path,
    ) -> Call {
        let shell_tool = tool == "Bash";
        let runs = match command.filter(|_| shell_tool) {
            Some(line) => shell::runs(line, cwd, home),
            None => Vec::new(),
        };
        let at = |p: &str| -> Option<PathBuf> {
            let path = Path::new(p);
            if let Some(rest) = p.strip_prefix("~/") {
                Some(home.join(rest))
            } else if path.is_absolute() {
                Some(path.to_path_buf())
            } else {
                cwd.map(|c| c.join(path))
            }
        };
        let mut writes: Vec<PathBuf> = paths.iter().filter_map(|p| at(p)).collect();
        for run in &runs {
            writes.extend(run.writes.iter().cloned());
            writes.extend(written(run).iter().filter_map(|p| match &run.cwd {
                _ if Path::new(p).is_absolute() => Some(PathBuf::from(p)),
                Some(c) => Some(c.join(p)),
                None => None,
            }));
        }
        Call {
            command: command.filter(|_| shell_tool).map(str::to_string),
            runs,
            writes,
            cwd: cwd.map(Path::to_path_buf),
            home: home.to_path_buf(),
        }
    }

    /// Whether `pattern` reads this call.
    pub fn matches(&self, pattern: &str) -> Option<Hit> {
        let (kind, rest) = pattern.split_once(':')?;
        let hit = |detail: Option<String>| Some(Hit { detail });
        match kind {
            "shell" => self
                .command
                .as_deref()
                .filter(|c| glob(rest.as_bytes(), c.as_bytes()))
                .and_then(|_| hit(None)),
            "run" => {
                let mut words = rest.split_whitespace();
                let program = words.next()?.to_lowercase();
                let wanted: Vec<&str> = words.collect();
                self.runs
                    .iter()
                    .find(|r| r.is(&program) && args_match(r, &wanted))
                    .and_then(|_| hit(None))
            }
            "write" => {
                let (but, globs): (Vec<&str>, Vec<&str>) =
                    rest.split_whitespace().partition(|g| g.starts_with('!'));
                self.writes
                    .iter()
                    .find(|w| {
                        globs.iter().any(|g| self.path_matches(g, w))
                            && !but.iter().any(|g| self.path_matches(&g[1..], w))
                    })
                    .map(|w| Hit {
                        detail: Some(format!("It writes {}.", real(w).display())),
                    })
            }
            "kill" if rest == "by-name" => self
                .runs
                .iter()
                .find(|r| kills_by_name(r))
                .and_then(|_| hit(None)),
            "dispatch" if rest == "workflow" => {
                self.runs.iter().find_map(dispatch).map(|line| Hit {
                    detail: Some(format!("To run it once approved: {line}")),
                })
            }
            "git" if rest == "stash-unnamed" => self
                .runs
                .iter()
                .find(|r| stash_unnamed(r))
                .and_then(|_| hit(None)),
            "git" if rest == "other-checkout" => self.other_checkout().map(|detail| Hit {
                detail: Some(detail),
            }),
            _ => None,
        }
    }

    fn path_matches(&self, pattern: &str, written: &Path) -> bool {
        let pattern = match pattern.strip_prefix("~/") {
            Some(rest) => format!("{}/{rest}", self.home.display()),
            None if pattern == "~" => self.home.display().to_string(),
            None => pattern.to_string(),
        };
        let anchored = pattern.starts_with('/');
        let mut patterns = vec![pattern.clone()];
        // The file a config path links to is guarded as the config is: the glob's literal part, resolved.
        if anchored {
            let cut = pattern.find(['*', '?', '[']).unwrap_or(pattern.len());
            let (literal, tail) = pattern.split_at(cut);
            let resolved = real(Path::new(literal.trim_end_matches('/')));
            let joined = if literal.ends_with('/') {
                format!("{}/{tail}", resolved.display())
            } else {
                format!("{}{tail}", resolved.display())
            };
            patterns.push(joined);
        }
        // The planted twin matches the path only as written, against each glob only as written.
        if cfg!(feature = "plant-paths-as-written") {
            patterns.truncate(1);
        }
        let forms = if cfg!(feature = "plant-paths-as-written") {
            vec![lexical(written)]
        } else {
            vec![lexical(written), real(written)]
        };
        forms.iter().any(|form| {
            let text = form.to_string_lossy();
            patterns.iter().any(|p| {
                if anchored {
                    glob_path(p.as_bytes(), text.as_bytes())
                } else {
                    glob_path(format!("*/{p}").as_bytes(), text.as_bytes())
                }
            })
        })
    }

    /// The other checkout a git run is aimed at, and the command for you to run there.
    fn other_checkout(&self) -> Option<String> {
        let own = checkout(self.cwd.as_deref()?)?;
        for run in self.runs.iter().filter(|r| r.is("git")) {
            let Some(theirs) = git_target(run) else {
                continue;
            };
            if theirs.common == own.common && theirs.root != own.root {
                let words: Vec<String> = git_rest(run).iter().map(|w| quote(w)).collect();
                return Some(format!(
                    "It is aimed at the checkout {} (git folder {}), not this session's {}. To run there: cd {} && git {}",
                    theirs.root.display(),
                    theirs.gitdir.display(),
                    own.root.display(),
                    quote(&theirs.root.to_string_lossy()),
                    words.join(" ")
                ));
            }
        }
        None
    }
}

/// The files a patch (Codex's apply_patch) adds, updates, deletes or moves to.
pub fn patched(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            [
                "*** Add File:",
                "*** Update File:",
                "*** Delete File:",
                "*** Move to:",
            ]
            .iter()
            .find_map(|head| line.strip_prefix(head))
            .map(|path| path.trim().to_string())
        })
        .collect()
}

/// `*` matching any run, slashes included, as path globs here read.
fn glob_path(pattern: &[u8], text: &[u8]) -> bool {
    glob(pattern, text)
}

fn quote(word: &str) -> String {
    if !word.is_empty()
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/._-+=:,@%".contains(c))
    {
        word.to_string()
    } else {
        format!("'{}'", word.replace('\'', "'\\''"))
    }
}

fn args_match(run: &Run, wanted: &[&str]) -> bool {
    let words = run.words();
    let mut plain = words.iter().filter(|w| !w.starts_with('-'));
    wanted.iter().all(|want| {
        if want.starts_with('-') {
            words.iter().any(|w| glob(want.as_bytes(), w.as_bytes()))
        } else {
            plain
                .next()
                .is_some_and(|w| glob(want.as_bytes(), w.as_bytes()))
        }
    })
}

/// The files a recognizable shell write changes, beyond its redirections.
fn written(run: &Run) -> Vec<String> {
    let words = run.words();
    let plain = |skip_values: &[&str]| -> Vec<String> {
        let mut out = Vec::new();
        let mut k = 0;
        while k < words.len() {
            let w = words[k];
            if skip_values.contains(&w) {
                k += 2;
                continue;
            }
            if !w.starts_with('-') || w == "-" {
                out.push(w.to_string());
            }
            k += 1;
        }
        out
    };
    let p = run.program.as_str();
    match p {
        "tee" | "rm" | "unlink" | "truncate" | "touch" | "sponge" | "mkdir" | "rmdir" | "chmod"
        | "chown" | "shred" => plain(&["-s", "--size", "-m", "--mode", "-r", "--reference"]),
        // sed and perl write every file they're given in place; the script among them names no file.
        "sed" | "gsed" | "perl"
            if words.iter().any(|w| {
                w.starts_with("-i")
                    || w.starts_with("--in-place")
                    || (p != "sed" && w.starts_with("-pi"))
                    || w.starts_with("-I")
            }) =>
        {
            plain(&["-e", "-f", "--expression", "--file", "-l"])
        }
        "cp" | "mv" | "install" | "ln" | "rsync" | "ditto" => {
            let all = plain(&[
                "-t",
                "--target-directory",
                "-m",
                "--mode",
                "-o",
                "-g",
                "-S",
                "--suffix",
            ]);
            let target = words
                .iter()
                .position(|w| *w == "-t" || *w == "--target-directory")
                .and_then(|k| words.get(k + 1))
                .map(|t| t.to_string());
            let mut out: Vec<String> = Vec::new();
            if let Some(t) = target {
                out.push(t);
            } else if let Some(last) = all.last() {
                out.push(last.clone());
            }
            // A move takes its sources away too.
            if p == "mv" {
                out.extend(all.iter().take(all.len().saturating_sub(1)).cloned());
            }
            out
        }
        "dd" => words
            .iter()
            .filter_map(|w| w.strip_prefix("of=").map(str::to_string))
            .collect(),
        "curl" | "wget" => {
            let mut out = Vec::new();
            for (k, w) in words.iter().enumerate() {
                if matches!(*w, "-o" | "--output" | "-O" | "--output-document") {
                    if let Some(f) = words.get(k + 1) {
                        if !(p == "curl" && *w == "-O") {
                            out.push(f.to_string());
                        }
                    }
                }
            }
            out
        }
        _ => Vec::new(),
    }
}

fn kills_by_name(run: &Run) -> bool {
    [
        "pkill",
        "killall",
        "killall5",
        "kill-port",
        "fkill",
        "skill",
        "slay",
    ]
    .iter()
    .any(|n| run.is(n))
        || (run.is("fuser")
            && run.words().iter().any(|w| {
                w.starts_with('-') && !w.starts_with("--") && w.contains('k') || *w == "--kill"
            }))
        || (run.is("kill") && run.looked_up)
}

/// A workflow dispatch, as the one `gh workflow run` line that would run it.
fn dispatch(run: &Run) -> Option<String> {
    let words = run.words();
    if run.is("gh") {
        let at = words.iter().position(|w| !w.starts_with('-'))?;
        if words.get(at) == Some(&"workflow") && words.get(at + 1) == Some(&"run") {
            let rest: Vec<String> = words[at + 2..].iter().map(|w| quote(w)).collect();
            return Some(format!("gh workflow run {}", rest.join(" ")));
        }
        if words.get(at) == Some(&"api") {
            let path = words[at + 1..].iter().find(|w| w.contains("/dispatches"))?;
            return Some(from_endpoint(path, &fields(&words[at + 1..])));
        }
        return None;
    }
    if run.is("curl") || run.is("wget") || run.is("http") || run.is("https") || run.is("xh") {
        let url = words.iter().find(|w| w.contains("/dispatches"))?;
        let body = words.iter().enumerate().find_map(|(k, w)| {
            matches!(
                *w,
                "-d" | "--data"
                    | "--data-raw"
                    | "--data-binary"
                    | "--json"
                    | "--body-data"
                    | "--post-data"
            )
            .then(|| words.get(k + 1))
            .flatten()
        });
        let mut pairs = Vec::new();
        if let Some(body) = body {
            if let Ok(value) = deep_contracts::parse(body) {
                collect(&value, "", &mut pairs);
            }
        }
        return Some(from_endpoint(url, &pairs));
    }
    None
}

/// `gh api`'s fields: `-f`/`-F`/`--field`/`--raw-field` k=v.
fn fields(words: &[&str]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (k, w) in words.iter().enumerate() {
        let value = match *w {
            "-f" | "-F" | "--field" | "--raw-field" => words.get(k + 1).copied(),
            _ => w
                .strip_prefix("--field=")
                .or(w.strip_prefix("--raw-field=")),
        };
        if let Some((key, v)) = value.and_then(|v| v.split_once('=')) {
            out.push((key.to_string(), v.to_string()));
        }
    }
    out
}

fn collect(value: &deep_contracts::Value, at: &str, out: &mut Vec<(String, String)>) {
    use deep_contracts::Value;
    match value {
        Value::Object(members) => {
            for (k, v) in members {
                let key = if at.is_empty() {
                    k.clone()
                } else {
                    format!("{at}[{k}]")
                };
                collect(v, &key, out);
            }
        }
        Value::String(s) => out.push((at.to_string(), s.clone())),
        other => out.push((at.to_string(), deep_contracts::jcs(other))),
    }
}

/// The `gh workflow run` line for a `…/repos/<o>/<r>/actions/workflows/<w>/dispatches` endpoint and its fields.
fn from_endpoint(url: &str, pairs: &[(String, String)]) -> String {
    let path = url.split("repos/").nth(1).unwrap_or(url);
    let parts: Vec<&str> = path.split(['/', '?']).collect();
    let repo = parts.get(..2).map(|p| p.join("/")).unwrap_or_default();
    let workflow = parts
        .iter()
        .position(|p| *p == "workflows")
        .and_then(|k| parts.get(k + 1))
        .copied();
    let mut line = match workflow {
        Some(w) => format!("gh workflow run {} --repo {}", quote(w), quote(&repo)),
        None => {
            return format!(
                "gh api repos/{repo}/dispatches {}",
                pairs
                    .iter()
                    .map(|(k, v)| format!("-f {}", quote(&format!("{k}={v}"))))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        }
    };
    for (k, v) in pairs {
        if k == "ref" {
            line.push_str(&format!(" --ref {}", quote(v)));
        }
    }
    for (k, v) in pairs {
        if let Some(name) = k.strip_prefix("inputs[").and_then(|n| n.strip_suffix(']')) {
            line.push_str(&format!(" -f {}", quote(&format!("{name}={v}"))));
        }
    }
    line
}

/// git's subcommand and what follows it, past its global options.
fn git_rest(run: &Run) -> Vec<String> {
    let words = run.words();
    let mut k = 0;
    while k < words.len() {
        let w = words[k];
        if matches!(
            w,
            "-C" | "-c"
                | "--git-dir"
                | "--work-tree"
                | "--namespace"
                | "--exec-path"
                | "--config-env"
                | "--super-prefix"
        ) {
            k += 2;
        } else if w.starts_with('-') {
            k += 1;
        } else {
            break;
        }
    }
    words[k.min(words.len())..]
        .iter()
        .map(|w| w.to_string())
        .collect()
}

fn stash_unnamed(run: &Run) -> bool {
    if !run.is("git") {
        return false;
    }
    let rest = git_rest(run);
    if rest.first().map(|s| s.to_lowercase()).as_deref() != Some("stash") {
        return false;
    }
    let named = |words: &[String]| {
        words.iter().any(|w| {
            w == "-m"
                || w.starts_with("--message")
                || (w.starts_with('-') && !w.starts_with("--") && w.ends_with('m'))
        })
    };
    match rest.get(1).map(String::as_str) {
        None => true,
        Some("pop") => true,
        Some("push") => !named(&rest[2..]),
        // `save` takes its message as a word of its own.
        Some("save") => rest[2..].iter().all(|w| w.starts_with('-')),
        Some(w) if w.starts_with('-') => !named(&rest[1..]),
        _ => false,
    }
}

/// A checkout: its root, and its repository's common git folder.
struct Checkout {
    root: PathBuf,
    gitdir: PathBuf,
    common: PathBuf,
}

/// The checkout that holds `dir`: the nearest folder up from it with a `.git`.
fn checkout(dir: &Path) -> Option<Checkout> {
    let mut at = real(dir);
    loop {
        let dot = at.join(".git");
        if let Ok(meta) = fs::metadata(&dot) {
            return Some(if meta.is_dir() {
                Checkout {
                    root: at.clone(),
                    gitdir: real(&dot),
                    common: real(&dot),
                }
            } else {
                let gitdir = gitdir_of(&dot, &at)?;
                Checkout {
                    root: at.clone(),
                    common: common_of(&gitdir),
                    gitdir,
                }
            });
        }
        if !at.pop() {
            return None;
        }
    }
}

/// A `.git` file's `gitdir:` line, resolved.
fn gitdir_of(file: &Path, from: &Path) -> Option<PathBuf> {
    let text = fs::read_to_string(file).ok()?;
    let dir = text.lines().find_map(|l| l.strip_prefix("gitdir:"))?.trim();
    Some(real(&from.join(dir)))
}

/// A git folder's common folder: its `commondir` when it is a worktree's, else itself.
fn common_of(gitdir: &Path) -> PathBuf {
    match fs::read_to_string(gitdir.join("commondir")) {
        Ok(text) => real(&gitdir.join(text.trim())),
        Err(_) => real(gitdir),
    }
}

/// The checkout a git folder belongs to: a worktree's, through its `gitdir` file, or the main one's.
fn checkout_of_gitdir(gitdir: &Path) -> Option<Checkout> {
    let gitdir = real(gitdir);
    let common = common_of(&gitdir);
    let root = match fs::read_to_string(gitdir.join("gitdir")) {
        Ok(text) => real(Path::new(text.trim())).parent()?.to_path_buf(),
        Err(_) => gitdir.parent()?.to_path_buf(),
    };
    Some(Checkout {
        root,
        gitdir,
        common,
    })
}

/// Where a git run is aimed: None when it can't be known.
fn git_target(run: &Run) -> Option<Checkout> {
    let words = run.words();
    let mut cwd = run.cwd.clone();
    let env = |name: &str| {
        run.env
            .iter()
            .rev()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.clone())
    };
    let mut git_dir = env("GIT_DIR");
    let mut work_tree = env("GIT_WORK_TREE");
    let mut k = 0;
    while k < words.len() {
        let w = words[k];
        let next = words.get(k + 1).map(|s| s.to_string());
        match w {
            "-C" => {
                cwd = match (next.as_deref(), &cwd) {
                    (Some(d), _) if Path::new(d).is_absolute() => Some(PathBuf::from(d)),
                    (Some(d), Some(c)) => Some(c.join(d)),
                    _ => None,
                };
                k += 2;
            }
            "--git-dir" => {
                git_dir = next;
                k += 2;
            }
            "--work-tree" => {
                work_tree = next;
                k += 2;
            }
            "-c" | "--namespace" | "--exec-path" | "--config-env" => k += 2,
            _ if w.starts_with("--git-dir=") => {
                git_dir = Some(w["--git-dir=".len()..].to_string());
                k += 1;
            }
            _ if w.starts_with("--work-tree=") => {
                work_tree = Some(w["--work-tree=".len()..].to_string());
                k += 1;
            }
            _ if w.starts_with('-') => k += 1,
            _ => break,
        }
    }
    let at = |p: &str| -> Option<PathBuf> {
        if Path::new(p).is_absolute() {
            Some(PathBuf::from(p))
        } else {
            cwd.as_ref().map(|c| c.join(p))
        }
    };
    if let Some(tree) = work_tree {
        return at(&tree).and_then(|t| checkout(&t)).map(|mut c| {
            c.root = real(&at(&tree).unwrap_or_default());
            c
        });
    }
    if let Some(dir) = git_dir {
        return at(&dir).and_then(|d| checkout_of_gitdir(&d));
    }
    cwd.and_then(|c| checkout(&c))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bash(line: &str) -> Call {
        Call::new(
            "Bash",
            Some(line),
            &[],
            Some(Path::new("/w")),
            Path::new("/h"),
        )
    }

    #[test]
    fn a_rule_you_add_matches_what_the_call_runs() {
        let m = "run:terraform apply";
        assert!(bash("terraform apply").matches(m).is_some());
        assert!(
            bash("cd infra && env TF_LOG=1 terraform -chdir=x apply -auto-approve")
                .matches(m)
                .is_some()
        );
        assert!(bash("terraform plan").matches(m).is_none());
        assert!(bash("echo terraform apply").matches(m).is_none());
    }

    #[test]
    fn a_stash_saved_with_no_message_is_unnamed() {
        assert!(bash("git stash save")
            .matches("git:stash-unnamed")
            .is_some());
        assert!(bash("git stash save -u")
            .matches("git:stash-unnamed")
            .is_some());
        assert!(bash("git stash save wip-316")
            .matches("git:stash-unnamed")
            .is_none());
    }

    #[test]
    fn a_glob_after_a_bang_takes_paths_out() {
        let m = "write:.deepbuild/* !~/.deepbuild/*";
        assert!(bash("echo x > /repo/.deepbuild/done.yaml")
            .matches(m)
            .is_some());
        assert!(bash("echo x > /h/.deepbuild/workspaces/a")
            .matches(m)
            .is_none());
    }

    #[test]
    fn a_patch_writes_the_files_it_names() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n*** Add File: .mcp.json\n+{}\n*** End Patch\n";
        let paths = patched(patch);
        assert_eq!(paths, ["src/a.rs", ".mcp.json"]);
        let call = Call::new(
            "apply_patch",
            None,
            &paths,
            Some(Path::new("/repo")),
            Path::new("/h"),
        );
        assert!(call.matches("write:.mcp.json").is_some());
        assert!(call.matches("write:.claude/settings.json").is_none());
    }
}
