//! Object: hidden view (issue #290; canvas primitives: Object: hidden view): an item whose
//! hidden view is above opacity 0 draws again where nearer surfaces hide it. After the geometry
//! pass, its resolve and the glass, each such item takes two passes over the one-sample targets:
//! a depth pass of its own triangles into a depth target of its own, which keeps its nearest
//! surface, then that surface blended over the linear target at the view's opacity where the
//! core's depth target holds a nearer one and its object-ID target names another item. The
//! depth pass makes that test, since the color pass's fragment stage has no texture binding to
//! spare: a nearest surface that isn't hidden writes the nearest depth there is, which no
//! surface of the blended draw equals. Pick IDs are a part's or an element's, so the pass reads
//! each pick ID's item from a table.
//! It writes no depth the frame reads, no object ID and no shadow map, and it draws before the
//! effects, the tone map and the status passes. An item at opacity 0 has no record here, so it
//! adds no pass.

use std::collections::BTreeMap;

use deep_canvas_scene3d::hidden::HiddenView;
use deep_canvas_scene3d::scene::{Adjust3, Shape, Solid};
use deep_gpu::device::Device;

use crate::set::Set;
use crate::{created, culled, mesh_buffers, target, texture2d, Profiler, Renderer, SolidRecord};
use crate::{DEPTH, LINEAR, MAPS_INDEX};

/// The passes' names in a frame's timings and its hidden views' report.
pub const DEPTH_PASS: &str = "scene3d.hidden_depth";
pub const PASS: &str = "scene3d.hidden";

/// #290's wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// The view also draws where its item shows.
    pub draws_visible: bool,
    /// No depth pass of its own: every layer of the item blends.
    pub stacks_layers: bool,
    /// The view writes its item's object ID.
    pub writes_ids: bool,
    /// The view's blended draw is issued after the status guard and the status colors, over the
    /// final target.
    pub after_status: bool,
}

/// The adjust a solid's hidden view shades with: its item's own, its tint times the view's
/// role's color; the item's own alone for `base`.
pub(crate) fn adjust(s: &Solid, v: &HiddenView) -> Option<Adjust3> {
    let own = s.adjust.filter(Adjust3::colors);
    let Some(tint) = v.tint else {
        return own;
    };
    let mut a = own.unwrap_or(Adjust3 {
        opacity: 1.0,
        exposure: 0.0,
        contrast: 1.0,
        gamma: 1.0,
        hue: 0.0,
        saturation: 1.0,
        brightness: 1.0,
        tint: None,
        invert: false,
    });
    a.tint = Some(a.tint.map_or(tint, |t| [0, 1, 2].map(|k| t[k] * tint[k])));
    Some(a)
}

/// A batch's hidden views: one record per solid of an item with one, in solid order; each
/// record's item, shape, maps and pick ID.
#[derive(Default)]
pub(crate) struct Records {
    set: Set,
    draws: Vec<(String, Shape, u32, u32)>,
}

impl Records {
    pub(crate) fn begin(&mut self) {
        self.set.begin();
        self.draws.clear();
    }

    /// `s`'s record for its item's hidden view `v`: `record` as it draws in the color pass,
    /// with the view's opacity where a material operator's would ride.
    pub(crate) fn push(&mut self, s: &Solid, maps: u32, mut record: SolidRecord, v: &HiddenView) {
        record.op[2] = (v.opacity as f32).to_bits();
        self.set.push(&s.id, bytemuck::bytes_of(&record));
        let item = created::item_of(&s.id).to_string();
        self.draws
            .push((item, s.shape, maps & MAPS_INDEX, record.pick));
    }

