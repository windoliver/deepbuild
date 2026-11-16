//! The logic item `rules`' program (Logic `logic@1`): hot-seat tic-tac-toe at a fixed step. Exports `memory`,
//! `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at` (each a data symbol, which
//! the linker exports as an immutable i32 global holding its address), and `moves_at`, the address of its move count.
//!
//! Built for the item `{reads: [c1, …, c9], writes: {board: {type: i32, count: 9}, winner: {type: i32}}}`. The read
//! region holds each press control's slot in declaration order, 264 B each (a u32 count, 4 zero bytes, then 16
//! entries of a u32 player, 4 zero bytes and an f64 value), then the step's seed; the write region holds `board` at 0
//! and `winner` at 40 (the next 8-byte boundary). helpers.ts checks that layout in deep_query's region map before it
//! reads a result.
//!
//! Each step, unless the game has a winner, a press of cell n (1 to 9) on an empty cell puts the mover's mark there:
//! X (1) when the board holds an even number of marks, else O (2); a press on a taken cell changes nothing. Three in a
//! line writes that mark to `winner`, and from then on every press changes nothing. The move count, the marks placed,
//! lives only in memory: no array holds it and no move reads it, so only a full-state hash sees it.
//!
//! The wrong programs (README: Planted wrong programs), one cargo feature each: `imports_function` calls `env.note`
//! from its step; `takes_taken_cell` puts the mover's mark on a taken cell too; `loops_on_9` loops forever on a press
//! of 9, before it looks at the winner.
#![no_std]

use core::ptr::{addr_of, addr_of_mut};

#[repr(C, align(8))]
pub struct Region<const N: usize>(pub [u8; N]);

/// One press control's slot in the read region.
const SLOT: usize = 8 + 16 * 16;
/// Nine slots, then the step's seed (an i64).
const READS: usize = 9 * SLOT + 8;
/// `winner`'s offset in the write region: `board` is 9 × 4 B, and the next entry starts on an 8-byte boundary.
const WINNER: usize = 40;
const LINES: [[usize; 3]; 8] = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

#[no_mangle]
pub static mut reads_at: Region<READS> = Region([0; READS]);
#[no_mangle]
pub static mut writes_at: Region<48> = Region([0; 48]);
/// The move count, in memory only.
#[no_mangle]
pub static mut moves_at: u32 = 0;

unsafe fn board() -> *mut i32 {
    addr_of_mut!(writes_at) as *mut i32
}

unsafe fn winner() -> *mut i32 {
    (addr_of_mut!(writes_at) as *mut u8).add(WINNER) as *mut i32
}

/// Whether the step read an entry of cell `cell`'s control (0-based).
unsafe fn pressed(cell: usize) -> bool {
    *((addr_of!(reads_at) as *const u8).add(cell * SLOT) as *const u32) > 0
}

#[no_mangle]
pub extern "C" fn init(_seed: i64) {
    unsafe {
        for i in 0..9 {
            *board().add(i) = 0;
        }
        *winner() = 0;
        *addr_of_mut!(moves_at) = 0;
    }
}

#[no_mangle]
pub extern "C" fn step(_k: i64) {
    unsafe {
        before_rules();
        if *winner() != 0 {
            return;
        }
        for cell in 0..9 {
            if !pressed(cell) {
                continue;
            }
            noted(cell);
            play(cell);
            if *winner() != 0 {
                return;
            }
        }
    }
}

/// A press of cell `cell` by whoever moves now.
unsafe fn play(cell: usize) {
    let b = board();
    let mut marks = 0;
    for i in 0..9 {
        if *b.add(i) != 0 {
            marks += 1;
        }
    }
    let me = if marks % 2 == 0 { 1 } else { 2 };
    if *b.add(cell) != 0 && !cfg!(feature = "takes_taken_cell") {
        return;
    }
    *b.add(cell) = me;
    *addr_of_mut!(moves_at) += 1;
    for line in LINES {
        if line.iter().all(|&i| *b.add(i) == me) {
            *winner() = me;
        }
    }
}

#[cfg(feature = "imports_function")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn note(cell: i32);
}

#[cfg(feature = "imports_function")]
unsafe fn noted(cell: usize) {
    note(cell as i32);
}

#[cfg(not(feature = "imports_function"))]
unsafe fn noted(_cell: usize) {}

#[cfg(feature = "loops_on_9")]
unsafe fn before_rules() {
    if pressed(8) {
        spin();
    }
}

#[cfg(not(feature = "loops_on_9"))]
unsafe fn before_rules() {}

#[cfg(feature = "loops_on_9")]
#[inline(never)]
fn spin() -> ! {
    let mut n: u32 = 0;
    loop {
        n = core::hint::black_box(n).wrapping_add(1);
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
