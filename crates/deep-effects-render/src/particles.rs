//! #449: particles@1 items that use a closed-form field (emit regions, bursts, bounces, kill,
//! turbulence, landing), baked once per content key from the document and its evaluated scene
//! (deep_canvas_effects::particles::bake), then each frame packed into the closed-form kernel's
//! uniform and drawn as the shipped graph's items are; and #508's film effects, whose particles,
//! footprints and hazes join a frame's settings here. Every host of a 3D frame reads them (#1719).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::particles::bake::{self, Inputs};
use deep_canvas_effects::particles::draws::Ribbon;
use deep_canvas_effects::particles::eval::{self, Baked};
use deep_canvas_effects::particles::pack::{self, Tables};
use deep_canvas_effects::particles::{self as closed, bounds, rule, spec::Refusal, Planted};
use deep_canvas_scene3d::scene::{Other, Scene};
use serde_json::{json, Map, Value};

use crate::docops::item_seed;
use crate::frame::Settings;
use crate::scene::{effect_seed, item_pos, resampled, Seeding};

/// Flicks a second (Units and axes: time).
const FLICKS: f64 = 705_600_000.0;

/// What a frame's host adds to its particles: nothing, or a proof surface's planted programs and
/// its report on each item.
pub trait Host {
    fn plants(&self) -> Planted {
        Planted::default()
    }
    /// The closed-form kernel's flag word.
    fn flags(&self) -> u32 {
        0
    }
    /// Whether an item whose closed-form bounds lie outside the view is culled.
    fn culls(&self) -> bool {
        true
    }
    /// The bake `o` draws at `t` (s) with, from the one it has.
    fn held(&mut self, held: Held, _scene: &Scene, _o: &Other, _t: f64) -> Held {
        held
    }
    /// An item readied, with its bake, the surface it follows and its ribbon.
    fn readied(
        &mut self,
        _id: &str,
        _b: &Baked,
        _now: Option<&[[f64; 3]]>,
        _r: Option<&Ribbon>,
        _culled: bool,
    ) {
    }
}

/// A host with nothing to add.
pub struct Plain;

impl Host for Plain {}

