//! The GPU fixtures (issue #140; tests/acceptance/140/gpu/README.md): the path each gated
//! feature of the tier's table guards, run granted or through its fallback, and test-seam's
//! fixtures for the validation lane and the error channel. Each draws offscreen on the app's
//! device, waits for it, and reads back what it wrote.

use std::time::Instant;

use deep_gpu::device::Device;
use deep_gpu::seam;

use crate::Planted;

/// What a fixture ran and wrote.
pub struct Ran {
    /// The path it took: a gated feature's own name, or the table's fallback.
    pub took: &'static str,
    pub pipelines: Vec<&'static str>,
    pub passes: Vec<&'static str>,
    /// Its target, read back.
    pub bytes: Vec<u8>,
    /// Whether its output is within its golden.
    pub golden: bool,
    /// Every float target or storage buffer it wrote, read back.
    pub floats: Vec<Floats>,
    /// The buffers it binds, by label: group and binding.
    pub buffers: Vec<(&'static str, u32, u32)>,
}

/// A float target or storage buffer, read back: `lanes` values per texel, `width` texels a row.
pub struct Floats {
    pub pass: &'static str,
    pub target: &'static str,
    pub format: &'static str,
    pub width: u32,
    pub lanes: usize,
    pub values: Vec<f32>,
}

/// The fixtures the tier's table lists, which every build runs.
pub fn shipped() -> Vec<&'static str> {
    seam::TABLE
        .iter()
        .flat_map(|r| r.fixtures.iter().copied())
        .collect()
}

/// test-seam's fixtures (README: The validation lane, The error channel).
const TEST: [&str; 5] = [
    "storage_read",
    "float_target",
    "uncovered_kind",
    "clean_render",
    "raises_validation_error",
];

pub fn known(name: &str) -> bool {
    shipped().contains(&name) || (cfg!(feature = "test-seam") && TEST.contains(&name))
}

/// A fixture's shader kind. `uncovered_kind` stands for a mesh shader: wgpu's mesh pipelines are
/// experimental, and nothing has shown Metal's shader validation instrumenting them.
pub fn kind(name: &str) -> &'static str {
    if name == "uncovered_kind" {
        "mesh"
    } else {
        "fragment"
    }
}

/// The path a gated feature's fixture takes on `device`: its own, or the table's fallback.
fn path(device: &Device, feature: &str) -> (bool, &'static str) {
    let row = seam::row(feature).expect("a feature of the table");
    let granted = device.device.features().contains(row.wgpu);
    (
        granted,
        if granted {
            row.feature
        } else {
            row.fallback.unwrap_or(row.feature)
        },
    )
}

const VERTEX: &str =
    "@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, Z, 1.0);
}
";
/// A flat color, exact in 8 bits.
const FLAT: &str = "const Z: f32 = 0.5;
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(51.0, 102.0, 153.0, 255.0) / 255.0; }
";
const FLAT_BYTES: [u8; 4] = [51, 102, 153, 255];

/// One full-screen draw into a fresh target, waited for and read back.
struct Draw<'a> {
    pipeline: &'static str,
    pass: &'static str,
    /// The fragment side and its constants; [`VERTEX`] goes before it.
    source: String,
    format: wgpu::TextureFormat,
    size: [u32; 2],
    /// Bound at group 0, binding by position: label, storage (else uniform), bytes.
    buffers: &'a [(&'static str, bool, Vec<u8>)],
    unclipped_depth: bool,
    timestamps: Option<&'a wgpu::QuerySet>,
}

