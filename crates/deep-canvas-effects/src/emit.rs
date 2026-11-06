//! The core's WGSL for a checked operator (canvas primitives: Compile, validate and cache: `emit:
//! WGSL`, written by the core; bind groups fixed: 0 the frame, 1 the inputs). Only a [`Checked`]
//! graph is ever written, one `let` per step in evaluation order, so the text a GPU compiles
//! never comes from a document. A pass is a full-screen triangle whose fragment runs the steps.

use std::fmt::Write as _;

use serde_json::Value;

use crate::check::{acc_key, key, Checked};
use crate::graph::{Arg, Body, From, Kind, Sc, Step, Tex, Ty};

/// The frame uniform every pass binds at group 0, binding 0. Its layout is what
/// `deep-effects-render` writes: two column-major 4 × 4 matrices, then four vec4s.
pub const FRAME: &str = "struct Frame {
    clip: mat4x4<f32>,
    inverse_clip: mat4x4<f32>,
    // xyz: the camera's position; w: its near plane.
    eye: vec4<f32>,
    // The output's width and height in px, and their reciprocals.
    size: vec4<f32>,
    // x: t in seconds; the rest unused.
    time: vec4<f32>,
    // x: the item's seed.
    seed: vec4<u32>,
};
@group(0) @binding(0) var<uniform> frame: Frame;
";

/// The longest fixed repeat the core writes out trip by trip instead of as a loop.
const UNROLL: u32 = 16;

/// The fixed hash `hash@1` folds with: PCG's output permutation of an LCG step (O'Neill 2014,
/// as Jarzynski and Olano's \"Hash Functions for GPU Rendering\" use it), on u32 only, so it gives
/// the same bits on every GPU and on the CPU.
pub const HASH: &str = "fn deep_hash1(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
";

/// The seeded noise step `noise@1`, as `deep_canvas::steps::noise2` writes it in f64 (`fbm@1`
/// is its octaves written out, its octave count being a literal): written into a module only
/// when one of its steps uses it.
pub const NOISE: &str = "fn deep_corner2(hs: u32, c: vec2<i32>, period: u32, d: vec2<f32>) -> f32 {
    var q = c;
    if period > 0u {
        let pp = i32(period);
        q = ((q % pp) + pp) % pp;
    }
    let h = deep_hash1(deep_hash1(hs ^ u32(q.x)) ^ u32(q.y));
    let g = vec2<f32>(f32(h & 65535u), f32(h >> 16u)) * (1.0 / 32768.0) - 1.0;
    return dot(g, d);
}
fn deep_noise2(p: vec2<f32>, seed: u32, period: u32) -> f32 {
    let i = floor(p);
    let f = p - i;
    let c = vec2<i32>(i);
    let hs = deep_hash1(seed);
    let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let b = mix(deep_corner2(hs, c, period, f), deep_corner2(hs, c + vec2<i32>(1, 0), period, f - vec2<f32>(1.0, 0.0)), u.x);
    let t = mix(deep_corner2(hs, c + vec2<i32>(0, 1), period, f - vec2<f32>(0.0, 1.0)), deep_corner2(hs, c + vec2<i32>(1, 1), period, f - vec2<f32>(1.0, 1.0)), u.x);
    return mix(b, t, u.y);
}
";

/// `sample3d@1` (#483): a trilinear lookup of a 3D texture written as its eight texel loads, so it
/// reads every format alike, r32float included, which isn't filterable on every adapter.
pub const SAMPLE3D: &str = "fn deep_sample3d(t: texture_3d<f32>, uvw: vec3<f32>) -> vec4<f32> {
    let n = vec3<i32>(textureDimensions(t));
    let p = clamp(uvw, vec3<f32>(0.0), vec3<f32>(1.0)) * vec3<f32>(n) - 0.5;
    let b = floor(p);
    let f = p - b;
    let i = vec3<i32>(b);
    let hi = n - vec3<i32>(1);
    var acc = vec4<f32>(0.0);
    for (var k = 0; k < 8; k++) {
        let o = vec3<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1);
        let w = select(1.0 - f, f, vec3<bool>(o == vec3<i32>(1)));
        acc += textureLoad(t, clamp(i + o, vec3<i32>(0), hi), 0) * (w.x * w.y * w.z);
    }
    return acc;
}
";

/// Whether any step, in any body, is a seeded noise step.
fn uses_noise(steps: &std::collections::BTreeMap<String, Step>) -> bool {
    steps.values().any(|s| {
        matches!(s.op.as_str(), "noise@1" | "fbm@1")
            || s.body.as_ref().is_some_and(|b| uses_noise(&b.steps))
    })
}

/// A uniform slot's WGSL type: every scalar and vector input takes a whole vec4 of its scalar.
fn slot(t: &Ty) -> String {
    match t {
        Ty::V(sc, _) => format!("vec4<{}>", sc.wgsl()),
        Ty::Arr(sc, _, n) => format!("array<vec4<{}>, {n}>", sc.wgsl()),
        Ty::Mat(_) => "mat4x4<f32>".into(),
        other => other.wgsl(),
    }
}

