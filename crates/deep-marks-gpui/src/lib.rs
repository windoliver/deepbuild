//! The canvas's 2D marks where GPUI draws (issue #380): a mesh deep-canvas-marks tessellated, a
//! path's fill or its stroke paint, painted as one GPUI path in one color.

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
