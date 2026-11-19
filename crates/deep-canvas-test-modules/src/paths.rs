//! `test.paths` 1.0.0 (#2776's acceptance README: Test canvas modules and features of deep-show):
//! three kinds, each `{size: [m, m, m] = [1, 1, 1]}`, drawn as scene3d's box mark through the core's
//! fills, so each puts a box's shape and shading into the 3D frame and the seal holds it to the
//! paths rule; with the answers the README gives, and the fixture `glow`, a scene holding one glow.
//! `paths(true)` is the planted twin whose `test.paths.mist@1` gives no answer for a final.

use deep_canvas::contributed::{Mark, Request};
use deep_canvas::kinds::{Param, ParamType};
use deep_canvas::outline::Refusal;
use deep_canvas::registry::{Module, Registrar};
use serde_json::{json, Value};

use crate::{kind, manifest};

/// Each kind's three answers, as the README's table gives them.
const ANSWERS: &str = r##"{
  "test.paths.glow@1": {
    "section": "Test paths",
    "rays": {"answer": "same", "held_by": "test.paths/glow"},
    "final": {"answer": "not_applicable", "why": "drawn after lighting, as in the real-time export"},
    "web": {"answer": "refused", "code": "test.paths.no_web"}
  },
  "test.paths.halo@1": {
    "section": "Test paths",
    "rays": {"answer": "refused", "code": "path_undefined", "task": "#2759"},
    "final": {"answer": "refused", "code": "path_undefined", "task": "#2759"},
    "web": {"answer": "stand_in", "draws": "nothing, the web player leaves the halo out", "receipt": "halo left out"}
  },
  "test.paths.mist@1": {
    "section": "Test paths",
    "rays": {"answer": "refused", "code": "path_undefined", "task": "#2759"},
    "final": {"answer": "refused", "code": "path_undefined", "task": "#2759"},
    "web": {"answer": "refused", "code": "path_undefined", "task": "#2759"}
  }
}"##;

/// `test.paths`, each kind with its three answers; with `no_final`, the planted module whose
/// `test.paths.mist@1` declares rays and web and no final.
pub fn paths(no_final: bool) -> Module {
    Module {
        manifest: manifest("test.paths", &[("scene3d", false)]),
        register: if no_final {
            register_no_final
        } else {
            register
        },
    }
}

fn register(r: &mut Registrar) {
    kinds(r);
    r.paths(ANSWERS);
}

fn register_no_final(r: &mut Registrar) {
    kinds(r);
    let mut answers: Value = serde_json::from_str(ANSWERS).unwrap_or_default();
    if let Some(mist) = answers["test.paths.mist@1"].as_object_mut() {
        mist.remove("final");
    }
    r.paths(&answers.to_string());
}

/// The three kinds, each drawn as a box of its size, and the fixture `glow`.
fn kinds(r: &mut Registrar) {
    let size = || Param {
        name: "size",
        ty: ParamType::Json("[m, m, m]"),
        unit: "m",
        default: json!([1, 1, 1]),
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    };
    for (name, full) in [
        ("glow", "test.paths.glow@1"),
        ("halo", "test.paths.halo@1"),
        ("mist", "test.paths.mist@1"),
    ] {
        r.kind(kind("test.paths", name, vec![size()]), &[], "");
        r.marks3d(full, as_box);
    }
    r.fixture("glow", glow(), None);
}

/// An item of the module's kinds, drawn as one box of its size.
fn as_box(req: &Request<'_, '_>) -> Result<Vec<Mark>, Refusal> {
    let size = req
        .value
        .pointer("/params/size")
        .cloned()
        .unwrap_or_else(|| json!([1, 1, 1]));
    Ok(vec![Mark {
        sub: "box".into(),
        kind: "mark.box@1",
        at: [0.0; 3],
        params: json!({"size": size}),
        opacity: 1.0,
    }])
}

/// A scene holding one glow on a floor, under a camera.
fn glow() -> Value {
    json!({
        "format": 1, "id": "01JB2776F00000000000000001", "profile": "scene", "title": "A glow",
        "description": "One glow, a box of light, on a floor.", "size": [320, 180], "camera": "cam",
        "seed": 2776, "requires": {"modules": {"scene3d": "^1", "test.paths": "^1"}},
        "items": {
            "cam": {"id": "cam", "kind": "camera@1", "name": "Camera", "order": "a0",
                    "params": {"projection": "perspective", "position": [0, 1.5, 4], "target": [0, 0.25, 0], "fov": 40}},
            "floor": {"id": "floor", "kind": "mark.box@1", "name": "Floor", "order": "a1",
                      "params": {"size": [4, 0.1, 4]}, "at": {"pos": [0, -0.05, 0]}},
            "glow": {"id": "glow", "kind": "test.paths.glow@1", "name": "Glow", "order": "a2",
                     "params": {"size": [0.5, 0.5, 0.5]}, "at": {"pos": [0, 0.25, 0]}}
        }
    })
}
