//! fx@1 (canvas primitives: Pack: fx@1 named operators): the first-party pack's named operators,
//! `packs/fx-1.0.0`, read as data. Each is a composed pass graph from the public steps, with its
//! params (inputs from `param`, each with a unit, a range and a default), its declared cost and
//! its `grow`, the px it reaches past what it covers. The grow is the pack's, for the group that
//! runs it, so the operator check reads the graph without it.

use serde_json::Value;

/// The pack's manifest.
pub const PACK: &str = include_str!("../../../packs/fx-1.0.0/pack.json");

/// One named operator: `fx.<name>@<major>`, its grow and its graph.
#[derive(Clone, Debug)]
pub struct Named {
    pub name: String,
    pub grow: u64,
    pub graph: Value,
}

/// The pack's operators, in name order.
pub fn library() -> Vec<Named> {
    named(&serde_json::from_str(PACK).expect("fx@1's manifest is JSON"))
}

/// The named operators of a pack's manifest, in name order.
pub fn named(pack: &Value) -> Vec<Named> {
    let mut out: Vec<Named> = pack["operators"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(name, g)| {
            let mut graph = g.clone();
            let grow = graph
                .as_object_mut()
                .and_then(|o| o.remove("grow"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            Named {
                name: name.clone(),
                grow,
                graph,
            }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::check::read_and_check;
    use crate::graph::{Class, From, Kind, Origin};
    use crate::interp::{self, Env, Image};

    /// Every graph passes the whole operator check as a pack's pass, from public steps, same
    /// machine at best, its params each with a unit, a range and a default, under its own name.
    #[test]
    fn every_fx_graph_checks_as_a_pack_pass_with_its_params() {
        let lib = library();
        assert!(lib.len() >= 12, "fx@1 names {} operators", lib.len());
        let shipped: Vec<&str> = crate::shipped::library(true)
            .iter()
            .map(|s| s.name)
            .collect();
        for n in &lib {
            assert!(
                n.name.starts_with("fx.") && n.name.ends_with("@1"),
                "{}",
                n.name
            );
            assert!(
                !shipped.contains(&n.name.as_str()),
                "{} takes a shipped name",
                n.name
            );
            assert_eq!(n.graph["id"], n.name.as_str(), "{}'s id", n.name);
            let c =
                read_and_check(&n.graph).unwrap_or_else(|e| panic!("{} is refused: {e:?}", n.name));
            assert_eq!(c.op.kind, Kind::Pass, "{}", n.name);
            assert_eq!(c.op.origin, Origin::Pack, "{}", n.name);
            assert_eq!(
                c.class,
                Class::SameMachine,
                "{} is same machine at best",
                n.name
            );
            for (name, input) in &c.op.inputs {
                if let From::Param(_) = input.from {
                    let raw = &n.graph["inputs"][name];
                    assert!(raw["unit"].is_string(), "{}: {name} names its unit", n.name);
                    assert!(input.range.is_some(), "{}: {name} has a range", n.name);
                    assert!(input.default.is_some(), "{}: {name} has a default", n.name);
                }
            }
        }
    }

    /// Each graph runs on the CPU interpreter at its defaults, every pixel finite.
    #[test]
    fn every_fx_graph_runs_on_the_interpreter() {
        let mut img = Image::new(8, 8);
        for (i, px) in img.px.iter_mut().enumerate() {
            let k = i as f64;
            *px = [(k * 0.37) % 1.5, (k * 0.11) % 1.0, (k * 0.73) % 2.0, 1.0];
        }
        for n in library() {
            let c = read_and_check(&n.graph).expect("checks");
            let env = Env {
                t: 0.0,
                seed: 7,
                clip: [0.0; 16],
                inverse_clip: [0.0; 16],
                eye: [0.0; 4],
                inputs: interp::inputs(&c, &BTreeMap::new(), &BTreeMap::new()),
                textures: BTreeMap::from([("src".to_string(), &img)]),
                normals: [[0.0; 3]; 3],
            };
            let out = interp::pass(&c, &env, [8, 8]).unwrap_or_else(|e| panic!("{}: {e}", n.name));
            assert!(
                out.px.iter().flatten().all(|v| v.is_finite()),
                "{} gives a non-finite pixel",
                n.name
            );
        }
    }
}
