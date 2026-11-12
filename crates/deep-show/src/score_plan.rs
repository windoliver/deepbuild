//! #154: `score_plan {doc, item}` (canvas primitives: Score, As built). The score's check resolves
//! each event's onset through the tempo map; the plan splits it into stems, each one job request
//! for `score.render` on `score-render@1.0.0`: that stem's events in samples, its instruments with
//! each library preset's zones and its takes by hash, its libraries' licenses, the score's seed
//! and the loop region in samples. A stem's request holds nothing of another stem's, so its job
//! key moves only when it does. A library take not yet in the evidence store makes the plan
//! BLOCKED, naming its pack, so the hub's fetch runs first.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas_motion::score::{self, Source};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::Hub;

pub const KIND: &str = "score.render";
pub const TOOL: &str = "score-render@1.0.0";

/// A sampled preset's zone that plays `pitch`, as the renderer picks it: the one whose range
/// holds the rounded pitch, else the one whose root is nearest.
fn zone_of(zones: &[Value], pitch: f64) -> Option<&Value> {
    let m = pitch.round();
    zones
        .iter()
        .find(|z| {
            z["lo"].as_f64().is_some_and(|lo| lo <= m) && z["hi"].as_f64().is_some_and(|hi| m <= hi)
        })
        .or_else(|| {
            zones.iter().min_by(|a, b| {
                let d = |z: &Value| (z["root"].as_f64().unwrap_or(f64::MAX) - pitch).abs();
                d(a).total_cmp(&d(b))
            })
        })
}

fn issue(code: &str, path: String, what: String) -> Value {
    json!({"code": code, "path": path, "what": what})
}

/// The preset a sampled instrument plays: its library's reference, manifest and `samples` entry.
fn preset_of<'m>(
    libraries: &'m BTreeMap<String, Value>,
    inst: &score::Instrument,
) -> Option<(&'m str, &'m Value, &'m Value)> {
    let Source::Sampled { library, preset } = &inst.source else {
        return None;
    };
    let (key, m) = libraries.get_key_value(library)?;
    Some((key.as_str(), m, m.pointer(&format!("/samples/{preset}"))?))
}

/// The libraries a score's sampled instruments name, each manifest once, and what only those
/// manifests can raise: an unknown library or preset, and a note on a sustained library preset
/// below MIDI 48 on an instrument not marked bass (errors); a note more than 4 semitones from its
/// zone's root (a warning). Each names its instrument or event.
fn library_rules(s: &score::Score, base: &str) -> (BTreeMap<String, Value>, Vec<score::Problem>) {
    let problem = |code, severity, path, what| score::Problem {
        code,
        severity,
        path,
        what,
    };
    let mut libraries = BTreeMap::new();
    let mut found = Vec::new();
    for inst in s.instruments.values() {
        let Source::Sampled { library, preset } = &inst.source else {
            continue;
        };
        let at = format!("{base}/instruments/{}/source", inst.id);
        match crate::packs::manifest_of(library) {
            None => found.push(problem("score.unknown_library", "error", at, format!("the instrument {} names the library {library}, which isn't installed", inst.id))),
            Some(m) if m.pointer(&format!("/samples/{preset}")).is_none() => found.push(problem("score.unknown_preset", "error", at, format!("the instrument {} names the preset {preset}, which {library}'s samples don't list", inst.id))),
            Some(m) => {
                libraries.insert(library.clone(), m);
            }
        }
    }
    for n in &s.notes {
        let inst = &s.instruments[&n.inst];
        let path = format!("{base}/events/{}", n.id);
        let Some((_, _, preset)) = preset_of(&libraries, inst) else {
            continue;
        };
        if preset["sustained"].as_bool() == Some(true) && !inst.bass && n.pitch < score::PAD_LOWEST
        {
            found.push(problem("score.pad_too_low", "error", path.clone(), format!("the event {}: it plays MIDI {} on the sustained pad {}, below MIDI 48, and the instrument isn't marked bass", n.id, n.pitch, inst.id)));
        }
        let zones = preset["zones"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        if let Some(root) = zone_of(zones, n.pitch).and_then(|z| z["root"].as_f64()) {
            if (n.pitch - root).abs() > 4.0 {
                found.push(problem("score.far_from_sample", "warning", path, format!("the event {}: MIDI {} is {:.2} semitones from its sample's root {root}, more than 4", n.id, n.pitch, (n.pitch - root).abs())));
            }
        }
    }
    (libraries, found)
}

/// `deep show`'s check of a document's scores against their libraries' manifests (#154): the
/// issues of [`library_rules`] after the canvas core's own, which can't read a pack's `samples`.
pub(crate) fn library_issues(doc: &Value, mut issues: Vec<Issue>) -> Vec<Issue> {
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if item.get("kind").and_then(Value::as_str) != Some("score.music@1") {
            continue;
        }
        // A score the core's rule refused is already named there.
        let Ok((s, _)) = score::read(doc, id) else {
            continue;
        };
        for p in library_rules(&s, &format!("items/{id}/params")).1 {
            let mut i = Issue::error(p.code, id, p.path, Value::Null, &p.what);
            i.severity = p.severity;
            issues.push(i);
        }
    }
    issues
}

