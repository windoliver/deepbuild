//! The operator check (canvas primitives: Compile, validate and cache; Operator cost and limits;
//! Determinism class), in order: closed ops, types, a DAG, fixed repeat counts, the rules for its
//! kind, limits, determinism and cost. Nothing reaches the emitter, let alone the GPU, before it
//! passes; each refusal names its step, field or output.

// A refusal is the check's whole answer, made once per refused operator, so its size never matters.
#![allow(clippy::result_large_err)]

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::graph::{
    self, Arg, Body, Class, Count, Fallback, From, Issue, Kind, Operator, Origin, Sc, Step, Tex,
    Ty,
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
/// A texture3d output's side, at most (structural steps), and a 2D texture output's.
pub const MAX_TEXTURE3D: u32 = 256;
pub const MAX_TEXTURE2D: u32 = 8192;

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
    /// Each `iterate@1` step's body, checked as a pass of its own (#483); the step itself is an
    /// input of `op`, the texture its last run writes.
    pub iterates: Vec<Iterated>,
}

/// An iterate step as the check passed it: its body a pass whose inputs are those of the
/// operator it reads, `prev` and its index.
#[derive(Clone, Debug)]
pub struct Iterated {
    pub step: String,
    pub count: u32,
    pub index: String,
    pub format: String,
    pub size: graph::Size,
    pub body: Box<Checked>,
}

/// Iterate's limits (structural steps): at most 16 runs, never nested.
pub const MAX_ITERATE: u64 = 16;
/// The formats a ping-pong target may take.
pub const PING_PONG: &[&str] = &["rgba16float", "rgba8unorm"];

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

/// What keeps an operator from being exact: a step, or an input by its path.
#[derive(Clone, Debug)]
pub enum Why {
    Step(String, String),
    Input(String, String),
}

/// The check's planted wrong programs (canvas primitives: Determinism class; the issue's
/// criteria name each one), all off in every real build.
#[derive(Clone, Copy, Debug, Default)]
pub struct CheckOptions {
    /// Takes the declared class instead of the computed one.
    pub declared_class: bool,
    /// An op table that marks f32 compares exact.
    pub exact_f32_compares: bool,
    /// An op table that marks f32 floor exact.
    pub exact_f32_floor: bool,
    /// Trusts a compute write's index.
    pub trusts_index: bool,
    /// An op table whose noise octave weight is halved.
    pub noise_weight_halved: bool,
    /// A check without the rule that refuses an implicit derivative where pixels may diverge
    /// (#431's planted check): the graph goes on to naga.
    pub no_divergence_rule: bool,
    /// The showpiece and export classes, where a material operator may take its 17th to 32nd
    /// fetches (Operator cost and limits).
    pub wide_fetches: bool,
    /// #252's planted class: a stepped operator's carried state computes as exact.
    pub carried_exact: bool,
}

struct Ctx<'a> {
    op: &'a Operator,
    types: BTreeMap<String, Ty>,
    /// The first step or input that keeps the operator from being exact, if any.
    inexact: Option<Why>,
    /// Each integer value that is an affine function `scale × element + offset` of the
    /// invocation's element index, by its name in the type map: what a compute write's index
    /// must be for each invocation to write only its own slots.
    affine: BTreeMap<String, (u64, u64)>,
    /// Steps whose value is the same in every invocation.
    uniform: BTreeSet<String>,
    options: CheckOptions,
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

/// A seeded step's literal fields (`noise@1`, `fbm@1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seeded {
    /// Per axis of p, 0 for none: the noise repeats every `period` lattice cells along it.
    pub period: [u32; 3],
    pub octaves: u32,
    pub lacunarity: f64,
    pub gain: f64,
}

/// Periods above this many cells are refused.
pub const MAX_PERIOD: u32 = 65_536;

/// A seeded step's fields, defaulted: no period, 4 octaves, lacunarity 2, gain 0.5; fbm with a
/// period takes a whole-number lacunarity, since each octave must repeat within it.
pub fn seeded_fields(s: &Step) -> Result<Seeded, String> {
    let num = |k: &str, or: f64| -> Result<f64, String> {
        match s.fields.get(k) {
            None => Ok(or),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite())
                .ok_or_else(|| format!("{k} is a number")),
        }
    };
    // One whole number of cells for every axis, or a list, one per axis of p (#431).
    let bad_period = || {
        format!(
            "period is a whole number of cells, 0 to {MAX_PERIOD}, or a list of them, one per axis"
        )
    };
    let whole = |v: &Value| {
        v.as_f64()
            .filter(|x| *x >= 0.0 && x.fract() == 0.0 && *x <= f64::from(MAX_PERIOD))
    };
    match s.fields.get("period") {
        None => {}
        Some(Value::Array(a)) if (1..=3).contains(&a.len()) => {
            if a.iter().any(|v| whole(v).is_none()) {
                return Err(bad_period());
            }
        }
        Some(v) if whole(v).is_some() => {}
        Some(_) => return Err(bad_period()),
    }
    let period = deep_canvas::steps::period_of(s.fields.get("period"));
    let octaves = num("octaves", 4.0)?;
    if !(1.0..=8.0).contains(&octaves) || octaves.fract() != 0.0 {
        return Err("octaves is 1 to 8".into());
    }
    let lacunarity = num("lacunarity", 2.0)?;
    if !(1.0..=8.0).contains(&lacunarity) {
        return Err("lacunarity is 1 to 8".into());
    }
    if period.iter().any(|p| *p > 0) && lacunarity.fract() != 0.0 {
        return Err(format!(
            "fbm with a period takes a whole-number lacunarity, not {lacunarity}: each octave must repeat within the period"
        ));
    }
    let gain = num("gain", 0.5)?;
    if !(0.0..=1.0).contains(&gain) {
        return Err("gain is 0 to 1".into());
    }
    Ok(Seeded {
        period,
        octaves: octaves as u32,
        lacunarity,
        gain,
    })
}

