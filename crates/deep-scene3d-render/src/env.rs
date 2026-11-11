//! The environment (#422; canvas primitives: Sky `sky@1`: environment): an equirectangular
//! radiance image, prefiltered once per key into a cube whose mip m holds the GGX lobe at
//! roughness m ÷ (mips − 1) (env.wgsl), and projected into nine irradiance coefficients. The
//! solids read both through the lights' bind group; nothing here is rebuilt while the key holds.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::sky::{Sky, Source};
use deep_gpu::device::Device;

use crate::{bind_group, buffer_entry, pipeline, target};

const SHADER: &str = include_str!("env.wgsl");
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// Samples per texel for every mip above the first.
const SAMPLES: u32 = 256;
/// The smallest mip's face, in px.
const SMALLEST: u32 = 8;

/// Linear radiance over the sphere, `size[0]` across (u from −Z turning toward +X) by `size[1]`
/// down (from the zenith), rows top first.
#[derive(Clone, Debug, PartialEq)]
pub struct Equirect {
    pub size: [u32; 2],
    pub rgb: Vec<[f32; 3]>,
}

impl Equirect {
    /// The direction at pixel (x, y)'s center.
    pub fn dir(&self, x: u32, y: u32) -> [f64; 3] {
        let u = (f64::from(x) + 0.5) / f64::from(self.size[0]);
        let v = (f64::from(y) + 0.5) / f64::from(self.size[1]);
        let phi = (u - 0.5) * std::f64::consts::TAU;
        let theta = v * std::f64::consts::PI;
        [
            theta.sin() * phi.sin(),
            theta.cos(),
            -theta.sin() * phi.cos(),
        ]
    }

    /// The image made by `f` of each pixel's direction.
    pub fn from_fn(size: [u32; 2], f: impl Fn([f64; 3]) -> [f64; 3]) -> Equirect {
        let mut e = Equirect {
            size,
            rgb: Vec::with_capacity((size[0] * size[1]) as usize),
        };
        for y in 0..size[1] {
            for x in 0..size[0] {
                let c = f(e.dir(x, y));
                e.rgb.push([c[0] as f32, c[1] as f32, c[2] as f32]);
            }
        }
        e
    }

    /// Half the size, each pixel the mean of the area it covers (#426): on an odd side each
    /// covers a little over two source pixels, partly, so no row or column is dropped and the
    /// level stays where its source was (the blurred background mirrors about its horizon).
    fn half(&self) -> Equirect {
        let [w, h] = self.size;
        let (nw, nh) = ((w / 2).max(1), (h / 2).max(1));
        // Along one side of `n` pixels into `m`: each target's (source, weight) pairs.
        let spans = |n: u32, m: u32| -> Vec<Vec<(usize, f32)>> {
            let k = f64::from(n) / f64::from(m);
            (0..m)
                .map(|i| {
                    let (a, b) = (f64::from(i) * k, f64::from(i + 1) * k);
                    (a.floor() as u32..(b.ceil() as u32).min(n))
                        .filter_map(|s| {
                            let o = b.min(f64::from(s + 1)) - a.max(f64::from(s));
                            (o > 0.0).then_some((s as usize, (o / k) as f32))
                        })
                        .collect()
                })
                .collect()
        };
        let (xs, ys) = (spans(w, nw), spans(h, nh));
        let mut rgb = Vec::with_capacity((nw * nh) as usize);
        for ry in &ys {
            for rx in &xs {
                let mut c = [0f32; 3];
                for &(sy, wy) in ry {
                    for &(sx, wx) in rx {
                        let p = self.rgb[sy * w as usize + sx];
                        for i in 0..3 {
                            c[i] += p[i] * wx * wy;
                        }
                    }
                }
                rgb.push(c);
            }
        }
        Equirect {
            size: [nw, nh],
            rgb,
        }
    }
}

