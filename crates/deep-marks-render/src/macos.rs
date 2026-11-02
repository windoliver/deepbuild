//! The view on macOS: one headless GPUI app for every line, a window per document session at the
//! view's zoom as its scale factor, and the session's caches (canvas primitives: Invalidation and
//! damage; Content key; Dirty classes).
//!
//! - A path's tessellation is cached by (content key, zoom bucket): moving or recoloring it, or a
//!   zoom inside its bucket, reuses the triangles.
//! - A text's shaped run comes from deep-text-gpui's cache, keyed by what the shaper reads.
//! - A writer layer, once it and every layer under it have stayed the same for 3 presented frames,
//!   is drawn once into a cache window over the ground and composited from that picture after, so
//!   its marks aren't drawn again while it stays still.
//!
//! A cache entry lives while the frame on screen reads it. Each frame stamps its items' dirty
//! classes, and a layer counts as unchanged only while none of its items, nor any under it, is
//! dirty. A rect mask clips its items as a scissor, and an image is read from the request's
//! content-addressed store by its sha256, checked, and decoded once per session.
//!
//! Status marks draw after every writer layer, unlit and exact, each with its state's glyph and
//! word inside it, and a legend of every state on screen (its swatch, glyph and word) at the
//! frame's top right; nothing covers them (canvas primitives: The status-color rule).

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas_marks::dirty::{Class, Dirty};
use deep_canvas_marks::key::{sha256_hex, ContentKey, KeyBuilder};
use deep_canvas_marks::look::Look;
use deep_canvas_marks::path::{self, Mesh};
use deep_canvas_marks::scene::{self, Drawn, Fill, ImageSampling, Mark, Record, Rgb, StatusMark};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_marks_gpui::Strip;
use deep_text_gpui::Label;
use gpui_apple::metal_renderer::gpu_ledger::{self, Ledger};
use gpui_kit::test::TestWindowExt;
use gpui_kit::*;
use serde_json::{json, Map, Value};

use crate::status::{self, label_of, occupied, Prim};
use crate::{palette_of, refused, Request, Step, Theme, View};

/// Frames a writer layer stays the same before it is cached (Invalidation and damage).
const STABLE_FRAMES: u32 = 3;
/// One vsync of a session's steps: 60 Hz in flicks.
const STEP_VSYNC: i64 = 705_600_000 / 60;

fn hsla(c: Rgb) -> Hsla {
    Rgba {
        r: f32::from(c[0]) / 255.,
        g: f32::from(c[1]) / 255.,
        b: f32::from(c[2]) / 255.,
        a: 1.,
    }
    .into()
}

/// One thing the view paints this frame, in logical pixels.
#[derive(Clone)]
enum Draw {
    Quad(PaintQuad),
    Path {
        mesh: Arc<Mesh>,
        offset: [f32; 2],
        color: Hsla,
    },
    /// A stroke, its edges antialiased by GPUI's path shader (#140).
    Strip {
        strip: Arc<Strip>,
        offset: [f32; 2],
        color: Hsla,
    },
    Text {
        label: Label,
        origin: Point<Pixels>,
        color: Hsla,
        /// text@1 `runs`: grapheme spans in their own colors.
        runs: Vec<(std::ops::Range<usize>, Hsla)>,
    },
    /// A picture mapped onto `image_bounds` and shown inside `bounds`: an image mark, or a cached
    /// writer layer with everything under it over the whole view.
    Picture {
        image: Arc<RenderImage>,
        bounds: Option<Bounds<Pixels>>,
        image_bounds: Option<Bounds<Pixels>>,
    },
}

/// A draw and the rect its masks clip it to.
type Placed = (Draw, Option<Bounds<Pixels>>);

/// What a window paints: the draws its frame clock set for the next frame.
struct Canvas {
    draws: Rc<RefCell<Vec<Placed>>>,
}

fn paint(draw: &Draw, view: Bounds<Pixels>, window: &mut Window) {
    match draw {
        Draw::Quad(q) => window.paint_quad(q.clone()),
        Draw::Picture {
            image,
            bounds,
            image_bounds,
        } => {
            let _ = window.paint_image(
                bounds.unwrap_or(view),
                image_bounds.unwrap_or(view),
                Corners::default(),
                image.clone(),
                0,
                false,
            );
        }
        Draw::Path {
            mesh,
            offset,
            color,
        } => deep_marks_gpui::paint(mesh, *offset, *color, window),
        Draw::Strip {
            strip,
            offset,
            color,
        } => deep_marks_gpui::paint_strip(strip, *offset, *color, window),
        Draw::Text {
            label,
            origin,
            color,
            runs,
        } => {
            deep_text_gpui::paint_runs(view.origin + *origin, label, *color, runs, window);
        }
    }
}

impl Render for Canvas {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let prepared = self.draws.clone();
        let draws = self.draws.clone();
        div().size_full().child(
            canvas(
                // Every label's glyphs placed before the first paint, at the sub-pixel phases
                // its paint draws them at (#140): a page goes up once.
                move |bounds, window, _| {
                    for (draw, _) in prepared.borrow().iter() {
                        if let Draw::Text { label, origin, .. } = draw {
                            let at = bounds.origin + *origin;
                            deep_text_gpui::prepare_at(at, label, window.scale_factor());
                        }
                    }
                },
                move |bounds, _, window, _| {
                    for (draw, clip) in draws.borrow().iter() {
                        match clip {
                            Some(clip) => window
                                .with_content_mask(Some(ContentMask { bounds: *clip }), |w| {
                                    paint(draw, bounds, w)
                                }),
                            None => paint(draw, bounds, window),
                        }
                    }
                },
            )
            .size_full(),
        )
    }
}

/// A headless window and what it paints.
struct Surface {
    handle: AnyWindowHandle,
    draws: Rc<RefCell<Vec<Placed>>>,
    size: [f64; 2],
    zoom: f64,
}

/// One cache entry as a frame reads it.
#[derive(Clone)]
struct Entry {
    key: ContentKey,
    len: usize,
    sha256: String,
}

impl Entry {
    fn of(key: ContentKey, bytes: &[u8]) -> Entry {
        Entry {
            key,
            len: bytes.len(),
            sha256: sha256_hex(bytes),
        }
    }
}

/// A path's fill triangles and its stroke's strip (#140).
struct Tessellation {
    mesh: Arc<Mesh>,
    strip: Option<Arc<Strip>>,
    entry: Entry,
}

/// A stroke's strip at a bucket: its fringe sized for the bucket's smallest zoom.
fn strip_at(lines: &[path::Polyline], width: f64, bucket: i32) -> Strip {
    deep_marks_gpui::strip(lines, width, 2f64.powi(-bucket))
}

struct LayerCache {
    image: Arc<RenderImage>,
    entry: Entry,
}

/// The cache entries one presented frame drew from.
#[derive(Default)]
struct Read {
    tessellation: Vec<(String, i32, Entry)>,
    text: Vec<(String, Entry)>,
    images: Vec<(String, Entry)>,
    layers: Vec<(String, Entry)>,
}

