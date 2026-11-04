//! The bound each output's steps' references give (canvas primitives: Compile, validate and
//! cache: "each output lands within the bound its steps' references give"). A step's reference
//! is its meaning as the f64 interpreter runs it, and WGSL and Metal give each step its accuracy
//! in f32: add, sub and mul correctly rounded, a divide within 2.5 ulp, each transcendental
//! within its fast-math error, subnormals flushed, a filter's weights at 8 bits, a half target
//! rounded. Every lane is carried through the graph as an enclosure: an interval holding every
//! value the reference and the GPU can give it. An integer or bool step on exact inputs stays
//! exact, a float step widens by its accuracy, and a compare, a floor or a select whose inputs
//! straddle an edge takes both sides, so the bound is the steps' own and never a tolerance picked
//! for the graph. The GPU's output must land inside it, and so must the interpreter's.

use std::collections::BTreeMap;

use deep_canvas::ops;
use deep_canvas_effects::check::{acc_key, key, Checked};
use deep_canvas_effects::graph::{Arg, Body, Count, From, Sc, Step, Ty};
use deep_canvas_effects::interp::{hash1, typed_literal, Env, Image, Val};
use serde_json::{Map, Value};

/// One f32 ulp at 1.
const U: f64 = 1.0 / 8_388_608.0;
/// What a flush of subnormals to zero can move a value by, twice over.
const TINY: f64 = 2.4e-38;
/// Past this a float may be infinite on the GPU.
const BIG: f64 = 3.0e38;
/// Sine's and cosine's absolute error on [−π, π] under fast math (2^-13), doubled, and its growth
/// per unit of argument past it.
const TRIG: f64 = 1.0 / 4096.0;
const TRIG_PER: f64 = 1.0 / 524_288.0;
/// The filter's position precision: 8 bits of a texel, doubled.
const FILTER: f64 = 1.0 / 128.0;

/// An enclosure: every value a lane can take on the reference and on the GPU.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct R {
    pub lo: f64,
    pub hi: f64,
}

impl R {
    /// Anything, NaN and the infinities among it.
    pub const TOP: R = R {
        lo: f64::NEG_INFINITY,
        hi: f64::INFINITY,
    };

    pub fn x(v: f64) -> R {
        if v.is_nan() {
            R::TOP
        } else {
            R { lo: v, hi: v }
        }
    }

    pub fn new(a: f64, b: f64) -> R {
        if a.is_nan() || b.is_nan() {
            R::TOP
        } else {
            R {
                lo: a.min(b),
                hi: a.max(b),
            }
        }
    }

    pub fn hull(self, o: R) -> R {
        R {
            lo: self.lo.min(o.lo),
            hi: self.hi.max(o.hi),
        }
    }

    pub fn exact(self) -> Option<f64> {
        (self.lo == self.hi).then_some(self.lo)
    }

    pub fn mag(self) -> f64 {
        self.lo.abs().max(self.hi.abs())
    }

    pub fn top(self) -> bool {
        !(self.lo.is_finite() && self.hi.is_finite())
    }

    /// Whether `v` lands inside: anything (NaN too) lands inside an unbounded enclosure.
    pub fn holds(self, v: f64) -> bool {
        self.top() || (v >= self.lo && v <= self.hi)
    }

    fn widen(self, d: f64) -> R {
        if self.top() || self.mag() > BIG || d.is_nan() {
            R::TOP
        } else {
            R {
                lo: self.lo - d,
                hi: self.hi + d,
            }
        }
    }

    fn contains(self, v: f64) -> bool {
        v >= self.lo && v <= self.hi
    }
}

/// A float step's result widened by its accuracy: `ulps` of the larger of its own and `mag`, an
/// absolute `abs`, and a flushed subnormal.
fn fw(r: R, ulps: f64, mag: f64, abs: f64) -> R {
    r.widen(ulps * U * mag.max(r.mag()) + abs + TINY)
}

fn corners(a: R, b: R, f: impl Fn(f64, f64) -> f64) -> R {
    let v = [f(a.lo, b.lo), f(a.lo, b.hi), f(a.hi, b.lo), f(a.hi, b.hi)];
    if v.iter().any(|x| x.is_nan()) {
        return R::TOP;
    }
    R {
        lo: v.iter().copied().fold(f64::INFINITY, f64::min),
        hi: v.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    }
}

fn radd(a: R, b: R) -> R {
    R::new(a.lo + b.lo, a.hi + b.hi)
}
fn rsub(a: R, b: R) -> R {
    R::new(a.lo - b.hi, a.hi - b.lo)
}
fn rmul(a: R, b: R) -> R {
    if a.top() || b.top() {
        return R::TOP;
    }
    corners(a, b, |x, y| x * y)
}
fn rdiv(a: R, b: R) -> R {
    if a.top() || b.top() || b.contains(0.0) {
        return R::TOP;
    }
    corners(a, b, |x, y| x / y)
}
fn rsq(a: R) -> R {
    if a.contains(0.0) {
        R::new(0.0, a.mag() * a.mag())
    } else {
        R::new(a.lo * a.lo, a.hi * a.hi)
    }
}
/// A monotone non-decreasing function's image.
fn up(a: R, f: impl Fn(f64) -> f64) -> R {
    if a.top() {
        return R::TOP;
    }
    R::new(f(a.lo), f(a.hi))
}

/// Every value a scalar type holds.
pub fn full(sc: Sc) -> R {
    match sc {
        Sc::U32 => R::new(0.0, 4_294_967_295.0),
        Sc::I32 => R::new(-2_147_483_648.0, 2_147_483_647.0),
        Sc::Bool => R::new(0.0, 1.0),
        Sc::F32 => R::TOP,
    }
}

fn fits(sc: Sc, r: R) -> R {
    let f = full(sc);
    if sc == Sc::F32 || (r.lo >= f.lo && r.hi <= f.hi) {
        r
    } else {
        f
    }
}

/// The interpreter's integer wrap.
fn wrap(sc: Sc, v: f64) -> f64 {
    match sc {
        Sc::U32 => f64::from(v.rem_euclid(4_294_967_296.0) as u32),
        Sc::I32 => f64::from(v.rem_euclid(4_294_967_296.0) as u32 as i32),
        Sc::Bool => f64::from(u8::from(v != 0.0)),
        Sc::F32 => v,
    }
}

fn saturate(sc: Sc, v: f64) -> f64 {
    let t = v.trunc();
    match sc {
        Sc::U32 => t.clamp(0.0, 4_294_967_295.0),
        Sc::I32 => t.clamp(-2_147_483_648.0, 2_147_483_647.0),
        _ => v,
    }
}

/// `x != 0` over an enclosure.
fn nonzero(r: R) -> R {
    if r.exact() == Some(0.0) {
        R::x(0.0)
    } else if r.contains(0.0) || r.top() {
        R::new(0.0, 1.0)
    } else {
        R::x(1.0)
    }
}

/// A lane of `from` as `to`, as the interpreter's conversion runs it (a float to an integer
/// saturating toward zero, an integer to an integer wrapping) and the GPU's (an integer past
/// 2^24 rounded to f32).
fn conv(from: Sc, to: Sc, r: R) -> R {
    if to == Sc::Bool {
        return nonzero(r);
    }
    if from == Sc::F32 && to != Sc::F32 {
        if r.top() {
            return full(to);
        }
        return R::new(saturate(to, r.lo), saturate(to, r.hi));
    }
    match to {
        Sc::F32 if from != Sc::F32 && r.mag() > 16_777_216.0 => r.widen(r.mag() * U),
        Sc::F32 => r,
        _ => match r.exact() {
            Some(x) => R::x(wrap(to, x)),
            None => fits(to, r),
        },
    }
}

/// Up to four lanes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct L {
    pub v: [R; 4],
    pub n: usize,
}

impl L {
    pub fn one(r: R) -> L {
        L {
            v: [r, R::x(0.0), R::x(0.0), R::x(0.0)],
            n: 1,
        }
    }

