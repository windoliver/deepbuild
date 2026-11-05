//! The core's entries of `ease@1` (canvas primitives: Channel and key; Channel and key: table
//! eases; The closed function list): the Penner families, with a renormalized expo and back,
//! elastic and bounce taking their parameters, smoothstep, smootherstep and the sigmoid eases.
//! Each maps a segment's progress x in [0, 1] to its share of the value change, is exactly 0 at 0
//! and 1 at 1, and is a pure function of x, so seeking equals playing. The core owns them beside
//! the closed function list, so `ease(name, x)` resolves in a build without motion; motion reads
//! them. Each entry keeps its number, which a channel's content key reads, so opening the list
//! as a registry renumbers nothing.

use serde_json::Value;

use crate::interval::{self, Iv};
use crate::ops;
use crate::schedule::Canonical;

/// A Penner family: the curve its `in_` form traces.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Family {
    Sine,
    Quad,
    Cubic,
    Quart,
    Quint,
    Expo,
    Circ,
    /// `{overshoot: f32 = 1.70158}`.
    Back(f64),
    /// `{amplitude: f32 = 1, period: f32 = 0.3}`.
    Elastic(f64, f64),
    /// `{restitution: 0..1 = 0.5, bounces: u8 = 3 (≤ 16)}`.
    Bounce(f64, u8),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Side {
    In,
    Out,
    InOut,
}

/// A named ease with its params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Named {
    Penner(Family, Side),
    Smoothstep,
    Smootherstep,
    Sigmoid(f64),
    RushIn(f64),
    RushOut(f64),
    DoubleSigmoid(f64),
    RunningStart(f64),
    ExpDecay(f64),
}

pub const BACK_OVERSHOOT: f64 = 1.70158;
pub const ELASTIC_AMPLITUDE: f64 = 1.0;
pub const ELASTIC_PERIOD: f64 = 0.3;
pub const BOUNCE_RESTITUTION: f64 = 0.5;
pub const BOUNCE_BOUNCES: u8 = 3;
/// The most rebounds a bounce takes.
pub const BOUNCE_MAX: u8 = 16;

/// The Penner families in their numbering order: entry number 16 × index + side.
const FAMILIES: [&str; 10] = [
    "sine", "quad", "cubic", "quart", "quint", "expo", "circ", "back", "elastic", "bounce",
];

/// The non-Penner entries with their numbers.
const OTHERS: [(&str, u8); 8] = [
    ("smoothstep", 200),
    ("smootherstep", 201),
    ("sigmoid", 202),
    ("rush_in", 203),
    ("rush_out", 204),
    ("double_sigmoid", 205),
    ("running_start", 206),
    ("exp_decay", 207),
];

const SIDES: [&str; 3] = ["in", "out", "in_out"];

/// Every first-party name in `ease@1` with its entry number, in that order: the Penner families
/// as `in_<f>`, `out_<f>` and `in_out_<f>`, then the rest.
pub fn entries() -> Vec<(String, u8)> {
    let mut out = Vec::new();
    for (f, family) in FAMILIES.iter().enumerate() {
        for (s, side) in SIDES.iter().enumerate() {
            out.push((format!("{side}_{family}"), 16 * f as u8 + s as u8));
        }
    }
    out.extend(OTHERS.iter().map(|(n, k)| ((*n).to_string(), *k)));
    out
}

/// Every first-party name in `ease@1`.
pub fn names() -> Vec<String> {
    entries().into_iter().map(|(n, _)| n).collect()
}

/// Whether `name` is a first-party ease's, which no pack's table may take.
pub fn is_first_party(name: &str) -> bool {
    entries().iter().any(|(n, _)| n == name)
}

/// Why an ease's params are refused: the param, and its range.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BadParam {
    pub param: String,
    pub why: String,
}

