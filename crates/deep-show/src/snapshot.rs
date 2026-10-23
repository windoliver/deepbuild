//! Render-back's snapshots on the CPU (canvas primitives: Render-back: "2D snapshots render with
//! Vello CPU"): a revision evaluated at a time, drawn from the marks module's draw list at a size,
//! with the scalar SIMD level so the same bytes come out on every platform. The same raster, with
//! no ground, is a writer layer's picture in the window `screen` composes.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

use deep_canvas_marks::path;
use deep_canvas_marks::scene::{
    self, Fill, ImageFit, Mark, Palette, Record, Rgb, Slot, StatusMark,
};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_marks_vello::{brush, image, sampler, shape, Scopes};
use deep_text::{Align, Role, Shaper, Spec};
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

/// A revision's draw list at one time: the marks module's frame and the status marks.
pub struct Drawn {
    pub frame: scene::Frame,
    pub status: Vec<StatusMark>,
    /// Each image mark's asset, decoded: an asset that isn't decoded yet can't settle a frame.
    images: BTreeMap<String, Arc<Pixmap>>,
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
        let program =
            Program::compile(&Value::Object(doc.clone())).or_else(|r| unfit(r.code, r.path))?;
        let mut state = program.state();
        program.evaluate(t, eval::Validity::Full, &mut state);
        let items = eval::items(doc, &program, &state);
        let frame =
            scene::frame(doc, &items, palette, record, 1.0).or_else(|r| unfit(r.code, r.path))?;
        let status = scene::status_marks(doc, &items, record, status, palette)
            .or_else(|r| unfit(r.code, r.path))?;
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
            status,
            images,
        })
    }

    /// The draw list at `size` px, the frame scaled to fit from the top left: an opaque PNG over
    /// `ground`, or with `ground` `None` straight RGBA over nothing, for a layer's picture.
    pub fn raster(&mut self, drawn: &Drawn, size: [u16; 2], ground: Option<Rgb>) -> Vec<u8> {
        let settings = RenderSettings {
            level: Level::fallback(),
            num_threads: 0,
        };
        let mut ctx = RenderContext::new_with(size[0], size[1], settings);
        if let Some(g) = ground {
            ctx.set_paint(color(g));
            ctx.fill_rect(&Rect::new(0.0, 0.0, f64::from(size[0]), f64::from(size[1])));
        }
        let [dw, dh] = drawn.frame.size;
        let scale = (f64::from(size[0]) / dw).min(f64::from(size[1]) / dh);
        let at = Affine::scale(scale);
        // The scopes each mark draws inside (#373): scissors, soft masks and group opacity.
        let mut scopes = Scopes::new(false);
        for d in drawn.frame.layers.iter().flat_map(|l| &l.marks) {
            ctx.set_transform(at);
            scopes.enter(&mut ctx, &mut self.resources, &d.scopes);
            self.mark(&mut ctx, &d.mark, drawn, at);
        }
        ctx.set_transform(at);
        scopes.enter(&mut ctx, &mut self.resources, &[]);
        for s in &drawn.status {
            ctx.set_transform(at);
            self.status_mark(&mut ctx, s, at);
        }
        ctx.flush();
        let mut pixmap = Pixmap::new(size[0], size[1]);
        ctx.render(&mut pixmap, &mut self.resources);
        pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha)
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
                spec,
                origin,
                color: c,
                ..
            } => {
                let align = match spec.align {
                    scene::Align::Start => Align::Start,
                    scene::Align::Center => Align::Center,
                    scene::Align::End => Align::End,
                };
                let Some(role) = Role::parse(&spec.font) else {
                    return;
                };
                self.text(
                    ctx,
                    &Spec {
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
                    },
                    *origin,
                    *c,
                    at,
                );
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
                let [x, y, w, h] = fitted(*bounds, size, *fit);
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
        ctx.set_paint(color(c));
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
                })
                .count();
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
                let text = format!("{} {}", s.glyph, s.word);
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
}
