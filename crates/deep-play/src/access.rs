//! Issue #376: a document's accessibility read as data (Rules every primitive follows:
//! Accessible), shared by #1045 so the web player keeps the tree the app gives its accessibility
//! seam: the app's `see`, its live window and its playable page, and the player, call these same
//! functions. The tree has one node per part and control, each with its name and role, and a
//! readout's text is what a frame shows of it, so an announcement is made only where that text
//! differs from what was last said. The tree holds exactly the items that draw ([`draws`], less
//! what the view hides), so an item that doesn't draw is never in it or announced (Control: "no
//! control hits, focuses, picks or announces a row or element that doesn't draw"); decoration
//! draws but is nothing to hear of.

use std::collections::BTreeMap;

use deep_canvas::kinds::{lookup, registry, Lookup};
use deep_canvas::template;
use deep_canvas_marks::data::holds::{holds, Walk};
use deep_canvas_marks::data::BoundRows;
use deep_canvas_marks::scene::{bound_rows, Record};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

fn text(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
}

/// The 3D module's kinds, which a player set without scene3d (#1490) doesn't know.
#[cfg(feature = "scene3d")]
fn scene3d_kind(kind: &str) -> bool {
    // #1781: the fixture builder is a kind only where a test build registers it.
    (deep_canvas_scene3d::scene::is_3d(kind) && kind != deep_canvas_scene3d::attrs::FIXTURE)
        || kind == deep_canvas_scene3d::scene::OVERLAY
        || kind == deep_canvas_scene3d::inset::KIND
        || kind == deep_canvas_scene3d::views::KIND
}

#[cfg(not(feature = "scene3d"))]
fn scene3d_kind(_: &str) -> bool {
    false
}

/// Whether this build knows a kind: the marks module or scene3d draws it, or the kernel registers it.
pub fn knows(kind: &str) -> bool {
    deep_canvas_marks::scene::KINDS.contains(&kind)
        || scene3d_kind(kind)
        // A readout (#419), such as the overlay that discloses an exaggerated length (#1183).
        || kind == "overlay.text@1"
        // #506: an inset, and a view of the document from another camera in a rect of the frame.
        // The vector module's kind (#1162): an item the view draws, hears and points at.
        || kind == "vector@1"
        // A logic item (#544): baked at check into the occurrence lists its readers read; it draws nothing.
        || kind == "logic@1"
        || !matches!(lookup(&registry(), kind), Lookup::UnknownKind)
}

/// The items that draw: of a kind this build knows, visible, and every parent they name there.
/// An item whose parent is gone hides, and only it and what hangs from it.
pub fn draws(doc: &Value) -> Vec<String> {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut out: Vec<String> = items
        .iter()
        .filter(|(_, item)| {
            item.get("kind").and_then(Value::as_str).is_some_and(knows)
                && item.get("visible") != Some(&Value::Bool(false))
        })
        .filter(|(id, _)| {
            let mut at = id.as_str();
            for _ in 0..=items.len() {
                match items[at].get("parent").and_then(Value::as_str) {
                    None => return true,
                    Some(p) if items.contains_key(p) => at = p,
                    // #504: an item joins an assembly by naming it as its parent.
                    Some(p) => return doc.get("assemblies").and_then(|a| a.get(p)).is_some(),
                }
            }
            false
        })
        .map(|(id, _)| id.clone())
        .collect();
    out.sort();
    out
}

/// The items of `doc` an assistive client hears of, in reading order: the ones that draw, less
/// `hidden`, what the view hides, and less decoration. Reading order is flat, layers by their
/// `order` and then every item by its own, the fractional keys sorting by code point; the tree
/// doesn't nest a child under its parent.
fn heard<'a>(doc: &'a Value, hidden: &[String]) -> Vec<(&'a String, &'a Value)> {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return Vec::new();
    };
    let layer_order = |item: &Value| {
        let layer = item.get("layer").and_then(Value::as_str).unwrap_or("");
        text(doc.pointer(&format!("/layers/{layer}/order")))
    };
    let mut out: Vec<(&String, &Value)> = draws(doc)
        .iter()
        .filter(|id| !hidden.contains(id))
        .filter_map(|id| items.get_key_value(id))
        .filter(|(_, item)| {
            item.get("role")
                .and_then(Value::as_str)
                .unwrap_or("decoration")
                != "decoration"
        })
        .collect();
    out.sort_by_cached_key(|(id, item)| {
        (layer_order(item), text(item.get("order")), (*id).clone())
    });
    out
}

/// The accessibility tree of a document: its own node first (its title as the name, with its
/// description), then one node per item heard, in reading order, and then one per control,
/// named by its label and with its ARIA role.
///
/// A cell bound to a reading is one this has none for: its row doesn't draw where no record is.
pub fn tree(doc: &Value, hidden: &[String]) -> Vec<Value> {
    tree_with(doc, hidden, &Record::default())
}

