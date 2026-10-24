//! Render modules (issue #377): what draws into a GPU surface's slot. A render module declares
//! every GPU resource it holds, so a lost device rebuilds each of them from the module's own
//! inputs, and hands the frame one encode per writer layer, which the encode workers record in
//! parallel and submit in frame order.

use std::sync::Arc;

use crate::device::Device;
use crate::encode::Job;

/// What a frame's encodes draw into.
#[derive(Clone)]
pub struct Target {
    pub frame: u64,
    pub size: [u32; 2],
    pub view: wgpu::TextureView,
}

pub trait RenderModule: Send {
    fn name(&self) -> &'static str;
    /// The names of the GPU resources it declares.
    fn declared(&self) -> Vec<&'static str>;
    /// Builds (or, after a device loss, rebuilds) every declared resource on `device`.
    fn build(&mut self, device: &Device) -> Result<(), String>;
    /// The device epoch its declared resources were last built on.
    fn built_on(&self) -> Option<u64>;
    /// What the last build left to upload (asset bytes for the buffers it made), which the view
    /// writes over later frames within the budget class's `upload_bytes_per_frame`.
    fn take_uploads(&mut self) -> Vec<(wgpu::Buffer, Arc<[u8]>)> {
        Vec::new()
    }
    /// The frame's encodes, one per writer layer, in frame order. The first clears the slot.
    fn layers(&mut self, device: &Device, target: &Target) -> Vec<Job>;
}
