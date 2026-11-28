
use std::collections::BTreeMap;

use deep_canvas::interval::{self as iv, Iv};
use serde_json::{json, Map, Value};

use crate::check::{acc_key, key, CheckOptions, Checked};
use crate::graph::{self, Arg, Body, Count, From, Issue, Operator, Origin, Sc, Step, Tex, Ty};

pub const F32_MAX: f64 = f32::MAX as f64;
pub const TINY: f64 = f32::MIN_POSITIVE as f64;
pub const DIV_ULPS: u32 = 3;
const HALF_TOP: Lane = Lane {
    lo: -65504.0,
    hi: 65504.0,
    may_nan: true,
    may_pos_inf: true,
    may_neg_inf: true,
    may_neg_zero: true,
};
const MAX_SIDE: f64 = 65536.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lane {
    pub lo: f64,
    pub hi: f64,
    pub may_nan: bool,
    pub may_pos_inf: bool,
    pub may_neg_inf: bool,
    pub may_neg_zero: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Fact {
    pub lanes: Vec<Lane>,
}

impl Lane {
    pub const TOP: Lane = Lane {
        lo: -F32_MAX,
        hi: F32_MAX,
        may_nan: true,
        may_pos_inf: true,
        may_neg_inf: true,
        may_neg_zero: true,
    };

    pub const EMPTY: Lane = Lane {
        lo: f64::INFINITY,
        hi: f64::NEG_INFINITY,
        may_nan: false,
        may_pos_inf: false,
        may_neg_inf: false,
        may_neg_zero: false,
    };

    pub fn range(lo: f64, hi: f64) -> Lane {
        Lane::of(Iv::new(lo, hi))
    }

    pub fn of(r: Iv) -> Lane {
        if r.lo.is_nan() || r.hi.is_nan() {
            return Lane::TOP;
        }
        if r.is_empty() {
            return Lane::EMPTY;
        }
        let lo = f32_down(r.lo);
        let hi = f32_up(r.hi);
        Lane {
            lo: lo.max(-F32_MAX),
            hi: hi.min(F32_MAX),
            may_nan: false,
            may_pos_inf: hi > F32_MAX,
            may_neg_inf: lo < -F32_MAX,
            may_neg_zero: lo <= 0.0 && hi >= 0.0,
        }
    }

    pub fn finite(&self) -> bool {
        !(self.may_nan || self.may_pos_inf || self.may_neg_inf)
    }

    pub fn iv(&self) -> Iv {
        if self.lo > self.hi {
            return Iv::EMPTY;
        }
        Iv::new(self.lo, self.hi)
    }

    pub fn hull(self, o: Lane) -> Lane {
        Lane {
            lo: self.lo.min(o.lo),
            hi: self.hi.max(o.hi),
            may_nan: self.may_nan || o.may_nan,
            may_pos_inf: self.may_pos_inf || o.may_pos_inf,
            may_neg_inf: self.may_neg_inf || o.may_neg_inf,
            may_neg_zero: self.may_neg_zero || o.may_neg_zero,
        }
    }

    fn finite_part(self) -> Lane {
        Lane {
            may_nan: false,
            may_pos_inf: false,
            may_neg_inf: false,
            ..self
        }
    }

    fn nan(self, yes: bool) -> Lane {
        Lane {
            may_nan: self.may_nan || yes,
            ..self
        }
    }

    fn infinite(self, pos: bool, neg: bool) -> Lane {
        Lane {
            may_pos_inf: self.may_pos_inf || pos,
            may_neg_inf: self.may_neg_inf || neg,
            ..self
        }
    }

    fn widen32(self, n: u32) -> Lane {
        if self.lo > self.hi {
            return self;
        }
        let (mut lo, mut hi) = (self.lo, self.hi);
        for _ in 0..n {
            lo = f32_next_down(lo);
            hi = f32_next_up(hi);
        }
        let r = Lane::of(Iv::new(lo, hi));
        Lane {
            may_nan: self.may_nan,
            may_pos_inf: self.may_pos_inf || r.may_pos_inf,
            may_neg_inf: self.may_neg_inf || r.may_neg_inf,
            ..r
        }
    }
}

impl Fact {
    pub fn top(n: usize) -> Fact {
        Fact {
            lanes: vec![Lane::TOP; n.max(1)],
        }
    }

    fn of(lanes: Vec<Lane>) -> Fact {
        Fact { lanes }
    }

    pub fn finite(&self) -> bool {
        self.lanes.iter().all(Lane::finite)
    }

    fn finite_part(&self) -> Fact {
        Fact::of(self.lanes.iter().map(|l| l.finite_part()).collect())
    }

    fn carrying(self) -> Fact {
        Fact::of(
            self.lanes
                .into_iter()
                .map(|l| l.nan(true).infinite(true, true))
                .collect(),
        )
    }

    fn lane(&self, i: usize) -> Lane {
        match self.lanes.len() {
            0 => Lane::TOP,
            1 => self.lanes[0],
            n => self.lanes[i.min(n - 1)],
        }
    }

    fn hull(&self) -> Lane {
        self.lanes
            .iter()
            .copied()
            .reduce(Lane::hull)
            .unwrap_or(Lane::TOP)
    }

    fn splat(&self, n: usize) -> Fact {
        Fact::of((0..n.max(1)).map(|i| self.lane(i)).collect())
    }
}

fn f32_down(x: f64) -> f64 {
    if !x.is_finite() || x.abs() > F32_MAX {
        return x;
    }
    let r = f64::from(x as f32);
    if r > x {
        f32_next_down(r)
    } else {
        r
    }
}

fn f32_up(x: f64) -> f64 {
    if !x.is_finite() || x.abs() > F32_MAX {
        return x;
    }
    let r = f64::from(x as f32);
    if r < x {
        f32_next_up(r)
    } else {
        r
    }
}

fn f32_next_down(x: f64) -> f64 {
    if !x.is_finite() || x.abs() > F32_MAX {
        return x;
    }
    f64::from((x as f32).next_down())
}

fn f32_next_up(x: f64) -> f64 {
    if !x.is_finite() || x.abs() > F32_MAX {
        return x;
    }
    f64::from((x as f32).next_up())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    DivideByZero,
    NegativeRoot,
    LogDomain,
    ZeroNormalize,
    AcosDomain,
    Overflow,
    Unknown,
}

impl Why {
    pub fn word(self) -> &'static str {
        match self {
            Why::DivideByZero => "divide_by_zero",
            Why::NegativeRoot => "negative_root",
            Why::LogDomain => "log_domain",
            Why::ZeroNormalize => "zero_normalize",
            Why::AcosDomain => "acos_domain",
            Why::Overflow => "overflow",
            Why::Unknown => "unknown_range",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    Proven,
    Unproven(Vec<Issue>),
}

impl Verdict {
    pub fn word(&self) -> &'static str {
        match self {
            Verdict::Proven => "proven",
            Verdict::Unproven(_) => "unproven",
        }
    }

    pub fn and(self, o: &Verdict) -> Verdict {
        match (self, o) {
            (Verdict::Proven, Verdict::Proven) => Verdict::Proven,
            (Verdict::Unproven(a), Verdict::Proven) => Verdict::Unproven(a),
            (Verdict::Proven, Verdict::Unproven(b)) => Verdict::Unproven(b.clone()),
            (Verdict::Unproven(mut a), Verdict::Unproven(b)) => {
                a.extend(b.iter().cloned());
                Verdict::Unproven(a)
            }
        }
    }
}

const MATH: &[&str] = &[
    "abs", "acos", "add", "asin", "atan", "atan2", "ceil", "clamp", "cos", "cross", "distance",
    "div", "dot", "exp", "exp2", "floor", "fract", "inverse_sqrt", "length", "log", "log2", "max",
    "min", "mix", "mod", "mul", "neg", "normalize", "pow", "rem", "round", "sign", "sin",
    "smoothstep", "sqrt", "sub", "tan", "trunc",
];

pub fn transfer(op: &str, args: &[Fact]) -> Fact {
    transfer_with(op, args, CheckOptions::default())
}

pub fn transfer_with(op: &str, args: &[Fact], options: CheckOptions) -> Fact {
    let op = op.split('@').next().unwrap_or(op);
    let n = args.iter().map(|a| a.lanes.len()).max().unwrap_or(1).max(1);
    let arg = |k: usize| args.get(k).cloned().unwrap_or_else(|| Fact::top(n));
    if args.iter().any(|a| !a.finite()) {
        let out = match op {
            "length" | "distance" | "dot" => 1,
            "cross" => 3,
            _ => n,
        };
        return Fact::top(out);
    }
    let each1 = |f: &dyn Fn(Lane) -> Lane| Fact::of((0..n).map(|i| f(arg(0).lane(i))).collect());
    let each2 =
        |f: &dyn Fn(Lane, Lane) -> Lane| Fact::of((0..n).map(|i| f(arg(0).lane(i), arg(1).lane(i))).collect());
    let each3 = |f: &dyn Fn(Lane, Lane, Lane) -> Lane| {
        Fact::of(
            (0..n)
                .map(|i| f(arg(0).lane(i), arg(1).lane(i), arg(2).lane(i)))
                .collect(),
        )
    };
    match op {
        "neg" | "abs" | "sign" | "floor" | "ceil" | "trunc" | "round" | "fract" | "sqrt"
        | "inverse_sqrt" | "exp" | "exp2" | "log" | "log2" | "sin" | "cos" | "tan" | "asin"
        | "acos" | "atan" => each1(&|x| unary(op, x)),
        "add" | "sub" | "mul" | "div" | "mod" | "rem" | "min" | "max" | "pow" | "atan2" => {
            each2(&|a, b| binary(op, a, b, options))
        }
        "clamp" => each3(&|x, lo, hi| Lane::of(x.iv().max(lo.iv()).min(hi.iv()))),
        "mix" => each3(&|a, b, t| {
            let w = Iv::point(1.0).sub(t.iv());
            Lane::of(mul_iv(a.iv(), w, options).add(mul_iv(b.iv(), t.iv(), options)))
        }),
        "smoothstep" => each3(&|lo, hi, _x| {
            let d = hi.iv().sub(lo.iv());
            let unit = Lane::range(0.0, 1.0);
            if d.lo < TINY && d.hi > -TINY {
                unit.nan(true)
            } else {
                unit
            }
        }),
        "dot" => Fact::of(vec![dot(&arg(0), &arg(1), n, options)]),
        "length" => Fact::of(vec![root_of_sum(sum_sq(&arg(0)))]),
        "distance" => {
            let d = Fact::of(
                (0..n)
                    .map(|i| Lane::of(arg(0).lane(i).iv().sub(arg(1).lane(i).iv())))
                    .collect(),
            );
            Fact::of(vec![root_of_sum(sum_sq(&d))])
        }
        "normalize" => {
            let x = arg(0);
            let s2 = sum_sq(&x);
            let zero = s2.lo < TINY;
            let len = iv::sqrt(s2.meet(Iv::new(TINY, f64::INFINITY)));
            Fact::of(
                (0..n)
                    .map(|i| {
                        let unit = Iv::new(-1.0, 1.0);
                        let r = if zero {
                            unit
                        } else {
                            x.lane(i).iv().div(len).meet(unit)
                        };
                        Lane::of(r).widen32(DIV_ULPS).nan(zero)
                    })
                    .collect(),
            )
        }
        "cross" => {
            let (a, b) = (arg(0).splat(3), arg(1).splat(3));
            let p = |i: usize, j: usize| mul_iv(a.lanes[i].iv(), b.lanes[j].iv(), options);
            Fact::of(vec![
                Lane::of(p(1, 2).sub(p(2, 1))),
                Lane::of(p(2, 0).sub(p(0, 2))),
                Lane::of(p(0, 1).sub(p(1, 0))),
            ])
        }
        _ => Fact::top(n),
    }
}

fn mul_iv(a: Iv, b: Iv, options: CheckOptions) -> Iv {
    if options.mul_two_corners {
        if a.is_empty() || b.is_empty() {
            return Iv::EMPTY;
        }
        let (x, y) = (a.lo * b.lo, a.hi * b.hi);
        return Iv::new(x.min(y), x.max(y));
    }
    a.mul(b)
}

fn loose(r: Iv) -> Iv {
    if r.is_empty() {
        return r;
    }
    let pad = |x: f64| x.abs() * (1.0 / 1024.0) + 1.0 / 2048.0;
    Iv::new(r.lo - pad(r.lo), r.hi + pad(r.hi))
}

const POS: Iv = Iv {
    lo: 0.0,
    hi: f64::INFINITY,
};

fn unary(op: &str, x: Lane) -> Lane {
    let a = x.iv();
    match op {
        "neg" => Lane::of(a.neg()),
        "abs" => Lane::of(a.abs()),
        "sign" => Lane::of(iv::sign(a)),
        "floor" => Lane::of(iv::floor(a)),
        "ceil" => Lane::of(iv::ceil(a)),
        "trunc" => Lane::of(Iv::new(a.lo.trunc(), a.hi.trunc())),
        "round" => Lane::of(Iv::new(a.lo.floor(), a.hi.ceil())),
        "fract" => Lane::of(iv::fract(a).meet(Iv::new(0.0, 1.0))),
        "sqrt" => Lane::of(iv::sqrt(a.meet(POS)))
            .widen32(DIV_ULPS)
            .nan(a.lo < 0.0),
        "inverse_sqrt" => {
            let p = a.meet(POS);
            let zero = !p.is_empty() && p.lo < TINY;
            let r = if p.is_empty() {
                Lane::EMPTY
            } else if zero {
                let top = Iv::new(down_recip_sqrt(p.hi), f64::INFINITY);
                Lane::of(top).widen32(DIV_ULPS)
            } else {
                Lane::of(iv::sqrt(p).recip()).widen32(DIV_ULPS)
            };
            r.nan(a.lo < 0.0)
                .infinite(zero, zero && (x.may_neg_zero || a.lo < 0.0))
        }
        "exp" => Lane::of(loose(iv::exp(a)).meet(POS)),
        "exp2" => Lane::of(
            loose(iv::exp(a.mul(Iv::point(std::f64::consts::LN_2)).widen(1))).meet(POS),
        ),
        "log" | "log2" => {
            let p = a.meet(POS);
            let r = if p.is_empty() {
                Lane::EMPTY
            } else {
                Lane::of(loose(if op == "log" { iv::log(p) } else { iv::log2(p) }))
            };
            r.nan(a.lo < 0.0).infinite(false, !p.is_empty() && p.lo < TINY)
        }
        "sin" => Lane::of(loose(iv::sin(a)).meet(Iv::new(-1.0, 1.0))),
        "cos" => Lane::of(loose(iv::cos(a)).meet(Iv::new(-1.0, 1.0))),
        "tan" => Lane::of(loose(iv::tan(a))),
        "asin" | "acos" => {
            let d = a.meet(Iv::new(-1.0, 1.0));
            let r = if d.is_empty() {
                Lane::EMPTY
            } else {
                Lane::of(loose(if op == "asin" { iv::asin(d) } else { iv::acos(d) }))
            };
            r.nan(a.lo < -1.0 || a.hi > 1.0)
        }
        "atan" => Lane::of(loose(iv::atan(a))),
        _ => Lane::TOP,
    }
}

fn down_recip_sqrt(x: f64) -> f64 {
    iv::down(1.0 / iv::up(x.sqrt(), 2), 2)
}

fn binary(op: &str, x: Lane, y: Lane, options: CheckOptions) -> Lane {
    let (a, b) = (x.iv(), y.iv());
    let near_zero = b.lo < TINY && b.hi > -TINY;
    match op {
        "add" => Lane::of(a.add(b)),
        "sub" => Lane::of(a.sub(b)),
        "mul" => Lane::of(mul_iv(a, b, options)),
        "min" => Lane::of(a.min(b)),
        "max" => Lane::of(a.max(b)),
        "div" if near_zero => Lane::range(-F32_MAX, F32_MAX)
            .nan(a.lo <= 0.0 && a.hi >= 0.0)
            .infinite(true, true),
        "div" => Lane::of(a.div(b)).widen32(DIV_ULPS),
        "mod" | "rem" if near_zero => Lane::TOP,
        "mod" | "rem" => {
            let r = if op == "mod" {
                iv::modulo(a, b)
            } else {
                iv::rem(a, b)
            };
            Lane::of(r.widen(2)).widen32(DIV_ULPS)
        }
        "pow" => {
            if a.lo < 0.0 {
                return Lane::TOP;
            }
            let p = iv::log(a).mul(b);
            let r = Lane::of(loose(iv::exp(p)).meet(POS));
            let pole = a.lo < TINY && b.lo <= 0.0;
            r.infinite(pole, false).nan(pole && b.lo <= 0.0 && b.hi >= 0.0 && a.lo <= 0.0)
        }
        "atan2" => Lane::of(Iv::new(-std::f64::consts::PI, std::f64::consts::PI).widen(4)),
        _ => Lane::TOP,
    }
}

fn dot(a: &Fact, b: &Fact, n: usize, options: CheckOptions) -> Lane {
    let mut s = Iv::point(0.0);
    for i in 0..n {
        s = s.add(mul_iv(a.lane(i).iv(), b.lane(i).iv(), options));
    }
    Lane::of(s)
}

fn sum_sq(x: &Fact) -> Iv {
    let mut s = Iv::point(0.0);
    for l in &x.lanes {
        s = s.add(l.iv().sqr());
    }
    s
}

fn root_of_sum(s: Iv) -> Lane {
    Lane::of(iv::sqrt(s.meet(POS))).widen32(DIV_ULPS)
}

fn why_of(op: &str, args: &[Fact]) -> Why {
    let lo = |k: usize| args.get(k).map_or(f64::NEG_INFINITY, |f| f.hull().lo);
    match op {
        "div" | "mod" | "rem" | "smoothstep" => Why::DivideByZero,
        "sqrt" => Why::NegativeRoot,
        "inverse_sqrt" if lo(0) < 0.0 => Why::NegativeRoot,
        "inverse_sqrt" => Why::DivideByZero,
        "pow" if lo(0) < 0.0 => Why::NegativeRoot,
        "pow" if lo(0) < TINY => Why::LogDomain,
        "log" | "log2" => Why::LogDomain,
        "normalize" => Why::ZeroNormalize,
        "acos" | "asin" => Why::AcosDomain,
        _ => Why::Overflow,
    }
}

fn lanes_of(t: &Ty) -> usize {
    match t {
        Ty::V(_, n) => *n as usize,
        Ty::Int => 1,
        Ty::Mat(n) => (*n as usize) * (*n as usize),
        Ty::Arr(_, n, _) => *n as usize,
        _ => 1,
    }
}

fn sc_of(t: &Ty) -> Option<Sc> {
    match t {
        Ty::V(sc, _) | Ty::Arr(sc, _, _) | Ty::Storage(sc, _) => Some(*sc),
        Ty::Int => Some(Sc::I32),
        Ty::Mat(_) => Some(Sc::F32),
        _ => None,
    }
}

fn type_range(sc: Sc) -> Lane {
    match sc {
        Sc::Bool => Lane::range(0.0, 1.0),
        Sc::U32 => Lane::range(0.0, f64::from(u32::MAX)),
        Sc::I32 => Lane::range(f64::from(i32::MIN), f64::from(i32::MAX)),
        Sc::F32 => Lane::TOP,
    }
}

fn int_lane(sc: Sc, r: Iv) -> Lane {
    let whole = type_range(sc);
    if r.is_empty() || !r.is_bounded() || r.lo < whole.lo || r.hi > whole.hi {
        whole
    } else {
        Lane::range(r.lo.floor(), r.hi.ceil())
    }
}

fn literal(v: &Value, sc: Option<Sc>) -> Fact {
    let one = |x: &Value| -> Lane {
        match x {
            Value::Bool(b) => Lane::range(f64::from(u8::from(*b)), f64::from(u8::from(*b))),
            Value::Number(n) => n.as_f64().map_or(Lane::TOP, |f| {
                let f = match sc {
                    Some(Sc::F32) | None => f64::from(f as f32),
                    Some(_) => f,
                };
                Lane::range(f, f)
            }),
            _ => Lane::TOP,
        }
    };
    match v {
        Value::Array(a) if a.iter().all(Value::is_array) => {
            let rows: Vec<Fact> = a.iter().map(|r| literal(r, sc)).collect();
            let n = rows.iter().map(|r| r.lanes.len()).max().unwrap_or(1);
            Fact::of(
                (0..n)
                    .map(|i| {
                        rows.iter()
                            .filter_map(|r| r.lanes.get(i).copied())
                            .reduce(Lane::hull)
                            .unwrap_or(Lane::TOP)
                    })
                    .collect(),
            )
        }
        Value::Array(a) => Fact::of(a.iter().map(one).collect()),
        other => Fact::of(vec![one(other)]),
    }
}

fn seed(input: &graph::Input, options: CheckOptions) -> Fact {
    let n = lanes_of(&input.ty);
    if let Some([lo, hi]) = input.range {
        let l = match sc_of(&input.ty) {
            Some(sc) if sc != Sc::F32 => int_lane(sc, Iv::new(lo, hi)),
            _ => Lane::range(lo, hi),
        };
        let n = if matches!(input.ty, Ty::Tex(_) | Ty::Tex3(_)) { 4 } else { n };
        return Fact::of(vec![l; n]);
    }
    let float_texture = |unorm: bool, half: bool| {
        if unorm || options.unit_float_textures {
            Fact::of(vec![Lane::range(0.0, 1.0); 4])
        } else if half {
            Fact::of(vec![HALF_TOP; 4])
        } else {
            Fact::top(4)
        }
    };
    match (&input.ty, &input.from) {
        (Ty::Tex(Tex::Depth), _) => Fact::of(vec![Lane::range(0.0, 1.0); 4]),
        (Ty::Tex(Tex::Uint) | Ty::Tex3(Tex::Uint), _) => Fact::of(vec![type_range(Sc::U32); 4]),
        (Ty::Tex(_) | Ty::Tex3(_), From::Asset(_)) => float_texture(true, false),
        (Ty::Tex(_) | Ty::Tex3(_), From::Target { op, .. }) => float_texture(false, op == "core"),
        (Ty::Tex(_) | Ty::Tex3(_), _) => float_texture(false, false),
        (Ty::Storage(sc, _), _) if *sc != Sc::F32 => Fact::of(vec![type_range(*sc)]),
        (Ty::Storage(..), _) => Fact::top(1),
        (_, From::Time) => Fact::of(vec![Lane::range(0.0, 1e7)]),
        (_, From::Phase(_)) => Fact::of(vec![Lane::range(0.0, 1.0)]),
        (_, From::Role(_)) => Fact::of(vec![Lane::range(0.0, 1.0); n]),
        (_, From::Spline(table)) => {
            let h = table
                .iter()
                .flatten()
                .fold(Iv::EMPTY, |r, x| r.hull(Iv::point(*x)));
            Fact::of(vec![Lane::of(h); n.max(1)])
        }
        (ty, _) => match sc_of(ty) {
            Some(sc) if sc != Sc::F32 => Fact::of(vec![type_range(sc); n]),
            _ => Fact::of(vec![Lane::range(-F32_MAX, F32_MAX); n.max(1)]),
        },
    }
}

struct Env<'a> {
    op: &'a Operator,
    types: &'a BTreeMap<String, Ty>,
    facts: BTreeMap<String, Fact>,
    accs: Vec<Vec<String>>,
    origin: BTreeMap<String, String>,
    options: CheckOptions,
    issues: Vec<Issue>,
}

