//! A 2D film in the app's window under a look, and a switch of that look (issue #417;
//! tests/acceptance/417/README.md, "AC5's reports"): `{"call": "film2d", "doc", "look", "frames",
//! "fps"?, "events"?: [{"frame", "look"}]}`, a look an ID of a shipped look or a look@1, drawn in
//! its light theme. The document's 2D writer layers are drawn by Vello GPU into a GPU surface of
//! their own on the GPU layer's device and shown in the window through the handoff, over the page
//! in the look's ground, each frame at its own time on the film's clock (`fps`, 60 by default).
//! `from` opens the film at that frame with nothing drawn before it, and `hash` adds each frame's
//! `pixel_hash`, the hash of its surface (#430).
//!
//! Each frame answers `{frame, gpu_ms, cpu_ms}`. Its GPU time is the GPU layer's part, from the end
//! of encoding Vello GPU's passes to the device's report that they are done, read on the render
//! side (an upper bound: it holds the submit and the wait for the report too, since the device
//! writes no ordered timestamps around another renderer's passes), plus what GPUI's frame spent
//! past the window's own on the GPU (as `spike2d` takes it). Its CPU time is evaluating the frame's marks, encoding them on the render
//! side, and GPUI's latch and paint on the UI thread. A look event swaps the look from its frame
//! on: the motion program, compiled once, stays, and only the frame's marks and the page's ground
//! are made again in the new look's palette and type. Each switch answers `{frame, ms, ground}`:
//! `ms` from the request, when the event is applied, to the first frame drawn in the new look
//! presented in the window and read back from it, and `ground` that frame's pixel (4, 4).
//! `--planted stops_at_request` stops the clock at the request and reads the window before the
//! swap, so its ground is the old look's.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use deep_canvas_drawn::medium::Lamp;
use deep_canvas_marks::drawn::{self, View};
use deep_canvas_marks::look::{self, Distance};
use deep_canvas_marks::scene::{self, Drawn, Palette, Record, Rgb, Type};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_gpu::ring::Mark as RingMark;
use serde_json::{json, Map, Value};

use crate::drawn::Page;
use crate::groups::Clock;
use crate::marks2d::{close2, drawn_type, open2, packs_of, page_of, show, Frame2, Marks2};
use crate::view3d::{png, write_named};
use crate::{frames, parity, refused, App, Planted};

const FLICKS_PER_SECOND: i64 = 705_600_000;

/// When the frame's Vello GPU passes finished encoding, set by the surface's module.
pub type Encoded = Arc<Mutex<Option<Instant>>>;

/// A look's light theme as the 2D marks read it: its roles and its type.
fn look_of(app: &App, v: &Value, doc: &Map<String, Value>) -> Result<(Palette, Type), Value> {
    let def = match v {
        Value::String(id) => look::shipped(id)
            .ok_or_else(|| refused("bad_input", format!("look: {id} isn't a shipped look")))?,
        Value::Object(_) => v.clone(),
        _ => {
            return Err(refused(
                "bad_input",
                "a look is a shipped look's ID or a look@1",
            ))
        }
    };
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    // A film played on its own holds the status distance only where it shows status, which the
    // check judges (The status-color rule).
    let resolved =
        look::resolve_in(&def, &bundled, Distance::WhereStatusShows).map_err(|r| r.to_json())?;
    let bare = drawn_type(app, &def, doc)?;
    let ty = Type {
        drawn: bare.drawn,
        first_rim: bare.first_rim,
        flat_ink: bare.flat_ink,
        ..resolved.light_type
    };
    Ok((resolved.light, ty))
}

/// The film's marks at `t` in a look, by writer layer, and its ground.
fn marks_at(
    doc: &Map<String, Value>,
    program: &Program,
    state: &mut State,
    t: i64,
    (palette, ty): &(Palette, Type),
) -> Result<(Vec<Vec<Arc<Drawn>>>, Rgb, Option<View>, Vec<Lamp>), Value> {
    program.evaluate(t, eval::Validity::Full, state);
    let mut items = eval::items(doc, program, state);
    let lamps = match &ty.drawn {
        Some(look) => drawn::screen_lamps(look, &items, palette).map_err(|r| refused(r.code, r.path))?,
        None => Vec::new(),
    };
    let view = drawn::view_of(doc, &mut items);
    if let Some(v) = &view {
        drawn::through(v, &mut items);
    }
    let record = Record {
        pinned: t,
        ..Record::default()
    };
    let frame = scene::frame_planted(
        doc,
        &items,
        (palette, ty),
        &record,
        1.0,
        scene::Planted::None,
    )
    .map_err(|r| refused(r.code, r.path))?;
    let layers = frame
        .layers
        .iter()
        .map(|l| l.marks.iter().cloned().collect())
        .collect();
    Ok((layers, frame.ground, view, lamps))
}

