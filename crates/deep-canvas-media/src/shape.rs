//! Issue #155: the shaper, crush and modulate processors (canvas primitives: Processor: shaper,
//! crush and modulate). shaper is memoryless per sample on the synth node's curves, so it keeps no
//! state; crush keeps its held frame and its hold counter, and modulate its delay line and the
//! sample it has reached, so a checkpoint restores either whole and a seek equals a play.

use deep_canvas::ops;
use sha2::{Digest, Sha256};

use crate::synth::preset::Curve;
use crate::synth::voice::shape;

/// `shaper {curve, drive: dB = 6, mix = 1, oversample: 2 | 4 = 4}`.
#[derive(Clone, Copy, Debug)]
pub struct ShaperSpec {
    pub curve: Curve,
    pub drive: f64,
    pub mix: f64,
    pub oversample: u32,
}

pub struct Shaper {
    spec: ShaperSpec,
    gain: f64,
}

impl Shaper {
    pub fn new(spec: ShaperSpec) -> Shaper {
        Shaper {
            spec,
            gain: ops::pow(10.0, spec.drive / 20.0),
        }
    }

    /// y = (1 − mix)·x + mix·curve(10^(drive ÷ 20)·x), per sample.
    pub fn process(&mut self, block: &mut [f32]) {
        let m = self.spec.mix;
        for x in block.iter_mut() {
            let v = f64::from(*x);
            *x = ((1.0 - m) * v + m * shape(self.spec.curve, self.gain * v)) as f32;
        }
    }
}

/// `crush {bits: 1 to 16 = 8, hold_hz = 0 (off), mix = 1}`.
#[derive(Clone, Copy, Debug)]
pub struct CrushSpec {
    pub bits: u8,
    pub hold_hz: f64,
    pub mix: f64,
}

/// The frame crush holds and the samples left before it takes the next.
#[derive(Clone, Copy, Debug, Default)]
pub struct CrushState {
    held: [f64; 2],
    count: f64,
}

pub struct Crush {
    spec: CrushSpec,
    /// The quantizer's step, 2^(1 − bits).
    step: f64,
    /// The hold's period in samples, 0 when off.
    period: f64,
    pub state: CrushState,
}

impl Crush {
    pub fn new(spec: CrushSpec, rate: i64) -> Crush {
        Crush {
            spec,
            step: ops::powi(2.0, 1 - i32::from(spec.bits.clamp(1, 16))),
            period: if spec.hold_hz > 0.0 {
                rate as f64 / spec.hold_hz
            } else {
                0.0
            },
            state: CrushState::default(),
        }
    }

    /// Each sample rounded to the step; with a hold, a frame is taken when the counter runs out
    /// and held for the period, as the synth's crush node does.
    pub fn process(&mut self, block: &mut [f32]) {
        let m = self.spec.mix;
        let st = &mut self.state;
        for frame in block.as_chunks_mut::<2>().0 {
            let x = [f64::from(frame[0]), f64::from(frame[1])];
            let q = x.map(|v| (v / self.step).round() * self.step);
            if self.period > 0.0 {
                if st.count <= 0.0 {
                    st.held = q;
                    st.count += self.period;
                }
                st.count -= 1.0;
            } else {
                st.held = q;
            }
            for ch in 0..2 {
                frame[ch] = ((1.0 - m) * x[ch] + m * st.held[ch]) as f32;
            }
        }
    }
}

/// `modulate {wow_hz = 0.5, flutter_hz = 8, depth: cents = 10, seed}`.
#[derive(Clone, Debug)]
pub struct ModulateSpec {
    pub wow_hz: f64,
    pub flutter_hz: f64,
    pub depth: f64,
    pub seed: String,
}

/// A uniform draw in [0, 1): the top 53 bits of SHA-256(seed, 0, purpose).
fn draw(seed: &str, purpose: &str) -> f64 {
    let mut h = Sha256::new();
    h.update(seed.as_bytes());
    h.update([0]);
    h.update(purpose.as_bytes());
    let d = h.finalize();
    let top = u64::from_be_bytes(d[..8].try_into().unwrap_or_default()) >> 11;
    top as f64 / (1u64 << 53) as f64
}

/// The delay modulate reads at sample n, in samples:
/// base + A_w·sin(2π·wow·n ÷ rate + φ_w) + A_f·sin(2π·flutter·n ÷ rate + φ_f).
/// Each curve's slope peaks at half of 2^(depth ÷ 1200) − 1, so the read's rate, one less the
/// delay's slope, stays within the depth in cents; the phases are 2π times draws of the seed
/// (`wow`, `flutter`), and base is A_w + A_f + 2, so the four-point read never passes the newest
/// sample.
#[derive(Clone, Copy, Debug)]
pub struct Curves {
    base: f64,
    wow: (f64, f64, f64),
    flutter: (f64, f64, f64),
}

