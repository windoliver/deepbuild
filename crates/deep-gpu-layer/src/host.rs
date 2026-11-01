//! The `host` call (issue #382; tests/acceptance/382/README.md, The surface under test): a
//! document shown inside a host (a return card, an item's level-of-detail `open`, a sheet cell)
//! through the GPU layer. In every kind the document is shown inside a view of the record, so
//! status can show whatever it binds, and the host's status map, legend and status distance apply
//! (The status-color rule: "A document shown inside another takes its host's status map, legend
//! and status distance"). A writer's revision is checked by the host (the document check in the
//! host's look, the status distance among it) and becomes current only when the check passes; the
//! host's cache of what it shows is keyed by the shown revision's content key, its size, its
//! treatment and its look, so a new revision misses it (Content key).

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};

use deep_canvas::document::{canonical_in, check_in, Issue};
use deep_canvas::registry::Sealed;
use deep_canvas_marks::look::Status;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels};
use deep_gpu::device::Backend;
use deep_scene3d_render::status::Mode;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::frames::{hex, Capture};
use crate::session3::{self, lock};
use crate::status;
use crate::view3d::{
    apply_patch, pair, picks_json, png, write_final, write_named, FLICKS_PER_SECOND,
};
use crate::{effects, plugin, refused, App, Planted};

const KINDS: [&str; 3] = ["return_card", "lod_open", "sheet_cell"];

/// The set a host checks a revision in: the shipped build's modules, effects among them (the live
/// view's set leaves effects out, since that path draws none).
fn sealed() -> &'static Sealed {
    static SEALED: OnceLock<Sealed> = OnceLock::new();
    SEALED.get_or_init(|| plugin::shipped().expect("the shipped canvas modules seal"))
}

struct Args {
    kind: String,
    theme: String,
    size: [u32; 2],
    doc: Value,
    /// The host's look: its status map, legend and distance apply.
    host_json: Value,
    host_status: Status,
    /// The host look's ink: the legend's text color.
    host_ink: [u8; 3],
    /// The look whose roles color the document's items: the document's own, else the host's.
    draw_json: Value,
    draw: Look3,
    /// The document's own status map, when its look has one (the planted host keeps it).
    doc_status: Option<Status>,
    states: BTreeMap<String, String>,
    frames: u64,
    fps: u64,
    /// `(frame, writer, ops)`, in the call's order.
    revisions: Vec<(u64, String, Value)>,
    targets: Vec<String>,
    capture: Capture,
}

