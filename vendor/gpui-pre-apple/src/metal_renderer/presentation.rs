//! DeepBuild patch (windoliver/deepbuild#140): the display seam's presentation feedback on macOS
//! (canvas primitives: Frame callback and presentation feedback). While a hook is set, each
//! drawable a window's `draw` presents carries a presented handler that reports the label the app
//! set for that frame before the draw and the drawable's `presentedTime`: host time in seconds,
//! the clock `mach_absolute_time` counts, or 0 when the drawable was never shown. Each labelled
//! drawable's wait is kept beside it: how long its frame's draw waited for the layer to hand it
//! over, and nothing for one a display link handed the frame before its draw began.

use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use block2::RcBlock;
use objc2::runtime::ProtocolObject;
use objc2_metal::MTLDrawable;
use objc2_quartz_core::CAMetalDrawable;

pub type Hook = Arc<dyn Fn(u64, f64) + Send + Sync>;

static HOOK: RwLock<Option<Hook>> = RwLock::new(None);
static LABEL: AtomicU64 = AtomicU64::new(0);
static WAIT_NS: AtomicU64 = AtomicU64::new(0);
static WAITS: Mutex<Vec<(u64, u64)>> = Mutex::new(Vec::new());

/// A draw is about to ask for its drawable.
pub(super) fn asking() -> Instant {
    Instant::now()
}

/// The draw has its drawable: it waited since `asking`, or not at all when a display link had
/// handed the frame its drawable (`handed`).
pub(super) fn had(asking: Instant, handed: bool) {
    let waited = if handed { 0 } else { asking.elapsed().as_nanos() as u64 };
    WAIT_NS.store(waited, Ordering::SeqCst);
}

/// Each labelled drawable presented while a hook was set since the last call, with how long its
/// draw waited for it, in ns.
pub fn take_waits() -> Vec<(u64, u64)> {
    std::mem::take(&mut *WAITS.lock().unwrap_or_else(|e| e.into_inner()))
}

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
    if label != 0 {
        let waited = WAIT_NS.load(Ordering::SeqCst);
        WAITS.lock().unwrap_or_else(|e| e.into_inner()).push((label, waited));
    }
    let block = RcBlock::new(move |shown: NonNull<ProtocolObject<dyn MTLDrawable>>| {
        // SAFETY: Metal hands a presented handler the drawable it presented, and
        // `presentedTime` is an `MTLDrawable` property returning `CFTimeInterval`.
        let at: f64 = unsafe { objc2::msg_send![shown.as_ref(), presentedTime] };
        hook(label, at);
    });
    // SAFETY: Metal copies the block; it is added before the drawable is presented.
    unsafe {
        drawable.addPresentedHandler(RcBlock::as_ptr(&block));
    }
}
