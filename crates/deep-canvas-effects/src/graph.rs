//! A GPU operator as data (canvas primitives: GPU operator; Step and the closed step list;
//! Operator input; Operator output): read from its JSON with nothing executable in it. Reading
//! refuses what no graph may carry, shader text in a field first among them; [`crate::check`]
//! does the rest.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// A refusal, named by its code and by the step, field or source position it's about.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Issue {
    pub code: &'static str,
    pub step: Option<String>,
    /// A field's path in the operator, `/`-separated (`wgsl`, `inputs/n`).
    pub path: Option<String>,
    /// A WGSL-subset source's line and column (1-based) and the construct there.
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub construct: Option<String>,
    pub message: String,
}

impl Issue {
    pub fn new(code: &'static str, message: impl Into<String>) -> Issue {
        Issue {
            code,
            message: message.into(),
            ..Issue::default()
        }
    }

    pub fn at_step(code: &'static str, step: &str, message: impl Into<String>) -> Issue {
        Issue {
            step: Some(step.into()),
            ..Issue::new(code, message)
        }
    }

    pub fn at_path(code: &'static str, path: &str, message: impl Into<String>) -> Issue {
        Issue {
            path: Some(path.into()),
            ..Issue::new(code, message)
        }
    }

    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("code".into(), json!(self.code));
        o.insert("severity".into(), json!("error"));
        for (k, v) in [
            ("step", &self.step),
            ("path", &self.path),
            ("construct", &self.construct),
        ] {
            if let Some(v) = v {
                o.insert(k.into(), json!(v));
            }
        }
        for (k, v) in [("line", self.line), ("column", self.column)] {
            if let Some(v) = v {
                o.insert(k.into(), json!(v));
            }
        }
        o.insert("message".into(), json!(self.message));
        Value::Object(o)
    }
}

/// The three kinds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    Material,
    Pass,
    Compute,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Material => "material",
            Kind::Pass => "pass",
            Kind::Compute => "compute",
        }
    }

    /// The bit the op table's `kinds` mask holds for it.
    pub fn bit(self) -> u8 {
        match self {
            Kind::Material => 1,
            Kind::Pass => 2,
            Kind::Compute => 4,
        }
    }
}

/// A scalar type.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Sc {
    Bool,
    I32,
    U32,
    F32,
}

impl Sc {
    pub fn wgsl(self) -> &'static str {
        match self {
            Sc::Bool => "bool",
            Sc::I32 => "i32",
            Sc::U32 => "u32",
            Sc::F32 => "f32",
        }
    }

    pub fn is_int(self) -> bool {
        matches!(self, Sc::I32 | Sc::U32)
    }
}

/// What a texture holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Tex {
    /// A filterable float texture (color, emission).
    Float,
    /// An unsigned integer texture (object IDs).
    Uint,
    /// A depth target.
    Depth,
}

/// A value's type (Step and the closed step list: types).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ty {
    /// A scalar (1 lane) or a vector of 2 to 4 lanes.
    V(Sc, u8),
    /// A literal integer, which widens to any number type.
    Int,
    /// `mat3x3<f32>` or `mat4x4<f32>`.
    Mat(u8),
    Tex(Tex),
    /// `array<T, n ≤ 16>`.
    Arr(Sc, u8, u32),
    /// A storage buffer of `count` scalars, read with `read` and written with `write`.
    Storage(Sc, u32),
}

impl Ty {
    pub const F32: Ty = Ty::V(Sc::F32, 1);
    pub const U32: Ty = Ty::V(Sc::U32, 1);
    pub const I32: Ty = Ty::V(Sc::I32, 1);
    pub const BOOL: Ty = Ty::V(Sc::Bool, 1);

