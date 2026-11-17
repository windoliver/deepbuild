//! Effect: dof (#468): depth of field over the linear image, after the geometry and before the
//! effects' bloom and the tone map (dof.wgsl). Four compute passes: each pixel's signed circle of
//! confusion, with a bright out-of-focus point's excess light set aside; each tile's largest
//! circle; the excess scattered over the aperture's shape in fixed point, so the order points land
//! in changes nothing; and a gather on a golden-angle spiral rotated by a pixel hash, the scattered
//! light added. The resolved image replaces the linear one. Everything is a function of this
//! frame, so seeking equals playing.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::dof::Dof;
use deep_canvas_scene3d::scene::Camera;
use deep_gpu::counted::Written;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;

pub use deep_canvas_scene3d::module::DOF_PASS;

use crate::LINEAR;

const SOURCE: &str = include_str!("dof.wgsl");
/// The side of the square of pixels each tile's largest circle covers (dof.wgsl: `TILE`).
const TILE: u32 = 16;

/// The dof's wrong programs, each reachable only through a proof surface's `planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A circle of confusion linear in |d − s|, matched to the physical one at 10 m.
    pub linear_coc: bool,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    size: [f32; 4],
    cam: [f32; 4],
    coc: [f32; 4],
    band_at: [f32; 4],
    band: [f32; 4],
    bokeh: [f32; 4],
}

/// The frame-sized targets and the bind groups over them, for one linear and depth target.
struct Sized {
    size: [u32; 2],
    linear: wgpu::TextureView,
    depth: wgpu::TextureView,
    /// Each pixel's signed circle of confusion in px and its view depth, rg32float.
    coc: wgpu::Texture,
    scattered: wgpu::Buffer,
    resolved: wgpu::Texture,
    binds: [wgpu::BindGroup; 4],
}

pub struct Dofer {
    layouts: [wgpu::BindGroupLayout; 4],
    pipes: [wgpu::ComputePipeline; 4],
    params: wgpu::Buffer,
    written: Written,
    sized: Option<Sized>,
}

