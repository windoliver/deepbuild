use serde_json::{json, Value};

use super::read_and_check;
use crate::graph::Class;

fn answering(light: Value) -> Value {
    json!({"id": "cel", "kind": "material", "origin": "composed", "about": "A response.",
        "steps": {}, "outputs": {}, "cost": {"ns_per_px": 50}, "light": light})
}

fn response(first: Value) -> Value {
    json!({"steps": {"d": first, "c": {"op": "mul@1", "args": {"a": "radiance", "b": "d"}}},
        "outputs": {"radiance": "c"}})
}

#[test]
fn a_light_response_counts_once_for_each_light_a_cluster_holds() {
    let ndl = json!({"op": "dot@1", "args": {"a": "n", "b": "l"}});
    let c = read_and_check(&answering(response(ndl))).expect("it checks");
    let light = &c.responses["light"];
    assert!(light.estimate > 0.0);
    let lights = deep_canvas_scene3d::light::SHADED as f64;
    assert_eq!(c.estimate, light.estimate * lights);
    assert_eq!(c.class, Class::SameMachine);
}

#[test]
fn a_light_response_takes_no_derivative() {
    let ddx = json!({"op": "ddx@1", "args": {"x": "shadow"}});
    let issues = read_and_check(&answering(response(ddx))).unwrap_err();
    assert_eq!(issues[0].reason, Some("derivative_in_divergent_flow"));
    assert_eq!(issues[0].path.as_deref(), Some("light"));
}
