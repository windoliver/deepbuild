//! #506: projected insets on the GPU (canvas primitives: Inset: projected). Every projected
//! inset of a view lives in one storage buffer in the lights' group (inset.wgsl): at most 8
//! records in a fixed table, so a count change never recompiles, then their `onto` pick lists and
//! texels. A storage buffer, not textures: the solids' fragment stage has no sampled texture
//! binding to spare (tint.rs). The lit ones replace their surfaces' base color in shading
//! (inset_lit.wgsl); the unlit ones draw in a pass of their own after tone mapping and the grade
//! (inset_unlit.wgsl), before the status colors.

use std::collections::BTreeMap;

use deep_canvas_scene3d::inset::{Projected, MAX_PROJECTED};
use deep_canvas_scene3d::light::Texels;
use deep_gpu::device::Device;

/// Its binding in the lights' group (inset_lit.wgsl).
const BINDING: u32 = 21;
/// A record's words (inset.wgsl: `INSET_WORDS`), after a 4-word header.
const WORDS: usize = 32;
const HEADER: usize = 4;
const UNLIT: u32 = 1;
const ALL: u32 = 2;
const FROM_EYE: u32 = 4;

pub use deep_canvas_scene3d::module::{INSET_UNLIT_PASS as UNLIT_PASS, INSET_VIEW_PASS as VIEW_PASS};

const SHADER: &str = concat!(include_str!("inset_unlit.wgsl"), include_str!("inset.wgsl"));

/// The lights group's layout entry for the insets' buffer.
pub(crate) fn entry() -> wgpu::BindGroupLayoutEntry {
    crate::buffer_entry(
        BINDING,
        wgpu::ShaderStages::FRAGMENT,
        wgpu::BufferBindingType::Storage { read_only: true },
    )
}

/// The insets that draw: those whose texels are there, in their format.
fn drawn<'a>(
    insets: &'a [Projected],
    texels: &'a BTreeMap<String, std::sync::Arc<Texels>>,
) -> Vec<(&'a Projected, &'a Texels)> {
    insets
        .iter()
        .take(MAX_PROJECTED)
        .filter_map(|p| Some((p, texels.get(&p.key)?.as_ref())))
        .filter(|(_, t)| t.format == FORMAT && t.data.len() >= (t.size[0] * t.size[1] * 4) as usize)
        .collect()
}

/// The texels' format an inset's picture comes in: straight-alpha sRGB codes.
pub const FORMAT: &str = "rgba8unorm-srgb";

/// How many words [`words`] gives, whatever the pick IDs: what the buffer is made for before
/// the batches bind the lights' group.
pub fn len(insets: &[Projected], texels: &BTreeMap<String, std::sync::Arc<Texels>>) -> usize {
    HEADER
        + MAX_PROJECTED * WORDS
        + drawn(insets, texels)
            .iter()
            .map(|(p, t)| (t.size[0] * t.size[1]) as usize + p.onto.as_ref().map_or(0, Vec::len))
            .sum::<usize>()
}

/// The words of `insets`, each record's texels from `texels` by its key (an inset whose texels
/// aren't there draws nothing), its `onto` by the solids' pick IDs in `picks` (0, which no solid
/// has, for one that draws nothing).
pub fn words(
    insets: &[Projected],
    texels: &BTreeMap<String, std::sync::Arc<Texels>>,
    picks: &BTreeMap<String, u32>,
) -> Vec<u32> {
    let insets = drawn(insets, texels);
    let mut out = vec![0u32; HEADER + MAX_PROJECTED * WORDS];
    out[0] = insets.len() as u32;
    for (k, (p, t)) in insets.iter().enumerate() {
        let e = HEADER + k * WORDS;
        // Column-major, as WGSL's mat4x4 reads it.
        for c in 0..4 {
            for r in 0..4 {
                out[e + c * 4 + r] = (p.to_box[r][c] as f32).to_bits();
            }
        }
        let mut flags = 0;
        if p.unlit {
            flags |= UNLIT;
        }
        if p.onto.is_none() {
            flags |= ALL;
        }
        if p.eye.is_some() {
            flags |= FROM_EYE;
        }
        out[e + 16] = flags;
        out[e + 17] = out.len() as u32;
        out[e + 18] = t.size[0];
        out[e + 19] = t.size[1];
        let n = (t.size[0] * t.size[1]) as usize;
        out.extend(
            t.data[..n * 4]
                .chunks_exact(4)
                .map(|c| u32::from_le_bytes([c[0], c[1], c[2], c[3]])),
        );
        let ids: Vec<u32> = p
            .onto
            .iter()
            .flatten()
            .map(|id| picks.get(id).copied().unwrap_or(0))
            .collect();
        out[e + 20] = out.len() as u32;
        out[e + 21] = ids.len() as u32;
        out.extend(ids);
        let v = p.eye.unwrap_or(p.along);
        for (i, x) in [v[0], v[1], v[2], p.edge[0], p.edge[1], p.cos_angle, p.opacity]
            .into_iter()
            .enumerate()
        {
            out[e + 22 + i] = (x as f32).to_bits();
        }
    }
    out
}

/// The insets' buffer, made again only when its length changes.
pub struct Store {
    pub buffer: wgpu::Buffer,
    held: Vec<u32>,
    /// Whether any unlit inset draws this frame.
    pub unlit: bool,
}