    pub fn of(rs: &[R]) -> L {
        let mut v = [R::x(0.0); 4];
        let n = rs.len().clamp(1, 4);
        v[..rs.len().min(4)].copy_from_slice(&rs[..rs.len().min(4)]);
        L { v, n }
    }

    pub fn lanes(&self) -> &[R] {
        &self.v[..self.n]
    }

    fn map(self, f: impl Fn(R) -> R) -> L {
        let mut o = self;
        for x in &mut o.v[..o.n] {
            *x = f(*x);
        }
        o
    }

    fn zip(self, b: L, f: impl Fn(R, R) -> R) -> L {
        let mut o = self;
        for i in 0..o.n {
            o.v[i] = f(self.v[i], b.v[i]);
        }
        o
    }

    fn hull(self, b: L) -> L {
        self.zip(b, R::hull)
    }
}

/// A value while a graph runs: lanes, a matrix (column-major), an array or an image or a
/// storage buffer in the run's tables.
#[derive(Clone, Copy, Debug)]
pub enum W {
    N(Sc, L),
    M(u8, [R; 16]),
    A(usize),
    T(usize),
}

impl W {
    pub fn l(&self) -> L {
        match self {
            W::N(_, l) => *l,
            W::M(_, m) => L::of(&m[..4]),
            _ => L::one(R::x(0.0)),
        }
    }

    pub fn sc(&self) -> Sc {
        match self {
            W::N(sc, _) => *sc,
            _ => Sc::F32,
        }
    }

    fn hull(self, o: W) -> W {
        match (self, o) {
            (W::N(sc, a), W::N(_, b)) => W::N(sc, a.hull(b)),
            (W::M(n, a), W::M(_, b)) => {
                let mut m = a;
                for (x, y) in m.iter_mut().zip(b) {
                    *x = x.hull(y);
                }
                W::M(n, m)
            }
            (a, _) => a,
        }
    }
}

fn sc_of(t: &Ty) -> (Sc, usize) {
    match t {
        Ty::V(sc, n) => (*sc, *n as usize),
        Ty::Int => (Sc::I32, 1),
        _ => (Sc::F32, 1),
    }
}

/// `w` as `n` lanes of `sc`, a scalar splatting, as the interpreter's `as_l`.
pub fn as_l(w: W, sc: Sc, n: usize) -> L {
    let from = w.sc();
    let l = w.l();
    let mut o = L {
        v: [R::x(0.0); 4],
        n: n.max(1),
    };
    for i in 0..o.n {
        let x = if l.n == 1 { l.v[0] } else { l.v[i.min(3)] };
        o.v[i] = conv(from, sc, x);
    }
    o
}

fn common(a: &Ty, b: &Ty) -> (Sc, usize) {
    let (sa, na) = sc_of(a);
    let (sb, nb) = sc_of(b);
    let sc = match (a, b) {
        (Ty::Int, _) => sb,
        (_, Ty::Int) => sa,
        _ if sa == sb => sa,
        _ => Sc::F32,
    };
    (sc, na.max(nb))
}

fn num(x: &Value) -> f64 {
    x.as_f64()
        .or_else(|| x.as_bool().map(|b| f64::from(u8::from(b))))
        .unwrap_or(0.0)
}

/// An inline literal: an f32 one as the interpreter reads it (in f64) and as the GPU holds it.
fn literal(v: &Value) -> (Sc, L) {
    let f = |x: f64| R::new(x, f64::from(x as f32));
    match v {
        Value::Bool(b) => (Sc::Bool, L::one(R::x(f64::from(u8::from(*b))))),
        Value::Number(n) if n.is_i64() || n.is_u64() => (Sc::I32, L::one(R::x(num(v)))),
        Value::Number(_) => (Sc::F32, L::one(f(num(v)))),
        Value::Array(a) => {
            let lanes: Vec<R> = a.iter().map(|x| f(num(x))).collect();
            (Sc::F32, L::of(&lanes))
        }
        _ => (Sc::F32, L::one(R::x(0.0))),
    }
}

fn exact_val(v: &Val, arrays: &mut Vec<(Sc, Vec<[R; 4]>)>) -> W {
    match v {
        Val::N(sc, l) => W::N(*sc, L::of(&l.iter().map(|x| R::x(*x)).collect::<Vec<_>>())),
        Val::M(n, m) => {
            let mut a = [R::x(0.0); 16];
            for (i, x) in m.iter().take(16).enumerate() {
                a[i] = R::x(*x);
            }
            W::M(*n, a)
        }
        Val::A(sc, items) => {
            arrays.push((
                *sc,
                items
                    .iter()
                    .map(|e| {
                        let mut l = [R::x(0.0); 4];
                        for (i, x) in e.iter().take(4).enumerate() {
                            l[i] = R::x(*x);
                        }
                        l
                    })
                    .collect(),
            ));
            W::A(arrays.len() - 1)
        }
        Val::T(_) => W::N(Sc::F32, L::one(R::x(0.0))),
    }
}

fn round_even(x: f64) -> f64 {
    if (x - x.trunc()).abs() == 0.5 {
        2.0 * (x / 2.0).round()
    } else {
        x.round()
    }
}

/// Whether `[lo, hi]` holds a point `p + k × period`.
fn hits(r: R, p: f64, period: f64) -> bool {
    let k = ((r.lo - p) / period).ceil();
    p + k * period <= r.hi
}

fn sin_r(x: R) -> R {
    if x.top() {
        return R::TOP;
    }
    let err = TRIG + x.mag() * TRIG_PER;
    let half = std::f64::consts::FRAC_PI_2;
    let mut r = if x.hi - x.lo >= ops::TAU || x.mag() > 4096.0 {
        R::new(-1.0, 1.0)
    } else {
        let mut r = R::new(ops::sin(x.lo), ops::sin(x.hi));
        if hits(x, half, ops::TAU) {
            r.hi = 1.0;
        }
        if hits(x, -half, ops::TAU) {
            r.lo = -1.0;
        }
        r
    };
    r.lo -= err;
    r.hi += err;
    r
}

fn cos_r(x: R) -> R {
    if x.top() {
        return R::TOP;
    }
    let err = TRIG + x.mag() * TRIG_PER;
    let mut r = if x.hi - x.lo >= ops::TAU || x.mag() > 4096.0 {
        R::new(-1.0, 1.0)
    } else {
        let mut r = R::new(ops::cos(x.lo), ops::cos(x.hi));
        if hits(x, 0.0, ops::TAU) {
            r.hi = 1.0;
        }
        if hits(x, ops::PI, ops::TAU) {
            r.lo = -1.0;
        }
        r
    };
    r.lo -= err;
    r.hi += err;
    r
}

fn exp2_r(x: R) -> R {
    let r = up(x, |v| ops::pow(2.0, v));
    fw(r, 4.0 + 2.0 * x.mag(), 0.0, 0.0)
}

fn log2_r(x: R) -> R {
    if x.top() || x.lo <= 0.0 {
        return R::TOP;
    }
    fw(up(x, ops::log2), 8.0, 0.0, 1.0 / 1_048_576.0)
}

/// An int step on two lanes: exact on exact inputs as the interpreter runs it, else every value
/// of its type, or `range` when the caller knows one.
fn int2(sc: Sc, a: R, b: R, f: impl Fn(f64, f64) -> f64, range: Option<R>) -> R {
    match (a.exact(), b.exact()) {
        (Some(x), Some(y)) => R::x(wrap(sc, f(x, y))),
        _ => range.map_or(full(sc), |r| fits(sc, r)),
    }
}

fn bits(sc: Sc, a: f64, b: f64, f: impl Fn(u32, u32) -> u32) -> f64 {
    match sc {
        Sc::Bool => f64::from(f(u32::from(a != 0.0), u32::from(b != 0.0))),
        _ => f64::from(f(a as i64 as u32, b as i64 as u32)),
    }
}

fn bool_and(a: R, b: R) -> R {
    if a.exact() == Some(0.0) || b.exact() == Some(0.0) {
        R::x(0.0)
    } else if a.exact() == Some(1.0) && b.exact() == Some(1.0) {
        R::x(1.0)
    } else {
        R::new(0.0, 1.0)
    }
}

