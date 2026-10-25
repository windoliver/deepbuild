//! The `frames` call (README: Calls): a scene's frames on a virtual clock in the window. Each
//! frame the render thread draws scene frame n into a free slot; the clock waits for the GPU (off
//! the UI thread), then the window presents it in the view over the page. And `render`: a
//! canonical render, an export's frame or a snapshot, which never uses a settling frame.

use std::collections::BTreeSet;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use deep_gpu::device::Backend;
use deep_gpu::encode::Encode;
#[cfg(feature = "test-pool")]
use deep_gpu::encode::Finish;
use deep_gpu::ring::Mark;
use deep_gpu::surface::Path;
use deep_gpu::view::Ui;
use image::ImageEncoder as _;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::window::Card;
use crate::worker::WORKERS;
use crate::{refused, App, Planted};

pub fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[derive(Clone, Debug)]
pub enum Capture {
    None,
    Every,
    Frames(BTreeSet<u64>),
}

impl Capture {
    pub fn wants(&self, n: u64) -> bool {
        match self {
            Capture::None => false,
            Capture::Every => true,
            Capture::Frames(f) => f.contains(&n),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Args {
    pub scene: String,
    pub from: u64,
    pub count: u64,
    pub path: Option<Path>,
    pub layer: bool,
    pub card: Option<Card>,
    pub capture: Capture,
    pub window_hash: bool,
    pub resize: bool,
    pub lose_at: Option<u64>,
    pub fences: bool,
    pub timings: bool,
    pub workers: usize,
    #[cfg(feature = "test-pool")]
    pub pool: Option<Finish>,
    /// Hash each slot (off for the conformance runs that only read the fences or the times).
    pub hash: bool,
}

impl Args {
    pub fn new(scene: &str, count: u64) -> Args {
        Args {
            scene: scene.to_string(),
            from: 0,
            count,
            path: None,
            layer: true,
            card: None,
            capture: Capture::None,
            window_hash: false,
            resize: false,
            lose_at: None,
            fences: false,
            timings: false,
            workers: WORKERS,
            #[cfg(feature = "test-pool")]
            pool: None,
            hash: true,
        }
    }

    fn parse(call: &Value) -> Result<Args, Value> {
        let scene = call["scene"]
            .as_str()
            .ok_or_else(|| refused("bad_input", "no scene"))?;
        let mut a = Args::new(scene, 0);
        a.from = call["from"].as_u64().unwrap_or(0);
        a.path = match call["path"].as_str() {
            None => None,
            Some("zero_copy") => Some(Path::ZeroCopy),
            Some("copy") => Some(Path::Copy),
            Some(_) => return Err(refused("bad_input", "path is zero_copy or copy")),
        };
        a.layer = call["layer"].as_bool().unwrap_or(true);
        a.card = call.get("card").filter(|c| c.is_object()).map(|c| Card {
            question: c["question"].as_str().unwrap_or_default().to_string(),
            options: c["options"]
                .as_array()
                .map(|o| {
                    o.iter()
                        .filter_map(|x| x["label"].as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
            rect: {
                let r: Vec<f32> = c["rect"]
                    .as_array()
                    .map(|r| r.iter().map(|v| v.as_f64().unwrap_or(0.) as f32).collect())
                    .unwrap_or_default();
                [0, 1, 2, 3].map(|i| r.get(i).copied().unwrap_or(0.))
            },
        });
        a.capture = match &call["capture"] {
            Value::String(s) if s == "every" => Capture::Every,
            Value::Array(f) => Capture::Frames(f.iter().filter_map(Value::as_u64).collect()),
            _ => Capture::None,
        };
        a.window_hash = call["window_hash"].as_bool().unwrap_or(false);
        a.resize = call["resize"].as_bool().unwrap_or(false);
        a.lose_at = call["lose_device_at"].as_u64();
        a.fences = call["fences"].as_bool().unwrap_or(false);
        a.timings = call["timings"].as_bool().unwrap_or(false);
        a.workers = call["workers"]
            .as_u64()
            .map_or(WORKERS, |w| w.clamp(1, 64) as usize);
        if call.get("pool").is_some_and(|p| !p.is_null()) {
            #[cfg(feature = "test-pool")]
            {
                a.pool = Some(match call["pool"]["order"].as_str() {
                    Some("reverse") => Finish::Reverse,
                    Some("seeded") => Finish::Seeded(call["pool"]["seed"].as_u64().unwrap_or(0)),
                    _ => return Err(refused("bad_input", "pool order is reverse or seeded")),
                });
            }
            #[cfg(not(feature = "test-pool"))]
            return Err(refused(
                "bad_input",
                "the test pool is in test-pool builds only",
            ));
        }
        Ok(a)
    }
}

pub struct Frame {
    pub frame: u64,
    pub size: [u32; 2],
    pub path: Path,
    pub pixel_hash: Option<String>,
    pub settling: bool,
    pub window: Option<String>,
    pub window_hash: Option<String>,
    /// The capture's RGBA pixels, kept when the caller asked for them.
    pub image: Option<image::RgbaImage>,
    /// Whether the capture is blank or black, as the blank guard reads it.
    pub blank: Option<bool>,
    pub handoff_ms: Option<f64>,
    pub ui_ms: Option<f64>,
    pub encodes: Option<Vec<Encode>>,
}

impl Frame {
    fn json(&self) -> Value {
        let mut f = json!({
            "frame": self.frame,
            "size": self.size,
            "path": self.path.name(),
            "pixel_hash": self.pixel_hash,
            "settling": self.settling,
        });
        let o = f.as_object_mut().expect("an object");
        if let Some(w) = &self.window {
            o.insert("window".into(), json!(w));
        }
        if let Some(w) = &self.window_hash {
            o.insert("window_hash".into(), json!(w));
        }
        if let Some(t) = self.handoff_ms {
            o.insert("handoff_ms".into(), json!(t));
        }
        if let Some(t) = self.ui_ms {
            o.insert("ui_ms".into(), json!(t));
        }
        if let Some(e) = &self.encodes {
            let list: Vec<Value> = e.iter().map(|e| json!({"layer": e.layer, "completed": e.completed, "submitted": e.submitted})).collect();
            o.insert("encodes".into(), json!(list));
        }
        f
    }
}

pub struct Run {
    pub frames: Vec<Frame>,
    pub marks: Vec<Mark>,
    pub losses: u64,
}

/// The fence record in the README's words: `render`, `gpu_done`, `show`, `gpui_done`, `release`.
pub fn fences(marks: &[Mark]) -> Vec<Value> {
    let mut out = Vec::new();
    for m in marks {
        let e = match *m {
            Mark::Drawn { frame, slot } => json!({"event": "render", "slot": slot, "frame": frame}),
            Mark::GpuDone { frame, slot } => {
                json!({"event": "gpu_done", "slot": slot, "frame": frame})
            }
            Mark::Shown { .. } => continue,
            Mark::Sampled {
                frame,
                slot,
                buffer,
            } => json!({"event": "show", "slot": slot, "frame": frame, "cb": buffer.to_string()}),
            Mark::Completed { buffer, .. } => {
                json!({"event": "gpui_done", "cb": buffer.to_string()})
            }
            Mark::Released { slot } => json!({"event": "release", "slot": slot}),
            Mark::Dropped { .. } | Mark::Skipped { .. } => continue,
        };
        out.push(e);
    }
    for (seq, e) in out.iter_mut().enumerate() {
        e.as_object_mut()
            .expect("an object")
            .insert("seq".into(), json!(seq));
    }
    out
}

/// What the render thread answers for one frame.
enum Drawn {
    Shown {
        settling: bool,
        pixel_hash: Option<String>,
        handoff: Duration,
        encodes: Vec<Encode>,
    },
    /// The device was lost while it drew.
    Lost,
}

#[cfg(target_os = "macos")]
fn ledger() -> (u64, u64, u64) {
    let l = gpui_apple::metal_renderer::gpu_ledger::read();
    (l.committed, l.completed, l.gpu_ns)
}
#[cfg(not(target_os = "macos"))]
fn ledger() -> (u64, u64, u64) {
    (0, 0, 0)
}

/// Waits (off the GPU layer's UI budget) until every GPUI frame command buffer completed.
fn gpui_idle() {
    let started = Instant::now();
    loop {
        let (committed, completed, _) = ledger();
        if completed >= committed || started.elapsed() > Duration::from_secs(2) {
            return;
        }
        std::thread::sleep(Duration::from_micros(50));
    }
}

/// The session for the call's scene and handoff: made on the render thread, its side watched for
/// GPUI's surface reports.
fn session_ui(app: &mut App, key: &str, path: Path, workers: usize) -> Result<Ui, Value> {
    let scene = app.scene(key)?;
    let k = key.to_string();
    let ui = app
        .worker
        .call(move |state| state.session(&k, scene, path, workers).map(|s| s.view.ui()))
        .map_err(|e| refused("no_session", e))?;
    if !app.watched.get(key).is_some_and(|w| w.is(&ui)) {
        if let Some(old) = app.watched.insert(key.to_string(), ui.clone()) {
            deep_app::gpu_view::unwatch(&old);
        }
        deep_app::gpu_view::watch(&ui);
    }
    Ok(ui)
}

/// The GPU time of GPUI's frame of the window without the view: what a frame costs with no handoff.
fn baseline_ns(app: &mut App) -> u64 {
    let mut samples = Vec::new();
    for _ in 0..9 {
        gpui_idle();
        let (_, _, before) = ledger();
        if let Some(w) = app.window.as_ref() {
            w.present(&mut app.cx);
        }
        gpui_idle();
        let (_, _, after) = ledger();
        samples.push(after.saturating_sub(before));
    }
    samples.sort_unstable();
    samples[samples.len() / 2]
}

pub fn drive(
    app: &mut App,
    out: &str,
    args: &Args,
    keep: &dyn Fn(u64) -> bool,
) -> Result<Run, Value> {
    let scene = app.scene(&args.scene)?;
    let explicit = args.path.is_some();
    let path = args.path.unwrap_or(app.decision.path);
    let scale = if explicit {
        1.
    } else {
        app.decision.internal_scale
    };
    let ui = if args.layer {
        Some(session_ui(app, &args.scene, path, args.workers)?)
    } else {
        None
    };
    #[cfg(feature = "test-pool")]
    {
        let finish = args.pool.unwrap_or(deep_gpu::encode::Finish::AsDone);
        app.worker.call(move |state| {
            if let Some(s) = state.current() {
                s.view.pool_mut().finish_in(finish);
            }
        });
    }
    app.window(scene.window)?;
    let waits = app.planted == Some(Planted::WaitsOnGpu);
    {
        let w = app.window.as_ref().expect("opened above");
        let mut p = w.paint.borrow_mut();
        p.page = scene.page.clone();
        p.view = scene.view;
        p.size = scene.size;
        p.ui = None;
        p.card = args.card.clone();
        p.waits_on_gpu = waits;
        p.overlays.clear();
        p.pairs_newest = false;
    }
    let baseline = if args.timings && args.layer {
        baseline_ns(app)
    } else {
        0
    };
    if let Some(ui) = &ui {
        ui.record(false);
        ui.take_record();
        ui.record(true);
        app.window.as_ref().expect("opened").paint.borrow_mut().ui = Some(ui.clone());
    }
    let noop = app.backend == Backend::Noop;
    let mut run = Run {
        frames: Vec::new(),
        marks: Vec::new(),
        losses: 0,
    };
    for n in args.from..args.from + args.count {
        let size = scene.size_at(n, args.resize);
        let mut frame = Frame {
            frame: n,
            size,
            path,
            pixel_hash: None,
            settling: false,
            window: None,
            window_hash: None,
            image: None,
            blank: None,
            handoff_ms: None,
            ui_ms: None,
            encodes: None,
        };
        let mut render_handoff = Duration::ZERO;
        let mut presented = false;
        if args.layer {
            let slot_size = size.map(|v| ((f64::from(v) * scale).round() as u32).max(1));
            let lose = args.lose_at == Some(n);
            let key = args.scene.clone();
            let hash = args.hash && !noop;
            let (submitted_tx, submitted_rx) = mpsc::channel::<()>();
            let answer = app.worker.send(move |state| -> Result<Drawn, String> {
                let s = state.sessions.get_mut(&key).ok_or("no session")?;
                s.view.resize(slot_size);
                let drawn = loop {
                    if let Some(d) = s.view.render(n)? {
                        break d;
                    }
                    s.view.wait_free();
                };
                let _ = submitted_tx.send(());
                if lose {
                    s.view.lose_device();
                }
                if !s.view.wait_done(drawn.slot) {
                    return Ok(Drawn::Lost);
                }
                let handoff = s
                    .view
                    .times(drawn.slot)
                    .map_or(Duration::ZERO, |t| t.handoff());
                let pixel_hash = hash
                    .then(|| s.view.read(drawn.slot).map(|b| hex(&b)))
                    .flatten();
                Ok(Drawn::Shown {
                    settling: drawn.settling,
                    pixel_hash,
                    handoff,
                    encodes: drawn.encodes,
                })
            });
            if waits {
                // The planted UI thread presents as soon as the frame is submitted, and its paint
                // waits on the frame's fence.
                let _ = submitted_rx.recv();
                let w = app.window.as_ref().expect("opened");
                w.paint.borrow_mut().size = size;
                w.present(&mut app.cx);
                presented = true;
            }
            let answer = answer
                .recv()
                .map_err(|_| refused("no_render", "the render thread stopped"))?;
            match answer.map_err(|e| refused("render_failed", e))? {
                Drawn::Lost => {
                    run.losses += 1;
                    continue;
                }
                Drawn::Shown {
                    settling,
                    pixel_hash,
                    handoff,
                    encodes,
                } => {
                    frame.settling = settling;
                    frame.pixel_hash = pixel_hash;
                    render_handoff = handoff;
                    #[cfg(feature = "test-pool")]
                    if args.pool.is_some() {
                        frame.encodes = Some(encodes.clone());
                    }
                    let _ = encodes;
                }
            }
        }
        let w = app.window.as_ref().expect("opened");
        if !presented {
            w.paint.borrow_mut().size = size;
            w.present(&mut app.cx);
        }
        let ui_time =
            w.paint.borrow().ui_time + ui.as_ref().map_or(Duration::ZERO, |u| u.take_committed());
        if args.capture.wants(n) || args.window_hash || keep(n) {
            let image = w
                .capture(&mut app.cx)
                .map_err(|e| refused("no_capture", e))?;
            frame.window_hash = Some(hex(image.as_raw()));
            frame.blank = Some(crate::compare::blank_rgba(image.as_raw()));
            if args.capture.wants(n) {
                let mut png = Vec::new();
                image::codecs::png::PngEncoder::new_with_quality(
                    &mut png,
                    image::codecs::png::CompressionType::Fast,
                    image::codecs::png::FilterType::Sub,
                )
                .write_image(
                    image.as_raw(),
                    image.width(),
                    image.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|e| refused("no_capture", e.to_string()))?;
                let name = hex(&png);
                std::fs::write(std::path::Path::new(out).join(format!("{name}.png")), &png)
                    .map_err(|e| refused("not_written", e.to_string()))?;
                frame.window = Some(name);
            }
            if keep(n) {
                frame.image = Some(image);
            }
        }
        if let Some(ui) = &ui {
            if args.timings {
                gpui_idle();
            }
            let marks = ui.take_record();
            if args.timings {
                // The GPU time GPUI's frame spent beyond the window's own: the composite of the slot.
                let cb = marks.iter().find_map(|m| match m {
                    Mark::Sampled {
                        frame: f, buffer, ..
                    } if *f == n => Some(*buffer),
                    _ => None,
                });
                let gpu = cb
                    .and_then(|cb| {
                        marks.iter().find_map(|m| match m {
                            Mark::Completed { buffer, gpu_ns } if *buffer == cb => Some(*gpu_ns),
                            _ => None,
                        })
                    })
                    .unwrap_or(0)
                    .saturating_sub(baseline);
                frame.ui_ms = Some(ui_time.as_secs_f64() * 1e3);
                frame.handoff_ms =
                    Some((render_handoff + ui_time).as_secs_f64() * 1e3 + gpu as f64 / 1e6);
            }
            if args.fences {
                run.marks.extend(marks);
            }
        }
        run.frames.push(frame);
    }
    if let Some(ui) = &ui {
        if args.fences {
            gpui_idle();
            run.marks.extend(ui.take_record());
        }
        ui.record(false);
    }
    Ok(run)
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let mut args = match Args::parse(call) {
        Ok(a) => a,
        Err(e) => return e,
    };
    let scene = match app.scene(&args.scene) {
        Ok(s) => s,
        Err(e) => return e,
    };
    args.count = call["count"].as_u64().unwrap_or(scene.frames);
    match drive(app, out, &args, &|_| false) {
        Ok(run) => {
            let mut reply = json!({
                "frames": run.frames.iter().map(Frame::json).collect::<Vec<_>>(),
                "device_losses": run.losses,
            });
            if args.fences {
                reply["fences"] = json!(fences(&run.marks));
            }
            reply
        }
        Err(e) => e,
    }
}

/// `render`: frame n of the scene as a canonical render, an export's frame or a snapshot. It draws
/// in a session of its own, offscreen, and takes the first frame that doesn't report settling.
pub fn render(app: &mut App, call: &Value) -> Value {
    let (Some(scene_path), Some(n)) = (call["scene"].as_str(), call["frame"].as_u64()) else {
        return refused("bad_input", "render takes a scene and a frame");
    };
    if !matches!(
        call["purpose"].as_str(),
        Some("canonical" | "export" | "snapshot")
    ) {
        return refused("bad_input", "purpose is canonical, export or snapshot");
    }
    let scene = match app.scene(scene_path) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let noop = app.backend == Backend::Noop;
    let path = app.decision.path;
    let key = format!("canonical:{scene_path}");
    let answer = app.worker.call(move |state| -> Result<Value, String> {
        let current = state.current.clone();
        let s = state.session(&key, scene, path, WORKERS)?;
        let ui = s.view.ui();
        let mut answer = None;
        for _ in 0..10_000 {
            let drawn = loop {
                if let Some(d) = s.view.render(n)? {
                    break d;
                }
                ui.retire();
            };
            s.view.wait_done(drawn.slot);
            if !drawn.settling {
                let pixel_hash = (!noop)
                    .then(|| s.view.read(drawn.slot).map(|b| hex(&b)))
                    .flatten();
                answer = Some(json!({"frame": n, "pixel_hash": pixel_hash, "settling": false}));
            }
            ui.retire();
            if answer.is_some() {
                break;
            }
        }
        state.current = current;
        answer.ok_or_else(|| "the scene never settled".to_string())
    });
    answer.unwrap_or_else(|e| refused("never_settled", e))
}
