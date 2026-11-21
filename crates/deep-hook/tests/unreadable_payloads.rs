//! A hook payload deep-hook cannot read, and lone surrogate escapes, against the fail_closed entries (#2042).
//! The helpers are copies of `cli.rs`'s, as each file under `tests/` is its own crate.

use std::process::Command;

const RULES: &str = r#"{"v":1,"entries":{"no-kill-by-name":{"match":"shell:pkill *","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;

/// `home` made afresh with an empty `.deepbuild` folder.
fn fresh_home(home: std::path::PathBuf) -> std::path::PathBuf {
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    home
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

/// A hub on `home`'s socket that writes its hello, reads one request, writes what `answer` makes of the request's
/// id, then holds the connection for `linger`. A deep-hook that never connects, or that hangs up before its request
/// (on a loaded machine its own budgets can run out first), ends the hub after `GIVE_UP` instead of leaving the test
/// waiting on it forever; the test's assertions then say what deep-hook did. It ends with the request it read.
fn fake_hub(
    home: &std::path::Path,
    answer: impl Fn(&str) -> String + Send + 'static,
    linger: std::time::Duration,
) -> std::thread::JoinHandle<String> {
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
                        return String::new();
                    }
                    std::thread::sleep(std::time::Duration::from_millis(2));
                }
                Err(e) => panic!("the fake hub's accept failed: {e}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream.set_read_timeout(Some(GIVE_UP)).unwrap();
        let mut reader = BufReader::new(stream);
        let mut request = String::new();
        if reader
            .get_mut()
            .write_all(b"{\"v\":1,\"hello\":\"hub\",\"features\":[]}\n")
            .is_err()
            || reader.read_line(&mut request).is_err()
        {
            return request;
        }
        let Some(at) = request.find("\"id\":\"").map(|at| at + 6) else {
            return request;
        };
        let Some(answered) = request.get(at..at + 26).map(&answer) else {
            return request;
        };
        let _ = reader.get_mut().write_all(answered.as_bytes());
        std::thread::sleep(linger);
        request
    })
}

/// A hub's acknowledgement of request `id` with no hold, and the empty reply.
fn empty_reply(id: &str) -> String {
    format!(
        "{{\"v\":1,\"ack\":\"{id}\",\"hold_until_ms\":null}}\n{{\"v\":1,\"exit\":0,\"stdout\":\"\",\"stderr\":\"\"}}\n"
    )
}

/// A short home (a Unix socket path must fit in 104 bytes) with the fail_closed entry for `pkill *`.
fn short_home(name: &str) -> std::path::PathBuf {
    let home = fresh_home(format!("/tmp/dh315-{name}-{}", std::process::id()).into());
    std::fs::write(home.join(".deepbuild/rules.json"), RULES).unwrap();
    home
}

/// A fail_closed entry for `git push *`, as the first-party push entries hold a push with the hub away (#2042).
const PUSH_RULES: &str = r#"{"v":1,"entries":{"no-push":{"match":"shell:git push *","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;

/// A Bash PreToolUse payload for `command` whose `tool_input` also holds `extra` as its member `x`.
fn bash_call(command: &str, extra: &str) -> Vec<u8> {
    format!(
        r#"{{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{{"command":"{command}","x":{extra}}}}}"#
    )
    .into_bytes()
}

/// What deep-hook did with one payload: its exit code, its stderr, what it spooled, and the request a hub that
/// answered read.
struct Decided {
    code: Option<i32>,
    stderr: String,
    spooled: String,
    sent: String,
}