fn bool_or(a: R, b: R) -> R {
    if a.exact() == Some(1.0) || b.exact() == Some(1.0) {
        R::x(1.0)
    } else if a.exact() == Some(0.0) && b.exact() == Some(0.0) {
        R::x(0.0)
    } else {
        R::new(0.0, 1.0)
    }
}

fn cmp(a: R, b: R, name: &str) -> R {
    let (t, f) = (R::x(1.0), R::x(0.0));
    let either = R::new(0.0, 1.0);
    if a.top() || b.top() {
        return either;
    }
    let eq_known = match (a.exact(), b.exact()) {
        (Some(x), Some(y)) => Some(x == y),
        _ if a.hi < b.lo || b.hi < a.lo => Some(false),
        _ => None,
    };
    let lt = if a.hi < b.lo {
        Some(true)
    } else if a.lo >= b.hi {
        Some(false)
    } else {
        None
    };
    let gt = if a.lo > b.hi {
        Some(true)
    } else if a.hi <= b.lo {
        Some(false)
    } else {
        None
    };
    let known = match name {
        "eq" => eq_known,
        "ne" => eq_known.map(|e| !e),
        "lt" => lt,
        "ge" => lt.map(|x| !x),
        "gt" => gt,
        _ => gt.map(|x| !x),
    };
    match known {
        Some(true) => t,
        Some(false) => f,
        None => either,
    }
}

