//! The core's op table (canvas primitives: Step and the closed step list; Every public step): the
//! base entries of the registry `gpu.step@1`, which the core's GPU layer declares and fills
//! (issue #200), so a build without this module still compiles every base step. The effects
//! module reads it from the core, and adds the structural steps (#483), which it registers in
//! `gpu.step@1` before the seal with their fixtures and twins ([`structural_entries`]).

pub use deep_canvas::steps::{Def, ALL, COMPUTE, MATERIAL, PASS, TABLE, VERSION};
use serde_json::{json, Value};

/// Cost units an element of a sort, a scan or a compaction costs, from the micro-benchmarks on
/// the reference Mac (`deep-gpu`'s structural timings; units of [`crate::check::NS_PER_UNIT`]).
pub const SORT_WEIGHT: f64 = 7500.0;
pub const SCAN_WEIGHT: f64 = 1500.0;
pub const COMPACT_WEIGHT: f64 = 1500.0;

const fn s(
    name: &'static str,
    ports: &'static [&'static str],
    weight: f64,
    fetches: u32,
    exact: bool,
    kinds: u8,
) -> Def {
    Def {
        name,
        ports,
        weight,
        fetches,
        exact,
        kinds,
    }
}

/// The structural steps (Step and the closed step list: structural steps), sorted by name.
pub const STRUCTURAL: &[Def] = &[
    s(
        "compact@1",
        &["in", "flag", "count"],
        COMPACT_WEIGHT,
        0,
        true,
        COMPUTE,
    ),
    s("iterate@1", &[], 0.0, 0, true, PASS),
    s("load3d@1", &["tex", "ixyz"], 1.0, 1, true, ALL),
    s("sample3d@1", &["tex", "uvw"], 1.0, 8, false, ALL),
    s("scan@1", &["in"], SCAN_WEIGHT, 0, true, COMPUTE),
    s(
        "sort_by_key@1",
        &["keys", "values", "count"],
        SORT_WEIGHT,
        0,
        true,
        COMPUTE,
    ),
    s("store@1", &["tex", "ixy", "v"], 1.0, 0, true, COMPUTE),
    s("with@1", &["a", "i", "v"], 1.0, 0, true, ALL),
];

/// The entry for `name@major`: the core's, or a structural step's.
pub fn def(name: &str) -> Option<&'static Def> {
    deep_canvas::steps::def(name).or_else(|| STRUCTURAL.iter().find(|d| d.name == name))
}

/// Whether a step is one of the shipped multi-dispatch steps, which run over whole buffers.
pub fn multi_dispatch(name: &str) -> bool {
    matches!(name, "sort_by_key@1" | "scan@1" | "compact@1")
}

fn kinds(bits: u8) -> Vec<&'static str> {
    [(MATERIAL, "material"), (PASS, "pass"), (COMPUTE, "compute")]
        .into_iter()
        .filter(|(b, _)| bits & b != 0)
        .map(|(_, k)| k)
        .collect()
}

/// Each structural step's exactness fixture and its planted twin, which the fixture refuses.
fn fixture(name: &str) -> (Value, &'static str) {
    let ix = |n: u32| json!({"buf": (0..n).collect::<Vec<_>>()});
    match name {
        // Equal keys keep index order; the twin breaks ties by decreasing index.
        "sort_by_key@1" => (
            json!([{"args": [{"buf": [3, 1, 3, 1, 0]}, ix(5), {"u": 5}], "expect": {"buf": [4, 1, 3, 0, 2]}},
                   {"args": [{"buf": [7, 7, 7]}, ix(3), {"u": 3}], "expect": {"buf": [0, 1, 2]}}]),
            "ties_by_decreasing_index",
        ),
        // Exclusive, wrapping at 2^32; the twin is inclusive.
        "scan@1" => (
            json!([{"args": [{"buf": [1, 2, 3, 4]}], "expect": {"buf": [0, 1, 3, 6]}},
                   {"args": [{"buf": [4294967295u32, 2, 1]}], "expect": {"buf": [0, 4294967295u32, 1]}}]),
            "inclusive",
        ),
        // Index order; the twin keeps them in the order a racing counter hands out.
        "compact@1" => (
            json!([{"args": [{"buf": [10, 11, 12, 13]}, {"buf": [1, 0, 1, 1]}, {"u": 4}], "expect": {"buf": [10, 12, 13]}}]),
            "atomic_order",
        ),
        // Each run reads the last; the twin feeds every run the first run's output.
        "iterate@1" => (
            json!([{"args": [{"u": 3}, {"f": 1}], "env": {"body": ["mul", "prev", 2]}, "expect": {"f": 8}}]),
            "first_run",
        ),
        "with@1" => (
            json!([{"args": [{"v": [1, 2, 3]}, {"u": 1}, {"f": 9}], "expect": {"v": [1, 9, 3]}},
                   {"args": [{"v": [1, 2, 3]}, {"u": 20}, {"f": 9}], "expect": {"v": [1, 2, 9]}}]),
            "off_by_one",
        ),
        // A texel written at its index: the texture after the store.
        "store@1" => (
            json!([{"args": [{"buf": [0, 0, 0, 0]}, {"u": 2}, {"f": 7}], "expect": {"buf": [0, 0, 7, 0]}}]),
            "off_by_one",
        ),
        "load3d@1" => (
            json!([{"args": [{"buf": [0, 1, 2, 3, 4, 5, 6, 7]}, {"uv": [1, 0, 1]}], "env": {"size": [2, 2, 2]}, "expect": {"f": 5}}]),
            "off_by_one",
        ),
        _ => (
            json!([{"args": [{"buf": [0, 1, 2, 3, 4, 5, 6, 7]}, {"v": [0.75, 0.25, 0.75]}], "env": {"size": [2, 2, 2]}, "expect": {"f": 5}}]),
            "off_by_one",
        ),
    }
}

/// The structural steps as `gpu.step@1` entries: signature, weight, exactness, the core's meaning
/// of the step, its exactness fixture and its planted twin.
pub fn structural_entries() -> Vec<(&'static str, Value)> {
    STRUCTURAL
        .iter()
        .map(|d| {
            let (fixture, twin) = fixture(d.name);
            (
                d.name,
                json!({
                    "signature": {"ports": d.ports, "kinds": kinds(d.kinds)},
                    "weight": d.weight, "fetches": d.fetches, "exact": d.exact,
                    "impl": {"base": d.name},
                    "fixture": fixture,
                    "twin": {"perturb": twin},
                }),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_structural_step_holds_its_fixture_and_refuses_its_twin() {
        for (name, v) in structural_entries() {
            assert_eq!(deep_canvas::steps::exactness(&v, ""), Ok(()), "{name}");
            let twin = v["twin"]["perturb"].as_str().unwrap_or_default();
            assert!(
                deep_canvas::steps::exactness(&v, twin).is_err(),
                "{name}'s twin passes"
            );
        }
    }
}
