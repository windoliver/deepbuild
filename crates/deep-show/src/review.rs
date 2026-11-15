//! #456: `render.review` (canvas primitives: Check input: loop kinds, and its ID view and
//! observations). A model's judgment of the brief, the modeled look and the mood, made in a fresh
//! context that holds only the brief, the document's outline, the snapshots and their ID views,
//! and recorded as a reading with the model and the exact context that made it. The reading never
//! passes a requirement: its row is INCONCLUSIVE at best, and a doubt opens one taste ask keyed by
//! the revision's hash, never asked again once answered. The model is the scenario's
//! `review_model`; no other path calls one.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use deep_canvas::registry::Frame;
use deep_canvas_loop::review::{self as lr, Numbered};
use serde_json::{json, Map, Value};

use crate::hub::{Claim, Hub, Planted, Requirement};
use crate::pixels::Drawn;

pub(crate) const KIND: &str = lr::KIND;
/// The asks a check input names when it names none.
const ASKS: [&str; 3] = ["matches_brief", "reads_as_modeled", "mood"];
/// The most findings a reading keeps.
const FINDINGS: usize = 5;

/// A finding an earlier review kept, and whether a later one ever marked it resolved.
struct Kept {
    finding: Value,
    resolved_once: bool,
}

/// What render.review keeps between verdicts in one run: the model calls made so far, and each
/// requirement's findings on each document.
#[derive(Default)]
pub(crate) struct State {
    calls: usize,
    found: BTreeMap<(String, String, String), Vec<Kept>>,
}

/// A row decided, as the verdict's other rows are.
fn row(r: &Requirement, result: &str, blocked: Vec<Value>) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("id".into(), json!(r.id));
    m.insert("kind".into(), json!(KIND));
    m.insert("issues".into(), json!([]));
    m.insert("machines".into(), json!("same"));
    m.insert("result".into(), json!(result));
    if !blocked.is_empty() {
        m.insert("blocked".into(), Value::Array(blocked));
    }
    m
}

/// The document's outline: each item's ID, kind, name, parent and material, by ID.
fn outline(doc: &Value) -> Value {
    let mut items: Vec<Value> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(id, it)| {
            let mut o = json!({"id": id, "kind": it["kind"]});
            for k in ["name", "parent", "material", "layer"] {
                if let Some(v) = it.get(k) {
                    o[k] = v.clone();
                }
            }
            o
        })
        .collect();
    items.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    json!({"size": doc["size"], "camera": doc["camera"], "items": items})
}

/// `ids` (`from` px a side) resampled to `to` px by nearest px.
fn resampled(ids: &[u32], from: [u32; 2], to: [u32; 2]) -> Vec<u32> {
    if from == to {
        return ids.to_vec();
    }
    let (fw, fh) = (from[0] as u64, from[1] as u64);
    (0..to[1] as u64)
        .flat_map(|y| (0..to[0] as u64).map(move |x| (x, y)))
        .map(|(x, y)| {
            let sx = (x * fw / u64::from(to[0])).min(fw - 1);
            let sy = (y * fh / u64::from(to[1])).min(fh - 1);
            ids.get((sy * fw + sx) as usize).copied().unwrap_or(0)
        })
        .collect()
}

/// The px of `rgba` (`w` wide) in `[x, y, w, h]`, clamped to the frame.
fn crop(rgba: &[u8], size: [u16; 2], b: [i64; 4]) -> ([u16; 4], Vec<u8>) {
    let (w, h) = (i64::from(size[0]), i64::from(size[1]));
    let x0 = b[0].clamp(0, w - 1);
    let y0 = b[1].clamp(0, h - 1);
    let x1 = (b[0] + b[2].max(1)).clamp(x0 + 1, w);
    let y1 = (b[1] + b[3].max(1)).clamp(y0 + 1, h);
    let mut out = Vec::with_capacity(((x1 - x0) * (y1 - y0) * 4) as usize);
    for y in y0..y1 {
        let i = ((y * w + x0) * 4) as usize;
        out.extend_from_slice(&rgba[i..i + ((x1 - x0) * 4) as usize]);
    }
    let shape = [x0, y0, x1 - x0, y1 - y0].map(|v| v as u16);
    (shape, out)
}

