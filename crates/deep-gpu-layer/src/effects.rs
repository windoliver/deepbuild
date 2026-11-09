//! Issue #380's calls (tests/acceptance/380/README.md, The surface under test): the shipped
//! effects' settings from a look, a scene and a session's selection; `operators`, `reference`,
//! `check_operator`, `op`, `exact` and `cross_gpu`.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use deep_canvas::ops;
use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{self, Class, Kind, Tex, Ty};
use deep_canvas_effects::interp::{self, hash1, Image};
use deep_canvas_effects::{check, shipped};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene};
use deep_effects_render::compile::{compile_planted, compile_with, validate, Compiled};
use deep_effects_render::frame::{self as fx, Settings, Sparks};
use deep_effects_render::reference::{self, Camera};
use deep_effects_render::runner::{dispatch, Frame, Runner, LINEAR};
use deep_gpu::device::Device;
use deep_scene3d_render::{draw_offscreen, Planted as Planted3, Post, PostFrame, Renderer};
use serde_json::{json, Map, Value};

use crate::frames::hex;
use crate::view3d::write_named;
use crate::{refused, App, Planted};

/// An item's seed: a hash of the document's seed and its ID (Effect: `seed: item`).
pub fn item_seed(doc_seed: u64, id: &str) -> u32 {
    let mut h = hash1(doc_seed as u32) ^ hash1((doc_seed >> 32) as u32 ^ 0x9e37_79b9);
    for b in id.bytes() {
        h = hash1(h ^ u32::from(b));
    }
    h
}

/// How the shipped noise is keyed: by the item's seed, or (planted) by the session's frame
/// counter or the clock.
#[derive(Clone, Copy, Debug)]
pub enum Seeding {
    Item,
    FrameCounter(u64),
    Clock,
}

impl Seeding {
    fn key(self, seed: u32) -> u32 {
        match self {
            Seeding::Item => seed,
            Seeding::FrameCounter(n) => hash1(seed ^ n as u32),
            Seeding::Clock => {
                let ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u32);
                hash1(seed ^ ms)
            }
        }
    }
}

pub fn linear_of(c: [u8; 3]) -> [f64; 3] {
    c.map(|v| {
        let x = f64::from(v) / 255.0;
        if x <= 0.04045 {
            x / 12.92
        } else {
            ops::pow((x + 0.055) / 1.055, 2.4)
        }
    })
}

fn role(look: &Look3, name: Option<&str>, fallback: &str) -> [f64; 3] {
    let c = name
        .and_then(|n| look.role(n))
        .or_else(|| look.role(fallback))
        .unwrap_or([128, 128, 128]);
    linear_of(c)
}

fn pair(v: Option<&Value>, default: [f64; 2]) -> [f64; 2] {
    match v {
        Some(Value::Number(n)) => {
            let x = n.as_f64().unwrap_or(default[0]);
            [x, x]
        }
        Some(Value::Array(a)) => [
            a.first().and_then(Value::as_f64).unwrap_or(default[0]),
            a.get(1).and_then(Value::as_f64).unwrap_or(default[1]),
        ],
        _ => default,
    }
}

/// Where an item stands in world metres: a solid's origin, another module's item's, or none.
fn item_pos(scene: &Scene, id: &str) -> Option<[f64; 3]> {
    let id = id.split('#').next().unwrap_or(id);
    scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .find(|s| s.id == id)
        .map(|s| [s.model[0][3], s.model[1][3], s.model[2][3]])
        .or_else(|| scene.others.iter().find(|o| o.id == id).map(|o| o.pos))
}

/// A curve's samples resampled to [`shipped::CURVE_POINTS`] points evenly by arc length, and
/// its length.
fn resampled(points: &[[f64; 3]]) -> (Vec<[f64; 3]>, f64) {
    let n = shipped::CURVE_POINTS as usize;
    let seg = |a: [f64; 3], b: [f64; 3]| {
        ops::sqrt((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2) + (b[2] - a[2]).powi(2))
    };
    let total: f64 = points.windows(2).map(|w| seg(w[0], w[1])).sum();
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let mut left = total * k as f64 / (n - 1) as f64;
        let mut at = *points.last().unwrap_or(&[0.0; 3]);
        for w in points.windows(2) {
            let d = seg(w[0], w[1]);
            if left <= d && d > 0.0 {
                let f = left / d;
                at = [0, 1, 2].map(|i| w[0][i] + (w[1][i] - w[0][i]) * f);
                break;
            }
            left -= d;
        }
        out.push(at);
    }
    (out, total)
}

/// A channel over life (Particles: `size, opacity: channels over life`): a number, `[birth,
/// death]`, or keys `[{at, value}]`, as its values at birth and at death.
fn over_life(v: Option<&Value>, default: f64) -> [f64; 2] {
    match v {
        Some(Value::Array(keys)) if keys.iter().all(Value::is_object) && !keys.is_empty() => {
            let at = |k: &Value| k["value"].as_f64().unwrap_or(default);
            [at(&keys[0]), at(&keys[keys.len() - 1])]
        }
        other => pair(other, [default, default]),
    }
}

