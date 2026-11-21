//! #191: the physics interface's behavior part on this build's backend, over the runner's JSON
//! lines (tests/acceptance/191/README.md: The surface under test). `backend` names the backend,
//! whether it is the reference, its caps() as cap names and any tolerances it declares;
//! `behavior_fixtures` answers the interface's fixtures as data; `behavior_kit` runs them on fresh
//! backends through the backend interface only; and `expand` turns `ccd` on for each body
//! physics.fast_body flags. In a `test-backends` build, `--backend <name>` runs one of the test
//! backends below, each Rapier wrong one way, as a candidate under caps of its own.

use std::collections::BTreeMap;

use deep_canvas_physics::backend::Backend;
use deep_canvas_physics::caps::{Caps, RAPIER3D};
use deep_canvas_physics::fast::{self, Flag};
use deep_canvas_physics::kit::{self, Planted};
use serde_json::{json, Value};

use super::Run;
use crate::{Rapier, Twin};

/// A test backend's caps: Rapier's, without soft bodies, which no fixture tests yet.
const TEST_CAPS: Caps = Caps {
    claims: &["ccd"],
    ..RAPIER3D
};
/// The same with swept collision left out too (criterion 4).
const NO_CCD_CAPS: Caps = Caps {
    claims: &[],
    ..RAPIER3D
};
/// #182: a test backend's caps with Rapier's character controller.
const CHARACTER_CAPS: Caps = Caps {
    claims: &["ccd", "character_controller"],
    ..RAPIER3D
};
/// #182: a test backend with no character controller, under its own name, so a refusal by its
/// caps names it.
const NO_CHARACTER_CAPS: Caps = Caps {
    backend: "no_character_controller",
    ..TEST_CAPS
};
/// #251: a test backend with no vehicle controller, under its own name, so a refusal by its caps
/// names it.
const NO_VEHICLE_CAPS: Caps = Caps {
    backend: "no_vehicle_controller",
    ..TEST_CAPS
};
/// #2241: a test backend that leaves belts out of its caps, under its own name, so a refusal by
/// its caps names it.
const NO_BELTS_CAPS: Caps = Caps {
    backend: "no_belts",
    ..TEST_CAPS
};

/// #2308: a test backend whose caps say it scales no lengths, under its own name, so a refusal
/// by its caps names it.
const NO_LENGTH_CAPS: Caps = Caps {
    backend: "no_length_unit",
    scales_lengths: false,
    ..TEST_CAPS
};

/// A test backend: Rapier running `twin`, under `caps`, declaring `tolerances` of its own.
pub struct TestBackend {
    pub name: &'static str,
    pub twin: Twin,
    pub caps: &'static Caps,
    pub tolerances: Option<&'static str>,
}

const fn test(name: &'static str, twin: Twin, caps: &'static Caps) -> TestBackend {
    TestBackend {
        name,
        twin,
        caps,
        tolerances: None,
    }
}

/// #191's test backends by name, and #251's, #182's, #2241's, #2243's and #2308's.
pub const TEST_BACKENDS: [TestBackend; 17] = [
    test("friction_average", Twin::FrictionAverage, &TEST_CAPS),
    test("no_joint_limits", Twin::NoJointLimits, &TEST_CAPS),
    test("restitution_min", Twin::RestitutionMin, &TEST_CAPS),
    test("drops_cap", Twin::None, &NO_CCD_CAPS),
    test("query_ignores_groups", Twin::QueryIgnoresGroups, &TEST_CAPS),
    test("rapier_caps", Twin::None, &RAPIER3D),
    test("no_soft_bodies", Twin::None, &TEST_CAPS),
    TestBackend {
        name: "loose_tolerance",
        twin: Twin::GravityOff2,
        caps: &TEST_CAPS,
        tolerances: Some(r#"{"free_fall": {"relative": 0.05}}"#),
    },
    test("no_vehicle_controller", Twin::None, &NO_VEHICLE_CAPS),
    test("no_belts", Twin::None, &NO_BELTS_CAPS),
    // #182: no character controller in its caps; one climbing steps a quarter higher than its
    // step height; one ignoring snap; one whose ground distance is 0.001 m; and one ignoring a
    // launch off the ground.
    test("no_character_controller", Twin::None, &NO_CHARACTER_CAPS),
    test("steps_too_high", Twin::StepsHigher, &CHARACTER_CAPS),
    test("ignores_snap", Twin::IgnoresSnap, &CHARACTER_CAPS),
    test("ground_distance_1mm", Twin::GroundNear, &CHARACTER_CAPS),
    test(
        "ignores_launch_airborne",
        Twin::LaunchGroundedOnly,
        &CHARACTER_CAPS,
    ),
    // #2243: one that leaves each moved character body's pose stale until the backend's step.
    test("stale_character_poses", Twin::StalePoses, &CHARACTER_CAPS),
    test("no_length_unit", Twin::None, &NO_LENGTH_CAPS),
];

/// The test backend named `name`, in a `test-backends` build only.
pub fn test_backend(name: &str) -> Option<&'static TestBackend> {
    TEST_BACKENDS
        .iter()
        .find(|t| t.name == name)
        .filter(|_| cfg!(feature = "test-backends"))
}

/// The planted programs this file runs: two planted kits, two planted backend wrappers over Rapier
/// and the planted recipe.
pub const PLANTED: [&str; 5] = [
    "kit_runs_excluded",
    "kit_admits_unfixtured",
    "pair_filter_default",
    "swept_collision_off",
    "recipe_leaves_ccd_off",
];

