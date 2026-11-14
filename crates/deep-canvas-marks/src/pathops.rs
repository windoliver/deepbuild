//! Path ops (canvas primitives: Path `path@1`: ops; issue #160): an ordered list of up to eight
//! operators a path runs through before tessellation, each pure in its params: trim, round
//! corners, offset path, zig zag, pucker, twist and a repeater. A path is read as sub-paths of
//! segments (lines, quadratics and cubics; a closed sub-path's closing line is a segment), so each
//! op's output segment count follows from its params and its input's count, and the budget check
//! refuses a path past its declared count before anything builds. Arc length along the same
//! segments gives every path-like item its `#length` and `#at:<f>` anchors.
//!
//! Every transcendental goes through the pinned ops module, so a build on any machine draws the
//! same points.

use deep_canvas::ops as m;
use serde_json::{Map, Value};

use crate::path::Verb;
use crate::scene::{refuse, Refused};

/// The most ops a path lists (`ops: [path op] ≤ 8`).
pub const MAX_OPS: usize = 8;
/// The most segments one path may build (Path: Cost).
pub const MAX_PATH_SEGMENTS: u64 = 50_000;
/// The most segments one document's paths may build together.
pub const MAX_DOCUMENT_SEGMENTS: u64 = 500_000;
/// The most copies a repeater draws.
const MAX_COPIES: f64 = 64.0;
/// The most copies an offset path draws.
const MAX_OFFSET_COPIES: u64 = 16;
/// The most ridges a zig zag puts on one segment.
const MAX_RIDGES: u64 = 256;
/// Samples along a curve for its point at a length.
const SAMPLES: usize = 128;
/// 8-point Gauss–Legendre nodes and weights on 0..1, for a curve's arc length: exact for a line,
/// and within 1e-6 of the integral for the curves the ops build, at 8 derivative reads a curve.
const GAUSS: [(f64, f64); 8] = [
    (0.019_855_071_751_231_856, 0.050_614_268_145_188_13),
    (0.101_666_761_293_186_64, 0.111_190_517_226_687_24),
    (0.237_233_795_041_835_5, 0.156_853_322_938_943_63),
    (0.408_282_678_752_175_1, 0.181_341_891_689_181),
    (0.591_717_321_247_825, 0.181_341_891_689_181),
    (0.762_766_204_958_164_5, 0.156_853_322_938_943_63),
    (0.898_333_238_706_813_4, 0.111_190_517_226_687_24),
    (0.980_144_928_248_768_1, 0.050_614_268_145_188_13),
];

type P = [f64; 2];

fn vadd(a: P, b: P) -> P {
    [a[0] + b[0], a[1] + b[1]]
}

fn vsub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}

fn vmul(a: P, k: f64) -> P {
    [a[0] * k, a[1] * k]
}

fn lerp(a: P, b: P, s: f64) -> P {
    [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]
}

fn norm(a: P) -> f64 {
    m::hypot(a[0], a[1])
}

fn cross(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

/// The unit vector along `a`, or `None` for a zero vector.
fn unit(a: P) -> Option<P> {
    let l = norm(a);
    (l > 0.0).then(|| vmul(a, 1.0 / l))
}

/// The left normal of `d` on screen (y down): `d` turned a quarter turn toward −y.
fn left(d: P) -> P {
    [d[1], -d[0]]
}

fn rotate(p: P, about: P, degrees: f64) -> P {
    let (s, c) = (m::sin(m::rad(degrees)), m::cos(m::rad(degrees)));
    let d = vsub(p, about);
    vadd(about, [d[0] * c - d[1] * s, d[0] * s + d[1] * c])
}

// ---------------------------------------------------------------------------------------------------
// Segments and sub-paths

/// One segment of a path: a line, a quadratic or a cubic, from its start to its end.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Seg {
    Line(P, P),
    Quad(P, P, P),
    Cubic(P, P, P, P),
}

impl Seg {
    pub fn start(&self) -> P {
        match *self {
            Seg::Line(a, _) | Seg::Quad(a, _, _) | Seg::Cubic(a, _, _, _) => a,
        }
    }

    pub fn end(&self) -> P {
        match *self {
            Seg::Line(_, b) | Seg::Quad(_, _, b) | Seg::Cubic(_, _, _, b) => b,
        }
    }

    /// The point at parameter `t` in 0..1.
    pub fn at(&self, t: f64) -> P {
        match *self {
            Seg::Line(a, b) => lerp(a, b, t),
            Seg::Quad(a, b, c) => lerp(lerp(a, b, t), lerp(b, c, t), t),
            Seg::Cubic(a, b, c, d) => {
                let (ab, bc, cd) = (lerp(a, b, t), lerp(b, c, t), lerp(c, d, t));
                lerp(lerp(ab, bc, t), lerp(bc, cd, t), t)
            }
        }
    }

    /// The derivative at `t`, or the chord where it vanishes.
    pub fn tangent(&self, t: f64) -> P {
        let d = self.derivative(t);
        if norm(d) > 0.0 {
            return d;
        }
        // #223: where a handle collapses onto its end the derivative vanishes, and the curve
        // runs along its next derivative there: the second, toward the inside of [0, 1], else
        // the third; a curve with neither runs along its chord.
        let (second, third) = match *self {
            Seg::Line(..) => ([0.0, 0.0], [0.0, 0.0]),
            Seg::Quad(a, b, c) => (vadd(vsub(c, vmul(b, 2.0)), a), [0.0, 0.0]),
            Seg::Cubic(a, b, c, d) => (
                vadd(
                    vmul(vadd(vsub(c, vmul(b, 2.0)), a), 1.0 - t),
                    vmul(vadd(vsub(d, vmul(c, 2.0)), b), t),
                ),
                vsub(vadd(vsub(d, vmul(c, 3.0)), vmul(b, 3.0)), a),
            ),
        };
        if norm(second) > 0.0 {
            vmul(second, if t < 0.5 { 1.0 } else { -1.0 })
        } else if norm(third) > 0.0 {
            third
        } else {
            vsub(self.end(), self.start())
        }
    }

    /// The derivative at `t`, as it is.
    fn derivative(&self, t: f64) -> P {
        match *self {
            Seg::Line(a, b) => vsub(b, a),
            Seg::Quad(a, b, c) => {
                vadd(vmul(vsub(b, a), 2.0 * (1.0 - t)), vmul(vsub(c, b), 2.0 * t))
            }
            Seg::Cubic(a, b, c, d) => {
                let u = 1.0 - t;
                vadd(
                    vadd(vmul(vsub(b, a), 3.0 * u * u), vmul(vsub(c, b), 6.0 * u * t)),
                    vmul(vsub(d, c), 3.0 * t * t),
                )
            }
        }
    }

    /// The segment split at `t`.
    pub fn split(&self, t: f64) -> (Seg, Seg) {
        match *self {
            Seg::Line(a, b) => {
                let p = lerp(a, b, t);
                (Seg::Line(a, p), Seg::Line(p, b))
            }
            Seg::Quad(a, b, c) => {
                let (ab, bc) = (lerp(a, b, t), lerp(b, c, t));
                let p = lerp(ab, bc, t);
                (Seg::Quad(a, ab, p), Seg::Quad(p, bc, c))
            }
            Seg::Cubic(a, b, c, d) => {
                let (ab, bc, cd) = (lerp(a, b, t), lerp(b, c, t), lerp(c, d, t));
                let (abc, bcd) = (lerp(ab, bc, t), lerp(bc, cd, t));
                let p = lerp(abc, bcd, t);
                (Seg::Cubic(a, ab, abc, p), Seg::Cubic(p, bcd, cd, d))
            }
        }
    }

    /// The piece between parameters `t0` and `t1`.
    pub fn piece(&self, t0: f64, t1: f64) -> Seg {
        if t0 <= 0.0 && t1 >= 1.0 {
            return *self;
        }
        let (_, tail) = self.split(t0);
        if t1 >= 1.0 {
            return tail;
        }
        let u = if t0 < 1.0 {
            (t1 - t0) / (1.0 - t0)
        } else {
            1.0
        };
        tail.split(u.clamp(0.0, 1.0)).0
    }

    /// The cumulative arc length at each of `SAMPLES` + 1 parameters, by chords.
    fn lengths(&self) -> Vec<f64> {
        if let Seg::Line(a, b) = self {
            return vec![0.0, norm(vsub(*b, *a))];
        }
        let mut out = Vec::with_capacity(SAMPLES + 1);
        let mut total = 0.0;
        let mut last = self.start();
        out.push(0.0);
        for k in 1..=SAMPLES {
            let p = self.at(k as f64 / SAMPLES as f64);
            total += norm(vsub(p, last));
            out.push(total);
            last = p;
        }
        out
    }

    /// Arc length: a line's exactly, a curve's by Gauss–Legendre quadrature of its speed.
    pub fn length(&self) -> f64 {
        if let Seg::Line(a, b) = self {
            return norm(vsub(*b, *a));
        }
        // The speed is smooth between the parameters where either coordinate turns back, so the
        // rule runs on each piece between them: a curve that runs past its end and back, or nearly
        // loops, is measured as closely as a gentle one.
        let mut cuts = self.turns();
        cuts.push(1.0);
        let mut from = 0.0;
        let mut sum = 0.0;
        for to in cuts {
            sum += self.gauss(from, to);
            from = to;
        }
        sum
    }

