//! #1918's fields of the world document: a kinematic body's `follow` channel, a joint's
//! `breaks_at`, a contact material's `tag` and a physics output's reads and target (canvas
//! primitives: Body, Joint, Contact material, Physics output); and #2248's: what a series that
//! takes an output samples of it, a fold of particles, and an `expr` over named reads.

use std::collections::BTreeMap;

use deep_canvas::expr::Expr;
use serde_json::{Map, Value};

use super::{join, Body, BodyKind, Breaks, Joint, JointKind, Pose, Reader, Refusal, Shape, Soft};

/// What an output reads (Physics output: `read`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Read {
    Pose,
    Position,
    Angle,
    Velocity,
    JointCoordinate,
    JointForce,
    ContactCount,
    Energy,
    /// A soft body's particles (#524).
    ParticlePositions,
    /// #182: a character body's grounded, sliding and crouched, each 0 or 1.
    Grounded,
    Sliding,
    Crouched,
    /// #2248: a body's speed, m/s, and its mass, kg, each one number an `expr` reads.
    Speed,
    Mass,
    /// #2248: an output's `expr` over its named reads, in place of a read of its own.
    Expr,
}

/// Each read's name, and whether it reads a joint rather than a body.
pub const READS: [(&str, Read, bool); 14] = [
    ("pose", Read::Pose, false),
    ("position", Read::Position, false),
    ("angle", Read::Angle, false),
    ("velocity", Read::Velocity, false),
    ("joint_coordinate", Read::JointCoordinate, true),
    ("joint_force", Read::JointForce, true),
    ("contact_count", Read::ContactCount, false),
    ("energy", Read::Energy, false),
    ("particle_positions", Read::ParticlePositions, false),
    ("grounded", Read::Grounded, false),
    ("sliding", Read::Sliding, false),
    ("crouched", Read::Crouched, false),
    ("speed", Read::Speed, false),
    ("mass", Read::Mass, false),
];

impl Read {
    pub fn name(self) -> &'static str {
        READS.iter().find(|r| r.1 == self).map_or("", |r| r.0)
    }

    /// The read named `name`.
    pub fn named(name: &str) -> Option<Read> {
        READS.iter().find(|r| r.0 == name).map(|r| r.1)
    }

    /// Whether it reads a joint (`joint_coordinate`, `joint_force`) rather than a body.
    pub fn of_joint(self) -> bool {
        READS.iter().any(|r| r.1 == self && r.2)
    }

    /// #182: whether it reads a character body's own state.
    pub fn of_character(self) -> bool {
        matches!(self, Read::Grounded | Read::Sliding | Read::Crouched)
    }

    /// Where a position or a velocity read starts among a body's canonical values
    /// (`backend::FIELDS`); none for another read.
    pub fn vec3_at(self) -> Option<usize> {
        match self {
            Read::Position => Some(0),
            Read::Velocity => Some(7),
            _ => None,
        }
    }
}

/// A physics output (Physics output): what it reads of a body or joint, and the item path or
/// readout it writes, sampled at the document's frame rate.
#[derive(Clone, Debug, PartialEq)]
pub struct Output {
    /// The body or joint it reads.
    pub from: String,
    pub read: Read,
    /// `items/<id>/<field…>` or a readout's ID; `None` when only a reader of its form reads it.
    pub to: Option<String>,
    /// `interpolate: hold`: a frame between two steps shows the earlier; else it lerps.
    pub hold: bool,
    /// `to: skin {item, material}` (#524): the soft body drawn on an item built on its lattice.
    pub skin: Option<Skin>,
    /// #523: the levels whose crossings its reading writes (`crossing {t, output, level,
    /// direction}`); a joint's reading only.
    pub crossings: Vec<f64>,
    /// #2248: the rows a series that takes it reads, when it writes `sample`, `average` or `keep`.
    pub sampled: Option<Sampled>,
    /// How the particles its `from` names fold into one value.
    pub reduce: Option<Reduce>,
    /// Its `expr` over its named reads; its `read` is then [`Read::Expr`] and its `from` empty.
    pub expr: Option<Formula>,
    pub unit: Option<String>,
}