impl Dofer {
    pub fn new(device: &Device) -> Self {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(DOF_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let stage = wgpu::ShaderStages::COMPUTE;
        // Every texture is read by textureLoad, so none needs a filtering binding.
        let tex = |binding, sample_type| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: stage,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let float = wgpu::TextureSampleType::Float { filterable: false };
        let store = |binding, format| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: stage,
            ty: wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format,
                view_dimension: wgpu::TextureViewDimension::D2,
            },
            count: None,
        };
        let buffer = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: stage,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let uniform = buffer(0, wgpu::BufferBindingType::Uniform);
        let scattered = buffer(7, wgpu::BufferBindingType::Storage { read_only: false });
        let layout = |entries: &[wgpu::BindGroupLayoutEntry]| {
            d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(DOF_PASS),
                entries,
            })
        };
        let layouts = [
            layout(&[
                uniform,
                tex(1, wgpu::TextureSampleType::Depth),
                tex(2, float),
                store(3, LINEAR),
                store(4, wgpu::TextureFormat::Rg32Float),
            ]),
            layout(&[
                uniform,
                tex(5, float),
                store(6, wgpu::TextureFormat::R32Float),
            ]),
            layout(&[uniform, tex(2, float), tex(5, float), scattered]),
            layout(&[
                uniform,
                tex(5, float),
                scattered,
                tex(8, float),
                tex(9, float),
                store(10, LINEAR),
            ]),
        ];
        let pipe = |entry: &str, l: &wgpu::BindGroupLayout| {
            let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(DOF_PASS),
                bind_group_layouts: &[Some(l)],
                immediate_size: 0,
            });
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(DOF_PASS),
                layout: Some(&layout),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let pipes = [
            pipe("prepare", &layouts[0]),
            pipe("tiles", &layouts[1]),
            pipe("scatter", &layouts[2]),
            pipe("gather", &layouts[3]),
        ];
        let params = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(DOF_PASS),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Dofer {
            layouts,
            pipes,
            params,
            written: Written::default(),
            sized: None,
        }
    }

    /// The last frame's circles of confusion: the texture (rg32float: the signed CoC in px, the
    /// view depth) and its size.
    pub fn coc(&self) -> Option<(&wgpu::Texture, [u32; 2])> {
        self.sized.as_ref().map(|s| (&s.coc, s.size))
    }

    /// A frame with no depth of field: the targets it bound are let go.
    pub fn rest(&mut self) {
        self.sized = None;
    }

    /// This frame's parameters: `dof` through `camera` on a frame of `size`, with the output's
    /// `exposure` scale saying what counts as a bright point.
    pub fn prepare(
        &mut self,
        device: &Device,
        dof: &Dof,
        camera: &Camera,
        size: [u32; 2],
        exposure: f64,
        planted: Planted,
    ) {
        let [w, h] = [size[0] as f32, size[1] as f32];
        // The CoC is in px of the scene's frame; the targets may draw at another size.
        let scale = f64::from(size[0]) / camera.size[0].max(1.0);
        let band = dof.band;
        let params = Params {
            size: [w, h, 1.0 / w, 1.0 / h],
            cam: [
                camera.near as f32,
                camera.far as f32,
                if dof.orthographic { 1.0 } else { 0.0 },
                dof.focus as f32,
            ],
            coc: [
                (dof.k * scale) as f32,
                (dof.ortho_coc * scale) as f32,
                (dof.max_coc * scale) as f32,
                dof.taps as f32,
            ],
            band_at: band.map_or([0.0; 4], |b| {
                [
                    (b.at[0] * scale) as f32,
                    (b.at[1] * scale) as f32,
                    b.normal[0] as f32,
                    b.normal[1] as f32,
                ]
            }),
            band: band.map_or([0.0; 4], |b| {
                [
                    (b.width * scale) as f32,
                    (b.feather * scale) as f32,
                    (b.amount * scale) as f32,
                    1.0,
                ]
            }),
            bokeh: [
                dof.blades as f32,
                if planted.linear_coc { 1.0 } else { 0.0 },
                exposure as f32,
                size[0].div_ceil(TILE) as f32,
            ],
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_changed(&self.params, &self.written, bytemuck::bytes_of(&params))
        });
    }

    fn sized(
        &self,
        device: &Device,
        size: [u32; 2],
        linear: &wgpu::TextureView,
        depth: &wgpu::TextureView,
    ) -> Sized {
        let d = &device.device;
        let texture = |label: &str, size: [u32; 2], format, usage| {
            d.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage,
                view_formats: &[],
            })
        };
        let both = wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING;
        let base = texture("scene3d.dof base", size, LINEAR, both);
        let coc = texture(
            "scene3d.dof coc",
            size,
            wgpu::TextureFormat::Rg32Float,
            both | wgpu::TextureUsages::COPY_SRC,
        );
        let tiles = texture(
            "scene3d.dof tiles",
            [size[0].div_ceil(TILE), size[1].div_ceil(TILE)],
            wgpu::TextureFormat::R32Float,
            both,
        );
        let resolved = texture(
            "scene3d.dof resolved",
            size,
            LINEAR,
            wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        );
        let scattered = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("scene3d.dof scattered"),
            size: u64::from(size[0]) * u64::from(size[1]) * 12,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let view = |t: &wgpu::Texture| t.create_view(&Default::default());
        let (base_view, coc_view, tiles_view, resolved_view) =
            (view(&base), view(&coc), view(&tiles), view(&resolved));
        let entry = |binding, resource| wgpu::BindGroupEntry { binding, resource };
        let tex = wgpu::BindingResource::TextureView;
        let params = self.params.as_entire_binding();
        let bind = |k: usize, entries: &[wgpu::BindGroupEntry]| {
            d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(DOF_PASS),
                layout: &self.layouts[k],
                entries,
            })
        };
        let binds = [
            bind(
                0,
                &[
                    entry(0, params.clone()),
                    entry(1, tex(depth)),
                    entry(2, tex(linear)),
                    entry(3, tex(&base_view)),
                    entry(4, tex(&coc_view)),
                ],
            ),
            bind(
                1,
                &[
                    entry(0, params.clone()),
                    entry(5, tex(&coc_view)),
                    entry(6, tex(&tiles_view)),
                ],
            ),
            bind(
                2,
                &[
                    entry(0, params.clone()),
                    entry(2, tex(linear)),
                    entry(5, tex(&coc_view)),
                    entry(7, scattered.as_entire_binding()),
                ],
            ),
            bind(
                3,
                &[
                    entry(0, params),
                    entry(5, tex(&coc_view)),
                    entry(7, scattered.as_entire_binding()),
                    entry(8, tex(&base_view)),
                    entry(9, tex(&tiles_view)),
                    entry(10, tex(&resolved_view)),
                ],
            ),
        ];
        Sized {
            size,
            linear: linear.clone(),
            depth: depth.clone(),
            coc,
            scattered,
            resolved,
            binds,
        }
    }

    /// The dof over `linear` (its texture and view) against `depth`, at `size`.
    pub fn job(
        &mut self,
        device: &Device,
        size: [u32; 2],
        linear: (&wgpu::Texture, &wgpu::TextureView),
        depth: &wgpu::TextureView,
        profiler: &Option<crate::Profiler>,
    ) -> Job {
        let keep = self
            .sized
            .as_ref()
            .is_some_and(|s| s.size == size && &s.linear == linear.1 && &s.depth == depth);
        if !keep {
            self.sized = Some(self.sized(device, size, linear.1, depth));
        }
        let s = self.sized.as_ref().expect("sized above");
        let (pipes, binds) = (self.pipes.clone(), s.binds.clone());
        let (resolved, scattered) = (s.resolved.clone(), s.scattered.clone());
        let linear_texture = linear.0.clone();
        let profiler = profiler.clone();
        let pixels = [size[0].div_ceil(8), size[1].div_ceil(8)];
        let tiles = [size[0].div_ceil(TILE), size[1].div_ceil(TILE)];
        Box::new(move |encoder| {
            encoder.clear_buffer(&scattered, 0, None);
            // Each pass is timed under DOF_PASS; the profiler sums them by label.
            for (k, (pipe, bind)) in pipes.iter().zip(&binds).enumerate() {
                let query = profiler
                    .as_ref()
                    .map(|p| crate::status::lock(p).begin_pass_query(DOF_PASS, encoder));
                {
                    deep_gpu::counted::compute_pass();
                    let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                        label: Some(DOF_PASS),
                        timestamp_writes: query
                            .as_ref()
                            .and_then(|q| q.compute_pass_timestamp_writes()),
                    });
                    pass.set_pipeline(pipe);
                    pass.set_bind_group(0, bind, &[]);
                    let groups = if k == 1 { tiles } else { pixels };
                    pass.dispatch_workgroups(groups[0], groups[1], 1);
                }
                if let (Some(p), Some(q)) = (&profiler, query) {
                    crate::status::lock(p).end_query(encoder, q);
                }
            }
            encoder.copy_texture_to_texture(
                resolved.as_image_copy(),
                linear_texture.as_image_copy(),
                wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
            );
        })
    }
}
