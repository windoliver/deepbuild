//! `deep-physics`: physics.world@1 on Rapier 0.36.1 over JSON lines, one reply a line
//! (tests/acceptance/2009/README.md: The surface under test). `check` runs the document check with
//! caps() and the build; `bake` runs a world from step 0; `restore` runs it on from a checkpoint.
//! `--planted <name>` runs one criterion's wrong program.

use std::io::{BufRead, Write};

use base64::Engine;
use deep_canvas_physics::backend::{Backend, BodyState, Checkpoint};
use deep_canvas_physics::caps::{Caps, RAPIER3D};
use deep_canvas_physics::check::{check, fix};
use deep_canvas_physics::doc::{Refusal, World};
use deep_physics_rapier::Rapier;
use serde_json::{json, Map, Value};

const PLANTED: [&str; 5] = [
    "caps_allow_restitution_threshold",
    "caps_allow_rolling_resistance",
    "caps_allow_tangent_speed",
    "caps_allow_dynamic_gear",
    "restore_ignores_version",
];

const BAD_INPUT: &str = r#"{"ok":false,"code":"bad_input"}"#;

struct Run {
    caps: Caps,
    restore_any_version: bool,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut run = Run {
        caps: RAPIER3D,
        restore_any_version: false,
    };
    match args.as_slice() {
        [] => {}
        [flag, name] if flag == "--planted" && PLANTED.contains(&name.as_str()) => {
            match name.as_str() {
                "caps_allow_restitution_threshold" => run.caps.restitution_threshold = true,
                "caps_allow_rolling_resistance" => run.caps.rolling_resistance = true,
                "caps_allow_tangent_speed" => run.caps.tangent_speed = true,
                "caps_allow_dynamic_gear" => run.caps.dynamic_couplings = true,
                _ => run.restore_any_version = true,
            }
        }
        _ => {
            println!("{BAD_INPUT}");
            std::process::exit(2);
        }
    }
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let reply = serde_json::from_str::<Value>(&line)
            .ok()
            .and_then(|v| run.answer(&v));
        let text = reply.map_or_else(|| BAD_INPUT.to_string(), |r| r.to_string());
        if writeln!(out, "{text}").is_err() {
            break;
        }
    }
}

/// A refusal as the check's issue (What holds a document to its rules), its IDs the entry its
/// path is under.
fn issue(r: &Refusal) -> Value {
    let parts: Vec<&str> = r.path.split('/').collect();
    let ids: Vec<&str> = match parts.as_slice() {
        [map, id, ..]
            if ["bodies", "joints", "shapes", "contact_materials", "forces"].contains(map) =>
        {
            vec![*id]
        }
        _ => vec![],
    };
    json!({"check": "document.validate", "code": r.code, "severity": "error", "ids": ids, "path": r.path,
           "actual": r.actual, "t": Value::Null, "what": r.what, "fix": fix(r.code)})
}

fn state(b: &BodyState) -> Value {
    json!({"pos": b.pos, "rot": b.rot, "linear": b.linear, "angular": b.angular, "contact_impulse": b.contact_impulse})
}

fn checkpoint(c: &Checkpoint) -> Value {
    json!({"step": c.step, "backend": {"name": c.backend, "version": c.version}, "features": c.features,
           "state": base64::engine::general_purpose::STANDARD.encode(&c.state)})
}

/// The bodies `read` names (every body when absent), as `{ID: [state]}` to fill.
fn series(call: &Value, b: &Rapier) -> Option<Map<String, Value>> {
    let all: Vec<String> = b.read().bodies.into_iter().map(|s| s.id).collect();
    let ids: Vec<String> = match call.get("read") {
        None => all,
        Some(r) => r
            .as_array()?
            .iter()
            .map(|x| {
                x.as_str()
                    .filter(|id| all.iter().any(|a| a == id))
                    .map(String::from)
            })
            .collect::<Option<_>>()?,
    };
    Some(
        ids.into_iter()
            .map(|id| (id, Value::Array(Vec::new())))
            .collect(),
    )
}

fn sample(b: &Rapier, out: &mut Map<String, Value>) {
    for s in b.read().bodies {
        if let Some(Value::Array(v)) = out.get_mut(&s.id) {
            v.push(state(&s));
        }
    }
}

impl Run {
    /// The world `v` holds, built, or the issues that refuse it.
    fn build(&self, v: &Value) -> Result<(World, Rapier), Vec<Value>> {
        let w = check(v, &self.caps).map_err(|e| e.iter().map(issue).collect::<Vec<_>>())?;
        let mut b = Rapier::default();
        b.restore_any_version = self.restore_any_version;
        b.build(&w)
            .map_err(|e| e.iter().map(issue).collect::<Vec<_>>())?;
        Ok((w, b))
    }

    fn answer(&self, call: &Value) -> Option<Value> {
        let world = call.get("world")?;
        match call.get("call")?.as_str()? {
            "check" => {
                Some(json!({"ok": true, "issues": self.build(world).err().unwrap_or_default()}))
            }
            "bake" => {
                let steps = call.get("steps")?.as_u64()?;
                let every = call.get("every").map_or(Some(1), Value::as_u64)?.max(1);
                let keep = call
                    .get("checkpoints")
                    .map_or(Some(false), Value::as_bool)?;
                let (w, mut b) = match self.build(world) {
                    Ok(x) => x,
                    Err(issues) => return Some(json!({"ok": false, "issues": issues})),
                };
                let mut bodies = series(call, &b)?;
                let mut checkpoints = Vec::new();
                sample(&b, &mut bodies);
                for k in 1..=steps {
                    if let Err(r) = b.step(&[]) {
                        return Some(json!({"ok": false, "issues": [issue(&r)]}));
                    }
                    if k % every == 0 {
                        sample(&b, &mut bodies);
                    }
                    if keep && k % w.checkpoint_every == 0 {
                        checkpoints.push(checkpoint(&b.checkpoint()));
                    }
                }
                let mut reply = json!({"ok": true, "bodies": bodies});
                if keep {
                    reply["checkpoints"] = Value::Array(checkpoints);
                }
                Some(reply)
            }
            "restore" => {
                let steps = call.get("steps")?.as_u64()?;
                let c = call.get("checkpoint")?;
                let cp = Checkpoint {
                    backend: c.pointer("/backend/name")?.as_str()?.into(),
                    version: c.pointer("/backend/version")?.as_str()?.into(),
                    features: Vec::new(),
                    step: c.get("step")?.as_u64()?,
                    state: base64::engine::general_purpose::STANDARD
                        .decode(c.get("state")?.as_str()?)
                        .ok()?,
                };
                let (_, mut b) = match self.build(world) {
                    Ok(x) => x,
                    Err(issues) => return Some(json!({"ok": false, "issues": issues})),
                };
                if let Err(r) = b.restore(&cp) {
                    return Some(
                        json!({"ok": false, "code": r.code, "path": r.path, "actual": r.actual, "what": r.what}),
                    );
                }
                let mut bodies = series(call, &b)?;
                sample(&b, &mut bodies);
                for _ in 0..steps {
                    if let Err(r) = b.step(&[]) {
                        return Some(json!({"ok": false, "issues": [issue(&r)]}));
                    }
                    sample(&b, &mut bodies);
                }
                Some(json!({"ok": true, "bodies": bodies}))
            }
            _ => None,
        }
    }
}
