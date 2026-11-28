use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [4, 2];
const TEXELS: [[u8; 4]; 8] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
    [10, 20, 30, 40],
    [50, 60, 70, 80],
    [90, 100, 110, 120],
    [130, 140, 150, 160],
];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let blit = gpu::literal(include_str!("../../../deep-player/src/gpu.rs"), "BLIT")?;
    let source = gpu::twin(
        &blit,
        twin,
        "o.uv = uv;",
        "o.uv = vec2<f32>(uv.x, 1.0 - uv.y);",
    )?;
    let bytes: Vec<u8> = TEXELS.iter().flatten().copied().collect();
    let frame = gpu::input(device, SIZE, wgpu::TextureFormat::Rgba8Unorm, &bytes);
    let view = frame.create_view(&Default::default());
    let pick = device.device.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let mut d = Draw::full_screen(&source, "vs", "fs", SIZE);
    d.groups = vec![vec![
        (0, wgpu::BindingResource::TextureView(&view)),
        (1, wgpu::BindingResource::Sampler(&pick)),
    ]];
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn texel(x: i64, y: i64) -> [f64; 4] {
    let [w, h] = SIZE.map(i64::from);
    let t = TEXELS[(y.clamp(0, h - 1) * w + x.clamp(0, w - 1)) as usize];
    t.map(|c| f64::from(c) / 255.0)
}

fn bilinear(u: f64, v: f64) -> [f64; 4] {
    let fx = u * f64::from(SIZE[0]) - 0.5;
    let fy = v * f64::from(SIZE[1]) - 0.5;
    let (x0, y0) = (fx.floor(), fy.floor());
    let (tx, ty) = (fx - x0, fy - y0);
    let (x0, y0) = (x0 as i64, y0 as i64);
    let mut out = [0.0; 4];
    for (dx, dy, wt) in [
        (0, 0, (1.0 - tx) * (1.0 - ty)),
        (1, 0, tx * (1.0 - ty)),
        (0, 1, (1.0 - tx) * ty),
        (1, 1, tx * ty),
    ] {
        let t = texel(x0 + dx, y0 + dy);
        for c in 0..4 {
            out[c] += wt * t[c];
        }
    }
    out
}

fn cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            let u = (f64::from(x) + 0.5) / f64::from(SIZE[0]);
            let v = (f64::from(y) + 0.5) / f64::from(SIZE[1]);
            px.extend(bilinear(u, v));
        }
    }
    px
}
