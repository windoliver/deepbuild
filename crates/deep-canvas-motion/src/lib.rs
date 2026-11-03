//! Issue #391: the line's slice of the motion module and the frame clock's `valid_until` (canvas
//! primitives: One clock, pure evaluation; Frame clock and scheduler). Every frame is the document
//! evaluated at a flick: how the playhead got there never changes it.
//!
//! The math is f64 through deep-canvas's ops module on pinned libm, as the canvas lint requires.

mod canonical;
pub mod clock;
pub mod constraint;
pub mod curve;
pub mod doc;
pub mod ease;
pub mod eval;
pub mod follow;
pub mod insert;
pub mod kit;
pub mod modifier;
pub mod module;
pub mod program;
pub mod schedule;
pub mod spring;
