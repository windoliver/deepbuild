//! The effects canvas module (technical design: Canvas modules, the module table's effects row),
//! registered through the registry and seal (#305): its manifest and the passes its shipped
//! operators add to the frame, glow into the bloom place and the rest into the effects chain.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Raised, Range, Registrar, Semver};
use serde_json::{json, Map, Value};

use crate::check;
use crate::fx::Named;
use crate::graph::{self, Class, Kind, Origin};

pub const GRID: &str = "effects.grid";
pub const SHADOW: &str = "effects.shadow";
pub const SPARKS: &str = "effects.particles";
/// #462: a look's strokes on surfaces, drawn before the particles.
pub const STROKES: &str = "effects.strokes";
pub const OUTLINE: &str = "effects.outline";
pub const GLOW: &str = "effects.glow";

/// The passes the shipped operators run as, each timed in the frame under its name, and the place
/// each goes into, in frame order: glow's whole chain is one pass in the bloom place.
pub const PASSES: &[(&str, &str)] = &[
    (GRID, "effects"),
    (SHADOW, "effects"),
    (STROKES, "effects"),
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
                // Its operators reach scene3d's GPU registry entries through the core's
                // registries, so a build without scene3d holds effects (#485).
                optional: true,
            },
        )]
        .into_iter()
        .collect(),
        feature: "effects".into(),
        license: "Apache-2.0".into(),
        implements: "effects@1".into(),
        implementation: deep_canvas::registry::Implementation::reference(
            "effects",
            deep_canvas::registry::Semver::parse("1.0.0").expect("a version"),
        ),
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
    // Whether a pixel-wise pass may fuse with its neighbours (#432: pass fusion).
    "fuse",
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