    pub(crate) fn finish(&mut self, device: &Device, next: &mut u64, written: &mut u32) {
        if self.set.buffer.is_some() || self.set.count > 0 {
            self.set.finish(device, next, written);
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.draws.is_empty()
    }
}

/// The hidden views' pipelines and targets, made the first time a frame draws one.
pub(crate) struct Hidden {
    layout: wgpu::BindGroupLayout,
    depth: wgpu::RenderPipeline,
    color: wgpu::RenderPipeline,
    /// #290's planted hidden_writes_ids: the pass that writes each hidden view's object ID.
    ids: Option<wgpu::RenderPipeline>,
    /// Its own depth, at the targets' size.
    own_depth: Option<(wgpu::TextureView, [u32; 2])>,
    /// Each pick ID's item among the frame's hidden views, 1 up, as the depth pass reads it:
    /// the buffer and what it holds.
    items: Option<(wgpu::Buffer, Vec<u32>)>,
    /// The depth pass's group, with the core's depth and object IDs and the table it binds.
    reads: Option<(wgpu::BindGroup, [wgpu::TextureView; 2], wgpu::Buffer)>,
}

/// One draw of an item's hidden view: a mesh, its records and which, and its maps.
type Draw = (
    wgpu::Buffer,
    wgpu::Buffer,
    u32,
    wgpu::Buffer,
    std::ops::Range<u32>,
    wgpu::BindGroup,
);

/// A frame's hidden views, as the geometry job records them: each item's draws in layer and
/// item order.
pub(crate) struct Frame {
    depth: wgpu::RenderPipeline,
    color: wgpu::RenderPipeline,
    ids: Option<wgpu::RenderPipeline>,
    own_depth: wgpu::TextureView,
    reads: wgpu::BindGroup,
    binds: [wgpu::BindGroup; 3],
    items: Vec<(String, Vec<Draw>)>,
    /// The planted hidden_view_without_own_depth: its depth pass keeps the farthest layer.
    stacks: bool,
}

impl Hidden {
    fn new(r: &Renderer, d: &deep_gpu::counted::Wgpu) -> Hidden {
        let texture = |binding, sample_type| wgpu::BindGroupLayoutEntry {
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
            label: Some(PASS),
            entries: &[
                texture(1, wgpu::TextureSampleType::Depth),
                texture(2, wgpu::TextureSampleType::Uint),
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let reading = d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(DEPTH_PASS),
            bind_group_layouts: &[Some(&r.row_groups[0]), None, None, None, Some(&layout)],
            immediate_size: 0,
        });
        // Its nearest surface; the planted hidden_view_without_own_depth keeps its farthest, and
        // its color draws every layer at or before that one.
        let stacks = r.planted.hidden.stacks_layers;
        let (nearest, kept) = match (stacks, r.planted.forward_z) {
            (true, _) => (
                wgpu::CompareFunction::Less,
                wgpu::CompareFunction::GreaterEqual,
            ),
            (_, true) => (wgpu::CompareFunction::Less, wgpu::CompareFunction::Equal),
            _ => (
                wgpu::CompareFunction::GreaterEqual,
                wgpu::CompareFunction::Equal,
            ),
        };
        let state = |write, compare| wgpu::DepthStencilState {
            format: DEPTH,
            depth_write_enabled: Some(write),
            depth_compare: Some(compare),
            stencil: Default::default(),
            bias: Default::default(),
        };
        let buffers = mesh_buffers();
        let module = &r.scene_module;
        let depth = culled(
            d,
            1,
            DEPTH_PASS,
            Some(&reading),
            module,
            ("mesh_vs", &buffers),
            Some(("hidden_depth_fs", &[])),
            Some(state(true, nearest)),
            None,
        );
        let over = wgpu::BlendState::PREMULTIPLIED_ALPHA_BLENDING;
        let into = if r.planted.hidden.after_status {
            deep_gpu::surface::FORMAT
        } else {
            LINEAR
        };
        let color = culled(
            d,
            1,
            PASS,
            Some(&r.solid_layout),
            module,
            ("mesh_vs", &buffers),
            Some(("hidden_fs", &[target(into, Some(over))])),
            Some(state(false, kept)),
            None,
        );
        let ids = r.planted.hidden.writes_ids.then(|| {
            culled(
                d,
                1,
                "scene3d.hidden_ids",
                Some(&r.solid_layout),
                module,
                ("mesh_vs", &buffers),
                Some(("hidden_ids_fs", &[target(crate::IDS, None)])),
                Some(state(false, wgpu::CompareFunction::Equal)),
                None,
            )
        });
        Hidden {
            layout,
            depth,
            color,
            ids,
            own_depth: None,
            items: None,
            reads: None,
        }
    }
}

impl Renderer {
    /// Makes the hidden views' pipelines the first time a layer holds one (#432: named for the
    /// items that turned them on, so the warm-up at check makes them).
    pub(crate) fn ensure_hidden(&mut self, device: &Device, items: impl Iterator<Item = String>) {
        if self.hidden.is_some() {
            return;
        }
        let made = Hidden::new(self, &device.device);
        self.hidden = Some(made);
        let items: Vec<String> = items.collect();
        for name in [DEPTH_PASS, PASS] {
            let made = (items.clone(), "hidden_view".to_string(), "view".into());
            self.made_for.insert(name, made);
            self.names.push(name);
        }
        self.compiled += 2;
    }

