//! Issue #1818: the delay and pitch processors (canvas primitives: Processor), by the row's laws.
//! Their state is their delay lines and read phases, which a checkpoint keeps whole.

use deep_canvas::ops;

/// `delay {time: s ≤ 2, feedback: [0, 1), mix}`.
#[derive(Clone, Copy, Debug)]
pub struct DelaySpec {
    pub time: f64,
    pub feedback: f64,
    pub mix: f64,
}

/// A delay's line: s(n) = x(n) + feedback·w(n), read back T samples later as w.
#[derive(Clone, Debug)]
pub struct DelayState {
    line: Vec<f32>,
    at: usize,
}

impl DelayState {
    pub fn bytes(&self) -> usize {
        4 * self.line.len() + 8
    }

    /// The planted restore: the line emptied.
    pub fn emptied(&self) -> DelayState {
        DelayState {
            line: vec![0.0; self.line.len()],
            at: self.at,
        }
    }
}

pub struct Delay {
    spec: DelaySpec,
    pub state: DelayState,
}

impl Delay {
    pub fn new(spec: DelaySpec, rate: i64) -> Delay {
        let t = Self::samples(&spec, rate);
        Delay {
            spec,
            state: DelayState {
                line: vec![0.0; 2 * t],
                at: 0,
            },
        }
    }

    /// T: the time in samples, at least 1, at most 2 s.
    fn samples(spec: &DelaySpec, rate: i64) -> usize {
        ((spec.time.clamp(0.0, 2.0) * rate as f64).round() as usize).max(1)
    }

    /// Its tail, in samples: T for each repeat until feedback's fall below −120 dB, and one more.
    pub fn tail(spec: &DelaySpec, rate: i64) -> i64 {
        let t = Self::samples(spec, rate) as i64;
        let fb = spec.feedback.clamp(0.0, 0.999_999);
        let repeats = if fb > 0.0 {
            (ops::log(1e-6) / ops::log(fb)).ceil() as i64
        } else {
            0
        };
        t * (repeats + 1)
    }

    pub fn process(&mut self, block: &mut [f32]) {
        let fb = self.spec.feedback.clamp(0.0, 0.999_999) as f32;
        let (wet, dry) = (self.spec.mix as f32, 1.0 - self.spec.mix as f32);
        let st = &mut self.state;
        for frame in block.as_chunks_mut::<2>().0 {
            for (ch, x) in frame.iter_mut().enumerate() {
                let at = 2 * st.at + ch;
                let w = st.line[at];
                st.line[at] = *x + fb * w;
                *x = dry * *x + wet * w;
            }
            st.at = (st.at + 1) % (st.line.len() / 2);
        }
    }
}

/// `pitch {semitones, window: s = 0.1}`.
#[derive(Clone, Copy, Debug)]
pub struct PitchSpec {
    pub semitones: f64,
    pub window: f64,
}

/// A pitch shifter's line and its first tap's phase in [0, 1).
#[derive(Clone, Debug)]
pub struct PitchState {
    line: Vec<f32>,
    at: usize,
    phase: f64,
}

impl PitchState {
    pub fn bytes(&self) -> usize {
        4 * self.line.len() + 16
    }
}

pub struct Pitch {
    /// The window in samples, N.
    n: usize,
    /// How far the phase moves a sample: (1 − ratio) ÷ N.
    slide: f64,
    pub state: PitchState,
}

impl Pitch {
    /// A pitch shifter; `ignores` is the planted one, which never shifts.
    pub fn new(spec: PitchSpec, rate: i64, ignores: bool) -> Pitch {
        let n = Self::samples(&spec, rate);
        let ratio = if ignores {
            1.0
        } else {
            ops::pow(2.0, spec.semitones / 12.0)
        };
        Pitch {
            n,
            slide: (1.0 - ratio) / n as f64,
            state: PitchState {
                line: vec![0.0; 2 * (n + 2)],
                at: 0,
                phase: 0.0,
            },
        }
    }

    /// N: the window in samples, at least 2.
    pub fn samples(spec: &PitchSpec, rate: i64) -> usize {
        ((spec.window.max(0.0) * rate as f64).round() as usize).max(2)
    }

    /// The line at `d` samples back from the newest frame, linearly interpolated.
    fn tap(st: &PitchState, len: usize, ch: usize, d: f64) -> f32 {
        let i = d.floor() as usize;
        let f = (d - i as f64) as f32;
        let at = |k: usize| st.line[2 * ((st.at + len - k) % len) + ch];
        let a = at(i);
        let b = at(i + 1);
        a + (b - a) * f
    }

    pub fn process(&mut self, block: &mut [f32]) {
        let len = self.n + 2;
        let n = self.n as f64;
        for frame in block.as_chunks_mut::<2>().0 {
            let st = &mut self.state;
            st.at = (st.at + 1) % len;
            st.line[2 * st.at] = frame[0];
            st.line[2 * st.at + 1] = frame[1];
            let p1 = st.phase;
            let p2 = (p1 + 0.5).fract();
            // Hann weights: sin² and cos² of the same angle, so the two taps sum to one.
            let g1 = ops::sin(ops::PI * p1);
            let g1 = (g1 * g1) as f32;
            let g2 = 1.0 - g1;
            for (ch, x) in frame.iter_mut().enumerate() {
                *x = g1 * Self::tap(st, len, ch, p1 * n) + g2 * Self::tap(st, len, ch, p2 * n);
            }
            st.phase = (p1 + self.slide).rem_euclid(1.0);
        }
    }
}
