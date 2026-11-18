//! Issue #1482: the per-frame clocks of a build with `frame-clocks`: the main thread's CPU time and the heap
//! allocations it made. Without the feature a frame reads neither, and its report says `null`, not 0.

/// What a stretch of a frame cost the main thread.
#[derive(Clone, Copy, Debug, Default)]
pub struct Cost {
    pub cpu_ms: f64,
    pub allocations: u64,
}

impl Cost {
    pub fn plus(self, other: Cost) -> Cost {
        Cost {
            cpu_ms: self.cpu_ms + other.cpu_ms,
            allocations: self.allocations + other.allocations,
        }
    }
}

/// Where the main thread's clocks stood: [`Mark::since`] says what it spent from there.
#[derive(Clone, Copy)]
pub struct Mark {
    #[cfg(feature = "frame-clocks")]
    cpu_ns: u64,
    #[cfg(feature = "frame-clocks")]
    allocations: u64,
}

#[cfg(feature = "frame-clocks")]
mod on {
    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;

    use super::{Cost, Mark};

    thread_local! {
        /// The heap allocations this thread made, counted by [`Counting`].
        static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
    }

    /// The system allocator, counting each allocation the calling thread makes.
    pub struct Counting;

    fn count() {
        let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
    }

    unsafe impl GlobalAlloc for Counting {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            count();
            System.alloc(layout)
        }
        unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
            count();
            System.alloc_zeroed(layout)
        }
        unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new: usize) -> *mut u8 {
            count();
            System.realloc(ptr, layout, new)
        }
        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            System.dealloc(ptr, layout)
        }
    }

    #[global_allocator]
    static COUNTING: Counting = Counting;

    #[repr(C)]
    struct Timespec {
        seconds: i64,
        nanos: i64,
    }

    extern "C" {
        fn clock_gettime(clock: u32, at: *mut Timespec) -> i32;
    }

    /// macOS's `CLOCK_THREAD_CPUTIME_ID`.
    const THREAD_CPU_TIME: u32 = 16;

    fn cpu_ns() -> u64 {
        let mut at = Timespec {
            seconds: 0,
            nanos: 0,
        };
        // SAFETY: `at` is a valid timespec the call fills in.
        unsafe { clock_gettime(THREAD_CPU_TIME, &mut at) };
        at.seconds as u64 * 1_000_000_000 + at.nanos as u64
    }

    pub fn now() -> Mark {
        Mark {
            cpu_ns: cpu_ns(),
            allocations: ALLOCATIONS.with(Cell::get),
        }
    }

    pub fn since(mark: Mark) -> Option<Cost> {
        Some(Cost {
            cpu_ms: (cpu_ns().saturating_sub(mark.cpu_ns)) as f64 / 1_000_000.,
            allocations: ALLOCATIONS.with(Cell::get) - mark.allocations,
        })
    }
}

impl Mark {
    /// Where the clocks stand now.
    pub fn now() -> Mark {
        #[cfg(feature = "frame-clocks")]
        return on::now();
        #[cfg(not(feature = "frame-clocks"))]
        Mark {}
    }

    /// What the main thread spent since the mark; `None` in a build without the clocks.
    pub fn since(self) -> Option<Cost> {
        #[cfg(feature = "frame-clocks")]
        return on::since(self);
        #[cfg(not(feature = "frame-clocks"))]
        None
    }
}
