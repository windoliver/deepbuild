//! DeepBuild patch (windoliver/deepbuild#499): one completed handler for every frame. GPUI makes a block for each frame
//! to release its instance buffer and the CoreVideo textures its surfaces read, an allocation a frame; here a frame's
//! resources and surfaces report wait in a queue that one handler, made once, drains in commit order, so a frame that
//! only a video surface changes allocates nothing. It is here, not in `metal_renderer.rs`, so the hook there stays one
//! line (`upstream/README.md`).

use std::{cell::Cell, collections::VecDeque, ptr::NonNull, sync::Arc};

use block2::RcBlock;
use objc2_core_foundation::CFRetained;
use objc2_core_video::CVMetalTexture;
use objc2_metal::MTLCommandBuffer;
use parking_lot::Mutex;

use super::{InstanceBuffer, InstanceBufferPool, MetalRenderer, ProtocolObject, bgra_surface};

/// What a frame holds until its command buffer completes.
type Resources = (InstanceBuffer, Vec<CFRetained<CVMetalTexture>>);
type Queue = Arc<Mutex<VecDeque<(Resources, Option<u64>)>>>;
type Handler = RcBlock<dyn Fn(NonNull<ProtocolObject<dyn MTLCommandBuffer>>)>;

/// Committed frames' resources and surfaces reports, and the handler that releases them.
pub(super) struct Completions {
    queue: Queue,
    handler: Handler,
}

// SAFETY: the queue's resources go back to the mutex-protected pool only after GPU completion, as GPUI's own block
// sends them, and the handler is only handed to Metal, which copies it.
unsafe impl Send for Completions {}

impl Completions {
    pub(super) fn new(pool: &Arc<Mutex<InstanceBufferPool>>) -> Self {
        let queue: Queue = Arc::new(Mutex::new(VecDeque::with_capacity(64)));
        let (pending, pool) = (queue.clone(), pool.clone());
        let handler = RcBlock::new(move |buffer: NonNull<ProtocolObject<dyn MTLCommandBuffer>>| {
            let next = pending.lock().pop_front();
            if let Some(((instance_buffer, _surface_textures), surfaces_frame)) = next {
                pool.lock().release(instance_buffer);
                // SAFETY: Metal hands a completed handler the command buffer it completed.
                bgra_surface::completed(unsafe { buffer.as_ref() }, surfaces_frame); // DeepBuild patch (windoliver/deepbuild#377)
            }
        });
        Self { queue, handler }
    }
}

impl MetalRenderer {
    /// Queues the frame's resources with its surfaces report, made here before the caller commits, and gives the one
    /// handler for its command buffer. `_pool` is the clone GPUI's own block would have captured.
    pub(super) fn frame_completed(
        &mut self,
        _pool: Arc<Mutex<InstanceBufferPool>>,
        resources: Cell<Option<Resources>>,
    ) -> &Handler {
        // DeepBuild patch (windoliver/deepbuild#377): reported here, before the completed handler can run.
        let surfaces_frame = self.surfaces_encoded();
        if let Some(resources) = resources.take() {
            self.completions.queue.lock().push_back((resources, surfaces_frame));
        }
        &self.completions.handler
    }
}
