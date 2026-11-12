//! #1921: what a world's `<body>#*` outputs write into its scene. Such an output reads every
//! element body of an `each:` body and writes each one's pose into its row of an instancer's `pos`
//! and `rot` columns as f32, rows in the instancer's own row order, so hundreds of bodies stay one
//! instanced draw. Its bake goes into the form's `arrays` as the core's column view takes a
//! world's array, each step with the rows it changed; a frame folds them at its time by Physics
//! output's rule (positions lerp and rotations nlerp between the two buffered steps, or the
//! earlier with `hold`), from the bake alone, so a seek writes what play does.

use serde_json::{json, Map, Value};

use crate::doc::World;
use crate::module::changed;
use crate::occurrence::step_flicks;

/// An instancer's two columns an output writes, with each one's width.
const COLUMNS: [(&str, &str, usize); 2] = [("pos", "vec3", 3), ("rot", "quat", 4)];

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

/// The arrays world `id`'s `<body>#*` outputs write, named `<world>.<output>.pos` and `.rot`,
/// from its bake's `bodies` (each body's state after each step from step 0, `pos` and `rot`).
pub fn arrays(id: &str, w: &World, scene: &Value, bodies: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    for (oid, o) in &w.outputs {
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
        for (part, ty, _) in COLUMNS {
            let (mut prev, mut steps) = (Vec::new(), Vec::new());
            for k in 0..count {
                let now: Vec<Value> = rows.iter().map(|s| s[k][part].clone()).collect();
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
            let len = v.iter().map(|c| c * c).sum::<f64>().sqrt();
            if width == 4 && len > 0.0 {
                v.iter_mut().for_each(|c| *c /= len);
            }
            json!(v.iter().map(|c| f64::from(*c as f32)).collect::<Vec<_>>())
        })
        .collect()
}

/// Whether a world of `form` writes an instancer's columns.
pub fn writes(form: &Value) -> bool {
    outputs(form).next().is_some()
}

/// Each `<body>#*` output of `form`'s worlds: its world's ID, its own and its instancer's.
fn outputs(form: &Value) -> impl Iterator<Item = (&str, &str, &str)> {
    let worlds = form
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    worlds.flat_map(|(id, w)| {
        let outputs = w
            .get("outputs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten();
        outputs.filter_map(move |(oid, o)| {
            o["from"].as_str().filter(|f| f.ends_with("#*"))?;
            Some((
                id.as_str(),
                oid.as_str(),
                o["to"].as_str()?.strip_prefix("items/")?,
            ))
        })
    })
}

/// `form` with each instancer column its worlds' outputs write set to its value at `t`, from the
/// form's `arrays` (baked by [`arrays`]); every other column stays the instancer's own.
pub fn write(form: &mut Value, t: i64) {
    let mut cols = Vec::new();
    for (id, oid, item) in outputs(form) {
        for (part, _, width) in COLUMNS {
            if let Some(array) = form.pointer(&format!("/arrays/{id}.{oid}.{part}")) {
                cols.push((item.to_string(), part, at(array, t, width)));
            }
        }
    }
    for (item, part, rows) in cols {
        if let Some(params) = form.pointer_mut(&format!("/items/{item}/params")) {
            params[part] = Value::Array(rows);
        }
    }
}