/// Whether a step takes implicit derivatives: `ddx`, `ddy`, `fwidth`, `triplanar` and a `sample`
/// with no `lod` (Step and the closed step list).
pub fn implicit_derivative(s: &Step) -> bool {
    matches!(
        s.op.as_str(),
        "ddx@1" | "ddy@1" | "fwidth@1" | "triplanar@1"
    ) || (s.op == "sample@1" && !s.args.contains_key("lod"))
}

/// A `cells@1`'s own fields: `jitter` from 0 to 1 (1 by default) and its metric (euclidean by
/// default).
pub fn cell_fields(s: &Step) -> Result<(f64, deep_canvas::steps::Metric), String> {
    let jitter = match s.fields.get("jitter") {
        None => 1.0,
        Some(v) => v
            .as_f64()
            .filter(|j| (0.0..=1.0).contains(j))
            .ok_or("jitter is 0 to 1")?,
    };
    let metric = match s.fields.get("metric") {
        None => deep_canvas::steps::Metric::Euclidean,
        Some(v) => v
            .as_str()
            .and_then(deep_canvas::steps::Metric::parse)
            .ok_or("metric is euclidean, manhattan or chebyshev")?,
    };
    Ok((jitter, metric))
}

/// A `homography@1`'s literal quad: four finite `[x, y]` corners, in the unit square's order
/// (0, 0), (1, 0), (1, 1), (0, 1).
pub fn quad_of(v: &Value) -> Result<[[f64; 2]; 4], String> {
    let corners: Vec<[f64; 2]> = v
        .as_array()
        .filter(|a| a.len() == 4)
        .ok_or("quad is four [x, y] corners")?
        .iter()
        .map(|p| {
            p.as_array()
                .filter(|a| a.len() == 2)
                .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
                .filter(|p| p.iter().all(|x| x.is_finite()))
                .ok_or("quad is four [x, y] corners")
        })
        .collect::<Result<_, _>>()?;
    Ok([corners[0], corners[1], corners[2], corners[3]])
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
        if implicit_derivative(s)
            && (divergent || s.when.is_some())
            && !self.options.no_divergence_rule
        {
            return Err(Issue {
                reason: Some("derivative_in_divergent_flow"),
                ..Issue::at_step(
                    "operator_kind_rule",
                    id,
                    format!("{} takes implicit derivatives, which need every pixel of a quad to run it together: not under a when or in a repeat with a stop_if; use sample_grad with gradients taken before the loop, or sample with a lod", s.op),
                )
            });
        }
        let name = s.op.split('@').next().unwrap_or("");
        if name == "repeat" {
            return self.repeat(id, s, scope, depth, trips);
        }
        if name == "store" {
            self.store(id, s, scope)?;
            self.cost(id, def, &BTreeMap::new(), &Ty::U32, trips);
            return Ok(Vec::new());
        }
        if name == "write" || name.starts_with("atomic_") {
            self.write(id, s, scope, name != "write")?;
            self.cost(id, def, &BTreeMap::new(), &Ty::U32, trips);
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
                    // A scalar's bits splat into every lane.
                    (Some((xs, a)), Some((ts, b)))
                        if name == "bitcast"
                            && (a == b || a == 1)
                            && xs != Sc::Bool
                            && ts != Sc::Bool =>
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
            "noise" | "fbm" => {
                if float(&need("p")?).map_err(bad)? != Ty::V(Sc::F32, 2) {
                    return Err(bad(format!("{}'s p is a vec2<f32>", s.op)));
                }
                match need("seed")? {
                    Ty::Int | Ty::V(Sc::U32, 1) => {}
                    t => return Err(bad(format!("{} takes a u32 seed, not {}", s.op, t.wgsl()))),
                }
                seeded_fields(s).map_err(bad)?;
                Ty::F32
            }
            "noise3" | "cells" => {
                let p = float(&need("p")?).map_err(bad)?;
                let dims = match p {
                    Ty::V(Sc::F32, 2) => 2,
                    Ty::V(Sc::F32, 3) if name == "cells" => 3,
                    _ if name == "cells" => {
                        return Err(bad("cells' p is a vec2 or a vec3<f32>".into()))
                    }
                    _ => return Err(bad("noise3's p is a vec2<f32>".into())),
                };
                match need("seed")? {
                    Ty::Int | Ty::V(Sc::U32, 1) => {}
                    t => return Err(bad(format!("{} takes a u32 seed, not {}", s.op, t.wgsl()))),
                }
                seeded_fields(s).map_err(bad)?;
                if name == "noise3" {
                    Ty::V(Sc::F32, 3)
                } else {
                    cell_fields(s).map_err(bad)?;
                    self.cost(
                        id,
                        def,
                        &args,
                        &Ty::F32,
                        trips * if dims == 3 { 3 } else { 1 },
                    );
                    return Ok(vec![
                        (Some("f1".into()), Ty::F32),
                        (Some("f2".into()), Ty::F32),
                        (Some("id".into()), Ty::U32),
                        (Some("center".into()), Ty::V(Sc::F32, dims)),
                    ]);
                }
            }
            "spline" => {
                if float(&need("x")?).map_err(bad)? != Ty::F32 {
                    return Err(bad("spline's x is an f32".into()));
                }
                let points = s.fields.get("points").unwrap_or(&Value::Null);
                if let Err(m) = deep_canvas::steps::spline_points(points) {
                    let code = match points.as_array() {
                        Some(a) if a.len() > deep_canvas::steps::SPLINE_POINTS => "operator_limit",
                        _ => "operator_type",
                    };
                    return Err(Issue::at_step(code, id, m));
                }
                Ty::F32
            }
            "homography" => {
                match s.fields.get("quad") {
                    Some(q) => {
                        quad_of(q).map_err(bad)?;
                    }
                    None => match need("quad")? {
                        Ty::Arr(Sc::F32, 2, 4) => {}
                        t => {
                            return Err(bad(format!(
                                "homography's quad is four [x, y] corners, not {}",
                                t.wgsl()
                            )))
                        }
                    },
                }
                Ty::Mat(3)
            }
            "to_hsl" | "from_hsl" | "adjust" => {
                let port = def.ports[0];
                if float(&need(port)?).map_err(bad)? != Ty::V(Sc::F32, 3) {
                    return Err(bad(format!("{}'s {port} is a vec3", s.op)));
                }
                if name == "adjust" {
                    let mode = s.fields.get("mode").and_then(Value::as_str).unwrap_or("");
                    if !deep_canvas::steps::ADJUST_MODES.contains(&mode) {
                        return Err(bad(format!(
                            "adjust takes a mode: one of {}",
                            deep_canvas::steps::ADJUST_MODES.join(", ")
                        )));
                    }
                    if float(&need("x")?).map_err(bad)? != Ty::F32 {
                        return Err(bad("adjust's x is an f32".into()));
                    }
                }
                Ty::V(Sc::F32, 3)
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
            "role" => {
                let name = s.fields.get("name").and_then(Value::as_str).unwrap_or("");
                if graph::STATUS_ROLES.contains(&name) {
                    return Err(Issue::at_step(
                        "operator_status_color",
                        id,
                        format!("role {name} is a status color: no operator reads or writes one (status colors are reachable only through a binding)"),
                    ));
                }
                if name.is_empty() {
                    return Err(bad("role names a look role".into()));
                }
                Ty::V(Sc::F32, 3)
            }
            "normal" => match s.fields.get("space").and_then(Value::as_str) {
                Some("object" | "world" | "view") => Ty::V(Sc::F32, 3),
                _ => return Err(bad("normal takes space: object, world or view".into())),
            },
            "blend" => {
                let mode = s.fields.get("mode").and_then(Value::as_str);
                if mode.and_then(deep_canvas::blend::step_mode).is_none() {
                    return Err(bad("blend takes a mode: a group's blend modes but dissolve".into()));
                }
                for port in ["base", "over"] {
                    if float(&need(port)?).map_err(bad)? != Ty::V(Sc::F32, 3) {
                        return Err(bad(format!("blend's {port} is a vec3")));
                    }
                }
                Ty::V(Sc::F32, 3)
            }
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
            // The level from the gradients given, never from the quad's.
            "sample_grad" => {
                match need("tex")? {
                    Ty::Tex(Tex::Float) => {}
                    t => {
                        return Err(bad(format!(
                            "sample_grad reads a float texture, not {}",
                            t.wgsl()
                        )))
                    }
                }
                for p in ["uv", "dx", "dy"] {
                    if float(&need(p)?).map_err(bad)? != Ty::V(Sc::F32, 2) {
                        return Err(bad(format!("sample_grad's {p} is a vec2")));
                    }
                }
                Ty::V(Sc::F32, 4)
            }
            "backdrop" => {
                if float(&need("uv")?).map_err(bad)? != Ty::V(Sc::F32, 2) {
                    return Err(bad("backdrop's uv is a vec2".into()));
                }
                if float(&need("lod")?).map_err(bad)? != Ty::F32 {
                    return Err(bad("backdrop's lod is an f32".into()));
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
            "load3d" => {
                match lanes(&need("ixyz")?) {
                    Some((sc, 3)) if sc.is_int() => {}
                    _ => return Err(bad("load3d's ixyz is a vec3 of integers".into())),
                }
                match need("tex")? {
                    Ty::Tex3(Tex::Uint) => Ty::U32,
                    Ty::Tex3(_) => Ty::V(Sc::F32, 4),
                    t => return Err(bad(format!("load3d reads a texture3d, not {}", t.wgsl()))),
                }
            }
            "sample3d" => {
                if float(&need("uvw")?).map_err(bad)? != Ty::V(Sc::F32, 3) {
                    return Err(bad("sample3d's uvw is a vec3".into()));
                }
                match need("tex")? {
                    Ty::Tex3(Tex::Float) => Ty::V(Sc::F32, 4),
                    t => return Err(bad(format!("sample3d reads a float texture3d, not {}", t.wgsl()))),
                }
            }
            "with" => {
                let (sc, l, n) = match need("a")? {
                    Ty::Arr(sc, l, n) => (sc, l, n),
                    t => return Err(bad(format!("with copies an array, not {}", t.wgsl()))),
                };
                int_of("i")?;
                let v = need("v")?;
                if concrete(unify(&Ty::V(sc, l), &v).map_err(bad)?) != Ty::V(sc, l) {
                    return Err(bad(format!(
                        "with puts a {} into an array of them, not a {}",
                        Ty::V(sc, l).wgsl(),
                        v.wgsl()
                    )));
                }
                Ty::Arr(sc, l, n)
            }
            "sort_by_key" | "scan" | "compact" => {
                let storage = |p: &str| -> Result<(Sc, u32), Issue> {
                    match need(p)? {
                        Ty::Storage(sc, n) => Ok((sc, n)),
                        t => Err(bad(format!("{} reads storage at {p}, not {}", s.op, t.wgsl()))),
                    }
                };
                let count = |len: u32| -> Result<u32, Issue> {
                    let c = match s.args.get("count") {
                        Some(Arg::Lit(v)) => v
                            .as_u64()
                            .ok_or_else(|| bad("count is a whole number".into()))?,
                        None if name == "scan" => u64::from(len),
                        _ => return Err(bad(format!("{}'s count is a literal", s.op))),
                    };
                    if c == 0 || c > u64::from(MAX_ELEMENTS) || (len > 0 && c > u64::from(len)) {
                        return Err(Issue::at_step(
                            "operator_limit",
                            id,
                            format!("{} runs over 1 to {MAX_ELEMENTS} elements, at most its storage's {len}; not {c}", s.op),
                        ));
                    }
                    Ok(c as u32)
                };
                let ports = match name {
                    "sort_by_key" => {
                        let (k, nk) = storage("keys")?;
                        let (v, nv) = storage("values")?;
                        if k != Sc::U32 || v != Sc::U32 {
                            return Err(bad("sort_by_key sorts u32 values by u32 keys".into()));
                        }
                        vec![(None, Ty::Storage(Sc::U32, count(nk.min(nv))?))]
                    }
                    "scan" => {
                        let (sc, n) = storage("in")?;
                        if !sc.is_int() {
                            return Err(bad("scan adds u32 or i32 values".into()));
                        }
                        if s.fields.get("op").and_then(Value::as_str) != Some("add") {
                            return Err(bad("scan's op is add".into()));
                        }
                        vec![(None, Ty::Storage(sc, count(n)?))]
                    }
                    _ => {
                        let (sc, n) = storage("in")?;
                        let (f, nf) = storage("flag")?;
                        if !matches!(f, Sc::Bool | Sc::U32) {
                            return Err(bad("compact's flag is storage of bools".into()));
                        }
                        let c = count(n.min(nf))?;
                        vec![
                            (Some("out".to_string()), Ty::Storage(sc, c)),
                            (Some("count".to_string()), Ty::Storage(Sc::U32, 1)),
                        ]
                    }
                };
                let elements = match &ports[0].1 {
                    Ty::Storage(_, n) => *n,
                    _ => 1,
                };
                // Its weight is per element; the operator's estimate is per element too.
                let _ = elements;
                self.cost(id, def, &args, &Ty::U32, trips);
                return Ok(ports);
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
                // An attribute reads whole elements at its packed stride.
                let lanes = match s.args.get("buf") {
                    Some(Arg::Ref(b, None)) => match self.op.inputs.get(b).map(|i| &i.from) {
                        Some(From::Attribute { lanes, .. }) => *lanes,
                        _ => 1,
                    },
                    _ => 1,
                };
                Ty::V(sc, lanes)
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
        // fbm's weight is per octave.
        let octaves = if name == "fbm" {
            seeded_fields(s).map_or(1, |f| f.octaves)
        } else {
            1
        };
        self.cost(id, def, &args, &out, trips * octaves);
        self.track_affine(id, name, s);
        Ok(vec![(None, out)])
    }

    /// Records an integer step that is an affine function of the element index, `k × element +
    /// j` plus any value the same in every invocation (a param, say).
    fn track_affine(&mut self, id: &str, name: &str, s: &Step) {
        // The same in every invocation: a literal, a value input, or pure arithmetic on them.
        let uniform = |a: &Arg| match a {
            Arg::Lit(_) => true,
            Arg::Ref(n, None) => {
                self.uniform.contains(n)
                    || self
                        .op
                        .inputs
                        .get(n)
                        .is_some_and(|i| !matches!(i.ty, Ty::Tex(_) | Ty::Tex3(_) | Ty::Storage(..)))
            }
            Arg::Ref(..) => false,
        };
        let pure = matches!(
            name,
            "const" | "convert" | "bitcast" | "add" | "sub" | "mul" | "div" | "rem" | "min"
                | "max" | "and" | "or" | "xor" | "shl" | "shr" | "select" | "hash"
        );
        let is_uniform = pure && s.args.values().all(uniform);
        let of = |a: Option<&Arg>| -> Option<(u64, u64)> {
            match a? {
                Arg::Lit(v) => Some((0, v.as_u64()?)),
                Arg::Ref(n, None) => self.affine.get(n).copied(),
                Arg::Ref(..) => None,
            }
        };
        let either = |a: Option<&Arg>, b: Option<&Arg>| match (a, b) {
            (Some(x), Some(y)) if uniform(y) => of(Some(x)),
            (Some(x), Some(y)) if uniform(x) => of(Some(y)),
            _ => None,
        };
        let got = match name {
            "element" => Some((1, 0)),
            "const" => s.fields.get("value").and_then(Value::as_u64).map(|c| (0, c)),
            "convert" | "bitcast" => of(s.args.get("x")),
            "add" => match (of(s.args.get("a")), of(s.args.get("b"))) {
                (Some((a, b)), Some((c, d))) => a.checked_add(c).zip(b.checked_add(d)),
                // A uniform shift moves every invocation's slots alike.
                _ => either(s.args.get("a"), s.args.get("b")),
            },
            "mul" => match (of(s.args.get("a")), of(s.args.get("b"))) {
                (Some((a, b)), Some((0, k))) | (Some((0, k)), Some((a, b))) => {
                    a.checked_mul(k).zip(b.checked_mul(k))
                }
                _ => None,
            },
            _ => None,
        };
        if is_uniform {
            self.uniform.insert(id.to_string());
        }
        if let Some(g) = got {
            self.affine.insert(id.to_string(), g);
        }
    }

    /// `write(buf, i, v)` and the atomics: `buf` names one of the operator's storage outputs, and
    /// a constant index past its declared count is refused. A write lands only in the
    /// invocation's own slots, an index `k × element + j` with `j < k` (or any index in a
    /// dispatch of one element); an atomic statement, whose result is never read, may land
    /// anywhere.
    fn write(
        &mut self,
        id: &str,
        s: &Step,
        scope: &BTreeSet<String>,
        atomic: bool,
    ) -> Result<(), Issue> {
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
        if !atomic && !self.options.trusts_index && self.op.elements > 1 {
            let own = match s.args.get("i") {
                Some(Arg::Ref(n, None)) => self
                    .affine
                    .get(n)
                    .is_some_and(|(k, j)| *k >= 1 && j < k),
                _ => false,
            };
            if !own {
                return Err(Issue::at_step(
                    "operator_kind_rule",
                    id,
                    "a compute operator writes storage only at its own element's index (k × element + j, j < k); add into a shared slot with an atomic statement instead",
                ));
            }
        }
        if atomic && !out.sc.is_int() {
            return Err(bad(format!(
                "{} adds into integer storage, not {}",
                s.op,
                out.sc.wgsl()
            )));
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

    /// `store {tex, ixy, v}` (#483): a texel of one of the operator's texture outputs, at an
    /// integer index of its dimension, a value of its format.
    fn store(&mut self, id: &str, s: &Step, scope: &BTreeSet<String>) -> Result<(), Issue> {
        let bad = |m: String| Issue::at_step("operator_type", id, m);
        let out = match s.args.get("tex") {
            Some(Arg::Ref(t, None)) => self
                .op
                .textures
                .get(t)
                .ok_or_else(|| bad(format!("store writes a texture output; {t} is none")))?,
            _ => return Err(bad("store names its texture output at tex".into())),
        };
        let dims = if out.dim3 { 3 } else { 2 };
        let at = s.args.get("ixy").ok_or_else(|| bad("store needs ixy".into()))?;
        match lanes(&concrete(self.ty_of(scope, at, id)?)) {
            Some((sc, n)) if sc.is_int() && n == dims => {}
            _ => return Err(bad(format!("store's ixy is a vec{dims} of integers"))),
        }
        let v = s.args.get("v").ok_or_else(|| bad("store needs v".into()))?;
        let vt = self.ty_of(scope, v, id)?;
        let want = out.value();
        if concrete(unify(&want, &vt).map_err(bad)?) != want {
            return Err(bad(format!("a {} texel holds a {}, not a {}", out.format, want.wgsl(), vt.wgsl())));
        }
        if let Some(w) = &s.when {
            if self.ty_of(scope, &Arg::Ref(w.clone(), None), id)? != Ty::BOOL {
                return Err(bad("when names a bool step".into()));
            }
        }
        Ok(())
    }

    fn cost(&mut self, id: &str, def: &Def, args: &BTreeMap<&str, Ty>, out: &Ty, trips: u32) {
        let lanes_of = |t: &Ty| match t {
            Ty::V(_, n) => f64::from(*n),
            Ty::Mat(n) => f64::from(*n) * f64::from(*n),
            _ => 1.0,
        };
        let halved = self.options.noise_weight_halved && matches!(def.name, "noise@1" | "fbm@1");
        let weight = if halved { def.weight / 2.0 } else { def.weight };
        self.weight += weight * lanes_of(out) * f64::from(trips);
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
        let planted = (self.options.exact_f32_compares
            && matches!(def.name, "eq@1" | "ne@1" | "lt@1" | "le@1" | "gt@1" | "ge@1"))
            || (self.options.exact_f32_floor && def.name == "floor@1");
        // Floats travel only as bits: a bitcast or a constant moves them without an f32 operation.
        let carries_bits = matches!(def.name, "bitcast@1" | "const@1");
        let inexact = !def.exact
            || (!planted && !carries_bits && (floats(out) || args.values().any(floats)));
        if inexact && self.inexact.is_none() {
            let why = if def.exact {
                format!("{} on f32 values", def.name)
            } else {
                format!("{} is never exact", def.name)
            };
            self.inexact = Some(Why::Step(id.to_string(), why));
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

/// Where #252's stepped fields may stand: `stepped` on a compute operator, and `carry`, a read of
/// the previous step and the step index only in a stepped one.
fn stepped_rules(op: &Operator, issues: &mut Vec<Issue>) {
    let rule = |issues: &mut Vec<Issue>, path: &str, what: String| {
        issues.push(Issue::at_path("operator_kind_rule", path, what));
    };
    if op.stepped.is_some() && op.kind != Kind::Compute {
        rule(issues, "stepped", format!("{} is stepped, and only compute work steps", op.id));
    }
    if op.stepped.is_some() {
        return;
    }
    for (name, s) in &op.storage {
        if s.carry.is_some() {
            rule(issues, &format!("outputs/{name}/carry"), format!("{} carries {name} between frames, and only a stepped operator carries state", op.id));
        }
    }
    for (name, input) in &op.inputs {
        match &input.from {
            From::Storage { op: from, output, previous: true } => rule(
                issues,
                &format!("inputs/{name}"),
                format!("{name} reads {from}.{output} as the previous step left it, and only a stepped operator reads an earlier step"),
            ),
            From::Step => rule(issues, &format!("inputs/{name}"), format!("{name} reads the fixed step, and only a stepped operator has one")),
            _ => {}
        }
    }
}

fn input_class(from: &From) -> Class {
    match from {
        // A target the GPU rasterized is same machine, and so is time.
        From::Target { .. } | From::Time | From::Phase(_) => Class::SameMachine,
        // Storage carries its writer's bits; an operator's class over them is its own.
        From::Param(_)
        | From::Channel(_)
        | From::Texture3d { .. }
        | From::Seed
        | From::Step
        | From::Role(_)
        | From::Spline(_)
        | From::Asset(_)
        | From::Storage { .. }
        | From::Column { .. }
        | From::Attribute { .. } => Class::Exact,
    }
}

/// Checks an operator: Ok with what the emitter and the interpreter need, or every refusal.
pub fn check(op: &Operator) -> Result<Checked, Vec<Issue>> {
    check_with(op, CheckOptions::default())
}

/// The first iterate among `steps`, with its body's own first iterate if it has one.
fn first_iterate(steps: &BTreeMap<String, Step>) -> Option<(&String, &graph::Iterate)> {
    steps
        .iter()
        .find_map(|(id, s)| s.iterate.as_deref().map(|it| (id, it)))
}

/// Every name the steps (and their repeats' and outputs') arguments read.
fn reads_of(steps: &BTreeMap<String, Step>, outputs: &BTreeMap<String, Arg>, out: &mut BTreeSet<String>) {
    let mut push = |a: &Arg| {
        if let Arg::Ref(n, _) = a {
            out.insert(n.clone());
        }
    };
    outputs.values().for_each(&mut push);
    let mut stack: Vec<&BTreeMap<String, Step>> = vec![steps];
    while let Some(st) = stack.pop() {
        for s in st.values() {
            s.args.values().for_each(&mut push);
            if let Some(b) = &s.body {
                b.accumulate.iter().for_each(|(_, _, a)| push(a));
                stack.push(&b.steps);
            }
        }
    }
}

/// An operator with iterate steps (#483): each body checked as a pass of its own, which reads only
/// the operator's own inputs, `prev` and its index, then the operator with each iterate step in
/// its place as a texture input, costed as its count of passes over its body.
fn check_iterating(op: &Operator, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    let mut outer = op.clone();
    let mut iterates = Vec::new();
    let (mut extra, mut floor) = (0.0, Class::Exact);
    for (id, s) in &op.steps {
        let Some(it) = s.iterate.as_deref() else {
            continue;
        };
        let refuse = |code: &'static str, m: String| Err(vec![Issue::at_step(code, id, m)]);
        if op.kind != Kind::Pass {
            return refuse("operator_kind_rule", format!("iterate is a pass step, not a {} one", op.kind.name()));
        }
        if it.count == 0 || it.count > MAX_ITERATE {
            return refuse("operator_limit", format!("iterate runs 1 to {MAX_ITERATE} times, not {}", it.count));
        }
        if let Some((inner, _)) = first_iterate(&it.steps) {
            return Err(vec![Issue {
                path: Some(format!("steps/{id}/body/steps/{inner}")),
                ..Issue::at_step(
                    "operator_limit",
                    inner,
                    format!("iterate never nests: {inner} is an iterate inside the iterate {id}"),
                )
            }]);
        }
        if !PING_PONG.contains(&it.format.as_str()) {
            return refuse("operator_type", format!("a ping-pong target is {}, not {}", PING_PONG.join(" or "), it.format));
        }
        let mut read = BTreeSet::new();
        reads_of(&it.steps, &it.outputs, &mut read);
        let mut inputs = BTreeMap::new();
        for name in &read {
            if let Some(input) = op.inputs.get(name) {
                if let From::Target { op: from, .. } = &input.from {
                    if from != "core" {
                        return Err(vec![Issue {
                            step: Some(id.clone()),
                            ..Issue::at_path(
                                "operator_kind_rule",
                                &format!("inputs/{name}"),
                                format!("the body of {id} reads {name}, {from}'s target: a body reads only its operator's own inputs and prev"),
                            )
                        }]);
                    }
                }
                inputs.insert(name.clone(), input.clone());
            } else if op.steps.contains_key(name) && !it.steps.contains_key(name) {
                return refuse("operator_kind_rule", format!("the body of {id} reads the step {name}, outside it: a body reads only its operator's own inputs and prev"));
            }
        }
        let key = format!("{}.{id}", op.id);
        let tex = |output: &str| graph::Input {
            ty: Ty::Tex(Tex::Float),
            from: From::Target { op: key.clone(), output: output.into() },
            range: None,
            default: None,
        };
        inputs.insert("prev".into(), tex("prev"));
        inputs.insert(
            it.index.clone(),
            graph::Input { ty: Ty::U32, from: From::Param(it.index.clone()), range: None, default: None },
        );
        let body = Operator {
            id: key.clone(),
            kind: Kind::Pass,
            about: op.about.clone(),
            inputs,
            steps: it.steps.clone(),
            outputs: it.outputs.clone(),
            storage: BTreeMap::new(),
            textures: BTreeMap::new(),
            instances: BTreeMap::new(),
            blend: graph::Blend::Replace,
            declared: None,
            fallback: op.fallback,
            cost: None,
            size: it.resolution.clone(),
            elements: 0,
            counted: false,
            stepped: None,
            workgroup: 64,
            source: None,
            uses: Vec::new(),
            origin: Origin::Shipped,
            chain: op.chain.clone(),
            order: op.order.clone(),
        };
        let checked = check_with(&body, options)?;
        extra += it.count as f64 * checked.estimate;
        floor = floor.max(checked.class);
        outer.steps.remove(id);
        outer.inputs.insert(id.clone(), tex("color"));
        iterates.push(Iterated {
            step: id.clone(),
            count: it.count as u32,
            index: it.index.clone(),
            format: it.format.clone(),
            size: it.resolution.clone(),
            body: Box::new(checked),
        });
    }
    let mut c = check_inner(&outer, options, extra, floor)?;
    c.iterates = iterates;
    Ok(c)
}

/// [`check`], under the planted wrong programs `options` turns on.
pub fn check_with(op: &Operator, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    if op.steps.values().any(|s| s.iterate.is_some()) {
        return check_iterating(op, options);
    }
    check_inner(op, options, 0.0, Class::Exact)
}

/// The check over an operator with no iterate step left: `extra` ns its iterates' runs cost and
/// `floor` the least class their bodies allow.
fn check_inner(
    op: &Operator,
    options: CheckOptions,
    extra: f64,
    floor: Class,
) -> Result<Checked, Vec<Issue>> {
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
        inexact: None,
        affine: BTreeMap::new(),
        uniform: BTreeSet::new(),
        options,
        weight: 0.0,
        fetches: 0,
        body_order: BTreeMap::new(),
        accs: Vec::new(),
    };
    let mut issues = Vec::new();
    stepped_rules(op, &mut issues);
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
        if matches!(input.ty, Ty::Tex(_))
            != matches!(input.from, From::Target { .. } | From::Asset(_))
            || matches!(input.ty, Ty::Tex3(_)) != matches!(input.from, From::Texture3d { .. })
        {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "a texture input reads a target, and a texture3d input a 3D texture, and only they do",
            ));
        }
        // A 3D texture is read only in the frame that wrote it (structural steps, #483).
        if let From::Texture3d { op: from, output, previous: true } = &input.from {
            issues.push(Issue::at_path(
                "operator_kind_rule",
                &path,
                format!("{name} reads {from}.{output} from an earlier frame: a 3D texture is read only by later operators in the frame that wrote it, never kept to the next"),
            ));
        }
        match input.ty {
            Ty::Tex(_) | Ty::Tex3(_) => textures.push(name.clone()),
            Ty::Storage(..) => storage_inputs.push(name.clone()),
            _ => {}
        }
        let why = if input_class(&input.from) != Class::Exact {
            Some(match &input.from {
                From::Target { output, .. } => {
                    format!("it reads the {output} target, which the GPU rasterized")
                }
                _ => "it reads time".to_string(),
            })
        } else if matches!(input.ty, Ty::V(Sc::F32, _) | Ty::Mat(_)) {
            Some(format!("it is a {}", input.ty.wgsl()))
        } else {
            None
        };
        if let (Some(why), None) = (why, &ctx.inexact) {
            ctx.inexact = Some(Why::Input(path.clone(), why));
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
        // An instances output draws what a compact step of this operator kept (#484): the step's
        // rows and its count are storage outputs, which the draw reads.
        for (name, i) in &op.instances {
            let path = format!("outputs/{name}");
            if !i.columns.is_empty() {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    "an instances output draws the instancer's own columns; it writes none yet",
                ));
            }
            let held = |port: &str| {
                let want = Arg::Ref(i.count.clone().unwrap_or_default(), Some(port.to_string()));
                op.storage.values().any(|o| o.from.as_ref() == Some(&want))
            };
            let compact = i
                .count
                .as_ref()
                .and_then(|c| op.steps.get(c))
                .is_some_and(|s| s.op == "compact@1");
            if i.instancer.is_empty() || !compact || !held("out") || !held("count") {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    "instances is {instancer, columns, count: a compact step whose out and count are storage outputs}",
                ));
            }
        }
        if op.storage.is_empty() && op.textures.is_empty() {
            issues.push(Issue::at_path(
                "operator_type",
                "outputs",
                "a compute operator writes storage or a texture",
            ));
        }
    }
    for (name, t) in &op.textures {
        let path = format!("outputs/{name}");
        if op.kind != Kind::Compute {
            issues.push(Issue::at_path("operator_type", &path, "only a compute operator writes a texture output"));
        }
        // Integers don't average, and r32float isn't filterable on every adapter.
        if t.mips && !matches!(t.format.as_str(), "rgba16float" | "rgba8unorm") {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!("mips: true takes rgba16float or rgba8unorm, not {}", t.format),
            ));
        }
        let cap = if t.dim3 { MAX_TEXTURE3D } else { MAX_TEXTURE2D };
        if t.size.iter().any(|&n| n == 0 || n > cap) {
            issues.push(Issue::at_path(
                "operator_limit",
                &path,
                format!("a {} output is 1 to {cap} texels a side", if t.dim3 { "texture3d" } else { "texture" }),
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
    let cap = match (op.kind, options.wide_fetches) {
        (Kind::Material, true) => max_fetches(Kind::Pass),
        (kind, _) => max_fetches(kind),
    };
    if ctx.fetches > cap {
        return Err(vec![Issue::at_path(
            "operator_limit",
            "steps",
            format!(
                "{} fetches per invocation, past {cap} in a {} operator{}",
                ctx.fetches,
                op.kind.name(),
                if op.kind == Kind::Material && !options.wide_fetches {
                    " outside the showpiece and export classes"
                } else {
                    ""
                }
            ),
        )]);
    }
    // #483: a multi-dispatch step runs over whole buffers, so it runs alone: its operator holds
    // only such steps, reading storage, and each storage output takes one's result.
    let multi = op.steps.values().any(|s| table::multi_dispatch(&s.op));
    if multi {
        if let Some((id, s)) = op.steps.iter().find(|(_, s)| !table::multi_dispatch(&s.op)) {
            return Err(vec![Issue::at_step(
                "operator_kind_rule",
                id,
                format!("{} can't share an operator with a sort, a scan or a compaction, which run over whole buffers: write it in an operator before or after", s.op),
            )]);
        }
    }
    for (name, so) in &op.storage {
        let path = format!("outputs/{name}");
        match &so.from {
            Some(a) => match ctx.ty_of(&scope, a, name) {
                Ok(Ty::Storage(sc, n)) if sc == so.sc && n >= so.count => {}
                Ok(t) => issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    format!("{name} is storage of {} {}, so it takes such storage, not {}", so.count, so.sc.wgsl(), t.wgsl()),
                )),
                Err(mut e) => {
                    e.step = None;
                    e.path = Some(path);
                    issues.push(e);
                }
            },
            None if multi => issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!("{name} takes from: a sort's, a scan's or a compaction's result"),
            )),
            None => {}
        }
    }
    for (name, a) in &op.outputs {
        let path = format!("outputs/{name}");
        // Today's outputs are the core's entries of gpu.output@1 (#200).
        let want = match deep_canvas::registry::core_lists::output_type(op.kind.name(), name) {
            Some("vec4<f32>") => Ty::V(Sc::F32, 4),
            Some("vec3<f32>") => Ty::V(Sc::F32, 3),
            Some("f32") => Ty::F32,
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
    let class = if ctx.inexact.is_none() {
        Class::Exact
    } else {
        Class::SameMachine
    }
    .max(floor);
    // State a stepped operator carries between frames repeats only on the machine that stepped
    // it, whatever its steps are (#252).
    let class = match op.stepped {
        Some(_) if options.carried_exact => Class::Exact,
        Some(_) => class.max(Class::SameMachine),
        None => class,
    };
    if let Some(d) = op.declared {
        if d < class && !options.declared_class {
            let (step, path, why) = match ctx.inexact.clone() {
                Some(Why::Step(s, w)) => (Some(s), None, w),
                Some(Why::Input(p, w)) => (None, Some(p), w),
                None => (None, Some("determinism".to_string()), String::new()),
            };
            return Err(vec![Issue {
                step,
                path,
                ..Issue::new(
                    "not_exact",
                    format!(
                        "{} is declared {}, but its steps and inputs make it {}: {why}",
                        op.id,
                        d.name(),
                        class.name()
                    ),
                )
            }]);
        }
    }
    // A live-only operator draws its fallback in every canonical render; a material with no
    // fallback would leave its parts undrawn there.
    if op.declared == Some(Class::LiveOnly)
        && op.kind == Kind::Material
        && op.fallback == Fallback::None
    {
        return Err(vec![Issue {
            item: Some(op.id.clone()),
            ..Issue::at_path(
                "live_only_canonical",
                "fallback",
                format!(
                    "{} is declared live_only with fallback none: canonical renders, render-back, exports and goldens would draw nothing for it",
                    op.id
                ),
            )
        }]);
    }
    let estimate = ctx.weight * NS_PER_UNIT + f64::from(ctx.fetches) * NS_PER_FETCH + extra;
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
        class: if options.declared_class {
            op.declared.unwrap_or(class)
        } else {
            op.declared.map_or(class, |d| d.max(class))
        },
        estimate,
        fetches: ctx.fetches,
        textures,
        storage_inputs,
        iterates: Vec::new(),
    })
}

/// Reads and checks an operator's JSON.
pub fn read_and_check(v: &Value) -> Result<Checked, Vec<Issue>> {
    check(&graph::read(v)?)
}

/// [`read_and_check`] under planted wrong programs.
pub fn read_and_check_with(v: &Value, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    check_with(&graph::read(v)?, options)
}
