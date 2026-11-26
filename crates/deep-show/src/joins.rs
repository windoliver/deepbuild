//! #1500 (canvas primitives: Logic: saves across changes): `play_frames`, a document played live
//! frame by frame on the virtual clock, with presses, seeks and whole revisions landing at named
//! frames (tests/acceptance/1500/README.md: play_frames). A revision a frame's latch takes joins:
//! the run's state after its last step is held and opened under the new revision as a save opens
//! (a world matched by its bodies, shapes and joints rather than by its hash), and the run carries
//! on from there; otherwise it restarts at step 0 with one line naming what differs, the old bytes
//! never read under the new layout. A join writes nothing to the input track, and what was latched
//! before it is read by the steps it is stamped for. A carried-on run is session state: nothing
//! else in the hub reads it, so a check, a golden or an evaluation plays the current revision from
//! step 0.

use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::time::Instant;

use deep_canvas_physics::backend::Checkpoint;
use deep_logic::piece::{Piece, Read};
use deep_logic::saves::host;
use deep_logic::world::{track_of, Entry, Record, World};
use deep_physics_rapier::runner::{Live, Run};
use serde_json::{json, Map, Value};

use crate::hub::Hub;

/// A `play_frames` call: `frames` frames of `doc` and what lands in them.
pub struct Play {
    pub doc: String,
    frames: usize,
    events: Vec<(usize, Event)>,
    rows: Option<BTreeSet<usize>>,
    paths: Vec<String>,
}

enum Event {
    Press(String),
    Revise(Value),
    Seek(i64),
}

/// #1500's wrong programs, by the names its suites give them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// Every join restarts at step 0, whatever the revision changed.
    Restarts,
    /// A changed layout with no migration carries on, the held memory and globals as they are.
    ReadsOldBytes,
    /// The `logic` call takes each step a carried-on run ran from that run.
    ChecksReadCarriedRun,
    /// Each join appends an entry of its own to the input track.
    WritesEntry,
    /// A join drops the input latched before it and not yet read.
    ClearsPending,
    /// A join opens each world as built, each body's pose and velocities set as held.
    PosesOnly,
}

pub(crate) fn planted(name: &str) -> Option<crate::hub::Planted> {
    let p = match name {
        "join_restarts" => Planted::Restarts,
        "join_reads_old_bytes" => Planted::ReadsOldBytes,
        "checks_read_carried_run" => Planted::ChecksReadCarriedRun,
        "join_writes_entry" => Planted::WritesEntry,
        "join_clears_pending" => Planted::ClearsPending,
        "join_poses_only" => Planted::PosesOnly,
        _ => return None,
    };
    Some(crate::hub::Planted::Join(p))
}

pub(crate) fn parse(c: &Map<String, Value>) -> Option<Play> {
    let event = |e: &Value| -> Option<(usize, Event)> {
        let ev = match (e.get("press"), e.get("revise"), e.get("seek")) {
            (Some(p), None, None) => Event::Press(p.as_str()?.to_string()),
            (None, Some(d), None) => Event::Revise(d.clone()),
            (None, None, Some(s)) => Event::Seek(s.as_i64().filter(|s| *s >= 0)?),
            _ => return None,
        };
        Some((usize::try_from(e.get("frame")?.as_u64()?).ok()?, ev))
    };
    let frame = |f: &Value| f.as_u64().and_then(|f| usize::try_from(f).ok());
    Some(Play {
        doc: c.get("doc")?.as_str()?.to_string(),
        frames: c
            .get("frames")?
            .as_u64()
            .filter(|n| (1..=100_000).contains(n))? as usize,
        events: match c.get("events") {
            None => Vec::new(),
            Some(e) => e.as_array()?.iter().map(event).collect::<Option<_>>()?,
        },
        rows: match c.get("rows") {
            None => None,
            Some(r) => Some(r.as_array()?.iter().map(frame).collect::<Option<_>>()?),
        },
        paths: match c.get("paths") {
            None => Vec::new(),
            Some(p) => crate::query::names(p)?,
        },
    })
}

