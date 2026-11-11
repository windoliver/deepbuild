//! The world document `physics.world@1` read into this crate's own types, with the design's
//! defaults (canvas primitives: World and backend, Shape, Body, Contact material, Collision group,
//! Joint, Force). A field the reader doesn't know, a value out of its range or a reference to
//! nothing is refused at its path; nothing is dropped silently (invariant 2).

use std::collections::BTreeMap;

use serde_json::{Map, Value};

/// One refusal: its code, the path of the field it names, the value there and what it means.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub actual: Value,
    pub what: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Dynamic,
    Kinematic,
}

/// A combine rule (World: `combine`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rule {
    Geometric,
    Average,
    Min,
    Max,
    Multiply,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Sleep {
    pub on: bool,
    pub speed: f64,
    pub time: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Solver {
    pub contact_hz: f64,
    pub contact_damping: f64,
    pub max_speed: f64,
    pub restitution_threshold: f64,
    pub hit_threshold: f64,
    pub sleep: Sleep,
    pub ccd: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Material {
    pub friction: f64,
    pub restitution: f64,
    pub density: Option<f64>,
    pub rolling_resistance: f64,
    pub tangent_speed: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Sphere {
        radius: f64,
    },
    Box {
        half: [f64; 3],
    },
    Capsule {
        half_height: f64,
        radius: f64,
    },
    Cylinder {
        half_height: f64,
        radius: f64,
    },
    Plane {
        normal: [f64; 3],
    },
    /// The hull of at most 64 points, rounded by `radius`.
    Convex {
        points: Vec<[f64; 3]>,
        radius: f64,
    },
    /// Triangles over vertices; static only.
    Mesh {
        vertices: Vec<[f64; 3]>,
        triangles: Vec<[u32; 3]>,
    },
    /// Other shapes of the world by ID, each at its pose.
    Compound {
        children: Vec<(String, Pose)>,
    },
}

/// A rotation as written: a quaternion `[x, y, z, w]` or Euler degrees `[x, y, z]`.
#[derive(Clone, Debug, PartialEq)]
pub enum Rot {
    Quat([f64; 4]),
    Deg([f64; 3]),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    pub pos: [f64; 3],
    pub rot: Rot,
}

/// A shape on a body (Shape: each use on a body).
#[derive(Clone, Debug, PartialEq)]
pub struct ShapeUse {
    pub shape: String,
    pub offset: Pose,
    /// The material's ID; `None` takes the world's defaults.
    pub material: Option<String>,
    /// Bit masks over `collision_groups`; all bits when absent.
    pub member: u32,
    pub collides: u32,
    pub sensor: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BodyKind {
    Static,
    Dynamic,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Body {
    pub kind: BodyKind,
    pub shapes: Vec<ShapeUse>,
    pub pose: Pose,
    pub linear: [f64; 3],
    /// deg/s, as written.
    pub angular: [f64; 3],
    pub mass: Option<f64>,
    pub linear_damping: f64,
    pub angular_damping: f64,
    pub gravity_scale: f64,
    pub ccd: bool,
    pub sleep: bool,
    pub lock_linear: [bool; 3],
    pub lock_angular: [bool; 3],
    pub active: bool,
    pub anchors: BTreeMap<String, [f64; 3]>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JointKind {
    Fixed,
    Ball,
    Hinge,
    Slider,
    Distance,
    Rope,
}

/// One end of a joint: a body (and the local point it's held at), or the world.
#[derive(Clone, Debug, PartialEq)]
pub struct End {
    pub body: Option<String>,
    pub point: [f64; 3],
    pub axis: [f64; 3],
}

#[derive(Clone, Debug, PartialEq)]
pub struct Spring {
    pub hz: f64,
    pub damping_ratio: f64,
    pub rest: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Motor {
    pub velocity: bool,
    pub target: f64,
    pub max: Option<f64>,
    pub hz: f64,
    pub damping_ratio: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Joint {
    pub kind: JointKind,
    pub a: End,
    pub b: End,
    /// deg for a hinge, m otherwise, as written.
    pub limits: Option<[f64; 2]>,
    pub spring: Option<Spring>,
    pub motor: Option<Motor>,
    pub collide_connected: bool,
    pub active: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ForceKind {
    Uniform {
        accel: [f64; 3],
    },
    Drag {
        linear: f64,
        quadratic: f64,
        medium: [f64; 3],
    },
    SpringToPoint {
        point: [f64; 3],
        hz: f64,
        damping_ratio: f64,
        max_force: Option<f64>,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum Region {
    Box { center: [f64; 3], half: [f64; 3] },
    Sphere { center: [f64; 3], radius: f64 },
}

#[derive(Clone, Debug, PartialEq)]
pub struct Force {
    pub kind: ForceKind,
    pub region: Option<Region>,
    /// Body IDs, with each named collision group's members expanded.
    pub applies_to: Vec<String>,
    pub strength: f64,
}

/// A world as the backend builds it, in canonical (ID) order.
#[derive(Clone, Debug, PartialEq)]
pub struct World {
    pub dimensions: u8,
    pub step_rate: f64,
    pub substeps: u32,
    pub gravity: [f64; 3],
    pub mode: Mode,
    pub capacity: BTreeMap<String, u64>,
    pub solver: Solver,
    pub friction_rule: Rule,
    pub restitution_rule: Rule,
    pub defaults: Material,
    pub contact_materials: BTreeMap<String, Material>,
    /// Steps between deep checkpoints (Checkpoint ring: `every`).
    pub checkpoint_every: u64,
    /// ms: the 95th percentile of a step's time each host it ships to holds (World: `budget`).
    pub step_p95: f64,
    pub groups: Vec<String>,
    pub shapes: BTreeMap<String, Shape>,
    pub bodies: BTreeMap<String, Body>,
    pub joints: BTreeMap<String, Joint>,
    pub forces: BTreeMap<String, Force>,
    pub outputs: BTreeMap<String, Output>,
}

/// A physics output (Physics output: `from`, `read`): before #1918 only a body's position.
#[derive(Clone, Debug, PartialEq)]
pub struct Output {
    /// The body it reads.
    pub from: String,
}

/// A physics output's fields; all but `from` and `read` wait for #1918.
const OUTPUT_KEYS: &[&str] = &[
    "from",
    "read",
    "to",
    "interpolate",
    "reduce",
    "average",
    "sample",
    "keep",
    "expr",
    "unit",
];

/// The world document's own fields; `kind` names it.
const WORLD_KEYS: &[&str] = &[
    "kind",
    "dimensions",
    "step_rate",
    "substeps",
    "span",
    "gravity",
    "seed",
    "mode",
    "capacity",
    "solver",
    "combine",
    "defaults",
    "contact_materials",
    "collision_groups",
    "checkpoint",
    "budget",
    "backend",
    "shapes",
    "bodies",
    "joints",
    "forces",
    "inputs",
    "outputs",
];
/// Fields this backend interface doesn't run yet, each with the issue that brings it.
const LATER: &[(&str, &str)] = &[("inputs", "#522")];
const RULES: &[(&str, Rule)] = &[
    ("geometric", Rule::Geometric),
    ("average", Rule::Average),
    ("min", Rule::Min),
    ("max", Rule::Max),
    ("multiply", Rule::Multiply),
];

/// Reads `doc`, a world document, or returns every refusal it raised, each at its path.
pub fn read(doc: &Value) -> Result<World, Vec<Refusal>> {
    let mut r = Reader::default();
    let w = r.world(doc);
    if r.out.is_empty() {
        Ok(w)
    } else {
        Err(r.out)
    }
}

#[derive(Default)]
struct Reader {
    out: Vec<Refusal>,
}

fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_string()
    } else {
        format!("{path}/{key}")
    }
}

impl Reader {
    fn refuse(&mut self, code: &'static str, path: String, actual: &Value, what: String) {
        self.out.push(Refusal {
            code,
            path,
            actual: actual.clone(),
            what,
        });
    }

    /// `v` as an object whose keys are all in `keys`, each other key refused; empty when absent.
    fn obj(&mut self, v: &Value, path: &str, keys: &[&str]) -> Map<String, Value> {
        let Some(m) = v.as_object() else {
            if !v.is_null() {
                self.refuse(
                    "out_of_range",
                    path.into(),
                    v,
                    format!("{} must be an object", show(path)),
                );
            }
            return Map::new();
        };
        for k in m.keys() {
            if !keys.contains(&k.as_str()) {
                self.refuse(
                    "unknown_field",
                    join(path, k),
                    &m[k],
                    format!(
                        "{} is not a field here; the fields are {}",
                        show(&join(path, k)),
                        keys.join(", ")
                    ),
                );
            }
        }
        m.clone()
    }

    fn num(
        &mut self,
        m: &Map<String, Value>,
        key: &str,
        path: &str,
        default: f64,
        min: f64,
        max: f64,
    ) -> f64 {
        let Some(v) = m.get(key) else { return default };
        match v.as_f64() {
            Some(x) if x >= min && x <= max => x,
            _ => {
                self.refuse(
                    "out_of_range",
                    join(path, key),
                    v,
                    format!(
                        "{} must be a number from {min} to {max}",
                        show(&join(path, key))
                    ),
                );
                default
            }
        }
    }

    fn opt_num(&mut self, m: &Map<String, Value>, key: &str, path: &str, min: f64) -> Option<f64> {
        m.get(key)?;
        Some(self.num(m, key, path, min, min, f64::MAX))
    }

    fn flag(&mut self, m: &Map<String, Value>, key: &str, path: &str, default: bool) -> bool {
        match m.get(key) {
            None => default,
            Some(Value::Bool(b)) => *b,
            Some(v) => {
                self.refuse(
                    "out_of_range",
                    join(path, key),
                    v,
                    format!("{} must be true or false", show(&join(path, key))),
                );
                default
            }
        }
    }

    fn vec3(
        &mut self,
        m: &Map<String, Value>,
        key: &str,
        path: &str,
        default: [f64; 3],
    ) -> [f64; 3] {
        let Some(v) = m.get(key) else { return default };
        match v
            .as_array()
            .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
        {
            Some(Some(a)) if a.len() == 3 => [a[0], a[1], a[2]],
            _ => {
                self.refuse(
                    "out_of_range",
                    join(path, key),
                    v,
                    format!("{} must be three numbers", show(&join(path, key))),
                );
                default
            }
        }
    }

    fn bools3(&mut self, m: &Map<String, Value>, key: &str, path: &str) -> [bool; 3] {
        let Some(v) = m.get(key) else {
            return [false; 3];
        };
        match v
            .as_array()
            .map(|a| a.iter().map(Value::as_bool).collect::<Option<Vec<_>>>())
        {
            Some(Some(a)) if a.len() == 3 => [a[0], a[1], a[2]],
            _ => {
                self.refuse(
                    "out_of_range",
                    join(path, key),
                    v,
                    format!("{} must be three booleans", show(&join(path, key))),
                );
                [false; 3]
            }
        }
    }

    fn word<'v>(
        &mut self,
        m: &'v Map<String, Value>,
        key: &str,
        path: &str,
        default: &'v str,
        set: &[&str],
    ) -> &'v str {
        let Some(v) = m.get(key) else { return default };
        match v.as_str() {
            Some(s) if set.contains(&s) => s,
            _ => {
                self.refuse(
                    "out_of_range",
                    join(path, key),
                    v,
                    format!(
                        "{} must be one of {}",
                        show(&join(path, key)),
                        set.join(", ")
                    ),
                );
                default
            }
        }
    }

    fn rule(&mut self, m: &Map<String, Value>, key: &str, path: &str, default: Rule) -> Rule {
        let names: Vec<&str> = RULES.iter().map(|(n, _)| *n).collect();
        let d = RULES
            .iter()
            .find(|(_, r)| *r == default)
            .map(|(n, _)| *n)
            .unwrap_or("max");
        let w = self.word(m, key, path, d, &names);
        RULES
            .iter()
            .find(|(n, _)| *n == w)
            .map(|(_, r)| *r)
            .unwrap_or(default)
    }

    fn world(&mut self, doc: &Value) -> World {
        let m = &self.obj(doc, "", WORLD_KEYS);
        if let Some(k) = m.get("kind") {
            if k != "physics.world@1" {
                self.refuse(
                    "out_of_range",
                    "kind".into(),
                    k,
                    "kind must be physics.world@1".into(),
                );
            }
        }
        for (key, issue) in LATER {
            if m.get(*key)
                .is_some_and(|v| v.as_object().is_none_or(|o| !o.is_empty()))
            {
                self.refuse(
                    "physics.unsupported",
                    (*key).into(),
                    &m[*key],
                    format!("{key} isn't run by this backend interface yet; {issue} brings it"),
                );
            }
        }
        let dimensions = self.num(m, "dimensions", "", 3.0, 2.0, 3.0) as u8;
        if dimensions != 2 && dimensions != 3 {
            self.refuse(
                "out_of_range",
                "dimensions".into(),
                &m["dimensions"],
                "dimensions must be 2 or 3".into(),
            );
        }
        let step_rate = self.num(m, "step_rate", "", 120.0, f64::MIN_POSITIVE, 1e6);
        if let Err(e) = deep_canvas::time::step_length(step_rate) {
            self.refuse(
                "bad_rate",
                "step_rate".into(),
                m.get("step_rate").unwrap_or(&Value::Null),
                e,
            );
        }
        let substeps = self.num(m, "substeps", "", 4.0, 1.0, 16.0);
        if substeps.fract() != 0.0 || [9.0, 11.0, 13.0].contains(&substeps) {
            self.refuse(
                "out_of_range",
                "substeps".into(),
                &m["substeps"],
                "substeps must be 1 to 8, 10, 12, 14, 15 or 16".into(),
            );
        }
        let gravity = self.vec3(m, "gravity", "", [0.0, -9.81, 0.0]);
        let mode = match self.word(m, "mode", "", "dynamic", &["dynamic", "kinematic"]) {
            "kinematic" => Mode::Kinematic,
            _ => Mode::Dynamic,
        };
        let capacity = self.capacity(m);
        let solver = self.solver(m.get("solver").unwrap_or(&Value::Null));
        let combine = &self.obj(
            m.get("combine").unwrap_or(&Value::Null),
            "combine",
            &["friction", "restitution"],
        );
        let friction_rule = self.rule(combine, "friction", "combine", Rule::Geometric);
        let restitution_rule = self.rule(combine, "restitution", "combine", Rule::Max);
        let d = &self.obj(
            m.get("defaults").unwrap_or(&Value::Null),
            "defaults",
            &["friction", "restitution", "damping"],
        );
        let defaults = Material {
            friction: self.num(d, "friction", "defaults", 0.5, 0.0, f64::MAX),
            restitution: self.num(d, "restitution", "defaults", 0.0, 0.0, f64::MAX),
            density: None,
            rolling_resistance: 0.0,
            tangent_speed: 0.0,
        };
        let default_damping = self.num(d, "damping", "defaults", 0.0, 0.0, f64::MAX);
        let mut materials = BTreeMap::new();
        for (id, v) in self.map(m, "contact_materials") {
            let p = format!("contact_materials/{id}");
            let c = &self.obj(
                v,
                &p,
                &[
                    "friction",
                    "restitution",
                    "density",
                    "rolling_resistance",
                    "tangent_speed",
                    "tag",
                ],
            );
            materials.insert(
                id.clone(),
                Material {
                    friction: self.num(c, "friction", &p, defaults.friction, 0.0, f64::MAX),
                    restitution: self.num(
                        c,
                        "restitution",
                        &p,
                        defaults.restitution,
                        0.0,
                        f64::MAX,
                    ),
                    density: self.opt_num(c, "density", &p, 0.0),
                    rolling_resistance: self.num(c, "rolling_resistance", &p, 0.0, 0.0, f64::MAX),
                    tangent_speed: self.num(c, "tangent_speed", &p, 0.0, f64::MIN, f64::MAX),
                },
            );
        }
        let cp = &self.obj(
            m.get("checkpoint").unwrap_or(&Value::Null),
            "checkpoint",
            &["every", "budget"],
        );
        let checkpoint_every =
            self.num(cp, "every", "checkpoint", 60.0, 1.0, f64::from(u32::MAX)) as u64;
        let budget = &self.obj(
            m.get("budget").unwrap_or(&Value::Null),
            "budget",
            &["step_p95", "memory", "bake_10s"],
        );
        let step_p95 = self.num(
            budget,
            "step_p95",
            "budget",
            2.0,
            f64::MIN_POSITIVE,
            f64::MAX,
        );
        let groups = self.groups(m);
        let mut shapes = BTreeMap::new();
        for (id, v) in self.map(m, "shapes") {
            if let Some(s) = self.shape(v, &format!("shapes/{id}")) {
                shapes.insert(id.clone(), s);
            }
        }
        self.children(&shapes);
        let mut bodies = BTreeMap::new();
        for (id, v) in self.map(m, "bodies") {
            let b = self.body(
                v,
                &format!("bodies/{id}"),
                default_damping,
                &shapes,
                &materials,
                &groups,
            );
            bodies.insert(id.clone(), b);
        }
        let mut joints = BTreeMap::new();
        for (id, v) in self.map(m, "joints") {
            if let Some(j) = self.joint(v, &format!("joints/{id}"), &bodies, &joints) {
                joints.insert(id.clone(), j);
            }
        }
        let mut forces = BTreeMap::new();
        for (id, v) in self.map(m, "forces") {
            if let Some(f) = self.force(v, &format!("forces/{id}"), &bodies, &groups) {
                forces.insert(id.clone(), f);
            }
        }
        let mut outputs = BTreeMap::new();
        for (id, v) in self.map(m, "outputs") {
            if let Some(o) = self.output(v, &format!("outputs/{id}"), &bodies) {
                outputs.insert(id.clone(), o);
            }
        }
        World {
            dimensions,
            step_rate,
            substeps: substeps as u32,
            gravity,
            mode,
            capacity,
            solver,
            friction_rule,
            restitution_rule,
            defaults,
            contact_materials: materials,
            checkpoint_every,
            step_p95,
            groups,
            shapes,
            bodies,
            joints,
            forces,
            outputs,
        }
    }

    /// An output reading a body's position; its other fields and reads are refused, naming #1918.
    fn output(&mut self, v: &Value, p: &str, bodies: &BTreeMap<String, Body>) -> Option<Output> {
        let o = &self.obj(v, p, OUTPUT_KEYS);
        for (k, x) in o.iter().filter(|(k, _)| *k != "from" && *k != "read") {
            self.refuse(
                "physics.unsupported",
                join(p, k),
                x,
                format!("an output's {k} isn't run by this backend interface yet; #1918 brings it"),
            );
        }
        match o.get("read") {
            Some(Value::String(r)) if r == "position" => {}
            None => self.refuse(
                "physics.missing_field",
                join(p, "read"),
                &Value::Null,
                format!("{p} needs a read"),
            ),
            Some(r) => self.refuse(
                "physics.unsupported",
                join(p, "read"),
                r,
                "an output reads only a body's position before #1918 brings the other reads".into(),
            ),
        }
        let from = o.get("from").unwrap_or(&Value::Null);
        match from.as_str() {
            Some(id) if bodies.contains_key(id) => Some(Output { from: id.into() }),
            _ => {
                self.refuse(
                    "ref_unresolved",
                    join(p, "from"),
                    from,
                    format!("{from} is not a body of this world"),
                );
                None
            }
        }
    }

    /// The `{ID → value}` map at `key`, refused unless an object.
    fn map<'v>(&mut self, m: &'v Map<String, Value>, key: &str) -> Vec<(&'v String, &'v Value)> {
        let Some(v) = m.get(key) else {
            return Vec::new();
        };
        match v.as_object() {
            Some(o) => o.iter().collect(),
            None => {
                self.refuse(
                    "out_of_range",
                    key.into(),
                    v,
                    format!("{key} must be an object of ID → entry"),
                );
                Vec::new()
            }
        }
    }

    fn capacity(&mut self, m: &Map<String, Value>) -> BTreeMap<String, u64> {
        const KEYS: [&str; 5] = ["bodies", "shapes", "joints", "contacts", "particles"];
        let Some(v) = m.get("capacity") else {
            self.refuse(
                "physics.missing_field",
                "capacity".into(),
                &Value::Null,
                "capacity is required: {bodies, shapes, joints, contacts, particles}".into(),
            );
            return BTreeMap::new();
        };
        let c = &self.obj(v, "capacity", &KEYS);
        let mut out = BTreeMap::new();
        for k in KEYS {
            match c.get(k).and_then(Value::as_u64) {
                Some(n) if n <= u32::MAX as u64 => {
                    out.insert(k.to_string(), n);
                }
                _ => self.refuse(
                    "out_of_range",
                    format!("capacity/{k}"),
                    c.get(k).unwrap_or(&Value::Null),
                    format!("capacity/{k} must be a whole number up to {}", u32::MAX),
                ),
            }
        }
        out
    }

    fn solver(&mut self, v: &Value) -> Solver {
        let p = "solver";
        let s = &self.obj(
            v,
            p,
            &[
                "contact_hz",
                "contact_damping",
                "max_speed",
                "restitution_threshold",
                "hit_threshold",
                "sleep",
                "ccd",
            ],
        );
        let sl = &self.obj(
            s.get("sleep").unwrap_or(&Value::Null),
            "solver/sleep",
            &["on", "speed", "time"],
        );
        Solver {
            contact_hz: self.num(s, "contact_hz", p, 30.0, f64::MIN_POSITIVE, f64::MAX),
            contact_damping: self.num(s, "contact_damping", p, 10.0, 0.0, f64::MAX),
            max_speed: self.num(s, "max_speed", p, 400.0, f64::MIN_POSITIVE, f64::MAX),
            restitution_threshold: self.num(s, "restitution_threshold", p, 0.0, 0.0, f64::MAX),
            hit_threshold: self.num(s, "hit_threshold", p, 1.0, 0.0, f64::MAX),
            sleep: Sleep {
                on: self.flag(sl, "on", "solver/sleep", true),
                speed: self.num(sl, "speed", "solver/sleep", 0.05, 0.0, f64::MAX),
                time: self.num(sl, "time", "solver/sleep", 0.5, 0.0, f64::MAX),
            },
            ccd: self.flag(s, "ccd", p, true),
        }
    }

    fn groups(&mut self, m: &Map<String, Value>) -> Vec<String> {
        let Some(v) = m.get("collision_groups") else {
            return Vec::new();
        };
        match v.as_array().map(|a| {
            a.iter()
                .map(|g| g.as_str().map(String::from))
                .collect::<Option<Vec<_>>>()
        }) {
            Some(Some(g)) if g.len() <= 32 => g,
            _ => {
                self.refuse(
                    "out_of_range",
                    "collision_groups".into(),
                    v,
                    "collision_groups must be at most 32 names".into(),
                );
                Vec::new()
            }
        }
    }

    /// A shape use's `member`: all groups when absent; an empty list, a member of no group, is
    /// refused, naming the shape use (Collision group; #2011).
    fn member(&mut self, m: &Map<String, Value>, path: &str, groups: &[String]) -> u32 {
        if m.get("member")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            self.refuse(
                "physics.no_group",
                join(path, "member"),
                &m["member"],
                format!("shape {path} is a member of no collision group; name at least one, or give it a role"),
            );
        }
        self.mask(m, "member", path, groups)
    }

    /// The bit mask of the group names at `key`; all bits when absent.
    fn mask(&mut self, m: &Map<String, Value>, key: &str, path: &str, groups: &[String]) -> u32 {
        let Some(v) = m.get(key) else { return u32::MAX };
        let mut bits = 0u32;
        let Some(names) = v.as_array() else {
            self.refuse(
                "out_of_range",
                join(path, key),
                v,
                format!(
                    "{} must be a list of collision group names",
                    show(&join(path, key))
                ),
            );
            return u32::MAX;
        };
        for (i, n) in names.iter().enumerate() {
            match n.as_str().and_then(|s| groups.iter().position(|g| g == s)) {
                Some(b) => bits |= 1 << b,
                None => self.refuse(
                    "ref_unresolved",
                    format!("{}/{i}", join(path, key)),
                    n,
                    format!("{n} is not one of the world's collision_groups"),
                ),
            }
        }
        bits
    }

    fn shape(&mut self, v: &Value, p: &str) -> Option<Shape> {
        let s = &self.obj(
            v,
            p,
            &[
                "kind",
                "radius",
                "half",
                "half_height",
                "normal",
                "points",
                "vertices",
                "triangles",
                "children",
            ],
        );
        let kind = s.get("kind").and_then(Value::as_str).unwrap_or("");
        let pos = f64::MIN_POSITIVE;
        Some(match kind {
            "sphere" => Shape::Sphere {
                radius: self.num(s, "radius", p, 0.5, pos, f64::MAX),
            },
            "box" => Shape::Box {
                half: self.vec3(s, "half", p, [0.5; 3]),
            },
            "capsule" => Shape::Capsule {
                half_height: self.num(s, "half_height", p, 0.5, pos, f64::MAX),
                radius: self.num(s, "radius", p, 0.5, pos, f64::MAX),
            },
            "cylinder" => Shape::Cylinder {
                half_height: self.num(s, "half_height", p, 0.5, pos, f64::MAX),
                radius: self.num(s, "radius", p, 0.5, pos, f64::MAX),
            },
            "plane" => Shape::Plane {
                normal: self.vec3(s, "normal", p, [0.0, 1.0, 0.0]),
            },
            "convex" => {
                let points = self.points(s, "points", p)?;
                if points.len() < 4 || points.len() > 64 {
                    self.refuse(
                        "out_of_range",
                        join(p, "points"),
                        &s["points"],
                        format!("a convex shape takes 4 to 64 points, not {}", points.len()),
                    );
                    return None;
                }
                Shape::Convex {
                    points,
                    radius: self.num(s, "radius", p, 0.0, 0.0, f64::MAX),
                }
            }
            "mesh" => {
                let vertices = self.points(s, "vertices", p)?;
                let tp = join(p, "triangles");
                let triangles = s
                    .get("triangles")
                    .and_then(Value::as_array)
                    .and_then(|a| {
                        a.iter()
                            .map(|t| {
                                let t = t.as_array().filter(|t| t.len() == 3)?;
                                let i = |k: usize| {
                                    t[k].as_u64()
                                        .filter(|&i| (i as usize) < vertices.len())
                                        .map(|i| i as u32)
                                };
                                Some([i(0)?, i(1)?, i(2)?])
                            })
                            .collect::<Option<Vec<_>>>()
                    })
                    .filter(|t| !t.is_empty());
                let Some(triangles) = triangles else {
                    self.refuse(
                        "out_of_range",
                        tp,
                        s.get("triangles").unwrap_or(&Value::Null),
                        "a mesh's triangles must be a list of three indices into its vertices"
                            .into(),
                    );
                    return None;
                };
                Shape::Mesh {
                    vertices,
                    triangles,
                }
            }
            "compound" => {
                let cp = join(p, "children");
                let Some(list) = s
                    .get("children")
                    .and_then(Value::as_array)
                    .filter(|a| !a.is_empty())
                else {
                    self.refuse(
                        "out_of_range",
                        cp,
                        s.get("children").unwrap_or(&Value::Null),
                        "a compound's children must be a list of {shape, pose}".into(),
                    );
                    return None;
                };
                let mut children = Vec::new();
                for (i, c) in list.iter().enumerate() {
                    let at = format!("{cp}/{i}");
                    let m = &self.obj(c, &at, &["shape", "pose"]);
                    let id = m.get("shape").and_then(Value::as_str).unwrap_or("");
                    children.push((id.to_string(), self.pose(m.get("pose"), &at)));
                }
                Shape::Compound { children }
            }
            "heightfield" => {
                self.refuse(
                    "physics.unsupported",
                    join(p, "kind"),
                    &s["kind"],
                    "a heightfield shape isn't built by this backend interface yet; #927 brings it"
                        .into(),
                );
                return None;
            }
            _ => {
                self.refuse(
                    "out_of_range",
                    join(p, "kind"),
                    s.get("kind").unwrap_or(&Value::Null),
                    "a shape's kind must be sphere, box, capsule, cylinder, plane, convex, mesh or compound".into(),
                );
                return None;
            }
        })
    }

    /// A list of points `[x, y, z]` at `key`, or its refusal.
    fn points(&mut self, m: &Map<String, Value>, key: &str, p: &str) -> Option<Vec<[f64; 3]>> {
        let got = m.get(key).and_then(Value::as_array).and_then(|a| {
            a.iter()
                .map(|x| {
                    let x = x.as_array().filter(|x| x.len() == 3)?;
                    Some([x[0].as_f64()?, x[1].as_f64()?, x[2].as_f64()?])
                })
                .collect::<Option<Vec<_>>>()
        });
        if got.is_none() {
            self.refuse(
                "out_of_range",
                join(p, key),
                m.get(key).unwrap_or(&Value::Null),
                format!("{} must be a list of points [x, y, z]", show(&join(p, key))),
            );
        }
        got
    }

    /// A compound's children name shapes of the world that a compound can hold: no mesh, plane or
    /// other compound.
    fn children(&mut self, shapes: &BTreeMap<String, Shape>) {
        for (id, s) in shapes {
            let Shape::Compound { children } = s else {
                continue;
            };
            for (i, (child, _)) in children.iter().enumerate() {
                let at = format!("shapes/{id}/children/{i}/shape");
                match shapes.get(child) {
                    None => self.refuse(
                        "ref_unresolved",
                        at,
                        &Value::from(child.as_str()),
                        format!("{child:?} is not a shape of this world"),
                    ),
                    Some(Shape::Mesh { .. } | Shape::Plane { .. } | Shape::Compound { .. }) => {
                        self.refuse(
                            "out_of_range",
                            at,
                            &Value::from(child.as_str()),
                            format!("{child} is a mesh, a plane or a compound, which a compound can't hold"),
                        )
                    }
                    Some(_) => {}
                }
            }
        }
    }

    fn pose(&mut self, v: Option<&Value>, p: &str) -> Pose {
        let m = &self.obj(v.unwrap_or(&Value::Null), p, &["pos", "rot"]);
        let pos = self.vec3(m, "pos", p, [0.0; 3]);
        let rot = match m
            .get("rot")
            .and_then(Value::as_array)
            .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
        {
            None if m.get("rot").is_none() => Rot::Quat([0.0, 0.0, 0.0, 1.0]),
            Some(Some(a)) if a.len() == 4 => Rot::Quat([a[0], a[1], a[2], a[3]]),
            Some(Some(a)) if a.len() == 3 => Rot::Deg([a[0], a[1], a[2]]),
            _ => {
                self.refuse(
                    "out_of_range",
                    join(p, "rot"),
                    &m["rot"],
                    "rot must be a quaternion [x, y, z, w] or degrees [x, y, z]".into(),
                );
                Rot::Quat([0.0, 0.0, 0.0, 1.0])
            }
        };
        Pose { pos, rot }
    }

    fn body(
        &mut self,
        v: &Value,
        p: &str,
        damping: f64,
        shapes: &BTreeMap<String, Shape>,
        materials: &BTreeMap<String, Material>,
        groups: &[String],
    ) -> Body {
        let b = &self.obj(
            v,
            p,
            &[
                "kind",
                "shapes",
                "pose",
                "velocity",
                "mass",
                "inertia",
                "damping",
                "gravity_scale",
                "ccd",
                "sleep",
                "locks",
                "follow",
                "active",
                "anchors",
                "priority",
            ],
        );
        let kind = match b.get("kind").and_then(Value::as_str) {
            Some("static") => BodyKind::Static,
            Some("dynamic") => BodyKind::Dynamic,
            Some(k @ ("kinematic" | "character" | "vehicle")) => {
                let issue = match k {
                    "kinematic" => "#522",
                    "character" => "#182",
                    _ => "#251",
                };
                self.refuse(
                    "physics.unsupported",
                    join(p, "kind"),
                    &b["kind"],
                    format!(
                        "a {k} body isn't run by this backend interface yet; {issue} brings it"
                    ),
                );
                BodyKind::Static
            }
            _ => {
                self.refuse(
                    "out_of_range",
                    join(p, "kind"),
                    b.get("kind").unwrap_or(&Value::Null),
                    "a body's kind must be static, kinematic, dynamic, character or vehicle".into(),
                );
                BodyKind::Static
            }
        };
        for (key, issue) in [("follow", "#522"), ("inertia", "#2098")] {
            if let Some(x) = b.get(key) {
                self.refuse(
                    "physics.unsupported",
                    join(p, key),
                    x,
                    format!("{key} isn't run by this backend interface yet; {issue} brings it"),
                );
            }
        }
        let mut uses = Vec::new();
        for (i, u) in b
            .get("shapes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let up = format!("{p}/shapes/{i}");
            let m = &self.obj(
                u,
                &up,
                &[
                    "shape",
                    "offset",
                    "contact_material",
                    "member",
                    "collides",
                    "sensor",
                    "sensor_test",
                    "collision_group",
                ],
            );
            if let Some(x) = m.get("collision_group") {
                self.refuse(
                    "unknown_field",
                    join(&up, "collision_group"),
                    x,
                    "a shape use names its groups with member and collides (Collision group)"
                        .into(),
                );
            }
            let shape = m
                .get("shape")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !shapes.contains_key(&shape) {
                self.refuse(
                    "ref_unresolved",
                    join(&up, "shape"),
                    m.get("shape").unwrap_or(&Value::Null),
                    format!("{shape:?} is not a shape of this world"),
                );
            }
            let material = m
                .get("contact_material")
                .and_then(Value::as_str)
                .map(String::from);
            if let Some(id) = &material {
                if !materials.contains_key(id) {
                    self.refuse(
                        "ref_unresolved",
                        join(&up, "contact_material"),
                        &m["contact_material"],
                        format!("{id:?} is not a contact material of this world"),
                    );
                }
            }
            uses.push(ShapeUse {
                shape,
                offset: self.pose(m.get("offset"), &join(&up, "offset")),
                material,
                member: self.member(m, &up, groups),
                collides: self.mask(m, "collides", &up, groups),
                sensor: self.flag(m, "sensor", &up, false),
            });
        }
        let vel = &self.obj(
            b.get("velocity").unwrap_or(&Value::Null),
            &join(p, "velocity"),
            &["linear", "angular"],
        );
        let damp = &self.obj(
            b.get("damping").unwrap_or(&Value::Null),
            &join(p, "damping"),
            &["linear", "angular"],
        );
        let locks = &self.obj(
            b.get("locks").unwrap_or(&Value::Null),
            &join(p, "locks"),
            &["linear", "angular"],
        );
        let mut anchors = BTreeMap::new();
        for (name, a) in b
            .get("anchors")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let one = [(name.clone(), a.clone())]
                .into_iter()
                .collect::<Map<_, _>>();
            anchors.insert(
                name.clone(),
                self.vec3(&one, name, &join(p, "anchors"), [0.0; 3]),
            );
        }
        Body {
            kind,
            shapes: uses,
            pose: self.pose(b.get("pose"), &join(p, "pose")),
            linear: self.vec3(vel, "linear", &join(p, "velocity"), [0.0; 3]),
            angular: self.vec3(vel, "angular", &join(p, "velocity"), [0.0; 3]),
            mass: self.opt_num(b, "mass", p, f64::MIN_POSITIVE),
            linear_damping: self.num(damp, "linear", &join(p, "damping"), damping, 0.0, f64::MAX),
            angular_damping: self.num(damp, "angular", &join(p, "damping"), damping, 0.0, f64::MAX),
            gravity_scale: self.num(b, "gravity_scale", p, 1.0, f64::MIN, f64::MAX),
            ccd: self.flag(b, "ccd", p, false),
            sleep: self.flag(b, "sleep", p, true),
            lock_linear: self.bools3(locks, "linear", &join(p, "locks")),
            lock_angular: self.bools3(locks, "angular", &join(p, "locks")),
            active: self.flag(b, "active", p, true),
            anchors,
        }
    }

    /// One joint end: `body ID[#anchor] | world`, its frame's anchor otherwise.
    fn end(
        &mut self,
        j: &Map<String, Value>,
        key: &str,
        frame: &str,
        p: &str,
        bodies: &BTreeMap<String, Body>,
    ) -> End {
        let f = &self.obj(
            j.get(frame).unwrap_or(&Value::Null),
            &join(p, frame),
            &["anchor", "axis"],
        );
        let mut point = self.vec3(f, "anchor", &join(p, frame), [0.0; 3]);
        let axis = self.vec3(f, "axis", &join(p, frame), [1.0, 0.0, 0.0]);
        let name = j.get(key).and_then(Value::as_str).unwrap_or("");
        if name == "world" {
            return End {
                body: None,
                point,
                axis,
            };
        }
        let (id, anchor) = name
            .split_once('#')
            .map_or((name, None), |(a, b)| (a, Some(b)));
        match bodies.get(id) {
            None => self.refuse(
                "ref_unresolved",
                join(p, key),
                j.get(key).unwrap_or(&Value::Null),
                format!("{name:?} is not a body of this world, nor world"),
            ),
            Some(b) => {
                if let Some(a) = anchor {
                    match b.anchors.get(a) {
                        Some(pt) => point = *pt,
                        None => self.refuse(
                            "ref_unresolved",
                            join(p, key),
                            &j[key],
                            format!("{id} has no anchor {a:?}"),
                        ),
                    }
                }
            }
        }
        End {
            body: Some(id.to_string()),
            point,
            axis,
        }
    }

    fn joint(
        &mut self,
        v: &Value,
        p: &str,
        bodies: &BTreeMap<String, Body>,
        _joints: &BTreeMap<String, Joint>,
    ) -> Option<Joint> {
        let j = &self.obj(
            v,
            p,
            &[
                "kind",
                "a",
                "b",
                "frame_a",
                "frame_b",
                "limits",
                "spring",
                "motor",
                "breaks_at",
                "ratio",
                "of",
                "pulley",
                "path",
                "active",
                "collide_connected",
                "swing",
                "twist",
            ],
        );
        let kind = match j.get("kind").and_then(Value::as_str) {
            Some("fixed") => JointKind::Fixed,
            Some("ball") => JointKind::Ball,
            Some("hinge") => JointKind::Hinge,
            Some("slider") => JointKind::Slider,
            Some("distance") => JointKind::Distance,
            Some("rope") => JointKind::Rope,
            // Couplings: the check refuses them by caps() (crate::check); their run is #523's.
            Some("gear" | "rack" | "pulley" | "path") => return None,
            _ => {
                self.refuse("out_of_range", join(p, "kind"), j.get("kind").unwrap_or(&Value::Null), "a joint's kind must be fixed, ball, hinge, slider, distance, rope, gear, rack, pulley or path".into());
                return None;
            }
        };
        for (key, issue) in [("breaks_at", "#523"), ("swing", "#132"), ("twist", "#132")] {
            if let Some(x) = j.get(key) {
                self.refuse(
                    "physics.unsupported",
                    join(p, key),
                    x,
                    format!("{key} isn't run by this backend interface yet; {issue} brings it"),
                );
            }
        }
        let a = self.end(j, "a", "frame_a", p, bodies);
        let b = self.end(j, "b", "frame_b", p, bodies);
        let limits = j.get("limits").map(|l| {
            let m = &self.obj(l, &join(p, "limits"), &["min", "max"]);
            [
                self.num(m, "min", &join(p, "limits"), f64::MIN, f64::MIN, f64::MAX),
                self.num(m, "max", &join(p, "limits"), f64::MAX, f64::MIN, f64::MAX),
            ]
        });
        let spring = j.get("spring").map(|s| {
            let sp = join(p, "spring");
            let m = &self.obj(s, &sp, &["hz", "damping_ratio", "rest"]);
            Spring {
                hz: self.num(m, "hz", &sp, 1.0, f64::MIN_POSITIVE, f64::MAX),
                damping_ratio: self.num(m, "damping_ratio", &sp, 1.0, 0.0, f64::MAX),
                rest: self.opt_num(m, "rest", &sp, 0.0),
            }
        });
        let motor = j.get("motor").map(|s| {
            let mp = join(p, "motor");
            let m = &self.obj(s, &mp, &["mode", "target", "max_force", "max_torque", "hz", "damping_ratio"]);
            if let Some(t) = m.get("target").filter(|t| t.is_string()) {
                self.refuse("physics.unsupported", join(&mp, "target"), t, "a motor target read from a channel isn't run by this backend interface yet; #522 brings it".into());
            }
            Motor {
                velocity: self.word(m, "mode", &mp, "velocity", &["velocity", "position"]) == "velocity",
                target: m.get("target").and_then(Value::as_f64).unwrap_or(0.0),
                max: self.opt_num(m, "max_force", &mp, 0.0).or(self.opt_num(m, "max_torque", &mp, 0.0)),
                hz: self.num(m, "hz", &mp, 1.0, f64::MIN_POSITIVE, f64::MAX),
                damping_ratio: self.num(m, "damping_ratio", &mp, 1.0, 0.0, f64::MAX),
            }
        });
        Some(Joint {
            kind,
            a,
            b,
            limits,
            spring,
            motor,
            collide_connected: self.flag(j, "collide_connected", p, false),
            active: self.flag(j, "active", p, true),
        })
    }

    fn force(
        &mut self,
        v: &Value,
        p: &str,
        bodies: &BTreeMap<String, Body>,
        groups: &[String],
    ) -> Option<Force> {
        let f = &self.obj(v, p, &["kind", "region", "applies_to", "strength"]);
        let k = f.get("kind").unwrap_or(&Value::Null);
        // A kind is written `{name: {fields}}` or `{kind: name, ...fields}` as other kinds are.
        let (name, fields) = match k {
            Value::String(s) => (s.as_str(), &Value::Null),
            Value::Object(o) if o.len() == 1 => {
                let (n, f) = o.iter().next().expect("one");
                (n.as_str(), f)
            }
            _ => ("", &Value::Null),
        };
        let kp = join(p, "kind");
        let kind = match name {
            "uniform" => {
                let m = &self.obj(fields, &kp, &["accel"]);
                ForceKind::Uniform {
                    accel: self.vec3(m, "accel", &kp, [0.0; 3]),
                }
            }
            "drag" => {
                let m = &self.obj(fields, &kp, &["linear", "quadratic", "medium"]);
                if let Some(x) = m.get("medium").filter(|x| x.is_string()) {
                    self.refuse("physics.unsupported", join(&kp, "medium"), x, "a drag medium read from a channel isn't run by this backend interface yet; #522 brings it".into());
                }
                ForceKind::Drag {
                    linear: self.num(m, "linear", &kp, 0.0, 0.0, f64::MAX),
                    quadratic: self.num(m, "quadratic", &kp, 0.0, 0.0, f64::MAX),
                    medium: if m.get("medium").is_some_and(Value::is_array) {
                        self.vec3(m, "medium", &kp, [0.0; 3])
                    } else {
                        [0.0; 3]
                    },
                }
            }
            "spring_to_point" => {
                let m = &self.obj(fields, &kp, &["point", "hz", "damping_ratio", "max_force"]);
                if let Some(x) = m.get("point").filter(|x| x.is_string()) {
                    self.refuse("physics.unsupported", join(&kp, "point"), x, "a spring point read from a channel isn't run by this backend interface yet; #522 brings it".into());
                }
                ForceKind::SpringToPoint {
                    point: if m.get("point").is_some_and(Value::is_array) {
                        self.vec3(m, "point", &kp, [0.0; 3])
                    } else {
                        [0.0; 3]
                    },
                    hz: self.num(m, "hz", &kp, 1.0, f64::MIN_POSITIVE, f64::MAX),
                    damping_ratio: self.num(m, "damping_ratio", &kp, 1.0, 0.0, f64::MAX),
                    max_force: self.opt_num(m, "max_force", &kp, 0.0),
                }
            }
            "wind" | "buoyancy" | "inverse_square" | "magnetic" | "lennard_jones" => {
                let issue = match name {
                    "wind" => "#2098",
                    "buoyancy" => "#1786",
                    _ => "#1931",
                };
                self.refuse(
                    "physics.unsupported",
                    kp,
                    k,
                    format!(
                        "a {name} force isn't run by this backend interface yet; {issue} brings it"
                    ),
                );
                return None;
            }
            _ => {
                self.refuse("out_of_range", kp, k, "a force's kind must be uniform, drag, wind, spring_to_point, buoyancy, inverse_square, magnetic or lennard_jones".into());
                return None;
            }
        };
        let region = f.get("region").and_then(|r| {
            let rp = join(p, "region");
            let m = &self.obj(r, &rp, &["box", "sphere"]);
            if let Some(b) = m.get("box") {
                let bm = &self.obj(b, &join(&rp, "box"), &["center", "half"]);
                Some(Region::Box {
                    center: self.vec3(bm, "center", &join(&rp, "box"), [0.0; 3]),
                    half: self.vec3(bm, "half", &join(&rp, "box"), [0.5; 3]),
                })
            } else if let Some(s) = m.get("sphere") {
                let sm = &self.obj(s, &join(&rp, "sphere"), &["center", "radius"]);
                Some(Region::Sphere {
                    center: self.vec3(sm, "center", &join(&rp, "sphere"), [0.0; 3]),
                    radius: self.num(sm, "radius", &join(&rp, "sphere"), 0.5, 0.0, f64::MAX),
                })
            } else {
                None
            }
        });
        if f.get("strength").is_some_and(|s| !s.is_number()) {
            self.refuse("physics.unsupported", join(p, "strength"), &f["strength"], "a strength set by an input isn't run by this backend interface yet; #522 brings it".into());
        }
        let mut applies_to = Vec::new();
        for (i, t) in f
            .get("applies_to")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let name = t.as_str().unwrap_or("");
            if bodies.contains_key(name) {
                applies_to.push(name.to_string());
            } else if let Some(bit) = groups.iter().position(|g| g == name) {
                for (id, b) in bodies {
                    if b.shapes.iter().any(|u| u.member & (1 << bit) != 0)
                        && !applies_to.contains(id)
                    {
                        applies_to.push(id.clone());
                    }
                }
            } else {
                self.refuse(
                    "ref_unresolved",
                    format!("{p}/applies_to/{i}"),
                    t,
                    format!("{t} is neither a body nor a collision group of this world"),
                );
            }
        }
        applies_to.sort();
        Some(Force {
            kind,
            region,
            applies_to,
            strength: self.num(f, "strength", p, 1.0, f64::MIN, f64::MAX),
        })
    }
}

fn show(path: &str) -> String {
    if path.is_empty() {
        "the world".into()
    } else {
        path.to_string()
    }
}
