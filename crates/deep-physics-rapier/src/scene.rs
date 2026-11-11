//! #1918: a world inside the scene that lists it (World and backend: "its outputs' item paths and
//! its bodies' follow channels resolve in that scene"). Each path physics reads (a kinematic
//! body's `follow`, a motor's `target`, a kinematic solve's driver) is an item path the scene's
//! channels and drivers write, evaluated by the motion module at each step's own time, inside the
//! step (Phase). A read that depends on a physics pose, through a driver reading what the world's
//! outputs write or its lists and readings, is a cycle, refused at check.

use std::collections::BTreeSet;

use deep_canvas_motion::doc::DriverInput;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use deep_canvas_physics::backend::Targets;
use deep_canvas_physics::doc::{Refusal, World};
use serde_json::{json, Value};

/// What a read sets.
enum Sets {
    Follow(String),
    Motor(String),
    Coord(String),
}

struct Read {
    sets: Sets,
    path: String,
    slots: Vec<usize>,
}

/// A world's reads of its scene, compiled.
pub struct Scene {
    program: Program,
    reads: Vec<Read>,
    /// The world's step, flicks.
    step: i64,
}

fn refusal(code: &'static str, path: String, actual: Value, what: String) -> Refusal {
    Refusal {
        code,
        path,
        actual,
        what,
    }
}

/// Whether one path holds the other: `items/ball/at` holds `items/ball/at/pos/1`.
fn overlaps(a: &str, b: &str) -> bool {
    a == b || a.starts_with(&format!("{b}/")) || b.starts_with(&format!("{a}/"))
}

impl Scene {
    /// World `id` of the scene `doc`, as `w` reads it: each path it reads resolved through the
    /// scene's motion, or the refusals of a path that names no item field and of a cycle.
    pub fn read(doc: &Value, id: &str, w: &World) -> Result<Scene, Vec<Refusal>> {
        let scene = doc.as_object().ok_or_else(|| {
            vec![refusal(
                "bad_doc",
                String::new(),
                Value::Null,
                "the scene isn't a document".into(),
            )]
        })?;
        let program = Program::compile(scene).map_err(|r| {
            let what = format!("the scene's motion refuses it: {} at {}", r.code, r.path);
            vec![refusal(
                r.code,
                r.path,
                r.detail.map_or(Value::Null, |d| *d),
                what,
            )]
        })?;
        let mut wanted: Vec<(Sets, String, String, usize)> = Vec::new();
        for (b, body) in &w.bodies {
            if let Some(p) = &body.follow {
                wanted.push((
                    Sets::Follow(b.clone()),
                    p.clone(),
                    format!("bodies/{b}/follow"),
                    3,
                ));
            }
        }
        for (j, joint) in &w.joints {
            if let Some(p) = joint.motor.as_ref().and_then(|m| m.channel.as_ref()) {
                let field = format!("joints/{j}/motor/target");
                wanted.push((Sets::Motor(j.clone()), p.clone(), field, 1));
            }
        }
        for (i, (j, p)) in w.solve.iter().flat_map(|s| &s.drivers).enumerate() {
            let field = format!("solve/drivers/{i}/channel");
            wanted.push((Sets::Coord(j.clone()), p.clone(), field, 1));
        }
        let outputs: Vec<&str> = w.outputs.values().filter_map(|o| o.to.as_deref()).collect();
        let mut out = Vec::new();
        let mut reads = Vec::new();
        for (sets, path, field, width) in wanted {
            let slots = slots(&program, &path, width);
            if slots.is_none() {
                let what = format!(
                    "{path} isn't an item field the scene evaluates ({width} number{})",
                    if width == 1 { "" } else { "s" }
                );
                out.push(refusal("ref_unresolved", field.clone(), json!(path), what));
            }
            if let Some(chain) = cycle(&program, &path, &outputs, id, &mut BTreeSet::new()) {
                let what = format!("{field} reads {path}, which depends on a physics pose ({}); a channel physics reads can't read physics", chain.join(" → "));
                out.push(refusal("cycle", field, json!(path), what));
            }
            reads.extend(slots.map(|slots| Read { sets, path, slots }));
        }
        if !out.is_empty() {
            return Err(out);
        }
        let step = deep_canvas_physics::occurrence::step_flicks(w);
        Ok(Scene {
            program,
            reads,
            step,
        })
    }

