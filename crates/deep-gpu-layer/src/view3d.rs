//! The `view3d` call (issue #378; tests/acceptance/378/README.md, The view3d call): a document's
//! 3D writer layers drawn by scene3d's render module through a GPU-layer view, frame n at
//! t = n ÷ fps on a virtual clock, with the writers' patches applied before the frames they name.
//! With a window, the view sits over a flat page and its 2D writer layers anchored to 3D items
//! draw over it from the evaluated data of the `frame_seq` the shown slot carries. Items that
//! open deeper documents by reference load them as they come on screen (#383), and with
//! `timings` each frame reports its GPU time and the GPU memory the device holds.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex, MutexGuard};

use deep_canvas::document::{apply_ops, writer_layer, Writing};
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{evaluate, Labels};
use deep_gpu::device::Backend;
use deep_gpu::encode::Pool;
use deep_gpu::view::{Config, View};
use deep_scene3d_render::{Counts, Module3, Planted as Planted3};
use image::ImageEncoder as _;
use serde_json::{json, Map, Value};

use crate::frames::{hex, Capture};
use crate::levels::Levels;
use crate::window::OverlayPicture;
use crate::worker::{Scene3Session, SLOTS, WORKERS};
use crate::{refused, App, Planted};

const FLICKS_PER_SECOND: u64 = 705_600_000;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

struct Window3 {
    size: [u32; 2],
    view: [u32; 2],
    page: [u8; 3],
}

struct Args {
    doc: Value,
    look: Look3,
    size: [u32; 2],
    frames: u64,
    fps: u64,
    /// `(frame, writer, ops)`, in the call's order.
    patches: Vec<(u64, String, Value)>,
    targets: BTreeSet<String>,
    capture: Capture,
    window: Option<Window3>,
    latency: Vec<u64>,
    counts: bool,
    /// The documents an item may open by reference, by doc handle.
    docs: BTreeMap<String, std::path::PathBuf>,
    timings: bool,
}

fn pair(v: &Value) -> Option<[u32; 2]> {
    let a = v.as_array()?;
    if a.len() != 2 {
        return None;
    }
    Some([
        u32::try_from(a[0].as_u64()?).ok()?,
        u32::try_from(a[1].as_u64()?).ok()?,
    ])
}