/// One particles@1 item as the operator and the draw read it: its emitter, motion, life and
/// look over life (Particles `particles@1`; #420).
fn sparks_of(
    scene: &Scene,
    o: &deep_canvas_scene3d::scene::Other,
    look: &Look3,
    seed: u32,
) -> Sparks {
    let p = &o.params;
    let emit = &p["emit"];
    let count = p["count"]
        .as_u64()
        .unwrap_or(256)
        .min(u64::from(shipped::MAX_PARTICLES_SHOWPIECE)) as u32;
    let life = pair(p.get("life"), [1.0, 1.0]);
    let motion = p["motion"]
        .as_object()
        .and_then(|m| m.keys().next().cloned())
        .unwrap_or_else(|| "ballistic".into());
    let m = &p["motion"][&motion];
    let ballistic = &p["motion"]["ballistic"];
    let v0 = pair(ballistic.get("v0"), [1.0, 2.0]);
    let origin = emit["anchor"]
        .as_str()
        .and_then(|a| item_pos(scene, a))
        .unwrap_or(o.pos);
    // The emitter's shape, and the curve it or the motion runs along.
    let (shape, shape_curve) = match &emit["shape"] {
        Value::Object(s) => match s.get("along").and_then(Value::as_str) {
            Some(c) => (3, Some(c.to_string())),
            None => (0, None),
        },
        Value::String(s) => (
            shipped::SHAPES.iter().position(|x| x == s).unwrap_or(0) as u32,
            None,
        ),
        _ => (0, None),
    };
    let curve_id = m["curve"].as_str().map(str::to_string).or(shape_curve);
    let (curve, curve_len) = curve_id
        .and_then(|c| scene.curves.get(&c))
        .map(|pts| resampled(pts))
        .unwrap_or((vec![origin; shipped::CURVE_POINTS as usize], 0.0));
    let code = shipped::MOTIONS
        .iter()
        .position(|x| *x == motion)
        .unwrap_or(0) as u32;
    let mut stops: Vec<(f64, [f64; 3])> = p["color"]
        .as_array()
        .map(|c| {
            c.iter()
                .take(4)
                .map(|k| {
                    (
                        k["at"].as_f64().unwrap_or(0.0),
                        role(look, k["role"].as_str(), "accent"),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    if stops.is_empty() {
        stops.push((0.0, role(look, None, "accent")));
    }
    let params = BTreeMap::from([
        ("particles.count".to_string(), json!(count)),
        (
            "particles.rate".to_string(),
            json!(emit["rate"].as_f64().unwrap_or(100.0)),
        ),
        (
            "particles.span".to_string(),
            json!(emit["span"].as_f64().unwrap_or(1e9)),
        ),
        ("particles.life_min".to_string(), json!(life[0])),
        ("particles.life_max".to_string(), json!(life[1])),
        ("particles.v0_min".to_string(), json!(v0[0])),
        ("particles.v0_max".to_string(), json!(v0[1])),
        (
            "particles.drag".to_string(),
            json!(ballistic["drag"].as_f64().unwrap_or(0.0)),
        ),
        (
            "particles.gravity".to_string(),
            ballistic
                .get("gravity")
                .cloned()
                .unwrap_or(json!([0.0, -9.8, 0.0])),
        ),
        ("particles.origin".to_string(), json!(origin)),
        ("particles.motion".to_string(), json!(code)),
        ("particles.shape".to_string(), json!(shape)),
        (
            "particles.radius".to_string(),
            json!(emit["radius"].as_f64().unwrap_or(0.25)),
        ),
        ("particles.curve".to_string(), json!(curve)),
        ("particles.curve_len".to_string(), json!(curve_len)),
        (
            "particles.speed".to_string(),
            json!(m["speed"].as_f64().unwrap_or(1.0)),
        ),
        (
            "particles.axis".to_string(),
            m.get("axis").cloned().unwrap_or(json!([0.0, 1.0, 0.0])),
        ),
        (
            "particles.spin".to_string(),
            json!(ops::rad(m["rate"].as_f64().unwrap_or(0.0))),
        ),
        (
            "particles.amplitude".to_string(),
            json!(m["amplitude"].as_f64().unwrap_or(0.0)),
        ),
        (
            "particles.frequency".to_string(),
            json!(m["frequency"].as_f64().unwrap_or(0.0)),
        ),
    ]);
    let draw = ["dot", "spark", "puff", "streak"]
        .iter()
        .position(|d| Some(*d) == p["draw"].as_str())
        .unwrap_or(0) as u32;
    Sparks {
        item: o.id.clone(),
        params,
        count,
        seed,
        size_px: 1.0,
        // Sparks are emissive, bright enough to glow.
        opacity: 4.0,
        size: over_life(p.get("size"), 3.0),
        fade: over_life(p.get("opacity"), 1.0),
        stops,
        draw,
        half: draw == 2 && p["resolution"].as_str() != Some("full"),
    }
}

/// A particles@1 item whose count is past its class's limit (Particles `particles@1`:
/// `count: u32 ≤ 65,536`, or ≤ 1,048,576 in a showpiece or an export), by its path.
pub fn count_refusal(scene: &Scene, class: Option<&str>) -> Option<String> {
    let limit = match class {
        Some("showpiece" | "export") => shipped::MAX_PARTICLES_SHOWPIECE,
        _ => shipped::MAX_PARTICLES,
    };
    scene
        .others
        .iter()
        .filter(|o| o.kind == "particles@1")
        .find(|o| {
            o.params["count"]
                .as_u64()
                .is_some_and(|c| c > u64::from(limit))
        })
        .map(|o| format!("items/{}/params/count", o.id))
}

/// The wrong programs the effects run under (frame::Planted).
pub fn planted_fx(p: Option<Planted>) -> fx::Planted {
    fx::Planted {
        without_karis: p == Some(Planted::BloomWithoutKaris),
        off_by_two: p == Some(Planted::PassOffByTwo),
        slow_glow: p == Some(Planted::SlowGlow),
        dirt_overlay: p == Some(Planted::DirtOverlay),
        block_copy: p == Some(Planted::PuffBlockCopy),
    }
}

/// The bloom's lens dirt image (#418) when `seeded`: made from `seed` (the look's, else the
/// document's), its low 32 bits, once per seed and kept; `None` otherwise.
fn dirt_of(dirt: &Value, seed: u64) -> Option<Arc<Image>> {
    static SEEDED: Mutex<BTreeMap<u32, Arc<Image>>> = Mutex::new(BTreeMap::new());
    if dirt["texture"] != "seeded" {
        return None;
    }
    let seed = seed as u32;
    let mut held = SEEDED.lock().unwrap_or_else(|e| e.into_inner());
    Some(
        held.entry(seed)
            .or_insert_with(|| Arc::new(deep_canvas_effects::dirt::seeded(seed)))
            .clone(),
    )
}

/// The settings the look, the scene and the session's selection give a frame at `t`.
pub fn settings(
    scene: &Scene,
    look_json: &Value,
    look: &Look3,
    selection: &[String],
    t: f64,
    doc_seed: u64,
    seeding: Seeding,
) -> Settings {
    let mut roles = BTreeMap::new();
    let ground = &look_json["ground_3d"];
    let grid = (ground["kind"] == "grid").then(|| {
        let r = &ground["roles"];
        roles.insert(
            "grid_minor".into(),
            role(look, r["minor"].as_str(), "muted"),
        );
        roles.insert("grid_major".into(), role(look, r["major"].as_str(), "ink"));
        roles.insert("grid_axis".into(), role(look, r["axis"].as_str(), "accent"));
        let eye = scene.camera.eye;
        // `auto` fades at the view's bounds: three times the eye's distance from the origin.
        let fade = ground["fade"].as_f64().unwrap_or_else(|| {
            (3.0 * ops::sqrt(eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2])).max(10.0)
        });
        BTreeMap::from([
            (
                "ground_3d.height".to_string(),
                json!(ground["height"].as_f64().unwrap_or(0.0)),
            ),
            (
                "ground_3d.spacing".to_string(),
                json!(ground["spacing"].as_f64().unwrap_or(1.0)),
            ),
            (
                "ground_3d.major_every".to_string(),
                json!(ground["major_every"].as_u64().unwrap_or(10)),
            ),
            (
                "ground_3d.width".to_string(),
                json!(ground["width"].as_f64().unwrap_or(1.0)),
            ),
            ("ground_3d.fade".to_string(), json!(fade)),
        ])
    });
    // A scene of materials shades the sun's shadow through its cascades instead (#422).
    let shadow = scene
        .sun
        .as_ref()
        .filter(|s| s.shadow && !scene.cascaded())
        .map(|s| (BTreeMap::new(), seeding.key(item_seed(doc_seed, &s.id))));
    let sparks = scene
        .others
        .iter()
        .filter(|o| o.kind == "particles@1")
        .map(|o| sparks_of(scene, o, look, seeding.key(item_seed(doc_seed, &o.id))))
        .collect();
    roles.insert("selection".into(), role(look, Some("selection"), "accent"));
    let bloom = look_json["bloom"].as_object().map(|b| {
        b.iter()
            .map(|(k, v)| (format!("bloom.{k}"), v.clone()))
            .collect::<BTreeMap<_, _>>()
    });
    let dirt = bloom
        .as_ref()
        .and_then(|b| b.get("bloom.dirt"))
        .and_then(|d| dirt_of(d, look_json["seed"].as_u64().unwrap_or(doc_seed)));
    Settings {
        grid,
        shadow,
        sparks,
        selection: selection.to_vec(),
        outline_width: 2,
        bloom,
        dirt,
        roles,
        t,
    }
}

/// The shipped operators: each one's kind, effect, determinism (the weakest of its stages'),
/// whether it draws noise, and the shaders it ports (none: every graph is written here).
pub fn operators(app: &App) -> Value {
    let karis = app.planted != Some(Planted::BloomWithoutKaris);
    let list: Vec<Value> = shipped::library(karis)
        .iter()
        .map(|s| {
            let class = s
                .stages
                .iter()
                .filter_map(|g| check::read_and_check(g).ok().map(|c| c.class))
                .max()
                .unwrap_or(Class::SameMachine);
            json!({
                "name": s.name,
                "kind": s.kind.name(),
                "origin": "shipped",
                "effect": s.effect,
                "determinism": class.name(),
                "noise": s.noise,
                "ported": [],
                "fixture": null,
            })
        })
        .collect();
    json!({"operators": list})
}

/// Records a frame for the reference call's inputs, asking for the shadow map when the sun casts.
struct ShadowOnly(bool);

impl Post for ShadowOnly {
    fn shadows(&self) -> bool {
        self.0
    }

    fn jobs(
        &mut self,
        _: &Device,
        _: &PostFrame<'_>,
    ) -> (
        Vec<(String, deep_gpu::encode::Job)>,
        Option<wgpu::TextureView>,
    ) {
        (Vec::new(), None)
    }
}

fn f32_image(bytes: &[u8], size: [u32; 2], lanes: usize) -> Image {
    let mut img = Image::new(size[0], size[1]);
    for (i, px) in img.px.iter_mut().enumerate() {
        for (c, v) in px.iter_mut().take(lanes).enumerate() {
            let o = (i * lanes + c) * 4;
            if let Some(b) = bytes.get(o..o + 4) {
                *v = f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]]));
            }
        }
    }
    img
}

