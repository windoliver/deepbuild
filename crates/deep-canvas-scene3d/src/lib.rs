//! The scene3d canvas module's R2 subset (issue #378): see the crate manifest.

pub mod build;
pub mod builders;
pub mod building;
pub mod curve;
pub mod frames;
/// The look's finish in f64, which the look module owns (#418).
pub use deep_canvas_marks::finish;
pub mod geom;
pub mod gltf;
pub mod label;
pub mod look;
pub mod modifiers;
pub mod module;
pub mod overlay;
pub mod scene;
pub mod spec;
pub mod stack;

/// The wrong programs #420's criteria plant in scene3d's and the building module's operators,
/// each reachable only through a proof surface's `planted`.
pub const PLANTED: [&str; 7] = [
    "torus_genus_0",
    "vertex_count_off_by_one",
    "cap_left_open",
    "ball_scaled",
    "flat_as_smooth",
    "slab_size_as_shading",
    "keeps_disabled_refs",
];
