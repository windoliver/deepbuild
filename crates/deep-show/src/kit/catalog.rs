//! The check catalog (canvas primitives: What holds a document to its rules): every code a check
//! can emit, with its canvas module, what it means and its fix, and a planted fixture that
//! raises it. A fix is patch ops only where the kit applied it on each fixture that raises its
//! code and a second check returned that fixture's other codes and nothing else.
//!
//! The catalog part holds a module to it: a code its fixtures raise that the catalog doesn't
//! list fails it (`uncatalogued`), each of its codes' planted fixtures must raise exactly what it
//! names, and each ops fix is applied (`ops_fix`) or the module fails (`unproved_fix`).

use std::collections::BTreeSet;

use deep_canvas::document::{apply_ops, check_in, writer_layer, Writing, CORE_CODES};
use deep_canvas::kinds::{lookup, Lookup};
use deep_canvas::show::{stamp, Writer, WriterKind};
use serde_json::{json, Value};

use super::manifest::Entry;
use super::{failure, Case, Ctx, PartRun, Verdict};
use crate::frames::{op_issue, overflows, unfit_issue};
use crate::hub::{Hub, Planted};
use crate::snapshot::Unfit;

/// The core's planted fixtures, one or more per code, as data.
const CORE_FIXTURES: &str = include_str!("catalog.json");

/// The core's catalog fixtures as manifest entries.
pub fn core_fixtures() -> Vec<Entry> {
    let list: Vec<Value> = serde_json::from_str(CORE_FIXTURES).unwrap_or_default();
    list.into_iter()
        .filter_map(|f| {
            let name = f.get("name")?.as_str()?.to_string();
            let module = f.get("module")?.as_str()?.to_string();
            let (profile, document) = match f.get("scene") {
                Some(scene) => ("scene".to_string(), scene.clone()),
                None => {
                    let doc = f.get("document")?.clone();
                    let profile = doc.get("profile")?.as_str()?.to_string();
                    (profile, doc)
                }
            };
            Some(Entry {
                name: format!("parity/framework/{name}.{profile}"),
                module,
                category: "framework".into(),
                profile,
                document,
                record: None,
                sidecar: json!({
                    "checks": [{"kind": "document.validate"}],
                    "oracles": ["analytic"],
                    "codes": f.get("codes")?.clone(),
                }),
            })
        })
        .collect()
}

/// One row of the catalog.
#[derive(Clone, Debug)]
pub struct Row {
    pub code: String,
    pub module: String,
    pub meaning: String,
    pub fix: String,
    pub fix_ops: bool,
    /// Its planted fixture's name, or empty when no fixture raises it.
    pub fixture: String,
}

/// The fix a code carries: its module's catalog's, else that of the module that catalogs it (a
/// code two modules raise through one reader, such as a scale's), else the core's.
pub fn fix_of(hub: &Hub<'_>, module: &str, code: &str) -> String {
    let modules = &hub.startup.sealed.modules;
    let own = modules
        .iter()
        .filter(|m| m.name == module || module.is_empty());
    own.chain(modules.iter())
        .flat_map(|m| m.shapes.catalog.iter())
        .find(|c| c.code == code)
        .map(|c| c.fix.clone())
        .unwrap_or_else(|| deep_canvas::document::fix_for(code))
}

/// Every row of the catalog: the core's codes, then each module's, each with the planted fixture
/// whose sidecar names it (the one naming it alone first).
pub fn rows(hub: &Hub<'_>, fixtures: &[Entry]) -> Vec<Row> {
    let mut out: Vec<Row> = Vec::new();
    for (code, meaning) in CORE_CODES {
        out.push(Row {
            code: code.to_string(),
            module: "core".into(),
            meaning: meaning.to_string(),
            fix: deep_canvas::document::fix_for(code),
            fix_ops: false,
            fixture: String::new(),
        });
    }
    for m in &hub.startup.sealed.modules {
        for c in &m.shapes.catalog {
            if out.iter().any(|r| r.code == c.code) {
                continue;
            }
            out.push(Row {
                code: c.code.to_string(),
                module: m.name.clone(),
                meaning: c.meaning.clone(),
                fix: c.fix.clone(),
                fix_ops: c.fix_ops,
                fixture: String::new(),
            });
        }
    }
    for row in &mut out {
        let mut named: Vec<&Entry> = fixtures
            .iter()
            .filter(|f| f.module == row.module && f.codes().is_some_and(|c| c.contains(&row.code)))
            .collect();
        named.sort_by_key(|f| f.codes().map_or(usize::MAX, |c| c.len()));
        if let Some(f) = named.first() {
            row.fixture = f.name.clone();
        }
    }
    out
}

