//! The time since this process's spawn, as the kernel records its start: the view3d call's cold
//! report (#854).

/// Milliseconds from this process's spawn, as the kernel records its start, to now.
#[cfg(target_os = "macos")]
pub fn since_spawn_ms() -> Option<f64> {
    // SAFETY: an all-zero proc_bsdinfo is valid for proc_pidinfo to fill, and the size passed is
    // its own.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTBSDINFO,
            0,
            (&raw mut info).cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    let started = std::time::UNIX_EPOCH
        + std::time::Duration::new(info.pbi_start_tvsec, info.pbi_start_tvusec as u32 * 1000);
    Some(
        std::time::SystemTime::now()
            .duration_since(started)
            .ok()?
            .as_secs_f64()
            * 1000.0,
    )
}

#[cfg(not(target_os = "macos"))]
pub fn since_spawn_ms() -> Option<f64> {
    None
}
