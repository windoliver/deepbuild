//! `interp_suite` (#429, criterion bb5bf037; tests/acceptance/429/README.md, New calls): the
//! emitter held to the graph. Every shipped operator's stages, fx@1's graphs and `generated`
//! seeded random well-typed graphs ([`gen`]) run through the core's check, the emitter and this
//! GPU, and through the step graph's CPU interpreter in f64 (`deep_canvas_effects::interp`, the
//! one #380's references are built on), and every output lane is held to the bound its steps'
//! references give ([`bound`]). Under `--planted drops_swizzle_last` the GPU runs the planted
//! emitter's WGSL while the interpreter and the bound read the graph as checked.

mod bound;
mod gen;

use std::collections::BTreeMap;
use std::time::Instant;

use deep_canvas_effects::check::Checked;
use deep_canvas_effects::emit::Options;
use deep_canvas_effects::graph::{Sc, Tex, Ty};
use deep_canvas_effects::interp::{self, Env, Image, Val};
use deep_canvas_effects::{fx, shipped};
use deep_effects_render::compile::{compile_with, Compiled};
use deep_effects_render::reference::{self, inverse};
use deep_effects_render::runner::{Frame, Runner, LINEAR};
use deep_gpu::device::Device;
use serde_json::{json, Map, Value};

use crate::effects::operator_plants;
use crate::{refused, App, Planted};

use bound::R;

/// The item seed and time the shipped and fx@1 passes run at.
const SEED: u32 = 0x5eed_0429;
const T: f32 = 0.75;
/// The texture inputs' size, and the size of a pass that runs at its view's.
const SIZE: u32 = 64;
/// Generated graphs per GPU submission.
const BATCH: usize = 64;

/// What one graph's outputs did against their bounds.
#[derive(Default)]
struct Held {
    outputs: usize,
    max_error: f64,
    /// The first lane outside its bound, or failing that the one nearest its bound's edge.
    worst: Option<Value>,
    worst_share: f64,
    outside: bool,
}

impl Held {
    fn lane(&mut self, at: Value, gpu: f64, cpu: f64, b: R) {
        self.outputs += 1;
        let err = (gpu - cpu).abs();
        if err.is_finite() {
            self.max_error = self.max_error.max(err);
        }
        let ok = b.holds(gpu) && b.holds(cpu);
        if self.outside {
            return;
        }
        let half = (b.hi - b.lo) / 2.0;
        let share = if half > 0.0 && half.is_finite() {
            err / half
        } else {
            0.0
        };
        if !ok || share > self.worst_share || self.worst.is_none() {
            self.worst_share = share;
            self.outside = !ok;
            self.worst = Some(
                json!({"at": at, "gpu": num(gpu), "cpu": num(cpu), "bound": [num(b.lo), num(b.hi)]}),
            );
        }
    }

    fn json(&self, id: &str) -> Value {
        json!({"id": id, "outcome": if self.outside { "outside" } else { "within" }, "outputs": self.outputs, "max_error": self.max_error, "worst": self.worst})
    }
}

fn num(x: f64) -> Value {
    if x.is_finite() {
        json!(x)
    } else {
        json!(format!("{x}"))
    }
}

/// Whether a graph holds a swizzle: a split picking two or more lanes, at any depth.
fn uses_swizzle(v: &Value) -> bool {
    match v {
        Value::Object(o) => {
            (o.get("op").and_then(Value::as_str) == Some("split@1")
                && o["args"]["pick"].as_str().is_some_and(|p| p.len() >= 2))
                || o.values().any(uses_swizzle)
        }
        Value::Array(a) => a.iter().any(uses_swizzle),
        _ => false,
    }
}

/// Seeded words.
fn hashed(k: u32) -> u32 {
    interp::hash1(k ^ 0x429_bb5b)
}

