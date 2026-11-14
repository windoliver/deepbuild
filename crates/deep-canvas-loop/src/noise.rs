//! `render.noise` (#1938; canvas primitives: Check input: loop kinds): each item that holds still
//! drawn twice, a frame apart, and the variance of the two draws' difference over its flat px,
//! those whose pick and four neighbours' are its own in both. A fill keyed to the frame differs
//! px by px; a fade moves every px alike, so its difference has no variance; and an item whose
//! px differ between the draws moves, and is left out. Its fix is a still copy of what is
//! reseeded, named in its place, as patch ops.

use std::collections::BTreeMap;

use deep_canvas::registry::{Frame, Raised, Report};
use serde_json::{json, Map, Value};

use crate::pixels::{self, encoded_luminance};
use crate::scene::blocked;

pub const KIND: &str = "render.noise";
pub const CODE: &str = "loop.noise";

/// The flat variance a still may show where the brief gives none: one display step, squared.
const VARIANCE_MAX: f64 = 1.0 / (255.0 * 255.0);

/// One item's flat px: their count, the variance of the two draws' encoded-luma difference,
/// and whether it covers the same px in both.
struct Flat {
    px: usize,
    variance: f64,
    still: bool,
}

/// Each pick's flat px in draws `a` and `b` of one time, by pick.
fn flats(a: &Frame, b: &Frame) -> BTreeMap<u32, Flat> {
    let w = a.size[0] as usize;
    let h = a.size[1] as usize;
    // A pick that covers a px in one draw and not the other moved between them.
    let mut moved: std::collections::BTreeSet<u32> = Default::default();
    for (p, q) in a.ids.iter().zip(&b.ids).filter(|(p, q)| p != q) {
        moved.insert(*p);
        moved.insert(*q);
    }
    let mut sums: BTreeMap<u32, (usize, f64, f64)> = Default::default();
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let i = y * w + x;
            let p = a.ids[i];
            let flat = p != 0
                && [i, i - 1, i + 1, i - w, i + w]
                    .iter()
                    .all(|&j| a.ids[j] == p && b.ids[j] == p);
            if !flat {
                continue;
            }
            let d = encoded_luminance(pixels::shown(a, i)) - encoded_luminance(pixels::shown(b, i));
            let e = sums.entry(p).or_default();
            *e = (e.0 + 1, e.1 + d, e.2 + d * d);
        }
    }
    sums.into_iter()
        .map(|(p, (n, s, s2))| {
            let mean = s / n as f64;
            // Var(a − b) is twice each draw's own.
            let variance = (s2 / n as f64 - mean * mean).max(0.0) / 2.0;
            (p, Flat { px: n, variance, still: !moved.contains(&p) })
        })
        .collect()
}

/// The driver or channel that writes a seed of `item`'s, or of the material it names: the item
/// it writes and its path.
fn reseeded(doc: &Value, item: &str) -> Option<(String, String)> {
    let material = doc.pointer(&format!("/items/{item}/material")).and_then(Value::as_str);
    ["drivers", "channels"]
        .iter()
        .filter_map(|k| doc.get(*k).and_then(Value::as_object))
        .flat_map(Map::values)
        .filter_map(|d| d.get("target").or(Some(d)).and_then(Value::as_str))
        .find_map(|target| {
            let rest = target.strip_prefix("items/")?;
            let (id, path) = rest.split_once('/')?;
            let seed = path.rsplit('/').next().is_some_and(|f| f.contains("seed"));
            (seed && (id == item || Some(id) == material)).then(|| (id.to_string(), path.to_string()))
        })
}

/// A copy of the item `of` that no driver or channel writes, under a fresh ID: its params as the
/// document holds them, so at one seed.
fn copy_of(doc: &Value, of: &str) -> Option<(String, Map<String, Value>)> {
    let mut copy = doc.pointer(&format!("/items/{of}"))?.as_object()?.clone();
    let id = (1..)
        .map(|k| format!("{of}-still{}", if k == 1 { String::new() } else { k.to_string() }))
        .find(|id| doc.pointer(&format!("/items/{id}")).is_none())?;
    copy.insert("id".into(), json!(id));
    copy.remove("layer");
    if let Some(name) = copy.get("name").and_then(Value::as_str) {
        copy.insert("name".into(), json!(format!("{name}, still")));
    }
    Some((id, copy))
}

/// The fix for `item`'s fill, reseeded where `source` names: a still copy named in its place.
/// A reseeded material: the item names a still copy of it. A reseeded item: a still copy of it
/// drawn just after it, and the item hidden, since a patch reaches no driver or channel.
fn still(doc: &Value, item: &str, source: &str) -> Option<Vec<Value>> {
    let (id, mut copy) = copy_of(doc, source)?;
    if source != item {
        return Some(vec![
            json!({"op": "create", "item": copy}),
            json!({"op": "set", "id": item, "path": format!("items/{item}/material"), "value": id}),
        ]);
    }
    if let Some(order) = copy.get("order").and_then(Value::as_str) {
        copy.insert("order".into(), json!(format!("{order}V")));
    }
    Some(vec![
        json!({"op": "create", "item": copy}),
        json!({"op": "set", "id": item, "path": format!("items/{item}/visible"), "value": false}),
    ])
}

pub fn report(lowered: &Value, input: &Value, frames: &[Frame]) -> Report {
    let mut out = Report::default();
    if frames.len() < 2 || !frames.iter().all(pixels::whole) {
        out.blocked.push(blocked("not_drawn", KIND, &[], "frames"));
        return out;
    }
    // The design gives no default: the brief's, else one display step.
    let max = crate::number(input, "/flat_variance_max", VARIANCE_MAX);
    let mut done: Vec<String> = Vec::new();
    let mut judged = false;
    for pair in frames.chunks(2) {
        let [a, b] = pair else { continue };
        for (pick, flat) in flats(a, b) {
            let Some(item) = a.picks.get(&pick) else { continue };
            let base = item.split('#').next().unwrap_or(item).to_string();
            out.results.push(json!({"t": a.t, "item": item, "flat_px": flat.px, "variance": flat.variance,
                                    "max": max, "still": flat.still}));
            if !flat.still || flat.px == 0 {
                continue;
            }
            judged = true;
            if flat.variance <= max || done.contains(&base) {
                continue;
            }
            done.push(base.clone());
            let source = reseeded(lowered, &base);
            let fix_ops = source
                .as_ref()
                .and_then(|(of, _)| still(lowered, &base, of));
            let what = match &source {
                Some((id, path)) => format!(
                    "{base}'s flat px vary {:.2e} between frames, past {max:.2e}: `{path}` of {id} is written each frame; keep one seed",
                    flat.variance
                ),
                None => format!(
                    "{base}'s flat px vary {:.2e} between frames, past {max:.2e}: a fill reseeds with the frame",
                    flat.variance
                ),
            };
            let raised = Raised {
                code: CODE,
                severity: "error",
                path: source
                    .as_ref()
                    .map(|(id, path)| format!("items/{id}/{path}"))
                    .unwrap_or_else(|| format!("items/{base}")),
                what,
                fix_ops,
            };
            let actual = json!({"t": a.t, "variance": flat.variance, "max": max, "flat_px": flat.px,
                                "reseeded": source.map(|(id, path)| format!("items/{id}/{path}"))});
            out.raised.push((base, raised, actual));
        }
    }
    if !judged {
        // No item held still with flat px: nothing was read.
        out.blocked.push(blocked("not_flat", KIND, &[], "frames"));
    }
    out
}
