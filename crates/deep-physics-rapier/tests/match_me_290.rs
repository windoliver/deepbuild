//! #290 (canvas primitives: Net: this copy's player; Driver): a driver may read `match.me`, a
//! view value, so a world never reads what such a driver writes, and every copy's world stays
//! the same. The scene is #1918's, whose kinematic paddle follows `items/paddle/at/pos`.

use deep_canvas_physics::doc::read;
use deep_physics_rapier::scene::Scene;
use serde_json::{json, Value};

const SCENE: &str =
    include_str!("../../../tests/acceptance/1918/fixtures/parity/physics/channel-targets.scene");

/// What world `rig` is refused for as `scene` reads it, each as its code and path.
fn refused(scene: &Value) -> Vec<(&'static str, String)> {
    let world = read(&scene["worlds"]["rig"]).expect("the world reads");
    match Scene::read(scene, "rig", &world) {
        Ok(_) => Vec::new(),
        Err(found) => found.into_iter().map(|r| (r.code, r.path)).collect(),
    }
}

#[test]
fn a_world_never_reads_what_a_driver_writes_from_match_me() {
    let scene: Value = serde_json::from_str(SCENE).expect("the fixture parses");
    // The paddle's x written by drivers, in place of the scene's channel on its place.
    let driven = |drivers: Value| {
        let mut s = scene.clone();
        let channels = s["channels"].as_object_mut().expect("the scene's channels");
        channels.remove("paddle");
        s["drivers"] = drivers;
        s
    };
    let nudge = |vars: Value| json!({"target": "items/paddle/at/pos/0", "expr": "x", "vars": vars});
    let follow = [("out_of_range", "bodies/paddle/follow".to_string())];

    assert_eq!(refused(&scene), [], "the scene as #1918 wrote it");
    let plain = driven(json!({"nudge": nudge(json!({"x": "items/dial/at/pos/2"}))}));
    assert_eq!(refused(&plain), [], "a driver that reads another item");
    let mine = driven(json!({"nudge": nudge(json!({"x": "match.me"}))}));
    assert_eq!(refused(&mine), follow, "a driver that reads match.me");
    let through = driven(json!({
        "nudge": nudge(json!({"x": "items/dial/at/pos/2"})),
        "first": {"target": "items/dial/at/pos/2", "expr": "me", "vars": {"me": "match.me"}},
    }));
    assert_eq!(
        refused(&through),
        follow,
        "a driver that reads what one writes from match.me"
    );
}
