//! #499 and #1486: the allocation counters and the counting allocator the binary installs.

/// #499: the heap allocations the process has made, on every thread.
pub static ALLOCATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// #1486: the allocations made while the image service's own code ran, on any thread.
pub static SERVICE_ALLOCATIONS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn counted() {
    ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if deep_images::in_service() {
        SERVICE_ALLOCATIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

/// The system allocator, counting each allocation (the binary installs it as the global one).
pub struct Counting;

// SAFETY: every call goes to the system allocator unchanged; only a counter is added.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        counted();
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        counted();
        unsafe { std::alloc::System.alloc_zeroed(layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        counted();
        unsafe { std::alloc::System.realloc(ptr, layout, size) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}
