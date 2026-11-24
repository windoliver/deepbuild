//! #2660 criterion 5, the mesh half: a painted 1,000-triangle mesh allocates its vertices once,
//! counted by the test.
//!
//! What `deep_marks_gpui::paint` paints is the GPUI path `deep_marks_gpui::path` builds from the
//! mesh (the hook this criterion adds; README), so the test counts that build's heap allocations,
//! as `crates/deep-marks-render/tests/no_alloc.rs` counts them: one, its vertices. The merge base
//! builds the path by pushing three vertices a triangle onto a path started empty, so the vector
//! grows and copies about ten times for this mesh; the counter sees that too.

mod alloc;

#[global_allocator]
static ALLOCATOR: alloc::Counting = alloc::Counting;

use deep_canvas_marks::path::Mesh;
use gpui_kit::{point, px, Path, Pixels};

const TRIANGLES: usize = 1_000;

/// 1,000 triangles over a band of 250 quads, each quad split both ways.
fn mesh() -> Mesh {
    let mut mesh = Mesh::default();
    for row in 0..2 {
        for col in 0..=250 {
            mesh.vertices.push([col as f32 * 2.0, row as f32 * 3.0]);
        }
    }
    for col in 0..250u32 {
        let (a, b, c, d) = (col, col + 1, 251 + col, 252 + col);
        mesh.indices.extend([a, b, c, b, d, c]);
    }
    // The same 250 quads again, each split the other way: 1,000 triangles in all.
    for col in 0..250u32 {
        let (a, b, c, d) = (col, col + 1, 251 + col, 252 + col);
        mesh.indices.extend([c, d, a, d, b, a]);
    }
    assert_eq!(mesh.indices.len(), TRIANGLES * 3);
    mesh
}

// AC5 #2660.732be9a5
#[test]
fn ac5_a_painted_1000_triangle_mesh_allocates_its_vertices_once() {
    let mesh = mesh();
    let offset = [4.0, 6.0];
    let (path, counted) = alloc::counted(|| deep_marks_gpui::path(&mesh, offset));
    let path: Path<Pixels> = path.expect("a mesh with triangles paints a path");
    eprintln!(
        "path of {} triangles: {} allocations, {} bytes",
        TRIANGLES, counted.count, counted.bytes
    );
    // The path holds the mesh's triangles, moved by the offset, in order.
    assert_eq!(path.vertices.len(), TRIANGLES * 3, "three vertices a triangle");
    let want: Vec<_> = mesh
        .triangles()
        .flatten()
        .map(|p| point(px(p[0] + offset[0]), px(p[1] + offset[1])))
        .collect();
    let got: Vec<_> = path.vertices.iter().map(|v| v.xy_position).collect();
    assert!(got == want, "the path's vertices are the mesh's, moved");
    // The counter sees the merge base's way: a path started empty, three vertices pushed a
    // triangle.
    let (_, base) = alloc::counted(|| {
        let solid = (point(0., 1.), point(0., 1.), point(0., 1.));
        let mut p = Path::new(want[0]);
        for t in want.chunks(3) {
            p.push_triangle((t[0], t[1], t[2]), solid);
        }
        p
    });
    assert!(base.count > 1, "the counter counts: {} allocations", base.count);
    assert_eq!(
        counted.count, 1,
        "the path of a {TRIANGLES}-triangle mesh allocated {} times ({} bytes); its vertices once is owed (the merge base's way: {})",
        counted.count, counted.bytes, base.count
    );
}
