//! Issue #326: the one Set up click. It runs the same steps as `deep setup` (the hooks in watch-only mode, the
//! safety rules, the hub at login) and says so in one line. The first launch's button and `deep-app --set-up` both
//! call [`set_up`]; the button through [`start`], so the window keeps drawing while it runs (#1556). Issue #41: an app
//! opened from Finder has launchd's short PATH, so Set up reads your login shell's PATH once and runs `deep` from it,
//! else the checkout's CLI, and names a login shell it can't read.
//!
//! Issue #1100: before the click, the screen names what setup will do here from the one list `deep setup` runs,
//! `contracts/setup-steps.json`: a row per agent it finds, the history it reads, and how to take it back. While it
//! runs, each row says done as its step ends; a setup that stops keeps the button with its reason and fix in one line.

use std::{
    cell::Cell,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        mpsc::{self, Receiver},
        OnceLock,
    },
    time::{Duration, Instant, SystemTime},
};

use serde_json::Value;

/// A row of setup's one list (#1100), as packages/hub/src/setup-steps.ts reads it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub step: String,
    /// The agent the step changes; none for the history, which reads every agent's.
    pub agent: Option<String>,
    pub name: Option<String>,
    /// The box's words that take this agent's part back out (#1998), where the box has them.
    pub words: Option<String>,
    found: Found,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Found {
    Always,
    /// A home folder, an environment variable naming it first.
    Home {
        env: String,
        folder: String,
    },
    /// A program on your login shell's PATH, and its home folder where the row names one.
    Program(String, Option<String>),
}

impl Step {
    /// Its key, `<step>:<agent>`, as setup's stop record and the screen's nodes name it.
    pub fn key(&self) -> String {
        match &self.agent {
            Some(agent) => format!("{}:{agent}", self.step),
            None => self.step.clone(),
        }
    }
}

/// Every row of the list, in the order setup runs them.
fn list() -> &'static [Step] {
    static LIST: OnceLock<Vec<Step>> = OnceLock::new();
    LIST.get_or_init(|| {
        let list: Value = serde_json::from_str(include_str!("../../../contracts/setup-steps.json"))
            .expect("contracts/setup-steps.json is JSON");
        let text = |row: &Value, key: &str| row[key].as_str().map(str::to_owned);
        list["steps"]
            .as_array()
            .expect("contracts/setup-steps.json holds a steps array")
            .iter()
            .map(|row| Step {
                step: text(row, "step").unwrap_or_default(),
                agent: text(row, "agent"),
                name: text(row, "name"),
                words: text(row, "box"),
                found: match (&row["found"], text(&row["found"], "program")) {
                    (found, Some(program)) => Found::Program(program, text(found, "folder")),
                    (found, None) if found.is_object() => Found::Home {
                        env: text(found, "env").unwrap_or_default(),
                        folder: text(found, "folder").unwrap_or_default(),
                    },
                    _ => Found::Always,
                },
            })
            .collect()
    })
}

/// Your login shell's PATH, read once off the UI thread for the rows found on it; until then, the app's own.
fn search_path() -> String {
    static LOGIN: OnceLock<String> = OnceLock::new();
    static READING: OnceLock<()> = OnceLock::new();
    if let Some(path) = LOGIN.get() {
        return path.clone();
    }
    READING.get_or_init(|| {
        let _ = std::thread::Builder::new()
            .name("login PATH".into())
            .spawn(|| {
                let _ = LOGIN.set(
                    login_path().unwrap_or_else(|_| std::env::var("PATH").unwrap_or_default()),
                );
            });
    });
    std::env::var("PATH").unwrap_or_default()
}

