//! #1918: each world a scene lists baked into the form its readers read, as the app and the web
//! player both bake it (#172). A world runs inside the scene that lists it (World and backend): it
//! is baked over the transport's span on the pinned backend, each path it reads evaluated by the
//! scene's motion at each step's time; its occurrence list reaches `occurrences` only through the
//! core's column view; and each output with a `to` path becomes a channel on that path, keyed at
//! every frame from the bake, so the scene's item moves as the body does and seeking equals
//! playing.

use deep_canvas::document::Issue;
use deep_canvas::registry::Sealed;
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::doc::World;
use deep_canvas_physics::module::changed;
use deep_canvas_physics::occurrence::{step_flicks, timed};
use deep_canvas_physics::written;
use deep_physics_rapier::channels::{output_channels, states};
use deep_physics_rapier::runner::Run;
use serde_json::{json, Map, Value};

use crate::derive::Fired;

/// What the host bakes with beyond the document: the entries its canvas modules fire, their
/// order, and a planted output that writes a body's whole transform.
pub struct Host<'a> {
    pub fired: &'a dyn Fn(&Value) -> Vec<Fired>,
    pub modules_first: bool,
    pub whole_transform: bool,
}

impl Default for Host<'_> {
    fn default() -> Self {
        Host {
            fired: &|_| Vec::new(),
            modules_first: false,
            whole_transform: false,
        }
    }
}

/// World `id` of a scene the physics module refuses, as the revision's issue (#182: also the
/// app's logic readings, deep-show physics.rs).
pub fn refused(id: &str, what: Value) -> Issue {
    let msg = "the physics module refuses this world in its scene";
    Issue::error("physics_refused", id, format!("worlds/{id}"), what, msg)
}

/// A world's span: its own `span`, within the transport's.
pub fn span_of(doc: &Value, world: &Value, transport: i64) -> i64 {
    world
        .get("span")
        .and_then(|s| deep_canvas_media::doc::time(doc, Some(s)))
        .map_or(transport, |s| s.min(transport))
}

/// The steps a world of `form` bakes over: its span's, within the transport's.
pub fn steps_of(form: &Value, world: &Value, transport: i64, step: i64) -> i64 {
    (span_of(form, world, transport) + step - 1) / step
}

/// The readings `form`'s mark-set columns read of world `id` (`<id>.<ID>.<read>`), each baked
/// from the body's state after every step in the shape the core's column view folds: one vec3
/// element, held between steps, each step that changes it with the range it hands the view. A
/// reading of no body of the world is left to the view, which names it; a read this host can't
/// bake from a body's states is refused, naming #2248.
pub fn readings(
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

/// Each world `form` lists under `worlds`, baked over the transport's span in its scene: its
/// occurrence list, each row stamped with its step's time, written through the core's column
/// view into `occurrences` (`<world ID>.occurrences`), and its outputs' channels into
/// `channels`. A world or a scene the physics module refuses is the revision's issue. Each
/// world takes the entries it derives from the core's input track `track` and the entries
/// canvas modules fire (#522); a world input on a module the build lacks is `module_missing`.
pub fn inline(
    sealed: &Sealed,
    form: &mut Value,
    track: &[Value],
    host: &Host<'_>,
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
    let whole = host.whole_transform;
    for (id, doc) in &worlds {
        let w = deep_physics_rapier::bound::expand(Some(form), doc);
        let w = w.and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE));
        // #524: a skin off its soft body's lattice is the world's refusal too.
        let w = w.and_then(|w| match deep_canvas_physics::skin::check(&w, form) {
            e if e.is_empty() => Ok(w),
            e => Err(e),
        });
        let w = w.map_err(|e| {
            refused(
                id,
                json!(e
                    .iter()
                    .map(|r| json!({"code": r.code, "path": r.path, "what": r.what}))
                    .collect::<Vec<_>>()),
            )
        })?;
        let held = |m: &str| sealed.modules.iter().any(|x| x.name == m);
        if let Some(i) = crate::derive::missing(id, &w, held) {
            return Err(Box::new(i));
        }
        let kept = crate::derive::kept(&w, core, &(host.fired)(form), host.modules_first).map_err(
            |r| {
                refused(
                    id,
                    json!([{"code": r.code, "path": r.path, "what": r.what}]),
                )
            },
        )?;
        let step = step_flicks(&w);
        // #525: over its own span; its inputs the ones the core input track derives (#522).
        let steps = steps_of(form, doc, span, step);
        let call = json!({"call": "bake", "scene": form, "world": id, "steps": steps, "frame_rate": rate,
                          "track": crate::derive::track_of(&kept)});
        let reply = run.answer(&call).unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return Err(Box::new(refused(id, reply)));
        }
        let rows = reply["occurrences"].as_array().cloned().unwrap_or_default();
        lists.insert(format!("{id}.occurrences"), json!(timed(&rows, &w)));
        output_channels(id, &w, &states(&reply), &frames, whole, &mut channels)
            .map_err(|e| refused(id, e))?;
        arrays.extend(readings(form, id, &w, &reply["bodies"]).map_err(|e| refused(id, e))?);
        arrays.extend(written::arrays(id, &w, form, &reply["bodies"]));
        arrays.extend(deep_canvas_physics::skin::arrays(
            id,
            &w,
            &reply["particles"],
        ));
    }
    let entries = sealed.registry(deep_canvas::columns::REGISTRY);
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
