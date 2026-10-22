//! `raster` and `geometry`, on every platform: a document's view drawn by Vello CPU with its f32
//! pipeline at the scalar SIMD level, the configuration goldens and snapshots render with
//! (technical design: Decided, The 2D renderer), and an item's outline as marks2d builds it.
//!
//! Gradients reach Vello as the OKLab ramp's sRGB-encoded stops (paint), so Vello mixes them in
//! encoded space as 2D composites. A rect mask and a frame's overflow are scissors; an alpha or
//! luminance mask renders its own paint, takes its coverage (luminance in linear light) and draws
//! its items through one mask layer; a group below opacity 1 draws through one opacity layer.
//! Status marks and their legend draw last, outside every scope, so no mask reaches them.

use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas::color::srgb_decode;
use deep_canvas_marks::look::Look;
use deep_canvas_marks::paint::{self, Extend, Geometry, Ramp};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Fill, ImageFit, Mark, Planted, Record, Rgb, Scope};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};
use vello_cpu::color::{AlphaColor, DynamicColor, Srgb};
use vello_cpu::kurbo::{Affine, BezPath, Cap, Join, Rect, RoundedRect, Shape, Stroke};
use vello_cpu::peniko::{
    self, ColorStop, ColorStops, Fill as FillRule, Gradient, ImageAlphaType, ImageSampler,
};
use vello_cpu::{
    Image, ImageSource, Level, Mask, PaintType, PixelMetadata, Pixmap, RasterizerSettings,
    RenderContext, RenderMode, RenderSettings, Resources,
};

use crate::asset;
use crate::status::{self, label_of, Prim};
use crate::{palette_of, refused, View};

/// A `raster` line.
pub struct Request {
    pub out: String,
    pub doc: Map<String, Value>,
    pub look: Look,
    pub view: View,
    pub t: i64,
    pub record: Record,
    pub store: Option<PathBuf>,
    pub planted: Planted,
    /// #373 AC6's wrong program: a luminance mask that reads encoded luma.
    pub encoded_luma: bool,
}

fn settings() -> RenderSettings {
    RenderSettings {
        level: Level::fallback(),
        num_threads: 0,
    }
}

fn rgba(c: [f64; 3]) -> AlphaColor<Srgb> {
    AlphaColor::new([c[0] as f32, c[1] as f32, c[2] as f32, 1.0])
}

fn solid(c: Rgb) -> PaintType {
    AlphaColor::from_rgba8(c[0], c[1], c[2], 255).into()
}

/// A ramp as Vello's gradient, its stops already the OKLab ramp in encoded sRGB.
fn gradient(ramp: &Ramp) -> PaintType {
    let p = |q: [f64; 2]| (q[0], q[1]);
    let mut g = match ramp.geometry {
        Geometry::Linear { from, to } => Gradient::new_linear(p(from), p(to)),
        Geometry::Radial {
            center,
            radius,
            focal,
        } => Gradient::new_two_point_radial(p(focal), 0.0, p(center), radius as f32),
        Geometry::Sweep { center, start, end } => Gradient::new_sweep(
            p(center),
            start.to_radians() as f32,
            end.to_radians() as f32,
        ),
    };
    g.extend = match ramp.extend {
        Extend::Pad => peniko::Extend::Pad,
        Extend::Repeat => peniko::Extend::Repeat,
        Extend::Reflect => peniko::Extend::Reflect,
    };
    let stops: Vec<ColorStop> = finest_table(&ramp.stops)
        .iter()
        .map(|(t, c)| ColorStop {
            offset: *t as f32,
            color: DynamicColor::from_alpha_color(rgba(*c)),
        })
        .collect();
    g.stops = ColorStops::from(stops.as_slice());
    g.into()
}

/// Vello reads a gradient from a lookup table it sizes from the narrowest stop interval, 1,024
/// entries for these ramps and 4,096 once an interval is under 1/2,048, at ⌊t × (size − 1)⌋; at
/// 1,024 a steep ramp's step reaches 0.4 code values. One stop 1/4,096 past the first, mixed in
/// encoded sRGB as Vello mixes between stops, changes no color and gets the 4,096-entry table.
fn finest_table(stops: &[(f64, [f64; 3])]) -> Vec<(f64, [f64; 3])> {
    const STEP: f64 = 1.0 / 4096.0;
    let mut out = stops.to_vec();
    let narrow = stops.windows(2).any(|w| w[1].0 - w[0].0 < 2.0 * STEP);
    let Some(k) = stops.windows(2).position(|w| w[1].0 - w[0].0 >= 2.0 * STEP) else {
        return out;
    };
    if !narrow {
        let ((t0, a), (t1, b)) = (stops[k], stops[k + 1]);
        let f = STEP / (t1 - t0);
        out.insert(
            k + 1,
            (t0 + STEP, [0, 1, 2].map(|i| a[i] + (b[i] - a[i]) * f)),
        );
    }
    out
}