/// The live run: the revision it plays, the step it began at, the next step it runs, its logic
/// items and its worlds, and, carried on, the state its join opened, which a seek back opens again.
struct Running {
    rev: u64,
    from: i64,
    next: i64,
    len: i64,
    logic: Option<(Rc<Piece>, World, Record)>,
    worlds: Vec<(String, Live)>,
    start: Option<Held>,
}

/// A run's whole state after a step, as a join holds it: the logic items' save and each world's.
struct Held {
    logic: Option<((Value, Vec<u8>), deep_logic::Planted, String)>,
    worlds: Vec<(String, (Checkpoint, u64))>,
}

/// A revision built to run, not stepped: its number, its step length, its logic piece, its worlds
/// and the input track they read.
struct Built {
    rev: u64,
    len: i64,
    piece: Option<Rc<Piece>>,
    worlds: Vec<(String, Live)>,
    read: Vec<Value>,
}

type Refused = Value;

impl Running {
    /// Runs step `next`: the logic items' and every world step whose time falls in it.
    fn step(&mut self) -> Result<(), Refused> {
        let k = self.next;
        if let Some((_, w, rec)) = self.logic.as_mut() {
            w.run(k + 1, rec, &mut |_, _| {});
            if let Some(trap) = rec.traps.first() {
                return Err(json!({"ok": false, "code": "trapped", "trap": trap}));
            }
        }
        for (_, live) in &mut self.worlds {
            while (live.steps as i64) * live.step_flicks() < (k + 1) * self.len {
                live.step()?;
            }
        }
        self.next = k + 1;
        Ok(())
    }

    /// An entry joined the track: the logic items read it at its step, the worlds derive their
    /// inputs from the whole track again.
    fn enter(&mut self, entry: &Value, track: &[Value]) -> Result<(), Refused> {
        if let (Some((_, w, _)), Some(e)) = (self.logic.as_mut(), Entry::parse(entry)) {
            w.append(e)?;
        }
        for (_, live) in &mut self.worlds {
            live.track(track);
        }
        Ok(())
    }

    fn held(&mut self) -> Held {
        let k = self.next;
        Held {
            logic: self
                .logic
                .as_mut()
                .map(|(_, w, _)| (host::hold(w, k), w.planted(), w.adapter.clone())),
            worlds: self
                .worlds
                .iter()
                .map(|(id, l)| (id.clone(), l.held()))
                .collect(),
        }
    }

    /// The run's readouts after its last step: each carried state's full-state hash and each
    /// logic array.
    fn readouts(&mut self) -> (Map<String, Value>, Map<String, Value>) {
        let (mut deep, mut arrays) = (Map::new(), Map::new());
        if let Some((piece, w, _)) = self.logic.as_mut() {
            deep.extend(w.deep_hashes());
            arrays = crate::picks::arrays_of(w, piece);
        }
        for (id, live) in &self.worlds {
            deep.insert(id.clone(), json!(live.deep_hash()));
        }
        (deep, arrays)
    }

    /// Every body of every world, as the last step left it.
    fn bodies(&self) -> Map<String, Value> {
        self.worlds
            .iter()
            .map(|(id, live)| (id.clone(), live.poses()))
            .collect()
    }
}

