//! #2031: the GPU layer's light pass for a lit group's lit children (canvas primitives: Frame and
//! group `frame@1`, `group@1`). The group compositor draws the children alone into a target; this
//! lights each pixel of it as deep-canvas-marks' `light` (the CPU reference) does, in f32, over
//! the children's bounds, into another target to composite.

use std::cell::RefCell;
use std::collections::BTreeMap;

use deep_canvas_marks::light::{Light, Plant, MAX_LIGHTS};
use deep_canvas_marks::scene::{self, Palette};
use deep_gpu::device::Device;
use serde_json::{Map, Value};

use crate::Planted;

/// The scene's planted program for a `--planted` light twin.
pub fn scene_plant(planted: Option<Planted>) -> Option<scene::Planted> {
    Some(match planted? {
        Planted::LightLinearFalloff => scene::Planted::LightLinearFalloff,
        Planted::LightEncodedSum => scene::Planted::LightEncodedSum,
        Planted::LightDefaultAmbientZero => scene::Planted::LightDefaultAmbientZero,
        Planted::LightEveryChild => scene::Planted::LightEveryChild,
        _ => return None,
    })
}

thread_local! {
    /// `--planted light_stale_list`: each lit group's light list as the frame before drew it.
    static BEFORE: RefCell<BTreeMap<String, Value>> = const { RefCell::new(BTreeMap::new()) };
}

/// `--planted light_stale_list`: each lit group of `items` takes the light list the frame drawn
/// before it in this process took, and leaves its own for the next.
pub fn stale(planted: Option<Planted>, items: &mut Map<String, Value>) {
    if planted != Some(Planted::LightStaleList) {
        return;
    }
    BEFORE.with(|before| {
        let mut before = before.borrow_mut();
        for (id, item) in items.iter_mut() {
            let Some(light) = item.pointer_mut("/params/light").filter(|l| !l.is_null()) else {
                continue;
            };
            if let Some(kept) = before.insert(id.clone(), light.clone()) {
                *light = kept;
            }
        }
    });
}

/// `--planted light_every_child`: the status picture's marks of items in a lit group lit as its
/// lit children are, at 1 px a u; straight alpha.
pub fn lit_status(
    picture: &mut image::RgbaImage,
    marks: &[scene::StatusMark],
    items: &Map<String, Value>,
    palette: &Palette,
) {
    for m in marks {
        let Some(light) = deep_canvas_marks::light::around(items, &m.item, palette) else {
            continue;
        };
        // Only the pixels inside the mark's box (u at 1 px a u).
        let [x, y, w, h] = m.bounds;
        let width = picture.width() as usize;
        let mut inside = picture.clone();
        light.light_pixels(&mut inside, width, false, |px, py| [px, py]);
        for (px, py, p) in picture.enumerate_pixels_mut() {
            let (cx, cy) = (f64::from(px) + 0.5, f64::from(py) + 0.5);
            if cx >= x && cx < x + w && cy >= y && cy < y + h {
                *p = *inside.get_pixel(px, py);
            }
        }
    }
}

/// The pipelines, made once per device.
pub struct LightFx {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
}

impl LightFx {
    pub fn new(device: &Device, format: wgpu::TextureFormat) -> LightFx {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("light fx"),
            source: wgpu::ShaderSource::Wgsl(include_str!("lightfx.wgsl").into()),
        });
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("light fx"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipelines = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("light fx"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("light fx"),
            layout: Some(&pipelines),
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
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        LightFx { layout, pipeline }
    }

    /// `children` lit by `light` at `zoom` px a u over the px crop `rect` (`[x, y, w, h]`),
    /// written into `into`; `linear`: the layer composites in linear light. The light's planted
    /// program, if any, runs here too.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &self,
        device: &Device,
        light: &Light,
        zoom: f64,
        linear: bool,
        children: &wgpu::TextureView,
        rect: [u32; 4],
        into: &wgpu::Texture,
    ) {
        let [x, y, w, h] = rect;
        if w == 0 || h == 0 {
            return;
        }
        let flags = u32::from(linear)
            | (u32::from(light.plant == Plant::LinearFalloff) << 1)
            | (u32::from(light.plant == Plant::EncodedSum) << 2);
        let count = light.lights.len().min(MAX_LIGHTS);
        let mut words: Vec<u8> = Vec::with_capacity(16 + MAX_LIGHTS * 32);
        words.extend_from_slice(&(light.ambient as f32).to_le_bytes());
        words.extend_from_slice(&(count as u32).to_le_bytes());
        words.extend_from_slice(&flags.to_le_bytes());
        words.extend_from_slice(&0u32.to_le_bytes());
        for l in light.lights.iter().take(count) {
            let at = [l.at[0] * zoom, l.at[1] * zoom, l.range * zoom, l.energy];
            let color = [l.color[0], l.color[1], l.color[2], 0.0];
            for v in at.iter().chain(&color) {
                words.extend_from_slice(&(*v as f32).to_le_bytes());
            }
        }
        words.resize(16 + MAX_LIGHTS * 32, 0);
        let d = &device.device;
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("light fx"),
            contents: &words,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let group = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("light fx"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(children),
                },
            ],
        });
        let view = into.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("light fx"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Load,
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.set_scissor_rect(x, y, w, h);
            pass.draw(0..3, 0..1);
        }
        device.queue.submit([encoder.finish()]);
    }
}
