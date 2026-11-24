//! #463: a look's operator finish on the GPU (canvas primitives: Pack: art@1 painterly looks):
//! each `finish` entry that names a pass operator, `{"<op>@<major>": {params}}`, checked and
//! compiled before a frame draws and run in order over the look's finished frame. Status marks and
//! the legend keep the frame's own pixels: their boxes are copied back after the passes, so a look
//! never recolors status (The status-color rule). And the chain of passes it runs as, which an
//! operator transition (#466) runs as too.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::{fx, look_finish};
use deep_gpu::device::Device;
use deep_scene3d_render::Profiler;
use serde_json::{json, Value};

use crate::compile::{self, Compiled};
use crate::runner::{Frame, Runner};

struct Pass {
    label: String,
    compiled: Arc<Compiled>,
    values: BTreeMap<String, deep_canvas_effects::interp::Val>,
    runner: Arc<Mutex<Option<(u64, Runner)>>>,
}

/// A look's operator finish: its passes, in the order its `finish` lists them.
#[derive(Clone, Default)]
pub struct Finish {
    passes: Arc<Vec<Pass>>,
}

/// The operator finish of the look `def`, its operators found in `manifests` or fx@1, each
/// checked as a look's finish and compiled; one that can't run refuses, naming its entry.
pub fn of(
    def: &Value,
    manifests: &[Value],
    roles: &BTreeMap<String, [f64; 3]>,
) -> Result<Finish, Value> {
    let mut passes = Vec::new();
    for (i, entry) in def["finish"].as_array().into_iter().flatten().enumerate() {
        let Some((name, params)) = look_finish::op_name(entry) else {
            continue;
        };
        let at = format!("look/finish/{i}/{name}");
        let graph = manifests
            .iter()
            .flat_map(fx::named)
            .chain(fx::library())
            .find(|n| n.name == name)
            .map(|n| n.graph)
            .ok_or_else(|| json!({"code": "operator_unknown_op", "path": at, "op": name}))?;
        let (checked, _) = look_finish::check(&graph).map_err(|issues| {
            let first = issues.first();
            json!({"code": first.map_or("operator_kind_rule", |i| i.code),
                "path": format!("{at}/{}", first.and_then(|i| i.path.clone()).unwrap_or_default()),
                "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
        })?;
        let wgsl = deep_canvas_effects::emit::pass(&checked, Default::default());
        compile::validate(&wgsl)
            .map_err(|e| json!({"code": "operator_compile", "path": at, "what": e}))?;
        let params: BTreeMap<String, Value> = params
            .as_object()
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let values = deep_canvas_effects::interp::inputs(&checked, &params, roles);
        passes.push(Pass {
            label: format!("finish/{i}/{name}"),
            compiled: Arc::new(Compiled { checked, wgsl }),
            values,
            runner: Arc::default(),
        });
    }
    Ok(Finish {
        passes: Arc::new(passes),
    })
}

impl Finish {
    pub fn is_empty(&self) -> bool {
        self.passes.is_empty()
    }

    /// The passes over `before` (the finished frame, 4 a pixel, rows top-down, at `size`, RGBA or
    /// with `bgra` BGRA), each box of `keep` (px `[x, y, w, h]`, status marks and the legend)
    /// left as it was. With `profiler` the passes are timed under `prefix` and their labels, and
    /// their GPU time returns, ms.
    #[allow(clippy::too_many_arguments)]
    pub fn apply(
        &self,
        device: &Device,
        profiler: Option<Profiler>,
        prefix: &str,
        before: Vec<u8>,
        size: [u32; 2],
        keep: &[[f64; 4]],
        bgra: bool,
    ) -> Result<(Vec<u8>, Option<f64>), String> {
        if self.passes.is_empty() {
            return Ok((before, None));
        }
        let stages: Vec<Stage> = self
            .passes
            .iter()
            .map(|p| Stage {
                label: format!("{prefix}{}", p.label),
                compiled: p.compiled.clone(),
                runner: p.runner.clone(),
                values: p.values.clone(),
                reads: vec![None; p.compiled.checked.textures.len()],
            })
            .collect();
        let format = if bgra {
            wgpu::TextureFormat::Bgra8Unorm
        } else {
            wgpu::TextureFormat::Rgba8Unorm
        };
        let inputs = [before];
        let (mut out, ms) = run_on(device, profiler, &stages, &inputs, size, format)?;
        keep_boxes(&mut out, &inputs[0], size, keep);
        Ok((out, ms))
    }
}

/// `before`'s pixels back into `out` inside each box of `keep`.
fn keep_boxes(out: &mut [u8], before: &[u8], size: [u32; 2], keep: &[[f64; 4]]) {
    let (w, h) = (size[0] as usize, size[1] as usize);
    for b in keep {
        let x0 = (b[0].floor().max(0.0) as usize).min(w);
        let y0 = (b[1].floor().max(0.0) as usize).min(h);
        let x1 = ((b[0] + b[2]).ceil().max(0.0) as usize).min(w);
        let y1 = ((b[1] + b[3]).ceil().max(0.0) as usize).min(h);
        for y in y0..y1 {
            let row = (y * w + x0) * 4..(y * w + x1) * 4;
            out[row.clone()].copy_from_slice(&before[row]);
        }
    }
}

fn identity() -> [f32; 16] {
    let mut m = [0.0; 16];
    for k in 0..4 {
        m[k * 5] = 1.0;
    }
    m
}

/// One pass of a chain [`run_on`] draws: its compiled pass, its pipeline once built, its values, and
/// what each texture input reads in binding order: an input image by index, or (`None`) the
/// stage before's output.
pub struct Stage {
    pub label: String,
    pub compiled: Arc<Compiled>,
    pub runner: Arc<Mutex<Option<(u64, Runner)>>>,
    pub values: BTreeMap<String, deep_canvas_effects::interp::Val>,
    pub reads: Vec<Option<usize>>,
}

/// The `stages` on the GPU, in order, over `inputs` (frames' bytes, 4 a pixel, rows top-down, at
/// `size`, in `format`), and the last one's output read back. With `profiler` each stage is timed
/// under its label, and the second value is their GPU time together, ms.
pub fn run_on(
    d: &Device,
    profiler: Option<Profiler>,
    stages: &[Stage],
    inputs: &[Vec<u8>],
    size: [u32; 2],
    format: wgpu::TextureFormat,
) -> Result<(Vec<u8>, Option<f64>), String> {
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
            let t = texture(wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST);
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
    for stage in stages {
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
        let (g0, g1, buffers) = runner.bind(device, &frame, size, &stage.values, &views, &[]);
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
    let bytes = map_rows(
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
            for s in stages {
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
}

/// A mapped buffer's rows, each `width` bytes of a `row`-byte stride.
pub fn map_rows(
    device: &deep_gpu::counted::Wgpu,
    buffer: &wgpu::Buffer,
    row: usize,
    width: usize,
    rows: usize,
) -> Result<Vec<u8>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return Err("the read back didn't map".into());
    }
    let data = buffer
        .slice(..)
        .get_mapped_range()
        .map_err(|_| "the read back didn't map".to_string())?;
    let mut out = Vec::with_capacity(width * rows);
    for y in 0..rows {
        out.extend_from_slice(&data[y * row..y * row + width]);
    }
    Ok(out)
}
