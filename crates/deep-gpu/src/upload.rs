//! Uploads that settle (canvas primitives: Render worker). A frame writes at most its budget
//! class's `upload_bytes_per_frame`; whatever is left continues in later frames, and each frame
//! with uploads still pending reports settling. A canonical render, an export or a snapshot never
//! uses a frame that reports settling.

use std::collections::VecDeque;
use std::sync::Arc;

struct Pending {
    buffer: wgpu::Buffer,
    data: Arc<[u8]>,
    written: usize,
}

pub struct Uploads {
    per_frame: usize,
    pending: VecDeque<Pending>,
}

impl Uploads {
    pub fn new(upload_bytes_per_frame: usize) -> Self {
        // Writes go in whole copy units, so a budget is at least one.
        let unit = wgpu::COPY_BUFFER_ALIGNMENT as usize;
        Self {
            per_frame: upload_bytes_per_frame.max(unit) / unit * unit,
            pending: VecDeque::new(),
        }
    }

    /// Queues `data` for `buffer`, written from its start over the frames that follow.
    pub fn queue(&mut self, buffer: wgpu::Buffer, data: Arc<[u8]>) {
        self.pending.push_back(Pending {
            buffer,
            data,
            written: 0,
        });
    }

    /// Writes this frame's share; returns whether the frame is settling (uploads remain).
    pub fn flush(&mut self, queue: &wgpu::Queue) -> bool {
        let mut left = self.per_frame;
        while left > 0 {
            let Some(p) = self.pending.front_mut() else {
                break;
            };
            let n = left.min(p.data.len() - p.written);
            let end = p.written + n;
            // A tail shorter than one copy unit is padded with zeros.
            let unit = wgpu::COPY_BUFFER_ALIGNMENT as usize;
            if n % unit == 0 {
                queue.write_buffer(&p.buffer, p.written as u64, &p.data[p.written..end]);
            } else {
                let mut tail = p.data[p.written..end].to_vec();
                tail.resize(n.div_ceil(unit) * unit, 0);
                queue.write_buffer(&p.buffer, p.written as u64, &tail);
            }
            p.written = end;
            left -= n.div_ceil(unit) * unit;
            if p.written == p.data.len() {
                self.pending.pop_front();
            }
        }
        !self.pending.is_empty()
    }

    /// Drops every pending upload, as a lost device does: its buffers are gone.
    pub fn clear(&mut self) {
        self.pending.clear();
    }
}
