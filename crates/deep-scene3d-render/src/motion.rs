//! Motion blur by velocity on the GPU (#419; canvas primitives: Motion blur: velocity): after the
//! geometry pass, a draw of every solid writes its travel over the shutter from the evaluations at
//! t − s/2 and t + s/2 (the scene's [`Motion`]), never an earlier frame's; then tile-max and
//! neighbor-max velocities and a gather with fixed taps resolve the linear target in place, before
//! the effects and the tone map, so status colors and text drawn after them never blur.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::scene::{Affine3, Camera, Depth, Motion, Scene, Shape};
use deep_gpu::device::Device;
use wgpu::util::DeviceExt as _;

use crate::mesh::{Mesh, FLOATS};

const SHADER: &str = include_str!("motion.wgsl");
const VELOCITY: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
const TILES: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
const RESOLVED: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    clip_t: [[f32; 4]; 4],
    clip_o: [[f32; 4]; 4],
    clip_c: [[f32; 4]; 4],
    fwd: [f32; 4],
    size: [f32; 4],
    tile: [u32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Instance {
    rows: [[f32; 4]; 9],
}

const INSTANCE: [wgpu::VertexAttribute; 9] = wgpu::vertex_attr_array![
    3 => Float32x4, 4 => Float32x4, 5 => Float32x4, 6 => Float32x4, 7 => Float32x4,
    8 => Float32x4, 9 => Float32x4, 10 => Float32x4, 11 => Float32x4
];

/// The pipelines, built the first time a frame blurs by velocity.
struct Pipes {
    draw: wgpu::RenderPipeline,
    tile: wgpu::ComputePipeline,
    near: wgpu::ComputePipeline,
    gather: wgpu::ComputePipeline,
}

/// One draw of the velocity pass: the solid's vertices at t, t − s/2 and t + s/2 (owned where
/// the pre-skins differ from t's), its indices and its instance.
struct Draw {
    at: wgpu::Buffer,
    sides: Option<(Mesh, Mesh)>,
    indices: wgpu::Buffer,
    count: u32,
}

/// A frame's velocity pass and resolve, ready to record.
pub struct Frame {
    pipes: [wgpu::RenderPipeline; 1],
    computes: [wgpu::ComputePipeline; 3],
    draws: Vec<Draw>,
    instances: wgpu::Buffer,
    draw_bind: wgpu::BindGroup,
    binds: [wgpu::BindGroup; 3],
    velocity: wgpu::TextureView,
    depth: wgpu::TextureView,
    resolved: wgpu::Texture,
    tiles: [u32; 2],
    size: [u32; 2],
}

#[derive(Default)]
pub struct MotionPass {
    pipes: Option<Pipes>,
    /// Pipelines this pass compiled, by name, for the frame's report.
    pub compiled: Vec<&'static str>,
}

fn clip(cam: &Camera, jitter: [f64; 2], size: [u32; 2]) -> [[f32; 4]; 4] {
    let mut rows = cam.clip(Depth::Reversed);
    let [jx, jy] = [
        2.0 * jitter[0] / f64::from(size[0].max(1)),
        -2.0 * jitter[1] / f64::from(size[1].max(1)),
    ];
    let w = rows[3];
    for (c, wc) in w.iter().enumerate() {
        rows[0][c] += jx * wc;
        rows[1][c] += jy * wc;
    }
    let mut m = [[0f32; 4]; 4];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            m[c][r] = *v as f32;
        }
    }
    m
}

fn rows(m: &Affine3) -> [[f32; 4]; 3] {
    m.map(|r| r.map(|v| v as f32))
}

fn texture(
    d: &wgpu::Device,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    crate::texture2d(d, label, size, format, usage)
}

