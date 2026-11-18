//! The player's GPU layer on WebGPU through wgpu (#172): the device it asks for is exactly the
//! bundle's `gpu_needs` (its features, and its limits laid over WebGPU's spec defaults), never the
//! adapter's own limits, so WebGPU's validation catches any use past them on every machine. Each
//! frame's pixels, sRGB-encoded RGBA, are uploaded and drawn onto the page's canvas, whose
//! format keeps them as they are: an sRGB canvas. Only the full set (#1490) carries the GPU layer
//! and scene3d's renderer, for its 3D frames.

#[cfg(feature = "full")]
use std::sync::Arc;

#[cfg(feature = "full")]
use deep_canvas_scene3d::look::Look3;
#[cfg(feature = "full")]
use deep_canvas_scene3d::scene::Scene;
use serde_json::Value;
use wasm_bindgen::prelude::*;

const BLIT: &str = r#"
@group(0) @binding(0) var frame: texture_2d<f32>;
@group(0) @binding(1) var pick: sampler;
struct Out { @builtin(position) at: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> Out {
  let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  var o: Out;
  o.at = vec4<f32>(uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0), 0.0, 1.0);
  o.uv = uv;
  return o;
}
@fragment fn fs(o: Out) -> @location(0) vec4<f32> { return textureSample(frame, pick, o.uv); }
"#;

fn fail(what: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&what.to_string())
}

/// The features `needs` lists by their WebGPU names, as wgpu's.
fn features(needs: &Value) -> wgpu::Features {
    let mut out = wgpu::Features::empty();
    for name in needs["features"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
    {
        out |= match name {
            "depth-clip-control" => wgpu::Features::DEPTH_CLIP_CONTROL,
            "depth32float-stencil8" => wgpu::Features::DEPTH32FLOAT_STENCIL8,
            "texture-compression-bc" => wgpu::Features::TEXTURE_COMPRESSION_BC,
            "texture-compression-etc2" => wgpu::Features::TEXTURE_COMPRESSION_ETC2,
            "texture-compression-astc" => wgpu::Features::TEXTURE_COMPRESSION_ASTC,
            "timestamp-query" => wgpu::Features::TIMESTAMP_QUERY,
            "indirect-first-instance" => wgpu::Features::INDIRECT_FIRST_INSTANCE,
            "shader-f16" => wgpu::Features::SHADER_F16,
            "rg11b10ufloat-renderable" => wgpu::Features::RG11B10UFLOAT_RENDERABLE,
            "bgra8unorm-storage" => wgpu::Features::BGRA8UNORM_STORAGE,
            "float32-filterable" => wgpu::Features::FLOAT32_FILTERABLE,
            _ => wgpu::Features::empty(),
        };
    }
    out
}

/// WebGPU's spec-default limits with the ones `needs` lists laid on, by their WebGPU names.
fn limits(needs: &Value) -> wgpu::Limits {
    let mut l = wgpu::Limits::defaults();
    for (name, v) in needs["limits"].as_object().into_iter().flatten() {
        let Some(n) = v.as_u64() else { continue };
        let n32 = u32::try_from(n).unwrap_or(u32::MAX);
        match name.as_str() {
            "maxTextureDimension1D" => l.max_texture_dimension_1d = n32,
            "maxTextureDimension2D" => l.max_texture_dimension_2d = n32,
            "maxTextureDimension3D" => l.max_texture_dimension_3d = n32,
            "maxTextureArrayLayers" => l.max_texture_array_layers = n32,
            "maxBindGroups" => l.max_bind_groups = n32,
            "maxBindGroupsPlusVertexBuffers" => l.max_bind_groups_plus_vertex_buffers = n32,
            "maxBindingsPerBindGroup" => l.max_bindings_per_bind_group = n32,
            "maxDynamicUniformBuffersPerPipelineLayout" => {
                l.max_dynamic_uniform_buffers_per_pipeline_layout = n32
            }
            "maxDynamicStorageBuffersPerPipelineLayout" => {
                l.max_dynamic_storage_buffers_per_pipeline_layout = n32
            }
            "maxSampledTexturesPerShaderStage" => l.max_sampled_textures_per_shader_stage = n32,
            "maxSamplersPerShaderStage" => l.max_samplers_per_shader_stage = n32,
            "maxStorageBuffersPerShaderStage" => l.max_storage_buffers_per_shader_stage = n32,
            "maxStorageTexturesPerShaderStage" => l.max_storage_textures_per_shader_stage = n32,
            "maxUniformBuffersPerShaderStage" => l.max_uniform_buffers_per_shader_stage = n32,
            "maxUniformBufferBindingSize" => l.max_uniform_buffer_binding_size = n,
            "maxStorageBufferBindingSize" => l.max_storage_buffer_binding_size = n,
            "minUniformBufferOffsetAlignment" => l.min_uniform_buffer_offset_alignment = n32,
            "minStorageBufferOffsetAlignment" => l.min_storage_buffer_offset_alignment = n32,
            "maxVertexBuffers" => l.max_vertex_buffers = n32,
            "maxBufferSize" => l.max_buffer_size = n,
            "maxVertexAttributes" => l.max_vertex_attributes = n32,
            "maxVertexBufferArrayStride" => l.max_vertex_buffer_array_stride = n32,
            "maxInterStageShaderVariables" => l.max_inter_stage_shader_variables = n32,
            "maxColorAttachments" => l.max_color_attachments = n32,
            "maxColorAttachmentBytesPerSample" => l.max_color_attachment_bytes_per_sample = n32,
            "maxComputeWorkgroupStorageSize" => l.max_compute_workgroup_storage_size = n32,
            "maxComputeInvocationsPerWorkgroup" => l.max_compute_invocations_per_workgroup = n32,
            "maxComputeWorkgroupSizeX" => l.max_compute_workgroup_size_x = n32,
            "maxComputeWorkgroupSizeY" => l.max_compute_workgroup_size_y = n32,
            "maxComputeWorkgroupSizeZ" => l.max_compute_workgroup_size_z = n32,
            "maxComputeWorkgroupsPerDimension" => l.max_compute_workgroups_per_dimension = n32,
            _ => {}
        }
    }
    l
}

/// The page's canvas on a WebGPU device.
#[wasm_bindgen]
pub struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    format: wgpu::TextureFormat,
    pipeline: wgpu::RenderPipeline,
    /// The same pipeline blending a straight-alpha picture over what the canvas holds: the 2D
    /// writer layers over a 3D frame.
    over: wgpu::RenderPipeline,
    /// The device as the 3D renderer draws on it, and the renderer, made on the first 3D frame.
    #[cfg(feature = "full")]
    deep: Arc<deep_gpu::device::Device>,
    #[cfg(feature = "full")]
    scene: Option<deep_scene3d_render::Renderer>,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    size: [u32; 2],
    backend: String,
    adapter: String,
}

