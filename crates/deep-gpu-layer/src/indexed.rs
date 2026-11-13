//! Issue #464: the indexed basis on the GPU (canvas primitives: Look `look@1`: indexed basis).
//! A frame's marks become integer outlines at 1/16 of a target pixel; `indexed.wgsl`, an operator
//! of integers only, writes each target pixel's palette index and its resolved color, and the
//! upscale draws the target at the look's scale by nearest. The index target is read back from
//! that operator, whose determinism class is computed from its module: exact while no step in it
//! takes a float.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use bytemuck::{Pod, Zeroable};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::print::Indexed;
use deep_canvas_marks::scene::{Drawn, Fill, Mark, Rgb, Scope};
use serde_json::{Map, Value};

/// The operator's name, as the reply names it.
pub const OPERATOR: &str = "look.indexed@1";
const INDEX_SOURCE: &str = include_str!("indexed.wgsl");
const UP_SOURCE: &str = include_str!("indexed_up.wgsl");

/// Fixed point: 1/16 of a target pixel.
const ONE: f64 = 16.0;
/// Far enough out that no product the operator forms overflows an i32.
const REACH: f64 = 11_000.0;
const NO_LIGHT: u32 = u32::MAX;

#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable, PartialEq)]
pub struct Prim {
    kind: u32,
    index: u32,
    alpha: u32,
    first: u32,
    count: u32,
    r: u32,
    r_inner: u32,
    light: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    w: u32,
    h: u32,
    prims: u32,
    ground: u32,
    flags: u32,
    light_max: u32,
    scale: u32,
    palette: u32,
}

const FLAG_BLEND: u32 = 1;
const FLAG_LIGHT: u32 = 2;
const FLAG_PARTIAL: u32 = 4;
const FLAG_FULL_OPACITY: u32 = 8;
const FLAG_LIGHT_AFTER: u32 = 16;

/// One frame of an indexed look, ready for the operator.
#[derive(Clone, Debug, Default)]
pub(crate) struct IndexFrame {
    prims: Vec<Prim>,
    edges: Vec<[i32; 4]>,
    /// Each index's color packed 0x00BBGGRR, bit 24 on a protected index.
    palette: Vec<u32>,
    ground: u32,
    size: [u32; 2],
    scale: u32,
    flags: u32,
    light_max: u32,
}

/// The operator's determinism class, computed from its module (canvas primitives: Determinism
/// class): `exact` when no type in it is a float, else `same_machine`.
pub fn class() -> &'static str {
    let Ok(module) = naga::front::wgsl::parse_str(INDEX_SOURCE) else {
        return "same_machine";
    };
    let float = module.types.iter().any(|(_, t)| match t.inner {
        naga::TypeInner::Scalar(s)
        | naga::TypeInner::Vector { scalar: s, .. }
        | naga::TypeInner::Matrix { scalar: s, .. }
        | naga::TypeInner::Atomic(s) => s.kind == naga::ScalarKind::Float,
        _ => false,
    });
    if float {
        "same_machine"
    } else {
        "exact"
    }
}

/// The role an item's paint names, its fill's or else its stroke's.
fn role_of(item: &Value) -> Option<&str> {
    let paint = item.pointer("/params/paint")?;
    paint
        .pointer("/fill/role")
        .or_else(|| paint.pointer("/stroke/role"))
        .and_then(Value::as_str)
}

/// The table an item draws through: its own, else the nearest group's above it that names one.
fn table_of<'a>(items: &'a Map<String, Value>, id: &str) -> &'a str {
    let mut at = items.get(id);
    for _ in 0..64 {
        let Some(item) = at else { break };
        if let Some(t) = item.get("table").and_then(Value::as_str) {
            return t;
        }
        at = item
            .get("parent")
            .and_then(Value::as_str)
            .and_then(|p| items.get(p));
    }
    "none"
}

fn pack(c: Rgb) -> u32 {
    u32::from(c[0]) | u32::from(c[1]) << 8 | u32::from(c[2]) << 16
}

/// A point in document px as fixed point on the target.
fn fixed(p: [f64; 2], scale: f64) -> [i32; 2] {
    p.map(|v| (v / scale * ONE).round().clamp(-REACH, REACH) as i32)
}