/// A context-free step over its arguments' enclosures: `ty` is its checked type, `args` each
/// port's value and type. `None` for a step that reads the frame, a texture, storage or an
/// array, which the evaluator answers itself.
pub fn apply(
    name: &str,
    fields: &Map<String, Value>,
    ty: &Ty,
    args: &[(&str, W, Ty)],
) -> Option<W> {
    let (sc, n) = sc_of(ty);
    let get = |port: &str| -> (W, Ty) {
        args.iter()
            .find(|(p, _, _)| *p == port)
            .map(|(_, w, t)| (*w, t.clone()))
            .unwrap_or((W::N(Sc::F32, L::one(R::x(0.0))), Ty::F32))
    };
    let has = |port: &str| args.iter().any(|(p, _, _)| *p == port);
    let g = |port: &str| get(port).0;
    let gt = |port: &str| get(port).1;
    let l = |port: &str| as_l(g(port), sc, n);
    let fl = |port: &str| {
        let v = g(port);
        as_l(v, Sc::F32, v.l().n.max(n))
    };
    let float = sc == Sc::F32;
    // A float unary step: its exact image, then its accuracy.
    let f1 = |f: &dyn Fn(R) -> R| W::N(sc, l("x").map(f));
    let i1 = |f: &dyn Fn(f64) -> f64| {
        W::N(
            sc,
            l("x").map(|x| match x.exact() {
                Some(v) => R::x(wrap(sc, f(v))),
                None => full(sc),
            }),
        )
    };
    let one = |sc, r| W::N(sc, L::one(r));
    let v = match name {
        "convert" => W::N(sc, as_l(g("x"), sc, n)),
        "compose" => {
            let mut lanes = Vec::with_capacity(4);
            for port in ["x", "y", "z", "w"] {
                if has(port) {
                    let v = g(port);
                    lanes.extend_from_slice(as_l(v, sc, v.l().n).lanes());
                }
            }
            W::N(sc, L::of(&lanes))
        }
        "split" => {
            let x = g("x").l();
            let pick = fields.get("pick").and_then(Value::as_str).unwrap_or("x");
            let lanes: Vec<R> = pick
                .chars()
                .map(|c| {
                    let i = "xyzw".find(c).or_else(|| "rgba".find(c)).unwrap_or(0);
                    if i < x.n {
                        x.v[i]
                    } else {
                        R::x(0.0)
                    }
                })
                .collect();
            W::N(sc, as_l(W::N(sc, L::of(&lanes)), sc, n))
        }
        "add" | "sub" => {
            let (a, b) = (l("a"), l("b"));
            let f = if name == "add" { radd } else { rsub };
            W::N(
                sc,
                a.zip(b, |x, y| {
                    if float {
                        fw(f(x, y), 2.0, x.mag().max(y.mag()), 0.0)
                    } else {
                        let r = f(x, y);
                        int2(
                            sc,
                            x,
                            y,
                            |p, q| if name == "add" { p + q } else { p - q },
                            Some(r),
                        )
                    }
                }),
            )
        }
        "mul" => match (g("a"), g("b")) {
            (W::M(m, a), W::N(_, v)) => {
                let m = m as usize;
                let v = if v.n == 1 {
                    L {
                        v: [v.v[0]; 4],
                        n: m,
                    }
                } else {
                    v
                };
                let mut o = L {
                    v: [R::x(0.0); 4],
                    n: m,
                };
                for r in 0..m {
                    o.v[r] = dot_r((0..m).map(|c| (a[c * m + r], v.v[c])));
                }
                W::N(Sc::F32, o)
            }
            (W::M(m, a), W::M(_, b)) => {
                let m = m as usize;
                let mut o = [R::x(0.0); 16];
                for c in 0..m {
                    for r in 0..m {
                        o[c * m + r] = dot_r((0..m).map(|k| (a[k * m + r], b[c * m + k])));
                    }
                }
                W::M(m as u8, o)
            }
            _ => {
                let (a, b) = (l("a"), l("b"));
                W::N(
                    sc,
                    a.zip(b, |x, y| {
                        if float {
                            fw(rmul(x, y), 2.0, 0.0, 0.0)
                        } else {
                            int2(
                                sc,
                                x,
                                y,
                                |p, q| f64::from((p as i64 as u32).wrapping_mul(q as i64 as u32)),
                                Some(rmul(x, y)),
                            )
                        }
                    }),
                )
            }
        },
        "div" => {
            let (a, b) = (l("a"), l("b"));
            W::N(
                sc,
                a.zip(b, |x, y| {
                    if float {
                        fw(rdiv(x, y), 4.0, 0.0, 0.0)
                    } else {
                        int2(
                            sc,
                            x,
                            y,
                            |p, q| match sc {
                                Sc::U32 if q == 0.0 => p,
                                Sc::I32 if q == 0.0 || (p == -2_147_483_648.0 && q == -1.0) => p,
                                _ => (p / q).trunc(),
                            },
                            None,
                        )
                    }
                }),
            )
        }
        "rem" | "mod" => {
            let (a, b) = (l("a"), l("b"));
            W::N(
                sc,
                a.zip(b, |x, y| {
                    if float {
                        // a − b × q with q every whole quotient the GPU's divide can round to.
                        let qd = fw(rdiv(x, y), 4.0, 0.0, 0.0);
                        let q = if name == "rem" {
                            up(qd, f64::trunc)
                        } else {
                            up(qd, f64::floor)
                        };
                        let prod = rmul(y, q);
                        fw(rsub(x, prod), 4.0, x.mag().max(prod.mag()), 0.0)
                    } else {
                        int2(
                            sc,
                            x,
                            y,
                            |p, q| {
                                if name == "mod" {
                                    p - q * (p / q).floor()
                                } else if q == 0.0
                                    || (sc == Sc::I32 && p == -2_147_483_648.0 && q == -1.0)
                                {
                                    0.0
                                } else {
                                    p - q * (p / q).trunc()
                                }
                            },
                            None,
                        )
                    }
                }),
            )
        }
        "min" | "max" => {
            let (a, b) = (l("a"), l("b"));
            let mn = name == "min";
            W::N(
                sc,
                a.zip(b, |x, y| {
                    let r = if mn {
                        R::new(x.lo.min(y.lo), x.hi.min(y.hi))
                    } else {
                        R::new(x.lo.max(y.lo), x.hi.max(y.hi))
                    };
                    if float {
                        r.widen(TINY)
                    } else {
                        r
                    }
                }),
            )
        }
        "pow" => {
            let (a, b) = (l("a"), l("b"));
            W::N(
                sc,
                a.zip(b, |x, y| {
                    if x.top() || y.top() || x.lo <= 0.0 {
                        return R::TOP;
                    }
                    let z = rmul(y, up(x, ops::log2));
                    let r = up(z, |v| ops::pow(2.0, v));
                    // log2's error by |y|, then exp2's.
                    let dz = y.mag() * (1.0 / 1_048_576.0 + 8.0 * U * up(x, ops::log2).mag())
                        + 2.0 * U * z.mag();
                    fw(r, 4.0 + 2.0 * z.mag() + 0.7 * dz / U, 0.0, 0.0)
                }),
            )
        }
        "atan2" => {
            let (y, x) = (fl("y"), fl("x"));
            W::N(
                Sc::F32,
                y.zip(x, |yy, xx| {
                    if yy.top() || xx.top() || !(xx.lo > 0.0 || yy.lo > 0.0 || yy.hi < 0.0) {
                        return R::new(-ops::PI, ops::PI).widen(1e-6);
                    }
                    fw(corners(yy, xx, ops::atan2), 16.0, 0.0, 1.0 / 4096.0)
                }),
            )
        }
        "neg" => {
            if float {
                f1(&|x| R::new(-x.hi, -x.lo))
            } else {
                i1(&|x| -x)
            }
        }
        "abs" => {
            if float {
                f1(&|x| {
                    if x.contains(0.0) {
                        R::new(0.0, x.mag())
                    } else {
                        R::new(x.lo.abs(), x.hi.abs())
                    }
                })
            } else {
                i1(&f64::abs)
            }
        }
        "sign" => W::N(
            sc,
            l("x").map(|x| {
                up(x, |v| {
                    if v > 0.0 {
                        1.0
                    } else if v < 0.0 {
                        -1.0
                    } else {
                        0.0
                    }
                })
            }),
        ),
        "floor" => W::N(sc, l("x").map(|x| up(x, f64::floor))),
        "ceil" => W::N(sc, l("x").map(|x| up(x, f64::ceil))),
        "round" => W::N(sc, l("x").map(|x| up(x, round_even))),
        "trunc" => W::N(sc, l("x").map(|x| up(x, f64::trunc))),
        "fract" => f1(&|x| {
            if x.top() {
                R::TOP
            } else if x.lo.floor() == x.hi.floor() {
                fw(
                    R::new(x.lo - x.lo.floor(), x.hi - x.lo.floor()),
                    2.0,
                    1.0,
                    0.0,
                )
            } else {
                R::new(0.0, 1.0)
            }
        }),
        "sqrt" => f1(&|x| {
            // Only a flushed or rounded zero sits in [−1e-30, 0): a GPU value below it may be NaN.
            if x.top() || x.lo < -1e-30 {
                R::TOP
            } else {
                fw(
                    up(R::new(x.lo.max(0.0), x.hi.max(0.0)), ops::sqrt),
                    4.0,
                    0.0,
                    0.0,
                )
            }
        }),
        "inverse_sqrt" => f1(&|x| {
            if x.top() || x.lo <= 0.0 {
                R::TOP
            } else {
                fw(
                    R::new(1.0 / ops::sqrt(x.hi), 1.0 / ops::sqrt(x.lo)),
                    4.0,
                    0.0,
                    0.0,
                )
            }
        }),
        "exp" => f1(&|x| exp2_r(rmul(x, R::x(std::f64::consts::LOG2_E)).widen(x.mag() * U))),
        "exp2" => f1(&exp2_r),
        "log" => f1(&|x| {
            let r = log2_r(x);
            fw(rmul(r, R::x(std::f64::consts::LN_2)), 2.0, 0.0, 0.0)
        }),
        "log2" => f1(&log2_r),
        "sin" => f1(&sin_r),
        "cos" => f1(&cos_r),
        // Fast math's tangent is its sine over its cosine.
        "tan" => f1(&|x| fw(rdiv(sin_r(x), cos_r(x)), 4.0, 0.0, 0.0)),
        "asin" | "acos" => f1(&|x| {
            if x.top() || x.lo < -1.0 - 1e-30 || x.hi > 1.0 + 1e-30 {
                return R::TOP;
            }
            let x = R::new(x.lo.max(-1.0), x.hi.min(1.0));
            let r = if name == "asin" {
                up(x, ops::asin)
            } else {
                R::new(ops::acos(x.hi), ops::acos(x.lo))
            };
            fw(r, 16.0, 0.0, 1.0 / 4096.0)
        }),
        "atan" => f1(&|x| fw(up(x, ops::atan), 16.0, 0.0, 1.0 / 4096.0)),
        "normalize" => {
            let x = l("x");
            let len = length_r(x.lanes());
            if len.lo <= 0.0 {
                W::N(Sc::F32, x.map(|_| R::TOP))
            } else {
                W::N(
                    Sc::F32,
                    x.map(|c| {
                        let q = rdiv(c, len);
                        let q = R::new(q.lo.max(-1.0), q.hi.min(1.0));
                        fw(q, 16.0, 1.0, 0.0)
                    }),
                )
            }
        }
        "length" => one(Sc::F32, length_r(fl("x").lanes())),
        "distance" => {
            let d = fl("a").zip(fl("b"), |x, y| {
                fw(rsub(x, y), 2.0, x.mag().max(y.mag()), 0.0)
            });
            one(Sc::F32, length_r(d.lanes()))
        }
        "dot" => {
            let (csc, m) = common(&gt("a"), &gt("b"));
            let (a, b) = (as_l(g("a"), csc, m), as_l(g("b"), csc, m));
            if csc == Sc::F32 {
                one(
                    sc,
                    dot_r(a.lanes().iter().copied().zip(b.lanes().iter().copied())),
                )
            } else {
                let exact: Option<f64> = a
                    .lanes()
                    .iter()
                    .zip(b.lanes())
                    .map(|(x, y)| Some(x.exact()? * y.exact()?))
                    .sum();
                one(sc, exact.map_or(full(sc), |s| R::x(wrap(sc, s))))
            }
        }
        "cross" => {
            let (a, b) = (fl("a").v, fl("b").v);
            let t = |i: usize, j: usize| {
                let (p, q) = (rmul(a[i], b[j]), rmul(a[j], b[i]));
                fw(rsub(p, q), 4.0, p.mag().max(q.mag()), 0.0)
            };
            W::N(Sc::F32, L::of(&[t(1, 2), t(2, 0), t(0, 1)]))
        }
        "transpose" => match g("x") {
            W::M(m, a) => {
                let m2 = m as usize;
                let mut o = [R::x(0.0); 16];
                for c in 0..m2 {
                    for r in 0..m2 {
                        o[r * m2 + c] = a[c * m2 + r];
                    }
                }
                W::M(m, o)
            }
            other => other,
        },
        "clamp" => {
            let (x, lo, hi) = (l("x"), l("lo"), l("hi"));
            let mut o = x;
            for i in 0..o.n {
                let (x, a, b) = (x.v[i], lo.v[i], hi.v[i]);
                let r = R::new(x.lo.max(a.lo).min(b.lo), x.hi.max(a.hi).min(b.hi));
                o.v[i] = if float { r.widen(TINY) } else { r };
            }
            W::N(sc, o)
        }
        "mix" => {
            let (a, b, t) = (l("a"), l("b"), l("t"));
            let mut o = a;
            for i in 0..o.n {
                let (a, b, t) = (a.v[i], b.v[i], t.v[i]);
                // a × (1 − t) + b × t, and the GPU's a + (b − a) × t: the same value exactly.
                let r1 = radd(rmul(a, rsub(R::x(1.0), t)), rmul(b, t));
                let r2 = radd(a, rmul(rsub(b, a), t));
                let r = R::new(r1.lo.max(r2.lo), r1.hi.min(r2.hi));
                let r = if r.lo > r.hi { r1.hull(r2) } else { r };
                o.v[i] = fw(r, 6.0, (a.mag() + b.mag()) * (1.0 + t.mag()), 0.0);
            }
            W::N(sc, o)
        }
        "smoothstep" => {
            let (lo, hi, x) = (l("lo"), l("hi"), l("x"));
            let mut o = x;
            for i in 0..o.n {
                let num = fw(
                    rsub(x.v[i], lo.v[i]),
                    2.0,
                    x.v[i].mag().max(lo.v[i].mag()),
                    0.0,
                );
                let den = fw(
                    rsub(hi.v[i], lo.v[i]),
                    2.0,
                    hi.v[i].mag().max(lo.v[i].mag()),
                    0.0,
                );
                let t = fw(rdiv(num, den), 4.0, 0.0, 0.0);
                let t = if t.top() {
                    R::new(0.0, 1.0)
                } else {
                    R::new(t.lo.clamp(0.0, 1.0), t.hi.clamp(0.0, 1.0))
                };
                let p = |t: f64| t * t * (3.0 - 2.0 * t);
                o.v[i] = R::new(p(t.lo), p(t.hi)).widen(16.0 * U + TINY);
            }
            W::N(sc, o)
        }
        "and" | "or" | "xor" => {
            let (a, b) = (l("a"), l("b"));
            W::N(
                sc,
                a.zip(b, |x, y| match (sc, name) {
                    (Sc::Bool, "and") => bool_and(x, y),
                    (Sc::Bool, "or") => bool_or(x, y),
                    _ => {
                        let r = int2(
                            sc,
                            x,
                            y,
                            |p, q| {
                                bits(sc, p, q, |u, v| match name {
                                    "and" => u & v,
                                    "or" => u | v,
                                    _ => u ^ v,
                                })
                            },
                            None,
                        );
                        match (name, sc, x.exact(), y.exact()) {
                            ("and", Sc::U32, _, Some(m)) | ("and", Sc::U32, Some(m), _)
                                if r.exact().is_none() =>
                            {
                                R::new(0.0, m)
                            }
                            _ => r,
                        }
                    }
                }),
            )
        }
        "not" => W::N(
            sc,
            l("x").map(|x| match (sc, x.exact()) {
                (Sc::Bool, Some(v)) => R::x(f64::from(u8::from(v == 0.0))),
                (Sc::Bool, None) => R::new(0.0, 1.0),
                (_, Some(v)) => R::x(wrap(sc, f64::from(!(v as i64 as u32)))),
                (_, None) => full(sc),
            }),
        ),
        "shl" | "shr" => {
            let (a, b) = (l("a"), as_l(g("b"), Sc::U32, n));
            W::N(
                sc,
                a.zip(b, |x, y| {
                    let f = |p: f64, q: f64| {
                        let sh = (q as u32) & 31;
                        let bx = p as i64 as u32;
                        let r = if name == "shl" {
                            bx << sh
                        } else if sc == Sc::I32 {
                            ((bx as i32) >> sh) as u32
                        } else {
                            bx >> sh
                        };
                        wrap(sc, f64::from(r))
                    };
                    match (x.exact(), y.exact()) {
                        (Some(p), Some(q)) => R::x(f(p, q)),
                        // A right shift of u32s by a known count is monotone.
                        (None, Some(q)) if name == "shr" && sc == Sc::U32 => {
                            R::new(f(x.lo, q), f(x.hi, q))
                        }
                        _ => full(sc),
                    }
                }),
            )
        }
        "eq" | "ne" | "lt" | "le" | "gt" | "ge" => {
            let (csc, _) = common(&gt("a"), &gt("b"));
            let (a, b) = (as_l(g("a"), csc, n), as_l(g("b"), csc, n));
            W::N(Sc::Bool, a.zip(b, |x, y| cmp(x, y, name)))
        }
        "all" | "any" => {
            let x = g("x").l();
            let lanes = x.lanes();
            let r = if name == "all" {
                lanes.iter().copied().fold(R::x(1.0), bool_and)
            } else {
                lanes.iter().copied().fold(R::x(0.0), bool_or)
            };
            one(Sc::Bool, r)
        }
        "select" => {
            let (f, t) = (l("f"), l("t"));
            let c = g("cond").l();
            let mut o = f;
            for i in 0..o.n {
                let ci = if c.n == 1 { c.v[0] } else { c.v[i] };
                o.v[i] = match ci.exact() {
                    Some(v) if v != 0.0 => t.v[i],
                    Some(_) => f.v[i],
                    None => f.v[i].hull(t.v[i]),
                };
            }
            W::N(sc, o)
        }
        "hash" => {
            let mut h = Some(0u32);
            let mut first = true;
            for port in ["a", "b", "c", "d"] {
                if has(port) {
                    let x = as_l(g(port), Sc::U32, 1).v[0].exact();
                    h = match (h, x) {
                        (Some(h), Some(x)) => Some(if first {
                            hash1(x as u32)
                        } else {
                            hash1(h ^ x as u32)
                        }),
                        _ => None,
                    };
                    first = false;
                }
            }
            one(Sc::U32, h.map_or(full(Sc::U32), |h| R::x(f64::from(h))))
        }
        "rand" => {
            let k = as_l(g("key"), Sc::U32, 1).v[0];
            one(
                Sc::F32,
                match k.exact() {
                    // The interpreter's constant and the GPU's (2^-24 as f32) both.
                    Some(k) => {
                        let m = f64::from(hash1(k as u32) >> 8);
                        R::new(m * 5.960_464_5e-8, m * f64::from(5.960_464_5e-8_f32))
                    }
                    None => R::new(0.0, 1.0),
                },
            )
        }
        "luminance" => {
            let c = as_l(g("rgb"), Sc::F32, 3).v;
            one(
                Sc::F32,
                dot_r(
                    [
                        (c[0], R::x(0.2126)),
                        (c[1], R::x(0.7152)),
                        (c[2], R::x(0.0722)),
                    ]
                    .into_iter(),
                )
                .widen(4.0 * U * (c[0].mag() + c[1].mag() + c[2].mag())),
            )
        }
        "bitcast" => {
            let from = sc_of(&gt("x")).0;
            let xl = g("x").l();
            let xl = if xl.n == 1 && n > 1 {
                L { v: [xl.v[0]; 4], n }
            } else {
                xl
            };
            W::N(
                sc,
                xl.map(|v| {
                    let Some(v) = v.exact() else {
                        return full(sc);
                    };
                    let b = match from {
                        Sc::F32 => (v as f32).to_bits(),
                        _ => v as i64 as u32,
                    };
                    match sc {
                        Sc::F32 => {
                            let f = f32::from_bits(b);
                            if !f.is_finite() {
                                R::TOP
                            } else if f.is_subnormal() {
                                R::new(0.0, f64::from(f))
                            } else {
                                R::x(f64::from(f))
                            }
                        }
                        Sc::I32 => R::x(f64::from(b as i32)),
                        _ => R::x(f64::from(b)),
                    }
                }),
            )
        }
        "count_ones" => i1(&|x| f64::from((x as i64 as u32).count_ones())),
        "first_leading_bit" => i1(&|x| {
            let b = x as i64 as u32;
            match sc {
                Sc::I32 if b == 0 || b == u32::MAX => -1.0,
                Sc::I32 if (b as i32) < 0 => f64::from(31 - (!b).leading_zeros()),
                _ if b == 0 => f64::from(u32::MAX),
                _ => f64::from(31 - b.leading_zeros()),
            }
        }),
        "first_trailing_bit" => i1(&|x| {
            let b = x as i64 as u32;
            match sc {
                _ if b != 0 => f64::from(b.trailing_zeros()),
                Sc::I32 => -1.0,
                _ => f64::from(u32::MAX),
            }
        }),
        _ => return None,
    };
    Some(v)
}

