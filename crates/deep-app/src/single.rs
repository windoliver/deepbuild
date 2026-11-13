//! Issue #994: one app per user. The first window's process holds a lock beside the hub's token for its life, so a
//! crash frees it, and listens beside it; a later launch can't take the lock, calls the first forward and exits, so
//! only one notifier ever runs.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, BufRead as _, BufReader, Write as _};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::time::Duration;

/// The claim's files under the hub's root.
pub const FILES: [&str; 2] = ["app.lock", "app.sock"];

/// The first app's hold on the lock, and where a later launch calls it.
pub struct Held {
    _lock: File,
    listener: UnixListener,
}

pub enum Claim {
    First(Held),
    /// Another app holds the lock, and has been called forward.
    Second,
}

/// Takes the lock under `root`, or calls forward the app that holds it.
pub fn claim(root: &Path) -> io::Result<Claim> {
    fs::create_dir_all(root)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(root.join(FILES[0]))?;
    let socket = root.join(FILES[1]);
    match lock.try_lock() {
        Ok(()) => {
            // A socket left by a crash answers no one.
            let _ = fs::remove_file(&socket);
            let listener = UnixListener::bind(&socket)?;
            listener.set_nonblocking(true)?;
            Ok(Claim::First(Held {
                _lock: lock,
                listener,
            }))
        }
        Err(TryLockError::WouldBlock) => {
            // The first may hold the lock and not listen yet.
            for _ in 0..20 {
                if UnixStream::connect(&socket).is_ok() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(Claim::Second)
        }
        Err(TryLockError::Error(error)) => Err(error),
    }
}

/// How long a call has to say its line once it connects.
const LINE: Duration = Duration::from_millis(100);

/// A call to the first app: a later launch, which brings it forward, or `deep open`, which names an address (#1460).
pub struct Call {
    pub address: Option<String>,
    stream: UnixStream,
}

impl Call {
    /// Answers `deep open` with what the window says.
    pub fn reply(mut self, words: &str) {
        let _ = writeln!(self.stream, "{words}");
    }
}

impl Held {
    /// The calls since this was last asked.
    pub fn calls(&self) -> Vec<Call> {
        let mut calls = Vec::new();
        while let Ok((stream, _)) = self.listener.accept() {
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(LINE));
            let mut line = String::new();
            let _ = BufReader::new(&stream).read_line(&mut line);
            let line = line.trim();
            calls.push(Call {
                address: (!line.is_empty()).then(|| line.to_owned()),
                stream,
            });
        }
        calls
    }
}
