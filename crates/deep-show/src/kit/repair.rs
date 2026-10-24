//! The repair loop's four cases (issue #138; canvas primitives: Patch), played on the hub's
//! shared documents (#96) as three writers send them: a planted fault carrying `{path, code,
//! fix}` runs fault, issue, apply, rerun and PASS; a stale fix rebases when no ID it touches
//! changed since its base; a fix after another writer changed another path of the same item is a
//! conflict naming both writers; the second of two fixes on one base is refused naming both
//! writers; and a fix that fails its dry run is refused with its code, changing nothing.

use serde_json::{json, Value};

use super::catalog::{codes, fixture_issues, stamped};
use super::{failure, Case, Ctx, PartRun, Verdict};
use crate::hub::Hub;

/// The world every scene shares: two agents' sessions and the process table the peer check
/// reads, with `deep show` run in each agent's tree and in yours.
fn world() -> Value {
    json!({
        "sessions": {
            "sess-alpha": {"thread": "thread-alpha", "name": "Claude Code: kit", "process": {"pid": 4100, "start": 1000}},
            "sess-bravo": {"thread": "thread-bravo", "name": "Codex: kit", "process": {"pid": 5200, "start": 2000}},
        },
        "processes": [
            {"pid": 1, "ppid": 0, "start": 0}, {"pid": 3000, "ppid": 1, "start": 100},
            {"pid": 3001, "ppid": 3000, "start": 110}, {"pid": 3002, "ppid": 3001, "start": 3000},
            {"pid": 4100, "ppid": 3001, "start": 1000}, {"pid": 4101, "ppid": 4100, "start": 1100},
            {"pid": 4102, "ppid": 4101, "start": 1200}, {"pid": 5200, "ppid": 3001, "start": 2000},
            {"pid": 5201, "ppid": 5200, "start": 2100}, {"pid": 5202, "ppid": 5201, "start": 2200},
        ],
    })
}

/// Who a call acts as.
pub fn who(name: &str) -> Value {
    match name {
        "alpha" => json!({"call": "deep_show", "session": "sess-alpha"}),
        "alpha_cli" => json!({"call": "deep show", "peer": {"pid": 4102, "start": 1200}}),
        "bravo" => json!({"call": "deep_show", "session": "sess-bravo"}),
        _ => json!({"call": "deep show", "peer": {"pid": 3002, "start": 3000}}),
    }
}

/// The shared document's ID in a scene.
const DOC: &str = "01JB138S000000000000000001";

/// Plays a scene on a hub of its own: `{"document"?, "calls": [call]}`, each call's `doc` the
/// scene's document; the scenario's planted program and golden store carry over. Its replies.
pub fn play_scene(hub: &Hub<'_>, scene: &Value) -> Vec<Value> {
    let mut input = world();
    let evidence = hub.scenario.evidence.join("kit-scenes");
    let _ = std::fs::create_dir_all(&evidence);
    input["evidence"] = json!(evidence.to_string_lossy());
    input["panels"] = json!({"p1": {"rect": [0, 0, 800, 600]}});
    let mut doc_entry = json!({"panel": "p1"});
    if let Some(d) = scene.get("document").filter(|d| !d.is_null()) {
        doc_entry["document"] = d.clone();
    }
    input["docs"] = json!({ DOC: doc_entry });
    if let Some(q) = scene.get("quotas") {
        input["quotas"] = q.clone();
    }
    let calls: Vec<Value> = scene["calls"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| {
            let mut c = c.clone();
            if c.get("doc").is_some() {
                c["doc"] = json!(DOC);
            }
            if let Some(p) = c.get_mut("patch") {
                p["doc"] = json!(DOC);
            }
            c
        })
        .collect();
    input["calls"] = json!(calls);
    let Some(mut scenario) = input.as_object().and_then(crate::scenario) else {
        return vec![json!({"outcome": "refused", "code": "bad_input", "issues": []})];
    };
    scenario.planted = hub.scenario.planted;
    scenario.goldens = match scene.get("goldens").and_then(Value::as_str) {
        Some(g) => Some(std::path::PathBuf::from(g)),
        None => hub.scenario.goldens.clone(),
    };
    scenario.environment.clone_from(&hub.scenario.environment);
    scenario.commit.clone_from(&hub.scenario.commit);
    let mut nested = Hub::new(&scenario, hub.startup);
    nested.run_calls()
}

