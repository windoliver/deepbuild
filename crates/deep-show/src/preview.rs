//! #548: logic previews in the app's live view (Logic: preview). A panel whose document has a
//! logic item with a `preview` keeps a world of the document's logic stepped to the frame it
//! shows; each live frame runs the item's preview on a throwaway copy of that state with the
//! panel's point hovers, at most once a frame and only when the step or a hover changed, and
//! writes its arrays into the frame's form as `<logic ID>.preview.<name>`, which drivers and mark
//! sets read. Only the live view calls this: exports, goldens, checks and evals draw the bake's
//! preview arrays, which hold no step, so they draw them at their defaults.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_logic::world::{handed, track_of, Entry, Record, World};
use serde_json::{json, Value};

use crate::hub::Hub;

/// A panel's world for its previews, and what it was built from.
pub(crate) struct Previewer {
    key: String,
    world: World,
}

/// Whether `form` has a logic item with a preview.
fn previews(form: &Value) -> bool {
    form.get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .any(|(_, i)| i["kind"] == "logic@1" && i.pointer("/params/preview").is_some())
}

impl Hub<'_> {
    /// Writes the preview arrays a live frame of `doc` in `panel` at `t` draws into `form`, and
    /// reads its columns again so its readers draw them.
    pub(crate) fn preview_into(&mut self, doc: &str, panel: &str, t: i64, form: &mut Value) {
        let Some(base) = self.forms.get(doc).cloned().filter(previews) else {
            return;
        };
        let Ok(Some(piece)) = self.logic_piece(&base) else {
            return;
        };
        let piece = Rc::new(piece);
        let track = self.track_read(doc);
        let read = track.iter().filter(|e| e.get("present").is_none());
        let Some(entries) = read.map(Entry::parse).collect::<Option<Vec<_>>>() else {
            return;
        };
        let key = format!(
            "{}|{}",
            piece.items.iter().map(|i| i.content.as_str()).collect::<Vec<_>>().join(","),
            Value::Array(track).to_string()
        );
        let len = piece.items.first().map_or(1, |i| i.step.max(1));
        let want = t.max(0) / len + 1;
        let Some(scope) = self.scopes.get_mut(panel) else {
            return;
        };
        // The world steps on from where it stands; another piece or track, or a frame before it,
        // builds it again.
        let stale = scope
            .preview
            .as_ref()
            .is_none_or(|p| p.key != key || p.world.at().is_none_or(|a| a > want));
        if stale {
            let mut rec = Record::default();
            let Ok(world) = World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None) else {
                return;
            };
            scope.preview = Some(Previewer { key, world });
        }
        let p = scope.preview.as_mut().expect("built above");
        p.world.run(want, &mut Record::default(), &mut |_, _| {});
        let mut values = BTreeMap::new();
        for (c, h) in &scope.points.hover {
            let cell = h.as_array().and_then(|a| Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?]));
            values.insert(format!("{c}.hover"), deep_logic::point::hover(cell));
        }
        p.world.preview(&values);
        let drawn = p.world.previews();
        let Some(arrays) = form
            .as_object_mut()
            .map(|o| o.entry("arrays").or_insert_with(|| json!({})))
            .and_then(Value::as_object_mut)
        else {
            return;
        };
        for item in &piece.items {
            for w in item.preview.iter().flat_map(|p| &p.writes) {
                let name = format!("{}.preview.{}", item.id, w.name);
                let values = drawn.get(&name).cloned().unwrap_or(json!([]));
                let step = json!({"step": 0, "changed": handed(&[[0, u64::from(w.count)]]), "values": [[0, values]]});
                arrays.insert(
                    name,
                    json!({"type": w.ty.name(), "count": w.count, "every": item.step, "linear": false, "steps": [step]}),
                );
            }
        }
        let _ = self.column_view(form, t);
    }
}
