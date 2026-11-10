//! The unit meshes objects scale: a box, a cylinder about +Y and a sphere, each 1 m across and
//! centred on the origin, with outward normals. Built once per device; an object's move or size
//! touches only its instance record. Every vertex carries its normal, two texture coordinates and
//! a tangent with its handedness in w (glTF's TANGENT), which a material's maps read (#423).

use deep_canvas_scene3d::scene::Shape;
use deep_gpu::device::Device;
use wgpu::util::DeviceExt as _;

#[derive(Clone)]
pub struct Mesh {
    pub vertices: wgpu::Buffer,
    pub indices: wgpu::Buffer,
    pub count: u32,
}

const SEGMENTS: u32 = 48;
const RINGS: u32 = 24;
/// Floats per vertex: position, normal, uv0, uv1 and the tangent.
pub const FLOATS: usize = 14;

fn push(v: &mut Vec<f32>, p: [f32; 3], n: [f32; 3], uv: [f32; 2], t: [f32; 4]) {
    v.extend_from_slice(&p);
    v.extend_from_slice(&n);
    v.extend_from_slice(&uv);
    v.extend_from_slice(&uv);
    v.extend_from_slice(&t);
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(crate) fn geometry(shape: Shape) -> (Vec<f32>, Vec<u32>) {
    let mut v = Vec::new();
    let mut i = Vec::new();
    match shape {
        Shape::Box => {
            let faces: [([f32; 3], [f32; 3], [f32; 3]); 6] = [
                ([1., 0., 0.], [0., 1., 0.], [0., 0., 1.]),
                ([-1., 0., 0.], [0., 0., 1.], [0., 1., 0.]),
                ([0., 1., 0.], [0., 0., 1.], [1., 0., 0.]),
                ([0., -1., 0.], [1., 0., 0.], [0., 0., 1.]),
                ([0., 0., 1.], [1., 0., 0.], [0., 1., 0.]),
                ([0., 0., -1.], [0., 1., 0.], [1., 0., 0.]),
            ];
            for (n, a, b) in faces {
                let base = (v.len() / FLOATS) as u32;
                // u runs along a and v against b, so the tangent is a; its handedness makes
                // cross(n, t) × w point along +v.
                let w = if dot(cross(n, a), b) > 0.0 { -1.0 } else { 1.0 };
                for (sa, sb) in [(-0.5f32, -0.5f32), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
                    let p = [
                        n[0] * 0.5 + a[0] * sa + b[0] * sb,
                        n[1] * 0.5 + a[1] * sa + b[1] * sb,
                        n[2] * 0.5 + a[2] * sa + b[2] * sb,
                    ];
                    push(&mut v, p, n, [sa + 0.5, 0.5 - sb], [a[0], a[1], a[2], w]);
                }
                i.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
            }
        }
        Shape::Cylinder => {
            let around = |k: u32| {
                let a = std::f32::consts::TAU * k as f32 / SEGMENTS as f32;
                (a.cos(), a.sin())
            };
            let side = (v.len() / FLOATS) as u32;
            for k in 0..=SEGMENTS {
                let (c, s) = around(k);
                let u = k as f32 / SEGMENTS as f32;
                let t = [-s, 0., c, -1.];
                push(&mut v, [0.5 * c, -0.5, 0.5 * s], [c, 0., s], [u, 1.], t);
                push(&mut v, [0.5 * c, 0.5, 0.5 * s], [c, 0., s], [u, 0.], t);
            }
            for k in 0..SEGMENTS {
                let a = side + 2 * k;
                i.extend([a, a + 1, a + 2, a + 1, a + 3, a + 2]);
            }
            for (y, ny) in [(0.5f32, 1f32), (-0.5, -1.)] {
                let centre = (v.len() / FLOATS) as u32;
                let t = [1., 0., 0., ny];
                push(&mut v, [0., y, 0.], [0., ny, 0.], [0.5, 0.5], t);
                for k in 0..=SEGMENTS {
                    let (c, s) = around(k);
                    push(
                        &mut v,
                        [0.5 * c, y, 0.5 * s],
                        [0., ny, 0.],
                        [0.5 + 0.5 * c, 0.5 + 0.5 * s * ny],
                        t,
                    );
                }
                // Counter-clockwise from outside, as back-face culling reads it (#421).
                for k in 0..SEGMENTS {
                    if ny > 0.0 {
                        i.extend([centre, centre + 2 + k, centre + 1 + k]);
                    } else {
                        i.extend([centre, centre + 1 + k, centre + 2 + k]);
                    }
                }
            }
        }
        // A builder's mesh comes with its solid (`Mesh::of`).
        Shape::Built(_) => {}
        Shape::Sphere => {
            for r in 0..=RINGS {
                let phi = std::f32::consts::PI * r as f32 / RINGS as f32;
                for k in 0..=SEGMENTS {
                    let th = std::f32::consts::TAU * k as f32 / SEGMENTS as f32;
                    let n = [phi.sin() * th.cos(), phi.cos(), phi.sin() * th.sin()];
                    let uv = [k as f32 / SEGMENTS as f32, r as f32 / RINGS as f32];
                    let t = [-th.sin(), 0., th.cos(), -1.];
                    push(&mut v, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], n, uv, t);
                }
            }
            let row = SEGMENTS + 1;
            for r in 0..RINGS {
                for k in 0..SEGMENTS {
                    let a = r * row + k;
                    i.extend([a, a + 1, a + row, a + 1, a + row + 1, a + row]);
                }
            }
        }
    }
    (v, i)
}

