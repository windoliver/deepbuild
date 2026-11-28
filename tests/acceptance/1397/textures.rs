mod common;

use common::{agent_pass, names, none, passes_failures, shown, value_refusals};
use deep_canvas_effects::check::{read_and_check, read_and_check_with, CheckOptions, Checked};
use deep_canvas_effects::graph::Issue;
use serde_json::{json, Value};

const INPUT: &str = "hdr";

fn sampled_root(range: Option<[f64; 2]>) -> Value {
    let mut hdr = json!({"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}});
    if let Some(r) = range {
        hdr["range"] = json!(r);
    }
    agent_pass(
        "agent.hdr_root@1",
        json!({ INPUT: hdr }),
        json!({
            "uv": {"op": "screen_uv@1", "args": {}},
            "c": {"op": "sample@1", "args": {"tex": INPUT, "uv": "uv", "lod": 0}},
            "r": {"op": "split@1", "args": {"x": "c", "pick": "x"}},
            "s": {"op": "sqrt@1", "args": {"x": "r"}},
            "out": {"op": "compose@1", "args": {"x": "s", "y": "s", "z": "s", "w": 1.0}}
        }),
        "out",
    )
}

fn undeclared_failures(result: &Result<Checked, Vec<Issue>>) -> Vec<String> {
    let what = "#1397.433429ee sqrt of the red of an rgba16float texture (the core's color target) with no declared range";
    match result {
        Ok(_) => vec![format!("{what}: the check proves it; an undeclared float texture is the whole range with NaN, so it is unproven")],
        Err(issues) => {
            let found = value_refusals(issues);
            if found.iter().any(|j| names(j, INPUT)) {
                Vec::new()
            } else {
                vec![format!("{what}: no operator.value issue names the input {INPUT}: {}", shown(issues))]
            }
        }
    }
}

#[test]
fn ac3_433429ee_a_graph_sampling_an_undeclared_rgba16float_texture_is_unproven_naming_the_input() {
    let mut failures = undeclared_failures(&read_and_check(&sampled_root(None)));
    failures.extend(passes_failures(
        "#1397.433429ee the same graph with the texture declared [0, 1]",
        &read_and_check(&sampled_root(Some([0.0, 1.0]))),
    ));
    none(&failures, "#1397.433429ee");
}

#[test]
fn ac3_433429ee_a_planted_analyzer_that_assumes_float_textures_are_0_to_1_passes_it_and_fails_this_test() {
    let planted = CheckOptions {
        unit_float_textures: true,
        ..CheckOptions::default()
    };
    let result = read_and_check_with(&sampled_root(None), planted);
    assert!(
        result.is_ok(),
        "#1397.433429ee the planted analyzer (unit_float_textures) passes the undeclared texture's graph: {}",
        result.as_ref().err().map(|i| shown(i)).unwrap_or_default()
    );
    assert!(
        !undeclared_failures(&result).is_empty(),
        "#1397.433429ee the judge fails the planted analyzer"
    );
}
