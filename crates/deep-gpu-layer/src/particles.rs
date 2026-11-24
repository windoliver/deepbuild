//! #449: particles@1 items that use a closed-form field, as the `particles` call reads them and
//! `view3d` draws them (deep_effects_render::particles), with the planted programs.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::particles::draws::Ribbon;
use deep_canvas_effects::particles::eval::{self, Baked};
use deep_canvas_effects::particles::pack;
use deep_canvas_effects::particles::{
    self as closed, bounds, rule, spec::Refusal, Planted as Plants,
};
use deep_canvas_scene3d::label::Labels;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Other, Scene};
use deep_effects_render::frame::Settings;
use deep_effects_render::particles::{self as shared, baked, flat, follow_effects, Held, Host};
use deep_gpu::device::Backend;
use serde_json::{json, Map, Value};

use crate::effects::{item_pos, item_seed, Seeding};
use crate::view3d::write_named;
use crate::{refused, App, Planted};

/// Flicks a second (Units and axes: time).
const FLICKS: f64 = 705_600_000.0;

/// The scene of `doc` at `t` as the view draws it (deep_canvas_scene3d's `evaluate_sourced`),
/// its plumes' and airflows' particles following their effects' params at `t`.
pub(crate) fn evaluate_sourced(
    doc: &Value,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: deep_canvas_scene3d::scene::Assets<'_>,
    outlines: deep_canvas_scene3d::scene::Outlines<'_>,
) -> Result<Scene, Value> {
    let mut scene =
        deep_canvas_scene3d::scene::evaluate_sourced(doc, t, look, labels, assets, outlines)
            .map_err(|r| crate::touches::refusal(refused(r.code, r.path), outlines.memo))?;
    follow_effects(&mut scene, doc)?;
    Ok(scene)
}

/// The particle path's plants under `--planted`: the CPU and table switches, the kernel's flag
/// word, and a cap the check applies to every class.
pub(crate) fn plants(p: Option<Planted>) -> (Plants, u32, Option<u32>) {
    let mut out = Plants::default();
    let (mut flags, mut every) = (0, None);
    match p {
        Some(Planted::CountCap65536EveryClass) => every = Some(closed::spec::MAX_COUNT),
        Some(Planted::CountCap1048576EveryClass) => every = Some(closed::spec::MAX_COUNT_SHOWPIECE),
        Some(Planted::BounceFirstTwoPlanes) => out.two_planes = true,
        Some(Planted::LandFloorPlaneOnly) => out.floor_plane = true,
        Some(Planted::DragFirstOrder) => flags |= pack::FIRST_ORDER_DRAG,
        Some(Planted::DragEuler120) => out.euler_drag = true,
        Some(Planted::TurbulenceTableZeros) => out.zero_table = true,
        Some(Planted::BoundsEmitRegionOnly) => out.emit_bounds = true,
        Some(Planted::HidesAtSpanEnd) => out.hides_at_span_end = true,
        Some(Planted::SurfaceTrianglesUniform) => out.uniform_triangles = true,
        Some(Planted::SurfaceBindPose) => out.bind_pose = true,
        Some(Planted::InheritPreviousFrame) => out.inherit_previous_frame = true,
        Some(Planted::BoundsBindPose) => out.bounds_bind_pose = true,
        _ => {}
    }
    (out, flags, every)
}

/// The check's issues as the reply holds them.
pub(crate) fn issues_json(issues: &[deep_canvas::document::Issue]) -> Vec<Value> {
    issues
        .iter()
        .map(|i| {
            json!({"code": i.code, "severity": i.severity, "ids": i.ids, "path": i.path,
                   "actual": i.actual, "what": i.what, "fix": i.fix})
        })
        .collect()
}

