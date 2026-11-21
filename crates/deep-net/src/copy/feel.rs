//! #280: what net.feel reads on one copy (canvas primitives: Check input: net kinds): the time it
//! stalled, waiting at its window or in lockstep for a message; each rollback's depth in match
//! steps; and correction distance, how far each named item's evaluated position at a frame's
//! time moved between what the copy drew before a rollback and what it draws after it. Every
//! time is the relay's virtual clock, so a run repeats exactly from its seed.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{Copy, Planted, Stepper};
use crate::kind::FLICKS;

/// An item's evaluated position, as the copy's stepper reads it.
pub type Positions = Vec<(String, [f64; 3])>;

#[derive(Debug, Default)]
pub(super) struct Meter {
    /// The step the copy was about to run when the first late entry since its last rollback came.
    arrived: Option<i64>,
    /// Each rollback's depth counted from that step (the planted meter's).
    from_arrival: Vec<i64>,
    /// Each named item's correction at each rollback, `(item, metres)`.
    corrections: Vec<(String, f64)>,
    /// The planted meter's frames, by the match step whose time each shows, and each item's move
    /// from the frame before as drawn.
    frames: BTreeMap<i64, Positions>,
    moves: BTreeMap<i64, Vec<(String, f64)>>,
    /// The planted meter's host clock, and the wall time it counted while the copy waited.
    clock: Option<fn() -> i64>,
    wall: (Option<i64>, i64),
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    (0..3).map(|i| (a[i] - b[i]).powi(2)).sum::<f64>().sqrt()
}

/// Each item's distance between two readings of the same items.
fn moved(before: &Positions, after: &Positions) -> Vec<(String, f64)> {
    before
        .iter()
        .filter_map(|(id, a)| {
            let (_, b) = after.iter().find(|(other, _)| other == id)?;
            Some((id.clone(), distance(*a, *b)))
        })
        .collect()
}

/// The nearest-rank percentile `p` of `values`, 0 with none.
pub fn percentile(values: &[f64], p: f64) -> f64 {
    let mut v: Vec<f64> = values.iter().copied().filter(|x| x.is_finite()).collect();
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(f64::total_cmp);
    let rank = ((p / 100.0) * v.len() as f64).ceil().max(1.0) as usize;
    v[rank.min(v.len()) - 1]
}

impl<S: Stepper> Copy<S> {
    /// A late entry came while the copy was about to run its next step.
    pub(super) fn late_came(&mut self) {
        self.feel.arrived.get_or_insert(self.next);
    }

    /// The positions the frame drawn after step `next − 1` shows, at that step's time: frames
    /// are on the step grid.
    pub(super) fn shown_now(&mut self) -> Positions {
        let t = (self.next - 1).max(0) * self.cfg.step();
        self.sim.positions(t)
    }

    /// A rollback replaced the steps up to `ran`: what the copy draws at its last frame's time
    /// now against what it drew there before.
    pub(super) fn corrected(&mut self, before: &Positions, ran: i64) {
        let arrived = self.feel.arrived.take().unwrap_or(ran);
        self.feel.from_arrival.push(ran - arrived);
        let after = self.shown_now();
        if self.planted != Planted::MetersFrameToFrame {
            self.feel.corrections.extend(moved(before, &after));
            return;
        }
        // The planted meter redraws that frame and reads its move from the frame before it.
        let frame = ran - 1;
        let from = self
            .feel
            .frames
            .get(&(frame - 1))
            .cloned()
            .unwrap_or_default();
        self.feel.moves.insert(frame, moved(&from, &after));
        self.feel.frames.insert(frame, after);
    }

