//! Modifier: sway on the GPU (#2016). A swaying solid's mesh keeps its rest vertices and its
//! weights on the device, and its per-instance params (its place, the wind, amount, hz, phase,
//! the document's seed and t) go to a small buffer of its own at every frame; one compute pass
//! then writes the vertices every other pass draws from (sway.wgsl). The mesh is never built
//! again as t moves, and nothing is read from an earlier frame, so seeking equals playing.

use std::collections::BTreeMap;

use deep_canvas_scene3d::geom::Mesh;
use deep_canvas_scene3d::scene::{Scene, Shape};
use deep_gpu::device::Device;
use wgpu::util::DeviceExt as _;

const SOURCE: &str = include_str!("sway.wgsl");
/// Vertices a workgroup moves.
const WORKGROUP: u32 = 64;

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Params {
    rows: [[f32; 4]; 3],
    inverse: [[f32; 4]; 3],
    wind: [f32; 4],
    sway: [f32; 4],
    time: [f32; 4],
    counts: [u32; 4],
}

/// One swaying solid's buffers: its params, and the gust the pass last used.
struct Mover {
    params: wgpu::Buffer,
    reading: wgpu::Buffer,
    bind: wgpu::BindGroup,
    vertices: u32,
}

#[derive(Default)]
pub struct Sways {
    pipeline: Option<(wgpu::ComputePipeline, wgpu::BindGroupLayout)>,
    movers: BTreeMap<Shape, Mover>,
}

impl Sways {
    /// The swaying mesh `m` of `shape`, whose rest vertices `v` the pass reads and whose drawn
    /// vertices it writes into `drawn`.
    pub fn add(
        &mut self,
        device: &Device,
        shape: Shape,
        m: &Mesh,
        v: &[f32],
        drawn: &wgpu::Buffer,
    ) {
        let d = &device.device;
        let (_, layout) = self.pipeline.get_or_insert_with(|| {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("scene3d sway"),
                source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
            });
            let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("scene3d sway"),
                layout: None,
                module: &module,
                entry_point: Some("sway"),
                compilation_options: Default::default(),
                cache: None,
            });
            let layout = pipeline.get_bind_group_layout(0);
            (pipeline, layout)
        });
        let weights: Vec<f32> = m
            .sway
            .as_ref()
            .map(|s| s.weights.iter().map(|w| *w as f32).collect())
            .unwrap_or_default();
        let storage = |label, contents: &[u8], usage| {
            d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage: wgpu::BufferUsages::STORAGE | usage,
            })
        };
        let rest = storage(
            "scene3d sway rest",
            bytemuck::cast_slice(v),
            wgpu::BufferUsages::empty(),
        );
        let weights = storage(
            "scene3d sway weights",
            bytemuck::cast_slice(&weights),
            wgpu::BufferUsages::empty(),
        );
        let reading = storage(
            "scene3d sway reading",
            &[0; 4],
            wgpu::BufferUsages::COPY_SRC,
        );
        let params = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d sway params"),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d sway"),
            layout,
            entries: &[
                (0, &params),
                (1, &rest),
                (2, &weights),
                (3, drawn),
                (4, &reading),
            ]
            .map(|(binding, b)| wgpu::BindGroupEntry {
                binding,
                resource: b.as_entire_binding(),
            }),
        });
        let vertices = m.positions.len() as u32;
        self.movers.insert(
            shape,
            Mover {
                params,
                reading,
                bind,
                vertices,
            },
        );
    }

    /// The gust the pass last used for `shape`'s solid, read back.
    pub fn gust(&self, device: &Device, shape: Shape) -> Option<f32> {
        let mover = self.movers.get(&shape)?;
        let bytes = crate::read_back(device, "scene3d sway reading", 4, |e, staging| {
            e.copy_buffer_to_buffer(&mover.reading, 0, staging, 0, 4)
        })?;
        Some(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// Writes every swaying solid's vertices at this frame's t, in one submission.
    pub fn move_all(&self, device: &Device, scene: &Scene) {
        let Some((pipeline, _)) = &self.pipeline else {
            return;
        };
        let mut moving = Vec::new();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            let (Some(at), Some(sway), Some(mover)) = (
                s.sway,
                s.mesh.as_ref().and_then(|m| m.sway.as_ref()),
                self.movers.get(&s.shape),
            ) else {
                continue;
            };
            let rows = s.model.map(|r| r.map(|x| x as f32));
            let (cos, sin) = (
                sway.direction.to_radians().cos(),
                sway.direction.to_radians().sin(),
            );
            let p = Params {
                rows,
                inverse: inverse(&s.model),
                wind: [cos as f32, sway.speed as f32, sin as f32, sway.scale as f32],
                sway: [
                    sway.amount as f32,
                    sway.hz as f32,
                    sway.phase as f32,
                    sway.strength as f32,
                ],
                time: [at.t as f32, 0.0, 0.0, 0.0],
                counts: [mover.vertices, at.seed as u32, (at.seed >> 32) as u32, 0],
            };
            deep_gpu::alloc::outside(|| {
                device
                    .queue
                    .write_buffer(&mover.params, 0, bytemuck::bytes_of(&p))
            });
            moving.push(mover);
        }
        if moving.is_empty() {
            return;
        }
        deep_gpu::alloc::outside(|| {
            let mut encoder =
                device
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("scene3d sway"),
                    });
            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("scene3d sway"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(pipeline);
                for mover in moving {
                    pass.set_bind_group(0, &mover.bind, &[]);
                    pass.dispatch_workgroups(mover.vertices.div_ceil(WORKGROUP).max(1), 1, 1);
                }
            }
            device.queue.submit([encoder.finish()]);
        });
    }
}

/// The inverse of a model's linear part, rows (zeros where it has none).
fn inverse(m: &[[f64; 4]; 3]) -> [[f32; 4]; 3] {
    let a = |r: usize, c: usize| m[r][c];
    let cof = |r: usize, c: usize| {
        let (r0, r1) = ((r + 1) % 3, (r + 2) % 3);
        let (c0, c1) = ((c + 1) % 3, (c + 2) % 3);
        a(r0, c0) * a(r1, c1) - a(r0, c1) * a(r1, c0)
    };
    let det = a(0, 0) * cof(0, 0) + a(0, 1) * cof(0, 1) + a(0, 2) * cof(0, 2);
    let mut out = [[0.0f32; 4]; 3];
    if det.abs() > 1e-300 {
        for (r, row) in out.iter_mut().enumerate() {
            for (c, x) in row.iter_mut().take(3).enumerate() {
                // The inverse is the adjugate (the cofactors transposed) over the determinant.
                *x = (cof(c, r) / det) as f32;
            }
        }
    }
    out
}
