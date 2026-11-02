//! `raster` and `geometry`, on every platform: a document's view drawn by Vello CPU with its f32
//! pipeline at the scalar SIMD level, the configuration goldens and snapshots render with
//! (technical design: Decided, The 2D renderer), and an item's outline as marks2d builds it.
//!
//! Paints, outlines and scopes come from deep-marks-vello, shared with render-back's snapshots.
//! Status marks and their legend draw last, outside every scope, so no mask reaches them.
//!
//! Issue #385: a golden is asked at the scalar level through the f32 pipeline, and any other
//! setting is refused, naming it; a reading may take the NEON or detected level, or the u8
//! pipeline, and every answer names what drew it. A writer layer that holds a blended group draws
//! isolated, so the group blends only with what its own layer drew before it; `blend_inputs`
//! writes those two inputs of each blended group. The painter draws on any [`Canvas`] with
//! [`Glyphs`], so Vello GPU draws a layer through the same code (`gpu`).

use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_marks::look::Look;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Mark, Planted, Record, Rgb};
use deep_canvas_marks::scene::{Blend, Drawn, Scope};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_marks_vello::{
    bez, brush, image, rasterizer, rect, sampler, settings, shape, solid, stroke, Canvas, Scopes,
};
use serde_json::{json, Map, Value};
use vello_cpu::kurbo::{Affine, RoundedRect, Shape};
use vello_cpu::peniko::{Fill as FillRule, FontData, ImageAlphaType};
use vello_cpu::{
    Image, ImageSource, Level, Pixmap, RasterizerSettings, RenderContext, RenderMode,
    RenderSettings, Resources,
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
    /// #381 AC4's wrong program: each span a text's runs cut is shaped on its own.
    pub spans_apart: bool,
    /// The SIMD level and pipeline asked, and whether it's a golden (#385).
    pub config: Config,
    /// Where each blended group's two inputs go (#385).
    pub blend_inputs: Option<PathBuf>,
}

/// The Vello CPU version Cargo.lock holds, which every answer names (a test holds it to the lock).
pub const VELLO_CPU: &str = "0.3.0";

/// A SIMD level as a request names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Simd {
    Scalar,
    Neon,
    Detected,
}

/// What a `raster` line asks Vello CPU to draw with (#385, criterion 4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    pub simd: Simd,
    /// The u8 pipeline rather than f32.
    pub u8: bool,
    pub golden: bool,
}

impl Config {
    /// The setting a golden can't take, if any: goldens render at the scalar level through the
    /// f32 pipeline, the configuration Vello's own snapshot suite takes as its reference.
    pub fn refusal(&self) -> Option<&'static str> {
        if !self.golden {
            None
        } else if self.simd != Simd::Scalar {
            Some("simd")
        } else if self.u8 {
            Some("pipeline")
        } else {
            None
        }
    }

    /// The level asked, on this machine; `None` for NEON where there is none.
    fn level(&self) -> Option<Level> {
        match self.simd {
            Simd::Scalar => Some(settings().level),
            Simd::Neon => Level::new().as_neon().map(Level::Neon),
            Simd::Detected => Some(Level::new()),
        }
    }

    fn rasterizer(&self) -> RasterizerSettings {
        RasterizerSettings {
            render_mode: if self.u8 {
                RenderMode::OptimizeSpeed
            } else {
                RenderMode::OptimizeQuality
            },
            ..rasterizer()
        }
    }
}

/// A level by its name: `scalar`, `neon`, or the x86 level detected.
fn level_name(level: Level) -> String {
    if matches!(level, Level::Fallback(_)) {
        "scalar".into()
    } else if level.as_neon().is_some() {
        "neon".into()
    } else {
        format!("{level:?}")
            .split('(')
            .next()
            .unwrap_or("detected")
            .to_lowercase()
    }
}

/// What a painter draws glyphs on: Vello CPU's context with the drawing's resources, or Vello
/// GPU's scene with its own.
pub(crate) trait Glyphs: Canvas {
    fn glyph(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size: f32,
        glyph: vello_cpu::Glyph,
    );
}

