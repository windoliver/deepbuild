//! #466's operator transitions in `view3d` (canvas primitives: Transition: operator, iris and
//! dip): each one's pass, from the document's `gpu.pass@1` items, the call's packs or fx@1, checked
//! and compiled before a frame draws; its window moved so the frame where its output first covers
//! half the picture lands on the cut (`align: reveal`), measured on the CPU reference interpreter
//! so the reveal is the same on every machine; and the pass run on the GPU (canvas primitives: GPU
//! operator) over the two finished sides at the transition's progress, timed and priced like any
//! operator (#468) under `transition/<id>`. The GPU run is same machine at best: its bilinear
//! fetches and f32 arithmetic can differ from the interpreter's f64 by a code value.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::transition::{self, OUTGOING, PROGRESS};
use deep_canvas_motion::shots::{self, Align, Kind};
use deep_effects_render::compile::{self, Compiled};
use deep_effects_render::runner::{Frame, Runner};
use serde_json::{json, Value};

use crate::regions::Timeline;

/// The side the reveal is measured on: small, since a reveal is a share of the picture.
const PROBE: [u32; 2] = [64, 36];
/// The sides and the frame the pass draws: the finished frame's bytes as they are, each channel
/// a code value over 255, as the interpreter reads them.
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// An operator transition's checked pass as it draws: its color alone (its `coverage` says where
/// the incoming side shows, not how much of the color lands), compiled to WGSL, with its pipeline
/// once a frame has built it on the device.
pub struct Transition {
    compiled: Arc<Compiled>,
    /// The texture input reading each side, by side name.
    sides: BTreeMap<String, String>,
    /// The pipeline and the device epoch it was built at.
    runner: Arc<Mutex<Option<(u64, Runner)>>>,
}

impl Transition {
    /// What the pass's declared cost (its `cost`, else the check's estimate, ns a pixel) prices
    /// a `size` frame at, ms.
    pub fn declared_ms(&self, size: [u32; 2]) -> f64 {
        let c = &self.compiled.checked;
        c.op.cost.unwrap_or(c.estimate) * f64::from(size[0]) * f64::from(size[1]) / 1e6
    }
}

/// The manifests of the packs a call installs, a folder or `{id, dir}` each.
pub(crate) fn manifests(call: &Value) -> Result<Vec<Value>, Value> {
    let mut manifests = Vec::new();
    for p in call["packs"].as_array().into_iter().flatten() {
        let Some(dir) = p.as_str().or(p["dir"].as_str()) else {
            continue;
        };
        let text = std::fs::read(std::path::Path::new(dir).join("pack.json"))
            .map_err(|e| json!({"code": "bad_input", "path": format!("packs: {dir}: {e}")}))?;
        manifests.push(
            serde_json::from_slice::<Value>(&text)
                .map_err(|e| json!({"code": "bad_input", "path": format!("packs: {dir}: {e}")}))?,
        );
    }
    Ok(manifests)
}