impl Read {
    fn to_json(&self) -> Value {
        let entry = |e: &Entry| (e.key.hex(), e.len, e.sha256.clone());
        json!({
            "tessellation": self.tessellation.iter().map(|(item, bucket, e)| {
                let (key, len, sha256) = entry(e);
                json!({"item": item, "bucket": bucket, "key": key, "len": len, "sha256": sha256})
            }).collect::<Vec<_>>(),
            "text": self.text.iter().map(|(item, e)| {
                let (key, len, sha256) = entry(e);
                json!({"item": item, "key": key, "len": len, "sha256": sha256})
            }).collect::<Vec<_>>(),
            "images": self.images.iter().map(|(item, e)| {
                let (key, len, sha256) = entry(e);
                json!({"item": item, "key": key, "len": len, "sha256": sha256})
            }).collect::<Vec<_>>(),
            "layers": self.layers.iter().map(|(layer, e)| {
                let (key, len, sha256) = entry(e);
                json!({"layer": layer, "key": key, "len": len, "sha256": sha256})
            }).collect::<Vec<_>>(),
        })
    }
}

/// An image's decoding by (sha256, crop bits, opacity bits), and the decoded picture with its size in
/// pixels.
type ImageKey = (String, [u64; 4], u64);
type Decoded = (Arc<RenderImage>, [u32; 2]);

/// A nearest or cubic image's copy resampled on the CPU, by its decoding, its sampling and its
/// drawn size in device pixels (GPUI's sprite sampler is linear and can't change per draw).
type ResampleKey = (ImageKey, ImageSampling, [u32; 2]);

/// The most a document holds decoded, resampled copies included (Image `image@1`: cost).
const DECODED_CAP: u64 = 64 << 20;

/// A document session: its windows, its caches and the frame on screen.
struct Session {
    main: Option<Surface>,
    cache: Option<Surface>,
    tessellations: HashMap<(ContentKey, i32), Tessellation>,
    layers: HashMap<ContentKey, LayerCache>,
    /// Each layer prefix's key on the last presented frame and how many frames in a row it held.
    stable: Vec<(ContentKey, u32)>,
    /// The presented frame's `valid_until`, or `None` once nothing changes again.
    valid_until: Option<i64>,
    /// The pinned time a bound value on the presented frame next changes: it goes stale, or the
    /// age it shows ticks.
    stale_at: Option<i64>,
    /// Each bound value as the presented frame shows it, and the frame's status marks and legend.
    bound: Value,
    snapshot: Value,
    read: Read,
    dirty: Dirty,
    /// Each item's layer on the last presented frame, for one that was deleted since.
    last_layers: BTreeMap<String, String>,
    /// The revision's program and the state its frames evaluate into.
    compiled: Option<(Program, State)>,
    /// The dirty classes the frames since the last report stamped.
    stamped: BTreeSet<(String, Class)>,
    /// The content-addressed store images are read from, and each decoded image with its size
    /// in pixels, by (sha256, crop, opacity).
    store: Option<PathBuf>,
    images: HashMap<ImageKey, Decoded>,
    /// The resampled copies the frame on screen draws, and how many the session has made.
    resampled: HashMap<ResampleKey, Arc<RenderImage>>,
    resamples: u64,
    /// Each text@1 item's shown string and glyph run on the presented frame, as `raster`
    /// reports them (#140: the app and headless shape the same runs).
    texts: Map<String, Value>,
}

fn image_key(asset: &str, crop: Option<[f64; 4]>, opacity: f64) -> ImageKey {
    let crop_bits = crop.map_or([u64::MAX; 4], |c| c.map(f64::to_bits));
    (asset.to_string(), crop_bits, opacity.to_bits())
}

/// Reads, checks and decodes an image once per session: its bytes by hash from the store, the
/// crop in image pixels, and the mark's opacity carried in its alpha, since GPUI's sprite takes
/// straight alpha.
fn image_of(
    session: &mut Session,
    asset: &str,
    crop: Option<[f64; 4]>,
    opacity: f64,
    item: &str,
) -> Result<Decoded, Value> {
    let key = image_key(asset, crop, opacity);
    if let Some(found) = session.images.get(&key) {
        return Ok(found.clone());
    }
    let path = format!("items/{item}/params/asset");
    let rgba = crate::asset::decoded(session.store.as_deref(), asset, crop, item)?;
    let (w, h) = rgba.dimensions();
    let mut bgra = rgba.into_raw();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = (f64::from(px[3]) * opacity).round() as u8;
    }
    let frame = image::RgbaImage::from_raw(w, h, bgra)
        .ok_or_else(|| refused("asset_undecodable", &path))?;
    let found = (
        Arc::new(RenderImage::new([image::Frame::new(frame)])),
        [w, h],
    );
    session.images.insert(key, found.clone());
    Ok(found)
}

/// Where a nearest or cubic image lands, as its copy's key and the rect it is drawn 1:1 in: the
/// fitted rect's corner rounded to a whole device pixel and its size rounded to whole pixels, so
/// moving the image by whole pixels keeps the key.
fn resample_at(
    key: ImageKey,
    sampling: ImageSampling,
    to: [f64; 4],
    zoom: f64,
) -> (ResampleKey, [f64; 4]) {
    let dev = |v: f64| (v * zoom).round();
    let (w, h) = (dev(to[2]).max(1.0), dev(to[3]).max(1.0));
    let (x, y) = (dev(to[0]), dev(to[1]));
    (
        (key, sampling, [w as u32, h as u32]),
        [x / zoom, y / zoom, w / zoom, h / zoom],
    )
}

/// An image's copy resampled to its drawn size, made once and then reused. The copies and the
/// decodings hold at most `DECODED_CAP`: a copy past it is refused, naming the image's asset.
fn resampled(
    session: &mut Session,
    key: &ResampleKey,
    source: &RenderImage,
    size: [u32; 2],
    item: &str,
) -> Result<Arc<RenderImage>, Value> {
    if let Some(found) = session.resampled.get(key) {
        return Ok(found.clone());
    }
    // Named as a missing asset is: the field and the asset's hash.
    let path = format!("items/{item}/params/asset: {}", key.0 .0);
    let bytes = |[w, h]: [u32; 2]| u64::from(w) * u64::from(h) * 4;
    let held: u64 = session.images.values().map(|(_, s)| bytes(*s)).sum::<u64>()
        + session.resampled.keys().map(|k| bytes(k.2)).sum::<u64>();
    let to = key.2;
    if held + bytes(to) > DECODED_CAP {
        return Err(refused("over_budget", &path));
    }
    let narrow = |[w, h]: [u32; 2]| Some([u16::try_from(w).ok()?, u16::try_from(h).ok()?]);
    let (Some(from16), Some(to16), Some(bgra)) = (narrow(size), narrow(to), source.as_bytes(0))
    else {
        return Err(refused("asset_undecodable", &path));
    };
    let mut rgba = bgra.to_vec();
    rgba.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let mut out = deep_marks_vello::resample(rgba, from16, key.1, to16);
    out.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let frame = image::RgbaImage::from_raw(to[0], to[1], out)
        .ok_or_else(|| refused("asset_undecodable", &path))?;
    let copy = Arc::new(RenderImage::new([image::Frame::new(frame)]));
    session.resamples += 1;
    session.resampled.insert(key.clone(), copy.clone());
    Ok(copy)
}

/// Compiles a revision once, so its frames only evaluate.
fn compile(session: &mut Session, doc: &Map<String, Value>) -> Result<(), Value> {
    let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
    let state = program.state();
    session.compiled = Some((program, state));
    Ok(())
}

