use std::process::Command;

const RULES: &str = r#"{"v":1,"entries":{"no-kill-by-name":{"match":"shell:pkill *","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;
const PKILL: &[u8] = br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"pkill -f node"}}"#;

/// `home` made afresh with an empty `.deepbuild` folder.
fn fresh_home(home: std::path::PathBuf) -> std::path::PathBuf {
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    home
}

/// Makes `home`'s rules.json a FIFO nobody writes: reading it never ends.
fn stall_rules(home: &std::path::Path) {
    let made = Command::new("/usr/bin/mkfifo")
        .arg(home.join(".deepbuild/rules.json"))
        .status()
        .unwrap();
    assert!(made.success());
}

/// deep-hook's `claude-code <event>` with only `home` in its environment, its stdin and stderr piped and stdout dropped.
fn hook(home: &std::path::Path, event: &str) -> std::process::Child {
    Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", event])
        .env_clear()
        .env("HOME", home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap()
}

/// Writes `payload` to `child`'s stdin and closes it.
fn feed(child: &mut std::process::Child, payload: &[u8]) {
    use std::io::Write;
    child.stdin.take().unwrap().write_all(payload).unwrap();
}

/// How `child` exited if it did by `limit` after `start`; otherwise it is killed and this is `None`.
fn exit_within(
    child: &mut std::process::Child,
    start: std::time::Instant,
    limit: std::time::Duration,
) -> Option<std::process::ExitStatus> {
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return Some(status);
        }
        if start.elapsed() > limit {
            child.kill().unwrap();
            child.wait().unwrap();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
}

/// What `child` wrote to its stderr.
fn stderr_of(child: &mut std::process::Child) -> String {
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut stderr).unwrap();
    stderr
}

const SECOND: std::time::Duration = std::time::Duration::from_secs(1);

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
    let mut child = hook(&home, "PreToolUse");
    let held = child.stdin.take();
    let exited = exit_within(&mut child, start, SECOND);
    drop(held);
    std::fs::remove_dir_all(&home).unwrap();
    let status = exited.expect("deep-hook still waited on stdin after a second");
    assert_eq!(status.code(), Some(0), "the call is allowed");
}

#[test]
fn a_call_still_unread_at_the_deadline_is_denied_while_a_fail_closed_entry_is_installed() {
    let home = fresh_home(std::env::temp_dir().join(format!("dh316-stdin-{}", std::process::id())));
    std::fs::write(
        home.join(".deepbuild/rules.json"),
        RULES.replace("shell:pkill *", "kill:by-name"),
    )
    .unwrap();
    let start = std::time::Instant::now();
    // The agent never closes stdin and no hub is there: the call can't be checked, so it isn't let through.
    let mut child = hook(&home, "PreToolUse");
    let held = child.stdin.take();
    let exited = exit_within(&mut child, start, SECOND);
    drop(held);
    let stderr = stderr_of(&mut child);
    std::fs::remove_dir_all(&home).unwrap();
    let status = exited.expect("deep-hook still waited on stdin after a second");
    assert_eq!(
        status.code(),
        Some(2),
        "a call it couldn't read is denied: {stderr}"
    );
}

