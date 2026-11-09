//! The lines criteria 10 and 11 name. Keep every line where it is: the loops sit on rules.rs:10, 20
//! and 30 and the division on rules.rs:42, and the tests read those numbers.

/// Three xorshift loops, of `a`, `b` and `c` iterations, each written on one line, in one function
#[inline(never)]
pub fn work(a: u32, b: u32, c: u32, seed: u32) -> u32 {
    let mut x = seed | 1;
    let mut i = 0;
    // the first loop, `a` iterations (3,000 in the worst step)
    while i < a { x ^= x << 13; x ^= x >> 17; x ^= x << 5; i += 1; }
    let mut y = x | 1;
    let mut j = 0;
    // the second loop, `b` iterations (2,000 in the worst step)
    //
    //
    //
    //
    //
    //
    while j < b { y ^= y << 13; y ^= y >> 17; y ^= y << 5; j += 1; }
    let mut z = y | 1;
    let mut m = 0;
    // the third loop, `c` iterations (1,000 in the worst step)
    //
    //
    //
    //
    //
    //
    while m < c { z ^= z << 13; z ^= z >> 17; z ^= z << 5; m += 1; }
    x ^ y ^ z
}

//
//
//
//
/// The division: `b` is zero when the step read a `boom` entry of value 0, and the engine traps.
#[inline(never)]
pub fn judge(a: u32, b: u32) -> u32 {
    unsafe { core::hint::assert_unchecked(b != 0) };
    a / b
}