/// #449's rule over a particles@1 item: its count against its class's cap (Particles
/// `particles@1`: `count`), refused at check, naming the item, its count and the cap.
fn particles_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    crate::particles::rule::count(doc, id, item, None)
        .map(|r| raised(r.code, r.path, r.what))
        .into_iter()
        .collect()
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
    out.extend(binding_rules(doc, id, &checked.op));
    // #483: what an operator's outputs hold counts in the class's operator storage (Operator
    // budgets by class), its own and the document's together, the largest named.
    let cap_mb: u64 = match class {
        "core_view" => 8,
        "figure" => 32,
        "data_view" | "work_product" => 64,
        _ => 128,
    };
    let held = |o: &graph::Operator| -> u64 {
        o.storage
            .values()
            .map(|s| u64::from(s.count) * 4)
            .sum::<u64>()
            + o.textures.values().map(graph::TexOut::bytes).sum::<u64>()
    };
    let own = held(&checked.op);
    let all: Vec<(String, u64)> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| {
            let o = graph::read(&operator_of(k, v)?).ok()?;
            Some((k.clone(), held(&o)))
        })
        .collect();
    let total: u64 = all.iter().map(|(_, b)| b).sum();
    let largest = all
        .iter()
        .max_by_key(|(k, b)| (*b, std::cmp::Reverse(k.clone())))
        .map(|(k, _)| k.as_str());
    if own > cap_mb << 20 || (total > cap_mb << 20 && largest == Some(id)) {
        out.push(raised(
            "over_budget",
            format!("items/{id}/params/outputs"),
            format!(
                "{id}: its outputs hold {:.1} MB ({:.1} MB with the document's other operators), past the {class} class's {cap_mb} MB of operator storage",
                own as f64 / f64::from(1u32 << 20),
                total as f64 / f64::from(1u32 << 20)
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

/// #431: `backdrop` reads the opaque scene's copy, which only a see-through part's material
/// (alpha_mode blend or transmission above 0) has, and `shadow_filter` runs only in a see-through
/// part's shadow passes under `shadow: colored`; #486: a lobe output only on a material that has
/// its lobe. Each material that names the operator elsewhere is refused, naming the step or the
/// output and the material.
fn binding_rules(doc: &Value, id: &str, op: &graph::Operator) -> Vec<Raised> {
    let mut out = Vec::new();
    if op.kind != Kind::Material {
        return out;
    }
    let at = |p: &str| format!("items/{id}/params/{p}");
    let reads = backdrop_step(&op.steps);
    let filters = op.outputs.contains_key("shadow_filter");
    for (mid, m) in doc["items"].as_object().into_iter().flatten() {
        let p = &m["params"];
        if m["kind"] != "material@1" || p["op"].as_str() != Some(id) {
            continue;
        }
        let blend = p["alpha_mode"] == "blend";
        let see_through = blend || p["transmission"].as_f64().is_some_and(|t| t > 0.0);
        if let (Some(step), false) = (&reads, see_through) {
            out.push(raised(
                "operator_kind_rule",
                at(&format!("steps/{step}")),
                format!("{id}'s step {step} reads the backdrop, which only a see-through part's material has: {mid} is neither alpha_mode blend nor transmission above 0"),
            ));
        }
        if filters && !(see_through && p["shadow"] == "colored") {
            out.push(raised(
                "operator_kind_rule",
                at("outputs/shadow_filter"),
                format!("{id}'s output shadow_filter runs only in a see-through part's shadow passes under shadow: colored, and material {mid} isn't one"),
            ));
        }
        // #486: a lobe output replaces a lobe the material has; it never turns one on.
        for name in op.outputs.keys() {
            if let Some(field) = deep_canvas_scene3d::gpu::lacks(doc, mid, name) {
                let off = if field == "specular_color" {
                    "white"
                } else {
                    "0"
                };
                out.push(raised(
                    "operator_kind_rule",
                    at(&format!("outputs/{name}")),
                    format!("{id}'s output {name} replaces a lobe material {mid} lacks: its {field} is {off}, and no channel, driver, control or variant moves it"),
                ));
            }
        }
    }
    out
}

/// Every material binding a document's operators break (#431's backdrop and shadow_filter
/// rules), as issues: `{code, severity, path, step, what}`. A view that draws without the
/// document's whole check still refuses these.
pub fn binding_refusals(doc: &Value) -> Vec<Value> {
    let mut out = Vec::new();
    for (id, item) in doc["items"].as_object().into_iter().flatten() {
        let Some(o) = operator_of(id, item).and_then(|v| graph::read(&v).ok()) else {
            continue;
        };
        for r in binding_rules(doc, id, &o) {
            let mut i =
                json!({"code": r.code, "severity": r.severity, "path": r.path, "what": r.what});
            if let Some((_, step)) = r.path.split_once("/params/steps/") {
                i["step"] = json!(step);
            }
            out.push(i);
        }
    }
    out
}

/// Whether any operator of `doc` reads the core's target `output` (#431: velocity and emission
/// are built only while one does).
pub fn reads_core(doc: &Value, output: &str) -> bool {
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .any(|(_, item)| {
            OPERATOR_KINDS.iter().any(|(_, k)| item["kind"] == *k)
                && item["params"]["inputs"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, i)| {
                        let t = &i["from"]["texture"];
                        let t = t.get("target").unwrap_or(t);
                        t["op"] == "core" && t["output"] == output
                    })
        })
}

/// The first step, in any body, that reads the backdrop (#431).
pub fn backdrop_step(steps: &std::collections::BTreeMap<String, graph::Step>) -> Option<String> {
    steps.iter().find_map(|(id, s)| {
        if s.op == "backdrop@1" {
            return Some(id.clone());
        }
        s.body.as_ref().and_then(|b| backdrop_step(&b.steps))
    })
}

/// What a group's pass may read: its target, never another writer's layer or an earlier frame.
fn reads_only_its_target(graph: &Value) -> bool {
    graph["inputs"]
        .as_object()
        .into_iter()
        .flatten()
        .all(|(_, i)| {
            let Some(t) = i["from"].get("texture") else {
                return true;
            };
            t.get("target").is_some_and(|t| {
                (t["op"] == "core" && t["output"] == "color") || t["collection"].is_string()
            })
        })
}

/// A collection target a graph reads (Effect and GPU operator: collection targets).
#[derive(Clone, Debug, PartialEq)]
pub struct TargetRead {
    pub collection: String,
    pub output: String,
    pub half: bool,
    pub mips: bool,
}

/// The collection targets `graph` reads.
pub fn target_reads(graph: &Value) -> Vec<TargetRead> {
    graph["inputs"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, i)| {
            let t = i["from"].get("texture")?.get("target")?;
            Some(TargetRead {
                collection: t["collection"].as_str()?.to_string(),
                output: t["output"].as_str()?.to_string(),
                half: t["resolution"] == "half",
                mips: t["mips"] == true,
            })
        })
        .collect()
}

/// The first collection a pass of `doc` reads across writers: its members' layer isn't the pass's
/// (a collection stays inside one writer's layer). `Some((pass, collection))` names both.
pub fn foreign_read(doc: &Map<String, Value>) -> Option<(String, String)> {
    let items = doc.get("items")?.as_object()?;
    let layer_of = |item: &Value| item["layer"].as_str().map(str::to_string);
    for (id, item) in items {
        if !matches!(item["kind"].as_str(), Some("gpu.pass@1" | "gpu.compute@1")) {
            continue;
        }
        for read in target_reads(&item["params"]) {
            let members = doc
                .get("collections")
                .and_then(|c| c.get(&read.collection))
                .and_then(|c| c.get("members"))
                .and_then(Value::as_array);
            let foreign = members
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .any(|m| items.get(m).and_then(layer_of) != layer_of(item));
            if foreign {
                return Some((id.clone(), read.collection));
            }
        }
    }
    None
}

/// What a group's pass runs: its graphs in order, and the px it reaches when the pass sets no grow.
pub struct PassGraph {
    pub stages: Vec<Value>,
    pub grow: f64,
}

/// The graph a group's pass names (Frame and group: passes): an operator item of the document, a
/// named operator of `packs` or of fx@1, or the shipped blur; or the code that refuses it. No other
/// shipped pass qualifies, since each reads targets beside its group's.
pub fn pass_graph(
    op: &str,
    item: Option<&Value>,
    params: &Map<String, Value>,
    packs: &[Named],
) -> Result<PassGraph, &'static str> {
    if op == "blur@1" {
        let radius = params.get("radius").and_then(Value::as_f64).unwrap_or(8.0);
        let stages = vec![crate::shipped::blur("x"), crate::shipped::blur("y")];
        return Ok(PassGraph {
            stages,
            grow: radius.clamp(0.0, crate::shipped::MAX_BLUR),
        });
    }
    let (graph, grow) = if let Some(item) = item {
        match operator_of(op, item) {
            Some(g) if g["kind"] == "pass" => (g, 0.0),
            _ => return Err("operator_kind_rule"),
        }
    } else if let Some(n) = packs.iter().find(|n| n.name == op) {
        (n.graph.clone(), n.grow as f64)
    } else if let Some(n) = crate::fx::library().into_iter().find(|n| n.name == op) {
        (n.graph, n.grow as f64)
    } else if crate::shipped::all().iter().any(|g| g["id"] == op) {
        return Err("operator_kind_rule");
    } else {
        return Err("operator_unknown_op");
    };
    if reads_only_its_target(&graph) {
        Ok(PassGraph {
            stages: vec![graph],
            grow,
        })
    } else {
        Err("operator_kind_rule")
    }
}

/// Whether `item` is a kind only a 3D writer layer's scene draws.
fn in_depth(item: &Value) -> bool {
    let kind = item["kind"].as_str().unwrap_or("");
    kind.starts_with("mark.") || kind.starts_with("light.") || kind.starts_with("camera@")
}

/// A 3D item under the group `id`, if the group composites: its children draw into an isolated 2D
/// target, which scene3d's items can't, so it's refused rather than left out of the group.
pub fn depth_child<'a>(
    items: &'a Map<String, Value>,
    id: &str,
    group: &Value,
) -> Option<&'a String> {
    let p = &group["params"];
    let eleven = p["blend"].as_str().is_some_and(|b| {
        deep_canvas::blend::index(b).is_some_and(|i| i >= deep_canvas::blend::FIRST_GPU_ONLY)
    });
    let passes = p["passes"].as_array().is_some_and(|l| !l.is_empty());
    if group["kind"] != "group@1" || !(eleven || passes) {
        return None;
    }
    items.iter().find_map(|(child, item)| {
        let mut at = item["parent"].as_str();
        for _ in 0..items.len() {
            match at {
                Some(p) if p == id => return in_depth(item).then_some(child),
                Some(p) => at = items.get(p).and_then(|i| i["parent"].as_str()),
                None => break,
            }
        }
        None
    })
}