/// A built mesh's vertices: its uv0 and uv1 (uv1 falls back to uv0, both to 0 without one), and
/// its own tangents or ones made from uv0 by each triangle's texture-space derivatives, weighted
/// by its area, with the handedness of its bitangent.
pub fn vertices(m: &deep_canvas_scene3d::geom::Mesh) -> Vec<f32> {
    let f = |p: [f64; 3]| p.map(|x| x as f32);
    let uv0 = |i: usize| {
        m.uv0
            .get(i)
            .map_or([0.0; 2], |u| [u[0] as f32, u[1] as f32])
    };
    let uv1 = |i: usize| m.uv1.get(i).map_or(uv0(i), |u| [u[0] as f32, u[1] as f32]);
    let count = m.positions.len();
    let mut tangents = m
        .tangents
        .iter()
        .map(|t| t.map(|x| x as f32))
        .collect::<Vec<_>>();
    if tangents.len() != count {
        let (mut ts, mut bs) = (vec![[0f32; 3]; count], vec![[0f32; 3]; count]);
        for tri in m.indices.as_chunks::<3>().0 {
            let [a, b, c] = [tri[0] as usize, tri[1] as usize, tri[2] as usize];
            let (pa, pb, pc) = (f(m.positions[a]), f(m.positions[b]), f(m.positions[c]));
            let (ua, ub, uc) = (uv0(a), uv0(b), uv0(c));
            let e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
            let e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
            let (du1, dv1, du2, dv2) = (ub[0] - ua[0], ub[1] - ua[1], uc[0] - ua[0], uc[1] - ua[1]);
            let det = du1 * dv2 - du2 * dv1;
            if det.abs() < 1e-12 {
                continue;
            }
            let r = 1.0 / det;
            let t = [0, 1, 2].map(|k| (e1[k] * dv2 - e2[k] * dv1) * r);
            let bt = [0, 1, 2].map(|k| (e2[k] * du1 - e1[k] * du2) * r);
            for i in [a, b, c] {
                for k in 0..3 {
                    ts[i][k] += t[k];
                    bs[i][k] += bt[k];
                }
            }
        }
        tangents = (0..count)
            .map(|i| {
                let n = m.normals.get(i).map_or([0.0, 1.0, 0.0], |n| f(*n));
                let t = ts[i];
                // Gram-Schmidt against the normal.
                let d = dot(n, t);
                let mut o = [t[0] - n[0] * d, t[1] - n[1] * d, t[2] - n[2] * d];
                let len = dot(o, o).sqrt();
                if len < 1e-12 {
                    let any = if n[0].abs() < 0.9 {
                        [1.0, 0.0, 0.0]
                    } else {
                        [0.0, 1.0, 0.0]
                    };
                    o = cross(any, n);
                    let l = dot(o, o).sqrt();
                    o = o.map(|x| x / l);
                } else {
                    o = o.map(|x| x / len);
                }
                let w = if dot(cross(n, o), bs[i]) < 0.0 {
                    -1.0
                } else {
                    1.0
                };
                [o[0], o[1], o[2], w]
            })
            .collect();
    }
    let mut v = Vec::with_capacity(count * FLOATS);
    for (i, (p, t)) in m.positions.iter().zip(&tangents).enumerate() {
        let n = m.normals.get(i).map_or([0.0, 1.0, 0.0], |n| f(*n));
        v.extend_from_slice(&f(*p));
        v.extend_from_slice(&n);
        v.extend_from_slice(&uv0(i));
        v.extend_from_slice(&uv1(i));
        v.extend_from_slice(t);
    }
    v
}

