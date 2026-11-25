//! #853: stepped particles in `view3d` (tests/acceptance/853/README.md: The surface under test).
//! Each `particles.stepped@1` item lowers to shipped stepped compute operators
//! (deep_canvas_effects::particles::stepped), the last of them under the item's own ID, so its
//! buffer is the carried output `<item>.buffer` wherever one is named. The boxes it collides with
//! are its world's static and kinematic bodies, a kinematic one where its follow channel puts it
//! at the step's own time.

use deep_canvas::document::Issue;
use deep_canvas_effects::particles::rule;
use deep_canvas_effects::particles::spec::Refusal;
use deep_canvas_effects::particles::stepped::{self as model, Collider, Plane, Reading};
use deep_canvas_physics::doc::{read as read_world, BodyKind, Rot, Shape};
use deep_effects_render::docops::DocOps;
use deep_gpu::device::Backend;
use deep_logic::world::{Entry, Given};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::view3d::FLICKS_PER_SECOND;
use crate::{App, Planted};

/// #853's wrong programs, by the names `--planted` takes: the particles advance once a frame
/// drawn by that frame's time; a particle is tested against the boxes only where its step ends.
pub(crate) const PLANTED: [&str; 2] = ["particles_step_by_frame_time", "particles_collide_at_end"];

pub(crate) fn planted(p: Option<Planted>) -> model::Planted {
    match p {
        Some(Planted::Named(name)) => model::Planted {
            by_frame_time: name == PLANTED[0],
            collide_at_end: name == PLANTED[1],
        },
        _ => model::Planted::default(),
    }
}

/// What of world `world` a step of item `id` tests: each static or kinematic body's box shapes
/// and each static body's plane shapes, unrotated; any other shape of such a body is refused,
/// naming the body.
fn solids(doc: &Value, id: &str, world: &str) -> Result<(Vec<Collider>, Vec<Plane>), Refusal> {
    let refuse = |what: String, actual: Value| {
        let path = format!("items/{id}/params/collide/world");
        Refusal::new("out_of_range", path, format!("{id}: {what}")).with(actual)
    };
    let Some(Ok(w)) = doc["worlds"].get(world).map(read_world) else {
        let what = format!("the document holds no world {world} it can read");
        return Err(refuse(what, json!(world)));
    };
    let unturned = |r: &Rot| match r {
        Rot::Quat(q) => q[..3] == [0.0; 3],
        Rot::Deg(d) => *d == [0.0; 3],
    };
    let (mut boxes, mut planes) = (Vec::new(), Vec::new());
    for (name, b) in &w.bodies {
        if !matches!(b.kind, BodyKind::Static | BodyKind::Kinematic) {
            continue;
        }
        for u in &b.shapes {
            let still = b.follow.is_none() || u.offset.pos == [0.0; 3];
            let straight = unturned(&b.pose.rot) && unturned(&u.offset.rot);
            let at: [f64; 3] = std::array::from_fn(|a| b.pose.pos[a] + u.offset.pos[a]);
            match w.shapes.get(&u.shape) {
                Some(Shape::Box { half }) if still && straight => boxes.push(Collider {
                    centre: at,
                    half: *half,
                    follow: b.follow.clone(),
                }),
                Some(Shape::Plane { normal }) if straight && b.follow.is_none() => {
                    let len = deep_canvas::ops::sqrt(normal.iter().map(|x| x * x).sum::<f64>());
                    let len = len.max(1e-12);
                    let normal = normal.map(|x| x / len);
                    let offset = (0..3).map(|a| normal[a] * at[a]).sum();
                    planes.push(Plane { normal, offset });
                }
                _ => {
                    let what = format!(
                        "body {name}'s shape {} is no unrotated box or static plane, the shapes a step tests",
                        u.shape
                    );
                    return Err(refuse(what, json!(name)));
                }
            }
        }
    }
    Ok((boxes, planes))
}

