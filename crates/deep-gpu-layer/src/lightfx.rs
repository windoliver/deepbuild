//! #2031: the GPU layer's light pass for a lit group's lit children (canvas primitives: Frame and
//! group `frame@1`, `group@1`). The group compositor draws the children alone into a target; this
//! lights each pixel of it as deep-canvas-marks' `light` (the CPU reference) does, in f32, over
//! the children's bounds, into another target to composite. #2032: a light is left out of a
//! pixel an occluding outline shadows, by `shadow`'s segment test over its bins.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_marks::light::{Light, Plant, Point, MAX_LIGHTS};
use deep_canvas_marks::path::{self, Verb};
use deep_canvas_marks::scene::{self, Palette};
use deep_canvas_marks::shadow::{self, Caster};
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
        light.light_pixels(&mut inside, width, false, 1.0, |px, py| [px, py]);
        for (px, py, p) in picture.enumerate_pixels_mut() {
            let (cx, cy) = (f64::from(px) + 0.5, f64::from(py) + 0.5);
            if cx >= x && cx < x + w && cy >= y && cy < y + h {
                *p = *inside.get_pixel(px, py);
            }
        }
    }
}

/// #2032: what a light list casts at a zoom, on the device: the lights as drawn, each one's
/// bins, and the occluders' segments, the bins' words and the bins' bounds, in px.
struct Cast {
    light: Arc<Light>,
    zoom: f64,
    lights: Vec<Point>,
    casters: Vec<Option<Caster>>,
    segs: wgpu::Buffer,
    words: wgpu::Buffer,
    bounds: wgpu::Buffer,
}

impl Cast {
    /// `bounds`: the lit children's, u, which a planted far point light stands off from.
    fn new(
        device: &Device,
        light: &Arc<Light>,
        planted: Option<Planted>,
        zoom: f64,
        bounds: [f64; 4],
    ) -> Cast {
        let mut lights = light.lights.clone();
        if planted == Some(Planted::SunFarPointLight) {
            let centre = [bounds[0] + bounds[2] / 2.0, bounds[1] + bounds[3] / 2.0];
            for l in &mut lights {
                if let Some(dir) = l.sun.take() {
                    l.at = [centre[0] - 2000.0 * dir[0], centre[1] - 2000.0 * dir[1]];
                }
            }
        }
        let boxes: Vec<Vec<Verb>>;
        let outlines = if planted == Some(Planted::ShadowBoundingBoxes) {
            boxes = light.occluders.outlines.iter().map(|v| boxed(v)).collect();
            &boxes
        } else {
            &light.occluders.outlines
        };
        let (segs, mut words, mut bounds, casters) = match shadow::build(&lights, outlines, zoom) {
            Some(s) => {
                // A bound with no end is one past every pixel.
                let px = |v: f64| (v * zoom).min(1e30) as f32;
                let segs = s.segs.iter().map(|s| s.map(px)).collect();
                let bounds = s.bounds.iter().map(|b| b.map(px)).collect();
                (segs, s.words, bounds, s.casters)
            }
            None => (
                vec![[0.0_f32; 4]],
                Vec::new(),
                Vec::new(),
                vec![None; lights.len()],
            ),
        };
        // A binding holds at least one element, though no light casts.
        words.resize(words.len().max(1), 0);
        bounds.resize(bounds.len().max(1), [0.0_f32; 2]);
        let buffer = |contents: &[u8]| {
            device
                .device
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("light fx shadows"),
                    contents,
                    usage: wgpu::BufferUsages::STORAGE,
                })
        };
        Cast {
            light: Arc::clone(light),
            zoom,
            lights,
            casters,
            segs: buffer(bytemuck::cast_slice(&segs)),
            words: buffer(bytemuck::cast_slice(&words)),
            bounds: buffer(bytemuck::cast_slice(&bounds)),
        }
    }
}

/// `--planted shadow_bounding_boxes`: an outline's axis-aligned bounding box, as an outline.
fn boxed(verbs: &[Verb]) -> Vec<Verb> {
    let points = path::flatten(verbs, path::tolerance(0));
    let points = points.iter().flat_map(|l| &l.points);
    let (lo, hi) = points.fold(
        ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]),
        |(lo, hi), p| {
            (
                [lo[0].min(p[0]), lo[1].min(p[1])],
                [hi[0].max(p[0]), hi[1].max(p[1])],
            )
        },
    );
    vec![
        Verb::Move(lo),
        Verb::Line([hi[0], lo[1]]),
        Verb::Line(hi),
        Verb::Line([lo[0], hi[1]]),
        Verb::Close,
    ]
}

/// The pipelines, made once per device.
pub struct LightFx {
    layout: wgpu::BindGroupLayout,
    /// By whether a light of the list casts shadows (1) and whether the pass lays the lit
    /// children over the layer itself (2).
    pipelines: [wgpu::RenderPipeline; 4],
    /// What the light drawn last cast, kept while the same lights and occluders draw.
    cast: Option<Cast>,
}

