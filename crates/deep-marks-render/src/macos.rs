//! The view on macOS: one headless GPUI app for every line, a window per document session at the
//! view's zoom as its scale factor, and the session's caches (canvas primitives: Invalidation and
//! damage; Content key; Dirty classes).
//!
//! - A path's tessellation is cached by (content key, zoom bucket): moving or recoloring it, or a
//!   zoom inside its bucket, reuses the triangles.
//! - A text's shaped run comes from deep-text-gpui's cache, keyed by what the shaper reads; the
//!   session holds each run's entry by the text's content key.
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
//!
//! Issue #417: a session's step may switch the look. The look enters the scene's rebuild key and
//! every key that reads it (a mark's colors, a text's face), so a switch rebuilds only the nodes
//! whose content key changed; each step reports the entries it built and the rebuild key.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas_marks::dirty::{Class, Dirty};
use deep_canvas_marks::key::{sha256_hex, ContentKey, KeyBuilder};
use deep_canvas_marks::look::Look;
use deep_canvas_marks::path::{self, Mesh};
use deep_canvas_marks::scene::{
    self, AtlasCell, Drawn, Fill, ImageFit, ImageSampling, Mark, Record, Rgb, StatusMark,
};
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
    /// #499: a video item's frame: its player's pooled NV12 buffer, drawn by the live shader.
    Surface {
        buffer: objc2_core_foundation::CFRetained<objc2_core_video::CVPixelBuffer>,
        bounds: Bounds<Pixels>,
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
        Draw::Surface { buffer, bounds } => window.paint_surface(*bounds, buffer.clone()),
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

/// An image's sprite by its level's sha256 and the mark's opacity bits (#1486).
type ImageKey = ([u8; 32], u64);

/// A linear image's copy placed as a canonical render places it, by its sprite and its fitted
/// rect and cut, in u, as bits (#1486).
type PlacedKey = (ImageKey, [u64; 4], [u64; 4]);

/// A nearest or cubic image's copy resampled on the CPU, by its sprite, its sampling and its
/// drawn size in device pixels (GPUI's sprite sampler is linear and can't change per draw).
type ResampleKey = (ImageKey, ImageSampling, [u32; 2]);

/// A document session: its windows, its caches and the frame on screen.
struct Session {
    main: Option<Surface>,
    cache: Option<Surface>,
    tessellations: HashMap<(ContentKey, i32), Tessellation>,
    /// #417: each shaped run's entry by its text's content key.
    shaped: HashMap<ContentKey, Entry>,
    /// #417: the entries made, not reused, since the last step's report, and the presented
    /// frame's rebuild key: the look's tokens and every layer's key.
    built: Read,
    fresh: BTreeSet<(ContentKey, i32)>,
    rebuild_key: Option<ContentKey>,
    layers: HashMap<ContentKey, LayerCache>,
    /// Each layer prefix's key on the last presented frame and how many frames in a row it held.
    stable: Vec<(ContentKey, u32)>,
    /// The presented frame's `valid_until`, or `None` once nothing changes again.
    valid_until: Option<i64>,
    /// #1487: the region of the document the window shows, and whether the planted clock counts
    /// every item wherever it is: otherwise `valid_until` counts only items that meet it.
    region: Option<([f64; 4], bool)>,
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
    /// The content-addressed store images are read from, and the image service's view of it.
    store: Option<PathBuf>,
    image_store: Option<Arc<deep_images::Store>>,
    /// #1486: each sprite made from a level at an opacity, with the last frame that drew it; and
    /// each copy of one placed off whole pixels, by its rect and cut, with the whole-pixel rect it
    /// is drawn 1:1 in.
    images: HashMap<ImageKey, (Arc<RenderImage>, u64)>,
    placed: HashMap<PlacedKey, (Arc<RenderImage>, [f64; 4], u64)>,
    /// #1486: whether frames run on the real clock, so they draw what the image service holds
    /// and never wait; each image item's level, kept while its drawn size drifts within the band;
    /// the requests this frame drew and their levels' bytes; and the presented frames so far.
    live: bool,
    levels: HashMap<String, u8>,
    drawn_keys: HashSet<deep_images::Key>,
    drawn_bytes: u64,
    frame_no: u64,
    /// #1486: the image items a frame leaves out while they're out of view (by program index, ID
    /// and box), with this frame's verdicts, and whether the last frame drew any short of its level.
    cull: Vec<(usize, String, [f64; 4])>,
    culled: HashMap<String, usize>,
    out: Vec<bool>,
    settling: bool,
    /// #1486: each image item in view this frame, the level it asked for and the level it drew,
    /// and what the image service's frame start left.
    frame_levels: BTreeMap<String, (u8, Option<u8>)>,
    started: deep_images::Started,
    /// The resampled copies the frame on screen draws, and how many the session has made.
    resampled: HashMap<ResampleKey, Arc<RenderImage>>,
    resamples: u64,
    /// #1485's wrong program on the images' decode, cap or upload.
    plant: crate::asset::Plant,
    /// Each text@1 item's shown string and glyph run on the presented frame, as `raster`
    /// reports them (#140: the app and headless shape the same runs).
    texts: Map<String, Value>,
    /// #499: each video image item's player, the document time its next source frame starts at
    /// on screen, whether the next frame shown names its planes, and the run's clock.
    players: BTreeMap<String, crate::video::Player>,
    video_until: Option<i64>,
    hash_next: bool,
    run_start: Option<Instant>,
}

/// What a frame draws for an image mark: its level as GPUI's sprite, the level's size and sha256,
/// and the rect its fit draws it in.
struct Pictured {
    image: Arc<RenderImage>,
    size: [u32; 2],
    sha256: [u8; 32],
    to: [f64; 4],
}

/// The store the image service reads the session's images from.
fn image_store(session: &mut Session) -> Arc<deep_images::Store> {
    session
        .image_store
        .get_or_insert_with(|| crate::asset::store_of(session.store.as_deref()))
        .clone()
}

/// What a frame draws for an image mark (#1486): the level the image service gives for its drawn
/// size at `zoom`, as GPUI's BGRA sprite with the mark's opacity in its alpha, since GPUI's sprite
/// takes straight alpha. A live frame draws what the service holds, the level or the nearest one
/// held, or nothing yet (`None`), and an item keeps its level while its drawn size drifts within
/// the band; a frame on a simulated clock waits for the level. The levels a frame draws hold at
/// most `asset::CAP`: one past it is refused, naming the image's asset.
#[allow(clippy::too_many_arguments)]
fn image_of(
    session: &mut Session,
    asset: &str,
    (crop, tile): (Option<[f64; 4]>, Option<&AtlasCell>),
    opacity: f64,
    item: &str,
    (bounds, fit): ([f64; 4], ImageFit),
    zoom: f64,
) -> Result<Option<Pictured>, Value> {
    let store = image_store(session);
    let mut ask = crate::asset::ask(&store, asset, (crop, tile), (bounds, fit), zoom, item)?;
    let shown = ask.key.shown();
    if session.live {
        let drawn = [ask.to[2] * zoom, ask.to[3] * zoom];
        match session.levels.get_mut(item) {
            Some(k) if deep_images::keeps(*k, shown, drawn) => ask.key.level = *k,
            Some(k) => *k = ask.key.level,
            None => {
                session.levels.insert(item.to_string(), ask.key.level);
            }
        }
    }
    let [lw, lh] = deep_images::level_size(shown, ask.key.level);
    if session.drawn_keys.insert(ask.key) {
        let bytes = u64::from(lw) * u64::from(lh) * 4;
        if session.plant != crate::asset::Plant::CapCountsCopiesOnly
            && held(session) + bytes > crate::asset::CAP
        {
            return Err(refused(
                "over_budget",
                &format!("items/{item}/params/asset"),
            ));
        }
        session.drawn_bytes += bytes;
    }
    let images = crate::asset::images();
    let no = |r| crate::asset::refusal(r, asset, item, tile.is_some());
    let level = if session.live {
        // A live frame asks only for what the window shows, and reports what it drew.
        let ([x, y, w, h], _) = session.region.unwrap_or(([0.0; 4], false));
        if !meets(bounds, [0.0, 0.0, w, h]) {
            return Ok(None);
        }
        let at = [bounds[0] + x, bounds[1] + y, bounds[2], bounds[3]];
        let asked = ask.key.level;
        let (level, drawn) = match images.show(&store, ask.key, deep_images::Queue::Visible, at) {
            deep_images::Shown::Exact(l) => (Some(l), Some(asked)),
            deep_images::Shown::Nearest(l, k) => (Some(l), Some(k)),
            deep_images::Shown::Nothing => match images.failed(&ask.key) {
                Some(r) => return Err(no(r)),
                None => (None, None),
            },
        };
        session
            .frame_levels
            .insert(item.to_string(), (asked, drawn));
        match level {
            Some(level) => level,
            None => return Ok(None),
        }
    } else {
        images.wait(&store, ask.key).map_err(no)?
    };
    let key = (level.sha256, opacity.to_bits());
    let frame = session.frame_no;
    if let Some((image, seen)) = session.images.get_mut(&key) {
        *seen = frame;
        return Ok(Some(Pictured {
            image: image.clone(),
            size: level.size,
            sha256: level.sha256,
            to: ask.to,
        }));
    }
    let [w, h] = level.size;
    let mut bgra = level.rgba.clone();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
        px[3] = (f64::from(px[3]) * opacity).round() as u8;
    }
    let frame_image = image::RgbaImage::from_raw(w, h, bgra)
        .ok_or_else(|| refused("asset_undecodable", &format!("items/{item}/params/asset")))?;
    let image = Arc::new(RenderImage::new([image::Frame::new(frame_image)]));
    session.images.insert(key, (image.clone(), frame));
    Ok(Some(Pictured {
        image,
        size: level.size,
        sha256: level.sha256,
        to: ask.to,
    }))
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

/// The part of `a` inside `b`.
fn intersect(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let (x0, y0) = (a[0].max(b[0]), a[1].max(b[1]));
    let (x1, y1) = (
        (a[0] + a[2]).min(b[0] + b[2]),
        (a[1] + a[3]).min(b[1] + b[3]),
    );
    [x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)]
}

