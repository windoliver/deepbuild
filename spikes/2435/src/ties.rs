//! Ties: two quads on the same four vertices, one opaque and emitting 100 cd/m², one alpha-masked and
//! clear over half its area, above a diffuse floor. 100,000 rays in each of 10 runs, with the floor's
//! irradiance from the panel compared with the CPU reference.

use std::f64::consts::PI;

use serde_json::{json, Value};

use crate::gpu::{self, Gpu, Rng};

pub const RAYS: usize = 100_000;
pub const RUNS: usize = 10;
pub const LUMINANCE: f64 = 100.0;
const PANEL: u32 = 1;
const DECAL: u32 = 2;
const FLOOR: u32 = 3;
const HALF: f64 = 0.5;
const HEIGHT: f64 = 1.0;
/// The floor point whose irradiance is read.
const ORIGIN: [f64; 2] = [0.1, 0.05];
/// Rays keep this far (m) from the panel's edges and the decal's clear line where they cross the
/// panel's plane, so f32 and f64 agree on where they land.
const MARGIN: f64 = 1e-4;
const SEED: u64 = 2435_0003;
pub const RULE: &str = "a surface on the same vertices as another is merged with it into one primitive at build, its layers ordered opaque first, so the opaque surface answers and the tie never reaches traversal";

fn quad() -> [[f32; 3]; 4] {
    let (h, z) = (HALF as f32, HEIGHT as f32);
    [[-h, -h, z], [h, -h, z], [h, h, z], [-h, h, z]]
}

/// Cosine-weighted directions up from the floor point, each kept off the panel's edges and the
/// decal's line where it crosses the panel's plane.
fn directions() -> Vec<[f32; 4]> {
    let mut rng = Rng::new(SEED);
    let mut out = Vec::with_capacity(RAYS);
    while out.len() < RAYS {
        let (r1, r2) = (rng.unit(), rng.unit());
        let (phi, s) = (2.0 * PI * r1, r2.sqrt());
        let d = [(phi.cos() * s) as f32, (phi.sin() * s) as f32, (1.0 - r2).sqrt() as f32];
        if d[2] <= 1e-3 {
            continue;
        }
        let [x, y] = cross(d);
        let near = |v: f64| (v.abs() - HALF).abs() < MARGIN;
        if near(x) || near(y) || x.abs() < MARGIN {
            continue;
        }
        out.push([d[0], d[1], d[2], 0.0]);
    }
    out
}

/// Where a direction crosses the panel's plane, in f64.
fn cross(d: [f32; 3]) -> [f64; 2] {
    let (o, d) = ([ORIGIN[0] as f32 as f64, ORIGIN[1] as f32 as f64], d.map(|c| c as f64));
    let t = HEIGHT / d[2];
    [o[0] + t * d[0], o[1] + t * d[1]]
}

/// The reference, in f64: a ray that reaches the panel's plane inside it is answered by the panel,
/// the opaque emitting surface; the decal on its vertices only ties with it there.
fn reference(dirs: &[[f32; 4]]) -> Vec<u32> {
    dirs.iter()
        .map(|d| {
            let [x, y] = cross([d[0], d[1], d[2]]);
            if x.abs() < HALF && y.abs() < HALF { PANEL } else { 0 }
        })
        .collect()
}

/// The panel's irradiance at the floor point in closed form: a parallel rectangle split at the
/// point's foot into four with a corner above it.
fn analytic() -> f64 {
    let corner = |a: f64, b: f64| {
        let sign = a.signum() * b.signum();
        let (a, b) = (a.abs() / HEIGHT, b.abs() / HEIGHT);
        let (sa, sb) = ((1.0 + a * a).sqrt(), (1.0 + b * b).sqrt());
        sign * (a / sa * (b / sa).atan() + b / sb * (a / sb).atan()) / (2.0 * PI)
    };
    let (x0, x1, y0, y1) = (-HALF - ORIGIN[0], HALF - ORIGIN[0], -HALF - ORIGIN[1], HALF - ORIGIN[1]);
    let f = corner(x1, y1) - corner(x0, y1) - corner(x1, y0) + corner(x0, y0);
    PI * LUMINANCE * f
}

fn irradiance(answers: &[u32]) -> f64 {
    PI * LUMINANCE * answers.iter().filter(|a| **a == PANEL).count() as f64 / answers.len() as f64
}

