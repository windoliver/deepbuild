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
use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::path::{self, Mesh};
use deep_canvas_marks::scene::{
    self, Align, Drawn, Fill, ImageFit, Mark, Record, Rgb, Slot, StatusMark,
};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State};
use deep_text::Role;
use deep_text_gpui::Label;
use gpui_apple::metal_renderer::gpu_ledger::{self, Ledger};
use gpui_kit::test::TestWindowExt;
use gpui_kit::*;
use serde_json::{json, Map, Value};

use crate::{palette_of, refused, Request, Step, Theme, View};

/// Frames a writer layer stays the same before it is cached (Invalidation and damage).
const STABLE_FRAMES: u32 = 3;
/// One vsync of a session's steps: 60 Hz in flicks.
const STEP_VSYNC: i64 = 705_600_000 / 60;
/// A status mark's label: the glyph and word, in the body face at this size and weight.
const STATUS_LABEL: (f32, u16) = (12., 600);
/// A stroke's or a badge's chip: its glyph's size and weight, and the chip's height in u.
const STATUS_CHIP: (f32, u16) = (11., 600);
const CHIP_HEIGHT: f64 = 16.;
/// The legend's rows, its swatch and its margin from the frame's top right, in u.
const LEGEND_ROW: f64 = 20.;
const LEGEND_SWATCH: f64 = 12.;
const LEGEND_MARGIN: f64 = 16.;

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
    Text {
        label: Label,
        origin: Point<Pixels>,
        color: Hsla,
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
        } => {
            let at = |p: [f32; 2]| point(px(p[0] + offset[0]), px(p[1] + offset[1]));
            let mut triangles = mesh.triangles();
            let Some(first) = triangles.next() else {
                return;
            };
            let solid = (point(0., 1.), point(0., 1.), point(0., 1.));
            let mut path = Path::new(at(first[0]));
            path.push_triangle((at(first[0]), at(first[1]), at(first[2])), solid);
            for t in triangles {
                path.push_triangle((at(t[0]), at(t[1]), at(t[2])), solid);
            }
            window.paint_path(path, *color);
        }
        Draw::Text {
            label,
            origin,
            color,
        } => {
            deep_text_gpui::paint_label(view.origin + *origin, label, *color, window);
        }
    }
}

