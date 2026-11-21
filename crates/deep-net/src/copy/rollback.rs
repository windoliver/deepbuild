//! #551: a copy with a rollback window (canvas primitives: Net: rollback). Until a player's
//! message for a step arrives the copy predicts their input as their last one, which adds no
//! entry; it runs at most `window` steps past the last step it holds every player's message for,
//! and waits there. A message that brings an entry stamped at a step already run adds it to the
//! track at that step and, at the copy's next tick, every late entry the host brought rolls it
//! back once, to the earliest of them: each canvas module restores its rollback checkpoint there
//! and the copy steps forward to now, as a seek does, dropping what the replaced steps made. A
//! step's full-state hash goes out, and its entries reach the record, only once it is confirmed;
//! a trap holds the copy until its step is. A copy whose lead on its peers passes one match step,
//! averaged over a second, holds its clock one step in every 10.

use std::collections::{BTreeMap, VecDeque};

use deep_relay::wire::Frame;
use serde_json::{json, Map, Value};

use super::{Copy, End, Planted, Stepper};

/// Where a copy stands in rolling back.
#[derive(Debug, Default)]
pub(super) struct Roll {
    /// The merged track's hash at the start of each step it may roll back to.
    pub(super) trail: BTreeMap<i64, u64>,
    /// The earliest step a late entry came for since its last rollback.
    pub(super) late: Option<i64>,
    /// Steps before it are confirmed and ran with every player's entries: final.
    pub(super) settled: i64,
    /// Each rollback: the first step it hadn't run, and the step it went back to.
    pub(super) rollbacks: Vec<(i64, i64)>,
    /// A trap in a step past confirmed, and its fault: the copy waits there.
    pub(super) trapped: Option<(i64, Value)>,
    /// Each peer's last message step its frames carried.
    heard: Vec<Option<i64>>,
    /// Its lead over the last second, a sample a step, and the steps it ran while leading.
    leads: VecDeque<f64>,
    beats: i64,
    /// The steps its clock held.
    pub(super) held: Vec<i64>,
}

impl Roll {
    pub(super) fn new(players: u8) -> Roll {
        Roll {
            heard: vec![None; players as usize],
            ..Roll::default()
        }
    }
}

impl<S: Stepper> Copy<S> {
    /// Whether the next step waits, and for whose message: in lockstep, any player's for it; with
    /// a window, the first missing player's once the copy is `window` steps past confirmed or a
    /// trap holds it.
    pub(super) fn blocked(&self) -> Option<u8> {
        if self.cfg.window == 0 {
            return self.missing(self.next);
        }
        let c = self.confirmed();
        if self.roll.trapped.is_some() || self.next >= c + self.cfg.window {
            return self.missing(c).or(Some(self.me));
        }
        None
    }

    /// Player `player`'s entries for step `k`, kept in player order.
    pub(super) fn logged(&mut self, k: i64, player: u8, entries: Vec<(String, Value)>) {
        if entries.is_empty() {
            return;
        }
        let list = self.log.entry(k).or_default();
        let at = list.partition_point(|(p, _)| *p <= player);
        list.insert(at, (player, entries));
    }

    /// A message for a step already run: nothing new rolls nothing back; an entry joins the
    /// track at its step and the copy rolls back there at its next tick.
    pub(super) fn late(&mut self, player: u8, step: i64, entries: Vec<(String, Value)>) {
        if entries.is_empty() {
            return;
        }
        let at = match self.planted {
            Planted::AppliesLateAtArrival => {
                let next = self.next;
                self.logged(next, player, entries);
                return;
            }
            Planted::RewindsToLastRead => self.roll.late.map_or(step, |l| l.max(step)),
            _ => self.roll.late.map_or(step, |l| l.min(step)),
        };
        self.logged(step, player, entries);
        self.roll.late = Some(at);
        self.arrived();
    }

