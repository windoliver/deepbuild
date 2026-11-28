use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

pub(super) struct Quad {
    pub bounds: [f64; 4],
    pub color: [u8; 4],
}

pub(super) struct Frame<'q> {
    pub size: [u32; 2],
    pub ground: [u8; 4],
    pub quads: &'q [Quad],
}

const QUADS: [Quad; 2] = [
    Quad {
        bounds: [0.0, 0.0, 4.0, 4.0],
        color: [10, 200, 90, 255],
    },
    Quad {
        bounds: [4.0, 2.0, 4.0, 2.0],
        color: [240, 120, 60, 200],
    },
];

const FRAME: Frame<'static> = Frame {
    size: [8, 4],
    ground: [30, 30, 30, 255],
    quads: &QUADS,
};

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let fill = gpu::literal(include_str!("../../../deep-show/src/kit/gpu.rs"), "FILL")?;
    let source = gpu::twin(&fill, twin, "return o.color;", "return o.color.bgra;")?;
    filled(device, &source, &FRAME)
}

fn clip(f: &Frame<'_>, px: f64, py: f64) -> [f32; 2] {
    [
        (px / f64::from(f.size[0]) * 2.0 - 1.0) as f32,
        (1.0 - py / f64::from(f.size[1]) * 2.0) as f32,
    ]
}

pub(super) fn filled(device: &Device, source: &str, f: &Frame<'_>) -> Result<Ran, String> {
    let mut verts: Vec<f32> = Vec::new();
    for q in f.quads {
        let [x, y, w, h] = q.bounds;
        let c = q.color.map(|v| f32::from(v) / 255.0);
        let corners = [
            clip(f, x, y),
            clip(f, x + w, y),
            clip(f, x + w, y + h),
            clip(f, x, y + h),
        ];
        for k in [0, 1, 2, 0, 2, 3] {
            verts.extend_from_slice(&corners[k]);
            verts.extend_from_slice(&c);
        }
    }
    let vertices = gpu::buffer(
        device,
        &gpu::bytes_of_f32(&verts),
        wgpu::BufferUsages::VERTEX,
    );
    let attributes = wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4];
    let layout = wgpu::VertexBufferLayout {
        array_stride: 24,
        step_mode: wgpu::VertexStepMode::Vertex,
        attributes: &attributes,
    };
    let mut d = Draw::full_screen(source, "vs_main", "fs_main", f.size);
    d.vertices = (verts.len() / 6) as u32;
    d.vertex_buffers = vec![(layout, &vertices)];
    let [r, g, b, a] = f.ground.map(|v| f64::from(v) / 255.0);
    d.clear = wgpu::Color { r, g, b, a };
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(f.size, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_unit(f.size, 4, &cpu(f)),
    })
}

fn cpu(f: &Frame<'_>) -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..f.size[1] {
        for x in 0..f.size[0] {
            let (cx, cy) = (f64::from(x) + 0.5, f64::from(y) + 0.5);
            let color = f
                .quads
                .iter()
                .rev()
                .find(|q| {
                    let [qx, qy, qw, qh] = q.bounds;
                    cx > qx && cx < qx + qw && cy > qy && cy < qy + qh
                })
                .map_or(f.ground, |q| q.color);
            px.extend(color.map(|v| f64::from(v) / 255.0));
        }
    }
    px
}
