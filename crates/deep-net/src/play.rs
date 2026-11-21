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

/// #551: how the relay holds every frame back, in match steps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Held {
    /// A seeded whole number of steps from 0 to n, so frames may arrive in another order.
    UpTo(i64),
    Exactly(i64),
}

/// #551: player `player`'s message for match step `step` reaches copy `to` only once that copy
/// has run step `at`: every frame of that player's to that copy carrying it waits till then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Deliver {
    pub player: u8,
    pub step: i64,
    pub to: u8,
    pub at: i64,
}

/// Every frame `player` sends from `at` for `len` waits at the relay until `at + len`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hold {
    pub player: u8,
    pub at: i64,
    pub len: i64,
}

/// #277: what befalls one copy right after it runs match step `step`: it's killed (its connection
/// ends, and the relay tells the others), frozen (it sends nothing more, its connection still
/// open, and never comes back), or hidden for `len` flicks (it says it's absent first, then
/// catches up).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fate {
    Kill { player: u8, step: i64 },
    Freeze { player: u8, step: i64 },
    Hide { player: u8, step: i64, len: i64 },
}

impl Fate {
    fn player(&self) -> u8 {
        match *self {
            Fate::Kill { player, .. } | Fate::Freeze { player, .. } | Fate::Hide { player, .. } => {
                player
            }
        }
    }
    fn step(&self) -> i64 {
        match *self {
            Fate::Kill { step, .. } | Fate::Freeze { step, .. } | Fate::Hide { step, .. } => step,
        }
    }
    fn len(&self) -> i64 {
        match *self {
            Fate::Kill { .. } | Fate::Freeze { .. } => 0,
            Fate::Hide { len, .. } => len,
        }
    }
}

/// #277: when copy `player`'s connection ends, copy `to` has never been handed a frame carrying one
/// of the last `last` messages it sent: each of its frames to that copy waits `last` match steps
/// at the relay, and a kill drops those still waiting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Withhold {
    pub player: u8,
    pub to: u8,
    pub last: i64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Faults {
    pub seed: u64,
    /// The share of frames it drops.
    pub drop: f64,
    pub holds: Vec<Hold>,
    /// Each frame is held back by up to this long, by the seed.
    pub back: i64,
    /// #551: each frame held back a seeded whole number of match steps up to n, or exactly n.
    pub held: Option<Held>,
    /// #551: a player's message for a step that reaches one copy only once it has run a step.
    pub deliver: Vec<Deliver>,
    /// #551: each player's one-way latency to the relay, in flicks: a frame from player i to
    /// player j takes both players', and a copy starts when the relay's start reaches it.
    pub latency: Vec<i64>,
    /// #550: frames go straight between copies, as on a direct path, each copy's to each other.
    pub direct: bool,
    /// #277: copies killed, frozen or hidden while the match runs.
    pub fates: Vec<Fate>,
    pub withhold: Vec<Withhold>,
    /// #280: net.feel's network, in place of `latency`: every copy starts at the relay's start.
    pub profile: Option<Profile>,
    /// #280: players' messages that reach one copy a whole number of its steps late.
    pub late: Vec<Late>,
}

/// #280: each of `player`'s messages, for match step k, reaches copy `to` once that copy has run
/// step k + `steps`, and not before: a frame reaches it carrying only its messages due by then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Late {
    pub player: u8,
    pub to: u8,
    pub steps: i64,
}

/// The part of `frame` whose messages are for steps before `due`, if any.
fn due_part(frame: &[u8], due: i64) -> Option<Vec<u8>> {
    let mut f = Frame::decode(frame).ok()?;
    let n = (due - f.first as i64).clamp(0, f.steps.len() as i64) as usize;
    if n == 0 {
        return None;
    }
    f.steps.truncate(n);
    Some(f.encode())
}

/// #280: net.feel's network (Check input: net kinds): each player's messages take its one-way
/// latency plus a seeded jitter to every other copy, spikes hold one player's messages for a
/// while, and a loss drops each delivery with its chance, from its own seed. In flicks.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Profile {
    pub latency: Vec<i64>,
    /// A delivery takes up to this much more, seeded.
    pub jitter: i64,
    pub spikes: Option<Spikes>,
    /// Each delivery's chance of being lost, and the loss's own seed.
    pub loss: Option<(f64, u64)>,
}