/// The document the view's operators are built from: `doc` with each stepped particles item
/// replaced by the operators it lowers to. A field out of its range, a world it can't test and
/// a logic item that names the buffer refuse the document, as the check refuses any.
pub(crate) fn operators(doc: &Value, p: Option<Planted>) -> Result<Value, Value> {
    let mut out = doc.clone();
    let seed = doc["seed"].as_u64().unwrap_or(0);
    let mut issues = Vec::new();
    for (id, item) in model::items(doc) {
        let lowered = model::read(doc, id, item).and_then(|mut s| {
            let none = Ok((Vec::new(), Vec::new()));
            let (boxes, planes) = s.world.as_ref().map_or(none, |w| solids(doc, id, w))?;
            s.planes.extend(planes);
            let seed = model::seed_of(seed, id);
            match model::fits(id, &s, &boxes) {
                Some(r) => Err(r),
                None => Ok(model::lower(id, &s, &boxes, seed, planted(p))),
            }
        });
        match lowered {
            Ok(ops) => ops
                .into_iter()
                .for_each(|(op, item)| out["items"][op.as_str()] = item),
            Err(r) => issues.push(rule::issue(id, &r)),
        }
        // A logic item reads particles through a published reading, never the buffer.
        let buffer = format!("{id}.{}", model::BUFFER);
        for (logic, l) in doc["items"].as_object().into_iter().flatten() {
            let reads = l["params"]["reads"]
                .as_array()
                .filter(|_| l["kind"] == "logic@1");
            for (k, r) in reads.into_iter().flatten().enumerate() {
                if r.as_str() == Some(buffer.as_str()) {
                    let what = format!("{logic} reads {buffer}, the particles' buffer: a logic item reads stepped particles only through a reading {id} publishes");
                    let path = format!("items/{logic}/params/reads/{k}");
                    let mut i = Issue::error("particles_buffer", logic, path, r.clone(), &what);
                    i.ids.push(id.clone());
                    issues.push(i);
                }
            }
        }
    }
    if issues.is_empty() {
        return Ok(out);
    }
    Err(json!({"code": "refused", "issues": super::issues_json(&issues)}))
}

/// Each stepped item of `doc` that publishes readings, with them in the order its operator
/// counts them and its step rate.
fn readings(doc: &Value) -> Vec<(String, Vec<Reading>, u64)> {
    let named = |(id, item): (&String, &Value)| {
        let s = model::read(doc, id, item).ok()?;
        (!s.readings.is_empty()).then(|| (id.clone(), s.readings, u64::from(s.rate)))
    };
    model::items(doc).into_iter().filter_map(named).collect()
}

