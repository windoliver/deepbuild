//! #1938: the loop's extensions of two of the core's kinds (canvas primitives: Check input: loop
//! kinds), which read what the core can't: `document.validate`'s `assets`, against the evidence
//! store, and `document.budget`'s fix for a scene over its class, from the scene as evaluated
//! and the class budget's own estimate, measured again on the patched document.

use deep_canvas::document::check_packed;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate_with, Labels};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

pub const BUDGET: &str = "document.budget";

/// Whether `s` is an asset's SHA-256: 64 lowercase hex digits.
fn is_sha(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Every hash a document names, with the item that names it ("" for the envelope) and its path.
fn hashes(doc: &Value) -> Vec<(String, String, String)> {
    fn walk(v: &Value, id: &str, path: String, out: &mut Vec<(String, String, String)>) {
        match v {
            Value::String(s) if is_sha(s) => out.push((id.to_string(), path, s.clone())),
            Value::Object(m) => {
                for (k, x) in m {
                    walk(x, id, format!("{path}/{k}"), out);
                }
            }
            Value::Array(a) => {
                for (k, x) in a.iter().enumerate() {
                    walk(x, id, format!("{path}/{k}"), out);
                }
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        walk(&item["params"], id, format!("items/{id}/params"), &mut out);
    }
    for (name, a) in doc["assets"].as_object().into_iter().flatten() {
        if let Some(sha) = a["sha256"].as_str().filter(|s| is_sha(s)) {
            out.push((String::new(), format!("assets/{name}/sha256"), sha.to_string()));
        }
    }
    out
}

/// A material map slot's path, `items/<id>/params/maps/<slot>` or `…/normal_map`, from the path
/// of a hash under it.
fn map_slot(path: &str) -> Option<String> {
    let (head, rest) = path.split_once("/params/")?;
    let mut steps = rest.split('/');
    match steps.next()? {
        "maps" => Some(format!("{head}/params/maps/{}", steps.next()?)),
        "normal_map" => Some(format!("{head}/params/normal_map")),
        _ => None,
    }
}

/// Whether an envelope asset's record names its license: an `id`, or where it came `from`.
fn licensed(asset: &Value) -> bool {
    let l = &asset["license"];
    l["id"].as_str().is_some_and(|s| !s.is_empty()) || l.get("from").is_some()
}

fn issue(code: &str, ids: Vec<String>, path: &str, what: String, fix: &str) -> Value {
    json!({"check": deep_canvas::document::CHECK, "code": code, "severity": "error", "ids": ids,
           "path": path, "what": what, "fix": fix})
}

impl Hub<'_> {
    /// `document.validate`'s `assets: {missing: 0, maps: present, licenses: present}` on `doc`:
    /// each hash it names that the evidence store lacks, past `missing`, or under a material's
    /// map, raises `asset_missing` naming it, its fix the map slot unset where it is one, so the
    /// surface draws by its factor; and under `licenses: present`, each asset with no license on
    /// the record raises `license_missing`.
    pub(crate) fn asset_issues(&self, doc: &Value, assets: &Value) -> Vec<Value> {
        let allowed = assets["missing"].as_u64().unwrap_or(0) as usize;
        let maps = assets.get("maps").is_none_or(|m| m == "present");
        let licenses = assets.get("licenses").is_none_or(|l| l == "present");
        let named = hashes(doc);
        let mut gone: Vec<&(String, String, String)> = Vec::new();
        for h in &named {
            if !gone.iter().any(|g| g.2 == h.2)
                && crate::evidence::read(&self.scenario.evidence, &h.2).is_none()
            {
                gone.push(h);
            }
        }
        let mut out = Vec::new();
        for (id, path, sha) in &gone {
            let slot = map_slot(path);
            if !(gone.len() > allowed || maps && slot.is_some()) {
                continue;
            }
            let ids = if id.is_empty() { vec![] } else { vec![id.clone()] };
            let mut i = issue(
                "asset_missing",
                ids,
                path,
                format!("the asset {sha} isn't in the evidence store"),
                "Put the asset in the evidence store by its hash, or name one that is there.",
            );
            i["actual"] = json!({"sha256": sha});
            if let Some(slot) = slot {
                i["fix_ops"] = json!([{"op": "unset", "id": id, "path": slot}]);
            }
            out.push(i);
        }
        if licenses {
            let records = doc["assets"].as_object();
            let by_sha = |sha: &str| {
                records
                    .into_iter()
                    .flatten()
                    .find(|(_, a)| a["sha256"] == sha)
            };
            let mut seen: Vec<&str> = Vec::new();
            for (id, path, sha) in &named {
                if seen.contains(&sha.as_str()) {
                    continue;
                }
                seen.push(sha);
                let ok = by_sha(sha).is_some_and(|(_, a)| licensed(a));
                if ok {
                    continue;
                }
                let at = by_sha(sha).map_or(path.clone(), |(n, _)| format!("assets/{n}/license"));
                let ids = if id.is_empty() { vec![] } else { vec![id.clone()] };
                let mut i = issue(
                    "license_missing",
                    ids,
                    &at,
                    format!("the asset {sha} has no license on the record"),
                    "Name the asset in the document's assets with its license.",
                );
                i["actual"] = json!({"sha256": sha});
                out.push(i);
            }
        }
        out
    }

    /// `document.budget`'s fix for a scene over its class, chosen by measurement: the items it
    /// draws smallest on screen hidden, smallest first, until the class budget's own estimate of
    /// the patched document is within the class, as few as reach it, re-measured on that
    /// document, with the px of the picture they covered; where hiding can't reach it, those
    /// items removed. `None` where neither, over the items under 4 px, reaches it.
    pub(crate) fn over_class_fix(&self, doc: &Value) -> Option<(Vec<Value>, Value)> {
        let sealed = &self.startup.sealed;
        let over = |d: &Value| {
            check_packed(d, sealed, &self.packs)
                .issues
                .iter()
                .any(|i| i.code == "over_budget")
        };
        // Each item's box on screen at the start, from the scene as evaluated: where things are
        // reads no color, so marks with no paint take a stand-in role.
        let mut evaluated = doc.clone();
        for item in evaluated["items"]
            .as_object_mut()
            .into_iter()
            .flat_map(|m| m.values_mut())
        {
            let mark = item["kind"].as_str().is_some_and(|k| k.starts_with("mark."));
            if mark && item.get("material").is_none() && item.pointer("/params/paint").is_none() {
                item["params"]["paint"] = json!({"fill": {"role": "ink"}});
            }
        }
        let look = Look3::from_roles(self.look.light.clone());
        let evidence = self.scenario.evidence.clone();
        let read = move |sha: &str| crate::evidence::read(&evidence, sha);
        let scene = evaluate_with(&evaluated, 0, &look, &mut Labels::new(), &read).ok()?;
        let keep: Vec<&str> = doc
            .get("camera")
            .and_then(Value::as_str)
            .and_then(|c| doc["items"][c].pointer("/params/fit/keep")?.as_array())
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let mut boxes: Map<String, Value> = Map::new();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            let id = s.id.split('#').next().unwrap_or(&s.id).to_string();
            for p in s.points() {
                let Some([x, y, _]) = scene.camera.project(p) else { continue };
                let b = boxes.entry(id.clone()).or_insert(json!([x, y, x, y]));
                let v = |k: usize| b[k].as_f64().unwrap_or(0.0);
                *b = json!([v(0).min(x), v(1).min(y), v(2).max(x), v(3).max(y)]);
            }
        }
        let mut small: Vec<(f64, f64, String)> = boxes
            .iter()
            .filter(|(id, _)| !keep.contains(&id.as_str()))
            .filter_map(|(id, b)| {
                let v = |k: usize| b[k].as_f64().unwrap_or(0.0);
                let (w, h) = (v(2) - v(0), v(3) - v(1));
                let size = w.max(h);
                (size < 4.0).then(|| (size, (w.max(1.0)) * (h.max(1.0)), id.clone()))
            })
            .collect();
        small.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.2.cmp(&b.2)));
        // Hiding an item saves what drawing it costs; its document's lowering and compiling
        // still read it, so where those are over, it takes removing it.
        let hide = |d: &mut Value, id: &str| d["items"][id]["visible"] = json!(false);
        let remove = |d: &mut Value, id: &str| {
            if let Some(items) = d["items"].as_object_mut() {
                items.remove(id);
            }
        };
        let fixes: [(&str, &dyn Fn(&mut Value, &str)); 2] = [("hide", &hide), ("remove", &remove)];
        for (how, apply) in fixes {
            let fixed = |k: usize| {
                let mut d = doc.clone();
                for (_, _, id) in &small[..k] {
                    apply(&mut d, id);
                }
                d
            };
            if small.is_empty() || over(&fixed(small.len())) {
                continue;
            }
            // The fewest smallest items that bring the estimate within the class.
            let (mut lo, mut hi) = (0, small.len());
            while lo < hi {
                let mid = (lo + hi) / 2;
                if over(&fixed(mid)) {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            let chosen = &small[..lo];
            let ops = chosen
                .iter()
                .map(|(_, _, id)| match how {
                    "hide" => json!({"op": "set", "id": id, "path": format!("items/{id}/visible"), "value": false}),
                    _ => json!({"op": "delete", "id": id}),
                })
                .collect();
            let px: f64 = chosen.iter().map(|(_, a, _)| a).sum();
            let frame = scene.camera.size[0] * scene.camera.size[1];
            let measured = deep_canvas::cost::estimate(&fixed(lo), sealed, &sealed.costs);
            return Some((
                ops,
                json!({"how": how, "items": lo, "largest_px": chosen.last().map(|c| c.0),
                       "picture_px": px, "picture_share": px / frame.max(1.0),
                       "cpu_ms": measured.cpu_ms, "gpu_ms": measured.gpu_ms}),
            ));
        }
        None
    }
}
