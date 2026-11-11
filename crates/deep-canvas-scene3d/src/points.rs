//! #537 (Marks in 3D: lines): a `mark.line`'s `points` may read a piece's logic array, `{array:
//! <logic>.<name>, rows: [from, to] | all}`, a vec3 array's elements in order through the core's
//! column view, as the logic module gives it at t. The point count is fixed at check from the
//! array's count; an element that can't narrow to f32 hides the segments that meet it and raises
//! `column.out_of_range`, while every segment keeps its record, so only the rows a step changed
//! upload.

use deep_canvas::camera::Vec3;
use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};

use crate::arrays::{self, Reader};
use crate::scene::Refused;

/// The planted reader that takes the previous step's array (#537 criterion 3).
pub const PREVIOUS_STEP: &str = "line_reads_previous_step";

/// `params` with a 3D line's `fog: bool` (Marks in 3D: true for a line), which a scene's live line
/// sets false so its color stays its own.
pub(crate) fn params(mut params: Vec<crate::spec::P>) -> Vec<crate::spec::P> {
    params.push(crate::spec::P {
        name: "fog",
        ty: "bool",
        unit: "",
        default: json!(true),
        min: None,
        max: None,
        class: "shading",
        sweep: (Value::Null, Value::Null),
    });
    params
}

/// The segments a mode draws over `n` points, as index pairs (Marks in 3D: lines).
pub fn segments(mode: &str, n: usize) -> Option<Vec<(usize, usize)>> {
    if n < 2 {
        return Some(Vec::new());
    }
    match mode {
        "strip" => Some((0..n - 1).map(|k| (k, k + 1)).collect()),
        "segments" => Some((0..n / 2).map(|k| (2 * k, 2 * k + 1)).collect()),
        "loop" => Some((0..n).map(|k| (k, (k + 1) % n)).collect()),
        _ => None,
    }
}

/// The reader of line `id` whose `points` read an array: its elements whole, each part narrowed
/// to f32.
pub(crate) fn readers(id: &str, params: &Value) -> Vec<Reader> {
    let points = &params["points"];
    if !arrays::is_array(points) {
        return Vec::new();
    }
    vec![Reader {
        name: "points".into(),
        path: format!("items/{id}/params/points"),
        column: json!({"array": points["array"], "as": "f32"}),
    }]
}

/// The ends of `line`'s segments that draw, which the scene's bounds hold.
pub(crate) fn ends(line: &crate::scene::Line) -> impl Iterator<Item = Vec3> + '_ {
    (line.segments.iter())
        .filter(|s| !s.hidden)
        .flat_map(|s| [s.a, s.b])
}

/// The rows a line's `points` read of an array of `count` elements: `[from, to)`, or every one.
fn rows(points: &Value, count: usize) -> Option<std::ops::Range<usize>> {
    match points.get("rows") {
        None | Some(Value::Null) => Some(0..count),
        Some(Value::String(s)) if s == "all" => Some(0..count),
        Some(Value::Array(r)) if r.len() == 2 => {
            let (a, b) = (r[0].as_u64()? as usize, r[1].as_u64()? as usize);
            (a <= b && b <= count).then_some(a..b)
        }
        _ => None,
    }
}

/// At check, a line's own rules over the array its points read: it holds vec3 elements, and its
/// `rows` lie within them.
pub(crate) fn check(id: &str, params: &Value, array: &Value) -> Vec<Issue> {
    let path = format!("items/{id}/params/points");
    let ty = array["type"].as_str().unwrap_or_default();
    if ty != "vec3" {
        return vec![Issue::error(
            "bad_column",
            id,
            format!("{path}/array"),
            json!({"array": params["points"]["array"], "type": ty}),
            "a line's points read a vec3 array",
        )];
    }
    let count = array["count"].as_u64().unwrap_or(0) as usize;
    match rows(&params["points"], count) {
        Some(_) => Vec::new(),
        None => vec![Issue::error(
            "out_of_range",
            id,
            format!("{path}/rows"),
            json!({"rows": params["points"].get("rows"), "count": count}),
            "a line's rows are [from, to) within its array's count, or all",
        )],
    }
}

