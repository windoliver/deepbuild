use std::process::Command;

#[test]
fn help_marks_the_skeleton() {
    let output = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .arg("--help")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8(output.stdout)
        .unwrap()
        .contains("Usage: deep-hook [--help | --version]"));
}

#[test]
fn a_call_with_no_agent_and_event_never_claims_success() {
    let output = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8(output.stderr)
        .unwrap()
        .contains("Usage: deep-hook <agent> <event>"));
}

#[test]
fn a_hook_whose_stdin_never_ends_is_allowed_within_the_deadline() {
    let home = std::env::temp_dir().join(format!("dh315-stdin-{}", std::process::id()));
    std::fs::create_dir_all(&home).unwrap();
    let start = std::time::Instant::now();
    // The agent never closes stdin and no hub is there: the watchdog decides.
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", "PreToolUse"])
        .env_clear()
        .env("HOME", &home)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let held = child.stdin.take();
    let exited = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if start.elapsed() > std::time::Duration::from_secs(1) {
            child.kill().unwrap();
            child.wait().unwrap();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    };
    drop(held);
    std::fs::remove_dir_all(&home).unwrap();
    let status = exited.expect("deep-hook still waited on stdin after a second");
    assert_eq!(status.code(), Some(0), "the call is allowed");
}

#[test]
fn a_call_whose_guard_rules_stall_is_denied_within_the_deadline() {
    use std::io::Write;
    let home = std::env::temp_dir().join(format!("dh315-rules-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    // rules.json is a FIFO nobody writes: reading it never ends, and no hub is there.
    let made = Command::new("/usr/bin/mkfifo")
        .arg(home.join(".deepbuild/rules.json"))
        .status()
        .unwrap();
    assert!(made.success());
    let start = std::time::Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", "PreToolUse"])
        .env_clear()
        .env("HOME", &home)
        .stdin(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pkill -f node"}}"#)
        .unwrap();
    let exited = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if start.elapsed() > std::time::Duration::from_secs(1) {
            child.kill().unwrap();
            child.wait().unwrap();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    };
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut stderr).unwrap();
    std::fs::remove_dir_all(&home).unwrap();
    let status = exited.expect("deep-hook still waited on rules.json after a second");
    assert_eq!(
        status.code(),
        Some(2),
        "a call whose guards weren't read is denied, not allowed: {stderr}"
    );
    assert!(
        stderr.contains("rules.json"),
        "the denial names the rules it couldn't read: {stderr}"
    );
}

#[test]
fn a_hook_with_no_shell_call_is_spooled_whatever_rules_json_does() {
    use std::io::Write;
    let home = std::env::temp_dir().join(format!("dh315-start-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    // rules.json is a FIFO nobody writes, and no hub is there: guards can't touch a SessionStart, so it is spooled.
    let made = Command::new("/usr/bin/mkfifo")
        .arg(home.join(".deepbuild/rules.json"))
        .status()
        .unwrap();
    assert!(made.success());
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", "SessionStart"])
        .env_clear()
        .env("HOME", &home)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(br#"{"session_id":"s","hook_event_name":"SessionStart","source":"startup"}"#)
        .unwrap();
    let start = std::time::Instant::now();
    let exited = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break Some(status);
        }
        if start.elapsed() > std::time::Duration::from_secs(1) {
            child.kill().unwrap();
            child.wait().unwrap();
            break None;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    };
    let spooled =
        std::fs::read_to_string(home.join(".deepbuild/spool/spool.jsonl")).unwrap_or_default();
    std::fs::remove_dir_all(&home).unwrap();
    assert_eq!(
        exited.and_then(|s| s.code()),
        Some(0),
        "the hook is allowed"
    );
    assert!(
        spooled.contains("\"SessionStart\""),
        "the hook is spooled: {spooled:?}"
    );
}

#[test]
fn a_call_whose_guard_rules_cannot_be_read_is_denied() {
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    let valid = r#"{"v":1,"entries":{"no-kill-by-name":{"match":"shell:pkill *","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;
    for (case, text, mode) in [
        ("truncated", &valid[..40], 0o600),
        ("not JSON", "rules", 0o600),
        ("no entries object", r#"{"v":1,"entries":[]}"#, 0o600),
        ("unreadable", valid, 0o000),
        (
            "an entry that isn't an object",
            r#"{"v":1,"entries":{"no-kill-by-name":"shell:pkill *"}}"#,
            0o600,
        ),
        (
            "fail_closed as a string",
            &valid.replace("true", "\"true\""),
            0o600,
        ),
        (
            "an entry with no match",
            &valid.replace(r#""match":"shell:pkill *","#, ""),
            0o600,
        ),
        (
            "an entry with an unknown mode",
            &valid.replace("block", "stop"),
            0o600,
        ),
    ] {
        let home = std::env::temp_dir().join(format!("dh315-bad-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
        let rules = home.join(".deepbuild/rules.json");
        std::fs::write(&rules, text).unwrap();
        std::fs::set_permissions(&rules, std::fs::Permissions::from_mode(mode)).unwrap();
        // No hub is there.
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
            .args(["claude-code", "PreToolUse"])
            .env_clear()
            .env("HOME", &home)
            .stdin(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pkill -f node"}}"#)
            .unwrap();
        let out = child.wait_with_output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(
            out.status.code(),
            Some(2),
            "{case} rules.json: the call is denied: {stderr}"
        );
        assert!(
            stderr.contains("rules.json"),
            "{case} rules.json: the denial names it: {stderr}"
        );
    }
}

#[test]
fn a_call_whose_acknowledged_hold_runs_out_is_still_spooled() {
    use std::io::{BufRead, BufReader, Write};
    use std::time::{SystemTime, UNIX_EPOCH};
    // A Unix socket path must fit in 104 bytes, so the home is short.
    let home = std::path::PathBuf::from(format!("/tmp/dh315-hold-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    let listener =
        std::os::unix::net::UnixListener::bind(home.join(".deepbuild/hub.sock")).unwrap();
    // A hub that acknowledges with a hold 300 ms ahead and never replies.
    let hub = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream);
        reader
            .get_mut()
            .write_all(b"{\"v\":1,\"hello\":\"hub\",\"features\":[]}\n")
            .unwrap();
        let mut request = String::new();
        reader.read_line(&mut request).unwrap();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let ack = format!(
            "{{\"v\":1,\"ack\":\"x\",\"hold_until_ms\":{}}}\n",
            now + 300
        );
        reader.get_mut().write_all(ack.as_bytes()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1500));
    });
    let payload = r#"{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push"}}"#;
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", "PreToolUse"])
        .env_clear()
        .env("HOME", &home)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(payload.as_bytes())
        .unwrap();
    let status = child.wait().unwrap();
    hub.join().unwrap();
    let spooled =
        std::fs::read_to_string(home.join(".deepbuild/spool/spool.jsonl")).unwrap_or_default();
    std::fs::remove_dir_all(&home).unwrap();
    assert_eq!(
        status.code(),
        Some(0),
        "the call is allowed once the hold runs out"
    );
    assert!(
        spooled.contains("git push") && spooled.contains("\"late\":true"),
        "the call is spooled marked late: {spooled:?}"
    );
}