/// The document's check over a group's passes and backdrop (Frame and group: passes; backdrop): at
/// most 8 passes, each naming a pass the document can reach that reads only its group's target and
/// passes the operator check, in a class that runs them; no backdrop without passes, and no 3D item
/// under a group that composites. A pack the document names installs with the document, so its
/// passes meet the operator check when a call draws them.
fn group_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let params = &item["params"];
    let passes = params["passes"].as_array().map_or(&[][..], Vec::as_slice);
    let field = |f: &str| format!("items/{id}/params/{f}");
    let mut out = Vec::new();
    if passes.len() > 8 {
        out.push(raised(
            "operator_limit",
            field("passes"),
            format!("{id} holds {} passes, past 8", passes.len()),
        ));
    }
    if params["backdrop"] == "below" && passes.is_empty() {
        out.push(raised(
            "operator_kind_rule",
            field("backdrop"),
            format!("{id}: a backdrop runs its passes, and it has none"),
        ));
    }
    if let Some(child) = doc["items"]
        .as_object()
        .and_then(|items| depth_child(items, id, item))
    {
        out.push(raised(
            "operator_kind_rule",
            format!("items/{child}/parent"),
            format!("{child} draws in depth, so {id} can't composite it"),
        ));
    }
    let class = doc["budget"]["class"].as_str().unwrap_or("figure");
    if !passes.is_empty() && matches!(class, "core_view" | "data_view") {
        out.push(raised(
            "operator_budget_class",
            field("passes"),
            format!("{id}: a group's passes can't run in a {class}"),
        ));
    }
    let named = |pack: &str| {
        doc["packs"].as_array().into_iter().flatten().any(|n| {
            let name = n.as_str().and_then(|n| n.split('@').next());
            name.and_then(|n| n.rsplit('/').next()) == Some(pack)
        })
    };
    for (i, p) in passes.iter().enumerate() {
        let at = field(&format!("passes/{i}/op"));
        let Some(op) = p["op"].as_str() else {
            out.push(raised(
                "operator_type",
                at,
                format!("{id}: pass {i} names no op"),
            ));
            continue;
        };
        let pack = op.split_once('.').map(|(pack, _)| pack);
        if pack == Some("fx") && !named("fx") {
            out.push(raised(
                "operator_unknown_op",
                at,
                format!("{op}: the document names no fx@1 pack"),
            ));
            continue;
        }
        if pack.is_some_and(|p| p != "fx" && named(p)) {
            continue;
        }
        let own = p["params"].as_object().cloned().unwrap_or_default();
        match pass_graph(op, doc["items"].get(op), &own, &[]) {
            Ok(graph) => {
                for stage in &graph.stages {
                    if let Err(issues) = graph::read(stage).and_then(|o| check::check(&o)) {
                        out.extend(
                            issues
                                .into_iter()
                                .map(|e| raised(e.code, at.clone(), e.message)),
                        );
                    }
                }
            }
            Err(code) => out.push(raised(
                code,
                at,
                format!("{op} is no pass this group can run"),
            )),
        }
    }
    out
}

