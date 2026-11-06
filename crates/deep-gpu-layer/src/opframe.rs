//! `check_operator` over a frame of operators (#483; tests/acceptance/483/README.md, The surface
//! under test): `operators` checked as `operator` is, then, if every one passes, run through the
//! document path's operator runtime (deep-effects-render's docops) over `data` at `size`,
//! `repeat` times, each listed output in `read` read back after each dispatch, with each
//! operator's GPU time per dispatch from its passes' own timestamps.

use std::collections::BTreeMap;

use deep_canvas_effects::graph;
use deep_effects_render::compile::compile_planted;
use deep_effects_render::docops::{DocOps, Hooks, Times};
use deep_effects_render::runner::{Frame, LINEAR};
use deep_gpu::device::Device;
use serde_json::{json, Map, Value};

use crate::effects::{operator_hooks, operator_plants};
use crate::view3d::{png, write_named};
use crate::{refused, App};

/// Whether a check_operator call asks for a frame (any of this suite's fields).
pub fn wants(call: &Value) -> bool {
    ["operators", "data", "size", "repeat", "read", "pool_marker"]
        .iter()
        .any(|k| call.get(*k).is_some())
}

/// No timer: the frame writes its own timestamps.
struct NoTimes;

impl Times for NoTimes {
    fn start(&mut self, _: &'static str, _: &mut wgpu::CommandEncoder) -> Option<usize> {
        None
    }
    fn render(&self, _: Option<usize>) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        None
    }
    fn compute(&self, _: Option<usize>) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        None
    }
    fn end(&mut self, _: Option<usize>, _: &mut wgpu::CommandEncoder) {}
}

fn words(path: &str) -> Result<Vec<u8>, Value> {
    std::fs::read(path).map_err(|e| refused("bad_input", format!("data {path}: {e}")))
}

fn f16(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = i32::from((bits >> 10) & 0x1f);
    let frac = f32::from(bits & 0x3ff);
    sign * match exp {
        0 => frac * 2f32.powi(-24),
        31 if frac == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + frac / 1024.0) * 2f32.powi(e - 15),
    }
}

fn to_f16(x: f32) -> u16 {
    // Round to nearest even through f64's exact arithmetic.
    let bits = x.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let a = x.abs();
    if a.is_nan() {
        return sign | 0x7e00;
    }
    if a >= 65520.0 {
        return sign | 0x7c00;
    }
    if a < 2f32.powi(-24) / 2.0 {
        return sign;
    }
    let e = a.log2().floor() as i32;
    if e < -14 {
        let m = (f64::from(a) / 2f64.powi(-24)).round_ties_even() as u16;
        return sign | m;
    }
    let m = (f64::from(a) / 2f64.powi(e) - 1.0) * 1024.0;
    let mut m = m.round_ties_even() as u32;
    let mut e = e;
    if m == 1024 {
        m = 0;
        e += 1;
    }
    sign | (((e + 15) as u16) << 10) | m as u16
}

/// Level `level` of `tex` read back as f32 RGBA, rows top-down, slices in z order.
pub(crate) fn read_texture(device: &Device, tex: &wgpu::Texture, level: u32) -> ([u32; 3], Vec<f32>) {
    let d = &device.device;
    let w = (tex.width() >> level).max(1);
    let h = (tex.height() >> level).max(1);
    let depth = if tex.dimension() == wgpu::TextureDimension::D3 {
        (tex.depth_or_array_layers() >> level).max(1)
    } else {
        1
    };
    let texel = match tex.format() {
        wgpu::TextureFormat::Rgba16Float => 8,
        wgpu::TextureFormat::Rgba32Float => 16,
        _ => 4,
    };
    let row = (w * texel).div_ceil(256) * 256;
    let size = u64::from(row) * u64::from(h) * u64::from(depth);
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("check_operator read back"),
        size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = d.create_command_encoder(&Default::default());
    enc.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: tex,
            mip_level: level,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &back,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: depth,
        },
    );
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let bytes = back
        .slice(..)
        .get_mapped_range()
        .map(|v| v.to_vec())
        .unwrap_or_default();
    let mut out = Vec::with_capacity((w * h * depth * 4) as usize);
    for z in 0..depth {
        for y in 0..h {
            let at = ((z * h + y) * row) as usize;
            let line = &bytes[at..at + (w * texel) as usize];
            for x in 0..w as usize {
                let t = &line[x * texel as usize..(x + 1) * texel as usize];
                let px: [f32; 4] = match tex.format() {
                    wgpu::TextureFormat::Rgba16Float => {
                        let h16 = |k: usize| f16(u16::from_le_bytes([t[2 * k], t[2 * k + 1]]));
                        [h16(0), h16(1), h16(2), h16(3)]
                    }
                    wgpu::TextureFormat::Rgba8Unorm => {
                        [0, 1, 2, 3].map(|k| f32::from(t[k]) / 255.0)
                    }
                    wgpu::TextureFormat::Rgba32Float => [0, 1, 2, 3].map(|k| {
                        f32::from_le_bytes([t[4 * k], t[4 * k + 1], t[4 * k + 2], t[4 * k + 3]])
                    }),
                    wgpu::TextureFormat::R32Float => {
                        [f32::from_le_bytes([t[0], t[1], t[2], t[3]]), 0.0, 0.0, 1.0]
                    }
                    _ => [
                        u32::from_le_bytes([t[0], t[1], t[2], t[3]]) as f32,
                        0.0,
                        0.0,
                        1.0,
                    ],
                };
                out.extend_from_slice(&px);
            }
        }
    }
    back.unmap();
    ([w, h, depth], out)
}