fn f32_file(img: &Image) -> Vec<u8> {
    img.px
        .iter()
        .flat_map(|p| p.iter().flat_map(|v| (*v as f32).to_le_bytes()))
        .collect()
}

/// A frame's inputs at the effects' place: the linear target, depth, object IDs and the shadow
/// map, the camera and the light, and each item's pick ID.
struct Inputs {
    images: BTreeMap<String, Image>,
    camera: Camera,
    light: Option<[f64; 16]>,
    picks: BTreeMap<String, u32>,
    settings: Settings,
}

fn frame_inputs(
    device: &Device,
    doc: &Value,
    look: &Look3,
    look_json: &Value,
    selection: &[String],
    size: [u32; 2],
) -> Result<Inputs, Value> {
    let mut labels = Labels::new();
    let scene = evaluate(doc, 0, look, &mut labels).map_err(|r| refused(r.code, r.path))?;
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let settings = settings(
        &scene,
        look_json,
        look,
        selection,
        0.0,
        doc_seed,
        Seeding::Item,
    );
    let mut renderer = Renderer::new(device, Planted3::default());
    let mut post = ShadowOnly(settings.shadow.is_some());
    draw_offscreen(device, &mut renderer, &scene, look, Some(&mut post))
        .ok_or_else(|| refused("unsupported_platform", "no pixels"))?;
    let (linear, ids) = renderer
        .read_targets(device)
        .ok_or_else(|| refused("unsupported_platform", "no pixels"))?;
    let mut images = BTreeMap::new();
    images.insert("color".to_string(), f32_image(&linear, size, 4));
    let mut id_img = Image::new(size[0], size[1]);
    for (i, b) in ids.as_chunks::<4>().0.iter().enumerate() {
        id_img.px[i][0] = f64::from(u32::from_le_bytes(*b));
    }
    images.insert("ids".to_string(), id_img);
    let (depth, shadow) = renderer
        .depth_and_shadow()
        .ok_or_else(|| refused("unsupported_platform", "no targets"))?;
    let d = reference::read(device, depth, wgpu::TextureAspect::DepthOnly, 4);
    images.insert("depth".to_string(), f32_image(&d, size, 1));
    if let Some(map) = shadow {
        let s = [map.width(), map.height()];
        let m = reference::read(device, map, wgpu::TextureAspect::DepthOnly, 4);
        images.insert("shadow_map".to_string(), f32_image(&m, s, 1));
    }
    let ((clip, eye, near), light) = renderer.camera();
    Ok(Inputs {
        images,
        camera: Camera {
            clip,
            eye,
            near,
            t: 0.0,
            seed: 0,
        },
        light,
        picks: renderer.picks().clone(),
        settings,
    })
}