impl Mesh {
    pub fn build(device: &Device, shape: Shape) -> Mesh {
        let (v, i) = geometry(shape);
        Mesh::upload(device, &v, &i, wgpu::BufferUsages::empty())
    }

    /// A builder's mesh, in its item's space (#420), with its texture coordinates and tangents
    /// (#423).
    pub fn of(device: &Device, m: &deep_canvas_scene3d::geom::Mesh) -> Mesh {
        Mesh::upload(
            device,
            &vertices(m),
            &m.indices,
            wgpu::BufferUsages::empty(),
        )
    }

    /// A swaying builder's mesh (#2016), whose vertices the sway pass writes at every frame.
    pub fn swaying(device: &Device, v: &[f32], i: &[u32]) -> Mesh {
        Mesh::upload(device, v, i, wgpu::BufferUsages::STORAGE)
    }

    fn upload(device: &Device, v: &[f32], i: &[u32], usage: wgpu::BufferUsages) -> Mesh {
        let d = &device.device;
        Mesh {
            vertices: d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d mesh"),
                contents: bytemuck::cast_slice(v),
                // A check reads back what a frame drew from (#2016).
                usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_SRC | usage,
            }),
            indices: d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d mesh indices"),
                contents: bytemuck::cast_slice(i),
                usage: wgpu::BufferUsages::INDEX,
            }),
            count: i.len() as u32,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_unit_mesh_is_wound_counter_clockwise_from_outside() {
        for shape in [Shape::Box, Shape::Cylinder, Shape::Sphere] {
            let (v, i) = geometry(shape);
            let at = |k: u32| {
                let o = k as usize * FLOATS;
                ([v[o], v[o + 1], v[o + 2]], [v[o + 3], v[o + 4], v[o + 5]])
            };
            for t in i.as_chunks::<3>().0 {
                let (a, n) = at(t[0]);
                let (b, _) = at(t[1]);
                let (c, _) = at(t[2]);
                let e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                let f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                let x = [
                    e[1] * f[2] - e[2] * f[1],
                    e[2] * f[0] - e[0] * f[2],
                    e[0] * f[1] - e[1] * f[0],
                ];
                let area = (x[0] * x[0] + x[1] * x[1] + x[2] * x[2]).sqrt();
                // A pole's triangles have no area.
                if area > 1e-9 {
                    assert!(
                        x[0] * n[0] + x[1] * n[1] + x[2] * n[2] > 0.0,
                        "{shape:?} {t:?}"
                    );
                }
            }
        }
    }
}
