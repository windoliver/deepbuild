//! Whether a person can see the card's window, for its arming (`rearm_on: occluded`) and its pictures (#3234).

use super::Controller;

impl Controller {
    /// The card's window can be seen from `now`, or can't any more: the card arms only while it can, and its pictures are
    /// on screen only then. Whether that changed what the card shows.
    pub fn look(&mut self, seen: bool, now: u64) -> bool {
        if !self.machine.look(seen, now) {
            return false;
        }
        self.now = now;
        self.send_down = None;
        self.send_waiting = None;
        self.holding = self.holding.map(|_| self.machine.says());
        self.pictures.frame(&Default::default(), 0., now);
        true
    }
}
