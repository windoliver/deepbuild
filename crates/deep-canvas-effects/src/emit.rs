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

/// A uniform slot's WGSL type: every scalar and vector input takes a whole vec4 of its scalar.
fn slot(t: &Ty) -> String {
    match t {
        Ty::V(sc, _) => format!("vec4<{}>", sc.wgsl()),
        Ty::Arr(sc, _, n) => format!("array<vec4<{}>, {n}>", sc.wgsl()),
        Ty::Mat(_) => "mat4x4<f32>".into(),
        other => other.wgsl(),
    }
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
            let store = format!("out_{buf}[min({i}, {}u)] = {v};", out.count.max(1) - 1);
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
            "size" => format!("textureDimensions({})", self.raw(s, "tex")),
            "element" => "e".into(),
            "bitcast" => format!("bitcast<{ow}>({})", self.raw(s, "x")),
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
                if sc == Sc::Bool {
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
                // An input array is read in place from the uniform, its elements in whole vec4
                // slots; a const array is a module constant.
                match s.args.get("a") {
                    Some(Arg::Ref(a, None)) if self.c.op.inputs.contains_key(a) => unslot(
                        &format!("inputs.{a}[min(u32({i}), {}u)]", n - 1),
                        &Ty::V(Sc::F32, l),
                    ),
                    _ => format!("{}[min(u32({i}), {}u)]", self.raw(s, "a"), n - 1),
                }
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
}

/// The inputs' uniform, the sampler and the texture and storage bindings, in binding order.
fn bindings(c: &Checked, m: &mut String) {
    m.push_str(FRAME);
    m.push_str(HASH);
    m.push_str("struct Inputs {\n    unused: vec4<f32>,\n");
    for (n, i) in &c.op.inputs {
        if !matches!(i.ty, Ty::Tex(_) | Ty::Storage(..))
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
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var<storage, read> {}: {};",
            input_ident(name),
            c.op.inputs[name].ty.wgsl()
        );
        b += 1;
    }
    for (name, out) in &c.op.storage {
        let _ = writeln!(
            m,
            "@group(1) @binding({b}) var<storage, read_write> out_{name}: {};",
            Ty::Storage(out.sc, out.count).wgsl()
        );
        b += 1;
    }
}

/// The function body's start: each value input read from the uniform.
fn prologue(w: &mut W<'_>) {
    for (n, i) in &w.c.op.inputs {
        let e = match i.from {
            From::Time => "frame.time.x".to_string(),
            From::Seed => "frame.seed.x".to_string(),
            // Textures and storage bind as they are, and arrays are read in place.
            _ if matches!(i.ty, Ty::Tex(_) | Ty::Arr(..) | Ty::Storage(..)) => continue,
            _ => unslot(&format!("inputs.{n}"), &i.ty),
        };
        w.line(&format!("let {}: {} = {e};", input_ident(n), i.ty.wgsl()));
    }
    // Each texture's last texel, which every load clamps to, read once.
    for n in w.c.textures.clone() {
        let t = input_ident(&n);
        w.line(&format!(
            "let last_{t}: vec2<i32> = vec2<i32>(textureDimensions({t})) - vec2<i32>(1);"
        ));
    }
    for id in w.c.order.clone() {
        let s = &w.c.op.steps[&id];
        w.step(&id, s);
    }
}

fn writer(c: &Checked) -> W<'_> {
    W {
        c,
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
    let mut w = writer(c);
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
    bindings(c, &mut m);
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

/// The WGSL module for a checked compute operator: one invocation per element, those past the
/// operator's elements writing nothing.
pub fn compute(c: &Checked) -> String {
    assert_eq!(c.op.kind, Kind::Compute, "a compute operator");
    let mut w = writer(c);
    w.line(&format!("if gid.x >= {}u {{ return; }}", c.op.elements));
    w.line("let e = gid.x;");
    prologue(&mut w);
    let mut m = String::new();
    let _ = writeln!(
        m,
        "// {}: written by the core from its checked steps.",
        c.op.id
    );
    bindings(c, &mut m);
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
