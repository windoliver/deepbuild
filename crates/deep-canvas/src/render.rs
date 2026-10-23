//! A document's still frame in a panel (issue #372; canvas primitives: Document envelope,
//! `aspect`): the frame scaled to fit, then `letterbox` centres it between bars in the look's
//! ground and `extend` widens the camera's view along the panel's longer side, so nothing in
//! the frame is cropped either way. The raster is CPU, flat and unlit, in sRGB bytes: a shape's
//! fill written exactly inside it, a pixel at an edge the mean of 4 × 4 samples, each showing
//! what is on top at it.

use serde_json::Value;

use crate::camera::{Offsets, Projector, Refused, Vec3};
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

    /// Writes `rgb` over the pixel.
    fn set(&mut self, x: u32, y: u32, rgb: [u8; 3]) {
        let i = (y as usize * self.width as usize + x as usize) * 4;
        self.rgba[i..i + 3].copy_from_slice(&rgb);
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
}

/// The frame being drawn. A pixel a shape covers whole is settled at once: what is on top
/// there, by the depth under the pixel's centre and item index (`draws_over`). A pixel a
/// shape's edge crosses keeps a fragment, the samples of a 4 × 4 grid the shape covers, and
/// is settled at the end, sample by sample, against the other fragments there and the shape
/// covering it whole: so an edge blends over what lies behind it at each sample, never over
/// the ground when a shape is there.
struct Canvas {
    image: Image,
    /// Per pixel, the shape covering it whole that is on top so far: its depth under the
    /// pixel's centre and its index.
    top: Vec<(f64, usize)>,
    edges: Vec<Fragment>,
    /// By item index, the depth and fill of every shape drawn, so a shape covering a pixel
    /// whole is known at each sample when the pixel is settled.
    shapes: Vec<Option<(Depth, [u8; 3])>>,
}

/// A shape's part of a pixel its edge crosses.
struct Fragment {
    pixel: usize,
    index: usize,
    /// The 4 × 4 samples the shape covers, row by row from the top left.
    samples: u16,
    depth: Depth,
    rgb: [u8; 3],
}

/// Where a shape's depth under a point of the panel comes from.
#[derive(Clone, Copy)]
enum Depth {
    /// One depth everywhere: a disc, or a shape of a flat document.
    Flat(f64),
    /// The plane through a point with a normal, in the view's frame: a rectangle in 3D.
    Plane(Vec3, Vec3),
}

impl Depth {
    fn at(self, view: &Projector, x: f64, y: f64) -> f64 {
        match self {
            Depth::Flat(d) => d,
            Depth::Plane(point, normal) => view.depth_on_plane(x, y, point, normal),
        }
    }
}

/// The 4 × 4 sample grid's centres within a pixel from (`x0`, `y0`), each with its bit.
fn samples(x0: f64, y0: f64) -> impl Iterator<Item = (u16, f64, f64)> {
    (0..16).map(move |i| {
        let (sx, sy) = ((i % 4) as f64, (i / 4) as f64);
        (1 << i, x0 + (sx + 0.5) / 4.0, y0 + (sy + 0.5) / 4.0)
    })
}

impl Canvas {
    fn new(width: u32, height: u32, ground: [u8; 3], items: usize) -> Canvas {
        let image = Image::filled(width, height, ground);
        let top = vec![(f64::INFINITY, 0); width as usize * height as usize];
        Canvas {
            image,
            top,
            edges: Vec::new(),
            shapes: vec![None; items],
        }
    }

