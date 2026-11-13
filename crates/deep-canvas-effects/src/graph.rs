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
    /// Why a kind rule refuses it, as a word (`derivative_in_divergent_flow`).
    pub reason: Option<&'static str>,
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
        if let Some(r) = self.reason {
            o.insert("reason".into(), json!(r));
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
    /// An image by its SHA-256 (#431: `texture: sha256`), decoded as a map is, with its mips.
    Asset(String),
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
    /// Storage an operator wrote earlier in the frame; with `previous` (#252), a stepped
    /// operator's carried output as the previous fixed step left it.
    Storage {
        op: String,
        output: String,
        previous: bool,
    },
    Time,
    /// The fixed step a stepped operator computes, 0 for the first (#252).
    Step,
    /// A phase in [0, 1) of `period` flicks.
    Phase(u64),
    Seed,
    Role(String),
    /// A `spline@1`'s table, built at check from its points (#431): each piece's four cubic
    /// coefficients in 16 slots, then its points' x in 4.
    Spline(Vec<[f64; 4]>),
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
    /// A light response's input, which the core's light loop hands it (#485): `n`, `l`,
    /// `radiance` and the rest.
    Port,
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
    /// Carried state (#252): kept from step to step, with a checkpoint every `every` steps in a
    /// ring of at most `budget` bytes.
    pub carry: Option<Carry>,
}

