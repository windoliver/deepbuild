//! Motion blur by velocity on the GPU (#419; canvas primitives: Motion blur: velocity): after the
//! geometry pass, a draw of every solid writes its travel over the shutter from the evaluations at
//! t − s/2 and t + s/2 (the scene's [`Motion`]), never an earlier frame's; then tile-max and
//! neighbor-max velocities and a gather with fixed taps resolve the linear target in place, before
//! the effects and the tone map, so status colors and text drawn after them never blur.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::scene::{Affine3, Camera, Depth, Motion, Scene, Shape};
use deep_gpu::counted::Written;
use deep_gpu::device::Device;

use crate::mesh::{Mesh, FLOATS};

const SHADER: &str = include_str!("motion.wgsl");
/// The label the motion passes' GPU time is reported and charged under.
pub const MOTION_PASS: &str = "scene3d.motion";
const VELOCITY: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
const TILES: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
const RESOLVED: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    clip_t: [[f32; 4]; 4],
    clip_o: [[f32; 4]; 4],
    clip_c: [[f32; 4]; 4],
    sky_o: [[f32; 4]; 4],
    sky_c: [[f32; 4]; 4],
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
#[derive(Clone)]
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

/// The pass's targets at one size, kept from frame to frame.
struct Targets {
    size: [u32; 2],
    tiles: [u32; 2],
    velocity: wgpu::TextureView,
    depth: wgpu::TextureView,
    tile_max: wgpu::TextureView,
    near: wgpu::TextureView,
    resolved: wgpu::Texture,
    resolved_view: wgpu::TextureView,
}

/// The core's velocity target's format (#431): each pixel's travel in px, two half floats.
pub const TARGET: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Float;

/// A frame's draw of the core's velocity target (#431): every solid at t, t − s/2 and t + s/2,
/// against the frame's own depth, so only what shows writes its travel.
#[derive(Clone)]
pub struct TargetFrame {
    pipe: wgpu::RenderPipeline,
    bind: wgpu::BindGroup,
    instances: wgpu::Buffer,
    draws: Vec<Draw>,
}

/// A velocity draw's uniform and instances, kept from frame to frame and written where a
/// frame's differ from the last one's.
struct Held {
    uniform: wgpu::Buffer,
    written: Written,
    /// The instances' buffer and how many it has room for.
    instances: Option<(wgpu::Buffer, usize)>,
    instances_written: Written,
}

impl Held {
    fn new(d: &deep_gpu::counted::Wgpu, label: &str) -> Held {
        Held {
            uniform: d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: std::mem::size_of::<Uniform>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            written: Written::default(),
            instances: None,
            instances_written: Written::default(),
        }
    }

    /// Writes this frame's uniform and instances, and gives the instances' buffer: a new one
    /// only when the frame has more than the last one has room for.
    fn write(
        &mut self,
        device: &Device,
        label: &str,
        uniform: &Uniform,
        instances: &[Instance],
    ) -> wgpu::Buffer {
        let buffer = match &self.instances {
            Some((buffer, room)) if *room >= instances.len() => buffer.clone(),
            _ => {
                let room = instances.len().next_power_of_two();
                let buffer = device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some(label),
                    size: (room * std::mem::size_of::<Instance>()) as u64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                self.instances = Some((buffer.clone(), room));
                buffer
            }
        };
        deep_gpu::alloc::outside(|| {
            let q = &device.queue;
            q.write_changed(&self.uniform, &self.written, bytemuck::bytes_of(uniform));
            q.write_changed(
                &buffer,
                &self.instances_written,
                bytemuck::cast_slice(instances),
            );
        });
        buffer
    }
}

#[derive(Default)]
pub struct MotionPass {
    pipes: Option<Pipes>,
    target: Option<wgpu::RenderPipeline>,
    targets: Option<Targets>,
    /// The blur's uniform and instances, and its draw's and its three computes' bind groups
    /// with the velocity and linear targets they bind.
    blur: Option<Held>,
    binds: Option<(
        [wgpu::TextureView; 2],
        wgpu::BindGroup,
        [wgpu::BindGroup; 3],
    )>,
    /// The velocity target's uniform and instances, and its draw's bind group.
    travel: Option<(Held, wgpu::BindGroup)>,
    /// Pipelines this pass compiled, by name, for the frame's report.
    pub compiled: Vec<&'static str>,
}

