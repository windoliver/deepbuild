//! #1921: what a world's `<body>#*` outputs write into its scene. Such an output reads every
//! element body of an `each:` body and writes each one's pose into its row of an instancer's `pos`
//! and `rot` columns as f32, rows in the instancer's own row order, so hundreds of bodies stay one
//! instanced draw. Its bake goes into the form's `arrays` as the core's column view takes a
//! world's array, each step with the rows it changed; a frame folds them at its time by Physics
//! output's rule (positions lerp and rotations nlerp between the two buffered steps, or the
//! earlier with `hold`), from the bake alone, so a seek writes what play does. #2288: an instancer
//! that is moved or turned holds each pose in its own frame, taken back through the inverse of
//! its world transform at t = 0, which the bake answers as its `frames`.

use serde_json::{json, Map, Value};

use crate::backend::{product, rotate};
use crate::doc::World;
use crate::module::changed;
use crate::occurrence::step_flicks;

/// An instancer's two columns an output writes, with each one's width.
const COLUMNS: [(&str, &str, usize); 2] = [("pos", "vec3", 3), ("rot", "quat", 4)];

/// #2248: the type of a readout's array by how many numbers its value has, one to four.
const WIDTHS: [&str; 4] = ["f64", "vec2", "vec3", "quat"];

/// The element IDs of instancer `item`'s rows in `scene`: its `ids`, or each row's index.
fn element_ids(scene: &Value, item: &str) -> Vec<String> {
    let params = &scene["items"][item]["params"];
    match params["ids"].as_array() {
        Some(ids) => ids.iter().map(Value::to_string).collect(),
        None => (0..params["pos"].as_array().map_or(0, Vec::len))
            .map(|r| r.to_string())
            .collect(),
    }
}

/// #2288: `state`'s `part` (`pos` or `rot`) in `frame` (`{pos, rot}`, an instancer's world
/// transform), each number an f32: taken back through the frame's inverse; as it is without one.
fn local(state: &Value, part: &str, frame: &Value) -> Value {
    let numbers =
        |v: &Value| -> Option<Vec<f64>> { v.as_array()?.iter().map(Value::as_f64).collect() };
    let (Some(at), Some(q), Some(x)) = (
        numbers(&frame["pos"]),
        numbers(&frame["rot"]),
        numbers(&state[part]),
    ) else {
        return state[part].clone();
    };
    let back = [-q[0], -q[1], -q[2], q[3]];
    let v: Vec<f64> = match (part, x.as_slice()) {
        ("pos", [a, b, c]) => rotate(back, [a - at[0], b - at[1], c - at[2]]).to_vec(),
        (_, [a, b, c, d]) => product(back, [*a, *b, *c, *d]).to_vec(),
        _ => return state[part].clone(),
    };
    json!(v.iter().map(|c| f64::from(*c as f32)).collect::<Vec<_>>())
}

/// #2248: the array an output to a readout writes, named `<world>.<output>.value`: the value it
/// writes at each of `frames` (a number, a vector, or a joint's `{force, torque}` as the two),
/// `every` flicks apart, each frame that changes it handed as the others' arrays hand a step.
fn readout(o: &crate::doc::Output, frames: &[Value], every: i64) -> Value {
    let row = |v: &Value| -> Vec<Value> {
        match v {
            Value::Array(a) => a.clone(),
            Value::Object(m) => m.values().cloned().collect(),
            x => vec![x.clone()],
        }
    };
    let (mut prev, mut steps) = (Vec::new(), Vec::new());
    for (k, v) in frames.iter().enumerate() {
        let now = vec![Value::Array(row(v))];
        if now != prev {
            steps.push(json!({"step": k, "changed": [[0, 1]], "values": [[0, now]]}));
        }
        prev = now;
    }
    let width = frames.first().map_or(1, |v| row(v).len());
    let ty = WIDTHS[width.clamp(1, 4) - 1];
    json!({"type": ty, "count": 1, "every": every, "linear": false, "hold": o.hold, "steps": steps})
}