impl Render for Canvas {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let prepared = self.draws.clone();
        let draws = self.draws.clone();
        div().size_full().child(
            canvas(
                // Every label's glyphs placed before the first paint: a page goes up once.
                move |_, window, _| {
                    for (draw, _) in prepared.borrow().iter() {
                        if let Draw::Text { label, .. } = draw {
                            deep_text_gpui::prepare(label, window.scale_factor());
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

struct Tessellation {
    mesh: Arc<Mesh>,
    entry: Entry,
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
    let crop_bits = crop.map_or([u64::MAX; 4], |c| c.map(f64::to_bits));
    let key = (asset.to_string(), crop_bits, opacity.to_bits());
    if let Some(found) = session.images.get(&key) {
        return Ok(found.clone());
    }
    let path = format!("items/{item}/params/asset");
    let Some(store) = &session.store else {
        return Err(refused("asset_missing", &format!("{path}: {asset}")));
    };
    let bytes = std::fs::read(store.join(asset))
        .map_err(|_| refused("asset_missing", &format!("{path}: {asset}")))?;
    if sha256_hex(&bytes) != asset {
        return Err(refused("asset_mismatch", &format!("{path}: {asset}")));
    }
    let decoded =
        image::load_from_memory(&bytes).map_err(|_| refused("asset_undecodable", &path))?;
    let mut rgba = decoded.to_rgba8();
    if let Some([x, y, w, h]) = crop {
        let (iw, ih) = rgba.dimensions();
        let (x, y) = (x.max(0.0) as u32, y.max(0.0) as u32);
        let (w, h) = (
            (w.max(1.0) as u32).min(iw.saturating_sub(x)),
            (h.max(1.0) as u32).min(ih.saturating_sub(y)),
        );
        if w == 0 || h == 0 {
            return Err(refused(
                "out_of_range",
                &format!("items/{item}/params/crop"),
            ));
        }
        rgba = image::imageops::crop_imm(&rgba, x, y, w, h).to_image();
    }
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

/// Compiles a revision once, so its frames only evaluate.
fn compile(session: &mut Session, doc: &Map<String, Value>) -> Result<(), Value> {
    let program =
        Program::compile(&Value::Object(doc.clone())).map_err(|r| refused(r.code, &r.path))?;
    let state = program.state();
    session.compiled = Some((program, state));
    Ok(())
}

/// Where an image of `size` pixels maps for its box and fit, centered in the box.
fn fitted(bounds: [f64; 4], size: [u32; 2], fit: ImageFit) -> [f64; 4] {
    let [x, y, w, h] = bounds;
    let (iw, ih) = (f64::from(size[0]), f64::from(size[1]));
    let (sx, sy) = match fit {
        ImageFit::Fill => (w / iw, h / ih),
        ImageFit::Contain => {
            let s = (w / iw).min(h / ih);
            (s, s)
        }
        ImageFit::Cover => {
            let s = (w / iw).max(h / ih);
            (s, s)
        }
        ImageFit::None => (1.0, 1.0),
    };
    let (dw, dh) = (iw * sx, ih * sy);
    [x + (w - dw) / 2.0, y + (h - dh) / 2.0, dw, dh]
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
    used: &mut Vec<(ContentKey, i32)>,
) -> &'a Tessellation {
    let key = geometry.key(d, bucket);
    used.push((key, bucket));
    session
        .tessellations
        .entry((key, bucket))
        .or_insert_with(|| {
            let mesh = geometry.tessellate(bucket);
            let entry = Entry::of(key, &mesh.bytes());
            Tessellation {
                mesh: Arc::new(mesh),
                entry,
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

fn label_of(spec: &scene::TextSpec) -> Option<Label> {
    Some(Label {
        role: Role::parse(&spec.font)?,
        size: spec.size as f32,
        weight: spec.weight,
        width: spec.width.map(|w| w as f32),
        bound: spec.bound,
        align: match spec.align {
            Align::Start => deep_text::Align::Start,
            Align::Center => deep_text::Align::Center,
            Align::End => deep_text::Align::End,
        },
        ..Label::new(spec.text.clone())
    })
}

fn color_space(gpui_oklab: bool) -> ColorSpace {
    if gpui_oklab {
        ColorSpace::Oklab
    } else {
        ColorSpace::OklabExact
    }
}

impl Renderer {
    pub fn new() -> Self {
        Renderer {
            cx: deep_replica::headless_context(),
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

    /// The draws for marks, with each path's tessellation from the cache.
    fn draws(
        session: &mut Session,
        marks: &[&Drawn],
        bucket: i32,
        gpui_oklab: bool,
        used: &mut Vec<(ContentKey, i32)>,
    ) -> Result<Vec<Placed>, Value> {
        let mut out: Vec<Placed> = Vec::with_capacity(marks.len());
        for drawn in marks {
            let clip = drawn.clip.map(rect);
            let mut push = |d: Draw| out.push((d, clip));
            match &drawn.mark {
                Mark::Rect {
                    bounds,
                    radius,
                    fill,
                    ..
                } => {
                    let background: Background = match fill {
                        Fill::Solid(c) => hsla(*c).into(),
                        Fill::Linear { from, to, at } => linear_gradient(
                            90.,
                            linear_color_stop(hsla(*from), at[0] as f32),
                            linear_color_stop(hsla(*to), at[1] as f32),
                        )
                        .color_space(color_space(gpui_oklab)),
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
                    push(Draw::Path {
                        mesh: t.mesh.clone(),
                        offset: [offset[0] as f32, offset[1] as f32],
                        color: hsla(*color),
                    });
                }
                Mark::Text {
                    item,
                    spec,
                    origin,
                    color,
                } => {
                    let Some(label) = label_of(spec) else {
                        return Err(refused("bad_font", &format!("items/{item}/params/font")));
                    };
                    push(Draw::Text {
                        label,
                        origin: point(px(origin[0] as f32), px(origin[1] as f32)),
                        color: hsla(*color),
                    });
                }
                Mark::Image {
                    item,
                    asset,
                    bounds,
                    fit,
                    crop,
                    opacity,
                } => {
                    let (image, size) = image_of(session, asset, *crop, *opacity, item)?;
                    push(Draw::Picture {
                        image,
                        bounds: Some(rect(*bounds)),
                        image_bounds: Some(rect(fitted(*bounds, size, *fit))),
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

        let mut used = Vec::new();
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
                let marks: Vec<&Drawn> = frame.layers[..=top]
                    .iter()
                    .flat_map(|l| l.marks.iter())
                    .collect();
                let mut list: Vec<Placed> = vec![(Draw::Quad(ground.clone()), None)];
                list.extend(Self::draws(session, &marks, bucket, gpui_oklab, &mut used)?);
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
        let live: Vec<&Drawn> = frame.layers[first_live..]
            .iter()
            .flat_map(|l| l.marks.iter())
            .collect();
        list.extend(Self::draws(session, &live, bucket, gpui_oklab, &mut used)?);
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
            compiled: None,
            last_layers: BTreeMap::new(),
        }
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
                out.push(json!({"caches": session.read.to_json(), "dirty": dirty}));
            }
            Ok(())
        })();
        self.close(session);
        match result {
            Ok(()) => json!({"ok": true, "steps": out}),
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

/// A label in the body face that sizes to its text.
fn status_label(text: String, (size, weight): (f32, u16)) -> Label {
    Label {
        size,
        weight,
        ..Label::new(text)
    }
}

/// A box in u as pixels of the frame at `zoom`.
fn px_box(b: [f64; 4], zoom: f64) -> Value {
    json!(b.map(|v| v * zoom))
}

/// Appends the status marks, their labels and the legend to `list`, over everything drawn, and
/// returns the text snapshot of what they show: each mark's state, color, glyph or word and their
/// boxes, and each legend entry, in pixels of the frame.
fn status_draws(
    status: &[StatusMark],
    occupied: &[[f64; 4]],
    palette: &scene::Palette,
    size: [f64; 2],
    zoom: f64,
    list: &mut Vec<Placed>,
) -> Value {
    let mut marks = Vec::with_capacity(status.len());
    // The marks draw after the legend, so nothing covers them; their boxes keep the legend clear.
    let mut taken: Vec<[f64; 4]> = occupied.to_vec();
    let mut mark_draws: Vec<Placed> = Vec::new();
    for m in status {
        let [x, y, w, h] = m.bounds;
        // The colored core: the item's own box for a fill, a ring of `core` px around it for a
        // stroke, and for a stroke or a badge a chip at the top right corner carrying the glyph.
        let mut word = None;
        let (core, label, chip) = match m.slot {
            Slot::Fill => {
                // The glyph and the word inside the mark; the glyph alone where both don't fit.
                word = Some(m.word);
                let mut label = status_label(format!("{} {}", m.glyph, m.word), STATUS_LABEL);
                if f64::from(deep_text_gpui::measure(&label).width) > w - 8.0 {
                    word = None;
                    label = status_label(m.glyph.clone(), STATUS_LABEL);
                }
                (m.bounds, label, None)
            }
            Slot::Stroke | Slot::Badge => {
                let ring = match m.slot {
                    Slot::Stroke => [x - m.core, y - m.core, w + 2.0 * m.core, h + 2.0 * m.core],
                    _ => m.bounds,
                };
                let label = status_label(m.glyph.clone(), STATUS_CHIP);
                let gw = f64::from(deep_text_gpui::measure(&label).width);
                let ch = CHIP_HEIGHT.max(m.core);
                let cw = ch.max(gw + 8.0);
                let chip = [ring[0] + ring[2] - cw / 2.0, ring[1] - ch / 2.0, cw, ch];
                (ring, label, Some(chip))
            }
        };
        let outline = |list: &mut Vec<Placed>, b: [f64; 4], r: f64| {
            if let Some((px_w, color)) = m.outline {
                let o = [
                    b[0] - px_w,
                    b[1] - px_w,
                    b[2] + 2.0 * px_w,
                    b[3] + 2.0 * px_w,
                ];
                list.push((Draw::Quad(ring_quad(o, r + px_w, px_w, color)), None));
            }
        };
        if m.slot == Slot::Stroke {
            outline(&mut mark_draws, core, m.radius + m.core);
            mark_draws.push((
                Draw::Quad(ring_quad(core, m.radius + m.core, m.core, m.color)),
                None,
            ));
        } else if m.slot == Slot::Fill {
            outline(&mut mark_draws, core, m.radius);
            mark_draws.push((
                Draw::Quad(fill_quad(rect(core), hsla(m.color)).corner_radii(px(m.radius as f32))),
                None,
            ));
        }
        let host = match chip {
            Some(c) => {
                outline(&mut mark_draws, c, c[3] / 2.0);
                mark_draws.push((
                    Draw::Quad(
                        fill_quad(rect(c), hsla(m.color)).corner_radii(px((c[3] / 2.0) as f32)),
                    ),
                    None,
                ));
                c
            }
            None => core,
        };
        let fits = deep_text_gpui::measure(&label);
        let (tw, th) = (f64::from(fits.width), f64::from(fits.height));
        let origin = [
            (host[0] + (host[2] - tw) / 2.0).round(),
            (host[1] + (host[3] - th) / 2.0).round(),
        ];
        mark_draws.push((
            Draw::Text {
                label,
                origin: point(px(origin[0] as f32), px(origin[1] as f32)),
                color: hsla(m.ink),
            },
            None,
        ));
        taken.push(core);
        taken.extend(chip);
        marks.push(json!({
            "item": m.item, "binding": m.binding, "slot": m.slot.name(), "state": m.state,
            "color": m.color, "bounds": px_box(core, zoom), "chip": chip.map(|c| px_box(c, zoom)),
            "glyph": m.glyph, "word": word, "label": px_box([origin[0], origin[1], tw, th], zoom),
        }));
    }
    // The legend: every state on screen, in the status map's order.
    let mut legend = Vec::new();
    let on_screen: Vec<&StatusMark> = look::STATES
        .iter()
        .filter_map(|s| status.iter().find(|m| m.state == *s))
        .collect();
    let ink = palette.get("ink").copied().unwrap_or([0, 0, 0]);
    let labels: Vec<Label> = on_screen
        .iter()
        .map(|m| status_label(format!("{} {}", m.glyph, m.word), (12., 400)))
        .collect();
    let widest = labels
        .iter()
        .map(|l| f64::from(deep_text_gpui::measure(l).width))
        .fold(0.0, f64::max);
    // The first corner, top right first, whose box clears every item and status mark; else the
    // first that clears every status mark; else the top right.
    let (lw, lh) = (
        widest + LEGEND_SWATCH + 6.0,
        LEGEND_ROW * on_screen.len() as f64,
    );
    let (right, bottom) = (size[0] - LEGEND_MARGIN - lw, size[1] - LEGEND_MARGIN - lh);
    let corners = [
        [right, LEGEND_MARGIN],
        [right, bottom],
        [LEGEND_MARGIN, bottom],
        [LEGEND_MARGIN, LEGEND_MARGIN],
    ];
    let clear = |c: &[f64; 2], boxes: &[[f64; 4]]| {
        !boxes.iter().any(|b| {
            c[0] < b[0] + b[2] && b[0] < c[0] + lw && c[1] < b[1] + b[3] && b[1] < c[1] + lh
        })
    };
    let marks_only = &taken[occupied.len()..];
    let [x0, y0] = corners
        .iter()
        .find(|c| clear(c, &taken))
        .or_else(|| corners.iter().find(|c| clear(c, marks_only)))
        .copied()
        .unwrap_or(corners[0]);
    for (k, (m, label)) in on_screen.iter().zip(labels).enumerate() {
        let top = y0 + LEGEND_ROW * k as f64;
        let swatch = [
            x0,
            top + (LEGEND_ROW - LEGEND_SWATCH) / 2.0,
            LEGEND_SWATCH,
            LEGEND_SWATCH,
        ];
        list.push((Draw::Quad(fill_quad(rect(swatch), hsla(m.color))), None));
        let th = f64::from(deep_text_gpui::measure(&label).height);
        let origin = point(
            px((x0 + LEGEND_SWATCH + 6.0) as f32),
            px((top + (LEGEND_ROW - th) / 2.0).round() as f32),
        );
        list.push((
            Draw::Text {
                label,
                origin,
                color: hsla(ink),
            },
            None,
        ));
        legend.push(json!({
            "state": m.state, "glyph": m.glyph, "word": m.word, "color": m.color,
            "swatch": px_box(swatch, zoom),
        }));
    }
    list.extend(mark_draws);
    json!({"marks": marks, "legend": legend})
}

/// The box of every mark a frame draws that a legend would cover: rects, circles, images and
/// texts (their box's width, or their run's, and their run's height), in u.
fn occupied(frame: &scene::Frame) -> Vec<[f64; 4]> {
    frame
        .layers
        .iter()
        .flat_map(|l| l.marks.iter())
        .filter_map(|d| match &d.mark {
            Mark::Rect { bounds, .. } | Mark::Image { bounds, .. } => Some(*bounds),
            Mark::Circle { center, r, .. } => {
                Some([center[0] - r, center[1] - r, 2.0 * r, 2.0 * r])
            }
            Mark::Text { spec, origin, .. } => {
                let size = deep_text_gpui::measure(&label_of(spec)?);
                let w = spec.width.unwrap_or(f64::from(size.width));
                Some([origin[0], origin[1], w, f64::from(size.height)])
            }
            Mark::Path { .. } => None,
        })
        .collect()
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
