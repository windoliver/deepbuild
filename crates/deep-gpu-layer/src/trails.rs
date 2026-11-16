//! #450: trails on `mark.line@1` items (tests/acceptance/450/README.md: The surface under test).
//! The scene evaluates each trail (deep_canvas_scene3d::trail); this reads what it draws: the
//! `trail` call checks a document and answers each trail's window and its whole window's bake,
//! and `view3d`'s `trails` field reports each frame's traces, the source at t and their
//! evaluated-data hash.

use std::collections::BTreeMap;
use std::sync::Mutex;

use deep_canvas_scene3d::label::Labels;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Line, Scene};
use deep_canvas_scene3d::trail::{self, Window};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::{refused, App, Planted};

/// The scene's lines that draw a trail.
fn trails(scene: &Scene) -> impl Iterator<Item = &Line> {
    scene
        .layers
        .iter()
        .flat_map(|l| &l.lines)
        .filter(|l| l.trail.is_some())
}

/// The `trail` call: the document check with the trail rules (each trail read, and the scene
/// evaluated, which bakes every `whole` window), then each trail's window and bake.
pub(crate) fn call(_app: &mut App, _out: &str, call: &Value) -> Value {
    let bad = |what: String| refused("bad_input", what);
    let Some(path) = call["doc"].as_str() else {
        return bad("doc is a path".into());
    };
    let doc: Value = match std::fs::read_to_string(path).map(|t| serde_json::from_str(&t)) {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => return bad(format!("doc: {e}")),
        Err(e) => return bad(format!("doc: {e}")),
    };
    let mut doc = doc;
    if doc.get("size").is_none() {
        doc["size"] = json!([320, 240]);
    }
    let issue = |id: &str, code: &str, path: String| {
        json!({"outcome": "refused", "issues": [{"code": code, "severity": "error", "ids": [id],
            "path": path, "actual": Value::Null, "what": format!("{id}'s trail can't be drawn"),
            "fix": "Name an item the trail can read, and keep its fields in their ranges."}]})
    };
    let look = match Look3::read(&deep_canvas_effects::particles::neutral_look(&doc)) {
        Ok(l) => l,
        Err(e) => return bad(format!("look: {e}")),
    };
    // A trail's own fields first, so a refusal names the line it is on.
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        if item["kind"] == "mark.line@1" {
            let at = format!("items/{id}/params");
            if let Err(r) = trail::read(&item["params"], &at) {
                return issue(id, r.code, r.path);
            }
        }
    }
    let scene = match evaluate(&doc, 0, &look, &mut Labels::new()) {
        Ok(s) => s,
        Err(r) => {
            let id = r.path.split('/').nth(1).unwrap_or("").to_string();
            return issue(&id, r.code, r.path);
        }
    };
    let mut out = Map::new();
    for l in trails(&scene) {
        let d = l.trail.as_ref().expect("filtered");
        let window = match d.trail.window {
            Window::Span => "span",
            Window::Since { .. } => "since",
            Window::Whole { .. } => "whole",
        };
        let samples = d.samples.as_ref().map(|s| {
            s.iter()
                .map(|(t, at)| json!({"t": t, "at": at}))
                .collect::<Vec<_>>()
        });
        out.insert(l.id.clone(), json!({"window": window, "samples": samples}));
    }
    json!({"outcome": "checked", "issues": [], "trails": out})
}

/// The trail's evaluated-data hash: SHA-256 over each trace in order, its point count as a u32
/// little-endian, then each point's x, y and z as f64 little-endian.
fn hash(d: &trail::Drawn) -> String {
    let mut h = Sha256::new();
    for tr in &d.traces {
        h.update((tr.points.len() as u32).to_le_bytes());
        for p in &tr.points {
            for x in p {
                h.update(x.to_le_bytes());
            }
        }
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// A frame's `trails` report on the lines `asked` names: each one's hash, its source at t and
/// its traces as drawn; none when nothing is asked.
pub(crate) fn report(scene: &Scene, asked: &Value) -> Option<Value> {
    let asked: Vec<&str> = asked.as_array()?.iter().filter_map(Value::as_str).collect();
    let mut out = Map::new();
    for l in trails(scene).filter(|l| asked.contains(&l.id.as_str())) {
        let d = l.trail.as_ref().expect("filtered");
        let traces: Vec<Value> = d
            .traces
            .iter()
            .map(|tr| json!({"start": tr.start, "end": tr.end, "points": tr.points}))
            .collect();
        out.insert(
            l.id.clone(),
            json!({"hash": hash(d), "source": d.source, "traces": traces}),
        );
    }
    Some(Value::Object(out))
}

/// The places each whole trail's source stood at every frame this process drew, by line: the
/// planted `trail_appends_per_frame` draws these.
static APPENDED: Mutex<BTreeMap<String, Appended>> = Mutex::new(BTreeMap::new());
/// Each frame's time and the source's place then.
type Appended = Vec<(i64, [f64; 3])>;

/// The planted `trail_appends_per_frame` (tests/acceptance/450/README.md: Planted programs): each
/// `whole` trail draws its source at every frame drawn so far, in order, ending with this one's,
/// in place of its bake's samples before t and the source at t.
pub(crate) fn plant(scene: &mut Scene, planted: Option<Planted>, t: i64) {
    if planted != Some(Planted::TrailAppendsPerFrame) {
        return;
    }
    let mut held = APPENDED.lock().unwrap_or_else(|e| e.into_inner());
    for layer in &mut scene.layers {
        for l in &mut layer.lines {
            let Some(d) = l.trail.as_ref() else {
                continue;
            };
            if !matches!(d.trail.window, Window::Whole { .. }) {
                continue;
            }
            let mut d = (**d).clone();
            let kept = held.entry(l.id.clone()).or_default();
            kept.push((t, d.source));
            d.traces = vec![trail::Trace {
                start: kept[0].0,
                end: t,
                times: kept.iter().map(|k| k.0).collect(),
                points: kept.iter().map(|k| k.1).collect(),
            }];
            let tr = d.trail.clone();
            *l = trail::line(&l.id, &tr, d, l.color, l.world, l.cap);
        }
    }
}
