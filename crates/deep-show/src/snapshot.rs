//! Render-back's snapshots on the CPU (canvas primitives: Render-back: "2D snapshots render with
//! Vello CPU"): a revision evaluated at a time, drawn from the marks module's draw list at a size,
//! with the scalar SIMD level so the same bytes come out on every platform. The same raster, with
//! no ground, is a writer layer's picture in the window `screen` composes.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use deep_canvas_marks::modules::{self as modules, Run, StatusDrawing};
use deep_canvas_marks::path;
use deep_canvas_marks::scene::{self, Fill, Mark, Palette, Record, Rgb, Slot, StatusMark};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_marks_vello::{brush, image, sampler, shape, Scopes};
use deep_text::{Align, Role, Shaper, Spec};
use serde_json::json;
use serde_json::{Map, Value};
use vello_cpu::kurbo::{Affine, BezPath, Circle, Rect, RoundedRect, Shape};
use vello_cpu::peniko::{ColorStop, Fill as FillRule, Gradient, ImageSampler};
use vello_cpu::{
    color::{AlphaColor, Srgb},
    Image, ImageSource, Level, Pixmap, RenderContext, RenderSettings, Resources,
};

use crate::evidence;

/// Why a revision can't be drawn: the issue code and the path it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Unfit {
    pub code: &'static str,
    pub path: String,
}

fn unfit<T>(code: &'static str, path: impl Into<String>) -> Result<T, Unfit> {
    Err(Unfit {
        code,
        path: path.into(),
    })
}

/// A revision's draw list at one time: the marks module's frame, and the status marks with the
/// legend.
pub struct Drawn {
    pub frame: scene::Frame,
    /// The core's boxes, in a build without marks2d: `(rect, color)` in the document's units.
    pub boxes: Vec<([f64; 4], Rgb)>,
    pub status: Arc<StatusDrawing>,
    /// Each image mark's asset, decoded: an asset that isn't decoded yet can't settle a frame.
    images: BTreeMap<String, Arc<Pixmap>>,
    /// Each text's run as the text module shaped it (#387), drawn as it is when its spec is the
    /// mark's.
    runs: BTreeMap<String, Arc<Run>>,
    /// Each animated text's units as `[lift, opacity]`, one per glyph.
    animated: BTreeMap<String, Vec<[f64; 2]>>,
}

impl Drawn {
    /// Each item's box in the document's units, from its marks, in draw order.
    pub fn boxes(&self) -> Vec<(String, [f64; 4])> {
        let mut out: Vec<(String, [f64; 4])> = Vec::new();
        for drawn in self.frame.layers.iter().flat_map(|l| &l.marks) {
            let b = match &drawn.mark {
                Mark::Rect { bounds, .. } | Mark::Image { bounds, .. } => *bounds,
                Mark::Circle { center, r, .. } => [center[0] - r, center[1] - r, 2.0 * r, 2.0 * r],
                Mark::Text { spec, origin, .. } => [
                    origin[0],
                    origin[1],
                    spec.width.unwrap_or(spec.size),
                    1.3 * spec.size,
                ],
                Mark::Path { .. } | Mark::Shape { .. } => continue,
            };
            let id = drawn
                .mark
                .item()
                .split('#')
                .next()
                .unwrap_or_default()
                .to_string();
            match out.iter_mut().find(|(i, _)| *i == id) {
                Some((_, u)) => {
                    let (x0, y0) = (u[0].min(b[0]), u[1].min(b[1]));
                    let (x1, y1) = (
                        (u[0] + u[2]).max(b[0] + b[2]),
                        (u[1] + u[3]).max(b[1] + b[3]),
                    );
                    *u = [x0, y0, x1 - x0, y1 - y0];
                }
                None => out.push((id, b)),
            }
        }
        out
    }

    /// Document units to the pixels of a snapshot of `size`: the frame scaled to fit.
    pub fn scale(&self, size: [u16; 2]) -> f64 {
        let [dw, dh] = self.frame.size;
        (f64::from(size[0]) / dw).min(f64::from(size[1]) / dh)
    }
}

/// The most rows a snapshot's table of visible items holds (Render-back).
pub const VISIBLE_ROWS: usize = 200;