    /// The planted copy records each player's predicted input at step `k` as an entry.
    pub(super) fn predicted(&mut self, k: i64) {
        if self.planted != Planted::RecordsPredicted || self.cfg.window == 0 {
            return;
        }
        for p in (1..=self.players).filter(|p| *p != self.me && self.through[*p as usize - 1] <= k)
        {
            let last = self
                .log
                .range(..k)
                .rev()
                .find_map(|(_, list)| list.iter().rev().find(|(q, _)| *q == p))
                .and_then(|(_, entries)| entries.last().cloned());
            if let Some((control, value)) = last {
                let e = self.stamped(k, p, 0, &control, &value);
                self.track.push(e);
            }
        }
    }

    /// A peer's frame: the last step its messages reach.
    pub(super) fn heard(&mut self, p: usize, frame: &Frame) {
        if let Some(last) = (frame.first as i64 + frame.steps.len() as i64).checked_sub(1) {
            let h = &mut self.roll.heard[p];
            *h = Some(h.map_or(last, |x| x.max(last)));
        }
    }

    /// The rollback depth, its last step run less confirmed, as its own frames show it and as
    /// peer `p`'s show theirs: their last message step less `delay`, less their `confirmed`.
    fn depth_of(&self, p: usize) -> Option<i64> {
        let last = if p == self.me as usize - 1 {
            Some(self.through[p] - 1)
        } else {
            self.roll.heard[p]
        }?;
        let confirmed = if p == self.me as usize - 1 {
            self.confirmed()
        } else {
            self.confirmed_by[p]
        };
        Some(last - self.cfg.delay - confirmed)
    }

    /// The lead rule: half its depth less the smallest of its peers', averaged over a second; a
    /// copy whose lead passes one match step holds its clock one step in every 10.
    pub(super) fn leads(&mut self) -> bool {
        if self.cfg.window == 0 || self.planted == Planted::IgnoresLeadRule {
            return false;
        }
        let me = self.me as usize - 1;
        let peers = (0..self.players as usize).filter(|p| *p != me);
        let (Some(own), Some(least)) = (
            self.depth_of(me),
            peers.filter_map(|p| self.depth_of(p)).min(),
        ) else {
            return false;
        };
        self.roll.leads.push_back((own - least) as f64 / 2.0);
        while self.roll.leads.len() > self.cfg.step_rate as usize {
            self.roll.leads.pop_front();
        }
        let lead = self.roll.leads.iter().sum::<f64>() / self.roll.leads.len() as f64;
        if lead <= 1.0 {
            return false;
        }
        self.roll.beats += 1;
        let hold = self.roll.beats % 10 == 0;
        if hold {
            self.roll.held.push(self.next);
        }
        hold
    }

    /// Rolls back once to the earliest late entry since the last rollback: every canvas module
    /// restores its checkpoint there and the copy steps forward to now, in the order a straight
    /// run uses; what the replaced steps made goes.
    pub(super) fn rewind(&mut self) {
        let Some(s) = self.roll.late.take() else {
            return;
        };
        if s >= self.next || self.end.is_some() {
            return;
        }
        // #280: what the copy drew before it rolls back, for net.feel's correction distance.
        let before = self.shown_now();
        if let Err(why) = self.sim.back(s, s * self.cfg.step()) {
            let fault = json!({"step": s, "item": null, "kind": "rollback", "why": why});
            self.finish(End::Faulted, fault);
            return;
        }
        let (to, len) = (self.next, self.cfg.step());
        self.roll.rollbacks.push((to, s));
        // The track is in step order: what the replaced steps put on it is its tail.
        let kept = self
            .track
            .partition_point(|e| e["t"].as_i64().is_some_and(|t| t < s * len));
        self.track.truncate(kept);
        self.refused
            .retain(|r| r["step"].as_i64().is_some_and(|k| k < s));
        if let Some(h) = self.roll.trail.get(&s) {
            self.track_hash = *h;
        }
        self.roll.trail.retain(|k, _| *k < s);
        self.hashes.retain(|h| h.step < s);
        if self.roll.trapped.as_ref().is_some_and(|(k, _)| *k >= s) {
            self.roll.trapped = None;
        }
        self.next = s;
        while self.next < to && self.roll.trapped.is_none() && self.end.is_none() {
            self.run(self.now);
        }
        self.corrected(&before, to);
    }

