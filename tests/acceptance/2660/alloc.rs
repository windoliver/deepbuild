//! The heap counter each #2660 test binary installs as its global allocator: as
//! `crates/deep-marks-render/tests/no_alloc.rs` counts, every `alloc` and `realloc` the counting
//! thread makes while counting is on, with the bytes each asks for (its layout's size; a realloc's
//! new size) beside the count. A test names one size to watch, and the counter also counts the
//! allocations of exactly that many bytes (a copy of a text of that length).

#![allow(dead_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

pub struct Counting;

thread_local! {
    static ON: Cell<bool> = const { Cell::new(false) };
    static COUNT: Cell<u64> = const { Cell::new(0) };
    static BYTES: Cell<u64> = const { Cell::new(0) };
    static WATCH: Cell<usize> = const { Cell::new(usize::MAX) };
    static WATCHED: Cell<u64> = const { Cell::new(0) };
}

fn note(size: usize) {
    // `try_with`: a thread's own teardown may allocate after its locals are gone.
    if ON.try_with(Cell::get).unwrap_or(false) {
        let _ = COUNT.try_with(|c| c.set(c.get() + 1));
        let _ = BYTES.try_with(|c| c.set(c.get() + size as u64));
        if WATCH.try_with(Cell::get) == Ok(size) {
            let _ = WATCHED.try_with(|c| c.set(c.get() + 1));
        }
    }
}

// SAFETY: every call goes straight to the system allocator; the counts are const thread-locals.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        note(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

/// What `f` allocated on this thread.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Counted {
    /// Heap allocations: each `alloc` and each `realloc`.
    pub count: u64,
    /// The bytes they asked for.
    pub bytes: u64,
    /// Those of exactly the watched size.
    pub watched: u64,
}

/// What `f` allocates on this thread, counting allocations of `watch` bytes apart.
pub fn counted_watching<T>(watch: usize, f: impl FnOnce() -> T) -> (T, Counted) {
    COUNT.with(|c| c.set(0));
    BYTES.with(|c| c.set(0));
    WATCHED.with(|c| c.set(0));
    WATCH.with(|c| c.set(watch));
    ON.with(|c| c.set(true));
    let out = f();
    ON.with(|c| c.set(false));
    let counted = Counted {
        count: COUNT.with(Cell::get),
        bytes: BYTES.with(Cell::get),
        watched: WATCHED.with(Cell::get),
    };
    (out, counted)
}

/// What `f` allocates on this thread.
pub fn counted<T>(f: impl FnOnce() -> T) -> (T, Counted) {
    counted_watching(usize::MAX, f)
}
