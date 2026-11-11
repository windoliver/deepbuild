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
//! draws only steps that have ended, from what each left, waiting for the one a frame draws.

use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, Sender};

use serde_json::{json, Map, Value};

use crate::budget::{cpu_ns, pipelined, FRAME_NS};
use crate::piece::{self, h64, History, Piece};
use crate::world::{self, track_of, Entry, Record, Shown, World};
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
    /// The span's end; None for an open span (Transport), which has none.
    pub span: Option<i64>,
    /// The furthest time played: with an open span, as far as a seek reaches.
    pub played: i64,
    pub frame: u64,
}

impl View {
    /// Starts the worker for `line`'s piece and track; its first reply is the check's.
    pub fn open(line: Value, span: Option<i64>, planted: Planted) -> Result<(View, Value), Value> {
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
                played: 0,
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

/// The piece checked, or the check's refusal.
fn checked(line: &Value, planted: Planted) -> Result<Piece, Value> {
    let mut history = History::new();
    piece::check(
        line.get("piece").unwrap_or(&Value::Null),
        &planted,
        &mut history,
    )
    .map_err(|r| r.0)
}

/// The piece's world and the check's reply.
fn build(line: &Value, planted: Planted) -> Result<(World, Value), Value> {
    let piece = Rc::new(checked(line, planted)?);
    let entries = track(&piece, line, 0)
        .ok_or_else(|| json!({"ok": false, "code": "bad_input", "what": "track"}))?;
    let items: Map<String, Value> = piece
        .items
        .iter()
        .map(|i| (i.id.clone(), i.checked()))
        .collect();
    let world = World::new(
        piece,
        track_of(&entries),
        true,
        planted,
        &mut Record::default(),
        None,
    )?;
    Ok((world, json!({"ok": true, "items": items})))
}

/// Each array's 64-bit hash, by `<item>.<write>`, as step `k` left it: what a frame draws.
fn hashes(k: i64, arrays: &[(String, Vec<u8>)]) -> Map<String, Value> {
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
    // A pipelined piece is checked again on its logic thread, since a checked piece can't cross
    // threads.
    if let Ok(piece) = checked(&line, planted) {
        if !piece.items.is_empty() && piece.items.iter().all(pipelined) {
            return front(line, piece, planted, inbox, outbox);
        }
    }
    let mut world = match build(&line, planted) {
        Ok((w, items)) => {
            let _ = outbox.send(items);
            w
        }
        Err(e) => {
            let _ = outbox.send(e);
            return;
        }
    };
    let len = world.piece.items.first().map_or(F / 60, |i| i.step);
    let mut fork_at: Option<i64> = None;
    // The most CPU one step (with its checkpoint) has taken: what the next one may take.
    let mut step_ns = 0u64;
    for Latched { t, set } in inbox {
        let at = world.at().unwrap_or(0);
        let mut stamped = Value::Null;
        if let Some((control, value)) = set {
            let k = ((t + len - 1) / len + 1).max(at);
            let e = Entry {
                t: k * len,
                seq: 0,
                control,
                value,
                writer: "you".into(),
                player: 1,
                as_of: None,
                arrived: 0,
            };
            stamped = e.to_json();
            world.fork_track(k, &[e]);
            fork_at = Some(k * len);
        }
        // The planted blend draws toward the next step, so it steps one further.
        let ahead = planted.linear_blends_forward
            && world
                .piece
                .items
                .iter()
                .any(|i| i.writes.iter().any(|w| w.linear));
        let want = t / len + 1 + i64::from(ahead);
        let start = cpu_ns();
        // A seek back, or a checkpoint nearer than stepping on, restores it.
        let at = world.at().unwrap_or(0);
        if let Some(c) = world.nearest(want) {
            if want < at || c > at {
                if let Err(e) = world.seek(c) {
                    let _ = outbox.send(e);
                    return;
                }
            }
        }
        // The steps that run, one at a time within the slice; a turn clock's idle steps cost none.
        let (mut steps, mut cut) = (0, false);
        while let Some(k) = world.wake().filter(|k| *k < want) {
            let used = cpu_ns() - start;
            if !planted.simulate_runs_all_steps
                && steps > 0
                && (used + step_ns) as f64 > FRAME_NS * SLICE
            {
                cut = true;
                break;
            }
            let before = cpu_ns();
            world.run(k + 1, &mut Record::default(), &mut |_, _| {});
            step_ns = step_ns.max(cpu_ns() - before);
            steps += 1;
        }
        // On to `want` past steps nothing asks for, and the checkpoint due there, if any.
        if !cut && world.at().is_some_and(|a| a <= want) {
            world.run(want, &mut Record::default(), &mut |_, _| {});
        }
        let eval_ns = cpu_ns() - start;
        let at = world.at().unwrap_or(0);
        let reply = json!({"want": want, "at": at, "stale": at != want, "steps": steps, "eval_ns": eval_ns,
            "deep_hash": world.deep_hashes(), "stamped": stamped, "fork_at": fork_at,
            "draws": world.drawn(t), "valid_until": if at == want { world.valid_until(t) } else { Some(t + 1) },
            "drawn": hashes(at - 1, &world.arrays())});
        if outbox.send(reply).is_err() {
            return;
        }
    }
}

/// What a pipelined view's logic thread tells its render worker.
enum Up {
    /// The check's reply, the step length and what a frame draws before step 0, once.
    Opened(Value, i64, Vec<Shown>),
    /// A latched frame's `set` taken: the entry it stamped and the fork's time.
    Took(Option<(Value, i64)>),
    /// The steps from this one on aren't the ones sent before: a seek or a fork.
    Reset(i64),
    /// A step ended: the full-state hashes just after it and what a frame draws from it.
    Ended(i64, Map<String, Value>, Vec<Shown>),
    Failed(Value),
}

/// A pipelined view's logic thread: it owns the world and runs every step up to one past the step
/// the newest frame draws, taking each latched frame between steps.
fn logic(line: Value, planted: Planted, inbox: Receiver<Latched>, up: Sender<Up>) {
    let mut world = match build(&line, planted) {
        Ok((w, items)) => {
            let len = w.piece.items[0].step;
            let _ = up.send(Up::Opened(items, len, w.shown()));
            w
        }
        Err(e) => {
            let _ = up.send(Up::Opened(e, 0, Vec::new()));
            return;
        }
    };
    let len = world.piece.items[0].step;
    // The planted blend draws toward the next step, so it steps one further.
    let ahead = i64::from(planted.linear_blends_forward);
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
            let at = world.at().unwrap_or(0);
            let mut took = None;
            if let Some((control, value)) = set {
                let k = ((t + len - 1) / len + 1).max(at);
                let e = Entry {
                    t: k * len,
                    seq: 0,
                    control,
                    value,
                    writer: "you".into(),
                    player: 1,
                    as_of: None,
                    arrived: 0,
                };
                took = Some((e.to_json(), k * len));
                world.fork_track(k, &[e]);
                let _ = up.send(Up::Reset(k));
            }
            let due = t / len + ahead;
            want = due + 2;
            // A seek back, or a checkpoint nearer than stepping on, restores the nearest at or
            // before the step the frame draws.
            if let Some(c) = world.nearest(due) {
                if want < at || c > at {
                    if let Err(e) = world.seek(c) {
                        let _ = up.send(Up::Failed(e));
                        return;
                    }
                    let _ = up.send(Up::Reset(c));
                }
            }
            if took.is_some() && up.send(Up::Took(took)).is_err() {
                return;
            }
            continue;
        }
        let Some(k) = world.at() else { return };
        world.run(k + 1, &mut Record::default(), &mut |_, _| {});
        if up
            .send(Up::Ended(k, world.deep_hashes(), world.shown()))
            .is_err()
        {
            return;
        }
    }
}

