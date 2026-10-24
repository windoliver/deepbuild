// Its own test binary: it keeps the disk busy, and cargo runs test binaries one at a time, so no other test's
// spool write runs beside it.
use std::process::Command;

#[test]
fn a_hook_exits_at_its_spool_deadline_while_the_spool_write_is_still_syncing() {
    use std::io::{BufRead, BufReader, Write};
    // Each call runs while another process has just written 512 MB, so now and then a spool write's sync outlasts
    // deep-hook's spool deadline. On macOS a process can't finish exiting while one of its threads is in a sync,
    // so a hook that syncs in its own process exits only once the disk is done. Measured from deep-hook's word that
    // it stopped waiting to its exit, which leaves out what the OS takes to start a process on a busy disk.
    let home = std::path::PathBuf::from(format!("/tmp/dh315-busy-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    let payload = r#"{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
    let mut late = Vec::new();
    for _ in 0..60 {
        if late.len() == 3 {
            break;
        }
        let mut writer = Command::new("dd")
            .args(["if=/dev/zero", "bs=1m", "count=512"])
            .arg(format!("of={}/busy.bin", home.display()))
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
            .args(["claude-code", "PreToolUse"])
            .env_clear()
            .env("HOME", &home)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(payload.as_bytes())
            .unwrap();
        let said = BufReader::new(child.stderr.take().unwrap());
        let gave_up = std::thread::spawn(move || {
            said.lines()
                .map_while(Result::ok)
                .find(|line| line.contains("within the hook's 50 ms"))
                .map(|_| std::time::Instant::now())
        });
        child.wait().unwrap();
        let exited = std::time::Instant::now();
        if let Some(at) = gave_up.join().unwrap() {
            late.push(exited.duration_since(at));
        }
        writer.wait().unwrap();
    }
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        !late.is_empty(),
        "no spool write outlasted the deadline in 60 calls, so this proves nothing: the disk wasn't busy enough"
    );
    assert!(
        late.iter()
            .all(|gap| *gap < std::time::Duration::from_millis(15)),
        "after giving up on a spool write still syncing, deep-hook took {late:?} to exit"
    );
}