    /// Takes a shape's `samples` of the pixel at (`x`, `y`): all of them settle the pixel
    /// when the shape is on top there throughout it, some keep a fragment for the end, and so
    /// do both shapes when the new one and the one on top cross inside the pixel: their order
    /// differs at a corner from the centre. The sign of the difference of two depths, each a
    /// plane's under the pixel or a constant, is that of a function affine in the pixel, so
    /// one sign at the centre and the four corners is one sign throughout.
    #[allow(clippy::too_many_arguments)]
    fn put(
        &mut self,
        x: u32,
        y: u32,
        samples: u16,
        depth: Depth,
        index: usize,
        rgb: [u8; 3],
        view: &Projector,
    ) {
        if samples == 0 {
            return;
        }
        let pixel = y as usize * self.image.width as usize + x as usize;
        if samples != 0xffff {
            self.edges.push(Fragment {
                pixel,
                index,
                samples,
                depth,
                rgb,
            });
            return;
        }
        self.shapes[index] = Some((depth, rgb));
        let (x0, y0) = (x as f64, y as f64);
        let at = depth.at(view, x0 + 0.5, y0 + 0.5);
        let (top_at, top_index) = self.top[pixel];
        if let Some((top_depth, top_rgb)) =
            top_at.is_finite().then(|| self.shapes[top_index]).flatten()
        {
            let over = draws_over((at, index), (top_at, top_index));
            let corners = [
                [x0, y0],
                [x0 + 1.0, y0],
                [x0 + 1.0, y0 + 1.0],
                [x0, y0 + 1.0],
            ];
            let crosses = corners.iter().any(|c| {
                let new = (depth.at(view, c[0], c[1]), index);
                draws_over(new, (top_depth.at(view, c[0], c[1]), top_index)) != over
            });
            if crosses {
                for (index, depth, rgb) in [(top_index, top_depth, top_rgb), (index, depth, rgb)] {
                    self.edges.push(Fragment {
                        pixel,
                        index,
                        samples: 0xffff,
                        depth,
                        rgb,
                    });
                }
                self.top[pixel] = (f64::INFINITY, 0);
                return;
            }
            if !over {
                return;
            }
        }
        self.image.set(x, y, rgb);
        self.top[pixel] = (at, index);
    }

    /// Settles every pixel with a fragment: each sample shows the fragment or the shape
    /// covering the pixel whole that is on top at it, by their depths under that sample, or
    /// else the ground; the pixel is their mean.
    fn resolve(mut self, view: &Projector, ground: [u8; 3]) -> Image {
        self.edges.sort_by_key(|f| f.pixel);
        let width = self.image.width as usize;
        let mut from = 0;
        while from < self.edges.len() {
            let pixel = self.edges[from].pixel;
            let to = from
                + self.edges[from..]
                    .iter()
                    .take_while(|f| f.pixel == pixel)
                    .count();
            let (x, y) = ((pixel % width) as u32, (pixel / width) as u32);
            let (whole_at, whole_index) = self.top[pixel];
            let whole = whole_at
                .is_finite()
                .then(|| self.shapes[whole_index])
                .flatten();
            let mut sum = [0.0; 3];
            for (bit, sx, sy) in samples(x as f64, y as f64) {
                let mut best: Option<((f64, usize), [u8; 3])> =
                    whole.map(|(depth, rgb)| ((depth.at(view, sx, sy), whole_index), rgb));
                for f in &self.edges[from..to] {
                    if f.samples & bit == 0 {
                        continue;
                    }
                    let rank = (f.depth.at(view, sx, sy), f.index);
                    if best.is_none_or(|(top, _)| draws_over(rank, top)) {
                        best = Some((rank, f.rgb));
                    }
                }
                let rgb = best.map_or(ground, |(_, rgb)| rgb);
                for (s, c) in sum.iter_mut().zip(rgb) {
                    *s += c as f64;
                }
            }
            let i = pixel * 4;
            for (dst, s) in self.image.rgba[i..i + 3].iter_mut().zip(sum) {
                *dst = (s / 16.0).round() as u8;
            }
            from = to;
        }
        self.image
    }

