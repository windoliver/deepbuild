//! The CPU interpreter of a checked graph, in f64 through the ops module (canvas primitives:
//! Compile, validate and cache: "test code holds a CPU interpreter of the step graph in f64").
//! It gives every step the meaning its WGSL has: integers wrap and divide as WGSL defines,
//! loads clamp into the texture, a sample is bilinear with clamped edges, and `hash@1` is the
//! same u32 permutation, so a pass run here is the reference its GPU output is held to.
//!
//! A graph is prepared once into slots, each step's arguments resolved to the slot or literal they
//! read, so a pixel's run allocates nothing.

use std::collections::BTreeMap;

use deep_canvas::ops;
use serde_json::Value;

use crate::check::{acc_key, key, Checked};
use crate::graph::{Arg, Body, Count, From, Sc, Step, Ty};

/// An input's value as the frame uploads it: lanes of a scalar type (integers and bools held
/// exactly), a column-major matrix, an array's elements, or a texture or storage input by name.
#[derive(Clone, Debug, PartialEq)]
pub enum Val {
    N(Sc, Vec<f64>),
    M(u8, Vec<f64>),
    A(Sc, Vec<Vec<f64>>),
    T(String),
}

/// An image a pass reads or writes: RGBA per pixel, rows top-down; an integer or depth texture
/// holds its value in the first lane.
#[derive(Clone, Debug, PartialEq)]
pub struct Image {
    pub w: u32,
    pub h: u32,
    pub px: Vec<[f64; 4]>,
}

impl Image {
    pub fn new(w: u32, h: u32) -> Image {
        Image {
            w,
            h,
            px: vec![[0.0; 4]; (w as usize) * (h as usize)],
        }
    }

    fn at(&self, x: i64, y: i64) -> [f64; 4] {
        let x = x.clamp(0, i64::from(self.w) - 1) as usize;
        let y = y.clamp(0, i64::from(self.h) - 1) as usize;
        self.px[y * self.w as usize + x]
    }

    /// Bilinear at uv with clamped edges, as the core's one sampler filters.
    pub fn sample(&self, uv: [f64; 2]) -> [f64; 4] {
        let x = uv[0] * f64::from(self.w) - 0.5;
        let y = uv[1] * f64::from(self.h) - 0.5;
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let (x0, y0) = (x0 as i64, y0 as i64);
        let (a, b, c, d) = (
            self.at(x0, y0),
            self.at(x0 + 1, y0),
            self.at(x0, y0 + 1),
            self.at(x0 + 1, y0 + 1),
        );
        let mut out = [0.0; 4];
        for i in 0..4 {
            let top = a[i] + (b[i] - a[i]) * fx;
            let bottom = c[i] + (d[i] - c[i]) * fx;
            out[i] = top + (bottom - top) * fy;
        }
        out
    }

    /// The next mip down: each texel the 2 × 2 box mean of the four above it, the last row or
    /// column clamped where the size is odd (the core's mip step).
    pub fn half(&self) -> Image {
        let (w, h) = ((self.w / 2).max(1), (self.h / 2).max(1));
        let mut out = Image::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let mut c = [0.0; 4];
                for k in 0..4 {
                    let p = self.at(i64::from(2 * x + (k & 1)), i64::from(2 * y + (k >> 1)));
                    for i in 0..4 {
                        c[i] += p[i] * 0.25;
                    }
                }
                out.px[(y * w + x) as usize] = c;
            }
        }
        out
    }

    /// Its mip chain down to 1 × 1, itself first.
    pub fn mips(&self) -> Vec<Image> {
        let mut out = vec![self.clone()];
        while out.last().is_some_and(|m| m.w > 1 || m.h > 1) {
            let next = out
                .last()
                .map(Image::half)
                .unwrap_or_else(|| Image::new(1, 1));
            out.push(next);
        }
        out
    }

    /// Trilinear at uv and mip level `lod`, clamped into the chain.
    pub fn sample_level(&self, uv: [f64; 2], lod: f64) -> [f64; 4] {
        let mips = self.mips();
        let lod = lod.clamp(0.0, (mips.len() - 1) as f64);
        let (l0, f) = (lod.floor() as usize, lod - lod.floor());
        let a = mips[l0].sample(uv);
        if f == 0.0 || l0 + 1 >= mips.len() {
            return a;
        }
        let b = mips[l0 + 1].sample(uv);
        std::array::from_fn(|i| a[i] + (b[i] - a[i]) * f)
    }

    /// At uv with the level its uv gradients give: log2 of the longer gradient in texels.
    pub fn sample_grad(&self, uv: [f64; 2], dx: [f64; 2], dy: [f64; 2]) -> [f64; 4] {
        let (w, h) = (f64::from(self.w), f64::from(self.h));
        let len2 = |d: [f64; 2]| (d[0] * w).powi(2) + (d[1] * h).powi(2);
        let rho2 = len2(dx).max(len2(dy));
        let lod = if rho2 > 0.0 { 0.5 * rho2.log2() } else { 0.0 };
        self.sample_level(uv, lod)
    }
}

/// What a frame hands a pass: the frame uniform's values, each non-texture input's value and
/// each texture input's image.
#[derive(Clone, Debug)]
pub struct Env<'a> {
    pub t: f64,
    pub seed: u32,
    /// Column-major.
    pub clip: [f64; 16],
    pub inverse_clip: [f64; 16],
    /// The camera's position and its near plane.
    pub eye: [f64; 4],
    pub inputs: BTreeMap<String, Val>,
    pub textures: BTreeMap<String, &'a Image>,
    /// A material's surface normal in object, world and view space, where `normal@1` reads it.
    pub normals: [[f64; 3]; 3],
}

/// The fixed hash, as [`crate::emit::HASH`] writes it.
pub fn hash1(x: u32) -> u32 {
    let s = x.wrapping_mul(747_796_405).wrapping_add(2_891_336_453);
    let w = ((s >> ((s >> 28) + 4)) ^ s).wrapping_mul(277_803_737);
    (w >> 22) ^ w
}

/// `hash@1` over its arguments in port order.
pub fn hash(args: &[u32]) -> u32 {
    let mut h = 0;
    for (i, a) in args.iter().enumerate() {
        h = if i == 0 { hash1(*a) } else { hash1(h ^ *a) };
    }
    h
}

fn wrap(sc: Sc, v: f64) -> f64 {
    match sc {
        Sc::U32 => f64::from(v.rem_euclid(4_294_967_296.0) as u32),
        Sc::I32 => f64::from(v.rem_euclid(4_294_967_296.0) as u32 as i32),
        Sc::Bool => f64::from(u8::from(v != 0.0)),
        Sc::F32 => v,
    }
}

