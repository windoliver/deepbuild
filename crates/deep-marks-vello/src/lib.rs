//! The 2D marks module's draw list in Vello CPU terms, with its f32 pipeline at the scalar SIMD
//! level, the configuration goldens and snapshots render with (technical design: Decided, The 2D
//! renderer). Both CPU renderers draw R2's marks through here: deep-canvas-render's `raster` and
//! deep-show's render-back snapshots.
//!
//! Gradients reach Vello as the OKLab ramp's sRGB-encoded stops, so Vello mixes them, premultiplied,
//! in encoded space as 2D composites. A rect mask and a frame's overflow are scissors; an alpha or
//! luminance mask renders its own paint, takes its coverage (luminance in linear light) and draws
//! its items through one mask layer; a group below opacity 1 draws through one opacity layer.
//!
//! A dash count splits each flattened sub-path into equal dashes and gaps from its start. A stroke
//! whose stops run along its length is painted from an image of its ramp: each pixel takes the
//! color at the arc length of the nearest point on the path, so the stroke has no seams where its
//! segments meet.

use std::sync::Arc;

use deep_canvas::color::srgb_decode;
use deep_canvas_marks::paint::{self, Adjust, Extend, Geometry, Ramp};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{Fill, Line, Rgb, Scope};
use vello_cpu::color::{AlphaColor, DynamicColor, Srgb};
use vello_cpu::kurbo::{Affine, BezPath, Cap, Join, PathEl, Point, Rect, Stroke};
use vello_cpu::peniko::{
    self, ColorStop, ColorStops, Gradient, ImageAlphaType, ImageQuality, ImageSampler,
    InterpolationAlphaSpace,
};
use vello_cpu::{
    Image, ImageSource, Level, Mask, PaintType, PixelMetadata, Pixmap, RasterizerSettings,
    RenderContext, RenderMode, RenderSettings, Resources,
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

fn rgba(c: [f64; 3], alpha: f64) -> AlphaColor<Srgb> {
    AlphaColor::new([c[0] as f32, c[1] as f32, c[2] as f32, alpha as f32])
}

pub fn solid(c: Rgb) -> PaintType {
    AlphaColor::from_rgba8(c[0], c[1], c[2], 255).into()
}

/// A ramp as Vello's gradient at `opacity`, its stops already the OKLab ramp in encoded sRGB.
fn gradient(ramp: &Ramp, opacity: f64) -> PaintType {
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
        // Drawn from its image by `along`; a fill never takes it.
        Geometry::Along => {
            let (_, c, a) = ramp.stops[0];
            return rgba(c, a * opacity).into();
        }
    };
    g.extend = match ramp.extend {
        Extend::Pad => peniko::Extend::Pad,
        Extend::Repeat => peniko::Extend::Repeat,
        Extend::Reflect => peniko::Extend::Reflect,
    };
    g.interpolation_alpha_space = InterpolationAlphaSpace::Premultiplied;
    let stops: Vec<ColorStop> = finest_table(&ramp.stops)
        .iter()
        .map(|(t, c, a)| ColorStop {
            offset: *t as f32,
            color: DynamicColor::from_alpha_color(rgba(*c, a * opacity)),
        })
        .collect();
    g.stops = ColorStops::from(stops.as_slice());
    g.into()
}

/// The premultiplied mix `f` of the way from stop `a` to stop `b`, as Vello mixes between stops.
fn premixed(a: ([f64; 3], f64), b: ([f64; 3], f64), f: f64) -> ([f64; 3], f64) {
    let alpha = a.1 + (b.1 - a.1) * f;
    if alpha <= 0.0 {
        return ([0, 1, 2].map(|i| a.0[i] + (b.0[i] - a.0[i]) * f), 0.0);
    }
    let c = [0, 1, 2].map(|i| (a.0[i] * a.1 + (b.0[i] * b.1 - a.0[i] * a.1) * f) / alpha);
    (c, alpha)
}

