//! #552: random draws after commit (canvas primitives: Net: random draws after commit). When a
//! copy confirms a match step that holds an entry on a control in `draw_after`, from any player,
//! it takes 64 bits from its platform's secure random source and sends, in its next message, a
//! commitment: sha256 of the bits, the match ID, its player and that step. Once it holds every
//! player's commitment for the step, it sends its bits. Both are entries on the input track, at
//! their step with their player, so replays and exports read them. Every copy checks each
//! player's bits against that player's commitment: bits that don't match end the match as
//! faulted, naming the player and the step, with the kind `draw`; bits still missing a timeout's
//! worth of match steps after the step's last commitment end it as timeout, naming the player.
//! The draw itself is the logic module's to derive from the track's reveals (`net.draws`).

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Value};

/// The control of a commitment entry, `{step, hash}`.
pub const COMMIT: &str = "draw.commit";
/// The control of a reveal entry, `{step, bits}`.
pub const REVEAL: &str = "draw.reveal";

/// Where a copy's 64 bits come from: the platform's secure random source, which the host hands
/// it, or a seeded test source in a check.
pub type Source = Box<dyn FnMut() -> u64>;

/// A seeded test source: splitmix64 from `seed`.
pub fn seeded(seed: u64) -> Source {
    let mut state = seed ^ 0x6472_6177_4035_3532;
    Box::new(move || {
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    })
}

/// sha256 of the bits, the match ID, the player and the step, as lower-case hex.
pub fn commitment(bits: u64, game: &[u8; 16], player: u8, step: i64) -> String {
    let mut b = bits.to_le_bytes().to_vec();
    b.extend(game);
    b.push(player);
    b.extend(step.to_le_bytes());
    sha256_hex(&b)
}

/// A u64 as an entry carries it: 16 lower-case hex digits, so no JSON reader rounds it.
pub fn bits_hex(bits: u64) -> String {
    format!("{bits:016x}")
}

pub fn bits_of(v: &Value) -> Option<u64> {
    match v {
        Value::String(s) if s.len() == 16 => u64::from_str_radix(s, 16).ok(),
        _ => v.as_u64(),
    }
}

/// Whether a draw entry's value has its shape: a commitment `{step, hash}` with 64 hex digits,
/// a reveal `{step, bits}`.
pub fn admit(control: &str, value: &Value) -> Result<(), Value> {
    let step = value
        .get("step")
        .and_then(Value::as_i64)
        .filter(|s| *s >= 0);
    let ok = match control {
        COMMIT => {
            step.is_some()
                && value["hash"]
                    .as_str()
                    .is_some_and(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))
        }
        _ => step.is_some() && bits_of(&value["bits"]).is_some(),
    };
    if ok {
        Ok(())
    } else {
        Err(
            json!({"code": "out_of_range", "control": control, "value": value,
                   "what": format!("{control} is {{step, {}}}", if control == COMMIT { "hash" } else { "bits" })}),
        )
    }
}

/// What a copy held for one drawn step.
#[derive(Debug, Default)]
struct Pending {
    /// Each player's commitment, by player, and the step whose entries completed them.
    commits: BTreeMap<u8, String>,
    complete_at: Option<i64>,
    reveals: BTreeMap<u8, u64>,
    /// This copy's bits, and whether it sent them.
    bits: u64,
    revealed: bool,
}

/// A wrong copy's draws, reachable only through a host's planted names.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Wrong {
    #[default]
    None,
    /// Its bits differ from its commitment.
    BitsDiffer,
    /// It never sends its bits.
    Withholds,
}

/// A copy's draws: the drawn steps it holds, by step.
pub struct Draws {
    source: Source,
    pending: BTreeMap<i64, Pending>,
    pub wrong: Wrong,
}

/// What a match step's run asks the copy to do about draws: entries to send in its next
/// message, and an ending.
#[derive(Debug, Default)]
pub struct Due {
    pub send: Vec<(String, Value)>,
    pub end: Option<(crate::End, Value)>,
}

impl Draws {
    pub fn new(source: Source) -> Draws {
        Draws {
            source,
            pending: BTreeMap::new(),
            wrong: Wrong::None,
        }
    }

    /// A draw entry of `player` that step `k` put on the track: a commitment is kept, a reveal
    /// checked against it. Bits that don't match end the match as faulted.
    pub fn entered(
        &mut self,
        k: i64,
        player: u8,
        control: &str,
        value: &Value,
        game: &[u8; 16],
    ) -> Option<(crate::End, Value)> {
        let step = value["step"].as_i64()?;
        let p = self.pending.entry(step).or_default();
        if control == COMMIT {
            p.commits
                .insert(player, value["hash"].as_str()?.to_string());
            return None;
        }
        let bits = bits_of(&value["bits"])?;
        p.reveals.insert(player, bits);
        let differs = p
            .commits
            .get(&player)
            .is_none_or(|c| *c != commitment(bits, game, player, step));
        differs.then(|| {
            (
                crate::End::Faulted,
                json!({"step": step, "player": player, "kind": "draw", "item": null, "at": k}),
            )
        })
    }

    /// Match step `k` ran and is confirmed: `drawn` is whether it held an entry on a control in
    /// `draw_after`, `players` how many play, `me` this copy's player, and `timeout` the steps a
    /// missing reveal may take after the step's last commitment.
    pub fn ran(
        &mut self,
        k: i64,
        drawn: bool,
        (players, me): (u8, u8),
        game: &[u8; 16],
        timeout: i64,
    ) -> Due {
        let mut due = Due::default();
        if drawn {
            let bits = (self.source)();
            let p = self.pending.entry(k).or_default();
            p.bits = bits;
            let hash = commitment(bits, game, me, k);
            due.send
                .push((COMMIT.to_string(), json!({"step": k, "hash": hash})));
        }
        for (step, p) in self.pending.iter_mut() {
            if p.commits.len() < players as usize {
                continue;
            }
            let at = *p.complete_at.get_or_insert(k);
            if !p.revealed && p.commits.contains_key(&me) && self.wrong != Wrong::Withholds {
                p.revealed = true;
                let bits = match self.wrong {
                    Wrong::BitsDiffer => p.bits ^ 1,
                    _ => p.bits,
                };
                // The match's ID rides with the bits, so a replay of the track alone derives
                // the same draw.
                due.send.push((
                    REVEAL.to_string(),
                    json!({"step": step, "bits": bits_hex(bits),
                           "match": deep_relay::wire::hex(game)}),
                ));
            }
            let missing = (1..=players).find(|q| !p.reveals.contains_key(q));
            if let (Some(player), true) = (missing, k - at >= timeout) {
                due.end.get_or_insert((
                    crate::End::Timeout,
                    json!({"player": player, "step": step, "kind": "draw"}),
                ));
            }
        }
        // A draw every player revealed is done.
        self.pending
            .retain(|_, p| p.reveals.len() < players as usize);
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_commitment_binds_the_bits_the_match_the_player_and_the_step() {
        let g = [3; 16];
        let c = commitment(42, &g, 1, 10);
        assert_eq!(c.len(), 64);
        for other in [
            commitment(43, &g, 1, 10),
            commitment(42, &[4; 16], 1, 10),
            commitment(42, &g, 2, 10),
            commitment(42, &g, 1, 11),
        ] {
            assert_ne!(c, other);
        }
        assert_eq!(bits_of(&json!(bits_hex(u64::MAX))), Some(u64::MAX));
    }
}
