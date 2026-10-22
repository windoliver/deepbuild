//! The 2D marks module's draw list in Vello CPU terms, with its f32 pipeline at the scalar SIMD
//! level, the configuration goldens and snapshots render with (technical design: Decided, The 2D
//! renderer). Both CPU renderers draw R2's marks through here: deep-canvas-render's `raster` and
//! deep-show's render-back snapshots.
//!
//! Gradients reach Vello as the OKLab ramp's sRGB-encoded stops, so Vello mixes them in encoded
//! space as 2D composites. A rect mask and a frame's overflow are scissors; an alpha or luminance
//! mask renders its own paint, takes its coverage (luminance in linear light) and draws its items
//! through one mask layer; a group below opacity 1 draws through one opacity layer.

use deep_canvas::color::srgb_decode;
use deep_canvas_marks::paint::{self, Adjust, Extend, Geometry, Ramp};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{Fill, Rgb, Scope};
use vello_cpu::color::{AlphaColor, DynamicColor, Srgb};
use vello_cpu::kurbo::{BezPath, Cap, Join, Rect, Stroke};
use vello_cpu::peniko::{self, ColorStop, ColorStops, Gradient, ImageAlphaType};
use vello_cpu::{
    Level, Mask, PaintType, PixelMetadata, Pixmap, RasterizerSettings, RenderContext, RenderMode,
    RenderSettings, Resources,
};

/// Vello CPU at the scalar SIMD level on one thread, so every platform draws the same bytes.
pub fn settings() -> RenderSettings {
    RenderSettings {
        level: Level::fallback(),
        num_threads: 0,
    }
}

/// Rasterizing with the f32 pipeline.
pub fn rasterizer() -> RasterizerSettings {
    RasterizerSettings {
        render_mode: RenderMode::OptimizeQuality,
        ..RasterizerSettings::default()
    }
}

fn rgba(c: [f64; 3]) -> AlphaColor<Srgb> {
    AlphaColor::new([c[0] as f32, c[1] as f32, c[2] as f32, 1.0])
}

pub fn solid(c: Rgb) -> PaintType {
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
pub fn brush(fill: &Fill, bounds: [f64; 4]) -> PaintType {
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

/// `verbs` moved by `by`, flattened for `zoom`.
pub fn bez(verbs: &[Verb], by: [f64; 2], zoom: f64) -> BezPath {
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

pub fn rect(b: [f64; 4]) -> Rect {
    Rect::new(b[0], b[1], b[0] + b[2], b[1] + b[3])
}

/// Strokes as SVG draws them by default: butt caps and miter joins with a limit of 4.
pub fn stroke(width: f64) -> Stroke {
    Stroke::new(width)
        .with_caps(Cap::Butt)
        .with_join(Join::Miter)
        .with_miter_limit(4.0)
}

/// An outline (`Mark::Shape`): its fill, then its stroke, each a paint over the outline's box.
pub fn shape(
    ctx: &mut RenderContext,
    verbs: &[Verb],
    fill: Option<&Fill>,
    line: Option<&(f64, Fill)>,
    zoom: f64,
) {
    use vello_cpu::kurbo::Shape;
    let path = bez(verbs, [0.0, 0.0], zoom);
    let b = path.bounding_box();
    let bounds = [b.x0, b.y0, b.width(), b.height()];
    if let Some(f) = fill {
        ctx.set_paint(brush(f, bounds));
        ctx.fill_path(&path);
    }
    if let Some((w, f)) = line {
        ctx.set_paint(brush(f, bounds));
        ctx.set_stroke(stroke(*w));
        ctx.stroke_path(&path);
    }
}

/// An image's straight RGBA pixels, adjusted and at `opacity`, as Vello's premultiplied pixmap.
pub fn image(rgba: Vec<u8>, size: [u16; 2], opacity: f64, adjust: &Adjust) -> Pixmap {
    let mut bytes = rgba;
    for px in bytes.chunks_exact_mut(4) {
        let c = adjust.color(paint::unit([px[0], px[1], px[2]]));
        let a = f64::from(px[3]) / 255.0 * opacity;
        for k in 0..3 {
            px[k] = (c[k] * a * 255.0).round().clamp(0.0, 255.0) as u8;
        }
        px[3] = (a * 255.0).round() as u8;
    }
    Pixmap::from_parts(
        bytes,
        size[0],
        size[1],
        PixelMetadata {
            may_have_transparency: true,
            alpha_type: ImageAlphaType::AlphaPremultiplied,
        },
    )
}

/// The scopes open while a frame draws, so each run of marks inside one scope draws through it
/// once.
#[derive(Default)]
pub struct Scopes {
    /// Open now, outermost first: (item, a layer rather than a clip).
    open: Vec<(String, bool)>,
    /// The offscreen passes the frame drew through: two per soft mask (its own paint's and the
    /// layer its items draw through), one per opacity layer, none for a scissor.
    pub offscreen: u32,
    /// #373 AC6's wrong program: a luminance mask that reads encoded luma.
    encoded_luma: bool,
}

impl Scopes {
    /// No scope open; `encoded_luma` plants #373 AC6's wrong program.
    pub fn new(encoded_luma: bool) -> Self {
        Scopes {
            encoded_luma,
            ..Scopes::default()
        }
    }

    /// Closes the scopes the next mark isn't in and opens those it is, at the context's current
    /// transform; `&[]` closes them all.
    pub fn enter(&mut self, ctx: &mut RenderContext, resources: &mut Resources, scopes: &[Scope]) {
        let keep = self
            .open
            .iter()
            .zip(scopes)
            .take_while(|((id, _), s)| id == s.item())
            .count();
        while self.open.len() > keep {
            match self.open.pop() {
                Some((_, true)) => ctx.pop_layer(),
                _ => ctx.pop_clip(),
            }
        }
        for s in &scopes[keep..] {
            let layer = match s {
                Scope::Clip { rect: r, .. } => {
                    ctx.push_clip_rect(&rect(*r));
                    false
                }
                Scope::Mask {
                    rect: r,
                    luminance,
                    fill,
                    ..
                } => {
                    let mask = self.mask(ctx, resources, *r, *luminance, fill);
                    ctx.push_mask_layer(mask);
                    self.offscreen += 2;
                    true
                }
                Scope::Opacity { alpha, .. } => {
                    ctx.push_opacity_layer(*alpha as f32);
                    self.offscreen += 1;
                    true
                }
            };
            self.open.push((s.item().to_string(), layer));
        }
    }

    /// A soft mask's coverage over the frame: its paint over its rect, as alpha or as linear-light
    /// luminance (Rec. 709 weights), and nothing outside the rect.
    fn mask(
        &self,
        on: &RenderContext,
        resources: &mut Resources,
        rect_u: [f64; 4],
        luminance: bool,
        fill: &Fill,
    ) -> Mask {
        let (w, h) = (on.width(), on.height());
        let mut ctx = RenderContext::new_with(w, h, settings());
        ctx.set_transform(*on.transform());
        ctx.set_paint(brush(fill, rect_u));
        ctx.fill_rect(&rect(rect_u));
        let mut pixmap = Pixmap::new(w, h);
        ctx.render_with(&mut pixmap, resources, rasterizer());
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
}
