//! `calibrate` (issue #429; tests/acceptance/429/README.md, New calls; canvas primitives:
//! Operator cost and limits): the release preflight's calibration run. It times every shipped
//! operator and the fixture graphs on this GPU, each graph in passes of its own bracketed by
//! their timestamp writes, one warm-up run and then five runs of at least [`RUN_NS`] of GPU time
//! each (from [`FRAMES`] frames up to what one query set holds), and holds
//! each graph's estimate from the op table to the largest of the five runs' 95th percentiles:
//! the run passes only when every estimate is within 25% of it, and only then do composed graphs
//! ship. Times are in ns per pixel (a pass, at [`SIZE`]) or per element (a compute operator, at
//! [`ELEMENTS`]); a chain's stages each run at that size and their times add.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_effects::graph::{Kind, Step, Tex, Ty};
use deep_canvas_effects::interp::{self, Image};
use deep_canvas_effects::shipped;
use deep_effects_render::compile::{compile_planted, Compiled};
use deep_effects_render::reference;
use deep_effects_render::runner::{Frame, Runner, LINEAR};
use deep_gpu::device::Device;
use serde_json::{json, Value};

use crate::effects::operator_plants;
use crate::{refused, App, Planted};

/// A pass's output, in px: 1080p, the size the design scales estimates from.
pub const SIZE: [u32; 2] = [1920, 1080];
/// A compute operator's elements.
pub const ELEMENTS: u32 = 1 << 20;
/// Frames the warm-up runs, and the fewest a timed run takes.
pub const FRAMES: u32 = 64;
/// The GPU time a timed run spans at least, so other work on the GPU (the compositor, say)
/// spreads over its frames as it does over any second of use, rather than landing in one run.
pub const RUN_NS: f64 = 250e6;
/// Timestamps one query set holds.
const QUERIES: u32 = 4096;
pub const RUNS: usize = 5;
/// How far an estimate may be from its measured 95th percentile.
pub const BOUND: f64 = 0.25;

/// A graph the run times: its stages run in order, each its own pass.
struct Graph {
    name: String,
    origin: &'static str,
    stages: Vec<Value>,
    /// Costed by this measurement, not by the op table: the shipped blur's passes, which a
    /// composed pass that calls the blur costs at what they measure (#432).
    measured: bool,
}

/// Whether any step of `steps`, in any body, is a seeded noise step, whose octave weight the
/// estimates take from the op table.
fn uses_noise(steps: &BTreeMap<String, Step>) -> bool {
    steps.values().any(|s| {
        matches!(s.op.as_str(), "noise@1" | "fbm@1")
            || s.body.as_ref().is_some_and(|b| uses_noise(&b.steps))
    })
}

/// Every op a graph's steps name, in any body.
fn ops(steps: &BTreeMap<String, Step>, out: &mut BTreeSet<String>) {
    for s in steps.values() {
        out.insert(s.op.clone());
        if let Some(b) = &s.body {
            ops(&b.steps, out);
        }
    }
}

/// The 95th percentile, as the acceptance test reads it.
fn p95(xs: &[f64]) -> f64 {
    let mut s = xs.to_vec();
    s.sort_by(f64::total_cmp);
    s[((0.95 * s.len() as f64).ceil() as usize).clamp(1, s.len()) - 1]
}

/// A composed fixture pass: `steps` writing `color`.
fn fixture_pass(id: &str, about: &str, inputs: Value, steps: Value) -> Value {
    json!({
        "id": id, "kind": "pass", "origin": "composed", "about": about,
        "inputs": inputs, "steps": steps, "outputs": {"color": "out"},
        "determinism": "same_machine", "cost": {"ns_per_px": 50.0},
        "resolution": "full", "fallback": "look", "chain": "effects", "order": "a0",
    })
}

