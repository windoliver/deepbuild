//! Seeded random well-typed step graphs (canvas primitives: Compile, validate and cache: "10,000
//! seeded random well-typed graphs of up to 64 steps, with repeats, selects and swizzles"). Each
//! graph is a compute operator over [`ELEMENTS`] elements that reads seeded storage and two
//! params, runs up to 64 public steps (repeats of fixed counts at most 64, nested at most 2 deep,
//! selects, compares, swizzles that pick 2 to 4 lanes, integer and bit steps, conversions and
//! transcendentals) and writes every lane of its last value and a few others to storage at its
//! own index.
//!
//! Each value carries its enclosure over every element ([`super::bound::apply`] on its
//! arguments'), so a step is chosen only where its domain holds on every element: no divide by a
//! value that can be zero, no log of one that can be negative, no float past what f32 holds. A
//! repeat's float accumulators end each trip in a clamp, a fract, a sine or a cosine, so their
//! enclosure is known before the body is written.

use serde_json::{json, Map, Value};

use deep_canvas_effects::graph::{Sc, Ty};

use super::bound::{apply, full, L, R, W};

/// Elements per generated graph.
pub const ELEMENTS: u32 = 64;
/// Words each storage input holds per element.
const PER: u32 = 4;
/// The most steps a graph holds, every body's counted.
pub const MAX_STEPS: usize = 64;
/// The largest magnitude a float value may reach, on every element.
const LIMIT: f64 = 1e6;

/// splitmix64.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9e37_79b9_7f4a_7c15)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }

    fn chance(&mut self, p: f64) -> bool {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 <= p
    }

    fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[self.below(v.len() as u64) as usize]
    }
}

/// A value a step can read: its reference, its type and its enclosure over every element.
#[derive(Clone, Debug)]
struct Val {
    name: String,
    ty: Ty,
    iv: L,
    /// An accumulator of the innermost repeat, visible only in its own body.
    acc: bool,
}

impl Val {
    fn sc(&self) -> Sc {
        match self.ty {
            Ty::V(sc, _) => sc,
            _ => Sc::F32,
        }
    }

    fn n(&self) -> u8 {
        match self.ty {
            Ty::V(_, n) => n,
            _ => 1,
        }
    }

    fn w(&self) -> W {
        W::N(self.sc(), self.iv)
    }
}

/// One generated graph: its operator, its seed, its storage inputs' words and what it holds.
pub struct Graph {
    pub seed: u64,
    pub op: Value,
    pub steps: usize,
    pub repeat: bool,
    pub select: bool,
    pub swizzle: bool,
    /// The storage inputs: `xf` (f32) and `xu` (u32), [`PER`] words per element.
    pub xf: Vec<f64>,
    pub xu: Vec<f64>,
}

struct Scope {
    steps: Map<String, Value>,
    pool: Vec<Val>,
}

struct B<'r> {
    rng: &'r mut Rng,
    n: usize,
    reps: usize,
    scopes: Vec<Scope>,
    depth: usize,
    trips: u32,
    select: bool,
    swizzle: bool,
    repeat: bool,
}

fn ty(sc: Sc, n: u8) -> Ty {
    Ty::V(sc, n)
}

/// Every lane finite and within [`LIMIT`] (floats), or anything an integer holds.
fn bounded(w: &W) -> bool {
    match w {
        W::N(Sc::F32, l) => l.lanes().iter().all(|r| !r.top() && r.mag() <= LIMIT),
        W::N(..) => true,
        _ => false,
    }
}

/// A float literal on a 1/16 grid, which f32 holds exactly.
fn flit(rng: &mut Rng, span: i64) -> f64 {
    (rng.below((2 * span * 16 + 1) as u64) as i64 - span * 16) as f64 / 16.0
}

