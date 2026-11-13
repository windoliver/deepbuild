//! Rebuilds: a mesh of 10,000, 50,000 and 100,000 triangles posed anew each frame for 300 frames after
//! warm-up. The time to rebuild its bottom level under the fast-build and the fast-trace preference,
//! and the time to trace one ray per pixel at 1080p against each, as p50 and p95 from GPU timestamps
//! read after the frame (#1657). Then a structure asked to update, checked against a fresh build.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::gpu::{self, Gpu, Rng};

pub const SIZES: [usize; 3] = [10_000, 50_000, 100_000];
pub const PREFS: [&str; 2] = ["fast_build", "fast_trace"];
pub const FRAMES: usize = 300;
pub const WARMUP: usize = 30;
pub const PROBE_RAYS: usize = 10_000;
const SEED: u64 = 2435_0004;

/// What wgpu-core logs about a build asked to update.
pub static LOGGED: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn grid(triangles: usize) -> (u32, u32) {
    match triangles {
        10_000 => (100, 50),
        50_000 => (200, 125),
        _ => (250, 200),
    }
}

fn sheet(gpu: &Gpu, cols: u32, rows: u32) -> gpu::Mesh {
    let mut v = Vec::new();
    for r in 0..=rows {
        for c in 0..=cols {
            v.push([c as f32 / cols as f32, r as f32 / rows as f32, 0.0]);
        }
    }
    let mut idx = Vec::new();
    for r in 0..rows {
        for c in 0..cols {
            let a = r * (cols + 1) + c;
            let b = a + cols + 1;
            idx.extend([a, a + 1, b + 1, a, b + 1, b]);
        }
    }
    gpu::mesh(gpu, &v, &idx, true, wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST)
}

struct Poser {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    uniform: wgpu::Buffer,
    groups: u32,
    cols: u32,
    rows: u32,
}

impl Poser {
    fn new(gpu: &Gpu, module: &str, mesh: &gpu::Mesh, cols: u32, rows: u32) -> Poser {
        let pipeline = gpu.pipeline(module, "pose_main");
        let uniform = gpu.init("pose", &[0u8; 16], wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST);
        let group = gpu.bind(&pipeline, &[(0, mesh.vertices.as_entire_binding()), (1, uniform.as_entire_binding())]);
        Poser { pipeline, group, uniform, groups: ((cols + 1) * (rows + 1)).div_ceil(64), cols, rows }
    }

    fn pose(&self, gpu: &Gpu, enc: &mut wgpu::CommandEncoder, frame: u32, end: Option<(&wgpu::QuerySet, u32)>) {
        gpu.queue.write_buffer(&self.uniform, 0, bytemuck::cast_slice(&[self.cols, self.rows, frame, 0]));
        let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("pose"),
            timestamp_writes: end.map(|(q, i)| wgpu::ComputePassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: None,
                end_of_pass_write_index: Some(i),
            }),
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        pass.dispatch_workgroups(self.groups, 1, 1);
    }
}

/// The nearest-rank percentile.
fn pct(samples: &[f64], q: f64) -> f64 {
    let mut s = samples.to_vec();
    s.sort_by(f64::total_cmp);
    s[((q * s.len() as f64).ceil() as usize).max(1) - 1]
}

fn summary(samples: Vec<f64>) -> Value {
    json!({"p50": pct(&samples, 0.5), "p95": pct(&samples, 0.95), "samples": samples})
}

