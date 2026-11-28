use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SIZE: [u32; 2] = [16, 16];
const LOOPS: u32 = 1;

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../tick.wgsl"),
        twin,
        "x * 3.7 + 0.1234",
        "x * 3.7 + 0.2234",
    )?;
    let loops = gpu::uniform(device, &gpu::bytes_of_u32(&[LOOPS, 0, 0, 0]));
    let mut d = Draw::full_screen(&source, "full", "spin", SIZE);
    d.groups = vec![vec![(0, loops.as_entire_binding())]];
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
            let mut v = ((f64::from(x) + 0.5) * 0.001 + (f64::from(y) + 0.5) * 0.002).fract();
            for _ in 0..LOOPS {
                v = (v * 3.7 + 0.1234).fract();
            }
            px.extend([v, v, v, 1.0]);
        }
    }
    px
}
