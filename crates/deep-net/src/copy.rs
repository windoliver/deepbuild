//! One copy of a lockstep match (canvas primitives: Net `net@1`, Net: lockstep, Net: desync and
//! replay). It sends exactly one message for each match step, made when the step `delay` steps
//! before it is the first it hasn't run, with its player's entries; runs match step k only once
//! it holds every player's message for k; puts every entry on its track at its step with its
//! player, in step, player and seq order, never by arrival; hashes its whole carried state every
//! `hash_every` steps and stops at a hash a peer doesn't share; and records the merged track up
//! to the last step it confirmed. Its frames are relay@1's: each repeats its own messages after
//! the lowest step its peers confirmed. The host gives it the time, in flicks, and what arrived.

use std::collections::{BTreeMap, VecDeque};

use deep_relay::wire::{self, Frame, MatchId};
use serde_json::{json, Map, Value};

use crate::card::Card;
use crate::kind::{Config, FLICKS};

/// What a copy steps: the piece's canvas modules with carried state.
pub trait Stepper {
    /// An entry joins the input track at its step, before that step runs.
    fn enter(&mut self, entry: &Value) -> Result<(), Value>;
    /// Runs match step `step`: every stepping item's steps before `until` flicks. A trap is the
    /// error.
    fn run(&mut self, step: i64, until: i64) -> Result<(), Value>;
    /// The full-state hash now: every canvas module's whole carried state but media's.
    fn hash(&mut self) -> u64;
}

/// A wrong copy, reachable only through a host's planted names.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// Runs a step when it is due, whether or not it holds every player's message for it.
    RunsStepEarly,
    /// Its frames carry each message once.
    ResendsNothing,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "net_runs_step_early" => Planted::RunsStepEarly,
            "net_resends_nothing" => Planted::ResendsNothing,
            _ => return None,
        })
    }
}

/// How a match ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum End {
    Left,
    Timeout,
    Desync,
    Faulted,
}

impl End {
    pub fn name(self) -> &'static str {
        match self {
            End::Left => "left",
            End::Timeout => "timeout",
            End::Desync => "desync",
            End::Faulted => "faulted",
        }
    }

    fn named(name: &str) -> End {
        match name {
            "timeout" => End::Timeout,
            "desync" => End::Desync,
            "faulted" => End::Faulted,
            _ => End::Left,
        }
    }
}

/// How long a copy waits before the app or the web player shows its notice: 0.25 s.
pub const NOTICE: i64 = FLICKS / 4;
/// Steps one frame carries at most.
const STEPS_PER_FRAME: usize = 1024;

/// A wait at the copy's last step, for one player's message for `step`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Wait {
    pub step: i64,
    pub player: u8,
    pub from: i64,
    pub to: Option<i64>,
}

/// The waiting notice the app or the web player shows, never the piece.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub player: u8,
    pub from: i64,
    pub to: Option<i64>,
}

/// One player's message for one match step: its entries, a full-state hash it confirmed, and how
/// its copy ended the match, when it did.
#[derive(Clone, Debug, Default, PartialEq)]
struct Message {
    entries: Vec<(String, Value)>,
    hash: Option<(i64, u64)>,
    end: Option<String>,
}

impl Message {
    /// Empty when it holds nothing; else one JSON object with only what it holds.
    fn encode(&self) -> Vec<u8> {
        let mut m = Map::new();
        if !self.entries.is_empty() {
            m.insert("e".into(), json!(self.entries));
        }
        if let Some((step, hash)) = self.hash {
            m.insert("h".into(), json!([step, format!("{hash:016x}")]));
        }
        if let Some(end) = &self.end {
            m.insert("x".into(), json!(end));
        }
        if m.is_empty() {
            return Vec::new();
        }
        Value::Object(m).to_string().into_bytes()
    }

    fn decode(bytes: &[u8]) -> Option<Message> {
        if bytes.is_empty() {
            return Some(Message::default());
        }
        let v: Value = serde_json::from_slice(bytes).ok()?;
        let entries = match v.get("e") {
            None => Vec::new(),
            Some(e) => e
                .as_array()?
                .iter()
                .map(|e| Some((e.get(0)?.as_str()?.to_string(), e.get(1)?.clone())))
                .collect::<Option<_>>()?,
        };
        let hash = match v.get("h") {
            None => None,
            Some(h) => Some((
                h.get(0)?.as_i64()?,
                u64::from_str_radix(h.get(1)?.as_str()?, 16).ok()?,
            )),
        };
        let end = match v.get("x") {
            None => None,
            Some(x) => Some(x.as_str()?.to_string()),
        };
        Some(Message { entries, hash, end })
    }
}

