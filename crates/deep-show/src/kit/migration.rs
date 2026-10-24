//! The migration corpus and seeded param sets (issue #138; canvas primitives: Migration). Each
//! document an earlier release saved, migrated at load, must give the evaluated values and Vello
//! CPU snapshots its saving release recorded at every sampled time; a difference fails the
//! release, naming the kind, the item, the field and the first time that differs, until your
//! decision accepts the new result for its cause. For each kind with a migration, seeded param
//! sets drawn across its earliest major's schema must migrate to params the current major
//! accepts, keep every ID, and give identical bytes twice.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use deep_canvas::document::check_in;
use deep_canvas::kinds::ParamType;
use deep_canvas::schedule::{sha256_hex, Scheduler};
use serde_json::{json, Map, Value};

use super::catalog::stamped;
use super::instance::{self, How, Painter};
use super::{derive, failure, Case, Ctx, PartRun, Rng, Verdict};
use crate::hub::Hub;

/// What a build draws of a document at each time: each item's lowered form, by time and ID, and
/// the Vello CPU snapshot's digest.
pub struct Drawn {
    pub values: BTreeMap<i64, BTreeMap<String, Value>>,
    pub snapshots: BTreeMap<i64, String>,
}

/// Evaluates `doc` at each time on a new instance and draws it on Vello CPU.
pub fn draw(hub: &Hub<'_>, doc: &Value, times: &[i64]) -> Drawn {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let ground = hub.look.light.get("ground").copied().unwrap_or([255; 3]);
    let evidence = hub.scenario.evidence.clone();
    instance::fresh(|| {
        let mut painter = Painter::new(evidence, ground);
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut session = instance::session(&mut s, doc, &look, &BTreeMap::new());
        let view = instance::view(doc);
        let size = instance::fit(doc, 4096.0);
        let mut values = BTreeMap::new();
        let mut snapshots = BTreeMap::new();
        for &t in times {
            session.frame(&mut s, t, &view);
            let mut items = BTreeMap::new();
            for id in doc["items"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, _)| k)
            {
                if let Some(deep_canvas::schedule::Val::Json(v)) =
                    session.value(&s, "core.lowered", Some(id))
                {
                    items.insert(id.clone(), (*v).clone());
                }
            }
            values.insert(t, items);
            let shot = painter
                .pixels(&s, &session, size)
                .map(|px| sha256_hex(&px))
                .unwrap_or_else(|code| format!("unfit:{code}"));
            snapshots.insert(t, shot);
        }
        Drawn { values, snapshots }
    })
}

fn modules_of(hub: &Hub<'_>) -> Map<String, Value> {
    hub.startup
        .sealed
        .modules
        .iter()
        .map(|m| (m.name.clone(), json!(m.version.to_string())))
        .collect()
}

fn drawn_json(d: &Drawn) -> (Value, Value) {
    let values: Map<String, Value> = d
        .values
        .iter()
        .map(|(t, v)| (t.to_string(), json!(v)))
        .collect();
    let snapshots: Map<String, Value> = d
        .snapshots
        .iter()
        .map(|(t, s)| (t.to_string(), json!(s)))
        .collect();
    (Value::Object(values), Value::Object(snapshots))
}

impl<'a> Hub<'a> {
    /// `{"call": "corpus_record"}`: the document as this build saves it, the module versions
    /// that saved it, and what it draws at each time.
    pub fn corpus_record(
        &mut self,
        corpus: &Path,
        name: &str,
        document: &Value,
        times: &[i64],
    ) -> Value {
        let doc = stamped(document);
        let drawn = draw(self, &doc, times);
        let (values, snapshots) = drawn_json(&drawn);
        let file = json!({"name": name, "document": doc, "modules": modules_of(self), "times": times,
                          "values": values, "snapshots": snapshots, "accepted": []});
        let path = corpus.join(format!("{name}.json"));
        let written = std::fs::create_dir_all(corpus).and_then(|_| {
            std::fs::write(&path, serde_json::to_vec_pretty(&file).unwrap_or_default())
        });
        match written {
            Ok(()) => json!({"file": path.to_string_lossy()}),
            Err(e) => json!({"outcome": "refused", "code": "out_of_range", "what": e.to_string()}),
        }
    }

    /// Your decision accepting a corpus document's new result for its cause: what this build
    /// draws of it, kept beside what its release recorded.
    pub fn accept_corpus(
        &mut self,
        corpus: &Path,
        name: &str,
        cause: &str,
        decision: &str,
    ) -> Result<(), String> {
        let path = corpus.join(format!("{name}.json"));
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let mut file: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let times: Vec<i64> = file["times"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_i64)
            .collect();
        let drawn = draw(self, &file["document"].clone(), &times);
        let (values, snapshots) = drawn_json(&drawn);
        let entry = json!({"cause": cause, "decision": decision, "set_digest": self.startup.sealed.set_digest,
                           "values": values, "snapshots": snapshots});
        if !file["accepted"].is_array() {
            file["accepted"] = json!([]);
        }
        file["accepted"].as_array_mut().expect("a list").push(entry);
        std::fs::write(&path, serde_json::to_vec_pretty(&file).unwrap_or_default())
            .map_err(|e| e.to_string())
    }
}

