//! The parity suite's manifest (issue #138; technical design: the parity suite): one category
//! list, one naming scheme (`parity/<category>/<name>.<profile>`), and every fixture as a
//! document with a sidecar of existing check kinds and named oracles from the runner's closed
//! list. A sidecar is data only: no formula, no code.

use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// The one category list: the kernel, the framework and whole scenes, then one per canvas module
/// the design names that a fixture may hold.
pub const CATEGORIES: [&str; 21] = [
    "kernel",
    "framework",
    "scene",
    "text",
    "look",
    "marks2d",
    "motion",
    "data",
    "graph",
    "record",
    "sheet",
    "vector",
    "cells",
    "scene3d",
    "effects",
    "input",
    "physics",
    "logic",
    "net",
    "media",
    "export",
];

/// The runner's closed list of named oracles: reviewed test code.
pub const ORACLES: [&str; 9] = [
    "analytic",
    "cpu_reference",
    "golden",
    "reftest",
    "seek_play",
    "upstream",
    "second_implementation",
    "migration_corpus",
    "decision_log",
];

/// The core's own check kinds (canvas primitives: Check input).
pub const CORE_CHECK_KINDS: [&str; 11] = [
    "document.validate",
    "document.budget",
    "document.frame_time",
    "document.layout",
    "document.determinism",
    "geometry.audit",
    "film.audit",
    "film.flicker",
    "film.layout",
    "honest_numbers",
    "kind_rules",
];

/// A sidecar's keys, and a sidecar check's.
pub const SIDECAR_KEYS: [&str; 9] = [
    "checks",
    "oracles",
    "covers",
    "codes",
    "twin",
    "expected_from",
    "criteria",
    "inputs",
    "at_times",
];
pub const CHECK_KEYS: [&str; 9] = [
    "kind",
    "probe",
    "at_times",
    "expect",
    "tolerance",
    "except",
    "render",
    "sweeps",
    "declared_cuts",
];
/// Where a fixture's expected value came from, when not from the implementation itself.
pub const EXPECTED_FROM: [&str; 4] = ["analytic", "upstream", "issue", "second_implementation"];
/// Prose a reader writes for people; the formula scan skips it.
const PROSE: [&str; 5] = ["reason", "what", "description", "title", "name"];

/// One fixture of the parity suite.
#[derive(Clone, Debug)]
pub struct Entry {
    pub name: String,
    pub module: String,
    pub category: String,
    pub profile: String,
    pub document: Value,
    pub record: Option<Value>,
    pub sidecar: Value,
}

impl Entry {
    pub fn is_scene(&self) -> bool {
        self.profile == "scene"
    }

    /// The sidecar's checks.
    pub fn checks(&self) -> Vec<&Map<String, Value>> {
        self.sidecar
            .get("checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_object)
            .collect()
    }

    /// The exact codes it names, when it names them.
    pub fn codes(&self) -> Option<Vec<String>> {
        let list = self.sidecar.get("codes")?.as_array()?;
        Some(
            list.iter()
                .filter_map(|c| c.as_str().map(str::to_string))
                .collect(),
        )
    }

    pub fn oracles(&self) -> Vec<String> {
        strings(self.sidecar.get("oracles"))
    }

    fn to_json(&self) -> Value {
        json!({
            "name": self.name, "module": self.module, "category": self.category,
            "profile": self.profile, "document": self.document, "sidecar": self.sidecar,
        })
    }
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|s| s.as_str().map(str::to_string))
        .collect()
}

/// The manifest: the categories, oracles and check kinds, every kind the build registers, and
/// every fixture.
#[derive(Clone, Debug)]
pub struct Manifest {
    pub check_kinds: Vec<String>,
    pub kinds: Vec<String>,
    pub fixtures: Vec<Entry>,
}

