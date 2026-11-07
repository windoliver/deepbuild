//! A drawn look's passes on the GPU layer (issue #149; canvas primitives: Look `look@1`: paper;
//! light; drawn fills; Paint: noise fill): the ground from the paper field, one item's coverage
//! laid through its medium, and relief over a finished layer. Each pass is a full-frame fragment
//! pass scissored to what it can touch. What a pixel shows is a pure function of the look, the
//! camera, the seeds and that pixel's place on the page.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas_drawn::geometry::{direction, seeded};
use deep_canvas_drawn::medium::{words, Medium};
use deep_canvas_drawn::spec::{Anchor, Look, ReliefFrom, Zoom, TEETH};
use deep_canvas_drawn::tooth;
use deep_canvas_marks::drawn::View;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;
use deep_scene3d_render::{Post, PostFrame};
use serde_json::{Map, Value};
use wgpu::util::DeviceExt as _;

use crate::refused;

/// A tooth as the field reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Tooth {
    pub kind: u32,
    pub seed: u32,
    pub scale: f64,
    pub depth: f64,
    pub fade_fine: bool,
    /// An image's name and its gray rows, value ÷ 255, in place of the kind.
    pub image: Option<(String, u32, u32, Arc<Vec<f32>>)>,
}

/// What the ground draws of a look's paper, beyond its field.
#[derive(Clone, Debug, PartialEq)]
pub struct Sheet {
    pub ground: [f64; 3],
    /// How far pits darken the sheet.
    pub shade: f64,
    pub stain: Option<(f64, f64, [f64; 3])>,
    pub foxing: f64,
    pub craquelure: (f64, f64),
    pub plate: (f64, f64),
    pub tarnish: Option<(f64, [f64; 3], [f64; 3])>,
    /// `[x0, y0, x1, y1]` with `[darkness, width]`.
    pub folds: Vec<([f64; 4], [f64; 2])>,
    pub tape: Vec<[f64; 4]>,
}

/// One frame's page: where its pixels land on the paper, and the paper.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    pub scale: f64,
    pub offset: [f64; 2],
    pub zoom: f64,
    /// The field moves with the camera: any anchor but the frame.
    pub scale_follows: bool,
    pub size: [f64; 2],
    pub seed: u32,
    pub tooth: Option<Tooth>,
    pub sheet: Option<Sheet>,
    /// Toward the light, on the page.
    pub light: [f64; 2],
    pub elevation: f64,
    /// `(from the layer's own coverage, strength)`.
    pub relief: Option<(bool, f64)>,
    /// Each collection's members, which a target and a resist read.
    pub collections: BTreeMap<String, Vec<String>>,
}

fn rgb(palette: &BTreeMap<String, [f64; 3]>, role: &str) -> Result<[f64; 3], Value> {
    palette
        .get(role)
        .copied()
        .ok_or_else(|| refused("role_unresolved", format!("look: {role}")))
}

/// A gray PNG's rows, value ÷ 255.
fn gray(path: &str) -> Result<(u32, u32, Vec<f32>), Value> {
    let image =
        image::open(path).map_err(|e| refused("asset_unreadable", format!("{path}: {e}")))?;
    let g = image.to_luma8();
    let (w, h) = g.dimensions();
    Ok((
        w,
        h,
        g.into_raw()
            .into_iter()
            .map(|v| f32::from(v) / 255.0)
            .collect(),
    ))
}

