use deep_effects_render::reference::DEPTH_WGSL;
use deep_gpu::device::Device;

use super::gpu::{self, Out};
use super::Ran;

const SIZE: [u32; 2] = [4, 4];

fn depth_at(x: u32, y: u32) -> f32 {
    (x + 4 * y) as f32 / 15.0
}

fn depths() -> Vec<f32> {
    (0..SIZE[1])
        .flat_map(|y| (0..SIZE[0]).map(move |x| depth_at(x, y)))
        .collect()
}

pub fn run(device: &Device, twin: bool) -> Result<Ran, String> {
    let source = gpu::twin(DEPTH_WGSL, twin, "vec2<i32>(pos.xy)", "vec2<i32>(pos.yx)")?;
    let src = gpu::input(
        device,
        SIZE,
        wgpu::TextureFormat::R32Float,
        &gpu::bytes_of_f32(&depths()),
    );
    let dst = gpu::texture(
        device,
        SIZE,
        wgpu::TextureFormat::Depth32Float,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    let module = gpu::module(device, &source)?;
    let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
    let pipeline = device
        .device
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("pass fixture depth upload"),
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
                targets: &[],
            }),
            primitive: Default::default(),
            depth_stencil: Some(wgpu::DepthStencilState {
                format: wgpu::TextureFormat::Depth32Float,
                depth_write_enabled: Some(true),
                depth_compare: Some(wgpu::CompareFunction::Always),
                stencil: Default::default(),
                bias: Default::default(),
            }),
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
    let view = src.create_view(&Default::default());
    let bind = gpu::bind(
        device,
        &pipeline.get_bind_group_layout(0),
        &[(0, wgpu::BindingResource::TextureView(&view))],
    );
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(format!("the pass's pipeline is refused: {e}"));
    }
    let mut enc = device.device.create_command_encoder(&Default::default());
    {
        let target = dst.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("pass fixture depth upload"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &target,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(0.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
    device.queue.submit([enc.finish()]);
    let cpu: Vec<f64> = depths()
        .into_iter()
        .map(|d| f64::from(d).clamp(0.0, 1.0))
        .collect();
    Ok(Ran {
        gpu: Out::from_unit(SIZE, 1, &gpu::floats(&gpu::read_depth(device, &dst))),
        cpu: Out::from_unit(SIZE, 1, &cpu),
    })
}