fn timed(gpu: &Gpu, module: &str, triangles: usize, pref: &str) -> Result<Value, String> {
    let (cols, rows) = grid(triangles);
    let mesh = sheet(gpu, cols, rows);
    let flags = if pref == "fast_build" {
        wgpu::AccelerationStructureFlags::PREFER_FAST_BUILD
    } else {
        wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE
    };
    let blas = gpu::blas(gpu, &mesh, flags, wgpu::AccelerationStructureUpdateMode::Build);
    let mut tlas = gpu::tlas(gpu, 1);
    tlas[0] = gpu::instance(&blas, 1);
    let poser = Poser::new(gpu, module, &mesh, cols, rows);
    let trace = gpu.pipeline(module, "trace_main");
    let depth = gpu.storage("depth", 1920 * 1080 * 4);
    let queries = gpu.device.create_query_set(&wgpu::QuerySetDescriptor { label: None, ty: wgpu::QueryType::Timestamp, count: 3 });
    let resolved = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("stamps"),
        size: 24,
        usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let period = gpu.queue.get_timestamp_period() as f64;
    let (mut rebuild, mut traced) = (Vec::new(), Vec::new());
    for frame in 0..(WARMUP + FRAMES) as u32 {
        let ((), err) = gpu.scoped(|| {
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            poser.pose(gpu, &mut enc, frame, Some((&queries, 0)));
            enc.build_acceleration_structures(&[gpu::build_entry(&blas, &mesh)], [&tlas]);
            let group = gpu.bind(&trace, &[(2, tlas.as_binding()), (3, depth.as_entire_binding())]);
            let mut pass = enc.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("trace"),
                timestamp_writes: Some(wgpu::ComputePassTimestampWrites {
                    query_set: &queries,
                    beginning_of_pass_write_index: Some(1),
                    end_of_pass_write_index: Some(2),
                }),
            });
            pass.set_pipeline(&trace);
            pass.set_bind_group(0, &group, &[]);
            pass.dispatch_workgroups(1920 / 8, 1080 / 8, 1);
            drop(pass);
            gpu.queue.submit([enc.finish()]);
            gpu.wait();
            // #1657: the stamps are resolved in a submission of their own, after the frame's.
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            enc.resolve_query_set(&queries, 0..3, &resolved, 0);
            gpu.queue.submit([enc.finish()]);
        });
        if let Some(e) = err {
            return Err(format!("frame {frame}: {e}"));
        }
        let t: Vec<u64> = bytemuck::cast_slice(&gpu.read(&resolved)).to_vec();
        if frame as usize >= WARMUP {
            if t[1] <= t[0] || t[2] <= t[1] {
                return Err(format!("frame {frame}: timestamps out of order {t:?}"));
            }
            rebuild.push((t[1] - t[0]) as f64 * period / 1e6);
            traced.push((t[2] - t[1]) as f64 * period / 1e6);
        }
    }
    Ok(json!({"rebuild_ms": summary(rebuild), "trace_ms": summary(traced)}))
}

/// A structure asked to update at frames 1 and 2, its frame-2 answers against a fresh build of the
/// frame-2 pose, and a structure left at the frame-1 pose, which the check must tell apart.
fn update_check(gpu: &Gpu, module: &str) -> Value {
    let (cols, rows) = grid(10_000);
    let mesh = sheet(gpu, cols, rows);
    let poser = Poser::new(gpu, module, &mesh, cols, rows);
    let update = gpu::blas(
        gpu,
        &mesh,
        wgpu::AccelerationStructureFlags::ALLOW_UPDATE | wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE,
        wgpu::AccelerationStructureUpdateMode::PreferUpdate,
    );
    let build = wgpu::AccelerationStructureUpdateMode::Build;
    let fast_trace = wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE;
    let stale = gpu::blas(gpu, &mesh, fast_trace, build);
    let fresh = gpu::blas(gpu, &mesh, fast_trace, build);
    LOGGED.lock().unwrap().clear();
    log::set_max_level(log::LevelFilter::Debug);
    let ((), err) = gpu.scoped(|| {
        for frame in 0..3u32 {
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            poser.pose(gpu, &mut enc, frame, None);
            let mut entries = vec![gpu::build_entry(&update, &mesh)];
            match frame {
                1 => entries.push(gpu::build_entry(&stale, &mesh)),
                2 => entries.push(gpu::build_entry(&fresh, &mesh)),
                _ => {}
            }
            enc.build_acceleration_structures(&entries, []);
            gpu.queue.submit([enc.finish()]);
            gpu.wait();
        }
    });
    log::set_max_level(log::LevelFilter::Warn);
    let mut rng = Rng::new(SEED);
    let pts: Vec<[f32; 2]> = (0..PROBE_RAYS).map(|_| [(0.02 + 0.96 * rng.unit()) as f32, (0.02 + 0.96 * rng.unit()) as f32]).collect();
    let point_buf = gpu.init("points", bytemuck::cast_slice(&pts), wgpu::BufferUsages::STORAGE);
    let probe = gpu.pipeline(module, "probe_main");
    let mut answers = Vec::new();
    for blas in [&update, &fresh, &stale] {
        let mut tlas = gpu::tlas(gpu, 1);
        tlas[0] = gpu::instance(blas, 1);
        let hits = gpu.storage("hits", (PROBE_RAYS * 8) as u64);
        let mut enc = gpu.device.create_command_encoder(&Default::default());
        enc.build_acceleration_structures(&[], [&tlas]);
        let group = gpu.bind(&probe, &[(2, tlas.as_binding()), (4, point_buf.as_entire_binding()), (5, hits.as_entire_binding())]);
        gpu::dispatch(&mut enc, &probe, &group, (PROBE_RAYS as u32).div_ceil(64));
        gpu.queue.submit([enc.finish()]);
        answers.push(gpu.read_u32(&hits));
    }
    let same = |a: &[u32], b: &[u32]| a.chunks(2).zip(b.chunks(2)).filter(|(x, y)| x == y).count();
    let hit = |a: &[u32]| a.chunks(2).filter(|x| x[1] != u32::MAX).count();
    let logged = LOGGED.lock().unwrap().clone();
    json!({
        "frame": 2,
        "rays": PROBE_RAYS,
        "asked": "update_mode PreferUpdate with ALLOW_UPDATE, built at frames 0, 1 and 2",
        "same_as_fresh": same(&answers[0], &answers[1]),
        "fresh_hits": hit(&answers[1]),
        "differ_from_frame_1": PROBE_RAYS - same(&answers[2], &answers[1]),
        "log": logged.first(),
        "error": err,
    })
}

