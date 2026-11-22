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

/// #278: how a room's match starts: the players who joined before the first player's Start, and
/// whether a person clicks it. Unclicked, no copy runs a step.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Start {
    pub joined: Vec<u8>,
    pub click: bool,
}

/// #278: copy `player`'s person clicks Join right after the first player's copy runs match step
/// `step`: a copy that wasn't there at the start, or one that was killed and comes back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Join {
    pub player: u8,
    pub step: i64,
}

/// #278: the room's next match, which the first player's Start begins once this one finished.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Next {
    pub steps: i64,
    pub plays: BTreeMap<u8, Vec<Play>>,
}

/// #278: a wrong relay, reachable only through a host's planted names: it answers a copy that
/// joins with state where the messages from step 0 belong.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Wrong {
    #[default]
    None,
    /// A copy's state as it is now.
    SendsJoinerState,
    /// The state the joiner's seat held when its last copy left.
    SendsOldSeatState,
}

impl Wrong {
    pub fn named(name: &str) -> Option<Wrong> {
        Some(match name {
            "relay_sends_joiner_state" => Wrong::SendsJoinerState,
            "relay_sends_old_seat_state" => Wrong::SendsOldSeatState,
            _ => return None,
        })
    }
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
    /// #552: the seed of each copy's test source in place of its platform's secure one.
    pub draw_seed: u64,
    /// #280: the host's clock, in ns, which only net.feel's planted wall-clock meter reads.
    pub clock: Option<fn() -> i64>,
    /// #278: a room's start, the copies that join after it, its next match, the planted relay,
    /// and which of the room's matches this is, from 0.
    pub start: Option<Start>,
    pub joins: Vec<Join>,
    pub next: Option<Next>,
    pub relay: Wrong,
    pub nth: u8,
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

/// What a copy showed at a time: its last step, the app's notice then, and (#265) its logic
/// arrays as it held them then, which its frame draws.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shown {
    pub player: u8,
    pub t: i64,
    pub step: i64,
    pub notice: Option<(u8, i64)>,
    pub arrays: Option<Value>,
}

pub struct Played<S> {
    pub copies: Vec<Copy<S>>,
    pub log: Vec<Carried>,
    pub shown: Vec<Shown>,
    /// #277: each relay@2 message a copy sent, as the relay handed it on: `{at, message}`.
    pub controls: Vec<Value>,
    /// #278: the room's next match, when this one finished and the ask named one.
    pub next: Option<Box<Played<S>>>,
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
    /// #277: a relay message to a copy; a fate befalls a copy; a hidden copy's span ends.
    Control(usize, Value),
    Fate(usize, usize),
    Wake(usize),
    /// #278: a copy's person clicks Join.
    Join(usize),
}

