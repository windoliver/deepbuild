//! A library's fixtures and the calls that read them (canvas primitives: Logic: linked libraries,
//! Pack; #190): a library links only once its fixtures pass on this core, each run once per
//! library hash and module version as a piece of its own with logic.determinism's comparisons; a
//! pack version's check runs each library's subset check and fixtures; `query` answers deep_query's
//! row for a logic item; and a claim that a library is right counts its fixtures only when an
//! installed pack ships them.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::check::{self, Limits};
use serde_json::{json, Map, Value};

use crate::links::{self, Lib, Pack};
use crate::piece::Piece;
use crate::Logic;

fn bad(what: &str) -> Value {
    json!({"ok": false, "code": "bad_input", "what": what})
}

/// Two array elements equal by value: numbers by their f64, so an expected `1` matches an f64
/// write's `1.0`, and vectors element by element.
fn same(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(Value::Number(x)), Some(Value::Number(y))) => x.as_f64() == y.as_f64(),
        (Some(Value::Array(x)), Some(Value::Array(y))) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(Some(x), Some(y)))
        }
        (a, b) => a == b,
    }
}

/// One fixture's first difference from what it expects, as a refusal names it.
fn differs(lib: &Lib, fixture: &str, expect: &Value, bake: &Value) -> Option<Value> {
    let mut steps: Vec<(i64, &Map<String, Value>)> = expect
        .get("arrays")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| Some((k.parse().ok()?, v.as_object()?)))
        .collect();
    steps.sort_by_key(|s| s.0);
    let ran = bake["steps"].as_array().cloned().unwrap_or_default();
    for (step, arrays) in steps {
        let at = ran.iter().find(|s| s["step"] == json!(step));
        for (name, want) in arrays {
            let got = at.map_or(&Value::Null, |s| &s["arrays"][format!("fixture.{name}")]);
            let (w, g) = (
                want.as_array().cloned().unwrap_or_default(),
                got.as_array().cloned().unwrap_or_default(),
            );
            if let Some(index) = (0..w.len().max(g.len())).find(|i| !same(w.get(*i), g.get(*i))) {
                return Some(
                    json!({"rule": "fixture", "what": format!("{}'s fixture {fixture} expects {name}[{index}] {} at step {step}; the run gives {}", lib.label, w.get(index).unwrap_or(&Value::Null), g.get(index).unwrap_or(&Value::Null)),
                    "library": lib.label, "fixture": fixture, "step": step, "array": name, "index": index, "expected": w.get(index), "actual": g.get(index)}),
                );
            }
        }
    }
    let hashes = &bake["checkpoints"]["fixture"];
    for (step, want) in expect
        .get("deep_hashes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let got = hashes
            .as_array()
            .into_iter()
            .flatten()
            .find(|c| c["step"].as_i64().map(|k| k.to_string()).as_deref() == Some(step.as_str()))
            .map(|c| &c["deep_hash"]);
        if got != Some(want) {
            return Some(
                json!({"rule": "fixture", "what": format!("{}'s fixture {fixture} expects full-state hash {want} at step {step}", lib.label),
                "library": lib.label, "fixture": fixture, "step": step.parse::<i64>().ok(), "field": "deep_hash"}),
            );
        }
    }
    None
}

impl Logic {
    /// Runs every fixture of each library the piece's items link that hasn't run on this core yet,
    /// and records them in the items' receipts; the first library whose fixtures fail, or that
    /// ships none, refuses its item.
    pub(crate) fn fixtures(&mut self, piece_v: &Value, piece: &mut Piece) -> Result<(), Value> {
        for item in &mut piece.items {
            for l in 0..item.libraries.len() {
                let records = self.verify(piece_v, &item.libraries[l]).map_err(|refusals| {
                    json!({"ok": false, "code": "link_refused", "item": item.id, "refusals": refusals})
                })?;
                item.fixtures
                    .insert(item.libraries[l].hash.clone(), records);
            }
        }
        Ok(())
    }

