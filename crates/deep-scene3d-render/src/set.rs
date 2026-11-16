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
    /// The bytes [`Set::write`] changed and hasn't uploaded, from the first changed word to one
    /// past the last.
    pub(crate) run: Option<(usize, usize)>,
    /// The records the last [`Set::finish`] wrote, by index (#1921).
    pub(crate) uploaded: Vec<usize>,
}

/// The bytes from the first word `new` changes in `old` to one past the last, none when it
/// changes none: only these go up, since the rest is on the device already (#2496).
fn changed(new: &[u8], old: &[u8]) -> Option<std::ops::Range<usize>> {
    let words = || new.chunks(4).zip(old.chunks(4));
    let first = words().position(|(a, b)| a != b)?;
    let last = words().rposition(|(a, b)| a != b)?;
    Some(first * 4..(last + 1) * 4)
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
            // Changes less than a record apart go up in one write, from the first changed word
            // to the last: a write per record made a staging buffer per record, and a set that
            // moves moves whole. Changes a record or more apart are writes of their own, so a
            // moved solid's place and the tie rank it gives the solid beside it go up as their
            // words alone (#2496).
            let n = (self.next.len() / stride).min(self.records.len() / stride);
            let mut run: Option<(usize, usize)> = None;
            for i in 0..=n {
                let at = i * stride..(i + 1) * stride;
                let words = if i < n {
                    changed(&self.next[at.clone()], &self.records[at])
                } else {
                    None
                };
                if words.is_some() {
                    *written += 1;
                    self.uploaded.push(i);
                    self.revision += 1;
                }
                let span = words.map(|w| (i * stride + w.start, i * stride + w.end));
                match (run, span) {
                    (Some((start, end)), Some((from, to))) if from < end + stride => {
                        run = Some((start, to))
                    }
                    (last, span) => {
                        if let Some((start, end)) = last {
                            let bytes = &self.next[start..end];
                            deep_gpu::alloc::outside(|| {
                                device.queue.write_buffer(buffer, start as u64, bytes)
                            });
                        }
                        run = span;
                    }
                }
            }
        }
        std::mem::swap(&mut self.records, &mut self.next);
        members_changed
    }

    /// Takes record `i` when it changed, the set's members as they were. [`Set::flush`] uploads
    /// its changed words, in one write with changes less than a record before them, as
    /// [`Set::finish`] does.
    pub(crate) fn write(&mut self, device: &Device, i: usize, record: &[u8], written: &mut u32) {
        let at = i * self.stride;
        let Some(old) = self.records.get_mut(at..at + record.len()) else {
            return;
        };
        let Some(words) = changed(record, old) else {
            return;
        };
        old.copy_from_slice(record);
        let (from, to) = (at + words.start, at + words.end);
        match self.run {
            Some((start, end)) if (end..end + self.stride).contains(&from) => {
                self.run = Some((start, to))
            }
            _ => {
                self.flush(device);
                self.run = Some((from, to));
            }
        }
        *written += 1;
        self.revision += 1;
    }

    /// Uploads the changed words [`Set::write`] gathered.
    pub(crate) fn flush(&mut self, device: &Device) {
        if let (Some((start, end)), Some(buffer)) = (self.run.take(), &self.buffer) {
            let bytes = &self.records[start..end];
            deep_gpu::alloc::outside(|| device.queue.write_buffer(buffer, start as u64, bytes));
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
    use deep_gpu::device::{Backend, Gpu};

    /// #2496: item-0000 moves half a metre against item-0001, the next record, which takes tie
    /// rank 1. A frame's diff and the moved path each upload the two words that changed, the
    /// mover's x and the neighbour's rank, not the two 144-byte records.
    #[test]
    fn a_move_and_the_rank_it_changes_upload_their_words() {
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend gives a device");
        let device = gpu.device();
        let solid = |x: f32, tie| crate::SolidRecord {
            rows: [
                [1.0, 0.0, 0.0, x],
                [0.0, 1.0, 0.0, 0.5],
                [0.0, 0.0, 1.0, 0.0],
            ],
            tie,
            ..bytemuck::Zeroable::zeroed()
        };
        let apart = [solid(-59.25, 0), solid(-57.75, 0)];
        let together = [solid(-58.75, 0), solid(-57.75, 1)];
        let (mut set, mut generation, mut written) = (Set::default(), 0, 0);
        let mut uploads = |records: &[crate::SolidRecord; 2], moved_path: bool| {
            let before = device.device.counts().read();
            if moved_path {
                for (i, r) in records.iter().enumerate() {
                    set.write(&device, i, bytemuck::bytes_of(r), &mut written);
                }
                set.flush(&device);
            } else {
                set.begin();
                for (i, r) in records.iter().enumerate() {
                    set.push(&format!("item-000{i}"), bytemuck::bytes_of(r));
                }
                set.finish(&device, &mut generation, &mut written);
            }
            let made = device.device.counts().read().since(before);
            (made.writes, made.uploaded)
        };
        uploads(&apart, false);
        assert_eq!(uploads(&together, false), (2, 8), "a frame's diff");
        uploads(&apart, true);
        assert_eq!(uploads(&together, true), (2, 8), "the moved path");
    }

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
