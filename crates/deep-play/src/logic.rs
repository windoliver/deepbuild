//! #544, #535, #533: a document's logic items as the app and the web player both bake them (#172):
//! baked on an input track over the transport's span, each one's occurrence list written into the
//! form its readers read and its arrays into `arrays`, which the core's column view reads, and each
//! program inlined for the logic module's steps.

use std::rc::Rc;

use deep_canvas::document::Issue;
use deep_canvas::registry::Sealed;
use deep_logic::piece::{check_in, History, Piece};
use deep_logic::world::{track_of, Entry, Record, World};
use serde_json::{json, Map, Value};

/// A refusal of the logic module as the revision's issue, on the item it names.
pub fn refused(r: Value) -> Issue {
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

/// Each `logic@1` item's program, read by `read` by its hash and inlined as `params.wasm`
/// (base64), which the logic module's steps run (#533). A program `read` doesn't hold stays out,
/// and the logic module's step names it `asset_missing`.
pub fn inline_programs(form: &mut Value, read: &dyn Fn(&str) -> Option<Vec<u8>>) {
    let Some(items) = form.get_mut("items").and_then(Value::as_object_mut) else {
        return;
    };
    for item in items
        .values_mut()
        .filter(|i| i["kind"] == deep_logic::module::INTERFACE)
    {
        let sha = item
            .pointer("/params/program")
            .and_then(Value::as_str)
            .unwrap_or("");
        let Some(bytes) = (sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| read(sha))
            .flatten()
        else {
            continue;
        };
        if let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) {
            params.insert(
                "wasm".into(),
                Value::String(deep_canvas::base64::encode(&bytes)),
            );
        }
    }
}

/// Mark set columns that read a column source, resolved and narrowed by the core's column
/// view at `t` (#397), and those that read a logic array, baked for every frame (#535); and
/// scene3d's readers of logic arrays, checked (#537).
pub fn column_view(sealed: &Sealed, form: &mut Value, t: i64) -> Vec<Issue> {
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
        let locale = form
            .get("locale")
            .and_then(Value::as_str)
            .unwrap_or("en")
            .to_string();
        issues.extend(raised_at(form, None, &locale));
    }
    issues
}

/// Each logic item of `piece` (`form`'s, checked) stepped on `track` over the transport's span,
/// and its rows written to `occurrences.<logic ID>.occurrences`:
/// `{t, step, kind, a, b}` and its declared fields by name, as Spawn and motion read a row.
pub fn inline_logic(
    form: &mut Value,
    piece: Option<Piece>,
    track: &[Value],
    drops_last_range: bool,
) -> Result<(), Box<Issue>> {
    let Some(piece) = piece else {
        return Ok(());
    };
    let entries: Vec<Entry> = track
        .iter()
        .filter(|e| e.get("present").is_none())
        .map(Entry::parse)
        .collect::<Option<_>>()
        .ok_or_else(|| {
            refused(
                json!({"code": "bad_input", "what": "track: each entry is {t, control, value}"}),
            )
        })?;
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
    if drops_last_range {
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
        let first = piece
            .items
            .iter()
            .find(|i| &i.id == id)
            .and_then(|i| i.writes.first())
            .map(|w| format!("{id}.{}", w.name));
        if let Some(a) = first.and_then(|f| arrays.get_mut(&f)) {
            a["compares"] = json!(compares
                .iter()
                .map(|(k, bytes, ms)| json!([k, bytes, ms]))
                .collect::<Vec<_>>());
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
/// each program read by `read`, with the between-step services this build binds
/// answering on `form`'s worlds and the core input track `track` (#213); none when it has no
/// logic item.
pub fn logic_piece(
    sealed: &Sealed,
    form: &Value,
    track: &[Value],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    cast_late: bool,
) -> Result<Option<Piece>, Box<Issue>> {
    let Some(piece) = piece_json(form) else {
        return Ok(None);
    };
    let piece = check_in(
        &piece,
        &Default::default(),
        &mut History::new(),
        read,
        &crate::cast::services(sealed, form, track, cast_late),
    )
    .map_err(|r| refused(r.0))?;
    Ok(Some(piece))
}

/// `form`'s logic items as one piece, as the logic module checks one: its seed, controls and
/// items; none when it has no logic item.
pub fn piece_json(form: &Value) -> Option<Value> {
    let items: Map<String, Value> = form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("logic@1"))
        .map(|(id, i)| {
            // Without the program the hub inlined as `wasm` for the module's steps (#533): the
            // check reads it from the store by `program`.
            let mut params = i.get("params").cloned().unwrap_or(json!({}));
            if let Some(p) = params.as_object_mut() {
                p.remove("wasm");
            }
            (id.clone(), json!({"kind": "logic@1", "params": params}))
        })
        .collect();
    if items.is_empty() {
        return None;
    }
    Some(json!({
        "seed": form.get("seed").and_then(Value::as_i64).unwrap_or(0),
        "controls": form.get("controls").cloned().unwrap_or(json!({})),
        "items": items,
    }))
}

/// #538: each array a text's lookup or a group's flip names, resolved through the core's view:
/// `module_missing` naming logic in a build without it, `ref_unresolved` where nothing writes
/// it. A path with a `/` is a template's slot, not an array.
fn readers(form: &Value, entries: &[deep_canvas::registry::lists::SealedEntry]) -> Vec<Issue> {
    let worlds = form.get("worlds").unwrap_or(&Value::Null);
    let mut out = Vec::new();
    for (id, item) in form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let mut paths: Vec<(String, String)> = Vec::new();
        if let Some(a) = item.pointer("/params/flip/array").and_then(Value::as_str) {
            paths.push(("flip/array".into(), a.into()));
        }
        for (field, v) in deep_canvas_marks::copy::lookups_of(item) {
            let Ok(l) = deep_canvas_marks::copy::lookup(&v) else {
                continue;
            };
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
            let Some((name, _)) = deep_canvas::columns::element_path(&path) else {
                continue;
            };
            let at = format!("items/{id}/params/{field}");
            if let Err(issue) =
                deep_canvas::columns::source((&form["arrays"], worlds), entries, id, &at, name)
            {
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
    for (id, item) in form
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if item["kind"] != "cells@1" {
            continue;
        }
        let Ok(Some(spec)) = deep_canvas_cells::logic_grid::spec(&item["params"]) else {
            continue;
        };
        let shaper = shaper.get_or_insert_with(deep_text::Shaper::new);
        for (i, g) in spec.glyphs.iter().enumerate() {
            let run = deep_text::Spec {
                family: deep_text::Role::Mono.family(),
                ..deep_text::Spec::label(g)
            };
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

/// #538: the issues the cell grid, keyed copy and flip by array raise over `form`'s baked arrays:
/// every one at check (`t` none), or those beginning at the step of a frame at `t` in `locale`.
pub fn raised_at(form: &Value, t: Option<i64>, locale: &str) -> Vec<Issue> {
    let empty = Map::new();
    let map = form.as_object().unwrap_or(&empty);
    let mut out = t.map_or_else(Vec::new, |t| {
        deep_canvas_cells::logic_grid::raised_at(form, t)
    });
    out.extend(deep_canvas_motion::held::unmapped(form, t));
    out.extend(deep_canvas_marks::copy::raised_at(map, t, locale));
    out.extend(deep_canvas_marks::copy::column_missing(map, t, locale));
    out
}
