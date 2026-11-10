//! `logic.judder`, an issue at check (#545): a write declared `hold` on an f64, vec2, vec3 or quat
//! array that a pose reader draws (a shot's `move: logic`, an instancer's `pos` or `rot` column,
//! a skinned item's `pose`), in a logic item that steps slower than the rate it's drawn at, repeats
//! and then jumps on screen. The issue names the item, the array, the reader and both rates; the
//! brief's `hold: [array]` marks one as meant. It changes no write and no draw.

use serde_json::{json, Value};

use crate::piece::Piece;
use crate::{Planted, F};

/// The rate a piece is drawn at: a live piece's fastest display the brief names, else 120 Hz;
/// any other piece's document frame rate, 60 Hz by default.
fn frame_rate(raw: &Value) -> f64 {
    if raw.get("live").and_then(Value::as_bool) == Some(true) {
        let displays = raw.pointer("/brief/displays").and_then(Value::as_array);
        return displays
            .into_iter()
            .flatten()
            .filter_map(Value::as_f64)
            .reduce(f64::max)
            .unwrap_or(120.0);
    }
    match raw
        .pointer("/transport/frame_rate")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        Some([p, q]) => p.as_f64().zip(q.as_f64()).map_or(60.0, |(p, q)| p / q),
        _ => 60.0,
    }
}

/// The array paths a reader draws as a pose.
fn poses(reader: &Value, planted: &Planted) -> Vec<String> {
    let s = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    let mut out: Vec<String> = Vec::new();
    match reader.get("kind").and_then(Value::as_str) {
        Some("shot") => {
            let logic = reader.pointer("/move/logic").and_then(Value::as_object);
            out.extend(logic.into_iter().flatten().filter_map(|(_, v)| s(Some(v))));
        }
        _ if planted.judder_checks_shots_only => {}
        Some("instance@1") => {
            for c in ["pos", "rot"] {
                out.extend(s(reader.pointer(&format!("/columns/{c}/array"))));
            }
        }
        _ => out.extend(s(reader.get("pose"))),
    }
    out.dedup();
    out
}

/// The piece's `logic.judder` issues, one per (array, reader), in reader order.
pub fn issues(piece: &Piece, raw: &Value, planted: &Planted) -> Vec<Value> {
    let rate = frame_rate(raw);
    let hold: Vec<&str> = raw
        .pointer("/brief/hold")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let mut out = Vec::new();
    for (id, reader) in raw
        .get("readers")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        for path in poses(reader, planted) {
            let Some((item_id, name)) = path.split_once('.') else {
                continue;
            };
            let Some(item) = piece.items.iter().find(|i| i.id == item_id) else {
                continue;
            };
            let Some(w) = item.writes.iter().find(|w| w.name == name) else {
                continue;
            };
            let hz = F as f64 / item.step as f64;
            if !w.linear && w.ty.blends() && hz < rate && !hold.contains(&name) {
                out.push(json!({"kind": "logic.judder", "item": item.id, "array": path, "reader": id,
                    "step_rate": hz, "frame_rate": rate,
                    "what": format!("{path} is held at {hz} Hz and drawn by {id} at {rate} Hz: it repeats, then jumps; declare it interpolate: linear, or list it in the brief's hold")}));
            }
        }
    }
    out
}
