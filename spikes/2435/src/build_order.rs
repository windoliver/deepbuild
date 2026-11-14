//! Build order: a scene of one mesh, and a second mesh with a new bottom level added at frame 2,
//! drawn 100 times in each of three forms: both levels in one build, two builds in one encoder, and
//! two command buffers submitted in order. A ray from the camera through the added mesh reads a hit
//! or the sky.

use serde_json::{json, Value};

use crate::gpu::{self, Gpu};

pub const RUNS: u32 = 100;
/// The form #475 takes when it holds, since its encode workers record writer layers into separate
/// command buffers, then the narrower forms.
pub const FORMS: [&str; 3] = ["two_command_buffers", "one_encoder", "one_build"];
const FIRST: u32 = 1;
const ADDED: u32 = 2;

fn quad(x0: f32, x1: f32) -> [[f32; 3]; 4] {
    [[x0, 0.3, 0.0], [x1, 0.3, 0.0], [x1, 0.7, 0.0], [x0, 0.7, 0.0]]
}

struct Run {
    /// Frame 2's answer for the ray through the added mesh.
    added: u32,
    /// Frames 0 and 1 read the sky there and the first mesh beside it, and frame 2 still the first mesh.
    steady: bool,
    error: Option<String>,
}

/// One run of a form. `plant`: the builder records or submits the top level before the bottom level.
fn run_once(gpu: &Gpu, form: &str, plant: bool, pipeline: &wgpu::ComputePipeline) -> Run {
    let fast_trace = wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE;
    let build = wgpu::AccelerationStructureUpdateMode::Build;
    let answers = gpu.storage("answers", 8);
    let mesh_a = gpu::mesh(gpu, &quad(0.05, 0.45), &[0, 1, 2, 0, 2, 3], true, wgpu::BufferUsages::empty());
    let blas_a = gpu::blas(gpu, &mesh_a, fast_trace, build);
    let mut tlas = gpu::tlas(gpu, 2);
    tlas[0] = gpu::instance(&blas_a, FIRST);
    let mut errors = Vec::new();
    let mut steady = true;
    let clear = |answers: &wgpu::Buffer| {
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        enc.clear_buffer(answers, 0, None);
        gpu.queue.submit([enc.finish()]);
    };
    let trace = |enc: &mut wgpu::CommandEncoder, tlas: &wgpu::Tlas| {
        let group = gpu.bind(pipeline, &[(0, tlas.as_binding()), (1, answers.as_entire_binding())]);
        gpu::dispatch(enc, pipeline, &group, 1);
    };
    for frame in 0..2 {
        clear(&answers);
        let ((), err) = gpu.scoped(|| {
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            if frame == 0 {
                enc.build_acceleration_structures(&[gpu::build_entry(&blas_a, &mesh_a)], [&tlas]);
            } else {
                enc.build_acceleration_structures(&[], [&tlas]);
            }
            trace(&mut enc, &tlas);
            gpu.queue.submit([enc.finish()]);
        });
        errors.extend(err);
        steady &= gpu.read_u32(&answers) == [0, FIRST];
    }
    // Frame 2: the added mesh, its bottom level built for the first time.
    clear(&answers);
    let mesh_b = gpu::mesh(gpu, &quad(0.55, 0.95), &[0, 1, 2, 0, 2, 3], true, wgpu::BufferUsages::empty());
    let blas_b = gpu::blas(gpu, &mesh_b, fast_trace, build);
    tlas[1] = gpu::instance(&blas_b, ADDED);
    let ((), err) = gpu.scoped(|| {
        let enc = || gpu.device.create_command_encoder(&Default::default());
        let entry = [gpu::build_entry(&blas_b, &mesh_b)];
        match (form, plant) {
            ("one_build", false) => {
                let mut e = enc();
                e.build_acceleration_structures(&entry, [&tlas]);
                trace(&mut e, &tlas);
                gpu.queue.submit([e.finish()]);
            }
            ("one_encoder", false) => {
                let mut e = enc();
                e.build_acceleration_structures(&entry, []);
                e.build_acceleration_structures(&[], [&tlas]);
                trace(&mut e, &tlas);
                gpu.queue.submit([e.finish()]);
            }
            ("two_command_buffers", false) => {
                let (mut bottom, mut top) = (enc(), enc());
                bottom.build_acceleration_structures(&entry, []);
                top.build_acceleration_structures(&[], [&tlas]);
                trace(&mut top, &tlas);
                gpu.queue.submit([bottom.finish(), top.finish()]);
            }
            ("two_command_buffers", true) => {
                let (mut top, mut bottom, mut draw) = (enc(), enc(), enc());
                top.build_acceleration_structures(&[], [&tlas]);
                bottom.build_acceleration_structures(&entry, []);
                trace(&mut draw, &tlas);
                gpu.queue.submit([top.finish(), bottom.finish(), draw.finish()]);
            }
            _ => {
                // One build or one encoder, planted: the top level recorded before the bottom level.
                let mut e = enc();
                e.build_acceleration_structures(&[], [&tlas]);
                e.build_acceleration_structures(&entry, []);
                trace(&mut e, &tlas);
                gpu.queue.submit([e.finish()]);
            }
        }
    });
    errors.extend(err);
    let got = gpu.read_u32(&answers);
    steady &= got[1] == FIRST;
    errors.extend(gpu.uncaught.lock().unwrap().drain(..));
    Run { added: got[0], steady, error: errors.into_iter().next() }
}

pub fn run(gpu: &Gpu, plant: bool) -> Value {
    let pipeline = gpu.pipeline(include_str!("build_order.wgsl"), "main");
    let mut out = serde_json::Map::new();
    for form in FORMS {
        let (mut drawn, mut steady, mut sky_runs) = (0u32, 0u32, Vec::new());
        let mut error = None;
        for i in 0..RUNS {
            let r = run_once(gpu, form, plant, &pipeline);
            if r.added == ADDED {
                drawn += 1;
            } else {
                sky_runs.push(i);
            }
            steady += r.steady as u32;
            if error.is_none() {
                error = r.error;
            }
        }
        out.insert(
            form.to_string(),
            json!({"runs": RUNS, "hit": drawn, "sky": sky_runs.len(), "steady": steady, "first_sky_run": sky_runs.first(), "error": error}),
        );
    }
    let holds = |f: &Value| f["hit"] == RUNS && f["steady"] == RUNS;
    let named = FORMS.iter().find(|f| holds(&out[**f])).copied().unwrap_or(FORMS[0]);
    let n = &out[named];
    let pass = holds(n);
    json!({
        "status": if pass { "PASS" } else { "FAIL" },
        "reason": if pass {
            format!("{named}: the added mesh drawn in frame 2, the frame that adds it, in {RUNS} of {RUNS} runs")
        } else {
            format!("{named}: frame 2 reads the sky through the added mesh in {} of {RUNS} runs", n["sky"])
        },
        "form_for_475": named,
        "added_frame": 2,
        "runs": RUNS,
        "forms": out,
    })
}