#[test]
fn a_call_whose_guard_rules_stall_is_denied_within_the_deadline() {
    let home = fresh_home(std::env::temp_dir().join(format!("dh315-rules-{}", std::process::id())));
    // rules.json is a FIFO nobody writes: reading it never ends, and no hub is there.
    stall_rules(&home);
    let start = std::time::Instant::now();
    let mut child = hook(&home, "PreToolUse");
    feed(&mut child, PKILL);
    let exited = exit_within(&mut child, start, SECOND);
    let stderr = stderr_of(&mut child);
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
    let home = fresh_home(std::env::temp_dir().join(format!("dh315-start-{}", std::process::id())));
    // rules.json is a FIFO nobody writes, and no hub is there: guards can't touch a SessionStart, so it is spooled.
    stall_rules(&home);
    let mut child = hook(&home, "SessionStart");
    feed(
        &mut child,
        br#"{"session_id":"s","hook_event_name":"SessionStart","source":"startup"}"#,
    );
    let exited = exit_within(&mut child, std::time::Instant::now(), SECOND);
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
    use std::os::unix::fs::PermissionsExt;
    let valid = RULES;
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
        let home =
            fresh_home(std::env::temp_dir().join(format!("dh315-bad-{}", std::process::id())));
        let rules = home.join(".deepbuild/rules.json");
        std::fs::write(&rules, text).unwrap();
        std::fs::set_permissions(&rules, std::fs::Permissions::from_mode(mode)).unwrap();
        // No hub is there.
        let mut child = hook(&home, "PreToolUse");
        feed(&mut child, PKILL);
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

/// A hub on `home`'s socket that writes its hello, reads one request, writes what `answer` makes of the request's
/// id, then holds the connection for `linger`. A deep-hook that never connects, or that hangs up before its request
/// (on a loaded machine its own budgets can run out first), ends the hub after `GIVE_UP` instead of leaving the test
/// waiting on it forever; the test's assertions then say what deep-hook did.
fn fake_hub(
    home: &std::path::Path,
    answer: impl Fn(&str) -> String + Send + 'static,
    linger: std::time::Duration,
) -> std::thread::JoinHandle<()> {
    use std::io::{BufRead, BufReader, Write};
    const GIVE_UP: std::time::Duration = std::time::Duration::from_secs(30);
    let listener =
        std::os::unix::net::UnixListener::bind(home.join(".deepbuild/hub.sock")).unwrap();
    listener.set_nonblocking(true).unwrap();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + GIVE_UP;
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        return;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
                Err(e) => panic!("the fake hub's accept failed: {e}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream.set_read_timeout(Some(GIVE_UP)).unwrap();
        let mut reader = BufReader::new(stream);
        if reader
            .get_mut()
            .write_all(b"{\"v\":1,\"hello\":\"hub\",\"features\":[]}\n")
            .is_err()
        {
            return;
        }
        let mut request = String::new();
        if reader.read_line(&mut request).is_err() {
            return;
        }
        let Some(at) = request.find("\"id\":\"").map(|at| at + 6) else {
            return;
        };
        let Some(id) = request.get(at..at + 26) else {
            return;
        };
        let _ = reader.get_mut().write_all(answer(id).as_bytes());
        std::thread::sleep(linger);
    })
}

/// Runs deep-hook's PreToolUse for `command` against `home`, and returns its exit code, how long it took, and the spool.
fn pre_tool_use(
    home: &std::path::Path,
    command: &str,
) -> (Option<i32>, std::time::Duration, String) {
    let payload = format!(
        r#"{{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{{"command":"{command}"}}}}"#
    );
    let start = std::time::Instant::now();
    let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
        .args(["claude-code", "PreToolUse"])
        .env_clear()
        .env("HOME", home)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    feed(&mut child, payload.as_bytes());
    let status = child.wait().unwrap();
    let spooled =
        std::fs::read_to_string(home.join(".deepbuild/spool/spool.jsonl")).unwrap_or_default();
    (status.code(), start.elapsed(), spooled)
}

/// A short home (a Unix socket path must fit in 104 bytes) with the fail_closed entry for `pkill *`.
fn short_home(name: &str) -> std::path::PathBuf {
    let home = fresh_home(format!("/tmp/dh315-{name}-{}", std::process::id()).into());
    std::fs::write(home.join(".deepbuild/rules.json"), RULES).unwrap();
    home
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

#[test]
fn a_call_whose_acknowledged_hold_runs_out_is_still_spooled() {
    let home = short_home("hold");
    // A hub that acknowledges with a hold 300 ms ahead and never replies.
    let hub = fake_hub(
        &home,
        |id| {
            format!(
                "{{\"v\":1,\"ack\":\"{id}\",\"hold_until_ms\":{}}}\n",
                now_ms() + 300
            )
        },
        std::time::Duration::from_millis(1500),
    );
    let (code, _, spooled) = pre_tool_use(&home, "git push");
    hub.join().unwrap();
    std::fs::remove_dir_all(&home).unwrap();
    assert_eq!(code, Some(0), "the call is allowed once the hold runs out");
    assert!(
        spooled.contains("git push") && spooled.contains("\"late\":true"),
        "the call is spooled marked late: {spooled:?}"
    );
}

#[test]
fn an_acknowledgement_of_another_request_is_the_hub_away() {
    let home = short_home("other");
    // A hub that acknowledges some other request with a hold 5 s ahead and never replies.
    let hub = fake_hub(
        &home,
        |_| {
            format!(
                "{{\"v\":1,\"ack\":\"01K74FKZVKZGATTBZAEGPRE999\",\"hold_until_ms\":{}}}\n",
                now_ms() + 5000
            )
        },
        std::time::Duration::from_millis(2000),
    );
    let (code, took, spooled) = pre_tool_use(&home, "pkill -f node");
    hub.join().unwrap();
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        took < std::time::Duration::from_secs(1),
        "deep-hook waited on a hold it wasn't given: {took:?}"
    );
    assert_eq!(code, Some(2), "the fail_closed entry denies the call");
    assert!(
        spooled.contains("pkill -f node"),
        "the call is spooled: {spooled:?}"
    );
}