/// `held`: the GPU job that holds the lease, if another does; the timings then read INCONCLUSIVE.
pub fn run(gpu: &Gpu, held: Option<String>) -> Value {
    let module = include_str!("rebuilds.wgsl");
    let update = update_check(gpu, module);
    let rebuilt = update["same_as_fresh"] == PROBE_RAYS && update["differ_from_frame_1"].as_u64() > Some(0) && update["error"].is_null();
    let reason = held
        .map(|h| format!("another GPU job holds the lease ({h}), so no timing is a number"))
        .or_else(|| (!gpu.has_timestamps()).then(|| "the adapter has no GPU timestamps".to_string()));
    if let Some(reason) = reason {
        return json!({"status": "INCONCLUSIVE", "reason": reason, "timings": Value::Null, "update_check": update});
    }
    let mut timings = Vec::new();
    for size in SIZES {
        for pref in PREFS {
            match timed(gpu, module, size, pref) {
                Ok(mut v) => {
                    v["triangles"] = size.into();
                    v["preference"] = pref.into();
                    timings.push(v);
                }
                Err(e) => return json!({"status": "FAIL", "reason": format!("{size} triangles, {pref}: {e}"), "update_check": update}),
            }
        }
    }
    // Every moving mesh pays a rebuild and a trace each frame: the preference whose two p50s, summed
    // over the three sizes, are the smaller. A reading from one machine, not a budget.
    let cost = |pref: &str| -> f64 {
        timings.iter().filter(|t| t["preference"] == pref).map(|t| t["rebuild_ms"]["p50"].as_f64().unwrap_or(f64::INFINITY) + t["trace_ms"]["p50"].as_f64().unwrap_or(f64::INFINITY)).sum()
    };
    let form = if cost("fast_build") < cost("fast_trace") { "fast_build" } else { "fast_trace" };
    json!({
        "status": if rebuilt { "PASS" } else { "FAIL" },
        "reason": if rebuilt {
            format!("six rebuild and six trace timings over {FRAMES} frames each; a structure asked to update hits where a fresh build does for {PROBE_RAYS} of {PROBE_RAYS} rays")
        } else {
            format!("a structure asked to update hits where a fresh build does for {} of {PROBE_RAYS} rays, and {} differ from frame 1's", update["same_as_fresh"], update["differ_from_frame_1"])
        },
        "form_for_475": form,
        "frames": FRAMES,
        "warmup": WARMUP,
        "resolution": [1920, 1080],
        "timings": timings,
        "update_check": update,
    })
}