/// Spikes that hold one player's messages for `hold` about every `every`; with `player` and
/// `first`, that player's exactly every `every` from `first`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Spikes {
    pub every: i64,
    pub hold: i64,
    pub player: Option<u8>,
    pub first: Option<i64>,
}

impl Profile {
    /// The holds its spikes make over a match of `span` flicks among `players`.
    fn holds(&self, players: u8, span: i64, seed: u64) -> Vec<Hold> {
        let Some(s) = self.spikes.filter(|s| s.every > 0) else {
            return Vec::new();
        };
        let hold = |player, at| Hold {
            player,
            at,
            len: s.hold,
        };
        if let (Some(player), Some(first)) = (s.player, s.first) {
            let times = (0..).map(|n| first + n * s.every);
            return times
                .take_while(|t| *t < span)
                .map(|at| hold(player, at))
                .collect();
        }
        // About every `every`: each gap a seeded half to one and a half of it.
        let mut rng = Rng(seed ^ 0x7370_696b_6573_3238);
        let (mut at, mut out) = (0, Vec::new());
        loop {
            at += s.every / 2 + (rng.next() % (s.every as u64 + 1)) as i64;
            if at >= span {
                return out;
            }
            let player = s
                .player
                .unwrap_or_else(|| 1 + (rng.next() % players.max(1) as u64) as u8);
            out.push(hold(player, at));
        }
    }
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
    /// #280: the host's clock, in ns, which only net.feel's planted wall-clock meter reads.
    pub clock: Option<fn() -> i64>,
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
    /// #277: each relay@2 message a copy sent, as the relay handed it on: `{at, message}`.
    pub controls: Vec<Value>,
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
                       "at": s(c.at), "delivered": c.delivered.map(s), "bytes": c.bytes})
            })
            .collect();
        json!({"frames": self.log.len(), "dropped": self.dropped(), "log": rows})
    }
}

enum Event {
    Tick(usize),
    Deliver(usize, Vec<u8>),
    Show(usize),
    /// #277: a relay message to a copy; a fate befalls a copy; a hidden copy's span ends.
    Control(usize, Value),
    Fate(usize, usize),
    Wake(usize),
}