/// The layer an item is in, by its ID or the ID of the set a generated mark (`<id>#<key>`) is from.
fn layer_of(items: &Map<String, Value>, id: &str) -> Option<String> {
    let base = id.split('#').next().unwrap_or(id);
    Some(items.get(base)?.get("layer")?.as_str()?.to_string())
}

fn rect(b: [f64; 4]) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(b[0] as f32), px(b[1] as f32)),
        size: gpui_kit::size(px(b[2] as f32), px(b[3] as f32)),
    }
}

pub struct Renderer {
    cx: HeadlessAppContext,
    /// Whether Vello GPU draws, by its spike record, and Vello GPU on its own device once a
    /// layer needs it (#385).
    gate: crate::gpu::Gate,
    vello: Option<(Arc<deep_gpu::device::Gpu>, crate::gpu::Vello2d)>,
}

/// What this process has spent so far, as the kernel counts it.
struct Usage {
    /// Package-idle wakeups, every thread's.
    wakeups: u64,
    /// Interrupt wakeups, every thread's.
    interrupts: u64,
    /// User and system CPU, every thread's, in ns.
    cpu_ns: u64,
}

fn usage() -> Usage {
    // SAFETY: an all-zero rusage_info_v4 and rusage are valid for the calls to fill.
    let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is a rusage_info_v4, the flavor asked for; `ru` is a rusage.
    unsafe {
        libc::proc_pid_rusage(
            libc::getpid(),
            libc::RUSAGE_INFO_V4,
            (&raw mut info).cast::<libc::rusage_info_t>(),
        );
        libc::getrusage(libc::RUSAGE_SELF, &mut ru);
    }
    let ns = |t: libc::timeval| t.tv_sec as u64 * 1_000_000_000 + t.tv_usec as u64 * 1_000;
    Usage {
        wakeups: info.ri_pkg_idle_wkups,
        interrupts: info.ri_interrupt_wkups,
        cpu_ns: ns(ru.ru_utime) + ns(ru.ru_stime),
    }
}

/// Waits for every committed frame command buffer to complete, then reads the ledger.
fn settled() -> Ledger {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let ledger = gpu_ledger::read();
        if ledger.completed >= ledger.committed || Instant::now() > deadline {
            return ledger;
        }
        std::thread::sleep(Duration::from_micros(100));
    }
}

/// A path's tessellation at a bucket, from the cache or made once, marked as read this frame.
fn tessellation<'a>(
    session: &'a mut Session,
    geometry: &scene::Geometry,
    d: &str,
    bucket: i32,
    used: &mut BTreeSet<(ContentKey, i32)>,
) -> &'a Tessellation {
    let key = geometry.key(d, bucket);
    used.insert((key, bucket));
    session
        .tessellations
        .entry((key, bucket))
        .or_insert_with(|| {
            // The fill's triangles as marks2d tessellates them; the stroke as a strip (#140).
            let lines = path::flatten(&geometry.verbs, path::tolerance(bucket));
            let mut mesh = Mesh::default();
            if geometry.fill {
                path::fill(&lines, &mut mesh);
            }
            let strip = geometry.stroke.map(|w| strip_at(&lines, w, bucket));
            let mut bytes = mesh.bytes();
            bytes.extend(strip.as_ref().map(Strip::bytes).unwrap_or_default());
            Tessellation {
                mesh: Arc::new(mesh),
                strip: strip.map(Arc::new),
                entry: Entry::of(key, &bytes),
            }
        })
}

fn shaped_bytes(shaped: &deep_text::Shaped) -> Vec<u8> {
    let mut out = Vec::new();
    for g in &shaped.glyphs {
        out.extend(g.id.to_le_bytes());
        out.extend(g.x.to_le_bytes());
        out.extend(g.y.to_le_bytes());
        out.extend(g.size.to_le_bytes());
    }
    out.extend(shaped.width.to_le_bytes());
    out.extend(shaped.height.to_le_bytes());
    out.extend((shaped.lines as u32).to_le_bytes());
    out.extend(shaped.shown.as_bytes());
    out
}

fn color_space(gpui_oklab: bool) -> ColorSpace {
    if gpui_oklab {
        ColorSpace::Oklab
    } else {
        ColorSpace::OklabExact
    }
}

/// #140: `marks` alone over transparent black at `size` px, drawn by GPUI's frame path (the draws
/// `present` makes, with no layer cache) in a window of `cx` at scale 1, read back from GPUI's
/// offscreen Metal renderer; straight alpha. That renderer's frames are opaque, so the marks draw
/// twice, over a black ground and over a white one: where they leave `1 - a` of the ground showing,
/// the two differ by `(1 - a) · 255`, and the color over black is the marks' premultiplied color.
pub(crate) fn picture(
    cx: &mut HeadlessAppContext,
    marks: &[&Drawn],
    size: [u32; 2],
    planted: crate::layer::Planted,
) -> Result<image::RgbaImage, Value> {
    gpui_draws(marks.iter().copied())?;
    let mut session = Renderer::new_session();
    let mut list = Renderer::draws(
        &mut session,
        marks,
        path::bucket(1.0),
        1.0,
        false,
        &mut BTreeSet::new(),
    )?;
    if planted.shifts_glyphs {
        // #385 AC1's wrong program: every glyph quad half a device px to the right.
        for (draw, _) in &mut list {
            if let Draw::Text { origin, .. } = draw {
                origin.x += px(0.5);
            }
        }
    }
    if planted.paths_apart {
        // #385 AC8's wrong program: each path drawn alone, its own antialiased coverage laid
        // over what's under it, so a shared edge shows the ground between two paths.
        for placed in &mut list {
            if let Draw::Path { .. } = placed.0 {
                let mut alone = picture_of(cx, std::slice::from_ref(placed), size)?;
                for p in alone.pixels_mut() {
                    p.0.swap(0, 2);
                }
                placed.0 = Draw::Picture {
                    image: Arc::new(RenderImage::new([image::Frame::new(alone)])),
                    bounds: None,
                    image_bounds: None,
                };
            }
        }
    }
    picture_of(cx, &list, size)
}

/// The document's status marks and their legend alone over transparent black, as GPUI draws them
/// after every writer layer (#385's window).
pub(crate) fn status_picture(
    cx: &mut HeadlessAppContext,
    status: &[StatusMark],
    frame: &scene::Frame,
    palette: &scene::Palette,
) -> Result<image::RgbaImage, Value> {
    let mut list = Vec::new();
    status_draws(
        status,
        &status::occupied(frame),
        palette,
        frame.size,
        1.0,
        &mut list,
    );
    let size = [frame.size[0].round() as u32, frame.size[1].round() as u32];
    picture_of(cx, &list, size)
}

