//! A live view of a piece with no bake (canvas primitives: Carried state, Render worker, Input
//! track; #532): the UI thread latches each frame's input, and the render worker's simulate phase
//! runs the steps the frame needs within the class's worker CPU, so a seek far ahead runs across
//! frames while the view shows its last stepped state, marked stale. A seek restores the nearest
//! checkpoint at or before it when that's nearer than stepping on; a newer seek cancels the steps
//! an older one still needed and keeps every checkpoint taken. A change of a control is stamped at
//! the first step at or after the playhead plus the input lead (one step while silent), or the
//! first step not yet run, whichever is later, and forks the track there.
//!
//! A piece whose items run pipelined (Logic: work across steps, #546) steps on a logic thread
//! instead: step k + 1 runs there across the frames that draw k − 1 to k, and the render worker
//! only draws the arrays of steps that have ended, waiting for the one a frame is due to draw.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, Sender};

use serde_json::{json, Map, Value};

use crate::budget::{cpu_ns, pipelined, FRAME_NS};
use crate::piece::{self, h64, History};
use crate::world::{track_of, Entry, Record, World};
use crate::{track, Planted, F};

/// The simulate phase stops before a step that could take it past this share of the worker CPU.
const SLICE: f64 = 0.85;

/// What the UI thread hands the render worker for one frame.
pub struct Latched {
    /// The playhead, in flicks.
    pub t: i64,
    pub set: Option<(String, f64)>,
}

/// A view's render worker: its thread owns the piece's world, or for a pipelined piece talks to
/// the logic thread that does.
pub struct View {
    to: Sender<Latched>,
    from: Receiver<Value>,
    pub t: i64,
    pub span: i64,
    pub frame: u64,
}

impl View {
    /// Starts the worker for `line`'s piece and track; its first reply is the check's.
    pub fn open(line: Value, span: i64, planted: Planted) -> Result<(View, Value), Value> {
        let (to, inbox) = channel::<Latched>();
        let (outbox, from) = channel::<Value>();
        std::thread::Builder::new()
            .name("deep-logic render worker".into())
            .spawn(move || worker(line, planted, inbox, outbox))
            .map_err(|e| json!({"ok": false, "code": "run_failed", "what": e.to_string()}))?;
        let first = from
            .recv()
            .map_err(|_| json!({"ok": false, "code": "run_failed"}))?;
        if first.get("ok") != Some(&json!(true)) {
            return Err(first);
        }
        Ok((
            View {
                to,
                from,
                t: 0,
                span,
                frame: 0,
            },
            first,
        ))
    }

    /// One frame: the worker's reply, or None when it has gone.
    pub fn frame(&mut self, latched: Latched) -> Option<Value> {
        self.to.send(latched).ok()?;
        self.from.recv().ok()
    }
}

/// The piece's world, its checked items and its step length, or the check's refusal.
fn build(line: &Value, planted: Planted) -> Result<(World, Value, i64), Value> {
    let mut history = History::new();
    let piece = Rc::new(
        piece::check(
            line.get("piece").unwrap_or(&Value::Null),
            &planted,
            &mut history,
        )
        .map_err(|r| r.0)?,
    );
    let entries = track(&piece, line, 0)
        .ok_or_else(|| json!({"ok": false, "code": "bad_input", "what": "track"}))?;
    let items: Map<String, Value> = piece
        .items
        .iter()
        .map(|i| (i.id.clone(), i.checked()))
        .collect();
    let len = piece.items.first().map_or(F / 60, |i| i.step);
    let world = World::new(
        piece,
        track_of(&entries),
        true,
        planted,
        &mut Record::default(),
        None,
    )?;
    Ok((world, json!({"ok": true, "items": items}), len))
}

/// A frame's `set` stamped at the first step at or after the playhead plus one step, or the first
/// step not yet run, whichever is later, forking the track there: the entry and the fork's time.
fn stamp(world: &mut World, t: i64, len: i64, set: Option<(String, f64)>) -> Option<(Value, i64)> {
    let (control, value) = set?;
    let k = ((t + len - 1) / len + 1).max(world.at().unwrap_or(0));
    let e = Entry {
        t: k * len,
        seq: 0,
        control,
        value,
        writer: "you".into(),
        player: 1,
    };
    world.fork_track(k, std::slice::from_ref(&e));
    Some((e.to_json(), k * len))
}

