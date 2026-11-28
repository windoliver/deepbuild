//! Issue #380's calls (tests/acceptance/380/README.md, The surface under test): the shipped
//! effects' settings from a look, a scene and a session's selection; `operators`, `reference`,
//! `check_operator`, `op`, `exact` and `cross_gpu`.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{self, Class, Kind, Tex, Ty};
use deep_canvas_effects::interp::{self, Image};
use deep_canvas_effects::{check, effect, shipped};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels};
use deep_effects_render::compile::{compile_planted, compile_with, validate, Compiled};
use deep_effects_render::frame::{self as fx, Settings};
use deep_effects_render::reference::{self, Camera};
use deep_effects_render::runner::{dispatch, Frame, Runner, LINEAR};
use deep_gpu::device::Device;
use deep_scene3d_render::{draw_offscreen, Planted as Planted3, Post, PostFrame, Renderer};
use serde_json::{json, Map, Value};

pub(crate) use deep_effects_render::docops::item_seed;
pub(crate) use deep_effects_render::scene::{gpu_strokes, item_pos, linear_of, settings, Seeding};

use crate::frames::hex;
use crate::view3d::write_named;
use crate::{refused, App, Planted};

/// How a frame's noise is keyed: by its items' seeds, or (planted) by the session's frame counter
/// or the clock.
pub(crate) fn seeding(p: Option<Planted>, frame: u64) -> Seeding {
    match p {
        Some(Planted::NoiseFromFrameCounter) => Seeding::Salted(frame as u32),
        Some(Planted::NoiseFromClock) => {
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
            Seeding::Salted(now.map_or(0, |d| d.as_millis() as u32))
        }
        _ => Seeding::Item,
    }
}

/// The wrong programs the effects run under (frame::Planted).
pub fn planted_fx(p: Option<Planted>) -> fx::Planted {
    fx::Planted {
        without_karis: p == Some(Planted::BloomWithoutKaris),
        off_by_two: p == Some(Planted::PassOffByTwo),
        slow_glow: p == Some(Planted::SlowGlow),
        dirt_overlay: p == Some(Planted::DirtOverlay),
        block_copy: p == Some(Planted::PuffBlockCopy),
        haze_feeds_check_readback: p == Some(Planted::HazeFeedsCheckReadback),
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
            // #508: a film effect's operator names its kind's fixture document, by its path.
            let fixture = match s.name {
                "wave_field@1" => fixture_path("wave_field"),
                "arc@1" => fixture_path("arc"),
                "plume.haze@1" => fixture_path("plume"),
                _ => None,
            };
            json!({
                "name": s.name,
                "kind": s.kind.name(),
                "origin": "shipped",
                "effect": s.effect,
                "determinism": class.name(),
                "noise": s.noise,
                "ported": [],
                "fixture": fixture,
                "cost": s.stages.iter().map(|g| &g["cost"]).collect::<Vec<_>>(),
            })
        })
        .collect();
    // #508: the film kinds: what each draws through, its declared cost and its fixture; a plume
    // and an airflow are presets of particles@1, drawn by its operator.
    let kinds: Vec<Value> = effect::KINDS
        .iter()
        .map(|k| {
            let (operator, preset, ns) = match *k {
                "wave_field" => ("wave_field@1", Value::Null, None),
                "arc" => ("arc@1", Value::Null, None),
                other => (
                    "particles.sparks@1",
                    json!("particles@1"),
                    effect::cost(other),
                ),
            };
            let ns = ns.or_else(|| {
                shipped::EFFECT_MEASURED_NS_PER_PX
                    .iter()
                    .find(|(n, _)| *n == operator)
                    .map(|(_, c)| *c)
            });
            json!({"kind": k, "operator": operator, "preset_of": preset,
                   "cost": {"ns_per_px": ns}, "fixture": fixture_path(k)})
        })
        .collect();
    json!({"operators": list, "effects": kinds})
}

/// #508: a film kind's fixture document, as its path from the checkout's root.
fn fixture_path(kind: &str) -> Option<String> {
    effect::fixture(kind).map(|_| format!("crates/deep-canvas-effects/fixtures/{kind}.json"))
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
fn output(d: &deep_gpu::counted::Wgpu, label: &str, [width, height]: [u32; 2]) -> wgpu::Texture {
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

mod check_operator;
pub use check_operator::*;

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
            skips_bound: p == Some(Planted::CheckSkipsBound),
            unit_float_textures: false,
            mul_two_corners: false,
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
        steps_per_frame: p == Some(Planted::StepsPerFrame)
            || crate::particles::stepped::planted(p).by_frame_time,
        frame_time: crate::particles::stepped::planted(p).by_frame_time,
        keeps_every_checkpoint: p == Some(Planted::RingKeepsEveryCheckpoint),
        live_inputs: p == Some(Planted::StepReadsLivePointer),
        alternate_checkpoints: p == Some(Planted::RingCheckpointsTexturesOnAlternateSteps),
        restore_from_clear: p == Some(Planted::RestoreStartsFromClearValue),
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
    let probe = json!({"id": "op-probe", "kind": "compute", "origin": "shipped", "about": "The step alone, to type its result.",
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
        json!({"id": format!("op-{name}"), "kind": "compute", "origin": "shipped", "about": format!("The public step {name} over rows of bits."),
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