impl MotionPass {
    fn pipes(&mut self, d: &wgpu::Device) -> &Pipes {
        if self.pipes.is_none() {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("scene3d.motion"),
                source: wgpu::ShaderSource::Wgsl(SHADER.into()),
            });
            let position = |slot| -> [wgpu::VertexAttribute; 1] {
                [wgpu::VertexAttribute {
                    format: wgpu::VertexFormat::Float32x3,
                    offset: 0,
                    shader_location: slot,
                }]
            };
            let (p0, p1, p2) = (position(0), position(1), position(2));
            let vertex = |attributes| wgpu::VertexBufferLayout {
                array_stride: (FLOATS * 4) as u64,
                step_mode: wgpu::VertexStepMode::Vertex,
                attributes,
            };
            let draw = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("scene3d.motion velocity"),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[
                        Some(vertex(&p0)),
                        Some(vertex(&p1)),
                        Some(vertex(&p2)),
                        Some(wgpu::VertexBufferLayout {
                            array_stride: std::mem::size_of::<Instance>() as u64,
                            step_mode: wgpu::VertexStepMode::Instance,
                            attributes: &INSTANCE,
                        }),
                    ],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(VELOCITY.into())],
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(true),
                    // Reversed Z: nearer is greater.
                    depth_compare: Some(wgpu::CompareFunction::Greater),
                    stencil: Default::default(),
                    bias: Default::default(),
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
            let compute = |entry: &'static str| {
                d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some(entry),
                    layout: None,
                    module: &module,
                    entry_point: Some(entry),
                    compilation_options: Default::default(),
                    cache: None,
                })
            };
            self.pipes = Some(Pipes {
                draw,
                tile: compute("tile"),
                near: compute("near"),
                gather: compute("gather"),
            });
            self.compiled
                .extend(["scene3d.motion velocity", "scene3d.motion resolve"]);
        }
        self.pipes.as_ref().expect("built above")
    }

    /// The frame's velocity pass and resolve for `scene` drawn at `size`, its solids' meshes at t
    /// from `meshes`; `None` when the scene doesn't blur by velocity.
    pub fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        motion: &Motion,
        meshes: &std::collections::BTreeMap<Shape, Mesh>,
        linear: &wgpu::TextureView,
        size: [u32; 2],
    ) -> Option<Frame> {
        let d = &device.device;
        let pipes = self.pipes(d);
        let (draw_pipe, computes) = (
            pipes.draw.clone(),
            [pipes.tile.clone(), pipes.near.clone(), pipes.gather.clone()],
        );
        let mut draws = Vec::new();
        let mut instances: Vec<Instance> = Vec::new();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            if s.cast_only || s.alpha <= 0.0 {
                continue;
            }
            let (Some(m), Some(at)) = (meshes.get(&s.shape), motion.solids.get(&s.id)) else {
                continue;
            };
            let sides = at
                .meshes
                .as_ref()
                .map(|(o, c)| (Mesh::of(device, o), Mesh::of(device, c)));
            let (t, o, c) = (rows(&s.model), rows(&at.open), rows(&at.close));
            instances.push(Instance {
                rows: [t[0], t[1], t[2], o[0], o[1], o[2], c[0], c[1], c[2]],
            });
            draws.push(Draw {
                at: m.vertices.clone(),
                sides,
                indices: m.indices.clone(),
                count: m.count,
            });
        }
        if instances.is_empty() {
            return None;
        }
        let cam = &scene.camera;
        let tile = motion.tile_px.max(1);
        let tiles = [size[0].div_ceil(tile), size[1].div_ceil(tile)];
        let uniform = Uniform {
            clip_t: clip(cam, scene.jitter, size),
            clip_o: clip(&motion.open, scene.jitter, size),
            clip_c: clip(&motion.close, scene.jitter, size),
            fwd: [
                cam.forward[0] as f32,
                cam.forward[1] as f32,
                cam.forward[2] as f32,
                -(cam.forward[0] * cam.eye[0]
                    + cam.forward[1] * cam.eye[1]
                    + cam.forward[2] * cam.eye[2]) as f32,
            ],
            size: [
                size[0] as f32,
                size[1] as f32,
                motion.taps.clamp(2, 64) as f32,
                motion.max_px as f32,
            ],
            tile: [tile, tiles[0], tiles[1], 0],
        };
        let buffer = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("scene3d.motion uniform"),
            contents: bytemuck::bytes_of(&uniform),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let instances = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("scene3d.motion instances"),
            contents: bytemuck::cast_slice(&instances),
            usage: wgpu::BufferUsages::VERTEX,
        });
        use wgpu::TextureUsages as T;
        let velocity = texture(
            d,
            "scene3d.motion velocity",
            size,
            VELOCITY,
            T::RENDER_ATTACHMENT | T::TEXTURE_BINDING,
        );
        let depth = texture(
            d,
            "scene3d.motion depth",
            size,
            wgpu::TextureFormat::Depth32Float,
            T::RENDER_ATTACHMENT,
        );
        let tile_max = texture(
            d,
            "scene3d.motion tiles",
            tiles,
            TILES,
            T::STORAGE_BINDING | T::TEXTURE_BINDING,
        );
        let near = texture(
            d,
            "scene3d.motion near",
            tiles,
            TILES,
            T::STORAGE_BINDING | T::TEXTURE_BINDING,
        );
        let resolved = texture(
            d,
            "scene3d.motion resolved",
            size,
            RESOLVED,
            T::STORAGE_BINDING | T::COPY_SRC,
        );
        let view = |t: &wgpu::Texture| t.create_view(&Default::default());
        let (velocity_view, tile_view, near_view, resolved_view) = (
            view(&velocity),
            view(&tile_max),
            view(&near),
            view(&resolved),
        );
        let group = |pipe: &wgpu::ComputePipeline, entries: &[(u32, wgpu::BindingResource)]| {
            d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d.motion"),
                layout: &pipe.get_bind_group_layout(0),
                entries: &entries
                    .iter()
                    .map(|(b, r)| wgpu::BindGroupEntry {
                        binding: *b,
                        resource: r.clone(),
                    })
                    .collect::<Vec<_>>(),
            })
        };
        use wgpu::BindingResource::TextureView as Tv;
        let u = buffer.as_entire_binding();
        let binds = [
            group(
                &computes[0],
                &[(0, u.clone()), (1, Tv(&velocity_view)), (2, Tv(&tile_view))],
            ),
            group(
                &computes[1],
                &[(0, u.clone()), (3, Tv(&tile_view)), (4, Tv(&near_view))],
            ),
            group(
                &computes[2],
                &[
                    (0, u.clone()),
                    (1, Tv(&velocity_view)),
                    (5, Tv(&near_view)),
                    (6, Tv(linear)),
                    (7, Tv(&resolved_view)),
                ],
            ),
        ];
        let draw_bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("scene3d.motion velocity"),
            layout: &draw_pipe.get_bind_group_layout(0),
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: u,
            }],
        });
        Some(Frame {
            pipes: [draw_pipe],
            computes,
            draws,
            instances,
            draw_bind,
            binds,
            velocity: velocity_view,
            depth: view(&depth),
            resolved,
            tiles,
            size,
        })
    }
}