fn read_buffer(device: &Device, b: &wgpu::Buffer, words: u64) -> Vec<u8> {
    let d = &device.device;
    let size = (words * 4).min(b.size()).max(4);
    let back = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("check_operator read back"),
        size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = d.create_command_encoder(&Default::default());
    enc.copy_buffer_to_buffer(b, 0, &back, 0, size);
    device.queue.submit([enc.finish()]);
    back.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = d.poll(wgpu::PollType::wait_indefinitely());
    let v = back
        .slice(..)
        .get_mapped_range()
        .map(|v| v.to_vec())
        .unwrap_or_default();
    back.unmap();
    v
}

pub(crate) fn f32_bytes(px: &[f32]) -> Vec<u8> {
    px.iter().flat_map(|x| x.to_le_bytes()).collect()
}

/// A pass's color as the final target encodes it: sRGB, 8 bits a channel, unpremultiplied
/// alpha dropped to opaque.
fn srgb8(px: &[f32]) -> Vec<u8> {
    let enc = |x: f32| {
        let x = x.clamp(0.0, 1.0);
        let s = if x <= 0.003_130_8 {
            x * 12.92
        } else {
            1.055 * x.powf(1.0 / 2.4) - 0.055
        };
        (s * 255.0).round() as u8
    };
    px.chunks(4)
        .flat_map(|c| [enc(c[0]), enc(c[1]), enc(c[2]), 255])
        .collect()
}