impl Page {
    /// A frame's page under `look`, seen through `view`.
    pub fn of(
        look: &Look,
        view: &View,
        doc: &Map<String, Value>,
        palette: &BTreeMap<String, [f64; 3]>,
        assets: &Map<String, Value>,
    ) -> Result<Page, Value> {
        let size = crate::view3d::pair(&doc["size"]).unwrap_or([1, 1]);
        let size = [f64::from(size[0]), f64::from(size[1])];
        let doc_seed = doc.get("seed").and_then(Value::as_u64).unwrap_or(0);
        let paper = look.paper.as_ref();
        let (scale, offset) = match paper.map(|p| p.anchor) {
            // A frame-anchored sheet stays where the pixels are.
            Some(Anchor::Frame) => (1.0, [0.0, 0.0]),
            _ => view.to_world(),
        };
        let mut tooth = None;
        if let Some(t) = paper.and_then(|p| p.tooth.as_ref()) {
            let image = match &t.from {
                None => None,
                Some(sha) => {
                    let path = assets.get(sha).and_then(Value::as_str).ok_or_else(|| {
                        refused(
                            "asset_unreadable",
                            format!("ground/params/tooth/from: {sha}"),
                        )
                    })?;
                    let (w, h, rows) = gray(path)?;
                    Some((sha.clone(), w, h, Arc::new(rows)))
                }
            };
            tooth = Some(Tooth {
                kind: t.kind,
                seed: t.seed as u32,
                scale: t.scale,
                depth: t.depth,
                fade_fine: paper.is_some_and(|p| p.zoom == Zoom::FadeFine),
                image,
            });
        }
        let sheet = match paper {
            None => None,
            Some(p) => {
                let a = &p.age;
                let area = size[0] * size[1];
                let stain = match &a.stains {
                    Some((count, r, role)) if *count > 0 => Some((
                        (area / f64::from(*count)).sqrt(),
                        r / 2.0,
                        rgb(palette, role)?,
                    )),
                    _ => None,
                };
                let tarnish = match &a.tarnish {
                    Some((ramp, width)) if !ramp.is_empty() => Some((
                        *width,
                        rgb(palette, &ramp[0])?,
                        rgb(palette, ramp.last().expect("not empty"))?,
                    )),
                    _ => None,
                };
                let s = u64::from(doc_seed as u32);
                let mut folds = Vec::new();
                for k in 0..a.folds as u32 {
                    let at = seeded(s, "fold", k);
                    let across = k % 2 == 0;
                    let line = if across {
                        [0.0, at * size[1], size[0], at * size[1]]
                    } else {
                        [at * size[0], 0.0, at * size[0], size[1]]
                    };
                    folds.push((line, [0.1, 3.0]));
                }
                for k in 0..a.creases as u32 {
                    let (x, y) = (seeded(s, "crease", k * 4), seeded(s, "crease", k * 4 + 1));
                    let (dx, dy) = (
                        seeded(s, "crease", k * 4 + 2),
                        seeded(s, "crease", k * 4 + 3),
                    );
                    let (x, y) = (x * size[0], y * size[1]);
                    folds.push((
                        [x, y, x + (dx - 0.5) * 300.0, y + (dy - 0.5) * 300.0],
                        [0.06, 1.5],
                    ));
                }
                folds.truncate(24);
                Some(Sheet {
                    ground: rgb(palette, &p.role)?,
                    shade: 0.35,
                    stain,
                    foxing: a.foxing,
                    craquelure: a.craquelure.unwrap_or((0.0, 0.0)),
                    plate: a.plate_mark.unwrap_or((0.0, 0.0)),
                    tarnish,
                    folds,
                    tape: a.tape.iter().take(8).copied().collect(),
                })
            }
        };
        let light = look.light.as_ref();
        Ok(Page {
            scale,
            offset,
            zoom: 1.0 / scale,
            scale_follows: paper.is_none_or(|p| p.anchor != Anchor::Frame),
            size,
            seed: doc_seed as u32,
            tooth,
            sheet,
            light: direction(light.map_or(135.0, |l| l.dir)),
            elevation: light.map_or(45.0, |l| l.elevation),
            relief: light
                .and_then(|l| l.relief.as_ref())
                .map(|r| (r.from != ReliefFrom::Tooth, r.strength)),
            collections: doc
                .get("collections")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .map(|(name, c)| {
                    let members = c["members"].as_array().into_iter().flatten();
                    (
                        name.clone(),
                        members
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect(),
                    )
                })
                .collect(),
        })
    }
}

impl Page {
    /// The same paper with this frame's camera.
    pub fn seen_through(&self, view: Option<&View>) -> Page {
        let mut page = self.clone();
        let (scale, offset) = view.copied().unwrap_or(View::NONE).to_world();
        if self.scale_follows {
            (page.scale, page.offset, page.zoom) = (scale, offset, 1.0 / scale);
        }
        page
    }
}

/// `TEETH` names the kinds in the order deep_canvas_drawn builds them.
const _: () = assert!(TEETH.len() == 8);

/// The passes on one device, and the tiles they read.
pub struct Drawn {
    layout: wgpu::BindGroupLayout,
    paper: wgpu::RenderPipeline,
    medium: wgpu::RenderPipeline,
    relief: wgpu::RenderPipeline,
    blit: wgpu::RenderPipeline,
    three: Option<Three>,
    wrap: wgpu::Sampler,
    clamped: wgpu::Sampler,
    grain: wgpu::TextureView,
    empty: wgpu::TextureView,
    teeth: BTreeMap<String, wgpu::TextureView>,
    /// The last ground drawn, by what it reads, so a still camera pays for it once.
    last: Option<(String, wgpu::Texture)>,
}

const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba32Float;
const WORDS: usize = 13 + 64;

/// A filterable tile with its mips, repeating.
fn tile(device: &Device, side: [u32; 2], texels: Vec<[f32; 4]>) -> wgpu::TextureView {
    let levels = if side[0] == side[1] && side[0].is_power_of_two() {
        32 - side[0].leading_zeros()
    } else {
        1
    };
    let texture = device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("drawn tile"),
        size: wgpu::Extent3d {
            width: side[0],
            height: side[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let half = |v: f32| half_float(v);
    let mut level = texels;
    let mut s = side;
    for mip in 0..levels {
        let bytes: Vec<u8> = level
            .iter()
            .flat_map(|t| t.iter().flat_map(|v| half(*v).to_le_bytes()))
            .collect();
        device.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: mip,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &bytes,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(s[0] * 8),
                rows_per_image: Some(s[1]),
            },
            wgpu::Extent3d {
                width: s[0],
                height: s[1],
                depth_or_array_layers: 1,
            },
        );
        if mip + 1 < levels {
            level = tooth::halved(&level, s[0] as usize);
            s = [s[0] / 2, s[1] / 2];
        }
    }
    texture.create_view(&Default::default())
}