fn buffer(d: &deep_gpu::counted::Wgpu, words: usize) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some("scene3d insets"),
        size: (words.max(4) * 4) as u64,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    })
}

impl Store {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Store {
        let held = vec![0u32; HEADER + MAX_PROJECTED * WORDS];
        Store {
            buffer: buffer(d, held.len()),
            held,
            unlit: false,
        }
    }

    /// Makes the buffer again when this frame's words take another length; true when it did
    /// (the lights' group binds the new one).
    pub fn ensure(&mut self, device: &Device, len: usize) -> bool {
        if len == self.held.len() {
            return false;
        }
        self.buffer = buffer(&device.device, len);
        self.held = Vec::new();
        true
    }

    /// Writes this frame's words, of the length [`Store::ensure`] took, when they changed.
    pub fn write(&mut self, device: &Device, words: Vec<u32>) {
        self.unlit = (0..words[0] as usize).any(|k| words[HEADER + k * WORDS + 16] & UNLIT != 0);
        if words == self.held {
            return;
        }
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.buffer, 0, bytemuck::cast_slice(&words))
        });
        self.held = words;
    }
}

/// The unlit insets' pipeline and its layout.
pub struct Unlit {
    layout: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
}

impl Unlit {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Unlit {
        let tex = |binding, sample_type| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        let layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(UNLIT_PASS),
            entries: &[
                crate::buffer_entry(
                    0,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Uniform,
                ),
                tex(1, wgpu::TextureSampleType::Uint),
                tex(2, wgpu::TextureSampleType::Depth),
                crate::buffer_entry(
                    3,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
            ],
        });
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(UNLIT_PASS),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pl = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(UNLIT_PASS),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(UNLIT_PASS),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &module,
                entry_point: Some("unlit_vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &module,
                entry_point: Some("unlit_fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: deep_gpu::surface::FORMAT,
                    blend: Some(wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview_mask: None,
            cache: None,
        });
        Unlit { layout, pipeline }
    }

    /// The pass over `slot`, reading the resolved `ids` and `depth` at `internal` size through
    /// `to_world` (clip to world, column-major), the insets from `store`.
    #[allow(clippy::too_many_arguments)]
    pub fn job(
        &self,
        d: &deep_gpu::counted::Wgpu,
        store: &Store,
        to_world: [f32; 16],
        internal: [u32; 2],
        size: [u32; 2],
        ids: &wgpu::TextureView,
        depth: &wgpu::TextureView,
        slot: &wgpu::TextureView,
    ) -> crate::Job {
        let mut words: Vec<f32> = to_world.to_vec();
        words.extend([
            internal[0] as f32 / size[0].max(1) as f32,
            internal[1] as f32 / size[1].max(1) as f32,
            0.0,
            0.0,
        ]);
        let uniform = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(UNLIT_PASS),
            contents: bytemuck::cast_slice(&words),
            usage: wgpu::BufferUsages::UNIFORM,
        });
        let bind = d.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(UNLIT_PASS),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(ids),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(depth),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: store.buffer.as_entire_binding(),
                },
            ],
        });
        let (pipeline, slot) = (self.pipeline.clone(), slot.clone());
        Box::new(move |encoder: &mut wgpu::CommandEncoder| {
            crate::full_pass(
                encoder,
                UNLIT_PASS,
                &slot,
                wgpu::LoadOp::Load,
                &pipeline,
                &bind,
                None,
            )
        })
    }
}

/// The inverse of a 4 × 4 matrix given as rows, column-major for WGSL; `None` when singular.
pub fn inverse_columns(m: [[f64; 4]; 4]) -> Option<[f32; 16]> {
    let mut a = [[0.0f64; 8]; 4];
    for r in 0..4 {
        a[r][..4].copy_from_slice(&m[r]);
        a[r][4 + r] = 1.0;
    }
    for c in 0..4 {
        let p = (c..4).max_by(|&i, &j| a[i][c].abs().total_cmp(&a[j][c].abs()))?;
        if a[p][c].abs() < 1e-300 {
            return None;
        }
        a.swap(c, p);
        let d = a[c][c];
        for v in &mut a[c] {
            *v /= d;
        }
        for r in 0..4 {
            if r != c {
                let f = a[r][c];
                let row = a[c];
                for (v, x) in a[r].iter_mut().zip(row) {
                    *v -= f * x;
                }
            }
        }
    }
    let mut out = [0f32; 16];
    for c in 0..4 {
        for r in 0..4 {
            out[c * 4 + r] = a[r][4 + c] as f32;
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A matrix times its inverse is the identity.
    #[test]
    fn the_inverse_undoes_the_matrix() {
        let m = [
            [1.2, 0.1, 0.0, 0.3],
            [0.0, 0.9, 0.2, -1.0],
            [0.0, 0.0, 0.0, 0.1],
            [0.1, 0.2, 1.0, 4.0],
        ];
        let inv = inverse_columns(m).unwrap();
        for r in 0..4 {
            for c in 0..4 {
                let v: f64 = (0..4).map(|k| m[r][k] * f64::from(inv[c * 4 + k])).sum();
                let want = if r == c { 1.0 } else { 0.0 };
                assert!((v - want).abs() < 1e-5, "{r} {c} {v}");
            }
        }
    }
}