fn parse(call: &Value) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    let look = Look3::read(&call["look"]).map_err(|e| bad(&format!("look: {e}")))?;
    let size = pair(&call["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
    }
    let frames = call["frames"].as_u64().unwrap_or(1).max(1);
    let fps = call["fps"].as_u64().unwrap_or(60).max(1);
    let mut patches = Vec::new();
    for p in call["patches"].as_array().into_iter().flatten() {
        let (Some(frame), Some(writer)) = (p["frame"].as_u64(), p["writer"].as_str()) else {
            return Err(bad("a patch is {frame, writer, ops}"));
        };
        patches.push((frame, writer.to_string(), p["ops"].clone()));
    }
    let targets = call["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if targets
        .iter()
        .any(|t| !matches!(t.as_str(), "final" | "linear" | "ids"))
    {
        return Err(bad("targets are final, linear and ids"));
    }
    let capture = match &call["capture"] {
        Value::String(s) if s == "every" => Capture::Every,
        Value::Array(f) => Capture::Frames(f.iter().filter_map(Value::as_u64).collect()),
        _ => Capture::None,
    };
    let window = match call.get("window") {
        None | Some(Value::Null) => None,
        Some(w) => {
            let page = w["page"].as_array().filter(|p| p.len() == 3).and_then(|p| {
                Some([
                    u8::try_from(p[0].as_u64()?).ok()?,
                    u8::try_from(p[1].as_u64()?).ok()?,
                    u8::try_from(p[2].as_u64()?).ok()?,
                ])
            });
            match (pair(&w["size"]), pair(&w["view"]), page) {
                (Some(size), Some(view), Some(page)) => Some(Window3 { size, view, page }),
                _ => return Err(bad("window is {size, view, page}")),
            }
        }
    };
    let latency = call["latency"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect();
    let docs = match call.get("docs") {
        None | Some(Value::Null) => BTreeMap::new(),
        Some(Value::Object(d)) => d
            .iter()
            .map(|(h, p)| Some((h.clone(), std::path::PathBuf::from(p.as_str()?))))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("docs maps a doc handle to a path"))?,
        Some(_) => return Err(bad("docs maps a doc handle to a path")),
    };
    Ok(Args {
        docs,
        timings: call["timings"].as_bool().unwrap_or(false),
        doc,
        look,
        size,
        frames,
        fps,
        patches,
        targets,
        capture,
        window,
        latency,
        counts: call["counts"].as_bool().unwrap_or(false),
    })
}

/// A patch's ops applied as `writer`, to the layer its connection stands for.
fn apply_patch(doc: &mut Value, writer: &str, ops: &Value, seq: usize) -> Result<(), Value> {
    let layer = writer_layer(doc, writer).map_err(|i| refused(i.code, i.what.clone()))?;
    let id = doc["id"].as_str().unwrap_or_default().to_string();
    let patch = json!({
        "patch": format!("01JB7F0000000000000000{seq:04}"),
        "doc": id,
        "base": 0,
        "reason": "a view3d patch",
        "ops": ops,
    });
    let knows = |_: &str| true;
    let writing = Writing {
        layer: &layer,
        writer,
        you: false,
        base: None,
        knows: &knows,
    };
    apply_ops(doc, &patch, "patches/0", &id, &writing)
        .map(|_| ())
        .map_err(|i| refused(i.code, format!("{}: {}", i.path, i.what)))
}

/// An anchored 2D overlay as the picture GPUI paints: BGRA, placed on a whole pixel.
fn overlay_picture(o: &deep_canvas_scene3d::scene::Overlay) -> Option<OverlayPicture> {
    let p = deep_canvas_scene3d::overlay::picture(o)?;
    let mut bgra = p.rgba;
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
    }
    let frame = image::RgbaImage::from_raw(u32::from(p.size[0]), u32::from(p.size[1]), bgra)?;
    Some(OverlayPicture {
        at: p.at,
        size: p.size,
        image: Arc::new(gpui_kit::RenderImage::new([image::Frame::new(frame)])),
    })
}

fn png(rgba: &[u8], size: [u32; 2]) -> Result<Vec<u8>, Value> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut out,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Sub,
    )
    .write_image(rgba, size[0], size[1], image::ExtendedColorType::Rgba8)
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(out)
}

/// Writes `bytes` under `out`, named by their SHA-256 with `ext`; returns the name.
fn write_named(out: &str, bytes: &[u8], ext: &str) -> Result<String, Value> {
    let name = hex(bytes);
    std::fs::write(
        std::path::Path::new(out).join(format!("{name}.{ext}")),
        bytes,
    )
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(name)
}

