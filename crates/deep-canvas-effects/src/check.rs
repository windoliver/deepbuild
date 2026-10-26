//! The operator check (canvas primitives: Compile, validate and cache; Operator cost and limits;
//! Determinism class), in order: closed ops, types, a DAG, fixed repeat counts, the rules for its
//! kind, limits, determinism and cost. Nothing reaches the emitter, let alone the GPU, before it
//! passes; each refusal names its step, field or output.

// A refusal is the check's whole answer, made once per refused operator, so its size never matters.
#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::graph::{
    self, Arg, Body, Class, Count, From, Issue, Kind, Operator, Origin, Sc, Step, Tex, Ty,
};
use crate::table::{self, Def};

/// Graphs as written hold at most this many steps.
pub const MAX_STEPS: usize = 256;
/// A repeat's count, at most.
pub const MAX_COUNT: u32 = 64;
/// Repeats nest at most this deep.
pub const MAX_NEST: usize = 2;
/// Trips per invocation, over every nested repeat.
pub const MAX_TRIPS: u32 = 256;
pub const MAX_TEXTURES: usize = 8;
pub const MAX_ELEMENTS: u32 = 1_048_576;

/// Fetches per invocation, by kind.
pub fn max_fetches(kind: Kind) -> u32 {
    match kind {
        Kind::Material => 16,
        Kind::Pass => 32,
        Kind::Compute => 8,
    }
}

/// ns per unit of op weight and per fetch, on the reference Mac (estimates until calibrated).
pub const NS_PER_UNIT: f64 = 0.0002;
pub const NS_PER_FETCH: f64 = 0.003;

/// An operator that passed: its steps in evaluation order with every value's type, its class
/// and its estimate.
#[derive(Clone, Debug)]
pub struct Checked {
    pub op: Operator,
    /// The top-level steps in an order where each follows what it reads.
    pub order: Vec<String>,
    /// Each body's steps in order, by repeat step ID.
    pub body_order: BTreeMap<String, Vec<String>>,
    /// Every value's type: `step` or `step.port`, inputs by name.
    pub types: BTreeMap<String, Ty>,
    pub class: Class,
    /// ns per pixel (or element) the steps cost, estimated.
    pub estimate: f64,
    pub fetches: u32,
    /// The texture inputs, in binding order.
    pub textures: Vec<String>,
    /// The storage inputs, in binding order, after the textures.
    pub storage_inputs: Vec<String>,
}

/// A value's name in the type map.
pub fn key(step: &str, port: Option<&str>) -> String {
    match port {
        Some(p) => format!("{step}.{p}"),
        None => step.to_string(),
    }
}

/// An accumulator's name in the type map: kept apart from the body step that gives its next
/// value, which carries the same name.
pub fn acc_key(name: &str) -> String {
    format!("acc:{name}")
}

struct Ctx<'a> {
    op: &'a Operator,
    types: BTreeMap<String, Ty>,
    exact: bool,
    weight: f64,
    fetches: u32,
    body_order: BTreeMap<String, Vec<String>>,
    /// The accumulators in scope, innermost repeat last.
    accs: Vec<BTreeSet<String>>,
}

fn lanes(t: &Ty) -> Option<(Sc, u8)> {
    match t {
        Ty::V(sc, n) => Some((*sc, *n)),
        Ty::Int => Some((Sc::I32, 1)),
        _ => None,
    }
}

/// Two number operands' common type: a literal integer takes the other's scalar, an integer
/// widens to f32, and a scalar splats to the other's lanes.
pub fn unify(a: &Ty, b: &Ty) -> Result<Ty, String> {
    if *a == Ty::Int && *b == Ty::Int {
        return Ok(Ty::Int);
    }
    let (Some((sa, na)), Some((sb, nb))) = (lanes(a), lanes(b)) else {
        return Err(format!("{} and {} aren't numbers", a.wgsl(), b.wgsl()));
    };
    let sc = match (a, b) {
        (Ty::Int, _) => sb,
        (_, Ty::Int) => sa,
        _ if sa == sb => sa,
        _ if sa == Sc::F32 && sb.is_int() || sb == Sc::F32 && sa.is_int() => Sc::F32,
        _ => {
            return Err(format!(
                "{} and {} don't convert by widening",
                a.wgsl(),
                b.wgsl()
            ))
        }
    };
    let n = match (na, nb) {
        _ if na == nb => na,
        (1, n) | (n, 1) => n,
        _ => {
            return Err(format!(
                "{} and {} have different lanes",
                a.wgsl(),
                b.wgsl()
            ))
        }
    };
    Ok(Ty::V(sc, n))
}

fn float(t: &Ty) -> Result<Ty, String> {
    match t {
        Ty::Int => Ok(Ty::F32),
        Ty::V(Sc::Bool, _) => Err("a bool isn't a number".into()),
        Ty::V(_, n) => Ok(Ty::V(Sc::F32, *n)),
        other => Err(format!("{} isn't a number", other.wgsl())),
    }
}

