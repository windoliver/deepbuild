//! Issue #347: `deep-hook clone <from> <to>`, a copy-on-write clone for staging a destructive command.

use super::*;

#[cfg(target_os = "macos")]
extern "C" {
    fn clonefile(src: *const std::ffi::c_char, dst: *const std::ffi::c_char, flags: u32) -> i32;
}

#[cfg(target_os = "linux")]
extern "C" {
    fn ioctl(fd: std::ffi::c_int, request: std::ffi::c_ulong, ...) -> std::ffi::c_int;
}

/// One copy-on-write clone of `from` at `to`, which must not exist: a folder whole, a link as a link (APFS's
/// clonefile(2); on Linux each file a reflink, FICLONE, as btrfs and XFS make; elsewhere staging isn't built yet).
/// Unsupported, leaving nothing at `to`, where the file system can't make one.
fn clone_one(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::io::AsRawFd;
        const FICLONE: std::ffi::c_ulong = 0x4004_9409;
        let meta = fs::symlink_metadata(from)?;
        let kind = meta.file_type();
        if kind.is_symlink() {
            return std::os::unix::fs::symlink(fs::read_link(from)?, to);
        }
        if kind.is_dir() {
            fs::create_dir(to)?;
            let made = (|| {
                for entry in fs::read_dir(from)? {
                    let entry = entry?;
                    clone_one(&entry.path(), &to.join(entry.file_name()))?;
                }
                fs::set_permissions(to, meta.permissions())
            })();
            if made.is_err() {
                let _ = fs::remove_dir_all(to);
            }
            return made;
        }
        if !kind.is_file() {
            // A FIFO, socket or device has no copy-on-write copy.
            return Err(io::Error::from(ErrorKind::Unsupported));
        }
        let source = fs::File::open(from)?;
        let copy = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(to)?;
        // SAFETY: two open descriptors that live through the call.
        if unsafe { ioctl(copy.as_raw_fd(), FICLONE, source.as_raw_fd()) } != 0 {
            let e = io::Error::last_os_error();
            drop(copy);
            let _ = fs::remove_file(to);
            // EOPNOTSUPP, EINVAL or EXDEV: no reflink on this file system, or not between these two.
            return Err(if matches!(e.raw_os_error(), Some(95 | 22 | 18)) {
                io::Error::from(ErrorKind::Unsupported)
            } else {
                e
            });
        }
        copy.set_permissions(meta.permissions())?;
        copy.set_modified(meta.modified()?)?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::ffi::OsStrExt;
        let c = |p: &Path| {
            std::ffi::CString::new(p.as_os_str().as_bytes())
                .map_err(|e| io::Error::new(ErrorKind::InvalidInput, e))
        };
        const CLONE_NOFOLLOW: u32 = 1;
        // SAFETY: both are NUL-terminated paths that live through the call.
        if unsafe { clonefile(c(from)?.as_ptr(), c(to)?.as_ptr(), CLONE_NOFOLLOW) } == 0 {
            return Ok(());
        }
        Err(io::Error::last_os_error())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (from, to);
        Err(io::Error::from(ErrorKind::Unsupported))
    }
}

/// `deep-hook clone <from> <to>`: `from` cloned copy-on-write at `to` (#347). Into a folder that is there, each entry
/// is cloned over the one of its name and nothing else there is touched, so a staged folder puts back what a run
/// deleted. Exit 0 cloned, 3 when this file system can't make a copy-on-write copy there, 1 another failure.
pub(super) fn clone(from: &Path, to: &Path) -> ExitCode {
    fn over(from: &Path, to: &Path) -> io::Result<()> {
        let there = match fs::symlink_metadata(to) {
            Err(e) if e.kind() == ErrorKind::NotFound => return clone_one(from, to),
            other => other?,
        };
        if there.is_dir() && fs::symlink_metadata(from)?.is_dir() {
            for entry in fs::read_dir(from)? {
                let entry = entry?;
                over(&entry.path(), &to.join(entry.file_name()))?;
            }
            return Ok(());
        }
        if there.is_dir() {
            fs::remove_dir_all(to)?;
        } else {
            fs::remove_file(to)?;
        }
        clone_one(from, to)
    }
    match over(from, to) {
        Ok(()) => ExitCode::SUCCESS,
        // ENOTSUP and EXDEV: no copy-on-write on this volume, or not between these two.
        Err(e)
            if e.kind() == ErrorKind::Unsupported || matches!(e.raw_os_error(), Some(18 | 45)) =>
        {
            eprintln!("deep-hook clone: this file system can't make a copy-on-write copy of {} at {}: {e}", from.display(), to.display());
            ExitCode::from(3)
        }
        Err(e) => {
            eprintln!(
                "deep-hook clone: {} at {}: {e}",
                from.display(),
                to.display()
            );
            ExitCode::from(1)
        }
    }
}
