//! A GPU operator as data (canvas primitives: GPU operator; Step and the closed step list;
//! Operator input; Operator output): read from its JSON with nothing executable in it. Reading
//! refuses what no graph may carry, shader text in a field first among them; [`crate::check`]
//! does the rest.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// What a collection target's `op` starts with (Effect and GPU operator: collection targets).
pub const COLLECTION: &str = "collection:";

/// A refusal, named by its code and by the step, field or source position it's about.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Issue {
    pub code: &'static str,
    pub step: Option<String>,
    /// The operator item an issue is about, by its ID.
    pub item: Option<String>,
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
            ("item", &self.item),
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
    /// A 3D texture a compute operator wrote earlier in the frame (#483).
    Tex3(Tex),
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
            Ty::Tex3(Tex::Uint) => "texture_3d<u32>".into(),
            Ty::Tex3(_) => "texture_3d<f32>".into(),
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
            "texture3d" | "texture3d<f32>" => return Some(Ty::Tex3(Tex::Float)),
            "texture3d<u32>" => return Some(Ty::Tex3(Tex::Uint)),
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
    /// A 3D texture a compute operator wrote earlier in the frame; `previous` marks a read of
    /// an earlier frame's, which the check refuses (#483).
    Texture3d {
        op: String,
        output: String,
        previous: bool,
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
    /// A mark-set or instance column, per element: storage of its scalars.
    Column {
        item: String,
        name: String,
    },
    /// A builder attribute, per element: storage of its `lanes`-wide elements, packed (a vec3 at
    /// 12 bytes).
    Attribute {
        name: String,
        domain: String,
        lanes: u8,
    },
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
    /// An `iterate@1`'s count, ping-pong targets and body pass (#483).
    pub iterate: Option<Box<Iterate>>,
}

/// `iterate {count ≤ 16, body: pass graph, ping_pong: {format, resolution}}` (Step and the closed
/// step list: structural steps): `body` runs `count` times over two targets, each run reading the
/// last run's output as the input `prev` and its run as the u32 `index`.
#[derive(Clone, Debug, PartialEq)]
pub struct Iterate {
    pub count: u64,
    pub index: String,
    pub format: String,
    pub resolution: Size,
    pub steps: BTreeMap<String, Step>,
    pub outputs: BTreeMap<String, Arg>,
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

/// What draws while an operator compiles, after it's switched off, and in place of a live-only
/// operator in every canonical render.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fallback {
    None,
    Look,
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

/// The formats a compute texture output may take (Operator output).
pub const TEXTURE_FORMATS: &[&str] = &["r32uint", "r32float", "rgba16float", "rgba8unorm"];

/// A compute operator's texture output: `texture {format, size, mips}` (2D) or `texture3d
/// {format, size}` (#483).
#[derive(Clone, Debug, PartialEq)]
pub struct TexOut {
    pub format: String,
    /// Width, height and depth (1 for 2D).
    pub size: [u32; 3],
    pub dim3: bool,
    pub mips: bool,
}

impl TexOut {
    /// Bytes a texel takes.
    pub fn texel_bytes(&self) -> u64 {
        match self.format.as_str() {
            "rgba16float" => 8,
            _ => 4,
        }
    }

    /// Bytes it takes in the class's operator storage: its texels, and a third more with mips.
    pub fn bytes(&self) -> u64 {
        let base = self.texel_bytes() * self.size.iter().map(|&n| u64::from(n)).product::<u64>();
        if self.mips {
            base + base / 3
        } else {
            base
        }
    }