/// The fixture graphs: composed graphs over the op table's families (arithmetic,
/// transcendentals, texture taps, integer hashing, seeded noise from one octave to eight, and
/// noise in a compute operator), so each family's weight is held to a measurement beside the
/// shipped operators.
fn fixtures() -> Vec<Graph> {
    let uv = json!({"op": "screen_uv@1", "args": {}});
    let scaled = json!({"op": "mul@1", "args": {"a": "uv", "b": 64.0}});
    let gray = |v: &str| json!({"op": "compose@1", "args": {"x": v, "y": v, "z": v, "w": 1.0}});
    let noisy = |id: &str, about: &str, step: Value| Graph {
        name: id.into(),
        origin: "fixture",
        measured: false,
        stages: vec![fixture_pass(
            id,
            about,
            json!({}),
            json!({"uv": uv, "p": scaled, "n": step, "out": gray("n")}),
        )],
    };
    let fbm =
        |octaves: u32| json!({"op": "fbm@1", "args": {"p": "p", "seed": 7, "octaves": octaves}});
    // Arithmetic and transcendentals: a chain the compiler can't fold.
    let mut math = serde_json::Map::new();
    math.insert("uv".into(), uv.clone());
    math.insert(
        "x0".into(),
        json!({"op": "split@1", "args": {"x": "uv", "pick": "x"}}),
    );
    let mut last = "x0".to_string();
    for k in 0..8 {
        let (s, c, q, d, m) = (
            format!("s{k}"),
            format!("c{k}"),
            format!("q{k}"),
            format!("d{k}"),
            format!("x{}", k + 1),
        );
        math.insert(s.clone(), json!({"op": "sin@1", "args": {"x": last}}));
        math.insert(c.clone(), json!({"op": "cos@1", "args": {"x": s}}));
        math.insert(q.clone(), json!({"op": "sqrt@1", "args": {"x": c}}));
        math.insert(
            d.clone(),
            json!({"op": "div@1", "args": {"a": q, "b": 1.5}}),
        );
        math.insert(
            m.clone(),
            json!({"op": "add@1", "args": {"a": d, "b": last}}),
        );
        last = m;
    }
    math.insert("out".into(), gray(&last));
    // Sixteen bilinear taps of the scene color.
    let mut taps = serde_json::Map::new();
    taps.insert("uv".into(), uv.clone());
    let mut sum: Option<String> = None;
    for k in 0..16u32 {
        let (o, at, s) = (format!("o{k}"), format!("at{k}"), format!("s{k}"));
        let off = [f64::from(k % 4) * 0.003, f64::from(k / 4) * 0.003];
        taps.insert(o.clone(), json!({"op": "const@1", "args": {"value": off}}));
        taps.insert(
            at.clone(),
            json!({"op": "add@1", "args": {"a": "uv", "b": o}}),
        );
        taps.insert(
            s.clone(),
            json!({"op": "sample@1", "args": {"tex": "color", "uv": at, "lod": 0.0}}),
        );
        sum = Some(match sum {
            None => s,
            Some(p) => {
                let a = format!("a{k}");
                taps.insert(a.clone(), json!({"op": "add@1", "args": {"a": p, "b": s}}));
                a
            }
        });
    }
    taps.insert(
        "out".into(),
        json!({"op": "mul@1", "args": {"a": sum.expect("taps"), "b": 0.0625}}),
    );
    // Integer hashing of each pixel.
    let mut hashes = serde_json::Map::new();
    hashes.insert("px".into(), json!({"op": "pixel@1", "args": {}}));
    hashes.insert(
        "x".into(),
        json!({"op": "split@1", "args": {"x": "px", "pick": "x"}}),
    );
    hashes.insert(
        "y".into(),
        json!({"op": "split@1", "args": {"x": "px", "pick": "y"}}),
    );
    hashes.insert(
        "h0".into(),
        json!({"op": "hash@1", "args": {"a": "x", "b": "y"}}),
    );
    hashes.insert(
        "h1".into(),
        json!({"op": "hash@1", "args": {"a": "h0", "b": 1}}),
    );
    hashes.insert("r".into(), json!({"op": "rand@1", "args": {"key": "h1"}}));
    hashes.insert("out".into(), gray("r"));
    // fbm per element, written to storage.
    let compute = json!({
        "id": "fixture.fbm_elements@1", "kind": "compute", "origin": "composed",
        "about": "Calibration fixture: six octaves of fbm per element, written to storage.",
        "inputs": {},
        "steps": {
            "e": {"op": "element@1", "args": {}},
            "lo": {"op": "and@1", "args": {"a": "e", "b": 1023}},
            "hi": {"op": "shr@1", "args": {"a": "e", "b": 10}},
            "xy": {"op": "compose@1", "args": {"x": "lo", "y": "hi"}},
            "xyf": {"op": "convert@1", "args": {"x": "xy", "to": "vec2<f32>"}},
            "p": {"op": "mul@1", "args": {"a": "xyf", "b": 0.0625}},
            "n": {"op": "fbm@1", "args": {"p": "p", "seed": 3, "octaves": 6}},
            "w": {"op": "write@1", "args": {"buf": "out", "i": "e", "v": "n"}},
        },
        "outputs": {"out": {"storage": {"type": "f32", "count": ELEMENTS}}},
        "elements": ELEMENTS, "workgroup": 64,
        "determinism": "same_machine", "cost": {"ns_per_element": 50.0},
    });
    let tex = json!({"color": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}}});
    vec![
        Graph {
            name: "fixture.math@1".into(),
            origin: "fixture",
            measured: false,
            stages: vec![fixture_pass(
                "fixture.math@1",
                "Calibration fixture: eight rounds of sin, cos, sqrt, a divide and an add.",
                json!({}),
                Value::Object(math),
            )],
        },
        Graph {
            name: "fixture.taps@1".into(),
            origin: "fixture",
            measured: false,
            stages: vec![fixture_pass(
                "fixture.taps@1",
                "Calibration fixture: sixteen bilinear taps of the scene color, averaged.",
                tex,
                Value::Object(taps),
            )],
        },
        Graph {
            name: "fixture.hash@1".into(),
            origin: "fixture",
            measured: false,
            stages: vec![fixture_pass(
                "fixture.hash@1",
                "Calibration fixture: two integer hashes of each pixel, then a rand.",
                json!({}),
                Value::Object(hashes),
            )],
        },
        noisy(
            "fixture.noise@1",
            "Calibration fixture: one octave of gradient noise.",
            json!({"op": "noise@1", "args": {"p": "p", "seed": 7}}),
        ),
        noisy(
            "fixture.noise_period@1",
            "Calibration fixture: one octave of gradient noise repeating every 16 cells.",
            json!({"op": "noise@1", "args": {"p": "p", "seed": 7, "period": 16}}),
        ),
        noisy(
            "fixture.fbm2@1",
            "Calibration fixture: two octaves of fbm.",
            fbm(2),
        ),
        noisy(
            "fixture.fbm4@1",
            "Calibration fixture: four octaves of fbm.",
            fbm(4),
        ),
        noisy(
            "fixture.fbm8@1",
            "Calibration fixture: eight octaves of fbm.",
            fbm(8),
        ),
        Graph {
            name: "fixture.fbm_elements@1".into(),
            origin: "fixture",
            measured: false,
            stages: vec![compute],
        },
    ]
}

