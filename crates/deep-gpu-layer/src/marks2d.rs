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

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use deep_canvas_effects::fx::{self, Named};
use deep_canvas_effects::module::depth_child;
use deep_canvas_marks::scene::{self, Blend, Drawn, Frame, Record, Scope, Type};
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
use deep_scene3d_render::status::{Guard, Mode};
use serde_json::{json, Map, Value};

use crate::drawn::Page;
use crate::groups::{self, Clock, Groups, Picture};
use crate::session3::On;
use crate::view3d::{pair, png, write_named};
use crate::{effects, frames, parity, refused, status, App, Planted};

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
    /// What the layers' groups read: the document's time and seed, the look's roles, and the
    /// status guard where status can show.
    clock: Clock,
    roles: Arc<BTreeMap<String, [f64; 3]>>,
    guard: Option<Guard>,
    packs: Arc<Vec<Named>>,
    /// #149: where the frame's pixels land on its look's paper.
    page: Option<Arc<Page>>,
}

/// The named operators of the packs a call installs, a folder or `{id, dir}` each.
pub(crate) fn packs_of(call: &Value) -> Result<Vec<Named>, Value> {
    let mut out = Vec::new();
    for p in call["packs"].as_array().into_iter().flatten() {
        let dir = p.as_str().or(p["dir"].as_str());
        let dir = dir.ok_or_else(|| refused("bad_input", "a pack is a folder or {id, dir}"))?;
        let path = std::path::Path::new(dir).join("pack.json");
        let text = std::fs::read(&path).map_err(|e| refused("bad_input", format!("{dir}: {e}")))?;
        let manifest = serde_json::from_slice(&text)
            .map_err(|e| refused("bad_input", format!("{dir}: {e}")))?;
        out.extend(fx::named(&manifest));
    }
    Ok(out)
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
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let items = doc["items"].as_object().expect("just read");
        if let Some(child) = depth_child(items, id, item) {
            return Err(refused(
                "operator_kind_rule",
                format!("items/{child}/parent"),
            ));
        }
    }
    let t = call["t"].as_i64().unwrap_or(0);
    let record = Record {
        pinned: t,
        ..deep_marks_render::record(call.as_object().expect("a call is an object"))
            .ok_or_else(|| bad("states"))?
    };
    let program = Program::compile(&doc).map_err(|r| refused(r.code, r.path))?;
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    let mut items = eval::items(&doc, &program, &state);
    // #149: a 2D film's camera places its items, and no 3D layer comes of it.
    let view = deep_canvas_marks::drawn::view_of(&doc, &mut items);
    if let Some(v) = &view {
        deep_canvas_marks::drawn::through(v, &mut items);
    }
    if let Some((pass, collection)) = deep_canvas_effects::module::foreign_read(&doc) {
        return Err(refused(
            "collection_other_writer",
            format!("items/{pass}: reads another writer's collection {collection}"),
        ));
    }
    let flat: Map<String, Value> = items
        .iter()
        .filter(|(_, v)| !parity::three_d(v))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut flat_doc = doc.clone();
    if let Some(Value::Object(listed)) = flat_doc.get_mut("items") {
        listed.retain(|_, v| !parity::three_d(v));
    }
    let ty = drawn_type(app, &call["look"], &doc)?;
    let three: Vec<&str> = items
        .values()
        .filter(|v| parity::three_d(v))
        .filter_map(|v| v["layer"].as_str())
        .collect();
    // A role map (`{light, dark}`) gives a 3D layer its roles with no tone map and unit exposure;
    // a look@1 is read as scene3d reads it.
    let role_map = call["look"].get("light").is_some() && call["look"].get("roles").is_none();
    // A drawn look holds the status distance only where the document shows status (#149).
    let distance = match doc.contains_key("status_bindings") {
        true => deep_canvas_marks::look::Distance::Everywhere,
        false => deep_canvas_marks::look::Distance::WhereStatusShows,
    };
    let drawing = call["look"]["basis"] == "drawing" && call["look"].get("id").is_some();
    let (palette, look3) = if three.is_empty() {
        let at = if drawing {
            distance
        } else {
            deep_canvas_marks::look::Distance::Everywhere
        };
        (layer::palette_where(&call["look"], "light", at)?, None)
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
    let frame = scene::frame_planted(&flat_doc, &flat, (&palette, &ty), &record, 1.0, planted)
        .map_err(|r| refused(r.code, r.path))?;
    let layers = frame
        .layers
        .iter()
        .map(|l| Layer2 {
            id: l.id.clone(),
            three: three.contains(&l.id.as_str()),
            marks: l.marks.iter().cloned().collect(),
        })
        // A layer whose items are all hidden (a flip showing none) is still the film's layer.
        .filter(|l| {
            l.three || !l.marks.is_empty() || flat.values().any(|v| v["layer"] == l.id.as_str())
        })
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
    let roles: BTreeMap<String, [f64; 3]> = palette
        .iter()
        .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
        .collect();
    let page = page_of(&ty, view.as_ref(), &doc, &roles, call)?;
    let guard = match doc.contains_key("status_bindings") {
        true => layer::status_map(&call["look"])?,
        false => None,
    };
    Ok(Evaluated {
        size,
        guard: guard.map(|s| status::guard_of(&s, s.min_distance, Mode::Line)),
        packs: Arc::new(packs_of(call)?),
        clock: Clock::of(&doc, t),
        doc,
        items,
        record,
        frame,
        layers,
        gpu,
        roles: Arc::new(roles),
        page,
    })
}

