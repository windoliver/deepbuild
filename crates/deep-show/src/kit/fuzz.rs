//! The fuzzing parts (issue #138): `clean_rebuild`, where each seeded sequence of patches over a
//! module's fixtures ends equal to a clean rebuild of the same revision (the shadow) in every
//! array, cache, key and snapshot, a crash becoming a corpus file; and `patch_fuzz`, random
//! valid and invalid patches over every kind and op, replayable from their seeds, holding
//! Patch's five laws on every patch drawn.

use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;

use deep_canvas::document::{touched_in, Issue};
use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{Scheduler, Tokens};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::engine::{self, Engine, ALPHA, BRAVO};
use super::instance::{self, How, Painter};
use super::{derive, failure, Case, Ctx, PartRun, Rng, Verdict};
use crate::hub::{Hub, Planted};

/// What every fuzzing thread reads: the build, the look, the fixtures' fuzzed documents with
/// their readings, the planted program and where evidence goes.
struct Bench<'s> {
    sealed: &'s Sealed,
    look: Tokens,
    ground: [u8; 3],
    docs: Vec<(Value, BTreeMap<String, Value>)>,
    kinds: Vec<String>,
    planted: Option<Planted>,
    evidence: PathBuf,
    module: String,
    times: Vec<i64>,
}

impl<'s> Bench<'s> {
    fn of(hub: &Hub<'s>, ctx: &Ctx<'_>) -> Bench<'s> {
        let sealed = &hub.startup.sealed;
        let mut docs: Vec<(Value, BTreeMap<String, Value>)> = ctx
            .manifest
            .of_module(ctx.module)
            .into_iter()
            .filter(|f| super::catalog::accepted(sealed, f))
            .map(|f| {
                (
                    engine::fuzz_doc(sealed, &f.document),
                    instance::readings(f.record.as_ref()),
                )
            })
            .collect();
        if docs.is_empty() {
            let empty = json!({"format": 1, "profile": "board", "title": "Empty board",
                               "description": "A board with nothing on it.", "size": [320, 200], "items": {}});
            docs.push((engine::fuzz_doc(sealed, &empty), BTreeMap::new()));
        }
        Bench {
            sealed,
            look: deep_canvas_marks::modules::tokens(&hub.look.light),
            ground: hub.look.light.get("ground").copied().unwrap_or([255; 3]),
            docs,
            kinds: engine::kinds(sealed),
            planted: hub.scenario.planted,
            evidence: hub.scenario.evidence.clone(),
            module: ctx.module.to_string(),
            times: vec![0],
        }
    }

    fn engine(&self) -> Engine<'s> {
        Engine {
            sealed: self.sealed,
            planted: self.planted,
        }
    }

    fn how(&self) -> How {
        let mut how = How::default();
        how.planted.key_without_params = self.planted == Some(Planted::KeyWithoutParams);
        how
    }
}

/// One drawn patch of a sequence, with its writer.
fn step(writer: &str, patch: &Value) -> Value {
    json!({"writer": writer, "patch": patch})
}

/// What one clean-rebuild sequence found.
struct SeqResult {
    case: Case,
    failure: Option<Value>,
    compared: [u64; 4],
    corpus: Option<String>,
}

/// The node the twin moves: the first per-item node's result, which a comparator that reads
/// results must see change.
fn twin_of(nodes: &instance::Evaluated) -> instance::Evaluated {
    let mut twin = nodes.clone();
    if let Some(n) = twin.nodes.values_mut().next() {
        n.result = format!("twin:{}", n.result);
    }
    twin
}

