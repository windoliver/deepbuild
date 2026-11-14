//! #522: a seek over a stored bake, and physics.determinism (Check input: `physics.determinism`;
//! tests/acceptance/522/README.md: `seek`, `determinism`). A seek restores the ring's checkpoint at
//! or before its step and steps on, never re-baking; physics.determinism runs the bake twice from
//! step 0 and once from each checkpoint before each sampled step, then probes each declared input
//! from the straight state and each restored one, so equal hashes at the sampled times alone
//! never pass.

use super::*;

/// The steps a continuation probe runs after its entry.
const PROBE_STEPS: u64 = 120;

/// The checkpoint a stored bake keeps at or before step `k`, or none (the world as built).
pub(super) fn nearest(bake: &Value, k: u64) -> Option<Checkpoint> {
    bake["checkpoints"]
        .as_array()?
        .iter()
        .rev()
        .find(|c| c["step"].as_u64().is_some_and(|s| s <= k))
        .and_then(checkpoint_of)
}

/// Where two runs first differ over steps `from..=to`: the step, and the first kind of
/// difference there (its step hash, a checkpoint's canonical or deep hash, its occurrences).
fn first_difference(
    a: &Trace,
    a0: u64,
    b: &Trace,
    b0: u64,
    from: u64,
    to: u64,
) -> Option<(u64, &'static str)> {
    let hash = |t: &Trace, t0: u64, k: u64| t.step_hashes.get((k - t0) as usize).cloned();
    let kept = |t: &Trace, k: u64| {
        t.ring
            .kept
            .iter()
            .find(|c| c.checkpoint.step == k)
            .map(|c| (c.step_hash.clone(), c.deep_hash.clone()))
    };
    let rows = |t: &Trace, k: u64| {
        t.occurrences
            .iter()
            .filter(|r| u64::from(r.step) == k)
            .cloned()
            .collect::<Vec<_>>()
    };
    for k in from..=to {
        if hash(a, a0, k) != hash(b, b0, k) {
            return Some((k, "step_hash"));
        }
        if let (Some(x), Some(y)) = (kept(a, k), kept(b, k)) {
            if x.0 != y.0 {
                return Some((k, "canonical_hash"));
            }
            if x.1 != y.1 {
                return Some((k, "deep_hash"));
            }
        }
        if rows(a, k) != rows(b, k) {
            return Some((k, "occurrences"));
        }
    }
    None
}

impl Run {
    /// `world` built, then restored from `cp` as this runner restores (a planted restore leaves
    /// part of it out); as built when there's no checkpoint.
    pub(super) fn restored(
        &self,
        world: &Value,
        cp: Option<&Checkpoint>,
    ) -> Result<(World, Rapier), Value> {
        let (w, mut b) = self.build(world)?;
        if let Some(cp) = cp {
            let built = b.checkpoint();
            b.restore(cp)
                .map_err(|r| json!({"ok": false, "code": r.code, "path": r.path, "actual": r.actual, "what": r.what}))?;
            b.plant(self.restore, &built);
        }
        Ok((w, b))
    }

    /// Steps `b` on `steps` steps with `track`, from where it stands, into a fresh trace.
    fn ran(
        &self,
        b: &mut Rapier,
        w: &World,
        steps: u64,
        track: &Track,
        read: Option<Map<String, Value>>,
    ) -> Result<Trace, Value> {
        let plan = Plan {
            steps,
            scene: None,
            every: 1,
            guard: false,
            ftz_at: None,
            shift: None,
            track,
        };
        let mut t = Trace {
            bodies: read.unwrap_or_default(),
            ..Trace::default()
        };
        match self.run(b, w, &plan, &mut t) {
            Ok(()) => Ok(t),
            Err(Stop::Refused(v)) => Err(v),
            Err(Stop::Register(step, what)) => {
                Err(json!({"ok": false, "code": "physics.fp_control", "step": step, "what": what}))
            }
        }
    }

    /// `seek`: the bake kept under this world's, track's, span's and frame rate's key, restored
    /// from its ring's checkpoint at or before `to`, stepped to `to` and `play` more steps on its
    /// track; `no_bake` with none. It never re-bakes and stores nothing.
    pub(super) fn seek(&self, call: &Value) -> Option<Value> {
        let world = call.get("world")?;
        let (steps, dir, to) = (
            call.get("steps")?.as_u64()?,
            call.get("store")?.as_str()?,
            call.get("to")?.as_u64()?,
        );
        let play = call.get("play").map_or(Some(0), Value::as_u64)?;
        let reply = (|| {
            let (rate, _) = rate(call)?;
            let (w, _) = self.build(world)?;
            let track = Track::read(&w, call)?;
            let key = self.key(
                world,
                &json!([]),
                &track.json(),
                &rate,
                steps,
                Some(&self.build.target),
            );
            let Some(bake) = stored(dir, &key) else {
                return Ok(
                    json!({"ok": false, "code": "no_bake", "key": key, "what": "the store holds no bake under this key; a seek reads a bake and never re-bakes"}),
                );
            };
            let (w, mut b) = self.restored(world, nearest(&bake, to).as_ref())?;
            let from = b.read().step;
            let read = series(call, &b).ok_or_else(|| json!({"ok": false, "code": "bad_input"}))?;
            let t = self.ran(&mut b, &w, to + play - from, &track, Some(read))?;
            Ok(
                json!({"ok": true, "key": key, "from": from, "step_hashes": t.step_hashes, "bodies": t.bodies}),
            )
        })();
        Some(reply.unwrap_or_else(|e: Value| e))
    }

