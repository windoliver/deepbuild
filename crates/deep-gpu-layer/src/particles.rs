//! #449: particles@1 items that use a closed-form field (emit regions, bursts, bounces, kill,
//! turbulence, landing), baked once per content key from the document and its evaluated scene
//! (deep_canvas_effects::particles::bake), then each frame packed into the closed-form kernel's
//! uniform and drawn as the shipped graph's items are.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::particles::bake::{self, Inputs};
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
fn issues_json(issues: &[deep_canvas::document::Issue]) -> Vec<Value> {
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
    crate::physics::bake(&mut doc)?;
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
    let scene =
        evaluate(&doc, 0, &look, &mut Labels::new()).map_err(|r| refused(r.code, r.path))?;
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
    let key = format!("{}{:?}", bake::key(&inputs, &spec), plants);
    if let Some(h) = BAKED.lock().unwrap_or_else(|e| e.into_inner()).get(&key) {
        return Ok(h.clone());
    }
    let b = bake::bake(&inputs)?;
    let tables = pack::tables(&b);
    let held: Held = Arc::new((b, tables));
    let mut kept = BAKED.lock().unwrap_or_else(|e| e.into_inner());
    if kept.len() >= KEPT {
        kept.clear();
    }
    kept.insert(key, held.clone());
    Ok(held)
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
/// three little-endian f64, an empty row as the byte 0; with how many rows are live.
fn evaluated(b: &Baked, t: f64, now: Option<&[[f64; 3]]>) -> (String, usize) {
    let cpu = eval::columns_on(b, t, now);
    let mut bytes = Vec::with_capacity(cpu.len() * 4);
    let mut live = 0;
    for row in cpu.chunks(eval::FLOATS) {
        if row[3] < 0.0 {
            bytes.push(0);
        } else {
            live += 1;
            bytes.push(1);
            for x in &row[..3] {
                bytes.extend(x.to_le_bytes());
            }
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
        if let Some(h) = &held {
            let (b, tables) = &**h;
            if extended {
                sp.count = b.spec.count;
                sp.closed = Some((
                    pack::uniform(b, t, tables, flags),
                    tables.words.clone(),
                    flat(now.as_deref()),
                ));
            }
            if cull {
                let pad = 0.5 * sp.size[0].max(sp.size[1]).max(1.0) * sp.size_px + 2.0;
                let reach = if sp.draw == 3 {
                    bounds::speed(b, t) / 30.0
                } else {
                    0.0
                };
                culled = bounds::bounds(b, t).is_none_or(|bx| outside(scene, bx, reach, pad));
            }
            if asked.contains(&sp.item.as_str()) {
                let (hash, live) = evaluated(b, t, now.as_deref());
                report.insert(
                    sp.item.clone(),
                    json!({"hash": hash, "live": live, "culled": culled}),
                );
            }
        }
        if !culled {
            kept.push(sp);
        }
    }
    settings.sparks = kept;
    DRAWN.lock().unwrap_or_else(|e| e.into_inner()).push(t);
    Ok((!asked.is_empty()).then_some(Value::Object(report)))
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