/// Plays one sequence: the live instance takes each revision as it comes, the shadow rebuilds
/// the last one clean, and the two must match in every node's key and result, every cached
/// result and the snapshot.
fn sequence(b: &Bench<'_>, painter: &mut Painter, seed: u64, given: Option<&Value>) -> SeqResult {
    let mut rng = Rng::new(seed);
    let (base, readings) = match given {
        Some(file) => (file["document"].clone(), BTreeMap::new()),
        None => b.docs[(seed % b.docs.len() as u64) as usize].clone(),
    };
    let engine = b.engine();
    let mut doc = base.clone();
    let mut prev: Vec<Issue> = engine.full(&doc);
    let mut steps: Vec<Value> = Vec::new();
    let mut case = Case::new(format!("seq:{seed}"), Verdict::Pass).with("seed", json!(seed));
    let how = b.how();
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let mut live_s = Scheduler::new(b.sealed, how.options());
        let mut live = instance::session(&mut live_s, &doc, &b.look, &readings);
        let view = instance::view(&doc);
        live.frame(&mut live_s, b.times[0], &view);
        let mut crashed = live.frozen().is_some();
        let planned: Vec<Value> = match given {
            Some(file) => file["patches"].as_array().cloned().unwrap_or_default(),
            None => {
                let n = 1 + rng.below(3);
                (0..n).map(|_| Value::Null).collect()
            }
        };
        for (j, plan) in planned.iter().enumerate() {
            let (writer, patch) = if plan.is_null() {
                let writer = if j % 2 == 0 { ALPHA } else { BRAVO };
                let layer = if j % 2 == 0 {
                    "alpha-main"
                } else {
                    "bravo-main"
                };
                let mut r = Rng::new(derive(seed, "patch", j as u64));
                let (p, _, _) =
                    engine::draw_patch(b.sealed, &doc, layer, &b.kinds, &mut r, seed ^ j as u64);
                (writer.to_string(), p)
            } else {
                (
                    plan["writer"].as_str().unwrap_or(ALPHA).to_string(),
                    plan["patch"].clone(),
                )
            };
            steps.push(step(&writer, &patch));
            let out = engine.patch(&doc, &prev, &writer, &patch, None, false);
            if out.applied {
                doc = out.doc;
                prev = out.after;
                live.load(&mut live_s, &doc);
                live.frame(&mut live_s, b.times[0], &view);
                crashed |= live.frozen().is_some()
                    || live
                        .report
                        .issues
                        .iter()
                        .any(|i| i.code == "operator_panic");
            }
        }
        if crashed {
            return Err("operator_panic".to_string());
        }
        let mut compared = [0u64; 4];
        let mut problem: Option<(&'static str, String)> = None;
        let mut twin_failed = true;
        for &t in &b.times {
            live.frame(&mut live_s, t, &view);
            let got = instance::Evaluated::of_session(&live, &live_s);
            let mut shadow_s = Scheduler::new(b.sealed, How::default().options());
            let mut shadow = instance::session(&mut shadow_s, &doc, &b.look, &readings);
            shadow.frame(&mut shadow_s, t, &view);
            let want = instance::Evaluated::of_session(&shadow, &shadow_s);
            if want.panicked || got.panicked {
                return Err("operator_panic".to_string());
            }
            // Every array (each node's result) and key.
            for (place, w) in &want.nodes {
                compared[0] += 1;
                compared[2] += 1;
                match got.nodes.get(place) {
                    Some(g) if g.key != w.key => {
                        problem.get_or_insert(("key", place.clone()));
                    }
                    Some(g) if g.result != w.result => {
                        problem.get_or_insert(("array", place.clone()));
                    }
                    Some(_) => {}
                    None => {
                        problem.get_or_insert(("array", place.clone()));
                    }
                }
            }
            if let Some(extra) = got.nodes.keys().find(|p| !want.nodes.contains_key(*p)) {
                problem.get_or_insert(("array", extra.clone()));
            }
            // Every cached result: the live instance's cache holds what a clean rebuild gives.
            let cache = live_s.cache_results();
            for (place, g) in &got.nodes {
                if let (Some(cached), Some(w)) = (cache.get(&g.key), want.nodes.get(place)) {
                    compared[1] += 1;
                    if *cached != w.result {
                        problem.get_or_insert(("cache", place.clone()));
                    }
                }
            }
            // The snapshot.
            let size = instance::fit(&doc, 96.0);
            let a = painter.pixels(&live_s, &live, size);
            let c = painter.pixels(&shadow_s, &shadow, size);
            compared[3] += 1;
            if a != c {
                problem.get_or_insert(("snapshot", format!("t={t}")));
            }
            // The twin: a shadow one result off must not match.
            let twin = twin_of(&want);
            if instance::first_difference(&got, &twin, &|_| false).is_none() {
                twin_failed = false;
            }
        }
        Ok((compared, problem, twin_failed))
    }));
    let corpus = |steps: &[Value]| -> Option<String> {
        if given.is_some() {
            return None;
        }
        let dir = b.evidence.join("corpus");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join(format!("{}-clean_rebuild-{seed}.json", b.module));
        let file = json!({"module": b.module, "part": "clean_rebuild", "seed": seed,
                          "document": base, "patches": steps});
        std::fs::write(&path, serde_json::to_vec_pretty(&file).ok()?).ok()?;
        Some(path.to_string_lossy().into_owned())
    };
    match outcome {
        Ok(Ok((compared, problem, twin_failed))) => {
            case.set(
                "twin",
                json!({"verdict": if twin_failed { "FAIL" } else { "PASS" }}),
            );
            let mut failure_out = None;
            if let Some((what, name)) = problem {
                let f = failure(
                    "mismatch",
                    &b.module,
                    "clean_rebuild",
                    json!({"what": what, "name": name, "seed": seed}),
                );
                case.fail(Verdict::Fail, f.clone());
                failure_out = Some(f);
            } else if !twin_failed {
                let f = failure(
                    "twin_passed",
                    &b.module,
                    "clean_rebuild",
                    json!({"case": case.name()}),
                );
                case.fail(Verdict::Invalid, f.clone());
                failure_out = Some(f);
            }
            SeqResult {
                case,
                failure: failure_out,
                compared,
                corpus: None,
            }
        }
        Ok(Err(_)) | Err(_) => {
            let file = corpus(&steps);
            let f = failure(
                "crash",
                &b.module,
                "clean_rebuild",
                json!({"seed": seed, "corpus": file.clone().unwrap_or_default()}),
            );
            case.fail(Verdict::Fail, f.clone());
            SeqResult {
                case,
                failure: Some(f),
                compared: [0; 4],
                corpus: file,
            }
        }
    }
}