#[test]
fn a_reply_outside_hook_reply_2_is_the_hub_away() {
    for (case, reply) in [
        (
            "an unknown field",
            r#"{"v":1,"exit":0,"stdout":"","stderr":"","allow":true}"#,
        ),
        (
            "another version",
            r#"{"v":2,"exit":0,"stdout":"","stderr":""}"#,
        ),
    ] {
        let home = short_home("reply");
        let hub = fake_hub(
            &home,
            move |id| format!("{{\"v\":1,\"ack\":\"{id}\",\"hold_until_ms\":null}}\n{reply}\n"),
            std::time::Duration::from_millis(200),
        );
        let (code, _, spooled) = pre_tool_use(&home, "pkill -f node");
        hub.join().unwrap();
        std::fs::remove_dir_all(&home).unwrap();
        assert_eq!(
            code,
            Some(2),
            "{case}: the fail_closed entry denies the call, not the reply"
        );
        assert!(
            spooled.contains("pkill -f node"),
            "{case}: the call is spooled: {spooled:?}"
        );
    }
}

#[test]
fn a_spool_path_that_leads_elsewhere_is_never_written() {
    let outside = std::env::temp_dir().join(format!("dh315-outside-{}", std::process::id()));
    for case in [
        "a symlinked spool file",
        "a hard-linked spool file",
        "a symlinked spool folder",
    ] {
        let home = short_home("link");
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let target = outside.join("spool.jsonl");
        std::fs::write(&target, "untouched\n").unwrap();
        let spool = home.join(".deepbuild/spool");
        match case {
            "a symlinked spool folder" => std::os::unix::fs::symlink(&outside, &spool).unwrap(),
            _ => {
                std::fs::create_dir_all(&spool).unwrap();
                if case == "a symlinked spool file" {
                    std::os::unix::fs::symlink(&target, spool.join("spool.jsonl")).unwrap();
                } else {
                    std::fs::hard_link(&target, spool.join("spool.jsonl")).unwrap();
                }
            }
        }
        // No hub is there: the call is decided and deep-hook tries to spool it.
        let (code, _, _) = pre_tool_use(&home, "ls");
        let after = std::fs::read_to_string(&target).unwrap();
        std::fs::remove_dir_all(&home).unwrap();
        std::fs::remove_dir_all(&outside).unwrap();
        assert_eq!(code, Some(0), "{case}: the call is still allowed");
        assert_eq!(
            after, "untouched\n",
            "{case}: the file it leads to is never written"
        );
    }
}

#[test]
fn a_hold_past_the_contract_is_the_hub_away() {
    let home = short_home("past");
    // One past hook.ack@2's largest hold_until_ms, and no reply.
    let hub = fake_hub(
        &home,
        |id| format!("{{\"v\":1,\"ack\":\"{id}\",\"hold_until_ms\":9007199254740992}}\n"),
        std::time::Duration::from_millis(2000),
    );
    let (code, took, spooled) = pre_tool_use(&home, "pkill -f node");
    hub.join().unwrap();
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        took < std::time::Duration::from_secs(1),
        "deep-hook waited on a hold outside the contract: {took:?}"
    );
    assert_eq!(code, Some(2), "the fail_closed entry denies the call");
    assert!(
        spooled.contains("pkill -f node"),
        "the call is spooled: {spooled:?}"
    );
}

