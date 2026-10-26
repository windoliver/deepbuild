//! A shipped pass against its CPU reference (issue #380, criterion 8): the pass runs on the GPU
//! over inputs uploaded once, the inputs as the GPU holds them are read back, and the graph runs
//! on them in f64 through the interpreter. Both outputs are compared per channel in 10-bit code
//! values of the value clamped to [0, 1], as a 10-bit target would hold it.

use std::collections::BTreeMap;

use deep_canvas_effects::graph::{Tex, Ty};
use deep_canvas_effects::interp::{self, Env, Image};
use deep_gpu::device::Device;

use crate::compile::Compiled;
use crate::runner::{Frame, Runner, LINEAR};

/// A column-major 4 × 4 matrix's inverse, by Gauss–Jordan with partial pivoting.
pub fn inverse(m: &[f64; 16]) -> [f64; 16] {
    let mut a = [[0.0f64; 8]; 4];
    for (r, row) in a.iter_mut().enumerate() {
        for c in 0..4 {
            row[c] = m[c * 4 + r];
        }
        row[4 + r] = 1.0;
    }
    for c in 0..4 {
        let p = (c..4)
            .max_by(|x, y| a[*x][c].abs().total_cmp(&a[*y][c].abs()))
            .unwrap_or(c);
        a.swap(c, p);
        let d = a[c][c];
        if d == 0.0 {
            return [0.0; 16];
        }
        for v in a[c].iter_mut() {
            *v /= d;
        }
        for r in 0..4 {
            if r != c {
                let (f, pivot) = (a[r][c], a[c]);
                for (v, p) in a[r].iter_mut().zip(pivot) {
                    *v -= f * p;
                }
            }
        }
    }
    let mut o = [0.0; 16];
    for (r, row) in a.iter().enumerate() {
        for c in 0..4 {
            o[c * 4 + r] = row[4 + c];
        }
    }
    o
}

/// An IEEE 754 half as the f32 it is exactly.
pub fn f16_to_f32(h: u16) -> f32 {
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = (h >> 10) & 0x1f;
    let man = f32::from(h & 0x3ff);
    match exp {
        0 => sign * man * (2f32).powi(-24),
        31 if man == 0.0 => sign * f32::INFINITY,
        31 => f32::NAN,
        e => sign * (1.0 + man / 1024.0) * (2f32).powi(i32::from(e) - 15),
    }
}

/// f32 to the nearest half, ties to even.
pub fn f32_to_f16(x: f32) -> u16 {
    let bits = x.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exp = ((bits >> 23) & 0xff) as i32;
    let man = bits & 0x7f_ffff;
    if exp == 255 {
        return sign | 0x7c00 | if man != 0 { 0x200 } else { 0 };
    }
    let e = exp - 127 + 15;
    if e >= 31 {
        return sign | 0x7c00;
    }
    if e <= 0 {
        if e < -10 {
            return sign;
        }
        let m = (man | 0x80_0000) >> (1 - e);
        let round = (m >> 12) & 1 == 1 && ((m & 0xfff) != 0 || (m >> 13) & 1 == 1);
        return sign | ((m >> 13) as u16 + u16::from(round));
    }
    let round = (man >> 12) & 1 == 1 && ((man & 0xfff) != 0 || (man >> 13) & 1 == 1);
    let h = (sign as u32) | ((e as u32) << 10) | (man >> 13);
    (h + u32::from(round)) as u16
}

fn texture(
    device: &wgpu::Device,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("operator reference"),
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
}

/// Reads a texture back, `texel` bytes a pixel, rows top-down with no padding.
pub fn read(
    device: &Device,
    tex: &wgpu::Texture,
    aspect: wgpu::TextureAspect,
    texel: u32,
) -> Vec<u8> {
    let [w, h] = [tex.width(), tex.height()];
    let row = (w * texel).div_ceil(256) * 256;
    let buf = device.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("operator readback"),
        size: u64::from(row * h),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.device.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &buf,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        tex.size(),
    );
    device.queue.submit([enc.finish()]);
    let slice = buf.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
    let data = slice.get_mapped_range().expect("mapped");
    let mut out = Vec::with_capacity((w * h * texel) as usize);
    for y in 0..h {
        let s = (y * row) as usize;
        out.extend_from_slice(&data[s..s + (w * texel) as usize]);
    }
    drop(data);
    buf.unmap();
    out
}