/// A patch call from `who`, on base `base`.
fn send(by: &str, n: u32, base: u64, ops: &Value, dry_run: bool) -> Value {
    let mut c = who(by);
    let mut patch = json!({"patch": format!("01JB138R{n:018}"), "doc": DOC, "base": base,
                           "reason": "the repair loop", "ops": ops});
    if dry_run {
        patch["dry_run"] = json!(true);
    }
    c["doc"] = json!(DOC);
    c["patch"] = patch;
    c
}

fn read() -> Value {
    json!({"call": "read", "doc": DOC})
}

/// The planted fault a module's repair loop runs: its document, with every item in alpha's
/// layer and one item in yours, the fault's item, path and code, and its fix as patch ops.
struct Fault {
    doc: Value,
    item: String,
    path: String,
    code: String,
    fix: Value,
    /// Another field of the fault's item, which you change in `stale_same_item`.
    other: (String, Value),
}

/// The layers every repair document holds.
fn layers() -> Value {
    json!({
        "you-main": {"writer": "you:you", "title": "You", "order": "a0"},
        "alpha-main": {"writer": "agent:thread-alpha", "title": "Claude Code: kit", "order": "a1"},
        "bravo-main": {"writer": "agent:thread-bravo", "title": "Codex: kit", "order": "a2"},
    })
}

/// A document's items moved to alpha's layer, with your own box beside them.
fn shared_doc(doc: &Value) -> Value {
    let mut out = doc.clone();
    if let Some(map) = out.as_object_mut() {
        map.remove("id");
        map.remove("layers");
    }
    out["layers"] = layers();
    if let Some(Value::Object(items)) = out.get_mut("items") {
        for item in items.values_mut() {
            item["layer"] = json!("alpha-main");
        }
        items.insert(
            "kit-yours".into(),
            json!({"id": "kit-yours", "kind": "rect@1", "layer": "you-main", "name": "Your box",
                   "order": "zz", "params": {"box": [0, 0, 24, 24], "paint": {"fill": {"role": "muted"}}}}),
        );
    }
    out
}

/// The module's planted fault: a fixture whose issue carries its fix as patch ops, else its
/// first fixture with an item, its position planted out of range and the fix setting it back.
fn fault_of(hub: &mut Hub<'_>, ctx: &Ctx<'_>) -> Option<Fault> {
    let fixtures: Vec<_> = ctx
        .manifest
        .of_module(ctx.module)
        .into_iter()
        .filter(|f| !f.is_scene())
        .cloned()
        .collect();
    for f in &fixtures {
        if f.codes().is_none_or(|c| c.is_empty()) {
            continue;
        }
        let issues = fixture_issues(hub, f);
        let Some(issue) = issues.iter().find(|i| i.get("fix_ops").is_some()) else {
            continue;
        };
        let item = issue["ids"][0].as_str().unwrap_or("").to_string();
        let path = issue["path"].as_str().unwrap_or("").to_string();
        let other = other_field(&f.document["items"][&item], &path);
        return Some(Fault {
            doc: shared_doc(&f.document),
            item,
            path,
            code: issue["code"].as_str().unwrap_or("").to_string(),
            fix: issue["fix_ops"].clone(),
            other,
        });
    }
    let sealed = &hub.startup.sealed;
    let f = fixtures.iter().find(|f| {
        super::catalog::accepted(sealed, f)
            && f.document["items"]
                .as_object()
                .is_some_and(|i| !i.is_empty())
    })?;
    // An item of a kind the build knows: another build's is never targeted.
    let (item, value) = f.document["items"].as_object()?.iter().find(|(_, v)| {
        v["kind"].as_str().is_some_and(crate::shared::knows)
            || v["kind"]
                .as_str()
                .and_then(deep_canvas::kinds::parse_kind)
                .is_some_and(|(full, _)| sealed.module_of_kind(&full).is_some())
    })?;
    let path = format!("items/{item}/at/pos");
    let fix = match value.get("at").and_then(|a| a.get("pos")) {
        Some(pos) => json!([{"op": "set", "id": item, "path": path, "value": pos}]),
        None => json!([{"op": "set", "id": item, "path": path, "value": [0, 0, 0]}]),
    };
    let mut doc = shared_doc(&f.document);
    doc["items"][item]["at"] = json!({"pos": "out of range"});
    if let Some(at) = value.get("at").and_then(Value::as_object) {
        for (k, v) in at {
            if k != "pos" {
                doc["items"][item]["at"][k] = v.clone();
            }
        }
    }
    let probe = stamped(&doc);
    let issues = super::catalog::raised(hub, &probe);
    let code = issues
        .iter()
        .find(|i| i["path"] == path.as_str())
        .and_then(|i| i["code"].as_str())
        .unwrap_or("out_of_range")
        .to_string();
    Some(Fault {
        doc,
        item: item.clone(),
        path,
        code,
        fix,
        other: (format!("items/{item}/name"), json!("Renamed by you")),
    })
}

