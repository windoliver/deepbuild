//! The `fixtures` part (issue #138): each fixture of a module, a document with a sidecar of
//! existing check kinds and named oracles. Its sidecar holds no formula or code; it raises exactly
//! the codes it names; every kind, field and module its case declares is reached; each snapshot
//! check runs per backend, BLOCKED where the backend can't make its pixels, its planted-mismatch
//! twin failing; analytic and CPU-reference checks hold; and a module's interface is truth only
//! when each kind it registers has a fixture whose expected value was set outside it.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::schedule::{sha256_hex, Scheduler, Val};
use serde_json::{json, Map, Value};

use super::catalog::{codes, exact, fixture_issues, is_part_scene, stamped};
use super::compare::{judge, Tolerance};
use super::goldens::{render, Render};
use super::instance::{self, How, Painter};
use super::manifest::{sidecar_faults, Entry};
use super::repair::{play_scene, who};
use super::{failure, Case, Ctx, PartRun, Verdict};
use crate::hub::{Hub, Planted};

/// One frame at 60 fps, in flicks.
const FRAME: i64 = 705_600_000 / 60;

/// The document a reftest compares against: the fixture's, with `item` drawn as a `rect@1` of
/// the same box in the look's ink.
fn reference(hub: &Hub<'_>, doc: &Value, item: &str) -> Value {
    let mut out = doc.clone();
    let original = &doc["items"][item];
    let boxed = if original["params"]["box"].is_array() {
        original["params"]["box"].clone()
    } else {
        lowered_of(hub, doc, item)["params"]["box"].clone()
    };
    out["items"][item] = json!({
        "id": item, "kind": "rect@1", "name": original["name"], "order": original["order"],
        "layer": original["layer"], "params": {"box": boxed, "paint": {"fill": {"role": "ink"}}},
    });
    if let Some(at) = original.get("at") {
        out["items"][item]["at"] = at.clone();
    }
    out
}

/// An item's lowered form as the core evaluates it.
fn lowered_of(hub: &Hub<'_>, doc: &Value, item: &str) -> Value {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    instance::fresh(|| {
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut session = instance::session(&mut s, doc, &look, &BTreeMap::new());
        session.frame(&mut s, 0, &instance::view(doc));
        match session.value(&s, "core.lowered", Some(item)) {
            Some(Val::Json(v)) => (*v).clone(),
            _ => Value::Null,
        }
    })
}

/// The document with the sidecar's twin applied: `{path, value}` at `items/<id>/...`.
fn twinned(doc: &Value, twin: &Value) -> Option<Value> {
    let path = twin["path"].as_str()?;
    let mut out = doc.clone();
    let parts: Vec<&str> = path.split('/').collect();
    let (last, head) = parts.split_last()?;
    let mut at = &mut out;
    for p in head {
        at = &mut at[*p];
    }
    at[*last] = twin["value"].clone();
    Some(out)
}

/// The document with its first item's position moved: a twin when the sidecar names none.
fn moved(doc: &Value) -> Value {
    let mut out = doc.clone();
    if let Some(item) = out["items"]
        .as_object_mut()
        .and_then(|i| i.values_mut().next())
    {
        let pos = item["at"]["pos"].as_array().cloned().unwrap_or_default();
        let x = pos.first().and_then(Value::as_f64).unwrap_or(0.0);
        let y = pos.get(1).and_then(Value::as_f64).unwrap_or(0.0);
        item["at"]["pos"] = json!([x + 7.0, y + 5.0, 0]);
    }
    out
}

/// A seek: the frame at `t` on a new instance; a play: frames from 0 every frame to `t` on one.
fn seek_and_play(
    hub: &Hub<'_>,
    seek_doc: &Value,
    play_doc: &Value,
    t: i64,
) -> (Result<Vec<u8>, String>, Result<Vec<u8>, String>) {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let ground = hub.look.light.get("ground").copied().unwrap_or([255; 3]);
    let evidence = hub.scenario.evidence.clone();
    let size = instance::fit(play_doc, 4096.0);
    instance::fresh(|| {
        let mut painter = Painter::new(evidence, ground);
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut seek = instance::session(&mut s, seek_doc, &look, &BTreeMap::new());
        seek.frame(&mut s, t, &instance::view(seek_doc));
        let a = painter.pixels(&s, &seek, size);
        let mut s2 = Scheduler::new(sealed, How::default().options());
        let mut play = instance::session(&mut s2, play_doc, &look, &BTreeMap::new());
        let mut at = 0;
        while at < t {
            play.frame(&mut s2, at, &instance::view(play_doc));
            at += FRAME;
        }
        play.frame(&mut s2, t, &instance::view(play_doc));
        let b = painter.pixels(&s2, &play, size);
        (a, b)
    })
}