    /// The parameters inside 0..1 where the derivative's x or y is zero, in order.
    fn turns(&self) -> Vec<f64> {
        // Each coordinate of the derivative as q t² + l t + c (a quadratic's has q = 0).
        let coefficients = |k: usize| -> (f64, f64, f64) {
            match *self {
                Seg::Line(..) => (0.0, 0.0, 1.0),
                Seg::Quad(a, b, c) => (0.0, 2.0 * (c[k] - 2.0 * b[k] + a[k]), 2.0 * (b[k] - a[k])),
                Seg::Cubic(a, b, c, d) => {
                    let (e, f, g) = (b[k] - a[k], c[k] - b[k], d[k] - c[k]);
                    (3.0 * (e - 2.0 * f + g), 6.0 * (f - e), 3.0 * e)
                }
            }
        };
        let mut out = Vec::new();
        for k in 0..2 {
            let (q, l, c) = coefficients(k);
            let scale = q.abs().max(l.abs()).max(c.abs());
            if scale == 0.0 {
                continue;
            }
            if q.abs() <= 1e-12 * scale {
                if l != 0.0 {
                    out.push(-c / l);
                }
            } else {
                let disc = l * l - 4.0 * q * c;
                if disc >= 0.0 {
                    let r = m::sqrt(disc);
                    out.push((-l - r) / (2.0 * q));
                    out.push((-l + r) / (2.0 * q));
                }
            }
        }
        out.retain(|t| *t > 1e-9 && *t < 1.0 - 1e-9);
        out.sort_by(f64::total_cmp);
        out
    }

    /// The speed's integral over `t0..t1` by the 8-point rule.
    fn gauss(&self, t0: f64, t1: f64) -> f64 {
        let h = t1 - t0;
        GAUSS
            .iter()
            .map(|(t, w)| {
                let d = self.derivative(t0 + h * t);
                w * m::sqrt(d[0] * d[0] + d[1] * d[1])
            })
            .sum::<f64>()
            * h
    }

    /// Every point of the segment mapped through `f`.
    pub fn map(&self, f: impl Fn(P) -> P) -> Seg {
        match *self {
            Seg::Line(a, b) => Seg::Line(f(a), f(b)),
            Seg::Quad(a, b, c) => Seg::Quad(f(a), f(b), f(c)),
            Seg::Cubic(a, b, c, d) => Seg::Cubic(f(a), f(b), f(c), f(d)),
        }
    }
}

/// One sub-path: its segments in order, and whether it closes (its last segment then ends on its
/// first's start).
#[derive(Clone, Debug, PartialEq)]
pub struct Sub {
    pub segs: Vec<Seg>,
    pub closed: bool,
}

/// A sub-path with each segment's arc length measured once, so a trim or an anchor read measures
/// every curve one time; only a segment a length falls inside is sampled finely, to find the
/// parameter there (#160 AC9: a trim after ops that curve 2,000 segments).
struct Measured<'a> {
    sub: &'a Sub,
    lengths: Vec<f64>,
}

