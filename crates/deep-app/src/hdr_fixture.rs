//! Issue #177's live fixture, in no shipped build (`hdr-fixture`; tests/acceptance/177/README.md,
//! "deep-app --hdr"): `deep-app --hdr <scenario.json>` opens the app's real window on the main
//! display, draws a scene document in a live 3D view over a page through the window's layers (the
//! HDR surface beneath GPUI's with `hdr: auto` on an XDR display, the SDR slot with `off`), plays
//! the scenario's frames, prints one report line `{"hdr": 177, …}` and quits. `DEEP_HDR_PLANT`
//! selects a wrong program, read only here.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use deep_canvas_scene3d::look::Look3;
use deep_gpu::device::{Backend, Gpu};
use deep_gpu::encode::Pool;
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, Ui, View};
use deep_scene3d_render::{HdrFrame, Module3, Shared};
use gpui_apple::metal_renderer::{gpu_ledger, layer_colorspace};
use gpui_kit::*;
use objc2_app_kit::NSView;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};

use crate::hdr_layer::{self, HdrLayer};

fn planted(name: &str) -> bool {
    std::env::var("DEEP_HDR_PLANT").is_ok_and(|p| p == name)
}

/// The scenario (`hdr-fixture@1`).
struct Scenario {
    out: PathBuf,
    doc: Value,
    look: Look3,
    window: [f32; 2],
    page: [u8; 3],
    view: [f32; 4],
    auto: bool,
    frames: u64,
    close_at: Option<u64>,
    resize_to: Option<[f32; 2]>,
    captures: bool,
    posts: Vec<(u64, f32)>,
    read_peak: bool,
    /// The shell's question card over the view, `{question, options: [{label}], rect}`.
    card: Option<(String, Vec<String>, [f32; 4])>,
    /// Captures divided by the frame's headroom, so an 8-bit picture shows what lies above
    /// paper white (evidence pictures; paper white reads 1 ÷ headroom).
    divide: bool,
}

fn floats<const N: usize>(v: &Value, what: &str) -> Result<[f64; N], String> {
    let a = v
        .as_array()
        .filter(|a| a.len() == N)
        .ok_or(format!("{what} is {N} numbers"))?;
    let mut out = [0.0; N];
    for (o, x) in out.iter_mut().zip(a) {
        *o = x.as_f64().ok_or(format!("{what} is {N} numbers"))?;
    }
    Ok(out)
}

