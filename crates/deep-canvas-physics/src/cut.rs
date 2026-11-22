//! #2035: a place on a character body or a vehicle body is a cut (Physics output). Every output of
//! the body and its parts, a vehicle's wheels among them, holds at the pose the place's step left,
//! so no frame between that step and the one before draws a blend across the jump. A run lists,
//! by body, each state a place's step ended in, and a bake keeps the list in its `outputs`, so a
//! seek that restores a checkpoint past a place draws what play draws.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::doc::Output;

/// Each placed body's states that a place's step ended in, by body ID.
pub type Cuts = BTreeMap<String, BTreeSet<u64>>;

/// The body an address names: a wheel's or an anchor's `<body>#<part>`, or the body itself.
fn body(from: &str) -> &str {
    from.split('#').next().unwrap_or(from)
}

/// Whether a frame of output `o` between states `k − 1` and `k` shows state `k` with no blend: a
/// place's step ended in state `k` on a body it reads.
pub fn at(cuts: &Cuts, o: &Output, k: u64) -> bool {
    let reads = o
        .expr
        .iter()
        .flat_map(|f| f.reads.iter().map(|(from, _)| from));
    std::iter::once(&o.from)
        .chain(reads)
        .any(|from| cuts.get(body(from)).is_some_and(|s| s.contains(&k)))
}

/// Notes that the step that ended in state `k` placed each body in `placed`.
pub fn note(cuts: &mut Cuts, placed: &[String], k: u64) {
    for id in placed {
        cuts.entry(id.clone()).or_default().insert(k);
    }
}

/// The states a bake's `outputs.cuts` lists for the body `from` reads.
pub fn of(v: &Value, from: &str) -> BTreeSet<u64> {
    let list = v["cuts"][body(from)].as_array();
    list.into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect()
}

/// `cuts` as a bake keeps it, `{body: [state, …]}`, only the states through `to`.
pub fn json(cuts: &Cuts, to: u64) -> Value {
    let kept = cuts
        .iter()
        .map(|(id, s)| (id.clone(), json!(s.range(..=to).collect::<Vec<_>>())));
    Value::Object(
        kept.filter(|(_, s)| s.as_array().is_some_and(|s| !s.is_empty()))
            .collect(),
    )
}

/// The cuts a stored bake's `outputs.cuts` lists through state `to`.
pub fn read(v: &Value, to: u64) -> Cuts {
    let lists = v["cuts"].as_object().into_iter().flatten();
    let kept = lists.map(|(id, s)| {
        let states = s.as_array().into_iter().flatten().filter_map(Value::as_u64);
        (
            id.clone(),
            states.filter(|k| *k <= to).collect::<BTreeSet<u64>>(),
        )
    });
    kept.filter(|(_, s)| !s.is_empty()).collect()
}
