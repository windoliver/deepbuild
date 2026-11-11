//! Issue #424: the per-pixel resolve (canvas primitives: Object: see-through order). A
//! per-pixel item's fragments join per-pixel lists during the geometry pass (scene3d.wgsl's
//! `oit_fs`), and one full-screen pass composites each pixel's by depth over what's behind them.
//! A frame whose fragments pass the room draws those items sorted instead, so nothing shows a
//! hole; the next frame has twice the room, up to the class's GPU memory, and past that the frame
//! reports `fragments_capped`.

use deep_gpu::device::Device;

/// Bytes a fragment takes: premultiplied RGBA as halves, its depth and the next node.
pub const NODE: u64 = 16;

/// The lists' buffers and how much room they hold.
pub struct Oit {
    pub heads: wgpu::Buffer,
    pub nodes: wgpu::Buffer,
    pub info: wgpu::Buffer,
    pub staging: wgpu::Buffer,
    /// The target's width and its pixel count the heads cover.
    width: u32,
    pixels: u64,
    /// Nodes the buffer holds; the view's `max_fragments`; the class's cap.
    capacity: u64,
    asked: u64,
    cap: u64,
    /// Whether this frame draws per-pixel items, and whether its info was copied for reading.
    pub active: bool,
}

fn storage(d: &deep_gpu::counted::Wgpu, label: &str, size: u64) -> wgpu::Buffer {
    d.create_buffer(&wgpu::BufferDescriptor {
        label: Some(label),
        size: size.max(16),
        usage: wgpu::BufferUsages::STORAGE
            | wgpu::BufferUsages::COPY_DST
            | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    })
}

impl Oit {
    pub fn new(d: &deep_gpu::counted::Wgpu) -> Oit {
        Oit {
            heads: storage(d, "scene3d oit heads", 16),
            nodes: storage(d, "scene3d oit nodes", 16),
            info: storage(d, "scene3d oit info", 16),
            staging: d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("scene3d oit count"),
                size: 16,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }),
            width: 0,
            pixels: 0,
            capacity: 1,
            asked: 0,
            cap: 0,
            active: false,
        }
    }

    /// Room for a frame of `size` px whose view asks `max_fragments` under a class that holds
    /// `cap`; whether a buffer was made again, so the lights' bind group binds it anew.
    pub fn prepare(
        &mut self,
        device: &Device,
        active: bool,
        size: [u32; 2],
        [asked, cap]: [u64; 2],
    ) -> bool {
        self.active = active;
        if !active {
            return false;
        }
        let d = &device.device;
        let mut remade = false;
        let pixels = u64::from(size[0]) * u64::from(size[1]);
        if pixels != self.pixels {
            self.heads = storage(d, "scene3d oit heads", pixels * 4);
            self.pixels = pixels;
            remade = true;
        }
        self.width = size[0];
        // A view that asks for other room starts again from what it asks.
        if asked != self.asked {
            let limit = d.limits().max_storage_buffer_binding_size / NODE;
            self.asked = asked;
            self.capacity = asked.min(limit.max(1));
            self.nodes = storage(d, "scene3d oit nodes", self.capacity * NODE);
            remade = true;
        }
        // A storage binding holds no more than the device allows.
        let limit = d.limits().max_storage_buffer_binding_size / NODE;
        self.cap = cap.max(asked).min(limit.max(1));
        let info = [
            0u32,
            self.capacity.min(u64::from(u32::MAX)) as u32,
            self.width,
            0,
        ];
        deep_gpu::alloc::outside(|| {
            device
                .queue
                .write_buffer(&self.info, 0, bytemuck::cast_slice(&info))
        });
        remade
    }

    /// After a frame: how many fragments it wrote, whether it ran out of room at the cap, and
    /// whether the nodes were made again (below the cap the next frame has twice the room, or as
    /// much as it wrote), which the lights' bind group must bind anew.
    pub fn check(&mut self, device: &Device) -> Option<(u64, bool, bool)> {
        if !self.active {
            return None;
        }
        let (tx, rx) = std::sync::mpsc::channel();
        self.staging
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
        if !matches!(rx.recv(), Ok(Ok(()))) {
            return None;
        }
        let count = {
            let view = self.staging.slice(..).get_mapped_range().ok()?;
            u64::from(u32::from_le_bytes(view[0..4].try_into().ok()?))
        };
        self.staging.unmap();
        if count <= self.capacity {
            return Some((count, false, false));
        }
        if self.capacity >= self.cap {
            return Some((count, true, false));
        }
        self.capacity = (self.capacity * 2).max(count).min(self.cap);
        self.nodes = storage(&device.device, "scene3d oit nodes", self.capacity * NODE);
        Some((count, false, true))
    }
}