impl<'a> Hub<'a> {
    /// `{"call": "catalog"}`.
    pub fn catalog_reply(&self) -> Value {
        let manifest = super::manifest::Manifest::of(self);
        let codes: Vec<Value> = rows(self, &manifest.fixtures)
            .into_iter()
            .map(|r| {
                json!({"code": r.code, "module": r.module, "meaning": r.meaning, "fix": r.fix,
                       "fix_ops": r.fix_ops, "fixture": r.fixture})
            })
            .collect();
        json!({ "codes": codes })
    }
}

/// A fixture's document as a session reads it: stamped with an ID and, when it has none, a
/// layer for you.
pub fn stamped(doc: &Value) -> Value {
    const ID: &str = "01jb138k000000000000000000";
    if doc.get("layers").is_some() {
        let mut out = doc.clone();
        if out.get("id").is_none() {
            out["id"] = json!(ID);
        }
        return out;
    }
    let you = Writer {
        kind: WriterKind::You,
        id: "you".into(),
    };
    let mut payload = doc.clone();
    if let Some(map) = payload.as_object_mut() {
        map.remove("id");
    }
    stamp(&payload, ID, &you, "You").unwrap_or_else(|_| doc.clone())
}

/// Whether a fixture is a document the check accepts: what the evaluation parts run on, a
/// planted fault's document aside.
pub fn accepted(sealed: &deep_canvas::registry::Sealed, f: &Entry) -> bool {
    !f.is_scene() && f.document["items"].is_object() && check_in(&stamped(&f.document), sealed).ok
}

/// What a document raises, as `deep_show` shows it: the check's issues and notices, the numbers
/// past f64's range, and, when the check found no error, what its operators can't evaluate and
/// what the renderer can't draw.
pub fn raised(hub: &mut Hub<'_>, doc: &Value) -> Vec<Value> {
    raised_with(hub, doc, None)
}

/// What a document raises read against `readings`, a fixture's own record, when it has one.
fn raised_with(
    hub: &mut Hub<'_>,
    doc: &Value,
    readings: Option<&std::collections::BTreeMap<String, Value>>,
) -> Vec<Value> {
    let result = check_in(doc, &hub.startup.sealed);
    let mut issues: Vec<Value> = result.issues.iter().map(|i| i.to_json()).collect();
    issues.extend(result.notices.iter().map(|n| n.to_json()));
    issues.extend(overflows(doc).iter().map(|i| i.to_json()));
    if !issues.iter().any(|i| i["severity"] == "error") {
        let (op_issues, drawing) = hub.probe(doc, 0, true, readings);
        for i in op_issues.iter().filter(|i| i.code != "undeclared_read") {
            let mut issue = op_issue(i);
            issue.fix = fix_of(hub, &i.module, i.code);
            issues.push(issue.to_json());
        }
        if let Some(drawing) = drawing.filter(|_| op_issues.is_empty()) {
            if let Err(Unfit { code, path }) = hub
                .renderer
                .prepare_drawing(&drawing, &hub.scenario.evidence)
            {
                issues.push(unfit_issue(code, path).to_json());
            }
        }
    }
    issues
}

/// The codes a list of issues holds, sorted, once each.
pub fn codes(issues: &[Value]) -> Vec<String> {
    let set: BTreeSet<String> = issues
        .iter()
        .filter_map(|i| i["code"].as_str().map(str::to_string))
        .collect();
    set.into_iter().collect()
}

/// What a fixture raises: a document's issues, or a scene's last reply's.
pub fn fixture_issues(hub: &mut Hub<'_>, f: &Entry) -> Vec<Value> {
    if f.is_scene() {
        let replies = super::repair::play_scene(hub, &f.document);
        return replies
            .last()
            .and_then(|r| r["issues"].as_array().cloned())
            .unwrap_or_default();
    }
    let doc = stamped(&f.document);
    let readings = f
        .record
        .as_ref()
        .map(|r| super::instance::readings(Some(r)));
    raised_with(hub, &doc, readings.as_ref())
}