impl Scenario {
    fn read(path: &str) -> Result<Scenario, String> {
        let s: Value =
            serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if s["format"] != "hdr-fixture@1" {
            return Err("format is hdr-fixture@1".into());
        }
        let doc_path = s["doc"].as_str().ok_or("doc is a path")?;
        let doc =
            serde_json::from_str(&std::fs::read_to_string(doc_path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let page = floats::<3>(&s["page"], "page")?.map(|c| c as u8);
        let posts = s["posts"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| Some((p["frame"].as_u64()?, p["headroom"].as_f64()? as f32)))
            .collect::<Option<_>>()
            .ok_or("a post is {frame, headroom}")?;
        Ok(Scenario {
            out: PathBuf::from(s["out"].as_str().ok_or("out is a folder")?),
            doc,
            look: Look3::read(&s["look"])?,
            window: floats::<2>(&s["window"], "window")?.map(|v| v as f32),
            page,
            view: floats::<4>(&s["view"], "view")?.map(|v| v as f32),
            auto: s["hdr"] != "off",
            frames: s["frames"].as_u64().ok_or("frames is a count")?,
            close_at: s["close_view_at"].as_u64(),
            resize_to: s
                .get("resize")
                .filter(|r| !r.is_null())
                .map(|r| floats::<2>(&r["to"], "resize.to").map(|v| v.map(|x| x as f32)))
                .transpose()?,
            captures: s["captures"] == true,
            posts,
            read_peak: s["read_peak"] == true,
            card: s.get("card").filter(|c| c.is_object()).map(|c| {
                let options = c["options"].as_array().into_iter().flatten();
                let options = options.filter_map(|o| o["label"].as_str().map(str::to_string));
                let rect = floats::<4>(&c["rect"], "card.rect").unwrap_or_default();
                (c["question"].as_str().unwrap_or_default().to_string(), options.collect(), rect.map(|v| v as f32))
            }),
            divide: s["divide_by_headroom"] == true,
        })
    }

    /// The window's size at frame `k`: stepping linearly to `resize.to` over the frames.
    fn window_at(&self, k: u64) -> [f32; 2] {
        let Some(to) = self.resize_to else {
            return self.window;
        };
        let f = (k as f32 + 1.0) / self.frames.max(1) as f32;
        [0, 1].map(|i| (self.window[i] + (to[i] - self.window[i]) * f).round())
    }

    /// The view's rect at window size `w`: its inset from every edge kept.
    fn view_at(&self, w: [f32; 2]) -> [f32; 4] {
        let [x, y, vw, vh] = self.view;
        let (right, bottom) = (self.window[0] - x - vw, self.window[1] - y - vh);
        [x, y, w[0] - x - right, w[1] - y - bottom]
    }
}

/// A frame the render thread draws, and what it hands back.
struct Ask {
    n: u64,
    size: [u32; 2],
    /// The headroom the frame rolls off to, presenting through the HDR surface; None for SDR.
    headroom: Option<f32>,
    read: bool,
}
struct Done {
    gpu_ms: f64,
    texels: Option<Vec<u8>>,
}

/// The render thread: the view, its renderer and the HDR surface, off the UI thread.
fn render_thread(
    gpu: Arc<Gpu>,
    doc: Value,
    look: Look3,
    hdr: Arc<Mutex<Option<Arc<HdrLayer>>>>,
    ui_out: mpsc::Sender<Ui>,
    asks: mpsc::Receiver<Ask>,
    dones: mpsc::Sender<Done>,
) {
    let (module, shared) = Module3::new(Default::default());
    let mut view = View::new(
        gpu.clone(),
        Config {
            path: Path::ZeroCopy,
            slots: 3,
            size: [1, 1],
            upload_bytes_per_frame: 64 << 20,
        },
        Box::new(module),
        Pool::new(4),
    )
    .expect("the view opens");
    let _ = ui_out.send(view.ui());
    let device = gpu.device();
    let profiler = wgpu_profiler::GpuProfiler::new(&device.device, Default::default()).ok();
    let profiler = profiler.map(|p| Arc::new(Mutex::new(p)));
    let (mut sized, mut configured) = ([0, 0], ([0, 0], false));
    let mut scene = None;
    for ask in asks {
        if ask.size != sized {
            sized = ask.size;
            view.resize(ask.size);
            let mut d = doc.clone();
            d["size"] = json!(ask.size);
            let mut labels = deep_canvas_scene3d::scene::Labels::new();
            scene = deep_canvas_scene3d::scene::evaluate(&d, 0, &look, &mut labels)
                .ok()
                .map(Arc::new);
        }
        let layer = hdr.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let frame = match (&layer, ask.headroom) {
            (Some(l), Some(_)) => {
                if configured != (ask.size, ask.read) {
                    l.configure(&device.device, ask.size, ask.read);
                    configured = (ask.size, ask.read);
                }
                match l.surface.get_current_texture() {
                    wgpu::CurrentSurfaceTexture::Success(t)
                    | wgpu::CurrentSurfaceTexture::Suboptimal(t) => Some(t),
                    _ => None,
                }
            }
            _ => None,
        };
        {
            let mut s: std::sync::MutexGuard<'_, Shared> =
                shared.lock().unwrap_or_else(|e| e.into_inner());
            s.next = scene.clone().map(|sc| (sc, look.clone()));
            s.hdr = frame
                .as_ref()
                .zip(ask.headroom)
                .map(|(f, headroom)| HdrFrame {
                    into: f.texture.create_view(&Default::default()),
                    headroom,
                });
            if let Some(r) = s.renderer.as_mut() {
                r.profiler = profiler.clone();
            }
        }
        let drawn = loop {
            match view.render(ask.n) {
                Ok(Some(d)) => break Some(d),
                Ok(None) => view.wait_free(),
                Err(_) => break None,
            }
        };
        if let Some(d) = &drawn {
            view.wait_done(d.slot);
        }
        let gpu_ms = profiler.as_ref().map_or(0.0, |p| {
            let mut p = p.lock().unwrap_or_else(|e| e.into_inner());
            let mut enc = device.device.create_command_encoder(&Default::default());
            p.resolve_queries(&mut enc);
            device.queue.submit([enc.finish()]);
            let _ = p.end_frame();
            let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
            p.process_finished_frame(device.queue.get_timestamp_period())
                .map(|r| {
                    r.iter()
                        .filter_map(|q| q.time.as_ref().map(|t| t.end - t.start))
                        .sum::<f64>()
                        * 1e3
                })
                .unwrap_or(0.0)
        });
        let texels = match &frame {
            Some(f) if ask.read => deep_scene3d_render::hdr::read(&device, &f.texture),
            _ => None,
        };
        if let Some(f) = frame {
            device.queue.present(f);
        }
        let _ = dones.send(Done { gpu_ms, texels });
    }
}

/// A frame's row, filled across two UI callbacks: what this frame asked, then what it drew.
struct Row {
    frame: u64,
    ms: f64,
    on: bool,
    headroom: f32,
    cpu_ms: f64,
    gpu_ms: f64,
    peak: Option<f32>,
    size: [f32; 2],
    texels: Option<Vec<u8>>,
    layer_rect: Option<[f64; 4]>,
}

struct Run {
    sc: Scenario,
    ui: Ui,
    gpu: Arc<Gpu>,
    asks: mpsc::Sender<Ask>,
    dones: mpsc::Receiver<Done>,
    hdr: Arc<Mutex<Option<Arc<HdrLayer>>>>,
    /// The headroom as last read, and whether the display posted a change since.
    potential: f32,
    current: Option<f32>,
    changed: Rc<RefCell<u64>>,
    seen: u64,
    reads: u64,
    posts: u64,
    open: bool,
    first: Option<Instant>,
    rows: Vec<Value>,
    last: Option<Row>,
    ledger: u64,
    prev_rect: Option<[f64; 4]>,
    /// Where the HDR layer stands now: it's placed again only when the view's rect changes, so a
    /// still view's frames spend nothing on the UI thread for it.
    placed: Option<[f64; 4]>,
    paint: Rc<RefCell<Paint>>,
    _observer: Option<
        objc2::rc::Retained<objc2::runtime::ProtocolObject<dyn objc2_foundation::NSObjectProtocol>>,
    >,
}

/// What the root view paints this frame.
#[derive(Default)]
struct Paint {
    view: Option<[f32; 4]>,
    ui: Option<Ui>,
    hdr: bool,
}

struct Root {
    page: [u8; 3],
    paint: Rc<RefCell<Paint>>,
    card: Option<(String, Vec<String>, [f32; 4])>,
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let [r, g, b] = self.page.map(|c| f32::from(c) / 255.);
        let paint = self.paint.clone();
        div().size_full().bg(Rgba { r, g, b, a: 1. }).child(
            canvas(
                |_, _, _| {},
                move |_, _, window, _| {
                    let p = paint.borrow();
                    let (Some([x, y, w, h]), Some(ui)) = (p.view, &p.ui) else {
                        return;
                    };
                    let bounds = Bounds {
                        origin: point(px(x), px(y)),
                        size: size(px(w), px(h)),
                    };
                    if p.hdr {
                        crate::gpu_view::paint_clear(ui, bounds, window);
                    } else {
                        crate::gpu_view::paint(ui, bounds, window);
                    }
                },
            )
            .size_full(),
        )
        .children(self.card.clone().map(|(question, options, [x, y, w, h])| {
            let ink = Rgba { r: 0.08, g: 0.08, b: 0.08, a: 1. };
            div()
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(w))
                .h(px(h))
                .overflow_hidden()
                .rounded(px(12.))
                .bg(Rgba { r: 0.98, g: 0.98, b: 0.97, a: 1. })
                .p(px(20.))
                .flex()
                .flex_col()
                .gap(px(16.))
                .text_color(ink)
                .child(div().text_size(px(18.)).child(question))
                .child(div().flex().gap(px(12.)).children(options.into_iter().map(|o| {
                    div().px(px(14.)).py(px(8.)).rounded(px(8.)).bg(Rgba { r: 0.91, g: 0.93, b: 0.94, a: 1. }).child(o)
                })))
        }))
    }
}

