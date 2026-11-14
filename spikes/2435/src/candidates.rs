//! Candidates: an opaque floor under a layer of 10,000 triangles whose alpha mask passes half of each,
//! and 1,000,000 rays straight down from seeded points, each answer compared with a CPU reference in
//! f64 that tests every triangle. Two forms: the candidate loop, and queries forced opaque that start
//! again just past a candidate whose test fails, up to 16 times.

use serde_json::{json, Value};

use crate::gpu::{self, Gpu, Rng};

pub const RAYS: usize = 1_000_000;
const COLS: usize = 100;
const ROWS: usize = 50;
pub const TRIANGLES: usize = COLS * ROWS * 2;
const FLOOR: u32 = 1;
const LAYER: u32 = 2;
/// Points keep this far, in barycentric units, from every edge of their triangle and from the
/// mask's line, so the GPU's f32 test and the reference's f64 test can't disagree on where a ray
/// lands; which side of an edge a ray grazing it takes is not this part's question.
const MARGIN: f64 = 1e-3;
const SEED: u64 = 2435_0001;
pub const FORMS: [&str; 2] = ["candidate_loop", "opaque_restart"];

fn layer() -> (Vec<[f32; 3]>, Vec<u32>) {
    let mut v = Vec::new();
    let mut idx = Vec::new();
    for r in 0..ROWS {
        for c in 0..COLS {
            let (x0, x1) = (c as f32 / COLS as f32, (c + 1) as f32 / COLS as f32);
            let (y0, y1) = (r as f32 / ROWS as f32, (r + 1) as f32 / ROWS as f32);
            let b = v.len() as u32;
            v.extend([[x0, y0, 1.0], [x1, y0, 1.0], [x1, y1, 1.0], [x0, y1, 1.0]]);
            idx.extend([b, b + 1, b + 2, b, b + 2, b + 3]);
        }
    }
    (v, idx)
}

