//! The core's own arrays and operators (technical design: The canvas core: the core holds the
//! document contract at run time, the scheduler, epochs and the content-key cache): an item
//! lowered to the one form checks read, its transform and its other fields, and its transform
//! composed with its parent's. A canvas module that must change one of these writes its own
//! array and names the core's in `contributes_to`: motion's channels and anything else that
//! moves an item contribute to `core.transform`, and the core never names them.

use serde_json::{json, Map, Value};

use super::{OpError, Val, View};
use crate::ops;
use crate::registry::Registrar;

/// The core's arrays its check kinds read, which a module whose items draw or place what they
/// hold contributes to.
pub const CHECKED: [&str; 4] = [
    "core.glyphs",
    "core.strokes",
    "core.shapes",
    "core.timeline",
];

/// The core's array a module contributes to for what its kind draws or places.
pub fn checked_array(draws: &str) -> Option<&'static str> {
    Some(match draws {
        "glyphs" => "core.glyphs",
        "strokes" => "core.strokes",
        "solids" => "core.shapes",
        "shots" | "cuts" | "holds" => "core.timeline",
        _ => return None,
    })
}

/// The core's arrays and operators, registered under the name `core` before every module's.
pub fn register(r: &mut Registrar) {
    r.array("core.lowered", "item", "item", "geometry", "validate");
    r.array("core.transform", "transform", "item", "transform", "items");
    r.array("core.fields", "item", "item", "geometry", "items");
    r.array("core.world", "transform", "item", "transform", "items");
    // What the core's own check kinds read and canvas modules fill through `contributes_to`
    // (Check input): glyph boxes, flattened strokes, true shapes and the timeline of shots, cuts
    // and holds.
    for array in CHECKED {
        r.array(array, "list", "document", "geometry", "extract");
    }
    // The status map every status mark draws from (The status-color rule): the look's roles, and
    // the state colors and glyphs the look module contributes.
    r.array("core.status", "status", "document", "shading", "items");
    r.operator("lower", "validate", &["self"], &["core.lowered"])
        .run(lower);
    r.operator("transform", "items", &["core.lowered"], &["core.transform"])
        .run(transform);
    r.operator("fields", "items", &["core.lowered"], &["core.fields"])
        .run(fields);
    r.operator(
        "world",
        "items",
        &["core.transform", "parent"],
        &["core.world"],
    )
    .run(world);
    r.operator("status", "items", &["look"], &["core.status"])
        .document()
        .applies(has_status)
        .run(status);
    r.fixture("board", board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/a/params/box", "value": [22, 16, 64, 40]},
    }));
}

/// The core's own fixture: boxes, a label and a child that rides its rotated, scaled parent.
fn board() -> Value {
    let rect = |id: &str, b: [f64; 4], order: &str, role: &str| {
        json!({"id": id, "kind": "rect@1", "name": format!("Box {id}"), "order": order,
               "params": {"box": b, "paint": {"fill": {"role": role}}}})
    };
    let mut items = Map::new();
    items.insert(
        "ground".into(),
        rect("ground", [0.0, 0.0, 320.0, 200.0], "a0", "ground"),
    );
    items.insert("a".into(), rect("a", [16.0, 16.0, 64.0, 40.0], "a1", "ink"));
    let mut parent = rect("p", [0.0, 0.0, 48.0, 32.0], "a2", "muted");
    parent["at"] = json!({"pos": [120, 60, 0], "rot": [0, 0, 15], "scale": [1.5, 1.5, 1]});
    items.insert("p".into(), parent);
    let mut child = rect("c", [0.0, 0.0, 16.0, 12.0], "a3", "ink");
    child["parent"] = json!("p");
    child["at"] = json!({"pos": [20, 8, 0]});
    items.insert("c".into(), child);
    items.insert(
        "cap".into(),
        json!({"id": "cap", "kind": "text@1", "name": "Caption", "order": "a4",
               "params": {"text": "The core's board", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
               "at": {"pos": [16, 150, 0]}}),
    );
    json!({"format": 1, "profile": "board", "seed": 387, "title": "Core board",
           "description": "Boxes, a caption and a child riding its turned, scaled parent: the core's own operators' fixture.",
           "size": [320, 200], "items": items})
}

/// The item in its one checked form: numbers normalized (−0 as +0, whole numbers as
/// integers), strings NFC, and a canvas module's kind drawn as the core kind it registered
/// (`rect@1`, its `box` in the look's ink), or as a group, which draws nothing itself, when it
/// registered none, until modules draw their own.
fn lower(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let mut out = crate::canon::canonical_value(item, &crate::canon::NoShape)
        .map_err(|e| OpError::new("out_of_range", format!("{}/{}", v.path(), e.path)))?;
    let kind = out
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(core_kind) = v.draws_as(&kind) {
        // A module's item one major back draws as its migrated form (Migration: at load).
        let migrated = v.migrated(&out);
        let at = migrated.as_ref().unwrap_or(&out);
        let params = at.get("params").cloned().unwrap_or(Value::Null);
        let kind = at
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        out["kind"] = json!(core_kind);
        out["params"] = match v.draw_of(&kind) {
            Some(draw) => draw(&params),
            None => json!({"box": params.get("box").cloned().unwrap_or(Value::Null),
                           "paint": {"fill": {"role": "ink"}}}),
        };
    } else if v.is_module_kind(&kind) {
        out["kind"] = json!("group@1");
        out["params"] = json!({});
    }
    v.write("core.lowered", Val::json(out))
}

/// A document with a status binding.
pub fn has_status(doc: &Value, _: &str, _: &Value) -> bool {
    doc.get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty())
}

