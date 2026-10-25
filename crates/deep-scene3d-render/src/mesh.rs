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
                for k in 0..SEGMENTS {
                    i.extend([centre, centre + 1 + k, centre + 2 + k]);
                }
            }
        }
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
                    i.extend([a, a + row, a + 1, a + 1, a + row, a + row + 1]);
                }
            }
        }
    }
    (v, i)
}

impl Mesh {
    pub fn build(device: &Device, shape: Shape) -> Mesh {
        let (v, i) = geometry(shape);
        let d = &device.device;
        Mesh {
            vertices: d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d mesh"),
                contents: bytemuck::cast_slice(&v),
                usage: wgpu::BufferUsages::VERTEX,
            }),
            indices: d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("scene3d mesh indices"),
                contents: bytemuck::cast_slice(&i),
                usage: wgpu::BufferUsages::INDEX,
            }),
            count: i.len() as u32,
        }
    }
}
