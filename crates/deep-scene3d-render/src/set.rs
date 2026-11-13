//! A family's instance records in a batch, one buffer each, written by the runs that changed
//! (#484, #1921).
//!
//! #537 (Instance `instance@1`: logic columns): a batch of an instancer fed by logic holds one
//! record per slot, record i at slot i, and a slot with nothing to draw holds a zero record,
//! which rasterizes nothing and carries no pick. Its members never change while its slot count
//! holds, so a slot that spawns, despawns, moves or takes a new generation rewrites its own
//! record alone, and `element_uploads` names that slot.

use deep_gpu::device::Device;

use crate::cull;

/// One family's instance records in a batch, in a buffer of their own. A frame gathers its
/// records into `next` with [`Set::push`], kept from frame to frame, so a frame whose members
/// hold allocates nothing; [`Set::finish`] writes what changed.
#[derive(Default)]
pub(crate) struct Set {
    pub(crate) buffer: Option<wgpu::Buffer>,
    /// Which allocation the buffer is: a new one is a new resource in the draw key.
    pub(crate) generation: u64,
    pub(crate) capacity: usize,
    pub(crate) owners: Vec<String>,
    /// The records, each `stride` bytes, end to end.
    pub(crate) records: Vec<u8>,
    pub(crate) stride: usize,
    /// This frame's records and how many, and its owners once they differ from `owners`.
    pub(crate) next: Vec<u8>,
    pub(crate) count: usize,
    pub(crate) new_owners: Option<Vec<String>>,
    /// It holds a less detailed band's draw inside a margin (#425), which draws last.
    pub(crate) lower: bool,
    /// It holds a part whose subsurface spreads (#481), which the share pass draws again.
    pub(crate) subsurface: bool,
    /// Bumped whenever a record changes, which culls every view again (#484).
    pub(crate) revision: u64,
    /// An instancer's batch: its prototype's bounds, each record's row in the instancer, its
    /// records' f64 models while the renderer draws from the CPU's cull, and its cull (#484).
    pub(crate) bounds: [[f64; 3]; 2],
    pub(crate) elements: Vec<u32>,
    pub(crate) models: Vec<[[f64; 4]; 3]>,
    pub(crate) cull: Option<cull::Culled>,
    /// The records [`Set::write`] changed and hasn't uploaded: the first and one past the last.
    pub(crate) run: Option<(usize, usize)>,
    /// The records the last [`Set::finish`] wrote, by index (#1921).
    pub(crate) uploaded: Vec<usize>,
}

impl Set {
    pub(crate) fn begin(&mut self) {
        self.next.clear();
        self.count = 0;
        self.new_owners = None;
        self.lower = false;
        self.subsurface = false;
        self.elements.clear();
        self.models.clear();
    }

    pub(crate) fn push(&mut self, owner: &str, record: &[u8]) {
        self.stride = record.len();
        if self.new_owners.is_none() && self.owners.get(self.count).is_none_or(|o| o != owner) {
            self.new_owners = Some(self.owners[..self.count].to_vec());
        }
        if let Some(owners) = self.new_owners.as_mut() {
            owners.push(owner.to_string());
        }
        self.next.extend_from_slice(record);
        self.count += 1;
    }

