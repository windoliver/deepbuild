// The drafted harnesses for `total`. Each one's inputs, assumptions, unwind bound, cover and assertions are the
// statement the definition of done locks; a check names the harnesses it runs.
use crate::total;

// Verifies: the total of a list is the total of its two parts, for every list of up to four readings.
#[kani::proof]
#[kani::unwind(5)]
fn total_append() {
    let values: [u32; 4] = kani::any();
    let split: usize = kani::any();
    kani::assume(split <= 4);
    kani::cover!(split == 2, "a split inside the list");
    let (left, right) = values.split_at(split);
    assert_eq!(total(&values), total(left) + total(right));
}

// Holds on any `total` at all: f x = f x.
#[kani::proof]
#[kani::unwind(5)]
fn total_self() {
    let values: [u32; 4] = kani::any();
    let len: usize = kani::any();
    kani::assume(len <= 4);
    kani::cover!(len == 4, "a full list");
    assert_eq!(total(&values[..len]), total(&values[..len]));
}

// No input satisfies its assumption, so its assertion is never reached, and Kani still says SUCCESSFUL.
#[kani::proof]
#[kani::unwind(5)]
fn total_append_never() {
    let values: [u32; 4] = kani::any();
    let split: usize = kani::any();
    kani::assume(split <= 4 && split > 4);
    kani::cover!(split <= 4, "a split the assumption admits");
    let (left, right) = values.split_at(split);
    assert_eq!(total(&values), total(left) + total(right));
}

// Its unwind bound is too small for the loop in `total` over eight readings.
#[kani::proof]
#[kani::unwind(3)]
fn total_append_short() {
    let values: [u32; 8] = kani::any();
    let split: usize = kani::any();
    kani::assume(split <= 8);
    kani::cover!(split == 4, "a split inside the list");
    let (left, right) = values.split_at(split);
    assert_eq!(total(&values), total(left) + total(right));
}