fn hex(c: &image::Rgba<u8>) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// Frame `n` encoded and submitted on the render side and waited for there: the encode's CPU ms
/// and the GPU layer's ms from the end of the encode to the work done.
fn render(
    app: &App,
    n: u64,
    encoded: &Encoded,
    hash: bool,
    keep: bool,
) -> Result<(f64, f64, Option<String>, Option<Vec<u8>>), Value> {
    let encoded = encoded.clone();
    app.worker
        .call(move |state| -> Result<(f64, f64, Option<String>, Option<Vec<u8>>), String> {
            let view = state.view2d.as_mut().ok_or("no 2D surface")?;
            let (drawn, encode) = loop {
                let started = Instant::now();
                if let Some(d) = view.render(n)? {
                    break (d, started.elapsed());
                }
                view.wait_free();
            };
            view.wait_done(drawn.slot);
            let at = encoded
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take()
                .ok_or("the frame's passes weren't encoded")?;
            let done = view.times(drawn.slot).ok_or("the frame has no times")?;
            let gpu = done.render_done.saturating_duration_since(at);
            let bytes = (hash || keep).then(|| view.read(drawn.slot)).flatten();
            let pixels = bytes.as_ref().filter(|_| hash).map(|b| frames::hex(b));
            let kept = bytes.filter(|_| keep);
            Ok((encode.as_secs_f64() * 1e3, gpu.as_secs_f64() * 1e3, pixels, kept))
        })
        .map_err(|e| refused("render_failed", e))
}