/// #508: a plume's and an airflow's particles follow their effect's params as evaluated at t, so
/// a driver on a reach, a heat or a speed moves them: each particles item `effect::lower` wrote
/// takes the params its effect's evaluated params lower to (an airflow's paths read from `doc`).
/// The bake, the draw, the footprint and the readings all read them from the scene. A driven
/// value out of its range refuses the frame as view3d refuses such a document, naming the field.
pub fn follow_effects(scene: &mut Scene, doc: &Value) -> Result<(), Value> {
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

/// Vertices as the kernel's `now` buffer reads them.
pub fn flat(v: Option<&[[f64; 3]]>) -> Vec<f32> {
    v.into_iter()
        .flatten()
        .flatten()
        .map(|x| *x as f32)
        .collect()
}

/// A bake and its packed tables.
pub type Held = Arc<(Baked, Tables)>;

/// Bakes kept by content key, so a frame packs only its uniform.
static BAKED: Mutex<BTreeMap<String, Held>> = Mutex::new(BTreeMap::new());

/// At most this many bakes are kept.
const KEPT: usize = 16;

/// #265: each world-space emitter's anchors, by item, anchor, span and document hash.
static ANCHORS: Mutex<BTreeMap<String, eval::Anchors>> = Mutex::new(BTreeMap::new());

/// Item `id`'s bake: kept, or baked now with every particles item it bursts at baked first; a
/// chain of `emit.on.particles` that comes back to an item is refused, naming its items.
pub fn baked(
    doc: &Value,
    scene: &Scene,
    id: &str,
    seed: u32,
    plants: Planted,
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
        // #265: the anchors are the document's, whatever frame asks: kept by its hash, so a
        // moving anchor that rekeys the bake each frame never reads its buckets again.
        let kept = format!("{id}#{anchor}#{}#{moved}", spec.span);
        let held = ANCHORS
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&kept)
            .cloned();
        b.anchors = Some(match held {
            Some(a) => a,
            None => {
                let a = anchors(doc, id, anchor, spec.span)?;
                let mut all = ANCHORS.lock().unwrap_or_else(|e| e.into_inner());
                if all.len() >= KEPT {
                    all.clear();
                }
                all.insert(kept, a.clone());
                a
            }
        });
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

/// A world-space emitter's anchor at each birth bucket of the document's span: its place at
/// each whole multiple of its frame interval, through the chain a trail reads (channels, drivers
/// reading a logic bake, constraints, a physics bake's outputs), never a pose kept from a frame
/// and never a whole scene evaluated for it (#265).
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
    let map = doc
        .as_object()
        .ok_or_else(|| bad(format!("{id}: the document isn't an object")))?;
    let times: Vec<i64> = (0..n as i64).map(|k| k * per).collect();
    let at = deep_canvas_scene3d::trail::places(map, anchor, &times).map_err(|r| {
        bad(format!(
            "{id}: emit.anchor names {anchor}, which isn't placed ({}: {})",
            r.code, r.path
        ))
    })?;
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

/// Readies a frame's particles at `t`: every closed-form item in `settings` gets its frame's
/// words (the rest keep the shipped graph), and an item whose closed-form bounds, grown by its
/// sprites' size, lie outside the view is culled: neither dispatched nor drawn, unless `host`
/// culls nothing.
pub fn frame(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    host: &mut dyn Host,
) -> Result<(), Refusal> {
    let (plants, flags) = (host.plants(), host.flags());
    let mut kept = Vec::new();
    for mut sp in std::mem::take(&mut settings.sparks) {
        // #853: a stepped item's draw reads its own operator's rows, never a closed form.
        let closed_form = |o: &&Other| o.id == sp.item && sp.rows.is_none();
        let Some(o) = scene.others.iter().find(closed_form) else {
            kept.push(sp);
            continue;
        };
        let extended = closed::extended(&o.params);
        // A closed-form item's bake refuses the frame; a shipped-graph item it can't read is
        // drawn without culling, as before.
        let held = match baked(doc, scene, &sp.item, sp.seed, plants, &mut Vec::new()) {
            Ok(h) => Some(host.held(h, scene, o, t)),
            Err(r) if extended => return Err(r),
            Err(_) => None,
        };
        let mut culled = false;
        let now = held
            .as_ref()
            .and_then(|h| h.0.surface.as_ref().filter(|_| h.0.spec.follow))
            .map(|sf| sf.now(scene));
        // #450: a ribbon's rows back along its length, one dispatch a segment end.
        let ribbon = closed::draws::read(&sp.item, &o.params)?.ribbon;
        if let Some(h) = &held {
            let (b, tables) = &**h;
            let now = now.as_deref();
            if extended {
                sp.count = b.spec.count;
                let uniforms = match &ribbon {
                    Some(r) => pack::ribbon(b, r, t, tables, flags, true),
                    None => vec![pack::uniform(b, t, tables, flags)],
                };
                sp.ribbon = ribbon
                    .as_ref()
                    .map(|r| (r.segments, r.width, r.taper, r.fade));
                // Its rows draw as a ribbon's quads, never as sprites (particles.wgsl: kind 4).
                if sp.ribbon.is_some() {
                    sp.draw = 4;
                }
                sp.closed = Some((uniforms, tables.words.clone(), flat(now)));
            }
            if host.culls() {
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
            host.readied(&sp.item, b, now, ribbon.as_ref(), culled);
        }
        // A mesh draw's particles draw as its instancer's elements (#450), never as sprites.
        let mesh = closed::draws::read(&sp.item, &o.params).is_ok_and(|d| d.mesh.is_some());
        if !culled && !mesh {
            kept.push(sp);
        }
    }
    settings.sparks = kept;
    Ok(())
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
pub fn effects(
    settings: &mut Settings,
    doc: &Value,
    scene: &Scene,
    t: f64,
    plants: Planted,
    seeding: Seeding,
) -> Result<Map<String, Value>, Refusal> {
    use deep_canvas_effects::effect;
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
                    let held = baked(doc, scene, &sp.item, sp.seed, plants, &mut Vec::new())?;
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
            settings.hazes.push(crate::frame::Haze {
                item: o.id.clone(),
                params: BTreeMap::from([
                    ("haze.strength".to_string(), json!(n("haze/strength"))),
                    (
                        "haze.cell".to_string(),
                        json!((n("haze/scale") * px_per_m).max(1.0)),
                    ),
                    ("haze.flow".to_string(), json!(flow)),
                    ("haze.rect".to_string(), json!(rect)),
                ]),
                seed: effect_seed(doc_seed, o, seeding),
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
pub fn meshes(
    doc: &Value,
    scene: &Scene,
    t: f64,
    plants: Planted,
) -> Result<Option<Value>, Refusal> {
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let mut out: Option<Value> = None;
    for (id, item) in rule::items(doc) {
        let Some(m) = closed::draws::read(id, &item["params"])?.mesh else {
            continue;
        };
        let held = baked(
            doc,
            scene,
            id,
            item_seed(doc_seed, id),
            plants,
            &mut Vec::new(),
        )?;
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