/// The corpus documents in a folder, by name.
fn corpus_files(dir: &Path) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    let Ok(read) = std::fs::read_dir(dir) else {
        return out;
    };
    let mut paths: Vec<PathBuf> = read.filter_map(|e| e.ok().map(|e| e.path())).collect();
    paths.sort();
    for p in paths {
        if p.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Some(v) = std::fs::read(&p)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        {
            if let Some(name) = v["name"].as_str() {
                out.push((name.to_string(), v));
            }
        }
    }
    out
}

/// Whether a document holds an item of one of `module`'s kinds.
fn uses(hub: &Hub<'_>, doc: &Value, module: &str) -> bool {
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .any(|(_, item)| {
            item["kind"]
                .as_str()
                .and_then(deep_canvas::kinds::parse_kind)
                .and_then(|(full, _)| {
                    hub.startup
                        .sealed
                        .module_of_kind(&full)
                        .map(|m| m == module)
                })
                .unwrap_or(false)
        })
}

/// The field a migration wrote on an item: a param its migrated form holds that the saved one
/// doesn't, else the first that differs.
fn migrated_field(saved: &Value, lowered: &Value) -> String {
    let before = saved["params"].as_object().cloned().unwrap_or_default();
    let after = lowered["params"].as_object().cloned().unwrap_or_default();
    after
        .iter()
        .find(|(k, v)| before.get(*k) != Some(v))
        .map(|(k, _)| format!("params/{k}"))
        .unwrap_or_else(|| "params".into())
}

/// `migration`: the corpus documents that hold the module's kinds, then its migrated kinds'
/// seeded param sets.
pub fn run(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let module = ctx.module;
    let corpus: Vec<(String, Value)> = ctx
        .call
        .corpus
        .as_deref()
        .map(corpus_files)
        .unwrap_or_default()
        .into_iter()
        .filter(|(_, f)| uses(hub, &f["document"], module))
        .collect();
    let migrated: Vec<deep_canvas::kinds::Entry> = hub
        .startup
        .sealed
        .modules
        .iter()
        .find(|m| m.name == module)
        .map(|m| {
            m.shapes
                .kinds
                .iter()
                .filter(|k| k.entry.versions.len() > 1)
                .map(|k| k.entry.clone())
                .collect()
        })
        .unwrap_or_default();
    if corpus.is_empty() && migrated.is_empty() {
        return None;
    }
    let mut run =
        PartRun::new((corpus.len() + migrated.len() * ctx.call.param_sets as usize) as u64);
    for (name, file) in corpus {
        let case = corpus_case(hub, module, &name, &file, &mut run.failures);
        run.cases.push(case);
    }
    for entry in &migrated {
        for k in 0..ctx.call.param_sets {
            let seed = derive(
                ctx.call.seed,
                &format!("{}/params", entry.full_name()),
                u64::from(k),
            );
            let case = param_set(hub, module, entry, seed, &mut run.failures);
            run.cases.push(case);
        }
    }
    Some(run)
}

