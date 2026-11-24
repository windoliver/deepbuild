//! #3171's second process that keeps the GPU busy (README.md beside this file): it draws full-screen passes that loop
//! over every pixel, each about `PASS_MS` of GPU time, two submissions at a time, back to back, until `seconds` (its
//! one argument) have passed or it is stopped. It sizes its passes from a timed pass first, then prints
//! `busy <ms>` once its first two passes are done, with the time they took, and nothing else on stdout; with no GPU it
//! prints `no GPU: <reason>` and exits 2. It is an example, so `cargo test` builds it and never runs it.
use std::io::Write;
use std::time::{Duration, Instant};

use deep_gpu::device::{Backend, Gpu};

/// Each pixel's loop count for one instance, and the target's side.
const LOOPS: u32 = 1024;
const SIDE: u32 = 4096;
/// About the GPU time each pass of the load takes: past the span test's 100 ms bound, so a span that waits for one
/// pass counts more than the bound allows.
const PASS_MS: f64 = 200.0;

const SPIN: &str = "
    @vertex fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
        return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    }
    @fragment fn spin(@builtin(position) p: vec4f) -> @location(0) vec4f {
        var x = fract(p.x * 0.001 + p.y * 0.002);
        for (var i = 0u; i < LOOPS; i++) { x = fract(x * 3.7 + 0.1234); }
        return vec4f(x, x, x, 1.0);
    }";

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .expect("one argument: how many seconds to keep the GPU busy");
    let opened = match Gpu::open(Backend::Gpu) {
        Ok(opened) => opened,
        Err(reason) => {
            println!("no GPU: {reason}");
            std::process::exit(2);
        }
    };
    let dev = opened.device();
    let d = &dev.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("3171 load"),
        source: wgpu::ShaderSource::Wgsl(SPIN.replace("LOOPS", &format!("{LOOPS}u")).into()),
    });
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("3171 load"),
        layout: None,
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
    let target = d.create_texture(&wgpu::TextureDescriptor {
        label: Some("3171 load"),
        size: wgpu::Extent3d {
            width: SIDE,
            height: SIDE,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = target.create_view(&Default::default());
    let pass = |instances: u32| {
        let mut encoder = d.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("3171 load"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            pass.set_pipeline(&pipeline);
            pass.draw(0..3, 0..instances);
        }
        encoder.finish()
    };
    let timed = |instances: u32| {
        let began = Instant::now();
        dev.queue.submit([pass(instances)]);
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        began.elapsed().as_secs_f64() * 1e3
    };
    // The first pass builds the pipeline; then instances double until a pass takes a quarter of PASS_MS, so a
    // submission's own cost is small beside it, and the load's passes are sized from that one.
    timed(1);
    let (mut n, mut took) = (1, timed(1));
    while took < PASS_MS / 4.0 && n < 4096 {
        n *= 2;
        took = timed(n);
    }
    let instances = (f64::from(n) * PASS_MS / took.max(0.1)).round().clamp(1.0, 16384.0) as u32;
    let end = Instant::now() + Duration::from_secs(seconds);
    let mut first = true;
    while Instant::now() < end {
        let began = Instant::now();
        dev.queue.submit([pass(instances)]);
        dev.queue.submit([pass(instances)]);
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        if first {
            first = false;
            println!("busy {:.1}", began.elapsed().as_secs_f64() * 1e3);
            let _ = std::io::stdout().flush();
        }
    }
}