/// `list` over transparent black at `size` px, from GPUI's frames of it over black and over white.
fn picture_of(
    cx: &mut HeadlessAppContext,
    list: &[Placed],
    size: [u32; 2],
) -> Result<image::RgbaImage, Value> {
    let whole = rect([0.0, 0.0, f64::from(size[0]), f64::from(size[1])]);
    let over = |ground: u8| {
        let mut over = vec![(Draw::Quad(fill_quad(whole, hsla([ground; 3]))), None)];
        over.extend(list.iter().cloned());
        over
    };
    let (over_black, over_white) = (over(0), over(255));
    let draws = Rc::new(RefCell::new(over_black));
    let canvas = Canvas {
        draws: draws.clone(),
    };
    let (handle, _) = cx
        .update(|cx| {
            open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: gpui_kit::size(px(size[0] as f32), px(size[1] as f32)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| canvas),
            )
        })
        .map_err(|_| refused("no_window", ""))?;
    cx.simulate_scale_factor_change(handle, 1.0);
    // A forced frame request draws the window again, as the display link's does.
    let capture = |cx: &mut HeadlessAppContext| {
        cx.present_frame(handle);
        cx.capture_screenshot(handle).ok()
    };
    let black = capture(cx);
    *draws.borrow_mut() = over_white;
    let white = capture(cx);
    let _ = cx.update_window(handle, |_, w, _| w.remove_window());
    let (Some(black), Some(white)) = (black, white) else {
        return Err(refused("no_capture", ""));
    };
    if black.dimensions() != (size[0], size[1]) || white.dimensions() != black.dimensions() {
        return Err(refused("no_capture", "size"));
    }
    let mut out = image::RgbaImage::new(size[0], size[1]);
    for ((o, b), w) in out.pixels_mut().zip(black.pixels()).zip(white.pixels()) {
        let shown = (0..3)
            .map(|c| f64::from(w[c]) - f64::from(b[c]))
            .sum::<f64>()
            / (3.0 * 255.0);
        let a = (1.0 - shown).clamp(0.0, 1.0);
        let a8 = (a * 255.0).round() as u8;
        if a8 == 0 {
            continue;
        }
        let un = |c: u8| (f64::from(c) / a).round().min(255.0) as u8;
        *o = image::Rgba([un(b[0]), un(b[1]), un(b[2]), a8]);
    }
    Ok(out)
}

impl Renderer {
    pub fn new() -> Self {
        Renderer {
            cx: deep_replica::headless_context(),
            gate: crate::gpu::Gate::shipped(),
            vello: None,
        }
    }

    pub fn answer(&mut self, request: Request) -> Value {
        match request {
            Request::Frames {
                doc,
                look,
                view,
                record,
                hz,
                vsyncs,
                store,
                start,
                replay,
                captures,
                arms_only_on_readings,
            } => self.frames(
                &doc,
                &look,
                view,
                record,
                Clock {
                    hz,
                    vsyncs,
                    start,
                    replay,
                    arms_only_on_readings,
                },
                &captures,
                store,
            ),
            Request::Session { look, steps, store } => self.session(&look, steps, store),
            Request::Idle {
                doc,
                look,
                view,
                record,
                seconds,
                arms_each_vsync,
            } => self.idle(&doc, &look, view, record, seconds, arms_each_vsync),
            Request::Render {
                out,
                doc,
                look,
                view,
                t,
                record,
                gpui_oklab,
                store,
            } => self.render(&out, &doc, &look, view, t, record, gpui_oklab, store),
        }
    }