/// A float as WGSL converts it to an integer: toward zero, saturated.
fn saturate(sc: Sc, v: f64) -> f64 {
    let t = v.trunc();
    match sc {
        Sc::U32 | Sc::I32 if v.is_nan() => 0.0,
        Sc::U32 => t.clamp(0.0, 4_294_967_295.0),
        Sc::I32 => t.clamp(-2_147_483_648.0, 2_147_483_647.0),
        Sc::Bool => f64::from(u8::from(v != 0.0)),
        Sc::F32 => v,
    }
}

/// Up to four lanes, held in place.
#[derive(Clone, Copy, Debug, PartialEq)]
struct L {
    v: [f64; 4],
    n: usize,
}

impl L {
    fn one(x: f64) -> L {
        L {
            v: [x, 0.0, 0.0, 0.0],
            n: 1,
        }
    }

    fn of(xs: &[f64]) -> L {
        let mut v = [0.0; 4];
        let n = xs.len().min(4);
        v[..n].copy_from_slice(&xs[..n]);
        L { v, n }
    }

    fn map(self, f: impl Fn(f64) -> f64) -> L {
        let mut o = self;
        for x in &mut o.v[..o.n] {
            *x = f(*x);
        }
        o
    }

    fn zip(self, b: L, f: impl Fn(f64, f64) -> f64) -> L {
        let mut o = self;
        for i in 0..o.n {
            o.v[i] = f(self.v[i], b.v[i]);
        }
        o
    }

    fn lanes(&self) -> &[f64] {
        &self.v[..self.n]
    }
}

/// A value while a graph runs: copied, never allocated.
#[derive(Clone, Copy, Debug)]
enum V {
    N(Sc, L),
    M(u8, [f64; 16]),
    /// An array in the run's table.
    A(usize),
    /// A texture or storage input in the run's tables.
    T(usize),
}

impl V {
    fn l(&self) -> L {
        match self {
            V::N(_, l) => *l,
            V::M(_, m) => L::of(&m[..4]),
            _ => L::one(0.0),
        }
    }