impl Hub<'_> {
    pub(crate) fn score_plan(&mut self, c: &Value) -> Value {
        // `doc` is a document shown earlier in the scenario, by its ID, or a document itself.
        let shown = c
            .get("doc")
            .and_then(Value::as_str)
            .and_then(|d| self.current(d))
            .map(|r| r.doc.clone());
        let (Some(doc), Some(item)) = (
            shown.as_ref().or(c.get("doc").filter(|d| d.is_object())),
            c.get("item").and_then(Value::as_str),
        ) else {
            return json!({"code": "bad_call", "what": "score_plan takes {doc, item}: doc a shown document's ID or a document"});
        };
        let kind = doc
            .pointer(&format!("/items/{item}/kind"))
            .and_then(Value::as_str);
        if kind != Some("score.music@1") {
            return json!({"code": "ref_unresolved", "what": format!("{item} is no score.music@1 item"), "item": item});
        }
        let (s, warnings) = match score::read(doc, item) {
            Ok(r) => r,
            Err(errors) => {
                let issues: Vec<Value> = errors
                    .into_iter()
                    .map(|p| issue(p.code, p.path, p.what))
                    .collect();
                return json!({"outcome": "refused", "code": issues[0]["code"], "issues": issues});
            }
        };
        let (libraries, found) = library_rules(&s, &format!("items/{item}/params"));
        let (errors, more): (Vec<_>, Vec<_>) =
            found.into_iter().partition(|p| p.severity == "error");
        let warned: Vec<Value> = warnings
            .into_iter()
            .chain(more)
            .map(|p| issue(p.code, p.path, p.what))
            .collect();
        if !errors.is_empty() {
            let issues: Vec<Value> = errors
                .into_iter()
                .map(|p| issue(p.code, p.path, p.what))
                .collect();
            return json!({"outcome": "refused", "code": issues[0]["code"], "issues": issues, "warnings": warned});
        }

        let loop_samples = s
            .loop_region
            .map(|(a, b)| json!({"start": score::sample_of(a), "end": score::sample_of(b)}));
        let mut stems: BTreeMap<String, Value> = BTreeMap::new();
        let mut missing: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let names: std::collections::BTreeSet<&str> =
            s.instruments.values().map(|i| i.stem.as_str()).collect();
        for stem in names {
            let mut takes: Vec<String> = Vec::new();
            let mut credits: Vec<Value> = Vec::new();
            let mut instruments = Map::new();
            for inst in s.instruments.values().filter(|i| i.stem == stem) {
                let source = match &inst.source {
                    Source::Pluck { preset, overrides } => {
                        json!({"pluck": {"preset": preset, "overrides": overrides}})
                    }
                    Source::Synth { preset } => json!({"synth": {"preset": preset}}),
                    Source::Sampled { .. } => {
                        let Some((library, m, preset)) = preset_of(&libraries, inst) else {
                            continue;
                        };
                        let assets = m["assets"]
                            .as_array()
                            .map(Vec::as_slice)
                            .unwrap_or_default();
                        let mut zones = Vec::new();
                        for z in preset["zones"].as_array().into_iter().flatten() {
                            let mut idx = Vec::new();
                            for path in z["takes"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                            {
                                let Some(a) =
                                    assets.iter().find(|a| a["path"].as_str() == Some(path))
                                else {
                                    continue;
                                };
                                let sha = a["sha256"].as_str().unwrap_or_default().to_string();
                                if evidence::read(&self.scenario.evidence, &sha).is_none() {
                                    missing
                                        .entry(library.to_string())
                                        .or_default()
                                        .push(path.to_string());
                                }
                                let credit = json!({"id": a.pointer("/license/id"), "credit": a.pointer("/license/credit")});
                                if !credits.contains(&credit) {
                                    credits.push(credit);
                                }
                                let k = takes.iter().position(|t| *t == sha).unwrap_or_else(|| {
                                    takes.push(sha.clone());
                                    takes.len() - 1
                                });
                                idx.push(k);
                            }
                            zones.push(json!({"lo": z["lo"], "hi": z["hi"], "root": z["root"], "takes": idx}));
                        }
                        json!({"sampled": {"library": library, "preset": preset_name(&inst.source), "sustained": preset["sustained"].as_bool().unwrap_or(false), "zones": zones}})
                    }
                };
                instruments.insert(
                    inst.id.clone(),
                    json!({"source": source, "bass": inst.bass}),
                );
            }
            let events: Vec<Value> = s
                .notes
                .iter()
                .filter(|n| n.stem == stem)
                .map(|n| {
                    let mut e = n.rest.clone();
                    e.insert("id".into(), json!(n.id));
                    e.insert("inst".into(), json!(n.inst));
                    e.insert("at".into(), json!(n.sample));
                    e.insert("dur".into(), json!(n.dur_samples));
                    e.insert("pitch".into(), json!(n.pitch));
                    Value::Object(e)
                })
                .collect();
            let params = json!({
                "stem": stem, "seed": s.seed, "sample_rate": score::RATE, "format": "flac",
                "loop": loop_samples, "credits": credits, "instruments": instruments, "events": events,
            });
            let inputs: Vec<Value> = takes
                .iter()
                .map(|sha| json!({"name": "samples", "sha256": sha}))
                .collect();
            stems.insert(
                stem.to_string(),
                json!({"kind": KIND, "tool": TOOL, "params": params, "inputs": inputs}),
            );
        }
        if let Some((pack, paths)) = missing.into_iter().next() {
            return json!({
                "state": "BLOCKED", "pack": pack, "assets": paths,
                "reason": format!("the library {pack}'s takes aren't fetched yet: open a document that lists {pack} in its packs, or fetch them with deep_kinds, then plan again"),
            });
        }
        let note_on: Vec<Value> = s
            .notes
            .iter()
            .map(|n| json!({"t": n.t, "sample": n.sample, "event": n.id, "stem": n.stem}))
            .collect();
        json!({
            "item": item, "seed": s.seed, "stems": stems, "note_on": note_on,
            "loop": s.loop_region.map(|(a, b)| json!({"from": a, "to": b})), "warnings": warned,
        })
    }
}

fn preset_name(s: &Source) -> &str {
    match s {
        Source::Sampled { preset, .. }
        | Source::Pluck { preset, .. }
        | Source::Synth { preset } => preset,
    }
}