/// The ease `name` with its params as written (`None`, a number, or an object of named params),
/// or `Ok(None)` for a name `ease@1` doesn't hold.
pub fn parse(name: &str, params: Option<&Value>) -> Result<Option<Named>, BadParam> {
    let bad = |param: &str, why: &str| BadParam {
        param: param.into(),
        why: why.into(),
    };
    // One number, given bare or as an object of one, for the eases that take one param.
    let one = |key: &str| -> Result<Option<f64>, BadParam> {
        match params {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(n)) => Ok(n.as_f64()),
            Some(Value::Object(p)) if p.is_empty() => Ok(None),
            Some(Value::Object(p)) if p.len() == 1 => match p.get(key).or(p.values().next()) {
                Some(Value::Number(n)) => Ok(n.as_f64()),
                _ => Err(bad(key, "is not a number")),
            },
            Some(_) => Err(bad(key, "is not a number")),
        }
    };
    // A family's named params; a bare number is its first (`overshoot`, `amplitude`,
    // `restitution`), as a one-param ease takes it.
    let field = |key: &str, first: bool| -> Result<Option<f64>, BadParam> {
        match params {
            None | Some(Value::Null) => Ok(None),
            Some(Value::Number(n)) if first => Ok(n.as_f64()),
            Some(Value::Number(_)) => Ok(None),
            Some(Value::Object(p)) => match p.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::Number(n)) => Ok(n.as_f64()),
                Some(_) => Err(bad(key, "is not a number")),
            },
            Some(_) => Err(bad(key, "takes named params")),
        }
    };
    // A family takes only its own params.
    let only = |keys: &[&str]| -> Result<(), BadParam> {
        if let Some(Value::Object(p)) = params {
            if let Some(k) = p.keys().find(|k| !keys.contains(&k.as_str())) {
                return Err(bad(k, "is not a param of this ease"));
            }
        }
        Ok(())
    };
    let positive = |key: &str, d: f64| -> Result<f64, BadParam> {
        let k = one(key)?.unwrap_or(d);
        if k > 0.0 && k.is_finite() {
            Ok(k)
        } else {
            Err(bad(key, "must be a finite number above 0"))
        }
    };
    Ok(Some(match name {
        "smoothstep" => Named::Smoothstep,
        "smootherstep" => Named::Smootherstep,
        "sigmoid" => Named::Sigmoid(positive("k", 10.0)?),
        "rush_in" => Named::RushIn(positive("k", 10.0)?),
        "rush_out" => Named::RushOut(positive("k", 10.0)?),
        "double_sigmoid" => Named::DoubleSigmoid(positive("k", 10.0)?),
        "running_start" => {
            let p = one("pull")?.unwrap_or(-0.5);
            if !p.is_finite() {
                return Err(bad("pull", "must be finite"));
            }
            Named::RunningStart(p)
        }
        "exp_decay" => Named::ExpDecay(positive("tau", 0.1)?),
        _ => {
            let (side, family) = if let Some(f) = name.strip_prefix("in_out_") {
                (Side::InOut, f)
            } else if let Some(f) = name.strip_prefix("in_") {
                (Side::In, f)
            } else if let Some(f) = name.strip_prefix("out_") {
                (Side::Out, f)
            } else if let Some(f) = name.strip_suffix("_in_out") {
                (Side::InOut, f)
            } else if let Some(f) = name.strip_suffix("_in") {
                (Side::In, f)
            } else if let Some(f) = name.strip_suffix("_out") {
                (Side::Out, f)
            } else {
                return Ok(None);
            };
            let family = match family {
                "sine" => Family::Sine,
                "quad" => Family::Quad,
                "cubic" => Family::Cubic,
                "quart" => Family::Quart,
                "quint" => Family::Quint,
                "expo" => Family::Expo,
                "circ" => Family::Circ,
                "back" => {
                    only(&["overshoot"])?;
                    let c = field("overshoot", true)?.unwrap_or(BACK_OVERSHOOT);
                    if !c.is_finite() || c < 0.0 {
                        return Err(bad("overshoot", "must be a finite number at least 0"));
                    }
                    Family::Back(c)
                }
                "elastic" => {
                    only(&["amplitude", "period"])?;
                    let a = field("amplitude", true)?.unwrap_or(ELASTIC_AMPLITUDE);
                    let p = field("period", false)?.unwrap_or(ELASTIC_PERIOD);
                    if !(a.is_finite() && a > 0.0) {
                        return Err(bad("amplitude", "must be a finite number above 0"));
                    }
                    if !(p.is_finite() && p > 0.0) {
                        return Err(bad("period", "must be a finite number above 0"));
                    }
                    Family::Elastic(a, p)
                }
                "bounce" => {
                    only(&["restitution", "bounces"])?;
                    let r = field("restitution", true)?.unwrap_or(BOUNCE_RESTITUTION);
                    let n = field("bounces", false)?.unwrap_or(f64::from(BOUNCE_BOUNCES));
                    if !(0.0..=1.0).contains(&r) || r.is_nan() {
                        return Err(bad("restitution", "must lie in 0..1"));
                    }
                    if n != n.trunc() || !(0.0..=f64::from(BOUNCE_MAX)).contains(&n) {
                        return Err(bad("bounces", "must be a whole number from 0 to 16"));
                    }
                    Family::Bounce(r, n as u8)
                }
                _ => return Ok(None),
            };
            Named::Penner(family, side)
        }
    }))
}