/// The rows setup will run in this home, each with whether its step is done, as the stop record keeps them.
fn read_plan() -> Vec<(Step, bool)> {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let path = search_path();
    let done: Vec<String> = std::fs::read_to_string(crate::hub::root().join("setup-stopped.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|kept| serde_json::from_value(kept["done"].clone()).ok())
        .unwrap_or_default();
    list()
        .iter()
        .filter(|row| match &row.found {
            Found::Always => true,
            Found::Home { env, folder } => std::env::var_os(env)
                .filter(|named| !named.is_empty())
                .map_or_else(|| home.join(folder), PathBuf::from)
                .exists(),
            Found::Program(program, folder) => {
                find(&path, program).is_some()
                    && folder
                        .as_ref()
                        .is_none_or(|folder| home.join(folder).exists())
            }
        })
        .map(|row| (row.clone(), done.contains(&row.key())))
        .collect()
}

/// What the first-launch screen says above Set up (#1100): a row per agent setup finds here, a mark per step of its,
/// done or not yet, and at most three lines from the same rows: what it changes, what it never does and how to take
/// it back.
/// An agent setup changes: its id, its name and its steps, each `<step>:<agent>` with whether it's done.
pub type Agent = (String, String, Vec<(String, bool)>);

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Screen {
    pub agents: Vec<Agent>,
    /// Each line, `adds`, `never` and `undo`, with its words.
    pub lines: Vec<(&'static str, String)>,
}

/// What a hook means, as the One word per idea table says it (docs/canvas-primitives.md): the screen says it beside
/// the word.
pub const HOOK_MEANS: &str =
    "A command an agent runs at set points of its work, which tells DeepBuild what the agent is doing";

/// "A", "A and B", "A, B and C".
fn listed(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// The screen for these rows.
pub fn screen_of(plan: &[(Step, bool)]) -> Screen {
    let agents: Vec<Agent> = plan
        .iter()
        .filter_map(|(row, _)| Some((row.agent.clone()?, row.name.clone()?)))
        .map(|(agent, name)| {
            let steps = plan
                .iter()
                .filter(|(row, _)| row.agent.as_ref() == Some(&agent))
                .map(|(row, done)| (row.key(), *done))
                .collect();
            (agent, name, steps)
        })
        .collect();
    let names: Vec<String> = agents.iter().map(|(_, name, _)| name.clone()).collect();
    let history = plan.iter().any(|(row, _)| row.step == "history");
    let words: Vec<String> = plan
        .iter()
        .filter_map(|(row, _)| row.words.as_ref().map(|words| format!("“{words}”")))
        .collect();
    let undo = if words.is_empty() {
        "To take it back, run deep setup --undo.".to_owned()
    } else {
        format!(
            "To take it back, say {} in the box, or run deep setup --undo.",
            words.join(" or ")
        )
    };
    let reads = if history {
        " and reads their history into the wiki, read by your own agent, on your plan"
    } else {
        ""
    };
    Screen {
        lines: vec![
            (
                "adds",
                format!(
                    "Adds hooks to {}{reads}. A hook is {}{}.",
                    listed(&names),
                    HOOK_MEANS[..1].to_lowercase(),
                    &HOOK_MEANS[1..]
                ),
            ),
            (
                "never",
                "Never reads credential files, signs in or sends your code anywhere.".to_owned(),
            ),
            ("undo", undo),
        ],
        agents,
    }
}

/// What the first-launch screen says now: read by [`refresh`], never by a frame.
pub fn screen() -> Screen {
    disk();
    let plan = PLAN.with(|plan| plan.borrow().clone());
    // #1100's planted screen is built from a written list, which names pi, not from setup's.
    let plan = if crate::plain::planted("first-launch-written-list") {
        written(&plan)
    } else {
        plan
    };
    let mut screen = screen_of(&plan);
    for (id, line) in &mut screen.lines {
        // #1100's planted lines: a route that doesn't exist, a term with no gloss and a promise setup can't keep.
        let planted = match *id {
            "undo" => "undo-line-missing-route",
            "adds" => "first-launch-pretooluse",
            _ => "first-launch-nothing-leaves",
        };
        if crate::plain::planted(planted) {
            *line = match *id {
                "undo" => "To take it back, run deep uninstall.",
                "adds" => "It adds PreToolUse hooks to Claude Code and Codex.",
                _ => "Nothing leaves this Mac.",
            }
            .to_owned();
        }
    }
    screen
}

/// #1100's planted written list: Claude Code, Codex and pi, each with the same steps, whatever this machine has.
fn written(plan: &[(Step, bool)]) -> Vec<(Step, bool)> {
    let row = |step: &str, agent: &str, name: Option<&str>| {
        let row = Step {
            step: step.into(),
            agent: Some(agent.into()),
            name: name.map(str::to_owned),
            words: None,
            found: Found::Always,
        };
        let done = plan
            .iter()
            .any(|(kept, done)| *done && kept.key() == row.key());
        (row, done)
    };
    let agents = [
        ("claude-code", "Claude Code"),
        ("codex", "Codex"),
        ("pi", "pi"),
    ];
    let hooks = agents
        .iter()
        .map(|(agent, name)| row("hooks", agent, Some(name)));
    let history = agents.iter().map(|(agent, _)| row("history", agent, None));
    hooks.chain(history).collect()
}

/// How long the login shell has to print its PATH, as packages/hub/src/setup.ts gives it.
const LOGIN_SHELL_WAIT: Duration = Duration::from_secs(5);

#[cfg(feature = "fixtures")]
thread_local! {
    /// A replica has no machine to set up: its record stands for one that finished.
    static ASSUMED: Cell<bool> = const { Cell::new(false) };
}

/// A replica's door, in no shipped build (#1457).
#[cfg(feature = "fixtures")]
pub fn assume_finished() {
    ASSUMED.with(|assumed| assumed.set(true));
}

/// A replica on a machine whose setup hasn't finished (#1461): the first-launch window. In no shipped build (#1457).
#[cfg(feature = "fixtures")]
pub fn assume_unfinished() {
    ASSUMED.with(|assumed| assumed.set(false));
    DISK.with(|disk| disk.set(Some(Disk::NotStarted)));
    PLAN.with(|plan| *plan.borrow_mut() = read_plan());
}

/// What the disk says about setup in this home (#1457): read by [`refresh`], never by a frame.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Disk {
    Finished,
    Stopped,
    NotStarted,
}

thread_local! {
    static DISK: Cell<Option<Disk>> = const { Cell::new(None) };
    /// The line under Set up, read with the disk, since a frame draws it.
    static REASON: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    /// The rows setup will run here, read with the disk while setup hasn't finished (#1100).
    static PLAN: std::cell::RefCell<Vec<(Step, bool)>> = const { std::cell::RefCell::new(Vec::new()) };
}

fn read_disk() -> Disk {
    let root = crate::hub::root();
    if root.join("setup-finished.json").exists() {
        Disk::Finished
    } else if root.join("setup-stopped.json").exists() {
        Disk::Stopped
    } else if nothing_here(&root) {
        Disk::NotStarted
    } else {
        // Something of DeepBuild's is here and no setup stopped: nothing asks for setup.
        Disk::Finished
    }
}

/// Reads the setup files once more. The app's tick calls it, and so does a finished Set up; a frame only reads what it
/// kept. It reports whether the answer changed, so a caller can draw again.
pub fn refresh() -> bool {
    let read = read_disk();
    let line = (read == Disk::Stopped).then(read_reason).flatten();
    let reason_changed = REASON.with(|kept| kept.replace(line.clone()) != line);
    let plan = if read == Disk::Finished {
        Vec::new()
    } else {
        read_plan()
    };
    let plan_changed = PLAN.with(|kept| kept.replace(plan.clone()) != plan);
    DISK.with(|disk| disk.replace(Some(read)) != Some(read)) || reason_changed || plan_changed
}

fn disk() -> Disk {
    DISK.with(|disk| match disk.get() {
        Some(read) => read,
        None => {
            refresh();
            disk.get().unwrap_or(Disk::Finished)
        }
    })
}

/// Whether setup hasn't finished in this home, so the window shows the Set up button (#1002): nothing of DeepBuild
/// is here yet, or a setup started and didn't finish. Setup's first step writes `~/.deepbuild/setup-stopped.json` and
/// its last writes `setup-finished.json` and takes the first away (packages/hub/src/setup.ts). It reads what
/// [`refresh`] kept, and does no file-system call of its own after the first.
pub fn needed() -> bool {
    #[cfg(feature = "fixtures")]
    if ASSUMED.with(Cell::get) {
        return false;
    }
    disk() != Disk::Finished
}

/// Whether `root` holds nothing of DeepBuild's: the running app's claim on it (#994) isn't setup.
fn nothing_here(root: &Path) -> bool {
    std::fs::read_dir(root).map_or(true, |mut entries| {
        entries.all(|entry| {
            entry.is_ok_and(|entry| {
                crate::single::FILES
                    .iter()
                    .any(|file| entry.file_name() == *file)
            })
        })
    })
}

/// Why the last setup stopped, and its fix, as it kept them in `~/.deepbuild/setup-stopped.json`; `None` when it
/// kept none.
pub fn stopped() -> Option<(String, String)> {
    let text = std::fs::read_to_string(crate::hub::root().join("setup-stopped.json")).ok()?;
    let kept: serde_json::Value = serde_json::from_str(&text).ok()?;
    let text = |key: &str| kept[key].as_str().map(str::to_owned);
    Some((text("reason")?, text("fix").unwrap_or_default()))
}

/// What the count reads while setup hasn't finished, in place of a number of asks (#1002); `None` once it has.
pub fn count() -> Option<&'static str> {
    if !needed() {
        None
    } else if disk() == Disk::Stopped {
        Some("Setup didn't finish")
    } else {
        Some("Not set up yet")
    }
}

/// The line under Set up: why the last setup stopped and its fix, when it kept them, with your home written `~`.
/// It reads what [`refresh`] kept.
pub fn reason() -> Option<String> {
    disk();
    REASON.with(|kept| kept.borrow().clone())
}

fn read_reason() -> Option<String> {
    let (reason, fix) = stopped()?;
    let line = format!(
        "Setup didn't finish: {}. {fix}",
        reason.trim_end_matches('.')
    );
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    // macOS resolves /tmp and /var to /private, so setup may have named either form of the same home.
    let homes = [std::fs::canonicalize(&home).unwrap_or_default(), home];
    Some(
        homes
            .iter()
            .filter(|h| h.as_os_str().len() > 1)
            .fold(line, |line, h| {
                line.replace(&format!("{}/", h.display()), "~/")
            }),
    )
}

/// Your login shell's PATH, read as packages/hub/src/setup.ts reads it (`$SHELL -l -c 'printf %s "$PATH"'`, within
/// [`LOGIN_SHELL_WAIT`]); a shell missing, failing or not answering is named.
pub fn login_path() -> Result<String, String> {
    let shell = std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/sh".into());
    let unreadable = |why: String| {
        format!("couldn't read your login shell's PATH from {shell}: {why}. Fix {shell}, or set SHELL to a login shell that starts, then Set up again.")
    };
    let mut child = Command::new(&shell)
        .args(["-l", "-c", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| unreadable(error.to_string()))?;
    let deadline = Instant::now() + LOGIN_SHELL_WAIT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            waited => {
                let _ = child.kill();
                // blocking call: reaps the shell just killed; login_path runs only off the UI thread, from set_up and
                // the headless check_for_updates.
                let _ = child.wait();
                return Err(unreadable(waited.err().map_or_else(
                    || format!("it didn't answer within {} s", LOGIN_SHELL_WAIT.as_secs()),
                    |error| error.to_string(),
                )));
            }
        }
    };
    let mut path = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = out.read_to_string(&mut path);
    }
    match path.trim() {
        _ if !status.success() => Err(unreadable(format!("it exited with {status}"))),
        "" => Err(unreadable("it printed no PATH".into())),
        path => Ok(path.to_owned()),
    }
}

