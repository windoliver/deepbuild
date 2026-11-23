//! A decimated series' rows: every kept row, and the raw row nearest a time (the crosshair's snap).

use super::*;

impl Decimated {
    /// Every kept row, in draw order, each once.
    pub fn rows(&self) -> Vec<usize> {
        self.columns.iter().flatten().copied().collect()
    }

    /// The raw row nearest a time, never a decimated vertex: the crosshair's snap.
    pub fn nearest(&self, at: f64) -> Option<usize> {
        let i = self.t.partition_point(|&t| t < at);
        match (i.checked_sub(1), (i < self.t.len()).then_some(i)) {
            (Some(a), Some(b)) => Some(if at - self.t[a] <= self.t[b] - at {
                a
            } else {
                b
            }),
            (a, b) => a.or(b),
        }
    }
}