/// One output read back, as the reply's `read` holds it (check_operator's, and view3d's for
/// each captured frame): storage `counts` words (all of it when absent), a texture with its mip
/// chain, or a pass's color.
pub fn read_one(
    device: &Device,
    ops: &DocOps,
    counts: &BTreeMap<String, u32>,
    key: &str,
    out: &str,
) -> Result<Value, Value> {
    let (item, output) = key
        .split_once('.')
        .ok_or_else(|| refused("bad_input", format!("read {key} is <op>.<output>")))?;
    if let Some(t) = ops.texture_of(item, output) {
        let levels = t.tex.mip_level_count();
        let mut files = Vec::new();
        let mut first = Value::Null;
        for l in 0..levels {
            let (size, px) = read_texture(device, &t.tex, l);
            let file = write_named(out, &f32_bytes(&px), "f32")?;
            let size: Vec<u32> = if t.out.dim3 {
                size.to_vec()
            } else {
                size[..2].to_vec()
            };
            if l == 0 {
                first = json!({"format": t.out.format, "size": size, "file": file});
            }
            files.push(json!({"size": size, "file": file}));
        }
        if t.out.mips {
            first["levels"] = json!(files);
        }
        return Ok(first);
    }
    if let Some(b) = ops.buffer_of(item, output) {
        let count = counts.get(key).copied().unwrap_or((b.size() / 4) as u32);
        let bytes = read_buffer(device, b, u64::from(count));
        let file = write_named(out, &bytes, "u32")?;
        return Ok(json!({"type": "u32", "count": count, "file": file}));
    }
    if let (Some(tex), "color") = (ops.drawn_of(item), output) {
        let (size, px) = read_texture(device, tex, 0);
        let file = write_named(out, &f32_bytes(&px), "f32")?;
        let png = write_named(out, &png(&srgb8(&px), [size[0], size[1]])?, "png")?;
        return Ok(
            json!({"format": "rgba16float", "size": [size[0], size[1]], "file": file, "png": png}),
        );
    }
    Err(refused(
        "bad_input",
        format!("read {key}: {item} has no output {output}"),
    ))
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let ops: Vec<Value> = match (&call["operators"], &call["operator"]) {
        (Value::Array(a), _) => a.clone(),
        (_, Value::Object(_)) => vec![call["operator"].clone()],
        _ => return refused("bad_input", "check_operator names an operator or operators"),
    };
    let size = match call["size"].as_array() {
        Some(s) if s.len() == 2 => [
            s[0].as_u64().unwrap_or(64) as u32,
            s[1].as_u64().unwrap_or(64) as u32,
        ],
        _ => [64, 64],
    };
    let repeat = call["repeat"].as_u64().unwrap_or(1).max(1) as usize;
    let reads: Vec<String> = call["read"]
        .as_array()
        .map(|r| {
            r.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let (options, check_options) = operator_plants(app.planted);
    let mut hooks: Hooks = operator_hooks(app.planted);
    // The pool's marker is the test-meter build's hook alone.
    if cfg!(feature = "test-meter") {
        if let Some(m) = call["pool_marker"].as_array() {
            let v: Vec<f32> = m
                .iter()
                .filter_map(Value::as_f64)
                .map(|x| x as f32)
                .collect();
            if v.len() == 4 {
                hooks.marker = Some([v[0], v[1], v[2], v[3]]);
            }
        }
    }
    // Each operator checked as `operator` is; each issue names its operator.
    let mut issues = Vec::new();
    let mut first: Option<(String, f64)> = None;
    let mut items = Map::new();
    let mut counts: BTreeMap<String, u32> = BTreeMap::new();
    // The elements the check costs each compute operator at: an indirect dispatch's max (#484).
    let mut costed = Map::new();
    for op in &ops {
        let id = op["id"].as_str().unwrap_or("").to_string();
        match compile_planted(op, &BTreeMap::new(), options, check_options) {
            Ok(c) => {
                if first.is_none() {
                    first = Some((c.checked.class.name().to_string(), c.checked.estimate));
                }
                for (n, s) in &c.checked.op.storage {
                    counts.insert(format!("{id}.{n}"), s.count);
                }
                if c.checked.op.kind == graph::Kind::Compute {
                    costed.insert(id.clone(), json!(c.checked.op.elements));
                }
            }
            Err(e) => issues.extend(e.into_iter().map(|i| {
                let mut v = graph::Issue {
                    item: Some(id.clone()),
                    ..i
                }
                .to_json();
                if let Value::Object(o) = &mut v {
                    o.entry("item").or_insert(json!(id));
                }
                v
            })),
        }
        let mut params = op.as_object().cloned().unwrap_or_default();
        params.remove("id");
        let kind = params
            .remove("kind")
            .and_then(|k| k.as_str().map(String::from))
            .unwrap_or_default();
        items.insert(
            id.clone(),
            json!({"id": id, "kind": format!("gpu.{kind}@1"), "params": params}),
        );
    }
    let mut reply = json!({"outcome": if issues.is_empty() { "accepted" } else { "refused" }, "issues": issues});
    if let Some((class, est)) = &first {
        reply["class"] = json!(class);
        reply["estimate_ns"] = json!(est);
    }
    reply["costed_elements"] = Value::Object(costed);
    if !issues.is_empty() {
        return reply;
    }
    // The core's inputs: storage as words, `color` as f32 RGBA at the frame's size.
    let mut data: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    for (name, path) in call["data"].as_object().into_iter().flatten() {
        match path.as_str().map(words) {
            Some(Ok(b)) => {
                data.insert(name.clone(), b);
            }
            Some(Err(e)) => return e,
            None => return refused("bad_input", format!("data {name} is a path")),
        }
    }
    let doc = json!({"seed": 0, "items": items});
    let res: BTreeMap<String, f64> = ops
        .iter()
        .map(|op| {
            let r = match op["resolution"].as_str() {
                Some("full") => 1.0,
                Some("quarter") => 0.25,
                _ if op["kind"] == "compute" => 1.0,
                _ => 0.5,
            };
            (op["id"].as_str().unwrap_or("").to_string(), r)
        })
        .collect();
    let out = out.to_string();
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let d = &device.device;
        use wgpu::util::DeviceExt as _;
        let mut core = BTreeMap::new();
        let mut color_px: Option<Vec<u8>> = None;
        for (name, bytes) in &data {
            if name == "color" {
                let px: Vec<u8> = bytes
                    .chunks(4)
                    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
                    .flat_map(|x| to_f16(x).to_le_bytes())
                    .collect();
                color_px = Some(px);
                continue;
            }
            let b = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("check_operator data"),
                contents: if bytes.is_empty() { &[0; 4] } else { bytes },
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST,
            });
            core.insert(name.clone(), b);
        }
        let color = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("check_operator color"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: LINEAR,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        if let Some(px) = &color_px {
            if px.len() as u64 == u64::from(size[0]) * u64::from(size[1]) * 8 {
                device.queue.write_texture(
                    color.as_image_copy(),
                    px,
                    wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(size[0] * 8),
                        rows_per_image: Some(size[1]),
                    },
                    color.size(),
                );
            }
        }
        let view = color.create_view(&Default::default());
        let mut ops = DocOps::with(&device, &doc, options, check_options, &[], hooks, core);
        let mut dispatches = Vec::new();
        let mut gpu_ns: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        let tail = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("check_operator tail"),
            size: wgpu::Extent3d {
                width: 4,
                height: 4,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        let tail = tail.create_view(&Default::default());
        let stamps = device.timestamps.query;
        for _ in 0..repeat {
            let (rows, recs, _) = ops.plan(
                &device,
                &view,
                None,
                None,
                size,
                &Frame::default(),
                &BTreeMap::new(),
                &|i| res.get(i).copied().unwrap_or(1.0),
                false,
            );
            let mut enc = d.create_command_encoder(&Default::default());
            for r in &recs {
                r.record_clears(&mut enc);
            }
            let total: u32 = recs.iter().map(|r| r.queries()).sum();
            let set = (stamps && total > 0).then(|| {
                d.create_query_set(&wgpu::QuerySetDescriptor {
                    label: Some("check_operator stamps"),
                    ty: wgpu::QueryType::Timestamp,
                    count: total,
                })
            });
            let mut at = 0u32;
            let mut spans = Vec::new();
            for r in &recs {
                let used = r.record_passes(&mut enc, &mut NoTimes, set.as_ref().map(|s| (s, at)));
                spans.push((r.mark, at, used));
                at += used;
            }
            // On Metal a timestamp at the end of the encoder's last pass reads 0: one more pass.
            drop(enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("check_operator tail"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &tail,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            }));
            device.queue.submit([enc.finish()]);
            let _ = d.poll(wgpu::PollType::wait_indefinitely());
            // The stamps are resolved once the frame's work is done, in a submission of their own:
            // resolved in the frame's own encoder, Metal reads the last pass's end as 0.
            let resolved = set.as_ref().map(|s| {
                let bytes = u64::from(total) * 8;
                let res = d.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: bytes,
                    usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                    mapped_at_creation: false,
                });
                let mut enc = d.create_command_encoder(&Default::default());
                enc.resolve_query_set(s, 0..total, &res, 0);
                device.queue.submit([enc.finish()]);
                res
            });
            if let Some(res) = &resolved {
                let words = read_buffer(&device, res, u64::from(total) * 2);
                let t: Vec<u64> = words
                    .chunks(8)
                    .map(|b| u64::from_le_bytes(b.try_into().unwrap_or([0; 8])))
                    .collect();
                let period = f64::from(device.queue.get_timestamp_period());
                for (mark, from, used) in &spans {
                    let ns: f64 = (0..*used / 2)
                        .map(|k| {
                            let (a, b) =
                                (t[(from + 2 * k) as usize], t[(from + 2 * k + 1) as usize]);
                            if a == 0 || b < a {
                                0.0
                            } else {
                                (b - a) as f64 * period
                            }
                        })
                        .sum();
                    let item = mark.strip_prefix("op.").unwrap_or(mark).to_string();
                    gpu_ns.entry(item).or_default().push(ns);
                }
            }
            for r in &rows {
                if !spans
                    .iter()
                    .any(|(m, _, _)| m.strip_prefix("op.") == Some(&r.item))
                {
                    gpu_ns.entry(r.item.clone()).or_default().push(0.0);
                }
            }
            let mut read = Map::new();
            for key in &reads {
                match read_one(&device, &ops, &counts, key, &out) {
                    Ok(v) => {
                        read.insert(key.clone(), v);
                    }
                    Err(e) => return e,
                }
            }
            dispatches.push(json!({"read": read}));
        }
        reply["dispatches"] = json!(dispatches);
        reply["timing"] = json!({"gpu_ns": gpu_ns});
        reply
    })
}