/// Whether an analytic or CPU-reference check holds on this commit.
pub fn criterion_holds(hub: &Hub<'_>, f: &Entry, check: &Map<String, Value>) -> bool {
    let doc = stamped(&f.document);
    let expect = check.get("expect").cloned().unwrap_or(Value::Null);
    if check.get("probe").and_then(Value::as_str) == Some("bounds") {
        // The item's bounds as the check reads the document (migrated, its literals converted),
        // not as any one renderer draws them.
        let item = expect["item"].as_str().unwrap_or("");
        let lowered = deep_canvas::document::check_in(&doc, &hub.startup.sealed).lowered;
        return lowered["items"][item]["params"]["box"] == expect["bounds"];
    }
    if check.get("render").and_then(Value::as_str) == Some("cpu_reference") {
        let item = expect["item"].as_str().unwrap_or("");
        let want = expect["bounds"].clone();
        let reference_doc = {
            let mut r = doc.clone();
            let original = doc["items"][item].clone();
            r["items"][item] = json!({"id": item, "kind": "rect@1", "name": original["name"],
                                      "order": original["order"], "layer": original["layer"],
                                      "params": {"box": want, "paint": {"fill": {"role": "ink"}}}});
            r
        };
        let a = cpu_pixels(hub, &doc);
        let b = cpu_pixels(hub, &reference_doc);
        return a.is_some() && a == b;
    }
    true
}

/// A document drawn on Vello CPU through its CPU paths, a GPU pass's kind as its draw.
fn cpu_pixels(hub: &Hub<'_>, doc: &Value) -> Option<Vec<u8>> {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let ground = hub.look.light.get("ground").copied().unwrap_or([255; 3]);
    let evidence = hub.scenario.evidence.clone();
    let size = instance::fit(doc, 4096.0);
    instance::fresh(|| {
        let mut painter = Painter::new(evidence, ground);
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut session = instance::session(&mut s, doc, &look, &BTreeMap::new());
        session.frame(&mut s, 0, &instance::view(doc));
        painter.pixels(&s, &session, size).ok()
    })
}

fn pixels_of(r: Render) -> Result<Vec<u8>, Result<&'static str, String>> {
    match r {
        Render::Pixels { rgba, .. } => Ok(rgba),
        Render::Blocked(probe) => Err(Ok(probe)),
        Render::Unfit(code) => Err(Err(code)),
    }
}

/// What a fixture's case reached: the kinds of the items its evaluation ran a node on, the
/// params its items set, and the modules whose operators ran.
fn reached(hub: &Hub<'_>, doc: &Value) -> (BTreeSet<String>, BTreeSet<String>, BTreeSet<String>) {
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let evaluated = instance::clean_at(
        sealed,
        &How::default(),
        doc,
        &look,
        &BTreeMap::new(),
        &[0],
        None,
    )
    .remove(0);
    let mut kinds = BTreeSet::new();
    let mut fields = BTreeSet::new();
    let mut modules = BTreeSet::new();
    for n in evaluated.nodes.values() {
        modules.insert(n.module.clone());
        if let Some(id) = &n.item {
            if let Some(k) = doc["items"][id]["kind"].as_str() {
                kinds.insert(k.to_string());
            }
        }
    }
    for (_, item) in doc["items"].as_object().into_iter().flatten() {
        let kind = item["kind"].as_str().unwrap_or("");
        for (p, _) in item["params"].as_object().into_iter().flatten() {
            fields.insert(format!("{kind}/params/{p}"));
        }
    }
    (kinds, fields, modules)
}