    /// Writes the records that changed, or all of them when the set's members changed. True when
    /// the members changed.
    pub(crate) fn finish(
        &mut self,
        device: &Device,
        next_generation: &mut u64,
        written: &mut u32,
    ) -> bool {
        if self.count != self.owners.len() && self.new_owners.is_none() {
            self.new_owners = Some(self.owners[..self.count].to_vec());
        }
        let stride = self.stride.max(16);
        let members_changed = self.new_owners.is_some() || self.buffer.is_none();
        self.uploaded.clear();
        if members_changed {
            if self.buffer.is_none() || self.capacity < self.count {
                // A set no record has reached yet has no stride: its stand-in buffer holds none,
                // so its first record allocates again (#450: a trail that starts with no segment).
                self.capacity = if self.stride == 0 {
                    0
                } else {
                    self.count.max(1)
                };
                *next_generation += 1;
                self.generation = *next_generation;
                self.buffer = Some(device.device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("scene3d instances"),
                    size: (stride * self.capacity.max(1)) as u64,
                    // A culled batch's vertex stage reads its records from storage (#484).
                    usage: wgpu::BufferUsages::VERTEX
                        | wgpu::BufferUsages::STORAGE
                        | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                }));
            }
            let buffer = self.buffer.as_ref().expect("allocated above");
            if self.count > 0 {
                deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, 0, &self.next));
            }
            *written += self.count as u32;
            self.uploaded.extend(0..self.count);
            self.revision += 1;
            if let Some(owners) = self.new_owners.take() {
                self.owners = owners;
            }
        } else {
            let buffer = self
                .buffer
                .as_ref()
                .expect("a set with members has a buffer");
            // Each run of adjacent changed records goes in one write: a write per record made
            // a staging buffer per record, and a set that moves moves whole.
            let n = (self.next.len() / stride).min(self.records.len() / stride);
            let mut run: Option<usize> = None;
            for i in 0..=n {
                let at = i * stride..(i + 1) * stride;
                if i < n && self.next[at.clone()] != self.records[at] {
                    *written += 1;
                    self.uploaded.push(i);
                    self.revision += 1;
                    run.get_or_insert(i);
                } else if let Some(first) = run.take() {
                    let bytes = &self.next[first * stride..i * stride];
                    deep_gpu::alloc::outside(|| {
                        device
                            .queue
                            .write_buffer(buffer, (first * stride) as u64, bytes)
                    });
                }
            }
        }
        std::mem::swap(&mut self.records, &mut self.next);
        members_changed
    }

    /// Takes record `i` when it changed, the set's members as they were. [`Set::flush`] uploads
    /// it, with the neighbours that changed beside it in one write.
    pub(crate) fn write(&mut self, device: &Device, i: usize, record: &[u8], written: &mut u32) {
        let at = i * self.stride;
        let Some(old) = self.records.get_mut(at..at + record.len()) else {
            return;
        };
        if old != record {
            old.copy_from_slice(record);
            match self.run {
                Some((first, end)) if end == i => self.run = Some((first, i + 1)),
                _ => {
                    self.flush(device);
                    self.run = Some((i, i + 1));
                }
            }
            *written += 1;
            self.revision += 1;
        }
    }

    /// Uploads the run of changed records [`Set::write`] gathered.
    pub(crate) fn flush(&mut self, device: &Device) {
        if let (Some((first, end)), Some(buffer)) = (self.run.take(), &self.buffer) {
            let bytes = &self.records[first * self.stride..end * self.stride];
            deep_gpu::alloc::outside(|| {
                device
                    .queue
                    .write_buffer(buffer, (first * self.stride) as u64, bytes)
            });
        }
    }

    pub(crate) fn len(&self) -> u32 {
        self.owners.len() as u32
    }

    /// The `<instancer>#<id>` owners of the records the last [`Set::finish`] wrote (#1921).
    pub(crate) fn uploaded_elements(&self) -> impl Iterator<Item = (&str, u32)> {
        let owners = self.uploaded.iter().filter_map(|i| self.owners.get(*i));
        owners.filter_map(|o| {
            let (item, e) = o.rsplit_once('#')?;
            Some((item, e.parse().ok()?))
        })
    }
}

impl Set {
    /// This frame's records, pushed in any order with each one's slot in `elements`, laid out
    /// by slot over `slots` records of `stride` bytes, the owners `<instancer>#<slot>`.
    pub(crate) fn lay(&mut self, slots: usize, stride: usize) {
        let named = self.new_owners.as_ref().and_then(|o| o.first());
        let Some(instancer) = named
            .or(self.owners.first())
            .and_then(|o| o.split('#').next())
            .map(str::to_string)
        else {
            return;
        };
        let mut next = vec![0u8; slots * stride];
        let mut models = vec![[[0.0; 4]; 3]; if self.models.is_empty() { 0 } else { slots }];
        for (j, &slot) in self.elements.iter().enumerate() {
            let (at, from) = (slot as usize * stride, j * stride);
            if let (Some(to), Some(record)) = (
                next.get_mut(at..at + stride),
                self.next.get(from..from + stride),
            ) {
                to.copy_from_slice(record);
                if let (Some(m), Some(model)) = (models.get_mut(slot as usize), self.models.get(j))
                {
                    *m = *model;
                }
            }
        }
        self.next = next;
        self.models = models;
        self.count = slots;
        self.stride = stride;
        self.elements = (0..slots as u32).collect();
        let laid = self.owners.len() == slots
            && (self.owners.iter().enumerate()).all(|(i, o)| *o == format!("{instancer}#{i}"));
        self.new_owners = (!laid).then(|| (0..slots).map(|i| format!("{instancer}#{i}")).collect());
    }
}

impl Set {
    /// #537: a line set's records the last [`Set::finish`] wrote, each as its line and its place
    /// among that line's segments.
    pub(crate) fn uploaded_segments(&self) -> Vec<(&str, u32)> {
        let mut first = std::collections::BTreeMap::new();
        for (i, o) in self.owners.iter().enumerate() {
            first.entry(o.as_str()).or_insert(i);
        }
        let place = |i: usize| {
            Some((
                self.owners.get(i)?.as_str(),
                (i - first[self.owners[i].as_str()]) as u32,
            ))
        };
        self.uploaded.iter().filter_map(|&i| place(i)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two records pushed out of slot order land at their slots among four, the rest zero, and
    /// the owners name each slot; laid again the same way, the members hold.
    #[test]
    fn records_land_at_their_slots() {
        let mut set = Set::default();
        set.begin();
        set.push("units#3.1", &[3u8; 16]);
        set.elements.push(3);
        set.push("units#1.2", &[1u8; 16]);
        set.elements.push(1);
        set.lay(4, 16);
        let mut want = vec![0u8; 64];
        want[16..32].fill(1);
        want[48..64].fill(3);
        assert_eq!(set.next, want);
        let owners = set.new_owners.clone().expect("new members");
        assert_eq!(owners, ["units#0", "units#1", "units#2", "units#3"]);
        set.owners = owners;
        set.begin();
        set.push("units#1.2", &[1u8; 16]);
        set.elements.push(1);
        set.lay(4, 16);
        assert!(set.new_owners.is_none());
    }
}