/// #277: where a copy stands: playing, killed, frozen, or hidden, its relay messages waiting
/// (what frames came while it was hidden it never saw).
#[derive(Clone, Debug, PartialEq)]
enum Life {
    Plays,
    Killed,
    Frozen,
    Hidden(Vec<Value>),
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

/// The relay's queue of what happens next, by time and then the order it was queued.
struct Queue {
    events: BTreeMap<(i64, u64), Event>,
    seq: u64,
}

impl Queue {
    fn push(&mut self, at: i64, e: Event) {
        self.seq += 1;
        self.events.insert((at, self.seq), e);
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
    let profile = ask.faults.profile.as_ref();
    // #280: with net.feel's profile, a frame takes its sender's latency alone and every copy
    // starts at the relay's start.
    let lat = |p: usize| match profile {
        Some(_) => 0,
        None => ask.faults.latency.get(p).copied().unwrap_or(0),
    };
    let mut holds = ask.faults.holds.clone();
    if let Some(p) = profile {
        holds.extend(p.holds(cfg.players, ask.steps * step, ask.faults.seed));
    }
    let mut loss = profile
        .and_then(|p| p.loss)
        .map(|(rate, seed)| (rate, Rng(seed ^ 0x006c_6f73_7332_3830)));
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
            GAME,
            make(me)?,
            planted,
            lat(me as usize - 1),
        );
        copy.limit(ask.steps);
        if let Some((_, d)) = ask.defect.as_ref().filter(|(on, _)| *on == me) {
            copy.plant(d.clone());
        }
        if let Some(clock) = ask.clock {
            copy.clock(clock);
        }
        let plays = ask.plays.get(&me).into_iter().flatten();
        copy.script(plays.map(|p| (p.step, p.control.clone(), p.value.clone(), p.to.clone())));
        copies.push(copy);
    }
    let mut rng = Rng(ask.faults.seed ^ 0x006e_6574_4035_3439);
    let mut q = Queue {
        events: BTreeMap::new(),
        seq: 0,
    };
    for i in 0..copies.len() {
        q.push(lat(i), Event::Tick(i));
    }
    for (i, (_, t)) in ask.shows.iter().enumerate() {
        q.push(*t, Event::Show(i));
    }
    let mut played = Played {
        copies,
        log: Vec::new(),
        shown: Vec::new(),
        controls: Vec::new(),
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
    // Past any match's own end: every hold and span, the timeout and each step at a tenth of its
    // rate.
    let longest = holds.iter().map(|h| h.at + h.len).max().unwrap_or(0);
    let spans: i64 = ask.faults.fates.iter().map(Fate::len).sum();
    let stop = longest + spans + 2 * cfg.timeout + ask.steps * step * 10 + 60 * FLICKS;
    // #551: frames `deliver` holds, each with its copy and the step it waits for that copy to run.
    let mut pending: Vec<(usize, i64, Vec<u8>)> = Vec::new();
    // #280: frames `late` holds, each with its copy and how many steps late its messages are.
    let mut held_late: Vec<(usize, i64, Vec<u8>)> = Vec::new();
    // #277: each copy's life, which fates befell it, and the frames `withhold` keeps back, each
    // `(due, sender, copy, frame)`, which a kill of their sender drops.
    let mut life = vec![Life::Plays; played.copies.len()];
    let mut fated = vec![false; ask.faults.fates.len()];
    let mut kept: Vec<Kept> = Vec::new();
    // #277: each player's messages the relay carried, the first copy of each, by step: what it
    // answers a catch-up with.
    let mut store: Vec<BTreeMap<i64, Vec<u8>>> = vec![BTreeMap::new(); played.copies.len()];
    // #277: when each copy's last frame to each other copy reaches it: a copy's connection carries
    // its frames before its close, as the relay forwards them in order.
    let mut latest = vec![vec![0i64; played.copies.len()]; played.copies.len()];
    while let Some(((now, _), event)) = q.events.pop_first() {
        if now > stop {
            break;
        }
        let (due, wait): (Vec<_>, Vec<_>) = std::mem::take(&mut kept)
            .into_iter()
            .partition(|(at, ..)| *at <= now);
        kept = wait;
        for (_, _, to, f, _) in due {
            q.push(now, Event::Deliver(to, f));
        }
        let mut acted = None;
        match event {
            Event::Show(i) => played.shown.push(show(&played.copies, i, now)),
            Event::Deliver(to, frame) => {
                if life[to] == Life::Plays {
                    played.copies[to].receive(&frame, now);
                    acted = Some(to);
                }
            }
            Event::Control(to, m) => match &mut life[to] {
                Life::Killed | Life::Frozen => {}
                Life::Hidden(controls) => controls.push(m),
                Life::Plays => {
                    played.copies[to].relay(&m, now);
                    acted = Some(to);
                }
            },
            Event::Wake(i) => {
                if let Life::Hidden(controls) = std::mem::replace(&mut life[i], Life::Plays) {
                    played.copies[i].returned(now);
                    for m in controls {
                        played.copies[i].relay(&m, now);
                    }
                }
                acted = Some(i);
                q.push(now, Event::Tick(i));
            }
            Event::Tick(i) => {
                if life[i] != Life::Plays {
                    continue;
                }
                // Held frames reach their copy, in the order sent, right after it ran their step.
                let ready: Vec<Vec<u8>> = {
                    let ran = played.copies[i].ran();
                    let (go, wait): (Vec<_>, Vec<_>) = std::mem::take(&mut pending)
                        .into_iter()
                        .partition(|(to, at, _)| *to == i && ran > *at);
                    pending = wait;
                    go.into_iter().map(|(_, _, f)| f).collect()
                };
                for f in ready {
                    played.copies[i].receive(&f, now);
                }
                // #280: each late-held frame reaches it with its messages due by now; the rest
                // come in later frames, as the repeat rule sends them.
                let ran = played.copies[i].ran();
                for (to, steps, f) in std::mem::take(&mut held_late) {
                    match (to == i).then(|| due_part(&f, ran - steps)).flatten() {
                        Some(part) => played.copies[i].receive(&part, now),
                        None => held_late.push((to, steps, f)),
                    }
                }
                q.push(now + step, Event::Tick(i));
                acted = Some(i);
                if let Some(frame) = played.copies[i].tick(now) {
                    let mut out = Out {
                        rng: &mut rng,
                        pending: &mut pending,
                        kept: &mut kept,
                        q: &mut q,
                        store: &mut store,
                        latest: &mut latest,
                        holds: &holds,
                        loss: &mut loss,
                        held_late: &mut held_late,
                    };
                    carry(&mut played, &mut out, ask, &lat, i, now, frame);
                }
                // #277: a fate due right after this step befalls the copy at the end of this instant,
                // once what reached it now has.
                let ran = played.copies[i].ran();
                let due =
                    ask.faults.fates.iter().enumerate().find(|(n, f)| {
                        !fated[*n] && f.player() as usize == i + 1 && ran > f.step()
                    });
                if let Some((n, _)) = due {
                    fated[n] = true;
                    q.push(now, Event::Fate(i, n));
                }
            }
            Event::Fate(i, n) => {
                if life[i] != Life::Plays {
                    continue;
                }
                {
                    let f = &ask.faults.fates[n];
                    send(&mut played, &mut q, &life, &store, i, now, &lat);
                    acted = None;
                    match *f {
                        Fate::Kill { .. } => {
                            life[i] = Life::Killed;
                            // A frame the relay kept back that carries one of its last messages
                            // never arrives.
                            let sent = store[i].keys().next_back().copied().unwrap_or(-1);
                            let last = |to: usize| {
                                let w = ask.faults.withhold.iter();
                                let mut w = w.filter(|w| {
                                    w.player as usize == i + 1 && w.to as usize == to + 1
                                });
                                w.next().map_or(0, |w| w.last)
                            };
                            let lost = |k: &Kept| {
                                let carried = Frame::decode(&k.3)
                                    .ok()
                                    .map_or(-1, |f| f.first as i64 + f.steps.len() as i64 - 1);
                                k.1 == i && carried > sent - last(k.2)
                            };
                            for (.., row) in kept.iter().filter(|k| lost(k)) {
                                played.log[*row].delivered = None;
                            }
                            kept.retain(|k| !lost(k));
                            for to in (0..played.copies.len()).filter(|to| *to != i) {
                                let closed = json!({"closed": {"match": deep_relay::wire::hex(&GAME),
                                                               "player": i, "reason": "left"}});
                                let kept_to = kept.iter().filter(|k| k.1 == i && k.2 == to);
                                let after = kept_to.map(|k| k.0).max().unwrap_or(0);
                                let at = (now + lat(i) + lat(to)).max(latest[i][to]).max(after);
                                q.push(at, Event::Control(to, closed));
                            }
                        }
                        Fate::Freeze { .. } => life[i] = Life::Frozen,
                        Fate::Hide { len, .. } => {
                            // It says it's absent as its next unsent step's message, then stops.
                            played.copies[i].absent(now);
                            if let Some(frame) = played.copies[i].tick(now) {
                                let mut out = Out {
                                    rng: &mut rng,
                                    pending: &mut pending,
                                    kept: &mut kept,
                                    q: &mut q,
                                    store: &mut store,
                                    latest: &mut latest,
                                    holds: &holds,
                                    loss: &mut loss,
                                    held_late: &mut held_late,
                                };
                                carry(&mut played, &mut out, ask, &lat, i, now, frame);
                            }
                            send(&mut played, &mut q, &life, &store, i, now, &lat);
                            life[i] = Life::Hidden(Vec::new());
                            q.push(now + len, Event::Wake(i));
                        }
                    }
                }
            }
        }
        if let Some(i) = acted {
            send(&mut played, &mut q, &life, &store, i, now, &lat);
        }
        let done =
            |(i, c): (usize, &Copy<S>)| matches!(life[i], Life::Killed | Life::Frozen) || c.done();
        if played.copies.iter().enumerate().all(done) {
            break;
        }
    }
    // A time asked for past the match's last event shows what the copy held at the end.
    for ((now, _), event) in q.events {
        if let Event::Show(i) = event {
            played.shown.push(show(&played.copies, i, now));
        }
    }
    Ok(played)
}

/// #277: a frame `withhold` keeps back: when it's due, its sender, its copy, its bytes and its row
/// in the relay's log.
type Kept = (i64, usize, usize, Vec<u8>, usize);

/// What a frame the relay carries may join: its seeded faults, the frames `deliver` and `withhold`
/// hold, the queue, and the messages it keeps for a catch-up.
struct Out<'a> {
    rng: &'a mut Rng,
    pending: &'a mut Vec<(usize, i64, Vec<u8>)>,
    kept: &'a mut Vec<Kept>,
    q: &'a mut Queue,
    store: &'a mut Vec<BTreeMap<i64, Vec<u8>>>,
    latest: &'a mut Vec<Vec<i64>>,
    /// #280: every hold, spikes' too, net.feel's loss and the frames `late` holds.
    holds: &'a [Hold],
    loss: &'a mut Option<(f64, Rng)>,
    held_late: &'a mut Vec<(usize, i64, Vec<u8>)>,
}

