//! deep_show's diagnostic modes (issue #411; canvas primitives: Render-back: diagnostic modes):
//! the same frame at t drawn as a view in place of the look, returned as a display-only snapshot
//! by hash with what it drew as numbers. A mode is a tool entry of the canvas module whose data it
//! draws; one no module in this build draws answers `module_missing`, naming the module, never an
//! empty snapshot. Nothing a mode returns feeds a check or counts as evidence.

use deep_canvas::schedule::core_ops::{Fields, Transform};
use serde_json::{json, Map, Value};

use crate::hub::{Hub, Show};

/// The closed list, each with the canvas module whose data it draws.
pub const MODES: [(&str, &str); 14] = [
    ("lighting_only", "scene3d"),
    ("overdraw", "scene3d"),
    ("normals", "scene3d"),
    ("cascade_splits", "scene3d"),
    ("shadow_atlas", "scene3d"),
    ("luminance_false_color", "scene3d"),
    ("lights_per_cluster", "scene3d"),
    ("lod_per_item", "scene3d"),
    ("receivers_casters", "scene3d"),
    ("skeleton", "skin"),
    ("lights_cameras", "scene3d"),
    ("bounds", "core"),
    ("physics_shapes", "physics"),
    ("uv_checker", "scene3d"),
];

/// The modes this build draws: `bounds`, from the core's evaluated transforms and fields. The 3D
/// modes land with 3D scenes (#78), skeleton with skinned playback (#130) and physics shapes with
/// the physics module (#97).
const DRAWN: [&str; 1] = ["bounds"];

/// A mode's canvas module, for a name on the closed list.
pub fn owner(mode: &str) -> Option<&'static str> {
    MODES.iter().find(|(m, _)| *m == mode).map(|(_, o)| *o)
}

/// An item's evaluated 2D box `[x, y, w, h]` in its own space, from its lowered params.
fn local_box(fields: &Value) -> Option<[f64; 4]> {
    let params = fields.get("params")?;
    let n = |v: &Value| v.as_f64();
    if let Some(Value::Array(b)) = params.get("box") {
        let v: Vec<f64> = b.iter().map(n).collect::<Option<_>>()?;
        return <[f64; 4]>::try_from(v.as_slice()).ok();
    }
    if let (Some(Value::Array(c)), Some(r)) = (params.get("center"), params.get("r").and_then(n)) {
        let (x, y) = (n(c.first()?)?, n(c.get(1)?)?);
        return Some([x - r, y - r, 2.0 * r, 2.0 * r]);
    }
    let b = params.get("box")?;
    Some([0.0, 0.0, n(b.get("w")?)?, n(b.get("h")?)?])
}

/// The box's corners under the world transform: scaled, turned about z, moved; their bounds.
fn world_bounds(b: [f64; 4], t: &Transform) -> ([f64; 3], [f64; 3]) {
    let a = deep_canvas::ops::rad(t.rot[2]);
    let (cos, sin) = if t.rot[2] == 0.0 {
        (1.0, 0.0)
    } else {
        (deep_canvas::ops::cos(a), deep_canvas::ops::sin(a))
    };
    let mut min = [f64::INFINITY, f64::INFINITY, t.pos[2]];
    let mut max = [f64::NEG_INFINITY, f64::NEG_INFINITY, t.pos[2]];
    for (x, y) in [
        (b[0], b[1]),
        (b[0] + b[2], b[1]),
        (b[0], b[1] + b[3]),
        (b[0] + b[2], b[1] + b[3]),
    ] {
        let (x, y) = (x * t.scale[0], y * t.scale[1]);
        let p = [t.pos[0] + x * cos - y * sin, t.pos[1] + x * sin + y * cos];
        for k in 0..2 {
            min[k] = min[k].min(p[k]);
            max[k] = max[k].max(p[k]);
        }
    }
    (min, max)
}