/// #2248: the rows a series that takes an output reads (Physics output: `sample`, `average`,
/// `keep`): one every `every` steps, each the mean of the read over the `average` steps that end
/// at it, and only those of the last `keep` flicks (none: the world's span).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sampled {
    pub every: u64,
    pub average: u64,
    pub keep: Option<i64>,
}

/// #2248: how a read of several particles folds into one value (Physics output: `reduce`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reduce {
    Sum,
    Mean,
    Max,
}

/// #2248: an output's `expr` (Physics output) and the reads it names, each the body or joint it
/// reads and what, in the order the expression first names them.
#[derive(Clone, Debug, PartialEq)]
pub struct Formula {
    pub expr: Expr,
    pub reads: Vec<(String, Read)>,
}

impl Output {
    /// #2248: whether its value after a step is one number or one vector the bake takes each
    /// step (reading.rs): an `expr`, a fold of particles, a read with no series of its own before
    /// #2248, or any read a series samples.
    pub fn valued(&self) -> bool {
        self.sampled.is_some()
            || self.reduce.is_some()
            || matches!(
                self.read,
                Read::Expr | Read::Speed | Read::Mass | Read::Angle | Read::Energy
            )
            || (self.read == Read::ContactCount && !self.from.contains('#'))
    }
}

/// A skin (Physics output: a skin): the item a soft body's particles draw as the vertices of, or
/// `None` for the one the core builds (`item: auto`), in `material` or the look's default.
#[derive(Clone, Debug, PartialEq)]
pub struct Skin {
    pub item: Option<String>,
    pub material: Option<String>,
}

/// A kinematic solve (Kinematic solve): in kinematic mode, each step sets each driven joint's
/// coordinate (a hinge's in deg, a slider's in m) to its path's value at the step's time.
#[derive(Clone, Debug, PartialEq)]
pub struct Solve {
    /// (joint, the path it reads), in the order the solve places them.
    pub drivers: Vec<(String, String)>,
    pub iterations: u32,
    pub tolerance: f64,
}

/// #523: what couples a gear's or a pulley's joint (Joint: `ratio`, `of`, `pulley`), which the
/// kinematic solve runs: a gear's second hinge's coordinate is `ratio` × its first's; a pulley's
/// two lengths, each from its ground point to its body's anchor, keep `a + ratio × b` at their sum
/// at build, its first within `length_min` and `length_max`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Coupling {
    /// 1 when absent.
    pub ratio: f64,
    /// A gear's two hinges, the driving one first.
    pub of: Vec<String>,
    pub pulley: Option<Pulley>,
}

/// A pulley's ground points and the range its first length keeps (Joint: `pulley`).
#[derive(Clone, Debug, PartialEq)]
pub struct Pulley {
    pub ground_a: [f64; 3],
    pub ground_b: [f64; 3],
    pub length_min: Option<f64>,
    pub length_max: Option<f64>,
}

/// A physics output's fields.
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
    "reads",
    "unit",
    "crossings",
];

/// Whether `id` is what `read` reads in this world: a joint, a character body or a body.
fn subject(
    read: Read,
    id: &str,
    bodies: &BTreeMap<String, Body>,
    joints: &BTreeMap<String, Joint>,
) -> bool {
    if read.of_joint() {
        joints.contains_key(id)
    } else if read.of_character() {
        bodies
            .get(id)
            .is_some_and(|b| b.kind == BodyKind::Character)
    } else {
        bodies.contains_key(id)
    }
}

/// What `read` reads, for a refusal.
fn subject_name(read: Read) -> &'static str {
    if read.of_joint() {
        "joint"
    } else if read.of_character() {
        "character body"
    } else {
        "body"
    }
}

