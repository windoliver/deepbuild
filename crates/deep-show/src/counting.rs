//! Issue #387: the allocation counter the `frames` call reads per frame.

/// Every heap allocation the process makes while [`count_allocations`] runs, counted so the
/// `frames` call can read how many the scheduler made in a frame (#387: "the scheduler
/// allocates nothing per frame after warm-up"). Outside it nothing is counted, so the kit's
/// threads, which allocate on every core at once, don't all contend for one counter.
struct Counting;

static COUNTING_ON: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static ALLOCATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn count() {
    if COUNTING_ON.load(std::sync::atomic::Ordering::Relaxed) {
        ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

// SAFETY: every call forwards to the system allocator unchanged; the counter is a relaxed atomic.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        count();
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        count();
        unsafe { std::alloc::System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new_size: usize) -> *mut u8 {
        count();
        unsafe { std::alloc::System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static COUNTING: Counting = Counting;

/// What `f` returns and how many heap allocations the process made while it ran.
pub fn count_allocations<T>(f: impl FnOnce() -> T) -> (T, u64) {
    use std::sync::atomic::Ordering::Relaxed;
    let before = ALLOCATIONS.load(Relaxed);
    COUNTING_ON.store(true, Relaxed);
    let out = f();
    COUNTING_ON.store(false, Relaxed);
    (out, ALLOCATIONS.load(Relaxed) - before)
}
