//! The live-headless calls (issue #140, criterion 6; tests/acceptance/140/view/README.md,
//! "deep-gpu: the live-headless calls" and "parity/gpu/live-headless.scene"). One case of the
//! scene is drawn as the app draws it, `live_frame`: its GPU layer (scene3d through the shipped
//! effects) in a GPU-layer view shown in the app's window, frames run until one reports settled,
//! that frame read back from the slot on screen; and each 2D writer layer by GPUI's frame path.
//! And as the headless canvas worker draws it with the app closed, `snapshot`: the GPU layer into
//! an offscreen slot and each 2D writer layer by Vello CPU. Both sides evaluate the revision
//! through the same code here, so the evaluated data and the visible item table are the same
//! bytes, and each writes its Record's files named by their SHA-256. Whether the pixels agree is
//! the perceptual oracle's to judge, which is test code (design: "Images from two renderers
//! compare through one perceptual oracle").

use std::collections::BTreeMap;
use std::path::Path as FsPath;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas_marks::scene::{self, Drawn, Record};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{corners, evaluate as evaluate3, Labels, Scene};
use deep_effects_render::frame::Settings;
use deep_gpu::device::Backend;
use deep_gpu::surface::Path;
use deep_marks_render::layer;
use serde_json::{json, Map, Value};

use crate::session3::{self, lock, On, Opened};
use crate::view3d::{pair, png, write_named};
use crate::worker::Worker;
use crate::{effects, refused, App, Planted};

const FLICKS_PER_SECOND: f64 = 705_600_000.0;
/// How long `live_frame` runs frames for a settled one when the call names no `timeout_ms`.
const TIMEOUT_MS: u64 = 60_000;
/// One frame of the app's display link at 60 Hz, which paces the live view's frames.
const FRAME: Duration = Duration::from_micros(16_667);

/// One case of a live-headless scene, its paths read relative to the scene file.
struct Case {
    name: String,
    doc: Map<String, Value>,
    look: Value,
    size: [u32; 2],
    /// `t` as the scene writes it, and in flicks.
    t: (Value, i64),
    view: Value,
    theme: String,
}

fn read_json(path: &FsPath) -> Result<Value, Value> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| refused("bad_input", format!("{}: {e}", path.display())))?;
    serde_json::from_str(&text)
        .map_err(|e| refused("bad_input", format!("{}: {e}", path.display())))
}

fn case(call: &Value) -> Result<Case, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let (Some(path), Some(name)) = (call["scene"].as_str(), call["case"].as_str()) else {
        return Err(bad("a call names a scene and a case"));
    };
    let scene = read_json(FsPath::new(path))?;
    let dir = FsPath::new(path).parent().unwrap_or(FsPath::new("."));
    let c = scene["cases"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|c| c["case"] == name)
        .ok_or_else(|| bad("the scene has no such case"))?;
    let size = pair(&c["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    let (Some(doc), Some(look)) = (c["doc"].as_str(), c["look"].as_str()) else {
        return Err(bad("a case names its doc and look"));
    };
    let Value::Object(mut doc) = read_json(&dir.join(doc))? else {
        return Err(bad("doc is an object"));
    };
    doc.insert("size".into(), json!(size));
    let ctx = TimeContext {
        frame_rate: (60, 1),
        ..TimeContext::default()
    };
    let t = c["t"]
        .as_str()
        .and_then(|t| Time::parse(t).ok()?.resolve(&ctx).ok())
        .ok_or_else(|| bad("t is a time"))?;
    let view = c["view"].clone();
    // The comparison is at render scale 1: a zoomed view isn't one of its cases.
    if view["zoom"].as_f64().unwrap_or(1.0) != 1.0 {
        return Err(bad("view: zoom 1"));
    }
    Ok(Case {
        name: name.to_string(),
        doc,
        look: read_json(&dir.join(look))?,
        size,
        t: (c["t"].clone(), t),
        theme: view["theme"].as_str().unwrap_or("light").to_string(),
        view,
    })
}

/// Whether scene3d draws or reads an item (a 3D mark, a light, a camera); every other item is a
/// 2D writer layer's, which marks2d draws.
pub(crate) fn three_d(item: &Value) -> bool {
    let kind = item["kind"].as_str().unwrap_or("");
    kind.starts_with("mark.") || kind.starts_with("light.") || kind.starts_with("camera@")
}

