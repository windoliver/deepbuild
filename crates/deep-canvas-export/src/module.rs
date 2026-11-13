//! The export canvas module `export@1` (canvas primitives: Export, Export: Lottie): the Lottie
//! target of the core's `export.target@1`, read back by a pinned reference Lottie renderer, a
//! tool apart from the writer; and the `export` check kind, which holds a deliverable export to
//! its target.

use deep_canvas::registry::{
    Dependency, Implementation, Manifest, Module, Raised, Range, Registrar, Semver,
};
use serde_json::{json, Map, Value};

use crate::lottie::{self, Frames, Plant, CANT_HOLD};

/// The Lottie target's independent reader: the pinned reference renderer's process.
pub const READER: &str = "lottie_reader";

fn manifest() -> Manifest {
    let dep = |r: &str| Dependency {
        range: Range::parse(r).expect("a range"),
        optional: false,
    };
    Manifest {
        name: "export".into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: [
            ("marks2d".to_string(), dep("^1")),
            ("motion".to_string(), dep("^1")),
        ]
        .into_iter()
        .collect(),
        feature: "export".into(),
        license: "Apache-2.0".into(),
        implements: "export@1".into(),
        implementation: Implementation::reference(
            "export",
            Semver::parse("1.0.0").expect("a version"),
        ),
    }
}

/// `export`, the shipped implementation of export@1.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

pub const CODES: [&str; 3] = ["export.cant_hold", "export.refused", "export.listed"];

fn register(r: &mut Registrar) {
    r.entry(
        "export.target@1",
        "lottie",
        json!({"writer": "export", "fidelity": ["export.fidelity"], "reader": READER, "hidden": "left_out"}),
        "R6",
    );
    r.check("export", "any", &CODES, check);
    // Each code's planted fixture, held to the export check on the Lottie target.
    // The kit seals the module with its dependencies' kinds left unknown, so each fixture's plate
    // is also `unknown_kind` to the core check.
    let lottie = json!([{"kind": "export"}]);
    r.fixture(
        "export-glow",
        fixture(
            "export-glow",
            json!({"paint": {"fill": {"role": "accent"}, "glow": {"role": "accent", "size": 6}}}),
            None,
        ),
        None,
    )
    .sidecar(json!({"codes": ["export.cant_hold", "unknown_kind"], "checks": lottie}));
    r.fixture("export-spring", fixture("export-spring", json!({"paint": {"fill": {"role": "accent"}}}), Some(json!({"spin": {"target": "items/plate/at/rot/2", "type": "f32",
        "keys": {"k0": {"t": "0s", "value": 0, "interp": {"spring": {"freq_hz": 2, "damping_ratio": 0.4}}}, "k1": {"t": "1s", "value": 45}}}}))), None)
        .sidecar(json!({"codes": ["export.listed", "unknown_kind"], "checks": lottie}));
    r.fixture("export-status", fixture("export-status", json!({"paint": {"fill": {"role": "accent"}}, "status": {"source": "verdict:01JB162K000000000000000001"}}), None), None)
        .sidecar(json!({"codes": ["export.refused", "unknown_kind"], "checks": lottie}));
    r.code(
        "export.cant_hold",
        "A deliverable export lists an item its format can't hold.",
        "Change the item to one the format holds, or let it go in the definition's except list.",
        false,
    );
    r.code(
        "export.listed",
        "A deliverable export lists an item the definition lets go, or a value it sampled: listed, never failing.",
        "Nothing to fix: the item or the sampled value is named so a reader knows what the file holds.",
        false,
    );
    r.code(
        "export.refused",
        "A deliverable export refuses the document (a status binding a Lottie can't keep, or motion that doesn't compile).",
        "Remove the status binding, or deliver another target.",
        false,
    );
}

