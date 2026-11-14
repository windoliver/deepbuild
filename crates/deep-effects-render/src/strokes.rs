//! A look's strokes on surfaces (#462; Look `look@1`: strokes on surfaces): the core's instanced
//! draw of the strokes the CPU laid for this frame, each a quad centred where its anchor projects,
//! laid over the linear target where it shows in front of the scene, before the output pass tone
//! maps it. The CPU's list is what draws: the quad's centre is the stroke's own, never moved here.

use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_scene3d_render::{timed, Profiler};

use crate::runner::LINEAR;

pub use deep_canvas_effects::module::STROKES;

/// One stroke as the draw reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Dab {
    /// Its centre, frame px.
    pub at: [f64; 2],
    /// Its anchor drawn a hair toward the eye, world m: the depth it tests.
    pub near: [f64; 3],
    pub angle: f64,
    pub length: f64,
    pub width: f64,
    /// Linear.
    pub color: [f64; 3],
    /// In [0, 1): its bristles.
    pub seed: f64,
}

pub struct Draw {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
}

impl Draw {
    pub fn new(device: &Device) -> Draw {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(STROKES),
            source: wgpu::ShaderSource::Wgsl(include_str!("strokes.wgsl").into()),
        });
        // Premultiplied over; the target's alpha is left as it was.
        let over = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::OneMinusSrcAlpha,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::Zero,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
        };
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(STROKES),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: LINEAR,
                    blend: Some(over),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            // The shader reads the scene's depth itself: a stroke paints only its own surface.
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        let layout = pipeline.get_bind_group_layout(0);
        Draw { pipeline, layout }
    }

    /// The frame's strokes over `target`, each where `depth` holds its own surface.
    #[allow(clippy::too_many_arguments)]
    pub fn job(
        &self,
        device: &Device,
        clip: [f64; 16],
        dabs: &[Dab],
        target: wgpu::TextureView,
        depth: wgpu::TextureView,
        size: [u32; 2],
        profiler: Option<Profiler>,
    ) -> Job {
        let d = &device.device;
        // A perspective clip's w reads depth; an orthographic one's is 1.
        let perspective = clip[3] != 0.0 || clip[7] != 0.0 || clip[11] != 0.0;
        let uniform: Vec<u8> = clip
            .iter()
            .map(|x| *x as f32)
            .chain([
                size[0] as f32,
                size[1] as f32,
                f32::from(u8::from(perspective)),
                0.0,
            ])
            .flat_map(f32::to_le_bytes)
            .collect();
        let words: Vec<u8> = dabs
            .iter()
            .flat_map(|s| {
                [
                    s.at[0], s.at[1], s.angle, s.seed, s.near[0], s.near[1], s.near[2], 0.0,
                    s.length, s.width, 0.0, 0.0, s.color[0], s.color[1], s.color[2], 1.0,
                ]
            })
            .map(|x| x as f32)
            .flat_map(f32::to_le_bytes)
            .collect();
        let ub = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(STROKES),
            contents: &uniform,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let sb = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(STROKES),
            contents: &words,
            usage: wgpu::BufferUsages::STORAGE,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(STROKES),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: ub.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: sb.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&depth),
                },
            ],
        });
        let pipeline = self.pipeline.clone();
        let count = dabs.len() as u32;
        Box::new(move |encoder| {
            let _keep = (&ub, &sb);
            timed(&profiler, STROKES, encoder, |e, ts| {
                let mut pass = e.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(STROKES),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &target,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    timestamp_writes: ts,
                    ..Default::default()
                });
                pass.set_pipeline(&pipeline);
                pass.set_bind_group(0, &bind, &[]);
                pass.draw(0..6, 0..count);
            });
        })
    }
}