    /// A library's fixture records, run here once per hash and fixture set: `ran` is true only
    /// at the run.
    fn verify(&mut self, piece_v: &Value, lib: &Lib) -> Result<Value, Vec<Value>> {
        // A fixture's item also links what the library's needs reach, pinned by hash: those hashes
        // key it too, not which packs carry them (#190: once per library hash).
        let packs = links::packs(piece_v).unwrap_or_default();
        let key = format!(
            "{} {}",
            lib.fixtures.join(" "),
            links::reach(&lib.label, &lib.hash, &packs).join(" ")
        );
        if let Some(done) = self.verified.get(&key) {
            return done.clone().map(|mut r| {
                for f in r.as_array_mut().into_iter().flatten() {
                    f["ran"] = json!(false);
                }
                r
            });
        }
        // A fixture item links its own library: its run doesn't wait on itself.
        if self.verifying.contains(&key) {
            return Ok(json!([]));
        }
        if lib.fixtures.is_empty() {
            return Err(vec![
                json!({"rule": "fixture", "what": format!("{} ships no fixture: a library links only once its fixtures pass", lib.label), "library": lib.label}),
            ]);
        }
        self.verifying.insert(key.clone());
        let out = self.run_fixtures(piece_v, lib);
        self.verifying.remove(&key);
        self.verified.insert(key, out.clone());
        out
    }