/// An rgba16float image's pixels, read back, as f64.
pub fn linear_image(bytes: &[u8], size: [u32; 2]) -> Image {
    let mut img = Image::new(size[0], size[1]);
    for (i, px) in bytes.as_chunks::<8>().0.iter().enumerate() {
        for c in 0..4 {
            img.px[i][c] = f64::from(f16_to_f32(u16::from_le_bytes([px[2 * c], px[2 * c + 1]])));
        }
    }
    img
}

const DEPTH_WGSL: &str = "
@group(0) @binding(0) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
    return vec4<f32>(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4<f32>) -> @builtin(frag_depth) f32 {
    return textureLoad(src, vec2<i32>(pos.xy), 0).x;
}
";

/// A Depth32Float texture holding `img`'s first lane, written through frag_depth (a depth
/// texture takes no buffer copy).
pub fn depth_texture(device: &Device, img: &Image) -> wgpu::Texture {
    let d = &device.device;
    let size = [img.w, img.h];
    let src = texture(
        d,
        size,
        wgpu::TextureFormat::R32Float,
        wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
    );
    let bytes: Vec<u8> = img
        .px
        .iter()
        .flat_map(|p| (p[0] as f32).to_le_bytes())
        .collect();
    write(device, &src, &bytes, 4);
    let dst = texture(
        d,
        size,
        wgpu::TextureFormat::Depth32Float,
        wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
    );
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("depth upload"),
        source: wgpu::ShaderSource::Wgsl(DEPTH_WGSL.into()),
    });
    let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("depth upload"),
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
            targets: &[],
        }),
        primitive: Default::default(),
        depth_stencil: Some(wgpu::DepthStencilState {
            format: wgpu::TextureFormat::Depth32Float,
            depth_write_enabled: Some(true),
            depth_compare: Some(wgpu::CompareFunction::Always),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("depth upload"),
        layout: &pipeline.get_bind_group_layout(0),
        entries: &[wgpu::BindGroupEntry {
            binding: 0,
            resource: wgpu::BindingResource::TextureView(&src.create_view(&Default::default())),
        }],
    });
    let mut enc = d.create_command_encoder(&Default::default());
    {
        let view = dst.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("depth upload"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(0.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
    device.queue.submit([enc.finish()]);
    dst
}

fn write(device: &Device, tex: &wgpu::Texture, bytes: &[u8], texel: u32) {
    device.queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        bytes,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(tex.width() * texel),
            rows_per_image: Some(tex.height()),
        },
        tex.size(),
    );
}

/// Uploads one texture input as the GPU will hold it, and returns it with the image as held
/// (an rgba16float color rounded to half, depth to f32, IDs exact).
pub fn upload(device: &Device, kind: Tex, img: &Image) -> (wgpu::Texture, Image) {
    let d = &device.device;
    let size = [img.w, img.h];
    match kind {
        Tex::Float => {
            let tex = texture(
                d,
                size,
                LINEAR,
                wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_DST
                    | wgpu::TextureUsages::COPY_SRC,
            );
            let bytes: Vec<u8> = img
                .px
                .iter()
                .flat_map(|p| p.iter().flat_map(|c| f32_to_f16(*c as f32).to_le_bytes()))
                .collect();
            write(device, &tex, &bytes, 8);
            let held = linear_image(&read(device, &tex, wgpu::TextureAspect::All, 8), size);
            (tex, held)
        }
        Tex::Uint => {
            let tex = texture(
                d,
                size,
                wgpu::TextureFormat::R32Uint,
                wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            );
            let bytes: Vec<u8> = img
                .px
                .iter()
                .flat_map(|p| (p[0] as u32).to_le_bytes())
                .collect();
            write(device, &tex, &bytes, 4);
            (tex, img.clone())
        }
        Tex::Depth => {
            let tex = depth_texture(device, img);
            let back = read(device, &tex, wgpu::TextureAspect::DepthOnly, 4);
            let mut held = Image::new(img.w, img.h);
            for (i, b) in back.as_chunks::<4>().0.iter().enumerate() {
                held.px[i][0] = f64::from(f32::from_le_bytes(*b));
            }
            (tex, held)
        }
    }
}