/// A stepped operator's carried storage output and its checkpoint ring (#252; canvas primitives:
/// Carried state; Checkpoint ring).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Carry {
    pub every: u32,
    pub budget: u64,
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
    /// A compute operator stepped once per fixed step, `rate` steps a second, not once a frame
    /// (#252).
    pub stepped: Option<u32>,
    pub workgroup: u32,
    /// A WGSL-subset source's asset ID, in place of steps.
    pub source: Option<String>,
    pub uses: Vec<String>,
    pub origin: Origin,
    /// A pass's chain (`effects` or `finish`) and order key.
    pub chain: String,
    pub order: String,
    /// A material's light responses (#485), by output (`light`, `ambient`): each a material
    /// operator of its own over its ports and the operator's value inputs. A default named, or
    /// none, leaves the core's own shading.
    pub responses: BTreeMap<String, Operator>,
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
    "stepped",
    // Whether a pixel-wise pass may fuse with its neighbours (#432: pass fusion).
    "fuse",
    // A material's light responses (#485).
    "light",
    "ambient",
];
/// Fields that hold a program's text in other engines' formats.
const CODE_FIELDS: &[&str] = &[
    "wgsl", "glsl", "hlsl", "msl", "shader", "code", "spirv", "program", "fragment", "vertex",
];
/// An op's own literal fields, which its args may hold beside its ports.
pub(crate) const LITERAL_FIELDS: &[&str] = &[
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
    // blend's and adjust's mode (#430, #431).
    "mode",
    // spline's points, homography's literal quad, cells' jitter and metric (#431).
    "points",
    "quad",
    "jitter",
    "metric",
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

/// The texture input a `backdrop@1` step reads (#431): the copy of the opaque scene that
/// transmission samples, the core's target `backdrop`.
pub const BACKDROP_INPUT: &str = "backdrop__";

/// The slots a `spline@1`'s table takes in the input buffer: 16 of coefficients, 4 of x.
pub const SPLINE_SLOTS: u32 = 20;

/// The input a `spline@1 {points}` step reads its table from, named by its points, so equal
/// splines share one.
pub fn spline_input(points: &Value) -> String {
    let h = points.to_string().bytes().fold(0x811c_9dc5u32, |h, b| {
        (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
    });
    format!("spline__{h:08x}")
}

/// A spline's table as its input holds it: each piece's coefficients, then the points' x four
/// to a slot.
pub fn spline_slots(points: &Value) -> Option<Vec<[f64; 4]>> {
    let pts = deep_canvas::steps::spline_points(points).ok()?;
    let mut slots = vec![[0.0; 4]; SPLINE_SLOTS as usize];
    for (k, c) in deep_canvas::steps::spline_table(&pts)
        .into_iter()
        .enumerate()
    {
        slots[k] = c;
    }
    for (k, p) in pts.iter().enumerate() {
        slots[16 + k / 4][k % 4] = p[0];
    }
    Some(slots)
}

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
            format!(
                "a step carries no shader text ({k}): every step is an op from the closed list"
            ),
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
        // A quad that names a value (an array of four corners) is an argument.
        if LITERAL_FIELDS.contains(&port.as_str()) && !(port == "quad" && v.is_string()) {
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

fn resolution_of(v: Option<&Value>, path: &str, issues: &mut Vec<Issue>) -> Size {
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
    if let Some(o) = body
        .and_then(|b| b.get("outputs"))
        .and_then(Value::as_object)
    {
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
        resolution: resolution_of(pp.and_then(|p| p.get("resolution")), "steps", issues),
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
            } else if let Some(sha) = f.get("texture").and_then(Value::as_str) {
                if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                    bad(
                        issues,
                        "a texture input names a target {op, output} or an image's SHA-256",
                    );
                    return None;
                }
                From::Asset(sha.to_ascii_lowercase())
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
                    previous: match s.get("step") {
                        None => false,
                        Some(Value::String(p)) if p == "previous" => true,
                        Some(_) => {
                            bad(issues, "a storage input's step is previous");
                            return None;
                        }
                    },
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
            } else if f.get("time").and_then(Value::as_str) == Some("step") {
                From::Step
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
        (From::Seed | From::Step, None, _) => Ty::U32,
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
    // A call to a step function scene3d ships, such as core.bump@1, is inlined first (#486), on
    // every path that reads an operator.
    let shipped = Shipped::default();
    if calls_shipped(&v["steps"], &shipped) {
        return read(&inline_with(v, &Functions::new(), &shipped, true)?);
    }
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
    let mut splines = Vec::new();
    let mut backdrop = false;
    let mut stack: Vec<&BTreeMap<String, Step>> = vec![&steps];
    while let Some(st) = stack.pop() {
        for s in st.values() {
            if s.op == "role@1" {
                if let Some(n) = s.fields.get("name").and_then(Value::as_str) {
                    roles.push(n.to_string());
                }
            }
            if s.op == "backdrop@1" {
                backdrop = true;
            }
            if s.op == "spline@1" {
                let points = s.fields.get("points").cloned().unwrap_or(Value::Null);
                if let Some(slots) = spline_slots(&points) {
                    splines.push((spline_input(&points), slots));
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
    if backdrop {
        inputs.entry(BACKDROP_INPUT.into()).or_insert(Input {
            ty: Ty::Tex(Tex::Float),
            from: From::Target {
                op: "core".into(),
                output: "backdrop".into(),
            },
            range: None,
            default: None,
        });
    }
    for (name, slots) in splines {
        inputs.entry(name).or_insert(Input {
            ty: Ty::Arr(Sc::F32, 4, SPLINE_SLOTS),
            from: From::Spline(slots),
            range: None,
            default: None,
        });
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
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_u64)
                            .map(|n| n as u32)
                            .collect()
                    })
                    .unwrap_or_default();
                let mips = t.get("mips").and_then(Value::as_bool).unwrap_or(false);
                let dims = if dim3 { 3 } else { 2 };
                if !TEXTURE_FORMATS.contains(&format) || size.len() != dims {
                    issues.push(Issue::at_path(
                        "operator_type",
                        &path,
                        format!(
                            "a texture output is {{format: {}, size: [{dims} sizes]}}",
                            TEXTURE_FORMATS.join(" | ")
                        ),
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
                        instancer: i
                            .get("instancer")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .into(),
                        columns: i
                            .get("columns")
                            .and_then(Value::as_array)
                            .map(|a| {
                                a.iter()
                                    .filter_map(Value::as_str)
                                    .map(String::from)
                                    .collect()
                            })
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
                // Carried state (#252): `carry: {every: steps ≥ 1, budget: bytes}`.
                let carry = v.get("carry").map(|c| {
                    let every = c
                        .get("every")
                        .and_then(Value::as_u64)
                        .and_then(|e| u32::try_from(e).ok());
                    match (every, c.get("budget").and_then(Value::as_u64)) {
                        (Some(every @ 1..), Some(budget)) => Some(Carry { every, budget }),
                        _ => {
                            issues.push(Issue::at_path(
                                "operator_type",
                                &format!("outputs/{name}/carry"),
                                "carry is {every: steps, at least 1, budget: bytes}",
                            ));
                            None
                        }
                    }
                });
                let carry = carry.flatten();
                match (sc, s.get("count").and_then(Value::as_u64)) {
                    (Some(Ty::V(sc, 1)), Some(count)) => {
                        storage.insert(
                            name.clone(),
                            StorageOut {
                                sc,
                                count: count as u32,
                                from: v.get("from").map(arg),
                                clear: s.get("clear").and_then(Value::as_u64).unwrap_or(0) as u32,
                                carry,
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
    match o.get("fuse") {
        None | Some(Value::Null) => {}
        Some(Value::String(f)) if f == "pixel_wise" || f == "none" => {}
        Some(other) => issues.push(Issue::at_path(
            "operator_type",
            "fuse",
            format!("fuse is pixel_wise or none, not {other}"),
        )),
    }
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
        match e
            .get("from")
            .and_then(Value::as_str)
            .and_then(|f| f.split_once('.'))
        {
            Some((op, output)) => {
                inputs.insert(
                    DISPATCH_COUNT.to_string(),
                    Input {
                        ty: Ty::Storage(Sc::U32, 1),
                        from: From::Storage {
                            op: op.into(),
                            output: output.into(),
                            previous: false,
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
    // A stepped operator (#252): `stepped: {rate}`, steps a second of document time.
    let stepped = match o.get("stepped") {
        None => None,
        Some(st) => match st
            .get("rate")
            .and_then(Value::as_u64)
            .and_then(|r| u32::try_from(r).ok())
        {
            Some(r @ 1..=1000) => Some(r),
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    "stepped",
                    "stepped is {rate: steps a second, 1 to 1,000}",
                ));
                None
            }
        },
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
    let responses = read_responses(o, kind, &inputs, &id, &mut issues);
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Operator {
        responses,
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
        stepped,
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

/// A pack's step functions by name (`<pack>.<fn>@major`), each `{about, ports: {in: {name →
/// type}, out: {name → type}}, steps}` (Shipped operators and composed graphs: pack graphs and
/// step functions).
pub type Functions = BTreeMap<String, Value>;

/// How deep step functions may call each other.
const USE_DEPTH: usize = 4;

/// A WGSL type of scene3d's response ports as a step type.
fn port_ty(t: &str) -> Ty {
    match t {
        "vec3<f32>" => Ty::V(Sc::F32, 3),
        "u32" => Ty::U32,
        _ => Ty::F32,
    }
}

/// The values a port spans, for the values stage: unit vectors, light (linear, ≥ 0), and the
/// part's own fields in [0, 1].
fn port_range(name: &str) -> Option<[f64; 2]> {
    match name {
        "n" | "v" | "l" => Some([-1.0, 1.0]),
        "radiance" | "irradiance" | "env" => Some([0.0, 1e6]),
        "light_hash" => None,
        _ => Some([0.0, 1.0]),
    }
}

/// A material's light responses (#485; Operator output: light response): each of `light` and
/// `ambient` absent, its default's name (the core's own shading), or a graph `{steps, outputs:
/// {radiance: <step>}}` read as a material operator of its own whose inputs are its ports, then
/// the operator's value inputs; its one output takes the response's name.
fn read_responses(
    o: &Map<String, Value>,
    kind: Kind,
    inputs: &BTreeMap<String, Input>,
    id: &str,
    issues: &mut Vec<Issue>,
) -> BTreeMap<String, Operator> {
    let mut out = BTreeMap::new();
    for (name, ports, default) in deep_canvas_scene3d::gpu::RESPONSES {
        let Some(v) = o.get(*name) else {
            continue;
        };
        if kind != Kind::Material {
            issues.push(Issue::at_path(
                "operator_type",
                name,
                "only a material operator answers the light loop",
            ));
            continue;
        }
        if v.as_str() == Some(*default) {
            continue;
        }
        let graph = v.as_object().filter(|g| {
            g.keys().all(|k| k == "steps" || k == "outputs")
                && g.get("outputs")
                    .and_then(Value::as_object)
                    .is_some_and(|r| r.len() == 1 && r["radiance"].is_string())
        });
        let Some(graph) = graph else {
            issues.push(Issue::at_path(
                "operator_type",
                name,
                format!("{name} is {default} or a graph {{steps, outputs: {{radiance: <step>}}}}"),
            ));
            continue;
        };
        let mut outputs = Map::new();
        outputs.insert((*name).into(), graph["outputs"]["radiance"].clone());
        let mut sub = json!({
            "id": format!("{id}.{name}"),
            "kind": "material",
            "steps": graph.get("steps").cloned().unwrap_or_else(|| json!({})),
            "outputs": outputs,
        });
        for k in ["about", "origin", "cost"] {
            if let Some(x) = o.get(k) {
                sub[k] = x.clone();
            }
        }
        let mut r = match read(&sub) {
            Ok(r) => r,
            Err(e) => {
                issues.extend(e.into_iter().map(|mut i| {
                    i.path = Some(format!("{name}/{}", i.path.take().unwrap_or_default()));
                    i
                }));
                continue;
            }
        };
        let own = deep_canvas_scene3d::gpu::response_in(ports);
        for (port, t) in &own {
            r.inputs.insert(
                (*port).into(),
                Input {
                    ty: port_ty(t),
                    from: From::Port,
                    range: port_range(port),
                    default: None,
                },
            );
        }
        // The operator's value inputs, read from its uniform as its own steps read them.
        for (n, i) in inputs {
            if own.iter().any(|(p, _)| p == n) {
                issues.push(Issue::at_path(
                    "operator_type",
                    &format!("inputs/{n}"),
                    format!("{n} is an input of the light loop's {name}"),
                ));
            } else if !matches!(
                i.ty,
                Ty::Tex(_) | Ty::Tex3(_) | Ty::Storage(..) | Ty::Arr(..)
            ) {
                r.inputs.entry(n.clone()).or_insert_with(|| i.clone());
            }
        }
        out.insert((*name).to_string(), r);
    }
    out
}

/// The step functions canvas modules ship (#486: scene3d's `core.bump@1`), which any operator
/// calls by name as it calls a pack's: built by the read or the inlining that first looks one
/// up, and held by it, so an operator that calls none never builds them.
#[derive(Default)]
struct Shipped(std::cell::OnceCell<Functions>);

impl Shipped {
    fn get(&self, name: &str) -> Option<&Value> {
        self.0
            .get_or_init(|| deep_canvas_scene3d::gpu::functions().into_iter().collect())
            .get(name)
    }
}

/// The step function `name`: a pack's, else a shipped one.
fn function<'a>(functions: &'a Functions, shipped: &'a Shipped, name: &str) -> Option<&'a Value> {
    functions.get(name).or_else(|| shipped.get(name))
}

/// Whether `steps`, or a repeat's body among them, calls a shipped step function.
fn calls_shipped(steps: &Value, shipped: &Shipped) -> bool {
    steps.as_object().into_iter().flatten().any(|(_, s)| {
        (s["op"] == "use@1"
            && s["args"]["name"]
                .as_str()
                .is_some_and(|n| shipped.get(n).is_some()))
            || calls_shipped(&s["args"]["body"], shipped)
    })
}

/// Whether a step function's body takes implicit derivatives, its own or through a function it
/// calls: `ddx`, `ddy`, `fwidth`, `triplanar` or a `sample` with no `lod`.
fn holds_derivative(f: &Value, functions: &Functions, shipped: &Shipped, depth: usize) -> bool {
    fn any(
        steps: &Map<String, Value>,
        functions: &Functions,
        shipped: &Shipped,
        depth: usize,
    ) -> bool {
        steps.values().any(|s| {
            let op = s["op"].as_str().unwrap_or("");
            matches!(op, "ddx@1" | "ddy@1" | "fwidth@1" | "triplanar@1")
                || (op == "sample@1" && s["args"].get("lod").is_none())
                || (op == "use@1"
                    && depth < USE_DEPTH
                    && s["args"]["name"]
                        .as_str()
                        .and_then(|n| function(functions, shipped, n))
                        .is_some_and(|g| holds_derivative(g, functions, shipped, depth + 1)))
                || s["args"]["body"]
                    .as_object()
                    .is_some_and(|b| any(b, functions, shipped, depth))
        })
    }
    f["steps"]
        .as_object()
        .is_some_and(|s| any(s, functions, shipped, depth))
}

/// Each `use@1` step inlined (#431): a call `{op: "use@1", args: {name, <in port>: arg}}` becomes
/// its function's body, each body step named `<call>__<step>`, its in ports reading the call's
/// arguments, and every `<call>.<out port>` reading the body step of that name. A call counts as
/// the derivatives its body holds, so where pixels may diverge (inside a repeat with a `stop_if`,
/// or under a `when`) the call itself is refused with `operator_kind_rule {step, reason:
/// derivative_in_divergent_flow}` while `rule` holds. A name no function has is refused.
pub fn inline_functions(
    op: &Value,
    functions: &Functions,
    rule: bool,
) -> Result<Value, Vec<Issue>> {
    inline_with(op, functions, &Shipped::default(), rule)
}

/// [`inline_functions`] with the shipped step functions `shipped` holds.
fn inline_with(
    op: &Value,
    functions: &Functions,
    shipped: &Shipped,
    rule: bool,
) -> Result<Value, Vec<Issue>> {
    #[allow(clippy::too_many_arguments)]
    fn expand(
        steps: &mut Map<String, Value>,
        functions: &Functions,
        shipped: &Shipped,
        rule: bool,
        divergent: bool,
        depth: usize,
        renames: &mut Vec<(String, String)>,
        issues: &mut Vec<Issue>,
    ) {
        let ids: Vec<String> = steps.keys().cloned().collect();
        for id in ids {
            let step = steps[&id].clone();
            match step["op"].as_str() {
                Some(r) if r.starts_with("repeat@") => {
                    let stop = step["args"].get("stop_if").is_some();
                    if let Some(body) = steps
                        .get_mut(&id)
                        .and_then(|s| s["args"]["body"].as_object_mut())
                    {
                        expand(
                            body,
                            functions,
                            shipped,
                            rule,
                            divergent || stop,
                            depth,
                            renames,
                            issues,
                        );
                    }
                    continue;
                }
                Some("use@1") => {}
                _ => continue,
            }
            let name = step["args"]["name"].as_str().unwrap_or("");
            let Some(f) = function(functions, shipped, name).filter(|_| depth < USE_DEPTH) else {
                issues.push(Issue::at_step(
                    "operator_unknown_op",
                    &id,
                    format!("use names {name}, which no installed pack's step function is (or calls past {USE_DEPTH} deep)"),
                ));
                continue;
            };
            if rule
                && (divergent || step.get("when").is_some())
                && holds_derivative(f, functions, shipped, 0)
            {
                issues.push(Issue {
                    reason: Some("derivative_in_divergent_flow"),
                    ..Issue::at_step(
                        "operator_kind_rule",
                        &id,
                        format!("{name}'s body takes implicit derivatives, which need every pixel of a quad to run it together: not under a when or in a repeat with a stop_if"),
                    )
                });
                continue;
            }
            let ins = f["ports"]["in"].as_object().cloned().unwrap_or_default();
            let body = f["steps"].as_object().cloned().unwrap_or_default();
            steps.remove(&id);
            let mut inlined = Map::new();
            for (inner, s) in &body {
                let mut s = s.clone();
                if let Some(args) = s["args"].as_object_mut() {
                    for (port, v) in args.iter_mut() {
                        if LITERAL_FIELDS.contains(&port.as_str()) {
                            continue;
                        }
                        let Some(r) = v.as_str() else { continue };
                        let head = r.split('.').next().unwrap_or(r);
                        if ins.contains_key(r) {
                            *v = step["args"].get(r).cloned().unwrap_or(Value::Null);
                        } else if body.contains_key(head) {
                            *v = json!(format!("{id}__{r}"));
                        }
                    }
                }
                inlined.insert(format!("{id}__{inner}"), s);
            }
            for port in f["ports"]["out"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, _)| k)
            {
                renames.push((format!("{id}.{port}"), format!("{id}__{port}")));
            }
            // A function that calls another is expanded in turn, one level deeper.
            expand(
                &mut inlined,
                functions,
                shipped,
                rule,
                divergent,
                depth + 1,
                renames,
                issues,
            );
            steps.extend(inlined);
        }
    }
    fn rewrite(v: &mut Value, renames: &[(String, String)]) {
        match v {
            Value::String(s) => {
                if let Some((_, to)) = renames.iter().find(|(from, _)| from == s) {
                    *s = to.clone();
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| rewrite(x, renames)),
            Value::Object(o) => o.values_mut().for_each(|x| rewrite(x, renames)),
            _ => {}
        }
    }
    let mut op = op.clone();
    let mut renames = Vec::new();
    let mut issues = Vec::new();
    if let Some(steps) = op.get_mut("steps").and_then(Value::as_object_mut) {
        expand(
            steps,
            functions,
            shipped,
            rule,
            false,
            0,
            &mut renames,
            &mut issues,
        );
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    if !renames.is_empty() {
        for k in ["steps", "outputs"] {
            if let Some(v) = op.get_mut(k) {
                rewrite(v, &renames);
            }
        }
    }
    Ok(op)
}