    /// A facet: the samples its outline covers in each pixel of its bounds; a pixel whose four
    /// corners are inside is covered whole.
    fn fill_facet(&mut self, facet: &Facet, view: &Projector, rgb: [u8; 3], index: usize) {
        let [min, max] = facet.bounds();
        // A clipped outline can reach far past the frame: the casts saturate.
        let px0 = min[0].floor().max(0.0) as i64;
        let py0 = min[1].floor().max(0.0) as i64;
        let px1 = (max[0].ceil() as i64).min(self.image.width as i64);
        let py1 = (max[1].ceil() as i64).min(self.image.height as i64);
        let depth = facet.depth();
        for py in py0..py1 {
            for px in px0..px1 {
                let (x0, y0) = (px as f64, py as f64);
                let corners = [
                    [x0, y0],
                    [x0 + 1.0, y0],
                    [x0 + 1.0, y0 + 1.0],
                    [x0, y0 + 1.0],
                ];
                let covered = if corners.iter().all(|c| facet.contains(c[0], c[1])) {
                    0xffff
                } else {
                    samples(x0, y0)
                        .filter(|(_, sx, sy)| facet.contains(*sx, *sy))
                        .fold(0, |mask, (bit, _, _)| mask | bit)
                };
                self.put(px as u32, py as u32, covered, depth, index, rgb, view);
            }
        }
    }

    /// A disc about (`cx`, `cy`) of radius `r` px at one depth: the samples it covers in each
    /// pixel of its bounds; a pixel whose farthest point is inside is covered whole.
    #[allow(clippy::too_many_arguments)]
    fn fill_disc(
        &mut self,
        cx: f64,
        cy: f64,
        r: f64,
        rgb: [u8; 3],
        depth: f64,
        index: usize,
        view: &Projector,
    ) {
        if r <= 0.0 {
            return;
        }
        let px0 = (cx - r).floor().max(0.0) as i64;
        let py0 = (cy - r).floor().max(0.0) as i64;
        let px1 = ((cx + r).ceil() as i64).min(self.image.width as i64);
        let py1 = ((cy + r).ceil() as i64).min(self.image.height as i64);
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
                let covered = if fx * fx + fy * fy <= r2 {
                    0xffff
                } else {
                    samples(x0, y0)
                        .filter(|(_, sx, sy)| {
                            let (dx, dy) = (sx - cx, sy - cy);
                            dx * dx + dy * dy <= r2
                        })
                        .fold(0, |mask, (bit, _, _)| mask | bit)
                };
                self.put(
                    px as u32,
                    py as u32,
                    covered,
                    Depth::Flat(depth),
                    index,
                    rgb,
                    view,
                );
            }
        }
    }
}

/// How near the eye a perspective view cuts a shape, in the document's units: what lies
/// nearer, or behind the eye, is not shown.
const NEAR: f64 = 1e-6;

/// Whether what is at (`a` depth, item index) is on top of what is at `b`: the nearer, or at
/// one depth the later in item order, exactly, so the order is total and what is on top
/// never depends on which pair was compared first. Rectangles share one plane, anchored at
/// one point (`Facet::of_rect`), so their depths under a pixel are one number, not two that
/// agree to rounding. The renderer draws by it, per pixel, and the session picks by it, so
/// what is picked is what is drawn on top.
pub fn draws_over(a: (f64, usize), b: (f64, usize)) -> bool {
    if a.0 == b.0 {
        a.1 > b.1
    } else {
        a.0 < b.0
    }
}

/// A rectangle as the view shows it: its outline on the panel, cut to what lies in front of a
/// perspective eye, and its plane in the view's frame, so its depth is known under every
/// pixel it covers. The renderer fills it and the session picks by it.
pub struct Facet {
    outline: Vec<[f64; 2]>,
    /// Twice the outline's signed area, taken once for the many points a fill tests.
    area: f64,
    point: Vec3,
    normal: Vec3,
    /// Of a flat document, where every depth is 1.
    flat: bool,
}

impl Facet {
    /// The rectangle from (`x`, `y`) of `w` × `h` on the document's page, or `None` when no
    /// part of it lies in front of the eye.
    pub fn of_rect(view: &Projector, x: f64, y: f64, w: f64, h: f64) -> Option<Facet> {
        let corners = [
            [x, y, 0.0],
            [x + w, y, 0.0],
            [x + w, y + h, 0.0],
            [x, y + h, 0.0],
        ]
        .map(|c| view.to_view(c));
        let kept = if view.is_perspective() {
            clip_near(&corners)
        } else {
            corners.to_vec()
        };
        if kept.len() < 3 {
            return None;
        }
        let outline = kept
            .iter()
            .map(|v| view.project_view(*v).map(|p| [p.x, p.y]))
            .collect::<Option<Vec<_>>>()?;
        Some(Facet {
            area: twice_area(&outline),
            outline,
            // The page's own origin, the same for every rectangle, so coplanar rectangles
            // meet their plane at bit-equal depths and item order decides between them.
            point: view.to_view([0.0, 0.0, 0.0]),
            normal: view.direction_to_view([0.0, 0.0, 1.0]),
            flat: view.is_flat(),
        })
    }

