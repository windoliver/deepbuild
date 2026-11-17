//! The player's module set: the shipped canvas modules its build's set carries (#1490: figure,
//! game2d or full), sealed beside the web's seam backends. Its digest is the receipt's
//! `player.module_set_digest`; a document that needs a module outside it is refused at export,
//! naming the module.

use deep_canvas::registry::{BuildSet, Module, Registry, Sealed};

/// The canvas modules the player carries: its set's shipped modules. The full set is the full
/// build set's, less those whose work runs only in the app (the net module's relay and Join, which
/// #1042 brings to the player).
pub fn modules() -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out = vec![
        deep_canvas_marks::modules::text(),
        deep_canvas_marks::modules::look(),
        deep_canvas_marks::modules::marks2d(),
        deep_canvas_marks::modules::data(),
        deep_canvas_motion::module::module(),
        deep_canvas_input::module::module(),
    ];
    #[cfg(feature = "game2d")]
    {
        out.push(physics());
        out.push(deep_canvas_sandbox::module::module());
        // Logic on sandbox, binding physics.cast@1 for the items that ask it between steps (#213),
        // as the app's full set does.
        deep_logic::module::bind_services(deep_play::cast::bound);
        out.push(deep_logic::module::module());
    }
    #[cfg(feature = "full")]
    out.extend([
        deep_canvas_graph::module::module(),
        deep_canvas_record::module::module(),
        deep_canvas_sheet::module::module(),
        deep_canvas_cells::module::module(),
        deep_canvas_scene3d::module::module(),
        deep_canvas_effects::module::module(),
        deep_canvas_vector::module::module(),
        deep_canvas_scene3d::building::module(),
        deep_canvas_loop::module(),
        deep_canvas_media::module::module(),
    ]);
    out
}

/// The physics module on the pinned backend, with its `physics.cast@1` entry, as the app seals it.
#[cfg(feature = "game2d")]
fn physics() -> Module {
    let mut m = deep_canvas_physics::module::module(&deep_physics_rapier::build());
    m.register = |r| {
        (deep_canvas_physics::module::module(&deep_physics_rapier::build()).register)(r);
        deep_play::cast::register(r);
    };
    m
}

/// The web's seam backends the seal holds beside the modules.
fn backends() -> Vec<Module> {
    use deep_canvas_seams::module;
    vec![
        module("fonts", "seam.fonts", deep_text::FONTS),
        module("cpu", "seam.cpu", deep_canvas_seams::cpu("wasm32")),
        module("headless", "seam.headless", deep_canvas_seams::HEADLESS),
    ]
}

/// The player's sealed set.
pub fn sealed() -> Result<Sealed, String> {
    let mut registry = Registry::new(BuildSet::Full);
    for b in backends() {
        registry = registry.backend(b);
    }
    for m in modules() {
        registry = registry.with(m);
    }
    registry
        .seal()
        .map_err(|e| format!("{}: {}", e.code, e.what))
}
