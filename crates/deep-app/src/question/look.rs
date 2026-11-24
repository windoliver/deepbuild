//! What the card hears of its window (`rearm_on`), for its arming and its pictures (#3234).

use super::Controller;
use crate::arming::Rearm;

impl Controller {
    /// The card's window changed at `now`, its content area now `visible`: the card is presented, its slot judged in that
    /// area, and arms anew; its pictures are on screen only while the window can be seen. Whether that is new.
    pub fn rearm(&mut self, on: Rearm, visible: [i64; 4], now: u64) -> bool {
        if !self.machine.rearm(on, visible, now) {
            return false;
        }
        self.slot.visible = visible;
        self.now = now;
        self.send_down = None;
        if on != Rearm::Activation {
            self.send_waiting = None;
        }
        self.holding = self.holding.map(|_| self.machine.says());
        if matches!(on, Rearm::Occluded { .. }) {
            self.pictures.frame(&Default::default(), 0., now);
        }
        true
    }
}
