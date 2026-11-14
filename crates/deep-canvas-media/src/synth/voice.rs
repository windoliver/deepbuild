//! #204: one sounding voice of a synth preset (canvas primitives: Synth `synth@1`, As built): every
//! node's state, preallocated, and its render, a block (or the rest of one, from the sample a voice
//! starts on) at a time in the preset's evaluation order. Nothing here allocates, locks or calls a
//! platform transcendental per sample: an osc's sine is our own polynomial on a u64 phase, and the
//! coefficients a block needs come from `deep_canvas::ops` once a block.

use deep_canvas::expr::noise::hash32;
use deep_canvas::ops;

use super::preset::{Color, Curve, Field, Kind, Preset, Wave, BLOCK, DELAY_MAX, STRING_LOWEST};
use crate::eq;

/// The wrong programs the proof surfaces plant in a voice (#204).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Twists {
    /// An osc whose phase a checkpoint keeps in f32.
    pub phase_f32: bool,
    /// A shaper with a bias of 0.001 before its curve.
    pub shaper_bias: bool,
    /// A crush that quantizes to one bit fewer than it names.
    pub crush_short_bit: bool,
}

/// One node's state: what a checkpoint keeps.
#[derive(Clone, Debug, PartialEq)]
pub enum State {
    Osc {
        phase: u64,
    },
    Noise {
        b: [f64; 3],
    },
    Modes {
        y: Vec<[f64; 2]>,
    },
    Line {
        line: Vec<f64>,
        w: usize,
    },
    Env {
        stage: u8,
        level: f64,
        count: f64,
        step: f64,
    },
    Biquad {
        s: [f64; 2],
    },
    Crush {
        held: f64,
        count: f64,
    },
    None,
}

impl State {
    fn bytes(&self) -> usize {
        16 + match self {
            State::Modes { y } => 16 * y.len(),
            State::Line { line, .. } => 8 * line.len() + 8,
            State::Noise { .. } => 24,
            State::Env { .. } => 32,
            State::Biquad { .. } | State::Crush { .. } => 16,
            State::Osc { .. } => 8,
            State::None => 0,
        }
    }
}

/// A voice's checkpoint: the samples it has rendered and its nodes' states.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot {
    pub n: u64,
    pub states: Vec<State>,
}

impl Snapshot {
    pub fn bytes(&self) -> usize {
        8 + self.states.iter().map(State::bytes).sum::<usize>()
    }
}

pub struct Voice {
    /// Samples rendered since the voice started.
    pub n: u64,
    pub states: Vec<State>,
    /// hash(seed, synth ID, voice): the noise's key.
    key: u32,
    /// The voice-local sample its span ends on: where every env's gate closes.
    gate: u64,
    rate: f64,
    bufs: Vec<[f64; BLOCK]>,
    inb: [f64; BLOCK],
    modb: [f64; BLOCK],
    twists: Twists,
}

/// The 32-bit hash of one word folded into `h` (the expression noise's mix).
pub fn fold(h: u32, v: u32) -> u32 {
    hash32(
        h ^ v
            .wrapping_add(0x9e37_79b9)
            .wrapping_add(h << 6)
            .wrapping_add(h >> 2),
    )
}

/// hash(seed, synth ID, voice): a voice's noise key.
pub fn key(seed: u64, id: &str, voice: u32) -> u32 {
    let mut h = fold(fold(0x2c1b_3c6d, seed as u32), (seed >> 32) as u32);
    for b in id.bytes() {
        h = fold(h, u32::from(b));
    }
    fold(h, voice)
}

/// sin 2πp for the phase p = `phase` ÷ 2⁶⁴: a quadrant fold and an odd Taylor polynomial to the
/// 15th power on the quarter cycle, within 1e-11 of the sine.
pub fn sine(phase: u64) -> f64 {
    let quadrant = phase >> 62;
    let r = ((phase << 2) >> 11) as f64 * (1.0 / (1u64 << 53) as f64);
    let x = if quadrant & 1 == 1 { 1.0 - r } else { r };
    let y = x * (ops::PI / 2.0);
    let y2 = y * y;
    let s = y
        * (1.0
            + y2 * (-1.0 / 6.0
                + y2 * (1.0 / 120.0
                    + y2 * (-1.0 / 5_040.0
                        + y2 * (1.0 / 362_880.0
                            + y2 * (-1.0 / 39_916_800.0
                                + y2 * (1.0 / 6_227_020_800.0
                                    + y2 * (-1.0 / 1_307_674_368_000.0))))))));
    if quadrant >= 2 {
        -s
    } else {
        s
    }
}