/// The pack check of a pack's `operators` (#1720; Pack: fx@1 named operators): each, as a graph with
/// its `grow` (fx@1) or as an entry around its graph (chrome-fx@1), passes the whole operator check
/// with the pack's step functions inlined.
fn pack_operators(manifest: &Value) -> Vec<(String, String)> {
    let Some(operators) = manifest["operators"].as_object() else {
        return vec![(
            String::new(),
            "operators names each operator's graph".into(),
        )];
    };
    let functions = crate::chrome_fx::functions(manifest);
    let text = |issues: Vec<graph::Issue>| {
        issues
            .iter()
            .map(|i| i.to_json().to_string())
            .collect::<Vec<_>>()
            .join("; ")
    };
    operators
        .iter()
        .filter_map(|(name, entry)| {
            let refused = if entry.get("graph").is_some() {
                crate::chrome_fx::read_entry(name, entry, &functions)
                    .err()
                    .map(|r| r["detail"].as_str().unwrap_or_default().to_string())
            } else {
                let mut op = entry.clone();
                if let Some(o) = op.as_object_mut() {
                    o.remove("grow");
                }
                graph::inline_functions(&op, &functions, true)
                    .and_then(|op| check::read_and_check(&op).map(|_| ()))
                    .err()
                    .map(text)
            };
            refused.map(|why| (name.clone(), why))
        })
        .collect()
}

