//! #449: particles@1 items that use a closed-form field (emit regions, bursts, bounces, kill,
//! turbulence, landing), baked once per content key from the document and its evaluated scene
//! (deep_canvas_effects::particles::bake), then each frame packed into the closed-form kernel's
//! uniform and drawn as the shipped graph's items are.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::particles::bake::{self, Inputs};
use deep_canvas_effects::particles::draws::Ribbon;
use deep_canvas_effects::particles::eval::{self, Baked};
use deep_canvas_effects::particles::pack::{self, Tables};
use deep_canvas_effects::particles::{
    self as closed, bounds, rule, spec::Refusal, Planted as Plants,
};
use deep_canvas_scene3d::label::Labels;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Scene};
use deep_effects_render::frame::Settings;
use deep_gpu::device::Backend;
use serde_json::{json, Map, Value};

use crate::effects::{item_pos, item_seed, resampled};
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
            .map_err(|r| refused(r.code, r.path))?;
    follow_effects(&mut scene, doc)?;
    Ok(scene)
}

/// #508: a plume's and an airflow's particles follow their effect's params as evaluated at t, so
/// a driver on a reach, a heat or a speed moves them: each particles item `effect::lower` wrote
/// takes the params its effect's evaluated params lower to (an airflow's paths read from `doc`).
/// The bake, the draw, the footprint and the readings all read them from the scene. A driven
/// value out of its range refuses the frame as view3d refuses such a document, naming the field.
fn follow_effects(scene: &mut Scene, doc: &Value) -> Result<(), Value> {
    use deep_canvas_effects::effect;
    let mut items = Map::new();
    let mut broken = Vec::new();
    for o in scene.others.iter().filter(|o| o.kind == "effect@1") {
        let mut item = doc["items"][&o.id].clone();
        item["params"] = o.params.clone();
        broken.extend(effect::item_issues(doc, &o.id, &item));
        let paths: Vec<&str> = o.params["airflow"]["paths"]
            .as_array()
            .map_or(Vec::new(), |a| a.iter().filter_map(Value::as_str).collect());
        if effect::kind_of(&item).is_none() || paths.iter().any(|c| doc["items"].get(c).is_none()) {
            continue;
        }
        for c in paths {
            items.insert(c.to_string(), doc["items"][c].clone());
        }
        items.insert(o.id.clone(), item);
    }
    if !broken.is_empty() {
        return Err(json!({"code": "refused", "issues": broken}));
    }
    if items.is_empty() {
        return Ok(());
    }
    let mut lowered = json!({ "items": items });
    effect::lower(&mut lowered);
    for o in scene.others.iter_mut().filter(|o| o.kind == "particles@1") {
        if let Some(d) = lowered["items"]
            .get(&o.id)
            .filter(|d| d.get("lowered").is_some())
        {
            o.params = d["params"].clone();
        }
    }
    Ok(())
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
    crate::physics::bake(&mut doc, &Value::Null)?;
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

/// Vertices as the kernel's `now` buffer reads them.
fn flat(v: Option<&[[f64; 3]]>) -> Vec<f32> {
    v.into_iter()
        .flatten()
        .flatten()
        .map(|x| *x as f32)
        .collect()
}

/// The frames this process drew, s, in order: the planted inherit reads them.
static DRAWN: Mutex<Vec<f64>> = Mutex::new(Vec::new());

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

/// A bake and its packed tables.
pub(crate) type Held = Arc<(Baked, Tables)>;

/// Bakes kept by content key, so a frame packs only its uniform.
static BAKED: Mutex<BTreeMap<String, Held>> = Mutex::new(BTreeMap::new());
/// At most this many bakes are kept.
const KEPT: usize = 16;

/// A refusal as the call's reply: its code, the path it names and the sentence naming why.
pub(crate) fn refusal(r: &Refusal) -> Value {
    json!({"code": r.code, "reason": r.path, "path": r.path, "what": r.what})
}

/// Item `id`'s bake: kept, or baked now with every particles item it bursts at baked first; a
/// chain of `emit.on.particles` that comes back to an item is refused, naming its items.
pub(crate) fn baked(
    doc: &Value,
    scene: &Scene,
    id: &str,
    seed: u32,
    plants: Plants,
    chain: &mut Vec<String>,
) -> Result<Held, Refusal> {
    if chain.iter().any(|c| c == id) {
        chain.push(id.to_string());
        return Err(Refusal::new(
            "cycle",
            format!("items/{id}/params/emit/on/particles"),
            format!(
                "bursts at particles come back to {id}: {}",
                chain.join(" → ")
            ),
        ));
    }
    let o = scene
        .others
        .iter()
        .find(|o| o.id == id && o.kind == "particles@1")
        .ok_or_else(|| {
            Refusal::new(
                "ref_unresolved",
                format!("items/{id}"),
                format!("{id} is no particles item"),
            )
        })?;
    let p = &o.params;
    let origin = p["emit"]["anchor"]
        .as_str()
        .and_then(|a| item_pos(scene, a))
        .unwrap_or(o.pos);
    let curve_id = p["motion"]["along"]["curve"]
        .as_str()
        .or(p["emit"]["shape"]["along"].as_str());
    let curve = curve_id
        .and_then(|c| scene.curves.get(c))
        .map(|pts| resampled(pts))
        .unwrap_or((Vec::new(), 0.0));
    chain.push(id.to_string());
    let parent_id = p["emit"]["on"]["particles"].as_str();
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let parent = match parent_id {
        Some(pid) => Some(baked(
            doc,
            scene,
            pid,
            item_seed(doc_seed, pid),
            plants,
            chain,
        )?),
        None => None,
    };
    chain.pop();
    let inputs = Inputs {
        doc,
        scene,
        id,
        params: p,
        seed,
        origin,
        curve,
        parent: parent_id.zip(parent.as_ref().map(|h| &h.0)),
        planted: plants,
    };
    let spec = closed::spec::read(doc, id, p)?;
    // #451: a world-space emitter reads its anchor at every birth bucket, so its bake is keyed by
    // the whole document that moves the anchor, and a flow by the curves it runs along.
    let world = p["emit"]["anchor"]
        .as_str()
        .filter(|_| spec.space == closed::spec::Space::World);
    // #451: a flow along many curves, each as the scene lays it out.
    let flows = match &spec.motion {
        closed::spec::Motion::Along { many: Some(m), .. } => {
            let names: Vec<String> = match &m.collection {
                Some(c) => doc["collections"][c]["members"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect(),
                None => m.curves.clone(),
            };
            names
                .iter()
                .map(|n| {
                    scene
                        .curves
                        .get(n)
                        .map(|pts| closed::flows::Curve::new(pts.clone()))
                        .ok_or_else(|| {
                            Refusal::new(
                                "ref_unresolved",
                                format!("items/{id}/params/motion/along/curves"),
                                format!("{id}: along.curves names {n}, which is no curve"),
                            )
                        })
                })
                .collect::<Result<Vec<_>, _>>()?
        }
        _ => Vec::new(),
    };
    let mut h = deep_canvas::schedule::Hasher::new("particles.flows");
    if world.is_some() {
        h.bytes(doc.to_string().as_bytes());
    }
    for x in flows.iter().flat_map(|c| c.points.iter().flatten()) {
        h.bytes(&x.to_le_bytes());
    }
    let moved = h.finish().hex();
    let key = format!("{}{:?}{moved}", bake::key(&inputs, &spec), plants);
    if let Some(h) = BAKED.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(h.clone());
    }
    let mut b = bake::bake(&inputs)?;
    b.flows = flows;
    if let Some(anchor) = world {
        b.anchors = Some(anchors(doc, id, anchor, spec.span)?);
    }
    let tables = pack::tables(&b);
    let held: Held = Arc::new((b, tables));
    let mut kept = BAKED.lock().unwrap_or_else(|e| e.into_inner());
    if kept.len() >= KEPT {
        kept.clear();
    }
    kept.insert(key, held.clone());
    Ok(held)
}

/// A world-space emitter's anchor at each birth bucket of the document's span: the scene
/// evaluated at each whole multiple of its frame interval, through the chain a trail reads
/// (channels, drivers, constraints, a physics bake's outputs), never a pose kept from a frame.
fn anchors(doc: &Value, id: &str, anchor: &str, emits: f64) -> Result<eval::Anchors, Refusal> {
    let (p, q) = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let per = i64::from(q) * FLICKS as i64 / i64::from(p);
    let span = doc
        .pointer("/transport/span")
        .and_then(|v| deep_canvas::document::duration(doc, v).ok())
        .map_or(10.0, |f| f as f64 / FLICKS)
        .min(emits);
    let step = per as f64 / FLICKS;
    let n = ((span / step).ceil() as usize + 1).min(1 << 16);
    let bad = |what: String| {
        Refusal::new(
            "ref_unresolved",
            format!("items/{id}/params/emit/anchor"),
            what,
        )
    };
    let look = Look3::read(&closed::neutral_look(doc)).map_err(|e| bad(format!("{id}: {e}")))?;
    let mut at = Vec::with_capacity(n);
    for k in 0..n {
        let scene = evaluate(doc, k as i64 * per, &look, &mut Labels::new()).map_err(|r| {
            bad(format!(
                "{id}: its anchor's scene at bucket {k}: {}",
                r.path
            ))
        })?;
        at.push(item_pos(&scene, anchor).ok_or_else(|| {
            bad(format!(
                "{id}: emit.anchor names {anchor}, which isn't placed"
            ))
        })?);
    }
    Ok(eval::Anchors { step, at })
}

/// Whether `bx`, grown by `reach` m and by `pad` px across the view, lies wholly outside what
/// the camera draws: past one side of the view or behind the eye, where the draw hides a
/// particle (particles.wgsl). Clip coordinates are linear in world ones, so a box all of whose
/// corners lie past one such plane lies past it whole.
fn outside(scene: &Scene, bx: [[f64; 3]; 2], reach: f64, pad: f64) -> bool {
    let m = scene
        .camera
        .clip(deep_canvas_scene3d::scene::Depth::Reversed);
    let [w, h] = scene.camera.size;
    let (kx, ky) = (1.0 + 2.0 * pad / w.max(1.0), 1.0 + 2.0 * pad / h.max(1.0));
    // Each corner's clip x, y and w.
    let corners: Vec<[f64; 3]> = (0..8)
        .map(|c: usize| {
            let p = [0, 1, 2].map(|k| {
                if c >> k & 1 == 1 {
                    bx[1][k] + reach
                } else {
                    bx[0][k] - reach
                }
            });
            [0, 1, 3].map(|r| m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3])
        })
        .collect();
    let all = |f: &dyn Fn(&[f64; 3]) -> bool| corners.iter().all(f);
    all(&|c| c[2] <= 0.0)
        || all(&|c| c[0] > kx * c[2])
        || all(&|c| -c[0] > kx * c[2])
        || all(&|c| c[1] > ky * c[2])
        || all(&|c| -c[1] > ky * c[2])
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

/// Readies a frame's particles at `t`: every closed-form item in `settings` gets its frame's
/// words (the rest keep the shipped graph), and an item whose closed-form bounds, grown by its
/// sprites' size, lie outside the view is culled: neither dispatched nor drawn, unless the call
/// says `particle_cull: "none"`. With `particles: [ids]` asked, the frame's report on each.
pub(crate) fn frame(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    call: &Value,
    planted: Option<Planted>,
) -> Result<Option<Value>, Value> {
    let (plants, flags, _) = plants(planted);
    let cull = call["particle_cull"] != "none";
    let asked: Vec<&str> = call["particles"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut report = Map::new();
    let mut kept = Vec::new();
    for mut sp in std::mem::take(&mut settings.sparks) {
        let Some(o) = scene.others.iter().find(|o| o.id == sp.item) else {
            kept.push(sp);
            continue;
        };
        let extended = closed::extended(&o.params);
        // A closed-form item's bake refuses the frame; a shipped-graph item it can't read is
        // drawn without culling, as before.
        let held = match baked(doc, scene, &sp.item, sp.seed, plants, &mut Vec::new()) {
            Ok(h) => Some(h),
            Err(r) if extended => return Err(refusal(&r)),
            Err(_) => None,
        };
        let mut culled = false;
        // The planted inherit reads the frames this process drew before.
        let held = match held {
            Some(h) if plants.inherit_previous_frame && h.0.surface.is_some() => {
                let mut b = h.0.clone();
                b.drawn = DRAWN.lock().unwrap_or_else(|e| e.into_inner()).clone();
                let tables = pack::tables(&b);
                Some(Arc::new((b, tables)))
            }
            other => other,
        };
        let now = held
            .as_ref()
            .and_then(|h| h.0.surface.as_ref().filter(|_| h.0.spec.follow))
            .map(|sf| sf.now(scene));
        // #450: a ribbon's rows back along its length, one dispatch a segment end.
        let ribbon = closed::draws::read(&sp.item, &o.params)
            .map_err(|r| refusal(&r))?
            .ribbon;
        if let Some(h) = &held {
            let (b, tables) = &**h;
            if extended {
                sp.count = b.spec.count;
                let uniforms = match &ribbon {
                    Some(r) => pack::ribbon(b, r, t, tables, flags, true),
                    None => vec![pack::uniform(b, t, tables, flags)],
                };
                sp.ribbon = ribbon.map(|r| (r.segments, r.width, r.taper, r.fade));
                // Its rows draw as a ribbon's quads, never as sprites (particles.wgsl: kind 4).
                if sp.ribbon.is_some() {
                    sp.draw = 4;
                }
                sp.closed = Some((uniforms, tables.words.clone(), flat(now.as_deref())));
            }
            if cull {
                let pad = 0.5 * sp.size[0].max(sp.size[1]).max(1.0) * sp.size_px + 2.0;
                // A streak reaches a 30th of a second ahead, a ribbon its length behind (#450).
                let reach = match (&ribbon, sp.draw) {
                    (Some(r), _) => {
                        bounds::speed(b, t).max(bounds::speed(b, t - r.length)) * r.length
                    }
                    (None, 3) => bounds::speed(b, t) / 30.0,
                    _ => 0.0,
                };
                culled = bounds::bounds(b, t).is_none_or(|bx| outside(scene, bx, reach, pad));
            }
            if asked.contains(&sp.item.as_str()) {
                let (hash, live) = evaluated(b, t, now.as_deref(), ribbon.as_ref());
                report.insert(
                    sp.item.clone(),
                    json!({"hash": hash, "live": live, "culled": culled}),
                );
            }
        }
        // A mesh draw's particles draw as its instancer's elements (#450), never as sprites.
        let mesh = closed::draws::read(&sp.item, &o.params).is_ok_and(|d| d.mesh.is_some());
        if !culled && !mesh {
            kept.push(sp);
        }
    }
    settings.sparks = kept;
    DRAWN.lock().unwrap_or_else(|e| e.into_inner()).push(t);
    Ok((!asked.is_empty()).then_some(Value::Object(report)))
}

/// #508: the rect (px, x0 y0 x1 y1) holding a projected world box grown by `pad` px, clamped to
/// the frame; the whole frame when a corner is behind the eye; `None` when it's empty.
fn rect_of(
    cam: &deep_canvas_scene3d::scene::Camera,
    corners: &[[f64; 3]],
    pad: f64,
) -> Option<[f64; 4]> {
    let [w, h] = cam.size;
    let projected: Option<Vec<[f64; 3]>> = corners.iter().map(|c| cam.project(*c)).collect();
    let r = match projected {
        Some(c) => {
            let (xs, ys) = (c.iter().map(|p| p[0]), c.iter().map(|p| p[1]));
            [
                xs.clone().fold(f64::INFINITY, f64::min) - pad,
                ys.clone().fold(f64::INFINITY, f64::min) - pad,
                xs.fold(f64::NEG_INFINITY, f64::max) + pad,
                ys.fold(f64::NEG_INFINITY, f64::max) + pad,
            ]
        }
        None => [0.0, 0.0, w, h],
    };
    let r = [
        r[0].floor().clamp(0.0, w),
        r[1].floor().clamp(0.0, h),
        r[2].ceil().clamp(0.0, w),
        r[3].ceil().clamp(0.0, h),
    ];
    (r[2] > r[0] && r[3] > r[1]).then_some(r)
}

/// A box's eight corners.
fn corners_of([lo, hi]: [[f64; 3]; 2]) -> Vec<[f64; 3]> {
    (0..8usize)
        .map(|c| [0, 1, 2].map(|k| if c >> k & 1 == 1 { hi[k] } else { lo[k] }))
        .collect()
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn unit(a: [f64; 3]) -> [f64; 3] {
    let l = deep_canvas::ops::sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).max(1e-12);
    a.map(|x| x / l)
}

fn union(a: Option<[f64; 4]>, b: [f64; 4]) -> [f64; 4] {
    a.map_or(b, |a| {
        [
            a[0].min(b[0]),
            a[1].min(b[1]),
            a[2].max(b[2]),
            a[3].max(b[3]),
        ]
    })
}

/// #508: each film effect's screen footprint this frame (Surfaces this job invents, 5), by item:
/// the rect (px) holding everything it draws or displaces. A plume's or an airflow's is its
/// particles' closed-form bounds at `t` projected and grown by their sprites' size; a wave
/// field's its disc of `radius` on its plane; an arc's its ends' box grown by its jitter and its
/// glow's reach. Each plume with a haze adds the haze over its footprint to `settings`, with its
/// cell (its `scale` in px at the bounds' centre) and its flow (the plume's speed along its axis
/// on screen, px/s). An effect that draws nothing in view this frame has no footprint.
pub(crate) fn effects(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    planted: Option<Planted>,
    seeding: crate::effects::Seeding,
) -> Result<Map<String, Value>, Value> {
    use deep_canvas_effects::effect;
    let (plants, _, _) = plants(planted);
    let cam = &scene.camera;
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let mut out = Map::new();
    for o in scene.others.iter().filter(|o| o.kind == "effect@1") {
        let Some(kind) = o.params["kind"]
            .as_str()
            .filter(|k| effect::KINDS.contains(k))
        else {
            continue;
        };
        let p = &o.params;
        let n = |f: &str| effect::num(p, kind, f);
        let mut rect = None;
        let mut centre = None;
        match kind {
            "plume" | "airflow" => {
                for sp in settings
                    .sparks
                    .iter()
                    .filter(|s| s.effect.as_deref() == Some(&o.id))
                {
                    let pad = 0.5 * sp.size[0].max(sp.size[1]).max(1.0) * sp.size_px + 2.0;
                    let held = baked(doc, scene, &sp.item, sp.seed, plants, &mut Vec::new())
                        .map_err(|r| refusal(&r))?;
                    let Some(bx) = bounds::bounds(&held.0, t) else {
                        continue;
                    };
                    centre = Some([0, 1, 2].map(|k| 0.5 * (bx[0][k] + bx[1][k])));
                    if let Some(r) = rect_of(cam, &corners_of(bx), pad) {
                        rect = Some(union(rect, r));
                    }
                }
            }
            "wave_field" | "arc" => {
                let Some(e) = settings.emits.iter().find(|e| e.item == o.id) else {
                    continue;
                };
                let v3 = |k: &str| -> [f64; 3] {
                    let v = &e.params[k];
                    [0, 1, 2].map(|i| v[i].as_f64().unwrap_or(0.0))
                };
                if kind == "wave_field" {
                    let (c, a, r) = (v3("wave.point"), v3("wave.normal"), n("radius"));
                    // Two directions across the axis.
                    let other = if a[0].abs() < 0.9 {
                        [1.0, 0.0, 0.0]
                    } else {
                        [0.0, 1.0, 0.0]
                    };
                    let u = unit(cross(a, other));
                    let w = cross(a, u);
                    let disc: Vec<[f64; 3]> = [(1.0, 1.0), (1.0, -1.0), (-1.0, 1.0), (-1.0, -1.0)]
                        .iter()
                        .map(|(i, j)| [0, 1, 2].map(|k| c[k] + r * (i * u[k] + j * w[k])))
                        .collect();
                    rect = rect_of(cam, &disc, 2.0);
                } else {
                    let reach = n("jitter") + 4.0 * n("width") + 2.0;
                    rect = rect_of(cam, &[v3("arc.from"), v3("arc.to")], reach);
                }
            }
            _ => {}
        }
        let Some(rect) = rect else {
            continue;
        };
        if let (true, Some(centre)) = (kind == "plume" && n("haze/strength") > 0.0, centre) {
            let at = cam.project(centre);
            let px_per_m = at.map_or(1.0, |q| cam.px_per_m(q[2]));
            let a = effect::axis(&p["axis"]);
            let speed = n("reach") / effect::PLUME_LIFE;
            let ahead = cam.project([0, 1, 2].map(|k| centre[k] + a[k] * speed));
            let flow = match (at, ahead) {
                (Some(q), Some(r)) => [r[0] - q[0], r[1] - q[1]],
                _ => [0.0, 0.0],
            };
            settings.hazes.push(deep_effects_render::frame::Haze {
                item: o.id.clone(),
                params: std::collections::BTreeMap::from([
                    ("haze.strength".to_string(), json!(n("haze/strength"))),
                    (
                        "haze.cell".to_string(),
                        json!((n("haze/scale") * px_per_m).max(1.0)),
                    ),
                    ("haze.flow".to_string(), json!(flow)),
                    ("haze.rect".to_string(), json!(rect)),
                ]),
                seed: crate::effects::effect_seed(doc_seed, o, seeding),
            });
        }
        out.insert(o.id.clone(), json!({"box": rect}));
    }
    Ok(out)
}

/// #450: the document with each `draw: mesh` particles item's live particles at `t` (s) as the
/// columns of an instancer of its prototypes, `<item>_mesh`, in the item's layer and order: its
/// rows each live particle's slot, place, rotation and scale from the f64 closed form. `None`
/// when no item draws meshes, so the scene drawn first stands.
pub(crate) fn meshes(
    doc: &Value,
    scene: &Scene,
    t: f64,
    planted: Option<Planted>,
) -> Result<Option<Value>, Value> {
    let (plants, _, _) = plants(planted);
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let mut out: Option<Value> = None;
    for (id, item) in rule::items(doc) {
        let Some(m) = closed::draws::read(id, &item["params"])
            .map_err(|r| refusal(&r))?
            .mesh
        else {
            continue;
        };
        let held = baked(
            doc,
            scene,
            id,
            item_seed(doc_seed, id),
            plants,
            &mut Vec::new(),
        )
        .map_err(|r| refusal(&r))?;
        let b = &held.0;
        let now = b
            .surface
            .as_ref()
            .filter(|_| b.spec.follow)
            .map(|sf| sf.now(scene));
        let rows: Vec<(u32, closed::draws::Instance)> = (0..b.spec.count)
            .filter_map(|e| Some((e, closed::draws::instance(b, &m, e, t, now.as_deref())?)))
            .collect();
        let col = |f: &dyn Fn(&closed::draws::Instance) -> Value| {
            rows.iter().map(|(_, i)| f(i)).collect::<Vec<_>>()
        };
        let instancer = json!({"id": format!("{id}_mesh"), "kind": "instance@1", "layer": item["layer"], "order": item["order"],
            "params": {"of": m.of, "ids": rows.iter().map(|(e, _)| e).collect::<Vec<_>>(), "pos": col(&|i| json!(i.pos)),
                       "rot": col(&|i| json!(i.rot)), "scale": col(&|i| json!(i.scale)), "proto": col(&|i| json!(i.proto))}});
        let fed = out.get_or_insert_with(|| doc.clone());
        fed["items"][format!("{id}_mesh")] = instancer;
    }
    Ok(out)
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
