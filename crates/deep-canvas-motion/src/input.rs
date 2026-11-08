//! Issue #417: the input track and what a change of state moves (canvas primitives: Control,
//! Control/Shot; #489's transition follow). At each change of a control, every channel following
//! it moves from the value it holds at that flick to the option's value, and a stage's shot glides
//! its camera from the pose shown, each over its span by its ease, the look's time feel filling
//! what a follow or a shot names none of. A change during a move starts from where the value is,
//! never from the old target. Each value is closed form in t, so seeking equals playing.

use serde_json::Value;

use crate::curve::Ease;
use crate::doc::{Feel, Motion};

/// One input track entry: at `t`, `player`'s `control` takes `value` (`seq` orders one
/// player's entries on one flick). The track orders entries by (t, player, seq), never by
/// arrival (#497), so an entry that arrives late joins at its own flick and drops nothing.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub t: i64,
    pub seq: i64,
    pub control: String,
    pub value: Value,
    /// 1 for a piece played alone, 1 to 8 in a match.
    pub player: i64,
}

impl Entry {
    /// Its place on the track.
    pub fn key(&self) -> (i64, i64, i64) {
        (self.t, self.player, self.seq)
    }
}

/// One move toward a new target: from the value shown at `t` to `to`, over `span` by `ease`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Change {
    pub t: i64,
    pub from: [f64; 3],
    pub to: [f64; 3],
    pub span: i64,
    pub ease: Ease,
}

/// A value the input track moves: where it starts and each change, in time order. A follow's
/// value is its first component; a camera's target is all three.
#[derive(Clone, Debug, PartialEq)]
pub struct Moves {
    pub start: [f64; 3],
    pub changes: Vec<Change>,
}

impl Moves {
    fn held(start: [f64; 3]) -> Moves {
        Moves {
            start,
            changes: Vec::new(),
        }
    }

    /// The value at `t`: the start before any change; then the latest change's mix, its `from` at
    /// its own flick and its `to` from its span's end on (at once for a span of 0).
    pub fn at(&self, t: i64) -> [f64; 3] {
        let i = self.changes.partition_point(|c| c.t <= t);
        let Some(c) = i.checked_sub(1).map(|i| &self.changes[i]) else {
            return self.start;
        };
        let d = t - c.t;
        if d >= c.span {
            return c.to;
        }
        if d == 0 {
            return c.from;
        }
        let w = c.ease.at(d as f64 / c.span as f64);
        std::array::from_fn(|k| c.from[k] + (c.to[k] - c.from[k]) * w)
    }

    /// The earliest time after `t` at which the value may differ: the next flick inside a move,
    /// the next change's time otherwise, `None` once nothing changes again.
    pub fn next_change(&self, t: i64) -> Option<i64> {
        let i = self.changes.partition_point(|c| c.t <= t);
        let moving = i
            .checked_sub(1)
            .map(|i| &self.changes[i])
            .is_some_and(|c| t - c.t < c.span && c.from != c.to);
        if moving {
            return Some(t + 1);
        }
        self.changes.get(i).map(|c| c.t)
    }

    /// A change at `t` toward `to`, from the value shown then.
    fn push(&mut self, t: i64, to: [f64; 3], span: i64, ease: Ease) {
        let from = self.at(t);
        self.changes.push(Change {
            t,
            from,
            to,
            span,
            ease,
        });
    }
}

/// What an input track moves, compiled once per track: each follow channel's value and each
/// camera's target, in [`Motion::follows`] and [`Motion::cameras`] order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Inputs {
    pub follows: Vec<Moves>,
    pub cameras: Vec<Moves>,
}

impl Inputs {
    /// The moves `track` makes in `motion` under the time feel `feel`, or `None` for an entry
    /// naming a control motion doesn't read, or a value that isn't one of its options. Before any
    /// entry each control holds its default, so each stages control's default shot holds.
    pub fn new(motion: &Motion, feel: Feel, track: &[Entry]) -> Option<Inputs> {
        let mut options: Vec<usize> = motion.controls.iter().map(|c| c.default).collect();
        let mut follows: Vec<Moves> = motion
            .follows
            .iter()
            .map(|f| Moves::held([f.values[options[f.control]], 0.0, 0.0]))
            .collect();
        let mut cameras: Vec<Moves> = motion
            .cameras
            .iter()
            .map(|(_, t)| Moves::held(*t))
            .collect();
        for control in &motion.controls {
            if let Some(&s) = control.shots.get(control.default) {
                let shot = &motion.shots[s];
                cameras[shot.camera].start = shot.target;
            }
        }
        let mut entries: Vec<&Entry> = track.iter().collect();
        entries.sort_by_key(|e| e.key());
        for e in entries {
            let c = motion.controls.iter().position(|c| c.id == e.control)?;
            let control = &motion.controls[c];
            let option = match (control.kind, &e.value) {
                ("toggle", Value::Bool(on)) => usize::from(*on),
                ("stages", Value::String(stage)) => {
                    control.options.iter().position(|o| o == stage)?
                }
                _ => return None,
            };
            // An entry that leaves the option as it is changes nothing.
            if options[c] == option {
                continue;
            }
            options[c] = option;
            for (f, follow) in motion.follows.iter().enumerate() {
                if follow.control == c {
                    let span = follow.span.unwrap_or(feel.span);
                    let ease = follow.ease.unwrap_or(feel.ease);
                    follows[f].push(e.t, [follow.values[option], 0.0, 0.0], span, ease);
                }
            }
            if let Some(&s) = control.shots.get(option) {
                let shot = &motion.shots[s];
                let ease = shot.ease.unwrap_or(feel.ease);
                cameras[shot.camera].push(e.t, shot.target, shot.glide, ease);
            }
        }
        Some(Inputs { follows, cameras })
    }

    /// The earliest time after `t` at which anything the track moves may differ.
    pub fn next_change(&self, t: i64) -> Option<i64> {
        self.follows
            .iter()
            .chain(&self.cameras)
            .filter_map(|m| m.next_change(t))
            .min()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_during_a_move_starts_from_where_the_value_is() {
        let mut m = Moves::held([0.0; 3]);
        m.push(0, [100.0, 0.0, 0.0], 100, Ease::Linear);
        // Half way to 100, the target turns back to 0: the new move starts at 50, not at 100.
        m.push(50, [0.0; 3], 100, Ease::Linear);
        assert_eq!(m.at(50)[0], 50.0);
        assert_eq!(m.at(100)[0], 25.0);
        assert_eq!(m.at(150)[0], 0.0);
        assert_eq!(m.next_change(149), Some(150));
        assert_eq!(m.next_change(150), None);
    }
}