    pub fn wgsl(&self) -> String {
        match self {
            Ty::V(sc, 1) => sc.wgsl().into(),
            Ty::V(sc, n) => format!("vec{n}<{}>", sc.wgsl()),
            Ty::Int => "i32".into(),
            Ty::Mat(n) => format!("mat{n}x{n}<f32>"),
            Ty::Tex(Tex::Float) => "texture_2d<f32>".into(),
            Ty::Tex(Tex::Uint) => "texture_2d<u32>".into(),
            Ty::Tex(Tex::Depth) => "texture_depth_2d".into(),
            Ty::Arr(sc, 1, n) => format!("array<{}, {n}>", sc.wgsl()),
            Ty::Arr(sc, l, n) => format!("array<vec{l}<{}>, {n}>", sc.wgsl()),
            // Bools are stored as u32 words.
            Ty::Storage(Sc::Bool, _) => "array<u32>".into(),
            Ty::Storage(sc, _) => format!("array<{}>", sc.wgsl()),
        }
    }

    /// Reads `f32`, `vec3`, `vec2<u32>`, `mat4x4<f32>`, `texture`, `texture<u32>`, `depth` and
    /// `array<u32, 16>`.
    pub fn parse(text: &str) -> Option<Ty> {
        let t: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        let scalar = |s: &str| match s {
            "bool" => Some(Sc::Bool),
            "i32" => Some(Sc::I32),
            "u32" => Some(Sc::U32),
            "f32" => Some(Sc::F32),
            _ => None,
        };
        if let Some(sc) = scalar(&t) {
            return Some(Ty::V(sc, 1));
        }
        match t.as_str() {
            "mat3x3<f32>" | "mat3x3" | "mat3" => return Some(Ty::Mat(3)),
            "mat4x4<f32>" | "mat4x4" | "mat4" => return Some(Ty::Mat(4)),
            "texture" | "texture<f32>" => return Some(Ty::Tex(Tex::Float)),
            "texture<u32>" => return Some(Ty::Tex(Tex::Uint)),
            "depth" => return Some(Ty::Tex(Tex::Depth)),
            _ => {}
        }
        if let Some(rest) = t.strip_prefix("vec") {
            let n: u8 = rest.get(..1)?.parse().ok()?;
            if !(2..=4).contains(&n) {
                return None;
            }
            let sc = match rest.get(1..)? {
                "" => Sc::F32,
                inner => scalar(inner.strip_prefix('<')?.strip_suffix('>')?)?,
            };
            return Some(Ty::V(sc, n));
        }
        let inner = t.strip_prefix("array<")?.strip_suffix('>')?;
        let (elem, n) = inner.rsplit_once(',')?;
        let n: u32 = n.parse().ok()?;
        match Ty::parse(elem)? {
            Ty::V(sc, l) if (1..=16).contains(&n) => Some(Ty::Arr(sc, l, n)),
            _ => None,
        }
    }
}

