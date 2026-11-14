//! Issue #391: the line's slice of the motion module and the frame clock's `valid_until` (canvas
//! primitives: One clock, pure evaluation; Frame clock and scheduler). Every frame is the document
//! evaluated at a flick: how the playhead got there never changes it.
//!
//! Issue #417 adds the look's time feel for a change of state, the input track, the transition
//! follow and a stage's glide, in `input`.
//!
//! The math is f64 through deep-canvas's ops module on pinned libm, as the canvas lint requires.

pub mod arrange;
pub mod array;
pub mod assembly;
mod blend;
mod canonical;
pub mod clock;
pub mod constraint;
mod cue;
pub mod curve;
pub mod doc;
pub mod eval;
pub mod follow;
pub mod held;
mod hover;
pub mod input;
pub mod insert;
pub mod kit;
mod lag;
pub mod lengths;
pub mod modifier;
pub mod module;
pub mod morph;
pub mod occurrence;
mod pace;
pub mod present;
pub mod program;
pub mod quat;
pub mod remap;
mod rows;
pub mod schedule;
pub mod score;
pub mod shots;
pub mod spring;
pub mod tempo;
pub mod trail;
pub mod travel;
