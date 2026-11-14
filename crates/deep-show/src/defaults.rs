//! Issue #1974: defaults proven by building (canvas primitives: Canvas module; Registry and seal:
//! registries). Each field the dump gives a default is built twice in its kind's example: once
//! left out, and once set to the default `op: field` prints. The two builds must give the same
//! check result, built output hash and evaluated values, so a reader that falls back to a value of
//! its own fails, naming the kind and the field. The run walks the dump field by field and reports,
//! by kind, the fields it built and compared; a field with a default it didn't build makes the run
//! INVALID, never PASS.

use std::collections::BTreeMap;

use deep_canvas::document::check_in;
use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{is_check_phase, sha256_hex, Planted as SchedulePlanted, Scheduler};
use deep_canvas_marks::scene::Palette;
use serde_json::{json, Value};

use crate::kinds::{dump_value, kind_rows, Planted};
use crate::kit::catalog::stamped;
use crate::kit::instance::{self, How};

/// The core's operators whose result is the item as written, in its checked form: input to the
/// readers, not a value one evaluated, so a field left out and one set differ there whatever the
/// readers do. Every reader of them is compared at its own node.
const ECHO: [&str; 2] = ["core.lower", "core.fields"];

/// One build of an example: what each of the three comparisons reads.
struct Built {
    /// The document check's issues and the operators', each as its code and path.
    check: Vec<Value>,
    /// The build phase's results, by node, and a scene3d document's evaluated scene.
    built: BTreeMap<String, String>,
    /// Every frame node's result, by node.
    evaluated: BTreeMap<String, String>,
}

impl Built {
    fn hash(map: &BTreeMap<String, String>) -> String {
        sha256_hex(serde_json::to_string(map).unwrap_or_default().as_bytes())
    }

    fn to_json(&self) -> Value {
        json!({"check": self.check, "hash": Built::hash(&self.built), "values": Built::hash(&self.evaluated)})
    }
}

/// `doc` checked, built and evaluated at its first frame on a fresh instance of the build.
fn build(
    sealed: &Sealed,
    how: &How,
    doc: &Value,
    (look, palette): (&BTreeMap<String, Value>, &Palette),
    readings: &BTreeMap<String, Value>,
) -> Built {
    let mut check: Vec<Value> = check_in(doc, sealed)
        .issues
        .iter()
        .map(|i| json!({"code": i.code, "path": i.path, "severity": i.severity}))
        .collect();
    let (ops, mut built, evaluated) = instance::fresh(|| {
        let mut s = Scheduler::new(sealed, how.options());
        let mut session = instance::session(&mut s, doc, look, readings);
        session.frame(&mut s, 0, &instance::view(doc));
        let ops: Vec<Value> = session
            .report
            .issues
            .iter()
            .map(|i| json!({"code": i.code, "path": i.path, "operator": i.operator}))
            .collect();
        let (mut built, mut evaluated) = (BTreeMap::new(), BTreeMap::new());
        for n in session.nodes(&s) {
            let place = match &n.item {
                Some(i) => format!("{}@{i}", n.operator),
                None => n.operator.clone(),
            };
            if ECHO.contains(&n.operator.as_str()) {
                continue;
            }
            if n.phase == "build" {
                built.insert(place, n.result);
            } else if !is_check_phase(&n.phase) {
                evaluated.insert(place, n.result);
            }
        }
        (ops, built, evaluated)
    });
    check.extend(ops);
    // A document scene3d draws: the scene its frame evaluates is built output too.
    if doc.pointer("/requires/modules/scene3d").is_some() {
        let planted = how.planted.module.as_deref();
        let scene = match crate::scene3d::scene_at(doc, 0, palette, sealed, planted) {
            Ok(scene) => sha256_hex(format!("{scene:?}").as_bytes()),
            Err(u) => format!("refused: {} at {}", u.code, u.path),
        };
        built.insert("scene3d.scene".into(), scene);
    }
    Built {
        check,
        built,
        evaluated,
    }
}

/// Sets the field whose dotted name ends in `last` to `value` (or leaves it out when `value` is
/// `None`) under each parent `steps` reach from `at`: a `name[]` step each element of that list, a
/// `<name>` step each member of an object. The number of parents it reached.
fn place(at: &mut Value, steps: &[&str], last: &str, value: Option<&Value>) -> usize {
    let Some((step, rest)) = steps.split_first() else {
        let Some(o) = at.as_object_mut() else {
            return 0;
        };
        match value {
            Some(v) => o.insert(last.to_string(), v.clone()),
            None => o.remove(last),
        };
        return 1;
    };
    if let Some(list) = step.strip_suffix("[]") {
        return match at.get_mut(list).and_then(Value::as_array_mut) {
            Some(l) => l.iter_mut().map(|e| place(e, rest, last, value)).sum(),
            None => 0,
        };
    }
    if step.starts_with('<') && step.ends_with('>') {
        return match at.as_object_mut() {
            Some(o) => o.values_mut().map(|e| place(e, rest, last, value)).sum(),
            None => 0,
        };
    }
    match at.get_mut(*step) {
        Some(next) => place(next, rest, last, value),
        None => 0,
    }
}

