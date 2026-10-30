// The hook timer (tests/acceptance/21): stands in a hook entry's command in front of deep-hook and writes down when
// deep-hook was started and when it exited, both on the wall clock deep-hook stamps `seq` with (ns since the Unix
// epoch), without changing what the agent or the hub sees.
//
//   hook-timer <dir> <program> [args...]
//
// The timer reads the hook's JSON from stdin whole, forks a watcher, and then becomes the program itself (exec), so
// the program keeps the timer's PID and its parent, the agent's process, as an agent's hook entry has it (the hub
// reads a hook's parent to know its session). The watcher hands the JSON to the program's stdin, waits for the
// program's exit through kqueue (EVFILT_PROC, NOTE_EXIT), and writes one file, <dir>/<spawn_ns>-<pid>.json:
//   {"spawn_ns": "<ns just before the exec>", "end_ns": "<ns at the exit>", "pid": <the program's PID>, "payload": <the hook JSON>}
// The program's stdout, stderr and exit code are the agent's, untouched; the watcher holds none of them open.
//
// DH21_TIMER_LINGER_MS=<n> is the tests' wrong program, a hook that takes n ms longer: the timer then runs the
// program as its child, waits for it, waits n ms more and exits with its code, and the watcher times the timer.
// macOS only (kqueue), as the reference Macs are.
use std::ffi::CString;
use std::io::Read;
use std::os::raw::{c_char, c_int, c_void};
use std::time::{SystemTime, UNIX_EPOCH};

#[repr(C)]
struct KEvent {
    ident: usize,
    filter: i16,
    flags: u16,
    fflags: u32,
    data: isize,
    udata: *mut c_void,
}
const EVFILT_PROC: i16 = -5;
const EV_ADD: u16 = 0x0001;
const EV_ONESHOT: u16 = 0x0010;
const NOTE_EXIT: u32 = 0x8000_0000;
const O_WRONLY: c_int = 0x0001;

extern "C" {
    fn fork() -> c_int;
    fn getpid() -> c_int;
    fn pipe(fds: *mut c_int) -> c_int;
    fn dup2(from: c_int, to: c_int) -> c_int;
    fn close(fd: c_int) -> c_int;
    fn read(fd: c_int, buf: *mut c_void, n: usize) -> isize;
    fn write(fd: c_int, buf: *const c_void, n: usize) -> isize;
    fn open(path: *const c_char, flags: c_int, ...) -> c_int;
    fn execvp(file: *const c_char, argv: *const *const c_char) -> c_int;
    fn kqueue() -> c_int;
    fn kevent(kq: c_int, changes: *const KEvent, nchanges: c_int, events: *mut KEvent, nevents: c_int, timeout: *const c_void) -> c_int;
    fn _exit(code: c_int) -> !;
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0)
}
fn write_all(fd: c_int, mut bytes: &[u8]) {
    while !bytes.is_empty() {
        let n = unsafe { write(fd, bytes.as_ptr() as *const c_void, bytes.len()) };
        if n <= 0 {
            return;
        }
        bytes = &bytes[n as usize..];
    }
}
fn read_exact(fd: c_int, buf: &mut [u8]) -> bool {
    let mut got = 0;
    while got < buf.len() {
        let n = unsafe { read(fd, buf[got..].as_mut_ptr() as *mut c_void, buf.len() - got) };
        if n <= 0 {
            return false;
        }
        got += n as usize;
    }
    true
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: hook-timer <dir> <program> [args...]");
        std::process::exit(64);
    }
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    let linger: u64 = std::env::var("DH21_TIMER_LINGER_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
    let me = unsafe { getpid() };
    let (mut feed, mut ready, mut stamp) = ([0 as c_int; 2], [0 as c_int; 2], [0 as c_int; 2]);
    unsafe {
        if pipe(feed.as_mut_ptr()) != 0 || pipe(ready.as_mut_ptr()) != 0 || pipe(stamp.as_mut_ptr()) != 0 {
            eprintln!("hook-timer: pipe failed");
            std::process::exit(70);
        }
    }
    let pid = unsafe { fork() };
    if pid < 0 {
        eprintln!("hook-timer: fork failed");
        std::process::exit(70);
    }
    if pid == 0 {
        // The watcher: holds none of the agent's pipes open, so the agent sees the hook end when the program does.
        unsafe {
            let null = CString::new("/dev/null").unwrap();
            let fd = open(null.as_ptr(), O_WRONLY);
            dup2(fd, 0);
            dup2(fd, 1);
            dup2(fd, 2);
            close(fd);
            close(feed[0]);
            close(ready[0]);
            close(stamp[1]);
            let kq = kqueue();
            let change = KEvent { ident: me as usize, filter: EVFILT_PROC, flags: EV_ADD | EV_ONESHOT, fflags: NOTE_EXIT, data: 0, udata: std::ptr::null_mut() };
            let watching = kevent(kq, &change, 1, std::ptr::null_mut(), 0, std::ptr::null()) == 0;
            write_all(ready[1], &[if watching { 1 } else { 0 }]);
            close(ready[1]);
            let mut t = [0u8; 8];
            let started = read_exact(stamp[0], &mut t);
            close(stamp[0]);
            write_all(feed[1], &input);
            close(feed[1]);
            let mut event = KEvent { ident: 0, filter: 0, flags: 0, fflags: 0, data: 0, udata: std::ptr::null_mut() };
            if watching {
                kevent(kq, std::ptr::null(), 0, &mut event, 1, std::ptr::null());
            }
            let end = now();
            if started {
                let text = String::from_utf8_lossy(&input).replace(['\n', '\r'], " ");
                let trimmed = text.trim();
                let payload = if trimmed.starts_with('{') && trimmed.ends_with('}') { trimmed.to_string() } else { "null".to_string() };
                let spawn = u64::from_le_bytes(t);
                let line = format!("{{\"spawn_ns\":\"{}\",\"end_ns\":\"{}\",\"pid\":{},\"watched\":{},\"payload\":{}}}\n", spawn, end, me, watching, payload);
                let _ = std::fs::write(format!("{}/{}-{}.json", args[1], spawn, me), line);
            }
            _exit(0);
        }
    }
    // The timer: waits until the watcher watches, stamps the start, and becomes the program.
    unsafe {
        close(feed[1]);
        close(ready[1]);
        close(stamp[0]);
        let mut byte = [0u8; 1];
        read_exact(ready[0], &mut byte);
        close(ready[0]);
        let t = now().to_le_bytes();
        write_all(stamp[1], &t);
        close(stamp[1]);
        dup2(feed[0], 0);
        close(feed[0]);
    }
    if linger > 0 {
        let status = std::process::Command::new(&args[2]).args(&args[3..]).status();
        std::thread::sleep(std::time::Duration::from_millis(linger));
        std::process::exit(status.ok().and_then(|s| s.code()).unwrap_or(1));
    }
    let cargs: Vec<CString> = args[2..].iter().map(|a| CString::new(a.as_str()).unwrap()).collect();
    let mut argv: Vec<*const c_char> = cargs.iter().map(|a| a.as_ptr()).collect();
    argv.push(std::ptr::null());
    unsafe { execvp(argv[0], argv.as_ptr()) };
    eprintln!("hook-timer: cannot run {}", args[2]);
    std::process::exit(127);
}