/// A camera's jittered clip matrix, rows.
fn clip_rows(cam: &Camera, jitter: [f64; 2], size: [u32; 2]) -> [[f64; 4]; 4] {
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
    rows
}

/// Rows to WGSL's column-major matrix.
fn columns(rows: &[[f64; 4]; 4]) -> [[f32; 4]; 4] {
    let mut m = [[0f32; 4]; 4];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            m[c][r] = *v as f32;
        }
    }
    m
}

fn clip(cam: &Camera, jitter: [f64; 2], size: [u32; 2]) -> [[f32; 4]; 4] {
    columns(&clip_rows(cam, jitter, size))
}

fn product(a: &[[f64; 4]; 4], b: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    let mut o = [[0.0; 4]; 4];
    for r in 0..4 {
        for c in 0..4 {
            o[r][c] = (0..4).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    o
}

/// A 4 × 4 inverse by Gauss–Jordan elimination with partial pivoting.
fn inverse(m: &[[f64; 4]; 4]) -> [[f64; 4]; 4] {
    let mut a = *m;
    let mut inv = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ];
    for c in 0..4 {
        let p = (c..4)
            .max_by(|x, y| a[*x][c].abs().total_cmp(&a[*y][c].abs()))
            .unwrap_or(c);
        a.swap(c, p);
        inv.swap(c, p);
        let d = if a[c][c].abs() < 1e-300 { 1.0 } else { a[c][c] };
        for k in 0..4 {
            a[c][k] /= d;
            inv[c][k] /= d;
        }
        for r in 0..4 {
            if r != c {
                let f = a[r][c];
                for k in 0..4 {
                    a[r][k] -= f * a[c][k];
                    inv[r][k] -= f * inv[c][k];
                }
            }
        }
    }
    inv
}

fn rows(m: &Affine3) -> [[f32; 4]; 3] {
    m.map(|r| r.map(|v| v as f32))
}

fn texture(
    d: &deep_gpu::counted::Wgpu,
    label: &str,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    crate::texture2d(d, label, size, format, usage)
}

/// Every solid's velocity draw, and its instance: its rows at t, t − s/2 and t + s/2.
fn draw_list(
    device: &Device,
    scene: &Scene,
    motion: &Motion,
    meshes: &std::collections::BTreeMap<Shape, Mesh>,
) -> (Vec<Draw>, Vec<Instance>) {
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
    // With nothing drawn the background still travels under the camera's move: one unused
    // instance keeps the buffer bound.
    if instances.is_empty() {
        instances.push(Instance::zeroed());
    }
    (draws, instances)
}

/// The velocity passes' uniform for `scene` at `size`.
fn uniform_of(
    scene: &Scene,
    motion: &Motion,
    size: [u32; 2],
    tile: u32,
    tiles: [u32; 2],
) -> Uniform {
    let cam = &scene.camera;
    let back = inverse(&clip_rows(cam, scene.jitter, size));
    Uniform {
        clip_t: clip(cam, scene.jitter, size),
        clip_o: clip(&motion.open, scene.jitter, size),
        clip_c: clip(&motion.close, scene.jitter, size),
        sky_o: columns(&product(
            &clip_rows(&motion.open, scene.jitter, size),
            &back,
        )),
        sky_c: columns(&product(
            &clip_rows(&motion.close, scene.jitter, size),
            &back,
        )),
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
    }
}

impl MotionPass {
    fn pipes(&mut self, d: &deep_gpu::counted::Wgpu) -> &Pipes {
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

    /// The core velocity target's draw for `scene` at `size` (#431), from the scene's evaluations
    /// at t ± s/2, or no travel where it has none; `None`, letting go of the draw's buffers, in a
    /// frame where nothing reads the target (`wanted`).
    pub fn target_frame(
        &mut self,
        device: &Device,
        scene: &Scene,
        wanted: bool,
        meshes: &std::collections::BTreeMap<Shape, Mesh>,
        size: [u32; 2],
    ) -> Option<TargetFrame> {
        if !wanted {
            self.travel = None;
            return None;
        }
        let still;
        let motion = match &scene.velocity {
            Some(m) => m.as_ref(),
            None => {
                still = crate::still_motion(scene);
                &still
            }
        };
        let d = &device.device;
        if self.target.is_none() {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("scene3d.velocity"),
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
            self.target = Some(d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("scene3d.velocity"),
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
                    entry_point: Some("fs_target"),
                    compilation_options: Default::default(),
                    targets: &[Some(TARGET.into())],
                }),
                primitive: wgpu::PrimitiveState::default(),
                // The frame's own depth, read only: a surface writes where it shows. Its
                // positions are the solids' at t by another vertex stage, so a few units of
                // bias toward the eye (reversed Z: greater is nearer) keep its own depth's ties.
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: wgpu::TextureFormat::Depth32Float,
                    depth_write_enabled: Some(false),
                    depth_compare: Some(wgpu::CompareFunction::GreaterEqual),
                    stencil: Default::default(),
                    bias: wgpu::DepthBiasState {
                        constant: 64,
                        slope_scale: 1.0,
                        clamp: 0.0,
                    },
                }),
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            }));
            self.compiled.push("scene3d.velocity");
        }
        let pipe = self.target.clone().expect("built above");
        let (draws, instances) = draw_list(device, scene, motion, meshes);
        let uniform = uniform_of(scene, motion, size, 1, size);
        let (held, bind) = self.travel.get_or_insert_with(|| {
            let held = Held::new(d, "scene3d.velocity uniform");
            let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d.velocity"),
                layout: &pipe.get_bind_group_layout(0),
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: held.uniform.as_entire_binding(),
                }],
            });
            (held, bind)
        });
        let instances = held.write(device, "scene3d.velocity instances", &uniform, &instances);
        Some(TargetFrame {
            pipe,
            bind: bind.clone(),
            instances,
            draws,
        })
    }

    /// The frame's velocity pass and resolve for `scene` drawn at `size`, its solids' meshes at t
    /// from `meshes`; `None` when the scene doesn't blur by velocity.
    pub fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        meshes: &std::collections::BTreeMap<Shape, Mesh>,
        linear: &wgpu::TextureView,
        size: [u32; 2],
    ) -> Option<Frame> {
        // A frame that doesn't blur lets go of the blur's buffers and of the targets its bind
        // groups hold, and compiles nothing.
        let Some(motion) = scene.motion.as_deref() else {
            self.blur = None;
            self.binds = None;
            return None;
        };
        let d = &device.device;
        let pipes = self.pipes(d);
        let (draw_pipe, computes) = (
            pipes.draw.clone(),
            [pipes.tile.clone(), pipes.near.clone(), pipes.gather.clone()],
        );
        let (draws, instances) = draw_list(device, scene, motion, meshes);
        let tile = motion.tile_px.max(1);
        let tiles = [size[0].div_ceil(tile), size[1].div_ceil(tile)];
        let uniform = uniform_of(scene, motion, size, tile, tiles);
        let held = self
            .blur
            .get_or_insert_with(|| Held::new(d, "scene3d.motion uniform"));
        let instances = held.write(device, "scene3d.motion instances", &uniform, &instances);
        let buffer = held.uniform.clone();
        if !self
            .targets
            .as_ref()
            .is_some_and(|t| t.size == size && t.tiles == tiles)
        {
            use wgpu::TextureUsages as T;
            let view = |t: &wgpu::Texture| t.create_view(&Default::default());
            let resolved = texture(
                d,
                "scene3d.motion resolved",
                size,
                RESOLVED,
                T::STORAGE_BINDING | T::COPY_SRC,
            );
            self.targets = Some(Targets {
                size,
                tiles,
                velocity: view(&texture(
                    d,
                    "scene3d.motion velocity",
                    size,
                    VELOCITY,
                    T::RENDER_ATTACHMENT | T::TEXTURE_BINDING,
                )),
                depth: view(&texture(
                    d,
                    "scene3d.motion depth",
                    size,
                    wgpu::TextureFormat::Depth32Float,
                    T::RENDER_ATTACHMENT,
                )),
                tile_max: view(&texture(
                    d,
                    "scene3d.motion tiles",
                    tiles,
                    TILES,
                    T::STORAGE_BINDING | T::TEXTURE_BINDING,
                )),
                near: view(&texture(
                    d,
                    "scene3d.motion near",
                    tiles,
                    TILES,
                    T::STORAGE_BINDING | T::TEXTURE_BINDING,
                )),
                resolved_view: view(&resolved),
                resolved,
            });
        }
        let tg = self.targets.as_ref().expect("made above");
        let (velocity_view, tile_view, near_view, resolved_view) =
            (&tg.velocity, &tg.tile_max, &tg.near, &tg.resolved_view);
        // The targets are made together, so a frame whose velocity and linear targets hold
        // binds as the last one did.
        let bound = [velocity_view, linear];
        let (draw_bind, binds) = match &self.binds {
            Some((held, draw, binds)) if held.iter().eq(bound) => (draw.clone(), binds.clone()),
            _ => {
                let group = |pipe: &wgpu::ComputePipeline,
                             entries: &[(u32, wgpu::BindingResource)]| {
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
                        &[(0, u.clone()), (1, Tv(velocity_view)), (2, Tv(tile_view))],
                    ),
                    group(
                        &computes[1],
                        &[(0, u.clone()), (3, Tv(tile_view)), (4, Tv(near_view))],
                    ),
                    group(
                        &computes[2],
                        &[
                            (0, u.clone()),
                            (1, Tv(velocity_view)),
                            (5, Tv(near_view)),
                            (6, Tv(linear)),
                            (7, Tv(resolved_view)),
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
                self.binds = Some((bound.map(Clone::clone), draw_bind.clone(), binds.clone()));
                (draw_bind, binds)
            }
        };
        Some(Frame {
            pipes: [draw_pipe],
            computes,
            draws,
            instances,
            draw_bind,
            binds,
            velocity: velocity_view.clone(),
            depth: tg.depth.clone(),
            resolved: tg.resolved.clone(),
            tiles,
            size,
        })
    }
}

impl TargetFrame {
    /// Draws the velocity target `view` against the frame's `depth`, cleared to no travel first.
    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        depth: &wgpu::TextureView,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene3d.velocity"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&self.pipe);
        pass.set_bind_group(0, &self.bind, &[]);
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
}

impl Frame {
    /// The velocity pass, the two tile passes and the gather; the resolved frame then replaces
    /// `linear`. Both passes are timed as [`MOTION_PASS`], so the meter charges them.
    pub fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        linear: &wgpu::Texture,
        profiler: &Option<crate::Profiler>,
    ) {
        let query = |encoder: &mut wgpu::CommandEncoder| {
            profiler
                .as_ref()
                .map(|p| crate::status::lock(p).begin_pass_query(MOTION_PASS, encoder))
        };
        let end = |encoder: &mut wgpu::CommandEncoder,
                   q: Option<wgpu_profiler::GpuProfilerQuery>| {
            if let (Some(p), Some(q)) = (profiler, q) {
                crate::status::lock(p).end_query(encoder, q);
            }
        };
        let q = query(encoder);
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
                timestamp_writes: q.as_ref().and_then(|q| q.render_pass_timestamp_writes()),
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
        end(encoder, q);
        let q = query(encoder);
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("scene3d.motion resolve"),
                timestamp_writes: q.as_ref().and_then(|q| q.compute_pass_timestamp_writes()),
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
        end(encoder, q);
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::tests::{orbiting_camera, played, stamped};

    /// Motion blur by velocity (#419) and the core's velocity target (#431) bind what the first
    /// frame made: their uniforms and instances are written where they change.
    #[test]
    fn a_frame_after_the_first_makes_no_buffer_and_no_bind_group() {
        let (cam, channels) = orbiting_camera();
        let doc = stamped(
            &[
                ("cam", cam),
                (
                    "box",
                    json!({"kind": "mark.box@1", "params": {"size": 1, "paint": {"fill": {"role": "accent"}}}, "at": {"pos": [0, 0.5, 0]}}),
                ),
            ],
            channels,
        );
        for (what, blur, target) in [
            ("motion blur", true, false),
            ("the velocity target", false, true),
        ] {
            let frames = played(&doc, None, |renderer, scene| {
                if blur {
                    scene.motion = Some(std::sync::Arc::new(crate::still_motion(scene)));
                }
                renderer.core.want.velocity = target;
            });
            for (n, made) in frames.iter().enumerate() {
                assert_eq!(
                    (made.buffers, made.bind_groups),
                    (0, 0),
                    "{what}, frame {}: buffers and bind groups made",
                    n + 1
                );
            }
        }
    }
}
