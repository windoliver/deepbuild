//! #550: where two copies parted (canvas primitives: Net: desync and replay), from hashes alone.
//! Once a full-state hash or a track hash a peer doesn't share stops the match, each copy steps
//! again from its checkpoint at or before the last full-state hash that matched (the piece's
//! start) and sends what it found: its full-state hash at every match step it stepped, since step
//! hashes don't cover all of memory and a change a later step undid leaves the hashes that came
//! after it agreeing, and a hash of each player's entries at each step since the last match. When the copies' track
//! hashes differ, the first player and step whose entries differ is the cause, and no state field
//! is compared; otherwise the first step whose full-state hash differs is, and the copies then
//! swap a hash for each field of each module's canonical state at that step. No state crosses.

use serde_json::{json, Value};

/// What one copy's run again found, from step `from` to the stop's hash step `at`. It travels in
/// parts, each well under a message's size: chunks of step hashes, chunks of entry hashes, then
/// its hashes at `at` and its counts.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Found {
    pub at: i64,
    /// The full-state hash and the track hash at `at`.
    pub state: u64,
    pub track: u64,
    pub from: i64,
    /// The full-state hash after each match step from `from` to `at`.
    pub steps: Vec<u64>,
    /// `(step, player, hash)` of every player's entries it held at each step from `from` to `at`,
    /// steps with none left out.
    pub entries: Vec<(i64, u8, u64)>,
}

fn hex(h: u64) -> String {
    format!("{h:016x}")
}

fn unhex(v: &Value) -> Option<u64> {
    u64::from_str_radix(v.as_str()?, 16).ok()
}

/// Step hashes and entry hashes a part holds at most.
const STEPS_A_PART: usize = 150;
const ENTRIES_A_PART: usize = 60;

impl Found {
    /// The parts it travels in, in order, the last naming its hashes at `at` and its counts.
    pub(crate) fn parts(&self) -> Vec<Value> {
        let mut out = Vec::new();
        for (i, chunk) in self.steps.chunks(STEPS_A_PART).enumerate() {
            let text: String = chunk.iter().map(|h| hex(*h)).collect();
            out.push(json!([
                "s",
                self.at,
                self.from + (i * STEPS_A_PART) as i64,
                text
            ]));
        }
        for chunk in self.entries.chunks(ENTRIES_A_PART) {
            let list: Vec<Value> = chunk
                .iter()
                .map(|(s, p, h)| json!([s, p, hex(*h)]))
                .collect();
            out.push(json!(["e", self.at, list]));
        }
        out.push(json!([
            "x",
            self.at,
            hex(self.state),
            hex(self.track),
            self.from,
            self.steps.len(),
            self.entries.len()
        ]));
        out
    }

    /// Takes one part into what it holds so far; true once the last has come, with every step
    /// and entry its counts name.
    pub(crate) fn take(&mut self, part: &Value) -> Option<bool> {
        match part.get(0)?.as_str()? {
            "s" => {
                let text = part.get(3)?.as_str()?;
                for at in (0..text.len()).step_by(16) {
                    self.steps
                        .push(u64::from_str_radix(text.get(at..at + 16)?, 16).ok()?);
                }
                Some(false)
            }
            "e" => {
                for e in part.get(2)?.as_array()? {
                    self.entries.push((
                        e.get(0)?.as_i64()?,
                        e.get(1)?.as_u64()? as u8,
                        unhex(e.get(2)?)?,
                    ));
                }
                Some(false)
            }
            "x" => {
                self.state = unhex(part.get(2)?)?;
                self.track = unhex(part.get(3)?)?;
                self.from = part.get(4)?.as_i64()?;
                let whole = self.steps.len() as u64 == part.get(5)?.as_u64()?
                    && self.entries.len() as u64 == part.get(6)?.as_u64()?;
                Some(whole)
            }
            _ => None,
        }
    }