/// An f32 in 0..1 as an IEEE half, by rounding.
fn half_float(v: f32) -> u16 {
    let bits = v.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exp = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    if exp <= 0 {
        return sign;
    }
    let mantissa = (bits >> 13) & 0x3ff;
    let round = (bits >> 12) & 1;
    sign | ((((exp as u32) << 10 | mantissa) + round) as u16)
}

fn view_of(t: &wgpu::Texture) -> wgpu::TextureView {
    t.create_view(&Default::default())
}

impl Drawn {
    pub fn new(device: &Device) -> Drawn {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("drawn"),
            source: wgpu::ShaderSource::Wgsl(include_str!("drawn.wgsl").into()),
        });
        let texture = |binding, filterable| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let sampler = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("drawn"),
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
                texture(1, true),
                sampler(2),
                texture(3, true),
                texture(4, false),
                texture(5, true),
                sampler(6),
                texture(7, false),
            ],
        });
        let pipelines = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("drawn"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = |entry: &str, format| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("drawn"),
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
        let mode = |address_mode| wgpu::SamplerDescriptor {
            label: Some("drawn"),
            address_mode_u: address_mode,
            address_mode_v: address_mode,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        };
        let grain = tile(device, [tooth::TILE as u32; 2], tooth::channels(0, 0x5eed));
        let empty = tile(device, [1, 1], vec![[0.0; 4]]);
        Drawn {
            paper: pipeline("paper", FORMAT),
            medium: pipeline("medium", FORMAT),
            relief: pipeline("relief", FORMAT),
            blit: pipeline("blit", wgpu::TextureFormat::Rgba16Float),
            three: None,
            wrap: d.create_sampler(&mode(wgpu::AddressMode::Repeat)),
            clamped: d.create_sampler(&mode(wgpu::AddressMode::ClampToEdge)),
            layout,
            grain,
            empty,
            teeth: BTreeMap::new(),
            last: None,
        }
    }

    /// The tile of `t`, made once per kind and seed, or per image.
    fn tile_of(&mut self, device: &Device, t: &Tooth) -> wgpu::TextureView {
        let key = match &t.image {
            Some((sha, ..)) => sha.clone(),
            None => format!("{}:{}", t.kind, t.seed),
        };
        self.teeth
            .entry(key)
            .or_insert_with(|| match &t.image {
                Some((_, w, h, rows)) => tile(
                    device,
                    [*w, *h],
                    rows.iter().map(|v| [*v, 0.0, 0.0, 1.0]).collect(),
                ),
                None => {
                    let rows = tooth::tile(t.kind, t.seed);
                    let side = [tooth::TILE as u32; 2];
                    tile(
                        device,
                        side,
                        rows.iter().map(|v| [*v, 0.0, 0.0, 1.0]).collect(),
                    )
                }
            })
            .clone()
    }

    fn words(&self, page: &Page, flags: u32) -> Vec<[f32; 4]> {
        let f = |v: f64| v as f32;
        let mut w = vec![[0.0f32; 4]; WORDS];
        w[0] = [
            f(page.scale),
            f(page.offset[0]),
            f(page.offset[1]),
            f(page.zoom),
        ];
        let (span, tooth) = match &page.tooth {
            Some(t) => match &t.image {
                Some((_, iw, ih, _)) => {
                    ([*iw as f32, *ih as f32], [f(t.scale), f(t.depth), 1.0, 0.0])
                }
                None => (
                    [64.0, 64.0],
                    [
                        f(t.scale),
                        f(t.depth),
                        tooth::TEXELS_PER_SCALE as f32,
                        f32::from(u8::from(t.fade_fine)),
                    ],
                ),
            },
            None => ([64.0, 64.0], [8.0, 0.0, 8.0, 0.0]),
        };
        w[1] = [f(page.size[0]), f(page.size[1]), span[0], span[1]];
        w[2] = tooth;
        let e = deep_canvas::ops::rad(page.elevation);
        w[10] = [
            f(page.light[0]),
            f(page.light[1]),
            f(deep_canvas::ops::sin(e)),
            0.0,
        ];
        w[11] = [-1.0, 0.0, 0.0, 0.0];
        w[12] = [0, page.seed, 0, flags].map(f32::from_bits);
        w
    }

    /// The pass's bind group: its words, the tile and what it reads.
    fn bind(
        &self,
        d: &wgpu::Device,
        words: &[[f32; 4]],
        tile: &wgpu::TextureView,
        views: [&wgpu::TextureView; 3],
    ) -> wgpu::BindGroup {
        let bytes: Vec<u8> = words
            .iter()
            .flatten()
            .flat_map(|v| v.to_le_bytes())
            .collect();
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("drawn"),
            contents: &bytes,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let [cover, soft, resist] = views;
        d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("drawn"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(tile),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&self.wrap),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(&self.grain),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(cover),
                },
                wgpu::BindGroupEntry {
                    binding: 5,
                    resource: wgpu::BindingResource::TextureView(soft),
                },
                wgpu::BindGroupEntry {
                    binding: 6,
                    resource: wgpu::BindingResource::Sampler(&self.clamped),
                },
                wgpu::BindGroupEntry {
                    binding: 7,
                    resource: wgpu::BindingResource::TextureView(resist),
                },
            ],
        })
    }

    /// One pass into `into`, bound to these views and scissored to `rect`.
    #[allow(clippy::too_many_arguments)]
    fn pass(
        &self,
        device: &Device,
        pipeline: &wgpu::RenderPipeline,
        words: &[[f32; 4]],
        tile: &wgpu::TextureView,
        views: [&wgpu::TextureView; 3],
        into: &wgpu::Texture,
        rect: [u32; 4],
    ) {
        let d = &device.device;
        let group = self.bind(d, words, tile, views);
        let mut encoder = d.create_command_encoder(&Default::default());
        {
            let view = view_of(into);
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("drawn"),
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
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, &group, &[]);
            pass.set_scissor_rect(rect[0], rect[1], rect[2], rect[3]);
            pass.draw(0..3, 0..1);
        }
        device.queue.submit([encoder.finish()]);
    }

    fn tooth_flag(page: &Page) -> u32 {
        u32::from(page.tooth.is_some())
    }

    fn tile_or_grain(&mut self, device: &Device, page: &Page) -> wgpu::TextureView {
        match &page.tooth {
            Some(t) => self.tile_of(device, t),
            None => self.grain.clone(),
        }
    }

    /// The ground of `page` as a texture of its own: paper with its tooth and age, in the layer's
    /// space. A still camera draws it once.
    pub fn ground(
        &mut self,
        device: &Device,
        page: &Page,
        size: [u32; 2],
        linear: bool,
    ) -> Option<wgpu::Texture> {
        let sheet = page.sheet.as_ref()?;
        let key = format!("{page:?}{size:?}{linear}");
        if let Some((k, t)) = &self.last {
            if *k == key {
                return Some(t.clone());
            }
        }
        let flags = Self::tooth_flag(page) | if linear { 4 } else { 0 };
        let w = self.sheet_words(page, sheet, flags);
        let texture = device.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("drawn ground"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let tile = self.tile_or_grain(device, page);
        let empty = self.empty.clone();
        self.pass(
            device,
            &self.paper,
            &w,
            &tile,
            [&empty, &empty, &empty],
            &texture,
            [0, 0, size[0], size[1]],
        );
        self.last = Some((key, texture.clone()));
        Some(texture)
    }

    /// The ground's words.
    fn sheet_words(&self, page: &Page, sheet: &Sheet, flags: u32) -> Vec<[f32; 4]> {
        let f = |v: f64| v as f32;
        let rgb = |c: [f64; 3]| [f(c[0]), f(c[1]), f(c[2]), 1.0];
        let mut w = self.words(page, flags);
        w[3] = rgb(sheet.ground);
        let (cell, radius) = sheet.stain.map_or((0.0, 0.0), |(c, r, _)| (c, r));
        w[6] = [f(sheet.shade), f(cell), f(radius), 0.0];
        w[7] = [
            f(sheet.foxing),
            f(sheet.craquelure.0),
            f(sheet.craquelure.1),
            0.0,
        ];
        w[8] = [f(sheet.plate.0), f(sheet.plate.1), 0.0, 0.0];
        if let Some((_, _, c)) = sheet.stain {
            let e = rgb(c);
            w[10] = [e[0], e[1], e[2], 0.0];
        }
        if let Some((width, near, far)) = sheet.tarnish {
            w[9] = [f(width), 0.7, 0.0, 0.0];
            w[4] = rgb(near);
            w[5] = rgb(far);
        }
        let mut list = Vec::new();
        for (line, k) in &sheet.folds {
            list.push(line.map(f));
            list.push([f(k[0]), f(k[1]), 0.0, 0.0]);
        }
        for t in &sheet.tape {
            list.push(t.map(f));
        }
        w[12] = [
            sheet.folds.len() as u32,
            page.seed,
            sheet.tape.len() as u32,
            flags,
        ]
        .map(f32::from_bits);
        w[13..13 + list.len()].copy_from_slice(&list);
        w
    }

    /// `cover`, one item's coverage, laid through `m` into `into`, within `rect`. `soft` is that
    /// coverage blurred, `resist` what resists it; `places`, in 3D, each pixel's field position;
    /// `linear` a 3D layer's space.
    #[allow(clippy::too_many_arguments)]
    pub fn medium(
        &mut self,
        device: &Device,
        page: &Page,
        m: &Medium,
        cover: &wgpu::TextureView,
        soft: Option<&wgpu::TextureView>,
        resist: Option<&wgpu::TextureView>,
        linear: bool,
        into: &wgpu::Texture,
        rect: [u32; 4],
    ) {
        let f = |v: f64| v as f32;
        let flags = Self::tooth_flag(page) | if linear { 4 } else { 0 };
        let w = self.medium_words(page, m, flags);
        let tile = self.tile_or_grain(device, page);
        let empty = self.empty.clone();
        self.pass(
            device,
            &self.medium,
            &w,
            &tile,
            [cover, soft.unwrap_or(&self.grain), resist.unwrap_or(&empty)],
            into,
            rect,
        );
    }

    /// A medium's words, in the space `flags` names.
    fn medium_words(&self, page: &Page, m: &Medium, flags: u32) -> Vec<[f32; 4]> {
        let f = |v: f64| v as f32;
        let mut w = self.words(page, flags);
        let linear = flags & 4 != 0;
        let color = if linear {
            m.color.map(|c| f(deep_canvas::color::srgb_decode(c)))
        } else {
            m.color.map(f)
        };
        w[4] = [color[0], color[1], color[2], 1.0];
        w[5] = m.bounds.map(f);
        let (kind_words, list) = words(m);
        w[6..10].copy_from_slice(&kind_words);
        w[10][3] = f(m.dry);
        let seed = m.seed;
        let shift = |k: u32| f(seeded(u64::from(seed), "shift", k) * 400.0);
        w[11] = [m.pressure.map_or(-1.0, f), 0.0, shift(0), shift(1)];
        w[12] = [m.kind.number(), seed, list.len() as u32, flags].map(f32::from_bits);
        let room = 64.min(list.len());
        w[13..13 + room].copy_from_slice(&list[..room]);
        w
    }

    /// The layer `cover` shaded by the page's relief into `into`.
    pub fn relief(
        &mut self,
        device: &Device,
        page: &Page,
        cover: &wgpu::TextureView,
        into: &wgpu::Texture,
    ) {
        let Some((own, strength)) = page.relief else {
            return;
        };
        let mut w = self.words(page, Self::tooth_flag(page));
        w[11][1] = strength as f32;
        w[12][0] = f32::from_bits(u32::from(own));
        let size = [page.size[0] as u32, page.size[1] as u32];
        let tile = self.tile_or_grain(device, page);
        let empty = self.empty.clone();
        self.pass(
            device,
            &self.relief,
            &w,
            &tile,
            [cover, &empty, &empty],
            into,
            [0, 0, size[0], size[1]],
        );
    }

    /// `from` resampled into `into`, a target of any size.
    pub fn blit(
        &mut self,
        device: &Device,
        page: &Page,
        from: &wgpu::TextureView,
        into: &wgpu::Texture,
    ) {
        let size = into.size();
        let mut w = self.words(page, 0);
        w[0] = [0.0, size.width as f32, size.height as f32, 1.0];
        let tile = self.grain.clone();
        let empty = self.empty.clone();
        self.pass(
            device,
            &self.blit,
            &w,
            &tile,
            [&empty, from, &empty],
            into,
            [0, 0, size.width, size.height],
        );
    }
}

