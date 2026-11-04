//! The effects canvas module (technical design: Canvas modules, the module table's effects row),
//! registered through the registry and seal (#305): its manifest and the passes its shipped
//! operators add to the frame, glow into the bloom place and the rest into the effects chain.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Raised, Range, Registrar, Semver};
use serde_json::{json, Value};

use crate::check;
use crate::graph::{self, Class, Kind, Origin};

pub const GRID: &str = "effects.grid";
pub const SHADOW: &str = "effects.shadow";
pub const SPARKS: &str = "effects.particles";
pub const OUTLINE: &str = "effects.outline";
pub const GLOW: &str = "effects.glow";

/// The passes the shipped operators run as, each timed in the frame under its name, and the place
/// each goes into, in frame order: glow's whole chain is one pass in the bloom place.
pub const PASSES: &[(&str, &str)] = &[
    (GRID, "effects"),
    (SHADOW, "effects"),
    (SPARKS, "effects"),
    (OUTLINE, "effects"),
    (GLOW, "bloom"),
];

fn manifest() -> Manifest {
    Manifest {
        name: "effects".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "scene3d".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "effects".into(),
        license: "Apache-2.0".into(),
        implements: "effects@1".into(),
        implementation: deep_canvas::registry::Implementation::reference("effects", deep_canvas::registry::Semver::parse("1.0.0").expect("a version")),
    }
}

/// The effects module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

/// The three operator kinds as items of their writer's layer (GPU operator): `gpu.material@1`,
/// `gpu.pass@1` and `gpu.compute@1`, the operator's fields in `params`.
pub const OPERATOR_KINDS: [(&str, &str); 3] = [
    ("material", "gpu.material@1"),
    ("pass", "gpu.pass@1"),
    ("compute", "gpu.compute@1"),
];

/// An operator item's fields (GPU operator: Fields), every one structured, which the operator
/// check reads.
const OPERATOR_FIELDS: &[&str] = &[
    "about",
    "inputs",
    "steps",
    "source",
    "outputs",
    "determinism",
    "cost",
    "resolution",
    "fallback",
    "uses",
    "origin",
    "chain",
    "order",
    "applies_to",
    "elements",
    "workgroup",
    "after",
];

fn operator_entry(name: &'static str) -> Entry {
    Entry {
        family: "gpu",
        name,
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: OPERATOR_FIELDS
                .iter()
                .map(|f| Param {
                    name: f,
                    ty: ParamType::Json,
                    unit: "",
                    default: Value::Null,
                    min: None,
                    max: None,
                    minor: 0,
                    module: "",
                    operator: "",
                })
                .collect(),
        }],
        migrations: Vec::new(),
    }
}

/// An operator item as the operator check reads it: its ID, its kind and its params' fields.
pub fn operator_of(id: &str, item: &Value) -> Option<Value> {
    let kind = OPERATOR_KINDS
        .iter()
        .find(|(_, k)| item["kind"].as_str() == Some(*k))?
        .0;
    let mut op = item["params"].as_object().cloned().unwrap_or_default();
    op.retain(|_, v| !v.is_null());
    op.insert("id".into(), json!(id));
    op.insert("kind".into(), json!(kind));
    Some(Value::Object(op))
}

fn raised(code: &'static str, path: String, what: String) -> Raised {
    Raised {
        code,
        severity: "error",
        path,
        what,
        fix_ops: None,
    }
}

