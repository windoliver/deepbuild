use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [5, 5];
const POINT: [u32; 2] = [2, 2];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let shader = gpu::literal(include_str!("../faults.rs"), "SHADER")?;
    let source = gpu::twin(
        &shader,
        twin,
        "vec4<f32>(0.0, 0.0, 0.0, 1.0)",
        "vec4<f32>(0.4, 0.0, 0.0, 1.0)",
    )?;
    let mut d = Draw::full_screen(&source, "vs", "fs", SIZE);
    d.topology = wgpu::PrimitiveTopology::PointList;
    d.vertices = 1;
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_bytes(SIZE, 4, &cpu()),
    })
}

fn cpu() -> Vec<u8> {
    let mut px = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            px.extend(if [x, y] == POINT { [255; 4] } else { [0; 4] });
        }
    }
    px
}
