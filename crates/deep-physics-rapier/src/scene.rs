//! #1918: a world inside the scene that lists it (World and backend: "its outputs' item paths and
//! its bodies' follow channels resolve in that scene"). Each path physics reads (a kinematic
//! body's `follow`, a motor's `target`, a kinematic solve's driver, and with #2371 a drag's
//! `medium` and a spring's `point`) is an item path the scene's channels and drivers write,
//! evaluated by the motion module at each step's own time, inside the step (Phase). A read that
//! depends on a physics pose, through a driver reading what the world's outputs write or its
//! lists and readings, is a cycle, refused at check. #2288: an instancer a world's `<body>#*`
//! output writes takes its columns in its own frame, its world transform at t = 0; one a channel
//! moves, or an item it's parented to, is refused at check.

use std::collections::BTreeSet;

use deep_canvas_motion::doc::DriverInput;
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, TRANSFORM};
use deep_canvas_physics::backend::Targets;
use deep_canvas_physics::check::MOVED_INSTANCER;
use deep_canvas_physics::doc::{ForceKind, Refusal, World};
use serde_json::{json, Map, Value};

/// What a read sets.
enum Sets {
    Follow(String),
    Motor(String),
    Coord(String),
    Force(String),
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
    /// #2288: each instancer a `<body>#*` output writes that is moved or turned, with its world
    /// `pos` and `rot` (a quaternion) at t = 0: the frame its columns hold each body's pose in.
    pub frames: Map<String, Value>,
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
        for (f, force) in &w.forces {
            if let Some(p) = &force.channel {
                let key = match force.kind {
                    ForceKind::Drag { .. } => "medium",
                    _ => "point",
                };
                let field = format!("forces/{f}/kind/{key}");
                wanted.push((Sets::Force(f.clone()), p.clone(), field, 3));
            }
        }
        let outputs: Vec<&str> = w.outputs.values().filter_map(|o| o.to.as_deref()).collect();
        let mut out = Vec::new();
        let frames = frames(&program, w, &mut out);
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
            frames,
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
                Sets::Force(f) => {
                    t.forces.insert(f.clone(), [v[0], v[1], v[2]]);
                }
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

/// #2288: each instancer world `w`'s `<body>#*` outputs write, moved or turned at t = 0, with its
/// world `pos` and `rot`; into `out`, the refusal of each channel that moves one of them, on it or
/// on an item it's parented to, naming the instancer and the channel.
fn frames(program: &Program, w: &World, out: &mut Vec<Refusal>) -> Map<String, Value> {
    let mut state = program.state();
    program.evaluate(0, Validity::Full, &mut state);
    let mut frames = Map::new();
    for (oid, o) in &w.outputs {
        let item = o.to.as_deref().and_then(|t| t.strip_prefix("items/"));
        let (Some(_), Some(item)) = (o.from.strip_suffix("#*"), item) else {
            continue;
        };
        let mut placed = vec![item];
        while let Some((_, up)) = program
            .motion
            .parents
            .iter()
            .find(|(c, _)| placed.last() == Some(&c.as_str()))
        {
            if placed.contains(&up.as_str()) {
                break;
            }
            placed.push(up);
        }
        let moving = program.motion.channels.iter().filter(|c| {
            placed.contains(&c.target.owner.as_str())
                && c.target.field.first().is_some_and(|f| f == "at")
        });
        for c in moving {
            let path = format!("items/{}/{}", c.target.owner, c.target.field.join("/"));
            let what = format!("output {oid} writes {item}'s columns in {item}'s frame at t = 0, and channel {} moves it ({path}); a world can't write the columns of an instancer a channel moves", c.id);
            out.push(refusal(
                MOVED_INSTANCER,
                format!("outputs/{oid}/to"),
                json!(c.id),
                what,
            ));
        }
        let Some(i) = program.items.iter().position(|x| x == item) else {
            continue;
        };
        let t = &state.slots[i * TRANSFORM..i * TRANSFORM + 6];
        if t.iter().any(|x| *x != 0.0) {
            let frame = json!({"pos": t[0..3], "rot": crate::bound::quat(&t[3..6])});
            frames.insert(item.to_string(), frame);
        }
    }
    frames
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