/// The document's particles@1 items' bakes, checked: the core check's rules over the document,
/// then each item baked; the first error's issues refuse it.
pub(crate) fn checked(
    doc: &Value,
    scene: &Scene,
    plants: Plants,
    every: Option<u32>,
) -> Result<BTreeMap<String, Held>, Vec<deep_canvas::document::Issue>> {
    let mut issues = rule::issues(doc, every);
    if !issues.iter().any(|i| i.severity == "error") {
        let doc_seed = doc["seed"].as_u64().unwrap_or(0);
        let mut out = BTreeMap::new();
        for (id, _) in rule::items(doc) {
            match baked(
                doc,
                scene,
                id,
                item_seed(doc_seed, id),
                plants,
                &mut Vec::new(),
            ) {
                Ok(h) => {
                    out.insert(id.clone(), h);
                }
                Err(r) => issues.push(rule::issue(id, &r)),
            }
        }
        if !issues.iter().any(|i| i.severity == "error") {
            return Ok(out);
        }
    }
    Err(issues)
}

/// The `particles` call (tests/acceptance/449/README.md: The surface under test): the document
/// check, the estimate, and each item's particles as the CPU f64 closed form solves them, with
/// its rows at each time asked, the compute pass's columns and its bounds.
pub(crate) fn call(app: &mut App, out: &str, call: &Value) -> Value {
    answer(app, out, call).unwrap_or_else(|e| e)
}

fn answer(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    if doc.get("size").is_none() {
        doc["size"] = json!([320, 240]);
    }
    // #508: a plume's and an airflow's particles, as the view draws them.
    let broken = deep_canvas_effects::effect::issues(&doc);
    if !broken.is_empty() {
        return Ok(json!({"outcome": "refused", "issues": broken}));
    }
    deep_canvas_effects::effect::lower(&mut doc);
    // #451: a document with 2D particles places them along curves laid out at each time.
    if crate::flows2d::any(&doc) {
        return crate::flows2d::answer(&doc, call, app.planted);
    }
    crate::physics::bake(&mut doc, &Value::Null, &BTreeMap::new())?;
    let (plants, flags, every) = plants(app.planted);
    // The rules that read the document alone refuse it before anything evaluates.
    let early: Vec<_> = rule::issues(&doc, every)
        .into_iter()
        .filter(|i| i.severity == "error")
        .collect();
    if !early.is_empty() {
        return Ok(json!({"outcome": "refused", "issues": issues_json(&early)}));
    }
    let look = Look3::read(&closed::neutral_look(&doc)).map_err(|e| bad(&format!("look: {e}")))?;
    let mut scene =
        evaluate(&doc, 0, &look, &mut Labels::new()).map_err(|r| refused(r.code, r.path))?;
    if let Err(r) = follow_effects(&mut scene, &doc) {
        return Ok(json!({"outcome": "refused", "issues": r["issues"]}));
    }
    let held = match checked(&doc, &scene, plants, every) {
        Ok(h) => h,
        Err(issues) => return Ok(json!({"outcome": "refused", "issues": issues_json(&issues)})),
    };
    let estimate = rule::estimate(&doc);
    let times: Vec<i64> = call["t"]
        .as_array()
        .map(|t| t.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let mut items = Map::new();
    if !times.is_empty() {
        let gpu = call["gpu"] == json!(true);
        let with_bounds = call["bounds"] == json!(true);
        if gpu && app.backend == Backend::Noop {
            return Err(refused(
                "no_device",
                "gpu reads the compute pass's columns, which the noop backend doesn't run",
            ));
        }
        let wanted: Option<Vec<&str>> = call["items"]
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_str).collect());
        let span = doc
            .pointer("/transport/span")
            .and_then(|v| deep_canvas::document::duration(&doc, v).ok())
            .map_or(f64::INFINITY, |f| f as f64 / FLICKS);
        for (id, h) in &held {
            if wanted.as_ref().is_some_and(|w| !w.contains(&id.as_str())) {
                continue;
            }
            // The surface a follow item rides, as evaluated at each time read.
            let nows: Vec<Option<Vec<[f64; 3]>>> = match &h.0.surface {
                Some(sf) if h.0.spec.follow => times
                    .iter()
                    .map(|t| {
                        evaluate(&doc, *t, &look, &mut Labels::new())
                            .map(|sc| Some(sf.now(&sc)))
                            .map_err(|r| refused(r.code, r.path))
                    })
                    .collect::<Result<_, _>>()?,
                _ => vec![None; times.len()],
            };
            items.insert(
                id.clone(),
                reading(app, out, h, &times, &nows, span, gpu, with_bounds, flags)?,
            );
        }
    }
    Ok(json!({"outcome": "checked", "issues": [], "estimate": estimate, "items": items}))
}