    /// This frame's hidden views, with their targets at the frame's size; none when no item's is
    /// above 0.
    pub(crate) fn hidden_frame(&mut self, device: &Device) -> Option<Frame> {
        // Each item's draws, an item once whatever its records' order, and each pick ID's item.
        let mut items: Vec<(String, Vec<Draw>)> = Vec::new();
        let mut table = vec![0u32; self.picks.len() + 1];
        let mut index: BTreeMap<&str, usize> = BTreeMap::new();
        for id in &self.order {
            let Some(records) = self.batches.get(id).map(|b| &b.hidden) else {
                continue;
            };
            let Some(buffer) = &records.set.buffer else {
                continue;
            };
            for (k, (item, shape, maps, pick)) in records.draws.iter().enumerate() {
                let Some(mesh) = self.meshes.peek(shape) else {
                    continue;
                };
                let at = *index.entry(item.as_str()).or_insert_with(|| {
                    items.push((item.clone(), Vec::new()));
                    items.len() - 1
                });
                if let Some(tag) = table.get_mut(*pick as usize) {
                    *tag = at as u32 + 1;
                }
                // Records of one item, mesh and maps that follow each other draw as one.
                let k = k as u32;
                let before = k.checked_sub(1).map(|j| &records.draws[j as usize]);
                let follows = before.is_some_and(|b| (&b.0, b.1, b.2) == (item, *shape, *maps));
                let draws = &mut items[at].1;
                match draws.last_mut().filter(|d| follows && d.4.end == k) {
                    Some(run) => run.4.end = k + 1,
                    None => draws.push((
                        mesh.vertices.clone(),
                        mesh.indices.clone(),
                        mesh.count,
                        buffer.clone(),
                        k..k + 1,
                        self.maps.by_index(*maps).clone(),
                    )),
                }
            }
        }
        if items.is_empty() {
            return None;
        }
        let t = self.targets.as_ref()?;
        let h = self.hidden.as_mut()?;
        let d = &device.device;
        if h.own_depth.as_ref().is_none_or(|made| made.1 != t.size) {
            let usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
            let own = texture2d(d, DEPTH_PASS, t.size, DEPTH, usage);
            h.own_depth = Some((own.create_view(&Default::default()), t.size));
        }
        // The table, in a buffer that holds every pick ID, written when it changes.
        if h.items
            .as_ref()
            .is_none_or(|(b, _)| b.size() < 4 * table.len() as u64)
        {
            let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some(DEPTH_PASS),
                size: 4 * table.len().next_power_of_two().max(16) as u64,
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            h.items = Some((buffer, Vec::new()));
        }
        let (buffer, held) = h.items.as_mut()?;
        table.resize((buffer.size() / 4) as usize, 0);
        if *held != table {
            let bytes: &[u8] = bytemuck::cast_slice(&table);
            deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, 0, bytes));
            *held = table;
        }
        let core = [t.drawn.depth.clone(), t.drawn.ids.clone()];
        let bound = |(_, views, b): &(wgpu::BindGroup, [wgpu::TextureView; 2], wgpu::Buffer)| {
            *views == core && b == &*buffer
        };
        if !h.reads.as_ref().is_some_and(bound) {
            let resource = |binding, resource| wgpu::BindGroupEntry { binding, resource };
            let group = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some(DEPTH_PASS),
                layout: &h.layout,
                entries: &[
                    resource(1, wgpu::BindingResource::TextureView(&core[0])),
                    resource(2, wgpu::BindingResource::TextureView(&core[1])),
                    resource(3, buffer.as_entire_binding()),
                ],
            });
            h.reads = Some((group, core, buffer.clone()));
        }
        let (own_depth, reads) = (h.own_depth.clone()?.0, h.reads.clone()?.0);
        self.counts.hidden_views = items.iter().map(|(item, _)| item.clone()).collect();
        Some(Frame {
            depth: h.depth.clone(),
            color: h.color.clone(),
            ids: h.ids.clone(),
            own_depth,
            reads,
            binds: [
                self.frame_bind.clone(),
                self.lights_bind.clone(),
                self.ao.shade().clone(),
            ],
            items,
            stacks: self.planted.hidden.stacks_layers,
        })
    }
}