/// A path's contours flattened to line segments, in document px.
fn flatten(verbs: &[Verb], offset: [f64; 2]) -> Vec<Vec<[f64; 2]>> {
    let mut contours: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut at = [0.0, 0.0];
    let add = |p: [f64; 2]| [p[0] + offset[0], p[1] + offset[1]];
    for v in verbs {
        match *v {
            Verb::Move(p) => {
                contours.push(vec![add(p)]);
                at = p;
            }
            Verb::Line(p) => {
                if contours.is_empty() {
                    contours.push(vec![add(at)]);
                }
                contours.last_mut().expect("one").push(add(p));
                at = p;
            }
            Verb::Quad(c, p) => {
                if contours.is_empty() {
                    contours.push(vec![add(at)]);
                }
                for k in 1..=16 {
                    let t = f64::from(k) / 16.0;
                    let u = 1.0 - t;
                    let q = [0, 1].map(|i| u * u * at[i] + 2.0 * u * t * c[i] + t * t * p[i]);
                    contours.last_mut().expect("one").push(add(q));
                }
                at = p;
            }
            Verb::Cubic(c1, c2, p) => {
                if contours.is_empty() {
                    contours.push(vec![add(at)]);
                }
                for k in 1..=24 {
                    let t = f64::from(k) / 24.0;
                    let u = 1.0 - t;
                    let q = [0, 1].map(|i| {
                        u * u * u * at[i]
                            + 3.0 * u * u * t * c1[i]
                            + 3.0 * u * t * t * c2[i]
                            + t * t * t * p[i]
                    });
                    contours.last_mut().expect("one").push(add(q));
                }
                at = p;
            }
            Verb::Close => {
                if let Some(first) = contours.last().and_then(|c| c.first().copied()) {
                    contours.last_mut().expect("one").push(first);
                    at = [first[0] - offset[0], first[1] - offset[1]];
                }
            }
        }
    }
    contours
}

impl IndexFrame {
    fn outline(&mut self, contours: &[Vec<[f64; 2]>], scale: f64) -> (u32, u32) {
        let first = self.edges.len() as u32;
        for c in contours {
            // A fill closes each contour.
            let mut pts: Vec<[i32; 2]> = c.iter().map(|p| fixed(*p, scale)).collect();
            if pts.first() != pts.last() {
                if let Some(p) = pts.first().copied() {
                    pts.push(p);
                }
            }
            for w in pts.windows(2) {
                self.edges.push([w[0][0], w[0][1], w[1][0], w[1][1]]);
            }
        }
        (first, self.edges.len() as u32 - first)
    }

    fn segments(&mut self, contours: &[Vec<[f64; 2]>], scale: f64) -> (u32, u32) {
        let first = self.edges.len() as u32;
        for c in contours {
            let pts: Vec<[i32; 2]> = c.iter().map(|p| fixed(*p, scale)).collect();
            for w in pts.windows(2) {
                self.edges.push([w[0][0], w[0][1], w[1][0], w[1][1]]);
            }
        }
        (first, self.edges.len() as u32 - first)
    }

    /// A stroke wider than a target pixel as one quad a segment.
    fn wide(&mut self, contours: &[Vec<[f64; 2]>], width: f64, scale: f64) -> (u32, u32) {
        let mut quads = Vec::new();
        for c in contours {
            for w in c.windows(2) {
                let (a, b) = (w[0], w[1]);
                let d = [b[0] - a[0], b[1] - a[1]];
                let len = (d[0] * d[0] + d[1] * d[1]).sqrt();
                if len == 0.0 {
                    continue;
                }
                let n = [-d[1] / len * width / 2.0, d[0] / len * width / 2.0];
                quads.push(vec![
                    [a[0] + n[0], a[1] + n[1]],
                    [b[0] + n[0], b[1] + n[1]],
                    [b[0] - n[0], b[1] - n[1]],
                    [a[0] - n[0], a[1] - n[1]],
                    [a[0] + n[0], a[1] + n[1]],
                ]);
            }
        }
        self.outline(&quads, scale)
    }
}

/// What a mark draws through its scopes: its opacity in 0..1.
fn alpha_of(d: &Drawn) -> f64 {
    let mut a: f64 = d
        .scopes
        .iter()
        .map(|s| match s {
            Scope::Opacity { alpha, .. } => *alpha,
            _ => 1.0,
        })
        .product();
    if let Mark::Shape {
        fill: Some((_, o)), ..
    } = &d.mark
    {
        a *= o;
    }
    if let Mark::Shape {
        fill: None,
        stroke: Some(l),
        ..
    } = &d.mark
    {
        a *= l.opacity;
    }
    a
}

