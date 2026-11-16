//! #191: fast bodies. The lint `physics.fast_body`, run over every bake, raises an issue for a
//! dynamic body with `ccd` off that moves farther in one step than half its thinnest extent, naming
//! the body, the step, its move and that half. And the default: a world whose bake flags a body
//! that leaves `ccd` unset expands with `ccd: true` on it, shown as an assumption row, so a body no
//! one thought to sweep still never passes through a wall.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::check::fix;
use crate::doc::{BodyKind, Shape, World};

/// The lint's code.
pub const FAST_BODY: &str = "physics.fast_body";

/// Half the thinnest extent of body `id`'s shapes, m; none when no shape has a plain one.
fn thinnest(w: &World, id: &str) -> Option<f64> {
    let b = w.bodies.get(id)?;
    b.shapes
        .iter()
        .filter_map(|u| match w.shapes.get(&u.shape)? {
            Shape::Sphere { radius } | Shape::Capsule { radius, .. } => Some(*radius),
            Shape::Box { half } => Some(half[0].min(half[1]).min(half[2])),
            Shape::Cylinder {
                radius,
                half_height,
            } => Some(radius.min(*half_height)),
            _ => None,
        })
        .reduce(f64::min)
}

/// What one flagged body did first: the step, its move over that step and half its thinnest
/// extent.
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    pub step: u64,
    pub moved: f64,
    pub half: f64,
}

/// The lint over one run, fed each body's position after each step.
#[derive(Clone, Debug, Default)]
pub struct FastBodies {
    /// Each dynamic body with `ccd` off: half its thinnest extent and where it last was.
    watched: BTreeMap<String, (f64, Option<[f64; 3]>)>,
    pub flagged: BTreeMap<String, Flag>,
}

impl FastBodies {
    pub fn new(w: &World) -> Self {
        let watched = w
            .bodies
            .iter()
            .filter(|(_, b)| b.kind == BodyKind::Dynamic && !b.ccd)
            .filter_map(|(id, _)| Some((id.clone(), (thinnest(w, id)?, None))))
            .collect();
        FastBodies {
            watched,
            flagged: BTreeMap::new(),
        }
    }

    /// Body `id` at `pos` after step `step`.
    pub fn at(&mut self, step: u64, id: &str, pos: [f64; 3]) {
        let Some((half, last)) = self.watched.get_mut(id) else {
            return;
        };
        if let Some(p) = last.replace(pos) {
            let moved =
                deep_canvas::ops::sqrt((0..3).map(|i| (pos[i] - p[i]) * (pos[i] - p[i])).sum());
            if moved > *half && !self.flagged.contains_key(id) {
                let half = *half;
                self.flagged.insert(id.into(), Flag { step, moved, half });
            }
        }
    }

    /// The lint's issues, one a flagged body.
    pub fn issues(&self) -> Vec<Value> {
        self.flagged
            .iter()
            .map(|(id, f)| {
                let what = format!("body {id} moves {:.4} m in step {}, farther than {:.4} m, half its thinnest extent, with ccd off, so it can pass through a wall thinner than it", f.moved, f.step, f.half);
                json!({"check": FAST_BODY, "code": FAST_BODY, "severity": "warning", "ids": [id], "path": format!("bodies/{id}/ccd"),
                       "body": id, "step": f.step, "move": f.moved, "half_extent": f.half, "t": Value::Null, "what": what, "fix": fix(FAST_BODY)})
            })
            .collect()
    }
}

/// `doc` with `ccd: true` on each flagged body that leaves `ccd` unset, with one assumption row a
/// body; with `leave_off` (a planted recipe) none is set, and the rows still say they were.
pub fn expand(
    doc: &Value,
    flagged: &BTreeMap<String, Flag>,
    leave_off: bool,
) -> (Value, Vec<Value>) {
    let mut out = doc.clone();
    let mut rows = Vec::new();
    for (id, f) in flagged {
        let Some(b) = out.pointer_mut(&format!("/bodies/{id}")) else {
            continue;
        };
        if b.get("ccd").is_some() {
            continue;
        }
        if !leave_off {
            b["ccd"] = json!(true);
        }
        let reason = format!("{FAST_BODY}: {id} moves {:.4} m in step {}, farther than half its thinnest extent ({:.4} m), so ccd is on, or it could pass through a thin wall", f.moved, f.step, f.half);
        rows.push(json!({"body": id, "field": "ccd", "value": true, "step": f.step, "move": f.moved, "half_extent": f.half, "reason": reason}));
    }
    (out, rows)
}

/// The refusal of an expansion that leaves a body its source left unset, and its bake flagged,
/// with `ccd` off, naming the body.
pub fn refused(source: &Value, expanded: &Value, flagged: &BTreeMap<String, Flag>) -> Vec<Value> {
    flagged
        .keys()
        .filter(|id| source.pointer(&format!("/bodies/{id}/ccd")).is_none())
        .filter(|id| expanded.pointer(&format!("/bodies/{id}/ccd")) != Some(&json!(true)))
        .map(|id| {
            let what = format!("body {id} is flagged by {FAST_BODY} and leaves ccd unset, and the expansion left its ccd off, so it would pass through a thin wall");
            json!({"check": "document.validate", "code": FAST_BODY, "severity": "error", "ids": [id], "path": format!("bodies/{id}/ccd"),
                   "body": id, "actual": expanded.pointer(&format!("/bodies/{id}/ccd")), "t": Value::Null, "what": what, "fix": fix(FAST_BODY)})
        })
        .collect()
}