/// The ease `name` with `param` (k, pull or tau; its default when `None`), or `None` for a name
/// `ease@1` doesn't hold or a param out of its range.
pub fn named(name: &str, param: Option<f64>) -> Option<Named> {
    let v = param.map(Value::from);
    parse(name, v.as_ref()).ok().flatten()
}

fn family_index(f: Family) -> u8 {
    match f {
        Family::Sine => 0,
        Family::Quad => 1,
        Family::Cubic => 2,
        Family::Quart => 3,
        Family::Quint => 4,
        Family::Expo => 5,
        Family::Circ => 6,
        Family::Back(_) => 7,
        Family::Elastic(..) => 8,
        Family::Bounce(..) => 9,
    }
}

impl Named {
    /// Its `ease@1` entry number.
    pub fn number(&self) -> u8 {
        match *self {
            Named::Penner(f, side) => 16 * family_index(f) + side as u8,
            Named::Smoothstep => 200,
            Named::Smootherstep => 201,
            Named::Sigmoid(_) => 202,
            Named::RushIn(_) => 203,
            Named::RushOut(_) => 204,
            Named::DoubleSigmoid(_) => 205,
            Named::RunningStart(_) => 206,
            Named::ExpDecay(_) => 207,
        }
    }

    /// Its params past the one a content key has always carried: a back, elastic or bounce with
    /// other than its defaults.
    fn extra(&self) -> Option<[f64; 2]> {
        match *self {
            Named::Penner(Family::Back(c), _) if c != BACK_OVERSHOOT => Some([c, 0.0]),
            Named::Penner(Family::Elastic(a, p), _)
                if a != ELASTIC_AMPLITUDE || p != ELASTIC_PERIOD =>
            {
                Some([a, p])
            }
            Named::Penner(Family::Bounce(r, n), _)
                if r != BOUNCE_RESTITUTION || n != BOUNCE_BOUNCES =>
            {
                Some([r, f64::from(n)])
            }
            _ => None,
        }
    }

    /// The ease at progress `x`, clamped to [0, 1]; exactly 0 at 0 and 1 at 1.
    pub fn at(&self, x: f64) -> f64 {
        let x = x.clamp(0.0, 1.0);
        if x == 0.0 {
            return 0.0;
        }
        if x == 1.0 {
            return 1.0;
        }
        self.raw(x)
    }

    /// Its formula at `x`, with no exact ends.
    fn raw(&self, x: f64) -> f64 {
        match *self {
            Named::Penner(f, Side::In) => penner_in(f, x),
            Named::Penner(f, Side::Out) => 1.0 - penner_in(f, 1.0 - x),
            Named::Penner(f, Side::InOut) => {
                if x < 0.5 {
                    0.5 * penner_in(f, 2.0 * x)
                } else {
                    1.0 - 0.5 * penner_in(f, 2.0 - 2.0 * x)
                }
            }
            Named::Smoothstep => x * x * (3.0 - 2.0 * x),
            Named::Smootherstep => x * x * x * (x * (6.0 * x - 15.0) + 10.0),
            Named::Sigmoid(k) => sigmoid(k, x),
            Named::RushIn(k) => 2.0 * sigmoid(k, 0.5 * x),
            Named::RushOut(k) => 2.0 * sigmoid(k, 0.5 * x + 0.5) - 1.0,
            Named::DoubleSigmoid(k) => {
                if x < 0.5 {
                    0.5 * sigmoid(k, 2.0 * x)
                } else {
                    0.5 * (1.0 + sigmoid(k, 2.0 * x - 1.0))
                }
            }
            Named::RunningStart(pull) => running_start(pull, x),
            Named::ExpDecay(tau) => (1.0 - ops::exp(-x / tau)) / (1.0 - ops::exp(-1.0 / tau)),
        }
    }

