//! #277: `net.seats` (canvas primitives: Net `net@1`; Logic `logic@1`), the seat entries the net
//! module stamps on the input track, `seat {player, state}` with the writer `net`, read as a
//! control's entries are: those stamped after the item's last step and at or before this one.

use crate::track::{Given, Track, SEAT};

/// The read that takes a step's seat entries.
pub const READ: &str = "net.seats";
/// Seat entries one step's read region holds at most, as a control's slot holds its entries.
pub const PER_STEP: usize = crate::piece::PER_STEP;
/// The read region's size, a control's slot: a u32 count, 4 zero bytes, then each entry as `u32
/// player, u32 state (1 left, 2 absent, 3 back, 4 joined), u32 step, 4 zero bytes`, the step the item
/// takes it at.
pub const SIZE: u32 = crate::piece::SLOT;

/// Fills a `net.seats` read region for the step at `t` of an item whose step is `len` flicks long:
/// the seat entries stamped after `before` and at or before `t`, in track order.
pub(crate) fn fill(track: &Track, (before, t): (i64, i64), len: i64, region: &mut [u8]) {
    let list = track.get(SEAT).map_or(&[][..], Vec::as_slice);
    let fresh = list.iter().filter(|e| e.t > before && e.t <= t);
    let mut n = 0u32;
    for e in fresh.take(PER_STEP) {
        let Given::Number(state) = e.value else {
            continue;
        };
        let o = 8 + 16 * n as usize;
        let step = e.t.div_euclid(len) + i64::from(e.t.rem_euclid(len) != 0);
        region[o..o + 4].copy_from_slice(&e.player.to_le_bytes());
        region[o + 4..o + 8].copy_from_slice(&(state as u32).to_le_bytes());
        region[o + 8..o + 12].copy_from_slice(&(step as u32).to_le_bytes());
        n += 1;
    }
    region[..4].copy_from_slice(&n.to_le_bytes());
}