/// deep-hook's `event` fed `payload` under `rules`, in a home of its own `name`, with a hub that answers every call
/// with an empty reply or with none. A try the hub was late for is the hub away, so it is made again, 20 times. Only
/// a payload past 1 MiB, which takes the hub longer than its acknowledgement's 20 ms, keeps its 20th late try,
/// decided as with the hub away; for any other, 20 late tries are INCONCLUSIVE.
fn decided(name: &str, rules: &str, event: &str, payload: &[u8], answering: bool) -> Decided {
    for _ in 0..20 {
        let home = short_home(name);
        std::fs::write(home.join(".deepbuild/rules.json"), rules).unwrap();
        let hub =
            answering.then(|| fake_hub(&home, empty_reply, std::time::Duration::from_millis(50)));
        let mut child = hook(&home, event);
        // deep-hook may decide before it has read all of a long payload: what it decided is the answer.
        let _ = std::io::Write::write_all(&mut child.stdin.take().unwrap(), payload);
        let out = child.wait_with_output().unwrap();
        let spooled =
            std::fs::read_to_string(home.join(".deepbuild/spool/spool.jsonl")).unwrap_or_default();
        // A fake hub whose socket deep-hook hung up before it was set up panics (macOS refuses the timeout on it):
        // that hub read nothing.
        let sent = hub.and_then(|hub| hub.join().ok()).unwrap_or_default();
        std::fs::remove_dir_all(&home).unwrap();
        if !answering || !spooled.contains("\"late\":true") || payload.len() > 1 << 20 {
            return Decided {
                code: out.status.code(),
                stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
                spooled,
                sent,
            };
        }
    }
    panic!("INCONCLUSIVE: the hub was late for 20 tries; rerun alone")
}

/// The payloads deep-hook can't read, each with the words its denial gives for why.
fn unreadable_payloads() -> Vec<(&'static str, Vec<u8>, &'static str)> {
    let deep = bash_call(
        "git push origin main",
        &format!("{}1{}", "[".repeat(300), "]".repeat(300)),
    );
    let mut padded = bash_call(
        "git push origin main",
        &format!("\"{}\"", "a".repeat(2 << 20)),
    );
    padded.truncate(padded.len() - 3);
    let word = bash_call("git push origin main", "true");
    let in_word = word[..word.len() - 3].to_vec();
    // Cut inside a two-byte character: its first byte, and nothing after it.
    let mut in_char = bash_call("git push origin main", "\"é\"");
    in_char.truncate(in_char.len() - 4);
    let mut not_utf8 = bash_call("git push origin main", "\"-\"");
    let dash = not_utf8.len() - 4;
    not_utf8[dash] = 0xff;
    vec![
        ("nested inside 300 arrays", deep.clone(), "nested past"),
        (
            "cut to its first 40 bytes",
            deep[..40].to_vec(),
            "cut short",
        ),
        ("cut inside a word", in_word, "cut short"),
        ("empty", Vec::new(), "is empty"),
        ("not JSON", b"not json {".to_vec(), "not JSON"),
        ("not UTF-8", not_utf8, "UTF-8"),
        ("cut inside a character", in_char, "cut short"),
        ("2 MiB cut short", padded, "cut short"),
        (
            "a number with no value",
            bash_call("git push origin main", "1e999"),
            "number",
        ),
        ("an array", b"[1]".to_vec(), "not an object"),
    ]
}

#[test]
fn a_payload_deep_hook_cannot_read_is_denied_with_the_hub_up_and_down() {
    let mut wrong = Vec::new();
    for (case, payload, why) in unreadable_payloads() {
        for answering in [false, true] {
            let hub = if answering { "answering" } else { "away" };
            let d = decided(
                "payload-unread",
                PUSH_RULES,
                "PreToolUse",
                &payload,
                answering,
            );
            if d.code != Some(2)
                || !d.stderr.contains("PreToolUse payload")
                || !d.stderr.contains(why)
            {
                wrong.push(format!(
                    "{case}, the hub {hub}: exit {:?}, want 2 naming the payload and {why:?}: {}",
                    d.code, d.stderr
                ));
            }
            // It still reaches the hub when it answers in time, and the spool when it doesn't, as before.
            let reached = if answering && !d.spooled.contains("\"late\":true") {
                &d.sent
            } else {
                &d.spooled
            };
            if !reached.contains("\"event\":\"PreToolUse\"") {
                wrong.push(format!(
                    "{case}, the hub {hub}: the call reached neither the hub nor the spool: {:.200}",
                    d.spooled
                ));
            }
        }
    }
    assert_eq!(wrong, Vec::<String>::new());
}

#[test]
fn an_unreadable_payload_runs_as_before_with_no_fail_closed_entry_or_on_an_event_that_blocks_nothing(
) {
    let open = PUSH_RULES.replace("\"fail_closed\":true", "\"fail_closed\":false");
    let mut wrong = Vec::new();
    for (case, payload, _) in unreadable_payloads() {
        for (rules, event) in [(open.as_str(), "PreToolUse"), (PUSH_RULES, "PostToolUse")] {
            let d = decided("payload-open", rules, event, &payload, false);
            if d.code != Some(0) {
                wrong.push(format!("{case}, {event}: exit {:?}: {}", d.code, d.stderr));
            }
        }
    }
    assert_eq!(wrong, Vec::<String>::new());
}

