//! #277: seats that change while a match runs (canvas primitives: Net `net@1`). In a piece whose
//! logic reads `net.seats`, a leave, a drop or a long silence doesn't end the match: the net
//! module stamps one `seat {player, state}` entry, the writer `net`, on every copy's track at one
//! step every copy agrees on, from which that player's controls hold no entries and no copy waits
//! on its messages, so the piece's rules hand the seat to its bot.
//!
//! A leave's step: when a copy's connection ends or its messages stop for `timeout`, each copy
//! tells the others the last step it holds that player's message for (relay@2 `holds`), forwards
//! the messages another lacks, and stamps `left` at the step after the highest, once it holds
//! them all; until then it waits at the window, as it does for any late message. A copy about to
//! be hidden sends `absent` as its next unsent step's message and stops; back, it asks for every
//! message since its last step (`catch_up`), steps them headless until it holds no more, and sends
//! `back` stamped `delay` steps ahead. Seats travel as the messages' own entries, named
//! [`SEAT`], so a forwarded or caught-up message carries them as the track holds them.

use std::collections::{BTreeMap, BTreeSet};

use deep_relay::wire::{self, Frame};
use serde_json::{json, Map, Value};

use super::{Copy, End, Message, Planted, Stepper, STEPS_PER_FRAME};

/// The name a seat takes among a message's entries and on the input track's list of controls,
/// which no control's ID can be (each of an ID's segments starts with a letter or a digit).
pub const SEAT: &str = ":seat";
/// What a logic item reads to see the seats (`{player, state, step}`).
pub const NET_SEATS: &str = "net.seats";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seat {
    Left,
    Absent,
    Back,
    /// #278: a copy joined: at step 0 with those there at the start, or later while the lobby
    /// is open.
    Joined,
}

