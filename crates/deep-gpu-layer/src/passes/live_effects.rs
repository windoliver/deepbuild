use deep_gpu::device::Device;
use deep_scene3d_render::LINEAR;

use super::gpu::{self, Draw, Out};
use super::Ran;

const PANEL: [u32; 2] = [4, 4];
const SIZE: [u32; 2] = [4, 12];
const SMALL: [u32; 2] = [2, 2];
const BLACK: [u8; 4] = [0, 0, 0, 255];
const WHITE: [u8; 4] = [255, 255, 255, 255];
const DIM: [u8; 4] = [51, 51, 51, 255];
const BRIGHT: [u8; 4] = [153, 153, 153, 255];
const LEFT: [u8; 4] = [51, 0, 102, 255];
const RIGHT: [u8; 4] = [153, 102, 0, 255];
const UNDER: [f64; 4] = [0.0, 0.2, 0.2, 0.0];

type Texels = Vec<[f64; 4]>;

fn edge() -> Vec<[u8; 4]> {
    vec![BLACK, WHITE, BLACK, WHITE]
}

fn spot() -> Vec<[u8; 4]> {
    (0..16).map(|i| if i == 5 { BRIGHT } else { DIM }).collect()
}

fn halves_lr() -> Vec<[u8; 4]> {
    (0..16)
        .map(|i| if i % 4 < 2 { LEFT } else { RIGHT })
        .collect()
}

fn unit(texels: &[[u8; 4]]) -> Texels {
    texels
        .iter()
        .map(|t| t.map(|c| f64::from(c) / 255.0))
        .collect()
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(include_str!("../effects.wgsl"), twin, "k * 0.5", "k * 0.0")?;
    let sampler = device.device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("live_effects fixture"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let mut gpu_px = Vec::new();
    for (entry, size, texels) in [
        ("upscale", SMALL, edge()),
        ("sharpen", PANEL, spot()),
        ("composite", PANEL, halves_lr()),
    ] {
        let bytes: Vec<u8> = texels.concat();
        let src = gpu::input(device, size, wgpu::TextureFormat::Rgba8Unorm, &bytes);
        let view = src.create_view(&Default::default());
        let mut d = Draw::full_screen(&source, "full", entry, PANEL);
        d.format = LINEAR;
        d.groups = vec![match entry {
            "sharpen" => vec![(0, wgpu::BindingResource::TextureView(&view))],
            _ => vec![
                (0, wgpu::BindingResource::TextureView(&view)),
                (1, wgpu::BindingResource::Sampler(&sampler)),
            ],
        }];
        if entry == "composite" {
            d.blend = Some(wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent::OVER,
            });
            d.clear = wgpu::Color {
                r: UNDER[0],
                g: UNDER[1],
                b: UNDER[2],
                a: UNDER[3],
            };
        }
        let tex = gpu::draw(device, d)?;
        gpu_px.extend(gpu::halves(&gpu::read_texture(device, &tex, 8)));
    }
    let cpu_px: Vec<f64> = [
        upscale(&unit(&edge()), SMALL),
        sharpen(&unit(&spot())),
        composite(&unit(&halves_lr())),
    ]
    .concat()
    .concat();
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 4, &gpu_px),
        cpu: Out::from_unit(SIZE, 4, &cpu_px),
    })
}

fn at(texels: &[[f64; 4]], size: [u32; 2], x: i64, y: i64) -> [f64; 4] {
    let x = x.clamp(0, i64::from(size[0]) - 1) as usize;
    let y = y.clamp(0, i64::from(size[1]) - 1) as usize;
    texels[y * size[0] as usize + x]
}

fn mix(a: [f64; 4], b: [f64; 4], t: f64) -> [f64; 4] {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}

fn length(a: [f64; 4], b: [f64; 4]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(p, q)| (p - q) * (p - q))
        .sum::<f64>()
        .sqrt()
}

fn upscale(src: &[[f64; 4]], size: [u32; 2]) -> Texels {
    let mut out = Vec::new();
    for py in 0..PANEL[1] {
        for px in 0..PANEL[0] {
            let tx = (f64::from(px) + 0.5) / f64::from(PANEL[0]) * f64::from(size[0]) - 0.5;
            let ty = (f64::from(py) + 0.5) / f64::from(PANEL[1]) * f64::from(size[1]) - 0.5;
            let (x0, y0) = (tx.floor() as i64, ty.floor() as i64);
            let (fx, fy) = (tx - tx.floor(), ty - ty.floor());
            let a = at(src, size, x0, y0);
            let b = at(src, size, x0 + 1, y0);
            let c = at(src, size, x0, y0 + 1);
            let e = at(src, size, x0 + 1, y0 + 1);
            let k = (length(a, e).max(length(b, c)) * 2.0).clamp(0.0, 1.0);
            let wx = fx + (fx.round() - fx) * k * 0.5;
            let wy = fy + (fy.round() - fy) * k * 0.5;
            out.push(mix(mix(a, b, wx), mix(c, e, wx), wy));
        }
    }
    out
}

fn sharpen(src: &[[f64; 4]]) -> Texels {
    let mut out = Vec::new();
    for y in 0..i64::from(PANEL[1]) {
        for x in 0..i64::from(PANEL[0]) {
            let c = at(src, PANEL, x, y);
            let around =
                [(0, -1), (0, 1), (-1, 0), (1, 0)].map(|(dx, dy)| at(src, PANEL, x + dx, y + dy));
            let mut px = c;
            for (i, v) in px.iter_mut().take(3).enumerate() {
                let sum: f64 = around.iter().map(|n| n[i]).sum();
                *v = (c[i] + 0.2 * (4.0 * c[i] - sum)).clamp(0.0, c[3]);
            }
            out.push(px);
        }
    }
    out
}

fn composite(src: &[[f64; 4]]) -> Texels {
    src.iter()
        .map(|s| {
            let alpha = s[3] + UNDER[3] * (1.0 - s[3]);
            [s[0] + UNDER[0], s[1] + UNDER[1], s[2] + UNDER[2], alpha]
        })
        .collect()
}