/// A WebGPU device for `canvas` asking exactly `needs` (the bundle's `gpu_needs`, as JSON).
#[wasm_bindgen]
pub async fn open_gpu(canvas: web_sys::HtmlCanvasElement, needs: String) -> Result<Gpu, JsValue> {
    let needs: Value = serde_json::from_str(&needs).map_err(fail)?;
    let size = [canvas.width().max(1), canvas.height().max(1)];
    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::BROWSER_WEBGPU;
    let instance = wgpu::Instance::new(desc);
    let surface = instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
        .map_err(fail)?;
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            compatible_surface: Some(&surface),
            ..Default::default()
        })
        .await
        .map_err(|e| fail(format!("no WebGPU adapter: {e}")))?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("deep-player"),
            required_features: features(&needs),
            required_limits: limits(&needs),
            ..Default::default()
        })
        .await
        .map_err(|e| fail(format!("the adapter refuses the bundle's gpu_needs: {e}")))?;
    let caps = surface.get_capabilities(&adapter);
    let format = caps
        .formats
        .iter()
        .copied()
        .find(|f| {
            matches!(
                f,
                wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Rgba8Unorm
            )
        })
        .unwrap_or(wgpu::TextureFormat::Bgra8Unorm);
    surface.configure(
        &device,
        &wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size[0],
            height: size[1],
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: wgpu::CompositeAlphaMode::Opaque,
            view_formats: Vec::new(),
            desired_maximum_frame_latency: 2,
            color_space: wgpu::SurfaceColorSpace::Srgb,
        },
    );
    let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("blit"),
        source: wgpu::ShaderSource::Wgsl(BLIT.into()),
    });
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("blit"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                count: None,
            },
        ],
    });
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some("blit"),
        bind_group_layouts: &[Some(&layout)],
        immediate_size: 0,
    });
    let blit = |label: &'static str, blend: Option<wgpu::BlendState>| {
        device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(&pipeline_layout),
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
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        })
    };
    let over = blit("over", Some(wgpu::BlendState::ALPHA_BLENDING));
    let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("blit"),
        layout: Some(&pipeline_layout),
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
            targets: &[Some(format.into())],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        ..Default::default()
    });
    let info = adapter.get_info();
    #[cfg(feature = "full")]
    let deep = deep_gpu::device::Device::from_parts(
        device.clone(),
        queue.clone(),
        features(&needs),
        info.clone(),
    );
    let adapter_name = [
        info.name.clone(),
        info.driver.clone(),
        info.driver_info.clone(),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join(" ");
    Ok(Gpu {
        device,
        queue,
        surface,
        format,
        pipeline,
        over,
        #[cfg(feature = "full")]
        deep,
        #[cfg(feature = "full")]
        scene: None,
        layout,
        sampler,
        size,
        backend: format!("webgpu (wgpu {})", "30.0.1"),
        adapter: if adapter_name.is_empty() {
            "webgpu adapter".into()
        } else {
            adapter_name
        },
    })
}

