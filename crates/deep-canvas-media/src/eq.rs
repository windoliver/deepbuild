//! The eq processor (canvas primitives: Processor, `eq {bands}`): biquads by the Audio EQ
//! Cookbook's formulas, transposed direct form II in f64, one filter per band and channel.

use deep_canvas::ops;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Type {
    Lowpass,
    Highpass,
    Bandpass,
    Lowshelf,
    Highshelf,
    Peaking,
    Notch,
    Allpass,
}

impl Type {
    pub fn read(s: &str) -> Option<Type> {
        Some(match s {
            "lowpass" => Type::Lowpass,
            "highpass" => Type::Highpass,
            "bandpass" => Type::Bandpass,
            "lowshelf" => Type::Lowshelf,
            "highshelf" => Type::Highshelf,
            "peaking" => Type::Peaking,
            "notch" => Type::Notch,
            "allpass" => Type::Allpass,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Band {
    pub kind: Type,
    pub freq: f64,
    pub q: f64,
    pub gain: f64,
}

/// One band's coefficients, normalized by a0: b0, b1, b2, a1, a2.
fn coefficients(b: &Band, rate: f64) -> [f64; 5] {
    let w0 = 2.0 * ops::PI * b.freq.clamp(1.0, rate / 2.0 - 1.0) / rate;
    let (sin, cos) = (ops::sin(w0), ops::cos(w0));
    let alpha = sin / (2.0 * b.q.max(1e-3));
    let a = ops::pow(10.0, b.gain / 40.0);
    let sq = 2.0 * ops::sqrt(a) * alpha;
    let [b0, b1, b2, a0, a1, a2] = match b.kind {
        Type::Lowpass => [(1.0 - cos) / 2.0, 1.0 - cos, (1.0 - cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha],
        Type::Highpass => [(1.0 + cos) / 2.0, -(1.0 + cos), (1.0 + cos) / 2.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha],
        Type::Bandpass => [alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha],
        Type::Notch => [1.0, -2.0 * cos, 1.0, 1.0 + alpha, -2.0 * cos, 1.0 - alpha],
        Type::Allpass => [1.0 - alpha, -2.0 * cos, 1.0 + alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha],
        Type::Peaking => [1.0 + alpha * a, -2.0 * cos, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cos, 1.0 - alpha / a],
        Type::Lowshelf => [
            a * ((a + 1.0) - (a - 1.0) * cos + sq),
            2.0 * a * ((a - 1.0) - (a + 1.0) * cos),
            a * ((a + 1.0) - (a - 1.0) * cos - sq),
            (a + 1.0) + (a - 1.0) * cos + sq,
            -2.0 * ((a - 1.0) + (a + 1.0) * cos),
            (a + 1.0) + (a - 1.0) * cos - sq,
        ],
        Type::Highshelf => [
            a * ((a + 1.0) + (a - 1.0) * cos + sq),
            -2.0 * a * ((a - 1.0) + (a + 1.0) * cos),
            a * ((a + 1.0) + (a - 1.0) * cos - sq),
            (a + 1.0) - (a - 1.0) * cos + sq,
            2.0 * ((a - 1.0) - (a + 1.0) * cos),
            (a + 1.0) - (a - 1.0) * cos - sq,
        ],
    };
    [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0]
}

/// The filters' state: two values per band and channel.
pub type State = Vec<[f64; 2]>;

pub struct Eq {
    coefficients: Vec<[f64; 5]>,
    pub state: State,
}

impl Eq {
    pub fn new(bands: &[Band], rate: i64) -> Eq {
        let coefficients: Vec<_> = bands.iter().map(|b| coefficients(b, rate as f64)).collect();
        let state = vec![[0.0; 2]; 2 * coefficients.len()];
        Eq { coefficients, state }
    }

    pub fn process(&mut self, block: &mut [f32]) {
        for frame in block.as_chunks_mut::<2>().0 {
            for (ch, x) in frame.iter_mut().enumerate() {
                let mut v = *x as f64;
                for (k, c) in self.coefficients.iter().enumerate() {
                    let s = &mut self.state[2 * k + ch];
                    let y = c[0] * v + s[0];
                    s[0] = c[1] * v - c[3] * y + s[1];
                    s[1] = c[2] * v - c[4] * y;
                    v = y;
                }
                *x = v as f32;
            }
        }
    }
}
