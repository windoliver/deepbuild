use serde_json::json;

use super::{Recording, STEP};

fn appearing(width: i64) -> Vec<&'static str> {
    let frame = |k: u64, present: bool| {
        let elements = if present {
            vec![
                json!({"id": "region/said:1", "bounds": [0, 0, width, 2], "opacity": 1.0, "text": ""}),
            ]
        } else {
            vec![]
        };
        json!({"t": k * STEP, "elements": elements})
    };
    let value = json!({
        "format": "motion.recording@1",
        "window": [400, 300],
        "inputs": [{"t": 0}],
        "frames": (0..4).map(|k| frame(k, k >= 2)).collect::<Vec<_>>(),
    });
    let recording = Recording::parse(&value).unwrap();
    recording
        .findings()
        .into_iter()
        .map(|f| f.finding)
        .collect()
}

#[test]
fn an_element_with_no_area_never_pops_in() {
    assert_eq!(appearing(0), Vec::<&str>::new());
}

#[test]
fn the_same_element_with_area_pops_in() {
    assert_eq!(appearing(40), vec!["pop_in"]);
}
