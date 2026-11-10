//! The x86_64 lane's record, as logic.determinism `cross_machine` and logic.budget read it (#1983;
//! canvas primitives: Golden). The lane (`scripts/lane-x86.mjs`) replays a golden in a linux/amd64
//! container on the reference Mac and writes `~/.deepbuild/lanes/<tree>-x86_64.json` (#1115). A
//! replay counts as another machine only on another architecture than the one that recorded the
//! golden, with no network; a reading taken there never counts as a timing or a budget.

use std::path::Path;

use serde_json::{json, Map, Value};

/// The lane's name, as its record's file names it.
pub const LANE: &str = "x86_64";

/// The fields a record must name to count (#1983, criterion 1).
pub const NAMED: [&str; 6] = [
    "recording_machine",
    "lane_arch",
    "host_arch",
    "emulated",
    "image_digest",
    "tree",
];

/// The lane's record for `tree` whose golden is this bake (its `bake_key` equals `keys`), from
/// `$HOME/.deepbuild/lanes`.
pub fn record(tree: &str, keys: &Map<String, Value>) -> Option<Value> {
    let home = std::env::var_os("HOME")?;
    let file = Path::new(&home)
        .join(".deepbuild")
        .join("lanes")
        .join(format!("{tree}-{LANE}.json"));
    let r: Value = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    (r.get("bake_key") == Some(&Value::Object(keys.clone()))).then_some(r)
}

fn given(r: &Value, field: &str) -> Option<Value> {
    r.get(field).filter(|v| !v.is_null()).cloned()
}

/// logic.determinism `cross_machine` on the lane's record: PASS only on a PASS record that names
/// every field, ran on another architecture than the golden's and had no network; FAIL from a FAIL
/// record's golden report; BLOCKED with one ask without a record or on a BLOCKED one; otherwise
/// INVALID, with a refusal naming each field that keeps it from counting.
pub fn cross(record: Option<&Value>, tree: &str) -> Value {
    let reply = |verdict: &str,
                 failures: Vec<Value>,
                 machines: Value,
                 refusals: Vec<Value>,
                 ask: Value| {
        json!({"ok": true, "kind": "logic.determinism", "compare": "cross_machine", "verdict": verdict, "failures": failures,
            "machines": machines, "refusals": refusals, "ask": ask})
    };
    let Some(r) = record else {
        let ask = format!("logic.determinism cross_machine replays this golden on x86_64, and the lane has no record of it for tree {tree}: run its golden_verify call through node scripts/lane-x86.mjs");
        return reply("BLOCKED", vec![], Value::Null, vec![], json!(ask));
    };
    if r["state"] == "BLOCKED" {
        let ask = r["ask"].as_str().map_or_else(
            || json!("the x86_64 lane couldn't run this golden's replay; run node scripts/lane-x86.mjs again"),
            |a| json!(a),
        );
        return reply("BLOCKED", vec![], Value::Null, vec![], ask);
    }
    let mut refusals: Vec<Value> = NAMED
        .iter()
        .filter(|f| given(r, f).is_none())
        .map(|f| json!({"field": f, "value": null}))
        .collect();
    if given(r, "tree").is_some_and(|t| t != tree) {
        refusals.push(json!({"field": "tree", "value": r["tree"]}));
    }
    let recorded = r["recording_machine"]["arch"].as_str();
    let arch = r["lane_arch"].as_str();
    let machines = match (recorded, arch) {
        (Some(a), Some(b)) if a == b => json!("same"),
        (Some(_), Some(_)) => json!("different"),
        _ => Value::Null,
    };
    if machines == "same" {
        refusals.push(json!({"field": "lane_arch", "value": arch, "machines": "same"}));
    }
    if r["network"] != "none" {
        refusals.push(json!({"field": "network", "value": given(r, "network")}));
    }
    match r["state"].as_str() {
        // Any FAIL wins: a replay that differed fails whatever else the record lacks.
        Some("FAIL") => reply("FAIL", vec![failure(r)], machines, refusals, Value::Null),
        Some("PASS") if refusals.is_empty() => {
            reply("PASS", vec![], machines, refusals, Value::Null)
        }
        Some(s @ "INCONCLUSIVE") => reply(s, vec![], machines, refusals, Value::Null),
        _ => reply("INVALID", vec![], machines, refusals, Value::Null),
    }
}

/// A golden failure from a FAIL record's report (Golden: Report), in logic.determinism's shape.
fn failure(r: &Value) -> Value {
    let report = &r["report"];
    let field = &report["field"];
    let item = field["id"].as_str().or_else(|| report["item"].as_str());
    let array = field["field"]
        .as_str()
        .zip(item)
        .map(|(f, i)| format!("{i}.{f}"));
    json!({"item": item, "run": "golden", "from": null, "at": null, "checkpoint": null, "step": report["first_step"],
        "field": if array.is_some() { "array" } else { "step_hash" }, "array": array, "control": null,
        "values": field.get("values"), "ulp_distance": field.get("ulp_distance"), "lane": r["lane"], "error": r.get("error")})
}

/// Each reading the lane's record holds, refused as a timing (a time in ns) or a budget, naming
/// the lane and whether it ran emulated: none counts toward logic.budget.
pub fn refusals(record: &Value) -> Vec<Value> {
    readings(record)
        .map(|x| {
            let r#as = if x.get("ns").is_some() { "timing" } else { "budget" };
            json!({"reading": x["name"], "as": r#as, "lane": record["lane"], "emulated": record["emulated"],
                "why": "a reading taken in the lane, on another machine than the reference Mac and under emulation, is never a timing or a budget"})
        })
        .collect()
}

/// The planted reader: each lane reading counted as this host's own, a time against the frame
/// and a budget verdict as a failure.
pub fn counted(record: &Value, frame_ns: f64) -> Vec<Value> {
    readings(record)
        .filter_map(|x| match x["ns"].as_f64() {
            Some(ns) => (ns > frame_ns).then(
                || json!({"rule": "frame", "host": record["lane"], "reading": x["name"], "ns": ns}),
            ),
            None => (x["verdict"] == "FAIL")
                .then(|| json!({"rule": "budget", "host": record["lane"], "reading": x["name"]})),
        })
        .collect()
}

fn readings(record: &Value) -> impl Iterator<Item = &Value> {
    record["readings"].as_array().into_iter().flatten()
}