/// The shipped entry `name` in default-rules.json, as its JSON text (its fields hold no nested object).
fn shipped_entry(name: &str) -> Option<String> {
    let rules = include_str!("../default-rules.json");
    let at = rules.find(&format!("\"{name}\": {{"))?;
    let start = at + rules[at..].find('{')?;
    let end = start + rules[start..].find('}')?;
    Some(rules[start..=end].to_string())
}

#[test]
fn the_shipped_rules_carry_a_workflow_dispatch_to_the_authority_gate() {
    // No "proceed" covers a dispatch (#321): the hub holds a call by the effect class its watch entry reads, so a
    // dispatch reaches it as one whatever you made of the no-workflow-dispatch block.
    let entry = shipped_entry("authority-dispatch")
        .expect("default-rules.json ships no authority-dispatch entry");
    assert!(
        entry.contains(r#""mode": "watch""#),
        "authority-dispatch must only carry the call to the gate, in watch mode: {entry}"
    );
    let matched = |command: &str| {
        use std::io::Write;
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
            .arg("check")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let input = format!(
            r#"{{"entry":{entry},"call":{{"tool_name":"Bash","tool_input":{{"command":"{command}"}}}},"classes":{{}}}}"#
        );
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        let said = String::from_utf8(output.stdout).unwrap();
        assert!(
            output.status.success(),
            "deep-hook check refused `{command}`: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        said.contains("\"matched\":true")
    };
    for dispatch in [
        "gh workflow run deploy.yml --ref main",
        "gh api repos/acme/shop/actions/workflows/deploy.yml/dispatches -f ref=main",
        "curl -X POST https://api.github.com/repos/acme/shop/dispatches",
    ] {
        assert!(matched(dispatch), "`{dispatch}` dispatches a workflow");
    }
    for other in ["gh run rerun 12", "gh workflow list"] {
        assert!(!matched(other), "`{other}` dispatches nothing");
    }
}

/// The waiter under an agent with `flag` in its argv: a shell that runs it as its child and stays (`exit $?` keeps the
/// shell from exec'ing it), with the Stop payload on stdin and no hub. Returns the shell and when it started.
fn waiter_under(home: &std::path::Path, flag: &str) -> (std::process::Child, std::time::Instant) {
    use std::io::Write;
    let bin = env!("CARGO_BIN_EXE_deep-hook");
    let mut agent = Command::new("/bin/sh")
        .args([
            "-c",
            &format!("'{bin}' claude-code waiter; exit $?"),
            "claude",
            flag,
        ])
        .env_clear()
        .env("HOME", home)
        .stdin(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = agent.stdin.take().unwrap();
    stdin
        .write_all(br#"{"session_id":"s668","cwd":"/tmp","hook_event_name":"Stop"}"#)
        .unwrap();
    drop(stdin);
    (agent, std::time::Instant::now())
}

#[test]
fn a_print_mode_agents_waiter_exits_at_once() {
    // `claude -p` waits for its async Stop entries before it exits, and a waiter waits for its agent to exit: a print
    // run has no later turn to wake, so its waiter must not wait, hub or no hub (#668).
    let home = short_home("print");
    for flag in ["-p", "--print"] {
        let (mut agent, started) = waiter_under(&home, flag);
        let exited = exit_within(&mut agent, started, std::time::Duration::from_secs(3));
        assert_eq!(
            exited.and_then(|s| s.code()),
            Some(0),
            "under `claude {flag}` the waiter must exit 0 at once; it was still waiting after 3 s"
        );
    }
    // An interactive agent's waiter keeps waiting for an answer to wake its session.
    let (mut agent, _) = waiter_under(&home, "--model");
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let waiting = agent.try_wait().unwrap().is_none();
    let _ = agent.kill();
    let _ = agent.wait();
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        waiting,
        "under an interactive `claude` the waiter must keep waiting"
    );
}
