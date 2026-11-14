//! The logic canvas module's manifest and register call (#535): `logic@1`, whose arrays fill the
//! core's `column.source@1` as `<logic>.<name>` (Mark set: logic columns), so a mark set reads a
//! logic array through the core's column view and no reading module depends on this one. A build
//! without it refuses a document that reads an array with `module_missing`, naming logic. Its
//! items' check, steps and seal are #533's; the host bakes the arrays at check.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_canvas::registry::{
    Equivalence, Implementation, Manifest, Module, Raised, Range, Registrar, Report, Semver,
    StateClass,
};
use serde_json::{json, Value};

use crate::piece::{self, History, Piece};
use crate::world::{handed, track_of, Entry, Record, World};

/// The interface this module implements.
pub const INTERFACE: &str = "logic@1";

/// The shipped module.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
            name: "logic".into(),
            version: Semver::parse("1.0.0").expect("a version"),
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "logic".into(),
            license: "Apache-2.0".into(),
            implements: INTERFACE.into(),
            implementation: Implementation {
                name: "logic".into(),
                version: Semver::parse("1.0.0").expect("a version"),
                pins: BTreeMap::new(),
                equivalence: Equivalence::Bit,
                state: StateClass::Canonical,
            },
        },
        register,
    }
}

/// One entry: each logic item's arrays, by `<logic>.<name>`. Its fixture's changed ranges are
/// the ones the module hands over, so the kit's clean-rebuild rule runs [`handed`] itself.
fn register(r: &mut Registrar) {
    // #548: deep_run's logic kinds (Check input: logic kinds), each on the lowered document's
    // logic items, their programs read from the assets the check names.
    r.check("logic.determinism", "any", &["logic.determinism"], |d, i| issues(determinism(d, i)))
        .check_report(determinism);
    r.check("logic.budget", "any", &["logic.budget"], |d, i| issues(budget(d, i)))
        .check_report(budget);
    r.code(
        "logic.determinism",
        "Seeking a logic item doesn't equal playing it: a step or full-state hash, an array or a continuation probe differs.",
        "Keep every bit of state in the program's memory and globals, and draw each roll from the seed init gets.",
        false,
    );
    r.code(
        "logic.budget",
        "A logic step passes its fuel share or its class's step ceiling, or a frame's steps pass the class's frame time.",
        "Split the work across steps with its progress in memory.",
        false,
    );
    // Each code's planted fixture (#138's kit): a program that traps at step 0, which fails the
    // determinism check that ran it, and one whose every step spends most of its fuel.
    planted(r, "logic.determinism", "(unreachable)");
    planted(r, "logic.budget", "(local $i i32) (loop $l (local.set $i (i32.add (local.get $i) (i32.const 1))) (br_if $l (i32.lt_u (local.get $i) (i32.const 200000))))");
    let frames = json!([[0, 0, 0], [0, 5, 0], [0, 5, 7]]);
    let changed = json!([handed(&[]), handed(&[[1, 2]]), handed(&[[2, 3]])]);
    r.entry(
        deep_canvas::columns::REGISTRY,
        "logic.array@1",
        json!({"form": "<logic>.<name>", "types": ["bool", "i32", "f64", "vec2", "vec3", "quat"],
               "fixture": {"frames": frames, "changed": changed,
                           "seeks": [{"from": 2, "to": 1, "rows": [0, 5, 0]}]}}),
        "R6",
    );
}

/// The fixture that raises exactly `code`: a figure of one logic item whose step is `body`, its
/// program a fixture asset, since a kit fixture has no evidence store. It names no other module's
/// kind, which the kit's seal of this module alone would refuse as unknown.
fn planted(r: &mut Registrar, code: &str, body: &str) {
    let text = format!(r#"(module (memory (export "memory") 1 1) (global (export "reads_at") i32 (i32.const 0))
        (global (export "writes_at") i32 (i32.const 1024)) (func (export "init") (param i64)) (func (export "step") (param i64) {body}))"#);
    let program = wat::parse_str(text).expect("a planted program");
    let sha = deep_canvas::canon::sha256_hex(&program);
    let doc = json!({
        "format": 1, "profile": "figure", "title": code, "description": format!("The logic module's planted {code}."), "size": [320, 180],
        "seed": 1, "transport": {"span": "1s", "frame_rate": [60, 1]}, "requires": {"modules": {"logic": "^1"}},
        "items": {
            "rules": {"id": "rules", "kind": "logic@1", "name": "Rules", "order": "a1", "params": {"program": sha, "writes": {"n": {"type": "i32"}}}},
        },
    });
    r.fixture(&format!("logic-{}", &code[6..]), doc, None)
        // The kit seals this module alone, so the core's check finds logic@1 an unknown kind.
        .sidecar(json!({"codes": [code, "unknown_kind"], "checks": [{"kind": code}]}))
        .fixture_assets(vec![program]);
}

/// What a report raises, as a check over items gives it.
fn issues(report: Report) -> Vec<(String, Raised)> {
    report.raised.into_iter().map(|(id, r, _)| (id, r)).collect()
}