/// A sum of products in f32: each product and each partial sum rounded, in any order.
fn dot_r(pairs: impl Iterator<Item = (R, R)>) -> R {
    let mut sum = R::x(0.0);
    let mut mags = 0.0;
    let mut k = 0.0;
    for (a, b) in pairs {
        let p = rmul(a, b);
        mags += p.mag();
        sum = radd(sum, p);
        k += 1.0;
    }
    fw(sum, 2.0 * (k + 1.0), mags, 0.0)
}

fn length_r(lanes: &[R]) -> R {
    let mut s = R::x(0.0);
    for x in lanes {
        s = radd(s, rsq(*x));
    }
    let s = fw(s, 2.0 * (lanes.len() as f64 + 1.0), 0.0, 0.0);
    if s.top() {
        return R::TOP;
    }
    fw(
        R::new(ops::sqrt(s.lo.max(0.0)), ops::sqrt(s.hi.max(0.0))),
        8.0,
        0.0,
        0.0,
    )
}

/// The range of a texture's bilinear filter (clamped edges) over a box in texel space, channel
/// by channel: the filter is bilinear inside each cell, so its extremes over the box sit at the
/// box's corners and where texel centres' lines cross it.
fn filter_range(img: &Image, xs: R, ys: R) -> [R; 4] {
    let mut out = [R {
        lo: f64::INFINITY,
        hi: f64::NEG_INFINITY,
    }; 4];
    if xs.hi - xs.lo > 32.0 || ys.hi - ys.lo > 32.0 {
        // A wide box: every value is a convex mix of the texels it covers.
        let span = |r: R, n: u32| {
            let last = f64::from(n) - 1.0;
            (
                r.lo.floor().clamp(0.0, last) as usize,
                r.hi.ceil().clamp(0.0, last) as usize,
            )
        };
        let ((x0, x1), (y0, y1)) = (span(xs, img.w), span(ys, img.h));
        for y in y0..=y1 {
            for x in x0..=x1 {
                let px = img.px[y * img.w as usize + x];
                for i in 0..4 {
                    out[i] = out[i].hull(R::x(px[i]));
                }
            }
        }
        return out;
    }
    let breaks = |r: R, n: u32| -> Vec<f64> {
        let lo = r.lo.max(-1.0);
        let hi = r.hi.min(f64::from(n));
        let mut v = vec![lo, hi.max(lo)];
        let mut k = lo.ceil();
        while k < hi {
            v.push(k);
            k += 1.0;
        }
        v
    };
    let (bx, by) = (breaks(xs, img.w), breaks(ys, img.h));
    let at = |x: i64, y: i64| {
        let x = x.clamp(0, i64::from(img.w) - 1) as usize;
        let y = y.clamp(0, i64::from(img.h) - 1) as usize;
        img.px[y * img.w as usize + x]
    };
    for &x in &bx {
        for &y in &by {
            let (x0, y0) = (x.floor(), y.floor());
            let (fx, fy) = (x - x0, y - y0);
            let (x0, y0) = (x0 as i64, y0 as i64);
            let (a, b, c, d) = (
                at(x0, y0),
                at(x0 + 1, y0),
                at(x0, y0 + 1),
                at(x0 + 1, y0 + 1),
            );
            for i in 0..4 {
                let top = a[i] + (b[i] - a[i]) * fx;
                let bottom = c[i] + (d[i] - c[i]) * fx;
                let v = top + (bottom - top) * fy;
                out[i].lo = out[i].lo.min(v);
                out[i].hi = out[i].hi.max(v);
            }
        }
    }
    out
}