/// A pipelined view's render worker: it hands each latched frame to the logic thread and draws
/// from the step due at the frame's time, waiting (with no CPU) until that step has ended.
fn front(
    line: Value,
    piece: Piece,
    planted: Planted,
    inbox: Receiver<Latched>,
    outbox: Sender<Value>,
) {
    let (to, logic_in) = channel::<Latched>();
    let (up_out, up) = channel::<Up>();
    let spawned = std::thread::Builder::new()
        .name("deep-logic logic thread".into())
        .spawn(move || logic(line, planted, logic_in, up_out));
    let (len, before) = match (spawned, up.recv()) {
        (Ok(_), Ok(Up::Opened(first, len, before))) => {
            let ok = first.get("ok") == Some(&json!(true));
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
    let ahead = i64::from(planted.linear_blends_forward);
    // Each ended step's full-state hashes and what a frame draws from it, until a reset drops it.
    let mut ended: BTreeMap<i64, (Map<String, Value>, Vec<Shown>)> = BTreeMap::new();
    let mut fork_at: Option<i64> = None;
    for Latched { t, set } in inbox {
        let mut took = set.is_none().then_some(None);
        if to.send(Latched { t, set }).is_err() {
            return;
        }
        let start = cpu_ns();
        let due = t / len + ahead;
        let mut listed: Map<String, Value> = Map::new();
        let mut steps = 0;
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
                Up::Ended(k, deep, shown) => {
                    steps += i64::from(k <= due);
                    for (id, h) in &deep {
                        let list = listed.entry(id.clone()).or_insert_with(|| json!([]));
                        if let Some(list) = list.as_array_mut() {
                            list.push(json!({"step": k, "deep_hash": h}));
                        }
                    }
                    ended.insert(k, (deep, shown));
                }
                // Steps from a restore on are the ones this frame lands with.
                Up::Reset(k) => {
                    ended.split_off(&k);
                    steps = 0;
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
        // The planted pipeline draws whatever has ended by now as the due step.
        let (deep, shown) = ended
            .range(..=due)
            .next_back()
            .map_or((json!({}), &before), |(_, (d, s))| (json!(d), s));
        let draws = world::drawn(
            &piece,
            shown.iter().map(|(l, p, a)| (*l, &p[..], &a[..])),
            t,
            planted.linear_blends_forward,
        );
        let drawn = hashes(
            due,
            &world::arrays_of(&piece, shown.iter().map(|(_, _, a)| &a[..])),
        );
        // Valid until a linear write's blend moves on, else until the next step's time.
        let valid_until = piece
            .items
            .iter()
            .zip(shown)
            .map(|(item, (last, prev, _))| {
                if !prev.is_empty() && *last >= 0 && t < (last + 1) * item.step {
                    t + 1
                } else {
                    (last + 1) * item.step
                }
            })
            .min();
        let eval_ns = cpu_ns() - start;
        let reply = json!({"want": due + 1, "at": due + 1, "stale": !ended.contains_key(&due), "steps": steps,
            "eval_ns": eval_ns, "deep_hash": deep, "stamped": stamped, "fork_at": fork_at,
            "draws": draws, "valid_until": valid_until, "ended": listed, "drawn": drawn});
        // Steps before the one drawn are done with: a seek back runs them again.
        ended = ended.split_off(&due);
        if outbox.send(reply).is_err() {
            return;
        }
    }
}
