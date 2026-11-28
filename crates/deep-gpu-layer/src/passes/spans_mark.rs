use deep_gpu::device::Device;

use super::gpu::{self, Draw, Out};
use super::Ran;

const SPIN_SIZE: [u32; 2] = [4, 4];
const LOOPS: u32 = 1;
const SIZE: [u32; 2] = [SPIN_SIZE[0] * SPIN_SIZE[1] + 1, 1];
const START: [u8; 16] = [
    200, 100, 50, 255, 10, 20, 30, 40, 60, 70, 80, 90, 0, 128, 255, 64,
];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let mark = gpu::twin(deep_gpu::spans::MARK, twin, "vec2u(0u)", "vec2u(1u)")?;
    let start = gpu::input(device, [2, 2], wgpu::TextureFormat::Rgba8Unorm, &START);
    let view = start.create_view(&Default::default());
    let sink = gpu::storage(device, &[0; 16]);
    gpu::dispatch(
        device,
        &mark,
        "mark",
        [1, 1, 1],
        vec![vec![
            (0, wgpu::BindingResource::TextureView(&view)),
            (1, sink.as_entire_binding()),
        ]],
    )?;
    let spin = gpu::literal(include_str!("../../../deep-gpu/src/spans.rs"), "SPIN")?
        .replace("LOOPS", &format!("{LOOPS}u"));
    let spun = gpu::draw(device, Draw::full_screen(&spin, "full", "spin", SPIN_SIZE))?;
    let mut codes: Vec<f64> = gpu::read_texture(device, &spun, 4)
        .into_iter()
        .map(f64::from)
        .collect();
    codes.extend(
        gpu::floats(&gpu::read_buffer(device, &sink))
            .into_iter()
            .take(4)
            .map(|v| v * 255.0),
    );
    Ok(Ran {
        gpu: Out::from_codes(SIZE, 4, codes),
        cpu: Out::from_unit(SIZE, 4, &cpu()),
    })
}

fn cpu() -> Vec<f64> {
    let mut px = Vec::new();
    for y in 0..SPIN_SIZE[1] {
        for x in 0..SPIN_SIZE[0] {
            let mut v = ((f64::from(x) + 0.5) * 0.001 + (f64::from(y) + 0.5) * 0.002).fract();
            for _ in 0..LOOPS {
                v = (v * 3.7 + 0.1234).fract();
            }
            px.extend([v, v, v, 1.0]);
        }
    }
    px.extend(START[..4].iter().map(|&c| f64::from(c) / 255.0));
    px
}
