use deep_gpu::device::Device;
use deep_scene3d_render::LINEAR;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [2, 2];
const LOOPS: u32 = 1;

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../burn.wgsl"),
        twin,
        "vec4f(x * 0.02,",
        "vec4f(x * 0.2,",
    )?;
    let loops = gpu::uniform(device, &gpu::bytes_of_u32(&[LOOPS, 0, 0, 0]));
    let mut d = Draw::full_screen(&source, "full", "burn_fs", SIZE);
    d.format = LINEAR;
    d.groups = vec![vec![(0, loops.as_entire_binding())]];
    let tex = gpu::draw(device, d)?;
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 4, &gpu::halves(&gpu::read_texture(device, &tex, 8))),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn burned(x: f32, y: f32) -> f32 {
    let along = x * 12.9898f32 + y * 78.233f32;
    let hashed = along.sin() * 43_758.547f32;
    let mut v = hashed - hashed.floor();
    for _ in 0..LOOPS {
        let stepped = v * 3.7f32 + 0.1234f32;
        v = stepped - stepped.floor();
    }
    v * 0.02f32
}

fn cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            let v = f64::from(burned(x as f32 + 0.5, y as f32 + 0.5));
            px.extend([v, v, v, 0.0]);
        }
    }
    px
}
