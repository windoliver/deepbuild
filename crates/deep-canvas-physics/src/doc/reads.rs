//! #1918's fields of the world document: a kinematic body's `follow` channel, a joint's
//! `breaks_at`, a contact material's `tag` and a physics output's reads and target (canvas
//! primitives: Body, Joint, Contact material, Physics output).

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::{join, Body, BodyKind, Breaks, Joint, JointKind, Pose, Reader, Refusal, Shape};

/// The issue that brings an output's post-processing fields.
pub const OUTPUT_LATER: &str = "#2248";

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
}

/// Each read's name, and whether it reads a joint rather than a body.
pub const READS: [(&str, Read, bool); 8] = [
    ("pose", Read::Pose, false),
    ("position", Read::Position, false),
    ("angle", Read::Angle, false),
    ("velocity", Read::Velocity, false),
    ("joint_coordinate", Read::JointCoordinate, true),
    ("joint_force", Read::JointForce, true),
    ("contact_count", Read::ContactCount, false),
    ("energy", Read::Energy, false),
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
    /// #523: the levels whose crossings its reading writes (`crossing {t, output, level,
    /// direction}`); a joint's reading only.
    pub crossings: Vec<f64>,
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
    "unit",
    "crossings",
];

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

    /// An output reading a body or a joint; its post-processing fields and the reads of soft and
    /// character bodies are refused, naming the issue that brings each.
    pub(super) fn output(
        &mut self,
        v: &Value,
        p: &str,
        bodies: &BTreeMap<String, Body>,
        joints: &BTreeMap<String, Joint>,
    ) -> Option<Output> {
        let o = &self.obj(v, p, OUTPUT_KEYS);
        for k in ["reduce", "average", "sample", "keep", "expr", "unit"] {
            if let Some(x) = o.get(k) {
                self.refuse("physics.unsupported", join(p, k), x, format!("an output's {k} isn't run by this backend interface yet; {OUTPUT_LATER} brings it"));
            }
        }
        let name = o.get("read").and_then(Value::as_str).unwrap_or_default();
        let read = match (Read::named(name), name) {
            (Some(r), _) => r,
            (None, "particle_positions" | "grounded" | "sliding") => {
                let issue = if name == "particle_positions" {
                    "#1786"
                } else {
                    "#182"
                };
                self.refuse("physics.unsupported", join(p, "read"), &o["read"], format!("the read {name} isn't run by this backend interface yet; {issue} brings it"));
                return None;
            }
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
        let to = match o.get("to") {
            Some(Value::Object(s)) if s.contains_key("skin") => {
                self.refuse(
                    "physics.unsupported",
                    join(p, "to"),
                    &o["to"],
                    "a skin isn't drawn by this backend interface yet; #1786 brings it".into(),
                );
                None
            }
            _ => self.text(o, "to", p),
        };
        let hold = self.word(o, "interpolate", p, "linear", &["linear", "hold"]) == "hold";
        let from = o.get("from").unwrap_or(&Value::Null);
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
            return Some(Output {
                from: format!("{body}#*"),
                read,
                to,
                hold,
                crossings: Vec::new(),
            });
        }
        let found = from.as_str().filter(|id| {
            if read.of_joint() {
                joints.contains_key(*id)
            } else {
                bodies.contains_key(*id)
            }
        });
        let Some(id) = found else {
            let what = if read.of_joint() { "joint" } else { "body" };
            self.refuse(
                "ref_unresolved",
                join(p, "from"),
                from,
                format!("{from} is not a {what} of this world, which {name} reads"),
            );
            return None;
        };
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
            hold,
            crossings,
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