/// The nine real spherical-harmonic basis functions at unit `d`.
fn basis(d: [f64; 3]) -> [f64; 9] {
    let [x, y, z] = d;
    [
        0.282_095,
        0.488_603 * y,
        0.488_603 * z,
        0.488_603 * x,
        1.092_548 * x * y,
        1.092_548 * y * z,
        0.315_392 * (3.0 * z * z - 1.0),
        1.092_548 * x * z,
        0.546_274 * (x * x - y * y),
    ]
}

/// The irradiance ÷ π the environment gives a surface facing each direction, as nine
/// coefficients over [`basis`] (Ramamoorthi and Hanrahan): radiance projected with each pixel's
/// solid angle, normalized so the weights sum to 4π, then convolved with the clamped cosine.
pub fn sh9(e: &Equirect) -> [[f32; 4]; 9] {
    let mut l = [[0f64; 3]; 9];
    let mut total = 0.0;
    let dphi = std::f64::consts::TAU / f64::from(e.size[0]);
    let dtheta = std::f64::consts::PI / f64::from(e.size[1]);
    for y in 0..e.size[1] {
        // The row's exact solid angle, shared by its pixels.
        let w = ((f64::from(y) * dtheta).cos() - (f64::from(y + 1) * dtheta).cos()) * dphi;
        for x in 0..e.size[0] {
            let b = basis(e.dir(x, y));
            let c = e.rgb[(y * e.size[0] + x) as usize];
            for (k, bk) in b.iter().enumerate() {
                for i in 0..3 {
                    l[k][i] += f64::from(c[i]) * bk * w;
                }
            }
            total += w;
        }
    }
    let norm = 4.0 * std::f64::consts::PI / total;
    // Â_l ÷ π for bands 0, 1 and 2.
    let a = [1.0, 2.0 / 3.0, 0.25];
    let band = [0, 1, 1, 1, 2, 2, 2, 2, 2];
    let mut out = [[0f32; 4]; 9];
    for k in 0..9 {
        for i in 0..3 {
            out[k][i] = (l[k][i] * norm * a[band[k]]) as f32;
        }
    }
    out
}

/// Evaluates [`sh9`]'s coefficients facing `n`: the irradiance ÷ π there.
pub fn irradiance(c: &[[f32; 4]; 9], n: [f64; 3]) -> [f64; 3] {
    let b = basis(n);
    let mut out = [0.0; 3];
    for k in 0..9 {
        for i in 0..3 {
            out[i] += f64::from(c[k][i]) * b[k];
        }
    }
    out
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    at: [u32; 4],
    k: [f32; 4],
}

/// The prefiltered cube and what it was made from.
pub struct Cube {
    pub key: u64,
    pub view: wgpu::TextureView,
    pub mips: u32,
    /// How many of its mips hold their lobe (all, but for a planted wrong program).
    pub filled: u32,
    pub sh: [[f32; 4]; 9],
}

/// The prefilter's pipeline and the cubes it made.
pub struct Prefilter {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    /// How many cubes it has prefiltered: one per key change, never one a frame.
    pub builds: u32,
}

/// How many mips a cube of `size` px keeps: down to [`SMALLEST`] px.
pub fn mips(size: u32) -> u32 {
    let mut n = 1;
    let mut s = size;
    while s > SMALLEST {
        s /= 2;
        n += 1;
    }
    n
}

/// What the cubes [`Prefilter::build`] makes for `sky` hold (#2189): the lighting cube and its
/// mix's, every mip, and each blurred background's one mip.
pub fn bytes(sky: &Sky) -> u64 {
    let Some(e) = &sky.environment else {
        return 0;
    };
    let texel = u64::from(FORMAT.block_copy_size(None).unwrap_or(8));
    let cube = |size: u32, mips: u32| {
        (0..mips)
            .map(|m| u64::from((size >> m).max(1)).pow(2))
            .sum::<u64>()
            * 6
            * texel
    };
    let cubes = 1 + u64::from(e.mix.is_some());
    let blur = sky.background_blur as f32;
    let background = if blur > 0.0 {
        cube((e.size >> (blur * (mips(e.size) - 1) as f32) as u32).max(1), 1)
    } else {
        0
    };
    cubes * (cube(e.size, mips(e.size)) + background)
}