/// Whether GPUI's sprite draws a `size` px level fitted to `to` and cut at `bounds` (u) as a
/// canonical render does at `zoom`: every edge on a whole device pixel, and the cut on whole texels
/// of the level, so neither snapping nor its sub-tile rounding moves a sample.
fn sprite_exact(to: [f64; 4], bounds: [f64; 4], size: [u32; 2], zoom: f64) -> bool {
    let whole = |v: f64| (v - v.round()).abs() < 1e-3;
    let c = intersect(bounds, to);
    let edges = [
        to[0],
        to[1],
        to[0] + to[2],
        to[1] + to[3],
        c[0],
        c[1],
        c[0] + c[2],
        c[1] + c[3],
    ];
    let texels = [
        (c[0] - to[0]) / to[2] * f64::from(size[0]),
        (c[1] - to[1]) / to[3] * f64::from(size[1]),
        c[2] / to[2] * f64::from(size[0]),
        c[3] / to[3] * f64::from(size[1]),
    ];
    edges.iter().all(|e| whole(e * zoom)) && texels.into_iter().all(whole)
}

/// A linear picture's copy placed as a canonical render places it, on the whole device pixels
/// around its cut, and that rect in u: made once per rect and cut.
fn placed_copy(
    session: &mut Session,
    p: &Pictured,
    opacity: f64,
    bounds: [f64; 4],
    zoom: f64,
) -> Result<(Arc<RenderImage>, [f64; 4]), Value> {
    let key = (
        (p.sha256, opacity.to_bits()),
        p.to.map(f64::to_bits),
        bounds.map(f64::to_bits),
    );
    let frame = session.frame_no;
    if let Some((image, hull, seen)) = session.placed.get_mut(&key) {
        *seen = frame;
        return Ok((image.clone(), *hull));
    }
    let c = intersect(bounds, p.to).map(|v| v * zoom);
    let (x0, y0) = (c[0].floor(), c[1].floor());
    let (x1, y1) = (
        (c[0] + c[2]).ceil().max(x0 + 1.0),
        (c[1] + c[3]).ceil().max(y0 + 1.0),
    );
    let to = p.to.map(|v| v * zoom);
    let narrow = |v: f64| u16::try_from(v as i64).ok();
    let (Some(ow), Some(oh), Ok(sw), Ok(sh)) = (
        narrow(x1 - x0),
        narrow(y1 - y0),
        u16::try_from(p.size[0]),
        u16::try_from(p.size[1]),
    ) else {
        return Err(refused("asset_undecodable", ""));
    };
    // The sprite's straight BGRA, its opacity in alpha, back to RGBA.
    let mut rgba = p.image.as_bytes(0).unwrap_or_default().to_vec();
    rgba.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let shift = |r: [f64; 4]| [r[0] - x0, r[1] - y0, r[2], r[3]];
    let mut out = deep_marks_vello::placed(
        rgba,
        [sw, sh],
        ImageSampling::Linear,
        (shift(to), shift(c)),
        [ow, oh],
    );
    out.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let frame_image = image::RgbaImage::from_raw(u32::from(ow), u32::from(oh), out)
        .ok_or_else(|| refused("asset_undecodable", ""))?;
    let image = Arc::new(RenderImage::new([image::Frame::new(frame_image)]));
    let hull = [x0 / zoom, y0 / zoom, (x1 - x0) / zoom, (y1 - y0) / zoom];
    session.placed.insert(key, (image.clone(), hull, frame));
    Ok((image, hull))
}

/// The images the image service has read from a store and decoded, and those Vello GPU's
/// renderer has uploaded, so far (#1485).
fn image_counts(vello: &Option<(Arc<deep_gpu::device::Gpu>, crate::gpu::Vello2d)>) -> [u64; 3] {
    let stats = crate::asset::images().stats();
    [
        stats.source_reads,
        stats.decoded,
        vello.as_ref().map_or(0, |(_, v)| v.uploads()),
    ]
}

/// The bytes of a `[w, h]` RGBA picture.
fn bytes([w, h]: [u32; 2]) -> u64 {
    u64::from(w) * u64::from(h) * 4
}

/// What the frame draws held: its levels and its resampled copies; #1485 AC2's wrong program
/// counts only the copies.
fn held(session: &Session) -> u64 {
    let levels = match session.plant {
        crate::asset::Plant::CapCountsCopiesOnly => 0,
        _ => session.drawn_bytes,
    };
    levels + session.resampled.keys().map(|k| bytes(k.2)).sum::<u64>()
}

