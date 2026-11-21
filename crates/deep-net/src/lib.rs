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
pub mod locate;
mod message;
pub mod play;
pub mod prompt;
pub mod window;

pub use copy::{Change, Copy, Defect, End, Hashed, Planted, Stepper};

/// #551's planted names that aren't a copy's: logic's rollback ring and page tracker, and the
/// rate rule; and #278's, the test relay's.
pub const PLANTED: [&str; 6] = [
    "net_ring_misses_fill",
    "net_ring_keeps_after",
    "net_keeps_replaced_checkpoint",
    "net_rate_faster_only",
    // #278's planted relays, which answer a copy that joins with state.
    "relay_sends_joiner_state",
    "relay_sends_old_seat_state",
];
pub use kind::{Config, FLICKS};
