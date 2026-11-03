//! The first-party entries of `ease@1` (canvas primitives: Channel and key; Channel and key:
//! table eases): the Penner families, with a renormalized expo, smoothstep, smootherstep and the
//! sigmoid eases. Each maps a segment's progress x in [0, 1] to its share of the value change, is
//! exactly 0 at 0 and 1 at 1, and is a pure function of x, so seeking equals playing.

use deep_canvas::ops;

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
    Back,
    Elastic,
    Bounce,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Side {
    In,
    Out,
    InOut,
}

/// A named ease with its params.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ease {
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

const FAMILIES: [(&str, Family); 10] = [
    ("sine", Family::Sine),
    ("quad", Family::Quad),
    ("cubic", Family::Cubic),
    ("quart", Family::Quart),
    ("quint", Family::Quint),
    ("expo", Family::Expo),
    ("circ", Family::Circ),
    ("back", Family::Back),
    ("elastic", Family::Elastic),
    ("bounce", Family::Bounce),
];

/// Every first-party name in `ease@1`, the Penner families as `in_<f>`, `out_<f>` and
/// `in_out_<f>`.
pub fn names() -> Vec<String> {
    let mut out = Vec::new();
    for (f, _) in FAMILIES {
        for side in ["in", "out", "in_out"] {
            out.push(format!("{side}_{f}"));
        }
    }
    for n in [
        "smoothstep",
        "smootherstep",
        "sigmoid",
        "rush_in",
        "rush_out",
        "double_sigmoid",
        "running_start",
        "exp_decay",
    ] {
        out.push(n.to_string());
    }
    out
}

/// The ease `name` with `param` (k, pull or tau; its default when `None`), or `None` for a name
/// `ease@1` doesn't hold or a param out of its range.
pub fn named(name: &str, param: Option<f64>) -> Option<Ease> {
    let k = param.unwrap_or(10.0);
    let sigmoid_k = (k > 0.0 && k.is_finite()).then_some(k);
    Some(match name {
        "smoothstep" => Ease::Smoothstep,
        "smootherstep" => Ease::Smootherstep,
        "sigmoid" => Ease::Sigmoid(sigmoid_k?),
        "rush_in" => Ease::RushIn(sigmoid_k?),
        "rush_out" => Ease::RushOut(sigmoid_k?),
        "double_sigmoid" => Ease::DoubleSigmoid(sigmoid_k?),
        "running_start" => Ease::RunningStart(param.unwrap_or(-0.5)).finite()?,
        "exp_decay" => {
            let tau = param.unwrap_or(0.1);
            (tau > 0.0 && tau.is_finite()).then_some(Ease::ExpDecay(tau))?
        }
        _ => {
            let (side, family) = if let Some(f) = name.strip_prefix("in_out_") {
                (Side::InOut, f)
            } else if let Some(f) = name.strip_prefix("in_") {
                (Side::In, f)
            } else {
                (Side::Out, name.strip_prefix("out_")?)
            };
            let family = FAMILIES.iter().find(|(n, _)| *n == family)?.1;
            Ease::Penner(family, side)
        }
    })
}

impl Ease {
    fn finite(self) -> Option<Ease> {
        match self {
            Ease::RunningStart(p) if !p.is_finite() => None,
            e => Some(e),
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
        match *self {
            Ease::Penner(f, Side::In) => penner_in(f, x),
            Ease::Penner(f, Side::Out) => 1.0 - penner_in(f, 1.0 - x),
            Ease::Penner(f, Side::InOut) => {
                if x < 0.5 {
                    0.5 * penner_in(f, 2.0 * x)
                } else {
                    1.0 - 0.5 * penner_in(f, 2.0 - 2.0 * x)
                }
            }
            Ease::Smoothstep => x * x * (3.0 - 2.0 * x),
            Ease::Smootherstep => x * x * x * (x * (6.0 * x - 15.0) + 10.0),
            Ease::Sigmoid(k) => sigmoid(k, x),
            Ease::RushIn(k) => 2.0 * sigmoid(k, 0.5 * x),
            Ease::RushOut(k) => 2.0 * sigmoid(k, 0.5 * x + 0.5) - 1.0,
            Ease::DoubleSigmoid(k) => {
                if x < 0.5 {
                    0.5 * sigmoid(k, 2.0 * x)
                } else {
                    0.5 * (1.0 + sigmoid(k, 2.0 * x - 1.0))
                }
            }
            Ease::RunningStart(pull) => {
                // The six-degree Bernstein curve with control values 0, 0, pull, pull, 1, 1, 1.
                let s = 1.0 - x;
                let b = |n: i32, k: i32, c: f64| c * ops::powi(x, k) * ops::powi(s, n - k);
                b(6, 2, 15.0) * pull + b(6, 3, 20.0) * pull + b(6, 4, 15.0) + b(6, 5, 6.0)
                    + b(6, 6, 1.0)
            }
            Ease::ExpDecay(tau) => (1.0 - ops::exp(-x / tau)) / (1.0 - ops::exp(-1.0 / tau)),
        }
    }

    /// Whether the ease never leaves [0, 1], so a segment stays between its keys' values and the
    /// hard-range check needs only the keys.
    pub fn bounded(&self) -> bool {
        !matches!(
            self,
            Ease::Penner(Family::Back | Family::Elastic, _) | Ease::RunningStart(_)
        )
    }
}

/// The logistic curve over [0, 1] with steepness `k`, renormalized to 0 at 0 and 1 at 1.
fn sigmoid(k: f64, x: f64) -> f64 {
    let s = |v: f64| 1.0 / (1.0 + ops::exp(-v));
    let lo = s(-0.5 * k);
    let hi = s(0.5 * k);
    (s(k * (x - 0.5)) - lo) / (hi - lo)
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
        Family::Back => {
            let c = 1.70158;
            x * x * ((c + 1.0) * x - c)
        }
        Family::Elastic => {
            let c = ops::TAU / 3.0;
            -ops::pow(2.0, 10.0 * x - 10.0) * ops::sin((10.0 * x - 10.75) * c)
        }
        Family::Bounce => 1.0 - bounce_out(1.0 - x),
    }
}

fn bounce_out(x: f64) -> f64 {
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

    #[test]
    fn every_first_party_ease_is_zero_at_zero_and_one_at_one() {
        for name in names() {
            let e = named(&name, None).expect(&name);
            assert_eq!(e.at(0.0), 0.0, "{name}");
            assert_eq!(e.at(1.0), 1.0, "{name}");
            let mid = e.at(0.5);
            assert!(mid.is_finite(), "{name}");
        }
    }

    #[test]
    fn out_cubic_is_one_minus_the_cube_of_what_is_left() {
        let e = named("out_cubic", None).unwrap();
        assert_eq!(e.at(0.5), 0.875);
        assert!(named("ease", None).is_none() && named("smooth", None).is_none());
    }
}
