use deep_gpu::device::Device;

pub struct Out {
    pub size: [u32; 2],
    pub channels: usize,
    pub codes: Vec<f64>,
}

impl Out {
    pub fn from_unit(size: [u32; 2], channels: usize, values: &[f64]) -> Out {
        Out {
            size,
            channels,
            codes: values.iter().map(|v| v * 255.0).collect(),
        }
    }

    pub fn from_bytes(size: [u32; 2], channels: usize, bytes: &[u8]) -> Out {
        Out {
            size,
            channels,
            codes: bytes.iter().map(|&b| f64::from(b)).collect(),
        }
    }

    pub fn from_codes(size: [u32; 2], channels: usize, codes: Vec<f64>) -> Out {
        Out {
            size,
            channels,
            codes,
        }
    }
}

pub fn halves(bytes: &[u8]) -> Vec<f64> {
    bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|h| {
            f64::from(deep_effects_render::reference::f16_to_f32(
                u16::from_le_bytes(*h),
            ))
        })
        .collect()
}

pub fn floats(bytes: &[u8]) -> Vec<f64> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|f| f64::from(f32::from_le_bytes(*f)))
        .collect()
}

pub fn words(bytes: &[u8]) -> Vec<u32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|f| u32::from_le_bytes(*f))
        .collect()
}

pub fn bytes_of_f32(values: &[f32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub fn bytes_of_u32(values: &[u32]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

pub fn texture(
    device: &Device,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    usage: wgpu::TextureUsages,
) -> wgpu::Texture {
    device.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("pass fixture"),
        size: wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage,
        view_formats: &[],
    })
}

pub fn target(device: &Device, size: [u32; 2], format: wgpu::TextureFormat) -> wgpu::Texture {
    texture(
        device,
        size,
        format,
        wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::TEXTURE_BINDING,
    )
}

pub fn input(
    device: &Device,
    size: [u32; 2],
    format: wgpu::TextureFormat,
    bytes: &[u8],
) -> wgpu::Texture {
    device.device.create_texture_with_data(
        &device.queue,
        &wgpu::TextureDescriptor {
            label: Some("pass fixture input"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        },
        wgpu::util::TextureDataOrder::LayerMajor,
        bytes,
    )
}

pub fn buffer(device: &Device, bytes: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
    let mut padded = bytes.to_vec();
    padded.resize(bytes.len().max(16).div_ceil(16) * 16, 0);
    device
        .device
        .create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("pass fixture buffer"),
            contents: &padded,
            usage: usage | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
        })
}

pub fn uniform(device: &Device, bytes: &[u8]) -> wgpu::Buffer {
    buffer(device, bytes, wgpu::BufferUsages::UNIFORM)
}

pub fn storage(device: &Device, bytes: &[u8]) -> wgpu::Buffer {
    buffer(device, bytes, wgpu::BufferUsages::STORAGE)
}

pub fn read_texture(device: &Device, tex: &wgpu::Texture, texel: u32) -> Vec<u8> {
    deep_effects_render::reference::read(device, tex, wgpu::TextureAspect::All, texel)
}

pub fn read_depth(device: &Device, tex: &wgpu::Texture) -> Vec<u8> {
    deep_effects_render::reference::read(device, tex, wgpu::TextureAspect::DepthOnly, 4)
}

pub fn read_buffer(device: &Device, buf: &wgpu::Buffer) -> Vec<u8> {
    let staging = device.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("pass fixture readback"),
        size: buf.size(),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut enc = device.device.create_command_encoder(&Default::default());
    enc.copy_buffer_to_buffer(buf, 0, &staging, 0, buf.size());
    device.queue.submit([enc.finish()]);
    let slice = staging.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
    let bytes = slice.get_mapped_range().expect("mapped").to_vec();
    staging.unmap();
    bytes
}

pub fn module(device: &Device, source: &str) -> Result<wgpu::ShaderModule, String> {
    let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
    let m = device
        .device
        .create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("pass fixture"),
            source: wgpu::ShaderSource::Wgsl(source.into()),
        });
    match crate::effects::pollster_block(scope.pop()) {
        Some(e) => Err(format!("the pass doesn't compile: {e}")),
        None => Ok(m),
    }
}

pub fn bind(
    device: &Device,
    layout: &wgpu::BindGroupLayout,
    entries: &[(u32, wgpu::BindingResource<'_>)],
) -> wgpu::BindGroup {
    let entries: Vec<wgpu::BindGroupEntry> = entries
        .iter()
        .map(|(binding, resource)| wgpu::BindGroupEntry {
            binding: *binding,
            resource: resource.clone(),
        })
        .collect();
    device.device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("pass fixture"),
        layout,
        entries: &entries,
    })
}

pub struct Draw<'a> {
    pub source: &'a str,
    pub vs: &'a str,
    pub fs: &'a str,
    pub format: wgpu::TextureFormat,
    pub size: [u32; 2],
    pub vertices: u32,
    pub instances: u32,
    pub topology: wgpu::PrimitiveTopology,
    pub blend: Option<wgpu::BlendState>,
    pub groups: Vec<Vec<(u32, wgpu::BindingResource<'a>)>>,
    pub vertex_buffers: Vec<(wgpu::VertexBufferLayout<'a>, &'a wgpu::Buffer)>,
    pub clear: wgpu::Color,
}

