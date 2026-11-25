//! The app's hub client against a running hub (#16). It reaches the hub at the address setting when the
//! setting names one, as a forwarded socket would; with no setting it starts a hub of its own on a temp home,
//! from the repo's built CLI, and stops it by PID afterwards.

use std::io::{BufRead, BufReader, Write};
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

#[test]
fn the_hub_takes_the_views_the_app_reports_shown_and_hidden() {
    use deep_app::shown::{Reporter, Seen};
    let target = target();
    let mut app = HubClient::connect(&target.socket).unwrap();
    app.hello_app(&target.token).unwrap();
    let mut reporter = Reporter::new("1", vec!["orders".into()]);
    let shown = Seen {
        visible: true,
        minimized: false,
        display_awake: true,
        session_locked: false,
    };
    let calls = [
        shown,
        Seen {
            minimized: true,
            ..shown
        },
    ]
    .into_iter()
    .flat_map(|seen| reporter.report(Some(seen)))
    .collect::<Vec<_>>();
    assert_eq!(
        calls.len(),
        2,
        "one views.shown, then one views.hidden: {calls:?}"
    );
    for (method, params) in calls {
        let reply = app
            .call(method, params)
            .unwrap_or_else(|e| panic!("{method}: {e:?}"));
        assert_eq!(reply["reported"], true, "{method}: {reply}");
    }
}

/// Issue #3481: `deep-app --hub-check` against the hub at `socket`, from an app home holding `token`: its exit and its
/// output.
fn hub_check(socket: &std::path::Path, token: &str) -> (Option<i32>, String) {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let home = PathBuf::from(format!(
        "/tmp/dac-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let root = home.join(".deepbuild");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join("control.token"), token).unwrap();
    let address = json!({ "hub": { "address": format!("unix:{}", socket.display()) } });
    std::fs::write(root.join("config.json"), address.to_string()).unwrap();
    let ran = Command::new(env!("CARGO_BIN_EXE_deep-app"))
        .arg("--hub-check")
        .env("HOME", &home)
        .output()
        .expect("deep-app runs");
    let _ = std::fs::remove_dir_all(&home);
    let output = format!(
        "stdout {:?}, stderr {:?}",
        String::from_utf8_lossy(&ran.stdout),
        String::from_utf8_lossy(&ran.stderr)
    );
    (ran.status.code(), output)
}

#[test]
fn the_hub_check_fails_when_the_hub_refuses_the_apps_hello() {
    let target = target();
    let (code, output) = hub_check(&target.socket, &format!("{}x", target.token));
    assert!(
        code.is_some_and(|code| code != 0),
        "a refused hello must fail the check, not pass it: exit {code:?}, {output}"
    );
    assert!(
        !output.contains("hub ok"),
        "a refused hello is no hub ok: {output}"
    );
    assert!(
        output.contains("credential"),
        "the check names the refusal: {output}"
    );
    let (code, output) = hub_check(&target.socket, &target.token);
    assert_eq!(code, Some(0), "the hub's own token passes: {output}");
    assert!(
        output.contains("hub ok"),
        "the hub's own token passes: {output}"
    );
}

#[test]
fn the_hub_check_fails_when_the_hub_drops_the_app_after_its_hello() {
    // A stand-in hub whose hello covers the app: it takes the app's hello, then closes before any call.
    let dir = PathBuf::from(format!("/tmp/dad-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let socket = dir.join("hub.sock");
    let _ = std::fs::remove_file(&socket);
    let listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    let (answered, took_hello) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut writer = stream.try_clone().unwrap();
        let hello = json!({ "v": 1, "hello": "deep-hub", "start": "stand-in", "contract": hub::CONTRACT, "features": hub::NEEDS });
        writeln!(writer, "{hello}").unwrap();
        BufReader::new(stream)
            .read_line(&mut String::new())
            .unwrap();
        writeln!(writer, "{}", json!({ "v": 1, "role": "app" })).unwrap();
        answered.send(()).unwrap();
    });
    let (code, output) = hub_check(&socket, "token");
    let _ = std::fs::remove_dir_all(&dir);
    took_hello
        .recv_timeout(std::time::Duration::from_secs(10))
        .unwrap_or_else(|_| {
            panic!("the stand-in hub must take the app's hello before it drops it: {output}")
        });
    assert!(
        code.is_some_and(|code| code != 0),
        "a hub that drops the app after its hello must fail the check: exit {code:?}, {output}"
    );
    assert!(
        !output.contains("hub ok"),
        "a dropped connection is no hub ok: {output}"
    );
}