/// Each operator transition's checked and compiled pass by its ID, with each one that aligns on
/// its reveal placed there; a pass that can't run refuses the document, naming the transition's
/// field. With `by_progress` (#466's planted reveal) the reveal is where the progress reaches half.
pub fn passes(
    call: &Value,
    doc: &Value,
    timeline: Option<&mut Timeline>,
    by_progress: bool,
) -> Result<BTreeMap<String, Transition>, Value> {
    let Some(timeline) = timeline else {
        return Ok(BTreeMap::new());
    };
    let manifests = manifests(call)?;
    let mut out = BTreeMap::new();
    let rate = timeline.rate();
    for i in 0..timeline.windows().len() {
        let tr = timeline.windows()[i].clone();
        let Kind::Operator(o) = &tr.kind else {
            continue;
        };
        let at = format!("transitions/{}/operator", tr.id);
        let graph = transition::graph_of(&o.op, doc.get("items"), &manifests).ok_or_else(
            || json!({"code": "operator_unknown_op", "path": format!("{at}/op"), "op": o.op}),
        )?;
        let pass = transition::check(&graph, &o.reads).map_err(|issues| {
            let first = issues.first();
            json!({"code": first.map_or("operator_kind_rule", |i| i.code),
                "path": format!("{at}/{}", first.and_then(|i| i.path.clone()).unwrap_or_default()),
                "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
        })?;
        let mut drawn = pass.checked.clone();
        drawn.op.outputs.remove("coverage");
        let wgsl = deep_canvas_effects::emit::pass(&drawn, Default::default());
        compile::validate(&wgsl).map_err(
            |e| json!({"code": "operator_compile", "path": format!("{at}/op"), "what": e}),
        )?;
        if tr.align == Align::Reveal {
            let span = tr.end - tr.start;
            let mut probe = tr.clone();
            (probe.start, probe.end) = (0, span);
            let reveal = shots::reveal_offset(span, rate, &|t| {
                let p = probe.progress(t);
                if by_progress {
                    Some(p)
                } else {
                    pass.coverage(p, PROBE).ok()
                }
            })
            .ok_or_else(|| {
                json!({"code": "operator_kind_rule", "path": format!("{at}/op"),
                "what": "its output never covers half the picture, so it has no reveal to align"})
            })?;
            timeline.place(i, reveal);
        }
        out.insert(
            tr.id.clone(),
            Transition {
                compiled: Arc::new(Compiled {
                    checked: drawn,
                    wgsl,
                }),
                sides: pass.sides,
                runner: Arc::default(),
            },
        );
    }
    Ok(out)
}

fn identity() -> [f32; 16] {
    let mut m = [0.0; 16];
    for k in 0..4 {
        m[k * 5] = 1.0;
    }
    m
}

/// `tr`'s pass on the GPU over the finished sides `outgoing` and `incoming` (the frame's bytes,
/// 4 a pixel, rows top-down) at progress `p`, and the frame it returns read back. With `profiler`
/// the pass is timed under `label`, and the second value is its GPU time, ms.
#[allow(clippy::too_many_arguments)]
pub fn draw(
    app: &crate::App,
    profiler: Option<deep_scene3d_render::Profiler>,
    label: &str,
    tr: &Transition,
    outgoing: Vec<u8>,
    incoming: Vec<u8>,
    p: f64,
    size: [u32; 2],
) -> Result<(Vec<u8>, Option<f64>), Value> {
    let values = deep_canvas_effects::interp::inputs(
        &tr.compiled.checked,
        &BTreeMap::from([(PROGRESS.to_string(), Value::from(p))]),
        &BTreeMap::new(),
    );
    // Each texture input, in binding order, reads the side it names.
    let reads = tr
        .compiled
        .checked
        .textures
        .iter()
        .map(|name| Some(usize::from(tr.sides.get(OUTGOING) != Some(name))))
        .collect();
    let stage = Stage {
        label: label.to_string(),
        compiled: tr.compiled.clone(),
        runner: tr.runner.clone(),
        values,
        reads,
    };
    run(
        app,
        profiler,
        vec![stage],
        vec![outgoing, incoming],
        size,
        FORMAT,
    )
    .map_err(|e| json!({"code": "render_failed", "path": "transitions", "what": e}))
}

/// One pass of a chain [`run`] draws: its compiled pass, its pipeline once built, its values, and
/// what each texture input reads in binding order: an input image by index, or (`None`) the
/// stage before's output.
pub(crate) struct Stage {
    pub label: String,
    pub compiled: Arc<Compiled>,
    pub runner: Arc<Mutex<Option<(u64, Runner)>>>,
    pub values: BTreeMap<String, deep_canvas_effects::interp::Val>,
    pub reads: Vec<Option<usize>>,
}

/// The `stages` on the GPU, in order, over `inputs` (frames' bytes, 4 a pixel, rows top-down, at
/// `size`, in `format`), and the last one's output read back. With `profiler` each stage is timed
/// under its label, and the second value is their GPU time together, ms.
pub(crate) fn run(
    app: &crate::App,
    profiler: Option<deep_scene3d_render::Profiler>,
    stages: Vec<Stage>,
    inputs: Vec<Vec<u8>>,
    size: [u32; 2],
    format: wgpu::TextureFormat,
) -> Result<(Vec<u8>, Option<f64>), String> {
    app.worker
        .call(move |state| -> Result<(Vec<u8>, Option<f64>), String> {
            let d = state.gpu.device();
            let device = &d.device;
            let extent = wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            };
            let texture = |usage| {
                device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("operator pass"),
                    size: extent,
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage,
                    view_formats: &[],
                })
            };
            let uploaded: Vec<wgpu::TextureView> = inputs
                .iter()
                .map(|bytes| {
                    let t = texture(
                        wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                    );
                    d.queue.write_texture(
                        t.as_image_copy(),
                        bytes,
                        wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(4 * size[0]),
                            rows_per_image: None,
                        },
                        extent,
                    );
                    t.create_view(&Default::default())
                })
                .collect();
            // The interpreter's frame: identity clip, time 0, seed 0.
            let frame = Frame {
                clip: identity(),
                inverse_clip: identity(),
                ..Default::default()
            };
            let mut enc = device.create_command_encoder(&Default::default());
            let mut timer = profiler
                .as_ref()
                .map(|p| p.lock().unwrap_or_else(|e| e.into_inner()));
            let mut built = Vec::new();
            let mut last: Option<(wgpu::Texture, wgpu::TextureView)> = None;
            for stage in &stages {
                let mut slot = stage.runner.lock().unwrap_or_else(|e| e.into_inner());
                if slot.as_ref().is_none_or(|(epoch, _)| *epoch != d.epoch) {
                    *slot = Some((
                        d.epoch,
                        Runner::new(device, (*stage.compiled).clone(), format),
                    ));
                }
                let target = texture(
                    wgpu::TextureUsages::RENDER_ATTACHMENT
                        | wgpu::TextureUsages::COPY_SRC
                        | wgpu::TextureUsages::TEXTURE_BINDING,
                );
                let target_view = target.create_view(&Default::default());
                let views = stage
                    .reads
                    .iter()
                    .map(|r| match r {
                        Some(i) => uploaded.get(*i),
                        None => last.as_ref().map(|(_, v)| v).or(uploaded.first()),
                    })
                    .collect::<Option<Vec<&wgpu::TextureView>>>()
                    .ok_or("an operator pass reads an input it wasn't given")?;
                let Some((_, runner)) = slot.as_ref() else {
                    return Err("the operator's pass has no pipeline".into());
                };
                let (g0, g1, buffers) =
                    runner.bind(device, &frame, size, &stage.values, &views, &[]);
                match timer.as_mut() {
                    Some(t) => {
                        let q = t.begin_pass_query(stage.label.as_str(), &mut enc);
                        runner.encode(
                            &mut enc,
                            &target_view,
                            &(g0, g1),
                            q.render_pass_timestamp_writes(),
                        );
                        t.end_query(&mut enc, q);
                    }
                    None => runner.encode(&mut enc, &target_view, &(g0, g1), None),
                }
                built.push(buffers);
                last = Some((target, target_view));
            }
            let Some((target, _)) = last else {
                return Err("an operator chain draws at least one pass".into());
            };
            let row = (size[0] * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("operator pass read back"),
                size: u64::from(row) * u64::from(size[1]),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            enc.copy_texture_to_buffer(
                target.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(row),
                        rows_per_image: None,
                    },
                },
                extent,
            );
            d.queue.submit([enc.finish()]);
            drop(built);
            let bytes = crate::print2d::map_rows(
                device,
                &buffer,
                row as usize,
                (size[0] * 4) as usize,
                size[1] as usize,
            )?;
            // The passes' own spans, their timestamps resolved once they have finished, as the
            // frame's are (resolved beside it, the end of its fragment work may not be written
            // yet), from the newest finished profiler frame that holds each.
            let mut ms = None;
            if let Some(t) = timer.as_mut() {
                let mut enc = device.create_command_encoder(&Default::default());
                t.resolve_queries(&mut enc);
                d.queue.submit([enc.finish()]);
                let _ = t.end_frame();
                let _ = device.poll(wgpu::PollType::wait_indefinitely());
                let period = d.queue.get_timestamp_period();
                let mut spans = BTreeMap::new();
                while let Some(results) = t.process_finished_frame(period) {
                    for s in &stages {
                        if let Some(span) = results
                            .iter()
                            .filter(|r| r.label == s.label)
                            .find_map(|r| r.time.clone())
                        {
                            spans.insert(s.label.clone(), (span.end - span.start) * 1e3);
                        }
                    }
                }
                ms = (!spans.is_empty()).then(|| spans.values().sum());
            }
            Ok((bytes, ms))
        })
}
