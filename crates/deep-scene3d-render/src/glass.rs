//! Transmission (issue #428; canvas primitives: Material): a copy of the opaque scene with mips,
//! taken after the geometry pass, that a transmissive part samples through its thickness at a
//! level its roughness sets. Each mip is the 2 × 2 box mean of the one above it, its last row or
//! column clamped where the size is odd, so a CPU reference can rebuild the chain exactly. Made
//! only while a scene holds a transmissive part, at the linear target's size.

use crate::{bind_group, extent, pipeline, target, texture_entry, LINEAR};

const SHADER: &str = "
@group(0) @binding(0) var above: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let last = vec2<i32>(textureDimensions(above)) - 1;
    let p = vec2<i32>(pos.xy) * 2;
    var c = vec4<f32>(0.0);
    for (var k = 0; k < 4; k++) {
        c += textureLoad(above, min(p + vec2<i32>(k & 1, k >> 1), last), 0);
    }
    return c * 0.25;
}
";

/// The pass's name in a frame's timings.
pub const PASS: &str = "scene3d.glass";

#[derive(Clone)]
pub struct Glass {
    pub size: [u32; 2],
    pub texture: wgpu::Texture,
    /// Every mip, which the solids sample.
    pub view: wgpu::TextureView,
    levels: Vec<wgpu::TextureView>,
    binds: Vec<wgpu::BindGroup>,
    pipeline: wgpu::RenderPipeline,
}

/// The mip pass's layout and pipeline, made once and kept while the scene has no glass, so a part
/// that turns transmissive later compiles nothing (#432).
#[derive(Clone)]
pub struct Kit {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
}

impl Kit {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Kit {
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(PASS),
            entries: &[texture_entry()],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(PASS),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = pipeline(
            d,
            PASS,
            Some(&pipeline_layout),
            &module,
            ("vs", &[]),
            Some(("fs", &[target(LINEAR, None)])),
            None,
        );
        Kit { layout, pipeline }
    }
}

/// The mips a texture of `size` has, down to 1 × 1.
pub fn levels(size: [u32; 2]) -> u32 {
    32 - size[0].max(size[1]).max(1).leading_zeros()
}

impl Glass {
    pub fn new(d: &deep_gpu::counted::Wgpu, size: [u32; 2], kit: &Kit) -> Glass {
        let count = levels(size);
        let texture = d.create_texture(&wgpu::TextureDescriptor {
            label: Some(PASS),
            size: extent(size),
            mip_level_count: count,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: LINEAR,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::COPY_DST
                // Read back with its mips by view3d's `backdrop` target (#431).
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let levels: Vec<wgpu::TextureView> = (0..count)
            .map(|m| {
                texture.create_view(&wgpu::TextureViewDescriptor {
                    base_mip_level: m,
                    mip_level_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let layout = &kit.layout;
        let binds = levels
            .iter()
            .map(|v| bind_group(d, PASS, layout, [wgpu::BindingResource::TextureView(v)]))
            .collect();
        let pipeline = kit.pipeline.clone();
        Glass {
            size,
            view: texture.create_view(&Default::default()),
            texture,
            levels,
            binds,
            pipeline,
        }
    }

    /// Copies `linear` into mip 0 and makes every mip below it.
    pub fn record(&self, encoder: &mut wgpu::CommandEncoder, linear: &wgpu::Texture) {
        encoder.copy_texture_to_texture(
            linear.as_image_copy(),
            self.texture.as_image_copy(),
            extent(self.size),
        );
        for m in 1..self.levels.len() {
            crate::full_pass(
                encoder,
                PASS,
                &self.levels[m],
                wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                &self.pipeline,
                &self.binds[m - 1],
                None,
            );
        }
    }
}
