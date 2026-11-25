//! A 2D writer layer's frame on the GPU layer (issue #1561): the group compositor ([`groups`],
//! #430), a drawn look's passes and the page they read ([`drawn`], #149), the paint and light
//! built from a mark's coverage ([`paintfx`], #467; [`lightfx`], #2031), and a 2D document's
//! frame under a look as `film2d` draws it ([`frame2`]), and an indexed look's index target
//! ([`indexed`], #464, moved here for #1250's clips). `deep-gpu`'s calls and `deep-show`'s
//! frames draw through it, so both draw one picture.

use serde_json::{json, Value};

pub mod drawn;
pub mod frame2;
pub mod groups;
pub mod indexed;
pub mod lightfx;
pub mod paintfx;
pub mod read;
mod shader_layout;

// A release build refuses #3256's planted comparison (tests/acceptance/3256).
#[cfg(all(feature = "plant-3256-host-sizes", not(debug_assertions)))]
compile_error!("the plant-3256-host-sizes feature is for test builds only, never a release build");

/// The wrong programs the compositor and its passes plant, each reachable only through a
/// binary's `--planted` (the acceptance READMEs of #430, #149, #467, #2031 and #2032: Planted
/// programs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    GroupPassAtLayerEnd,
    GroupPassReadsEarlier,
    GroupPassPastGrow,
    BackdropReadsLaterItems,
    BackdropPastCoverage,
    BevelLitOpposite,
    LightLinearFalloff,
    LightEncodedSum,
    LightDefaultAmbientZero,
    LightEveryChild,
    LightStaleList,
    VividLightAsLinearLight,
    PassLinearIn2d,
    PassEncodedIn3d,
    InkFillFlat,
    RimKeepsFirst,
    ShadowBoundingBoxes,
    SunFarPointLight,
    ShadowInsideOutline,
    ShadowRemovesAmbient,
    ShadowEdgeAliased,
    NormalFlippedGreen,
    NormalDotAlone,
    NormalUnturned,
    LightStaleHeight,
    /// #161's wrong programs (tests/acceptance/161/README.md: Planted programs), each on one
    /// operator a group's pass names.
    InvertOnPremultiplied,
    InvertWithoutAlphaGuard,
    KeyKeepsColorAtAlpha0,
    TwirlCenterFromFrameOrigin,
    BlurRadiusInDevicePx,
    SliceShiftSeededByFrame,
}

/// A refusal as a call answers it.
pub fn refused(code: &str, reason: impl Into<String>) -> Value {
    json!({"code": code, "reason": reason.into()})
}