pub struct Copy<S> {
    pub cfg: Config,
    pub card: Card,
    /// This copy's player, 1 to 8, as the relay numbered it.
    pub me: u8,
    players: u8,
    game: MatchId,
    sim: S,
    planted: Planted,
    /// The host's time at the match's start.
    start: i64,
    /// Steps it runs at most; the host leaves once it has.
    limit: i64,
    /// The first step it hasn't run, and when that step is due.
    next: i64,
    due: i64,
    /// Steps it has reached: its messages are made for every step before `reached + delay`.
    reached: i64,
    /// What its player does when a step is the first it hasn't run, by that step.
    script: BTreeMap<i64, Vec<(String, Value)>>,
    /// Its player's entries waiting for the next message, and the hashes waiting with them.
    made: Vec<(String, Value)>,
    owed: VecDeque<(i64, u64)>,
    /// Its own messages no peer has confirmed yet, by step, as they go on the wire.
    mine: BTreeMap<i64, Vec<u8>>,
    /// The first of its own steps that hasn't gone out once (the planted backend's only state).
    sent: i64,
    /// The `confirmed` its last frame carried.
    told: i64,
    /// Per player: the messages held for steps not yet run, those that came early, the steps
    /// held from the start with none missing, and the `confirmed` that player last sent.
    held: Vec<BTreeMap<i64, Message>>,
    early: Vec<BTreeMap<i64, Message>>,
    through: Vec<i64>,
    confirmed_by: Vec<i64>,
    /// The merged input track, as applied.
    track: Vec<Value>,
    hashes: Vec<(i64, u64)>,
    theirs: BTreeMap<i64, Vec<(u8, u64)>>,
    waits: Vec<Wait>,
    notices: Vec<Notice>,
    /// When it ran each step, and the steps it ran without every player's message (planted).
    ran_at: Vec<i64>,
    ran_early: Vec<i64>,
    end: Option<(End, Value)>,
}

