//! The spool's file: the one append a hook makes to it, and the sync of a written line and the names that lead to it.

use std::fs::{self, DirBuilder, File, OpenOptions};
use std::io::{self, ErrorKind, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::Path;

/// `deep-hook spool-sync <folder> <file|folder|parent>`: syncs the spool file and, as far up as `upto` says, the
/// folder that names it and the folder's parent. One runs at a time for a spool, holding a lock on its folder, so
/// hooks on a stalled disk leave at most one sync behind. One that finds the lock held leaves its line to the
/// holder, which syncs the file again until it stops changing, and looks once more after letting go: a line
/// written as it let go is synced by it or by the next holder. The write that made the file or the folder waits
/// for the lock instead, since a holder syncs only the file; that's one write per spool file, not one per hook.
pub fn sync(folder: &Path, upto: &str) -> io::Result<()> {
    let path = folder.join("spool.jsonl");
    let state = || fs::symlink_metadata(&path).ok().map(|m| (m.ino(), m.len()));
    let mut names = upto != "file";
    loop {
        let lock = File::open(folder)?;
        if names {
            lock.lock()?;
        } else {
            match lock.try_lock() {
                Ok(()) => {}
                Err(fs::TryLockError::WouldBlock) => return Ok(()),
                Err(fs::TryLockError::Error(error)) => return Err(error),
            }
        }
        let mut seen;
        loop {
            seen = state();
            if seen.is_some() {
                OpenOptions::new()
                    .read(true)
                    .custom_flags(NOFOLLOW)
                    .open(&path)?
                    .sync_data()?;
            }
            if names {
                lock.sync_all()?;
                if upto == "parent" {
                    if let Some(parent) = folder.parent() {
                        File::open(parent)?.sync_all()?;
                    }
                }
                names = false;
            }
            if state() == seen {
                break;
            }
        }
        drop(lock);
        if state() == seen {
            return Ok(());
        }
    }
}

/// The spool's one append, with `opened` run between opening the file and writing to it (a test moves it there).
/// Returns how far up the line's sync must reach: the folder too when the file was made, and the folder's parent
/// when the folder was.
pub fn append(folder: &Path, request: &str, opened: &mut dyn FnMut()) -> io::Result<&'static str> {
    let path = folder.join("spool.jsonl");
    for _ in 0..3 {
        // Made by this write, exactly: only one write makes the folder, and only one makes each spool file.
        let made = match DirBuilder::new().mode(0o700).create(folder) {
            Ok(()) => true,
            Err(error) if error.kind() == ErrorKind::AlreadyExists => false,
            Err(_) => {
                DirBuilder::new()
                    .recursive(true)
                    .mode(0o700)
                    .create(folder)?;
                true
            }
        };
        // The spool is a folder of its own and one file in it, never a link to somewhere else: deep-hook only appends.
        let dir = fs::symlink_metadata(folder)?;
        if !dir.is_dir() || dir.mode() & 0o022 != 0 {
            return Err(io::Error::other(
                "the spool folder is a link, or others can write it",
            ));
        }
        let (mut file, fresh) = match OpenOptions::new()
            .create_new(true)
            .append(true)
            .mode(0o600)
            .custom_flags(NOFOLLOW)
            .open(&path)
        {
            Ok(file) => (file, true),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => {
                match OpenOptions::new()
                    .append(true)
                    .custom_flags(NOFOLLOW)
                    .open(&path)
                {
                    Ok(file) => (file, false),
                    // The hub moved it aside since: make the next one.
                    Err(error) if error.kind() == ErrorKind::NotFound => continue,
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        };
        let made_file = file.metadata()?;
        if !made_file.is_file() || made_file.nlink() != 1 {
            return Err(io::Error::other("the spool file is a link to another file"));
        }
        opened();
        #[cfg(debug_assertions)]
        if let Some(n) = stall() {
            file.write_all(&request.as_bytes()[..n.min(request.len())])?;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
        // One write call, never write_all's retries: a second call could land after another hook's line. A short
        // write leaves a cut line, which the hub skips, and the next try writes the whole line again.
        if file.write(request.as_bytes())? < request.len() {
            continue;
        }
        let written = file.metadata()?;
        match fs::symlink_metadata(&path) {
            Ok(now) if now.dev() == written.dev() && now.ino() == written.ino() => {}
            _ => continue,
        }
        return Ok(if made {
            "parent"
        } else if fresh {
            "folder"
        } else {
            "file"
        });
    }
    Err(io::Error::other(
        "the spool line was cut or moved in each of three tries",
    ))
}

/// O_NOFOLLOW, which std doesn't name: opening a symlink fails rather than following it.
#[cfg(target_os = "macos")]
const NOFOLLOW: i32 = 0x0100;
#[cfg(all(
    target_os = "linux",
    not(any(target_arch = "aarch64", target_arch = "arm"))
))]
const NOFOLLOW: i32 = 0o400000;
// arm64 and arm number it otherwise; 0o400000 there is O_LARGEFILE, which follows the link.
#[cfg(all(target_os = "linux", any(target_arch = "aarch64", target_arch = "arm")))]
const NOFOLLOW: i32 = 0o100000;

/// DEEP_HOOK_TEST_SPOOL_STALL in a debug build: spool only this many bytes of the line, then wait to be killed.
#[cfg(debug_assertions)]
pub fn stall() -> Option<usize> {
    std::env::var("DEEP_HOOK_TEST_SPOOL_STALL")
        .ok()
        .and_then(|text| text.parse::<usize>().ok())
}