fn gpui_view(window: &Window) -> &NSView {
    let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        panic!("an AppKit window");
    };
    // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
    unsafe { handle.ns_view.cast::<NSView>().as_ref() }
}

fn thread_cpu_ms() -> f64 {
    // SAFETY: a zeroed timespec for clock_gettime to fill.
    let mut t: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as f64 * 1e3 + t.tv_nsec as f64 / 1e6
}

fn half(h: u16) -> f32 {
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let (exp, man) = (i32::from((h >> 10) & 0x1f), f32::from(h & 0x3ff));
    match exp {
        0 => sign * man * 2f32.powi(-24),
        31 => f32::INFINITY,
        e => sign * (1.0 + man / 1024.0) * 2f32.powi(e - 15),
    }
}

/// Runs the scenario at `path`.
pub fn run(path: &str, cx: &mut App) {
    // A window that gets no frames (a locked screen, a hidden window) would wait forever: after
    // 20 s with none the run ends, saying why.
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let last = LAST_FRAME.load(std::sync::atomic::Ordering::SeqCst);
        let now = START.elapsed().as_secs();
        if now.saturating_sub(last) > 20 {
            eprintln!("deep-app --hdr: no frame for 20 s: the screen is locked or the window is hidden");
            std::process::exit(3);
        }
    });
    let sc = match Scenario::read(path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("deep-app --hdr: {e}");
            std::process::exit(2);
        }
    };
    let gpu = Gpu::open(Backend::Gpu).expect("the app's GPU");
    let hdr: Arc<Mutex<Option<Arc<HdrLayer>>>> = Arc::default();
    let (ask_tx, ask_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let (ui_tx, ui_rx) = mpsc::channel();
    {
        let (gpu, doc, look, hdr) = (gpu.clone(), sc.doc.clone(), sc.look.clone(), hdr.clone());
        std::thread::spawn(move || render_thread(gpu, doc, look, hdr, ui_tx, ask_rx, done_tx));
    }
    let ui = ui_rx.recv().expect("the render thread's view");
    crate::gpu_view::watch(&ui);
    let paint = Rc::new(RefCell::new(Paint::default()));
    let [w, h] = sc.window;
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: point(px(120.), px(120.)), // size-literal-exception: a #177 check fixture, in no shipped build; review 2027-05-15
            size: size(px(w), px(h)),
        })),
        kind: WindowKind::PopUp,
        focus: true,
        show: true,
        ..Default::default()
    };
    let page = sc.page;
    let card = sc.card.clone();
    let run = Rc::new(RefCell::new(None::<Run>));
    let root_paint = paint.clone();
    open_window(options, cx, move |window, cx| {
        let changed = Rc::new(RefCell::new(0u64));
        let observer = {
            let changed = changed.clone();
            hdr_layer::on_display_change(move || *changed.borrow_mut() += 1)
        };
        *run.borrow_mut() = Some(Run {
            sc,
            ui,
            gpu,
            asks: ask_tx,
            dones: done_rx,
            hdr,
            potential: 1.0,
            current: None,
            changed,
            seen: 0,
            reads: 0,
            posts: 0,
            open: true,
            first: None,
            rows: Vec::new(),
            last: None,
            ledger: gpu_ledger::read().gpu_ns,
            prev_rect: None,
            placed: None,
            paint: paint.clone(),
            _observer: Some(observer),
        });
        let run = run.clone();
        visible(window, 0, move |window, cx| step(window, cx, run, 0));
        cx.new(|_| Root {
            page,
            paint: root_paint,
            card,
        })
    })
    .expect("open the window");
    cx.activate(true);
}

