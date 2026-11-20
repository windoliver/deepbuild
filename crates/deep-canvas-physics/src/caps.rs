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
    /// Whether gear, rack, pulley and path joints run in dynamic mode.
    pub dynamic_couplings: bool,
    /// What it does that a world can't change, each as one sentence (World and backend).
    pub declared: &'static [&'static str],
    /// #191: the features it claims, each of [`CLAIMS`]; the behavior kit runs a fixture only on a
    /// backend that claims every cap the fixture names, and the check refuses a world needing one
    /// it doesn't claim.
    pub claims: &'static [&'static str],
    /// #2239: what its swept collision holds, which the check and the lint `physics.fast_body`
    /// read.
    pub sweep: Sweep,
}

/// #2239: what a backend's swept collision holds, as data, by body kind as a document writes it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Sweep {
    /// The kinds of body a sweep starts from; `ccd: true` on a kinematic or a static body it
    /// never starts from is refused.
    pub starts: &'static [&'static str],
    /// The kinds of body a sweep holds when the body that starts it has `ccd` off, and with it on.
    pub without_ccd: &'static [&'static str],
    pub with_ccd: &'static [&'static str],
    /// Whether a sweep with `ccd` on holds a body that has `ccd` on too, and one that is itself
    /// fast.
    pub holds_ccd: bool,
    pub holds_fast: bool,
    /// Whether a body with `ccd` on also predicts its contacts along its own move in a step, which
    /// holds a body in its path whatever that body's `ccd`, and reaches neither its own turn nor
    /// the other body's move.
    pub predicts: bool,
}

impl Sweep {
    /// Whether a sweep started by a fast body of `kind` holds the body `other`, given each one's
    /// `ccd` and whether the other is fast too.
    pub fn holds(
        &self,
        (kind, ccd): (&str, bool),
        (other, other_ccd, other_fast): (&str, bool, bool),
    ) -> bool {
        let reached = if ccd { self.with_ccd } else { self.without_ccd };
        self.starts.contains(&kind)
            && reached.contains(&other)
            && (self.holds_ccd || !other_ccd)
            && (self.holds_fast || !other_fast)
    }
}

/// #191: the features a backend's caps may claim: swept collision for a body with `ccd`, soft
/// bodies, a character controller, (#251) a vehicle controller, (#2241) belts, a contact
/// material's `tangent_speed`, and (#2310) articulations, the joints of one tree placed from
/// their own coordinates.
pub const CLAIMS: [&str; 6] = [
    "ccd",
    "soft_bodies",
    "character_controller",
    "vehicle_controller",
    "belts",
    "articulations",
];

/// Rapier 0.36.1 in 3D, as the design pins it.
pub const RAPIER3D: Caps = Caps {
    backend: "rapier3d",
    version: "0.36.1",
    features: &["enhanced-determinism", "serde-serialize"],
    excluded: &["simd8", "parallel"],
    dimensions: 3,
    restitution_threshold: false,
    rolling_resistance: false,
    dynamic_couplings: false,
    declared: &[
        "Each substep caps a body's linear speed at solver.max_speed and its turn at about 45° a step; a step it caps writes fault {kind: speed_cap}.",
        "It has no restitution threshold: a new contact bounces at any approach speed.",
        "A joint's impulses are its last substep's; a contact's reported impulse sums every substep.",
        "A balloon or a soft volume holds inflate times its rest volume, since it takes no pressure; its volume constraint runs at 8 times its stretch's frequency, so its edges can't hold it smaller.",
        "It has no rolling resistance; a ball that should roll to rest takes angular damping.",
        "It runs gear, rack, pulley and path joints only in kinematic mode.",
        "A contact with restitution 1 or more never comes to rest.",
        "A contact is a spring at solver.contact_hz, twice that against a static body, so a resting body sinks g ÷ (2π × f)² under its own weight at the frequency f of its contact, and a stack sinks by its loads.",
        "Only a dynamic body starts a sweep: with ccd off it sweeps fixed shapes only, and with ccd on it also holds a body that moves or rests, but only one that has ccd off and is not itself fast.",
        "A body with ccd on also predicts its contacts along its own move in a step, which holds a body in its path whatever that body's ccd, and reaches neither its own turn nor the other body's move.",
        "An articulated joint's turning coordinates are damped at 0.1 N·m·s/rad, the engine's own, which no world field sets; a sliding one's aren't.",
        "A body an articulated joint holds moves by its joints' coordinates alone: a velocity written on it, a launch and a poke are refused, and a grab's force moves it.",
    ],
    claims: &["ccd", "soft_bodies", "character_controller", "vehicle_controller", "belts", "articulations"],
    sweep: Sweep {
        starts: &["dynamic"],
        without_ccd: &["static"],
        with_ccd: &["static", "kinematic", "dynamic"],
        holds_ccd: false,
        holds_fast: false,
        predicts: true,
    },
};
