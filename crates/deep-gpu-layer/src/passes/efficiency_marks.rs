use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [8, 8];

struct Mark {
    rect: [f32; 4],
    radius: f32,
    color: [u8; 3],
}

const MARKS: [Mark; 3] = [
    Mark {
        rect: [0.0, 0.0, 8.0, 8.0],
        radius: 0.0,
        color: [16, 32, 48],
    },
    Mark {
        rect: [1.0, 1.0, 4.0, 4.0],
        radius: 0.0,
        color: [200, 100, 50],
    },
    Mark {
        rect: [3.0, 3.0, 4.0, 4.0],
        radius: 2.0,
        color: [20, 220, 120],
    },
];

fn instances() -> Vec<u8> {
    let mut out = Vec::new();
    for m in &MARKS {
        let mut one = [0u8; 32];
        for (k, v) in m.rect.iter().chain([&m.radius]).enumerate() {
            one[4 * k..4 * k + 4].copy_from_slice(&v.to_le_bytes());
        }
        one[20..23].copy_from_slice(&m.color);
        one[23] = 255;
        out.extend(one);
    }
    out
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let shader = gpu::literal(
        include_str!("../../../deep-show/src/efficiency.rs"),
        "SHADER",
    )?;
    let source = gpu::twin(&shader, twin, "in.color.rgb * a", "in.color.bgr * a")?;
    let view = gpu::uniform(
        device,
        &gpu::bytes_of_f32(&[SIZE[0] as f32, SIZE[1] as f32, 0.0, 0.0]),
    );
    let marks = gpu::buffer(device, &instances(), wgpu::BufferUsages::VERTEX);
    let attributes = wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32, 2 => Unorm8x4];
    let layout = wgpu::VertexBufferLayout {
        array_stride: 32,
        step_mode: wgpu::VertexStepMode::Instance,
        attributes: &attributes,
    };
    let mut d = Draw::full_screen(&source, "vs", "fs", SIZE);
    d.topology = wgpu::PrimitiveTopology::TriangleStrip;
    d.vertices = 4;
    d.instances = MARKS.len() as u32;
    d.blend = Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING);
    d.groups = vec![vec![(0, view.as_entire_binding())]];
    d.vertex_buffers = vec![(layout, &marks)];
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn coverage(m: &Mark, p: [f64; 2]) -> Option<f64> {
    let [x, y, w, h] = m.rect.map(f64::from);
    if p[0] <= x || p[0] >= x + w || p[1] <= y || p[1] >= y + h {
        return None;
    }
    let half = [w * 0.5, h * 0.5];
    let local = [p[0] - x - half[0], p[1] - y - half[1]];
    let r = f64::from(m.radius).min(half[0].min(half[1]));
    let q = [local[0].abs() - half[0] + r, local[1].abs() - half[1] + r];
    let outside = q[0].max(0.0).hypot(q[1].max(0.0));
    let d = outside + q[0].max(q[1]).min(0.0) - r;
    Some((0.5 - d).clamp(0.0, 1.0))
}

fn cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            let p = [f64::from(x) + 0.5, f64::from(y) + 0.5];
            let mut dst = [0.0; 4];
            for m in &MARKS {
                let Some(a) = coverage(m, p) else { continue };
                let c = m.color.map(|v| f64::from(v) / 255.0);
                let src = [c[0] * a, c[1] * a, c[2] * a, a];
                for k in 0..4 {
                    dst[k] = src[k] + dst[k] * (1.0 - a);
                }
            }
            px.extend(dst);
        }
    }
    px
}
