use deep_canvas_effects::interp::Image;
use deep_effects_render::reference::f32_to_f16;
use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const WIDTH: u32 = 32;
const DOT_PANEL: [u32; 2] = [WIDTH, 16];
const HALF_PANEL: [u32; 2] = [WIDTH, 8];
const HALF_VIEW: [u32; 2] = [2 * WIDTH, 16];
const UP_PANEL: [u32; 2] = [WIDTH, 8];
const OUT: [u32; 2] = [WIDTH, 48];
const PUFF_KIND: f64 = 2.0;
const DOT_KIND: f64 = 0.0;
const PUFF_DEPTH: f64 = 0.5;
const NEARER_DEPTH: f64 = 1.0;
const HIDDEN_FROM_X: u32 = 32;

struct Sprites {
    view: [u32; 2],
    kind: f64,
    size_px: f64,
    opacity: [f64; 2],
    stops: Vec<(f64, [f64; 3])>,
    particles: Vec<([f64; 3], f64)>,
}

fn dots() -> Sprites {
    Sprites {
        view: DOT_PANEL,
        kind: DOT_KIND,
        size_px: 8.0,
        opacity: [1.0, 1.0],
        stops: vec![
            (0.0, [0.8, 8.0 / 15.0, 4.0 / 15.0]),
            (0.5, [40.0 / 255.0, 200.0 / 255.0, 240.0 / 255.0]),
        ],
        particles: vec![
            ([4.5, 4.5, 0.0], 0.0),
            ([11.5, 11.5, 0.0], 0.5),
            ([8.0, 8.0, 0.0], -1.0),
        ],
    }
}

fn puffs() -> Sprites {
    let codes_at_centre = 0.35 * 255.0;
    Sprites {
        view: HALF_VIEW,
        kind: PUFF_KIND,
        size_px: 10.0,
        opacity: [1.0, 1.0],
        stops: vec![(
            0.0,
            [
                68.0 / codes_at_centre,
                44.0 / codes_at_centre,
                20.0 / codes_at_centre,
            ],
        )],
        particles: vec![([7.0, 7.0, 0.0], 0.0), ([39.0, 7.0, 0.0], 0.0)],
    }
}

fn clip(view: [u32; 2]) -> [f64; 16] {
    let [w, h] = view.map(f64::from);
    let mut m = [0.0; 16];
    m[0] = 2.0 / w;
    m[5] = -2.0 / h;
    m[12] = -1.0;
    m[13] = 1.0;
    m[14] = PUFF_DEPTH;
    m[15] = 1.0;
    m
}

fn uniform_floats(s: &Sprites) -> Vec<f32> {
    let mut stops = s.stops.clone();
    while stops.len() < 4 {
        stops.push(s.stops[s.stops.len() - 1]);
    }
    clip(s.view)
        .into_iter()
        .chain([f64::from(s.view[0]), f64::from(s.view[1]), 1.0, 1.0])
        .chain([s.size_px, s.size_px, s.opacity[0], s.opacity[1]])
        .chain([s.kind, 0.0, s.stops.len() as f64, 0.0])
        .chain([0.0; 4])
        .chain([0.0; 4])
        .chain(stops.iter().map(|st| st.0))
        .chain(stops.iter().flat_map(|st| [st.1[0], st.1[1], st.1[2], 0.0]))
        .chain([1.0; 12])
        .chain([0.0; 12])
        .map(|x| x as f32)
        .collect()
}

fn instance_floats(s: &Sprites) -> Vec<f32> {
    s.particles
        .iter()
        .flat_map(|(p, life)| [p[0], p[1], p[2], *life, 0.0, 0.0, 0.0, 0.0])
        .map(|x| x as f32)
        .collect()
}

fn additive() -> wgpu::BlendState {
    wgpu::BlendState {
        color: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        },
        alpha: wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::Zero,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        },
    }
}

fn hidden(x: u32, y: u32) -> bool {
    x >= HIDDEN_FROM_X && y % 2 == 1
}

fn scene_depth_image() -> Image {
    let [w, _] = HALF_VIEW;
    let mut img = Image::new(HALF_VIEW[0], HALF_VIEW[1]);
    for (i, px) in img.px.iter_mut().enumerate() {
        let (x, y) = (i as u32 % w, i as u32 / w);
        px[0] = if hidden(x, y) { NEARER_DEPTH } else { 0.0 };
    }
    img
}

