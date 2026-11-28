use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

pub(super) const SIZE: [u32; 2] = [16, 16];
const OUTER: [u8; 4] = [200, 40, 0, 255];
const INNER: [u8; 4] = [20, 100, 240, 255];
const BOX_CENTRE: [f64; 2] = [8.25, 8.0];
const BOX_LENS: [f64; 3] = [8.0, 8.0, 1e6];
pub(super) const BOX_LOOK: usize = 1;

pub(super) fn frame_bytes() -> Vec<u8> {
    let [w, h] = SIZE.map(|n| n as f32);
    let mut bytes = gpu::bytes_of_f32(&[0.0; 20]);
    bytes.extend(gpu::bytes_of_f32(&[1.0, 0.0, 0.0, 1.0]));
    bytes.extend(gpu::bytes_of_f32(&[w, h, 1.0, 1.0]));
    bytes.extend(gpu::bytes_of_f32(&[0.0, 1.0, 0.0, 0.0]));
    bytes.extend(gpu::bytes_of_u32(&[1, 1, 1, 0]));
    bytes.extend(gpu::bytes_of_f32(&[0.0; 8]));
    bytes
}

pub(super) fn region_bytes() -> Vec<u8> {
    let f = |v: f64| v as f32;
    let [cx, cy] = BOX_CENTRE;
    let [lx, ly, lz] = BOX_LENS;
    let mut bytes = gpu::bytes_of_f32(&[
        f(1.0 / lx),
        0.0,
        0.0,
        f(-cx / lx),
        0.0,
        f(1.0 / ly),
        0.0,
        f(-cy / ly),
        0.0,
        0.0,
        f(1.0 / lz),
        0.0,
        f(lx),
        f(ly),
        f(lz),
        0.0,
        f(cx),
        f(cy),
        0.0,
        0.0,
    ]);
    bytes.extend(gpu::bytes_of_u32(&[0, BOX_LOOK as u32, 0, 0, 0, 0, 0, 0]));
    bytes.extend(gpu::bytes_of_f32(&[1.0, 0.0, 0.0, 0.0]));
    bytes
}

pub(super) fn box_coverage(x: u32, y: u32) -> f64 {
    let p = [f64::from(x) + 0.5, f64::from(y) + 0.5, 0.0];
    let centre = [BOX_CENTRE[0], BOX_CENTRE[1], 0.0];
    let d: Vec<f64> = (0..3)
        .map(|i| ((p[i] - centre[i]) / BOX_LENS[i]).abs() * BOX_LENS[i] - 0.5 * BOX_LENS[i])
        .collect();
    let inside = d.iter().copied().fold(f64::MIN, f64::max);
    let sd = if inside <= 0.0 {
        inside
    } else {
        d.iter().map(|v| v.max(0.0).powi(2)).sum::<f64>().sqrt()
    };
    (0.5 - sd).clamp(0.0, 1.0)
}

fn flat(device: &Device, color: [u8; 4]) -> wgpu::Texture {
    let bytes: Vec<u8> = (0..SIZE[0] * SIZE[1]).flat_map(|_| color).collect();
    gpu::input(device, SIZE, wgpu::TextureFormat::Rgba8Unorm, &bytes)
}

pub(super) fn open_ground(device: &Device) -> wgpu::Texture {
    flat(device, [0; 4])
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        &crate::regions::source(false),
        twin,
        "return clamp(0.5 - sd, 0.0, 1.0);",
        "return clamp(0.5 + sd, 0.0, 1.0);",
    )?;
    let frame = gpu::uniform(device, &frame_bytes());
    let regions = gpu::storage(device, &region_bytes());
    let looks = [flat(device, OUTER), flat(device, INNER)];
    let depth = open_ground(device);
    let views: Vec<wgpu::TextureView> = [&looks[0], &looks[1], &looks[0], &looks[0], &depth]
        .iter()
        .map(|t| t.create_view(&Default::default()))
        .collect();
    let mut d = Draw::full_screen(&source, "vs", "fs", SIZE);
    let mut group = vec![
        (0, frame.as_entire_binding()),
        (1, regions.as_entire_binding()),
    ];
    group.extend(
        views
            .iter()
            .enumerate()
            .map(|(k, v)| (k as u32 + 2, wgpu::BindingResource::TextureView(v))),
    );
    d.groups = vec![group];
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            let m = box_coverage(x, y);
            let mut share = [1.0, 0.0];
            share[0] *= 1.0 - m;
            share[1] *= 1.0 - m;
            share[BOX_LOOK] += m;
            px.extend((0..4).map(|c| {
                (share[0] * f64::from(OUTER[c]) + share[1] * f64::from(INNER[c])) / 255.0
            }));
        }
    }
    px
}