/// The first executable `name` in `path`'s folders.
fn find(path: &str, name: &str) -> Option<PathBuf> {
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| Path::new(dir).join(name))
        .find(|file| {
            file.metadata()
                .is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        })
}

/// `deep` as `path` finds it, run with `path` so its runtime is found too; without one there, the checkout's CLI.
pub fn deep(path: &str) -> Command {
    let mut command = match find(path, "deep") {
        Some(deep) => Command::new(deep),
        None => {
            let mut node = Command::new(find(path, "node").unwrap_or_else(|| "node".into()));
            node.arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/cli/dist/main.js"));
            node
        }
    };
    command.env("PATH", path);
    command
}

/// A Set up that stopped (#1100): the one line the screen shows when setup kept no reason of its own this time, and
/// what it printed, one press away. No command, exit status or output is in the line.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Stopped {
    pub line: Option<String>,
    pub output: String,
}

/// Runs [`set_up`] on a thread of its own and returns where it says the one line, or that it stopped, so the click
/// never waits on `deep setup` (#1556). It says it once; a thread that couldn't start says that.
pub fn start() -> Receiver<Result<String, Stopped>> {
    let (said, heard) = mpsc::channel();
    let thread = std::thread::Builder::new().name("deep setup".into());
    let running = said.clone();
    if let Err(error) = thread.spawn(move || running.send(set_up())) {
        let _ = said.send(Err(Stopped {
            line: Some("Set up couldn't start. Press Set up to try again.".into()),
            output: error.to_string(),
        }));
    }
    heard
}