impl Env<'_> {
    fn is_acc(&self, name: &str) -> bool {
        self.accs.iter().any(|a| a.iter().any(|n| n == name))
    }

    fn name_of(&self, a: &Arg) -> Option<String> {
        match a {
            Arg::Ref(name, None) if self.is_acc(name) => Some(acc_key(name)),
            Arg::Ref(name, port) => Some(key(name, port.as_deref())),
            Arg::Lit(_) => None,
        }
    }

    fn arg(&self, a: &Arg, want: Option<&Ty>) -> Fact {
        match a {
            Arg::Lit(v) => literal(v, want.and_then(sc_of)),
            other => self
                .name_of(other)
                .and_then(|k| self.facts.get(&k).cloned())
                .unwrap_or_else(|| Fact::top(1)),
        }
    }

    fn origin_of(&self, a: &Arg) -> Option<String> {
        let k = self.name_of(a)?;
        self.origin.get(&k).cloned().or_else(|| match a {
            Arg::Ref(name, None) => self
                .op
                .inputs
                .get(name)
                .filter(|i| i.range.is_none())
                .map(|_| name.clone()),
            _ => None,
        })
    }

    fn refuse(&mut self, id: &str, s: &Step, why: Why, args: &[(String, Fact)]) {
        let ranges = args
            .iter()
            .map(|(p, f)| {
                let h = f.hull();
                format!("{p} in [{}, {}]", h.lo, h.hi)
            })
            .collect::<Vec<_>>()
            .join(", ");
        let undeclared = s.args.values().find_map(|a| self.origin_of(a));
        let input = undeclared.clone().unwrap_or_else(|| ranges.clone());
        let from = undeclared
            .map(|name| format!(" (from the input {name}, which declares no range)"))
            .unwrap_or_default();
        self.issues.push(Issue {
            op: Some(s.op.clone()),
            input: Some(input.clone()),
            reason: Some(why.word()),
            ..Issue::at_step(
                "operator.value",
                id,
                format!(
                    "step {id} ({}) can produce a NaN or an infinity ({}) with {ranges}{from}; put a guard step before it that bounds its input (max, clamp or select), or declare the input's range",
                    s.op,
                    why.word()
                ),
            )
        });
    }

    fn steps(
        &mut self,
        steps: &BTreeMap<String, Step>,
        order: &[String],
        bodies: &BTreeMap<String, Vec<String>>,
    ) {
        for id in order {
            let s = &steps[id];
            match &s.body {
                Some(b) => self.repeat(id, b, bodies),
                None => self.step(id, s),
            }
        }
    }

    fn repeat(&mut self, id: &str, b: &Body, bodies: &BTreeMap<String, Vec<String>>) {
        let count = match &b.count {
            Count::Const(c) => *c,
            Count::Input(name) => self
                .op
                .inputs
                .get(name)
                .and_then(|i| i.range)
                .map_or(crate::check::MAX_COUNT, |r| r[1].max(0.0) as u32),
            Count::Unbounded(_) => crate::check::MAX_COUNT,
        };
        let order = bodies.get(id).cloned().unwrap_or_default();
        let names: Vec<String> = b.accumulate.iter().map(|(n, _, _)| n.clone()).collect();
        let mut seen = BTreeMap::new();
        for (name, ty, init) in &b.accumulate {
            let v = self.arg(init, Some(ty)).splat(lanes_of(ty));
            self.facts.insert(acc_key(name), v.clone());
            seen.insert(name.clone(), v);
        }
        self.facts.insert(
            b.index.clone(),
            Fact::of(vec![Lane::range(0.0, f64::from(count.max(1) - 1))]),
        );
        self.accs.push(names.clone());
        let before = self.issues.len();
        for _ in 0..count {
            self.steps(&b.steps, &order, bodies);
            let mut grew = false;
            for (name, ty, _) in &b.accumulate {
                let next = self
                    .facts
                    .get(&key(name, None))
                    .cloned()
                    .unwrap_or_else(|| Fact::top(1))
                    .splat(lanes_of(ty));
                let old: &Fact = &seen[name];
                let merged = Fact::of(
                    old.lanes
                        .iter()
                        .zip(&next.lanes)
                        .map(|(a, b)| a.hull(*b))
                        .collect(),
                );
                grew |= merged != *old;
                self.facts.insert(acc_key(name), merged.clone());
                seen.insert(name.clone(), merged);
            }
            if self.issues.len() > before || !grew {
                break;
            }
        }
        self.accs.pop();
        for name in &names {
            self.facts.insert(key(id, Some(name)), seen[name].clone());
        }
    }

    fn step(&mut self, id: &str, s: &Step) {
        let out_ty = self.types.get(&key(id, None)).cloned();
        let bare = s.op.split('@').next().unwrap_or(&s.op).to_string();
        let ports: Vec<&str> = crate::table::def(&s.op)
            .map(|d| d.ports.to_vec())
            .unwrap_or_default();
        let mut ordered: Vec<(String, Fact)> = Vec::new();
        for p in &ports {
            if let Some(a) = s.args.get(*p) {
                ordered.push((p.to_string(), self.arg(a, out_ty.as_ref())));
            }
        }
        for (p, a) in &s.args {
            if !ports.contains(&p.as_str()) {
                ordered.push((p.clone(), self.arg(a, out_ty.as_ref())));
            }
        }
        let carried = ordered.iter().any(|(_, f)| !f.finite());
        let finite: Vec<(String, Fact)> = ordered
            .iter()
            .map(|(p, f)| (p.clone(), f.finite_part()))
            .collect();
        if let Some(t) = &out_ty {
            let n = lanes_of(t);
            let made = match sc_of(t) {
                Some(Sc::F32) => self.float(s, &bare, t, n, &finite),
                Some(sc) => Ok(self.int(s, &bare, sc, n, &finite)),
                None => Ok(Fact::top(n)),
            };
            let made = match made {
                Ok(f) if f.finite() => f,
                Ok(f) => {
                    let why = if MATH.contains(&bare.as_str()) {
                        let facts: Vec<Fact> = finite.iter().map(|(_, f)| f.clone()).collect();
                        why_of(&bare, &facts)
                    } else {
                        Why::Unknown
                    };
                    self.refuse(id, s, why, &finite);
                    f
                }
                Err(why) => {
                    self.refuse(id, s, why, &finite);
                    Fact::top(n)
                }
            };
            let float = sc_of(t) == Some(Sc::F32);
            let fact = if carried && float { made.carrying() } else { made };
            if let Some(o) = s.args.values().find_map(|a| self.origin_of(a)) {
                self.origin.insert(key(id, None), o);
            }
            self.facts.insert(key(id, None), fact);
        }
        self.ports(id, s, &ordered);
    }

    fn ports(&mut self, id: &str, s: &Step, args: &[(String, Fact)]) {
        let prefix = format!("{id}.");
        let ports: Vec<(String, Ty)> = self
            .types
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .map(|(k, t)| (k.clone(), t.clone()))
            .collect();
        for (k, t) in ports {
            if self.facts.contains_key(&k) {
                continue;
            }
            let n = lanes_of(&t);
            let l = match sc_of(&t) {
                Some(Sc::F32) if s.op == "cells@1" => {
                    let p = args.iter().find(|(q, _)| q == "p").map(|(_, f)| f.hull());
                    match (k.ends_with(".center"), p) {
                        (true, Some(p)) if p.finite() => Lane::of(p.iv().add(Iv::new(-2.0, 2.0))),
                        (true, _) => Lane::TOP,
                        (false, _) => Lane::range(0.0, 4.0),
                    }
                }
                Some(Sc::F32) => Lane::TOP,
                Some(sc) => type_range(sc),
                None => Lane::TOP,
            };
            self.facts.insert(k, Fact::of(vec![l; n]));
        }
    }

    fn int(&self, s: &Step, op: &str, sc: Sc, n: usize, args: &[(String, Fact)]) -> Fact {
        let get = |p: &str| {
            args.iter()
                .find(|(q, _)| q == p)
                .map(|(_, f)| f.clone())
                .unwrap_or_else(|| Fact::of(vec![type_range(sc)]))
        };
        let whole = type_range(sc);
        let fit = |l: Lane| {
            if l.finite() {
                int_lane(sc, l.iv().meet(Iv::new(whole.lo, whole.hi)))
            } else {
                whole
            }
        };
        let lane2 = |f: &dyn Fn(Iv, Iv) -> Iv| {
            let (a, b) = (get("a"), get("b"));
            Fact::of(
                (0..n)
                    .map(|i| int_lane(sc, f(a.lane(i).iv(), b.lane(i).iv())))
                    .collect(),
            )
        };
        match op {
            "const" => literal(s.fields.get("value").unwrap_or(&Value::Null), Some(sc)).splat(n),
            "add" => lane2(&|a, b| a.add(b)),
            "sub" => lane2(&|a, b| a.sub(b)),
            "mul" => lane2(&|a, b| a.mul(b)),
            "min" => lane2(&|a, b| a.min(b)),
            "max" => lane2(&|a, b| a.max(b)),
            "clamp" => {
                let (x, lo, hi) = (get("x"), get("lo"), get("hi"));
                Fact::of(
                    (0..n)
                        .map(|i| {
                            int_lane(sc, x.lane(i).iv().max(lo.lane(i).iv()).min(hi.lane(i).iv()))
                        })
                        .collect(),
                )
            }
            "select" => {
                let (f, t) = (get("f"), get("t"));
                Fact::of((0..n).map(|i| fit(f.lane(i).hull(t.lane(i)))).collect())
            }
            "split" => Fact::of(pick(s, &get("x")).lanes.into_iter().map(fit).collect()).splat(n),
            "convert" => Fact::of(get("x").lanes.into_iter().map(fit).collect()).splat(n),
            "compose" => Fact::of(
                ["x", "y", "z", "w"]
                    .iter()
                    .filter(|p| args.iter().any(|(q, _)| q == *p))
                    .flat_map(|p| get(p).lanes)
                    .map(fit)
                    .collect(),
            )
            .splat(n),
            "index" => Fact::of(vec![fit(get("a").hull())]).splat(n),
            "size" => Fact::of(vec![Lane::range(1.0, MAX_SIDE); n]),
            "element" => Fact::of(vec![
                Lane::range(0.0, f64::from(crate::check::MAX_ELEMENTS - 1));
                n
            ]),
            "pixel" => Fact::of(vec![Lane::range(0.0, MAX_SIDE); n]),
            "abs" => Fact::of(get("x").lanes.into_iter().map(|l| int_lane(sc, l.iv().abs())).collect())
                .splat(n),
            _ => Fact::of(vec![whole; n]),
        }
    }

    fn float(
        &self,
        s: &Step,
        op: &str,
        t: &Ty,
        n: usize,
        args: &[(String, Fact)],
    ) -> Result<Fact, Why> {
        let get = |p: &str| {
            args.iter()
                .find(|(q, _)| q == p)
                .map(|(_, f)| f.clone())
                .unwrap_or_else(|| Fact::top(1))
        };
        let finite = |f: &Fact| if f.finite() { Ok(()) } else { Err(Why::Unknown) };
        let mats = op == "mul"
            && ["a", "b"]
                .iter()
                .any(|p| matches!(self.arg_ty(s, p), Some(Ty::Mat(_))));
        if mats {
            let m = match t {
                Ty::Mat(m) => *m as usize,
                _ => n,
            };
            let (a, b) = (get("a").hull(), get("b").hull());
            finite(&Fact::of(vec![a, b]))?;
            let mut sum = Iv::point(0.0);
            for _ in 0..m {
                sum = sum.add(mul_iv(a.iv(), b.iv(), self.options));
            }
            return Ok(Fact::of(vec![Lane::of(sum); n]));
        }
        if MATH.contains(&op) {
            let facts: Vec<Fact> = args.iter().map(|(_, f)| f.clone()).collect();
            return Ok(transfer_with(op, &facts, self.options).splat(n));
        }
        let out = match op {
            "const" => literal(s.fields.get("value").unwrap_or(&Value::Null), Some(Sc::F32)),
            "select" => {
                let (f, tt) = (get("f").splat(n), get("t").splat(n));
                Fact::of((0..n).map(|i| f.lanes[i].hull(tt.lanes[i])).collect())
            }
            "convert" => get("x"),
            "split" => pick(s, &get("x")),
            "compose" => Fact::of(
                ["x", "y", "z", "w"]
                    .iter()
                    .filter(|p| args.iter().any(|(q, _)| q == *p))
                    .flat_map(|p| get(p).lanes)
                    .collect(),
            ),
            "index" => Fact::of(vec![get("a").hull()]),
            "with" => {
                let v = get("v").hull();
                Fact::of(get("a").lanes.into_iter().map(|l| l.hull(v)).collect())
            }
            "transpose" => Fact::of(vec![get("x").hull()]),
            "luminance" => {
                let c = get("rgb").splat(3);
                finite(&c)?;
                let w = [0.2126, 0.7152, 0.0722];
                let mut sum = Iv::point(0.0);
                for (i, w) in w.iter().enumerate() {
                    sum = sum.add(c.lanes[i].iv().mul(Iv::point(*w)));
                }
                Fact::of(vec![Lane::of(sum.widen(2))])
            }
            "ddx" | "ddy" | "fwidth" => {
                let x = get("x");
                finite(&x)?;
                Fact::of(
                    x.lanes
                        .iter()
                        .map(|l| {
                            let w = l.hi - l.lo;
                            if op == "fwidth" {
                                Lane::range(0.0, 2.0 * w)
                            } else {
                                Lane::range(-w, w)
                            }
                        })
                        .collect(),
                )
            }
            "noise" | "noise3" => Fact::of(vec![Lane::range(-2.0, 2.0)]),
            "fbm" => Fact::of(vec![Lane::range(-4.0, 4.0)]),
            "rand" | "role" | "screen_uv" => Fact::of(vec![Lane::range(0.0, 1.0)]),
            "cells" => Fact::of(vec![Lane::range(0.0, 4.0)]),
            "spline" => {
                finite(&get("x"))?;
                let points = s
                    .fields
                    .get("points")
                    .and_then(|p| deep_canvas::steps::spline_points(p).ok())
                    .ok_or(Why::Unknown)?;
                let h = points
                    .iter()
                    .fold(Iv::EMPTY, |r, q| r.hull(Iv::point(q[1])));
                Fact::of(vec![Lane::of(h.widen(8)).widen32(2)])
            }
            "screen_size" => Fact::of(vec![Lane::range(1.0, MAX_SIDE)]),
            "t" => Fact::of(vec![Lane::range(0.0, 1e7)]),
            "normal" | "tangent" => Fact::of(vec![Lane::range(-1.0, 1.0)]),
            "camera" | "position" | "uv0" => Fact::of(vec![Lane::range(-F32_MAX, F32_MAX)]),
            "sample" | "sample_grad" | "load" | "sample3d" | "load3d" | "read" => {
                let port = if op == "read" { "buf" } else { "tex" };
                for (p, f) in args {
                    if p != port {
                        finite(f)?;
                    }
                }
                let tex = match s.args.get(port) {
                    Some(Arg::Ref(name, None)) => self.facts.get(name).cloned(),
                    _ => None,
                }
                .unwrap_or_else(|| Fact::top(4));
                tex.finite_part()
            }
            _ => return Err(Why::Unknown),
        };
        Ok(out.splat(n))
    }

    fn arg_ty(&self, s: &Step, port: &str) -> Option<Ty> {
        match s.args.get(port)? {
            Arg::Lit(v) => crate::check::literal(v),
            other => self.name_of(other).and_then(|k| self.types.get(&k).cloned()),
        }
    }
}

