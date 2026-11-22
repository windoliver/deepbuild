//! #278: rooms that gather and play again (canvas primitives: Net `net@1`). A net item that
//! declares `players: {min, max}` starts its match with whoever joined before the first player's
//! Start: every copy stamps one `seat {player, joined}` entry at step 0 for each of them, the
//! writer `net`, and a seat nobody took holds none, so the piece's rules play it. While the
//! logic array a piece names as `open` is true at a copy's last confirmed step, a copy may join
//! the running match: it asks for every message from step 0 (#277's `catch_up`), steps them
//! headless as they come, and enters with its own `joined`, stamped two windows past the last
//! step it ran, so the entry reaches every copy before that copy confirms its step. A nonzero
//! value in the array named `finish` ends the match as finished once its step is confirmed; a
//! step still resting on a prediction ends nothing.

use std::collections::BTreeMap;

use deep_relay::wire;
use serde_json::{json, Map, Value};

use super::seats::Away;
use super::{Copy, End, Planted, Seat, Stepper, SEAT};

/// How far before now a joining copy's steps are due: it runs every step it holds as it comes.
const LONG_AGO: i64 = 1 << 50;

#[derive(Debug, Default)]
pub(super) struct Room {
    /// Per step run and not yet confirmed: whether `open` was true and `finish` nonzero after it.
    flags: BTreeMap<i64, (bool, bool)>,
    /// `open` after each of the last confirmed steps, two windows of them and two more: a
    /// Join is taken by the lobby as it stood two windows before the step the copy runs next,
    /// which every copy has confirmed by then, however late its peers' messages come.
    open: BTreeMap<i64, bool>,
    /// Why the relay or the copies refused this copy's Join.
    refused: Option<String>,
    /// It entered with `joined` and makes no message of its own before that entry's step.
    entering: bool,
}

impl<S: Stepper> Copy<S> {
    /// The room's match starts with `seated`, the players who joined before the first player's
    /// Start: each gets one `joined` entry at step 0 on this copy's track, as on every copy's,
    /// and every other seat is nobody's. Before its first tick.
    pub fn seat(&mut self, seated: &[u8]) {
        for p in 1..=self.players {
            match seated.contains(&p) {
                true => self.logged(0, p, vec![(SEAT.to_string(), json!(Seat::Joined.name()))]),
                false => self.seats.last[p as usize - 1] = Some((-1, Seat::Left)),
            }
        }
    }

    /// This copy joins a match already running, in a seat nobody holds: it asks for every
    /// message from step 0 and steps them headless, as a copy back from an absence does, then
    /// enters with `joined`. `at` is the step the copy that let it in was about to run: it
    /// enters three windows and two delays after it, where its replay and the relay's lateness
    /// allow, so the step it enters at depends on when it joined and not on the network. After
    /// `seat`, before its first tick.
    pub fn join(&mut self, now: i64, at: i64) {
        let me = self.me as usize - 1;
        self.mine.clear();
        self.held[me].clear();
        self.through[me] = 0;
        // Its seat is nobody's until its `joined`: whoever held it before left it.
        self.seats.last[me] = Some((-1, Seat::Left));
        let enter = at.max(0) + 3 * self.cfg.window + 2 * self.cfg.delay + 2;
        self.seats.away = Some(Away::joining(now, self.sim.spent(), enter));
        self.due = now - LONG_AGO;
        self.now = self.now.max(now);
        let game = wire::hex(&self.game);
        self.seats
            .out
            .push(json!({"catch_up": {"match": game, "from": 0}}));
    }

    /// The ID of the match this copy plays.
    pub fn game(&self) -> wire::MatchId {
        self.game
    }

    /// Whether this copy is joining a running match and hasn't entered yet.
    pub fn joining(&self) -> bool {
        self.seats.away.as_ref().is_some_and(|a| a.join)
    }

    /// The relay or the match's copies refused this copy's Join: it plays nothing.
    pub fn refuse(&mut self, why: &str) {
        self.room.refused = Some(why.to_string());
        self.limit = 0;
    }

