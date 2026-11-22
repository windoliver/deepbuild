//! #552: a copy's draws after commit (canvas primitives: Net: random draws after commit), taken
//! when a match step is confirmed: in lockstep as it runs, with a window as it settles. Each
//! player's commitment and bits in the step's confirmed entries are checked, and bits that break
//! their commitment end the match as faulted; a step holding an entry on a control in
//! `draw_after` commits this copy's bits; once every commitment for a drawn step is held, this
//! copy reveals; and bits missing a timeout's worth of steps after the last commitment end the
//! match as timeout.

use super::{Copy, Stepper};
use crate::draw;
use crate::kind;

impl<S: Stepper> Copy<S> {
    /// Match step `k` is confirmed: its draw entries checked, its commitment and reveals made.
    pub(super) fn drawn(&mut self, k: i64) {
        let mut drawn = false;
        let mut fault = None;
        for (player, entries) in self.log.get(&k).cloned().unwrap_or_default() {
            for (control, value) in &entries {
                if kind::admit(&self.cfg.controls, control, value).is_err() {
                    continue;
                }
                drawn |= self.cfg.draw_after.iter().any(|c| c == control);
                if control == draw::COMMIT || control == draw::REVEAL {
                    let f = self.draws.entered(k, player, control, value, &self.game);
                    fault = fault.or(f);
                }
            }
        }
        if let Some((end, detail)) = fault {
            self.finish(end, detail);
            return;
        }
        let timeout = (self.cfg.timeout / self.cfg.step()).max(1);
        let due = self
            .draws
            .ran(k, drawn, (self.players, self.me), &self.game, timeout);
        for (control, value) in due.send {
            let entry = self.stamped(k + 1, self.me, 0, &control, &value);
            self.sim.early(&entry);
            self.made.push((control, value, None));
        }
        if let Some((end, detail)) = due.end {
            self.finish(end, detail);
        }
    }
}