/// A snapshot's table of visible items: each item whose box, scaled into the snapshot's pixels,
/// covers some of it, as `{id, box: [x, y, w, h]}`, sorted by ID, at most [`VISIBLE_ROWS`].
pub fn visible(boxes: Vec<(String, [f64; 4])>, scale: f64, size: [u16; 2]) -> Value {
    let (w, h) = (f64::from(size[0]), f64::from(size[1]));
    let mut rows: Vec<(String, [f64; 4])> = boxes
        .into_iter()
        .map(|(id, b)| (id, b.map(|v| v * scale)))
        .filter(|(_, b)| b[0] < w && b[1] < h && b[0] + b[2] > 0.0 && b[1] + b[3] > 0.0)
        .collect();
    rows.sort_by(|a, b| a.0.cmp(&b.0));
    rows.truncate(VISIBLE_ROWS);
    Value::Array(
        rows.into_iter()
            .map(|(id, b)| json!({"id": id, "box": b}))
            .collect(),
    )
}

pub struct Renderer {
    shaper: Shaper,
    resources: Resources,
}

fn color(c: Rgb) -> AlphaColor<Srgb> {
    AlphaColor::from_rgba8(c[0], c[1], c[2], 255)
}

fn rect_path(b: [f64; 4], radius: f64) -> BezPath {
    let r = radius.max(0.0).min(b[2] / 2.0).min(b[3] / 2.0);
    RoundedRect::new(b[0], b[1], b[0] + b[2], b[1] + b[3], r).to_path(0.01)
}

/// One instanced batch a 2D draw made (#306): the expansion key its items share, and every item
/// it drew, sorted.
#[derive(Clone, Debug, PartialEq)]
pub struct Batch {
    pub key: String,
    pub items: Vec<String>,
}

/// The item a mark draws for: its ID, without a part after `#`.
fn item_of(mark: &Mark) -> &str {
    mark.item().split('#').next().unwrap_or_default()
}

/// Where a mark sits, for the marks a batch can move: a rect's corner, a circle's center, a
/// path's offset. Text, images and outlines keep state by item (a shaped run, an animation, a
/// crop, verbs in place), so they draw on their own, and so does a rect whose ramp spans another
/// item's box, which stays where that box is when the rect moves.
fn anchor(mark: &Mark) -> Option<[f64; 2]> {
    match mark {
        Mark::Rect {
            fill: Fill::Ramp(_),
            ..
        } => None,
        Mark::Rect { bounds, .. } => Some([bounds[0], bounds[1]]),
        Mark::Circle { center, .. } => Some(*center),
        Mark::Path { offset, .. } => Some(*offset),
        Mark::Shape { .. } | Mark::Text { .. } | Mark::Image { .. } => None,
    }
}

/// `mark` moved by `d` and drawn for `item`.
fn shifted(mark: &Mark, d: [f64; 2], item: &str) -> Mark {
    let mut m = mark.clone();
    match &mut m {
        Mark::Rect {
            item: i, bounds, ..
        } => {
            bounds[0] += d[0];
            bounds[1] += d[1];
            *i = item.to_string();
        }
        Mark::Circle {
            item: i, center, ..
        } => {
            center[0] += d[0];
            center[1] += d[1];
            *i = item.to_string();
        }
        Mark::Path {
            item: i, offset, ..
        } => {
            offset[0] += d[0];
            offset[1] += d[1];
            *i = item.to_string();
        }
        Mark::Shape { .. } | Mark::Text { .. } | Mark::Image { .. } => {}
    }
    m
}

/// The offset that moves `template` onto `group`, when each of `group`'s marks is the template's
/// mark at that offset, for its own item, inside the same scopes.
fn offset_of(template: &[&scene::Drawn], group: &[&scene::Drawn]) -> Option<[f64; 2]> {
    if template.len() != group.len() {
        return None;
    }
    let (a, b) = (anchor(&template[0].mark)?, anchor(&group[0].mark)?);
    let d = [b[0] - a[0], b[1] - a[1]];
    template
        .iter()
        .zip(group)
        .all(|(t, g)| {
            anchor(&t.mark).is_some()
                && t.scopes == g.scopes
                && shifted(&t.mark, d, g.mark.item()) == g.mark
        })
        .then_some(d)
}

/// An asset read from the evidence store by its sha256 and decoded, premultiplied.
fn decode(evidence: &Path, asset: &str, item: &str) -> Result<Arc<Pixmap>, Unfit> {
    let path = format!("items/{item}/params/asset");
    let Some(bytes) = evidence::read(evidence, asset) else {
        return unfit("ref_unresolved", path);
    };
    let Ok(decoded) = image::load_from_memory(&bytes) else {
        return unfit("out_of_range", path);
    };
    let rgba = decoded.to_rgba8();
    let (w, h) = rgba.dimensions();
    let (Ok(w), Ok(h)) = (u16::try_from(w), u16::try_from(h)) else {
        return unfit("out_of_range", path);
    };
    let meta = vello_cpu::PixelMetadata::new(vello_cpu::peniko::ImageAlphaType::Alpha, true);
    Ok(Arc::new(Pixmap::from_parts(rgba.into_raw(), w, h, meta)))
}

