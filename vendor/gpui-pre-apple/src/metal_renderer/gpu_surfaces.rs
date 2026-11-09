//! DeepBuild patch (windoliver/deepbuild#377): what the canvas's GPU layer needs from the frame
//! command buffers that show its surfaces. A BGRA surface (a slot another renderer drew into an
//! IOSurface) composites premultiplied, with source factor one and destination factor one minus
//! source alpha. Each frame command buffer that samples one reports the pixel buffers it samples
//! when it is committed, and again when it completes, so a slot is released only once GPUI is
//! done reading it. The planted twins exist for the GPU layer's acceptance tests: one divides
//! alpha out of the surface, the other draws surfaces after the rest of the scene.

use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, RwLock};

/// A frame's report: the identity of each BGRA pixel buffer its command buffer samples (the
/// `CVPixelBuffer`'s address), once the buffer is encoded, then its completion with the GPU
/// time it took. `frame` numbers only the frames that sample a surface while a hook is set.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Encoded { frame: u64, surfaces: Vec<u64> },
    Completed { frame: u64, gpu_ns: u64 },
}

/// A planted wrong compositor, for the tests that must catch it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Planted {
    None = 0,
    /// Divides the surface's color by its alpha and blends it as straight alpha.
    DividesAlpha = 1,
    /// Draws every surface after the rest of the scene, over whatever was painted above it.
    AfterScene = 2,
    /// DeepBuild patch (windoliver/deepbuild#499): an NV12 surface drawn by GPUI's stock fragment,
    /// full-range BT.601, whatever its tags.
    StockFragment = 3,
}

pub type Hook = Arc<dyn Fn(Event) + Send + Sync>;

static HOOK: RwLock<Option<Hook>> = RwLock::new(None);
static PLANTED: AtomicU8 = AtomicU8::new(Planted::None as u8);
static NEXT_FRAME: AtomicU64 = AtomicU64::new(1);

/// Installs the hook that receives every report, replacing any earlier one, or removes it.
/// The earlier hook is dropped with the lock released, so what it captured may use these
/// functions as it drops.
pub fn set_hook(hook: Option<Hook>) {
    let mut guard = HOOK.write().unwrap_or_else(|e| e.into_inner());
    let old = std::mem::replace(&mut *guard, hook);
    drop(guard);
    drop(old);
}

pub fn plant(planted: Planted) {
    PLANTED.store(planted as u8, Ordering::SeqCst);
}

pub(super) fn planted() -> Planted {
    match PLANTED.load(Ordering::SeqCst) {
        1 => Planted::DividesAlpha,
        2 => Planted::AfterScene,
        3 => Planted::StockFragment,
        _ => Planted::None,
    }
}

fn hook() -> Option<Hook> {
    HOOK.read().unwrap_or_else(|e| e.into_inner()).clone()
}

pub(super) fn has_hook() -> bool {
    hook().is_some()
}

pub(super) fn next_frame() -> u64 {
    NEXT_FRAME.fetch_add(1, Ordering::SeqCst)
}

/// Calls the hook with the lock released, so the hook may replace itself.
pub(super) fn report(event: Event) {
    if let Some(hook) = hook() {
        hook(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use parking_lot::Mutex;
    use std::time::Duration;

    /// The hook is process-wide and `cargo test` runs tests in parallel.
    static HOOK_TESTS: Mutex<()> = Mutex::new(());

    /// DeepBuild patch (windoliver/deepbuild#711): a hook may replace itself from inside a report,
    /// since the renderer reports from Metal's completion thread and a stuck hook there would
    /// stall every frame's completion.
    #[test]
    fn surface_hook_may_replace_itself() {
        let _alone = HOOK_TESTS.lock();
        let replaced = Arc::new(Mutex::new(false));
        set_hook(Some(Arc::new({
            let replaced = replaced.clone();
            move |_| {
                set_hook(None);
                *replaced.lock() = true;
            }
        })));
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            report(Event::Completed {
                frame: 0,
                gpu_ns: 0,
            });
            sender.send(()).unwrap();
        });
        if receiver.recv_timeout(Duration::from_secs(5)).is_err() {
            // The stuck thread holds the lock, so uninstalling the hook would hang too.
            panic!("report deadlocked: the hook could not replace itself");
        }
        assert!(*replaced.lock());
        set_hook(None);
    }

    /// DeepBuild patch (windoliver/deepbuild#711): replacing the hook drops the old one outside
    /// the lock, so whatever it captured may use the hook functions as it drops.
    #[test]
    fn set_hook_drops_the_old_hook_outside_the_lock() {
        let _alone = HOOK_TESTS.lock();
        struct AsksOnDrop;
        impl Drop for AsksOnDrop {
            fn drop(&mut self) {
                has_hook();
            }
        }
        let asks = AsksOnDrop;
        set_hook(Some(Arc::new(move |_| {
            let _ = &asks;
        })));
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            set_hook(None);
            sender.send(()).unwrap();
        });
        if receiver.recv_timeout(Duration::from_secs(5)).is_err() {
            panic!("set_hook deadlocked: the old hook was dropped under the lock");
        }
        assert!(!has_hook());
    }
}
