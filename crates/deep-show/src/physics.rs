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
use deep_canvas_physics::doc::World;
use deep_canvas_physics::occurrence::step_flicks;
use deep_physics_rapier::channels::pose_at;
use deep_physics_rapier::runner::Run;
use serde_json::{json, Value};

use crate::hub::Hub;

pub(crate) mod cast;
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
            cast::register(r);
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
    /// #213: physics.cast@1 answers from each world after its next step.
    CastAnswersLate,
    /// #213: the logic module writes services' results after the checkpoint that follows a step.
    ResultsAfterCheckpoint,
}

pub(crate) fn planted(name: &str) -> Option<crate::hub::Planted> {
    Some(crate::hub::Planted::Physics(match name {
        "output_writes_whole_transform" => Planted::WholeTransform,
        "output_keeps_previous_columns" => Planted::PreviousColumns,
        "cast_answers_after_next_step" => Planted::CastAnswersLate,
        "results_after_checkpoint" => Planted::ResultsAfterCheckpoint,
        _ => return None,
    }))
}

#[cfg(test)]
use deep_play::worlds::readings;

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
    /// Each world `form` lists under `worlds`, baked over the transport's span in its scene, as
    /// [`deep_play::worlds::inline`] bakes it, with this build's fired entries and plants.
    pub(crate) fn inline_worlds(
        &self,
        form: &mut Value,
        track: &[Value],
    ) -> Result<(), Box<Issue>> {
        let host = deep_play::worlds::Host {
            fired: &derive::fired,
            modules_first: derive::MODULES_FIRST,
            whole_transform: self.planted(crate::hub::Planted::Physics(Planted::WholeTransform)),
        };
        deep_play::worlds::inline(&self.startup.sealed, form, track, &host)
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
        let form = self.forms.get(doc);
        let channels = form.and_then(|f| f.get("channels"));
        if let (Some(channels), Some(map)) = (channels, out.as_object_mut()) {
            map.insert("channels".into(), channels.clone());
        }
        // #524: and the arrays its skins draw from, which the frame writes at its own time.
        let skins = form.filter(|f| deep_canvas_physics::skin::writes(f));
        if let (Some(arrays), Some(map)) =
            (skins.and_then(|f| f.get("arrays")), out.as_object_mut())
        {
            map.insert("arrays".into(), arrays.clone());
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
