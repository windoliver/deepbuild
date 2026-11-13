//! #544: a document's logic items, baked on an input track over the transport's span, and each
//! one's occurrence list written into the form its readers read, as `occurrences` holds a baked
//! list (`<logic ID>.occurrences`): Spawn, `start_on`, mark-set rows and drivers read a logic
//! item's rows as they read any list, from the bake, so a seek reads what playing does. #535: the
//! bake's arrays go into the form's `arrays`, which the core's column view reads.

use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_logic::piece::{check_in, History};
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// A refusal of the logic module as the revision's issue, on the item it names.
fn refused(r: Value) -> Issue {
    let item = r.get("item").and_then(Value::as_str).unwrap_or_default().to_string();
    let what = "the logic module refuses this logic item";
    if item.is_empty() {
        Issue::envelope("logic_refused", String::new(), r, what)
    } else {
        Issue::error("logic_refused", &item, format!("items/{item}/params"), r, what)
    }
}

/// The logic items' lists in `form`'s `occurrences`, by name.
fn logic_lists(form: &mut Value) -> Vec<&mut Value> {
    let logic: Vec<String> = form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
        .map(|(id, _)| format!("{id}.occurrences"))
        .collect();
    match form.get_mut("occurrences").and_then(Value::as_object_mut) {
        Some(lists) => lists.iter_mut().filter(|(k, _)| logic.contains(k)).map(|(_, v)| v).collect(),
        None => Vec::new(),
    }
}

/// The planted start_on (`start_on_at_first_frame`): each logic row before a session's first
/// frame moved to it, as if a run started when a frame first read the occurrence.
pub(crate) fn from_first_frame(form: &mut Value, first: i64) {
    for list in logic_lists(form) {
        for row in list.as_array_mut().into_iter().flatten() {
            if row["t"].as_i64().is_some_and(|t| t < first) {
                row["t"] = json!(first);
            }
        }
    }
}

impl Hub<'_> {
    /// Mark set columns that read a column source, resolved and narrowed by the core's column
    /// view at `t` (#397), and those that read a logic array, baked for every frame (#535); and
    /// scene3d's readers of logic arrays, checked (#537).
    pub(crate) fn column_view(&self, form: &mut Value, t: i64) -> Vec<Issue> {
        let sealed = &self.startup.sealed;
        let entries = sealed.registry(deep_canvas::columns::REGISTRY);
        let entries = entries.map_or(&[][..], |r| r.entries.as_slice());
        let mut issues = deep_canvas_scene3d::arrays::check(form, entries);
        issues.extend(deep_canvas_scene3d::tints::check(form));
        issues.extend(deep_canvas::columns::view(form, entries, t));
        issues
    }

    /// Each logic item of `form` stepped on `track` over the transport's span, its program read
    /// from the evidence store, and its rows written to `occurrences.<logic ID>.occurrences`:
    /// `{t, step, kind, a, b}` and its declared fields by name, as Spawn and motion read a row.
    pub(crate) fn inline_occurrences(&self, form: &mut Value, track: &[Value]) -> Result<(), Box<Issue>> {
        self.inline_worlds(form)?;
        let items: Map<String, Value> = form
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
            .map(|(id, i)| (id.clone(), json!({"kind": "logic@1", "params": i.get("params").cloned().unwrap_or(json!({}))})))
            .collect();
        if items.is_empty() {
            return Ok(());
        }
        let piece = json!({
            "seed": form.get("seed").and_then(Value::as_i64).unwrap_or(0),
            "controls": form.get("controls").cloned().unwrap_or(json!({})),
            "items": items,
        });
        let root = &self.scenario.evidence;
        let piece = check_in(&piece, &Default::default(), &mut History::new(), &|sha| crate::evidence::read(root, sha))
            .map_err(|r| refused(r.0))?;
        let entries: Vec<Entry> = track
            .iter()
            .map(Entry::parse)
            .collect::<Option<_>>()
            .ok_or_else(|| refused(json!({"code": "bad_input", "what": "track: each entry is {t, control, value}"})))?;
        let span = deep_canvas_media::doc::time(form, form.pointer("/transport/span")).unwrap_or(0).max(0);
        let steps = piece.items.iter().map(|i| (span + i.step - 1) / i.step.max(1)).max().unwrap_or(0);
        let piece = Rc::new(piece);
        let mut rec = Record::default();
        let mut world = World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None).map_err(refused)?;
        world.run(steps, &mut rec, &mut |_, _| {});
        let Some(doc) = form.as_object_mut() else { return Ok(()) };
        let lists = doc.entry("occurrences").or_insert_with(|| json!({}));
        for (id, rows) in rec.occurrences(&piece) {
            let flat: Vec<Value> = rows
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_object)
                .map(|r| {
                    let mut out: Map<String, Value> = r.iter().filter(|(k, _)| *k != "fields").map(|(k, v)| (k.clone(), v.clone())).collect();
                    out.extend(r.get("fields").and_then(Value::as_object).cloned().unwrap_or_default());
                    Value::Object(out)
                })
                .collect();
            lists[format!("{id}.occurrences")] = Value::Array(flat);
        }
        // #535: the same bake's arrays, each step's changes with the ranges the logic module hands
        // the core's column view, as the drawn form's `arrays`.
        let mut arrays = rec.arrays(&piece);
        if self.scenario.module_planted.as_deref() == Some("hand_over_drops_last_range") {
            // The planted hand-over: each step's last changed range never reaches the view.
            for steps in arrays
                .values_mut()
                .filter_map(|a| a["steps"].as_array_mut())
            {
                for s in steps {
                    if let Some(c) = s["changed"].as_array_mut() {
                        c.pop();
                    }
                }
            }
        }
        // #1918: beside the readings of the worlds the document lists.
        if let Some(all) = doc.entry("arrays").or_insert_with(|| json!({})).as_object_mut() {
            all.extend(arrays);
        }
        Ok(())
    }
}