/// The 3D passes, made on the first drawn frame in depth.
struct Three {
    layout: wgpu::BindGroupLayout,
    copy: wgpu::RenderPipeline,
    paper: wgpu::RenderPipeline,
    medium: wgpu::RenderPipeline,
    target: wgpu::RenderPipeline,
}

/// A rim on a surface: its direction toward it, how strong and its color, linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rim3 {
    pub toward: [f64; 3],
    pub amount: f64,
    pub color: [f64; 3],
}

/// What a 3D frame lays over its lit surfaces.
#[derive(Clone, Debug, Default)]
pub struct Frame3 {
    pub page: Option<Page>,
    /// Each item's mediums, in draw order.
    pub mediums: Vec<(String, Medium)>,
    pub rims: Vec<(String, Rim3)>,
    /// Each target's name, resolution, and its items with what each writes.
    pub targets: Vec<Target3>,
}

/// A collection target in 3D, as an operator input reads it.
#[derive(Clone, Debug)]
pub struct Target3 {
    pub read: deep_canvas_effects::module::TargetRead,
    pub items: Vec<(String, f64)>,
}

/// One recorded 3D pass.
struct Recorded {
    pipeline: wgpu::RenderPipeline,
    groups: [wgpu::BindGroup; 2],
    into: wgpu::TextureView,
}

