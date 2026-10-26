//! The `adapter` and `tick` calls (issue #379; tests/acceptance/379/README.md, Other calls): the
//! device's timestamp features as the meter uses them, and one waited submission bracketed by
//! timestamp writes, whose ticks the proof checks against the host's wall time.

use std::time::Instant;

use deep_gpu::device::{Backend, Device};
use serde_json::{json, Value};

use crate::{refused, App};

const SHADER: &str = include_str!("tick.wgsl");
const SIZE: u32 = 1024;

pub fn adapter(app: &mut App) -> Value {
    let backend = app.backend;
    app.worker.call(move |state| {
        let withheld = state.gpu.withheld();
        let d = state.gpu.device();
        let ts = d.timestamps;
        json!({
            "backend": match backend {
                Backend::Noop => "noop",
                Backend::Gpu if cfg!(target_os = "macos") => "metal",
                Backend::Gpu => "gpu",
            },
            "name": d.name,
            "timestamps": {
                "query": ts.query, "inside_encoders": ts.inside_encoders, "inside_passes": ts.inside_passes,
                "period_ns": ts.period_ns,
            },
            "withheld": if withheld.timestamps { vec!["timestamps"] } else { Vec::new() },
        })
    })
}

/// A full-screen pass of `loops` iterations per pixel, timed by its timestamp writes.
struct Spin {
    pipeline: wgpu::RenderPipeline,
    bind: wgpu::BindGroup,
    uniform: wgpu::Buffer,
    target: wgpu::TextureView,
    query: wgpu::QuerySet,
    resolve: wgpu::Buffer,
    read: wgpu::Buffer,
}

impl Spin {
    fn new(device: &Device) -> Spin {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("tick"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("tick"),
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let uniform = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("tick loops"),
            size: 16,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("tick"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("tick"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("tick"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("full"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("spin"),
                compilation_options: Default::default(),
                targets: &[Some(format.into())],
            }),
            multiview_mask: None,
            cache: None,
        });
        let target = d
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("tick"),
                size: wgpu::Extent3d {
                    width: SIZE,
                    height: SIZE,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let query = d.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("tick"),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
        let buffer = |usage| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("tick times"),
                size: 16,
                usage,
                mapped_at_creation: false,
            })
        };
        Spin {
            pipeline,
            bind,
            uniform,
            target,
            query,
            resolve: buffer(wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC),
            read: buffer(wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST),
        }
    }

    /// One submission of `loops`, waited for: its ticks, and the wall time from submit to the
    /// wait's return in ns.
    fn run(&self, device: &Device, loops: u32) -> Option<(u64, u64)> {
        device
            .queue
            .write_buffer(&self.uniform, 0, bytemuck::cast_slice(&[loops, 0, 0, 0]));
        let mut encoder = device.device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("tick"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &self.target,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                timestamp_writes: Some(wgpu::RenderPassTimestampWrites {
                    query_set: &self.query,
                    beginning_of_pass_write_index: Some(0),
                    end_of_pass_write_index: Some(1),
                }),
                ..Default::default()
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind, &[]);
            pass.draw(0..3, 0..1);
        }
        encoder.resolve_query_set(&self.query, 0..2, &self.resolve, 0);
        encoder.copy_buffer_to_buffer(&self.resolve, 0, &self.read, 0, 16);
        let buffer = encoder.finish();
        let started = Instant::now();
        device.queue.submit([buffer]);
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
        let wall = started.elapsed().as_nanos() as u64;
        let slice = self.read.slice(..);
        slice.map_async(wgpu::MapMode::Read, |_| {});
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
        let ticks = {
            let data = slice.get_mapped_range().ok()?;
            let begin = u64::from_le_bytes(data[..8].try_into().ok()?);
            let end = u64::from_le_bytes(data[8..16].try_into().ok()?);
            end.saturating_sub(begin)
        };
        self.read.unmap();
        Some((ticks, wall))
    }
}

/// The next trial's loop count: the last one scaled toward `target` from the `ns` it took, by
/// at most 16, and always at least one more.
fn grown(loops: u32, ns: f64, target: f64) -> u32 {
    let grow = if ns > 0.0 {
        (target / ns).clamp(1.0, 16.0)
    } else {
        16.0
    };
    ((f64::from(loops) * grow) as u32).max(loops + 1)
}

/// `{"call": "tick", "gpu_ms"}`: a submission sized, from short trial runs, to take about
/// `gpu_ms` of GPU time.
pub fn tick(app: &mut App, call: &Value) -> Value {
    let Some(gpu_ms) = call["gpu_ms"]
        .as_f64()
        .filter(|g| *g > 0.0 && *g <= 10_000.0)
    else {
        return refused("bad_input", "gpu_ms is a time in ms");
    };
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let Some(period) = device.timestamps.period_ns.map(f64::from) else {
            return refused("no_timestamps", "the device writes no pass timestamps");
        };
        let spin = Spin::new(&device);
        let target = gpu_ms * 1e6;
        let mut loops = 64u32;
        for _ in 0..8 {
            let Some((ticks, _)) = spin.run(&device, loops) else {
                return refused("no_read_back", "the timestamps didn't map");
            };
            let ns = ticks as f64 * period;
            if ns > target * 0.8 {
                break;
            }
            loops = grown(loops, ns, target);
        }
        match spin.run(&device, loops) {
            Some((ticks, wall)) => json!({
                "ticks": ticks, "period_ns": period, "gpu_ns": ticks as f64 * period, "wall_ns": wall, "loops": loops,
            }),
            None => refused("no_read_back", "the timestamps didn't map"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::grown;

    /// Timestamps that read zero grow the trial sixteenfold each time; eight trials from 64
    /// loops pass the u32 maximum, where the count saturates instead of overflowing.
    #[test]
    fn zero_ticks_saturate_the_loop_count() {
        let mut loops = 64u32;
        for _ in 0..8 {
            loops = grown(loops, 0.0, 50e6);
        }
        assert_eq!(loops, u32::MAX);
    }
}
