//! The test relay (canvas primitives: Check input: net kinds): every copy of a match in one
//! process, with no network, on the relay's own clock. It carries each frame to the match's other
//! copies and, by its seed, drops frames, holds one player's frames for a while, or holds each
//! frame back; it reports every frame it carried, when, and when it delivered it. Time is the
//! relay's, in flicks from the match's start, so a run repeats exactly from its seed.

use std::collections::BTreeMap;

use deep_relay::wire::Frame;
use serde_json::{json, Value};

use crate::card::Card;
use crate::copy::{Copy, Defect, Planted, Stepper};
use crate::kind::{Config, FLICKS};

/// What a player does: an entry on `control` made when match step `step` is the first its copy
/// hasn't run.
#[derive(Clone, Debug, PartialEq)]
pub struct Play {
    pub step: i64,
    pub control: String,
    pub value: Value,
    /// #550: the players whose copies it goes to, over a direct path; every copy where none.
    pub to: Option<Vec<u8>>,
}

/// Every frame `player` sends from `at` for `len` waits at the relay until `at + len`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hold {
    pub player: u8,
    pub at: i64,
    pub len: i64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Faults {
    pub seed: u64,
    /// The share of frames it drops.
    pub drop: f64,
    pub holds: Vec<Hold>,
    /// Each frame is held back by up to this long, by the seed.
    pub back: i64,
    /// #550: frames go straight between copies, as on a direct path, each copy's to each other.
    pub direct: bool,
}

#[derive(Clone, Debug, Default)]
pub struct Ask {
    pub steps: i64,
    pub plays: BTreeMap<u8, Vec<Play>>,
    pub faults: Faults,
    pub planted: Planted,
    /// #550: the one copy `planted` applies to, or every copy.
    pub planted_on: Option<u8>,
    /// What each named copy shows at a time: `(player, t)`.
    pub shows: Vec<(u8, i64)>,
    /// Whether the relay's log keeps each frame's messages.
    pub log: bool,
    /// #550: a planted defect one copy makes.
    pub defect: Option<(u8, Defect)>,
    /// #552: the seed of each copy's test source in place of its platform's secure one.
    pub draw_seed: u64,
}

/// One frame the relay carried to one copy.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Carried {
    pub player: u8,
    pub first: i64,
    pub count: i64,
    pub confirmed: i64,
    pub at: i64,
    /// None when the relay dropped it.
    pub delivered: Option<i64>,
    /// The copy it went to, and the frame's bytes, as hex, when the log keeps them.
    pub to: u8,
    pub bytes: Option<String>,
    /// #552: with the log, each of its steps' messages as the net module's codec reads them back.
    pub messages: Option<Vec<Value>>,
}

/// What a copy showed at a time: its last step, and the app's notice then.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shown {
    pub player: u8,
    pub t: i64,
    pub step: i64,
    pub notice: Option<(u8, i64)>,
}

pub struct Played<S> {
    pub copies: Vec<Copy<S>>,
    pub log: Vec<Carried>,
    pub shown: Vec<Shown>,
}

impl<S> Played<S> {
    pub fn dropped(&self) -> usize {
        self.log.iter().filter(|c| c.delivered.is_none()).count()
    }

    /// The relay's report: its counts and, with `log`, every frame it carried.
    pub fn relay(&self, log: bool) -> Value {
        let s = |t: i64| t as f64 / FLICKS as f64;
        let rows: Vec<Value> = self
            .log
            .iter()
            .filter(|_| log)
            .map(|c| {
                json!({"player": c.player, "to": c.to, "first": c.first, "count": c.count, "confirmed": c.confirmed,
                       "at": s(c.at), "delivered": c.delivered.map(s), "bytes": c.bytes, "messages": c.messages})
            })
            .collect();
        json!({"frames": self.log.len(), "dropped": self.dropped(), "log": rows})
    }
}

enum Event {
    Tick(usize),
    Deliver(usize, Vec<u8>),
    Show(usize),
}

/// splitmix64: the relay's faults come from its seed alone.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
}

