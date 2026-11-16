//! DeepBuild patch (windoliver/deepbuild#177): a live view's HDR surface is a layer of its own
//! beneath the window's, so the window leaves the view's region clear. A BGRA surface registered
//! here draws with blending off, writing its pixel buffer's transparent texels over whatever the
//! scene drew before it; what paints after it (the question card, overlays, text) draws over the
//! clear region as usual. While a frame draws one, the window's layer isn't opaque, so the
//! compositor shows the layer beneath; a frame without one sets it back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

static CLEARS: RwLock<Vec<u64>> = RwLock::new(Vec::new());
static DREW: AtomicBool = AtomicBool::new(false);
/// Whether a clear made an opaque layer transparent, so a frame without one restores it.
static MADE_CLEAR: AtomicBool = AtomicBool::new(false);

/// Registers the pixel buffer whose identity (its address) is `id` as a clear region.
pub fn register(id: u64) {
    let mut clears = CLEARS.write().unwrap_or_else(|e| e.into_inner());
    if !clears.contains(&id) {
        clears.push(id);
    }
}

/// Whether the surface `id` clears, noting that this frame drew one.
pub(super) fn clears(id: u64) -> bool {
    let clears = CLEARS
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .contains(&id);
    if clears {
        DREW.store(true, Ordering::SeqCst);
    }
    clears
}

/// After a frame is encoded: the layer is transparent while the frame cleared a region, and
/// returns to what it was once a frame doesn't.
pub(super) fn settle(layer: &metal::MetalLayerRef) {
    if DREW.swap(false, Ordering::SeqCst) {
        if layer.is_opaque() {
            layer.set_opaque(false);
            MADE_CLEAR.store(true, Ordering::SeqCst);
        }
    } else if MADE_CLEAR.swap(false, Ordering::SeqCst) {
        layer.set_opaque(true);
    }
}

/// The surface pipeline with blending off: it replaces what's beneath with its texels.
pub(super) fn pipeline(
    device: &metal::DeviceRef,
    library: &metal::LibraryRef,
) -> metal::RenderPipelineState {
    let function = |name| {
        library
            .get_function(name, None)
            .expect("error locating a surface function")
    };
    let descriptor = metal::RenderPipelineDescriptor::new();
    descriptor.set_label("surfaces_clear");
    descriptor.set_vertex_function(Some(function("surface_vertex").as_ref()));
    descriptor.set_fragment_function(Some(function("surface_bgra_fragment").as_ref()));
    let color = descriptor.color_attachments().object_at(0).unwrap();
    color.set_pixel_format(metal::MTLPixelFormat::BGRA8Unorm);
    color.set_blending_enabled(false);
    device
        .new_render_pipeline_state(&descriptor)
        .expect("could not create the clear surface pipeline")
}