/// One corpus document, migrated at load, against what its release recorded (or what your
/// decision accepted for this build).
fn corpus_case(
    hub: &mut Hub<'_>,
    module: &str,
    name: &str,
    file: &Value,
    failures: &mut Vec<Value>,
) -> Case {
    let doc = file["document"].clone();
    let times: Vec<i64> = file["times"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    let drawn = draw(hub, &doc, &times);
    let accepted = file["accepted"]
        .as_array()
        .into_iter()
        .flatten()
        .rev()
        .find(|a| a["set_digest"] == hub.startup.sealed.set_digest.as_str());
    let (values, snapshots) = match accepted {
        Some(a) => (&a["values"], &a["snapshots"]),
        None => (&file["values"], &file["snapshots"]),
    };
    let notices = check_in(&doc, &hub.startup.sealed).notices;
    let mut case = Case::new(name, Verdict::Pass).with("fixture", json!(format!("corpus/{name}")));
    let mut compared_values = 0u64;
    let mut compared_snapshots = 0u64;
    let mut first: Option<Value> = None;
    for t in &times {
        let key = t.to_string();
        let want = values[&key].as_object().cloned().unwrap_or_default();
        let got = drawn.values.get(t).cloned().unwrap_or_default();
        for (id, w) in &want {
            compared_values += 1;
            let g = got.get(id).cloned().unwrap_or(Value::Null);
            if g != *w && first.is_none() {
                let saved = &doc["items"][id];
                let kind = notices
                    .iter()
                    .find(|n| n.ids.contains(id))
                    .and_then(|n| n.migration.as_ref().map(|(k, _, to)| format!("{k}@{to}")))
                    .unwrap_or_else(|| saved["kind"].as_str().unwrap_or("").to_string());
                let lowered = check_in(&doc, &hub.startup.sealed).lowered["items"][id].clone();
                first = Some(
                    json!({"kind": kind, "item": id, "field": migrated_field(saved, &lowered), "t": t}),
                );
            }
        }
        compared_snapshots += 1;
        if snapshots[&key].as_str() != drawn.snapshots.get(t).map(String::as_str) && first.is_none()
        {
            first = Some(json!({"kind": "", "item": "", "field": "snapshot", "t": t}));
        }
    }
    case.set(
        "compared",
        json!({"times": times, "values": compared_values, "snapshots": compared_snapshots}),
    );
    if let Some(f) = first {
        let fl = failure("migration", module, "migration", f);
        case.fail(Verdict::Fail, fl.clone());
        failures.push(fl);
    }
    // The twin: the recorded values with one moved must not match what this build draws.
    let twin_failed = times.first().is_some_and(|t| {
        let mut moved = values[&t.to_string()].clone();
        if let Some(v) = moved.as_object_mut().and_then(|m| m.values_mut().next()) {
            v["twin"] = json!(true);
        }
        let got = json!(drawn.values.get(t).cloned().unwrap_or_default());
        moved != got
    });
    case.set(
        "twin",
        json!({"verdict": if twin_failed { "FAIL" } else { "PASS" }}),
    );
    if !twin_failed && case.verdict == Verdict::Pass {
        let fl = failure("twin_passed", module, "migration", json!({"case": name}));
        case.fail(Verdict::Invalid, fl.clone());
        failures.push(fl);
    }
    case
}

/// One seeded param set of a migrated kind: drawn across its earliest major's schema (each param
/// at its min, max, default, absent or inside its range), migrated at load.
fn param_set(
    hub: &Hub<'_>,
    module: &str,
    entry: &deep_canvas::kinds::Entry,
    seed: u64,
    failures: &mut Vec<Value>,
) -> Case {
    let mut rng = Rng::new(seed);
    let first = &entry.versions[0];
    let current = entry.current().major;
    let id = format!("p{}", seed % 1_000_000);
    let mut params = Map::new();
    for p in &first.params {
        let choice = rng.below(5);
        let value = match (p.ty, choice) {
            (_, 3) => continue,
            (_, 2) => p.default.clone(),
            (ParamType::F32, 0) => json!(p.min.unwrap_or(0.0)),
            (ParamType::F32, 1) => json!(p.max.unwrap_or(1.0)),
            (ParamType::F32, _) => {
                let (lo, hi) = (p.min.unwrap_or(-100.0), p.max.unwrap_or(100.0));
                json!((rng.range(lo, hi) * 100.0).round() / 100.0)
            }
            (ParamType::Json, _) if p.name == "box" => json!([10, 10, 40, 30]),
            _ => p.default.clone(),
        };
        if value.is_null() {
            continue;
        }
        params.insert(p.name.into(), value);
    }
    let kind = format!("{}@{}", entry.full_name(), first.major);
    let doc = stamped(&json!({
        "format": 1, "profile": "board", "title": "Param set", "size": [320, 200],
        "description": "One item of a kind one major back, its params drawn across its schema.",
        "requires": {"modules": {module: format!("^{}", first.major)}},
        "items": {id.clone(): {"id": id, "kind": kind, "name": "Drawn", "order": "a0", "params": params}},
    }));
    let once = check_in(&doc, &hub.startup.sealed);
    let twice = check_in(&doc, &hub.startup.sealed);
    let mut case = Case::new(format!("{}#{seed}", entry.full_name()), Verdict::Pass)
        .with("kind", json!(entry.full_name()))
        .with("seed", json!(seed));
    let lowered = &once.lowered["items"][&id];
    let mut problem: Option<Value> = None;
    if let Some(i) = once.issues.iter().find(|i| i.severity == "error") {
        let param = i.path.rsplit('/').next().unwrap_or("").to_string();
        problem = Some(
            json!({"kind": entry.full_name(), "seed": seed, "param": param, "raised": i.code}),
        );
    } else if lowered["id"] != id.as_str()
        || lowered["kind"].as_str() != Some(&format!("{}@{current}", entry.full_name()))
    {
        problem = Some(json!({"kind": entry.full_name(), "seed": seed, "param": "id"}));
    } else if once.lowered != twice.lowered {
        problem = Some(json!({"kind": entry.full_name(), "seed": seed, "param": "bytes"}));
    }
    if let Some(p) = problem {
        let fl = failure("migration_range", module, "migration", p);
        case.fail(Verdict::Fail, fl.clone());
        failures.push(fl);
    }
    case
}
