//! Every public step against its CPU reference, and the exact steps' bits (issue #429, criterion
//! 3eb19699; canvas primitives: Every public step, Determinism class).
//!
//! `op_table` lists gpu.step@1's entries. `steps_reference` builds one operator per public step
//! from its ports in the op table and the check's typing alone: each value port reads seeded
//! words, the same bits on the GPU and in the f64 interpreter, through `load` of an integer
//! texture in a pass or a material and through `read` of storage in compute work, and the step's
//! result is widened to RGBA f32. A step runs in the first kind it may appear in whose operator
//! checks and runs (a pass, then compute work, then a material through the material harness), at
//! the first port types the check takes. `exact_steps` runs every exact public step the same way
//! over integer types, preferring compute work, whose words come back as written.

use std::collections::BTreeMap;

use deep_canvas_effects::graph::{Kind, Sc, Tex, Ty};
use deep_canvas_effects::interp::{self, Env, Image};
use deep_canvas_effects::table::{Def, COMPUTE, MATERIAL, PASS, TABLE, VERSION};
use deep_effects_render::compile::{compile_with, Compiled};
use deep_effects_render::reference;
use deep_effects_render::runner::{Frame, Runner};
use deep_gpu::device::Device;
use serde_json::{json, Map, Value};

use crate::effects::pollster_block;
use crate::frames::hex;
use crate::view3d::write_named;
use crate::{refused, App};

/// Every harness is 64 × 64 pixels (or elements).
const W: u32 = 64;
const H: u32 = 64;
const N: u32 = W * H;
/// A storage input's length, and a texture port's size.
const STORE: u32 = 256;
const TEX: [u32; 2] = [48, 40];
const SEED: u64 = 0x0429_3eb1_9699;
const TARGET: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;

fn kinds(mask: u8) -> Vec<&'static str> {
    [(MATERIAL, "material"), (PASS, "pass"), (COMPUTE, "compute")]
        .into_iter()
        .filter(|(b, _)| mask & b != 0)
        .map(|(_, n)| n)
        .collect()
}

/// Whether composed graphs may use the step: every base entry is one of Every public step's
/// rows, and the core's table holds no internal step.
fn public(_d: &Def) -> bool {
    true
}

/// `op_table`: every entry of gpu.step@1 in this build.
pub fn op_table() -> Value {
    let entries: Vec<Value> = TABLE
        .iter()
        .map(|d| {
            json!({"name": d.name, "ports": d.ports, "weight": d.weight, "fetches": d.fetches,
                "exact": d.exact, "kinds": kinds(d.kinds), "module": "core", "public": public(d)})
        })
        .collect();
    json!({"version": VERSION, "entries": entries})
}

// ---------------------------------------------------------------------------------------------
// Seeded values.

fn mix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn key(s: &str) -> u64 {
    s.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)
    })
}

/// The seeded draw for one value: its step, port, lane and place.
fn draw(op: &str, port: &str, lane: u32, at: u64) -> u64 {
    mix64(mix64(mix64(SEED ^ key(op)) ^ key(port)) ^ (u64::from(lane) << 40) ^ at)
}

fn unit(k: u64) -> f64 {
    (k >> 11) as f64 / (1u64 << 53) as f64
}

/// A float port's domain: where WGSL defines the step to its stated accuracy, and away from the
/// edges where it lets a GPU answer anything (a negative square root, a clamp or smoothstep whose
/// bounds cross, sin outside [-π, π], a divisor near zero).
fn domain(op: &str, port: &str) -> (f64, f64, bool) {
    match (op, port) {
        ("sqrt" | "inverse_sqrt" | "log" | "log2", _) => (0.01, 8.0, false),
        ("asin" | "acos", _) => (-1.0, 1.0, false),
        ("pow", "a") => (0.05, 4.0, false),
        ("pow", "b") => (-3.0, 3.0, false),
        ("div" | "mod" | "rem", "b") => (0.25, 4.0, true),
        ("tan", _) => (-1.4, 1.4, false),
        ("sin" | "cos", _) => (-3.1, 3.1, false),
        ("clamp", "lo") => (-4.0, 0.0, false),
        ("clamp", "hi") => (0.0, 4.0, false),
        ("smoothstep", "lo") => (-4.0, -0.25, false),
        ("smoothstep", "hi") => (0.25, 4.0, false),
        // #431: gradients that keep the harness texture magnified, so the level is its one; the
        // backdrop's harness image has one level too; hue, saturation and lightness in range.
        ("sample_grad", "dx" | "dy") => (-0.001, 0.001, false),
        ("backdrop", "lod") => (0.0, 0.0, false),
        ("from_hsl", _) => (0.0, 1.0, false),
        ("adjust", "x") => (-2.0, 2.0, false),
        (_, "uv") => (-0.1, 1.1, false),
        (_, "lod") => (0.0, 2.0, false),
        (_, "rgb" | "base") => (0.0, 1.0, false),
        _ => (-4.0, 4.0, false),
    }
}