impl Glyphs for RenderContext {
    fn glyph(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size: f32,
        glyph: vello_cpu::Glyph,
    ) {
        let run = self.glyph_run(resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .fill_glyphs(std::iter::once(glyph));
    }
}

/// A rect, rounded when `radius` is above 0.
fn fill_box(ctx: &mut impl Canvas, b: [f64; 4], radius: f64) {
    if radius > 0.0 {
        ctx.fill_path(&RoundedRect::from_rect(rect(b), radius).to_path(0.1));
    } else {
        ctx.fill_rect(&rect(b));
    }
}

/// A ring `width` wide inside `b` with outer corner radius `radius` (a quad's border).
fn ring(ctx: &mut impl Canvas, b: [f64; 4], radius: f64, width: f64) {
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

/// One drawing of a document's view.
pub(crate) struct Painter<'a, C> {
    pub(crate) ctx: C,
    resources: Resources,
    store: Option<&'a std::path::Path>,
    scopes: Scopes,
    pub(crate) zoom: f64,
    spans_apart: bool,
    /// Each text@1 item drawn: what it shows and its glyphs.
    texts: Map<String, Value>,
}

/// The planted run: each span the runs cut the text into shaped on its own, the pieces set side
/// by side, so nothing kerns across a span's edge.
fn shaped_apart(label: &deep_text_gpui::Label, runs: &[scene::TextRun]) -> deep_text::Shaped {
    let text = label.text.as_str();
    let starts = deep_text::unicode::grapheme_starts(text);
    let mut cuts: Vec<usize> = runs
        .iter()
        .flat_map(|r| [r.from, r.to])
        .chain([0, starts.len()])
        .filter(|&g| g <= starts.len())
        .collect();
    cuts.sort_unstable();
    cuts.dedup();
    let byte = |g: usize| starts.get(g).copied().unwrap_or(text.len());
    let mut out = deep_text::Shaped {
        shown: text.to_string(),
        ..deep_text::Shaped::default()
    };
    for pair in cuts.windows(2) {
        let piece = deep_text_gpui::shape(&deep_text_gpui::Label {
            text: text[byte(pair[0])..byte(pair[1])].to_string(),
            ..label.clone()
        });
        for g in &piece.glyphs {
            out.glyphs.push(deep_text::Glyph {
                x: g.x + out.width,
                grapheme: g.grapheme + pair[0],
                ..g.clone()
            });
        }
        out.width += piece.width;
    }
    out
}

/// A glyph of a text's run as `texts` reports it, in document units (#381); the app's frame
/// reports its runs the same way (#140).
pub(crate) fn glyph_row(g: &deep_text::Glyph, role: Option<&str>) -> Value {
    let font = deep_text::face_of(&g.font).map(|f| format!("crates/deep-text/fonts/{}", f.file));
    json!({
        "font": font, "size": g.size, "id": g.id, "x": g.x, "y": g.y,
        "grapheme": g.grapheme, "role": role,
    })
}

impl<C: Glyphs> Painter<'_, C> {
    /// A painter on `ctx` at zoom 1 that reads no asset store.
    pub(crate) fn on(ctx: C) -> Self {
        Painter {
            ctx,
            resources: Resources::new(),
            store: None,
            scopes: Scopes::new(false),
            zoom: 1.0,
            spans_apart: false,
            texts: Map::new(),
        }
    }