/// The inputs' uniform as [`bindings`] lays it out: a leading unused vec4, then each value input
/// in name order in whole vec4 slots (an array a slot per element, a matrix four).
pub fn input_bytes(
    c: &Checked,
    values: &std::collections::BTreeMap<String, crate::interp::Val>,
) -> Vec<u8> {
    use crate::interp::Val;
    let mut b = vec![0u8; 16];
    let word = |sc: Sc, x: f64| -> [u8; 4] {
        match sc {
            Sc::F32 => (x as f32).to_le_bytes(),
            Sc::I32 => (x as i32).to_le_bytes(),
            Sc::U32 | Sc::Bool => (x as u32).to_le_bytes(),
        }
    };
    for (name, input) in &c.op.inputs {
        if matches!(input.ty, Ty::Tex(_) | Ty::Tex3(_) | Ty::Storage(..))
            || matches!(input.from, From::Time | From::Seed)
        {
            continue;
        }
        let v = values.get(name);
        match &input.ty {
            Ty::V(sc, _) => {
                let lanes = match v {
                    Some(Val::N(_, l)) => l.clone(),
                    _ => Vec::new(),
                };
                for i in 0..4 {
                    b.extend_from_slice(&word(*sc, lanes.get(i).copied().unwrap_or(0.0)));
                }
            }
            Ty::Arr(sc, _, n) => {
                let items = match v {
                    Some(Val::A(_, items)) => items.clone(),
                    _ => Vec::new(),
                };
                for k in 0..*n as usize {
                    for i in 0..4 {
                        let x = items.get(k).and_then(|e| e.get(i)).copied().unwrap_or(0.0);
                        b.extend_from_slice(&word(*sc, x));
                    }
                }
            }
            Ty::Mat(n) => {
                let m = match v {
                    Some(Val::M(_, m)) => m.clone(),
                    _ => Vec::new(),
                };
                let n = *n as usize;
                for c in 0..4 {
                    for r in 0..4 {
                        let x = if c < n && r < n {
                            m.get(c * n + r).copied().unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        b.extend_from_slice(&(x as f32).to_le_bytes());
                    }
                }
            }
            _ => {}
        }
    }
    b
}

/// A uniform slot's value as its declared type.
fn unslot(expr: &str, t: &Ty) -> String {
    match t {
        Ty::V(_, 1) => format!("{expr}.x"),
        Ty::V(_, 2) => format!("{expr}.xy"),
        Ty::V(_, 3) => format!("{expr}.xyz"),
        Ty::Mat(3) => format!("mat3x3<f32>({expr}[0].xyz, {expr}[1].xyz, {expr}[2].xyz)"),
        _ => expr.into(),
    }
}

pub fn ident(name: &str) -> String {
    format!("s_{}", name.replace('.', "__"))
}

fn input_ident(name: &str) -> String {
    format!("in_{name}")
}

fn lit(v: &Value, t: &Ty) -> String {
    let num = |x: &Value, sc: Sc| -> String {
        match sc {
            Sc::F32 => {
                let f = x.as_f64().unwrap_or(0.0) as f32;
                let s = format!("{f:?}");
                if s.contains('e') && !s.contains('.') {
                    s.replacen('e', ".0e", 1)
                } else {
                    s
                }
            }
            Sc::U32 => format!("{}u", x.as_u64().unwrap_or(0) as u32),
            Sc::I32 => format!("{}i", x.as_i64().unwrap_or(0) as i32),
            Sc::Bool => format!("{}", x.as_bool().unwrap_or(false)),
        }
    };
    match (t, v) {
        (Ty::V(sc, 1), v) => num(v, *sc),
        (Ty::V(sc, n), Value::Array(a)) => format!(
            "vec{n}<{}>({})",
            sc.wgsl(),
            a.iter().map(|x| num(x, *sc)).collect::<Vec<_>>().join(", ")
        ),
        (Ty::V(sc, n), v) => format!("vec{n}<{}>({})", sc.wgsl(), num(v, *sc)),
        (Ty::Int, v) => num(v, Sc::I32),
        (Ty::Arr(sc, l, _), Value::Array(a)) => {
            let elem = Ty::V(*sc, *l);
            format!(
                "{}({})",
                t.wgsl(),
                a.iter()
                    .map(|x| lit(x, &elem))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        }
        (Ty::Mat(n), Value::Array(a)) => format!(
            "mat{n}x{n}<f32>({})",
            a.iter()
                .map(|x| num(x, Sc::F32))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        _ => "0".into(),
    }
}

/// `expr` of type `from` as type `to`: a literal integer takes the scalar, an integer widens to
/// f32, a scalar splats.
fn cast(expr: &str, from: &Ty, to: &Ty) -> String {
    if from == to {
        return expr.into();
    }
    match (from, to) {
        (Ty::V(_, 1) | Ty::Int, Ty::V(sc, 1)) => format!("{}({expr})", sc.wgsl()),
        (Ty::V(_, 1) | Ty::Int, Ty::V(sc, n)) => {
            format!("vec{n}<{}>({}({expr}))", sc.wgsl(), sc.wgsl())
        }
        (Ty::V(_, n), Ty::V(sc, m)) if n == m => format!("vec{n}<{}>({expr})", sc.wgsl()),
        _ => expr.into(),
    }
}

struct W<'a> {
    c: &'a Checked,
    out: String,
    /// Module-scope constants the steps declare.
    globals: String,
    indent: usize,
    /// The repeats around the step being written, innermost last, each with its accumulators.
    accs: Vec<(String, Vec<String>)>,
    options: Options,
}

/// An accumulator's variable: named by its repeat too, so nested repeats never shadow one.
fn acc_ident(repeat: &str, name: &str) -> String {
    format!("a_{repeat}_{name}")
}

impl W<'_> {
    fn line(&mut self, s: &str) {
        for _ in 0..self.indent {
            self.out.push_str("    ");
        }
        self.out.push_str(s);
        self.out.push('\n');
    }

    fn ty(&self, name: &str) -> Ty {
        self.c.types.get(name).cloned().unwrap_or(Ty::F32)
    }

    /// An argument as an expression, with its type.
    fn arg(&self, a: &Arg) -> (String, Ty) {
        match a {
            Arg::Lit(v) => {
                let t = crate::check::literal(v).unwrap_or(Ty::F32);
                (lit(v, &t), t)
            }
            Arg::Ref(name, None) if self.accs.last().is_some_and(|(_, a)| a.contains(name)) => {
                let (repeat, _) = self.accs.last().expect("checked above");
                (acc_ident(repeat, name), self.ty(&acc_key(name)))
            }
            Arg::Ref(step, port) => {
                let k = key(step, port.as_deref());
                let t = self.ty(&k);
                if self.c.op.inputs.contains_key(step) {
                    (input_ident(step), t)
                } else {
                    (ident(&k), t)
                }
            }
        }
    }

    /// An argument cast to the step's output type `to`.
    fn arg_as(&self, s: &Step, port: &str, to: &Ty) -> String {
        match s.args.get(port) {
            Some(a) => {
                let (e, t) = self.arg(a);
                cast(&e, &t, to)
            }
            None => "0".into(),
        }
    }

    fn raw(&self, s: &Step, port: &str) -> String {
        s.args.get(port).map(|a| self.arg(a).0).unwrap_or_default()
    }

    fn arg_ty(&self, s: &Step, port: &str) -> Ty {
        s.args.get(port).map(|a| self.arg(a).1).unwrap_or(Ty::F32)
    }

    fn step(&mut self, id: &str, s: &Step) {
        let name = s.op.split('@').next().unwrap_or("");
        if name == "repeat" {
            self.repeat(id, s);
            return;
        }
        if name == "discard_if" {
            let cond = self.raw(s, "cond");
            self.line(&format!("if {cond} {{ discard; }}"));
            return;
        }
        if let Some(f) = name.strip_prefix("atomic_") {
            // A statement whose result is never read.
            let Some(Arg::Ref(buf, None)) = s.args.get("buf") else {
                unreachable!("checked")
            };
            let out = &self.c.op.storage[buf];
            let i = self.arg_as(s, "i", &Ty::U32);
            let v = self.arg_as(s, "v", &Ty::V(out.sc, 1));
            let f = format!("{}{}", f[..1].to_uppercase(), &f[1..]);
            let store = format!(
                "atomic{f}(&out_{buf}[min({i}, {}u)], {v});",
                out.count.max(1) - 1
            );
            match &s.when {
                Some(w) => self.line(&format!("if {} {{ {store} }}", ident(w))),
                None => self.line(&store),
            }
            return;
        }
        if name == "store" {
            // A texel of a texture output (#483), at its index clamped into the texture.
            let Some(Arg::Ref(tex, None)) = s.args.get("tex") else {
                unreachable!("checked")
            };
            let out = &self.c.op.textures[tex];
            let (vt, dims) = if out.dim3 { ("vec3", 3) } else { ("vec2", 2) };
            let at = self.arg_as(s, "ixy", &Ty::V(Sc::U32, dims));
            let v = match out.format.as_str() {
                "r32uint" => format!("vec4<u32>({}, 0u, 0u, 1u)", self.arg_as(s, "v", &Ty::U32)),
                "r32float" => format!("vec4<f32>({}, 0.0, 0.0, 1.0)", self.arg_as(s, "v", &Ty::F32)),
                _ => self.arg_as(s, "v", &Ty::V(Sc::F32, 4)),
            };
            let store = format!(
                "textureStore(out_{tex}, min({at}, textureDimensions(out_{tex}) - {vt}<u32>(1u)), {v});"
            );
            match &s.when {
                Some(w) => self.line(&format!("if {} {{ {store} }}", ident(w))),
                None => self.line(&store),
            }
            return;
        }
        if name == "write" {
            // The index clamps into the declared count, as wgpu's runtime checks would; a bool is
            // stored as a u32 word.
            let Some(Arg::Ref(buf, None)) = s.args.get("buf") else {
                unreachable!("checked")
            };
            let out = &self.c.op.storage[buf];
            let i = self.arg_as(s, "i", &Ty::U32);
            let v = match out.sc {
                Sc::Bool => format!("select(0u, 1u, {})", self.raw(s, "v")),
                sc => self.arg_as(s, "v", &Ty::V(sc, 1)),
            };
            let last = out.count.max(1) - 1;
            let store = if atomic_bufs(&self.c.op.steps).contains(buf) {
                format!("atomicStore(&out_{buf}[min({i}, {last}u)], {v});")
            } else {
                format!("out_{buf}[min({i}, {last}u)] = {v};")
            };
            match &s.when {
                Some(w) => self.line(&format!("if {} {{ {store} }}", ident(w))),
                None => self.line(&store),
            }
            return;
        }
        let out = self.ty(id);
        let ow = out.wgsl();
        let un = |w: &Self, f: &str| format!("{f}({})", w.arg_as(s, "x", &out));
        let bin = |w: &Self, op: &str| {
            format!("{} {op} {}", w.arg_as(s, "a", &out), w.arg_as(s, "b", &out))
        };
        let call2 = |w: &Self, f: &str| {
            format!(
                "{f}({}, {})",
                w.arg_as(s, "a", &out),
                w.arg_as(s, "b", &out)
            )
        };
        let expr = match name {
            "const" => {
                let v = s.fields.get("value").cloned().unwrap_or(Value::Null);
                if matches!(out, Ty::Arr(..)) {
                    // A module constant, so indexing it reads constant memory, never a per-pixel copy.
                    let _ = writeln!(
                        self.globals,
                        "const {}: {ow} = {};",
                        ident(id),
                        lit(&v, &out)
                    );
                    return;
                }
                lit(&v, &out)
            }
            "convert" => {
                let (e, t) = s
                    .args
                    .get("x")
                    .map(|a| self.arg(a))
                    .unwrap_or(("0".into(), Ty::Int));
                match (&t, &out) {
                    (Ty::V(_, 1) | Ty::Int, Ty::V(_, n)) if *n > 1 => cast(&e, &t, &out),
                    _ => format!("{ow}({e})"),
                }
            }
            "compose" => {
                let Ty::V(sc, _) = out else { unreachable!() };
                let parts: Vec<String> = ["x", "y", "z", "w"]
                    .iter()
                    .filter_map(|p| s.args.get(*p))
                    .map(|a| {
                        let (e, t) = self.arg(a);
                        match t {
                            Ty::V(_, n) if n > 1 => format!("vec{n}<{}>({e})", sc.wgsl()),
                            _ => format!("{}({e})", sc.wgsl()),
                        }
                    })
                    .collect();
                format!("{ow}({})", parts.join(", "))
            }
            "split" => {
                let pick: String = s
                    .fields
                    .get("pick")
                    .and_then(Value::as_str)
                    .unwrap_or("x")
                    .chars()
                    .map(|c| match c {
                        'r' => 'x',
                        'g' => 'y',
                        'b' => 'z',
                        'a' => 'w',
                        c => c,
                    })
                    .collect();
                let x = self.raw(s, "x");
                let xt = self.arg_ty(s, "x");
                if xt == Ty::Int {
                    format!("i32({x})")
                } else if self.options.drops_swizzle_last && pick.len() >= 2 {
                    // The planted emitter: a swizzle's last lane written as zero.
                    let Ty::V(sc, n) = out.clone() else {
                        unreachable!("a swizzle of 2 or more lanes is a vector")
                    };
                    let kept = &pick[..pick.len() - 1];
                    let head = format!("({x}).{kept}");
                    format!("vec{n}<{}>({head}, {}(0))", sc.wgsl(), sc.wgsl())
                } else {
                    format!("({x}).{pick}")
                }
            }
            "add" => bin(self, "+"),
            "sub" => bin(self, "-"),
            "div" => bin(self, "/"),
            "rem" => bin(self, "%"),
            "mul" => match self.arg_ty(s, "a") {
                Ty::Mat(_) => format!("{} * {}", self.raw(s, "a"), self.raw(s, "b")),
                _ => bin(self, "*"),
            },
            // WGSL's min and max as the spec defines them, "e2 if e2 < e1, else e1" (and the
            // reverse): a GPU's own fmin may hand back the other operand where subnormals flush.
            // A float result is flushed as the compare read it, so a subnormal never comes back
            // on the wrong side of the operand the compare chose.
            "min" | "max" => {
                let (a, b) = (self.arg_as(s, "a", &out), self.arg_as(s, "b", &out));
                let op = if name == "min" { "<" } else { ">" };
                let chosen = format!("select({a}, {b}, {b} {op} {a})");
                match out {
                    Ty::V(Sc::F32, _) => {
                        self.line(&format!("let {}_c: {ow} = {chosen};", ident(id)));
                        let r = format!("{}_c", ident(id));
                        format!("select({r}, {r} * 0.0, abs({r}) < {ow}(1.1754944e-38))")
                    }
                    _ => chosen,
                }
            }
            "pow" => call2(self, "pow"),
            "mod" => {
                let (a, b) = (self.arg_as(s, "a", &out), self.arg_as(s, "b", &out));
                format!("{a} - {b} * floor({a} / {b})")
            }
            "atan2" => format!(
                "atan2({}, {})",
                self.arg_as(s, "y", &out),
                self.arg_as(s, "x", &out)
            ),
            "neg" => format!("-({})", self.arg_as(s, "x", &out)),
            "inverse_sqrt" => un(self, "inverseSqrt"),
            "ddx" => un(self, "dpdx"),
            "ddy" => un(self, "dpdy"),
            "abs" | "sign" | "floor" | "ceil" | "round" | "trunc" | "fract" | "sqrt" | "exp"
            | "exp2" | "log" | "log2" | "sin" | "cos" | "tan" | "asin" | "acos" | "atan"
            | "normalize" | "fwidth" => {
                if out.wgsl().contains("u32") || out.wgsl().contains("i32") {
                    // Rounding is the identity on integers.
                    if matches!(name, "floor" | "ceil" | "round" | "trunc") {
                        self.arg_as(s, "x", &out)
                    } else {
                        un(self, name)
                    }
                } else {
                    un(self, name)
                }
            }
            "clamp" => format!(
                "clamp({}, {}, {})",
                self.arg_as(s, "x", &out),
                self.arg_as(s, "lo", &out),
                self.arg_as(s, "hi", &out)
            ),
            "mix" => format!(
                "mix({}, {}, {})",
                self.arg_as(s, "a", &out),
                self.arg_as(s, "b", &out),
                self.arg_as(s, "t", &out)
            ),
            "smoothstep" => format!(
                "smoothstep({}, {}, {})",
                self.arg_as(s, "lo", &out),
                self.arg_as(s, "hi", &out),
                self.arg_as(s, "x", &out)
            ),
            "length" => {
                let f = match self.arg_ty(s, "x") {
                    Ty::V(_, n) => Ty::V(Sc::F32, n),
                    t => t,
                };
                format!("length({})", self.arg_as(s, "x", &f))
            }
            "distance" | "dot" | "cross" => {
                let (ta, tb) = (self.arg_ty(s, "a"), self.arg_ty(s, "b"));
                let mut t = match (&ta, &tb) {
                    (Ty::V(_, n), _) | (_, Ty::V(_, n)) if *n > 1 => Ty::V(Sc::F32, *n),
                    _ => Ty::F32,
                };
                if name == "dot" {
                    if let (Ty::V(sc, n), Ty::V(sc2, _)) = (&ta, &tb) {
                        if sc == sc2 {
                            t = Ty::V(*sc, *n);
                        }
                    }
                }
                format!(
                    "{name}({}, {})",
                    self.arg_as(s, "a", &t),
                    self.arg_as(s, "b", &t)
                )
            }
            "transpose" => format!("transpose({})", self.raw(s, "x")),
            "and" | "or" | "xor" => {
                let op = match (name, matches!(out, Ty::V(Sc::Bool, _))) {
                    ("and", true) => "&&",
                    ("or", true) => "||",
                    ("xor", true) => "!=",
                    ("and", false) => "&",
                    ("or", false) => "|",
                    _ => "^",
                };
                if matches!(out, Ty::V(Sc::Bool, n) if n > 1) && op != "!=" {
                    // WGSL's && and || are scalar; vectors use & and |.
                    bin(self, &op[..1])
                } else {
                    bin(self, op)
                }
            }
            "not" => {
                if matches!(out, Ty::V(Sc::Bool, _)) {
                    format!("!({})", self.raw(s, "x"))
                } else {
                    format!("~({})", self.raw(s, "x"))
                }
            }
            "shl" | "shr" => {
                let Ty::V(_, n) = out else { unreachable!() };
                let ut = Ty::V(Sc::U32, n);
                let op = if name == "shl" { "<<" } else { ">>" };
                format!(
                    "{} {op} ({} & {})",
                    self.arg_as(s, "a", &out),
                    self.arg_as(s, "b", &ut),
                    cast("31u", &Ty::U32, &ut)
                )
            }
            "eq" | "ne" | "lt" | "le" | "gt" | "ge" => {
                let t = crate_unify(&self.arg_ty(s, "a"), &self.arg_ty(s, "b"));
                let op = match name {
                    "eq" => "==",
                    "ne" => "!=",
                    "lt" => "<",
                    "le" => "<=",
                    "gt" => ">",
                    _ => ">=",
                };
                format!(
                    "{} {op} {}",
                    self.arg_as(s, "a", &t),
                    self.arg_as(s, "b", &t)
                )
            }
            "all" => format!("all({})", self.raw(s, "x")),
            "any" => format!("any({})", self.raw(s, "x")),
            "select" => format!(
                "select({}, {}, {})",
                self.arg_as(s, "f", &out),
                self.arg_as(s, "t", &out),
                self.raw(s, "cond")
            ),
            "hash" => {
                let mut e = String::new();
                for (i, p) in ["a", "b", "c", "d"].iter().enumerate() {
                    if s.args.contains_key(*p) {
                        let v = self.arg_as(s, p, &Ty::U32);
                        e = if i == 0 {
                            format!("deep_hash1({v})")
                        } else {
                            format!("deep_hash1({e} ^ {v})")
                        };
                    }
                }
                e
            }
            "noise" | "fbm" => {
                let f = crate::check::seeded_fields(s).expect("checked");
                let p = self.arg_as(s, "p", &Ty::V(Sc::F32, 2));
                let seed = self.arg_as(s, "seed", &Ty::U32);
                if name == "noise" {
                    format!("deep_noise2({p}, {seed}, {}u)", f.period)
                } else {
                    // Each octave written out: k at p × lacunarity^k, seed + k, weight gain^k.
                    let (mut terms, mut amp, mut scale, mut per, mut norm) =
                        (Vec::new(), 1.0, 1.0, f.period, 0.0);
                    for k in 0..f.octaves {
                        terms.push(format!(
                            "{} * deep_noise2({p} * {}, {seed} + {k}u, {per}u)",
                            lit(&serde_json::json!(amp), &Ty::F32),
                            lit(&serde_json::json!(scale), &Ty::F32),
                        ));
                        norm += amp;
                        amp *= f.gain;
                        scale *= f.lacunarity;
                        per = per.wrapping_mul(f.lacunarity as u32);
                    }
                    format!(
                        "({}) / {}",
                        terms.join(" + "),
                        lit(&serde_json::json!(norm), &Ty::F32)
                    )
                }
            }
            "rand" => format!(
                "f32(deep_hash1({}) >> 8u) * 5.9604645e-8",
                self.arg_as(s, "key", &Ty::U32)
            ),
            "screen_uv" => "pos.xy * frame.size.zw".into(),
            "screen_size" => "frame.size.xy".into(),
            "pixel" => "vec2<u32>(pos.xy)".into(),
            "seed" => "frame.seed.x".into(),
            "t" => "frame.time.x".into(),
            "camera" => match s.fields.get("of").and_then(Value::as_str) {
                Some("clip") => "frame.clip".into(),
                Some("inverse_clip") => "frame.inverse_clip".into(),
                Some("position") => "frame.eye.xyz".into(),
                _ => "frame.eye.w".into(),
            },
            "luminance" => format!(
                "dot({}, vec3<f32>(0.2126, 0.7152, 0.0722))",
                self.arg_as(s, "rgb", &Ty::V(Sc::F32, 3))
            ),
            "sample" => {
                let tex = self.raw(s, "tex");
                let uv = self.arg_as(s, "uv", &Ty::V(Sc::F32, 2));
                match s.args.get("lod") {
                    Some(_) => format!(
                        "textureSampleLevel({tex}, smp, {uv}, {})",
                        self.arg_as(s, "lod", &Ty::F32)
                    ),
                    None => format!("textureSample({tex}, smp, {uv})"),
                }
            }
            "load" => {
                let tex = self.raw(s, "tex");
                let ixy = self.arg_as(s, "ixy", &Ty::V(Sc::I32, 2));
                let at = format!("clamp({ixy}, vec2<i32>(0), last_{tex})");
                match self.arg_ty(s, "tex") {
                    Ty::Tex(Tex::Uint) => format!("textureLoad({tex}, {at}, 0).x"),
                    _ => format!("textureLoad({tex}, {at}, 0)"),
                }
            }
            "load3d" => {
                let tex = self.raw(s, "tex");
                let at = self.arg_as(s, "ixyz", &Ty::V(Sc::I32, 3));
                let at = format!("clamp({at}, vec3<i32>(0), last_{tex})");
                match self.arg_ty(s, "tex") {
                    Ty::Tex3(Tex::Uint) => format!("textureLoad({tex}, {at}, 0).x"),
                    _ => format!("textureLoad({tex}, {at}, 0)"),
                }
            }
            "sample3d" => format!(
                "deep_sample3d({}, {})",
                self.raw(s, "tex"),
                self.arg_as(s, "uvw", &Ty::V(Sc::F32, 3))
            ),
            "size" => format!("textureDimensions({})", self.raw(s, "tex")),
            "element" => "e".into(),
            "bitcast" => match (self.arg_ty(s, "x"), &out) {
                // A scalar's bits splat into every lane.
                (Ty::V(sc, 1), Ty::V(_, n)) if *n > 1 => {
                    format!("bitcast<{ow}>(vec{n}<{}>({}))", sc.wgsl(), self.raw(s, "x"))
                }
                _ => format!("bitcast<{ow}>({})", self.raw(s, "x")),
            },
            "role" => self.raw(s, "x"),
            "normal" => format!(
                "g.normal_{}",
                s.fields.get("space").and_then(Value::as_str).unwrap_or("object")
            ),
            "count_ones" => un(self, "countOneBits"),
            "first_leading_bit" => un(self, "firstLeadingBit"),
            "first_trailing_bit" => un(self, "firstTrailingBit"),
            "read" => {
                let Ty::Storage(sc, n) = self.arg_ty(s, "buf") else {
                    unreachable!("checked")
                };
                let buf = self.raw(s, "buf");
                let i = self.arg_as(s, "i", &Ty::U32);
                let at = if n > 0 {
                    format!("{buf}[min({i}, {}u)]", n - 1)
                } else {
                    format!("{buf}[min({i}, arrayLength(&{buf}) - 1u)]")
                };
                if let (Ty::V(_, l @ 2..), false) = (&out, self.options.attribute_stride_16) {
                    // An attribute's element at its packed stride, by the core's own indexing.
                    let last = if n > 0 {
                        format!("{}u", n - 1)
                    } else {
                        format!("arrayLength(&{buf}) / {l}u - 1u")
                    };
                    let e = format!("min({i}, {last}) * {l}u");
                    let lanes: Vec<String> =
                        (0..*l).map(|k| format!("{buf}[{e} + {k}u]")).collect();
                    format!("{}({})", out.wgsl(), lanes.join(", "))
                } else if sc == Sc::Bool {
                    format!("{at} != 0u")
                } else {
                    at
                }
            }
            "index" => {
                let Ty::Arr(_, l, n) = self.arg_ty(s, "a") else {
                    unreachable!()
                };
                let i = self.raw(s, "i");
                // The index clamps into [0, n - 1] (structural steps); the planted twin wraps.
                let at = if self.options.index_wraps {
                    format!("u32({i}) % {n}u")
                } else {
                    format!("min(u32({i}), {}u)", n - 1)
                };
                // An input array is read in place from the uniform, its elements in whole vec4
                // slots; a const array is a module constant; any other array value is a step's,
                // read from a copy in function memory, which WGSL indexes at run time.
                match s.args.get("a") {
                    Some(Arg::Ref(a, None)) if self.c.op.inputs.contains_key(a) => {
                        unslot(&format!("inputs.{a}[{at}]"), &Ty::V(Sc::F32, l))
                    }
                    Some(Arg::Ref(a, None))
                        if self.c.op.steps.get(a).is_some_and(|x| x.op == "const@1") =>
                    {
                        format!("{}[{at}]", self.raw(s, "a"))
                    }
                    _ => {
                        self.line(&format!("var {}_of = {};", ident(id), self.raw(s, "a")));
                        format!("{}_of[{at}]", ident(id))
                    }
                }
            }
            "with" => {
                let Ty::Arr(sc, l, n) = self.arg_ty(s, "a") else {
                    unreachable!()
                };
                let i = self.raw(s, "i");
                let v = self.arg_as(s, "v", &Ty::V(sc, l));
                let copy = format!("{}_copy", ident(id));
                self.line(&format!("var {copy}: {ow} = {};", self.raw(s, "a")));
                self.line(&format!("{copy}[min(u32({i}), {}u)] = {v};", n - 1));
                copy
            }
            _ => "0".into(),
        };
        self.line(&format!("let {}: {ow} = {expr};", ident(id)));
    }

    fn repeat(&mut self, id: &str, s: &Step) {
        let body: &Body = s.body.as_deref().expect("a checked repeat has a body");
        for (name, ty, init) in &body.accumulate {
            let (e, t) = self.arg(init);
            let v = cast(&e, &t, ty);
            self.line(&format!(
                "var {}: {} = {v};",
                acc_ident(id, name),
                ty.wgsl()
            ));
        }
        let count = match &body.count {
            crate::graph::Count::Const(c) => format!("{c}u"),
            crate::graph::Count::Input(name) => {
                let max = self.c.op.inputs[name].range.map_or(0, |r| r[1] as u32);
                format!("min(u32({}), {max}u)", input_ident(name))
            }
            crate::graph::Count::Unbounded(_) => unreachable!("a checked repeat is bounded"),
        };
        let i = ident(&body.index);
        // A short fixed count with no early stop is written out trip by trip, so each trip's
        // index is a constant and its fetches can all be in flight at once.
        let unrolled = match (&body.count, &body.stop_if) {
            (crate::graph::Count::Const(c), None) if *c <= UNROLL => Some(*c),
            _ => None,
        };
        let trips: Vec<Option<u32>> = match unrolled {
            Some(c) => (0..c).map(Some).collect(),
            None => vec![None],
        };
        for trip in trips {
            match trip {
                Some(k) => {
                    self.line("{");
                    self.indent += 1;
                    self.line(&format!("let {i}: u32 = {k}u;"));
                }
                None => {
                    self.line(&format!(
                        "for (var {i}: u32 = 0u; {i} < {count}; {i} = {i} + 1u) {{"
                    ));
                    self.indent += 1;
                }
            }
            let names: Vec<String> = body.accumulate.iter().map(|(n, _, _)| n.clone()).collect();
            self.accs.push((id.to_string(), names));
            let order = self.c.body_order.get(id).cloned().unwrap_or_default();
            for sid in &order {
                self.step(sid, &body.steps[sid]);
            }
            let stop = body.stop_if.as_ref().map(|a| self.arg(a).0);
            self.accs.pop();
            // Each accumulator takes the value of the body step named after it.
            for (name, ty, _) in &body.accumulate {
                let next = cast(&ident(name), &self.ty(name), ty);
                self.line(&format!("{} = {next};", acc_ident(id, name)));
            }
            if let Some(e) = stop {
                self.line(&format!("if {e} {{ break; }}"));
            }
            self.indent -= 1;
            self.line("}");
        }
        for (name, ty, _) in &body.accumulate {
            self.line(&format!(
                "let {}: {} = {};",
                ident(&key(id, Some(name))),
                ty.wgsl(),
                acc_ident(id, name)
            ));
        }
    }
}

fn crate_unify(a: &Ty, b: &Ty) -> Ty {
    match (a, b) {
        (Ty::Int, Ty::Int) => Ty::I32,
        (Ty::Int, t) | (t, Ty::Int) => t.clone(),
        (Ty::V(sa, na), Ty::V(sb, nb)) => {
            let sc = if sa == sb { *sa } else { Sc::F32 };
            Ty::V(sc, (*na).max(*nb))
        }
        (t, _) => t.clone(),
    }
}

/// How the core writes a pass: the planted wrong program that lifts its red by two 10-bit codes
/// (as the display reads them) is reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Options {
    pub off_by_two: bool,
    /// The planted emitter that drops a swizzle's last lane (writes it as zero).
    pub drops_swizzle_last: bool,
    /// The planted binding that declares a vec3 attribute at WGSL's 16-byte `vec3` stride over
    /// its packed 12-byte data.
    pub attribute_stride_16: bool,
    /// The planted small-array index that wraps (`i mod n`) instead of clamping (#483).
    pub index_wraps: bool,
    /// The planted indirect dispatch with no guard against its count (#484).
    pub no_count_guard: bool,
}

