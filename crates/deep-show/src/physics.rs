//! #1918: the physics module in the full build set, and each world a scene lists baked into the
//! form its readers read. A world runs inside the scene that lists it (World and backend): it is
//! baked over the transport's span on the pinned backend, each path it reads evaluated by the
//! scene's motion at each step's time; its occurrence list reaches `occurrences` only through the
//! core's column view, so a driver or a spawn reads `<world ID>.occurrences` by its form; and each
//! output with a `to` path becomes a channel on that path, keyed at every frame from the bake, so
//! the scene's item moves as the body does and seeking equals playing.

use deep_canvas::document::Issue;
use deep_canvas::registry::Module;
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::doc::{Read, World};
use deep_canvas_physics::module::changed;
use deep_canvas_physics::occurrence::{step_flicks, timed};
use deep_canvas_physics::written;
use deep_physics_rapier::runner::Run;
use serde_json::{json, Map, Value};

use crate::hub::Hub;

mod derive;
mod kit;
pub(crate) use derive::{parse, Bake};

/// The physics module the full set seals, on the Rapier backend this build links, its pins as
/// cargo resolved them (#1920); `test-physics-hands-no-changes` seals #1918's planted one, whose
/// readings entry hands the column view no changed ranges; `test-physics-rapier-patch` the same
/// module with rapier3d's pin moved one patch and nothing else changed; #1919's
/// `test-leave-out-physics` seals none. The shipped module also carries its stepper and kit
/// fixture (#522, physics/kit.rs); `test-physics-needs-logic` seals one whose manifest declares
/// logic among its required dependencies, which a build without logic refuses at its seal.
pub(crate) fn module() -> Option<Module> {
    let mut build = deep_physics_rapier::build();
    if cfg!(feature = "test-physics-rapier-patch") {
        build.backend.version = "0.36.2".into();
    }
    if cfg!(feature = "test-leave-out-physics") {
        None
    } else if cfg!(feature = "test-physics-hands-no-changes") {
        Some(deep_canvas_physics::module::hands_no_changes(&build))
    } else {
        let mut m = deep_canvas_physics::module::module(&build);
        m.register = |r| {
            (deep_canvas_physics::module::module(&deep_physics_rapier::build()).register)(r);
            kit::register(r);
        };
        if cfg!(feature = "test-physics-needs-logic") {
            let range = deep_canvas::registry::Range::parse("^1").expect("a range");
            let logic = deep_canvas::registry::Dependency {
                range,
                optional: false,
            };
            m.manifest.depends_on.insert("logic".into(), logic);
        }
        Some(m)
    }
}

/// The motion module; `test-motion-reads-physics-array` seals #1918's planted one, the shipped
/// module with one more operator that reads the physics module's occurrence list by its array
/// name instead of by its form through the column view. Motion declares no dependency on physics,
/// so the seal refuses the read, naming both modules and the array.
pub(crate) fn motion() -> Module {
    let mut m = deep_canvas_motion::module::module();
    if cfg!(feature = "test-motion-reads-physics-array") {
        m.register = |r| {
            (deep_canvas_motion::module::module().register)(r);
            r.array("motion.hits", "count", "item", "time", "items");
            r.operator("hits", "items", &["physics.occurrences"], &["motion.hits"])
                .run(|_| Ok(()));
        };
    }
    m
}

/// #1921's wrong programs for a world's outputs, by the names its acceptance suite gives them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// An output to an item's `at` writes the body's whole transform: its position, its rotation
    /// and a scale of 1, so the item's own scale is reset.
    WholeTransform,
    /// A `<body>#*` output writes, at each frame, the columns of the frame its session drew before.
    PreviousColumns,
}

pub(crate) fn planted(name: &str) -> Option<crate::hub::Planted> {
    Some(crate::hub::Planted::Physics(match name {
        "output_writes_whole_transform" => Planted::WholeTransform,
        "output_keeps_previous_columns" => Planted::PreviousColumns,
        _ => return None,
    }))
}

fn refused(id: &str, what: Value) -> Issue {
    let msg = "the physics module refuses this world in its scene";
    Issue::error("physics_refused", id, format!("worlds/{id}"), what, msg)
}

/// A body's state after a step: its position and rotation `[x, y, z, w]`.
fn pose_of(s: &Value) -> Option<([f64; 3], [f64; 4])> {
    let v = |k: &str, n: usize| -> Option<Vec<f64>> {
        let a = s.get(k)?.as_array()?;
        (a.len() == n).then(|| a.iter().filter_map(Value::as_f64).collect())
    };
    let (p, r) = (v("pos", 3)?, v("rot", 4)?);
    Some(([p[0], p[1], p[2]], [r[0], r[1], r[2], r[3]]))
}