fn concrete(t: Ty) -> Ty {
    if t == Ty::Int {
        Ty::I32
    } else {
        t
    }
}

/// A literal's type: an integer, a float, a bool or a vector of them.
pub fn literal(v: &Value) -> Option<Ty> {
    match v {
        Value::Bool(_) => Some(Ty::BOOL),
        Value::Number(n) if n.is_i64() || n.is_u64() => Some(Ty::Int),
        Value::Number(_) => Some(Ty::F32),
        Value::Array(a) if (2..=4).contains(&a.len()) => {
            let mut t = literal(&a[0])?;
            for x in &a[1..] {
                t = unify(&t, &literal(x)?).ok()?;
            }
            let (sc, _) = lanes(&t)?;
            let sc = if t == Ty::Int { Sc::F32 } else { sc };
            Some(Ty::V(sc, a.len() as u8))
        }
        _ => None,
    }
}

/// The type a const step declares, or its value's.
pub fn const_type(step: &Step) -> Result<Ty, String> {
    let value = step.fields.get("value").ok_or("const takes a value")?;
    if let Some(t) = step.fields.get("type") {
        let t = t.as_str().and_then(Ty::parse).ok_or("not a type")?;
        let fits = match (&t, value) {
            (Ty::Arr(_, _, n), Value::Array(a)) => a.len() as u32 == *n,
            (Ty::V(_, 1), Value::Number(_) | Value::Bool(_)) => true,
            (Ty::V(_, n), Value::Array(a)) => a.len() == *n as usize,
            (Ty::Mat(n), Value::Array(a)) => a.len() == (*n as usize) * (*n as usize),
            _ => false,
        };
        return if fits {
            Ok(t)
        } else {
            Err(format!("{value} isn't a {}", t.wgsl()))
        };
    }
    literal(value)
        .map(concrete)
        .ok_or_else(|| format!("{value} is not a literal of a step type"))
}

fn pick_lane(c: char) -> Option<u8> {
    "xyzw".find(c).or_else(|| "rgba".find(c)).map(|i| i as u8)
}

