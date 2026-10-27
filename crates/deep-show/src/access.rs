//! Issue #376: a panel's accessibility read as data, the way a replica compares it (Rules every
//! primitive follows: Accessible). The tree has one node per part and control, each with its
//! name and role, and an announcement is made for a readout only in a frame where its text
//! differs from what was last said for it: redrawing it unchanged says nothing, and the planted
//! twin that announces every frame is what the criterion's check fails. The tree holds exactly
//! the items the panel draws ([`crate::shared::draws`], less what the view hides), so an item
//! that doesn't draw is never in it or announced (Control: "no control hits, focuses, picks or
//! announces a row or element that doesn't draw"); decoration draws but is nothing to hear of.

use std::collections::BTreeMap;

use deep_canvas::template;
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};

fn text(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
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
    let mut out: Vec<(&String, &Value)> = crate::shared::draws(doc)
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
    out.sort_by_key(|(id, item)| (layer_order(item), text(item.get("order")), (*id).clone()));
    out
}

/// The accessibility tree of a document: its own node first (its title as the name, with its
/// description), then one node per item heard, in reading order, and then one per control,
/// named by its label and with its ARIA role.
fn tree(doc: &Value, hidden: &[String]) -> Vec<Value> {
    let mut nodes = vec![json!({
        "id": text(doc.get("id")),
        "role": "document",
        "name": text(doc.get("title")),
        "description": text(doc.get("description")),
    })];
    for (id, item) in heard(doc, hidden) {
        nodes.push(json!({"id": id, "role": item["role"], "name": text(item.get("name"))}));
    }
    if let Some(controls) = doc.get("controls").and_then(Value::as_object) {
        for (id, control) in controls {
            nodes.push(json!({
                "id": id,
                "role": text(control.get("role")),
                "name": text(control.get("label")),
            }));
        }
    }
    nodes
}

/// Every readout heard with what it says: a text item in the tree whose `template` fills from
/// the document's values (Text `text@1`; Overlay: "a readout and the parts it describes come
/// from one model"), expanded as the frame shows it.
fn readouts(doc: &Value, hidden: &[String]) -> BTreeMap<String, String> {
    heard(doc, hidden)
        .into_iter()
        .filter_map(|(id, item)| {
            let template = item.pointer("/params/template")?.as_str()?;
            let text = template::expand(doc, template).ok()?;
            Some((id.clone(), text))
        })
        .collect()
}

impl Hub<'_> {
    /// `see`: the panel's accessibility tree as of now and every announcement it made so far.
    /// The announcements come from the frames the panel presented (`presented`): a readout is
    /// announced at the vsync of each frame where its text differs from what was last said for
    /// it, so a change speaks once and an unchanged redraw not at all. One the view hides keeps
    /// what was said, so showing it again unchanged says nothing; one that leaves the document
    /// is forgotten.
    pub fn see(&mut self, panel: &str) -> Value {
        let presented = self.presented(panel);
        let (Some(frames), Some(doc)) = (
            presented.get("frames").and_then(Value::as_array),
            self.panel_doc(panel),
        ) else {
            return presented;
        };
        let every_frame = self.scenario.planted == Some(Planted::AnnouncesEveryFrame);
        let mut by_rev: BTreeMap<u64, Option<Value>> = BTreeMap::new();
        let mut said: BTreeMap<String, String> = BTreeMap::new();
        let mut announcements = Vec::new();
        for frame in frames {
            let (Some(vsync), Some(rev)) = (frame["vsync"].as_i64(), frame["rev"].as_u64()) else {
                continue;
            };
            let Some(revision) = by_rev
                .entry(rev)
                .or_insert_with(|| self.revision(&doc, rev))
                .as_ref()
            else {
                continue;
            };
            let hidden: Vec<String> = frame
                .get("hidden")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            said.retain(|id, _| revision.pointer(&format!("/items/{id}")).is_some());
            for (id, text) in readouts(revision, &hidden) {
                if every_frame || said.get(&id) != Some(&text) {
                    announcements.push(json!({"t": vsync, "id": id, "text": text}));
                }
                said.insert(id, text);
            }
        }
        let tree = match (self.scopes.get(panel), self.panel_document(panel)) {
            (Some(s), Some((shown, _))) => tree(&shown, &s.scope.hidden(&shown)),
            _ => Vec::new(),
        };
        json!({"tree": tree, "announcements": announcements})
    }
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
