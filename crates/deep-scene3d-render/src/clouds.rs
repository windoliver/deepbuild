//! Point sets from a depth video (#503; canvas primitives: Marks in 3D): the shipped compute
//! operator writes each set's points as the point pipeline's records into a buffer of its own, and
//! the set's layer draws that buffer with the point pipeline, in place of the one record the CPU
//! would write for the item.

use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};

/// Each set's records this frame, by item: the buffer and how many records it holds.
pub type Clouds = BTreeMap<String, (wgpu::Buffer, u32)>;

/// What a layer's draw key holds for its sets: each buffer, by identity, and its count, so a new
/// buffer or count encodes the layer again and new records in the same buffer don't.
pub(crate) fn key(sets: &[(wgpu::Buffer, u32)]) -> impl Iterator<Item = u64> + '_ {
    sets.iter().flat_map(|(buffer, count)| {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        buffer.hash(&mut h);
        [14, h.finish(), u64::from(*count)]
    })
}

/// Draws each set's records with the point pipeline, six vertices a point.
pub(crate) fn draw<'a>(
    enc: &mut wgpu::RenderBundleEncoder<'a>,
    pipeline: Option<&'a wgpu::RenderPipeline>,
    sets: &'a [(wgpu::Buffer, u32)],
) {
    let Some(pipeline) = pipeline.filter(|_| !sets.is_empty()) else {
        return;
    };
    enc.set_pipeline(pipeline);
    for (buffer, count) in sets {
        enc.set_vertex_buffer(0, buffer.slice(..));
        enc.draw(0..6, 0..*count);
    }
}
