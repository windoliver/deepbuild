//! Issue #501: the `export.target@1` kit. Every sealed target exports a fixture holding a hidden
//! item, a selected item and a session cutaway; the output must be byte-identical to the export
//! with no session state, the hidden item handled as the target declares, and the document's
//! revisions and the session state unchanged afterwards.

use std::path::Path;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::export::{Job, Span};
use crate::hub::Hub;

/// The kit's document ID: a revision the kit's own exports could write lands here.
const KIT_DOC: &str = "kit:export.target@1";
const REGISTRY: &str = "export.target@1";

/// The fixture: a 3D film with a selected box, a turning box, a hidden box `ghost` and a
/// view-class cutaway that cuts nothing by default.
fn fixture(ghost: bool) -> Value {
    let layer = "kit";
    let box_ = |id: &str, x: f64, role: &str, order: &str| {
        json!({"id": id, "kind": "mark.box@1", "layer": layer, "name": id, "order": order,
            "params": {"size": [1, 1, 1], "paint": {"fill": {"role": role}}}, "at": {"pos": [x, 0, 0]}})
    };
    let mut items = serde_json::Map::new();
    items.insert("cam".into(), json!({"id": "cam", "kind": "camera@1", "layer": layer, "name": "cam", "order": "a0",
        "params": {"projection": "perspective", "position": [0, 1.5, 6], "target": [0, 0, 0], "fov": 40}}));
    items.insert("sel".into(), box_("sel", -1.6, "accent", "a1"));
    items.insert("core".into(), box_("core", 0.0, "ink", "a2"));
    if ghost {
        let mut g = box_("ghost", 1.6, "live", "a3");
        g["visible"] = json!(false);
        items.insert("ghost".into(), g);
    }
    items.insert("cut".into(), json!({"id": "cut", "kind": "cutaway@1", "layer": layer, "name": "cut", "order": "a4",
        "params": {"planes": [{"normal": [1, 0, 0], "offset": 100}], "class": "view"}}));
    json!({
        "format": 1, "profile": "film", "title": "export.target@1 kit", "size": [64, 36],
        "layers": {layer: {"writer": "kit", "title": "Kit", "order": "a0"}},
        "camera": "cam", "transport": {"span": "0.25s", "frame_rate": [24, 1]},
        "requires": {"modules": {"scene3d": "^1"}},
        "channels": {"turn": {"target": "items/core/at/rot/1", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 0, "interp": "linear"}, "k1": {"t": "0.25s", "value": 30, "interp": "linear"}}}},
        "items": items,
    })
}

/// The session state the kit sets: `sel` selected, and the cutaway's view input cutting
/// through the scene.
fn session() -> Value {
    json!({"selection": ["sel"], "view": {"cut": {"planes": [{"normal": [1, 0, 0], "offset": 0}]}}})
}

/// Every file under `dir`, by relative path and SHA-256, sorted.
fn files_under(dir: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if let Ok(bytes) = std::fs::read(&p) {
                let rel = p.strip_prefix(dir).unwrap_or(&p).to_string_lossy().into_owned();
                let sha: String = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
                out.push((rel, sha));
            }
        }
    }
    out.sort();
    out
}