impl Curves {
    pub fn new(spec: &ModulateSpec, rate: i64) -> Curves {
        let rate = rate as f64;
        let half = (ops::pow(2.0, spec.depth.max(0.0) / 1200.0) - 1.0) / 2.0;
        let curve = |hz: f64, purpose: &str| {
            let w = 2.0 * ops::PI * hz.max(0.0) / rate;
            let a = if w > 0.0 { half / w } else { 0.0 };
            (a, w, 2.0 * ops::PI * draw(&spec.seed, purpose))
        };
        let (wow, flutter) = (curve(spec.wow_hz, "wow"), curve(spec.flutter_hz, "flutter"));
        Curves {
            base: wow.0 + flutter.0 + 2.0,
            wow,
            flutter,
        }
    }

    pub fn at(&self, n: i64) -> f64 {
        let s = |(a, w, p): (f64, f64, f64)| a * ops::sin(w * n as f64 + p);
        self.base + s(self.wow) + s(self.flutter)
    }

    /// The largest delay, in samples.
    pub fn largest(&self) -> f64 {
        self.base + self.wow.0 + self.flutter.0
    }
}

/// modulate's line, per channel, and the graph sample it has reached.
#[derive(Clone, Debug)]
pub struct ModulateState {
    line: Vec<f32>,
    at: usize,
    n: i64,
}

impl ModulateState {
    pub fn bytes(&self) -> usize {
        4 * self.line.len() + 16
    }
}

pub struct Modulate {
    curves: Curves,
    /// Frames the line holds.
    len: usize,
    pub state: ModulateState,
}

impl Modulate {
    pub fn new(spec: &ModulateSpec, rate: i64) -> Modulate {
        let curves = Curves::new(spec, rate);
        let len = curves.largest().ceil() as usize + 4;
        Modulate {
            curves,
            len,
            state: ModulateState {
                line: vec![0.0; 2 * len],
                at: 0,
                n: 0,
            },
        }
    }

    /// Its tail, in samples: its largest delay.
    pub fn tail(spec: &ModulateSpec, rate: i64) -> i64 {
        Curves::new(spec, rate).largest().ceil() as i64
    }

    /// Each frame written to the line, then read d(n) samples back by four-point Lagrange
    /// interpolation over the samples i − 1 to i + 2 back, i = ⌊d⌋.
    pub fn process(&mut self, block: &mut [f32]) {
        let len = self.len;
        for frame in block.as_chunks_mut::<2>().0 {
            let st = &mut self.state;
            st.at = (st.at + 1) % len;
            st.line[2 * st.at] = frame[0];
            st.line[2 * st.at + 1] = frame[1];
            let d = self.curves.at(st.n);
            st.n += 1;
            let i = d.floor();
            let f = d - i;
            let i = i as usize;
            let c = [
                -f * (f - 1.0) * (f - 2.0) / 6.0,
                (f + 1.0) * (f - 1.0) * (f - 2.0) / 2.0,
                -(f + 1.0) * f * (f - 2.0) / 2.0,
                (f + 1.0) * f * (f - 1.0) / 6.0,
            ];
            for (ch, x) in frame.iter_mut().enumerate() {
                let back = |k: usize| f64::from(st.line[2 * ((st.at + len - k) % len) + ch]);
                *x = (c[0] * back(i - 1) + c[1] * back(i) + c[2] * back(i + 1) + c[3] * back(i + 2))
                    as f32;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modulate_reads_a_constant_as_itself_and_bends_a_sine_within_its_depth() {
        let spec = ModulateSpec {
            wow_hz: 0.5,
            flutter_hz: 8.0,
            depth: 10.0,
            seed: "tape".into(),
        };
        let c = Curves::new(&spec, 48_000);
        // The read's rate, 1 − d'(n), never moves more than the depth.
        let limit = ops::pow(2.0, 10.0 / 1200.0) - 1.0;
        let worst = (0..96_000)
            .map(|n| (c.at(n + 1) - c.at(n)).abs())
            .fold(0.0, f64::max);
        assert!(worst <= limit * 1.0001 && worst > limit * 0.5, "{worst}");
        assert!((0..96_000).all(|n| c.at(n) >= 2.0 && c.at(n) <= c.largest()));
        // A constant reads back as itself once the line is full.
        let mut m = Modulate::new(&spec, 48_000);
        let mut block = vec![0.25f32; 2 * 4096];
        m.process(&mut block);
        assert!(block[2 * 200..].iter().all(|x| (x - 0.25).abs() < 1e-6));
    }
}
