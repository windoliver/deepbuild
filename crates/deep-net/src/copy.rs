//! One copy of a lockstep match (canvas primitives: Net `net@1`, Net: lockstep, Net: desync and
//! replay). It sends exactly one message for each match step, made when the step `delay` steps
//! before it is the first it hasn't run, with its player's entries; runs match step k only once
//! it holds every player's message for k; puts every entry on its track at its step with its
//! player, in step, player and seq order, never by arrival; hashes its whole carried state every
//! `hash_every` steps, with the merged track's hash beside it, and stops at a hash a peer doesn't
//! share, then locates the first step and field, or player and step, where the copies parted
//! (#550); refuses alike a peer's entry the piece doesn't declare or that's out of range, naming
//! the player; ends the match as faulted when its logic traps, telling the others; and records
//! the merged track up to the last step it confirmed. Its frames are relay@1's: each repeats its
//! own messages after the lowest step its peers confirmed. The host gives it the time, in flicks,
//! and what arrived.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use deep_relay::wire::{self, Frame, MatchId};
use serde_json::{json, Map, Value};

use crate::card::Card;
use crate::draw::{self, Draws};
use crate::kind::{self, Config, FLICKS};
use crate::locate::{self, entries_hash, track_after, Found, FNV_START};
pub use crate::message::Hashed;
use crate::message::{hex, Message};

mod draws;
mod feel;
mod profile;
mod rollback;
mod seats;
pub use seats::{Seat, NET_SEATS, SEAT};

pub use feel::{percentile, Positions};

/// What a copy steps: the piece's canvas modules with carried state.
pub trait Stepper {
    /// An entry joins the input track at its step, before that step runs.
    fn enter(&mut self, entry: &Value) -> Result<(), Value>;
    /// Runs match step `step`: every stepping item's steps before `until` flicks. A trap is the
    /// error.
    fn run(&mut self, step: i64, until: i64) -> Result<(), Value>;
    /// The full-state hash now: every canvas module's whole carried state but media's.
    fn hash(&mut self) -> u64;
    /// The step hash now, which doesn't cover all of memory (Logic: checkpoints and bake).
    fn step_hash(&mut self) -> u64;
    /// A hash for each field of each canvas module's canonical state, `(module, field, hash)`,
    /// in canonical order (#550: Net: desync and replay).
    fn fields(&mut self) -> Vec<(String, String, u64)>;
    /// The same piece at its start, which the locator steps again from: a checkpoint at or
    /// before the last full-state hash that matched.
    fn again(&self) -> Result<Self, Value>
    where
        Self: Sized;
    /// A planted defect's change to one field of its state (#550).
    fn plant(&mut self, defect: &Defect) -> Result<(), Value>;
    /// #551: each canvas module keeps a rollback checkpoint at each of the last `size` match
    /// steps.
    fn hold(&mut self, _size: usize) {}
    /// #551: each canvas module's rollback checkpoint at match step `step`, about to run.
    fn keep(&mut self, _step: i64) {}
    /// #551: every canvas module back at its rollback checkpoint at match step `step`, which
    /// starts at `t` flicks: what the steps since made, and the entries stamped from `t` on, which
    /// join again as their steps run again, are dropped; an error where a module's ring holds no
    /// checkpoint there.
    fn back(&mut self, step: i64, t: i64) -> Result<(), Value> {
        Err(json!({"code": "no_ring", "step": step, "t": t}))
    }
    /// #276: the entries its player brings to step 0, `(control, value)`: its profile record.
    fn brings(&self) -> Vec<(String, Value)> {
        Vec::new()
    }
    /// #551: the CPU time each canvas module took since the last call, `(module, ns)`.
    fn timed(&mut self) -> Vec<(String, u64)> {
        Vec::new()
    }
    /// #277: the CPU time every canvas module has taken so far, in ns, which a catch-up's reading
    /// counts.
    fn spent(&self) -> u64 {
        0
    }
    /// #277: the planted catch-up's jump: each canvas module's clock moves to match step `step`,
    /// which starts at `t` flicks, running none of the steps before it.
    fn jump(&mut self, _step: i64, _t: i64) {}
    /// #551: the snapshot bytes each canvas module's rollback ring has written, `(module, bytes)`.
    fn written(&self) -> Vec<(String, u64)> {
        Vec::new()
    }
    /// #551: what the canvas modules made at each step they ran: occurrences, step hashes and
    /// checkpoints, by step, which a replaced step's never stay in.
    fn made(&mut self) -> BTreeMap<i64, Value> {
        BTreeMap::new()
    }
    /// #551: every occurrence row its canvas modules hold, each `{step, item, …}` with the match
    /// step that made it.
    fn occurrences(&self) -> Vec<Value> {
        Vec::new()
    }
    /// #551: a seek after the match to match step `step` (of `len` flicks): each module restores
    /// its own checkpoint at or before it and steps through it; the checkpoint's step and the
    /// full-state hash there.
    fn seek(&mut self, step: i64, _len: i64) -> Result<(i64, u64), Value> {
        Err(json!({"code": "no_ring", "step": step}))
    }
    /// #552: the match whose draws its logic derives, by its ID.
    fn matched(&mut self, _game: &[u8; 16]) {}
    /// #552: this copy's own draw entry, made now, before it reaches the track at its step.
    fn early(&mut self, _entry: &Value) {}
    /// #552's planted guesser: the six-sided roll it guesses for an action at `step` from the
    /// document's seed and the step alone.
    fn guess(&mut self, _step: i64) -> Option<i64> {
        None
    }
    /// #280: each item net.feel names, at its evaluated position at time `t` as the copy holds it.
    fn positions(&mut self, _t: i64) -> Positions {
        Vec::new()
    }
    /// #265: each logic array as the copy holds it now, laid out as a bake (steps past
    /// `confirmed` included, a replaced step's gone): what its frame draws; none by default.
    fn drawn(&self) -> Option<Value> {
        None
    }
}

