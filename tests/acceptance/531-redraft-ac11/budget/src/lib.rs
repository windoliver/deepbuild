//! A logic item's program (Logic `logic@1`): exports `memory`, `init(seed: i64)`, `step(k: i64)` (in rules.rs)
//! and the immutable globals `reads_at` and `writes_at` (data symbols, which the linker exports as immutable
//! i32 globals holding their addresses). Built for the item `{writes: {acc: {type: i32}}}` and no reads: the
//! write region starts with `acc` (the test checks its offset is 0 in the item's layout before it runs this).
#![no_std]

pub mod rules;

#[repr(C, align(8))]
pub struct Region<const N: usize>(pub [u8; N]);

#[no_mangle]
pub static mut reads_at: Region<64> = Region([0; 64]);
#[no_mangle]
pub static mut writes_at: Region<64> = Region([0; 64]);

/// The state each step carries to the next, so no loop's result is known before it runs.
pub static mut STATE: u32 = 0;

#[no_mangle]
pub extern "C" fn init(seed: i64) {
    unsafe { *core::ptr::addr_of_mut!(STATE) = seed as u32 };
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
