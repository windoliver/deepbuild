//! The `view3d` call (issue #378; tests/acceptance/378/README.md, The view3d call): a document's
//! 3D writer layers drawn by scene3d's render module through a GPU-layer view, frame n at
//! t = n ÷ fps on a virtual clock, with the writers' patches applied before the frames they name.
//! With a window, the view sits over a flat page and its 2D writer layers anchored to 3D items
//! draw over it from the evaluated data of the `frame_seq` the shown slot carries.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas::document::{apply_ops, writer_layer, Writing};
use deep_canvas_marks::look::Status;
use deep_canvas_scene3d::label::PAGE;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene};
use deep_gpu::device::Backend;
use deep_scene3d_render::status::{Mode, COLORS_PASS, GUARD_PASS};
use deep_scene3d_render::SHADOW_PASS;
use image::ImageEncoder as _;
use serde_json::{json, Map, Value};

use crate::frames::{hex, Capture};
use crate::session3::{self, lock};
use crate::status;
use crate::window::OverlayPicture;
use crate::{effects, refused, App, Planted};

pub const FLICKS_PER_SECOND: u64 = 705_600_000;

struct Window3 {
    size: [u32; 2],
    view: [u32; 2],
    page: [u8; 3],
}

struct Args {
    doc: Value,
    look: Look3,
    /// The look as given: its bloom and ground grid turn effects on (#380).
    look_json: Value,
    /// The session's selection, whose items draw their outlines (#380).
    selection: Vec<String>,
    /// The first frame latched: the session opens there, a seek (#380).
    from: u64,
    /// Each frame's GPU time and each pass's, from wgpu-profiler (#380).
    timings: bool,
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
    /// Report each label's glyphs and the atlas pages they sample (#381).
    labels: bool,
    /// `(frame, at)`: a click at `at` view px while frame n is presented (#671).
    clicks: Vec<(u64, [f64; 2])>,
    /// The record's state for each status binding's source (#382).
    states: BTreeMap<String, String>,
    /// The theme the look's roles and status map resolve in (#382).
    theme: String,
    /// The look's status map, when it has one (#382).
    status: Option<Status>,
}

pub(crate) fn pair(v: &Value) -> Option<[u32; 2]> {
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
    let theme = status::theme_of(call)?;
    let look_json = status::themed(&call["look"], &theme);
    let look = Look3::read(&look_json).map_err(|e| bad(&format!("look: {e}")))?;
    let status = status::status_of(&look_json)?;
    let states = status::states(call).ok_or_else(|| bad("states maps handles to states"))?;
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
    let mut clicks = Vec::new();
    for c in call["clicks"].as_array().into_iter().flatten() {
        let at = c["at"]
            .as_array()
            .filter(|a| a.len() == 2)
            .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]));
        let (Some(frame), Some(at)) = (c["frame"].as_u64(), at) else {
            return Err(bad("a click is {frame, at: [x, y]}"));
        };
        clicks.push((frame, at));
    }
    Ok(Args {
        doc,
        look,
        look_json,
        selection: call["selection"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        from: call["from"].as_u64().unwrap_or(0),
        timings: call["timings"].as_bool().unwrap_or(false),
        size,
        frames,
        fps,
        patches,
        targets,
        capture,
        window,
        latency,
        counts: call["counts"].as_bool().unwrap_or(false),
        labels: call["labels"].as_bool().unwrap_or(false),
        clicks,
        states,
        theme,
        status,
    })
}

