//! Issue #327: the question card's arming, as one state table (Question card, in the canvas primitives
//! reference). A card counts as shown only once presented; it arms `ARM_AFTER` after its presentation, while its
//! window can be seen and it is wholly inside its view and large enough; a press counts only when its own platform
//! timestamp is at least `ARM_AFTER` past that moment, its down falls on an armed option, the card stays armed through
//! release on that option and it is no key repeat. An input that isn't hardware answers only after the OS confirms you.
//!
//! Everything here is pure and runs on whatever clock feeds it timestamps, so a test drives it with recorded
//! input on a virtual clock. The shell reads its platform's event timestamps into it; nothing here reads a
//! wall clock.

use serde::{Deserialize, Serialize};

/// `arm_after`: how long a presented card stays still before it arms, in ms.
pub const ARM_AFTER: u64 = 500;

/// What the card says on a click before it arms, while its interval runs (#1808: only then): its key in the app's
/// table (#2403).
pub const HOLD_STILL: &str = "arming.hold_still";

/// What a card too tall for its page says on a click: its options aren't all in view, so it can't arm (#1808).
pub const TOO_SMALL: &str = "arming.too_small";

/// What a card in a window nobody can see says on a press, which an assistive client can send it.
pub const UNSEEN: &str = "arming.unseen";

/// A change of the card's window that re-arms the card (Question card: `rearm_on`); a change of what it says presents it
/// anew.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rearm {
    Move,
    Resize,
    /// It can be seen from now on, or can't any more.
    Occluded {
        seen: bool,
    },
    /// It is on another display, or its display changed.
    Display,
    /// It came forward, or went back.
    Activation,
}

/// Where an input came from, as the platform names it (Input router: `source`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Source {
    /// The pointer or the keyboard, Full Keyboard Access included.
    Hardware,
    /// An event a process posted; `pid` is the poster where the platform names it.
    Synthetic { pid: Option<i64> },
    /// An accessibility action. macOS names no sender, so every client is unknown (Decided: Clicks on the
    /// question card); the field stays so a platform that names one can say so.
    Accessibility { client: Client },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Client {
    Voiceover,
    Unknown,
}

impl Source {
    /// Whether the input answers the card by itself. Only hardware does: a synthetic event or an accessibility
    /// action from a client the platform can't name answers only after the OS confirms you.
    pub fn trusted(self) -> bool {
        matches!(self, Source::Hardware)
    }
}

/// The card's state (`state: hidden | presented(seq, t) | armed | answered`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "state")]
pub enum State {
    Hidden,
    Presented { seq: u64, t: u64 },
    Armed { seq: u64 },
    Answered { seq: u64 },
}

/// The slot a view reserved for the card, and whether it lies wholly inside the view's scroll area and the
/// window. A slot partly outside, or smaller than the card's measured size, never arms.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Slot {
    /// `[x, y, w, h]` in window points.
    pub rect: [i64; 4],
    /// The visible area the slot must lie in: the view's scroll area clipped to the window.
    pub visible: [i64; 4],
}

impl Slot {
    /// Whether the slot lies wholly inside its visible area and holds a card measured `size` points.
    pub fn arms(&self, size: [i64; 2]) -> bool {
        let [x, y, w, h] = self.rect;
        let [vx, vy, vw, vh] = self.visible;
        w >= size[0] && h >= size[1] && x >= vx && y >= vy && x + w <= vx + vw && y + h <= vy + vh
    }
}

/// One press, down or up, as the platform delivered it, with its own timestamp in host time.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Press {
    /// The event's own platform timestamp, ms, never when it was delivered.
    pub t: u64,
    pub source: Source,
    /// The option the press falls on, by index; `None` for a press off every option.
    pub option: Option<usize>,
    /// A key repeat, which never answers.
    pub repeat: bool,
}

/// What the card did with a press.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Outcome {
    /// Nothing: the card isn't presented, the press hit no option, or it was a repeat or a release with no
    /// matching down on the same option.
    Ignored,
    /// A press before the card armed: nothing changes, and the card says to hold still.
    Refused { seq: u64, says: &'static str },
    /// A hardware press on an armed option that stayed armed through release: the answer.
    Answered { seq: u64, option: usize },
    /// A press from an input that isn't hardware: the option waits for the OS to confirm you.
    NeedsConfirmation { seq: u64, option: usize },
}

/// A press down the card holds until its release.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Down {
    seq: u64,
    option: usize,
    source: Source,
}

