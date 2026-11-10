//! A live view of a piece with no bake (canvas primitives: Carried state, Render worker, Input
//! track; #532): the UI thread latches each frame's input, and the render worker's simulate phase
//! runs the steps the frame needs within the class's worker CPU, so a seek far ahead runs across
//! frames while the view shows its last stepped state, marked stale. A seek restores the nearest
//! checkpoint at or before it when that's nearer than stepping on; a newer seek cancels the steps
//! an older one still needed and keeps every checkpoint taken. A change of a control is stamped at
//! the first step at or after the playhead plus the input lead (one step while silent), or the
//! first step not yet run, whichever is later, and forks the track there.

use std::rc::Rc;
use std::sync::mpsc::{channel, Receiver, Sender};

use serde_json::{json, Value};

use crate::budget::{cpu_ns, FRAME_NS};
use crate::piece::{self, History};
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

/// A view's render worker: its thread owns the piece's world.
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

fn worker(line: Value, planted: Planted, inbox: Receiver<Latched>, outbox: Sender<Value>) {
    let mut history = History::new();
    let built = (|| {
        let piece = Rc::new(
            piece::check(
                line.get("piece").unwrap_or(&Value::Null),
                &planted,
                &mut history,
            )
            .map_err(|r| r.0)?,
        );
        let entries = track(&piece, &line, 0)
            .ok_or_else(|| json!({"ok": false, "code": "bad_input", "what": "track"}))?;
        let items: serde_json::Map<String, Value> = piece
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
        Ok::<_, Value>((world, items))
    })();
    let mut world = match built {
        Ok((w, items)) => {
            let _ = outbox.send(json!({"ok": true, "items": items}));
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
            "draws": world.drawn(t), "valid_until": if at == want { world.valid_until(t) } else { Some(t + 1) }});
        if outbox.send(reply).is_err() {
            return;
        }
    }
}
