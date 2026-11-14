//! wgpu's device and queue with what they create and upload counted (#1903): the envelope's counts
//! on the noop lane, bind groups, buffers and pipelines created and bytes uploaded, read per frame.
//! Every other call reaches wgpu's own through `Deref`. A function that takes the app's device
//! takes [`Wgpu`], never `&wgpu::Device`, so no creation of ours goes around the count.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::ops::Deref;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use wgpu::util::DeviceExt as _;

/// What a device created and uploaded since it opened.
#[derive(Debug, Default)]
pub struct Counts {
    bind_groups: AtomicU64,
    buffers: AtomicU64,
    pipelines: AtomicU64,
    uploaded: AtomicU64,
    writes: AtomicU64,
}

/// A reading of [`Counts`]; two readings' difference is what happened between them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Reading {
    pub bind_groups: u64,
    pub buffers: u64,
    pub pipelines: u64,
    /// Bytes written to buffers and textures, a buffer's initial contents included.
    pub uploaded: u64,
    /// The queue's writes to buffers and textures: wgpu stages each in a buffer of its own.
    pub writes: u64,
}

impl Reading {
    pub fn since(self, earlier: Reading) -> Reading {
        Reading {
            bind_groups: self.bind_groups - earlier.bind_groups,
            buffers: self.buffers - earlier.buffers,
            pipelines: self.pipelines - earlier.pipelines,
            uploaded: self.uploaded - earlier.uploaded,
            writes: self.writes - earlier.writes,
        }
    }
}

impl Counts {
    pub fn read(&self) -> Reading {
        Reading {
            bind_groups: self.bind_groups.load(Ordering::Relaxed),
            buffers: self.buffers.load(Ordering::Relaxed),
            pipelines: self.pipelines.load(Ordering::Relaxed),
            uploaded: self.uploaded.load(Ordering::Relaxed),
            writes: self.writes.load(Ordering::Relaxed),
        }
    }
}

fn add(n: &AtomicU64, by: u64) {
    n.fetch_add(by, Ordering::Relaxed);
}

/// The device's kept shaders, layouts and pipelines, by what they are made from: a second document
/// opened in the process makes none of them again (#1903's `first frame wait`).
#[derive(Debug, Default)]
struct Kept {
    modules: HashMap<u64, wgpu::ShaderModule>,
    group_layouts: HashMap<u64, wgpu::BindGroupLayout>,
    layouts: HashMap<u64, wgpu::PipelineLayout>,
    render: HashMap<u64, wgpu::RenderPipeline>,
    compute: HashMap<u64, wgpu::ComputePipeline>,
}

fn key(f: impl FnOnce(&mut DefaultHasher)) -> u64 {
    let mut h = DefaultHasher::new();
    f(&mut h);
    h.finish()
}

fn options(h: &mut DefaultHasher, o: &wgpu::PipelineCompilationOptions<'_>) {
    for (name, value) in o.constants {
        (name, value.to_bits()).hash(h);
    }
    o.zero_initialize_workgroup_memory.hash(h);
}

/// The app's wgpu device.
#[derive(Clone, Debug)]
pub struct Wgpu {
    raw: wgpu::Device,
    counts: Arc<Counts>,
    kept: Arc<Mutex<Kept>>,
    /// The test shim's delay, in ms, before the next pipeline the device makes (#1903).
    delay_ms: Arc<AtomicU64>,
}

impl Deref for Wgpu {
    type Target = wgpu::Device;
    fn deref(&self) -> &wgpu::Device {
        &self.raw
    }
}

impl Wgpu {
    pub fn new(raw: wgpu::Device, counts: Arc<Counts>) -> Wgpu {
        Wgpu {
            raw,
            counts,
            kept: Arc::default(),
            delay_ms: Arc::default(),
        }
    }

    /// The test shim (#1903's first frame wait): the next pipeline the device makes is made
    /// `ms` late, the thread making it sleeping first.
    pub fn delay_next_pipeline(&self, ms: u64) {
        self.delay_ms.store(ms, Ordering::SeqCst);
    }

    /// The object kept under `key` in `slot`, or one `make` makes now. It is made inside a scope
    /// of the device's own and kept only when valid; an invalid one is made again outside that
    /// scope, so the caller's own scope or callback sees its error, and is never kept.
    fn kept<T: Clone>(
        &self,
        slot: fn(&mut Kept) -> &mut HashMap<u64, T>,
        key: Option<u64>,
        made: Option<&AtomicU64>,
        make: impl Fn() -> T,
    ) -> T {
        let lock = || self.kept.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(found) = key.and_then(|k| slot(&mut lock()).get(&k).cloned()) {
            return found;
        }
        if made.is_some() {
            let ms = self.delay_ms.swap(0, Ordering::SeqCst);
            if ms > 0 {
                std::thread::sleep(std::time::Duration::from_millis(ms));
            }
        }
        let scope = self.raw.push_error_scope(wgpu::ErrorFilter::Validation);
        let object = make();
        made.inspect(|n| add(n, 1));
        if pollster::block_on(scope.pop()).is_some() {
            made.inspect(|n| add(n, 1));
            return make();
        }
        if let Some(k) = key {
            slot(&mut lock()).insert(k, object.clone());
        }
        object
    }

