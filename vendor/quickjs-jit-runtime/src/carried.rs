//! DeepBuild patch (windoliver/deepbuild#358): gpui-shell's public runtimes attach the JIT in release builds and offer no
//! way not to, and hold their `JitRuntime` privately. This one-way switch and the read below are how
//! the panel host runs them with the JIT off and proves it.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::{FastEntryShared, Jit, JitMetrics, Runtime};

static NATIVE_CODE_DENIED: AtomicBool = AtomicBool::new(false);
static HEAP_LIMIT: AtomicUsize = AtomicUsize::new(0);

thread_local! {
    static LAST_ATTACHED: RefCell<Option<(Arc<Mutex<JitMetrics>>, Arc<FastEntryShared>)>> =
        const { RefCell::new(None) };
}

/// Every runtime this process builds from now on is an interpreter. There is no way back: a
/// process that calls this can't attach a JIT.
pub fn deny_native_code() {
    NATIVE_CODE_DENIED.store(true, Ordering::SeqCst);
}

/// Every interpreter this process builds from now on has this heap ceiling, in bytes. gpui-shell
/// leaves the heap unbounded for a host to bound, and keeps the runtime a host would bound it on.
pub fn limit_heap(bytes: usize) {
    HEAP_LIMIT.store(bytes, Ordering::SeqCst);
}

/// Whether [`deny_native_code`] was called.
pub fn native_code_denied() -> bool {
    NATIVE_CODE_DENIED.load(Ordering::SeqCst)
}

/// The metrics of the JIT last attached on this thread, or `None` when none was.
pub fn last_attached_metrics() -> Option<JitMetrics> {
    LAST_ATTACHED.with(|last| {
        last.borrow().as_ref().map(|(metrics, fast_entry)| {
            let mut snapshot = metrics.lock().unwrap_or_else(|p| p.into_inner()).clone();
            fast_entry.add_to(&mut snapshot);
            snapshot
        })
    })
}

pub(super) fn attached(jit: &Jit) {
    LAST_ATTACHED.with(|last| {
        *last.borrow_mut() = Some((jit.metrics.clone(), jit.fast_entry.clone()));
    });
}

pub(super) fn apply_heap_limit(runtime: &Runtime) {
    let heap = HEAP_LIMIT.load(Ordering::SeqCst);
    if heap > 0 {
        runtime.set_memory_limit(heap);
    }
}
