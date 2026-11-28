use deep_canvas_effects::particles::eval::{self, Baked, FLOATS};
use deep_canvas_effects::particles::pack;
use deep_canvas_effects::particles::spec::{Launch, Motion, Shape, Space, Spec};
use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::Ran;

const SLOTS: u32 = 4;
const T: f64 = 2.5;
const CODES_PER_UNIT: f64 = 256.0;

fn emitter() -> Baked {
    let spec = Spec {
        count: SLOTS,
        life: [4.0, 4.0],
        shape: Shape::Point,
        on_surface: false,
        rate: 1.0,
        span: 10.0,
        motion: Motion::Ballistic {
            launch: Launch::Vector([1.0, 2.0, 0.0]),
            gravity: [0.0, -2.0, 0.0],
            drag: 0.0,
        },
        bounce: None,
        land: None,
        kill: None,
        turbulence: None,
        bursts: Vec::new(),
        inherit: [0.0, 0.0],
        follow: false,
        space: Space::Local,
        dimensions: 3,
        per_edge: None,
    };
    Baked::new("particles_kernel.fixture", spec, 7, [0.0, 1.0, 0.0])
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(
        include_str!("../../../deep-effects-render/src/closed.wgsl"),
        twin,
        "return vec3<f32>(a, 0.5 * a * a, 1.0);",
        "return vec3<f32>(a, 0.25 * a * a, 1.0);",
    )?;
    let baked = emitter();
    let tables = pack::tables(&baked);
    let words = pack::uniform(&baked, T, &tables, 0);
    let uniform = gpu::uniform(device, &gpu::bytes_of_u32(&words));
    let tab = gpu::storage(device, &gpu::bytes_of_u32(&tables.words));
    let inst = gpu::storage(device, &vec![0u8; SLOTS as usize * FLOATS * 4]);
    let now = gpu::storage(device, &gpu::bytes_of_f32(&[0.0; 4]));
    gpu::dispatch(
        device,
        &source,
        "main",
        [1, 1, 1],
        vec![vec![
            (0, uniform.as_entire_binding()),
            (1, tab.as_entire_binding()),
            (2, inst.as_entire_binding()),
            (3, now.as_entire_binding()),
        ]],
    )?;
    let columns = gpu::floats(&gpu::read_buffer(device, &inst));
    let size = [SLOTS, 1];
    let codes = |values: &[f64]| -> Vec<f64> {
        values[..SLOTS as usize * FLOATS]
            .iter()
            .map(|v| v * CODES_PER_UNIT)
            .collect()
    };
    Ok(Ran {
        gpu: Out::from_codes(size, FLOATS, codes(&columns)),
        cpu: Out::from_codes(size, FLOATS, codes(&eval::columns(&baked, T))),
    })
}
