//! DeepBuild patch (windoliver/deepbuild#140): the color seam's checks on a window's layer. The
//! planted twin sets every window layer's colorspace nil (untagged); and the next frame
//! a window draws can be read back from its layer's drawable, as the compositor receives it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use image::RgbaImage;

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
pub(super) fn reading(layer: &metal::MetalLayerRef) -> bool {
    let reading = READ_NEXT.swap(false, Ordering::SeqCst);
    // DeepBuild patch (windoliver/deepbuild#1434): a chrome backdrop copies from the drawable.
    if gpui::chrome_reads_backdrops() {
        layer.set_framebuffer_only(false);
    }
    if reading {
        layer.set_framebuffer_only(false);
    }
    reading
}

/// Reads the drawable back once the frame completed.
pub(super) fn read_back(command_buffer: &metal::CommandBufferRef, texture: Option<metal::Texture>) {
    let Some(texture) = texture else { return };
    command_buffer.wait_until_completed();
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
/// it. GPUI alone sets no colorspace and leaves it to whatever AppKit gives a view's backing layer
/// (sRGB on macOS 26); the planted twin sets it nil.
pub(super) fn tag_srgb(objc2_layer: &objc2_quartz_core::CAMetalLayer) {
    let srgb = objc2_core_graphics::CGColorSpace::with_name(Some(unsafe {
        objc2_core_graphics::kCGColorSpaceSRGB
    }));
    objc2_layer.setColorspace(srgb.as_deref().filter(|_| !untagged()));
}

#[cfg(test)]
mod tests {
    use foreign_types::ForeignTypeRef;
    use objc2_core_graphics::CGColorSpace;

    use super::super::MetalRenderer;

    /// Off any window, so it runs on a locked screen.
    #[test]
    fn a_configured_layer_is_tagged_srgb() {
        let device = metal::Device::system_default().expect("a Metal device");
        let layer = metal::MetalLayer::new();
        MetalRenderer::configure_layer(&layer, &device, false);
        let objc2_layer: &objc2_quartz_core::CAMetalLayer = unsafe { &*layer.as_ptr().cast() };
        let name = objc2_layer.colorspace().and_then(|space| CGColorSpace::name(Some(&space)));
        assert_eq!(
            name.map(|name| name.to_string()),
            Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }.to_string())
        );
    }
}
