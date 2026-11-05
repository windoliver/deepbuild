//! Issue #994: one app per user. The first window's process holds a lock beside the hub's token for its life, so a
//! crash frees it, and listens beside it; a later launch can't take the lock, calls the first forward and exits, so
//! only one notifier ever runs.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
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

impl Held {
    /// Whether a later launch called since this was last asked.
    pub fn called(&self) -> bool {
        let mut called = false;
        while self.listener.accept().is_ok() {
            called = true;
        }
        called
    }
}
