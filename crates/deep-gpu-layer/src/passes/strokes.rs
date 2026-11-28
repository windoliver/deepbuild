use deep_canvas_effects::interp::Image;
use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [40, 20];
const CENTRE: [f32; 2] = [16.5, 10.0];
const ANGLE: f32 = 0.0;
const SEED: f32 = 0.0;
const LENGTH: f32 = 27.0;
const WIDTH: f32 = 20.0;
const COLOR: [f32; 3] = [4.0 / 7.0, 8.0 / 21.0, 4.0 / 21.0];
const OWN_DEPTH: f32 = 0.5;
const NEARER_DEPTH: f32 = 0.75;
const NEARER_FROM_X: u32 = 24;
const BACKGROUND: [f32; 4] = [0.0, 0.0, 0.0, 1.0];

fn scene_depth(x: u32) -> f32 {
    if x >= NEARER_FROM_X {
        NEARER_DEPTH
    } else {
        OWN_DEPTH
    }
}

fn depth_image() -> Image {
    let mut img = Image::new(SIZE[0], SIZE[1]);
    for (i, px) in img.px.iter_mut().enumerate() {
        px[0] = f64::from(scene_depth(i as u32 % SIZE[0]));
    }
    img
}

fn uniform_floats() -> Vec<f32> {
    let mut clip = [0.0f32; 16];
    for k in 0..4 {
        clip[k * 5] = 1.0;
    }
    clip.into_iter()
        .chain([SIZE[0] as f32, SIZE[1] as f32, 0.0, 0.0])
        .collect()
}

fn dab_floats() -> Vec<f32> {
    vec![
        CENTRE[0], CENTRE[1], ANGLE, SEED, 0.0, 0.0, OWN_DEPTH, 0.0, LENGTH, WIDTH, 0.0, 0.0,
        COLOR[0], COLOR[1], COLOR[2], 1.0,
    ]
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/strokes.wgsl"),
        twin,
        "smoothstep(0.7, 1.0, r)",
        "smoothstep(0.5, 1.0, r)",
    )?;
    let uniform = gpu::uniform(device, &gpu::bytes_of_f32(&uniform_floats()));
    let dabs = gpu::storage(device, &gpu::bytes_of_f32(&dab_floats()));
    let depth = deep_effects_render::reference::depth_texture(device, &depth_image());
    let depth_view = depth.create_view(&Default::default());
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
    let mut d = Draw::full_screen(&source, "vs", "fs", SIZE);
    d.format = wgpu::TextureFormat::Rgba16Float;
    d.vertices = 6;
    d.blend = Some(over);
    d.clear = wgpu::Color {
        r: f64::from(BACKGROUND[0]),
        g: f64::from(BACKGROUND[1]),
        b: f64::from(BACKGROUND[2]),
        a: f64::from(BACKGROUND[3]),
    };
    d.groups = vec![vec![
        (0, uniform.as_entire_binding()),
        (1, dabs.as_entire_binding()),
        (2, wgpu::BindingResource::TextureView(&depth_view)),
    ]];
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 4, &gpu::halves(&gpu::read_texture(device, &tex, 8))),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn hash(x: f32) -> f32 {
    let v = (x * 12.9898).sin() * 43_758.547;
    v - v.floor()
}

fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn dab_alpha(px: f32, py: f32, x: u32) -> f32 {
    let (half_l, half_w) = (0.5 * LENGTH, 0.5 * WIDTH);
    let (dx, dy) = (px - CENTRE[0], py - CENTRE[1]);
    if dx.abs() > half_l || dy.abs() > half_w {
        return 0.0;
    }
    if (scene_depth(x) - OWN_DEPTH).abs() > 0.002 {
        return 0.0;
    }
    let uv = [dx / half_l, dy / half_w];
    let r = (uv[0] * uv[0] + uv[1] * uv[1]).sqrt();
    let body = 1.0 - smoothstep(0.7, 1.0, r);
    let lane = ((uv[1] * 0.5 + 0.5) * 7.0).floor();
    let bristle = 0.7 + 0.3 * hash(lane + SEED * 97.0);
    let tail = 1.0 - 0.35 * smoothstep(0.2, 1.0, uv[0]);
    (body * bristle * tail).clamp(0.0, 1.0)
}

fn cpu() -> Vec<f64> {
    let mut out = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            let a = dab_alpha(x as f32 + 0.5, y as f32 + 0.5, x);
            let rgb = [0, 1, 2].map(|k| COLOR[k] * a + BACKGROUND[k] * (1.0 - a));
            out.extend(rgb.into_iter().chain([BACKGROUND[3]]).map(f64::from));
        }
    }
    out
}