impl Reader {
    /// The string at `key`, refused unless one; `None` when absent.
    pub(super) fn text(&mut self, m: &Map<String, Value>, key: &str, path: &str) -> Option<String> {
        let v = m.get(key)?;
        match v.as_str() {
            Some(s) if !s.is_empty() => Some(s.to_string()),
            _ => {
                let p = join(path, key);
                self.refuse(
                    "out_of_range",
                    p.clone(),
                    v,
                    format!("{p} must be a non-empty string"),
                );
                None
            }
        }
    }

    /// A body's `follow`: the channel path a kinematic body moves to, which no other kind takes.
    pub(super) fn follow(
        &mut self,
        b: &Map<String, Value>,
        p: &str,
        kind: BodyKind,
    ) -> Option<String> {
        let follow = self.text(b, "follow", p);
        if follow.is_some() && kind != BodyKind::Kinematic {
            self.refuse(
                "out_of_range",
                join(p, "follow"),
                &b["follow"],
                "only a kinematic body follows a channel".into(),
            );
        }
        follow
    }

    /// #523: a joint's `ratio`, `of` and `pulley`; a gear needs its two hinges and a pulley its
    /// ground points.
    pub(super) fn coupling(
        &mut self,
        j: &Map<String, Value>,
        p: &str,
        kind: JointKind,
    ) -> Coupling {
        let of = match j.get("of") {
            None => Vec::new(),
            Some(v) => {
                let ids = v.as_array().and_then(|a| {
                    a.iter()
                        .map(|x| x.as_str().map(String::from))
                        .collect::<Option<Vec<_>>>()
                });
                ids.unwrap_or_else(|| {
                    let what = format!("{p}/of must be a list of joint IDs");
                    self.refuse("out_of_range", join(p, "of"), v, what);
                    Vec::new()
                })
            }
        };
        if kind == JointKind::Gear && of.len() != 2 {
            let at = j.get("of").unwrap_or(&Value::Null);
            let what = format!("gear {p} needs of: its two hinges");
            self.refuse("physics.missing_field", join(p, "of"), at, what);
        }
        let pulley = j.get("pulley").map(|v| {
            let pp = join(p, "pulley");
            let keys = ["ground_a", "ground_b", "length_min", "length_max"];
            let m = &self.obj(v, &pp, &keys);
            Pulley {
                ground_a: self.vec3(m, "ground_a", &pp, [0.0; 3]),
                ground_b: self.vec3(m, "ground_b", &pp, [0.0; 3]),
                length_min: self.opt_num(m, "length_min", &pp, 0.0),
                length_max: self.opt_num(m, "length_max", &pp, 0.0),
            }
        });
        if kind == JointKind::Pulley && pulley.is_none() {
            let what = format!("pulley {p} needs pulley: its ground points");
            self.refuse(
                "physics.missing_field",
                join(p, "pulley"),
                &Value::Null,
                what,
            );
        }
        Coupling {
            ratio: self.num(j, "ratio", p, 1.0, f64::MIN, f64::MAX),
            of,
            pulley,
        }
    }

    /// #523: each gear's `of` names two hinges of this world.
    pub(super) fn gears(&mut self, joints: &BTreeMap<String, Joint>) {
        for (id, j) in joints.iter().filter(|(_, j)| j.kind == JointKind::Gear) {
            for (i, h) in j.coupling.of.iter().enumerate() {
                if joints.get(h).map(|x| x.kind) != Some(JointKind::Hinge) {
                    let what = format!("{h} is not a hinge of this world, which gear {id} joins");
                    let at = Value::String(h.clone());
                    self.refuse("ref_unresolved", format!("joints/{id}/of/{i}"), &at, what);
                }
            }
        }
    }