/// A fraction of a cycle as a u64 phase step, wrapping.
fn step_of(cycles: f64) -> u64 {
    let w = cycles - cycles.floor();
    (w * 18_446_744_073_709_551_616.0) as u64
}

const TWO_64: f64 = 18_446_744_073_709_551_616.0;

/// Pink noise's three poles and their weights, and the output's scale.
const PINK: [(f64, f64); 3] = [
    (0.997_65, 0.099_046),
    (0.963, 0.296_516_4),
    (0.57, 1.052_691_3),
];
const PINK_DIRECT: f64 = 0.184_8;
const PINK_SCALE: f64 = 0.11;
/// Brown noise's leak and scale.
const BROWN_LEAK: f64 = 1.0 / 1.02;
const BROWN_STEP: f64 = 0.02 / 1.02;
const BROWN_SCALE: f64 = 3.5;

/// ln 1000: a resonator falls 60 dB over its t60.
const LN_1000: f64 = 6.907_755_278_982_137;

/// A node's line length in samples at `rate`: a delay's longest time, or a string's lowest period,
/// plus a block for a delay on a cycle and the read's own reach.
pub fn line_len(p: &Preset, kind: &Kind, rate: f64) -> usize {
    match kind {
        Kind::Delay { time, .. } => {
            let hi = p.span(*time).1.min(DELAY_MAX);
            (hi * rate).ceil() as usize + BLOCK + 2
        }
        Kind::String { hz, .. } => {
            let lo = p.span(*hz).0.max(STRING_LOWEST);
            (rate / lo).ceil() as usize + 4
        }
        _ => 0,
    }
}

fn fresh(p: &Preset, kind: &Kind, rate: f64) -> State {
    match kind {
        Kind::Osc { .. } => State::Osc { phase: 0 },
        Kind::Noise { .. } => State::Noise { b: [0.0; 3] },
        Kind::Modes { ratios, .. } => State::Modes {
            y: vec![[0.0; 2]; ratios.len()],
        },
        Kind::String { .. } | Kind::Delay { .. } => State::Line {
            line: vec![0.0; line_len(p, kind, rate)],
            w: 0,
        },
        Kind::Env { .. } => State::Env {
            stage: 0,
            level: 0.0,
            count: 0.0,
            step: 0.0,
        },
        Kind::Biquad { .. } => State::Biquad { s: [0.0; 2] },
        Kind::Crush { .. } => State::Crush {
            held: 0.0,
            count: 0.0,
        },
        _ => State::None,
    }
}

impl Voice {
    /// A fresh voice of `p` at `rate`, whose span ends `gate` samples after it starts.
    pub fn new(p: &Preset, rate: i64, key: u32, gate: u64, twists: Twists) -> Voice {
        let r = rate as f64;
        Voice {
            n: 0,
            states: p.nodes.iter().map(|n| fresh(p, &n.kind, r)).collect(),
            key,
            gate,
            rate: r,
            bufs: vec![[0.0; BLOCK]; p.nodes.len()],
            inb: [0.0; BLOCK],
            modb: [0.0; BLOCK],
            twists,
        }
    }

    /// What a checkpoint keeps; the planted osc keeps its phase in f32 there.
    pub fn snapshot(&self) -> Snapshot {
        let mut states = self.states.clone();
        if self.twists.phase_f32 {
            for s in &mut states {
                if let State::Osc { phase } = s {
                    *phase = ((*phase as f64 / TWO_64) as f32 as f64 * TWO_64) as u64;
                }
            }
        }
        Snapshot { n: self.n, states }
    }

    pub fn restore(&mut self, s: &Snapshot) {
        self.n = s.n;
        for (dst, src) in self.states.iter_mut().zip(&s.states) {
            dst.clone_from(src);
        }
    }

