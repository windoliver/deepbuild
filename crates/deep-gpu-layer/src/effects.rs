//! Issue #380's calls (tests/acceptance/380/README.md, The surface under test): the shipped
//! effects' settings from a look, a scene and a session's selection; `operators`, `reference`,
//! `check_operator`, `op`, `exact` and `cross_gpu`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas::ops;
use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{self, Class, Kind, Tex, Ty};
use deep_canvas_effects::interp::{self, hash1, Image};
use deep_canvas_effects::{check, shipped};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene};
use deep_effects_render::compile::{compile_with, validate, Compiled};
use deep_effects_render::frame::{self as fx, Settings, Sparks};
use deep_effects_render::reference::{self, Camera};
use deep_effects_render::runner::{Frame, Runner, LINEAR};
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

fn linear_of(c: [u8; 3]) -> [f64; 3] {
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

/// The wrong programs the effects run under (frame::Planted).
pub fn planted_fx(p: Option<Planted>) -> fx::Planted {
    fx::Planted {
        without_karis: p == Some(Planted::BloomWithoutKaris),
        off_by_two: p == Some(Planted::PassOffByTwo),
        slow_glow: p == Some(Planted::SlowGlow),
    }
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
    let shadow = scene
        .sun
        .as_ref()
        .filter(|s| s.shadow)
        .map(|s| (BTreeMap::new(), seeding.key(item_seed(doc_seed, &s.id))));
    let sparks = scene
        .others
        .iter()
        .filter(|o| o.kind == "particles@1")
        .map(|o| {
            let p = &o.params;
            let count = p["count"]
                .as_u64()
                .unwrap_or(256)
                .min(u64::from(shipped::MAX_PARTICLES)) as u32;
            let life = pair(p.get("life"), [1.0, 1.0]);
            let ballistic = &p["motion"]["ballistic"];
            let v0 = pair(ballistic.get("v0"), [1.0, 2.0]);
            let colors: Vec<&str> = p["color"]
                .as_array()
                .map(|c| c.iter().filter_map(|k| k["role"].as_str()).collect())
                .unwrap_or_default();
            let params = BTreeMap::from([
                ("particles.count".to_string(), json!(count)),
                (
                    "particles.rate".to_string(),
                    json!(p["emit"]["rate"].as_f64().unwrap_or(100.0)),
                ),
                (
                    "particles.span".to_string(),
                    json!(p["emit"]["span"].as_f64().unwrap_or(1e9)),
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
                ("particles.origin".to_string(), json!(o.pos)),
            ]);
            Sparks {
                item: o.id.clone(),
                params,
                count,
                seed: seeding.key(item_seed(doc_seed, &o.id)),
                size_px: p["size"].as_f64().unwrap_or(3.0),
                // Sparks are emissive, bright enough to glow.
                opacity: 4.0 * p["opacity"].as_f64().unwrap_or(1.0),
                from: role(look, colors.first().copied(), "accent"),
                to: role(look, colors.last().copied(), "accent"),
            }
        })
        .collect();
    roles.insert("selection".into(), role(look, Some("selection"), "accent"));
    let bloom = look_json["bloom"].as_object().map(|b| {
        b.iter()
            .map(|(k, v)| (format!("bloom.{k}"), v.clone()))
            .collect::<BTreeMap<_, _>>()
    });
    Settings {
        grid,
        shadow,
        sparks,
        selection: selection.to_vec(),
        outline_width: 2,
        bloom,
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
                    compile_with(g, &BTreeMap::new(), Options { off_by_two: off })
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
    let scope = d.push_error_scope(wgpu::ErrorFilter::Validation);
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

fn pollster_block<F: std::future::Future>(f: F) -> F::Output {
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
pub fn check_operator(app: &mut App, call: &Value) -> Value {
    let op = call["operator"].clone();
    let assets: BTreeMap<String, PathBuf> = call["assets"]
        .as_object()
        .map(|a| {
            a.iter()
                .filter_map(|(k, v)| Some((k.clone(), PathBuf::from(v.as_str()?))))
                .collect()
        })
        .unwrap_or_default();
    let skips = app.planted == Some(Planted::SkipsOperatorCheck);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let mut reached = Reached::default();
        if skips && unchecked(&device, &op, &mut reached).is_some() {
            return json!({"outcome": "accepted", "issues": [], "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
        }
        let result = compile_with(&op, &assets, Options::default());
        let (outcome, issues) = match result {
            Err(issues) => {
                // A refusal from naga's validation means the module reached naga.
                reached.naga = issues.iter().any(|i| i.code == "operator_compile");
                ("refused", issues.iter().map(graph::Issue::to_json).collect::<Vec<_>>())
            }
            Ok(c) => {
                reached.naga = true;
                match run_once(&device, &c, &mut reached) {
                    Ok(()) => ("accepted", Vec::new()),
                    Err(e) => ("refused", vec![graph::Issue::at_path("operator_compile", "", e).to_json()]),
                }
            }
        };
        json!({"outcome": outcome, "issues": issues, "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}})
    })
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

/// Runs a checked compute operator on the GPU over `inputs` (one buffer of words each, in its
/// storage inputs' order) and reads back its first storage output.
fn dispatch(device: &Device, c: &Compiled, inputs: &[Vec<u32>]) -> Vec<u32> {
    use wgpu::util::DeviceExt as _;
    let d = &device.device;
    let runner = Runner::new(d, c.clone(), LINEAR);
    let ins: Vec<wgpu::Buffer> = inputs
        .iter()
        .map(|w| {
            let bytes: Vec<u8> = w.iter().flat_map(|x| x.to_le_bytes()).collect();
            d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("op input"),
                contents: &bytes,
                usage: wgpu::BufferUsages::STORAGE,
            })
        })
        .collect();
    let n = c
        .checked
        .op
        .storage
        .values()
        .next()
        .map_or(1, |s| s.count.max(1));
    let out = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("op output"),
        size: u64::from(n) * 4,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("op read back"),
        size: u64::from(n) * 4,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut bufs: Vec<&wgpu::Buffer> = ins.iter().collect();
    bufs.push(&out);
    let values = interp::inputs(&c.checked, &BTreeMap::new(), &BTreeMap::new());
    let (g0, g1, _b) = runner.bind(d, &Frame::default(), [1, 1], &values, &[], &bufs);
    let mut enc = d.create_command_encoder(&Default::default());
    runner.dispatch(&mut enc, c.checked.op.elements, &(g0, g1), None);
    enc.copy_buffer_to_buffer(&out, 0, &back, 0, u64::from(n) * 4);
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let words = back
        .slice(..)
        .get_mapped_range()
        .map(|v| {
            v.as_chunks::<4>()
                .0
                .iter()
                .map(|b| u32::from_le_bytes(*b))
                .collect()
        })
        .unwrap_or_default();
    back.unmap();
    words
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
fn family(gpu: &str) -> String {
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

/// `exact`: every shipped exact operator on its exactness fixture on this GPU, as a record.
pub fn exact(app: &mut App, out: &str) -> Value {
    let words = app.worker.call(|state| {
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
    let (info, ops) = words;
    let name = info
        .as_ref()
        .map_or_else(|| "unknown".to_string(), |i| i.name.clone());
    let record = json!({
        "format": 1,
        "gpu": {"name": name, "family": family(&name)},
        "os": crate::golden::os(),
        "wgpu": env!("DEEP_WGPU_VERSION"),
        "operators": ops,
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
        return json!({
            "result": "BLOCKED",
            "families": families,
            "asks": [{"kind": "unblock", "ask": "run deep-gpu's exact call on a GPU of another family (an M1 beside this M3) and compare its record", "needs": "a second GPU family"}],
        });
    }
    let mut differs = Vec::new();
    if let Some(first) = records.first() {
        for (name, bits) in first["operators"].as_object().into_iter().flatten() {
            for r in &records[1..] {
                if r["operators"][name] != *bits {
                    differs.push(json!({"operator": name, "families": [first["gpu"]["family"], r["gpu"]["family"]]}));
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
