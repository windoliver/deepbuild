//! 2D writer layers on the live path (issue #385; tests/acceptance/385/README.md, "deep-gpu run:
//! new calls"). GPUI draws a 2D writer layer when its paths draw it exactly; a layer that needs a
//! Vello GPU feature moves to the GPU layer, where Vello GPU draws it on the app's wgpu device,
//! but only while the spike record shows a second 2D handoff under 1 ms a frame; anything else is
//! the live view's refusal naming the item (Draw path: GPUI or the GPU layer; Decided, The 2D
//! renderer). A writer layer that holds a 3D item is a 3D writer layer: its 2D items composite in
//! linear light over its 3D pixels.
//!
//! `layers` draws each writer layer alone by the renderers a call names; `window2d` shows the
//! document as the app's window does, a GPU-layer layer through a GPU surface of its own; `spike2d`
//! times that surface's handoff frame by frame; `vello_gpu` answers the gate.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use deep_canvas_marks::scene::{self, Blend, Drawn, Frame, Record, Scope};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate as evaluate3, Labels, Scene};
use deep_effects_render::frame::Settings;
use deep_gpu::device::Device;
use deep_gpu::encode::{Job, Pool};
use deep_gpu::render::{Determinism, Pass, RenderModule, Resolution, Target};
use deep_gpu::ring::Mark as RingMark;
use deep_gpu::surface::{Path, FORMAT};
use deep_gpu::view::{Config, View};
use deep_marks_render::gpu::{self, Options, Vello2d, MASK_LAYERS, VELLO_GPU};
pub use deep_marks_render::gpu::{Gate, SPIKE};
use deep_marks_render::layer;
use serde_json::{json, Map, Value};

use crate::session3::On;
use crate::view3d::{pair, png, write_named};
use crate::{effects, frames, parity, refused, App, Planted};

/// One writer layer as the live view sees it.
struct Layer2 {
    id: String,
    /// It holds a 3D item, fixed at check.
    three: bool,
    marks: Vec<Arc<Drawn>>,
}

/// What every call evaluates from a document at `t`.
struct Evaluated {
    size: [u32; 2],
    doc: Map<String, Value>,
    items: Map<String, Value>,
    record: Record,
    frame: Frame,
    layers: Vec<Layer2>,
    gpu: Option<(Arc<Scene>, Look3, Settings)>,
}

