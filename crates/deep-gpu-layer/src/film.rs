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

use deep_canvas_marks::look::{self, Distance};
use deep_canvas_marks::scene::{self, Drawn, Palette, Record, Rgb, Type};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_gpu::ring::Mark as RingMark;
use serde_json::{json, Map, Value};

use crate::groups::Clock;
use crate::marks2d::{close2, open2, packs_of, show, Frame2, Marks2};
use crate::{frames, parity, refused, App, Planted};

const FLICKS_PER_SECOND: i64 = 705_600_000;

/// When the frame's Vello GPU passes finished encoding, set by the surface's module.
pub type Encoded = Arc<Mutex<Option<Instant>>>;

/// A look's light theme as the 2D marks read it: its roles and its type.
fn look_of(v: &Value) -> Result<(Palette, Type), Value> {
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
    Ok((resolved.light, resolved.light_type))
}

/// The film's marks at `t` in a look, by writer layer, and its ground.
fn marks_at(
    doc: &Map<String, Value>,
    program: &Program,
    state: &mut State,
    t: i64,
    (palette, ty): &(Palette, Type),
) -> Result<(Vec<Vec<Arc<Drawn>>>, Rgb), Value> {
    program.evaluate(t, eval::Validity::Full, state);
    let items = eval::items(doc, program, state);
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
    Ok((layers, frame.ground))
}

fn hex(c: &image::Rgba<u8>) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// Frame `n` encoded and submitted on the render side and waited for there: the encode's CPU ms
/// and the GPU layer's ms from the end of the encode to the work done.
fn render(app: &App, n: u64, encoded: &Encoded, hash: bool) -> Result<(f64, f64, Option<String>), Value> {
    let encoded = encoded.clone();
    app.worker
        .call(move |state| -> Result<(f64, f64, Option<String>), String> {
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
            let pixels = hash.then(|| view.read(drawn.slot).map(|b| frames::hex(&b))).flatten();
            Ok((encode.as_secs_f64() * 1e3, gpu.as_secs_f64() * 1e3, pixels))
        })
        .map_err(|e| refused("render_failed", e))
}

pub fn film2d(app: &mut App, call: &Value) -> Value {
    match run(app, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let doc = call["doc"]
        .as_object()
        .cloned()
        .ok_or_else(|| bad("doc is an object"))?;
    let size = crate::view3d::pair(&doc["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("doc: size is [w, h]"))?;
    if doc["items"]
        .as_object()
        .is_some_and(|items| items.values().any(parity::three_d))
    {
        return Err(bad("film2d plays a 2D film; the document holds a 3D item"));
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
        events.push((frame, look_of(&e["look"])?));
    }
    events.sort_by_key(|(f, _)| *f);
    let mut events = events.into_iter().peekable();
    let mut look = look_of(&call["look"])?;
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
    let (first, ground) = marks_at(&doc, &program, &mut state, at(from), &look)?;

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
    let frame2 = |layers, n, look: &(Palette, Type)| {
        Arc::new(Frame2 {
            layers,
            clock: Clock::of(&doc, at(n)),
            roles: roles(look),
            guard: None,
            packs: packs.clone(),
        })
    };
    let marks: Marks2 = Arc::new(Mutex::new(frame2(first, from, &look)));
    let encoded: Encoded = Arc::new(Mutex::new(None));
    let (ui, error) = open2(app, marks.clone(), size, Some(encoded.clone()))?;
    app.window.as_ref().expect("opened").paint.borrow_mut().ui = Some(ui.clone());
    ui.record(false);
    ui.take_record();
    ui.record(true);

    let mut listed = Vec::with_capacity(count as usize);
    let mut switches = Vec::new();
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
            let (drawn, ground) = marks_at(&doc, &program, &mut state, at(n), &look)?;
            *marks.lock().unwrap_or_else(|e| e.into_inner()) = frame2(drawn, n, &look);
            {
                let win = app.window.as_ref().expect("opened");
                let mut p = win.paint.borrow_mut();
                if p.page.1 != [ground] {
                    p.page = (32, vec![ground]);
                }
            }
            let built = started.elapsed().as_secs_f64() * 1e3;
            let (encode_ms, layer_gpu_ms, pixels) = render(app, k, &encoded, hash)?;
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
    Ok(json!({"size": size, "frames": listed, "switches": switches}))
}