/// `reference`: one shipped pass operator on this machine's GPU and its CPU reference, on the
/// inputs of the frame it runs in (or a color input the call gives).
pub fn reference(app: &mut App, out: &str, call: &Value) -> Value {
    let Some(name) = call["operator"].as_str().map(String::from) else {
        return refused("bad_input", "reference names an operator");
    };
    let karis = app.planted != Some(Planted::BloomWithoutKaris);
    let Some(op) = shipped::library(karis).into_iter().find(|s| s.name == name) else {
        return refused(
            "unknown_operator",
            format!("{name} is not a shipped operator"),
        );
    };
    if op.kind != Kind::Pass {
        return refused(
            "not_a_pass",
            format!("{name} is a {} operator", op.kind.name()),
        );
    }
    let look_json = call["look"].clone();
    let look = match Look3::read(&look_json) {
        Ok(l) => l,
        Err(e) => return refused("bad_input", format!("look: {e}")),
    };
    let size = match call["size"]
        .as_array()
        .and_then(|s| Some([s.first()?.as_u64()? as u32, s.get(1)?.as_u64()? as u32]))
    {
        Some(s) if s[0] > 0 && s[1] > 0 => s,
        _ => return refused("bad_input", "size is [w, h]"),
    };
    let selection: Vec<String> = call["selection"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let doc = match call["doc"].as_str() {
        Some(p) => match std::fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        {
            Some(mut d) => {
                d["size"] = json!(size);
                Some(d)
            }
            None => return refused("bad_input", "doc"),
        },
        None => None,
    };
    let input = match call["input"]["color"].as_str() {
        Some(p) => match std::fs::read(p) {
            Ok(b) if b.len() == (size[0] * size[1] * 16) as usize => Some(f32_image(&b, size, 4)),
            _ => return refused("bad_input", "input.color is a w × h f32 RGBA file"),
        },
        None => None,
    };
    if doc.is_none() && input.is_none() {
        return refused("bad_input", "reference takes a doc or an input");
    }
    let off = app.planted == Some(Planted::PassOffByTwo);
    let ran = app
        .worker
        .call(move |state| -> Result<(Image, reference::Ran), Value> {
            let device = state.gpu.device();
            let mut inputs = match &doc {
                Some(doc) => frame_inputs(&device, doc, &look, &look_json, &selection, size)?,
                None => {
                    let scene_free = Settings {
                        bloom: look_json["bloom"].as_object().map(|b| {
                            b.iter()
                                .map(|(k, v)| (format!("bloom.{k}"), v.clone()))
                                .collect()
                        }),
                        ..Settings::default()
                    };
                    Inputs {
                        images: BTreeMap::new(),
                        camera: Camera {
                            clip: [
                                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0,
                                0.0, 0.0, 1.0,
                            ],
                            eye: [0.0; 3],
                            near: 0.1,
                            t: 0.0,
                            seed: 0,
                        },
                        light: None,
                        picks: BTreeMap::new(),
                        settings: scene_free,
                    }
                }
            };
            if let Some(color) = input {
                inputs.images.insert("color".into(), color);
            }
            let s = &inputs.settings;
            let stages: Vec<Compiled> = op
                .stages
                .iter()
                .map(|g| {
                    compile_with(g, &BTreeMap::new(), Options::default())
                        .expect("shipped stages check")
                })
                .collect();
            let gpu_stages: Vec<Compiled> = op
                .stages
                .iter()
                .map(|g| {
                    compile_with(
                        g,
                        &BTreeMap::new(),
                        Options {
                            off_by_two: off,
                            ..Options::default()
                        },
                    )
                    .expect("shipped stages check")
                })
                .collect();
            let held = reference::upload(&device, Tex::Float, &inputs.images["color"]).1;
            let ran = match op.name {
                "glow@1" => {
                    let params = s.bloom.clone().unwrap_or_default();
                    reference::glow(
                        &device,
                        &stages,
                        &gpu_stages,
                        &inputs.images["color"],
                        &params,
                        &inputs.camera,
                        size,
                    )
                }
                name => {
                    let mut params = BTreeMap::new();
                    let mut camera = inputs.camera;
                    match name {
                        "grid.ground@1" => params = s.grid.clone().unwrap_or_default(),
                        "shadow.resolve@1" => {
                            if let Some((p, seed)) = &s.shadow {
                                params = p.clone();
                                camera.seed = *seed;
                            }
                            if let Some(l) = inputs.light {
                                params.insert("light.clip".into(), json!(l.to_vec()));
                            }
                        }
                        "outline.select@1" => {
                            let mut bits = vec![0u64; 16];
                            for id in &s.selection {
                                if let Some(&pick) = inputs.picks.get(id) {
                                    if pick > 0 && pick < 512 {
                                        bits[(pick >> 5) as usize] |= 1 << (pick & 31);
                                    }
                                }
                            }
                            params.insert("selection.bits".into(), json!(bits));
                            params.insert("selection.width".into(), json!(s.outline_width));
                        }
                        _ => {}
                    }
                    reference::pass(
                        &device,
                        &stages[0],
                        &gpu_stages[0],
                        &inputs.images,
                        &params,
                        &s.roles,
                        &camera,
                        size,
                    )
                }
            };
            ran.map(|r| (held, r))
                .map_err(|e| refused("reference_failed", e))
        });
    let (held, ran) = match ran {
        Ok(r) => r,
        Err(e) => return e,
    };
    let names = (|| -> Result<[String; 3], Value> {
        Ok([
            write_named(out, &f32_file(&held), "f32")?,
            write_named(out, &f32_file(&ran.gpu), "f32")?,
            write_named(out, &f32_file(&ran.cpu), "f32")?,
        ])
    })();
    match names {
        Ok([input, gpu, cpu]) => json!({
            "operator": name, "kind": "pass", "encoding": "linear", "size": size,
            "input": input, "gpu": gpu, "cpu": cpu,
        }),
        Err(e) => e,
    }
}

/// How far an operator got.
#[derive(Default)]
struct Reached {
    naga: bool,
    pipeline: bool,
    gpu: bool,
}

/// A pass compiled and run once on a 64 × 64 frame, its texture inputs blank; a compute operator
/// dispatched once over its elements.
fn run_once(device: &Device, c: &Compiled, reached: &mut Reached) -> Result<(), String> {
    let d = &device.device;
    let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
    let runner = Runner::new(d, c.clone(), LINEAR);
    if let Some(e) = pollster_block(scope.pop()) {
        return Err(e.to_string());
    }
    reached.pipeline = true;
    let size = [64u32, 64];
    let mut textures = Vec::new();
    for name in &c.checked.textures {
        let Ty::Tex(kind) = c.checked.op.inputs[name].ty else {
            unreachable!()
        };
        textures.push(reference::upload(device, kind, &Image::new(size[0], size[1])).0);
    }
    let views: Vec<wgpu::TextureView> = textures
        .iter()
        .map(|t| t.create_view(&Default::default()))
        .collect();
    let refs: Vec<&wgpu::TextureView> = views.iter().collect();
    let storage: Vec<wgpu::Buffer> = c
        .checked
        .storage_inputs
        .iter()
        .map(|_| 1u32)
        .chain(c.checked.op.storage.values().map(|s| s.count.max(1)))
        .map(|n| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("check_operator storage"),
                size: u64::from(n) * 4,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            })
        })
        .collect();
    let srefs: Vec<&wgpu::Buffer> = storage.iter().collect();
    let values = interp::inputs(&c.checked, &BTreeMap::new(), &BTreeMap::new());
    let (g0, g1, _b) = runner.bind(d, &Frame::default(), size, &values, &refs, &srefs);
    let mut enc = d.create_command_encoder(&Default::default());
    match c.kind() {
        Kind::Compute => runner.dispatch(&mut enc, c.checked.op.elements, &(g0, g1), None),
        _ => {
            let out = output(d, "check_operator output", size);
            runner.encode(
                &mut enc,
                &out.create_view(&Default::default()),
                &(g0, g1),
                None,
            );
        }
    }
    device.queue.submit([enc.finish()]);
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    reached.gpu = true;
    Ok(())
}