    /// Steps confirmed and run with every player's entries become final: each one's full-state
    /// hash goes out and is compared, and a trap in one ends the match as faulted.
    pub(super) fn settle(&mut self) {
        if self.cfg.window == 0 || self.roll.late.is_some() {
            return;
        }
        let upto = self.confirmed().min(self.next);
        if let Some((k, fault)) = self.roll.trapped.clone() {
            if k < upto {
                self.finish(End::Faulted, fault);
                return;
            }
        }
        while self.roll.settled < upto {
            let k = self.roll.settled;
            self.roll.settled += 1;
            if let Ok(i) = self.hashes.binary_search_by_key(&k, |h| h.step) {
                let h = self.hashes[i];
                self.owed.push_back(h);
                self.compare(k);
            }
        }
        let settled = self.roll.settled;
        self.roll.trail.retain(|k, _| *k >= settled);
    }

    /// The merged track of the steps it confirmed and ran with every player's entries.
    pub(super) fn settled_track(&self) -> Vec<Value> {
        let before = self.roll.settled * self.cfg.step();
        let at = |e: &Value| e["t"].as_i64().unwrap_or(i64::MAX);
        self.track
            .iter()
            .filter(|e| at(e) < before)
            .cloned()
            .collect()
    }

    /// The last step its record holds: the last it confirmed.
    pub(super) fn last_confirmed(&self) -> i64 {
        if self.cfg.window > 0 {
            return self.roll.settled - 1;
        }
        match self.end {
            Some(_) => self.next.min(self.confirmed()) - 1,
            None => self.confirmed() - 1,
        }
    }

    /// #551: a seek after the match to match step `step`: `{step, from, hash}`, the checkpoint it
    /// restored and the full-state hash there.
    pub fn seek(&mut self, step: i64) -> Value {
        match self.sim.seek(step, self.cfg.step()) {
            Ok((from, hash)) => {
                json!({"step": step, "from": from, "hash": crate::message::hex(hash)})
            }
            Err(why) => json!({"step": step, "error": why}),
        }
    }

    /// Its rollbacks, `(the first step it hadn't run, the step it went back to)`.
    pub fn rolled(&self) -> &[(i64, i64)] {
        &self.roll.rollbacks
    }

    /// The steps before it are final: confirmed, and run with every player's entries.
    pub fn settled(&self) -> i64 {
        match self.cfg.window {
            0 => self.next.min(self.confirmed()),
            _ => self.roll.settled,
        }
    }