impl<'a> Draw<'a> {
    pub fn full_screen(source: &'a str, vs: &'a str, fs: &'a str, size: [u32; 2]) -> Draw<'a> {
        Draw {
            source,
            vs,
            fs,
            format: wgpu::TextureFormat::Rgba8Unorm,
            size,
            vertices: 3,
            instances: 1,
            topology: wgpu::PrimitiveTopology::TriangleList,
            blend: None,
            groups: Vec::new(),
            vertex_buffers: Vec::new(),
            clear: wgpu::Color::TRANSPARENT,
        }
    }
}

pub fn draw(device: &Device, d: Draw<'_>) -> Result<wgpu::Texture, String> {
    let module = module(device, d.source)?;
    let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
    let layouts: Vec<Option<wgpu::VertexBufferLayout>> = d
        .vertex_buffers
        .iter()
        .map(|(l, _)| Some(l.clone()))
        .collect();
    let pipeline = device
        .device
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("pass fixture"),
            layout: None,
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some(d.vs),
                compilation_options: Default::default(),
                buffers: &layouts,
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some(d.fs),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: d.format,
                    blend: d.blend,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: wgpu::PrimitiveState {
                topology: d.topology,
                ..Default::default()
            },
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
    let groups: Vec<wgpu::BindGroup> = d
        .groups
        .iter()
        .enumerate()
        .map(|(k, entries)| bind(device, &pipeline.get_bind_group_layout(k as u32), entries))
        .collect();
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(format!("the pass's pipeline is refused: {e}"));
    }
    let out = target(device, d.size, d.format);
    let view = out.create_view(&Default::default());
    let mut enc = device.device.create_command_encoder(&Default::default());
    {
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("pass fixture"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(d.clear),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&pipeline);
        for (k, g) in groups.iter().enumerate() {
            pass.set_bind_group(k as u32, g, &[]);
        }
        for (slot, (_, buf)) in d.vertex_buffers.iter().enumerate() {
            pass.set_vertex_buffer(slot as u32, buf.slice(..));
        }
        pass.draw(0..d.vertices, 0..d.instances);
    }
    device.queue.submit([enc.finish()]);
    Ok(out)
}

pub fn dispatch(
    device: &Device,
    source: &str,
    entry: &str,
    groups: [u32; 3],
    bindings: Vec<Vec<(u32, wgpu::BindingResource<'_>)>>,
) -> Result<(), String> {
    let module = module(device, source)?;
    let scope = deep_gpu::device::push_scope(&device.device, wgpu::ErrorFilter::Validation);
    let pipeline = device
        .device
        .create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("pass fixture"),
            layout: None,
            module: &module,
            entry_point: Some(entry),
            compilation_options: Default::default(),
            cache: None,
        });
    let bound: Vec<wgpu::BindGroup> = bindings
        .iter()
        .enumerate()
        .map(|(k, entries)| bind(device, &pipeline.get_bind_group_layout(k as u32), entries))
        .collect();
    if let Some(e) = crate::effects::pollster_block(scope.pop()) {
        return Err(format!("the pass's pipeline is refused: {e}"));
    }
    let mut enc = device.device.create_command_encoder(&Default::default());
    {
        let mut pass = enc.begin_compute_pass(&Default::default());
        pass.set_pipeline(&pipeline);
        for (k, g) in bound.iter().enumerate() {
            pass.set_bind_group(k as u32, g, &[]);
        }
        pass.dispatch_workgroups(groups[0], groups[1], groups[2]);
    }
    device.queue.submit([enc.finish()]);
    Ok(())
}

pub fn twin(source: &str, wrong: bool, from: &str, to: &str) -> Result<String, String> {
    if !wrong {
        return Ok(source.to_string());
    }
    if !source.contains(from) {
        return Err(format!(
            "the planted twin's change no longer applies: {from:?} is gone"
        ));
    }
    Ok(source.replacen(from, to, 1))
}

pub fn literal(source: &str, name: &str) -> Result<String, String> {
    let at = source
        .find(&format!("{name}: &str ="))
        .ok_or_else(|| format!("{name} is not a string constant of its file"))?;
    let rest = source[at..]
        .split_once('=')
        .map(|(_, r)| r.trim_start())
        .unwrap_or("");
    if let Some(raw) = rest.strip_prefix('r') {
        let hashes = raw.len() - raw.trim_start_matches('#').len();
        let body = &raw[hashes + 1..];
        let close = format!("\"{}", "#".repeat(hashes));
        let end = body
            .find(&close)
            .ok_or_else(|| format!("{name}'s raw string never closes"))?;
        return Ok(body[..end].to_string());
    }
    let body = rest
        .strip_prefix('"')
        .ok_or_else(|| format!("{name} is not a string literal"))?;
    let mut out = String::new();
    let mut chars = body.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Ok(out),
            '\\' => match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('\n') => {
                    while chars.peek().is_some_and(|c| c.is_whitespace()) {
                        chars.next();
                    }
                }
                Some(other) => out.push(other),
                None => break,
            },
            other => out.push(other),
        }
    }
    Err(format!("{name}'s string never closes"))
}