/// Copy `i`'s frame, carried to the match's other copies under the relay's faults.
#[allow(clippy::too_many_arguments)]
fn carry<S: Stepper>(
    played: &mut Played<S>,
    out: &mut Out,
    ask: &Ask,
    lat: &dyn Fn(usize) -> i64,
    i: usize,
    now: i64,
    frame: Vec<u8>,
) {
    let step = played.copies[i].cfg.step();
    let read = Frame::decode(&frame).ok();
    if let Some(f) = &read {
        for (n, m) in f.steps.iter().enumerate() {
            let k = f.first as i64 + n as i64;
            out.store[f.player as usize]
                .entry(k)
                .or_insert_with(|| m.clone());
        }
    }
    let dropped = (out.rng.next() % 1_000_000) as f64 / 1_000_000.0 < ask.faults.drop;
    let player = i as u8 + 1;
    let mut at = now;
    for h in out.holds.iter().filter(|h| h.player == player) {
        if h.at <= now && now < h.at + h.len {
            at = at.max(h.at + h.len);
        }
    }
    if ask.faults.back > 0 {
        at += (out.rng.next() % (ask.faults.back as u64 + 1)) as i64;
    }
    match ask.faults.held {
        Some(Held::UpTo(n)) => at += (out.rng.next() % (n.max(0) as u64 + 1)) as i64 * step,
        Some(Held::Exactly(n)) => at += n * step,
        None => {}
    }
    let from = at;
    let profile = ask.faults.profile.as_ref();
    for to in (0..played.copies.len()).filter(|to| *to != i) {
        let mut at = from + lat(i) + lat(to);
        // #280: net.feel's sender's own latency plus a seeded jitter, and its loss.
        if let Some(p) = profile {
            at += p.latency.get(i).copied().unwrap_or(0);
            if p.jitter > 0 {
                at += (out.rng.next() % (p.jitter as u64 + 1)) as i64;
            }
        }
        let lost = out
            .loss
            .as_mut()
            .is_some_and(|(rate, r)| ((r.next() % 1_000_000) as f64 / 1_000_000.0) < *rate);
        let dropped = dropped || lost;
        // Through the relay every copy gets the one frame; on a direct path each gets its own.
        let sent = match ask.faults.direct {
            true => played.copies[i].frame_for(&frame, to as u8 + 1),
            false => frame.clone(),
        };
        // #551: a frame carrying a message `deliver` names waits for its copy's step.
        let carries = |d: &&Deliver| {
            d.player == player
                && d.to as usize == to + 1
                && read.as_ref().is_some_and(|f| {
                    (f.first as i64..f.first as i64 + f.steps.len() as i64).contains(&d.step)
                })
        };
        let waits = ask.faults.deliver.iter().find(carries).copied();
        let waits = waits.filter(|d| played.copies[to].ran() <= d.at);
        // #277: a frame `withhold` keeps back waits its `last` match steps at the relay.
        let kept_back = ask
            .faults
            .withhold
            .iter()
            .find(|w| w.player == player && w.to as usize == to + 1)
            .map(|w| at + w.last * step);
        played.log.push(Carried {
            player,
            first: read.as_ref().map_or(0, |f| f.first as i64),
            count: read.as_ref().map_or(0, |f| f.steps.len() as i64),
            confirmed: read.as_ref().map_or(0, |f| f.confirmed as i64),
            at: now,
            delivered: (!dropped && waits.is_none()).then_some(kept_back.unwrap_or(at)),
            to: to as u8 + 1,
            bytes: ask.log.then(|| deep_relay::wire::hex(&sent)),
        });
        let row = played.log.len() - 1;
        let late = (ask.faults.late.iter()).find(|l| l.player == player && l.to as usize == to + 1);
        match (waits, kept_back) {
            _ if dropped => {}
            (Some(d), _) => out.pending.push((to, d.at, sent)),
            (None, _) if late.is_some() => {
                out.held_late.push((to, late.map_or(0, |l| l.steps), sent));
            }
            (None, Some(due)) => out.kept.push((due, i, to, sent, row)),
            (None, None) => {
                out.latest[i][to] = out.latest[i][to].max(at);
                out.q.push(at, Event::Deliver(to, sent));
            }
        }
    }
}

