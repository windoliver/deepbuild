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

use deep_canvas_marks::data;
use deep_canvas_marks::look::Look;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{self, Mark, Planted, Record, Rgb};
use deep_canvas_marks::scene::{Blend, Drawn, Scope};
use deep_canvas_marks::story;
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
    /// Each `vector@1` item's import, and how its write draws (#398).
    pub vectors: crate::Vectors,
    pub write: deep_canvas_vector::Write,
    /// #399: `false` draws the whole frame without antialiasing.
    pub antialias: bool,
    /// #496's wrong programs on a text's glyphs, and its build that snaps a driven weight to the
    /// nearest static face.
    pub text_plant: deep_canvas_marks::animator::Plant,
    pub snaps_weight: bool,
    /// #1646: the look's CRT afterglow, flicks.
    pub afterglow: Option<i64>,
}

/// What a text's per-glyph layout reads at a frame (#496): the document, its evaluated items,
/// the frame's time and record, and the wrong program planted.
pub(crate) struct Anim {
    doc: Map<String, Value>,
    items: Map<String, Value>,
    t: i64,
    record: Record,
    locale: String,
    plant: deep_canvas_marks::animator::Plant,
    snaps_weight: bool,
    /// The look's roles, which a glyph's color and stroke props name.
    palette: scene::Palette,
    /// #1646: the look's CRT afterglow, flicks.
    afterglow: Option<i64>,
}

/// The host a text's layout asks for shaped strings and a counter's other strings.
struct Host<'a> {
    label: &'a deep_text_gpui::Label,
    anim: &'a Anim,
    id: &'a str,
}

impl deep_canvas_marks::animator::Host for Host<'_> {
    fn shape(&mut self, text: &str) -> Arc<deep_text::Shaped> {
        deep_text_gpui::shape(&deep_text_gpui::Label {
            text: text.to_string(),
            ..self.label.clone()
        })
    }

    fn counter_text(&mut self, value: f64) -> Result<Option<String>, scene::Refused> {
        let Some(mut item) = self.anim.items.get(self.id).cloned() else {
            return Ok(None);
        };
        let source = item
            .pointer("/params/text/counter/source")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if let Some(name) = source.strip_prefix("data/") {
            if let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) {
                let data = params.entry("data").or_insert_with(|| json!({}));
                if let Some(d) = data.as_object_mut() {
                    d.insert(name.to_string(), json!(value));
                }
            }
        }
        let shown = scene::text_at(
            &self.anim.doc,
            &self.anim.items,
            self.id,
            &item,
            &self.anim.record,
            &self.anim.locale,
        )?;
        Ok(shown.map(|s| s.text))
    }
}

/// A glyph's outline in its own frame, as `texts` reports it (#496).
fn outline_row(g: &deep_text::Glyph) -> Value {
    use deep_text::outlines::Cmd;
    let cmds: Vec<Value> = deep_text::outlines::outline_of(g)
        .unwrap_or_default()
        .into_iter()
        .map(|c| match c {
            Cmd::Move(p) => json!(["M", p[0], p[1]]),
            Cmd::Line(p) => json!(["L", p[0], p[1]]),
            Cmd::Quad(a, p) => json!(["Q", a[0], a[1], p[0], p[1]]),
            Cmd::Cubic(a, b, p) => json!(["C", a[0], a[1], b[0], b[1], p[0], p[1]]),
            Cmd::Close => json!(["Z"]),
        })
        .collect();
    Value::Array(cmds)
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
        coords: &[i16],
        glyph: vello_cpu::Glyph,
    );

    /// #496: a glyph's outline stroked `width` px wide in the current paint.
    fn glyph_stroke(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size: f32,
        coords: &[i16],
        glyph: vello_cpu::Glyph,
        width: f64,
    );

    /// #496: opens a layer blurred by `radius` px, closed by `pop_layer`; false where this canvas
    /// can't blur, and nothing was opened.
    fn push_blur(&mut self, _radius: f32) -> bool {
        false
    }
}

