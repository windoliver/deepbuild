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

/// #191's test backends by name.
pub const TEST_BACKENDS: [TestBackend; 8] = [
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
    /// assumption row; refused, naming the body, when the expansion leaves one off.
    fn expand(&self, call: &Value) -> Value {
        let source = call.get("world").cloned().unwrap_or(Value::Null);
        let steps = call
            .get("steps")
            .and_then(Value::as_u64)
            .or_else(|| source["step_rate"].as_u64())
            .unwrap_or(120);
        let baked = self
            .answer(&json!({"call": "bake", "world": source, "steps": steps, "read": []}))
            .unwrap_or_else(|| json!({"ok": false, "code": "bad_input"}));
        if baked["ok"] != true {
            return baked;
        }
        let flagged: BTreeMap<String, Flag> = baked["issues"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|i| i["code"] == fast::FAST_BODY)
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
        let refused = fast::refused(&source, &world, &flagged);
        if refused.is_empty() {
            json!({"ok": true, "world": world, "assumptions": assumptions})
        } else {
            json!({"ok": false, "issues": refused, "world": world, "assumptions": assumptions})
        }
    }
}
