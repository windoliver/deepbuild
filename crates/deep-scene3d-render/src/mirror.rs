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

use crate::{Planted, Renderer, LINEAR, MIRROR_PASS, OUTPUT_PASS};

const SOURCE: &str = include_str!("mirror.wgsl");

/// The mirror's pass: its own renderer and the pass that lays its picture over the parts.
pub struct Mirrorer {
    view: Box<Renderer>,
    layout: wgpu::BindGroupLayout,
    /// The overlay without and with #166's `reflection` target.
    pipeline: [wgpu::RenderPipeline; 2],
    sampler: wgpu::Sampler,
    /// This frame's uniform and part IDs, set by [`Mirrorer::prepare`], and the values they hold.
    frame: Option<(wgpu::Buffer, wgpu::Buffer)>,
    held: ([f32; 4], Vec<u32>),
    /// The overlay's bind group, with the picture and the IDs it binds.
    bind: Option<(wgpu::TextureView, wgpu::TextureView, wgpu::BindGroup)>,
    /// How many parts the picture lays over this frame.
    parts: usize,
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
        let pipeline = |reflection: bool| {
            let targets = [
                // Premultiplied: the picture × strength over the part × (1 − strength).
                Some(wgpu::ColorTargetState {
                    format: LINEAR,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::COLOR,
                }),
                reflection.then_some(wgpu::ColorTargetState {
                    format: crate::water::REFLECTION,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                }),
            ];
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
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
                    targets: &targets[..1 + usize::from(reflection)],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        let pipeline = [pipeline(false), pipeline(true)];
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
            held: ([0.0; 4], Vec::new()),
            bind: None,
            parts: 0,
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
        overlay: bool,
    ) {
        let size = half(scene.size);
        let view = deep_canvas_scene3d::mirror::view(scene, mirror, size);
        self.view.prepare(device, &view, look);
        let mut ids: Vec<u32> = mirror
            .parts
            .iter()
            .filter_map(|p| picks.get(p).copied())
            .filter(|_| overlay)
            .collect();
        let count = ids.len();
        self.parts = count;
        ids.push(0);
        let flip = [
            (2.0 * scene.camera.centre[0] / f64::from(scene.size[0])) as f32,
            mirror.strength as f32,
            (mirror.blur * f64::from(size[0]) / f64::from(scene.size[0])) as f32,
            count as f32,
        ];
        // A frame whose values hold binds the buffers the last one made.
        if self.frame.is_some() && self.held.0 == flip && self.held.1 == ids {
            return;
        }
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
        self.held = (flip, ids);
        self.bind = None;
    }

    /// A frame with no mirror: the overlay lets go of the targets it bound.
    pub fn rest(&mut self) {
        self.bind = None;
    }

    /// The mirrored picture, linear, at half the frame's size (#166's water reads it).
    pub fn picture(&self) -> Option<wgpu::TextureView> {
        self.view.linear().map(|(_, v)| v.clone())
    }

    /// The mirrored view's passes up to its output, then the pass laying its picture over the
    /// parts in `linear`, by `ids`.
    pub fn jobs(
        &mut self,
        device: &Device,
        slot: &wgpu::TextureView,
        linear: &wgpu::TextureView,
        ids: &wgpu::TextureView,
        reflection: Option<wgpu::TextureView>,
        profiler: &Option<crate::Profiler>,
        keep: bool,
    ) -> Vec<(String, Job)> {
        let Some((uniform, parts)) = &self.frame else {
            return Vec::new();
        };
        // #506's planted core keeps the picture the view before it drew.
        let mut jobs: Vec<(String, Job)> = match keep {
            true => Vec::new(),
            false => self
                .view
                .jobs(device, slot, None, None)
                .into_iter()
                .take_while(|(name, _)| name != OUTPUT_PASS)
                .map(|(_, job)| (MIRROR_PASS.to_string(), job))
                .collect(),
        };
        let Some((_, picture)) = self.view.linear() else {
            return Vec::new();
        };
        // #166: a water's own mirror lays no picture over parts; the water's pass reads it.
        if self.parts == 0 {
            self.bind = None;
            return jobs;
        }
        let bind = match &self.bind {
            Some((p, i, bind)) if p == picture && i == ids => bind.clone(),
            _ => {
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
                self.bind = Some((picture.clone(), ids.clone(), bind.clone()));
                bind
            }
        };
        let pipeline = self.pipeline[usize::from(reflection.is_some())].clone();
        let (linear, profiler) = (linear.clone(), profiler.clone());
        jobs.push((
            MIRROR_PASS.into(),
            Box::new(move |encoder| {
                crate::timed(&profiler, MIRROR_PASS, encoder, |encoder, timestamps| {
                    let ops = wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    };
                    let mut colors = vec![Some(wgpu::RenderPassColorAttachment {
                        view: &linear,
                        resolve_target: None,
                        depth_slice: None,
                        ops,
                    })];
                    if let Some(r) = &reflection {
                        colors.push(Some(wgpu::RenderPassColorAttachment {
                            view: r,
                            resolve_target: None,
                            depth_slice: None,
                            ops,
                        }));
                    }
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(MIRROR_PASS),
                        color_attachments: &colors,
                        timestamp_writes: timestamps,
                        ..Default::default()
                    });
                    pass.set_pipeline(&pipeline);
                    pass.set_bind_group(0, &bind, &[]);
                    pass.draw(0..3, 0..1);
                })
            }),
        ));
        jobs
    }
}