/// The match ID every copy the test relay plays holds.
const GAME: deep_relay::wire::MatchId = [0x54; 16];

/// #277: what copy `i` has to send beside its own frame, relay@2 messages and other players'
/// messages, to the match's other copies; the relay names the sender as it numbers seats. It
/// answers a `catch_up` itself, from the messages it carried: every other player's from the step
/// asked, the highest player's first.
fn send<S: Stepper>(
    played: &mut Played<S>,
    q: &mut Queue,
    life: &[Life],
    store: &[BTreeMap<i64, Vec<u8>>],
    i: usize,
    now: i64,
    lat: &dyn Fn(usize) -> i64,
) {
    let (controls, frames) = played.copies[i].sends();
    let to: Vec<usize> = (0..played.copies.len())
        .filter(|to| *to != i && life[*to] != Life::Killed)
        .collect();
    for mut m in controls {
        if let Some(inner) = m.as_object_mut().and_then(|o| o.values_mut().next()) {
            inner["sender"] = json!(i);
        }
        played
            .controls
            .push(json!({"at": now as f64 / FLICKS as f64, "message": m}));
        if let Some(from) = m.pointer("/catch_up/from").and_then(Value::as_i64) {
            for p in (0..played.copies.len()).rev().filter(|p| *p != i) {
                for f in stored(&store[p], p, from) {
                    q.push(now + 2 * lat(i), Event::Deliver(i, f));
                }
            }
        }
        for t in &to {
            q.push(now + lat(i) + lat(*t), Event::Control(*t, m.clone()));
        }
    }
    for f in frames {
        for t in &to {
            q.push(now + lat(i) + lat(*t), Event::Deliver(*t, f.clone()));
        }
    }
}

/// Player `p`'s messages the relay holds from step `from` on, as frames of at most 1,024 steps.
fn stored(messages: &BTreeMap<i64, Vec<u8>>, p: usize, from: i64) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut run: Vec<Vec<u8>> = Vec::new();
    let mut first = from;
    for (k, m) in messages.range(from..) {
        if run.len() == 1024 || *k != first + run.len() as i64 {
            if !run.is_empty() {
                out.push(frame_of(p, first, std::mem::take(&mut run)));
            }
            first = *k;
        }
        run.push(m.clone());
    }
    if !run.is_empty() {
        out.push(frame_of(p, first, run));
    }
    out
}

fn frame_of(p: usize, first: i64, steps: Vec<Vec<u8>>) -> Vec<u8> {
    Frame {
        game: GAME,
        player: p as u8,
        confirmed: 0,
        first: first as u32,
        steps,
    }
    .encode()
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