/// One run of one form, every structure built fresh.
fn trace(gpu: &Gpu, form: &str, pipeline: &wgpu::ComputePipeline, dirs: &wgpu::Buffer, params: &wgpu::Buffer) -> (Vec<u32>, Option<String>) {
    let fast_trace = wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE;
    let build = wgpu::AccelerationStructureUpdateMode::Build;
    let idx = [0u32, 1, 2, 0, 2, 3];
    let floor_v = [[-5.0f32, -5.0, 0.0], [5.0, -5.0, 0.0], [5.0, 5.0, 0.0], [-5.0, 5.0, 0.0]];
    let floor = gpu::mesh(gpu, &floor_v, &idx, true, wgpu::BufferUsages::empty());
    // The panel's layers as the build hands them over: as built, two surfaces; merged, one primitive
    // whose layers the candidate test runs in order.
    let surfaces: Vec<(bool, u32)> = match form {
        "as_built" => vec![(true, PANEL), (false, DECAL)],
        "merge" => vec![(true, PANEL | (DECAL << 8))],
        _ => vec![(false, DECAL | (PANEL << 8))],
    };
    let meshes: Vec<(gpu::Mesh, u32)> =
        surfaces.iter().map(|(opaque, layers)| (gpu::mesh(gpu, &quad(), &idx, *opaque, wgpu::BufferUsages::empty()), *layers)).collect();
    let floor_blas = gpu::blas(gpu, &floor, fast_trace, build);
    let blases: Vec<wgpu::Blas> = meshes.iter().map(|(m, _)| gpu::blas(gpu, m, fast_trace, build)).collect();
    let mut tlas = gpu::tlas(gpu, 1 + blases.len() as u32);
    tlas[0] = gpu::instance(&floor_blas, FLOOR);
    for (i, (b, (_, layers))) in blases.iter().zip(&meshes).enumerate() {
        tlas[1 + i] = gpu::instance(b, *layers);
    }
    let answers = gpu.storage("answers", (RAYS * 4) as u64);
    let ((), err) = gpu.scoped(|| {
        let mut entries = vec![gpu::build_entry(&floor_blas, &floor)];
        entries.extend(blases.iter().zip(&meshes).map(|(b, (m, _))| gpu::build_entry(b, m)));
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        enc.build_acceleration_structures(&entries, [&tlas]);
        let group = gpu.bind(
            pipeline,
            &[(0, tlas.as_binding()), (1, dirs.as_entire_binding()), (2, answers.as_entire_binding()), (3, params.as_entire_binding())],
        );
        gpu::dispatch(&mut enc, pipeline, &group, (RAYS as u32).div_ceil(64));
        gpu.queue.submit([enc.finish()]);
    });
    (gpu.read_u32(&answers), err)
}

pub fn run(gpu: &Gpu, plant: bool) -> Value {
    let dirs = directions();
    let cpu = reference(&dirs);
    let e_ref = irradiance(&cpu);
    let pipeline = gpu.pipeline(include_str!("ties.wgsl"), "main");
    let dir_buf = gpu.init("dirs", bytemuck::cast_slice(&dirs), wgpu::BufferUsages::STORAGE);
    let mut p = [0u32; 4];
    p[0] = RAYS as u32;
    p[2] = (ORIGIN[0] as f32).to_bits();
    p[3] = (ORIGIN[1] as f32).to_bits();
    let params = gpu.init("params", bytemuck::cast_slice(&p), wgpu::BufferUsages::UNIFORM);
    let measure = |form: &str| {
        let mut hashes = Vec::new();
        let mut values = Vec::new();
        let mut error = None;
        for _ in 0..RUNS {
            let (answers, err) = trace(gpu, form, &pipeline, &dir_buf, &params);
            hashes.push(gpu::hex(bytemuck::cast_slice(&answers)));
            values.push(irradiance(&answers));
            error = error.or(err);
        }
        let one_hash = hashes.iter().all(|h| *h == hashes[0]);
        let worst = values.iter().map(|e| (e / e_ref - 1.0).abs()).fold(0.0, f64::max);
        let holds = one_hash && worst <= 0.01 && error.is_none();
        json!({
            "hashes": hashes,
            "one_hash": one_hash,
            "irradiance_lux": values,
            "worst_off": worst,
            "holds": holds,
            "error": error,
        })
    };
    // The pinned layer as built, always; where it can't give one hash within 1% of the reference, the
    // rule's runs, built merged (planted: with the masked quad's layer first).
    let as_built = measure("as_built");
    let (named, with_rule) = if as_built["holds"] == true && !plant {
        ("as_built", Value::Null)
    } else {
        ("merge", measure(if plant { "masked_first" } else { "merge" }))
    };
    let n = if named == "as_built" { &as_built } else { &with_rule };
    let pass = n["holds"] == true;
    let e = n["irradiance_lux"][0].as_f64().unwrap_or(f64::NAN);
    json!({
        "status": if pass { "PASS" } else { "FAIL" },
        "reason": if pass {
            format!("{named}: one hash in {RUNS} runs of {RAYS} rays, irradiance {e:.3} lx against the reference's {e_ref:.3} lx")
        } else if n["one_hash"] == false {
            format!("{named}: {RUNS} runs gave more than one hash")
        } else {
            format!("{named}: irradiance {e:.3} lx is {:.1}% off the reference's {e_ref:.3} lx", 100.0 * (e / e_ref - 1.0))
        },
        "form_for_475": named,
        "rule": if named == "as_built" { Value::Null } else { Value::from(RULE) },
        "planted": plant.then_some("the merged build's layers ordered masked first"),
        "runs": RUNS,
        "rays": RAYS,
        "luminance_cd_m2": LUMINANCE,
        "irradiance": {"gpu": e, "reference": e_ref, "analytic": analytic()},
        "reference_answers_blake3": gpu::hex(bytemuck::cast_slice(&cpu)),
        "seed": SEED,
        "as_built": as_built,
        "with_rule": with_rule,
    })
}
