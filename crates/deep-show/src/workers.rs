//! The scheduler's worker threads (issue #857): a frame's independent nodes run on its budget
//! class's count of threads, the scheduler's own thread among them, and work that isn't a frame
//! runs below them. The canvas core starts no thread and reads no machine, so both live here.

use std::sync::atomic::{AtomicUsize, Ordering};

use deep_canvas::schedule::Pool;

/// A thread's priority, as the platform's quality-of-service classes give it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Priority {
    /// A live view's frame: the scheduler's thread and its workers.
    Frame,
    /// Work that isn't a frame (asset jobs, bakes, checks, replicas and playtests): below every
    /// live view's thread and the render worker.
    Background,
}

/// Sets the calling thread's priority.
pub fn set_priority(priority: Priority) {
    #[cfg(target_os = "macos")]
    {
        let class = match priority {
            Priority::Frame => libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE,
            Priority::Background => libc::qos_class_t::QOS_CLASS_BACKGROUND,
        };
        // SAFETY: sets only the calling thread's own class; no pointer crosses.
        unsafe {
            libc::pthread_set_qos_class_self_np(class, 0);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let nice = match priority {
            Priority::Frame => 0,
            Priority::Background => 19,
        };
        // SAFETY: a niceness for the calling thread alone (0 names the caller on Linux).
        unsafe {
            libc::setpriority(libc::PRIO_PROCESS, 0, nice);
        }
    }
}

/// The machine's performance cores: on Apple silicon the first performance level's physical
/// cores, elsewhere every core the process may use.
pub fn performance_cores() -> usize {
    #[cfg(target_os = "macos")]
    {
        let mut n: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        // SAFETY: a NUL-terminated name and an int-sized out buffer whose size is passed.
        let ok = unsafe {
            libc::sysctlbyname(
                c"hw.perflevel0.physicalcpu".as_ptr(),
                (&mut n as *mut libc::c_int).cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        } == 0;
        if ok && n > 0 {
            return n as usize;
        }
    }
    std::thread::available_parallelism().map_or(1, |n| n.get())
}

/// The pool: each `run` spreads its jobs over scoped threads at its priority, taking them one by
/// one from a shared counter, and the caller works as thread 0.
#[derive(Debug)]
pub struct Workers {
    pub priority: Priority,
    pub performance_cores: usize,
}

impl Pool for Workers {
    fn performance_cores(&self) -> usize {
        self.performance_cores
    }

    fn run(&self, threads: usize, count: usize, job: &(dyn Fn(usize, usize) + Sync)) {
        let next = AtomicUsize::new(0);
        let work = |thread: usize| loop {
            let k = next.fetch_add(1, Ordering::Relaxed);
            if k >= count {
                break;
            }
            job(k, thread);
        };
        std::thread::scope(|scope| {
            for thread in 1..threads.min(count) {
                let work = &work;
                let priority = self.priority;
                scope.spawn(move || {
                    set_priority(priority);
                    work(thread);
                });
            }
            work(0);
        });
    }
}
