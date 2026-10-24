//! The total of a list of readings.

#[cfg(kani)]
mod proofs;

/// One reading, widened to the sum's type.
pub fn widen(value: u32) -> u64 {
    value as u64
}

/// The sum of every reading. It sums in a u32, so a sum past u32::MAX wraps.
pub fn total(values: &[u32]) -> u64 {
    let mut sum: u32 = 0;
    for value in values {
        sum = sum.wrapping_add(*value);
    }
    widen(sum)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_readings() {
        assert_eq!(total(&[]), 0);
        assert_eq!(total(&[1, 2, 3]), 6);
    }
}
