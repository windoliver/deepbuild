//! #1431: the heap is what the allocator holds in the footprint, free blocks on its pages included, so freeing half the
//! heap's blocks leaves the footprint less the heap where it was. Alone in its own binary: another test's allocations
//! would move the footprint under it.

#[cfg(target_os = "macos")]
#[test]
fn freeing_heap_blocks_leaves_the_footprint_less_the_heap_where_it_was() {
    use deep_gpu::footprint::{footprint, heap};
    let rest = || footprint().expect("the footprint") as i64 - heap().expect("the heap") as i64;
    let mut blocks: Vec<Vec<u8>> = (0..200_000).map(|i| vec![1; 64 + i % 1_000]).collect();
    let before = rest();
    for block in blocks.iter_mut().step_by(2) {
        *block = Vec::new();
    }
    let moved = rest() - before;
    assert!(
        moved.abs() < 16_000_000,
        "freeing half the heap's blocks moved the footprint less the heap by {moved} B"
    );
    drop(blocks);
}
