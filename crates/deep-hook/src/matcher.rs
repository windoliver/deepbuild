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
//!   the line can't know, so what it deletes can't be worked out before it runs), `discard-edits` (git discards
//!   uncommitted edits to tracked files: a hard reset, a path checkout or restore, a forced switch, `rm` or
//!   `worktree remove`, `read-tree -u --reset`, `checkout-index -f`, or `--abort` or `--skip` of a merge, rebase,
//!   cherry-pick, revert or am), `drop-stash`
//!   (`git stash drop` or `clear`), or one that needs your authority (#321): `push` (`git push`, `jj git push`,
//!   `sl push`, `gt submit` and its stack forms, and git town's `propose`, `ship` and `sync`, #1523), `pr` (`gh pr
//!   create`, #84, `glab mr create`, `gt submit`, `git town propose`, `sl pr submit`), `merge` (`gh pr merge`, `gh
//!   api` other than a GET on a pull request's merge endpoint, `gh api graphql` with `mergePullRequest` or
//!   `enablePullRequestAutoMerge`, `glab mr merge`, `gt merge`, `git town ship`), `dispatch` (what
//!   `dispatch:workflow` reads), `send` (`gh pr comment`, `gh issue comment`, `gh issue create`, `gh pr review`, or a
//!   `gh api` POST of a comment, a review comment's reply or a review) or `delete` (`gh repo delete`,
//!   `gh release delete`, `gh issue delete`).
//! - `counts:<class>`: the tool counts as `read`, `change`, `send` or `destructive`, by the classes rules.json
//!   holds; a tool they don't list counts as change, and one whose name starts with `delete_` as destructive.
//! - `unread:<effect>`: the reader couldn't read the call whole and it may have that effect class. A call it reads
//!   whole never matches, so a plain push goes on to the authority gate while one nobody can read is denied (#1156).
//!
//! A call the reader couldn't read whole meets every entry it may be one of (#1097): a run whose program the line
//! computes meets a `run:` entry whose argument globs its arguments fit and an `effect:` class whose words they fit,
//! and a run nested past what the reader reads meets every entry. Its hit says what couldn't be read, so a block
//! entry denies it and a watch or warn entry records it with that reason. An unread run never lowers a match.
//!
//! deep-hook reads rules.json as unreadable when an entry's `match` isn't one of these, so an entry newer than
//! deep-hook never fails open.

use std::fs;
use std::path::{Path, PathBuf};

use crate::shell::{self, glob, lexical, real, same_name, Arg, Run, Unread};

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
    "discard-edits",
    "drop-stash",
    "push",
    "pr",
    "merge",
    "dispatch",
    "send",
    "delete",
];

/// How much of a line whose program it computes a match names, in characters.
const LINE: usize = 200;

/// The hub's login service, as `deep hub start` installs it (packages/hub/src/service.ts).
const HUB_LABEL: &str = "com.deepbuild.hub";
const HUB_UNIT: &str = "deepbuild-hub";