    /// Whether the ease never leaves [0, 1], so a segment stays between its keys' values and the
    /// hard-range check needs only the keys.
    pub fn bounded(&self) -> bool {
        let b = self.bound(Iv::new(0.0, 1.0));
        b.lo >= 0.0 && b.hi <= 1.0
    }

    /// The x in (lo, hi) where the ease may turn: its known extrema, and the joins of its
    /// pieces, where a piecewise ease's slope may jump.
    fn turns(&self, lo: f64, hi: f64) -> Vec<f64> {
        let mut out = Vec::new();
        match *self {
            Named::Penner(f, side) => {
                let inner = penner_turns(f);
                for t in inner {
                    match side {
                        Side::In => out.push(t),
                        Side::Out => out.push(1.0 - t),
                        Side::InOut => {
                            out.push(0.5 * t);
                            out.push(1.0 - 0.5 * t);
                        }
                    }
                }
                if side == Side::InOut {
                    out.push(0.5);
                }
            }
            Named::DoubleSigmoid(_) => out.push(0.5),
            Named::RunningStart(pull) => out.extend(running_start_turns(pull)),
            _ => {}
        }
        out.retain(|t| *t > lo && *t < hi);
        out
    }

    /// The ease's interval form over progress `x` (clamped to [0, 1]): its values at x's ends
    /// and at every known extremum inside, the inside ones widened by their error bound, met
    /// with the range the ease is known to keep (a convex hull or its monotone [0, 1]). An end
    /// at 0 or 1 reads exactly 0 or 1, so it needs no widening.
    pub fn bound(&self, x: Iv) -> Iv {
        // Progress clamps to [0, 1], as `at` reads it.
        if x.is_empty() {
            return x;
        }
        let x = Iv::new(x.lo.clamp(0.0, 1.0), x.hi.clamp(0.0, 1.0));
        let mut r = Iv::EMPTY;
        for end in [x.lo, x.hi] {
            let v = self.at(end);
            r = r.hull(if end == 0.0 || end == 1.0 {
                Iv::point(v)
            } else {
                Iv::new(pad_down(v), pad_up(v))
            });
        }
        // Elastic reads exactly 0 at 0 and 1 at 1, but its curve starts and ends a hair off
        // them: those limits bound a range that reaches past an end.
        if let Named::Penner(Family::Elastic(..), _) = self {
            for (end, inside) in [(0.0, x.hi > 0.0), (1.0, x.lo < 1.0)] {
                if inside && x.contains(end) {
                    let v = self.raw(end);
                    r = r.hull(Iv::new(pad_down(v), pad_up(v)));
                }
            }
        }
        for t in self.turns(x.lo, x.hi) {
            let v = self.at(t);
            // An extremum found by bisection sits within 1e-15 of the true one, where the
            // slope is 0, so its value is off by far less than the pad.
            r = r.hull(Iv::new(pad_down(v), pad_up(v)));
        }
        match self.hull() {
            Some(h) => r.meet(h),
            None => r,
        }
    }

    /// The range the ease keeps over [0, 1], when its shape gives one: [0, 1] for the eases
    /// that never leave it, and running_start's Bernstein hull.
    fn hull(&self) -> Option<Iv> {
        match *self {
            Named::Penner(Family::Back(_) | Family::Elastic(..), _) => None,
            Named::RunningStart(pull) => Some(Iv::new(pull.min(0.0), pull.max(1.0))),
            _ => Some(Iv::new(0.0, 1.0)),
        }
    }

    /// The least and greatest the ease reads over [0, 1].
    pub fn extremes(&self) -> (f64, f64) {
        let b = self.bound(Iv::new(0.0, 1.0));
        (b.lo, b.hi)
    }
}

fn pad_down(v: f64) -> f64 {
    interval::down(v, 64) - 4e-15 * v.abs().max(1.0)
}

fn pad_up(v: f64) -> f64 {
    interval::up(v, 64) + 4e-15 * v.abs().max(1.0)
}