/// A pack's `functions` (#1720): step functions, each with its ports and steps; the operator check
/// reads a body as each operator that uses it inlines it.
fn pack_functions(manifest: &Value) -> Vec<(String, String)> {
    let Some(functions) = manifest["functions"].as_object() else {
        return vec![(String::new(), "functions names each step function".into())];
    };
    functions
        .iter()
        .filter(|(_, f)| {
            !(f["ports"]["in"].is_object()
                && f["ports"]["out"].is_object()
                && f["steps"].is_object())
        })
        .map(|(name, _)| {
            (
                name.clone(),
                format!("{name} is a step function: ports in, ports out and steps"),
            )
        })
        .collect()
}

fn register(r: &mut Registrar) {
    for (name, place) in PASSES {
        r.pass(name, place);
    }
    r.pack_field("operators", pack_operators)
        .pack_field("functions", pack_functions);
    // #483: the structural steps, entries of the core's gpu.step@1, each with its exactness
    // fixture and planted twin.
    for (name, value) in crate::table::structural_entries() {
        r.entry("gpu.step@1", name, value, "R6");
    }
    for (name, kind) in OPERATOR_KINDS {
        r.kind(operator_entry(name), &[], "")
            .described("A GPU operator as data: typed inputs, steps from the closed list, typed outputs, checked, costed and classed before it runs.");
        r.rule(&kind[..kind.len() - 2], operator_rule);
    }
    r.rule("group", group_rule);
    // #449: a particles@1 item's count against its budget class's cap, wherever the check runs.
    r.rule("particles", particles_rule);
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
    // #429's planted documents, each raising the one code it names: a check that holds on any
    // machine reading a same-machine operator's readback, and a composed pass in a core view.
    r.fixture("same-machine-check", same_machine_check(), None)
        .sidecar(json!({"codes": ["not_exact"], "covers": {"kinds": ["gpu.compute@1"], "fields": ["gpu.compute@1/params/outputs"]}}));
    r.fixture("composed-in-core-view", composed_in_core_view(), None)
        .sidecar(json!({"codes": ["operator_budget_class"], "covers": {"kinds": ["gpu.pass@1"], "fields": ["gpu.pass@1/params/steps"]}}));
    r.fixture("live-only-material", live_only_material(), None)
        .sidecar(json!({"codes": ["live_only_canonical"], "covers": {"kinds": ["gpu.material@1"], "fields": ["gpu.material@1/params/fallback"]}}));
    r.fixture("scattered-write", scattered_write(), None)
        .sidecar(json!({"codes": ["operator_kind_rule"], "covers": {"kinds": ["gpu.compute@1"], "fields": ["gpu.compute@1/params/steps"]}}));
    // A tint with one step changed for each of the check's other codes.
    for (code, steps, cost) in planted_tints() {
        r.fixture(&format!("tint-{}", code.replace('_', "-")), tint_figure(steps, cost), None)
            .sidecar(json!({"codes": [code], "covers": {"kinds": ["gpu.pass@1"], "fields": ["gpu.pass@1/params/steps"]}}));
    }
    r.fixture("shadowed-box", shadowed_box(), None)
        .sidecar(json!({"codes": [], "covers": {"kinds": ["light.sun@1"], "fields": ["light.sun@1/params/shadow"]}}));
}