fn v3(v: [f64; 3]) -> Value {
    json!(v)
}

/// The frames this process drew, s, in order: the planted inherit reads them.
static DRAWN: Mutex<Vec<f64>> = Mutex::new(Vec::new());

/// #265: where each item's anchor stood at each frame this process drew, with the frame's time
/// in s, in order: the planted `anchor_kept_from_frame` reads them.
static ANCHORED: Mutex<Anchors> = Mutex::new(BTreeMap::new());

/// Each item's anchor at each frame drawn: the frame's time in s and where the anchor stood.
type Anchors = BTreeMap<String, Vec<(f64, [f64; 3])>>;

/// The planted `anchor_kept_from_frame`: each birth bucket's anchor where the last frame this
/// process drew at or before the bucket placed it, and with no such frame where this frame does,
/// never the bake's value at the bucket.
fn anchored_from_frames(h: &Held, scene: &Scene, params: &Value, id: &str, t: f64) -> Held {
    let mut b = h.0.clone();
    let anchor = params["emit"]["anchor"].as_str().unwrap_or_default();
    let now = item_pos(scene, anchor).unwrap_or_default();
    let mut all = ANCHORED.lock().unwrap_or_else(|e| e.into_inner());
    let drawn = all.entry(id.to_string()).or_default();
    if let Some(a) = b.anchors.as_mut() {
        for (k, at) in a.at.iter_mut().enumerate() {
            let bucket = k as f64 * a.step + 1e-9;
            *at = drawn
                .iter()
                .rev()
                .find(|(s, _)| *s <= bucket)
                .map_or(now, |(_, p)| *p);
        }
    }
    drawn.push((t, now));
    let tables = pack::tables(&b);
    Arc::new((b, tables))
}

/// One item's reading: its particles, its turbulence table, and its rows at each time.
#[allow(clippy::too_many_arguments)]
fn reading(
    app: &mut App,
    out: &str,
    held: &Held,
    times: &[i64],
    nows: &[Option<Vec<[f64; 3]>>],
    span: f64,
    gpu: bool,
    with_bounds: bool,
    flags: u32,
) -> Result<Value, Value> {
    let (b, tables) = &**held;
    let mut records = eval::records(b, span);
    records.sort_by(|a, c| a.born.total_cmp(&c.born).then(a.row.cmp(&c.row)));
    let particles: Vec<Value> = records
        .iter()
        .map(|r| {
            json!({"row": r.row, "born": r.born, "from": v3(r.from), "velocity": v3(r.velocity), "life": r.life,
                   "hits": r.hits.iter().map(|(t, at, plane)| json!({"t": t, "at": v3(*at), "plane": plane})).collect::<Vec<_>>(),
                   "rest": r.rest.map(|(t, at)| json!({"t": t, "at": v3(at)})), "ends": r.ends})
        })
        .collect();
    let turbulence = match &b.turbulence {
        Some(t) => {
            let name = write_named(out, &t.bytes(), "f32")?;
            json!({"table": name, "paths": t.paths, "steps": t.steps})
        }
        None => Value::Null,
    };
    let count = b.spec.count;
    let columns = if gpu {
        let uniforms: Vec<Vec<u32>> = times
            .iter()
            .map(|t| pack::uniform(b, *t as f64 / FLICKS, tables, flags))
            .collect();
        let words = tables.words.clone();
        let now32: Vec<Vec<f32>> = nows.iter().map(|n| flat(n.as_deref())).collect();
        app.worker.call(move |state| {
            let device = state.gpu.device();
            let kernel = deep_effects_render::closed::Closed::new(&device);
            uniforms
                .iter()
                .zip(&now32)
                .map(|(u, n)| kernel.columns(&device, u, &words[..], n, count))
                .collect::<Vec<_>>()
        })
    } else {
        Vec::new()
    };
    let rows = |c: &dyn Fn(usize) -> Option<[f64; 3]>| -> Vec<Value> {
        (0..count as usize)
            .map(|e| c(e).map_or(Value::Null, v3))
            .collect()
    };
    let mut at = Vec::new();
    for (k, t) in times.iter().enumerate() {
        let secs = *t as f64 / FLICKS;
        let cpu = eval::columns_on(b, secs, nows[k].as_deref());
        let live = |e: usize| {
            (cpu[e * 8 + 3] >= 0.0).then(|| [cpu[e * 8], cpu[e * 8 + 1], cpu[e * 8 + 2]])
        };
        let mut sample = json!({"t": t, "cpu": rows(&live)});
        if let Some(g) = columns.get(k) {
            let lanes = |e: usize| {
                (g.get(e * 8 + 3).is_some_and(|a| *a >= 0.0))
                    .then(|| [0, 1, 2].map(|i| f64::from(g[e * 8 + i])))
            };
            sample["gpu"] = Value::Array(rows(&lanes));
        }
        if with_bounds {
            sample["bounds"] =
                bounds::bounds(b, secs).map_or(Value::Null, |[lo, hi]| json!([lo, hi]));
        }
        at.push(sample);
    }
    Ok(json!({"count": count, "particles": particles, "turbulence": turbulence, "at": at}))
}