/// The agent-decision scene: an agent's bless, loosen and waive, each of which must be refused.
fn agent_decision(hub: &mut Hub<'_>, module: &str, f: &Entry) -> Case {
    let store = hub.scenario.evidence.join("kit-agent-decision");
    let _ = std::fs::remove_dir_all(&store);
    let mut case = Case::new(f.name.clone(), Verdict::Pass).with("fixture", json!(f.name));
    let target = "parity/kernel/board.board";
    let mut calls = Vec::new();
    for d in [
        json!({"bless": {"fixture": target, "digest": "0".repeat(64), "backend": "vello_cpu"}}),
        json!({"loosen": {"fixture": target, "tolerance": {"within": 4, "on": 99, "ceiling": 32, "window": {"size": 16, "off": 64}, "reason": "an agent asks"}, "reason": "an agent asks"}}),
        json!({"waive": {"fixture": target, "reason": "an agent asks"}}),
    ] {
        let mut c = who("alpha");
        c["call"] = json!("decide");
        c["decision"] = d;
        calls.push(c);
    }
    let replies = play_scene(
        hub,
        &json!({"calls": calls, "goldens": store.to_string_lossy()}),
    );
    let refused = replies
        .iter()
        .filter(|r| r["outcome"] == "refused" && r["code"] == "not_your_decision")
        .count();
    if refused != 3 {
        let fl = failure(
            "repair",
            module,
            "fixtures",
            json!({"case": f.name, "decided_for_an_agent": 3 - refused}),
        );
        case.fail(Verdict::Fail, fl);
    }
    case
}

