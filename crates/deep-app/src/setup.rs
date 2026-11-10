//! Issue #326: the one Set up click. It runs the same steps as `deep setup` (the hooks in watch-only mode, the
//! safety rules, the hub at login) and says so in one line. The first launch's button and `deep-app --set-up` both
//! call [`set_up`]; the button through [`start`], so the window keeps drawing while it runs (#1556). Issue #41: an app
//! opened from Finder has launchd's short PATH, so Set up reads your login shell's PATH once and runs `deep` from it,
//! else the checkout's CLI, and names a login shell it can't read.

use std::{
    cell::Cell,
    io::Read,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

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
    DISK.with(|disk| disk.replace(Some(read)) != Some(read)) || reason_changed
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
    let line = format!("Setup stopped: {}. {fix}", reason.trim_end_matches('.'));
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

/// Runs [`set_up`] on a thread of its own and returns where it says the one line, or what went wrong, so the click
/// never waits on `deep setup` (#1556). It says it once; a thread that couldn't start says that.
pub fn start() -> Receiver<Result<String, String>> {
    let (said, heard) = mpsc::channel();
    let thread = std::thread::Builder::new().name("deep setup".into());
    let running = said.clone();
    if let Err(error) = thread.spawn(move || running.send(set_up())) {
        let _ = said.send(Err(format!("deep setup didn't start: {error}")));
    }
    heard
}

/// Runs `deep setup` and returns the one line it ends with, `SET_UP_LINE` in packages/hub/src/setup.ts, or what went
/// wrong. It waits for setup to end, so the window calls it only through [`start`].
pub fn set_up() -> Result<String, String> {
    let path = login_path().map_err(|error| format!("Set up {error}"))?;
    let mut setup = deep(&path);
    // blocking call: off the UI thread, on start's thread or in the headless `deep-app --set-up`.
    let output = setup.arg("setup").output();
    let output = output.map_err(|error| format!("deep setup didn't start: {error}"))?;
    match output {
        Output { status, stdout, .. } if status.success() => String::from_utf8_lossy(&stdout)
            .lines()
            .map(str::trim)
            .rfind(|line| !line.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| "deep setup finished without a word".to_owned()),
        Output { status, stderr, .. } => Err(format!(
            "deep setup failed ({status}): {}",
            String::from_utf8_lossy(&stderr).trim()
        )),
    }
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