    fn run_fixtures(&mut self, piece_v: &Value, lib: &Lib) -> Result<Value, Vec<Value>> {
        let assets = piece_v.get("assets").cloned().unwrap_or(json!({}));
        let mut records = Vec::new();
        for id in &lib.fixtures {
            let missing = || {
                vec![
                    json!({"rule": "fixture", "what": format!("{}'s fixture {id} isn't a fixture the piece carries", lib.label), "library": lib.label, "fixture": id}),
                ]
            };
            let fixture: Value = assets
                .get(id)
                .and_then(Value::as_str)
                .and_then(|b| B64.decode(b).ok())
                .filter(|b| deep_canvas_sandbox::rewrite::hash(b) == *id)
                .and_then(|b| serde_json::from_slice(&b).ok())
                .ok_or_else(missing)?;
            let piece = json!({"seed": 0, "packs": piece_v.get("packs").cloned().unwrap_or(json!([])),
                "items": {"fixture": fixture.get("item").cloned().unwrap_or(Value::Null)}, "assets": assets});
            let started = std::time::Instant::now();
            let line = json!({"call": "bake", "piece": piece, "track": fixture.get("track").cloned().unwrap_or(json!([])),
                "steps": fixture.get("steps").cloned().unwrap_or(json!(1))});
            let bake = self.bake(&line).map_err(|r| {
                r["refusals"]
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| vec![r.clone()])
            })?;
            let mut line = line;
            line["at_times"] = json!([0.0]);
            let det = self.determinism(&line).map_err(|r| vec![r])?;
            let ns = started.elapsed().as_nanos() as u64;
            if let Some(r) = differs(
                lib,
                id,
                fixture.get("expect").unwrap_or(&Value::Null),
                &bake,
            ) {
                return Err(vec![r]);
            }
            if det["verdict"] != json!("PASS") {
                return Err(vec![
                    json!({"rule": "fixture", "what": format!("{}'s fixture {id} fails logic.determinism", lib.label), "library": lib.label, "fixture": id, "failures": det["failures"]}),
                ]);
            }
            let deep: Map<String, Value> = bake["checkpoints"]["fixture"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|c| (c["step"].to_string(), c["deep_hash"].clone()))
                .collect();
            records.push(json!({"fixture": id, "verdict": "PASS", "ran": true, "ns": ns, "deep_hashes": deep}));
        }
        Ok(Value::Array(records))
    }

    /// deep_query's row for each logic item: its program, its rewritten hash and its libraries.
    pub(crate) fn query(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = self.check(line)?;
        let items: Map<String, Value> = piece
            .items
            .iter()
            .map(|i| {
                let libs: Vec<Value> = i.libraries.iter().map(|l| json!({"name": l.label, "hash": l.hash})).collect();
                (i.id.clone(), json!({"kind": "logic@1", "program": i.program, "hash": i.hash, "libraries": libs}))
            })
            .collect();
        Ok(json!({"ok": true, "items": items}))
    }

    /// Checks a pack's version: each library against the one subset, its `lib:` imports and the
    /// conventions' imported memory aside, then its fixtures, each linked against this pack.
    pub(crate) fn pack_check(&mut self, line: &Value) -> Result<Value, Value> {
        let pack_v = line.get("pack").ok_or_else(|| bad("pack"))?;
        let pack = Pack::parse(pack_v).ok_or_else(|| bad("pack"))?;
        let assets = line
            .get("assets")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let piece_v = json!({"packs": [pack_v], "assets": assets});
        let refused = |refusals: Vec<Value>| json!({"ok": false, "code": "pack_refused", "pack": pack.id, "refusals": refusals});
        let mut subset = Vec::new();
        for (label, e) in &pack.libs {
            let bytes = assets
                .get(&e.asset)
                .and_then(Value::as_str)
                .and_then(|b| B64.decode(b).ok());
            let Some(bytes) = bytes.filter(|b| deep_canvas_sandbox::rewrite::hash(b) == e.asset)
            else {
                subset.push(json!({"rule": "asset", "what": format!("the pack's {label} isn't at {}", e.asset), "library": label, "asset": e.asset}));
                continue;
            };
            if self.planted.pack_check_skips_library_subset {
                continue;
            }
            let mut found: Vec<Value> = match check::check(&bytes, &Limits::default()) {
                Ok(()) => Vec::new(),
                Err(r) => r
                    .iter()
                    .filter(|r| !linkable(r))
                    .map(|r| r.to_json())
                    .collect(),
            };
            // The check validates only a program it found nothing in, and a library's own imports
            // always are something: validate it under the subset here.
            if found.is_empty() {
                if let Err(e) =
                    wasmparser::Validator::new_with_features(check::SUBSET).validate_all(&bytes)
                {
                    found.push(json!({"rule": "valid", "what": format!("{label} isn't valid under the one subset: {e}")}));
                }
            }
            subset.extend(found.into_iter().map(|mut v| {
                v["library"] = json!(label);
                v
            }));
        }
        if !subset.is_empty() {
            return Err(refused(subset));
        }
        let mut libraries = Vec::new();
        for (label, e) in &pack.libs {
            let lib = links::resolve(
                &[(label.clone(), e.asset.clone())],
                std::slice::from_ref(&pack),
                &|sha| B64.decode(assets.get(sha)?.as_str()?).ok(),
                &self.planted,
            )
            .map_err(refused)?
            .into_iter()
            .find(|l| l.label == *label)
            .ok_or_else(|| bad("pack"))?;
            let records = self.verify(&piece_v, &lib).map_err(refused)?;
            libraries.push(
                json!({"name": label, "hash": lib.hash, "pack": pack.id, "fixtures": records}),
            );
        }
        Ok(json!({"ok": true, "pack": pack.id, "installed": true, "libraries": libraries}))
    }

    /// The claim that a library is right, decided from its fixtures: an agent's own pack binds
    /// only the agent's own claims, so its fixtures alone leave the claim INCONCLUSIVE with one ask.
    pub(crate) fn claim(&mut self, line: &Value) -> Result<Value, Value> {
        let piece_v = line.get("piece").ok_or_else(|| bad("piece"))?;
        let label = line
            .get("library")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("library"))?;
        let packs = links::packs(piece_v).ok_or_else(|| bad("packs"))?;
        // An installed pack's copy first: its fixtures count for every claim.
        let entry = packs
            .iter()
            .filter_map(|p| p.libs.get(label).map(|e| (p.agent, e.asset.clone())))
            .min_by_key(|(agent, _)| *agent)
            .map(|(_, asset)| asset)
            .ok_or_else(|| bad("library"))?;
        let assets = piece_v
            .get("assets")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let lib = links::resolve(
            &[(label.into(), entry)],
            &packs,
            &|sha| B64.decode(assets.get(sha)?.as_str()?).ok(),
            &self.planted,
        )
        .map_err(|r| json!({"ok": false, "code": "link_refused", "refusals": r}))?
        .into_iter()
        .find(|l| l.label == label)
        .ok_or_else(|| bad("library"))?;
        Ok(match self.verify(piece_v, &lib) {
            Err(r) => json!({"ok": true, "verdict": "FAIL", "asks": [], "refusals": r}),
            Ok(_) if lib.agent => {
                json!({"ok": true, "verdict": "INCONCLUSIVE", "asks": [{"kind": "approval", "library": label,
                "why": format!("{label}'s only proof is fixtures the working agent wrote for its own library, in {}: they bind only its own claims until you approve the pack", lib.pack)}]})
            }
            Ok(_) => json!({"ok": true, "verdict": "PASS", "asks": []}),
        })
    }
}

/// A refusal a relocatable library carries by design: a `lib:` function import, or the
/// conventions' imported memory.
fn linkable(r: &check::Refusal) -> bool {
    match &r.import {
        Some((module, name)) => {
            module.starts_with("lib:") || (module == "env" && name == "__linear_memory")
        }
        None => false,
    }
}
