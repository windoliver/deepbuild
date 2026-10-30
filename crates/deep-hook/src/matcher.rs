//! The one matcher for guard@1 entries: whether an entry's `match` reads what a call does. A `match` is one
//! predicate over the call as the shell reader reads it:
//!
//! - `shell:<glob>`: the shell command, whole, matches the glob (`*` any run, spaces included).
//! - `word:<key>`: the shell command holds the key as a whole word: `graphql` reads `npm install graphql` and
//!   `graphql@16`, not `graphql-tools`.
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
//! - `read:<path>…`: the call reads a path matching one of the globs, as `write:` reads them: by Read or Grep,
//!   a redirection, or any shell run that names the path among its arguments.
//! - `hub:stop`: `deep hub stop` of the installed hub: with no `--root`, or one that is `~/.deepbuild`.
//! - `hub:service`: a stop, unload or removal of the hub's login service (launchd's `com.deepbuild.hub`,
//!   systemd's `deepbuild-hub.service`).
//! - `kill:hub`: a `kill` of the hub's process or its group, its PID read from the hub socket's peer.
//! - `effect:<class>`: a call with that effect: `cloud-resource` (a command that creates one), `dependency`
//!   (adds a package), `service` (starts a long-running one), `top-level-folder` (makes a folder at the
//!   checkout's top), or `unknown-reach-delete` (a delete run from a script file or over a pattern or a value
//!   the line can't know, so what it deletes can't be worked out before it runs), or one that needs your
//!   authority (#321): `push` (`git push`), `merge` (`gh pr merge`), `dispatch` (what `dispatch:workflow` reads),
//!   `send` (`gh pr comment`, `gh issue comment`, `gh pr review`) or `delete` (`gh repo delete`,
//!   `gh release delete`, `gh issue delete`).
//! - `counts:<class>`: the tool counts as `read`, `change`, `send` or `destructive`, by the classes rules.json
//!   holds; a tool they don't list counts as change, and one whose name starts with `delete_` as destructive.
//!
//! deep-hook reads rules.json as unreadable when an entry's `match` isn't one of these, so an entry newer than
//! deep-hook never fails open.

use std::fs;
use std::path::{Path, PathBuf};

use crate::shell::{self, glob, lexical, real, Arg, Run};

/// What deep-hook reads from one call: the runs of its shell command and the paths it writes.
pub struct Call {
    pub command: Option<String>,
    pub runs: Vec<Run>,
    pub writes: Vec<PathBuf>,
    pub reads: Vec<PathBuf>,
    /// The run each write and each read comes from, by its index in `runs`, and whether by a redirection; None
    /// for a file tool's path.
    by: (Vec<From>, Vec<From>),
    pub cwd: Option<PathBuf>,
    pub home: PathBuf,
    /// The hub's socket, whose peer is the hub's process.
    pub hub: PathBuf,
    /// What the tool counts as; None when no class is read for it.
    pub counts: Option<String>,
}

/// The run a path comes from, by its index, and whether by a redirection.
type From = Option<(usize, bool)>;

/// What a match found: the entry matched, with what a person needs to act on it, when there's more to say.
pub struct Hit {
    pub detail: Option<String>,
}

/// What a tool counts as, from least to most it can do.
pub const CLASSES: &[&str] = &["read", "change", "send", "destructive"];

const EFFECTS: &[&str] = &[
    "cloud-resource",
    "dependency",
    "service",
    "top-level-folder",
    "unknown-reach-delete",
    "push",
    "merge",
    "dispatch",
    "send",
    "delete",
];

/// The hub's login service, as `deep hub start` installs it (packages/hub/src/service.ts).
const HUB_LABEL: &str = "com.deepbuild.hub";
const HUB_UNIT: &str = "deepbuild-hub";

/// Whether `line` holds `key` with no letter, digit, `_`, `-` or `.` against either end of it.
fn holds_word(line: &str, key: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || matches!(c, '_' | '-' | '.');
    line.match_indices(key).any(|(at, _)| {
        !line[..at].chars().next_back().is_some_and(word)
            && !line[at + key.len()..].chars().next().is_some_and(word)
    })
}

