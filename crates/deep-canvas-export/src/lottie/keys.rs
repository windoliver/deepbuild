//! A Lottie property: a static value, keys Lottie interpolates itself (linear, hold and Bézier,
//! which a channel's own keys become when Lottie's evaluation of them gives the document's value
//! at every export frame), or linear keys sampled at each export frame.

use deep_canvas_motion::curve::{Interp, Key};
use serde_json::{json, Value};

/// How the span that starts at a key moves to the next.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ease {
    Hold,
    Linear,
    /// Handles over the span: x over its time, y over its value change.
    Bezier([f64; 4]),
}

/// One Lottie key: its time in export frames from the file's first frame, and its value.
#[derive(Clone, Debug, PartialEq)]
pub struct LKey {
    pub t: f64,
    pub s: Vec<f64>,
    pub ease: Ease,
}

/// A property as written.
#[derive(Clone, Debug, PartialEq)]
pub enum Prop {
    Static(Vec<f64>),
    Keys(Vec<LKey>),
}

/// How a value was written: the warning a sampled one takes names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Made {
    Static,
    Native,
    Sampled,
}

/// The tolerance a native key's evaluation must meet at every export frame, in the property's
/// own units as written (a percent for scale and opacity).
const MATCH: f64 = 1e-6;

impl Prop {
    /// As Lottie writes it: `{a: 0, k}` or `{a: 1, k: [keys]}`; `scalar` writes a static one-number
    /// value as a number, as Lottie's scalar properties take it.
    pub fn json(&self, scalar: bool) -> Value {
        match self {
            Prop::Static(v) if scalar && v.len() == 1 => json!({"a": 0, "k": num(v[0])}),
            Prop::Static(v) => json!({"a": 0, "k": nums(v)}),
            Prop::Keys(keys) => {
                let n = keys.len();
                let list: Vec<Value> = keys
                    .iter()
                    .enumerate()
                    .map(|(i, k)| {
                        let mut o = serde_json::Map::new();
                        o.insert("t".into(), num(k.t));
                        o.insert("s".into(), nums(&k.s));
                        if i + 1 < n {
                            let dims = k.s.len().max(1);
                            match k.ease {
                                Ease::Hold => {
                                    o.insert("h".into(), json!(1));
                                }
                                Ease::Linear => {
                                    o.insert("o".into(), handle(0.0, 0.0, dims));
                                    o.insert("i".into(), handle(1.0, 1.0, dims));
                                }
                                Ease::Bezier([x1, y1, x2, y2]) => {
                                    o.insert("o".into(), handle(x1, y1, dims));
                                    o.insert("i".into(), handle(x2, y2, dims));
                                }
                            }
                        }
                        Value::Object(o)
                    })
                    .collect();
                json!({"a": 1, "k": list})
            }
        }
    }

    /// Lottie's value at export frame `t`.
    pub fn at(&self, t: f64) -> Vec<f64> {
        match self {
            Prop::Static(v) => v.clone(),
            Prop::Keys(keys) => eval(keys, t),
        }
    }

    /// Whether it holds one value throughout.
    pub fn constant(&self) -> bool {
        matches!(self, Prop::Static(_))
    }
}

fn handle(x: f64, y: f64, dims: usize) -> Value {
    json!({"x": vec![num(x); dims], "y": vec![num(y); dims]})
}

/// A number as written: an integral value as an integer, so the same value writes the same text.
pub fn num(v: f64) -> Value {
    let v = if v == 0.0 { 0.0 } else { v };
    if v.fract() == 0.0 && v.abs() < 9.0e15 {
        json!(v as i64)
    } else {
        json!(v)
    }
}

pub fn nums(v: &[f64]) -> Value {
    Value::Array(v.iter().map(|x| num(*x)).collect())
}

/// Lottie's evaluation of `keys` at `t`: held before the first and after the last.
pub fn eval(keys: &[LKey], t: f64) -> Vec<f64> {
    let Some(first) = keys.first() else {
        return Vec::new();
    };
    if t <= first.t {
        return first.s.clone();
    }
    let i = keys.partition_point(|k| k.t <= t);
    if i >= keys.len() {
        return keys[keys.len() - 1].s.clone();
    }
    let (a, b) = (&keys[i - 1], &keys[i]);
    let span = b.t - a.t;
    if span <= 0.0 {
        return b.s.clone();
    }
    let u = (t - a.t) / span;
    let f = match a.ease {
        Ease::Hold => return a.s.clone(),
        Ease::Linear => u,
        Ease::Bezier([x1, y1, x2, y2]) => bezier(x1, y1, x2, y2, u),
    };
    a.s.iter().zip(&b.s).map(|(p, q)| p + (q - p) * f).collect()
}

