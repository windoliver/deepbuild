//! Look `look@1`: tone mapping, `local` (#971): the local tone map over the linear image the
//! output pass reads, after the effects, bloom and the flare (local_tone.wgsl). Down a pyramid,
//! each level's cells hold the two levels of the stops about middle grey of the cells below,
//! with their shares; a grid over the coarsest cells holds what their levels weigh at each step
//! up the stops, and each pixel reads its base from it, which is the joint bilateral upsample;
//! the base is compressed toward middle grey and the detail scaled. The pyramid and the grid are
//! one compute pass and the image one render pass; the output pass reads the resolved image in
//! the linear one's place. Everything is a function of this frame, so seeking equals playing.

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::look::Local;
use deep_gpu::counted::Written;
use deep_gpu::device::Device;
use deep_gpu::encode::Job;

pub use deep_canvas_scene3d::module::LOCAL_TONE_PASS;

use crate::{buffer_entry, lock, pipeline, target, texture2d, timed, LINEAR};

const SOURCE: &str = include_str!("local_tone.wgsl");
/// A level's cells, their two levels' stops and their shares of the cell, and the grid's.
const CELLS: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;
/// local_tone.wgsl's REACH: the grid runs from this many stops under middle grey to as many over.
const REACH: f32 = 16.0;
/// The grid's texels at most: a pyramid whose coarsest level has many cells takes fewer steps up
/// the stops than a quarter stop apart.
const GRID_TEXELS: u32 = 4_400_000;

/// The local tone map's wrong programs, each reachable only through a proof surface's `planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Every tap of the upsample takes a range weight of 1: the base is a blur across edges.
    pub edge_blind: bool,
    /// The pyramid has the look's `levels` at every output size.
    pub fixed_levels: bool,
}

deep_gpu::paired! { params: "local_tone.wgsl", Local;
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    exposure: f32,
    range: f32,
    strength: f32,
    detail: f32,
    blind: u32,
    cell: f32,
    apart: f32,
    _pad: u32,
}
}

/// The work for one frame size, level count and source image.
struct Sized {
    size: [u32; 2],
    levels: u32,
    source: wgpu::TextureView,
    /// The pyramid's steps and the grid's in the order they run: which pipeline, the bind group
    /// it reads and writes through, and its workgroups.
    steps: Vec<(usize, wgpu::BindGroup, [u32; 3])>,
    apply: wgpu::BindGroup,
    resolved: wgpu::TextureView,
}

fn bound(binding: u32, view: &wgpu::TextureView) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding,
        resource: wgpu::BindingResource::TextureView(view),
    }
}

pub struct Toner {
    /// The first level's, a coarser level's, the grid's and the image's.
    layouts: [wgpu::BindGroupLayout; 4],
    steps: [wgpu::ComputePipeline; 3],
    apply: wgpu::RenderPipeline,
    /// Reads a 2 × 2 block of the image as its mean, and the grid between its texels.
    between: wgpu::Sampler,
    params: wgpu::Buffer,
    written: Written,
    /// This frame's halvings from the image to the coarsest level, and the grid's steps up the
    /// stops.
    levels: u32,
    up: u32,
    sized: Option<Sized>,
}

