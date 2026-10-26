//! The test canvas module `test.gpu`, drawn (issue #379, tests/acceptance/379/README.md: The
//! test canvas module; `test-meter` builds only). `test.texture@1` and `test.mesh@1` are results
//! keyed by their content keys, made once on the device however many revisions read them;
//! `test.burn@1` is the operator `test.burn`, a pass into an effect target at its resolution
//! that the composite adds into the linear target. Its declared cost is per pixel and ignores
//! `loops`, so the meter, not the check, catches a heavy one.

use std::collections::BTreeMap;
use std::path::PathBuf;

use deep_canvas_test_modules::TEST_BURN;
use deep_gpu::alloc::outside;
use deep_gpu::cache::Cache;
use deep_gpu::device::Device;
use deep_gpu::memory;
use deep_scene3d_render::LINEAR;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::liveview::{full_pass, Kit, Timer};

const SHADER: &str = include_str!("testgpu.wgsl");
const BURN: &str = include_str!("burn.wgsl");
pub const DRAW: &str = deep_canvas_test_modules::TEST_GPU_DRAW;
pub const COMPOSITE: &str = "test.burn.composite";
/// `test.burn`'s declared cost: ns per pixel shaded, whatever its loops.
pub const BURN_NS_PER_PX: f64 = 0.05;

/// A result one revision reads, by content key.
#[derive(Clone, Debug)]
pub enum Need {
    Texture {
        size: [u32; 2],
        pattern: String,
    },
    Mesh {
        vertices: u32,
        seed: String,
        asset: Option<String>,
    },
}

/// What a test item draws: its result's key and where.
#[derive(Clone, Debug)]
pub struct Placed {
    pub key: String,
    pub need: Need,
    pub at: [f32; 3],
}