/// Where an argument comes from: a slot, or a literal's lanes.
#[derive(Clone, Copy, Debug)]
enum Src {
    Slot(usize),
    Lit(Sc, L),
}

struct P<'a> {
    s: &'a Step,
    name: &'a str,
    out: usize,
    ty: Ty,
    args: Vec<(&'a str, Src, Ty)>,
    body: Option<PBody<'a>>,
    when: Option<usize>,
}

struct PBody<'a> {
    count: Src,
    max: u32,
    accs: Vec<(usize, Ty, Src, usize, usize)>,
    index: usize,
    steps: Vec<P<'a>>,
    stop: Option<Src>,
}

struct Prog<'a> {
    c: &'a Checked,
    slots: BTreeMap<String, usize>,
    base: Vec<W>,
    arrays: Vec<(Sc, Vec<[R; 4]>)>,
    images: Vec<&'a Image>,
    storage: Vec<(String, Vec<R>)>,
    size: [u32; 2],
    env: &'a Env<'a>,
}

fn slot(slots: &mut BTreeMap<String, usize>, name: &str) -> usize {
    let n = slots.len();
    *slots.entry(name.to_string()).or_insert(n)
}

const ZERO: W = W::N(
    Sc::F32,
    L {
        v: [R { lo: 0.0, hi: 0.0 }; 4],
        n: 1,
    },
);

impl<'a> Prog<'a> {
    fn new(
        c: &'a Checked,
        env: &'a Env<'a>,
        size: [u32; 2],
        storage: &BTreeMap<String, Vec<f64>>,
    ) -> Result<(Prog<'a>, Vec<P<'a>>), String> {
        let mut p = Prog {
            c,
            slots: BTreeMap::new(),
            base: Vec::new(),
            arrays: Vec::new(),
            images: Vec::new(),
            storage: storage
                .iter()
                .map(|(k, v)| (k.clone(), v.iter().map(|x| R::x(*x)).collect()))
                .collect(),
            size,
            env,
        };
        for (name, out) in &c.op.storage {
            p.storage.retain(|(n, _)| n != name);
            p.storage
                .push((name.clone(), vec![R::x(0.0); out.count as usize]));
        }
        let mut base = BTreeMap::new();
        for (name, input) in &c.op.inputs {
            let s = slot(&mut p.slots, name);
            let v = match &input.from {
                From::Time => W::N(Sc::F32, L::one(R::x(env.t))),
                From::Seed => W::N(Sc::U32, L::one(R::x(f64::from(env.seed)))),
                From::Target { .. } => {
                    let img = env
                        .textures
                        .get(name)
                        .copied()
                        .ok_or_else(|| format!("no image for texture input {name}"))?;
                    p.images.push(img);
                    W::T(p.images.len() - 1)
                }
                From::Storage { .. } => W::T(
                    p.storage
                        .iter()
                        .position(|(n, _)| n == name)
                        .ok_or_else(|| format!("no storage for input {name}"))?,
                ),
                _ => match env.inputs.get(name) {
                    Some(v) => exact_val(v, &mut p.arrays),
                    None => ZERO,
                },
            };
            base.insert(s, v);
        }
        let steps = p.prepare(&c.op.steps, &c.order, &mut Vec::new(), &mut base)?;
        p.base = (0..p.slots.len())
            .map(|i| base.get(&i).copied().unwrap_or(ZERO))
            .collect();
        Ok((p, steps))
    }

    fn src(&mut self, a: &Arg, accs: &[Vec<String>], base: &mut BTreeMap<usize, W>) -> Src {
        match a {
            Arg::Lit(v) => {
                let (sc, l) = literal(v);
                Src::Lit(sc, l)
            }
            Arg::Ref(name, None) if accs.last().is_some_and(|a| a.contains(name)) => {
                Src::Slot(slot(&mut self.slots, &acc_key(name)))
            }
            Arg::Ref(step, port) => {
                let s = slot(&mut self.slots, &key(step, port.as_deref()));
                base.entry(s).or_insert(ZERO);
                Src::Slot(s)
            }
        }
    }