    /// A joint's `breaks_at {force, torque, over_steps = 1}`, which names a force or a torque.
    pub(super) fn breaks(&mut self, j: &Map<String, Value>, p: &str) -> Option<Breaks> {
        let v = j.get("breaks_at")?;
        let bp = join(p, "breaks_at");
        let m = &self.obj(v, &bp, &["force", "torque", "over_steps"]);
        let force = self.opt_num(m, "force", &bp, 0.0);
        let torque = self.opt_num(m, "torque", &bp, 0.0);
        if force.is_none() && torque.is_none() {
            self.refuse(
                "physics.missing_field",
                bp.clone(),
                v,
                format!("{bp} needs a force or a torque"),
            );
        }
        let over_steps = self.num(m, "over_steps", &bp, 1.0, 1.0, f64::from(u8::MAX));
        if over_steps.fract() != 0.0 {
            self.refuse(
                "out_of_range",
                join(&bp, "over_steps"),
                &m["over_steps"],
                "over_steps must be a whole number of steps".into(),
            );
        }
        Some(Breaks {
            force,
            torque,
            over_steps: over_steps as u32,
        })
    }

    /// The world's `solve {drivers: [{joint, channel}], iterations = 20, tolerance = 1e-5}`, only in
    /// kinematic mode, each driver a hinge or a slider of the world.
    pub(super) fn solve(
        &mut self,
        m: &Map<String, Value>,
        kinematic: bool,
        joints: &BTreeMap<String, Joint>,
    ) -> Option<Solve> {
        let v = m.get("solve")?;
        let s = &self.obj(v, "solve", &["drivers", "iterations", "tolerance"]);
        if !kinematic {
            let what = "a kinematic solve runs only in kinematic mode".into();
            self.refuse("out_of_range", "solve".into(), v, what);
        }
        let mut drivers = Vec::new();
        for (i, d) in s
            .get("drivers")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .enumerate()
        {
            let p = format!("solve/drivers/{i}");
            let d = &self.obj(d, &p, &["joint", "channel"]);
            let (joint, channel) = (self.text(d, "joint", &p), self.text(d, "channel", &p));
            let kind = joint.as_ref().and_then(|j| joints.get(j)).map(|j| j.kind);
            if !matches!(kind, Some(JointKind::Hinge | JointKind::Slider)) {
                let what = format!("{p}/joint must name a hinge or a slider of this world");
                self.refuse(
                    "ref_unresolved",
                    join(&p, "joint"),
                    d.get("joint").unwrap_or(&Value::Null),
                    what,
                );
            }
            if let (Some(j), Some(c)) = (joint, channel) {
                drivers.push((j, c));
            }
        }
        Some(Solve {
            drivers,
            iterations: self.num(s, "iterations", "solve", 20.0, 1.0, f64::from(u8::MAX)) as u32,
            tolerance: self.num(s, "tolerance", "solve", 1e-5, f64::MIN_POSITIVE, f64::MAX),
        })
    }

    /// #2248: an output's `sample` and `average`, whole steps, and its `keep`, a duration; none
    /// when it writes none of them.
    fn sampled(&mut self, o: &Map<String, Value>, p: &str) -> Option<Sampled> {
        let steps = |r: &mut Self, key: &str| {
            let n = r.num(o, key, p, 1.0, 1.0, f64::from(u32::MAX));
            if n.fract() != 0.0 {
                let what = format!("{key} must be a whole number of steps");
                r.refuse("out_of_range", join(p, key), &o[key], what);
            }
            n as u64
        };
        let (every, average) = (steps(self, "sample"), steps(self, "average"));
        let keep = o.get("keep").and_then(|v| {
            deep_canvas::document::duration(&Value::Null, v)
                .map_err(|why| {
                    let what = format!("keep must be a duration, such as 0.5s: {why}");
                    self.refuse("out_of_range", join(p, "keep"), v, what);
                })
                .ok()
        });
        let written = ["sample", "average", "keep"]
            .iter()
            .any(|k| o.contains_key(*k));
        written.then_some(Sampled {
            every,
            average,
            keep,
        })
    }