impl Frame {
    /// Each item's two passes, one item after another: its depth pass into its own depth
    /// target, cleared for it, then its blended draw over `linear`; inside `crop` when the
    /// scene has one. The planted hidden_writes_ids then writes its object ID into `ids` too.
    pub(crate) fn record(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        [linear, ids]: [&wgpu::TextureView; 2],
        clear_depth: f64,
        crop: Option<[u32; 4]>,
        profiler: &Option<Profiler>,
    ) {
        let draw = |pass: &mut wgpu::RenderPass<'_>, draws: &[Draw], shades: bool| {
            if let Some([x, y, w, h]) = crop {
                pass.set_scissor_rect(x, y, w, h);
            }
            // The depth pass binds the frame alone, and the core's targets it reads.
            let binds = if shades {
                &self.binds[..]
            } else {
                &self.binds[..1]
            };
            for (i, b) in binds.iter().enumerate() {
                pass.set_bind_group(i as u32, b, &[]);
            }
            for (vertices, indices, count, instances, run, maps) in draws {
                if shades {
                    pass.set_bind_group(3, maps, &[]);
                }
                pass.set_vertex_buffer(0, vertices.slice(..));
                pass.set_vertex_buffer(1, instances.slice(..));
                pass.set_index_buffer(indices.slice(..), wgpu::IndexFormat::Uint32);
                pass.draw_indexed(0..*count, 0, run.clone());
            }
        };
        // The planted pass keeps the farthest layer, so its depth clears to the nearest.
        let cleared = if self.stacks {
            1.0 - clear_depth
        } else {
            clear_depth
        };
        let own = |clear: bool| wgpu::RenderPassDepthStencilAttachment {
            view: &self.own_depth,
            depth_ops: Some(wgpu::Operations {
                load: if clear {
                    wgpu::LoadOp::Clear(cleared as f32)
                } else {
                    wgpu::LoadOp::Load
                },
                store: wgpu::StoreOp::Store,
            }),
            stencil_ops: None,
        };
        let over = |view| {
            Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })
        };
        for (_, draws) in &self.items {
            crate::timed(
                profiler,
                DEPTH_PASS,
                encoder,
                |encoder, timestamp_writes| {
                    let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some(DEPTH_PASS),
                        color_attachments: &[],
                        depth_stencil_attachment: Some(own(true)),
                        timestamp_writes,
                        ..Default::default()
                    });
                    pass.set_pipeline(&self.depth);
                    pass.set_bind_group(4, &self.reads, &[]);
                    draw(&mut pass, draws, false);
                },
            );
            crate::timed(profiler, PASS, encoder, |encoder, timestamp_writes| {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some(PASS),
                    color_attachments: &[over(linear)],
                    depth_stencil_attachment: Some(own(false)),
                    timestamp_writes,
                    ..Default::default()
                });
                pass.set_pipeline(&self.color);
                draw(&mut pass, draws, true);
            });
            if let Some(pipeline) = &self.ids {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene3d.hidden_ids"),
                    color_attachments: &[over(ids)],
                    depth_stencil_attachment: Some(own(false)),
                    ..Default::default()
                });
                pass.set_pipeline(pipeline);
                draw(&mut pass, draws, true);
            }
        }
    }
}
