//! The flock item's program (criterion 6), built against the bindings deep_kinds writes for the item (README: The
//! bindings, the API this uses): `regions.rs` defines and exports the item's regions and `regions_digest`, and this
//! file reads and writes them by name and type only, never by offset. Item: reads [wind, gust], writes {pos: vec3 ×
//! 100, vel: vec2 × 100, score: i32}, emits {crossing: {fields: {boid: i32, side: i32}, max_per_step: 16}}.
//!
//! Each step: the wind is the last `wind` entry so far (0 before any); every `gust` entry adds 1 to the gusts counted
//! and its value to their sum. pos[i] = [i, wind, k], vel[i] = [gust sum, i], score = gusts counted, and one crossing
//! row a gust entry this step: {a: j, b: k, boid: j, side: 1 for a positive value, else -1}.
#![no_std]

mod regions;

use core::ptr::{addr_of, addr_of_mut};

static mut WIND: f64 = 0.0;
static mut GUSTS: i32 = 0;
static mut GUST_SUM: f64 = 0.0;

#[no_mangle]
pub extern "C" fn init(_seed: i64) {}

#[no_mangle]
pub extern "C" fn step(k: i64) {
    unsafe {
        let r = regions::reads();
        let w = regions::writes();
        let e = regions::emits();
        if r.wind.count > 0 {
            *addr_of_mut!(WIND) = r.wind.entries[(r.wind.count - 1) as usize].value;
        }
        e.crossing.count = r.gust.count;
        for j in 0..r.gust.count as usize {
            let v = r.gust.entries[j].value;
            *addr_of_mut!(GUSTS) += 1;
            *addr_of_mut!(GUST_SUM) += v;
            e.crossing.rows[j] = regions::Crossing { a: j as u32, b: k as u32, boid: j as i32, side: if v > 0.0 { 1 } else { -1 } };
        }
        for i in 0..100 {
            w.pos[i] = [i as f64, *addr_of!(WIND), k as f64];
            w.vel[i] = [*addr_of!(GUST_SUM), i as f64];
        }
        w.score = *addr_of!(GUSTS);
        #[cfg(feature = "wrong_score")]
        {
            let read: f64 = regions::writes().score; // WRONG: score read as f64
            w.vel[0][0] = read;
        }
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}