/// The lowered document's logic items as one checked piece, its input track, and the steps its
/// transport's span covers; or why it can't be read, as a blocked row.
fn baked(doc: &Value, input: &Value) -> Result<(Rc<Piece>, Vec<Entry>, i64), Value> {
    let items: serde_json::Map<String, Value> = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, i)| i["kind"] == "logic@1")
        .map(|(id, i)| (id.clone(), json!({"kind": "logic@1", "params": i.get("params").cloned().unwrap_or(json!({}))})))
        .collect();
    let line = json!({"seed": doc.get("seed").and_then(Value::as_i64).unwrap_or(0),
        "controls": doc.get("controls").cloned().unwrap_or(json!({})), "items": items,
        "assets": input.get("assets").cloned().unwrap_or(json!({}))});
    let piece = piece::check(&line, &Default::default(), &mut History::new()).map_err(|r| r.0)?;
    let entries: Vec<Entry> = doc
        .get("track")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|e| e.get("present").is_none())
        .filter_map(Entry::parse)
        .collect();
    let span = doc
        .pointer("/transport/span")
        .map_or(Ok(0), |v| deep_canvas::document::duration(doc, v))
        .map_err(|e| json!({"what": format!("the transport's span: {e}")}))?;
    let steps = piece.items.iter().map(|i| (span + i.step - 1) / i.step.max(1)).max().unwrap_or(0);
    Ok((Rc::new(piece), entries, steps))
}

/// Each failure of a logic check as the report raises it: on its item, its row as `actual`.
fn raised(kind: &'static str, failures: &[Value], piece: &Piece) -> Vec<(String, Raised, Value)> {
    failures
        .iter()
        .map(|f| {
            let item = f["item"].as_str().or_else(|| piece.items.first().map(|i| i.id.as_str())).unwrap_or_default().to_string();
            let what = format!("{kind}: {}", f.get("rule").or_else(|| f.get("run")).map_or_else(|| f.to_string(), Value::to_string));
            let r = Raised { code: kind, severity: "error", path: format!("items/{item}"), what, fix_ops: None };
            (item, r, f.clone())
        })
        .collect()
}

/// `logic.determinism {at_times, compare}`: the bake run twice and from each checkpoint before
/// each sampled time, with continuation probes; another machine or the web player is BLOCKED
/// until it has run.
fn determinism(doc: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    let (piece, entries, steps) = match baked(doc, input) {
        Ok(b) => b,
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    };
    let len = piece.items.first().map_or(1, |i| i.step.max(1));
    let mut at: Vec<i64> = input
        .get("at_times")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|t| deep_canvas::document::duration(doc, t).ok())
        .map(|t| (t / len).clamp(1, steps.max(1)))
        .collect();
    if at.is_empty() {
        at.push((steps / 2).max(1));
    }
    // A trap in any run fails the check that ran it (Check input: logic kinds).
    let mut rec = Record::default();
    match World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None) {
        Ok(mut w) => w.run(steps, &mut rec, &mut |_, _| {}),
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    }
    let mut failures: Vec<Value> = rec.traps.iter().map(|t| json!({"rule": "trap", "item": t["item"], "trap": t})).collect();
    match crate::checks::determinism(&piece, &entries, steps, &at, Default::default()) {
        Ok(v) => failures.extend(v["failures"].as_array().cloned().unwrap_or_default()),
        Err(e) => out.blocked.push(e),
    }
    out.raised = raised("logic.determinism", &failures, &piece);
    match input.get("compare").and_then(Value::as_str) {
        Some(c @ ("cross_machine" | "web")) => out.blocked.push(json!({"compare": c, "ask": format!("logic.determinism {c} replays the golden on another host; it hasn't run")})),
        _ => {}
    }
    out.results.push(json!({"kind": "logic.determinism", "steps": steps, "at": at}));
    out
}

/// `logic.budget {fuel_share, on}`: the bake's fuel per step held to its share and its class's
/// step ceiling on each host, and the web BLOCKED until the player's timed run.
fn budget(doc: &Value, input: &Value) -> Report {
    let mut out = Report::default();
    let (piece, entries, steps) = match baked(doc, input) {
        Ok(b) => b,
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    };
    let share = input.get("fuel_share").and_then(Value::as_f64).unwrap_or(0.5);
    let on: Vec<String> = input
        .get("on")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_else(|| vec!["app".into()]);
    let mut rec = Record::default();
    match World::new(piece.clone(), track_of(&entries), false, Default::default(), &mut rec, None) {
        Ok(mut w) => w.run(steps, &mut rec, &mut |_, _| {}),
        Err(e) => {
            out.blocked.push(e);
            return out;
        }
    }
    // A trap fails the check that ran it (Check input: logic kinds).
    let mut failures: Vec<Value> = rec.traps.iter().map(|t| json!({"rule": "trap", "item": t["item"], "trap": t})).collect();
    let reply = crate::budget::budget(&piece, &rec, share, &on, Default::default());
    failures.extend(reply["failures"].as_array().cloned().unwrap_or_default());
    out.raised = raised("logic.budget", &failures, &piece);
    out.blocked.extend(reply["blocked"].as_array().cloned().unwrap_or_default());
    out.results.push(json!({"kind": "logic.budget", "report": reply["report"]}));
    out
}
