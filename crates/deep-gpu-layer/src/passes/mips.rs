use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::Ran;

const ABOVE: [u32; 2] = [3, 3];
const BELOW: [u32; 2] = [2, 2];

fn texel(x: u32, y: u32) -> [u8; 4] {
    let r = (20 * x + 40 * y) as u8;
    [r, 255 - r, 60, 255]
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/mips.wgsl"),
        twin,
        "s * 0.25",
        "s * 0.375",
    )?
    .replace("FORMAT", "rgba8unorm");
    let bytes: Vec<u8> = (0..ABOVE[1])
        .flat_map(|y| (0..ABOVE[0]).flat_map(move |x| texel(x, y)))
        .collect();
    let above = gpu::input(device, ABOVE, wgpu::TextureFormat::Rgba8Unorm, &bytes);
    let below = gpu::texture(
        device,
        BELOW,
        wgpu::TextureFormat::Rgba8Unorm,
        wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
    );
    let (above_view, below_view) = (
        above.create_view(&Default::default()),
        below.create_view(&Default::default()),
    );
    gpu::dispatch(
        device,
        &source,
        "main",
        [1, 1, 1],
        vec![vec![
            (0, wgpu::BindingResource::TextureView(&above_view)),
            (1, wgpu::BindingResource::TextureView(&below_view)),
        ]],
    )?;
    Ok(Ran {
        gpu: Out::from_bytes(BELOW, 4, &gpu::read_texture(device, &below, 4)),
        cpu: Out::from_codes(BELOW, 4, cpu()),
    })
}

fn cpu() -> Vec<f64> {
    let top = [ABOVE[0] - 1, ABOVE[1] - 1];
    let mut codes = Vec::new();
    for y in 0..BELOW[1] {
        for x in 0..BELOW[0] {
            let mut sum = [0.0; 4];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let t = texel((2 * x + dx).min(top[0]), (2 * y + dy).min(top[1]));
                for (s, c) in sum.iter_mut().zip(t) {
                    *s += f64::from(c);
                }
            }
            codes.extend(sum.map(|s| s * 0.25));
        }
    }
    codes
}
