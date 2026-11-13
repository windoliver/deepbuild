//! The graph canvas module (technical design: Canvas modules, the module table's `graph` row;
//! issue #388 lays R1's canvas out as canvas modules): each `graph@1` item's basic layered layout,
//! kept by its layout memory, one node per item, for what draws or checks its positions.

use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::core_ops::Fields;
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::{keep, layered, read_graph, read_layout, read_memory, Refused};

/// The graph module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: manifest("graph"),
        register: |r| register(r, layout),
    }
}

/// A planted implementation of graph@1 (#399's `test-graph-tie-by-registration`): declared bit
/// and canonical, under its own name, whose layered layout breaks a tie by the order the item
/// lists its nodes in instead of by ID, so the kit's bit part fails it and a release build
/// refuses it.
pub fn tie_by_registration() -> Module {
    Module {
        manifest: manifest("graph.tie_by_registration"),
        register: |r| register(r, layout_as_listed),
    }
}

fn manifest(implementation: &str) -> Manifest {
    Manifest {
        name: "graph".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [(
            "marks2d".to_string(),
            Dependency {
                range: Range::parse("^1").expect("a range"),
                optional: false,
            },
        )]
        .into_iter()
        .collect(),
        feature: "graph".into(),
        license: "Apache-2.0".into(),
        implements: "graph@1".into(),
        implementation: deep_canvas::registry::Implementation::reference(
            implementation,
            deep_canvas::registry::Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

fn register(r: &mut Registrar, layout: fn(&mut View<'_>) -> Result<(), OpError>) {
    // #494: the kind (Graph and layout memory `graph@1`), so a document's graph is kept and a
    // match morph pairs its nodes by key; it draws as its laid-out nodes' boxes.
    let field = |name: &'static str| Param {
        name,
        ty: ParamType::Json,
        unit: "",
        default: Value::Null,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    r.kind(
        Entry {
            family: "",
            name: "graph",
            versions: vec![Version {
                major: 1,
                minor: 0,
                params: ["graph", "layout", "memory", "groups"]
                    .into_iter()
                    .map(field)
                    .collect(),
            }],
            migrations: Vec::new(),
        },
        &[],
        "path@1",
    )
    .drawn(drawn);
    r.array("graph.layout", "memory", "item", "geometry", "items");
    r.operator("layout", "items", &["core.fields"], &["graph.layout"])
        .applies(is_graph)
        .run(layout);
    r.code(
        "layout.relayout_needed",
        "A graph its layout memory no longer holds: a node it lacks, or an edge its ranks break.",
        "Take the full relayout offered beside the kept picture, or remove what moved.",
        false,
    );
    r.fixture("layered", board(), None).sidecar(json!({
        // It draws only its nodes' boxes (#494), so its fixture is checked, not compared as pixels.
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["unknown_kind"],
    }));
    // #399: a parent's two children tie in their rank, listed out of ID order, so only a layout
    // that breaks the tie by ID places them as the reference does.
    r.fixture("tie", tie_board(), None).sidecar(json!({
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": [],
    }));
}

/// What a graph item draws as (#494): one `path@1` of its laid-out nodes' boxes, in its own
/// space, in ink outlines.
fn drawn(params: &Value) -> Value {
    let mut d = String::new();
    if let Ok((_, view)) = crate::view::place(params, [0.0, 0.0]) {
        for [x, y, w, h] in view.nodes.values() {
            d.push_str(&format!(
                "M{x} {y} L{} {y} L{} {} L{x} {} Z ",
                x + w,
                x + w,
                y + h,
                y + h
            ));
        }
    }
    let mut out = params.as_object().cloned().unwrap_or_default();
    out.insert(
        "d".into(),
        json!(if d.is_empty() {
            "M0 0".to_string()
        } else {
            d.trim_end().to_string()
        }),
    );
    out.insert(
        "paint".into(),
        json!({"stroke": {"role": "ink", "width": 2}}),
    );
    Value::Object(out)
}

fn is_graph(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("graph@1")
}

fn refused(id: &str, r: Refused) -> OpError {
    let code = if r.code == "bad_input" {
        "bad_doc"
    } else {
        r.code
    };
    OpError::new(code, format!("items/{id}/params"))
}

fn layout(v: &mut View<'_>) -> Result<(), OpError> {
    layout_with(v, false)
}

/// The planted layout: a fresh layout reads the nodes in the order the item lists them.
fn layout_as_listed(v: &mut View<'_>) -> Result<(), OpError> {
    layout_with(v, true)
}

/// The item's layout memory: laid out afresh, or kept as its memory says.
fn layout_with(v: &mut View<'_>, as_listed: bool) -> Result<(), OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?
        .to_json();
    let id = v.id().unwrap_or_default().to_string();
    let params = &fields["params"];
    let mut graph = read_graph(&params["graph"]).map_err(|r| refused(&id, r))?;
    if as_listed && params.get("memory").is_none_or(Value::is_null) {
        let listed: Vec<&str> = params["graph"]["nodes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|n| n["id"].as_str())
            .collect();
        graph
            .nodes
            .sort_by_key(|n| listed.iter().position(|l| *l == n.id));
    }
    let laid = read_layout(&params["layout"]).map_err(|r| refused(&id, r))?;
    let memory = match params.get("memory") {
        None | Some(Value::Null) => layered(&graph, &laid).map_err(|r| refused(&id, r))?,
        Some(m) => {
            let memory = read_memory(m).map_err(|r| refused(&id, r))?;
            keep(&graph, &laid, &memory)
                .map_err(|r| refused(&id, r))?
                .map(|(kept, _)| kept)
                .map_err(|_| {
                    OpError::new(
                        "layout.relayout_needed",
                        format!("items/{id}/params/memory"),
                    )
                })?
        }
    };
    v.write("graph.layout", Val::typed(memory))
}

fn board() -> Value {
    let node = |id: &str| json!({"id": id, "w": 64, "h": 32});
    json!({
        "format": 1, "profile": "board", "seed": 388, "title": "Flow", "requires": {"modules": {"graph": "^1"}},
        "description": "Four steps and their edges laid out in layers: the graph module's fixture.",
        "size": [320, 240],
        "items": {
            "flow": {"id": "flow", "kind": "graph@1", "name": "Flow", "order": "a0",
                     "params": {
                         "graph": {"nodes": [node("plan"), node("build"), node("test"), node("ship")],
                                   "edges": [{"id": "e1", "a": "plan", "b": "build"},
                                             {"id": "e2", "a": "build", "b": "test"},
                                             {"id": "e3", "a": "plan", "b": "test"},
                                             {"id": "e4", "a": "test", "b": "ship"}]},
                         "layout": {"algo": "layered", "seed": 388, "spacing": {"rank": 48}}}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a1",
                    "params": {"text": "Flow", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
                    "at": {"pos": [16, 200, 0]}}
        }
    })
}

fn tie_board() -> Value {
    let node = |id: &str| json!({"id": id, "w": 64, "h": 32});
    json!({
        "format": 1, "profile": "board", "seed": 399, "title": "Tie", "requires": {"modules": {"graph": "^1"}},
        "description": "A root and its two children, listed right before left: the graph module's tie fixture.",
        "size": [320, 240],
        "items": {
            "tree": {"id": "tree", "kind": "graph@1", "name": "Tree", "order": "a0",
                     "params": {
                         "graph": {"nodes": [node("root"), node("right"), node("left")],
                                   "edges": [{"id": "e1", "a": "root", "b": "right"},
                                             {"id": "e2", "a": "root", "b": "left"}]},
                         "layout": {"algo": "layered", "seed": 399, "spacing": {"rank": 48}}}}
        }
    })
}