    /// Whether a point of the panel is inside the outline, or on its edge.
    pub fn contains(&self, x: f64, y: f64) -> bool {
        inside(&self.outline, self.area, x, y)
    }

    /// The facet's depth under a point of the panel.
    pub fn depth_at(&self, view: &Projector, x: f64, y: f64) -> f64 {
        self.depth().at(view, x, y)
    }

    fn depth(&self) -> Depth {
        if self.flat {
            Depth::Flat(1.0)
        } else {
            Depth::Plane(self.point, self.normal)
        }
    }

    fn bounds(&self) -> [[f64; 2]; 2] {
        let mut min = [f64::INFINITY; 2];
        let mut max = [f64::NEG_INFINITY; 2];
        for p in &self.outline {
            for axis in 0..2 {
                min[axis] = min[axis].min(p[axis]);
                max[axis] = max[axis].max(p[axis]);
            }
        }
        [min, max]
    }
}

/// The part of a convex outline in the view's frame at depth `NEAR` or more, in order
/// around it: each edge keeps its end in front and, where it crosses the cut, the crossing.
fn clip_near(corners: &[Vec3; 4]) -> Vec<Vec3> {
    let mut kept = Vec::with_capacity(5);
    for i in 0..4 {
        let (a, b) = (corners[i], corners[(i + 1) % 4]);
        let (fa, fb) = (a[2] >= NEAR, b[2] >= NEAR);
        if fa {
            kept.push(a);
        }
        if fa != fb {
            let t = (NEAR - a[2]) / (b[2] - a[2]);
            kept.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, NEAR]);
        }
    }
    kept
}

/// Twice the signed area of an outline given in order; its sign is the side the outline turns to.
fn twice_area(outline: &[[f64; 2]]) -> f64 {
    let n = outline.len();
    (0..n)
        .map(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum()
}

/// Whether a point is inside (or on the edge of) a convex outline given in order, of
/// [`twice_area`] `area`: on one side of every edge, the side the outline turns to. An outline of
/// no area holds nothing.
fn inside(outline: &[[f64; 2]], area: f64, x: f64, y: f64) -> bool {
    let n = outline.len();
    area != 0.0
        && (0..n).all(|i| {
            let (a, b) = (outline[i], outline[(i + 1) % n]);
            ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) * area >= 0.0
        })
}

/// Rasterizes the scene's frame scaled to `frame` px into a `panel` of `width` × `height`.
fn raster(scene: &Scene, frame: [f64; 2], width: u32, height: u32, ground: [u8; 3]) -> Image {
    let pose = scene.spec.pose(&scene.rig, &Offsets::default());
    let view = Projector::new(&pose, frame, [width as f64, height as f64]);
    let mut canvas = Canvas::new(width, height, ground, scene.items.len());
    // Every shown shape, in any order: which is on top at a pixel is settled there, by the
    // depth under it (Canvas). Picking (session) ranks the same way.
    // The still frame shows the view every view-class control declares as its default.
    let view_defaults = scene.view_defaults();
    for (index, item) in scene
        .items
        .iter()
        .enumerate()
        .filter(|(_, i)| scene.shown(i, &view_defaults))
    {
        match item.shape {
            Shape::Rect { x, y, w, h } => {
                if let Some(facet) = Facet::of_rect(&view, x, y, w, h) {
                    canvas.fill_facet(&facet, &view, item.fill, index);
                }
            }
            Shape::Dot { pos, radius } => {
                if let Some(p) = view.project(pos) {
                    canvas.fill_disc(p.x, p.y, radius * p.scale, item.fill, p.depth, index, &view);
                }
            }
        }
    }
    canvas.resolve(&view, ground)
}

