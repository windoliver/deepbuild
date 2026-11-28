use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::Ran;

const SOURCE: [u32; 8] = [10, 20, 30, 40, 50, 60, 70, 80];
const FLAGS: [u32; 8] = [1, 0, 1, 1, 0, 0, 1, 0];
const SIZE: [u32; 2] = [13, 1];

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/planted.wgsl"),
        twin,
        "rev_src[p.n - 1u - g.x]",
        "rev_src[(p.n - 2u - g.x) % p.n]",
    )?;
    let n = SOURCE.len() as u32;
    let params = gpu::uniform(device, &gpu::bytes_of_u32(&[n, 0, 0, 0]));
    let src = gpu::storage(device, &gpu::bytes_of_u32(&SOURCE));
    let reversed = gpu::storage(device, &gpu::bytes_of_u32(&[0; 8]));
    gpu::dispatch(
        device,
        &source,
        "reverse",
        [1, 1, 1],
        vec![vec![
            (0, params.as_entire_binding()),
            (1, src.as_entire_binding()),
            (2, reversed.as_entire_binding()),
        ]],
    )?;
    let flags = gpu::storage(device, &gpu::bytes_of_u32(&FLAGS));
    let appended = gpu::storage(device, &gpu::bytes_of_u32(&[0; 8]));
    let count = gpu::storage(device, &gpu::bytes_of_u32(&[0]));
    gpu::dispatch(
        device,
        &source,
        "append",
        [1, 1, 1],
        vec![vec![
            (0, params.as_entire_binding()),
            (1, src.as_entire_binding()),
            (2, flags.as_entire_binding()),
            (3, appended.as_entire_binding()),
            (4, count.as_entire_binding()),
        ]],
    )?;
    let mut gpu_words = gpu::words(&gpu::read_buffer(device, &reversed))[..8].to_vec();
    let added = gpu::words(&gpu::read_buffer(device, &count))[0];
    let mut kept = gpu::words(&gpu::read_buffer(device, &appended))[..4].to_vec();
    kept.sort_unstable();
    gpu_words.push(added);
    gpu_words.extend(kept);
    Ok(Ran {
        gpu: Out::from_codes(SIZE, 1, gpu_words.into_iter().map(f64::from).collect()),
        cpu: Out::from_codes(SIZE, 1, cpu()),
    })
}

fn cpu() -> Vec<f64> {
    let mut out: Vec<u32> = SOURCE.iter().rev().copied().collect();
    let kept: Vec<u32> = SOURCE
        .iter()
        .zip(FLAGS)
        .filter(|(_, f)| *f != 0)
        .map(|(s, _)| *s)
        .collect();
    out.push(kept.len() as u32);
    out.extend(kept);
    out.into_iter().map(f64::from).collect()
}