/// Whether deep-hook can read `pattern`.
pub fn known(pattern: &str) -> bool {
    let (kind, rest) = pattern.split_once(':').unwrap_or((pattern, ""));
    match kind {
        "shell" | "write" | "word" => !rest.is_empty(),
        "run" => !rest.trim().is_empty(),
        "kill" => rest == "by-name" || rest == "hub",
        "dispatch" => rest == "workflow",
        "git" => rest == "stash-unnamed" || rest == "other-checkout",
        "read" => !rest.is_empty(),
        "hub" => rest == "stop" || rest == "service",
        "effect" => EFFECTS.contains(&rest),
        "counts" => CLASSES.contains(&rest),
        _ => false,
    }
}

impl Call {
    /// A call as deep-hook reads it: a shell command (`tool_input.command`), a file tool's path, or a patch;
    /// `read` says the paths are read, not written.
    pub fn new(
        tool: &str,
        command: Option<&str>,
        (paths, read): (&[String], bool),
        cwd: Option<&Path>,
        home: &Path,
        hub: &Path,
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
        let named: Vec<PathBuf> = paths.iter().filter_map(|p| at(p)).collect();
        let (mut writes, mut reads) = if read {
            (Vec::new(), named)
        } else {
            (named, Vec::new())
        };
        let mut by = (vec![None; writes.len()], vec![None; reads.len()]);
        for (k, run) in runs.iter().enumerate() {
            reads.extend(run.reads.iter().cloned());
            by.1.resize(reads.len(), Some((k, true)));
            // Any path a run names may be read: `cat`, `cp`, `base64`, an option's `=` value.
            for word in run.words() {
                let word = word.split_once('=').map_or(word, |(_, v)| v);
                if word.is_empty() || word.starts_with('-') {
                    continue;
                }
                match &run.cwd {
                    _ if Path::new(word).is_absolute() => reads.push(PathBuf::from(word)),
                    Some(c) => reads.push(c.join(word)),
                    None => {}
                }
            }
            writes.extend(run.writes.iter().cloned());
            by.0.resize(writes.len(), Some((k, true)));
            writes.extend(written(run).iter().filter_map(|p| match &run.cwd {
                _ if Path::new(p).is_absolute() => Some(PathBuf::from(p)),
                Some(c) => Some(c.join(p)),
                None => None,
            }));
            by.0.resize(writes.len(), Some((k, false)));
            by.1.resize(reads.len(), Some((k, false)));
        }
        Call {
            command: command.filter(|_| shell_tool).map(str::to_string),
            runs,
            writes,
            reads,
            by,
            cwd: cwd.map(Path::to_path_buf),
            home: home.to_path_buf(),
            hub: hub.to_path_buf(),
            counts: None,
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
            "word" => self
                .command
                .as_deref()
                .filter(|c| holds_word(c, rest))
                .and_then(|_| hit(None)),
            "run" => {
                let mut words = rest.split_whitespace();
                let program = words.next()?.to_lowercase();
                let wanted: Vec<&str> = words.collect();
                self.runs
                    .iter()
                    .find(|r| r.is(&program) && args_match(r, &wanted))
                    .map(runs_it)
            }
            "write" | "read" => {
                let (but, globs): (Vec<&str>, Vec<&str>) =
                    rest.split_whitespace().partition(|g| g.starts_with('!'));
                let (paths, by, verb) = if kind == "write" {
                    (&self.writes, &self.by.0, "writes")
                } else {
                    (&self.reads, &self.by.1, "reads")
                };
                let k = paths.iter().position(|w| {
                    globs.iter().any(|g| self.path_matches(g, w))
                        && !but.iter().any(|g| self.path_matches(&g[1..], w))
                })?;
                // A redirection isn't one of its run's words, so the call's own line names it.
                let ran = match (by[k], &self.command) {
                    (Some((_, true)), Some(line)) => format!(" It runs: {line}"),
                    (Some((r, _)), _) => format!(" It runs: {}", command_of(&self.runs[r])),
                    _ => String::new(),
                };
                Some(Hit {
                    detail: Some(format!("It {verb} {}.{ran}", real(&paths[k]).display())),
                })
            }
            "hub" if rest == "stop" => self
                .runs
                .iter()
                .find(|r| self.stops_installed_hub(r))
                .map(runs_it),
            "hub" if rest == "service" => self.runs.iter().find(|r| stops_service(r)).map(runs_it),
            "kill" if rest == "hub" => self.kills_hub(),
            "effect" => self.effect(rest),
            "counts" => self
                .counts
                .as_deref()
                .filter(|c| *c == rest)
                .and_then(|c| hit(Some(format!("It counts as {c}.")))),
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

    /// The folders a delete whose reach can't be worked out names, for the hub to stage before it runs (#347): each
    /// path it deletes, the folder a pattern's literal part ends in, and for `git clean` or a `find` with no starting
    /// point the folder it runs in. None when one of them is a value the line can't know, or the folder it runs in is.
    pub fn stage(&self) -> Option<Vec<PathBuf>> {
        let mut folders: Vec<PathBuf> = Vec::new();
        for run in self.runs.iter().filter(|r| unknown_reach(r)) {
            let cwd = run.cwd.as_ref()?;
            let named = targets(run);
            if run.is("git") || (run.is("find") && named.is_empty()) {
                folders.push(lexical(cwd));
                continue;
            }
            if named.is_empty() {
                return None;
            }
            for arg in named {
                let text = arg.text.as_deref()?;
                let text = if arg.glob {
                    let cut = text.find(['*', '?', '[']).unwrap_or(text.len());
                    &text[..text[..cut].rfind('/').map_or(0, |k| k + 1)]
                } else {
                    text
                };
                let path = match text.strip_prefix("~/") {
                    Some(rest) => self.home.join(rest),
                    None if text == "~" => self.home.clone(),
                    None => cwd.join(text),
                };
                folders.push(lexical(&path));
            }
        }
        // A folder inside another one named is staged with it.
        folders.sort();
        folders.dedup();
        let all = folders.clone();
        folders.retain(|f| !all.iter().any(|g| g != f && f.starts_with(g)));
        Some(folders)
    }

    /// Whether a run is `deep hub stop` aimed at the installed hub, `~/.deepbuild`, not a dev hub's `--root`.
    fn stops_installed_hub(&self, run: &Run) -> bool {
        let words = run.words();
        if !run.is("deep") || !args_match(run, &["hub", "stop"]) {
            return false;
        }
        let root = words.iter().enumerate().find_map(|(k, w)| {
            if *w == "--root" {
                Some(run.args.get(k + 1).and_then(|a| a.text.clone()))
            } else {
                w.strip_prefix("--root=").map(|v| Some(v.to_string()))
            }
        });
        let installed = real(&self.home.join(".deepbuild"));
        match root {
            None => true,
            // A folder the line can't know may be the installed hub's.
            Some(None) => true,
            Some(Some(dir)) => {
                let dir = match &run.cwd {
                    _ if Path::new(&dir).is_absolute() => PathBuf::from(&dir),
                    Some(c) => c.join(&dir),
                    None => return true,
                };
                real(&dir) == installed
            }
        }
    }

    /// A `kill` of the hub's process or its group, the hub's PID read from its socket's peer.
    fn kills_hub(&self) -> Option<Hit> {
        let kills: Vec<&Run> = self.runs.iter().filter(|r| r.is("kill")).collect();
        let targets: Vec<(&Run, i64)> = kills
            .iter()
            .flat_map(|r| pids(r).into_iter().map(move |p| (*r, p)))
            .collect();
        if targets.is_empty() {
            return None;
        }
        let hub = peer_pid(&self.hub)?;
        let group = pgid(hub);
        targets
            .iter()
            .find(|(_, p)| *p == hub || (*p < 0 && Some(-*p) == group))
            .map(|(run, _)| Hit {
                detail: Some(format!(
                    "Process {hub} is the hub. It runs: {}",
                    command_of(run)
                )),
            })
    }

    fn effect(&self, class: &str) -> Option<Hit> {
        let found = match class {
            "cloud-resource" => self.runs.iter().find(|r| creates_cloud(r)),
            "dependency" => self.runs.iter().find(|r| adds_dependency(r)),
            "service" => self.runs.iter().find(|r| starts_service(r)),
            "unknown-reach-delete" => self.runs.iter().find(|r| unknown_reach(r)),
            "push" => self
                .runs
                .iter()
                .find(|r| r.is("git") && git_rest(r).first().map(String::as_str) == Some("push")),
            "merge" => self.runs.iter().find(|r| gh(r, &[&["pr", "merge"]])),
            "dispatch" => self.runs.iter().find(|r| dispatch(r).is_some()),
            "send" => self.runs.iter().find(|r| {
                gh(
                    r,
                    &[&["pr", "comment"], &["issue", "comment"], &["pr", "review"]],
                )
            }),
            "delete" => self.runs.iter().find(|r| {
                gh(
                    r,
                    &[
                        &["repo", "delete"],
                        &["release", "delete"],
                        &["issue", "delete"],
                    ],
                )
            }),
            "top-level-folder" => {
                let root = checkout(self.cwd.as_deref()?)?.root;
                let new = self.writes.iter().zip(&self.by.0).find_map(|(w, by)| {
                    let rest = real(w).strip_prefix(&root).ok()?.to_path_buf();
                    let top = rest.components().next()?;
                    let folder = root.join(top);
                    let mkdir = by.is_some_and(|(r, _)| self.runs[r].is("mkdir"));
                    // A file written at the top is not a folder; a folder already there is not new.
                    (rest.components().count() > 1 || mkdir)
                        .then_some(folder)
                        .filter(|f| !f.exists())
                })?;
                return Some(Hit {
                    detail: Some(format!("It makes the top-level folder {}.", new.display())),
                });
            }
            _ => None,
        };
        found.map(|run| {
            let detail = if class == "unknown-reach-delete" {
                let why = if run.scripted {
                    "a script file runs it"
                } else {
                    "what it names is a pattern or a value the line can't know"
                };
                format!(
                    "What it deletes can't be worked out before it runs: {why}. It runs: {}",
                    command_of(run)
                )
            } else {
                format!("It runs: {}", command_of(run))
            };
            Hit {
                detail: Some(detail),
            }
        })
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

/// The run as one command line, as a person would type it.
fn command_of(run: &Run) -> String {
    let mut line = vec![run.program.clone()];
    line.extend(run.words().iter().map(|w| quote(w)));
    line.join(" ")
}

/// A match on a run, naming it: the command for you to run yourself, if you mean it.
fn runs_it(run: &Run) -> Hit {
    Hit {
        detail: Some(format!("It runs: {}", command_of(run))),
    }
}

/// The words that aren't options, in order.
fn plain<'a>(words: &[&'a str]) -> Vec<&'a str> {
    words
        .iter()
        .copied()
        .filter(|w| !w.starts_with('-'))
        .collect()
}

fn stops_service(run: &Run) -> bool {
    let words = run.words();
    let sub = plain(&words).first().copied().unwrap_or("");
    let names = |name: &str| words.iter().any(|w| w.contains(name));
    (run.is("launchctl")
        && matches!(
            sub,
            "bootout" | "unload" | "stop" | "remove" | "disable" | "kill"
        )
        && names(HUB_LABEL))
        || (run.is("systemctl")
            && matches!(sub, "stop" | "disable" | "kill" | "mask" | "revert")
            && names(HUB_UNIT))
}

/// The PIDs a `kill` names: past its signal options, or every word after `--`; a negative one is a group.
fn pids(run: &Run) -> Vec<i64> {
    let words = run.words();
    let mut out = Vec::new();
    let mut options = true;
    let mut k = 0;
    while k < words.len() {
        let w = words[k];
        if options && w == "--" {
            options = false;
        } else if options && matches!(w, "-s" | "-n") {
            k += 1;
        } else if !(options && w.starts_with('-')) {
            if let Ok(pid) = w.parse() {
                out.push(pid);
            }
        }
        k += 1;
    }
    out
}

/// The PID of the process at the other end of the Unix socket at `path`, by the OS's peer credentials.
fn peer_pid(path: &Path) -> Option<i64> {
    use std::os::fd::AsRawFd;
    let stream = std::os::unix::net::UnixStream::connect(path).ok()?;
    extern "C" {
        fn getsockopt(fd: i32, level: i32, name: i32, value: *mut u8, len: *mut u32) -> i32;
    }
    // macOS: SOL_LOCAL, LOCAL_PEERPID; Linux: SOL_SOCKET, SO_PEERCRED, whose ucred starts with the pid.
    let (level, name) = if cfg!(target_os = "macos") {
        (0, 2)
    } else {
        (1, 17)
    };
    let mut value = [0u8; 12];
    let mut len = value.len() as u32;
    // SAFETY: the buffer outlives the call and `len` says its size.
    let ok = unsafe {
        getsockopt(
            stream.as_raw_fd(),
            level,
            name,
            value.as_mut_ptr(),
            &mut len,
        )
    } == 0;
    let pid = i32::from_ne_bytes([value[0], value[1], value[2], value[3]]);
    (ok && pid > 0).then_some(i64::from(pid))
}

fn pgid(pid: i64) -> Option<i64> {
    extern "C" {
        fn getpgid(pid: i32) -> i32;
    }
    // SAFETY: getpgid only reads its argument.
    let group = unsafe { getpgid(i32::try_from(pid).ok()?) };
    (group > 0).then_some(i64::from(group))
}

/// A command that deletes files git may not restore: rm, unlink, shred, `find -delete`, `git clean`, `rsync --delete`.
/// A delete whose reach can't be worked out before it runs: a script file runs it, or it names a pattern or a value
/// the line can't know.
fn unknown_reach(run: &Run) -> bool {
    deletes(run) && (run.scripted || run.args.iter().any(|a| a.glob || a.text.is_none()))
}

/// The arguments a delete deletes: rm's paths, find's starting points, rsync's destination; git clean's is its folder.
fn targets(run: &Run) -> Vec<&Arg> {
    let mut plain = Vec::new();
    let mut options = true;
    for a in &run.args {
        match a.text.as_deref() {
            Some("--") if options => options = false,
            Some(t) if options && t.starts_with('-') && t.len() > 1 => {}
            _ => plain.push(a),
        }
    }
    if run.is("find") {
        return run
            .args
            .iter()
            .take_while(|a| {
                !a.text
                    .as_deref()
                    .is_some_and(|t| t.starts_with('-') || t == "(" || t == "!")
            })
            .collect();
    }
    if run.is("rsync") {
        return plain.last().copied().into_iter().collect();
    }
    plain
}

fn deletes(run: &Run) -> bool {
    let words = run.words();
    ["rm", "unlink", "shred", "srm"].iter().any(|n| run.is(n))
        || (run.is("find") && words.contains(&"-delete"))
        || (run.is("git") && git_rest(run).first().map(String::as_str) == Some("clean"))
        || (run.is("rsync") && words.iter().any(|w| w.starts_with("--delete")))
}

fn creates_cloud(run: &Run) -> bool {
    let words = run.words();
    let plain = plain(&words);
    let op = |k: usize| plain.get(k).copied().unwrap_or("");
    if run.is("aws") {
        let o = op(1);
        return ["create-", "run-", "allocate-", "request-", "import-"]
            .iter()
            .any(|p| o.starts_with(p))
            || (op(0) == "s3" && o == "mb")
            || matches!(o, "deploy" | "create");
    }
    if run.is("gcloud") || run.is("az") || run.is("doctl") || run.is("eksctl") {
        return plain.iter().any(|w| matches!(*w, "create" | "deploy"));
    }
    (run.is("gsutil") && op(0) == "mb")
        || ((run.is("terraform") || run.is("tofu")) && op(0) == "apply")
        || (run.is("pulumi") && op(0) == "up")
        || ((run.is("cdk") || run.is("sam") || run.is("serverless") || run.is("sls"))
            && op(0) == "deploy")
}

/// A `gh` run whose first two plain words are one of `subs`.
fn gh(run: &Run, subs: &[&[&str]]) -> bool {
    let words = run.words();
    let plain = plain(&words);
    run.is("gh") && subs.iter().any(|s| plain.len() >= 2 && plain[..2] == **s)
}

/// A command that adds a package: one it names, not a reinstall of the lockfile's.
fn adds_dependency(run: &Run) -> bool {
    let words = run.words();
    let plain = plain(&words);
    let named =
        |sub: &[&str]| sub.contains(&plain.first().copied().unwrap_or("")) && plain.len() > 1;
    ((run.is("npm") || run.is("pnpm") || run.is("bun")) && named(&["install", "i", "add"]))
        || (run.is("yarn") && named(&["add"]))
        || ((run.is("pip") || run.is("pip3") || run.is("gem") || run.is("brew"))
            && named(&["install"]))
        || (run.is("uv")
            && (named(&["add"])
                || (plain.first() == Some(&"pip") && plain.get(1) == Some(&"install"))))
        || (run.is("cargo") && named(&["add", "install"]))
        || (run.is("go") && named(&["get", "install"]))
}

/// A command that starts a long-running service.
fn starts_service(run: &Run) -> bool {
    let words = run.words();
    let plain = plain(&words);
    let op = |k: usize| plain.get(k).copied().unwrap_or("");
    ((run.is("docker") || run.is("podman"))
        && (op(0) == "run" || (op(0) == "compose" && op(1) == "up")))
        || (run.is("docker-compose") && op(0) == "up")
        || (run.is("brew") && op(0) == "services" && op(1) == "start")
        || (run.is("systemctl") && matches!(op(0), "start" | "enable"))
        || (run.is("launchctl") && matches!(op(0), "load" | "bootstrap"))
        || (run.is("pm2") && op(0) == "start")
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
        // A database client writes the database it opens.
        "sqlite3" | "sqlite" | "litecli" | "sqlite-utils" | "duckdb" => {
            plain(&["-cmd", "-init", "-separator", "-newline", "-nullvalue"])
                .into_iter()
                .take(1)
                .collect()
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
            (&[], false),
            Some(Path::new("/w")),
            Path::new("/h"),
            Path::new("/h/.deepbuild/hub.sock"),
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
    fn the_floor_reads_what_scope_names_beyond_the_criteria() {
        let home = "write:~/.deepbuild ~/.deepbuild/* !~/.deepbuild/workspaces/*";
        assert!(bash("touch ~/.deepbuild/workspaces/a/f")
            .matches(home)
            .is_none());
        assert!(bash("touch ~/.deepbuild/config.json")
            .matches(home)
            .is_some());
        assert!(
            bash("launchctl unload -w ~/Library/LaunchAgents/com.deepbuild.hub.plist")
                .matches("hub:service")
                .is_some()
        );
        assert!(bash("systemctl --user stop deepbuild-hub.service")
            .matches("hub:service")
            .is_some());
        assert!(bash("launchctl list").matches("hub:service").is_none());
        assert!(bash("docker compose up -d")
            .matches("effect:service")
            .is_some());
        assert!(bash("docker ps").matches("effect:service").is_none());
        assert!(bash("git -C ../shop push origin main")
            .matches("effect:push")
            .is_some());
        assert!(bash("echo 'git push origin main'")
            .matches("effect:push")
            .is_none());
        assert!(bash("git commit -m push").matches("effect:push").is_none());
        assert!(bash("gh pr merge 12 --squash")
            .matches("effect:merge")
            .is_some());
        assert!(bash("gh pr view 12").matches("effect:merge").is_none());
        assert!(bash("gh issue comment 3 --body hi")
            .matches("effect:send")
            .is_some());
        assert!(bash("gh repo delete acme/shop --yes")
            .matches("effect:delete")
            .is_some());
        assert!(bash("gh repo view acme/shop")
            .matches("effect:delete")
            .is_none());
        assert!(bash("rm -rf \"$OUT\"")
            .matches("effect:unknown-reach-delete")
            .is_some());
        assert!(bash("rm -rf out")
            .matches("effect:unknown-reach-delete")
            .is_none());
    }

    #[test]
    fn a_folder_made_at_the_checkouts_top_is_new() {
        let repo = std::env::temp_dir().join(format!("dh317-top-{}", std::process::id()));
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::create_dir_all(repo.join("src")).unwrap();
        let call = |line: &str| {
            Call::new(
                "Bash",
                Some(line),
                (&[], false),
                Some(&repo),
                Path::new("/h"),
                Path::new("/h/s"),
            )
            .matches("effect:top-level-folder")
            .is_some()
        };
        let (made, file, existing) = (
            call("mkdir infra"),
            call("echo x > notes.md && mkdir src/a"),
            call("mkdir src/b"),
        );
        fs::remove_dir_all(&repo).unwrap();
        assert!(made, "mkdir of a new folder at the top is recorded");
        assert!(
            !file,
            "a file at the top, and a folder under an existing one, are not"
        );
        assert!(!existing);
    }

    #[test]
    fn a_patch_writes_the_files_it_names() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n*** Add File: .mcp.json\n+{}\n*** End Patch\n";
        let paths = patched(patch);
        assert_eq!(paths, ["src/a.rs", ".mcp.json"]);
        let call = Call::new(
            "apply_patch",
            None,
            (&paths, false),
            Some(Path::new("/repo")),
            Path::new("/h"),
            Path::new("/h/.deepbuild/hub.sock"),
        );
        assert!(call.matches("write:.mcp.json").is_some());
        assert!(call.matches("write:.claude/settings.json").is_none());
    }
}