/// A refusal as the call's reply: its code, the path it names and the sentence naming why.
pub(crate) fn refusal(r: &Refusal) -> Value {
    json!({"code": r.code, "reason": r.path, "path": r.path, "what": r.what})
}

/// The evaluated-data hash of an item at t (tests/acceptance/449/README.md: view3d's
/// `particles`): SHA-256 over its rows, a live row as the byte 1 then its CPU f64 position as
/// three little-endian f64, an empty row as the byte 0; with how many rows are live. A ribbon's
/// live row holds its ribbon's points in place of its position (tests/acceptance/450/README.md).
fn evaluated(
    b: &Baked,
    t: f64,
    now: Option<&[[f64; 3]]>,
    ribbon: Option<&Ribbon>,
) -> (String, usize) {
    let cpu = eval::columns_on(b, t, now);
    let mut bytes = Vec::with_capacity(cpu.len() * 4);
    let mut live = 0;
    for (e, row) in cpu.chunks(eval::FLOATS).enumerate() {
        if row[3] < 0.0 {
            bytes.push(0);
            continue;
        }
        live += 1;
        bytes.push(1);
        let points = match ribbon {
            Some(r) => closed::draws::ribbon(b, r, e as u32, (t * FLICKS).round() as i64, now)
                .unwrap_or_default(),
            None => vec![[row[0], row[1], row[2]]],
        };
        for x in points.iter().flatten() {
            bytes.extend(x.to_le_bytes());
        }
    }
    (crate::frames::hex(&bytes), live)
}

/// `view3d`'s host of a frame's particles: the planted programs, and the report on the items its
/// call asks for (`particles: [ids]`).
struct View<'a> {
    planted: Option<Planted>,
    call: &'a Value,
    asked: Vec<&'a str>,
    t: f64,
    report: Map<String, Value>,
}

