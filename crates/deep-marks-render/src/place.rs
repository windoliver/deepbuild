//! Issue #221: placement by relation where this crate evaluates a document. Each frame the
//! document is evaluated at t, then marks2d's relations move every placed item from the boxes
//! its items take as this crate draws them: marks2d's geometry, each text as the shaper sets it
//! (a bound value at its `widest`), and each vector's imported outlines.

use std::collections::BTreeMap;

use deep_canvas_marks::lines;
use deep_canvas_marks::relations::{self, Bounds, Box4, Frame, Ops};
use deep_canvas_marks::scene::{self, object_or_empty};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, TRANSFORM};
use serde_json::{json, Map, Value};

use crate::Vectors;

/// The boxes items take as this crate draws them.
struct Measured<'a> {
    vectors: &'a Vectors,
    /// What each bound value, counter and template shows; a live number is measured at its
    /// `widest`.
    shown: BTreeMap<String, scene::Shown>,
}

impl Measured<'_> {
    fn shaped(
        &self,
        id: &str,
        params: &Map<String, Value>,
    ) -> Option<std::sync::Arc<deep_text::Shaped>> {
        let shown = self.shown.get(id);
        let mut spec = scene::text_spec(id, params, shown).ok()?;
        if let (Some(_), Some(w)) = (shown, params.get("widest").and_then(Value::as_str)) {
            spec.text = w.to_string();
        }
        Some(deep_text_gpui::shape(&crate::status::label_of(&spec)?))
    }
}

impl Bounds for Measured<'_> {
    fn own(&mut self, id: &str, item: &Value, part: Option<&str>) -> Option<Box4> {
        if let Some(found) = self.vectors.get(id) {
            return deep_canvas_vector::bounds(item, found, part);
        }
        let kind = item.get("kind").and_then(Value::as_str)?;
        let params = object_or_empty(item.get("params"));
        // #1966: a text's line or token, `<id>#line:n` or `<id>#tok:k`, in its shaped run.
        if let Some(part) = part {
            if kind != "text@1" {
                return None;
            }
            let local = lines::anchor_box(params, &*self.shaped(id, params)?, part)?;
            return Some(relations::placed(local, relations::place_of(item, None)));
        }
        if kind == "text@1" {
            let shaped = self.shaped(id, params)?;
            let w = params
                .get("box")
                .and_then(|b| b.get("w"))
                .and_then(Value::as_f64)
                .unwrap_or(f64::from(shaped.width));
            let local = [0.0, 0.0, w, f64::from(shaped.height)];
            return Some(relations::placed(local, relations::place_of(item, None)));
        }
        let local = relations::own_box(kind, params)?;
        Some(relations::placed(
            local,
            relations::place_of(item, Some(local)),
        ))
    }

    fn baseline(&mut self, id: &str, item: &Value) -> Option<f64> {
        if item.get("kind").and_then(Value::as_str) != Some("text@1") {
            return None;
        }
        let shaped = self.shaped(id, object_or_empty(item.get("params")))?;
        let (_, offset) = relations::place_of(item, None);
        Some(offset[1] + f64::from(shaped.glyphs.first()?.y))
    }
}

/// The geometry box of the item `id` among evaluated `items`, where it draws: its own, or for
/// an item with none of its own (a group) its descendants' joined; and (#1965, #1966) for a
/// text's anchor, `<id>#line:n` or a code item's `<id>#tok:k`, that line's or token's.
pub(crate) fn box_of(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    vectors: &Vectors,
    id: &str,
) -> Option<Box4> {
    let mut measured = measured(doc, items, vectors);
    let Some(item) = items.get(id) else {
        let (id, part) = id.split_once('#')?;
        return measured.own(id, items.get(id)?, Some(part));
    };
    if let Some(b) = measured.own(id, item, None) {
        return Some(b);
    }
    let mut out: Option<Box4> = None;
    let mut under = vec![id.to_string()];
    while let Some(at) = under.pop() {
        for (cid, c) in items {
            if c.get("parent").and_then(Value::as_str) == Some(at.as_str()) {
                if let Some(b) = measured.own(cid, c, None) {
                    out = Some(match out {
                        None => b,
                        Some(a) => {
                            let (x0, y0) = (a[0].min(b[0]), a[1].min(b[1]));
                            let x1 = (a[0] + a[2]).max(b[0] + b[2]);
                            let y1 = (a[1] + a[3]).max(b[1] + b[3]);
                            [x0, y0, x1 - x0, y1 - y0]
                        }
                    });
                }
                under.push(cid.clone());
            }
        }
    }
    out
}

