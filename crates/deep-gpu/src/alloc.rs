//! Counting the canvas core's heap allocations (issue #379: "a counting allocator sees zero heap
//! allocations per frame after warm-up"). A test build's global allocator calls [`note`] on each
//! allocation, which counts it only while a count is on, on a thread that runs the core's frame
//! path, and outside wgpu's own calls: what wgpu or the driver allocates isn't the core's. Every
//! build marks those calls; only a test build installs the allocator that reads the marks.

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static ON: AtomicBool = AtomicBool::new(false);
static COUNT: AtomicU64 = AtomicU64::new(0);

thread_local! {
    static CORE: Cell<bool> = const { Cell::new(false) };
    static OUTSIDE: Cell<u32> = const { Cell::new(0) };
}

/// Marks this thread as one that runs the core's frame path.
pub fn core_thread() {
    CORE.with(|c| c.set(true));
}

/// Runs `f`, a call into wgpu, whose allocations are wgpu's.
pub fn outside<R>(f: impl FnOnce() -> R) -> R {
    OUTSIDE.with(|o| o.set(o.get() + 1));
    let r = f();
    OUTSIDE.with(|o| o.set(o.get() - 1));
    r
}

/// Starts counting from zero.
pub fn start() {
    COUNT.store(0, Ordering::SeqCst);
    ON.store(true, Ordering::SeqCst);
}

/// Stops counting; the allocations counted since [`start`].
pub fn stop() -> u64 {
    ON.store(false, Ordering::SeqCst);
    COUNT.load(Ordering::SeqCst)
}

/// One allocation, as the global allocator sees it.
pub fn note() {
    if !ON.load(Ordering::Relaxed) {
        return;
    }
    let core = CORE.try_with(Cell::get).unwrap_or(false);
    let inside = OUTSIDE.try_with(Cell::get).unwrap_or(1) == 0;
    if core && inside {
        COUNT.fetch_add(1, Ordering::Relaxed);
    }
}
