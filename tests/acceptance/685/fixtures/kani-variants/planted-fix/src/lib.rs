//! The total of a list of readings, summed as a u64 so that no sum of u32 readings wraps.

#[cfg(kani)]
mod proofs;

/// One reading, widened to the sum's type.
pub fn widen(value: u32) -> u64 {
    value as u64
}

/// The sum of every reading.
pub fn total(values: &[u32]) -> u64 {
    let mut sum: u64 = 0;
    for value in values {
        sum = sum.wrapping_add(widen(*value));
    }
    sum
}

/// The sum of every reading, under the name the fix adds.
pub fn total_wide(values: &[u32]) -> u64 {
    total(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_readings() {
        assert_eq!(total(&[]), 0);
        assert_eq!(total(&[1, 2, 3]), 6);
        assert_eq!(total_wide(&[u32::MAX, 1]), u32::MAX as u64 + 1);
    }
}
