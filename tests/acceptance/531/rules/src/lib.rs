//! A logic item's program (Logic `logic@1`): exports `memory`, `init(seed: i64)`, `step(k: i64)` and the
//! immutable globals `reads_at` and `writes_at` (each a data symbol, which the linker exports as an
//! immutable i32 global holding its address). Built for the item
//! `{reads: ["boom"], writes: {acc: {type: i32}}}`: the read region starts with `boom`'s slot (a u32
//! count, 4 zero bytes, then each entry as a u32 player, 4 zero bytes and its f64 value) and the write
//! region with `acc` (helpers.ts checks both offsets are 0 in the item's layout before it runs this).
//!
//! Each step runs rules::work's three loops: 300, 200 and 100 iterations, ten times as many at step 7
//! (the bake's worst step). A step that read a `boom` entry divides by that entry's value, so a value
//! of 0 traps with kind divide at rules.rs:42.
#![no_std]

mod rules;

use core::ptr::{addr_of, addr_of_mut};

#[repr(C, align(8))]
pub struct Region<const N: usize>(pub [u8; N]);

#[no_mangle]
pub static mut reads_at: Region<1024> = Region([0; 1024]);
#[no_mangle]
pub static mut writes_at: Region<64> = Region([0; 64]);

static mut STATE: u32 = 0;

#[no_mangle]
pub extern "C" fn init(seed: i64) {
    unsafe { *addr_of_mut!(STATE) = seed as u32 };
}

#[no_mangle]
pub extern "C" fn step(k: i64) {
    unsafe {
        let r = addr_of!(reads_at) as *const u8;
        let count = *(r as *const u32);
        let scale = if k == 7 { 10 } else { 1 };
        let mut acc = rules::work(300 * scale, 200 * scale, 100 * scale, *addr_of!(STATE) ^ (k as u32));
        if count > 0 {
            let value = *(r.add(16) as *const f64);
            acc = acc.wrapping_add(rules::judge(acc, value as u32));
        }
        *addr_of_mut!(STATE) = acc;
        *(addr_of_mut!(writes_at) as *mut i32) = acc as i32;
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