fn pick(s: &Step, x: &Fact) -> Fact {
    let pick = s.fields.get("pick").and_then(Value::as_str).unwrap_or("x");
    Fact::of(
        pick.chars()
            .map(|c| {
                let i = "xyzw".find(c).or_else(|| "rgba".find(c)).unwrap_or(0);
                x.lanes.get(i).copied().unwrap_or(Lane::TOP)
            })
            .collect(),
    )
}

pub fn prove(c: &Checked, options: CheckOptions) -> Verdict {
    prove_parts(&c.op, &c.order, &c.body_order, &c.types, options)
}

pub(crate) fn prove_parts(
    op: &Operator,
    order: &[String],
    bodies: &BTreeMap<String, Vec<String>>,
    types: &BTreeMap<String, Ty>,
    options: CheckOptions,
) -> Verdict {
    let mut env = Env {
        op,
        types,
        facts: BTreeMap::new(),
        accs: Vec::new(),
        origin: BTreeMap::new(),
        options,
        issues: Vec::new(),
    };
    for (name, input) in &op.inputs {
        env.facts.insert(name.clone(), seed(input, options));
    }
    env.steps(&op.steps, order, bodies);
    if env.issues.is_empty() {
        Verdict::Proven
    } else {
        Verdict::Unproven(env.issues)
    }
}

