//! The canvas's 2D marks where GPUI draws (issue #380): a mesh deep-canvas-marks tessellated, a
//! path's fill or its stroke paint, painted as one GPUI path in one color. Issue #140: a stroke
//! paint goes as a [`Strip`], whose edges GPUI's path shader antialiases analytically, since its
//! 4x path MSAA moves a thin stroke's coverage centroid by up to half a pixel.

use deep_canvas_marks::path::{self, Mesh, Polyline};
use gpui_kit::*;

/// The stroke of `width` px along `points`, as the stroke paint tessellates an open path.
pub fn stroke(points: Vec<[f64; 2]>, width: f64) -> Mesh {
    let mut mesh = Mesh::default();
    path::stroke(
        &[Polyline {
            points,
            closed: false,
        }],
        width,
        &mut mesh,
    );
    mesh
}

/// Paints `mesh`'s triangles, moved by `offset` px.
pub fn paint(mesh: &Mesh, offset: [f32; 2], color: Hsla, window: &mut Window) {
    let at = |p: [f32; 2]| point(px(p[0] + offset[0]), px(p[1] + offset[1]));
    let mut triangles = mesh.triangles();
    let Some(first) = triangles.next() else {
        return;
    };
    let solid = (point(0., 1.), point(0., 1.), point(0., 1.));
    let mut path = Path::new(at(first[0]));
    path.push_triangle((at(first[0]), at(first[1]), at(first[2])), solid);
    for t in triangles {
        path.push_triangle((at(t[0]), at(t[1]), at(t[2])), solid);
    }
    window.paint_path(path, color);
}

/// How far past a stroke's edge its strip reaches, in device px: a pixel whose centre lies within
/// half a pixel of the edge has coverage, and its corners reach √½ px past that, so the strip
/// covers every such pixel whole and MSAA never cuts its coverage.
const FRINGE_PX: f64 = 1.25;
/// `s` over `t` in a strip's curve coordinates: GPUI's path shader takes a triangle whose `s`
/// doesn't vary as solid, and `s²` stays a negligible part of the implicit `s² − t`.
const S_PER_T: f32 = 0.05;
/// A join whose half angle's cosine is below this breaks the strip: its miter would reach past
/// the stroke paint's miter limit of 4.
const SHARPEST: f64 = 0.25;

/// A stroke as triangles in u, each corner with GPUI's curve coordinates `(s, t)`, `t` its
/// distance inside the stroke's nearer edge in u (issue #140, criterion 6). GPUI's path shader
/// divides the implicit `s² − t` by its screen-space gradient, so a pixel's coverage is
/// `clamp(0.5 + d, 0, 1)` for its centre's distance `d` inside the edge in device px: a ramp one
/// pixel wide centred on the edge, which keeps the stroke's area and its centroid where 4x MSAA
/// moved them. Each side of the line is its own band, from the centreline out past the edge, its
/// segments meeting at miter corners so no two triangles overlap; a join past the miter limit
/// breaks the band and fills its outer corner solid, and a butt end is cut where the stroke ends.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Strip {
    /// Each triangle's three corners in turn: a position in u and its `(s, t)`.
    pub corners: Vec<([f32; 2], [f32; 2])>,
}

impl Strip {
    /// Its corners' positions and curve coordinates as bytes, for a cache entry.
    pub fn bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.corners.len() * 16);
        for (p, st) in &self.corners {
            for v in [p[0], p[1], st[0], st[1]] {
                out.extend(v.to_le_bytes());
            }
        }
        out
    }

    fn corner(&mut self, p: [f64; 2], t: f64) {
        let t = t as f32;
        self.corners
            .push(([p[0] as f32, p[1] as f32], [S_PER_T * t, t]));
    }
}

fn unit(d: [f64; 2]) -> Option<[f64; 2]> {
    let l = (d[0] * d[0] + d[1] * d[1]).sqrt();
    (l > 1e-9).then(|| [d[0] / l, d[1] / l])
}

