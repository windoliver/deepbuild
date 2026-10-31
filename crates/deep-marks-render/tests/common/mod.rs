//! What the binary's tests share: one line through `deep-canvas-render` and a scratch directory.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;

/// `line` into `deep-canvas-render <subcommand>`, and its one line of answer.
pub fn run(subcommand: &str, line: &Value) -> Value {
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-canvas-render"))
        .arg(subcommand)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("deep-canvas-render starts");
    writeln!(child.stdin.take().unwrap(), "{line}").unwrap();
    let out = child.wait_with_output().unwrap();
    serde_json::from_str(String::from_utf8(out.stdout).unwrap().trim()).unwrap()
}

/// A directory of this run's, `<prefix>-<name>-<pid>` under the temp dir, with a `store` in it.
pub fn scratch(prefix: &str, name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("{prefix}-{name}-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("store")).unwrap();
    dir
}