/// The color a mark draws, for a mark whose item names no palette role.
fn color_of(d: &Drawn) -> Option<Rgb> {
    match &d.mark {
        Mark::Rect {
            fill: Fill::Solid(c),
            ..
        }
        | Mark::Shape {
            fill: Some((Fill::Solid(c), _)),
            ..
        } => Some(*c),
        Mark::Circle { color, .. } | Mark::Path { color, .. } | Mark::Text { color, .. } => {
            Some(*color)
        }
        Mark::Shape {
            stroke: Some(l), ..
        } => match l.paint {
            Fill::Solid(c) => Some(c),
            _ => None,
        },
        _ => None,
    }
}

/// The nearest palette index to `c`: shading picks through the palette, never past it.
fn nearest(palette: &[(String, Rgb)], c: Rgb) -> u16 {
    let d = |p: Rgb| {
        (0..3)
            .map(|i| (i32::from(p[i]) - i32::from(c[i])).pow(2))
            .sum::<i32>()
    };
    palette
        .iter()
        .enumerate()
        .min_by_key(|(_, (_, p))| d(*p))
        .map_or(0, |(i, _)| i as u16)
}

/// One frame of `ix` from its marks and evaluated items, each mark's index through its table.
pub(crate) fn frame(
    ix: &Indexed,
    marks: &[Arc<Drawn>],
    items: &Map<String, Value>,
    ground_role: &str,
    planted: Option<crate::Planted>,
) -> IndexFrame {
    let scale = f64::from(ix.scale);
    let mut f = IndexFrame {
        palette: ix
            .palette
            .iter()
            .enumerate()
            .map(|(i, (_, c))| {
                pack(*c)
                    | if ix.is_protected(i as u16) {
                        1 << 24
                    } else {
                        0
                    }
            })
            .collect(),
        ground: u32::from(ix.index_of(ground_role).unwrap_or(0)),
        size: ix.size,
        scale: ix.scale,
        light_max: u32::from(ix.light.unwrap_or(255)),
        ..IndexFrame::default()
    };
    f.flags = if ix.blend { FLAG_BLEND } else { 0 }
        | if ix.light.is_some() { FLAG_LIGHT } else { 0 }
        | match planted {
            Some(crate::Planted::PartialCoverage) => FLAG_PARTIAL,
            Some(crate::Planted::PuffFullOpacity) => FLAG_FULL_OPACITY,
            Some(crate::Planted::LightAfterUpscale) => FLAG_LIGHT_AFTER,
            _ => 0,
        };
    let mut tables: BTreeMap<&str, Option<Vec<u16>>> = BTreeMap::new();
    for d in marks {
        let id = d.mark.item();
        let item = items.get(id);
        let index = item
            .and_then(role_of)
            .and_then(|r| ix.index_of(r))
            .or_else(|| color_of(d).map(|c| nearest(&ix.palette, c)));
        let Some(index) = index else { continue };
        let table = tables
            .entry(table_of(items, id))
            .or_insert_with_key(|name| ix.table(name))
            .clone();
        let index = match table {
            Some(t) if !ix.is_protected(index) => t[index as usize],
            _ => index,
        };
        let additive = item.and_then(|i| i.get("blend")).and_then(Value::as_str) == Some("add");
        let light = if additive {
            pack(ix.palette[index as usize].1)
        } else {
            NO_LIGHT
        };
        let alpha = (alpha_of(d).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u32;
        let prim = |kind, (first, count): (u32, u32)| Prim {
            kind,
            index: u32::from(index),
            alpha,
            first,
            count,
            r: 0,
            r_inner: 0,
            light,
        };
        let rect = |b: [f64; 4]| {
            vec![vec![
                [b[0], b[1]],
                [b[0] + b[2], b[1]],
                [b[0] + b[2], b[1] + b[3]],
                [b[0], b[1] + b[3]],
                [b[0], b[1]],
            ]]
        };
        let made = match &d.mark {
            Mark::Rect { bounds, .. } | Mark::Image { bounds, .. } => {
                let c = rect(*bounds);
                Some(prim(0, f.outline(&c, scale)))
            }
            Mark::Circle {
                center, r, inner_r, ..
            } => {
                let c = fixed(*center, scale);
                f.edges.push([c[0], c[1], c[0], c[1]]);
                let mut p = prim(1, (f.edges.len() as u32 - 1, 1));
                p.r = (r / scale * ONE).round().max(0.0) as u32;
                p.r_inner = (inner_r / scale * ONE).round().max(0.0) as u32;
                Some(p)
            }
            Mark::Path {
                geometry, offset, ..
            } => {
                let contours = flatten(&geometry.verbs, *offset);
                match geometry.stroke {
                    Some(w) if w / scale <= 1.0 + 1e-9 => {
                        Some(prim(2, f.segments(&contours, scale)))
                    }
                    Some(w) => Some(prim(0, f.wide(&contours, w, scale))),
                    None => Some(prim(0, f.outline(&contours, scale))),
                }
            }
            Mark::Shape {
                verbs,
                fill,
                stroke,
                ..
            } => {
                let contours = flatten(verbs, [0.0, 0.0]);
                match (fill, stroke) {
                    (Some(_), _) => Some(prim(0, f.outline(&contours, scale))),
                    (None, Some(l)) if l.width / scale <= 1.0 + 1e-9 => {
                        Some(prim(2, f.segments(&contours, scale)))
                    }
                    (None, Some(l)) => Some(prim(0, f.wide(&contours, l.width, scale))),
                    (None, None) => None,
                }
            }
            // Text draws on the frame, not the index target.
            Mark::Text { .. } => None,
        };
        if let Some(p) = made {
            f.prims.push(p);
        }
    }
    f
}

/// A target a frame wrote, with its size.
pub(crate) type Written<T> = (T, [u32; 2]);

/// What a call reads back: the last frame's index target, once written.
#[derive(Clone, Default)]
pub(crate) struct IndexTap {
    pub buffer: Arc<Mutex<Option<Written<wgpu::Buffer>>>>,
}

/// The operator and the upscale on one device.
pub(crate) struct Indexer {
    index: wgpu::ComputePipeline,
    index_layout: wgpu::BindGroupLayout,
    up: Option<(wgpu::TextureFormat, wgpu::RenderPipeline)>,
    up_layout: wgpu::BindGroupLayout,
    up_module: wgpu::ShaderModule,
    up_pipeline_layout: wgpu::PipelineLayout,
}

fn storage(
    binding: u32,
    read_only: bool,
    visibility: wgpu::ShaderStages,
) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform(binding: u32, visibility: wgpu::ShaderStages) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl Indexer {
    pub fn new(device: &deep_gpu::counted::Wgpu) -> Self {
        let cs = wgpu::ShaderStages::COMPUTE;
        let index_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some(OPERATOR),
            entries: &[
                uniform(0, cs),
                storage(1, true, cs),
                storage(2, true, cs),
                storage(3, true, cs),
                storage(4, false, cs),
                storage(5, false, cs),
            ],
        });
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(OPERATOR),
            source: wgpu::ShaderSource::Wgsl(INDEX_SOURCE.into()),
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some(OPERATOR),
            bind_group_layouts: &[Some(&index_layout)],
            immediate_size: 0,
        });
        let index = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(OPERATOR),
            layout: Some(&layout),
            module: &module,
            entry_point: Some("index_main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let fs = wgpu::ShaderStages::FRAGMENT;
        let up_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("look.indexed upscale"),
            entries: &[
                uniform(0, fs),
                storage(1, true, fs),
                storage(2, true, fs),
                storage(3, true, fs),
                storage(4, true, fs),
            ],
        });
        let up_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("look.indexed upscale"),
            source: wgpu::ShaderSource::Wgsl(UP_SOURCE.into()),
        });
        let up_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("look.indexed upscale"),
            bind_group_layouts: &[Some(&up_layout)],
            immediate_size: 0,
        });
        Indexer {
            index,
            index_layout,
            up: None,
            up_layout,
            up_module,
            up_pipeline_layout,
        }
    }

    fn up(
        &mut self,
        device: &deep_gpu::counted::Wgpu,
        format: wgpu::TextureFormat,
    ) -> wgpu::RenderPipeline {
        if let Some((f, p)) = &self.up {
            if *f == format {
                return p.clone();
            }
        }
        let p = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("look.indexed upscale"),
            layout: Some(&self.up_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &self.up_module,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            fragment: Some(wgpu::FragmentState {
                module: &self.up_module,
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
        self.up = Some((format, p.clone()));
        p
    }

    /// Records the operator over `f` and the upscale into `target`; the index target's copy for
    /// reading back goes to `tap`.
    pub fn record(
        &mut self,
        device: &deep_gpu::counted::Wgpu,
        encoder: &mut wgpu::CommandEncoder,
        f: &IndexFrame,
        target: &wgpu::TextureView,
        format: wgpu::TextureFormat,
        tap: &IndexTap,
    ) {
        let [w, h] = f.size;
        let params = Params {
            w,
            h,
            prims: f.prims.len() as u32,
            ground: f.ground,
            flags: f.flags,
            light_max: f.light_max,
            scale: f.scale,
            palette: f.palette.len() as u32,
        };
        let init = |label, contents: &[u8], usage| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some(label),
                contents,
                usage,
            })
        };
        let st = wgpu::BufferUsages::STORAGE;
        let params = init(
            "indexed params",
            bytemuck::bytes_of(&params),
            wgpu::BufferUsages::UNIFORM,
        );
        let zero = Prim::zeroed();
        let prims = init(
            "indexed marks",
            bytemuck::cast_slice(if f.prims.is_empty() {
                std::slice::from_ref(&zero)
            } else {
                &f.prims
            }),
            st,
        );
        let edges = init(
            "indexed edges",
            bytemuck::cast_slice(if f.edges.is_empty() {
                &[[0i32; 4]][..]
            } else {
                &f.edges
            }),
            st,
        );
        let palette = init("indexed palette", bytemuck::cast_slice(&f.palette), st);
        let bytes = target_bytes([w, h]) / 2;
        let out = |label| {
            device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(label),
                size: bytes,
                usage: st | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            })
        };
        let (indices, resolved) = (out("indexed indices"), out("indexed resolved"));
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some(OPERATOR),
            layout: &self.index_layout,
            entries: &[&params, &prims, &edges, &palette, &indices, &resolved]
                .iter()
                .enumerate()
                .map(|(i, b)| wgpu::BindGroupEntry {
                    binding: i as u32,
                    resource: b.as_entire_binding(),
                })
                .collect::<Vec<_>>(),
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some(OPERATOR),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.index);
            pass.set_bind_group(0, &bind, &[]);
            pass.dispatch_workgroups(w.div_ceil(8), h.div_ceil(8), 1);
        }
        let read = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("indexed read back"),
            size: bytes,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        encoder.copy_buffer_to_buffer(&indices, 0, &read, 0, bytes);
        *tap.buffer.lock().unwrap_or_else(|e| e.into_inner()) = Some((read, f.size));
        let up = self.up(device, format);
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("look.indexed upscale"),
            layout: &self.up_layout,
            entries: &[&params, &resolved, &prims, &edges, &indices]
                .iter()
                .enumerate()
                .map(|(i, b)| wgpu::BindGroupEntry {
                    binding: i as u32,
                    resource: b.as_entire_binding(),
                })
                .collect::<Vec<_>>(),
        });
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("look.indexed upscale"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(&up);
        pass.set_bind_group(0, &bind, &[]);
        pass.draw(0..3, 0..1);
    }
}