    /// Its rollbacks' depths, the steps each ran again, with their mean and histogram, and the
    /// steps its clock held under the lead rule.
    pub(super) fn roll_report(&self, out: &mut Map<String, Value>) {
        let depths: Vec<i64> = self.roll.rollbacks.iter().map(|(to, s)| to - s).collect();
        let mut histogram = BTreeMap::<i64, u64>::new();
        for d in &depths {
            *histogram.entry(*d).or_default() += 1;
        }
        let mean = match depths.len() {
            0 => 0.0,
            n => depths.iter().sum::<i64>() as f64 / n as f64,
        };
        let histogram: Map<String, Value> = histogram
            .into_iter()
            .map(|(d, n)| (d.to_string(), json!(n)))
            .collect();
        // `from`: the last step it had run when it rolled back; its depth is `from − to + 1`.
        let rolled: Vec<Value> = self
            .roll
            .rollbacks
            .iter()
            .map(|(at, to)| json!({"from": at - 1, "to": to}))
            .collect();
        out.insert(
            "depth".into(),
            json!({"mean": mean, "max": depths.iter().max(), "histogram": histogram}),
        );
        out.insert("rolled_back".into(), json!(rolled));
        let settled = self.settled();
        let occurrences: Vec<Value> = self
            .sim
            .occurrences()
            .into_iter()
            .filter(|r| r["step"].as_i64().is_some_and(|k| k < settled))
            .collect();
        out.insert("occurrences".into(), json!(occurrences));
        out.insert("held".into(), json!(self.roll.held));
        out.insert("confirmed".into(), json!(self.last_confirmed()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::copy::tests::{cfg, Word};
    use crate::kind::{Config, FLICKS};
    use crate::play::{play, Ask, Faults, Play, Played};

    fn run(window: i64, back: i64, planted: Planted) -> Played<Word> {
        let plays = (1..=2u8)
            .map(|p| {
                let list = (0..390)
                    .filter(|g| (g + p as i64) % 3 == 0)
                    .map(|g| Play {
                        step: g,
                        control: "push".into(),
                        value: json!((g * 7 + p as i64 * 3) % 17 - 8),
                        to: None,
                    })
                    .collect();
                (p, list)
            })
            .collect();
        let ask = Ask {
            steps: 400,
            plays,
            faults: Faults {
                seed: 551,
                back,
                ..Faults::default()
            },
            planted,
            ..Ask::default()
        };
        let c = Config {
            window,
            ..cfg(2, 1)
        };
        play(&c, &Card::default(), &ask, &mut |_| Ok(Word::default())).unwrap()
    }

    #[test]
    fn late_entries_roll_back_to_the_on_time_runs_hashes_and_track() {
        let s = FLICKS / 20;
        let on_time = run(8, 0, Planted::None);
        let held = run(8, 8 * s, Planted::None);
        for (a, b) in held.copies.iter().zip(&on_time.copies) {
            assert_eq!((a.ran(), a.end(), a.settled()), (400, None, 400));
            assert!(!a.rolled().is_empty());
            assert!(a.rolled().iter().all(|(at, to)| at - to <= 8));
            assert_eq!(a.hashes(), b.hashes());
            assert_eq!(a.record()["track"], b.record()["track"]);
        }
        let twin = run(8, 8 * s, Planted::AppliesLateAtArrival);
        assert_ne!(twin.copies[0].hashes(), on_time.copies[0].hashes());
        let twin = run(8, 8 * s, Planted::RecordsPredicted);
        assert_ne!(
            twin.copies[0].record()["track"],
            on_time.copies[0].record()["track"]
        );
    }

    /// Mean rollback depth of each copy, and how long each waited at its window, with one-way
    /// latencies of 5 ms and 80 ms.
    fn lean(planted: Planted) -> Vec<(f64, usize)> {
        let plays = (1..=2u8)
            .map(|p| {
                let list = (0..1190)
                    .map(|g| Play {
                        step: g,
                        control: "push".into(),
                        value: json!((g * 7 + p as i64 * 3) % 17 - 8),
                        to: None,
                    })
                    .collect();
                (p, list)
            })
            .collect();
        let ask = Ask {
            steps: 1200,
            plays,
            faults: Faults {
                latency: vec![FLICKS / 200, FLICKS * 2 / 25],
                ..Faults::default()
            },
            planted,
            ..Ask::default()
        };
        let c = Config {
            window: 8,
            step_rate: 60,
            ..cfg(2, 60)
        };
        let played = play(&c, &Card::default(), &ask, &mut |_| Ok(Word::default())).unwrap();
        played
            .copies
            .iter()
            .map(|c| {
                let r = c.report();
                (
                    r["depth"]["mean"].as_f64().unwrap(),
                    r["waits"].as_array().unwrap().len(),
                )
            })
            .collect()
    }

    #[test]
    fn the_lead_rule_evens_rollback_depth_across_latencies_and_a_copy_without_it_does_not() {
        let even = lean(Planted::None);
        assert!((even[0].0 - even[1].0).abs() <= 1.0, "{even:?}");
        assert!(even.iter().all(|(_, waits)| *waits == 0), "{even:?}");
        let uneven = lean(Planted::IgnoresLeadRule);
        assert!((uneven[0].0 - uneven[1].0).abs() > 1.0, "{uneven:?}");
    }
}