/// A rotation as the canvas writes it: degrees about X, then Y, then Z, in fixed axes
/// (R = Rz·Ry·Rx, Units and conventions).
fn euler(q: [f64; 4]) -> [f64; 3] {
    let [x, y, z, w] = q;
    let rx = (2.0 * (w * x + y * z)).atan2(1.0 - 2.0 * (x * x + y * y));
    let ry = (2.0 * (w * y - z * x)).clamp(-1.0, 1.0).asin();
    let rz = (2.0 * (w * z + x * y)).atan2(1.0 - 2.0 * (y * y + z * z));
    [rx, ry, rz].map(f64::to_degrees)
}

/// A body's pose at `t` flicks from its states after each step (`step` flicks apart): the two
/// steps around it mixed by α, positions lerped and rotations nlerped (Physics output), or the
/// earlier step's with `hold`.
fn pose_at(states: &[Value], t: i64, step: i64, hold: bool) -> Option<([f64; 3], [f64; 4])> {
    let (k, rem) = ((t / step) as usize, t % step);
    let a = pose_of(states.get(k)?)?;
    if rem == 0 || hold {
        return Some(a);
    }
    let Some(b) = states.get(k + 1).and_then(pose_of) else {
        return Some(a);
    };
    let alpha = rem as f64 / step as f64;
    let pos = [0, 1, 2].map(|i| a.0[i] + alpha * (b.0[i] - a.0[i]));
    let dot: f64 = (0..4).map(|i| a.1[i] * b.1[i]).sum();
    let sign = if dot < 0.0 { -1.0 } else { 1.0 };
    let q = [0, 1, 2, 3].map(|i| a.1[i] + alpha * (sign * b.1[i] - a.1[i]));
    let n = q.iter().map(|x| x * x).sum::<f64>().sqrt();
    Some((pos, q.map(|x| x / n)))
}

/// A channel keyed at each of `values`' frames, linear between them.
fn keyed(target: String, values: Vec<[f64; 3]>) -> Value {
    let keys: Map<String, Value> = values
        .into_iter()
        .enumerate()
        .map(|(f, v)| {
            (
                format!("f{f}"),
                json!({"t": format!("{f}f"), "value": v, "interp": "linear"}),
            )
        })
        .collect();
    json!({"target": target, "type": "vec3", "keys": keys})
}

/// The channels a world's outputs write in its scene, each `to` an item's `at` (a pose: its
/// position and rotation, never its scale) or a vec3 field (a position), keyed at every frame of
/// the span; a `<body>#*` output writes an instancer's columns instead (#1921: written.rs).
/// `whole`: #1921's planted output, which writes a scale of 1 with the pose.
fn output_channels(
    id: &str,
    w: &World,
    bodies: &Value,
    frames: &[i64],
    whole: bool,
    out: &mut Map<String, Value>,
) -> Result<(), Value> {
    let step = step_flicks(w);
    for (oid, o) in w.outputs.iter().filter(|(_, o)| !o.from.ends_with("#*")) {
        let Some(to) = &o.to else { continue };
        let states = bodies[&o.from].as_array().cloned().unwrap_or_default();
        let poses: Vec<_> = frames
            .iter()
            .filter_map(|t| pose_at(&states, *t, step, o.hold))
            .collect();
        let name = |part: &str| format!("physics-{id}-{oid}-{part}");
        match (o.read, to.strip_suffix("/at")) {
            (Read::Pose, Some(item)) => {
                out.insert(
                    name("pos"),
                    keyed(
                        format!("{item}/at/pos"),
                        poses.iter().map(|p| p.0).collect(),
                    ),
                );
                out.insert(
                    name("rot"),
                    keyed(
                        format!("{item}/at/rot"),
                        poses.iter().map(|p| euler(p.1)).collect(),
                    ),
                );
                if whole {
                    let ones = vec![[1.0; 3]; poses.len()];
                    out.insert(name("scale"), keyed(format!("{item}/at/scale"), ones));
                }
            }
            (Read::Pose | Read::Position, _) => {
                let to = to
                    .strip_suffix("/at")
                    .map_or(to.clone(), |i| format!("{i}/at/pos"));
                out.insert(name("pos"), keyed(to, poses.iter().map(|p| p.0).collect()));
            }
            (r, _) => {
                let what = format!(
                    "an output's to with read {} isn't drawn by this host yet; #2248 brings it",
                    r.name()
                );
                return Err(
                    json!({"code": "physics.unsupported", "path": format!("outputs/{oid}/to"), "what": what}),
                );
            }
        }
    }
    Ok(())
}