/// `doc` with field `name` of its item `id` left out and set to `default`: under the item's
/// params, or, for a field the document holds beside its items (`data.copy…`), under the
/// document; `None` when neither reaches the field's place.
fn twins(doc: &Value, id: &str, name: &str, default: &Value) -> Option<(Value, Value)> {
    let steps: Vec<&str> = name.split('.').collect();
    let (last, parents) = steps.split_last()?;
    for under_params in [true, false] {
        let (mut left, mut set) = (doc.clone(), doc.clone());
        let root = |d: &mut Value| -> usize {
            let r = if under_params {
                &mut d["items"][id]["params"]
            } else {
                d
            };
            place(r, parents, last, None)
        };
        if root(&mut left) == 0 {
            continue;
        }
        let r = if under_params {
            &mut set["items"][id]["params"]
        } else {
            &mut set
        };
        place(r, parents, last, Some(default));
        return Some((left, set));
    }
    None
}

/// The kind's stamped example with the structured params whose dotted fields it writes no place
/// for, each as its reader takes it, and the arrays the host fills from a logic item for them:
/// a logic grid (#538), a terrain plate's overlay (#537), a copy table one key short that a mark
/// set's copy column reads (#538), and atlas tiles on a hex grid (#535, #536).
fn nested(kind: &str, mut doc: Value) -> Option<Value> {
    let i32s = |count: u64| json!({"type": "i32", "count": count, "every": 10, "linear": false, "steps": []});
    let params = &mut doc["items"]["x1"]["params"];
    match kind {
        "cells@1" => {
            params["grid"] = json!({"array": "g.cells", "size": [2, 1], "glyphs": ["a", "b"], "roles": ["ink", "muted"]});
            doc["arrays"] = json!({"g.cells": i32s(2)});
        }
        "plate@1" => {
            params["terrain"] = json!({"height": 0, "size": [4, 2]});
            params["overlays"] =
                json!([{"grid": "g.fog", "size": [4, 2], "roles": ["ink", "muted", "none"]}]);
            doc["arrays"] = json!({"g.fog": i32s(8)});
        }
        "text@1" => {
            let layer = doc["items"]["x1"]["layer"].clone();
            doc["data"] = json!({"copy": {"en": {"labels": {"1": "One"}}}});
            // Key 0, as one f32 (0.0, in base64), which the table lacks.
            doc["items"]["set"] = json!({"id": "set", "kind": "marks@1", "name": "Set", "order": "a1", "layer": layer,
                "params": {"mark": "text", "n": 1, "paint": {"fill": {"role": "ink"}},
                    "columns": {"label": {"copy": "labels", "key": "k"}, "k": {"dtype": "f32", "len": 1, "data": "AAAAAA=="}},
                    "encode": {"x": 40, "y": 40, "text": {"column": "label"}}}});
        }
        "marks@1" => {
            // Tiles 0 and 1, as two f32s in base64.
            *params = json!({"mark": "image", "n": 2, "atlas": {"asset": "a".repeat(64), "cell": [8, 8]},
                "grid": {"shape": "hex", "hex": {}, "cell": [32, 28], "size": [2, 1]},
                "columns": {"tile": {"dtype": "f32", "len": 2, "data": "AAAAAAAAgD8="}}});
        }
        _ => return None,
    }
    Some(doc)
}

/// Where field `name` of `kind` is built: the kind's example, or, for a field inside a structured
/// param the example doesn't hold, the first fixture of the build with an item of the kind that
/// holds its place. Its name, the record's readings it reads, and the document with the field
/// left out and set to `default`.
type Context = (String, BTreeMap<String, Value>, Value, Value);

fn context(
    sealed: &Sealed,
    example: Option<&Value>,
    kind: &str,
    name: &str,
    default: &Value,
) -> Option<Context> {
    let example = example.map(stamped);
    if let Some((left, set)) = example.as_ref().and_then(|d| twins(d, "x1", name, default)) {
        return Some(("example".into(), BTreeMap::new(), left, set));
    }
    let context = example.and_then(|d| nested(kind, d));
    if let Some((left, set)) = context.and_then(|d| twins(&d, "x1", name, default)) {
        return Some((
            "example with its structured params".into(),
            BTreeMap::new(),
            left,
            set,
        ));
    }
    for m in &sealed.modules {
        for f in &m.shapes.fixtures {
            let ids = f.document["items"]
                .as_object()
                .into_iter()
                .flatten()
                .filter(|(_, i)| i["kind"] == kind)
                .map(|(id, _)| id);
            for id in ids {
                if let Some((left, set)) = twins(&stamped(&f.document), id, name, default) {
                    let readings = instance::readings(f.record.as_ref());
                    return Some((format!("{}/{}", m.name, f.name), readings, left, set));
                }
            }
        }
    }
    None
}

/// The first node two builds' maps differ at, or none.
fn first_difference(a: &BTreeMap<String, String>, b: &BTreeMap<String, String>) -> Option<String> {
    a.iter()
        .find(|(k, v)| b.get(*k) != Some(v))
        .map(|(k, _)| k.clone())
        .or_else(|| b.keys().find(|k| !a.contains_key(*k)).cloned())
}

