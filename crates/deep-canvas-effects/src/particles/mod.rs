//! Particles in closed form (#449; canvas primitives: Particles `particles@1` and its emit
//! regions, occurrence bursts, bounce and kill, and turbulence).
//!
//! Particle i's state at t is a closed form of its age, its index and the item's seed: its birth
//! from the emitter's rate or a baked burst, its place on the emit region, its motion with every
//! bounce and landing solved in closed form, and a turbulence offset read from a table built at
//! check. The core evaluates it here in f64 for evaluated data and checks; a hand-written compute
//! kernel in `deep-effects-render` writes the same columns for the draw, from the tables
//! [`pack`] lays out. Nothing is integrated or carried between frames, so seeking equals playing.
//!
//! An item that uses none of #449's fields keeps the shipped graph `particles.sparks@1`
//! ([`crate::shipped::particles`]); [`extended`] says which path an item takes.

pub mod bake;
pub mod births;
pub mod bounds;
pub mod bursts;
pub mod eval;
pub mod heightmap;
pub mod pack;
pub mod regions;
pub mod rule;
pub mod solve;
pub mod spec;
pub mod surface;
pub mod turbulence;

use serde_json::Value;

/// A point or a vector in metres (or metres per second), +Y up.
pub type V3 = [f64; 3];

pub(crate) fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub(crate) fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub(crate) fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

pub(crate) fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn len(a: V3) -> f64 {
    deep_canvas::ops::sqrt(dot(a, a))
}

/// A look for evaluating a scene whose colours nothing reads: every role the document names, a
/// neutral grey, so the scene evaluates; particles read places, never colours.
pub fn neutral_look(doc: &Value) -> Value {
    fn roles(v: &Value, out: &mut serde_json::Map<String, Value>) {
        match v {
            Value::Object(m) => {
                if let Some(r) = m.get("role").and_then(Value::as_str) {
                    out.insert(r.to_string(), Value::from("#808080"));
                }
                m.values().for_each(|x| roles(x, out));
            }
            Value::Array(a) => a.iter().for_each(|x| roles(x, out)),
            _ => {}
        }
    }
    let mut out = serde_json::Map::new();
    roles(&doc["items"], &mut out);
    serde_json::json!({"roles": out})
}

/// The wrong programs the particle path runs under, each reachable only through a test's
/// planted switch: every criterion's planted twin.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The bounce solver tests only the first two planes.
    pub two_planes: bool,
    /// Drag integrated by Euler at 1/120 s instead of its closed form.
    pub euler_drag: bool,
    /// A turbulence table of zeros.
    pub zero_table: bool,
    /// Landing against the map's lowest plane alone.
    pub floor_plane: bool,
    /// An item's bounds are its emit region's alone.
    pub emit_bounds: bool,
    /// The emitter hides every particle from its span's end on.
    pub hides_at_span_end: bool,
    /// A surface's triangle picked with equal chance, whatever its area.
    pub uniform_triangles: bool,
    /// A skinned surface evaluated in its bind pose.
    pub bind_pose: bool,
    /// A surface point's velocity from the last frame drawn before the birth.
    pub inherit_previous_frame: bool,
    /// A surface's bounds from its bind pose alone.
    pub bounds_bind_pose: bool,
}

/// Whether an item uses a field the shipped graph can't hold, so the hand-written kernel draws
/// it: a new emit region or source, a bounce, a landing, a kill region, turbulence, `inherit` or
/// `follow`.
pub fn extended(params: &Value) -> bool {
    let emit = &params["emit"];
    let new_shape = emit["shape"]
        .as_object()
        .is_some_and(|s| s.keys().any(|k| k != "along"));
    new_shape
        || ["on", "bursts"].iter().any(|k| !emit[*k].is_null())
        || ["land", "kill", "turbulence", "inherit", "follow"]
            .iter()
            .any(|k| !params[*k].is_null())
        || !params["motion"]["bounce"].is_null()
        || !params["motion"]["ballistic"]["bounce"].is_null()
        || !params["motion"]["ballistic"]["velocity"].is_null()
}