/// Draws `d`; in the validation lane its module is built without the translator's own bounds
/// checks, so an access out of bounds reaches Metal's shader validation instead of being clamped.
fn draw(device: &Device, lane: bool, d: Draw) -> Vec<u8> {
    let dev = &device.device;
    let source = format!("{VERTEX}{}", d.source);
    let desc = wgpu::ShaderModuleDescriptor {
        label: Some(d.pipeline),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    };
    let module = if lane {
        // SAFETY: the lane's fixtures are this crate's own shaders, run under Metal's API and
        // shader validation, which reports any access out of bounds.
        unsafe { dev.create_shader_module_trusted(desc, wgpu::ShaderRuntimeChecks::unchecked()) }
    } else {
        dev.create_shader_module(desc)
    };
    let pipeline = dev.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(d.pipeline),
        layout: None,
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        primitive: wgpu::PrimitiveState {
            unclipped_depth: d.unclipped_depth,
            ..Default::default()
        },
        depth_stencil: None,
        multisample: Default::default(),
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("fs"),
            compilation_options: Default::default(),
            targets: &[Some(d.format.into())],
        }),
        multiview_mask: None,
        cache: None,
    });
    let buffers: Vec<wgpu::Buffer> = d
        .buffers
        .iter()
        .map(|(label, storage, bytes)| {
            let usage = if *storage {
                wgpu::BufferUsages::STORAGE
            } else {
                wgpu::BufferUsages::UNIFORM
            };
            let b = dev.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: bytes.len() as u64,
                usage: usage | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            device.queue.write_buffer(&b, 0, bytes);
            b
        })
        .collect();
    let bind = (!buffers.is_empty()).then(|| {
        let entries: Vec<wgpu::BindGroupEntry> = buffers
            .iter()
            .enumerate()
            .map(|(i, b)| wgpu::BindGroupEntry {
                binding: i as u32,
                resource: b.as_entire_binding(),
            })
            .collect();
        dev.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(d.pipeline),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        })
    });
    let extent = wgpu::Extent3d {
        width: d.size[0],
        height: d.size[1],
        depth_or_array_layers: 1,
    };
    let target = dev.create_texture(&wgpu::TextureDescriptor {
        label: Some(d.pass),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: d.format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let texel = d.format.block_copy_size(None).unwrap_or(4);
    let row = d.size[0] * texel;
    let padded = row.div_ceil(256) * 256;
    let read = dev.create_buffer(&wgpu::BufferDescriptor {
        label: Some(d.pass),
        size: u64::from(padded * d.size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = dev.create_command_encoder(&Default::default());
    {
        let view = target.create_view(&Default::default());
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(d.pass),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            timestamp_writes: d.timestamps.map(|q| wgpu::RenderPassTimestampWrites {
                query_set: q,
                beginning_of_pass_write_index: Some(0),
                end_of_pass_write_index: Some(1),
            }),
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        if let Some(b) = &bind {
            pass.set_bind_group(0, b, &[]);
        }
        pass.draw(0..3, 0..1);
    }
    encoder.copy_texture_to_buffer(
        target.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &read,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(d.size[1]),
            },
        },
        extent,
    );
    device.queue.submit([encoder.finish()]);
    let bytes = map(device, &read);
    bytes
        .chunks(padded as usize)
        .flat_map(|r| r[..row as usize].iter().copied())
        .collect()
}

/// A MAP_READ buffer's bytes, once the GPU's work on it is done.
fn map(device: &Device, buffer: &wgpu::Buffer) -> Vec<u8> {
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
    let bytes = buffer
        .slice(..)
        .get_mapped_range()
        .map(|d| d.to_vec())
        .unwrap_or_default();
    buffer.unmap();
    bytes
}

/// The begin and end ticks of a pass's timestamps, resolved in a submission of their own once
/// the pass's has completed (as #379's tick does).
fn ticks(device: &Device, query: &wgpu::QuerySet) -> (u64, u64) {
    let buffer = |usage| {
        device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("pass_timing ticks"),
            size: 16,
            usage,
            mapped_at_creation: false,
        })
    };
    let resolve = buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC);
    let read = buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST);
    let mut encoder = device.device.create_command_encoder(&Default::default());
    encoder.resolve_query_set(query, 0..2, &resolve, 0);
    encoder.copy_buffer_to_buffer(&resolve, 0, &read, 0, 16);
    device.queue.submit([encoder.finish()]);
    let b = map(device, &read);
    let at = |i: usize| {
        b.get(i..i + 8)
            .map_or(0, |s| u64::from_le_bytes(s.try_into().unwrap_or([0; 8])))
    };
    (at(0), at(8))
}

/// Whether every texel of `bytes` is `texel`.
fn all(bytes: &[u8], texel: [u8; 4]) -> bool {
    !bytes.is_empty() && bytes.chunks(4).all(|t| t == texel)
}

/// An IEEE half's value.
fn half(bits: u16) -> f32 {
    let (sign, exp, frac) = (bits >> 15, (bits >> 10) & 31, f32::from(bits & 1023));
    let v = match exp {
        0 => frac * 2f32.powi(-24),
        31 if frac == 0.0 => f32::INFINITY,
        31 => f32::NAN,
        e => (1.0 + frac / 1024.0) * 2f32.powi(i32::from(e) - 15),
    };
    if sign == 1 {
        -v
    } else {
        v
    }
}