/// A float texture on a 1/64 grid, which f16 holds exactly: rgb in [0, 2], alpha in [0, 1].
fn color(size: u32, salt: u32) -> Image {
    let mut img = Image::new(size, size);
    for (i, px) in img.px.iter_mut().enumerate() {
        let h = |c: u32| hashed(i as u32 * 7 + c + salt * 131);
        *px = [
            f64::from(h(0) % 129) / 64.0,
            f64::from(h(1) % 129) / 64.0,
            f64::from(h(2) % 129) / 64.0,
            f64::from(h(3) % 65) / 64.0,
        ];
    }
    img
}

/// Depth in (0, 1] on a 2^-16 grid, one texel in ten undrawn (0).
fn depth(size: u32, salt: u32) -> Image {
    let mut img = Image::new(size, size);
    for (i, px) in img.px.iter_mut().enumerate() {
        let h = hashed(i as u32 * 3 + salt * 977);
        px[0] = if h.is_multiple_of(10) {
            0.0
        } else {
            f64::from(1 + h % 65_535) / 65_536.0
        };
    }
    img
}

/// Object IDs in 8 × 8 blocks, so selection outlines have edges.
fn ids(size: u32) -> Image {
    let mut img = Image::new(size, size);
    for (i, px) in img.px.iter_mut().enumerate() {
        let (x, y) = (i as u32 % size, i as u32 / size);
        px[0] = f64::from(hashed((x / 8) * 97 + y / 8) % 24);
    }
    img
}

/// A perspective view of the origin from (3, 2.5, 6), reversed Z with no far plane, column-major.
fn camera() -> ([f64; 16], [f64; 3]) {
    let eye = [3.0, 2.5, 6.0];
    let len = |v: [f64; 3]| deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    let norm = |v: [f64; 3]| {
        let l = len(v);
        [v[0] / l, v[1] / l, v[2] / l]
    };
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let f = norm([-eye[0], -eye[1], -eye[2]]);
    let s = norm(cross(f, [0.0, 1.0, 0.0]));
    let u = cross(s, f);
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // Rows of the view matrix.
    let view = [
        [s[0], s[1], s[2], -dot(s, eye)],
        [u[0], u[1], u[2], -dot(u, eye)],
        [-f[0], -f[1], -f[2], dot(f, eye)],
        [0.0, 0.0, 0.0, 1.0],
    ];
    let (fy, near) = (1.0 / deep_canvas::ops::tan(0.4363), 0.1);
    let proj = [
        [fy, 0.0, 0.0, 0.0],
        [0.0, fy, 0.0, 0.0],
        [0.0, 0.0, 0.0, near],
        [0.0, 0.0, -1.0, 0.0],
    ];
    let mut m = [0.0; 16];
    for r in 0..4 {
        for c in 0..4 {
            m[c * 4 + r] = (0..4).map(|k| proj[r][k] * view[k][c]).sum();
        }
    }
    (m, eye)
}

/// A shipped stage's or fx@1 graph's inputs: its textures, params and roles.
fn params_for(c: &Checked) -> BTreeMap<String, Value> {
    let mut p = BTreeMap::new();
    for input in c.op.inputs.values() {
        if let deep_canvas_effects::graph::From::Param(path) = &input.from {
            let v = match path.as_str() {
                // The key light's clip: orthographic, looking down.
                "light.clip" => json!([
                    0.1, 0.0, 0.0, 0.0, 0.0, 0.0, -0.05, 0.0, 0.0, 0.1, 0.0, 0.0, 0.5, 0.5, 0.5,
                    1.0
                ]),
                "selection.bits" => {
                    let mut bits = vec![0u64; 16];
                    bits[0] = 0b1010_1010_1010;
                    json!(bits)
                }
                "particles.count" => json!(c.op.elements),
                "particles.motion" => json!(2),
                "particles.spin" => json!(1.5),
                "particles.amplitude" => json!(0.3),
                "particles.frequency" => json!(0.7),
                _ => continue,
            };
            p.insert(path.clone(), v);
        }
    }
    p
}

fn roles() -> BTreeMap<String, [f64; 3]> {
    ["selection", "grid_minor", "grid_major", "grid_axis"]
        .iter()
        .enumerate()
        .map(|(k, r)| {
            (
                r.to_string(),
                [0.25 * k as f64, 0.5, 0.75 - 0.125 * k as f64],
            )
        })
        .collect()
}

