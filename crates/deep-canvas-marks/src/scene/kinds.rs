/// The kinds [`super::frame`] reads: every other kind is one the marks module doesn't know.
pub const KINDS: &[&str] = &[
    "rect@1",
    "circle@1",
    "path@1",
    "text@1",
    "image@1",
    "marks@1",
    "axis@1",
    "scale@1",
    "mask@1",
    "group@1",
    "star@1",
    "frame@1",
    "series@1",
    "matte@1",
    "axes3d@1",
    "vector_field@1",
    "grid_image@1",
];

/// The kinds of [`KINDS`] the data module owns: R1's mark sets, scales and axes, which marks2d
/// draws for it (the data module's manifest). A build without the data module lacks them.
pub const DATA_KINDS: &[&str] = &[
    "marks@1",
    "axis@1",
    "scale@1",
    "axes3d@1",
    "vector_field@1",
    "grid_image@1",
];

/// The canvas module that owns one of [`KINDS`]: the data module's, or marks2d's.
pub fn module_of(kind: &str) -> &'static str {
    if DATA_KINDS.contains(&kind) {
        "data"
    } else {
        "marks2d"
    }
}