/// Plays the match `cfg` declares: `cfg.players` copies, each stepping what `make` gives its
/// player, until every copy has run `ask.steps` match steps or the match ended.
pub fn play<S: Stepper>(
    cfg: &Config,
    card: &Card,
    ask: &Ask,
    make: &mut dyn FnMut(u8) -> Result<S, Value>,
) -> Result<Played<S>, Value> {
    let step = cfg.step();
    let mut copies = Vec::new();
    for me in 1..=cfg.players {
        let planted = match ask.planted_on {
            Some(on) if on != me => Planted::None,
            _ => ask.planted,
        };
        let mut copy = Copy::new(
            cfg.clone(),
            card.clone(),
            me,
            cfg.players,
            [0x54; 16],
            make(me)?,
            planted,
            0,
        );
        copy.limit(ask.steps);
        let wrong = match planted {
            Planted::RevealsOtherBits => crate::draw::Wrong::BitsDiffer,
            Planted::WithholdsBits => crate::draw::Wrong::Withholds,
            _ => crate::draw::Wrong::None,
        };
        let source = crate::draw::seeded(ask.draw_seed ^ u64::from(me).wrapping_mul(0x9e37_79b9));
        copy.draw_source(source, wrong);
        if let Some((_, d)) = ask.defect.as_ref().filter(|(on, _)| *on == me) {
            copy.plant(d.clone());
        }
        let plays = ask.plays.get(&me).into_iter().flatten();
        copy.script(plays.map(|p| (p.step, p.control.clone(), p.value.clone(), p.to.clone())));
        copies.push(copy);
    }
    let mut rng = Rng(ask.faults.seed ^ 0x006e_6574_4035_3439);
    let mut queue: BTreeMap<(i64, u64), Event> = BTreeMap::new();
    let mut seq = 0u64;
    let mut push = |queue: &mut BTreeMap<(i64, u64), Event>, at: i64, e: Event| {
        seq += 1;
        queue.insert((at, seq), e);
    };
    for i in 0..copies.len() {
        push(&mut queue, 0, Event::Tick(i));
    }
    for (i, (_, t)) in ask.shows.iter().enumerate() {
        push(&mut queue, *t, Event::Show(i));
    }
    let mut played = Played {
        copies,
        log: Vec::new(),
        shown: Vec::new(),
    };
    let show = |copies: &[Copy<S>], i: usize, now: i64| {
        let (player, t) = ask.shows[i];
        let (step, notice) = copies
            .get(player as usize - 1)
            .map_or((-1, None), |c| c.shown(now));
        Shown {
            player,
            t,
            step,
            notice,
        }
    };
    // Past any match's own end: every hold, the timeout and each step at a tenth of its rate.
    let longest = ask
        .faults
        .holds
        .iter()
        .map(|h| h.at + h.len)
        .max()
        .unwrap_or(0);
    let stop = longest + 2 * cfg.timeout + ask.steps * step * 10 + 60 * FLICKS;
    while let Some(((now, _), event)) = queue.pop_first() {
        if now > stop {
            break;
        }
        match event {
            Event::Show(i) => played.shown.push(show(&played.copies, i, now)),
            Event::Deliver(to, frame) => played.copies[to].receive(&frame, now),
            Event::Tick(i) => {
                push(&mut queue, now + step, Event::Tick(i));
                let Some(frame) = played.copies[i].tick(now) else {
                    continue;
                };
                let read = Frame::decode(&frame).ok();
                let dropped = (rng.next() % 1_000_000) as f64 / 1_000_000.0 < ask.faults.drop;
                let player = i as u8 + 1;
                let mut at = now;
                for h in ask.faults.holds.iter().filter(|h| h.player == player) {
                    if h.at <= now && now < h.at + h.len {
                        at = at.max(h.at + h.len);
                    }
                }
                if ask.faults.back > 0 {
                    at += (rng.next() % (ask.faults.back as u64 + 1)) as i64;
                }
                for to in (0..played.copies.len()).filter(|to| *to != i) {
                    // Through the relay every copy gets the one frame; on a direct path each
                    // gets its own.
                    let sent = match ask.faults.direct {
                        true => played.copies[i].frame_for(&frame, to as u8 + 1),
                        false => frame.clone(),
                    };
                    played.log.push(Carried {
                        player,
                        first: read.as_ref().map_or(0, |f| f.first as i64),
                        count: read.as_ref().map_or(0, |f| f.steps.len() as i64),
                        confirmed: read.as_ref().map_or(0, |f| f.confirmed as i64),
                        at: now,
                        delivered: (!dropped).then_some(at),
                        to: to as u8 + 1,
                        bytes: ask.log.then(|| deep_relay::wire::hex(&sent)),
                        messages: ask.log.then(|| crate::message::read_frame(&sent)),
                    });
                    if !dropped {
                        push(&mut queue, at, Event::Deliver(to, sent));
                    }
                }
            }
        }
        if played.copies.iter().all(Copy::done) {
            break;
        }
    }
    // A time asked for past the match's last event shows what the copy held at the end.
    for ((now, _), event) in queue {
        if let Event::Show(i) = event {
            played.shown.push(show(&played.copies, i, now));
        }
    }
    Ok(played)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::copy::tests::{cfg, Word};
    use crate::copy::End;

    fn plays(steps: i64, delay: i64) -> BTreeMap<u8, Vec<Play>> {
        (1..=2u8)
            .map(|p| {
                let list = (0..steps - delay)
                    .map(|g| Play {
                        step: g,
                        control: "push".into(),
                        value: json!((g * 7 + p as i64 * 3) % 17 - 8),
                        to: None,
                    })
                    .collect();
                (p, list)
            })
            .collect()
    }

    fn run(delay: i64, steps: i64, faults: Faults, planted: Planted) -> Played<Word> {
        let ask = Ask {
            steps,
            plays: plays(steps, delay),
            faults,
            planted,
            shows: vec![(1, 10 * FLICKS + FLICKS * 4 / 5)],
            ..Ask::default()
        };
        play(&cfg(delay, 1), &Card::default(), &ask, &mut |_| {
            Ok(Word::default())
        })
        .unwrap()
    }

    #[test]
    fn copies_reach_the_same_hashes_whatever_the_relay_drops_or_holds_back() {
        let clean = run(4, 400, Faults::default(), Planted::None);
        assert_eq!(clean.copies[0].hashes().len(), 400);
        assert_eq!(clean.copies[0].hashes(), clean.copies[1].hashes());
        assert_eq!(clean.dropped(), 0);
        let s = FLICKS / 20;
        let rough = Faults {
            seed: 549,
            drop: 0.05,
            back: 6 * s,
            ..Faults::default()
        };
        let held = run(4, 400, rough, Planted::None);
        assert!(held.dropped() > 0 && held.log.iter().any(|c| c.count > 1));
        for (a, b) in held.copies.iter().zip(&clean.copies) {
            assert_eq!((a.ran(), a.end()), (400, None));
            assert_eq!(a.hashes(), b.hashes());
            assert!(a.ran_early().is_empty());
            assert_eq!(
                a.record()["track"].as_array().unwrap().len(),
                b.record()["track"].as_array().unwrap().len()
            );
        }
        // With no delay at all both copies still run each step at its time.
        let none = run(0, 20, Faults::default(), Planted::None);
        assert_eq!((none.copies[0].ran(), none.copies[1].ran()), (20, 20));
        assert_eq!(none.copies[0].report()["ran_at"][19], json!(0.95));
    }

    #[test]
    fn a_hold_stalls_the_other_copy_with_a_notice_and_past_the_timeout_ends_the_match() {
        let hold = |len: i64| Faults {
            seed: 549,
            holds: vec![Hold {
                player: 2,
                at: 10 * FLICKS,
                len: len * FLICKS,
            }],
            ..Faults::default()
        };
        let two = run(4, 400, hold(2), Planted::None);
        let one = two.copies[0].report();
        assert_eq!(
            one["waits"],
            json!([{"step": 204, "player": 2, "from": 10.2, "to": 12.0}])
        );
        assert_eq!(
            one["notices"],
            json!([{"player": 2, "from": 10.45, "to": 12.0}])
        );
        assert_eq!(
            two.shown,
            vec![Shown {
                player: 1,
                t: 10 * FLICKS + FLICKS * 4 / 5,
                step: 203,
                notice: Some((2, FLICKS * 3 / 5))
            }]
        );
        let clean = run(4, 400, Faults::default(), Planted::None);
        for (a, b) in two.copies.iter().zip(&clean.copies) {
            assert_eq!((a.ran(), a.end()), (400, None));
            assert_eq!(a.hashes(), b.hashes());
        }
        let six = run(4, 400, hold(6), Planted::None);
        assert_eq!(six.copies[0].ran(), 204);
        for c in &six.copies {
            assert_eq!(c.end(), Some(End::Timeout));
        }
    }

    #[test]
    fn a_copy_that_sends_its_peers_other_entries_is_named_by_its_entries_not_a_field() {
        let three = Config {
            players: 3,
            ..cfg(2, 8)
        };
        let to = |value: f64, player: u8| Play {
            step: 10,
            control: "push".into(),
            value: json!(value),
            to: Some(vec![player]),
        };
        for (planted, cause) in [
            (Planted::None, "entries"),
            (Planted::LocatesStateOnly, "state"),
        ] {
            let ask = Ask {
                steps: 60,
                plays: [(3u8, vec![to(3.0, 1), to(-8.0, 2)])].into_iter().collect(),
                faults: Faults {
                    direct: true,
                    ..Faults::default()
                },
                planted,
                ..Ask::default()
            };
            let played =
                play(&three, &Card::default(), &ask, &mut |_| Ok(Word::default())).unwrap();
            for (c, held) in played.copies[..2].iter().zip([3.0, -8.0]) {
                let d = c.desync().unwrap();
                assert_eq!(d["cause"], json!(cause));
                if planted == Planted::None {
                    assert_eq!((&d["player"], &d["step"]), (&json!(3), &json!(12)));
                    assert!(d.get("module").is_none() && d.get("field").is_none());
                }
                // Each record keeps the entry it held for player 3 at step 12.
                assert_eq!(c.record()["track"][0]["value"], json!(held));
            }
        }
    }

    #[test]
    fn the_planted_copies_run_early_or_stall_on_a_lost_message() {
        let s = FLICKS / 20;
        let back = Faults {
            seed: 549,
            back: 6 * s,
            ..Faults::default()
        };
        let early = run(4, 400, back, Planted::RunsStepEarly);
        assert!(early.copies.iter().any(|c| !c.ran_early().is_empty()));
        let drops = Faults {
            seed: 549,
            drop: 0.05,
            ..Faults::default()
        };
        let stalled = run(4, 400, drops, Planted::ResendsNothing);
        assert!(stalled.copies.iter().all(|c| c.end() == Some(End::Timeout)));
        assert!(stalled.copies.iter().any(|c| c.ran() < 400));
    }
}