/// Runs `deep setup` and returns the one line it ends with (`setUpLine` in packages/hub/src/setup-steps.ts) once it
/// worked: it exited 0, or it finished with its record written, as when the wiki wasn't built (#1100). Otherwise, that
/// it stopped. It waits for setup to end, so the window calls it only through [`start`].
pub fn set_up() -> Result<String, Stopped> {
    let started = SystemTime::now();
    let path = login_path().map_err(|error| Stopped {
        line: Some(format!("Set up {error}")),
        output: String::new(),
    })?;
    let mut setup = deep(&path);
    // blocking call: off the UI thread, on start's thread or in the headless `deep-app --set-up`.
    let output = setup.arg("setup").output();
    let output = output.map_err(|error| Stopped {
        line: Some(
            "Set up couldn't run DeepBuild's deep command. Press Set up to try again.".into(),
        ),
        output: error.to_string(),
    })?;
    let Output {
        status,
        stdout,
        stderr,
    } = output;
    let (stdout, stderr) = (
        String::from_utf8_lossy(&stdout),
        String::from_utf8_lossy(&stderr),
    );
    let line = stdout.lines().map(str::trim).rfind(|line| !line.is_empty());
    if status.success() || written_since(&crate::hub::root().join("setup-finished.json"), started) {
        return line.map(str::to_owned).ok_or_else(|| Stopped {
            line: Some("Set up finished without a word. Press Set up to try again.".into()),
            output: format!("{stdout}{stderr}"),
        });
    }
    // Setup keeps why it stopped, and its fix, which the screen shows (`reason`); a deep that kept none this time is
    // told by its own last plain line, never a stack trace or an exit status.
    let kept = written_since(&crate::hub::root().join("setup-stopped.json"), started);
    Err(Stopped {
        line: (!kept).then(|| {
            let traced = crate::plain::trace(&stderr);
            stderr
                .lines()
                .map(str::trim)
                .rfind(|line| {
                    !line.is_empty()
                        && !traced.iter().any(|t| t.trim() == *line)
                        && !line.contains("exit status")
                })
                .map_or_else(
                    || "Set up stopped before it said why. Press Set up to try again.".to_owned(),
                    str::to_owned,
                )
        }),
        output: format!("{stdout}{stderr}"),
    })
}

/// Whether `file` was written at or after `since`.
fn written_since(file: &Path, since: SystemTime) -> bool {
    std::fs::metadata(file)
        .and_then(|meta| meta.modified())
        .is_ok_and(|at| at + Duration::from_secs(1) >= since)
}

/// Check for updates (#41): `deep update --check` run once, its line. The login shell's PATH finds `deep`, as Set up
/// does; with none readable, the app's own PATH.
pub fn check_for_updates() -> String {
    let path = login_path().unwrap_or_else(|_| std::env::var("PATH").unwrap_or_default());
    let mut check = deep(&path);
    check.args(["update", "--check"]).stderr(Stdio::inherit());
    // blocking call: only the headless `deep-app --check-for-updates` runs it, never the UI thread.
    match check.output() {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .rfind(|line| !line.is_empty())
            .map_or_else(
                || {
                    format!(
                        "Couldn't check for updates: deep update --check said nothing ({}).",
                        output.status
                    )
                },
                str::to_owned,
            ),
        Err(error) => format!("Couldn't check for updates: deep didn't start ({error})."),
    }
}
