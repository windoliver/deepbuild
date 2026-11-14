//! deep_show's 3D diagnostic views (issue #427; canvas primitives: Render-back: diagnostic modes):
//! the same evaluated scene at t drawn with a view in place of the look, on an offscreen copy of
//! its own, never the live surface. The views draw in the look's ground and ink, greys between
//! them, and one false-color ramp clear of every status color. Lighting only and luminance draw
//! the renderer's own frame (on white albedo, or through the ramp); the shadow atlas draws the
//! key sun's cascades as the renderer just drew them; the rest draw the scene's surfaces from the
//! same evaluated data in one depth-tested pass, overdraw in one additive pass, with the scene's
//! lines over them. Nothing here is a status color, and nothing here feeds a check.

use std::collections::BTreeMap;
use std::sync::Arc;

use bytemuck::{Pod, Zeroable};
use deep_canvas_scene3d::lod::Show;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Depth, Scene, Shape, Solid};
use deep_gpu::device::Device;
use deep_gpu::surface::FORMAT;

use crate::{bind_group, buffer_entry, read_texture, target, texture2d, Renderer};

const SHADER: &str = include_str!("diag.wgsl");
/// What a view counts per pixel: overdraw, lights reaching it, the cascade that holds it.
const VALUE: wgpu::TextureFormat = wgpu::TextureFormat::R16Float;
const MAX_LIGHTS: usize = 32;
/// Floats per surface vertex: position, normal, uv0, value and color.
const FLOATS: usize = 12;
/// Floats per line segment: both ends, color and width in px.
const LINE_FLOATS: usize = 10;
/// Overdraw at or past this many layers draws at the ramp's top.
const OVERDRAW_TOP: f32 = 8.0;

/// A diagnostic view.
#[derive(Clone, Debug, PartialEq)]
pub enum Diag {
    /// Surfaces flat-shaded in a grey between the look's ground and ink, under the scene's lines.
    Plain,
    /// The renderer's frame on a white albedo: only the light.
    LightingOnly,
    /// Fragments per pixel, depth ignored, through the ramp.
    Overdraw,
    /// Each surface pixel tinted by the key sun's cascade that holds it.
    CascadeSplits,
    /// The key sun's cascade maps as the renderer drew them, side by side.
    ShadowAtlas,
    /// The renderer's frame's luminance through the ramp.
    Luminance,
    /// Each surface pixel by how many shaded lights reach it: its cluster's list where the frame
    /// has a cluster grid.
    LightsPerCluster,
    /// Each item tinted by the level of detail the view chose for it.
    LodPerItem,
    /// Each item tinted by whether it casts and receives shadows.
    ReceiversCasters,
    /// A two-role checker of 8 cells per uv0 unit, marked along +u; `fit` (the planted
    /// `checker_fits_surface`) fits 8 × 8 cells to each surface's uv0 extent instead.
    UvChecker { fit: bool },
    /// Each listed item's per-vertex distances in m (its mesh's vertex order) through the ramp,
    /// from 0 to `top`.
    Deviation {
        per_vertex: Arc<BTreeMap<String, Vec<f32>>>,
        top: f64,
    },
}