/// A compute operator as the run times it: over [`ELEMENTS`], every storage it reads or writes
/// holding at least that many words.
fn at_scale(mut op: Value) -> Value {
    if op["kind"] != "compute" {
        return op;
    }
    op["elements"] = json!(ELEMENTS);
    let grow = |v: &mut Value| {
        if v.get("count").and_then(Value::as_u64).unwrap_or(0) < u64::from(ELEMENTS) {
            v["count"] = json!(ELEMENTS);
        }
    };
    if let Some(inputs) = op["inputs"].as_object_mut() {
        for i in inputs.values_mut() {
            if i.get("count").is_some() {
                grow(i);
            }
        }
    }
    if let Some(outs) = op["outputs"].as_object_mut() {
        for o in outs.values_mut() {
            if let Some(s) = o.get_mut("storage") {
                grow(s);
            }
        }
    }
    op
}

/// A seeded fill, so no input reads as a constant the GPU could compress.
fn filled(kind: Tex, [w, h]: [u32; 2]) -> Image {
    let mut img = Image::new(w, h);
    for (i, px) in img.px.iter_mut().enumerate() {
        let r = interp::hash1(i as u32);
        let unit = |k: u32| f64::from(interp::hash1(r ^ k) >> 8) / 16_777_216.0;
        *px = match kind {
            Tex::Uint => [f64::from(r % 600), 0.0, 0.0, 0.0],
            Tex::Depth => [unit(1), 0.0, 0.0, 0.0],
            _ => [unit(1), unit(2), unit(3), 1.0],
        };
    }
    img
}

/// One stage ready to run: its pipeline and bind groups, and what it writes.
struct Ready {
    runner: Runner,
    groups: (wgpu::BindGroup, wgpu::BindGroup),
    _keep: Vec<wgpu::Buffer>,
    target: Option<wgpu::TextureView>,
}