    /// Whether the piece's lobby is open: a Join after the start is accepted only then. It is
    /// the lobby of a step every copy has confirmed, two windows before the one this copy runs
    /// next, or the first step it still holds.
    pub fn lobby_open(&self) -> bool {
        let at = self.next - 1 - 2 * self.cfg.window;
        let known = self.room.open.range(..=at).next_back();
        let open = known.or(self.room.open.iter().next()).map(|(_, o)| *o);
        open == Some(true) && self.end.is_none()
    }

    /// The relay handed on a Join made after the start, for seat `player`: this copy says whether
    /// its lobby is open, and the relay seats the Join or refuses it.
    pub(super) fn knocked(&mut self, player: &Value) {
        if !self.cfg.room() || self.end.is_some() || self.is_away() {
            return;
        }
        let game = wire::hex(&self.game);
        let (open, at) = (self.lobby_open(), self.next);
        self.seats
            .out
            .push(json!({"admit": {"match": game, "player": player, "open": open, "at": at}}));
    }

    /// The players whose seats are taken now, 1-based: who the room's next match starts with.
    pub fn seated_now(&self) -> Vec<u8> {
        (1..=self.players)
            .filter(|p| self.seated(*p as usize - 1))
            .collect()
    }

    /// A message of a seat nobody holds counts only from a `joined` on: that entry's own message,
    /// or one right after a message already kept.
    pub(super) fn rejoins(&self, p: usize, step: i64, joined: bool) -> bool {
        joined || self.early[p].contains_key(&(step - 1))
    }

    /// A copy that joined sends `joined` ahead of the steps it runs: its next message waits until
    /// it reaches the step `delay` before it, so its entries keep the match's delay.
    pub(super) fn enters(&mut self) -> bool {
        if !self.room.entering {
            return false;
        }
        let me = self.me as usize - 1;
        self.room.entering = self.through[me] > self.reached + self.cfg.delay;
        // What its player did before its seat was in goes.
        if self.room.entering {
            self.made.clear();
        }
        self.room.entering
    }

    pub(super) fn entered(&mut self) {
        self.room.entering = true;
    }

    /// Match step `k` ran: what it left in the piece's `open` and `finish` arrays. In lockstep
    /// the step is confirmed as it runs; the planted copy ends on a step it only predicted.
    pub(super) fn flag(&mut self, k: i64) {
        let read = |sim: &mut S, named: &Option<(String, String)>| {
            let (item, array) = named.as_ref()?;
            sim.value(item, array)
        };
        let open = read(&mut self.sim, &self.cfg.open);
        let finish = read(&mut self.sim, &self.cfg.finish);
        if open.is_none() && finish.is_none() {
            return;
        }
        let flags = (
            open.is_some_and(|v| v != 0.0),
            finish.is_some_and(|v| v != 0.0),
        );
        self.room.flags.insert(k, flags);
        if self.cfg.window == 0 {
            self.confirm(k);
        } else if flags.1 && self.planted == Planted::FinishesOnPredicted {
            self.finish(End::Finished, json!({"step": k}));
        }
    }

    /// Match step `k` is confirmed: its `open` is the lobby's, and a nonzero `finish` ends the
    /// match as finished on this copy, as it does on every copy that confirms the step. Whether
    /// it ended.
    pub(super) fn confirm(&mut self, k: i64) -> bool {
        let Some((open, finish)) = self.room.flags.remove(&k) else {
            return false;
        };
        self.room.open.insert(k, open);
        let kept = 2 * self.cfg.window + 2;
        while self.room.open.len() as i64 > kept {
            self.room.open.pop_first();
        }
        if finish {
            self.finish(End::Finished, json!({"step": k}));
        }
        finish
    }

    /// A rollback to step `s` replaces what the steps from it on left.
    pub(super) fn unflag(&mut self, s: i64) {
        self.room.flags.split_off(&s);
    }