/// A 4 × 4 column-major matrix's inverse.
fn inverse(m: &[f64; 16]) -> [f32; 16] {
    let mut a = [[0.0f64; 8]; 4];
    for r in 0..4 {
        for c in 0..4 {
            a[r][c] = m[c * 4 + r];
        }
        a[r][4 + r] = 1.0;
    }
    for c in 0..4 {
        let p = (c..4)
            .max_by(|x, y| a[*x][c].abs().total_cmp(&a[*y][c].abs()))
            .unwrap_or(c);
        a.swap(c, p);
        let d = a[c][c];
        if d != 0.0 {
            a[c].iter_mut().for_each(|v| *v /= d);
        }
        for r in 0..4 {
            if r != c {
                let k = a[r][c];
                let row = a[c];
                a[r].iter_mut().zip(row).for_each(|(v, s)| *v -= k * s);
            }
        }
    }
    let mut out = [0.0f32; 16];
    for c in 0..4 {
        for r in 0..4 {
            out[c * 4 + r] = a[r][4 + c] as f32;
        }
    }
    out
}

impl Drawn {
    fn three(&mut self, device: &Device) {
        if self.three.is_some() {
            return;
        }
        let d = &device.device;
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("drawn 3d"),
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
                        sample_type: wgpu::TextureSampleType::Uint,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Depth,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipelines = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("drawn 3d"),
            bind_group_layouts: &[Some(&self.layout), Some(&layout)],
            immediate_size: 0,
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("drawn 3d"),
            source: wgpu::ShaderSource::Wgsl(include_str!("drawn.wgsl").into()),
        });
        let pipeline = |entry: &str| {
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("drawn 3d"),
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
                        format: wgpu::TextureFormat::Rgba16Float,
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
        self.three = Some(Three {
            copy: pipeline("copy3"),
            paper: pipeline("paper3"),
            medium: pipeline("medium3"),
            target: pipeline("target3"),
            layout,
        });
    }

    /// The bind group a 3D pass's second set takes.
    fn view3(
        &self,
        device: &Device,
        frame: &PostFrame<'_>,
        item: u32,
        rim: Option<&Rim3>,
    ) -> wgpu::BindGroup {
        let mut words: Vec<f32> = inverse(&frame.clip).to_vec();
        words.extend([
            frame.eye[0] as f32,
            frame.eye[1] as f32,
            frame.eye[2] as f32,
            1.0,
        ]);
        words.extend([item, 0, 0, 0].map(f32::from_bits));
        let (t, a, c) = rim.map_or(([0.0; 3], 0.0, [0.0; 3]), |r| (r.toward, r.amount, r.color));
        words.extend([t[0] as f32, t[1] as f32, t[2] as f32, a as f32]);
        words.extend([c[0] as f32, c[1] as f32, c[2] as f32, 1.0]);
        let bytes: Vec<u8> = words.iter().flat_map(|v| v.to_le_bytes()).collect();
        let d = &device.device;
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("drawn 3d"),
            contents: &bytes,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let three = self.three.as_ref().expect("made first");
        d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("drawn 3d"),
            layout: &three.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(frame.ids),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(frame.depth),
                },
            ],
        })
    }

    /// The 3D frame's passes, recorded later on its encoder, over the target `scratch`, which goes
    /// back to the linear target once they're done.
    pub fn job3(
        &mut self,
        device: &Device,
        f3: &Frame3,
        frame: &PostFrame<'_>,
        scratch: &wgpu::Texture,
        targets: &[(wgpu::Texture, String, f64)],
    ) -> Option<Job> {
        let page = f3.page.as_ref()?;
        self.three(device);
        let d = &device.device;
        let flags = Self::tooth_flag(page) | 2 | 4;
        let tile = self.tile_or_grain(device, page);
        let (grain, empty) = (self.grain.clone(), self.empty.clone());
        let three = self.three.as_ref().expect("made above");
        let out = view_of(scratch);
        let (copy, paper3, medium3, target3) = (
            three.copy.clone(),
            three.paper.clone(),
            three.medium.clone(),
            three.target.clone(),
        );
        let mut ground = self.ground3_words(page, flags);
        ground[12][3] = f32::from_bits(flags);
        let base = |this: &Drawn, w: &[[f32; 4]], cover: &wgpu::TextureView| {
            this.bind(d, w, &tile, [cover, &grain, &empty])
        };
        let mut passes = vec![Recorded {
            pipeline: copy,
            groups: [
                base(self, &ground, frame.linear),
                self.view3(device, frame, 0, None),
            ],
            into: out.clone(),
        }];
        if page.sheet.is_some() {
            passes.push(Recorded {
                pipeline: paper3,
                groups: [
                    base(self, &ground, frame.linear),
                    self.view3(device, frame, 0, None),
                ],
                into: out.clone(),
            });
        }
        let surface = page.sheet.as_ref().map_or([1.0; 3], |s| s.ground);
        for (item, m) in &f3.mediums {
            let Some(id) = frame.picks.get(item) else {
                continue;
            };
            let mut w = self.medium_words(page, m, flags);
            w[3] = [
                deep_canvas::color::srgb_decode(surface[0]) as f32,
                deep_canvas::color::srgb_decode(surface[1]) as f32,
                deep_canvas::color::srgb_decode(surface[2]) as f32,
                1.0,
            ];
            passes.push(Recorded {
                pipeline: medium3.clone(),
                groups: [
                    base(self, &w, frame.linear),
                    self.view3(device, frame, *id, None),
                ],
                into: out.clone(),
            });
        }
        for (item, rim) in &f3.rims {
            let Some(id) = frame.picks.get(item) else {
                continue;
            };
            let mut w = ground.clone();
            w[12][0] = f32::from_bits(8);
            passes.push(Recorded {
                pipeline: medium3.clone(),
                groups: [
                    base(self, &w, frame.linear),
                    self.view3(device, frame, *id, Some(rim)),
                ],
                into: out.clone(),
            });
        }
        let mut clears = Vec::new();
        for (t, item, value) in targets {
            let view = view_of(t);
            clears.push(view.clone());
            let Some(id) = frame.picks.get(item) else {
                continue;
            };
            let mut w = ground.clone();
            w[11][0] = *value as f32;
            passes.push(Recorded {
                pipeline: target3.clone(),
                groups: [
                    base(self, &w, frame.linear),
                    self.view3(device, frame, *id, None),
                ],
                into: view,
            });
        }
        let (linear, source) = (frame.linear.texture().clone(), scratch.clone());
        let size = frame.size;
        Some(Box::new(move |encoder| {
            for view in &clears {
                let _ = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("drawn target clear"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
            }
            for p in &passes {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("drawn 3d"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &p.into,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                });
                pass.set_pipeline(&p.pipeline);
                pass.set_bind_group(0, &p.groups[0], &[]);
                pass.set_bind_group(1, &p.groups[1], &[]);
                pass.draw(0..3, 0..1);
            }
            encoder.copy_texture_to_texture(
                source.as_image_copy(),
                linear.as_image_copy(),
                wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
            );
        }))
    }

    /// The ground's words in a 3D frame.
    fn ground3_words(&self, page: &Page, flags: u32) -> Vec<[f32; 4]> {
        match &page.sheet {
            Some(sheet) => self.sheet_words(page, sheet, flags),
            None => self.words(page, flags),
        }
    }
}

