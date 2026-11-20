//! #2098: the backend of this build a world runs on. A world that asks for rapier2d, by its
//! `backend.name` or else by its `dimensions`, is held to rapier2d's caps and keyed by the build
//! rapier2d and the crates under it make; every other world is held to Rapier's in 3D, as this
//! runner holds them, and keyed as it always was. The planted `world_2d_built_on_rapier3d` lets
//! a 2D world that names rapier3d through its check, to be built there.

use deep_canvas_physics::caps::asked;

use super::*;

/// The reply refusing `call` on `w`, a 2D world, which only its check, its bakes and its seeks
/// read yet; none for a 3D world.
pub(super) fn unread(w: &World, call: &str) -> Option<Value> {
    let what = format!("{call} isn't run on a 2D world yet; #2098's follow-up brings it");
    let issue = json!({"check": call, "code": "physics.unsupported", "severity": "error",
                       "path": "dimensions", "actual": 2, "what": what});
    (w.dimensions == 2).then(|| json!({"ok": false, "issues": [issue]}))
}

impl Run {
    /// The caps `world` is held to; a test backend's whatever the world asks for.
    pub(super) fn caps_of(&self, world: &Value) -> Caps {
        if self.test.is_none() && asked(world).dimensions == 2 {
            return *asked(world);
        }
        let mut caps = self.caps;
        if self.twin == Twin::FlatOnRapier3d && world.get("dimensions") == Some(&json!(2)) {
            caps.dimensions = 2;
        }
        caps
    }

    /// The build `world`'s results depend on.
    pub(super) fn build_of(&self, world: &Value) -> Build {
        if asked(world).dimensions == 2 {
            crate::build_2d()
        } else {
            self.build.clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A disc dropped `drop` m onto a static line, in a 2D world, with `extra` over it.
    fn drop_world(drop: f64, extra: Value) -> Value {
        let mut w = json!({
            "kind": "physics.world@1", "dimensions": 2,
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "contact_materials": {"m": {"restitution": 0.5, "density": 1000, "tag": "wood"}},
            "shapes": {"disc": {"kind": "circle", "radius": 0.1},
                       "line": {"kind": "segment", "a": [-5, 0], "b": [5, 0]}},
            "bodies": {"floor": {"kind": "static", "shapes": [{"shape": "line", "contact_material": "m"}]},
                       "ball": {"kind": "dynamic", "shapes": [{"shape": "disc", "contact_material": "m"}],
                                "pose": {"pos": [0, drop + 0.1]}}}
        });
        for (k, v) in extra.as_object().into_iter().flatten() {
            w[k] = v.clone();
        }
        w
    }

    fn ask(call: Value) -> Value {
        Run::new(None).unwrap().answer(&call).unwrap()
    }

    #[test]
    fn a_2d_world_writes_its_contacts_and_its_rest_and_keys_by_rapier2d() {
        let w = drop_world(0.5, json!({}));
        let baked = ask(
            json!({"call": "bake", "world": w, "steps": 600, "read": ["ball"], "checkpoints": true}),
        );
        assert_eq!(baked["ok"], true, "{baked}");
        let rows = baked["occurrences"].as_array().unwrap();
        let of = |kind: &str| {
            rows.iter()
                .filter(|r| r["kind"] == kind)
                .collect::<Vec<_>>()
        };
        // It lands at √(2 × 9.81 × 0.5) = 3.13 m/s, above the 1 m/s a hit takes, then rests.
        let hit = of("hit")[0];
        assert_eq!((&hit["a"], &hit["b"]), (&json!("ball"), &json!("floor")));
        let speed = hit["speed"].as_f64().unwrap();
        assert!((speed - 3.13).abs() < 0.1, "{hit}");
        assert_eq!(hit["tags"], json!(["wood"]));
        assert!(
            !of("contact_begin").is_empty() && of("rest").len() == 1,
            "{rows:?}"
        );
        let last = &baked["bodies"]["ball"][600];
        assert!(
            (last["pos"][1].as_f64().unwrap() - 0.1).abs() < 0.01,
            "{last}"
        );
        assert_eq!(last["pos"][2], 0.0);
        assert_eq!(baked["checkpoints"][0]["backend"]["name"], "rapier2d");
        // The same steps again give the same hashes; and the key names rapier2d's build.
        let again = ask(json!({"call": "bake", "world": w, "steps": 600, "read": []}));
        assert_eq!(again["step_hashes"], baked["step_hashes"]);
        let run = Run::new(None).unwrap();
        assert_eq!(run.build_of(&w).backend.name, "rapier2d");
        assert_eq!(run.build_of(&json!({"dimensions": 3})), run.build);
        assert!(run.build_of(&w).pins.iter().any(|p| p.name == "parry2d"));
    }

    #[test]
    fn a_2d_world_caps_a_speed_aloud_and_refuses_what_reads_it_elsewhere() {
        let mut fast = drop_world(50.0, json!({"solver": {"max_speed": 5}}));
        fast["bodies"]["ball"]["velocity"] = json!({"linear": [0, -4.9]});
        let baked = ask(json!({"call": "bake", "world": fast, "steps": 10, "read": []}));
        let faults: Vec<&Value> = baked["occurrences"].as_array().unwrap().iter().collect();
        assert!(
            faults.iter().any(|r| r["kind"] == "fault"
                && r["fault"]["kind"] == "speed_cap"
                && r["a"] == "ball"),
            "{faults:?}"
        );
        let w = drop_world(0.5, json!({}));
        let audit = ask(json!({"call": "audit", "world": w, "steps": 10}));
        assert_eq!(audit["issues"][0]["code"], "physics.unsupported", "{audit}");
        let mut rod = drop_world(0.5, json!({}));
        rod["bodies"]["ball"]["shapes"][0]["shape"] = json!("line");
        let checked = ask(json!({"call": "check", "world": rod}));
        assert_eq!(
            checked["issues"][0]["path"], "bodies/ball/shapes/0/shape",
            "{checked}"
        );
    }

    #[test]
    fn a_checkpoint_of_the_other_backend_is_refused_naming_both() {
        let flat = drop_world(0.5, json!({}));
        let solid = json!({
            "kind": "physics.world@1",
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "shapes": {"s": {"kind": "sphere", "radius": 0.1}},
            "bodies": {"ball": {"kind": "dynamic", "shapes": [{"shape": "s"}], "mass": 1}}
        });
        let baked = ask(
            json!({"call": "bake", "world": solid, "steps": 60, "read": [], "checkpoints": true}),
        );
        let cp = baked["checkpoints"][0].clone();
        let reply = ask(json!({"call": "restore", "world": flat, "checkpoint": cp, "steps": 1}));
        assert_eq!(reply["code"], crate::CHECKPOINT_REFUSED, "{reply}");
        let what = reply["what"].as_str().unwrap();
        assert!(
            what.contains("rapier3d 0.36.1") && what.contains("rapier2d 0.36.1"),
            "{what}"
        );
        // A 2D world's own checkpoint loads, and the run goes on as the straight one did.
        let straight = ask(
            json!({"call": "bake", "world": flat, "steps": 120, "read": [], "checkpoints": true}),
        );
        let cp = straight["checkpoints"][0].clone();
        let on = ask(json!({"call": "restore", "world": flat, "checkpoint": cp, "steps": 60}));
        assert_eq!(on["step_hashes"][60], straight["step_hashes"][120], "{on}");
    }
}