/// The status map's base: the look's roles, which a status mark's label ink is chosen from. The
/// look module contributes its state colors and glyphs as `map`; with none, a mark has no glyph.
fn status(v: &mut View<'_>) -> Result<(), OpError> {
    let roles: Map<String, Value> = v
        .look()?
        .iter()
        .map(|(role, value)| (role.clone(), value.clone()))
        .collect();
    v.write("core.status", Val::json(json!({"roles": roles})))
}

/// The item's own transform, every member of `at` with `pos`, `rot` and `scale` three numbers
/// each (0, 0 and 1 where unwritten).
fn transform(v: &mut View<'_>) -> Result<(), OpError> {
    let lowered = v
        .json("core.lowered")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    let mut at = match lowered.get("at") {
        Some(Value::Object(at)) => at.clone(),
        _ => Map::new(),
    };
    for (name, fill) in [("pos", 0.0), ("rot", 0.0), ("scale", 1.0)] {
        let mut parts: Vec<f64> = match at.get(name) {
            Some(Value::Array(a)) => a.iter().map(|x| x.as_f64().unwrap_or(fill)).collect(),
            _ => Vec::new(),
        };
        parts.truncate(3);
        while parts.len() < 3 {
            parts.push(fill);
        }
        at.insert(name.into(), json!(parts));
    }
    v.write("core.transform", Val::json(Value::Object(at)))
}

/// The item's fields beside its transform.
fn fields(v: &mut View<'_>) -> Result<(), OpError> {
    let lowered = v
        .json("core.lowered")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    let mut out = (*lowered).clone();
    if let Some(map) = out.as_object_mut() {
        map.remove("at");
    }
    v.write("core.fields", Val::json(out))
}

fn three(at: &Value, name: &str, fill: f64) -> [f64; 3] {
    let mut out = [fill; 3];
    if let Some(Value::Array(a)) = at.get(name) {
        for (o, x) in out.iter_mut().zip(a) {
            *o = x.as_f64().unwrap_or(fill);
        }
    }
    out
}

/// The item's transform composed with its parent's, child-of parenting (canvas primitives:
/// Constraint, R1 `child_of`): the child's position scaled, turned about z by the parent's
/// rotation and moved by its position; rotations add and scales multiply.
fn world(v: &mut View<'_>) -> Result<(), OpError> {
    let own = v
        .json("core.transform")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    let mut out = (*own).clone();
    if let Some(Val::Json(parent)) = v.parent("core.world")? {
        let (p_pos, p_rot, p_scale) = (
            three(&parent, "pos", 0.0),
            three(&parent, "rot", 0.0),
            three(&parent, "scale", 1.0),
        );
        let (pos, rot, scale) = (
            three(&own, "pos", 0.0),
            three(&own, "rot", 0.0),
            three(&own, "scale", 1.0),
        );
        let (x, y) = (pos[0] * p_scale[0], pos[1] * p_scale[1]);
        let (cos, sin) = if p_rot[2] == 0.0 {
            (1.0, 0.0)
        } else {
            let a = ops::rad(p_rot[2]);
            (ops::cos(a), ops::sin(a))
        };
        let composed_pos = [
            p_pos[0] + x * cos - y * sin,
            p_pos[1] + x * sin + y * cos,
            p_pos[2] + pos[2] * p_scale[2],
        ];
        let composed_rot = [rot[0] + p_rot[0], rot[1] + p_rot[1], rot[2] + p_rot[2]];
        let composed_scale = [
            scale[0] * p_scale[0],
            scale[1] * p_scale[1],
            scale[2] * p_scale[2],
        ];
        out["pos"] = json!(composed_pos);
        out["rot"] = json!(composed_rot);
        out["scale"] = json!(composed_scale);
    }
    v.write("core.world", Val::json(out))
}