/// A fill's paint over `bounds`; R1's two-stop gradient runs west to east of them, in OKLab.
fn brush(fill: &Fill, bounds: [f64; 4]) -> PaintType {
    match fill {
        Fill::Solid(c) => solid(*c),
        Fill::Linear { from, to, at } => {
            let [x, y, w, h] = bounds;
            gradient(&Ramp {
                geometry: Geometry::Linear {
                    from: [x, y + h / 2.0],
                    to: [x + w, y + h / 2.0],
                },
                extend: Extend::Pad,
                stops: paint::dense(&[(at[0], *from), (at[1], *to)]),
            })
        }
        Fill::Ramp(r) => gradient(r),
    }
}

/// Vello flattens curves within 0.25 px, which shaves an arc's area (about 26 u² off a quarter
/// circle of r 100); curves reach it flattened within this, in u at zoom 1.
const FLATTEN: f64 = 0.01;

fn bez(verbs: &[Verb], by: [f64; 2], zoom: f64) -> BezPath {
    let m = |p: [f64; 2]| (p[0] + by[0], p[1] + by[1]);
    let mut path = BezPath::new();
    for v in verbs {
        match *v {
            Verb::Move(p) => path.move_to(m(p)),
            Verb::Line(p) => path.line_to(m(p)),
            Verb::Quad(a, b) => path.quad_to(m(a), m(b)),
            Verb::Cubic(a, b, c) => path.curve_to(m(a), m(b), m(c)),
            Verb::Close => path.close_path(),
        }
    }
    let mut flat = BezPath::new();
    vello_cpu::kurbo::flatten(&path, FLATTEN / zoom, |e| flat.push(e));
    flat
}

fn rect(b: [f64; 4]) -> Rect {
    Rect::new(b[0], b[1], b[0] + b[2], b[1] + b[3])
}

/// Strokes as SVG draws them by default: butt caps and miter joins with a limit of 4.
fn stroke(width: f64) -> Stroke {
    Stroke::new(width)
        .with_caps(Cap::Butt)
        .with_join(Join::Miter)
        .with_miter_limit(4.0)
}

/// A rect, rounded when `radius` is above 0.
fn fill_box(ctx: &mut RenderContext, b: [f64; 4], radius: f64) {
    if radius > 0.0 {
        ctx.fill_path(&RoundedRect::from_rect(rect(b), radius).to_path(0.1));
    } else {
        ctx.fill_rect(&rect(b));
    }
}

/// A ring `width` wide inside `b` with outer corner radius `radius` (a quad's border).
fn ring(ctx: &mut RenderContext, b: [f64; 4], radius: f64, width: f64) {
    let inner = [
        b[0] + width,
        b[1] + width,
        b[2] - 2.0 * width,
        b[3] - 2.0 * width,
    ];
    let mut path = RoundedRect::from_rect(rect(b), radius).to_path(0.1);
    if inner[2] > 0.0 && inner[3] > 0.0 {
        path.extend(
            RoundedRect::from_rect(rect(inner), (radius - width).max(0.0)).path_elements(0.1),
        );
    }
    ctx.set_fill_rule(FillRule::EvenOdd);
    ctx.fill_path(&path);
    ctx.set_fill_rule(FillRule::NonZero);
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

/// One drawing of a document's view.
struct Painter<'a> {
    ctx: RenderContext,
    resources: Resources,
    store: Option<&'a std::path::Path>,
    encoded_luma: bool,
    /// The scopes open now, outermost first: (item, a layer rather than a clip).
    open: Vec<(String, bool)>,
    offscreen: u32,
    zoom: f64,
}

