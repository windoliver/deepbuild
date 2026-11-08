//! Issue #326: the one Set up click. It runs the same steps as `deep setup` (the hooks in watch-only mode, the
//! safety rules, the hub at login) and says so in one line. The first launch's button and `deep-app --set-up` both
//! call [`set_up`]. R1 builds the app from the checkout, so it runs the `deep` on your login shell's PATH, else the
//! checkout's CLI. Issue #41: an app opened from Finder has launchd's short PATH, so Set up reads your login shell's
//! PATH once and runs `deep` from it, and names a login shell it can't read.

use std::{
    io::Read,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};

/// How long the login shell has to print its PATH, as packages/hub/src/setup.ts gives it.
const LOGIN_SHELL_WAIT: Duration = Duration::from_secs(5);

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

/// Runs `deep setup` and returns the one line, or what went wrong.
pub fn set_up() -> Result<&'static str, String> {
    let path = login_path().map_err(|error| format!("Set up {error}"))?;
    let output = deep(&path)
        .arg("setup")
        .output()
        .map_err(|error| format!("deep setup didn't start: {error}"))?;
    match output {
        Output { status, .. } if status.success() => Ok(SET_UP_LINE),
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
    match deep(&path)
        .args(["update", "--check"])
        .stderr(Stdio::inherit())
        .output()
    {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .last()
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
