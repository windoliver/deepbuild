//! A bake's key and outputs (Bake), and the runtime digest a golden carries (Registry and seal:
//! runtime digest), from parts the backend's crate passes in: this crate reads no build, file or
//! clock, so the build's resolved pins, target and rustc come from the backend's build script.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use deep_canvas::registry::{BuildSet, Registry};
use deep_canvas::schedule::canonical;
use serde_json::{json, Map, Value};

/// One crate of the build as cargo resolved it: its version and resolved features.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pin {
    pub name: String,
    pub version: String,
    pub features: Vec<String>,
}

impl Pin {
    pub fn json(&self) -> Value {
        json!({"name": self.name, "version": self.version, "features": self.features})
    }
}

/// What a bake's results depend on beyond its documents: the implementation, the backend and the
/// crates under it as resolved, the target triple and rustc.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Build {
    pub implementation: String,
    pub version: String,
    pub backend: Pin,
    /// parry, wide, glam, glamx, simba and libm, each version the build resolves.
    pub pins: Vec<Pin>,
    pub target: String,
    pub rustc: String,
}

impl Build {
    /// The runtime digest a golden carries: the seal's, of the set that holds the physics module
    /// on this build alone, its pins every resolved crate with its version and features, so a
    /// moved pin moves it (#1920).
    pub fn runtime_digest(&self) -> String {
        Registry::new(BuildSet::Full)
            .with(crate::module::module(self))
            .seal()
            .expect("the physics module seals alone")
            .runtime_digest
    }
}

/// The documents and span a bake runs.
pub struct Parts<'a> {
    /// The world document as written.
    pub world: &'a Value,
    /// The scene channels and drivers the world reads.
    pub reads: &'a Value,
    /// The scene's input track.
    pub track: &'a Value,
    /// The document's frame rate, `p/q`, its outputs are sampled at.
    pub frame_rate: &'a str,
    pub steps: u64,
}

/// The bake key: sha256 of each part, length-prefixed, after a tag, as 64 hex. With `target` it
/// is the bake's key; without, a golden's, which binds the key without the target triple and
/// records the triple in its machine (Golden).
pub fn key(parts: &Parts, build: &Build, target: Option<&str>) -> String {
    let mut bytes = Vec::new();
    let mut part = |b: &[u8]| {
        bytes.extend_from_slice(&(b.len() as u64).to_le_bytes());
        bytes.extend_from_slice(b);
    };
    part(if target.is_some() {
        b"physics.bake@1"
    } else {
        b"physics.golden@1"
    });
    part(&canonical(parts.world));
    part(&canonical(parts.reads));
    part(&canonical(parts.track));
    part(parts.frame_rate.as_bytes());
    part(&parts.steps.to_le_bytes());
    for p in std::iter::once(&build.backend).chain(&build.pins) {
        part(format!("{} {} {}", p.name, p.version, p.features.join(",")).as_bytes());
    }
    if let Some(t) = target {
        part(t.as_bytes());
    }
    part(build.rustc.as_bytes());
    sha256_hex(&bytes)
}

/// A document's frame rate, written `p/q`, `p` or `[p, q]`, as `p/q` and its frame in flicks, or
/// why it isn't a rate (Time and the flick: a frame must be a whole number of flicks).
pub fn frame_rate(v: &Value) -> Result<(String, i64), String> {
    let (p, q) = deep_canvas::document::frame_rate_of(&json!({ "frame_rate": v }))
        .ok_or_else(|| format!("frame_rate {v} isn't a rate p/q"))?;
    let frame = deep_canvas::time::frame_length(p, q)?;
    Ok((format!("{p}/{q}"), frame))
}

/// Each output's position at each frame over `steps` steps at `step_rate` (Physics output): frame
/// k at t = k × `frame` flicks while t is within the span, step s = ⌊t ÷ h⌋ and α = (t − s × h) ÷ h
/// exact from flicks, the position the state after step s lerped toward the next by α, in f32.
/// `positions[id][s]` is output `id`'s body's position after step s; `readings[id]` (#523) is a
/// joint output's: whether it reads joint_force, written `{force: N, torque: N·m}`, else
/// joint_coordinate, written as one number, and its values after each step, lerped alike.
pub fn outputs(
    positions: &BTreeMap<String, Vec<[f32; 3]>>,
    readings: &BTreeMap<String, (bool, Vec<[f64; 2]>)>,
    frame_rate: &str,
    frame: i64,
    step_rate: f64,
    steps: u64,
) -> Value {
    let step = deep_canvas::time::step_length(step_rate)
        .expect("the world reader refuses a step rate with no whole-flick step");
    let span = i64::try_from(steps)
        .unwrap_or(i64::MAX)
        .saturating_mul(step);
    let times: Vec<i64> = (0..)
        .map(|k: i64| k.saturating_mul(frame))
        .take_while(|t| *t <= span)
        .collect();
    let mut bytes = frame_rate.as_bytes().to_vec();
    let mut series = Map::new();
    for (id, at) in positions {
        bytes.extend_from_slice(id.as_bytes());
        let values: Vec<Value> = times
            .iter()
            .map(|t| {
                let (s, rem) = (t / step, t % step);
                let a = at[s as usize];
                let p = if rem == 0 {
                    a
                } else {
                    let b = at[s as usize + 1];
                    let alpha = (rem as f64 / step as f64) as f32;
                    [0, 1, 2].map(|i| a[i] + alpha * (b[i] - a[i]))
                };
                for x in p {
                    bytes.extend_from_slice(&x.to_bits().to_le_bytes());
                }
                json!(p.map(f64::from))
            })
            .collect();
        series.insert(id.clone(), Value::Array(values));
    }
    for (id, (pair, at)) in readings {
        bytes.extend_from_slice(id.as_bytes());
        let values: Vec<Value> = times
            .iter()
            .map(|t| {
                let (s, rem) = ((t / step) as usize, t % step);
                let alpha = rem as f64 / step as f64;
                let v = [0, 1].map(|i| match rem {
                    0 => at[s][i],
                    _ => at[s][i] + alpha * (at[s + 1][i] - at[s][i]),
                });
                if *pair {
                    v.iter()
                        .for_each(|x| bytes.extend_from_slice(&x.to_bits().to_le_bytes()));
                    json!({"force": v[0], "torque": v[1]})
                } else {
                    bytes.extend_from_slice(&v[0].to_bits().to_le_bytes());
                    json!(v[0])
                }
            })
            .collect();
        series.insert(id.clone(), Value::Array(values));
    }
    json!({"frame_rate": frame_rate, "frames": times.len(), "hash": sha256_hex(&bytes), "series": series})
}