/// Runs `then` on the first frame after AppKit reports the window visible, asking for a frame
/// until it does: a request made before the window shows can stop GPUI's display link with
/// nothing asked again, and then no frame would ever come.
fn visible(window: &mut Window, tries: u32, then: impl FnOnce(&mut Window, &mut App) + 'static) {
    window.refresh();
    window.on_next_frame(move |window, cx| {
        let shown = gpui_view(window).window().is_some_and(|w| {
            w.occlusionState()
                .contains(objc2_app_kit::NSWindowOcclusionState::Visible)
        });
        if shown || tries > 240 {
            then(window, cx);
        } else {
            visible(window, tries + 1, then);
        }
    });
}

/// Frame `k`: finishes frame k − 1's row, then asks for frame k and paints it.
/// When the process started, and the second of it the last frame came in.
static START: std::sync::LazyLock<Instant> = std::sync::LazyLock::new(Instant::now);
static LAST_FRAME: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn step(window: &mut Window, cx: &mut App, run: Rc<RefCell<Option<Run>>>, k: u64) {
    LAST_FRAME.store(START.elapsed().as_secs(), std::sync::atomic::Ordering::SeqCst);
    let mut guard = run.borrow_mut();
    let r = guard.as_mut().expect("the run");
    let scale = window.scale_factor();
    finish_row(r, scale);
    if k >= r.sc.frames {
        report(r, window, scale);
        drop(guard);
        cx.quit();
        return;
    }
    let started = thread_cpu_ms();
    let view = objc2::Message::retain(gpui_view(window));
    let view = &*view;
    // The view closes after frame `close_view_at`: the page alone from then on.
    if r.sc.close_at.is_some_and(|c| k > c) && r.open {
        r.open = false;
        if !planted("keeps_hdr_layer") {
            if let Some(l) = r.hdr.lock().unwrap_or_else(|e| e.into_inner()).take() {
                l.remove();
            }
        }
        crate::gpu_view::unwatch(&r.ui);
    }
    // The display: its potential headroom once; its current one when the HDR surface first
    // shows and each time the display posts a change (a fixture post stands in for one).
    if k == 0 {
        r.potential = hdr_layer::headroom(view).0;
    }
    let posted = r.sc.posts.iter().find(|(f, _)| *f == k).map(|p| p.1);
    let heard = *r.changed.borrow() != r.seen;
    if heard {
        r.seen = *r.changed.borrow();
        r.posts += 1;
    }
    if posted.is_some() {
        r.posts += 1;
    }
    let waits = planted("auto_waits_for_headroom");
    let wants = r.open && r.sc.auto && r.potential > 1.0;
    if waits && r.current.is_none() {
        r.reads += 1;
        r.current = Some(hdr_layer::headroom(view).1);
    }
    let on = wants && (!waits || r.current.is_some_and(|c| c > 1.0));
    if on && r.hdr.lock().unwrap_or_else(|e| e.into_inner()).is_none() {
        let instance = r
            .gpu
            .seam()
            .map(|c| c.instance.clone())
            .expect("a GPU seam");
        match HdrLayer::beneath(view, &instance) {
            Ok(l) => {
                *r.hdr.lock().unwrap_or_else(|e| e.into_inner()) = Some(Arc::new(l));
                r.placed = None;
            }
            Err(e) => eprintln!("deep-app --hdr: {e}"),
        }
    }
    let shows = on && r.hdr.lock().unwrap_or_else(|e| e.into_inner()).is_some();
    if shows
        && (r.current.is_none()
            || heard
            || posted.is_some()
            || planted("reads_headroom_every_frame"))
    {
        r.reads += 1;
        r.current = Some(posted.unwrap_or_else(|| hdr_layer::headroom(view).1));
    }
    let headroom = r.current.unwrap_or(1.0);
    // The window's size this frame, and the view's rect in it: the size GPUI draws this frame at,
    // which a resize reaches when the platform reports it, and the layer is placed for that.
    if r.sc.resize_to.is_some() {
        let to = r.sc.window_at(k);
        window.resize(size(px(to[0]), px(to[1])));
    }
    let drawn = window.viewport_size();
    let wsize = [f32::from(drawn.width), f32::from(drawn.height)];
    let rect = r.sc.view_at(wsize);
    let rect64 = rect.map(f64::from);
    let layer_rect = if shows {
        let placed = if planted("surface_resizes_late") {
            r.prev_rect.unwrap_or(rect64)
        } else {
            rect64
        };
        if r.placed != Some(placed) {
            if let Some(l) = r.hdr.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
                l.place(view, placed);
            }
            r.placed = Some(placed);
        }
        Some(placed)
    } else {
        None
    };
    r.prev_rect = Some(rect64);
    {
        let mut p = r.paint.borrow_mut();
        p.view = r.open.then_some(rect);
        p.ui = r.open.then(|| r.ui.clone());
        p.hdr = shows;
    }
    let device = rect.map(|v| (v * scale).round() as u32);
    let read = shows && (r.sc.captures || r.sc.read_peak);
    // A closed view draws nothing: its slots are never latched again.
    let done = if r.open {
        let _ = r.asks.send(Ask {
            n: k,
            size: [device[2], device[3]],
            headroom: shows.then_some(headroom),
            read,
        });
        r.dones.recv().ok()
    } else {
        None
    }
    .unwrap_or(Done {
        gpu_ms: 0.0,
        texels: None,
    });
    if r.sc.captures {
        layer_colorspace::read_next_frame();
    }
    let first = *r.first.get_or_insert_with(Instant::now);
    let peak = (r.sc.read_peak && shows).then(|| {
        done.texels.as_ref().map_or(0.0, |t| {
            t.chunks_exact(8)
                .flat_map(|p| {
                    (0..3).map(move |i| half(u16::from_le_bytes([p[i * 2], p[i * 2 + 1]])))
                })
                .fold(0.0f32, f32::max)
        })
    });
    r.last = Some(Row {
        frame: k,
        ms: first.elapsed().as_secs_f64() * 1e3,
        on: shows,
        headroom: if shows { headroom } else { 1.0 },
        cpu_ms: thread_cpu_ms() - started,
        gpu_ms: done.gpu_ms,
        peak,
        size: wsize,
        texels: done.texels.filter(|_| r.sc.captures),
        layer_rect,
    });
    window.refresh();
    let run2 = run.clone();
    drop(guard);
    window.on_next_frame(move |window, cx| step(window, cx, run2, k + 1));
}