fn evaluate(app: &App, call: &Value) -> Result<Evaluated, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let doc = call["doc"]
        .as_object()
        .cloned()
        .ok_or_else(|| bad("doc is an object"))?;
    let size = pair(&doc["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("doc: size is [w, h]"))?;
    let t = call["t"].as_i64().unwrap_or(0);
    let record = Record {
        pinned: t,
        ..deep_marks_render::record(call.as_object().expect("a call is an object"))
            .ok_or_else(|| bad("states"))?
    };
    let program = Program::compile(&doc).map_err(|r| refused(r.code, r.path))?;
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    let items = eval::items(&doc, &program, &state);
    let flat: Map<String, Value> = items
        .iter()
        .filter(|(_, v)| !parity::three_d(v))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut flat_doc = doc.clone();
    if let Some(Value::Object(listed)) = flat_doc.get_mut("items") {
        listed.retain(|_, v| !parity::three_d(v));
    }
    let three: Vec<&str> = items
        .values()
        .filter(|v| parity::three_d(v))
        .filter_map(|v| v["layer"].as_str())
        .collect();
    // A role map (`{light, dark}`) gives a 3D layer its roles with no tone map and unit exposure;
    // a look@1 is read as scene3d reads it.
    let role_map = call["look"].get("light").is_some() && call["look"].get("roles").is_none();
    let (palette, look3) = if three.is_empty() {
        (layer::palette(&call["look"], "light")?, None)
    } else if role_map {
        let palette = layer::palette(&call["look"], "light")?;
        let look = Look3::from_roles(palette.clone());
        (palette, Some((look, call["look"].clone())))
    } else {
        let themed = crate::status::themed(&call["look"], "light");
        let look = Look3::read(&themed).map_err(|e| bad(&format!("look: {e}")))?;
        (look.roles.clone(), Some((look, themed)))
    };
    let planted = match app.planted {
        Some(Planted::SectorsSourceOver) => scene::Planted::SectorsSourceOver,
        _ => scene::Planted::None,
    };
    let frame = scene::frame_planted(&flat_doc, &flat, &palette, &record, 1.0, planted)
        .map_err(|r| refused(r.code, r.path))?;
    let layers = frame
        .layers
        .iter()
        .map(|l| Layer2 {
            id: l.id.clone(),
            three: three.contains(&l.id.as_str()),
            marks: l.marks.iter().cloned().collect(),
        })
        .filter(|l| l.three || !l.marks.is_empty())
        .collect();
    let gpu = match look3 {
        Some((look, themed)) => {
            let whole = Value::Object(doc.clone());
            let scene = evaluate3(&whole, t, &look, &mut Labels::new())
                .map_err(|r| refused(r.code, r.path))?;
            let seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
            let settings = effects::settings(
                &scene,
                &themed,
                &look,
                &[],
                t as f64 / 705_600_000.0,
                seed,
                effects::Seeding::Item,
            );
            Some((Arc::new(scene), look, settings))
        }
        None => None,
    };
    Ok(Evaluated {
        size,
        doc,
        items,
        record,
        frame,
        layers,
        gpu,
    })
}

/// The live view's refusal naming `item`.
fn missing(item: &str) -> Value {
    json!({"ok": false, "code": "module_missing", "path": format!("items/{item}")})
}

/// The path the live view picks for a layer: GPUI when its paths draw it exactly, the GPU layer
/// for a 3D layer or a Vello GPU feature while Vello GPU is on, else the refusal naming the first
/// item no path draws.
fn path_of(app: &App, l: &Layer2) -> Value {
    if l.three {
        return json!("gpu_layer");
    }
    let marks = || l.marks.iter().map(|m| &**m);
    let Some(item) = layer::gpui_lacks(marks()) else {
        return json!("gpui");
    };
    if !app.vello.enabled {
        return missing(&item);
    }
    gpu::refusal(marks()).unwrap_or_else(|| json!("gpu_layer"))
}

/// A 2D layer's marks drawn by Vello GPU on the app's device, read back.
fn vello_picture(
    app: &App,
    marks: Vec<Arc<Drawn>>,
    size: [u32; 2],
    options: Options,
) -> Result<image::RgbaImage, Value> {
    app.worker.call(move |state| {
        let device = state.gpu.recover().map_err(|e| refused("no_device", e))?;
        let vello = state
            .vello2d
            .get_or_insert_with(|| Vello2d::new(&device.device, wgpu::TextureFormat::Rgba8Unorm));
        let marks: Vec<&Drawn> = marks.iter().map(|m| &**m).collect();
        vello.picture(&device.device, &device.queue, &marks, size, options)
    })
}

/// What one renderer draws of a 2D layer's marks, or why it doesn't.
fn draw2(
    app: &mut App,
    renderer: &str,
    marks: &[Arc<Drawn>],
    size: [u32; 2],
) -> Result<image::RgbaImage, Value> {
    match renderer {
        "vello_cpu" => layer::vello(marks, size),
        "gpu_layer" => {
            if !app.vello.enabled {
                return Err(json!({"ok": false, "code": "vello_gpu_off", "path": "spike"}));
            }
            if let Some(r) = gpu::refusal(marks.iter().map(|m| &**m)) {
                return Err(r);
            }
            let options = Options {
                shifts_fill: app.planted == Some(Planted::ShiftsFillTwoCodes),
                ..Options::default()
            };
            vello_picture(app, marks.to_vec(), size, options)
        }
        _ => {
            if let Some(item) = layer::gpui_lacks(marks.iter().map(|m| &**m)) {
                return Err(missing(&item));
            }
            gpui2(app, marks, size)
        }
    }
}

#[cfg(target_os = "macos")]
fn gpui2(app: &mut App, marks: &[Arc<Drawn>], size: [u32; 2]) -> Result<image::RgbaImage, Value> {
    let planted = layer::Planted {
        shifts_glyphs: app.planted == Some(Planted::ShiftsGlyphQuads),
        paths_apart: app.planted == Some(Planted::SectorsSourceOver),
    };
    layer::gpui(&mut app.cx, marks, size, planted)
}

#[cfg(not(target_os = "macos"))]
fn gpui2(_: &mut App, _: &[Arc<Drawn>], _: [u32; 2]) -> Result<image::RgbaImage, Value> {
    Err(refused(
        "unsupported_platform",
        "GPUI draws a 2D writer layer on its Metal renderer, on macOS",
    ))
}

fn write_png(out: &str, image: &image::RgbaImage) -> Result<String, Value> {
    write_named(
        out,
        &png(image.as_raw(), [image.width(), image.height()])?,
        "png",
    )
}

/// One renderer's side of a layer: its picture and each glyph run and stroke alone, or its
/// refusal.
fn side(app: &mut App, out: &str, renderer: &str, l: &Layer2, ev: &Evaluated) -> Value {
    let mut run = || -> Result<Value, Value> {
        if l.three {
            if renderer != "gpu_layer" {
                return Err(
                    json!({"ok": false, "code": "layer_3d", "path": format!("layers/{}", l.id)}),
                );
            }
            let picture = draw3(app, ev, l)?;
            return Ok(json!({"png": write_png(out, &picture)?, "runs": []}));
        }
        let picture = draw2(app, renderer, &l.marks, ev.size)?;
        let mut runs = Vec::new();
        for r in layer::runs(&l.marks) {
            let mask = draw2(app, renderer, &r.marks, ev.size)?;
            runs.push(json!({"id": r.id, "kind": r.kind, "png": write_png(out, &mask)?}));
        }
        Ok(json!({"png": write_png(out, &picture)?, "runs": runs}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

/// `{"call": "layers", "doc", "look", "t"?, "states"?, "by"}`: each writer layer drawn alone by
/// each renderer `by` names, with its dimension, the live view's path for it and its edges.
pub fn layers(app: &mut App, out: &str, call: &Value) -> Value {
    let mut run = || -> Result<Value, Value> {
        let by: Vec<&str> = call["by"]
            .as_array()
            .ok_or_else(|| refused("bad_input", "by is a list"))?
            .iter()
            .map(|r| match r.as_str() {
                Some(r @ ("gpui" | "gpu_layer" | "vello_cpu")) => Ok(r),
                _ => Err(refused("bad_input", "by: gpui, gpu_layer or vello_cpu")),
            })
            .collect::<Result<_, _>>()?;
        let ev = evaluate(app, call)?;
        let mut listed = Vec::new();
        for l in &ev.layers {
            let mut drawn = Map::new();
            for r in &by {
                drawn.insert(r.to_string(), side(app, out, r, l, &ev));
            }
            let edges = serde_json::to_vec(&layer::edges(&l.marks)?)
                .map_err(|e| refused("not_written", e.to_string()))?;
            listed.push(json!({
                "layer": l.id, "dim": if l.three { "3d" } else { "2d" }, "path": path_of(app, l),
                "edges": write_named(out, &edges, "json")?, "drawn": drawn,
            }));
        }
        Ok(json!({"layers": listed, "backends": backends()}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

fn backends() -> Value {
    deep_canvas_seams::json(&[
        ("gpu", deep_gpu::seam::BACKEND),
        ("fonts", deep_text::FONTS),
        ("cpu", deep_canvas_seams::cpu(std::env::consts::ARCH)),
    ])
}

/// `{"call": "vello_gpu"}`: the renderer, the spike record in force, whether Vello GPU draws and
/// whether its mask layers do.
pub fn vello_gpu(app: &App) -> Value {
    json!({
        "renderer": {"name": "vello_gpu", "version": VELLO_GPU},
        "spike": app.vello.record, "enabled": app.vello.enabled, "mask_layers": MASK_LAYERS,
    })
}

/// A 3D writer layer drawn by the GPU layer: scene3d through the shipped effects, read back, and
/// its 2D items composited over that in linear light.
fn draw3(app: &App, ev: &Evaluated, l: &Layer2) -> Result<image::RgbaImage, Value> {
    let Some((scene, look, settings)) = &ev.gpu else {
        return Err(refused("bad_input", "a 3D layer with no scene"));
    };
    let on = On {
        worker: &app.worker,
        path: Path::Copy,
        backend: app.backend,
        planted: None,
    };
    let rgba = parity::offscreen3(&on, scene.clone(), look.clone(), settings, ev.size)?;
    let base = image::RgbaImage::from_raw(ev.size[0], ev.size[1], rgba)
        .ok_or_else(|| refused("no_read_back", "the 3D layer"))?;
    let marks: Vec<&Drawn> = l.marks.iter().map(|m| &**m).collect();
    linear::over(&base, &marks, ev.size)
}

/// Compositing in linear light, inside a 3D writer layer (Frame and group: blend modes).
mod linear {
    use super::*;

    fn decode(c: u8) -> f64 {
        deep_canvas::color::srgb_decode(f64::from(c) / 255.0)
    }

    fn encode(v: f64) -> u8 {
        (deep_canvas::color::srgb_encode(v.clamp(0.0, 1.0)) * 255.0).round() as u8
    }

    /// A straight sRGB-encoded pixel as linear light, premultiplied.
    fn lin(p: &image::Rgba<u8>) -> [f64; 4] {
        let a = f64::from(p[3]) / 255.0;
        [decode(p[0]) * a, decode(p[1]) * a, decode(p[2]) * a, a]
    }

    fn lum(c: [f64; 3]) -> f64 {
        0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
    }

    fn clip(c: [f64; 3]) -> [f64; 3] {
        let l = lum(c);
        let (n, x) = (c[0].min(c[1]).min(c[2]), c[0].max(c[1]).max(c[2]));
        let mut out = c;
        if n < 0.0 {
            out = out.map(|v| l + (v - l) * l / (l - n));
        }
        if x > 1.0 {
            out = out.map(|v| l + (v - l) * (1.0 - l) / (x - l));
        }
        out
    }

    fn set_lum(c: [f64; 3], l: f64) -> [f64; 3] {
        let d = l - lum(c);
        clip(c.map(|v| v + d))
    }

    fn sat(c: [f64; 3]) -> f64 {
        c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
    }

    fn set_sat(c: [f64; 3], s: f64) -> [f64; 3] {
        let mut i = [0, 1, 2];
        i.sort_by(|a, b| c[*a].total_cmp(&c[*b]));
        let mut out = [0.0; 3];
        if c[i[2]] > c[i[0]] {
            out[i[1]] = (c[i[1]] - c[i[0]]) * s / (c[i[2]] - c[i[0]]);
            out[i[2]] = s;
        }
        out
    }

    /// The W3C Compositing and Blending formula `B(Cb, Cs)` of `mode`.
    fn mix(mode: Blend, cb: [f64; 3], cs: [f64; 3]) -> [f64; 3] {
        let hard = |b: f64, s: f64| {
            if s <= 0.5 {
                b * 2.0 * s
            } else {
                let s = 2.0 * s - 1.0;
                b + s - b * s
            }
        };
        let each = |f: &dyn Fn(f64, f64) -> f64| [0, 1, 2].map(|i| f(cb[i], cs[i]));
        match mode {
            Blend::Normal | Blend::Add => cs,
            Blend::Multiply => each(&|b, s| b * s),
            Blend::Screen => each(&|b, s| b + s - b * s),
            Blend::Overlay => each(&|b, s| hard(s, b)),
            Blend::Darken => each(&f64::min),
            Blend::Lighten => each(&f64::max),
            Blend::ColorDodge => each(&|b, s| {
                if b == 0.0 {
                    0.0
                } else if s >= 1.0 {
                    1.0
                } else {
                    (b / (1.0 - s)).min(1.0)
                }
            }),
            Blend::ColorBurn => each(&|b, s| {
                if b >= 1.0 {
                    1.0
                } else if s == 0.0 {
                    0.0
                } else {
                    1.0 - ((1.0 - b) / s).min(1.0)
                }
            }),
            Blend::HardLight => each(&hard),
            Blend::SoftLight => each(&|b, s| {
                if s <= 0.5 {
                    b - (1.0 - 2.0 * s) * b * (1.0 - b)
                } else {
                    let d = if b <= 0.25 {
                        ((16.0 * b - 12.0) * b + 4.0) * b
                    } else {
                        b.sqrt()
                    };
                    b + (2.0 * s - 1.0) * (d - b)
                }
            }),
            Blend::Difference => each(&|b, s| (b - s).abs()),
            Blend::Exclusion => each(&|b, s| b + s - 2.0 * b * s),
            Blend::Hue => set_lum(set_sat(cs, sat(cb)), lum(cb)),
            Blend::Saturation => set_lum(set_sat(cb, sat(cs)), lum(cb)),
            Blend::Color => set_lum(cs, lum(cb)),
            Blend::Luminosity => set_lum(cb, lum(cs)),
        }
    }

    /// `source` (straight sRGB-encoded) composited into `acc` (linear light, premultiplied) at
    /// `alpha`, in `mode`.
    fn blend_into(acc: &mut [[f64; 4]], source: &image::RgbaImage, alpha: f64, mode: Blend) {
        for (d, p) in acc.iter_mut().zip(source.pixels()) {
            let s = lin(p).map(|v| v * alpha);
            let (ab, as_) = (d[3], s[3]);
            if mode == Blend::Add {
                *d = [0, 1, 2, 3].map(|i| (d[i] + s[i]).min(1.0));
                continue;
            }
            if as_ == 0.0 {
                continue;
            }
            let un = |c: &[f64; 4], a: f64| {
                [0, 1, 2].map(|i| if a > 0.0 { (c[i] / a).min(1.0) } else { 0.0 })
            };
            let b = mix(mode, un(d, ab), un(&s, as_));
            let mut out = [0.0; 4];
            for i in 0..3 {
                out[i] = s[i] * (1.0 - ab) + d[i] * (1.0 - as_) + as_ * ab * b[i];
            }
            out[3] = as_ + ab * (1.0 - as_);
            *d = out;
        }
    }

    /// A 3D writer layer's 2D `marks` over its 3D pixels `base`, every composite in linear light:
    /// each run of marks outside a blended group drawn by Vello CPU and laid over source-over, and
    /// each blended group's content blended in its mode.
    pub fn over(
        base: &image::RgbaImage,
        marks: &[&Drawn],
        size: [u32; 2],
    ) -> Result<image::RgbaImage, Value> {
        let mut acc: Vec<[f64; 4]> = base.pixels().map(lin).collect();
        let picture = |run: Vec<Drawn>| {
            layer::vello(&run.into_iter().map(Arc::new).collect::<Vec<_>>(), size)
        };
        let mut i = 0;
        while i < marks.len() {
            let found = marks[i..].iter().enumerate().find_map(|(k, d)| {
                d.scopes.iter().enumerate().find_map(|(at, s)| match s {
                    Scope::Opacity {
                        item,
                        alpha,
                        blend: Some(b),
                    } => Some((i + k, at, item.clone(), *alpha, *b)),
                    _ => None,
                })
            });
            let (start, end) = match &found {
                Some((start, _, group, ..)) => (
                    *start,
                    marks[*start..]
                        .iter()
                        .position(|d| !d.scopes.iter().any(|s| s.item() == group))
                        .map_or(marks.len(), |n| start + n),
                ),
                None => (marks.len(), marks.len()),
            };
            if start > i {
                let before = picture(marks[i..start].iter().map(|d| (*d).clone()).collect())?;
                blend_into(&mut acc, &before, 1.0, Blend::Normal);
            }
            if let Some((_, at, _, alpha, blend)) = found {
                let inside = marks[start..end]
                    .iter()
                    .map(|d| Drawn {
                        scopes: d.scopes[at + 1..].to_vec(),
                        ..(*d).clone()
                    })
                    .collect();
                blend_into(&mut acc, &picture(inside)?, alpha, blend);
            }
            i = end;
        }
        let mut out = image::RgbaImage::new(size[0], size[1]);
        for (o, p) in out.pixels_mut().zip(&acc) {
            let a = p[3];
            if a > 0.0 {
                *o = image::Rgba([
                    encode(p[0] / a),
                    encode(p[1] / a),
                    encode(p[2] / a),
                    (a * 255.0).round() as u8,
                ]);
            }
        }
        Ok(out)
    }
}

/// A 2D writer layer drawn by Vello GPU into a GPU surface's slot, one pass a frame.
struct Module2 {
    marks: Arc<Vec<Arc<Drawn>>>,
    vello: Option<Arc<Mutex<Vello2d>>>,
    built: Option<u64>,
    options: Options,
    /// The last frame's refusal, if Vello GPU refused to draw it.
    error: Arc<Mutex<Option<Value>>>,
}

impl RenderModule for Module2 {
    fn name(&self) -> &'static str {
        "marks2d.vello_gpu"
    }

    fn declared(&self) -> Vec<&'static str> {
        vec!["renderer:vello_gpu"]
    }

    fn passes(&self) -> Vec<Pass> {
        vec![Pass {
            name: "vello2d".into(),
            place: "geometry",
            order: 0,
            reads: Vec::new(),
            writes: vec!["slot"],
            resolution: Resolution::Full,
            ns_per_px: 0.02,
            determinism: Determinism::SameMachine,
        }]
    }

    fn build(&mut self, device: &Device) -> Result<(), String> {
        self.vello = Some(Arc::new(Mutex::new(Vello2d::new(&device.device, FORMAT))));
        self.built = Some(device.epoch);
        Ok(())
    }

    fn built_on(&self) -> Option<u64> {
        self.built
    }

    fn layers(&mut self, device: &Device, target: &Target) -> Vec<(String, Job)> {
        let Some(vello) = self.vello.clone() else {
            return Vec::new();
        };
        let (dev, queue) = (device.device.clone(), device.queue.clone());
        let (marks, options, error) = (self.marks.clone(), self.options, self.error.clone());
        let target = target.clone();
        let job: Job = Box::new(move |encoder| {
            let mut v = vello.lock().unwrap_or_else(|e| e.into_inner());
            let drawn = v.draw(
                &dev,
                &queue,
                encoder,
                marks.iter().map(|m| &**m),
                target.size,
                &target.view,
                options,
            );
            *error.lock().unwrap_or_else(|e| e.into_inner()) = drawn.err();
        });
        vec![("vello2d".into(), job)]
    }
}

/// Where a 2D surface's last frame leaves Vello GPU's refusal, if it refused.
type Refusal = Arc<Mutex<Option<Value>>>;

/// A 2D layer's GPU surface: a view of [`Module2`] on the render thread, its UI side watched for
/// GPUI's surface reports.
fn open2(
    app: &App,
    marks: Vec<Arc<Drawn>>,
    size: [u32; 2],
) -> Result<(deep_gpu::view::Ui, Refusal), Value> {
    let error = Arc::new(Mutex::new(None));
    let module = Module2 {
        marks: Arc::new(marks),
        vello: None,
        built: None,
        options: Options {
            shifts_fill: app.planted == Some(Planted::ShiftsFillTwoCodes),
            ..Options::default()
        },
        error: error.clone(),
    };
    let path = app.decision.path;
    let ui = app
        .worker
        .call(move |state| -> Result<deep_gpu::view::Ui, String> {
            let config = Config {
                path,
                slots: 3,
                size,
                upload_bytes_per_frame: 64 << 20,
            };
            let view = View::new(state.gpu.clone(), config, Box::new(module), Pool::new(1))?;
            let ui = view.ui();
            state.view2d = Some(view);
            Ok(ui)
        })
        .map_err(|e| refused("no_session", e))?;
    deep_app::gpu_view::watch(&ui);
    Ok((ui, error))
}

/// One frame of the 2D surface rendered, waited for off the UI thread: its slot and the render
/// side's part of the handoff.
fn render2(app: &App, n: u64) -> Result<(usize, Duration), Value> {
    app.worker
        .call(move |state| -> Result<(usize, Duration), String> {
            let view = state.view2d.as_mut().ok_or("no 2D surface")?;
            let drawn = loop {
                if let Some(d) = view.render(n)? {
                    break d;
                }
                view.wait_free();
            };
            view.wait_done(drawn.slot);
            let handoff = view
                .times(drawn.slot)
                .map_or(Duration::ZERO, |t| t.handoff());
            Ok((drawn.slot, handoff))
        })
        .map_err(|e| refused("render_failed", e))
}

fn close2(app: &mut App, ui: &deep_gpu::view::Ui) {
    deep_app::gpu_view::unwatch(ui);
    if let Some(win) = app.window.as_ref() {
        let mut p = win.paint.borrow_mut();
        p.ui = None;
        p.pictures = Default::default();
        p.card = None;
    }
    app.worker.call(|state| state.view2d = None);
}

fn picture_of(image: &image::RgbaImage) -> Arc<gpui_kit::RenderImage> {
    let mut bgra = image.clone();
    for p in bgra.pixels_mut() {
        p.0.swap(0, 2);
    }
    Arc::new(gpui_kit::RenderImage::new([image::Frame::new(bgra)]))
}

/// The window shows the frame `n` the 2D surface rendered, presenting until it does.
fn show(app: &mut App, n: u64) -> Result<(), Value> {
    let started = Instant::now();
    loop {
        let win = app.window.as_ref().expect("opened");
        win.present(&mut app.cx);
        if win.paint.borrow().shown == Some(n) {
            return Ok(());
        }
        if started.elapsed() > Duration::from_secs(10) {
            return Err(refused(
                "not_shown",
                "the window never showed the 2D surface",
            ));
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

/// `{"call": "window2d", "doc", "look", "t"?, "states"?, "card"?}`: the document's view as the
/// app's window shows it, each writer layer on its path (a GPU-layer layer through a surface of its
/// own and the handoff), the status marks and their legend, then the card in its slot.
pub fn window2d(app: &mut App, out: &str, call: &Value) -> Value {
    let run = |app: &mut App| -> Result<Value, Value> {
        let ev = evaluate(app, call)?;
        let mut paths = Vec::new();
        let (mut under, mut over, mut surface) = (Vec::new(), Vec::new(), None);
        for l in &ev.layers {
            let path = path_of(app, l);
            paths.push(json!({"layer": l.id, "path": path}));
            match path.as_str() {
                Some("gpui") => {
                    let picture = picture_of(&gpui2(app, &l.marks, ev.size)?);
                    if surface.is_some() {
                        &mut over
                    } else {
                        &mut under
                    }
                    .push(picture);
                }
                Some("gpu_layer") if !l.three && surface.is_none() => {
                    surface = Some(l.marks.clone())
                }
                Some(_) => {
                    return Err(refused(
                        "bad_input",
                        format!(
                            "window2d shows one 2D layer on the GPU layer; {} is another",
                            l.id
                        ),
                    ))
                }
                None => return Err(path),
            }
        }
        over.push(picture_of(&status_picture(app, call, &ev)?));
        app.window(ev.size)?;
        let opened = match surface {
            Some(marks) => Some(open2(app, marks, ev.size)?),
            None => None,
        };
        {
            let win = app.window.as_ref().expect("opened above");
            let mut p = win.paint.borrow_mut();
            p.page = (32, vec![ev.frame.ground]);
            p.view = [0, 0];
            p.size = ev.size;
            p.card = frames::card_of(call);
            p.waits_on_gpu = false;
            p.overlays.clear();
            p.pairs_newest = false;
            p.ui = opened.as_ref().map(|(ui, _)| ui.clone());
            p.pictures = [under, over];
        }
        let shown = match &opened {
            Some((_, error)) => {
                render2(app, 1)?;
                if let Some(e) = error.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    return Err(e);
                }
                show(app, 1)
            }
            None => {
                app.window.as_ref().expect("opened").present(&mut app.cx);
                Ok(())
            }
        };
        let image = shown.and_then(|()| {
            app.window
                .as_ref()
                .expect("opened")
                .capture(&mut app.cx)
                .map_err(|e| refused("no_capture", e))
        });
        if let Some((ui, _)) = &opened {
            close2(app, ui);
        } else if let Some(win) = app.window.as_ref() {
            let mut p = win.paint.borrow_mut();
            p.pictures = Default::default();
            p.card = None;
        }
        let image = image?;
        Ok(json!({"window": write_png(out, &image)?, "layers": paths}))
    };
    match run(app) {
        Ok(v) | Err(v) => v,
    }
}

#[cfg(target_os = "macos")]
fn status_picture(app: &mut App, call: &Value, ev: &Evaluated) -> Result<image::RgbaImage, Value> {
    layer::status(
        &mut app.cx,
        &ev.doc,
        &ev.items,
        &ev.record,
        &call["look"],
        &ev.frame,
    )
}

#[cfg(not(target_os = "macos"))]
fn status_picture(_: &mut App, _: &Value, _: &Evaluated) -> Result<image::RgbaImage, Value> {
    Err(refused(
        "unsupported_platform",
        "GPUI draws status marks on macOS",
    ))
}

/// `{"call": "spike2d", "doc", "look", "frames"}`: the spike. The document's 2D writer layer
/// drawn by Vello GPU into a GPU surface of its own on the GPU layer's device and shown in the
/// app's window through the handoff, redrawn every frame; each frame's handoff time as #377's
/// frames take it, with its three parts: the render side's (`render_ms`), GPUI's latch and paint
/// on the UI thread (`ui_ms`), and the GPU time GPUI's frame spent past the window's own
/// (`gpu_ms`).
pub fn spike2d(app: &mut App, out: &str, call: &Value) -> Value {
    let _ = out;
    let run = |app: &mut App| -> Result<Value, Value> {
        let count = call["frames"]
            .as_u64()
            .filter(|n| *n > 0)
            .ok_or_else(|| refused("bad_input", "frames is a count"))?;
        let ev = evaluate(app, call)?;
        let l = ev
            .layers
            .iter()
            .find(|l| !l.three)
            .ok_or_else(|| refused("bad_input", "the document has no 2D writer layer"))?;
        app.window(ev.size)?;
        {
            let win = app.window.as_ref().expect("opened above");
            let mut p = win.paint.borrow_mut();
            p.page = (32, vec![ev.frame.ground]);
            p.view = [0, 0];
            p.size = ev.size;
            p.card = None;
            p.waits_on_gpu = false;
            p.overlays.clear();
            p.pairs_newest = false;
            p.ui = None;
        }
        let baseline = frames::baseline_ns(app);
        let (ui, error) = open2(app, l.marks.clone(), ev.size)?;
        app.window.as_ref().expect("opened").paint.borrow_mut().ui = Some(ui.clone());
        ui.record(false);
        ui.take_record();
        ui.record(true);
        let mut listed = Vec::with_capacity(count as usize);
        let timed = (|| -> Result<(), Value> {
            for n in 0..count {
                let (_, render_handoff) = render2(app, n)?;
                if let Some(e) = error.lock().unwrap_or_else(|e| e.into_inner()).take() {
                    return Err(e);
                }
                let win = app.window.as_ref().expect("opened");
                win.present(&mut app.cx);
                let ui_time = win.paint.borrow().ui_time + ui.take_committed();
                frames::gpui_idle();
                let marks = ui.take_record();
                let cb = marks.iter().find_map(|m| match m {
                    RingMark::Sampled { frame, buffer, .. } if *frame == n => Some(*buffer),
                    _ => None,
                });
                let gpu = cb
                    .and_then(|cb| {
                        marks.iter().find_map(|m| match m {
                            RingMark::Completed { buffer, gpu_ns } if *buffer == cb => {
                                Some(*gpu_ns)
                            }
                            _ => None,
                        })
                    })
                    .unwrap_or(0)
                    .saturating_sub(baseline);
                let (render_ms, ui_ms) = (
                    render_handoff.as_secs_f64() * 1e3,
                    ui_time.as_secs_f64() * 1e3,
                );
                let gpu_ms = gpu as f64 / 1e6;
                listed.push(json!({
                    "frame": n, "handoff_ms": render_ms + ui_ms + gpu_ms,
                    "render_ms": render_ms, "ui_ms": ui_ms, "gpu_ms": gpu_ms,
                }));
            }
            Ok(())
        })();
        ui.record(false);
        close2(app, &ui);
        timed?;
        Ok(json!({
            "renderer": {"name": "vello_gpu", "version": VELLO_GPU},
            "size": ev.size, "frames": listed,
        }))
    };
    match run(app) {
        Ok(v) | Err(v) => v,
    }
}
