//! A document's still frame in a panel (issue #372; canvas primitives: Document envelope,
//! `aspect`): the frame scaled to fit, then `letterbox` centres it between bars in the look's
//! ground and `extend` widens the camera's view along the panel's longer side, so nothing in
//! the frame is cropped either way. The raster is CPU, flat and unlit, in sRGB bytes: a shape's
//! fill written exactly inside it, edge pixels blended by coverage.

use serde_json::Value;

use crate::camera::{Offsets, Projector, Refused};
use crate::document::{extends_by_default, member};
use crate::draw::{scene, Scene, Shape};

/// The most pixels a panel has along a side: a frame of 8192² is 256 MiB of RGBA.
pub const MAX_SIDE: u32 = 8192;

/// An opaque RGBA8 image, row-major from the top left.
pub struct Image {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Image {
    fn filled(width: u32, height: u32, rgb: [u8; 3]) -> Image {
        // Sizes multiply as usize: the panel limit (`MAX_SIDE`) keeps the product small.
        let pixels = width as usize * height as usize;
        let mut rgba = Vec::with_capacity(pixels * 4);
        for _ in 0..pixels {
            rgba.extend_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
        }
        Image {
            width,
            height,
            rgba,
        }
    }

    /// Writes `rgb` over the pixel by `coverage` in [0, 1].
    fn blend(&mut self, x: u32, y: u32, rgb: [u8; 3], coverage: f64) {
        if coverage <= 0.0 {
            return;
        }
        let i = (y as usize * self.width as usize + x as usize) * 4;
        for (dst, src) in self.rgba[i..i + 3].iter_mut().zip(rgb) {
            *dst = (src as f64 * coverage + *dst as f64 * (1.0 - coverage)).round() as u8;
        }
    }

    /// Copies `picture` into this image with its top-left corner at (`x0`, `y0`).
    fn blit(&mut self, picture: &Image, x0: u32, y0: u32) {
        for row in 0..picture.height {
            let src = row as usize * picture.width as usize * 4;
            let dst = ((y0 + row) as usize * self.width as usize + x0 as usize) * 4;
            let n = picture.width as usize * 4;
            self.rgba[dst..dst + n].copy_from_slice(&picture.rgba[src..src + n]);
        }
    }

    /// An axis-aligned rectangle over [x0, x1) × [y0, y1) px, each pixel by its overlap.
    fn fill_rect(&mut self, x0: f64, y0: f64, x1: f64, y1: f64, rgb: [u8; 3]) {
        let px0 = x0.floor().max(0.0) as i64;
        let py0 = y0.floor().max(0.0) as i64;
        let px1 = (x1.ceil() as i64).min(self.width as i64);
        let py1 = (y1.ceil() as i64).min(self.height as i64);
        for py in py0..py1 {
            let dy = (y1.min(py as f64 + 1.0) - y0.max(py as f64)).max(0.0);
            for px in px0..px1 {
                let dx = (x1.min(px as f64 + 1.0) - x0.max(px as f64)).max(0.0);
                self.blend(px as u32, py as u32, rgb, dx * dy);
            }
        }
    }

    /// A convex quadrilateral, its corners in order around it: a pixel wholly inside is the fill
    /// exactly, a pixel an edge crosses is covered by a 4 × 4 sample grid.
    fn fill_quad(&mut self, corners: [[f64; 2]; 4], rgb: [u8; 3]) {
        let inside = |x: f64, y: f64| quad_contains(corners, x, y);
        let xs = corners.map(|c| c[0]);
        let ys = corners.map(|c| c[1]);
        let min = |v: [f64; 4]| v.iter().copied().fold(f64::INFINITY, f64::min);
        let max = |v: [f64; 4]| v.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let px0 = min(xs).floor().max(0.0) as i64;
        let py0 = min(ys).floor().max(0.0) as i64;
        let px1 = (max(xs).ceil() as i64).min(self.width as i64);
        let py1 = (max(ys).ceil() as i64).min(self.height as i64);
        for py in py0..py1 {
            for px in px0..px1 {
                let (x0, y0) = (px as f64, py as f64);
                let pixel_corners = [
                    [x0, y0],
                    [x0 + 1.0, y0],
                    [x0 + 1.0, y0 + 1.0],
                    [x0, y0 + 1.0],
                ];
                let coverage = if pixel_corners.iter().all(|c| inside(c[0], c[1])) {
                    1.0
                } else {
                    let mut n = 0;
                    for sy in 0..4 {
                        for sx in 0..4 {
                            if inside(x0 + (sx as f64 + 0.5) / 4.0, y0 + (sy as f64 + 0.5) / 4.0) {
                                n += 1;
                            }
                        }
                    }
                    n as f64 / 16.0
                };
                self.blend(px as u32, py as u32, rgb, coverage);
            }
        }
    }

