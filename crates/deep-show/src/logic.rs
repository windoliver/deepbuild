//! #544: a document's logic items, baked on an input track over the transport's span, and each
//! one's occurrence list written into the form its readers read, as `occurrences` holds a baked
//! list (`<logic ID>.occurrences`): Spawn, `start_on`, mark-set rows and drivers read a logic
//! item's rows as they read any list, from the bake, so a seek reads what playing does. #535: the
//! bake's arrays go into the form's `arrays`, which the core's column view reads.

use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_logic::piece::{check_in, History, Piece};
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// A refusal of the logic module as the revision's issue, on the item it names.
fn refused(r: Value) -> Issue {
    let item = r
        .get("item")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let what = "the logic module refuses this logic item";
    if item.is_empty() {
        Issue::envelope("logic_refused", String::new(), r, what)
    } else {
        Issue::error(
            "logic_refused",
            &item,
            format!("items/{item}/params"),
            r,
            what,
        )
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
        Some(lists) => lists
            .iter_mut()
            .filter(|(k, _)| logic.contains(k))
            .map(|(_, v)| v)
            .collect(),
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
        // #538: the logic grid, keyed copy and flip by array, each through the same view.
        issues.extend(deep_canvas_cells::logic_grid::check(form, entries));
        issues.extend(grid_glyphs(form));
        issues.extend(readers(form, entries));
        if issues.iter().all(|i| i.code != "module_missing") {
            let locale = form.get("locale").and_then(Value::as_str).unwrap_or("en").to_string();
            issues.extend(raised_at(form, None, &locale));
        }
        issues
    }

    /// The document check's view of `form`'s readers ([`Hub::column_view`]), and #538's fit
    /// check over its copy tables, its time written to `timing` when the call asked for it.
    pub(crate) fn checked_view(&mut self, doc: &str, form: &mut Value, t: i64, timing: Option<&mut Map<String, Value>>) -> Vec<Issue> {
        self.keep_first_positions(doc, form);
        let mut issues = self.column_view(form, t);
        let (unfit, ms) = copy_fit(form);
        issues.extend(unfit);
        if let Some(timing) = timing {
            timing.insert("copy_fit_ms".into(), json!(ms));
        }
        issues
    }

    /// #538's planted lookup (`copy_keeps_first_position`): each copy table keeps every key's
    /// position in the order the document's first revision stored it, and a later revision's key
    /// reads the entry now at that position. Without the plant, nothing changes.
    pub(crate) fn keep_first_positions(&mut self, doc: &str, form: &mut Value) {
        if self.scenario.module_planted.as_deref() != Some(deep_canvas_marks::copy::KEEPS_FIRST_POSITION) {
            return;
        }
        let Some(copy) = form.pointer_mut("/data/copy").and_then(Value::as_object_mut) else {
            return;
        };
        for (locale, tables) in copy.iter_mut() {
            for (name, t) in tables.as_object_mut().into_iter().flatten() {
                let Some(t) = t.as_object_mut() else { continue };
                let now: Vec<String> = t.keys().filter(|k| k.parse::<i32>().is_ok()).cloned().collect();
                let first = self.first_orders.entry(format!("{doc}/{locale}/{name}")).or_insert_with(|| now.clone()).clone();
                let entries: Vec<Value> = now.iter().map(|k| t[k].clone()).collect();
                for (pos, k) in first.iter().enumerate() {
                    if let (Some(e), true) = (entries.get(pos), t.contains_key(k)) {
                        t.insert(k.clone(), e.clone());
                    }
                }
            }
        }
    }

    /// The arrays and lists `form`'s readers read: its logic items' (below), then its spectra's
    /// bands from the bakes kept at check (#503).
    pub(crate) fn inline_occurrences(
        &self,
        form: &mut Value,
        track: &[Value],
    ) -> Result<(), Box<Issue>> {
        let logic = self.inline_logic(form, track);
        self.inline_spectra(form);
        logic
    }

    /// Each logic item of `form` stepped on `track` over the transport's span, its program read
    /// from the evidence store, and its rows written to `occurrences.<logic ID>.occurrences`:
    /// `{t, step, kind, a, b}` and its declared fields by name, as Spawn and motion read a row.
    fn inline_logic(&self, form: &mut Value, track: &[Value]) -> Result<(), Box<Issue>> {
        self.inline_worlds(form, track)?;
        let Some(piece) = self.logic_piece(form)? else {
            return Ok(());
        };
        let entries: Vec<Entry> = track
            .iter()
            .filter(|e| e.get("present").is_none())
            .map(Entry::parse)
            .collect::<Option<_>>()
            .ok_or_else(|| refused(json!({"code": "bad_input", "what": "track: each entry is {t, control, value}"})))?;
        let span = deep_canvas_media::doc::time(form, form.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        let steps = piece
            .items
            .iter()
            .map(|i| (span + i.step - 1) / i.step.max(1))
            .max()
            .unwrap_or(0);
        let piece = Rc::new(piece);
        let mut rec = Record::default();
        let mut world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            Default::default(),
            &mut rec,
            None,
        )
        .map_err(refused)?;
        world.run(steps, &mut rec, &mut |_, _| {});
        let Some(doc) = form.as_object_mut() else {
            return Ok(());
        };
        let lists = doc.entry("occurrences").or_insert_with(|| json!({}));
        for (id, rows) in rec.occurrences(&piece) {
            let flat: Vec<Value> = rows
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_object)
                .map(|r| {
                    let mut out: Map<String, Value> = r
                        .iter()
                        .filter(|(k, _)| *k != "fields")
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    out.extend(
                        r.get("fields")
                            .and_then(Value::as_object)
                            .cloned()
                            .unwrap_or_default(),
                    );
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
        // #538: each item's comparisons after its steps, on its first array, for `frames`' timings.
        for (id, compares) in &rec.compares {
            let first = piece.items.iter().find(|i| &i.id == id).and_then(|i| i.writes.first()).map(|w| format!("{id}.{}", w.name));
            if let Some(a) = first.and_then(|f| arrays.get_mut(&f)) {
                a["compares"] = json!(compares.iter().map(|(k, bytes, ms)| json!([k, bytes, ms])).collect::<Vec<_>>());
            }
        }
        // #1918: beside the readings of the worlds the document lists.
        if let Some(all) = doc
            .entry("arrays")
            .or_insert_with(|| json!({}))
            .as_object_mut()
        {
            all.extend(arrays);
        }
        Ok(())
    }

    /// `form`'s logic items as one piece with its seed and controls, checked by the logic module,
    /// each program read from the evidence store; none when it has no logic item.
    pub(crate) fn logic_piece(&self, form: &Value) -> Result<Option<Piece>, Box<Issue>> {
        let items: Map<String, Value> = form
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
            .map(|(id, i)| (id.clone(), json!({"kind": "logic@1", "params": i.get("params").cloned().unwrap_or(json!({}))})))
            .collect();
        if items.is_empty() {
            return Ok(None);
        }
        let piece = json!({
            "seed": form.get("seed").and_then(Value::as_i64).unwrap_or(0),
            "controls": form.get("controls").cloned().unwrap_or(json!({})),
            "items": items,
        });
        let root = &self.scenario.evidence;
        let piece = check_in(&piece, &Default::default(), &mut History::new(), &|sha| {
            crate::evidence::read(root, sha)
        })
        .map_err(|r| refused(r.0))?;
        Ok(Some(piece))
    }
}

/// #538: each array a text's lookup or a group's flip names, resolved through the core's view:
/// `module_missing` naming logic in a build without it, `ref_unresolved` where nothing writes
/// it. A path with a `/` is a template's slot, not an array.
fn readers(form: &Value, entries: &[deep_canvas::registry::lists::SealedEntry]) -> Vec<Issue> {
    let worlds = form.get("worlds").unwrap_or(&Value::Null);
    let mut out = Vec::new();
    for (id, item) in form.get("items").and_then(Value::as_object).into_iter().flatten() {
        let mut paths: Vec<(String, String)> = Vec::new();
        if let Some(a) = item.pointer("/params/flip/array").and_then(Value::as_str) {
            paths.push(("flip/array".into(), a.into()));
        }
        for (field, v) in deep_canvas_marks::copy::lookups_of(item) {
            let Ok(l) = deep_canvas_marks::copy::lookup(&v) else { continue };
            paths.push((field.clone(), l.key.into()));
            for a in &l.args {
                let p = match a {
                    deep_canvas_marks::copy::Arg::Number { path, .. } => path,
                    deep_canvas_marks::copy::Arg::Lookup { key, .. } => key,
                };
                paths.push((field.clone(), p.to_string()));
            }
        }
        for (field, path) in paths.into_iter().filter(|(_, p)| !p.contains('/')) {
            let Some((name, _)) = deep_canvas::columns::element_path(&path) else { continue };
            let at = format!("items/{id}/params/{field}");
            if let Err(issue) = deep_canvas::columns::source((&form["arrays"], worlds), entries, id, &at, name) {
                out.push(*issue);
            }
        }
    }
    out
}

/// #538: each grapheme a logic grid lists that the face it draws in can't draw: a grid draws
/// every row in the mono role's face, so a glyph that face lacks is refused at check, naming it.
fn grid_glyphs(form: &Value) -> Vec<Issue> {
    let mut shaper: Option<deep_text::Shaper> = None;
    let mut out = Vec::new();
    for (id, item) in form.get("items").and_then(Value::as_object).into_iter().flatten() {
        if item["kind"] != "cells@1" {
            continue;
        }
        let Ok(Some(spec)) = deep_canvas_cells::logic_grid::spec(&item["params"]) else { continue };
        let shaper = shaper.get_or_insert_with(deep_text::Shaper::new);
        for (i, g) in spec.glyphs.iter().enumerate() {
            let run = deep_text::Spec { family: deep_text::Role::Mono.family(), ..deep_text::Spec::label(g) };
            if shaper.missing(&run, g).is_empty() {
                continue;
            }
            out.push(Issue::error(
                "text.glyph_missing",
                id,
                format!("items/{id}/params/grid/glyphs/{i}"),
                json!({"item": id, "grapheme": g}),
                &format!("the grid's face draws no `{g}`; a logic grid never draws a glyph its fonts lack"),
            ));
        }
    }
    out
}

/// #538: keyed copy's fit check over `form` (Text `text@1`: keyed copy), in the default type,
/// and the CPU time it took in ms.
pub(crate) fn copy_fit(form: &Value) -> (Vec<Issue>, f64) {
    let started = std::time::Instant::now();
    let mut out = Vec::new();
    if let Some(doc) = form.as_object() {
        deep_canvas_marks::copy::fit_issues(doc, &deep_canvas_marks::scene::Type::default(), &mut out);
    }
    (out, started.elapsed().as_secs_f64() * 1000.0)
}

/// #538: the issues the cell grid, keyed copy and flip by array raise over `form`'s baked arrays:
/// every one at check (`t` none), or those beginning at the step of a frame at `t` in `locale`.
pub(crate) fn raised_at(form: &Value, t: Option<i64>, locale: &str) -> Vec<Issue> {
    let empty = Map::new();
    let map = form.as_object().unwrap_or(&empty);
    let mut out = t.map_or_else(Vec::new, |t| deep_canvas_cells::logic_grid::raised_at(form, t));
    out.extend(deep_canvas_motion::held::unmapped(form, t));
    out.extend(deep_canvas_marks::copy::raised_at(map, t, locale));
    out.extend(deep_canvas_marks::copy::column_missing(map, t, locale));
    out
}