/// The `export` check on a deliverable: each item the target's writer lists as one it can't hold
/// fails, naming the item and what, unless the input's `except` lets it go; a sampled key is
/// listed and never fails.
pub fn check(doc: &Value, input: &Value) -> Vec<(String, Raised)> {
    let target = input
        .get("target")
        .and_then(Value::as_str)
        .unwrap_or("lottie");
    if target != "lottie" {
        return Vec::new();
    }
    let except: Vec<&str> = input
        .get("except")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let Some(map) = doc.as_object() else {
        return Vec::new();
    };
    match listing(map) {
        Err(r) => vec![(
            String::new(),
            Raised {
                code: "export.refused",
                severity: "error",
                path: r.path.clone(),
                what: r.what.clone(),
                fix_ops: None,
            },
        )],
        // An item the format can't hold fails, unless the definition lets it go; a let-go item and
        // a sampled value are listed as notices and never fail.
        Ok(list) => list
            .into_iter()
            .map(|w| {
                let what = format!("{}: {}", w.item, w.what);
                let let_go = except.contains(&w.item.as_str()) || except.contains(&w.path.as_str());
                let (code, severity) = if w.code == CANT_HOLD && !let_go {
                    ("export.cant_hold", "error")
                } else {
                    ("export.listed", "warning")
                };
                (
                    w.item.clone(),
                    Raised {
                        code,
                        severity,
                        path: w.path,
                        what,
                        fix_ops: None,
                    },
                )
            })
            .collect(),
    }
}

/// The Lottie writer's warnings for `doc` over its transport at its own rate, colors from the
/// shipped clean look (colors don't change what it lists).
pub fn listing(doc: &Map<String, Value>) -> Result<Vec<lottie::Warning>, lottie::Refusal> {
    let rate = rate_of(doc);
    let frame = deep_canvas::time::frame_length(rate.0, rate.1).unwrap_or(705_600_000 / 60);
    // A span is flicks, or a seconds literal.
    let span = lottie::pointer(doc, "/transport/span")
        .and_then(|v| {
            v.as_str()
                .and_then(seconds)
                .map(|s| s * 705_600_000.0)
                .or_else(|| v.as_f64())
        })
        .unwrap_or(705_600_000.0);
    let n = (span / frame as f64).ceil().max(1.0) as usize;
    let look = deep_canvas_marks::look::shipped("clean").and_then(|d| {
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        deep_canvas_marks::look::resolve(&d, &bundled).ok()
    });
    let palette = look.map(|l| l.light).unwrap_or_default();
    let ty = deep_canvas_marks::scene::Type::default();
    let w = lottie::write(
        doc,
        (&palette, &ty),
        Frames {
            rate,
            frame,
            first: 0,
            n,
        },
        (true, Vec::new()),
        Plant::None,
    )?;
    Ok(w.warnings)
}

fn rate_of(doc: &Map<String, Value>) -> (u32, u32) {
    match lottie::pointer(doc, "/transport/frame_rate") {
        Some(Value::Number(n)) => (n.as_u64().unwrap_or(60) as u32, 1),
        Some(Value::String(r)) => {
            let (p, q) = r.split_once('/').unwrap_or((r, "1"));
            (
                p.trim().parse().unwrap_or(60),
                q.trim().parse().unwrap_or(1),
            )
        }
        Some(Value::Array(a)) => (
            a.first().and_then(Value::as_u64).unwrap_or(60) as u32,
            a.get(1).and_then(Value::as_u64).unwrap_or(1) as u32,
        ),
        _ => (60, 1),
    }
}

/// A plain seconds literal (`"2s"`, `"2.5s"`).
fn seconds(s: &str) -> Option<f64> {
    s.strip_suffix('s')?.parse().ok()
}

/// A 2D film of one plate with `params`, and `channels`.
fn fixture(id: &str, params: Value, channels: Option<Value>) -> Value {
    let mut plate = json!({"id": "plate", "kind": "rect@1", "layer": "kit", "name": "Plate", "order": "a1", "at": {"pos": [40, 30, 0]}});
    let mut p = json!({"box": [0, 0, 80, 40]});
    if let (Some(p), Some(extra)) = (p.as_object_mut(), params.as_object()) {
        p.extend(extra.clone());
    }
    plate["params"] = p;
    json!({"format": 1, "id": id, "profile": "film", "title": format!("The export module's fixture {id}"),
        "description": "A plate the export check reads on the Lottie target.", "size": [160, 100],
        "transport": {"span": "1s", "frame_rate": [24, 1]}, "layers": {"kit": {"writer": "agent-a", "title": "Kit", "order": "a0"}},
        "items": {"plate": plate}, "channels": channels.unwrap_or_else(|| json!({}))})
}