/// The document's check over an operator item: the whole operator check (nothing runs before it
/// passes), its budget class's operator kinds (Operator budgets by class: a core view runs
/// shipped operators only, a data view passes and compute), and every check input whose probe
/// reads it: a check whose result holds on any machine reads only an exact operator.
fn operator_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let Some(op) = operator_of(id, item) else {
        return Vec::new();
    };
    let at = |p: &str| format!("items/{id}/params/{p}");
    let checked = match graph::read(&op).and_then(|o| check::check(&o)) {
        Ok(c) => c,
        Err(issues) => {
            return issues
                .into_iter()
                .map(|i| {
                    let path = match (&i.step, &i.path) {
                        (Some(s), _) => at(&format!("steps/{s}")),
                        (None, Some(p)) => at(p),
                        (None, None) => format!("items/{id}"),
                    };
                    raised(i.code, path, i.message)
                })
                .collect();
        }
    };
    let mut out = Vec::new();
    let class = doc["budget"]["class"].as_str().unwrap_or("figure");
    let allowed: &[Kind] = match class {
        "core_view" => &[],
        "data_view" => &[Kind::Pass, Kind::Compute],
        _ => &[Kind::Material, Kind::Pass, Kind::Compute],
    };
    if checked.op.origin != Origin::Shipped && !allowed.contains(&checked.op.kind) {
        out.push(raised(
            "operator_budget_class",
            format!("items/{id}"),
            format!(
                "{id}: a composed {} operator can't run in a {class}, which runs {}",
                checked.op.kind.name(),
                if allowed.is_empty() {
                    "shipped operators only".to_string()
                } else {
                    "pass and compute operators".to_string()
                }
            ),
        ));
    }
    let probe = format!("items/{id}/outputs/");
    for (cid, c) in doc["checks"].as_object().into_iter().flatten() {
        let reads = c["probe"].as_str().is_some_and(|p| p.starts_with(&probe));
        if reads && c["machines"] == "any" && checked.class != Class::Exact {
            out.push(raised(
                "not_exact",
                format!("checks/{cid}/probe"),
                format!(
                    "check {cid} holds on any machine but reads {id}, which is {}: only an exact operator read back may feed it",
                    checked.class.name()
                ),
            ));
        }
    }
    out
}

fn register(r: &mut Registrar) {
    for (name, place) in PASSES {
        r.pass(name, place);
    }
    for (name, kind) in OPERATOR_KINDS {
        r.kind(operator_entry(name), &[], "")
            .described("A GPU operator as data: typed inputs, steps from the closed list, typed outputs, checked, costed and classed before it runs.");
        r.rule(&kind[..kind.len() - 2], operator_rule);
    }
    for (code, meaning) in [
        ("not_exact", "An operator declared exact computes as less, or a check that holds on any machine reads an operator that isn't exact."),
        ("operator_budget_class", "The document's budget class doesn't run this operator's kind."),
        ("live_only_canonical", "A live-only material with no fallback would draw nothing in canonical renders."),
        ("operator_kind_rule", "A step the operator's kind can't hold, or a compute write at another element's index."),
        ("operator_status_color", "A step reads a status role."),
        ("cost_understated", "The operator's estimated cost is more than 25% over its declaration."),
        ("operator_cycle", "The operator's steps don't form a DAG."),
        ("operator_limit", "The operator passes a limit of its class: steps, trips, fetches, textures or elements."),
        ("operator_source", "The operator carries shader text or code."),
        ("operator_type", "A step's or field's type doesn't fit."),
        ("operator_unbounded", "A loop whose count isn't fixed at check."),
        ("operator_unknown_op", "A step names an op the op table lacks."),
    ] {
        r.code(code, meaning, "Change the operator or the check as the message says.", false);
    }
    // Headless, the kit proves the scene the effects draw on reaches the check with no issue;
    // its pixels need the GPU, and the acceptance suite draws them there.
    r.fixture("shadowed-box", shadowed_box(), None)
        .sidecar(json!({"codes": [], "covers": {"kinds": ["light.sun@1"], "fields": ["light.sun@1/params/shadow"]}}));
}

/// The module's fixture: a box on a floor under a sun that casts its shadow.
fn shadowed_box() -> Value {
    json!({
        "format": 1, "profile": "figure", "title": "A box and its shadow",
        "description": "A box on a floor slab, lit by a sun that casts the box's shadow on the floor.",
        "size": [480, 360], "camera": "cam", "requires": {"modules": {"scene3d": "^1", "effects": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "perspective", "position": [3, 3.2, 5.5], "target": [0, 0.4, 0], "fov": 40, "near": 0.1}},
            "floor": {"id": "floor", "kind": "mark.box@1", "name": "Floor", "order": "a1",
                      "params": {"size": [12, 0.1, 12], "paint": {"fill": {"role": "muted"}}}, "at": {"pos": [0, -0.05, 0]}},
            "block": {"id": "block", "kind": "mark.box@1", "name": "Block", "order": "a2",
                      "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0.5, 0]}},
            "sun": {"id": "sun", "kind": "light.sun@1", "name": "Sun", "order": "a3",
                    "params": {"illuminance": deep_canvas::ops::PI, "shadow": true}, "at": {"rot": [-55, -40, 0]}}
        }
    })
}