    fn open(&mut self, size: [f64; 2], zoom: f64) -> Option<Surface> {
        let draws = Rc::new(RefCell::new(Vec::new()));
        let canvas = Canvas {
            draws: draws.clone(),
        };
        let (handle, _) = self
            .cx
            .update(|cx| {
                open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: gpui_kit::size(px(size[0] as f32), px(size[1] as f32)),
                        })),
                        focus: false,
                        show: false,
                        ..Default::default()
                    },
                    cx,
                    |_, cx| cx.new(|_| canvas),
                )
            })
            .ok()?;
        self.cx.simulate_scale_factor_change(handle, zoom as f32);
        Some(Surface {
            handle,
            draws,
            size,
            zoom,
        })
    }

    /// The session's windows at the document's size and the view's zoom, opened or reopened.
    fn surfaces(&mut self, session: &mut Session, size: [f64; 2], zoom: f64) -> bool {
        for slot in [&mut session.main, &mut session.cache] {
            match slot {
                Some(s) if s.size == size => {
                    if s.zoom != zoom {
                        self.cx.simulate_scale_factor_change(s.handle, zoom as f32);
                        s.zoom = zoom;
                    }
                }
                _ => {
                    if let Some(old) = slot.take() {
                        let _ = self
                            .cx
                            .update_window(old.handle, |_, w, _| w.remove_window());
                    }
                    match self.open(size, zoom) {
                        Some(s) => *slot = Some(s),
                        None => return false,
                    }
                }
            }
        }
        true
    }

    fn close(&mut self, session: Session) {
        for s in [session.main, session.cache].into_iter().flatten() {
            let _ = self.cx.update_window(s.handle, |_, w, _| w.remove_window());
        }
    }

    /// Each writer layer's draws in order: its Vello GPU picture where it has one, else its marks.
    #[allow(clippy::too_many_arguments)]
    fn layer_draws(
        session: &mut Session,
        layers: &[scene::Layer],
        pictures: &[Option<Arc<RenderImage>>],
        bucket: i32,
        zoom: f64,
        gpui_oklab: bool,
        used: &mut BTreeSet<(ContentKey, i32)>,
    ) -> Result<Vec<Placed>, Value> {
        let mut out = Vec::new();
        for (layer, picture) in layers.iter().zip(pictures) {
            match picture {
                Some(image) => out.push((
                    Draw::Picture {
                        image: image.clone(),
                        bounds: None,
                        image_bounds: None,
                    },
                    None,
                )),
                None => {
                    let marks: Vec<&Drawn> = layer.marks.iter().map(|m| &**m).collect();
                    out.extend(Self::draws(
                        session, &marks, bucket, zoom, gpui_oklab, used,
                    )?);
                }
            }
        }
        Ok(out)
    }

    /// A writer layer's marks drawn by Vello GPU at `zoom` over transparent black, as the BGRA
    /// picture GPUI paints, on a device opened the first time a layer needs it.
    fn vello_picture(
        &mut self,
        marks: &[&Drawn],
        size: [f64; 2],
        zoom: f64,
    ) -> Result<Arc<RenderImage>, Value> {
        if self.vello.is_none() {
            let gpu = deep_gpu::device::Gpu::open(deep_gpu::device::Backend::Gpu)
                .map_err(|e| refused("no_device", &e))?;
            let vello =
                crate::gpu::Vello2d::new(&gpu.device().device, wgpu::TextureFormat::Rgba8Unorm);
            self.vello = Some((gpu, vello));
        }
        let (gpu, vello) = self.vello.as_mut().expect("opened above");
        let device = gpu.device();
        let px = [
            (size[0] * zoom).round() as u32,
            (size[1] * zoom).round() as u32,
        ];
        let options = crate::gpu::Options {
            zoom,
            ..Default::default()
        };
        let mut picture = vello.picture(&device.device, &device.queue, marks, px, options)?;
        for p in picture.pixels_mut() {
            p.0.swap(0, 2);
        }
        Ok(Arc::new(RenderImage::new([image::Frame::new(picture)])))
    }

    /// The draws for marks, with each path's tessellation from the cache.
    fn draws(
        session: &mut Session,
        marks: &[&Drawn],
        bucket: i32,
        zoom: f64,
        gpui_oklab: bool,
        used: &mut BTreeSet<(ContentKey, i32)>,
    ) -> Result<Vec<Placed>, Value> {
        let mut out: Vec<Placed> = Vec::with_capacity(marks.len());
        // The coverage target the last path drew in, and its draw.
        let mut cover_at: Option<(String, usize)> = None;
        for drawn in marks {
            let clip = drawn.clip.map(rect);
            let mut push = |d: Draw| out.push((d, clip));
            match &drawn.mark {
                Mark::Rect {
                    item,
                    bounds,
                    radius,
                    fill,
                } => {
                    let background: Background = match fill {
                        Fill::Solid(c) => hsla(*c).into(),
                        Fill::Linear { from, to, at } => linear_gradient(
                            90.,
                            linear_color_stop(hsla(*from), at[0] as f32),
                            linear_color_stop(hsla(*to), at[1] as f32),
                        )
                        .color_space(color_space(gpui_oklab)),
                        Fill::Ramp(_) => return Err(gpui_lacks(item)),
                    };
                    let b = Bounds {
                        origin: point(px(bounds[0] as f32), px(bounds[1] as f32)),
                        size: gpui_kit::size(px(bounds[2] as f32), px(bounds[3] as f32)),
                    };
                    push(Draw::Quad(
                        fill_quad(b, background).corner_radii(px(*radius as f32)),
                    ));
                }
                Mark::Circle {
                    center,
                    r,
                    inner_r,
                    color,
                    ..
                } => {
                    let b = Bounds {
                        origin: point(px((center[0] - r) as f32), px((center[1] - r) as f32)),
                        size: gpui_kit::size(px((2.0 * r) as f32), px((2.0 * r) as f32)),
                    };
                    let q = if *inner_r > 0.0 {
                        quad(
                            b,
                            px(*r as f32),
                            transparent_black(),
                            px((r - inner_r) as f32),
                            hsla(*color),
                            BorderStyle::Solid,
                        )
                    } else {
                        fill_quad(b, hsla(*color)).corner_radii(px(*r as f32))
                    };
                    push(Draw::Quad(q));
                }
                Mark::Path {
                    d,
                    geometry,
                    offset,
                    color,
                    ..
                } => {
                    let t = tessellation(session, geometry, d, bucket, used);
                    let (offset, color) = ([offset[0] as f32, offset[1] as f32], hsla(*color));
                    let cover = drawn.scopes.iter().find_map(|s| match s {
                        scene::Scope::Cover { item, .. } => Some(item.clone()),
                        _ => None,
                    });
                    // The fills of one coverage target draw as one path (#385), so GPUI's
                    // antialiasing sees their union and no seam shows along a shared edge.
                    let last = out.len().checked_sub(1);
                    let joins = cover.is_some()
                        && cover_at.as_ref().map(|(c, k)| (c, Some(*k)))
                            == cover.as_ref().map(|c| (c, last));
                    let joined = match out.last_mut() {
                        Some((
                            Draw::Path {
                                mesh,
                                offset: o,
                                color: was,
                            },
                            _,
                        )) if joins && *was == color && !t.mesh.indices.is_empty() => {
                            let mut both = baked(mesh, *o);
                            both.append(baked(&t.mesh, offset));
                            *mesh = Arc::new(both);
                            *o = [0.0, 0.0];
                            true
                        }
                        _ => false,
                    };
                    if !joined && !t.mesh.indices.is_empty() {
                        out.push((
                            Draw::Path {
                                mesh: t.mesh.clone(),
                                offset,
                                color,
                            },
                            clip,
                        ));
                    }
                    cover_at = cover.zip(out.len().checked_sub(1));
                    if let Some(strip) = &t.strip {
                        out.push((
                            Draw::Strip {
                                strip: strip.clone(),
                                offset,
                                color,
                            },
                            clip,
                        ));
                    }
                }
                Mark::Text {
                    item,
                    spec,
                    origin,
                    role,
                    color,
                    runs,
                } => {
                    let Some(label) = label_of(spec) else {
                        return Err(refused("bad_font", &format!("items/{item}/params/font")));
                    };
                    // A text@1 item's own text; a mark set's or an axis's labels are `<id>#…`.
                    if !item.contains('#') {
                        let glyphs: Vec<Value> = deep_text_gpui::shape(&label)
                            .glyphs
                            .iter()
                            .map(|g| {
                                let (role, _) =
                                    scene::run_paint(runs, g.grapheme, role.as_deref(), *color);
                                crate::raster::glyph_row(g, role)
                            })
                            .collect();
                        session
                            .texts
                            .insert(item.clone(), json!({"shown": spec.text, "glyphs": glyphs}));
                    }
                    push(Draw::Text {
                        label,
                        origin: point(px(origin[0] as f32), px(origin[1] as f32)),
                        color: hsla(*color),
                        runs: runs.iter().map(|r| (r.from..r.to, hsla(r.color))).collect(),
                    });
                }
                Mark::Shape {
                    item,
                    verbs,
                    fill,
                    stroke,
                } => {
                    // #140: a path's solid fill and solid stroke as GPUI paths, the fill
                    // tessellated as #380's lines are and the stroke as a strip; anything else
                    // waits for Vello GPU (#385).
                    let lines = path::flatten(verbs, path::tolerance(bucket));
                    let solid = |paint: &Fill, opacity: f64| match paint {
                        Fill::Solid(c) => Ok(hsla(*c).opacity(opacity as f32)),
                        _ => Err(gpui_lacks(item)),
                    };
                    if let Some((f, opacity)) = fill {
                        let color = solid(f, *opacity)?;
                        let mut mesh = Mesh::default();
                        path::fill(&lines, &mut mesh);
                        push(Draw::Path {
                            mesh: Arc::new(mesh),
                            offset: [0., 0.],
                            color,
                        });
                    }
                    if let Some(line) = stroke.as_ref().filter(|l| l.dashes.is_none()) {
                        push(Draw::Strip {
                            strip: Arc::new(strip_at(&lines, line.width, bucket)),
                            offset: [0., 0.],
                            color: solid(&line.paint, line.opacity)?,
                        });
                    } else if stroke.is_some() {
                        return Err(gpui_lacks(item));
                    }
                }
                Mark::Image {
                    item,
                    asset,
                    bounds,
                    fit,
                    sampling,
                    crop,
                    opacity,
                    ..
                } => {
                    let (image, size) = image_of(session, asset, *crop, *opacity, item)?;
                    let to = fit.fitted(*bounds, size);
                    let (image, image_bounds) = if *sampling == ImageSampling::Linear {
                        (image, to)
                    } else {
                        // The sprite sampler is linear, so the copy is drawn 1:1 on whole pixels.
                        let (key, at) =
                            resample_at(image_key(asset, *crop, *opacity), *sampling, to, zoom);
                        (resampled(session, &key, &image, size, item)?, at)
                    };
                    push(Draw::Picture {
                        image,
                        bounds: Some(rect(*bounds)),
                        image_bounds: Some(rect(image_bounds)),
                    });
                }
            }
        }
        Ok(out)
    }

    /// Draws `draws` into the cache window and reads its pixels back.
    fn picture(
        &mut self,
        surface_handle: AnyWindowHandle,
        draws: &Rc<RefCell<Vec<Placed>>>,
        list: Vec<Placed>,
    ) -> Option<image::RgbaImage> {
        *draws.borrow_mut() = list;
        self.cx
            .update_window(surface_handle, |_, window, cx| window.render_frame(cx))
            .ok()?;
        self.cx.capture_screenshot(surface_handle).ok()
    }

    /// Evaluates the document at `t`, builds the frame with its caches, and presents it through
    /// GPUI's frame path. Returns the frame's `valid_until` through the session.
    #[allow(clippy::too_many_arguments)]
    fn present(
        &mut self,
        session: &mut Session,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        record: &Record,
        t: i64,
        gpui_oklab: bool,
        by_clock: bool,
    ) -> Result<(), Value> {
        // The revision's program evaluates into its state with no allocation; only the items the
        // draw list reads are written out.
        let (items, valid_until) = {
            let (program, state) = session
                .compiled
                .as_mut()
                .ok_or_else(|| refused("bad_doc", ""))?;
            program.evaluate(t, eval::Validity::Full, state);
            (eval::items(doc, program, state), state.valid_until)
        };
        let palette = palette_of(look, view.theme);
        let frame = scene::frame(doc, &items, palette, record, view.zoom)
            .map_err(|r| refused(r.code, &r.path))?;
        // A writer layer GPUI's paths can't draw exactly draws on Vello GPU once its spike passed,
        // as a picture GPUI composites in the layer's place (#385); one Vello GPU can't draw yet is
        // the live view's refusal, naming the item.
        let mut pictures: Vec<Option<Arc<RenderImage>>> = Vec::with_capacity(frame.layers.len());
        for layer in &frame.layers {
            let marks: Vec<&Drawn> = layer.marks.iter().map(|m| &**m).collect();
            let Some(item) = crate::layer::gpui_lacks(marks.iter().copied()) else {
                pictures.push(None);
                continue;
            };
            if !self.gate.enabled {
                return Err(gpui_lacks(&item));
            }
            if let Some(r) = crate::gpu::refusal(marks.iter().copied()) {
                return Err(r);
            }
            pictures.push(Some(self.vello_picture(&marks, frame.size, view.zoom)?));
        }
        let shown =
            scene::bound_texts(doc, &items, record).map_err(|r| refused(r.code, &r.path))?;
        let status = scene::status_marks(doc, &items, record, look.status.as_ref(), palette)
            .map_err(|r| refused(r.code, &r.path))?;
        let texts: BTreeMap<String, String> = shown
            .iter()
            .map(|(id, s)| (id.clone(), s.text.clone()))
            .collect();
        // A number is never cut short or wrapped: a bound text that doesn't fit its box on one
        // line fails rather than draws (Honest numbers).
        for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
            if let Mark::Text { item, spec, .. } = &drawn.mark {
                if spec.bound && spec.width.is_some() {
                    let label = label_of(spec)
                        .ok_or_else(|| refused("bad_font", &format!("items/{item}/params/font")))?;
                    let one_line = Label {
                        max_lines: Some(1),
                        ..label
                    };
                    if !deep_text_gpui::fit(&one_line, None).fits {
                        return Err(refused("number_unfit", &format!("items/{item}/params/box")));
                    }
                }
            }
        }
        let changes = session.dirty.advance(&items, &texts, by_clock);
        // The layers an item changed in, this frame: a mark's item is its own ID before any `#`.
        let changed_layers: BTreeSet<String> = changes
            .iter()
            .filter_map(|(id, _)| {
                layer_of(&items, id).or_else(|| session.last_layers.get(id).cloned())
            })
            .collect();
        session.last_layers = items
            .iter()
            .filter_map(|(id, item)| Some((id.clone(), item.get("layer")?.as_str()?.to_string())))
            .collect();
        session.stamped.extend(changes);
        if !self.surfaces(session, frame.size, view.zoom) {
            return Err(refused("no_window", ""));
        }
        let bucket = path::bucket(view.zoom);
        // A resampled copy lives while the frame on screen draws it, so a zoom or a resize frees
        // the copies of the size it left before the cap counts them.
        let mut copies = Vec::new();
        for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
            if let Mark::Image {
                item,
                asset,
                bounds,
                fit,
                sampling,
                crop,
                opacity,
                ..
            } = &drawn.mark
            {
                if *sampling != ImageSampling::Linear {
                    let (_, size) = image_of(session, asset, *crop, *opacity, item)?;
                    let to = fit.fitted(*bounds, size);
                    let key = image_key(asset, *crop, *opacity);
                    copies.push(resample_at(key, *sampling, to, view.zoom).0);
                }
            }
        }
        session.resampled.retain(|k, _| copies.contains(k));

        // Each prefix of the writer layers, ground first, keyed by everything it composites.
        let mut prefixes = Vec::with_capacity(frame.layers.len());
        let mut k = KeyBuilder::new("layers@marks2d.1");
        k.bytes(&frame.ground)
            .number(frame.size[0])
            .number(frame.size[1])
            .number(view.zoom);
        for layer in &frame.layers {
            k.key(&layer.key);
            prefixes.push(k.finish());
        }
        // A prefix stays the same while its key holds and none of its layers' items is dirty.
        let mut dirty_below = false;
        let stable: Vec<(ContentKey, u32)> = prefixes
            .iter()
            .enumerate()
            .map(|(i, key)| {
                dirty_below |= changed_layers.contains(&frame.layers[i].id);
                match session.stable.get(i) {
                    Some((prev, n)) if prev == key && !dirty_below => (*key, n + 1),
                    _ => (*key, 0),
                }
            })
            .collect();

        let mut used = BTreeSet::new();
        let ground = fill_quad(
            Bounds {
                origin: Point::default(),
                size: gpui_kit::size(px(frame.size[0] as f32), px(frame.size[1] as f32)),
            },
            hsla(frame.ground),
        );
        // The highest prefix that stayed the same long enough is drawn from its picture.
        let cached = stable.iter().rposition(|(_, n)| *n >= STABLE_FRAMES);
        if let Some(top) = cached {
            let key = prefixes[top];
            if !session.layers.contains_key(&key) {
                let mut list: Vec<Placed> = vec![(Draw::Quad(ground.clone()), None)];
                list.extend(Self::layer_draws(
                    session,
                    &frame.layers[..=top],
                    &pictures[..=top],
                    bucket,
                    view.zoom,
                    gpui_oklab,
                    &mut used,
                )?);
                let (handle, draws) = {
                    let cache = session
                        .cache
                        .as_ref()
                        .ok_or_else(|| refused("no_window", ""))?;
                    (cache.handle, cache.draws.clone())
                };
                let pixels = self
                    .picture(handle, &draws, list)
                    .ok_or_else(|| refused("no_capture", ""))?;
                let entry = Entry::of(key, pixels.as_raw());
                let (w, h) = pixels.dimensions();
                let mut bgra = pixels.into_raw();
                for px in bgra.as_chunks_mut::<4>().0 {
                    px.swap(0, 2);
                }
                let image = image::RgbaImage::from_raw(w, h, bgra)
                    .ok_or_else(|| refused("no_capture", ""))?;
                session.layers.insert(
                    key,
                    LayerCache {
                        image: Arc::new(RenderImage::new([image::Frame::new(image)])),
                        entry,
                    },
                );
            }
        }
        let mut list: Vec<Placed> = Vec::new();
        let mut read = Read::default();
        let first_live = match cached {
            Some(top) => {
                let cache = &session.layers[&prefixes[top]];
                list.push((
                    Draw::Picture {
                        image: cache.image.clone(),
                        bounds: None,
                        image_bounds: None,
                    },
                    None,
                ));
                read.layers
                    .push((frame.layers[top].id.clone(), cache.entry.clone()));
                top + 1
            }
            None => {
                list.push((Draw::Quad(ground), None));
                0
            }
        };
        list.extend(Self::layer_draws(
            session,
            &frame.layers[first_live..],
            &pictures[first_live..],
            bucket,
            view.zoom,
            gpui_oklab,
            &mut used,
        )?);
        // Status colors last, over every writer layer, with their legend.
        let snapshot = status_draws(
            &status,
            &occupied(&frame),
            palette,
            frame.size,
            view.zoom,
            &mut list,
        );

        // What the frame reads: every visible path's tessellation and text's shaped run, those a
        // cached picture was drawn from included, since they are its read set.
        for layer in &frame.layers {
            for drawn in &layer.marks {
                match &drawn.mark {
                    Mark::Path {
                        item, d, geometry, ..
                    } => {
                        let entry = tessellation(session, geometry, d, bucket, &mut used)
                            .entry
                            .clone();
                        read.tessellation.push((item.clone(), bucket, entry));
                    }
                    Mark::Text { item, spec, .. } => {
                        let Some(label) = label_of(spec) else {
                            return Err(refused("bad_font", &format!("items/{item}/params/font")));
                        };
                        let shaped = deep_text_gpui::shape(&label);
                        read.text
                            .push((item.clone(), Entry::of(spec.key(), &shaped_bytes(&shaped))));
                    }
                    Mark::Image {
                        item,
                        asset,
                        crop,
                        opacity,
                        ..
                    } => {
                        let (image, _) = image_of(session, asset, *crop, *opacity, item)?;
                        let pixels = image.as_bytes(0).unwrap_or_default();
                        read.images
                            .push((item.clone(), Entry::of(drawn.mark.key(bucket), pixels)));
                    }
                    _ => {}
                }
            }
        }
        // A cached result lives while the frame on screen reads it.
        session.tessellations.retain(|k, _| used.contains(k));
        if let Some(top) = cached {
            let keep = prefixes[top];
            session.layers.retain(|k, _| *k == keep);
        } else {
            session.layers.clear();
        }
        session.stable = stable;
        session.valid_until = valid_until;
        session.stale_at = shown.values().filter_map(|s| s.changes_at).min();
        session.bound = Value::Object(
            shown
                .values()
                .map(|s| {
                    (
                        s.bound.clone(),
                        json!({"text": s.text, "stale": s.stale, "age": s.age}),
                    )
                })
                .collect(),
        );
        session.snapshot = snapshot;
        session.read = read;

        let main = session
            .main
            .as_ref()
            .ok_or_else(|| refused("no_window", ""))?;
        let (handle, draws) = (main.handle, main.draws.clone());
        *draws.borrow_mut() = list;
        self.cx.present_frame(handle);
        Ok(())
    }

    fn new_session() -> Session {
        Session {
            main: None,
            cache: None,
            tessellations: HashMap::new(),
            layers: HashMap::new(),
            stable: Vec::new(),
            valid_until: None,
            stale_at: None,
            bound: json!({}),
            snapshot: json!({"marks": [], "legend": []}),
            read: Read::default(),
            dirty: Dirty::default(),
            stamped: BTreeSet::new(),
            store: None,
            images: HashMap::new(),
            resampled: HashMap::new(),
            resamples: 0,
            compiled: None,
            last_layers: BTreeMap::new(),
            texts: Map::new(),
        }
    }

    /// The document opened, then held on screen for `seconds` of the real clock: the frame clock
    /// sleeps until the presented frame's `valid_until` or the time a bound value on screen goes
    /// stale, and wakes for nothing else. What the process spent meanwhile is read from the
    /// kernel: its wakeups and its CPU, every thread's. A wakeup is a package-idle wakeup, the CPU
    /// woken from idle for this process (Activity Monitor's Idle Wake Ups). Interrupt wakeups are
    /// reported beside them as a reading: a process that has drawn with Metal takes about 22 a
    /// minute from the driver, whatever it does after, so no frame clock can hold those to 1.
    fn idle(
        &mut self,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        mut record: Record,
        seconds: u64,
        arms_each_vsync: bool,
    ) -> Value {
        let mut session = Self::new_session();
        let result = (|| -> Result<Value, Value> {
            compile(&mut session, doc)?;
            let pinned_at_0 = record.pinned;
            self.present(&mut session, doc, look, view, &record, 0, false, false)?;
            settled();
            let before = usage();
            let start = Instant::now();
            let end = start + Duration::from_secs(seconds);
            let vsync = Duration::from_nanos(1_000_000_000 / 60);
            let at = |flicks: i64| start + Duration::from_nanos((flicks.max(0) as u64) * 10 / 7056);
            let mut drawn = Vec::new();
            let mut frame = 1u64;
            loop {
                let now = Instant::now();
                let next = if arms_each_vsync {
                    Some(now + vsync)
                } else {
                    [session.valid_until, session.stale_at]
                        .into_iter()
                        .flatten()
                        .min()
                        .map(at)
                };
                let wake = next.map_or(end, |n| n.min(end));
                if let Some(wait) = wake.checked_duration_since(now) {
                    std::thread::sleep(wait);
                }
                let elapsed = start.elapsed();
                if Instant::now() >= end {
                    break;
                }
                let t = (elapsed.as_nanos() * 7056 / 10) as i64;
                record.pinned = pinned_at_0 + t;
                self.present(&mut session, doc, look, view, &record, t, false, true)?;
                frame += 1;
                drawn.push(json!({"frame": frame, "at_ms": elapsed.as_secs_f64() * 1000.0}));
            }
            let seconds = start.elapsed().as_secs_f64();
            let after = usage();
            let cpu_ms = (after.cpu_ns - before.cpu_ns) as f64 / 1e6;
            Ok(json!({
                "ok": true, "opened_frames": 1, "seconds": seconds, "frames": drawn.len(),
                "drawn": drawn, "wakeups": after.wakeups - before.wakeups,
                "interrupt_wakeups": after.interrupts - before.interrupts, "cpu_ms": cpu_ms,
                "cpu_fraction": cpu_ms / (seconds * 1000.0),
            }))
        })();
        self.close(session);
        result.unwrap_or_else(|refusal| refusal)
    }

    #[allow(clippy::too_many_arguments)]
    fn frames(
        &mut self,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        mut record: Record,
        clock: Clock,
        captures: &[(u32, String)],
        store: Option<PathBuf>,
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let period = 705_600_000 / clock.hz;
        // Each frame is pinned to the host time live, or to the mapped record time in a replay.
        let pinned_at_0 = clock.replay.unwrap_or(clock.start);
        let mut out = Vec::with_capacity(clock.vsyncs as usize);
        // The windows open before vsync 0, so their setup isn't counted.
        let result = (|| -> Result<(), Value> {
            compile(&mut session, doc)?;
            for k in 0..i64::from(clock.vsyncs) {
                let t = k * period;
                record.pinned = pinned_at_0 + t;
                // The planted clock arms only on readings, which never change here: it misses the
                // time a bound value goes stale.
                let stale = !clock.arms_only_on_readings
                    && session.stale_at.is_some_and(|s| s <= record.pinned);
                let armed = k == 0 || session.valid_until.is_some_and(|v| v <= t) || stale;
                // Everything the vsync cost on the GPU, a layer picture it made included.
                let before = settled();
                if armed {
                    self.present(&mut session, doc, look, view, &record, t, false, k > 0)?;
                }
                let after = settled();
                out.push(json!({
                    "t": t,
                    "presented": armed,
                    "command_buffers": after.committed - before.committed,
                    "gpu_ns": after.gpu_ns - before.gpu_ns,
                    "bound": session.bound,
                }));
                for (_, path) in captures.iter().filter(|(v, _)| i64::from(*v) == k) {
                    self.capture(&session, path)?;
                }
            }
            Ok(())
        })();
        self.close(session);
        match result {
            Ok(()) => json!({"ok": true, "vsyncs": out}),
            Err(refusal) => refusal,
        }
    }

    /// Writes the frame on screen as a PNG.
    fn capture(&mut self, session: &Session, out: &str) -> Result<(), Value> {
        let main = session
            .main
            .as_ref()
            .ok_or_else(|| refused("no_window", ""))?;
        let image = self
            .cx
            .capture_screenshot(main.handle)
            .map_err(|_| refused("no_capture", ""))?;
        image.save(out).map_err(|_| refused("not_written", out))
    }

    fn session(&mut self, look: &Look, steps: Vec<Step>, store: Option<PathBuf>) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let mut doc = Map::new();
        let mut view = View {
            zoom: 1.0,
            theme: Theme::Light,
        };
        let mut record = Record::default();
        let mut out = Vec::with_capacity(steps.len());
        let result = (|| -> Result<(), Value> {
            for step in steps {
                let resampled_before = session.resamples;
                if let Some(d) = step.doc {
                    doc = d;
                    compile(&mut session, &doc)?;
                }
                if let Some(v) = step.view {
                    view = v;
                }
                if let Some(r) = step.record {
                    record = r;
                }
                for f in 0..i64::from(step.frames) {
                    let t = step.t + f * STEP_VSYNC;
                    // A new revision, view or reading arms the step's first frame; after it the
                    // frame clock does.
                    record.pinned = t;
                    let armed = f == 0
                        || session.valid_until.is_some_and(|v| v <= t)
                        || session.stale_at.is_some_and(|s| s <= t);
                    if armed {
                        self.present(&mut session, &doc, look, view, &record, t, false, f > 0)?;
                    }
                }
                let dirty: Vec<Value> = std::mem::take(&mut session.stamped)
                    .into_iter()
                    .map(|(item, class)| json!({"item": item, "class": class.name()}))
                    .collect();
                out.push(json!({
                    "caches": session.read.to_json(),
                    "dirty": dirty,
                    "resamples": session.resamples - resampled_before,
                }));
            }
            Ok(())
        })();
        self.close(session);
        match result {
            Ok(()) => json!({"ok": true, "steps": out, "backends": crate::backends(false)}),
            Err(refusal) => refusal,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn render(
        &mut self,
        out: &str,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        t: i64,
        mut record: Record,
        gpui_oklab: bool,
        store: Option<PathBuf>,
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        record.pinned = t;
        let result = compile(&mut session, doc).and_then(|()| {
            self.present(&mut session, doc, look, view, &record, t, gpui_oklab, false)
        });
        let answer = match result {
            Err(refusal) => refusal,
            Ok(_) => {
                let main = session.main.as_ref().map(|m| m.handle);
                match main.map(|h| self.cx.capture_screenshot(h)) {
                    Some(Ok(image)) => match image.save(out) {
                        Ok(()) => json!({
                            "ok": true, "width": image.width(), "height": image.height(),
                            "marks": session.snapshot["marks"], "legend": session.snapshot["legend"],
                            "texts": session.texts, "backends": crate::backends(false),
                        }),
                        Err(_) => refused("not_written", out),
                    },
                    _ => refused("no_capture", ""),
                }
            }
        };
        self.close(session);
        answer
    }
}