impl<'a> Measured<'a> {
    fn of(sub: &'a Sub) -> Measured<'a> {
        Measured {
            sub,
            lengths: sub.segs.iter().map(Seg::length).collect(),
        }
    }

    fn seg_length(&self, i: usize) -> f64 {
        self.lengths[i]
    }

    /// The parameter `s` u along segment `i`, from its chord samples scaled to its arc length.
    fn t_of(&self, i: usize, s: f64) -> f64 {
        let l = self.lengths[i];
        if l <= 0.0 {
            return 0.0;
        }
        let table = self.sub.segs[i].lengths();
        t_at(&table, s / l * table[table.len() - 1])
    }

    fn length(&self) -> f64 {
        (0..self.sub.segs.len()).map(|i| self.seg_length(i)).sum()
    }

    /// The point and the tangent direction `s` u along the sub-path.
    fn at_length(&self, s: f64) -> Option<(P, P)> {
        let mut rest = s.max(0.0);
        let last = self.sub.segs.len().checked_sub(1)?;
        for (i, seg) in self.sub.segs.iter().enumerate() {
            let l = self.seg_length(i);
            if rest <= l || i == last {
                let t = self.t_of(i, rest.min(l));
                return Some((seg.at(t), seg.tangent(t)));
            }
            rest -= l;
        }
        None
    }

    /// The piece from `s0` to `s1` u along the sub-path, open.
    fn piece(&self, s0: f64, s1: f64) -> Sub {
        let mut segs = Vec::new();
        let mut from = 0.0;
        for (i, seg) in self.sub.segs.iter().enumerate() {
            let l = self.seg_length(i);
            let to = from + l;
            if to > s0 && from < s1 && l > 0.0 {
                let t0 = if s0 > from {
                    self.t_of(i, s0 - from)
                } else {
                    0.0
                };
                let t1 = if s1 < to {
                    self.t_of(i, s1 - from)
                } else {
                    1.0
                };
                if t1 > t0 {
                    segs.push(seg.piece(t0, t1));
                }
            }
            from = to;
        }
        Sub {
            segs,
            closed: false,
        }
    }
}

/// The parameter `s` u along a segment whose cumulative lengths are `lengths`.
fn t_at(lengths: &[f64], s: f64) -> f64 {
    let total = lengths[lengths.len() - 1];
    if total <= 0.0 || s <= 0.0 {
        return 0.0;
    }
    if s >= total {
        return 1.0;
    }
    let n = lengths.len() - 1;
    let i = lengths.partition_point(|l| *l <= s).clamp(1, n);
    let span = lengths[i] - lengths[i - 1];
    let f = if span > 0.0 {
        (s - lengths[i - 1]) / span
    } else {
        0.0
    };
    ((i - 1) as f64 + f) / n as f64
}

impl Sub {
    pub fn length(&self) -> f64 {
        self.segs.iter().map(Seg::length).sum()
    }
}

/// The verbs as sub-paths of segments: a closed sub-path whose last point isn't its first gains
/// its closing line as a segment.
pub fn subs_of(verbs: &[Verb]) -> Vec<Sub> {
    let mut out: Vec<Sub> = Vec::new();
    let mut cur = [0.0, 0.0];
    let mut start = [0.0, 0.0];
    let mut open = false;
    for v in verbs {
        match *v {
            Verb::Move(p) => {
                out.push(Sub {
                    segs: Vec::new(),
                    closed: false,
                });
                cur = p;
                start = p;
                open = true;
            }
            Verb::Line(p) => {
                if let Some(s) = out.last_mut().filter(|_| open && p != cur) {
                    s.segs.push(Seg::Line(cur, p));
                }
                cur = p;
            }
            Verb::Quad(a, p) => {
                if let Some(s) = out.last_mut().filter(|_| open) {
                    s.segs.push(Seg::Quad(cur, a, p));
                }
                cur = p;
            }
            Verb::Cubic(a, b, p) => {
                if let Some(s) = out.last_mut().filter(|_| open) {
                    s.segs.push(Seg::Cubic(cur, a, b, p));
                }
                cur = p;
            }
            Verb::Close => {
                if let Some(s) = out.last_mut().filter(|_| open) {
                    if cur != start && !s.segs.is_empty() {
                        s.segs.push(Seg::Line(cur, start));
                    }
                    s.closed = true;
                }
                cur = start;
                out.push(Sub {
                    segs: Vec::new(),
                    closed: false,
                });
                open = true;
            }
        }
    }
    out.retain(|s| !s.segs.is_empty());
    out
}

/// Sub-paths back as verbs; a closed one's closing line, when straight back to its start, is the
/// Z.
pub fn verbs_of(subs: &[Sub]) -> Vec<Verb> {
    let mut out = Vec::new();
    for s in subs {
        let Some(first) = s.segs.first() else {
            continue;
        };
        out.push(Verb::Move(first.start()));
        let n = s.segs.len();
        for (i, seg) in s.segs.iter().enumerate() {
            let closing = s.closed && i + 1 == n;
            match *seg {
                Seg::Line(_, b) if closing && b == first.start() => {}
                Seg::Line(_, b) => out.push(Verb::Line(b)),
                Seg::Quad(_, a, b) => out.push(Verb::Quad(a, b)),
                Seg::Cubic(_, a, b, c) => out.push(Verb::Cubic(a, b, c)),
            }
        }
        if s.closed {
            out.push(Verb::Close);
        }
    }
    out
}

/// The verbs traced the other way: each sub-path from its end back to its start, so a closed
/// outline winds the opposite way and cuts a hole from one it overlays under the non-zero rule.
pub fn reversed(verbs: &[Verb]) -> Vec<Verb> {
    let subs: Vec<Sub> = subs_of(verbs)
        .into_iter()
        .map(|s| Sub {
            segs: s
                .segs
                .iter()
                .rev()
                .map(|seg| match *seg {
                    Seg::Line(a, b) => Seg::Line(b, a),
                    Seg::Quad(a, c, b) => Seg::Quad(b, c, a),
                    Seg::Cubic(a, c1, c2, b) => Seg::Cubic(b, c2, c1, a),
                })
                .collect(),
            closed: s.closed,
        })
        .collect();
    verbs_of(&subs)
}

/// The segments the verbs hold.
pub fn segments(verbs: &[Verb]) -> u64 {
    subs_of(verbs).iter().map(|s| s.segs.len() as u64).sum()
}

/// A path's arc length in u, across its sub-paths.
pub fn length(verbs: &[Verb]) -> f64 {
    subs_of(verbs).iter().map(Sub::length).sum()
}

/// The point a fraction `f` of the way along the path by arc length, across its sub-paths, and
/// its tangent angle in degrees (clockwise on screen from +x), or `None` for an empty path.
pub fn at(verbs: &[Verb], f: f64) -> Option<(P, f64)> {
    let subs = subs_of(verbs);
    let measured: Vec<Measured<'_>> = subs.iter().map(Measured::of).collect();
    let total: f64 = measured.iter().map(Measured::length).sum();
    let mut s = f.clamp(0.0, 1.0) * total;
    let last = measured.len().checked_sub(1)?;
    for (i, sub) in measured.iter().enumerate() {
        let l = sub.length();
        if s <= l || i == last {
            let (p, d) = sub.at_length(s.min(l))?;
            return Some((p, m::deg(m::atan2(d[1], d[0]))));
        }
        s -= l;
    }
    None
}

// ---------------------------------------------------------------------------------------------------
// The ops

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Points {
    Corner,
    Smooth,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Composite {
    Below,
    Above,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Partial {
    Fade,
    Slide,
}

/// A Penner ease by family and side, for a repeater's slide.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ease {
    family: Family,
    side: Side,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Family {
    Linear,
    Quad,
    Cubic,
    Quart,
    Quint,
    Sine,
    Expo,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Side {
    In,
    Out,
    InOut,
}

impl Ease {
    pub const LINEAR: Ease = Ease {
        family: Family::Linear,
        side: Side::In,
    };

    fn named(name: &str) -> Option<Ease> {
        if name == "linear" {
            return Some(Ease::LINEAR);
        }
        let (side, family) = if let Some(f) = name.strip_prefix("in_out_") {
            (Side::InOut, f)
        } else if let Some(f) = name.strip_prefix("in_") {
            (Side::In, f)
        } else {
            (Side::Out, name.strip_prefix("out_")?)
        };
        let family = match family {
            "quad" => Family::Quad,
            "cubic" => Family::Cubic,
            "quart" => Family::Quart,
            "quint" => Family::Quint,
            "sine" => Family::Sine,
            "expo" => Family::Expo,
            _ => return None,
        };
        Some(Ease { family, side })
    }

    fn ease_in(family: Family, x: f64) -> f64 {
        match family {
            Family::Linear => x,
            Family::Quad => x * x,
            Family::Cubic => x * x * x,
            Family::Quart => x * x * x * x,
            Family::Quint => x * x * x * x * x,
            Family::Sine => 1.0 - m::cos(x * std::f64::consts::FRAC_PI_2),
            Family::Expo => m::pow(2.0, 10.0 * x - 10.0),
        }
    }

    /// The ease at `x` in 0..1, exactly 0 at 0 and 1 at 1.
    pub fn at(&self, x: f64) -> f64 {
        let x = x.clamp(0.0, 1.0);
        if x == 0.0 || x == 1.0 {
            return x;
        }
        match self.side {
            Side::In => Ease::ease_in(self.family, x),
            Side::Out => 1.0 - Ease::ease_in(self.family, 1.0 - x),
            Side::InOut => {
                if x < 0.5 {
                    Ease::ease_in(self.family, 2.0 * x) / 2.0
                } else {
                    1.0 - Ease::ease_in(self.family, 2.0 - 2.0 * x) / 2.0
                }
            }
        }
    }
}

/// A repeater's params (Path: ops, `repeater`).
#[derive(Clone, Debug, PartialEq)]
pub struct Repeater {
    pub copies: f64,
    pub offset: f64,
    pub pos: P,
    pub rot: f64,
    pub scale: P,
    pub pivot: P,
    pub opacity: [f64; 2],
    pub composite: Composite,
    pub partial: Partial,
    pub ease: Ease,
    /// Flicks copy k's source lags copy k − 1's (`lag: flick`, a time literal).
    pub lag: i64,
}

/// One path op with its params read.
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    Trim {
        start: f64,
        end: f64,
        offset: f64,
        each: bool,
    },
    RoundCorners {
        radius: f64,
    },
    OffsetPath {
        amount: f64,
        join: Join,
        miter_limit: f64,
        copies: u64,
        copy_offset: f64,
    },
    Zigzag {
        size: f64,
        ridges: u64,
        points: Points,
    },
    Pucker {
        amount: f64,
    },
    Twist {
        angle: f64,
        center: P,
    },
    Repeater(Repeater),
}

impl Op {
    pub fn name(&self) -> &'static str {
        match self {
            Op::Trim { .. } => "trim",
            Op::RoundCorners { .. } => "round_corners",
            Op::OffsetPath { .. } => "offset_path",
            Op::Zigzag { .. } => "zigzag",
            Op::Pucker { .. } => "pucker",
            Op::Twist { .. } => "twist",
            Op::Repeater(_) => "repeater",
        }
    }

    /// The most segments and sub-paths the op builds from `(segments, subpaths)` in.
    pub fn declared(&self, (segments, subpaths): (u64, u64)) -> (u64, u64) {
        match self {
            // The window cuts at most two segments in two, in each sub-path with `each`, and a
            // wrapped window can split a sub-path in two.
            Op::Trim { each, .. } => {
                let windows = if *each { subpaths } else { 1 };
                (segments + 2 * windows, subpaths * 2)
            }
            // Each corner adds an arc.
            Op::RoundCorners { .. } => (segments * 2, subpaths),
            Op::OffsetPath { copies, .. } => (5 * copies * segments, copies * subpaths),
            Op::Zigzag { ridges, .. } => ((ridges + 1) * segments, subpaths),
            Op::Pucker { .. } | Op::Twist { .. } => (segments, subpaths),
            Op::Repeater(r) => {
                let n = r.copies.ceil() as u64;
                (n * segments, n * subpaths)
            }
        }
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    v?.as_f64().filter(|n| n.is_finite())
}

fn pair(v: Option<&Value>, default: P) -> Option<P> {
    match v {
        None | Some(Value::Null) => Some(default),
        Some(Value::Array(a)) if a.len() == 2 => Some([num(a.first())?, num(a.get(1))?]),
        Some(_) => None,
    }
}

/// A number field at its default, within `lo..=hi`, else `out_of_range`; another type is `bad_doc`.
fn field(
    op: &Map<String, Value>,
    name: &str,
    default: f64,
    (lo, hi): (f64, f64),
    path: &str,
) -> Result<f64, Refused> {
    match op.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => {
            let n = num(Some(v)).ok_or(Refused {
                code: "bad_doc",
                path: format!("{path}/{name}"),
            })?;
            if n < lo || n > hi {
                return refuse("out_of_range", format!("{path}/{name}"));
            }
            Ok(n)
        }
    }
}

fn word<'a>(op: &'a Map<String, Value>, name: &str, default: &'a str) -> Option<&'a str> {
    match op.get(name) {
        None | Some(Value::Null) => Some(default),
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => None,
    }
}

/// Reads one op `{<name>: {params}}` at `path`.
fn read_op(value: &Value, path: &str) -> Result<Op, Refused> {
    const NAMES: [&str; 7] = [
        "trim",
        "round_corners",
        "offset_path",
        "zigzag",
        "pucker",
        "twist",
        "repeater",
    ];
    let Some(map) = value.as_object() else {
        return refuse("bad_doc", path.to_string());
    };
    // The op's one key names its kind; the motion evaluator writes a channel's field through it.
    let named: Vec<&String> = map.keys().filter(|k| NAMES.contains(&k.as_str())).collect();
    let ([name], 1) = (named.as_slice(), map.len()) else {
        return refuse("bad_doc", path.to_string());
    };
    let name = *name;
    let empty = Map::new();
    let p = match map.get(name) {
        Some(Value::Object(o)) => o,
        None | Some(Value::Null) => &empty,
        Some(_) => return refuse("bad_doc", format!("{path}/{name}")),
    };
    // A field's path is `ops/<i>/<field>`: the op's one key names its kind, not a level.
    let path = path.to_string();
    let big = 1_000_000.0;
    let bad = |f: &str| Refused {
        code: "bad_doc",
        path: format!("{path}/{f}"),
    };
    let op = match name.as_str() {
        "trim" => Op::Trim {
            start: field(p, "start", 0.0, (0.0, 1.0), &path)?,
            end: field(p, "end", 1.0, (0.0, 1.0), &path)?,
            offset: field(p, "offset", 0.0, (-big, big), &path)?,
            each: match p.get("each") {
                None | Some(Value::Null) => false,
                Some(Value::Bool(b)) => *b,
                Some(_) => return Err(bad("each")),
            },
        },
        "round_corners" => Op::RoundCorners {
            radius: field(p, "radius", 10.0, (0.0, big), &path)?,
        },
        "offset_path" => {
            let copies = field(p, "copies", 1.0, (1.0, MAX_OFFSET_COPIES as f64), &path)?;
            if copies.fract() != 0.0 {
                return refuse("out_of_range", format!("{path}/copies"));
            }
            Op::OffsetPath {
                amount: field(p, "amount", 10.0, (-big, big), &path)?,
                join: match word(p, "join", "miter").ok_or_else(|| bad("join"))? {
                    "miter" => Join::Miter,
                    "round" => Join::Round,
                    "bevel" => Join::Bevel,
                    _ => return Err(bad("join")),
                },
                miter_limit: field(p, "miter_limit", 4.0, (1.0, big), &path)?,
                copies: copies as u64,
                copy_offset: field(p, "copy_offset", 0.0, (-big, big), &path)?,
            }
        }
        "zigzag" => {
            let ridges = field(p, "ridges", 5.0, (0.0, MAX_RIDGES as f64), &path)?;
            if ridges.fract() != 0.0 {
                return refuse("out_of_range", format!("{path}/ridges"));
            }
            Op::Zigzag {
                size: field(p, "size", 10.0, (0.0, big), &path)?,
                ridges: ridges as u64,
                points: match word(p, "points", "corner").ok_or_else(|| bad("points"))? {
                    "corner" => Points::Corner,
                    "smooth" => Points::Smooth,
                    _ => return Err(bad("points")),
                },
            }
        }
        "pucker" => Op::Pucker {
            amount: field(p, "amount", 0.0, (-1.0, 1.0), &path)?,
        },
        "twist" => Op::Twist {
            angle: field(p, "angle", 0.0, (-big, big), &path)?,
            center: pair(p.get("center"), [0.0, 0.0]).ok_or_else(|| bad("center"))?,
        },
        "repeater" => {
            let empty = Map::new();
            let at = match p.get("at") {
                None | Some(Value::Null) => &empty,
                Some(Value::Object(o)) => o,
                Some(_) => return Err(bad("at")),
            };
            let at_path = format!("{path}/at");
            let scale = match at.get("scale") {
                None | Some(Value::Null) => [1.0, 1.0],
                Some(Value::Array(_)) => {
                    pair(at.get("scale"), [1.0, 1.0]).ok_or_else(|| bad("at/scale"))?
                }
                Some(v) => {
                    let s = num(Some(v)).ok_or_else(|| bad("at/scale"))?;
                    [s, s]
                }
            };
            let opacity = match p.get("opacity") {
                None | Some(Value::Null) => [1.0, 1.0],
                Some(Value::Array(a)) if a.len() == 2 => {
                    let o = [num(a.first()), num(a.get(1))];
                    let (Some(a), Some(b)) = (o[0], o[1]) else {
                        return Err(bad("opacity"));
                    };
                    if !(0.0..=1.0).contains(&a) || !(0.0..=1.0).contains(&b) {
                        return refuse("out_of_range", format!("{path}/opacity"));
                    }
                    [a, b]
                }
                Some(_) => return Err(bad("opacity")),
            };
            let ease = match p.get("ease") {
                None | Some(Value::Null) => Ease::LINEAR,
                Some(Value::String(s)) => Ease::named(s).ok_or_else(|| bad("ease"))?,
                Some(_) => return Err(bad("ease")),
            };
            Op::Repeater(Repeater {
                copies: field(p, "copies", 3.0, (0.0, MAX_COPIES), &path)?,
                offset: field(p, "offset", 0.0, (-MAX_COPIES, MAX_COPIES), &path)?,
                pos: pair(at.get("pos"), [0.0, 0.0]).ok_or_else(|| bad("at/pos"))?,
                rot: field(at, "rot", 0.0, (-big, big), &at_path)?,
                scale,
                pivot: pair(at.get("pivot"), [0.0, 0.0]).ok_or_else(|| bad("at/pivot"))?,
                opacity,
                composite: match word(p, "composite", "below").ok_or_else(|| bad("composite"))? {
                    "below" => Composite::Below,
                    "above" => Composite::Above,
                    _ => return Err(bad("composite")),
                },
                partial: match word(p, "partial", "fade").ok_or_else(|| bad("partial"))? {
                    "fade" => Partial::Fade,
                    "slide" => Partial::Slide,
                    _ => return Err(bad("partial")),
                },
                ease,
                lag: match p.get("lag") {
                    None | Some(Value::Null) => 0,
                    Some(Value::String(text)) => {
                        let ctx = deep_canvas::grammar::TimeContext {
                            frame_rate: (60, 1),
                            markers: Default::default(),
                        };
                        let flicks = deep_canvas::grammar::Time::parse(text)
                            .and_then(|t| t.resolve(&ctx))
                            .map_err(|_| bad("lag"))?;
                        if flicks < 0 {
                            return refuse("out_of_range", format!("{path}/lag"));
                        }
                        flicks
                    }
                    Some(_) => return Err(bad("lag")),
                },
            })
        }
        _ => return refuse("bad_doc", format!("{path}/{name}")),
    };
    Ok(op)
}

/// Reads an item's `ops` at `path` (`items/<id>/params/ops`): at most eight, each one op.
pub fn read(ops: Option<&Value>, path: &str) -> Result<Vec<Op>, Refused> {
    let list = match ops {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Array(a)) => a,
        Some(_) => return refuse("bad_doc", path.to_string()),
    };
    if list.len() > MAX_OPS {
        return refuse("out_of_range", path.to_string());
    }
    list.iter()
        .enumerate()
        .map(|(i, v)| read_op(v, &format!("{path}/{i}")))
        .collect()
}

/// The segments the ops declare from `segments` in: the count after each op in turn, and the
/// index of the first op whose output passes `MAX_PATH_SEGMENTS`, if any.
pub fn declared(ops: &[Op], verbs: &[Verb]) -> (u64, Option<usize>) {
    let subs = subs_of(verbs);
    let mut n = (
        subs.iter().map(|s| s.segs.len() as u64).sum(),
        subs.len() as u64,
    );
    for (i, op) in ops.iter().enumerate() {
        n = op.declared(n);
        if n.0 > MAX_PATH_SEGMENTS {
            return (n.0, Some(i));
        }
    }
    (n.0, None)
}

/// One built copy of the path: its verbs and the opacity it draws at.
#[derive(Clone, Debug, PartialEq)]
pub struct Copy {
    pub verbs: Vec<Verb>,
    pub opacity: f64,
    /// The index of the repeater copy this came from, and its fraction of the repeater's
    /// transform (`k + offset`, or the slid fraction).
    pub copy: Option<(usize, f64)>,
    /// The repeater's transform for this copy (identity for none).
    pub transform: Affine,
}

struct Piece {
    subs: Vec<Sub>,
    opacity: f64,
    copy: Option<(usize, f64)>,
    transform: Affine,
}

/// Runs `ops` over `verbs` in order, each on every copy so far.
pub fn apply(ops: &[Op], verbs: &[Verb]) -> Vec<Copy> {
    apply_planted(ops, verbs, &[], None)
}

/// [`apply`] with a lagging repeater's earlier sources (see [`apply_planted`]).
pub fn apply_lagged(ops: &[Op], verbs: &[Verb], lagged: &[Vec<Verb>]) -> Vec<Copy> {
    apply_planted(ops, verbs, lagged, None)
}

/// A planted wrong program's shift of an op's output (#160 AC5's `moved:<op>`), in u along +x.
pub const MOVED: f64 = 0.02;

fn shift(piece: &mut Piece, by: f64) {
    for s in &mut piece.subs {
        for seg in &mut s.segs {
            *seg = seg.map(|p| [p[0] + by, p[1]]);
        }
    }
    piece.transform[4] += by;
}

/// The index of the first repeater whose copies lag, if any.
pub fn lagged_repeater(ops: &[Op]) -> Option<(usize, &Repeater)> {
    ops.iter().enumerate().find_map(|(i, op)| match op {
        Op::Repeater(r) if r.lag > 0 => Some((i, r)),
        _ => None,
    })
}

/// [`apply`] where a lagging repeater's copy k is built from `lagged[k − 1]`, the path as it was
/// k × lag earlier (its ops before the repeater applied to that source), as an echo's copies
/// are; copy 0 and any copy past the sources given come from `verbs`.
pub fn apply_planted(
    ops: &[Op],
    verbs: &[Verb],
    lagged: &[Vec<Verb>],
    moved: Option<&str>,
) -> Vec<Copy> {
    let start = |v: &[Verb]| Piece {
        subs: subs_of(v),
        opacity: 1.0,
        copy: None,
        transform: IDENTITY,
    };
    let run_all = |ops: &[Op], mut pieces: Vec<Piece>| -> Vec<Piece> {
        for op in ops {
            pieces = pieces
                .into_iter()
                .flat_map(|piece| run(op, piece))
                .map(|mut piece| {
                    if moved == Some(op.name()) {
                        shift(&mut piece, MOVED);
                    }
                    piece
                })
                .collect();
        }
        pieces
    };
    let pieces = match lagged_repeater(ops) {
        Some((i, r)) if !lagged.is_empty() => {
            let before = run_all(&ops[..i], vec![start(verbs)]);
            let sources: Vec<Vec<Piece>> = lagged
                .iter()
                .map(|v| run_all(&ops[..i], vec![start(v)]))
                .collect();
            let mut copies = Vec::new();
            for (j, piece) in before.into_iter().enumerate() {
                let source = |k: usize| -> Vec<Sub> {
                    sources
                        .get(k.wrapping_sub(1))
                        .and_then(|s| s.get(j))
                        .map_or_else(|| piece.subs.clone(), |p| p.subs.clone())
                };
                let mut made = repeat_from(r, &source, piece.opacity);
                if moved == Some("repeater") {
                    made.iter_mut().for_each(|p| shift(p, MOVED));
                }
                copies.extend(made);
            }
            run_all(&ops[i + 1..], copies)
        }
        _ => run_all(ops, vec![start(verbs)]),
    };
    pieces
        .into_iter()
        .map(|p| Copy {
            verbs: verbs_of(&p.subs),
            opacity: p.opacity,
            copy: p.copy,
            transform: p.transform,
        })
        .collect()
}

fn run(op: &Op, piece: Piece) -> Vec<Piece> {
    let Piece {
        subs,
        opacity,
        copy,
        transform,
    } = piece;
    let one = |subs: Vec<Sub>| {
        vec![Piece {
            subs,
            opacity,
            copy,
            transform,
        }]
    };
    match op {
        Op::Trim {
            start,
            end,
            offset,
            each,
        } => one(trim(&subs, *start, *end, *offset, *each)),
        Op::RoundCorners { radius } => {
            one(subs.iter().map(|s| round_corners(s, *radius)).collect())
        }
        Op::OffsetPath {
            amount,
            join,
            miter_limit,
            copies,
            copy_offset,
        } => {
            let mut out = Vec::new();
            for c in 0..*copies {
                let by = amount + c as f64 * copy_offset;
                out.extend(subs.iter().map(|s| offset_sub(s, by, *join, *miter_limit)));
            }
            one(out)
        }
        Op::Zigzag {
            size,
            ridges,
            points,
        } => one(subs
            .iter()
            .map(|s| zigzag(s, *size, *ridges, *points))
            .collect()),
        Op::Pucker { amount } => one(pucker(&subs, *amount)),
        Op::Twist { angle, center } => one(twist(&subs, *angle, *center)),
        Op::Repeater(r) => repeat(r, subs, opacity)
            .into_iter()
            .map(|mut p| {
                // A repeater after another composes its transform onto the copy's.
                p.transform = compose(p.transform, transform);
                p
            })
            .collect(),
    }
}

// ---------------------------------------------------------------------------------------------------
// Trim

/// The window `start..end` of the path's length, moved by `offset` degrees of a turn round it,
/// on the whole path or on each sub-path.
fn trim(subs: &[Sub], start: f64, end: f64, offset: f64, each: bool) -> Vec<Sub> {
    if start >= end {
        return Vec::new();
    }
    if each {
        return subs
            .iter()
            .flat_map(|s| trim_one(std::slice::from_ref(s), start, end, offset))
            .collect();
    }
    trim_one(subs, start, end, offset)
}

/// The window over `subs` read as one path of their lengths end to end.
fn trim_one(subs: &[Sub], start: f64, end: f64, offset: f64) -> Vec<Sub> {
    let measured: Vec<Measured<'_>> = subs.iter().map(Measured::of).collect();
    let lengths: Vec<f64> = measured.iter().map(Measured::length).collect();
    let total: f64 = lengths.iter().sum();
    if total <= 0.0 {
        return Vec::new();
    }
    // A whole window is the path as it is, however it's offset.
    if start <= 0.0 && end >= 1.0 {
        return subs.to_vec();
    }
    let turn = offset / 360.0;
    let shift = (turn - turn.floor()) * total;
    // A window whose start passes the end wraps whole, so it starts inside 0..total.
    let wrap = if start * total + shift >= total {
        total
    } else {
        0.0
    };
    let s0 = start * total + shift - wrap;
    let s1 = end * total + shift - wrap;
    // The windows in 0..total: one, or two when the window wraps past the end.
    let windows: Vec<(f64, f64)> = if s1 <= total {
        vec![(s0, s1)]
    } else {
        vec![(s0, total), (0.0, s1 - total)]
    };
    let mut out: Vec<Sub> = Vec::new();
    for (a, b) in windows {
        let mut from = 0.0;
        for (sub, l) in measured.iter().zip(&lengths) {
            let to = from + l;
            if to > a && from < b {
                let piece = sub.piece((a - from).max(0.0), (b - from).min(*l));
                if !piece.segs.is_empty() {
                    out.push(piece);
                }
            }
            from = to;
        }
    }
    // A wrapped window on one closed sub-path is one piece: the end runs into the start.
    if subs.len() == 1 && subs[0].closed && out.len() == 2 {
        let tail = out.pop().expect("two pieces");
        let head = out.pop().expect("two pieces");
        let mut segs = head.segs;
        segs.extend(tail.segs);
        out.push(Sub {
            segs,
            closed: false,
        });
    }
    out
}

// ---------------------------------------------------------------------------------------------------
// Round corners

/// The handle fraction lottie-web's rounded corners use: a cubic with handles this far back toward
/// the corner draws a quarter circle on a right angle.
const ROUND_CORNER: f64 = 0.5519;

/// A sub-path as Lottie holds one: each vertex with its in and out handles (the vertex itself
/// where its segment is straight). A quadratic's handles are its cubic's.
fn lottie_vertices(sub: &Sub) -> Vec<(P, P, P)> {
    let n = sub.segs.len();
    let count = if sub.closed { n } else { n + 1 };
    let mut v: Vec<(P, P, P)> = (0..count)
        .map(|k| {
            let p = if k < n {
                sub.segs[k].start()
            } else {
                sub.segs[n - 1].end()
            };
            (p, p, p)
        })
        .collect();
    for (k, seg) in sub.segs.iter().enumerate() {
        let next = (k + 1) % count;
        let (out, inn) = match *seg {
            Seg::Line(a, b) => (a, b),
            Seg::Quad(a, c, b) => (
                vadd(a, vmul(vsub(c, a), 2.0 / 3.0)),
                vadd(b, vmul(vsub(c, b), 2.0 / 3.0)),
            ),
            Seg::Cubic(_, c1, c2, _) => (c1, c2),
        };
        v[k].2 = out;
        v[next].1 = inn;
    }
    v
}

/// Lottie's vertices, `(point, in, out)`, back to segments: straight where both handles sit on
/// their vertices, else a cubic.
fn from_lottie(v: &[(P, P, P)], closed: bool) -> Sub {
    let n = v.len();
    let spans = if closed { n } else { n.saturating_sub(1) };
    let segs = (0..spans)
        .map(|k| {
            let (a, _, out) = v[k];
            let (b, inn, _) = v[(k + 1) % n];
            if out == a && inn == b {
                Seg::Line(a, b)
            } else {
                Seg::Cubic(a, out, inn, b)
            }
        })
        .collect();
    Sub { segs, closed }
}

/// Lottie's rounded corners (lottie-web's RoundCornersModifier): each sharp vertex, one whose
/// handles both sit on it, becomes two, cut min(side ÷ 2, `radius`) back along the line to each
/// neighbour and joined by a cubic whose handles reach 0.5519 of the way back to the vertex. An
/// open sub-path's two ends stay, and a vertex with a handle off it is left as it is.
fn round_corners(sub: &Sub, radius: f64) -> Sub {
    let v = lottie_vertices(sub);
    let n = v.len();
    if radius <= 0.0 || n < 2 {
        return sub.clone();
    }
    let cut = |at: P, toward: P| -> P {
        let d = norm(vsub(toward, at));
        let f = if d > 0.0 {
            (d / 2.0).min(radius) / d
        } else {
            0.0
        };
        vadd(at, vmul(vsub(toward, at), f))
    };
    let mut out: Vec<(P, P, P)> = Vec::with_capacity(n * 2);
    for k in 0..n {
        let (p, inn, o) = v[k];
        let end = !sub.closed && (k == 0 || k == n - 1);
        if p != inn || p != o || end {
            out.push(v[k]);
            continue;
        }
        let prev = v[(k + n - 1) % n].0;
        let next = v[(k + 1) % n].0;
        let a = cut(p, prev);
        out.push((a, a, vsub(a, vmul(vsub(a, p), ROUND_CORNER))));
        let b = cut(p, next);
        out.push((b, vsub(b, vmul(vsub(b, p), ROUND_CORNER)), b));
    }
    from_lottie(&out, sub.closed)
}

// ---------------------------------------------------------------------------------------------------
// Offset path

/// The sub-path's signed area, positive clockwise on screen (y down).
fn signed_area(sub: &Sub) -> f64 {
    let mut a = 0.0;
    for seg in &sub.segs {
        let (p, q) = (seg.start(), seg.end());
        a += cross(p, q);
    }
    a / 2.0
}

/// The parameters in (0, 1) where a cubic's curvature changes sign.
fn inflections(seg: &Seg) -> Vec<f64> {
    let Seg::Cubic(p0, p1, p2, p3) = *seg else {
        return Vec::new();
    };
    let a = vsub(p1, p0);
    let b = vsub(vsub(p2, p1), a);
    let c = vsub(vsub(vsub(p3, p2), vsub(p2, p1)), b);
    // cross(d1, d2) = 0, a quadratic in t.
    let qa = cross(b, c);
    let qb = cross(a, c);
    let qc = cross(a, b);
    let mut out = Vec::new();
    if qa.abs() < 1e-12 {
        if qb.abs() > 1e-12 {
            out.push(-qc / qb);
        }
    } else {
        let disc = qb * qb - 4.0 * qa * qc;
        if disc >= 0.0 {
            let s = m::sqrt(disc);
            out.push((-qb - s) / (2.0 * qa));
            out.push((-qb + s) / (2.0 * qa));
        }
    }
    out.retain(|t| *t > 1e-6 && *t < 1.0 - 1e-6);
    out.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
    out
}

/// A segment moved `by` u along its left normal: a line exactly, a curve by Tiller–Hanson on
/// its control polygon after splitting at its inflections.
fn offset_seg(seg: &Seg, by: f64) -> Vec<Seg> {
    let mut pieces = Vec::new();
    let mut rest = *seg;
    let mut t0 = 0.0;
    for t in inflections(seg) {
        let u = (t - t0) / (1.0 - t0);
        let (head, tail) = rest.split(u);
        pieces.push(head);
        rest = tail;
        t0 = t;
    }
    pieces.push(rest);
    pieces
        .into_iter()
        .filter_map(|piece| match piece {
            Seg::Line(a, b) => {
                let n = vmul(left(unit(vsub(b, a))?), by);
                Some(Seg::Line(vadd(a, n), vadd(b, n)))
            }
            Seg::Quad(a, b, c) => {
                let l0 = offset_line(a, b, by)?;
                let l1 = offset_line(b, c, by)?;
                let mid = meet(l0, l1).unwrap_or(lerp(l0.1, l1.0, 0.5));
                Some(Seg::Quad(l0.0, mid, l1.1))
            }
            Seg::Cubic(a, b, c, d) => {
                let l0 = offset_line(a, b, by).or_else(|| offset_line(a, c, by))?;
                let l2 = offset_line(c, d, by).or_else(|| offset_line(b, d, by))?;
                let l1 = offset_line(b, c, by).unwrap_or((l0.1, l2.0));
                let h1 = meet(l0, l1).unwrap_or(l0.1);
                let h2 = meet(l1, l2).unwrap_or(l2.0);
                Some(Seg::Cubic(l0.0, h1, h2, l2.1))
            }
        })
        .collect()
}

fn offset_line(a: P, b: P, by: f64) -> Option<(P, P)> {
    let n = vmul(left(unit(vsub(b, a))?), by);
    Some((vadd(a, n), vadd(b, n)))
}

/// Where two lines meet, or `None` when parallel.
fn meet(l0: (P, P), l1: (P, P)) -> Option<P> {
    let d0 = vsub(l0.1, l0.0);
    let d1 = vsub(l1.1, l1.0);
    let den = cross(d0, d1);
    if den.abs() < 1e-12 {
        return None;
    }
    let t = cross(vsub(l1.0, l0.0), d1) / den;
    Some(vadd(l0.0, vmul(d0, t)))
}

/// An arc from `from` to `to` about `center`, as cubics of at most a quarter turn each, turning
/// the short way.
fn arc_cubics(center: P, from: P, to: P, out: &mut Vec<Seg>) {
    let a0 = m::atan2(from[1] - center[1], from[0] - center[0]);
    let a1 = m::atan2(to[1] - center[1], to[0] - center[0]);
    let mut sweep = a1 - a0;
    while sweep > std::f64::consts::PI {
        sweep -= 2.0 * std::f64::consts::PI;
    }
    while sweep < -std::f64::consts::PI {
        sweep += 2.0 * std::f64::consts::PI;
    }
    arc_sweep(center, from, sweep, Some(to), out);
}

/// An arc from `from` about `center` through `sweep` radians (clockwise on screen when
/// positive), as cubics of at most a quarter turn each; `to` pins its end point exactly.
fn arc_sweep(center: P, from: P, sweep: f64, to: Option<P>, out: &mut Vec<Seg>) {
    let r = norm(vsub(from, center));
    if r <= 0.0 || sweep == 0.0 {
        return;
    }
    let a0 = m::atan2(from[1] - center[1], from[0] - center[0]);
    let steps = ((sweep.abs() / std::f64::consts::FRAC_PI_2).ceil() as usize).max(1);
    let step = sweep / steps as f64;
    let k = 4.0 / 3.0 * m::tan(step / 4.0);
    let mut a = a0;
    let mut p = from;
    for i in 0..steps {
        let b = a + step;
        let q = match to {
            Some(to) if i + 1 == steps => to,
            _ => vadd(center, [r * m::cos(b), r * m::sin(b)]),
        };
        let ta = [-m::sin(a), m::cos(a)];
        let tb = [-m::sin(b), m::cos(b)];
        out.push(Seg::Cubic(
            p,
            vadd(p, vmul(ta, k * r)),
            vsub(q, vmul(tb, k * r)),
            q,
        ));
        a = b;
        p = q;
    }
}

/// The sub-path moved `amount` u out (for a closed one) or to its left (open), its corners
/// joined by `join`.
fn offset_sub(sub: &Sub, amount: f64, join: Join, miter_limit: f64) -> Sub {
    if amount == 0.0 || sub.segs.is_empty() {
        return sub.clone();
    }
    // Positive moves a closed sub-path outward whichever way it winds.
    let by = if sub.closed && signed_area(sub) < 0.0 {
        -amount
    } else {
        amount
    };
    let moved: Vec<Vec<Seg>> = sub.segs.iter().map(|s| offset_seg(s, by)).collect();
    let mut segs: Vec<Seg> = Vec::new();
    let n = moved.len();
    for i in 0..n {
        let pieces = &moved[i];
        let Some(first) = pieces.first() else {
            continue;
        };
        // The join from the previous piece's end to this one's start.
        let prev = if i > 0 {
            moved[i - 1].last().map(|s| (s.end(), s.tangent(1.0)))
        } else if sub.closed {
            moved[n - 1].last().map(|s| (s.end(), s.tangent(1.0)))
        } else {
            None
        };
        if let Some((end, out_dir)) = prev {
            let corner = sub.segs[i].start();
            let in_dir = first.tangent(0.0);
            join_at(
                join,
                miter_limit,
                by,
                corner,
                (end, out_dir),
                (first.start(), in_dir),
                &mut segs,
            );
        }
        segs.extend(pieces.iter().copied());
    }
    Sub {
        segs,
        closed: sub.closed,
    }
}

/// The segments that join an offset end at `from` (leaving along `d0`) to the next start at `to`
/// (arriving along `d1`) round `corner`.
fn join_at(
    join: Join,
    miter_limit: f64,
    by: f64,
    corner: P,
    (from, d0): (P, P),
    (to, d1): (P, P),
    out: &mut Vec<Seg>,
) {
    if norm(vsub(to, from)) < 1e-9 {
        return;
    }
    let (Some(u0), Some(u1)) = (unit(d0), unit(d1)) else {
        out.push(Seg::Line(from, to));
        return;
    };
    // The offset side is the left normal; a turn toward +y (clockwise on screen) puts that side
    // outside the corner. An inside corner's offset lines cross, and a straight join keeps the
    // path connected.
    let turn = cross(u0, u1);
    let inside = (turn > 0.0) != (by > 0.0);
    if inside {
        out.push(Seg::Line(from, to));
        return;
    }
    match join {
        Join::Bevel => out.push(Seg::Line(from, to)),
        Join::Round => arc_cubics(corner, from, to, out),
        Join::Miter => {
            let cos_theta = dot(u0, u1).clamp(-1.0, 1.0);
            // The miter length ratio, 1 / sin(θ/2) with θ the angle between the segments.
            let half = m::acos(cos_theta) / 2.0;
            let ratio = 1.0 / m::cos(half).max(1e-12);
            match meet((from, vadd(from, u0)), (to, vsub(to, u1))) {
                Some(tip) if ratio <= miter_limit => {
                    out.push(Seg::Line(from, tip));
                    out.push(Seg::Line(tip, to));
                }
                _ => out.push(Seg::Line(from, to)),
            }
        }
    }
}

/// The arc from `a` to `b` whose tangent turns through `turn` degrees (Path: `bend`), as verbs;
/// a straight line for no turn.
pub fn bent(a: P, b: P, turn: f64) -> Vec<Verb> {
    let chord = vsub(b, a);
    let c = norm(chord);
    let theta = m::rad(turn.clamp(-359.0, 359.0));
    if c <= 0.0 || theta.abs() < 1e-9 {
        return vec![Verb::Move(a), Verb::Line(b)];
    }
    let r = c / (2.0 * m::sin(theta.abs() / 2.0));
    let mid = lerp(a, b, 0.5);
    let n = left(vmul(chord, 1.0 / c));
    // The arc bulges toward the left normal for a clockwise turn, so the centre lies the other way.
    let side = if theta > 0.0 { -1.0 } else { 1.0 };
    let center = vadd(mid, vmul(n, side * r * m::cos(theta.abs() / 2.0)));
    let mut segs = Vec::new();
    arc_sweep(center, a, theta, Some(b), &mut segs);
    verbs_of(&[Sub {
        segs,
        closed: false,
    }])
}

// ---------------------------------------------------------------------------------------------------
// Zig zag

/// Lottie's zig zag: each segment cut into `ridges` + 1 pieces, its ridges and its corners
/// pushed `size` u to either side in turn: corners as lines, or smooth with lottie-web's handles
/// along the path.
fn zigzag(sub: &Sub, size: f64, ridges: u64, points: Points) -> Sub {
    // lottie-web's ZigZagModifier.processPath: each corner moves `size` along the normal of the
    // chord from its previous vertex to its next, each ridge along its segment's normal at
    // k ÷ (ridges + 1), the direction flipping after each ridge; every side starts opposite the
    // corner before it, and each corner takes the direction the side before it ended on. An open
    // sub-path's two ends stay where they are (Lottie's would wrap to the far end for a neighbour).
    let n = sub.segs.len();
    if n == 0 {
        return sub.clone();
    }
    let f = ridges as f64 + 1.0;
    let count = if sub.closed { n } else { n + 1 };
    let vertex = |k: usize| -> P {
        if k < n {
            sub.segs[k].start()
        } else {
            sub.segs[n - 1].end()
        }
    };
    // Each point: where it lands, its direction along the path (for smooth handles), and its
    // handle lengths in and out.
    let mut pts: Vec<(P, P, f64, f64)> = Vec::with_capacity(count + n * ridges as usize);
    let corner = |k: usize, direction: f64| -> (P, P, f64, f64) {
        let p = vertex(k);
        let open_end = !sub.closed && (k == 0 || k == count - 1);
        let prev = vertex(if k == 0 { count - 1 } else { k - 1 });
        let next = vertex((k + 1) % count);
        let along = if open_end {
            sub.segs[k.min(n - 1)].tangent(if k == 0 { 0.0 } else { 1.0 })
        } else {
            vsub(next, prev)
        };
        let t = unit(along).unwrap_or([0.0, 0.0]);
        let moved = if open_end {
            p
        } else {
            vadd(p, vmul(left(t), direction * size))
        };
        let (din, dout) = match points {
            Points::Corner => (0.0, 0.0),
            Points::Smooth => (
                if k == 0 && !sub.closed {
                    0.0
                } else {
                    norm(vsub(p, prev))
                },
                if k == count - 1 && !sub.closed {
                    0.0
                } else {
                    norm(vsub(p, next))
                },
            ),
        };
        (moved, t, din / (f * 2.0), dout / (f * 2.0))
    };
    let mut direction = -1.0;
    pts.push(corner(0, direction));
    for (s, seg) in sub.segs.iter().enumerate() {
        let mut d = -direction;
        let chord = match points {
            Points::Corner => 0.0,
            Points::Smooth => norm(vsub(seg.end(), seg.start())) / (f * 2.0),
        };
        for r in 0..ridges {
            let t = (r as f64 + 1.0) / f;
            let along = unit(seg.tangent(t)).unwrap_or([0.0, 0.0]);
            pts.push((
                vadd(seg.at(t), vmul(left(along), d * size)),
                along,
                chord,
                chord,
            ));
            d = -d;
        }
        direction = d;
        // A closed sub-path's last corner is its first again.
        if s + 1 < count {
            pts.push(corner(s + 1, direction));
        }
    }
    let m = pts.len();
    let spans = if sub.closed { m } else { m - 1 };
    let segs = (0..spans)
        .map(|i| {
            let (a, ta, _, aout) = pts[i];
            let (b, tb, bin, _) = pts[(i + 1) % m];
            if aout == 0.0 && bin == 0.0 {
                Seg::Line(a, b)
            } else {
                Seg::Cubic(a, vadd(a, vmul(ta, aout)), vsub(b, vmul(tb, bin)), b)
            }
        })
        .collect();
    Sub {
        segs,
        closed: sub.closed,
    }
}

// ---------------------------------------------------------------------------------------------------
// Pucker and twist

/// The mean of the path's anchor points (each sub-path's vertices, its closing point once).
fn center_of(subs: &[Sub]) -> P {
    let mut sum = [0.0, 0.0];
    let mut n = 0.0;
    for s in subs {
        for (i, seg) in s.segs.iter().enumerate() {
            let last = i + 1 == s.segs.len();
            let mut pts = vec![seg.start()];
            // An open sub-path's last point counts; a closing point that repeats the start doesn't.
            if last && !(s.closed && seg.end() == s.segs[0].start()) {
                pts.push(seg.end());
            }
            for p in pts {
                sum = vadd(sum, p);
                n += 1.0;
            }
        }
    }
    if n > 0.0 {
        vmul(sum, 1.0 / n)
    } else {
        [0.0, 0.0]
    }
}

/// Lottie's pucker and bloat: each vertex moves toward the centre (the vertices' mean) by
/// `amount` of the way and each handle away from it by as much, so above 0 the sides bulge
/// (bloat) and below 0 the vertices spike out (pucker). A straight side's handles sit on its
/// vertices, so every segment becomes a cubic.
fn pucker(subs: &[Sub], amount: f64) -> Vec<Sub> {
    if amount == 0.0 {
        return subs.to_vec();
    }
    let c = center_of(subs);
    let anchor = |p: P| vadd(p, vmul(vsub(c, p), amount));
    let handle = |p: P| vsub(p, vmul(vsub(c, p), amount));
    subs.iter()
        .map(|s| Sub {
            segs: s
                .segs
                .iter()
                .map(|seg| {
                    let (a, b, cc, d) = match *seg {
                        Seg::Line(a, d) => (a, a, d, d),
                        Seg::Quad(a, b, d) => (a, b, b, d),
                        Seg::Cubic(a, b, cc, d) => (a, b, cc, d),
                    };
                    Seg::Cubic(anchor(a), handle(b), handle(cc), anchor(d))
                })
                .collect(),
            closed: s.closed,
        })
        .collect()
}

/// Every point turned about `center` by `angle` at the centre, less with distance, to none at the
/// path's farthest anchor.
fn twist(subs: &[Sub], angle: f64, center: P) -> Vec<Sub> {
    if angle == 0.0 {
        return subs.to_vec();
    }
    let mut reach: f64 = 0.0;
    for s in subs {
        for seg in &s.segs {
            for p in [seg.start(), seg.end()] {
                reach = reach.max(norm(vsub(p, center)));
            }
        }
    }
    if reach <= 0.0 {
        return subs.to_vec();
    }
    let turn = |p: P| {
        let f = (1.0 - norm(vsub(p, center)) / reach).max(0.0);
        rotate(p, center, angle * f)
    };
    // Each point turned once: a segment's start is the one before's end, turned already.
    subs.iter()
        .map(|s| {
            let mut last: Option<(P, P)> = None;
            let segs = s
                .segs
                .iter()
                .map(|seg| {
                    let start = match last {
                        Some((p, turned)) if p == seg.start() => turned,
                        _ => turn(seg.start()),
                    };
                    let end = turn(seg.end());
                    last = Some((seg.end(), end));
                    match *seg {
                        Seg::Line(..) => Seg::Line(start, end),
                        Seg::Quad(_, b, _) => Seg::Quad(start, turn(b), end),
                        Seg::Cubic(_, b, c, _) => Seg::Cubic(start, turn(b), turn(c), end),
                    }
                })
                .collect();
            Sub {
                segs,
                closed: s.closed,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------
// Repeater

/// An affine `[a, b, c, d, e, f]`: `x' = a x + c y + e`, `y' = b x + d y + f`.
pub type Affine = [f64; 6];

pub const IDENTITY: Affine = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

fn compose(m: Affine, n: Affine) -> Affine {
    // m ∘ n: n first.
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

fn transform(mx: Affine, p: P) -> P {
    [
        mx[0] * p[0] + mx[2] * p[1] + mx[4],
        mx[1] * p[0] + mx[3] * p[1] + mx[5],
    ]
}

impl Repeater {
    /// The repeater's transform applied `m` times, for whole `m`; a fraction between two whole
    /// powers interpolates their turn, their scale and their position.
    pub fn power(&self, m: f64) -> Affine {
        let (s, c) = (m::sin(m::rad(self.rot)), m::cos(m::rad(self.rot)));
        // One application: about the pivot, scale then turn, then move.
        let one: Affine = {
            let lin = [
                c * self.scale[0],
                s * self.scale[0],
                -s * self.scale[1],
                c * self.scale[1],
            ];
            let pv = self.pivot;
            let e = pv[0] - (lin[0] * pv[0] + lin[2] * pv[1]) + self.pos[0];
            let f = pv[1] - (lin[1] * pv[0] + lin[3] * pv[1]) + self.pos[1];
            [lin[0], lin[1], lin[2], lin[3], e, f]
        };
        let whole = |k: i64| -> Affine {
            let mut out = IDENTITY;
            if k >= 0 {
                for _ in 0..k {
                    out = compose(one, out);
                }
            } else {
                let inv = invert(one).unwrap_or(IDENTITY);
                for _ in 0..(-k) {
                    out = compose(inv, out);
                }
            }
            out
        };
        let k = m.floor();
        let f = m - k;
        let a = whole(k as i64);
        if f == 0.0 {
            return a;
        }
        let b = whole(k as i64 + 1);
        between(a, b, f)
    }
}

fn invert(mx: Affine) -> Option<Affine> {
    let det = mx[0] * mx[3] - mx[1] * mx[2];
    if det.abs() < 1e-18 {
        return None;
    }
    let (a, b, c, d) = (mx[3] / det, -mx[1] / det, -mx[2] / det, mx[0] / det);
    Some([
        a,
        b,
        c,
        d,
        -(a * mx[4] + c * mx[5]),
        -(b * mx[4] + d * mx[5]),
    ])
}

/// The affine a fraction `f` of the way from `a` to `b`: the turn, the scale and the position
/// each interpolated.
fn between(a: Affine, b: Affine, f: f64) -> Affine {
    let parts = |mx: Affine| -> (f64, P, P) {
        let sx = m::hypot(mx[0], mx[1]);
        let sy = m::hypot(mx[2], mx[3]);
        let angle = m::atan2(mx[1], mx[0]);
        let det = mx[0] * mx[3] - mx[1] * mx[2];
        let sy = if det < 0.0 { -sy } else { sy };
        (angle, [sx, sy], [mx[4], mx[5]])
    };
    let (ra, sa, pa) = parts(a);
    let (rb, sb, pb) = parts(b);
    let mut dr = rb - ra;
    while dr > std::f64::consts::PI {
        dr -= 2.0 * std::f64::consts::PI;
    }
    while dr < -std::f64::consts::PI {
        dr += 2.0 * std::f64::consts::PI;
    }
    let r = ra + dr * f;
    let scale = |x: f64, y: f64| {
        if x > 0.0 && y > 0.0 {
            x * m::pow(y / x, f)
        } else {
            x + (y - x) * f
        }
    };
    let s = [scale(sa[0], sb[0]), scale(sa[1], sb[1])];
    let p = lerp(pa, pb, f);
    let (sn, cs) = (m::sin(r), m::cos(r));
    [cs * s[0], sn * s[0], -sn * s[1], cs * s[1], p[0], p[1]]
}

/// ⌈copies⌉ copies, copy k through the transform applied k + offset times, at an opacity from
/// the first to the last; a fractional count fades its last copy or slides it from the copy
/// before.
fn repeat(r: &Repeater, subs: Vec<Sub>, opacity: f64) -> Vec<Piece> {
    repeat_from(r, &|_| subs.clone(), opacity)
}

/// [`repeat`] with copy k's source from `source(k)`.
fn repeat_from(r: &Repeater, source: &dyn Fn(usize) -> Vec<Sub>, opacity: f64) -> Vec<Piece> {
    let n = r.copies.ceil() as usize;
    if n == 0 {
        return Vec::new();
    }
    let frac = r.copies - (n as f64 - 1.0);
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let last = k + 1 == n;
        let along = if n > 1 {
            k as f64 / (n as f64 - 1.0)
        } else {
            0.0
        };
        let mut alpha = r.opacity[0] + (r.opacity[1] - r.opacity[0]) * along;
        let mut power = k as f64 + r.offset;
        if last && frac < 1.0 {
            match r.partial {
                Partial::Fade => alpha *= frac,
                Partial::Slide => power = (k as f64 - 1.0) + r.ease.at(frac) + r.offset,
            }
        }
        let mx = r.power(power);
        let moved = source(k)
            .iter()
            .map(|s| Sub {
                segs: s
                    .segs
                    .iter()
                    .map(|seg| seg.map(|p| transform(mx, p)))
                    .collect(),
                closed: s.closed,
            })
            .collect();
        out.push(Piece {
            subs: moved,
            opacity: opacity * alpha,
            copy: Some((k, power)),
            transform: mx,
        });
    }
    if r.composite == Composite::Below {
        out.reverse();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_trim_whose_start_wraps_past_the_end_keeps_its_window() {
        // #160: the loader's window late in its play, start 0.6, end 0.8 and offset 324°, on a
        // closed square of side 100 (400 u): both ends of the window pass the path's end, so
        // it's the 80 u from 200 u (1.5 × 400 − 400) to 280 u, one piece along the third side.
        let sq = |x: f64, y: f64| [x, y];
        let sub = Sub {
            segs: vec![
                Seg::Line(sq(0.0, 0.0), sq(100.0, 0.0)),
                Seg::Line(sq(100.0, 0.0), sq(100.0, 100.0)),
                Seg::Line(sq(100.0, 100.0), sq(0.0, 100.0)),
                Seg::Line(sq(0.0, 100.0), sq(0.0, 0.0)),
            ],
            closed: true,
        };
        let out = trim(&[sub], 0.6, 0.8, 324.0, false);
        let length: f64 = out.iter().map(Sub::length).sum();
        assert!(
            (length - 80.0).abs() < 1e-9,
            "the window is 80 u, got {length} in {out:?}"
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].segs[0].start(), [100.0, 100.0]);
        assert_eq!(out[0].segs[0].end(), [20.0, 100.0]);
    }

    #[test]
    fn a_curve_measures_its_arc_length_by_quadrature() {
        // A quarter circle of radius 100 as one cubic (handles 0.5523 r): its length by 200,000
        // chords is the reference; the quadrature lands within 1e-6 u, where a 128-chord sum
        // falls 1e-3 u short and the chord itself 11 u short.
        let k = 55.228_474_983_079_34;
        let arc = Seg::Cubic([100.0, 0.0], [100.0, k], [k, 100.0], [0.0, 100.0]);
        let n = 200_000;
        let fine: f64 = (1..=n)
            .map(|i| {
                let (a, b) = (
                    arc.at((i - 1) as f64 / n as f64),
                    arc.at(i as f64 / n as f64),
                );
                norm(vsub(b, a))
            })
            .sum();
        assert!(
            (arc.length() - fine).abs() < 1e-6,
            "{} vs {fine}",
            arc.length()
        );
        // A trim to the first half then ends half way along the arc by length.
        let sub = Sub {
            segs: vec![arc],
            closed: false,
        };
        let half = trim(&[sub], 0.0, 0.5, 0.0, false);
        let cut = half[0].segs[0].end();
        let to = |p: P, q: P| norm(vsub(q, p));
        let mid = arc.at(0.5);
        assert!(
            to(cut, mid) < 0.01,
            "{cut:?} vs the symmetric middle {mid:?}"
        );
    }
    use crate::path::parse;

    fn square() -> Vec<Verb> {
        parse("M 0 0 L 100 0 L 100 100 L 0 100 Z").unwrap()
    }

    #[test]
    fn a_closed_square_has_four_segments_and_a_length_of_400() {
        assert_eq!(segments(&square()), 4);
        assert!((length(&square()) - 400.0).abs() < 1e-9);
        let (p, a) = at(&square(), 0.375).unwrap();
        assert!((p[0] - 100.0).abs() < 1e-9 && (p[1] - 50.0).abs() < 1e-9);
        assert!((a - 90.0).abs() < 1e-9);
    }

    #[test]
    fn zigzag_builds_its_declared_segments() {
        let ops = read(Some(&serde_json::json!([{"zigzag": {"ridges": 5}}])), "ops").unwrap();
        assert_eq!(declared(&ops, &square()), (24, None));
        let built = apply(&ops, &square());
        assert_eq!(built.len(), 1);
        assert_eq!(segments(&built[0].verbs), 24);
    }

    #[test]
    fn a_repeater_past_the_budget_names_its_op() {
        let ops = read(
            Some(&serde_json::json!([{"zigzag": {"ridges": 256}}, {"repeater": {"copies": 64}}])),
            "ops",
        )
        .unwrap();
        let (n, over) = declared(&ops, &square());
        assert_eq!(over, Some(1));
        assert_eq!(n, 257 * 4 * 64);
    }

    #[test]
    fn a_trim_of_a_quarter_from_a_right_angle_offset_follows_the_circle() {
        let circle = crate::outline::circle([0.0, 0.0], 100.0, 0.0);
        let ops = read(
            Some(&serde_json::json!([{"trim": {"start": 0, "end": 0.25, "offset": 90}}])),
            "ops",
        )
        .unwrap();
        let built = apply(&ops, &circle);
        let verbs = &built[0].verbs;
        let l = length(verbs);
        assert!((l - 50.0 * std::f64::consts::PI).abs() < 0.05, "{l}");
        // 90° round the circle on screen is straight down: (0, 100).
        let (p, _) = at(verbs, 0.0).unwrap();
        assert!((p[0]).abs() < 0.01 && (p[1] - 100.0).abs() < 0.01, "{p:?}");
        let same = apply(
            &read(
                Some(&serde_json::json!([{"trim": {"start": 0, "end": 0.25, "offset": 450}}])),
                "ops",
            )
            .unwrap(),
            &circle,
        );
        assert_eq!(same[0].verbs, built[0].verbs);
    }

    #[test]
    fn a_repeater_with_three_and_a_half_copies_draws_four_the_last_at_half() {
        let ops = read(
            Some(&serde_json::json!([{"repeater": {"copies": 3.5, "at": {"pos": [10, 0], "rot": 30}}}])),
            "ops",
        )
        .unwrap();
        let built = apply(&ops, &square());
        assert_eq!(built.len(), 4);
        // Below: the first copy draws last, on top.
        assert_eq!(built[3].copy, Some((0, 0.0)));
        assert!((built[0].opacity - 0.5).abs() < 1e-12);
        let Op::Repeater(r) = &ops[0] else { panic!() };
        let twice = compose(r.power(1.0), r.power(1.0));
        let p2 = r.power(2.0);
        for i in 0..6 {
            assert!((twice[i] - p2[i]).abs() < 1e-9);
        }
    }

    #[test]
    fn slide_eases_the_last_copy_between_the_whole_powers() {
        let ops = read(
            Some(&serde_json::json!([{"repeater": {"copies": 2.5, "at": {"rot": 30}, "partial": "slide", "ease": "out_cubic"}}])),
            "ops",
        )
        .unwrap();
        let built = apply(&ops, &square());
        let Some((2, power)) = built
            .iter()
            .find(|c| c.copy.map(|c| c.0) == Some(2))
            .unwrap()
            .copy
        else {
            panic!()
        };
        assert!((power - 1.875).abs() < 1e-12);
        let Op::Repeater(r) = &ops[0] else { panic!() };
        let mx = r.power(power);
        let angle = m::deg(m::atan2(mx[1], mx[0]));
        assert!((angle - 56.25).abs() < 1e-9, "{angle}");
    }

    #[test]
    fn offset_path_grows_a_square_outward_whichever_way_it_winds() {
        let ops = read(
            Some(&serde_json::json!([{"offset_path": {"amount": 10}}])),
            "ops",
        )
        .unwrap();
        for d in [
            "M 0 0 L 100 0 L 100 100 L 0 100 Z",
            "M 0 0 L 0 100 L 100 100 L 100 0 Z",
        ] {
            let built = apply(&ops, &parse(d).unwrap());
            let subs = subs_of(&built[0].verbs);
            let mut lo = [f64::INFINITY; 2];
            let mut hi = [f64::NEG_INFINITY; 2];
            for s in &subs[0].segs {
                for p in [s.start(), s.end()] {
                    lo = [lo[0].min(p[0]), lo[1].min(p[1])];
                    hi = [hi[0].max(p[0]), hi[1].max(p[1])];
                }
            }
            assert!(
                (lo[0] + 10.0).abs() < 1e-9 && (hi[0] - 110.0).abs() < 1e-9,
                "{d}: {lo:?} {hi:?}"
            );
            // Mitred corners: the outline reaches each corner of the 120 u square.
            for corner in [
                [-10.0, -10.0],
                [110.0, -10.0],
                [110.0, 110.0],
                [-10.0, 110.0],
            ] {
                let reached = subs[0].segs.iter().any(|s| {
                    [s.start(), s.end()]
                        .iter()
                        .any(|p| norm(vsub(*p, corner)) < 1e-9)
                });
                assert!(reached, "{d}: no point at {corner:?}");
            }
        }
    }

    #[test]
    fn an_op_is_one_key_and_a_trim_with_each_declares_a_cut_per_sub_path() {
        let r = read(
            Some(&serde_json::json!([{"twist": {"angle": 10}, "angle": 40}])),
            "ops",
        )
        .unwrap_err();
        assert_eq!((r.code, r.path.as_str()), ("bad_doc", "ops/0"));
        let two = parse("M 0 0 L 10 0 L 10 10 Z M 20 0 L 30 0 L 30 10 Z").unwrap();
        let each = read(
            Some(&serde_json::json!([{"trim": {"start": 0.1, "end": 0.9, "each": true}}])),
            "ops",
        )
        .unwrap();
        let built: u64 = apply(&each, &two).iter().map(|c| segments(&c.verbs)).sum();
        assert_eq!(declared(&each, &two).0, 6 + 4);
        assert!(built <= 10, "{built}");
    }

    #[test]
    fn round_corners_keeps_a_square_closed_with_eight_segments() {
        let ops = read(
            Some(&serde_json::json!([{"round_corners": {"radius": 10}}])),
            "ops",
        )
        .unwrap();
        let built = apply(&ops, &square());
        let subs = subs_of(&built[0].verbs);
        assert!(subs[0].closed);
        assert_eq!(subs[0].segs.len(), 8);
        // Every corner's arc stays inside the square, and the straight runs are 80 u.
        let lines: Vec<f64> = subs[0]
            .segs
            .iter()
            .filter(|s| matches!(s, Seg::Line(..)))
            .map(Seg::length)
            .collect();
        assert_eq!(lines.len(), 4);
        assert!(lines.iter().all(|l| (l - 80.0).abs() < 1e-9), "{lines:?}");
    }

    #[test]
    fn more_than_eight_ops_or_an_unknown_op_is_refused() {
        let nine: Vec<Value> = (0..9).map(|_| serde_json::json!({"pucker": {}})).collect();
        assert_eq!(
            read(Some(&Value::Array(nine)), "ops").unwrap_err().code,
            "out_of_range"
        );
        let r = read(Some(&serde_json::json!([{"merge": {}}])), "ops").unwrap_err();
        assert_eq!((r.code, r.path.as_str()), ("bad_doc", "ops/0"));
    }
}