    /// The value one of its texels holds.
    pub fn value(&self) -> Ty {
        match self.format.as_str() {
            "r32uint" => Ty::U32,
            "r32float" => Ty::F32,
            _ => Ty::V(Sc::F32, 4),
        }
    }
}

/// A compute operator's output: storage of `count` scalars.
#[derive(Clone, Debug, PartialEq)]
pub struct StorageOut {
    pub sc: Sc,
    pub count: u32,
    /// The multi-dispatch step whose result it takes (`from: step[.port]`, #483).
    pub from: Option<Arg>,
    /// The word every row holds when the frame starts (#484); 0 unless it says.
    pub clear: u32,
}

/// A compute operator's `instances` output (#484; Operator output): the instancer it draws, and
/// the compact step whose kept rows are what draws.
#[derive(Clone, Debug, PartialEq)]
pub struct InstancesOut {
    pub instancer: String,
    pub columns: Vec<String>,
    pub count: Option<String>,
}

/// The input an indirect dispatch's count arrives through (#484): it binds as any storage input,
/// and it orders the operator after the one that wrote the count.
pub const DISPATCH_COUNT: &str = "dispatch_count";

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
    /// A compute operator's texture outputs (#483).
    pub textures: BTreeMap<String, TexOut>,
    /// A compute operator's instances outputs (#484).
    pub instances: BTreeMap<String, InstancesOut>,
    pub blend: Blend,
    pub declared: Option<Class>,
    pub fallback: Fallback,
    /// ns per pixel (material, pass) or per element (compute).
    pub cost: Option<f64>,
    pub size: Size,
    /// A compute operator's elements per dispatch: an indirect dispatch's `max`, which the check
    /// costs it at.
    pub elements: u32,
    /// Whether a count written earlier in the frame runs it (`elements: {from, max}`, #484), read
    /// through the input [`DISPATCH_COUNT`].
    pub counted: bool,
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
const LITERAL_FIELDS: &[&str] = &[
    "value",
    "type",
    "to",
    "pick",
    "of",
    "name",
    "space",
    "period",
    "octaves",
    "lacunarity",
    "gain",
    // scan's operator (#483).
    "op",
    // blend's mode (#430).
    "mode",
];
/// The look's status roles: no operator reads or writes one (Status guard).
pub const STATUS_ROLES: &[&str] = &[
    "pass",
    "fail",
    "invalid",
    "blocked",
    "inconclusive",
    "running",
    "needs_you",
    "stale",
    "idle",
];

/// The input a `role@1 {name}` step reads its color from.
pub fn role_input(name: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("role__{safe}")
}

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
    if let Some(k) = o.keys().find(|k| CODE_FIELDS.contains(&k.as_str())) {
        issues.push(Issue::at_step(
            "operator_source",
            id,
            format!("a step carries no shader text ({k}): every step is an op from the closed list"),
        ));
        return None;
    }
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
    let iterating = op == "iterate@1";
    let role = (op == "role@1")
        .then(|| given.get("name").and_then(Value::as_str))
        .flatten();
    let mut args = BTreeMap::new();
    let mut fields = Map::new();
    for (port, v) in given {
        if LITERAL_FIELDS.contains(&port.as_str()) {
            fields.insert(port.clone(), v.clone());
        } else if !(repeat
            && ["count", "accumulate", "body", "stop_if", "index"].contains(&port.as_str()))
            && !(iterating && ["count", "body", "index", "ping_pong"].contains(&port.as_str()))
        {
            args.insert(port.clone(), arg(v));
        }
    }
    let body = repeat.then(|| Box::new(body(given, issues)));
    let iterate = iterating.then(|| Box::new(iterate(id, given, issues)));
    if let Some(name) = role {
        args.insert("x".into(), Arg::Ref(role_input(name), None));
    }
    Some(Step {
        op: op.into(),
        args,
        when: o.get("when").and_then(Value::as_str).map(String::from),
        fields,
        body,
        iterate,
    })
}

fn size_of(v: Option<&Value>, path: &str, issues: &mut Vec<Issue>) -> Size {
    match v.and_then(Value::as_str) {
        None | Some("half") => Size::Half,
        Some("full") => Size::Full,
        Some("quarter") => Size::Quarter,
        Some(_) => {
            issues.push(Issue::at_path(
                "operator_type",
                path,
                "resolution is full, half or quarter",
            ));
            Size::Half
        }
    }
}

