use deep_gpu::device::Device;

use super::gpu;
use super::kit_fill::{filled, Frame, Quad};
use super::Ran;

const QUADS: [Quad; 1] = [Quad {
    bounds: [2.0, 1.0, 4.0, 2.0],
    color: [100, 50, 150, 255],
}];

const FRAME: Frame<'static> = Frame {
    size: [8, 4],
    ground: [255, 255, 255, 255],
    quads: &QUADS,
};

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let pass = gpu::literal(
        include_str!("../../../deep-show/src/kit/modules.rs"),
        "GPU_PASS",
    )?;
    let source = gpu::twin(
        &pass,
        twin,
        "return o.color;",
        "return o.color + vec4<f32>(16.0 / 255.0, 0.0, 0.0, 0.0);",
    )?;
    filled(device, &source, &FRAME)
}