/// `clean_rebuild`: `sequences` seeded sequences per module (or the one a corpus file replays).
pub fn clean_rebuild(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let b = Bench::of(hub, ctx);
    let replay: Option<Value> = ctx
        .call
        .replay
        .as_ref()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .filter(|f: &Value| f["module"] == ctx.module && f["part"] == "clean_rebuild");
    let declared = if replay.is_some() {
        1
    } else {
        u64::from(ctx.call.sequences)
    };
    let mut to_run = declared as usize;
    if hub.planted(Planted::PartRunsHalf) {
        to_run /= 2;
    }
    let name = format!("{}/clean_rebuild", ctx.module);
    let seed = ctx.call.seed;
    let results: Vec<SeqResult> = match &replay {
        Some(file) => {
            let mut painter = Painter::new(b.evidence.clone(), b.ground);
            vec![sequence(
                &b,
                &mut painter,
                file["seed"].as_u64().unwrap_or(0),
                Some(file),
            )]
        }
        None => instance::spread(
            to_run,
            || Painter::new(b.evidence.clone(), b.ground),
            |painter, i| sequence(&b, painter, derive(seed, &name, i as u64), None),
        ),
    };
    let mut run = PartRun::new(declared);
    let mut compared = [0u64; 4];
    for r in results {
        for (sum, n) in compared.iter_mut().zip(r.compared) {
            *sum += n;
        }
        if let Some(f) = r.failure {
            run.failures.push(f);
        }
        if let Some(c) = r.corpus {
            ctx.corpus.push(c);
        }
        run.cases.push(r.case);
    }
    run.extra.insert(
        "stats".into(),
        json!({"compared": {"arrays": compared[0], "caches": compared[1], "keys": compared[2], "snapshots": compared[3]}}),
    );
    Some(run)
}

/// What `patch_fuzz` counts.
#[derive(Default)]
struct Stats {
    drawn: u64,
    accepted: u64,
    refused: u64,
    refused_without_code: u64,
    refused_changed: u64,
    roundtrip_failed: u64,
    panics: u64,
    ops: BTreeMap<String, u64>,
    kinds: BTreeSet<String>,
    laws: [(u64, u64); 5],
    refusals: BTreeMap<String, u64>,
    hasher: Option<Sha256>,
}

