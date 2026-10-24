//! The kit's crate: a value held within a range.

#[cfg(kani)]
mod proofs;

/// `value` held within `low..=high`.
pub fn clamp(value: u8, low: u8, high: u8) -> u8 {
    if value < low {
        low
    } else if value > high {
        high
    } else {
        value
    }
}
