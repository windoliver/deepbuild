//! The record canvas module (technical design: Canvas modules, the module table's `record` row;
//! issue #388 lays R1's canvas out as canvas modules): each `salience@1` item's level, the items
//! it shows ranked by their record facts and the rest folded into one count, one node per item.

use deep_canvas::registry::{Dependency, Manifest, Module, Range, Registrar, Semver};
use deep_canvas::schedule::core_ops::Fields;
use deep_canvas::schedule::{OpError, Val, View};
use serde_json::{json, Value};

use crate::{item, level, Options};

/// The record module: its manifest and its one register call.
pub fn module() -> Module {
    Module {
        manifest: Manifest {
            name: "record".into(),
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
            feature: "record".into(),
            license: "Apache-2.0".into(),
            implements: "record@1".into(),
            implementation: deep_canvas::registry::Implementation::reference("record", deep_canvas::registry::Semver::parse("1.0.0").expect("a version")),
        },
        register,
    }
}

fn register(r: &mut Registrar) {
    r.array("record.level", "level", "item", "geometry", "items");
    r.operator("salience", "items", &["core.fields"], &["record.level"])
        .applies(is_salience)
        .run(salience);
    r.code(
        "salience.duplicate_id",
        "A salience level that holds one item twice.",
        "Give every item of the level its own id.",
        false,
    );
    r.fixture("level", board(), None).sidecar(json!({
        // It draws nothing yet, so its fixture is checked, not compared as pixels.
        "checks": [{"kind": "document.validate"}],
        "oracles": ["analytic"],
        "codes": ["unknown_kind"],
    }));
}

fn is_salience(_: &Value, _: &str, item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("salience@1")
}

/// The level the item's params rank: what it shows, in order, and the fold.
fn salience(v: &mut View<'_>) -> Result<(), OpError> {
    let fields = v
        .typed::<Fields>("core.fields")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?
        .to_json();
    let path = format!("items/{}/params", v.id().unwrap_or_default());
    let bad = || OpError::new("bad_doc", path.clone());
    let p = &fields["params"];
    let items = p["items"]
        .as_array()
        .ok_or_else(bad)?
        .iter()
        .map(item)
        .collect::<Option<Vec<_>>>()
        .ok_or_else(bad)?;
    let mut ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
    ids.sort_unstable();
    if ids.windows(2).any(|w| w[0] == w[1]) {
        return Err(OpError::new("salience.duplicate_id", path.clone()));
    }
    let show = match p.get("show") {
        None => 9,
        Some(s) => s
            .as_u64()
            .and_then(|s| u8::try_from(s).ok())
            .ok_or_else(bad)?,
    };
    let fits = p["fits"]
        .as_u64()
        .and_then(|f| usize::try_from(f).ok())
        .ok_or_else(bad)?;
    let evidence = p["evidence"].as_bool().unwrap_or(false);
    let out = level(
        &items,
        &Options {
            show,
            fits,
            evidence,
        },
        None,
    );
    v.write("record.level", Val::typed(out))
}

fn board() -> Value {
    let facts = |needs_you: bool, failing: bool| {
        json!({"needs_you": needs_you, "sent_back": false, "failing": failing,
               "lacks_proof": false, "touched": false, "changed": false})
    };
    json!({
        "format": 1, "profile": "board", "seed": 388, "title": "Level",
        "description": "Four parts ranked by their record facts, three shown and the rest folded: the record module's fixture.",
        "size": [320, 200],
        "items": {
            "level": {"id": "level", "kind": "salience@1", "name": "Level", "order": "a0",
                      "params": {"show": 3, "fits": 3, "items": [
                          {"id": "api", "facts": facts(false, true)},
                          {"id": "app", "facts": facts(true, false)},
                          {"id": "docs", "facts": facts(false, false)},
                          {"id": "hub", "facts": facts(false, false), "priority": 2}]}},
            "cap": {"id": "cap", "kind": "text@1", "name": "Caption", "order": "a1",
                    "params": {"text": "Parts", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
                    "at": {"pos": [16, 160, 0]}}
        }
    })
}
