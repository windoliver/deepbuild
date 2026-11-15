//! The input canvas module (technical design: Canvas modules, the `input` row): `input@1`'s
//! implementation. It declares `control@1` and fills it with the core control kinds, each with
//! the fixture its kit reads at the seal.

use deep_canvas::registry::{Implementation, Manifest, Module, Range, Registrar, Semver};

use crate::kit;
use crate::session::Planted;

pub const NAME: &str = "input";
pub const INTERFACE: &str = "input@1";

fn manifest() -> Manifest {
    Manifest {
        name: NAME.into(),
        version: Semver {
            major: 1,
            minor: 0,
            patch: 0,
        },
        core: Range::parse("*").expect("a range"),
        depends_on: Default::default(),
        feature: NAME.into(),
        license: "Apache-2.0".into(),
        implements: INTERFACE.into(),
        implementation: Implementation::reference(NAME, Semver::parse("1.0.0").expect("a version")),
    }
}

/// The input module.
pub fn module() -> Module {
    Module {
        manifest: manifest(),
        register,
    }
}

/// The input module with a planted program, whose `control@1` entry the kit refuses at the
/// seal: `drag_along` computing its entry again from the camera at replay, or the parameter tool
/// stamping its entry as yours.
pub fn planted(name: &str) -> Option<Module> {
    let register: fn(&mut Registrar) = match name {
        "drag_along_recompute" => |r| {
            register_with(r, |kind| Planted {
                recompute: kind == "drag_along",
                ..Planted::default()
            })
        },
        "tool_stamps_you" => |r| {
            register_with(r, |_| Planted {
                tool_stamps_you: true,
                ..Planted::default()
            })
        },
        _ => return None,
    };
    Some(Module {
        manifest: manifest(),
        register,
    })
}

fn register(r: &mut Registrar) {
    register_with(r, |_| Planted::default());
}

fn register_with(r: &mut Registrar, planted: fn(&str) -> Planted) {
    r.registry(kit::registry());
    for (name, value) in kit::entries(planted) {
        r.entry(kit::REGISTRY, name, value, "R6");
    }
}

/// The input module with one more kind, `test.dial`, a number control the kit runs as it runs
/// the core kinds, for the kit's proof (`test-control-kind`); `planted` names its wrong program:
/// `recompute` (computed again from the camera at replay), `reads_modifiers` (read at the
/// frame), `no_keyboard` or `agent_input`. No shipped build holds it.
pub fn with_test_kind(planted: &str) -> Module {
    let register: fn(&mut Registrar) = match planted {
        "recompute" => |r| {
            register_dial(
                r,
                Planted {
                    recompute: true,
                    ..Planted::default()
                },
            )
        },
        "reads_modifiers" => |r| {
            register_dial(
                r,
                Planted {
                    reads_modifiers: true,
                    ..Planted::default()
                },
            )
        },
        "no_keyboard" => |r| {
            register_dial(
                r,
                Planted {
                    no_keyboard: true,
                    ..Planted::default()
                },
            )
        },
        "agent_input" => |r| {
            register_dial(
                r,
                Planted {
                    agent_input: true,
                    ..Planted::default()
                },
            )
        },
        _ => |r| register_dial(r, Planted::default()),
    };
    Module {
        manifest: manifest(),
        register,
    }
}

fn register_dial(r: &mut Registrar, planted: Planted) {
    register(r);
    let value = kit::entry("test.dial", crate::session::Behavior::Number, planted);
    r.entry(kit::REGISTRY, "test.dial", value, "R6");
}
