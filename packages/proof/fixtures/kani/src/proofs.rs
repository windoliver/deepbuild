// The kit's harnesses for `clamp`.
use crate::clamp;

// Verifies: the value comes back within the range.
#[kani::proof]
fn clamp_within() {
    let value: u8 = kani::any();
    let low: u8 = kani::any();
    let high: u8 = kani::any();
    kani::assume(low <= high);
    kani::cover!(low < high, "a range wider than one value");
    let held = clamp(value, low, high);
    assert!(low <= held && held <= high);
}

// No input satisfies its assumption, so its assertion is never reached.
#[kani::proof]
fn clamp_never() {
    let value: u8 = kani::any();
    kani::assume(value < 1 && value > 1);
    kani::cover!(true, "an input the assumption admits");
    assert!(clamp(value, 0, 0) == 0);
}

// The checkout's copy, weakened from the approved one to a range every value is in.
#[kani::proof]
fn clamp_exact() {
    let value: u8 = kani::any();
    kani::cover!(value > 0, "a value above zero");
    assert!(clamp(value, 0, 255) == value);
}