/// A linear render target of `size` that nothing reads back.
fn output(d: &wgpu::Device, label: &str, [width, height]: [u32; 2]) -> wgpu::Texture {
    d.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: LINEAR,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    })
}

pub(crate) fn pollster_block<F: std::future::Future>(f: F) -> F::Output {
    // The error scope resolves at once on a device whose work is polled.
    let waker = std::task::Waker::noop();
    let mut cx = std::task::Context::from_waker(waker);
    let mut f = std::pin::pin!(f);
    loop {
        if let std::task::Poll::Ready(v) = f.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::yield_now();
    }
}

/// The planted core that skips the check: an operator that carries shader text in a field runs
/// it as written, as a full-screen pass, on naga, a pipeline and the GPU.
fn unchecked(device: &Device, op: &Value, reached: &mut Reached) -> Option<String> {
    let text = op
        .as_object()?
        .iter()
        .find_map(|(k, v)| (k == "wgsl").then(|| v.as_str()).flatten())?;
    let vs = "@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)); return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0); }\n";
    let source = format!("{vs}{text}");
    if validate(&source).is_err() {
        return None;
    }
    reached.naga = true;
    let d = &device.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("unchecked"),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("unchecked"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: LINEAR,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    reached.pipeline = true;
    let out = output(d, "unchecked output", [64, 64]);
    let mut enc = d.create_command_encoder(&Default::default());
    {
        let view = out.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("unchecked"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.draw(0..3, 0..1);
    }
    device.queue.submit([enc.finish()]);
    reached.gpu = true;
    Some("ran as written".into())
}

/// `check_operator`: the core's check, and only if it passes, the core's WGSL through naga, a
/// pipeline and one run on the GPU.
pub fn check_operator(app: &mut App, out: &str, call: &Value) -> Value {
    let out = out.to_string();
    let assets: BTreeMap<String, PathBuf> = call["assets"]
        .as_object()
        .map(|a| {
            a.iter()
                .filter_map(|(k, v)| Some((k.clone(), PathBuf::from(v.as_str()?))))
                .collect()
        })
        .unwrap_or_default();
    let skips = app.planted == Some(Planted::SkipsOperatorCheck);
    let (emit_options, mut check_options) = operator_plants(app.planted);
    // The class the check's limits apply under, as a document's budget class (#431).
    check_options.wide_fetches = matches!(call["class"].as_str(), Some("showpiece" | "export"));
    // A composed pass that calls the shipped blur compiles into its parts (#432).
    if let Some(parts) = deep_canvas_effects::fusion::split_blur(&call["operator"]) {
        return check_parts(app, parts, assets, emit_options, check_options);
    }
    // The packs' step functions `use@1` calls, inlined before the check (#431).
    let functions = match pack_functions(&call["packs"]) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let op = match graph::inline_functions(
        &call["operator"],
        &functions,
        !check_options.no_divergence_rule,
    ) {
        Ok(op) => op,
        Err(issues) => {
            return json!({"outcome": "refused", "issues": issues.iter().map(graph::Issue::to_json).collect::<Vec<_>>(), "reached": {"naga": false, "pipeline": false, "gpu": false}})
        }
    };
    let reference_size = call["reference"]["size"]
        .as_array()
        .filter(|s| s.len() == 2)
        .and_then(|s| Some([s[0].as_u64()? as u32, s[1].as_u64()? as u32]));
    let ui_thread = std::thread::current().name().unwrap_or("main").to_string();
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let mut reached = Reached::default();
        if skips && unchecked(&device, &op, &mut reached).is_some() {
            return json!({"outcome": "accepted", "issues": [], "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
        }
        // The check alone, timed, for the computed class and the estimate.
        let started = std::time::Instant::now();
        let alone = graph::read(&op).and_then(|o| check::check_with(&o, check_options));
        let check_ms = started.elapsed().as_secs_f64() * 1e3;
        let started = std::time::Instant::now();
        let result = compile_planted(&op, &assets, emit_options, check_options);
        let compile_ms = (started.elapsed().as_secs_f64() * 1e3 - check_ms).max(0.0);
        let thread = std::thread::current()
            .name()
            .unwrap_or("render")
            .to_string();
        let mut extra = serde_json::Map::new();
        if let Ok(c) = &alone {
            extra.insert("class".into(), json!(c.class.name()));
            extra.insert("estimate_ns".into(), json!(c.estimate));
        }
        extra.insert(
            "timing".into(),
            json!({"check_ms": check_ms, "compile_ms": compile_ms, "thread": thread, "ui_thread": ui_thread}),
        );
        let (outcome, issues) = match result {
            Err(issues) => {
                // A refusal from naga's validation means the module reached naga.
                reached.naga = issues.iter().any(|i| i.code == "operator_compile");
                ("refused", issues.iter().map(graph::Issue::to_json).collect::<Vec<_>>())
            }
            Ok(c) => {
                reached.naga = true;
                match run_once(&device, &c, &mut reached) {
                    Ok(()) => {
                        // Drawn once by the step harness at `size`, on this GPU and through the
                        // f64 interpreter (#431).
                        if let Some(size) = reference_size {
                            match reference_of(&device, &c, &assets, size, &out) {
                                Ok(r) => {
                                    extra.insert("reference".into(), r);
                                }
                                Err(e) => return e,
                            }
                        }
                        ("accepted", Vec::new())
                    }
                    Err(e) => ("refused", vec![graph::Issue::at_path("operator_compile", "", e).to_json()]),
                }
            }
        };
        let mut reply = json!({"outcome": outcome, "issues": issues, "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
        if let Value::Object(o) = &mut reply {
            o.extend(extra);
        }
        reply
    })
}

/// A composed pass split around the shipped blur (#432), each part checked, written, validated
/// and run once as a pass of its own: its steps' parts costed by their estimate, the blur's at
/// what the calibration run measured; the operator's estimate is the parts' sum.
fn check_parts(
    app: &mut App,
    parts: Vec<deep_canvas_effects::fusion::Part>,
    assets: BTreeMap<String, PathBuf>,
    emit_options: deep_canvas_effects::emit::Options,
    check_options: check::CheckOptions,
) -> Value {
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let mut reached = Reached::default();
        let mut rows = Vec::new();
        let mut total = 0.0;
        for p in &parts {
            let c = match compile_planted(&p.graph, &assets, emit_options, check_options) {
                Ok(c) => c,
                Err(issues) => {
                    let issues: Vec<Value> = issues
                        .iter()
                        .map(|i| {
                            let mut j = i.to_json();
                            j["part"] = json!(p.of);
                            j
                        })
                        .collect();
                    return json!({"outcome": "refused", "issues": issues, "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
                }
            };
            reached.naga = true;
            if let Err(e) = run_once(&device, &c, &mut reached) {
                let issue = graph::Issue::at_path("operator_compile", "", e).to_json();
                return json!({"outcome": "refused", "issues": [issue], "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
            }
            let measured = deep_canvas_effects::shipped::BLUR_MEASURED_NS_PER_PX
                .iter()
                .find(|(name, _)| *name == p.of)
                .map(|(_, ns)| *ns);
            let estimate = measured.unwrap_or(c.checked.estimate);
            total += estimate;
            rows.push(json!({
                "of": p.of, "steps": p.steps, "fetches": c.checked.fetches, "estimate_ns": estimate,
                "cost": if measured.is_some() { "measured" } else { "estimated" },
            }));
        }
        json!({
            "outcome": "accepted", "issues": [], "parts": rows, "estimate_ns": total,
            "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu},
        })
    })
}

/// Every step function the call's packs bring (`[{id, dir}]`, each dir holding a `pack.json` with
/// `functions: {name@major → step function}`), by name.
fn pack_functions(packs: &Value) -> Result<graph::Functions, Value> {
    let mut out = graph::Functions::new();
    for p in packs.as_array().into_iter().flatten() {
        let Some(dir) = p["dir"].as_str().or_else(|| p.as_str()) else {
            return Err(refused("bad_input", "a pack is {id, dir}"));
        };
        let path = PathBuf::from(dir).join("pack.json");
        let text = std::fs::read_to_string(&path)
            .map_err(|e| refused("bad_input", format!("{}: {e}", path.display())))?;
        let manifest: Value = serde_json::from_str(&text)
            .map_err(|e| refused("bad_input", format!("{}: {e}", path.display())))?;
        for (name, f) in manifest["functions"].as_object().into_iter().flatten() {
            out.insert(name.clone(), f.clone());
        }
    }
    Ok(out)
}

/// An operator's step-harness drawing at `size` on this GPU and through the f64 interpreter, its
/// texture inputs by hash read from `assets` (each channel ÷ 255, as linear data), written under
/// `out` as two f32 RGBA files.
fn reference_of(
    device: &Device,
    c: &Compiled,
    assets: &BTreeMap<String, PathBuf>,
    size: [u32; 2],
    out: &str,
) -> Result<Value, Value> {
    let mut data = crate::steps_ref::Data::default();
    for name in &c.checked.textures {
        let input = &c.checked.op.inputs[name];
        let Ty::Tex(kind) = input.ty else { continue };
        let img = match &input.from {
            graph::From::Asset(sha) => {
                let path = assets
                    .get(sha)
                    .ok_or_else(|| refused("asset_missing", format!("inputs/{name}")))?;
                let bytes = std::fs::read(path)
                    .map_err(|_| refused("asset_missing", format!("inputs/{name}")))?;
                let decoded = image::load_from_memory(&bytes)
                    .map_err(|_| refused("out_of_range", format!("inputs/{name}")))?
                    .to_rgba8();
                let mut img = Image::new(decoded.width(), decoded.height());
                for (p, px) in img.px.iter_mut().zip(decoded.pixels()) {
                    *p = px.0.map(|v| f64::from(v) / 255.0);
                }
                img
            }
            _ => Image::new(size[0], size[1]),
        };
        let (_, held) = deep_effects_render::reference::upload(device, kind, &img);
        data.textures.insert(name.clone(), (kind, held));
    }
    let (gpu, cpu) = crate::steps_ref::drawn_both(device, c, &data, size)
        .map_err(|e| refused("bad_input", format!("reference: {e}")))?;
    Ok(json!({
        "size": size,
        "gpu": crate::view3d::write_named(out, &gpu, "f32")?,
        "cpu": crate::view3d::write_named(out, &cpu, "f32")?,
    }))
}

/// The emitter's and the check's planted wrong programs (#429), from the binary's `--planted`.
pub fn operator_plants(p: Option<Planted>) -> (Options, check::CheckOptions) {
    (
        Options {
            drops_swizzle_last: p == Some(Planted::DropsSwizzleLast),
            index_wraps: p == Some(Planted::IndexWraps),
            no_count_guard: p == Some(Planted::DispatchWithoutGuard),
            period_first_octave: p == Some(Planted::PeriodFirstOctave),
            ..Options::default()
        },
        check::CheckOptions {
            declared_class: p == Some(Planted::TakesDeclaredClass),
            exact_f32_compares: p == Some(Planted::F32CompareFloorExact),
            exact_f32_floor: p == Some(Planted::F32CompareFloorExact),
            trusts_index: p == Some(Planted::TrustsWriteIndex),
            noise_weight_halved: p == Some(Planted::NoiseWeightHalved),
            no_divergence_rule: p == Some(Planted::NoDivergenceRule),
            wide_fetches: false,
            carried_exact: p == Some(Planted::CarriedClassExact),
        },
    )
}

/// The structural steps' planted programs (#483), as the operators' runtime takes them; the pool
/// marker is the test hook's, set by check_operator.
pub fn operator_hooks(p: Option<Planted>) -> deep_effects_render::docops::Hooks {
    deep_effects_render::docops::Hooks {
        marker: None,
        no_clear: p == Some(Planted::PoolWithoutClear),
        feeds_first: p == Some(Planted::IterateFeedsFirst),
        level0_only: p == Some(Planted::MipsLevel0Only),
        old_key: p == Some(Planted::MipsKeptUnderOldKey),
        ties_decreasing: p == Some(Planted::SortTiesDecreasing),
        compact_by_atomic: p == Some(Planted::CompactByAtomic),
        dispatch_without_guard: p == Some(Planted::DispatchWithoutGuard),
        steps_per_frame: p == Some(Planted::StepsPerFrame),
        keeps_every_checkpoint: p == Some(Planted::RingKeepsEveryCheckpoint),
    }
}

/// The compute operator `op` builds: one storage input of 32-bit words per argument, the step
/// over them read as their types, and its result written back as bits.
fn op_graph(name: &str, types: &[Ty], rows: usize) -> Result<(Value, Ty), Value> {
    let def = deep_canvas_effects::table::def(name)
        .ok_or_else(|| refused("unknown_op", name.to_string()))?;
    let mut inputs = Map::new();
    let mut steps = Map::new();
    steps.insert("e".into(), json!({"op": "element@1", "args": {}}));
    let mut args = Map::new();
    for (k, ty) in types.iter().enumerate() {
        let port = def.ports.get(k).ok_or_else(|| {
            refused(
                "bad_input",
                format!("{name} takes {} arguments", def.ports.len()),
            )
        })?;
        inputs.insert(format!("in{k}"), json!({"type": "u32", "count": rows, "from": {"storage": {"op": "core", "output": format!("in{k}")}}}));
        steps.insert(
            format!("w{k}"),
            json!({"op": "read@1", "args": {"buf": format!("in{k}"), "i": "e"}}),
        );
        let v = match ty {
            Ty::V(graph::Sc::U32, 1) => format!("w{k}"),
            Ty::V(graph::Sc::Bool, 1) => {
                steps.insert(
                    format!("v{k}"),
                    json!({"op": "ne@1", "args": {"a": format!("w{k}"), "b": 0}}),
                );
                format!("v{k}")
            }
            t => {
                steps.insert(
                    format!("v{k}"),
                    json!({"op": "bitcast@1", "args": {"x": format!("w{k}"), "to": t.wgsl()}}),
                );
                format!("v{k}")
            }
        };
        args.insert((*port).to_string(), json!(v));
    }
    steps.insert("r".into(), json!({"op": name, "args": args}));
    // The step's result type, from a check of the graph before its write.
    let probe = json!({"id": "op-probe", "kind": "compute", "origin": "composed", "about": "The step alone, to type its result.",
        "inputs": inputs.clone(), "steps": steps.clone(), "outputs": {"out": {"storage": {"type": "u32", "count": rows.max(1)}}},
        "elements": rows.max(1), "workgroup": 64, "cost": {"ns_per_element": 1000.0}});
    let rty = check::read_and_check(&probe)
        .map_err(|e| refused("operator_type", format!("{e:?}")))?
        .types
        .get("r")
        .cloned()
        .unwrap_or(Ty::U32);
    let bits = match &rty {
        Ty::V(graph::Sc::U32, 1) => "r".to_string(),
        Ty::V(graph::Sc::Bool, 1) => {
            steps.insert(
                "rb".into(),
                json!({"op": "select@1", "args": {"f": 0, "t": 1, "cond": "r"}}),
            );
            steps.insert(
                "rbu".into(),
                json!({"op": "convert@1", "args": {"x": "rb", "to": "u32"}}),
            );
            "rbu".into()
        }
        _ => {
            steps.insert(
                "rb".into(),
                json!({"op": "bitcast@1", "args": {"x": "r", "to": "u32"}}),
            );
            "rb".into()
        }
    };
    steps.insert(
        "out_w".into(),
        json!({"op": "write@1", "args": {"buf": "out", "i": "e", "v": bits}}),
    );
    Ok((
        json!({"id": format!("op-{name}"), "kind": "compute", "origin": "composed", "about": format!("The public step {name} over rows of bits."),
            "inputs": inputs, "steps": steps, "outputs": {"out": {"storage": {"type": "u32", "count": rows.max(1)}}},
            "elements": rows.max(1), "workgroup": 64, "cost": {"ns_per_element": 1000.0}}),
        rty,
    ))
}

/// `op`: a public step over rows of bits, on this GPU and through the CPU interpreter.
pub fn op(app: &mut App, call: &Value) -> Value {
    let Some(name) = call["op"].as_str().map(String::from) else {
        return refused("bad_input", "op names a step");
    };
    let types: Vec<Ty> = call["types"]
        .as_array()
        .map(|t| {
            t.iter()
                .filter_map(|x| x.as_str().and_then(Ty::parse))
                .collect()
        })
        .unwrap_or_default();
    let rows: Vec<Vec<u32>> = call["rows"]
        .as_array()
        .map(|r| {
            r.iter()
                .map(|row| {
                    row.as_array()
                        .map(|a| a.iter().map(|v| v.as_u64().unwrap_or(0) as u32).collect())
                        .unwrap_or_default()
                })
                .collect()
        })
        .unwrap_or_default();
    let (graph, rty) = match op_graph(&name, &types, rows.len()) {
        Ok(g) => g,
        Err(e) => return e,
    };
    let c = match compile_with(&graph, &BTreeMap::new(), Options::default()) {
        Ok(c) => c,
        Err(e) => {
            return refused(
                "operator_refused",
                format!(
                    "{:?}",
                    e.iter().map(|i| i.message.clone()).collect::<Vec<_>>()
                ),
            )
        }
    };
    let columns: Vec<Vec<u32>> = (0..types.len())
        .map(|k| {
            rows.iter()
                .map(|r| r.get(k).copied().unwrap_or(0))
                .collect()
        })
        .collect();
    let cc = c.clone();
    let cols = columns.clone();
    let gpu = app
        .worker
        .call(move |state| dispatch(&state.gpu.device(), &cc, &cols));
    // The CPU interpreter over the same words.
    let env = interp::Env {
        t: 0.0,
        seed: 0,
        clip: [0.0; 16],
        inverse_clip: [0.0; 16],
        eye: [0.0; 4],
        inputs: interp::inputs(&c.checked, &BTreeMap::new(), &BTreeMap::new()),
        textures: BTreeMap::new(),
        normals: [[0.0; 3]; 3],
    };
    let storage: BTreeMap<String, Vec<f64>> = columns
        .iter()
        .enumerate()
        .map(|(k, w)| (format!("in{k}"), w.iter().map(|x| f64::from(*x)).collect()))
        .collect();
    let cpu: Vec<Value> = match interp::compute(&c.checked, &env, storage) {
        Ok(o) => o["out"]
            .iter()
            .take(rows.len())
            .map(|w| {
                let b = *w as u32;
                match rty {
                    Ty::V(graph::Sc::F32, 1) => {
                        let f = f32::from_bits(b);
                        if f.is_finite() {
                            json!(f64::from(f))
                        } else {
                            Value::Null
                        }
                    }
                    Ty::V(graph::Sc::I32, 1) => json!(b as i32),
                    _ => json!(b),
                }
            })
            .collect(),
        Err(_) => vec![Value::Null; rows.len()],
    };
    json!({"gpu": gpu.into_iter().take(rows.len()).collect::<Vec<_>>(), "cpu": cpu})
}

/// The Metal GPU family of an Apple-silicon chip, by its name.
pub fn family(gpu: &str) -> String {
    let n = gpu
        .split_whitespace()
        .find_map(|w| w.strip_prefix('M').and_then(|d| d.parse::<u32>().ok()));
    match n {
        Some(1) => "apple7".into(),
        Some(2) => "apple8".into(),
        Some(3 | 4) => "apple9".into(),
        Some(k) => format!("apple{}", k + 5),
        None => "unknown".into(),
    }
}

/// The pixel hash's exactness fixture: 64 × 64 RGBA8 words from a fixed integer formula.
fn hash_fixture() -> Vec<u32> {
    (0..shipped::HASH_FIXTURE)
        .map(|i| i.wrapping_mul(2_654_435_761) ^ (i >> 3))
        .collect()
}

/// This GPU's name, and the bits of every shipped exact operator on its exactness fixture: the
/// exact-class fixtures (#140's GPU seam suite compares them across GPU families).
pub fn exact_bits(app: &mut App) -> (String, BTreeMap<String, String>) {
    let (info, ops) = app.worker.call(|state| {
        let device = state.gpu.device();
        let info = device.adapter.clone();
        let mut ops = BTreeMap::new();
        for s in shipped::library(true) {
            for g in &s.stages {
                let Ok(c) = compile_with(g, &BTreeMap::new(), Options::default()) else {
                    continue;
                };
                if c.checked.class != Class::Exact {
                    continue;
                }
                let bits = dispatch(&device, &c, &[hash_fixture()]);
                let bytes: Vec<u8> = bits.iter().flat_map(|w| w.to_le_bytes()).collect();
                ops.insert(s.name.to_string(), hex(&bytes));
            }
        }
        (info, ops)
    });
    let name = info
        .as_ref()
        .map_or_else(|| "unknown".to_string(), |i| i.name.clone());
    (name, ops)
}

/// `exact`: every shipped exact operator on its exactness fixture on this GPU, as a record.
pub fn exact(app: &mut App, out: &str) -> Value {
    let (name, ops) = exact_bits(app);
    let steps = crate::steps_ref::exact_steps(app);
    let record = json!({
        "format": 1,
        "gpu": {"name": name, "family": family(&name)},
        "os": crate::golden::os(),
        "wgpu": env!("DEEP_WGPU_VERSION"),
        "operators": ops,
        "steps": steps,
    });
    let bytes = serde_json::to_vec_pretty(&record).unwrap_or_default();
    match write_named(out, &bytes, "json") {
        Ok(hash) => json!({
            "record": hash,
            "gpu": record["gpu"],
            "operators": ops.iter().map(|(k, v)| json!({"name": k, "bits": v})).collect::<Vec<_>>(),
        }),
        Err(e) => e,
    }
}

/// `cross_gpu`: records from GPUs of different families compared; with fewer than two families
/// it is BLOCKED with one unblock ask, never PASS.
pub fn cross_gpu(app: &App, call: &Value) -> Value {
    let mut records = Vec::new();
    for p in call["records"].as_array().into_iter().flatten() {
        match p
            .as_str()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        {
            Some(r) => records.push(r),
            None => return refused("bad_input", format!("record {p} isn't readable")),
        }
    }
    let mut families: Vec<String> = records
        .iter()
        .filter_map(|r| r["gpu"]["family"].as_str().map(String::from))
        .collect();
    families.sort();
    families.dedup();
    if families.len() < 2 && app.planted != Some(Planted::PassesOneGpu) {
        let missing = crate::steps_ref::missing_family(families.first().map_or("", String::as_str));
        return json!({
            "result": "BLOCKED",
            "families": families,
            "asks": [{"kind": "unblock", "ask": format!("run deep-gpu's exact call on an {missing} GPU (another family than this one) and compare its record"), "needs": "a second GPU family", "gpu": missing}],
        });
    }
    let mut differs = Vec::new();
    if let Some(first) = records.first() {
        // Every shipped exact operator's bits, then every exact public step's.
        for (field, what) in [("operators", "operator"), ("steps", "step")] {
            for (name, bits) in first[field].as_object().into_iter().flatten() {
                for r in &records[1..] {
                    if r[field][name] != *bits {
                        differs.push(json!({what: name, "families": [first["gpu"]["family"], r["gpu"]["family"]]}));
                    }
                }
            }
        }
    }
    json!({
        "result": if differs.is_empty() { "PASS" } else { "FAIL" },
        "families": families,
        "differs": differs,
    })
}
