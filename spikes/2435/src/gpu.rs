//! The device the probe asks of the pinned wgpu, and the few helpers every part shares.

use std::sync::{Arc, Mutex};

use wgpu::util::DeviceExt as _;

pub struct Gpu {
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub info: wgpu::AdapterInfo,
    /// Validation errors no scope caught, in order.
    pub uncaught: Arc<Mutex<Vec<String>>>,
}

/// The adapter's ray queries, or why there are none: the feature the probe needs and lacks.
pub enum Open {
    Ready(Gpu),
    Blocked { adapter: Option<wgpu::AdapterInfo>, missing: String },
}

pub const RAY_QUERY: &str = "EXPERIMENTAL_RAY_QUERY (wgpu ray queries)";

/// `masked` reads the adapter's feature table without ray queries, as an adapter that has none
/// reports it, so every part is BLOCKED by the same path a GPU without them takes.
pub fn open(masked: bool) -> Open {
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::METAL;
    let instance = wgpu::Instance::new(desc);
    let adapter = match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: false,
    })) {
        Ok(a) => a,
        Err(e) => return Open::Blocked { adapter: None, missing: format!("a Metal adapter ({e})") },
    };
    let info = adapter.get_info();
    let mut features = adapter.features();
    if masked {
        features.remove(wgpu::Features::EXPERIMENTAL_RAY_QUERY);
    }
    if !features.contains(wgpu::Features::EXPERIMENTAL_RAY_QUERY) {
        return Open::Blocked { adapter: Some(info), missing: RAY_QUERY.into() };
    }
    let timing = wgpu::Features::TIMESTAMP_QUERY | wgpu::Features::TIMESTAMP_QUERY_INSIDE_ENCODERS;
    let required = wgpu::Features::EXPERIMENTAL_RAY_QUERY | (features & timing);
    let (device, queue) = match pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
        label: Some("spike-2435"),
        required_features: required,
        required_limits: adapter.limits(),
        // SAFETY: ray queries are behind wgpu's experimental gate; the probe is what reads whether they hold.
        experimental_features: unsafe { wgpu::ExperimentalFeatures::enabled() },
        memory_hints: wgpu::MemoryHints::Performance,
        trace: wgpu::Trace::Off,
    })) {
        Ok(d) => d,
        Err(e) => return Open::Blocked { adapter: Some(info), missing: format!("{RAY_QUERY}: device refused ({e})") },
    };
    let uncaught = Arc::new(Mutex::new(Vec::new()));
    let sink = uncaught.clone();
    device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| sink.lock().unwrap().push(e.to_string())));
    Open::Ready(Gpu { device, queue, info, uncaught })
}

impl Gpu {
    pub fn has_timestamps(&self) -> bool {
        self.device.features().contains(wgpu::Features::TIMESTAMP_QUERY)
    }

    pub fn wait(&self) {
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
    }

    pub fn init(&self, label: &str, bytes: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
        self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor { label: Some(label), contents: bytes, usage })
    }

    pub fn storage(&self, label: &str, size: u64) -> wgpu::Buffer {
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }

    /// Copies `src` back after everything submitted so far, waiting for it.
    pub fn read(&self, src: &wgpu::Buffer) -> Vec<u8> {
        let size = src.size();
        let staging = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let mut enc = self.device.create_command_encoder(&Default::default());
        enc.copy_buffer_to_buffer(src, 0, &staging, 0, size);
        self.queue.submit([enc.finish()]);
        staging.map_async(wgpu::MapMode::Read, .., |_| {});
        self.wait();
        let bytes = staging.get_mapped_range(..).expect("mapped").to_vec();
        staging.unmap();
        bytes
    }

    pub fn read_u32(&self, src: &wgpu::Buffer) -> Vec<u32> {
        bytemuck::cast_slice(&self.read(src)).to_vec()
    }

    pub fn pipeline(&self, source: &str, entry: &str) -> wgpu::ComputePipeline {
        let (pipeline, err) = self.scoped(|| {
            let module = self.device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(entry),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            self.device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(entry),
                layout: None,
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        });
        // A shader the pinned layer refuses is the probe's own fault: it stops, and the runner reads INVALID.
        if let Some(e) = err {
            panic!("the probe's shader `{entry}` doesn't compile: {e}");
        }
        pipeline
    }

    pub fn bind(&self, pipeline: &wgpu::ComputePipeline, entries: &[(u32, wgpu::BindingResource<'_>)]) -> wgpu::BindGroup {
        let entries: Vec<wgpu::BindGroupEntry<'_>> =
            entries.iter().map(|(binding, resource)| wgpu::BindGroupEntry { binding: *binding, resource: resource.clone() }).collect();
        self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &pipeline.get_bind_group_layout(0),
            entries: &entries,
        })
    }

    /// Validation and internal error scopes around `f`: the error they caught, if any.
    pub fn scoped<T>(&self, f: impl FnOnce() -> T) -> (T, Option<String>) {
        let internal = self.device.push_error_scope(wgpu::ErrorFilter::Internal);
        let validation = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let out = f();
        let v = pollster::block_on(validation.pop());
        let i = pollster::block_on(internal.pop());
        (out, v.or(i).map(|e| e.to_string()))
    }
}

