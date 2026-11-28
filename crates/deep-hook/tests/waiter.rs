use std::process::Command;

const SECOND: std::time::Duration = std::time::Duration::from_secs(1);

fn short_home(name: &str) -> std::path::PathBuf {
    let home = std::path::PathBuf::from(format!("/tmp/dh1851-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&home);
    std::fs::create_dir_all(home.join(".deepbuild")).unwrap();
    home
}

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

fn feed(child: &mut std::process::Child, payload: &[u8]) {
    use std::io::Write;
    child.stdin.take().unwrap().write_all(payload).unwrap();
}

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

fn stderr_of(child: &mut std::process::Child) -> String {
    let mut stderr = String::new();
    std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut stderr).unwrap();
    stderr
}

#[test]
fn the_waiter_waits_on_its_session_without_the_control_token() {
    use std::io::{BufRead, BufReader, Write};
    let home = short_home("token");
    let made = Command::new("/usr/bin/mkfifo")
        .arg(home.join(".deepbuild/control.token"))
        .status()
        .unwrap();
    assert!(made.success());
    let listener =
        std::os::unix::net::UnixListener::bind(home.join(".deepbuild/hub.sock")).unwrap();
    let hub = std::thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(10 * SECOND)).unwrap();
        let mut reader = BufReader::new(stream);
        reader
            .get_mut()
            .write_all(b"{\"v\":1,\"hello\":\"hub\",\"features\":[]}\n")
            .unwrap();
        let mut hello = String::new();
        reader.read_line(&mut hello).unwrap();
        reader
            .get_mut()
            .write_all(b"{\"role\":\"waiter:s1851\"}\n")
            .unwrap();
        let mut request = String::new();
        reader.read_line(&mut request).unwrap();
        reader
            .get_mut()
            .write_all(b"{\"v\":1,\"id\":1,\"result\":{\"session\":\"s1851\",\"text\":\"Your answer: North\"}}\n")
            .unwrap();
        (hello, request)
    });
    let mut waiter = hook(&home, "waiter");
    let start = std::time::Instant::now();
    feed(
        &mut waiter,
        br#"{"session_id":"s1851","cwd":"/tmp","hook_event_name":"Stop"}"#,
    );
    let exited = exit_within(&mut waiter, start, 2 * SECOND);
    let said = stderr_of(&mut waiter);
    let _ = std::fs::remove_dir_all(&home);
    assert_eq!(
        exited.and_then(|s| s.code()),
        Some(2),
        "the waiter must wake its session with the answer within 2 s, with no readable control.token; stderr: {said}"
    );
    assert!(
        said.contains("Your answer: North"),
        "the answer on stderr: {said}"
    );
    let (hello, request) = hub.join().unwrap();
    assert!(
        hello.contains("\"hello\":\"waiter\"")
            && hello.contains("\"session\":\"s1851\"")
            && !hello.contains("token"),
        "the waiter's hello names its role and session and carries no token: {hello}"
    );
    assert!(
        request.contains("\"method\":\"session.wait\"")
            && request.contains("\"session\":\"s1851\""),
        "it waits on its own session: {request}"
    );
}

#[test]
fn a_refused_waiter_keeps_waiting_quietly_and_asks_again_after_a_while() {
    use std::io::{BufRead, BufReader, Write};
    let home = short_home("refused");
    let listener =
        std::os::unix::net::UnixListener::bind(home.join(".deepbuild/hub.sock")).unwrap();
    listener.set_nonblocking(true).unwrap();
    let hellos = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = hellos.clone();
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopping = stop.clone();
    let hub = std::thread::spawn(move || {
        while !stopping.load(std::sync::atomic::Ordering::Relaxed) {
            let Ok((stream, _)) = listener.accept() else {
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            };
            stream.set_nonblocking(false).unwrap();
            stream.set_read_timeout(Some(5 * SECOND)).unwrap();
            let mut reader = BufReader::new(stream);
            let _ = reader
                .get_mut()
                .write_all(b"{\"v\":1,\"hello\":\"hub\",\"features\":[]}\n");
            let mut hello = String::new();
            if reader.read_line(&mut hello).is_ok() && hello.contains("\"waiter\"") {
                counted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let _ = reader.get_mut().write_all(b"{\"v\":1,\"id\":null,\"error\":{\"code\":\"role\",\"retryable\":false,\"remediation\":\"Process 1 isn't a child of session s1851's agent.\",\"path\":\"/hello\",\"actual\":\"s1851\",\"evidence\":[]}}\n");
            }
        }
    });
    let mut waiter = hook(&home, "waiter");
    feed(
        &mut waiter,
        br#"{"session_id":"s1851","cwd":"/tmp","hook_event_name":"Stop"}"#,
    );
    std::thread::sleep(3 * SECOND);
    let waiting = waiter.try_wait().unwrap().is_none();
    let _ = waiter.kill();
    let _ = waiter.wait();
    let said = stderr_of(&mut waiter);
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    hub.join().unwrap();
    let _ = std::fs::remove_dir_all(&home);
    let asked = hellos.load(std::sync::atomic::Ordering::Relaxed);
    assert!(waiting, "a refused waiter keeps waiting for its session");
    assert_eq!(
        asked, 1,
        "a refused waiter asks again only after seconds; it said hello {asked} times in 3 s"
    );
    assert!(
        said.is_empty(),
        "a refused waiter says nothing on stderr: {said}"
    );
}