/// Plants `name`, one of [`PLANTED`], in `run`; false for another name.
pub fn planted(name: &str, run: &mut Run) -> bool {
    match name {
        "kit_runs_excluded" => run.kit_planted = Planted::RunsExcluded,
        "kit_admits_unfixtured" => run.kit_planted = Planted::AdmitsUnfixtured,
        "pair_filter_default" => run.twin = Twin::DefaultPairFilter,
        "swept_collision_off" => run.twin = Twin::NoSweep,
        "recipe_leaves_ccd_off" => run.leave_ccd_off = true,
        _ => return false,
    }
    true
}

/// The interface's fixtures, with the test fixture in a `test-backends` build.
fn fixtures() -> Vec<kit::Fixture> {
    let mut all = kit::all();
    if cfg!(feature = "test-backends") {
        all.push(kit::test_capped());
    }
    all
}

impl Run {
    /// The runner on test backend `name`, or `None` for a name this build has none of.
    pub fn with_backend(mut self, name: &str) -> Option<Self> {
        let t = test_backend(name)?;
        if t.twin != Twin::None {
            self.twin = t.twin;
        }
        (self.test, self.caps) = (Some(t), *t.caps);
        // #2308's planted check reads the range of solver.length_unit alone.
        self.caps.scales_lengths |= self.twin == Twin::Small(super::contact::Small::RangeOnly);
        Some(self)
    }

    fn backend(&self) -> Rapier {
        Rapier {
            twin: self.twin,
            test: self.test.map(|t| (t.name, t.caps)),
            ..Rapier::default()
        }
    }

    /// The reply to one of #191's calls, or `None` for another call.
    pub(super) fn kit_call(&self, call: &Value) -> Option<Value> {
        Some(match call.get("call")?.as_str()? {
            "backend" => {
                let b = self.backend();
                let name = b.id().split('@').next().unwrap_or_default().to_string();
                let mut reply = json!({"ok": true, "backend": name, "reference": name == kit::REFERENCE, "caps": b.caps().claims});
                if let Some(t) = self.test.and_then(|t| t.tolerances) {
                    reply["tolerances"] = serde_json::from_str(t).unwrap_or(Value::Null);
                }
                reply
            }
            "behavior_fixtures" => {
                json!({"ok": true, "fixtures": fixtures().iter().map(kit::Fixture::json).collect::<Vec<_>>()})
            }
            "behavior_kit" => {
                let new = || -> Box<dyn Backend> { Box::new(self.backend()) };
                let mut reply = kit::run(&new, &fixtures(), self.kit_planted).json();
                reply["ok"] = json!(true);
                reply["target"] = json!(self.build.target);
                reply
            }
            "expand" => self.expand(call),
            _ => return None,
        })
    }

    /// #191's default for fast bodies: `world` baked over `steps` (1 s at its rate by default), each
    /// body physics.fast_body flags that leaves `ccd` unset turned to `ccd: true` with an
    /// assumption row; refused, naming the body, when the expansion leaves one off. #2239: `world`
    /// is a document, or with `scene` the ID of a world the scene lists; only a fast dynamic body
    /// gets a row, a kinematic body and a pair keeping their issues for the playtest run that
    /// bakes the world; and the world the kit writes is checked as any other.
    fn expand(&self, call: &Value) -> Value {
        let listed = call.get("scene").and_then(|_| call["world"].as_str());
        let source = match listed {
            Some(id) => call["scene"]["worlds"][id].clone(),
            None => call.get("world").cloned().unwrap_or(Value::Null),
        };
        let steps = call
            .get("steps")
            .and_then(Value::as_u64)
            .or_else(|| source["step_rate"].as_u64())
            .unwrap_or(120);
        let mut ask = call.clone();
        (ask["call"], ask["steps"], ask["read"]) = (json!("bake"), json!(steps), json!([]));
        let bad = || json!({"ok": false, "code": "bad_input"});
        let baked = self.answer(&ask).unwrap_or_else(bad);
        if baked["ok"] != true {
            return baked;
        }
        let flagged: BTreeMap<String, Flag> = baked["issues"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i["code"] == fast::FAST_BODY)
            .filter(|i| i.get("kind").is_none() || self.ccd_on_kinematic)
            .filter_map(|i| {
                let f = Flag {
                    step: i["step"].as_u64()?,
                    moved: i["move"].as_f64()?,
                    half: i["half_extent"].as_f64()?,
                };
                Some((i["body"].as_str()?.to_string(), f))
            })
            .collect();
        let (world, assumptions) = fast::expand(&source, &flagged, self.leave_ccd_off);
        let mut refused = fast::refused(&source, &world, &flagged);
        ask["call"] = json!("check");
        match listed {
            Some(id) => ask["scene"]["worlds"][id] = world.clone(),
            None => ask["world"] = world.clone(),
        }
        let checked = self.answer(&ask).unwrap_or_else(bad);
        let errors = checked["issues"].as_array().into_iter().flatten();
        refused.extend(errors.filter(|i| i["severity"] == "error").cloned());
        if refused.is_empty() {
            json!({"ok": true, "world": world, "assumptions": assumptions})
        } else {
            json!({"ok": false, "issues": refused, "world": world, "assumptions": assumptions})
        }
    }
}
