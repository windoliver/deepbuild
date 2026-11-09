//! Issue #1459: `deep-replica --view-kit session.row@1 <dir>`, the kit a view replacing the sidebar's session rows runs
//! before it installs. The fixture view, keyed by session IDs and drawing no ID, passes; the planted views keyed by
//! their place, and drawing a title alone, fail, naming the first session. Each test runs the real binary.
#![cfg(target_os = "macos")]

use std::process::Command;

use serde_json::Value;

fn kit(panel: &str) -> (i32, Value) {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../deep-app/panels/").to_owned() + panel;
    let out = Command::new(env!("CARGO_BIN_EXE_deep-replica"))
        .args(["--view-kit", "session.row@1", &dir])
        .output()
        .expect("deep-replica runs");
    let line = String::from_utf8_lossy(&out.stdout);
    let verdict = serde_json::from_str(line.trim())
        .unwrap_or_else(|e| panic!("{panel}: one JSON verdict line, not {line:?}: {e}"));
    (out.status.code().expect("an exit code"), verdict)
}

/// The fixture record's first session, as the sidebar lists it.
const FIRST: &str = "session:01MCBH57D812FQ88XJ33AV9KCE";

#[test]
fn a_view_keyed_by_session_ids_that_draws_no_id_passes() {
    let (code, verdict) = kit("1459-session-rows");
    assert_eq!((code, &verdict["result"]), (0, &Value::from("pass")), "{verdict}");
}

#[test]
fn a_view_keyed_by_place_fails_naming_the_first_session() {
    let (code, verdict) = kit("1459-session-rows-by-place");
    assert_eq!(code, 1, "{verdict}");
    assert_eq!(verdict["names"], format!("{FIRST}: no row in its place"));
}

#[test]
fn a_view_that_draws_a_title_alone_fails_naming_the_session_and_its_missing_words() {
    let (code, verdict) = kit("1459-session-rows-title-only");
    assert_eq!(code, 1, "{verdict}");
    let names = verdict["names"].as_str().unwrap_or_default();
    assert!(
        names.starts_with(&format!("{FIRST}: its row draws no ")),
        "{verdict}"
    );
}