/// A triangle mesh ready for a bottom level: positions (x, y, z) and u32 indices.
pub struct Mesh {
    pub vertices: wgpu::Buffer,
    pub indices: wgpu::Buffer,
    pub size: wgpu::BlasTriangleGeometrySizeDescriptor,
}

pub fn mesh(gpu: &Gpu, positions: &[[f32; 3]], indices: &[u32], opaque: bool, extra: wgpu::BufferUsages) -> Mesh {
    Mesh {
        vertices: gpu.init("vertices", bytemuck::cast_slice(positions), wgpu::BufferUsages::BLAS_INPUT | extra),
        indices: gpu.init("indices", bytemuck::cast_slice(indices), wgpu::BufferUsages::BLAS_INPUT),
        size: wgpu::BlasTriangleGeometrySizeDescriptor {
            vertex_format: wgpu::VertexFormat::Float32x3,
            vertex_count: positions.len() as u32,
            index_format: Some(wgpu::IndexFormat::Uint32),
            index_count: Some(indices.len() as u32),
            flags: if opaque { wgpu::AccelerationStructureGeometryFlags::OPAQUE } else { wgpu::AccelerationStructureGeometryFlags::empty() },
        },
    }
}

pub fn blas(gpu: &Gpu, mesh: &Mesh, flags: wgpu::AccelerationStructureFlags, update: wgpu::AccelerationStructureUpdateMode) -> wgpu::Blas {
    gpu.device.create_blas(
        &wgpu::CreateBlasDescriptor { label: None, flags, update_mode: update },
        wgpu::BlasGeometrySizeDescriptors::Triangles { descriptors: vec![mesh.size.clone()] },
    )
}

pub fn build_entry<'a>(blas: &'a wgpu::Blas, mesh: &'a Mesh) -> wgpu::BlasBuildEntry<'a> {
    wgpu::BlasBuildEntry {
        blas,
        geometry: wgpu::BlasGeometries::TriangleGeometries(vec![wgpu::BlasTriangleGeometry {
            size: &mesh.size,
            vertex_buffer: &mesh.vertices,
            first_vertex: 0,
            vertex_stride: 12,
            index_buffer: Some(&mesh.indices),
            first_index: Some(0),
            transform_buffer: None,
            transform_buffer_offset: None,
        }]),
    }
}

pub fn tlas(gpu: &Gpu, max_instances: u32) -> wgpu::Tlas {
    gpu.device.create_tlas(&wgpu::CreateTlasDescriptor {
        label: None,
        max_instances,
        flags: wgpu::AccelerationStructureFlags::PREFER_FAST_TRACE,
        update_mode: wgpu::AccelerationStructureUpdateMode::Build,
    })
}

pub const IDENTITY: [f32; 12] = [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0];

pub fn instance(blas: &wgpu::Blas, custom: u32) -> Option<wgpu::TlasInstance> {
    Some(wgpu::TlasInstance::new(blas, IDENTITY, custom, 0xff))
}

pub fn dispatch(enc: &mut wgpu::CommandEncoder, pipeline: &wgpu::ComputePipeline, group: &wgpu::BindGroup, x: u32) {
    let mut pass = enc.begin_compute_pass(&Default::default());
    pass.set_pipeline(pipeline);
    pass.set_bind_group(0, group, &[]);
    pass.dispatch_workgroups(x, 1, 1);
}

/// A seeded generator (splitmix64), so every run draws the same rays.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in [0, 1), 53 bits.
    pub fn unit(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }
}

pub fn hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