/// Where an input's value comes from (Operator input: `from`).
#[derive(Clone, Debug, PartialEq)]
pub enum From {
    Param(String),
    Channel(String),
    /// A core target or an earlier operator's output, read this frame.
    Target {
        op: String,
        output: String,
    },
    /// Storage an operator wrote earlier in the frame.
    Storage {
        op: String,
        output: String,
    },
    Time,
    /// A phase in [0, 1) of `period` flicks.
    Phase(u64),
    Seed,
    Role(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub ty: Ty,
    pub from: From,
    pub range: Option<[f64; 2]>,
    pub default: Option<Value>,
}

/// An argument: a step's output (`step` or `step.port`), an input or accumulator by name, or a
/// literal.
#[derive(Clone, Debug, PartialEq)]
pub enum Arg {
    Ref(String, Option<String>),
    Lit(Value),
}

/// How many times a repeat runs: fixed at check.
#[derive(Clone, Debug, PartialEq)]
pub enum Count {
    Const(u32),
    /// An input whose range caps it.
    Input(String),
    /// Anything else, which the check refuses as unbounded.
    Unbounded(String),
}

/// A repeat's body (Step and the closed step list: `repeat`): each accumulator starts at its
/// initial value, and the body step named after it gives its value for the next trip.
#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub count: Count,
    /// The loop index's name, a `u32` inside the body.
    pub index: String,
    /// Each accumulator's type and initial value, in order.
    pub accumulate: Vec<(String, Ty, Arg)>,
    pub steps: BTreeMap<String, Step>,
    /// Stops after the trip where this is true.
    pub stop_if: Option<Arg>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Step {
    /// `name@major`.
    pub op: String,
    pub args: BTreeMap<String, Arg>,
    pub when: Option<String>,
    /// The op's own literal fields, given among its args: `value` and `type` (const), `to`
    /// (convert and bitcast), `pick` (split), `of` (camera).
    pub fields: Map<String, Value>,
    pub body: Option<Box<Body>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    Exact,
    SameMachine,
    LiveOnly,
}

impl Class {
    pub fn name(self) -> &'static str {
        match self {
            Class::Exact => "exact",
            Class::SameMachine => "same_machine",
            Class::LiveOnly => "live_only",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Blend {
    Replace,
    Over,
    Add,
    Multiply,
    Screen,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    Shipped,
    Pack,
    Composed,
}

/// A pass's output size: the view's at its resolution, or (shipped chains only) an input's
/// scaled by a power of two, for mip chains.
#[derive(Clone, Debug, PartialEq)]
pub enum Size {
    Full,
    Half,
    Quarter,
    Of { input: String, scale: f64 },
}

/// A compute operator's output: storage of `count` scalars.
#[derive(Clone, Debug, PartialEq)]
pub struct StorageOut {
    pub sc: Sc,
    pub count: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Operator {
    pub id: String,
    pub kind: Kind,
    pub about: String,
    pub inputs: BTreeMap<String, Input>,
    pub steps: BTreeMap<String, Step>,
    /// A pass's or material's outputs, by name, each a step's value.
    pub outputs: BTreeMap<String, Arg>,
    /// A compute operator's storage outputs.
    pub storage: BTreeMap<String, StorageOut>,
    pub blend: Blend,
    pub declared: Option<Class>,
    /// ns per pixel (material, pass) or per element (compute).
    pub cost: Option<f64>,
    pub size: Size,
    /// A compute operator's elements per dispatch.
    pub elements: u32,
    pub workgroup: u32,
    /// A WGSL-subset source's asset ID, in place of steps.
    pub source: Option<String>,
    pub uses: Vec<String>,
    pub origin: Origin,
    /// A pass's chain (`effects` or `finish`) and order key.
    pub chain: String,
    pub order: String,
}

/// The fields an operator may carry; anything else is refused, and a field that carries code is
/// refused as shader text.
const FIELDS: &[&str] = &[
    "id",
    "kind",
    "about",
    "inputs",
    "steps",
    "source",
    "outputs",
    "determinism",
    "cost",
    "resolution",
    "fallback",
    "uses",
    "origin",
    "chain",
    "order",
    "applies_to",
    "elements",
    "workgroup",
    "after",
];
/// Fields that hold a program's text in other engines' formats.
const CODE_FIELDS: &[&str] = &[
    "wgsl", "glsl", "hlsl", "msl", "shader", "code", "spirv", "program", "fragment", "vertex",
];
/// An op's own literal fields, which its args may hold beside its ports.
const LITERAL_FIELDS: &[&str] = &["value", "type", "to", "pick", "of"];

fn ident(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn arg(v: &Value) -> Arg {
    match v {
        Value::String(s) => match s.split_once('.') {
            Some((step, port)) => Arg::Ref(step.into(), Some(port.into())),
            None => Arg::Ref(s.clone(), None),
        },
        other => Arg::Lit(other.clone()),
    }
}

fn steps(v: &Value, issues: &mut Vec<Issue>) -> BTreeMap<String, Step> {
    let mut out = BTreeMap::new();
    let Some(o) = v.as_object() else {
        issues.push(Issue::at_path(
            "operator_type",
            "steps",
            "steps is an object of step ID → step",
        ));
        return out;
    };
    for (id, s) in o {
        if !ident(id) {
            issues.push(Issue::at_step(
                "operator_type",
                id,
                "a step ID is lowercase letters, digits and _",
            ));
            continue;
        }
        if let Some(step) = step(id, s, issues) {
            out.insert(id.clone(), step);
        }
    }
    out
}

fn step(id: &str, s: &Value, issues: &mut Vec<Issue>) -> Option<Step> {
    let Some(o) = s.as_object() else {
        issues.push(Issue::at_step("operator_type", id, "a step is an object"));
        return None;
    };
    let Some(op) = o.get("op").and_then(Value::as_str) else {
        issues.push(Issue::at_step(
            "operator_unknown_op",
            id,
            "a step names its op as name@major",
        ));
        return None;
    };
    let empty = Map::new();
    let given = match o.get("args") {
        None => &empty,
        Some(Value::Object(a)) => a,
        Some(_) => {
            issues.push(Issue::at_step("operator_type", id, "args is an object"));
            &empty
        }
    };
    let repeat = op.starts_with("repeat@");
    let mut args = BTreeMap::new();
    let mut fields = Map::new();
    for (port, v) in given {
        if LITERAL_FIELDS.contains(&port.as_str()) {
            fields.insert(port.clone(), v.clone());
        } else if !(repeat
            && ["count", "accumulate", "body", "stop_if", "index"].contains(&port.as_str()))
        {
            args.insert(port.clone(), arg(v));
        }
    }
    let body = repeat.then(|| Box::new(body(given, issues)));
    Some(Step {
        op: op.into(),
        args,
        when: o.get("when").and_then(Value::as_str).map(String::from),
        fields,
        body,
    })
}

fn body(a: &Map<String, Value>, issues: &mut Vec<Issue>) -> Body {
    let count = match a.get("count") {
        Some(Value::Number(n)) => match n.as_u64() {
            Some(c) => Count::Const(c.min(u64::from(u32::MAX)) as u32),
            None => Count::Unbounded(format!("{n}")),
        },
        Some(Value::String(s)) => Count::Input(s.clone()),
        Some(other) => Count::Unbounded(other.to_string()),
        None => Count::Unbounded("no count".into()),
    };
    let mut accumulate = Vec::new();
    if let Some(acc) = a.get("accumulate").and_then(Value::as_object) {
        for (name, init) in acc {
            // An initial value is a literal, an f32 or a vector of f32 unless it says its type.
            let (ty, init) = match init {
                Value::Object(o) => (
                    o.get("type").and_then(Value::as_str).and_then(Ty::parse),
                    o.get("init").cloned().unwrap_or(Value::Null),
                ),
                Value::Number(_) => (Some(Ty::F32), init.clone()),
                Value::Bool(_) => (Some(Ty::BOOL), init.clone()),
                Value::Array(l) if (2..=4).contains(&l.len()) => {
                    (Some(Ty::V(Sc::F32, l.len() as u8)), init.clone())
                }
                Value::String(_) => (None, init.clone()),
                _ => (None, Value::Null),
            };
            match ty {
                Some(ty) => accumulate.push((name.clone(), ty, arg(&init))),
                None => issues.push(Issue::new(
                    "operator_type",
                    format!("accumulator {name} starts at a literal, or {{type, init}}"),
                )),
            }
        }
    }
    Body {
        count,
        index: a
            .get("index")
            .and_then(Value::as_str)
            .unwrap_or("i")
            .to_string(),
        accumulate,
        steps: steps(a.get("body").unwrap_or(&Value::Null), issues),
        stop_if: a.get("stop_if").map(arg),
    }
}

fn input(name: &str, v: &Value, issues: &mut Vec<Issue>) -> Option<Input> {
    let path = format!("inputs/{name}");
    let ty = v.get("type").and_then(Value::as_str).and_then(Ty::parse);
    let bad =
        |issues: &mut Vec<Issue>, m: &str| issues.push(Issue::at_path("operator_type", &path, m));
    let from = match v.get("from") {
        Some(Value::String(s)) if s == "t" || s == "time" => From::Time,
        Some(Value::String(s)) if s == "seed" => From::Seed,
        Some(Value::Object(f)) => {
            if let Some(p) = f.get("param").and_then(Value::as_str) {
                From::Param(p.into())
            } else if let Some(p) = f.get("channel").and_then(Value::as_str) {
                From::Channel(p.into())
            } else if let Some(t) = f.get("texture") {
                let target = t.get("target").unwrap_or(t);
                match (
                    target.get("op"),
                    target.get("output").and_then(Value::as_str),
                ) {
                    (Some(op), Some(output)) => From::Target {
                        op: op.as_str().unwrap_or("core").into(),
                        output: output.into(),
                    },
                    _ => {
                        bad(issues, "a texture input names a target {op, output}");
                        return None;
                    }
                }
            } else if let Some(s) = f.get("storage") {
                From::Storage {
                    op: s.get("op").and_then(Value::as_str).unwrap_or("").into(),
                    output: s.get("output").and_then(Value::as_str).unwrap_or("").into(),
                }
            } else if let Some(p) = f.get("phase") {
                From::Phase(p.get("period").and_then(Value::as_u64).unwrap_or(0))
            } else if let Some(r) = f.get("role").and_then(Value::as_str) {
                From::Role(r.into())
            } else if f.contains_key("time") || f.contains_key("t") {
                From::Time
            } else if f.contains_key("seed") {
                From::Seed
            } else {
                bad(issues, "an input's from is not one of the closed list");
                return None;
            }
        }
        _ => {
            bad(issues, "an input names where it comes from");
            return None;
        }
    };
    let ty = match (&from, ty, v.get("type").and_then(Value::as_str)) {
        (From::Storage { .. }, _, Some(t)) => match Ty::parse(t) {
            Some(Ty::V(sc, 1)) => Ty::Storage(
                sc,
                v.get("count").and_then(Value::as_u64).unwrap_or(0) as u32,
            ),
            _ => {
                bad(issues, "a storage input holds scalars");
                return None;
            }
        },
        (_, Some(t), _) => t,
        (From::Time | From::Phase(_), None, _) => Ty::F32,
        (From::Seed, None, _) => Ty::U32,
        (From::Role(_), None, _) => Ty::V(Sc::F32, 3),
        _ => {
            bad(issues, "an input declares its type");
            return None;
        }
    };
    let range = v
        .get("range")
        .and_then(Value::as_array)
        .and_then(|r| Some([r.first()?.as_f64()?, r.get(1)?.as_f64()?]));
    Some(Input {
        ty,
        from,
        range,
        default: v.get("default").cloned(),
    })
}

/// Reads an operator. Refuses shader text in a field of its own (`operator_source`), unknown
/// fields and malformed parts (`operator_type`) before any later check runs.
pub fn read(v: &Value) -> Result<Operator, Vec<Issue>> {
    let mut issues = Vec::new();
    let Some(o) = v.as_object() else {
        return Err(vec![Issue::new(
            "operator_type",
            "an operator is an object",
        )]);
    };
    for k in o.keys() {
        if CODE_FIELDS.contains(&k.as_str()) {
            issues.push(Issue::at_path(
                "operator_source",
                k,
                "an operator carries no shader text: write it as steps, or as a WGSL-subset source asset the core lowers to steps",
            ));
        } else if !FIELDS.contains(&k.as_str()) {
            issues.push(Issue::at_path(
                "operator_type",
                k,
                "not a field of an operator",
            ));
        }
    }
    let source = match o.get("source") {
        None => None,
        // A source names an asset; its text is never in the operator.
        Some(s) => match s.get("wgsl").and_then(Value::as_str) {
            Some(asset) if !asset.contains('\n') && !asset.contains(';') && asset.len() <= 128 => {
                Some(asset.to_string())
            }
            _ => {
                issues.push(Issue::at_path(
                    "operator_source",
                    "source/wgsl",
                    "source names a WGSL-subset asset by its ID, never inline text",
                ));
                None
            }
        },
    };
    let id = o
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let kind = match o.get("kind").and_then(Value::as_str) {
        Some("material") => Kind::Material,
        Some("pass") => Kind::Pass,
        Some("compute") => Kind::Compute,
        _ => {
            issues.push(Issue::at_path(
                "operator_type",
                "kind",
                "kind is material, pass or compute",
            ));
            Kind::Pass
        }
    };
    let about = o
        .get("about")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if about.is_empty() || about.chars().count() > 400 {
        issues.push(Issue::at_path(
            "operator_type",
            "about",
            "about is required, at most 400 chars",
        ));
    }
    let mut inputs = BTreeMap::new();
    if let Some(i) = o.get("inputs").and_then(Value::as_object) {
        for (name, v) in i {
            if !ident(name) {
                issues.push(Issue::at_path(
                    "operator_type",
                    &format!("inputs/{name}"),
                    "an input's name is an identifier",
                ));
            } else if let Some(input) = input(name, v, &mut issues) {
                inputs.insert(name.clone(), input);
            }
        }
    }
    let steps = match (o.get("steps"), &source) {
        (Some(s), _) => steps(s, &mut issues),
        (None, Some(_)) => BTreeMap::new(),
        (None, None) => {
            issues.push(Issue::at_path(
                "operator_type",
                "steps",
                "an operator has steps or a source",
            ));
            BTreeMap::new()
        }
    };
    let mut outputs = BTreeMap::new();
    let mut storage = BTreeMap::new();
    let mut blend = Blend::Replace;
    if let Some(out) = o.get("outputs").and_then(Value::as_object) {
        for (name, v) in out {
            if name == "blend" {
                blend = match v.as_str() {
                    Some("replace") => Blend::Replace,
                    Some("over") => Blend::Over,
                    Some("add") => Blend::Add,
                    Some("multiply") => Blend::Multiply,
                    Some("screen") => Blend::Screen,
                    _ => {
                        issues.push(Issue::at_path(
                            "operator_type",
                            "outputs/blend",
                            "blend is replace, over, add, multiply or screen",
                        ));
                        Blend::Replace
                    }
                };
                continue;
            }
            if let Some(s) = v.get("storage") {
                let sc = s.get("type").and_then(Value::as_str).and_then(Ty::parse);
                match (sc, s.get("count").and_then(Value::as_u64)) {
                    (Some(Ty::V(sc, 1)), Some(count)) => {
                        storage.insert(
                            name.clone(),
                            StorageOut {
                                sc,
                                count: count as u32,
                            },
                        );
                    }
                    _ => issues.push(Issue::at_path(
                        "operator_type",
                        &format!("outputs/{name}"),
                        "storage is {type: a scalar, count}",
                    )),
                }
                continue;
            }
            match v.get("from").unwrap_or(v) {
                // A source's output names only its type; the source gives its value.
                Value::Object(_) if source.is_some() => {}
                from => {
                    outputs.insert(name.clone(), arg(from));
                }
            }
        }
    }
    let declared = match o.get("determinism").and_then(Value::as_str) {
        None => None,
        Some("exact") => Some(Class::Exact),
        Some("same_machine") => Some(Class::SameMachine),
        Some("live_only") => Some(Class::LiveOnly),
        Some(other) => {
            issues.push(Issue::at_path(
                "operator_type",
                "determinism",
                format!("{other} is not a class"),
            ));
            None
        }
    };
    let cost = o
        .get("cost")
        .and_then(|c| c.get("ns_per_px").or_else(|| c.get("ns_per_element")))
        .and_then(Value::as_f64);
    let size = match o.get("resolution") {
        None => Size::Half,
        Some(Value::String(s)) => match s.as_str() {
            "full" => Size::Full,
            "half" => Size::Half,
            "quarter" => Size::Quarter,
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    "resolution",
                    "resolution is full, half or quarter",
                ));
                Size::Half
            }
        },
        Some(Value::Object(r)) => Size::Of {
            input: r.get("of").and_then(Value::as_str).unwrap_or("").into(),
            scale: r.get("scale").and_then(Value::as_f64).unwrap_or(1.0),
        },
        Some(_) => {
            issues.push(Issue::at_path(
                "operator_type",
                "resolution",
                "resolution is full, half or quarter",
            ));
            Size::Half
        }
    };
    let origin = match o.get("origin").and_then(Value::as_str) {
        Some("shipped") => Origin::Shipped,
        Some("pack") => Origin::Pack,
        _ => Origin::Composed,
    };
    let uses = o
        .get("uses")
        .and_then(Value::as_array)
        .map(|u| {
            u.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Operator {
        id,
        kind,
        about,
        inputs,
        steps,
        outputs,
        storage,
        blend,
        declared,
        cost,
        size,
        elements: o.get("elements").and_then(Value::as_u64).unwrap_or(0) as u32,
        workgroup: o.get("workgroup").and_then(Value::as_u64).unwrap_or(64) as u32,
        source,
        uses,
        origin,
        chain: o
            .get("chain")
            .and_then(Value::as_str)
            .unwrap_or("effects")
            .into(),
        order: o
            .get("order")
            .and_then(Value::as_str)
            .unwrap_or("a0")
            .into(),
    })
}
