//! #552: `net.draws` (canvas primitives: Net: random draws after commit; Logic `logic@1`), the
//! draws the core derives from the input track's `draw.reveal` entries. A drawn step's draw
//! completes at the first time whose entries hold every player's bits for it: every player who
//! committed to it, or the one player of a piece played alone, which commits to nothing. Its
//! value is the first 8 bytes of sha256 over the match ID, the draw's number (1 for the first
//! drawn step to reach the track, counting up) and every player's bits in player order, never the
//! step, so an action moved by a step keeps its draw. A piece played alone writes its own bits at
//! the step after the drawn step: from its platform's secure random source when a person plays
//! it, and from hash(the run's seed, the draw's number) in a replica, so a seeded run repeats.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use sha2::Digest as _;

use crate::track::{Entry, Given, Track};

/// The control of a commitment entry, `{step, hash}`.
pub const COMMIT: &str = "draw.commit";
/// The control of a reveal entry, `{step, bits}`.
pub const REVEAL: &str = "draw.reveal";
/// The read that takes a step's draws.
pub const READ: &str = "net.draws";
/// Draws one step's read region holds at most; any more wait for the next step.
pub const PER_STEP: usize = 16;
/// The read region's size: a u32 count, 4 zero bytes, then each draw as `i64 step, u64 value`.
pub const SIZE: u32 = 8 + 16 * PER_STEP as u32;

/// A u64 as a draw entry carries it: 16 hex digits, or a number.
pub fn bits_of(v: &Value) -> Option<u64> {
    match v {
        Value::String(s) => u64::from_str_radix(s, 16).ok(),
        _ => v.as_u64(),
    }
}

fn step_of(e: &Entry) -> Option<i64> {
    match &e.value {
        Given::Draw(v) => v.get("step")?.as_i64(),
        _ => None,
    }
}

/// A match ID from its 32 hex digits.
fn game_of(hex: &str) -> Option<[u8; 16]> {
    let mut out = [0u8; 16];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok()?;
    }
    (hex.len() == 32).then_some(out)
}

/// One drawn step's draw: its step, its number, the time its last bits reached the track, and its
/// value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Draw {
    pub step: i64,
    pub number: u64,
    pub at: i64,
    pub value: u64,
}

/// The value of draw `number` from each player's bits in player order, in match `game`.
pub fn value(game: &[u8; 16], number: u64, bits: &[u64]) -> u64 {
    let mut h = sha2::Sha256::new();
    h.update(game);
    h.update(number.to_le_bytes());
    for b in bits {
        h.update(b.to_le_bytes());
    }
    u64::from_le_bytes(h.finalize()[..8].try_into().expect("8 bytes"))
}

/// The bits a replica writes for draw `number` of a piece played alone: hash(the run's seed, the
/// draw's number).
pub fn alone_bits(seed: u64, number: u64) -> u64 {
    let mut h = sha2::Sha256::new();
    h.update(b"draw.alone");
    h.update(seed.to_le_bytes());
    h.update(number.to_le_bytes());
    u64::from_le_bytes(h.finalize()[..8].try_into().expect("8 bytes"))
}

/// How a planted derivation goes wrong (#552's twins).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Wrong {
    #[default]
    None,
    /// It hashes the drawn step in place of the draw's number.
    HashesStep,
    /// It delivers a draw from the bits that reached it first, before every player's are on the
    /// track.
    FirstBits,
}

/// The match a world's draws derive in, and how a planted derivation goes wrong.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Book {
    pub game: [u8; 16],
    pub wrong: Wrong,
}

impl Book {
    /// A `net.draws` read region for the step at `t`, the step before it at `before`: the draws
    /// `track` completes after `before` and at or before `t`.
    pub(crate) fn fill(&self, track: &Track, (before, t): (i64, i64), region: &mut [u8]) {
        fill(&derive(track, &self.game, self.wrong), before, t, region);
    }
}

impl crate::world::World {
    /// Every draw its track completes so far (`net.draws`).
    pub fn draws(&self) -> Vec<Draw> {
        derive(&self.track, &self.draw.game, self.draw.wrong)
    }
}

/// Every draw the track completes, in the order they complete. A draw's number is its place among
/// the drawn steps in the order their first commitment or reveal reaches the track.
pub fn derive(track: &Track, game: &[u8; 16], wrong: Wrong) -> Vec<Draw> {
    let mut first: BTreeMap<i64, (i64, i64)> = BTreeMap::new();
    let mut committed: BTreeMap<i64, Vec<u32>> = BTreeMap::new();
    for e in track.get(COMMIT).into_iter().flatten() {
        if let Some(s) = step_of(e) {
            first.entry(s).or_insert((e.t, s));
            committed.entry(s).or_default().push(e.player);
        }
    }
    let reveals: Vec<&Entry> = track.get(REVEAL).into_iter().flatten().collect();
    for e in &reveals {
        if let Some(s) = step_of(e) {
            let f = first.entry(s).or_insert((e.t, s));
            *f = (*f).min((e.t, s));
        }
    }
    let mut order: Vec<(i64, i64)> = first.values().copied().collect();
    order.sort();
    let number = |s: i64| {
        order
            .iter()
            .position(|o| o.1 == s)
            .map_or(0, |n| n as u64 + 1)
    };
    let mut bits: BTreeMap<i64, BTreeMap<u32, u64>> = BTreeMap::new();
    let mut out = Vec::new();
    let mut by_arrival = reveals.clone();
    if wrong == Wrong::FirstBits {
        by_arrival.sort_by_key(|e| e.arrived);
    }
    for e in by_arrival {
        let (Some(s), Given::Draw(v)) = (step_of(e), &e.value) else {
            continue;
        };
        let Some(b) = bits_of(&v["bits"]) else {
            continue;
        };
        let held = bits.entry(s).or_default();
        if held.contains_key(&e.player) || out.iter().any(|d: &Draw| d.step == s) {
            continue;
        }
        held.insert(e.player, b);
        let mut players = committed.get(&s).cloned().unwrap_or_else(|| vec![1]);
        players.sort();
        players.dedup();
        let complete = wrong == Wrong::FirstBits || players.iter().all(|p| held.contains_key(p));
        if !complete {
            continue;
        }
        let list: Vec<u64> = held.values().copied().collect();
        let n = match wrong {
            Wrong::HashesStep => s as u64,
            _ => number(s),
        };
        // The match a reveal names, else the world's: a piece played alone draws in a zero ID.
        let game = v["match"].as_str().and_then(game_of).unwrap_or(*game);
        out.push(Draw {
            step: s,
            number: number(s),
            at: e.t,
            value: value(&game, n, &list),
        });
    }
    out.sort_by_key(|d| (d.at, d.number));
    out
}