/// What both sides compute from a case, through this same code.
struct Evaluated {
    /// The canonical document's SHA-256: the revision.
    doc: String,
    /// The canonical bytes of the items evaluated at `t`.
    data: Vec<u8>,
    /// The visible item table, as JSON.
    items: Vec<u8>,
    /// Each 2D writer layer that draws something, with its marks at zoom 1.
    layers: Vec<(String, Vec<Arc<Drawn>>)>,
    /// The GPU layer's scene, look and effects, when the document has 3D items.
    gpu: Option<(Arc<Scene>, Look3, Settings)>,
}

fn evaluate(case: &Case) -> Result<Evaluated, Value> {
    let whole = Value::Object(case.doc.clone());
    let doc = deep_canvas::document::canonical(&whole)
        .map_err(|e| refused("bad_input", format!("doc: {e}")))?
        .sha256;
    let program = Program::compile(&case.doc).map_err(|r| refused(r.code, r.path))?;
    let mut state = program.state();
    program.evaluate(case.t.1, eval::Validity::Full, &mut state);
    let items = eval::items(&case.doc, &program, &state);
    let data = deep_canvas::schedule::canonical(&Value::Object(items.clone()));
    // The 2D writer layers' items, drawn by marks2d as both sides draw them.
    let flat: Map<String, Value> = items
        .iter()
        .filter(|(_, v)| !three_d(v))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut flat_doc = case.doc.clone();
    if let Some(Value::Object(listed)) = flat_doc.get_mut("items") {
        listed.retain(|_, v| !three_d(v));
    }
    // A scene's 2D writer layers take their roles from its look as scene3d resolves it, in the
    // view's theme (#382); a 2D document's from its look as marks2d resolves it.
    let look3 = if items.values().any(three_d) {
        let themed = crate::status::themed(&case.look, &case.theme);
        let look = Look3::read(&themed).map_err(|e| refused("bad_input", format!("look: {e}")))?;
        Some((look, themed))
    } else {
        None
    };
    let palette = match &look3 {
        Some((look, _)) => look.roles.clone(),
        None => layer::palette(&case.look, &case.theme)?,
    };
    let record = Record {
        pinned: case.t.1,
        ..Record::default()
    };
    let frame = scene::frame(&flat_doc, &flat, &palette, &record, 1.0)
        .map_err(|r| refused(r.code, r.path))?;
    let layers: Vec<(String, Vec<Arc<Drawn>>)> = frame
        .layers
        .iter()
        .filter(|l| !l.marks.is_empty())
        .map(|l| (l.id.clone(), l.marks.iter().cloned().collect()))
        .collect();
    let gpu = if let Some((look, themed)) = look3 {
        let scene = evaluate3(&whole, case.t.1, &look, &mut Labels::new())
            .map_err(|r| refused(r.code, r.path))?;
        let seed = case.doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
        let settings = effects::settings(
            &scene,
            &themed,
            &look,
            &[],
            case.t.1 as f64 / FLICKS_PER_SECOND,
            seed,
            effects::Seeding::Item,
        );
        Some((Arc::new(scene), look, settings))
    } else {
        None
    };
    let items = table(&layers, gpu.as_ref().map(|g| &*g.0), case.size)?;
    Ok(Evaluated {
        doc,
        data,
        items,
        layers,
        gpu,
    })
}