    fn prepare(
        &mut self,
        steps: &'a BTreeMap<String, Step>,
        order: &'a [String],
        accs: &mut Vec<Vec<String>>,
        base: &mut BTreeMap<usize, W>,
    ) -> Result<Vec<P<'a>>, String> {
        let c = self.c;
        let mut out = Vec::new();
        for id in order {
            let s = &steps[id];
            let name = s.op.split('@').next().unwrap_or("");
            let mut args = Vec::new();
            for (port, a) in &s.args {
                let ty = match a {
                    Arg::Ref(n, None) if accs.last().is_some_and(|x| x.contains(n)) => {
                        c.types.get(&acc_key(n)).cloned().unwrap_or(Ty::F32)
                    }
                    Arg::Ref(st, pt) => c
                        .types
                        .get(&key(st, pt.as_deref()))
                        .cloned()
                        .unwrap_or(Ty::F32),
                    Arg::Lit(v) => deep_canvas_effects::check::literal(v).unwrap_or(Ty::F32),
                };
                let src = self.src(a, accs, base);
                args.push((port.as_str(), src, ty));
            }
            let o = slot(&mut self.slots, id);
            let ty = c.types.get(id).cloned().unwrap_or(Ty::F32);
            if name == "const" {
                let v = s.fields.get("value").cloned().unwrap_or(Value::Null);
                base.insert(o, exact_val(&typed_literal(&v, &ty), &mut self.arrays));
                continue;
            }
            let body = match &s.body {
                None => None,
                Some(b) => Some(self.body(id, b, accs, base)?),
            };
            let when = s.when.as_ref().map(|w| slot(&mut self.slots, w));
            out.push(P {
                s,
                name,
                out: o,
                ty,
                args,
                body,
                when,
            });
        }
        Ok(out)
    }

    fn body(
        &mut self,
        id: &'a str,
        b: &'a Body,
        accs: &mut Vec<Vec<String>>,
        base: &mut BTreeMap<usize, W>,
    ) -> Result<PBody<'a>, String> {
        let c = self.c;
        let (count, max) = match &b.count {
            Count::Const(n) => (Src::Lit(Sc::U32, L::one(R::x(f64::from(*n)))), *n),
            Count::Input(name) => (
                Src::Slot(slot(&mut self.slots, name)),
                c.op.inputs
                    .get(name)
                    .and_then(|i| i.range)
                    .map_or(0, |r| r[1] as u32),
            ),
            Count::Unbounded(_) => return Err("unbounded".into()),
        };
        let mut list = Vec::new();
        for (name, ty, init) in &b.accumulate {
            let init = self.src(init, accs, base);
            let a = slot(&mut self.slots, &acc_key(name));
            let next = slot(&mut self.slots, name);
            let out = slot(&mut self.slots, &key(id, Some(name)));
            list.push((a, ty.clone(), init, next, out));
        }
        let index = slot(&mut self.slots, &b.index);
        accs.push(b.accumulate.iter().map(|(n, _, _)| n.clone()).collect());
        let order = c.body_order.get(id).map(Vec::as_slice).unwrap_or(&[]);
        let steps = self.prepare(&b.steps, order, accs, base);
        let stop = b.stop_if.as_ref().map(|a| self.src(a, accs, base));
        accs.pop();
        Ok(PBody {
            count,
            max,
            accs: list,
            index,
            steps: steps?,
            stop,
        })
    }

    fn get(&self, regs: &[W], src: Src) -> W {
        match src {
            Src::Slot(i) => regs[i],
            Src::Lit(sc, l) => W::N(sc, l),
        }
    }

    fn arg(&self, regs: &[W], p: &P<'_>, port: &str) -> W {
        p.args
            .iter()
            .find(|(n, _, _)| *n == port)
            .map_or(ZERO, |(_, s, _)| self.get(regs, *s))
    }

    fn image(&self, v: W) -> Result<&'a Image, String> {
        match v {
            W::T(i) => self
                .images
                .get(i)
                .copied()
                .ok_or_else(|| "no image".to_string()),
            _ => Err("not a texture".into()),
        }
    }

    fn run(
        &mut self,
        steps: &[P<'_>],
        regs: &mut [W],
        pos: [f64; 2],
        element: u32,
    ) -> Result<(), String> {
        for p in steps {
            self.step(p, regs, pos, element)?;
        }
        Ok(())
    }

    fn repeat(
        &mut self,
        b: &PBody<'_>,
        regs: &mut [W],
        pos: [f64; 2],
        element: u32,
    ) -> Result<(), String> {
        let count = match as_l(self.get(regs, b.count), Sc::U32, 1).v[0].exact() {
            Some(c) => (c as u32).min(b.max.max(1)),
            None => return Err("a repeat's count isn't exact".into()),
        };
        for (a, ty, init, _, _) in &b.accs {
            let (sc, n) = sc_of(ty);
            regs[*a] = W::N(sc, as_l(self.get(regs, *init), sc, n));
        }
        // The accumulators where the GPU may have stopped though the reference ran on.
        let mut stops: Vec<Vec<W>> = Vec::new();
        for i in 0..count {
            regs[b.index] = W::N(Sc::U32, L::one(R::x(f64::from(i))));
            self.run(&b.steps, regs, pos, element)?;
            for (a, ty, _, next, _) in &b.accs {
                let (sc, n) = sc_of(ty);
                regs[*a] = W::N(sc, as_l(regs[*next], sc, n));
            }
            if let Some(stop) = b.stop {
                let s = self.get(regs, stop).l().v[0];
                if s.exact() == Some(1.0) {
                    break;
                }
                if s.exact().is_none() {
                    stops.push(b.accs.iter().map(|(a, ..)| regs[*a]).collect());
                }
            }
        }
        for (k, (a, _, _, _, out)) in b.accs.iter().enumerate() {
            regs[*out] = stops.iter().fold(regs[*a], |w, s| w.hull(s[k]));
        }
        Ok(())
    }

    fn store(&mut self, p: &P<'_>, regs: &[W]) {
        let guard = p.when.map(|w| regs[w].l().v[0]);
        if guard.and_then(R::exact) == Some(0.0) {
            return;
        }
        let Some(Arg::Ref(buf, None)) = p.s.args.get("buf") else {
            return;
        };
        let sc = self.c.op.storage[buf].sc;
        let i = as_l(self.arg(regs, p, "i"), Sc::U32, 1).v[0];
        let v = as_l(self.arg(regs, p, "v"), sc, 1).v[0];
        let Some((_, words)) = self.storage.iter_mut().find(|(n, _)| n == buf) else {
            return;
        };
        let last = words.len().saturating_sub(1) as f64;
        let (lo, hi) = (
            i.lo.clamp(0.0, last) as usize,
            i.hi.clamp(0.0, last) as usize,
        );
        let certain = guard.is_none_or(|g| g.exact() == Some(1.0)) && lo == hi;
        for w in words.iter_mut().take(hi + 1).skip(lo) {
            let new = match p.name {
                "write" => v,
                name => int2(
                    sc,
                    *w,
                    v,
                    |x, y| {
                        let (x, y) = (x as u32, y as u32);
                        f64::from(match name {
                            "atomic_add" => x.wrapping_add(y),
                            "atomic_min" => x.min(y),
                            "atomic_max" => x.max(y),
                            "atomic_and" => x & y,
                            "atomic_or" => x | y,
                            _ => x ^ y,
                        })
                    },
                    None,
                ),
            };
            *w = if certain { new } else { w.hull(new) };
        }
    }

    fn step(
        &mut self,
        p: &P<'_>,
        regs: &mut [W],
        pos: [f64; 2],
        element: u32,
    ) -> Result<(), String> {
        if let Some(b) = &p.body {
            return self.repeat(b, regs, pos, element);
        }
        let name = p.name;
        if name == "discard_if" {
            return Ok(());
        }
        if name == "write" || name.starts_with("atomic_") {
            self.store(p, regs);
            return Ok(());
        }
        let (sc, n) = sc_of(&p.ty);
        let g = |port: &str| self.arg(regs, p, port);
        let one = |sc, r| W::N(sc, L::one(r));
        let v = match name {
            "screen_uv" => {
                let uv = [
                    pos[0] / f64::from(self.size[0]),
                    pos[1] / f64::from(self.size[1]),
                ];
                W::N(
                    Sc::F32,
                    L::of(&[
                        fw(R::x(uv[0]), 2.0, 0.0, 0.0),
                        fw(R::x(uv[1]), 2.0, 0.0, 0.0),
                    ]),
                )
            }
            "screen_size" => W::N(
                Sc::F32,
                L::of(&[R::x(f64::from(self.size[0])), R::x(f64::from(self.size[1]))]),
            ),
            "pixel" => W::N(
                Sc::U32,
                L::of(&[R::x(pos[0].floor()), R::x(pos[1].floor())]),
            ),
            "element" => one(Sc::U32, R::x(f64::from(element))),
            "seed" => one(Sc::U32, R::x(f64::from(self.env.seed))),
            "t" => one(Sc::F32, R::x(self.env.t)),
            "camera" => {
                let m = |a: &[f64; 16]| {
                    let mut o = [R::x(0.0); 16];
                    for (x, y) in o.iter_mut().zip(a) {
                        *x = R::x(*y);
                    }
                    W::M(4, o)
                };
                match p.s.fields.get("of").and_then(Value::as_str) {
                    Some("clip") => m(&self.env.clip),
                    Some("inverse_clip") => m(&self.env.inverse_clip),
                    Some("position") => W::N(
                        Sc::F32,
                        L::of(
                            &self.env.eye[..3]
                                .iter()
                                .map(|x| R::x(*x))
                                .collect::<Vec<_>>(),
                        ),
                    ),
                    _ => one(Sc::F32, R::x(self.env.eye[3])),
                }
            }
            "role" => g("x"),
            "normal" => {
                let k = match p.s.fields.get("space").and_then(Value::as_str) {
                    Some("world") => 1,
                    Some("view") => 2,
                    _ => 0,
                };
                W::N(Sc::F32, L::of(&self.env.normals[k].map(R::x)))
            }
            "sample" => {
                let img = self.image(g("tex"))?;
                let uv = as_l(g("uv"), Sc::F32, 2).v;
                if uv[0].top() || uv[1].top() {
                    W::N(Sc::F32, L::of(&[R::TOP; 4]))
                } else {
                    // Texel space, widened by the uv's conversion and the filter's precision.
                    let ts = |u: R, n: u32| {
                        let n = f64::from(n);
                        R::new(u.lo * n - 0.5, u.hi * n - 0.5).widen(FILTER + 4.0 * U * u.mag() * n)
                    };
                    let r = filter_range(img, ts(uv[0], img.w), ts(uv[1], img.h));
                    let lanes = r.map(|c| fw(c, 0.0, 0.0, c.mag() / 1024.0));
                    W::N(Sc::F32, L::of(&lanes))
                }
            }
            "load" => {
                let img = self.image(g("tex"))?;
                let ixy = as_l(g("ixy"), Sc::I32, 2).v;
                let clampx = |r: R, n: u32| {
                    let last = f64::from(n) - 1.0;
                    (r.lo.clamp(0.0, last) as i64, r.hi.clamp(0.0, last) as i64)
                };
                let (x0, x1) = clampx(ixy[0], img.w);
                let (y0, y1) = clampx(ixy[1], img.h);
                let mut c = [R {
                    lo: f64::INFINITY,
                    hi: f64::NEG_INFINITY,
                }; 4];
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        let px = img.px[y as usize * img.w as usize + x as usize];
                        for i in 0..4 {
                            c[i] = c[i].hull(R::x(px[i]));
                        }
                    }
                }
                match p.ty {
                    Ty::V(Sc::F32, 4) => W::N(Sc::F32, L::of(&c)),
                    Ty::V(s2, _) => one(s2, c[0]),
                    _ => one(Sc::F32, c[0]),
                }
            }
            "size" => {
                let img = self.image(g("tex"))?;
                W::N(
                    Sc::U32,
                    L::of(&[R::x(f64::from(img.w)), R::x(f64::from(img.h))]),
                )
            }
            "index" => match g("a") {
                W::A(i) => {
                    let (asc, items) = &self.arrays[i];
                    if items.is_empty() {
                        regs[p.out] = W::N(*asc, L::one(R::x(0.0)));
                        return Ok(());
                    }
                    let k = as_l(g("i"), Sc::U32, 1).v[0];
                    let last = items.len().saturating_sub(1) as f64;
                    let (lo, hi) = (
                        k.lo.clamp(0.0, last) as usize,
                        k.hi.clamp(0.0, last) as usize,
                    );
                    let lanes = match p.ty {
                        Ty::V(_, l) => l as usize,
                        _ => 1,
                    };
                    let mut v = items[lo];
                    for e in &items[lo..=hi] {
                        for (a, b) in v.iter_mut().zip(e) {
                            *a = a.hull(*b);
                        }
                    }
                    W::N(*asc, L { v, n: lanes })
                }
                other => other,
            },
            "read" => {
                let i = as_l(g("i"), Sc::U32, 1).v[0];
                let W::T(b) = g("buf") else {
                    return Err("read names a storage input".into());
                };
                let words = &self.storage[b].1;
                if words.is_empty() {
                    regs[p.out] = one(sc, R::x(0.0));
                    return Ok(());
                }
                let last = words.len().saturating_sub(1) as f64;
                let (lo, hi) = (
                    i.lo.clamp(0.0, last) as usize,
                    i.hi.clamp(0.0, last) as usize,
                );
                let r = words[lo..=hi]
                    .iter()
                    .copied()
                    .reduce(R::hull)
                    .unwrap_or(R::x(0.0));
                one(sc, r)
            }
            "ddx" | "ddy" | "fwidth" => W::N(sc, L { v: [R::TOP; 4], n }),
            _ => {
                let args: Vec<(&str, W, Ty)> = p
                    .args
                    .iter()
                    .map(|(port, s, t)| (*port, self.get(regs, *s), t.clone()))
                    .collect();
                apply(name, &p.s.fields, &p.ty, &args)
                    .ok_or_else(|| format!("no bound for {name}"))?
            }
        };
        regs[p.out] = v;
        Ok(())
    }
}

