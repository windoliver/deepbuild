//! Occurrence lists compiled at check from what a document reveals (#466; canvas primitives: Text
//! `text@1` `reveal.emits`, Path `path@1` `build.emits`, Spawn: variant and span): a text's
//! `<item>.reveal`, one row per unit at its reveal time, and a path's `<item>.build`, one row per
//! stroke over its span, so Spawn plays a blip per letter or a scrape per stroke from a list
//! baked before playback.

use serde_json::{json, Map, Value};

use crate::program::Program;

/// The list a revealed text `id` emits.
pub fn reveal_list(id: &str) -> String {
    format!("{id}.reveal")
}

/// Each `level`'s time: the first whole flick at which the reveal progress of text `id` reaches
/// it, searched through the program between the progress's key times (a reveal's progress is
/// keyed to run forward), never from a frame drawn. A level the progress never reaches is
/// `i64::MAX`; one it holds from the start is 0.
pub fn reveal_times(
    program: &Program,
    doc: &Map<String, Value>,
    id: &str,
    levels: &[f64],
) -> Vec<i64> {
    let reached: Vec<Box<dyn Fn(f64) -> bool + '_>> = levels
        .iter()
        .map(|l| Box::new(move |p: f64| p >= *l) as Box<dyn Fn(f64) -> bool>)
        .collect();
    first_reached(program, doc, id, &reached)
}

/// [`reveal_times`] for any rule of the progress a unit waits for: the first whole flick at which
/// `reached` holds of the progress, which runs forward.
fn first_reached(
    program: &Program,
    doc: &Map<String, Value>,
    id: &str,
    reached: &[Box<dyn Fn(f64) -> bool + '_>],
) -> Vec<i64> {
    let field = ["params", "reveal", "progress"].map(String::from);
    first_reached_at(program, doc, id, &field, reached)
}

/// [`first_reached`] of the progress at `field` of item `id`.
fn first_reached_at(
    program: &Program,
    doc: &Map<String, Value>,
    id: &str,
    field: &[String],
    reached: &[Box<dyn Fn(f64) -> bool + '_>],
) -> Vec<i64> {
    let Some(slot) = program.slot_of(id, field) else {
        let p = doc
            .get("items")
            .and_then(|i| i.get(id))
            .and_then(|i| i.pointer(&format!("/{}", field.join("/"))))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        return reached
            .iter()
            .map(|r| if r(p) { 0 } else { i64::MAX })
            .collect();
    };
    let mut state = program.state();
    let mut at = |t: i64| {
        program.evaluate(t, crate::eval::Validity::Full, &mut state);
        state.slots[slot]
    };
    let mut keys = program.slot_key_times(slot);
    keys.sort_unstable();
    keys.dedup();
    let (Some(&first), Some(&last)) = (keys.first(), keys.last()) else {
        return vec![i64::MAX; reached.len()];
    };
    reached
        .iter()
        .map(|r| {
            if r(at(first)) {
                return 0;
            }
            if !r(at(last)) {
                return i64::MAX;
            }
            let (mut lo, mut hi) = (first, last);
            while hi - lo > 1 {
                let mid = lo + (hi - lo) / 2;
                if r(at(mid)) {
                    hi = mid;
                } else {
                    lo = mid;
                }
            }
            hi
        })
        .collect()
}

/// Each list the document's revealed texts with `emits` compile: `<item>.reveal`, its rows
/// `{t, kind: "reveal", unit, grapheme}` in reading order, `t` the flick its unit's reveal passes
/// half (the rule `#head` reads). With `at_start` (#466's planted reveal) each row is where its
/// unit's reveal starts instead. A unit the progress never reaches emits no row.
pub fn reveal_lists(
    doc: &Map<String, Value>,
    program: &Program,
    at_start: bool,
) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return out;
    };
    for (id, item) in items {
        let emits = item.pointer("/params/reveal/emits") == Some(&Value::Bool(true));
        let Some(text) = item
            .pointer("/params/text")
            .and_then(Value::as_str)
            .filter(|_| emits)
        else {
            continue;
        };
        let units = deep_canvas_marks::animator::reveal_units(text);
        // A unit's opacity as the frame draws it, so a row and its glyph agree to the bit.
        let reached: Vec<Box<dyn Fn(f64) -> bool>> = units
            .iter()
            .map(|&(_, start, w)| {
                Box::new(move |p: f64| {
                    let share = ((p - start) / w).clamp(0.0, 1.0);
                    if at_start {
                        share > 0.0
                    } else {
                        share >= 0.5
                    }
                }) as Box<dyn Fn(f64) -> bool>
            })
            .collect();
        let times = first_reached(program, doc, id, &reached);
        let rows: Vec<Value> = units
            .iter()
            .zip(times)
            .enumerate()
            .filter(|(_, (_, t))| *t != i64::MAX)
            .map(|(k, ((g, _, _), t))| json!({"t": t, "kind": "reveal", "unit": k, "grapheme": g}))
            .collect();
        out.insert(reveal_list(id), Value::Array(rows));
    }
    out
}

