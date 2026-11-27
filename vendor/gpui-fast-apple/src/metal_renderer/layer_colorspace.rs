//! DeepBuild patch (windoliver/deepbuild#140): the color seam's checks on a window's layer. The
//! planted twin sets every window layer's colorspace nil (untagged); and the next frame
//! a window draws can be read back from its layer's drawable, as the compositor receives it.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use image::RgbaImage;
use objc2_metal::{MTLCommandBuffer, MTLTexture};
use objc2_quartz_core::CAMetalLayer;

use super::{ProtocolObject, Retained};

static UNTAGGED: AtomicBool = AtomicBool::new(false);
static READ_NEXT: AtomicBool = AtomicBool::new(false);
static READ: Mutex<Option<RgbaImage>> = Mutex::new(None);

pub fn plant_untagged() {
    UNTAGGED.store(true, Ordering::SeqCst);
}

pub fn untagged() -> bool {
    UNTAGGED.load(Ordering::SeqCst)
}

/// Reads back the next frame any window draws, from its layer's drawable.
pub fn read_next_frame() {
    READ_NEXT.store(true, Ordering::SeqCst);
}

/// The frame read back, once a window has drawn one since `read_next_frame`.
pub fn take_frame() -> Option<RgbaImage> {
    READ.lock().ok()?.take()
}

/// Whether this frame's drawable is read back; its layer then lets the texture be read.
pub(super) fn reading(layer: &CAMetalLayer) -> bool {
    let reading = READ_NEXT.swap(false, Ordering::SeqCst);
    // DeepBuild patch (windoliver/deepbuild#1434): a chrome backdrop copies from the drawable.
    if gpui::chrome_reads_backdrops() || reading {
        layer.setFramebufferOnly(false);
    }
    reading
}

/// Reads the drawable back once the frame completed.
pub(super) fn read_back(
    command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
    texture: Option<Retained<ProtocolObject<dyn MTLTexture>>>,
) {
    let Some(texture) = texture else { return };
    command_buffer.waitUntilCompleted();
    match super::read_texture_to_image(&texture) {
        Ok(frame) => {
            if let Ok(mut read) = READ.lock() {
                *read = Some(frame);
            }
        }
        Err(error) => log::error!("failed to read the drawable back: {error:#}"),
    }
}

/// The layer holds sRGB-encoded BGRA8, so it is tagged sRGB and the compositor never reinterprets
/// it. GPUI alone sets no colorspace unless asked for Display P3, and leaves it to whatever AppKit
/// gives a view's backing layer (sRGB on macOS 26); the planted twin sets it nil.
pub(super) fn tag_srgb(layer: &CAMetalLayer) {
    // SAFETY: the constant is extern, from Core Graphics.
    let srgb = objc2_core_graphics::CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }));
    layer.setColorspace(srgb.as_deref().filter(|_| !untagged()));
}

#[cfg(test)]
mod tests {
    use objc2_core_graphics::CGColorSpace;
    use objc2_quartz_core::CAMetalLayer;

    use super::super::MetalRenderer;

    /// Off any window, so it runs on a locked screen.
    #[test]
    fn a_configured_layer_is_tagged_srgb() {
        let device = objc2_metal::MTLCreateSystemDefaultDevice().expect("a Metal device");
        let layer = CAMetalLayer::new();
        MetalRenderer::configure_layer(&layer, &device, false, false);
        let name = layer.colorspace().and_then(|space| CGColorSpace::name(Some(&space)));
        assert_eq!(
            name.map(|name| name.to_string()),
            Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }.to_string())
        );
    }
}