/// The inputs' uniform, the sampler and the texture and storage bindings, in binding order.
fn bindings(c: &Checked, options: Options, m: &mut String) {
    m.push_str(FRAME);
    m.push_str(HASH);
    if uses_noise(&c.op.steps) {
        m.push_str(NOISE);
    }
    if c.op.steps.values().any(|s| s.op == "sample3d@1") {
        m.push_str(SAMPLE3D);
    }
    m.push_str("struct Inputs {\n    unused: vec4<f32>,\n");
    for (n, i) in &c.op.inputs {
        if !matches!(i.ty, Ty::Tex(_) | Ty::Tex3(_) | Ty::Storage(..))
            && !matches!(i.from, From::Time | From::Seed)
        {
            let _ = writeln!(m, "    {n}: {},", slot(&i.ty));
        }
    }
    m.push_str("};\n@group(1) @binding(0) var<uniform> inputs: Inputs;\n");
    m.push_str("@group(1) @binding(1) var smp: sampler;\n");
    let mut b = 2;
    for name in &c.textures {
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var {}: {};",
            input_ident(name),
            c.op.inputs[name].ty.wgsl()
        );
        b += 1;
    }
    for name in &c.storage_inputs {
        let input = &c.op.inputs[name];
        let ty = match (&input.from, &input.ty) {
            (From::Attribute { lanes: l @ 2.., .. }, Ty::Storage(sc, _))
                if options.attribute_stride_16 =>
            {
                format!("array<vec{l}<{}>>", sc.wgsl())
            }
            _ => input.ty.wgsl(),
        };
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var<storage, read> {}: {ty};",
            input_ident(name),
        );
        b += 1;
    }
    let atomic = atomic_bufs(&c.op.steps);
    for (name, out) in &c.op.storage {
        let ty = if atomic.contains(name) {
            format!("array<atomic<{}>>", out.sc.wgsl())
        } else {
            Ty::Storage(out.sc, out.count).wgsl()
        };
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var<storage, read_write> out_{name}: {ty};"
        );
        b += 1;
    }
    for (name, t) in &c.op.textures {
        let dim = if t.dim3 { "3d" } else { "2d" };
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var out_{name}: texture_storage_{dim}<{}, write>;",
            t.format
        );
        b += 1;
    }
}