/// The ease curve through (0, 0), (x1, y1), (x2, y2), (1, 1) at time fraction `u`: its y where
/// its x is `u`, by bisection on x (monotone for x handles in [0, 1]).
pub fn bezier(x1: f64, y1: f64, x2: f64, y2: f64, u: f64) -> f64 {
    let x1 = x1.clamp(0.0, 1.0);
    let x2 = x2.clamp(0.0, 1.0);
    let cubic = |p1: f64, p2: f64, s: f64| {
        let m = 1.0 - s;
        3.0 * m * m * s * p1 + 3.0 * m * s * s * p2 + s * s * s
    };
    let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
    for _ in 0..64 {
        let mid = 0.5 * (lo + hi);
        if cubic(x1, x2, mid) < u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    cubic(y1, y2, 0.5 * (lo + hi))
}

/// A channel's keys as Lottie's own, each value through `map`, at export frames from `t0`
/// (flicks per frame `frame`); `None` when an interpolation isn't one Lottie has (a named ease,
/// a spring, quantize, Catmull-Rom, a table) or an auto span's handles can't be written.
pub fn native(
    keys: &[Key],
    t0: i64,
    frame: i64,
    map: &dyn Fn(&[f64]) -> Vec<f64>,
) -> Option<Vec<LKey>> {
    let at = |t: i64| (t - t0) as f64 / frame as f64;
    let mut out = Vec::with_capacity(keys.len());
    for (i, k) in keys.iter().enumerate() {
        let s = map(&k.value);
        let next = keys.get(i + 1);
        let ease = match (&k.interp, next) {
            (_, None) => Ease::Linear,
            (Interp::Hold, _) => Ease::Hold,
            (Interp::Linear, _) => Ease::Linear,
            (Interp::Bezier { x1, y1, x2, y2 }, _) => Ease::Bezier([*x1, *y1, *x2, *y2]),
            // Auto: a cubic Hermite in the span's progress, as handles a third along at the
            // slopes; one handle pair serves every component, so they must agree.
            (Interp::Auto { .. }, Some(n)) => {
                let mut handles: Option<(f64, f64)> = None;
                for (c, slope) in k.slopes.iter().enumerate() {
                    let dv = n.value.get(c)? - k.value.get(c)?;
                    if dv.abs() < 1e-12 {
                        if slope[0].abs() > 1e-12 || slope[1].abs() > 1e-12 {
                            return None;
                        }
                        continue;
                    }
                    let h = (slope[0] / (3.0 * dv), 1.0 - slope[1] / (3.0 * dv));
                    match handles {
                        None => handles = Some(h),
                        Some(g) if (g.0 - h.0).abs() < 1e-9 && (g.1 - h.1).abs() < 1e-9 => {}
                        Some(_) => return None,
                    }
                }
                let (y1, y2) = handles.unwrap_or((1.0 / 3.0, 2.0 / 3.0));
                Ease::Bezier([1.0 / 3.0, y1, 2.0 / 3.0, y2])
            }
            _ => return None,
        };
        out.push(LKey {
            t: at(k.t),
            s,
            ease,
        });
    }
    Some(out)
}

/// Whether `keys`, as Lottie evaluates them, give `series` (one value a frame, frame j at time j).
pub fn matches(keys: &[LKey], series: &[Vec<f64>]) -> bool {
    series.iter().enumerate().all(|(j, want)| {
        let got = eval(keys, j as f64);
        got.len() == want.len()
            && got
                .iter()
                .zip(want)
                .all(|(g, w)| (g - w).abs() <= MATCH * w.abs().max(1.0))
    })
}

/// The series as linear keys at each export frame, with a run of equal values kept as its two
/// ends so a held stretch costs two keys.
pub fn sampled(series: &[Vec<f64>]) -> Prop {
    if series.windows(2).all(|w| w[0] == w[1]) {
        return Prop::Static(series.first().cloned().unwrap_or_default());
    }
    let mut keys: Vec<LKey> = Vec::new();
    for (j, v) in series.iter().enumerate() {
        let same_before = j > 0 && series[j - 1] == *v;
        let same_after = series.get(j + 1) == Some(v);
        // A held run keeps its first frame, and its last only when a change follows: Lottie holds
        // the last key's value to the end.
        if same_before && (same_after || j + 1 == series.len()) {
            continue;
        }
        keys.push(LKey {
            t: j as f64,
            s: v.clone(),
            ease: Ease::Linear,
        });
    }
    Prop::Keys(keys)
}

/// A property from its series and, when one channel writes it, that channel's keys mapped to it:
/// static when it never changes, native when Lottie's evaluation of the keys gives the series,
/// else sampled.
pub fn choose(series: &[Vec<f64>], native: Option<Vec<LKey>>) -> (Prop, Made) {
    if series.windows(2).all(|w| w[0] == w[1]) {
        return (
            Prop::Static(series.first().cloned().unwrap_or_default()),
            Made::Static,
        );
    }
    if let Some(keys) = native.filter(|k| !k.is_empty() && matches(k, series)) {
        return (Prop::Keys(keys), Made::Native);
    }
    (sampled(series), Made::Sampled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bezier_ends_and_linear() {
        assert!((bezier(0.0, 0.0, 1.0, 1.0, 0.3) - 0.3).abs() < 1e-12);
        assert!((bezier(0.42, 0.0, 0.58, 1.0, 0.0)).abs() < 1e-12);
        assert!((bezier(0.42, 0.0, 0.58, 1.0, 1.0) - 1.0).abs() < 1e-12);
        // ease-in-out is symmetric about the middle
        assert!((bezier(0.42, 0.0, 0.58, 1.0, 0.5) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn sampled_keeps_holds_as_two_keys_and_matches() {
        let series: Vec<Vec<f64>> = [0.0, 0.0, 0.0, 1.0, 2.0, 2.0, 2.0]
            .iter()
            .map(|v| vec![*v])
            .collect();
        let Prop::Keys(keys) = sampled(&series) else {
            panic!("keys")
        };
        assert_eq!(
            keys.iter().map(|k| k.t).collect::<Vec<_>>(),
            vec![0.0, 2.0, 3.0, 4.0]
        );
        assert!(matches(&keys, &series));
    }

    #[test]
    fn choose_refuses_keys_that_miss_a_frame() {
        let series: Vec<Vec<f64>> = (0..5).map(|j| vec![j as f64 * j as f64]).collect();
        let linear = vec![
            LKey {
                t: 0.0,
                s: vec![0.0],
                ease: Ease::Linear,
            },
            LKey {
                t: 4.0,
                s: vec![16.0],
                ease: Ease::Linear,
            },
        ];
        let (_, made) = choose(&series, Some(linear));
        assert_eq!(made, Made::Sampled);
    }
}