impl Ctx<'_> {
    fn is_acc(&self, name: &str) -> bool {
        self.accs.last().is_some_and(|a| a.contains(name))
    }

    fn ty_of(&self, scope: &BTreeSet<String>, a: &Arg, step: &str) -> Result<Ty, Issue> {
        match a {
            Arg::Lit(v) => literal(v).ok_or_else(|| {
                if v.as_str().is_some() {
                    Issue::at_step("operator_source", step, "a literal string is not a value")
                } else {
                    Issue::at_step(
                        "operator_type",
                        step,
                        format!("{v} is not a literal of a step type"),
                    )
                }
            }),
            Arg::Ref(name, None) if self.is_acc(name) => Ok(self.types[&acc_key(name)].clone()),
            Arg::Ref(name, port) => {
                let k = key(name, port.as_deref());
                let visible = scope.contains(name) || self.op.inputs.contains_key(name);
                match self.types.get(&k) {
                    Some(t) if visible => Ok(t.clone()),
                    _ => Err(Issue::at_step(
                        "operator_type",
                        step,
                        format!("{k} names no step, input or accumulator before it"),
                    )),
                }
            }
        }
    }

    /// Types one step from its arguments' types; returns its output ports' types.
    fn step(
        &mut self,
        id: &str,
        s: &Step,
        scope: &BTreeSet<String>,
        depth: usize,
        trips: u32,
        divergent: bool,
    ) -> Result<Vec<(Option<String>, Ty)>, Issue> {
        let Some(def) = table::def(&s.op) else {
            return Err(Issue::at_step(
                "operator_unknown_op",
                id,
                format!("{} is not in the op table (gpu.step@1)", s.op),
            ));
        };
        let bad = |m: String| Issue::at_step("operator_type", id, m);
        if def.kinds & self.op.kind.bit() == 0 {
            return Err(Issue::at_step(
                "operator_kind_rule",
                id,
                format!(
                    "{} can't appear in a {} operator",
                    s.op,
                    self.op.kind.name()
                ),
            ));
        }
        for port in s.args.keys() {
            if !def.ports.contains(&port.as_str()) {
                return Err(bad(format!("{} has no port {port}", s.op)));
            }
        }
        if s.when.is_some() && self.op.kind != Kind::Compute {
            return Err(Issue::at_step(
                "operator_kind_rule",
                id,
                "when guards a compute write only",
            ));
        }
        let derivative = matches!(s.op.as_str(), "ddx@1" | "ddy@1" | "fwidth@1")
            || (s.op == "sample@1" && !s.args.contains_key("lod"));
        if derivative && (divergent || s.when.is_some()) {
            return Err(Issue::at_step(
                "operator_kind_rule",
                id,
                "derivative_in_divergent_flow: a derivative under a when or in a repeat with a stop_if",
            ));
        }
        let name = s.op.split('@').next().unwrap_or("");
        if name == "repeat" {
            return self.repeat(id, s, scope, depth, trips);
        }
        if name == "write" {
            self.write(id, s, scope)?;
            self.cost(def, &BTreeMap::new(), &Ty::U32, trips);
            return Ok(Vec::new());
        }
        let mut args: BTreeMap<&str, Ty> = BTreeMap::new();
        for (port, a) in &s.args {
            args.insert(port.as_str(), self.ty_of(scope, a, id)?);
        }
        let need = |p: &str| -> Result<Ty, Issue> {
            args.get(p)
                .cloned()
                .ok_or_else(|| Issue::at_step("operator_type", id, format!("{} needs {p}", s.op)))
        };
        let int_of = |p: &str| -> Result<Ty, Issue> {
            let t = concrete(need(p)?);
            match lanes(&t) {
                Some((sc, _)) if sc.is_int() => Ok(t),
                _ => Err(Issue::at_step(
                    "operator_type",
                    id,
                    format!("{} takes integers", s.op),
                )),
            }
        };
        let out: Ty = match name {
            "const" => const_type(s).map_err(bad)?,
            "convert" | "bitcast" => {
                let to = s
                    .fields
                    .get("to")
                    .and_then(Value::as_str)
                    .and_then(Ty::parse)
                    .ok_or_else(|| bad(format!("{} takes to: a type", s.op)))?;
                let x = concrete(need("x")?);
                match (lanes(&x), lanes(&to)) {
                    (Some((xs, a)), Some((ts, b)))
                        if name == "bitcast" && a == b && xs != Sc::Bool && ts != Sc::Bool =>
                    {
                        to
                    }
                    (Some((_, a)), Some((_, b))) if name == "convert" && (a == b || a == 1) => to,
                    _ => return Err(bad(format!("{} doesn't {name} to {}", x.wgsl(), to.wgsl()))),
                }
            }
            "compose" => {
                let mut sc = None;
                let mut n = 0u8;
                for p in ["x", "y", "z", "w"] {
                    let Some(t) = args.get(p) else { break };
                    let (s2, l) = lanes(t).ok_or_else(|| bad("compose takes numbers".into()))?;
                    let s2 = if *t == Ty::Int { None } else { Some(s2) };
                    sc = match (sc, s2) {
                        (None, x) | (x, None) => x,
                        (Some(a), Some(b)) if a == b => Some(a),
                        (Some(a), Some(b))
                            if a == Sc::F32 && b.is_int() || b == Sc::F32 && a.is_int() =>
                        {
                            Some(Sc::F32)
                        }
                        _ => return Err(bad("compose's lanes have different types".into())),
                    };
                    n += l;
                }
                if !(2..=4).contains(&n) {
                    return Err(bad(format!("compose makes 2 to 4 lanes, not {n}")));
                }
                Ty::V(sc.unwrap_or(Sc::F32), n)
            }
            "split" => {
                let x = need("x")?;
                let (sc, n) = lanes(&x).ok_or_else(|| bad("split takes a vector".into()))?;
                let pick = s
                    .fields
                    .get("pick")
                    .and_then(Value::as_str)
                    .ok_or_else(|| bad("split takes pick: lanes such as xyz".into()))?;
                if pick.is_empty() || pick.len() > 4 {
                    return Err(bad("pick names 1 to 4 lanes".into()));
                }
                for c in pick.chars() {
                    match pick_lane(c) {
                        Some(l) if l < n => {}
                        _ => {
                            return Err(Issue::at_step(
                                "operator_limit",
                                id,
                                format!("index past declared length: lane {c} of a {n}-lane value"),
                            ))
                        }
                    }
                }
                Ty::V(if x == Ty::Int { Sc::I32 } else { sc }, pick.len() as u8)
            }
            "add" | "sub" | "div" | "rem" | "min" | "max" => {
                unify(&need("a")?, &need("b")?).map_err(bad)?
            }
            "mul" => match (need("a")?, need("b")?) {
                (Ty::Mat(n), Ty::V(Sc::F32, m)) if m == n => Ty::V(Sc::F32, n),
                (Ty::Mat(n), Ty::Mat(m)) if m == n => Ty::Mat(n),
                (a, b) => unify(&a, &b).map_err(bad)?,
            },
            "mod" | "pow" => float(&unify(&need("a")?, &need("b")?).map_err(bad)?).map_err(bad)?,
            "atan2" => float(&unify(&need("y")?, &need("x")?).map_err(bad)?).map_err(bad)?,
            "neg" | "abs" | "sign" | "floor" | "ceil" | "round" | "trunc" => {
                let x = need("x")?;
                lanes(&x).ok_or_else(|| bad("a number".into()))?;
                concrete(x)
            }
            "count_ones" | "first_leading_bit" | "first_trailing_bit" => int_of("x")?,
            "fract" | "sqrt" | "inverse_sqrt" | "exp" | "exp2" | "log" | "log2" | "sin" | "cos"
            | "tan" | "asin" | "acos" | "atan" | "normalize" | "ddx" | "ddy" | "fwidth" => {
                float(&need("x")?).map_err(bad)?
            }
            "clamp" => {
                let t = unify(&need("x")?, &need("lo")?).map_err(bad)?;
                concrete(unify(&t, &need("hi")?).map_err(bad)?)
            }
            "mix" => {
                let t = float(&unify(&need("a")?, &need("b")?).map_err(bad)?).map_err(bad)?;
                unify(&t, &need("t")?).map_err(bad)?;
                t
            }
            "smoothstep" => {
                let t = unify(&need("lo")?, &need("hi")?).map_err(bad)?;
                float(&unify(&t, &need("x")?).map_err(bad)?).map_err(bad)?
            }
            "length" => {
                float(&need("x")?).map_err(bad)?;
                Ty::F32
            }
            "distance" => {
                float(&unify(&need("a")?, &need("b")?).map_err(bad)?).map_err(bad)?;
                Ty::F32
            }
            "dot" => {
                let t = unify(&need("a")?, &need("b")?).map_err(bad)?;
                let (sc, _) = lanes(&t).ok_or_else(|| bad("dot takes vectors".into()))?;
                Ty::V(sc, 1)
            }
            "cross" => match float(&unify(&need("a")?, &need("b")?).map_err(bad)?).map_err(bad)? {
                Ty::V(Sc::F32, 3) => Ty::V(Sc::F32, 3),
                _ => return Err(bad("cross takes vec3s".into())),
            },
            "transpose" => match need("x")? {
                Ty::Mat(n) => Ty::Mat(n),
                _ => return Err(bad("transpose takes a matrix".into())),
            },
            "and" | "or" | "xor" => {
                let (a, b) = (need("a")?, need("b")?);
                let t = if a == b && matches!(a, Ty::V(Sc::Bool, _)) {
                    a
                } else {
                    concrete(unify(&a, &b).map_err(bad)?)
                };
                match t {
                    Ty::V(Sc::F32, _) => {
                        return Err(bad("and, or and xor take integers or bools".into()))
                    }
                    t => t,
                }
            }
            "not" => concrete(need("x")?),
            "shl" | "shr" => {
                let a = int_of("a")?;
                int_of("b")?;
                a
            }
            "eq" | "ne" | "lt" | "le" | "gt" | "ge" => {
                let t = unify(&need("a")?, &need("b")?).map_err(bad)?;
                let (_, n) = lanes(&t).ok_or_else(|| bad("compares take numbers".into()))?;
                Ty::V(Sc::Bool, n)
            }
            "all" | "any" => Ty::BOOL,
            "select" => {
                let (f, t) = (need("f")?, need("t")?);
                let t = if f == t {
                    f
                } else {
                    concrete(unify(&f, &t).map_err(bad)?)
                };
                match need("cond")? {
                    Ty::V(Sc::Bool, _) => t,
                    _ => return Err(bad("select's cond is a bool".into())),
                }
            }
            "hash" => {
                for (p, t) in &args {
                    match t {
                        Ty::Int | Ty::V(Sc::U32 | Sc::I32, 1) => {}
                        _ => return Err(bad(format!("hash takes u32s; {p} is {}", t.wgsl()))),
                    }
                }
                if args.is_empty() {
                    return Err(bad("hash takes at least one u32".into()));
                }
                Ty::U32
            }
            "rand" => {
                match need("key")? {
                    Ty::Int | Ty::V(Sc::U32, 1) => {}
                    t => return Err(bad(format!("rand takes a u32 key, not {}", t.wgsl()))),
                }
                Ty::F32
            }
            "screen_uv" | "screen_size" => Ty::V(Sc::F32, 2),
            "pixel" => Ty::V(Sc::U32, 2),
            "element" => Ty::U32,
            "seed" => Ty::U32,
            "t" => Ty::F32,
            "camera" => match s.fields.get("of").and_then(Value::as_str) {
                Some("clip" | "inverse_clip") => Ty::Mat(4),
                Some("position") => Ty::V(Sc::F32, 3),
                Some("near") => Ty::F32,
                _ => {
                    return Err(bad(
                        "camera takes of: clip, inverse_clip, position or near".into()
                    ))
                }
            },
            "luminance" => {
                match float(&need("rgb")?).map_err(bad)? {
                    Ty::V(Sc::F32, 3) => {}
                    _ => return Err(bad("luminance takes a vec3".into())),
                }
                Ty::F32
            }
            "sample" => {
                match need("tex")? {
                    Ty::Tex(Tex::Float) => {}
                    t => {
                        return Err(bad(format!(
                            "sample reads a float texture, not {}",
                            t.wgsl()
                        )))
                    }
                }
                if float(&need("uv")?).map_err(bad)? != Ty::V(Sc::F32, 2) {
                    return Err(bad("sample's uv is a vec2".into()));
                }
                if let Some(lod) = args.get("lod") {
                    float(lod).map_err(bad)?;
                }
                Ty::V(Sc::F32, 4)
            }
            "load" => {
                let tex = need("tex")?;
                match lanes(&need("ixy")?) {
                    Some((sc, 2)) if sc.is_int() => {}
                    _ => return Err(bad("load's ixy is a vec2 of integers".into())),
                }
                match tex {
                    Ty::Tex(Tex::Float) => Ty::V(Sc::F32, 4),
                    Ty::Tex(Tex::Uint) => Ty::U32,
                    Ty::Tex(Tex::Depth) => Ty::F32,
                    t => return Err(bad(format!("load reads a texture, not {}", t.wgsl()))),
                }
            }
            "size" => match need("tex")? {
                Ty::Tex(_) => Ty::V(Sc::U32, 2),
                t => return Err(bad(format!("size reads a texture, not {}", t.wgsl()))),
            },
            "index" => {
                let (sc, l, n) = match need("a")? {
                    Ty::Arr(sc, l, n) => (sc, l, n),
                    t => return Err(bad(format!("index reads an array, not {}", t.wgsl()))),
                };
                if let Some(Arg::Lit(v)) = s.args.get("i") {
                    let i = v
                        .as_u64()
                        .ok_or_else(|| bad("an index is an integer".into()))?;
                    if i >= u64::from(n) {
                        return Err(Issue::at_step(
                            "operator_limit",
                            id,
                            format!("index past declared length: index {i} of an array of {n}"),
                        ));
                    }
                }
                int_of("i")?;
                Ty::V(sc, l)
            }
            "read" => {
                let (sc, n) = match need("buf")? {
                    Ty::Storage(sc, n) => (sc, n),
                    t => return Err(bad(format!("read takes storage, not {}", t.wgsl()))),
                };
                if let Some(Arg::Lit(v)) = s.args.get("i") {
                    if n > 0 && v.as_u64().is_some_and(|i| i >= u64::from(n)) {
                        return Err(Issue::at_step(
                            "operator_limit",
                            id,
                            format!("index past declared length: element {v} of storage of {n}"),
                        ));
                    }
                }
                int_of("i")?;
                Ty::V(sc, 1)
            }
            "discard_if" => {
                match need("cond")? {
                    Ty::V(Sc::Bool, 1) => {}
                    _ => return Err(bad("discard_if takes a bool".into())),
                }
                return Ok(Vec::new());
            }
            _ => {
                return Err(Issue::at_step(
                    "operator_unknown_op",
                    id,
                    format!("{} has no typing rule", s.op),
                ))
            }
        };
        let out = concrete(out);
        self.cost(def, &args, &out, trips);
        Ok(vec![(None, out)])
    }

    /// `write(buf, i, v)`: `buf` names one of the operator's storage outputs, and a constant
    /// index past its declared count is refused.
    fn write(&mut self, id: &str, s: &Step, scope: &BTreeSet<String>) -> Result<(), Issue> {
        let bad = |m: String| Issue::at_step("operator_type", id, m);
        let out = match s.args.get("buf") {
            Some(Arg::Ref(name, None)) => self
                .op
                .storage
                .get(name)
                .ok_or_else(|| bad(format!("write's buf {name} names no storage output")))?,
            _ => return Err(bad("write's buf names a storage output".into())),
        };
        match s.args.get("i") {
            Some(Arg::Lit(v)) => {
                let i = v
                    .as_u64()
                    .ok_or_else(|| bad("an index is an integer".into()))?;
                if i >= u64::from(out.count) {
                    return Err(Issue::at_step(
                        "operator_limit",
                        id,
                        format!(
                            "index past declared length: a write at element {i} of storage of {}",
                            out.count
                        ),
                    ));
                }
            }
            Some(a) => match lanes(&concrete(self.ty_of(scope, a, id)?)) {
                Some((sc, 1)) if sc.is_int() => {}
                _ => return Err(bad("write's i is an integer".into())),
            },
            None => return Err(bad("write takes i".into())),
        }
        let v = self.ty_of(
            scope,
            s.args.get("v").ok_or_else(|| bad("write takes v".into()))?,
            id,
        )?;
        let want = Ty::V(out.sc, 1);
        if concrete(unify(&want, &v).map_err(bad)?) != want {
            return Err(bad(format!(
                "write's v is {}, not {}",
                v.wgsl(),
                want.wgsl()
            )));
        }
        if let Some(w) = &s.when {
            if !scope.contains(w) || self.types.get(w) != Some(&Ty::BOOL) {
                return Err(bad(format!(
                    "when names {w}, which is no bool step before it"
                )));
            }
        }
        Ok(())
    }

    fn cost(&mut self, def: &Def, args: &BTreeMap<&str, Ty>, out: &Ty, trips: u32) {
        let lanes_of = |t: &Ty| match t {
            Ty::V(_, n) => f64::from(*n),
            Ty::Mat(n) => f64::from(*n) * f64::from(*n),
            _ => 1.0,
        };
        self.weight += def.weight * lanes_of(out) * f64::from(trips);
        self.fetches += def.fetches * trips;
        let floats = |t: &Ty| {
            matches!(
                t,
                Ty::V(Sc::F32, _)
                    | Ty::Mat(_)
                    | Ty::Tex(Tex::Float | Tex::Depth)
                    | Ty::Storage(Sc::F32, _)
            )
        };
        if !def.exact || floats(out) || args.values().any(floats) {
            self.exact = false;
        }
    }

    fn repeat(
        &mut self,
        id: &str,
        s: &Step,
        scope: &BTreeSet<String>,
        depth: usize,
        trips: u32,
    ) -> Result<Vec<(Option<String>, Ty)>, Issue> {
        let body: &Body = s
            .body
            .as_deref()
            .ok_or_else(|| Issue::at_step("operator_type", id, "repeat has a body"))?;
        if depth + 1 > MAX_NEST {
            return Err(Issue::at_step(
                "operator_limit",
                id,
                format!("repeats nest at most {MAX_NEST} deep"),
            ));
        }
        let count = match &body.count {
            Count::Const(c) => *c,
            Count::Input(name) => {
                let input = self.op.inputs.get(name).ok_or_else(|| {
                    Issue::at_step(
                        "operator_unbounded",
                        id,
                        format!("a loop whose count isn't fixed at check: {name} is no input"),
                    )
                })?;
                match input.range.map(|r| r[1]).filter(|m| m.is_finite() && *m >= 0.0) {
                    Some(m) if m <= f64::from(MAX_COUNT) => m as u32,
                    Some(m) => {
                        return Err(Issue::at_step(
                            "operator_unbounded",
                            id,
                            format!("a loop whose count isn't fixed at check: input {name} ranges to {m}, past the {MAX_COUNT} a repeat may run"),
                        ))
                    }
                    None => {
                        return Err(Issue::at_step(
                            "operator_unbounded",
                            id,
                            format!("a loop whose count isn't fixed at check: input {name} has no maximum"),
                        ))
                    }
                }
            }
            Count::Unbounded(what) => {
                return Err(Issue::at_step(
                    "operator_unbounded",
                    id,
                    format!("a loop whose count isn't fixed at check ({what}); repeat takes a constant or an input with a max ≤ {MAX_COUNT}"),
                ))
            }
        };
        if count > MAX_COUNT {
            return Err(Issue::at_step(
                "operator_unbounded",
                id,
                format!("count {count} is past the {MAX_COUNT} a repeat may run"),
            ));
        }
        let trips = trips.saturating_mul(count.max(1));
        if trips > MAX_TRIPS {
            return Err(Issue::at_step(
                "operator_limit",
                id,
                format!("{trips} trips per invocation, past {MAX_TRIPS}"),
            ));
        }
        let mut names = BTreeSet::new();
        let mut outs = Vec::new();
        for (name, ty, init) in &body.accumulate {
            let it = self.ty_of(scope, init, id)?;
            unify(ty, &it).map_err(|m| {
                Issue::at_step("operator_type", id, format!("accumulator {name}: {m}"))
            })?;
            self.types.insert(acc_key(name), ty.clone());
            names.insert(name.clone());
            outs.push((Some(name.clone()), ty.clone()));
        }
        let mut inner = scope.clone();
        self.types.insert(body.index.clone(), Ty::U32);
        inner.insert(body.index.clone());
        self.accs.push(names);
        let order = self.graph(
            &body.steps,
            &mut inner,
            depth + 1,
            trips,
            body.stop_if.is_some(),
        );
        let order = match order {
            Ok(o) => o,
            Err(e) => {
                self.accs.pop();
                return Err(e);
            }
        };
        for (name, ty, _) in &body.accumulate {
            let next = self
                .types
                .get(name)
                .filter(|_| body.steps.contains_key(name))
                .ok_or_else(|| {
                    Issue::at_step(
                        "operator_type",
                        id,
                        format!("the body has no step named {name} for its next value"),
                    )
                })?;
            unify(ty, next).map_err(|m| {
                Issue::at_step("operator_type", id, format!("{name}'s next value: {m}"))
            })?;
        }
        if let Some(stop) = &body.stop_if {
            if self.ty_of(&inner, stop, id)? != Ty::BOOL {
                self.accs.pop();
                return Err(Issue::at_step("operator_type", id, "stop_if is a bool"));
            }
        }
        self.accs.pop();
        self.body_order.insert(id.to_string(), order);
        Ok(outs)
    }

    /// Types a graph's steps in dependency order, refusing a cycle.
    fn graph(
        &mut self,
        steps: &BTreeMap<String, Step>,
        scope: &mut BTreeSet<String>,
        depth: usize,
        trips: u32,
        divergent: bool,
    ) -> Result<Vec<String>, Issue> {
        if steps.len() > MAX_STEPS {
            return Err(Issue::at_path(
                "operator_limit",
                "steps",
                format!("{} steps, past {MAX_STEPS}", steps.len()),
            ));
        }
        let accs = self.accs.last().cloned().unwrap_or_default();
        // What a step reads among these steps: an accumulator's name means the accumulator.
        let reads = |s: &Step| -> BTreeSet<String> {
            let mut r = BTreeSet::new();
            let here = |a: &Arg| match a {
                Arg::Ref(step, port)
                    if steps.contains_key(step) && !(port.is_none() && accs.contains(step)) =>
                {
                    Some(step.clone())
                }
                _ => None,
            };
            r.extend(s.args.values().filter_map(here));
            if let Some(w) = &s.when {
                r.extend(here(&Arg::Ref(w.clone(), None)));
            }
            let mut stack: Vec<&Body> = s.body.iter().map(|b| &**b).collect();
            while let Some(b) = stack.pop() {
                for x in b.steps.values() {
                    for a in x.args.values() {
                        if let Arg::Ref(step, _) = a {
                            if steps.contains_key(step) && !b.steps.contains_key(step) {
                                r.insert(step.clone());
                            }
                        }
                    }
                }
                r.extend(b.accumulate.iter().filter_map(|(_, _, a)| here(a)));
                stack.extend(b.steps.values().filter_map(|x| x.body.as_deref()));
            }
            r
        };
        // Kahn's algorithm over the steps' reads, ties broken by ID.
        let mut indegree: BTreeMap<&str, usize> = BTreeMap::new();
        let mut users: BTreeMap<String, Vec<&str>> = BTreeMap::new();
        for (id, s) in steps {
            let r = reads(s);
            if r.contains(id) {
                return Err(Issue::at_step("operator_cycle", id, "a step reads itself"));
            }
            indegree.insert(id, r.len());
            for dep in r {
                users.entry(dep).or_default().push(id);
            }
        }
        let mut ready: BTreeSet<&str> = indegree
            .iter()
            .filter(|(_, n)| **n == 0)
            .map(|(k, _)| *k)
            .collect();
        let mut order = Vec::new();
        while let Some(id) = ready.pop_first() {
            order.push(id.to_string());
            for u in users.get(id).map(Vec::as_slice).unwrap_or(&[]) {
                let n = indegree.get_mut(u).expect("a user is a step");
                *n -= 1;
                if *n == 0 {
                    ready.insert(u);
                }
            }
        }
        if order.len() < steps.len() {
            let stuck = indegree
                .iter()
                .find(|(_, n)| **n > 0)
                .map(|(k, _)| *k)
                .unwrap_or("");
            return Err(Issue::at_step(
                "operator_cycle",
                stuck,
                "the steps don't form a DAG",
            ));
        }
        for id in &order {
            let s = &steps[id];
            for (port, ty) in self.step(id, s, scope, depth, trips, divergent)? {
                self.types.insert(key(id, port.as_deref()), ty);
            }
            scope.insert(id.clone());
        }
        Ok(order)
    }
}