/// The readings `form`'s mark-set columns read of world `id` (`<id>.<ID>.<read>`), each baked
/// from the body's state after every step in the shape the core's column view folds: one vec3
/// element, held between steps, each step that changes it with the range it hands the view. A
/// reading of no body of the world is left to the view, which names it; a read this host can't
/// bake from a body's states is refused, naming #2248.
fn readings(
    form: &Value,
    id: &str,
    w: &World,
    bodies: &Value,
) -> Result<Map<String, Value>, Value> {
    let mut named = std::collections::BTreeSet::new();
    for p in form["items"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(_, i)| &i["params"])
    {
        let columns = p["columns"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(_, c)| &c["array"]);
        for a in columns
            .chain([&p["alive"]["array"]])
            .filter_map(Value::as_str)
        {
            if a.strip_prefix(id).is_some_and(|r| r.starts_with('.')) {
                named.insert(a.to_string());
            }
        }
    }
    let mut out = Map::new();
    for name in named {
        let Some((body, read)) = name[id.len() + 1..].rsplit_once('.') else {
            continue;
        };
        if !w.bodies.contains_key(body) {
            continue;
        }
        let field = match read {
            "position" => "pos",
            "velocity" => "linear",
            _ => {
                let what = format!(
                    "the reading {read} isn't baked for a column by this host yet; #2248 brings it"
                );
                return Err(json!({"code": "physics.unsupported", "path": name, "what": what}));
            }
        };
        let (mut prev, mut steps) = (Vec::new(), Vec::new());
        for (k, state) in bodies[body].as_array().into_iter().flatten().enumerate() {
            let now = vec![state[field].clone()];
            let ranges = changed(&prev, &now);
            if !ranges.is_empty() {
                steps.push(json!({"step": k, "changed": ranges, "values": [[0, now]]}));
            }
            prev = now;
        }
        let baked = json!({"type": "vec3", "count": 1, "every": step_flicks(w), "linear": false, "steps": steps});
        out.insert(name, baked);
    }
    Ok(out)
}

/// A world a scene lists, its reading and each body's pose at a time.
pub(crate) type Posed = (String, World, Vec<(String, ([f64; 3], [f64; 4]))>);

/// #1919: each world `form` lists, baked in its scene up to `t` flicks, with each body's pose at
/// `t` by Physics output's rule, so the physics shapes mode draws the frame the physics module
/// evaluates; or what refuses a world, naming it.
pub(crate) fn poses_at(form: &Value, t: i64) -> Result<Vec<Posed>, Value> {
    let run = Run::new(None).expect("the unplanted runner");
    let mut out = Vec::new();
    for (id, doc) in form
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let refuse = |what: Value| json!({"code": "physics_refused", "world": id, "what": what});
        let w = check(doc, &RAPIER3D, &deep_canvas_physics::roles::TABLE)
            .map_err(|e| refuse(json!(e.iter().map(|r| &r.what).collect::<Vec<_>>())))?;
        let step = step_flicks(&w);
        let call =
            json!({"call": "bake", "scene": form, "world": id, "steps": t.max(0) / step + 1});
        let reply = run.answer(&call).unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return Err(refuse(reply));
        }
        let poses = w
            .bodies
            .keys()
            .filter_map(|b| {
                let states = reply["bodies"][b].as_array()?;
                Some((b.clone(), pose_at(states, t.max(0), step, false)?))
            })
            .collect();
        out.push((id.clone(), w, poses));
    }
    Ok(out)
}

