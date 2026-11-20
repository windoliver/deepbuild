//! The played form (issue #172), as the app and the web player both make it, so the player
//! evaluates what the app does: worlds baked, logic items stepped, programs inlined and the core's
//! column view over the result.
//!
//! A web player's module set (#1490) builds it with only its set's modules: physics, logic,
//! scene3d, cells and vector are features, and the app's build holds them all.

pub mod access;
#[cfg(feature = "logic")]
pub mod cast;
#[cfg(feature = "physics")]
pub mod derive;
pub mod drawing;
#[cfg(feature = "logic")]
pub mod fires;
pub mod form;
pub mod logic;
#[cfg(feature = "net")]
pub mod net;
#[cfg(feature = "net")]
pub mod net_worlds;
pub mod read;
#[cfg(feature = "scene3d")]
pub mod scene;
#[cfg(feature = "physics")]
pub mod worlds;