/// The test items of a stamped document, with their results' keys; and its burn's loops.
pub fn items(doc: &Value) -> Result<(Vec<Placed>, Option<u32>), String> {
    let mut out = Vec::new();
    let mut burn = None;
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return Ok((out, burn));
    };
    for (id, item) in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let p = &item["params"];
        let pos = item["at"]["pos"].as_array();
        let at = |k: usize| {
            pos.and_then(|p| p.get(k))
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as f32
        };
        let at = [at(0), at(1), at(2)];
        let bad = |what: &str| format!("items/{id}/params/{what}");
        match kind {
            "test.texture@1" => {
                let size = p["size"]
                    .as_array()
                    .filter(|s| s.len() == 2)
                    .ok_or(bad("size"))?;
                let n = |v: &Value| {
                    v.as_u64()
                        .and_then(|n| u32::try_from(n).ok())
                        .filter(|n| (1..=8192).contains(n))
                };
                let size = [
                    n(&size[0]).ok_or(bad("size"))?,
                    n(&size[1]).ok_or(bad("size"))?,
                ];
                let pattern = p["pattern"].as_str().unwrap_or("").to_string();
                let key = format!("test.texture@1|{}x{}|rgba8|all|{pattern}", size[0], size[1]);
                out.push(Placed {
                    key: hex(key.as_bytes()),
                    need: Need::Texture { size, pattern },
                    at,
                });
            }
            "test.mesh@1" => {
                let vertices = p["vertices"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .filter(|n| (3..=4_000_000).contains(n))
                    .ok_or(bad("vertices"))?;
                let seed = p["seed"].as_str().unwrap_or("").to_string();
                let asset = p["asset"]
                    .as_str()
                    .filter(|a| !a.is_empty())
                    .map(str::to_string);
                let key = format!(
                    "test.mesh@1|{vertices}|{seed}|{}",
                    asset.as_deref().unwrap_or("")
                );
                out.push(Placed {
                    key: hex(key.as_bytes()),
                    need: Need::Mesh {
                        vertices,
                        seed,
                        asset,
                    },
                    at,
                });
            }
            "test.burn@1" => {
                let loops = p["loops"]
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok())
                    .ok_or(bad("loops"))?;
                burn = Some(burn.unwrap_or(0) + loops);
            }
            _ => {}
        }
    }
    Ok((out, burn))
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A splitmix64 stream from a text seed.
fn stream(seed: &str, salt: u64) -> impl FnMut() -> u64 {
    let digest = Sha256::digest(seed.as_bytes());
    let mut state = u64::from_le_bytes(digest[..8].try_into().expect("8 bytes")) ^ salt;
    move || {
        state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// A result on the device.
pub enum Made {
    Texture(wgpu::BindGroup),
    Mesh(wgpu::Buffer, u32),
}

/// What `test.gpu` shares across views: its pipelines and layouts.
pub struct Pipes {
    frame: wgpu::BindGroupLayout,
    texture: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    quad: wgpu::RenderPipeline,
    mesh: wgpu::RenderPipeline,
    burn: wgpu::RenderPipeline,
}

impl Pipes {
    pub fn new(device: &Device) -> Pipes {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("test.gpu"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let burn = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(TEST_BURN),
            source: wgpu::ShaderSource::Wgsl(BURN.into()),
        });
        let uniform = |visibility| wgpu::BindGroupLayoutEntry {
            binding: 0,
            visibility,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        let frame = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("test.gpu frame"),
            entries: &[uniform(wgpu::ShaderStages::VERTEX_FRAGMENT)],
        });
        let texture = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("test.gpu texture"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("test.gpu"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        let at = wgpu::VertexBufferLayout {
            array_stride: 16,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &[wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 0,
                shader_location: 1,
            }],
        };
        let points = wgpu::VertexBufferLayout {
            array_stride: 16,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &[wgpu::VertexAttribute {
                format: wgpu::VertexFormat::Float32x4,
                offset: 0,
                shader_location: 0,
            }],
        };
        let build = |label,
                     module: &wgpu::ShaderModule,
                     layouts: &[Option<&wgpu::BindGroupLayout>],
                     vs,
                     fs,
                     buffers: &[Option<wgpu::VertexBufferLayout>]| {
            let layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(label),
                bind_group_layouts: layouts,
                immediate_size: 0,
            });
            d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module,
                    entry_point: Some(vs),
                    compilation_options: Default::default(),
                    buffers,
                },
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                fragment: Some(wgpu::FragmentState {
                    module,
                    entry_point: Some(fs),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: LINEAR,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                }),
                multiview_mask: None,
                cache: None,
            })
        };
        Pipes {
            quad: build(
                "test.texture",
                &module,
                &[Some(&frame), Some(&texture)],
                "quad_vs",
                "quad_fs",
                &[None, Some(at.clone())],
            ),
            mesh: build(
                "test.mesh",
                &module,
                &[Some(&frame)],
                "mesh_vs",
                "mesh_fs",
                &[Some(points), Some(at)],
            ),
            burn: build(TEST_BURN, &burn, &[Some(&frame)], "full", "burn_fs", &[]),
            frame,
            texture,
            sampler,
        }
    }

    /// Makes `need`'s result on the device, with the size the device reports for it; a mesh read
    /// from an asset whose bytes don't match their sha256 fails.
    pub fn make(
        &self,
        device: &Device,
        need: &Need,
        assets: &BTreeMap<String, PathBuf>,
    ) -> Result<(Made, Option<u64>), String> {
        match need {
            Need::Texture { size, pattern } => {
                let levels = 32 - size[0].max(size[1]).leading_zeros();
                let texture = device.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("test.texture"),
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: levels,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    view_formats: &[],
                });
                for level in 0..levels {
                    let (w, h) = ((size[0] >> level).max(1), (size[1] >> level).max(1));
                    let mut next = stream(pattern, u64::from(level));
                    let mut bytes = vec![0u8; (w * h * 4) as usize];
                    for chunk in bytes.chunks_mut(8) {
                        let v = next().to_le_bytes();
                        chunk.copy_from_slice(&v[..chunk.len()]);
                    }
                    device.queue.write_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &texture,
                            mip_level: level,
                            origin: wgpu::Origin3d::ZERO,
                            aspect: wgpu::TextureAspect::All,
                        },
                        &bytes,
                        wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(w * 4),
                            rows_per_image: Some(h),
                        },
                        wgpu::Extent3d {
                            width: w,
                            height: h,
                            depth_or_array_layers: 1,
                        },
                    );
                }
                let bytes = memory::texture(device, &texture);
                let view = texture.create_view(&Default::default());
                let bind = device.device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("test.texture"),
                    layout: &self.texture,
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&view),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::Sampler(&self.sampler),
                        },
                    ],
                });
                Ok((Made::Texture(bind), bytes))
            }
            Need::Mesh {
                vertices,
                seed,
                asset,
            } => {
                let data = match asset {
                    Some(sha) => {
                        let path = assets
                            .get(sha)
                            .ok_or(format!("asset {sha} isn't in the store"))?;
                        let bytes = std::fs::read(path).map_err(|e| format!("asset {sha}: {e}"))?;
                        if hex(&bytes) != *sha {
                            return Err(format!("asset {sha}: its bytes fail their sha256"));
                        }
                        if bytes.len() < *vertices as usize * 16 {
                            return Err(format!("asset {sha}: too short for {vertices} vertices"));
                        }
                        bytes[..*vertices as usize * 16].to_vec()
                    }
                    None => {
                        let mut next = stream(seed, 0);
                        let mut out = Vec::with_capacity(*vertices as usize * 16);
                        for _ in 0..*vertices {
                            for k in 0..4 {
                                let unit = (next() >> 11) as f64 / (1u64 << 53) as f64;
                                let v = if k < 3 { unit - 0.5 } else { unit } as f32;
                                out.extend_from_slice(&v.to_le_bytes());
                            }
                        }
                        out
                    }
                };
                let (buffer, bytes) = memory::buffer(
                    device,
                    "test.mesh",
                    data.len() as u64,
                    wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                );
                device.queue.write_buffer(&buffer, 0, &data);
                Ok((Made::Mesh(buffer, *vertices), bytes))
            }
        }
    }
}

