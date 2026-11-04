//! The unit meshes objects scale: a box, a cylinder about +Y and a sphere, each 1 m across and
//! centred on the origin, with outward normals. Built once per device; an object's move or size
//! touches only its instance record.

use deep_canvas_scene3d::scene::Shape;
use deep_gpu::device::Device;
use wgpu::util::DeviceExt as _;

pub struct Mesh {
    pub vertices: wgpu::Buffer,
    pub indices: wgpu::Buffer,
    pub count: u32,
}

const SEGMENTS: u32 = 48;
const RINGS: u32 = 24;

fn push(v: &mut Vec<f32>, p: [f32; 3], n: [f32; 3]) {
    v.extend_from_slice(&p);
    v.extend_from_slice(&n);
}

fn geometry(shape: Shape) -> (Vec<f32>, Vec<u32>) {
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
                let base = (v.len() / 6) as u32;
                for (sa, sb) in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
                    let p = [
                        n[0] * 0.5 + a[0] * sa + b[0] * sb,
                        n[1] * 0.5 + a[1] * sa + b[1] * sb,
                        n[2] * 0.5 + a[2] * sa + b[2] * sb,
                    ];
                    push(&mut v, p, n);
                }
                i.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
            }
        }
        Shape::Cylinder => {
            let around = |k: u32| {
                let a = std::f32::consts::TAU * k as f32 / SEGMENTS as f32;
                (a.cos(), a.sin())
            };
            let side = (v.len() / 6) as u32;
            for k in 0..=SEGMENTS {
                let (c, s) = around(k);
                push(&mut v, [0.5 * c, -0.5, 0.5 * s], [c, 0., s]);
                push(&mut v, [0.5 * c, 0.5, 0.5 * s], [c, 0., s]);
            }
            for k in 0..SEGMENTS {
                let a = side + 2 * k;
                i.extend([a, a + 1, a + 2, a + 1, a + 3, a + 2]);
            }
            for (y, ny) in [(0.5f32, 1f32), (-0.5, -1.)] {
                let centre = (v.len() / 6) as u32;
                push(&mut v, [0., y, 0.], [0., ny, 0.]);
                for k in 0..=SEGMENTS {
                    let (c, s) = around(k);
                    push(&mut v, [0.5 * c, y, 0.5 * s], [0., ny, 0.]);
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
                    push(&mut v, [n[0] * 0.5, n[1] * 0.5, n[2] * 0.5], n);
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

impl Mesh {
    pub fn build(device: &Device, shape: Shape) -> Mesh {
        let (v, i) = geometry(shape);
        Mesh::upload(device, &v, &i)
    }

    /// A builder's mesh, in its item's space (#420).
    pub fn of(device: &Device, m: &deep_canvas_scene3d::geom::Mesh) -> Mesh {
        let mut v = Vec::with_capacity(m.positions.len() * 6);
        for (p, n) in m.positions.iter().zip(&m.normals) {
            push(&mut v, p.map(|x| x as f32), n.map(|x| x as f32));
        }
        Mesh::upload(device, &v, &m.indices)
    }

    fn upload(device: &Device, v: &[f32], i: &[u32]) -> Mesh {
        let d = &device.device;
        Mesh {
            vertices: d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d mesh"),
                contents: bytemuck::cast_slice(v),
                usage: wgpu::BufferUsages::VERTEX,
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
                let o = k as usize * 6;
                ([v[o], v[o + 1], v[o + 2]], [v[o + 3], v[o + 4], v[o + 5]])
            };
            for t in i.chunks_exact(3) {
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
