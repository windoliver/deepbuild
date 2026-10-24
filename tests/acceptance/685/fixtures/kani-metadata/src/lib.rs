//! A crate that sets up Kani in its manifest and has no harness yet.

/// The largest reading, or 0 for none.
pub fn largest(values: &[u32]) -> u32 {
    values.iter().copied().max().unwrap_or(0)
}
