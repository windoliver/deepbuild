//! An overlay anchored to a 3D point as the 2D picture the compositor paints (canvas primitives:
//! Overlay): its frame's shapes rasterized by Vello CPU with the anchor's sub-pixel phase in the
//! raster, so a compositor that places pictures on whole pixels still puts them where the
//! projection says.

use vello_cpu::color::{AlphaColor, Srgb};
use vello_cpu::kurbo::{Circle, Rect};
use vello_cpu::{Level, Pixmap, RenderContext, RenderSettings};

use crate::scene::{Overlay, Shape2};

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
    ctx.render(&mut pixmap, &mut resources);
    Some(Picture {
        at,
        size: [w, h],
        rgba: pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::Alpha),
    })
}