/// An image's copy resampled to its drawn size, made once and then reused. The copies and the
/// levels a frame draws hold at most `asset::CAP`: a copy past it is refused, naming the image's
/// asset.
fn resampled(
    session: &mut Session,
    key: &ResampleKey,
    source: &RenderImage,
    size: [u32; 2],
    (item, asset): (&str, &str),
) -> Result<Arc<RenderImage>, Value> {
    if let Some(found) = session.resampled.get(key) {
        return Ok(found.clone());
    }
    // Named as a missing asset is: the field and the asset's hash.
    let path = format!("items/{item}/params/asset: {asset}");
    let to = key.2;
    if held(session) + bytes(to) > crate::asset::CAP {
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
    session.resampled.insert(*key, copy.clone());
    Ok(copy)
}

/// Compiles a revision once, so its frames only evaluate.
fn compile(session: &mut Session, doc: &Map<String, Value>) -> Result<(), Value> {
    let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
    let state = program.state();
    // #1486: the image items a frame may leave out while out of view: still pictures with a box,
    // neither a parent nor a child, no channel field writing them, and no video.
    session.cull.clear();
    session.culled.clear();
    if let Some(Value::Object(items)) = doc.get("items") {
        let parents: HashSet<&str> = (items.values())
            .filter_map(|i| i.get("parent")?.as_str())
            .collect();
        let written: HashSet<usize> = program.fields.iter().filter_map(|f| f.item).collect();
        for (i, id) in program.items.iter().enumerate() {
            let Some(item) = items.get(id) else { continue };
            let params = item.get("params");
            let still = item["kind"] == "image@1"
                && item.get("parent").is_none()
                && !parents.contains(id.as_str())
                && !written.contains(&i)
                && params.and_then(|p| p.get("frames")).is_none();
            let b: Option<Vec<f64>> = params
                .and_then(|p| p.get("box")?.as_array())
                .map(|b| b.iter().filter_map(Value::as_f64).collect());
            if let (true, Some(&[x, y, w, h])) = (still, b.as_deref()) {
                session.culled.insert(id.clone(), session.cull.len());
                session.cull.push((i, id.clone(), [x, y, w, h]));
            }
        }
    }
    session.compiled = Some((program, state));
    Ok(())
}

/// The rect `[0, 0, w, h]` a document's `size` gives.
fn doc_rect(doc: &Map<String, Value>) -> [f64; 4] {
    let s = doc.get("size").and_then(Value::as_array);
    let n = |k: usize| s.and_then(|s| s.get(k)?.as_f64()).unwrap_or(0.0);
    [0.0, 0.0, n(0), n(1)]
}

fn meets(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]
}

/// #1486: which of the image items a frame may leave out lie out of `view` where their slots put
/// them, unturned and unscaled (into `out`), and those of them within a view's height above or
/// below it, with their rects.
fn cull(
    entries: &[(usize, String, [f64; 4])],
    out: &mut Vec<bool>,
    slots: &[f64],
    view: [f64; 4],
) -> Vec<(usize, [f64; 4])> {
    use deep_canvas_motion::program::TRANSFORM;
    out.clear();
    let mut near = Vec::new();
    let margin = [view[0], view[1] - view[3], view[2], view[3] * 3.0];
    for (j, (i, _, b)) in entries.iter().enumerate() {
        let Some(s) = slots.get(i * TRANSFORM..(i + 1) * TRANSFORM) else {
            out.push(false);
            continue;
        };
        let still = s[3..6].iter().all(|v| *v == 0.0) && s[6..9].iter().all(|v| *v == 1.0);
        let r = [b[0] + s[0], b[1] + s[1], b[2], b[3]];
        let gone = still && !meets(r, view);
        out.push(gone);
        if gone && meets(r, margin) {
            near.push((j, r));
        }
    }
    near
}

/// #1486: a picture a live frame will soon draw, asked of the image service ahead of need.
fn prefetch(session: &mut Session, doc: &Map<String, Value>, j: usize, at: [f64; 4], zoom: f64) {
    let id = session.cull[j].1.clone();
    let Some(params) = doc.get("items").and_then(|i| i.get(&id)?.get("params")) else {
        return;
    };
    let Some(asset) = params.get("asset").and_then(Value::as_str) else {
        return;
    };
    let fit = match params.get("fit").and_then(Value::as_str) {
        Some("cover") => ImageFit::Cover,
        Some("fill") => ImageFit::Fill,
        Some("none") => ImageFit::None,
        _ => ImageFit::Contain,
    };
    let crop = params.get("crop").and_then(Value::as_array).and_then(|c| {
        let c: Vec<f64> = c.iter().filter_map(Value::as_f64).collect();
        <[f64; 4]>::try_from(c).ok()
    });
    let store = image_store(session);
    if let Ok(ask) = crate::asset::ask(&store, asset, (crop, None), (at, fit), zoom, &id) {
        crate::asset::images().show(&store, ask.key, deep_images::Queue::Prefetch, at);
    }
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
    /// Energy, in nanojoules.
    energy_nj: u64,
}

/// The kernel's `rusage_info_v6`: libc stops at v4, and v6 is where Apple Silicon's energy counter is.
#[repr(C)]
struct RusageV6 {
    v4: libc::rusage_info_v4,
    ri_flags: u64,
    ri_user_ptime: u64,
    ri_system_ptime: u64,
    ri_pinstructions: u64,
    ri_pcycles: u64,
    ri_energy_nj: u64,
    ri_penergy_nj: u64,
    reserved: [u64; 14],
}

/// The counter the idle report's energy reading comes from.
const ENERGY_COUNTER: &str = "ri_energy_nj";