impl Toner {
    pub fn new(device: &Device) -> Self {
        let d = &device.device;
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(LOCAL_TONE_PASS),
            source: wgpu::ShaderSource::Wgsl(SOURCE.into()),
        });
        let (compute, fragment) = (wgpu::ShaderStages::COMPUTE, wgpu::ShaderStages::FRAGMENT);
        let uniform = |stage| buffer_entry(0, stage, wgpu::BufferBindingType::Uniform);
        let tex = |binding, visibility, view_dimension| wgpu::BindGroupLayoutEntry {
            binding,
            visibility,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                view_dimension,
                multisampled: false,
            },
            count: None,
        };
        let into = |binding, view_dimension| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: compute,
            ty: wgpu::BindingType::StorageTexture {
                access: wgpu::StorageTextureAccess::WriteOnly,
                format: CELLS,
                view_dimension,
            },
            count: None,
        };
        let between = |visibility| wgpu::BindGroupLayoutEntry {
            binding: 5,
            visibility,
            ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
            count: None,
        };
        let (flat, deep) = (
            wgpu::TextureViewDimension::D2,
            wgpu::TextureViewDimension::D3,
        );
        let layout = |entries: &[wgpu::BindGroupLayoutEntry]| {
            d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some(LOCAL_TONE_PASS),
                entries,
            })
        };
        let layouts = [
            layout(&[
                uniform(compute),
                tex(1, compute, flat),
                into(4, flat),
                between(compute),
            ]),
            layout(&[tex(2, compute, flat), into(4, flat)]),
            layout(&[uniform(compute), tex(3, compute, flat), into(6, deep)]),
            layout(&[
                uniform(fragment),
                tex(1, fragment, flat),
                between(fragment),
                tex(7, fragment, deep),
            ]),
        ];
        let pipeline_layout = |k: usize| {
            d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some(LOCAL_TONE_PASS),
                bind_group_layouts: &[Some(&layouts[k])],
                immediate_size: 0,
            })
        };
        let step = |k: usize, entry: &str| {
            d.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
                label: Some(LOCAL_TONE_PASS),
                layout: Some(&pipeline_layout(k)),
                module: &module,
                entry_point: Some(entry),
                compilation_options: Default::default(),
                cache: None,
            })
        };
        let steps = [step(0, "first"), step(1, "reduce"), step(2, "weigh")];
        let apply = pipeline(
            d,
            LOCAL_TONE_PASS,
            Some(&pipeline_layout(3)),
            &module,
            ("local_vs", &[]),
            Some(("apply_fs", &[target(LINEAR, None)])),
            None,
        );
        let between = d.create_sampler(&wgpu::SamplerDescriptor {
            label: Some(LOCAL_TONE_PASS),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let params = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some(LOCAL_TONE_PASS),
            size: std::mem::size_of::<Params>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Toner {
            layouts,
            steps,
            apply,
            between,
            params,
            written: Written::default(),
            levels: 2,
            up: 128,
            sized: None,
        }
    }

    /// A frame with no local tone map: the targets it bound are let go.
    pub fn rest(&mut self) {
        self.sized = None;
    }

    /// The last frame's resolved image, in the linear image's format, and its size.
    pub fn resolved(&self) -> Option<(&wgpu::Texture, [u32; 2])> {
        self.sized.as_ref().map(|s| (s.resolved.texture(), s.size))
    }

    /// This frame's parameters: `local` on a frame of `size` under the output's `exposure` scale.
    pub fn prepare(
        &mut self,
        device: &Device,
        local: &Local,
        exposure: f64,
        size: [u32; 2],
        planted: Planted,
    ) {
        self.levels = if planted.fixed_levels {
            local.levels
        } else {
            local.levels_at(size)
        };
        let cells: u32 = size.iter().map(|n| n.div_ceil(1 << self.levels)).product();
        self.up = (GRID_TEXELS / cells.max(1)).clamp(16, 128);
        let params = Params {
            exposure: exposure as f32,
            range: (1.0 / (2.0 * local.sigma * local.sigma)) as f32,
            strength: local.strength as f32,
            detail: local.detail as f32,
            blind: u32::from(planted.edge_blind),
            cell: (1u32 << self.levels) as f32,
            apart: 2.0 * REACH / self.up as f32,
            _pad: 0,
        };
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_changed(&self.params, &self.written, bytemuck::bytes_of(&params))
        });
    }

    fn sized(
        &self,
        device: &Device,
        size: [u32; 2],
        source: &wgpu::TextureView,
        into: &wgpu::TextureView,
    ) -> Sized {
        let d = &device.device;
        let usage = wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::TEXTURE_BINDING;
        let cells = |size: [u32; 2]| {
            texture2d(d, "scene3d.local_tone level", size, CELLS, usage)
                .create_view(&Default::default())
        };
        let params = wgpu::BindGroupEntry {
            binding: 0,
            resource: self.params.as_entire_binding(),
        };
        let bind = |k: usize, entries: &[wgpu::BindGroupEntry]| {
            d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(LOCAL_TONE_PASS),
                layout: &self.layouts[k],
                entries,
            })
        };
        let between = wgpu::BindGroupEntry {
            binding: 5,
            resource: wgpu::BindingResource::Sampler(&self.between),
        };
        let groups = |at: [u32; 2]| [at[0].div_ceil(8), at[1].div_ceil(8), 1];
        // Down: the first level from the image, 4 px a cell, then each from the level under it.
        let mut at = size.map(|n| n.div_ceil(4));
        let mut level = cells(at);
        let first = [
            params.clone(),
            bound(1, source),
            bound(4, &level),
            between.clone(),
        ];
        let mut steps = vec![(0, bind(0, &first), groups(at))];
        for _ in 2..self.levels {
            at = at.map(|n| n.div_ceil(2));
            let coarser = cells(at);
            let through = bind(1, &[bound(2, &level), bound(4, &coarser)]);
            steps.push((1, through, groups(at)));
            level = coarser;
        }
        // The grid over the coarsest level's cells, a texel a step up the stops and one more.
        let deep = self.up + 1;
        let grid = d
            .create_texture(&wgpu::TextureDescriptor {
                label: Some("scene3d.local_tone grid"),
                size: wgpu::Extent3d {
                    width: at[0],
                    height: at[1],
                    depth_or_array_layers: deep,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D3,
                format: CELLS,
                usage,
                view_formats: &[],
            })
            .create_view(&Default::default());
        let through = bind(2, &[params.clone(), bound(3, &level), bound(6, &grid)]);
        let across = [at[0].div_ceil(4), at[1].div_ceil(4), deep.div_ceil(4)];
        steps.push((2, through, across));
        let apply = bind(3, &[params, bound(1, source), between, bound(7, &grid)]);
        Sized {
            size,
            levels: self.levels,
            source: source.clone(),
            steps,
            apply,
            resolved: into.clone(),
        }
    }

    pub fn job(
        &mut self,
        device: &Device,
        size: [u32; 2],
        source: &wgpu::TextureView,
        into: &(wgpu::Texture, wgpu::TextureView),
        profiler: &Option<crate::Profiler>,
    ) -> (Job, wgpu::TextureView) {
        let keep = self.sized.as_ref().is_some_and(|s| {
            s.size == size && s.levels == self.levels && &s.source == source && s.resolved == into.1
        });
        if !keep {
            self.sized = Some(self.sized(device, size, source, &into.1));
        }
        let s = self.sized.as_ref().expect("sized above");
        let (pipes, steps) = (self.steps.clone(), s.steps.clone());
        let (apply, bind, into) = (self.apply.clone(), s.apply.clone(), s.resolved.clone());
        let profiler = profiler.clone();
        let job: Job = Box::new(move |encoder| {
            // Both passes are timed under LOCAL_TONE_PASS; the profiler sums them by label.
            let query = profiler
                .as_ref()
                .map(|p| lock(p).begin_pass_query(LOCAL_TONE_PASS, encoder));
            {
                deep_gpu::counted::compute_pass();
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some(LOCAL_TONE_PASS),
                    timestamp_writes: query
                        .as_ref()
                        .and_then(|q| q.compute_pass_timestamp_writes()),
                });
                for (pipe, through, groups) in &steps {
                    pass.set_pipeline(&pipes[*pipe]);
                    pass.set_bind_group(0, through, &[]);
                    pass.dispatch_workgroups(groups[0], groups[1], groups[2]);
                }
            }
            if let (Some(p), Some(q)) = (&profiler, query) {
                lock(p).end_query(encoder, q);
            }
            timed(
                &profiler,
                LOCAL_TONE_PASS,
                encoder,
                |encoder, timestamps| {
                    crate::full_pass(
                        encoder,
                        LOCAL_TONE_PASS,
                        &into,
                        wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        &apply,
                        &bind,
                        timestamps,
                    )
                },
            );
        });
        (job, s.resolved.clone())
    }
}
