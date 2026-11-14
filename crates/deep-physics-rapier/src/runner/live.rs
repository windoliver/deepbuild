//! #522: a world's views (canvas primitives: Physics output, Carried state, Input track;
//! tests/acceptance/522/README.md: `view`, `frame`, `record`). A view's render worker is a
//! thread that owns the world; the thread that reads calls is its UI thread. A baked view plays
//! and seeks its stored bake and steps only to fork, re-simulating from the bake's checkpoint at
//! or before the fork and keeping the new bake under its new key. A live view has no bake: each
//! frame's simulate phase runs the steps that frame needs within the render worker's 4 ms of
//! CPU, so a far seek runs across frames while the view shows its last stepped state, marked
//! stale. A seek or a scrub only moves the playhead; a new input where later entries exist forks
//! the track; a late entry joins at its step, drops nothing, and the world restores its
//! checkpoint at or before it and steps forward again, its replaced steps' occurrences, hashes and
//! checkpoints dropped.

use std::sync::mpsc::{channel, Receiver, Sender};

use super::timeline::nearest;
use super::*;

/// The render worker's CPU a frame (the budget class's 4 ms), and the share of it the simulate
/// phase plans to: it stops before a step that could take it past this.
const FRAME_NS: u64 = 4_000_000;
const SLICE: f64 = 0.85;

#[cfg(target_os = "macos")]
const CLOCK_THREAD_CPUTIME_ID: std::ffi::c_int = 16;
#[cfg(not(target_os = "macos"))]
const CLOCK_THREAD_CPUTIME_ID: std::ffi::c_int = 3;

#[repr(C)]
struct Timespec {
    tv_sec: i64,
    tv_nsec: i64,
}

extern "C" {
    fn clock_gettime(clock: std::ffi::c_int, tp: *mut Timespec) -> std::ffi::c_int;
}

