use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::regions::{box_coverage, frame_bytes, open_ground, region_bytes, BOX_LOOK, SIZE};
use super::Ran;

const LOOKS: usize = 4;
const OUT: [u32; 2] = [4, LOOKS as u32];

fn unfound() -> Vec<u32> {
    (0..LOOKS)
        .flat_map(|_| [u32::MAX, u32::MAX, 0, 0])
        .collect()
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let bounds_source = gpu::twin(
        include_str!("../regions_bounds.wgsl"),
        twin,
        "atomicMax(&bounds[j + 2u], id.x);",
        "atomicMax(&bounds[j + 2u], id.x + 6u);",
    )?;
    let source = format!("{}\n{bounds_source}", crate::regions::source(false));
    let frame = gpu::uniform(device, &frame_bytes());
    let regions = gpu::storage(device, &region_bytes());
    let depth = open_ground(device);
    let depth_view = depth.create_view(&Default::default());
    let found = gpu::storage(device, &gpu::bytes_of_u32(&unfound()));
    gpu::dispatch(
        device,
        &source,
        "cs_bounds",
        [SIZE[0].div_ceil(8), SIZE[1].div_ceil(8), 1],
        vec![vec![
            (0, frame.as_entire_binding()),
            (1, regions.as_entire_binding()),
            (6, wgpu::BindingResource::TextureView(&depth_view)),
            (7, found.as_entire_binding()),
        ]],
    )?;
    let words = gpu::words(&gpu::read_buffer(device, &found));
    Ok(Ran {
        gpu: Out::from_codes(OUT, 1, codes(&words[..4 * LOOKS])),
        cpu: Out::from_codes(OUT, 1, codes(&cpu())),
    })
}

fn codes(words: &[u32]) -> Vec<f64> {
    words.iter().map(|&w| f64::from(w)).collect()
}

fn cpu() -> Vec<u32> {
    let mut out = unfound();
    let j = 4 * BOX_LOOK;
    for y in 0..SIZE[1] {
        for x in 0..SIZE[0] {
            if box_coverage(x, y) > 0.0 {
                out[j] = out[j].min(x);
                out[j + 1] = out[j + 1].min(y);
                out[j + 2] = out[j + 2].max(x);
                out[j + 3] = out[j + 3].max(y);
            }
        }
    }
    out
}