fn ready(
    device: &Device,
    c: Compiled,
    textures: &BTreeMap<u8, wgpu::Texture>,
) -> Result<Ready, String> {
    let d = &device.device;
    let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
    let runner = Runner::new(d, c.clone(), LINEAR);
    let views: Vec<wgpu::TextureView> = c
        .checked
        .textures
        .iter()
        .map(|name| {
            let Ty::Tex(kind) = c.checked.op.inputs[name].ty else {
                unreachable!("a texture input")
            };
            textures[&tex_key(kind)].create_view(&Default::default())
        })
        .collect();
    let refs: Vec<&wgpu::TextureView> = views.iter().collect();
    let words = |name: &str| match &c.checked.op.inputs[name].ty {
        Ty::Storage(_, n) => *n,
        _ => 1,
    };
    let storage: Vec<wgpu::Buffer> = c
        .checked
        .storage_inputs
        .iter()
        .map(|n| words(n))
        .chain(c.checked.op.storage.values().map(|s| s.count))
        .map(|n| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("calibrate storage"),
                size: u64::from(n.max(1)) * 4,
                usage: wgpu::BufferUsages::STORAGE,
                mapped_at_creation: false,
            })
        })
        .collect();
    let srefs: Vec<&wgpu::Buffer> = storage.iter().collect();
    let values = interp::inputs(&c.checked, &BTreeMap::new(), &BTreeMap::new());
    // A camera a metre above the ground looking along it, so the ground grid has a horizon.
    let mut frame = Frame {
        t: 1.25,
        seed: 7,
        eye: [0.0, 1.0, 0.0, 0.1],
        ..Frame::default()
    };
    for k in 0..4 {
        frame.clip[k * 5] = 1.0;
        frame.inverse_clip[k * 5] = 1.0;
    }
    let size = match c.kind() {
        Kind::Compute => [ELEMENTS, 1],
        _ => SIZE,
    };
    let (g0, g1, bufs) = runner.bind(d, &frame, size, &values, &refs, &srefs);
    let target = (c.kind() != Kind::Compute).then(|| {
        d.create_texture(&wgpu::TextureDescriptor {
            label: Some("calibrate output"),
            size: wgpu::Extent3d {
                width: SIZE[0],
                height: SIZE[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: LINEAR,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
        .create_view(&Default::default())
    });
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(e.to_string());
    }
    let mut keep: Vec<wgpu::Buffer> = storage;
    keep.extend(bufs);
    Ok(Ready {
        runner,
        groups: (g0, g1),
        _keep: keep,
        target,
    })
}

fn tex_key(kind: Tex) -> u8 {
    match kind {
        Tex::Float => 0,
        Tex::Uint => 1,
        Tex::Depth => 2,
    }
}

/// A run's timestamps: two per stage per frame.
struct Clock {
    query: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
    count: u32,
}

impl Clock {
    fn new(d: &wgpu::Device, stages: u32, frames: u32) -> Clock {
        let count = stages * 2 * frames;
        let buffer = |usage| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("calibrate times"),
                size: u64::from(count) * 8,
                usage,
                mapped_at_creation: false,
            })
        };
        Clock {
            query: d.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("calibrate"),
                ty: wgpu::QueryType::Timestamp,
                count,
            }),
            resolve: buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC),
            read: buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST),
            count,
        }
    }

    /// One run: its frames submitted back to back, so the GPU stays busy through the
    /// run, each frame each stage in its own pass bracketed by its timestamps; each frame's GPU
    /// ticks over its stages, or none if any reading is zero or reversed.
    fn run(&self, device: &Device, stages: &[Ready]) -> Option<Vec<u64>> {
        let d = &device.device;
        let mut q = 0u32;
        for _ in 0..self.count / (2 * stages.len() as u32) {
            let mut enc = d.create_command_encoder(&Default::default());
            for r in stages {
                let (begin, end) = (Some(q), Some(q + 1));
                q += 2;
                match &r.target {
                    Some(view) => r.runner.encode(
                        &mut enc,
                        view,
                        &r.groups,
                        Some(wgpu::RenderPassTimestampWrites {
                            query_set: &self.query,
                            beginning_of_pass_write_index: begin,
                            end_of_pass_write_index: end,
                        }),
                    ),
                    None => r.runner.dispatch(
                        &mut enc,
                        r.runner.compiled.checked.op.elements,
                        &r.groups,
                        Some(wgpu::ComputePassTimestampWrites {
                            query_set: &self.query,
                            beginning_of_pass_write_index: begin,
                            end_of_pass_write_index: end,
                        }),
                    ),
                }
            }
            device.queue.submit([enc.finish()]);
        }
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        // Resolved in a submission of their own once the passes have completed (timing.rs: on
        // Apple GPUs an end-of-pass sample resolved with its pass can land after the resolve).
        let mut enc = d.create_command_encoder(&Default::default());
        enc.resolve_query_set(&self.query, 0..self.count, &self.resolve, 0);
        enc.copy_buffer_to_buffer(&self.resolve, 0, &self.read, 0, u64::from(self.count) * 8);
        device.queue.submit([enc.finish()]);
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let slice = self.read.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        let frames = {
            let data = slice.get_mapped_range().ok()?;
            let t: Vec<u64> = data
                .as_chunks::<8>()
                .0
                .iter()
                .map(|b| u64::from_le_bytes(*b))
                .collect();
            t.chunks(2 * stages.len())
                .map(|f| {
                    f.chunks(2)
                        .map(|p| (p[1] > p[0] && p[0] > 0).then(|| p[1] - p[0]))
                        .sum::<Option<u64>>()
                })
                .collect::<Option<Vec<u64>>>()
        };
        self.read.unmap();
        frames
    }
}

