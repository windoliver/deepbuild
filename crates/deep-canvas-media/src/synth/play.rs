//! #204: a synth as the mix plays it (canvas primitives: Synth `synth@1`, As built): a strip's
//! preset, its params as functions of document time, its voices' keys, and the voices that render
//! it a block at a time on the mix's grid, with its own checkpoint ring.

use std::sync::Arc;

use super::preset::{Preset, BLOCK};
use super::voice::{Snapshot, Twists, Voice};
use crate::ring::Ring;

/// A param as the host compiled it: a constant, or its expression as a function of document time
/// in flicks (t, channels, logic arrays), already clamped to its range.
#[derive(Clone)]
pub enum Param {
    Const(f64),
    Curve(Arc<dyn Fn(i64) -> f64 + Send + Sync>),
}

impl Param {
    pub fn at(&self, t: i64) -> f64 {
        match self {
            Param::Const(v) => *v,
            Param::Curve(f) => f(t),
        }
    }
}

/// What a synth strip plays.
#[derive(Clone)]
pub struct Spec {
    /// `<pack>.<name>@<major>`.
    pub name: String,
    pub preset: Arc<Preset>,
    /// One per preset param, in the preset's order.
    pub params: Vec<Param>,
    /// hash(seed, synth ID, voice), one per voice.
    pub keys: Vec<u32>,
    /// Flicks from the strip's start to where its span ends and its envelopes close.
    pub gate: i64,
    /// The derived tail, in flicks: how long it renders after its span ends.
    pub tail: i64,
    /// Its checkpoint ring's byte budget.
    pub budget: usize,
    pub twists: Twists,
    /// The planted synth that reads its params once a frame of this many flicks and holds them.
    pub frame_hold: Option<i64>,
    /// The planted steal: the strip whose voice it takes the filter state of when it starts.
    pub inherits: Option<usize>,
}

/// A synth strip's checkpoint: each voice's, and whether they had started.
#[derive(Clone, Debug, PartialEq)]
pub struct Checkpoint {
    pub voices: Vec<Snapshot>,
    pub started: bool,
}

impl Checkpoint {
    pub fn bytes(&self) -> usize {
        1 + self.voices.iter().map(Snapshot::bytes).sum::<usize>()
    }
}

/// A synth strip's voices as they play.
pub struct Live {
    pub voices: Vec<Voice>,
    pub ring: Ring<Checkpoint>,
    /// The block's output, summed over the voices.
    pub out: [f64; BLOCK],
    /// The first voice's nodes' outputs over the block, for their taps: zero where it didn't play.
    pub nodes: Vec<[f32; BLOCK]>,
    a: Vec<f64>,
    b: Vec<f64>,
    voice: [f64; BLOCK],
    /// Whether its voices have rendered a sample since its start (or since a restore of a started one).
    pub started: bool,
    /// The planted grid that starts at a seek: flicks its readings sit off the mix's grid.
    pub shift: i64,
    /// What a host clock said its voices took to render, in its units.
    pub spent: u64,
}

fn voices_of(spec: &Spec, rate: i64) -> Vec<Voice> {
    let gate = (spec.gate.max(0) as i128 * rate as i128 / crate::FLICKS as i128) as u64;
    spec.keys
        .iter()
        .map(|k| Voice::new(&spec.preset, rate, *k, gate, spec.twists))
        .collect()
}

impl Live {
    pub fn new(spec: &Spec, rate: i64, drop_oldest: bool) -> Live {
        let n = spec.params.len();
        Live {
            voices: voices_of(spec, rate),
            ring: Ring::new(spec.budget, drop_oldest),
            out: [0.0; BLOCK],
            nodes: vec![[0.0; BLOCK]; spec.preset.nodes.len()],
            a: vec![0.0; n],
            b: vec![0.0; n],
            voice: [0.0; BLOCK],
            started: false,
            shift: 0,
            spent: 0,
        }
    }

    /// Back to fresh voices, its ring kept.
    pub fn reset(&mut self, spec: &Spec, rate: i64) {
        self.voices = voices_of(spec, rate);
        self.started = false;
    }

    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            voices: self.voices.iter().map(Voice::snapshot).collect(),
            started: self.started,
        }
    }

    pub fn restore(&mut self, c: &Checkpoint) {
        for (v, s) in self.voices.iter_mut().zip(&c.voices) {
            v.restore(s);
        }
        self.started = c.started;
    }

    /// Zeroes the block where the strip doesn't play.
    pub fn silent(&mut self) {
        self.out.fill(0.0);
        for n in &mut self.nodes {
            n.fill(0.0);
        }
    }

    /// Renders the block whose first sample is at document time `t0` (flicks, `step` a sample)
    /// into `out`, from the strip's `start` on: each param read at the instant before the block's
    /// first sample and before the next block's, and ramped between. The planted export's `part`
    /// renders it on sub-blocks of that many samples, each read and ramped the same way.
    pub fn block(&mut self, spec: &Spec, t0: i64, step: i64, start: i64, part: Option<usize>) {
        let from = if start > t0 {
            ((start - t0 + step - 1) / step) as usize
        } else {
            0
        };
        if from >= BLOCK {
            self.silent();
            return;
        }
        let part = part.unwrap_or(BLOCK).clamp(1, BLOCK);
        self.out.fill(0.0);
        for (v, voice) in self.voices.iter_mut().enumerate() {
            let mut lo = 0;
            while lo < BLOCK {
                let hi = (lo + part).min(BLOCK);
                let (t_lo, t_hi) = (
                    t0 + self.shift + lo as i64 * step,
                    t0 + self.shift + hi as i64 * step,
                );
                for (k, p) in spec.params.iter().enumerate() {
                    (self.a[k], self.b[k]) = match spec.frame_hold {
                        // Read at the frame's left limit and held for the frame.
                        Some(f) => {
                            let x = p.at(t_lo.div_euclid(f) * f - 1);
                            (x, x)
                        }
                        None => (p.at(t_lo - 1), p.at(t_hi - 1)),
                    };
                }
                if lo == 0 && hi == BLOCK {
                    voice.render(&spec.preset, &self.a, &self.b, from, &mut self.voice);
                } else {
                    if lo == 0 {
                        self.voice[..from].fill(0.0);
                        voice.zero_before(from);
                    }
                    voice.render_part(
                        &spec.preset,
                        &self.a,
                        &self.b,
                        (from.max(lo), hi),
                        (lo, hi),
                        &mut self.voice,
                    );
                }
                lo = hi;
            }
            for (o, x) in self.out.iter_mut().zip(&self.voice) {
                *o += x;
            }
            if v == 0 {
                for (k, n) in self.nodes.iter_mut().enumerate() {
                    for (d, s) in n.iter_mut().zip(voice.node_out(k)) {
                        *d = *s as f32;
                    }
                }
            }
        }
        self.started = true;
    }
}
