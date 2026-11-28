use std::process::Command;

use super::{exit_within, short_home};

fn waiter_under(
    home: &std::path::Path,
    flag: &str,
    entry_shell: bool,
) -> (std::process::Child, std::time::Instant) {
    use std::io::Write;
    use std::os::unix::process::CommandExt;
    let bin = env!("CARGO_BIN_EXE_deep-hook");
    let waiter = if entry_shell {
        format!("/bin/sh -c ''\\''{bin}'\\'' claude-code waiter'; exit $?")
    } else {
        format!("'{bin}' claude-code waiter; exit $?")
    };
    let mut agent = Command::new("/bin/sh")
        .args(["-c", &waiter, "claude", flag])
        .env_clear()
        .env("HOME", home)
        .stdin(std::process::Stdio::piped())
        .process_group(0)
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
    let home = short_home("print");
    for flag in ["-p", "--print"] {
        let (mut agent, started) = waiter_under(&home, flag, false);
        let exited = exit_within(&mut agent, started, std::time::Duration::from_secs(3));
        assert_eq!(
            exited.and_then(|s| s.code()),
            Some(0),
            "under `claude {flag}` the waiter must exit 0 at once; it was still waiting after 3 s"
        );
    }
    let (mut agent, _) = waiter_under(&home, "--model", false);
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

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

fn kill_group(leader: u32) {
    let pgid = i32::try_from(leader).unwrap();
    assert!(pgid > 1, "a process group to end, not {pgid}");
    unsafe { kill(-pgid, 9) };
}

#[test]
fn a_print_runs_waiter_under_its_entrys_shell_exits_at_once() {
    let home = short_home("printsh");
    let (mut agent, started) = waiter_under(&home, "-p", true);
    let exited = exit_within(&mut agent, started, std::time::Duration::from_secs(3));
    if exited.is_none() {
        kill_group(agent.id());
    }
    let (mut interactive, _) = waiter_under(&home, "--model", true);
    std::thread::sleep(std::time::Duration::from_millis(1500));
    let waiting = interactive.try_wait().unwrap().is_none();
    if waiting {
        kill_group(interactive.id());
    }
    let _ = interactive.wait();
    let _ = std::fs::remove_dir_all(&home);
    assert_eq!(
        exited.and_then(|s| s.code()),
        Some(0),
        "under `claude -p` and its entry's shell the waiter must exit 0 at once; it was still waiting after 3 s"
    );
    assert!(
        waiting,
        "under an interactive `claude` and its entry's shell the waiter must keep waiting"
    );
}