impl Renderer {
    pub fn new() -> Self {
        Renderer {
            shaper: Shaper::new(),
            resources: Resources::new(),
        }
    }

    /// `doc` evaluated at `t` and its draw list, with every image decoded.
    pub fn prepare(
        &mut self,
        doc: &Map<String, Value>,
        t: i64,
        palette: &Palette,
        status: Option<&deep_canvas_marks::look::Status>,
        record: &Record,
        evidence: &Path,
    ) -> Result<Drawn, Unfit> {
        let program = Program::compile(doc).or_else(|r| unfit(r.code, r.path))?;
        let mut state = program.state();
        program.evaluate(t, eval::Validity::Full, &mut state);
        let items = eval::items(doc, &program, &state);
        let frame =
            scene::frame(doc, &items, palette, record, 1.0).or_else(|r| unfit(r.code, r.path))?;
        let marks = scene::status_marks(doc, &items, record, status, palette)
            .or_else(|r| unfit(r.code, r.path))?;
        let status = Arc::new(modules::status_drawing(
            marks,
            status,
            palette,
            frame.size[1],
            &mut self.shaper,
        ));
        let mut images = BTreeMap::new();
        for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
            if let Mark::Image { item, asset, .. } = &drawn.mark {
                if !images.contains_key(asset) {
                    images.insert(asset.clone(), decode(evidence, asset, item)?);
                }
            }
        }
        // Each text mark's font names a role the shaper bundles.
        for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
            if let Mark::Text { item, spec, .. } = &drawn.mark {
                if Role::parse(&spec.font).is_none() {
                    return unfit("out_of_range", format!("items/{item}/params/font"));
                }
            }
        }
        Ok(Drawn {
            frame,
            boxes: Vec::new(),
            status,
            images,
            runs: BTreeMap::new(),
            animated: BTreeMap::new(),
        })
    }

    /// The scheduler's frame as marks2d drew it (#387), with every image decoded, and the status
    /// marks the text module drew; a build without marks2d draws the status marks alone.
    pub fn prepare_drawing(
        &mut self,
        painted: &crate::frames::Painted,
        evidence: &Path,
    ) -> Result<Drawn, Unfit> {
        let mut images = BTreeMap::new();
        let status = painted.status.clone().unwrap_or_default();
        let Some(drawing) = &painted.drawing else {
            return Ok(Drawn {
                frame: scene::Frame {
                    size: painted.size,
                    ground: [255; 3],
                    layers: Vec::new(),
                },
                boxes: painted.boxes.iter().map(|b| (b.rect, b.color)).collect(),
                status,
                images,
                runs: BTreeMap::new(),
                animated: BTreeMap::new(),
            });
        };
        for drawn in drawing.frame.layers.iter().flat_map(|l| &l.marks) {
            if let Mark::Image { item, asset, .. } = &drawn.mark {
                if !images.contains_key(asset) {
                    images.insert(asset.clone(), decode(evidence, asset, item)?);
                }
            }
        }
        Ok(Drawn {
            frame: drawing.frame.clone(),
            boxes: Vec::new(),
            status,
            images,
            runs: drawing.runs.clone(),
            animated: drawing.animated.clone(),
        })
    }

    /// The draw list at `size` px, the frame scaled to fit from the top left: an opaque PNG over
    /// `ground`, or with `ground` `None` straight RGBA over nothing, for a layer's picture.
    pub fn raster(&mut self, drawn: &Drawn, size: [u16; 2], ground: Option<Rgb>) -> Vec<u8> {
        self.raster_batched(drawn, size, ground, &BTreeMap::new()).0
    }

    /// [`Renderer::raster`], drawing equal expansions instanced (#306): `instanced` gives each
    /// derived item its expansion key and instance. A run of marks next to each other in
    /// stacking order whose items share a key draws as one batch: the first instance's marks are
    /// the template, and each instance whose marks are that template moved by one offset draws
    /// the template again at its offset. The batches it drew come back with the pixels.
    pub fn raster_batched(
        &mut self,
        drawn: &Drawn,
        size: [u16; 2],
        ground: Option<Rgb>,
        instanced: &BTreeMap<String, (String, String)>,
    ) -> (Vec<u8>, Vec<Batch>) {
        let settings = RenderSettings {
            level: Level::fallback(),
            num_threads: 0,
        };
        let mut ctx = RenderContext::new_with(size[0], size[1], settings);
        if let Some(g) = ground {
            ctx.set_paint(color(g));
            ctx.fill_rect(&Rect::new(0.0, 0.0, f64::from(size[0]), f64::from(size[1])));
        }
        let at = Affine::scale(drawn.scale(size));
        // The scopes each mark draws inside (#373): scissors, soft masks and group opacity.
        let mut scopes = Scopes::new(false);
        let marks: Vec<&scene::Drawn> = drawn.frame.layers.iter().flat_map(|l| &l.marks).collect();
        let key_of =
            |d: &scene::Drawn| instanced.get(item_of(&d.mark)).filter(|_| d.clip.is_none());
        let mut batches = Vec::new();
        let mut i = 0;
        while i < marks.len() {
            let d = marks[i];
            let Some((key, _)) = key_of(d) else {
                ctx.set_transform(at);
                scopes.enter(&mut ctx, &mut self.resources, &d.scopes);
                self.mark(&mut ctx, &d.mark, drawn, at);
                i += 1;
                continue;
            };
            let mut end = i + 1;
            while end < marks.len()
                && key_of(marks[end]).is_some_and(|(k, _)| k == key)
                && marks[end].scopes == d.scopes
            {
                end += 1;
            }
            ctx.set_transform(at);
            scopes.enter(&mut ctx, &mut self.resources, &d.scopes);
            let items = self.batch(&mut ctx, &marks[i..end], instanced, drawn, at);
            if !items.is_empty() {
                batches.push(Batch {
                    key: key.clone(),
                    items,
                });
            }
            i = end;
        }
        ctx.set_transform(at);
        scopes.enter(&mut ctx, &mut self.resources, &[]);
        for (rect, c) in &drawn.boxes {
            ctx.set_paint(color(*c));
            ctx.fill_rect(&Rect::new(
                rect[0],
                rect[1],
                rect[0] + rect[2],
                rect[1] + rect[3],
            ));
        }
        for s in &drawn.status.marks {
            ctx.set_transform(at);
            self.status_mark(&mut ctx, &s.mark, at);
        }
        for e in &drawn.status.legend {
            ctx.set_transform(at);
            ctx.set_paint(color(e.color));
            ctx.fill_path(&rect_path(e.swatch, 2.0));
            let text = modules::status_text(&e.glyph, e.word);
            let spec = Spec {
                weight: 600,
                ..Spec::label(&text)
            };
            self.text(&mut ctx, &spec, [e.label[0], e.label[1]], e.ink, at);
        }
        ctx.flush();
        let mut pixmap = Pixmap::new(size[0], size[1]);
        ctx.render(&mut pixmap, &mut self.resources);
        (
            pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha),
            batches,
        )
    }

    /// One run of marks whose items share an expansion key, drawn in stacking order: each
    /// instance's marks are either the first instance's moved by one offset, drawn as that
    /// template at the offset, or drawn as they are and left out of the batch. The run's scopes
    /// are entered already. Returns the batch's items, sorted.
    fn batch(
        &mut self,
        ctx: &mut RenderContext,
        run: &[&scene::Drawn],
        instanced: &BTreeMap<String, (String, String)>,
        drawn: &Drawn,
        at: Affine,
    ) -> Vec<String> {
        let instance_of = |d: &scene::Drawn| instanced.get(item_of(&d.mark)).map(|(_, i)| i);
        // Each instance's marks, in the order they draw.
        let mut groups: Vec<&[&scene::Drawn]> = Vec::new();
        let mut start = 0;
        for k in 1..=run.len() {
            if k == run.len() || instance_of(run[k]) != instance_of(run[start]) {
                groups.push(&run[start..k]);
                start = k;
            }
        }
        let template = groups[0];
        let mut items: Vec<String> = Vec::new();
        for group in groups {
            match offset_of(template, group) {
                Some(d) => {
                    let moved = at * Affine::translate((d[0], d[1]));
                    ctx.set_transform(moved);
                    for t in template {
                        self.mark(ctx, &t.mark, drawn, moved);
                    }
                    items.extend(group.iter().map(|g| item_of(&g.mark).to_string()));
                }
                None => {
                    ctx.set_transform(at);
                    for g in group {
                        self.mark(ctx, &g.mark, drawn, at);
                    }
                }
            }
        }
        ctx.set_transform(at);
        items.sort_unstable();
        items.dedup();
        items
    }

    fn mark(&mut self, ctx: &mut RenderContext, mark: &Mark, drawn: &Drawn, at: Affine) {
        match mark {
            Mark::Rect {
                bounds,
                radius,
                fill,
                ..
            } => {
                match fill {
                    Fill::Solid(c) => ctx.set_paint(color(*c)),
                    Fill::Linear {
                        from,
                        to,
                        at: stops,
                    } => {
                        let [x, y, w, _] = *bounds;
                        let gradient = Gradient::new_linear((x, y), (x + w, y)).with_stops([
                            ColorStop::from((stops[0] as f32, color(*from))),
                            ColorStop::from((stops[1] as f32, color(*to))),
                        ]);
                        ctx.set_paint(gradient);
                    }
                    Fill::Ramp(_) => ctx.set_paint(brush(fill, *bounds)),
                }
                ctx.fill_path(&rect_path(*bounds, *radius));
            }
            Mark::Circle {
                center,
                r,
                inner_r,
                color: c,
                ..
            } => {
                ctx.set_paint(color(*c));
                let mut p = Circle::new((center[0], center[1]), *r).to_path(0.01);
                if *inner_r > 0.0 {
                    p.extend(Circle::new((center[0], center[1]), *inner_r).to_path(0.01));
                    ctx.set_fill_rule(FillRule::EvenOdd);
                }
                ctx.fill_path(&p);
                ctx.set_fill_rule(FillRule::NonZero);
            }
            Mark::Path {
                geometry,
                offset,
                color: c,
                ..
            } => {
                let mesh = geometry.tessellate(path::bucket(at.as_coeffs()[0]));
                // Each triangle wound one way, so the union fills under the nonzero rule.
                let mut p = BezPath::new();
                for t in mesh.triangles() {
                    let v = t.map(|q| (f64::from(q[0]) + offset[0], f64::from(q[1]) + offset[1]));
                    let cross = (v[1].0 - v[0].0) * (v[2].1 - v[0].1)
                        - (v[1].1 - v[0].1) * (v[2].0 - v[0].0);
                    let (b, c2) = if cross < 0.0 {
                        (v[2], v[1])
                    } else {
                        (v[1], v[2])
                    };
                    p.move_to(v[0]);
                    p.line_to(b);
                    p.line_to(c2);
                    p.close_path();
                }
                ctx.set_paint(color(*c));
                ctx.fill_path(&p);
            }
            Mark::Shape {
                verbs,
                fill,
                stroke,
                ..
            } => shape(ctx, verbs, fill.as_ref(), stroke.as_ref(), scale_of(at)),
            Mark::Text {
                item,
                spec,
                origin,
                color: c,
                runs,
                ..
            } => {
                // The text module's run, shaped once for its spec, as the scheduler keeps it;
                // an animated text's units each lifted and faded.
                if let Some(run) = drawn.runs.get(item).filter(|r| r.spec == *spec) {
                    let units = drawn.animated.get(item).map(Vec::as_slice);
                    self.glyphs(ctx, &run.shaped, *origin, (*c, runs), at, units);
                    return;
                }
                let align = match spec.align {
                    scene::Align::Start => Align::Start,
                    scene::Align::Center => Align::Center,
                    scene::Align::End => Align::End,
                };
                let Some(role) = Role::parse(&spec.font) else {
                    return;
                };
                let shaped = self.shaper.shape(&Spec {
                    text: &spec.text,
                    role,
                    size: spec.size as f32,
                    weight: spec.weight,
                    line_height: None,
                    width: spec.width.map(|w| w as f32),
                    max_lines: None,
                    align,
                    bound: spec.bound,
                    tabular: spec.bound,
                    mask: false,
                });
                self.glyphs(ctx, &shaped, *origin, (*c, runs), at, None);
            }
            Mark::Image {
                asset,
                bounds,
                fit,
                sampling,
                opacity,
                adjust,
                ..
            } => {
                let Some(pixmap) = drawn.images.get(asset) else {
                    return;
                };
                // An item's adjust (#373) reaches every pixel of its image.
                let adjusted;
                let pixmap = if adjust.is_identity() {
                    pixmap
                } else {
                    let size = [pixmap.width(), pixmap.height()];
                    let straight = (**pixmap)
                        .clone()
                        .take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha);
                    adjusted = Arc::new(image(straight, size, 1.0, adjust));
                    &adjusted
                };
                let size = [u32::from(pixmap.width()), u32::from(pixmap.height())];
                let [x, y, w, h] = fit.fitted(*bounds, size);
                ctx.set_paint(Image {
                    image: ImageSource::Pixmap(pixmap.clone()),
                    sampler: ImageSampler {
                        alpha: *opacity as f32,
                        ..sampler(*sampling)
                    },
                });
                ctx.set_paint_transform(
                    Affine::translate((x, y))
                        * Affine::scale_non_uniform(w / f64::from(size[0]), h / f64::from(size[1])),
                );
                let [bx, by, bw, bh] = *bounds;
                let shown = Rect::new(
                    x.max(bx),
                    y.max(by),
                    (x + w).min(bx + bw),
                    (y + h).min(by + bh),
                );
                ctx.fill_rect(&shown);
                ctx.reset_paint_transform();
            }
        }
    }

    /// A shaped run at `origin` (its top left), each glyph at its pen position.
    fn text(
        &mut self,
        ctx: &mut RenderContext,
        spec: &Spec<'_>,
        origin: [f64; 2],
        c: Rgb,
        at: Affine,
    ) {
        let shaped = self.shaper.shape(spec);
        self.glyphs(ctx, &shaped, origin, (c, &[]), at, None);
    }

    /// A shaped run's glyphs at `origin` (its top left), each in its run's color or the text's;
    /// with `units`, each glyph lifted and faded by its unit's `[lift, opacity]`.
    fn glyphs(
        &mut self,
        ctx: &mut RenderContext,
        shaped: &deep_text::Shaped,
        origin: [f64; 2],
        (c, runs): (Rgb, &[scene::TextRun]),
        at: Affine,
        units: Option<&[[f64; 2]]>,
    ) {
        let paint = |g: &deep_text::Glyph| scene::run_paint(runs, g.grapheme, None, c).1;
        if let Some(units) = units {
            for (g, unit) in shaped.glyphs.iter().zip(units) {
                let [lift, opacity] = *unit;
                let c = paint(g);
                let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
                ctx.set_paint(AlphaColor::from_rgba8(c[0], c[1], c[2], alpha));
                ctx.set_transform(at * Affine::translate((origin[0], origin[1] + lift)));
                let one = std::iter::once(vello_cpu::Glyph {
                    id: g.id,
                    x: g.x,
                    y: g.y,
                });
                let _ = ctx
                    .glyph_run(&mut self.resources, &g.font)
                    .font_size(g.size)
                    .hint(false)
                    .fill_glyphs(one);
            }
            ctx.set_transform(at);
            return;
        }
        ctx.set_transform(at * Affine::translate((origin[0], origin[1])));
        let mut start = 0;
        while start < shaped.glyphs.len() {
            let first = &shaped.glyphs[start];
            let run = shaped.glyphs[start..]
                .iter()
                .take_while(|g| {
                    g.font.data.id() == first.font.data.id()
                        && g.font.index == first.font.index
                        && g.size == first.size
                        && paint(g) == paint(first)
                })
                .count();
            ctx.set_paint(color(paint(first)));
            let glyphs = shaped.glyphs[start..start + run]
                .iter()
                .map(|g| vello_cpu::Glyph {
                    id: g.id,
                    x: g.x,
                    y: g.y,
                });
            let _ = ctx
                .glyph_run(&mut self.resources, &first.font)
                .font_size(first.size)
                .hint(false)
                .fill_glyphs(glyphs);
            start += run;
        }
        ctx.set_transform(at);
    }

    /// A status mark: its slot in the state's color, with the state's glyph and word.
    fn status_mark(&mut self, ctx: &mut RenderContext, s: &StatusMark, at: Affine) {
        let [x, y, w, h] = s.bounds;
        let chip = s.core.max(16.0);
        if let Some((px, c)) = s.outline {
            ctx.set_paint(color(c));
            ctx.fill_path(&rect_path(
                [x - px, y - px, w + 2.0 * px, h + 2.0 * px],
                s.radius + px,
            ));
        }
        match s.slot {
            Slot::Fill => {
                ctx.set_paint(color(s.color));
                ctx.fill_path(&rect_path(s.bounds, s.radius));
                let text = modules::status_text(&s.glyph, s.word);
                let spec = Spec {
                    weight: 600,
                    ..Spec::label(&text)
                };
                self.text(ctx, &spec, [x + 6.0, y + (h - 17.0) / 2.0], s.ink, at);
            }
            Slot::Stroke => {
                let mut ring = rect_path(
                    [x - s.core, y - s.core, w + 2.0 * s.core, h + 2.0 * s.core],
                    s.radius + s.core,
                );
                ring.extend(rect_path(s.bounds, s.radius));
                ctx.set_paint(color(s.color));
                ctx.set_fill_rule(FillRule::EvenOdd);
                ctx.fill_path(&ring);
                ctx.set_fill_rule(FillRule::NonZero);
                self.badge(ctx, s, [x + w - chip / 2.0, y - chip / 2.0, chip, chip], at);
            }
            Slot::Badge => self.badge(ctx, s, [x + w - chip / 2.0, y - chip / 2.0, chip, chip], at),
        }
    }

    fn badge(&mut self, ctx: &mut RenderContext, s: &StatusMark, b: [f64; 4], at: Affine) {
        ctx.set_paint(color(s.color));
        ctx.fill_path(&rect_path(b, b[2] / 2.0));
        let spec = Spec {
            weight: 600,
            ..Spec::label(&s.glyph)
        };
        self.text(
            ctx,
            &spec,
            [b[0] + 3.0, b[1] + (b[3] - 17.0) / 2.0],
            s.ink,
            at,
        );
    }
}