/// `calibrate`: the calibration run (module docs).
pub fn calibrate(app: &mut App) -> Value {
    let karis = app.planted != Some(Planted::BloomWithoutKaris);
    let (emit, check) = operator_plants(app.planted);
    let mut graphs: Vec<Graph> = shipped::library(karis)
        .into_iter()
        .map(|s| Graph {
            name: s.name.into(),
            origin: "shipped",
            stages: s.stages,
            measured: false,
        })
        .collect();
    graphs.extend(fixtures());
    graphs.extend(["x", "y"].map(|axis| Graph {
        name: format!("blur.{axis}@1"),
        origin: "shipped",
        stages: vec![shipped::blur(axis)],
        measured: true,
    }));
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let Some(period) = device.timestamps.period_ns.map(f64::from) else {
            return refused("no_timestamps", "the device writes no pass timestamps");
        };
        let mut textures = BTreeMap::new();
        for kind in [Tex::Float, Tex::Uint, Tex::Depth] {
            textures.insert(tex_key(kind), reference::upload(&device, kind, &filled(kind, SIZE)).0);
        }
        let mut rows = Vec::new();
        let mut outside = Vec::new();
        for g in &graphs {
            let mut stages = Vec::new();
            let (mut estimate, mut noise, mut names) = (0.0, false, BTreeSet::new());
            let mut per = 1.0;
            for stage in &g.stages {
                let c = match compile_planted(&at_scale(stage.clone()), &BTreeMap::new(), emit, check) {
                    Ok(c) => c,
                    Err(issues) => {
                        return refused(
                            "operator_refused",
                            format!("{}: {:?}", g.name, issues.iter().map(|i| i.message.clone()).collect::<Vec<_>>()),
                        )
                    }
                };
                estimate += c.checked.estimate;
                noise |= uses_noise(&c.checked.op.steps);
                ops(&c.checked.op.steps, &mut names);
                per = match c.kind() {
                    Kind::Compute => f64::from(ELEMENTS),
                    _ => f64::from(SIZE[0]) * f64::from(SIZE[1]),
                };
                match ready(&device, c, &textures) {
                    Ok(r) => stages.push(r),
                    Err(e) => return refused("operator_compile", format!("{}: {e}", g.name)),
                }
            }
            let n = stages.len() as u32;
            let mut clock = Clock::new(&device.device, n, FRAMES);
            // One warm-up run, then the five timed, each sized from the warm-up's frames.
            let mut runs = Vec::new();
            for run in 0..=RUNS {
                let Some(ticks) = clock.run(&device, &stages) else {
                    return refused("no_timestamps", format!("{}: a pass's timestamps read zero or reversed", g.name));
                };
                let frames: Vec<f64> = ticks.iter().map(|t| *t as f64 * period / per).collect();
                if run > 0 {
                    runs.push(p95(&frames));
                } else {
                    let mut t: Vec<f64> = ticks.iter().map(|t| *t as f64 * period).collect();
                    t.sort_by(f64::total_cmp);
                    let frame_ns = t[t.len() / 2].max(1.0);
                    let frames = ((RUN_NS / frame_ns).ceil() as u32).clamp(FRAMES, QUERIES / (2 * n));
                    clock = Clock::new(&device.device, n, frames);
                }
            }
            let measured = runs.iter().copied().fold(0.0, f64::max);
            if !g.measured && (estimate - measured).abs() > BOUND * measured {
                outside.push(json!({"name": g.name, "steps": names, "estimate_ns": estimate, "measured_ns": measured}));
            }
            rows.push(json!({
                "name": g.name, "origin": g.origin, "uses_noise": noise, "own_pass": true, "warmup": true,
                "p95_ns": runs, "estimate_ns": estimate, "stages": g.stages.len(),
                "costed_by": if g.measured { "measurement" } else { "estimate" }, "measured_ns": measured,
            }));
        }
        let pass = outside.is_empty();
        json!({
            "result": if pass { "PASS" } else { "FAIL" },
            "composed": if pass { "ships" } else { "held" },
            "graphs": rows, "outside": outside,
            "size": SIZE, "elements": ELEMENTS, "bound": BOUND,
        })
    })
}
