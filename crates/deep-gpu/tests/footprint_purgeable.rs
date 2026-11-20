//! #1431: purgeable memory made volatile leaves the footprint, so it leaves the heap too, and the footprint less the
//! heap stays where it was. Alone in its own binary, as footprint_heap.rs is.

#[cfg(target_os = "macos")]
#[test]
fn volatile_purgeable_memory_leaves_the_footprint_less_the_heap_where_it_was() {
    use deep_gpu::footprint::{footprint, heap};
    use std::ffi::c_void;
    extern "C" {
        fn malloc_default_purgeable_zone() -> *mut c_void;
        fn malloc_zone_malloc(zone: *mut c_void, size: usize) -> *mut u8;
        fn malloc_make_purgeable(ptr: *mut u8);
        fn malloc_zone_free(zone: *mut c_void, ptr: *mut u8);
    }
    const BYTES: usize = 64_000_000;
    let rest = || footprint().expect("the footprint") as i64 - heap().expect("the heap") as i64;
    // SAFETY: a block of BYTES from the purgeable zone, written, made volatile, then freed; nothing else holds it.
    let moved = unsafe {
        let zone = malloc_default_purgeable_zone();
        let block = malloc_zone_malloc(zone, BYTES);
        assert!(!block.is_null(), "the purgeable zone gives {BYTES} B");
        std::ptr::write_bytes(block, 1, BYTES);
        let before = rest();
        malloc_make_purgeable(block);
        let moved = rest() - before;
        malloc_zone_free(zone, block);
        moved
    };
    assert!(
        moved.abs() < 16_000_000,
        "making {BYTES} B of purgeable memory volatile moved the footprint less the heap by {moved} B"
    );
}