/// What checking one drawn patch found.
struct PatchResult {
    drawn: Vec<Value>,
    ops: Vec<&'static str>,
    kinds: Vec<String>,
    accepted: bool,
    refused_without_code: bool,
    refused_changed: bool,
    roundtrip_failed: bool,
    panicked: bool,
    laws: [(u64, u64); 5],
    refusal: Option<String>,
}

fn issue_keys(issues: &[Issue]) -> Vec<(String, Vec<String>, String)> {
    let mut out: Vec<_> = issues
        .iter()
        .map(|i| (i.code.to_string(), i.ids.clone(), i.path.clone()))
        .collect();
    out.sort();
    out
}

/// Draws the one patch `seed` names, on the base the same seed builds, and checks it.
fn check_patch(b: &Bench<'_>, seed: u64) -> PatchResult {
    let mut res = PatchResult {
        drawn: Vec::new(),
        ops: Vec::new(),
        kinds: Vec::new(),
        accepted: false,
        refused_without_code: false,
        refused_changed: false,
        roundtrip_failed: false,
        panicked: false,
        laws: [(0, 0); 5],
        refusal: None,
    };
    let engine = b.engine();
    let mut rng = Rng::new(seed);
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let (fixture, readings) = &b.docs[(seed % b.docs.len() as u64) as usize];
        let mut doc = fixture.clone();
        let mut prev = engine.full(&doc);
        // The base: a few warm-up patches, from the same seed.
        for w in 0..rng.below(3) {
            let mut r = Rng::new(derive(seed, "warm", w as u64));
            let (p, _, _) = engine::draw_patch(
                b.sealed,
                &doc,
                "alpha-main",
                &b.kinds,
                &mut r,
                seed ^ (w as u64 + 7),
            );
            let o = engine.patch(&doc, &prev, ALPHA, &p, None, false);
            if o.applied {
                doc = o.doc;
                prev = o.after;
            }
        }
        let (writer, layer, partner, partner_layer) = if rng.chance(50) {
            (ALPHA, "alpha-main", BRAVO, "bravo-main")
        } else {
            (BRAVO, "bravo-main", ALPHA, "alpha-main")
        };
        let mut r = Rng::new(derive(seed, "patch", 0));
        let (p, ops, kinds) = engine::draw_patch(b.sealed, &doc, layer, &b.kinds, &mut r, seed);
        res.drawn.push(step(writer, &p));
        res.ops = ops;
        res.kinds = kinds;
        let base_bytes = engine::bytes(b.sealed, &doc);
        let base_hash = engine::hash(b.sealed, &doc);
        let dry = engine.patch(&doc, &prev, writer, &p, None, true);
        let com = engine.patch(&doc, &prev, writer, &p, None, false);
        // (1) The dry run returns what the commit does on the same base.
        res.laws[0].0 += 1;
        let same = dry.applied == com.applied
            && dry.achieved == com.achieved
            && dry.cost == com.cost
            && issue_keys(&dry.issues) == issue_keys(&com.issues);
        if !same {
            res.laws[0].1 += 1;
        }
        // (2) A refused patch or a dry run leaves the canonical bytes unchanged.
        res.laws[1].0 += 1;
        let dry_kept = engine::bytes(b.sealed, &dry.doc) == base_bytes;
        let refused_kept = com.applied || engine::bytes(b.sealed, &com.doc) == base_bytes;
        if !dry_kept || !refused_kept {
            res.laws[1].1 += 1;
        }
        res.refused_changed = !refused_kept;
        if !com.applied {
            res.refused_without_code =
                com.issues.iter().any(|i| i.code.is_empty()) || com.issues.is_empty();
            res.refusal = com.issues.first().map(|i| i.code.to_string());
        } else {
            res.accepted = true;
            // A round trip: the revision written canonically and read back gives the same bytes.
            let written = engine::bytes(b.sealed, &com.doc);
            let back: Option<Value> = serde_json::from_str(&written).ok();
            res.roundtrip_failed = back.is_none_or(|v| engine::bytes(b.sealed, &v) != written);
            // (3) The patch then its undo, by the same writer with nothing between, gives back
            // the base's revision hash.
            res.laws[2].0 += 1;
            match engine.undo(&com, &prev, writer) {
                Ok(undone) if engine::hash(b.sealed, &undone) == base_hash => {}
                _ => res.laws[2].1 += 1,
            }
            // (5) The incremental check returns what a full check of the revision does.
            res.laws[4].0 += 1;
            if issue_keys(&com.after) != issue_keys(&engine.full(&com.doc)) {
                res.laws[4].1 += 1;
            }
            // An operator's panic on the new revision.
            let mut s = Scheduler::new(b.sealed, How::default().options());
            let mut session = instance::session(&mut s, &com.doc, &b.look, readings);
            session.frame(&mut s, 0, &instance::view(&com.doc));
            res.panicked = session.frozen().is_some()
                || session
                    .report
                    .issues
                    .iter()
                    .any(|i| i.code == "operator_panic");
        }
        // (4) Two writers' patches on one base touching disjoint IDs give one revision hash in
        // either arrival order: a random pair, and two reorders into one gap between adjacent
        // siblings, where a key drawn at apply time would depend on which arrived first.
        let mut r = Rng::new(derive(seed, "partner", 0));
        let (q, _, _) = engine::draw_patch(
            b.sealed,
            &doc,
            partner_layer,
            &b.kinds,
            &mut r,
            seed ^ 0xfeed,
        );
        let mut pairs = vec![(p.clone(), writer, q, partner)];
        let mut r = Rng::new(derive(seed, "gap", 0));
        if let Some((gp, gq)) = gap_pair(&doc, &mut r) {
            pairs.push((gp, ALPHA, gq, BRAVO));
        }
        for (p, writer, q, partner) in pairs {
            if !touched_in(&p, &doc, false).is_disjoint(&touched_in(&q, &doc, false)) {
                continue;
            }
            let pa = engine.patch(&doc, &prev, writer, &p, None, false);
            let qa = engine.patch(&doc, &prev, partner, &q, None, false);
            if !pa.applied || !qa.applied {
                continue;
            }
            let ab = engine.patch(&pa.doc, &pa.after, partner, &q, Some(&doc), false);
            let ba = engine.patch(&qa.doc, &qa.after, writer, &p, Some(&doc), false);
            if ab.applied && ba.applied {
                res.drawn.push(step(partner, &q));
                res.laws[3].0 += 1;
                if engine::hash(b.sealed, &ab.doc) != engine::hash(b.sealed, &ba.doc) {
                    res.laws[3].1 += 1;
                }
            }
        }
    }));
    if outcome.is_err() {
        res.panicked = true;
    }
    res
}

