//! A tiny seeded generator (splitmix64) for the grammars' draws. Not for secrets.

/// A splitmix64 stream. The same seed gives the same draws on every machine.
#[derive(Clone, Debug)]
pub struct Seeded {
    state: u64,
}

impl Seeded {
    /// Starts a stream at `seed`.
    pub fn new(seed: u64) -> Self {
        Seeded { state: seed }
    }

    /// The next 64 random bits.
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A draw in `0..n`; `0` when `n` is `0`.
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }

    /// A draw in `lo..=hi` (`lo` when `hi < lo`).
    pub fn range(&mut self, lo: u64, hi: u64) -> u64 {
        if hi <= lo {
            lo
        } else {
            lo + self.below(hi - lo + 1)
        }
    }

    /// True with probability `num / den`.
    pub fn chance(&mut self, num: u64, den: u64) -> bool {
        self.below(den) < num
    }

    /// One item of a non-empty slice.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        let i = self.below(items.len() as u64) as usize;
        &items[i.min(items.len().saturating_sub(1))]
    }
}