impl Painter<'_> {
    fn text(&mut self, label: &deep_text_gpui::Label, origin: [f64; 2], color: Rgb) {
        let shaped = deep_text_gpui::shape(label);
        self.ctx.set_paint(solid(color));
        for g in &shaped.glyphs {
            let glyph = vello_cpu::Glyph {
                id: g.id,
                x: g.x + origin[0] as f32,
                y: g.y + origin[1] as f32,
            };
            let run = self.ctx.glyph_run(&mut self.resources, &g.font);
            let _ = run
                .font_size(g.size)
                .hint(false)
                .fill_glyphs(std::iter::once(glyph));
        }
    }

    /// A soft mask's coverage over the frame: its paint over its rect, as alpha or as linear-light
    /// luminance (Rec. 709 weights), and nothing outside the rect.
    fn mask(&mut self, rect_u: [f64; 4], luminance: bool, fill: &Fill) -> Mask {
        let (w, h) = (self.ctx.width(), self.ctx.height());
        let mut ctx = RenderContext::new_with(w, h, settings());
        ctx.set_transform(*self.ctx.transform());
        ctx.set_paint(brush(fill, rect_u));
        ctx.fill_rect(&rect(rect_u));
        let mut pixmap = Pixmap::new(w, h);
        ctx.render_with(
            &mut pixmap,
            &mut self.resources,
            RasterizerSettings {
                render_mode: RenderMode::OptimizeQuality,
                ..RasterizerSettings::default()
            },
        );
        let data = pixmap
            .data()
            .iter()
            .map(|p| {
                let a = f64::from(p.a) / 255.0;
                if !luminance || a == 0.0 {
                    return p.a;
                }
                let c = [p.r, p.g, p.b].map(|v| f64::from(v) / 255.0 / a);
                let lin = |v: f64| if self.encoded_luma { v } else { srgb_decode(v) };
                let y = 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
                (y * a * 255.0).round().clamp(0.0, 255.0) as u8
            })
            .collect();
        Mask::from_parts(data, w, h)
    }

    /// Closes the scopes the next mark isn't in and opens those it is.
    fn enter(&mut self, scopes: &[Scope]) {
        let keep = self
            .open
            .iter()
            .zip(scopes)
            .take_while(|((id, _), s)| id == s.item())
            .count();
        while self.open.len() > keep {
            match self.open.pop() {
                Some((_, true)) => self.ctx.pop_layer(),
                _ => self.ctx.pop_clip(),
            }
        }
        for s in &scopes[keep..] {
            let layer = match s {
                Scope::Clip { rect: r, .. } => {
                    self.ctx.push_clip_rect(&rect(*r));
                    false
                }
                Scope::Mask {
                    rect: r,
                    luminance,
                    fill,
                    ..
                } => {
                    let mask = self.mask(*r, *luminance, fill);
                    self.ctx.push_mask_layer(mask);
                    // Its own paint's pass, and the layer its items draw through.
                    self.offscreen += 2;
                    true
                }
                Scope::Opacity { alpha, .. } => {
                    self.ctx.push_opacity_layer(*alpha as f32);
                    self.offscreen += 1;
                    true
                }
            };
            self.open.push((s.item().to_string(), layer));
        }
    }

    fn mark(&mut self, mark: &Mark) -> Result<(), Value> {
        match mark {
            Mark::Rect {
                bounds,
                radius,
                fill,
                ..
            } => {
                self.ctx.set_paint(brush(fill, *bounds));
                fill_box(&mut self.ctx, *bounds, *radius);
            }
            Mark::Circle {
                center,
                r,
                inner_r,
                color,
                ..
            } => {
                self.ctx.set_paint(solid(*color));
                let c = (center[0], center[1]);
                let mut path = vello_cpu::kurbo::Circle::new(c, *r).to_path(0.1);
                if *inner_r > 0.0 {
                    path.extend(vello_cpu::kurbo::Circle::new(c, *inner_r).path_elements(0.1));
                    self.ctx.set_fill_rule(FillRule::EvenOdd);
                }
                self.ctx.fill_path(&path);
                self.ctx.set_fill_rule(FillRule::NonZero);
            }
            Mark::Path {
                geometry,
                offset,
                color,
                ..
            } => {
                let path = bez(&geometry.verbs, *offset, self.zoom);
                self.ctx.set_paint(solid(*color));
                if geometry.fill {
                    self.ctx.fill_path(&path);
                }
                if let Some(w) = geometry.stroke {
                    self.ctx.set_stroke(stroke(w));
                    self.ctx.stroke_path(&path);
                }
            }
            Mark::Shape {
                verbs,
                fill,
                stroke: line,
                ..
            } => {
                let path = bez(verbs, [0.0, 0.0], self.zoom);
                let b = path.bounding_box();
                let bounds = [b.x0, b.y0, b.width(), b.height()];
                if let Some(f) = fill {
                    self.ctx.set_paint(brush(f, bounds));
                    self.ctx.fill_path(&path);
                }
                if let Some((w, f)) = line {
                    self.ctx.set_paint(brush(f, bounds));
                    self.ctx.set_stroke(stroke(*w));
                    self.ctx.stroke_path(&path);
                }
            }
            Mark::Text {
                item,
                spec,
                origin,
                color,
            } => {
                let label = label_of(spec)
                    .ok_or_else(|| refused("bad_font", &format!("items/{item}/params/font")))?;
                self.text(&label, *origin, *color);
            }
            Mark::Image {
                item,
                asset: hash,
                bounds,
                fit,
                crop,
                opacity,
                adjust,
            } => {
                let source = asset::decoded(self.store, hash, *crop, item)?;
                let (w, h) = source.dimensions();
                let mut bytes = source.into_raw();
                for px in bytes.chunks_exact_mut(4) {
                    let c = adjust.color(paint::unit([px[0], px[1], px[2]]));
                    let a = f64::from(px[3]) / 255.0 * opacity;
                    for k in 0..3 {
                        px[k] = (c[k] * a * 255.0).round().clamp(0.0, 255.0) as u8;
                    }
                    px[3] = (a * 255.0).round() as u8;
                }
                let (Ok(pw), Ok(ph)) = (u16::try_from(w), u16::try_from(h)) else {
                    return Err(refused(
                        "asset_undecodable",
                        &format!("items/{item}/params/asset"),
                    ));
                };
                let pixmap = Pixmap::from_parts(
                    bytes,
                    pw,
                    ph,
                    PixelMetadata {
                        may_have_transparency: true,
                        alpha_type: ImageAlphaType::AlphaPremultiplied,
                    },
                );
                let to = fitted(*bounds, [w, h], *fit);
                self.ctx.set_paint(Image {
                    image: ImageSource::Pixmap(Arc::new(pixmap)),
                    sampler: ImageSampler::default(),
                });
                self.ctx.set_paint_transform(
                    Affine::translate((to[0], to[1]))
                        * Affine::scale_non_uniform(to[2] / f64::from(w), to[3] / f64::from(h)),
                );
                // The image inside its box: a cover image is cut at the box's edges.
                let shown = rect(*bounds).intersect(rect(to));
                if shown.width() > 0.0 && shown.height() > 0.0 {
                    self.ctx.fill_rect(&shown);
                }
                self.ctx.reset_paint_transform();
            }
        }
        Ok(())
    }

    fn prim(&mut self, prim: &Prim) {
        match prim {
            Prim::Fill {
                rect: b,
                radius,
                color,
            } => {
                self.ctx.set_paint(solid(*color));
                fill_box(&mut self.ctx, *b, *radius);
            }
            Prim::Ring {
                rect: b,
                radius,
                width,
                color,
            } => {
                self.ctx.set_paint(solid(*color));
                ring(&mut self.ctx, *b, *radius, *width);
            }
            Prim::Text {
                label,
                origin,
                color,
            } => self.text(label, *origin, *color),
        }
    }
}

