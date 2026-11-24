//! The counting allocator of `test-meter` builds (issue #379).

/// The counting allocator (issue #379, `test-meter` builds only): every allocation is offered to
/// the core's count, which keeps only the frame path's own.
#[cfg(feature = "test-meter")]
struct Counting;

#[cfg(feature = "test-meter")]
// SAFETY: every call passes straight to the system allocator.
unsafe impl std::alloc::GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        deep_gpu::alloc::note();
        unsafe { std::alloc::System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: std::alloc::Layout) -> *mut u8 {
        deep_gpu::alloc::note();
        unsafe { std::alloc::System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, size: usize) -> *mut u8 {
        deep_gpu::alloc::note();
        unsafe { std::alloc::System.realloc(ptr, layout, size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}

#[cfg(feature = "test-meter")]
#[global_allocator]
static COUNTING: Counting = Counting;