    /// #2248: refuses `sample`, `average` and `keep` on an output whose value after a step is no
    /// one number or vector, which is all a series samples.
    fn unsampled(&mut self, o: &Map<String, Value>, p: &str, what: &str) {
        for k in ["sample", "average", "keep"] {
            if let Some(x) = o.get(k) {
                let what = format!("a series samples one number or vector a step; {what}");
                self.refuse("out_of_range", join(p, k), x, what);
            }
        }
    }

    /// #2248: an output's `expr` over its `reads`, each `{from, read}` a number or a vector of a
    /// body or a joint. The expression names at least one of them and nothing else, and the
    /// output takes no `from` or `read` of its own.
    fn formula(
        &mut self,
        o: &Map<String, Value>,
        p: &str,
        bodies: &BTreeMap<String, Body>,
        joints: &BTreeMap<String, Joint>,
        rest: Output,
    ) -> Option<Output> {
        for k in ["from", "read", "reduce", "crossings"] {
            if let Some(x) = o.get(k) {
                let what = format!("an output with an expr reads its named reads; it takes no {k}");
                self.refuse("out_of_range", join(p, k), x, what);
            }
        }
        let (ep, rp) = (join(p, "expr"), join(p, "reads"));
        if !o.contains_key("expr") {
            let what = "reads name what an expr reads, and this output has none".to_string();
            self.refuse("physics.missing_field", ep, &o["reads"], what);
            return None;
        }
        let text = self.text(o, "expr", p)?;
        let mut named = BTreeMap::new();
        let reads = o.get("reads").unwrap_or(&Value::Null);
        if !(reads.is_null() || reads.is_object()) {
            let what = format!("{rp} must be an object of name → {{from, read}}");
            self.refuse("out_of_range", rp.clone(), reads, what);
        }
        for (name, r) in reads.as_object().into_iter().flatten() {
            let np = join(&rp, name);
            let r = &self.obj(r, &np, &["from", "read"]);
            let word = r.get("read").and_then(Value::as_str).unwrap_or_default();
            let from = r.get("from").and_then(Value::as_str).unwrap_or_default();
            let read =
                Read::named(word).filter(|x| !matches!(x, Read::Pose | Read::ParticlePositions));
            match read {
                Some(read) if subject(read, from, bodies, joints) => {
                    named.insert(name.clone(), (from.to_string(), read));
                }
                Some(read) => {
                    let what = format!(
                        "{from:?} is not a {} of this world, which {word} reads",
                        subject_name(read)
                    );
                    self.refuse("ref_unresolved", join(&np, "from"), &r["from"], what);
                }
                None => {
                    let what = format!("{np} needs a read that is a number or a vector");
                    self.refuse("physics.missing_field", join(&np, "read"), &r["read"], what);
                }
            }
        }
        let expr = match super::data::compile(&text) {
            Ok(e) => e,
            Err(why) => {
                self.refuse("out_of_range", ep, &o["expr"], why);
                return None;
            }
        };
        if expr.vars.is_empty() {
            let what = "an expr names at least one of its output's reads".to_string();
            self.refuse("physics.missing_field", ep.clone(), &o["expr"], what);
        }
        let mut reads = Vec::new();
        for var in &expr.vars {
            match named.get(var) {
                Some(r) => reads.push(r.clone()),
                None => {
                    let what =
                        format!("{var} is not one of the output's reads, which its expr names");
                    self.refuse("ref_unresolved", ep.clone(), &o["expr"], what);
                }
            }
        }
        Some(Output {
            to: self.text(o, "to", p),
            expr: Some(Formula { expr, reads }),
            ..rest
        })
    }