/// The storage outputs an atomic statement adds into, anywhere in the steps: WGSL holds them as
/// atomics, so every write to them is an atomic store.
fn atomic_bufs(steps: &std::collections::BTreeMap<String, Step>) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    let mut stack: Vec<&std::collections::BTreeMap<String, Step>> = vec![steps];
    while let Some(st) = stack.pop() {
        for s in st.values() {
            if s.op.starts_with("atomic_") {
                if let Some(Arg::Ref(b, None)) = s.args.get("buf") {
                    out.insert(b.clone());
                }
            }
            if let Some(b) = &s.body {
                stack.push(&b.steps);
            }
        }
    }
    out
}

/// The function body's start: each value input read from the uniform.
fn prologue(w: &mut W<'_>) {
    for (n, i) in &w.c.op.inputs {
        let e = match i.from {
            From::Time => "frame.time.x".to_string(),
            From::Seed => "frame.seed.x".to_string(),
            // Textures and storage bind as they are, and arrays are read in place.
            _ if matches!(i.ty, Ty::Tex(_) | Ty::Tex3(_) | Ty::Arr(..) | Ty::Storage(..)) => continue,
            _ => unslot(&format!("inputs.{n}"), &i.ty),
        };
        w.line(&format!("let {}: {} = {e};", input_ident(n), i.ty.wgsl()));
    }
    // Each texture's last texel, which every load clamps to, read once.
    for n in w.c.textures.clone() {
        let t = input_ident(&n);
        let v = if matches!(w.c.op.inputs[&n].ty, Ty::Tex3(_)) {
            "vec3"
        } else {
            "vec2"
        };
        w.line(&format!(
            "let last_{t}: {v}<i32> = {v}<i32>(textureDimensions({t})) - {v}<i32>(1);"
        ));
    }
    for id in w.c.order.clone() {
        let s = &w.c.op.steps[&id];
        w.step(&id, s);
    }
}