/// The pass a 3D frame's mediums and paper run as.
pub const DRAWN_PASS: &str = "drawn.surfaces";

/// The 3D frame's passes around the shipped effects: its mediums and paper first, on the lit
/// surfaces, then the chain.
pub struct Post3 {
    pub inner: Box<dyn Post>,
    pub frame: Arc<std::sync::Mutex<Frame3>>,
    pub fx: Arc<std::sync::Mutex<deep_effects_render::frame::Effects>>,
    drawn: Option<Drawn>,
    scratch: Option<wgpu::Texture>,
    targets: BTreeMap<(String, String), wgpu::Texture>,
}

impl Post3 {
    pub fn new(
        inner: Box<dyn Post>,
        frame: Arc<std::sync::Mutex<Frame3>>,
        fx: Arc<std::sync::Mutex<deep_effects_render::frame::Effects>>,
    ) -> Post3 {
        Post3 {
            inner,
            frame,
            fx,
            drawn: None,
            scratch: None,
            targets: BTreeMap::new(),
        }
    }
}

fn color_target(device: &Device, size: [u32; 2], label: &'static str) -> wgpu::Texture {
    device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    })
}

impl Post for Post3 {
    fn sources(&mut self, device: &Device) -> Vec<deep_scene3d_render::cull::Source> {
        self.inner.sources(device)
    }