/// A patch's ops applied as `writer`, to the layer its connection stands for.
pub(crate) fn apply_patch(
    doc: &mut Value,
    writer: &str,
    ops: &Value,
    seq: usize,
) -> Result<(), Value> {
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

/// What a click at `at` view px picks in a frame (canvas primitives: Selection, Spatial index):
/// the topmost 2D overlay whose shapes cover it, else the item the object-ID target holds there,
/// else nothing.
fn pick(
    scene: &deep_canvas_scene3d::scene::Scene,
    ids: &[u8],
    picks: &[(String, u32)],
    size: [u32; 2],
    at: [f64; 2],
) -> Option<String> {
    use deep_canvas_scene3d::scene::Shape2;
    for o in scene.overlays.iter().rev() {
        let Some([ox, oy]) = o.origin else { continue };
        let [x, y] = [at[0] - ox, at[1] - oy];
        let hit = o.shapes.iter().any(|s| match s {
            Shape2::Circle { center, r, .. } => (x - center[0]).hypot(y - center[1]) <= *r,
            Shape2::Rect { rect, .. } => {
                (rect[0]..=rect[0] + rect[2]).contains(&x)
                    && (rect[1]..=rect[1] + rect[3]).contains(&y)
            }
        });
        if hit {
            return Some(o.id.clone());
        }
    }
    let [x, y] = [at[0].floor(), at[1].floor()];
    if x < 0.0 || y < 0.0 || x >= f64::from(size[0]) || y >= f64::from(size[1]) {
        return None;
    }
    let i = (y as usize * size[0] as usize + x as usize) * 4;
    let p = u32::from_le_bytes(ids.get(i..i + 4)?.try_into().ok()?);
    picks
        .iter()
        .find(|(_, v)| *v == p)
        .map(|(id, _)| id.clone())
}

pub(crate) fn png(rgba: &[u8], size: [u32; 2]) -> Result<Vec<u8>, Value> {
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
pub(crate) fn write_named(out: &str, bytes: &[u8], ext: &str) -> Result<String, Value> {
    let name = hex(bytes);
    std::fs::write(
        std::path::Path::new(out).join(format!("{name}.{ext}")),
        bytes,
    )
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(name)
}

/// Each label's glyphs, with their places in the core's glyph atlas, and the pages they sample,
/// each written as an 8-bit grayscale PNG of its alpha named by its SHA-256.
fn labels_json(scene: &Scene, out: &str) -> Result<(Value, Value), Value> {
    let mut labels = Vec::new();
    let mut sampled = BTreeSet::new();
    for l in scene.layers.iter().flat_map(|layer| &layer.labels) {
        let glyphs: Vec<Value> = l
            .glyphs
            .iter()
            .map(|g| {
                let atlas = g.atlas.map(|a| {
                    sampled.insert(a.page);
                    json!({"page": a.page, "x": a.x, "y": a.y, "w": a.w, "h": a.h, "raster": g.raster})
                });
                json!({
                    "font": format!("crates/deep-text/fonts/{}", g.file), "size": g.size, "id": g.id,
                    "x": g.x, "y": g.y, "grapheme": g.grapheme, "atlas": atlas,
                })
            })
            .collect();
        labels.push(json!({"item": l.id, "glyphs": glyphs}));
    }
    let mut pages = Vec::new();
    for page in sampled {
        let bytes = &scene.pages[page as usize].bytes;
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(bytes, PAGE, PAGE, image::ExtendedColorType::L8)
            .map_err(|e| refused("not_written", e.to_string()))?;
        pages.push(json!({"page": page, "png": write_named(out, &png, "png")?}));
    }
    Ok((json!(labels), json!(pages)))
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let mut args = parse(call)?;
    let noop = app.backend == Backend::Noop;
    if noop && !args.clicks.is_empty() {
        return Err(refused(
            "bad_input",
            "a click reads the object-ID target, which the noop backend doesn't draw",
        ));
    }
    // Status can show in a view3d call exactly when the document has a status binding (the
    // status-color rule's first case); then its data roles keep the look's distance (#382).
    let mut bindings = status::bindings(&args.doc)?;
    let bound = !bindings.is_empty();
    // The planted guard runs (and shows a legend) where status can't show: the bug AC1 catches.
    let shows = bound || app.planted == Some(Planted::GuardEverywhere);
    let status = if shows {
        let status = args
            .status
            .clone()
            .ok_or_else(|| refused("status_unmapped", "look: status"))?;
        if bound {
            if let Some(r) =
                status::clash(&args.doc, &args.look_json, &args.look, &status, &args.theme)
            {
                return Err(r);
            }
        }
        Some(status)
    } else {
        None
    };
    let size = args.size;
    let timings = args.timings && !noop;
    let opened = session3::open(app, size, timings, shows)?;
    let (ui, fx) = (opened.ui.clone(), opened.fx.clone());
    let mut text = status::Text::default();
    let mut report = (Value::Array(Vec::new()), Value::Array(Vec::new()));
    let mut moved: Option<u32> = None;
    let doc_seed = args.doc["seed"].as_u64().unwrap_or(0);
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
    labels.fixed_em = app.planted == Some(Planted::LabelMask);
    let mut frames = Vec::new();
    // Held slots, each with the frame whose present releases it.
    let mut held: Vec<(u64, usize)> = Vec::new();
    let wants_targets = args.targets.contains("linear") || args.targets.contains("ids");
    let result = (|| -> Result<(), Value> {
        for n in args.from..args.from + args.frames {
            // A seek applies every patch up to the frame it opens at.
            let mut patched = false;
            for (k, (frame, writer, ops)) in args.patches.iter().enumerate() {
                if *frame == n || (n == args.from && *frame < n) {
                    apply_patch(&mut args.doc, writer, ops, k)?;
                    patched = true;
                }
            }
            // The patched document's bindings are the ones drawn (a slice op can't add or
            // remove one, only leave one dangling, which refuses), and its roles keep the
            // distance.
            if patched {
                bindings = status::bindings(&args.doc)?;
                if let Some(status) = status.as_ref().filter(|_| bound) {
                    if let Some(r) =
                        status::clash(&args.doc, &args.look_json, &args.look, status, &args.theme)
                    {
                        return Err(r);
                    }
                }
            }
            let t = (n * FLICKS_PER_SECOND / args.fps) as i64;
            let scene = Arc::new(
                evaluate(&args.doc, t, &args.look, &mut labels)
                    .map_err(|r| refused(r.code, r.path))?,
            );
            let seeding = match app.planted {
                Some(Planted::NoiseFromFrameCounter) => {
                    effects::Seeding::FrameCounter(n - args.from)
                }
                Some(Planted::NoiseFromClock) => effects::Seeding::Clock,
                _ => effects::Seeding::Item,
            };
            let settings = effects::settings(
                &scene,
                &args.look_json,
                &args.look,
                &args.selection,
                n as f64 / args.fps as f64,
                doc_seed,
                seeding,
            );
            lock(&fx).settings = settings;
            let label_report = if args.labels {
                Some(labels_json(&scene, out)?)
            } else {
                None
            };
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
            let clicks: Vec<[f64; 2]> = args
                .clicks
                .iter()
                .filter(|(f, _)| *f == n)
                .map(|(_, at)| *at)
                .collect();
            let read_targets = (capture && wants_targets || !clicks.is_empty()) && !noop;
            if let (Some(status), Some(stage)) = (&status, &opened.stage) {
                let (layer, marks, legend) = status::layer(
                    &scene,
                    &args.look,
                    args.look.role("ink").unwrap_or([0, 0, 0]),
                    status,
                    &bindings,
                    &args.states,
                    &mut text,
                )?;
                let distance = match app.planted {
                    Some(Planted::GuardHalfDistance) => status.min_distance / 2.0,
                    _ => status.min_distance,
                };
                let mode = match app.planted {
                    Some(Planted::GuardToGrey) => Mode::Grey,
                    _ => Mode::Line,
                };
                let mut st = lock(stage);
                st.guard = Some(status::guard_of(status, distance, mode));
                st.layer = Some(layer);
                if n == args.from {
                    report = (marks, legend);
                }
            }
            let evaluated = scene.clone();
            let drawn = session3::draw(
                app,
                &opened,
                scene,
                args.look.clone(),
                n,
                delay,
                read_targets,
                shows && n == args.from,
            )?;
            if n == args.from {
                moved = drawn.moved;
            }
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
            if let Some((labels, pages)) = label_report {
                frame.insert("labels".into(), labels);
                frame.insert("pages".into(), pages);
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
            if let Some((gpu_ms, passes)) = &drawn.timing {
                frame.insert("gpu_ms".into(), json!(gpu_ms));
                frame.insert("passes_ms".into(), json!(passes));
            }
            if !clicks.is_empty() {
                let ids = drawn.targets.as_ref().map(|(_, ids)| ids.as_slice());
                let answered: Vec<Value> = clicks
                    .iter()
                    .map(|at| {
                        let p = ids.and_then(|ids| pick(&evaluated, ids, &drawn.picks, size, *at));
                        json!({"at": at, "pick": p})
                    })
                    .collect();
                frame.insert("clicks".into(), json!(answered));
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
    session3::close(app);
    result?;
    // The frame's passes in order: the shadow map when a sun casts, geometry, the effects and
    // the output.
    let effects = lock(&fx);
    let mut passes = Vec::new();
    if effects.settings.shadow.is_some() {
        passes.push(json!({"name": SHADOW_PASS, "reads": [], "writes": ["shadow"]}));
    }
    passes.push(json!({"name": GEOMETRY_PASS, "reads": [], "writes": ["linear", "ids", "depth"]}));
    for p in effects.passes() {
        passes.push(
            json!({"name": p.name, "reads": p.reads, "writes": p.writes, "operator": p.operator}),
        );
    }
    passes.push(json!({"name": OUTPUT_PASS, "reads": ["linear"], "writes": ["final"]}));
    if shows {
        passes.push(json!({"name": GUARD_PASS, "reads": ["final"], "writes": ["final"]}));
        passes.push(json!({"name": COLORS_PASS, "reads": ["final"], "writes": ["final"]}));
    }
    let status_report = status::report(
        shows,
        "document",
        status.as_ref().map(|s| s.min_distance),
        shows.then_some(moved),
        report.0,
        report.1,
    );
    let mut reply = json!({"frames": frames, "passes": passes, "status": status_report});
    if timings {
        reply["profiler"] =
            json!({"name": "wgpu-profiler", "version": env!("DEEP_WGPU_PROFILER_VERSION")});
    }
    Ok(reply)
}