/// What a view counted as it drew.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DiagCounts {
    /// The most fragments any pixel took (overdraw).
    pub max_overdraw: u32,
    /// The most shaded lights reaching any pixel (lights per cluster).
    pub max_lights_per_cluster: u32,
    /// The key sun's cascade split distances along the view axis, near plane first.
    pub cascade_splits: Vec<f64>,
    /// The key sun's cascades drawn.
    pub cascades: u32,
    /// Whether the frame draws those cascades. A frame of painted solids alone draws none (its
    /// sun keeps one fitted map the effects read), so the cascade view shows the splits the
    /// sun's cascade settings fit at this view, and says so here.
    pub cascaded: bool,
    /// Each leveled item's level, by stable ID (level of detail per item): its mesh level, or
    /// its band's rank (full 0, proxy 1, box 2, dot 3).
    pub levels: BTreeMap<String, u32>,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct LightU {
    pos: [f32; 4],
    dir: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Uniform {
    clip: [[f32; 4]; 4],
    eye: [f32; 4],
    forward: [f32; 4],
    light: [f32; 4],
    mode: [u32; 4],
    splits: [f32; 4],
    misc: [f32; 4],
    viewport: [f32; 4],
    ground: [f32; 4],
    ink: [f32; 4],
    lights: [LightU; MAX_LIGHTS],
}

/// The views' pipelines, made on first use and kept with the renderer.
pub(crate) struct Pipes {
    layout0: wgpu::BindGroupLayout,
    counts_layout: wgpu::BindGroupLayout,
    atlas_layout: wgpu::BindGroupLayout,
    solid: wgpu::RenderPipeline,
    count: wgpu::RenderPipeline,
    overdraw: wgpu::RenderPipeline,
    atlas: wgpu::RenderPipeline,
    line: wgpu::RenderPipeline,
}

fn attrs(formats: &[(u32, wgpu::VertexFormat)]) -> Vec<wgpu::VertexAttribute> {
    let mut offset = 0;
    formats
        .iter()
        .map(|&(location, format)| {
            let a = wgpu::VertexAttribute {
                format,
                offset,
                shader_location: location,
            };
            offset += format.size();
            a
        })
        .collect()
}

impl Pipes {
    fn new(d: &deep_gpu::counted::Wgpu) -> Pipes {
        let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("scene3d diag"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let both = wgpu::ShaderStages::VERTEX | wgpu::ShaderStages::FRAGMENT;
        let layout0 = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d diag"),
            entries: &[
                buffer_entry(0, both, wgpu::BufferBindingType::Uniform),
                buffer_entry(
                    1,
                    wgpu::ShaderStages::FRAGMENT,
                    wgpu::BufferBindingType::Storage { read_only: true },
                ),
            ],
        });
        let texture = |binding, sample_type, view_dimension| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type,
                view_dimension,
                multisampled: false,
            },
            count: None,
        };
        let counts_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d diag counts"),
            entries: &[texture(
                0,
                wgpu::TextureSampleType::Float { filterable: false },
                wgpu::TextureViewDimension::D2,
            )],
        });
        let atlas_layout = d.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("scene3d diag atlas"),
            entries: &[texture(
                1,
                wgpu::TextureSampleType::Depth,
                wgpu::TextureViewDimension::D2Array,
            )],
        });
        let layout = |groups: &[Option<&wgpu::BindGroupLayout>]| {
            d.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("scene3d diag"),
                bind_group_layouts: groups,
                immediate_size: 0,
            })
        };
        let solo = layout(&[Some(&layout0)]);
        let counts = layout(&[Some(&layout0), Some(&counts_layout)]);
        let atlas_pl = layout(&[Some(&layout0), Some(&atlas_layout)]);
        let surface_attrs = attrs(&[
            (0, wgpu::VertexFormat::Float32x3),
            (1, wgpu::VertexFormat::Float32x3),
            (2, wgpu::VertexFormat::Float32x2),
            (3, wgpu::VertexFormat::Float32),
            (4, wgpu::VertexFormat::Float32x3),
        ]);
        let surface = [Some(wgpu::VertexBufferLayout {
            array_stride: (FLOATS * 4) as u64,
            step_mode: wgpu::VertexStepMode::Vertex,
            attributes: &surface_attrs,
        })];
        let line_attrs = attrs(&[
            (0, wgpu::VertexFormat::Float32x3),
            (1, wgpu::VertexFormat::Float32x3),
            (2, wgpu::VertexFormat::Float32x3),
            (3, wgpu::VertexFormat::Float32),
        ]);
        let line_buffers = [Some(wgpu::VertexBufferLayout {
            array_stride: (LINE_FLOATS * 4) as u64,
            step_mode: wgpu::VertexStepMode::Instance,
            attributes: &line_attrs,
        })];
        let depth = |write: bool, compare| {
            Some(wgpu::DepthStencilState {
                format: crate::DEPTH,
                depth_write_enabled: Some(write),
                depth_compare: Some(compare),
                stencil: Default::default(),
                bias: Default::default(),
            })
        };
        let value_none = Some(wgpu::ColorTargetState {
            format: VALUE,
            blend: None,
            write_mask: wgpu::ColorWrites::empty(),
        });
        let make = |label: &str,
                    layout: &wgpu::PipelineLayout,
                    vs: &str,
                    buffers: &[Option<wgpu::VertexBufferLayout<'_>>],
                    fs: &str,
                    targets: &[Option<wgpu::ColorTargetState>],
                    depth_stencil: Option<wgpu::DepthStencilState>| {
            crate::pipeline(
                d,
                label,
                Some(layout),
                &module,
                (vs, buffers),
                Some((fs, targets)),
                depth_stencil,
            )
        };
        let solid = make(
            "scene3d diag solids",
            &solo,
            "solid_vs",
            &surface,
            "solid_fs",
            &[target(FORMAT, None), target(VALUE, None)],
            depth(true, wgpu::CompareFunction::Greater),
        );
        let add = wgpu::BlendState {
            color: wgpu::BlendComponent {
                src_factor: wgpu::BlendFactor::One,
                dst_factor: wgpu::BlendFactor::One,
                operation: wgpu::BlendOperation::Add,
            },
            alpha: wgpu::BlendComponent::REPLACE,
        };
        let count = make(
            "scene3d diag overdraw count",
            &solo,
            "solid_vs",
            &surface,
            "count_fs",
            &[target(VALUE, Some(add))],
            None,
        );
        let overdraw = make(
            "scene3d diag overdraw",
            &counts,
            "full_vs",
            &[],
            "overdraw_fs",
            &[target(FORMAT, None)],
            None,
        );
        let atlas = make(
            "scene3d diag shadow atlas",
            &atlas_pl,
            "full_vs",
            &[],
            "atlas_fs",
            &[target(FORMAT, None)],
            None,
        );
        let line = make(
            "scene3d diag lines",
            &solo,
            "line_vs",
            &line_buffers,
            "line_fs",
            &[target(FORMAT, None), value_none],
            depth(false, wgpu::CompareFunction::Always),
        );
        Pipes {
            layout0,
            counts_layout,
            atlas_layout,
            solid,
            count,
            overdraw,
            atlas,
            line,
        }
    }
}

