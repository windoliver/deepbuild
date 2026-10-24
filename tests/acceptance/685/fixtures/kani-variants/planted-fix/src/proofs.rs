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

// The planted fix's harness: it calls `total_wide`, which only the fix adds.
#[kani::proof]
#[kani::unwind(5)]
fn total_wide_append() {
    let values: [u32; 4] = kani::any();
    let split: usize = kani::any();
    kani::assume(split <= 4);
    kani::cover!(split == 2, "a split inside the list");
    let (left, right) = values.split_at(split);
    assert_eq!(crate::total_wide(&values), crate::total_wide(left) + crate::total_wide(right));
}