impl Host for View<'_> {
    fn plants(&self) -> Plants {
        plants(self.planted).0
    }

    fn flags(&self) -> u32 {
        plants(self.planted).1
    }

    fn culls(&self) -> bool {
        self.call["particle_cull"] != "none"
    }

    fn held(&mut self, held: Held, scene: &Scene, o: &Other, t: f64) -> Held {
        // The planted inherit reads the frames this process drew before.
        let held = if self.plants().inherit_previous_frame && held.0.surface.is_some() {
            let mut b = held.0.clone();
            b.drawn = DRAWN.lock().unwrap_or_else(|e| e.into_inner()).clone();
            let tables = pack::tables(&b);
            Arc::new((b, tables))
        } else {
            held
        };
        // #265's planted anchor, kept from the frames this process drew.
        if self.planted == Some(Planted::AnchorKeptFromFrame) && held.0.anchors.is_some() {
            return anchored_from_frames(&held, scene, &o.params, &o.id, t);
        }
        held
    }

    fn readied(
        &mut self,
        id: &str,
        b: &Baked,
        now: Option<&[[f64; 3]]>,
        ribbon: Option<&Ribbon>,
        culled: bool,
    ) {
        if self.asked.contains(&id) {
            let (hash, live) = evaluated(b, self.t, now, ribbon);
            let row = json!({"hash": hash, "live": live, "culled": culled});
            self.report.insert(id.to_string(), row);
        }
    }
}