/// The output's size for inputs of these sizes.
/// The frame values a pass reads beside its inputs.
#[derive(Clone, Copy, Debug)]
pub struct Camera {
    /// Column-major.
    pub clip: [f64; 16],
    pub eye: [f64; 3],
    pub near: f64,
    pub t: f64,
    pub seed: u32,
}

impl Camera {
    /// As the GPU holds it: every value an f32, the inverse taken in f64 first.
    fn frame(&self) -> Frame {
        Frame {
            clip: self.clip.map(|x| x as f32),
            inverse_clip: inverse(&self.clip).map(|x| x as f32),
            eye: [
                self.eye[0] as f32,
                self.eye[1] as f32,
                self.eye[2] as f32,
                self.near as f32,
            ],
            t: self.t as f32,
            seed: self.seed,
        }
    }

    /// What the CPU reads: the same f32 values.
    fn env<'a>(
        &self,
        inputs: BTreeMap<String, interp::Val>,
        textures: BTreeMap<String, &'a Image>,
    ) -> Env<'a> {
        let f = self.frame();
        Env {
            t: f64::from(f.t),
            seed: f.seed,
            clip: f.clip.map(f64::from),
            inverse_clip: f.inverse_clip.map(f64::from),
            eye: f.eye.map(f64::from),
            inputs,
            textures,
        }
    }
}

/// A pass at `size` in f64 on the CPU, its rows split over the machine's cores.
pub fn cpu_pass(c: &Compiled, env: &Env<'_>, size: [u32; 2]) -> Result<Image, String> {
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(16) as u32;
    let band = size[1].div_ceil(threads).max(1);
    let parts: Vec<Result<Vec<[f64; 4]>, String>> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..size[1].div_ceil(band))
            .map(|k| {
                let rows = k * band..((k + 1) * band).min(size[1]);
                s.spawn(move || interp::pass_rows(&c.checked, env, size, rows))
            })
            .collect();
        handles
            .into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err("a CPU band panicked".into()))
            })
            .collect()
    });
    let mut px = Vec::with_capacity((size[0] * size[1]) as usize);
    for p in parts {
        px.extend(p?);
    }
    Ok(Image {
        w: size[0],
        h: size[1],
        px,
    })
}

/// An empty linear target of `size`.
fn target(device: &Device, size: [u32; 2]) -> wgpu::Texture {
    texture(
        &device.device,
        size,
        LINEAR,
        wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
    )
}

/// Runs one pass on the GPU into a new target of `size`, reading `textures` (its texture
/// inputs, by name).
fn gpu_pass(
    device: &Device,
    runner: &Runner,
    camera: &Camera,
    values: &BTreeMap<String, interp::Val>,
    textures: &BTreeMap<String, &wgpu::Texture>,
    size: [u32; 2],
) -> Result<wgpu::Texture, String> {
    let views: Vec<wgpu::TextureView> = runner
        .compiled
        .checked
        .textures
        .iter()
        .map(|n| {
            textures
                .get(n)
                .map(|t| t.create_view(&Default::default()))
                .ok_or_else(|| format!("no texture for {n}"))
        })
        .collect::<Result<_, _>>()?;
    let refs: Vec<&wgpu::TextureView> = views.iter().collect();
    let (g0, g1, _buffers) = runner.bind(&device.device, &camera.frame(), size, values, &refs, &[]);
    let out = target(device, size);
    let mut enc = device.device.create_command_encoder(&Default::default());
    runner.encode(
        &mut enc,
        &out.create_view(&Default::default()),
        &(g0, g1),
        None,
    );
    device.queue.submit([enc.finish()]);
    Ok(out)
}

/// One shipped pass run both ways on the same inputs: the GPU's output and the CPU reference's.
pub struct Ran {
    pub gpu: Image,
    pub cpu: Image,
}