/// A snapshot's entry in a reply: the PNG's hash and size, with the text snapshot of the status
/// marks and the legend it drew, boxes in the PNG's pixels (The status-color rule).
pub fn entry(sha: &str, drawn: &Drawn, size: [u16; 2]) -> Value {
    let scale = drawn.scale(size);
    let px = |b: [f64; 4]| json!(b.map(|v| v * scale));
    let text = |t: &str| (!t.is_empty()).then(|| t.to_string());
    let marks: Vec<Value> = drawn
        .status
        .marks
        .iter()
        .map(|m| {
            json!({"item": m.mark.item, "binding": m.mark.binding, "state": m.mark.state,
                   "color": m.mark.color, "bounds": px(m.mark.bounds),
                   "glyph": text(&m.mark.glyph), "word": text(m.mark.word), "label": px(m.label)})
        })
        .collect();
    let legend: Vec<Value> = drawn
        .status
        .legend
        .iter()
        .map(|e| {
            json!({"state": e.state, "glyph": e.glyph, "word": e.word, "color": e.color,
                   "swatch": px(e.swatch)})
        })
        .collect();
    json!({"sha256": sha, "w": size[0], "h": size[1], "marks": marks, "legend": legend})
}

/// A size as a snapshot's px: rounded, 1 to 8192 each way.
pub fn px(size: [f64; 2]) -> [u16; 2] {
    size.map(|v| v.round().clamp(1.0, 8192.0) as u16)
}

