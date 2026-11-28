//! DeepBuild patch (windoliver/deepbuild#499): one completed handler for every frame. GPUI makes a block for each frame
//! to release its instance buffer and the surface textures it sampled, an allocation a frame; here a frame's instance
//! buffer, its surface textures and its surfaces report wait in a queue that one handler, made once, drains in commit
//! order, and the list a frame's textures were kept in goes back for a later frame, so a frame that only a video
//! surface changes allocates nothing. It is here, not in `metal_renderer.rs`, so the hook there stays one line
//! (`upstream/README.md`).

use std::{collections::VecDeque, ptr::NonNull, sync::Arc};

use anyhow::Result;
use block2::RcBlock;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_core_foundation::CFRetained;
use objc2_core_video::CVMetalTexture;
use objc2_metal::MTLCommandBuffer;
use parking_lot::Mutex;

use super::{InstanceBuffer, InstanceBufferPool, MetalRenderer, bgra_surface};

type Textures = Vec<CFRetained<CVMetalTexture>>;
type Handler = RcBlock<dyn Fn(NonNull<ProtocolObject<dyn MTLCommandBuffer>>)>;

/// What a committed frame holds until the GPU is done with it.
struct Frame {
    instance_buffer: InstanceBuffer,
    textures: Textures,
    surfaces_frame: Option<u64>,
}

#[derive(Default)]
struct Pending {
    frames: VecDeque<Frame>,
    /// Emptied texture lists, kept for the frames to come.
    spare: Vec<Textures>,
}

/// Committed frames' instance buffers, surface textures and surfaces reports, and the handler that releases them.
pub(super) struct Completions {
    pending: Arc<Mutex<Pending>>,
    handler: Handler,
}

impl Completions {
    pub(super) fn new(pool: &Arc<Mutex<InstanceBufferPool>>) -> Self {
        let pending = Arc::new(Mutex::new(Pending {
            frames: VecDeque::with_capacity(64),
            spare: Vec::with_capacity(8),
        }));
        let (queue, pool) = (pending.clone(), pool.clone());
        let handler = RcBlock::new(move |buffer: NonNull<ProtocolObject<dyn MTLCommandBuffer>>| {
            let mut queue = queue.lock();
            let Some(mut frame) = queue.frames.pop_front() else {
                return;
            };
            frame.textures.clear();
            if queue.spare.len() < queue.spare.capacity() {
                queue.spare.push(std::mem::take(&mut frame.textures));
            }
            drop(queue);
            pool.lock().release(frame.instance_buffer);
            bgra_surface::completed(buffer, frame.surfaces_frame); // DeepBuild patch (windoliver/deepbuild#377)
        });
        Self { pending, handler }
    }
}

impl MetalRenderer {
    /// An empty list for the surface textures of the frame about to be drawn, whose surfaces report
    /// (DeepBuild patch (windoliver/deepbuild#377)) starts empty too.
    pub(super) fn frame_textures(&mut self) -> Textures {
        self.bgra_surfaces.sampled.clear();
        self.completions.pending.lock().spare.pop().unwrap_or_default()
    }

    /// Queues the frame's instance buffer and surface textures with its surfaces report, made here before the caller
    /// commits, and gives its command buffer the one handler.
    pub(super) fn frame_completed(
        &mut self,
        instance_buffer: InstanceBuffer,
        textures: Textures,
        command_buffer: Retained<ProtocolObject<dyn MTLCommandBuffer>>,
    ) -> Result<Retained<ProtocolObject<dyn MTLCommandBuffer>>> {
        // DeepBuild patch (windoliver/deepbuild#377): reported here, before the completed handler can run.
        let surfaces_frame = self.surfaces_encoded();
        self.completions.pending.lock().frames.push_back(Frame { instance_buffer, textures, surfaces_frame });
        // SAFETY: Metal copies the block, which lives as long as the renderer's queue does, and invokes it once
        // after this frame completes; what it takes from the queue is this frame's, since frames complete in the
        // order they were committed.
        unsafe {
            command_buffer.addCompletedHandler(RcBlock::as_ptr(&self.completions.handler));
        }
        Ok(command_buffer)
    }
}