struct Upsample {
    entry: &'static str,
    input: [u32; 2],
    texels_per_px: f64,
    split: u32,
    tones: [f64; 2],
}

const UPSAMPLES: [Upsample; 3] = [
    Upsample {
        entry: "upsample_fs",
        input: [16, 4],
        texels_per_px: 0.5,
        split: 8,
        tones: [40.0, 200.0],
    },
    Upsample {
        entry: "upsample_full_fs",
        input: [32, 8],
        texels_per_px: 1.0,
        split: 16,
        tones: [60.0, 180.0],
    },
    Upsample {
        entry: "upsample_quarter_fs",
        input: [8, 2],
        texels_per_px: 0.25,
        split: 4,
        tones: [40.0, 200.0],
    },
];

fn texel(u: &Upsample, x: u32) -> [f64; 4] {
    let tone = if x < u.split { u.tones[0] } else { u.tones[1] };
    let v = tone / 255.0;
    [v, v / 2.0, 0.0, 1.0].map(|c| f64::from(half_float(c)))
}

fn half_float(x: f64) -> f32 {
    deep_effects_render::reference::f16_to_f32(f32_to_f16(x as f32))
}

fn panel_codes(device: &Device, tex: &wgpu::Texture) -> Vec<f64> {
    gpu::halves(&gpu::read_texture(device, tex, 8))
}

fn draw_sprites(
    device: &Device,
    source: &str,
    s: &Sprites,
    fs: &str,
    size: [u32; 2],
    depth: Option<&wgpu::TextureView>,
) -> Result<Vec<f64>, String> {
    let uniform = gpu::uniform(device, &gpu::bytes_of_f32(&uniform_floats(s)));
    let inst = gpu::storage(device, &gpu::bytes_of_f32(&instance_floats(s)));
    let mut d = Draw::full_screen(source, "vs", fs, size);
    d.format = wgpu::TextureFormat::Rgba16Float;
    d.vertices = 6;
    d.instances = s.particles.len() as u32;
    d.blend = Some(additive());
    let mut group = vec![
        (0, uniform.as_entire_binding()),
        (1, inst.as_entire_binding()),
    ];
    if let Some(view) = depth {
        group.push((2, wgpu::BindingResource::TextureView(view)));
    }
    d.groups = vec![group];
    let tex = gpu::draw(device, d)?;
    Ok(panel_codes(device, &tex))
}

fn draw_upsample(device: &Device, source: &str, u: &Upsample) -> Result<Vec<f64>, String> {
    let bytes: Vec<u8> = (0..u.input[1])
        .flat_map(|_| (0..u.input[0]).flat_map(|x| texel(u, x)))
        .flat_map(|c| f32_to_f16(c as f32).to_le_bytes())
        .collect();
    let input = gpu::input(device, u.input, wgpu::TextureFormat::Rgba16Float, &bytes);
    let input_view = input.create_view(&Default::default());
    let sampler = device.device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("pass fixture upsample"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let mut d = Draw::full_screen(source, "upsample_vs", u.entry, UP_PANEL);
    d.format = wgpu::TextureFormat::Rgba16Float;
    d.blend = Some(additive());
    d.groups = vec![vec![
        (3, wgpu::BindingResource::TextureView(&input_view)),
        (4, wgpu::BindingResource::Sampler(&sampler)),
    ]];
    let tex = gpu::draw(device, d)?;
    Ok(panel_codes(device, &tex))
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/particles.wgsl"),
        twin,
        "let r2 = dot(at, at);",
        "let r2 = dot(at, at) + 0.2;",
    )?;
    let depth = deep_effects_render::reference::depth_texture(device, &scene_depth_image());
    let depth_view = depth.create_view(&Default::default());
    let mut gpu_px = draw_sprites(device, &source, &dots(), "fs", DOT_PANEL, None)?;
    gpu_px.extend(draw_sprites(
        device,
        &source,
        &puffs(),
        "half_fs",
        HALF_PANEL,
        Some(&depth_view),
    )?);
    for u in &UPSAMPLES {
        gpu_px.extend(draw_upsample(device, &source, u)?);
    }
    Ok(Ran {
        gpu: Out::from_unit(OUT, 4, &gpu_px),
        cpu: Out::from_unit(OUT, 4, &cpu()),
    })
}

fn cbrt(x: f64) -> f64 {
    x.signum() * x.abs().powf(1.0 / 3.0)
}