/// #277: where a copy stands: playing, killed, frozen, or hidden, its relay messages waiting
/// (what frames came while it was hidden it never saw).
#[derive(Clone, Debug, PartialEq)]
enum Life {
    Plays,
    Killed,
    Frozen,
    Hidden(Vec<Value>),
    /// #278: a seat below a taken one that nobody holds: it stands in the list and does nothing.
    Empty,
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
    let game = game_of(ask.nth);
    // #278: a room starts with whoever joined before the first player's Start, each stamped
    // `joined` at step 0; a match of one player count starts with every seat taken, as before.
    let seated: Option<Vec<u8>> = match (&ask.start, cfg.ranged) {
        (Some(s), true) => Some(s.joined.clone()),
        (None, true) => Some((1..=cfg.players).collect()),
        _ => None,
    };
    let seats = seated
        .as_ref()
        .map_or(cfg.players, |s| s.iter().copied().max().unwrap_or(0));
    let mut copy_of = |me: u8, now: i64| -> Result<Copy<S>, Value> {
        let planted = match ask.planted_on {
            Some(on) if on != me => Planted::None,
            _ => ask.planted,
        };
        let mut copy = Copy::new(
            cfg.clone(),
            card.clone(),
            me,
            cfg.players,
            game,
            make(me)?,
            planted,
            now,
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
        if let Some(clock) = ask.clock {
            copy.clock(clock);
        }
        let plays = ask.plays.get(&me).into_iter().flatten();
        copy.script(plays.map(|p| (p.step, p.control.clone(), p.value.clone(), p.to.clone())));
        if let Some(seated) = &seated {
            copy.seat(seated);
        }
        Ok(copy)
    };
    let mut copies = Vec::new();
    for me in 1..=seats {
        copies.push(copy_of(me, lat(me as usize - 1))?);
    }
    let taken = |i: usize| seated.as_ref().is_none_or(|s| s.contains(&(i as u8 + 1)));
    // #278: with Start unclicked nobody plays, but for the planted module that starts the match
    // on the third join by itself.
    let unclicked = ask.start.as_ref().is_some_and(|s| !s.click)
        && !(ask.planted == Planted::StartsOnThirdJoin && copies.len() >= 3);
    let mut rng = Rng(ask.faults.seed ^ 0x006e_6574_4035_3439);
    let mut q = Queue {
        events: BTreeMap::new(),
        seq: 0,
    };
    for i in (0..copies.len()).filter(|i| taken(*i) && !unclicked) {
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
        next: None,
    };
    let show = |copies: &[Copy<S>], i: usize, now: i64| {
        let (player, t) = ask.shows[i];
        let copy = copies.get(player as usize - 1);
        let (step, notice) = copy.map_or((-1, None), |c| c.shown(now));
        Shown {
            player,
            t,
            step,
            notice,
            arrays: copy.and_then(|c| c.sim().drawn()),
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
    let mut life: Vec<Life> = (0..played.copies.len())
        .map(|i| match taken(i) {
            true => Life::Plays,
            false => Life::Empty,
        })
        .collect();
    // #278: the joins made, the copies whose Join was refused, each with its seat, and what a
    // seat's last copy held when it left, which only the planted relay keeps.
    let mut joined = vec![false; ask.joins.len()];
    let mut refused: Vec<(usize, Copy<S>)> = Vec::new();
    let mut old: Vec<Vec<u8>> = vec![Vec::new(); cfg.players as usize];
    let mut fated = vec![false; ask.faults.fates.len()];
    let mut kept: Vec<Kept> = Vec::new();
    // #277: each player's messages the relay carried, the first copy of each, by step: what it
    // answers a catch-up with.
    let mut store: Vec<BTreeMap<i64, Vec<u8>>> = vec![BTreeMap::new(); cfg.players as usize];
    // #277: when each copy's last frame to each other copy reaches it: a copy's connection carries
    // its frames before its close, as the relay forwards them in order.
    let mut latest = vec![vec![0i64; cfg.players as usize]; cfg.players as usize];
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
                Life::Killed | Life::Frozen | Life::Empty => {}
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
                        life: &life,
                    };
                    carry(&mut played, &mut out, ask, &lat, i, now, frame);
                }
                // #277: a fate due right after this step befalls the copy at the end of this instant,
                // once what reached it now has.
                let ran = played.copies[i].ran();
                // #278: a Join made right after the first player's copy runs its step.
                for (n, j) in ask.joins.iter().enumerate() {
                    if i == 0 && !joined[n] && ran > j.step {
                        joined[n] = true;
                        q.push(now, Event::Join(n));
                    }
                }
                let due =
                    ask.faults.fates.iter().enumerate().find(|(n, f)| {
                        !fated[*n] && f.player() as usize == i + 1 && ran > f.step()
                    });
                if let Some((n, _)) = due {
                    fated[n] = true;
                    q.push(now, Event::Fate(i, n));
                }
            }
            // #278: the relay seats a Join in a seat nobody took, or one its copy left, once a copy
            // of the match says its lobby is open; else it refuses it `started`, as before.
            Event::Join(n) => {
                let (player, s) = (ask.joins[n].player, ask.joins[n].player as usize - 1);
                let free = match life.get(s) {
                    None => s < cfg.players as usize,
                    Some(l) => matches!(l, Life::Killed | Life::Empty),
                };
                if free {
                    let open = (0..played.copies.len())
                        .find(|i| life[*i] == Life::Plays)
                        .is_some_and(|i| played.copies[i].lobby_open());
                    let mut copy = copy_of(player, now)?;
                    while played.copies.len() < s {
                        let ghost = played.copies.len() as u8 + 1;
                        played.copies.push(copy_of(ghost, now)?);
                        life.push(Life::Empty);
                    }
                    if !open {
                        copy.refuse("started");
                        refused.push((s, copy));
                    } else {
                        // The copy that says the lobby is open names the step it runs next.
                        let at = (0..played.copies.len())
                            .find(|i| life[*i] == Life::Plays)
                            .map_or(0, |i| played.copies[i].ran());
                        copy.join(now, at);
                        if s == played.copies.len() {
                            played.copies.push(copy);
                            life.push(Life::Plays);
                        } else {
                            if ask.relay == Wrong::SendsOldSeatState {
                                old[s] = played.copies[s].sim_mut().state();
                            }
                            played.copies[s] = copy;
                            life[s] = Life::Plays;
                        }
                        q.push(now, Event::Tick(s));
                        acted = Some(s);
                    }
                }
            }
            Event::Fate(i, n) => {
                if life[i] != Life::Plays {
                    continue;
                }
                {
                    let f = &ask.faults.fates[n];
                    send(&mut played, &mut q, &life, &store, i, now, &lat, ask, &old);
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
                                let closed = json!({"closed": {"match": deep_relay::wire::hex(&game),
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
                                    life: &life,
                                };
                                carry(&mut played, &mut out, ask, &lat, i, now, frame);
                            }
                            send(&mut played, &mut q, &life, &store, i, now, &lat, ask, &old);
                            life[i] = Life::Hidden(Vec::new());
                            q.push(now + len, Event::Wake(i));
                        }
                    }
                }
            }
        }
        if let Some(i) = acted {
            send(&mut played, &mut q, &life, &store, i, now, &lat, ask, &old);
        }
        let done = |(i, c): (usize, &Copy<S>)| {
            matches!(life[i], Life::Killed | Life::Frozen | Life::Empty) || c.done()
        };
        if unclicked || played.copies.iter().enumerate().all(done) {
            break;
        }
    }
    // A time asked for past the match's last event shows what the copy held at the end.
    for ((now, _), event) in q.events {
        if let Event::Show(i) = event {
            played.shown.push(show(&played.copies, i, now));
        }
    }
    // #278: once the match finished on every copy still there, the first player's Start begins
    // the room's next one, from the piece's start, with the seats taken now and no new Join.
    let there: Vec<usize> = (0..played.copies.len())
        .filter(|i| life[*i] == Life::Plays)
        .collect();
    let finished = there
        .iter()
        .all(|i| played.copies[*i].end() == Some(crate::copy::End::Finished));
    let next = match (&ask.next, there.first(), finished) {
        (Some(next), Some(first), true) => {
            let seated: Vec<u8> = played.copies[*first].seated_now();
            let seated: Vec<u8> = (seated.into_iter())
                .filter(|p| there.contains(&(*p as usize - 1)))
                .collect();
            Some(Ask {
                steps: next.steps,
                plays: next.plays.clone(),
                faults: Faults {
                    seed: ask.faults.seed,
                    latency: ask.faults.latency.clone(),
                    ..Faults::default()
                },
                planted: ask.planted,
                planted_on: ask.planted_on,
                log: ask.log,
                clock: ask.clock,
                start: cfg.ranged.then_some(Start {
                    joined: seated,
                    click: true,
                }),
                nth: ask.nth + 1,
                ..Ask::default()
            })
        }
        _ => None,
    };
    // The reply holds each player's copy once: a refused Join's in its seat, and no empty seat's.
    let mut copies: Vec<Option<Copy<S>>> = played
        .copies
        .drain(..)
        .zip(&life)
        .map(|(c, l)| (*l != Life::Empty).then_some(c))
        .collect();
    for (s, copy) in refused {
        if copies.len() <= s {
            copies.resize_with(s + 1, || None);
        }
        copies[s] = Some(copy);
    }
    played.copies = copies.into_iter().flatten().collect();
    if let Some(next) = next {
        played.next = Some(Box::new(play(cfg, card, &next, make)?));
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
    /// #278: a seat nobody holds gets no frame.
    life: &'a [Life],
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
    for to in (0..played.copies.len()).filter(|to| *to != i && out.life[*to] != Life::Empty) {
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
            messages: ask.log.then(|| crate::message::read_frame(&sent)),
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

/// The match ID every copy the test relay plays holds: one for each of a room's matches (#278).
fn game_of(nth: u8) -> deep_relay::wire::MatchId {
    [0x54u8.wrapping_add(nth); 16]
}

/// #277: what copy `i` has to send beside its own frame, relay@2 messages and other players'
/// messages, to the match's other copies; the relay names the sender as it numbers seats. It
/// answers a `catch_up` itself, from the messages it carried: every other player's from the step
/// asked, the highest player's first.
#[allow(clippy::too_many_arguments)]
fn send<S: Stepper>(
    played: &mut Played<S>,
    q: &mut Queue,
    life: &[Life],
    store: &[BTreeMap<i64, Vec<u8>>],
    i: usize,
    now: i64,
    lat: &dyn Fn(usize) -> i64,
    ask: &Ask,
    old: &[Vec<u8>],
) {
    let (controls, frames) = played.copies[i].sends();
    let to: Vec<usize> = (0..played.copies.len())
        .filter(|to| *to != i && !matches!(life[*to], Life::Killed | Life::Empty))
        .collect();
    let game = game_of(ask.nth);
    for mut m in controls {
        if let Some(inner) = m.as_object_mut().and_then(|o| o.values_mut().next()) {
            inner["sender"] = json!(i);
        }
        played
            .controls
            .push(json!({"at": now as f64 / FLICKS as f64, "message": m}));
        if let Some(from) = m.pointer("/catch_up/from").and_then(Value::as_i64) {
            // #278: a copy that joins is handed its own seat's messages too, those of whoever
            // held it, and the log keeps what the relay handed it. The planted relay hands it
            // state in their place.
            let joins = played.copies[i].joining();
            let state = |bytes: Vec<u8>| {
                let mut m = vec![0x80];
                m.extend(bytes.into_iter().take(60_000));
                m
            };
            let wrong = match ask.relay {
                Wrong::SendsJoinerState if joins => to.first().map(|c| {
                    let bytes = played.copies[*c].sim_mut().state();
                    frame_of(game, *c, 0, vec![state(bytes)])
                }),
                Wrong::SendsOldSeatState if joins && !old[i].is_empty() => {
                    Some(frame_of(game, i, 0, vec![state(old[i].clone())]))
                }
                _ => None,
            };
            let frames: Vec<Vec<u8>> = match wrong {
                Some(f) => vec![f],
                None => (0..store.len())
                    .rev()
                    .filter(|p| *p != i || joins)
                    .flat_map(|p| stored(game, &store[p], p, from))
                    .collect(),
            };
            for f in frames {
                let at = now + 2 * lat(i);
                if let (true, Ok(read)) = (joins, Frame::decode(&f)) {
                    played.log.push(Carried {
                        player: read.player + 1,
                        first: read.first as i64,
                        count: read.steps.len() as i64,
                        confirmed: 0,
                        at: now,
                        delivered: Some(at),
                        to: i as u8 + 1,
                        bytes: ask.log.then(|| deep_relay::wire::hex(&f)),
                        messages: ask.log.then(|| crate::message::read_frame(&f)),
                    });
                }
                q.push(at, Event::Deliver(i, f));
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
fn stored(
    game: deep_relay::wire::MatchId,
    messages: &BTreeMap<i64, Vec<u8>>,
    p: usize,
    from: i64,
) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut run: Vec<Vec<u8>> = Vec::new();
    let mut first = from;
    for (k, m) in messages.range(from..) {
        if run.len() == 1024 || *k != first + run.len() as i64 {
            if !run.is_empty() {
                out.push(frame_of(game, p, first, std::mem::take(&mut run)));
            }
            first = *k;
        }
        run.push(m.clone());
    }
    if !run.is_empty() {
        out.push(frame_of(game, p, first, run));
    }
    out
}

fn frame_of(game: deep_relay::wire::MatchId, p: usize, first: i64, steps: Vec<Vec<u8>>) -> Vec<u8> {
    Frame {
        game,
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
                notice: Some((2, FLICKS * 3 / 5)),
                arrays: None,
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