fn writer(c: &Checked, options: Options) -> W<'_> {
    W {
        c,
        options,
        out: String::new(),
        globals: String::new(),
        indent: 1,
        accs: Vec::new(),
    }
}

/// The WGSL module for a checked pass operator: the frame, its inputs, a full-screen vertex
/// stage and a fragment stage that runs its steps.
pub fn pass(c: &Checked, options: Options) -> String {
    assert_eq!(c.op.kind, Kind::Pass, "a pass");
    let mut w = writer(c, options);
    prologue(&mut w);
    let color = w.arg(&c.op.outputs["color"]);
    let mut ret = cast(&color.0, &color.1, &Ty::V(Sc::F32, 4));
    if let Some(cov) = c.op.outputs.get("coverage") {
        let (e, t) = w.arg(cov);
        ret = format!("({ret}) * {}", cast(&e, &t, &Ty::F32));
    }
    if options.off_by_two {
        w.line(&format!("var out = {ret};"));
        w.line("let enc = select(1.055 * pow(max(out.r, 0.0), 1.0 / 2.4) - 0.055, out.r * 12.92, out.r <= 0.0031308) + 2.0 / 1023.0;");
        w.line("out.r = select(pow((enc + 0.055) / 1.055, 2.4), enc / 12.92, enc <= 0.04045);");
        ret = "out".into();
    }
    w.line(&format!("return {ret};"));
    let mut m = String::new();
    let _ = writeln!(
        m,
        "// {}: written by the core from its checked steps.",
        c.op.id
    );
    bindings(c, options, &mut m);
    m.push_str(&w.globals);
    m.push_str(
        "struct VOut { @builtin(position) pos: vec4<f32> };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
    let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    return VOut(vec4<f32>(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0));
}
@fragment
fn fs(in: VOut) -> @location(0) vec4<f32> {
    let pos = in.pos;
",
    );
    m.push_str(&w.out);
    m.push_str("}\n");
    m
}

