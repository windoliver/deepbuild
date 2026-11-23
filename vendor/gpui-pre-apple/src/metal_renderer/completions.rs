//! DeepBuild patch (windoliver/deepbuild#499): one completed handler for every frame. GPUI makes a block for each frame
//! to release its instance buffer, an allocation a frame; here a frame's instance buffer and surfaces report wait in a
//! queue that one handler, made once, drains in commit order, so a frame that only a video surface changes allocates
//! nothing. It is here, not in `metal_renderer.rs`, so the hook there stays one line (`upstream/README.md`).

use std::{collections::VecDeque, ptr::NonNull, sync::Arc};

use block2::RcBlock;
use parking_lot::Mutex;

use super::{AnyObject, InstanceBuffer, InstanceBufferPool, MetalRenderer, bgra_surface};

type Queue = Arc<Mutex<VecDeque<(InstanceBuffer, Option<u64>)>>>;

/// Committed frames' instance buffers and surfaces reports, and the handler that releases them.
pub(super) struct Completions {
    queue: Queue,
    handler: RcBlock<dyn Fn(NonNull<AnyObject>)>,
}

impl Completions {
    pub(super) fn new(pool: &Arc<Mutex<InstanceBufferPool>>) -> Self {
        let queue: Queue = Arc::new(Mutex::new(VecDeque::with_capacity(64)));
        let (pending, pool) = (queue.clone(), pool.clone());
        let handler = RcBlock::new(move |buffer: NonNull<AnyObject>| {
            let next = pending.lock().pop_front();
            if let Some((instance_buffer, surfaces_frame)) = next {
                pool.lock().release(instance_buffer);
                bgra_surface::completed(buffer, surfaces_frame); // DeepBuild patch (windoliver/deepbuild#377)
            }
        });
        Self { queue, handler }
    }
}

impl MetalRenderer {
    /// Queues the frame's instance buffer with its surfaces report, made here before the caller commits, and gives the
    /// one handler for its command buffer.
    pub(super) fn frame_completed(&mut self, instance_buffer: InstanceBuffer) -> &RcBlock<dyn Fn(NonNull<AnyObject>)> {
        // DeepBuild patch (windoliver/deepbuild#377): reported here, before the completed handler can run.
        let surfaces_frame = self.surfaces_encoded();
        self.completions.queue.lock().push_back((instance_buffer, surfaces_frame));
        &self.completions.handler
    }
}