    /// Takes on `other`'s state of each biquad (the planted steal that keeps filter state).
    pub fn keep_filters_of(&mut self, other: &Voice) {
        for (dst, src) in self.states.iter_mut().zip(&other.states) {
            if let (State::Biquad { .. }, State::Biquad { .. }) = (&*dst, src) {
                dst.clone_from(src);
            }
        }
    }

    /// Renders block samples `from..BLOCK` into `out[from..]` (mono), each param moving linearly
    /// across the block from its reading `a` to the next block's `b`.
    pub fn render(
        &mut self,
        p: &Preset,
        a: &[f64],
        b: &[f64],
        from: usize,
        out: &mut [f64; BLOCK],
    ) {
        let from = from.min(BLOCK);
        for o in &mut self.bufs {
            o[..from].fill(0.0);
        }
        out[..from].fill(0.0);
        self.render_part(p, a, b, (from, BLOCK), (0, BLOCK), out);
    }

    /// Zeroes every node's output below block sample `from`, where a voice that starts there
    /// rendered nothing (`render` does it itself).
    pub fn zero_before(&mut self, from: usize) {
        for o in &mut self.bufs {
            o[..from.min(BLOCK)].fill(0.0);
        }
    }

    /// Each node's output over the block last rendered, in the preset's order.
    pub fn node_out(&self, k: usize) -> &[f64; BLOCK] {
        &self.bufs[k]
    }

