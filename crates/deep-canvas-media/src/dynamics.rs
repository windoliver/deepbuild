//! Issue #1818: the compressor and the limiter (canvas primitives: Processor), by the laws the
//! Processor row writes down. Both run in f64 through the ops module, so they read the same on
//! every machine; their state is what a checkpoint keeps.

use std::collections::VecDeque;

use deep_canvas::ops;

use crate::analysis::loudness::{interpolator, TAPS};

/// `a = e^(−1 ÷ (seconds × rate))`: a one-pole's coefficient for a time constant.
fn coefficient(seconds: f64, rate: i64) -> f64 {
    if seconds <= 0.0 {
        return 0.0;
    }
    ops::exp(-1.0 / (seconds * rate as f64))
}

fn db(a: f64) -> f64 {
    20.0 * ops::log10(a)
}

fn amp(db: f64) -> f64 {
    ops::pow(10.0, db / 20.0)
}

#[derive(Clone, Copy, Debug)]
pub enum Makeup {
    Db(f64),
    /// Minus the curve at 0 dBFS.
    Auto,
}

/// `compressor {threshold, knee, ratio, attack, release, makeup, key}`; the key is the mix's.
#[derive(Clone, Copy, Debug)]
pub struct CompressorSpec {
    pub threshold: f64,
    pub knee: f64,
    pub ratio: f64,
    pub attack: f64,
    pub release: f64,
    pub makeup: Makeup,
}

impl Default for CompressorSpec {
    fn default() -> Self {
        CompressorSpec {
            threshold: -24.0,
            knee: 30.0,
            ratio: 12.0,
            attack: 0.003,
            release: 0.25,
            makeup: Makeup::Db(0.0),
        }
    }
}

impl CompressorSpec {
    /// The static curve: the output level for input level `l` (dBFS). `hard` is the planted
    /// compressor's, with no knee.
    pub fn curve(&self, l: f64, hard: bool) -> f64 {
        let (t, w, r) = (self.threshold, self.knee, self.ratio.max(1.0));
        if hard || w <= 0.0 {
            return if l <= t { l } else { t + (l - t) / r };
        }
        if l - t < -w / 2.0 {
            l
        } else if l - t <= w / 2.0 {
            let x = l - t + w / 2.0;
            l + (1.0 / r - 1.0) * x * x / (2.0 * w)
        } else {
            t + (l - t) / r
        }
    }

    fn makeup_db(&self, hard: bool) -> f64 {
        match self.makeup {
            Makeup::Db(d) => d,
            Makeup::Auto => -self.curve(0.0, hard),
        }
    }
}

/// A compressor's detector: the release-held peak `r` and the attack-smoothed level `l`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CompressorState {
    pub r: f64,
    pub l: f64,
}

pub struct Compressor {
    spec: CompressorSpec,
    attack: f64,
    release: f64,
    makeup: f64,
    hard: bool,
    pub state: CompressorState,
}

impl Compressor {
    pub fn new(spec: CompressorSpec, rate: i64, hard: bool) -> Compressor {
        Compressor {
            attack: coefficient(spec.attack, rate),
            release: coefficient(spec.release, rate),
            makeup: spec.makeup_db(hard),
            spec,
            hard,
            state: CompressorState::default(),
        }
    }

    /// Processes one stereo block in place; the detector reads `key` (the key bus's block, as
    /// aligned) when the compressor names one.
    pub fn process(&mut self, block: &mut [f32], key: Option<&[f32]>) {
        let (aa, ar) = (self.attack, self.release);
        let mut st = self.state;
        for (i, frame) in block.as_chunks_mut::<2>().0.iter_mut().enumerate() {
            let src = match key {
                Some(k) => [k[2 * i], k[2 * i + 1]],
                None => [frame[0], frame[1]],
            };
            let p = f64::from(src[0].abs().max(src[1].abs()));
            st.r = p.max(ar * st.r + (1.0 - ar) * p);
            st.l = aa * st.l + (1.0 - aa) * st.r;
            let gain_db = if st.l > 0.0 {
                let level = db(st.l);
                self.spec.curve(level, self.hard) - level + self.makeup
            } else {
                self.makeup
            };
            if gain_db != 0.0 {
                let g = amp(gain_db);
                for x in frame.iter_mut() {
                    *x = (f64::from(*x) * g) as f32;
                }
            }
        }
        self.state = st;
    }
}

/// `limiter {ceiling, lookahead, release, oversample}`.
#[derive(Clone, Copy, Debug)]
pub struct LimiterSpec {
    pub ceiling: f64,
    pub lookahead: f64,
    pub release: f64,
    pub oversample: u32,
}

impl Default for LimiterSpec {
    /// The limiter's defaults, which the master ends in.
    fn default() -> Self {
        LimiterSpec {
            ceiling: -1.0,
            lookahead: 0.005,
            release: 0.1,
            oversample: 8,
        }
    }
}

/// The ceiling is taken this far low: the spread between true-peak meters' interpolators.
pub const MARGIN_DB: f64 = 0.05;

/// The interpolator's reach past the sample it reads around.
const REACH: usize = 8;

impl LimiterSpec {
    /// W: the lookahead in samples less the interpolator's reach, at least 1.
    pub fn window(&self, rate: i64) -> usize {
        let d = (self.lookahead.max(0.0) * rate as f64).round() as usize;
        d.saturating_sub(REACH).max(1)
    }