impl B<'_> {
    fn visible(&self) -> Vec<Val> {
        let last = self.scopes.len() - 1;
        self.scopes
            .iter()
            .enumerate()
            .flat_map(|(k, s)| s.pool.iter().filter(move |v| !v.acc || k == last))
            .cloned()
            .collect()
    }

    /// A visible value `ok` accepts, the more recent the likelier.
    fn pick(&mut self, ok: impl Fn(&Val) -> bool) -> Option<Val> {
        let all: Vec<Val> = self.visible().into_iter().filter(|v| ok(v)).collect();
        if all.is_empty() {
            return None;
        }
        let k = if self.rng.chance(0.6) {
            all.len() - 1 - self.rng.below(all.len().min(6) as u64) as usize
        } else {
            self.rng.below(all.len() as u64) as usize
        };
        Some(all[k].clone())
    }

    fn id(&mut self) -> String {
        self.n += 1;
        format!("s{}", self.n)
    }

    /// Adds a step whose value is `iv` to the innermost scope.
    fn add(&mut self, id: String, step: Value, t: Ty, iv: W) -> Val {
        let v = Val {
            name: id.clone(),
            ty: t,
            iv: iv.l(),
            acc: false,
        };
        let s = self.scopes.last_mut().expect("a scope");
        s.steps.insert(id, step);
        s.pool.push(v.clone());
        v
    }

    /// `op` over `args` (port, value or literal), typed `t`, kept only when its enclosure is
    /// bounded.
    fn try_op(&mut self, op: &str, args: Vec<(&str, Arg)>, fields: Value, t: Ty) -> Option<Val> {
        let typed: Vec<(&str, W, Ty)> = args.iter().map(|(p, a)| (*p, a.w(), a.ty())).collect();
        let name = op.trim_end_matches("@1");
        let fmap = fields.as_object().cloned().unwrap_or_default();
        let out = apply(name, &fmap, &t, &typed)?;
        if !bounded(&out) {
            return None;
        }
        let mut a = fmap;
        for (p, arg) in &args {
            a.insert((*p).to_string(), arg.json());
        }
        let id = self.id();
        Some(self.add(id, json!({"op": op, "args": a}), t, out))
    }

    fn lit_for(&mut self, sc: Sc) -> Arg {
        match sc {
            Sc::F32 => Arg::F(flit(self.rng, 4)),
            Sc::Bool => Arg::B(self.rng.chance(0.5)),
            _ => Arg::I(self.rng.below(40) as i64),
        }
    }

    /// A second operand for `a`: a value of its type, a scalar of its scalar type, or a literal.
    fn second(&mut self, a: &Val) -> Arg {
        let (sc, n) = (a.sc(), a.n());
        if self.rng.chance(0.25) {
            return self.lit_for(sc);
        }
        match self.pick(|v| v.sc() == sc && (v.n() == n || v.n() == 1)) {
            Some(v) => Arg::V(v),
            None => self.lit_for(sc),
        }
    }

    fn float(&mut self, ok: impl Fn(&Val) -> bool) -> Option<Val> {
        self.pick(|v| v.sc() == Sc::F32 && ok(v))
    }

    /// One random step from what's visible; false when the one tried didn't fit.
    fn step(&mut self) -> bool {
        let lanes_ok = |v: &Val, f: &dyn Fn(R) -> bool| v.iv.lanes().iter().all(|r| f(*r));
        match self.rng.below(22) {
            0..=3 => {
                let Some(a) = self.float(|_| true) else {
                    return false;
                };
                let op = *self
                    .rng
                    .pick(&["add@1", "sub@1", "mul@1", "min@1", "max@1"]);
                let b = self.second(&a);
                let t = ty(Sc::F32, a.n().max(b.n()));
                self.try_op(op, vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                    .is_some()
            }
            4 => {
                let Some(a) = self.float(|_| true) else {
                    return false;
                };
                let op = *self.rng.pick(&["div@1", "mod@1", "rem@1"]);
                let Some(b) = self.float(|v| {
                    (v.n() == a.n() || v.n() == 1) && lanes_ok(v, &|r| r.lo > 0.05 || r.hi < -0.05)
                }) else {
                    let k = flit(self.rng, 4);
                    if k.abs() < 0.25 {
                        return false;
                    }
                    let t = ty(Sc::F32, a.n());
                    return self
                        .try_op(op, vec![("a", Arg::V(a)), ("b", Arg::F(k))], json!({}), t)
                        .is_some();
                };
                let t = ty(Sc::F32, a.n().max(b.n()));
                self.try_op(op, vec![("a", Arg::V(a)), ("b", Arg::V(b))], json!({}), t)
                    .is_some()
            }
            5..=7 => {
                let (op, ok): (&str, &dyn Fn(R) -> bool) = match self.rng.below(17) {
                    0 => ("sqrt@1", &|r: R| r.lo >= 0.0),
                    1 => ("inverse_sqrt@1", &|r: R| r.lo >= 0.05),
                    2 => ("log@1", &|r: R| r.lo >= 0.05),
                    3 => ("log2@1", &|r: R| r.lo >= 0.05),
                    4 => ("exp@1", &|r: R| r.mag() <= 10.0),
                    5 => ("exp2@1", &|r: R| r.mag() <= 12.0),
                    6 => ("sin@1", &|r: R| r.mag() <= 64.0),
                    7 => ("cos@1", &|r: R| r.mag() <= 64.0),
                    8 => ("tan@1", &|r: R| r.mag() <= 1.2),
                    9 => ("asin@1", &|r: R| r.mag() <= 1.0),
                    10 => ("acos@1", &|r: R| r.mag() <= 1.0),
                    11 => ("atan@1", &|_| true),
                    12 => ("floor@1", &|_| true),
                    13 => ("fract@1", &|_| true),
                    14 => ("round@1", &|_| true),
                    15 => ("abs@1", &|_| true),
                    _ => ("neg@1", &|_| true),
                };
                let Some(x) = self.float(|v| lanes_ok(v, ok)) else {
                    return false;
                };
                let t = x.ty.clone();
                self.try_op(op, vec![("x", Arg::V(x))], json!({}), t)
                    .is_some()
            }
            8 => {
                let Some(a) = self.float(|v| lanes_ok(v, &|r| r.lo >= 0.05 && r.hi <= 64.0)) else {
                    return false;
                };
                let b = match self
                    .float(|v| (v.n() == a.n() || v.n() == 1) && lanes_ok(v, &|r| r.mag() <= 4.0))
                {
                    Some(b) if self.rng.chance(0.6) => Arg::V(b),
                    _ => Arg::F(flit(self.rng, 3)),
                };
                let t = ty(Sc::F32, a.n().max(b.n()));
                self.try_op("pow@1", vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                    .is_some()
            }
            9 => {
                let Some(x) = self.float(|_| true) else {
                    return false;
                };
                let t = x.ty.clone();
                match self.rng.below(3) {
                    0 => {
                        let lo = flit(self.rng, 4);
                        let hi = lo + 0.25 + flit(self.rng, 4).abs();
                        self.try_op(
                            "clamp@1",
                            vec![("x", Arg::V(x)), ("lo", Arg::F(lo)), ("hi", Arg::F(hi))],
                            json!({}),
                            t,
                        )
                        .is_some()
                    }
                    1 => {
                        let lo = flit(self.rng, 4);
                        let hi = lo + 0.5 + flit(self.rng, 4).abs();
                        self.try_op(
                            "smoothstep@1",
                            vec![("lo", Arg::F(lo)), ("hi", Arg::F(hi)), ("x", Arg::V(x))],
                            json!({}),
                            t,
                        )
                        .is_some()
                    }
                    _ => {
                        let n = x.n();
                        let Some(b) = self.float(|v| v.n() == n || v.n() == 1) else {
                            return false;
                        };
                        let tt = match self.float(|v| {
                            (v.n() == n || v.n() == 1)
                                && lanes_ok(v, &|r| r.lo >= 0.0 && r.hi <= 1.0)
                        }) {
                            Some(v) => Arg::V(v),
                            None => Arg::F((self.rng.below(17) as f64) / 16.0),
                        };
                        self.try_op(
                            "mix@1",
                            vec![("a", Arg::V(x)), ("b", Arg::V(b)), ("t", tt)],
                            json!({}),
                            t,
                        )
                        .is_some()
                    }
                }
            }
            10 => {
                let Some(a) = self.float(|v| v.n() >= 2) else {
                    return false;
                };
                let n = a.n();
                match self.rng.below(5) {
                    0 => self
                        .try_op("length@1", vec![("x", Arg::V(a))], json!({}), Ty::F32)
                        .is_some(),
                    1 => {
                        let Some(b) = self.float(|v| v.n() == n) else {
                            return false;
                        };
                        self.try_op(
                            "distance@1",
                            vec![("a", Arg::V(a)), ("b", Arg::V(b))],
                            json!({}),
                            Ty::F32,
                        )
                        .is_some()
                    }
                    2 => {
                        let Some(b) = self.float(|v| v.n() == n) else {
                            return false;
                        };
                        self.try_op(
                            "dot@1",
                            vec![("a", Arg::V(a)), ("b", Arg::V(b))],
                            json!({}),
                            Ty::F32,
                        )
                        .is_some()
                    }
                    3 if n == 3 => {
                        let Some(b) = self.float(|v| v.n() == 3) else {
                            return false;
                        };
                        self.try_op(
                            "cross@1",
                            vec![("a", Arg::V(a)), ("b", Arg::V(b))],
                            json!({}),
                            ty(Sc::F32, 3),
                        )
                        .is_some()
                    }
                    _ => {
                        // normalize only what can't be near zero length on any element.
                        let far =
                            a.iv.lanes()
                                .iter()
                                .map(|r| {
                                    if r.lo > 0.0 {
                                        r.lo
                                    } else if r.hi < 0.0 {
                                        -r.hi
                                    } else {
                                        0.0
                                    }
                                })
                                .fold(0.0, f64::max);
                        if far < 0.05 {
                            return false;
                        }
                        let t = a.ty.clone();
                        self.try_op("normalize@1", vec![("x", Arg::V(a))], json!({}), t)
                            .is_some()
                    }
                }
            }
            11 | 12 => {
                let Some(a) = self.pick(|v| matches!(v.sc(), Sc::U32 | Sc::I32)) else {
                    return false;
                };
                let sc = a.sc();
                let t = a.ty.clone();
                match self.rng.below(12) {
                    k @ 0..=5 => {
                        let op = ["add@1", "sub@1", "mul@1", "and@1", "or@1", "xor@1"][k as usize];
                        let b = self.second(&a);
                        let t = ty(sc, a.n().max(b.n()));
                        self.try_op(op, vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                            .is_some()
                    }
                    6 => {
                        let op = *self.rng.pick(&["shl@1", "shr@1"]);
                        let b = match self.pick(|v| v.ty == Ty::U32) {
                            Some(v) if self.rng.chance(0.4) => Arg::V(v),
                            _ => Arg::I(self.rng.below(32) as i64),
                        };
                        self.try_op(op, vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                            .is_some()
                    }
                    7 => {
                        let op = *self.rng.pick(&["div@1", "rem@1", "min@1", "max@1"]);
                        let b = Arg::I(1 + self.rng.below(97) as i64);
                        self.try_op(op, vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                            .is_some()
                    }
                    8 => {
                        let op = *self.rng.pick(&[
                            "not@1",
                            "count_ones@1",
                            "first_leading_bit@1",
                            "first_trailing_bit@1",
                        ]);
                        self.try_op(op, vec![("x", Arg::V(a))], json!({}), t)
                            .is_some()
                    }
                    9 if sc == Sc::I32 => {
                        let op = *self.rng.pick(&["abs@1", "neg@1", "sign@1"]);
                        self.try_op(op, vec![("x", Arg::V(a))], json!({}), t)
                            .is_some()
                    }
                    _ => {
                        let mut args = vec![("a", Arg::V(a.clone()))];
                        for port in ["b", "c", "d"] {
                            if self.rng.chance(0.5) {
                                break;
                            }
                            match self.pick(|v| matches!(v.ty, Ty::V(Sc::U32 | Sc::I32, 1))) {
                                Some(v) => args.push((port, Arg::V(v))),
                                None => args.push((port, Arg::I(self.rng.below(1000) as i64))),
                            }
                        }
                        if a.n() != 1 {
                            return false;
                        }
                        self.try_op("hash@1", args, json!({}), Ty::U32).is_some()
                    }
                }
            }
            13 => {
                // A compare, of floats or of integers.
                let Some(a) = self.pick(|v| v.sc() != Sc::Bool) else {
                    return false;
                };
                let op = *self
                    .rng
                    .pick(&["eq@1", "ne@1", "lt@1", "le@1", "gt@1", "ge@1"]);
                let b = self.second(&a);
                let t = ty(Sc::Bool, a.n().max(b.n()));
                self.try_op(op, vec![("a", Arg::V(a)), ("b", b)], json!({}), t)
                    .is_some()
            }
            14 => {
                let Some(a) = self.pick(|v| v.sc() == Sc::Bool) else {
                    return false;
                };
                let n = a.n();
                match self.rng.below(3) {
                    0 if n >= 2 => {
                        let op = *self.rng.pick(&["all@1", "any@1"]);
                        self.try_op(op, vec![("x", Arg::V(a))], json!({}), Ty::BOOL)
                            .is_some()
                    }
                    1 => self
                        .try_op("not@1", vec![("x", Arg::V(a))], json!({}), ty(Sc::Bool, n))
                        .is_some(),
                    _ => {
                        let Some(b) = self.pick(|v| v.sc() == Sc::Bool && v.n() == n) else {
                            return false;
                        };
                        let op = *self.rng.pick(&["and@1", "or@1", "xor@1"]);
                        self.try_op(
                            op,
                            vec![("a", Arg::V(a)), ("b", Arg::V(b))],
                            json!({}),
                            ty(Sc::Bool, n),
                        )
                        .is_some()
                    }
                }
            }
            15 | 16 => {
                let Some(c) = self.pick(|v| v.sc() == Sc::Bool) else {
                    return false;
                };
                let n = c.n();
                let Some(f) = self.pick(|v| v.sc() != Sc::Bool && (n == 1 || v.n() == n)) else {
                    return false;
                };
                let (sc, fnn) = (f.sc(), f.n());
                let t = match self.pick(|v| v.sc() == sc && v.n() == fnn && v.name != f.name) {
                    Some(v) => Arg::V(v),
                    None => self.lit_for(sc),
                };
                self.select = self
                    .try_op(
                        "select@1",
                        vec![("f", Arg::V(f)), ("t", t), ("cond", Arg::V(c))],
                        json!({}),
                        ty(sc, fnn),
                    )
                    .is_some()
                    || self.select;
                true
            }
            17 => {
                // A conversion or a bitcast.
                let Some(x) = self.pick(|_| true) else {
                    return false;
                };
                let (sc, n) = (x.sc(), x.n());
                let in_range = |lo: f64, hi: f64| {
                    x.iv.lanes()
                        .iter()
                        .all(|r| !r.top() && r.lo > lo && r.hi < hi)
                };
                let to = match (sc, self.rng.below(3)) {
                    (Sc::F32, 0) if in_range(-1.0, 4.0e9) => Sc::U32,
                    (Sc::F32, _) if in_range(-2.0e9, 2.0e9) => Sc::I32,
                    (Sc::F32, _) => return false,
                    (Sc::U32, 0) => Sc::I32,
                    (Sc::I32, 0) => Sc::U32,
                    (Sc::Bool, 0) => Sc::U32,
                    _ => Sc::F32,
                };
                let bitcast = sc != Sc::Bool && to != Sc::F32 && self.rng.chance(0.3);
                let t = ty(to, n);
                let op = if bitcast { "bitcast@1" } else { "convert@1" };
                self.try_op(op, vec![("x", Arg::V(x))], json!({"to": t.wgsl()}), t)
                    .is_some()
            }
            18 => {
                // A swizzle: 1 to 4 lanes, repeats allowed.
                let Some(x) = self.pick(|v| v.n() >= 2) else {
                    return false;
                };
                let n = x.n() as u64;
                let len = 1 + self.rng.below(4);
                let set = if self.rng.chance(0.5) { "xyzw" } else { "rgba" };
                let pick: String = (0..len)
                    .map(|_| set.as_bytes()[self.rng.below(n) as usize] as char)
                    .collect();
                let t = ty(x.sc(), len as u8);
                let made = self
                    .try_op("split@1", vec![("x", Arg::V(x))], json!({"pick": pick}), t)
                    .is_some();
                self.swizzle |= made && len >= 2;
                made
            }
            19 => {
                // A compose of 2 to 4 lanes of one scalar type.
                let Some(a) = self.pick(|v| v.sc() != Sc::Bool && v.n() <= 3) else {
                    return false;
                };
                let sc = a.sc();
                let mut lanes = a.n();
                let mut args = vec![("x", Arg::V(a))];
                for port in ["y", "z", "w"] {
                    if lanes >= 4 || (lanes >= 2 && self.rng.chance(0.4)) {
                        break;
                    }
                    let room = 4 - lanes;
                    match self.pick(|v| v.sc() == sc && v.n() <= room) {
                        Some(v) => {
                            lanes += v.n();
                            args.push((port, Arg::V(v)));
                        }
                        None => break,
                    }
                }
                if lanes < 2 {
                    return false;
                }
                self.try_op("compose@1", args, json!({}), ty(sc, lanes))
                    .is_some()
            }
            20 => {
                let Some(k) = self.pick(|v| v.ty == Ty::U32) else {
                    return false;
                };
                self.try_op("rand@1", vec![("key", Arg::V(k))], json!({}), Ty::F32)
                    .is_some()
            }
            _ => {
                // A const.
                let n = 1 + self.rng.below(4) as u8;
                let (value, t) = match self.rng.below(3) {
                    0 => {
                        let v: Vec<f64> = (0..n).map(|_| flit(self.rng, 4)).collect();
                        (if n == 1 { json!(v[0]) } else { json!(v) }, ty(Sc::F32, n))
                    }
                    1 => (json!(self.rng.below(1 << 20)), Ty::U32),
                    _ => (json!(self.rng.below(2000) as i64 - 1000), Ty::I32),
                };
                let w = const_w(&value, &t);
                let id = self.id();
                let step = json!({"op": "const@1", "args": {"value": value, "type": t.wgsl()}});
                self.add(id, step, t, w);
                true
            }
        }
    }

    /// A repeat of a fixed count with one or two accumulators, its body generated in its own
    /// scope, perhaps with a nested repeat and an early stop.
    fn repeat(&mut self, budget: usize) -> bool {
        if self.depth >= 2 || budget < 4 {
            return false;
        }
        let max = (256 / self.trips).min(64);
        if max == 0 {
            return false;
        }
        let count = 1 + self.rng.below(u64::from(max)) as u32;
        let rid = self.id();
        let index = format!("i{}", self.depth);
        // Each accumulator: its name, type, initial value, the op that ends its trip, and its
        // enclosure over every trip.
        let mut accs: Vec<(String, Ty, Value, &str, R)> = Vec::new();
        for _ in 0..(1 + self.rng.below(2)) {
            self.reps += 1;
            let name = format!("a{}", self.reps);
            if self.rng.chance(0.75) {
                let n = 1 + self.rng.below(4) as u8;
                let t = ty(Sc::F32, n);
                let (init, iv) = match self.float(|v| v.n() == n || v.n() == 1) {
                    Some(v) if self.rng.chance(0.6) => {
                        let iv =
                            v.iv.lanes()
                                .iter()
                                .copied()
                                .reduce(R::hull)
                                .unwrap_or(R::x(0.0));
                        (json!(v.name), iv)
                    }
                    _ => {
                        let x = flit(self.rng, 2);
                        (
                            if n == 1 {
                                json!(x)
                            } else {
                                json!(vec![x; n as usize])
                            },
                            R::x(x),
                        )
                    }
                };
                let end = *self.rng.pick(&["clamp", "fract", "sin", "cos"]);
                let range = match end {
                    "clamp" => R::new(-4.0, 4.0),
                    "fract" => R::new(0.0, 1.0),
                    _ => R::new(-1.0, 1.0),
                };
                accs.push((
                    name,
                    t,
                    init,
                    end,
                    iv.hull(range)
                        .hull(R::new(range.lo - 0.01, range.hi + 0.01)),
                ));
            } else {
                let init = match self.pick(|v| v.ty == Ty::U32) {
                    Some(v) => json!(v.name),
                    None => json!(self.rng.below(1000)),
                };
                accs.push((name, Ty::U32, init, "hash", full(Sc::U32)));
            }
        }
        self.n_body(&rid, count, &index, &accs, budget)
    }

    fn n_body(
        &mut self,
        rid: &str,
        count: u32,
        index: &str,
        accs: &[(String, Ty, Value, &str, R)],
        budget: usize,
    ) -> bool {
        let before = self.n;
        let mut pool = vec![Val {
            name: index.to_string(),
            ty: Ty::U32,
            iv: L::one(R::new(0.0, f64::from(count - 1))),
            acc: false,
        }];
        for (name, t, _, _, iv) in accs {
            let n = match t {
                Ty::V(_, n) => *n as usize,
                _ => 1,
            };
            pool.push(Val {
                name: name.clone(),
                ty: t.clone(),
                iv: L::of(&vec![*iv; n]),
                acc: true,
            });
        }
        self.scopes.push(Scope {
            steps: Map::new(),
            pool,
        });
        self.depth += 1;
        self.trips *= count;
        let room = budget.saturating_sub(1 + 2 * accs.len());
        let k = 1 + self.rng.below(room.clamp(1, 6) as u64) as usize;
        let mut made = 0;
        let mut tries = 0;
        while made < k && tries < 40 && self.n - before + 2 * accs.len() < budget {
            tries += 1;
            let nested = self.depth < 2 && self.rng.chance(0.12);
            let room = budget - (self.n - before) - 2 * accs.len();
            if (nested && self.repeat(room)) || (!nested && self.step()) {
                made += 1;
            }
        }
        // Each accumulator's next value: the body step named after it.
        for (name, t, _, end, _) in accs {
            let n = match t {
                Ty::V(_, n) => *n,
                _ => 1,
            };
            let step = if *t == Ty::U32 {
                let x = match self.pick(|v| v.ty == Ty::U32 && v.name != *name) {
                    Some(v) => json!(v.name),
                    None => json!(self.rng.below(1 << 16)),
                };
                let op = *self.rng.pick(&["hash@1", "add@1", "xor@1"]);
                json!({"op": op, "args": {"a": name, "b": x}})
            } else {
                let x = self
                    .float(|v| {
                        (v.n() == n || v.n() == 1) && v.iv.lanes().iter().all(|r| r.mag() <= 64.0)
                    })
                    .map_or(json!(name), |v| json!(v.name));
                match *end {
                    "clamp" => json!({"op": "clamp@1", "args": {"x": x, "lo": -4.0, "hi": 4.0}}),
                    "fract" => json!({"op": "fract@1", "args": {"x": x}}),
                    e => json!({"op": format!("{e}@1"), "args": {"x": x}}),
                }
            };
            // A next value of fewer lanes splats; one must be the accumulator's own lanes.
            self.n += 1;
            self.scopes
                .last_mut()
                .expect("a body")
                .steps
                .insert(name.clone(), step);
        }
        // An early stop: a bool the body made, or a compare made for it.
        let stop = if self.rng.chance(0.3) {
            let body = self.scopes.last().expect("a body");
            let own: Vec<String> = body
                .pool
                .iter()
                .filter(|v| v.ty == Ty::BOOL && body.steps.contains_key(&v.name))
                .map(|v| v.name.clone())
                .collect();
            match own.last() {
                Some(b) => Some(b.clone()),
                None => match self.pick(|v| v.ty == Ty::F32) {
                    Some(x) => {
                        let k = flit(self.rng, 2);
                        self.try_op(
                            "gt@1",
                            vec![("a", Arg::V(x)), ("b", Arg::F(k))],
                            json!({}),
                            Ty::BOOL,
                        )
                        .map(|v| v.name)
                    }
                    None => None,
                },
            }
        } else {
            None
        };
        let body = self.scopes.pop().expect("a body");
        self.depth -= 1;
        self.trips /= count;
        let mut accumulate = Map::new();
        for (name, t, init, _, _) in accs {
            accumulate.insert(name.clone(), json!({"type": t.wgsl(), "init": init}));
        }
        let mut args = json!({"count": count, "index": index, "accumulate": accumulate, "body": Value::Object(body.steps)});
        if let Some(s) = stop {
            args["stop_if"] = json!(s);
        }
        self.repeat = true;
        let parent = self.scopes.last_mut().expect("a scope");
        parent
            .steps
            .insert(rid.to_string(), json!({"op": "repeat@1", "args": args}));
        for (name, t, _, _, iv) in accs {
            let n = match t {
                Ty::V(_, n) => *n as usize,
                _ => 1,
            };
            parent.pool.push(Val {
                name: format!("{rid}.{name}"),
                ty: t.clone(),
                iv: L::of(&vec![*iv; n]),
                acc: false,
            });
        }
        true
    }
}

fn const_w(value: &Value, t: &Ty) -> W {
    match deep_canvas_effects::interp::typed_literal(value, t) {
        deep_canvas_effects::interp::Val::N(sc, l) => {
            W::N(sc, L::of(&l.iter().map(|x| R::x(*x)).collect::<Vec<_>>()))
        }
        _ => W::N(Sc::F32, L::one(R::x(0.0))),
    }
}

/// An argument: a value, or a literal.
#[derive(Clone, Debug)]
enum Arg {
    V(Val),
    F(f64),
    I(i64),
    B(bool),
}

impl Arg {
    fn json(&self) -> Value {
        match self {
            Arg::V(v) => json!(v.name),
            Arg::F(x) => json!(x),
            Arg::I(x) => json!(x),
            Arg::B(b) => json!(b),
        }
    }

    fn ty(&self) -> Ty {
        match self {
            Arg::V(v) => v.ty.clone(),
            Arg::F(_) => Ty::F32,
            Arg::I(_) => Ty::Int,
            Arg::B(_) => Ty::BOOL,
        }
    }

    fn n(&self) -> u8 {
        match self {
            Arg::V(v) => v.n(),
            _ => 1,
        }
    }

    fn w(&self) -> W {
        match self {
            Arg::V(v) => v.w(),
            Arg::F(x) => W::N(Sc::F32, L::one(R::x(*x))),
            Arg::I(x) => W::N(Sc::I32, L::one(R::x(*x as f64))),
            Arg::B(b) => W::N(Sc::Bool, L::one(R::x(f64::from(u8::from(*b))))),
        }
    }
}

/// The graph of `seed`.
pub fn graph(seed: u64, max_steps: usize) -> Graph {
    let mut rng = Rng::new(seed);
    let words = (ELEMENTS * PER) as usize;
    let xf: Vec<f64> = (0..words)
        .map(|_| (rng.below(1025) as i64 - 512) as f64 / 64.0)
        .collect();
    let xu: Vec<f64> = (0..words)
        .map(|_| {
            if rng.chance(0.5) {
                rng.below(256) as f64
            } else {
                (rng.next() as u32) as f64
            }
        })
        .collect();
    let pf: Vec<f64> = (0..4).map(|_| flit(&mut rng, 4)).collect();
    let pu = rng.below(1 << 16);
    let target = (8 + rng.below(57) as usize).min(max_steps.max(8));
    let mut b = B {
        rng: &mut rng,
        n: 0,
        reps: 0,
        scopes: vec![Scope {
            steps: Map::new(),
            pool: vec![
                Val {
                    name: "pf".into(),
                    ty: ty(Sc::F32, 4),
                    iv: L::of(&pf.iter().map(|x| R::x(*x)).collect::<Vec<_>>()),
                    acc: false,
                },
                Val {
                    name: "pu".into(),
                    ty: Ty::U32,
                    iv: L::one(R::x(pu as f64)),
                    acc: false,
                },
            ],
        }],
        depth: 0,
        trips: 1,
        select: false,
        swizzle: false,
        repeat: false,
    };
    // The leaves: the element, and storage read at it and further on.
    let e = b.id();
    b.add(
        e.clone(),
        json!({"op": "element@1", "args": {}}),
        Ty::U32,
        W::N(Sc::U32, L::one(R::new(0.0, f64::from(ELEMENTS - 1)))),
    );
    let fid = b.id();
    b.add(
        fid,
        json!({"op": "read@1", "args": {"buf": "xf", "i": e}}),
        Ty::F32,
        W::N(Sc::F32, L::one(R::new(-8.0, 8.0))),
    );
    let uid = b.id();
    b.add(
        uid,
        json!({"op": "read@1", "args": {"buf": "xu", "i": e}}),
        Ty::U32,
        W::N(Sc::U32, L::one(full(Sc::U32))),
    );
    if b.rng.chance(0.6) {
        let at = b.id();
        let k = (1 + b.rng.below(u64::from(PER) - 1)) * u64::from(ELEMENTS);
        b.add(
            at.clone(),
            json!({"op": "add@1", "args": {"a": e, "b": k}}),
            Ty::U32,
            W::N(
                Sc::U32,
                L::one(R::new(k as f64, (k + u64::from(ELEMENTS) - 1) as f64)),
            ),
        );
        let f2 = b.id();
        b.add(
            f2,
            json!({"op": "read@1", "args": {"buf": "xf", "i": at}}),
            Ty::F32,
            W::N(Sc::F32, L::one(R::new(-8.0, 8.0))),
        );
    }
    // The body of the graph, leaving room to write what it made.
    let mut tries = 0;
    while b.n + 8 < target && tries < 400 {
        tries += 1;
        let room = target - 8 - b.n;
        if b.rng.chance(0.08) {
            b.repeat(room.min(14));
        } else {
            b.step();
        }
    }
    // The sinks: the last value made and a few others, every lane written.
    let pool = b.scopes[0].pool.clone();
    let made: Vec<Val> = pool
        .iter()
        .filter(|v| v.name.starts_with('s') || v.name.contains('.'))
        .cloned()
        .collect();
    let mut sinks: Vec<Val> = made.iter().rev().take(1).cloned().collect();
    for _ in 0..3 {
        if made.is_empty() {
            break;
        }
        let v = made[b.rng.below(made.len() as u64) as usize].clone();
        if !sinks.iter().any(|s| s.name == v.name) {
            sinks.push(v);
        }
    }
    // Each lane costs a split (for a vector), a conversion (for an integer that isn't u32), an
    // index and a write.
    let mut lanes: Vec<(Val, u8)> = Vec::new();
    let mut cost = 2;
    for s in &sinks {
        for k in 0..s.n() {
            let c = 2 + usize::from(s.n() > 1) + usize::from(!matches!(s.sc(), Sc::F32 | Sc::U32));
            if b.n + cost + c > target.max(b.n + 6).min(max_steps) {
                break;
            }
            cost += c;
            lanes.push((s.clone(), k));
        }
    }
    if lanes.is_empty() {
        lanes.push((sinks[0].clone(), 0));
    }
    let nf = lanes.iter().filter(|(v, _)| v.sc() == Sc::F32).count() as u32;
    let nu = lanes.len() as u32 - nf;
    let mut base = Rows::default();
    let (mut kf, mut ku) = (0u32, 0u32);
    for (v, k) in &lanes {
        let float = v.sc() == Sc::F32;
        let (buf, per, slot) = if float {
            ("of", nf, &mut kf)
        } else {
            ("ou", nu, &mut ku)
        };
        let at = *slot;
        *slot += 1;
        let mut val = v.name.clone();
        if v.n() > 1 {
            let id = b.id();
            let lane = ["x", "y", "z", "w"][*k as usize];
            b.scopes[0].steps.insert(
                id.clone(),
                json!({"op": "split@1", "args": {"x": val, "pick": lane}}),
            );
            val = id;
        }
        if !float && v.sc() != Sc::U32 {
            let id = b.id();
            b.scopes[0].steps.insert(
                id.clone(),
                json!({"op": "convert@1", "args": {"x": val, "to": "u32"}}),
            );
            val = id;
        }
        let row = base.of(&mut b, &e, per);
        let i = if at == 0 {
            row
        } else {
            let id = b.id();
            b.scopes[0].steps.insert(
                id.clone(),
                json!({"op": "add@1", "args": {"a": row, "b": at}}),
            );
            id
        };
        let id = b.id();
        b.scopes[0].steps.insert(
            id,
            json!({"op": "write@1", "args": {"buf": buf, "i": i, "v": val}}),
        );
    }
    let mut outputs = Map::new();
    if nf > 0 {
        outputs.insert(
            "of".into(),
            json!({"storage": {"type": "f32", "count": ELEMENTS * nf}}),
        );
    }
    if nu > 0 {
        outputs.insert(
            "ou".into(),
            json!({"storage": {"type": "u32", "count": ELEMENTS * nu}}),
        );
    }
    let steps = b.n;
    let (repeat, select, swizzle) = (b.repeat, b.select, b.swizzle);
    let body = std::mem::take(&mut b.scopes[0].steps);
    let op = json!({
        "id": format!("gen.s{seed}"), "kind": "compute", "origin": "composed",
        "about": format!("Seeded random graph {seed} of the f64 interpreter's suite: well typed, every lane it makes written at its own index."),
        "inputs": {
            "xf": {"type": "f32", "count": words, "from": {"storage": {"op": "core", "output": "xf"}}},
            "xu": {"type": "u32", "count": words, "from": {"storage": {"op": "core", "output": "xu"}}},
            "pf": {"type": "vec4<f32>", "from": {"param": "gen.pf"}, "default": pf},
            "pu": {"type": "u32", "from": {"param": "gen.pu"}, "default": pu},
        },
        "steps": Value::Object(body),
        "outputs": Value::Object(outputs),
        "elements": ELEMENTS, "workgroup": 64,
        "cost": {"ns_per_element": 1000.0},
    });
    Graph {
        seed,
        op,
        steps,
        repeat,
        select,
        swizzle,
        xf,
        xu,
    }
}

/// The row index `element × per` each output's writes start from, made once per `per`.
#[derive(Default)]
struct Rows(Vec<(u32, String)>);

impl Rows {
    fn of(&mut self, b: &mut B<'_>, e: &str, per: u32) -> String {
        if per == 1 {
            return e.to_string();
        }
        if let Some((_, id)) = self.0.iter().find(|(p, _)| *p == per) {
            return id.clone();
        }
        let id = b.id();
        b.scopes[0].steps.insert(
            id.clone(),
            json!({"op": "mul@1", "args": {"a": e, "b": per}}),
        );
        self.0.push((per, id.clone()));
        id
    }
}
