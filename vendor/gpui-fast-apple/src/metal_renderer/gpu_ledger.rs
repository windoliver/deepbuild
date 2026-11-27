//! DeepBuild patch (windoliver/deepbuild#391): a count of the frame command buffers this process
//! committed and completed, and the GPU time they took (each one's GPU start to its GPU end), so a
//! canvas can show that a still view uses no GPU time. A frame renders through the command buffer
//! from `render_frame`, which this counts; gpui-fast's own command buffers (a scroll layer's tile
//! rasters) are #3626's to count.

use std::sync::atomic::{AtomicU64, Ordering};

use objc2_metal::MTLCommandBuffer;

use super::ProtocolObject;

static COMMITTED: AtomicU64 = AtomicU64::new(0);
static COMPLETED: AtomicU64 = AtomicU64::new(0);
static GPU_NS: AtomicU64 = AtomicU64::new(0);

/// What the ledger holds so far.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    pub committed: u64,
    pub completed: u64,
    pub gpu_ns: u64,
}

pub fn read() -> Ledger {
    Ledger {
        committed: COMMITTED.load(Ordering::SeqCst),
        completed: COMPLETED.load(Ordering::SeqCst),
        gpu_ns: GPU_NS.load(Ordering::SeqCst),
    }
}

pub(super) fn committed() {
    COMMITTED.fetch_add(1, Ordering::SeqCst);
}

pub(super) fn completed(buffer: &ProtocolObject<dyn MTLCommandBuffer>) -> u64 {
    // GPU start to GPU end, in seconds, read once the buffer completed.
    let ns = ((buffer.GPUEndTime() - buffer.GPUStartTime()).max(0.0) * 1e9).round() as u64;
    GPU_NS.fetch_add(ns, Ordering::SeqCst);
    COMPLETED.fetch_add(1, Ordering::SeqCst);
    ns
}