/// The document's evaluated items at `t`.
fn items_at(doc: &Map<String, Value>, t: i64) -> Result<Map<String, Value>, Value> {
    let program =
        Program::compile(&Value::Object(doc.clone())).map_err(|r| refused(r.code, &r.path))?;
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    Ok(eval::items(doc, &program, &state))
}

/// Draws a `raster` request and writes its PNG.
pub fn answer(req: Request) -> Value {
    match draw(&req) {
        Ok(v) | Err(v) => v,
    }
}

fn draw(req: &Request) -> Result<Value, Value> {
    let items = items_at(&req.doc, req.t)?;
    let palette = palette_of(&req.look, req.view.theme);
    let record = Record {
        pinned: req.t,
        ..req.record.clone()
    };
    let zoom = req.view.zoom;
    let frame = scene::frame_planted(&req.doc, &items, palette, &record, zoom, req.planted)
        .map_err(|r| refused(r.code, &r.path))?;
    let marks = scene::status_marks(&req.doc, &items, &record, req.look.status.as_ref(), palette)
        .map_err(|r| refused(r.code, &r.path))?;
    let (prims, _) = status::layout(&marks, &status::occupied(&frame), palette, frame.size, zoom);
    let size = |v: f64| {
        u16::try_from((v * zoom).round() as i64)
            .ok()
            .filter(|v| *v > 0)
    };
    let (Some(w), Some(h)) = (size(frame.size[0]), size(frame.size[1])) else {
        return Err(refused("out_of_range", "size"));
    };
    let mut p = Painter {
        ctx: RenderContext::new_with(w, h, settings()),
        resources: Resources::new(),
        store: req.store.as_deref(),
        encoded_luma: req.encoded_luma,
        open: Vec::new(),
        offscreen: 0,
        zoom,
    };
    p.ctx.set_transform(Affine::scale(zoom));
    p.ctx.set_paint(solid(frame.ground));
    p.ctx
        .fill_rect(&rect([0.0, 0.0, frame.size[0], frame.size[1]]));
    for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
        p.enter(&drawn.scopes);
        p.mark(&drawn.mark)?;
    }
    p.enter(&[]);
    for prim in &prims {
        p.prim(prim);
    }
    let mut pixmap = Pixmap::new(w, h);
    p.ctx.render_with(
        &mut pixmap,
        &mut p.resources,
        RasterizerSettings {
            render_mode: RenderMode::OptimizeQuality,
            ..RasterizerSettings::default()
        },
    );
    let bytes = pixmap.take_rgba8(ImageAlphaType::Alpha);
    let image = image::RgbaImage::from_raw(u32::from(w), u32::from(h), bytes)
        .ok_or_else(|| refused("not_written", &req.out))?;
    image
        .save_with_format(&req.out, image::ImageFormat::Png)
        .map_err(|_| refused("not_written", &req.out))?;
    Ok(json!({"ok": true, "width": w, "height": h, "offscreen": p.offscreen}))
}

