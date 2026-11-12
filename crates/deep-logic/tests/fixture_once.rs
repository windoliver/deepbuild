//! #190 Fixtures: "the logic module runs them once per library hash and module version". The two
//! lines are the #190 acceptance suite's own pieces (tests/acceptance/190/libs.ts): `maze` links
//! grid_path@1 from pack gridcore@1.0.0, and `tactics` links pathing@1 from pack kit@1.0.0, which
//! needs the same grid_path@1. Other packs on the piece don't make it another library.

use deep_logic::{Logic, Planted};
use serde_json::Value;

#[test]
fn a_library_s_fixtures_run_once_per_hash_whatever_packs_carry_it() {
    let lines = include_str!("fixtures/fixture-once.jsonl");
    let mut logic = Logic::new(Planted::default());
    let ran: Vec<Vec<(String, bool)>> = lines
        .lines()
        .map(|l| {
            let reply = logic.handle(&serde_json::from_str::<Value>(l).expect("a request line"));
            assert_eq!(reply["ok"], true, "{reply}");
            let items = reply["items"].as_object().expect("items");
            items
                .values()
                .flat_map(|i| i["libraries"].as_array().expect("libraries").clone())
                .flat_map(|l| {
                    let label = format!(
                        "{} {}",
                        l["name"].as_str().unwrap(),
                        l["hash"].as_str().unwrap()
                    );
                    let fixtures = l["fixtures"].as_array().expect("fixtures").clone();
                    fixtures
                        .into_iter()
                        .map(move |f| (label.clone(), f["ran"] == true))
                })
                .collect()
        })
        .collect();
    let grid = |rec: &Vec<(String, bool)>| -> Vec<bool> {
        rec.iter()
            .filter(|(l, _)| l.starts_with("grid_path@1 "))
            .map(|(_, r)| *r)
            .collect()
    };
    assert_eq!(
        grid(&ran[0]),
        [true],
        "the first check runs grid_path@1's fixture: {ran:?}"
    );
    assert_eq!(
        grid(&ran[1]),
        [false],
        "the same grid_path@1, reached through another pack, doesn't run its fixture again: {ran:?}"
    );
    assert!(
        ran[1]
            .iter()
            .any(|(l, r)| l.starts_with("pathing@1 ") && *r),
        "pathing@1's fixture runs: {ran:?}"
    );
}
