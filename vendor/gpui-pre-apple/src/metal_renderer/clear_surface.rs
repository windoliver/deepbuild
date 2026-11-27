//! DeepBuild patch (windoliver/deepbuild#177): a live view's HDR surface is a layer of its own
//! beneath the window's, so the window leaves the view's region clear. A BGRA surface registered
//! here draws with blending off, writing its pixel buffer's transparent texels over whatever the
//! scene drew before it; what paints after it (the question card, overlays, text) draws over the
//! clear region as usual. While a frame draws one, the window's layer isn't opaque, so the
//! compositor shows the layer beneath; a frame without one sets it back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use anyhow::Result;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_metal::{MTLDevice, MTLLibrary, MTLPixelFormat, MTLRenderPipelineState};
use objc2_quartz_core::CAMetalLayer;

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
pub(super) fn settle(layer: &CAMetalLayer) {
    if DREW.swap(false, Ordering::SeqCst) {
        if layer.isOpaque() {
            layer.setOpaque(false);
            MADE_CLEAR.store(true, Ordering::SeqCst);
        }
    } else if MADE_CLEAR.swap(false, Ordering::SeqCst) {
        layer.setOpaque(true);
    }
}

/// The surface pipeline with blending off: it replaces what's beneath with its texels.
pub(super) fn pipeline(
    device: &ProtocolObject<dyn MTLDevice>,
    library: &ProtocolObject<dyn MTLLibrary>,
) -> Result<Retained<ProtocolObject<dyn MTLRenderPipelineState>>> {
    super::build_pipeline_state(
        device,
        library,
        "surfaces_clear",
        "surface_vertex",
        "surface_bgra_fragment",
        MTLPixelFormat::BGRA8Unorm,
        false,
    )
}
