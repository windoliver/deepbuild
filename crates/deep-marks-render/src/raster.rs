//! `raster` and `geometry`, on every platform: a document's view drawn by Vello CPU with its f32
//! pipeline at the scalar SIMD level, the configuration goldens and snapshots render with
//! (technical design: Decided, The 2D renderer), and an item's outline as marks2d builds it.
//!
//! Paints, outlines and scopes come from deep-marks-vello, shared with render-back's snapshots.
//! Status marks and their legend draw last, outside every scope, so no mask reaches them.

use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_marks::look::Look;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, ImageFit, Mark, Planted, Record, Rgb};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_marks_vello::{
    bez, brush, image, rasterizer, rect, sampler, settings, shape, solid, stroke, Scopes,
};
use serde_json::{json, Map, Value};
use vello_cpu::kurbo::{Affine, RoundedRect, Shape};
use vello_cpu::peniko::{Fill as FillRule, ImageAlphaType};
use vello_cpu::{Image, ImageSource, Pixmap, RenderContext, Resources};

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
    scopes: Scopes,
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
            } => shape(
                &mut self.ctx,
                verbs,
                fill.as_ref(),
                line.as_ref(),
                self.zoom,
            ),
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
                sampling,
                crop,
                opacity,
                adjust,
            } => {
                let source = asset::decoded(self.store, hash, *crop, item)?;
                let (w, h) = source.dimensions();
                let (Ok(pw), Ok(ph)) = (u16::try_from(w), u16::try_from(h)) else {
                    return Err(refused(
                        "asset_undecodable",
                        &format!("items/{item}/params/asset"),
                    ));
                };
                let pixmap = image(source.into_raw(), [pw, ph], *opacity, adjust);
                let to = fitted(*bounds, [w, h], *fit);
                self.ctx.set_paint(Image {
                    image: ImageSource::Pixmap(Arc::new(pixmap)),
                    sampler: sampler(*sampling),
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
        scopes: Scopes::new(req.encoded_luma),
        zoom,
    };
    p.ctx.set_transform(Affine::scale(zoom));
    p.ctx.set_paint(solid(frame.ground));
    p.ctx
        .fill_rect(&rect([0.0, 0.0, frame.size[0], frame.size[1]]));
    for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
        p.scopes.enter(&mut p.ctx, &mut p.resources, &drawn.scopes);
        p.mark(&drawn.mark)?;
    }
    p.scopes.enter(&mut p.ctx, &mut p.resources, &[]);
    for prim in &prims {
        p.prim(prim);
    }
    let mut pixmap = Pixmap::new(w, h);
    p.ctx
        .render_with(&mut pixmap, &mut p.resources, rasterizer());
    let bytes = pixmap.take_rgba8(ImageAlphaType::Alpha);
    let image = image::RgbaImage::from_raw(u32::from(w), u32::from(h), bytes)
        .ok_or_else(|| refused("not_written", &req.out))?;
    image
        .save_with_format(&req.out, image::ImageFormat::Png)
        .map_err(|_| refused("not_written", &req.out))?;
    Ok(json!({"ok": true, "width": w, "height": h, "offscreen": p.scopes.offscreen}))
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
