//! DeepBuild patch (windoliver/deepbuild#140): the display seam's presentation feedback on macOS
//! (canvas primitives: Frame callback and presentation feedback). While a hook is set, each
//! drawable a window's `draw` presents carries a presented handler that reports the label the app
//! set for that frame before the draw and the drawable's `presentedTime`: host time in seconds,
//! the clock `mach_absolute_time` counts, or 0 when the drawable was never shown.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use block2::RcBlock;
use objc2_metal::MTLDrawable;
use objc2_quartz_core::CAMetalDrawable;

use super::ProtocolObject;

pub type Hook = Arc<dyn Fn(u64, f64) + Send + Sync>;

static HOOK: RwLock<Option<Hook>> = RwLock::new(None);
static LABEL: AtomicU64 = AtomicU64::new(0);

/// Installs the hook that receives every presented drawable, or removes it.
pub fn set_hook(hook: Option<Hook>) {
    let old = std::mem::replace(&mut *HOOK.write().unwrap_or_else(|e| e.into_inner()), hook);
    drop(old);
}

/// Labels the next drawable a window presents; an unlabelled one reports 0.
pub fn label_next(label: u64) {
    LABEL.store(label, Ordering::SeqCst);
}

/// While a hook is set, has this drawable report its presented time once the display shows it
/// (`presentedTime` is 0 for a drawable never shown).
pub(super) fn report_when_shown(drawable: &ProtocolObject<dyn CAMetalDrawable>) {
    let Some(hook) = HOOK.read().unwrap_or_else(|e| e.into_inner()).clone() else {
        return;
    };
    let label = LABEL.swap(0, Ordering::SeqCst);
    let block = RcBlock::new(move |shown: NonNull<ProtocolObject<dyn MTLDrawable>>| {
        // SAFETY: Metal hands a presented handler the drawable it presented.
        hook(label, unsafe { shown.as_ref() }.presentedTime());
    });
    // SAFETY: Metal copies the block, which owns its captures; it is added before the drawable is presented.
    unsafe { drawable.addPresentedHandler(RcBlock::as_ptr(&block)) };
}
