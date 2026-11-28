use deep_gpu::device::Device;
use deep_scene3d_render::LINEAR;

use super::gpu::{self, Draw, Out};
use super::Ran;

const PANEL: [u32; 2] = [8, 8];
const SIZE: [u32; 2] = [8, 16];
const TEXTURE: [u32; 2] = [2, 2];
const TEXELS: [[u8; 4]; 4] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 255, 255],
];
const IDENTITY: [f32; 16] = [
    1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
];
const AT: [f32; 4] = [0.0, 0.0, 0.5, 0.0];
const SHADE: f32 = 0.25;
const COVERED: std::ops::Range<u32> = 2..6;

fn square() -> Vec<f32> {
    [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [-0.5, 0.5],
        [0.5, -0.5],
        [0.5, 0.5],
    ]
    .iter()
    .flat_map(|[x, y]| [*x, *y, 0.0, SHADE])
    .collect()
}

const POINT: [wgpu::VertexAttribute; 1] = wgpu::vertex_attr_array![0 => Float32x4];
const PLACE: [wgpu::VertexAttribute; 1] = wgpu::vertex_attr_array![1 => Float32x4];

fn float4(
    attributes: &'static [wgpu::VertexAttribute],
    step_mode: wgpu::VertexStepMode,
) -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: 16,
        step_mode,
        attributes,
    }
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../testgpu.wgsl"),
        twin,
        "o.uv = vec2f(c.x, 1.0 - c.y);",
        "o.uv = vec2f(c.x, c.y);",
    )?;
    let frame = gpu::uniform(device, &gpu::bytes_of_f32(&IDENTITY));
    let at = gpu::buffer(device, &gpu::bytes_of_f32(&AT), wgpu::BufferUsages::VERTEX);
    let points = gpu::buffer(
        device,
        &gpu::bytes_of_f32(&square()),
        wgpu::BufferUsages::VERTEX,
    );
    let texture = gpu::input(
        device,
        TEXTURE,
        wgpu::TextureFormat::Rgba8Unorm,
        &TEXELS.concat(),
    );
    let view = texture.create_view(&Default::default());
    let sampler = device.device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("test_gpu fixture"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::MipmapFilterMode::Linear,
        ..Default::default()
    });
    let mut quad = Draw::full_screen(&source, "quad_vs", "quad_fs", PANEL);
    quad.format = LINEAR;
    quad.vertices = 6;
    quad.vertex_buffers = vec![(float4(&PLACE, wgpu::VertexStepMode::Instance), &at)];
    quad.groups = vec![
        vec![(0, frame.as_entire_binding())],
        vec![
            (0, wgpu::BindingResource::TextureView(&view)),
            (1, wgpu::BindingResource::Sampler(&sampler)),
        ],
    ];
    let quad = gpu::draw(device, quad)?;
    let mut mesh = Draw::full_screen(&source, "mesh_vs", "mesh_fs", PANEL);
    mesh.format = LINEAR;
    mesh.vertices = 6;
    mesh.vertex_buffers = vec![
        (float4(&POINT, wgpu::VertexStepMode::Vertex), &points),
        (float4(&PLACE, wgpu::VertexStepMode::Instance), &at),
    ];
    mesh.groups = vec![vec![(0, frame.as_entire_binding())]];
    let mesh = gpu::draw(device, mesh)?;
    let mut gpu_px = gpu::halves(&gpu::read_texture(device, &quad, 8));
    gpu_px.extend(gpu::halves(&gpu::read_texture(device, &mesh, 8)));
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 4, &gpu_px),
        cpu: Out::from_unit(SIZE, 4, &[quad_cpu(), mesh_cpu()].concat()),
    })
}

fn texel(x: i64, y: i64) -> [f64; 4] {
    let x = x.clamp(0, i64::from(TEXTURE[0]) - 1) as usize;
    let y = y.clamp(0, i64::from(TEXTURE[1]) - 1) as usize;
    TEXELS[y * TEXTURE[0] as usize + x].map(|c| f64::from(c) / 255.0)
}

fn bilinear(u: f64, v: f64) -> [f64; 4] {
    let tx = u * f64::from(TEXTURE[0]) - 0.5;
    let ty = v * f64::from(TEXTURE[1]) - 0.5;
    let (x0, y0) = (tx.floor() as i64, ty.floor() as i64);
    let (fx, fy) = (tx - tx.floor(), ty - ty.floor());
    let lerp = |a: [f64; 4], b: [f64; 4], t: f64| -> [f64; 4] {
        std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
    };
    lerp(
        lerp(texel(x0, y0), texel(x0 + 1, y0), fx),
        lerp(texel(x0, y0 + 1), texel(x0 + 1, y0 + 1), fx),
        fy,
    )
}

fn covered(x: u32, y: u32) -> bool {
    COVERED.contains(&x) && COVERED.contains(&y)
}

fn across(p: u32) -> f64 {
    (f64::from(p) + 0.5 - f64::from(COVERED.start)) / f64::from(COVERED.len() as u32)
}

fn quad_cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..PANEL[1] {
        for x in 0..PANEL[0] {
            if covered(x, y) {
                let [r, g, b, _] = bilinear(across(x), across(y));
                px.extend([r, g, b, 1.0]);
            } else {
                px.extend([0.0; 4]);
            }
        }
    }
    px
}

fn mesh_cpu() -> Vec<f64> {
    let w = f64::from(SHADE);
    let mut px = Vec::new();
    for y in 0..PANEL[1] {
        for x in 0..PANEL[0] {
            if covered(x, y) {
                px.extend([w, 0.5, 1.0 - w, 1.0]);
            } else {
                px.extend([0.0; 4]);
            }
        }
    }
    px
}
