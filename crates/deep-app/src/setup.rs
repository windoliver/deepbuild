//! Issue #326: the one Set up click. It runs the same steps as `deep setup` (the hooks in watch-only mode, the
//! safety rules, the hub at login) and says so in one line. The first launch's button and `deep-app --set-up` both
//! call [`set_up`]; the button through [`start`], so the window keeps drawing while it runs (#1556). R1 builds the app from the checkout, so it runs the `deep` on your PATH, else the checkout's CLI.

use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
    process::{Command, Output},
    sync::mpsc::{self, Receiver},
};

/// What the click says once it's done; the first `deep` command says the same (packages/hub/src/setup.ts).
pub const SET_UP_LINE: &str = "DeepBuild added its hooks in watch-only mode, so no stop is held and no verdict blocks until you approve a repo's checks, and started the hub at login; deep setup --undo removes it all.";

/// Whether setup hasn't finished in this home, so the window shows the Set up button (#1002): nothing of DeepBuild
/// is here yet, or a setup started and didn't finish. Setup's first step writes `~/.deepbuild/setup-stopped.json` and
/// its last writes `setup-finished.json` and takes the first away (packages/hub/src/setup.ts).
pub fn needed() -> bool {
    let root = crate::hub::root();
    !root.join("setup-finished.json").exists()
        && (nothing_here(&root) || root.join("setup-stopped.json").exists())
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
    } else if crate::hub::root().join("setup-stopped.json").exists() {
        Some("Setup didn't finish")
    } else {
        Some("Not set up yet")
    }
}

/// The line under Set up: why the last setup stopped and its fix, when it kept them, with your home written `~`.
pub fn reason() -> Option<String> {
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

/// Runs [`set_up`] on a thread of its own and returns where it says the one line, or what went wrong, so the click
/// never waits on `deep setup` (#1556). It says it once; a thread that couldn't start says that.
pub fn start() -> Receiver<Result<&'static str, String>> {
    let (said, heard) = mpsc::channel();
    let thread = std::thread::Builder::new().name("deep setup".into());
    let running = said.clone();
    if let Err(error) = thread.spawn(move || running.send(set_up())) {
        let _ = said.send(Err(format!("deep setup didn't start: {error}")));
    }
    heard
}

/// Runs `deep setup` and returns the one line, or what went wrong. It waits for setup to end, so the window calls it
/// only through [`start`].
pub fn set_up() -> Result<&'static str, String> {
    // blocking call: off the UI thread, on start's thread or in the headless `deep-app --set-up`.
    let output = match Command::new("deep").arg("setup").output() {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/cli/dist/main.js");
            // blocking call: the same as above, when no `deep` is on PATH.
            Command::new("node").arg(cli).arg("setup").output()
        }
        output => output,
    }
    .map_err(|error| format!("deep setup didn't start: {error}"))?;
    match output {
        Output { status, .. } if status.success() => Ok(SET_UP_LINE),
        Output { status, stderr, .. } => Err(format!(
            "deep setup failed ({status}): {}",
            String::from_utf8_lossy(&stderr).trim()
        )),
    }
}
