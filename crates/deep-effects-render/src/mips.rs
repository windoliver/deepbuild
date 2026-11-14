//! The core's mip step (issue #483; canvas primitives: Operator output): a compute texture output
//! with `mips: true` gets its whole chain after its operator's dispatch, each level a 2 × 2 box of
//! the one above, recorded with the output, so it is made again exactly when the output is.

/// Levels of a full chain for `size`.
pub fn levels([w, h]: [u32; 2]) -> u32 {
    32 - w.max(h).max(1).leading_zeros()
}

/// The mip pipelines, one per format that may carry mips (rgba8unorm and rgba16float).
pub struct Mips {
    rgba8: wgpu::ComputePipeline,
    rgba16f: wgpu::ComputePipeline,
}

/// A texture's chain, bound once: one dispatch per level below the first.
pub struct Chain {
    steps: Vec<(wgpu::ComputePipeline, wgpu::BindGroup, [u32; 2])>,
}

impl Mips {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Mips {
        let pipe = |format: &str| {
            let source = include_str!("mips.wgsl").replace("FORMAT", format);
            let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("mips"),
                source: wgpu::ShaderSource::Wgsl(source.into()),
            });
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some("mips"),
                layout: None,
                module: &module,
                entry_point: Some("main"),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        Mips {
            rgba8: pipe("rgba8unorm"),
            rgba16f: pipe("rgba16float"),
        }
    }

    /// The chain of `tex`, whose levels must have STORAGE_BINDING and TEXTURE_BINDING usage.
    pub fn chain(&self, d: &deep_gpu::counted::Wgpu, tex: &wgpu::Texture) -> Chain {
        let pipeline = match tex.format() {
            wgpu::TextureFormat::Rgba16Float => &self.rgba16f,
            _ => &self.rgba8,
        };
        let view = |level: u32| {
            tex.create_view(&wgpu::TextureViewDescriptor {
                base_mip_level: level,
                mip_level_count: Some(1),
                ..Default::default()
            })
        };
        let steps = (1..tex.mip_level_count())
            .map(|level| {
                let group = d.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("mip level"),
                    layout: &pipeline.get_bind_group_layout(0),
                    entries: &[
                        wgpu::BindGroupEntry {
                            binding: 0,
                            resource: wgpu::BindingResource::TextureView(&view(level - 1)),
                        },
                        wgpu::BindGroupEntry {
                            binding: 1,
                            resource: wgpu::BindingResource::TextureView(&view(level)),
                        },
                    ],
                });
                let size = [
                    (tex.width() >> level).max(1),
                    (tex.height() >> level).max(1),
                ];
                (pipeline.clone(), group, size)
            })
            .collect();
        Chain { steps }
    }
}

impl Chain {
    /// Records each level from the one above, in order.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("mips"),
            timestamp_writes: None,
        });
        for (pipeline, group, size) in &self.steps {
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, group, &[]);
            pass.dispatch_workgroups(size[0].div_ceil(8), size[1].div_ceil(8), 1);
        }
    }
}

/// The fill pipelines: every texel of a compute texture output set to one value (its clear value
/// each frame, or the pool's marker under the test hook), per format and dimension.
pub struct Fills {
    pipes: std::collections::BTreeMap<(String, bool), wgpu::ComputePipeline>,
}

/// One texture's fill, bound once: recorded each frame.
pub struct Fill {
    pipeline: wgpu::ComputePipeline,
    group: wgpu::BindGroup,
    groups: [u32; 3],
    _keep: wgpu::Buffer,
}

impl Fills {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Fills {
        let mut pipes = std::collections::BTreeMap::new();
        for format in ["r32uint", "r32float", "rgba16float", "rgba8unorm"] {
            for dim3 in [false, true] {
                let value = match format {
                    "r32uint" => "vec4<u32>(fill.v)",
                    _ => "fill.v",
                };
                let source = include_str!("fill.wgsl")
                    .replace("FORMAT", format)
                    .replace("DIM", if dim3 { "3d" } else { "2d" })
                    .replace("SWZ", if dim3 { "xyz" } else { "xy" })
                    .replace("VALUE", value);
                let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("fill"),
                    source: wgpu::ShaderSource::Wgsl(source.into()),
                });
                let p = d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                    label: Some("fill"),
                    layout: None,
                    module: &module,
                    entry_point: Some("main"),
                    compilation_options: Default::default(),
                    cache: None,
                });
                pipes.insert((format.to_string(), dim3), p);
            }
        }
        Fills { pipes }
    }

    /// The fill of level 0 of `tex` (a texture output of `format`) with `v`.
    pub fn fill(
        &self,
        d: &deep_gpu::counted::Wgpu,
        tex: &wgpu::Texture,
        format: &str,
        v: [f32; 4],
    ) -> Fill {
        let dim3 = tex.dimension() == wgpu::TextureDimension::D3;
        let pipeline = self.pipes[&(format.to_string(), dim3)].clone();
        let buf = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("fill value"),
            contents: &v.iter().flat_map(|x| x.to_le_bytes()).collect::<Vec<u8>>(),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let view = tex.create_view(&wgpu::TextureViewDescriptor {
            base_mip_level: 0,
            mip_level_count: Some(1),
            ..Default::default()
        });
        let group = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("fill"),
            layout: &pipeline.get_bind_group_layout(0),
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
            ],
        });
        let s = tex.size();
        Fill {
            pipeline,
            group,
            groups: [
                s.width.div_ceil(4),
                s.height.div_ceil(4),
                s.depth_or_array_layers.div_ceil(4),
            ],
            _keep: buf,
        }
    }
}

impl Fill {
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder) {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("fill"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.group, &[]);
        pass.dispatch_workgroups(self.groups[0], self.groups[1], self.groups[2]);
    }
}