/// Two reorders into one gap: alpha puts one of its items after a sibling, and bravo one of its
/// own before the next sibling, so each touches its own item and neighbor alone.
fn gap_pair(doc: &Value, rng: &mut Rng) -> Option<(Value, Value)> {
    let items = doc["items"].as_object()?;
    let mut groups: BTreeMap<String, Vec<(String, String, String)>> = BTreeMap::new();
    for (id, item) in items {
        let parent = item["parent"].as_str().unwrap_or("").to_string();
        let order = item["order"].as_str().unwrap_or("").to_string();
        let layer = item["layer"].as_str().unwrap_or("").to_string();
        groups
            .entry(parent)
            .or_default()
            .push((order, id.clone(), layer));
    }
    let mut options = Vec::new();
    for siblings in groups.values_mut() {
        siblings.sort();
        for w in siblings.windows(2) {
            let (a, bnext) = (&w[0].1, &w[1].1);
            let mine = |layer: &str| {
                siblings
                    .iter()
                    .filter(|s| s.2 == layer && s.1 != *a && s.1 != *bnext)
                    .map(|s| s.1.clone())
                    .collect::<Vec<_>>()
            };
            for x in mine("alpha-main") {
                for y in mine("bravo-main") {
                    options.push((x.clone(), a.clone(), y, bnext.clone()));
                }
            }
        }
    }
    let (x, a, y, bnext) = rng.pick(&options)?.clone();
    let patch = |n: u64, op: Value| {
        json!({"patch": format!("01JB138G{n:018}"), "doc": doc["id"], "base": 0,
               "reason": "one gap", "ops": [op]})
    };
    Some((
        patch(1, json!({"op": "reorder", "id": x, "after": a})),
        patch(2, json!({"op": "reorder", "id": y, "before": bnext})),
    ))
}