impl Frame {
    /// The velocity pass, the two tile passes and the gather; the resolved frame then replaces
    /// `linear`.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder, linear: &wgpu::Texture) {
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d.motion velocity"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.velocity,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Discard,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_pipeline(&self.pipes[0]);
            pass.set_bind_group(0, &self.draw_bind, &[]);
            pass.set_vertex_buffer(3, self.instances.slice(..));
            for (k, dr) in self.draws.iter().enumerate() {
                let (o, c) = match &dr.sides {
                    Some((o, c)) => (&o.vertices, &c.vertices),
                    None => (&dr.at, &dr.at),
                };
                pass.set_vertex_buffer(0, dr.at.slice(..));
                pass.set_vertex_buffer(1, o.slice(..));
                pass.set_vertex_buffer(2, c.slice(..));
                pass.set_index_buffer(dr.indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..dr.count, 0, k as u32..k as u32 + 1);
            }
        }
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("scene3d.motion resolve"),
                timestamp_writes: None,
            });
            for (k, (pipe, bind)) in self.computes.iter().zip(&self.binds).enumerate() {
                pass.set_pipeline(pipe);
                pass.set_bind_group(0, bind, &[]);
                if k < 2 {
                    pass.dispatch_workgroups(self.tiles[0], self.tiles[1], 1);
                } else {
                    pass.dispatch_workgroups(self.size[0].div_ceil(8), self.size[1].div_ceil(8), 1);
                }
            }
        }
        encoder.copy_texture_to_texture(
            self.resolved.as_image_copy(),
            linear.as_image_copy(),
            wgpu::Extent3d {
                width: self.size[0],
                height: self.size[1],
                depth_or_array_layers: 1,
            },
        );
    }
}
