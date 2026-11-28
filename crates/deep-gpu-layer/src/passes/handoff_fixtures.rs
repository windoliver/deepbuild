use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [16, 16];
const FLAT_BYTES: [u8; 4] = [51, 102, 153, 255];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let file = include_str!("../fixtures.rs");
    let vertex = gpu::literal(file, "VERTEX")?;
    let flat = gpu::literal(file, "FLAT")?;
    let source = gpu::twin(
        &format!("{vertex}{flat}"),
        twin,
        "uv * 2.0 - 1.0",
        "uv * 1.0 - 1.0",
    )?;
    let tex = gpu::draw(device, Draw::full_screen(&source, "vs", "fs", SIZE))?;
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_bytes(SIZE, 4, &FLAT_BYTES.repeat((SIZE[0] * SIZE[1]) as usize)),
    })
}