impl Named {
    /// Its canonical bytes under entry number `number`.
    fn encode_as(&self, number: u8, out: &mut Vec<u8>) {
        let param = match *self {
            Named::Penner(..) | Named::Smoothstep | Named::Smootherstep => 0.0,
            Named::Sigmoid(k) | Named::RushIn(k) | Named::RushOut(k) | Named::DoubleSigmoid(k) => k,
            Named::RunningStart(p) => p,
            Named::ExpDecay(t) => t,
        };
        match self.extra() {
            // At its defaults, an ease encodes as it always has: its number and one param.
            None => (number, param).encode(out),
            // Past them, a NaN where that param was marks the two params that follow.
            Some([a, b]) => (number, f64::NAN, a, b).encode(out),
        }
    }
}

impl Canonical for Named {
    fn encode(&self, out: &mut Vec<u8>) {
        self.encode_as(self.number(), out);
    }
}

/// A key's ease as `ease@1` holds it: the named ease and its entry number, which the key's
/// content key reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Entry {
    pub ease: Named,
    pub number: u8,
}

impl Entry {
    /// The entry under the registry's own numbering.
    pub fn opened(ease: Named) -> Entry {
        Entry {
            ease,
            number: ease.number(),
        }
    }
}

impl Canonical for Entry {
    fn encode(&self, out: &mut Vec<u8>) {
        self.ease.encode_as(self.number, out);
    }
}

/// The planted opening's numbering (`test-ease-renumbered`): the entries numbered in their
/// names' sorted order instead of the order they always had.
pub fn renumbered(number: u8) -> u8 {
    let mut list = entries();
    let name = list
        .iter()
        .find(|(_, n)| *n == number)
        .map(|(n, _)| n.clone());
    list.sort();
    name.and_then(|name| list.iter().position(|(n, _)| *n == name))
        .map_or(number, |i| i as u8)
}

/// The logistic curve over [0, 1] with steepness `k`, renormalized to 0 at 0 and 1 at 1.
pub fn sigmoid(k: f64, x: f64) -> f64 {
    let s = |v: f64| 1.0 / (1.0 + ops::exp(-v));
    let lo = s(-0.5 * k);
    let hi = s(0.5 * k);
    (s(k * (x - 0.5)) - lo) / (hi - lo)
}

/// The six-degree Bernstein curve with control values 0, 0, pull, pull, 1, 1, 1.
fn running_start(pull: f64, x: f64) -> f64 {
    let s = 1.0 - x;
    let b = |n: i32, k: i32, c: f64| c * ops::powi(x, k) * ops::powi(s, n - k);
    b(6, 2, 15.0) * pull + b(6, 3, 20.0) * pull + b(6, 4, 15.0) + b(6, 5, 6.0) + b(6, 6, 1.0)
}

/// The x in (0, 1) where running_start's slope is 0, by bisection on its derivative's sign
/// between 4,096 samples (the derivative is a quintic with a double root at 0, so it has at most
/// three roots inside, none closer than the samples part).
fn running_start_turns(pull: f64) -> Vec<f64> {
    // The derivative of the Bernstein form exactly: 6 Σ (c[k+1] − c[k]) B(5, k).
    let c = [0.0, 0.0, pull, pull, 1.0, 1.0, 1.0];
    let dd = |x: f64| {
        let s = 1.0 - x;
        let binom5 = [1.0, 5.0, 10.0, 10.0, 5.0, 1.0];
        (0..6)
            .map(|k| {
                6.0 * (c[k + 1] - c[k])
                    * binom5[k]
                    * ops::powi(x, k as i32)
                    * ops::powi(s, 5 - k as i32)
            })
            .sum::<f64>()
    };
    roots(dd, 0.0, 1.0)
}