impl Hub<'_> {
    fn put(&self, bytes: &[u8]) -> Result<String, Value> {
        crate::evidence::put(&self.scenario.evidence, bytes)
            .map_err(|_| json!({"code": "not_written"}))
    }

    /// The model's next reply: the scenario's stub answers each call in turn.
    fn review_reply(&mut self) -> Result<(String, Value), Value> {
        let Some(model) = &self.scenario.review_model else {
            return Err(json!({"code": "no_model", "ask": "name the model render.review asks"}));
        };
        let name = model["name"].as_str().unwrap_or_default().to_string();
        let k = self.review.calls;
        self.review.calls += 1;
        match model["replies"].get(k) {
            Some(reply) => Ok((name, reply.clone())),
            None => Err(json!({"code": "model_unanswered", "model": name, "call": k})),
        }
    }

    /// #456: each render.review requirement's row on the claim, by requirement.
    pub(crate) fn review_rows(&mut self, claim: &str, c: &Claim) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        for r in c.requirements.iter().filter(|r| r.check["kind"] == KIND) {
            let row = match self.review_row(claim, c, r) {
                Ok(row) => row,
                Err(b) => row(r, "BLOCKED", vec![b]),
            };
            out.insert(r.id.clone(), Value::Object(row));
        }
        out
    }

    fn review_row(&mut self, claim: &str, c: &Claim, r: &Requirement) -> Result<Map<String, Value>, Value> {
        let [doc] = c.deliverables.as_slice() else {
            return Err(json!({"code": "one_deliverable", "ids": c.deliverables}));
        };
        let Some(cur) = self.current_of(doc) else {
            return Ok(row(r, "INVALID", Vec::new()));
        };
        let (rev, hash, document) = (cur.rev, cur.hash.to_string(), cur.doc.clone());
        let times = crate::pixels::times(&r.check);
        let frames = match self.frames_of(&document, &times, 1) {
            Drawn::Frames(f, _) => f,
            Drawn::Blocked(mut b) => {
                b["doc"] = json!(doc);
                return Err(b);
            }
            Drawn::Elsewhere(e) => {
                let mut m = row(r, "INCONCLUSIVE", Vec::new());
                m.insert("elsewhere".into(), json!([e]));
                return Ok(m);
            }
        };
        let grounded = r.check["grounding"].as_str() != Some("none");
        let salt = if self.planted(Planted::IdViewVariesByRun) {
            format!("{:?}", std::time::SystemTime::now())
        } else {
            String::new()
        };
        let camera = document["camera"].clone();
        let size = crate::snapshot::px([0, 1].map(|i| document["size"][i].as_f64().unwrap_or(1.0)));
        // The snapshots, as render-back draws them, and each one's ID view at its size.
        let mut snapshots = Vec::new();
        let mut views = Vec::new();
        let mut shown: Vec<(Vec<u8>, Vec<Numbered>)> = Vec::new();
        for f in &frames {
            let snap = crate::snapshot::png(f.rgba.clone(), size);
            let sha = self.put(&snap)?;
            snapshots.push(json!({"sha256": sha, "w": size[0], "h": size[1], "camera": camera, "t": f.t}));
            // The check input's kept items that the table doesn't list are numbered too, with no mark.
            let mut table = self.id_table(&document, f, size);
            for k in r.check["keep"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                if !table.iter().any(|t| t == k) {
                    table.push(k.to_string());
                }
            }
            let flat = Frame {
                size: [u32::from(size[0]), u32::from(size[1])],
                ids: resampled(&f.ids, f.size, [u32::from(size[0]), u32::from(size[1])]),
                picks: f.picks.clone(),
                ..Frame::default()
            };
            let view = lr::id_view(&flat, &table, &salt);
            if grounded {
                let png = crate::snapshot::png(view.rgba.clone(), size);
                let numbers: Vec<Value> = view
                    .items
                    .iter()
                    .map(|n| {
                        let item = &document["items"][&n.id];
                        json!({"n": n.n, "id": n.id, "kind": item["kind"], "material": item["material"], "at": n.at})
                    })
                    .collect();
                views.push(json!({"sha256": self.put(&png)?, "w": size[0], "h": size[1], "numbers": numbers}));
            }
            shown.push((f.rgba.clone(), view.items));
        }
        let asks: Vec<String> = match r.check["asks"].as_array() {
            Some(a) => a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect(),
            None => ASKS.map(str::to_string).to_vec(),
        };
        // The fresh context: the brief, the outline and the images, never the session.
        let mut context = json!({"check": KIND, "asks": asks, "observe": lr::OBSERVE, "brief": c.brief,
            "outline": outline(&document), "snapshots": snapshots, "id_views": views});
        if self.planted(Planted::ReviewSeesSession) {
            let reasons: Vec<String> = self
                .shared
                .get(doc)
                .into_iter()
                .flat_map(|s| s.revs.iter().map(|r| r.reason.clone()))
                .collect();
            let name = self.scenario.sessions.get(&c.session).map(|s| s.name.clone());
            context["session"] = json!({"name": name, "messages": self.messages(&c.session), "reasons": reasons});
        }
        let context_sha = self.put(context.to_string().as_bytes())?;
        let (model, reply) = self.review_reply()?;
        let mut reading = json!({"model": model, "context": context_sha, "answers": reply["answers"],
            "snapshots": snapshots, "observations": [], "dropped": 0, "findings": []});
        if grounded {
            reading["id_views"] = Value::Array(views);
        }
        let mut m = row(r, "INCONCLUSIVE", Vec::new());
        if let Some(words) = reply.get("unreadable") {
            reading["why"] = json!(format!("the model couldn't read its images: {}", words.as_str().unwrap_or_default()));
            m.insert("reading".into(), reading);
            return Ok(m);
        }
        // Observations, by the numbers of the first snapshot's ID view.
        let observations = reply["observations"].as_array().cloned().unwrap_or_default();
        let numbered: &[Numbered] = if grounded { shown.first().map_or(&[], |s| &s.1) } else { &[] };
        let (kept, mut dropped) = lr::sift(&observations, numbered, &[]);
        let mut listed: Vec<Value> = kept
            .iter()
            .map(|(category, n, id)| {
                let item = &document["items"][id];
                json!({"category": category, "item": n, "id": id, "kind": item["kind"], "material": item["material"]})
            })
            .collect();
        if self.planted(Planted::KeepsBadObservation) {
            for o in &observations {
                let known = o["item"].as_u64().is_some_and(|n| numbered.iter().any(|v| u64::from(v.n) == n));
                if !known && o["category"].as_str().is_some_and(|c| lr::OBSERVE.contains(&c)) {
                    listed.push(json!({"category": o["category"], "item": o["item"], "id": null}));
                    dropped = dropped.saturating_sub(1);
                }
            }
        }
        reading["observations"] = Value::Array(listed);
        reading["dropped"] = json!(dropped);
        // Findings: worst first, at most five, each with its evidence.
        let mut raw = reply["findings"].as_array().cloned().unwrap_or_default();
        raw.sort_by(|a, b| {
            let s = |v: &Value| v["severity"].as_f64().unwrap_or(0.0);
            s(b).total_cmp(&s(a))
        });
        if !self.planted(Planted::KeepsAllFindings) {
            raw.truncate(FINDINGS);
        }
        let mut findings = Vec::new();
        for f in raw {
            let k = f["snapshot"].as_u64().unwrap_or(0) as usize;
            let (Some(snap), Some((rgba, _))) = (snapshots.get(k), shown.get(k)) else {
                continue;
            };
            let b: Vec<i64> = f["crop"].as_array().into_iter().flatten().filter_map(Value::as_i64).collect();
            let b = if let [x, y, w, h] = b[..] { [x, y, w, h] } else { [0, 0, i64::from(size[0]), i64::from(size[1])] };
            let (cut, px) = crop(rgba, size, b);
            let crop_sha = self.put(&crate::snapshot::png(px, [cut[2], cut[3]]))?;
            let what = json!([f["symptom"], f["fix"], f["accept"], k, f["crop"]]).to_string();
            let id = format!("{}.{}", &hash[..12.min(hash.len())], &sha256_hex(what.as_bytes())[..8]);
            findings.push(json!({"id": id, "rev": rev, "severity": f["severity"], "symptom": f["symptom"], "fix": f["fix"],
                "accept": f["accept"], "snapshot": snap["sha256"], "crop": {"box": cut, "sha256": crop_sha}}));
        }
        // Each earlier finding on this requirement and document, measured on this revision.
        let key = (claim.to_string(), r.id.clone(), doc.clone());
        let mut earlier = Vec::new();
        let mut past = self.review.found.remove(&key).unwrap_or_default();
        for k in past.iter_mut().filter(|k| k.finding["rev"].as_u64() < Some(rev)) {
            let passes = self.accepted(doc, &k.finding["accept"]);
            let status = match (passes, k.resolved_once) {
                (true, _) => "resolved",
                (false, true) => "regressed",
                (false, false) => "remaining",
            };
            k.resolved_once |= passes;
            earlier.push(json!({"id": k.finding["id"], "status": status}));
        }
        for f in &findings {
            if !past.iter().any(|k| k.finding["id"] == f["id"]) {
                past.push(Kept { finding: f.clone(), resolved_once: false });
            }
        }
        self.review.found.insert(key, past);
        if !earlier.is_empty() {
            reading["earlier"] = Value::Array(earlier);
        }
        reading["findings"] = Value::Array(findings);
        // A doubt opens one taste ask, keyed by the revision's hash.
        let doubts = asks.iter().any(|a| reply["answers"][a.as_str()] != "yes");
        if doubts {
            let keyed = if self.planted(Planted::AskKeyedByWords) {
                sha256_hex(reply["observations"].to_string().as_bytes())
            } else {
                hash.clone()
            };
            let id = format!("{claim}/{}/{KIND}:{keyed}", r.id);
            let again = self.planted(Planted::AsksAgainAfterAnswer)
                && self.audit_asks.get(&id).is_some_and(Option::is_some);
            if !self.audit_asks.contains_key(&id) || again {
                self.audit_asks.insert(id.clone(), None);
                m.insert("asks".into(), json!([{"kind": "taste", "id": id, "requirement": r.id, "key": hash,
                    "why": format!("a model doubts revision {rev}: is it right?")}]));
            } else if self.audit_asks.get(&id) == Some(&None) {
                m.insert("pending".into(), json!([id]));
            }
        }
        // Planted (#456): a model that agrees and finds nothing passes the requirement.
        let agrees = !doubts && reading["findings"].as_array().is_some_and(Vec::is_empty);
        if self.planted(Planted::ReviewPassesOnYes) && agrees {
            m.insert("result".into(), json!("PASS"));
        }
        m.insert("reading".into(), reading);
        Ok(m)
    }

    /// Render-back's ID table of `doc` drawn as `f`: a 3D revision's visible items by their
    /// boxes, a 2D one's items its object-ID pass names; by ID.
    fn id_table(&mut self, doc: &Value, f: &Frame, size: [u16; 2]) -> Vec<String> {
        if crate::probe::draws_3d(doc) {
            let posed = crate::film::posed(doc, f.t).unwrap_or_else(|| doc.clone());
            if let Ok((scene, _)) = self.evaluate3d(&posed, f.t, size) {
                return crate::snapshot::visible(scene.boxes(), 1.0, size)
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v["id"].as_str().map(str::to_string))
                    .collect();
            }
        }
        let mut ids: Vec<String> = f.picks.values().map(|p| p.split('#').next().unwrap_or(p).to_string()).collect();
        ids.sort();
        ids.dedup();
        ids
    }

    /// Whether `accept`, a check input, passes on `doc`'s current revision.
    fn accepted(&mut self, doc: &str, accept: &Value) -> bool {
        let kind = accept["kind"].as_str().unwrap_or_default();
        if kind == KIND || !accept.is_object() {
            return false;
        }
        let r = Requirement { id: "accept".into(), check: accept.clone() };
        let mut drawn = BTreeMap::new();
        let frames = self.startup.sealed.check_kind(kind).and_then(|(_, c)| c.frames.map(|(d, _)| d));
        if let (Some(draws), Some(cur)) = (frames, self.current_of(doc).map(|c| c.doc.clone())) {
            let at = crate::pixels::times(accept);
            drawn.insert(doc.to_string(), self.frames_of(&cur, &at, draws));
        }
        let Some(cur) = self.current_of(doc) else {
            return false;
        };
        let docs = [(doc.to_string(), cur)];
        let session = String::new();
        let row = self.judge(&r, &docs, false, &BTreeMap::new(), &session, None, Some(&drawn));
        row["result"] == "PASS"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crop_is_the_frames_px_in_its_box_clamped_to_the_frame() {
        let size = [4u16, 3];
        let rgba: Vec<u8> = (0..4 * 3).flat_map(|i| [i as u8, 0, 0, 255]).collect();
        let (b, px) = crop(&rgba, size, [2, 1, 5, 1]);
        assert_eq!(b, [2, 1, 2, 1]);
        assert_eq!(px.chunks(4).map(|p| p[0]).collect::<Vec<_>>(), [6, 7]);
    }

    #[test]
    fn the_outline_names_every_item_and_no_param() {
        let doc = json!({"size": [2, 2], "camera": "cam", "items": {
            "b": {"kind": "mark.box@1", "material": "m", "params": {"secret": "x"}},
            "a": {"kind": "camera@1"}}});
        let text = outline(&doc).to_string();
        assert!(text.find("\"a\"") < text.find("\"b\""));
        assert!(!text.contains("secret"));
    }
}
