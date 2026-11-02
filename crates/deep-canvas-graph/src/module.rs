//! The graph canvas module (technical design: Canvas modules, the module table's `graph` row;
//! issue #388 lays R1's canvas out as canvas modules): each `graph@1` item's basic layered layout,
//! kept by its layout memory, one node per item, for what draws or checks its positions.

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::core_ops::Fields;
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::{keep, layered, read_graph, read_layout, read_memory, Refused};

/// The graph module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
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
            implementation: deep_canvas::registry::Implementation::reference("graph", deep_canvas::registry::Semver::parse("1.0.0").expect("a version")),
        },
        register,
    }
}

fn register(r: &mut Registrar) {
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
        // It draws nothing yet, so its fixture is checked, not compared as pixels.
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["unknown_kind"],
    }));
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

/// The item's layout memory: laid out afresh, or kept as its memory says.
fn layout(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?
        .to_json();
    let id = v.id().unwrap_or_default().to_string();
    let params = &fields["params"];
    let graph = read_graph(&params["graph"]).map_err(|r| refused(&id, r))?;
    let laid = read_layout(&params["layout"]).map_err(|r| refused(&id, r))?;
    let memory = match params.get("memory") {
        None | Some(Value::Null) => layered(&graph, &laid).map_err(|r| refused(&id, r))?,
        Some(m) => {
            let memory = read_memory(m).map_err(|r| refused(&id, r))?;
            keep(&graph, &laid, &memory)
                .map_err(|r| refused(&id, r))?
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
        "format": 1, "profile": "board", "seed": 388, "title": "Flow",
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