#[wasm_bindgen]
impl Gpu {
    /// The backend it draws on, naming WebGPU.
    #[wasm_bindgen(getter)]
    pub fn backend(&self) -> String {
        self.backend.clone()
    }

    /// The adapter it draws on, as the browser names it.
    #[wasm_bindgen(getter)]
    pub fn adapter(&self) -> String {
        self.adapter.clone()
    }
}

impl Gpu {
    /// The canvas's size in pixels.
    pub fn size(&self) -> [u32; 2] {
        self.size
    }

    /// Draws `rgba` (sRGB-encoded, straight, rows top-down, `size` pixels) onto the canvas.
    pub fn show(&self, rgba: &[u8], size: [u32; 2]) -> bool {
        let Some(frame) = self.frame() else {
            return false;
        };
        let target = frame.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        self.picture(&mut encoder, &target, rgba, size, false);
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
        true
    }

    /// Draws `scene` in `look` onto the canvas with scene3d's renderer, as the app's 3D frames are
    /// drawn, and `over` (the 2D writer layers, straight RGBA with no ground) over it.
    #[cfg(feature = "full")]
    pub fn show3d(&mut self, scene: &Scene, look: &Look3, over: &[u8], size: [u32; 2]) -> bool {
        let Some(frame) = self.frame() else {
            return false;
        };
        let target = frame.texture.create_view(&Default::default());
        let deep = self.deep.clone();
        let renderer = self.scene.get_or_insert_with(|| {
            deep_scene3d_render::Renderer::new(&deep, deep_scene3d_render::Planted::default())
        });
        renderer.prepare(&deep, scene, look);
        let mut encoder = self.device.create_command_encoder(&Default::default());
        for (_, job) in renderer.jobs(&deep, &target, None, None) {
            job(&mut encoder);
        }
        self.picture(&mut encoder, &target, over, size, true);
        self.queue.submit([encoder.finish()]);
        self.queue.present(frame);
        true
    }

    fn frame(&self) -> Option<wgpu::SurfaceTexture> {
        match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(f)
            | wgpu::CurrentSurfaceTexture::Suboptimal(f) => Some(f),
            _ => None,
        }
    }

    /// Encodes `rgba` drawn onto `target`: in place of what it holds, or blended over it.
    fn picture(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        rgba: &[u8],
        size: [u32; 2],
        blend: bool,
    ) {
        let extent = wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        };
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("frame"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        self.queue.write_texture(
            texture.as_image_copy(),
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * size[0]),
                rows_per_image: Some(size[1]),
            },
            extent,
        );
        let view = texture.create_view(&Default::default());
        let group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("frame"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.sampler),
                },
            ],
        });
        let load = if blend {
            wgpu::LoadOp::Load
        } else {
            wgpu::LoadOp::Clear(wgpu::Color::BLACK)
        };
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("show"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(if blend { &self.over } else { &self.pipeline });
        pass.set_bind_group(0, &group, &[]);
        pass.draw(0..3, 0..1);
        let _ = self.format;
    }
}