/// A filled quad: GPUI's `fill`, named apart from the paint's fill.
fn fill_quad(bounds: Bounds<Pixels>, background: impl Into<Background>) -> PaintQuad {
    gpui_kit::fill(bounds, background)
}

/// How a `frames` run's clock runs: its rate, its length, the host time of vsync 0, the record
/// time vsync 0 maps to in a replay, and #392 AC3's planted clock.
pub struct Clock {
    hz: i64,
    vsyncs: u32,
    start: i64,
    replay: Option<i64>,
    arms_only_on_readings: bool,
}

/// The status marks, their labels and the legend as GPUI draws, appended to `list` over
/// everything drawn, and their text snapshot (see [`status::layout`]).
fn status_draws(
    status: &[StatusMark],
    occupied: &[[f64; 4]],
    palette: &scene::Palette,
    size: [f64; 2],
    zoom: f64,
    list: &mut Vec<Placed>,
) -> Value {
    let (prims, snapshot) = status::layout(status, occupied, palette, size, zoom);
    for prim in prims {
        list.push((
            match prim {
                Prim::Fill {
                    rect: b,
                    radius,
                    color,
                } => Draw::Quad(fill_quad(rect(b), hsla(color)).corner_radii(px(radius as f32))),
                Prim::Ring {
                    rect: b,
                    radius,
                    width,
                    color,
                } => Draw::Quad(ring_quad(b, radius, width, color)),
                Prim::Text {
                    label,
                    origin,
                    color,
                } => Draw::Text {
                    label,
                    origin: point(px(origin[0] as f32), px(origin[1] as f32)),
                    color: hsla(color),
                    runs: Vec::new(),
                },
            },
            None,
        ));
    }
    snapshot
}