/// The index target read back as u16 little-endian, rows top-down.
pub(crate) fn read_indices(
    device: &deep_gpu::counted::Wgpu,
    buffer: &wgpu::Buffer,
    size: [u32; 2],
) -> Result<Vec<u8>, String> {
    let w = size[0] as usize * 4;
    let words = crate::print2d::map_rows(device, buffer, w, w, size[1] as usize)?;
    Ok(words
        .as_chunks::<4>()
        .0
        .iter()
        .flat_map(|b| (u32::from_le_bytes(*b) as u16).to_le_bytes())
        .collect())
}

/// #465: the bytes of the GPU targets the indexed basis draws into at `size`: the index target
/// and the resolved colors (light rides in the index), a u32 per target pixel each.
pub fn target_bytes(size: [u32; 2]) -> u64 {
    2 * u64::from(size[0]) * u64::from(size[1]) * 4
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_operator_is_exact_and_both_shaders_validate() {
        for source in [super::INDEX_SOURCE, super::UP_SOURCE] {
            let module = naga::front::wgsl::parse_str(source)
                .unwrap_or_else(|e| panic!("{}", e.emit_to_string(source)));
            naga::valid::Validator::new(
                naga::valid::ValidationFlags::all(),
                naga::valid::Capabilities::empty(),
            )
            .validate(&module)
            .unwrap_or_else(|e| panic!("{}", e.emit_to_string(source)));
        }
        assert_eq!(super::class(), "exact");
    }
}