impl<S: Stepper> Copy<S> {
    /// Player `me` of `players` in match `game`, at the piece's start, the host's time `now`.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        cfg: Config,
        card: Card,
        me: u8,
        players: u8,
        game: MatchId,
        sim: S,
        planted: Planted,
        now: i64,
    ) -> Copy<S> {
        let n = players as usize;
        let mut copy = Copy {
            card,
            me,
            players,
            game,
            sim,
            planted,
            start: now,
            limit: i64::MAX,
            next: 0,
            due: now,
            reached: 0,
            script: BTreeMap::new(),
            made: Vec::new(),
            owed: VecDeque::new(),
            mine: BTreeMap::new(),
            sent: 0,
            told: -1,
            held: vec![BTreeMap::new(); n],
            early: vec![BTreeMap::new(); n],
            through: vec![0; n],
            confirmed_by: vec![0; n],
            track: Vec::new(),
            hashes: Vec::new(),
            theirs: BTreeMap::new(),
            waits: Vec::new(),
            notices: Vec::new(),
            ran_at: Vec::new(),
            ran_early: Vec::new(),
            end: None,
            cfg,
        };
        // No entry can be stamped before step `delay`: those steps' messages are empty.
        for _ in 0..copy.cfg.delay {
            copy.send(Message::default());
        }
        copy
    }

    /// Runs at most `steps` match steps.
    pub fn limit(&mut self, steps: i64) {
        self.limit = steps;
    }

    /// What its player does: each `(step, control, value)` an entry made when match step `step`
    /// is the first this copy hasn't run.
    pub fn script(&mut self, plays: impl IntoIterator<Item = (i64, String, Value)>) {
        for (step, control, value) in plays {
            self.script.entry(step).or_default().push((control, value));
        }
    }

    /// An entry its player makes now: it takes the first step whose message isn't made.
    pub fn make(&mut self, control: &str, value: Value) {
        self.made.push((control.to_string(), value));
    }

    pub fn ran(&self) -> i64 {
        self.next
    }

    pub fn done(&self) -> bool {
        self.end.is_some() || self.next >= self.limit
    }

    pub fn end(&self) -> Option<End> {
        self.end.as_ref().map(|(e, _)| *e)
    }

    pub fn sim(&self) -> &S {
        &self.sim
    }

    /// The steps it ran before it held every player's message for them.
    pub fn ran_early(&self) -> &[i64] {
        &self.ran_early
    }

    pub fn hashes(&self) -> &[(i64, u64)] {
        &self.hashes
    }

    /// The step its frames show at `now`, -1 before its first, and its waiting notice then: the
    /// player it names and how long the copy has waited.
    pub fn shown(&self, now: i64) -> (i64, Option<(u8, i64)>) {
        let notice = self
            .waits
            .last()
            .filter(|w| w.to.is_none() && now - w.from >= NOTICE)
            .map(|w| (w.player, now - w.from));
        (self.next - 1, notice)
    }

    /// Its message for its next unsent step.
    fn send(&mut self, m: Message) {
        let me = self.me as usize - 1;
        let step = self.through[me];
        self.mine.insert(step, m.encode());
        self.held[me].insert(step, m);
        self.through[me] = step + 1;
    }

    /// The first player whose message for `step` it doesn't hold.
    fn missing(&self, step: i64) -> Option<u8> {
        (0..self.players)
            .find(|p| self.through[*p as usize] <= step)
            .map(|p| p + 1)
    }

    /// The steps it holds every player's message for, from the start with none missing.
    fn confirmed(&self) -> i64 {
        self.through.iter().copied().min().unwrap_or(0)
    }

    fn finish(&mut self, end: End, detail: Value) {
        if self.end.is_some() {
            return;
        }
        self.end = Some((end, detail));
        // The others end it too: its next frames say how.
        if end != End::Left {
            self.send(Message {
                end: Some(end.name().to_string()),
                ..Message::default()
            });
        }
    }

    /// A player's connection ended: the match ends as left on every copy.
    pub fn closed(&mut self, player: u8, reason: &str) {
        if self.end.is_none() {
            self.end = Some((End::Left, json!({"player": player, "reason": reason})));
        }
    }

    /// This copy leaves.
    pub fn leave(&mut self) {
        if self.end.is_none() {
            self.end = Some((End::Left, json!({"player": self.me, "reason": "left"})));
        }
    }

    /// Runs every step that is due and held, at the host's time `now`.
    fn advance(&mut self, now: i64) {
        let step = self.cfg.step();
        while !self.done() && now >= self.due {
            // Reaching a step makes the message `delay` steps after it, once.
            while self.reached <= self.next {
                let made = self.script.remove(&self.reached).unwrap_or_default();
                self.made.extend(made);
                let m = Message {
                    entries: std::mem::take(&mut self.made),
                    hash: self.owed.pop_front(),
                    end: None,
                };
                self.send(m);
                self.reached += 1;
            }
            if let Some(player) = self.missing(self.next) {
                if self.planted != Planted::RunsStepEarly {
                    self.wait(player, now);
                    return;
                }
                self.ran_early.push(self.next);
            }
            let waited = self.resume(now);
            self.run(now);
            self.due = if waited { now + step } else { self.due + step };
        }
    }

    /// The copy waits at its last step for `player`'s message.
    fn wait(&mut self, player: u8, now: i64) {
        match self.waits.last_mut().filter(|w| w.to.is_none()) {
            Some(w) if w.player == player => {}
            Some(w) => {
                w.to = Some(now);
                self.unnotice(now);
                self.waits.push(Wait {
                    step: self.next,
                    player,
                    from: now,
                    to: None,
                });
            }
            None => self.waits.push(Wait {
                step: self.next,
                player,
                from: self.due,
                to: None,
            }),
        }
    }

    /// The wait ends: whether the copy waited at all.
    fn resume(&mut self, now: i64) -> bool {
        let Some(w) = self.waits.last_mut().filter(|w| w.to.is_none()) else {
            return false;
        };
        if now <= w.from {
            self.waits.pop();
            return false;
        }
        w.to = Some(now);
        let (player, from) = (w.player, w.from);
        // A wait that passed 0.25 s between two looks still showed its notice.
        if now - from > NOTICE && self.notices.last().is_none_or(|n| n.to.is_some()) {
            self.notices.push(Notice {
                player,
                from: from + NOTICE,
                to: None,
            });
        }
        self.unnotice(now);
        true
    }

    fn unnotice(&mut self, now: i64) {
        if let Some(n) = self.notices.last_mut().filter(|n| n.to.is_none()) {
            n.to = Some(now);
        }
    }

    /// The notice after 0.25 s of waiting, and the timeout.
    fn watch(&mut self, now: i64) {
        if self.end.is_some() {
            return;
        }
        let Some(w) = self.waits.last().filter(|w| w.to.is_none()) else {
            return;
        };
        let (player, from, step) = (w.player, w.from, w.step);
        if now - from >= NOTICE && self.notices.last().is_none_or(|n| n.to.is_some()) {
            self.notices.push(Notice {
                player,
                from: from + NOTICE,
                to: None,
            });
        }
        if now - from >= self.cfg.timeout {
            self.finish(End::Timeout, json!({"player": player, "step": step}));
        }
    }

    /// Runs match step `next`: every player's entries for it join the track in player and seq
    /// order, then the piece steps.
    fn run(&mut self, now: i64) {
        let (k, len) = (self.next, self.cfg.step());
        for p in 0..self.players as usize {
            let Some(m) = self.held[p].remove(&k) else {
                continue;
            };
            let writer = if p + 1 == self.me as usize {
                "you"
            } else {
                "peer"
            };
            for (seq, (control, value)) in m.entries.into_iter().enumerate() {
                let entry = json!({"t": k * len, "seq": seq, "control": control, "value": value,
                                   "writer": writer, "player": p + 1});
                if self.sim.enter(&entry).is_ok() {
                    self.track.push(entry);
                }
            }
        }
        if let Err(trap) = self.sim.run(k, (k + 1) * len) {
            self.finish(End::Faulted, json!({"step": k, "trap": trap}));
            return;
        }
        self.ran_at.push(now);
        self.next += 1;
        if k % self.cfg.hash_every == 0 {
            let hash = self.sim.hash();
            self.hashes.push((k, hash));
            self.owed.push_back((k, hash));
            self.compare(k);
        }
    }

    /// A full-state hash a peer doesn't share stops the match.
    fn compare(&mut self, step: i64) {
        let Ok(at) = self.hashes.binary_search_by_key(&step, |(s, _)| *s) else {
            return;
        };
        let own = self.hashes[at].1;
        let other = self
            .theirs
            .get(&step)
            .and_then(|list| list.iter().find(|(_, h)| *h != own));
        if let Some((player, hash)) = other.copied() {
            let (me, mine) = (self.me, format!("{own:016x}"));
            self.finish(
                End::Desync,
                json!({"first_step": step, "players": [me, player],
                       "hashes": [mine, format!("{hash:016x}")]}),
            );
        }
    }

    /// A message of `player` (0-based) for `step`, taken once, in step order.
    fn take(&mut self, player: usize, step: i64, m: Message) {
        if let Some((at, hash)) = m.hash {
            self.theirs
                .entry(at)
                .or_default()
                .push((player as u8 + 1, hash));
            self.compare(at);
        }
        if let (Some(end), true) = (&m.end, self.end.is_none()) {
            self.end = Some((End::named(end), json!({"player": player + 1})));
        }
        // A step already run keeps what it ran with: only a copy that ran early gets here.
        if step >= self.next {
            self.held[player].insert(step, m);
        }
    }

    /// A frame another copy of the match sent arrived, at the host's time `now`. The first copy
    /// of each (player, step) is kept and the rest dropped.
    pub fn receive(&mut self, bytes: &[u8], now: i64) {
        let Ok(frame) = Frame::decode(bytes) else {
            return;
        };
        let p = frame.player as usize;
        if frame.game != self.game || frame.player >= self.players || p + 1 == self.me as usize {
            return;
        }
        self.confirmed_by[p] = self.confirmed_by[p].max(frame.confirmed as i64);
        for (i, bytes) in frame.steps.iter().enumerate() {
            let step = frame.first as i64 + i as i64;
            if step < self.through[p] || self.early[p].contains_key(&step) {
                continue;
            }
            if let Some(m) = Message::decode(bytes) {
                self.early[p].insert(step, m);
            }
        }
        while let Some(m) = self.early[p].remove(&self.through[p]) {
            let step = self.through[p];
            self.through[p] = step + 1;
            self.take(p, step, m);
        }
        self.advance(now);
        self.watch(now);
    }

    /// The host's tick, once a match step's time at the least: runs what is due and gives the
    /// frame to send, which repeats every message of its own after the lowest step its peers
    /// confirmed, oldest first.
    pub fn tick(&mut self, now: i64) -> Option<Vec<u8>> {
        self.advance(now);
        self.watch(now);
        let me = self.me as usize - 1;
        let lowest = (0..self.players as usize)
            .filter(|p| *p != me)
            .map(|p| self.confirmed_by[p])
            .min()
            .unwrap_or(0);
        self.mine = self.mine.split_off(&lowest);
        let from = match self.planted {
            Planted::ResendsNothing => self.sent.max(lowest),
            _ => lowest,
        };
        let mut steps: Vec<Vec<u8>> = Vec::new();
        let mut bytes = wire::HEADER;
        for (_, m) in self.mine.range(from..).take(STEPS_PER_FRAME) {
            bytes += 2 + m.len();
            if bytes as u64 > wire::FRAME_BYTES {
                break;
            }
            steps.push(m.clone());
        }
        let confirmed = self.confirmed();
        if steps.is_empty() && (self.planted == Planted::ResendsNothing || confirmed == self.told) {
            return None;
        }
        self.sent = from + steps.len() as i64;
        self.told = confirmed;
        Some(
            Frame {
                game: self.game,
                player: self.me - 1,
                confirmed: confirmed as u32,
                first: from as u32,
                steps,
            }
            .encode(),
        )
    }

    /// The merged input track up to the last step it confirmed, in step, player and seq order.
    fn merged(&self) -> Vec<Value> {
        let (len, confirmed) = (self.cfg.step(), self.confirmed());
        let mut track = self.track.clone();
        for step in self.next..confirmed {
            for p in 0..self.players as usize {
                let Some(m) = self.held[p].get(&step) else {
                    continue;
                };
                let writer = if p + 1 == self.me as usize {
                    "you"
                } else {
                    "peer"
                };
                for (seq, (control, value)) in m.entries.iter().enumerate() {
                    track.push(json!({"t": step * len, "seq": seq, "control": control,
                                      "value": value, "writer": writer, "player": p + 1}));
                }
            }
        }
        track
    }

    /// The match's record (Net: desync and replay): what replays it exactly.
    pub fn record(&self) -> Value {
        json!({
            "document": self.card.document,
            "module_set_digest": self.card.set,
            "runtime_digest": self.card.runtime,
            "players": self.players,
            "track": self.merged(),
            "confirmed": self.confirmed() - 1,
            "end": self.end().map(End::name),
        })
    }

    /// What the copy did: every time in seconds since the match's start.
    pub fn report(&self) -> Map<String, Value> {
        let s = |t: i64| (t - self.start) as f64 / FLICKS as f64;
        let hashes: Vec<Value> = self
            .hashes
            .iter()
            .map(|(step, h)| json!({"step": step, "hash": format!("{h:016x}")}))
            .collect();
        let waits: Vec<Value> = self
            .waits
            .iter()
            .map(|w| json!({"step": w.step, "player": w.player, "from": s(w.from), "to": w.to.map(s)}))
            .collect();
        let notices: Vec<Value> = self
            .notices
            .iter()
            .map(|n| json!({"player": n.player, "from": s(n.from), "to": n.to.map(s)}))
            .collect();
        let mut out = Map::new();
        out.insert("player".into(), json!(self.me));
        out.insert("ran".into(), json!(self.next));
        out.insert("rollbacks".into(), json!(0));
        out.insert("hashes".into(), json!(hashes));
        out.insert("waits".into(), json!(waits));
        out.insert("notices".into(), json!(notices));
        out.insert("end".into(), json!(self.end().map(End::name)));
        if let Some((_, detail)) = &self.end {
            out.insert("ended".into(), detail.clone());
        }
        out.insert("record".into(), self.record());
        out.insert(
            "ran_at".into(),
            json!(self.ran_at.iter().map(|t| s(*t)).collect::<Vec<_>>()),
        );
        out
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A piece whose whole state is a running word over its entries, in the order it got them.
    #[derive(Default)]
    pub(crate) struct Word {
        pub word: u64,
        pub steps: i64,
    }

    impl Stepper for Word {
        fn enter(&mut self, entry: &Value) -> Result<(), Value> {
            let (player, value) = (
                entry["player"].as_u64().unwrap(),
                entry["value"].as_f64().unwrap(),
            );
            self.word = self
                .word
                .wrapping_mul(31)
                .wrapping_add(player * 1000 + (value as i64 + 8) as u64);
            Ok(())
        }
        fn run(&mut self, step: i64, _: i64) -> Result<(), Value> {
            assert_eq!(step, self.steps, "steps run once each, in order");
            self.steps += 1;
            self.word = self.word.wrapping_mul(7).wrapping_add(1);
            Ok(())
        }
        fn hash(&mut self) -> u64 {
            self.word
        }
    }

    pub(crate) fn cfg(delay: i64, hash_every: i64) -> Config {
        Config {
            item: "match".into(),
            relay: "https://relay.test".into(),
            host: "relay.test".into(),
            players: 2,
            step_rate: 20,
            delay,
            window: 0,
            hash_every,
            timeout: 5 * FLICKS,
        }
    }

    fn pair(delay: i64) -> [Copy<Word>; 2] {
        [1, 2].map(|me| {
            Copy::new(
                cfg(delay, 1),
                Card::default(),
                me,
                2,
                [7; 16],
                Word::default(),
                Planted::None,
                0,
            )
        })
    }

    #[test]
    fn a_copy_runs_a_step_only_once_it_holds_every_players_message() {
        let [mut a, mut b] = pair(2);
        let step = a.cfg.step();
        a.script([(0, "push".to_string(), json!(3))]);
        // Alone, copy 1 runs the two steps no entry can reach and then waits for player 2.
        let frame = a.tick(0).unwrap();
        assert_eq!(a.ran(), 0, "player 2's message for step 0 hasn't come");
        b.receive(&frame, 0);
        let back = b.tick(0).unwrap();
        assert_eq!(b.ran(), 1);
        a.receive(&back, 0);
        assert_eq!(a.ran(), 1);
        assert!(
            a.report()["waits"].as_array().unwrap().is_empty(),
            "a wait of no time isn't one"
        );
        // The entry made at step 0 lands at step 2 on both copies, as player 1's.
        for k in 1..=3 {
            let (fa, fb) = (a.tick(k * step), b.tick(k * step));
            b.receive(&fa.unwrap(), k * step);
            a.receive(&fb.unwrap(), k * step);
        }
        assert_eq!((a.ran(), b.ran()), (4, 4));
        assert_eq!(a.hashes(), b.hashes());
        let (ra, rb) = (a.record(), b.record());
        assert_eq!(ra["track"][0]["t"], json!(2 * step));
        assert_eq!(
            (&ra["track"][0]["writer"], &rb["track"][0]["writer"]),
            (&json!("you"), &json!("peer"))
        );
        assert_eq!(rb["track"][0]["player"], json!(1));
    }

    #[test]
    fn a_dropped_frame_is_recovered_from_the_next_one_and_a_planted_backend_stalls() {
        for planted in [Planted::None, Planted::ResendsNothing] {
            let mut a = Copy::new(
                cfg(1, 1),
                Card::default(),
                1,
                2,
                [7; 16],
                Word::default(),
                planted,
                0,
            );
            let mut b = Copy::new(
                cfg(1, 1),
                Card::default(),
                2,
                2,
                [7; 16],
                Word::default(),
                Planted::None,
                0,
            );
            let step = a.cfg.step();
            for k in 0..6 {
                let (fa, fb) = (a.tick(k * step), b.tick(k * step));
                // Copy 1's second frame is lost.
                if let (Some(f), true) = (fa, k != 1) {
                    b.receive(&f, k * step);
                }
                if let Some(f) = fb {
                    a.receive(&f, k * step);
                }
            }
            match planted {
                Planted::None => assert!(b.ran() >= 5, "{}", b.ran()),
                _ => assert_eq!(b.ran(), 2, "the lost message for step 2 never comes again"),
            }
        }
    }

    #[test]
    fn a_wait_shows_the_notice_from_a_quarter_second_and_ends_the_match_at_the_timeout() {
        let [mut a, _] = pair(0);
        let step = a.cfg.step();
        for k in 0..=100 {
            a.tick(k * step);
        }
        let r = a.report();
        assert_eq!(
            r["waits"],
            json!([{"step": 0, "player": 2, "from": 0.0, "to": null}])
        );
        assert_eq!(
            r["notices"],
            json!([{"player": 2, "from": 0.25, "to": null}])
        );
        assert_eq!((a.ran(), a.end()), (0, Some(End::Timeout)));
        assert_eq!(a.shown(FLICKS), (-1, Some((2, FLICKS))));
        assert_eq!(a.record()["end"], json!("timeout"));
    }

    #[test]
    fn a_hash_a_peer_does_not_share_stops_the_match() {
        let [mut a, mut b] = pair(1);
        let step = a.cfg.step();
        b.sim.word = 1;
        for k in 0..4 {
            let (fa, fb) = (a.tick(k * step), b.tick(k * step));
            if let Some(f) = fa {
                b.receive(&f, k * step);
            }
            if let Some(f) = fb {
                a.receive(&f, k * step);
            }
        }
        assert_eq!((a.end(), b.end()), (Some(End::Desync), Some(End::Desync)));
        assert_eq!(a.report()["ended"]["first_step"], json!(0));
    }
}
