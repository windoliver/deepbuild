//! What a backend can run, as data the document check reads (World and backend: `caps()` decides
//! what the document check refuses). A backend's `caps()` returns one of these; the check holds a
//! world to it by field, naming the field and the backend.

/// A backend's caps and its declared gaps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Caps {
    /// The backend's name, as a world's `backend.name` writes it.
    pub backend: &'static str,
    /// The pinned version, with no `=`.
    pub version: &'static str,
    pub features: &'static [&'static str],
    pub excluded: &'static [&'static str],
    pub dimensions: u8,
    /// Whether it bounces only above a speed; else `solver.restitution_threshold` must be 0.
    pub restitution_threshold: bool,
    pub rolling_resistance: bool,
    pub tangent_speed: bool,
    /// Whether gear, rack, pulley and path joints run in dynamic mode.
    pub dynamic_couplings: bool,
    /// What it does that a world can't change, each as one sentence (World and backend).
    pub declared: &'static [&'static str],
}

/// Rapier 0.36.1 in 3D, as the design pins it.
pub const RAPIER3D: Caps = Caps {
    backend: "rapier3d",
    version: "0.36.1",
    features: &["enhanced-determinism", "serde-serialize"],
    excluded: &["simd8", "parallel"],
    dimensions: 3,
    restitution_threshold: false,
    rolling_resistance: false,
    tangent_speed: false,
    dynamic_couplings: false,
    declared: &[
        "Each substep caps a body's linear speed at solver.max_speed and its turn at about 45° a step; a step it caps writes fault {kind: speed_cap}.",
        "It has no restitution threshold: a new contact bounces at any approach speed.",
        "A joint's impulses are its last substep's; a contact's reported impulse sums every substep.",
        "A balloon holds its volume by its inflate ratio, since it takes no pressure.",
        "It has no rolling resistance or tangent speed; a ball that should roll to rest takes angular damping.",
        "It runs gear, rack, pulley and path joints only in kinematic mode.",
        "A contact with restitution 1 or more never comes to rest.",
    ],
};