    fn passes(&self) -> Vec<deep_gpu::render::Pass> {
        use deep_gpu::render::{Determinism, Pass, Resolution};
        let mut out = self.inner.passes();
        out.push(Pass {
            name: DRAWN_PASS.into(),
            place: "effects",
            order: 0,
            reads: vec!["linear", "depth", "ids"],
            writes: vec!["linear"],
            resolution: Resolution::Full,
            ns_per_px: 0.2,
            determinism: Determinism::SameMachine,
        });
        out
    }

    fn shadows(&self) -> bool {
        self.inner.shadows()
    }

    fn jobs(
        &mut self,
        device: &Device,
        frame: &PostFrame<'_>,
    ) -> (Vec<(String, Job)>, Option<wgpu::TextureView>) {
        let f3 = self.frame.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut first = None;
        if f3.page.is_some() {
            let drawn = self.drawn.get_or_insert_with(|| Drawn::new(device));
            let same = self
                .scratch
                .as_ref()
                .is_some_and(|t| t.width() == frame.size[0] && t.height() == frame.size[1]);
            if !same {
                self.scratch = Some(color_target(device, frame.size, "drawn scratch"));
            }
            let mut targets = Vec::new();
            let mut views = BTreeMap::new();
            for t in &f3.targets {
                let half = t.read.half;
                let size = if half {
                    [frame.size[0].div_ceil(2), frame.size[1].div_ceil(2)]
                } else {
                    frame.size
                };
                let key = (t.read.collection.clone(), t.read.output.clone());
                let texture = self
                    .targets
                    .entry(key.clone())
                    .or_insert_with(|| color_target(device, size, "collection target"))
                    .clone();
                views.insert(
                    (
                        format!("{}{}", deep_canvas_effects::graph::COLLECTION, key.0),
                        key.1,
                    ),
                    view_of(&texture),
                );
                for (item, value) in &t.items {
                    targets.push((texture.clone(), item.clone(), *value));
                }
            }
            if let Some(ops) = self
                .fx
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .docops
                .as_mut()
            {
                ops.collections = views;
            }
            let scratch = self.scratch.as_ref().expect("made above");
            first = drawn.job3(device, &f3, frame, scratch, &targets);
        }
        let (mut jobs, source) = self.inner.jobs(device, frame);
        if let Some(job) = first {
            jobs.insert(0, (DRAWN_PASS.into(), job));
        }
        (jobs, source)
    }
}