fn parse(call: &Value) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let kind = call["kind"]
        .as_str()
        .filter(|k| KINDS.contains(k))
        .ok_or_else(|| bad("kind is return_card, lod_open or sheet_cell"))?
        .to_string();
    let theme = status::theme_of(call)?;
    let host_json = status::themed(&call["look"], &theme);
    let host = Look3::read(&host_json).map_err(|e| bad(&format!("look: {e}")))?;
    let host_status =
        status::status_of(&host_json)?.ok_or_else(|| bad("look has no status map"))?;
    let (draw_json, draw, doc_status) = match call.get("doc_look") {
        None | Some(Value::Null) => (host_json.clone(), host.clone(), None),
        Some(l) => {
            let json = status::themed(l, &theme);
            let look = Look3::read(&json).map_err(|e| bad(&format!("doc_look: {e}")))?;
            let status = status::status_of(&json)?;
            (json, look, status)
        }
    };
    let size = pair(&call["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
    }
    let mut revisions = Vec::new();
    for r in call["revisions"].as_array().into_iter().flatten() {
        let (Some(frame), Some(writer)) = (r["frame"].as_u64(), r["writer"].as_str()) else {
            return Err(bad("a revision is {frame, writer, ops}"));
        };
        revisions.push((frame, writer.to_string(), r["ops"].clone()));
    }
    let targets: Vec<String> = call["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect();
    if targets
        .iter()
        .any(|t| !matches!(t.as_str(), "final" | "ids"))
    {
        return Err(bad("targets are final and ids"));
    }
    let capture = match &call["capture"] {
        Value::String(s) if s == "every" => Capture::Every,
        Value::Array(f) => Capture::Frames(f.iter().filter_map(Value::as_u64).collect()),
        _ => Capture::None,
    };
    Ok(Args {
        kind,
        theme,
        size,
        doc,
        host_json,
        host_status,
        host_ink: host.role("ink").unwrap_or([0, 0, 0]),
        draw_json,
        draw,
        doc_status,
        states: status::states(call).ok_or_else(|| bad("states maps handles to states"))?,
        frames: call["frames"].as_u64().unwrap_or(1).max(1),
        fps: call["fps"].as_u64().unwrap_or(60).max(1),
        revisions,
        targets,
        capture,
    })
}

/// One revision's check by the host: the document check in the build's sealed set, then its data
/// roles against the host's status map at the host's distance. The clash is the look's refusal
/// as a check issue, so a reply can carry it with the rest.
fn check(
    doc: &Value,
    look_json: &Value,
    roles: &Look3,
    status: &Status,
    theme: &str,
) -> (bool, Vec<Value>, Option<Value>) {
    let result = check_in(doc, sealed());
    let mut issues: Vec<Value> = result.issues.iter().map(Issue::to_json).collect();
    let mut clash = None;
    if let Some(r) = status::clash(doc, look_json, roles, status, theme) {
        let role = r["role"].as_str().unwrap_or("").to_string();
        let state = r["state"].as_str().unwrap_or("");
        let issue = Issue {
            ids: Vec::new(),
            fix: "Change the role so the document's colors keep the host's status distance.".into(),
            ..Issue::error(
                "status_distance",
                "",
                format!("look/roles/{role}"),
                json!({"role": role, "state": state, "theme": theme}),
                &format!("the data role `{role}` comes within the status distance of {state}"),
            )
        };
        issues.push(issue.to_json());
        clash = Some(r);
    }
    let ok = !issues.iter().any(|i| i["severity"] == "error");
    (ok, issues, clash)
}

/// The host's cache key for what it shows: the shown revision's content key (the planted host's:
/// the document's ID), the size, the treatment (the kind) and the look.
fn cache_key(args: &Args, doc: &Value, planted: Option<Planted>) -> Result<String, Value> {
    let content = if planted == Some(Planted::HostCacheByDocId) {
        doc["id"].as_str().unwrap_or("").to_string()
    } else {
        canonical_in(doc, &sealed().kinds())
            .map(|c| c.sha256)
            .map_err(|e| refused("out_of_range", format!("{}: {}", e.path, e.what)))?
    };
    let mut h = Sha256::new();
    for part in [
        "host@1",
        &args.kind,
        &args.theme,
        &format!("{}x{}", args.size[0], args.size[1]),
        &args.host_json.to_string(),
        &args.draw_json.to_string(),
        &content,
    ] {
        h.update(part.as_bytes());
        h.update([0]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// What the host cached for one key: the slot's bytes and the revision they show.
struct Cached {
    rev: u64,
    bytes: Vec<u8>,
    targets: Option<(Vec<u8>, Vec<u8>)>,
    picks: Vec<(String, u32)>,
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let mut args = parse(call)?;
    let noop = app.backend == Backend::Noop;
    // The status map, legend and distance that apply: the host's; the planted host keeps the
    // document's own where it has one.
    let status = match (app.planted, &args.doc_status) {
        (Some(Planted::HostKeepsDocumentLook), Some(s)) => s.clone(),
        _ => args.host_status.clone(),
    };
    // The host's own ink draws the legend over the guarded frame, so it keeps the distance too.
    if let Some(r) = status::role_clash("ink", args.host_ink, &status, &args.theme) {
        return Err(r);
    }
    let mut bindings = status::bindings(&args.doc)?;
    // Revision 1: the document as shown; a clash refuses the call, naming the role and the state.
    let mut checks = Vec::new();
    let (ok, issues, clash) = check(&args.doc, &args.draw_json, &args.draw, &status, &args.theme);
    checks.push(json!({"rev": 1, "ok": ok, "issues": issues}));
    if let Some(c) = clash {
        return Err(c);
    }
    if !ok {
        let first = issues
            .iter()
            .find(|i| i["severity"] == "error")
            .cloned()
            .unwrap_or(Value::Null);
        return Err(json!({"ok": false, "code": first["code"], "issues": issues}));
    }
    let size = args.size;
    let opened = session3::open(app, size, false, true)?;
    let fx = opened.fx.clone();
    let mut text = status::Text::default();
    let mut labels = Labels::new();
    let mut cache: HashMap<String, Cached> = HashMap::new();
    let mut frames = Vec::new();
    let mut report = (Value::Array(Vec::new()), Value::Array(Vec::new()));
    let mut moved: Option<u32> = None;
    let (mut rev, mut current_rev) = (1u64, 1u64);
    let doc_seed = args.doc["seed"].as_u64().unwrap_or(0);
    let wants_targets = args.targets.contains(&"ids".to_string());
    let result = (|| -> Result<(), Value> {
        for n in 0..args.frames {
            // A writer's revision committed at this frame: checked by the host, current only when
            // its check passes; a refusal keeps the last good one.
            for (k, (frame, writer, ops)) in args.revisions.iter().enumerate() {
                if *frame != n {
                    continue;
                }
                rev += 1;
                let mut candidate = args.doc.clone();
                apply_patch(&mut candidate, writer, ops, k)?;
                let accepted = if app.planted == Some(Planted::HostCheckOnce) {
                    true
                } else {
                    let (ok, issues, _) = check(
                        &candidate,
                        &args.draw_json,
                        &args.draw,
                        &status,
                        &args.theme,
                    );
                    checks.push(json!({"rev": rev, "ok": ok, "issues": issues}));
                    ok
                };
                if accepted {
                    // The revision's bindings are the ones the host draws from here on; a
                    // revision whose bindings don't resolve is refused like any other.
                    match status::bindings(&candidate) {
                        Ok(b) => {
                            bindings = b;
                            args.doc = candidate;
                            current_rev = rev;
                        }
                        Err(r) => match checks.last_mut().filter(|c| c["rev"] == json!(rev)) {
                            Some(last) => {
                                last["ok"] = json!(false);
                                if let Some(issues) = last["issues"].as_array_mut() {
                                    issues.push(r);
                                }
                            }
                            None => checks.push(json!({"rev": rev, "ok": false, "issues": [r]})),
                        },
                    }
                }
            }
            let t = (n * FLICKS_PER_SECOND / args.fps) as i64;
            let scene = Arc::new(
                evaluate(&args.doc, t, &args.draw, &mut labels)
                    .map_err(|r| refused(r.code, r.path))?,
            );
            let key = cache_key(&args, &args.doc, app.planted)?;
            let hit = cache.contains_key(&key);
            let capture = args.capture.wants(n);
            // Targets are read on every miss the call asks for: a later hit shows them too.
            let read_targets = wants_targets && !noop;
            if let Some(shown) = cache.get_mut(&key) {
                // The content key proves the pixels are the current revision's.
                shown.rev = current_rev;
            } else {
                let (layer, marks, legend) = status::layer(
                    &scene,
                    &args.draw,
                    args.host_ink,
                    &status,
                    &bindings,
                    &args.states,
                    &mut text,
                )?;
                if n == 0 {
                    report = (marks, legend);
                }
                if let Some(stage) = &opened.stage {
                    let mut st = lock(stage);
                    st.guard = Some(status::guard_of(&status, status.min_distance, Mode::Line));
                    st.layer = Some(layer);
                }
                lock(&fx).settings = effects::settings(
                    &scene,
                    &args.draw_json,
                    &args.draw,
                    &[],
                    n as f64 / args.fps as f64,
                    doc_seed,
                    effects::Seeding::Item,
                );
                let drawn = session3::draw(
                    app,
                    &opened,
                    scene.clone(),
                    args.draw.clone(),
                    n,
                    0,
                    read_targets,
                    n == 0,
                )?;
                if n == 0 {
                    moved = drawn.moved;
                }
                cache.insert(
                    key.clone(),
                    Cached {
                        rev: current_rev,
                        bytes: drawn.bytes.unwrap_or_default(),
                        targets: drawn.targets,
                        picks: drawn.picks,
                    },
                );
            }
            let shown = cache.get(&key).expect("drawn or hit");
            let mut frame = Map::new();
            frame.insert("frame".into(), json!(n));
            frame.insert("rev".into(), json!(shown.rev));
            frame.insert("current_rev".into(), json!(current_rev));
            frame.insert(
                "pixel_hash".into(),
                json!((!shown.bytes.is_empty()).then(|| hex(&shown.bytes))),
            );
            frame.insert("cache".into(), json!({"key": key, "hit": hit}));
            if capture && !shown.bytes.is_empty() && args.targets.contains(&"final".to_string()) {
                frame.insert("final".into(), json!(write_final(out, &shown.bytes, size)?));
            }
            if let (true, Some((_, ids))) = (capture && wants_targets, &shown.targets) {
                frame.insert(
                    "ids".into(),
                    json!(write_named(out, &png(ids, size)?, "png")?),
                );
                frame.insert("picks".into(), picks_json(&shown.picks));
            }
            frames.push(Value::Object(frame));
        }
        Ok(())
    })();
    session3::close(app);
    result?;
    let status_report = status::report(
        true,
        "host",
        Some(status.min_distance),
        Some(moved),
        report.0,
        report.1,
    );
    Ok(json!({"frames": frames, "checks": checks, "status": status_report}))
}