pub fn first_party(op: &Operator) -> bool {
    op.origin != Origin::Composed
}

pub fn verdict(op: &Value) -> Result<Verdict, Vec<Issue>> {
    let mut o = graph::read(op)?;
    o.origin = Origin::Shipped;
    crate::check::check(&o).map(|c| c.values)
}

pub fn ledger() -> Value {
    serde_json::from_str(include_str!("values_ledger.json")).expect("the values ledger is JSON")
}

fn release_issue(code: &str, operator: &str, what: String) -> Value {
    json!({"code": code, "severity": "error", "operator": operator, "what": what})
}

const GUARDS: &[&str] = &["max@1", "min@1", "clamp@1"];

fn step_maps(v: &Value, path: &mut Vec<String>, out: &mut Vec<Vec<String>>) {
    match v {
        Value::Object(o) => {
            let holds = path.last().is_some_and(|k| k == "steps" || k == "body");
            if holds && o.values().any(|s| s.get("op").and_then(Value::as_str).is_some()) {
                out.push(path.clone());
            }
            for (k, x) in o {
                path.push(k.clone());
                step_maps(x, path, out);
                path.pop();
            }
        }
        Value::Array(a) => {
            for (i, x) in a.iter().enumerate() {
                path.push(i.to_string());
                step_maps(x, path, out);
                path.pop();
            }
        }
        _ => {}
    }
}