fn iterate(id: &str, a: &Map<String, Value>, issues: &mut Vec<Issue>) -> Iterate {
    let pp = a.get("ping_pong");
    let body = a.get("body");
    let mut outputs = BTreeMap::new();
    if let Some(o) = body.and_then(|b| b.get("outputs")).and_then(Value::as_object) {
        for (name, v) in o {
            outputs.insert(name.clone(), arg(v));
        }
    }
    let count = match a.get("count").and_then(Value::as_u64) {
        Some(c) => c,
        None => {
            issues.push(Issue::at_step(
                "operator_unbounded",
                id,
                "an iterate's count is a literal, fixed at check",
            ));
            0
        }
    };
    Iterate {
        count,
        index: a
            .get("index")
            .and_then(Value::as_str)
            .unwrap_or("index")
            .to_string(),
        format: pp
            .and_then(|p| p.get("format"))
            .and_then(Value::as_str)
            .unwrap_or("rgba16float")
            .to_string(),
        resolution: size_of(pp.and_then(|p| p.get("resolution")), "steps", issues),
        steps: steps(
            body.and_then(|b| b.get("steps")).unwrap_or(&Value::Null),
            issues,
        ),
        outputs,
    }
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
                    target.get("collection").and_then(Value::as_str),
                ) {
                    // #149: a collection's own target, which the frame draws before its passes.
                    (_, Some(output), Some(collection)) => From::Target {
                        op: format!("{COLLECTION}{collection}"),
                        output: output.into(),
                    },
                    (Some(op), Some(output), _) => From::Target {
                        op: op.as_str().unwrap_or("core").into(),
                        output: output.into(),
                    },
                    _ => {
                        bad(issues, "a texture input names a target {op, output}");
                        return None;
                    }
                }
            } else if let Some(t) = f.get("texture3d") {
                From::Texture3d {
                    op: t.get("op").and_then(Value::as_str).unwrap_or("").into(),
                    output: t.get("output").and_then(Value::as_str).unwrap_or("").into(),
                    previous: t
                        .get("frame")
                        .and_then(Value::as_str)
                        .is_some_and(|f| f != "current"),
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
            } else if let Some(c) = f.get("column") {
                From::Column {
                    item: c.get("item").and_then(Value::as_str).unwrap_or("").into(),
                    name: c.get("name").and_then(Value::as_str).unwrap_or("").into(),
                }
            } else if let Some(a) = f.get("attribute") {
                From::Attribute {
                    name: a.get("name").and_then(Value::as_str).unwrap_or("").into(),
                    domain: a.get("domain").and_then(Value::as_str).unwrap_or("").into(),
                    lanes: match ty {
                        Some(Ty::V(_, n)) => n,
                        _ => 1,
                    },
                }
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
        (From::Storage { .. } | From::Column { .. } | From::Attribute { .. }, _, Some(t)) => {
            match Ty::parse(t) {
                Some(Ty::V(sc, n)) if n == 1 || matches!(from, From::Attribute { .. }) => {
                    Ty::Storage(
                        sc,
                        v.get("count").and_then(Value::as_u64).unwrap_or(0) as u32,
                    )
                }
                _ => {
                    bad(issues, "a storage input holds scalars");
                    return None;
                }
            }
        }
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
    // Each role a `role@1` step names is an input of the operator, theme-resolved like `from:
    // {role}`; a status role is refused by the check, naming the step.
    let mut roles = Vec::new();
    let mut stack: Vec<&BTreeMap<String, Step>> = vec![&steps];
    while let Some(st) = stack.pop() {
        for s in st.values() {
            if s.op == "role@1" {
                if let Some(n) = s.fields.get("name").and_then(Value::as_str) {
                    roles.push(n.to_string());
                }
            }
            if let Some(b) = &s.body {
                stack.push(&b.steps);
            }
            if let Some(it) = &s.iterate {
                stack.push(&it.steps);
            }
        }
    }
    for name in roles {
        inputs.entry(role_input(&name)).or_insert(Input {
            ty: Ty::V(Sc::F32, 3),
            from: From::Role(name),
            range: None,
            default: None,
        });
    }
    let mut outputs = BTreeMap::new();
    let mut storage = BTreeMap::new();
    let mut instances = BTreeMap::new();
    let mut textures = BTreeMap::new();
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
            if let Some((t, dim3)) = v
                .get("texture")
                .map(|t| (t, false))
                .or_else(|| v.get("texture3d").map(|t| (t, true)))
            {
                let path = format!("outputs/{name}");
                let format = t.get("format").and_then(Value::as_str).unwrap_or("");
                let size: Vec<u32> = t
                    .get("size")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_u64).map(|n| n as u32).collect())
                    .unwrap_or_default();
                let mips = t.get("mips").and_then(Value::as_bool).unwrap_or(false);
                let dims = if dim3 { 3 } else { 2 };
                if !TEXTURE_FORMATS.contains(&format) || size.len() != dims {
                    issues.push(Issue::at_path(
                        "operator_type",
                        &path,
                        format!("a texture output is {{format: {}, size: [{dims} sizes]}}", TEXTURE_FORMATS.join(" | ")),
                    ));
                    continue;
                }
                textures.insert(
                    name.clone(),
                    TexOut {
                        format: format.into(),
                        size: [size[0], size[1], if dim3 { size[2] } else { 1 }],
                        dim3,
                        mips,
                    },
                );
                continue;
            }
            if let Some(i) = v.get("instances") {
                instances.insert(
                    name.clone(),
                    InstancesOut {
                        instancer: i.get("instancer").and_then(Value::as_str).unwrap_or("").into(),
                        columns: i
                            .get("columns")
                            .and_then(Value::as_array)
                            .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
                            .unwrap_or_default(),
                        count: i.get("count").and_then(Value::as_str).map(String::from),
                    },
                );
                continue;
            }
            // A readback (exact only, ≤ 64 KiB) is storage the CPU reads back a frame late.
            if let Some(s) = v.get("storage").or_else(|| v.get("readback")) {
                if v.get("readback").is_some()
                    && s.get("bytes").and_then(Value::as_u64).unwrap_or(0) > 65_536
                {
                    issues.push(Issue::at_path(
                        "operator_limit",
                        &format!("outputs/{name}"),
                        "a readback holds at most 64 KiB",
                    ));
                }
                let sc = s.get("type").and_then(Value::as_str).and_then(Ty::parse);
                match (sc, s.get("count").and_then(Value::as_u64)) {
                    (Some(Ty::V(sc, 1)), Some(count)) => {
                        storage.insert(
                            name.clone(),
                            StorageOut {
                                sc,
                                count: count as u32,
                                from: v.get("from").map(arg),
                                clear: s.get("clear").and_then(Value::as_u64).unwrap_or(0) as u32,
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
    let fallback = match o.get("fallback").and_then(Value::as_str) {
        None | Some("look") => Fallback::Look,
        Some("none") => Fallback::None,
        Some(other) => {
            issues.push(Issue::at_path(
                "operator_type",
                "fallback",
                format!("fallback is none or look, not {other}"),
            ));
            Fallback::Look
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
    // An indirect dispatch (#484): `elements: {from: <op>.<output>, max}`, its count an input.
    let counted_by = o.get("elements").filter(|e| e.is_object());
    let elements = counted_by.map_or(o.get("elements"), |e| e.get("max"));
    let counted = counted_by.is_some();
    if let Some(e) = counted_by {
        match e.get("from").and_then(Value::as_str).and_then(|f| f.split_once('.')) {
            Some((op, output)) => {
                inputs.insert(
                    DISPATCH_COUNT.to_string(),
                    Input {
                        ty: Ty::Storage(Sc::U32, 1),
                        from: From::Storage {
                            op: op.into(),
                            output: output.into(),
                        },
                        range: None,
                        default: None,
                    },
                );
            }
            None => issues.push(Issue::at_path(
                "operator_type",
                "elements",
                "an indirect dispatch's from is <op>.<output>",
            )),
        }
    }
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
        textures,
        instances,
        blend,
        declared,
        fallback,
        cost,
        size,
        elements: elements.and_then(Value::as_u64).unwrap_or(0) as u32,
        counted,
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
