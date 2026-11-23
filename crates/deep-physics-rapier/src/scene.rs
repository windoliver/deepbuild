//! #1918: a world inside the scene that lists it (World and backend: "its outputs' item paths and
//! its bodies' follow channels resolve in that scene"). Each path physics reads (a kinematic
//! body's `follow`, a motor's `target`, a kinematic solve's driver, and with #2371 a drag's
//! `medium` and a spring's `point`) is an item path the scene's channels and drivers write,
//! evaluated by the motion module at each step's own time, inside the step (Phase). A read that
//! depends on a physics pose, through a driver reading what the world's outputs write or its
//! lists and readings, is a cycle, refused at check. #2288: an instancer a world's `<body>#*`
//! output writes takes its columns in its own frame, its world transform at t = 0; one that motion
//! moves (it or an item it's parented to), or one that is scattered, is refused at check.

use std::collections::BTreeSet;

use deep_canvas_motion::doc::{DriverInput, Kind, Target};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::{Program, TRANSFORM};
use deep_canvas_physics::backend::Targets;
use deep_canvas_physics::check::{MOVED_INSTANCER, SCATTERED_INSTANCER};
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
        let frames = frames(&program, w, scene, &mut out);
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

/// #2288: each entry of `program` that moves the transform of an item in `placed` (an instancer and
/// the items it's parented to), by scene3d's rule for what moves an item: a channel, a follow or a
/// driver on its `at`, a placement whose clip moves the slot it binds, a stagger that takes it
/// apart, or a constraint on it other than a rest solved at check; with its kind and what it moves.
fn movers(program: &Program, placed: &[&str]) -> Vec<(&'static str, String, String)> {
    let m = &program.motion;
    let on = |t: &Target| {
        placed.contains(&t.owner.as_str()) && t.field.first().is_some_and(|f| f == "at")
    };
    let path = |t: &Target| format!("items/{}/{}", t.owner, t.field.join("/"));
    let mut out: Vec<(&'static str, String, String)> = Vec::new();
    out.extend(
        m.channels
            .iter()
            .filter(|c| on(&c.target))
            .map(|c| ("channel", c.id.clone(), path(&c.target))),
    );
    out.extend(
        m.follows
            .iter()
            .filter(|f| on(&f.target))
            .map(|f| ("follow", f.id.clone(), path(&f.target))),
    );
    out.extend(
        m.drivers
            .iter()
            .filter(|d| on(&d.target))
            .map(|d| ("driver", d.id.clone(), path(&d.target))),
    );
    for p in &m.placements {
        let clip = m.clips.iter().find(|c| c.id == p.clip);
        for b in p
            .bindings
            .iter()
            .filter(|b| placed.contains(&b.item.as_str()))
        {
            let moves = clip.into_iter().flat_map(|c| &c.channels).any(|c| {
                c.target.owner == b.slot && c.target.field.first().is_some_and(|f| f == "at")
            });
            if moves {
                out.push(("placement", p.id.clone(), format!("items/{}/at", b.item)));
            }
        }
    }
    for s in &m.staggers {
        for (t, _) in s
            .targets
            .iter()
            .filter(|(t, _)| placed.contains(&t.as_str()))
        {
            out.push(("stagger", s.id.clone(), format!("items/{t}/at")));
        }
    }
    let solved = |k: &Kind| matches!(k, Kind::RestOn { on: Some(_), .. });
    for c in m
        .constraints
        .iter()
        .filter(|c| placed.contains(&c.owner.as_str()) && !solved(&c.kind))
    {
        out.push(("constraint", c.id.clone(), format!("items/{}/at", c.owner)));
    }
    out
}

/// #2288: each instancer world `w`'s `<body>#*` outputs write in `scene`, moved or turned at t = 0,
/// with its world `pos` and `rot`; into `out`, the refusal of each entry that moves one of them (on
/// it or on an item it's parented to, naming the instancer and the entry), and of an output whose
/// instancer is scattered, which takes its rows from its scatter and never from written columns.
fn frames(
    program: &Program,
    w: &World,
    scene: &Map<String, Value>,
    out: &mut Vec<Refusal>,
) -> Map<String, Value> {
    let mut state = program.state();
    program.evaluate(0, Validity::Full, &mut state);
    let mut frames = Map::new();
    for (oid, o) in &w.outputs {
        let item = o.to.as_deref().and_then(|t| t.strip_prefix("items/"));
        let (Some(_), Some(item)) = (o.from.strip_suffix("#*"), item) else {
            continue;
        };
        let from = scene
            .get("items")
            .and_then(|i| i.get(item)?.pointer("/params/from"));
        if from.is_some_and(|f| !f.is_null()) {
            let what = format!("output {oid} writes {item}'s columns, and {item} is scattered (from: distribute(…)): an instancer takes its rows from its scatter or from written columns, never both");
            out.push(refusal(
                SCATTERED_INSTANCER,
                format!("outputs/{oid}/to"),
                json!(item),
                what,
            ));
            continue;
        }
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
        for (kind, entry, path) in movers(program, &placed) {
            let what = format!("output {oid} writes {item}'s columns in {item}'s frame at t = 0, and {kind} {entry} moves it ({path}); a world can't write the columns of an instancer that moves");
            out.push(refusal(
                MOVED_INSTANCER,
                format!("outputs/{oid}/to"),
                json!(entry),
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

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    /// A world in a 3D scene whose `tile#*` output writes the columns of `tiles` (two elements, or
    /// a scatter over the plate `slab`), with `extra` merged into the scene.
    fn check(tiles: Value, extra: Value) -> Vec<Value> {
        let world = json!({
            "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4, "gravity": [0, -9.81, 0],
            "seed": 2288, "mode": "dynamic", "capacity": {"bodies": 8, "shapes": 8, "joints": 0, "contacts": 32, "particles": 0},
            "backend": {"name": "rapier3d", "version": "=0.36.1"},
            "contact_materials": {"m": {"friction": 0.5, "restitution": 0, "density": 500}},
            "shapes": {"chip": {"kind": "box", "half": [0.15, 0.15, 0.15]}},
            "bodies": {"tile": {"kind": "dynamic", "each": "tiles", "shapes": [{"shape": "chip", "contact_material": "m"}]}},
            "outputs": {"written": {"from": "tile#*", "read": "pose", "to": "items/tiles"}}});
        let item = |id: &str, v: Value| {
            let mut v = v;
            v["id"] = json!(id);
            v["name"] = json!(id);
            v["order"] = json!(format!("a{id}"));
            v
        };
        let mut scene = json!({"format": 1, "profile": "scene", "title": "t", "size": [64, 36],
            "transport": {"span": "1s", "frame_rate": [60, 1]}, "requires": {"modules": {"scene3d": "^1"}},
            "items": {"chip": item("chip", json!({"kind": "mark.box@1", "params": {"size": [0.3, 0.3, 0.3]}, "visible": false})),
                      "rig": item("rig", json!({"kind": "group@1", "params": {}})),
                      "slab": item("slab", json!({"kind": "plate@1", "params": {"grid": [1, 1], "size": [4, 4]}, "at": {"pos": [0, 2, 0]}})),
                      "tiles": item("tiles", tiles)},
            "worlds": {"lab": world}});
        for (k, v) in extra.as_object().into_iter().flatten() {
            scene[k] = v.clone();
        }
        let run = crate::runner::Run::new(None).expect("the unplanted runner");
        let reply = run
            .answer(&json!({"call": "check", "scene": scene, "world": "lab"}))
            .expect("a reply");
        let issues = reply["issues"].as_array().cloned().unwrap_or_default();
        issues
            .into_iter()
            .filter(|i| i["severity"] == "error")
            .collect()
    }

    /// #2288: an instancer a world's `<body>#*` output writes is refused at check when anything
    /// moves it, not only a channel on its own `at`: a driver on it, or a channel on the item it's
    /// parented to, each named; one that nothing moves checks; and a scattered instancer can't
    /// take written columns, so an output into one is refused, naming it.
    #[test]
    fn written_instancers_that_move_or_scatter_are_refused() {
        let rows = json!({"kind": "instance@1", "at": {"pos": [5, 0, 0], "rot": [0, 90, 0]},
            "params": {"of": ["chip"], "ids": [0, 1], "pos": [[0, 1, 0], [1, 1, 0]]}});
        assert_eq!(
            check(rows.clone(), json!({})),
            Vec::<Value>::new(),
            "a still, turned instancer checks"
        );
        let driver = json!({"drivers": {"sway": {"target": "items/tiles/at/pos/0", "expr": "t * 0.5", "vars": {"t": "time"}}}});
        let parented = {
            let mut r = rows.clone();
            r["parent"] = json!("rig");
            r
        };
        let lift = json!({"channels": {"lift": {"target": "items/rig/at/pos", "type": "vec3",
            "keys": {"k0": {"t": "0s", "value": [0, 0, 0], "interp": "linear"}, "k1": {"t": "1s", "value": [0, 1, 0], "interp": "linear"}}}}});
        let scattered = json!({"kind": "instance@1", "params": {"of": ["chip"],
            "from": {"distribute": {"on": "slab", "mode": "poisson", "min_distance": 1, "seed": 2288, "max": 4}}}});
        let mut missing = Vec::new();
        for (what, tiles, extra, code, entry) in [
            (
                "a driver on its at",
                rows,
                driver,
                "physics.moved_instancer",
                "sway",
            ),
            (
                "a channel on its parent",
                parented,
                lift,
                "physics.moved_instancer",
                "lift",
            ),
            (
                "its scatter",
                scattered,
                json!({}),
                "physics.scattered_instancer",
                "tiles",
            ),
        ] {
            let errors = check(tiles, extra);
            let named = errors.iter().any(|e| {
                e["code"] == code
                    && e["path"] == "outputs/written/to"
                    && e["actual"] == entry
                    && e["what"]
                        .as_str()
                        .is_some_and(|w| w.contains("tiles") && w.contains(entry))
            });
            if !named {
                missing.push(format!(
                    "{what}: {code} naming tiles and {entry}; got {errors:?}"
                ));
            }
        }
        assert!(missing.is_empty(), "{missing:#?}");
    }
}