fn at_path<'a>(v: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter().try_fold(v, |v, k| match v {
        Value::Array(a) => a.get(k.parse::<usize>().ok()?),
        _ => v.get(k),
    })
}

fn at_path_mut<'a>(v: &'a mut Value, path: &[String]) -> Option<&'a mut Value> {
    path.iter().try_fold(v, |v, k| match v {
        Value::Array(a) => a.get_mut(k.parse::<usize>().ok()?),
        _ => v.get_mut(k),
    })
}

fn rewired(v: &Value, from: &str, to: &str) -> Value {
    match v {
        Value::String(s) if s == from || s.starts_with(&format!("{from}.")) => json!(to),
        Value::Array(a) => Value::Array(a.iter().map(|x| rewired(x, from, to)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), rewired(x, from, to)))
                .collect::<Map<_, _>>(),
        ),
        other => other.clone(),
    }
}

fn ablations(op: &Value) -> Vec<String> {
    let mut maps = Vec::new();
    step_maps(op, &mut Vec::new(), &mut maps);
    let consts: Vec<String> = maps
        .iter()
        .filter_map(|p| at_path(op, p).and_then(Value::as_object))
        .flat_map(|m| m.iter())
        .filter(|(_, s)| s["op"] == "const@1")
        .map(|(id, _)| id.clone())
        .collect();
    let mut out = Vec::new();
    for path in &maps {
        let Some(m) = at_path(op, path).and_then(Value::as_object) else {
            continue;
        };
        for (id, s) in m {
            if !s["op"].as_str().is_some_and(|o| GUARDS.contains(&o)) {
                continue;
            }
            let args = s["args"].as_object().cloned().unwrap_or_default();
            let ports: Vec<&String> = if s["op"] == "clamp@1" {
                args.keys().filter(|k| *k == "x").collect()
            } else {
                args.keys().collect()
            };
            let kept: Vec<String> = ports
                .iter()
                .filter_map(|p| args[p.as_str()].as_str())
                .filter(|a| !consts.iter().any(|c| c == a))
                .map(str::to_string)
                .collect();
            let [keep] = kept.as_slice() else {
                continue;
            };
            let mut ablated = op.clone();
            let removed = at_path_mut(&mut ablated, path)
                .and_then(Value::as_object_mut)
                .and_then(|m| m.remove(id));
            if removed.is_none() {
                continue;
            }
            if let Ok(Verdict::Unproven(_)) = verdict(&rewired(&ablated, id, keep)) {
                out.push(id.clone());
            }
        }
    }
    out
}

