use deep_gpu::device::Device;
use deep_scene3d_render::LINEAR;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [8, 8];
const COLOR: [f64; 4] = [0.2, 0.4, 0.6, 1.0];
const FRAGMENT: &str =
    "@fragment fn main() -> @location(0) vec4<f32> { return vec4<f32>(0.2, 0.4, 0.6, 1.0); }\n";
const VERTEX_AT: &str = "let vs = ";

fn vertex() -> Result<String, String> {
    let file = include_str!("../effects/check_operator.rs");
    let at = file
        .find(VERTEX_AT)
        .ok_or("check_operator.rs no longer binds its vertex as `let vs`")?;
    gpu::literal(
        &format!("VS: &str = {}", &file[at + VERTEX_AT.len()..]),
        "VS",
    )
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        &format!("{}{FRAGMENT}", vertex()?),
        twin,
        "p * 2.0 - 1.0",
        "p * 1.0 - 1.0",
    )?;
    let mut d = Draw::full_screen(&source, "vs", "main", SIZE);
    d.format = LINEAR;
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 4, &gpu::halves(&gpu::read_texture(device, &tex, 8))),
        cpu: Out::from_unit(SIZE, 4, &COLOR.repeat((SIZE[0] * SIZE[1]) as usize)),
    })
}