/// Frame k − 1's row, once GPUI drew it: its GPU time and its capture.
fn finish_row(r: &mut Run, scale: f32) {
    let Some(row) = r.last.take() else { return };
    let ledger = gpu_ledger::read();
    let gpui_ms = ledger.gpu_ns.saturating_sub(r.ledger) as f64 / 1e6;
    r.ledger = ledger.gpu_ns;
    let mut v = json!({
        "frame": row.frame, "ms": row.ms, "state": if row.on { "on" } else { "off" },
        "headroom": row.headroom, "cpu_ms": row.cpu_ms, "gpu_ms": row.gpu_ms + gpui_ms,
        "size": row.size,
    });
    if let Some(p) = row.peak {
        v["peak"] = json!(p);
    }
    if r.sc.captures {
        if let Some(image) = layer_colorspace::take_frame() {
            let divide = if r.sc.divide { row.headroom } else { 1.0 };
            let composed = compose(image, row.texels.as_deref(), row.layer_rect, scale, divide);
            let file = r.sc.out.join(format!("capture-{}.png", row.frame));
            if composed.save(&file).is_ok() {
                v["capture"] = json!(file.display().to_string());
            }
        }
    }
    r.rows.push(v);
}

/// The window as the compositor composites it: GPUI's drawable (premultiplied) over the HDR
/// layer's last frame at its frame, encoded to 8-bit sRGB; what neither covers is black.
fn compose(
    mut gpui: image::RgbaImage,
    texels: Option<&[u8]>,
    rect: Option<[f64; 4]>,
    scale: f32,
    divide: f32,
) -> image::RgbaImage {
    let s = f64::from(scale);
    let (w, h) = gpui.dimensions();
    let under = |x: u32, y: u32| -> [f32; 3] {
        let (Some(t), Some([rx, ry, rw, rh])) = (texels, rect) else {
            return [0.0; 3];
        };
        let (fx, fy) = (f64::from(x) / s - rx, f64::from(y) / s - ry);
        if fx < 0.0 || fy < 0.0 || fx >= rw || fy >= rh {
            return [0.0; 3];
        }
        let (tw, th) = ((rw * s).round() as usize, (rh * s).round() as usize);
        if t.len() < tw * th * 8 {
            return [0.0; 3];
        }
        let (tx, ty) = (
            (fx / rw * tw as f64) as usize,
            (fy / rh * th as f64) as usize,
        );
        let o = (ty.min(th - 1) * tw + tx.min(tw - 1)) * 8;
        [0, 1, 2].map(|i| half(u16::from_le_bytes([t[o + i * 2], t[o + i * 2 + 1]])))
    };
    for y in 0..h {
        for x in 0..w {
            let p = gpui.get_pixel_mut(x, y);
            let a = f32::from(p[3]) / 255.0;
            if a >= 1.0 && divide == 1.0 {
                continue;
            }
            let hdr = if a >= 1.0 { [0.0; 3] } else { under(x, y) };
            let decode = |c: u8| deep_canvas_marks::finish::srgb_decode(f64::from(c) / 255.0) as f32;
            for i in 0..3 {
                let linear = (decode(p[i]) + (1.0 - a) * hdr[i]) / divide;
                let e = deep_canvas_marks::finish::srgb_encode(f64::from(linear)) as f32 * 255.0;
                p[i] = e.round().clamp(0.0, 255.0) as u8;
            }
            p[3] = 255;
        }
    }
    gpui
}

fn report(r: &Run, window: &Window, scale: f32) {
    let layers: Vec<Value> = {
        let hdr = r.hdr.lock().unwrap_or_else(|e| e.into_inner()).clone();
        hdr_layer::layers(gpui_view(window), hdr.as_deref())
            .into_iter()
            .map(|l| json!({"owner": l.owner, "format": l.format, "colorspace": l.colorspace, "edr": l.edr, "opaque": l.opaque}))
            .collect()
    };
    println!(
        "{}",
        json!({"hdr": 177, "scale": scale, "display": {"potential_headroom": r.potential},
               "frames": r.rows, "layers": layers, "headroom_reads": r.reads, "display_posts": r.posts})
    );
}