impl Hub<'_> {
    fn joins_planted(&self, p: Planted) -> bool {
        self.planted(crate::hub::Planted::Join(p))
    }

    /// The current revision of `doc` built, not stepped: its logic piece and its worlds, each world
    /// on the inputs the hub's input track derives.
    fn built(&mut self, doc: &str) -> Result<Built, Refused> {
        let form = (self.forms.get(doc).cloned())
            .ok_or_else(|| json!({"ok": false, "code": "no_revision"}))?;
        let rev = self.current(doc).map_or(0, |r| r.rev);
        let read = self.track_read(doc);
        let refused = |i: Box<deep_canvas::document::Issue>| json!({"ok": false, "code": i.code, "issues": [i.to_json()]});
        let piece = self
            .logic_piece(&form, &read)
            .map_err(refused)?
            .map(Rc::new);
        // A logic item that reads a world takes the world's readings as a bake gives them, which a
        // live run doesn't make.
        let reads_world = |p: &Piece| {
            p.items
                .iter()
                .flat_map(|i| &i.layout.entries)
                .any(|e| e.read == Read::World)
        };
        if piece.as_deref().is_some_and(reads_world) {
            return Err(
                json!({"ok": false, "code": "unsupported", "what": "a logic item that reads a world plays from its bake, not live"}),
            );
        }
        let scene = self.sourced(&form).into_owned();
        let run = Run::new(None).ok_or_else(|| json!({"ok": false, "code": "physics_refused"}))?;
        let mut worlds = Vec::new();
        for id in scene
            .get("worlds")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(id, _)| id)
        {
            let mut live = run.live(&json!({"scene": scene, "world": id}))?;
            live.track(&read);
            worlds.push((id.clone(), live));
        }
        let len = match (&piece, worlds.first()) {
            (Some(p), _) => p.items.first().map_or(1, |i| i.step),
            (None, Some((_, l))) => l.step_flicks(),
            (None, None) => deep_canvas::grammar::FLICKS_PER_SECOND / 60,
        };
        Ok(Built {
            rev,
            len: len.max(1),
            piece,
            worlds,
            read,
        })
    }

    /// The current revision of `doc`, to run from step 0 on the hub's input track.
    fn run_of(&mut self, doc: &str) -> Result<Running, Refused> {
        let b = self.built(doc)?;
        let logic = match b.piece {
            None => None,
            Some(piece) => {
                let entries: Vec<Entry> = b.read.iter().filter_map(Entry::parse).collect();
                let planted = self.scenario.logic_planted.unwrap_or_default();
                let mut rec = Record::default();
                let w = World::new(
                    piece.clone(),
                    track_of(&entries),
                    false,
                    planted,
                    &mut rec,
                    None,
                )?;
                Some((piece, w, rec))
            }
        };
        Ok(Running {
            rev: b.rev,
            from: 0,
            next: 0,
            len: b.len,
            logic,
            worlds: b.worlds,
            start: None,
        })
    }

    /// `held`, a run's state before step `from`, opened in `b`, the current revision's build: the
    /// run carried on from `from`, or what differs.
    fn open_in(&mut self, mut b: Built, held: &Held, from: i64) -> Result<Running, Vec<Value>> {
        let mut differs = Vec::new();
        let mut read = b.read;
        if self.joins_planted(Planted::ClearsPending) {
            let read_by = (from - 1) * b.len;
            read.retain(|e| e["t"].as_i64().is_some_and(|t| t <= read_by));
        }
        let entries: Vec<Entry> = read.iter().filter_map(Entry::parse).collect();
        let as_is = self.joins_planted(Planted::ReadsOldBytes);
        let logic = match (b.piece, &held.logic) {
            (Some(piece), Some((state, planted, adapter))) => {
                let mut rec = Record::default();
                let at = (*planted, adapter.as_str());
                match host::open_held(&piece, state, &entries, at, &mut rec, as_is) {
                    Ok(w) => Some((piece, w, rec)),
                    Err(e) => {
                        differs.extend(logic_differs(&piece, &e));
                        None
                    }
                }
            }
            (None, None) => None,
            _ => {
                differs.push(json!({"what": "logic"}));
                None
            }
        };
        let poses_only = self.joins_planted(Planted::PosesOnly);
        for (id, live) in &mut b.worlds {
            match held.worlds.iter().find(|(h, _)| h == id) {
                None => differs.push(json!({"what": "world", "world": id, "change": "added"})),
                Some((_, state)) => {
                    live.track(&read);
                    if let Err(e) = live.carry(state, poses_only) {
                        differs.push(json!({"what": "world", "world": id, "refused": e}));
                    }
                }
            }
        }
        for (id, _) in held
            .worlds
            .iter()
            .filter(|(h, _)| b.worlds.iter().all(|(w, _)| w != h))
        {
            differs.push(json!({"what": "world", "world": id, "change": "removed"}));
        }
        if !differs.is_empty() {
            return Err(differs);
        }
        Ok(Running {
            rev: b.rev,
            from,
            next: from,
            len: b.len,
            logic,
            worlds: b.worlds,
            start: None,
        })
    }

    /// The join of the revision the latch of frame `frame` takes: `old` held after its last step
    /// and opened under the current revision, or, past what a save opens, a run from step 0.
    fn join(
        &mut self,
        doc: &str,
        old: &mut Running,
        frame: usize,
    ) -> Result<(Running, Value), Refused> {
        let b = self.built(doc)?;
        let mut differs: Vec<Value> = (b.worlds.iter())
            .filter_map(|(id, live)| {
                let (_, o) = old.worlds.iter().find(|(o, _)| o == id)?;
                Some(with_world(o.differs(live)?, id))
            })
            .collect();
        let mut opened = None;
        if differs.is_empty() && !self.joins_planted(Planted::Restarts) {
            let held = old.held();
            match self.open_in(b, &held, old.next) {
                Ok(run) => {
                    opened = Some(Running {
                        start: Some(held),
                        ..run
                    })
                }
                Err(d) => differs = d,
            }
        }
        let (mut run, worlds) = match opened {
            Some(run) => {
                let worlds = run.bodies();
                (run, worlds)
            }
            None => (self.run_of(doc)?, old.bodies()),
        };
        let outcome = if run.from > 0 { "carried" } else { "restarted" };
        let mut out = json!({"frame": frame, "step": old.next - 1, "rev": run.rev, "outcome": outcome, "worlds": worlds});
        if run.from == 0 {
            out["line"] = json!(line(&differs));
            out["differs"] = json!(differs);
        }
        if self.joins_planted(Planted::WritesEntry) {
            let control = self
                .forms
                .get(doc)
                .and_then(|f| f["controls"].as_object())
                .and_then(|c| {
                    c.iter()
                        .find(|(_, c)| crate::played::class_of(c) == "document")
                        .map(|(id, _)| id.clone())
                });
            let t = run.next * run.len;
            if let Some(Ok(Some(entry))) = control.map(|c| self.enter(doc, &c, json!(1), t, 0)) {
                run.enter(&entry, &self.track_json(doc))?;
            }
        }
        Ok((run, out))
    }

    /// `play_frames`: the document played `frames` frames from step 0 of its current revision on
    /// the hub's input track, each frame's latch taking its presses, a seek and a revision that
    /// arrived in the frame before, then the steps its playhead needs, then its row.
    pub fn play_frames(&mut self, p: &Play) -> Value {
        if !self.doc_visible(&p.doc) {
            return json!({"ok": false, "outcome": "not_presented", "reason": "hidden"});
        }
        match self.played_frames(p) {
            Ok(v) | Err(v) => v,
        }
    }

    fn played_frames(&mut self, p: &Play) -> Result<Value, Refused> {
        let doc = p.doc.as_str();
        let mut run = self.run_of(doc)?;
        let (mut rows, mut joins) = (Vec::new(), Vec::<Value>::new());
        let mut playhead = -1;
        let mut arrived: Option<Instant> = None;
        let mut serial = 0u64;
        let mut carried_rows: BTreeMap<i64, Value> = BTreeMap::new();
        for frame in 0..p.frames {
            playhead += 1;
            let here = p.events.iter().filter(|(f, _)| *f == frame).map(|(_, e)| e);
            for control in here.clone().filter_map(|e| match e {
                Event::Press(c) => Some(c),
                _ => None,
            }) {
                serial += 1;
                let t = (playhead + 1).max(run.next) * run.len;
                // As an input to the control: the entry on the track, the session replayed.
                let entry = self
                    .enter(doc, control, json!(1), t, serial)
                    .map_err(|e| json!({"ok": false, "frame": frame, "refused": e}))?;
                if let Some(entry) = entry {
                    run.enter(&entry, &self.track_json(doc))?;
                }
            }
            if let Some(to) = here.clone().find_map(|e| match e {
                Event::Seek(s) => Some(*s),
                _ => None,
            }) {
                playhead = to;
                if to < run.next - 1 {
                    run = match run.start.take() {
                        Some(held) if to >= run.from => {
                            let b = self.built(doc)?;
                            match self.open_in(b, &held, run.from) {
                                Ok(again) => Running {
                                    start: Some(held),
                                    ..again
                                },
                                Err(_) => self.run_of(doc)?,
                            }
                        }
                        _ => self.run_of(doc)?,
                    };
                }
            }
            let joined = match arrived.take() {
                Some(at) => {
                    let (next, join) = self.join(doc, &mut run, frame)?;
                    run = next;
                    joins.push(join);
                    Some(at)
                }
                None => None,
            };
            while run.next <= playhead {
                run.step()?;
                if run.from > 0 && self.joins_planted(Planted::ChecksReadCarriedRun) {
                    if let Some((piece, w, rec)) = run.logic.as_ref() {
                        carried_rows.insert(
                            run.next - 1,
                            crate::picks::step_row(w, rec, piece, run.next - 1),
                        );
                    }
                }
            }
            if let (Some(at), Some(j)) = (joined, joins.last_mut()) {
                j["ns"] = json!(at.elapsed().as_nanos() as u64);
            }
            if p.rows.as_ref().is_none_or(|r| r.contains(&frame)) {
                let (deep, arrays) = run.readouts();
                let mut row = json!({"frame": frame, "step": playhead, "rev": run.rev, "from": run.from,
                                     "deep_hash": deep, "arrays": arrays, "worlds": run.bodies()});
                if !p.paths.is_empty() {
                    row["values"] = self.values_at(doc, playhead * run.len, &p.paths);
                }
                rows.push(row);
            }
            if let Some(document) = here.clone().find_map(|e| match e {
                Event::Revise(d) => Some(d),
                _ => None,
            }) {
                let reply = self.revise(doc, document);
                if reply["outcome"] != "presented" {
                    return Err(
                        json!({"ok": false, "code": "revision_refused", "frame": frame, "reply": reply}),
                    );
                }
                // The join's time runs from here, the revision admitted and current: its checks and
                // the session's evaluation from step 0, which every revision takes, come before.
                arrived = Some(Instant::now());
            }
        }
        if !carried_rows.is_empty() {
            self.carried_rows.insert(doc.to_string(), carried_rows);
        }
        Ok(json!({"ok": true, "frames": rows, "joins": joins}))
    }

    /// Each of `paths` as the document's frame at `t` draws it, as `eval` reads it.
    fn values_at(&mut self, doc: &str, t: i64, paths: &[String]) -> Value {
        self.load_frame(doc, t);
        let Some(session) = self.sessions.get_mut(doc) else {
            return Value::Null;
        };
        let view = crate::frames::session_view(session, &Map::new());
        session.frame(&mut self.sched, t, &view);
        crate::query::values(&self.sched, session, paths)
    }
}