/// The arming machine for one presented card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Machine {
    state: State,
    /// Presentations so far: each `present` is a new `seq`.
    presented: u64,
    /// When the interval last started: the presentation, or the undo that presented the card again.
    since: u64,
    /// The card's measured size, points.
    size: [i64; 2],
    slot: Option<Slot>,
    down: Option<Down>,
    /// An option chosen by an untrusted input, waiting for the OS to confirm you.
    confirming: Option<(u64, usize)>,
    /// Why the card can't arm besides its interval and its slot, which a press is told (#1808): a long card's end not
    /// shown yet, or options folded behind a count not opened yet.
    held: Option<&'static str>,
    /// Whether its window can be seen; until it's told, it can.
    seen: bool,
}

impl Machine {
    /// A hidden card measuring `size` points whose presentations are numbered after `after`, so a card presented
    /// again by a relaunched app never repeats a `seq` the usage rows already hold.
    pub fn numbered(size: [i64; 2], after: u64) -> Self {
        Machine {
            state: State::Hidden,
            presented: after,
            since: 0,
            size,
            slot: None,
            down: None,
            confirming: None,
            held: None,
            seen: true,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }

    /// The presentation this card is on.
    pub fn seq(&self) -> u64 {
        self.presented
    }

    /// Presents the card at `t` in `slot`: a new `seq`, the interval started. A card already presented is
    /// presented again as a new one, so a relaunch after a kill presents unarmed.
    pub fn present(&mut self, t: u64, slot: Slot) -> u64 {
        self.presented += 1;
        self.state = State::Presented {
            seq: self.presented,
            t,
        };
        self.since = t;
        self.slot = Some(slot);
        self.down = None;
        self.confirming = None;
        self.presented
    }

    /// The card as drawn measured `size` points. One that outgrew its slot stops being armed, and arms again only
    /// once it fits and its interval ran anew.
    pub fn measured(&mut self, size: [i64; 2], t: u64) {
        let fitted = self.fits();
        self.size = size;
        let fits = self.fits();
        match self.state {
            State::Armed { seq } if !fits => {
                self.state = State::Presented { seq, t };
                self.since = t;
                self.down = None;
                self.confirming = None;
            }
            State::Presented { seq, .. } if fits && !fitted => {
                self.state = State::Presented { seq, t };
                self.since = t;
            }
            _ => {}
        }
    }

    /// The seq of a presented or armed card.
    fn shown(&self) -> Option<u64> {
        match self.state {
            State::Presented { seq, .. } | State::Armed { seq } => Some(seq),
            _ => None,
        }
    }

    fn fits(&self) -> bool {
        self.slot.is_some_and(|slot| slot.arms(self.size))
    }

    fn may_arm(&self) -> bool {
        self.seen && self.fits() && self.held.is_none()
    }

    /// Its window changed at `t`, the window's content area now `visible`, which its slot is judged in: a card that shows
    /// is presented, its interval starts anew, and a press held down answers nothing. Neither does an OS prompt still up,
    /// except that the prompt itself sends the window back and brings it forward. Whether that is new.
    pub fn rearm(&mut self, on: Rearm, visible: [i64; 4], t: u64) -> bool {
        if let Rearm::Occluded { seen } = on {
            if seen == self.seen {
                return false;
            }
            self.seen = seen;
        }
        if let Some(slot) = &mut self.slot {
            slot.visible = visible;
        }
        if let Some(seq) = self.shown() {
            self.state = State::Presented { seq, t };
            self.since = t;
            self.down = None;
            if on != Rearm::Activation {
                self.confirming = None;
            }
        }
        true
    }

    /// Whether its window can be seen.
    pub fn seen(&self) -> bool {
        self.seen
    }

    /// Why the card can't arm at `t` besides its interval, or `None` once nothing holds it (#1808). A card held armed
    /// stops being armed; one no longer held arms once its interval ran, counted from its presentation.
    pub fn hold(&mut self, held: Option<&'static str>, t: u64) {
        self.held = held;
        if let (State::Armed { seq }, Some(_)) = (self.state, held) {
            self.state = State::Presented { seq, t };
            self.since = t;
            self.down = None;
            self.confirming = None;
        }
        self.tick(t);
    }

    /// What a press before the card armed is told, in the language shown: why it can't arm, or to hold still while
    /// only its interval runs.
    pub fn says(&self) -> &'static str {
        if !self.seen {
            crate::copy::text(UNSEEN)
        } else if !self.fits() {
            crate::copy::text(TOO_SMALL)
        } else {
            self.held.unwrap_or_else(|| crate::copy::text(HOLD_STILL))
        }
    }

    /// Time passed to `t`: a presented card arms once its interval ran while it may arm.
    pub fn tick(&mut self, t: u64) {
        if let State::Presented { seq, .. } = self.state {
            if self.may_arm() && t >= self.since + ARM_AFTER {
                self.state = State::Armed { seq };
            }
        }
    }

