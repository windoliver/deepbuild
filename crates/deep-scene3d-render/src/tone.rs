//! The look's tone map run alone (moved out of lib.rs whole, #3292).

use super::*;

/// The look's tone map alone (#418's `tone` call), as the output pass runs it, over `input` (f32
/// RGBA, rows top-down, `size` px) on `device`, with no exposure and no encode; the output in the
/// same layout, or `None` on a backend with no pixels.
pub fn tone(
    device: &Device,
    map: ToneMap,
    grade: &deep_canvas_marks::finish::Grade,
    input: &[f32],
    size: [u32; 2],
) -> Option<Vec<u8>> {
    let d = &device.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("scene3d tone"),
        source: wgpu::ShaderSource::Wgsl(OUTPUT.into()),
    });
    let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("scene3d tone"),
        entries: &[
            texture_entry(),
            buffer_entry(
                1,
                wgpu::ShaderStages::FRAGMENT,
                wgpu::BufferBindingType::Uniform,
            ),
        ],
    });
    let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("scene3d tone"),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let format = wgpu::TextureFormat::Rgba32Float;
    let pipe = pipeline(
        d,
        "scene3d.tone",
        Some(&pipeline_layout),
        &module,
        ("out_vs", &[]),
        Some(("tone_fs", &[target(format, None)])),
        None,
    );
    let source = texture2d(
        d,
        "scene3d tone input",
        size,
        format,
        wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
    );
    let bytes: Vec<u8> = input.iter().flat_map(|v| v.to_le_bytes()).collect();
    write_texture(&device.queue, &source, 0, &bytes, size[0] * 16, size);
    let out = texture2d(
        d,
        "scene3d tone output",
        size,
        format,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    let (code, white, contrast) = match map {
        ToneMap::Agx { white, contrast } => (2, white, contrast),
        other => (other.code(), 16.29, 1.25),
    };
    // #464: the grade inside the pass, as the output runs it: the white balance before the curve
    // and the CDL after it.
    let [wb0, wb1, wb2] = grade
        .white_balance()
        .map(|r| [r[0] as f32, r[1] as f32, r[2] as f32, 0.0]);
    let uniform = ToneUniform {
        exposure: 1.0,
        map: code,
        white: white as f32,
        contrast: contrast as f32,
        encode: 0,
        deband: 0.0,
        saturation: grade.saturation as f32,
        graded: u32::from(!grade.is_identity()),
        top: 1.0,
        late: 0,
        _pad: [0; 2],
        wb0,
        wb1,
        wb2,
        slope: rgb4(grade.slope),
        offset: rgb4(grade.offset),
        power: rgb4(grade.power),
    };
    let buffer = d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d tone"),
        size: std::mem::size_of::<ToneUniform>() as u64,
        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    device
        .queue
        .write_buffer(&buffer, 0, bytemuck::bytes_of(&uniform));
    let view = source.create_view(&Default::default());
    let bind = bind_group(
        d,
        "scene3d tone",
        &layout,
        [
            wgpu::BindingResource::TextureView(&view),
            buffer.as_entire_binding(),
        ],
    );
    let mut encoder = d.create_command_encoder(&Default::default());
    full_pass(
        &mut encoder,
        "scene3d.tone",
        &out.create_view(&Default::default()),
        wgpu::LoadOp::Clear(wgpu::Color::BLACK),
        &pipe,
        &bind,
        None,
    );
    device.queue.submit([encoder.finish()]);
    read_texture(device, &out, size, 16)
}
