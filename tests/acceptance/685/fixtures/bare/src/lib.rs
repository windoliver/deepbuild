//! A crate with neither proof toolchain: no `lean-toolchain`, no Kani harness, no Kani metadata.

/// The sum of every reading.
pub fn total(values: &[u32]) -> u64 {
    values.iter().map(|v| *v as u64).sum()
}

#[cfg(test)]
mod tests {
    #[test]
    fn sums_readings() {
        assert_eq!(super::total(&[1, 2, 3]), 6);
    }
}