    /// A press down at its own timestamp. It counts toward an answer only on an armed option.
    pub fn press_down(&mut self, press: Press) -> Outcome {
        self.tick(press.t);
        let Some(seq) = self.shown() else {
            return Outcome::Ignored;
        };
        if press.repeat {
            return Outcome::Ignored;
        }
        let Some(option) = press.option else {
            return Outcome::Ignored;
        };
        // The press's own time decides: one stamped before the interval ran never counts, however late it was
        // delivered.
        let armed = matches!(self.state, State::Armed { .. }) && press.t >= self.since + ARM_AFTER;
        if !armed {
            return Outcome::Refused {
                seq,
                says: self.says(),
            };
        }
        self.down = Some(Down {
            seq,
            option,
            source: press.source,
        });
        Outcome::Ignored
    }

    /// The release at its own timestamp: the answer, if the card stayed armed since the down and the release
    /// falls on the option the down did.
    pub fn press_up(&mut self, press: Press) -> Outcome {
        self.tick(press.t);
        let Some(down) = self.down.take() else {
            return Outcome::Ignored;
        };
        if press.option != Some(down.option) {
            return Outcome::Ignored;
        }
        if self.state != (State::Armed { seq: down.seq }) || press.t < self.since + ARM_AFTER {
            return Outcome::Ignored;
        }
        if down.source.trusted() && press.source.trusted() {
            self.state = State::Answered { seq: down.seq };
            // A prompt still open for an earlier press answers nothing now.
            self.confirming = None;
            return Outcome::Answered {
                seq: down.seq,
                option: down.option,
            };
        }
        self.confirming = Some((down.seq, down.option));
        Outcome::NeedsConfirmation {
            seq: down.seq,
            option: down.option,
        }
    }

    /// Whether a press stamped `t` lands on the card armed: it is armed, and `t` is past its interval.
    pub fn accepts(&self, t: u64) -> bool {
        matches!(self.state, State::Armed { .. }) && t >= self.since + ARM_AFTER
    }

    /// Whether the OS's yes to a press on presentation `seq` answers it: the card shows that presentation, and nothing but
    /// its interval holds it, which the prompt restarts.
    pub fn confirms(&self, seq: u64) -> bool {
        self.shown() == Some(seq) && self.may_arm()
    }

    /// The card answered through its Send, with words or an image and no option: answered, nothing held.
    /// Its ask closed elsewhere while the card showed: the card is taken down, and nothing on it answers.
    pub fn withdrawn(&mut self) {
        if self.shown().is_some() {
            self.state = State::Hidden;
            self.down = None;
            self.confirming = None;
        }
    }

    pub fn answered(&mut self) {
        if let Some(seq) = self.shown() {
            self.state = State::Answered { seq };
            self.down = None;
            self.confirming = None;
        }
    }

    /// The answer taken back through the receipt's Undo at `t`: the card is presented again, the same `seq`, and
    /// arms after its interval.
    pub fn undo(&mut self, t: u64) {
        if let State::Answered { seq } = self.state {
            self.state = State::Presented { seq, t };
            self.since = t;
            self.down = None;
            self.confirming = None;
        }
    }

    /// The option an untrusted input chose, waiting for the OS, if any.
    pub fn confirming(&self) -> Option<(u64, usize)> {
        self.confirming
    }

