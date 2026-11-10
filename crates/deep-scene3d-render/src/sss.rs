//! Subsurface (issue #481; canvas primitives: Material: subsurface): a part's lobe takes its
//! weight's share of the lit diffuse. The share pass draws the subsurface parts again after the
//! resolve (scene3d.wgsl: `sss_fs`), at the geometry's sample count and tested equal against its
//! depth, so each sample a part shows holds its share, and resolves; this module's spread pass
//! spreads it over the part's own pixels by Christensen and Burley's diffusion profile and adds
//! it back into the linear target, times the exit factor of the samples it covers. The spread
//! takes 16 fixed taps at the medians of 16 equal shares of the widest channel's radial profile,
//! turned by a hash of the pixel and scaled by the pixel's size on the surface; each channel
//! weighs a tap by its own profile's share of that tap's ring, so a narrower channel spreads less.
//! Only taps on the same part count, and the weights are normalized over those, so the lobe never
//! reflects more than it receives and never spreads onto another part. Nothing carries between
//! frames: seeking equals playing. Made only while a scene holds a subsurface part.

use crate::{
    bind_group, buffer_entry, culled, multisampled, texture2d, Profiler, DEPTH, IDS_MS, LINEAR,
};

/// The pass names in a frame's timings.
pub const SHARE_PASS: &str = "scene3d.subsurface_share";
pub const SPREAD_PASS: &str = "scene3d.subsurface_spread";

/// The share pass's targets, each summed over the samples a subsurface surface covers ÷ the sample
/// count: the share over the exit factor, and 1; ℓ ÷ s per channel in mm, and the exit factor; the
/// pixel's size on the surface in mm.
const SHARE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const PROFILE: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
const SIZE: wgpu::TextureFormat = wgpu::TextureFormat::Rg16Float;

/// The taps.
const TAPS: usize = 16;

const SHADER: &str = "
struct Spread {
    // x: 1 for the planted pass that takes every tap; y: its scale in mm and z its pixel's size
    // in mm, where a pixel holds no subsurface part.
    opts: vec4<f32>,
    // The taps' radii and the edges of their rings (the last one past everything), in units of
    // the widest channel's ℓ ÷ s.
    radii: array<vec4<f32>, 4>,
    edges: array<vec4<f32>, 5>,
};

@group(0) @binding(0) var share_t: texture_2d<f32>;
@group(0) @binding(1) var profile_t: texture_2d<f32>;
@group(0) @binding(2) var size_t: texture_2d<f32>;
// The resolved object IDs, and the multisampled ones as two halves (a 1 × 1 stand-in at one
// sample).
@group(0) @binding(3) var ids_t: texture_2d<u32>;
@group(0) @binding(4) var ids_ms: texture_multisampled_2d<u32>;
@group(0) @binding(5) var<uniform> u: Spread;

const GOLDEN: f32 = 2.39996323;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

// The profile's radial share within x = s·r ÷ ℓ: 1 − e^(−x) ÷ 4 − 3e^(−x/3) ÷ 4.
fn cdf(x: vec3<f32>) -> vec3<f32> {
    return 1.0 - 0.25 * exp(-x) - 0.75 * exp(-x / 3.0);
}

fn at(a: array<vec4<f32>, 5>, i: u32) -> f32 {
    return a[i / 4u][i % 4u];
}

// Jarkko and Olano's PCG hash.
fn pcg(v: u32) -> u32 {
    let s = v * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}

// The pixel's turn, from its coordinates alone.
fn turn(p: vec2<i32>) -> f32 {
    let h = pcg(bitcast<u32>(p.x) + pcg(bitcast<u32>(p.y)));
    return f32(h >> 8u) / 16777216.0 * 6.28318531;
}

// The share of the pixel's samples part `id` covers.
fn cover(p: vec2<i32>, id: u32) -> f32 {
    if textureDimensions(ids_ms).x <= 1u {
        return 1.0;
    }
    let n = textureNumSamples(ids_ms);
    var hits = 0u;
    for (var i = 0u; i < n; i++) {
        let s = textureLoad(ids_ms, p, i32(i)).xy;
        hits += select(0u, 1u, (s.x | (s.y << 16u)) == id);
    }
    return f32(hits) / f32(n);
}