impl Glyphs for RenderContext {
    fn glyph(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size: f32,
        coords: &[i16],
        glyph: vello_cpu::Glyph,
    ) {
        let run = self.glyph_run(resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .normalized_coords(coords)
            .fill_glyphs(std::iter::once(glyph));
    }

    fn glyph_stroke(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size: f32,
        coords: &[i16],
        glyph: vello_cpu::Glyph,
        width: f64,
    ) {
        self.set_stroke(stroke(width));
        let run = self.glyph_run(resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .normalized_coords(coords)
            .stroke_glyphs(std::iter::once(glyph));
    }

    fn push_blur(&mut self, radius: f32) -> bool {
        use vello_cpu::filter_effects::{Filter, FilterFunction};
        self.push_filter_layer(Filter::from_function(FilterFunction::Blur { radius }));
        true
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
    /// #496: what a text's per-glyph layout reads; `None` where no frame's evaluation is at hand.
    anim: Option<Arc<Anim>>,
    resources: Resources,
    store: Option<&'a std::path::Path>,
    scopes: Scopes,
    pub(crate) zoom: f64,
    spans_apart: bool,
    /// Each text@1 item drawn, and each row of a text mark set (`<set>#<row key>`, #397): what
    /// it shows and its glyphs.
    texts: Map<String, Value>,
    /// The text mark sets whose rows `texts` reports.
    text_sets: Vec<String>,
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

/// A glyph of a text's run as `texts` reports it, in document units (#381), with (#417) the
/// language its run was shaped in; the app's frame reports its runs the same way (#140).
pub(crate) fn glyph_row(g: &deep_text::Glyph, role: Option<&str>, lang: Option<&str>) -> Value {
    let font = deep_text::face_of(&g.font).map(|f| format!("crates/deep-text/fonts/{}", f.file));
    json!({
        "font": font, "size": g.size, "id": g.id, "x": g.x, "y": g.y,
        "grapheme": g.grapheme, "role": role, "lang": lang,
    })
}

impl<C: Glyphs> Painter<'_, C> {
    /// A painter on `ctx` at zoom 1 that reads no asset store.
    pub(crate) fn on(ctx: C) -> Self {
        Painter {
            ctx,
            anim: None,
            resources: Resources::new(),
            store: None,
            scopes: Scopes::new(false),
            zoom: 1.0,
            spans_apart: false,
            texts: Map::new(),
            text_sets: Vec::new(),
        }
    }

    /// `marks` in order, each inside its scopes, and every scope closed after.
    pub(crate) fn marks<'d>(
        &mut self,
        marks: impl IntoIterator<Item = &'d Drawn>,
    ) -> Result<(), Value> {
        for drawn in marks {
            // A backdrop group's children only shape its coverage, on the GPU layer.
            let shapes_coverage = drawn
                .scopes
                .iter()
                .any(|s| matches!(s, Scope::Opacity { effect: Some(e), .. } if e.backdrop));
            if shapes_coverage {
                continue;
            }
            self.scopes
                .enter(&mut self.ctx, &mut self.resources, &drawn.scopes);
            self.mark(&drawn.mark)?;
        }
        self.scopes.enter(&mut self.ctx, &mut self.resources, &[]);
        Ok(())
    }

    fn text(&mut self, label: &deep_text_gpui::Label, origin: [f64; 2], color: Rgb) {
        let shaped = deep_text_gpui::shape(label);
        self.glyphs(&shaped, origin, (None, color), (&[], None));
    }

    /// A shaped run's glyphs at `origin`, each in its run's role or the text's.
    fn glyphs(
        &mut self,
        shaped: &deep_text::Shaped,
        origin: [f64; 2],
        (role, color): (Option<&str>, Rgb),
        (runs, lang): (&[scene::TextRun], Option<&str>),
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
            self.ctx
                .glyph(&mut self.resources, &g.font, g.size, &g.coords, glyph);
            let mut row = glyph_row(g, role, lang);
            // #496: the glyph's advance, outline and place, upright and unclipped here.
            let e = origin[0] + f64::from(g.x);
            let f = origin[1] + f64::from(g.y);
            row["advance"] = json!(g.advance);
            row["outline"] = outline_row(g);
            row["transform"] = json!([1.0, 0.0, 0.0, 1.0, e, f]);
            row["clip"] = Value::Null;
            out.push(row);
        }
        out
    }

    /// #496: a text's glyphs as its animators, curve and roll place them, each drawn through its
    /// own transform, in its cell while it rolls.
    fn placed(
        &mut self,
        laid: &deep_canvas_marks::animator::Laid,
        (role, color): (Option<&str>, Rgb),
        (runs, lang): (&[scene::TextRun], Option<&str>),
    ) -> Vec<Value> {
        let mut out = Vec::with_capacity(laid.glyphs.len());
        let base = self.ctx.transform();
        for p in &laid.glyphs {
            let g = &p.glyph;
            let (role, color) = scene::run_paint(runs, g.grapheme, role, color);
            let palette = self.anim.as_ref().map(|a| &a.palette);
            let role_rgb = |name: &str| palette.and_then(|p| p.get(name)).copied();
            let mut color = color;
            if let Some((name, f)) = &p.paint.color {
                if let Some(to) = role_rgb(name) {
                    color = deep_canvas_marks::paint::rgb_of(deep_canvas_marks::paint::oklab_mix(
                        color, to, *f,
                    ));
                }
            }
            let adjust = deep_canvas_marks::paint::Adjust {
                hue: p.paint.hue,
                saturation: p.paint.saturation,
                brightness: p.paint.brightness,
                ..Default::default()
            };
            let color = adjust.rgb(color);
            if let Some(c) = p.clip {
                self.ctx.push_clip_rect(&rect(c));
            }
            let faded = p.opacity < 1.0;
            if faded {
                self.ctx
                    .push_layer(None, None, Some(p.opacity as f32), None);
            }
            let blurred =
                p.paint.blur > 0.0 && self.ctx.push_blur((p.paint.blur * self.zoom) as f32);
            self.ctx.set_paint(solid(color));
            self.ctx.set_transform(base * Affine::new(p.transform));
            let glyph = vello_cpu::Glyph {
                id: g.id,
                x: 0.0,
                y: 0.0,
            };
            self.ctx
                .glyph(&mut self.resources, &g.font, g.size, &g.coords, glyph);
            if let Some((name, width)) = &p.paint.stroke {
                if let (Some(rgb), true) = (role_rgb(name), *width > 0.0) {
                    self.ctx.set_paint(solid(adjust.rgb(rgb)));
                    self.ctx.glyph_stroke(
                        &mut self.resources,
                        &g.font,
                        g.size,
                        &g.coords,
                        glyph,
                        *width,
                    );
                }
            }
            self.ctx.set_transform(base);
            if blurred {
                self.ctx.pop_layer();
            }
            if faded {
                self.ctx.pop_layer();
            }
            if p.clip.is_some() {
                self.ctx.pop_clip();
            }
            let mut row = glyph_row(g, role, lang);
            row["advance"] = json!(g.advance);
            row["outline"] = outline_row(g);
            row["transform"] = json!(p.transform);
            row["clip"] = json!(p.clip);
            row["opacity"] = json!(p.opacity);
            out.push(row);
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
                let mut label = label_of(spec)
                    .ok_or_else(|| refused("bad_font", &format!("items/{item}/params/font")))?;
                // #496's planted build: a driven weight drawn on the nearest static face.
                if self.anim.as_ref().is_some_and(|a| a.snaps_weight) {
                    label.family = deep_text::fonts::static_of(label.family);
                }
                let shaped = if self.spans_apart && !runs.is_empty() {
                    std::sync::Arc::new(shaped_apart(&label, runs))
                } else {
                    deep_text_gpui::shape(&label)
                };
                let anim = self.anim.clone();
                let params = anim
                    .as_ref()
                    .filter(|_| !item.contains('#'))
                    .and_then(|a| a.items.get(item.as_str()))
                    .and_then(|i| i.get("params"))
                    .and_then(Value::as_object)
                    .filter(|p| deep_canvas_marks::animator::animated(p));
                if let (Some(a), Some(params)) = (anim.as_deref(), params) {
                    let levels = deep_canvas_marks::animator::reveal_levels(params, &shaped, item)
                        .map_err(|r| refused(r.code, &r.path))?;
                    let reveal_times = match levels {
                        Some(levels) => reveal_times(&a.doc, item, &levels)?,
                        None => Vec::new(),
                    };
                    let input = deep_canvas_marks::animator::Input {
                        id: item,
                        params,
                        run: &shaped,
                        origin: *origin,
                        t: a.t,
                        doc: &a.doc,
                        items: &a.items,
                        bound: spec.bound,
                        plant: a.plant,
                        reveal_times: &reveal_times,
                        afterglow: a.afterglow,
                    };
                    let mut host = Host {
                        label: &label,
                        anim: a,
                        id: item,
                    };
                    let laid = deep_canvas_marks::animator::lay_out(&input, &mut host)
                        .map_err(|r| refused(r.code, &r.path))?;
                    let glyphs = self.placed(
                        &laid,
                        (role.as_deref(), *color),
                        (runs, spec.lang.as_deref()),
                    );
                    let mut text =
                        json!({"shown": shaped.shown, "glyphs": glyphs, "coverage": laid.coverage});
                    if !laid.reveal.is_empty() {
                        text["reveal"] = json!(laid.reveal);
                        if a.afterglow.is_some() {
                            text["afterglow"] = json!(laid.afterglow);
                        }
                    }
                    self.texts.insert(item.clone(), text);
                    return Ok(());
                }
                let glyphs = self.glyphs(
                    &shaped,
                    *origin,
                    (role.as_deref(), *color),
                    (runs, spec.lang.as_deref()),
                );
                // A text@1 item's own text, and a text mark set's rows; an axis's labels aren't.
                let row_of_set = item
                    .split_once('#')
                    .is_some_and(|(set, _)| self.text_sets.iter().any(|s| s == set));
                // #467: the run's box, where its glyphs advance, in document u.
                let at = match (spec.align, spec.width) {
                    (scene::Align::Center, Some(w)) => (w - f64::from(shaped.width)) / 2.0,
                    (scene::Align::End, Some(w)) => w - f64::from(shaped.width),
                    _ => 0.0,
                };
                let bounds = [
                    origin[0] + at,
                    origin[1],
                    f64::from(shaped.width),
                    f64::from(shaped.height),
                ];
                if !item.contains('#') || row_of_set {
                    self.texts.insert(
                        item.clone(),
                        json!({"shown": shaped.shown, "glyphs": glyphs, "bounds": bounds}),
                    );
                } else if item.ends_with("#drop") {
                    // A drop's copy of the shaped run, read back beside the text's own.
                    self.texts
                        .insert(item.clone(), json!({"glyphs": glyphs, "bounds": bounds}));
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

/// The document's evaluated items at `t`, placed by their relations (#221), each vector item
/// drawn as marks2d's items (#398), and each graph laid out and drawn as them (#399), with each
/// graph's view.
/// #1646: each revealed unit's reveal time, compiled from the document: the first whole flick at
/// which the reveal's progress reaches the unit's level ([`animator::reveal_levels`]), searched
/// through the program between the progress's key times (as a reveal's progress is keyed to run
/// forward), never from the frame drawn. A unit the progress never reaches reveals at no time.
///
/// [`animator::reveal_levels`]: deep_canvas_marks::animator::reveal_levels
fn reveal_times(doc: &Map<String, Value>, id: &str, levels: &[f64]) -> Result<Vec<i64>, Value> {
    let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
    let field = ["params", "reveal", "progress"].map(String::from);
    let Some(slot) = program.slot_of(id, &field) else {
        // An unkeyed progress is the same at every time: each unit revealed from the start, or
        // never.
        let p = doc
            .get("items")
            .and_then(|i| i.get(id))
            .and_then(|i| i.pointer("/params/reveal/progress"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        return Ok(levels
            .iter()
            .map(|l| if p >= *l { 0 } else { i64::MAX })
            .collect());
    };
    let mut state = program.state();
    let mut at = |t: i64| {
        program.evaluate(t, deep_canvas_motion::eval::Validity::Full, &mut state);
        state.slots[slot]
    };
    let mut keys = program.slot_key_times(slot);
    keys.sort_unstable();
    keys.dedup();
    let (Some(&first), Some(&last)) = (keys.first(), keys.last()) else {
        return Ok(vec![i64::MAX; levels.len()]);
    };
    let mut out = Vec::with_capacity(levels.len());
    for level in levels {
        if at(first) >= *level {
            out.push(0);
            continue;
        }
        if at(last) < *level {
            out.push(i64::MAX);
            continue;
        }
        let (mut lo, mut hi) = (first, last);
        while hi - lo > 1 {
            let mid = lo + (hi - lo) / 2;
            if at(mid) >= *level {
                hi = mid;
            } else {
                lo = mid;
            }
        }
        out.push(hi);
    }
    Ok(out)
}

fn items_at(
    doc: &Map<String, Value>,
    t: i64,
    vectors: &crate::Vectors,
    write: deep_canvas_vector::Write,
    router: deep_canvas_graph::view::Router,
) -> Result<(Map<String, Value>, crate::graphs::Graphs), Value> {
    let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
    let items = crate::place::evaluated(doc, &program, t, vectors)?;
    let items = deep_canvas_vector::lower_items(&items, vectors, write);
    crate::graphs::lower(doc, &items, vectors, router)
}

/// The labels of `doc` at `t`, aimed at their targets, against everything else it draws (#399).
pub fn label_board(
    doc: &Map<String, Value>,
    look: &Look,
    t: i64,
    vectors: &crate::Vectors,
) -> Result<crate::graphs::Board, Value> {
    let (items, graphs) = items_at(
        doc,
        t,
        vectors,
        deep_canvas_vector::Write::Honest,
        Default::default(),
    )?;
    let mut bare = items.clone();
    bare.retain(|_, i| i["kind"] != "label@1");
    let theme = crate::Theme::Light;
    let record = Record {
        pinned: t,
        ..Record::default()
    };
    let under = scene::frame_planted(
        doc,
        &bare,
        (palette_of(look, theme), crate::type_of(look, theme)),
        &record,
        1.0,
        Planted::None,
    )
    .map_err(|r| refused(r.code, &r.path))?;
    crate::graphs::board(doc, &items, &graphs, &under)
}

/// #496: the items whose weight a driver or a channel writes.
fn driven_weights(doc: &Map<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    for section in ["drivers", "channels"] {
        for d in doc
            .get(section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let target = d.1.get("target").and_then(Value::as_str).unwrap_or("");
            if let Some(id) = target
                .strip_prefix("items/")
                .and_then(|r| r.strip_suffix("/params/weight"))
            {
                out.push(id.to_string());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// #496, at check: every weight a driven text takes on the document's frames, rounded to a
/// whole unit, is shaped once and kept in the shaped-run cache, so playing shapes nothing. Once
/// per document per process.
pub(crate) fn preshape(req: &Request) {
    use std::collections::HashSet;
    use std::hash::{Hash, Hasher};
    use std::sync::{LazyLock, Mutex};
    static SEEN: LazyLock<Mutex<HashSet<u64>>> = LazyLock::new(Mutex::default);
    let driven = driven_weights(&req.doc);
    if driven.is_empty() {
        return;
    }
    let mut h = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&req.doc)
        .unwrap_or_default()
        .hash(&mut h);
    (req.snaps_weight, req.view.theme as u8).hash(&mut h);
    if !SEEN
        .lock()
        .map(|mut s| s.insert(h.finish()))
        .unwrap_or(false)
    {
        return;
    }
    let transport = req.doc.get("transport").cloned().unwrap_or(Value::Null);
    let (p, q) = deep_canvas::document::frame_rate_of(&transport).unwrap_or((60, 1));
    let doc = Value::Object(req.doc.clone());
    let Some(span) = transport
        .get("span")
        .and_then(|s| deep_canvas::document::duration(&doc, s).ok())
    else {
        return;
    };
    let frame = 705_600_000 * i64::from(q) / i64::from(p.max(1));
    let ty = crate::type_of(&req.look, req.view.theme);
    let mut weights: HashSet<(String, u16)> = HashSet::new();
    for k in 0..=span / frame.max(1) {
        let Ok((items, _)) = items_at(
            &req.doc,
            k * frame,
            &req.vectors,
            req.write,
            Default::default(),
        ) else {
            return;
        };
        for id in &driven {
            let Some(params) = items
                .get(id)
                .and_then(|i| i.get("params"))
                .and_then(Value::as_object)
            else {
                continue;
            };
            let Ok(spec) = scene::text_spec_in(id, params, None, ty) else {
                continue;
            };
            if !weights.insert((id.clone(), spec.weight)) {
                continue;
            }
            if let Some(mut label) = label_of(&spec) {
                if req.snaps_weight {
                    label.family = deep_text::fonts::static_of(label.family);
                }
                deep_text_gpui::shape(&label);
            }
        }
    }
}

/// Draws a `raster` request and writes its PNG.
pub fn answer(req: Request) -> Value {
    match draw(&req) {
        Ok(v) | Err(v) => v,
    }
}

fn draw(req: &Request) -> Result<Value, Value> {
    let (mut items, graphs) =
        items_at(&req.doc, req.t, &req.vectors, req.write, Default::default())?;
    let palette = palette_of(&req.look, req.view.theme);
    let record = Record {
        pinned: req.t,
        ..req.record.clone()
    };
    let zoom = req.view.zoom;
    let ty = crate::type_of(&req.look, req.view.theme);
    // #399: labels place against everything else the frame draws, then draw as texts.
    if items.values().any(|i| i["kind"] == "label@1") {
        let mut bare = items.clone();
        bare.retain(|_, i| i["kind"] != "label@1");
        let under = scene::frame_planted(&req.doc, &bare, (palette, ty), &record, 1.0, req.planted)
            .map_err(|r| refused(r.code, &r.path))?;
        let board = crate::graphs::board(&req.doc, &items, &graphs, &under)?;
        board.draw(&mut bare, crate::graphs::Placer::Honest);
        items = bare;
    }
    let frame = scene::frame_planted(&req.doc, &items, (palette, ty), &record, zoom, req.planted)
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
        // #399: a frame drawn without antialiasing paints a pixel whole or not at all.
        if !req.antialias {
            ctx.set_aliasing_threshold(Some(127));
        }
        ctx
    };
    let mut p = Painter {
        ctx: new_ctx(),
        anim: Some(Arc::new(Anim {
            doc: req.doc.clone(),
            items: items.clone(),
            t: req.t,
            record: record.clone(),
            locale: req
                .doc
                .get("locale")
                .and_then(Value::as_str)
                .unwrap_or("en")
                .to_string(),
            plant: req.text_plant,
            snaps_weight: req.snaps_weight,
            palette: palette.clone(),
            afterglow: req.afterglow,
        })),
        resources: Resources::new(),
        store: req.store.as_deref(),
        scopes: Scopes::new(req.encoded_luma),
        zoom,
        spans_apart: req.spans_apart,
        texts: Map::new(),
        text_sets: req
            .doc
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .filter(|(_, i)| i["kind"] == "marks@1" && i["params"]["mark"] == "text")
            .map(|(id, _)| id.clone())
            .collect(),
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
    fit_paint(&frame, &mut p.texts)?;
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
        anim: p.anim.clone(),
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
                    ..
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
        // #467: a part an item's paint builds from its coverage, which `source` holds.
        let part = match &marks[start].scopes[at] {
            Scope::Opacity {
                effect: Some(e), ..
            } => e.paint.clone(),
            _ => None,
        };
        let source = match part {
            Some(part) => painted(&source, &part, p.zoom as f32),
            None => source,
        };
        // What the layer drew so far keeps its texts' readings.
        p.texts.append(&mut layer.texts);
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

/// #467: each text's bounds grown by what its paint draws past its run (a drop's copy, an outer
/// glow or bevel), and its drop's glyphs under `drop`; a number whose bounds then pass its box
/// doesn't fit and fails (Honest numbers), naming it.
fn fit_paint(frame: &scene::Frame, texts: &mut Map<String, Value>) -> Result<(), Value> {
    let union = |a: [f64; 4], b: [f64; 4]| {
        let (x0, y0) = (a[0].min(b[0]), a[1].min(b[1]));
        let (x1, y1) = ((a[0] + a[2]).max(b[0] + b[2]), (a[1] + a[3]).max(b[1] + b[3]));
        [x0, y0, x1 - x0, y1 - y0]
    };
    let four = |v: &Value| -> Option<[f64; 4]> {
        let l = v.as_array()?;
        Some([l.first()?.as_f64()?, l.get(1)?.as_f64()?, l.get(2)?.as_f64()?, l.get(3)?.as_f64()?])
    };
    let marks: Vec<&Drawn> = frame.layers.iter().flat_map(|l| l.marks.iter().map(|m| &**m)).collect();
    for drawn in &marks {
        let Mark::Text { item, spec, origin, .. } = &drawn.mark else {
            continue;
        };
        if item.contains('#') {
            continue;
        }
        let Some(mut bounds) = texts.get(item).and_then(|t| four(&t["bounds"])) else {
            continue;
        };
        if let Some(mut copy) = texts.remove(&format!("{item}#drop")) {
            if let Some(b) = four(&copy["bounds"]) {
                bounds = union(bounds, b);
            }
            // The copy's glyphs in the text's own frame: moved by where the copy sits from it.
            let at = marks.iter().find_map(|d| match &d.mark {
                Mark::Text { item: i, origin: o, .. } if *i == format!("{item}#drop") => Some(*o),
                _ => None,
            });
            if let (Some(o), Some(list)) = (at, copy["glyphs"].as_array_mut()) {
                let d = [o[0] - origin[0], o[1] - origin[1]];
                for g in list.iter_mut() {
                    for (k, axis) in [("x", 0), ("y", 1)] {
                        if let Some(v) = g[k].as_f64() {
                            g[k] = json!(v + d[axis]);
                        }
                    }
                }
            }
            texts[item]["drop"] = json!({"glyphs": copy["glyphs"]});
        }
        let prefix = format!("{item}#");
        let mut seen = std::collections::BTreeSet::new();
        for d in &marks {
            if !d.mark.item().starts_with(&prefix) {
                continue;
            }
            for s in &d.scopes {
                if let Scope::Opacity { item: part_id, effect: Some(e), .. } = s {
                    if let (Some(part), true) = (&e.paint, seen.insert(part_id.clone())) {
                        let [l, t, r, b] = part.reach();
                        let own = texts[item]["bounds"].clone();
                        if let Some(o) = four(&own) {
                            bounds = union(bounds, [o[0] - l, o[1] - t, o[2] + l + r, o[3] + t + b]);
                        }
                    }
                }
            }
        }
        texts[item]["bounds"] = json!(bounds);
        if let (true, Some(w)) = (spec.bound, spec.width) {
            let eps = 1e-6;
            if bounds[0] < origin[0] - eps || bounds[0] + bounds[2] > origin[0] + w + eps {
                return Err(refused("number_unfit", &format!("items/{item}/params/box")));
            }
        }
    }
    Ok(())
}

/// #467: the part `part` builds from the coverage in `source`'s alpha, in its color: the CPU
/// reference, computed over the coverage's box grown by what the part reads.
fn painted(source: &Pixmap, part: &deep_canvas_marks::fx::Part, scale: f32) -> Pixmap {
    use deep_canvas_marks::fx::Grid;
    let (w, h) = (usize::from(source.width()), usize::from(source.height()));
    let bytes = source.data_as_u8_slice();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for y in 0..h {
        for x in 0..w {
            if bytes[(y * w + x) * 4 + 3] > 0 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
    }
    let mut out = vec![0u8; w * h * 4];
    if x0 < x1 {
        let m = (part.margin() * scale).ceil() as usize;
        let (x0, y0) = (x0.saturating_sub(m), y0.saturating_sub(m));
        let (x1, y1) = ((x1 + m).min(w), (y1 + m).min(h));
        let mut a = Grid::new(x1 - x0, y1 - y0);
        for y in y0..y1 {
            for x in x0..x1 {
                a.a[(y - y0) * a.w + (x - x0)] = f32::from(bytes[(y * w + x) * 4 + 3]) / 255.0;
            }
        }
        let alpha = part.alpha(&a, scale);
        let c = part.color();
        for y in y0..y1 {
            for x in x0..x1 {
                let v = alpha.a[(y - y0) * alpha.w + (x - x0)];
                let o = (y * w + x) * 4;
                out[o..o + 3].copy_from_slice(&c);
                out[o + 3] = (v * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    let size = [source.width(), source.height()];
    deep_marks_vello::image(out, size, 1.0, &Default::default())
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

/// An item's outline at `t` as subpaths of verbs and points in u, its offset applied, with its
/// box and box points (#221).
/// The time a set's periods take to mix its rows for this t, alone (#167 AC7).
fn mix_ms(id: &str, item: &Value) -> Result<f64, scene::Refused> {
    let path = format!("items/{id}/params");
    let params = scene::object_or_empty(item.get("params"));
    let base = || data::base_rows(id, item, &Default::default());
    let Some(compiled) = story::compiled(id, params, &path, base)? else {
        return Ok(0.0);
    };
    let at = story::at_of(params, &compiled.periods, &path)?;
    let start = std::time::Instant::now();
    std::hint::black_box(compiled.periods.at(&compiled.rows, at));
    Ok(start.elapsed().as_secs_f64() * 1e3)
}

/// The time standing takes to rank every period of `doc`'s mark sets, alone (#167 AC7).
pub fn rank_ms(doc: &Map<String, Value>) -> Result<f64, scene::Refused> {
    let mut total = 0.0;
    for (id, item) in scene::object_or_empty(doc.get("items")) {
        let path = format!("items/{id}/params");
        let params = scene::object_or_empty(item.get("params"));
        if item["kind"] != "marks@1" || !params.contains_key("transforms") {
            continue;
        }
        let list = story::listed(params, &path)?;
        if let [("periods", spec, at), ("standing", rank, rank_at), ..] = list.as_slice() {
            let rows = data::base_rows(id, item, &Default::default())?;
            let mut periods = story::Periods::compile(&rows, spec, at)?;
            let start = std::time::Instant::now();
            periods.rank(&rows, rank, rank_at)?;
            total += start.elapsed().as_secs_f64() * 1e3;
        }
    }
    Ok(total)
}

pub fn geometry(
    doc: &Map<String, Value>,
    item: &str,
    t: i64,
    vectors: &crate::Vectors,
    router: deep_canvas_graph::view::Router,
    (look, timing): (Option<&Look>, bool),
) -> Value {
    let run = || -> Result<Value, Value> {
        let program = Program::compile(doc).map_err(|r| refused(r.code, &r.path))?;
        let placed = crate::place::evaluated(doc, &program, t, vectors)?;
        let items =
            deep_canvas_vector::lower_items(&placed, vectors, deep_canvas_vector::Write::Honest);
        // #399: graphs drawn as marks2d's items; labels draw only in a view.
        let (mut items, graphs) = crate::graphs::lower(doc, &items, vectors, router)?;
        items.retain(|_, i| i["kind"] != "label@1");
        let mut palette = scene::Palette::new();
        palette.insert("ground".into(), [255, 255, 255]);
        // The role a text without a paint takes (#399: a card's lines).
        palette.insert("ink".into(), [0, 0, 0]);
        any_roles(&Value::Object(doc.clone()), &mut palette);
        // And those of the items a vector draws as.
        any_roles(&Value::Object(items.clone()), &mut palette);
        palette.extend(look.iter().flat_map(|l| l.light.clone()));
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
            subpaths.extend(subpaths_of(&verbs, by));
        }
        // A frame's border box, where its layout and every contribution put it (#399: a node's
        // place among them), whether or not it paints.
        if items.get(item).is_some_and(|i| i["kind"] == "frame@1") {
            let solved =
                scene::laid_out_boxes(doc, &items).map_err(|r| refused(r.code, &r.path))?;
            let b = solved
                .get(item)
                .copied()
                .or_else(|| crate::place::box_of(doc, &items, vectors, item));
            if let Some([x, y, w, h]) = b {
                let outline = [
                    Verb::Move([x, y]),
                    Verb::Line([x + w, y]),
                    Verb::Line([x + w, y + h]),
                    Verb::Line([x, y + h]),
                    Verb::Close,
                ];
                subpaths.extend(subpaths_of(&outline, [0.0, 0.0]));
            }
        }
        let mut answer = json!({"ok": true, "subpaths": subpaths});
        // A data item at t (#167): a mark set's rows, a scale's domain, an axis's ticks.
        let story = |r: scene::Refused| refused(r.code, &r.path);
        if let Some(found) = items.get(item) {
            match found["kind"].as_str() {
                Some("marks@1") => {
                    answer["rows"] =
                        data::rows_report(item, found, &items, &palette).map_err(story)?;
                    if timing {
                        answer["timing"] = json!({"mix_ms": mix_ms(item, found).map_err(story)?});
                    }
                }
                Some("scale@1") => {
                    answer["domain"] = data::domain_report(item, found, &items).map_err(story)?
                }
                Some("axis@1") => {
                    answer["ticks"] = data::ticks_report(item, found, &items).map_err(story)?
                }
                _ => {}
            }
        }
        // Its evaluated box at t, geometry only, and the nine box points on it (#221).
        if let Some(b) = crate::place::box_of(doc, &placed, vectors, item) {
            let points: Map<String, Value> = deep_canvas_marks::relations::POINTS
                .iter()
                .map(|(name, p)| (name.to_string(), json!(p.of(b))))
                .collect();
            answer["box"] = json!(b);
            answer["points"] = Value::Object(points);
        }
        // A vector's parts, each with its read-only id, source and box (#398).
        if let (Some(found), Some(v)) = (vectors.get(item), placed.get(item)) {
            answer["parts"] =
                deep_canvas_vector::parts_json(v, found, |verbs| subpaths_of(verbs, [0.0, 0.0]));
        }
        // A graph's laid-out nodes, its groups' boxes and titles, and its routes (#399).
        if let Some(g) = graphs.get(item) {
            let boxes = |m: &std::collections::BTreeMap<String, [f64; 4]>| {
                Value::Object(m.iter().map(|(k, b)| (k.clone(), json!(b))).collect())
            };
            answer["graph"] = json!({
                "nodes": boxes(&g.nodes),
                "groups": Value::Object(g.groups.iter().map(|(k, b)| {
                    (k.clone(), json!({"box": b.rect, "title": b.title}))
                }).collect()),
                "routes": Value::Object(g.routes.iter().map(|(k, r)| {
                    (k.clone(), json!(r.iter().map(|p| [p.0, p.1]).collect::<Vec<_>>()))
                }).collect()),
            });
        }
        // A series' rows behind the vertices its line draws, in draw order (#399).
        if let Some(s) = placed.get(item).filter(|i| i["kind"] == "series@1") {
            let how = match s["params"]["decimate"].as_str() {
                Some("none") => deep_canvas_marks::data::Decimate::None,
                _ => deep_canvas_marks::data::Decimate::M4,
            };
            let d = deep_canvas_marks::data::decimated(item, s, how)
                .map_err(|r| refused(r.code, &r.path))?;
            answer["series"] = json!({"rows": d.rows()});
        }
        Ok(answer)
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

/// `crosshair`: a series' crosshair at `x` u, snapped to the nearest raw row by time (#399).
pub fn crosshair(doc: &Map<String, Value>, item: &str, x: f64) -> Value {
    let run = || -> Result<Value, Value> {
        let s = doc
            .get("items")
            .and_then(|i| i.get(item))
            .filter(|i| i["kind"] == "series@1")
            .ok_or_else(|| refused("ref_unresolved", "item"))?;
        let d = deep_canvas_marks::data::decimated(item, s, deep_canvas_marks::data::Decimate::M4)
            .map_err(|r| refused(r.code, &r.path))?;
        let b = &s["params"]["box"];
        let pos = s
            .pointer("/at/pos/0")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        let (bx, bw) = (
            b[0].as_f64().unwrap_or(0.0) + pos,
            b[2].as_f64().unwrap_or(0.0),
        );
        let (t0, t1) = d.window;
        let at = t0 + (x - bx) / bw.max(f64::MIN_POSITIVE) * (t1 - t0);
        let row = d.nearest(at).ok_or_else(|| refused("out_of_range", "x"))?;
        Ok(json!({"ok": true, "row": row, "t": d.t[row], "v": d.v[row]}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}

/// Verbs moved by `by` as #373's sub-paths: one per move, its verb names, its points and whether
/// it closes.
fn subpaths_of(verbs: &[Verb], by: [f64; 2]) -> Vec<Value> {
    let m = |p: [f64; 2]| json!([p[0] + by[0], p[1] + by[1]]);
    let mut paths: Vec<(Vec<&str>, Vec<Value>, bool)> = Vec::new();
    for v in verbs {
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
    paths
        .into_iter()
        .map(|(names, points, closed)| json!({"closed": closed, "verbs": names, "points": points}))
        .collect()
}

/// #160: a `path` line (tests/acceptance/160/README.md, The surface under test): the item's
/// frames at each time, with its copies, ends, anchors, columns and tessellation digest.
pub struct PathRequest {
    pub doc: Map<String, Value>,
    pub item: String,
    pub times: Vec<i64>,
    pub anchors: Vec<String>,
    pub timing: bool,
    pub planted: Planted,
    pub look: Option<crate::look::Look>,
    pub vectors: crate::Vectors,
}

/// A `path` line's planted value, or `None` for one the surface doesn't name.
pub fn planted_path(name: &str) -> Option<Planted> {
    const OPS: [&str; 7] = [
        "trim",
        "round_corners",
        "offset_path",
        "zigzag",
        "pucker",
        "twist",
        "repeater",
    ];
    match name {
        "merge_zero_fills" => Some(Planted::MergeZeroFills),
        "repeater_evaluates_at_t" => Some(Planted::RepeaterEvaluatesAtT),
        _ => {
            let op = name.strip_prefix("moved:")?;
            OPS.iter().find(|o| **o == op).map(|o| Planted::Moved(o))
        }
    }
}

/// Answers a `path` line: one frame per time, in order; `built` holds the digests this process
/// built so far, so a frame says whether it rebuilt or reused the item's tessellation.
pub fn path_answer(
    req: PathRequest,
    built: &mut std::collections::BTreeSet<deep_canvas_marks::key::ContentKey>,
) -> Value {
    let mut run = || -> Result<Value, Value> {
        let program = Program::compile(&req.doc).map_err(|r| refused(r.code, &r.path))?;
        let (palette, ty): (scene::Palette, scene::Type) = match &req.look {
            Some(look) => (
                palette_of(look, crate::Theme::Light).clone(),
                crate::type_of(look, crate::Theme::Light).clone(),
            ),
            None => {
                let mut palette = scene::Palette::new();
                palette.insert("ground".into(), [255, 255, 255]);
                any_roles(&Value::Object(req.doc.clone()), &mut palette);
                (palette, scene::Type::default())
            }
        };
        let (palette, ty) = (&palette, &ty);
        let mut frames = Vec::with_capacity(req.times.len());
        for &t in &req.times {
            let placed = crate::place::evaluated(&req.doc, &program, t, &req.vectors)?;
            let items = deep_canvas_vector::lower_items(
                &placed,
                &req.vectors,
                deep_canvas_vector::Write::Honest,
            );
            // #467: a parallax group's frame is its offset at t.
            if let Some(o) = deep_canvas_marks::fields::group_offset(&req.doc, &items, &req.item, t)
                .map_err(|r| refused(r.code, &r.path))?
            {
                frames.push(json!({"t": t, "parallax": {"offset": o}}));
                continue;
            }
            // The build alone is timed: the item through its ops, its heads and its digest (a
            // first pass over the frame only when an attachment needs other items' boxes).
            let started = std::time::Instant::now();
            let report =
                scene::path_report(&req.doc, &items, (palette, ty), &req.item, req.planted)
                    .map_err(|r| refused(r.code, &r.path))?
                    .ok_or_else(|| refused("ref_unresolved", &format!("items/{}", req.item)))?;
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let rebuilt = built.insert(report.digest);
            let subpaths: Vec<Value> = report
                .placed
                .iter()
                .flat_map(|v| subpaths_of(v, [0.0, 0.0]))
                .collect();
            let mut frame = json!({
                "t": t,
                "subpaths": subpaths,
                "segments": report.segments,
                "declared": report.declared,
                "tessellation": report.digest.hex(),
                "rebuilt": rebuilt,
            });
            if let Some(copies) = &report.copies {
                let lag = report.built.as_ref().map_or(0, |b| b.lag);
                frame["copies"] = Value::Array(
                    copies
                        .iter()
                        .map(|(m, opacity, k)| {
                            json!({"transform": m, "opacity": opacity, "t": t - (*k as i64) * lag})
                        })
                        .collect(),
                );
            }
            if !report.ends.is_empty() {
                let mut ends = Map::new();
                for h in &report.ends {
                    ends.insert(
                        h.at.to_string(),
                        json!({"kind": h.kind, "tip": h.tip, "angle": h.angle, "length": h.length, "width": h.width}),
                    );
                }
                frame["ends"] = Value::Object(ends);
            }
            if !req.anchors.is_empty() {
                let whole: Vec<deep_canvas_marks::path::Verb> =
                    report.placed.iter().flatten().copied().collect();
                let mut anchors = Map::new();
                for name in &req.anchors {
                    let value = if name == "#length" {
                        json!(deep_canvas_marks::pathops::length(&whole))
                    } else if let Some(f) = name
                        .strip_prefix("#at:")
                        .and_then(|f| f.parse::<f64>().ok())
                    {
                        match deep_canvas_marks::pathops::at(&whole, f) {
                            Some((p, angle)) => json!({"point": p, "angle": angle}),
                            None => Value::Null,
                        }
                    } else {
                        Value::Null
                    };
                    anchors.insert(name.clone(), value);
                }
                frame["anchors"] = Value::Object(anchors);
            }
            if !report.columns.is_empty() {
                frame["columns"] = json!(report.columns);
            }
            if req.timing {
                frame["build_ms"] = json!(if rebuilt { ms } else { 0.0 });
            }
            frames.push(frame);
        }
        Ok(json!({"ok": true, "frames": frames}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}