/// What a drawing look lays over this frame's surfaces.
pub fn frame3(
    doc: &Value,
    look3: &deep_canvas_scene3d::look::Look3,
    assets: &Map<String, Value>,
    scene: &deep_canvas_scene3d::scene::Scene,
    planted: Option<crate::Planted>,
) -> Result<Frame3, Value> {
    let Some(look) = look3.drawn.as_ref() else {
        return Ok(Frame3::default());
    };
    let refuse = |r: deep_canvas_marks::scene::Refused| refused(r.code, r.path);
    let Value::Object(doc) = doc else {
        return Err(refused("bad_input", "doc"));
    };
    let roles: BTreeMap<String, [f64; 3]> = look3
        .roles
        .iter()
        .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
        .collect();
    let page = Page::of(look, &View::NONE, doc, &roles, assets)?;
    let empty = Map::new();
    let dress = deep_canvas_marks::drawn::Dress {
        look,
        doc,
        items: &empty,
        palette: &look3.roles,
        first_rim: planted == Some(crate::Planted::RimKeepsFirst),
        flat_ink: planted == Some(crate::Planted::InkFillFlat),
    };
    let mut frame = Frame3 {
        page: Some(page),
        ..Frame3::default()
    };
    let solids = scene.layers.iter().flat_map(|l| &l.solids);
    for solid in solids {
        let id = &solid.id;
        let Some(Value::Object(paint)) = scene.painted.get(id) else {
            continue;
        };
        let color = solid.color.map(|v| f64::from(v) / 255.0);
        let medium =
            deep_canvas_marks::drawn::surface_medium(&dress, id, paint, color).map_err(refuse)?;
        frame.mediums.extend(medium.map(|m| (id.clone(), m)));
        let strokes =
            deep_canvas_marks::drawn::strokes_medium(&dress, id, [0.0; 4]).map_err(refuse)?;
        frame.mediums.extend(strokes.map(|m| (id.clone(), m)));
        for (k, rim) in look.light.iter().flat_map(|l| &l.rims).enumerate() {
            if dress.first_rim && k > 0 {
                continue;
            }
            let on = rim.on.as_deref();
            if on.is_some_and(|c| !deep_canvas_marks::drawn::members(doc, c).contains(&id.as_str()))
            {
                continue;
            }
            let toward = direction(
                rim.dir
                    .unwrap_or(look.light.as_ref().map_or(135.0, |l| l.dir)),
            );
            let color = roles.get(&rim.role).copied().unwrap_or([1.0; 3]);
            frame.rims.push((
                id.clone(),
                Rim3 {
                    toward: [toward[0], -toward[1], 0.0],
                    amount: rim.width,
                    color: color.map(deep_canvas::color::srgb_decode),
                },
            ));
        }
    }
    for item in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
    {
        if item["kind"] != "gpu.pass@1" {
            continue;
        }
        for read in deep_canvas_effects::module::target_reads(&item["params"]) {
            let members = deep_canvas_marks::drawn::members(doc, &read.collection);
            let items = members
                .iter()
                .map(|m| {
                    let fill = scene.painted.get(*m).and_then(|p| p.pointer("/fill/fill"));
                    let named = fill
                        .and_then(Value::as_str)
                        .and_then(|n| look.fill(n).ok().flatten());
                    let pressure = named.and_then(|f| f.pressure).unwrap_or(1.0);
                    (
                        m.to_string(),
                        if read.output == "pressure" {
                            pressure
                        } else {
                            1.0
                        },
                    )
                })
                .collect();
            frame.targets.push(Target3 { read, items });
        }
    }
    Ok(frame)
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_passes_shader_validates() {
        deep_effects_render::compile::validate(include_str!("drawn.wgsl")).unwrap();
    }
}
