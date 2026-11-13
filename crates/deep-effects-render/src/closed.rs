//! The closed-form particle kernel on wgpu (#449; closed.wgsl): one compute pass per item that
//! writes its instance columns from its frame's uniform words and its bake's table words, both
//! laid out by `deep_canvas_effects::particles::pack`. It stands beside the shipped graph
//! `particles.sparks@1`, which keeps drawing items that use none of #449's fields.

use std::sync::mpsc;

use deep_canvas_effects::particles::pack::SLOTS;
use deep_gpu::device::Device;

const SOURCE: &str = include_str!("closed.wgsl");
/// Particles a workgroup writes.
const WORKGROUP: u32 = 64;
/// Floats per particle in the columns.
const FLOATS: u64 = 8;

/// The kernel's pipeline.
pub struct Closed {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
}

/// One item's frame on the kernel: its bind group and the buffers it holds.
pub struct Bound {
    pub bind: wgpu::BindGroup,
    _buffers: [wgpu::Buffer; 3],
    count: u32,
}

impl Closed {
    pub fn new(device: &Device) -> Closed {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("particles closed form"),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let pipeline = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("particles closed form"),
            layout: None,
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let layout = pipeline.get_bind_group_layout(0);
        Closed { pipeline, layout }
    }

    /// A bake's table words on the device, uploaded once per bake.
    pub fn tables(device: &Device, words: &[u32]) -> wgpu::Buffer {
        // A storage binding can't be empty: the table always holds its four leading words.
        let words = if words.is_empty() { &[0; 4][..] } else { words };
        let bytes: Vec<u8> = words.iter().flat_map(|x| x.to_le_bytes()).collect();
        device
            .device
            .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("particles closed form tables"),
                contents: &bytes,
                usage: wgpu::BufferUsages::STORAGE,
            })
    }

    /// Binds one frame of an item: `uniform` its frame's words, `tables` its bake's on the
    /// device, `now` the surface it follows as evaluated this frame, writing `count` particles'
    /// columns into `instances`.
    pub fn bind(
        &self,
        device: &Device,
        uniform: &[u32],
        tables: &wgpu::Buffer,
        now: &[f32],
        instances: &wgpu::Buffer,
        count: u32,
    ) -> Bound {
        let d = &device.device;
        debug_assert_eq!(uniform.len(), SLOTS * 4);
        let bytes: Vec<u8> = uniform.iter().flat_map(|x| x.to_le_bytes()).collect();
        let u = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("particles closed form uniform"),
            contents: &bytes,
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let now = if now.is_empty() { &[0.0; 4][..] } else { now };
        let now_bytes: Vec<u8> = now.iter().flat_map(|x| x.to_le_bytes()).collect();
        let n = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("particles closed form surface now"),
            contents: &now_bytes,
            usage: wgpu::BufferUsages::STORAGE,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("particles closed form"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: u.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: tables.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: instances.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: n.as_entire_binding(),
                },
            ],
        });
        Bound {
            bind,
            _buffers: [u, tables.clone(), n],
            count,
        }
    }

    /// Encodes the pass: one invocation per particle.
    pub fn dispatch(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        bound: &Bound,
        timestamps: Option<wgpu::ComputePassTimestampWrites<'_>>,
    ) {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("particles closed form"),
            timestamp_writes: timestamps,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bound.bind, &[]);
        pass.dispatch_workgroups(bound.count.div_ceil(WORKGROUP).max(1), 1, 1);
    }

    /// Runs the kernel once for `count` particles and reads its columns back: what the compute
    /// pass writes, as the test harness captures it.
    pub fn columns(
        &self,
        device: &Device,
        uniform: &[u32],
        tables: &[u32],
        now: &[f32],
        count: u32,
    ) -> Vec<f32> {
        let d = &device.device;
        let size = u64::from(count.max(1)) * FLOATS * 4;
        let out = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles closed form columns"),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let back = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("particles closed form read back"),
            size,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let tables = Self::tables(device, tables);
        let bound = self.bind(device, uniform, &tables, now, &out, count);
        let mut enc = d.create_command_encoder(&Default::default());
        self.dispatch(&mut enc, &bound, None);
        enc.copy_buffer_to_buffer(&out, 0, &back, 0, size);
        device.queue.submit([enc.finish()]);
        let (tx, rx) = mpsc::channel();
        back.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        if !matches!(rx.recv(), Ok(Ok(()))) {
            return Vec::new();
        }
        let floats = back
            .slice(..)
            .get_mapped_range()
            .map(|v| {
                v.as_chunks::<4>()
                    .0
                    .iter()
                    .map(|b| f32::from_le_bytes(*b))
                    .collect()
            })
            .unwrap_or_default();
        back.unmap();
        floats
    }
}