/// This thread's CPU time, ns.
fn cpu_ns() -> u64 {
    let mut t = Timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid, writable timespec for the call to fill; the clock ID is the
    // platform's thread CPU clock.
    unsafe { clock_gettime(CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

/// A view open on this runner: the channels to its render worker.
pub(super) struct View {
    to: Sender<Value>,
    from: Receiver<Value>,
}

impl Run {
    /// A runner with this one's caps, build and planted fault, for a view's worker.
    fn twin(&self) -> Run {
        Run {
            caps: self.caps,
            restore_any_version: self.restore_any_version,
            round_hashes: self.round_hashes,
            key_without_rate: self.key_without_rate,
            table: self.table,
            engine_order: self.engine_order,
            bypass: self.bypass,
            machines_any: self.machines_any,
            build: self.build.clone(),
            restore: self.restore,
            ring_drops_oldest: self.ring_drops_oldest,
            fork_on_scrub: self.fork_on_scrub,
            keeps_replaced: self.keeps_replaced,
            late_forks: self.late_forks,
            all_steps: self.all_steps,
            declared_masses_only: self.declared_masses_only,
            twin: self.twin,
            views: std::cell::RefCell::default(),
        }
    }

    /// `view`: opens a session on its own render worker; its reply, with the session's name.
    pub(super) fn view(&self, call: &Value) -> Option<Value> {
        let (to, inbox) = channel::<Value>();
        let (outbox, from) = channel::<Value>();
        let (run, open) = (self.twin(), call.clone());
        std::thread::Builder::new()
            .name("deep-physics render worker".into())
            .spawn(move || worker(run, &open, &inbox, &outbox))
            .ok()?;
        let mut first = from.recv().ok()?;
        if first.get("ok") == Some(&json!(true)) {
            let mut views = self.views.borrow_mut();
            let session = format!("view-{}", views.len() + 1);
            first["session"] = json!(session);
            views.insert(session, View { to, from });
        }
        Some(first)
    }

    fn ask(&self, call: &Value) -> Option<Value> {
        let views = self.views.borrow();
        let v = views.get(call.get("session")?.as_str()?)?;
        v.to.send(call.clone()).ok()?;
        v.from.recv().ok()
    }

    /// `frame`: one frame of a session, its UI thread's CPU time beside the worker's reply.
    pub(super) fn frame(&self, call: &Value) -> Option<Value> {
        let ui = cpu_ns();
        let mut reply = self.ask(call)?;
        reply["ui_ns"] = json!(cpu_ns() - ui);
        Some(reply)
    }

    /// `record`: what the session's world holds now.
    pub(super) fn recorded(&self, call: &Value) -> Option<Value> {
        self.ask(call)
    }
}

/// The render worker: opens the session, answers its first reply, then one reply a call.
fn worker(run: Run, open: &Value, inbox: &Receiver<Value>, outbox: &Sender<Value>) {
    let mut s = match Session::open(run, open) {
        Ok((s, reply)) => {
            if outbox.send(reply).is_err() {
                return;
            }
            s
        }
        Err(e) => {
            let _ = outbox.send(e);
            return;
        }
    };
    for call in inbox {
        let reply = match call["call"].as_str() {
            Some("record") => s.record(),
            _ => s.frame(&call).unwrap_or_else(|e| e),
        };
        if outbox.send(reply).is_err() {
            return;
        }
    }
}

struct Session {
    run: Run,
    world: Value,
    w: World,
    b: Rapier,
    rank: BTreeMap<String, u32>,
    track: Track,
    /// The span's steps, and the frame rate its bake keys.
    span: u64,
    rate: (String, i64),
    store: Option<String>,
    /// The bake a baked session plays, as its store keeps it.
    baked: Option<Value>,
    /// The state the world stands at, and the playhead's step.
    at: u64,
    want: u64,
    frame: u64,
    /// The step hash of each state 0 … `at` and beyond, each step's rows, and the ring.
    hashes: Vec<String>,
    rows: BTreeMap<u64, Vec<occurrence::Row>>,
    ring: Ring,
    /// The planted restore's: rows of replaced steps it keeps beside those written again.
    stale_rows: Vec<occurrence::Row>,
}

/// What a frame did before it simulated.
#[derive(Default)]
struct Acts {
    stamped: Option<Value>,
    fork_at: Option<u64>,
    dropped: Vec<Value>,
    restored: Option<u64>,
    steps: u64,
}

impl Session {
    fn open(run: Run, call: &Value) -> Result<(Session, Value), Value> {
        let bad = || json!({"ok": false, "code": "bad_input"});
        let world = call.get("world").ok_or_else(bad)?.clone();
        let span_s = call.get("span").and_then(Value::as_f64).ok_or_else(bad)?;
        let (w, b) = run.build(&world)?;
        let track = Track::read(&w, call)?;
        let span = (span_s * w.step_rate).round() as u64;
        let rate = rate(&json!({}))?;
        let store = call.get("store").and_then(Value::as_str).map(String::from);
        let mut ring = Ring::new(w.checkpoint_every, w.checkpoint_budget);
        ring.drops_oldest = run.ring_drops_oldest;
        let mut s = Session {
            rank: occurrence::ranks(&w),
            hashes: vec![run.hash(&b.canonical(), &b.joints())],
            run,
            world,
            w,
            b,
            track,
            span,
            rate,
            store,
            baked: None,
            at: 0,
            want: 0,
            frame: 0,
            rows: BTreeMap::new(),
            ring,
            stale_rows: Vec::new(),
        };
        let key = s.key();
        s.baked = s.store.as_deref().and_then(|d| stored(d, &key));
        let reply = json!({"ok": true, "key": key, "baked": s.baked.is_some(),
                           "track_hash": track::hash(&s.track.entries), "track": s.track.json()});
        Ok((s, reply))
    }

    fn key(&self) -> String {
        let t = Some(self.run.build.target.as_str());
        self.run.key(
            &self.world,
            &json!([]),
            &self.track.json(),
            &self.rate.0,
            self.span,
            t,
        )
    }

    /// One frame: its acts, then its simulate phase.
    fn frame(&mut self, call: &Value) -> Result<Value, Value> {
        let start = cpu_ns();
        self.frame += 1;
        let mut acts = Acts::default();
        let scrub = call.get("scrub").and_then(Value::as_u64);
        if let Some(k) = call.get("seek").and_then(Value::as_u64).or(scrub) {
            if scrub.is_some() && self.run.fork_on_scrub {
                // The planted transport: a scrub forks the track at the playhead's step.
                let at = self.want;
                let dropped = self.cut(at);
                acts.dropped = dropped;
                acts.fork_at = Some(at);
                self.resimulate(at, &mut acts)?;
            }
            self.want = k;
            if self.baked.is_none() {
                self.seek(k, &mut acts)?;
            }
        }
        if let Some(i) = call.get("input") {
            let stamp = if self.baked.is_some() {
                self.want + 1
            } else {
                (self.want + 1).max(self.at)
            };
            let mut v = i.clone();
            v["step"] = json!(stamp);
            let e = track::entry(&self.w, &v, "input").map_err(|r| refused(&[*r]))?;
            acts.stamped = Some(e.json());
            if self.track.entries.iter().any(|x| x.step > stamp) {
                acts.dropped = self.cut(stamp);
                acts.fork_at = Some(stamp);
            }
            let mut entries = self.track.entries.clone();
            entries.push(e);
            self.track = Track::of(entries);
            self.resimulate(stamp, &mut acts)?;
        }
        if let Some(l) = call.get("late") {
            let e = track::entry(&self.w, l, "late").map_err(|r| refused(&[*r]))?;
            let step = e.step;
            let mut entries = self.track.entries.clone();
            if self.run.late_forks {
                let before = entries.clone();
                track::fork(&mut entries, e);
                acts.dropped = before
                    .iter()
                    .filter(|x| x.step > step)
                    .map(Entry::json)
                    .collect();
                acts.fork_at = Some(step);
            } else {
                track::join(&mut entries, e);
            }
            self.track = Track::of(entries);
            self.replace_after(step);
            if self.baked.is_some() {
                self.resimulate(step, &mut acts)?;
            } else {
                self.restore(step, &mut acts)?;
            }
        }
        if self.baked.is_none() {
            let mut cost = 0;
            while self.at < self.want {
                let spent = cpu_ns() - start;
                if !self.run.all_steps
                    && acts.steps > 0
                    && (spent + cost) as f64 > SLICE * FRAME_NS as f64
                {
                    break;
                }
                let t0 = cpu_ns();
                self.step()?;
                cost = cost.max(cpu_ns() - t0);
                acts.steps += 1;
            }
        }
        let eval_ns = cpu_ns() - start;
        let shown = if self.baked.is_some() {
            self.want
        } else {
            self.at
        };
        let step_hash = match &self.baked {
            Some(r) => r["step_hashes"][shown as usize].clone(),
            None => json!(self.hashes[shown as usize]),
        };
        let h = occurrence::step_flicks(&self.w) as u64;
        Ok(
            json!({"ok": true, "frame": self.frame, "t": self.want * h, "want": self.want, "at": shown,
                  "stale": shown != self.want, "steps": acts.steps, "eval_ns": eval_ns,
                  "step_hash": step_hash, "key": self.key(), "track_hash": track::hash(&self.track.entries),
                  "track": self.track.json(), "stamped": acts.stamped, "fork_at": acts.fork_at,
                  "dropped": acts.dropped, "restored": acts.restored}),
        )
    }

    /// Drops every entry after step `k`, as a fork does; the dropped entries.
    fn cut(&mut self, k: u64) -> Vec<Value> {
        let dropped = self
            .track
            .entries
            .iter()
            .filter(|x| x.step > k)
            .map(Entry::json)
            .collect();
        let kept = self
            .track
            .entries
            .iter()
            .filter(|x| x.step <= k)
            .cloned()
            .collect();
        self.track = Track::of(kept);
        dropped
    }

    /// Drops what the steps after step `k` left, which a new entry at `k` replaces: their step
    /// hashes, checkpoints and occurrences (the planted restore keeps the occurrences).
    fn replace_after(&mut self, k: u64) {
        self.hashes.truncate(k as usize + 1);
        self.ring.drop_after(k);
        let later: Vec<u64> = self.rows.range(k + 1..).map(|(s, _)| *s).collect();
        for s in later {
            let rows = self.rows.remove(&s).unwrap_or_default();
            if self.run.keeps_replaced {
                self.stale_rows.extend(rows);
            }
        }
    }

    /// A live seek to `k`: the ring's checkpoint at or before it restored when that's nearer
    /// than stepping on (always, for a step behind the world); the world as built when the ring
    /// keeps none.
    fn seek(&mut self, k: u64, acts: &mut Acts) -> Result<(), Value> {
        let c = self.ring.at_or_before(k).map_or(0, |c| c.checkpoint.step);
        if k < self.at || c > self.at {
            self.load(c, acts)?;
        }
        Ok(())
    }

    /// After a new entry at step `k`, a live world past it restores its checkpoint at or before
    /// `k`; a baked session re-simulates.
    fn resimulate(&mut self, k: u64, acts: &mut Acts) -> Result<(), Value> {
        if self.baked.is_none() {
            self.replace_after(k);
            if self.at > k {
                self.restore(k, acts)?;
            }
            return Ok(());
        }
        let record = self.baked.take().unwrap_or_default();
        let cp = nearest(&record, k);
        let from = cp.as_ref().map_or(0, |c| c.step);
        let (w, mut b) = self.run.restored(&self.world, cp.as_ref())?;
        let mut t = prefix(&record, &w, from, self.run.ring_drops_oldest);
        let plan = Plan {
            steps: self.span - from,
            scene: None,
            every: 1,
            guard: false,
            ftz_at: None,
            shift: None,
            track: &self.track,
        };
        if let Err(Stop::Refused(v)) = self.run.run(&mut b, &w, &plan, &mut t) {
            return Err(v);
        }
        let whole = Plan {
            steps: self.span,
            ..plan.clone()
        };
        let (key, rec) =
            self.run
                .record(&self.world, &w, &whole, (&self.rate.0, self.rate.1), &mut t);
        if let Some(dir) = &self.store {
            keep(dir, &key, &rec)?;
        }
        self.baked = Some(rec);
        acts.restored = Some(from);
        acts.steps += self.span - from;
        Ok(())
    }

    /// Restores the checkpoint at or before step `k`.
    fn restore(&mut self, k: u64, acts: &mut Acts) -> Result<(), Value> {
        let c = self.ring.at_or_before(k).map_or(0, |c| c.checkpoint.step);
        self.load(c, acts)
    }

    /// Loads the ring's checkpoint at step `c` (the world as built for 0).
    fn load(&mut self, c: u64, acts: &mut Acts) -> Result<(), Value> {
        let cp = self
            .ring
            .kept
            .iter()
            .find(|x| x.checkpoint.step == c)
            .map(|x| x.checkpoint.clone());
        let (_, b) = self.run.restored(&self.world, cp.as_ref())?;
        self.b = b;
        self.at = c;
        acts.restored = Some(c);
        Ok(())
    }

    /// One step from the state the world stands at, with the entries stamped there.
    fn step(&mut self) -> Result<(), Value> {
        let inputs = self
            .track
            .by_step
            .get(&self.at)
            .map_or(&[][..], Vec::as_slice);
        self.b
            .step(inputs, &Targets::default())
            .map_err(|r| json!({"ok": false, "issues": [issue(&r)]}))?;
        self.at += 1;
        let k = self.at;
        self.rows.insert(
            k,
            occurrence::sorted(k as u32, self.b.occurrences(), &self.rank),
        );
        let hash = self.run.hash(&self.b.canonical(), &self.b.joints());
        self.hashes.truncate(k as usize);
        self.hashes.push(hash.clone());
        if self.ring.due(k) {
            let cp = self.b.checkpoint();
            self.ring.offer(Kept {
                deep_hash: golden::deep_hash(&cp.state),
                step_hash: hash,
                checkpoint: cp,
            });
        }
        Ok(())
    }

    /// `record`: the step hashes of the states 0 … the shown one, the occurrence list up to it,
    /// sorted, and the track.
    fn record(&self) -> Value {
        if let Some(r) = &self.baked {
            let n = self.want as usize + 1;
            let hashes: Vec<Value> = r["step_hashes"]
                .as_array()
                .map_or(Vec::new(), |h| h.iter().take(n).cloned().collect());
            let rows: Vec<Value> = r["occurrences"].as_array().map_or(Vec::new(), |o| {
                o.iter()
                    .filter(|x| x["step"].as_u64().is_some_and(|s| s <= self.want))
                    .cloned()
                    .collect()
            });
            return json!({"ok": true, "at": self.want, "step_hashes": hashes, "occurrences": rows, "track": self.track.json()});
        }
        let mut rows: Vec<occurrence::Row> = self
            .rows
            .range(..=self.at)
            .flat_map(|(_, r)| r.clone())
            .collect();
        rows.extend(
            self.stale_rows
                .iter()
                .filter(|r| u64::from(r.step) <= self.at)
                .cloned(),
        );
        rows.sort_by_key(|r| r.step);
        json!({"ok": true, "at": self.at, "step_hashes": self.hashes[..=self.at as usize],
               "occurrences": occurrence::listed(&rows), "track": self.track.json()})
    }
}

/// What a stored bake holds before step `from`, as a run that re-simulates from its checkpoint
/// there takes it up: the step hashes and positions of states 0 … `from` − 1, the occurrences
/// written through `from`, and the checkpoints it kept through `from`.
fn prefix(record: &Value, w: &World, from: u64, drops_oldest: bool) -> Trace {
    let n = from as usize;
    let step_hashes = record["step_hashes"].as_array().map_or(Vec::new(), |h| {
        h.iter()
            .take(n)
            .filter_map(|x| x.as_str().map(String::from))
            .collect()
    });
    let mut positions = BTreeMap::new();
    for (id, series) in record["positions"].as_object().into_iter().flatten() {
        let p = series
            .as_array()
            .into_iter()
            .flatten()
            .take(n)
            .filter_map(|p| {
                let a = p.as_array()?;
                Some([
                    a.first()?.as_f64()? as f32,
                    a.get(1)?.as_f64()? as f32,
                    a.get(2)?.as_f64()? as f32,
                ])
            });
        positions.insert(id.clone(), p.collect());
    }
    let occurrences = record["occurrences"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(occurrence::row)
        .filter(|r| u64::from(r.step) <= from)
        .collect();
    let mut ring = Ring::new(w.checkpoint_every, w.checkpoint_budget);
    ring.drops_oldest = drops_oldest;
    for c in record["checkpoints"].as_array().into_iter().flatten() {
        let Some(cp) = checkpoint_of(c).filter(|cp| cp.step <= from) else {
            continue;
        };
        let step_hash = record["step_hashes"][cp.step as usize]
            .as_str()
            .unwrap_or_default()
            .to_string();
        ring.offer(Kept {
            deep_hash: golden::deep_hash(&cp.state),
            step_hash,
            checkpoint: cp,
        });
    }
    Trace {
        step_hashes,
        positions,
        occurrences,
        peak: ring.bytes(),
        ring,
        ..Trace::default()
    }
}