    /// An output reading a body, a joint or a soft body's particles, or (#2248) an `expr` over
    /// its named reads; a character body's reads (#182) are refused from any other body.
    pub(super) fn output(
        &mut self,
        v: &Value,
        p: &str,
        bodies: &BTreeMap<String, Body>,
        joints: &BTreeMap<String, Joint>,
        soft: &BTreeMap<String, Soft>,
    ) -> Option<Output> {
        let o = &self.obj(v, p, OUTPUT_KEYS);
        let rest = Output {
            from: String::new(),
            read: Read::Expr,
            to: None,
            hold: self.word(o, "interpolate", p, "linear", &["linear", "hold"]) == "hold",
            skin: None,
            crossings: Vec::new(),
            sampled: self.sampled(o, p),
            reduce: None,
            expr: None,
            unit: self.text(o, "unit", p),
        };
        if o.contains_key("expr") || o.contains_key("reads") {
            return self.formula(o, p, bodies, joints, rest);
        }
        let name = o.get("read").and_then(Value::as_str).unwrap_or_default();
        let read = match (Read::named(name), name) {
            (Some(r), _) => r,
            (None, _) => {
                let names: Vec<&str> = READS.iter().map(|r| r.0).collect();
                let at = o.get("read").unwrap_or(&Value::Null);
                self.refuse(
                    "physics.missing_field",
                    join(p, "read"),
                    at,
                    format!("{p} needs a read: one of {}", names.join(", ")),
                );
                return None;
            }
        };
        let from = o.get("from").unwrap_or(&Value::Null);
        if read == Read::ParticlePositions || o.get("to").is_some_and(Value::is_object) {
            return self.particles(o, p, read, rest, soft);
        }
        if let Some(x) = o.get("reduce") {
            let what = format!("reduce folds the particles a from names; {name} reads one value");
            self.refuse("out_of_range", join(p, "reduce"), x, what);
        }
        let to = self.text(o, "to", p);
        // #1921: `<body>#*` reads every element body of an each: body, and writes each one's pose
        // into its row of an instancer's position and rotation columns.
        if let Some(body) = from.as_str().and_then(|f| f.strip_suffix("#*")) {
            let element = |id: &String| id.strip_prefix(body).is_some_and(|e| e.starts_with('#'));
            let instancer = to.as_deref().and_then(|t| t.strip_prefix("items/"));
            let refusal = if !bodies.keys().any(element) {
                Some((
                    "from",
                    format!("{body} is not a body of this world with each:"),
                ))
            } else if read != Read::Pose {
                Some(("read", "an output from <body>#* reads pose".to_string()))
            } else if instancer.is_none_or(|i| i.contains('/')) {
                Some((
                    "to",
                    "an output from <body>#* writes items/<instancer ID>".to_string(),
                ))
            } else {
                None
            };
            if let Some((key, what)) = refusal {
                let at = o.get(key).unwrap_or(&Value::Null);
                self.refuse("ref_unresolved", join(p, key), at, what);
                return None;
            }
            self.unsampled(o, p, "an output from <body>#* writes a pose a row");
            return Some(Output {
                from: format!("{body}#*"),
                read,
                to,
                ..rest
            });
        }
        // #251: a vehicle body's wheel, `<body>#<wheel>`, reads its pose and its contact count.
        let wheel = |id: &str| {
            let (body, name) = id.split_once('#')?;
            bodies.get(body)?.vehicle.as_ref()?.wheels.get(name)
        };
        let found = from.as_str().filter(|id| {
            subject(read, id, bodies, joints)
                || (wheel(id).is_some() && matches!(read, Read::Pose | Read::ContactCount))
        });
        let Some(id) = found else {
            let what = subject_name(read);
            self.refuse(
                "ref_unresolved",
                join(p, "from"),
                from,
                format!("{from} is not a {what} of this world, which {name} reads"),
            );
            return None;
        };
        if read == Read::Pose || id.contains('#') {
            self.unsampled(o, p, "a pose or a wheel's reading is neither");
        }
        let mut crossings = Vec::new();
        if let Some(v) = o.get("crossings") {
            let path = join(p, "crossings");
            match v
                .as_array()
                .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
            {
                Some(Some(levels)) if read.of_joint() => crossings = levels,
                Some(Some(_)) => {
                    let what = format!("{p} reads {name}; crossings watch a joint's reading, joint_coordinate or joint_force");
                    self.refuse("out_of_range", path, v, what);
                }
                _ => {
                    let what = format!("{path} must be a list of levels");
                    self.refuse("out_of_range", path, v, what);
                }
            }
        }
        Some(Output {
            from: id.into(),
            read,
            to,
            crossings,
            ..rest
        })
    }