impl LightFx {
    pub fn new(device: &Device, format: wgpu::TextureFormat) -> LightFx {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("light fx"),
            source: wgpu::ShaderSource::Wgsl(include_str!("lightfx.wgsl").into()),
        });
        let buffer = |binding, ty| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let storage = wgpu::BufferBindingType::Storage { read_only: true };
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("light fx"),
            entries: &[
                buffer(0, wgpu::BufferBindingType::Uniform),
                texture(1),
                buffer(2, storage),
                buffer(3, storage),
                buffer(4, storage),
                texture(5),
            ],
        });
        let pipelines = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("light fx"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = |entry| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
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
                    entry_point: Some(entry),
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
            })
        };
        LightFx {
            pipelines: ["fs", "fs_cast", "fs_over", "fs_cast_over"].map(pipeline),
            layout,
            cast: None,
        }
    }

    /// `children` lit by `light` at `zoom` px a u over the px crop `rect` (`[x, y, w, h]`),
    /// written into `into`, over `back` where it is given: what the layer drew before, a copy
    /// of `into`. `linear`: the layer composites in linear light; `bounds`: the children's, u.
    /// The light's planted program, if any, runs here too, and so does a planted shadow.
    #[allow(clippy::too_many_arguments)]
    pub fn run(
        &mut self,
        device: &Device,
        light: &Arc<Light>,
        planted: Option<Planted>,
        zoom: f64,
        linear: bool,
        children: &wgpu::TextureView,
        back: Option<&wgpu::TextureView>,
        bounds: [f64; 4],
        rect: [u32; 4],
        into: &wgpu::Texture,
    ) {
        let [x, y, w, h] = rect;
        if w == 0 || h == 0 {
            return;
        }
        let kept = |c: &Cast| {
            let same = c.light.lights == light.lights && c.light.occluders == light.occluders;
            planted.is_none() && same && c.zoom == zoom
        };
        let cast = match self.cast.take().filter(kept) {
            Some(cast) => cast,
            None => Cast::new(device, light, planted, zoom, bounds),
        };
        let flags = u32::from(linear)
            | (u32::from(light.plant == Plant::LinearFalloff) << 1)
            | (u32::from(light.plant == Plant::EncodedSum) << 2)
            | (u32::from(planted == Some(Planted::ShadowInsideOutline)) << 3)
            | (u32::from(planted == Some(Planted::ShadowRemovesAmbient)) << 4)
            | (u32::from(planted == Some(Planted::ShadowEdgeAliased)) << 5);
        let count = cast.lights.len().min(MAX_LIGHTS);
        let mut words: Vec<u8> = Vec::with_capacity(16 + MAX_LIGHTS * 64);
        words.extend_from_slice(&(light.ambient as f32).to_le_bytes());
        words.extend_from_slice(&(count as u32).to_le_bytes());
        words.extend_from_slice(&flags.to_le_bytes());
        words.extend_from_slice(&0u32.to_le_bytes());
        // Each light, then what each one that casts reads beside it.
        let mut casters: Vec<u8> = Vec::with_capacity(MAX_LIGHTS * 32);
        for (l, caster) in cast.lights.iter().zip(&cast.casters).take(count) {
            // A light with no range (a sun, or the far point light planted for one) takes one
            // past every pixel, where its falloff is 1.
            let range = (l.range * zoom).min(1e18);
            let at = [l.at[0] * zoom, l.at[1] * zoom, range, l.energy];
            let casts = f64::from(u8::from(caster.is_some()));
            let color = [l.color[0], l.color[1], l.color[2], casts];
            for v in at.iter().chain(&color) {
                words.extend_from_slice(&(*v as f32).to_le_bytes());
            }
            let Some(c) = caster else {
                casters.resize(casters.len() + 32, 0);
                continue;
            };
            let dir = l.sun.unwrap_or([0.0; 2]);
            for v in [dir[0], dir[1], c.origin * zoom, c.scale / zoom] {
                casters.extend_from_slice(&(v as f32).to_le_bytes());
            }
            for v in [
                c.table as u32,
                c.bounds as u32,
                u32::from(l.sun.is_some()),
                0,
            ] {
                casters.extend_from_slice(&v.to_le_bytes());
            }
        }
        words.resize(16 + MAX_LIGHTS * 32, 0);
        words.extend_from_slice(&casters);
        words.resize(16 + MAX_LIGHTS * 64, 0);
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
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: cast.segs.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: cast.words.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: cast.bounds.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::TextureView(back.unwrap_or(children)),
                },
            ],
        });
        let casts = cast.casters.iter().any(Option::is_some);
        self.cast = Some(cast);
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
                        load: match back {
                            Some(_) => crate::groups::load_for(rect, [into.width(), into.height()]),
                            None => wgpu::LoadOp::Load,
                        },
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(
                &self.pipelines[usize::from(casts) + 2 * usize::from(back.is_some())],
            );
            pass.set_bind_group(0, &group, &[]);
            pass.set_scissor_rect(x, y, w, h);
            pass.draw(0..3, 0..1);
        }
        device.queue.submit([encoder.finish()]);
    }
}