/// Vello reads a gradient from a lookup table it sizes from the narrowest stop interval, 1,024
/// entries for these ramps and 4,096 once an interval is under 1/2,048, at ⌊t × (size − 1)⌋; at
/// 1,024 a steep ramp's step reaches 0.4 code values. One stop 1/4,096 past the first, mixed in
/// encoded sRGB as Vello mixes between stops, changes no color and gets the 4,096-entry table.
fn finest_table(stops: &[(f64, [f64; 3], f64)]) -> Vec<(f64, [f64; 3], f64)> {
    const STEP: f64 = 1.0 / 4096.0;
    let mut out = stops.to_vec();
    let narrow = stops.windows(2).any(|w| w[1].0 - w[0].0 < 2.0 * STEP);
    let Some(k) = stops.windows(2).position(|w| w[1].0 - w[0].0 >= 2.0 * STEP) else {
        return out;
    };
    if !narrow {
        let ((t0, a, x), (t1, b, y)) = (stops[k], stops[k + 1]);
        let (c, alpha) = premixed((a, x), (b, y), STEP / (t1 - t0));
        out.insert(k + 1, (t0 + STEP, c, alpha));
    }
    out
}

/// A fill's paint over `bounds`; R1's two-stop gradient runs west to east of them, in OKLab.
pub fn brush(fill: &Fill, bounds: [f64; 4]) -> PaintType {
    brush_at(fill, bounds, 1.0)
}

/// [`brush`] at `opacity`.
fn brush_at(fill: &Fill, bounds: [f64; 4], opacity: f64) -> PaintType {
    match fill {
        Fill::Solid(c) if opacity == 1.0 => solid(*c),
        Fill::Solid(c) => rgba(paint::unit(*c), opacity).into(),
        Fill::Linear { from, to, at } => {
            let [x, y, w, h] = bounds;
            gradient(
                &Ramp {
                    geometry: Geometry::Linear {
                        from: [x, y + h / 2.0],
                        to: [x + w, y + h / 2.0],
                    },
                    extend: Extend::Pad,
                    stops: paint::dense(&[(at[0], *from, 1.0), (at[1], *to, 1.0)]),
                    transform: paint::IDENTITY,
                },
                opacity,
            )
        }
        Fill::Ramp(r) => gradient(r, opacity),
    }
}