    /// Each tick's frame: the planted meters read each frame's move from the frame before, and
    /// the wall clock's time while the copy waits.
    pub(super) fn drew(&mut self) {
        if let Some(clock) = self.feel.clock {
            let now = clock();
            let waiting = self.waits.last().is_some_and(|w| w.to.is_none());
            if let (Some(last), true) = (self.feel.wall.0, waiting) {
                self.feel.wall.1 += now - last;
            }
            self.feel.wall.0 = Some(now);
        }
        if self.planted != Planted::MetersFrameToFrame || self.next == 0 {
            return;
        }
        let frame = self.next - 1;
        if self.feel.frames.contains_key(&frame) {
            return;
        }
        let now = self.shown_now();
        let from = self
            .feel
            .frames
            .get(&(frame - 1))
            .cloned()
            .unwrap_or_default();
        self.feel.moves.insert(frame, moved(&from, &now));
        self.feel.frames.insert(frame, now);
    }

    /// The planted meter's host clock, in ns: it times the copy's stalls on the wall clock.
    pub fn clock(&mut self, clock: fn() -> i64) {
        if self.planted == Planted::MetersWallClock {
            self.feel.clock = Some(clock);
        }
    }

    /// The frame that lets a copy waiting at its window run frees its wait, at its arrival.
    pub(super) fn freed(&mut self, now: i64) {
        if self.cfg.window == 0 || self.blocked().is_some() {
            return;
        }
        if let Some(w) = self.waits.last_mut().filter(|w| w.to.is_none()) {
            w.freed.get_or_insert(now);
        }
    }

    /// net.feel's readings: stall time per minute of the match's steps, each rollback's depth and
    /// each named item's correction, with their p50 and p99.
    pub fn feel(&self, steps: i64) -> Value {
        let len = self.cfg.step();
        let stalled: i64 = self
            .waits
            .iter()
            .map(|w| {
                let end = w.freed.or(w.to).unwrap_or(self.now);
                match self.planted {
                    // The planted meter counts the held message's whole delay: from when it was
                    // made, `delay` steps before its step, on this copy's clock.
                    Planted::MetersWholeDelay => {
                        end - w.from + (w.step - w.awaited + self.cfg.delay) * len
                    }
                    _ => end - w.from,
                }
            })
            .map(|t| t.max(0))
            .sum();
        let minutes = (steps * len) as f64 / (60 * FLICKS) as f64;
        let ms = match self.feel.clock {
            Some(_) => self.feel.wall.1 as f64 / 1e6,
            None => stalled as f64 * 1000.0 / FLICKS as f64,
        };
        let depths: Vec<f64> = match self.planted {
            Planted::MetersDepthFromArrival => {
                self.feel.from_arrival.iter().map(|d| *d as f64).collect()
            }
            _ => self
                .roll
                .rollbacks
                .iter()
                .map(|(to, s)| (to - s) as f64)
                .collect(),
        };
        let corrections: Vec<(String, f64)> = match self.planted {
            Planted::MetersFrameToFrame => self.feel.moves.values().flatten().cloned().collect(),
            _ => self.feel.corrections.clone(),
        };
        let per_item = |id: Option<&str>| -> Vec<f64> {
            corrections
                .iter()
                .filter(|(i, _)| id.is_none_or(|id| i == id))
                .map(|(_, m)| *m)
                .collect()
        };
        let all = per_item(None);
        let mut items: Vec<&str> = corrections.iter().map(|(i, _)| i.as_str()).collect();
        items.sort_unstable();
        items.dedup();
        let by_item: serde_json::Map<String, Value> = items
            .into_iter()
            .map(|id| {
                let v = per_item(Some(id));
                (
                    id.to_string(),
                    json!({"p50": percentile(&v, 50.0), "p99": percentile(&v, 99.0)}),
                )
            })
            .collect();
        // A wait still open at the end: the player and the step whose message never came.
        let waiting = self
            .waits
            .last()
            .filter(|w| w.to.is_none() && w.freed.is_none())
            .map(|w| json!({"player": w.player, "step": w.awaited}));
        json!({
            "copy": self.me,
            "waiting": waiting,
            "stall_ms_per_min": if minutes > 0.0 { ms / minutes } else { 0.0 },
            "stall_ms": ms,
            "depth": {"p50": percentile(&depths, 50.0), "p99": percentile(&depths, 99.0), "count": depths.len()},
            "correction": {"p50": percentile(&all, 50.0), "p99": percentile(&all, 99.0), "count": all.len(), "items": by_item},
        })
    }
}