/// Every look role a document names, in black: geometry needs the outline, never its colors.
fn any_roles(value: &Value, palette: &mut scene::Palette) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if let ("role", Value::String(r)) = (k.as_str(), v) {
                    palette.insert(r.clone(), [0, 0, 0]);
                }
                any_roles(v, palette);
            }
        }
        Value::Array(list) => list.iter().for_each(|v| any_roles(v, palette)),
        _ => {}
    }
}

/// An item's outline as subpaths of verbs and points in u, its offset applied.
pub fn geometry(doc: &Map<String, Value>, item: &str) -> Value {
    let run = || -> Result<Value, Value> {
        let items = items_at(doc, 0)?;
        let mut palette = scene::Palette::new();
        palette.insert("ground".into(), [255, 255, 255]);
        any_roles(&Value::Object(doc.clone()), &mut palette);
        let frame = scene::frame(doc, &items, &palette, &Record::default(), 1.0)
            .map_err(|r| refused(r.code, &r.path))?;
        let mut subpaths: Vec<Value> = Vec::new();
        for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
            let name = drawn.mark.item();
            if name != item && !name.starts_with(&format!("{item}#")) {
                continue;
            }
            let (verbs, by) = match &drawn.mark {
                Mark::Shape { verbs, .. } => (verbs.clone(), [0.0, 0.0]),
                Mark::Path {
                    geometry, offset, ..
                } => (geometry.verbs.clone(), *offset),
                _ => continue,
            };
            let m = |p: [f64; 2]| json!([p[0] + by[0], p[1] + by[1]]);
            // One subpath per move: its verb names, its points and whether it closes.
            let mut paths: Vec<(Vec<&str>, Vec<Value>, bool)> = Vec::new();
            for v in &verbs {
                if let Verb::Move(_) = v {
                    paths.push((Vec::new(), Vec::new(), false));
                }
                let Some((names, points, closed)) = paths.last_mut() else {
                    continue;
                };
                let (name, at): (&str, &[[f64; 2]]) = match v {
                    Verb::Move(p) => ("M", std::slice::from_ref(p)),
                    Verb::Line(p) => ("L", std::slice::from_ref(p)),
                    Verb::Quad(a, b) => ("Q", &[*a, *b]),
                    Verb::Cubic(a, b, c) => ("C", &[*a, *b, *c]),
                    Verb::Close => ("Z", &[]),
                };
                names.push(name);
                points.extend(at.iter().map(|p| m(*p)));
                *closed |= name == "Z";
            }
            for (names, points, closed) in paths {
                subpaths.push(json!({"closed": closed, "verbs": names, "points": points}));
            }
        }
        Ok(json!({"ok": true, "subpaths": subpaths}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}