/// The visible item table (Render-back): each item whose screen box covers some of the frame,
/// `{id, box: [x, y, w, h]}` in device px, sorted by ID. A 2D item's box holds every edge its marks
/// draw; a 3D solid's holds its corners as the camera projects them.
fn table(
    layers: &[(String, Vec<Arc<Drawn>>)],
    scene: Option<&Scene>,
    size: [u32; 2],
) -> Result<Vec<u8>, Value> {
    let mut boxes: BTreeMap<String, [f64; 4]> = BTreeMap::new();
    let mut add = |id: &str, points: &mut dyn Iterator<Item = [f64; 2]>| {
        for [x, y] in points {
            let b = boxes.entry(id.to_string()).or_insert([
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ]);
            *b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
        }
    };
    for drawn in layers.iter().flat_map(|(_, marks)| marks) {
        let id = drawn.mark.item().split('#').next().unwrap_or_default();
        let edges = layer::edges(std::slice::from_ref(drawn))?;
        add(
            id,
            &mut edges.iter().flat_map(|e| [[e[0], e[1]], [e[2], e[3]]]),
        );
    }
    for solid in scene.iter().flat_map(|s| &s.layers).flat_map(|l| &l.solids) {
        let projected: Option<Vec<[f64; 2]>> = corners(&solid.model)
            .into_iter()
            .map(|p| scene?.camera.project(p).map(|q| [q[0], q[1]]))
            .collect();
        if let Some(points) = projected {
            add(&solid.id, &mut points.into_iter());
        }
    }
    let (w, h) = (f64::from(size[0]), f64::from(size[1]));
    let rows: Vec<Value> = boxes
        .into_iter()
        .filter(|(_, b)| b[0] < w && b[1] < h && b[2] > 0.0 && b[3] > 0.0)
        .map(|(id, b)| json!({"id": id, "box": [b[0], b[1], b[2] - b[0], b[3] - b[1]]}))
        .collect();
    serde_json::to_vec(&rows).map_err(|e| refused("not_written", e.to_string()))
}

fn write_png(out: &str, image: &image::RgbaImage) -> Result<String, Value> {
    write_named(
        out,
        &png(image.as_raw(), [image.width(), image.height()])?,
        "png",
    )
}

/// A side's 2D renderer: marks alone over transparent black at the case's size.
type Draw2<'a> = dyn FnMut(&[Arc<Drawn>]) -> Result<image::RgbaImage, Value> + 'a;

/// Each 2D writer layer drawn alone by `draw` with the edges it draws and each glyph run and
/// stroke alone as a coverage mask, written under `out`.
fn layer_records(
    out: &str,
    layers: &[(String, Vec<Arc<Drawn>>)],
    draw: &mut Draw2,
) -> Result<Vec<Value>, Value> {
    let mut records = Vec::with_capacity(layers.len());
    for (id, marks) in layers {
        let picture = write_png(out, &draw(marks)?)?;
        let edges = serde_json::to_vec(&layer::edges(marks)?)
            .map_err(|e| refused("not_written", e.to_string()))?;
        let mut runs = Vec::new();
        for run in layer::runs(marks) {
            let mask = write_png(out, &draw(&run.marks)?)?;
            runs.push(json!({"id": run.id, "kind": run.kind, "png": mask}));
        }
        records.push(json!({
            "layer": id, "png": picture, "edges": write_named(out, &edges, "json")?, "runs": runs,
        }));
    }
    Ok(records)
}

/// The Record: the case's revision, view, size and t, the frame drawn at render scale 1 with no
/// upscaling and not settling, and its files.
fn record(
    case: &Case,
    ev: &Evaluated,
    out: &str,
    gpu: Option<String>,
    layers: Vec<Value>,
    backends: Value,
) -> Result<Value, Value> {
    Ok(json!({
        "case": case.name, "doc": ev.doc, "rev": 1, "t": case.t.0, "size": case.size,
        "view": case.view, "scale": 1, "internal_scale": 1, "upscale": "none", "settling": false,
        "evaluated": write_named(out, &ev.data, "bin")?,
        "items": write_named(out, &ev.items, "json")?,
        "gpu": gpu, "layers": layers, "backends": backends,
    }))
}

/// The GPU layer's session: scene3d through the shipped effects in a GPU-layer view at `size`,
/// at the view's full size (no internal scale, so nothing upscales).
fn open_gpu(on: &On, size: [u32; 2], settings: &Settings) -> Result<Opened, Value> {
    let opened = session3::open_on(on, size, false, false)?;
    lock(&opened.fx).settings = settings.clone();
    Ok(opened)
}

/// BGRA slot bytes as RGBA.
fn rgba(mut bgra: Vec<u8>) -> Vec<u8> {
    for p in bgra.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    bgra
}