/// Compares the codes raised with those named: the case passes only on exactly them; under the
/// planted kit that checks only for the expected codes, any superset passes.
pub fn exact(
    hub: &Hub<'_>,
    case: &mut Case,
    module: &str,
    part: &str,
    fixture: &str,
    want: &[String],
    got: &[String],
) -> Option<Value> {
    case.set("expected_codes", json!(want));
    case.set("raised_codes", json!(got));
    let extra: Vec<&String> = got.iter().filter(|c| !want.contains(c)).collect();
    let missing: Vec<&String> = want.iter().filter(|c| !got.contains(c)).collect();
    let only_expected = hub.planted(Planted::ChecksExpectedCodeOnly);
    if missing.is_empty() && (extra.is_empty() || only_expected) {
        return None;
    }
    let f = failure(
        "unexpected_codes",
        module,
        part,
        json!({"case": case.name(), "fixture": fixture, "extra": extra, "missing": missing}),
    );
    case.fail(Verdict::Fail, f.clone());
    Some(f)
}

/// The catalog part: every code the module's fixtures raise is listed; each of its codes'
/// planted fixtures raises exactly what it names, with the catalog's fix; each ops fix is
/// applied on every fixture of the module that raises its code.
pub fn run(hub: &mut Hub<'_>, ctx: &mut Ctx<'_>) -> Option<PartRun> {
    let module = ctx.module;
    let fixtures: Vec<Entry> = ctx
        .manifest
        .of_module(module)
        .into_iter()
        .cloned()
        .collect();
    let rows = rows(hub, &ctx.manifest.fixtures);
    let own: Vec<&Row> = rows.iter().filter(|r| r.module == module).collect();
    let listed: BTreeSet<&str> = rows.iter().map(|r| r.code.as_str()).collect();
    let mut cases = Vec::new();
    let mut failures = Vec::new();
    let mut raised_by: Vec<(Entry, Vec<Value>)> = Vec::new();
    for f in &fixtures {
        if f.name.ends_with("agent-decision.scene") || is_part_scene(f) {
            continue;
        }
        let issues = fixture_issues(hub, f);
        raised_by.push((f.clone(), issues));
    }
    // Every code each fixture raised is in the catalog.
    let mut seen = BTreeSet::new();
    for (f, issues) in &raised_by {
        let mut case =
            Case::new(format!("listed:{}", f.name), Verdict::Pass).with("fixture", json!(f.name));
        for c in codes(issues) {
            if !listed.contains(c.as_str()) {
                let fl = failure("uncatalogued", module, "catalog", json!({"issue_code": c}));
                case.fail(Verdict::Fail, fl.clone());
                if seen.insert(c.clone()) {
                    failures.push(fl);
                }
            }
        }
        cases.push(case);
    }
    // Each of the module's codes: its planted fixture raises exactly what it names.
    for row in &own {
        let mut case = Case::new(format!("code:{}", row.code), Verdict::Pass)
            .with("code", json!(row.code))
            .with("fixture", json!(row.fixture));
        let Some((f, issues)) = raised_by.iter().find(|(f, _)| f.name == row.fixture) else {
            let fl = failure(
                "unproved",
                module,
                "catalog",
                json!({"case": case.name(), "probe": "planted_fixture", "issue_code": row.code}),
            );
            case.fail(Verdict::Fail, fl.clone());
            failures.push(fl);
            cases.push(case);
            continue;
        };
        let want = f.codes().unwrap_or_default();
        let got = codes(issues);
        if let Some(fl) = exact(hub, &mut case, module, "catalog", &f.name, &want, &got) {
            failures.push(fl);
        }
        match issues.iter().find(|i| i["code"] == row.code.as_str()) {
            // A notice carries no fix of its own: its fix is the catalog's.
            Some(issue) => case.set(
                "issue",
                json!({"code": row.code, "what": issue["what"],
                       "fix": issue.get("fix").cloned().unwrap_or(json!(row.fix))}),
            ),
            None => case.set(
                "issue",
                json!({"code": row.code, "what": "", "fix": row.fix}),
            ),
        }
        cases.push(case);
    }
    // Each ops fix, applied on each fixture of the module that raises its code.
    for row in own.iter().filter(|r| r.fix_ops) {
        let mut applied = false;
        for (f, issues) in &raised_by {
            let Some(issue) = issues
                .iter()
                .find(|i| i["code"] == row.code.as_str() && i.get("fix_ops").is_some())
            else {
                continue;
            };
            applied = true;
            let mut case = Case::new(format!("fix:{}:{}", row.code, f.name), Verdict::Pass)
                .with("fix_of", json!(row.code))
                .with("fixture", json!(f.name));
            let doc = stamped(&f.document);
            let ops = issue["fix_ops"].clone();
            let writer = layer_writer(&doc, issue);
            let patch = json!({"patch": "01JB138F000000000000000001", "doc": doc["id"], "base": 0,
                               "reason": "the catalog's fix", "ops": ops});
            // The ops applied as the item's writer, in this build, then the second check.
            let mut fixed = doc.clone();
            let second = match apply_as(hub, &mut fixed, &writer, &patch) {
                Ok(()) => codes(&raised(hub, &fixed)),
                Err(issue) => codes(&[issue]),
            };
            let others: Vec<String> = f
                .codes()
                .unwrap_or_default()
                .into_iter()
                .filter(|c| *c != row.code)
                .collect();
            case.set("second_check", json!(second));
            let added: Vec<&String> = second.iter().filter(|c| !others.contains(c)).collect();
            let missing: Vec<&String> = others.iter().filter(|c| !second.contains(c)).collect();
            if !added.is_empty() || !missing.is_empty() {
                let fl = failure(
                    "ops_fix",
                    module,
                    "catalog",
                    json!({"issue_code": row.code, "fixture": f.name, "added": added, "missing": missing}),
                );
                case.fail(Verdict::Fail, fl.clone());
                failures.push(fl);
            }
            cases.push(case);
        }
        if !applied {
            let mut case = Case::new(format!("fix:{}", row.code), Verdict::Pass)
                .with("fix_of", json!(row.code));
            let fl = failure(
                "unproved_fix",
                module,
                "catalog",
                json!({"issue_code": row.code}),
            );
            case.fail(Verdict::Fail, fl.clone());
            failures.push(fl);
            cases.push(case);
        }
    }
    if cases.is_empty() && own.is_empty() && raised_by.is_empty() {
        return None;
    }
    let mut run = PartRun::new(cases.len() as u64);
    run.cases = cases;
    run.failures = failures;
    Some(run)
}