impl Hub<'_> {
    /// A deep_show or deep show call in a diagnostic mode.
    pub fn mode_show(&mut self, show: &Show, mode: &str) -> Value {
        let module = owner(mode).unwrap_or("core");
        if !DRAWN.contains(&mode) {
            return json!({"outcome": "refused", "code": "module_missing", "module": module,
                          "mode": mode, "issues": [], "snapshots": [], "drawn": []});
        }
        let mut reply = self.show_call(show);
        if reply.get("outcome").and_then(Value::as_str) != Some("presented") {
            return reply;
        }
        let drawn = self.bounds_at(&show.doc, show.t);
        reply["mode"] = json!(mode);
        reply["display_only"] = json!(true);
        reply["drawn"] = json!(drawn);
        reply["snapshots"] = json!([]);
        if let Some((sha, picture, size)) = self.bounds_picture(&show.doc, &drawn, show.size) {
            let mut entry = crate::snapshot::entry(&sha, &picture, size);
            entry["display_only"] = json!(true);
            reply["snapshots"] = json!([entry]);
        }
        // A mode's picture and readings are never evidence: a check they'd pass stays unproven.
        if reply.get("result").and_then(Value::as_str) == Some("PASS") {
            reply["result"] = json!("INCONCLUSIVE");
            reply["reason"] = json!(
                "display_only: a diagnostic mode's snapshot and readings never count as evidence"
            );
        }
        reply
    }

    /// Each item's evaluated bounds at `t`, from its world transform and its fields, by stable ID.
    fn bounds_at(&mut self, doc: &str, t: i64) -> Vec<Value> {
        let Some(revision) = self.query_revision(doc, None) else {
            return Vec::new();
        };
        let session = self.evaluated(&revision.drawn, t);
        let ids: Vec<String> = revision
            .doc
            .get("items")
            .and_then(Value::as_object)
            .map(|items| items.keys().cloned().collect())
            .unwrap_or_default();
        let mut out = Vec::new();
        for id in ids {
            let world = session
                .read(&self.sched, "core.world", Some(&id))
                .and_then(|(v, _)| v.as_typed::<Transform>());
            let fields = session
                .read(&self.sched, "core.fields", Some(&id))
                .and_then(|(v, _)| v.as_typed::<Fields>());
            let (Some(world), Some(fields)) = (world, fields) else {
                continue;
            };
            let Some(b) = local_box(&fields.to_json()) else {
                continue;
            };
            let (min, max) = world_bounds(b, &world);
            out.push(json!({"id": id, "what": "box", "pos": world.pos, "min": min, "max": max}));
        }
        out
    }

    /// The bounds view: each box outlined in the look's ink on its ground, at the document's size,
    /// rendered on the CPU and kept in the evidence store.
    fn bounds_picture(
        &mut self,
        doc: &str,
        drawn: &[Value],
        size: Option<[u16; 2]>,
    ) -> Option<(String, crate::snapshot::Drawn, [u16; 2])> {
        let revision = self.query_revision(doc, None)?;
        let mut items = Map::new();
        for (i, row) in drawn.iter().enumerate() {
            let (min, max) = (row["min"].as_array()?, row["max"].as_array()?);
            let (x0, y0) = (min[0].as_f64()?, min[1].as_f64()?);
            let (x1, y1) = (max[0].as_f64()?, max[1].as_f64()?);
            let id = format!("bounds.{i:05}");
            items.insert(
                id.clone(),
                json!({"id": id, "kind": "rect@1", "name": format!("Bounds of {}", row["id"].as_str()?),
                       "order": format!("a{i:05}"),
                       "params": {"box": [x0, y0, x1 - x0, y1 - y0],
                                  "paint": {"stroke": {"role": "ink", "width": 1}}}}),
            );
        }
        let view = json!({"format": 1, "profile": "board", "title": "Bounds",
                          "description": "Each item's evaluated bounds, outlined: a diagnostic view.",
                          "size": revision.doc.get("size").cloned().unwrap_or(json!([320, 200])),
                          "items": items});
        let session = self.evaluated(&view, 0);
        let painted = crate::frames::drawing_of(&self.sched, &session)?;
        self.canonical_png(&painted, size).ok()
    }
}