/// An sRGB byte color as the shader writes it.
fn rgb(c: [u8; 3]) -> [f32; 4] {
    [
        f32::from(c[0]) / 255.0,
        f32::from(c[1]) / 255.0,
        f32::from(c[2]) / 255.0,
        1.0,
    ]
}

fn mix(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 3] {
    [0, 1, 2].map(|k| a[k] + (b[k] - a[k]) * t)
}

/// The look's ink: its `ink` role, or black on a light ground and white on a dark one.
fn ink(look: &Look3) -> [u8; 3] {
    look.role("ink").unwrap_or_else(|| {
        let g = look.ground;
        if u32::from(g[0]) + u32::from(g[1]) + u32::from(g[2]) > 382 {
            [0x1c; 3]
        } else {
            [0xe8; 3]
        }
    })
}

/// The ramp's color at `t` (0 to 1), as `diag.wgsl`'s `ramp`.
pub fn ramp(t: f64) -> [f64; 3] {
    const STOPS: [[f64; 3]; 5] = [
        [68.0, 1.0, 84.0],
        [59.0, 82.0, 139.0],
        [33.0, 145.0, 140.0],
        [94.0, 201.0, 98.0],
        [253.0, 231.0, 37.0],
    ];
    let x = t.clamp(0.0, 1.0) * 4.0;
    let i = (x.floor() as usize).min(3);
    let f = x - i as f64;
    [0, 1, 2].map(|k| (STOPS[i][k] + (STOPS[i + 1][k] - STOPS[i][k]) * f) / 255.0)
}

/// A solid's vertices in its own space: position, normal, uv0; and its triangles.
fn local(solid: &Solid) -> (Vec<[f32; 8]>, Vec<u32>) {
    if let Some(m) = &solid.mesh {
        let v = (0..m.positions.len())
            .map(|i| {
                let p = m.positions[i];
                let n = m.normals.get(i).copied().unwrap_or([0.0, 1.0, 0.0]);
                let uv = m.uv0.get(i).copied().unwrap_or([0.0, 0.0]);
                [p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]].map(|x| x as f32)
            })
            .collect();
        return (v, m.indices.clone());
    }
    let shape = match solid.shape {
        Shape::Built(_) => return (Vec::new(), Vec::new()),
        s => s,
    };
    let (v, i) = crate::mesh::geometry(shape);
    let v = v
        .as_chunks::<{ crate::mesh::FLOATS }>()
        .0
        .iter()
        .map(|c| [c[0], c[1], c[2], c[3], c[4], c[5], c[7], c[8]])
        .collect();
    (v, i)
}

/// The 3×3 cofactor matrix of the model's linear part, which carries normals.
fn cofactor(m: &[[f64; 4]; 3]) -> [[f64; 3]; 3] {
    let a = |r: usize, c: usize| m[r][c];
    std::array::from_fn(|r| {
        std::array::from_fn(|c| {
            let (r1, r2) = ((r + 1) % 3, (r + 2) % 3);
            let (c1, c2) = ((c + 1) % 3, (c + 2) % 3);
            a(r1, c1) * a(r2, c2) - a(r1, c2) * a(r2, c1)
        })
    })
}

/// Each surface's world triangles as the view colors them, with the scene's lines.
struct Geometry {
    vertices: Vec<f32>,
    lines: Vec<f32>,
}