/// Readies a frame's particles at `t` (deep_effects_render::particles::frame), unculled when the
/// call says `particle_cull: "none"`. With `particles: [ids]` asked, the frame's report on each.
pub(crate) fn frame(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    call: &Value,
    planted: Option<Planted>,
) -> Result<Option<Value>, Value> {
    let asked: Vec<&str> = call["particles"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut view = View {
        planted,
        call,
        asked,
        t,
        report: Map::new(),
    };
    shared::frame(settings, doc, scene, t, &mut view).map_err(|r| refusal(&r))?;
    DRAWN.lock().unwrap_or_else(|e| e.into_inner()).push(t);
    Ok((!view.asked.is_empty()).then_some(Value::Object(view.report)))
}

/// #508: each film effect's footprint this frame, its haze in `settings`
/// (deep_effects_render::particles::effects).
pub(crate) fn effects(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    planted: Option<Planted>,
    seeding: Seeding,
) -> Result<Map<String, Value>, Value> {
    shared::effects(settings, doc, scene, t, plants(planted).0, seeding).map_err(|r| refusal(&r))
}

/// #450: the document with its mesh particles as instancers (deep_effects_render::particles::meshes).
pub(crate) fn meshes(
    doc: &Value,
    scene: &Scene,
    t: f64,
    planted: Option<Planted>,
) -> Result<Option<Value>, Value> {
    shared::meshes(doc, scene, t, plants(planted).0).map_err(|r| refusal(&r))
}

/// The check's refusal of a document's particles before anything draws: `{"code": "refused",
/// "issues": [...]}`, as a checked document is refused.
pub(crate) fn refuse(doc: &Value, planted: Option<Planted>) -> Result<(), Value> {
    let (_, _, every) = plants(planted);
    let errors: Vec<_> = rule::issues(doc, every)
        .into_iter()
        .filter(|i| i.severity == "error")
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(json!({"code": "refused", "issues": issues_json(&errors)}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A document with a plume on a throttle that drives its reach, at the throttle's `at`.
    fn throttled(at: f64) -> Value {
        let mut doc = json!({
            "format": 1, "id": "driven-plume", "profile": "scene", "title": "t", "description": "d",
            "size": [320, 240], "camera": "cam", "seed": 508, "transport": {"span": "4s"},
            "requires": {"modules": {"scene3d": "^1", "motion": "^1", "input": "^1", "effects": "^1"}},
            "controls": {"throttle": {"kind": "slider", "class": "document", "label": "Throttle",
                                      "role": "slider", "range": [0, 1], "default": at, "increment": 0.01}},
            "drivers": {"plume-reach": {"target": "items/plume/params/plume/reach", "expr": "0.4 + 1.6 * th",
                                        "vars": {"th": "controls/throttle/value"}}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                        "params": {"projection": "orthographic", "position": [0, 0, 10], "target": [0, 0, 0],
                                   "view_width": 6.4, "near": 0.05, "far": 100}},
                "plume": {"id": "plume", "kind": "effect@1", "order": "a1",
                          "params": {"kind": "plume", "axis": [1, 0, 0],
                                     "plume": {"radius": 0.1, "reach": 1.0, "heat": 1.0, "turbulence": 0.0}}},
            },
        });
        deep_canvas_effects::effect::lower(&mut doc);
        doc
    }

    /// How far along +X the plume's live particles reach at 2 s, as the CPU f64 closed form
    /// evaluates the particles of the scene the view draws.
    fn reach_at_2s(doc: &Value) -> f64 {
        let look = Look3::read(&closed::neutral_look(doc)).expect("the look reads");
        let mut labels = Labels::new();
        let scene = evaluate_sourced(doc, 0, &look, &mut labels, &|_| None, Default::default())
            .expect("the scene evaluates");
        let plants = Plants::default();
        let held = baked(doc, &scene, "plume.particles", 7, plants, &mut vec![])
            .expect("the plume's particles bake");
        eval::columns(&held.0, 2.0)
            .chunks(eval::FLOATS)
            .filter(|r| r[3] >= 0.0)
            .map(|r| r[0])
            .fold(f64::MIN, f64::max)
    }

    /// #508: a driver on a plume's reach reaches its particles: with the throttle at its top
    /// (reach 2 m) they reach farther than at its bottom (0.4 m), in the scene the view draws.
    #[test]
    fn a_driven_plume_reach_moves_its_particles() {
        let (low, high) = (reach_at_2s(&throttled(0.0)), reach_at_2s(&throttled(1.0)));
        assert!(
            low > 0.3 && low < 0.6,
            "at the throttle's bottom the particles reach {low} m, not about 0.4"
        );
        assert!(
            high > 1.8,
            "at the throttle's top the particles reach {high} m, not about 2 (the bottom's {low})"
        );
    }

    /// #508: a driver that sets an airflow's speed to 0, below its range, refuses the frame as an
    /// out-of-range document is refused, naming the field, instead of baking `length / 0`.
    #[test]
    fn a_driven_effect_value_out_of_range_refuses_the_frame() {
        let mut doc = json!({
            "format": 1, "id": "driven-airflow", "profile": "scene", "title": "t", "description": "d",
            "size": [320, 240], "camera": "cam", "seed": 508, "transport": {"span": "4s"},
            "requires": {"modules": {"scene3d": "^1", "motion": "^1", "input": "^1", "effects": "^1"}},
            "controls": {"wind": {"kind": "slider", "class": "document", "label": "Wind",
                                  "role": "slider", "range": [0, 1], "default": 0, "increment": 0.01}},
            "drivers": {"flow-speed": {"target": "items/flow/params/airflow/speed", "expr": "2 * w",
                                       "vars": {"w": "controls/wind/value"}}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                        "params": {"projection": "orthographic", "position": [0, 0, 10], "target": [0, 0, 0],
                                   "view_width": 6.4, "near": 0.05, "far": 100}},
                "path": {"id": "path", "kind": "curve@1", "order": "a1",
                         "params": {"points": [[-1, 0, 0], [0, 0.5, 0], [1, 0, 0]]}},
                "flow": {"id": "flow", "kind": "effect@1", "order": "a2",
                         "params": {"kind": "airflow", "airflow": {"paths": ["path"], "speed": 1, "length": 2}}},
            },
        });
        deep_canvas_effects::effect::lower(&mut doc);
        let look = Look3::read(&closed::neutral_look(&doc)).expect("the look reads");
        let got = evaluate_sourced(
            &doc,
            0,
            &look,
            &mut Labels::new(),
            &|_| None,
            Default::default(),
        );
        let Err(refusal) = got else {
            panic!("a frame with airflow.speed driven to 0 evaluated instead of refusing");
        };
        assert_eq!(refusal["code"], "refused", "{refusal}");
        let named =
            refusal["issues"].as_array().into_iter().flatten().any(|i| {
                i["code"] == "out_of_range" && i["path"] == "items/flow/params/airflow/speed"
            });
        assert!(
            named,
            "the refusal names no out_of_range airflow.speed: {refusal}"
        );
    }
}