    /// An output of `particle_positions` (#524): every particle of a soft body, or with
    /// `#<address>` one particle, `#pins` its pinned ones; with `to: {skin: {item, material}}`
    /// the whole body drawn on an item built on its lattice. A skin reads only particles. #2248:
    /// with `reduce`, the particles it names fold into one position, their sum, mean or max.
    fn particles(
        &mut self,
        o: &Map<String, Value>,
        p: &str,
        read: Read,
        rest: Output,
        soft: &BTreeMap<String, Soft>,
    ) -> Option<Output> {
        let from = o.get("from").unwrap_or(&Value::Null);
        let name = from.as_str().unwrap_or_default();
        let (id, part) = name
            .split_once('#')
            .map_or((name, None), |(a, b)| (a, Some(b)));
        let Some(s) = soft.get(id) else {
            let what =
                format!("{from} is not a soft body of this world, which particle_positions reads");
            self.refuse("ref_unresolved", join(p, "from"), from, what);
            return None;
        };
        if let Some(part) = part.filter(|a| *a != "pins" && !s.addresses.iter().any(|x| x == a)) {
            let what = format!("{part:?} is no particle address of soft body {id}, nor pins");
            self.refuse("ref_unresolved", join(p, "from"), from, what);
            return None;
        }
        let to = o.get("to").unwrap_or(&Value::Null);
        let skin = match to {
            Value::Object(t) => {
                let tp = join(p, "to");
                let t = &self.obj(&Value::Object(t.clone()), &tp, &["skin"]);
                let sp = join(&tp, "skin");
                let k = &self.obj(
                    t.get("skin").unwrap_or(&Value::Null),
                    &sp,
                    &["item", "material"],
                );
                let item = self.text(k, "item", &sp).filter(|i| i != "auto");
                let skin = Skin {
                    item,
                    material: self.text(k, "material", &sp),
                };
                if read != Read::ParticlePositions || part.is_some() {
                    let what = "a skin draws a whole soft body's particle_positions".to_string();
                    self.refuse("out_of_range", sp, to, what);
                    return None;
                }
                Some(skin)
            }
            _ => None,
        };
        let reduce = match self.word(o, "reduce", p, "", &["sum", "mean", "max"]) {
            "sum" => Some(Reduce::Sum),
            "mean" => Some(Reduce::Mean),
            "max" => Some(Reduce::Max),
            _ => None,
        };
        if reduce.is_some() && (skin.is_some() || part.is_some_and(|a| a != "pins")) {
            let what =
                "reduce folds a soft body's particles or its #pins, not a skin or one particle";
            self.refuse("out_of_range", join(p, "reduce"), &o["reduce"], what.into());
        }
        if reduce.is_none() {
            self.unsampled(o, p, "particle_positions without reduce is one a particle");
        }
        Some(Output {
            from: name.into(),
            read,
            to: if skin.is_some() {
                None
            } else {
                self.text(o, "to", p)
            },
            skin,
            reduce,
            ..rest
        })
    }
}

/// #1919: a query's probe shape, read as a world's shape is, or the refusals under `path`.
pub fn probe_shape(v: &Value, path: &str) -> Result<Shape, Vec<Refusal>> {
    let mut r = Reader::default();
    match r.shape(v, path) {
        Some(s) if r.out.is_empty() => Ok(s),
        _ => Err(r.out),
    }
}

/// #1919: a query's probe pose `{pos, rot}`, read as a body's pose is, or the refusals under `path`.
pub fn probe_pose(v: &Value, path: &str) -> Result<Pose, Vec<Refusal>> {
    let mut r = Reader::default();
    let pose = r.pose(Some(v), path);
    if r.out.is_empty() {
        Ok(pose)
    } else {
        Err(r.out)
    }
}