/// An RGBA raster as an 8-bit RGBA PNG, its bytes the same for the same pixels.
pub fn png(rgba: Vec<u8>, size: [u16; 2]) -> Vec<u8> {
    let mut out = Vec::new();
    let image = image::RgbaImage::from_raw(u32::from(size[0]), u32::from(size[1]), rgba)
        .expect("a raster is width × height × 4 bytes");
    image
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .expect("a PNG encodes into memory");
    out
}

/// The scale of a uniform transform, which sets how finely outlines are flattened.
fn scale_of(at: Affine) -> f64 {
    at.as_coeffs()[0]
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Render-back draws #373's R2 marks: a star, and a group at half opacity whose overlapping
    /// children draw through one pass, so their overlap reads as either alone.
    #[test]
    fn render_back_draws_stars_and_group_opacity() {
        let doc = json!({"format": 1, "id": "r2", "size": [200, 100],
            "layers": {"main": {"writer": "agent-a", "order": "a0"}},
            "items": {
                "star": {"id": "star", "kind": "star@1", "layer": "main", "name": "Star", "order": "a0",
                    "params": {"center": [50, 50], "points": 5, "outer_r": 40, "inner_r": 20,
                        "paint": {"fill": {"role": "ink"}}}},
                "veil": {"id": "veil", "kind": "group@1", "layer": "main", "name": "Veil", "order": "a1",
                    "params": {"opacity": 0.5}},
                "a": {"id": "a", "kind": "rect@1", "layer": "main", "name": "A", "order": "a2", "parent": "veil",
                    "params": {"box": [110, 20, 50, 40], "paint": {"fill": {"role": "ink"}}}},
                "b": {"id": "b", "kind": "rect@1", "layer": "main", "name": "B", "order": "a3", "parent": "veil",
                    "params": {"box": [130, 40, 50, 40], "paint": {"fill": {"role": "ink"}}}}}});
        let palette: Palette = [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [0, 0, 0]),
        ]
        .into();
        let mut r = Renderer::new();
        let drawn = r
            .prepare(
                doc.as_object().unwrap(),
                0,
                &palette,
                None,
                &Record::default(),
                Path::new("."),
            )
            .expect("render-back draws R2's marks");
        let rgba = r.raster(&drawn, [200, 100], Some([255, 255, 255]));
        let at = |x: usize, y: usize| rgba[(y * 200 + x) * 4];
        assert_eq!(at(50, 50), 0, "the star's center is ink");
        assert_eq!(at(50, 5), 255, "above its top spike is ground");
        let (alone, overlap) = (at(115, 25), at(145, 50));
        assert!(
            (126..=129).contains(&alone),
            "half ink over white, got {alone}"
        );
        assert_eq!(overlap, alone, "the overlap draws as either rect alone");
    }

    /// Equal expansions next to each other in stacking order draw as one instanced batch (#306),
    /// pixel for pixel as drawn mark by mark; an instance whose marks differ draws on its own
    /// outside the batch, one past another item starts a batch of its own, and bars whose ramp
    /// spans another item's box draw on their own, since that ramp stays put when a bar moves.
    #[test]
    fn equal_expansions_draw_in_one_batch() {
        let mut items = serde_json::Map::new();
        let mut instanced = BTreeMap::new();
        let ink = json!({"role": "ink"});
        let ramp = json!({"gradient": {"span": "panel",
            "stops": [{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]}});
        let mut bars = |instance: &str,
                        key: &str,
                        order: &str,
                        at: [f64; 2],
                        rise: f64,
                        fill: &Value| {
            for i in 0..3 {
                let id = format!("{instance}.bars.{i}");
                let h = 40.0 + rise * f64::from(i);
                items.insert(id.clone(), json!({"id": id, "kind": "rect@1", "layer": "main",
                    "name": id, "order": order,
                    "params": {"box": [at[0] + 24.0 * f64::from(i), at[1], 16, h], "paint": {"fill": fill}}}));
                instanced.insert(id, (key.to_string(), instance.to_string()));
            }
        };
        bars("c1", "k", "a0", [10.0, 10.0], 8.0, &ink);
        bars("c2", "k", "a1", [10.0, 80.0], 8.0, &ink);
        bars("c3", "k", "a2", [110.0, 10.0], 12.0, &ink);
        bars("c4", "k", "a4", [110.0, 80.0], 8.0, &ink);
        bars("c5", "g", "a5", [210.0, 10.0], 8.0, &ramp);
        bars("c6", "g", "a6", [300.0, 10.0], 8.0, &ramp);
        items.insert("gap".into(), json!({"id": "gap", "kind": "rect@1", "layer": "main",
            "name": "Gap", "order": "a3", "params": {"box": [190, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}}));
        items.insert("panel".into(), json!({"id": "panel", "kind": "rect@1", "layer": "main",
            "name": "Panel", "order": "a", "params": {"box": [200, 0, 200, 150], "paint": {"fill": {"role": "ground"}}}}));
        let doc = json!({"format": 1, "id": "bars", "size": [400, 150],
            "layers": {"main": {"writer": "agent-a", "order": "a0"}}, "items": items});
        let palette: Palette = [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [0, 0, 0]),
        ]
        .into();
        let mut r = Renderer::new();
        let drawn = r
            .prepare(
                doc.as_object().unwrap(),
                0,
                &palette,
                None,
                &Record::default(),
                Path::new("."),
            )
            .expect("the bars draw");
        let white = Some([255, 255, 255]);
        let (batched, drew) = r.raster_batched(&drawn, [400, 150], white, &instanced);
        assert!(
            batched == r.raster(&drawn, [400, 150], white),
            "the batched draw's pixels are the mark-by-mark draw's"
        );
        let ids = |list: &[&str]| -> Vec<String> {
            let mut out: Vec<String> = list
                .iter()
                .flat_map(|c| (0..3).map(move |i| format!("{c}.bars.{i}")))
                .collect();
            out.sort();
            out
        };
        assert_eq!(
            drew,
            vec![
                Batch {
                    key: "k".into(),
                    items: ids(&["c1", "c2"])
                },
                Batch {
                    key: "k".into(),
                    items: ids(&["c4"])
                },
            ],
            "c1 and c2 draw as one batch; c3's taller bars draw alone; c4, past `gap`, starts another; c5 and c6's ramps keep them out"
        );
    }
}