impl Hub<'_> {
    /// Each world `form` lists under `worlds`, baked over the transport's span in its scene: its
    /// occurrence list, each row stamped with its step's time, written through the core's column
    /// view into `occurrences` (`<world ID>.occurrences`), and its outputs' channels into
    /// `channels`. A world or a scene the physics module refuses is the revision's issue. Each
    /// world takes the entries it derives from the core's input track `track` and the entries
    /// canvas modules fire (#522); a world input on a module the build lacks is `module_missing`.
    pub(crate) fn inline_worlds(
        &self,
        form: &mut Value,
        track: &[Value],
    ) -> Result<(), Box<Issue>> {
        let Some(worlds) = form.get("worlds").and_then(Value::as_object).cloned() else {
            return Ok(());
        };
        let span = deep_canvas_media::doc::time(form, form.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        let rate = form
            .pointer("/transport/frame_rate")
            .cloned()
            .unwrap_or(json!([60, 1]));
        let Ok((_, frame)) = deep_canvas_physics::bake::frame_rate(&rate) else {
            return Ok(());
        };
        let frames: Vec<i64> = (0..)
            .map(|f: i64| f * frame)
            .take_while(|t| *t <= span)
            .collect();
        let run = Run::new(None).expect("the unplanted runner");
        // The core input track: the caller's, else the one the form carries (#525: a document's
        // recorded track, or the one a mixdown's replay sets).
        let own: Vec<Value> = form
            .get("track")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let core = if track.is_empty() { &own[..] } else { track };
        let (mut lists, mut channels, mut arrays) = (Map::new(), Map::new(), Map::new());
        let whole = self.planted(crate::hub::Planted::Physics(Planted::WholeTransform));
        for (id, doc) in &worlds {
            let w = deep_physics_rapier::bound::expand(Some(form), doc);
            let w = w.and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE));
            let w = w.map_err(|e| {
                refused(
                    id,
                    json!(e
                        .iter()
                        .map(|r| json!({"code": r.code, "path": r.path, "what": r.what}))
                        .collect::<Vec<_>>()),
                )
            })?;
            let held = |m: &str| self.startup.sealed.modules.iter().any(|x| x.name == m);
            if let Some(i) = derive::missing(id, &w, held) {
                return Err(Box::new(i));
            }
            let kept = derive::kept(form, &w, core).map_err(|r| {
                refused(
                    id,
                    json!([{"code": r.code, "path": r.path, "what": r.what}]),
                )
            })?;
            let step = step_flicks(&w);
            // #525: over its own span; its inputs the ones the core input track derives (#522).
            let steps = crate::stepped::steps_of(form, doc, span, step);
            let call = json!({"call": "bake", "scene": form, "world": id, "steps": steps, "frame_rate": rate,
                              "track": derive::track_of(&kept)});
            let reply = run.answer(&call).unwrap_or(Value::Null);
            if reply["ok"] != json!(true) {
                return Err(Box::new(refused(id, reply)));
            }
            let rows = reply["occurrences"].as_array().cloned().unwrap_or_default();
            lists.insert(format!("{id}.occurrences"), json!(timed(&rows, &w)));
            output_channels(id, &w, &reply["bodies"], &frames, whole, &mut channels)
                .map_err(|e| refused(id, e))?;
            arrays.extend(readings(form, id, &w, &reply["bodies"]).map_err(|e| refused(id, e))?);
            arrays.extend(written::arrays(id, &w, form, &reply["bodies"]));
        }
        let entries = self.startup.sealed.registry(deep_canvas::columns::REGISTRY);
        let entries = entries.map_or(&[][..], |r| r.entries.as_slice());
        if let Some(i) = deep_canvas::columns::lists(form, entries, lists)
            .into_iter()
            .next()
        {
            return Err(Box::new(i));
        }
        if let Some(doc) = form.as_object_mut() {
            for (key, add) in [("channels", channels), ("arrays", arrays)] {
                if let Some(all) = doc.entry(key).or_insert_with(|| json!({})).as_object_mut() {
                    all.extend(add);
                }
            }
        }
        Ok(())
    }

    /// `physics_bake` (#522): the bake of world `b.world` of the document `b.doc` presents, over
    /// its transport's span in its scene, on the core's input track `b.track` with every entry a
    /// canvas module fires: its key, steps, step hashes and the entries it keeps.
    pub(crate) fn physics_bake(&self, b: &Bake) -> Value {
        self.physics_bake_read(b, false)
    }

    /// The bake `physics_bake` answers; with `bodies`, also every body's state after each step
    /// and the occurrences (#540's `world`).
    pub(crate) fn physics_bake_read(&self, b: &Bake, bodies: bool) -> Value {
        let Some(doc) = self
            .sessions
            .get(&b.doc)
            .and_then(|s| s.document().cloned())
        else {
            return json!({"ok": false, "code": "no_revision"});
        };
        let Some(world) = doc.pointer(&format!("/worlds/{}", b.world)) else {
            return json!({"ok": false, "code": "ref_unresolved", "path": format!("worlds/{}", b.world)});
        };
        let span = deep_canvas_media::doc::time(&doc, doc.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        let rate = doc
            .pointer("/transport/frame_rate")
            .cloned()
            .unwrap_or(json!([60, 1]));
        let w = deep_physics_rapier::bound::expand(Some(&doc), world)
            .and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE));
        let w = match w {
            Ok(w) => w,
            Err(e) => {
                return json!({"ok": false, "issues": e.iter().map(|r| json!({"code": r.code, "path": r.path, "what": r.what})).collect::<Vec<_>>()})
            }
        };
        let held = |m: &str| self.startup.sealed.modules.iter().any(|x| x.name == m);
        if let Some(i) = derive::missing(&b.world, &w, held) {
            return json!({"ok": false, "issues": [i.to_json()]});
        }
        let own: Vec<Value> = doc
            .get("track")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let core = if b.track.is_empty() {
            &own[..]
        } else {
            &b.track[..]
        };
        let kept = match derive::kept(&doc, &w, core) {
            Ok(k) => k,
            Err(r) => return json!({"ok": false, "code": r.code, "path": r.path, "what": r.what}),
        };
        let steps = crate::stepped::steps_of(&doc, world, span, step_flicks(&w));
        let mut call = json!({"call": "bake", "scene": doc, "world": b.world, "steps": steps, "frame_rate": rate,
                          "track": derive::track_of(&kept), "read": []});
        if bodies {
            call.as_object_mut().map(|c| c.remove("read"));
        }
        let reply = Run::new(None)
            .expect("the unplanted runner")
            .answer(&call)
            .unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return reply;
        }
        let mut out = json!({"ok": true, "key": reply["key"], "steps": steps, "step_hashes": reply["step_hashes"], "inputs": kept});
        if bodies {
            out["bodies"] = reply["bodies"].clone();
            out["occurrences"] = reply["occurrences"].clone();
        }
        out
    }

    /// #2293: `document` with the channels of the form `doc`'s session loads, which hold each
    /// output its worlds write to an item path ([`Hub::inline_worlds`] is the only thing that adds
    /// any): what a 3D frame or a 3D mode draws, so each item stands where the session's frame at
    /// the same time puts it, as `eval` reads it.
    pub(crate) fn with_outputs(&self, doc: &str, document: &Value) -> Value {
        let mut out = document.clone();
        let channels = self.forms.get(doc).and_then(|f| f.get("channels"));
        if let (Some(channels), Some(map)) = (channels, out.as_object_mut()) {
            map.insert("channels".into(), channels.clone());
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A reading a mark-set column names reads, through the core's column view, the body's state
    /// after each step at that step's time, and holds it between steps.
    #[test]
    fn a_reading_reads_the_body_after_each_step_through_the_column_view() {
        let world = json!({"kind": "physics.world@1", "capacity": {"bodies": 1, "shapes": 1, "joints": 0, "contacts": 0, "particles": 0},
            "shapes": {"ball": {"kind": "sphere", "radius": 0.1}}, "contact_materials": {"m": {"density": 100}},
            "bodies": {"ball": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}]}}});
        let w =
            check(&world, &RAPIER3D, &deep_canvas_physics::roles::TABLE).expect("the world checks");
        let state = |y: f64| json!({"pos": [0.0, y, 0.0], "linear": [0.0, 0.0, 0.0]});
        let bodies = json!({"ball": [state(1.0), state(0.9), state(0.9), state(0.7)]});
        let column = json!({"array": "lab.ball.position", "as": "f64", "part": "y"});
        let form = json!({"worlds": {"lab": world}, "items": {"set": {"params": {"columns": {"y": column}}}}});
        let baked = readings(&form, "lab", &w, &bodies).expect("the reading bakes");
        let mut read = column.clone();
        for (k, v) in baked["lab.ball.position"].as_object().into_iter().flatten() {
            read[k] = v.clone();
        }
        let step = step_flicks(&w);
        let at = |t: i64| deep_canvas::columns::map(&read, t, None, false).map(|m| m.values);
        for (k, y) in [(0, 1.0), (1, 0.9), (2, 0.9), (3, 0.7)] {
            assert_eq!(at(k * step), Some(vec![y]), "step {k}");
        }
        assert_eq!(
            at(2 * step + step / 2),
            Some(vec![0.9]),
            "held between steps 2 and 3"
        );
        let mut other = form.clone();
        other["items"]["set"]["params"]["columns"]["y"]["array"] = json!("lab.ball.energy");
        assert!(
            readings(&other, "lab", &w, &bodies).is_err(),
            "energy is refused, naming #2248"
        );
    }
}
