//! The first-party data layouts' validators on this engine (#415): each assembled from the sandbox
//! module's text, checked, rewritten and run in the validator role on an asset, and the reference
//! answers on their twins and fixtures that `layouts/judged.json` records for the seal's kit.

use std::time::Duration;

use deep_canvas_sandbox::layouts::{first_party, Layout, Planted};
use deep_canvas_sandbox::rewrite::{hash, Rewritten};
use serde_json::{json, Value};

use crate::service::{trap_json, Budget, Offsets, Sandbox};

/// How long one validation may run before it is stopped as one that never ends.
const DEADLINE: Duration = Duration::from_secs(120);

/// A first-party layout's validator, assembled.
pub fn program(layout: &Layout, planted: Planted) -> Vec<u8> {
    wat::parse_str((layout.program)(planted)).expect("a first-party validator assembles")
}

/// What a validator made of an asset: valid, the first bad offset, or a trap.
#[derive(Clone, Debug, PartialEq)]
pub enum Judged {
    Valid,
    Bad(i64),
    Trap(Value),
}

/// Runs the rewritten validator on `input` under the validator's budget (fuel 8 a byte, at least
/// 10,000,000; memory the asset plus 4 MiB), with the asset at `in_at`.
pub fn judge(sandbox: &Sandbox, rewritten: &Rewritten, input: &[u8]) -> Result<Judged, String> {
    let budget = Budget::of("validator", None, input.len());
    let ran = sandbox.run(
        &rewritten.bytes,
        "validator",
        0,
        &budget,
        &[],
        input,
        DEADLINE,
        Offsets::Written,
    )?;
    Ok(match (ran.trap, ran.result) {
        (Some(t), _) => Judged::Trap(trap_json(&Some(t))),
        (None, Some(-1)) => Judged::Valid,
        (None, Some(o)) => Judged::Bad(o),
        (None, None) => return Err("validate returned nothing".into()),
    })
}

fn verdict(asset: &[u8], j: &Judged) -> Value {
    match j {
        Judged::Valid => json!({"asset": hash(asset), "valid": true, "offset": null}),
        Judged::Bad(o) => json!({"asset": hash(asset), "valid": false, "offset": o}),
        Judged::Trap(t) => json!({"asset": hash(asset), "valid": false, "offset": null, "trap": t}),
    }
}

/// Every first-party layout's program hash and its validator's answers on its twins and
/// fixtures, as `layouts/judged.json` holds them.
pub fn judged() -> Value {
    let sandbox = Sandbox::default();
    let mut out = serde_json::Map::new();
    for l in first_party() {
        let bytes = program(&l, Planted::default());
        let (rw, _) = sandbox
            .rewrite(&bytes, "validator", &Budget::of("validator", None, 0))
            .unwrap_or_else(|e| panic!("{}'s validator is admitted and rewritten: {e:?}", l.name));
        let run = |assets: Vec<Vec<u8>>| -> Vec<Value> {
            assets
                .iter()
                .map(|a| {
                    verdict(
                        a,
                        &judge(&sandbox, &rw, a).expect("a first-party validator runs"),
                    )
                })
                .collect()
        };
        out.insert(
            l.name.into(),
            json!({"program": hash(&bytes), "twins": run((l.twins)()), "fixtures": run((l.fixtures)())}),
        );
    }
    Value::Object(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The recorded answers are this engine's: rerun, they match `layouts/judged.json` (bless with
    /// `DEEP_LAYOUTS_WRITE=1`), every twin is refused and every fixture admitted.
    #[test]
    fn first_party_validators_give_the_recorded_answers() {
        let now = judged();
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../deep-canvas-sandbox/layouts/judged.json"
        );
        if std::env::var_os("DEEP_LAYOUTS_WRITE").is_some() {
            std::fs::write(
                path,
                format!("{}\n", serde_json::to_string_pretty(&now).unwrap()),
            )
            .unwrap();
        }
        let recorded: Value = serde_json::from_str(deep_canvas_sandbox::layouts::JUDGED).unwrap();
        assert_eq!(recorded, now);
        for (name, l) in now.as_object().unwrap() {
            for t in l["twins"].as_array().unwrap() {
                assert_eq!(t["valid"], false, "{name} refuses its twin {t}");
                assert!(
                    t.get("trap").is_none(),
                    "{name}'s twin is refused, not trapped: {t}"
                );
            }
            for f in l["fixtures"].as_array().unwrap() {
                assert_eq!(f["valid"], true, "{name} admits its fixture {f}");
            }
        }
    }

    /// Each refusal names a field of the layout's doc.
    #[test]
    fn a_twin_is_refused_at_the_field_it_breaks() {
        let sandbox = Sandbox::default();
        let want = [
            ("fn.table@1", vec!["x[2]"]),
            (
                "nav.graph@1",
                vec![
                    "links[0].b",
                    "header.link_count",
                    "nodes[0].floor",
                    "nodes[0].vertex_count",
                ],
            ),
            (
                "nav.graph@2",
                vec![
                    "links[0].b",
                    "header.link_count",
                    "nodes[0].floor",
                    "nodes[0].vertex_count",
                    "nodes[0].tags",
                    "links[2].face",
                ],
            ),
            ("pages@1", vec!["pages[2].number"]),
            ("table.layout@1", vec!["tables[0].columns[3].values[1]"]),
        ];
        for (name, fields) in want {
            let l = deep_canvas_sandbox::layouts::named(name).unwrap();
            let bytes = program(&l, Planted::default());
            let (rw, _) = sandbox
                .rewrite(&bytes, "validator", &Budget::of("validator", None, 0))
                .unwrap();
            let got: Vec<String> = (l.twins)()
                .iter()
                .map(|t| match judge(&sandbox, &rw, t).unwrap() {
                    Judged::Bad(o) => (l.field)(t, o as u64),
                    other => format!("{other:?}"),
                })
                .collect();
            assert_eq!(got, fields, "{name}");
        }
    }
}