/// A shipped compute stage at a size the suite runs: past 4,096 elements, its first 4,096, its
/// storage cut in proportion.
fn sized(g: &Value) -> Value {
    let mut g = g.clone();
    let elements = g["elements"].as_u64().unwrap_or(0);
    if elements > 4096 {
        g["elements"] = json!(4096);
        if let Some(out) = g["outputs"].as_object_mut() {
            for o in out.values_mut() {
                if let Some(n) = o["storage"]["count"].as_u64() {
                    o["storage"]["count"] = json!((n * 4096 / elements).max(1));
                }
            }
        }
    }
    g
}

/// One graph run both ways and held to its bound.
fn hold_pass(device: &Device, c: &Compiled, cpu_c: &Checked) -> Result<Held, String> {
    let (clip, eye) = camera();
    let frame = Frame {
        clip: clip.map(|x| x as f32),
        inverse_clip: inverse(&clip).map(|x| x as f32),
        eye: [eye[0] as f32, eye[1] as f32, eye[2] as f32, 0.1],
        t: T,
        seed: SEED,
    };
    let mut textures = Vec::new();
    let mut held: BTreeMap<String, Image> = BTreeMap::new();
    for (k, name) in cpu_c.textures.iter().enumerate() {
        let Ty::Tex(kind) = cpu_c.op.inputs[name].ty else {
            return Err(format!("{name} isn't a texture"));
        };
        let size = if name == "small" { SIZE / 2 } else { SIZE };
        let img = match (kind, name.as_str()) {
            (Tex::Depth, _) => depth(size, k as u32),
            (Tex::Uint, _) => ids(size),
            _ => color(size, k as u32),
        };
        let (tex, h) = reference::upload(device, kind, &img);
        textures.push(tex);
        held.insert(name.clone(), h);
    }
    let size = match &cpu_c.op.size {
        deep_canvas_effects::graph::Size::Of { input, scale } => {
            let s = held.get(input).map_or(SIZE, |i| i.w);
            let n = ((f64::from(s) * scale) as u32).max(1);
            [n, n]
        }
        _ => [SIZE, SIZE],
    };
    let params = params_for(cpu_c);
    let roles = roles();
    let values = interp::inputs(&c.checked, &params, &roles);
    let runner = Runner::new(&device.device, c.clone(), LINEAR);
    let views: Vec<wgpu::TextureView> = textures
        .iter()
        .map(|t| t.create_view(&Default::default()))
        .collect();
    let refs: Vec<&wgpu::TextureView> = views.iter().collect();
    let (g0, g1, _keep) = runner.bind(&device.device, &frame, size, &values, &refs, &[]);
    let out = device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("interp_suite output"),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: LINEAR,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let mut enc = device.device.create_command_encoder(&Default::default());
    runner.encode(
        &mut enc,
        &out.create_view(&Default::default()),
        &(g0, g1),
        None,
    );
    device.queue.submit([enc.finish()]);
    let gpu = reference::linear_image(
        &reference::read(device, &out, wgpu::TextureAspect::All, 8),
        size,
    );
    let env = Env {
        t: f64::from(frame.t),
        seed: frame.seed,
        clip: frame.clip.map(f64::from),
        inverse_clip: frame.inverse_clip.map(f64::from),
        eye: frame.eye.map(f64::from),
        inputs: interp::inputs(cpu_c, &params, &roles),
        textures: held.iter().map(|(k, v)| (k.clone(), v)).collect(),
        normals: [[0.0, 0.0, 1.0]; 3],
    };
    let cpu = interp::pass(cpu_c, &env, size)?;
    let bounds = bound::pass(cpu_c, &env, size)?;
    let mut h = Held::default();
    for (i, b) in bounds.iter().enumerate() {
        for (ch, lane) in b.iter().enumerate() {
            let at = json!({"x": i as u32 % size[0], "y": i as u32 / size[0], "channel": ch});
            h.lane(at, gpu.px[i][ch], cpu.px[i][ch], *lane);
        }
    }
    Ok(h)
}