    /// Its latency, in samples: W + 8.
    pub fn latency(&self, rate: i64) -> usize {
        self.window(rate) + REACH
    }
}

/// A limiter's state: what a checkpoint keeps.
#[derive(Clone, Debug)]
pub struct LimiterState {
    /// Samples seen.
    n: i64,
    /// The last `TAPS` input frames, oldest first, per channel.
    hist: [VecDeque<f64>; 2],
    /// The input, delayed by the latency: interleaved frames, oldest first.
    line: VecDeque<f32>,
    /// The sliding minimum of the needs: (sample, need), increasing in need.
    least: VecDeque<(i64, f64)>,
    /// The released gain's last value.
    r: f64,
    /// The last W released gains and their sum.
    window: VecDeque<f64>,
    sum: f64,
    /// Averaged gains not yet applied, oldest first.
    gains: VecDeque<f64>,
}

impl LimiterState {
    pub fn bytes(&self) -> usize {
        8 * (2 * TAPS + self.least.len() * 2 + self.window.len() + self.gains.len() + 4)
            + 4 * self.line.len()
    }
}

pub struct Limiter {
    ceiling: f64,
    w: usize,
    release: f64,
    phases: Vec<[f64; TAPS]>,
    /// The planted limiter: it reads sample peaks only.
    sample_peaks: bool,
    /// #502: whether it has cut a sample since this was last cleared.
    pub cut: bool,
    pub state: LimiterState,
}

impl Limiter {
    pub fn new(spec: LimiterSpec, rate: i64, sample_peaks: bool) -> Limiter {
        let w = spec.window(rate);
        let latency = spec.latency(rate);
        let oversample = if spec.oversample >= 8 { 8 } else { 4 };
        Limiter {
            ceiling: amp(spec.ceiling - MARGIN_DB),
            w,
            release: coefficient(spec.release, rate),
            phases: interpolator(oversample),
            sample_peaks,
            cut: false,
            state: LimiterState {
                n: 0,
                hist: [
                    VecDeque::from(vec![0.0; TAPS]),
                    VecDeque::from(vec![0.0; TAPS]),
                ],
                line: VecDeque::from(vec![0.0; 2 * latency]),
                least: VecDeque::new(),
                r: 1.0,
                window: VecDeque::from(vec![1.0; w]),
                sum: w as f64,
                gains: VecDeque::new(),
            },
        }
    }

    /// The peak around sample k = n − 7: the sample and the points between k − 1 and k, read
    /// from the history x[k − 8 ..= k + 7].
    fn peak(&self) -> f64 {
        let mut peak = 0.0f64;
        for h in &self.state.hist {
            peak = peak.max(h[TAPS - REACH].abs());
            if self.sample_peaks {
                continue;
            }
            for taps in &self.phases {
                let y: f64 = h.iter().zip(taps).map(|(x, t)| x * t).sum();
                peak = peak.max(y.abs());
            }
        }
        peak
    }

    /// Processes one stereo block in place: the output is the input W + 8 samples late, times
    /// the gain.
    pub fn process(&mut self, block: &mut [f32]) {
        let w = self.w as i64;
        for frame in block.as_chunks_mut::<2>().0 {
            let st = &mut self.state;
            for (h, x) in st.hist.iter_mut().zip(frame.iter()) {
                h.pop_front();
                h.push_back(f64::from(*x));
            }
            st.line.push_back(frame[0]);
            st.line.push_back(frame[1]);
            let n = st.n;
            st.n += 1;
            // The need of sample k = n − 7.
            let peak = self.peak();
            let st = &mut self.state;
            let k = n - 7;
            let need = if peak > self.ceiling {
                self.ceiling / peak
            } else {
                1.0
            };
            while st.least.back().is_some_and(|(_, v)| *v >= need) {
                st.least.pop_back();
            }
            st.least.push_back((k, need));
            // The least need over [i, i + W − 1], for i = k − W + 1.
            let i = k - w + 1;
            while st.least.front().is_some_and(|(at, _)| *at < i) {
                st.least.pop_front();
            }
            let least = st.least.front().map_or(1.0, |(_, v)| *v);
            st.r = least.min(self.release * st.r + (1.0 - self.release) * least);
            let gone = st.window.pop_front().unwrap_or(1.0);
            st.window.push_back(st.r);
            // A running sum, summed afresh once a window so it never drifts.
            st.sum = if i.rem_euclid(w) == 0 {
                st.window.iter().sum()
            } else {
                st.sum - gone + st.r
            };
            st.gains.push_back(st.sum / w as f64);
            // The output: sample n − W − 8, by the gain averaged for it two samples ago.
            let x = [
                st.line.pop_front().unwrap_or(0.0),
                st.line.pop_front().unwrap_or(0.0),
            ];
            let g = if st.gains.len() > 2 {
                st.gains.pop_front().unwrap_or(1.0)
            } else {
                1.0
            };
            self.cut |= g != 1.0;
            frame[0] = if g == 1.0 {
                x[0]
            } else {
                (f64::from(x[0]) * g) as f32
            };
            frame[1] = if g == 1.0 {
                x[1]
            } else {
                (f64::from(x[1]) * g) as f32
            };
        }
    }
}