/// What the render thread answers for one frame.
struct Drawn {
    slot: usize,
    counts: Counts,
    picks: Vec<(String, u32)>,
    /// The slot's BGRA bytes.
    bytes: Option<Vec<u8>>,
    targets: Option<(Vec<u8>, Vec<u8>)>,
    /// With timings: the frame's GPU ms and the GPU memory the device holds.
    timed: Option<(Option<f64>, Option<u64>)>,
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn planted3(p: Option<Planted>) -> Planted3 {
    Planted3 {
        forward_z: p == Some(Planted::ForwardZ),
        encodes_twice: p == Some(Planted::EncodesTwice),
        skips_encode: p == Some(Planted::SkipsEncode),
        encodes_every_frame: p == Some(Planted::EncodesEveryFrame),
        replays_after_add: p == Some(Planted::ReplaysAfterAdd),
        slow_gpu_frame: p == Some(Planted::SlowGpuFrame),
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let mut args = parse(call)?;
    let noop = app.backend == Backend::Noop;
    let planted = planted3(app.planted);
    let path = app.decision.path;
    let size = args.size;
    let ui = app
        .worker
        .call(move |state| -> Result<_, String> {
            let (module, shared) = Module3::new(planted);
            let config = Config {
                path,
                slots: SLOTS,
                size,
                upload_bytes_per_frame: 64 << 20,
            };
            let view = View::new(
                state.gpu.clone(),
                config,
                Box::new(module),
                Pool::new(WORKERS),
            )?;
            let ui = view.ui();
            state.scene3d = Some(Scene3Session { view, shared });
            Ok(ui)
        })
        .map_err(|e| refused("no_session", e))?;
    if let Some(w) = &args.window {
        deep_app::gpu_view::watch(&ui);
        app.window(w.size)?;
        let win = app.window.as_ref().expect("opened above");
        let mut p = win.paint.borrow_mut();
        p.page = (32, vec![w.page]);
        p.view = w.view;
        p.size = size;
        p.card = None;
        p.waits_on_gpu = false;
        p.overlays.clear();
        p.pairs_newest = app.planted == Some(Planted::PairsNewestSlot);
        p.ui = Some(ui.clone());
    }
    let mut labels = Labels::new();
    let mut frames = Vec::new();
    // Held slots, each with the frame whose present releases it.
    let mut held: Vec<(u64, usize)> = Vec::new();
    let wants_targets = args.targets.contains("linear") || args.targets.contains("ids");
    let mut levels = Levels::new(
        std::mem::take(&mut args.docs),
        app.planted == Some(Planted::LoadsEverything),
    );
    let result = (|| -> Result<(), Value> {
        for n in 0..args.frames {
            for (k, (frame, writer, ops)) in args.patches.iter().enumerate() {
                if *frame == n {
                    apply_patch(&mut args.doc, writer, ops, k)?;
                }
            }
            let t = (n * FLICKS_PER_SECOND / args.fps) as i64;
            levels.collect();
            let (composed, resident) = levels.compose(&args.doc);
            let scene = Arc::new(
                evaluate(&composed, t, &args.look, &mut labels)
                    .map_err(|r| refused(r.code, r.path))?,
            );
            let selected = levels.select(&composed, &scene);
            let settled = levels.settle(&selected);
            if let Some(win) = app.window.as_ref().filter(|_| args.window.is_some()) {
                let pictures = scene.overlays.iter().filter_map(overlay_picture).collect();
                let mut p = win.paint.borrow_mut();
                p.overlays.insert(n, pictures);
                p.current = n;
            }
            let delay = if args.latency.is_empty() {
                0
            } else {
                args.latency[(n as usize) % args.latency.len()]
            };
            let capture = args.capture.wants(n);
            let read_targets = capture && wants_targets && !noop;
            let look = args.look.clone();
            let timings = args.timings;
            let drawn = app
                .worker
                .call(move |state| -> Result<Drawn, String> {
                    let s = state.scene3d.as_mut().ok_or("no session")?;
                    lock(&s.shared).next = Some((scene, look));
                    if delay > 0 {
                        s.view.hold_next();
                    }
                    let drawn = loop {
                        if let Some(d) = s.view.render(n)? {
                            break d;
                        }
                        s.view.wait_free();
                    };
                    s.view.wait_done(drawn.slot);
                    let bytes = (!noop).then(|| s.view.read(drawn.slot)).flatten();
                    let device = s.view.device().clone();
                    let shared = lock(&s.shared);
                    let r = shared.renderer.as_ref().ok_or("no renderer")?;
                    Ok(Drawn {
                        timed: timings.then(|| (r.gpu_ms(&device), device.allocated_bytes())),
                        slot: drawn.slot,
                        counts: r.counts().clone(),
                        picks: r.picks().iter().map(|(k, v)| (k.clone(), *v)).collect(),
                        bytes,
                        targets: if read_targets {
                            r.read_targets(&device)
                        } else {
                            None
                        },
                    })
                })
                .map_err(|e| refused("render_failed", e))?;
            if delay > 0 {
                held.push((n + delay, drawn.slot));
            }
            // A held slot turns ready when the frame its hold names is presented.
            let due: Vec<usize> = held
                .iter()
                .filter(|(f, _)| *f == n)
                .map(|(_, s)| *s)
                .collect();
            held.retain(|(f, _)| *f != n);
            if !due.is_empty() {
                app.worker.call(move |state| {
                    if let Some(s) = state.scene3d.as_mut() {
                        for slot in due {
                            s.view.release(slot);
                        }
                    }
                });
            }
            let mut frame = Map::new();
            frame.insert("frame".into(), json!(n));
            frame.insert("settled".into(), json!(settled));
            frame.insert("resident".into(), json!(resident));
            if let Some((ms, bytes)) = drawn.timed {
                frame.insert("gpu_ms".into(), json!(ms));
                frame.insert("gpu_bytes".into(), json!(bytes));
            }
            let (frame_seq, window_name) = match (&args.window, app.window.as_ref()) {
                (Some(_), Some(win)) => {
                    win.present(&mut app.cx);
                    let shown = win.paint.borrow().shown;
                    let name = if capture {
                        let image = win
                            .capture(&mut app.cx)
                            .map_err(|e| refused("no_capture", e))?;
                        Some(write_named(
                            out,
                            &png(image.as_raw(), [image.width(), image.height()])?,
                            "png",
                        )?)
                    } else {
                        None
                    };
                    (shown, name)
                }
                _ => (ui.latch().map(|(_, f)| f), None),
            };
            frame.insert("frame_seq".into(), json!(frame_seq.unwrap_or(n)));
            frame.insert(
                "pixel_hash".into(),
                json!(drawn.bytes.as_ref().map(|b| hex(b))),
            );
            if capture {
                if let (Some(bgra), true) = (&drawn.bytes, args.targets.contains("final")) {
                    let mut rgba = bgra.clone();
                    for p in rgba.as_chunks_mut::<4>().0 {
                        p.swap(0, 2);
                    }
                    frame.insert(
                        "final".into(),
                        json!(write_named(out, &png(&rgba, size)?, "png")?),
                    );
                }
                if let Some((linear, ids)) = &drawn.targets {
                    if args.targets.contains("linear") {
                        frame.insert("linear".into(), json!(write_named(out, linear, "f32")?));
                    }
                    if args.targets.contains("ids") {
                        frame.insert(
                            "ids".into(),
                            json!(write_named(out, &png(ids, size)?, "png")?),
                        );
                        let picks: Map<String, Value> = drawn
                            .picks
                            .iter()
                            .map(|(id, p)| (p.to_string(), json!(id)))
                            .collect();
                        frame.insert("picks".into(), Value::Object(picks));
                    }
                }
                if let Some(name) = window_name {
                    frame.insert("window".into(), json!(name));
                }
            }
            if args.counts {
                let c = &drawn.counts;
                let encoded: Vec<Value> = c
                    .encoded
                    .iter()
                    .map(|(batch, items)| json!({"batch": batch, "items": items}))
                    .collect();
                frame.insert("encoded".into(), json!(encoded));
                frame.insert("replayed".into(), json!(c.replayed));
                frame.insert("instances_written".into(), json!(c.instances_written));
                frame.insert("meshes_built".into(), json!(c.meshes_built));
            }
            frames.push(Value::Object(frame));
        }
        Ok(())
    })();
    if args.window.is_some() {
        deep_app::gpu_view::unwatch(&ui);
        if let Some(win) = app.window.as_ref() {
            let mut p = win.paint.borrow_mut();
            p.ui = None;
            p.overlays.clear();
        }
    }
    app.worker.call(|state| state.scene3d = None);
    result?;
    Ok(json!({
        "frames": frames,
        "passes": [
            {"name": GEOMETRY_PASS, "reads": [], "writes": ["linear", "ids", "depth"]},
            {"name": OUTPUT_PASS, "reads": ["linear"], "writes": ["final"]},
        ],
    }))
}