impl Manifest {
    pub fn of(hub: &Hub<'_>) -> Manifest {
        let sealed = &hub.startup.sealed;
        let mut check_kinds: Vec<String> = CORE_CHECK_KINDS.iter().map(|s| s.to_string()).collect();
        for m in &sealed.modules {
            for c in &m.shapes.checks {
                if !check_kinds.contains(&c.kind) {
                    check_kinds.push(c.kind.clone());
                }
            }
        }
        let kinds = Manifest::kinds_of(sealed);
        let mut fixtures = Vec::new();
        for (module, f) in &sealed.fixtures {
            let module = if module.is_empty() {
                "core"
            } else {
                module.as_str()
            };
            let profile = f
                .document
                .get("profile")
                .and_then(Value::as_str)
                .unwrap_or("board")
                .to_string();
            let category = if !f.category.is_empty() {
                f.category.clone()
            } else if module == "core" {
                "kernel".into()
            } else {
                module.to_string()
            };
            fixtures.push(Entry {
                name: format!("parity/{category}/{}.{profile}", f.name),
                module: module.to_string(),
                category,
                profile,
                document: f.document.clone(),
                record: f.record.clone(),
                sidecar: if f.sidecar.is_null() {
                    json!({})
                } else {
                    f.sidecar.clone()
                },
            });
        }
        // The kit's scenes and the catalog's planted fixtures after each module's own.
        fixtures.extend(scenes());
        fixtures.extend(super::catalog::core_fixtures());
        Manifest {
            check_kinds,
            kinds,
            fixtures,
        }
    }

    /// Every item kind the build draws: R1's, the core's registered ones (its own test kinds of
    /// #372 and #389 aside) and every canvas module's, each at its current major.
    pub fn kinds_of(sealed: &deep_canvas::registry::Sealed) -> Vec<String> {
        // R1's drawn kinds, which marks2d draws without a registry entry, first.
        let mut kinds: Vec<String> = deep_canvas_marks::scene::KINDS
            .iter()
            .map(|k| k.to_string())
            .collect();
        for e in sealed.kinds().entries() {
            if e.full_name().starts_with("test.") && sealed.module_of_kind(&e.full_name()).is_none()
            {
                continue;
            }
            kinds.push(format!("{}@{}", e.full_name(), e.current().major));
        }
        kinds
    }

    pub fn of_module<'m>(&'m self, module: &str) -> Vec<&'m Entry> {
        self.fixtures
            .iter()
            .filter(|f| f.module == module)
            .collect()
    }

    pub fn find(&self, name: &str) -> Option<&Entry> {
        self.fixtures.iter().find(|f| f.name == name)
    }

    /// The `manifest` reply.
    pub fn to_json(&self) -> Value {
        json!({
            "categories": CATEGORIES,
            "oracles": ORACLES,
            "check_kinds": self.check_kinds,
            "kinds": self.kinds,
            "fixtures": self.fixtures.iter().map(Entry::to_json).collect::<Vec<_>>(),
        })
    }
}

/// The kit's own scenes: the issue's three, each run by its part over the core's fixtures and
/// every module's, and the one that tries an agent's decisions.
fn scenes() -> Vec<Entry> {
    let scene = |category: &str, name: &str, about: &str, check: &str, oracle: &str| Entry {
        name: format!("parity/{category}/{name}.scene"),
        module: "core".into(),
        category: category.into(),
        profile: "scene".into(),
        document: json!({"about": about}),
        record: None,
        sidecar: json!({"checks": [{"kind": check}], "oracles": [oracle], "codes": []}),
    };
    vec![
        scene(
            "kernel",
            "clean-rebuild-fuzz",
            "Seeded fuzzed patch sequences over each module's fixtures, each ending equal to a clean rebuild of the same revision in every array, cache, key and snapshot: the clean_rebuild part.",
            "document.determinism",
            "reftest",
        ),
        scene(
            "kernel",
            "patch-fuzz",
            "Random valid and invalid patches over every kind and op, replayable from the seed, holding Patch's five laws: the patch_fuzz part.",
            "document.validate",
            "analytic",
        ),
        scene(
            "framework",
            "repair-loop",
            "A planted fault carrying its path, code and fix; a fix that applies, a stale fix that rebases, conflicting fixes refused naming both writers, and a fix that fails its dry run: the repair_loop part.",
            "document.validate",
            "analytic",
        ),
        scene(
            "framework",
            "agent-decision",
            "An agent tries to bless a golden, loosen a tolerance and waive a fixture; each must be refused as not its decision.",
            "kind_rules",
            "decision_log",
        ),
    ]
}

