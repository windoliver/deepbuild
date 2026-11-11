//! The physics module as this build holds it (issue #1920): `physics@1` on the Rapier backend it
//! links, its pins as cargo resolved them. Under `test-physics-rapier-patch`, the #1920
//! acceptance README's test build, it is the same module with rapier3d's pin moved one patch and
//! nothing else changed.

use deep_canvas::registry::Module;

/// The physics module this build holds.
pub fn module() -> Module {
    let mut build = deep_physics_rapier::build();
    if cfg!(feature = "test-physics-rapier-patch") {
        build.backend.version = "0.36.2".into();
    }
    deep_canvas_physics::module::module(&build)
}