/// `fault`: #393's fault fixture, the time a pipeline the document draws with stays compiling.
fn fault(call: &Value) -> Result<Option<Duration>, Value> {
    match &call["fault"] {
        Value::Null => Ok(None),
        f => match (f["holds"].as_str(), f["ms"].as_u64()) {
            (Some("fallback_pipeline"), Some(ms)) => Ok(Some(Duration::from_millis(ms))),
            _ => Err(refused(
                "bad_input",
                "fault is {holds: fallback_pipeline, ms}",
            )),
        },
    }
}

/// `{"call": "live_frame", "scene", "case", "fault"?, "timeout_ms"?}`: the case in a live view in
/// the app's window, frames run until one reports settled, and that frame recorded; `{"settled":
/// false, "reason"}` with nothing written when none settles within the timeout.
pub fn live_frame(app: &mut App, out: &str, call: &Value) -> Value {
    match live(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn live(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let case = case(call)?;
    let held = fault(call)?;
    let timeout = Duration::from_millis(call["timeout_ms"].as_u64().unwrap_or(TIMEOUT_MS));
    let ev = evaluate(&case)?;
    let admitted = Instant::now();
    let opened = match &ev.gpu {
        Some((_, _, settings)) => {
            let opened = open_gpu(&On::of(app), case.size, settings)?;
            deep_app::gpu_view::watch(&opened.ui);
            app.window(case.size)?;
            let win = app.window.as_ref().expect("opened above");
            let mut p = win.paint.borrow_mut();
            p.page = (32, vec![[0, 0, 0]]);
            p.view = [0, 0];
            p.size = case.size;
            p.card = None;
            p.waits_on_gpu = false;
            p.overlays.clear();
            p.pairs_newest = false;
            p.ui = Some(opened.ui.clone());
            Some(opened)
        }
        None => None,
    };
    // Frames run, paced at the display link, until one reports settled: its uploads done, no
    // pipeline it draws with still compiling, and the window showing it.
    let settled = (|| -> Result<Result<Option<usize>, String>, Value> {
        for n in 0.. {
            let started = Instant::now();
            let mut why = None;
            let mut slot = None;
            if let (Some(opened), Some((scene, look, _))) = (&opened, &ev.gpu) {
                let drawn = session3::draw_on(
                    &On::of(app),
                    opened,
                    scene.clone(),
                    look.clone(),
                    n,
                    0,
                    false,
                    false,
                )?;
                let win = app.window.as_ref().expect("opened above");
                win.present(&mut app.cx);
                let shown = win.paint.borrow().shown;
                if drawn.settling {
                    why = Some("its uploads were still pending");
                } else if shown != Some(n) {
                    why = Some("the window didn't show it");
                }
                slot = Some(drawn.slot);
            }
            if held.is_some_and(|ms| admitted.elapsed() < ms) {
                why = Some(
                    "a pipeline it draws with was still compiling (the fault fixture holds \
                     fallback_pipeline), so its items drew with a fallback",
                );
            }
            let Some(why) = why else {
                return Ok(Ok(slot));
            };
            if admitted.elapsed() >= timeout {
                return Ok(Err(format!(
                    "no frame settled within {} ms: on the last, frame {n}, {why}",
                    timeout.as_millis()
                )));
            }
            std::thread::sleep(FRAME.saturating_sub(started.elapsed()));
        }
        unreachable!("frames run until one settles or the timeout passes")
    })();
    // The GPU layer, read back from the slot on screen.
    let read = |app: &mut App, slot: Option<usize>| -> Option<Vec<u8>> {
        let slot = slot?;
        app.worker
            .call(move |state| state.scene3d.as_ref()?.view.read(slot))
    };
    let pixels = match &settled {
        Ok(Ok(slot)) => read(app, *slot),
        _ => None,
    };
    if let Some(opened) = &opened {
        deep_app::gpu_view::unwatch(&opened.ui);
        if let Some(win) = app.window.as_ref() {
            win.paint.borrow_mut().ui = None;
        }
        session3::close(app);
    }
    if let Err(reason) = settled? {
        return Ok(json!({"settled": false, "reason": reason, "record": null}));
    }
    let gpu = match pixels {
        Some(bgra) => {
            let mut pixels = rgba(bgra);
            if app.planted == Some(Planted::ShiftsGpuPixel) {
                // The wrong program: one pixel of the read-back one code off in one channel.
                let at = ((case.size[1] / 2 * case.size[0] + case.size[0] / 2) * 4) as usize;
                pixels[at] = if pixels[at] == 255 {
                    254
                } else {
                    pixels[at] + 1
                };
            }
            Some(write_named(out, &png(&pixels, case.size)?, "png")?)
        }
        None if ev.gpu.is_some() => return Err(refused("no_read_back", "the slot on screen")),
        None => None,
    };
    let layers = gpui_layers(app, out, &ev, case.size)?;
    let backends = deep_canvas_seams::json(&[
        ("gpu", deep_gpu::seam::BACKEND),
        ("fonts", deep_text::FONTS),
        ("cpu", deep_canvas_seams::cpu(std::env::consts::ARCH)),
    ]);
    Ok(json!({"settled": true, "record": record(&case, &ev, out, gpu, layers, backends)?}))
}

/// Each 2D writer layer drawn by GPUI's frame path in the app's GPUI context, on its Metal
/// renderer.
#[cfg(target_os = "macos")]
fn gpui_layers(
    app: &mut App,
    out: &str,
    ev: &Evaluated,
    size: [u32; 2],
) -> Result<Vec<Value>, Value> {
    let cx = &mut app.cx;
    layer_records(out, &ev.layers, &mut |marks| {
        layer::gpui(cx, marks, size, layer::Planted::default())
    })
}

#[cfg(not(target_os = "macos"))]
fn gpui_layers(_: &mut App, _: &str, _: &Evaluated, _: [u32; 2]) -> Result<Vec<Value>, Value> {
    Err(refused(
        "unsupported_platform",
        "GPUI draws a 2D writer layer on its Metal renderer, on macOS",
    ))
}

/// The GPU layer's scene drawn into an offscreen slot at `size` on `on`'s render thread: the first
/// frame that doesn't report settling, read back as RGBA.
pub(crate) fn offscreen3(
    on: &On,
    scene: Arc<Scene>,
    look: Look3,
    settings: &Settings,
    size: [u32; 2],
) -> Result<Vec<u8>, Value> {
    let opened = open_gpu(on, size, settings)?;
    let started = Instant::now();
    let drawn = (|| {
        for n in 0.. {
            let drawn =
                session3::draw_on(on, &opened, scene.clone(), look.clone(), n, 0, false, false)?;
            if !drawn.settling {
                return Ok(drawn);
            }
            if started.elapsed() >= Duration::from_millis(TIMEOUT_MS) {
                break;
            }
        }
        Err(refused(
            "not_settled",
            "the GPU layer's uploads never finished",
        ))
    })();
    session3::close_on(on.worker);
    let bgra = drawn?
        .bytes
        .ok_or_else(|| refused("no_read_back", "the offscreen slot"))?;
    Ok(rgba(bgra))
}

/// `{"call": "snapshot", "scene", "case"}` on the headless canvas worker: the case's GPU layer
/// drawn into an offscreen slot (the first frame that doesn't report settling) and each 2D writer
/// layer by Vello CPU; `{"record": Record}`.
pub fn snapshot(worker: &Worker, backend: Backend, out: &str, call: &Value) -> Value {
    let run = || -> Result<Value, Value> {
        let case = case(call)?;
        let ev = evaluate(&case)?;
        let gpu = match &ev.gpu {
            Some((scene, look, settings)) => {
                let on = On {
                    worker,
                    path: Path::Copy,
                    backend,
                    planted: None,
                };
                let rgba = offscreen3(&on, scene.clone(), look.clone(), settings, case.size)?;
                Some(write_named(out, &png(&rgba, case.size)?, "png")?)
            }
            None => None,
        };
        let size = case.size;
        let layers = layer_records(out, &ev.layers, &mut |marks| layer::vello(marks, size))?;
        let backends = deep_canvas_seams::json(&[
            ("gpu", deep_gpu::seam::BACKEND),
            ("fonts", deep_text::FONTS),
            ("headless", deep_canvas_seams::HEADLESS),
            ("cpu", deep_canvas_seams::cpu(std::env::consts::ARCH)),
        ]);
        Ok(json!({"record": record(&case, &ev, out, gpu, layers, backends)?}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}
