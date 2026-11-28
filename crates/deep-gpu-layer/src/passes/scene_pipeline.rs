use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [8, 8];
const PIPELINE: u32 = 3;
const COLOR_BGRA: [u8; 4] = [16, 128, 240, 255];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        &crate::scene::pipeline_source(PIPELINE, COLOR_BGRA),
        twin,
        "uv * vec2(2.0, -2.0)",
        "uv * vec2(1.0, -1.0)",
    )?;
    let mut d = Draw::full_screen(&source, "vertex", "fragment", SIZE);
    d.format = FORMAT;
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_bytes(SIZE, 4, &cpu()),
    })
}

fn cpu() -> Vec<u8> {
    COLOR_BGRA.repeat((SIZE[0] * SIZE[1]) as usize)
}