/// A logic open's refusal as the join's differs: a layout by the item and both hashes.
fn logic_differs(piece: &Piece, refused: &Value) -> Vec<Value> {
    let Some(list) = refused["differs"].as_array() else {
        return vec![json!({"what": "logic", "refused": refused})];
    };
    let item = match piece.items.as_slice() {
        [one] => json!(one.id),
        _ => Value::Null,
    };
    list.iter()
        .map(|d| match d["what"].as_str() {
            Some("layout") => {
                let mut d = d.clone();
                let held = d
                    .as_object_mut()
                    .and_then(|o| o.remove("save"))
                    .unwrap_or_default();
                d["item"] = item.clone();
                d["held"] = held;
                d
            }
            _ => d.clone(),
        })
        .collect()
}

fn with_world(mut d: Value, world: &str) -> Value {
    d["world"] = json!(world);
    d
}

/// The one line a viewer reads when a join restarts the run: what differs, each by name.
fn line(differs: &[Value]) -> String {
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    let mut named: Vec<String> = Vec::new();
    for d in differs {
        let change = d["change"].as_str().unwrap_or("changed");
        let said = match d["what"].as_str().unwrap_or_default() {
            "layout" => format!(
                "{} changed its state layout from {} to {}, with no migration",
                d["item"].as_str().unwrap_or("a logic item"),
                text(&d["held"]).chars().take(12).collect::<String>(),
                text(&d["piece"]).chars().take(12).collect::<String>()
            ),
            "world" => format!("the world {} was {change}", text(&d["world"])),
            what @ ("body" | "shape" | "joint") => {
                format!(
                    "the {what} {} was {change} in the world {}",
                    text(&d[what]),
                    text(&d["world"])
                )
            }
            what => format!("its {what} changed"),
        };
        if !named.contains(&said) {
            named.push(said);
        }
    }
    match named.is_empty() {
        true => "Restarted at step 0 under the new revision.".to_string(),
        false => format!("Restarted at step 0: {}.", named.join("; ")),
    }
}
