//! A world's occurrence list (#1918; canvas primitives: Occurrence list): what a backend reports
//! after each step, in this crate's own IDs and shape-use indices and in whatever order the engine
//! met them, turned into the one list every reader takes. `a` is the lower of the two IDs in
//! canonical order, normals point from `a` to `b`, and the list sorts by (step, kind, a, b), ties
//! by a's shape-use index, then b's; so two backends that meet the same pairs in another order
//! give the same list, byte for byte.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Map, Value};

use crate::doc::World;

/// The physics kinds, each's `kind: u8` its index here (Occurrence list: Physics kinds).
pub const KINDS: [&str; 12] = [
    "contact_begin",
    "contact_end",
    "hit",
    "force",
    "sensor_enter",
    "sensor_exit",
    "break",
    "tear",
    "rest",
    "wake",
    "crossing",
    "fault",
];

/// A kind's `u8`, or `None` for a name that isn't a physics kind.
pub fn code(kind: &str) -> Option<u8> {
    KINDS.iter().position(|k| *k == kind).map(|i| i as u8)
}

/// What a kind carries beyond its step, kind and IDs.
#[derive(Clone, Debug, PartialEq)]
pub enum Payload {
    None,
    /// `contact_begin {point, normal}`.
    Contact {
        point: [f32; 3],
        normal: [f32; 3],
    },
    /// `hit {point, normal, speed: m/s, impulse: N·s, tags}`.
    Hit {
        point: [f32; 3],
        normal: [f32; 3],
        speed: f32,
        impulse: f32,
        tags: Vec<String>,
    },
    /// `break {force: N, torque: N·m}`.
    Break {
        force: f32,
        torque: f32,
    },
    /// #523: `fault {kind}`, one of [`FAULTS`].
    Fault {
        kind: &'static str,
    },
    /// #523: `crossing {t: flick, output, level, direction: ±1}`: an output's reading passing a
    /// level it watches, at a time interpolated between steps and floored to a flick.
    Crossing {
        t: i64,
        output: String,
        level: f64,
        direction: i8,
    },
}

/// A fault's kinds, each's byte its index here (Occurrence list: `fault`); #523 adds `jam`, a
/// kinematic solve that ended its iteration cap past its tolerance (Kinematic solve).
pub const FAULTS: [&str; 5] = ["nan", "capacity", "speed_cap", "penetration", "jam"];

/// One occurrence as a backend reports it: `kind` an index of [`KINDS`], `a` and `b` stable IDs
/// with the shape-use index on each body where a contact names one, in the engine's own order.
#[derive(Clone, Debug, PartialEq)]
pub struct Raw {
    pub kind: u8,
    pub a: String,
    pub a_use: Option<u32>,
    pub b: Option<String>,
    pub b_use: Option<u32>,
    pub payload: Payload,
}

/// One entry of the list: a [`Raw`] made canonical and stamped with the step that wrote it.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub step: u32,
    pub raw: Raw,
}

/// A stable ID's place in canonical order (#1921): by ID, an element address `<body>#<element id>`
/// by its body's ID and then its element ID as a number, so `crate#2` comes before `crate#10`.
pub fn id_order(id: &str) -> (&str, Option<u32>) {
    match id.rsplit_once('#') {
        Some((body, e)) if e.bytes().all(|b| b.is_ascii_digit()) => (body, e.parse().ok()),
        _ => (id, None),
    }
}

/// The world's body IDs in the order the backend builds them: by [`id_order`].
pub fn built_order(w: &World) -> Vec<&String> {
    let mut ids: Vec<&String> = w.bodies.keys().collect();
    ids.sort_by_key(|id| id_order(id));
    ids
}

/// Each ID's rank in canonical order, (priority, ID) over the world's bodies, then its joints by
/// ID (A timeline as data over a pinned backend: order is canonical by (priority, ID)).
pub fn ranks(w: &World) -> BTreeMap<String, u32> {
    let mut bodies: Vec<&String> = w.bodies.keys().collect();
    bodies.sort_by_key(|id| (w.bodies[*id].priority, id_order(id)));
    let ids = bodies.into_iter().chain(w.joints.keys());
    ids.enumerate()
        .map(|(i, id)| (id.clone(), i as u32))
        .collect()
}

fn flip(v: [f32; 3]) -> [f32; 3] {
    [-v[0], -v[1], -v[2]]
}

/// `raw` with `a` the lower ID in canonical order: a pair the engine met the other way round
/// swaps its IDs and shape uses, and its normal turns to point from the new `a` to `b`.
fn canonical(mut raw: Raw, rank: &BTreeMap<String, u32>) -> Raw {
    let Some(b) = raw.b.clone() else { return raw };
    let key = |id: &str, u: Option<u32>| (rank.get(id).copied().unwrap_or(u32::MAX), u);
    if key(&b, raw.b_use) >= key(&raw.a, raw.a_use) {
        return raw;
    }
    raw.b = Some(std::mem::replace(&mut raw.a, b));
    std::mem::swap(&mut raw.a_use, &mut raw.b_use);
    match &mut raw.payload {
        Payload::Contact { normal, .. } | Payload::Hit { normal, .. } => *normal = flip(*normal),
        Payload::None
        | Payload::Break { .. }
        | Payload::Fault { .. }
        | Payload::Crossing { .. } => {}
    }
    raw
}

/// One step's rows: each raw made canonical, sorted by (kind, a, b), ties by a's shape-use index,
/// then b's, and stamped with `step`.
pub fn sorted(step: u32, raws: Vec<Raw>, rank: &BTreeMap<String, u32>) -> Vec<Row> {
    let r = |id: &str| rank.get(id).copied().unwrap_or(u32::MAX);
    let mut out: Vec<Raw> = raws.into_iter().map(|x| canonical(x, rank)).collect();
    out.sort_by_key(|o| {
        (
            o.kind,
            r(&o.a),
            o.b.as_deref().map_or(u32::MAX, r),
            o.a_use,
            o.b_use,
        )
    });
    out.into_iter().map(|raw| Row { step, raw }).collect()
}