#[allow(clippy::too_many_lines)]
fn geometry(scene: &Scene, diag: &Diag, levels: &BTreeMap<String, u32>, look: &Look3) -> Geometry {
    let (ground, ink) = (rgb(look.ground), rgb(ink(look)));
    let grey = mix(ground, ink, 0.35);
    let tint = |t: f64| ramp(t).map(|x| x as f32);
    let mut vertices = Vec::new();
    for layer in &scene.layers {
        for s in &layer.solids {
            if s.cast_only || s.mask.is_some_and(|m| m.lower) {
                continue;
            }
            let color = match diag {
                Diag::LodPerItem => levels
                    .get(&s.id)
                    .map_or(grey, |&l| tint(f64::from(l.min(3)) / 3.0)),
                Diag::ReceiversCasters => match (s.cast_shadow, s.receive_shadow) {
                    (true, true) => tint(0.5),
                    (true, false) => tint(0.0),
                    (false, true) => tint(1.0),
                    (false, false) => grey,
                },
                _ => grey,
            };
            let (mut local, indices) = local(s);
            if matches!(diag, Diag::UvChecker { fit: true }) && !local.is_empty() {
                // The planted checker: each surface's own uv0 extent, stretched to one unit.
                let (mut lo, mut hi) = ([f32::MAX; 2], [f32::MIN; 2]);
                for v in &local {
                    for k in 0..2 {
                        lo[k] = lo[k].min(v[6 + k]);
                        hi[k] = hi[k].max(v[6 + k]);
                    }
                }
                for v in &mut local {
                    for k in 0..2 {
                        v[6 + k] = (v[6 + k] - lo[k]) / (hi[k] - lo[k]).max(1e-12);
                    }
                }
            }
            let values = match diag {
                Diag::Deviation { per_vertex, .. } => per_vertex.get(&s.id),
                _ => None,
            };
            let m = &s.model;
            let cof = cofactor(m);
            let world = |p: [f32; 8]| -> [f32; 6] {
                let p64 = [f64::from(p[0]), f64::from(p[1]), f64::from(p[2])];
                let n64 = [f64::from(p[3]), f64::from(p[4]), f64::from(p[5])];
                let w = [0, 1, 2]
                    .map(|r| m[r][0] * p64[0] + m[r][1] * p64[1] + m[r][2] * p64[2] + m[r][3]);
                let n =
                    [0, 1, 2].map(|r| cof[r][0] * n64[0] + cof[r][1] * n64[1] + cof[r][2] * n64[2]);
                let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-12);
                [w[0], w[1], w[2], n[0] / l, n[1] / l, n[2] / l].map(|x| x as f32)
            };
            for &i in &indices {
                let Some(&p) = local.get(i as usize) else {
                    continue;
                };
                let w = world(p);
                let value = values
                    .and_then(|v| v.get(i as usize))
                    .copied()
                    .unwrap_or(-1.0);
                vertices.extend_from_slice(&w);
                vertices.extend_from_slice(&[p[6], p[7], value]);
                vertices.extend_from_slice(&color);
            }
        }
    }
    // The scene's lines, each segment clipped to the part in front of the near plane.
    let cam = &scene.camera;
    let near = cam.near.max(1e-4) * 1.01;
    let mut lines = Vec::new();
    for layer in &scene.layers {
        for line in &layer.lines {
            let segments = match &line.edges {
                Some(e) => e.segments(true),
                None => line.segments.clone(),
            };
            let color = rgb(line.color);
            for seg in segments {
                let (mut a, mut b) = (seg.a, seg.b);
                if cam.perspective {
                    let (za, zb) = (cam.to_view(a)[2], cam.to_view(b)[2]);
                    if za < near && zb < near {
                        continue;
                    }
                    let cut = |p: [f64; 3], q: [f64; 3], zp: f64, zq: f64| {
                        let t = (near - zp) / (zq - zp);
                        [0, 1, 2].map(|k| p[k] + (q[k] - p[k]) * t)
                    };
                    if za < near {
                        a = cut(a, b, za, zb);
                    } else if zb < near {
                        b = cut(b, a, zb, za);
                    }
                }
                let width = if line.world {
                    1.5
                } else {
                    seg.wa.max(seg.wb).clamp(1.0, 3.0)
                };
                lines.extend(a.iter().chain(&b).map(|x| *x as f32));
                lines.extend_from_slice(&color[..3]);
                lines.push(width as f32);
            }
        }
    }
    Geometry { vertices, lines }
}

/// The scene as the renderer would draw it at this view: leveled items resolved to their choice,
/// and each one's level.
fn resolved(scene: &Scene) -> (Scene, BTreeMap<String, u32>) {
    let mut levels = BTreeMap::new();
    if !crate::leveled(scene) {
        return (scene.clone(), levels);
    }
    let mut chosen = scene.clone();
    let choices = deep_canvas_scene3d::lod::select(&chosen);
    for c in &choices {
        let rank = match c.bands.first() {
            Some(Show::Full) | None => 0,
            Some(Show::Proxy) => 1,
            Some(Show::Box) => 2,
            Some(_) => 3,
        };
        levels.insert(c.item.clone(), c.level.map_or(rank, |l| l as u32));
    }
    deep_canvas_scene3d::lod::resolve(&mut chosen, &choices);
    (chosen, levels)
}

/// The scene on a white albedo: every solid's paint and material base white, its maps, pattern,
/// operator and emission gone, so the frame shows only the light.
fn white(scene: &Scene) -> Scene {
    let mut s = scene.clone();
    for layer in &mut s.layers {
        for solid in &mut layer.solids {
            solid.color = [255; 3];
            solid.emission = [0.0; 3];
            solid.maps = None;
            solid.op = None;
            solid.adjust = None;
            if let Some(m) = &mut solid.material {
                m.base = [1.0, 1.0, 1.0, m.base[3]];
                m.emission = [0.0; 3];
                m.pattern = 0;
            }
        }
    }
    s
}

