// Its own test binary: it keeps the disk busy, and cargo runs test binaries one at a time, so no other test's
// spool write runs beside it. It has no libtest harness (Cargo.toml), so its tests run in turn, their disk loads never
// adding up, and a run that proves nothing can say so: libtest knows only ok, FAILED and ignored-before-running, and
// the lanes read a `test result: INCONCLUSIVE` line as INCONCLUSIVE (scripts/lanes.mjs, cargoResults).
//
// What the first test writes: up to 60 files of 512 MB in turn under /tmp, each over the last in /tmp/dh315-busy-<pid>,
// which it removes unless it panics.
use std::process::Command;

/// A test's answer when it doesn't panic: it held, or it ran and proved nothing, for the reason given.
type Outcome = Result<(), String>;
type Case = (&'static str, fn() -> Outcome);

const CASES: [Case; 2] = [
    (
        "a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms",
        a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms,
    ),
    (
        "hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running",
        hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running,
    ),
];

/// Runs the tests in turn and prints as libtest does, with a run that proved nothing as INCONCLUSIVE. Its first argument
/// not starting with `-` narrows the tests by name; it reads no other libtest flag, so --list, --skip and --ignored
/// don't do here what they do there.
fn main() {
    let filter = std::env::args().skip(1).find(|arg| !arg.starts_with('-'));
    let chosen: Vec<_> = CASES
        .iter()
        .filter(|(name, _)| filter.as_deref().is_none_or(|f| name.contains(f)))
        .collect();
    let plural = if chosen.len() == 1 { "" } else { "s" };
    println!("\nrunning {} test{plural}", chosen.len());
    let (mut passed, mut failed, mut unproven) = (0, 0, Vec::new());
    for (name, case) in chosen {
        // A run that proved nothing gives its reason on its own line, so the lanes, which read the bare word as a
        // reasonless state, read it once: from the `test result: INCONCLUSIVE` line, with the reason.
        let word = match std::panic::catch_unwind(case) {
            Ok(Ok(())) => {
                passed += 1;
                "ok".to_string()
            }
            Ok(Err(reason)) => {
                unproven.push(format!("{name}: {reason}"));
                format!("INCONCLUSIVE: {reason}")
            }
            Err(_) => {
                failed += 1;
                "FAILED".to_string()
            }
        };
        println!("test {name} ... {word}");
    }
    // A run that proved nothing says why even beside a failure, which outranks it.
    if !unproven.is_empty() {
        println!("\ntest result: INCONCLUSIVE. {}", unproven.join("; "));
    }
    if failed > 0 {
        println!("\ntest result: FAILED. {passed} passed; {failed} failed");
        std::process::exit(101);
    }
    if !unproven.is_empty() {
        std::process::exit(3);
    }
    println!("\ntest result: ok. {passed} passed; 0 failed");
}

fn a_hook_whose_spooled_line_is_still_syncing_exits_within_50_ms() -> Outcome {
    use std::io::{BufRead, BufReader, Write};
    // Each call runs while another process has just written 512 MB, so now and then a spooled line's sync outlasts
    // deep-hook's spool deadline. Those calls must still end within 50 ms of their start. On macOS a process can't
    // finish exiting while one of its threads is in a sync, and under this load one long sleep wakes up to 10 ms
    // late; either holds the hook past 50 ms. A disk this busy can also hold any one call in the kernel, starting it
    // or spawning, which no hook can help, so the median of five such calls is what must be under 50 ms. (A spool
    // write that doesn't land by the deadline is another matter: deep-hook says so in other words.) A disk on which
    // fewer than five syncs outlast the deadline in 60 calls measured nothing, so the run reads INCONCLUSIVE.
    let home = std::path::PathBuf::from(format!("/tmp/dh315-busy-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    let payload = r#"{"session_id":"s","cwd":"/tmp","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
    let (mut late, mut refused) = (Vec::new(), 0);
    for _ in 0..60 {
        if late.len() == 5 {
            break;
        }
        // 1048576 rather than 1m: GNU dd refuses 1m, and BSD dd reads both.
        let mut writer = Command::new("dd")
            .args(["if=/dev/zero", "bs=1048576", "count=512"])
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
        refused += usize::from(!writer.wait().unwrap().success());
    }
    std::fs::remove_dir_all(&home).unwrap();
    if late.len() < 5 {
        // A dd that failed wrote nothing, so the disk was never as busy as this test makes it.
        let dd = if refused > 0 {
            format!("; dd failed in {refused} of them")
        } else {
            String::new()
        };
        return Err(format!(
            "only {} spooled lines' syncs outlasted the deadline in 60 calls{dd}, so this proves nothing: the disk wasn't busy enough",
            late.len()
        ));
    }
    let mut sorted = late.clone();
    sorted.sort();
    assert!(
        sorted[2] < std::time::Duration::from_millis(50),
        "calls whose spooled line was still syncing at the deadline took {late:?}"
    );
    Ok(())
}

fn hooks_spooling_on_a_stalled_disk_leave_one_sync_and_the_spool_s_makers_running() -> Outcome {
    use std::io::Write;
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
    Ok(())
}
