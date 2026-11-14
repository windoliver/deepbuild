//! #2010: a golden replayed on this machine (Golden), moved here from runner.rs whole; #524 lets it
//! name a scene's world, keyed with the scene's reads as its bake is.

use super::*;

impl Run {
    /// Replays a golden's world on this machine (Golden): each step's start asserts the control
    /// register; then the first step whose hash differs, and the first body and field that differ
    /// at the recording bake's first checkpoint at or after it.
    pub(super) fn verify(&self, call: &Value) -> Option<Value> {
        let (world, scene) = match self.subject(call)? {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let (g, world) = (call.get("golden")?, &world);
        let shift = match call.get("shift") {
            None => None,
            Some(s) => Some((
                s.get("step")?.as_u64()?,
                s.get("id")?.as_str()?.to_string(),
                FIELDS
                    .iter()
                    .position(|f| Some(*f) == s.get("field").and_then(Value::as_str))?,
                s.get("ulps").map_or(Some(1), Value::as_i64)?,
            )),
        };
        let plan = Plan {
            steps: call.get("steps")?.as_u64()?,
            scene: scene.as_ref(),
            every: 1,
            guard: true,
            ftz_at: call
                .get("ftz_at")
                .map(Value::as_u64)
                .map_or(Some(None), |s| s.map(Some))?,
            shift,
            track: &NO_TRACK,
        };
        let dir = call
            .get("store")
            .map(Value::as_str)
            .map_or(Some(None), |s| s.map(Some))?;
        let (rate, _) = match rate(call) {
            Ok(r) => r,
            Err(e) => return Some(e),
        };
        let (w, mut b) = match self.build(world) {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let reads = reads(&plan, plan.steps);
        let key = self.key(world, &reads, &json!([]), &rate, plan.steps, None);
        let digest = self.build.runtime_digest();
        let here = machine(&self.build.target);
        let machines = golden::machines(g, &here);
        let mut reply = json!({"ok": true, "verdict": "FAIL", "bake_key": key, "runtime_digest": digest,
                               "machine": here, "target": self.build.target, "machines": machines,
                               "report": null, "failure": null});
        if g["bake_key"] != json!(key) || g["runtime_digest"] != json!(digest) {
            reply["refused"] = json!(format!(
                "a golden is never compared under another key or runtime digest: it holds {} and {}, this run {key} and {digest}",
                g["bake_key"], g["runtime_digest"]
            ));
            return Some(reply);
        }
        let mut t = Trace::default();
        let ran = self.run(&mut b, &w, &plan, &mut t);
        // This replay's own step hashes, so a second machine's run is compared step for step.
        reply["step_hashes"] = json!(t.step_hashes);
        match ran {
            Err(Stop::Refused(v)) => return Some(v),
            Err(Stop::Register(step, what)) => {
                reply["failure"] = json!({"step": step, "register": fp::REGISTER, "what": what});
                return Some(reply);
            }
            Ok(()) => {}
        }
        let recorded: Vec<&str> = g["step_hashes"]
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<_>>()?;
        let n = recorded.len().max(t.step_hashes.len());
        let Some(k) =
            (0..n).find(|&i| recorded.get(i).copied() != t.step_hashes.get(i).map(String::as_str))
        else {
            reply["verdict"] = json!("PASS");
            return Some(reply);
        };
        let every = w.checkpoint_every;
        let c = (k as u64).max(1).div_ceil(every) * every;
        let checkpoint = (c <= plan.steps).then_some(c);
        let field = checkpoint.zip(dir).and_then(|(c, dir)| {
            let target = g["record_on"].as_str()?;
            let bake = stored(
                dir,
                &self.key(world, &reads, &json!([]), &rate, plan.steps, Some(target)),
            )?;
            let cp = bake["checkpoints"]
                .as_array()?
                .iter()
                .find(|x| x["step"] == json!(c))
                .and_then(checkpoint_of)?;
            let (_, mut theirs) = self.build(world).ok()?;
            theirs.restore(&cp).ok()?;
            golden::first_field(&theirs.canonical(), t.at.get(&c)?)
        });
        reply["report"] = json!({"first_step": k, "checkpoint": checkpoint, "field": field});
        Some(reply)
    }
}
