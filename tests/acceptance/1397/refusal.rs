mod common;

use common::{agent_pass, none, param, passes_failures, refusal_failures};
use deep_canvas_effects::check::read_and_check;
use serde_json::{json, Value};

fn grey(of: &str) -> Value {
    json!({"op": "compose@1", "args": {"x": of, "y": of, "z": of, "w": 1.0}})
}

fn divide(guarded: bool) -> Value {
    let mut steps = json!({
        "q": {"op": "div@1", "args": {"a": "a", "b": "b"}},
        "out": grey("q")
    });
    if guarded {
        steps["floor"] = json!({"op": "max@1", "args": {"a": "b", "b": 1e-6}});
        steps["q"]["args"]["b"] = json!("floor");
    }
    agent_pass(
        "agent.divide@1",
        json!({"a": param("a", "f32", 0.0, 1.0), "b": param("b", "f32", 0.0, 1.0)}),
        steps,
        "out",
    )
}

#[test]
fn ac1_cde4e9ee_a_divide_by_a_b_in_0_to_1_is_refused_at_check_and_passes_behind_max_b_1e_6() {
    let mut failures = refusal_failures(
        "#1397.cde4e9ee div(a, b) with b in [0, 1]",
        &read_and_check(&divide(false)),
        "q",
        Some("div"),
        Some("divide_by_zero"),
    );
    failures.extend(passes_failures(
        "#1397.cde4e9ee div(a, max(b, 1e-6)) with b in [0, 1]",
        &read_and_check(&divide(true)),
    ));
    none(&failures, "#1397.cde4e9ee");
}

struct Planted {
    name: &'static str,
    inputs: Value,
    bare: Value,
    clamped: Value,
    step: &'static str,
}

fn x_in_unit() -> Value {
    json!({"x": param("x", "f32", -1.0, 1.0)})
}

fn clamp(x: &str, lo: f64, hi: f64) -> Value {
    json!({"op": "clamp@1", "args": {"x": x, "lo": lo, "hi": hi}})
}

fn planted() -> Vec<Planted> {
    vec![
        Planted {
            name: "sqrt(x - 0.5)",
            inputs: x_in_unit(),
            bare: json!({
                "h": {"op": "sub@1", "args": {"a": "x", "b": 0.5}},
                "r": {"op": "sqrt@1", "args": {"x": "h"}},
                "out": grey("r")
            }),
            clamped: json!({
                "h": {"op": "sub@1", "args": {"a": "x", "b": 0.5}},
                "g": clamp("h", 0.0, 2.0),
                "r": {"op": "sqrt@1", "args": {"x": "g"}},
                "out": grey("r")
            }),
            step: "r",
        },
        Planted {
            name: "log(x)",
            inputs: x_in_unit(),
            bare: json!({"r": {"op": "log@1", "args": {"x": "x"}}, "out": grey("r")}),
            clamped: json!({
                "g": clamp("x", 1e-6, 1.0),
                "r": {"op": "log@1", "args": {"x": "g"}},
                "out": grey("r")
            }),
            step: "r",
        },
        Planted {
            name: "pow(x, 2.2)",
            inputs: x_in_unit(),
            bare: json!({"r": {"op": "pow@1", "args": {"a": "x", "b": 2.2}}, "out": grey("r")}),
            clamped: json!({
                "g": clamp("x", 0.0, 1.0),
                "r": {"op": "pow@1", "args": {"a": "g", "b": 2.2}},
                "out": grey("r")
            }),
            step: "r",
        },
        Planted {
            name: "acos(1.001 * x)",
            inputs: x_in_unit(),
            bare: json!({
                "m": {"op": "mul@1", "args": {"a": "x", "b": 1.001}},
                "r": {"op": "acos@1", "args": {"x": "m"}},
                "out": grey("r")
            }),
            clamped: json!({
                "m": {"op": "mul@1", "args": {"a": "x", "b": 1.001}},
                "g": clamp("m", -1.0, 1.0),
                "r": {"op": "acos@1", "args": {"x": "g"}},
                "out": grey("r")
            }),
            step: "r",
        },
        Planted {
            name: "normalize(v) with v possibly zero",
            inputs: json!({"v": param("v", "vec3", -1.0, 1.0)}),
            bare: json!({
                "r": {"op": "normalize@1", "args": {"x": "v"}},
                "out": {"op": "compose@1", "args": {"x": "r", "y": 1.0}}
            }),
            clamped: json!({
                "lo": {"op": "const@1", "args": {"value": [0.1, 0.1, 0.1], "type": "vec3"}},
                "hi": {"op": "const@1", "args": {"value": [1.0, 1.0, 1.0], "type": "vec3"}},
                "g": {"op": "clamp@1", "args": {"x": "v", "lo": "lo", "hi": "hi"}},
                "r": {"op": "normalize@1", "args": {"x": "g"}},
                "out": {"op": "compose@1", "args": {"x": "r", "y": 1.0}}
            }),
            step: "r",
        },
        Planted {
            name: "inverse_sqrt(x)",
            inputs: x_in_unit(),
            bare: json!({"r": {"op": "inverse_sqrt@1", "args": {"x": "x"}}, "out": grey("r")}),
            clamped: json!({
                "g": clamp("x", 1e-6, 1.0),
                "r": {"op": "inverse_sqrt@1", "args": {"x": "g"}},
                "out": grey("r")
            }),
            step: "r",
        },
    ]
}

#[test]
fn ac2_8675e644_six_planted_graphs_each_fail_naming_the_step_and_each_clamped_twin_passes() {
    let mut failures = Vec::new();
    let mut both_ways = 0;
    let all = planted();
    for p in &all {
        let bare = agent_pass("agent.planted@1", p.inputs.clone(), p.bare.clone(), "out");
        let clamped = agent_pass("agent.clamped@1", p.inputs.clone(), p.clamped.clone(), "out");
        let refused = refusal_failures(
            &format!("#1397.8675e644 {}", p.name),
            &read_and_check(&bare),
            p.step,
            None,
            None,
        );
        let passed = passes_failures(
            &format!("#1397.8675e644 {} behind a clamp", p.name),
            &read_and_check(&clamped),
        );
        if refused.is_empty() && passed.is_empty() {
            both_ways += 1;
        }
        failures.extend(refused);
        failures.extend(passed);
    }
    none(
        &failures,
        &format!("#1397.8675e644: {both_ways} of {} both ways, not {} of {}", all.len(), all.len(), all.len()),
    );
}
