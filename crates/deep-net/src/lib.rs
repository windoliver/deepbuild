//! The net module (issue #549; canvas primitives: Shared play over a relay; technical design: The
//! net module), as the app and the web player both run it. Two to eight copies play one piece in
//! lockstep over the one relay it declares: only inputs travel, one message from each player each
//! match step, in relay@1 frames that repeat what a peer hasn't confirmed. A host (the app, the
//! web player, or the test relay here) hands a copy the time and the frames that arrived; nothing
//! in this crate opens a connection or reads a clock.

pub mod card;
pub mod checks;
pub mod copy;
pub mod kind;
pub mod play;
pub mod prompt;

pub use copy::{Copy, End, Planted, Stepper};
pub use kind::{Config, FLICKS};