/// How a planted defect changes its field's value: `n` added to it, or bit `b` of its bits
/// flipped, bit 0 being a float's lowest mantissa bit, one ulp.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Change {
    Add(f64),
    Flip(u32),
}

/// A planted defect (#550): a change to one field of one copy's state right after a match step,
/// made again whenever that copy runs the step, as a defect is. `at` is the byte of a field that
/// holds bytes, logic memory.
#[derive(Clone, Debug, PartialEq)]
pub struct Defect {
    pub step: i64,
    pub field: String,
    pub at: Option<u32>,
    pub change: Change,
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
    /// #550: it stamps a peer's entries with its own viewer's player number.
    StampsOwnPlayer,
    /// #550: a trap in a step doesn't end its match while every full-state hash agrees.
    PlaysOnPastTrap,
    /// #550: its locator compares step hashes alone.
    LocatesByStepHashes,
    /// #550: its locator compares state alone, never the track hashes or the entries.
    LocatesStateOnly,
    /// #550: its full-state hash rounds every float to 1e-6 first (the stepper's).
    HashRoundsFloats,
    /// #551: it applies a late entry at the step it arrived at instead of rolling back.
    AppliesLateAtArrival,
    /// #551: it records each prediction as an entry on its track.
    RecordsPredicted,
    /// #551: a frame's late entries roll it back to the step of the last one it read.
    RewindsToLastRead,
    /// #551: it never holds its clock, whatever its lead.
    IgnoresLeadRule,
    /// #280: its frames resend from its newest step instead of the lowest one unconfirmed.
    ResendsFromNewest,
    /// #280's planted meters: a stall counted as the held message's whole delay, a rollback's
    /// depth counted from the step the late message arrived on, and an item's move from the frame
    /// before instead of its jump across the rollback.
    MetersWholeDelay,
    MetersDepthFromArrival,
    MetersFrameToFrame,
    MetersWallClock,
    /// #280: net.budget's report from one match step's cost without its checkpoints.
    ReportsFromStep,
    /// #276: it reads each peer's profile record at step 0 as its own store holds its own viewer's.
    ProfileFromOwnStore,
    /// #277: it stamps a leave at the step it noticed the close, with no exchange.
    StampsLeaveWhenNoticed,
    /// #277: it stamps a leave after the last message it holds itself, skipping the exchange.
    SkipsLeaveExchange,
    /// #277: catching up, it applies each missed message at the step it runs when it arrives.
    CatchesUpInArrivalOrder,
    /// #277: back from an absence, it jumps to the confirmed step without running the steps.
    JumpsToConfirmed,
    /// #552: its messages carry its copy's `match.me`.
    SendsMatchMe,
    /// #552: it guesses each roll from the document's seed and the step before the action is
    /// confirmed.
    GuessesFromSeed,
    /// #552: its bits differ from its commitment.
    RevealsOtherBits,
    /// #552: it never sends its bits.
    WithholdsBits,
    /// #552: its logic takes a draw from the bits that reached it first (the stepper's).
    DrawsFromFirstBits,
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        Some(match name {
            "net_runs_step_early" => Planted::RunsStepEarly,
            "net_resends_nothing" => Planted::ResendsNothing,
            "net_stamps_own_player" => Planted::StampsOwnPlayer,
            "net_plays_on_past_trap" => Planted::PlaysOnPastTrap,
            "net_locates_by_step_hashes" => Planted::LocatesByStepHashes,
            "net_locates_by_state_alone" => Planted::LocatesStateOnly,
            "net_hash_rounds_floats" => Planted::HashRoundsFloats,
            "net_applies_at_arrival" => Planted::AppliesLateAtArrival,
            "net_records_predicted" => Planted::RecordsPredicted,
            "net_rewinds_to_last_read" => Planted::RewindsToLastRead,
            "net_ignores_lead_rule" => Planted::IgnoresLeadRule,
            "net_resends_from_newest" => Planted::ResendsFromNewest,
            "net_feel_stall_whole_delay" => Planted::MetersWholeDelay,
            "net_feel_depth_from_arrival" => Planted::MetersDepthFromArrival,
            "net_feel_correction_frame_to_frame" => Planted::MetersFrameToFrame,
            "net_feel_wall_clock" => Planted::MetersWallClock,
            "net_budget_window_without_checkpoints" => Planted::ReportsFromStep,
            "net_profile_from_own_store" => Planted::ProfileFromOwnStore,
            "net_leave_at_notice" => Planted::StampsLeaveWhenNoticed,
            "net_skips_last_exchange" => Planted::SkipsLeaveExchange,
            "net_catch_up_in_arrival_order" => Planted::CatchesUpInArrivalOrder,
            "web_catch_up_jumps" => Planted::JumpsToConfirmed,
            "net_sends_match_me" => Planted::SendsMatchMe,
            "net_guesses_from_seed" => Planted::GuessesFromSeed,
            "net_reveals_other_bits" => Planted::RevealsOtherBits,
            "net_withholds_bits" => Planted::WithholdsBits,
            "draws_from_first_bits" => Planted::DrawsFromFirstBits,
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
    /// #280: the step whose message it waits for, and when the frame that let it run came.
    pub awaited: i64,
    pub freed: Option<i64>,
}

/// The waiting notice the app or the web player shows, never the piece.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notice {
    pub player: u8,
    pub from: i64,
    pub to: Option<i64>,
}

/// Where a copy stands in locating a desync that stopped its match at the hash for step `at`.
#[derive(Debug, Default)]
struct Locating {
    at: i64,
    /// The host's time it stopped: a peer that sends nothing for the timeout after it is left out.
    since: i64,
    mine: Option<Found>,
    /// What each peer found, once every part has come, and the parts so far.
    theirs: BTreeMap<u8, Found>,
    partial: BTreeMap<u8, Found>,
    /// The field hashes it sent and those its peers sent, by step.
    my_fields: BTreeMap<i64, Vec<(String, String, u64)>>,
    their_fields: BTreeMap<(u8, i64), Vec<(String, String, u64)>>,
    /// net.desync, once located.
    report: Option<Value>,
}

/// An entry its player makes, and the players it goes to (#550: all, where it names none).
type Scoped = (String, Value, Option<Vec<u8>>);

/// The entries of `made` that go to `player`.
fn seen_by(made: &[Scoped], player: u8) -> Vec<(String, Value)> {
    made.iter()
        .filter(|(_, _, to)| to.as_ref().is_none_or(|to| to.contains(&player)))
        .map(|(c, v, _)| (c.clone(), v.clone()))
        .collect()
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
    /// What its player does when a step is the first it hasn't run, by that step: each entry with
    /// the players it goes to, all where none are named.
    script: BTreeMap<i64, Vec<Scoped>>,
    /// Its player's entries waiting for the next message, and the hashes waiting with them.
    made: Vec<Scoped>,
    /// #550: its messages with an entry that goes to some players only, by step, whole.
    scoped: BTreeMap<i64, Vec<Scoped>>,
    owed: VecDeque<Hashed>,
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
    /// The merged input track, as applied, and what every player's messages held at each step
    /// it ran, by step and player: what the locator steps again with and hashes.
    track: Vec<Value>,
    log: BTreeMap<i64, Vec<(u8, Vec<(String, Value)>)>>,
    /// #276: the profile record entry its player brought to step 0.
    brought: Option<Value>,
    /// The merged track's hash over the steps it ran (#550: entries first).
    track_hash: u64,
    hashes: Vec<Hashed>,
    theirs: BTreeMap<i64, Vec<(u8, Hashed)>>,
    /// Each entry refused alike on every copy, naming the player (#550).
    refused: Vec<Value>,
    /// Once a desync stopped the match: where it stands in locating the first step and field.
    locating: Option<Locating>,
    /// The host's time at its last tick or frame.
    now: i64,
    /// A planted defect this copy makes (#550).
    defect: Option<Defect>,
    waits: Vec<Wait>,
    notices: Vec<Notice>,
    /// #552: its draws after commit, and where their bits come from; the planted guesser's
    /// guesses, `(step, roll)`.
    draws: Draws,
    guesses: Vec<(i64, i64)>,
    /// When it ran each step, and the steps it ran without every player's message (planted).
    ran_at: Vec<i64>,
    ran_early: Vec<i64>,
    end: Option<(End, Value)>,
    /// #551: where it stands in rolling back (crate::copy::rollback).
    roll: rollback::Roll,
    /// #280: what net.feel reads (crate::copy::feel).
    feel: feel::Meter,
    /// #277: its seats, leaves being agreed, and its own absence (crate::copy::seats).
    seats: seats::Seats,
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
        let mut sim = sim;
        if cfg.window > 0 {
            sim.hold(cfg.window as usize + 1);
        }
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
            scoped: BTreeMap::new(),
            owed: VecDeque::new(),
            mine: BTreeMap::new(),
            sent: 0,
            told: -1,
            held: vec![BTreeMap::new(); n],
            early: vec![BTreeMap::new(); n],
            through: vec![0; n],
            confirmed_by: vec![0; n],
            track: Vec::new(),
            log: BTreeMap::new(),
            brought: None,
            track_hash: FNV_START,
            hashes: Vec::new(),
            theirs: BTreeMap::new(),
            refused: Vec::new(),
            locating: None,
            now,
            defect: None,
            waits: Vec::new(),
            notices: Vec::new(),
            // A host that plays a live match hands it the platform's secure source.
            draws: Draws::new(draw::seeded(u64::from_le_bytes(
                game[..8].try_into().expect("8 bytes"),
            ))),
            guesses: Vec::new(),
            ran_at: Vec::new(),
            ran_early: Vec::new(),
            end: None,
            roll: rollback::Roll::new(players),
            feel: feel::Meter::default(),
            seats: seats::Seats::new(players),
            cfg,
        };
        copy.sim.matched(&game);
        // No entry can be stamped before step `delay`: those steps' messages are empty, but for
        // step 0's, which carries what its player brings (#276: its profile record).
        copy.bring();
        // #551: with a window, a copy counts its peers' first `delay` messages held too, since
        // every copy knows they are empty, so it doesn't wait at its window for them; a piece
        // that keeps a profile has each player's record in its first.
        if copy.cfg.window > 0 && copy.cfg.controls.get(kind::PROFILE).is_none() {
            copy.through = vec![copy.cfg.delay; n];
        }
        copy
    }

    /// #552: where its draws' bits come from, and how a planted copy draws wrong.
    pub fn draw_source(&mut self, source: draw::Source, wrong: draw::Wrong) {
        self.draws = Draws::new(source);
        self.draws.wrong = wrong;
    }

    /// Runs at most `steps` match steps.
    pub fn limit(&mut self, steps: i64) {
        self.limit = steps;
    }

    /// The planted defect this copy makes whenever it runs the defect's step.
    pub fn plant(&mut self, defect: Defect) {
        self.defect = Some(defect);
    }

    /// What its player does: each `(step, control, value, to)` an entry made when match step
    /// `step` is the first this copy hasn't run, sent to the players `to` names, or every player.
    pub fn script(
        &mut self,
        plays: impl IntoIterator<Item = (i64, String, Value, Option<Vec<u8>>)>,
    ) {
        for (step, control, value, to) in plays {
            self.script
                .entry(step)
                .or_default()
                .push((control, value, to));
        }
    }

    /// An entry its player makes now: it takes the first step whose message isn't made.
    pub fn make(&mut self, control: &str, value: Value) {
        self.made.push((control.to_string(), value, None));
    }

    pub fn ran(&self) -> i64 {
        self.next
    }

    /// Whether it steps no more: its match ended, or it ran every step it was given.
    fn stopped(&self) -> bool {
        self.end.is_some() || self.next >= self.limit
    }

    /// Whether it has nothing more to do: it steps no more, and a desync that stopped its match
    /// is located, or the locator gave up waiting for a peer.
    pub fn done(&self) -> bool {
        self.stopped()
            && self.locating.as_ref().is_none_or(|l| l.report.is_some())
            && (self.cfg.window == 0 || self.end.is_some() || self.roll.settled >= self.next)
    }

    pub fn end(&self) -> Option<End> {
        self.end.as_ref().map(|(e, _)| *e)
    }

    pub fn sim(&self) -> &S {
        &self.sim
    }

    pub fn sim_mut(&mut self) -> &mut S {
        &mut self.sim
    }

    /// The steps it ran before it held every player's message for them.
    pub fn ran_early(&self) -> &[i64] {
        &self.ran_early
    }

    /// Its full-state hashes, `(step, hash)`.
    pub fn hashes(&self) -> Vec<(i64, u64)> {
        self.hashes.iter().map(|h| (h.step, h.state)).collect()
    }

    /// Its full-state hashes with the track hash each carried.
    pub fn hashed(&self) -> &[Hashed] {
        &self.hashes
    }

    /// The entries it refused, alike on every copy: `{step, player, control, value, code}`.
    pub fn refused(&self) -> &[Value] {
        &self.refused
    }

    /// net.desync, once the locator named where the copies parted.
    pub fn desync(&self) -> Option<&Value> {
        self.locating.as_ref().and_then(|l| l.report.as_ref())
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

    /// The first seated player whose message for `step` it doesn't hold (#277: no copy waits on
    /// a left or absent seat's).
    fn missing(&self, step: i64) -> Option<u8> {
        (0..self.players)
            .find(|p| self.seated(*p as usize) && self.through[*p as usize] <= step)
            .map(|p| p + 1)
    }

    /// The steps it holds every seated player's message for, from the start with none missing.
    fn confirmed(&self) -> i64 {
        let far = self.through.iter().copied().max().unwrap_or(0);
        (0..self.players as usize)
            .map(|p| if self.seated(p) { self.through[p] } else { far })
            .min()
            .unwrap_or(0)
    }

    fn finish(&mut self, end: End, detail: Value) {
        if self.end.is_some() {
            return;
        }
        self.end = Some((end, detail.clone()));
        // The others end it too: its next frames say how.
        if end != End::Left {
            self.send(Message {
                end: Some((end.name().to_string(), detail)),
                ..Message::default()
            });
        }
    }

    /// A full-state or track hash a peer doesn't share, at the hash for step `at`: the match
    /// stops on every copy, and each locates where the copies parted.
    fn stop(&mut self, at: i64) {
        match &self.locating {
            Some(l) if l.at <= at || l.mine.is_some() => return,
            None if self.end.is_some() => return,
            _ => {}
        }
        self.end = Some((End::Desync, json!({"at": at})));
        self.locating = Some(Locating {
            at,
            since: self.now,
            ..Locating::default()
        });
        self.send(Message {
            end: Some((End::Desync.name().to_string(), json!({"at": at}))),
            ..Message::default()
        });
    }

    /// A player's connection ended: the match ends as left on every copy, but for a piece whose
    /// rules play a left seat (#277), where the copies agree on the step its seat is left.
    pub fn closed(&mut self, player: u8, reason: &str) {
        if self.leaves(player) {
            return;
        }
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
        let mut slice = self.seats.slice;
        while !self.stopped() && now >= self.due {
            // #277: away, it runs nothing; catching up, only confirmed steps, a slice at a time.
            if self.away(&mut slice) {
                return;
            }
            // Reaching a step makes the message `delay` steps after it, once.
            while self.reached <= self.next {
                let made = self.script.remove(&self.reached).unwrap_or_default();
                self.made.extend(made);
                let made = std::mem::take(&mut self.made);
                let m = Message {
                    entries: seen_by(&made, self.me),
                    hash: self.owed.pop_front(),
                    me: (self.planted == Planted::SendsMatchMe).then_some(self.me),
                    ..Message::default()
                };
                if made.iter().any(|e| e.2.is_some()) {
                    self.scoped.insert(self.through[self.me as usize - 1], made);
                }
                let at = self.through[self.me as usize - 1];
                self.guessed(at, &m.entries);
                self.send(m);
                self.reached += 1;
            }
            if let Some(player) = self.blocked() {
                if self.planted != Planted::RunsStepEarly {
                    self.wait(player, now);
                    return;
                }
                self.ran_early.push(self.next);
            }
            let waited = self.resume(now);
            // #551: a copy that leads its peers holds its clock one step in every 10.
            if self.leads() {
                self.due += step;
                continue;
            }
            self.run(now);
            self.due = if waited { now + step } else { self.due + step };
        }
    }

    /// The copy waits at its last step for `player`'s message.
    fn wait(&mut self, player: u8, now: i64) {
        let awaited = self.through[player as usize - 1];
        let open = |from| Wait {
            step: self.next,
            player,
            from,
            to: None,
            awaited,
            freed: None,
        };
        match self.waits.last().filter(|w| w.to.is_none()) {
            Some(w) if w.player == player => {}
            Some(_) => {
                let next = open(now);
                if let Some(w) = self.waits.last_mut() {
                    w.to = Some(now);
                }
                self.unnotice(now);
                self.waits.push(next);
            }
            None => self.waits.push(open(self.due)),
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
        if now - from >= self.cfg.timeout && !self.leaves(player) {
            self.finish(End::Timeout, json!({"player": player, "step": step}));
        }
    }

    /// The entry a step puts on the track for player `p` (1-based) with `seq`: stamped with its
    /// step, its player and whose it is (the planted copy stamps a peer's as its own player's).
    fn stamped(&self, k: i64, p: u8, seq: usize, control: &str, value: &Value) -> Value {
        if control == SEAT {
            return json!({"t": k * self.cfg.step(), "seq": seq, "seat": {"player": p, "state": value},
                          "writer": "net", "player": p});
        }
        let (writer, player) = match (p == self.me, self.planted) {
            // #552: a draw's commitment and bits are the net module's, for their player.
            _ if control == draw::COMMIT || control == draw::REVEAL => ("net", p),
            (true, _) => ("you", p),
            (false, Planted::StampsOwnPlayer) => ("peer", self.me),
            (false, _) => ("peer", p),
        };
        if control == kind::PROFILE {
            return self.profile_entry(k, seq, value, (writer, player));
        }
        json!({"t": k * self.cfg.step(), "seq": seq, "control": control, "value": value,
               "writer": writer, "player": player})
    }

    /// Runs match step `next`: every player's entries for it join the track in player and seq
    /// order, each first passing the checks the viewer's own pass (declared, and in range), then
    /// the piece steps. A trap ends the match as faulted on every copy, naming the item, the step
    /// and the kind.
    fn run(&mut self, now: i64) {
        let (k, len) = (self.next, self.cfg.step());
        if self.cfg.window > 0 {
            self.sim.keep(k);
            self.roll.trail.insert(k, self.track_hash);
        }
        for p in 0..self.players as usize {
            if let Some(m) = self.held[p].remove(&k) {
                self.logged(k, p as u8 + 1, m.entries);
            }
        }
        self.predicted(k);
        for (player, entries) in self.log.get(&k).cloned().unwrap_or_default() {
            self.track_hash = track_after(self.track_hash, entries_hash(k, player, &entries));
            for (seq, (control, value)) in entries.iter().enumerate() {
                let entry = self.stamped(k, player, seq, control, value);
                let fed = self.fed(&entry);
                let entered = kind::admit(&self.cfg.controls, control, value)
                    .and_then(|()| self.sim.enter(&fed));
                match entered {
                    Ok(()) => self.track.push(entry),
                    Err(why) => self.refused.push(json!({"step": k, "player": player,
                        "control": control, "value": value, "code": why.get("code").cloned().unwrap_or(json!("refused")),
                        "why": why})),
                }
            }
        }
        let ran = self.sim.run(k, (k + 1) * len);
        if let Some(d) = self.defect.as_ref().filter(|d| d.step == k && ran.is_ok()) {
            let _ = self.sim.plant(d);
        }
        if let Err(trap) = ran {
            if self.planted != Planted::PlaysOnPastTrap {
                let fault = json!({"step": k, "item": trap.get("item").cloned().unwrap_or(Value::Null),
                                   "kind": trap.get("kind").cloned().unwrap_or(Value::Null)});
                // #551: a trap in a step past confirmed holds the copy there until it is.
                if self.cfg.window == 0 {
                    self.finish(End::Faulted, fault);
                    return;
                }
                self.roll.trapped = Some((k, fault));
            }
        }
        if self.ran_at.len() as i64 == k {
            self.ran_at.push(now);
        }
        self.next += 1;
        // #552: in lockstep a step runs confirmed: its draws now (with a window, `settle`).
        if self.cfg.window == 0 {
            self.drawn(k);
            if self.end.is_some() {
                return;
            }
        }
        if k % self.cfg.hash_every == 0 {
            let h = Hashed {
                step: k,
                state: self.sim.hash(),
                track: self.track_hash,
            };
            self.hashes.push(h);
            // With a window, a hash goes out once its step is confirmed (`settle`).
            if self.cfg.window == 0 {
                self.owed.push_back(h);
                self.compare(k);
            }
        }
    }

    /// A full-state hash, or a track hash, a peer doesn't share stops the match.
    fn compare(&mut self, step: i64) {
        if self.cfg.window > 0 && step >= self.roll.settled {
            return;
        }
        let Ok(at) = self.hashes.binary_search_by_key(&step, |h| h.step) else {
            return;
        };
        let own = self.hashes[at];
        let parted = self.theirs.get(&step).is_some_and(|list| {
            list.iter()
                .any(|(_, h)| h.state != own.state || h.track != own.track)
        });
        if parted {
            self.stop(step);
        }
    }

    /// #552's planted guesser: as its own player's entries are stamped and as a peer's arrive,
    /// before their step is confirmed, it guesses each action's roll from the seed and the step.
    fn guessed(&mut self, step: i64, entries: &[(String, Value)]) {
        if self.planted != Planted::GuessesFromSeed {
            return;
        }
        let actions = entries
            .iter()
            .filter(|(c, _)| c != draw::COMMIT && c != draw::REVEAL);
        for _ in actions {
            if let Some(roll) = self.sim.guess(step) {
                self.guesses.push((step, roll));
            }
        }
    }

    /// A message of `player` (0-based) for `step`, taken once, in step order.
    fn take(&mut self, player: usize, step: i64, m: Message) {
        let who = player as u8 + 1;
        self.seat_of(player, step, &m);
        self.guessed(step, &m.entries);
        if let Some(h) = m.hash {
            self.theirs.entry(h.step).or_default().push((who, h));
            self.compare(h.step);
        }
        if let Some((end, detail)) = &m.end {
            match End::named(end) {
                End::Desync => self.stop(detail["at"].as_i64().unwrap_or(step)),
                end if self.end.is_none() => {
                    let detail = match end {
                        End::Faulted => detail.clone(),
                        _ => json!({"player": who}),
                    };
                    self.end = Some((end, detail));
                }
                _ => {}
            }
        }
        if let Some(l) = self.locating.as_mut() {
            if let Some(part) = m.found.as_ref().filter(|p| Found::at_of(p) == Some(l.at)) {
                let f = l.partial.entry(who).or_insert_with(|| Found {
                    at: l.at,
                    ..Found::default()
                });
                if f.take(part) == Some(true) {
                    if let Some(f) = l.partial.remove(&who) {
                        l.theirs.insert(who, f);
                    }
                }
            }
            for (at, list) in &m.fields {
                l.their_fields.insert((who, *at), list.clone());
            }
        }
        // #277: a planted catch-up applies a message at the step it arrived at.
        if self.arrived(player, step, &m) {
            return;
        }
        // A step already run keeps what it ran with, but for a rollback (#551): only a copy
        // that ran early gets here in lockstep.
        if step >= self.next {
            self.held[player].insert(step, m);
        } else if self.cfg.window > 0 {
            self.late(player as u8 + 1, step, m.entries);
        }
    }

    /// Steps the piece again from its start, a checkpoint at or before the last full-state hash
    /// that matched, through `at`, with the entries it held, as the run did: its full-state hash
    /// at every match step, each player's entries' hash at each step since the last match, and,
    /// at `fields_at`, a hash for each field of its state.
    fn run_again(
        &self,
        at: i64,
        fields_at: Option<i64>,
    ) -> Result<(Found, Vec<(String, String, u64)>), Value> {
        let mut sim = self.sim.again()?;
        let (len, since) = (self.cfg.step(), (at - self.cfg.hash_every + 1).max(0));
        let mut found = Found {
            at,
            ..Found::default()
        };
        let (mut track, mut fields) = (FNV_START, Vec::new());
        for k in 0..=at {
            for (p, entries) in self.log.get(&k).into_iter().flatten() {
                let h = entries_hash(k, *p, entries);
                track = track_after(track, h);
                if k >= since {
                    found.entries.push((k, *p, h));
                }
                for (seq, (control, value)) in entries.iter().enumerate() {
                    let entry = self.stamped(k, *p, seq, control, value);
                    if kind::admit(&self.cfg.controls, control, value).is_ok() {
                        let _ = sim.enter(&self.fed(&entry));
                    }
                }
            }
            let trapped = sim.run(k, (k + 1) * len).is_err();
            if let Some(d) = self.defect.as_ref().filter(|d| d.step == k && !trapped) {
                let _ = sim.plant(d);
            }
            found.steps.push(match self.planted {
                Planted::LocatesByStepHashes => sim.step_hash(),
                _ => sim.hash(),
            });
            if fields_at == Some(k) {
                fields = sim.fields();
            }
            if trapped && self.planted != Planted::PlaysOnPastTrap {
                break;
            }
        }
        found.state = found.steps.last().copied().unwrap_or_default();
        found.track = track;
        Ok((found, fields))
    }

    /// The locator, once a desync stopped the match: it steps again once it holds every
    /// player's message through the stop's hash step, sends what it found, then the field
    /// hashes at the first step it parted from each peer at, and names where it parted from the
    /// first peer that differs. A peer that sends nothing for the timeout is left out.
    fn locate(&mut self) {
        let Some(l) = self.locating.as_ref() else {
            return;
        };
        if l.report.is_some() {
            return;
        }
        let at = l.at;
        if l.mine.is_none() {
            if self.confirmed() <= at {
                return;
            }
            let found = match self.run_again(at, None) {
                Ok((found, _)) => found,
                Err(why) => {
                    let report = json!({"first_step": null, "players": [self.me], "why": why});
                    if let Some(l) = self.locating.as_mut() {
                        l.report = Some(report);
                    }
                    return;
                }
            };
            for part in found.parts() {
                self.send(Message {
                    found: Some(part),
                    ..Message::default()
                });
            }
            if let Some(l) = self.locating.as_mut() {
                l.mine = Some(found);
            }
        }
        let l = self.locating.as_ref().expect("locating");
        let mine = l.mine.clone().expect("found");
        let mut pending = false;
        let mut first: Option<Value> = None;
        let mut asks: BTreeSet<i64> = BTreeSet::new();
        for peer in (1..=self.players).filter(|p| *p != self.me) {
            let Some(theirs) = l.theirs.get(&peer) else {
                pending = true;
                continue;
            };
            let players = json!([self.me, peer]);
            let entries_first = self.planted != Planted::LocatesStateOnly;
            let report = if entries_first && mine.track != theirs.track {
                // Entries first: no state field is compared.
                match mine.entries_part(theirs) {
                    Some((step, player)) => Some(json!({"cause": "entries", "player": player,
                                                        "step": step, "players": players})),
                    None => Some(json!({"cause": "entries", "player": null, "step": null,
                                        "players": players})),
                }
            } else {
                match mine.first_step(theirs) {
                    None if mine.state == theirs.state && mine.track == theirs.track => None,
                    None => Some(json!({"cause": "state", "first_step": null, "module": null,
                                        "field": null, "players": players})),
                    Some(step) => {
                        if !l.my_fields.contains_key(&step) {
                            asks.insert(step);
                        }
                        match (l.my_fields.get(&step), l.their_fields.get(&(peer, step))) {
                            (Some(a), Some(b)) => {
                                let parted = locate::fields_part(a, b);
                                let (module, field) =
                                    parted.first().map_or((Value::Null, Value::Null), |(m, f)| {
                                        (json!(m), json!(f))
                                    });
                                let all: Vec<Value> =
                                    parted.iter().map(|(m, f)| json!([m, f])).collect();
                                Some(
                                    json!({"cause": "state", "first_step": step, "module": module,
                                            "field": field, "fields": all, "players": players}),
                                )
                            }
                            _ => {
                                pending = true;
                                None
                            }
                        }
                    }
                }
            };
            if first.is_none() {
                first = report;
            }
        }
        let late = self.now - l.since >= self.cfg.timeout;
        for step in asks {
            let fields = self
                .run_again(at, Some(step))
                .map(|(_, f)| f)
                .unwrap_or_default();
            if let Some(l) = self.locating.as_mut() {
                l.my_fields.insert(step, fields.clone());
            }
            self.send(Message {
                fields: vec![(step, fields)],
                ..Message::default()
            });
            pending = true;
        }
        if !pending || late {
            let report = first.unwrap_or_else(
                || json!({"cause": null, "first_step": null, "players": [self.me]}),
            );
            let mut report = report;
            report["at"] = json!(at);
            if let Some(l) = self.locating.as_mut() {
                l.report = Some(report.clone());
            }
            if let Some((End::Desync, detail)) = self.end.as_mut() {
                *detail = report;
            }
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
            if step < self.through[p] || self.early[p].contains_key(&step) || self.gone(p) {
                continue;
            }
            if let Some(m) = Message::decode(bytes) {
                self.early[p].insert(step, m);
            }
        }
        self.now = self.now.max(now);
        self.heard(p, &frame);
        self.seats.heard(p);
        self.take_early(p);
        self.freed(now);
        // With a window, the late entries one frame of the host brings roll the copy back once,
        // at its tick (#551).
        if self.cfg.window == 0 {
            self.advance(now);
        }
        self.watch(now);
        self.locate();
    }

    /// The host's tick, once a match step's time at the least: runs what is due and gives the
    /// frame to send, which repeats every message of its own after the lowest step its peers
    /// confirmed, oldest first.
    pub fn tick(&mut self, now: i64) -> Option<Vec<u8>> {
        self.now = self.now.max(now);
        self.rewind();
        self.advance(now);
        self.drew();
        self.settle();
        self.watch(now);
        // A copy that ran every step it was given still sends the hashes it owes.
        if self.next >= self.limit && self.end.is_none() {
            while let Some(h) = self.owed.pop_front() {
                self.send(Message {
                    hash: Some(h),
                    ..Message::default()
                });
            }
        }
        self.locate();
        self.caught_up(now);
        let me = self.me as usize - 1;
        // #277: a left or absent seat confirms nothing, but for one catching up.
        let lowest = (0..self.players as usize)
            .filter(|p| *p != me && (self.seated(*p) || self.seats.returning.contains_key(p)))
            .map(|p| self.confirmed_by[p])
            .min()
            .unwrap_or(self.through[me])
            .min(self.seats.since.unwrap_or(i64::MAX));
        self.mine = self.mine.split_off(&lowest);
        self.scoped = self.scoped.split_off(&lowest);
        let from = match self.planted {
            Planted::ResendsNothing => self.sent.max(lowest),
            Planted::ResendsFromNewest => (self.through[me] - 1).max(lowest),
            _ => lowest,
        };
        let mut steps: Vec<Vec<u8>> = Vec::new();
        let mut bytes = wire::HEADER;
        // #277: its messages run on from its first one there, past the steps it was away for.
        let from = self.mine.range(from..).next().map_or(from, |(k, _)| *k);
        for (k, m) in self.mine.range(from..).take(STEPS_PER_FRAME) {
            if *k != from + steps.len() as i64 {
                break;
            }
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

    /// The frame it sends copy `to` on a direct path: each message holds the entries that go to
    /// `to`'s player, which through the relay, one frame for every copy, are this copy's own.
    pub fn frame_for(&self, frame: &[u8], to: u8) -> Vec<u8> {
        let Ok(mut f) = Frame::decode(frame) else {
            return frame.to_vec();
        };
        for (i, bytes) in f.steps.iter_mut().enumerate() {
            let Some(all) = self.scoped.get(&(f.first as i64 + i as i64)) else {
                continue;
            };
            if let Some(mut m) = Message::decode(bytes) {
                m.entries = seen_by(all, to);
                *bytes = m.encode();
            }
        }
        f.encode()
    }

    /// The merged input track up to the last step it confirmed, in step, player and seq order.
    fn merged(&self) -> Vec<Value> {
        if self.cfg.window > 0 {
            return self.settled_track();
        }
        let confirmed = self.confirmed();
        let mut track = self.track.clone();
        // A stopped match's steps past its last run aren't confirmed.
        let upto = if self.end.is_some() {
            self.next
        } else {
            confirmed
        };
        for step in self.next..upto {
            for p in 0..self.players as usize {
                let Some(m) = self.held[p].get(&step) else {
                    continue;
                };
                for (seq, (control, value)) in m.entries.iter().enumerate() {
                    if kind::admit(&self.cfg.controls, control, value).is_ok() {
                        track.push(self.stamped(step, p as u8 + 1, seq, control, value));
                    }
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
            // #552: the copy's own player, whose side a replay or an export draws by default.
            "player": self.me,
            // #552: the match's ID, which every draw on its track hashes.
            "match": wire::hex(&self.game),
            "track": self.merged(),
            "confirmed": self.last_confirmed(),
            "end": self.end().map(End::name),
        })
    }

    /// What the copy did: every time in seconds since the match's start.
    pub fn report(&self) -> Map<String, Value> {
        let s = |t: i64| (t - self.start) as f64 / FLICKS as f64;
        // With a window, only the hashes of steps it confirmed (#551).
        let settled = self.settled();
        let hashes: Vec<Value> = self
            .hashes
            .iter()
            .filter(|h| self.cfg.window == 0 || h.step < settled)
            .map(|h| json!({"step": h.step, "hash": hex(h.state), "track": hex(h.track)}))
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
        out.insert("rollbacks".into(), json!(self.roll.rollbacks.len()));
        self.roll_report(&mut out);
        out.insert("hashes".into(), json!(hashes));
        out.insert("waits".into(), json!(waits));
        out.insert("notices".into(), json!(notices));
        out.insert("match".into(), json!(wire::hex(&self.game)));
        out.insert("refused".into(), json!(self.refused));
        self.seat_report(&mut out);
        out.insert("end".into(), json!(self.end().map(End::name)));
        if let Some((_, detail)) = &self.end {
            out.insert("ended".into(), detail.clone());
        }
        // net.desync once located, and net.fault (Net: desync and replay).
        out.insert("desync".into(), json!(self.desync()));
        let fault = match &self.end {
            Some((End::Faulted, f)) => f.clone(),
            _ => Value::Null,
        };
        out.insert("fault".into(), fault);
        out.insert("record".into(), self.record());
        if self.planted == Planted::GuessesFromSeed {
            let g: Vec<Value> = (self.guesses.iter())
                .map(|(step, roll)| json!({"step": step, "roll": roll}))
                .collect();
            out.insert("guesses".into(), json!(g));
        }
        out.insert(
            "ran_at".into(),
            json!(self.ran_at.iter().map(|t| s(*t)).collect::<Vec<_>>()),
        );
        out
    }
}

#[cfg(test)]
pub(crate) mod tests;