pub fn film2d(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let doc = call["doc"]
        .as_object()
        .cloned()
        .ok_or_else(|| bad("doc is an object"))?;
    let size = crate::view3d::pair(&doc["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("doc: size is [w, h]"))?;
    let is_camera = |i: &Value| i["kind"].as_str().is_some_and(|k| k.starts_with("camera@"));
    if doc["items"]
        .as_object()
        .is_some_and(|items| items.values().any(|i| parity::three_d(i) && !is_camera(i)))
    {
        return Err(bad("film2d plays a 2D film; the document holds a 3D item"));
    }
    if let Some((pass, collection)) = deep_canvas_effects::module::foreign_read(&doc) {
        return Err(refused(
            "collection_other_writer",
            format!("items/{pass}: reads another writer's collection {collection}"),
        ));
    }
    let count = call["frames"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or_else(|| bad("frames is a count"))?;
    let fps = call
        .get("fps")
        .map_or(Some(60), Value::as_u64)
        .filter(|f| *f > 0)
        .ok_or_else(|| bad("fps"))? as i64;
    let from = call["from"].as_u64().unwrap_or(0);
    let hash = call["hash"] == true;
    let mut events = Vec::new();
    for e in call["events"].as_array().into_iter().flatten() {
        let frame = e["frame"]
            .as_u64()
            .filter(|f| *f > 0 && *f < count)
            .ok_or_else(|| bad("an event names a frame after the first, within the film"))?;
        events.push((frame, look_of(app, &e["look"], &doc)?));
    }
    events.sort_by_key(|(f, _)| *f);
    let mut events = events.into_iter().peekable();
    let mut look = look_of(app, &call["look"], &doc)?;
    let capture: Vec<u64> = call["capture"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect();
    let export = call["export"].is_object();
    let black = app.planted == Some(Planted::DrawsBlack);
    let stops_at_request = app.planted == Some(Planted::StopsAtRequest);

    // Compiled once: no look enters the motion program.
    let program = Program::compile(&doc).map_err(|r| refused(r.code, r.path))?;
    let mut state = program.state();
    let at = |n: u64| n as i64 * FLICKS_PER_SECOND / fps;
    let roles = |look: &(Palette, Type)| -> Arc<BTreeMap<String, [f64; 3]>> {
        Arc::new(
            look.0
                .iter()
                .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
                .collect(),
        )
    };
    let (first, ground, view, lamps) = marks_at(&doc, &program, &mut state, at(from), &look)?;
    // The paper's fields hold still; only where the pixels land moves with the camera.
    let page = page_of(&look.1, view.as_ref(), &doc, &roles(&look), call)?;
    let first_page = page.as_ref().map(|p| Arc::new(p.seen_through(view.as_ref(), lamps)));

    app.window(size)?;
    {
        let win = app.window.as_ref().expect("opened above");
        let mut p = win.paint.borrow_mut();
        p.page = (32, vec![ground]);
        p.view = [0, 0];
        p.size = size;
        p.card = None;
        p.waits_on_gpu = false;
        p.overlays.clear();
        p.pairs_newest = false;
        p.ui = None;
        p.pictures = Default::default();
    }
    let baseline = frames::baseline_ns(app);
    let packs = Arc::new(packs_of(call)?);
    let frame2 = |layers, n, look: &(Palette, Type), page: Option<Arc<Page>>| {
        Arc::new(Frame2 {
            layers,
            clock: Clock::of(&doc, at(n)),
            roles: roles(look),
            guard: None,
            packs: packs.clone(),
            page,
        })
    };
    let marks: Marks2 = Arc::new(Mutex::new(frame2(first, from, &look, first_page)));
    let encoded: Encoded = Arc::new(Mutex::new(None));
    let (ui, error) = open2(app, marks.clone(), size, Some(encoded.clone()))?;
    app.window.as_ref().expect("opened").paint.borrow_mut().ui = Some(ui.clone());
    ui.record(false);
    ui.take_record();
    ui.record(true);

    let mut listed = Vec::with_capacity(count as usize);
    let mut switches = Vec::new();
    let mut movie = Movie::new(out, export, size);
    let played = (|| -> Result<(), Value> {
        for k in 0..count {
            let mut request = None;
            let n = from + k;
            while let Some((_, next)) = events.next_if(|(f, _)| *f == k) {
                let asked = Instant::now();
                if stops_at_request {
                    let ms = asked.elapsed().as_secs_f64() * 1e3;
                    let win = app.window.as_ref().expect("opened");
                    let image = win
                        .capture(&mut app.cx)
                        .map_err(|e| refused("no_capture", e))?;
                    switches
                        .push(json!({"frame": n, "ms": ms, "ground": hex(image.get_pixel(4, 4))}));
                } else {
                    request = Some(asked);
                }
                look = next;
            }
            let started = Instant::now();
            let (drawn, ground, view, lamps) = marks_at(&doc, &program, &mut state, at(n), &look)?;
            let page = page.as_ref().map(|p| Arc::new(p.seen_through(view.as_ref(), lamps)));
            *marks.lock().unwrap_or_else(|e| e.into_inner()) = frame2(drawn, n, &look, page);
            {
                let win = app.window.as_ref().expect("opened");
                let mut p = win.paint.borrow_mut();
                if p.page.1 != [ground] {
                    p.page = (32, vec![ground]);
                }
            }
            let built = started.elapsed().as_secs_f64() * 1e3;
            let keep = export || capture.contains(&n);
            let (encode_ms, layer_gpu_ms, pixels, bytes) = render(app, k, &encoded, hash, keep)?;
            if let Some(e) = error.lock().unwrap_or_else(|e| e.into_inner()).take() {
                return Err(e);
            }
            let win = app.window.as_ref().expect("opened");
            win.present(&mut app.cx);
            let ui_time = win.paint.borrow().ui_time + ui.take_committed();
            frames::gpui_idle();
            let recorded = ui.take_record();
            let cb = recorded.iter().find_map(|m| match m {
                RingMark::Sampled { frame, buffer, .. } if *frame == k => Some(*buffer),
                _ => None,
            });
            let window_gpu_ns = cb
                .and_then(|cb| {
                    recorded.iter().find_map(|m| match m {
                        RingMark::Completed { buffer, gpu_ns } if *buffer == cb => Some(*gpu_ns),
                        _ => None,
                    })
                })
                .unwrap_or(0)
                .saturating_sub(baseline);
            let mut row = json!({
                "frame": n,
                "gpu_ms": layer_gpu_ms + window_gpu_ns as f64 / 1e6,
                "cpu_ms": built + encode_ms + ui_time.as_secs_f64() * 1e3,
            });
            if hash {
                row["pixel_hash"] = json!(pixels);
            }
            if let Some(bytes) = bytes {
                let image = picture(&bytes, size, ground, black);
                if capture.contains(&n) {
                    row["final"] = json!(write_named(out, &png(&image, size)?, "png")?);
                }
                movie.add(&image, at(n))?;
            }
            listed.push(row);
            if let Some(asked) = request {
                if app.window.as_ref().expect("opened").paint.borrow().shown != Some(k) {
                    show(app, k)?;
                }
                let image = app
                    .window
                    .as_ref()
                    .expect("opened")
                    .capture(&mut app.cx)
                    .map_err(|e| refused("no_capture", e))?;
                let ground = hex(image.get_pixel(4, 4));
                let ms = asked.elapsed().as_secs_f64() * 1e3;
                switches.push(json!({"frame": k, "ms": ms, "ground": ground}));
            }
        }
        Ok(())
    })();
    ui.record(false);
    close2(app, &ui);
    played?;
    let mut reply = json!({"size": size, "frames": listed, "switches": switches});
    if export {
        reply["export"] = movie.finish()?;
    }
    Ok(reply)
}

/// A frame's surface as a picture: its premultiplied BGRA over the page's ground, RGBA rows.
fn picture(bytes: &[u8], size: [u32; 2], ground: Rgb, black: bool) -> Vec<u8> {
    let mut out = Vec::with_capacity((size[0] * size[1] * 4) as usize);
    for p in bytes.chunks_exact(4) {
        let under = |c: u8| u32::from(c) * (255 - u32::from(p[3]));
        let over = |s: u8, g: u8| (u32::from(s) + (under(g) + 127) / 255).min(255) as u8;
        out.extend_from_slice(&[over(p[2], ground[0]), over(p[1], ground[1]), over(p[0], ground[2]), 255]);
    }
    if black {
        out.chunks_exact_mut(4).for_each(|p| p[..3].fill(0));
    }
    out
}

/// A film's frames on their way to the encode tool: I420 files beside the output.
struct Movie {
    on: bool,
    dir: std::path::PathBuf,
    out: String,
    size: [u32; 2],
    files: Vec<String>,
    pts: Vec<i64>,
}

/// The encode's time base: flicks reduced to a timescale the MP4 holds.
const TIMESCALE: i64 = 90_000;

impl Movie {
    fn new(out: &str, on: bool, size: [u32; 2]) -> Movie {
        Movie {
            on,
            dir: std::path::Path::new(out).join("frames.i420"),
            out: out.to_string(),
            size,
            files: Vec::new(),
            pts: Vec::new(),
        }
    }

    /// BT.709 limited range, 4:2:0, as the encode job takes it.
    fn add(&mut self, rgba: &[u8], t: i64) -> Result<(), Value> {
        if !self.on {
            return Ok(());
        }
        std::fs::create_dir_all(&self.dir).map_err(|e| refused("not_written", e.to_string()))?;
        let [w, h] = self.size.map(|v| v as usize);
        let mut i420 = Vec::with_capacity(w * h * 3 / 2);
        let px = |x: usize, y: usize| {
            let o = (y * w + x) * 4;
            [rgba[o], rgba[o + 1], rgba[o + 2]].map(f64::from)
        };
        for y in 0..h {
            for x in 0..w {
                let [r, g, b] = px(x, y);
                i420.push((16.0 + (0.1826 * r + 0.6142 * g + 0.0620 * b)).round() as u8);
            }
        }
        for plane in 0..2 {
            for y in (0..h).step_by(2) {
                for x in (0..w).step_by(2) {
                    let [r, g, b] = px(x, y);
                    let v = if plane == 0 {
                        128.0 - 0.1006 * r - 0.3386 * g + 0.4392 * b
                    } else {
                        128.0 + 0.4392 * r - 0.3989 * g - 0.0403 * b
                    };
                    i420.push(v.round() as u8);
                }
            }
        }
        let path = self.dir.join(format!("{}.i420", self.files.len()));
        std::fs::write(&path, i420).map_err(|e| refused("not_written", e.to_string()))?;
        self.files.push(path.to_string_lossy().into_owned());
        self.pts.push(t * TIMESCALE / FLICKS_PER_SECOND);
        Ok(())
    }

    fn finish(self) -> Result<Value, Value> {
        let exe = std::env::current_exe().map_err(|e| refused("no_encoder", e.to_string()))?;
        let out = std::path::Path::new(&self.out).join("export.mp4");
        let caps = deep_codecs::Caps::default();
        let mut tool = deep_codecs::Helper::start(&exe, deep_codecs::ENCODE_TOOL, &caps, None)
            .map_err(|e| refused("no_encoder", e.to_string()))?;
        let reply = tool.ask(&json!({
            "op": "encode", "frames": self.files, "pts": self.pts, "timescale": TIMESCALE,
            "size": self.size, "out": out.to_string_lossy(),
        }));
        std::fs::remove_dir_all(&self.dir).ok();
        let Some(sha) = reply["sha256"].as_str() else {
            return Err(refused("encode_failed", reply.to_string()));
        };
        let named = std::path::Path::new(&self.out).join(format!("{sha}.mp4"));
        std::fs::rename(&out, named).map_err(|e| refused("not_written", e.to_string()))?;
        Ok(json!({"file": sha, "codec": "h264", "frames": self.files.len()}))
    }
}