/// Fills a `net.draws` read region for the step at `t`, the step before it at `before`: each
/// draw that completed after `before` and at or before `t`, at most 16, as `i64 step, u64 value`.
pub fn fill(draws: &[Draw], before: i64, t: i64, region: &mut [u8]) {
    let list: Vec<&Draw> = draws
        .iter()
        .filter(|d| d.at > before && d.at <= t)
        .take(PER_STEP)
        .collect();
    region[..4].copy_from_slice(&(list.len() as u32).to_le_bytes());
    for (j, d) in list.iter().enumerate() {
        let o = 8 + 16 * j;
        region[o..o + 8].copy_from_slice(&d.step.to_le_bytes());
        region[o + 8..o + 16].copy_from_slice(&d.value.to_le_bytes());
    }
}

/// A piece played alone, after its step `k` of `step` flicks: when the step read an entry on a
/// control in `draw_after`, its own bits for it at the next step, `bits(the draw's number)`, with
/// no commitment and a zero match ID; none where the track already holds them.
pub fn alone(
    world: &mut crate::world::World,
    draw_after: &[String],
    (k, step): (i64, i64),
    bits: &mut dyn FnMut(u64) -> u64,
) -> Result<(), Value> {
    let t = k * step;
    let read =
        |c: &String| (world.track.get(c).into_iter().flatten()).any(|e| e.t > t - step && e.t <= t);
    if !draw_after.iter().any(read) {
        return Ok(());
    }
    let reveals = world.track.get(REVEAL).map_or(&[][..], Vec::as_slice);
    if reveals.iter().any(|e| step_of(e) == Some(k)) {
        return Ok(());
    }
    let number = reveals.len() as u64 + 1;
    let e = Entry::parse(&reveal_entry(t + step, 1, k, bits(number)))
        .ok_or_else(|| json!({"code": "bad_input", "what": "a draw's reveal"}))?;
    world.append(e).map(|_| ())
}

/// A draw's entries as the track carries them.
pub fn commit_entry(t: i64, player: u32, step: i64, hash: &str) -> Value {
    json!({"t": t, "control": COMMIT, "value": {"step": step, "hash": hash}, "writer": "net", "player": player})
}

pub fn reveal_entry(t: i64, player: u32, step: i64, bits: u64) -> Value {
    json!({"t": t, "control": REVEAL, "value": {"step": step, "bits": format!("{bits:016x}")},
           "writer": "net", "player": player})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::track::track_of;

    fn track(entries: &[Value]) -> Track {
        let list: Vec<Entry> = entries.iter().filter_map(Entry::parse).collect();
        track_of(&list)
    }

    #[test]
    fn a_draw_completes_once_every_committed_player_revealed_and_keeps_its_number_when_moved() {
        let g = [9; 16];
        let two = track(&[
            commit_entry(10, 1, 3, &"a".repeat(64)),
            commit_entry(10, 2, 3, &"b".repeat(64)),
            reveal_entry(20, 1, 3, 7),
            reveal_entry(30, 2, 3, 8),
        ]);
        let d = derive(&two, &g, Wrong::None);
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].step, d[0].number, d[0].at), (3, 1, 30));
        assert_eq!(d[0].value, value(&g, 1, &[7, 8]));
        // Alone: one reveal completes it, with no commitment; moved a step, it keeps its value.
        let alone = |s: i64| track(&[reveal_entry(s + 1, 1, s, alone_bits(5, 1))]);
        let (a, b) = (
            derive(&alone(4), &[0; 16], Wrong::None),
            derive(&alone(5), &[0; 16], Wrong::None),
        );
        assert_eq!(a[0].value, b[0].value);
        let (a, b) = (
            derive(&alone(4), &[0; 16], Wrong::HashesStep),
            derive(&alone(5), &[0; 16], Wrong::HashesStep),
        );
        assert_ne!(a[0].value, b[0].value, "the planted draw hashes the step");
        let mut region = vec![0; SIZE as usize];
        fill(&d, 20, 30, &mut region);
        assert_eq!(region[..4], 1u32.to_le_bytes());
        assert_eq!(region[8..16], 3i64.to_le_bytes());
    }
}