    /// `marks` in order, each inside its scopes, and every scope closed after.
    pub(crate) fn marks<'d>(
        &mut self,
        marks: impl IntoIterator<Item = &'d Drawn>,
    ) -> Result<(), Value> {
        for drawn in marks {
            self.scopes
                .enter(&mut self.ctx, &mut self.resources, &drawn.scopes);
            self.mark(&drawn.mark)?;
        }
        self.scopes.enter(&mut self.ctx, &mut self.resources, &[]);
        Ok(())
    }

    fn text(&mut self, label: &deep_text_gpui::Label, origin: [f64; 2], color: Rgb) {
        let shaped = deep_text_gpui::shape(label);
        self.glyphs(&shaped, origin, (None, color), &[]);
    }

    /// A shaped run's glyphs at `origin`, each in its run's role or the text's.
    fn glyphs(
        &mut self,
        shaped: &deep_text::Shaped,
        origin: [f64; 2],
        (role, color): (Option<&str>, Rgb),
        runs: &[scene::TextRun],
    ) -> Vec<Value> {
        let mut out = Vec::with_capacity(shaped.glyphs.len());
        for g in &shaped.glyphs {
            let (role, color) = scene::run_paint(runs, g.grapheme, role, color);
            self.ctx.set_paint(solid(color));
            let glyph = vello_cpu::Glyph {
                id: g.id,
                x: g.x + origin[0] as f32,
                y: g.y + origin[1] as f32,
            };
            self.ctx.glyph(&mut self.resources, &g.font, g.size, glyph);
            out.push(glyph_row(g, role));
        }
        out
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
                role,
                color,
                runs,
            } => {
                let label = label_of(spec)
                    .ok_or_else(|| refused("bad_font", &format!("items/{item}/params/font")))?;
                let shaped = if self.spans_apart && !runs.is_empty() {
                    std::sync::Arc::new(shaped_apart(&label, runs))
                } else {
                    deep_text_gpui::shape(&label)
                };
                let glyphs = self.glyphs(&shaped, *origin, (role.as_deref(), *color), runs);
                // A text@1 item's own text; a mark set's or an axis's labels are `<id>#…`.
                if !item.contains('#') {
                    self.texts
                        .insert(item.clone(), json!({"shown": spec.text, "glyphs": glyphs}));
                }
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
                let to = fit.fitted(*bounds, [w, h]);
                self.ctx.set_paint(
                    Image {
                        image: ImageSource::Pixmap(Arc::new(pixmap)),
                        sampler: sampler(*sampling),
                    }
                    .into(),
                );
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
    let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
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
    let level = req
        .config
        .level()
        .ok_or_else(|| refused("unsupported_level", "simd"))?;
    let new_ctx = || {
        let mut ctx = RenderContext::new_with(
            w,
            h,
            RenderSettings {
                level,
                num_threads: 0,
            },
        );
        ctx.set_transform(Affine::scale(zoom));
        ctx
    };
    let mut p = Painter {
        ctx: new_ctx(),
        resources: Resources::new(),
        store: req.store.as_deref(),
        scopes: Scopes::new(req.encoded_luma),
        zoom,
        spans_apart: req.spans_apart,
        texts: Map::new(),
    };
    p.ctx.set_paint(solid(frame.ground));
    p.ctx
        .fill_rect(&rect([0.0, 0.0, frame.size[0], frame.size[1]]));
    let raster = req.config.rasterizer();
    let mut inputs = Vec::new();
    for layer in &frame.layers {
        let marks: Vec<&Drawn> = layer.marks.iter().map(|m| &**m).collect();
        inputs.extend(composite(&mut p, &marks, &new_ctx, raster)?);
    }
    for prim in &prims {
        p.prim(prim);
    }
    let mut pixmap = Pixmap::new(w, h);
    p.ctx
        .render_with(&mut pixmap, &mut p.resources, req.config.rasterizer());
    let bytes = pixmap.take_rgba8(ImageAlphaType::Alpha);
    let image = image::RgbaImage::from_raw(u32::from(w), u32::from(h), bytes)
        .ok_or_else(|| refused("not_written", &req.out))?;
    image
        .save_with_format(&req.out, image::ImageFormat::Png)
        .map_err(|_| refused("not_written", &req.out))?;
    let mut answer = json!({
        "ok": true, "width": w, "height": h, "offscreen": p.scopes.offscreen, "texts": p.texts,
        "backends": crate::backends(true), "golden": req.config.golden,
        "renderer": {
            "name": "vello_cpu", "version": VELLO_CPU,
            "pipeline": if req.config.u8 { "u8" } else { "f32" }, "simd": level_name(level),
        },
    });
    if let Some(dir) = &req.blend_inputs {
        let write = |name: String, pixmap: &Pixmap| -> Result<String, Value> {
            let path = dir.join(name);
            let shown = path.display().to_string();
            image::RgbaImage::from_raw(
                u32::from(w),
                u32::from(h),
                pixmap.data_as_u8_slice().to_vec(),
            )
            .ok_or_else(|| refused("not_written", &shown))?
            .save_with_format(&path, image::ImageFormat::Png)
            .map_err(|_| refused("not_written", &shown))?;
            Ok(shown)
        };
        let mut listed = Vec::new();
        for i in &inputs {
            listed.push(json!({
                "group": i.group, "mode": i.blend.name(),
                "backdrop": write(format!("{}.backdrop.png", i.group), &i.backdrop)?,
                "source": write(format!("{}.source.png", i.group), &i.source)?,
            }));
        }
        answer["blend_inputs"] = Value::Array(listed);
    }
    Ok(answer)
}

/// Each group that names a blend mode and that `marks` draw through, by its item ID, in the order
/// they first draw.
fn blended<'a>(marks: impl IntoIterator<Item = &'a Drawn>) -> Vec<(String, Blend)> {
    let mut out: Vec<(String, Blend)> = Vec::new();
    for drawn in marks {
        for s in &drawn.scopes {
            if let Scope::Opacity {
                item,
                blend: Some(blend),
                ..
            } = s
            {
                if !out.iter().any(|(g, _)| g == item) {
                    out.push((item.clone(), *blend));
                }
            }
        }
    }
    out
}

/// A blended group's two 8-bit premultiplied inputs, as the layer composited them.
struct Inputs {
    group: String,
    blend: Blend,
    backdrop: Pixmap,
    source: Pixmap,
}

/// `pixmap` over the whole canvas, pixel for pixel.
fn put(ctx: &mut RenderContext, pixmap: Pixmap) {
    let at = *ctx.transform();
    ctx.set_transform(Affine::IDENTITY);
    ctx.reset_paint_transform();
    ctx.set_paint(Image {
        image: ImageSource::Pixmap(Arc::new(pixmap)),
        sampler: sampler(scene::ImageSampling::Nearest),
    });
    ctx.fill_rect(&rect([
        0.0,
        0.0,
        f64::from(ctx.width()),
        f64::from(ctx.height()),
    ]));
    ctx.set_transform(at);
}