    /// A disc about (`cx`, `cy`) of radius `r` px: a pixel wholly inside is the fill exactly, a
    /// pixel the disc crosses is covered by a 4 × 4 sample grid.
    fn fill_disc(&mut self, cx: f64, cy: f64, r: f64, rgb: [u8; 3]) {
        if r <= 0.0 {
            return;
        }
        let px0 = (cx - r).floor().max(0.0) as i64;
        let py0 = (cy - r).floor().max(0.0) as i64;
        let px1 = ((cx + r).ceil() as i64).min(self.width as i64);
        let py1 = ((cy + r).ceil() as i64).min(self.height as i64);
        let r2 = r * r;
        for py in py0..py1 {
            for px in px0..px1 {
                let (x0, y0, x1, y1) = (px as f64, py as f64, px as f64 + 1.0, py as f64 + 1.0);
                // The pixel's nearest and farthest points to the centre.
                let nx = (cx - x0.max(cx.min(x1))).abs();
                let ny = (cy - y0.max(cy.min(y1))).abs();
                if nx * nx + ny * ny > r2 {
                    continue;
                }
                let fx = (cx - x0).abs().max((cx - x1).abs());
                let fy = (cy - y0).abs().max((cy - y1).abs());
                let coverage = if fx * fx + fy * fy <= r2 {
                    1.0
                } else {
                    let mut inside = 0;
                    for sy in 0..4 {
                        for sx in 0..4 {
                            let (dx, dy) = (
                                x0 + (sx as f64 + 0.5) / 4.0 - cx,
                                y0 + (sy as f64 + 0.5) / 4.0 - cy,
                            );
                            if dx * dx + dy * dy <= r2 {
                                inside += 1;
                            }
                        }
                    }
                    inside as f64 / 16.0
                };
                self.blend(px as u32, py as u32, rgb, coverage);
            }
        }
    }
}

/// Rasterizes the scene's frame scaled to `frame` px into a `panel` of `width` × `height`.
fn raster(scene: &Scene, frame: [f64; 2], width: u32, height: u32, ground: [u8; 3]) -> Image {
    let pose = scene.spec.pose(&scene.rig, &Offsets::default());
    let view = Projector::new(&pose, frame, [width as f64, height as f64]);
    let mut image = Image::filled(width, height, ground);
    // One stack for every shape, farthest first and, at one depth (every shape of a flat
    // document), in item order, so a nearer shape draws over a farther and a later over an
    // earlier. Picking (session) ranks the same way.
    let mut stack: Vec<(f64, usize, Painted)> = Vec::new();
    // The still frame shows the view every view-class control declares as its default.
    let view_defaults = scene.view_defaults();
    for (index, item) in scene
        .items
        .iter()
        .enumerate()
        .filter(|(_, i)| scene.shown(i, &view_defaults))
    {
        let painted = match item.shape {
            Shape::Rect { x, y, w, h } => {
                // The corners project separately (roll turns the page, perspective skews the
                // sides); only a flat, unrolled rectangle is axis-aligned and keeps the exact
                // per-pixel overlap.
                let corners = [
                    [x, y, 0.0],
                    [x + w, y, 0.0],
                    [x + w, y + h, 0.0],
                    [x, y + h, 0.0],
                ]
                .map(|c| view.project(c));
                let [Some(a), Some(b), Some(c), Some(d)] = corners else {
                    continue;
                };
                let quad = [a, b, c, d].map(|p| [p.x, p.y]);
                // Its depth is the corners' mean, as picking ranks it (session::pick).
                let depth = (a.depth + b.depth + c.depth + d.depth) / 4.0;
                (depth, Painted::Quad(quad, pose.flat && pose.roll == 0.0))
            }
            Shape::Dot { pos, radius } => match view.project(pos) {
                Some(p) => (p.depth, Painted::Disc(p.x, p.y, radius * p.scale)),
                None => continue,
            },
        };
        stack.push((painted.0, index, painted.1));
    }
    stack.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
    for (_, index, painted) in stack {
        let fill = scene.items[index].fill;
        match painted {
            Painted::Quad([a, _, c, _], true) => image.fill_rect(a[0], a[1], c[0], c[1], fill),
            Painted::Quad(corners, false) => image.fill_quad(corners, fill),
            Painted::Disc(x, y, r) => image.fill_disc(x, y, r, fill),
        }
    }
    image
}

/// Whether a point is inside (or on the edge of) a convex quadrilateral given by its corners
/// in order: on one side of every edge, the side the first edge sets. The renderer fills by
/// it and the session picks by it, so a rectangle is picked where it is drawn.
pub fn quad_contains(corners: [[f64; 2]; 4], x: f64, y: f64) -> bool {
    let side = |i: usize, x: f64, y: f64| {
        let (a, b) = (corners[i], corners[(i + 1) % 4]);
        (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
    };
    let orientation = side(0, corners[2][0], corners[2][1]);
    orientation != 0.0 && (0..4).all(|i| side(i, x, y) * orientation >= 0.0)
}

/// A shape on the frame, in px: a rectangle's corners (and whether it is unrolled, so the
/// exact overlap applies) or a disc.
enum Painted {
    Quad([[f64; 2]; 4], bool),
    Disc(f64, f64, f64),
}

/// The document's still frame in a panel of `panel` px, the look's ground given as `ground`.
pub fn render(doc: &Value, panel: [u32; 2], ground: [u8; 3]) -> Result<Image, Refused> {
    let scene = scene(doc)?;
    let size = member(doc, "size").and_then(Value::as_array);
    let (Some(w), Some(h)) = (
        size.and_then(|s| s.first()).and_then(Value::as_f64),
        size.and_then(|s| s.get(1)).and_then(Value::as_f64),
    ) else {
        return Err(Refused::new("out_of_range", "size", "not two numbers"));
    };
    // The envelope checks `size` at f32 width, where a subnormal is 0 and finite.
    if !((w as f32) > 0.0 && (h as f32) > 0.0) {
        return Err(Refused::new("out_of_range", "size", "not above 0"));
    }
    if panel.iter().any(|n| *n == 0 || *n > MAX_SIDE) {
        return Err(Refused::new(
            "out_of_range",
            "panel",
            format!("each side from 1 to {MAX_SIDE} px"),
        ));
    }
    let extend = match member(doc, "aspect").and_then(Value::as_str) {
        Some("extend") => true,
        Some("letterbox") => false,
        _ => extends_by_default(member(doc, "profile").and_then(Value::as_str)),
    };
    // The frame scaled to fit the panel, at whole pixels.
    let scale = (panel[0] as f64 / w).min(panel[1] as f64 / h);
    // A frame of an extreme shape in a small panel keeps at least one pixel each way.
    let frame = [(w * scale).round().max(1.0), (h * scale).round().max(1.0)];
    if !(scale.is_finite() && frame[0].is_finite() && frame[1].is_finite()) {
        return Err(Refused::new(
            "out_of_range",
            "size",
            "no frame fits the panel",
        ));
    }
    if extend {
        return Ok(raster(&scene, frame, panel[0], panel[1], ground));
    }
    let picture = raster(&scene, frame, frame[0] as u32, frame[1] as u32, ground);
    let mut image = Image::filled(panel[0], panel[1], ground);
    image.blit(
        &picture,
        (panel[0] - picture.width) / 2,
        (panel[1] - picture.height) / 2,
    );
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(size: Value, aspect: &str) -> Value {
        json!({
            "format": 1, "id": "d", "profile": "film", "title": "T", "description": "D",
            "size": size, "aspect": aspect, "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "M", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0", "params": {"projection": "orthographic", "view_width": 10}},
                "r": {"id": "r", "kind": "test.rect@1", "layer": "main", "name": "R", "order": "a1", "params": {"w": 4, "h": 2, "fill": [255, 0, 0]}, "at": {"pos": [1, 1, 0]}}
            },
            "controls": {"show": {"class": "view", "binds": ["items/r/visible"], "default": false}}
        })
    }

    #[test]
    fn a_subnormal_size_is_refused_on_size_rather_than_dividing_by_zero() {
        let err = render(
            &doc(json!([1e-310, 1e-310]), "letterbox"),
            [100, 100],
            [0, 0, 0],
        )
        .err()
        .unwrap();
        assert_eq!((err.code, err.path.as_str()), ("out_of_range", "size"));
    }

    #[test]
    fn a_view_control_at_a_hiding_default_leaves_its_item_out_of_the_still_frame() {
        let image = render(&doc(json!([10, 10]), "extend"), [10, 10], [0, 0, 0])
            .ok()
            .unwrap();
        assert!(
            image.rgba.chunks(4).all(|px| px[0] == 0),
            "the rect is drawn"
        );
    }
}
