//! The line, point, text and puff instance records (issue #378), each beside its attribute list:
//! a record's fields, its list's offsets and formats and the shader's inputs at the list's
//! locations are one layout (#3256).

use bytemuck::{Pod, Zeroable};

deep_gpu::paired! { segment_record:
    SEGMENT => "outline.wgsl", outline_vs; LINE => "scene3d.wgsl", line_vs;
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct SegmentRecord {
    pub(crate) a: [f32; 4],
    pub(crate) b: [f32; 4],
    pub(crate) color: u32,
    pub(crate) pick: u32,
    pub(crate) flags: u32,
    /// A mesh-edge line's dash and gap in its size space, as two f16 (#1640), or 0.
    pub(crate) dash: u32,
    /// Its alpha at each end, as two f16: a trail's fade (#450), else 1 and 1.
    pub(crate) fade: u32,
}
}

pub(crate) const SEGMENT: [wgpu::VertexAttribute; 5] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Uint32, 3 => Uint32, 4 => Uint32
];
/// A line's segment records, with its dash (#1640).
pub(crate) const LINE: [wgpu::VertexAttribute; 7] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Uint32, 3 => Uint32, 4 => Uint32, 5 => Uint32, 6 => Uint32
];

deep_gpu::paired! { point_record: POINT => "scene3d_labels_sky.wgsl", point_vs { pad: _ };
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct PointRecord {
    pub(crate) p: [f32; 4],
    pub(crate) color: u32,
    pub(crate) pick: u32,
    pub(crate) flags: u32,
    pub(crate) pad: u32,
}
}

pub(crate) const POINT: [wgpu::VertexAttribute; 4] =
    wgpu::vertex_attr_array![0 => Float32x4, 1 => Uint32, 2 => Uint32, 3 => Uint32];

deep_gpu::paired! { text_record:
    TEXT => "scene3d_labels_sky.wgsl", text_vs { right: ax_r, up: ax_u, pad: _ };
    TEXT => "label.wgsl", label_vs { right: ax_r, up: ax_u, pad: _ };
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
/// One glyph of a label: the label's anchor and em, the glyph's quad from the label's centre in
/// ems (x right, y down), its texels on its atlas page, the label's axes (each `w` the fraction
/// of half its box on that axis, for the label pass), and `flags`: world size, facing, the page,
/// and [`crate::LATER`].
pub(crate) struct TextRecord {
    pub(crate) p: [f32; 4],
    pub(crate) rect: [f32; 4],
    pub(crate) uv: [f32; 4],
    pub(crate) right: [f32; 4],
    pub(crate) up: [f32; 4],
    pub(crate) color: u32,
    pub(crate) pick: u32,
    pub(crate) flags: u32,
    pub(crate) pad: u32,
}
}

pub(crate) const TEXT: [wgpu::VertexAttribute; 8] = wgpu::vertex_attr_array![
    0 => Float32x4, 1 => Float32x4, 2 => Float32x4, 3 => Float32x4, 4 => Float32x4,
    5 => Uint32, 6 => Uint32, 7 => Uint32
];

deep_gpu::paired! { puff_record: PUFF => "scene3d_labels_sky.wgsl", puff_vs;
/// A puff's instance record (scene3d.wgsl's `puff_vs`).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub(crate) struct PuffRecord {
    pub(crate) center: [f32; 4],
    pub(crate) shape: [f32; 4],
    pub(crate) light: [f32; 4],
}
}

pub(crate) const PUFF: [wgpu::VertexAttribute; 3] =
    wgpu::vertex_attr_array![0 => Float32x4, 1 => Float32x4, 2 => Float32x4];
