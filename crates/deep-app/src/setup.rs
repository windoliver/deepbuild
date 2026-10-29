//! Issue #326: the one Set up click. It runs the same steps as `deep setup` (the hooks in watch-only mode, the
//! safety rules, the hub at login) and says so in one line. The first launch's button and `deep-app --set-up` both
//! call [`set_up`]. R1 builds the app from the checkout, so it runs the `deep` on your PATH, else the checkout's CLI.

use std::{
    io::ErrorKind,
    path::Path,
    process::{Command, Output},
};

/// What the click says once it's done; the first `deep` command says the same (packages/hub/src/setup.ts).
pub const SET_UP_LINE: &str = "DeepBuild added its hooks in watch-only mode, so no stop is held and no verdict blocks until you approve a repo's checks, and started the hub at login; deep setup --undo removes it all.";

/// Whether this home has nothing of DeepBuild in it yet, so the window shows the Set up button.
pub fn needed() -> bool {
    !crate::hub::root().exists()
}

/// Runs `deep setup` and returns the one line, or what went wrong.
pub fn set_up() -> Result<&'static str, String> {
    let output = match Command::new("deep").arg("setup").output() {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            let cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/cli/dist/main.js");
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
