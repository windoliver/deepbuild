//! The test kinds of #1413 (tests/acceptance/1413/README.md: The test kinds; `test-faults` builds
//! only), built as a revision latches, never inside a frame: `test.alloc@1`, a labeled buffer of
//! `bytes` used `uses` times, and `test.pipeline@1`, a labeled render pipeline. Each builds inside
//! an out-of-memory scope; one that fails is recorded on the device as its writer's error.

use std::sync::{Arc, Mutex};

use deep_gpu::device::{push_scope, Device, Failure};
use deep_gpu::memory;
use serde_json::Value;

use crate::effects::pollster_block;

/// One resource a revision builds.
pub enum Build {
    Alloc {
        label: String,
        bytes: u64,
        uses: u64,
    },
    Pipeline {
        label: String,
    },
}

impl Build {
    fn label(&self) -> &str {
        match self {
            Build::Alloc { label, .. } | Build::Pipeline { label } => label,
        }
    }
}

/// The test builds a stamped document holds, in item order.
pub fn builds(doc: &Value) -> Vec<Build> {
    let mut out = Vec::new();
    for item in doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(_, i)| i)
    {
        let p = &item["params"];
        let label = p["label"].as_str().unwrap_or_default().to_string();
        match item["kind"].as_str() {
            Some("test.alloc@1") => out.push(Build::Alloc {
                label,
                bytes: p["bytes"].as_u64().unwrap_or(0),
                uses: p["uses"].as_u64().unwrap_or(0),
            }),
            Some("test.pipeline@1") => out.push(Build::Pipeline { label }),
            _ => {}
        }
    }
    out
}

const SHADER: &str =
    "@vertex fn vs() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }";

/// Builds `b` on `device`; the failure its writer is told when it fails. `lose_during` is the
/// planted loss: the device is lost just as the build of the resource it names starts.
pub fn build(
    device: &Device,
    b: &Build,
    lose_during: &mut Option<String>,
) -> Option<Arc<Mutex<Failure>>> {
    let label = b.label();
    if lose_during.as_deref() == Some(label) {
        *lose_during = None;
        device.force_loss();
    }
    let d = &device.device;
    let oom = push_scope(d, wgpu::ErrorFilter::OutOfMemory);
    let (refused, bytes) = match b {
        Build::Alloc { bytes, uses, .. } => {
            let desc = wgpu::BufferDescriptor {
                label: Some(label),
                size: *bytes,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            };
            // Past wgpu's own size limit the device itself is asked, so its answer, not wgpu's
            // validation, decides; a buffer it refuses is wgpu's invalid buffer, as a failed
            // allocation leaves one.
            let (buffer, refused) = if *bytes > d.limits().max_buffer_size {
                match memory::device_buffer(device, &desc) {
                    Some(b) => (b, false),
                    None => {
                        let invalid = push_scope(d, wgpu::ErrorFilter::Validation);
                        let b = d.create_buffer(&desc);
                        let _ = pollster_block(invalid.pop());
                        (b, true)
                    }
                }
            } else {
                (d.create_buffer(&desc), false)
            };
            let error = pollster_block(oom.pop());
            let failure = classify(device, label, Some(*bytes), refused || error.is_some());
            for _ in 0..*uses {
                device.queue.write_buffer(&buffer, 0, &[0; 4]);
            }
            return failure;
        }
        Build::Pipeline { .. } => {
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(SHADER.into()),
            });
            let _ = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: None,
                vertex: wgpu::VertexState {
                    module: &module,
                    entry_point: Some("vs"),
                    compilation_options: Default::default(),
                    buffers: &[],
                },
                fragment: Some(wgpu::FragmentState {
                    module: &module,
                    entry_point: Some("fs"),
                    compilation_options: Default::default(),
                    targets: &[Some(wgpu::TextureFormat::Rgba8Unorm.into())],
                }),
                primitive: Default::default(),
                depth_stencil: None,
                multisample: Default::default(),
                multiview_mask: None,
                cache: None,
            });
            (pollster_block(oom.pop()).is_some(), None)
        }
    };
    classify(device, label, bytes, refused)
}

/// A build on a lost device failed for the loss, whatever its symptom; otherwise one the device
/// refused failed for memory.
fn classify(
    device: &Device,
    label: &str,
    bytes: Option<u64>,
    refused: bool,
) -> Option<Arc<Mutex<Failure>>> {
    if device.is_lost() {
        Some(device.failed("device_lost", Some(label), bytes))
    } else if refused {
        Some(device.failed("out_of_memory", Some(label), bytes))
    } else {
        None
    }
}