/// A compute graph ready for the GPU: its runner, inputs and the CPU's answers.
struct Ready {
    runner: Runner,
    values: BTreeMap<String, Val>,
    /// Each storage input's words, in binding order.
    inputs: Vec<Vec<u32>>,
    cpu: BTreeMap<String, Vec<f64>>,
    bounds: BTreeMap<String, Vec<R>>,
}

fn ready(
    device: &Device,
    c: Compiled,
    storage: &BTreeMap<String, Vec<f64>>,
    params: &BTreeMap<String, Value>,
) -> Result<Ready, String> {
    let checked = &c.checked;
    let env = Env {
        t: f64::from(T),
        seed: SEED,
        clip: [0.0; 16],
        inverse_clip: [0.0; 16],
        eye: [0.0; 4],
        inputs: interp::inputs(checked, params, &BTreeMap::new()),
        textures: BTreeMap::new(),
        normals: [[0.0; 3]; 3],
    };
    let cpu = interp::compute(checked, &env, storage.clone())?;
    let bounds = bound::compute(checked, &env, storage)?;
    let inputs = checked
        .storage_inputs
        .iter()
        .map(|n| {
            let sc = match checked.op.inputs[n].ty {
                Ty::Storage(sc, _) => sc,
                _ => Sc::U32,
            };
            storage.get(n).map_or(vec![0], |w| {
                w.iter()
                    .map(|x| {
                        if sc == Sc::F32 {
                            (*x as f32).to_bits()
                        } else {
                            *x as i64 as u32
                        }
                    })
                    .collect()
            })
        })
        .collect();
    let values = interp::inputs(checked, params, &BTreeMap::new());
    let runner = Runner::new(&device.device, c, LINEAR);
    Ok(Ready {
        runner,
        values,
        inputs,
        cpu,
        bounds,
    })
}

/// Runs compute graphs in one submission; each one's storage outputs' words, by name.
fn dispatch_all(device: &Device, jobs: &[&Ready]) -> Vec<BTreeMap<String, Vec<u32>>> {
    let d = &device.device;
    let mut enc = d.create_command_encoder(&Default::default());
    let mut keep = Vec::new();
    let mut backs = Vec::new();
    let frame = Frame {
        t: T,
        seed: SEED,
        ..Frame::default()
    };
    for r in jobs {
        let ins: Vec<wgpu::Buffer> = r
            .inputs
            .iter()
            .map(|w| {
                let bytes: Vec<u8> = w.iter().flat_map(|x| x.to_le_bytes()).collect();
                d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("interp_suite input"),
                    contents: &bytes,
                    usage: wgpu::BufferUsages::STORAGE,
                })
            })
            .collect();
        let mut outs = Vec::new();
        for (name, s) in &r.runner.compiled.checked.op.storage {
            let size = u64::from(s.count.max(1)) * 4;
            let out = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("interp_suite output"),
                size,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            let back = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("interp_suite read back"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            outs.push((name.clone(), out, back, size));
        }
        let bufs: Vec<&wgpu::Buffer> = ins.iter().chain(outs.iter().map(|o| &o.1)).collect();
        let (g0, g1, b) = r.runner.bind(d, &frame, [1, 1], &r.values, &[], &bufs);
        r.runner.dispatch(
            &mut enc,
            r.runner.compiled.checked.op.elements,
            &(g0, g1),
            None,
        );
        for (_, out, back, size) in &outs {
            enc.copy_buffer_to_buffer(out, 0, back, 0, *size);
        }
        keep.push((ins, b));
        backs.push(outs);
    }
    device.queue.submit([enc.finish()]);
    for outs in &backs {
        for (_, _, back, _) in outs {
            back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
        }
    }
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    backs
        .iter()
        .map(|outs| {
            outs.iter()
                .map(|(name, _, back, _)| {
                    let words: Vec<u32> = back
                        .slice(..)
                        .get_mapped_range()
                        .map(|v| {
                            v.as_chunks::<4>()
                                .0
                                .iter()
                                .map(|b| u32::from_le_bytes(*b))
                                .collect()
                        })
                        .unwrap_or_default();
                    back.unmap();
                    (name.clone(), words)
                })
                .collect()
        })
        .collect()
}

