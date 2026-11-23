//! The test binary's counting allocator (README: Counting). It counts only on the thread that turned counting on, so a
//! stand-in hub's thread, or another test's, never adds to a reading.
//!
//! - Bytes: every byte the counted thread asks for, an allocation's size, and a reallocation's growth (its new size
//!   less its old one), as a heap profiler counts allocated bytes.
//! - Lists of asks (AC5): while a set of ask addresses is armed, each block the counted thread frees is read before it
//!   goes back; a block whose first word is the address of one of those asks is a list of asks (a `Vec<&Value>` over
//!   the record's asks), told apart by its second word: a list that also holds another session's ask spans sessions,
//!   else it is one session's. Blocks are zeroed when the counted thread gets them, so a word read later is one the
//!   program wrote while counting, never what an earlier owner left.
#![allow(dead_code)]

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::{Cell, RefCell};

pub struct Counting;

thread_local! {
    static ON: Cell<bool> = const { Cell::new(false) };
    static BYTES: Cell<u64> = const { Cell::new(0) };
    static BLOCKS: Cell<u64> = const { Cell::new(0) };
    /// The armed asks: each ask's address with its session's number, sorted by address.
    static ASKS: RefCell<Vec<(usize, u32)>> = const { RefCell::new(Vec::new()) };
    static ARMED: Cell<bool> = const { Cell::new(false) };
    static ONE_SESSION: Cell<u64> = const { Cell::new(0) };
    static SPANNING: Cell<u64> = const { Cell::new(0) };
}

fn on() -> bool {
    ON.try_with(Cell::get).unwrap_or(false)
}

fn armed() -> bool {
    on() && ARMED.try_with(Cell::get).unwrap_or(false)
}

fn add(bytes: usize) {
    let _ = BYTES.try_with(|b| b.set(b.get() + bytes as u64));
    let _ = BLOCKS.try_with(|b| b.set(b.get() + 1));
}

/// The session of the ask at `address`, if it is an armed ask.
fn ask_at(address: usize) -> Option<u32> {
    ASKS.try_with(|asks| {
        let asks = asks.try_borrow().ok()?;
        asks.binary_search_by_key(&address, |(at, _)| *at)
            .ok()
            .map(|i| asks[i].1)
    })
    .ok()
    .flatten()
}

/// Reads a block the counted thread is freeing, and counts it if it is a list of asks.
///
/// SAFETY: `ptr` is a live block of `layout` that the caller is about to free.
unsafe fn inspect(ptr: *mut u8, layout: Layout) {
    if layout.size() < 8 || layout.align() < 8 {
        return;
    }
    let words = ptr as *const usize;
    let Some(first) = ask_at(std::ptr::read_volatile(words)) else {
        return;
    };
    let second = (layout.size() >= 16)
        .then(|| ask_at(std::ptr::read_volatile(words.add(1))))
        .flatten();
    let counter = match second {
        Some(other) if other != first => &SPANNING,
        _ => &ONE_SESSION,
    };
    let _ = counter.try_with(|c| c.set(c.get() + 1));
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() && on() {
            add(layout.size());
            if armed() {
                std::ptr::write_bytes(ptr, 0, layout.size());
            }
        }
        ptr
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc_zeroed(layout);
        if !ptr.is_null() && on() {
            add(layout.size());
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        if armed() {
            inspect(ptr, layout);
        }
        System.dealloc(ptr, layout)
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let moved = System.realloc(ptr, layout, new_size);
        if !moved.is_null() && on() {
            if new_size > layout.size() {
                let _ = BYTES.try_with(|b| b.set(b.get() + (new_size - layout.size()) as u64));
                if armed() {
                    std::ptr::write_bytes(moved.add(layout.size()), 0, new_size - layout.size());
                }
            }
            let _ = BLOCKS.try_with(|b| b.set(b.get() + 1));
        }
        moved
    }
}

/// What the counted thread allocated while `run` ran: its bytes and how many blocks it asked for.
pub fn counted<R>(run: impl FnOnce() -> R) -> (R, u64, u64) {
    BYTES.with(|b| b.set(0));
    BLOCKS.with(|b| b.set(0));
    ON.with(|on| on.set(true));
    let result = run();
    ON.with(|on| on.set(false));
    (result, BYTES.with(Cell::get), BLOCKS.with(Cell::get))
}

/// The lists of asks the counted thread built and freed while `run` ran, over the asks at `asks` (each address with
/// its session's number): those of one session's asks, then those that span sessions.
pub fn lists_of_asks<R>(asks: Vec<(usize, u32)>, run: impl FnOnce() -> R) -> (R, u64, u64) {
    let mut asks = asks;
    asks.sort_unstable();
    ASKS.with(|cell| *cell.borrow_mut() = asks);
    ONE_SESSION.with(|c| c.set(0));
    SPANNING.with(|c| c.set(0));
    ARMED.with(|a| a.set(true));
    let (result, ..) = counted(run);
    ARMED.with(|a| a.set(false));
    ASKS.with(|cell| cell.borrow_mut().clear());
    (
        result,
        ONE_SESSION.with(Cell::get),
        SPANNING.with(Cell::get),
    )
}