/// What's wrong with a fixture's sidecar, as failures: an unknown key, a check of a kind no
/// registry holds, an oracle off the list, a formula or code in a string, and a tolerance class
/// with a share of pixels missing its ceiling, its window or its reason.
pub fn sidecar_faults(f: &Entry, manifest: &Manifest) -> Vec<Value> {
    let mut out = Vec::new();
    let Some(sidecar) = f.sidecar.as_object() else {
        out.push(json!({"code": "formula", "fixture": f.name, "path": ""}));
        return out;
    };
    for k in sidecar.keys() {
        if !SIDECAR_KEYS.contains(&k.as_str()) {
            out.push(json!({"code": "formula", "fixture": f.name, "path": format!("/{k}")}));
        }
    }
    for (i, check) in f.checks().into_iter().enumerate() {
        for k in check.keys() {
            if !CHECK_KEYS.contains(&k.as_str()) {
                out.push(json!({"code": "formula", "fixture": f.name, "path": format!("/checks/{i}/{k}")}));
            }
        }
        let kind = check.get("kind").and_then(Value::as_str).unwrap_or("");
        if !manifest.check_kinds.iter().any(|k| k == kind) {
            out.push(json!({"code": "check_kind", "fixture": f.name, "kind": kind}));
        }
        if let Some(t) = check.get("tolerance").and_then(Value::as_object) {
            let share = t
                .get("on")
                .and_then(Value::as_f64)
                .is_some_and(|on| on < 100.0);
            if share {
                let mut missing = Vec::new();
                if t.get("ceiling").and_then(Value::as_f64).is_none() {
                    missing.push("ceiling");
                }
                let window = t.get("window").and_then(Value::as_object);
                if window.is_none_or(|w| {
                    w.get("size")
                        .and_then(Value::as_f64)
                        .is_none_or(|s| s <= 0.0)
                        || w.get("off").and_then(Value::as_f64).is_none()
                }) {
                    missing.push("window");
                }
                if t.get("reason")
                    .and_then(Value::as_str)
                    .is_none_or(|r| r.trim().is_empty())
                {
                    missing.push("reason");
                }
                if !missing.is_empty() {
                    out.push(json!({"code": "tolerance", "fixture": f.name, "missing": missing}));
                }
            }
        }
    }
    for o in f.oracles() {
        if !ORACLES.contains(&o.as_str()) {
            out.push(json!({"code": "oracle", "fixture": f.name, "oracle": o}));
        }
    }
    if let Some(e) = sidecar.get("expected_from") {
        if !e.as_str().is_some_and(|e| EXPECTED_FROM.contains(&e)) {
            out.push(json!({"code": "formula", "fixture": f.name, "path": "/expected_from"}));
        }
    }
    let mut strings = Vec::new();
    strings_in(&f.sidecar, String::new(), &mut strings);
    for (path, text) in strings {
        if looks_like_code(&text) {
            out.push(json!({"code": "formula", "fixture": f.name, "path": path}));
        }
    }
    out
}

/// Every string a sidecar holds outside prose, with its path.
fn strings_in(v: &Value, path: String, out: &mut Vec<(String, String)>) {
    match v {
        Value::String(s) => out.push((path, s.clone())),
        Value::Array(list) => {
            for (i, x) in list.iter().enumerate() {
                strings_in(x, format!("{path}/{i}"), out);
            }
        }
        Value::Object(map) => {
            for (k, x) in map {
                if !PROSE.contains(&k.as_str()) {
                    strings_in(x, format!("{path}/{k}"), out);
                }
            }
        }
        _ => {}
    }
}

/// Whether a string reads as a formula or code: an operator, a call, a block, an assignment or a
/// keyword.
fn looks_like_code(text: &str) -> bool {
    const MARKS: [char; 9] = ['(', ')', '{', '}', ';', '=', '^', '*', '+'];
    text.contains(MARKS)
        || text
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
            .any(|w| ["fn", "function", "return", "let", "const", "var", "lambda"].contains(&w))
}

impl<'a> Hub<'a> {
    /// `{"call": "manifest"}`.
    pub fn manifest_reply(&self) -> Value {
        Manifest::of(self).to_json()
    }
}