    /// physics.determinism over `world` and its track for `steps` steps, sampled at `at_times`.
    pub(super) fn determinism(&self, call: &Value) -> Option<Value> {
        let world = call.get("world")?;
        let steps = call.get("steps")?.as_u64()?;
        let at_times: Vec<f64> = call
            .get("at_times")?
            .as_array()?
            .iter()
            .map(Value::as_f64)
            .collect::<Option<_>>()?;
        let compare = call
            .get("compare")
            .and_then(Value::as_str)
            .unwrap_or("same_machine");
        let reply = |verdict: &str, failures: Vec<Value>| json!({"ok": true, "kind": "physics.determinism", "verdict": verdict, "failures": failures});
        if compare != "same_machine" {
            return Some(
                json!({"ok": true, "kind": "physics.determinism", "verdict": "BLOCKED", "failures": [],
                               "what": format!("compare {compare} needs runs on other machines, which this check doesn't make")}),
            );
        }
        let ran = (|| {
            let (w, mut b) = self.build(world)?;
            let track = Track::read(&w, call)?;
            let straight = self.ran(&mut b, &w, steps, &track, None)?;
            let (_, mut b2) = self.build(world)?;
            let twice = self.ran(&mut b2, &w, steps, &track, None)?;
            let mut failures = Vec::new();
            let fail = |run: &str,
                        from: Option<u64>,
                        at: Option<u64>,
                        input: Option<&str>,
                        (step, field): (u64, &str)| {
                json!({"run": run, "from": from, "at": at, "input": input, "step": step, "field": field})
            };
            if let Some(d) = first_difference(&straight, 0, &twice, 0, 0, steps) {
                failures.push(fail("twice", None, None, None, d));
            }
            let sampled = at_times
                .iter()
                .map(|t| (t * w.step_rate).floor() as u64)
                .filter(|s| *s <= steps);
            for s in sampled {
                // The straight state at s, stepped from the world as built, never restored.
                let (_, mut at_s) = self.build(world)?;
                self.ran(&mut at_s, &w, s, &track, None)?;
                let mine = at_s.checkpoint();
                let probes: Vec<(String, Trace)> = w
                    .inputs
                    .keys()
                    .map(|id| {
                        self.probe(world, &w, &mine, &track, id, s)
                            .map(|t| (id.clone(), t))
                    })
                    .collect::<Result<_, _>>()?;
                for c in straight.ring.kept.iter().filter(|c| c.checkpoint.step < s) {
                    let from = c.checkpoint.step;
                    let (_, mut b) = self.restored(world, Some(&c.checkpoint))?;
                    let run = self.ran(&mut b, &w, s - from, &track, None)?;
                    if let Some(d) = first_difference(&straight, 0, &run, from, from, s) {
                        failures.push(fail("checkpoint", Some(from), Some(s), None, d));
                    }
                    let theirs = b.checkpoint();
                    for (id, want) in &probes {
                        let got = self.probe(world, &w, &theirs, &track, id, s)?;
                        if let Some(d) = first_difference(want, s, &got, s, s + 1, s + PROBE_STEPS)
                        {
                            failures.push(fail("probe", Some(from), Some(s), Some(id), d));
                        }
                    }
                }
            }
            Ok(failures)
        })();
        Some(match ran {
            Ok(f) if f.is_empty() => reply("PASS", f),
            Ok(f) => reply("FAIL", f),
            Err(e) => e,
        })
    }

    /// A continuation probe: the state `cp` at step `s` loaded whole, an entry of input `id`
    /// stamped `s` with its defaults on its first target, then 120 steps on the track.
    fn probe(
        &self,
        world: &Value,
        w: &World,
        cp: &Checkpoint,
        track: &Track,
        id: &str,
        s: u64,
    ) -> Result<Trace, Value> {
        let (_, mut b) = self.build(world)?;
        b.restore(cp)
            .map_err(|r| json!({"ok": false, "code": r.code, "what": r.what}))?;
        let input = &w.inputs[id];
        let mut entries = track.entries.clone();
        entries.push(Entry {
            step: s,
            kind: input.kind.clone(),
            target: input.targets.first().cloned().unwrap_or_default(),
            input: id.into(),
            data: input.defaults.clone(),
        });
        self.ran(&mut b, w, PROBE_STEPS, &Track::of(entries), None)
    }
}
