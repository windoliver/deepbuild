//! `step` and its three loops on rules.rs:10, 20 and 30. Keep every line where it is: the test reads them.
//! `step` calls nothing, so every block the worst step (step 7) runs is in this one function.
#[no_mangle]
pub extern "C" fn step(k: i64) {
    let n: u32 = if k == 7 { 1000 } else { 100 };
    let mut x = unsafe { *core::ptr::addr_of!(crate::STATE) } ^ (k as u32) | 1;
    let mut i = 0;
    let a = 3 * n;
    // the first loop, `a` iterations (3,000 in the worst step)
    while i < a { x ^= x << 13; x ^= x >> 17; x ^= x << 5; i += 1; }
    let mut y = x | 1;
    let mut j = 0;
    let b = 2 * n;
    // the second loop, `b` iterations (2,000 in the worst step)
    //
    //
    //
    //
    //
    while j < b { y ^= y << 13; y ^= y >> 17; y ^= y << 5; j += 1; }
    let mut z = y | 1;
    let mut m = 0;
    let c = n;
    // the third loop, `c` iterations (1,000 in the worst step)
    //
    //
    //
    //
    //
    while m < c { z ^= z << 13; z ^= z >> 17; z ^= z << 5; m += 1; }
    let acc = x ^ y ^ z;
    unsafe {
        *core::ptr::addr_of_mut!(crate::STATE) = acc;
        *(core::ptr::addr_of_mut!(crate::writes_at) as *mut u32) = acc;
    }
}