/// Line `id`'s points at `t` where they read an array, each with whether it hides; `None` where
/// its points are written.
#[allow(clippy::type_complexity)]
pub(crate) fn of(
    map: &Map<String, Value>,
    id: &str,
    params: &Value,
    t: i64,
) -> Result<Option<(Vec<Vec3>, Vec<bool>)>, Refused> {
    let Some(r) = readers(id, params).pop() else {
        return Ok(None);
    };
    let m = arrays::at(map, &r, t)?;
    let refused = |field: &str| Refused {
        code: "out_of_range",
        path: format!("items/{id}/params/points/{field}"),
    };
    if m.per != 3 {
        return Err(refused("array"));
    }
    let rows = rows(&params["points"], m.hidden.len()).ok_or_else(|| refused("rows"))?;
    let points = rows
        .clone()
        .map(|i| [m.values[3 * i], m.values[3 * i + 1], m.values[3 * i + 2]])
        .collect();
    Ok(Some((points, rows.map(|i| m.hidden[i]).collect())))
}

/// The rows of the array line `id`'s points read in `doc` that its segments `uploaded` (by place)
/// join, in order: what a frame wrote of the array.
pub fn uploaded_rows(doc: &Value, id: &str, uploaded: &[u32]) -> Vec<u32> {
    let params = &doc["items"][id]["params"];
    let form = params["points"]["array"].as_str().unwrap_or_default();
    let count = doc["arrays"][form]["count"].as_u64().unwrap_or(0) as usize;
    let Some(rows) = rows(&params["points"], count) else {
        return Vec::new();
    };
    let mode = params["mode"].as_str().unwrap_or("strip");
    let pairs = segments(mode, rows.len()).unwrap_or_default();
    let mut out: Vec<u32> = (uploaded.iter())
        .filter_map(|s| pairs.get(*s as usize))
        .flat_map(|&(a, b)| [a, b])
        .map(|r| (rows.start + r) as u32)
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// The planted reader that takes the previous step's array: in `doc`, each array a line's points
/// read with every step one step later, so a frame at step k draws step k − 1's points.
pub fn plant_previous_step(doc: &mut Value) {
    let forms: Vec<String> = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i["kind"].as_str() == Some("mark.line@1"))
        .filter_map(|(_, i)| {
            i.pointer("/params/points/array")?
                .as_str()
                .map(str::to_string)
        })
        .collect();
    for form in forms {
        let steps = doc
            .get_mut("arrays")
            .and_then(|a| a.get_mut(&form))
            .and_then(|a| a.get_mut("steps"))
            .and_then(Value::as_array_mut);
        for s in steps.into_iter().flatten() {
            if let Some(k) = s["step"].as_i64() {
                s["step"] = json!(k + 1);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 64-element vec3 array in segments mode: 32 segments' ends; a NaN at element 7 hides
    /// element 7 alone, so only segment 3 (elements 6 and 7) hides; and the planted reader draws
    /// a step late.
    #[test]
    fn a_nan_hides_the_segment_that_meets_it_alone() {
        let values: Vec<Value> = (0..64)
            .map(|i| {
                if i == 7 {
                    json!([1.0, null, 0.0])
                } else {
                    json!([i, 0.5, -1.0])
                }
            })
            .collect();
        let mut doc = json!({
            "arrays": {"brain.ends": {"type": "vec3", "count": 64, "every": 10, "linear": false,
                "steps": [{"step": 0, "changed": [[0, 64]], "values": [[0, values]]},
                          {"step": 1, "changed": [[10, 12]], "values": [[10, [[100, 0, 0], [101, 0, 0]]]]}]}},
            "items": {"laser": {"kind": "mark.line@1", "params": {"mode": "segments",
                "points": {"array": "brain.ends", "rows": "all"}}}},
        });
        let params = doc["items"]["laser"]["params"].clone();
        let map = doc.as_object().expect("a document").clone();
        let (points, hidden) = of(&map, "laser", &params, 0)
            .expect("read")
            .expect("an array");
        assert_eq!(points.len(), 64);
        assert_eq!(points[5], [5.0, 0.5, -1.0]);
        assert_eq!(hidden.iter().filter(|h| **h).count(), 1);
        assert!(hidden[7]);
        let pairs = segments("segments", 64).expect("a mode");
        let hidden_segments: Vec<usize> = (0..pairs.len())
            .filter(|s| hidden[pairs[*s].0] || hidden[pairs[*s].1])
            .collect();
        assert_eq!(hidden_segments, vec![3]);
        let (now, _) = of(&map, "laser", &params, 10)
            .expect("read")
            .expect("an array");
        assert_eq!(now[10], [100.0, 0.0, 0.0]);
        plant_previous_step(&mut doc);
        let map = doc.as_object().expect("a document").clone();
        let (late, _) = of(&map, "laser", &params, 10)
            .expect("read")
            .expect("an array");
        assert_eq!(late[10], [10.0, 0.5, -1.0]);
    }
}