    pub(super) fn room_report(&self, out: &mut Map<String, Value>) {
        if let Some(why) = &self.room.refused {
            out.insert("join_refused".into(), json!(why));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::Card;
    use crate::copy::tests::{cfg, Word};
    use crate::kind::Config;
    use crate::play::{play, Ask, Deliver, Fate, Faults, Join, Next, Play, Played, Start, Wrong};

    fn plays(
        people: u8,
        steps: i64,
        stay: Option<(u8, i64)>,
    ) -> std::collections::BTreeMap<u8, Vec<Play>> {
        (1..=people)
            .map(|p| {
                let mut list: Vec<Play> = (0..steps - 2)
                    .filter(|g| (g + p as i64) % 3 == 0)
                    .map(|g| Play {
                        step: g,
                        control: "push".into(),
                        value: json!((g * 7 + p as i64 * 3) % 15 - 7),
                        to: None,
                    })
                    .collect();
                if let Some((_, at)) = stay.filter(|(who, _)| *who == p) {
                    list.push(Play {
                        step: at,
                        control: "push".into(),
                        value: json!(8),
                        to: None,
                    });
                }
                (p, list)
            })
            .collect()
    }

    /// An eight-seat room of a piece whose rules play every seat nobody holds.
    fn room() -> Config {
        Config {
            players: 8,
            min: 2,
            ranged: true,
            open: Some(("rules".into(), "lobby".into())),
            window: 8,
            seats: true,
            ..cfg(2, 20)
        }
    }

    fn run(c: &Config, ask: Ask, word: Word) -> Played<Word> {
        play(c, &Card::default(), &ask, &mut |_| {
            Ok(Word {
                open_until: word.open_until,
                finish_at: word.finish_at,
                ..Word::default()
            })
        })
        .unwrap()
    }

    fn three(steps: i64) -> Ask {
        Ask {
            steps,
            plays: plays(4, steps, None),
            start: Some(Start {
                joined: vec![1, 2, 3],
                click: true,
            }),
            ..Ask::default()
        }
    }

    fn seats(c: &Copy<Word>) -> Vec<(i64, i64, String)> {
        let r = c.report();
        let list = r["seats"].as_array().unwrap().iter();
        list.map(|s| {
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

    #[test]
    fn a_room_starts_with_whoever_joined_and_only_on_a_click() {
        let played = run(&room(), three(200), Word::default());
        assert_eq!(played.copies.len(), 3);
        let start: Vec<_> = (1..=3).map(|p| (0, p, "joined".to_string())).collect();
        for c in &played.copies {
            assert_eq!((c.ran(), c.end()), (200, None));
            assert_eq!(seats(c), start);
            assert_eq!(c.hashes(), played.copies[0].hashes());
            assert_eq!(track(c), track(&played.copies[0]));
        }
        let unclicked = |planted| {
            let mut ask = three(60);
            ask.start.as_mut().unwrap().click = false;
            ask.planted = planted;
            run(&room(), ask, Word::default())
        };
        let lobby = unclicked(Planted::None);
        assert_eq!(lobby.copies.len(), 3);
        assert!(lobby
            .copies
            .iter()
            .all(|c| c.ran() == 0 && c.end().is_none()));
        let twin = unclicked(Planted::StartsOnThirdJoin);
        assert!(twin.copies.iter().all(|c| c.ran() > 0));
    }

    fn joins(player: u8, step: i64) -> Ask {
        Ask {
            joins: vec![Join { player, step }],
            log: true,
            ..three(400)
        }
    }

    #[test]
    fn a_copy_joins_an_open_lobby_from_step_0_and_enters_at_one_step() {
        // Frames held back by up to the window, as net.rollback holds them: the entry still
        // reaches every copy before it confirms the step.
        for held in [None, Some(crate::play::Held::UpTo(8))] {
            let mut ask = joins(4, 120);
            ask.faults.held = held;
            ask.faults.seed = 278;
            let played = run(&room(), ask, Word::default());
            assert_eq!(played.copies.len(), 4);
            let four = &played.copies[3];
            let entered: Vec<_> = seats(four).into_iter().filter(|s| s.1 == 4).collect();
            assert_eq!(entered.len(), 1, "{held:?}: {entered:?}");
            assert!(
                entered[0].0 > 120 && entered[0].2 == "joined",
                "{entered:?}"
            );
            for c in &played.copies {
                assert_eq!((c.ran(), c.end()), (400, None), "{held:?} copy {}", c.me);
                assert_eq!(seats(c), seats(four));
                assert_eq!(track(c), track(four));
            }
            let theirs: std::collections::BTreeMap<i64, u64> =
                played.copies[0].hashes().into_iter().collect();
            assert!(four.hashes().len() >= 19, "{:?}", four.hashes().len());
            assert!(four.hashes().iter().all(|(k, h)| theirs.get(k) == Some(h)));
            let ups = four.report()["catch_ups"].clone();
            assert_eq!(ups.as_array().unwrap().len(), 1);
            assert_eq!(ups[0]["from"], json!(0));
            assert!(ups[0]["to"].as_i64().unwrap() >= 120, "{ups}");
            // Its own entries count from its `joined` on, and none before.
            let own = |e: &&Value| e["player"] == json!(4) && e.get("control").is_some();
            let first = track(&played.copies[0]).iter().find(own).cloned().unwrap();
            assert!(first["t"].as_i64().unwrap() / room().step() >= entered[0].0);
            // The relay handed it every player's messages from step 0.
            let to_four = played.log.iter().filter(|c| c.to == 4);
            assert!(to_four.clone().any(|c| c.first == 0 && c.count > 100));
        }
    }

    #[test]
    fn a_join_to_a_closed_lobby_is_refused_started_and_gets_no_frame() {
        let word = Word {
            open_until: Some(60),
            ..Word::default()
        };
        let played = run(&room(), joins(4, 120), word);
        assert_eq!(played.copies.len(), 4);
        let four = played.copies[3].report();
        assert_eq!(
            (four["join_refused"].clone(), four["ran"].clone()),
            (json!("started"), json!(0))
        );
        assert!(played.log.iter().all(|c| c.to != 4));
        for c in &played.copies[..3] {
            assert_eq!((c.ran(), c.end()), (400, None));
            assert!(seats(c).iter().all(|s| s.1 != 4));
        }
    }

    fn comes_back(relay: Wrong, word: Word) -> Played<Word> {
        let mut ask = joins(3, 250);
        ask.plays = plays(3, 400, None);
        ask.relay = relay;
        ask.faults.fates = vec![Fate::Kill {
            player: 3,
            step: 100,
        }];
        run(&room(), ask, word)
    }

    #[test]
    fn a_copy_that_left_comes_back_to_its_seat_from_entries_alone() {
        let played = comes_back(Wrong::None, Word::default());
        assert_eq!(played.copies.len(), 3);
        let three = &played.copies[2];
        let its: Vec<_> = seats(three).into_iter().filter(|s| s.1 == 3).collect();
        let states: Vec<&str> = its.iter().map(|s| s.2.as_str()).collect();
        assert_eq!(states, ["joined", "left", "joined"], "{its:?}");
        assert!(its[1].0 >= 100 && its[2].0 > 250, "{its:?}");
        for c in &played.copies {
            assert_eq!((c.ran(), c.end()), (400, None), "copy {}", c.me);
            assert_eq!(seats(c), seats(three));
            assert_eq!(track(c), track(three));
        }
        let theirs: std::collections::BTreeMap<i64, u64> =
            played.copies[0].hashes().into_iter().collect();
        assert!(three.hashes().iter().all(|(k, h)| theirs.get(k) == Some(h)));
        // Closed, the same join is refused, and the seat stays the bot's.
        let closed = Word {
            open_until: Some(60),
            ..Word::default()
        };
        let played = comes_back(Wrong::None, closed);
        let three = played.copies[2].report();
        assert_eq!(three["join_refused"], json!("started"));
        let last = seats(&played.copies[0]).into_iter().filter(|s| s.1 == 3);
        assert_eq!(last.last().unwrap().2, "left");
    }

    #[test]
    fn the_planted_relays_hand_a_joiner_state() {
        let state = |p: &Played<Word>, to: u8| {
            let handed = p.log.iter().filter(|c| c.to == to && c.count == 1);
            handed
                .filter(|c| {
                    c.bytes
                        .as_ref()
                        .is_some_and(|b| b[54..].starts_with("0900"))
                })
                .count()
        };
        let mut ask = joins(4, 120);
        ask.relay = Wrong::SendsJoinerState;
        assert_eq!(state(&run(&room(), ask, Word::default()), 4), 1);
        assert_eq!(state(&run(&room(), joins(4, 120), Word::default()), 4), 0);
        assert_eq!(
            state(&comes_back(Wrong::SendsOldSeatState, Word::default()), 3),
            1
        );
    }

    fn finishing() -> (Config, Word) {
        let c = Config {
            finish: Some(("rules".into(), "done".into())),
            ..room()
        };
        let word = Word {
            finish_at: Some(150),
            ..Word::default()
        };
        (c, word)
    }

    #[test]
    fn a_finish_ends_the_match_on_every_copy_once_confirmed_and_the_room_plays_the_next() {
        for window in [8, 0] {
            let (mut c, word) = finishing();
            c.window = window;
            let mut ask = three(300);
            ask.next = Some(Next {
                steps: 90,
                plays: plays(3, 90, None),
            });
            let played = run(&c, ask, word);
            for copy in &played.copies {
                assert_eq!(copy.end(), Some(End::Finished), "window {window}");
                assert_eq!(copy.report()["ended"], json!({"step": 150}));
                assert_eq!(copy.record()["end"], json!("finished"));
                assert!(copy.record()["confirmed"].as_i64().unwrap() >= 150);
                assert!(copy.ran() > 150 && copy.ran() <= 151 + window);
                assert_eq!(copy.hashes(), played.copies[0].hashes());
            }
            let next = played.next.as_ref().expect("the room's next match");
            assert_eq!(next.copies.len(), 3);
            let start: Vec<_> = (1..=3).map(|p| (0, p, "joined".to_string())).collect();
            for copy in &next.copies {
                assert_eq!((copy.ran(), copy.end()), (90, None));
                assert_eq!(seats(copy), start);
                assert_ne!(copy.report()["match"], played.copies[0].report()["match"]);
            }
        }
    }

    fn late(planted: Planted) -> Played<Word> {
        let (c, word) = finishing();
        let mut ask = three(300);
        // Player 2 asks to stay at step 150; copy 1 gets that message once it has run step 154.
        ask.plays = plays(3, 300, Some((2, 148)));
        ask.faults = Faults {
            deliver: vec![Deliver {
                player: 2,
                step: 150,
                to: 1,
                at: 154,
            }],
            ..Faults::default()
        };
        ask.planted = planted;
        run(&c, ask, word)
    }

    #[test]
    fn a_finish_on_a_predicted_step_ends_nothing_and_the_planted_copy_ends_alone() {
        let played = late(Planted::None);
        for c in &played.copies {
            assert_eq!((c.ran(), c.end()), (300, None), "copy {}", c.me);
            assert_eq!(c.hashes(), played.copies[0].hashes());
        }
        assert!(played.copies[0].rolled().iter().any(|(_, to)| *to == 150));
        let twin = late(Planted::FinishesOnPredicted);
        let ended: Vec<u8> = (twin.copies.iter())
            .filter(|c| c.end() == Some(End::Finished))
            .map(|c| c.me)
            .collect();
        assert_eq!(ended, [1]);
        assert_eq!(twin.copies[0].report()["ended"], json!({"step": 150}));
    }
}
