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

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas_marks::dirty::{Class, Dirty};
use deep_canvas_marks::key::{sha256_hex, ContentKey, KeyBuilder};
use deep_canvas_marks::path::{self, Mesh};
use deep_canvas_marks::scene::{self, Align, Drawn, Fill, ImageFit, Mark, Rgb};
use deep_canvas_motion::{doc as motion_doc, eval};
use deep_text::Role;
use deep_text_gpui::Label;
use gpui_apple::metal_renderer::gpu_ledger::{self, Ledger};
use gpui_kit::test::TestWindowExt;
use gpui_kit::*;
use serde_json::{json, Map, Value};

use crate::{refused, Look, Request, Step, Theme, View};

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
    read: Read,
    dirty: Dirty,
    /// Each item's layer on the last presented frame, for one that was deleted since.
    last_layers: BTreeMap<String, String>,
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
    for px in bgra.chunks_exact_mut(4) {
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
                readings,
                hz,
                vsyncs,
                store,
            } => self.frames(&doc, &look, view, &readings, hz, vsyncs, store),
            Request::Session { look, steps, store } => self.session(&look, steps, store),
            Request::Render {
                out,
                doc,
                look,
                view,
                t,
                gpui_oklab,
                store,
            } => self.render(&out, &doc, &look, view, t, gpui_oklab, store),
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
        readings: &BTreeMap<String, f64>,
        t: i64,
        gpui_oklab: bool,
        by_clock: bool,
    ) -> Result<(), Value> {
        let doc_value = Value::Object(doc.clone());
        let motion = motion_doc::read(&doc_value).map_err(|r| refused(r.code, &r.path))?;
        let evaluated = eval::frame(doc, &motion, t, eval::Validity::Full);
        let palette = look.palette(view.theme);
        let frame = scene::frame(doc, &evaluated.items, palette, readings, view.zoom)
            .map_err(|r| refused(r.code, &r.path))?;
        let shown = scene::bound_texts(doc, &evaluated.items, readings)
            .map_err(|r| refused(r.code, &r.path))?;
        let changes = session.dirty.advance(&evaluated.items, &shown, by_clock);
        // The layers an item changed in, this frame: a mark's item is its own ID before any `#`.
        let changed_layers: BTreeSet<String> = changes
            .iter()
            .filter_map(|(id, _)| {
                layer_of(&evaluated.items, id).or_else(|| session.last_layers.get(id).cloned())
            })
            .collect();
        session.last_layers = evaluated
            .items
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
                for px in bgra.chunks_exact_mut(4) {
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
        session.valid_until = evaluated.valid_until;
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
            read: Read::default(),
            dirty: Dirty::default(),
            stamped: BTreeSet::new(),
            store: None,
            images: HashMap::new(),
            last_layers: BTreeMap::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn frames(
        &mut self,
        doc: &Map<String, Value>,
        look: &Look,
        view: View,
        readings: &BTreeMap<String, f64>,
        hz: i64,
        vsyncs: u32,
        store: Option<PathBuf>,
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let period = 705_600_000 / hz;
        let mut out = Vec::with_capacity(vsyncs as usize);
        // The windows open before vsync 0, so their setup isn't counted.
        let result = (|| -> Result<(), Value> {
            for k in 0..i64::from(vsyncs) {
                let t = k * period;
                let armed = k == 0 || session.valid_until.is_some_and(|v| v <= t);
                // Everything the vsync cost on the GPU, a layer picture it made included.
                let before = settled();
                if armed {
                    self.present(&mut session, doc, look, view, readings, t, false, k > 0)?;
                }
                let after = settled();
                out.push(json!({
                    "t": t,
                    "presented": armed,
                    "command_buffers": after.committed - before.committed,
                    "gpu_ns": after.gpu_ns - before.gpu_ns,
                }));
            }
            Ok(())
        })();
        self.close(session);
        match result {
            Ok(()) => json!({"ok": true, "vsyncs": out}),
            Err(refusal) => refusal,
        }
    }

    fn session(&mut self, look: &Look, steps: Vec<Step>, store: Option<PathBuf>) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let mut doc = Map::new();
        let mut view = View {
            zoom: 1.0,
            theme: Theme::Light,
        };
        let mut readings = BTreeMap::new();
        let mut out = Vec::with_capacity(steps.len());
        let result = (|| -> Result<(), Value> {
            for step in steps {
                if let Some(d) = step.doc {
                    doc = d;
                }
                if let Some(v) = step.view {
                    view = v;
                }
                if let Some(r) = step.readings {
                    readings = r;
                }
                for f in 0..i64::from(step.frames) {
                    let t = step.t + f * STEP_VSYNC;
                    // A new revision, view or reading arms the step's first frame; after it the
                    // frame clock does.
                    let armed = f == 0 || session.valid_until.is_some_and(|v| v <= t);
                    if armed {
                        self.present(&mut session, &doc, look, view, &readings, t, false, f > 0)?;
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
        gpui_oklab: bool,
        store: Option<PathBuf>,
    ) -> Value {
        let mut session = Self::new_session();
        session.store = store;
        let result = self.present(
            &mut session,
            doc,
            look,
            view,
            &BTreeMap::new(),
            t,
            gpui_oklab,
            false,
        );
        let answer = match result {
            Err(refusal) => refusal,
            Ok(_) => {
                let main = session.main.as_ref().map(|m| m.handle);
                match main.map(|h| self.cx.capture_screenshot(h)) {
                    Some(Ok(image)) => match image.save(out) {
                        Ok(()) => {
                            json!({"ok": true, "width": image.width(), "height": image.height()})
                        }
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
