//! #204: what the pack check holds a synth preset to beyond its structure (canvas primitives: Synth
//! `synth@1`, As built): its derived tail, and the sweep that renders it at its defaults, at each
//! param's minimum and maximum, and at 16 seeded points, refusing the first render whose sample is
//! not finite or passes 4.0 in magnitude.

use deep_canvas::ops;

use super::preset::{Field, Kind, Preset, BLOCK};
use super::voice::{fold, Twists, Voice};

/// The level a tail runs to: −120 dBFS.
const FLOOR: f64 = 1e-6;
/// The sweep's rate, render length and span, in samples.
pub const SWEEP_RATE: i64 = 48_000;
const SWEEP_LEN: usize = 2 * 48_000;
const SWEEP_SPAN: u64 = 48_000;
/// The magnitude no swept sample may pass, before the master's limiter.
pub const SWEEP_MAX: f64 = 4.0;
/// The seeded points across all ranges.
pub const SEEDED: u32 = 16;

/// A preset's derived tail, s: from its span's end to where its output stays under −120 dBFS, at
/// the worst of each param's range. An out that never stops has none: it ends at the span's fade.
pub fn tail(p: &Preset, twists_half: bool) -> f64 {
    let mut stop = vec![0.0f64; p.nodes.len()];
    let lo = |f: Field| p.span(f).0;
    let hi = |f: Field| p.span(f).1;
    for (k, node) in p.nodes.iter().enumerate() {
        let input = node.ins.iter().map(|&j| stop[j]).fold(0.0, f64::max);
        let modded = node.mods.iter().map(|&j| stop[j]).fold(0.0, f64::max);
        stop[k] = match &node.kind {
            Kind::Osc { .. } | Kind::Noise { .. } => f64::INFINITY,
            Kind::Env { release, .. } => hi(*release).max(0.0),
            Kind::Gain { gain } => {
                let own = if *gain == Field::Num(0.0) {
                    modded
                } else {
                    f64::INFINITY
                };
                input.min(own)
            }
            Kind::Mix => input,
            Kind::Modes { t60s, .. } => input + 2.0 * t60s.iter().copied().fold(0.0, f64::max),
            Kind::String { hz, damping } => {
                let g = 1.0 - lo(*damping);
                if g >= 1.0 || g <= 0.0 {
                    if g <= 0.0 {
                        input
                    } else {
                        f64::INFINITY
                    }
                } else {
                    input + ops::log(FLOOR) / ops::log(g) / lo(*hz).max(1.0)
                }
            }
            Kind::Biquad { ty, freq, q, gain } => input + biquad_ring(p, *ty, *freq, *q, *gain),
            Kind::Shaper { .. } => input,
            Kind::Crush { hold_hz, .. } => {
                let h = lo(*hold_hz);
                input + if h > 0.0 { 1.0 / h } else { 0.0 }
            }
            Kind::Delay { time, feedback, .. } => {
                let fb = hi(*feedback).abs();
                let t = hi(*time);
                if fb >= 1.0 {
                    f64::INFINITY
                } else if fb <= 0.0 {
                    input + t
                } else {
                    let repeats = (ops::log(FLOOR) / ops::log(fb)).ceil();
                    input + (repeats + 1.0) * t
                }
            }
        };
    }
    let t = stop[p.out];
    let t = if t.is_finite() { t } else { 0.0 };
    if twists_half {
        t / 2.0
    } else {
        t
    }
}

/// How long a biquad rings to −120 dB at the worst corner of its params' ranges, s at 48 kHz.
fn biquad_ring(p: &Preset, ty: crate::eq::Type, freq: Field, q: Field, gain: Field) -> f64 {
    let rate = SWEEP_RATE as f64;
    let mut worst = 0.0f64;
    for f in [p.span(freq).0, p.span(freq).1] {
        for qv in [p.span(q).0, p.span(q).1] {
            for g in [p.span(gain).0, p.span(gain).1] {
                let c = crate::eq::coefficients(
                    &crate::eq::Band {
                        kind: ty,
                        freq: f,
                        q: qv,
                        gain: g,
                    },
                    rate,
                );
                let (a1, a2) = (c[3], c[4]);
                let disc = a1 * a1 - 4.0 * a2;
                let r = if disc < 0.0 {
                    ops::sqrt(a2.max(0.0))
                } else {
                    let s = ops::sqrt(disc);
                    ((-a1 + s) / 2.0).abs().max(((-a1 - s) / 2.0).abs())
                };
                if r >= 1.0 {
                    return f64::INFINITY;
                }
                if r > 0.0 {
                    worst = worst.max(ops::log(FLOOR) / ops::log(r) / rate);
                }
            }
        }
    }
    worst
}

/// A render the sweep refused: the param it moved (`all` at a seeded point), its value, and the
/// first sample past the bound with that sample's value.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub param: String,
    pub value: f64,
    pub sample: usize,
    pub level: f64,
}

/// The sweep's renders in order: each a label, the moved value, and every param's value.
pub fn sweep_points(p: &Preset, name: &str) -> Vec<(String, f64, Vec<f64>)> {
    let defaults: Vec<f64> = p.params.iter().map(|q| q.default).collect();
    let mut out = vec![("default".to_string(), f64::NAN, defaults.clone())];
    for (k, q) in p.params.iter().enumerate() {
        for v in [q.lo, q.hi] {
            let mut vals = defaults.clone();
            vals[k] = v;
            out.push((q.name.clone(), v, vals));
        }
    }
    let mut h = 0x5bd1_e995u32;
    for b in name.bytes() {
        h = fold(h, u32::from(b));
    }
    for point in 0..SEEDED {
        let vals: Vec<f64> = p
            .params
            .iter()
            .enumerate()
            .map(|(k, q)| {
                let u = f64::from(fold(fold(h, point), k as u32) >> 8) / f64::from(1u32 << 24);
                q.lo + (q.hi - q.lo) * u
            })
            .collect();
        out.push(("all".to_string(), f64::from(point), vals));
    }
    out
}

/// Renders `p` with `vals` held for 2 s at 48 kHz from a fresh voice whose span is 1 s, and returns
/// the first sample that isn't finite or passes 4.0, with its value.
pub fn render_bound(p: &Preset, vals: &[f64], twists: Twists) -> Option<(usize, f64)> {
    let mut v = Voice::new(p, SWEEP_RATE, 0, SWEEP_SPAN, twists);
    let mut out = [0.0; BLOCK];
    let mut at = 0;
    while at < SWEEP_LEN {
        v.render(p, vals, vals, 0, &mut out);
        for (i, x) in out.iter().enumerate() {
            if at + i >= SWEEP_LEN {
                break;
            }
            if !x.is_finite() || x.abs() > SWEEP_MAX {
                return Some((at + i, *x));
            }
        }
        at += BLOCK;
    }
    None
}

/// The sweep: the first render refused, if any.
pub fn sweep(p: &Preset, name: &str, twists: Twists) -> Option<Refusal> {
    for (param, value, vals) in sweep_points(p, name) {
        if let Some((sample, level)) = render_bound(p, &vals, twists) {
            let value = if param == "all" { f64::NAN } else { value };
            return Some(Refusal {
                param,
                value,
                sample,
                level,
            });
        }
    }
    None
}
