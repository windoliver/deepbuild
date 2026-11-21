//! The scene3d canvas module's R2 subset (issue #378): see the crate manifest.

pub mod arrays;
pub mod attrs;
pub mod bevel;
pub mod bind;
pub mod build;
pub mod builders;
pub mod building;
pub mod cloud;
pub mod clusters;
pub mod contributed;
pub mod curve;
pub mod cut;
pub mod deviation;
pub mod distribute;
pub mod dof;
pub mod emitters;
pub mod faces;
pub mod field;
pub mod fixtures;
pub mod flare;
pub mod flow;
pub mod frames;
/// The look's finish in f64, which the look module owns (#418).
pub use deep_canvas_marks::finish;
pub mod geom;
pub mod gltf;
pub mod gpu;
pub mod history;
pub mod horizon;
pub mod hit;
pub mod hull;
pub mod ies;
pub mod inset;
pub mod label;
pub mod lens;
pub mod light;
pub mod lod;
pub mod look;
pub mod measure;
pub mod measures;
pub mod mirror;
pub mod modifiers;
pub mod module;
pub mod overlay;
pub mod pointer;
pub mod points;
pub mod poly;
pub mod probe;
pub mod rest;
pub mod samples;
pub mod scene;
pub mod sets;
pub mod shapes;
pub mod shore;
pub mod skin;
pub mod sky;
pub mod slots;
pub mod spatial;
pub mod spec;
pub mod stack;
pub mod strokes;
pub mod surface;
pub mod sweep;
pub mod terrain;
pub mod tints;
pub mod trail;
pub mod tree;
pub mod uv;
pub mod vars;
pub mod views;
pub mod water;

/// The wrong programs #420's, #441's and #440's criteria plant in scene3d's and the building
/// module's operators, each reachable only through a proof surface's `planted`.
pub const PLANTED: [&str; 56] = [
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
    // #2013: a scatter whose sampler stops after 10 points.
    distribute::STOPS_AFTER_10,
    // #2014: a terrain builder that splits each cell along its other diagonal, and a size cap read
    // in metres.
    terrain::OTHER_DIAGONAL,
    terrain::CAP_IN_METRES,
    // #224: grid lines counted from the range's start, a mesher numbering vertices by thread,
    // an octree dropping cells by their corners' signs or stopping mid-level, and a build that
    // keeps its first mesh.
    surface::PLANTS[0],
    surface::PLANTS[1],
    surface::PLANTS[2],
    surface::PLANTS[3],
    surface::PLANTS[4],
    // #1636: a tree whose children keep their parent's radius, and one framed by curvature.
    "tree_child_keeps_parent_radius",
    "tree_curvature_frames",
    // #1781: a mesh that keeps its attributes as f32; a subdivide that keeps a corner attribute
    // by point, gives an edge's point one end's value, averages whole numbers, or builds without
    // an edge attribute; and a store that ignores `on`, or leaves a non-finite element as it was.
    attrs::KEPT_AS_F32,
    "subdivide_corners_per_point",
    "subdivide_edge_copies_end",
    "subdivide_averages_whole",
    "subdivide_drops_edge_attrs",
    "store_ignores_on",
    "store_nonfinite_keeps_earlier",
    // #1928: the offsets and dissolves its criteria plant.
    faces::PLANTED[0],
    faces::PLANTED[1],
    faces::PLANTED[2],
    faces::PLANTED[3],
    faces::PLANTED[4],
    faces::PLANTED[5],
    faces::PLANTED[6],
    faces::PLANTED[7],
    faces::PLANTED[8],
    // #1929: a box deform over the item's own bounds, by trilinear cells, without its last point
    // or clamping outside vertices; a mesh deform by inverse distance, binding every frame, keyed
    // without its control mesh or extrapolating outside vertices.
    bind::PLANTS[0],
    bind::PLANTS[1],
    bind::PLANTS[2],
    bind::PLANTS[3],
    bind::PLANTS[4],
    bind::PLANTS[5],
    bind::PLANTS[6],
    bind::PLANTS[7],
    // #1217: the measure tool that ignores `shown_at`, and the one that writes an input entry.
    measure::PLANTED[0],
    measure::PLANTED[1],
];
