//! Issue #446: the light policy's shadow fields (soft, contact and local shadows).

use super::*;

/// PCSS or Castaño's filter (Light policy: soft shadows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Soft {
    pub pcss: bool,
    pub blocker_taps: u32,
    pub filter_taps: u32,
    /// The most a penumbra spreads, in shadow map texels.
    pub max_penumbra: f64,
}

/// Screen-space contact shadows for the key light.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub length: f64,
    pub samples: u32,
}

/// The light policy's shadow fields (Light policy: soft shadows, local shadows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadowing {
    pub soft: Option<Soft>,
    pub contact: Option<Contact>,
    pub spots: usize,
    /// Point lights and area lights with a shadow.
    pub points: usize,
    /// A spot's map's side and each cube face's, in texels.
    pub local_map: u32,
    /// `cache: static`: a map holds until its key changes.
    pub cache: bool,
    /// `per_cluster` (#1634): the fill lights a cluster shades at most.
    pub per_cluster: usize,
    /// Shadow tiles (#2034): `shadowed.local: auto` past the fixed counts, decided once per
    /// document from its declared lights. Every shaded key light with a shadow keeps one.
    pub tiles: bool,
}

/// The most spots a policy may shadow; points take four, which the budget class never raises.
pub const MOST_SPOTS: usize = 8;
pub const MOST_POINTS: usize = 4;

impl Default for Shadowing {
    /// A document that names no `light_policy`: the key sun's tent alone, as before it had one.
    fn default() -> Shadowing {
        Shadowing {
            soft: None,
            contact: None,
            spots: 0,
            points: 0,
            local_map: 512,
            cache: true,
            per_cluster: PER_CLUSTER,
            tiles: false,
        }
    }
}

impl Shadowing {
    /// A `light_policy`'s fields before it names any: PCSS and two shadowed spots.
    pub fn named() -> Shadowing {
        Shadowing {
            soft: Some(Soft {
                pcss: true,
                blocker_taps: 16,
                filter_taps: 16,
                max_penumbra: 32.0,
            }),
            spots: 2,
            ..Shadowing::default()
        }
    }
}