/// [`tree`] as a host that holds `record` draws it: a set's bound cells with their readings.
pub fn tree_with(doc: &Value, hidden: &[String], record: &Record) -> Vec<Value> {
    let empty = Map::new();
    let readings = bound_rows(doc.as_object().unwrap_or(&empty), record);
    let unbound = BoundRows::new();
    let mut nodes = vec![json!({
        "id": text(doc.get("id")),
        "role": "document",
        "name": text(doc.get("title")),
        "description": text(doc.get("description")),
    })];
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in heard(doc, hidden) {
        // #505: a formula's accessible name is its source text (Vector and formula: `alt`).
        let alt = (item.get("kind").and_then(Value::as_str) == Some("vector@1"))
            .then(|| item.pointer("/params/alt"))
            .flatten();
        let name = text(alt.or(item.get("name")));
        let mut node = json!({"id": id, "role": item["role"], "name": name});
        // #3236: a mark set's or a series' node says what it holds, computed from what it draws.
        let bound = readings.get(id).unwrap_or(&unbound);
        if let Some(Ok((held, _))) =
            items.and_then(|all| holds(id, item, all, bound, Walk::Reading))
        {
            node["value"] = json!(held.text());
        }
        nodes.push(node);
    }
    // #504: a control's targets that draw follow it, each a button named by its option's or
    // stage's label, in the Tab order's reading order (Control: targets).
    let draws = draws(doc);
    let targets = deep_canvas::scope::pick_targets(doc, hidden);
    if let Some(controls) = doc.get("controls").and_then(Value::as_object) {
        for (id, control) in controls {
            nodes.push(json!({
                "id": id,
                "role": text(control.get("role")),
                "name": text(control.get("label")),
            }));
            for t in targets
                .iter()
                .filter(|t| &t.control == id && draws.contains(&t.item))
            {
                nodes.push(json!({"id": format!("{id}/{}", t.option), "role": "button", "name": t.label, "item": t.item}));
            }
        }
    }
    nodes
}

/// Every readout heard with what it says: a text item in the tree whose `template` fills from
/// the document's values (Text `text@1`; Overlay: "a readout and the parts it describes come
/// from one model"), expanded as the frame shows it.
pub fn readouts(doc: &Value, hidden: &[String]) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = heard(doc, hidden)
        .into_iter()
        .filter_map(|(id, item)| {
            let template = item.pointer("/params/template")?.as_str()?;
            let text = template::expand(doc, template).ok()?;
            Some((id.clone(), text))
        })
        .collect();
    // #504: a figure's card lines, read as its readouts are.
    for (field, t) in template::card_lines(doc) {
        if let Ok(text) = template::expand(doc, t) {
            out.insert(format!("card/{field}"), text);
        }
    }
    out
}

/// `doc` with the values that move its parts as they stand at `t` (data values a channel, a
/// driver or a stage writes, each assembly's value and each control's): what a readout's template
/// fills from in the frame that shows `t` (#1162, #504), the same values the 3D card draws.
pub fn data_at(doc: &Value, program: Option<&Program>, t: i64) -> Value {
    let (Some(program), Some(map)) = (program, doc.as_object()) else {
        return doc.clone();
    };
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    deep_canvas_motion::eval::shown_doc(map, program, &state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn figure(count: u32) -> Value {
        json!({
            "id": "doc-1", "title": "Lens", "description": "A lens.",
            "data": {"count": {"value": count, "source": "story"}},
            "layers": {"you": {"order": "a1"}, "agent": {"order": "a0"}},
            "items": {
                "lens": {"id": "lens", "kind": "rect@1", "layer": "you", "name": "Convex lens", "role": "part", "order": "a2"},
                "back": {"id": "back", "kind": "rect@1", "layer": "you", "name": "Backdrop", "role": "decoration", "order": "a0"},
                "beam": {"id": "beam", "kind": "rect@1", "layer": "you", "name": "Light beam", "role": "part", "order": "a1"},
                "rays": {"id": "rays", "kind": "rect@1", "layer": "you", "name": "Rays", "role": "part", "order": "a3", "parent": "beam"},
                "count": {"id": "count", "kind": "text@1", "layer": "you", "name": "Rays", "role": "data", "order": "a5",
                          "params": {"template": "Rays: {data/count}"}},
                "note": {"id": "note", "kind": "text@1", "layer": "you", "name": "Note", "role": "label", "order": "a6", "visible": false,
                         "params": {"template": "Also {data/count}"}},
                "scribble": {"id": "scribble", "kind": "rect@1", "layer": "agent", "name": "Agent's mark", "role": "part", "order": "a9"},
                "lost": {"id": "lost", "kind": "rect@1", "layer": "you", "name": "Orphan", "role": "part", "order": "a4", "parent": "gone"},
            },
            "controls": {"c-rays": {"kind": "slider", "label": "Number of rays", "role": "slider"}},
        })
    }

    fn ids(nodes: &[Value]) -> Vec<String> {
        nodes.iter().map(|n| text(n.get("id"))).collect()
    }

    #[test]
    fn the_tree_lists_what_draws_in_drawing_order_then_controls_by_label() {
        // The agent's layer draws first; decoration, the invisible note and the orphan are out.
        let nodes = tree(&figure(3), &[]);
        assert_eq!(
            ids(&nodes),
            ["doc-1", "scribble", "beam", "lens", "rays", "count", "c-rays"]
        );
        assert_eq!(nodes[2]["role"], "part");
        assert_eq!(nodes[6]["name"], "Number of rays");
        assert_eq!(nodes[6]["role"], "slider");
    }

    #[test]
    fn what_the_view_hides_leaves_the_tree_and_the_readouts() {
        let nodes = tree(&figure(3), &["beam".into(), "scribble".into()]);
        assert_eq!(ids(&nodes), ["doc-1", "lens", "rays", "count", "c-rays"]);
        let r = readouts(&figure(4), &[]);
        assert_eq!(r.get("count").map(String::as_str), Some("Rays: 4"));
        assert_eq!(r.len(), 1);
        assert!(readouts(&figure(4), &["count".into()]).is_empty());
    }
}