pub fn release_run(operators: &[Value], ledger: &Value, today: &str) -> Value {
    let mut issues = Vec::new();
    let mut rows: BTreeMap<String, &Value> = BTreeMap::new();
    for r in ledger.as_array().map(Vec::as_slice).unwrap_or_default() {
        let operator = r["operator"].as_str().unwrap_or_default();
        let whole = ["reason", "owner", "ends"]
            .iter()
            .all(|k| r[*k].as_str().is_some_and(|s| !s.is_empty()));
        if !whole {
            issues.push(release_issue(
                "values.ledger_row",
                operator,
                format!("the ledger row for {operator} needs a reason, an owner and an end date"),
            ));
        }
        rows.insert(operator.to_string(), r);
    }
    let mut ablated = Vec::new();
    for op in operators {
        let id = op["id"].as_str().unwrap_or_default();
        let row = rows.get(id);
        match verdict(op) {
            Err(e) => issues.push(release_issue(
                "values.unchecked",
                id,
                format!(
                    "{id} doesn't reach the values stage: {}",
                    e.iter().map(|i| i.code).collect::<Vec<_>>().join(", ")
                ),
            )),
            Ok(Verdict::Proven) => {
                if row.is_some() {
                    issues.push(release_issue(
                        "values.ledger_needless",
                        id,
                        format!("{id} is proven: its ledger row goes"),
                    ));
                }
                for guard in ablations(op) {
                    ablated.push(json!({"operator": id, "guard": guard, "verdict": "unproven"}));
                }
            }
            Ok(Verdict::Unproven(why)) => {
                let steps: Vec<String> = why.iter().filter_map(|i| i.step.clone()).collect();
                match row.and_then(|r| r["ends"].as_str()) {
                    None => issues.push(release_issue(
                        "values.unledgered",
                        id,
                        format!(
                            "{id} is unproven (steps {}) and on no ledger row",
                            steps.join(", ")
                        ),
                    )),
                    Some(ends) if ends < today => issues.push(release_issue(
                        "values.ledger_expired",
                        id,
                        format!("{id}'s ledger row ended {ends}, before {today}"),
                    )),
                    Some(_) => {}
                }
            }
        }
    }
    json!({"issues": issues, "ablations": ablated})
}