/// `patch_fuzz`: `sequences` seeded sequences of drawn patches per module, each patch checked
/// alone from its own seed; or, with `patch_seed`, that one patch.
pub fn patch_fuzz(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let b = Bench::of(hub, ctx);
    let declared = if ctx.call.patch_seed.is_some() {
        1
    } else {
        u64::from(ctx.call.sequences)
    };
    let to_run = if hub.planted(Planted::FuzzerRunsNone) {
        0
    } else {
        declared as usize
    };
    let name = format!("{}/patch_fuzz", ctx.module);
    let seed = ctx.call.seed;
    let one = ctx.call.patch_seed;
    // Each sequence: one to three patches, each from its own seed.
    let results: Vec<(u64, Vec<(u64, PatchResult)>)> = instance::spread(
        to_run,
        || (),
        |_, i| {
            if let Some(s) = one {
                return (s, vec![(s, check_patch(&b, s))]);
            }
            let seq = derive(seed, &name, i as u64);
            let n = 1 + Rng::new(seq).below(3);
            let list = (0..n)
                .map(|j| {
                    let s = derive(seq, "patch", j as u64);
                    (s, check_patch(&b, s))
                })
                .collect();
            (seq, list)
        },
    );
    let mut stats = Stats {
        hasher: Some(Sha256::new()),
        ..Stats::default()
    };
    let mut run = PartRun::new(declared);
    for (seq, list) in results {
        let mut case = Case::new(format!("seq:{seq}"), Verdict::Pass).with("seed", json!(seq));
        let mut seeds = Vec::new();
        for (s, r) in list {
            seeds.push(s);
            stats.drawn += 1;
            if let Some(h) = stats.hasher.as_mut() {
                for d in &r.drawn {
                    h.update(serde_json::to_vec(d).unwrap_or_default());
                }
            }
            for op in &r.ops {
                *stats.ops.entry(op.to_string()).or_default() += 1;
            }
            stats.kinds.extend(r.kinds.iter().cloned());
            if r.accepted {
                stats.accepted += 1;
            } else {
                stats.refused += 1;
                if let Some(code) = &r.refusal {
                    *stats.refusals.entry(code.clone()).or_default() += 1;
                }
            }
            let mut fail = |code: &str, fields: Value| {
                let f = failure(code, ctx.module, "patch_fuzz", fields);
                case.fail(Verdict::Fail, f.clone());
                run.failures.push(f);
            };
            if r.refused_without_code {
                stats.refused_without_code += 1;
                fail("refusal_without_code", json!({"seed": s}));
            }
            if r.refused_changed {
                stats.refused_changed += 1;
            }
            if r.roundtrip_failed {
                stats.roundtrip_failed += 1;
                fail("roundtrip", json!({"seed": s}));
            }
            if r.panicked {
                stats.panics += 1;
                fail("panic", json!({"seed": s}));
            }
            for (k, (checked, failed)) in r.laws.iter().enumerate() {
                stats.laws[k].0 += checked;
                stats.laws[k].1 += failed;
                if *failed > 0 {
                    fail("law", json!({"law": k + 1, "seed": s}));
                }
            }
        }
        case.set("seeds", json!(seeds));
        run.cases.push(case);
    }
    let digest = stats
        .hasher
        .take()
        .map(|h| {
            h.finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        })
        .unwrap_or_default();
    let laws: Map<String, Value> = stats
        .laws
        .iter()
        .enumerate()
        .map(|(k, (c, f))| ((k + 1).to_string(), json!({"checked": c, "failed": f})))
        .collect();
    run.extra.insert(
        "stats".into(),
        json!({
            "drawn": stats.drawn, "accepted": stats.accepted, "refused": stats.refused,
            "refused_without_code": stats.refused_without_code, "refused_changed": stats.refused_changed,
            "roundtrip_failed": stats.roundtrip_failed, "panics": stats.panics,
            "ops": stats.ops, "kinds": stats.kinds, "laws": laws, "digest": digest,
            "refusals": stats.refusals,
        }),
    );
    Some(run)
}
