//! An overlay anchored to a 3D point as the 2D picture the compositor paints (canvas primitives:
//! Overlay): its frame's shapes rasterized by Vello CPU with the anchor's sub-pixel phase in the
//! raster, so a compositor that places pictures on whole pixels still puts them where the
//! projection says.

use vello_cpu::color::{AlphaColor, Srgb};
use vello_cpu::kurbo::{Circle, Rect};
use vello_cpu::{Level, Pixmap, RenderContext, RenderSettings};

use crate::scene::{Leader, Overlay, Shape2};

/// A straight-alpha RGBA picture and the whole view pixel its top-left corner sits on.
#[derive(Clone, Debug, PartialEq)]
pub struct Picture {
    pub at: [i64; 2],
    pub size: [u16; 2],
    pub rgba: Vec<u8>,
}

fn extent(shape: &Shape2) -> [f64; 4] {
    match shape {
        Shape2::Circle { center, r, .. } => {
            [center[0] - r, center[1] - r, center[0] + r, center[1] + r]
        }
        Shape2::Rect { rect, .. } => [rect[0], rect[1], rect[0] + rect[2], rect[1] + rect[3]],
    }
}

/// The overlay's picture, or `None` while its anchor is behind the camera or it draws nothing.
pub fn picture(o: &Overlay) -> Option<Picture> {
    let origin = o.origin?;
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for s in &o.shapes {
        let [x0, y0, x1, y1] = extent(s);
        lo = [lo[0].min(x0), lo[1].min(y0)];
        hi = [hi[0].max(x1), hi[1].max(y1)];
    }
    if !lo[0].is_finite() {
        return None;
    }
    // One clear pixel around the shapes, for their antialiased edges.
    let at = [
        (origin[0] + lo[0]).floor() as i64 - 1,
        (origin[1] + lo[1]).floor() as i64 - 1,
    ];
    let w = ((origin[0] + hi[0]).ceil() as i64 + 1 - at[0]).clamp(1, 4096) as u16;
    let h = ((origin[1] + hi[1]).ceil() as i64 + 1 - at[1]).clamp(1, 4096) as u16;
    let (dx, dy) = (origin[0] - at[0] as f64, origin[1] - at[1] as f64);
    let settings = RenderSettings {
        level: Level::fallback(),
        num_threads: 0,
    };
    let mut ctx = RenderContext::new_with(w, h, settings);
    for s in &o.shapes {
        match s {
            Shape2::Circle { center, r, color } => {
                ctx.set_paint(AlphaColor::<Srgb>::from_rgba8(
                    color[0], color[1], color[2], 255,
                ));
                ctx.fill_path(&vello_cpu::kurbo::Shape::to_path(
                    &Circle::new((center[0] + dx, center[1] + dy), *r),
                    0.01,
                ));
            }
            Shape2::Rect { rect, color } => {
                ctx.set_paint(AlphaColor::<Srgb>::from_rgba8(
                    color[0], color[1], color[2], 255,
                ));
                ctx.fill_rect(&Rect::new(
                    rect[0] + dx,
                    rect[1] + dy,
                    rect[0] + rect[2] + dx,
                    rect[1] + rect[3] + dy,
                ));
            }
        }
    }
    ctx.flush();
    let mut pixmap = Pixmap::new(w, h);
    let mut resources = vello_cpu::Resources::new();
    // The f32 pipeline: deep-show also builds vello_cpu's u8 one (#1897), which `render` would take.
    let f32_pipeline = vello_cpu::RasterizerSettings {
        render_mode: vello_cpu::RenderMode::OptimizeQuality,
        ..Default::default()
    };
    ctx.render_with(&mut pixmap, &mut resources, f32_pipeline);
    Some(Picture {
        at,
        size: [w, h],
        rgba: pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha),
    })
}

/// #468: a leader's picture on whole view pixels: its line, round-capped, and its end's dot, drawn
/// at their sub-pixel places; `None` while its overlay hides.
pub fn leader_picture(l: &Leader) -> Option<Picture> {
    let points = l.points.as_ref().filter(|p| p.len() >= 2)?;
    let dot = if l.dot { 1.5 * l.width + 0.75 } else { 0.0 };
    let pad = (l.width / 2.0).max(dot) + 1.0;
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in points {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[0]), hi[1].max(p[1])];
    }
    let at = [(lo[0] - pad).floor() as i64, (lo[1] - pad).floor() as i64];
    let w = ((hi[0] + pad).ceil() as i64 - at[0]).clamp(1, 4096) as u16;
    let h = ((hi[1] + pad).ceil() as i64 - at[1]).clamp(1, 4096) as u16;
    let local = |p: [f64; 2]| (p[0] - at[0] as f64, p[1] - at[1] as f64);
    let settings = RenderSettings {
        level: Level::fallback(),
        num_threads: 0,
    };
    let mut ctx = RenderContext::new_with(w, h, settings);
    ctx.set_paint(AlphaColor::<Srgb>::from_rgba8(
        l.color[0], l.color[1], l.color[2], 255,
    ));
    let mut path = vello_cpu::kurbo::BezPath::new();
    path.move_to(local(points[0]));
    for p in &points[1..] {
        path.line_to(local(*p));
    }
    ctx.set_stroke(
        vello_cpu::kurbo::Stroke::new(l.width)
            .with_caps(vello_cpu::kurbo::Cap::Round)
            .with_join(vello_cpu::kurbo::Join::Round),
    );
    ctx.stroke_path(&path);
    if l.dot {
        let end = points[points.len() - 1];
        ctx.fill_path(&vello_cpu::kurbo::Shape::to_path(
            &Circle::new(local(end), dot),
            0.01,
        ));
    }
    ctx.flush();
    let mut pixmap = Pixmap::new(w, h);
    let mut resources = vello_cpu::Resources::new();
    let f32_pipeline = vello_cpu::RasterizerSettings {
        render_mode: vello_cpu::RenderMode::OptimizeQuality,
        ..Default::default()
    };
    ctx.render_with(&mut pixmap, &mut resources, f32_pipeline);
    Some(Picture {
        at,
        size: [w, h],
        rgba: pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha),
    })
}