/// Another field of an item than `path`: a number param the fault doesn't name, else its name.
fn other_field(item: &Value, path: &str) -> (String, Value) {
    let id = item["id"].as_str().unwrap_or("");
    if let Some(params) = item.get("params").and_then(Value::as_object) {
        for (k, v) in params {
            let p = format!("items/{id}/params/{k}");
            if p != path && v.is_number() {
                let n = v.as_f64().unwrap_or(0.0);
                return (p, json!(if n == 2.0 { 4 } else { 2 }));
            }
        }
    }
    (format!("items/{id}/name"), json!("Renamed by you"))
}

/// The writers a conflict reply names, as `kind:id`, sorted.
fn conflict_writers(reply: &Value) -> Vec<String> {
    let mut out: Vec<String> = reply["conflict"]["writers"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|w| {
            format!(
                "{}:{}",
                w["kind"].as_str().unwrap_or(""),
                w["id"].as_str().unwrap_or("")
            )
        })
        .collect();
    out.sort();
    out
}

fn has_fault(reply: &Value, f: &Fault) -> bool {
    reply["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .any(|i| i["code"] == f.code.as_str() && i["path"] == f.path.as_str())
}

/// The repair loop's five cases for one module.
pub fn run(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let f = fault_of(hub, ctx)?;
    let module = ctx.module;
    let fault_json = json!({"path": f.path, "code": f.code, "fix": f.fix});
    let scene = |calls: Vec<Value>| json!({"document": f.doc, "calls": calls});
    let you_box = json!([{"op": "set", "id": "kit-yours", "path": "items/kit-yours/params/box", "value": [0, 0, 28, 24]}]);
    let other = json!([{"op": "set", "id": f.item, "path": f.other.0, "value": f.other.1}]);
    let delete = json!([{"op": "delete", "id": f.item, "cascade": true}]);
    let alpha = "agent:thread-alpha".to_string();
    let bravo = "agent:thread-bravo".to_string();
    let you = "you:you".to_string();
    let mut cases = Vec::new();
    let mut failures = Vec::new();
    let mut judge = |name: &str, problems: Vec<String>, steps: Option<Vec<&str>>| {
        let mut case = Case::new(name, Verdict::Pass).with("fault", fault_json.clone());
        if let Some(s) = steps {
            case.set("steps", json!(s));
        }
        if !problems.is_empty() {
            case.set("problems", json!(problems));
            let fl = failure("repair", module, "repair_loop", json!({"case": name}));
            case.fail(Verdict::Fail, fl.clone());
            failures.push(fl);
        }
        cases.push(case);
    };

    // apply: fault, issue, apply, rerun, PASS.
    let r = play_scene(
        hub,
        &scene(vec![read(), send("alpha", 1, 0, &f.fix, false), read()]),
    );
    let mut steps = vec!["fault"];
    let mut problems = Vec::new();
    if has_fault(&r[0], &f) {
        steps.push("issue");
    } else {
        problems.push(format!(
            "the planted fault raised no {} at {}",
            f.code, f.path
        ));
    }
    if r[1]["outcome"] == "applied" {
        steps.push("apply");
    } else {
        problems.push(format!("the fix was {}", r[1]["outcome"]));
    }
    if r[2]["rev"].is_number() {
        steps.push("rerun");
    }
    if !has_fault(&r[2], &f) && problems.is_empty() {
        steps.push("pass");
    } else if has_fault(&r[2], &f) {
        problems.push("the rerun still raises the fault".into());
    }
    judge("apply", problems, Some(steps));

    // stale_rebase: you change your own box; alpha's fix on base 0 rebases and applies.
    let r = play_scene(
        hub,
        &scene(vec![
            send("you", 1, 0, &you_box, false),
            send("alpha", 2, 0, &f.fix, false),
            read(),
        ]),
    );
    let mut problems = Vec::new();
    if r[0]["outcome"] != "applied" {
        problems.push(format!("your change was {}", r[0]["outcome"]));
    }
    if r[1]["outcome"] != "applied" {
        problems.push(format!(
            "the stale fix was {}, not rebased",
            r[1]["outcome"]
        ));
    }
    if has_fault(&r[2], &f) {
        problems.push("the fault is still raised".into());
    }
    judge("stale_rebase", problems, None);

    // stale_same_item: you change another path of the fault's item; alpha's fix is a conflict
    // naming alpha and you, and leaves the document as it was.
    let r = play_scene(
        hub,
        &scene(vec![
            send("you", 1, 0, &other, false),
            read(),
            send("alpha", 2, 0, &f.fix, false),
            read(),
        ]),
    );
    let mut problems = Vec::new();
    if r[2]["outcome"] != "conflict" {
        problems.push(format!(
            "the fix after your change was {}, not a conflict",
            r[2]["outcome"]
        ));
    } else if conflict_writers(&r[2]) != vec![alpha.clone(), you.clone()] {
        problems.push(format!("the conflict names {:?}", conflict_writers(&r[2])));
    }
    if r[3]["hash"] != r[1]["hash"] {
        problems.push("the refused fix changed the document".into());
    }
    judge("stale_same_item", problems, None);

    // conflicting: alpha's fix applies; bravo's on the same base is refused naming both.
    let r = play_scene(
        hub,
        &scene(vec![
            send("alpha", 1, 0, &f.fix, false),
            read(),
            send("bravo", 2, 0, &f.fix, false),
            read(),
        ]),
    );
    let mut problems = Vec::new();
    if r[0]["outcome"] != "applied" {
        problems.push(format!("the first fix was {}", r[0]["outcome"]));
    }
    if r[2]["outcome"] != "conflict" {
        problems.push(format!(
            "the second fix was {}, not a conflict",
            r[2]["outcome"]
        ));
    } else if conflict_writers(&r[2]) != vec![alpha.clone(), bravo.clone()] {
        problems.push(format!("the conflict names {:?}", conflict_writers(&r[2])));
    }
    if r[3]["hash"] != r[1]["hash"] {
        problems.push("the refused fix changed the document".into());
    }
    judge("conflicting", problems, None);

    // dry_run_refused: with the item gone, the fix's dry run is refused with its code.
    let r = play_scene(
        hub,
        &scene(vec![
            send("you", 1, 0, &delete, false),
            read(),
            send("alpha", 2, 1, &f.fix, true),
            read(),
        ]),
    );
    let mut problems = Vec::new();
    if r[2]["outcome"] != "refused" {
        problems.push(format!("the dry run was {}", r[2]["outcome"]));
    }
    let refusal = codes(r[2]["issues"].as_array().map_or(&[][..], |v| v.as_slice()));
    if refusal.is_empty() {
        problems.push("the refusal carries no code".into());
    }
    let listed = super::catalog::rows(hub, &ctx.manifest.fixtures);
    for c in &refusal {
        if !listed.iter().any(|r| r.code == *c) {
            problems.push(format!("the refusal's code {c} isn't in the catalog"));
        }
    }
    if r[3]["hash"] != r[1]["hash"] {
        problems.push("the dry run changed the document".into());
    }
    judge("dry_run_refused", problems, None);

    let mut run = PartRun::new(5);
    run.cases = cases;
    run.failures = failures;
    Some(run)
}