/// A pass's color at every pixel of a `size` output, each lane's enclosure, and widened by the
/// half-float target's rounding (2^-11 of the value, and a flushed half subnormal).
pub fn pass(c: &Checked, env: &Env<'_>, size: [u32; 2]) -> Result<Vec<[R; 4]>, String> {
    let (mut prog, steps) = Prog::new(c, env, size, &BTreeMap::new())?;
    let mut tail = BTreeMap::new();
    let color = prog.src(&c.op.outputs["color"], &[], &mut tail);
    let coverage =
        c.op.outputs
            .get("coverage")
            .map(|a| prog.src(a, &[], &mut tail));
    if prog.base.len() < prog.slots.len() {
        prog.base.resize(prog.slots.len(), ZERO);
    }
    let mut out = Vec::with_capacity((size[0] * size[1]) as usize);
    let mut regs = prog.base.clone();
    for y in 0..size[1] {
        for x in 0..size[0] {
            let pos = [f64::from(x) + 0.5, f64::from(y) + 0.5];
            regs.copy_from_slice(&prog.base);
            prog.run(&steps, &mut regs, pos, 0)?;
            let mut px = as_l(prog.get(&regs, color), Sc::F32, 4).v;
            if let Some(cov) = coverage {
                let k = as_l(prog.get(&regs, cov), Sc::F32, 1).v[0];
                for v in &mut px {
                    *v = fw(rmul(*v, k), 2.0, 0.0, 0.0);
                }
            }
            out.push(px.map(|v| {
                let r = v.widen(v.mag() / 1024.0 + 1.0 / 16384.0);
                if r.mag() > 65_504.0 {
                    R::TOP
                } else {
                    r
                }
            }));
        }
    }
    Ok(out)
}

/// A compute operator's storage outputs over its elements, each slot's enclosure.
pub fn compute(
    c: &Checked,
    env: &Env<'_>,
    storage: &BTreeMap<String, Vec<f64>>,
) -> Result<BTreeMap<String, Vec<R>>, String> {
    let (mut prog, steps) = Prog::new(c, env, [0, 0], storage)?;
    let mut regs = prog.base.clone();
    for e in 0..c.op.elements {
        regs.copy_from_slice(&prog.base);
        prog.run(&steps, &mut regs, [0.0, 0.0], e)?;
    }
    Ok(prog
        .storage
        .into_iter()
        .filter(|(k, _)| c.op.storage.contains_key(k))
        .collect())
}