impl Prefilter {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Prefilter {
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d env prefilter"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d env prefilter"),
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
                buffer_entry(
                    2,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
            ],
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("scene3d env prefilter"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = pipeline(
            d,
            "scene3d env prefilter",
            Some(&pl),
            &module,
            ("vs", &[]),
            Some(("fs", &[target(FORMAT, None)])),
            None,
        );
        let sampler = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("scene3d env source"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Linear,
            ..Default::default()
        });
        Prefilter {
            layout,
            pipeline,
            sampler,
            builds: 0,
        }
    }

    /// Prefilters `source` into a cube of `size` px, keyed by `key`, on the GPU now: every mip,
    /// or the first `filled` (the rest left black). With `blur`, the background's own cube
    /// (#426): one mip holding the lobe at exactly that roughness, at the size of the lighting
    /// cube's mip at or below it, which lighting never reads and `builds` doesn't count.
    pub fn build(
        &mut self,
        device: &Device,
        key: u64,
        source: &Equirect,
        size: u32,
        filled: Option<u32>,
        blur: Option<f32>,
    ) -> Cube {
        let d = &device.device;
        // The source with its mips, as half floats.
        let mut levels = vec![source.clone()];
        while levels
            .last()
            .is_some_and(|l| l.size[0] > 1 || l.size[1] > 1)
        {
            let next = levels.last().expect("one level").half();
            levels.push(next);
        }
        let src = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d env source"),
            size: wgpu::Extent3d {
                width: source.size[0],
                height: source.size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: levels.len() as u32,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        for (m, level) in levels.iter().enumerate() {
            let mut bytes = Vec::with_capacity(level.rgb.len() * 8);
            for c in &level.rgb {
                for v in [c[0], c[1], c[2], 1.0] {
                    bytes.extend_from_slice(&f32_to_f16(v).to_le_bytes());
                }
            }
            device.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &src,
                    mip_level: m as u32,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(level.size[0] * 8),
                    rows_per_image: Some(level.size[1]),
                },
                wgpu::Extent3d {
                    width: level.size[0],
                    height: level.size[1],
                    depth_or_array_layers: 1,
                },
            );
        }
        let src_view = src.create_view(&wgpu::TextureViewDescriptor::default());
        let (mips, size) = match blur {
            None => (mips(size), size),
            Some(r) => (1, (size >> (r * (mips(size) - 1) as f32) as u32).max(1)),
        };
        let filled = filled.unwrap_or(mips).min(mips);
        let cube = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d env cube"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 6,
            },
            mip_level_count: mips,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let mut encoder = d.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("scene3d env prefilter"),
        });
        // One uniform buffer per (face, mip): each draw reads its own.
        let mut keep = Vec::new();
        for m in 0..mips {
            let px = (size >> m).max(1);
            let rough = match blur {
                Some(r) => r,
                None if mips > 1 => m as f32 / (mips - 1) as f32,
                None => 0.0,
            };
            for face in 0..6u32 {
                if m >= filled {
                    continue;
                }
                // Lighting's lookups keep #422's level bias of 1; the background's take none,
                // since a wider lookup widens the lobe it shows (#426).
                let params = Params {
                    at: [face, m, u32::from(blur.is_none()), SAMPLES],
                    k: [
                        rough,
                        px as f32,
                        source.size[0] as f32,
                        source.size[1] as f32,
                    ],
                };
                let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("scene3d env params"),
                    size: std::mem::size_of::<Params>() as u64,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                device
                    .queue
                    .write_buffer(&buffer, 0, bytemuck::bytes_of(&params));
                let bind = bind_group(
                    d,
                    "scene3d env prefilter",
                    &self.layout,
                    [
                        wgpu::BindingResource::TextureView(&src_view),
                        wgpu::BindingResource::Sampler(&self.sampler),
                        buffer.as_entire_binding(),
                    ],
                );
                let view = cube.create_view(&wgpu::TextureViewDescriptor {
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_mip_level: m,
                    mip_level_count: Some(1),
                    base_array_layer: face,
                    array_layer_count: Some(1),
                    ..Default::default()
                });
                {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("scene3d env prefilter"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &view,
                            resolve_target: None,
                            depth_slice: None,
                            ops: wgpu::Operations {
                                load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                                store: wgpu::StoreOp::Store,
                            },
                        })],
                        ..Default::default()
                    });
                    pass.set_pipeline(&self.pipeline);
                    pass.set_bind_group(0, &bind, &[]);
                    pass.draw(0..3, 0..1);
                }
                keep.push((buffer, bind));
            }
        }
        device.queue.submit([encoder.finish()]);
        drop(keep);
        self.builds += u32::from(blur.is_none());
        Cube {
            key,
            view: cube.create_view(&wgpu::TextureViewDescriptor {
                dimension: Some(wgpu::TextureViewDimension::Cube),
                ..Default::default()
            }),
            mips,
            filled,
            sh: sh9(&levels[levels.iter().position(|l| l.size[0] <= 128).unwrap_or(0)]),
        }
    }

    /// A black 1 px cube with one mip, for frames with no environment.
    pub fn stub(d: &deep_gpu::counted::Wgpu) -> wgpu::TextureView {
        d.create_texture(&wgpu::TextureDescriptor {
            label: Some("scene3d env stub"),
            size: wgpu::Extent3d {
                width: 1,
                height: 1,
                depth_or_array_layers: 6,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: FORMAT,
            usage: wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor {
            dimension: Some(wgpu::TextureViewDimension::Cube),
            ..Default::default()
        })
    }
}

/// An f32 as an IEEE half, rounded to nearest.
pub fn f32_to_f16(v: f32) -> u16 {
    let bits = v.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exp = ((bits >> 23) & 0xff) as i32;
    let mant = bits & 0x7f_ffff;
    if exp == 0xff {
        return sign | 0x7c00 | if mant != 0 { 0x200 } else { 0 };
    }
    let e = exp - 127 + 15;
    if e >= 0x1f {
        return sign | 0x7c00;
    }
    if e <= 0 {
        if e < -10 {
            return sign;
        }
        let m = (mant | 0x80_0000) >> (1 - e);
        let round = (m >> 12) & 1;
        return sign | ((m >> 13) + round) as u16;
    }
    let m = mant >> 13;
    let round = (mant >> 12) & 1;
    sign | (((e as u32) << 10 | m) + round) as u16
}

/// The sky's gradient along `d` (#422): `low` at and below the horizon, `top` at the zenith,
/// rising with the square root of the elevation's sine; the stars and the moon over it. The
/// background pass draws the same function (scene3d's `sky.wgsl`).
pub fn sky_radiance(sky: &Sky, d: [f64; 3]) -> [f64; 3] {
    let t = d[1].max(0.0).sqrt();
    let mut c = [0, 1, 2].map(|i| sky.low[i] + (sky.top[i] - sky.low[i]) * t);
    if let Some([az, el, radius]) = sky.moon {
        let m = direction(az, el);
        let cos = d[0] * m[0] + d[1] * m[1] + d[2] * m[2];
        if cos >= radius.to_radians().cos() {
            // The moon's disk: about 2500 cd/m² ÷ the sky's exposure would wash out; drawn at
            // four times the top's brightest channel, at least 1.
            let k = sky.top.iter().fold(1f64, |a, b| a.max(*b * 4.0));
            c = [k * 0.95, k * 0.97, k];
        }
    }
    if sky.stars > 0.0 && d[1] > 0.0 {
        c = c.map(|v| v + star(d, sky.stars));
    }
    c
}

/// The unit direction at `azimuth` (from −Z turning toward +X) and `elevation`, in degrees.
pub fn direction(azimuth: f64, elevation: f64) -> [f64; 3] {
    let (a, e) = (azimuth.to_radians(), elevation.to_radians());
    [e.cos() * a.sin(), e.sin(), -e.cos() * a.cos()]
}

/// A star's light along `d`: a hashed point in a cell of a 512-cell-around grid on the sphere,
/// lit when its hash falls under `density`.
fn star(d: [f64; 3], density: f64) -> f64 {
    let n = 160.0;
    let cell = [(d[0] * n).floor(), (d[1] * n).floor(), (d[2] * n).floor()];
    let mut h: u32 = 0x9e37_79b9;
    for v in cell {
        h ^= (v as i32) as u32;
        h = h.wrapping_mul(0x85eb_ca6b);
        h ^= h >> 13;
    }
    let r = f64::from(h % 10_000) / 10_000.0;
    if r < density * 0.02 {
        0.5 + 2.0 * r / (density * 0.02).max(1e-9)
    } else {
        0.0
    }
}

/// The shipped neutral studio: a dim gray room, a lighter floor bounce, and two large soft
/// boxes overhead and to the front left, in linear radiance.
pub fn studio(d: [f64; 3]) -> [f64; 3] {
    let wall = 0.35 + 0.15 * d[1].max(0.0);
    let mut c = if d[1] < 0.0 { 0.25 } else { wall };
    let boxes: [([f64; 3], f64, f64); 2] = [
        ([0.0, 1.0, 0.0], 0.92, 6.0),
        ([-0.6, 0.5, -0.62], 0.95, 4.0),
    ];
    for (dir, cos, k) in boxes {
        let l = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
        let dot = (d[0] * dir[0] + d[1] * dir[1] + d[2] * dir[2]) / l;
        if dot > cos {
            c = k;
        }
    }
    [c; 3]
}

/// What the environment `from` names, as an equirectangular image.
pub fn source(sky: &Sky, from: &Source) -> Equirect {
    match from {
        Source::Sky => Equirect::from_fn([512, 256], |d| sky_radiance(sky, d)),
        Source::Studio => Equirect::from_fn([512, 256], studio),
        Source::Asset(_, bytes) => {
            bytes
                .as_deref()
                .and_then(|b| hdr(b))
                .unwrap_or_else(|| Equirect {
                    size: [2, 1],
                    rgb: vec![[0.0; 3]; 2],
                })
        }
    }
}

/// The key a cube is prefiltered by: what its source reads and its size.
pub fn key(sky: &Sky, from: &Source, size: u32) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    size.hash(&mut h);
    match from {
        Source::Sky => {
            0u8.hash(&mut h);
            for v in sky.top.iter().chain(&sky.low).chain(&[sky.stars]) {
                v.to_bits().hash(&mut h);
            }
            for v in sky.moon.iter().flatten() {
                v.to_bits().hash(&mut h);
            }
        }
        Source::Studio => 1u8.hash(&mut h),
        Source::Asset(sha, _) => {
            2u8.hash(&mut h);
            sha.hash(&mut h);
        }
    }
    h.finish()
}