// The mean share over the exit factor at `q`, over the samples its subsurface surfaces cover.
fn share_at(q: vec2<i32>) -> vec3<f32> {
    let s = textureLoad(share_t, q, 0);
    return s.rgb / max(s.a, 1e-6);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let p = vec2<i32>(pos.xy);
    let dims = vec2<i32>(textureDimensions(share_t));
    let id = textureLoad(ids_t, p, 0).r;
    // The share of the pixel's samples a subsurface surface covers, and their exit factor's sum.
    let covered = textureLoad(share_t, p, 0).a;
    let profile = textureLoad(profile_t, p, 0);
    let across = u.opts.x > 0.5;
    var d = profile.rgb / max(covered, 1e-6);
    var size = textureLoad(size_t, p, 0).rg / max(covered, 1e-6);
    var gain = profile.a;
    if covered <= 0.0 {
        if !across {
            discard;
        }
        d = vec3<f32>(u.opts.y);
        size = vec2<f32>(u.opts.z);
        gain = 1.0;
    } else if !across && covered + 1e-3 < cover(p, id) {
        // The resolved part isn't the subsurface one here: its share stays where it is.
        return vec4<f32>(share_at(p) * gain, 0.0);
    }
    let wide = max(d.r, max(d.g, d.b));
    let edges = u.edges;
    let a0 = turn(p);
    var sum = vec3<f32>(0.0);
    var weight = vec3<f32>(0.0);
    for (var i = 0u; i < 16u; i++) {
        let r = u.radii[i / 4u][i % 4u] * wide;
        let a = a0 + f32(i) * GOLDEN;
        let q = vec2<i32>(floor(pos.xy + vec2<f32>(cos(a), sin(a)) * r / max(size, vec2<f32>(1e-6))));
        if any(q < vec2<i32>(0)) || any(q >= dims) {
            continue;
        }
        if !across && (textureLoad(ids_t, q, 0).r != id || textureLoad(share_t, q, 0).a <= 0.0) {
            continue;
        }
        let w = cdf(at(edges, i + 1u) * wide / d) - cdf(at(edges, i) * wide / d);
        sum += w * share_at(q);
        weight += w;
    }
    if all(weight <= vec3<f32>(0.0)) {
        return vec4<f32>(share_at(p) * gain, 0.0);
    }
    return vec4<f32>(sum / max(weight, vec3<f32>(1e-12)) * gain, 0.0);
}
";

/// The profile's radial share within x = s·r ÷ ℓ.
fn cdf(x: f64) -> f64 {
    1.0 - 0.25 * (-x).exp() - 0.75 * (-x / 3.0).exp()
}