/// The roots of `f` in (a, b), each by bisection to the last bit, between 4,096 even samples.
fn roots(f: impl Fn(f64) -> f64, a: f64, b: f64) -> Vec<f64> {
    let n = 4096;
    let mut out = Vec::new();
    let mut x0 = a;
    let mut f0 = f(x0);
    for i in 1..=n {
        let x1 = a + (b - a) * f64::from(i) / f64::from(n);
        let f1 = f(x1);
        if f0 == 0.0 && x0 > a {
            out.push(x0);
        } else if f0 * f1 < 0.0 {
            let (mut lo, mut hi, mut flo) = (x0, x1, f0);
            for _ in 0..80 {
                let mid = 0.5 * (lo + hi);
                if mid <= lo || mid >= hi {
                    break;
                }
                let fm = f(mid);
                if (fm < 0.0) == (flo < 0.0) {
                    lo = mid;
                    flo = fm;
                } else {
                    hi = mid;
                }
            }
            out.push(0.5 * (lo + hi));
        }
        x0 = x1;
        f0 = f1;
    }
    out
}

/// A Penner family's `in` form at x in (0, 1).
fn penner_in(f: Family, x: f64) -> f64 {
    match f {
        Family::Sine => 1.0 - ops::cos(x * ops::PI / 2.0),
        Family::Quad => x * x,
        Family::Cubic => x * x * x,
        Family::Quart => x * x * x * x,
        Family::Quint => x * x * x * x * x,
        // Renormalized, so it is exactly 0 at 0 rather than 2^−10.
        Family::Expo => (ops::pow(2.0, 10.0 * x) - 1.0) / 1023.0,
        Family::Circ => 1.0 - ops::sqrt(1.0 - x * x),
        Family::Back(c) => x * x * ((c + 1.0) * x - c),
        Family::Elastic(a, p) => {
            if a == ELASTIC_AMPLITUDE && p == ELASTIC_PERIOD {
                // The fixed shape, written as it always was, so its values keep every bit.
                let c = ops::TAU / 3.0;
                return -ops::pow(2.0, 10.0 * x - 10.0) * ops::sin((10.0 * x - 10.75) * c);
            }
            let (a, s) = elastic_shift(a, p);
            -a * ops::pow(2.0, 10.0 * x - 10.0) * ops::sin((x - 1.0 - s) * ops::TAU / p)
        }
        Family::Bounce(r, n) => 1.0 - bounce_out(r, n, 1.0 - x),
    }
}

/// Penner's elastic: an amplitude under 1 is taken as 1, with the phase a quarter period; above
/// 1, the phase that starts the wave at 0.
fn elastic_shift(a: f64, p: f64) -> (f64, f64) {
    if a < 1.0 {
        (1.0, p / 4.0)
    } else {
        (a, p / ops::TAU * ops::asin(1.0 / a))
    }
}

/// The x in (0, 1) where a family's `in` form may turn or join.
fn penner_turns(f: Family) -> Vec<f64> {
    match f {
        Family::Back(c) => {
            // d/dx x²((c+1)x − c) = 0 at x = 2c ÷ 3(c + 1).
            vec![2.0 * c / (3.0 * (c + 1.0))]
        }
        Family::Elastic(a, p) => {
            let (_, s) = elastic_shift(a, p);
            // −2^(10x−10) sin(w(x − 1 − s)), w = 2π ÷ p: its slope is 0 where
            // tan(w(x − 1 − s)) = −w ÷ (10 ln 2).
            let w = ops::TAU / p;
            let phi = ops::atan(-w / (10.0 * ops::log(2.0)));
            let mut out = Vec::new();
            let k0 = ((-1.0 - s) * w / ops::PI).floor() as i64 - 2;
            let k1 = (-s * w / ops::PI).ceil() as i64 + 2;
            for k in k0..=k1 {
                let x = (phi + k as f64 * ops::PI) / w + 1.0 + s;
                out.push(x);
            }
            out
        }
        Family::Bounce(r, n) => {
            // The in form mirrors the out form: its arcs' vertices and contacts.
            bounce_marks(r, n).into_iter().map(|t| 1.0 - t).collect()
        }
        _ => Vec::new(),
    }
}

/// A bounce's timeline in units of the first fall: the fall takes 1, the i-th rebound 2rⁱ, and
/// the whole is scaled to [0, 1].
fn bounce_total(r: f64, n: u8) -> f64 {
    let mut total = 1.0;
    let mut v = 1.0;
    for _ in 0..n {
        v *= r;
        total += 2.0 * v;
    }
    total
}