/// R2's marks GPUI's paths can't draw: gradients past R1's two stops, gradient fills and strokes
/// of paths, dashed strokes, masks, group opacity and blends, and adjusted images, which Vello GPU
/// draws once its spike passed (#385). Where it can't, the live view refuses them, naming the item
/// (technical design: Platform seams).
fn gpui_lacks(item: &str) -> Value {
    refused("module_missing", &format!("items/{item}"))
}

fn gpui_draws<'a>(marks: impl IntoIterator<Item = &'a Drawn>) -> Result<(), Value> {
    match crate::layer::gpui_lacks(marks) {
        Some(item) => Err(gpui_lacks(&item)),
        None => Ok(()),
    }
}

/// `mesh` moved by `offset`, so meshes drawn at different offsets join into one.
fn baked(mesh: &Mesh, offset: [f32; 2]) -> Mesh {
    Mesh {
        vertices: mesh
            .vertices
            .iter()
            .map(|v| [v[0] + offset[0], v[1] + offset[1]])
            .collect(),
        indices: mesh.indices.clone(),
    }
}

/// A ring `width` px wide inside `b`, in `color`, with outer corner radius `r`.
fn ring_quad(b: [f64; 4], r: f64, width: f64, color: Rgb) -> PaintQuad {
    quad(
        rect(b),
        px(r as f32),
        transparent_black(),
        px(width as f32),
        hsla(color),
        BorderStyle::Solid,
    )
}
