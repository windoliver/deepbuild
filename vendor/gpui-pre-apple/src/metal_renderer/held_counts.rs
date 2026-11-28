//! DeepBuild patch (windoliver/deepbuild#1431): what the renderer holds on the device, counted into `crate::held` at
//! the sizes the device allocated: the pool's instance buffers, the renderer's own target and each layer's drawables.
//! It is here, not in `metal_renderer.rs`, so the hooks there stay one line each (`upstream/README.md`). From
//! gpui-pre 0.3.11 paths are drawn as tiles into the frame itself, so the renderer keeps no path targets; the one
//! target it keeps is its depth texture, which an Apple GPU holds in tile memory and sizes at nothing.

use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_metal::{MTLBuffer, MTLTexture};
use objc2_quartz_core::CAMetalLayer;

use super::{InstanceBuffer, MetalRenderer};
use crate::held;

fn address<T>(object: &T) -> usize {
    object as *const T as usize
}

/// A new instance buffer, counted in.
pub(super) fn took(buffer: &ProtocolObject<dyn MTLBuffer>) {
    held::took(held::INSTANCES, 1, held::bytes(buffer));
}

/// An instance buffer is counted out as it goes: one the pool lets go of, one of an old size it doesn't keep, one a
/// frame outgrew.
impl Drop for InstanceBuffer {
    fn drop(&mut self) {
        held::freed(held::INSTANCES, 1, held::bytes(&*self.metal_buffer));
    }
}

/// The drawable a layer handed over.
pub(super) fn drawable(layer: &CAMetalLayer, texture: &ProtocolObject<dyn MTLTexture>) {
    held::drawable(address(layer), address(texture), held::bytes(texture));
}

/// The renderer's target, counted out as `old` goes and in as `new` comes.
pub(super) fn target(old: &Option<Retained<ProtocolObject<dyn MTLTexture>>>, new: &ProtocolObject<dyn MTLTexture>) {
    if let Some(old) = old {
        held::freed(held::TARGETS, 1, held::bytes(&**old));
    }
    held::took(held::TARGETS, 1, held::bytes(new));
}

impl MetalRenderer {
    /// A resize replaces the layer's drawables, so it lets go of the ones counted.
    pub(super) fn count_resized(&self) {
        if let Some(layer) = &self.layer {
            held::resized(address(&**layer));
        }
    }
}

impl Drop for MetalRenderer {
    fn drop(&mut self) {
        if let Some(depth) = &self.depth_texture {
            held::freed(held::TARGETS, 1, held::bytes(&**depth));
        }
        self.count_resized();
    }
}