/// The out form's contacts and rebound peaks, in x.
fn bounce_marks(r: f64, n: u8) -> Vec<f64> {
    let d = bounce_total(r, n);
    let mut out = vec![1.0 / d];
    let (mut at, mut v) = (1.0, 1.0);
    for _ in 0..n {
        v *= r;
        out.push((at + v) / d);
        at += 2.0 * v;
        out.push(at / d);
    }
    out
}

/// The out form of a bounce: a drop under constant gravity from 1 to the floor, each rebound
/// keeping `r` of its speed, scaled so the last rebound lands at x = 1. With r = 0.5 and three
/// rebounds it is Penner's fixed four-arc bounce.
fn bounce_out(r: f64, n: u8, x: f64) -> f64 {
    if r == BOUNCE_RESTITUTION && n == BOUNCE_BOUNCES {
        return bounce_fixed(x);
    }
    let d = bounce_total(r, n);
    let t = x * d;
    if t < 1.0 {
        return t * t;
    }
    let (mut at, mut v) = (1.0, 1.0);
    for _ in 0..n {
        v *= r;
        let end = at + 2.0 * v;
        if t < end {
            let u = t - (at + v);
            return 1.0 - (v * v - u * u);
        }
        at = end;
    }
    1.0
}

/// Penner's fixed four-arc bounce, written as it always was.
fn bounce_fixed(x: f64) -> f64 {
    let (n, d) = (7.5625, 2.75);
    if x < 1.0 / d {
        n * x * x
    } else if x < 2.0 / d {
        let x = x - 1.5 / d;
        n * x * x + 0.75
    } else if x < 2.5 / d {
        let x = x - 2.25 / d;
        n * x * x + 0.9375
    } else {
        let x = x - 2.625 / d;
        n * x * x + 0.984375
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_first_party_ease_is_zero_at_zero_and_one_at_one() {
        for name in names() {
            let e = named(&name, None).expect(&name);
            assert_eq!(e.at(0.0), 0.0, "{name}");
            assert_eq!(e.at(1.0), 1.0, "{name}");
            assert!(e.at(0.5).is_finite(), "{name}");
        }
    }

    #[test]
    fn numbers_are_todays() {
        assert_eq!(named("in_out_cubic", None).unwrap().number(), 34);
        assert_eq!(named("exp_decay", None).unwrap().number(), 207);
    }

    #[test]
    fn back_out_takes_its_overshoot() {
        let e = parse("out_back", Some(&json!({"overshoot": 2.6})))
            .unwrap()
            .unwrap();
        let (_, hi) = e.extremes();
        assert!((hi - 1.2009).abs() < 1e-4, "{hi}");
        let d = named("out_back", None).unwrap();
        assert!((d.extremes().1 - 1.1).abs() < 1e-3);
    }

    #[test]
    fn bounce_defaults_are_the_fixed_shape() {
        let fixed = named("out_bounce", None).unwrap();
        for i in 0..=1000 {
            let x = f64::from(i) / 1000.0;
            assert!(
                (fixed.at(x) - bounce_general(0.5, 3, x)).abs() < 1e-12,
                "{x}"
            );
        }
    }

    fn bounce_general(r: f64, n: u8, x: f64) -> f64 {
        let d = bounce_total(r, n);
        let t = x * d;
        if t < 1.0 {
            return t * t;
        }
        let (mut at, mut v) = (1.0, 1.0);
        for _ in 0..n {
            v *= r;
            let end = at + 2.0 * v;
            if t < end {
                let u = t - (at + v);
                return 1.0 - (v * v - u * u);
            }
            at = end;
        }
        1.0
    }

    #[test]
    fn running_start_dips_where_its_bound_says() {
        let e = named("running_start", None).unwrap();
        let (lo, _) = e.extremes();
        assert!((lo + 0.1848).abs() < 1e-4, "{lo}");
    }

    #[test]
    fn bounds_hold_point_values() {
        let mut s = 7u64;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64
        };
        for name in names() {
            let e = named(&name, None).unwrap();
            for _ in 0..200 {
                let (a, b) = (next(), next());
                let r = Iv::new(a.min(b), a.max(b));
                let bd = e.bound(r);
                for _ in 0..50 {
                    let p = r.lo + (r.hi - r.lo) * next();
                    assert!(bd.contains(e.at(p)), "{name} at {p} outside {bd:?}");
                }
            }
        }
    }
}