/// A compute graph's GPU words against its CPU values and bounds.
fn hold_compute(r: &Ready, gpu: &BTreeMap<String, Vec<u32>>) -> Held {
    let mut h = Held::default();
    for (name, bounds) in &r.bounds {
        let sc = r.runner.compiled.checked.op.storage[name].sc;
        let words = gpu.get(name).map(Vec::as_slice).unwrap_or(&[]);
        let cpu = r.cpu.get(name).map(Vec::as_slice).unwrap_or(&[]);
        for (i, b) in bounds.iter().enumerate() {
            let w = words.get(i).copied().unwrap_or(0);
            let g = match sc {
                Sc::F32 => f64::from(f32::from_bits(w)),
                Sc::I32 => f64::from(w as i32),
                _ => f64::from(w),
            };
            h.lane(
                json!({"output": name, "index": i}),
                g,
                cpu.get(i).copied().unwrap_or(f64::NAN),
                *b,
            );
        }
    }
    h
}

fn row(name: &str, kind: &str, graphs: &[Value], stages: Vec<Value>) -> Value {
    let outside = stages.iter().any(|s| s["outcome"] != "within");
    json!({
        "operator": name, "kind": kind,
        "uses_swizzle": graphs.iter().any(uses_swizzle),
        "outcome": if outside { "outside" } else { "within" },
        "stages": stages,
    })
}

/// Holds one shipped operator's or fx@1 graph's stages, each a pass or a compute graph.
fn hold_graphs(device: &Device, graphs: &[Value], options: Options) -> Vec<Value> {
    graphs
        .iter()
        .map(|g| {
            let g = sized(g);
            let id = g["id"].as_str().unwrap_or("").to_string();
            let refused_with = |e: String| json!({"id": id, "outcome": "outside", "reason": e});
            let c = match compile_with(&g, &BTreeMap::new(), options) {
                Ok(c) => c,
                Err(e) => {
                    return refused_with(format!(
                        "refused: {:?}",
                        e.iter().map(|i| i.message.clone()).collect::<Vec<_>>()
                    ))
                }
            };
            let cpu_c = c.checked.clone();
            let held = match c.kind() {
                deep_canvas_effects::graph::Kind::Compute => {
                    let mut storage = BTreeMap::new();
                    for (k, name) in cpu_c.storage_inputs.iter().enumerate() {
                        let n = match cpu_c.op.inputs[name].ty {
                            Ty::Storage(_, n) => n.max(1),
                            _ => 1,
                        };
                        storage.insert(
                            name.clone(),
                            (0..n)
                                .map(|i| f64::from(hashed(i * 31 + k as u32)))
                                .collect(),
                        );
                    }
                    ready(device, c, &storage, &params_for(&cpu_c)).map(|r| {
                        let gpu = dispatch_all(device, &[&r]);
                        hold_compute(&r, &gpu[0])
                    })
                }
                _ => hold_pass(device, &c, &cpu_c),
            };
            match held {
                Ok(h) => h.json(&id),
                Err(e) => refused_with(e),
            }
        })
        .collect()
}