    /// Renders block samples `part.0..part.1` into `out`, each param moving linearly from its
    /// reading `a` at sample `ramp.0` to `b` at sample `ramp.1`.
    // Each node's loop reads its inputs and writes its output at the same sample index.
    #[allow(clippy::needless_range_loop)]
    pub fn render_part(
        &mut self,
        p: &Preset,
        a: &[f64],
        b: &[f64],
        part: (usize, usize),
        ramp: (usize, usize),
        out: &mut [f64; BLOCK],
    ) {
        let rate = self.rate;
        let n0 = self.n;
        let (from, to) = (part.0.min(BLOCK), part.1.min(BLOCK));
        if from >= to {
            return;
        }
        let len = to - from;
        let width = (ramp.1 - ramp.0).max(1) as f64;
        let at = |f: Field, i: usize| -> f64 {
            match f {
                Field::Num(v) => v,
                Field::Param(k) => a[k] + (b[k] - a[k]) * (i as f64 - ramp.0 as f64) / width,
            }
        };
        let read = |f: Field| -> f64 {
            match f {
                Field::Num(v) => v,
                Field::Param(k) => a[k],
            }
        };
        // A delay on a cycle writes its output from its past first.
        for (k, node) in p.nodes.iter().enumerate() {
            if !node.breaks {
                continue;
            }
            let (Kind::Delay { time, .. }, State::Line { line, w }) = (&node.kind, &self.states[k])
            else {
                continue;
            };
            let cap = line.len();
            let o = &mut self.bufs[k];
            for i in from..to {
                let d = ((at(*time, i) * rate).round() as usize).clamp(BLOCK, cap - 1);
                let j = (w + (i - from) + cap - d) % cap;
                o[i] = line[j];
            }
        }
        for k in 0..p.nodes.len() {
            let node = &p.nodes[k];
            // The node's `in`: its edges summed; its mods likewise.
            self.inb[from..to].fill(0.0);
            for &j in &node.ins {
                for i in from..to {
                    self.inb[i] += self.bufs[j][i];
                }
            }
            self.modb[from..to].fill(0.0);
            for &j in &node.mods {
                for i in from..to {
                    self.modb[i] += self.bufs[j][i];
                }
            }
            let inb = &self.inb;
            let modb = &self.modb;
            let o = &mut self.bufs[k];
            match (&node.kind, &mut self.states[k]) {
                (Kind::Osc { wave, hz }, State::Osc { phase }) => {
                    let mut f0 = at(*hz, from) + modb[from];
                    for i in from..to {
                        let f1 = at(*hz, i + 1) + modb[i];
                        o[i] = match wave {
                            Wave::Sine => sine(*phase),
                            Wave::Saw => 2.0 * (*phase as f64 / TWO_64) - 1.0,
                            Wave::Square => {
                                if *phase < 1 << 63 {
                                    1.0
                                } else {
                                    -1.0
                                }
                            }
                            Wave::Triangle => {
                                let q = phase.wrapping_add(1 << 62) as f64 / TWO_64;
                                1.0 - 4.0 * (q - 0.5).abs()
                            }
                        };
                        *phase = phase.wrapping_add(step_of((f0 + f1) * 0.5 / rate));
                        f0 = f1;
                    }
                }
                (Kind::Noise { color }, State::Noise { b }) => {
                    for i in from..to {
                        let n = n0 + (i - from) as u64;
                        let h = fold(fold(self.key, n as u32), (n >> 32) as u32);
                        let white = f64::from(h) / 2_147_483_648.0 - 1.0;
                        o[i] = match color {
                            Color::White => white,
                            Color::Pink => {
                                for (s, (pole, weight)) in b.iter_mut().zip(PINK) {
                                    *s = pole * *s + weight * white;
                                }
                                (b[0] + b[1] + b[2] + PINK_DIRECT * white) * PINK_SCALE
                            }
                            Color::Brown => {
                                b[0] = BROWN_LEAK * b[0] + BROWN_STEP * white;
                                b[0] * BROWN_SCALE
                            }
                        };
                    }
                }
                (Kind::Modes { ratios, t60s, hz }, State::Modes { y }) => {
                    let base = read(*hz);
                    for (m, (ratio, t60)) in ratios.iter().zip(t60s).enumerate() {
                        let w0 = (2.0 * ops::PI * base * ratio / rate).clamp(0.0, ops::PI * 0.999);
                        let r = ops::exp(-LN_1000 / (t60 * rate));
                        let (c1, c2, g) = (2.0 * r * ops::cos(w0), r * r, 1.0 - r);
                        let s = &mut y[m];
                        for i in from..to {
                            let v = c1 * s[0] - c2 * s[1] + g * inb[i];
                            s[1] = s[0];
                            s[0] = v;
                            if m == 0 {
                                o[i] = v;
                            } else {
                                o[i] += v;
                            }
                        }
                    }
                }
                (Kind::String { hz, damping }, State::Line { line, w }) => {
                    let cap = line.len();
                    let period =
                        (rate / read(*hz).max(STRING_LOWEST) - 0.5).clamp(1.0, cap as f64 - 3.0);
                    let g = 0.5 * (1.0 - read(*damping).clamp(0.0, 1.0));
                    let whole = period.floor() as usize;
                    let frac = period - whole as f64;
                    for i in from..to {
                        let tap = |back: usize| line[(*w + cap - back) % cap];
                        let d0 = tap(whole) * (1.0 - frac) + tap(whole + 1) * frac;
                        let d1 = tap(whole + 1) * (1.0 - frac) + tap(whole + 2) * frac;
                        let v = inb[i] + g * (d0 + d1);
                        line[*w] = v;
                        *w = (*w + 1) % cap;
                        o[i] = v;
                    }
                }
                (
                    Kind::Env {
                        attack,
                        hold,
                        decay,
                        sustain,
                        release,
                    },
                    State::Env {
                        stage,
                        level,
                        count,
                        step,
                    },
                ) => {
                    let (at_s, hold_s, decay_s, rel_s) =
                        (read(*attack), read(*hold), read(*decay), read(*release));
                    for i in from..to {
                        let n = n0 + (i - from) as u64;
                        let sus = at(*sustain, i).clamp(0.0, 1.0);
                        if n >= self.gate && *stage < 4 {
                            *stage = 4;
                            *step = if rel_s > 0.0 {
                                *level / (rel_s * rate)
                            } else {
                                *level
                            };
                        }
                        match *stage {
                            0 => {
                                *level = if at_s > 0.0 {
                                    *level + 1.0 / (at_s * rate)
                                } else {
                                    1.0
                                };
                                if *level >= 1.0 {
                                    *level = 1.0;
                                    *stage = 1;
                                    *count = 0.0;
                                }
                            }
                            1 => {
                                *count += 1.0;
                                if *count >= hold_s * rate {
                                    *stage = 2;
                                }
                            }
                            2 => {
                                *level = if decay_s > 0.0 {
                                    *level - (1.0 - sus) / (decay_s * rate)
                                } else {
                                    sus
                                };
                                if *level <= sus {
                                    *level = sus;
                                    *stage = 3;
                                }
                            }
                            3 => *level = sus,
                            4 => {
                                *level -= *step;
                                if *level <= 0.0 {
                                    *level = 0.0;
                                    *stage = 5;
                                }
                            }
                            _ => *level = 0.0,
                        }
                        o[i] = *level;
                    }
                }
                (Kind::Biquad { ty, freq, q, gain }, State::Biquad { s }) => {
                    let band = eq::Band {
                        kind: *ty,
                        freq: read(*freq),
                        q: read(*q),
                        gain: read(*gain),
                    };
                    let c = eq::coefficients(&band, rate);
                    for i in from..to {
                        let v = inb[i];
                        let y = c[0] * v + s[0];
                        s[0] = c[1] * v - c[3] * y + s[1];
                        s[1] = c[2] * v - c[4] * y;
                        o[i] = y;
                    }
                }
                (Kind::Shaper { curve, drive, mix }, _) => {
                    let g = ops::pow(10.0, read(*drive) / 20.0);
                    let bias = if self.twists.shaper_bias { 0.001 } else { 0.0 };
                    for i in from..to {
                        let x = inb[i];
                        let m = at(*mix, i);
                        o[i] = (1.0 - m) * x + m * shape(*curve, g * x + bias);
                    }
                }
                (Kind::Crush { bits, hold_hz, mix }, State::Crush { held, count }) => {
                    let named = read(*bits).round().clamp(1.0, 16.0);
                    let bits = if self.twists.crush_short_bit {
                        named - 1.0
                    } else {
                        named
                    };
                    let qstep = ops::powi(2.0, 1 - bits as i32);
                    let hold = read(*hold_hz);
                    let period = if hold > 0.0 { rate / hold } else { 0.0 };
                    for i in from..to {
                        let x = inb[i];
                        let quantized = (x / qstep).round() * qstep;
                        if period > 0.0 {
                            if *count <= 0.0 {
                                *held = quantized;
                                *count += period;
                            }
                            *count -= 1.0;
                        } else {
                            *held = quantized;
                        }
                        let m = at(*mix, i);
                        o[i] = (1.0 - m) * x + m * *held;
                    }
                }
                (
                    Kind::Delay {
                        time,
                        feedback,
                        mix,
                    },
                    State::Line { line, w },
                ) => {
                    let cap = line.len();
                    let least = if node.breaks { BLOCK } else { 1 };
                    for i in from..to {
                        let d = ((at(*time, i) * rate).round() as usize).clamp(least, cap - 1);
                        let wet = line[(*w + cap - d) % cap];
                        let x = inb[i];
                        line[*w] = x + at(*feedback, i) * wet;
                        *w = (*w + 1) % cap;
                        if !node.breaks {
                            let m = at(*mix, i);
                            o[i] = (1.0 - m) * x + m * wet;
                        }
                    }
                }
                (Kind::Gain { gain }, _) => {
                    for i in from..to {
                        o[i] = inb[i] * (at(*gain, i) + modb[i]);
                    }
                }
                (Kind::Mix, _) => o[from..to].copy_from_slice(&inb[from..to]),
                _ => o[from..to].fill(0.0),
            }
        }
        out[from..to].copy_from_slice(&self.bufs[p.out][from..to]);
        self.n = n0 + len as u64;
    }
}

/// A shaper's curve at `u`.
pub fn shape(curve: Curve, u: f64) -> f64 {
    match curve {
        Curve::Tanh => ops::tanh(u),
        Curve::SoftClip => {
            if u.abs() <= 1.0 {
                1.5 * u - 0.5 * u * u * u
            } else {
                u.signum()
            }
        }
        Curve::Fold => {
            // Folded back at ±1: a triangle of period 4 through the origin.
            let v = (u + 1.0).rem_euclid(4.0);
            if v <= 2.0 {
                v - 1.0
            } else {
                3.0 - v
            }
        }
    }
}