/// What a material operator's function reads of the surface it shades: its fragment position
/// (as a pass's `pos`), and its normal in object, world and view space.
pub const MAT_GEOM: &str = "struct MatGeom {
    pos: vec4<f32>,
    normal_object: vec3<f32>,
    normal_world: vec3<f32>,
    normal_view: vec3<f32>,
};
";

/// What a material operator's function gives: `base` (rgb, alpha), `emission` (rgb),
/// `mr` (metallic, roughness) and `wrote`, bit flags of the outputs it wrote: 1 base color,
/// 2 alpha, 4 emission, 8 metallic, 16 roughness (not `set`, a WGSL reserved word). The
/// renderer keeps the material's own value for every output not set.
pub const MAT_OUT: &str = "struct MatOut {
    base: vec4<f32>,
    emission: vec4<f32>,
    mr: vec4<f32>,
    wrote: vec4<u32>,
};
";

/// The bit each material output sets in `MatOut.wrote`.
pub const MAT_OUTPUTS: &[(&str, u32)] = &[
    ("base_color", 1),
    ("alpha", 2),
    ("emission", 4),
    ("metallic", 8),
    ("roughness", 16),
];

/// Renames whole identifiers in WGSL text: `map` is (from, to).
fn rename(text: &str, map: &[(&str, &str)]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = String::new();
    let flush = |word: &mut String, out: &mut String| {
        let w = map
            .iter()
            .find(|(f, _)| f == word)
            .map_or(word.as_str(), |(_, t)| t);
        out.push_str(w);
        word.clear();
    };
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            word.push(ch);
        } else {
            flush(&mut word, &mut out);
            out.push(ch);
        }
    }
    flush(&mut word, &mut out);
    out
}