/// The steps that read their quad neighbours: WGSL lets a GPU take a fine or a coarse
/// difference, so their inputs change along x the same in every row (and along y the same in
/// every column), where the two agree.
fn quad(op: &str) -> bool {
    matches!(op, "ddx" | "ddy" | "fwidth")
}

/// One seeded value of scalar type `sc` for `port`'s `lane` at pixel (x, y), as the word the GPU
/// reads and the value the interpreter reads; `imax` bounds an index port.
fn value(op: &str, port: &str, lane: u32, x: u32, y: u32, sc: Sc, imax: u32) -> (u32, f64) {
    let at = (u64::from(x) << 20) | u64::from(y);
    let k = draw(op, port, lane, at);
    match sc {
        Sc::F32 => {
            let (lo, hi, signed) = domain(op, port);
            let v = if quad(op) {
                let gx = unit(draw(op, port, lane, u64::from(x) | 1 << 32));
                let gy = unit(draw(op, port, lane, u64::from(y) | 2 << 32));
                lo + (hi - lo) * (gx + gy) / 2.0
            } else {
                let v = lo + (hi - lo) * unit(k);
                if signed && k & 1 == 1 {
                    -v
                } else {
                    v
                }
            };
            let f = v as f32;
            (f.to_bits(), f64::from(f))
        }
        Sc::I32 => {
            let v = if port == "ixy" {
                let span = (if lane == 0 { TEX[0] } else { TEX[1] }) + 8;
                (unit(k) * f64::from(span)) as i32 - 4
            } else {
                (k >> 32) as u32 as i32
            };
            (v as u32, f64::from(v))
        }
        Sc::U32 => {
            let v = if port == "i" {
                (unit(k) * f64::from(imax)) as u32
            } else {
                (k >> 32) as u32
            };
            (v, f64::from(v))
        }
        Sc::Bool => {
            let b = u32::from(k >> 63 == 1);
            (b, f64::from(b))
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Harness operators.

#[derive(Clone, Copy, PartialEq)]
enum Variant {
    /// Floats first: the step against its f64 reference.
    Reference,
    /// Integers first, compute first: an exact step's bits.
    Exact,
}

/// The port types tried, in order, for every value port at once.
fn candidates(v: Variant) -> Vec<Ty> {
    let floats = [
        Ty::V(Sc::F32, 3),
        Ty::F32,
        Ty::V(Sc::F32, 4),
        Ty::V(Sc::F32, 2),
        Ty::Mat(4),
        Ty::Mat(3),
        Ty::Arr(Sc::F32, 4, 8),
    ];
    let ints = [
        Ty::V(Sc::U32, 3),
        Ty::V(Sc::I32, 3),
        Ty::U32,
        Ty::I32,
        Ty::V(Sc::Bool, 3),
        Ty::BOOL,
        Ty::Arr(Sc::U32, 1, 8),
    ];
    match v {
        Variant::Reference => {
            let mut ints = ints.to_vec();
            // Signed before unsigned here, so the reference sees signed integer semantics.
            ints.swap(0, 1);
            ints.swap(2, 3);
            floats.into_iter().chain(ints).collect()
        }
        Variant::Exact => ints.into_iter().chain(floats).collect(),
    }
}

fn scalar(t: &Ty) -> Sc {
    match t {
        Ty::V(sc, _) | Ty::Arr(sc, _, _) | Ty::Storage(sc, _) => *sc,
        _ => Sc::F32,
    }
}

fn lanes(t: &Ty) -> u8 {
    match t {
        Ty::V(_, n) => *n,
        _ => 1,
    }
}

fn of_lanes(sc: Sc, n: u8) -> Ty {
    Ty::V(sc, n)
}

/// One choice of how to build a step's harness.
#[derive(Clone)]
struct Plan {
    kind: Kind,
    t: Ty,
    tex: Tex,
    /// `buf` names the operator's storage output (a statement) rather than a storage input.
    buf_out: bool,
    /// `i` is the element's own index (a compute write), not a seeded one.
    own_i: bool,
    variant: Variant,
}

/// What a harness reads besides its steps: each texture input's image as the GPU holds it, and
/// each storage input's values (by scalar type).
#[derive(Default)]
pub(crate) struct Data {
    pub textures: BTreeMap<String, (Tex, Image)>,
    pub storage: BTreeMap<String, (Sc, Vec<f64>)>,
}

/// How the harness ends: a placeholder output to type the step, the step's result widened to
/// the kind's output, or a statement's own writes.
enum End {
    Probe,
    Result(Ty),
    Statement,
}

struct G<'a> {
    op: &'a str,
    plan: &'a Plan,
    inputs: Map<String, Value>,
    steps: Map<String, Value>,
    data: Data,
}

impl G<'_> {
    fn step(&mut self, id: &str, op: &str, args: Value) -> String {
        self.steps
            .insert(id.into(), json!({"op": op, "args": args}));
        id.to_string()
    }

    fn compute(&self) -> bool {
        self.plan.kind == Kind::Compute
    }

    /// Where lane `l` of a seeded port sits: texel (4x + l, y) in a pass, word 4e + l in compute.
    fn at(&mut self, l: u32) -> String {
        if self.compute() {
            if !self.steps.contains_key("e") {
                self.step("e", "element@1", json!({}));
                self.step("e4", "mul@1", json!({"a": "e", "b": 4}));
            }
            let id = format!("i{l}");
            if !self.steps.contains_key(&id) {
                self.step(&id, "add@1", json!({"a": "e4", "b": l}));
            }
            id
        } else {
            if !self.steps.contains_key("px") {
                self.step("px", "pixel@1", json!({}));
                self.step("pxi", "convert@1", json!({"x": "px", "to": "vec2<i32>"}));
                self.step("pxx", "split@1", json!({"x": "pxi", "pick": "x"}));
                self.step("pxy", "split@1", json!({"x": "pxi", "pick": "y"}));
                self.step("pxx4", "mul@1", json!({"a": "pxx", "b": 4}));
            }
            let id = format!("c{l}");
            if !self.steps.contains_key(&id) {
                self.step(&format!("cx{l}"), "add@1", json!({"a": "pxx4", "b": l}));
                self.step(&id, "compose@1", json!({"x": format!("cx{l}"), "y": "pxy"}));
            }
            id
        }
    }

    /// A per-pixel (or per-element) seeded value of type `t` for `port`.
    fn seeded(&mut self, port: &str, t: &Ty, imax: u32) -> String {
        let name = format!("in_{port}");
        let (sc, n) = (scalar(t), u32::from(lanes(t)));
        let mut words = Vec::new();
        for y in 0..H {
            for x in 0..W {
                for l in 0..4 {
                    let w = if l < n {
                        value(self.op, port, l, x, y, sc, imax).0
                    } else {
                        0
                    };
                    words.push(f64::from(w));
                }
            }
        }
        if self.compute() {
            self.inputs.insert(name.clone(), json!({"type": "u32", "count": 4 * N, "from": {"storage": {"op": "core", "output": name}}}));
            self.data.storage.insert(name.clone(), (Sc::U32, words));
        } else {
            let mut img = Image::new(4 * W, H);
            for (p, w) in img.px.iter_mut().zip(words) {
                p[0] = w;
            }
            self.inputs.insert(name.clone(), json!({"type": "texture<u32>", "from": {"texture": {"op": "core", "output": name}}}));
            self.data.textures.insert(name.clone(), (Tex::Uint, img));
        }
        let mut parts = Vec::new();
        for l in 0..n {
            let at = self.at(l);
            let w = format!("{port}_w{l}");
            if self.compute() {
                self.step(&w, "read@1", json!({"buf": name, "i": at}));
            } else {
                self.step(&w, "load@1", json!({"tex": name, "ixy": at}));
            }
            let v = format!("{port}_v{l}");
            match sc {
                Sc::U32 => parts.push(w),
                Sc::Bool => parts.push(self.step(&v, "ne@1", json!({"a": w, "b": 0}))),
                sc => parts.push(self.step(&v, "bitcast@1", json!({"x": w, "to": sc.wgsl()}))),
            }
        }
        if n == 1 {
            return parts.remove(0);
        }
        let mut args = Map::new();
        for (p, v) in ["x", "y", "z", "w"].iter().zip(parts) {
            args.insert((*p).to_string(), json!(v));
        }
        self.step(&format!("a_{port}"), "compose@1", Value::Object(args))
    }

    /// A uniform input of a matrix or array type, its seeded value as its default.
    fn uniform(&mut self, port: &str, t: &Ty) -> String {
        let name = format!("in_{port}");
        let f = |i: u32| {
            let (_, v) = value(self.op, port, i, 0, 0, Sc::F32, 0);
            v
        };
        let default = match t {
            Ty::Mat(n) => json!((0..u32::from(*n) * u32::from(*n))
                .map(f)
                .collect::<Vec<_>>()),
            Ty::Arr(sc, l, n) => {
                let items: Vec<Value> = (0..*n)
                    .map(|k| {
                        let lane = |j: u32| value(self.op, port, k * 4 + j, 0, 0, *sc, 0).1;
                        if *l == 1 {
                            json!(lane(0))
                        } else {
                            json!((0..u32::from(*l)).map(lane).collect::<Vec<_>>())
                        }
                    })
                    .collect();
                json!(items)
            }
            _ => Value::Null,
        };
        self.inputs.insert(
            name.clone(),
            json!({"type": t.wgsl(), "from": {"param": name}, "default": default}),
        );
        name
    }

    /// A texture port: a smooth float image (so filtering's precision, which WebGPU leaves to the
    /// GPU, stays well under a code), random integer words, or depths in [0, 1].
    fn texture(&mut self, kind: Tex) -> String {
        let name = "in_tex".to_string();
        let mut img = Image::new(TEX[0], TEX[1]);
        let phase = |c: u32| unit(draw(self.op, "tex", c, 0)) * std::f64::consts::TAU;
        for (i, p) in img.px.iter_mut().enumerate() {
            let (x, y) = ((i as u32 % TEX[0]) as f64, (i as u32 / TEX[0]) as f64);
            for (c, v) in p.iter_mut().enumerate() {
                let s = 0.5
                    + 0.45
                        * (x * 0.21 + phase(c as u32)).sin()
                        * (y * 0.17 + 1.3 * phase(c as u32)).cos();
                *v = match kind {
                    Tex::Float => f64::from(reference::f16_to_f32(reference::f32_to_f16(s as f32))),
                    Tex::Depth => f64::from(s as f32),
                    Tex::Uint => f64::from((draw(self.op, "tex", c as u32, i as u64) >> 32) as u32),
                };
            }
        }
        let ty = match kind {
            Tex::Float => "texture",
            Tex::Uint => "texture<u32>",
            Tex::Depth => "depth",
        };
        self.inputs.insert(
            name.clone(),
            json!({"type": ty, "from": {"texture": {"op": "core", "output": name}}}),
        );
        self.data.textures.insert(name.clone(), (kind, img));
        name
    }

    fn storage_in(&mut self, sc: Sc) -> String {
        let name = "in_buf".to_string();
        let vals = (0..STORE)
            .map(|k| value(self.op, "buf", 0, k, 0, sc, 0).1)
            .collect();
        self.inputs.insert(name.clone(), json!({"type": sc.wgsl(), "count": STORE, "from": {"storage": {"op": "core", "output": name}}}));
        self.data.storage.insert(name.clone(), (sc, vals));
        name
    }

    fn lanes_to(&mut self, r: &str, n: u8, want: u8) -> String {
        if n == want {
            return r.to_string();
        }
        if n > want {
            return self.step(
                &format!("{r}_p"),
                "split@1",
                json!({"x": r, "pick": &"xyzw"[..want as usize]}),
            );
        }
        let mut args = Map::new();
        args.insert("x".into(), json!(r));
        for p in ["y", "z", "w"].iter().take((want - n) as usize) {
            args.insert((*p).to_string(), json!(0.0));
        }
        self.step(&format!("{r}_p"), "compose@1", Value::Object(args))
    }

    /// The result as f32 lanes: integers and bools converted, a matrix applied to a seeded vector.
    fn floats(&mut self, r: &str, rt: &Ty) -> Option<(String, u8)> {
        match rt {
            Ty::V(Sc::F32, n) => Some((r.to_string(), *n)),
            Ty::V(_, n) => Some((
                self.step(
                    "rf",
                    "convert@1",
                    json!({"x": r, "to": of_lanes(Sc::F32, *n).wgsl()}),
                ),
                *n,
            )),
            Ty::Mat(n) => {
                let v = self.seeded("mv", &Ty::V(Sc::F32, *n), 0);
                Some((self.step("rm", "mul@1", json!({"a": r, "b": v})), *n))
            }
            _ => None,
        }
    }

    /// The result as u32 words, carrying every value's bits.
    fn words(&mut self, r: &str, rt: &Ty) -> Option<(String, u8)> {
        match rt {
            Ty::V(Sc::U32, n) => Some((r.to_string(), *n)),
            Ty::V(Sc::Bool, n) => Some((
                self.step(
                    "rw",
                    "convert@1",
                    json!({"x": r, "to": of_lanes(Sc::U32, *n).wgsl()}),
                ),
                *n,
            )),
            Ty::V(_, n) => Some((
                self.step(
                    "rw",
                    "bitcast@1",
                    json!({"x": r, "to": of_lanes(Sc::U32, *n).wgsl()}),
                ),
                *n,
            )),
            Ty::Mat(_) => {
                let (f, n) = self.floats(r, rt)?;
                self.words(&f, &Ty::V(Sc::F32, n))
            }
            _ => None,
        }
    }
}

/// The step's own fields, which the op table doesn't describe: a value for `const`, a target
/// type for `convert` and `bitcast`, lanes for `split`, and a camera value, a look role and a
/// normal's space.
fn fields(op: &str, t: &Ty) -> Map<String, Value> {
    let (sc, n) = (scalar(t), lanes(t));
    let other = |bits: bool| match sc {
        Sc::F32 if bits => Sc::U32,
        Sc::F32 => Sc::I32,
        Sc::I32 => Sc::U32,
        _ => Sc::I32,
    };
    let mut f = Map::new();
    match op {
        "const" => {
            let lanes: Vec<Value> = (0..n as usize)
                .map(|i| match sc {
                    Sc::F32 => json!([0.25, -1.5, 3.0, 0.75][i]),
                    Sc::I32 => json!([-123_456_789, 42, -7, 65_536][i]),
                    Sc::U32 => json!([4_000_000_000u32, 123_456_789, 7, 65_536][i]),
                    Sc::Bool => json!([true, false, true, false][i]),
                })
                .collect();
            let v = if n == 1 {
                lanes[0].clone()
            } else {
                json!(lanes)
            };
            f.insert("value".into(), v);
            f.insert("type".into(), json!(t.wgsl()));
        }
        "convert" => {
            let to = if sc == Sc::Bool {
                Sc::U32
            } else {
                other(false)
            };
            f.insert("to".into(), json!(of_lanes(to, n).wgsl()));
        }
        "bitcast" => {
            f.insert("to".into(), json!(of_lanes(other(true), n).wgsl()));
        }
        "split" => {
            f.insert("pick".into(), json!("zxy"));
        }
        "camera" => {
            f.insert("of".into(), json!("inverse_clip"));
        }
        "role" => {
            f.insert("name".into(), json!("accent"));
        }
        "normal" => {
            f.insert("space".into(), json!("world"));
        }
        "blend" => {
            f.insert("mode".into(), json!("multiply"));
        }
        // #431's steps' literals: a mode, points that rise and dip, a quad no affine map makes,
        // and feature points moved most of the way.
        "adjust" => {
            f.insert("mode".into(), json!("exposure"));
        }
        "spline" => {
            f.insert(
                "points".into(),
                json!([
                    [-3.0, -1.0],
                    [-1.0, 0.5],
                    [0.0, 0.25],
                    [2.0, 2.0],
                    [3.0, 2.5]
                ]),
            );
        }
        "homography" => {
            f.insert(
                "quad".into(),
                json!([[0.1, 0.2], [0.9, 0.1], [1.1, 0.95], [-0.05, 0.8]]),
            );
        }
        "cells" => {
            f.insert("jitter".into(), json!(0.8));
        }
        _ => {}
    }
    f
}

/// A step's harness operator under `plan`, ending as `end`.
fn build(def: &Def, plan: &Plan, end: &End) -> Option<(Value, Data)> {
    let op = def.name.split('@').next().unwrap_or(def.name);
    let mut g = G {
        op,
        plan,
        inputs: Map::new(),
        steps: Map::new(),
        data: Data::default(),
    };
    let t = &plan.t;
    let statement_sc = scalar(t);
    // An index port's bound: past an array's or a buffer's end, so the clamp is read too.
    let imax = if def.ports.contains(&"buf") {
        if plan.buf_out {
            4 * N
        } else {
            STORE + 4
        }
    } else if let Ty::Arr(_, _, n) = t {
        n + 2
    } else {
        STORE
    };
    let mut args = Map::new();
    let result = if op == "repeat" {
        // A repeat of 8 trips over an accumulator: s ← 3s + y × i.
        if matches!(t, Ty::Mat(_) | Ty::Arr(..) | Ty::V(Sc::Bool, _)) {
            return None;
        }
        let x = g.seeded("x", t, imax);
        let y = g.seeded("y", t, imax);
        let body = json!({
            "kf": {"op": "convert@1", "args": {"x": "k", "to": t.wgsl()}},
            "m": {"op": "mul@1", "args": {"a": y, "b": "kf"}},
            "h": {"op": "mul@1", "args": {"a": "s", "b": 3}},
            "s": {"op": "add@1", "args": {"a": "h", "b": "m"}},
        });
        g.step("r", def.name, json!({"count": 8, "index": "k", "accumulate": {"s": {"type": t.wgsl(), "init": x}}, "body": body}));
        "r.s".to_string()
    } else {
        for port in def.ports {
            let a = match *port {
                "tex" => g.texture(plan.tex),
                "buf" if plan.buf_out => "out".into(),
                "buf" => g.storage_in(statement_sc),
                "i" if plan.own_i => {
                    if !g.compute() {
                        return None;
                    }
                    g.at(0)
                }
                "i" | "key" | "seed" => g.seeded(port, &Ty::U32, imax),
                "uv" => g.seeded(port, &Ty::V(Sc::F32, 2), imax),
                "ixy" => g.seeded(port, &Ty::V(Sc::I32, 2), imax),
                "lod" => g.seeded(port, &Ty::F32, imax),
                "cond" => g.seeded(port, &Ty::BOOL, imax),
                "rgb" | "base" | "over" => g.seeded(port, &Ty::V(Sc::F32, 3), imax),
                _ => match t {
                    Ty::Mat(_) | Ty::Arr(..) => g.uniform(port, t),
                    _ => g.seeded(port, t, imax),
                },
            };
            args.insert((*port).to_string(), json!(a));
        }
        args.extend(fields(op, t));
        g.step("r", def.name, Value::Object(args));
        if op == "backdrop" {
            // The opaque scene's copy the check binds for it, a smooth image here.
            g.texture(Tex::Float);
            g.inputs.remove("in_tex");
            let img = g.data.textures.remove("in_tex")?;
            g.data
                .textures
                .insert(deep_canvas_effects::graph::BACKDROP_INPUT.into(), img);
        }
        if op == "cells" {
            "r.f1".to_string()
        } else {
            "r".to_string()
        }
    };
    let out_sc = if plan.buf_out {
        statement_sc
    } else if plan.variant == Variant::Exact {
        Sc::U32
    } else {
        Sc::F32
    };
    let storage = json!({"storage": {"type": out_sc.wgsl(), "count": 4 * N}});
    let outputs = match (plan.kind, end) {
        (Kind::Pass, End::Probe) => json!({"color": [0.0, 0.0, 0.0, 0.0]}),
        (Kind::Material, End::Probe) => json!({"base_color": [0.0, 0.0, 0.0]}),
        (Kind::Compute, End::Probe | End::Statement) => json!({"out": storage}),
        (Kind::Material, End::Statement) => {
            let b = g.seeded("base", &Ty::V(Sc::F32, 3), imax);
            json!({"base_color": b})
        }
        (Kind::Pass, End::Statement) => return None,
        (Kind::Compute, End::Result(rt)) => {
            let (v, n) = if out_sc == Sc::U32 {
                g.words(&result, rt)?
            } else {
                g.floats(&result, rt)?
            };
            for l in 0..n {
                let lane = if n == 1 {
                    v.clone()
                } else {
                    g.step(
                        &format!("o{l}"),
                        "split@1",
                        json!({"x": v, "pick": &"xyzw"[l as usize..l as usize + 1]}),
                    )
                };
                let i = g.at(u32::from(l));
                g.step(
                    &format!("w{l}"),
                    "write@1",
                    json!({"buf": "out", "i": i, "v": lane}),
                );
            }
            json!({"out": storage})
        }
        (kind, End::Result(rt)) => {
            let (v, n) = g.floats(&result, rt)?;
            if kind == Kind::Pass {
                json!({"color": g.lanes_to(&v, n, 4)})
            } else {
                json!({"base_color": g.lanes_to(&v, n, 3)})
            }
        }
    };
    let mut op_json = json!({
        "id": format!("ref-{op}"), "kind": plan.kind.name(), "origin": "composed",
        "about": format!("{} over seeded inputs, for its CPU reference.", def.name),
        "inputs": g.inputs, "steps": g.steps, "outputs": outputs,
        "cost": {"ns_per_px": 1.0e9}, "resolution": "full",
    });
    if plan.kind == Kind::Compute {
        op_json["elements"] = json!(N);
        op_json["workgroup"] = json!(64);
        op_json["cost"] = json!({"ns_per_element": 1.0e9});
    }
    Some((op_json, g.data))
}

/// A checked, written and validated harness for `def` under `plan`: typed once with a placeholder
/// output, then ended by its result's type.
fn harness(def: &Def, plan: &Plan) -> Result<(Compiled, Data), String> {
    let (probe, _) = build(def, plan, &End::Probe).ok_or("no harness under this plan")?;
    let c = compile_with(&probe, &BTreeMap::new(), Default::default()).map_err(|e| {
        format!(
            "{:?}",
            e.iter().map(|i| i.message.clone()).collect::<Vec<_>>()
        )
    })?;
    let key = match def.name {
        n if n.starts_with("repeat@") => "r.s",
        // A cell's distance to its nearest feature point, its continuous port.
        "cells@1" => "r.f1",
        _ => "r",
    };
    let end = match c.checked.types.get(key) {
        Some(t) => End::Result(t.clone()),
        None => End::Statement,
    };
    let (full, data) = build(def, plan, &end).ok_or("no output for its result")?;
    let c = compile_with(&full, &BTreeMap::new(), Default::default()).map_err(|e| {
        format!(
            "{:?}",
            e.iter().map(|i| i.message.clone()).collect::<Vec<_>>()
        )
    })?;
    Ok((c, data))
}

/// Every plan for `def`, in the order tried.
fn plans(def: &Def, variant: Variant) -> Vec<Plan> {
    let order: &[Kind] = match variant {
        Variant::Reference => &[Kind::Pass, Kind::Compute, Kind::Material],
        Variant::Exact => &[Kind::Compute, Kind::Pass, Kind::Material],
    };
    let texes: &[Tex] = match (def.ports.contains(&"tex"), variant) {
        (false, _) => &[Tex::Float],
        (true, Variant::Reference) => &[Tex::Float, Tex::Uint, Tex::Depth],
        (true, Variant::Exact) => &[Tex::Uint, Tex::Float, Tex::Depth],
    };
    let bufs: &[bool] = if def.ports.contains(&"buf") {
        &[false, true]
    } else {
        &[false]
    };
    let owns: &[bool] = if def.ports.contains(&"i") {
        &[false, true]
    } else {
        &[false]
    };
    let mut out = Vec::new();
    for kind in order {
        if def.kinds & kind.bit() == 0 {
            continue;
        }
        for &buf_out in bufs {
            for &own_i in owns {
                for &tex in texes {
                    for t in candidates(variant) {
                        out.push(Plan {
                            kind: *kind,
                            t,
                            tex,
                            buf_out,
                            own_i,
                            variant,
                        });
                    }
                }
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Runs.

/// The frame every harness runs in: a camera whose inverse is taken in f64, a time and a seed.
fn frame() -> Frame {
    let clip: [f64; 16] = [
        1.2, 0.1, 0.0, 0.0, -0.2, 1.6, 0.05, 0.0, 0.3, -0.1, -1.01, -1.0, 0.5, 0.25, -0.2, 0.0,
    ];
    Frame {
        clip: clip.map(|x| x as f32),
        inverse_clip: reference::inverse(&clip.map(|x| f64::from(x as f32))).map(|x| x as f32),
        eye: [0.5, -1.25, 2.0, 0.1],
        t: 1.375,
        seed: 0x1a2b_3c4d,
    }
}

fn roles() -> BTreeMap<String, [f64; 3]> {
    BTreeMap::from([("accent".to_string(), [0.2, 0.6, 0.9])])
}

/// The harness through the f64 interpreter: each pixel's (or element's) RGBA.
fn cpu(c: &Compiled, data: &Data, [w, h]: [u32; 2]) -> Result<Vec<[f64; 4]>, String> {
    let f = frame();
    let textures = data
        .textures
        .iter()
        .map(|(k, (_, img))| (k.clone(), img))
        .collect();
    let env = Env {
        t: f64::from(f.t),
        seed: f.seed,
        clip: f.clip.map(f64::from),
        inverse_clip: f.inverse_clip.map(f64::from),
        eye: f.eye.map(f64::from),
        inputs: interp::inputs(&c.checked, &BTreeMap::new(), &roles()),
        textures,
        normals: [[0.0; 3]; 3],
    };
    match c.kind() {
        Kind::Pass => Ok(reference::cpu_pass(c, &env, [w, h])?.px),
        Kind::Material => interp::material_rows(&c.checked, &env, [w, h], 0..h),
        Kind::Compute => {
            let storage = data
                .storage
                .iter()
                .map(|(k, (_, v))| (k.clone(), v.clone()))
                .collect();
            let out = interp::compute(&c.checked, &env, storage)?;
            let words = out.get("out").ok_or("no storage output")?;
            Ok(words.chunks(4).map(|w| [w[0], w[1], w[2], w[3]]).collect())
        }
    }
}

fn bits(sc: Sc, v: f64) -> u32 {
    match sc {
        Sc::F32 => (v as f32).to_bits(),
        _ => v as i64 as u32,
    }
}

/// The harness on this GPU, under a validation scope: the output's raw bytes (compute's words,
/// a pass's RGBA f32 texels) and each pixel's (or element's) RGBA.
fn gpu(
    device: &Device,
    c: &Compiled,
    data: &Data,
    [w, h]: [u32; 2],
) -> Result<(Vec<u8>, Vec<[f64; 4]>), String> {
    use wgpu::util::DeviceExt as _;
    let d = &device.device;
    let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
    let runner = Runner::new(d, c.clone(), TARGET);
    let mut textures = Vec::new();
    for name in &c.checked.textures {
        let (kind, img) = data.textures.get(name).ok_or("no image")?;
        textures.push(reference::upload(device, *kind, img).0);
    }
    let views: Vec<wgpu::TextureView> = textures
        .iter()
        .map(|t| t.create_view(&Default::default()))
        .collect();
    let view_refs: Vec<&wgpu::TextureView> = views.iter().collect();
    let mut buffers = Vec::new();
    for name in &c.checked.storage_inputs {
        let (sc, vals) = data.storage.get(name).ok_or("no storage")?;
        let bytes: Vec<u8> = vals
            .iter()
            .flat_map(|v| bits(*sc, *v).to_le_bytes())
            .collect();
        buffers.push(d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("steps_reference input"),
            contents: &bytes,
            usage: wgpu::BufferUsages::STORAGE,
        }));
    }
    let out_sc = c.checked.op.storage.get("out").map(|s| s.sc);
    let out_bytes = u64::from(4 * w * h) * 4;
    if out_sc.is_some() {
        buffers.push(d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("steps_reference output"),
            size: out_bytes,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }));
    }
    let buf_refs: Vec<&wgpu::Buffer> = buffers.iter().collect();
    let values = interp::inputs(&c.checked, &BTreeMap::new(), &roles());
    let (g0, g1, _keep) = runner.bind(d, &frame(), [w, h], &values, &view_refs, &buf_refs);
    let mut enc = d.create_command_encoder(&Default::default());
    let target = d.create_texture(&wgpu::TextureDescriptor {
        label: Some("steps_reference target"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: TARGET,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("steps_reference read back"),
        size: out_bytes,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    if c.kind() == Kind::Compute {
        runner.dispatch(&mut enc, c.checked.op.elements, &(g0, g1), None);
        let out = buffers.last().ok_or("no output")?;
        enc.copy_buffer_to_buffer(out, 0, &back, 0, out_bytes);
    } else {
        runner.encode(
            &mut enc,
            &target.create_view(&Default::default()),
            &(g0, g1),
            None,
        );
    }
    device.queue.submit([enc.finish()]);
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    if let Some(e) = pollster_block(scope.pop()) {
        return Err(e.to_string());
    }
    let raw = match c.kind() {
        Kind::Compute => {
            back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
            let _ = d.poll(wgpu::PollType::wait_indefinitely());
            let bytes = back
                .slice(..)
                .get_mapped_range()
                .map(|v| v.to_vec())
                .map_err(|e| e.to_string())?;
            back.unmap();
            bytes
        }
        _ => reference::read(device, &target, wgpu::TextureAspect::All, 16),
    };
    let sc = out_sc.unwrap_or(Sc::F32);
    let px = raw
        .as_chunks::<16>()
        .0
        .iter()
        .map(|p| {
            let w =
                |k: usize| u32::from_le_bytes([p[4 * k], p[4 * k + 1], p[4 * k + 2], p[4 * k + 3]]);
            std::array::from_fn(|k| match sc {
                Sc::F32 => f64::from(f32::from_bits(w(k))),
                Sc::I32 => f64::from(w(k) as i32),
                _ => f64::from(w(k)),
            })
        })
        .collect();
    Ok((raw, px))
}

/// An operator drawn by the step harness at `size` (#431: check_operator's `reference`): on this
/// GPU (its f32 RGBA texels) and through the step graph's f64 interpreter, each with the frame
/// every harness runs in.
pub(crate) fn drawn_both(
    device: &Device,
    c: &Compiled,
    data: &Data,
    size: [u32; 2],
) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cpu_px = cpu(c, data, size)?;
    let (_, gpu_px) = gpu(device, c, data, size)?;
    Ok((f32_file(&gpu_px), f32_file(&cpu_px)))
}

fn f32_file(px: &[[f64; 4]]) -> Vec<u8> {
    px.iter()
        .flat_map(|p| p.iter().flat_map(|v| (*v as f32).to_le_bytes()))
        .collect()
}

/// A step's first plan that checks and runs on the CPU (when `with_cpu`) and on the GPU.
#[allow(clippy::type_complexity)]
fn first_run(
    device: &Device,
    def: &Def,
    variant: Variant,
    with_cpu: bool,
) -> Result<(Kind, Vec<u8>, Vec<[f64; 4]>, Vec<[f64; 4]>), String> {
    let mut why = String::from("no plan");
    for plan in plans(def, variant) {
        let (c, data) = match harness(def, &plan) {
            Ok(h) => h,
            Err(e) => {
                why = e;
                continue;
            }
        };
        let cpu_px = if with_cpu {
            match cpu(&c, &data, [W, H]) {
                Ok(p) => p,
                Err(e) => {
                    why = format!("{} on the CPU: {e}", plan.kind.name());
                    continue;
                }
            }
        } else {
            Vec::new()
        };
        match gpu(device, &c, &data, [W, H]) {
            Ok((raw, px)) => return Ok((plan.kind, raw, px, cpu_px)),
            Err(e) => why = format!("{} on the GPU: {e}", plan.kind.name()),
        }
    }
    Err(why)
}

/// `steps_reference`: every public step on this GPU and in the f64 interpreter, both as `.f32`
/// RGBA files named by their SHA-256 in `out`.
pub fn steps_reference(app: &mut App, out: &str) -> Value {
    let runs = app.worker.call(|state| {
        let device = state.gpu.device();
        TABLE
            .iter()
            .filter(|d| public(d))
            .map(|d| (d.name, first_run(&device, d, Variant::Reference, true)))
            .collect::<Vec<_>>()
    });
    let mut steps = Vec::new();
    let mut failed = Vec::new();
    for (name, run) in runs {
        match run {
            Ok((kind, _, g, c)) => {
                let (gpu, cpu) = match (
                    write_named(out, &f32_file(&g), "f32"),
                    write_named(out, &f32_file(&c), "f32"),
                ) {
                    (Ok(g), Ok(c)) => (g, c),
                    (Err(e), _) | (_, Err(e)) => return e,
                };
                steps.push(json!({"op": name, "kind": kind.name(), "size": [W, H], "gpu": gpu, "cpu": cpu}));
            }
            Err(why) => failed.push(json!({"op": name, "reason": why})),
        }
    }
    if steps.is_empty() {
        return refused("steps_reference_failed", "no public step ran");
    }
    json!({"steps": steps, "failed": failed})
}

/// Every exact public step's output bits on this GPU, by SHA-256: integer inputs, run as
/// compute work where it may be (its words as written), else a pass or a material.
pub fn exact_steps(app: &mut App) -> BTreeMap<String, String> {
    app.worker.call(|state| {
        let device = state.gpu.device();
        TABLE
            .iter()
            .filter(|d| public(d) && d.exact)
            .filter_map(|d| {
                let (_, raw, _, _) = first_run(&device, d, Variant::Exact, false).ok()?;
                Some((d.name.to_string(), hex(&raw)))
            })
            .collect()
    })
}

/// Another Metal family than `family`, for the one-GPU unblock ask.
pub fn missing_family(family: &str) -> &'static str {
    if family == "apple7" {
        "apple9"
    } else {
        "apple7"
    }
}