/// sRGB byte to linear.
fn linear(b: u8) -> f64 {
    let c = f64::from(b) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// A frame's luminance through the ramp: the encoded luminance (0 black, 1 white) picks the
/// color. `bgra` is the slot's BGRA8.
fn luminance(bgra: &mut [u8]) {
    for p in bgra.as_chunks_mut::<4>().0 {
        let y = 0.2126 * linear(p[2]) + 0.7152 * linear(p[1]) + 0.0722 * linear(p[0]);
        let encoded = if y <= 0.003_130_8 {
            12.92 * y
        } else {
            1.055 * y.powf(1.0 / 2.4) - 0.055
        };
        let c = ramp(encoded);
        p[2] = (c[0] * 255.0).round() as u8;
        p[1] = (c[1] * 255.0).round() as u8;
        p[0] = (c[2] * 255.0).round() as u8;
        p[3] = 255;
    }
}

/// An f16's value.
fn half(bits: u16) -> f32 {
    let (sign, exp, frac) = (bits >> 15, (bits >> 10) & 0x1f, bits & 0x3ff);
    let v = match exp {
        0 => f32::from(frac) * 2f32.powi(-24),
        31 => f32::INFINITY,
        e => (1.0 + f32::from(frac) / 1024.0) * 2f32.powi(i32::from(e) - 15),
    };
    if sign == 1 {
        -v
    } else {
        v
    }
}

/// The largest value in an R16Float texture.
fn max_value(device: &Device, texture: &wgpu::Texture, size: [u32; 2]) -> u32 {
    read_texture(device, texture, size, 2).map_or(0, |b| {
        b.as_chunks::<2>()
            .0
            .iter()
            .map(|c| half(u16::from_le_bytes(*c)))
            .fold(0f32, f32::max)
            .round() as u32
    })
}

/// `scene` drawn in `diag`'s view, as [`crate::draw_offscreen`] draws it: the slot's BGRA8 rows,
/// top-down, with what the view counted. `None` where the device can't read back.
pub fn draw_offscreen_diag(
    device: &Device,
    renderer: &mut Renderer,
    scene: &Scene,
    look: &Look3,
    diag: &Diag,
) -> Option<(Vec<u8>, DiagCounts)> {
    deep_gpu::alloc::outside(|| draw(device, renderer, scene, look, diag))
}

#[allow(clippy::too_many_lines)]
fn draw(
    device: &Device,
    renderer: &mut Renderer,
    scene: &Scene,
    look: &Look3,
    diag: &Diag,
) -> Option<(Vec<u8>, DiagCounts)> {
    let mut counts = DiagCounts::default();
    match diag {
        Diag::LightingOnly => {
            // The light alone, exposed so the key sun on a white surface facing it reads just
            // under white: a look at unit exposure would clip a daylight sun everywhere.
            let mut lit = look.clone();
            if let Some(sun) = scene.sun.as_ref().filter(|s| s.illuminance > 0.0) {
                lit.exposure = lit
                    .exposure
                    .min(0.8 * std::f64::consts::PI / sun.illuminance);
            }
            let bytes = crate::draw_offscreen(device, renderer, &white(scene), &lit, None)?;
            return Some((bytes, counts));
        }
        Diag::Luminance => {
            let mut bytes = crate::draw_offscreen(device, renderer, scene, look, None)?;
            luminance(&mut bytes);
            return Some((bytes, counts));
        }
        _ => {}
    }
    let (chosen, levels) = resolved(scene);
    counts.levels.clone_from(&levels);
    // The renderer's own cascades at this view; the shadow atlas draws them as it drew them.
    if matches!(diag, Diag::ShadowAtlas) {
        crate::draw_offscreen(device, renderer, scene, look, None)?;
    } else {
        renderer.prepare(device, scene, look);
    }
    counts
        .cascade_splits
        .clone_from(&renderer.counts().cascade_splits);
    counts.cascaded = !counts.cascade_splits.is_empty();
    if matches!(diag, Diag::CascadeSplits) && counts.cascade_splits.is_empty() {
        if let Some(sun) = scene
            .sun
            .as_ref()
            .filter(|s| s.shadow && scene.camera.perspective)
        {
            let fitted = crate::shadow::cascades(
                scene,
                sun.toward,
                &sun.cascades,
                crate::shadow::SIZE,
                None,
                true,
            );
            if let Some(first) = fitted.first() {
                counts.cascade_splits = std::iter::once(first.near)
                    .chain(fitted.iter().map(|k| k.far))
                    .collect();
            }
        }
    }
    counts.cascades = counts.cascade_splits.len().saturating_sub(1) as u32;

    let d = &device.device;
    let pipes = renderer.diag.get_or_insert_with(|| Box::new(Pipes::new(d)));
    let size = scene.size;
    let cam = &chosen.camera;
    let rows = cam.clip(Depth::Reversed);
    let mut clip = [[0f32; 4]; 4];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            clip[c][r] = *v as f32;
        }
    }
    let toward = chosen.sun.as_ref().map_or_else(
        || {
            let f = cam.forward;
            let u = cam.up;
            let v = [u[0] - f[0], u[1] - f[1], u[2] - f[2]];
            let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-12);
            v.map(|x| x / l)
        },
        |s| s.toward,
    );
    let policy = chosen
        .light_cut
        .clone()
        .unwrap_or_else(|| deep_canvas_scene3d::light::policy(&chosen.lights, cam));
    let mut lights = [LightU::zeroed(); MAX_LIGHTS];
    let mut n = 0;
    for &(i, _) in policy.shaded.iter().take(MAX_LIGHTS) {
        let l = &chosen.lights[i];
        let everywhere = !l.range.is_finite()
            || matches!(
                l.kind,
                deep_canvas_scene3d::light::LightKind::Sun
                    | deep_canvas_scene3d::light::LightKind::Area
            );
        let cone = if matches!(l.kind, deep_canvas_scene3d::light::LightKind::Spot) {
            l.cone[0]
        } else {
            -2.0
        };
        lights[n] = LightU {
            pos: [
                l.pos[0] as f32,
                l.pos[1] as f32,
                l.pos[2] as f32,
                if everywhere { -1.0 } else { l.range as f32 },
            ],
            dir: [
                l.dir[0] as f32,
                l.dir[1] as f32,
                l.dir[2] as f32,
                cone as f32,
            ],
        };
        n += 1;
    }
    let grid = deep_canvas_scene3d::clusters::grid(&chosen.lights, &policy, cam, size);
    let splits = &counts.cascade_splits;
    let mut split4 = [0f32; 4];
    for (k, s) in splits.iter().skip(1).take(4).enumerate() {
        split4[k] = *s as f32;
    }
    let mode = match diag {
        Diag::Plain | Diag::Overdraw | Diag::ShadowAtlas | Diag::LightingOnly | Diag::Luminance => {
            0
        }
        Diag::CascadeSplits => 2,
        Diag::LightsPerCluster => 3,
        Diag::LodPerItem | Diag::ReceiversCasters => 4,
        Diag::UvChecker { .. } => 6,
        Diag::Deviation { .. } => 7,
    };
    let top = match diag {
        Diag::Deviation { top, .. } => *top,
        _ => 0.0,
    };
    let uniform = Uniform {
        clip,
        eye: [
            cam.eye[0] as f32,
            cam.eye[1] as f32,
            cam.eye[2] as f32,
            cam.near as f32,
        ],
        forward: [
            cam.forward[0] as f32,
            cam.forward[1] as f32,
            cam.forward[2] as f32,
            0.0,
        ],
        light: [toward[0] as f32, toward[1] as f32, toward[2] as f32, 0.0],
        mode: [
            mode,
            n as u32,
            counts.cascades.min(4),
            u32::from(grid.is_some()),
        ],
        splits: split4,
        misc: [
            top as f32,
            grid.as_ref().map_or(1.0, |g| g.far as f32),
            cam.near.max(1e-3) as f32,
            OVERDRAW_TOP,
        ],
        viewport: [size[0] as f32, size[1] as f32, 0.0, 0.0],
        ground: rgb(look.ground),
        ink: rgb(ink(look)),
        lights,
    };
    let uniform_buffer = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("scene3d diag"),
        contents: bytemuck::bytes_of(&uniform),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let cells: Vec<u32> = grid.map_or_else(|| vec![0], |g| g.cells);
    let grid_buffer = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("scene3d diag grid"),
        contents: bytemuck::cast_slice(&cells),
        usage: wgpu::BufferUsages::STORAGE,
    });
    let bind0 = bind_group(
        d,
        "scene3d diag",
        &pipes.layout0,
        [
            uniform_buffer.as_entire_binding(),
            grid_buffer.as_entire_binding(),
        ],
    );

    let geo = geometry(&chosen, diag, &levels, look);
    let vertex_count = (geo.vertices.len() / FLOATS) as u32;
    let line_count = (geo.lines.len() / LINE_FLOATS) as u32;
    let buffer = |label, data: &[f32]| {
        d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: if data.is_empty() {
                &[0u8; 16]
            } else {
                bytemuck::cast_slice(data)
            },
            usage: wgpu::BufferUsages::VERTEX,
        })
    };
    let vertices = buffer("scene3d diag vertices", &geo.vertices);
    let segments = buffer("scene3d diag lines", &geo.lines);

    let color = texture2d(
        d,
        "scene3d diag",
        size,
        FORMAT,
        wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
    );
    let value = texture2d(
        d,
        "scene3d diag value",
        size,
        VALUE,
        wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::TEXTURE_BINDING,
    );
    let depth = texture2d(
        d,
        "scene3d diag depth",
        size,
        crate::DEPTH,
        wgpu::TextureUsages::RENDER_ATTACHMENT,
    );
    let (color_view, value_view, depth_view) = (
        color.create_view(&Default::default()),
        value.create_view(&Default::default()),
        depth.create_view(&Default::default()),
    );
    let ground = rgb(look.ground);
    let clear = wgpu::Color {
        r: f64::from(ground[0]),
        g: f64::from(ground[1]),
        b: f64::from(ground[2]),
        a: 1.0,
    };
    let attachment = |view, load| {
        Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            depth_slice: None,
            ops: wgpu::Operations {
                load,
                store: wgpu::StoreOp::Store,
            },
        })
    };
    let mut encoder = d.create_command_encoder(&Default::default());
    match diag {
        Diag::Overdraw => {
            {
                let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("scene3d diag overdraw count"),
                    color_attachments: &[attachment(
                        &value_view,
                        wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    )],
                    ..Default::default()
                });
                pass.set_pipeline(&pipes.count);
                pass.set_bind_group(0, &bind0, &[]);
                pass.set_vertex_buffer(0, vertices.slice(..));
                pass.draw(0..vertex_count, 0..1);
            }
            let layout = &pipes.counts_layout;
            let bind1 = bind_group(
                d,
                "scene3d diag counts",
                layout,
                [wgpu::BindingResource::TextureView(&value_view)],
            );
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d diag overdraw"),
                color_attachments: &[attachment(&color_view, wgpu::LoadOp::Clear(clear))],
                ..Default::default()
            });
            pass.set_pipeline(&pipes.overdraw);
            pass.set_bind_group(0, &bind0, &[]);
            pass.set_bind_group(1, &bind1, &[]);
            pass.draw(0..3, 0..1);
        }
        Diag::ShadowAtlas => {
            // The cascades' layers; a frame without cascades shows none.
            let view = match &renderer.cascaded.texture {
                Some((all, _)) if !renderer.cascaded.list.is_empty() => all.clone(),
                _ => d
                    .create_texture(&wgpu::TextureDescriptor {
                        label: Some("scene3d diag atlas stub"),
                        size: wgpu::Extent3d {
                            width: 1,
                            height: 1,
                            depth_or_array_layers: 1,
                        },
                        mip_level_count: 1,
                        sample_count: 1,
                        dimension: wgpu::TextureDimension::D2,
                        format: crate::shadow::FORMAT,
                        usage: wgpu::TextureUsages::TEXTURE_BINDING,
                        view_formats: &[],
                    })
                    .create_view(&wgpu::TextureViewDescriptor {
                        dimension: Some(wgpu::TextureViewDimension::D2Array),
                        ..Default::default()
                    }),
            };
            let bind1 = d.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("scene3d diag atlas"),
                layout: &pipes.atlas_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&view),
                }],
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d diag shadow atlas"),
                color_attachments: &[attachment(&color_view, wgpu::LoadOp::Clear(clear))],
                ..Default::default()
            });
            pass.set_pipeline(&pipes.atlas);
            pass.set_bind_group(0, &bind0, &[]);
            pass.set_bind_group(1, &bind1, &[]);
            pass.draw(0..3, 0..1);
        }
        _ => {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("scene3d diag solids"),
                color_attachments: &[
                    attachment(&color_view, wgpu::LoadOp::Clear(clear)),
                    attachment(&value_view, wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT)),
                ],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                ..Default::default()
            });
            pass.set_pipeline(&pipes.solid);
            pass.set_bind_group(0, &bind0, &[]);
            pass.set_vertex_buffer(0, vertices.slice(..));
            pass.draw(0..vertex_count, 0..1);
        }
    }
    // The scene's lines over the view.
    if line_count > 0 && !matches!(diag, Diag::ShadowAtlas) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("scene3d diag lines"),
            color_attachments: &[
                attachment(&color_view, wgpu::LoadOp::Load),
                attachment(&value_view, wgpu::LoadOp::Load),
            ],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Clear(0.0),
                    store: wgpu::StoreOp::Discard,
                }),
                stencil_ops: None,
            }),
            ..Default::default()
        });
        pass.set_pipeline(&pipes.line);
        pass.set_bind_group(0, &bind0, &[]);
        pass.set_vertex_buffer(0, segments.slice(..));
        pass.draw(0..6, 0..line_count);
    }
    device.queue.submit([encoder.finish()]);
    match diag {
        Diag::Overdraw => counts.max_overdraw = max_value(device, &value, size),
        Diag::LightsPerCluster => counts.max_lights_per_cluster = max_value(device, &value, size),
        _ => {}
    }
    let bytes = read_texture(device, &color, size, 4)?;
    Some((bytes, counts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas_scene3d::scene::{evaluate, Labels};
    use deep_gpu::device::{Backend, Gpu};
    use serde_json::json;

    fn look() -> Look3 {
        Look3::read(&json!({"roles": {"ink": "#202020", "ground": "#ffffff"}})).unwrap()
    }

    /// One mark box, its mesh swapped for a 2 × 1 m plate whose uv0 runs in metres.
    fn plate_scene() -> Scene {
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "size": [320, 160], "camera": "cam",
            "layers": {"main": {"writer": "w", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "name": "C", "order": "a0", "layer": "main", "params": {"projection": "perspective", "target": [0, 0, 0], "orbit": {"azimuth": 0, "elevation": 0, "distance": 4}, "fov": 40}},
                "plate": {"id": "plate", "kind": "mark.box@1", "name": "P", "order": "a1", "layer": "main", "params": {"size": 1, "paint": {"fill": {"role": "ink"}}}}
            }
        });
        let mut scene = evaluate(&doc, 0, &look(), &mut Labels::new()).unwrap();
        let mesh = deep_canvas_scene3d::geom::Mesh {
            positions: vec![
                [-1.0, -0.5, 0.0],
                [1.0, -0.5, 0.0],
                [1.0, 0.5, 0.0],
                [-1.0, 0.5, 0.0],
            ],
            normals: vec![[0.0, 0.0, 1.0]; 4],
            uv0: vec![[0.0, 0.0], [2.0, 0.0], [2.0, 1.0], [0.0, 1.0]],
            indices: vec![0, 1, 2, 0, 2, 3],
            ..Default::default()
        };
        let solid = &mut scene.layers[0].solids[0];
        solid.shape = Shape::Built(1);
        solid.mesh = Some(Arc::new(mesh));
        solid.model = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ];
        scene
    }

    /// The checker's cells across the drawn surface: 8 per uv0 unit over its uv0 extent.
    fn cells(fit: bool) -> [u32; 2] {
        let g = geometry(
            &plate_scene(),
            &Diag::UvChecker { fit },
            &BTreeMap::new(),
            &look(),
        );
        let mut hi = [f32::MIN; 2];
        let mut lo = [f32::MAX; 2];
        for v in g.vertices.as_chunks::<FLOATS>().0 {
            for k in 0..2 {
                hi[k] = hi[k].max(v[6 + k]);
                lo[k] = lo[k].min(v[6 + k]);
            }
        }
        [0, 1].map(|k| ((hi[k] - lo[k]) * 8.0).round() as u32)
    }

    #[test]
    fn the_checker_draws_8_cells_per_uv0_unit_and_the_planted_fit_8_by_8() {
        assert_eq!(cells(false), [16, 8], "a 2 × 1 m plate with uv0 in metres");
        assert_eq!(cells(true), [8, 8], "the planted checker_fits_surface");
    }

    /// The clean look's status colors (crates/deep-canvas-marks/looks/clean.json).
    const STATUS: [[f64; 3]; 4] = [
        [0.0, 116.0, 41.0],
        [191.0, 35.0, 43.0],
        [134.0, 69.0, 176.0],
        [0.0, 99.0, 184.0],
    ];

    #[test]
    fn the_ramp_never_comes_within_a_few_levels_of_a_status_color() {
        for i in 0..=4096 {
            let c = ramp(f64::from(i) / 4096.0).map(|x| x * 255.0);
            // Shaded down as the surface views shade it, too.
            for k in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5] {
                for s in STATUS {
                    let near = (0..3).all(|j| (c[j] * k - s[j]).abs() <= 4.0);
                    assert!(
                        !near,
                        "ramp({i}/4096) × {k} = {c:?} is a status color {s:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn every_view_draws_on_a_device() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let mut renderer = Renderer::new(&device, crate::Planted::default());
        let scene = plate_scene();
        let per_vertex = Arc::new(BTreeMap::from([(
            "plate".to_string(),
            vec![0.0, 0.1, 0.2, 0.3],
        )]));
        for diag in [
            Diag::Plain,
            Diag::LightingOnly,
            Diag::Overdraw,
            Diag::CascadeSplits,
            Diag::ShadowAtlas,
            Diag::Luminance,
            Diag::LightsPerCluster,
            Diag::LodPerItem,
            Diag::ReceiversCasters,
            Diag::UvChecker { fit: false },
            Diag::Deviation {
                per_vertex,
                top: 0.3,
            },
        ] {
            let drawn = draw_offscreen_diag(&device, &mut renderer, &scene, &look(), &diag);
            let (bytes, _) = drawn.unwrap_or_else(|| panic!("{diag:?} drew nothing"));
            assert_eq!(bytes.len(), 320 * 160 * 4, "{diag:?}");
        }
    }
}