/// The WGSL for a checked material operator, to be added to a renderer's own module: its frame
/// and inputs at bind groups `groups` (frame, inputs), every global it declares prefixed `op_`
/// so none meets the renderer's, and `fn op_material(g: MatGeom) -> MatOut`, which runs its
/// steps for one fragment.
pub fn material(c: &Checked, options: Options, groups: [u32; 2]) -> String {
    assert_eq!(c.op.kind, Kind::Material, "a material operator");
    let mut w = writer(c, options);
    w.line("let pos = g.pos;");
    prologue(&mut w);
    w.line("var o = MatOut(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<u32>(0u));");
    for (name, bit) in MAT_OUTPUTS {
        let Some(a) = c.op.outputs.get(*name) else {
            continue;
        };
        let (e, t) = w.arg(a);
        let line = match *name {
            "base_color" => format!("o.base = vec4<f32>({}, o.base.w);", cast(&e, &t, &Ty::V(Sc::F32, 3))),
            "alpha" => format!("o.base.w = {};", cast(&e, &t, &Ty::F32)),
            "emission" => format!("o.emission = vec4<f32>({}, 0.0);", cast(&e, &t, &Ty::V(Sc::F32, 3))),
            "metallic" => format!("o.mr.x = {};", cast(&e, &t, &Ty::F32)),
            _ => format!("o.mr.y = {};", cast(&e, &t, &Ty::F32)),
        };
        w.line(&line);
        w.line(&format!("o.wrote.x = o.wrote.x | {bit}u;"));
    }
    w.line("return o;");
    let mut m = String::new();
    bindings(c, options, &mut m);
    m.push_str(&w.globals);
    m.push_str(MAT_GEOM);
    m.push_str(MAT_OUT);
    m.push_str("fn material(g: MatGeom) -> MatOut {\n");
    m.push_str(&w.out);
    m.push_str("}\n");
    let m = m
        .replace("@group(0)", &format!("@group({})", groups[0]))
        .replace("@group(1)", &format!("@group({})", groups[1]));
    let header = format!("// {}: written by the core from its checked steps.\n", c.op.id);
    header
        + &rename(
            &m,
            &[
                ("Frame", "OpFrame"),
                ("frame", "op_frame"),
                ("Inputs", "OpInputs"),
                ("inputs", "op_inputs"),
                ("smp", "op_smp"),
                ("deep_hash1", "op_hash1"),
                ("deep_corner2", "op_corner2"),
                ("deep_noise2", "op_noise2"),
                ("material", "op_material"),
            ],
        )
}