/// Restores the nearest checkpoint at or before step `want` when that's a seek back or nearer than
/// stepping on: the step it restored.
fn restore(world: &mut World, want: i64) -> Result<Option<i64>, Value> {
    let at = world.at().unwrap_or(0);
    match world.nearest(want) {
        Some(c) if want < at || c > at => world.seek(c).map(|()| Some(c)),
        _ => Ok(None),
    }
}

/// Each array's 64-bit hash, by `<item>.<write>`, as step `k` left it: what a frame draws.
fn drawn(k: i64, arrays: &[(String, Vec<u8>)]) -> Map<String, Value> {
    arrays
        .iter()
        .map(|(name, bytes)| {
            (
                name.clone(),
                json!({"step": k, "hash": format!("{:016x}", h64(bytes))}),
            )
        })
        .collect()
}

fn worker(line: Value, planted: Planted, inbox: Receiver<Latched>, outbox: Sender<Value>) {
    // A piece is checked again on its logic thread, since a checked piece can't cross threads.
    let mut history = History::new();
    let slow = piece::check(
        line.get("piece").unwrap_or(&Value::Null),
        &planted,
        &mut history,
    )
    .is_ok_and(|p| !p.items.is_empty() && p.items.iter().all(pipelined));
    if slow {
        return front(line, planted, inbox, outbox);
    }
    let (mut world, items, len) = match build(&line, planted) {
        Ok(b) => b,
        Err(e) => {
            let _ = outbox.send(e);
            return;
        }
    };
    let _ = outbox.send(items);
    let mut fork_at: Option<i64> = None;
    // The most CPU one step (with its checkpoint) has taken: what the next one may take.
    let mut step_ns = 0u64;
    for Latched { t, set } in inbox {
        let stamped = match stamp(&mut world, t, len, set) {
            Some((e, at)) => {
                fork_at = Some(at);
                e
            }
            None => Value::Null,
        };
        let want = t / len + 1;
        let start = cpu_ns();
        if let Err(e) = restore(&mut world, want) {
            let _ = outbox.send(e);
            return;
        }
        let mut steps = 0;
        while let Some(k) = world.at().filter(|k| *k < want) {
            let used = cpu_ns() - start;
            if !planted.simulate_runs_all_steps
                && steps > 0
                && (used + step_ns) as f64 > FRAME_NS * SLICE
            {
                break;
            }
            let before = cpu_ns();
            world.run(k + 1, &mut Record::default(), &mut |_, _| {});
            step_ns = step_ns.max(cpu_ns() - before);
            steps += 1;
        }
        // The state about to run step `want` holds its checkpoint, if one is due there.
        if world.at() == Some(want) {
            world.run(want, &mut Record::default(), &mut |_, _| {});
        }
        let eval_ns = cpu_ns() - start;
        let at = world.at().unwrap_or(0);
        let reply = json!({"want": want, "at": at, "stale": at != want, "steps": steps, "eval_ns": eval_ns,
            "deep_hash": world.deep_hashes(), "stamped": stamped, "fork_at": fork_at,
            "drawn": drawn(at - 1, &world.arrays())});
        if outbox.send(reply).is_err() {
            return;
        }
    }
}

/// Each array, by `<item>.<write>`, as a step left it.
type Arrays = Vec<(String, Vec<u8>)>;

/// What a pipelined view's logic thread tells its render worker.
enum Up {
    /// The check's reply, the step length and the arrays before step 0, once.
    Opened(Value, i64, Arrays),
    /// A latched frame taken: the entry its `set` stamped and the fork's time.
    Took(Option<(Value, i64)>),
    /// The steps from this one on aren't the ones sent before: a seek back or a fork.
    Reset(i64),
    /// A step ended: the full-state hashes just after it and each array it left.
    Ended(i64, Map<String, Value>, Arrays),
    Failed(Value),
}