/// One writer layer's `marks` drawn by `p`. A layer that holds a group in a blend mode draws
/// alone, so the group blends only with what its own layer drew before it, and each such group
/// is composited from two 8-bit premultiplied pictures, that backdrop and its own content drawn
/// isolated: the inputs a golden's expected value applies the formula to (Frame and group: blend
/// modes), which this returns.
fn composite<'s>(
    p: &mut Painter<'s, RenderContext>,
    marks: &[&Drawn],
    new_ctx: &dyn Fn() -> RenderContext,
    raster: RasterizerSettings,
) -> Result<Vec<Inputs>, Value> {
    if blended(marks.iter().copied()).is_empty() {
        p.marks(marks.iter().copied())?;
        return Ok(Vec::new());
    }
    let sub = |p: &Painter<'s, RenderContext>| Painter {
        store: p.store,
        zoom: p.zoom,
        spans_apart: p.spans_apart,
        ..Painter::on(new_ctx())
    };
    let render = |q: &mut Painter<'s, RenderContext>| {
        let mut pixmap = Pixmap::new(q.ctx.width(), q.ctx.height());
        q.ctx.render_with(&mut pixmap, &mut q.resources, raster);
        pixmap
    };
    let mut inputs = Vec::new();
    let mut layer = sub(p);
    let mut i = 0;
    while i < marks.len() {
        // The next mark inside a group that names a blend, and the group's run of marks.
        let found = marks[i..].iter().enumerate().find_map(|(k, d)| {
            d.scopes.iter().enumerate().find_map(|(at, s)| match s {
                Scope::Opacity {
                    item,
                    alpha,
                    blend: Some(b),
                } => Some((i + k, at, item.clone(), *alpha, *b)),
                _ => None,
            })
        });
        let Some((start, at, group, alpha, blend)) = found else {
            layer.marks(marks[i..].iter().copied())?;
            break;
        };
        let end = marks[start..]
            .iter()
            .position(|d| !d.scopes.iter().any(|s| s.item() == group))
            .map_or(marks.len(), |n| start + n);
        layer.marks(marks[i..start].iter().copied())?;
        let backdrop = render(&mut layer);
        let mut content = sub(p);
        let inside: Vec<Drawn> = marks[start..end]
            .iter()
            .map(|d| Drawn {
                scopes: d.scopes[at + 1..].to_vec(),
                ..(*d).clone()
            })
            .collect();
        content.marks(inside.iter())?;
        p.texts.append(&mut content.texts);
        let source = render(&mut content);
        layer = sub(p);
        put(&mut layer.ctx, backdrop.clone());
        let outer = &marks[start].scopes[..at];
        layer
            .scopes
            .enter(&mut layer.ctx, &mut layer.resources, outer);
        let mode = (blend != Blend::Normal).then(|| deep_marks_vello::blend_mode(blend));
        Canvas::push_layer(&mut layer.ctx, None, mode, Some(alpha as f32), None);
        put(&mut layer.ctx, source.clone());
        layer.ctx.pop_layer();
        layer
            .scopes
            .enter(&mut layer.ctx, &mut layer.resources, &[]);
        p.scopes.offscreen += 3;
        inputs.push(Inputs {
            group,
            blend,
            backdrop,
            source,
        });
        i = end;
    }
    p.texts.append(&mut layer.texts);
    let drawn = render(&mut layer);
    put(&mut p.ctx, drawn);
    Ok(inputs)
}

/// #140: `marks` alone over transparent black at `size` px and zoom 1, as `draw` paints them with
/// no ground and no status marks; straight alpha.
pub(crate) fn picture(marks: &[&scene::Drawn], size: [u32; 2]) -> Result<image::RgbaImage, Value> {
    let (Ok(w), Ok(h)) = (u16::try_from(size[0]), u16::try_from(size[1])) else {
        return Err(refused("out_of_range", "size"));
    };
    let mut p = Painter::on(RenderContext::new_with(w, h, settings()));
    let new_ctx = || RenderContext::new_with(w, h, settings());
    composite(&mut p, marks, &new_ctx, rasterizer())?;
    let mut pixmap = Pixmap::new(w, h);
    p.ctx
        .render_with(&mut pixmap, &mut p.resources, rasterizer());
    image::RgbaImage::from_raw(size[0], size[1], pixmap.take_rgba8(ImageAlphaType::Alpha))
        .ok_or_else(|| refused("not_written", "picture"))
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