/// Sets `fill`'s paint at `opacity` over `bounds`, and the transform its gradient draws through.
fn set_brush(ctx: &mut RenderContext, fill: &Fill, bounds: [f64; 4], opacity: f64) {
    ctx.set_paint(brush_at(fill, bounds, opacity));
    match fill {
        Fill::Ramp(r) if r.transform != paint::IDENTITY => {
            ctx.set_paint_transform(Affine::new(r.transform))
        }
        _ => ctx.reset_paint_transform(),
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

/// An outline (`Mark::Shape`): its fill, then its stroke, each a paint over the outline's box at
/// its opacity; a stroke dashed by its count, and painted along its length when its stops are.
pub fn shape(
    ctx: &mut RenderContext,
    verbs: &[Verb],
    fill: Option<&(Fill, f64)>,
    line: Option<&Line>,
    zoom: f64,
) {
    use vello_cpu::kurbo::Shape;
    let path = bez(verbs, [0.0, 0.0], zoom);
    let b = path.bounding_box();
    let bounds = [b.x0, b.y0, b.width(), b.height()];
    if let Some((f, opacity)) = fill {
        set_brush(ctx, f, bounds, *opacity);
        ctx.fill_path(&path);
    }
    if let Some(l) = line {
        match &l.paint {
            Fill::Ramp(r) if r.geometry == Geometry::Along => {
                along(ctx, &path, r, l.opacity, l.width)
            }
            f => set_brush(ctx, f, bounds, l.opacity),
        }
        ctx.set_stroke(stroke(l.width));
        match l.dashes {
            Some(n) => ctx.stroke_path(&dash(&path, n)),
            None => ctx.stroke_path(&path),
        }
    }
    ctx.reset_paint_transform();
}

/// A flattened path's sub-paths as their points and whether each closes; a closed one ends on its
/// first point again.
fn subpaths(path: &BezPath) -> Vec<(Vec<Point>, bool)> {
    let mut out: Vec<(Vec<Point>, bool)> = Vec::new();
    for el in path.elements() {
        match *el {
            PathEl::MoveTo(p) => out.push((vec![p], false)),
            PathEl::LineTo(p) | PathEl::QuadTo(_, p) | PathEl::CurveTo(_, _, p) => {
                if let Some((points, _)) = out.last_mut() {
                    points.push(p);
                }
            }
            PathEl::ClosePath => {
                if let Some((points, closed)) = out.last_mut() {
                    if points.first() != points.last() {
                        points.push(points[0]);
                    }
                    *closed = true;
                }
            }
        }
    }
    out
}

/// Each sub-path of the flattened `path` as `n` equal dashes with equal gaps between them, from its
/// start (Paint: dash `count`): a closed sub-path holds as many gaps as dashes, an open one one
/// fewer.
fn dash(path: &BezPath, n: u16) -> BezPath {
    let mut out = BezPath::new();
    for (points, closed) in subpaths(path) {
        // The arc length at each point.
        let mut at = vec![0.0];
        for w in points.windows(2) {
            at.push(at[at.len() - 1] + w[0].distance(w[1]));
        }
        let total = at[at.len() - 1];
        if total <= 0.0 {
            continue;
        }
        let k = f64::from(n);
        let (dash, period) = match (closed, n) {
            (true, _) => (total / (2.0 * k), total / k),
            (false, 1) => (total, total),
            (false, _) => (total / (2.0 * k - 1.0), 2.0 * total / (2.0 * k - 1.0)),
        };
        let point = |s: f64| {
            let i = at.partition_point(|a| *a <= s).clamp(1, points.len() - 1);
            let (a, b) = (points[i - 1], points[i]);
            let span = at[i] - at[i - 1];
            let f = if span > 0.0 {
                (s - at[i - 1]) / span
            } else {
                0.0
            };
            a.lerp(b, f.clamp(0.0, 1.0))
        };
        for d in 0..n {
            let s0 = f64::from(d) * period;
            let s1 = (s0 + dash).min(total);
            out.move_to(point(s0));
            for (p, s) in points.iter().zip(&at) {
                if *s > s0 && *s < s1 {
                    out.line_to(*p);
                }
            }
            out.line_to(point(s1));
        }
    }
    out
}

/// Paints the stroke of the flattened `path`, `width` u wide, from an image of `ramp` along its
/// length at `opacity`: each device pixel near the path takes the ramp at the arc length (from the
/// path's start, across its sub-paths) of the nearest point on it.
fn along(ctx: &mut RenderContext, path: &BezPath, ramp: &Ramp, opacity: f64, width: f64) {
    let device = *ctx.transform();
    // The segments in device pixels, with the arc length each starts at.
    let mut segments: Vec<(Point, Point, f64)> = Vec::new();
    let mut total = 0.0;
    for (points, _) in subpaths(path) {
        for w in points.windows(2) {
            let (a, b) = (device * w[0], device * w[1]);
            segments.push((a, b, total));
            total += a.distance(b);
        }
    }
    // A miter join reaches at most 4 half-widths out, and antialiasing a pixel more.
    let reach = width * device.determinant().abs().sqrt() * 2.0 + 2.0;
    let (cw, ch) = (f64::from(ctx.width()), f64::from(ctx.height()));
    let clamp = |v: f64, hi: f64| v.clamp(0.0, hi) as usize;
    let around = |a: Point, b: Point| {
        (
            clamp((a.x.min(b.x) - reach).floor(), cw),
            clamp((a.y.min(b.y) - reach).floor(), ch),
            clamp((a.x.max(b.x) + reach).ceil(), cw),
            clamp((a.y.max(b.y) + reach).ceil(), ch),
        )
    };
    let (mut x0, mut y0, mut x1, mut y1) = (usize::MAX, usize::MAX, 0, 0);
    for (a, b, _) in &segments {
        let (ax, ay, bx, by) = around(*a, *b);
        (x0, y0, x1, y1) = (x0.min(ax), y0.min(ay), x1.max(bx), y1.max(by));
    }
    if x1 <= x0 || y1 <= y0 || total <= 0.0 {
        ctx.set_paint(AlphaColor::<Srgb>::TRANSPARENT);
        return;
    }
    let (w, h) = (x1 - x0, y1 - y0);
    // Each pixel's squared distance to the path and the arc length of its nearest point.
    let mut nearest = vec![(f64::INFINITY, 0.0); w * h];
    for (a, b, s0) in &segments {
        let d = *b - *a;
        let (len2, len) = (d.hypot2(), d.hypot());
        let (ax, ay, bx, by) = around(*a, *b);
        for py in ay..by {
            for px in ax..bx {
                let c = Point::new(px as f64 + 0.5, py as f64 + 0.5);
                let u = if len2 > 0.0 {
                    ((c - *a).dot(d) / len2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let dist = (c - (*a + d * u)).hypot2();
                let slot = &mut nearest[(py - y0) * w + (px - x0)];
                if dist < slot.0 {
                    *slot = (dist, s0 + u * len);
                }
            }
        }
    }
    // The ramp in 4,096 steps, mixed between its stops as a gradient's are.
    const STEPS: usize = 4096;
    let stops = &ramp.stops;
    let table: Vec<[u8; 4]> = (0..STEPS)
        .map(|i| {
            let t = i as f64 / (STEPS - 1) as f64;
            let k = stops
                .partition_point(|s| s.0 <= t)
                .clamp(1, stops.len() - 1);
            let ((t0, a, x), (t1, b, y)) = (stops[k - 1], stops[k]);
            let f = if t1 > t0 {
                ((t - t0) / (t1 - t0)).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let (c, alpha) = premixed((a, x), (b, y), f);
            let alpha = alpha * opacity;
            let byte = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
            [
                byte(c[0] * alpha),
                byte(c[1] * alpha),
                byte(c[2] * alpha),
                byte(alpha),
            ]
        })
        .collect();
    let mut bytes = Vec::with_capacity(w * h * 4);
    for (dist, s) in nearest {
        if !dist.is_finite() {
            bytes.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        let t = s / total;
        let t = match ramp.extend {
            Extend::Pad => t.clamp(0.0, 1.0),
            Extend::Repeat => t.rem_euclid(1.0),
            Extend::Reflect => 1.0 - (t.rem_euclid(2.0) - 1.0).abs(),
        };
        bytes.extend_from_slice(&table[(t * (STEPS - 1) as f64).round() as usize]);
    }
    let image = Pixmap::from_parts(
        bytes,
        w as u16,
        h as u16,
        PixelMetadata {
            may_have_transparency: true,
            alpha_type: ImageAlphaType::AlphaPremultiplied,
        },
    );
    ctx.set_paint(Image {
        image: ImageSource::Pixmap(Arc::new(image)),
        sampler: ImageSampler {
            quality: ImageQuality::Low,
            ..ImageSampler::default()
        },
    });
    ctx.set_paint_transform(device.inverse() * Affine::translate((x0 as f64, y0 as f64)));
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Each dash of `path` as its start and end point.
    fn dashes(path: &BezPath) -> Vec<(Point, Point)> {
        subpaths(path)
            .iter()
            .map(|(p, _)| (p[0], p[p.len() - 1]))
            .collect()
    }

    #[test]
    fn an_open_sub_path_holds_its_dash_count_with_one_gap_fewer() {
        // An open L, 100 u then 50 u: 3 dashes and 2 gaps, each 30 u along it.
        let mut path = BezPath::new();
        path.move_to((0.0, 0.0));
        path.line_to((100.0, 0.0));
        path.line_to((100.0, 50.0));
        let got = dashes(&dash(&path, 3));
        let want = [
            ((0.0, 0.0), (30.0, 0.0)),
            ((60.0, 0.0), (90.0, 0.0)),
            ((100.0, 20.0), (100.0, 50.0)),
        ];
        assert_eq!(got.len(), 3);
        for ((a, b), (x, y)) in got.iter().zip(want) {
            assert!(a.distance(Point::from(x)) < 1e-9 && b.distance(Point::from(y)) < 1e-9);
        }
        // A dash across the bend keeps the corner.
        let one = dash(&path, 1);
        assert_eq!(subpaths(&one)[0].0.len(), 3, "M, the corner, the end");
    }
}
