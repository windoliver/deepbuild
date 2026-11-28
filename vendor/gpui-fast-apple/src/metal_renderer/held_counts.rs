//! DeepBuild patch (windoliver/deepbuild#1431): what the renderer holds on the device, counted into `crate::held` at
//! the sizes the device allocated: the pool's instance buffers, the frame's depth target (where 0.3.9 held its path
//! targets: gpui-fast draws paths as tiles, with no target of their own) and each layer's drawables. It is here, not
//! in `metal_renderer.rs`, so the hooks there stay one line each (`upstream/README.md`).

use objc2_metal::{MTLBuffer, MTLResource, MTLTexture};
use objc2_quartz_core::CAMetalLayer;

use super::{InstanceBuffer, InstanceBufferPool, MetalRenderer, ProtocolObject, Retained};
use crate::held;

impl InstanceBufferPool {
    /// The pool's idle buffers, counted out as the pool lets go of them.
    pub(super) fn count_freed(&self) {
        let bytes = self.buffers.iter().map(|b| b.metal_buffer.allocatedSize() as u64).sum();
        held::freed(held::INSTANCES, self.buffers.len() as u64, bytes);
    }
}

impl Drop for InstanceBufferPool {
    fn drop(&mut self) {
        self.reset(self.buffer_size);
    }
}

/// A new instance buffer, counted in.
pub(super) fn took(buffer: &ProtocolObject<dyn MTLBuffer>) {
    held::took(held::INSTANCES, 1, buffer.allocatedSize() as u64);
}

/// An instance buffer of an old size, which the pool drops instead of keeping, counted out.
pub(super) fn freed(buffer: &InstanceBuffer) {
    held::freed(held::INSTANCES, 1, buffer.metal_buffer.allocatedSize() as u64);
}

/// The drawable a layer handed over.
pub(super) fn drawable(layer: &CAMetalLayer, texture: &ProtocolObject<dyn MTLTexture>) {
    let (layer, texture_id) = (layer as *const CAMetalLayer as usize, texture as *const _ as *const u8 as usize);
    held::drawable(layer, texture_id, texture.allocatedSize() as u64);
}

impl MetalRenderer {
    /// The depth target `new` replaces the renderer's with, counted in, and the one it replaces counted out.
    pub(super) fn count_depth(&self, new: &Retained<ProtocolObject<dyn MTLTexture>>) {
        self.count_targets(false);
        held::took(held::TARGETS, 1, new.allocatedSize() as u64);
    }

    /// A resize replaces the layer's drawables.
    pub(super) fn count_resized(&self) {
        self.layer.iter().for_each(|layer| held::resized(&**layer as *const CAMetalLayer as usize));
    }

    fn count_targets(&self, took: bool) {
        let count = if took { held::took } else { held::freed };
        self.depth_texture.iter().for_each(|t| count(held::TARGETS, 1, t.allocatedSize() as u64));
    }
}

impl Drop for MetalRenderer {
    fn drop(&mut self) {
        self.count_targets(false);
        self.count_resized();
    }
}