/// A figure of one box, its camera and `extra` items, in budget class `class`.
fn box_figure(title: &str, class: &str, extra: Value) -> Value {
    let mut items = json!({
        "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                "params": {"projection": "perspective", "position": [0, 2, 6], "target": [0, 0, 0], "fov": 40}},
        "block": {"id": "block", "kind": "mark.box@1", "name": "Block", "order": "a1",
                  "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "accent"}}}}
    });
    if let (Some(i), Some(e)) = (items.as_object_mut(), extra.as_object()) {
        i.extend(e.clone());
    }
    json!({
        "format": 1, "profile": "figure", "title": title,
        "description": "A #429 planted document of the effects module.",
        "size": [320, 180], "camera": "cam", "budget": {"class": class},
        "requires": {"modules": {"scene3d": "^1", "effects": "^1"}}, "items": items
    })
}

/// A check that holds on any machine reading back a compute operator with an f32 step.
fn same_machine_check() -> Value {
    let mut doc = box_figure(
        "A check on a same-machine readback",
        "figure",
        json!({
            "sum": {"id": "sum", "kind": "gpu.compute@1", "name": "Sum", "order": "b0", "params": {
                "about": "One word, squared as an f32, for a check to read back.", "origin": "composed", "inputs": {},
                "steps": {
                    "e": {"op": "element@1", "args": {}},
                    "x": {"op": "bitcast@1", "args": {"x": "e", "to": "f32"}},
                    "m": {"op": "mul@1", "args": {"a": "x", "b": "x"}},
                    "b": {"op": "bitcast@1", "args": {"x": "m", "to": "u32"}},
                    "w": {"op": "write@1", "args": {"buf": "total", "i": "e", "v": "b"}}
                },
                "outputs": {"total": {"readback": {"type": "u32", "count": 1, "bytes": 4}}},
                "elements": 1, "workgroup": 64, "cost": {"ns_per_element": 1000}
            }}
        }),
    );
    doc["checks"] = json!({"total_ok": {"kind": "honest_numbers", "probe": "items/sum/outputs/total", "expect": 0, "machines": "any"}});
    doc
}

/// A material declared live only with no fallback, which canonical renders couldn't draw.
fn live_only_material() -> Value {
    box_figure(
        "A live-only material with no fallback",
        "figure",
        json!({
            "glow": {"id": "glow", "kind": "gpu.material@1", "name": "Glow", "order": "b0", "params": {
                "about": "Emits red, live only, with no fallback.", "origin": "composed", "inputs": {},
                "steps": {"e": {"op": "const@1", "args": {"value": [1, 0, 0], "type": "vec3"}}},
                "outputs": {"emission": "e"}, "determinism": "live_only", "fallback": "none",
                "cost": {"ns_per_px": 50}
            }}
        }),
    )
}

/// A compute write at hash(i) % n, not the element's own index.
fn scattered_write() -> Value {
    box_figure(
        "A compute write at another element's index",
        "figure",
        json!({
            "scatter": {"id": "scatter", "kind": "gpu.compute@1", "name": "Scatter", "order": "b0", "params": {
                "about": "Writes 1 at hash(i) % 64.", "origin": "composed", "inputs": {},
                "steps": {
                    "e": {"op": "element@1", "args": {}},
                    "n": {"op": "const@1", "args": {"value": 64, "type": "u32"}},
                    "one": {"op": "const@1", "args": {"value": 1, "type": "u32"}},
                    "h": {"op": "hash@1", "args": {"a": "e"}},
                    "i": {"op": "rem@1", "args": {"a": "h", "b": "n"}},
                    "w": {"op": "write@1", "args": {"buf": "out", "i": "i", "v": "one"}}
                },
                "outputs": {"out": {"storage": {"type": "u32", "count": 64}}},
                "elements": 64, "workgroup": 64, "cost": {"ns_per_element": 1000}
            }}
        }),
    )
}

/// A figure with one composed pass of `steps` (its output the step `out`), declared at `cost` ns
/// a pixel.
fn tint_figure(steps: Value, cost: f64) -> Value {
    box_figure(
        "A composed pass the check refuses",
        "figure",
        json!({
            "tint": {"id": "tint", "kind": "gpu.pass@1", "name": "Tint", "order": "b0", "params": {
                "about": "A tint with one defect.", "origin": "composed",
                "inputs": {
                    "src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}},
                    "n": {"type": "u32", "from": {"param": "params/n"}}
                },
                "steps": steps, "outputs": {"color": "out"}, "chain": "effects", "order": "a0",
                "resolution": "full", "cost": {"ns_per_px": cost}, "fallback": "look"
            }}
        }),
    )
}

/// Each of the check's codes with a tint whose steps raise it alone, and its declared cost.
fn planted_tints() -> Vec<(&'static str, Value, f64)> {
    let base = |extra: Value| {
        let mut s = json!({
            "uv": {"op": "screen_uv@1", "args": {}},
            "c": {"op": "sample@1", "args": {"tex": "src", "uv": "uv", "lod": 0}},
            "red": {"op": "const@1", "args": {"value": [0.6, 0, 0, 0], "type": "vec4"}},
            "out": {"op": "add@1", "args": {"a": "c", "b": "red"}}
        });
        if let (Some(o), Some(e)) = (s.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        s
    };
    vec![
        (
            "operator_status_color",
            base(json!({
                "r": {"op": "role@1", "args": {"name": "fail"}},
                "out": {"op": "add@1", "args": {"a": "c", "b": "r"}}
            })),
            50.0,
        ),
        ("cost_understated", base(json!({})), 1e-6),
        (
            "operator_cycle",
            base(json!({
                "a": {"op": "add@1", "args": {"a": "b", "b": 1.0}},
                "b": {"op": "add@1", "args": {"a": "a", "b": 1.0}},
                "out": {"op": "add@1", "args": {"a": "c", "b": "a"}}
            })),
            50.0,
        ),
        (
            "operator_limit",
            base(json!({
                "w": {"op": "split@1", "args": {"x": "uv", "pick": "w"}},
                "out": {"op": "add@1", "args": {"a": "c", "b": "w"}}
            })),
            50.0,
        ),
        (
            "operator_source",
            base(json!({
                "out": {"op": "add@1", "args": {"a": "c", "b": "red"}, "wgsl": "return c + red;"}
            })),
            50.0,
        ),
        (
            "operator_type",
            base(json!({
                "yes": {"op": "const@1", "args": {"value": true}},
                "out": {"op": "add@1", "args": {"a": "c", "b": "yes"}}
            })),
            50.0,
        ),
        (
            "operator_unbounded",
            base(json!({
                "sum": {"op": "repeat@1", "args": {"count": "n", "accumulate": {"acc": [0, 0, 0, 0]},
                        "body": {"acc": {"op": "add@1", "args": {"a": "acc", "b": "c"}}}}},
                "out": {"op": "add@1", "args": {"a": "c", "b": "sum.acc"}}
            })),
            50.0,
        ),
        (
            "operator_unknown_op",
            base(json!({
                "out": {"op": "magic@1", "args": {"a": "c"}}
            })),
            50.0,
        ),
    ]
}

/// A composed pass in a core view, which runs shipped operators only.
fn composed_in_core_view() -> Value {
    box_figure(
        "A composed pass in a core view",
        "core_view",
        json!({
            "tint": {"id": "tint", "kind": "gpu.pass@1", "name": "Tint", "order": "b0", "params": {
                "about": "Adds red to the frame.", "origin": "composed",
                "inputs": {"src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}},
                "steps": {
                    "uv": {"op": "screen_uv@1", "args": {}},
                    "c": {"op": "sample@1", "args": {"tex": "src", "uv": "uv", "lod": 0}},
                    "red": {"op": "const@1", "args": {"value": [0.6, 0, 0, 0], "type": "vec4"}},
                    "out": {"op": "add@1", "args": {"a": "c", "b": "red"}}
                },
                "outputs": {"color": "out"}, "chain": "effects", "order": "a0", "resolution": "full",
                "cost": {"ns_per_px": 50}, "fallback": "look"
            }}
        }),
    )
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

#[cfg(test)]
mod tests {
    use super::*;

    fn codes(doc: &Value, params: Value) -> Vec<&'static str> {
        group_rule(doc, "g", &json!({"params": params}))
            .iter()
            .map(|r| r.code)
            .collect()
    }

    #[test]
    fn a_groups_passes_are_held_to_their_fields() {
        let fx = json!({"packs": ["deepbuild/fx@1.0.0"], "budget": {"class": "figure"}});
        let invert = json!({"op": "fx.invert@1"});
        assert!(codes(&fx, json!({"passes": [invert]})).is_empty());
        assert_eq!(
            codes(&fx, json!({"passes": vec![&invert; 9]})),
            ["operator_limit"]
        );
        assert_eq!(
            codes(&fx, json!({"backdrop": "below"})),
            ["operator_kind_rule"]
        );
        assert_eq!(
            codes(&fx, json!({"passes": [{"op": "fx.no_such@1"}]})),
            ["operator_unknown_op"]
        );
        // A pack's pass needs the document to name the pack.
        assert_eq!(
            codes(&json!({}), json!({"passes": [invert]})),
            ["operator_unknown_op"]
        );
        let core_view = json!({"packs": fx["packs"], "budget": {"class": "core_view"}});
        assert_eq!(
            codes(&core_view, json!({"passes": [invert]})),
            ["operator_budget_class"]
        );
    }

    #[test]
    fn a_groups_pass_reads_only_its_target_and_is_a_pass() {
        let reads = |output: &str| {
            let src = json!({"from": {"texture": {"target": {"op": "core", "output": output}}}});
            json!({"kind": "gpu.pass@1", "params": {"inputs": {"src": src}}})
        };
        let graph = |item: &Value| pass_graph("p", Some(item), &Map::new(), &[]).map(|g| g.grow);
        assert!(graph(&reads("color")).is_ok());
        assert_eq!(graph(&reads("depth")).err(), Some("operator_kind_rule"));
        let compute = json!({"kind": "gpu.compute@1", "params": {}});
        assert_eq!(graph(&compute).err(), Some("operator_kind_rule"));
        // A shipped pass that reads other targets can't run on a group's.
        let shipped = pass_graph("outline.select@1", None, &Map::new(), &[]);
        assert_eq!(shipped.err(), Some("operator_kind_rule"));
    }

    #[test]
    fn the_shipped_blur_is_two_axes_that_pass_the_operator_check_and_reach_its_radius() {
        let params = json!({"radius": 12})
            .as_object()
            .cloned()
            .unwrap_or_default();
        let blur = pass_graph("blur@1", None, &params, &[]).expect("a shipped pass");
        assert_eq!((blur.stages.len(), blur.grow), (2, 12.0));
        for stage in &blur.stages {
            crate::check::read_and_check(stage).unwrap_or_else(|e| panic!("{e:?}"));
        }
    }

    #[test]
    fn a_composited_group_refuses_a_child_in_depth_and_a_plain_group_keeps_it() {
        let doc = |params: Value| {
            json!({"items": {
                "g": {"kind": "group@1", "params": params},
                "inner": {"kind": "group@1", "parent": "g", "params": {}},
                "cube": {"kind": "mark.box@1", "parent": "inner", "params": {}},
            }})
        };
        let codes_of = |params: Value| {
            let d = doc(params.clone());
            group_rule(&d, "g", &d["items"]["g"])
                .iter()
                .map(|r| r.code)
                .collect::<Vec<_>>()
        };
        assert!(codes_of(json!({"opacity": 0.5})).is_empty());
        assert_eq!(
            codes_of(json!({"blend": "subtract"})),
            ["operator_kind_rule"]
        );
        assert_eq!(codes_of(json!({"blend": "multiply"})), Vec::<&str>::new());
    }
}