/// The `fixtures` part.
pub fn run(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let module = ctx.module;
    let fixtures: Vec<Entry> = ctx
        .manifest
        .of_module(module)
        .into_iter()
        .cloned()
        .collect();
    if fixtures.is_empty() {
        return None;
    }
    let backends = ctx.call.backends.clone();
    let mut run = PartRun::new(0);
    let mut passed: BTreeMap<String, bool> = BTreeMap::new();
    for f in &fixtures {
        let before = run.cases.len();
        // The sidecar: data only, existing check kinds, listed oracles, whole tolerance classes.
        let faults = sidecar_faults(f, ctx.manifest);
        if !faults.is_empty() {
            let mut case = Case::new(format!("{}#sidecar", f.name), Verdict::Pass)
                .with("fixture", json!(f.name));
            for fault in faults {
                let code = fault["code"].as_str().unwrap_or("formula").to_string();
                let fl = failure(&code, module, "fixtures", fault);
                case.fail(Verdict::Fail, fl.clone());
                run.failures.push(fl);
            }
            run.cases.push(case);
        }
        if is_part_scene(f) {
            continue;
        }
        if f.name.ends_with("/agent-decision.scene") {
            run.cases.push(agent_decision(hub, module, f));
            passed.insert(
                f.name.clone(),
                run.cases.last().is_some_and(|c| c.verdict == Verdict::Pass),
            );
            continue;
        }
        // Exact codes.
        if let Some(want) = f.codes() {
            let got = codes(&fixture_issues(hub, f));
            let mut case = Case::new(format!("{}#codes", f.name), Verdict::Pass)
                .with("fixture", json!(f.name));
            if let Some(fl) = exact(hub, &mut case, module, "fixtures", &f.name, &want, &got) {
                run.failures.push(fl);
            }
            run.cases.push(case);
        }
        if f.is_scene() {
            continue;
        }
        let doc = stamped(&f.document);
        // Coverage reached.
        if let Some(covers) = f.sidecar.get("covers") {
            let list = |k: &str| -> Vec<String> {
                covers[k]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            };
            let declares = json!({"kinds": list("kinds"), "fields": list("fields"), "modules": list("modules")});
            let (kinds, fields, modules) = if hub.planted(Planted::CountsDeclaredAsReached) {
                (
                    list("kinds").into_iter().collect(),
                    list("fields").into_iter().collect(),
                    list("modules").into_iter().collect(),
                )
            } else {
                reached(hub, &doc)
            };
            let mut case = Case::new(format!("{}#coverage", f.name), Verdict::Pass)
                .with("fixture", json!(f.name))
                .with("declares", declares)
                .with("reached", json!({
                    "kinds": list("kinds").into_iter().filter(|k| kinds.contains(k)).collect::<Vec<_>>(),
                    "fields": list("fields").into_iter().filter(|k| fields.contains(k)).collect::<Vec<_>>(),
                    "modules": list("modules").into_iter().filter(|k| modules.contains(k)).collect::<Vec<_>>(),
                }));
            let unreached = list("kinds")
                .into_iter()
                .find(|k| !kinds.contains(k))
                .map(|k| ("kind", k))
                .or_else(|| {
                    list("fields")
                        .into_iter()
                        .find(|k| !fields.contains(k))
                        .map(|k| ("field", k))
                })
                .or_else(|| {
                    list("modules")
                        .into_iter()
                        .find(|k| !modules.contains(k))
                        .map(|k| ("module", k))
                });
            if let Some((what, name)) = unreached {
                let mut fields = Map::new();
                fields.insert(what.into(), json!(name));
                fields.insert("case".into(), json!(case.name()));
                let fl = failure("unreached", module, "fixtures", Value::Object(fields));
                case.fail(Verdict::Invalid, fl.clone());
                run.failures.push(fl);
            }
            run.cases.push(case);
        }
        // Each check.
        for (i, check) in f.checks().into_iter().enumerate() {
            let name = format!("{}#check{i}", f.name);
            let probe = check.get("probe").and_then(Value::as_str).unwrap_or("");
            let render_kind = check.get("render").and_then(Value::as_str).unwrap_or("");
            if probe == "bounds" || render_kind == "cpu_reference" {
                let mut case =
                    Case::new(name.clone(), Verdict::Pass).with("fixture", json!(f.name));
                if !criterion_holds(hub, f, check) {
                    let fl = failure(
                        "mismatch",
                        module,
                        "fixtures",
                        json!({"what": "array", "name": name, "seed": 0}),
                    );
                    case.fail(Verdict::Fail, fl.clone());
                    run.failures.push(fl);
                }
                run.cases.push(case);
                continue;
            }
            if probe != "pixels" {
                continue;
            }
            let tolerance = check
                .get("tolerance")
                .and_then(Tolerance::read)
                .unwrap_or(Tolerance::EXACT);
            for backend in &backends {
                let mut case = Case::new(name.clone(), Verdict::Pass)
                    .with("fixture", json!(f.name))
                    .with("backend", json!(backend));
                if render_kind == "golden" {
                    let judged = hub.judge_golden(f, backend);
                    if let Some(p) = judged.reply.get("probe").and_then(Value::as_str) {
                        case.set("probe", json!(p));
                    }
                    case.set("golden", judged.reply.clone());
                    if judged.reply["digest"].is_string() {
                        let expected = judged.reply["match"]["digest"].clone();
                        case.set(
                            "compared",
                            json!({"expected": expected, "actual": judged.reply["digest"]}),
                        );
                    }
                    case.verdict = match judged.verdict {
                        "PASS" => Verdict::Pass,
                        "FAIL" => Verdict::Fail,
                        _ => Verdict::Blocked,
                    };
                    if case.verdict == Verdict::Fail {
                        let fl = failure(
                            "mismatch",
                            module,
                            "fixtures",
                            json!({"what": "snapshot", "name": name, "seed": 0, "case": name}),
                        );
                        case.set("failure", fl.clone());
                        run.failures.push(fl);
                    }
                    run.cases.push(case);
                    continue;
                }
                let t = super::time_order::straight(&f.sidecar)
                    .last()
                    .copied()
                    .unwrap_or(0)
                    .min(FRAME * 30);
                let (actual, expected, twin_actual) = if render_kind == "seek_vs_play" {
                    if backend != "vello_cpu" {
                        (
                            pixels_of(render(hub, &doc, backend, t)),
                            Err(Ok("pixels")),
                            Err(Ok("pixels")),
                        )
                    } else {
                        let (a, b) = seek_and_play(hub, &doc, &doc, t);
                        let twin_doc = f
                            .sidecar
                            .get("twin")
                            .and_then(|tw| twinned(&doc, tw))
                            .unwrap_or_else(|| moved(&doc));
                        let (ta, _) = seek_and_play(hub, &twin_doc, &doc, t);
                        (a.map_err(Err), b.map_err(Err), ta.map_err(Err))
                    }
                } else {
                    let item = check
                        .get("expect")
                        .and_then(|e| e["item"].as_str())
                        .unwrap_or("")
                        .to_string();
                    let reference_doc = reference(hub, &doc, &item);
                    let twin_doc = f
                        .sidecar
                        .get("twin")
                        .and_then(|tw| twinned(&doc, tw))
                        .unwrap_or_else(|| moved(&doc));
                    (
                        pixels_of(render(hub, &doc, backend, 0)),
                        pixels_of(render(hub, &reference_doc, backend, 0)),
                        pixels_of(render(hub, &twin_doc, backend, 0)),
                    )
                };
                match (actual, expected) {
                    (Err(Ok(probe)), _) | (_, Err(Ok(probe))) => {
                        case.set("probe", json!(probe));
                        case.verdict = Verdict::Blocked;
                    }
                    (Err(Err(code)), _) | (_, Err(Err(code))) => {
                        let fl = failure(
                            "mismatch",
                            module,
                            "fixtures",
                            json!({"what": "snapshot", "name": code, "seed": 0, "case": name}),
                        );
                        case.fail(Verdict::Fail, fl.clone());
                        run.failures.push(fl);
                    }
                    (Ok(a), Ok(e)) => {
                        let [w, h] = instance::fit(&doc, 4096.0).map(u32::from);
                        let share_only = hub.planted(Planted::ChecksShareOnly);
                        if hub.planted(Planted::SkipsSnapshotComparison) {
                            // The planted kit: no comparison, and a pass.
                        } else {
                            case.set(
                                "compared",
                                json!({"expected": sha256_hex(&e), "actual": sha256_hex(&a)}),
                            );
                            let j = judge(w, h, &e, &a, &tolerance, share_only);
                            let twin_pass = match twin_actual {
                                Ok(ta) => judge(w, h, &e, &ta, &tolerance, share_only).pass,
                                Err(_) => false,
                            };
                            case.set(
                                "twin",
                                json!({"verdict": if twin_pass { "PASS" } else { "FAIL" }}),
                            );
                            if !j.pass {
                                let fl = failure(
                                    "mismatch",
                                    module,
                                    "fixtures",
                                    json!({"what": "snapshot", "name": name, "seed": 0, "case": name, "compared": j.to_json()}),
                                );
                                case.fail(Verdict::Fail, fl.clone());
                                run.failures.push(fl);
                            } else if twin_pass {
                                let fl = failure(
                                    "twin_passed",
                                    module,
                                    "fixtures",
                                    json!({"case": name}),
                                );
                                case.fail(Verdict::Invalid, fl.clone());
                                run.failures.push(fl);
                            }
                        }
                    }
                }
                run.cases.push(case);
            }
        }
        let ok = run.cases[before..]
            .iter()
            .all(|c| c.verdict == Verdict::Pass);
        passed.insert(f.name.clone(), ok);
    }
    run.declared = run.cases.len() as u64;
    standing(hub, ctx, &fixtures, &passed);
    Some(run)
}