fn input_class(from: &From) -> Class {
    match from {
        From::Target { .. } | From::Time | From::Phase(_) | From::Channel(_) => Class::SameMachine,
        // Storage carries its writer's bits; an operator's class over them is its own.
        From::Param(_) | From::Seed | From::Role(_) | From::Storage { .. } => Class::Exact,
    }
}

/// Checks an operator: Ok with what the emitter and the interpreter need, or every refusal.
pub fn check(op: &Operator) -> Result<Checked, Vec<Issue>> {
    if op.source.is_some() {
        return Err(vec![Issue::at_path(
            "operator_source",
            "source",
            "a WGSL-subset source reaches the check only once the front end has lowered it to steps",
        )]);
    }
    let mut ctx = Ctx {
        op,
        types: BTreeMap::new(),
        exact: true,
        weight: 0.0,
        fetches: 0,
        body_order: BTreeMap::new(),
        accs: Vec::new(),
    };
    let mut issues = Vec::new();
    let mut textures = Vec::new();
    let mut storage_inputs = Vec::new();
    for (name, input) in &op.inputs {
        let path = format!("inputs/{name}");
        if op.steps.contains_key(name) {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "an input and a step share a name",
            ));
        }
        if matches!(input.ty, Ty::Tex(_)) != matches!(input.from, From::Target { .. }) {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "a texture input reads a target, and only a texture input does",
            ));
        }
        match input.ty {
            Ty::Tex(_) => textures.push(name.clone()),
            Ty::Storage(..) => storage_inputs.push(name.clone()),
            _ => {}
        }
        if input_class(&input.from) != Class::Exact
            || matches!(input.ty, Ty::V(Sc::F32, _) | Ty::Mat(_))
        {
            ctx.exact = false;
        }
        ctx.types.insert(name.clone(), input.ty.clone());
    }
    if textures.len() > MAX_TEXTURES {
        issues.push(Issue::at_path(
            "operator_limit",
            "inputs",
            format!("{} textures, past {MAX_TEXTURES}", textures.len()),
        ));
    }
    if op.kind == Kind::Compute {
        if op.elements == 0 || op.elements > MAX_ELEMENTS {
            issues.push(Issue::at_path(
                "operator_limit",
                "elements",
                format!("elements is 1 to {MAX_ELEMENTS}"),
            ));
        }
        if ![64, 128, 256].contains(&op.workgroup) {
            issues.push(Issue::at_path(
                "operator_type",
                "workgroup",
                "workgroup is 64, 128 or 256",
            ));
        }
        if op.storage.is_empty() {
            issues.push(Issue::at_path(
                "operator_type",
                "outputs",
                "a compute operator writes storage",
            ));
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let mut scope = BTreeSet::new();
    let order = ctx
        .graph(&op.steps, &mut scope, 0, 1, false)
        .map_err(|e| vec![e])?;
    let total: usize = order.len() + ctx.body_order.values().map(Vec::len).sum::<usize>();
    if total > 2048 {
        return Err(vec![Issue::at_path(
            "operator_limit",
            "steps",
            format!("{total} steps inlined, past 2,048"),
        )]);
    }
    if ctx.fetches > max_fetches(op.kind) {
        return Err(vec![Issue::at_path(
            "operator_limit",
            "steps",
            format!(
                "{} fetches per invocation, past {} in a {} operator",
                ctx.fetches,
                max_fetches(op.kind),
                op.kind.name()
            ),
        )]);
    }
    for (name, a) in &op.outputs {
        let path = format!("outputs/{name}");
        let want = match (op.kind, name.as_str()) {
            (Kind::Pass, "color") => Ty::V(Sc::F32, 4),
            (Kind::Pass, "coverage") => Ty::F32,
            (Kind::Material, "base_color" | "emission") => Ty::V(Sc::F32, 3),
            (Kind::Material, "alpha" | "metallic" | "roughness") => Ty::F32,
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    format!("a {} operator has no output {name}", op.kind.name()),
                ));
                continue;
            }
        };
        match ctx.ty_of(&scope, a, name) {
            Ok(t) if unify(&want, &t).map(concrete).as_ref() == Ok(&want) => {}
            Ok(t) => issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!("{name} is {}, not {}", t.wgsl(), want.wgsl()),
            )),
            Err(mut e) => {
                e.step = None;
                e.path = Some(path);
                issues.push(e);
            }
        }
    }
    if op.kind == Kind::Pass && !op.outputs.contains_key("color") {
        issues.push(Issue::at_path(
            "operator_type",
            "outputs/color",
            "a pass writes color",
        ));
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let class = if ctx.exact {
        Class::Exact
    } else {
        Class::SameMachine
    };
    if let Some(d) = op.declared {
        if d < class {
            return Err(vec![Issue::at_path(
                "not_exact",
                "determinism",
                format!(
                    "declared {}, but its steps and inputs make it {}",
                    d.name(),
                    class.name()
                ),
            )]);
        }
    }
    let estimate = ctx.weight * NS_PER_UNIT + f64::from(ctx.fetches) * NS_PER_FETCH;
    match op.cost {
        None if op.origin != Origin::Shipped => {
            return Err(vec![Issue::at_path(
                "operator_type",
                "cost",
                "a composed operator declares its cost",
            )]);
        }
        Some(c) if !(c.is_finite() && c >= 0.0) => {
            return Err(vec![Issue::at_path(
                "operator_type",
                "cost",
                "cost is a finite number ≥ 0",
            )]);
        }
        Some(c) if estimate > c * 1.25 => {
            return Err(vec![Issue::at_path(
                "cost_understated",
                "cost",
                format!("estimated {estimate:.4} ns, more than 25% over the declared {c}"),
            )]);
        }
        _ => {}
    }
    Ok(Checked {
        op: op.clone(),
        order,
        body_order: ctx.body_order,
        types: ctx.types,
        class: op.declared.map_or(class, |d| d.max(class)),
        estimate,
        fetches: ctx.fetches,
        textures,
        storage_inputs,
    })
}

/// Reads and checks an operator's JSON.
pub fn read_and_check(v: &Value) -> Result<Checked, Vec<Issue>> {
    check(&graph::read(v)?)
}