/// The arrays world `id`'s outputs write in `scene` from its bake's `reply`: each `<body>#*`
/// output's, named `<world>.<output>.pos` and `.rot`, from `bodies` (each body's state after each
/// step from step 0, `pos` and `rot`), in its instancer's frame (#2288: `frames`); and (#2248)
/// each output's to a readout, an item its `to` names by its ID, from what the output writes at
/// each frame.
pub fn arrays(id: &str, w: &World, scene: &Value, reply: &Value) -> Map<String, Value> {
    let bodies = &reply["bodies"];
    let mut out = Map::new();
    let rate = reply["outputs"]["frame_rate"].as_str();
    let frame = rate.and_then(|r| crate::bake::frame_rate(&json!(r)).ok());
    for (oid, o) in &w.outputs {
        if let (Some(to), Some((_, every))) = (&o.to, &frame) {
            if scene["items"].get(to).is_some() {
                let frames = crate::reading::frames(reply, oid);
                out.insert(format!("{id}.{oid}.value"), readout(o, frames, *every));
            }
        }
        let body = o.from.strip_suffix("#*");
        let item = o.to.as_deref().and_then(|t| t.strip_prefix("items/"));
        let (Some(body), Some(item)) = (body, item) else {
            continue;
        };
        let rows: Vec<&Vec<Value>> = element_ids(scene, item)
            .iter()
            .filter_map(|e| bodies[format!("{body}#{e}")].as_array())
            .collect();
        let count = rows.iter().map(|s| s.len()).min().unwrap_or(0);
        let frame = &reply["frames"][item];
        for (part, ty, _) in COLUMNS {
            let (mut prev, mut steps) = (Vec::new(), Vec::new());
            for k in 0..count {
                let now: Vec<Value> = rows.iter().map(|s| local(&s[k], part, frame)).collect();
                let ranges = changed(&prev, &now);
                if !ranges.is_empty() {
                    let values: Vec<Value> = ranges
                        .iter()
                        .map(|[a, b]| json!([a, now[*a as usize..*b as usize]]))
                        .collect();
                    steps.push(json!({"step": k, "changed": ranges, "values": values}));
                }
                prev = now;
            }
            let array = json!({"type": ty, "count": rows.len(), "every": step_flicks(w),
                               "linear": false, "hold": o.hold, "steps": steps});
            out.insert(format!("{id}.{oid}.{part}"), array);
        }
    }
    out
}

/// Each row of `array` after step `k`: every step at or before it applied in turn.
fn fold(array: &Value, k: i64, width: usize) -> Vec<Vec<f64>> {
    let n = array["count"].as_u64().unwrap_or(0) as usize;
    let mut rows = vec![vec![0.0; width]; n];
    for s in array["steps"].as_array().into_iter().flatten() {
        if s["step"].as_i64().is_none_or(|step| step > k) {
            break;
        }
        for run in s["values"].as_array().into_iter().flatten() {
            let start = run[0].as_u64().unwrap_or(0) as usize;
            for (j, v) in run[1].as_array().into_iter().flatten().enumerate() {
                if let (Some(row), Some(v)) = (rows.get_mut(start + j), v.as_array()) {
                    *row = v.iter().filter_map(Value::as_f64).collect();
                }
            }
        }
    }
    rows
}

/// `array`'s rows as a frame at `t` (flicks) shows them: step k's where t is on it or the array
/// holds, else lerped (nlerped for a rotation) toward step k + 1's, each value an f32.
fn at(array: &Value, t: i64, width: usize) -> Vec<Value> {
    let every = array["every"].as_i64().unwrap_or(1).max(1);
    let (k, rem) = (t.div_euclid(every), t.rem_euclid(every));
    let a = fold(array, k, width);
    let last = array["steps"]
        .as_array()
        .and_then(|s| s.last()?["step"].as_i64());
    if rem == 0 || array["hold"] == json!(true) || last.is_none_or(|l| l <= k) {
        return a.into_iter().map(|r| json!(r)).collect();
    }
    let b = fold(array, k + 1, width);
    let alpha = rem as f64 / every as f64;
    a.iter()
        .zip(&b)
        .map(|(x, y)| {
            let dot: f64 = x.iter().zip(y).map(|(p, q)| p * q).sum();
            let sign = if width == 4 && dot < 0.0 { -1.0 } else { 1.0 };
            let mut v: Vec<f64> = x
                .iter()
                .zip(y)
                .map(|(p, q)| p + alpha * (sign * q - p))
                .collect();
            let len = deep_canvas::ops::sqrt(v.iter().map(|c| c * c).sum::<f64>());
            if width == 4 && len > 0.0 {
                v.iter_mut().for_each(|c| *c /= len);
            }
            json!(v.iter().map(|c| f64::from(*c as f32)).collect::<Vec<_>>())
        })
        .collect()
}

/// Whether a world of `form` writes an instancer's columns or a readout's value, or draws a soft
/// body through a skin (#524: skin.rs).
pub fn writes(form: &Value) -> bool {
    outputs(form).next().is_some() || crate::skin::writes(form)
}