    pub fn create_shader_module(
        &self,
        desc: wgpu::ShaderModuleDescriptor<'_>,
    ) -> wgpu::ShaderModule {
        let key = match &desc.source {
            wgpu::ShaderSource::Wgsl(source) => Some(key(|h| (desc.label, source).hash(h))),
            _ => None,
        };
        self.kept(
            |k| &mut k.modules,
            key,
            None,
            || self.raw.create_shader_module(desc.clone()),
        )
    }

    pub fn create_bind_group_layout(
        &self,
        desc: &wgpu::BindGroupLayoutDescriptor<'_>,
    ) -> wgpu::BindGroupLayout {
        let key = key(|h| (desc.label, desc.entries).hash(h));
        self.kept(
            |k| &mut k.group_layouts,
            Some(key),
            None,
            || self.raw.create_bind_group_layout(desc),
        )
    }

    pub fn create_pipeline_layout(
        &self,
        desc: &wgpu::PipelineLayoutDescriptor<'_>,
    ) -> wgpu::PipelineLayout {
        let key = key(|h| (desc.label, desc.bind_group_layouts, desc.immediate_size).hash(h));
        self.kept(
            |k| &mut k.layouts,
            Some(key),
            None,
            || self.raw.create_pipeline_layout(desc),
        )
    }

    pub fn counts(&self) -> &Counts {
        &self.counts
    }

    pub fn create_bind_group(&self, desc: &wgpu::BindGroupDescriptor<'_>) -> wgpu::BindGroup {
        add(&self.counts.bind_groups, 1);
        self.raw.create_bind_group(desc)
    }

    pub fn create_buffer(&self, desc: &wgpu::BufferDescriptor<'_>) -> wgpu::Buffer {
        add(&self.counts.buffers, 1);
        self.raw.create_buffer(desc)
    }

    pub fn create_buffer_init(&self, desc: &wgpu::util::BufferInitDescriptor<'_>) -> wgpu::Buffer {
        add(&self.counts.buffers, 1);
        add(&self.counts.uploaded, desc.contents.len() as u64);
        self.raw.create_buffer_init(desc)
    }

    pub fn create_texture_with_data(
        &self,
        queue: &wgpu::Queue,
        desc: &wgpu::TextureDescriptor<'_>,
        order: wgpu::util::TextureDataOrder,
        data: &[u8],
    ) -> wgpu::Texture {
        add(&self.counts.uploaded, data.len() as u64);
        self.raw.create_texture_with_data(queue, desc, order, data)
    }

    pub fn create_render_pipeline(
        &self,
        desc: &wgpu::RenderPipelineDescriptor<'_>,
    ) -> wgpu::RenderPipeline {
        let key = key(|h| {
            let v = &desc.vertex;
            (desc.label, desc.layout, v.module, v.entry_point).hash(h);
            options(h, &v.compilation_options);
            for b in v.buffers.iter().flatten() {
                (b.array_stride, b.step_mode, b.attributes).hash(h);
            }
            (desc.primitive, &desc.depth_stencil, desc.multisample).hash(h);
            if let Some(f) = &desc.fragment {
                (f.module, f.entry_point, f.targets).hash(h);
                options(h, &f.compilation_options);
            }
            (desc.multiview_mask, desc.cache.is_some()).hash(h);
        });
        self.kept(
            |k| &mut k.render,
            Some(key),
            Some(&self.counts.pipelines),
            || self.raw.create_render_pipeline(desc),
        )
    }

    pub fn create_compute_pipeline(
        &self,
        desc: &wgpu::ComputePipelineDescriptor<'_>,
    ) -> wgpu::ComputePipeline {
        let key = key(|h| {
            (desc.label, desc.layout, desc.module, desc.entry_point).hash(h);
            options(h, &desc.compilation_options);
            desc.cache.is_some().hash(h);
        });
        self.kept(
            |k| &mut k.compute,
            Some(key),
            Some(&self.counts.pipelines),
            || self.raw.create_compute_pipeline(desc),
        )
    }
}

/// What [`Queue::write_changed`] last wrote to one buffer.
#[derive(Debug, Default)]
pub struct Written(std::sync::Mutex<Option<(wgpu::Buffer, Vec<u8>)>>);