/// The strip of a stroke `width` u wide along `lines` (deep-canvas-marks' flattening), its fringe
/// reaching [`FRINGE_PX`] device px past the edge at `u_per_px` u a device px or fewer.
pub fn strip(lines: &[Polyline], width: f64, u_per_px: f64) -> Strip {
    let hw = 0.5 * width;
    let reach = hw + FRINGE_PX * u_per_px;
    let mut out = Strip::default();
    for line in lines {
        let mut pts: Vec<[f64; 2]> = Vec::with_capacity(line.points.len());
        for p in &line.points {
            if pts.last() != Some(p) {
                pts.push(*p);
            }
        }
        if line.closed && pts.len() > 2 && pts.first() == pts.last() {
            pts.pop();
        }
        let n = pts.len();
        if n < 2 {
            continue;
        }
        let segments = if line.closed { n } else { n - 1 };
        let normals: Vec<[f64; 2]> = (0..segments)
            .map(|i| {
                let (a, b) = (pts[i], pts[(i + 1) % n]);
                let d = unit([b[0] - a[0], b[1] - a[1]]).unwrap_or([1.0, 0.0]);
                [-d[1], d[0]]
            })
            .collect();
        // The corner direction where segment `i` meets segment `j`, scaled so the corner sits
        // `reach` from both segments' lines; `None` where the join breaks the band.
        let miter = |i: usize, j: usize| -> Option<[f64; 2]> {
            let (a, b) = (normals[i], normals[j]);
            let m = unit([a[0] + b[0], a[1] + b[1]])?;
            let c = m[0] * a[0] + m[1] * a[1];
            (c >= SHARPEST).then(|| [m[0] / c, m[1] / c])
        };
        let joined = |i: usize| line.closed || i + 1 < segments;
        for i in 0..segments {
            let own = normals[i];
            let m0 = if line.closed || i > 0 {
                miter((i + segments - 1) % segments, i)
            } else {
                None
            };
            let m1 = if joined(i) {
                miter(i, (i + 1) % segments)
            } else {
                None
            };
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            let (m0, m1) = (m0.unwrap_or(own), m1.unwrap_or(own));
            let edge = hw - reach;
            for side in [1.0, -1.0] {
                let oa = [a[0] + side * m0[0] * reach, a[1] + side * m0[1] * reach];
                let ob = [b[0] + side * m1[0] * reach, b[1] + side * m1[1] * reach];
                out.corner(a, hw);
                out.corner(b, hw);
                out.corner(ob, edge);
                out.corner(a, hw);
                out.corner(ob, edge);
                out.corner(oa, edge);
            }
            // A broken join's outer corner, solid, beveled as the stroker bevels it.
            if joined(i) && miter(i, (i + 1) % segments).is_none() {
                let next = normals[(i + 1) % segments];
                let cross = own[0] * next[1] - own[1] * next[0];
                let s = if cross > 0.0 { -1.0 } else { 1.0 };
                out.corner(b, hw);
                out.corner([b[0] + s * own[0] * hw, b[1] + s * own[1] * hw], hw);
                out.corner([b[0] + s * next[0] * hw, b[1] + s * next[1] * hw], hw);
            }
        }
    }
    out
}

/// Paints `strip`'s triangles with their curve coordinates, moved by `offset` px.
pub fn paint_strip(strip: &Strip, offset: [f32; 2], color: Hsla, window: &mut Window) {
    let at = |p: [f32; 2]| point(px(p[0] + offset[0]), px(p[1] + offset[1]));
    let st = |c: [f32; 2]| point(c[0], c[1]);
    let mut triangles = strip.corners.as_chunks::<3>().0.iter();
    let Some(first) = triangles.next() else {
        return;
    };
    let mut path = Path::new(at(first[0].0));
    for t in std::iter::once(first).chain(triangles) {
        path.push_triangle(
            (at(t[0].0), at(t[1].0), at(t[2].0)),
            (st(t[0].1), st(t[1].1), st(t[2].1)),
        );
    }
    window.paint_path(path, color);
}
