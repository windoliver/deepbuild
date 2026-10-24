// Its own test binary: it keeps the disk busy, and cargo runs test binaries one at a time, so no other test's
// spool write runs beside it. Its tests take BUSY in turn, so their disk loads don't add up either.
use std::process::Command;
use std::sync::Mutex;

static BUSY: Mutex<()> = Mutex::new(());

#[test]
fn a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms() {
    use std::io::{BufRead, BufReader, Write};
    let _turn = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    // Each call runs while another process has just written 512 MB, so now and then a spooled line's sync outlasts
    // deep-hook's spool deadline. Those calls must still end within 50 ms of their start. On macOS a process can't
    // finish exiting while one of its threads is in a sync, and under this load one long sleep wakes up to 10 ms
    // late; either holds the hook past 50 ms. A disk this busy can also hold any one call in the kernel, starting it
    // or spawning, which no hook can help, so the median of five such calls is what must be under 50 ms. (A spool
    // write that doesn't land by the deadline is another matter: deep-hook says so in other words.)
    let home = std::path::PathBuf::from(format!("/tmp/dh315-busy-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    let payload = r#"{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
    let mut late = Vec::new();
    for _ in 0..60 {
        if late.len() == 5 {
            break;
        }
        let mut writer = Command::new("dd")
            .args(["if=/dev/zero", "bs=1m", "count=512"])
            .arg(format!("of={}/busy.bin", home.display()))
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));
        let start = std::time::Instant::now();
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
                .any(|line| line.contains("but its sync didn't finish within the hook's 50 ms"))
        });
        child.wait().unwrap();
        let took = start.elapsed();
        if gave_up.join().unwrap() {
            late.push(took);
        }
        writer.wait().unwrap();
    }
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        late.len() == 5,
        "only {} spooled lines' syncs outlasted the deadline in 60 calls, so this proves nothing: the disk wasn't busy enough",
        late.len()
    );
    let mut sorted = late.clone();
    sorted.sort();
    assert!(
        sorted[2] < std::time::Duration::from_millis(50),
        "calls whose spooled line was still syncing at the deadline took {late:?}"
    );
}

#[test]
fn hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running() {
    use std::io::Write;
    let _turn = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    // Twenty hooks start at once while four other processes write 1 GB each, so their spool syncs stall. Each hook
    // stops waiting for its sync at the deadline; the syncs they leave behind must not pile up, one per hook: one
    // sync runs, and the hooks that made the spool folder and file may wait to sync their names. A burst stalls only when
    // it lands on the writers' flush, so it runs up to four times, each a little later.
    let home = std::path::PathBuf::from(format!("/tmp/dh315-bound-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    let folder = home.join(".deepbuild/spool");
    let mut most = 0;
    for wait in [300, 700, 1100, 1500] {
        if most > 3 {
            break;
        }
        let writers: Vec<_> = (0..4)
            .map(|w| {
                Command::new("dd")
                    .args(["if=/dev/zero", "bs=1m", "count=1024"])
                    .arg(format!("of={}/busy-{w}.bin", home.display()))
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap()
            })
            .collect();
        std::thread::sleep(std::time::Duration::from_millis(wait));
        let hooks: Vec<_> = (0..20)
            .map(|n| {
                let mut child = Command::new(env!("CARGO_BIN_EXE_deep-hook"))
                    .args(["claude-code", "PreToolUse"])
                    .env_clear()
                    .env("HOME", &home)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap();
                let payload = format!(
                    r#"{{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{{"command":"ls {n}"}}}}"#
                );
                child
                    .stdin
                    .take()
                    .unwrap()
                    .write_all(payload.as_bytes())
                    .unwrap();
                child
            })
            .collect();
        for mut hook in hooks {
            hook.wait().unwrap();
        }
        // Every hook has exited: what still runs for this spool is a sync the hooks left behind.
        let ps = Command::new("ps").args(["-Ao", "args="]).output().unwrap();
        let left = String::from_utf8_lossy(&ps.stdout)
            .lines()
            .filter(|line| line.contains(&format!("spool-sync {}", folder.display())))
            .count();
        most = most.max(left);
        for mut writer in writers {
            writer.wait().unwrap();
        }
    }
    std::fs::remove_dir_all(&home).unwrap();
    assert!(
        most <= 3,
        "once the hooks exited, {most} spool syncs were still running for their spool"
    );
}
