//! The app's hub client against a running hub (#16). It reaches the hub at the address setting when the
//! setting names one, as a forwarded socket would; with no setting it starts a hub of its own on a temp home,
//! from the repo's built CLI, and stops it by PID afterwards.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use deep_app::hub::{self, HubClient, HubError};
use serde_json::{json, Value};

/// The hub under test: its socket and its control token, and the hub this test started, if any.
struct Target {
    socket: PathBuf,
    token: String,
    started: Option<(Child, PathBuf)>,
}

impl Drop for Target {
    fn drop(&mut self) {
        if let Some((child, home)) = &mut self.started {
            let _ = Command::new("kill").arg(child.id().to_string()).status();
            let _ = child.wait();
            let _ = std::fs::remove_dir_all(home);
        }
    }
}

fn target() -> Target {
    if let Some(socket) = hub::configured_address() {
        let token = std::fs::read_to_string(hub::root().join("control.token"))
            .expect("the installed hub's control.token");
        return Target {
            socket,
            token: token.trim().to_string(),
            started: None,
        };
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    // A short path: a Unix socket's path must fit in 104 bytes on macOS.
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let home = PathBuf::from(format!(
        "/tmp/dah-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&home).unwrap();
    let mut child = Command::new("node")
        .arg(repo.join("packages/cli/dist/main.js"))
        .args(["hub", "run"])
        .env("HOME", &home)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("node runs the built deep CLI (npm run build first)");
    let mut ready = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut ready)
        .unwrap();
    let ready: Value = serde_json::from_str(&ready).expect("the hub's ready line");
    let root = home.join(".deepbuild");
    let token = std::fs::read_to_string(root.join("control.token")).unwrap();
    Target {
        socket: PathBuf::from(ready["socket"].as_str().unwrap()),
        token: token.trim().to_string(),
        started: Some((child, home)),
    }
}

#[test]
fn the_app_reads_the_hubs_health_and_log_as_the_app() {
    let target = target();
    let mut client = HubClient::connect(&target.socket).expect("the hub answers with its hello");
    assert!(
        client.hello["start"].is_string(),
        "the hello names the hub's start: {}",
        client.hello
    );
    client
        .hello_app(&target.token)
        .expect("the hub takes the app's credential");
    let health = client.call("hub.health", json!({})).expect("hub.health");
    assert!(
        health["pid"].as_u64().is_some_and(|pid| pid > 0),
        "health names the hub's pid: {health}"
    );
    assert_eq!(
        health["start"], client.hello["start"],
        "the health is the hub that said hello"
    );
    let page = client
        .call("events.read", json!({ "after": 0, "limit": 5 }))
        .expect("events.read");
    assert!(
        page["events"].is_array(),
        "events.read returns the log's events: {page}"
    );
}

#[test]
fn a_wrong_token_is_refused_and_a_hook_method_is_refused_for_the_app() {
    let target = target();
    let mut wrong = HubClient::connect(&target.socket).unwrap();
    match wrong.hello_app(&format!("{}x", target.token)) {
        Err(HubError::Refused(error)) => assert_eq!(error["code"], "credential", "{error}"),
        other => panic!("a wrong token must be refused as a credential: {other:?}"),
    }
    let mut app = HubClient::connect(&target.socket).unwrap();
    app.hello_app(&target.token).unwrap();
    match app.call("mcp.call", json!({ "tool": "deep_status" })) {
        Err(HubError::Refused(error)) => assert_eq!(error["code"], "role", "{error}"),
        other => panic!("mcp.call is deep mcp's alone, never the app's: {other:?}"),
    }
}