/// Barycentrics (of the second and third vertex) of (x, y) in a triangle seen from above.
fn bary(p: [f64; 2], a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> (f64, f64) {
    let (e1, e2, q) = ([b[0] - a[0], b[1] - a[1]], [c[0] - a[0], c[1] - a[1]], [p[0] - a[0], p[1] - a[1]]);
    let det = e1[0] * e2[1] - e1[1] * e2[0];
    ((q[0] * e2[1] - q[1] * e2[0]) / det, (e1[0] * q[1] - e1[1] * q[0]) / det)
}

/// Seeded points over the layer, each kept off its triangle's edges and the mask's line.
fn points() -> Vec<[f32; 2]> {
    let mut rng = Rng::new(SEED);
    let mut out = Vec::with_capacity(RAYS);
    while out.len() < RAYS {
        let p = [rng.unit() as f32, rng.unit() as f32];
        let (x, y) = (p[0] as f64, p[1] as f64);
        let (c, r) = ((x * COLS as f64) as usize, (y * ROWS as f64) as usize);
        if c >= COLS || r >= ROWS {
            continue;
        }
        // The corners as the layer's f32 vertices hold them.
        let at = |i: usize, n: usize| (i as f32 / n as f32) as f64;
        let (x0, x1, y0, y1) = (at(c, COLS), at(c + 1, COLS), at(r, ROWS), at(r + 1, ROWS));
        let corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        let ok = [[0, 1, 2], [0, 2, 3]].iter().any(|t| {
            let (u, v) = bary([x, y], corners[t[0]], corners[t[1]], corners[t[2]]);
            let w = 1.0 - u - v;
            u.min(v).min(w) >= MARGIN && (u - v).abs() >= MARGIN
        });
        if ok {
            out.push(p);
        }
    }
    out
}

/// The reference: every triangle of the layer tested in f64 for each ray, on all cores.
fn reference(points: &[[f32; 2]], verts: &[[f32; 3]], idx: &[u32]) -> Vec<u32> {
    let tris: Vec<([[f64; 2]; 3], [f64; 4])> = idx
        .chunks(3)
        .map(|t| {
            let p = [t[0], t[1], t[2]].map(|i| [verts[i as usize][0] as f64, verts[i as usize][1] as f64]);
            let bb = [p[0][0].min(p[1][0]).min(p[2][0]), p[0][0].max(p[1][0]).max(p[2][0]), p[0][1].min(p[1][1]).min(p[2][1]), p[0][1].max(p[1][1]).max(p[2][1])];
            (p, bb)
        })
        .collect();
    let threads = std::thread::available_parallelism().map_or(8, |n| n.get());
    let chunk = points.len().div_ceil(threads);
    let mut out = vec![0u32; points.len()];
    std::thread::scope(|s| {
        for (pts, dst) in points.chunks(chunk).zip(out.chunks_mut(chunk)) {
            let tris = &tris;
            s.spawn(move || {
                for (p, a) in pts.iter().zip(dst.iter_mut()) {
                    let (x, y) = (p[0] as f64, p[1] as f64);
                    *a = FLOOR << 24;
                    for (prim, (t, bb)) in tris.iter().enumerate() {
                        if x < bb[0] || x > bb[1] || y < bb[2] || y > bb[3] {
                            continue;
                        }
                        let (u, v) = bary([x, y], t[0], t[1], t[2]);
                        if u >= 0.0 && v >= 0.0 && u + v <= 1.0 && u > v {
                            *a = (LAYER << 24) | prim as u32;
                        }
                    }
                }
            });
        }
    });
    out
}

/// How far down an answer goes: the layer, the floor, the sky.
fn depth(a: u32) -> u32 {
    match a >> 24 {
        LAYER => 1,
        FLOOR => 2,
        _ => 3,
    }
}

pub fn run(gpu: &Gpu, plant: bool) -> Value {
    let (verts, idx) = layer();
    let pts = points();
    let cpu = reference(&pts, &verts, &idx);
    let floor_v = [[-0.5f32, -0.5, 0.0], [1.5, -0.5, 0.0], [1.5, 1.5, 0.0], [-0.5, 1.5, 0.0]];
    let floor = gpu::mesh(gpu, &floor_v, &[0, 1, 2, 0, 2, 3], true, wgpu::BufferUsages::empty());
    let layer = gpu::mesh(gpu, &verts, &idx, false, wgpu::BufferUsages::empty());
    let fast_trace = wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE;
    let floor_blas = gpu::blas(gpu, &floor, fast_trace, wgpu::AccelerationStructureUpdateMode::Build);
    let layer_blas = gpu::blas(gpu, &layer, fast_trace, wgpu::AccelerationStructureUpdateMode::Build);
    let mut tlas = gpu::tlas(gpu, 2);
    tlas[0] = gpu::instance(&floor_blas, FLOOR);
    tlas[1] = gpu::instance(&layer_blas, LAYER);
    let mut enc = gpu.device.create_command_encoder(&Default::default());
    enc.build_acceleration_structures(&[gpu::build_entry(&floor_blas, &floor), gpu::build_entry(&layer_blas, &layer)], [&tlas]);
    gpu.queue.submit([enc.finish()]);

    let pipeline = gpu.pipeline(include_str!("candidates.wgsl"), "main");
    let point_buf = gpu.init("points", bytemuck::cast_slice(&pts), wgpu::BufferUsages::STORAGE);
    let answers = gpu.storage("answers", (RAYS * 4) as u64);
    let mut forms = serde_json::Map::new();
    for (form, name) in FORMS.iter().enumerate() {
        let params = gpu.init("params", bytemuck::cast_slice(&[form as u32, plant as u32, RAYS as u32, 0]), wgpu::BufferUsages::UNIFORM);
        let group = gpu.bind(
            &pipeline,
            &[(0, tlas.as_binding()), (1, point_buf.as_entire_binding()), (2, answers.as_entire_binding()), (3, params.as_entire_binding())],
        );
        let ((), err) = gpu.scoped(|| {
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            gpu::dispatch(&mut enc, &pipeline, &group, (RAYS as u32).div_ceil(64));
            gpu.queue.submit([enc.finish()]);
        });
        let got = gpu.read_u32(&answers);
        let (mut misses, mut extra, mut wrong) = (0u64, 0u64, 0u64);
        let mut first_miss = None;
        for (i, (g, c)) in got.iter().zip(&cpu).enumerate() {
            match depth(*g).cmp(&depth(*c)) {
                std::cmp::Ordering::Greater => {
                    misses += 1;
                    first_miss.get_or_insert(i);
                }
                std::cmp::Ordering::Less => extra += 1,
                std::cmp::Ordering::Equal if g != c => wrong += 1,
                _ => {}
            }
        }
        forms.insert(
            name.to_string(),
            json!({
                "rays": RAYS,
                "misses": misses,
                "extra_hits": extra,
                "wrong_primitive": wrong,
                "first_miss": first_miss,
                "answers_blake3": gpu::hex(bytemuck::cast_slice(&got)),
                "error": err,
            }),
        );
    }
    let clean = |f: &Value| f["misses"] == 0 && f["extra_hits"] == 0 && f["wrong_primitive"] == 0 && f["error"].is_null();
    let named = FORMS.iter().find(|f| clean(&forms[**f])).copied().unwrap_or(FORMS[0]);
    let n = &forms[named];
    let pass = clean(n);
    let layer_rays = cpu.iter().filter(|a| *a >> 24 == LAYER).count();
    json!({
        "status": if pass { "PASS" } else { "FAIL" },
        "reason": if pass {
            format!("{named}: 0 misses and 0 extra hits in {RAYS}")
        } else {
            format!("{named}: {} misses and {} extra hits in {RAYS}", n["misses"], n["extra_hits"])
        },
        "form_for_475": named,
        "rays": RAYS,
        "layer_triangles": TRIANGLES,
        "reference": {"layer": layer_rays, "floor": RAYS - layer_rays, "answers_blake3": gpu::hex(bytemuck::cast_slice(&cpu))},
        "seed": SEED,
        "margin": MARGIN,
        "forms": forms,
    })
}