/// The generated graphs, in batches: compiled, run on the CPU and bounded in parallel, then
/// dispatched together.
fn generated(device: &Device, count: u64, max_steps: usize, seed: u64, options: Options) -> Value {
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .clamp(2, 8);
    let (mut repeat, mut select, mut swizzle, mut largest) = (0u64, 0u64, 0u64, 0usize);
    let mut outside = Vec::new();
    let mut k = 0u64;
    while k < count {
        let seeds: Vec<u64> = (k..(k + BATCH as u64).min(count))
            .map(|i| seed + i)
            .collect();
        k += seeds.len() as u64;
        let made: Vec<(gen::Graph, Result<Ready, String>)> = std::thread::scope(|s| {
            let chunks: Vec<_> = seeds
                .chunks(seeds.len().div_ceil(threads))
                .map(|chunk| {
                    s.spawn(move || {
                        chunk
                            .iter()
                            .map(|&sd| {
                                let g = gen::graph(sd, max_steps);
                                let storage = BTreeMap::from([
                                    ("xf".to_string(), g.xf.clone()),
                                    ("xu".to_string(), g.xu.clone()),
                                ]);
                                let r = compile_with(&g.op, &BTreeMap::new(), options)
                                    .map_err(|e| {
                                        format!(
                                            "refused: {:?}",
                                            e.iter()
                                                .map(|i| format!(
                                                    "{}: {}",
                                                    i.step.clone().unwrap_or_default(),
                                                    i.message
                                                ))
                                                .collect::<Vec<_>>()
                                        )
                                    })
                                    .and_then(|c| ready(device, c, &storage, &BTreeMap::new()));
                                (g, r)
                            })
                            .collect::<Vec<_>>()
                    })
                })
                .collect();
            chunks
                .into_iter()
                .flat_map(|h| h.join().expect("a generator thread finished"))
                .collect()
        });
        let jobs: Vec<&Ready> = made.iter().filter_map(|(_, r)| r.as_ref().ok()).collect();
        let mut gpu = dispatch_all(device, &jobs).into_iter();
        for (g, r) in &made {
            repeat += u64::from(g.repeat);
            select += u64::from(g.select);
            swizzle += u64::from(g.swizzle);
            largest = largest.max(g.steps);
            let entry = |extra: Value| {
                let mut o = json!({"seed": g.seed, "steps": g.steps, "swizzle": g.swizzle});
                if let (Value::Object(o), Value::Object(e)) = (&mut o, extra) {
                    o.extend(e);
                }
                o
            };
            match r {
                Err(e) => outside.push(entry(json!({"reason": e}))),
                Ok(r) => {
                    let h = hold_compute(r, &gpu.next().unwrap_or_default());
                    if h.outside {
                        outside.push(entry(json!({"worst": h.worst, "outputs": h.outputs})));
                    }
                }
            }
        }
    }
    json!({
        "count": count, "max_steps": largest, "elements": gen::ELEMENTS,
        "with_repeat": repeat, "with_select": select, "with_swizzle": swizzle,
        "outside": outside,
    })
}

/// `interp_suite {generated, max_steps, seed}`.
pub fn call(app: &mut App, call: &Value) -> Value {
    let count = call["generated"].as_u64().unwrap_or(10_000);
    let max_steps = call["max_steps"].as_u64().unwrap_or(gen::MAX_STEPS as u64);
    if !(8..=gen::MAX_STEPS as u64).contains(&max_steps) {
        return refused("bad_input", format!("max_steps is 8 to {}", gen::MAX_STEPS));
    }
    let seed = call["seed"].as_u64().unwrap_or(1);
    let (options, _) = operator_plants(app.planted);
    let karis = app.planted != Some(Planted::BloomWithoutKaris);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let started = Instant::now();
        let shipped: Vec<Value> = shipped::library(karis)
            .iter()
            .map(|s| row(s.name, s.kind.name(), &s.stages, hold_graphs(&device, &s.stages, options)))
            .collect();
        let shipped_ms = started.elapsed().as_millis() as u64;
        let fx: Vec<Value> = fx::library()
            .iter()
            .map(|n| row(&n.name, "pass", std::slice::from_ref(&n.graph), hold_graphs(&device, std::slice::from_ref(&n.graph), options)))
            .collect();
        let fx_ms = started.elapsed().as_millis() as u64 - shipped_ms;
        let generated = generated(&device, count, max_steps as usize, seed, options);
        let mut o = Map::new();
        o.insert("shipped".into(), json!(shipped));
        o.insert("fx".into(), json!(fx));
        o.insert("generated".into(), generated);
        o.insert(
            "ms".into(),
            json!({"shipped": shipped_ms, "fx": fx_ms, "total": started.elapsed().as_millis() as u64}),
        );
        Value::Object(o)
    })
}