    /// The stop's hash step a part belongs to.
    pub(crate) fn at_of(part: &Value) -> Option<i64> {
        part.get(1)?.as_i64()
    }

    /// The first step and player whose entries the two copies held differently.
    pub fn entries_part(&self, other: &Found) -> Option<(i64, u8)> {
        let (mut a, mut b) = (
            self.entries.iter().peekable(),
            other.entries.iter().peekable(),
        );
        loop {
            match (a.peek(), b.peek()) {
                (None, None) => return None,
                (Some(x), None) => return Some((x.0, x.1)),
                (None, Some(y)) => return Some((y.0, y.1)),
                (Some(x), Some(y)) => {
                    if (x.0, x.1) != (y.0, y.1) {
                        let first = (x.0, x.1).min((y.0, y.1));
                        return Some(first);
                    }
                    if x.2 != y.2 {
                        return Some((x.0, x.1));
                    }
                    a.next();
                    b.next();
                }
            }
        }
    }

    /// The first match step whose full-state hash differs between the two copies.
    pub fn first_step(&self, other: &Found) -> Option<i64> {
        let at = |f: &Found, k: i64| f.steps.get((k - f.from) as usize).copied();
        let from = self.from.min(other.from);
        (from..=self.at.max(other.at)).find(|k| at(self, *k) != at(other, *k))
    }
}

/// The fields whose hashes differ at one step, in canonical order: `(module, field)`.
pub fn fields_part(
    mine: &[(String, String, u64)],
    theirs: &[(String, String, u64)],
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (m, f, h) in mine {
        match theirs.iter().find(|(m2, f2, _)| m2 == m && f2 == f) {
            Some((_, _, h2)) if h2 == h => {}
            _ => out.push((m.clone(), f.clone())),
        }
    }
    for (m, f, _) in theirs {
        if !mine.iter().any(|(m2, f2, _)| m2 == m && f2 == f) {
            out.push((m.clone(), f.clone()));
        }
    }
    out
}

/// FNV-1a over bytes, from `h`: the track hash and the entry hashes.
pub fn fnv(mut h: u64, bytes: &[u8]) -> u64 {
    for b in bytes {
        h = (h ^ *b as u64).wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

pub const FNV_START: u64 = 0xcbf2_9ce4_8422_2325;

/// The hash of one player's entries at one step, as the copy held them.
pub fn entries_hash(step: i64, player: u8, entries: &[(String, Value)]) -> u64 {
    let mut h = fnv(FNV_START, &step.to_le_bytes());
    h = fnv(h, &[player]);
    fnv(h, json!(entries).to_string().as_bytes())
}

/// The merged track's hash after one more player's entries at a step.
pub fn track_after(track: u64, entries: u64) -> u64 {
    fnv(fnv(track, &track.to_le_bytes()), &entries.to_le_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn found_travels_in_parts_and_names_the_first_parting() {
        let a = Found {
            at: 360,
            state: 1,
            track: 2,
            from: 0,
            steps: (0..=360).map(|k| k as u64).collect(),
            entries: vec![(310, 3, 9), (320, 1, 4)],
        };
        let parts = a.parts();
        assert_eq!(parts.len(), 5);
        assert!(parts.iter().all(|p| p.to_string().len() < 4096));
        let mut b = Found {
            at: 360,
            ..Found::default()
        };
        let taken: Vec<bool> = parts.iter().map(|p| b.take(p).unwrap()).collect();
        assert_eq!(taken, vec![false, false, false, false, true]);
        assert_eq!(b, a);
        b.steps[310] = 0;
        b.entries[0].2 = 8;
        assert_eq!(a.first_step(&b), Some(310));
        assert_eq!(a.entries_part(&b), Some((310, 3)));
        b.entries.remove(0);
        assert_eq!(a.entries_part(&b), Some((310, 3)));
        assert_eq!(a.entries_part(&a), None);
        assert_eq!(a.first_step(&a), None);
    }
}