/// Whether `line` holds `key`, in any case, with no letter, digit, `_`, `-`, `.` or `/` against either end of it.
fn holds_word(line: &str, key: &str) -> bool {
    let word = |c: char| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '/');
    let (line, key) = (line.to_lowercase(), key.to_lowercase());
    line.match_indices(&key).any(|(at, _)| {
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
        "effect" | "unread" => EFFECTS.contains(&rest),
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
        let shell_tool = tool == "Bash" || tool == "bash";
        let runs = match command.filter(|_| shell_tool) {
            Some(line) => shell::runs(line, cwd, home),
            None => Vec::new(),
        };
        let at = |p: &str| -> Option<PathBuf> {
            let path = Path::new(p);
            if let Some(rest) = p.strip_prefix("~/") {
                // Joined as text, as pi joins it: a further `/` doesn't leave home.
                Some(home.join(rest.trim_start_matches('/')))
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

    /// Whether `pattern` reads this call, or may: what the reader couldn't read of it may be what `pattern` names.
    pub fn matches(&self, pattern: &str) -> Option<Hit> {
        self.reads_whole(pattern).or_else(|| self.may_be(pattern))
    }

    /// A hit on a run the reader couldn't read whole, when what it does know of the run fits `pattern`.
    fn may_be(&self, pattern: &str) -> Option<Hit> {
        let (kind, rest) = pattern.split_once(':')?;
        let fits = |run: &&Run| match run.unread {
            Some(Unread::Depth) => true,
            Some(Unread::Program) if kind == "run" => {
                let wanted: Vec<&str> = rest.split_whitespace().skip(1).collect();
                args_match(run, &wanted)
            }
            Some(Unread::Program) if kind == "effect" || kind == "unread" => programs(rest).iter().any(|p| {
                let known = Run {
                    program: p.to_string(),
                    glob: false,
                    unread: None,
                    ..(*run).clone()
                };
                has_effect(&known, rest)
            }),
            _ => false,
        };
        let run = self.runs.iter().find(fits)?;
        // A line nested that deep is long, and every entry it meets says this: the line is named only for a program
        // the line computes, and only its start.
        let what = match run.unread {
            Some(Unread::Depth) => format!(
                "it nests past what the reader reads, a depth of {} shells, substitutions or evals",
                shell::DEPTH
            ),
            _ => {
                let line = self.command.as_deref().unwrap_or_default();
                let cut = line.char_indices().nth(LINE).map_or(line.len(), |(k, _)| k);
                let more = if cut < line.len() { "…" } else { "" };
                format!(
                    "the line computes the program it runs, in {}{more}",
                    &line[..cut]
                )
            }
        };
        Some(Hit {
            detail: Some(format!(
                "This call couldn't be read: {what}. It may be one this guard holds. Write the command out plainly and it can be read."
            )),
        })
    }

    /// Whether `pattern` reads this call from what the reader read of it.
    fn reads_whole(&self, pattern: &str) -> Option<Hit> {
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
                let program = same_name(words.next()?).to_lowercase();
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
                folders.push(self.path_in(cwd, text));
            }
        }
        Some(outermost(folders))
    }

    /// `text` as the path it is in `cwd`, `~` read as the home folder.
    fn path_in(&self, cwd: &Path, text: &str) -> PathBuf {
        let path = match text.strip_prefix("~/") {
            Some(rest) => self.home.join(rest),
            None if text == "~" => self.home.clone(),
            None => cwd.join(text),
        };
        lexical(&path)
    }

    /// What a run that discards tracked edits reaches, for the hub to copy the edited files under it first (#1294):
    /// the paths it names, or the checkout's root. None when where it works can't be known.
    pub fn edits(&self) -> Option<Vec<PathBuf>> {
        let mut paths: Vec<PathBuf> = Vec::new();
        for run in self.runs.iter().filter(|r| discards(r)) {
            let cwd = git_cwd(run)?;
            let sub = git_rest(run)[0].clone();
            let scoped = matches!(
                sub.as_str(),
                "checkout" | "restore" | "rm" | "checkout-index" | "worktree"
            );
            let named = named_paths(run);
            let exact = |a: &&Arg| {
                a.text
                    .as_deref()
                    .filter(|t| !a.glob && !t.starts_with(':') && !t.contains(['*', '?', '[']))
                    .is_some()
            };
            if scoped
                && !named.is_empty()
                && named.iter().all(exact)
                && !run
                    .words()
                    .iter()
                    .any(|w| w.starts_with("--pathspec-from-file"))
            {
                paths.extend(
                    named
                        .iter()
                        .filter_map(|a| a.text.as_deref())
                        .map(|t| self.path_in(&cwd, t)),
                );
            } else if sub == "worktree" {
                // Which worktree goes can't be read, and this one's root isn't it.
                return None;
            } else {
                paths.push(git_target(run).map_or(cwd, |c| c.root));
            }
        }
        Some(outermost(paths))
    }

    /// The stash a run drops (#1294): the folder it works in, then the entry `drop` names, or none for `clear`, which
    /// drops every entry. None when the folder or the entry can't be known, or when two drops in a line renumber what
    /// the second one names.
    pub fn stash(&self) -> Option<Vec<PathBuf>> {
        let mut drops = self.runs.iter().filter(|r| drops_stash(r));
        let run = drops.next()?;
        if drops.next().is_some() {
            return None;
        }
        let mut reach = vec![git_cwd(run)?];
        let rest = git_rest(run);
        if rest[1] == "drop" {
            let args = &run.args[run.args.len() + 2 - rest.len()..];
            let mut named = args
                .iter()
                .filter(|a| !a.text.as_deref().is_some_and(|t| t.starts_with('-')));
            reach.push(match named.next() {
                Some(a) => PathBuf::from(a.text.as_deref()?),
                None => PathBuf::from("stash@{0}"),
            });
        }
        Some(reach)
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
        if class == "top-level-folder" {
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
        let found = self.runs.iter().find(|r| has_effect(r, class));
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
            } else if class == "discard-edits" || class == "drop-stash" {
                format!("To run it yourself: {}", command_of(run))
            } else if class == "merge" {
                merge_read(run)
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
        let patterns: Vec<String> = patterns.iter().map(|p| same_name(p)).collect();
        forms.iter().any(|form| {
            let text = same_name(&form.to_string_lossy());
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
    let names = |name: &str| words.iter().any(|w| same_name(w).contains(name));
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

/// Whether a run has the effect `class`; top-level-folder is the call's, not a run's.
fn has_effect(run: &Run, class: &str) -> bool {
    match class {
        "cloud-resource" => creates_cloud(run),
        "dependency" => adds_dependency(run),
        "service" => starts_service(run),
        "unknown-reach-delete" => unknown_reach(run),
        "discard-edits" => discards(run),
        "drop-stash" => drops_stash(run),
        "push" => pushes(run),
        "pr" => opens_pr(run),
        "merge" => merges(run),
        "dispatch" => dispatch(run).is_some(),
        "send" => {
            gh(
                run,
                &[
                    &["pr", "comment"],
                    &["issue", "comment"],
                    &["issue", "create"],
                    &["pr", "review"],
                ],
            ) || posts_comment(run)
        }
        "delete" => gh(
            run,
            &[
                &["repo", "delete"],
                &["release", "delete"],
                &["issue", "delete"],
            ],
        ),
        _ => false,
    }
}

/// The programs a run with the effect `class` can be: a run whose program the line computes has it when it would
/// as one of these.
fn programs(class: &str) -> &'static [&'static str] {
    match class {
        "cloud-resource" => &[
            "aws", "gcloud", "az", "doctl", "eksctl", "gsutil", "terraform", "tofu", "pulumi", "cdk", "sam",
            "serverless", "sls",
        ],
        "dependency" => &[
            "npm", "pnpm", "bun", "yarn", "pip", "pip3", "gem", "brew", "uv", "cargo", "go",
        ],
        "service" => &[
            "docker", "podman", "docker-compose", "brew", "systemctl", "launchctl", "pm2",
        ],
        "unknown-reach-delete" => &["rm", "unlink", "shred", "srm", "find", "git", "rsync"],
        "push" => &["git", "jj", "sl", "gt", "git-town"],
        "pr" => &["gh", "glab", "gt", "git", "git-town", "sl"],
        "merge" => &["gh", "glab", "gt", "git", "git-town"],
        "discard-edits" | "drop-stash" => &["git"],
        "dispatch" => &["gh", "curl", "wget"],
        "send" | "delete" => &["gh"],
        _ => &[],
    }
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

/// The paths of `paths` no other one holds: a folder inside another one named goes with it.
fn outermost(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.sort();
    paths.dedup();
    let all = paths.clone();
    paths.retain(|f| !all.iter().any(|g| g != f && f.starts_with(g)));
    paths
}

/// Whether `word` is the long option `long`, or a start of it, which git reads as the option.
fn long(word: &str, long: &str) -> bool {
    word.len() > 2 && long.starts_with(word)
}

/// Whether a word such as `-fq` holds the short option `c`, up to the first letter that takes a value.
fn short(word: &str, c: char) -> bool {
    word.strip_prefix('-')
        .filter(|w| !w.starts_with('-'))
        .is_some_and(|w| {
            w.chars()
                .take_while(|l| !"bBcCsU".contains(*l))
                .any(|l| l == c)
        })
}

/// The folder a git run works in, past its `-C`s; None when the line doesn't say, or it aims at another tree.
fn git_cwd(run: &Run) -> Option<PathBuf> {
    let words = run.words();
    let globals = &words[..words.len() - git_rest(run).len()];
    if run
        .env
        .iter()
        .any(|(n, _)| n == "GIT_DIR" || n == "GIT_WORK_TREE")
        || globals
            .iter()
            .any(|w| w.starts_with("--git-dir") || w.starts_with("--work-tree"))
    {
        return None;
    }
    globals
        .windows(2)
        .filter(|w| w[0] == "-C")
        .fold(run.cwd.clone(), |cwd, w| cwd.map(|c| c.join(w[1])))
}

/// What a `git checkout` or `git restore` names as paths: all that follows `--`, else each word that isn't an option
/// and is on disk, or could be: a branch or a commit is neither.
fn named_paths(run: &Run) -> Vec<&Arg> {
    let args = &run.args[run.args.len() + 1 - git_rest(run).len()..];
    let cut = args.iter().position(|a| a.text.as_deref() == Some("--"));
    if let Some(k) = cut {
        return args[k + 1..].iter().collect();
    }
    let cwd = git_cwd(run);
    let there = |a: &&Arg| match (a.text.as_deref(), &cwd) {
        (Some(t), _) if t.starts_with('-') => false,
        (Some(t), Some(c)) => a.glob || c.join(t).symlink_metadata().is_ok(),
        _ => true,
    };
    args.iter().filter(there).collect()
}

/// Whether a run discards uncommitted edits to tracked files (#1294): a hard reset, a path checkout or restore of the
/// working files, a forced switch, a forced `git rm` or `git worktree remove`, a forced write from the index or a tree,
/// or leaving a merge, rebase, cherry-pick, revert or am by `--abort` or `--skip`, which reset the tree.
fn discards(run: &Run) -> bool {
    if !run.is("git") {
        return false;
    }
    let rest = git_rest(run);
    let Some((sub, options)) = rest.split_first() else {
        return false;
    };
    let before: Vec<&str> = options
        .iter()
        .map(String::as_str)
        .take_while(|w| *w != "--")
        .collect();
    let has = |name: &str, c: char| before.iter().any(|w| long(w, name) || short(w, c));
    match sub.as_str() {
        "reset" => before
            .iter()
            .any(|w| long(w, "--hard") || long(w, "--merge")),
        "switch" => has("--force", 'f') || before.iter().any(|w| long(w, "--discard-changes")),
        "restore" => !has("--staged", 'S') || has("--worktree", 'W'),
        "checkout" => {
            let creates = before
                .iter()
                .any(|w| w.starts_with("-b") || w.starts_with("-B") || long(w, "--orphan"));
            has("--force", 'f')
                || (!creates
                    && (!named_paths(run).is_empty()
                        || has("--patch", 'p')
                        || before.iter().any(|w| w.starts_with("--pathspec-from-file"))))
        }
        "rm" => has("--force", 'f') && !before.iter().any(|w| long(w, "--cached")),
        "checkout-index" => has("--force", 'f'),
        "read-tree" => before.iter().any(|w| long(w, "--reset")) && before.contains(&"-u"),
        "worktree" => before.first() == Some(&"remove") && has("--force", 'f'),
        "merge" | "rebase" | "cherry-pick" | "revert" | "am" => before
            .iter()
            .any(|w| long(w, "--abort") || long(w, "--skip")),
        _ => false,
    }
}

/// Whether a run drops stash entries, with the edits they hold (#1294).
fn drops_stash(run: &Run) -> bool {
    let rest = git_rest(run);
    run.is("git")
        && rest.first().map(String::as_str) == Some("stash")
        && matches!(rest.get(1).map(String::as_str), Some("drop" | "clear"))
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
/// A `gh api` call that posts in your name: a POST (by `--method` or `-X`, or by a field, which makes gh post) to an
/// issue's, a pull request's or a commit's comments, a review comment's replies, or a pull request's reviews (#323).
fn posts_comment(run: &Run) -> bool {
    let words = run.words();
    let plain = plain(&words);
    if !run.is("gh") || plain.first() != Some(&"api") {
        return false;
    }
    api_method(&words) == "POST"
        && plain[1..].iter().any(|w| {
            let path = w
                .trim_start_matches("https://api.github.com")
                .trim_start_matches('/');
            let parts: Vec<&str> = path.split('?').next().unwrap_or("").split('/').collect();
            parts.first() == Some(&"repos")
                && matches!(
                    parts.get(3..).unwrap_or(&[]),
                    ["issues" | "pulls" | "commits", _, "comments"]
                        | ["pulls", _, "reviews"]
                        | ["pulls", _, "comments", _, "replies"]
                )
        })
}

/// The method of a `gh api` call: the one `--method` or `-X` names, or POST once a field or `--input` makes gh post,
/// else GET.
fn api_method(words: &[&str]) -> String {
    let method = words.iter().enumerate().find_map(|(k, w)| match *w {
        "-X" | "--method" => words.get(k + 1).copied(),
        _ => w
            .strip_prefix("--method=")
            .or(w.strip_prefix("-X"))
            .filter(|m| !m.is_empty() && !m.starts_with('-')),
    });
    match method {
        Some(m) => m.to_uppercase(),
        None if !fields(words).is_empty() || words.contains(&"--input") => "POST".into(),
        None => "GET".into(),
    }
}

/// A run's subcommand and what follows it, past the global options its program takes before one: git's, jj's,
/// sl's, gt's, glab's and git town's. `git town` reads as git-town.
fn sub(run: &Run) -> (&'static str, Vec<&str>) {
    const TOOLS: &[(&str, &[&str])] = &[
        ("git", GIT_VALUED),
        ("jj", &["-R", "--repository", "--at-op", "--at-operation", "--config", "--config-file", "--color"]),
        ("sl", &["-R", "--repository", "--cwd", "--config"]),
        ("gt", &["--cwd"]),
        ("glab", &["-R", "--repo"]),
        ("git-town", &[]),
    ];
    let Some((name, valued)) = TOOLS.iter().find(|(name, _)| run.is(name)) else {
        return ("", Vec::new());
    };
    let rest = past(&run.words(), valued);
    match (*name, rest.first()) {
        ("git", Some(&"town")) => ("git-town", rest[1..].to_vec()),
        _ => (name, rest),
    }
}

/// A push by any of the tools that push: `git push`, `jj git push`, `sl push`, `gt submit` and its stack forms, and
/// git town's commands that push.
fn pushes(run: &Run) -> bool {
    match sub(run) {
        ("git", rest) => rest.first() == Some(&"push"),
        ("jj", rest) => rest.starts_with(&["git", "push"]),
        ("sl", rest) => rest.first() == Some(&"push"),
        _ => submits(run) || town(run, &["propose", "new-pull-request", "ship", "sync"]),
    }
}

/// What opens a pull request: `gh pr create`, `glab mr create`, `gt submit`, `git town propose`, `sl pr submit`.
fn opens_pr(run: &Run) -> bool {
    gh(run, &[&["pr", "create"]])
        || submits(run)
        || town(run, &["propose", "new-pull-request"])
        || match sub(run) {
            ("glab", rest) => rest.starts_with(&["mr", "create"]) || rest.starts_with(&["mr", "new"]),
            ("sl", rest) => rest.starts_with(&["pr", "submit"]),
            _ => false,
        }
}

/// `gt submit` and its stack forms, which push the stack's branches and open or update their pull requests.
fn submits(run: &Run) -> bool {
    let ("gt", rest) = sub(run) else { return false };
    let submit = |w: Option<&&str>| matches!(w, Some(&"submit" | &"s"));
    submit(rest.first())
        || rest.first() == Some(&"ss")
        || matches!(
            rest.first(),
            Some(&"stack" | &"upstack" | &"us" | &"downstack" | &"ds" | &"branch" | &"b")
        ) && submit(rest.get(1))
}

/// A git town command among `commands`, as `git town <command>` or `git-town <command>`.
fn town(run: &Run, commands: &[&str]) -> bool {
    matches!(sub(run), ("git-town", rest) if rest.first().is_some_and(|c| commands.contains(c)))
}

/// A merge by any of the tools that merge, and a GraphQL mutation that merges or arms one.
fn merges(run: &Run) -> bool {
    gh(run, &[&["pr", "merge"]])
        || merge_endpoint(run).is_some_and(|_| api_method(&run.words()) != "GET")
        || graphql_merge(run).is_some()
        || gt_merge(run)
        || town(run, &["ship"])
        || matches!(sub(run), ("glab", rest) if rest.starts_with(&["mr", "merge"]) || rest.starts_with(&["mr", "accept"]))
}

fn gt_merge(run: &Run) -> bool {
    matches!(sub(run), ("gt", rest) if rest.first() == Some(&"merge"))
}

/// The query of a `gh api graphql` call that merges or arms a merge, with its fields.
fn graphql_merge(run: &Run) -> Option<(String, Vec<(String, String)>)> {
    let words = run.words();
    if !run.is("gh") || !plain(&words).starts_with(&["api", "graphql"]) {
        return None;
    }
    let fields = fields(&words);
    let query = fields.iter().find(|(k, _)| k == "query")?.1.clone();
    (holds_word(&query, "mergePullRequest") || holds_word(&query, "enablePullRequestAutoMerge"))
        .then_some((query, fields))
}

/// A GraphQL input's literal value for `name`, or the field a `$variable` in its place names.
fn graphql_value(query: &str, fields: &[(String, String)], name: &str) -> Option<String> {
    let at = query.find(name)? + name.len();
    let rest = query[at..].trim_start().strip_prefix(':')?.trim_start();
    if let Some(var) = rest.strip_prefix('$') {
        let var: String = var.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        return fields.iter().find(|(k, _)| *k == var).map(|(_, v)| v.clone());
    }
    let value = rest.strip_prefix('"')?;
    value.find('"').map(|end| value[..end].to_string())
}

fn gh(run: &Run, subs: &[&[&str]]) -> bool {
    let words = run.words();
    let plain = plain(&words);
    run.is("gh") && subs.iter().any(|s| plain.len() >= 2 && plain[..2] == **s)
}

/// The word of `gh api` naming a pull request's merge endpoint, `repos/<owner>/<repo>/pulls/<n>/merge`.
fn merge_endpoint<'a>(run: &'a Run) -> Option<&'a str> {
    if !run.is("gh") {
        return None;
    }
    let words = run.words();
    let at = words.iter().position(|w| !w.starts_with('-'))?;
    if words[at] != "api" {
        return None;
    }
    words[at + 1..].iter().copied().find(|w| {
        let parts: Vec<&str> = w.trim_matches('/').split('/').collect();
        parts.len() >= 3
            && parts[parts.len() - 1] == "merge"
            && parts[parts.len() - 3] == "pulls"
            && parts[parts.len() - 2].parse::<u64>().is_ok()
    })
}

/// What a merge names, as the hub reads it from the entry's note (#84): `merge pr=12 head=<sha> auto disable blind`,
/// each part only when the call has it. One commit, for `--match-head-commit`, the API's `sha` field, GraphQL's
/// `expectedHeadOid` or `glab mr merge --sha`; `blind` for `gt merge` and `git town ship`, which can't name one.
fn merge_read(run: &Run) -> String {
    let words = run.words();
    let value = |flag: &str| {
        words.iter().enumerate().find_map(|(k, w)| {
            w.strip_prefix(&format!("{flag}=")).or_else(|| (*w == flag).then(|| words.get(k + 1).copied()).flatten())
        })
    };
    let (sub_name, rest) = sub(run);
    let (pr, head, auto) = if let Some(path) = merge_endpoint(run) {
        let pr = path.trim_matches('/').rsplit('/').nth(1).map(str::to_string);
        (pr, words.iter().find_map(|w| w.strip_prefix("sha=")).map(str::to_string), false)
    } else if let Some((query, fields)) = graphql_merge(run) {
        let auto = holds_word(&query, "enablePullRequestAutoMerge");
        (graphql_value(&query, &fields, "pullRequestId"), graphql_value(&query, &fields, "expectedHeadOid"), auto)
    } else if sub_name == "glab" {
        (plain(&rest).get(2).map(|p| p.to_string()), value("--sha").map(str::to_string), false)
    } else {
        let pr = plain(&words).get(2).map(|p| p.to_string());
        (pr, value("--match-head-commit").map(str::to_string), false)
    };
    if gt_merge(run) || town(run, &["ship"]) {
        return "merge blind".into();
    }
    let mut read = String::from("merge");
    if let Some(pr) = pr {
        read.push_str(&format!(" pr={pr}"));
    }
    if let Some(head) = head {
        read.push_str(&format!(" head={head}"));
    }
    if auto || words.contains(&"--auto") {
        read.push_str(" auto");
    }
    if words.contains(&"--disable-auto") {
        read.push_str(" disable");
    }
    read
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
            // A word may be a path, read as the Mac reads it; an option's case is its meaning.
            plain
                .next()
                .is_some_and(|w| glob(same_name(want).as_bytes(), same_name(w).as_bytes()))
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

/// git's global options that take a value.
const GIT_VALUED: &[&str] = &[
    "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env", "--super-prefix",
];

/// The words past the leading options, skipping the value of each option in `valued`.
fn past<'a>(words: &[&'a str], valued: &[&str]) -> Vec<&'a str> {
    let mut k = 0;
    while k < words.len() && words[k].starts_with('-') {
        k += if valued.contains(&words[k]) { 2 } else { 1 };
    }
    words[k.min(words.len())..].to_vec()
}

/// git's subcommand and what follows it, past its global options.
fn git_rest(run: &Run) -> Vec<String> {
    past(&run.words(), GIT_VALUED).iter().map(|w| w.to_string()).collect()
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
    fn unread_matches_only_a_call_the_reader_couldnt_read_whole() {
        assert!(known("unread:push") && !known("unread:nothing"));
        let hit = bash("\"$(printf git)\" push origin main").matches("unread:push").unwrap();
        assert!(hit.detail.unwrap().contains("couldn't be read"));
        assert!(bash("git push origin main").matches("unread:push").is_none());
        assert!(bash("\"$CC\" -o app main.c").matches("unread:push").is_none());
    }

    #[test]
    fn a_call_read_in_part_meets_the_entries_it_may_be() {
        for line in [
            "\"$(printf git)\" push origin main",
            "\"$G\" push origin main",
        ] {
            let hit = bash(line).matches("effect:push").expect(line);
            assert!(hit.detail.unwrap().contains("couldn't be read"));
            assert!(bash(line).matches("run:git push").is_some(), "{line}");
            assert!(bash(line).matches("effect:merge").is_none(), "{line}");
        }
        let cc = bash("\"$CC\" -o app main.c");
        for pattern in ["effect:push", "run:git push", "effect:unknown-reach-delete", "effect:cloud-resource"] {
            assert!(cc.matches(pattern).is_none(), "{pattern}");
        }
        assert!(bash("\"$X\" pr merge 12").matches("effect:merge").is_some());
        assert!(bash("\"$X\" -rf \"$OUT\"/*")
            .matches("effect:unknown-reach-delete")
            .is_some());
        let nest = |n: usize| {
            let mut line = "pkill node".to_string();
            for _ in 0..n {
                line = format!("sh -c {}", quote(&line));
            }
            bash(&line)
        };
        let read = nest(shell::DEPTH).matches("kill:by-name").unwrap();
        assert!(read.detail.is_none());
        let deep = nest(shell::DEPTH + 1).matches("kill:by-name").unwrap();
        assert!(deep.detail.unwrap().contains("nests"));
        assert!(nest(shell::DEPTH + 1).matches("run:deep off").is_some());
    }

    #[test]
    fn a_word_is_whole_and_no_part_of_a_path() {
        let m = "word:kafka";
        assert!(bash("npm install kafka").matches(m).is_some());
        assert!(bash("npm install Kafka").matches(m).is_some());
        assert!(bash("npm install kafka-lite").matches(m).is_none());
        assert!(bash("cat src/kafka/a.ts").matches(m).is_none());
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

    /// Paths under a folder that isn't there, so nothing resolves them on disk.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_name_the_mac_takes_for_a_guarded_one_is_guarded() {
        let m = "write:.deepbuild/* ~/.deepbuild/* !~/.deepbuild/workspaces/*";
        for line in [
            "echo x > /nowhere/.DEEPBUILD/done.yaml",
            "echo x > /nowhere/.DeepBuild/done.yaml",
            "echo x > /nowhere/.deepbuild/ſpec.md",
            "echo x > /nowhere/.deepbuild/\u{212A}ey",
            "echo x > /nowhere/.deepbuild/ﬁle",
            "echo x > /H/.DEEPBUILD/config.json",
        ] {
            assert!(bash(line).matches(m).is_some(), "{line}");
        }
        assert!(bash("echo x > /H/.deepbuild/WORKSPACES/a")
            .matches(m)
            .is_none());
        let ss = "write:.pi/settings.json";
        assert!(bash("echo x > /nowhere/.PI/SETTINGS.json")
            .matches(ss)
            .is_some());
        assert!(bash("echo x > /nowhere/.pi/settingſ.json")
            .matches(ss)
            .is_some());
        assert!(bash("echo x > /nowhere/.deepbuild/a")
            .matches("write:.DeepBuild/a")
            .is_some());
        assert!(
            bash("launchctl unload ~/Library/LaunchAgents/COM.DEEPBUILD.HUB.plist")
                .matches("hub:service")
                .is_some()
        );
        assert!(bash("ſed -i '' s/a/b/ .deepbuild/a")
            .matches("write:.deepbuild/a")
            .is_some());
        assert!(bash("baſh -c 'pkill x'").matches("run:pkill").is_some());
        let sharp = "write:.deepbuild/pass";
        assert!(bash("echo x > /nowhere/.deepbuild/paß")
            .matches(sharp)
            .is_some());
        assert!(bash("echo x > /nowhere/.deepbuild/other")
            .matches(sharp)
            .is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn each_letter_that_folds_to_ascii_reads_as_its_fold() {
        for (guarded, spelled) in [
            ("sa", "ſa"),
            ("ka", "\u{212A}a"),
            ("ssa", "ßa"),
            ("ssb", "ẞb"),
            ("ffa", "ﬀa"),
            ("fia", "ﬁa"),
            ("fla", "ﬂa"),
            ("ffia", "ﬃa"),
            ("ffla", "ﬄa"),
            ("sta", "ﬅa"),
            ("stb", "ﬆb"),
        ] {
            let m = format!("write:/nowhere/{guarded}");
            assert!(
                bash(&format!("echo x > /nowhere/{spelled}"))
                    .matches(&m)
                    .is_some(),
                "{spelled}"
            );
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_script_whose_interpreter_the_mac_finds_is_read() {
        let folder = std::env::temp_dir().join(format!("dh863-script-{}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        for (name, first) in [("upper", "#!/BIN/BASH"), ("fold", "#!/bin/baſh")] {
            let script = folder.join(name);
            fs::write(&script, format!("{first}\npkill x\n")).unwrap();
            assert!(
                bash(&script.to_string_lossy())
                    .matches("run:pkill")
                    .is_some(),
                "{first}"
            );
        }
        fs::remove_dir_all(&folder).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_link_a_program_and_its_arguments_read_as_the_mac_reads_them() {
        assert!(bash("ln -s ~/.deepbuild/config.json l; echo x > L")
            .matches("write:.deepbuild/config.json")
            .is_some());
        assert!(bash("cat .DEEPBUILD/secret")
            .matches("run:cat .deepbuild/secret")
            .is_some());
        assert!(bash("rm -R a").matches("run:rm -r").is_none());
        assert!(bash("ſed x").matches("run:ſed").is_some());
        assert!(bash("weiß x").matches("run:weiß").is_some());
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
        assert!(bash(
            "gh api --method POST repos/acme/shop/pulls/23/comments/9101/replies -f body='Fixed.'"
        )
        .matches("effect:send")
        .is_some());
        assert!(bash("gh api repos/acme/shop/issues/3/comments -f body=hi")
            .matches("effect:send")
            .is_some());
        assert!(bash("gh api repos/acme/shop/pulls/23/comments")
            .matches("effect:send")
            .is_none());
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
    fn push_pr_and_merge_read_every_tools_spelling() {
        let has = |line: &str, class: &str| bash(line).matches(&format!("effect:{class}")).is_some();
        let q = "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_1\", expectedHeadOid: \"abc1234\"}) { clientMutationId } }'";
        for (line, classes) in [
            ("jj git push --bookmark main", &["push"][..]),
            ("jj -R ../shop git push", &["push"]),
            ("sl push --to main", &["push"]),
            ("gt submit --stack", &["push", "pr"]),
            ("gt ss", &["push", "pr"]),
            ("gt stack submit", &["push", "pr"]),
            ("git town propose", &["push", "pr"]),
            ("git-town sync", &["push"]),
            ("git town ship", &["push", "merge"]),
            ("sl pr submit", &["pr"]),
            ("glab mr create --fill", &["pr"]),
            ("glab mr merge 3", &["merge"]),
            ("gt merge", &["merge"]),
            (q, &["merge"]),
            ("gh api -X PUT repos/acme/shop/pulls/3/merge", &["merge"]),
            ("gh issue create -t x", &["send"]),
        ] {
            for class in ["push", "pr", "merge", "send"] {
                assert_eq!(has(line, class), classes.contains(&class), "{line} as {class}");
            }
        }
        for line in [
            "jj log",
            "jj git fetch",
            "jj describe -m 'git push'",
            "gt log",
            "git town status",
            "sl log",
            "glab mr view 3",
            "gh api repos/acme/shop/pulls/3",
            "gh api repos/acme/shop/pulls/3/merge",
            "gh api --method GET repos/acme/shop/pulls/3/merge",
            "gh api graphql -f query='{ repository(owner: \"a\", name: \"b\") { id } }'",
        ] {
            for class in ["push", "pr", "merge", "send"] {
                assert!(!has(line, class), "{line} as {class}");
            }
        }
        let read = |line: &str| bash(line).matches("effect:merge").unwrap().detail.unwrap();
        assert_eq!(read(q), "merge pr=PR_1 head=abc1234");
        assert_eq!(
            read("gh api graphql -f query='mutation($h: GitObjectID) { enablePullRequestAutoMerge(input: {pullRequestId: \"PR_1\", expectedHeadOid: $h}) { clientMutationId } }' -f h=abc1234"),
            "merge pr=PR_1 head=abc1234 auto"
        );
        assert_eq!(read("glab mr merge 3 --sha abc1234"), "merge pr=3 head=abc1234");
        assert_eq!(read("gt merge"), "merge blind");
        assert_eq!(read("git town ship"), "merge blind");
        let unread = bash("\"$(printf jj)\" git push").matches("unread:push").unwrap();
        assert!(unread.detail.unwrap().contains("printf jj"));
        assert!(bash("\"$(printf gh)\" issue create -t x").matches("effect:send").is_some());
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

    #[test]
    fn a_discard_is_read_by_its_effect_and_a_move_of_the_work_is_not() {
        let discards = |line: &str| bash(line).matches("effect:discard-edits").is_some();
        for line in [
            "git reset --hard HEAD~2",
            "git reset --har",
            "git reset --merge",
            "git checkout -f main",
            "git checkout -- src/a.ts",
            "git checkout HEAD~1 -- src/a.ts",
            "git checkout \"$BRANCH\"",
            "git restore src/a.ts",
            "git restore -SW src/a.ts",
            "git restore --source=HEAD~1 src/a.ts",
            "git switch --discard-changes main",
            "git switch -fq main",
            "git rm -f src/a.ts",
            "git rm -rf src",
            "git checkout-index -a -f",
            "git read-tree -u --reset HEAD",
            "git worktree remove --force /w2",
            "git merge --abort",
            "git rebase --abort",
            "git rebase --skip",
            "git cherry-pick --abort",
            "git revert --abort",
            "git am --abort",
        ] {
            assert!(discards(line), "{line}");
        }
        for line in [
            "git reset --soft HEAD~1",
            "git reset HEAD src/a.ts",
            "git checkout -- ",
            "git checkout -b fix -- ",
            "git restore --staged src/a.ts",
            "git restore -S src/a.ts",
            "git switch main",
            "git switch -c fix",
            "git switch -cfix",
            "git log --hard",
            "echo git reset --hard",
            "git rm src/a.ts",
            "git rm -f --cached src/a.ts",
            "git checkout-index -a",
            "git read-tree HEAD",
            "git worktree remove /w2",
            "git worktree add -f /w2",
            "git merge --continue",
            "git rebase --continue",
            "git rebase --quit",
        ] {
            assert!(!discards(line), "{line}");
        }
    }

    #[test]
    fn a_discard_reaches_its_paths_or_the_whole_tree() {
        let edits = |line: &str| {
            bash(line).edits().map(|p| {
                p.iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(
            edits("git checkout -- src/a.ts src"),
            Some(vec!["/w/src".to_string()])
        );
        assert_eq!(edits("git restore -- '*.ts'"), Some(vec!["/w".to_string()]));
        assert_eq!(
            edits("git -C sub restore -- a.ts"),
            Some(vec!["/w/sub/a.ts".to_string()])
        );
        // The line doesn't say where it works, or aims git at another tree: nothing can be listed.
        assert_eq!(edits("cd \"$REPO\" && git reset --hard"), None);
        assert_eq!(edits("git --work-tree=/x reset --hard"), None);
        assert_eq!(edits("GIT_DIR=/x/.git git reset --hard"), None);
        assert_eq!(
            edits("git rm -f -- src/a.ts"),
            Some(vec!["/w/src/a.ts".to_string()])
        );
        assert_eq!(edits("git merge --abort"), Some(vec!["/w".to_string()]));
        assert_eq!(
            edits("git worktree remove -f -- /w2"),
            Some(vec!["/w2".to_string()])
        );
        assert_eq!(edits("git worktree remove -f \"$TREE\""), None);
    }

    #[test]
    fn a_stash_drop_names_its_entry() {
        let stash = |line: &str| {
            bash(line).stash().map(|p| {
                p.iter()
                    .map(|p| p.display().to_string())
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(
            stash("git stash drop -q stash@{1}"),
            Some(vec!["/w".to_string(), "stash@{1}".to_string()])
        );
        assert_eq!(
            stash("git stash drop"),
            Some(vec!["/w".to_string(), "stash@{0}".to_string()])
        );
        assert_eq!(stash("git stash clear"), Some(vec!["/w".to_string()]));
        assert_eq!(stash("git stash drop \"$E\""), None);
        // The second drop's stash@{0} is the first one's stash@{1}.
        assert_eq!(stash("git stash drop && git stash drop"), None);
    }
}
