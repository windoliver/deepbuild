//! Material: mirror (#465): one extra pass, the scene from the camera mirrored in the mirror's
//! plane at half resolution (deep_canvas_scene3d::mirror::view), drawn by a renderer of its own
//! with no mirror, and laid over the mirror's parts in the linear target after the geometry.
//! It keeps no history, so seeking equals playing; a mirror seen in it draws its fallback.

use std::collections::BTreeMap;

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::mirror::Mirror;
use deep_canvas_scene3d::scene::Scene;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use wgpu::util::DeviceExt;

use crate::{Planted, Renderer, LINEAR, MIRROR_PASS, OUTPUT_PASS};

const SOURCE: &str = include_str!("mirror.wgsl");

/// The mirror's pass: its own renderer and the pass that lays its picture over the parts.
pub struct Mirrorer {
    view: Box<Renderer>,
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    /// This frame's uniform and part IDs, set by [`Mirrorer::prepare`].
    frame: Option<(wgpu::Buffer, wgpu::Buffer)>,
}

/// The mirrored pass's size: half the frame's, rounded up.
pub fn half(size: [u32; 2]) -> [u32; 2] {
    size.map(|s| s.div_ceil(2).max(1))
}

impl Mirrorer {
    pub fn new(device: &Device, planted: Planted) -> Self {
        let d = &device.device;
        let entry = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty,
            count: None,
        };
        let tex = |sample_type| wgpu::BindingType::Texture {
            sample_type,
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        };
        let buffer = |ty| wgpu::BindingType::Buffer {
            ty,
            has_dynamic_offset: false,
            min_binding_size: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(MIRROR_PASS),
            entries: &[
                entry(0, buffer(wgpu::BufferBindingType::Uniform)),
                entry(1, tex(wgpu::TextureSampleType::Float { filterable: true })),
                entry(
                    2,
                    wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                ),
                entry(3, tex(wgpu::TextureSampleType::Uint)),
                entry(
                    4,
                    buffer(wgpu::BufferBindingType::Storage { read_only: true }),
                ),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(MIRROR_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(MIRROR_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(MIRROR_PASS),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                // Premultiplied: the picture × strength over the part × (1 − strength).
                targets: &[Some(wgpu::ColorTargetState {
                    format: LINEAR,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::COLOR,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some(MIRROR_PASS),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            ..Default::default()
        });
        Mirrorer {
            view: Box::new(Renderer::new(device, planted)),
            layout,
            pipeline,
            sampler,
            frame: None,
        }
    }

    /// Prepares the mirrored view of `scene` and this frame's parameters.
    pub fn prepare(
        &mut self,
        device: &Device,
        scene: &Scene,
        mirror: &Mirror,
        look: &Look3,
        picks: &BTreeMap<String, u32>,
    ) {
        let size = half(scene.size);
        let view = deep_canvas_scene3d::mirror::view(scene, mirror, size);
        self.view.prepare(device, &view, look);
        let mut ids: Vec<u32> = mirror
            .parts
            .iter()
            .filter_map(|p| picks.get(p).copied())
            .collect();
        let count = ids.len();
        ids.push(0);
        let flip = [
            (2.0 * scene.camera.centre[0] / f64::from(scene.size[0])) as f32,
            mirror.strength as f32,
            (mirror.blur * f64::from(size[0]) / f64::from(scene.size[0])) as f32,
            count as f32,
        ];
        let d = &device.device;
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(MIRROR_PASS),
            contents: bytemuck::cast_slice(&flip),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let parts = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(MIRROR_PASS),
            contents: bytemuck::cast_slice(&ids),
            usage: wgpu::BufferUsages::STORAGE,
        });
        self.frame = Some((uniform, parts));
    }

    /// The mirrored view's passes up to its output, then the pass laying its picture over the
    /// parts in `linear`, by `ids`.
    pub fn jobs(
        &mut self,
        device: &Device,
        slot: &wgpu::TextureView,
        linear: &wgpu::TextureView,
        ids: &wgpu::TextureView,
        profiler: &Option<crate::Profiler>,
    ) -> Vec<(String, Job)> {
        let Some((uniform, parts)) = &self.frame else {
            return Vec::new();
        };
        let mut jobs: Vec<(String, Job)> = self
            .view
            .jobs(device, slot, None, None)
            .into_iter()
            .take_while(|(name, _)| name != OUTPUT_PASS)
            .map(|(_, job)| (MIRROR_PASS.to_string(), job))
            .collect();
        let Some((_, picture)) = self.view.linear() else {
            return Vec::new();
        };
        let bind = device.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(MIRROR_PASS),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(picture),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(ids),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: parts.as_entire_binding(),
                },
            ],
        });
        let (pipeline, linear, profiler) =
            (self.pipeline.clone(), linear.clone(), profiler.clone());
        jobs.push((
            MIRROR_PASS.into(),
            Box::new(move |encoder| {
                crate::timed(&profiler, MIRROR_PASS, encoder, |encoder, timestamps| {
                    crate::full_pass(
                        encoder,
                        MIRROR_PASS,
                        &linear,
                        wgpu::LoadOp::Load,
                        &pipeline,
                        &bind,
                        timestamps,
                    )
                })
            }),
        ));
        jobs
    }
}