/// Energy this process has used, in nanojoules, as the kernel counts it; 0 when the counter reads zero or the call fails.
fn energy_nj() -> u64 {
    // SAFETY: an all-zero RusageV6 is valid for the call to fill.
    let mut info: RusageV6 = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is laid out as rusage_info_v6, the flavor asked for (6).
    let status = unsafe {
        libc::proc_pid_rusage(
            libc::getpid(),
            6,
            (&raw mut info).cast::<libc::rusage_info_t>(),
        )
    };
    if status == 0 {
        info.ri_energy_nj
    } else {
        0
    }
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
        energy_nj: energy_nj(),
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
    let fresh = &mut session.fresh;
    session
        .tessellations
        .entry((key, bucket))
        .or_insert_with(|| {
            fresh.insert((key, bucket));
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

/// The key of what a look gives a scene in a theme (#417): its roles, at an alpha too, its type
/// and its status map.
fn look_key(look: &Look, theme: Theme) -> ContentKey {
    let (palette, alpha, ty) = match theme {
        Theme::Light => (&look.light, &look.light_alpha, &look.light_type),
        Theme::Dark => (&look.dark, &look.dark_alpha, &look.dark_type),
    };
    let mut k = KeyBuilder::new("look@marks2d.1");
    for (role, rgb) in palette {
        k.text(role).bytes(rgb);
    }
    for (role, rgba) in alpha {
        k.text(role).bytes(rgba);
    }
    for (font, family) in &ty.fonts {
        k.text(font).text(family);
    }
    k.int(ty.fallback.len() as i64);
    for family in &ty.fallback {
        k.text(family);
    }
    if let Some(status) = &look.status {
        for (state, rgb) in &status.colors {
            k.text(state).bytes(rgb);
        }
    }
    k.finish()
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
                image_plant,
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
                (store, image_plant),
            ),
            Request::Session {
                look,
                steps,
                store,
                switch_rebuilds,
            } => self.session(look, steps, store, switch_rebuilds),
            Request::Idle {
                doc,
                look,
                view,
                record,
                seconds,
                arms_each_vsync,
                region,
                store,
                pans,
            } => self.idle(
                &doc,
                &look,
                view,
                record,
                seconds,
                arms_each_vsync,
                region,
                (store, pans),
            ),
            Request::Live(run) => self.live(*run),
            Request::Render {
                out,
                doc,
                look,
                view,
                t,
                record,
                gpui_oklab,
                drops_glyph,
                store,
                stock_fragment,
                image_plant,
            } => {
                use gpui_apple::metal_renderer::gpu_surfaces::{plant, Planted};
                if stock_fragment {
                    plant(Planted::StockFragment);
                }
                let answer = self.render(
                    &out,
                    &doc,
                    &look,
                    view,
                    t,
                    record,
                    (gpui_oklab, drops_glyph),
                    (store, image_plant),
                );
                plant(Planted::None);
                answer
            }
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
    /// picture GPUI paints, on a device opened the first time a layer needs it; its images are
    /// read from `store`, with #1485's wrong program if planted.
    fn vello_picture(
        &mut self,
        marks: &[&Drawn],
        size: [f64; 2],
        zoom: f64,
        (store, plant): (Option<PathBuf>, crate::asset::Plant),
    ) -> Result<Arc<RenderImage>, Value> {
        if self.vello.is_none() {
            let gpu = deep_gpu::device::Gpu::open(deep_gpu::device::Backend::Gpu)
                .map_err(|e| refused("no_device", &e))?;
            let vello =
                crate::gpu::Vello2d::new(&gpu.device().device, wgpu::TextureFormat::Rgba8Unorm);
            self.vello = Some((gpu, vello));
        }
        let (gpu, vello) = self.vello.as_mut().expect("opened above");
        vello.set_store(store);
        let device = gpu.device();
        let px = [
            (size[0] * zoom).round() as u32,
            (size[1] * zoom).round() as u32,
        ];
        let options = crate::gpu::Options {
            zoom,
            plant,
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
                                crate::raster::glyph_row(g, role, spec.lang.as_deref())
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
                        runs: runs
                            .iter()
                            .map(|r| (r.from..r.to, hsla(r.color).opacity(r.opacity as f32)))
                            .collect(),
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
                    tile,
                    ..
                } => {
                    // #499: a video item draws its player's frame through the live shader.
                    if let Some(p) = session.players.get(item) {
                        let to = fit.fitted(*bounds, [p.out.0 as u32, p.out.1 as u32]);
                        push(Draw::Surface {
                            buffer: p.surface().clone(),
                            bounds: rect(to),
                        });
                        continue;
                    }
                    // #1486: a live frame with nothing of the picture yet draws nothing there.
                    let placed = (*bounds, *fit);
                    let crop = (*crop, tile.as_ref());
                    let Some(p) = image_of(session, asset, crop, *opacity, item, placed, zoom)?
                    else {
                        continue;
                    };
                    let mut clip = *bounds;
                    let (image, image_bounds) = if *sampling == ImageSampling::Linear
                        && sprite_exact(p.to, *bounds, p.size, zoom)
                    {
                        (p.image, p.to)
                    } else if *sampling == ImageSampling::Linear {
                        // GPUI's sprite lands on whole device pixels: a picture placed off them
                        // draws 1:1 from a copy placed and cut as the canonical render does it.
                        let (copy, hull) = placed_copy(session, &p, *opacity, *bounds, zoom)?;
                        clip = hull;
                        (copy, hull)
                    } else {
                        // The sprite sampler is linear, so the copy is drawn 1:1 on whole pixels.
                        let key = (p.sha256, opacity.to_bits());
                        let (key, at) = resample_at(key, *sampling, p.to, zoom);
                        (
                            resampled(session, &key, &p.image, p.size, (item, asset))?,
                            at,
                        )
                    };
                    push(Draw::Picture {
                        image,
                        bounds: Some(rect(clip)),
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
        // #1486: a frame starts: the image service evicts past its bounds, and the levels this
        // frame draws count afresh.
        session.frame_no += 1;
        session.drawn_keys.clear();
        session.drawn_bytes = 0;
        session.frame_levels.clear();
        session.started = crate::asset::images().frame_start();
        let view_rect = session.region.map_or_else(|| doc_rect(doc), |(r, _)| r);
        // The revision's program evaluates into its state with no allocation; only the items the
        // draw list reads are written out, and (#1486) none of the image items out of view.
        let (items, valid_until, near) = {
            let (program, state) = session
                .compiled
                .as_mut()
                .ok_or_else(|| refused("bad_doc", ""))?;
            program.evaluate(t, eval::Validity::Full, state);
            let near = cull(&session.cull, &mut session.out, &state.slots, view_rect);
            let (out, culled) = (&session.out, &session.culled);
            let mut items = if session.cull.is_empty() {
                eval::items(doc, program, state)
            } else {
                eval::items_where(doc, program, state, |id| {
                    culled.get(id).is_none_or(|&j| !out[j])
                })
            };
            let valid_until = match session.region {
                Some((rect, false)) => {
                    let meets = |id: &str| {
                        items
                            .get(id)
                            .is_none_or(|i| deep_canvas_motion::clock::meets(i, &rect))
                    };
                    program.valid_until_in_view(state, eval::Validity::Full, meets)
                }
                _ => state.valid_until,
            };
            // The window shows the region: every item moved by its origin.
            if let Some(([x, y, ..], _)) = session.region {
                for item in items.values_mut() {
                    // #499: an item with no `at.pos` sits at its origin, and moves with the rest.
                    if item.pointer("/at/pos").is_none() {
                        if let Some(o) = item.as_object_mut() {
                            let at = o.entry("at").or_insert_with(|| json!({}));
                            if let Some(at) = at.as_object_mut() {
                                at.insert("pos".into(), json!([0.0, 0.0, 0.0]));
                            }
                        }
                    }
                    if let Some(pos) = item.pointer_mut("/at/pos").and_then(Value::as_array_mut) {
                        for (k, o) in [x, y].into_iter().enumerate() {
                            if let Some(p) = pos.get(k).and_then(Value::as_f64) {
                                pos[k] = json!(p - o);
                            }
                        }
                    }
                }
            }
            (items, valid_until, near)
        };
        // #1486: a live frame asks ahead for the pictures within a view's height of it.
        if session.live {
            for (j, at) in near {
                prefetch(session, doc, j, at, view.zoom);
            }
        }
        // #499: each video item in view shows its source frame at t.
        session.video_until = Self::videos(session, doc, Some(&items), t, view.zoom)?;
        let palette = palette_of(look, view.theme);
        let ty = crate::type_of(look, view.theme);
        let frame = scene::frame_planted(
            doc,
            &items,
            (palette, ty),
            record,
            view.zoom,
            scene::Planted::None,
        )
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
            let images = (session.store.clone(), session.plant);
            pictures.push(Some(
                self.vello_picture(&marks, frame.size, view.zoom, images)?,
            ));
        }
        // The images and pixmaps no Vello GPU layer of this frame painted are let go.
        if let Some((_, vello)) = self.vello.as_mut() {
            vello.frame_ended();
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
        // A resampled copy lives while the frame on screen draws it, so a new revision, a zoom or a
        // resize frees what it left before the cap counts it. An image on a layer Vello GPU draws
        // is Vello GPU's to draw, not GPUI's.
        let mut copies = Vec::new();
        for (layer, picture) in frame.layers.iter().zip(&pictures) {
            if picture.is_some() {
                continue;
            }
            for drawn in &layer.marks {
                if let Mark::Image {
                    item,
                    asset,
                    bounds,
                    fit,
                    sampling,
                    crop,
                    opacity,
                    tile,
                    ..
                } = &drawn.mark
                {
                    if *sampling == ImageSampling::Linear || session.players.contains_key(item) {
                        continue;
                    }
                    let placed = (*bounds, *fit);
                    let crop = (*crop, tile.as_ref());
                    if let Some(p) =
                        image_of(session, asset, crop, *opacity, item, placed, view.zoom)?
                    {
                        let key = (p.sha256, opacity.to_bits());
                        copies.push(resample_at(key, *sampling, p.to, view.zoom).0);
                    }
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
        // A prefix stays the same while its key holds and none of its layers' items is dirty; and
        // (#1486) not while the last live frame drew a picture short of its level, so no layer
        // picture keeps a picture that hadn't arrived.
        let mut dirty_below = session.live && session.settling;
        let stable: Vec<(ContentKey, u32)> = prefixes
            .iter()
            .enumerate()
            .map(|(i, key)| {
                dirty_below |= changed_layers.contains(&frame.layers[i].id);
                // #499: a layer showing a video is never cached as a picture: its frames move.
                dirty_below |= frame.layers[i].marks.iter().any(|m| {
                    matches!(&m.mark, Mark::Image { item, .. } if session.players.contains_key(item))
                });
                match session.stable.get(i) {
                    Some((prev, n)) if prev == key && !dirty_below => (*key, n + 1),
                    _ => (*key, 0),
                }
            })
            .collect();

        let mut used = BTreeSet::new();
        let mut shaped_used = BTreeSet::new();
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
        // cached picture was drawn from included, since they are its read set, and each image
        // GPUI draws.
        for (layer, picture) in frame.layers.iter().zip(&pictures) {
            for drawn in &layer.marks {
                match &drawn.mark {
                    Mark::Path {
                        item, d, geometry, ..
                    } => {
                        let entry = tessellation(session, geometry, d, bucket, &mut used)
                            .entry
                            .clone();
                        if session.fresh.remove(&(entry.key, bucket)) {
                            session
                                .built
                                .tessellation
                                .push((item.clone(), bucket, entry.clone()));
                        }
                        read.tessellation.push((item.clone(), bucket, entry));
                    }
                    Mark::Text { item, spec, .. } => {
                        let key = spec.key();
                        shaped_used.insert(key);
                        let entry = match session.shaped.get(&key) {
                            Some(entry) => entry.clone(),
                            None => {
                                let Some(label) = label_of(spec) else {
                                    return Err(refused(
                                        "bad_font",
                                        &format!("items/{item}/params/font"),
                                    ));
                                };
                                let shaped = deep_text_gpui::shape(&label);
                                let entry = Entry::of(key, &shaped_bytes(&shaped));
                                session.shaped.insert(key, entry.clone());
                                session.built.text.push((item.clone(), entry.clone()));
                                entry
                            }
                        };
                        read.text.push((item.clone(), entry));
                    }
                    Mark::Image {
                        item,
                        asset,
                        bounds,
                        fit,
                        crop,
                        opacity,
                        tile,
                        ..
                    } if !session.players.contains_key(item) && picture.is_none() => {
                        // #1486: what a frame reads of a picture is its level, named by its hash.
                        let placed = (*bounds, *fit);
                        let crop = (*crop, tile.as_ref());
                        if let Some(p) =
                            image_of(session, asset, crop, *opacity, item, placed, view.zoom)?
                        {
                            read.images
                                .push((item.clone(), Entry::of(drawn.mark.key(bucket), &p.sha256)));
                        }
                    }
                    _ => {}
                }
            }
        }
        // A cached result lives while the frame on screen reads it.
        session.tessellations.retain(|k, _| used.contains(k));
        session.shaped.retain(|k, _| shaped_used.contains(k));
        let mut rebuild = KeyBuilder::new("rebuild@marks2d.1");
        rebuild.key(&look_key(look, view.theme));
        for layer in &frame.layers {
            rebuild.text(&layer.id).key(&layer.key);
        }
        session.rebuild_key = Some(rebuild.finish());
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
        // #1486: a sprite neither this frame nor the one before drew gives back its atlas slot in
        // both windows, after the frame that last drew it rendered; the image service's queue
        // drops what this pass looked over and didn't ask for again.
        let frame_no = session.frame_no;
        let mut gone = Vec::new();
        session.images.retain(|_, (image, seen)| {
            let keep = *seen + 1 >= frame_no;
            if !keep {
                gone.push(image.clone());
            }
            keep
        });
        session.placed.retain(|_, (image, _, seen)| {
            let keep = *seen + 1 >= frame_no;
            if !keep {
                gone.push(image.clone());
            }
            keep
        });
        if !gone.is_empty() {
            let windows = [session.main.as_ref(), session.cache.as_ref()];
            for handle in windows.into_iter().flatten().map(|w| w.handle) {
                let _ = self.cx.update_window(handle, |_, window, _| {
                    for image in &gone {
                        let _ = window.drop_image(image.clone());
                    }
                });
            }
        }
        let images = crate::asset::images();
        images.pass_ended([
            -f64::MAX / 4.0,
            -f64::MAX / 4.0,
            f64::MAX / 2.0,
            f64::MAX / 2.0,
        ]);
        session.settling = images.settling();
        Ok(())
    }

    /// #499: every video image item of `items` (as the window shows them) at `t`: a player made
    /// for each, decoding near the size it's drawn, and each in view put on the frame at t. An
    /// item out of view decodes nothing. The document time the next frame on screen starts at.
    fn videos(
        session: &mut Session,
        doc: &Map<String, Value>,
        items: Option<&Map<String, Value>>,
        t: i64,
        zoom: f64,
    ) -> Result<Option<i64>, Value> {
        // A full frame: a player for each video item, holding the item as the window shows it.
        for (id, item) in items.into_iter().flatten() {
            let (Some(frames), Some(sha)) = (
                item.pointer("/params/frames"),
                item.pointer("/params/asset").and_then(Value::as_str),
            ) else {
                continue;
            };
            if item["kind"] != "image@1" || !crate::video::is_video(session.store.as_deref(), sha) {
                continue;
            }
            if !session.players.contains_key(id) {
                let b = item.pointer("/params/box").and_then(Value::as_array);
                let side = |k: usize| {
                    b.and_then(|b| b.get(k)?.as_f64())
                        .map_or(0, |v| ((v * zoom).round() as usize).max(2))
                };
                let store = session.store.clone().unwrap_or_default();
                let mut player = crate::video::Player::start(&store.join(sha), (side(2), side(3)))
                    .map_err(|_| {
                        refused("asset_undecodable", &format!("items/{id}/params/asset"))
                    })?;
                let doc_v = Value::Object(doc.clone());
                player.timing = (
                    deep_canvas_media::doc::time(&doc_v, frames.get("start")).unwrap_or(0),
                    deep_canvas_media::doc::time(&doc_v, frames.get("in")).unwrap_or(0),
                    deep_canvas_media::doc::rate(frames.get("rate")).unwrap_or((1, 1)),
                );
                session.players.insert(id.clone(), player);
            }
            // In view or not, as the window shows the item: a frame that only a video changes
            // keeps it, so it reads no item.
            // The window's region moved items by their `at.pos` only; the item is read back where
            // the document puts it, against the region, as #1487's clock reads it.
            let visible = session
                .region
                .is_none_or(|([.., w, h], _)| in_view(item, [0.0, 0.0, w, h]));
            if let Some(p) = session.players.get_mut(id) {
                p.visible = visible;
            }
        }
        let at_ms = session
            .run_start
            .map_or(0.0, |s| s.elapsed().as_secs_f64() * 1000.0);
        let mut until: Option<i64> = None;
        let mut shown_any = false;
        let hash = session.hash_next;
        for player in session.players.values_mut() {
            if !player.visible {
                continue;
            }
            let (start, r#in, rate) = player.timing;
            let src = deep_canvas_media::frames::source_time(t.max(start), start, r#in, rate);
            let k = player.frame_at(src);
            if player.show(k, at_ms) {
                shown_any = true;
                let planes = hash.then(|| player.planes_hash());
                if player.log.shown.len() < player.log.shown.capacity() {
                    player.log.shown.push(crate::video::Shown {
                        at_ms,
                        t,
                        frame: k,
                        planes,
                    });
                }
            }
            // The next frame's start, back in document time: start + (src − in) ÷ rate, rounded up.
            if let Some(next) = player.next_start(k) {
                let rel = (next - r#in) as i128 * rate.1 as i128;
                let p = rate.0.max(1) as i128;
                let at = start as i128 + (rel + p - 1).div_euclid(p);
                until = Some(until.map_or(at as i64, |u: i64| u.min(at as i64)));
            }
        }
        if shown_any {
            session.hash_next = false;
        }
        Ok(until)
    }

    /// #499: a frame that only the video items' frames change: each item in view put on its
    /// frame at `t` and the window's last frame presented again, nothing laid out or painted.
    fn video_tick(
        &mut self,
        session: &mut Session,
        doc: &Map<String, Value>,
        t: i64,
    ) -> Result<(), Value> {
        let zoom = session.main.as_ref().map_or(1.0, |m| m.zoom);
        session.video_until = Self::videos(session, doc, None, t, zoom)?;
        let main = session
            .main
            .as_ref()
            .ok_or_else(|| refused("no_window", ""))?;
        self.cx.present_again(main.handle);
        Ok(())
    }

    fn new_session() -> Session {
        Session {
            main: None,
            cache: None,
            tessellations: HashMap::new(),
            shaped: HashMap::new(),
            built: Read::default(),
            fresh: BTreeSet::new(),
            rebuild_key: None,
            layers: HashMap::new(),
            stable: Vec::new(),
            valid_until: None,
            region: None,
            stale_at: None,
            bound: json!({}),
            snapshot: json!({"marks": [], "legend": []}),
            read: Read::default(),
            dirty: Dirty::default(),
            stamped: BTreeSet::new(),
            store: None,
            image_store: None,
            images: HashMap::new(),
            placed: HashMap::new(),
            live: false,
            levels: HashMap::new(),
            drawn_keys: HashSet::new(),
            drawn_bytes: 0,
            frame_no: 0,
            cull: Vec::new(),
            culled: HashMap::new(),
            out: Vec::new(),
            settling: false,
            frame_levels: BTreeMap::new(),
            started: deep_images::Started::default(),
            resampled: HashMap::new(),
            resamples: 0,
            plant: crate::asset::Plant::None,
            compiled: None,
            last_layers: BTreeMap::new(),
            texts: Map::new(),
            players: BTreeMap::new(),
            video_until: None,
            hash_next: true,
            run_start: None,
        }
    }

    /// The document opened, then held on screen for `seconds` of the real clock: the frame clock
    /// sleeps until the presented frame's `valid_until` or the time a bound value on screen goes
    /// stale, and wakes for nothing else. What the process spent meanwhile is read from the
    /// kernel: its wakeups and its CPU, every thread's. A wakeup is a package-idle wakeup, the CPU
    /// woken from idle for this process (Activity Monitor's Idle Wake Ups). Interrupt wakeups are
    /// reported beside them as a reading: a process that has drawn with Metal takes about 22 a
    /// minute from the driver, whatever it does after, so no frame clock can hold those to 1.
    #[allow(clippy::too_many_arguments)]
    fn idle(
        &mut self,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        mut record: Record,
        seconds: u64,
        arms_each_vsync: bool,
        region: Option<([f64; 4], bool)>,
        (store, pans): (Option<PathBuf>, Vec<(f64, [f64; 4])>),
    ) -> Value {
        let mut session = Self::new_session();
        session.region = region;
        session.store = store;
        session.live = true;
        let none = crate::asset::Plant::None;
        crate::asset::images().configure(deep_images::BUDGET, deep_images::ENTRIES, none);
        // The window is the region's size.
        let mut sized = doc.clone();
        if let Some(([.., w, h], _)) = region {
            sized.insert("size".into(), json!([w, h]));
        }
        let doc = &sized;
        let opening = region.map_or_else(
            || {
                let s = doc.get("size").and_then(Value::as_array);
                let n = |k: usize| s.and_then(|s| s.get(k)?.as_f64()).unwrap_or(0.0);
                [0.0, 0.0, n(0), n(1)]
            },
            |(r, _)| r,
        );
        let result = (|| -> Result<Value, Value> {
            compile(&mut session, doc)?;
            let pinned_at_0 = record.pinned;
            self.present(&mut session, doc, look, view, &record, 0, false, false)?;
            settled();
            let before = usage();
            let start = Instant::now();
            session.run_start = Some(start);
            let end = start + Duration::from_secs(seconds);
            let vsync = Duration::from_nanos(1_000_000_000 / 60);
            // 705,600,000 flicks a second.
            let at =
                |flicks: i64| start + Duration::from_nanos((flicks.max(0) as u64) * 10_000 / 7056);
            // #499: frames logged into room made before the run, so logging allocates nothing.
            let mut drawn: Vec<(u64, f64, u64)> = Vec::with_capacity(seconds as usize * 256 + 64);
            // Each view: its rect, from, to, frames, and the wakeups at its start.
            let mut views: Vec<([f64; 4], f64, f64, u64, u64)> =
                vec![(opening, 0.0, 0.0, 0, before.wakeups)];
            let mut pan = 0;
            let mut frame = 1u64;
            loop {
                let now = Instant::now();
                let doc_next = if arms_each_vsync {
                    Some(now + vsync)
                } else {
                    [session.valid_until, session.stale_at]
                        .into_iter()
                        .flatten()
                        .min()
                        .map(at)
                };
                let video_next = session.video_until.map(at);
                let pan_next = pans
                    .get(pan)
                    .map(|p| start + Duration::from_nanos((p.0.max(0.0) * 1e6) as u64));
                // #1486: while a picture on screen is short of its level, the next vsync draws
                // what has arrived.
                let settle_next = session.settling.then(|| now + vsync);
                let wake = [doc_next, video_next, pan_next, settle_next]
                    .into_iter()
                    .flatten()
                    .min()
                    .map_or(end, |n| n.min(end));
                if let Some(wait) = wake.checked_duration_since(now) {
                    std::thread::sleep(wait);
                }
                let elapsed = start.elapsed();
                if Instant::now() >= end {
                    break;
                }
                let at_ms = elapsed.as_secs_f64() * 1000.0;
                let t = (elapsed.as_nanos() * 7056 / 10_000) as i64;
                record.pinned = pinned_at_0 + t;
                let allocs_before = crate::ALLOCATIONS.load(std::sync::atomic::Ordering::Relaxed);
                let panned = pans.get(pan).filter(|p| at_ms >= p.0).map(|p| p.1);
                if let Some(rect) = panned {
                    // Your pan: the window shows the new region from this frame on.
                    pan += 1;
                    session.region = Some((rect, false));
                    session.hash_next = true;
                    self.present(&mut session, doc, look, view, &record, t, false, true)?;
                } else if doc_next.is_some_and(|n| n <= Instant::now()) || session.settling {
                    self.present(&mut session, doc, look, view, &record, t, false, true)?;
                } else if session.video_until.is_some_and(|v| v <= t) {
                    self.video_tick(&mut session, doc, t)?;
                } else {
                    continue;
                }
                let allocs =
                    crate::ALLOCATIONS.load(std::sync::atomic::Ordering::Relaxed) - allocs_before;
                frame += 1;
                if drawn.len() < drawn.capacity() {
                    drawn.push((frame, at_ms, allocs));
                }
                match panned {
                    Some(rect) => {
                        let wakeups = usage().wakeups;
                        if let Some(v) = views.last_mut() {
                            v.2 = at_ms;
                            v.4 = wakeups - v.4;
                        }
                        views.push((rect, at_ms, 0.0, 0, wakeups));
                    }
                    None => {
                        if let Some(v) = views.last_mut() {
                            v.3 += 1;
                        }
                    }
                }
            }
            let seconds = start.elapsed().as_secs_f64();
            let after = usage();
            if let Some(v) = views.last_mut() {
                v.2 = seconds * 1000.0;
                v.4 = after.wakeups - v.4;
            }
            let cpu_ms = (after.cpu_ns - before.cpu_ns) as f64 / 1e6;
            let players: Map<String, Value> = session
                .players
                .iter()
                .map(|(id, p)| {
                    let shown: Vec<Value> = p.log.shown.iter().map(|s| {
                        json!({"at_ms": s.at_ms, "t": s.t, "frame": s.frame, "planes": s.planes})
                    }).collect();
                    let decodes: Vec<Value> = p
                        .log
                        .decodes
                        .iter()
                        .map(|(at_ms, k)| json!({"at_ms": at_ms, "frame": k}))
                        .collect();
                    (id.clone(), json!({"shown": shown, "decodes": decodes}))
                })
                .collect();
            let views: Vec<Value> = views
                .iter()
                .map(|(rect, from, to, frames, wakeups)| {
                    json!({"rect": rect, "from_ms": from, "to_ms": to, "frames": frames, "wakeups": wakeups})
                })
                .collect();
            let drawn: Vec<Value> = drawn
                .iter()
                .map(|(frame, at_ms, allocs)| json!({"frame": frame, "at_ms": at_ms, "allocs": allocs}))
                .collect();
            Ok(json!({
                "ok": true, "opened_frames": 1, "seconds": seconds, "frames": drawn.len(),
                "drawn": drawn, "wakeups": after.wakeups - before.wakeups,
                "interrupt_wakeups": after.interrupts - before.interrupts, "cpu_ms": cpu_ms,
                "cpu_fraction": cpu_ms / (seconds * 1000.0),
                // A reading only; 0 when the counter reads zero.
                "energy": { "counter": ENERGY_COUNTER, "nj": after.energy_nj.saturating_sub(before.energy_nj) },
                "players": players, "views": views,
            }))
        })();
        self.close(session);
        result.unwrap_or_else(|refusal| refusal)
    }

    /// #1486: a document's live view on the real clock at 60 Hz, every frame a full redraw that
    /// asks the image service for each image in view: opened until its first screen settles, moved
    /// a frame per move, settled until nothing is short or pending, and redrawn; each frame's
    /// times, UI-thread CPU, levels, the service's stats at its start and the service's
    /// allocations, then every job the service's workers started.
    fn live(&mut self, run: crate::Live) -> Value {
        let images = crate::asset::images();
        let class = deep_canvas::budget::of(&Value::Object(run.doc.clone()))
            .map_or(deep_images::BUDGET, |(_, l)| {
                l.gpu_bytes.min(deep_images::BUDGET)
            });
        images.configure(run.budget.unwrap_or(class), deep_images::ENTRIES, run.plant);
        let [_, _, w, h] = run.rect;
        let mut session = Self::new_session();
        session.region = Some((run.rect, false));
        session.store = run.store.clone();
        session.live = true;
        // The window is the view's size.
        let mut sized = run.doc.clone();
        sized.insert("size".into(), json!([w, h]));
        let doc = &sized;
        let result = (|| -> Result<Value, Value> {
            compile(&mut session, doc)?;
            // The window opens before frame 0.
            if !self.surfaces(&mut session, [w, h], run.view.zoom) {
                return Err(refused("no_window", ""));
            }
            let base = images.frame() + 1;
            let start = Instant::now();
            let ms = |at: Instant| at.duration_since(start).as_secs_f64() * 1000.0;
            let period = Duration::from_nanos(1_000_000_000 / 60);
            let record = Record::default();
            let mut frames: Vec<Value> = Vec::new();
            // Each frame's start: the UI thread's CPU, ms, and the service's allocations.
            let mut marks: Vec<(f64, u64)> = Vec::new();
            let mut next = start;
            let mut draw = |me: &mut Self,
                            session: &mut Session,
                            (phase, index): (usize, u32),
                            (rect, t): ([f64; 4], i64)|
             -> Result<(bool, u64), Value> {
                // Frames start on the 60 Hz grid: a frame still running at a vsync starts the
                // next one at the following vsync.
                let now = Instant::now();
                if next > now {
                    std::thread::sleep(next - now);
                }
                let at = Instant::now();
                marks.push((thread_cpu_ms(), service_allocations()));
                session.region = Some((rect, false));
                let mut record = record.clone();
                record.pinned = t;
                let k = frames.len();
                me.present(session, doc, &run.look, run.view, &record, t, false, k > 0)?;
                let done = Instant::now();
                let n = (done.duration_since(start).as_nanos() / period.as_nanos()) + 1;
                next = start + period * n as u32;
                for shot in &run.shots[phase] {
                    match shot {
                        crate::Shot::Every(dir) => {
                            let _ = std::fs::create_dir_all(dir);
                            me.capture(
                                session,
                                &dir.join(format!("{k}.png")).display().to_string(),
                            )?
                        }
                        crate::Shot::One(Some(i), out) if *i == index => {
                            me.capture(session, out)?
                        }
                        _ => {}
                    }
                }
                let levels: Map<String, Value> = (session.frame_levels.iter())
                    .map(|(id, (asked, drawn))| {
                        (id.clone(), json!({"asked": asked, "drawn": drawn}))
                    })
                    .collect();
                let settling = (session.frame_levels.values()).any(|(a, d)| *d != Some(*a));
                let started = session.started;
                let s = started.stats;
                frames.push(json!({
                    "frame": k, "phase": crate::PHASES[phase], "at_ms": ms(at), "done_ms": ms(done),
                    "rect": rect, "levels": levels, "settling": settling,
                    "stats": stats_json(&s), "drawn_bytes": started.drawn_bytes,
                }));
                Ok((settling, s.pending))
            };
            // The last frame of a phase is written once the phase knows it was its last.
            let last = |me: &mut Self, session: &Session, phase: usize| -> Result<(), Value> {
                for shot in &run.shots[phase] {
                    if let crate::Shot::One(None, out) = shot {
                        me.capture(session, out)?;
                    }
                }
                Ok(())
            };
            let rect0 = run.rect;
            let mut i = 0;
            loop {
                let (settling, _) = draw(self, &mut session, (0, i), (rect0, 0))?;
                i += 1;
                if !settling || ms(Instant::now()) >= run.settle_ms {
                    break;
                }
            }
            last(self, &session, 0)?;
            let mut view = (rect0, 0);
            for (i, (at, t)) in run.moves.iter().enumerate() {
                view = ([at[0], at[1], w, h], *t);
                draw(self, &mut session, (1, i as u32), view)?;
            }
            if !run.moves.is_empty() {
                last(self, &session, 1)?;
            }
            let settle_start = Instant::now();
            let mut i = 0;
            loop {
                let (settling, pending) = draw(self, &mut session, (2, i), view)?;
                i += 1;
                if (!settling && pending == 0)
                    || settle_start.elapsed().as_secs_f64() * 1000.0 >= run.settle_ms
                {
                    break;
                }
            }
            last(self, &session, 2)?;
            for i in 0..run.redraws {
                draw(self, &mut session, (3, i), view)?;
            }
            if run.redraws > 0 {
                last(self, &session, 3)?;
            }
            marks.push((thread_cpu_ms(), service_allocations()));
            images.drain();
            for (k, f) in frames.iter_mut().enumerate() {
                f["ui_ms"] = json!(marks[k + 1].0 - marks[k].0);
                f["allocations"] = json!(marks[k + 1].1 - marks[k].1);
            }
            let count = frames.len() as u64;
            let jobs: Vec<Value> = (images.jobs().into_iter())
                .filter(|j| j.frame >= base)
                .map(|j| {
                    let asset: String = j.key.hash.iter().map(|b| format!("{b:02x}")).collect();
                    json!({"asset": asset, "level": j.key.level, "kind": j.op,
                           "frame": (j.frame - base).min(count.saturating_sub(1))})
                })
                .collect();
            Ok(
                json!({"ok": true, "frames": frames, "jobs": jobs, "stats": stats_json(&images.stats())}),
            )
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
        (store, image_plant): (Option<PathBuf>, crate::asset::Plant),
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        session.plant = image_plant;
        // The image service runs the request's wrong program too (#1485).
        crate::asset::images().configure(deep_images::BUDGET, deep_images::ENTRIES, image_plant);
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
                // Everything the vsync cost on the GPU, a layer picture it made included, and the
                // images it read, decoded and uploaded (#1485).
                let before = settled();
                let counted = image_counts(&self.vello);
                if armed {
                    self.present(&mut session, doc, look, view, &record, t, false, k > 0)?;
                }
                let after = settled();
                let now = image_counts(&self.vello);
                let [reads, decodes, uploads] = std::array::from_fn(|i| now[i] - counted[i]);
                out.push(json!({
                    "t": t,
                    "presented": armed,
                    "command_buffers": after.committed - before.committed,
                    "gpu_ns": after.gpu_ns - before.gpu_ns,
                    "bound": session.bound,
                    "images": {"reads": reads, "decodes": decodes, "uploads": uploads},
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

    fn session(
        &mut self,
        mut look: Look,
        steps: Vec<Step>,
        store: Option<PathBuf>,
        switch_rebuilds: bool,
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let none = crate::asset::Plant::None;
        crate::asset::images().configure(deep_images::BUDGET, deep_images::ENTRIES, none);
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
                if let Some(l) = step.look {
                    look = l;
                    // The wrong program: a switch that empties every node cache.
                    if switch_rebuilds {
                        session.tessellations.clear();
                        session.shaped.clear();
                    }
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
                        self.present(&mut session, &doc, &look, view, &record, t, false, f > 0)?;
                    }
                }
                let built = std::mem::take(&mut session.built).to_json();
                let dirty: Vec<Value> = std::mem::take(&mut session.stamped)
                    .into_iter()
                    .map(|(item, class)| json!({"item": item, "class": class.name()}))
                    .collect();
                out.push(json!({
                    "caches": session.read.to_json(),
                    "built": {"tessellation": built["tessellation"], "text": built["text"]},
                    "rebuild_key": session.rebuild_key.map(|k| k.hex()),
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
        (gpui_oklab, drops_glyph): (bool, bool),
        (store, image_plant): (Option<PathBuf>, crate::asset::Plant),
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        session.plant = image_plant;
        // The image service runs the request's wrong program too (#1485).
        crate::asset::images().configure(deep_images::BUDGET, deep_images::ENTRIES, image_plant);
        record.pinned = t;
        // #1479: the frame report counts the glyphs the atlas rasterized and those drawn from its
        // largest raster for want of an outline, prepaint included.
        let before = (deep_text_gpui::rasterized(), deep_text_gpui::from_largest());
        let result = compile(&mut session, doc).and_then(|()| {
            self.present(&mut session, doc, look, view, &record, t, gpui_oklab, false)
        });
        if let (Ok(_), true, Some(main)) = (&result, drops_glyph, session.main.as_ref()) {
            // #1479 AC1's wrong program: each text's second grapheme drawn clear, so it vanishes
            // with no word, as a glyph past the atlas's limit once did.
            for (draw, _) in main.draws.borrow_mut().iter_mut() {
                if let Draw::Text { runs, .. } = draw {
                    runs.insert(0, (1..2, Hsla::transparent_black()));
                }
            }
            self.cx.present_frame(main.handle);
        }
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
                            "rasterized": deep_text_gpui::rasterized() - before.0,
                            "from_largest": deep_text_gpui::from_largest() - before.1,
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

/// The UI thread's CPU time, ms (its thread clock).
fn thread_cpu_ms() -> f64 {
    // SAFETY: a zeroed timespec for clock_gettime to fill.
    let mut t: libc::timespec = unsafe { std::mem::zeroed() };
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as f64 * 1e3 + t.tv_nsec as f64 / 1e6
}

/// The allocations the image service has made so far (#1486 AC3).
fn service_allocations() -> u64 {
    crate::SERVICE_ALLOCATIONS.load(std::sync::atomic::Ordering::Relaxed)
}

/// The image service's stats as `live` reports them.
fn stats_json(s: &deep_images::Stats) -> Value {
    json!({
        "bytes": s.bytes, "budget": s.budget, "entries": s.entries, "pending": s.pending,
        "decoded": s.decoded, "failed": s.failed, "cancelled": s.cancelled, "evicted": s.evicted,
        "decode_ms": s.decode_ms,
    })
}

/// #499: whether a video item's box, at its place, meets `rect`: exactly for an item that isn't
/// turned, else #1487's bound (a circle holding the box turned about its origin).
fn in_view(item: &Value, rect: [f64; 4]) -> bool {
    let n = |p: &str| item.pointer(p).and_then(Value::as_f64);
    let turned = n("/at/rot")
        .or_else(|| n("/at/rot/2"))
        .is_some_and(|r| r != 0.0);
    let (Some(x), Some(y), Some(w), Some(h)) = (
        n("/params/box/0"),
        n("/params/box/1"),
        n("/params/box/2"),
        n("/params/box/3"),
    ) else {
        return true;
    };
    if turned {
        return deep_canvas_motion::clock::meets(item, &rect);
    }
    let (px, py) = (n("/at/pos/0").unwrap_or(0.0), n("/at/pos/1").unwrap_or(0.0));
    let (sx, sy) = (
        n("/at/scale/0").unwrap_or(1.0),
        n("/at/scale/1").unwrap_or(1.0),
    );
    let (x0, x1) = (
        px + (x * sx).min((x + w) * sx),
        px + (x * sx).max((x + w) * sx),
    );
    let (y0, y1) = (
        py + (y * sy).min((y + h) * sy),
        py + (y * sy).max((y + h) * sy),
    );
    x1 > rect[0] && x0 < rect[0] + rect[2] && y1 > rect[1] && y0 < rect[1] + rect[3]
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