/// Each output of `form`'s worlds that writes an item's params: its world's ID, its own and the
/// item's, a `<body>#*` output's instancer (`true`) or (#2248) the readout its `to` names.
fn outputs(form: &Value) -> impl Iterator<Item = (&str, &str, &str, bool)> {
    let worlds = form
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    worlds.flat_map(move |(id, w)| {
        let outputs = w
            .get("outputs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten();
        outputs.filter_map(move |(oid, o)| {
            let to = o["to"].as_str()?;
            let each = o["from"].as_str().is_some_and(|f| f.ends_with("#*"));
            let item = match each {
                true => to.strip_prefix("items/")?,
                false => Some(to).filter(|to| form["items"].get(to).is_some())?,
            };
            Some((id.as_str(), oid.as_str(), item, each))
        })
    })
}

/// #2248: what a readout's array holds at `t`: its frame's value, mixed toward the next frame's
/// unless it holds; one number as a number.
fn value_at(array: &Value, t: i64) -> Value {
    let every = array["every"].as_i64().unwrap_or(1).max(1);
    let (k, rem) = (t.div_euclid(every), t.rem_euclid(every));
    let ty = WIDTHS.iter().position(|ty| array["type"] == *ty);
    let width = ty.map_or(1, |i| i + 1);
    let row = |k: i64| fold(array, k, width).into_iter().next().unwrap_or_default();
    let mut v = row(k);
    if rem != 0 && array["hold"] != json!(true) {
        let alpha = rem as f64 / every as f64;
        for (x, y) in v.iter_mut().zip(row(k + 1)) {
            *x += alpha * (y - *x);
        }
    }
    match v.as_slice() {
        [x] => json!(x),
        v => json!(v),
    }
}

/// `form` with each instancer column its worlds' outputs write set to its value at `t`, from the
/// form's `arrays` (baked by [`arrays`]); every other column stays the instancer's own. Each
/// skin's item is drawn at `t` too (#524: skin.rs), and (#2248) each readout an output's `to`
/// names takes the value it writes at `t` as its `value`, which its template's slot `{value}`
/// shows, or `{value/<i>}` its part i.
pub fn write(form: &mut Value, t: i64) {
    crate::skin::write(form, t);
    readouts(form, t);
    let mut cols = Vec::new();
    for (id, oid, item, each) in outputs(form) {
        for (part, _, width) in COLUMNS.iter().filter(|_| each) {
            if let Some(array) = form.pointer(&format!("/arrays/{id}.{oid}.{part}")) {
                cols.push((item.to_string(), *part, Value::Array(at(array, t, *width))));
            }
        }
    }
    for (item, part, rows) in cols {
        if let Some(params) = form.pointer_mut(&format!("/items/{item}/params")) {
            params[part] = rows;
        }
    }
}

/// #2248: `form` with each readout an output's `to` names holding the value it writes at `t`,
/// alone: what a host that draws a scene's overlays from its form writes before it draws.
pub fn readouts(form: &mut Value, t: i64) {
    let at = |(id, oid, item, each): (&str, &str, &str, bool)| {
        let array = form.pointer(&format!("/arrays/{id}.{oid}.value"));
        Some((item.to_string(), value_at(array.filter(|_| !each)?, t)))
    };
    let values: Vec<(String, Value)> = outputs(form).filter_map(at).collect();
    for (item, value) in values {
        if let Some(params) = form.pointer_mut(&format!("/items/{item}/params")) {
            params["value"] = value;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #2248: an output to a readout, an item its `to` names by ID, writes the readout's `value`
    /// at each frame from its bake's series: the frame's own on a frame, the two around it mixed
    /// between them, or the earlier with `hold`; an item no output names takes nothing.
    #[test]
    fn a_readout_takes_what_its_output_writes_at_the_frame() {
        let world = |interpolate: &str| {
            json!({"kind": "physics.world@1",
            "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.1}}, "contact_materials": {"m": {"density": 100}},
            "bodies": {"ball": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}]}},
            "outputs": {"fall": {"from": "ball", "read": "velocity", "to": "vy", "interpolate": interpolate},
                        "pace": {"from": "ball", "read": "speed", "to": "gone"}}})
        };
        let frame = 11_760_000;
        let reply = json!({"outputs": {"frame_rate": "60/1", "series": {
            "fall": [[0.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, -1.0, 0.0], [0.0, -3.0, 0.5]],
            "pace": [0.0, 1.0, 1.0, 3.0]}}});
        let shown = |interpolate: &str, t: i64| {
            let doc = world(interpolate);
            let w = crate::doc::read(&doc).expect("the world reads");
            let mut form = json!({"worlds": {"rig": doc}, "items": {"vy": {"params": {}}, "other": {"params": {}}}});
            assert!(writes(&form), "an output names the readout");
            let arrays = arrays("rig", &w, &form, &reply);
            assert_eq!(arrays.keys().collect::<Vec<_>>(), ["rig.fall.value"]);
            form["arrays"] = Value::Object(arrays);
            write(&mut form, t);
            assert_eq!(form["items"]["other"]["params"], json!({}));
            form["items"]["vy"]["params"]["value"].clone()
        };
        assert_eq!(shown("linear", 0), json!([0.0, 0.0, 0.0]));
        assert_eq!(shown("linear", 3 * frame), json!([0.0, -3.0, 0.5]));
        assert_eq!(
            shown("linear", 2 * frame + frame / 2),
            json!([0.0, -2.0, 0.25])
        );
        assert_eq!(
            shown("hold", 2 * frame + frame / 2),
            json!([0.0, -1.0, 0.0])
        );
    }
}