/// The module's interface standing and the criteria its fixtures prove: a kind is covered only
/// by a fixture whose expected value was set outside the implementation and whose cases passed;
/// a criterion such a fixture lists is proved, and one only other fixtures list stays open.
fn standing(hub: &Hub<'_>, ctx: &mut Ctx<'_>, fixtures: &[Entry], passed: &BTreeMap<String, bool>) {
    let outside = |f: &Entry| {
        f.sidecar.get("expected_from").is_some() && passed.get(&f.name).copied().unwrap_or(false)
    };
    if let Some(m) = hub
        .startup
        .sealed
        .modules
        .iter()
        .find(|m| m.name == ctx.module)
    {
        let mut missing = Vec::new();
        for k in &m.shapes.kinds {
            let kind = format!("{}@{}", k.entry.full_name(), k.entry.current().major);
            let covered = fixtures.iter().filter(|f| outside(f)).any(|f| {
                f.document["items"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, i)| i["kind"].as_str() == Some(kind.as_str()))
            });
            if !covered {
                missing.push(kind);
            }
        }
        for c in &m.shapes.checks {
            let covered = fixtures.iter().filter(|f| outside(f)).any(|f| {
                f.checks()
                    .iter()
                    .any(|x| x.get("kind").and_then(Value::as_str) == Some(c.kind.as_str()))
            });
            if !covered {
                missing.push(c.kind.clone());
            }
        }
        if !m.shapes.kinds.is_empty() || !m.shapes.checks.is_empty() {
            ctx.interface = Some(json!({"truth": missing.is_empty(), "missing": missing}));
        }
    }
    for f in fixtures {
        for c in f.sidecar["criteria"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            let e = ctx.criteria.entry(c.to_string()).or_insert("open");
            if outside(f) {
                *e = "proved";
            }
        }
    }
}
