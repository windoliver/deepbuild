//! DeepBuild patch (windoliver/deepbuild#1431): what the renderer holds on the device, counted into `crate::held` at
//! the sizes the device allocated: the pool's instance buffers, the path targets and each layer's drawables. It is
//! here, not in `metal_renderer.rs`, so the hooks there stay one line each (`upstream/README.md`).

use foreign_types::ForeignTypeRef;

use super::{InstanceBuffer, InstanceBufferPool, MetalRenderer};
use crate::held;

impl InstanceBufferPool {
    /// The pool's idle buffers, counted out as the pool lets go of them.
    pub(super) fn count_freed(&self) {
        let bytes = self.buffers.iter().map(|b| b.allocated_size()).sum();
        held::freed(held::INSTANCES, self.buffers.len() as u64, bytes);
    }
}

impl Drop for InstanceBufferPool {
    fn drop(&mut self) {
        self.reset(self.buffer_size);
    }
}

/// A new instance buffer, counted in.
pub(super) fn took(buffer: metal::Buffer) -> metal::Buffer {
    held::took(held::INSTANCES, 1, buffer.allocated_size());
    buffer
}

/// An instance buffer of an old size, which the pool drops instead of keeping, counted out.
pub(super) fn freed(buffer: &InstanceBuffer) {
    held::freed(held::INSTANCES, 1, buffer.metal_buffer.allocated_size());
}

/// The drawable a layer handed over.
pub(super) fn drawable(layer: &metal::MetalLayerRef, texture: &metal::TextureRef) {
    held::drawable(layer.as_ptr() as usize, texture.as_ptr() as usize, texture.allocated_size());
}

impl MetalRenderer {
    /// The path targets, counted in or out. Counting out comes before a resize replaces them, so it also lets go of the
    /// layer's drawables, which the resize replaces too.
    pub(super) fn count_targets(&self, took: bool) {
        let count = if took { held::took } else { held::freed };
        let targets = [&self.path_intermediate_texture, &self.path_intermediate_msaa_texture];
        targets.into_iter().flatten().for_each(|t| count(held::TARGETS, 1, t.allocated_size()));
        if !took {
            self.layer.iter().for_each(|layer| held::resized(layer.as_ptr() as usize));
        }
    }
}

impl Drop for MetalRenderer {
    fn drop(&mut self) {
        self.count_targets(false);
    }
}
