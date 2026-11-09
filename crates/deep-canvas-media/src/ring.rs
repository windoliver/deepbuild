//! The checkpoint ring (canvas primitives: Processor): state is checkpointed on a fixed grid,
//! `checkpoint_every` apart, until the ring passes its byte budget and the spacing doubles, so a
//! seek restores a checkpoint and renders at most one spacing forward.

use std::collections::BTreeMap;

pub struct Ring<S> {
    budget: usize,
    /// The spacing, in checkpoint slots (whole multiples of `checkpoint_every`).
    every: i64,
    entries: BTreeMap<i64, (i64, S, usize)>,
    bytes: usize,
    /// The planted ring: past its budget it drops its oldest checkpoint instead.
    drop_oldest: bool,
    peak: usize,
}

impl<S> Ring<S> {
    pub fn new(budget: usize, drop_oldest: bool) -> Self {
        Ring {
            budget,
            every: 1,
            entries: BTreeMap::new(),
            bytes: 0,
            drop_oldest,
            peak: 0,
        }
    }

    /// Whether slot `slot` is on the current grid.
    pub fn wants(&self, slot: i64) -> bool {
        slot % self.every == 0 && !self.entries.contains_key(&slot)
    }

    /// Keeps `state` (of `bytes`) for slot `slot`, taken at device sample `sample`. A ring that
    /// would pass its budget doubles its spacing first, dropping the checkpoints off the new grid,
    /// so it never holds more than its budget.
    pub fn put(&mut self, slot: i64, sample: i64, state: S, bytes: usize) {
        while self.bytes + bytes > self.budget && !self.entries.is_empty() {
            if self.drop_oldest {
                if let Some((_, (_, _, b))) = self.entries.pop_first() {
                    self.bytes -= b;
                }
                continue;
            }
            self.every *= 2;
            let every = self.every;
            let gone: Vec<i64> = self.entries.keys().filter(|s| *s % every != 0).copied().collect();
            for s in gone {
                if let Some((_, _, b)) = self.entries.remove(&s) {
                    self.bytes -= b;
                }
            }
            if slot % every != 0 {
                return;
            }
        }
        self.bytes += bytes;
        self.peak = self.peak.max(self.bytes);
        self.entries.insert(slot, (sample, state, bytes));
    }

    /// The latest checkpoint at or before device sample `sample`: its slot and state.
    pub fn at_or_before(&self, sample: i64) -> Option<(i64, &S)> {
        self.entries
            .iter()
            .filter(|(_, (s, _, _))| *s <= sample)
            .max_by_key(|(slot, _)| **slot)
            .map(|(slot, (_, st, _))| (*slot, st))
    }

    /// The checkpoint of slot `slot`.
    pub fn get(&self, slot: i64) -> Option<&S> {
        self.entries.get(&slot).map(|e| &e.1)
    }

    pub fn budget(&self) -> usize {
        self.budget
    }

    pub fn peak(&self) -> usize {
        self.peak
    }

    /// Each checkpoint kept: its slot and bytes.
    pub fn kept(&self) -> Vec<(i64, usize)> {
        self.entries.iter().map(|(s, e)| (*s, e.2)).collect()
    }

    pub fn bytes(&self) -> usize {
        self.bytes
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn every(&self) -> i64 {
        self.every
    }

}