fn to_oklab(c: [f64; 3]) -> [f64; 3] {
    let l = 0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2];
    let m = 0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2];
    let s = 0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2];
    let (l, m, s) = (cbrt(l), cbrt(m), cbrt(s));
    [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ]
}

fn from_oklab(c: [f64; 3]) -> [f64; 3] {
    let l = c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2];
    let m = c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2];
    let s = c[0] - 0.0894841775 * c[1] - 1.2914855480 * c[2];
    let (l, m, s) = (l * l * l, m * m * m, s * s * s);
    [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ]
}

fn mix(a: f64, b: f64, t: f64) -> f64 {
    a * (1.0 - t) + b * t
}

fn color_at(stops: &[(f64, [f64; 3])], l: f64) -> [f64; 3] {
    let lo = (1..stops.len()).rfind(|&i| stops[i].0 <= l).unwrap_or(0);
    let hi = (lo + 1).min(stops.len() - 1);
    let (a, b) = (stops[lo].0, stops[hi].0);
    let f = if b > a {
        ((l - a) / (b - a)).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let (x, y) = (to_oklab(stops[lo].1), to_oklab(stops[hi].1));
    from_oklab([0, 1, 2].map(|k| mix(x[k], y[k], f))).map(|v| v.max(0.0))
}

fn sprite_at(
    s: &Sprites,
    scale: f64,
    p: [f64; 3],
    life: f64,
    px: f64,
    py: f64,
) -> Option<[f64; 3]> {
    if life < 0.0 {
        return None;
    }
    let l = life.clamp(0.0, 1.0);
    let half = 0.5 * mix(s.size_px, s.size_px, l).max(1.0) * scale;
    let (dx, dy) = (px - p[0] * scale, py - p[1] * scale);
    if dx.abs() > half || dy.abs() > half {
        return None;
    }
    let r2 = (dx / half).powi(2) + (dy / half).powi(2);
    if r2 > 1.0 {
        return None;
    }
    let shape = if s.kind == PUFF_KIND {
        0.35 * (-3.0 * r2).exp()
    } else {
        (1.0 - r2) * (1.0 - r2)
    };
    let fade = mix(s.opacity[0], s.opacity[1], l) * (1.0 - l);
    Some(color_at(&s.stops, l).map(|c| c * shape * fade))
}

fn sprites_panel(
    s: &Sprites,
    size: [u32; 2],
    scale: f64,
    shown: impl Fn(u32, u32) -> f64,
) -> Vec<f64> {
    let mut out = Vec::new();
    for y in 0..size[1] {
        for x in 0..size[0] {
            let (cx, cy) = (f64::from(x) + 0.5, f64::from(y) + 0.5);
            let mut sum = [0.0; 4];
            for (p, life) in &s.particles {
                if let Some(c) = sprite_at(s, scale, *p, *life, cx, cy) {
                    for (acc, v) in sum.iter_mut().zip(c) {
                        *acc += v * shown(x, y);
                    }
                }
            }
            out.extend(sum);
        }
    }
    out
}

fn shown_of_half(x: u32, y: u32) -> f64 {
    let last = [HALF_VIEW[0] - 1, HALF_VIEW[1] - 1];
    (0..4)
        .filter(|k| {
            let fx = (2 * x + (k & 1)).min(last[0]);
            let fy = (2 * y + (k >> 1)).min(last[1]);
            let depth = if hidden(fx, fy) { NEARER_DEPTH } else { 0.0 };
            PUFF_DEPTH >= depth
        })
        .count() as f64
        * 0.25
}

fn upsample_panel(u: &Upsample) -> Vec<f64> {
    let mut out = Vec::new();
    for _ in 0..UP_PANEL[1] {
        for x in 0..UP_PANEL[0] {
            let at = (f64::from(x) + 0.5) * u.texels_per_px - 0.5;
            let below = at.floor();
            let f = at - below;
            let pick = |i: f64| texel(u, i.clamp(0.0, f64::from(u.input[0] - 1)) as u32);
            let (a, b) = (pick(below), pick(below + 1.0));
            out.extend([0, 1, 2].map(|k| a[k] * (1.0 - f) + b[k] * f));
            out.push(0.0);
        }
    }
    out
}

fn cpu() -> Vec<f64> {
    let mut out = sprites_panel(&dots(), DOT_PANEL, 1.0, |_, _| 1.0);
    out.extend(sprites_panel(&puffs(), HALF_PANEL, 0.5, shown_of_half));
    for u in &UPSAMPLES {
        out.extend(upsample_panel(u));
    }
    out
}