/// A Radiance HDR (RGBE, flat or run-length encoded, `-Y h +X w`) as linear radiance.
pub fn hdr(bytes: &[u8]) -> Option<Equirect> {
    let text_end = bytes.windows(2).position(|w| w == b"\n\n")? + 2;
    let header = std::str::from_utf8(&bytes[..text_end]).ok()?;
    if !header.starts_with("#?") {
        return None;
    }
    let res_end = text_end + bytes[text_end..].iter().position(|b| *b == b'\n')?;
    let res = std::str::from_utf8(&bytes[text_end..res_end]).ok()?;
    let parts: Vec<&str> = res.split_whitespace().collect();
    let (h, w) = match parts.as_slice() {
        ["-Y", h, "+X", w] => (h.parse::<u32>().ok()?, w.parse::<u32>().ok()?),
        _ => return None,
    };
    let mut at = res_end + 1;
    let mut rgb = Vec::with_capacity((w * h) as usize);
    let mut line = vec![[0u8; 4]; w as usize];
    for _ in 0..h {
        let rle = (8..32768).contains(&w)
            && bytes.get(at..at + 4)?[0] == 2
            && bytes[at + 1] == 2
            && (u32::from(bytes[at + 2]) << 8 | u32::from(bytes[at + 3])) == w;
        if rle {
            at += 4;
            for ch in 0..4 {
                let mut x = 0usize;
                while x < w as usize {
                    let n = *bytes.get(at)? as usize;
                    at += 1;
                    if n > 128 {
                        let v = *bytes.get(at)?;
                        at += 1;
                        for _ in 0..n - 128 {
                            line.get_mut(x)?[ch] = v;
                            x += 1;
                        }
                    } else {
                        for _ in 0..n {
                            line.get_mut(x)?[ch] = *bytes.get(at)?;
                            at += 1;
                            x += 1;
                        }
                    }
                }
            }
        } else {
            for px in line.iter_mut() {
                px.copy_from_slice(bytes.get(at..at + 4)?);
                at += 4;
            }
        }
        for px in &line {
            let f = if px[3] == 0 {
                0.0
            } else {
                2f32.powi(i32::from(px[3]) - 136)
            };
            rgb.push([
                f32::from(px[0]) * f,
                f32::from(px[1]) * f,
                f32::from(px[2]) * f,
            ]);
        }
    }
    Some(Equirect { size: [w, h], rgb })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_uniform_environment_gives_irradiance_pi_everywhere() {
        let e = Equirect::from_fn([64, 32], |_| [1.0, 1.0, 1.0]);
        let c = sh9(&e);
        for n in [
            [0.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, -1.0, 0.0],
            [0.6, 0.0, 0.8],
        ] {
            let e = irradiance(&c, n);
            assert!((e[0] - 1.0).abs() < 1e-3, "{n:?}: {e:?}");
        }
    }

    #[test]
    fn a_sky_brighter_above_lights_an_up_face_more() {
        let e = Equirect::from_fn([64, 32], |d| if d[1] > 0.0 { [1.0; 3] } else { [0.0; 3] });
        let c = sh9(&e);
        // A face up sees the bright half whole: E ÷ π = 1, within SH9's ringing.
        assert!((irradiance(&c, [0.0, 1.0, 0.0])[0] - 1.0).abs() < 0.07);
        assert!(irradiance(&c, [0.0, -1.0, 0.0])[0].abs() < 0.07);
        assert!((irradiance(&c, [1.0, 0.0, 0.0])[0] - 0.5).abs() < 0.02);
    }

    #[test]
    fn an_odd_level_halves_by_area_and_keeps_its_horizon() {
        // A step at the horizon, 45 rows high: the 22-row half keeps its mean and mirrors.
        let e = Equirect {
            size: [4, 45],
            rgb: (0..45 * 4)
                .map(|i| match (i / 4).cmp(&22) {
                    std::cmp::Ordering::Less => [1.0; 3],
                    std::cmp::Ordering::Equal => [0.5; 3],
                    std::cmp::Ordering::Greater => [0.0; 3],
                })
                .collect(),
        };
        let h = e.half();
        assert_eq!(h.size, [2, 22]);
        let mean = |e: &Equirect| e.rgb.iter().map(|c| c[0]).sum::<f32>() / e.rgb.len() as f32;
        assert!((mean(&h) - 0.5).abs() < 1e-5, "mean {}", mean(&h));
        for y in 0..11 {
            let (a, b) = (h.rgb[y * 2][0], h.rgb[(21 - y) * 2][0]);
            assert!(
                (a + b - 1.0).abs() < 1e-5,
                "rows {y} and {}: {a} + {b}",
                21 - y
            );
        }
    }

    #[test]
    fn halves_round_trip() {
        assert_eq!(f32_to_f16(1.0), 0x3c00);
        assert_eq!(f32_to_f16(0.5), 0x3800);
        assert_eq!(mips(256), 6);
    }
}