fn measured<'a>(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    vectors: &'a Vectors,
) -> Measured<'a> {
    Measured {
        vectors,
        shown: scene::bound_texts(doc, items, &scene::Record::default()).unwrap_or_default(),
    }
}

/// Whether any item of `doc` is placed by relation.
fn places(doc: &Map<String, Value>) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| {
            items.values().any(|i| {
                i.get("at")
                    .is_some_and(|a| a.get("place").is_some() || a.get("align").is_some())
            })
        })
}

/// A refusal of the relations as a drawing command answers it, a cycle with its chain.
pub(crate) fn refusal(r: relations::Refusal) -> Value {
    let mut out = json!({"ok": false, "code": r.code, "path": r.path});
    if !r.chain.is_empty() {
        out["chain"] = json!(r.chain);
    }
    out
}

/// `doc` evaluated at `t` as `program`, its placed items moved by their relations.
pub(crate) fn evaluated(
    doc: &Map<String, Value>,
    program: &Program,
    t: i64,
    vectors: &Vectors,
) -> Result<Map<String, Value>, Value> {
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    let mut items = eval::items(doc, program, &state);
    lagged(doc, program, t, &mut items);
    if !places(doc) {
        return Ok(items);
    }
    // Each item's own `at.pos` at t, before its parents: what a relation adds after it.
    let mut local = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut local);
    let offsets: BTreeMap<String, [f64; 2]> = program
        .items
        .iter()
        .enumerate()
        .map(|(i, id)| {
            (
                id.clone(),
                [local.slots[i * TRANSFORM], local.slots[i * TRANSFORM + 1]],
            )
        })
        .collect();
    let mut measured = measured(doc, &items, vectors);
    relations::place(
        &mut items,
        &offsets,
        Frame::of(doc),
        &mut measured,
        &mut Ops::default(),
    )
    .map_err(refusal)?;
    Ok(items)
}

/// Issue #160: an item whose ops hold a lagging repeater carries its earlier selves, the item as
/// the same program evaluates it k × lag earlier for each copy k from 1, under
/// [`scene::LAGGED`], so copy k's children evaluate at t − k × lag, as an echo's do.
fn lagged(doc: &Map<String, Value>, program: &Program, t: i64, items: &mut Map<String, Value>) {
    let wanted: Vec<(String, i64, usize)> = items
        .iter()
        .filter_map(|(id, item)| {
            let params = object_or_empty(item.get("params"));
            let ops = deep_canvas_marks::pathops::read(params.get("ops"), "").ok()?;
            let (_, r) = deep_canvas_marks::pathops::lagged_repeater(&ops)?;
            Some((id.clone(), r.lag, r.copies.ceil() as usize))
        })
        .collect();
    for (id, lag, copies) in wanted {
        let mut earlier = Vec::with_capacity(copies.saturating_sub(1));
        for k in 1..copies {
            let back = k as i64 * lag;
            let mut state = program.state();
            program.evaluate(t - back, eval::Validity::Full, &mut state);
            let then = eval::items(doc, program, &state);
            if let Some(it) = then.get(&id) {
                earlier.push(it.clone());
            }
        }
        if let Some(Value::Object(params)) = items.get_mut(&id).and_then(|i| i.get_mut("params")) {
            params.insert(scene::LAGGED.to_string(), Value::Array(earlier));
        }
    }
}