/// The document's still frame in a panel of `panel` px, the look's ground given as `ground`.
pub fn render(doc: &Value, panel: [u32; 2], ground: [u8; 3]) -> Result<Image, Refused> {
    let scene = scene(doc)?;
    let [w, h] = crate::draw::size(doc)?;
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

    fn scene3d(camera: Value, items: Value) -> Value {
        let mut items = items;
        items["cam"] = json!({"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0", "params": camera});
        json!({
            "format": 1, "id": "d", "profile": "scene", "title": "T", "description": "D",
            "size": [100, 100], "aspect": "extend", "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "M", "order": "a0"}},
            "items": items
        })
    }

    fn rect(id: &str, order: &str, x: f64, y: f64, w: f64, h: f64, fill: [u8; 3]) -> Value {
        json!({"id": id, "kind": "test.rect@1", "layer": "main", "name": id, "order": order, "params": {"w": w, "h": h, "fill": fill}, "at": {"pos": [x, y, 0]}})
    }

    fn pixel(image: &Image, x: u32, y: u32) -> [u8; 3] {
        let i = (y as usize * image.width as usize + x as usize) * 4;
        [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]]
    }

    /// Where a point of the document lands on a 100 × 100 frame, by the scene's own projector.
    fn pixel_of(doc: &Value, p: Vec3) -> (u32, u32) {
        let scene = scene(doc).unwrap();
        let pose = scene.spec.pose(&scene.rig, &Offsets::default());
        let view = Projector::new(&pose, [100.0, 100.0], [100.0, 100.0]);
        let at = view.project(p).unwrap();
        (at.x.floor() as u32, at.y.floor() as u32)
    }

    #[test]
    fn of_two_coplanar_rectangles_seen_obliquely_the_later_draws_over_the_earlier_where_they_overlap(
    ) {
        // The eye at the left: the small later rectangle's centre is farther than the big
        // earlier one's, but they share one plane, so at every pixel the later is on top.
        let d = scene3d(
            json!({"position": [-5, 5, 10], "target": [5, 5, 0], "fov": 60}),
            json!({
                "a": rect("a", "a1", 0.0, 0.0, 10.0, 10.0, [255, 0, 0]),
                "b": rect("b", "a2", 6.0, 0.0, 4.0, 10.0, [0, 0, 255])
            }),
        );
        let image = render(&d, [100, 100], [0, 0, 0]).ok().unwrap();
        let (x, y) = pixel_of(&d, [8.0, 5.0, 0.0]);
        assert_eq!(pixel(&image, x, y), [0, 0, 255]);
        let (x, y) = pixel_of(&d, [3.0, 5.0, 0.0]);
        assert_eq!(pixel(&image, x, y), [255, 0, 0]);
    }

    #[test]
    fn a_rectangles_edge_blends_over_the_disc_behind_it_not_over_the_ground() {
        // The rectangle's near edge is in front of the disc, but its mean depth is behind the
        // disc's, so the disc comes later in the stack: at the edge's pixels the part the
        // rectangle leaves uncovered shows the disc, never the ground.
        let d = scene3d(
            json!({"position": [-5, 5, 10], "target": [5, 5, 0], "fov": 60}),
            json!({
                "r": rect("r", "a1", 0.0, 0.0, 10.0, 10.0, [255, 0, 0]),
                "d": {"id": "d", "kind": "test.dot@1", "layer": "main", "name": "D", "order": "a2", "params": {"radius": 2, "fill": [0, 0, 255]}, "at": {"pos": [0, 5, -1]}}
            }),
        );
        let image = render(&d, [100, 100], [0, 0, 0]).ok().unwrap();
        let (x, y) = pixel_of(&d, [0.0, 5.0, 0.0]);
        let row: Vec<[u8; 3]> = (x - 1..=x + 1).map(|x| pixel(&image, x, y)).collect();
        assert!(
            row.iter().all(|p| p[0] as u32 + p[2] as u32 >= 250),
            "ground shows through: {row:?}"
        );
        assert!(
            row.iter().any(|p| p[0] > 0 && p[2] > 0),
            "no pixel blends the two: {row:?}"
        );
    }

    #[test]
    fn where_a_disc_crosses_a_sloping_rectangle_inside_one_pixel_each_sample_shows_its_own_top() {
        // The disc is at the rectangle's depth under the centre of pixel (52, 50): left of
        // that the rectangle is nearer, right of it the disc, so the pixel to the left is the
        // rectangle's, the one to the right the disc's, and that pixel mixes the two.
        let camera = json!({"position": [-5, 5, 10], "target": [5, 5, 0], "fov": 60});
        let d = scene3d(
            camera.clone(),
            json!({"r": rect("r", "a1", 0.0, 0.0, 10.0, 10.0, [255, 0, 0])}),
        );
        let scene = scene(&d).unwrap();
        let pose = scene.spec.pose(&scene.rig, &Offsets::default());
        let view = Projector::new(&pose, [100.0, 100.0], [100.0, 100.0]);
        let facet = Facet::of_rect(&view, 0.0, 0.0, 10.0, 10.0).unwrap();
        let depth = facet.depth_at(&view, 52.5, 50.5);
        // That far along the line of sight from the eye: the disc's centre is the frame's.
        let along = depth / crate::ops::sqrt(200.0);
        let dot = [-5.0 + 10.0 * along, 5.0, 10.0 - 10.0 * along];
        let d = scene3d(
            camera,
            json!({
                "r": rect("r", "a1", 0.0, 0.0, 10.0, 10.0, [255, 0, 0]),
                "d": {"id": "d", "kind": "test.dot@1", "layer": "main", "name": "D", "order": "a2", "params": {"radius": 1, "fill": [0, 0, 255]}, "at": {"pos": dot}}
            }),
        );
        let image = render(&d, [100, 100], [0, 0, 0]).ok().unwrap();
        assert_eq!(pixel(&image, 51, 50), [255, 0, 0]);
        assert_eq!(pixel(&image, 53, 50), [0, 0, 255]);
        let mixed = pixel(&image, 52, 50);
        assert!(
            mixed[0] > 0 && mixed[2] > 0,
            "one shape took the pixel: {mixed:?}"
        );
    }

    #[test]
    fn at_a_great_depth_the_nearest_of_three_shapes_within_a_unit_is_on_top() {
        // Seen from a thousand million units up: the page at that depth, a disc 0.75 under
        // it and another 1.4 under it. Only exact depths order them; any band of nearness
        // relative to the depth would let the two discs tie the page by item order in turn.
        let d = scene3d(
            json!({"projection": "orthographic", "position": [5, 5, 1e9], "target": [5, 5, 0], "view_width": 10}),
            json!({
                "r": rect("r", "a1", 0.0, 0.0, 10.0, 10.0, [255, 0, 0]),
                "b": {"id": "b", "kind": "test.dot@1", "layer": "main", "name": "B", "order": "a2", "params": {"radius": 1, "fill": [0, 0, 255]}, "at": {"pos": [5, 5, -0.75]}},
                "c": {"id": "c", "kind": "test.dot@1", "layer": "main", "name": "C", "order": "a3", "params": {"radius": 1, "fill": [0, 255, 0]}, "at": {"pos": [5, 5, -1.4]}}
            }),
        );
        let image = render(&d, [100, 100], [0, 0, 0]).ok().unwrap();
        assert_eq!(pixel(&image, 50, 50), [255, 0, 0]);
    }

    #[test]
    fn a_rectangle_with_a_corner_behind_the_eye_still_draws_what_lies_in_front() {
        let d = scene3d(
            json!({"position": [0, 5, 3], "target": [10, 5, 0], "fov": 60}),
            json!({"r": rect("r", "a1", -5.0, 0.0, 20.0, 10.0, [255, 0, 0])}),
        );
        let image = render(&d, [100, 100], [0, 0, 0]).ok().unwrap();
        // The target is on the rectangle and in front of the eye: the frame's centre shows it.
        assert_eq!(pixel(&image, 50, 50), [255, 0, 0]);
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
