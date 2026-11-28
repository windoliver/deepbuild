use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::Ran;

const SIZE: [u32; 2] = [6, 5];
const VALUE: [f32; 4] = [0.2, 0.4, 0.6, 1.0];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/fill.wgsl"),
        twin,
        "textureStore(tex, g.SWZ, VALUE)",
        "textureStore(tex, g.SWZ, VALUE * 0.5)",
    )?
    .replace("FORMAT", "rgba8unorm")
    .replace("DIM", "2d")
    .replace("SWZ", "xy")
    .replace("VALUE", "fill.v");
    let fill = gpu::uniform(device, &gpu::bytes_of_f32(&VALUE));
    let tex = gpu::texture(
        device,
        SIZE,
        wgpu::TextureFormat::Rgba8Unorm,
        wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
    );
    let view = tex.create_view(&Default::default());
    gpu::dispatch(
        device,
        &source,
        "main",
        [SIZE[0].div_ceil(4), SIZE[1].div_ceil(4), 1],
        vec![vec![
            (0, fill.as_entire_binding()),
            (1, wgpu::BindingResource::TextureView(&view)),
        ]],
    )?;
    let value = VALUE.map(f64::from);
    let cpu: Vec<f64> = (0..SIZE[0] * SIZE[1]).flat_map(|_| value).collect();
    Ok(Ran {
        gpu: Out::from_bytes(SIZE, 4, &gpu::read_texture(device, &tex, 4)),
        cpu: Out::from_unit(SIZE, 4, &cpu),
    })
}
