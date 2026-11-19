//! #1431: a large block that can't grow in place is moved by `realloc`, and the kernel stops counting the moved pages
//! in the footprint, so the heap mustn't count them either: the footprint less the heap stays where it was. Alone in
//! its own binary, as footprint_heap.rs is.

#[cfg(target_os = "macos")]
#[test]
fn blocks_realloc_moves_leave_the_footprint_less_the_heap_where_it_was() {
    use deep_gpu::footprint::{footprint, heap};
    use std::alloc::{GlobalAlloc, Layout, System};
    const BYTES: usize = 4_718_592;
    let rest = || footprint().expect("the footprint") as i64 - heap().expect("the heap") as i64;
    let (block, grown) = (
        Layout::from_size_align(BYTES, 16).expect("a block"),
        Layout::from_size_align(2 * BYTES, 16).expect("a grown block"),
    );
    // SAFETY: blocks from malloc (the system allocator at this size and alignment), each written and followed by a
    // written fence; each grown to twice its size by realloc, then all freed; nothing else holds them.
    let (moved, rest_moved) = unsafe {
        let pairs: Vec<(*mut u8, *mut u8)> = (0..12)
            .map(|_| {
                let first = System.alloc(block);
                std::ptr::write_bytes(first, 1, BYTES);
                // The fence takes the addresses after the block, so the block can't grow in place.
                let fence = System.alloc(block);
                std::ptr::write_bytes(fence, 2, BYTES);
                (first, fence)
            })
            .collect();
        let before = rest();
        let grew: Vec<(*mut u8, bool)> = (pairs.iter())
            .map(|&(first, _)| {
                let to = System.realloc(first, block, 2 * BYTES);
                (to, to != first)
            })
            .collect();
        let rest_moved = rest() - before;
        let moved = grew.iter().filter(|(_, moved)| *moved).count() * BYTES;
        for (&(_, fence), &(to, _)) in pairs.iter().zip(&grew) {
            System.dealloc(to, grown);
            System.dealloc(fence, block);
        }
        (moved, rest_moved)
    };
    assert!(
        moved >= 32_000_000,
        "only {moved} B moved; the blocks grew in place"
    );
    assert!(
        rest_moved.abs() < 16_000_000,
        "moving {moved} B by realloc moved the footprint less the heap by {rest_moved} B"
    );
}
