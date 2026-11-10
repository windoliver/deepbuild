//! The scene3d canvas module's R2 subset (issue #378): see the crate manifest.

pub mod bevel;
pub mod build;
pub mod builders;
pub mod building;
pub mod clusters;
pub mod curve;
pub mod cut;
pub mod deviation;
pub mod emitters;
pub mod fixtures;
pub mod flare;
pub mod frames;
/// The look's finish in f64, which the look module owns (#418).
pub use deep_canvas_marks::finish;
pub mod geom;
pub mod gltf;
pub mod gpu;
pub mod hull;
pub mod ies;
pub mod label;
pub mod light;
pub mod lod;
pub mod mirror;
pub mod look;
pub mod modifiers;
pub mod module;
pub mod overlay;
pub mod poly;
pub mod probe;
pub mod samples;
pub mod scene;
pub mod sets;
pub mod shore;
pub mod sky;
pub mod spatial;
pub mod spec;
pub mod stack;
pub mod sweep;
pub mod uv;
pub mod water;

/// The wrong programs #420's, #441's and #440's criteria plant in scene3d's and the building
/// module's operators, each reachable only through a proof surface's `planted`.
pub const PLANTED: [&str; 20] = [
    "torus_genus_0",
    "vertex_count_off_by_one",
    "cap_left_open",
    "ball_scaled",
    "flat_as_smooth",
    "slab_size_as_shading",
    "keeps_disabled_refs",
    "seam_twist_left",
    "sweep_frenet",
    "corner_square",
    "u_by_span",
    "quads_keep_diagonals",
    "cage_reads_subdivided",
    "hull_keeps_face_points",
    "hull_fan_input_order",
    "subdivide_first_corner",
    "bevel_drops_wear",
    "bevel_faces_unparted",
    // #443: an outline reader that ignores the fill rule, and an extrude that sets each glyph at
    // its own advance.
    "outline_ignores_fill_rule",
    "extrude_own_advance",
];