    /// Whether the world reads anything of its scene.
    pub fn reads_nothing(&self) -> bool {
        self.reads.is_empty()
    }

    /// Each read's values after step `k`, at its time k × the step.
    fn values(&self, k: u64) -> Vec<Vec<f64>> {
        let mut state = self.program.state();
        self.program
            .evaluate(k as i64 * self.step, Validity::Full, &mut state);
        self.reads
            .iter()
            .map(|r| r.slots.iter().map(|s| state.slots[*s]).collect())
            .collect()
    }

    /// What step `k` reads: each path at the step's own time.
    pub fn targets(&self, k: u64) -> Targets {
        let mut t = Targets::default();
        for (r, v) in self.reads.iter().zip(self.values(k)) {
            match &r.sets {
                Sets::Follow(b) => {
                    t.poses.insert(b.clone(), [v[0], v[1], v[2]]);
                }
                Sets::Motor(j) => {
                    t.motors.insert(j.clone(), v[0]);
                }
                Sets::Coord(j) => t.coords.push((j.clone(), v[0])),
            }
        }
        t
    }

    /// The bake key's `reads` over steps 0 to `steps`: each path and its values at every step, so
    /// a change to a channel or driver the world reads changes the key (Bake: `key`).
    pub fn key_reads(&self, steps: u64) -> Value {
        let paths: Vec<&str> = self.reads.iter().map(|r| r.path.as_str()).collect();
        let values: Vec<Vec<Vec<f64>>> = (0..=steps).map(|k| self.values(k)).collect();
        json!({"paths": paths, "values": values})
    }
}

/// The slots of an item field `items/<id>/<field…>` that is `width` numbers wide: a vector field
/// such as `at/pos` takes its three, a field such as `at/pos/0` its one.
fn slots(program: &Program, path: &str, width: usize) -> Option<Vec<usize>> {
    let rest = path.strip_prefix("items/")?;
    let (owner, field) = rest.split_once('/')?;
    let field: Vec<String> = field.split('/').map(String::from).collect();
    if width == 1 {
        return Some(vec![program.slot_of(owner, &field)?]);
    }
    (0..width)
        .map(|k| {
            let mut f = field.clone();
            f.push(k.to_string());
            program.slot_of(owner, &f)
        })
        .collect()
}

/// The chain by which `path` depends on world `world`'s physics: through a driver writing it
/// whose vars read a path the world's `outputs` write, or its lists and arrays (`<world>.…`).
fn cycle(
    program: &Program,
    path: &str,
    outputs: &[&str],
    world: &str,
    seen: &mut BTreeSet<String>,
) -> Option<Vec<String>> {
    if let Some(o) = outputs.iter().find(|o| overlaps(o, path)) {
        return Some(vec![path.to_string(), format!("{o} (the world's output)")]);
    }
    if !seen.insert(path.to_string()) {
        return None;
    }
    let ours = |name: &str| name.strip_prefix(world).is_some_and(|r| r.starts_with('.'));
    for d in &program.motion.drivers {
        let target = format!("items/{}/{}", d.target.owner, d.target.field.join("/"));
        if !overlaps(&target, path) {
            continue;
        }
        let here = format!("{path} (driver {})", d.id);
        for (_, input) in &d.inputs {
            match input {
                DriverInput::List(f) if ours(&f.list) => return Some(vec![here, f.list.clone()]),
                DriverInput::Array(a) if ours(a) => return Some(vec![here, a.clone()]),
                _ => {}
            }
        }
        for (_, t) in &d.vars {
            let var = format!("items/{}/{}", t.owner, t.field.join("/"));
            if let Some(mut chain) = cycle(program, &var, outputs, world, seen) {
                chain.insert(0, here);
                return Some(chain);
            }
        }
    }
    None
}