    /// The OS answered its prompt for the waiting option: confirmed, the card is answered; cancelled, the ask
    /// stays open and the card armed. One confirmation answers one card once: nothing is kept for the next.
    pub fn confirmed(&mut self, confirmed: bool) -> Outcome {
        let Some((seq, option)) = self.confirming.take() else {
            return Outcome::Ignored;
        };
        if !confirmed || !self.confirms(seq) {
            return Outcome::Ignored;
        }
        self.state = State::Answered { seq };
        Outcome::Answered { seq, option }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SLOT: Slot = Slot {
        rect: [100, 100, 480, 240],
        visible: [0, 0, 1512, 982],
    };

    #[test]
    fn a_card_drawn_taller_than_its_slot_never_arms_until_it_fits() {
        let mut machine = Machine::numbered([480, 240], 0);
        machine.present(0, SLOT);
        machine.measured([480, 900], 10);
        machine.tick(ARM_AFTER + 10);
        assert!(matches!(machine.state(), State::Presented { .. }));
        // It fits from 600: the interval runs from then, not from its presentation.
        machine.measured([480, 240], 600);
        machine.tick(600 + ARM_AFTER - 1);
        assert!(matches!(machine.state(), State::Presented { .. }));
        machine.tick(600 + ARM_AFTER);
        assert!(matches!(machine.state(), State::Armed { .. }));
        // Armed, it grows past its slot: it stops being armed, and arms again only once it fits for the interval.
        machine.measured([480, 900], 700);
        assert!(matches!(machine.state(), State::Presented { .. }));
        machine.measured([480, 240], 800);
        machine.tick(800 + ARM_AFTER - 1);
        assert!(matches!(machine.state(), State::Presented { .. }));
        machine.tick(800 + ARM_AFTER);
        assert!(matches!(machine.state(), State::Armed { .. }));
    }

    fn hardware(t: u64, option: usize) -> Press {
        Press {
            t,
            source: Source::Hardware,
            option: Some(option),
            repeat: false,
        }
    }

    /// A whole press, down and up at `t`, as a click delivered in one.
    fn click(card: &mut Machine, press: Press) -> Outcome {
        match card.press_down(press) {
            Outcome::Ignored => card.press_up(press),
            other => other,
        }
    }

    fn presented() -> Machine {
        let mut card = Machine::numbered([480, 240], 0);
        card.present(1_000, SLOT);
        card
    }

    #[test]
    fn a_press_stamped_499_ms_after_presentation_answers_nothing_and_one_at_500_answers() {
        let mut card = presented();
        assert!(matches!(
            click(&mut card, hardware(1_499, 0)),
            Outcome::Refused { seq: 1, says } if says == crate::copy::text(HOLD_STILL)
        ));
        assert_eq!(card.state(), State::Presented { seq: 1, t: 1_000 });
        assert_eq!(
            click(&mut card, hardware(1_500, 0)),
            Outcome::Answered { seq: 1, option: 0 }
        );
    }

    #[test]
    fn a_down_at_450_and_an_up_at_700_answers_nothing() {
        let mut card = presented();
        assert!(matches!(
            card.press_down(hardware(1_450, 0)),
            Outcome::Refused { .. }
        ));
        assert_eq!(card.press_up(hardware(1_700, 0)), Outcome::Ignored);
        assert_eq!(card.state(), State::Armed { seq: 1 });
    }

    #[test]
    fn a_release_on_another_option_answers_nothing() {
        let mut card = presented();
        assert_eq!(card.press_down(hardware(2_000, 0)), Outcome::Ignored);
        assert_eq!(card.press_up(hardware(2_100, 1)), Outcome::Ignored);
        assert_eq!(card.state(), State::Armed { seq: 1 });
        assert_eq!(
            click(&mut card, hardware(2_200, 1)),
            Outcome::Answered { seq: 1, option: 1 }
        );
    }

    #[test]
    fn a_key_repeat_never_answers() {
        let mut card = presented();
        let repeat = Press {
            repeat: true,
            ..hardware(2_000, 0)
        };
        assert_eq!(click(&mut card, repeat), Outcome::Ignored);
        assert_eq!(card.state(), State::Armed { seq: 1 });
    }

    #[test]
    fn a_slot_partly_outside_or_too_small_never_arms() {
        for slot in [
            Slot {
                rect: [100, 100, 1, 1],
                visible: [0, 0, 1512, 982],
            },
            Slot {
                rect: [100, -1, 480, 240],
                visible: [0, 0, 1512, 982],
            },
        ] {
            let mut card = Machine::numbered([480, 240], 0);
            card.present(1_000, slot);
            assert!(matches!(
                click(&mut card, hardware(9_000, 0)),
                Outcome::Refused { .. }
            ));
            assert_eq!(card.state(), State::Presented { seq: 1, t: 1_000 });
        }
    }

    #[test]
    fn a_synthetic_press_answers_only_once_the_os_confirms_you_and_once() {
        let mut card = presented();
        let synthetic = Press {
            source: Source::Synthetic { pid: Some(42) },
            ..hardware(2_000, 1)
        };
        assert_eq!(
            click(&mut card, synthetic),
            Outcome::NeedsConfirmation { seq: 1, option: 1 }
        );
        assert_eq!(card.state(), State::Armed { seq: 1 });
        assert_eq!(card.confirmed(false), Outcome::Ignored);
        assert_eq!(card.state(), State::Armed { seq: 1 });
        assert_eq!(
            click(&mut card, synthetic),
            Outcome::NeedsConfirmation { seq: 1, option: 1 }
        );
        assert_eq!(
            card.confirmed(true),
            Outcome::Answered { seq: 1, option: 1 }
        );
        assert_eq!(card.confirmed(true), Outcome::Ignored);
    }

    #[test]
    fn a_relaunch_presents_again_unarmed() {
        let mut card = presented();
        card.tick(2_000);
        assert_eq!(card.state(), State::Armed { seq: 1 });
        assert_eq!(card.present(7_000, SLOT), 2);
        assert_eq!(card.state(), State::Presented { seq: 2, t: 7_000 });
        assert!(matches!(
            click(&mut card, hardware(7_499, 0)),
            Outcome::Refused { seq: 2, .. }
        ));
        assert_eq!(
            click(&mut card, hardware(7_500, 0)),
            Outcome::Answered { seq: 2, option: 0 }
        );
    }
}