/// A pipelined view's logic thread: it owns the world and runs every step up to one past the step
/// the newest frame draws, taking each latched frame between steps.
fn logic(line: Value, planted: Planted, inbox: Receiver<Latched>, up: Sender<Up>) {
    let (mut world, items, len) = match build(&line, planted) {
        Ok(b) => b,
        Err(e) => {
            let _ = up.send(Up::Opened(e, 0, Vec::new()));
            return;
        }
    };
    let _ = up.send(Up::Opened(items, len, world.arrays()));
    // Every step before `want` is to run: through the one after the step the frame draws.
    let mut want = 0;
    loop {
        let latched = if world.at().is_some_and(|k| k < want) {
            inbox.try_recv().ok()
        } else {
            match inbox.recv() {
                Ok(l) => Some(l),
                Err(_) => return,
            }
        };
        if let Some(Latched { t, set }) = latched {
            let has_set = set.is_some();
            let took = stamp(&mut world, t, len, set);
            if let Some((_, at)) = &took {
                let _ = up.send(Up::Reset(at / len));
            }
            want = t / len + 2;
            // A seek back restores the nearest checkpoint at or before the step it draws.
            if want < world.at().unwrap_or(0) {
                if let Some(c) = world.nearest(t / len) {
                    if let Err(e) = world.seek(c) {
                        let _ = up.send(Up::Failed(e));
                        return;
                    }
                    let _ = up.send(Up::Reset(c));
                }
            }
            if has_set && up.send(Up::Took(took)).is_err() {
                return;
            }
            continue;
        }
        let Some(k) = world.at() else { return };
        world.run(k + 1, &mut Record::default(), &mut |_, _| {});
        if up
            .send(Up::Ended(k, world.deep_hashes(), world.arrays()))
            .is_err()
        {
            return;
        }
    }
}

/// A pipelined view's render worker: it hands each latched frame to the logic thread and draws
/// the arrays of the step due at the frame's time, waiting (with no CPU) until that step has ended.
fn front(line: Value, planted: Planted, inbox: Receiver<Latched>, outbox: Sender<Value>) {
    let (to, logic_in) = channel::<Latched>();
    let (up_out, up) = channel::<Up>();
    let spawned = std::thread::Builder::new()
        .name("deep-logic logic thread".into())
        .spawn(move || logic(line, planted, logic_in, up_out));
    let (len, before) = match (spawned, up.recv()) {
        (Ok(_), Ok(Up::Opened(mut first, len, before))) => {
            let ok = first.get("ok") == Some(&json!(true));
            if ok {
                first["pipelined"] = json!(true);
            }
            let _ = outbox.send(first);
            if !ok {
                return;
            }
            (len, before)
        }
        _ => {
            let _ = outbox.send(
                json!({"ok": false, "code": "run_failed", "what": "the logic thread didn't start"}),
            );
            return;
        }
    };
    // Each ended step's full-state hashes and arrays, until a reset drops it.
    let mut ended: BTreeMap<i64, (Map<String, Value>, Arrays)> = BTreeMap::new();
    let mut fork_at: Option<i64> = None;
    for Latched { t, set } in inbox {
        let mut took = set.is_none().then_some(None);
        if to.send(Latched { t, set }).is_err() {
            return;
        }
        let start = cpu_ns();
        let due = t / len;
        let mut listed: Map<String, Value> = Map::new();
        loop {
            let waits = took.is_none()
                || (!planted.pipeline_draws_before_step_ends && !ended.contains_key(&due));
            let message = if waits {
                match up.recv() {
                    Ok(m) => m,
                    Err(_) => return,
                }
            } else {
                match up.try_recv() {
                    Ok(m) => m,
                    Err(_) => break,
                }
            };
            match message {
                Up::Ended(k, deep, arrays) => {
                    for (id, h) in &deep {
                        let steps = listed.entry(id.clone()).or_insert_with(|| json!([]));
                        if let Some(list) = steps.as_array_mut() {
                            list.push(json!({"step": k, "deep_hash": h}));
                        }
                    }
                    ended.insert(k, (deep, arrays));
                }
                Up::Reset(k) => {
                    ended.split_off(&k);
                }
                Up::Took(t) => took = Some(t),
                Up::Failed(e) => {
                    let _ = outbox.send(e);
                    return;
                }
                Up::Opened(..) => {}
            }
        }
        let stamped = match took.flatten() {
            Some((e, at)) => {
                fork_at = Some(at);
                e
            }
            None => Value::Null,
        };
        // The planted pipeline labels the due step with whatever has ended by now.
        let shown = ended.range(..=due).next_back();
        let drawn = drawn(due, shown.map_or(&before, |(_, (_, arrays))| arrays));
        let eval_ns = cpu_ns() - start;
        let deep = shown.map_or(json!({}), |(_, (d, _))| json!(d));
        let reply = json!({"want": due + 1, "at": due + 1, "stale": !ended.contains_key(&due), "steps": 0,
            "eval_ns": eval_ns, "deep_hash": deep, "stamped": stamped, "fork_at": fork_at,
            "ended": listed, "drawn": drawn});
        // Steps before the one drawn are done with: a seek back runs them again.
        ended = ended.split_off(&due);
        if outbox.send(reply).is_err() {
            return;
        }
    }
}