/// A patch's ops applied to `doc` in place as `writer`, in this build, before any check.
fn apply_as(hub: &Hub<'_>, doc: &mut Value, writer: &str, patch: &Value) -> Result<(), Value> {
    let layer = writer_layer(doc, writer).map_err(|i| i.to_json())?;
    let kinds = hub.startup.sealed.kinds();
    let knows = |kind: &str| {
        deep_canvas_marks::scene::KINDS.contains(&kind)
            || !matches!(lookup(&kinds, kind), Lookup::UnknownKind)
    };
    let writing = Writing {
        layer: &layer,
        writer,
        you: writer.starts_with("you:"),
        base: None,
        knows: &knows,
        packs: None,
    };
    let id = doc["id"].as_str().unwrap_or_default().to_string();
    apply_ops(doc, patch, "patch", &id, &writing)
        .map(|_| ())
        .map_err(|i| i.to_json())
}

/// The writer whose layer holds the item an issue names: its fix is that writer's to apply.
fn layer_writer(doc: &Value, issue: &Value) -> String {
    let id = issue["ids"]
        .as_array()
        .and_then(|l| l.first())
        .and_then(Value::as_str)
        .unwrap_or("");
    let layer = doc["items"][id]["layer"].as_str().unwrap_or("");
    doc["layers"][layer]["writer"]
        .as_str()
        .unwrap_or("you:you")
        .to_string()
}

/// The kit's scenes its own parts run, which the fixtures and catalog parts leave to them.
pub fn is_part_scene(f: &Entry) -> bool {
    f.is_scene()
        && ["clean-rebuild-fuzz", "patch-fuzz", "repair-loop"]
            .iter()
            .any(|n| f.name.ends_with(&format!("/{n}.scene")))
}
