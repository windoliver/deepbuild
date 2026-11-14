//! The recursive reverb processor (canvas primitives: Processor, `reverb {ir: {decay, size,
//! damping}, mix}`): eight damped feedback combs and four allpasses a channel, in our own f32 math.
//! Its state is its delay lines, their read positions and the combs' filter stores, all of which a
//! checkpoint keeps: the tail lives in the delay lines.

use deep_canvas::ops;
use serde_json::{json, Value};

/// Comb and allpass lengths at 44.1 kHz and size 1, and the right channel's spread.
const COMBS: [usize; 8] = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES: [usize; 4] = [556, 441, 341, 225];
const SPREAD: usize = 23;
const INPUT: f32 = 0.015;
const ALLPASS_FEEDBACK: f32 = 0.5;

#[derive(Clone, Copy, Debug)]
pub struct Spec {
    /// Seconds to fall 60 dB.
    pub decay: f64,
    pub size: f64,
    pub damping: f64,
    pub mix: f64,
}

#[derive(Clone)]
struct Line {
    buf: Vec<f32>,
    at: usize,
    store: f32,
}

impl Line {
    fn new(len: usize) -> Line {
        Line {
            buf: vec![0.0; len.max(1)],
            at: 0,
            store: 0.0,
        }
    }
}

/// A reverb's state: what a checkpoint keeps.
#[derive(Clone)]
pub struct State {
    combs: Vec<Line>,
    allpasses: Vec<Line>,
}

impl State {
    pub fn bytes(&self) -> usize {
        let lines = self.combs.iter().chain(&self.allpasses);
        lines.map(|l| l.buf.len() * 4 + 16).sum()
    }

    /// The state as JSON (each sample an f32 read back exactly), for the kit's carried state.
    pub fn to_json(&self) -> Value {
        let line = |l: &Line| json!({"at": l.at, "store": l.store, "buf": l.buf});
        json!({"combs": self.combs.iter().map(line).collect::<Vec<_>>(),
               "allpasses": self.allpasses.iter().map(line).collect::<Vec<_>>()})
    }

    /// The state [`State::to_json`] wrote, or `None` for anything else.
    pub fn from_json(v: &Value) -> Option<State> {
        let lines = |k: &str| -> Option<Vec<Line>> {
            v.get(k)?
                .as_array()?
                .iter()
                .map(|l| {
                    let buf = l
                        .get("buf")?
                        .as_array()?
                        .iter()
                        .map(|x| x.as_f64().map(|f| f as f32))
                        .collect::<Option<Vec<f32>>>()?;
                    let at = l.get("at")?.as_u64()? as usize;
                    (at < buf.len()).then_some(())?;
                    Some(Line {
                        buf,
                        at,
                        store: l.get("store")?.as_f64()? as f32,
                    })
                })
                .collect()
        };
        Some(State {
            combs: lines("combs")?,
            allpasses: lines("allpasses")?,
        })
    }

    /// The planted restore: positions and stores, but silent delay lines.
    pub fn without_tail(&self) -> State {
        let mut s = self.clone();
        for l in s.combs.iter_mut().chain(s.allpasses.iter_mut()) {
            l.buf.iter_mut().for_each(|x| *x = 0.0);
            l.store = 0.0;
        }
        s
    }
}

pub struct Reverb {
    spec: Spec,
    feedback: Vec<f32>,
    damp: f32,
    pub state: State,
    rate: f64,
}

impl Reverb {
    pub fn new(spec: Spec, rate: i64) -> Reverb {
        let rate = rate as f64;
        let scale = rate / 44_100.0 * spec.size.clamp(0.05, 1.0);
        let len = |n: usize| ((n as f64 * scale).round() as usize).max(1);
        let mut combs = Vec::new();
        let mut feedback = Vec::new();
        for ch in 0..2 {
            for n in COMBS {
                let l = len(n + ch * SPREAD);
                // −60 dB over `decay` seconds: g^(decay·rate / l) = 10^−3.
                let g = ops::pow(10.0, -3.0 * l as f64 / (spec.decay.max(0.01) * rate));
                feedback.push(g as f32);
                combs.push(Line::new(l));
            }
        }
        let allpasses = (0..2)
            .flat_map(|ch| ALLPASSES.map(|n| Line::new(len(n + ch * SPREAD))))
            .collect();
        Reverb {
            spec,
            feedback,
            damp: spec.damping.clamp(0.0, 1.0) as f32 * 0.4,
            state: State { combs, allpasses },
            rate,
        }
    }

    /// How long the reverb keeps sounding after its input stops, to −120 dBFS, in seconds: the
    /// combs fall 60 dB per `decay`, and each allpass halves per pass (20 passes are −120 dB).
    pub fn tail_seconds(&self) -> f64 {
        let longest = self
            .state
            .combs
            .iter()
            .map(|l| l.buf.len())
            .max()
            .unwrap_or(0);
        let passes: usize = self.state.allpasses.iter().map(|l| l.buf.len()).sum();
        2.0 * self.spec.decay + (longest + 20 * passes) as f64 / self.rate
    }

    /// Processes one stereo block in place (interleaved).
    pub fn process(&mut self, block: &mut [f32]) {
        let (wet, dry) = (self.spec.mix as f32, 1.0 - self.spec.mix as f32);
        let damp = self.damp;
        for frame in block.as_chunks_mut::<2>().0 {
            let input = (frame[0] + frame[1]) * INPUT;
            for (ch, sample) in frame.iter_mut().enumerate() {
                let mut out = 0.0f32;
                for (c, line) in self.state.combs[ch * 8..ch * 8 + 8].iter_mut().enumerate() {
                    let y = line.buf[line.at];
                    line.store = y * (1.0 - damp) + line.store * damp;
                    line.buf[line.at] = input + line.store * self.feedback[ch * 8 + c];
                    line.at = (line.at + 1) % line.buf.len();
                    out += y;
                }
                for line in self.state.allpasses[ch * 4..ch * 4 + 4].iter_mut() {
                    let b = line.buf[line.at];
                    let y = b - out;
                    line.buf[line.at] = out + b * ALLPASS_FEEDBACK;
                    line.at = (line.at + 1) % line.buf.len();
                    out = y;
                }
                *sample = *sample * dry + out * wet;
            }
        }
    }
}