/// Runs fixture `name` on `device`; `lane` builds its modules for the validation lane, and a
/// planted program changes the fixture it plants into.
pub fn run(
    device: &Device,
    name: &str,
    lane: bool,
    planted: Option<Planted>,
) -> Result<Ran, String> {
    let flat = |pipeline, pass| Draw {
        pipeline,
        pass,
        source: FLAT.into(),
        format: wgpu::TextureFormat::Rgba8Unorm,
        size: [16, 16],
        buffers: &[],
        unclipped_depth: false,
        timestamps: None,
    };
    let ran = |took, pipeline, pass, bytes: Vec<u8>, golden| Ran {
        took,
        pipelines: vec![pipeline],
        passes: vec![pass],
        bytes,
        golden,
        floats: Vec::new(),
        buffers: Vec::new(),
    };
    match name {
        // Pass timestamps, or the CPU timing: a pass timed on the GPU, or its submission timed on
        // the CPU, and its pixels.
        "pass_timing" => {
            let (granted, took) = path(device, "timestamps");
            let (bytes, timed) = if granted {
                let query = device.device.create_query_set(&wgpu::QuerySetDescriptor {
                    label: Some("pass_timing"),
                    ty: wgpu::QueryType::Timestamp,
                    count: 2,
                });
                let mut d = flat("pass_timing", "pass_timing pass");
                d.timestamps = Some(&query);
                let bytes = draw(device, lane, d);
                let (begin, end) = ticks(device, &query);
                (bytes, begin > 0 && end >= begin)
            } else {
                let started = Instant::now();
                let bytes = draw(device, lane, flat("pass_timing", "pass_timing pass"));
                (bytes, started.elapsed().as_nanos() > 0)
            };
            let golden = timed && all(&bytes, FLAT_BYTES);
            Ok(ran(took, "pass_timing", "pass_timing pass", bytes, golden))
        }
        // Depth-clip control, or a pancaked near plane: a triangle in front of the near plane is
        // drawn with depth clipping off, or with its depth clamped to the plane in the vertex
        // stage; either way it covers the target, where a clipped one would draw nothing.
        "depth_clip" => {
            let (granted, took) = path(device, "depth_clip_control");
            let z = if granted { "-0.5" } else { "max(-0.5, 0.0)" };
            let mut d = flat("depth_clip", "depth_clip pass");
            d.source = FLAT.replace("const Z: f32 = 0.5;", &format!("const Z: f32 = {z};"));
            d.unclipped_depth = granted;
            let bytes = draw(device, lane, d);
            let golden = all(&bytes, FLAT_BYTES);
            Ok(ran(took, "depth_clip", "depth_clip pass", bytes, golden))
        }
        "storage_read" if known(name) => Ok(storage_read(
            device,
            lane,
            planted == Some(Planted::ReadsPastBuffer),
        )),
        "float_target" if known(name) => Ok(float_target(
            device,
            lane,
            planted == Some(Planted::WritesNan),
        )),
        "clean_render" | "raises_validation_error" if known(name) => {
            let fixture = if name == "clean_render" {
                "clean_render"
            } else {
                "raises_validation_error"
            };
            let bytes = draw(device, lane, flat(fixture, "render pass"));
            if name == "raises_validation_error" {
                // A texture with no width: one wgpu validation error, through the callback.
                let _ = device.device.create_texture(&wgpu::TextureDescriptor {
                    label: Some("raises_validation_error"),
                    size: wgpu::Extent3d {
                        width: 0,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::TEXTURE_BINDING,
                    view_formats: &[],
                });
            }
            let golden = all(&bytes, FLAT_BYTES);
            Ok(ran("render", fixture, "render pass", bytes, golden))
        }
        _ => Err(format!("{name} isn't a fixture this lane can run")),
    }
}

/// The share of texels a test fixture's golden allows to differ.
const GOLDEN_SHARE: f64 = 0.01;

/// `storage_read`: an operator drawing each texel from its own element of a storage buffer.
/// Planted (`reads_past_buffer`), the last texel reads one element past the buffer's end. It is
/// also the validation lane's canary, planted: a read out of bounds the lane must report.
pub fn storage_read(device: &Device, lane: bool, past: bool) -> Ran {
    const SIDE: u32 = 32;
    let data: Vec<u32> = (0..SIDE * SIDE)
        .map(|i| u32::from_le_bytes([(i * 7) as u8, (i * 13) as u8, (i * 29) as u8, 255]))
        .collect();
    let params = [u32::from(past), 0, 0, 0];
    let buffers = [
        (
            "storage_read data",
            true,
            data.iter().flat_map(|w| w.to_le_bytes()).collect(),
        ),
        (
            "storage_read params",
            false,
            params.iter().flat_map(|w| w.to_le_bytes()).collect(),
        ),
    ];
    let source = format!(
        "const Z: f32 = 0.5;
@group(0) @binding(0) var<storage, read> data: array<u32>;
@group(0) @binding(1) var<uniform> params: vec4<u32>;
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {{
    let i = u32(p.y) * {SIDE}u + u32(p.x);
    return unpack4x8unorm(data[i + select(0u, params.x, i == {}u)]);
}}
",
        SIDE * SIDE - 1
    );
    let bytes = draw(
        device,
        lane,
        Draw {
            pipeline: "storage_read operator",
            pass: "storage_read pass",
            source,
            format: wgpu::TextureFormat::Rgba8Unorm,
            size: [SIDE, SIDE],
            buffers: &buffers,
            unclipped_depth: false,
            timestamps: None,
        },
    );
    let wrong = bytes
        .chunks(4)
        .zip(&data)
        .filter(|(t, w)| *t != w.to_le_bytes())
        .count();
    Ran {
        took: "storage_read",
        pipelines: vec!["storage_read operator"],
        passes: vec!["storage_read pass"],
        golden: bytes.len() == data.len() * 4 && (wrong as f64) <= GOLDEN_SHARE * data.len() as f64,
        bytes,
        floats: Vec::new(),
        buffers: vec![("storage_read data", 0, 0), ("storage_read params", 0, 1)],
    }
}

/// `float_target`: a pass writing an rgba16float target, each texel its own center over the
/// side, exact in halves. Planted (`writes_nan`), texel (5, 9) is NaN.
fn float_target(device: &Device, lane: bool, nan: bool) -> Ran {
    const SIDE: u32 = 16;
    let params = [u32::from(nan), 5, 9, 0x7fc0_0000];
    let buffers = [(
        "float_target params",
        false,
        params.iter().flat_map(|w| w.to_le_bytes()).collect(),
    )];
    let source = format!(
        "const Z: f32 = 0.5;
@group(0) @binding(0) var<uniform> params: vec4<u32>;
@fragment fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {{
    if params.x == 1u && u32(p.x) == params.y && u32(p.y) == params.z {{
        return vec4<f32>(bitcast<f32>(params.w));
    }}
    return vec4<f32>(p.xy / {SIDE}.0, 0.5, 1.0);
}}
"
    );
    let bytes = draw(
        device,
        lane,
        Draw {
            pipeline: "float_target shader",
            pass: "float_target pass",
            source,
            format: wgpu::TextureFormat::Rgba16Float,
            size: [SIDE, SIDE],
            buffers: &buffers,
            unclipped_depth: false,
            timestamps: None,
        },
    );
    let values: Vec<f32> = bytes
        .chunks(2)
        .map(|h| half(u16::from_le_bytes([h[0], h[1]])))
        .collect();
    let wrong = values
        .chunks(4)
        .enumerate()
        .filter(|(i, v)| {
            let (x, y) = ((*i as u32 % SIDE) as f32, (*i as u32 / SIDE) as f32);
            *v != [(x + 0.5) / SIDE as f32, (y + 0.5) / SIDE as f32, 0.5, 1.0]
        })
        .count();
    let texels = (SIDE * SIDE) as usize;
    Ran {
        took: "float_target",
        pipelines: vec!["float_target shader"],
        passes: vec!["float_target pass"],
        golden: values.len() == texels * 4 && (wrong as f64) <= GOLDEN_SHARE * texels as f64,
        bytes,
        floats: vec![Floats {
            pass: "float_target pass",
            target: "float_target target",
            format: "rgba16float",
            width: SIDE,
            lanes: 4,
            values,
        }],
        buffers: vec![("float_target params", 0, 0)],
    }
}