impl Hub<'_> {
    /// `kit` over registries: each named registry's own kit; only `export.target@1` has one.
    pub(crate) fn registry_kit(&mut self, registries: &[String]) -> Value {
        let mut reports = Vec::new();
        for name in registries {
            if name != REGISTRY {
                reports.push(json!({"registry": name, "verdict": "BLOCKED", "entries": [],
                    "why": "no kit of its own; only export.target@1 has one"}));
                continue;
            }
            let targets: Vec<(String, Value)> = self
                .startup
                .sealed
                .registry(REGISTRY)
                .map(|r| r.entries.iter().map(|e| (e.name.clone(), e.value.clone())).collect())
                .unwrap_or_default();
            let mut entries = Vec::new();
            for (target, value) in targets {
                let failures = self.target_case(&target, &value);
                entries.push(json!({"name": target, "verdict": if failures.is_empty() { "PASS" } else { "FAIL" },
                    "failures": failures}));
            }
            let pass = entries.iter().all(|e| e["verdict"] == "PASS");
            reports.push(json!({"registry": REGISTRY, "verdict": if pass { "PASS" } else { "FAIL" }, "entries": entries}));
        }
        json!({"registries": reports})
    }

    /// One target's case; each failure names the target.
    fn target_case(&mut self, target: &str, entry: &Value) -> Vec<String> {
        let dir = std::env::temp_dir().join(format!("deep-kit-export-{}-{target}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let codec = match target {
            "video" => "h264",
            "png" => "png_seq",
            other => other,
        };
        let job = |out: &Path| Job {
            doc: KIT_DOC.into(),
            range: Span::Whole,
            size: None,
            frame_rate: None,
            codec: codec.into(),
            alpha: false,
            sample_rate: None,
            audio_codec: "pcm".into(),
            shards: 1,
            timecode: "00:00:00:00".into(),
            drop_frame: false,
            out: out.to_string_lossy().into_owned(),
            software: false,
            readback: false,
            track: Vec::new(),
        };
        let revisions = |hub: &Hub| -> Vec<(u64, String, &'static str)> {
            hub.revisions.get(KIT_DOC).map_or_else(Vec::new, |rows| {
                rows.iter().map(|r| (r.rev, r.hash.clone(), r.state)).collect()
            })
        };
        let mut failures = Vec::new();
        let mut export = |hub: &mut Hub, doc: Value, name: &str| -> Option<(Vec<(String, String)>, Value)> {
            let at = dir.join(name);
            let _ = std::fs::create_dir_all(&at);
            let reply = hub.export_doc(&job(&at.join("out")), doc);
            if reply["outcome"] != "exported" {
                failures.push(format!("{target}: the export {name} isn't delivered: {reply}"));
                return None;
            }
            Some((files_under(&at), reply["receipt"].clone()))
        };
        // With the session state set; the revisions and the state are read around it.
        self.session_state.insert(KIT_DOC.into(), session());
        let before = revisions(self);
        let with = export(self, fixture(true), "with_session");
        let state_after = self.session_state.get(KIT_DOC).cloned();
        let after = revisions(self);
        self.session_state.remove(KIT_DOC);
        let without = export(self, fixture(true), "without_session");
        let no_ghost = export(self, fixture(false), "without_hidden");
        self.revisions.remove(KIT_DOC);
        let _ = std::fs::remove_dir_all(&dir);
        if after != before {
            failures.push(format!("{target}: the export wrote a revision of the document: {before:?} became {after:?}"));
        }
        if state_after != Some(session()) {
            failures.push(format!("{target}: the session state changed to {state_after:?}"));
        }
        if let (Some((a, _)), Some((b, receipt))) = (&with, &without) {
            let a: Vec<_> = a.iter().map(|(p, h)| (p.replacen("with_session", "", 1), h)).collect();
            let b: Vec<_> = b.iter().map(|(p, h)| (p.replacen("without_session", "", 1), h)).collect();
            if a != b {
                failures.push(format!("{target}: the export with session state isn't byte-identical to the export with none"));
            }
            match entry["hidden"].as_str() {
                Some("left_out") => {
                    let c: Vec<_> = no_ghost.iter().flat_map(|(c, _)| c.iter().map(|(p, h)| (p.replacen("without_hidden", "", 1), h))).collect();
                    if c != b {
                        failures.push(format!("{target}: it declares hidden items left out, but its export differs from the export without them"));
                    }
                }
                Some("listed") => {
                    if !receipt["hidden"].as_array().is_some_and(|h| h.contains(&json!("ghost"))) {
                        failures.push(format!("{target}: it declares hidden items listed, but its receipt lists {}", receipt["hidden"]));
                    }
                }
                other => failures.push(format!("{target}: it declares hidden: {other:?}")),
            }
        }
        failures
    }
}
