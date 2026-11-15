//! Issue #522: the checkpoint ring (canvas primitives: Checkpoint ring). A deep checkpoint every
//! `every` steps; when the ring passes its byte budget the spacing doubles and every checkpoint
//! off the new spacing leaves it, so it never holds more than its budget and still reaches back
//! to the start. A seek or a late input restores the one at or before its step.

use crate::backend::Checkpoint;

/// One checkpoint the ring keeps: the backend's whole-world state, its deep hash (of the bytes)
/// and its step hash (of the canonical state).
#[derive(Clone, Debug, PartialEq)]
pub struct Kept {
    pub checkpoint: Checkpoint,
    pub deep_hash: String,
    pub step_hash: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Ring {
    pub budget: u64,
    /// Steps between checkpoints: `every`, doubled each time the ring passed its budget.
    pub spacing: u64,
    pub kept: Vec<Kept>,
    /// The planted ring (#522): drops its oldest checkpoint instead of doubling its spacing.
    pub drops_oldest: bool,
}

impl Ring {
    pub fn new(every: u64, budget: u64) -> Ring {
        Ring {
            budget,
            spacing: every.max(1),
            kept: Vec::new(),
            drops_oldest: false,
        }
    }

    /// Whether step `k` takes a checkpoint.
    pub fn due(&self, k: u64) -> bool {
        k > 0 && k.is_multiple_of(self.spacing) && self.kept.iter().all(|c| c.checkpoint.step != k)
    }

    pub fn bytes(&self) -> u64 {
        self.kept
            .iter()
            .map(|c| c.checkpoint.state.len() as u64)
            .sum()
    }

    /// Keeps `c`, in step order. While keeping it would pass the budget the spacing doubles and
    /// every checkpoint off it leaves, `c` too when it is off it, so the ring never holds more than
    /// its budget; one checkpoint larger than the whole budget isn't kept.
    pub fn offer(&mut self, c: Kept) {
        let size = c.checkpoint.state.len() as u64;
        while self.bytes() + size > self.budget {
            if self.kept.is_empty() {
                return;
            }
            if self.drops_oldest {
                self.kept.remove(0);
                continue;
            }
            self.spacing *= 2;
            let s = self.spacing;
            self.kept.retain(|k| k.checkpoint.step.is_multiple_of(s));
            if !c.checkpoint.step.is_multiple_of(s) {
                return;
            }
        }
        let at = self
            .kept
            .partition_point(|k| k.checkpoint.step < c.checkpoint.step);
        self.kept.insert(at, c);
    }

    /// The checkpoint at or before step `k`.
    pub fn at_or_before(&self, k: u64) -> Option<&Kept> {
        self.kept.iter().rev().find(|c| c.checkpoint.step <= k)
    }

    /// Drops every checkpoint after step `k`, which a fork or a late input replaced.
    pub fn drop_after(&mut self, k: u64) {
        self.kept.retain(|c| c.checkpoint.step <= k);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kept(step: u64) -> Kept {
        Kept {
            checkpoint: Checkpoint {
                backend: "b".into(),
                version: "1".into(),
                features: Vec::new(),
                step,
                state: vec![0; 10],
            },
            deep_hash: String::new(),
            step_hash: String::new(),
        }
    }

    fn fill(ring: &mut Ring, steps: u64) {
        for k in 1..=steps {
            if ring.due(k) {
                ring.offer(kept(k));
            }
        }
    }

    // Criterion 6's arithmetic: every 60 over 7,200 steps with room for 20 checkpoints doubles
    // to 480 apart and reaches back to the start; the planted ring keeps the last 20 only.
    #[test]
    fn doubles_within_budget_and_the_planted_ring_forgets() {
        let mut ring = Ring::new(60, 200);
        fill(&mut ring, 7200);
        assert_eq!(ring.spacing, 480);
        assert!(ring.bytes() <= 200);
        assert_eq!(ring.kept[0].checkpoint.step, 480);
        assert!(ring
            .kept
            .windows(2)
            .all(|w| w[1].checkpoint.step - w[0].checkpoint.step == 480));
        let mut planted = Ring {
            drops_oldest: true,
            ..Ring::new(60, 200)
        };
        fill(&mut planted, 7200);
        assert_eq!(planted.kept[0].checkpoint.step, 6060);
        assert!(planted.at_or_before(6000).is_none());
        // Room for 20 means 20, never 21 for a moment.
        assert_eq!(planted.bytes(), 200);
    }
}