    fn sc(&self) -> Sc {
        match self {
            V::N(sc, _) => *sc,
            _ => Sc::F32,
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

/// `v` as `n` lanes of `sc`: a scalar splats, an integer converts to f32 exactly, a float to an
/// integer saturates.
fn as_l(v: V, sc: Sc, n: usize) -> L {
    let from = v.sc();
    let l = v.l();
    let mut o = L {
        v: [0.0; 4],
        n: n.max(1),
    };
    for i in 0..o.n {
        let x = if l.n == 1 { l.v[0] } else { l.v[i.min(3)] };
        o.v[i] = if from == Sc::F32 && sc != Sc::F32 {
            saturate(sc, x)
        } else {
            wrap(sc, x)
        };
    }
    o
}

fn round_even(x: f64) -> f64 {
    if (x - x.trunc()).abs() == 0.5 {
        2.0 * (x / 2.0).round()
    } else {
        x.round()
    }
}

fn bits(sc: Sc, a: f64, b: f64, f: impl Fn(u32, u32) -> u32) -> f64 {
    match sc {
        Sc::Bool => f64::from(f(u32::from(a != 0.0), u32::from(b != 0.0))),
        _ => f64::from(f(a as i64 as u32, b as i64 as u32)),
    }
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

fn f32r(x: f64) -> f64 {
    f64::from(x as f32)
}

/// A literal as the GPU holds it: f32 constants round to f32.
fn to_sc(sc: Sc, x: f64) -> f64 {
    match sc {
        Sc::F32 => f32r(x),
        other => wrap(other, x),
    }
}

fn num(x: &Value) -> f64 {
    x.as_f64()
        .or_else(|| x.as_bool().map(|b| f64::from(u8::from(b))))
        .unwrap_or(0.0)
}

/// An argument's literal: an integer, a float, a bool or a vector of floats.
fn literal(v: &Value) -> V {
    match v {
        Value::Bool(b) => V::N(Sc::Bool, L::one(f64::from(u8::from(*b)))),
        Value::Number(n) if n.is_i64() || n.is_u64() => V::N(Sc::I32, L::one(num(v))),
        Value::Number(_) => V::N(Sc::F32, L::one(num(v))),
        Value::Array(a) => V::N(Sc::F32, L::of(&a.iter().map(num).collect::<Vec<_>>())),
        _ => V::N(Sc::F32, L::one(0.0)),
    }
}

/// A const value or an input as its type, rounded to f32 where the GPU holds it in f32.
pub fn typed_literal(v: &Value, t: &Ty) -> Val {
    match t {
        Ty::V(sc, _) => {
            let lanes: Vec<f64> = match v {
                Value::Array(a) => a.iter().map(num).collect(),
                x => vec![num(x)],
            };
            Val::N(*sc, lanes.into_iter().map(|x| to_sc(*sc, x)).collect())
        }
        Ty::Mat(_) => Val::M(
            4,
            v.as_array()
                .map(|a| a.iter().map(|x| f32r(num(x))).collect())
                .unwrap_or_default(),
        ),
        Ty::Arr(sc, _, _) => Val::A(
            *sc,
            v.as_array()
                .map(|a| {
                    a.iter()
                        .map(|e| match e {
                            Value::Array(l) => l.iter().map(|x| to_sc(*sc, num(x))).collect(),
                            x => vec![to_sc(*sc, num(x))],
                        })
                        .collect()
                })
                .unwrap_or_default(),
        ),
        _ => Val::N(Sc::F32, vec![num(v)]),
    }
}

/// Where an argument comes from.
#[derive(Clone, Copy, Debug)]
enum Src {
    Slot(usize),
    Lit(V),
}

/// A step, prepared: its op's name, its output slot and type, and each argument's source and type.
struct P<'a> {
    id: &'a str,
    s: &'a Step,
    name: &'a str,
    out: usize,
    ty: Ty,
    args: Vec<(&'a str, Src, Ty)>,
    body: Option<PBody<'a>>,
}

struct PBody<'a> {
    count: Option<Src>,
    max: u32,
    /// Each accumulator: its slot, its type, its initial value and the body step that gives
    /// its next value; and the repeat's output port slot it ends in.
    accs: Vec<(usize, Ty, Src, usize, usize)>,
    index: usize,
    steps: Vec<P<'a>>,
    stop: Option<Src>,
}

/// A prepared graph: its slots, its steps in order, and the tables arrays and images sit in.
struct Prog<'a> {
    c: &'a Checked,
    slots: BTreeMap<String, usize>,
    steps: Vec<P<'a>>,
    base: Vec<V>,
    arrays: Vec<(Sc, Vec<[f64; 4]>)>,
    images: Vec<&'a Image>,
    /// Storage inputs and outputs by name, at their table index.
    storage: Vec<(String, Vec<f64>)>,
    size: [u32; 2],
    env: &'a Env<'a>,
    /// The fragment's own normal, where a material harness sweeps it per pixel.
    normal_at: Option<[f64; 3]>,
    /// Whether a `discard_if` fired in this fragment.
    discarded: bool,
}

fn slot(slots: &mut BTreeMap<String, usize>, name: &str) -> usize {
    let n = slots.len();
    *slots.entry(name.to_string()).or_insert(n)
}

impl<'a> Prog<'a> {
    fn new(
        c: &'a Checked,
        env: &'a Env<'a>,
        size: [u32; 2],
        storage: BTreeMap<String, Vec<f64>>,
    ) -> Result<Prog<'a>, String> {
        let mut p = Prog {
            c,
            slots: BTreeMap::new(),
            steps: Vec::new(),
            base: Vec::new(),
            arrays: Vec::new(),
            images: Vec::new(),
            storage: storage.into_iter().collect(),
            size,
            env,
            normal_at: None,
            discarded: false,
        };
        for (name, out) in &c.op.storage {
            if !p.storage.iter().any(|(n, _)| n == name) {
                p.storage
                    .push((name.clone(), vec![0.0; out.count as usize]));
            }
        }
        let mut base = BTreeMap::new();
        for (name, input) in &c.op.inputs {
            let s = slot(&mut p.slots, name);
            let v = match &input.from {
                From::Time => V::N(Sc::F32, L::one(env.t)),
                From::Seed => V::N(Sc::U32, L::one(f64::from(env.seed))),
                From::Target { .. } | From::Asset(_) => {
                    let img = env
                        .textures
                        .get(name)
                        .copied()
                        .ok_or_else(|| format!("no image for texture input {name}"))?;
                    p.images.push(img);
                    V::T(p.images.len() - 1)
                }
                From::Storage { .. } | From::Column { .. } | From::Attribute { .. } => {
                    let i = p
                        .storage
                        .iter()
                        .position(|(n, _)| n == name)
                        .ok_or_else(|| format!("no storage for input {name}"))?;
                    V::T(i)
                }
                _ => match env.inputs.get(name) {
                    Some(Val::N(sc, l)) => V::N(*sc, L::of(l)),
                    Some(Val::M(n, m)) => {
                        let mut a = [0.0; 16];
                        for (i, x) in m.iter().take(16).enumerate() {
                            a[i] = *x;
                        }
                        V::M(*n, a)
                    }
                    Some(Val::A(sc, items)) => {
                        p.arrays
                            .push((*sc, items.iter().map(|e| L::of(e).v).collect()));
                        V::A(p.arrays.len() - 1)
                    }
                    _ => V::N(Sc::F32, L::one(0.0)),
                },
            };
            base.insert(s, v);
        }
        let mut accs: Vec<Vec<String>> = Vec::new();
        p.steps = p.prepare(&c.op.steps, &c.order, &mut accs, &mut base)?;
        let n = p.slots.len();
        p.base = (0..n)
            .map(|i| base.get(&i).copied().unwrap_or(V::N(Sc::F32, L::one(0.0))))
            .collect();
        Ok(p)
    }

    fn src(&mut self, a: &Arg, accs: &[Vec<String>], base: &mut BTreeMap<usize, V>) -> Src {
        match a {
            Arg::Lit(v) => Src::Lit(literal(v)),
            Arg::Ref(name, None) if accs.last().is_some_and(|a| a.contains(name)) => {
                Src::Slot(slot(&mut self.slots, &acc_key(name)))
            }
            Arg::Ref(step, port) => {
                let k = key(step, port.as_deref());
                let s = slot(&mut self.slots, &k);
                base.entry(s).or_insert(V::N(Sc::F32, L::one(0.0)));
                Src::Slot(s)
            }
        }
    }

    fn prepare(
        &mut self,
        steps: &'a BTreeMap<String, Step>,
        order: &'a [String],
        accs: &mut Vec<Vec<String>>,
        base: &mut BTreeMap<usize, V>,
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
                    Arg::Lit(v) => crate::check::literal(v).unwrap_or(Ty::F32),
                };
                let src = self.src(a, accs, base);
                args.push((port.as_str(), src, ty));
            }
            let o = slot(&mut self.slots, id);
            let mut ty = c.types.get(id).cloned().unwrap_or(Ty::F32);
            if name == "const" {
                let v = s.fields.get("value").cloned().unwrap_or(Value::Null);
                // A const is evaluated once: its value sits in the base slots.
                let val = match typed_literal(&v, &ty) {
                    Val::N(sc, l) => V::N(sc, L::of(&l)),
                    Val::M(n, m) => {
                        let mut a = [0.0; 16];
                        for (i, x) in m.iter().take(16).enumerate() {
                            a[i] = *x;
                        }
                        V::M(n, a)
                    }
                    Val::A(sc, items) => {
                        self.arrays
                            .push((sc, items.iter().map(|e| L::of(e).v).collect()));
                        V::A(self.arrays.len() - 1)
                    }
                    Val::T(_) => V::N(Sc::F32, L::one(0.0)),
                };
                base.insert(o, val);
                continue;
            }
            let body = match &s.body {
                None => None,
                Some(b) => Some(self.body(id, b, accs, base)?),
            };
            if name == "repeat" {
                ty = Ty::F32;
            }
            out.push(P {
                id,
                s,
                name,
                out: o,
                ty,
                args,
                body,
            });
        }
        Ok(out)
    }

    fn body(
        &mut self,
        id: &'a str,
        b: &'a Body,
        accs: &mut Vec<Vec<String>>,
        base: &mut BTreeMap<usize, V>,
    ) -> Result<PBody<'a>, String> {
        let c = self.c;
        let (count, max) = match &b.count {
            Count::Const(n) => (Some(Src::Lit(V::N(Sc::U32, L::one(f64::from(*n))))), *n),
            Count::Input(name) => (
                Some(Src::Slot(slot(&mut self.slots, name))),
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

    fn get(&self, regs: &[V], src: Src) -> V {
        match src {
            Src::Slot(i) => regs[i],
            Src::Lit(v) => v,
        }
    }

    fn arg(&self, regs: &[V], p: &P<'_>, port: &str) -> (V, Ty) {
        p.args
            .iter()
            .find(|(n, _, _)| *n == port)
            .map(|(_, s, t)| (self.get(regs, *s), t.clone()))
            .unwrap_or((V::N(Sc::F32, L::one(0.0)), Ty::F32))
    }

    fn image(&self, v: V) -> Result<&Image, String> {
        match v {
            V::T(i) => self
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
        regs: &mut [V],
        pos: [f64; 2],
        element: u32,
    ) -> Result<(), String> {
        for p in steps {
            self.step(p, regs, pos, element)?;
        }
        Ok(())
    }

    fn step(
        &mut self,
        p: &P<'_>,
        regs: &mut [V],
        pos: [f64; 2],
        element: u32,
    ) -> Result<(), String> {
        let name = p.name;
        if let Some(b) = &p.body {
            let count = match b.count {
                Some(src) => (as_l(self.get(regs, src), Sc::U32, 1).v[0] as u32).min(b.max.max(1)),
                None => 0,
            };
            for (a, ty, init, _, _) in &b.accs {
                let (sc, n) = sc_of(ty);
                regs[*a] = V::N(sc, as_l(self.get(regs, *init), sc, n));
            }
            for i in 0..count {
                regs[b.index] = V::N(Sc::U32, L::one(f64::from(i)));
                self.run(&b.steps, regs, pos, element)?;
                // Each accumulator takes the value of the body step named after it.
                for (a, ty, _, next, _) in &b.accs {
                    let (sc, n) = sc_of(ty);
                    regs[*a] = V::N(sc, as_l(regs[*next], sc, n));
                }
                if let Some(stop) = b.stop {
                    if self.get(regs, stop).l().v[0] != 0.0 {
                        break;
                    }
                }
            }
            for (a, _, _, _, out) in &b.accs {
                regs[*out] = regs[*a];
            }
            return Ok(());
        }
        if name == "discard_if" {
            if self.arg(regs, p, "cond").0.l().v[0] != 0.0 {
                self.discarded = true;
            }
            return Ok(());
        }
        if name == "write" || name.starts_with("atomic_") {
            let guarded =
                p.s.when
                    .as_ref()
                    .is_some_and(|w| self.slots.get(w).is_some_and(|i| regs[*i].l().v[0] == 0.0));
            let Some(Arg::Ref(buf, None)) = p.s.args.get("buf") else {
                return Ok(());
            };
            if guarded {
                return Ok(());
            }
            let sc = self.c.op.storage[buf].sc;
            let i = as_l(self.arg(regs, p, "i").0, Sc::U32, 1).v[0] as usize;
            let v = as_l(self.arg(regs, p, "v").0, sc, 1).v[0];
            if let Some((_, words)) = self.storage.iter_mut().find(|(n, _)| n == buf) {
                let at = i.min(words.len().saturating_sub(1));
                if let Some(w) = words.get_mut(at) {
                    // The words' 32 bits (an i32's two's complement), min and max signed on i32.
                    let (x, y) = (*w as i64 as u32, v as i64 as u32);
                    let signed = sc == Sc::I32;
                    let r = match name {
                        "atomic_add" => Some(x.wrapping_add(y)),
                        "atomic_min" if signed => Some((x as i32).min(y as i32) as u32),
                        "atomic_max" if signed => Some((x as i32).max(y as i32) as u32),
                        "atomic_min" => Some(x.min(y)),
                        "atomic_max" => Some(x.max(y)),
                        "atomic_and" => Some(x & y),
                        "atomic_or" => Some(x | y),
                        "atomic_xor" => Some(x ^ y),
                        _ => None,
                    };
                    *w = r.map_or(v, |r| wrap(sc, f64::from(r)));
                }
            }
            return Ok(());
        }
        let (sc, n) = sc_of(&p.ty);
        let g = |port: &str| self.arg(regs, p, port).0;
        let gt = |port: &str| self.arg(regs, p, port).1;
        let l = |port: &str| as_l(g(port), sc, n);
        let fl = |port: &str| {
            let v = g(port);
            as_l(v, Sc::F32, v.l().n.max(n))
        };
        let n1 = |f: &dyn Fn(f64) -> f64| V::N(sc, l("x").map(|x| wrap(sc, f(x))));
        let n2 =
            |f: &dyn Fn(f64, f64) -> f64| V::N(sc, l("a").zip(l("b"), |x, y| wrap(sc, f(x, y))));
        let cmp = |f: &dyn Fn(f64, f64) -> bool| {
            let (csc, _) = common(&gt("a"), &gt("b"));
            let (a, b) = (as_l(g("a"), csc, n), as_l(g("b"), csc, n));
            V::N(Sc::Bool, a.zip(b, |x, y| f64::from(u8::from(f(x, y)))))
        };
        let one = |sc, x| V::N(sc, L::one(x));
        let v = match name {
            "convert" => V::N(sc, as_l(g("x"), sc, n)),
            "compose" => {
                let mut lanes = Vec::with_capacity(4);
                for port in ["x", "y", "z", "w"] {
                    if p.args.iter().any(|(q, _, _)| *q == port) {
                        let v = g(port);
                        lanes.extend_from_slice(as_l(v, sc, v.l().n).lanes());
                    }
                }
                V::N(sc, L::of(&lanes))
            }
            "split" => {
                let x = g("x").l();
                let pick =
                    p.s.fields
                        .get("pick")
                        .and_then(Value::as_str)
                        .unwrap_or("x");
                let lanes: Vec<f64> = pick
                    .chars()
                    .map(|c| {
                        let i = "xyzw".find(c).or_else(|| "rgba".find(c)).unwrap_or(0);
                        if i < x.n {
                            x.v[i]
                        } else {
                            0.0
                        }
                    })
                    .collect();
                V::N(sc, as_l(V::N(sc, L::of(&lanes)), sc, n))
            }
            "add" => n2(&|a, b| a + b),
            "sub" => n2(&|a, b| a - b),
            "mul" => match (g("a"), g("b")) {
                (V::M(m, a), V::N(_, v)) => {
                    let m = m as usize;
                    let v = if v.n == 1 {
                        L {
                            v: [v.v[0]; 4],
                            n: m,
                        }
                    } else {
                        v
                    };
                    let mut o = L { v: [0.0; 4], n: m };
                    for r in 0..m {
                        o.v[r] = (0..m).map(|c| a[c * m + r] * v.v[c]).sum();
                    }
                    V::N(Sc::F32, o)
                }
                (V::M(m, a), V::M(_, b)) => {
                    let m = m as usize;
                    let mut o = [0.0; 16];
                    for c in 0..m {
                        for r in 0..m {
                            o[c * m + r] = (0..m).map(|k| a[k * m + r] * b[c * m + k]).sum();
                        }
                    }
                    V::M(m as u8, o)
                }
                // Integers multiply in 32 bits and wrap: f64 would lose the low bits past 2^53.
                _ if sc.is_int() => {
                    n2(&|a, b| f64::from((a as i64 as u32).wrapping_mul(b as i64 as u32)))
                }
                _ => n2(&|a, b| a * b),
            },
            "div" => n2(&|a, b| match sc {
                Sc::F32 => a / b,
                Sc::U32 if b == 0.0 => a,
                Sc::I32 if b == 0.0 || (a == -2_147_483_648.0 && b == -1.0) => a,
                _ => (a / b).trunc(),
            }),
            "rem" => n2(&|a, b| match sc {
                Sc::F32 => a - b * (a / b).trunc(),
                _ if b == 0.0 => 0.0,
                Sc::I32 if a == -2_147_483_648.0 && b == -1.0 => 0.0,
                _ => a - b * (a / b).trunc(),
            }),
            "min" => n2(&f64::min),
            "max" => n2(&f64::max),
            "mod" => n2(&|a, b| a - b * (a / b).floor()),
            "pow" => n2(&ops::pow),
            "atan2" => V::N(Sc::F32, fl("y").zip(fl("x"), ops::atan2)),
            "neg" => n1(&|x| -x),
            "abs" => n1(&f64::abs),
            "sign" => n1(&|x| {
                if x > 0.0 {
                    1.0
                } else if x < 0.0 {
                    -1.0
                } else {
                    0.0
                }
            }),
            "floor" => n1(&f64::floor),
            "ceil" => n1(&f64::ceil),
            "round" => n1(&round_even),
            "trunc" => n1(&f64::trunc),
            "fract" => n1(&|x| x - x.floor()),
            "sqrt" => n1(&ops::sqrt),
            "inverse_sqrt" => n1(&|x| 1.0 / ops::sqrt(x)),
            "exp" => n1(&ops::exp),
            "exp2" => n1(&|x| ops::pow(2.0, x)),
            "log" => n1(&ops::log),
            "log2" => n1(&ops::log2),
            "sin" => n1(&ops::sin),
            "cos" => n1(&ops::cos),
            "tan" => n1(&ops::tan),
            "asin" => n1(&ops::asin),
            "acos" => n1(&ops::acos),
            "atan" => n1(&ops::atan),
            "normalize" => {
                let x = l("x");
                let len = ops::sqrt(x.lanes().iter().map(|v| v * v).sum());
                V::N(Sc::F32, x.map(|v| v / len))
            }
            "length" => one(
                Sc::F32,
                ops::sqrt(fl("x").lanes().iter().map(|v| v * v).sum()),
            ),
            "distance" => {
                let d = fl("a").zip(fl("b"), |x, y| (x - y) * (x - y));
                one(Sc::F32, ops::sqrt(d.lanes().iter().sum()))
            }
            "dot" => {
                let (csc, m) = common(&gt("a"), &gt("b"));
                let d = as_l(g("a"), csc, m).zip(as_l(g("b"), csc, m), |x, y| x * y);
                one(sc, wrap(sc, d.lanes().iter().sum()))
            }
            "cross" => {
                let (a, b) = (fl("a").v, fl("b").v);
                V::N(
                    Sc::F32,
                    L::of(&[
                        a[1] * b[2] - a[2] * b[1],
                        a[2] * b[0] - a[0] * b[2],
                        a[0] * b[1] - a[1] * b[0],
                    ]),
                )
            }
            "transpose" => match g("x") {
                V::M(m, a) => {
                    let m2 = m as usize;
                    let mut o = [0.0; 16];
                    for c in 0..m2 {
                        for r in 0..m2 {
                            o[r * m2 + c] = a[c * m2 + r];
                        }
                    }
                    V::M(m, o)
                }
                other => other,
            },
            "clamp" => {
                let (x, lo, hi) = (l("x"), l("lo"), l("hi"));
                V::N(sc, x.zip(lo, f64::max).zip(hi, f64::min))
            }
            "mix" => {
                let (a, b, t) = (l("a"), l("b"), l("t"));
                let mut o = a;
                for i in 0..o.n {
                    o.v[i] = a.v[i] * (1.0 - t.v[i]) + b.v[i] * t.v[i];
                }
                V::N(sc, o)
            }
            "smoothstep" => {
                let (lo, hi, x) = (l("lo"), l("hi"), l("x"));
                let mut o = x;
                for i in 0..o.n {
                    let t = ((x.v[i] - lo.v[i]) / (hi.v[i] - lo.v[i])).clamp(0.0, 1.0);
                    o.v[i] = t * t * (3.0 - 2.0 * t);
                }
                V::N(sc, o)
            }
            "and" => n2(&|a, b| bits(sc, a, b, |x, y| x & y)),
            "or" => n2(&|a, b| bits(sc, a, b, |x, y| x | y)),
            "xor" => n2(&|a, b| bits(sc, a, b, |x, y| x ^ y)),
            "not" => n1(&|x| match sc {
                Sc::Bool => f64::from(u8::from(x == 0.0)),
                _ => f64::from(!(x as i64 as u32)),
            }),
            "shl" | "shr" => {
                let (a, b) = (l("a"), as_l(g("b"), Sc::U32, n));
                V::N(
                    sc,
                    a.zip(b, |x, y| {
                        let sh = (y as u32) & 31;
                        let bx = x as i64 as u32;
                        let r = if name == "shl" {
                            bx << sh
                        } else if sc == Sc::I32 {
                            ((bx as i32) >> sh) as u32
                        } else {
                            bx >> sh
                        };
                        wrap(sc, f64::from(r))
                    }),
                )
            }
            "eq" => cmp(&|a, b| a == b),
            "ne" => cmp(&|a, b| a != b),
            "lt" => cmp(&|a, b| a < b),
            "le" => cmp(&|a, b| a <= b),
            "gt" => cmp(&|a, b| a > b),
            "ge" => cmp(&|a, b| a >= b),
            "all" => one(
                Sc::Bool,
                f64::from(u8::from(g("x").l().lanes().iter().all(|x| *x != 0.0))),
            ),
            "any" => one(
                Sc::Bool,
                f64::from(u8::from(g("x").l().lanes().iter().any(|x| *x != 0.0))),
            ),
            "select" => {
                let (f, t) = (l("f"), l("t"));
                let c = g("cond").l();
                let mut o = f;
                for i in 0..o.n {
                    let ci = if c.n == 1 { c.v[0] } else { c.v[i] };
                    if ci != 0.0 {
                        o.v[i] = t.v[i];
                    }
                }
                V::N(sc, o)
            }
            "hash" => {
                let mut h = 0u32;
                let mut first = true;
                for port in ["a", "b", "c", "d"] {
                    if p.args.iter().any(|(q, _, _)| *q == port) {
                        let x = as_l(g(port), Sc::U32, 1).v[0] as u32;
                        h = if first { hash1(x) } else { hash1(h ^ x) };
                        first = false;
                    }
                }
                one(Sc::U32, f64::from(h))
            }
            "noise" | "fbm" => {
                let f = crate::check::seeded_fields(p.s).map_err(|e| format!("{name}: {e}"))?;
                let q = as_l(g("p"), Sc::F32, 2).v;
                let seed = as_l(g("seed"), Sc::U32, 1).v[0] as u32;
                let at = [q[0], q[1]];
                one(
                    Sc::F32,
                    if name == "noise" {
                        deep_canvas::steps::noise2(at, seed, [f.period[0], f.period[1]])
                    } else {
                        // The GPU holds the lacunarity and gain in f32.
                        deep_canvas::steps::fbm2(
                            at,
                            seed,
                            f.octaves,
                            f32r(f.lacunarity),
                            f32r(f.gain),
                            [f.period[0], f.period[1]],
                        )
                    },
                )
            }
            "noise3" => {
                let f = crate::check::seeded_fields(p.s).map_err(|e| format!("{name}: {e}"))?;
                let q = as_l(g("p"), Sc::F32, 2).v;
                let seed = as_l(g("seed"), Sc::U32, 1).v[0] as u32;
                V::N(
                    Sc::F32,
                    L::of(&deep_canvas::steps::noise3(
                        [q[0], q[1]],
                        seed,
                        [f.period[0], f.period[1]],
                    )),
                )
            }
            "cells" => {
                let f = crate::check::seeded_fields(p.s).map_err(|e| format!("{name}: {e}"))?;
                let (jitter, metric) =
                    crate::check::cell_fields(p.s).map_err(|e| format!("{name}: {e}"))?;
                let dims = match p.args.iter().find(|(q, _, _)| *q == "p") {
                    Some((_, _, Ty::V(_, n))) => *n as usize,
                    _ => 2,
                };
                let q = as_l(g("p"), Sc::F32, dims).v;
                let seed = as_l(g("seed"), Sc::U32, 1).v[0] as u32;
                let c = deep_canvas::steps::cells(&q[..dims], seed, f32r(jitter), metric, f.period);
                let ports = [
                    ("f2", V::N(Sc::F32, L::one(c.f2))),
                    ("id", one(Sc::U32, f64::from(c.id))),
                    ("center", V::N(Sc::F32, L::of(&c.center))),
                ];
                for (port, v) in ports {
                    if let Some(&k) = self.slots.get(&key(p.id, Some(port))) {
                        if k < regs.len() {
                            regs[k] = v;
                        }
                    }
                }
                if let Some(&k) = self.slots.get(&key(p.id, Some("f1"))) {
                    if k < regs.len() {
                        regs[k] = V::N(Sc::F32, L::one(c.f1));
                    }
                }
                one(Sc::F32, c.f1)
            }
            "spline" => {
                let points = p.s.fields.get("points").unwrap_or(&Value::Null);
                let pts = deep_canvas::steps::spline_points(points)
                    .map_err(|e| format!("step {}: {e}", p.id))?;
                // The GPU holds the table in f32.
                let table: Vec<[f64; 4]> = deep_canvas::steps::spline_table(&pts)
                    .into_iter()
                    .map(|c| c.map(f32r))
                    .collect();
                let pts32: Vec<[f64; 2]> = pts.iter().map(|q| q.map(f32r)).collect();
                let x = as_l(g("x"), Sc::F32, 1).v[0];
                one(Sc::F32, deep_canvas::steps::spline_at(&pts32, &table, x))
            }
            "homography" => {
                let q: [[f64; 2]; 4] = match p.s.fields.get("quad") {
                    Some(v) => {
                        crate::check::quad_of(v).map_err(|e| format!("step {}: {e}", p.id))?
                    }
                    None => match g("quad") {
                        V::A(i) => {
                            let items = &self.arrays[i].1;
                            std::array::from_fn(|k| {
                                let e = items.get(k).copied().unwrap_or([0.0; 4]);
                                [e[0], e[1]]
                            })
                        }
                        _ => return Err(format!("step {}: homography's quad", p.id)),
                    },
                };
                let m = deep_canvas::steps::homography(q);
                // Column-major, as WGSL holds it.
                let mut a = [0.0; 16];
                for c in 0..3 {
                    for r in 0..3 {
                        a[c * 3 + r] = m[r][c];
                    }
                }
                V::M(3, a)
            }
            "to_hsl" | "from_hsl" | "adjust" => {
                let port = if name == "from_hsl" { "hsl" } else { "rgb" };
                let c = as_l(g(port), Sc::F32, 3).v;
                let c = [c[0], c[1], c[2]];
                let out = match name {
                    "to_hsl" => deep_canvas::steps::to_hsl(c),
                    "from_hsl" => deep_canvas::steps::from_hsl(c),
                    _ => deep_canvas::steps::adjust(
                        p.s.fields.get("mode").and_then(Value::as_str).unwrap_or(""),
                        c,
                        as_l(g("x"), Sc::F32, 1).v[0],
                    ),
                };
                V::N(Sc::F32, L::of(&out))
            }
            "sample_grad" => {
                let img = self.image(g("tex"))?;
                let uv = as_l(g("uv"), Sc::F32, 2).v;
                let (dx, dy) = (as_l(g("dx"), Sc::F32, 2).v, as_l(g("dy"), Sc::F32, 2).v);
                V::N(
                    Sc::F32,
                    L::of(&img.sample_grad([uv[0], uv[1]], [dx[0], dx[1]], [dy[0], dy[1]])),
                )
            }
            "backdrop" => {
                let img = self
                    .env
                    .textures
                    .get(crate::graph::BACKDROP_INPUT)
                    .ok_or_else(|| format!("step {}: no backdrop to read", p.id))?;
                let uv = as_l(g("uv"), Sc::F32, 2).v;
                let lod = as_l(g("lod"), Sc::F32, 1).v[0];
                V::N(Sc::F32, L::of(&img.sample_level([uv[0], uv[1]], lod)))
            }
            "rand" => {
                let k = as_l(g("key"), Sc::U32, 1).v[0] as u32;
                one(Sc::F32, f64::from(hash1(k) >> 8) * 5.960_464_5e-8)
            }
            "screen_uv" => V::N(
                Sc::F32,
                L::of(&[
                    pos[0] / f64::from(self.size[0]),
                    pos[1] / f64::from(self.size[1]),
                ]),
            ),
            "screen_size" => V::N(
                Sc::F32,
                L::of(&[f64::from(self.size[0]), f64::from(self.size[1])]),
            ),
            "pixel" => V::N(Sc::U32, L::of(&[pos[0].floor(), pos[1].floor()])),
            "element" => one(Sc::U32, f64::from(element)),
            "seed" => one(Sc::U32, f64::from(self.env.seed)),
            "t" => one(Sc::F32, self.env.t),
            "camera" => match p.s.fields.get("of").and_then(Value::as_str) {
                Some("clip") => V::M(4, self.env.clip),
                Some("inverse_clip") => V::M(4, self.env.inverse_clip),
                Some("position") => V::N(Sc::F32, L::of(&self.env.eye[..3])),
                _ => one(Sc::F32, self.env.eye[3]),
            },
            "role" => g("x"),
            "normal" => {
                let space = p.s.fields.get("space").and_then(Value::as_str);
                let k = match space {
                    Some("world") => 1,
                    Some("view") => 2,
                    _ => 0,
                };
                let n3 = self.normal_at.unwrap_or(self.env.normals[k]);
                V::N(Sc::F32, L::of(&n3))
            }
            "blend" => {
                let (b, s) = (as_l(g("base"), Sc::F32, 3).v, as_l(g("over"), Sc::F32, 3).v);
                let mode = p.s.fields.get("mode").and_then(Value::as_str);
                let mode = mode.and_then(deep_canvas::blend::step_mode).unwrap_or(0);
                V::N(Sc::F32, L::of(&deep_canvas::blend::mix(mode, [b[0], b[1], b[2]], [s[0], s[1], s[2]])))
            }
            "luminance" => {
                let c = as_l(g("rgb"), Sc::F32, 3).v;
                one(Sc::F32, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
            }
            "sample" => {
                let img = self.image(g("tex"))?;
                let uv = as_l(g("uv"), Sc::F32, 2).v;
                V::N(Sc::F32, L::of(&img.sample([uv[0], uv[1]])))
            }
            "load" => {
                let img = self.image(g("tex"))?;
                let ixy = as_l(g("ixy"), Sc::I32, 2).v;
                let px = img.at(ixy[0] as i64, ixy[1] as i64);
                match p.ty {
                    Ty::V(Sc::F32, 4) => V::N(Sc::F32, L::of(&px)),
                    Ty::V(s2, _) => one(s2, px[0]),
                    _ => one(Sc::F32, px[0]),
                }
            }
            "size" => {
                let img = self.image(g("tex"))?;
                V::N(Sc::U32, L::of(&[f64::from(img.w), f64::from(img.h)]))
            }
            "index" => match g("a") {
                V::A(i) => {
                    let (asc, items) = &self.arrays[i];
                    let k =
                        (as_l(g("i"), Sc::U32, 1).v[0] as usize).min(items.len().saturating_sub(1));
                    let lanes = match p.ty {
                        Ty::V(_, l) => l as usize,
                        _ => 1,
                    };
                    V::N(
                        *asc,
                        L {
                            v: items.get(k).copied().unwrap_or([0.0; 4]),
                            n: lanes,
                        },
                    )
                }
                other => other,
            },
            "read" => {
                let i = as_l(g("i"), Sc::U32, 1).v[0] as usize;
                let V::T(b) = g("buf") else {
                    return Err(format!("step {}: read names a storage input", p.id));
                };
                let words = &self.storage[b].1;
                // An element of n lanes at its packed stride, the index clamped into the elements.
                let at = i.min((words.len() / n).saturating_sub(1)) * n;
                let lanes: Vec<f64> = (at..at + n)
                    .map(|k| words.get(k).copied().unwrap_or(0.0))
                    .collect();
                V::N(sc, L::of(&lanes))
            }
            "bitcast" => {
                let from = sc_of(&gt("x")).0;
                let bitsof = |v: f64| -> u32 {
                    match from {
                        Sc::F32 => (v as f32).to_bits(),
                        _ => v as i64 as u32,
                    }
                };
                let xl = g("x").l();
                let xl = if xl.n == 1 && n > 1 {
                    L { v: [xl.v[0]; 4], n }
                } else {
                    xl
                };
                V::N(
                    sc,
                    xl.map(|v| match sc {
                        Sc::F32 => f64::from(f32::from_bits(bitsof(v))),
                        Sc::I32 => f64::from(bitsof(v) as i32),
                        _ => f64::from(bitsof(v)),
                    }),
                )
            }
            "count_ones" => n1(&|x| f64::from((x as i64 as u32).count_ones())),
            "first_leading_bit" => n1(&|x| {
                let b = x as i64 as u32;
                match sc {
                    Sc::I32 if b == 0 || b == u32::MAX => -1.0,
                    Sc::I32 if (b as i32) < 0 => f64::from(31 - (!b).leading_zeros()),
                    _ if b == 0 => f64::from(u32::MAX),
                    _ => f64::from(31 - b.leading_zeros()),
                }
            }),
            "first_trailing_bit" => n1(&|x| {
                let b = x as i64 as u32;
                match sc {
                    _ if b != 0 => f64::from(b.trailing_zeros()),
                    Sc::I32 => -1.0,
                    _ => f64::from(u32::MAX),
                }
            }),
            "ddx" | "ddy" | "fwidth" => {
                return Err(format!(
                    "step {}: the CPU reference doesn't run derivatives",
                    p.id
                ));
            }
            other => return Err(format!("step {}: no CPU meaning for {other}", p.id)),
        };
        regs[p.out] = v;
        Ok(())
    }
}

/// The input values as the frame uploads them: params from `params` by path, roles from
/// `roles`, defaults otherwise; f32 inputs round to f32 as the uniform holds them.
pub fn inputs(
    c: &Checked,
    params: &BTreeMap<String, Value>,
    roles: &BTreeMap<String, [f64; 3]>,
) -> BTreeMap<String, Val> {
    let mut out = BTreeMap::new();
    for (name, input) in &c.op.inputs {
        let v = match &input.from {
            From::Target { .. }
            | From::Asset(_)
            | From::Texture3d { .. }
            | From::Storage { .. }
            | From::Column { .. }
            | From::Attribute { .. } => Val::T(name.clone()),
            From::Spline(slots) => Val::A(
                Sc::F32,
                slots
                    .iter()
                    .map(|c| c.iter().map(|x| f32r(*x)).collect())
                    .collect(),
            ),
            From::Role(r) => Val::N(
                Sc::F32,
                roles
                    .get(r)
                    .map(|c| c.iter().map(|x| f32r(*x)).collect())
                    .unwrap_or(vec![0.0; 3]),
            ),
            From::Param(p) | From::Channel(p) => {
                let v = params
                    .get(p)
                    .or(input.default.as_ref())
                    .cloned()
                    .unwrap_or(Value::Null);
                typed_literal(&v, &input.ty)
            }
            From::Time | From::Phase(_) | From::Seed => continue,
        };
        out.insert(name.clone(), v);
    }
    out
}

/// Runs a checked pass at every pixel of rows `rows` of a `size` output; the rows' pixels, in
/// order.
pub fn pass_rows(
    c: &Checked,
    env: &Env<'_>,
    size: [u32; 2],
    rows: std::ops::Range<u32>,
) -> Result<Vec<[f64; 4]>, String> {
    let mut prog = Prog::new(c, env, size, BTreeMap::new())?;
    let color = prog_src(&mut prog, &c.op.outputs["color"]);
    let coverage = c.op.outputs.get("coverage").map(|a| prog_src(&mut prog, a));
    shade(prog, size, rows, false, |prog, regs| {
        let mut px = as_l(prog.get(regs, color), Sc::F32, 4).v;
        if let Some(cov) = coverage {
            let k = as_l(prog.get(regs, cov), Sc::F32, 1).v[0];
            px.iter_mut().for_each(|v| *v *= k);
        }
        px
    })
}

/// Runs a checked material operator as `emit::material_harness` draws it: a full-screen surface
/// whose normal at uv is `normalize(uv × 2 − 1, 1)` in every space, each pixel its base color
/// plus its emission with alpha 1, and a discarded pixel left clear.
pub fn material_rows(
    c: &Checked,
    env: &Env<'_>,
    size: [u32; 2],
    rows: std::ops::Range<u32>,
) -> Result<Vec<[f64; 4]>, String> {
    let mut prog = Prog::new(c, env, size, BTreeMap::new())?;
    let base =
        c.op.outputs
            .get("base_color")
            .map(|a| prog_src(&mut prog, a));
    let emission = c.op.outputs.get("emission").map(|a| prog_src(&mut prog, a));
    shade(prog, size, rows, true, |prog, regs| {
        let lanes = |s: Option<Src>| s.map_or([0.0; 4], |s| as_l(prog.get(regs, s), Sc::F32, 3).v);
        let (b, e) = (lanes(base), lanes(emission));
        [b[0] + e[0], b[1] + e[1], b[2] + e[2], 1.0]
    })
}

/// Whether a top-level step reads its neighbours' values (a derivative), so the graph runs a
/// 2 × 2 quad at a time.
fn reads_quad(c: &Checked) -> bool {
    c.order
        .iter()
        .any(|id| matches!(c.op.steps[id].op.as_str(), "ddx@1" | "ddy@1" | "fwidth@1"))
}

/// Every pixel of rows `rows`, each read out by `px` once its steps ran; a discarded pixel is
/// clear. A graph with a derivative runs whole 2 × 2 quads in step, each derivative the fine
/// difference across its quad's row or column (WGSL lets a GPU take the fine or the coarse
/// difference, which agree where a value's change along x doesn't depend on y, and the
/// reverse). `material` sweeps the normal as the material harness does.
fn shade(
    mut prog: Prog<'_>,
    size: [u32; 2],
    rows: std::ops::Range<u32>,
    material: bool,
    px: impl Fn(&Prog<'_>, &[V]) -> [f64; 4],
) -> Result<Vec<[f64; 4]>, String> {
    let steps = std::mem::take(&mut prog.steps);
    let normal = |pos: [f64; 2]| -> Option<[f64; 3]> {
        material.then(|| {
            let n = [
                pos[0] / f64::from(size[0]) * 2.0 - 1.0,
                pos[1] / f64::from(size[1]) * 2.0 - 1.0,
                1.0,
            ];
            let len = ops::sqrt(n.iter().map(|v| v * v).sum());
            n.map(|v| v / len)
        })
    };
    let mut out = Vec::with_capacity(rows.len() * size[0] as usize);
    if !reads_quad(prog.c) {
        let mut regs = prog.base.clone();
        for y in rows {
            for x in 0..size[0] {
                let pos = [f64::from(x) + 0.5, f64::from(y) + 0.5];
                regs.copy_from_slice(&prog.base);
                prog.normal_at = normal(pos);
                prog.discarded = false;
                prog.run(&steps, &mut regs, pos, 0)?;
                out.push(if prog.discarded {
                    [0.0; 4]
                } else {
                    px(&prog, &regs)
                });
            }
        }
        return Ok(out);
    }
    let mut quad: [Vec<V>; 4] = std::array::from_fn(|_| prog.base.clone());
    let y0 = rows.start & !1;
    for qy in (y0..rows.end).step_by(2) {
        let mut lines = [Vec::new(), Vec::new()];
        for qx in (0..size[0]).step_by(2) {
            let pos: [[f64; 2]; 4] = std::array::from_fn(|q| {
                [
                    f64::from(qx + (q as u32 & 1)) + 0.5,
                    f64::from(qy + (q as u32 >> 1)) + 0.5,
                ]
            });
            for r in &mut quad {
                r.copy_from_slice(&prog.base);
            }
            let mut gone = [false; 4];
            for p in &steps {
                if matches!(p.name, "ddx" | "ddy" | "fwidth") {
                    let x: [L; 4] = std::array::from_fn(|q| {
                        let v = prog.arg(&quad[q], p, "x").0;
                        as_l(v, Sc::F32, v.l().n)
                    });
                    for (q, regs) in quad.iter_mut().enumerate() {
                        let dx = x[q | 1].zip(x[q & 2], |b, a| b - a);
                        let dy = x[q | 2].zip(x[q & 1], |b, a| b - a);
                        regs[p.out] = V::N(
                            Sc::F32,
                            match p.name {
                                "ddx" => dx,
                                "ddy" => dy,
                                _ => dx.zip(dy, |a, b| a.abs() + b.abs()),
                            },
                        );
                    }
                    continue;
                }
                for q in 0..4 {
                    prog.normal_at = normal(pos[q]);
                    prog.discarded = gone[q];
                    prog.step(p, &mut quad[q], pos[q], 0)?;
                    gone[q] = prog.discarded;
                }
            }
            for q in 0..4 {
                if qx + (q as u32 & 1) < size[0] {
                    let v = if gone[q] {
                        [0.0; 4]
                    } else {
                        px(&prog, &quad[q])
                    };
                    lines[q >> 1].push(v);
                }
            }
        }
        for (k, line) in lines.into_iter().enumerate() {
            if rows.contains(&(qy + k as u32)) {
                out.extend(line);
            }
        }
    }
    Ok(out)
}

fn prog_src(prog: &mut Prog<'_>, a: &Arg) -> Src {
    let mut base = BTreeMap::new();
    let s = prog.src(a, &[], &mut base);
    if let Src::Slot(i) = s {
        if i >= prog.base.len() {
            prog.base.resize(i + 1, V::N(Sc::F32, L::one(0.0)));
        }
    }
    s
}

/// Runs a checked pass at every pixel of a `size` output.
pub fn pass(c: &Checked, env: &Env<'_>, size: [u32; 2]) -> Result<Image, String> {
    let px = pass_rows(c, env, size, 0..size[1])?;
    Ok(Image {
        w: size[0],
        h: size[1],
        px,
    })
}

/// Runs a checked compute operator over its elements in order, reading `storage` (its storage
/// inputs' scalars by name), and returns each storage output's scalars.
pub fn compute(
    c: &Checked,
    env: &Env<'_>,
    storage: BTreeMap<String, Vec<f64>>,
) -> Result<BTreeMap<String, Vec<f64>>, String> {
    let mut prog = Prog::new(c, env, [0, 0], storage)?;
    let steps = std::mem::take(&mut prog.steps);
    let mut regs = prog.base.clone();
    // An indirect dispatch's invocations past its count write nothing (#484).
    let elements = match c.op.counted {
        true => prog
            .storage
            .iter()
            .find(|(name, _)| name == crate::graph::DISPATCH_COUNT)
            .and_then(|(_, n)| n.first())
            .map_or(0, |n| (*n as u32).min(c.op.elements)),
        false => c.op.elements,
    };
    for e in 0..elements {
        regs.copy_from_slice(&prog.base);
        prog.run(&steps, &mut regs, [0.0, 0.0], e)?;
    }
    Ok(prog
        .storage
        .into_iter()
        .filter(|(k, _)| c.op.storage.contains_key(k))
        .collect())
}