/// A material operator as a runnable module: its function at groups 0 and 1, called by a
/// full-screen pass whose surface faces the eye with a normal that sweeps across the frame
/// (`normalize(uv × 2 − 1, 1)`, the same in every space), writing base color plus emission. The
/// check's one run and the step references draw material steps through it.
pub fn material_harness(c: &Checked, options: Options) -> String {
    let mut m = material(c, options, [0, 1]);
    m.push_str(
        "struct HOut { @builtin(position) pos: vec4<f32> };
@vertex
fn vs(@builtin(vertex_index) vi: u32) -> HOut {
    let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    return HOut(vec4<f32>(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0));
}
@fragment
fn fs(in: HOut) -> @location(0) vec4<f32> {
    let uv = in.pos.xy * op_frame.size.zw;
    let n = normalize(vec3<f32>(uv * 2.0 - 1.0, 1.0));
    let o = op_material(MatGeom(in.pos, n, n, n));
    return vec4<f32>(o.base.xyz + o.emission.xyz, 1.0);
}
",
    );
    m
}

/// The WGSL module for a checked compute operator: one invocation per element, those past the
/// operator's elements writing nothing.
pub fn compute(c: &Checked, options: Options) -> String {
    assert_eq!(c.op.kind, Kind::Compute, "a compute operator");
    let mut w = writer(c, options);
    // An indirect dispatch's last workgroup holds invocations past its count (#484).
    if c.op.counted && !options.no_count_guard {
        let count = input_ident(crate::graph::DISPATCH_COUNT);
        w.line(&format!("if gid.x >= min({count}[0], {}u) {{ return; }}", c.op.elements));
    } else {
        w.line(&format!("if gid.x >= {}u {{ return; }}", c.op.elements));
    }
    w.line("let e = gid.x;");
    prologue(&mut w);
    let mut m = String::new();
    let _ = writeln!(
        m,
        "// {}: written by the core from its checked steps.",
        c.op.id
    );
    bindings(c, options, &mut m);
    m.push_str(&w.globals);
    let _ = writeln!(
        m,
        "@compute @workgroup_size({})\nfn cs(@builtin(global_invocation_id) gid: vec3<u32>) {{",
        c.op.workgroup
    );
    m.push_str(&w.out);
    m.push_str("}\n");
    m
}