/// The bare `Type` of a call's look with its drawn fields, for a document of its size (#149).
pub(crate) fn drawn_type(app: &App, look: &Value, doc: &Map<String, Value>) -> Result<Type, Value> {
    let size = pair(&doc["size"]).unwrap_or([0, 0]).map(f64::from);
    let shipped;
    let def = match look {
        Value::String(id) => match deep_canvas_marks::look::shipped(id) {
            Some(d) => {
                shipped = d;
                &shipped
            }
            None => return Ok(Type::default()),
        },
        other => other,
    };
    // A role map isn't a look@1: it has no drawn fields.
    if def.get("roles").is_none() {
        return Ok(Type::default());
    }
    let drawn =
        deep_canvas_marks::drawn::read_look(def, size).map_err(|r| refused(r.code, r.path))?;
    Ok(Type {
        drawn,
        first_rim: app.planted == Some(Planted::RimKeepsFirst),
        flat_ink: app.planted == Some(Planted::InkFillFlat),
        ..Type::default()
    })
}

/// The frame's page under `ty`'s drawn look, when it has one.
pub(crate) fn page_of(
    ty: &Type,
    view: Option<&deep_canvas_marks::drawn::View>,
    doc: &Map<String, Value>,
    roles: &BTreeMap<String, [f64; 3]>,
    call: &Value,
) -> Result<Option<Arc<Page>>, Value> {
    let Some(look) = &ty.drawn else {
        return Ok(None);
    };
    let view = view
        .copied()
        .unwrap_or(deep_canvas_marks::drawn::View::NONE);
    let empty = Map::new();
    let assets = call["assets"].as_object().unwrap_or(&empty);
    Ok(Some(Arc::new(Page::of(look, &view, doc, roles, assets)?)))
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

/// What a drawing on the app's device asks beyond its marks.
#[derive(Default)]
struct Asks {
    options: Options,
    /// A 3D layer's pixels, under its marks.
    base: Option<image::RgbaImage>,
    /// Keep the float pixels and each blend's inputs.
    keep: bool,
    /// `--planted`: the other writers' pixels.
    other: Option<image::RgbaImage>,
}

/// A layer's marks drawn on the app's device, read back: by Vello GPU, or through the group
/// compositor when a group needs it, the call keeps floats or `base` holds a 3D layer's pixels.
fn vello_picture(
    app: &App,
    ev: &Evaluated,
    marks: Vec<Arc<Drawn>>,
    asks: Asks,
) -> Result<Picture, Value> {
    let (size, clock, roles, planted) = (ev.size, ev.clock, ev.roles.clone(), app.planted);
    let (guard, packs) = (ev.guard.clone(), ev.packs.clone());
    let page = ev.page.clone();
    app.worker.call(move |state| {
        let device = state.gpu.recover().map_err(|e| refused("no_device", e))?;
        let vello = state
            .vello2d
            .get_or_insert_with(|| Vello2d::new(&device.device, wgpu::TextureFormat::Rgba8Unorm));
        let Asks {
            options,
            base,
            keep,
            other,
        } = asks;
        if base.is_none() && !keep && !groups::composited(marks.iter().map(|m| &**m)) {
            let marks: Vec<&Drawn> = marks.iter().map(|m| &**m).collect();
            let image = vello.picture(&device.device, &device.queue, &marks, size, options)?;
            return Ok(Picture {
                image,
                floats: None,
                inputs: Vec::new(),
                costs: Vec::new(),
            });
        }
        let layer = groups::Layer {
            layers: &[&marks],
            size,
            options,
            clock,
            roles: &roles,
            packs: &packs,
            canonical: true,
            base: base.as_ref(),
            keep,
            planted,
            guard: guard.as_ref(),
            other: other.as_ref(),
            page: page.as_deref(),
            ground: false,
        };
        state
            .groups
            .get_or_insert_with(|| Groups::new(&device.device))
            .picture(&device, vello, &layer)
    })
}

/// The look's ground alone, as `layers`' `ground` row (#149).
fn ground_row(app: &App, out: &str, ev: &Evaluated) -> Result<Option<Value>, Value> {
    let Some(page) = ev.page.clone() else {
        return Ok(None);
    };
    let size = ev.size;
    let picture = app.worker.call(move |state| {
        let device = state.gpu.recover().map_err(|e| refused("no_device", e))?;
        state
            .groups
            .get_or_insert_with(|| Groups::new(&device.device))
            .ground(&device, &page, size)
    })?;
    let Some(p) = picture else {
        return Ok(None);
    };
    let mut side = json!({"png": write_png(out, &p.image)?});
    kept(out, &mut side, &p)?;
    Ok(Some(
        json!({"layer": "ground", "dim": "2d", "drawn": {"gpu_layer": side}}),
    ))
}

/// Why Vello GPU doesn't draw `marks`, if it doesn't.
fn gate(app: &App, marks: &[Arc<Drawn>]) -> Result<(), Value> {
    if !app.vello.enabled {
        return Err(json!({"ok": false, "code": "vello_gpu_off", "path": "spike"}));
    }
    gpu::refusal(marks.iter().map(|m| &**m)).map_or(Ok(()), Err)
}

/// What one renderer draws of a 2D layer's marks, or why it doesn't.
fn draw2(
    app: &mut App,
    renderer: &str,
    marks: &[Arc<Drawn>],
    ev: &Evaluated,
) -> Result<image::RgbaImage, Value> {
    let size = ev.size;
    match renderer {
        "vello_cpu" => layer::vello(marks, size),
        "gpu_layer" => {
            gate(app, marks)?;
            let options = Options {
                shifts_fill: app.planted == Some(Planted::ShiftsFillTwoCodes),
                ..Options::default()
            };
            let asks = Asks {
                options,
                ..Asks::default()
            };
            Ok(vello_picture(app, ev, marks.to_vec(), asks)?.image)
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

/// What a call keeps of a GPU-layer picture: its float pixels and each blend's inputs.
fn kept(out: &str, side: &mut Value, p: &Picture) -> Result<(), Value> {
    if let Some(floats) = &p.floats {
        side["f32"] = json!(write_named(out, floats, "f32")?);
        let mut listed = Vec::new();
        for i in &p.inputs {
            listed.push(json!({
                "group": i.group, "mode": i.mode,
                "backdrop": write_named(out, &i.backdrop, "f32")?,
                "source": write_named(out, &i.source, "f32")?,
            }));
        }
        side["blend_inputs"] = json!(listed);
    }
    Ok(())
}

/// `--planted`: the writers' layers under `l`, for a backdrop that reads the frame so far.
fn other_writers(app: &App, l: &Layer2, ev: &Evaluated) -> Result<Option<image::RgbaImage>, Value> {
    if app.planted != Some(Planted::BackdropReadsOtherWriter) {
        return Ok(None);
    }
    let mut under = image::RgbaImage::new(ev.size[0], ev.size[1]);
    for below in ev.layers.iter().take_while(|b| b.id != l.id) {
        image::imageops::overlay(&mut under, &layer::vello(&below.marks, ev.size)?, 0, 0);
    }
    Ok(Some(under))
}

/// One renderer's side of a layer: its picture and each glyph run and stroke alone, or its
/// refusal.
fn side(
    app: &mut App,
    out: &str,
    renderer: &str,
    l: &Layer2,
    ev: &Evaluated,
    float: bool,
) -> Value {
    let mut run = || -> Result<Value, Value> {
        if l.three {
            if renderer != "gpu_layer" {
                return Err(
                    json!({"ok": false, "code": "layer_3d", "path": format!("layers/{}", l.id)}),
                );
            }
            let picture = draw3(app, ev, l, float)?;
            let mut side = json!({"png": write_png(out, &picture.image)?, "runs": []});
            kept(out, &mut side, &picture)?;
            return Ok(side);
        }
        let other = other_writers(app, l, ev)?;
        let (picture, whole) = if renderer == "gpu_layer" && (float || other.is_some()) {
            gate(app, &l.marks)?;
            let asks = Asks {
                keep: float,
                other,
                ..Asks::default()
            };
            let p = vello_picture(app, ev, l.marks.clone(), asks)?;
            (p.image.clone(), Some(p))
        } else {
            (draw2(app, renderer, &l.marks, ev)?, None)
        };
        let mut runs = Vec::new();
        for r in layer::runs(&l.marks) {
            let mask = draw2(app, renderer, &r.marks, ev)?;
            runs.push(json!({"id": r.id, "kind": r.kind, "png": write_png(out, &mask)?}));
        }
        let mut side = json!({"png": write_png(out, &picture)?, "runs": runs});
        if let Some(p) = &whole {
            kept(out, &mut side, p)?;
            side["target_costs"] = json!(p.costs);
        }
        Ok(side)
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

/// `{"call": "layers", "doc", "look", "t"?, "states"?, "by", "float"?, "packs"?}`: each writer
/// layer drawn alone by each renderer `by` names, with its dimension, the live view's path for it
/// and its edges. With `float`, a GPU-layer side adds what the layer holds as an f32 file and each
/// blended group's inputs.
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
                let float = call["float"] == true;
                drawn.insert(r.to_string(), side(app, out, r, l, &ev, float));
            }
            let edges = serde_json::to_vec(&layer::edges(&l.marks)?)
                .map_err(|e| refused("not_written", e.to_string()))?;
            listed.push(json!({
                "layer": l.id, "dim": if l.three { "3d" } else { "2d" }, "path": path_of(app, l),
                "edges": write_named(out, &edges, "json")?, "drawn": drawn,
            }));
        }
        if call["ground"] == true {
            listed.extend(ground_row(app, out, &ev)?);
        }
        let mut reply = json!({"layers": listed, "backends": backends()});
        if call["target_costs"] == true {
            let rows = listed_costs(&reply);
            reply["target_costs"] = json!(rows);
        }
        Ok(reply)
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

/// Every collection target the reply's sides drew.
fn listed_costs(reply: &Value) -> Vec<Value> {
    let rows = reply["layers"].as_array().into_iter().flatten();
    rows.flat_map(|l| {
        l["drawn"]["gpu_layer"]["target_costs"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    })
    .collect()
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
fn draw3(app: &App, ev: &Evaluated, l: &Layer2, keep: bool) -> Result<Picture, Value> {
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
    if keep || groups::composited(l.marks.iter().map(|m| &**m)) {
        let asks = Asks {
            base: Some(base),
            keep,
            other: other_writers(app, l, ev)?,
            ..Asks::default()
        };
        return vello_picture(app, ev, l.marks.clone(), asks);
    }
    let marks: Vec<&Drawn> = l.marks.iter().map(|m| &**m).collect();
    let image = linear::over(&base, &marks, ev.size)?;
    Ok(Picture {
        image,
        floats: None,
        inputs: Vec::new(),
        costs: Vec::new(),
    })
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
            let number = deep_canvas::blend::index(mode.name()).unwrap_or(0);
            let b = deep_canvas::blend::mix(number, un(d, ab), un(&s, as_));
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
                        ..
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

/// The marks a 2D surface draws, which the film's frames replace (#417).
pub(crate) type Marks2 = Arc<Mutex<Arc<Frame2>>>;

/// One frame of a 2D surface: each writer layer's marks and what its groups read.
pub(crate) struct Frame2 {
    pub layers: Vec<Vec<Arc<Drawn>>>,
    pub clock: Clock,
    pub roles: Arc<BTreeMap<String, [f64; 3]>>,
    pub guard: Option<Guard>,
    pub packs: Arc<Vec<Named>>,
    /// #149: where the frame's pixels land on its look's paper.
    pub page: Option<Arc<Page>>,
    /// #464: the look's print finish for this frame, when it prints anything.
    pub print: Option<Arc<crate::print2d::Printing>>,
    /// #464: an indexed look's frame, which the index operator draws in place of Vello GPU.
    pub indexed: Option<Arc<crate::indexed::IndexFrame>>,
    /// #462: the other looks this frame mixes with its own, through its shot's look regions.
    pub mix: Option<Arc<Mix2>>,
}

/// #462: a 2D frame's look regions: each other look's frame, in the mix's key order after this
/// frame's own, and the mix the composite pass reads.
pub(crate) struct Mix2 {
    pub frames: Vec<Arc<Frame2>>,
    pub mix: crate::regions::Mix,
}

impl Frame2 {
    fn marks(&self) -> impl Iterator<Item = &Drawn> + Clone {
        self.layers.iter().flatten().map(|m| &**m)
    }
}

/// A 2D writer layer drawn by Vello GPU into a GPU surface's slot, one pass a frame.
struct Module2 {
    marks: Marks2,
    /// What draws the frame's own look, and each other look a frame mixes (#462).
    painter: Painter,
    mixed: Vec<Painter>,
    planted: Option<Planted>,
    vello: Option<Arc<Mutex<Vello2d>>>,
    built: Option<u64>,
    options: Options,
    /// The last frame's refusal, if Vello GPU refused to draw it.
    error: Arc<Mutex<Option<Value>>>,
    /// When the film's frame finished encoding Vello GPU's passes (#417).
    encoded: Option<crate::film::Encoded>,
    /// #464: what the call reads back.
    taps: crate::print2d::Taps,
    /// #462: each mixed look's render target, and the composite that mixes them into the slot.
    targets: Vec<(wgpu::Texture, wgpu::TextureView)>,
    composite: Arc<Mutex<crate::regions::Composite>>,
}

/// What draws one look's frame: its composited groups, its print stage and its index operator,
/// kept from frame to frame.
#[derive(Default)]
struct Painter {
    groups: Option<Arc<Mutex<Groups>>>,
    /// `--planted`: frames it drew.
    played: u64,
    /// #464: the textures a printed frame draws through.
    stage: Option<Arc<crate::print2d::Stage>>,
    indexer: Option<Arc<Mutex<crate::indexed::Indexer>>>,
}

/// One look's draw, recorded into an encoder when the frame's job runs.
type Draw = Box<dyn FnOnce(&mut wgpu::CommandEncoder) -> Result<(), Value> + Send>;

impl Painter {
    /// Prepares `frame`'s draw into `target` of `size`, in the slot's format; `taps` reads its
    /// linear and index targets back.
    #[allow(clippy::too_many_arguments)]
    fn draw(
        &mut self,
        device: &Device,
        vello: &Arc<Mutex<Vello2d>>,
        frame: Arc<Frame2>,
        target: wgpu::TextureView,
        size: [u32; 2],
        options: Options,
        planted: Option<Planted>,
        taps: crate::print2d::Taps,
    ) -> Draw {
        let vello = vello.clone();
        let (dev, queue) = (device.device.clone(), device.queue.clone());
        // A composited group's passes record ahead of the frame, on their own command buffers.
        let on_paper = frame
            .page
            .as_ref()
            .is_some_and(|p| p.sheet.is_some() || p.relief.is_some());
        let groups = (on_paper || groups::composited(frame.marks())).then(|| {
            let mut clock = frame.clock;
            if planted == Some(Planted::DissolveReadsPlayback) {
                clock.t = (self.played * groups::FLICKS as u64 / 60) as i64;
            }
            self.played += 1;
            let layers: Vec<&[Arc<Drawn>]> = frame.layers.iter().map(Vec::as_slice).collect();
            let layer = groups::Layer {
                layers: &layers,
                size,
                options,
                clock,
                roles: &frame.roles,
                packs: &frame.packs,
                canonical: false,
                base: None,
                keep: false,
                planted,
                guard: frame.guard.as_ref(),
                other: None,
                page: frame.page.as_deref(),
                ground: true,
            };
            let mut v = vello.lock().unwrap_or_else(|e| e.into_inner());
            let g = self
                .groups
                .get_or_insert_with(|| Arc::new(Mutex::new(Groups::new(&device.device))));
            let done = g
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .compose(device, &mut v, &layer)
                .map(|(done, ..)| done);
            (g.clone(), done)
        });
        // #464: a printed frame draws its base and each ink's coverage into the stage, and the
        // finish prints them into the target.
        let printing = frame.print.clone();
        let wants_linear = taps.wants_linear();
        let stage = printing.as_ref().map(|p| {
            let kept = self.stage.take().and_then(|s| Arc::try_unwrap(s).ok());
            let s = Arc::new(crate::print2d::Stage::ensure(
                kept,
                &device.device,
                FORMAT,
                size,
                p.print.separations.len(),
                wants_linear,
            ));
            self.stage = Some(s.clone());
            s
        });
        let indexer = self
            .indexer
            .get_or_insert_with(|| {
                Arc::new(Mutex::new(crate::indexed::Indexer::new(&device.device)))
            })
            .clone();
        Box::new(move |encoder| {
            let base = stage.as_ref().map_or(&target, |s| &s.source.1);
            let inked = printing.as_ref().map(|p| p.inked()).unwrap_or_default();
            // Each ink's coverage first, each Vello GPU draw on its own encoder and submit, since
            // its uploads land before any encoder that shares its buffers runs (#430).
            let mut inks = Ok(());
            if let (Some(p), Some(s)) = (&printing, &stage) {
                for (k, items) in p.inks.iter().enumerate() {
                    let mut own = dev.create_command_encoder(&Default::default());
                    inks = inks.and(vello.lock().unwrap_or_else(|e| e.into_inner()).draw(
                        &dev,
                        &queue,
                        &mut own,
                        frame.marks().filter(|d| items.contains(d.mark.item())),
                        size,
                        &s.covs[k].1,
                        options,
                    ));
                    queue.submit([own.finish()]);
                }
            }
            let drawn = match (groups, &frame.indexed) {
                // #464: an indexed look draws its marks through the index operator.
                (_, Some(f)) => {
                    let mut ix = indexer.lock().unwrap_or_else(|e| e.into_inner());
                    ix.record(&dev, encoder, f, base, FORMAT, &taps.indices);
                    Ok(())
                }
                (Some((g, done)), None) => done.map(|done| {
                    let mut g = g.lock().unwrap_or_else(|e| e.into_inner());
                    g.finish(&dev, encoder, &done, base, FORMAT, false);
                }),
                (None, None) => vello.lock().unwrap_or_else(|e| e.into_inner()).draw(
                    &dev,
                    &queue,
                    encoder,
                    frame.marks().filter(|d| !inked.contains(d.mark.item())),
                    size,
                    base,
                    options,
                ),
            };
            let drawn = drawn.and(inks);
            if let (Ok(()), Some(p), Some(s)) = (&drawn, &printing, &stage) {
                s.record(&dev, encoder, p, &target, FORMAT, wants_linear);
                if let Some((t, _)) = s.linear.as_ref().filter(|_| wants_linear) {
                    *taps.linear.lock().unwrap_or_else(|e| e.into_inner()) =
                        Some((t.clone(), size));
                }
            }
            drawn
        })
    }
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
        let frame = self.marks.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let (options, planted) = (self.options, self.planted);
        let (error, encoded) = (self.error.clone(), self.encoded.clone());
        let size = target.size;
        let Some(mix) = frame.mix.clone() else {
            let draw = self.painter.draw(
                device,
                &vello,
                frame,
                target.view.clone(),
                size,
                options,
                planted,
                self.taps.clone(),
            );
            let job: Job = Box::new(move |encoder| {
                let drawn = draw(encoder);
                if let Some(at) = &encoded {
                    *at.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                }
                *error.lock().unwrap_or_else(|e| e.into_inner()) = drawn.err();
            });
            return vec![("vello2d".into(), job)];
        };
        // #462: each look the frame mixes draws whole into its own target, then the composite
        // mixes them into the slot.
        let looks = 1 + mix.frames.len();
        self.targets
            .retain(|(t, _)| t.width() == size[0] && t.height() == size[1]);
        while self.targets.len() < looks {
            let t = crate::regions::scratch(&device.device, size, "look.regions render");
            let v = t.create_view(&Default::default());
            self.targets.push((t, v));
        }
        self.mixed.resize_with(mix.frames.len(), Painter::default);
        let mut draws = vec![self.painter.draw(
            device,
            &vello,
            frame,
            self.targets[0].1.clone(),
            size,
            options,
            planted,
            self.taps.clone(),
        )];
        for (j, f) in mix.frames.iter().enumerate() {
            draws.push(self.mixed[j].draw(
                device,
                &vello,
                f.clone(),
                self.targets[j + 1].1.clone(),
                size,
                options,
                planted,
                crate::print2d::Taps::default(),
            ));
        }
        let views: Vec<wgpu::TextureView> = self.targets[..looks]
            .iter()
            .map(|(_, v)| v.clone())
            .collect();
        let (dev, queue) = (device.device.clone(), device.queue.clone());
        let composite = self.composite.clone();
        let slot = target.view.clone();
        let job: Job = Box::new(move |encoder| {
            // Each look on its own encoder and submit: their draws share Vello GPU's buffers.
            let mut drawn = Ok(());
            for d in draws {
                let mut own = dev.create_command_encoder(&Default::default());
                drawn = drawn.and(d(&mut own));
                queue.submit([own.finish()]);
            }
            let refs: Vec<&wgpu::TextureView> = views.iter().collect();
            composite.lock().unwrap_or_else(|e| e.into_inner()).record(
                &dev,
                encoder,
                &mix.mix,
                &refs,
                crate::regions::Depth::None,
                &slot,
                None,
            );
            if let Some(at) = &encoded {
                *at.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            }
            *error.lock().unwrap_or_else(|e| e.into_inner()) = drawn.err();
        });
        vec![("vello2d".into(), job)]
    }
}

/// Where a 2D surface's last frame leaves Vello GPU's refusal, if it refused.
pub(crate) type Refusal = Arc<Mutex<Option<Value>>>;

/// A 2D layer's GPU surface: a view of [`Module2`] on the render thread, its UI side watched for
/// GPUI's surface reports; with `encoded`, when each frame's Vello GPU passes were encoded (#417).
pub(crate) fn open2(
    app: &App,
    marks: Marks2,
    size: [u32; 2],
    encoded: Option<crate::film::Encoded>,
    taps: crate::print2d::Taps,
) -> Result<(deep_gpu::view::Ui, Refusal), Value> {
    let error = Arc::new(Mutex::new(None));
    let module = Module2 {
        marks,
        painter: Painter::default(),
        mixed: Vec::new(),
        planted: app.planted,
        vello: None,
        built: None,
        options: Options {
            shifts_fill: app.planted == Some(Planted::ShiftsFillTwoCodes),
            ..Options::default()
        },
        error: error.clone(),
        encoded,
        taps,
        targets: Vec::new(),
        composite: Default::default(),
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

pub(crate) fn close2(app: &mut App, ui: &deep_gpu::view::Ui) {
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
pub(crate) fn show(app: &mut App, n: u64) -> Result<(), Value> {
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
        let frame2 = |marks| Frame2 {
            layers: vec![marks],
            clock: ev.clock,
            roles: ev.roles.clone(),
            guard: ev.guard.clone(),
            packs: ev.packs.clone(),
            page: ev.page.clone(),
            print: None,
            indexed: None,
            mix: None,
        };
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
                    surface = Some(status_in_backdrop(app, call, &ev, l.marks.clone())?)
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
            Some(marks) => Some(open2(
                app,
                Arc::new(Mutex::new(Arc::new(frame2(marks)))),
                ev.size,
                None,
                Default::default(),
            )?),
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

/// `--planted`: each status mark drawn into the layer, before its first backdrop group.
fn status_in_backdrop(
    app: &App,
    call: &Value,
    ev: &Evaluated,
    mut marks: Vec<Arc<Drawn>>,
) -> Result<Vec<Arc<Drawn>>, Value> {
    if app.planted != Some(Planted::BackdropReadsStatus) {
        return Ok(marks);
    }
    let status = layer::status_marks(&ev.doc, &ev.items, &ev.record, &call["look"])?;
    let at = marks
        .iter()
        .position(|d| {
            d.scopes
                .iter()
                .any(|s| matches!(s, Scope::Opacity { effect: Some(e), .. } if e.backdrop))
        })
        .unwrap_or(marks.len());
    for m in status {
        let mark = scene::Mark::Rect {
            item: m.item,
            bounds: m.bounds,
            radius: m.radius,
            fill: scene::Fill::Solid(m.color),
        };
        marks.insert(
            at,
            Arc::new(Drawn {
                mark,
                clip: None,
                scopes: Vec::new(),
            }),
        );
    }
    Ok(marks)
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
        let frame = Frame2 {
            layers: vec![l.marks.clone()],
            clock: ev.clock,
            roles: ev.roles.clone(),
            guard: ev.guard.clone(),
            packs: ev.packs.clone(),
            page: ev.page.clone(),
            print: None,
            indexed: None,
            mix: None,
        };
        let (ui, error) = open2(
            app,
            Arc::new(Mutex::new(Arc::new(frame))),
            ev.size,
            None,
            Default::default(),
        )?;
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