/// Publishes what the document's logic items read of its stepped particles: the items' steps
/// run now on the view's device over the transport's span, each reading read back after its
/// step and kept in `doc` for the logic bake, which runs before any frame draws.
pub(crate) fn publish(app: &App, doc: &mut Value, operators: &Value) {
    let logic = doc["items"].as_object().into_iter().flatten();
    let reads: Vec<&str> = logic
        .filter(|(_, l)| l["kind"] == "logic@1")
        .flat_map(|(_, l)| l["params"]["reads"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .collect();
    let read = |id: &str, r: &Reading| reads.contains(&format!("{id}.{}", r.name).as_str());
    let wanted: Vec<_> = readings(doc)
        .into_iter()
        .filter(|(id, of, _)| of.iter().any(|r| read(id, r)))
        .collect();
    let live = app.backend != Backend::Noop;
    let Some(rate) = wanted.first().map(|w| w.2).filter(|_| live) else {
        return;
    };
    let span = doc.pointer("/transport/span").cloned().unwrap_or(json!(0));
    let span = deep_canvas::document::duration(doc, &span)
        .unwrap_or(0)
        .max(0) as u64;
    let steps = span * rate / FLICKS_PER_SECOND + 1;
    let (options, check) = crate::effects::operator_plants(app.planted);
    let hooks = crate::effects::operator_hooks(app.planted);
    let ops_doc = operators.clone();
    let published = app.worker.call(move |state| {
        let device = state.gpu.device();
        let none = BTreeMap::new();
        let mut ops = DocOps::with(&device, &ops_doc, options, check, &[], hooks, none);
        let mut values: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for s in 0..steps {
            ops.step_to(&device, s);
            for (id, of, _) in &wanted {
                let Some(b) = ops.buffer_of(&model::readings_op(id), model::COUNTS) else {
                    continue;
                };
                let bytes = crate::opframe::read_buffer(&device, b, 4 * of.len() as u64);
                let words: Vec<u32> = (bytes.as_chunks::<4>().0.iter())
                    .map(|w| u32::from_le_bytes(*w))
                    .collect();
                for (r, four) in of.iter().zip(words.chunks(4)) {
                    let value = match r.centroid {
                        true => json!(r.centre(four)),
                        false => json!(four[0]),
                    };
                    values
                        .entry(format!("{id}.{}", r.name))
                        .or_default()
                        .push(value);
                }
            }
        }
        let row = |(name, v): (String, Vec<Value>)| (name, json!({"rate": rate, "values": v}));
        values.into_iter().map(row).collect::<Map<String, Value>>()
    });
    doc["published"] = Value::Object(published);
}

/// For the logic bake: the names its items may read a published count by, those of a published
/// centroid, and each value as an entry at its step's time, so a logic step reads the one
/// published before its own time.
pub(crate) fn published(doc: &Value) -> (Vec<String>, Vec<String>, Vec<Entry>) {
    let (mut counts, mut centres) = (Vec::new(), Vec::new());
    for (id, of, _) in readings(doc) {
        for r in of {
            let names = if r.centroid {
                &mut centres
            } else {
                &mut counts
            };
            names.push(format!("{id}.{}", r.name));
        }
    }
    let mut entries = Vec::new();
    for (name, p) in doc["published"].as_object().into_iter().flatten() {
        let rate = p["rate"].as_i64().unwrap_or(60).max(1);
        for (s, v) in p["values"].as_array().into_iter().flatten().enumerate() {
            let value = match v.as_array() {
                Some(a) => Given::Vector(a.iter().filter_map(Value::as_f64).collect()),
                None => Given::Number(v.as_f64().unwrap_or(0.0)),
            };
            entries.push(Entry {
                t: s as i64 * FLICKS_PER_SECOND as i64 / rate,
                seq: 0,
                control: name.clone(),
                value,
                writer: "particles".into(),
                player: 1,
                as_of: None,
                arrived: 0,
            });
        }
    }
    (counts, centres, entries)
}

/// Where a call's store keeps stepped particles' bakes, if it names one, and whether the call is
/// an export.
fn store_of(call: &Value) -> (Option<PathBuf>, bool) {
    let dir = call["store"]
        .as_str()
        .map(|s| Path::new(s).join("particles.stepped"));
    let export = matches!(call["class"].as_str(), Some("export" | "render_back"));
    (dir, export)
}

/// The bake of each stepped item of a call: the buffer at each frame time the call draws, each
/// kept by its SHA-256, under a key of the document and the item, with the fingerprint of the
/// machine that recorded it. A live call with a store records it, its items' steps run on the
/// view's device before any frame draws; an export reads it on any machine and never steps, and
/// with no bake under its key answers `no_bake`, naming the key. `doc` takes each item's key,
/// and in an export its steps' hashes.
pub(crate) fn bake(
    app: &App,
    call: &Value,
    doc: &mut Value,
    operators: &Value,
) -> Result<(), Value> {
    let rates: Vec<(String, u64)> = model::items(doc)
        .into_iter()
        .map(|(id, i)| {
            let rate = i["params"]["step_rate"].as_u64().unwrap_or(60).max(1);
            (id.clone(), rate)
        })
        .collect();
    let (dir, export) = store_of(call);
    if rates.is_empty() || app.backend == Backend::Noop || (dir.is_none() && !export) {
        return Ok(());
    }
    let text = doc.to_string();
    let key = |id: &str| crate::frames::hex(format!("{text}\n{id}").as_bytes());
    let manifest = |dir: &Path, id: &str| dir.join(format!("{}.json", key(id)));
    let mut bakes = Map::new();
    if export {
        for (id, _) in &rates {
            let held = dir
                .as_ref()
                .and_then(|d| std::fs::read(manifest(d, id)).ok());
            let Some(m) = held.and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
                return Err(json!({"code": "no_bake", "key": key(id)}));
            };
            let bake = json!({"key": key(id), "steps": m["steps"]});
            bakes.insert(format!("{id}.{}", model::BUFFER), bake);
        }
        doc["bakes"] = Value::Object(bakes);
        return Ok(());
    }
    let Some(dir) = dir else {
        return Ok(());
    };
    let failed = |e: String| crate::refused("no_store", format!("store: {e}"));
    std::fs::create_dir_all(&dir).map_err(|e| failed(e.to_string()))?;
    let from = call["from"].as_u64().unwrap_or(0);
    let frames = call["frames"].as_u64().unwrap_or(1).max(1);
    let fps = call["fps"].as_u64().unwrap_or(60).max(1);
    let (options, check) = crate::effects::operator_plants(app.planted);
    let hooks = crate::effects::operator_hooks(app.planted);
    let (ops_doc, items, files) = (operators.clone(), rates.clone(), dir.clone());
    let steps = app.worker.call(
        move |state| -> Result<BTreeMap<String, Map<String, Value>>, String> {
            let device = state.gpu.device();
            let mut ops = DocOps::with(
                &device,
                &ops_doc,
                options,
                check,
                &[],
                hooks,
                BTreeMap::new(),
            );
            let mut steps: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
            for n in from..from + frames {
                for (id, rate) in &items {
                    let step = (n as f64 / fps as f64 * *rate as f64 + 1e-6).floor() as u64;
                    ops.step_to(&device, step);
                    let Some(b) = ops.buffer_of(id, model::BUFFER) else {
                        continue;
                    };
                    let bytes = crate::opframe::read_buffer(&device, b, b.size() / 4);
                    let sha = crate::frames::hex(&bytes);
                    let path = files.join(format!("{sha}.bin"));
                    if !path.exists() {
                        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
                    }
                    steps
                        .entry(id.clone())
                        .or_default()
                        .insert(step.to_string(), json!(sha));
                }
            }
            Ok(steps)
        },
    );
    for (id, held) in steps.map_err(failed)? {
        // The manifest lands whole or not at all: an export finds a bake only through it.
        let part = dir.join(format!("{}.part", key(&id)));
        let recorded = json!({"fingerprint": crate::golden::fingerprint(app), "steps": held});
        let written = std::fs::write(&part, recorded.to_string())
            .and_then(|()| std::fs::rename(&part, manifest(&dir, &id)));
        written.map_err(|e| failed(e.to_string()))?;
        bakes.insert(format!("{id}.{}", model::BUFFER), json!({"key": key(&id)}));
    }
    doc["bakes"] = Value::Object(bakes);
    Ok(())
}

/// A baked buffer's bytes and the step they are.
type Baked = (Arc<Vec<u8>>, u64);

/// In an export, the buffer item `id`'s bake holds for the frame at `t` s, with its step.
pub(crate) fn baked(doc: &Value, call: &Value, id: &str, t: f64) -> Result<Option<Baked>, Value> {
    let bake = &doc["bakes"][format!("{id}.{}", model::BUFFER)];
    let (dir, export) = store_of(call);
    let (Some(dir), true, true) = (dir, export, bake.is_object()) else {
        return Ok(None);
    };
    let rate = doc["items"][id]["params"]["step_rate"]
        .as_u64()
        .unwrap_or(60)
        .max(1);
    let step = (t * rate as f64 + 1e-6).floor() as u64;
    let sha = bake["steps"][step.to_string()].as_str();
    match sha.and_then(|sha| std::fs::read(dir.join(format!("{sha}.bin"))).ok()) {
        Some(bytes) => Ok(Some((Arc::new(bytes), step))),
        None => Err(json!({"code": "no_bake", "key": bake["key"]})),
    }
}

/// The reply's `bakes`: the key each stepped item's bake is kept under.
pub(crate) fn report(doc: &Value, reply: &mut Value) {
    let bakes = doc["bakes"].as_object().into_iter().flatten();
    let keys: Map<String, Value> = bakes
        .map(|(k, b)| (k.clone(), json!({"key": b["key"]})))
        .collect();
    if !keys.is_empty() {
        reply["bakes"] = Value::Object(keys);
    }
}