impl Seat {
    pub fn named(name: &str) -> Option<Seat> {
        Some(match name {
            "left" => Seat::Left,
            "absent" => Seat::Absent,
            "back" => Seat::Back,
            "joined" => Seat::Joined,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Seat::Left => "left",
            Seat::Absent => "absent",
            Seat::Back => "back",
            Seat::Joined => "joined",
        }
    }

    /// The seat a message's entries set, if any.
    pub(super) fn of(m: &Message) -> Option<Seat> {
        m.entries
            .iter()
            .find(|(c, _)| c == SEAT)
            .and_then(|(_, v)| Seat::named(v.as_str()?))
    }
}

/// A leave the copies are agreeing on: each copy's last step it holds the player's message for,
/// by copy, and when this copy began it.
#[derive(Debug, Default)]
struct Leaving {
    holds: BTreeMap<u8, i64>,
    since: i64,
}

/// This copy's own absence: the step its `absent` took, and once it returned, what it asked from,
/// when, the peers heard since and the step it had reached.
#[derive(Debug, Default)]
pub(super) struct Away {
    returned: Option<i64>,
    from: i64,
    heard: BTreeSet<usize>,
    reached: i64,
    /// The CPU time its modules had taken when it returned, and the host's frames since: `{steps,
    /// ms}` each.
    spent: u64,
    frames: Vec<Value>,
    /// #278: it joins the match from its start: it enters with `joined`, not `back`, at `enter`
    /// or the first step after it that every copy still has to confirm.
    pub(super) join: bool,
    enter: i64,
}

impl Away {
    /// #278: a copy that joins a running match at `now`: back from the match's start, with
    /// everything to step.
    pub(super) fn joining(now: i64, spent: u64, enter: i64) -> Away {
        Away {
            returned: Some(now),
            spent,
            join: true,
            enter,
            ..Away::default()
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct Seats {
    /// Per player, 0-based: the seat its last message held set, and that message's step; a seat
    /// nobody took at the start is left from before step 0 (#278).
    pub(super) last: Vec<Option<(i64, Seat)>>,
    leaving: BTreeMap<usize, Leaving>,
    /// relay@2 messages, and frames of other players' messages, to send beside its own.
    pub(super) out: Vec<Value>,
    frames: Vec<Vec<u8>>,
    /// Players catching up, 0-based, counted in the repeat rule from the step they asked from.
    pub(super) returning: BTreeMap<usize, i64>,
    pub(super) away: Option<Away>,
    /// While it is away, the step of the first message it sends after its `absent`, such as how
    /// its match ended: no peer's `confirmed` counts it, so its frames keep it until it is back.
    pub(super) since: Option<i64>,
    /// Steps one call runs at most while catching up, as the host slices them.
    pub(super) slice: Option<i64>,
    /// Each catch-up it ran: `{from, to, steps, seconds, steps_per_s, frames?}`, the first and last
    /// step it ran headless and the CPU seconds they took, and the host's frames.
    caught: Vec<Value>,
}

impl Seats {
    pub(super) fn new(players: u8) -> Seats {
        Seats {
            last: vec![None; players as usize],
            ..Seats::default()
        }
    }

    /// A frame of player `p`'s came: a copy catching up counts that it heard from them.
    pub(super) fn heard(&mut self, p: usize) {
        if let Some(a) = self.away.as_mut().filter(|a| a.returned.is_some()) {
            a.heard.insert(p);
        }
    }
}

impl<S: Stepper> Copy<S> {
    /// Whether the copy waits on player `p`'s (0-based) messages: not from a left or absent seat.
    pub(super) fn seated(&self, p: usize) -> bool {
        !matches!(self.seats.last[p], Some((_, Seat::Left | Seat::Absent)))
    }

    /// Whether player `p`'s seat is left: nothing it sends counts any more.
    pub(super) fn gone(&self, p: usize) -> bool {
        matches!(self.seats.last[p], Some((_, Seat::Left)))
    }

    /// Player `player`'s connection ended or its messages stopped: in a piece whose rules play
    /// a left seat, the copies agree on the step it's left at, and the match goes on. False where
    /// the match ends as before.
    pub(super) fn leaves(&mut self, player: u8) -> bool {
        if !self.cfg.seats || player == 0 || player > self.players || self.end.is_some() {
            return false;
        }
        // A leave no copy agrees on within the timeout ends the match after all.
        let since = self
            .seats
            .leaving
            .get(&(player as usize - 1))
            .map(|l| l.since);
        if since.is_some_and(|t| self.now - t >= self.cfg.timeout) {
            return false;
        }
        if player != self.me {
            self.start_leave(player as usize - 1);
        }
        true
    }

    fn start_leave(&mut self, p: usize) {
        if self.gone(p) || self.seats.leaving.contains_key(&p) {
            return;
        }
        match self.planted {
            Planted::StampsLeaveWhenNoticed => return self.stamp(p, self.next),
            Planted::SkipsLeaveExchange => return self.stamp(p, self.through[p]),
            _ => {}
        }
        let last = self.through[p] - 1;
        let mut holds = BTreeMap::new();
        if self.seated(self.me as usize - 1) {
            holds.insert(self.me, last);
        }
        let since = self.now;
        self.seats.leaving.insert(p, Leaving { holds, since });
        let game = wire::hex(&self.game);
        self.seats
            .out
            .push(json!({"holds": {"match": game, "player": p, "last": last}}));
        self.try_stamp(p);
    }

    /// The highest step any copy said it holds player `p`'s message for: a leave being agreed
    /// takes no message of theirs past it, so the leave's step is the step after it everywhere.
    fn cap(&self, p: usize) -> Option<i64> {
        let l = self.seats.leaving.get(&p)?;
        Some(
            l.holds
                .values()
                .copied()
                .max()
                .unwrap_or(self.through[p] - 1),
        )
    }

    /// Once every seated copy said what it holds and this copy holds it all, `left` at the step
    /// after the highest.
    fn try_stamp(&mut self, p: usize) {
        let Some(l) = self.seats.leaving.get(&p) else {
            return;
        };
        let told = (0..self.players as usize)
            .filter(|r| *r != p && self.seated(*r) && !self.seats.leaving.contains_key(r))
            .all(|r| l.holds.contains_key(&(r as u8 + 1)));
        if !told {
            return;
        }
        let at = l
            .holds
            .values()
            .copied()
            .max()
            .unwrap_or(self.through[p] - 1)
            + 1;
        if self.through[p] >= at {
            self.stamp(p, at);
        }
    }

    /// Player `p`'s seat is left from step `at`: nothing of theirs from it on counts.
    fn stamp(&mut self, p: usize, at: i64) {
        self.early[p].clear();
        self.held[p].retain(|k, _| *k < at);
        let entries = vec![(super::SEAT.to_string(), json!(Seat::Left.name()))];
        if at >= self.next {
            self.held[p].insert(
                at,
                Message {
                    entries,
                    ..Message::default()
                },
            );
        } else if self.cfg.window > 0 {
            self.late(p as u8 + 1, at, entries);
        } else {
            self.logged(at, p as u8 + 1, entries);
        }
        self.through[p] = at + 1;
        self.seats.last[p] = Some((at, Seat::Left));
        self.seats.leaving.remove(&p);
        self.seats.returning.remove(&p);
    }

    /// Takes player `p`'s messages that came, in step order: a leave being agreed takes none past
    /// the highest step a copy holds, and a seat back from an absence resumes at its `back`.
    pub(super) fn take_early(&mut self, p: usize) {
        loop {
            if self.cap(p).is_some_and(|cap| self.through[p] > cap) {
                break;
            }
            if let Some(m) = self.early[p].remove(&self.through[p]) {
                let step = self.through[p];
                self.through[p] = step + 1;
                self.take(p, step, m);
                continue;
            }
            // #278: a left seat, or one nobody took, resumes at a `joined`.
            let wants = match self.seats.last[p] {
                Some((_, Seat::Absent)) => Some(Seat::Back),
                Some((_, Seat::Left)) => Some(Seat::Joined),
                _ => None,
            };
            let resumes = wants
                .and_then(|w| self.early[p].iter().next().map(|e| (w, e)))
                .filter(|(w, (_, m))| Seat::of(m) == Some(*w))
                .map(|(_, (k, _))| *k);
            match resumes {
                Some(k) => self.through[p] = k,
                None => break,
            }
        }
        self.try_stamp(p);
    }

    /// A message of player `p`'s for `step` was taken: the seat it sets.
    pub(super) fn seat_of(&mut self, p: usize, step: i64, m: &Message) {
        if let Some(seat) = Seat::of(m) {
            self.seats.last[p] = Some((step, seat));
            if matches!(seat, Seat::Back | Seat::Joined) {
                self.seats.returning.remove(&p);
            }
        }
    }

    /// The planted catch-up applies the messages it missed in the order they arrived: each joins
    /// its step's entries after those that came before it, not in player order.
    pub(super) fn arrived(&mut self, p: usize, step: i64, m: &Message) -> bool {
        let catching = self
            .seats
            .away
            .as_ref()
            .is_some_and(|a| a.returned.is_some());
        if self.planted != Planted::CatchesUpInArrivalOrder || !catching || step < self.next {
            return false;
        }
        if !m.entries.is_empty() {
            let list = self.log.entry(step).or_default();
            list.push((p as u8 + 1, m.entries.clone()));
        }
        true
    }

    /// Whether the next step waits for this copy's absence: away, it runs nothing; back, only the
    /// steps it holds every seated player's message for, at most `slice` of them a call.
    pub(super) fn away(&mut self, slice: &mut Option<i64>) -> bool {
        let Some(a) = &self.seats.away else {
            return false;
        };
        if a.returned.is_none() || self.next >= self.confirmed() {
            return true;
        }
        if let Some(n) = slice.as_mut() {
            if *n <= 0 {
                return true;
            }
            *n -= 1;
        }
        if self.planted == Planted::JumpsToConfirmed {
            let to = self.confirmed().min(self.limit);
            // The steps' entries still join its track and record; it runs none of them.
            for k in self.next..to {
                for p in 0..self.players as usize {
                    if let Some(m) = self.held[p].remove(&k) {
                        self.logged(k, p as u8 + 1, m.entries);
                    }
                }
                for (player, entries) in self.log.get(&k).cloned().unwrap_or_default() {
                    let h = crate::locate::entries_hash(k, player, &entries);
                    self.track_hash = crate::locate::track_after(self.track_hash, h);
                    for (seq, (control, value)) in entries.iter().enumerate() {
                        if crate::kind::admit(&self.cfg.controls, control, value).is_ok() {
                            let entry = self.stamped(k, player, seq, control, value);
                            self.track.push(entry);
                        }
                    }
                }
            }
            self.sim.jump(to, to * self.cfg.step());
            self.next = to;
            self.reached = self.reached.max(to);
            self.roll.settled = self.roll.settled.max(to);
            return true;
        }
        // It makes no message while it's away: what its player did then goes.
        for k in self.reached..=self.next {
            self.script.remove(&k);
        }
        self.made.clear();
        self.reached = self.reached.max(self.next + 1);
        false
    }

    /// The host is about to hide or pause this copy: its next unsent step's message says it is
    /// absent, and it stops; no copy waits on it from that step.
    pub fn absent(&mut self, now: i64) {
        if !self.cfg.seats || self.seats.away.is_some() || self.end.is_some() {
            return;
        }
        self.now = self.now.max(now);
        let me = self.me as usize - 1;
        let at = self.through[me];
        self.made.clear();
        let hash = self.owed.pop_front();
        self.send(Message {
            entries: vec![(super::SEAT.to_string(), json!(Seat::Absent.name()))],
            hash,
            ..Message::default()
        });
        self.seats.last[me] = Some((at, Seat::Absent));
        self.seats.since = Some(at + 1);
        self.seats.away = Some(Away::default());
        let game = wire::hex(&self.game);
        self.seats.out.push(
            json!({"seat": {"match": game, "player": me, "state": "absent", "after": at - 1}}),
        );
    }

    /// The host shows or resumes this copy again: it asks for every message since its last step.
    pub fn returned(&mut self, now: i64) {
        let me = self.me as usize - 1;
        let from = (0..self.players as usize)
            .filter(|p| *p != me && !self.gone(*p))
            .map(|p| self.through[p])
            .min()
            .unwrap_or(self.next);
        let next = self.next;
        let Some(a) = self.seats.away.as_mut().filter(|a| a.returned.is_none()) else {
            return;
        };
        a.returned = Some(now);
        a.from = from;
        a.reached = next;
        a.spent = self.sim.spent();
        // Its steps stay due from where it stopped: it runs them as fast as they come.
        self.now = self.now.max(now);
        let game = wire::hex(&self.game);
        self.seats
            .out
            .push(json!({"catch_up": {"match": game, "from": from}}));
    }

    /// Whether this copy is away, or back and catching up.
    pub fn is_away(&self) -> bool {
        self.seats.away.is_some()
    }

    /// Whether this copy is back from an absence and still catching up.
    pub fn catching(&self) -> bool {
        self.seats
            .away
            .as_ref()
            .is_some_and(|a| a.returned.is_some())
    }

    /// The steps a call runs at most while catching up: the host's slice, or every one.
    pub fn slice(&mut self, steps: Option<i64>) {
        self.seats.slice = steps;
    }

    /// One of the host's frames while it catches up: the steps it ran and their CPU ms; a frame
    /// that finished the catch-up joins the catch-up it finished.
    pub fn catch_frame(&mut self, steps: i64, ms: f64) {
        let frame = json!({"steps": steps, "ms": ms});
        if let Some(a) = self.seats.away.as_mut().filter(|a| a.returned.is_some()) {
            a.frames.push(frame);
        } else if let Some(Value::Array(frames)) = self
            .seats
            .caught
            .last_mut()
            .and_then(|u| u.get_mut("frames"))
        {
            frames.push(frame);
        } else if let Some(u) = self.seats.caught.last_mut() {
            u["frames"] = json!([frame]);
        }
    }

    /// Back and catching up, it has reached the others once it ran every step it holds every
    /// seated player's message for or every step due by now, holds every message each seated
    /// peer's frames named and heard from each since it returned: it sends `back`, stamped
    /// `delay` steps ahead.
    pub(super) fn caught_up(&mut self, now: i64) {
        let Some(a) = &self.seats.away else {
            return;
        };
        // A match that ended while it was away ends there: it never comes back.
        if a.returned.is_none() || self.end.is_some() {
            return;
        }
        let me = self.me as usize - 1;
        // Every step it holds, or every step due by now: it runs on the clock again.
        if self.next < self.confirmed().min(self.limit) && now >= self.due {
            return;
        }
        let behind = (0..self.players as usize)
            .filter(|p| *p != me && self.seated(*p))
            .any(|p| {
                !a.heard.contains(&p) || self.roll.heard[p].is_some_and(|h| h >= self.through[p])
            });
        if behind {
            return;
        }
        let (reached, spent) = (a.reached, a.spent);
        let mut frames = a.frames.clone();
        // #278: a copy that joins enters two windows further on, so its `joined` reaches every copy
        // before that copy confirms the step, however late the relay hands it on; and no earlier
        // than the step the copy that let it in named, which doesn't move with the network.
        let (seat, ahead, enter) = match a.join {
            true => (Seat::Joined, 2 * self.cfg.window, a.enter),
            false => (Seat::Back, 0, 0),
        };
        let back = (self.next + self.cfg.delay + ahead)
            .max(self.through[me])
            .max(enter);
        self.through[me] = back;
        let mut entries = vec![(super::SEAT.to_string(), json!(seat.name()))];
        let made = self.script.remove(&self.next).unwrap_or_default();
        entries.extend(super::seen_by(&made, self.me));
        self.made.clear();
        let hash = self.owed.pop_front();
        self.send(Message {
            entries,
            hash,
            ..Message::default()
        });
        self.reached = self.next + 1;
        self.seats.last[me] = Some((back, seat));
        if seat == Seat::Joined {
            self.entered();
        }
        self.seats.away = None;
        self.seats.since = None;
        self.due = now;
        let steps = self.next - reached;
        let seconds = self.sim.spent().saturating_sub(spent) as f64 / 1e9;
        let rate = if seconds > 0.0 {
            steps as f64 / seconds
        } else {
            0.0
        };
        let mut up = json!({"from": reached, "to": self.next - 1, "steps": steps,
                            "seconds": seconds, "steps_per_s": rate});
        if !frames.is_empty() {
            up["frames"] = json!(std::mem::take(&mut frames));
        }
        self.seats.caught.push(up);
        let game = wire::hex(&self.game);
        self.seats.out.push(
            json!({"seat": {"match": game, "player": me, "state": seat.name(), "after": back - 1}}),
        );
    }

    /// A relay@2 message, or relay@1's `closed`, the relay handed this copy: `sender` names the
    /// copy that sent it, as the relay numbers seats.
    pub fn relay(&mut self, m: &Value, now: i64) {
        self.now = self.now.max(now);
        let seat = |v: &Value| v.as_u64().map(|p| p as usize);
        if let Some(c) = m.get("closed") {
            let player = seat(&c["player"]).map_or(0, |p| p as u8 + 1);
            self.closed(player, c["reason"].as_str().unwrap_or("left"));
        } else if let Some(h) = m.get("holds") {
            let (Some(by), Some(p), Some(last)) =
                (seat(&h["sender"]), seat(&h["player"]), h["last"].as_i64())
            else {
                return;
            };
            if by < self.players as usize && p < self.players as usize {
                self.held_by(by as u8 + 1, p, last);
            }
        } else if let Some(c) = m.get("catch_up") {
            if let (Some(by), Some(from)) = (seat(&c["sender"]), c["from"].as_i64()) {
                if by < self.players as usize && by + 1 != self.me as usize {
                    self.serve(by, from);
                }
            }
        } else if let Some(k) = m.get("knock") {
            self.knocked(&k["player"]);
        }
        self.watch(now);
        self.locate();
    }

    /// Copy `by` holds player `p`'s messages through `last`: this copy joins the leave, forwards
    /// what it holds past that, and stamps once every seated copy has said. A copy told it left
    /// itself was dropped: its match ends as left.
    fn held_by(&mut self, by: u8, p: usize, last: i64) {
        if p + 1 == self.me as usize {
            if self.cfg.seats && self.end.is_none() {
                self.end = Some((End::Left, json!({"player": self.me, "reason": "dropped"})));
            }
            return;
        }
        if !self.cfg.seats {
            return;
        }
        self.start_leave(p);
        let to = match self.seats.last[p] {
            Some((at, Seat::Left)) => at,
            _ => self.through[p],
        };
        self.forward(p, last + 1, to);
        if let Some(l) = self.seats.leaving.get_mut(&p) {
            l.holds.insert(by, last);
        }
        self.take_early(p);
    }

    /// Copy `by` (0-based) is back and catching up from `from`: this copy repeats its own messages
    /// from there until that copy confirms them, and sends the messages no copy repeats, a left,
    /// absent or leaving seat's.
    fn serve(&mut self, by: usize, from: i64) {
        self.seats.returning.insert(by, from);
        self.confirmed_by[by] = from;
        let me = self.me as usize - 1;
        for k in from.max(0)..self.through[me] {
            if !self.mine.contains_key(&k) {
                if let Some(m) = self.message_of(me, k) {
                    self.mine.insert(k, m.encode());
                }
            }
        }
        // #278: a copy that joins a seat somebody left gets that seat's messages too.
        let joins = self.gone(by);
        for p in 0..self.players as usize {
            let unsent = !self.seated(p) || self.seats.leaving.contains_key(&p);
            if p != me && unsent && (p != by || joins) {
                self.forward(p, from, self.through[p]);
            }
        }
    }

    /// Player `p`'s message for step `k`, as it holds it: its entries and seat, from its log for
    /// a step it ran, else as it came; none for a step it doesn't hold.
    fn message_of(&self, p: usize, k: i64) -> Option<Message> {
        if k < 0 || k >= self.through[p] {
            return None;
        }
        let mut entries: Vec<(String, Value)> = if k < self.next {
            let list = self.log.get(&k).into_iter().flatten();
            list.filter(|(q, _)| *q as usize == p + 1)
                .flat_map(|(_, e)| e.clone())
                .collect()
        } else {
            self.held[p].get(&k)?.entries.clone()
        };
        // #278: the seats a room started with are every copy's own stamp at step 0, never sent.
        if k == 0 {
            entries.retain(|(c, v)| !(c == super::SEAT && v == Seat::Joined.name()));
        }
        Some(Message {
            entries,
            ..Message::default()
        })
    }

    /// Frames of player `p`'s messages for steps `from..to` that it holds, to the other copies.
    fn forward(&mut self, p: usize, from: i64, to: i64) {
        let mut steps: Vec<Vec<u8>> = Vec::new();
        let mut first = from.max(0);
        let mut bytes = wire::HEADER;
        for k in first..to.min(self.through[p]) {
            let Some(m) = self.message_of(p, k) else {
                break;
            };
            let m = m.encode();
            if steps.len() == STEPS_PER_FRAME || (bytes + 2 + m.len()) as u64 > wire::FRAME_BYTES {
                self.forwarded(p, first, std::mem::take(&mut steps));
                first = k;
                bytes = wire::HEADER;
            }
            bytes += 2 + m.len();
            steps.push(m);
        }
        if !steps.is_empty() {
            self.forwarded(p, first, steps);
        }
    }

    fn forwarded(&mut self, p: usize, first: i64, steps: Vec<Vec<u8>>) {
        let frame = Frame {
            game: self.game,
            player: p as u8,
            confirmed: 0,
            first: first as u32,
            steps,
        };
        self.seats.frames.push(frame.encode());
    }

    /// What the copy has to send beside its tick's frame: relay@2 messages, and frames of other
    /// players' messages, each to the match's other copies.
    pub fn sends(&mut self) -> (Vec<Value>, Vec<Vec<u8>>) {
        (
            std::mem::take(&mut self.seats.out),
            std::mem::take(&mut self.seats.frames),
        )
    }

    /// The seats its track holds, `{step, player, state}`, and each catch-up it ran.
    pub(super) fn seat_report(&self, out: &mut Map<String, Value>) {
        let len = self.cfg.step();
        let seats: Vec<Value> = self
            .track
            .iter()
            .filter_map(|e| {
                let s = e.get("seat")?;
                Some(json!({"step": e["t"].as_i64()? / len, "player": s["player"], "state": s["state"]}))
            })
            .collect();
        out.insert("seats".into(), json!(seats));
        out.insert("catch_ups".into(), json!(self.seats.caught));
        out.insert("away".into(), json!(self.seats.away.is_some()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::copy::tests::{cfg, Word};
    use crate::kind::{Config, FLICKS};
    use crate::play::{play, Ask, Fate, Faults, Play, Played, Withhold};

    /// Four copies of a piece whose rules play a left seat, 20 Hz, each player's entries seeded.
    fn four(window: i64, faults: Faults, planted: Planted) -> Played<Word> {
        let plays = (1..=4u8)
            .map(|p| {
                let list = (0..590)
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
        let c = Config {
            players: 4,
            window,
            seats: true,
            ..cfg(2, 20)
        };
        let ask = Ask {
            steps: 600,
            plays,
            faults,
            planted,
            ..Ask::default()
        };
        play(&c, &Card::default(), &ask, &mut |_| Ok(Word::default())).unwrap()
    }

    fn seats(c: &Copy<Word>) -> Vec<(i64, i64, String)> {
        let r = c.report();
        r["seats"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| {
                (
                    s["step"].as_i64().unwrap(),
                    s["player"].as_i64().unwrap(),
                    s["state"].as_str().unwrap().to_string(),
                )
            })
            .collect()
    }

    /// A copy's record track, each entry's writer aside: a copy's own entries are its `you`.
    fn track(c: &Copy<Word>) -> Vec<Value> {
        let mut t = c.record()["track"].as_array().unwrap().clone();
        for e in &mut t {
            e.as_object_mut().unwrap().remove("writer");
        }
        t
    }

    fn kill(at: i64) -> Faults {
        Faults {
            fates: vec![Fate::Kill {
                player: 3,
                step: at,
            }],
            latency: vec![0, FLICKS / 100, FLICKS / 40, FLICKS / 70],
            ..Faults::default()
        }
    }

    #[test]
    fn a_killed_copy_is_left_at_one_step_on_every_other_copy_and_the_match_plays_on() {
        for window in [0, 8] {
            let played = four(window, kill(100), Planted::None);
            let others: Vec<&Copy<Word>> = [0, 1, 3].iter().map(|i| &played.copies[*i]).collect();
            let first = seats(others[0]);
            assert_eq!(first.len(), 1, "window {window}: {first:?}");
            assert_eq!((first[0].1, first[0].2.as_str()), (3, "left"));
            assert!(first[0].0 >= 100, "{first:?}");
            for c in &others {
                assert_eq!((c.ran(), c.end()), (600, None), "window {window}");
                assert_eq!(seats(c), first);
                assert_eq!(c.hashes(), others[0].hashes());
                assert_eq!(track(c), track(others[0]));
            }
            let holds = played
                .controls
                .iter()
                .filter(|m| m["message"].get("holds").is_some());
            assert_eq!(holds.count(), 3, "each other copy tells what it holds");
        }
    }

    #[test]
    fn a_leave_stamped_where_each_copy_noticed_parts_the_copies() {
        let spread = Faults {
            latency: vec![0, FLICKS / 5, 0, FLICKS / 2],
            ..kill(100)
        };
        let played = four(8, spread, Planted::StampsLeaveWhenNoticed);
        let steps: BTreeSet<i64> = [0, 1, 3]
            .iter()
            .flat_map(|i| seats(&played.copies[*i]).into_iter().map(|s| s.0))
            .collect();
        assert!(steps.len() > 1, "{steps:?}");
        let ends: Vec<_> = [0, 1, 3].iter().map(|i| played.copies[*i].end()).collect();
        assert!(ends.contains(&Some(End::Desync)), "{ends:?}");
    }

    #[test]
    fn a_copy_missing_the_leavers_last_messages_gets_them_before_the_leave() {
        let withheld = |planted| {
            let faults = Faults {
                withhold: vec![Withhold {
                    player: 3,
                    to: 2,
                    last: 4,
                }],
                fates: vec![Fate::Kill {
                    player: 3,
                    step: 100,
                }],
                ..Faults::default()
            };
            four(8, faults, planted)
        };
        let played = withheld(Planted::None);
        let all = [0, 1, 3].map(|i| seats(&played.copies[i]));
        assert!(all.iter().all(|s| *s == all[0] && s.len() == 1), "{all:?}");
        for i in [0, 1, 3] {
            assert_eq!(played.copies[i].end(), None);
            assert_eq!(played.copies[i].hashes(), played.copies[0].hashes());
        }
        let twin = withheld(Planted::SkipsLeaveExchange);
        let (two, one) = (seats(&twin.copies[1]), seats(&twin.copies[0]));
        assert_eq!(two[0].0 + 4, one[0].0, "{two:?} {one:?}");
        assert_eq!(twin.copies[0].end(), Some(End::Desync));
    }

    fn hide(planted: Planted, frozen: bool) -> Played<Word> {
        let len = 10 * FLICKS;
        let fate = match frozen {
            true => Fate::Freeze {
                player: 2,
                step: 120,
            },
            false => Fate::Hide {
                player: 2,
                step: 120,
                len,
            },
        };
        let faults = Faults {
            fates: vec![fate],
            ..Faults::default()
        };
        four(8, faults, planted)
    }

    #[test]
    fn a_hidden_copy_is_absent_catches_up_and_comes_back_to_equal_hashes() {
        let played = hide(Planted::None, false);
        let all: Vec<_> = played.copies.iter().map(seats).collect();
        assert!(all.iter().all(|s| *s == all[0]), "{all:?}");
        let states: Vec<&str> = all[0].iter().map(|s| s.2.as_str()).collect();
        assert_eq!(states, ["absent", "back"], "{all:?}");
        for c in &played.copies {
            assert_eq!(c.end(), None, "{:?}", c.report()["ended"]);
            assert_eq!(c.hashes(), played.copies[0].hashes());
            let waits = c.report()["waits"].as_array().unwrap().len();
            assert!(waits <= 2, "{waits}");
        }
        assert_eq!(
            played.copies[1].report()["catch_ups"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let twin = hide(Planted::CatchesUpInArrivalOrder, false);
        assert!(twin.copies.iter().any(|c| c.end() == Some(End::Desync)));
    }

    #[test]
    fn a_frozen_copy_without_absent_is_left_after_the_timeout() {
        let played = hide(Planted::None, true);
        let all: Vec<_> = [0, 2, 3]
            .iter()
            .map(|i| seats(&played.copies[*i]))
            .collect();
        assert!(all.iter().all(|s| *s == all[0] && s.len() == 1), "{all:?}");
        assert_eq!((all[0][0].1, all[0][0].2.as_str()), (2, "left"));
        for i in [0, 2, 3] {
            assert_eq!(played.copies[i].end(), None);
        }
    }
}