/// What differs between the field left out (`a`) and set to its default (`b`), one entry per
/// comparison.
fn differences(a: &Built, b: &Built) -> Vec<Value> {
    let mut out = Vec::new();
    if a.check != b.check {
        out.push(json!({"compared": "check", "left_out": a.check, "set": b.check}));
    }
    if let Some(at) = first_difference(&a.built, &b.built) {
        out.push(json!({"compared": "hash", "first_at": at}));
    }
    if let Some(at) = first_difference(&a.evaluated, &b.evaluated) {
        out.push(json!({"compared": "values", "first_at": at}));
    }
    out
}

/// The run over the build: each field with a default in its dump, in the dump's order, built left
/// out and set to that default in its kind's example, the three comparisons per field, and the
/// count against the dump's count of fields with a default.
pub fn run(sealed: &Sealed, planted: Option<Planted>) -> Value {
    let shipped = crate::hub::shipped_look();
    let look = (
        &deep_canvas_marks::modules::tokens(&shipped.light),
        &shipped.light,
    );
    let rows = kind_rows(sealed, planted);
    let examples: BTreeMap<String, Value> = rows
        .iter()
        .filter_map(|r| {
            let name = r.entry["name"].as_str()?.to_string();
            Some((name, serde_json::from_str(r.example.as_deref()?).ok()?))
        })
        .collect();
    // The lines `op: field` prints, by path: the defaults the run sets.
    let lines: BTreeMap<String, Value> = rows
        .iter()
        .flat_map(|r| {
            let kind = r.entry["name"].as_str().unwrap_or_default().to_string();
            r.entry["fields"]
                .as_array()
                .into_iter()
                .flatten()
                .map(move |f| {
                    (
                        format!("{kind}.{}", f["name"].as_str().unwrap_or_default()),
                        f["default"].clone(),
                    )
                })
        })
        .collect();
    let mut how = How::default();
    if planted == Some(Planted::DefaultsReaderFallsBackTo2) {
        how.planted = SchedulePlanted {
            module: Some("defaults_reader_falls_back_to_2".into()),
            ..SchedulePlanted::default()
        };
    }
    let dump = dump_value(sealed, None);
    let mut kinds: Vec<Value> = Vec::new();
    let mut failures: Vec<Value> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    let (mut listed, mut count) = (0usize, 0usize);
    let entries = dump["registries"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|r| r["entries"].as_array().into_iter().flatten());
    for e in entries {
        let kind = e["name"].as_str().unwrap_or_default();
        let mut fields: Vec<Value> = Vec::new();
        for f in e["fields"].as_array().into_iter().flatten() {
            if f["default"].is_null() {
                continue;
            }
            listed += 1;
            let name = f["name"].as_str().unwrap_or_default();
            let path = format!("{kind}.{name}");
            let default = lines.get(&path).cloned().unwrap_or(Value::Null);
            if planted == Some(Planted::DefaultsComparedWithDumpOnly) {
                // The planted run builds nothing: the line's default against the dump's.
                count += 1;
                fields.push(json!({"field": name, "default": default, "dump": f["default"]}));
                if default != f["default"] {
                    failures.push(json!({"path": path, "kind": kind, "field": name}));
                }
                continue;
            }
            if planted == Some(Planted::DefaultsSkipJson) && f["type"] == "json" {
                skipped.push(json!({"path": path, "why": "typed json"}));
                continue;
            }
            let Some((within, readings, left, set)) =
                context(sealed, examples.get(kind), kind, name, &default)
            else {
                skipped.push(json!({"path": path, "why": "neither its kind's example nor a fixture of the build holds its place"}));
                continue;
            };
            let (a, b) = (
                build(sealed, &how, &left, look, &readings),
                build(sealed, &how, &set, look, &readings),
            );
            count += 1;
            fields.push(json!({"field": name, "default": default, "in": within, "left_out": a.to_json(), "set": b.to_json()}));
            let differs = differences(&a, &b);
            if !differs.is_empty() {
                failures
                    .push(json!({"path": path, "kind": kind, "field": name, "differs": differs}));
            }
        }
        if !fields.is_empty() {
            kinds.push(json!({"kind": kind, "fields": fields}));
        }
    }
    let first_skipped = skipped.first().map(|s| s["path"].clone());
    let (verdict, reason) = if let Some(f) = failures.first() {
        let reason = format!(
            "{} of {count} fields built left out and set to their default differ; the first is {}",
            failures.len(),
            f["path"].as_str().unwrap_or_default()
        );
        ("FAIL", reason)
    } else if let Some(first) = &first_skipped {
        let reason = format!(
            "{count} of the dump's {listed} fields with a default were built and compared; the first not built is {}",
            first.as_str().unwrap_or_default()
        );
        ("INVALID", reason)
    } else {
        let reason =
            format!("all {listed} fields with a default give the same build left out as set");
        ("PASS", reason)
    };
    json!({"ok": true, "verdict": verdict, "reason": reason, "count": count, "listed": listed,
           "first_skipped": first_skipped, "failures": failures, "skipped": skipped, "kinds": kinds})
}