/// Runs a one-stage shipped pass at `size` on the GPU (from `gpu_stage`, which may differ from
/// the reference only by a planted program) and its CPU reference (`stage`), over `images` (one
/// per texture input), uploaded once and read back as the GPU holds them.
#[allow(clippy::too_many_arguments)]
pub fn pass(
    device: &Device,
    stage: &Compiled,
    gpu_stage: &Compiled,
    images: &BTreeMap<String, Image>,
    params: &BTreeMap<String, serde_json::Value>,
    roles: &BTreeMap<String, [f64; 3]>,
    camera: &Camera,
    size: [u32; 2],
) -> Result<Ran, String> {
    let runner = Runner::new(&device.device, gpu_stage.clone(), LINEAR);
    let mut held = BTreeMap::new();
    let mut textures = BTreeMap::new();
    for name in &stage.checked.textures {
        let img = images
            .get(name)
            .ok_or_else(|| format!("no image for {name}"))?;
        let Ty::Tex(kind) = stage.checked.op.inputs[name].ty else {
            unreachable!()
        };
        let (tex, h) = upload(device, kind, img);
        textures.insert(name.clone(), tex);
        held.insert(name.clone(), h);
    }
    let values = interp::inputs(&gpu_stage.checked, params, roles);
    let refs: BTreeMap<String, &wgpu::Texture> =
        textures.iter().map(|(k, v)| (k.clone(), v)).collect();
    let out = gpu_pass(device, &runner, camera, &values, &refs, size)?;
    let gpu = linear_image(&read(device, &out, wgpu::TextureAspect::All, 8), size);
    let env = camera.env(
        interp::inputs(&stage.checked, params, roles),
        held.iter().map(|(k, v)| (k.clone(), v)).collect(),
    );
    let cpu = cpu_pass(stage, &env, size)?;
    Ok(Ran { gpu, cpu })
}

/// Runs the glow's chain at `size` over `scene` on the GPU (`gpu_stages`) and as its CPU
/// reference (`stages`), each stage in the chain's order at the chain's sizes.
pub fn glow(
    device: &Device,
    stages: &[Compiled],
    gpu_stages: &[Compiled],
    scene: &Image,
    params: &BTreeMap<String, serde_json::Value>,
    camera: &Camera,
    size: [u32; 2],
) -> Result<Ran, String> {
    let radius = params
        .get("bloom.radius")
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.85);
    let runs = crate::glow::plan(size, radius);
    let mut params = params.clone();
    params.insert(
        "bloom.levels".into(),
        serde_json::json!(crate::glow::levels(size, radius).len()),
    );
    let roles = BTreeMap::new();
    let (scene_tex, held) = upload(device, Tex::Float, scene);
    // The GPU's chain.
    let runners: Vec<Runner> = gpu_stages
        .iter()
        .map(|c| Runner::new(&device.device, c.clone(), LINEAR))
        .collect();
    let mut levels: BTreeMap<usize, wgpu::Texture> = BTreeMap::new();
    let mut last = None;
    for r in &runs {
        let level = |i: Option<usize>| -> &wgpu::Texture { i.map_or(&scene_tex, |k| &levels[&k]) };
        let stage = &runners[r.stage];
        let mut textures: BTreeMap<String, &wgpu::Texture> = BTreeMap::new();
        for name in &stage.compiled.checked.textures {
            let t = match name.as_str() {
                "src" | "small" | "bloom" => level(r.a),
                "large" => level(r.b),
                _ => &scene_tex,
            };
            textures.insert(name.clone(), t);
        }
        let values = interp::inputs(&stage.compiled.checked, &params, &roles);
        let out = gpu_pass(device, stage, camera, &values, &textures, r.size)?;
        match r.out {
            Some(k) => {
                levels.insert(k, out);
            }
            None => last = Some(out),
        }
    }
    let out = last.ok_or("the chain has no mix")?;
    let gpu = linear_image(&read(device, &out, wgpu::TextureAspect::All, 8), size);
    // The CPU reference's chain, over the scene as the GPU holds it.
    let mut images: BTreeMap<usize, Image> = BTreeMap::new();
    let mut cpu = None;
    for r in &runs {
        let stage = &stages[r.stage];
        let mut textures: BTreeMap<String, &Image> = BTreeMap::new();
        for name in &stage.checked.textures {
            let img = match name.as_str() {
                "src" | "small" | "bloom" => r.a.map_or(&held, |k| &images[&k]),
                "large" => r.b.map_or(&held, |k| &images[&k]),
                _ => &held,
            };
            textures.insert(name.clone(), img);
        }
        let env = camera.env(interp::inputs(&stage.checked, &params, &roles), textures);
        let img = cpu_pass(stage, &env, r.size)?;
        match r.out {
            Some(k) => {
                images.insert(k, img);
            }
            None => cpu = Some(img),
        }
    }
    Ok(Ran {
        gpu,
        cpu: cpu.ok_or("the chain has no mix")?,
    })
}