fn f32s(bytes: &mut Vec<u8>, v: &[f32]) {
    for x in v {
        bytes.extend_from_slice(&x.to_bits().to_le_bytes());
    }
}

/// The list's bytes, little-endian: per row `step: u32, kind: u8, a, b: u32` (ranks; `b` is
/// u32::MAX when none), both shape-use indices (u32::MAX when none), then the payload by kind, its
/// floats by their bits and each tag length-prefixed.
pub fn bytes(rows: &[Row], rank: &BTreeMap<String, u32>) -> Vec<u8> {
    let r = |id: Option<&str>| id.and_then(|i| rank.get(i).copied()).unwrap_or(u32::MAX);
    let mut out = Vec::new();
    for row in rows {
        let o = &row.raw;
        out.extend_from_slice(&row.step.to_le_bytes());
        out.push(o.kind);
        for n in [
            r(Some(&o.a)),
            r(o.b.as_deref()),
            o.a_use.unwrap_or(u32::MAX),
            o.b_use.unwrap_or(u32::MAX),
        ] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        match &o.payload {
            Payload::None => {}
            Payload::Contact { point, normal } => {
                f32s(&mut out, point);
                f32s(&mut out, normal);
            }
            Payload::Hit {
                point,
                normal,
                speed,
                impulse,
                tags,
            } => {
                f32s(&mut out, point);
                f32s(&mut out, normal);
                f32s(&mut out, &[*speed, *impulse]);
                out.extend_from_slice(&(tags.len() as u32).to_le_bytes());
                for t in tags {
                    out.extend_from_slice(&(t.len() as u32).to_le_bytes());
                    out.extend_from_slice(t.as_bytes());
                }
            }
            Payload::Break { force, torque } => f32s(&mut out, &[*force, *torque]),
            Payload::Fault { kind } => {
                out.push(FAULTS.iter().position(|f| f == kind).unwrap_or(0) as u8)
            }
            Payload::Crossing {
                t,
                output,
                level,
                direction,
            } => {
                out.extend_from_slice(&t.to_le_bytes());
                out.extend_from_slice(&(output.len() as u32).to_le_bytes());
                out.extend_from_slice(output.as_bytes());
                out.extend_from_slice(&level.to_bits().to_le_bytes());
                out.push(*direction as u8);
            }
        }
    }
    out
}

/// The list's hash: the SHA-256 of [`bytes`], as 64 hex.
pub fn hash(rows: &[Row], rank: &BTreeMap<String, u32>) -> String {
    sha256_hex(&bytes(rows, rank))
}

fn v3(v: [f32; 3]) -> Value {
    json!(v.map(f64::from))
}

/// A row as the list holds it: `{step, kind, a, b}`, the shape uses a contact names (`a_use`,
/// `b_use`), and the payload's fields by name.
pub fn json(row: &Row) -> Value {
    let o = &row.raw;
    let mut m = Map::new();
    m.insert("step".into(), json!(row.step));
    m.insert("kind".into(), json!(KINDS[usize::from(o.kind)]));
    m.insert("a".into(), json!(o.a));
    m.insert("b".into(), json!(o.b));
    if let (Some(a), Some(b)) = (o.a_use, o.b_use) {
        m.insert("a_use".into(), json!(a));
        m.insert("b_use".into(), json!(b));
    }
    match &o.payload {
        Payload::None => {}
        Payload::Contact { point, normal } => {
            m.insert("point".into(), v3(*point));
            m.insert("normal".into(), v3(*normal));
        }
        Payload::Hit {
            point,
            normal,
            speed,
            impulse,
            tags: t,
        } => {
            m.insert("point".into(), v3(*point));
            m.insert("normal".into(), v3(*normal));
            m.insert("speed".into(), json!(f64::from(*speed)));
            m.insert("impulse".into(), json!(f64::from(*impulse)));
            m.insert("tags".into(), json!(t));
        }
        Payload::Break { force, torque } => {
            m.insert("force".into(), json!(f64::from(*force)));
            m.insert("torque".into(), json!(f64::from(*torque)));
        }
        Payload::Fault { kind } => {
            m.insert("fault".into(), json!({ "kind": kind }));
        }
        Payload::Crossing {
            t,
            output,
            level,
            direction,
        } => {
            m.insert("t".into(), json!(t));
            m.insert("output".into(), json!(output));
            m.insert("level".into(), json!(level));
            m.insert("direction".into(), json!(direction));
        }
    }
    Value::Object(m)
}

/// The list as its rows.
pub fn listed(rows: &[Row]) -> Vec<Value> {
    rows.iter().map(json).collect()
}

/// `w`'s step, flicks.
pub fn step_flicks(w: &World) -> i64 {
    deep_canvas::time::step_length(w.step_rate)
        .expect("the world reader refuses a step rate with no whole-flick step")
}

/// The list as readers read it in a scene: each row stamped with `t`, its step's time in flicks
/// (`step` × the world's step length), as a logic item's rows are; a crossing keeps its own.
pub fn timed(rows: &[Value], w: &World) -> Vec<Value> {
    let h = step_flicks(w);
    let stamp = |r: &Value| {
        let mut r = r.clone();
        if r.get("t").is_none() {
            let step = r["step"].as_i64().unwrap_or(0);
            r["t"] = json!(step * h);
        }
        r
    };
    rows.iter().map(stamp).collect()
}
