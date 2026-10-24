//! The kit's GPU backends, through wgpu (issue #138): wgpu's noop backend, which runs a case's
//! device work headless and returns no pixels, and the machine's GPU offscreen (Metal on the
//! reference Mac), which draws a frame's solid marks, each through the GPU pass its kind's module
//! registered or the core's own fill, and reads the pixels back.

use std::future::Future;
use std::pin::pin;
use std::task::{Context, Poll, Waker};

/// One solid quad: its bounds in px, its color as sRGB bytes, and the pass's WGSL (the core's
/// fill when empty).
pub struct Quad {
    pub bounds: [f64; 4],
    pub color: [u8; 4],
    pub shader: &'static str,
}

/// The core's fill: the vertex's color, as it is.
pub const FILL: &str = r"
struct In { @location(0) pos: vec2<f32>, @location(1) color: vec4<f32> };
struct Out { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs_main(v: In) -> Out { var o: Out; o.pos = vec4<f32>(v.pos, 0.0, 1.0); o.color = v.color; return o; }
@fragment fn fs_main(o: Out) -> @location(0) vec4<f32> { return o.color; }
";

/// Polls a future that a native backend completes at once.
fn ready<T>(f: impl Future<Output = T>) -> Option<T> {
    let mut f = pin!(f);
    let mut cx = Context::from_waker(Waker::noop());
    for _ in 0..1_000_000 {
        if let Poll::Ready(v) = f.as_mut().poll(&mut cx) {
            return Some(v);
        }
        std::thread::yield_now();
    }
    None
}

/// Whether wgpu's noop backend gives a device: the backend a headless case runs on.
pub fn noop_device() -> bool {
    let (device, _queue) = wgpu::Device::noop(&wgpu::DeviceDescriptor::default());
    drop(device);
    true
}

/// The GPU's adapter: its name and driver, for the environment digest; `None` with no GPU.
pub fn adapter_info() -> Option<(String, String)> {
    let adapter = adapter()?;
    let info = adapter.get_info();
    Some((
        info.name,
        format!("{} {}", info.driver, info.driver_info)
            .trim()
            .to_string(),
    ))
}

fn adapter() -> Option<wgpu::Adapter> {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::PRIMARY,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let options = wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        ..Default::default()
    };
    ready(instance.request_adapter(&options))?.ok()
}

/// Draws `quads` on the GPU over `ground`, offscreen at `size`, and reads the RGBA back.
pub fn draw(
    size: [u16; 2],
    ground: [u8; 3],
    frame: [f64; 2],
    quads: &[Quad],
) -> Result<Vec<u8>, String> {
    let adapter = adapter().ok_or("no GPU adapter")?;
    let (device, queue) = ready(adapter.request_device(&wgpu::DeviceDescriptor::default()))
        .ok_or("the device didn't come")?
        .map_err(|e| e.to_string())?;
    let (w, h) = (u32::from(size[0]), u32::from(size[1]));
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("kit frame"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    // Each quad as two triangles in clip space, a vertex `[x, y, r, g, b, a]`.
    let scale = (f64::from(w) / frame[0]).min(f64::from(h) / frame[1]);
    let mut groups: Vec<(&'static str, Vec<f32>)> = Vec::new();
    for q in quads {
        let [x, y, bw, bh] = q.bounds;
        let to = |px: f64, py: f64| {
            [
                (px * scale / f64::from(w) * 2.0 - 1.0) as f32,
                (1.0 - py * scale / f64::from(h) * 2.0) as f32,
            ]
        };
        let c = q.color.map(|v| f32::from(v) / 255.0);
        let corners = [to(x, y), to(x + bw, y), to(x + bw, y + bh), to(x, y + bh)];
        let shader = if q.shader.is_empty() { FILL } else { q.shader };
        let list = match groups.iter_mut().find(|(s, _)| std::ptr::eq(*s, shader)) {
            Some((_, l)) => l,
            None => {
                groups.push((shader, Vec::new()));
                &mut groups.last_mut().expect("pushed").1
            }
        };
        for k in [0, 1, 2, 0, 2, 3] {
            list.extend_from_slice(&corners[k]);
            list.extend_from_slice(&c);
        }
    }
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    let ground = ground.map(|v| f64::from(v) / 255.0);
    let mut buffers = Vec::new();
    let mut pipelines = Vec::new();
    for (shader, verts) in &groups {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("kit pass"),
            source: wgpu::ShaderSource::Wgsl((*shader).into()),
        });
        let layout = wgpu::VertexBufferLayout {
            array_stride: 24,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &wgpu::vertex_attr_array![0 => Float32x2, 1 => Float32x4],
        };
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("kit pass"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[Some(layout)],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let bytes: Vec<u8> = verts.iter().flat_map(|f| f.to_le_bytes()).collect();
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("kit quads"),
            size: bytes.len() as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        queue.write_buffer(&buffer, 0, &bytes);
        buffers.push((buffer, (verts.len() / 6) as u32));
        pipelines.push(pipeline);
    }
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("kit frame"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: ground[0],
                        g: ground[1],
                        b: ground[2],
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        for (pipeline, (buffer, count)) in pipelines.iter().zip(&buffers) {
            pass.set_pipeline(pipeline);
            pass.set_vertex_buffer(0, buffer.slice(..));
            pass.draw(0..*count, 0..1);
        }
    }
    let row = (w * 4).div_ceil(256) * 256;
    let out = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("kit readback"),
        size: u64::from(row * h),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &out,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(h),
            },
        },
        wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
    );
    queue.submit([encoder.finish()]);
    let slice = out.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|e| e.to_string())?;
    let data = slice.get_mapped_range().map_err(|e| e.to_string())?;
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let start = (y * row) as usize;
        rgba.extend_from_slice(&data[start..start + (w * 4) as usize]);
    }
    Ok(rgba)
}