/// The x at which the radial share reaches `u`, by bisection.
fn quantile(u: f64) -> f64 {
    let (mut lo, mut hi) = (0.0, 200.0);
    for _ in 0..200 {
        let mid = 0.5 * (lo + hi);
        if cdf(mid) < u {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    0.5 * (lo + hi)
}

/// The taps' radii, the medians of 16 equal shares, and the 17 edges of their rings, the last
/// one past every tail.
fn taps() -> ([f32; TAPS], [f32; TAPS + 4]) {
    let n = TAPS as f64;
    let radii = std::array::from_fn(|i| quantile((i as f64 + 0.5) / n) as f32);
    let edges = std::array::from_fn(|i| match i {
        0 => 0.0,
        i if i < TAPS => quantile(i as f64 / n) as f32,
        _ => 1e30,
    });
    (radii, edges)
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct SpreadUniform {
    opts: [f32; 4],
    radii: [f32; TAPS],
    edges: [f32; TAPS + 4],
}

/// One share-pass draw: a solid set's mesh, its records and their count, its maps' bind group.
/// A share draw: its mesh, its records, and its group 3; a part with a material operator draws
/// through that operator's share pipeline (#486).
pub(crate) type ShareDraw = (
    wgpu::Buffer,
    wgpu::Buffer,
    u32,
    wgpu::Buffer,
    u32,
    wgpu::BindGroup,
    Option<wgpu::RenderPipeline>,
);

/// The share pass's pipeline with `fs` as its fragment stage: `sss_fs`, or a material operator's
/// `op_sss_fs` (#486).
pub(crate) fn share_pipeline(
    d: &deep_gpu::counted::Wgpu,
    samples: u32,
    layout: &wgpu::PipelineLayout,
    module: &wgpu::ShaderModule,
    fs: &str,
) -> wgpu::RenderPipeline {
    let buffers = crate::mesh_buffers();
    culled(
        d,
        samples,
        SHARE_PASS,
        Some(layout),
        module,
        ("mesh_vs", &buffers),
        Some((
            fs,
            &[
                crate::target(SHARE, None),
                crate::target(PROFILE, None),
                crate::target(SIZE, None),
            ],
        )),
        Some(wgpu::DepthStencilState {
            format: DEPTH,
            depth_write_enabled: Some(false),
            depth_compare: Some(wgpu::CompareFunction::Equal),
            stencil: Default::default(),
            bias: Default::default(),
        }),
        None,
    )
}

/// A share-pass target: drawn at the geometry's sample count into `drawn`, resolved into
/// `resolved` (one view for both at one sample).
#[derive(Clone)]
struct Target {
    drawn: wgpu::TextureView,
    resolved: Option<wgpu::TextureView>,
}

impl Target {
    fn new(
        d: &deep_gpu::counted::Wgpu,
        size: [u32; 2],
        samples: u32,
        format: wgpu::TextureFormat,
    ) -> (Target, wgpu::TextureView) {
        let read = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let one = texture2d(d, SHARE_PASS, size, format, read).create_view(&Default::default());
        let target = if samples > 1 {
            let transient =
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TRANSIENT_ATTACHMENT;
            Target {
                drawn: multisampled(d, samples, SHARE_PASS, size, format, transient)
                    .create_view(&Default::default()),
                resolved: Some(one.clone()),
            }
        } else {
            Target {
                drawn: one.clone(),
                resolved: None,
            }
        };
        (target, one)
    }
}

#[derive(Clone)]
pub struct Subsurface {
    pub size: [u32; 2],
    targets: [Target; 3],
    /// The geometry's depth at its sample count, which the share pass is tested equal against.
    depth: wgpu::TextureView,
    share_pipeline: wgpu::RenderPipeline,
    spread_pipeline: wgpu::RenderPipeline,
    spread: wgpu::BindGroup,
    uniform: wgpu::Buffer,
}

/// What the share pass reads of the geometry's targets, and the scene shader and its layout.
pub(crate) struct Inputs<'a> {
    pub ids: &'a wgpu::TextureView,
    /// The geometry's sample count, its multisampled IDs (a 1 × 1 stand-in is made at one
    /// sample) and depth.
    pub samples: u32,
    pub ids_ms: &'a wgpu::TextureView,
    pub depth_ms: &'a wgpu::TextureView,
    pub module: &'a wgpu::ShaderModule,
    /// The scene shader's pipeline layout for solids: frame, lights, ambient occlusion, maps.
    pub layout: &'a wgpu::PipelineLayout,
}

impl Subsurface {
    pub(crate) fn new(d: &deep_gpu::counted::Wgpu, size: [u32; 2], i: Inputs<'_>) -> Subsurface {
        let usage = wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING;
        let (share_t, share) = Target::new(d, size, i.samples, SHARE);
        let (profile_t, profile) = Target::new(d, size, i.samples, PROFILE);
        let (size_t, sizes) = Target::new(d, size, i.samples, SIZE);
        let tex = |binding, sample_type, multisampled| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled,
            },
            count: None,
        };
        let float = wgpu::TextureSampleType::Float { filterable: false };
        let uint = wgpu::TextureSampleType::Uint;
        // At one sample the multisampled IDs are a 1 × 1 stand-in, which the spread reads as full
        // coverage.
        let stand_in = (i.samples == 1).then(|| {
            d.create_texture(&wgpu::TextureDescriptor {
                label: Some(SPREAD_PASS),
                size: wgpu::Extent3d {
                    width: 1,
                    height: 1,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: crate::MSAA,
                dimension: wgpu::TextureDimension::D2,
                format: IDS_MS,
                usage,
                view_formats: &[],
            })
            .create_view(&Default::default())
        });
        let ids_ms = stand_in.as_ref().unwrap_or(i.ids_ms);
        let share_pipeline = share_pipeline(d, i.samples, i.layout, i.module, "sss_fs");
        let spread_group = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(SPREAD_PASS),
            entries: &[
                tex(0, float, false),
                tex(1, float, false),
                tex(2, float, false),
                tex(3, uint, false),
                tex(4, uint, true),
                buffer_entry(
                    5,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
            ],
        });
        let uniform = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(SPREAD_PASS),
            size: std::mem::size_of::<SpreadUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let spread = bind_group(
            d,
            SPREAD_PASS,
            &spread_group,
            [
                wgpu::BindingResource::TextureView(&share),
                wgpu::BindingResource::TextureView(&profile),
                wgpu::BindingResource::TextureView(&sizes),
                wgpu::BindingResource::TextureView(i.ids),
                wgpu::BindingResource::TextureView(ids_ms),
                uniform.as_entire_binding(),
            ],
        );
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(SPREAD_PASS),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let spread_layout = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(SPREAD_PASS),
            bind_group_layouts: &[Some(&spread_group)],
            immediate_size: 0,
        });
        let add = wgpu::BlendComponent {
            src_factor: wgpu::BlendFactor::One,
            dst_factor: wgpu::BlendFactor::One,
            operation: wgpu::BlendOperation::Add,
        };
        let spread_pipeline = crate::pipeline(
            d,
            SPREAD_PASS,
            Some(&spread_layout),
            &module,
            ("vs", &[]),
            Some((
                "fs",
                &[crate::target(
                    LINEAR,
                    Some(wgpu::BlendState {
                        color: add,
                        alpha: add,
                    }),
                )],
            )),
            None,
        );
        Subsurface {
            size,
            targets: [share_t, profile_t, size_t],
            depth: i.depth_ms.clone(),
            share_pipeline,
            spread_pipeline,
            spread,
            uniform,
        }
    }

    /// Writes the taps, and the planted pass that takes every tap (`across`: its scale and pixel
    /// size in mm where a pixel holds no subsurface part).
    pub fn write(&self, queue: &deep_gpu::counted::Queue, across: Option<(f64, f64)>) {
        let (radii, edges) = taps();
        let (on, scale, size) = across.map_or((0.0, 0.0, 0.0), |(s, p)| (1.0, s, p));
        let u = SpreadUniform {
            opts: [on, scale as f32, size as f32, 0.0],
            radii,
            edges,
        };
        deep_gpu::alloc::outside(|| queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&u)));
    }

    /// The share pass over `draws` (with the scene's groups 0 to 2 bound), then the spread into
    /// `linear`.
    pub(crate) fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        linear: &wgpu::TextureView,
        binds: &[wgpu::BindGroup; 3],
        draws: &[ShareDraw],
        profiler: &Option<Profiler>,
    ) {
        crate::timed(
            profiler,
            SHARE_PASS,
            encoder,
            |encoder, timestamp_writes| {
                fn clear(t: &Target) -> Option<wgpu::RenderPassColorAttachment<'_>> {
                    Some(wgpu::RenderPassColorAttachment {
                        view: &t.drawn,
                        resolve_target: t.resolved.as_ref(),
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                            store: if t.resolved.is_some() {
                                wgpu::StoreOp::Discard
                            } else {
                                wgpu::StoreOp::Store
                            },
                        },
                    })
                }
                let [a, b, c] = &self.targets;
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(SHARE_PASS),
                    color_attachments: &[clear(a), clear(b), clear(c)],
                    depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                        view: &self.depth,
                        depth_ops: None,
                        stencil_ops: None,
                    }),
                    timestamp_writes,
                    ..Default::default()
                });
                for (i, b) in binds.iter().enumerate() {
                    pass.set_bind_group(i as u32, b, &[]);
                }
                for (vertices, indices, count, instances, n, maps, own) in draws {
                    pass.set_pipeline(own.as_ref().unwrap_or(&self.share_pipeline));
                    pass.set_bind_group(3, maps, &[]);
                    pass.set_vertex_buffer(0, vertices.slice(..));
                    pass.set_vertex_buffer(1, instances.slice(..));
                    pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                    pass.draw_indexed(0..*count, 0, 0..*n);
                }
            },
        );
        crate::timed(profiler, SPREAD_PASS, encoder, |encoder, timestamps| {
            crate::full_pass(
                encoder,
                SPREAD_PASS,
                linear,
                wgpu::LoadOp::Load,
                &self.spread_pipeline,
                &self.spread,
                timestamps,
            )
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn taps_split_the_profile_into_equal_shares() {
        let (radii, edges) = taps();
        for i in 0..TAPS {
            let n = TAPS as f64;
            assert!((cdf(f64::from(radii[i])) - (i as f64 + 0.5) / n).abs() < 1e-5);
            assert!((cdf(f64::from(edges[i])) - i as f64 / n).abs() < 1e-5);
            assert!(edges[i] < radii[i] && radii[i] < edges[i + 1]);
        }
        assert_eq!(cdf(f64::from(edges[TAPS])), 1.0);
    }
}