#[test]
fn a_lone_surrogate_reads_as_the_replacement_character_and_the_call_is_matched() {
    // Lone halves, and a high half before another escape, which is read on its own.
    let lone = r#""half \ud800 a pair \udc00 \ud800\u0041""#;
    let push = bash_call("git push origin main", lone);
    let d = decided("payload-lone", PUSH_RULES, "PreToolUse", &push, false);
    assert_eq!(d.code, Some(2), "the push is denied: {}", d.stderr);
    assert!(
        d.stderr.contains("no-push") && !d.stderr.contains("payload"),
        "by the push entry, not as unreadable: {}",
        d.stderr
    );
    // The hub is sent the call deep-hook read, halves as U+FFFD, and matches it the same: a hub that refuses a lone
    // half would read none of it.
    let as_read = "half \u{FFFD} a pair \u{FFFD} \u{FFFD}A";
    let d = decided("payload-lone", PUSH_RULES, "PreToolUse", &push, true);
    assert!(
        d.sent.contains(r#""matched":["no-push"]"#)
            && d.sent.contains(as_read)
            && !d.sent.contains("\\ud8"),
        "the hub reads the push as deep-hook did: {:.400}",
        d.sent
    );
    let d = decided(
        "payload-lone",
        PUSH_RULES,
        "PreToolUse",
        &bash_call("ls", lone),
        false,
    );
    assert_eq!(d.code, Some(0), "`ls` runs: {}", d.stderr);
    assert!(
        d.spooled.contains(r#""command":"ls""#)
            && d.spooled.contains(as_read)
            && !d.spooled.contains("\\ud8"),
        "and is spooled as deep-hook read it: {:.400}",
        d.spooled
    );
    // A 2 MiB payload deep-hook can read is matched like any other.
    let big = format!("\"{}\"", "a".repeat(2 << 20));
    let d = decided(
        "payload-lone",
        PUSH_RULES,
        "PreToolUse",
        &bash_call("git push origin main", &big),
        false,
    );
    assert!(
        d.code == Some(2) && d.stderr.contains("no-push"),
        "the 2 MiB push is denied by no-push: {:?} {:.300}",
        d.code,
        d.stderr
    );
}

#[test]
fn keys_apart_only_by_their_lone_halves_are_a_payload_deep_hook_cannot_read() {
    // Read as U+FFFD, the two keys would be one and keep only the harmless path; the agent keeps them apart.
    let rules = r#"{"v":1,"entries":{"no-etc":{"match":"write:/etc/*","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;
    let payload = br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"mcp__files__save","tool_input":{"targets":{"\ud800":"/etc/hosts","\udc00":"/tmp/ok"}}}"#;
    let d = decided("payload-keys", rules, "PreToolUse", payload, false);
    assert!(
        d.code == Some(2)
            && d.stderr.contains("PreToolUse payload")
            && d.stderr.contains("lone surrogate in a key"),
        "denied as unreadable: {:?} {}",
        d.code,
        d.stderr
    );
}

#[test]
fn a_lone_half_in_an_mcp_call_is_a_payload_deep_hook_cannot_read() {
    // A server that reads lone low halves back into bytes would write /etc/hosts; deep-hook can't read it as that.
    let rules = r#"{"v":1,"entries":{"no-etc":{"match":"write:/etc/*","scope":"all_repos","mode":"block","reason":"r","next_step":"n","fail_closed":true}}}"#;
    let payload = br#"{"session_id":"s","hook_event_name":"PreToolUse","tool_name":"mcp__files__write","tool_input":{"path":"/etc/host\udcc3","content":"x"}}"#;
    let d = decided("payload-mcp", rules, "PreToolUse", payload, false);
    assert!(
        d.code == Some(2) && d.stderr.contains("PreToolUse payload") && d.stderr.contains("MCP"),
        "denied as unreadable: {:?} {}",
        d.code,
        d.stderr
    );
}