/// What a frame draws the test items with.
pub struct Frame {
    pub clip: [[f64; 4]; 4],
    pub internal: [u32; 2],
    pub lod_down: bool,
    pub effects: bool,
    /// The effect's resolution against the internal size.
    pub resolution: f64,
}

struct Effect {
    size: [u32; 2],
    view: wgpu::TextureView,
    bind: wgpu::BindGroup,
    bytes: Option<u64>,
}

/// One view's test items: their results' handles, an instance buffer of their places, and its
/// burn's uniform and effect target.
#[derive(Default)]
pub struct Items {
    draws: Vec<(Made, u32)>,
    loops: Option<u32>,
    gpu: Option<(
        wgpu::Buffer,
        wgpu::BindGroup,
        wgpu::Buffer,
        wgpu::BindGroup,
        wgpu::Buffer,
    )>,
    gpu_bytes: Option<u64>,
    effect: Option<Effect>,
}

impl Items {
    /// The current revision's items, their results read from `results`.
    pub fn set(
        &mut self,
        device: &Device,
        kit: &Kit,
        placed: &[Placed],
        loops: Option<u32>,
        results: &Cache<Made>,
    ) {
        let pipes = &kit.test;
        self.draws.clear();
        let mut at = Vec::new();
        for (i, p) in placed.iter().enumerate() {
            let Some(made) = results.get(&p.key) else {
                continue;
            };
            let made = match made {
                Made::Texture(b) => Made::Texture(b.clone()),
                Made::Mesh(b, n) => Made::Mesh(b.clone(), *n),
            };
            self.draws.push((made, i as u32));
            at.extend_from_slice(bytemuck::cast_slice(&[p.at[0], p.at[1], p.at[2], 1.0]));
        }
        self.loops = loops;
        if self.gpu.is_none() {
            let (gpu, bytes) = memory::across(device, || {
                let d = &device.device;
                let uniform = |label, size| {
                    d.create_buffer(&wgpu::BufferDescriptor {
                        label: Some(label),
                        size,
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                        mapped_at_creation: false,
                    })
                };
                let frame = uniform("test.gpu frame", 64);
                let burn = uniform("test.burn loops", 16);
                let bind = |buffer: &wgpu::Buffer| {
                    d.create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("test.gpu"),
                        layout: &pipes.frame,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: buffer.as_entire_binding(),
                        }],
                    })
                };
                let (frame_bind, burn_bind) = (bind(&frame), bind(&burn));
                let places = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("test.gpu places"),
                    size: 16 * 64,
                    usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                (frame, frame_bind, burn, burn_bind, places)
            });
            self.gpu = Some(gpu);
            self.gpu_bytes = bytes;
        }
        if let Some((_, _, burn, _, places)) = &self.gpu {
            if !at.is_empty() {
                device
                    .queue
                    .write_buffer(places, 0, &at[..at.len().min(16 * 64)]);
            }
            device.queue.write_buffer(
                burn,
                0,
                bytemuck::cast_slice(&[loops.unwrap_or(0), 0, 0, 0]),
            );
        }
    }

    pub fn bytes(&self) -> Option<u64> {
        let effect = self.effect.as_ref().map_or(Some(0), |e| e.bytes);
        let gpu = if self.gpu.is_some() {
            self.gpu_bytes
        } else {
            Some(0)
        };
        Some(gpu? + effect?)
    }

    /// The items' pass into the linear target, then the burn into its effect target and the
    /// composite that adds it in.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        device: &Device,
        kit: &Kit,
        frame: &Frame,
        encoder: &mut wgpu::CommandEncoder,
        linear: &wgpu::TextureView,
        timer: &mut Timer,
        session: usize,
    ) {
        let Some((frame_buffer, frame_bind, _, burn_bind, places)) = &self.gpu else {
            return;
        };
        let pipes = &kit.test;
        let mut clip = [[0f32; 4]; 4];
        for (r, row) in frame.clip.iter().enumerate() {
            for (c, v) in row.iter().enumerate() {
                clip[c][r] = *v as f32;
            }
        }
        if !self.draws.is_empty() {
            outside(|| {
                device
                    .queue
                    .write_buffer(frame_buffer, 0, bytemuck::cast_slice(&clip))
            });
            let i = timer.start(DRAW, session);
            outside(|| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(DRAW),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: linear,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Load,
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    timestamp_writes: timer.writes(i),
                    ..Default::default()
                });
                pass.set_bind_group(0, frame_bind, &[]);
                pass.set_vertex_buffer(1, places.slice(..));
                for (made, k) in &self.draws {
                    match made {
                        Made::Texture(bind) => {
                            pass.set_pipeline(&pipes.quad);
                            pass.set_bind_group(1, bind, &[]);
                            pass.draw(0..6, *k..k + 1);
                        }
                        Made::Mesh(buffer, n) => {
                            let n = if frame.lod_down { n / 2 } else { *n };
                            pass.set_pipeline(&pipes.mesh);
                            pass.set_vertex_buffer(0, buffer.slice(..));
                            pass.draw(0..n / 3 * 3, *k..k + 1);
                        }
                    }
                }
            });
            timer.end(i);
        }
        if self.loops.is_none() || !frame.effects {
            return;
        }
        let size = crate::liveview::scaled(frame.internal, frame.resolution);
        if self.effect.as_ref().is_none_or(|e| e.size != size) {
            let (texture, bytes) = memory::across(device, || {
                device.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("test.burn effect"),
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: LINEAR,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                })
            });
            let view = texture.create_view(&Default::default());
            self.effect = Some(Effect {
                size,
                bind: kit.bind_source(device, &view),
                view,
                bytes,
            });
        }
        let effect = self.effect.as_ref().expect("made above");
        let i = timer.start(TEST_BURN, session);
        full_pass(
            encoder,
            TEST_BURN,
            &effect.view,
            &pipes.burn,
            burn_bind,
            false,
            timer.writes(i),
        );
        timer.end(i);
        let i = timer.start(COMPOSITE, session);
        full_pass(
            encoder,
            COMPOSITE,
            linear,
            &kit.composite,
            &effect.bind,
            true,
            timer.writes(i),
        );
        timer.end(i);
    }

    /// The pixels the burn shaded last frame.
    pub fn effect_px(&self) -> Option<u64> {
        let e = self.effect.as_ref().filter(|_| self.loops.is_some())?;
        Some(u64::from(e.size[0]) * u64::from(e.size[1]))
    }
}