/// Each list the document's built paths with `emits` compile: `<item>.build`, a row per stroke
/// `{t, end, kind: "build", stroke}` in the order they draw, `t` the flick its share of the build's
/// progress starts and `end` the flick it's drawn whole.
pub fn build_lists(doc: &Map<String, Value>, program: &Program) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return out;
    };
    for (id, item) in items {
        let params = item.get("params").and_then(Value::as_object);
        let Some(build) = params.and_then(|p| deep_canvas_marks::build::read(p).ok().flatten())
        else {
            continue;
        };
        let d = params.and_then(|p| p.get("d")).and_then(Value::as_str);
        let Some(verbs) = d
            .and_then(deep_canvas_marks::path::parse)
            .filter(|_| build.emits)
        else {
            continue;
        };
        let n = deep_canvas_marks::pathops::subs_of(&verbs).len();
        let spans = deep_canvas_marks::build::spans(n, build.seeded, id);
        let order = deep_canvas_marks::build::order(n, build.seeded, id);
        let field = ["params", "build", "progress"].map(String::from);
        let bounds: Vec<Box<dyn Fn(f64) -> bool>> = order
            .iter()
            .flat_map(|&k| {
                let (a, b) = spans[k];
                [
                    Box::new(move |p: f64| p > a) as Box<dyn Fn(f64) -> bool>,
                    Box::new(move |p: f64| p >= b) as Box<dyn Fn(f64) -> bool>,
                ]
            })
            .collect();
        let times = first_reached_at(program, doc, id, &field, &bounds);
        let rows: Vec<Value> = order
            .iter()
            .enumerate()
            .filter(|(k, _)| times[2 * k] != i64::MAX)
            .map(|(k, &stroke)| json!({"t": times[2 * k], "end": times[2 * k + 1], "kind": "build", "stroke": stroke}))
            .collect();
        out.insert(format!("{id}.build"), Value::Array(rows));
    }
    out
}

/// #155: each `markers.<kind>` list the document's markers compile (Marker; Spawn: variant and
/// span), so authored moments drive Spawn: a row per marker of that kind in flick order (ties by
/// ID), `{t, end, kind, a: its ID, tags}` and its payload's fields beside them, as Spawn reads a
/// row's fields. A spawn's `on.tags` filters them.
pub fn marker_lists(program: &Program) -> Map<String, Value> {
    let mut markers: Vec<&crate::doc::Marker> = program.motion.markers.iter().collect();
    markers.sort_by(|a, b| (a.start, &a.id).cmp(&(b.start, &b.id)));
    let mut out = Map::new();
    for m in markers {
        let mut row = match &m.payload {
            Value::Object(p) => p.clone(),
            _ => Map::new(),
        };
        row.extend([
            ("t".into(), json!(m.start)),
            ("end".into(), json!(m.end)),
            ("kind".into(), json!(m.kind)),
            ("a".into(), json!(m.id)),
            ("tags".into(), json!(m.tags)),
        ]);
        if let Value::Array(rows) = out
            .entry(format!("markers.{}", m.kind))
            .or_insert_with(|| Value::Array(Vec::new()))
        {
            rows.push(Value::Object(row));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;

    #[test]
    fn a_built_path_emits_a_row_per_stroke_over_its_share() {
        let doc = json!({"format": 1, "id": "b", "profile": "film", "size": [100, 100], "transport": {"span": "2s"},
            "items": {"p": {"id": "p", "kind": "path@1", "name": "P", "order": "a1",
                "params": {"d": "M 0 0 L 10 0 M 0 5 L 10 5", "build": {"progress": 0, "emits": true}}}},
            "channels": {"b": {"target": "items/p/params/build/progress", "type": "f32",
                "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "2s", "value": 1, "interp": "linear"}}}}});
        let map = doc.as_object().unwrap();
        let program = Program::compile(map).unwrap();
        let rows = build_lists(map, &program)["p.build"].clone();
        let rows = rows.as_array().unwrap();
        assert_eq!(rows.len(), 2);
        // Stroke 0 over the first second, stroke 1 over the second, within a flick of each.
        let near = |v: &Value, t: i64| (v.as_i64().unwrap() - t).abs() <= 1;
        assert!(near(&rows[0]["t"], 0) || rows[0]["t"] == 1, "{rows:?}");
        assert!(near(&rows[0]["end"], SECOND), "{rows:?}");
        assert!(near(&rows[1]["t"], SECOND), "{rows:?}");
        assert!(near(&rows[1]["end"], 2 * SECOND), "{rows:?}");
    }
}