/// The app's wgpu queue, counting the bytes it uploads.
#[derive(Clone, Debug)]
pub struct Queue {
    raw: wgpu::Queue,
    counts: Arc<Counts>,
}

impl Deref for Queue {
    type Target = wgpu::Queue;
    fn deref(&self) -> &wgpu::Queue {
        &self.raw
    }
}

impl Queue {
    pub fn new(raw: wgpu::Queue, counts: Arc<Counts>) -> Queue {
        Queue { raw, counts }
    }

    pub fn write_buffer(&self, buffer: &wgpu::Buffer, offset: wgpu::BufferAddress, data: &[u8]) {
        add(&self.counts.uploaded, data.len() as u64);
        add(&self.counts.writes, 1);
        self.raw.write_buffer(buffer, offset, data);
    }

    /// Writes `data` at the buffer's start, but only the 4-byte words that differ from what this
    /// call last wrote to the same buffer, as `written` holds it: a uniform rewritten each frame
    /// uploads what changed (#1903: at most 1 KB a frame while only the camera moves).
    pub fn write_changed(&self, buffer: &wgpu::Buffer, written: &Written, data: &[u8]) {
        let mut kept = written.0.lock().unwrap_or_else(|e| e.into_inner());
        let last = match &mut *kept {
            Some((b, last)) if b == buffer && last.len() == data.len() => last,
            _ => {
                self.write_buffer(buffer, 0, data);
                *kept = Some((buffer.clone(), data.to_vec()));
                return;
            }
        };
        let words = data.len().div_ceil(4);
        let span = |w: usize| w * 4..(w * 4 + 4).min(data.len());
        let mut w = 0;
        while w < words {
            if data[span(w)] == last[span(w)] {
                w += 1;
                continue;
            }
            let from = w * 4;
            while w < words && data[span(w)] != last[span(w)] {
                w += 1;
            }
            let to = (w * 4).min(data.len());
            self.write_buffer(buffer, from as u64, &data[from..to]);
            last[from..to].copy_from_slice(&data[from..to]);
        }
    }

    pub fn write_buffer_with(
        &self,
        buffer: &wgpu::Buffer,
        offset: wgpu::BufferAddress,
        size: wgpu::BufferSize,
    ) -> Option<wgpu::QueueWriteBufferView> {
        add(&self.counts.uploaded, size.get());
        add(&self.counts.writes, 1);
        self.raw.write_buffer_with(buffer, offset, size)
    }

    pub fn write_texture(
        &self,
        texture: wgpu::TexelCopyTextureInfo<'_>,
        data: &[u8],
        layout: wgpu::TexelCopyBufferLayout,
        size: wgpu::Extent3d,
    ) {
        add(&self.counts.uploaded, data.len() as u64);
        add(&self.counts.writes, 1);
        self.raw.write_texture(texture, data, layout, size);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{Backend, Gpu};

    /// wgpu stages every queue write in a buffer of its own, so a uniform's changed words go up
    /// in one write where at most a row of unchanged words sits between them: a matrix whose
    /// zeros hold, a vector whose fourth word does, a row a camera's turn leaves alone.
    #[test]
    fn changed_words_within_a_row_of_each_other_go_up_in_one_write() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let buffer = device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("test uniform"),
            size: 128,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let written = Written::default();
        // 32 words; `bump` changes one of them.
        let mut data = [0u8; 128];
        let bump = |data: &mut [u8; 128], word: usize| data[word * 4] += 1;
        let write = |data: &[u8; 128]| {
            let before = device.device.counts().read();
            device.queue.write_changed(&buffer, &written, data);
            let made = device.device.counts().read().since(before);
            (made.writes, made.uploaded)
        };
        assert_eq!(write(&data), (1, 128), "the first write is whole");
        assert_eq!(write(&data), (0, 0), "nothing changed");
        // Words 0 to 2 and 4 to 6 of two rows, each row's fourth word held; then word 11, a
        // whole row (words 7 to 10) further on.
        for word in [0, 1, 2, 4, 5, 6, 11] {
            bump(&mut data, word);
        }
        assert_eq!(
            write(&data),
            (1, 48),
            "words 0 to 11, the held ones among them"
        );
        // Word 17 sits five unchanged words past word 11: more than a row, so a write of its own.
        for word in [11, 17] {
            bump(&mut data, word);
        }
        assert_eq!(write(&data), (2, 8), "words 11 and 17, each alone");
        // The held words between two changed ones went up as they were: a change to one of them
        // is still seen, and one changed back is written back.
        bump(&mut data, 3);
        assert_eq!(write(&data), (1, 4), "word 3 alone");
        data[12] = 0;
        bump(&mut data, 31);
        assert_eq!(write(&data), (2, 8), "word 3 back, and the last word");
        let raised = device.take_raised();
        assert!(raised.is_empty(), "the device raised: {raised:?}");
    }
}
