//! The GPU surface's slots and the fences between the renderer and GPUI (canvas primitives: GPU
//! surface). A frame renders into a free slot, which turns ready when the GPU signals it done; the
//! UI thread shows the newest ready slot and holds it until every GPUI command buffer that sampled
//! it completes, then releases it. With no free slot the frame is skipped. Every move is written to
//! the fence record, so a test can read back that no slot was drawn into while on screen and none
//! was released before GPUI finished with it.
//!
//! The ring is plain data with no GPU in it: the noop lane runs it, and a lock around it is held
//! only for these O(slots) moves, never while allocating or waiting.

use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotState {
    Free,
    Rendering,
    Ready,
    OnScreen,
}

impl SlotState {
    pub fn name(self) -> &'static str {
        match self {
            SlotState::Free => "free",
            SlotState::Rendering => "rendering",
            SlotState::Ready => "ready",
            SlotState::OnScreen => "on_screen",
        }
    }
}

#[derive(Clone, Debug)]
struct Slot {
    state: SlotState,
    /// The frame the slot holds, once a render began in it.
    frame: Option<u64>,
    /// The size it was drawn at, so a frame from before a resize is never shown after it.
    size: [u32; 2],
    /// GPUI command buffers that sampled the slot and haven't completed.
    sampled_by: BTreeSet<u64>,
    /// Whether a newer slot replaced it on screen, so it frees once `sampled_by` empties.
    retiring: bool,
}

/// One move, as the fence record keeps it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mark {
    /// A render began in the slot.
    Drawn { frame: u64, slot: usize },
    /// The GPU signalled the slot's render done (its `gpu_done` fence).
    GpuDone { frame: u64, slot: usize },
    /// The UI thread latched the slot for the window.
    Shown { frame: u64, slot: usize },
    /// A GPUI frame command buffer that samples the slot, holding `frame`, was committed.
    Sampled {
        frame: u64,
        slot: usize,
        buffer: u64,
    },
    /// That command buffer completed, after `gpu_ns` on the GPU.
    Completed { buffer: u64, gpu_ns: u64 },
    /// The slot was released (its `released` fence) and is free again.
    Released { slot: usize },
    /// A ready slot was passed over for a newer one and freed without being shown.
    Dropped { frame: u64, slot: usize },
    /// No slot was free, so the frame was skipped.
    Skipped { frame: u64 },
}

pub struct Ring {
    slots: Vec<Slot>,
    shown: Option<usize>,
    size: [u32; 2],
    record: Vec<Mark>,
    recording: bool,
    /// The planted handoff that releases a shown slot when GPUI's frame is submitted, before its
    /// command buffer completes.
    releases_early: bool,
}

impl Ring {
    /// A ring of 2 or 3 slots at `size` pixels.
    pub fn new(slots: usize, size: [u32; 2]) -> Self {
        assert!((2..=3).contains(&slots), "a GPU surface has 2 or 3 slots");
        let slot = Slot {
            state: SlotState::Free,
            frame: None,
            size,
            sampled_by: BTreeSet::new(),
            retiring: false,
        };
        Self {
            slots: vec![slot; slots],
            shown: None,
            size,
            record: Vec::new(),
            recording: false,
            releases_early: false,
        }
    }

    pub fn plant_early_release(&mut self) {
        self.releases_early = true;
    }

    /// Keeps every move from now on in the fence record (a test's run turns this on).
    pub fn record(&mut self, on: bool) {
        self.recording = on;
    }

    pub fn take_record(&mut self) -> Vec<Mark> {
        std::mem::take(&mut self.record)
    }

    fn mark(&mut self, mark: Mark) {
        if self.recording {
            self.record.push(mark);
        }
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    pub fn state(&self, slot: usize) -> SlotState {
        self.slots[slot].state
    }

    /// The window's new size. A slot drawn at the old size is never shown again; the renderer
    /// reallocates each slot lazily, when it next begins a render in it.
    pub fn resize(&mut self, size: [u32; 2]) {
        self.size = size;
        for i in 0..self.slots.len() {
            if self.slots[i].state == SlotState::Ready && self.slots[i].size != size {
                let frame = self.slots[i].frame.unwrap_or_default();
                self.slots[i].state = SlotState::Free;
                self.mark(Mark::Dropped { frame, slot: i });
            }
        }
    }

    /// Takes a free slot for `frame`, or skips the frame when none is free. The returned flag says
    /// whether the slot's storage is at another size and must be reallocated before drawing.
    pub fn begin(&mut self, frame: u64) -> Option<(usize, bool)> {
        let Some(i) = self.slots.iter().position(|s| s.state == SlotState::Free) else {
            self.mark(Mark::Skipped { frame });
            return None;
        };
        let stale = self.slots[i].size != self.size;
        let size = self.size;
        let slot = &mut self.slots[i];
        slot.state = SlotState::Rendering;
        slot.frame = Some(frame);
        slot.size = size;
        self.mark(Mark::Drawn { frame, slot: i });
        Some((i, stale))
    }

    /// The `gpu_done` fence: the slot's render finished on the GPU.
    pub fn gpu_done(&mut self, slot: usize) {
        let s = &mut self.slots[slot];
        if s.state != SlotState::Rendering {
            return;
        }
        let frame = s.frame.unwrap_or_default();
        if s.size == self.size {
            s.state = SlotState::Ready;
            self.mark(Mark::GpuDone { frame, slot });
        } else {
            // Drawn before a resize: done, but never shown.
            s.state = SlotState::Free;
            self.mark(Mark::GpuDone { frame, slot });
            self.mark(Mark::Dropped { frame, slot });
        }
    }

    /// A render that never reached the GPU (a lost device) gives its slot back.
    pub fn abandon(&mut self, slot: usize) {
        if self.slots[slot].state == SlotState::Rendering {
            let frame = self.slots[slot].frame.unwrap_or_default();
            self.slots[slot].state = SlotState::Free;
            self.mark(Mark::Dropped { frame, slot });
        }
    }

    /// The UI thread's latch: shows the newest ready slot, if it's newer than the one on screen,
    /// and returns the slot to draw this frame with the frame it holds. Older ready slots are
    /// freed unseen; the slot it replaces retires until GPUI is done reading it.
    pub fn latch(&mut self) -> Option<(usize, u64)> {
        let newest = (0..self.slots.len())
            .filter(|&i| self.slots[i].state == SlotState::Ready)
            .max_by_key(|&i| self.slots[i].frame);
        if let Some(n) = newest {
            for i in 0..self.slots.len() {
                if i != n && self.slots[i].state == SlotState::Ready {
                    let frame = self.slots[i].frame.unwrap_or_default();
                    self.slots[i].state = SlotState::Free;
                    self.mark(Mark::Dropped { frame, slot: i });
                }
            }
            if let Some(old) = self.shown.replace(n) {
                self.slots[old].retiring = true;
                self.free_if_done(old);
            }
            self.slots[n].state = SlotState::OnScreen;
            self.slots[n].retiring = false;
            let frame = self.slots[n].frame.unwrap_or_default();
            self.mark(Mark::Shown { frame, slot: n });
        }
        self.shown
            .map(|i| (i, self.slots[i].frame.unwrap_or_default()))
    }

    /// Takes the shown slot off screen (the view closed or its device was lost); it frees once
    /// GPUI is done reading it.
    pub fn hide(&mut self) {
        if let Some(old) = self.shown.take() {
            self.slots[old].retiring = true;
            self.free_if_done(old);
        }
    }

    /// A GPUI frame command buffer that samples `slot` was committed.
    pub fn sampled(&mut self, slot: usize, buffer: u64) {
        self.slots[slot].sampled_by.insert(buffer);
        let frame = self.slots[slot].frame.unwrap_or_default();
        self.mark(Mark::Sampled {
            frame,
            slot,
            buffer,
        });
        if self.releases_early && self.slots[slot].state == SlotState::OnScreen {
            self.slots[slot].state = SlotState::Free;
            if self.shown == Some(slot) {
                self.shown = None;
            }
            self.mark(Mark::Released { slot });
        }
    }

    /// That command buffer completed: each retiring slot it was the last reader of is released.
    pub fn completed(&mut self, buffer: u64, gpu_ns: u64) {
        let mut any = false;
        for i in 0..self.slots.len() {
            any |= self.slots[i].sampled_by.remove(&buffer);
        }
        if !any {
            return;
        }
        self.mark(Mark::Completed { buffer, gpu_ns });
        for i in 0..self.slots.len() {
            self.free_if_done(i);
        }
    }

    fn free_if_done(&mut self, slot: usize) {
        let s = &mut self.slots[slot];
        if s.retiring && s.sampled_by.is_empty() && s.state == SlotState::OnScreen {
            s.state = SlotState::Free;
            s.retiring = false;
            self.mark(Mark::Released { slot });
        }
    }
}

/// What a fence record shows went wrong, if anything: a slot drawn into while on screen or still
/// read by GPUI, a slot released before every command buffer that sampled it completed, or a frame
/// shown before its GPU work was done.
pub fn audit(record: &[Mark], slots: usize) -> Result<(), String> {
    #[derive(Clone, Default)]
    struct Seen {
        on_screen: bool,
        done: bool,
        frame: u64,
        readers: BTreeSet<u64>,
    }
    let mut seen = vec![Seen::default(); slots];
    let mut open: BTreeSet<u64> = BTreeSet::new();
    for (n, mark) in record.iter().enumerate() {
        match *mark {
            Mark::Drawn { frame, slot } => {
                let s = &mut seen[slot];
                if s.on_screen || !s.readers.is_empty() {
                    return Err(format!(
                        "mark {n}: frame {frame} drawn into slot {slot} while it is on screen"
                    ));
                }
                *s = Seen {
                    frame,
                    ..Seen::default()
                };
            }
            Mark::GpuDone { slot, .. } => seen[slot].done = true,
            Mark::Shown { frame, slot } => {
                let s = &mut seen[slot];
                if !s.done || s.frame != frame {
                    return Err(format!(
                        "mark {n}: frame {frame} shown from slot {slot} before its GPU work was done"
                    ));
                }
                s.on_screen = true;
            }
            Mark::Sampled { slot, buffer, .. } => {
                seen[slot].readers.insert(buffer);
                open.insert(buffer);
            }
            Mark::Completed { buffer, .. } => {
                open.remove(&buffer);
                for s in &mut seen {
                    s.readers.remove(&buffer);
                }
            }
            Mark::Released { slot } => {
                let s = &mut seen[slot];
                if let Some(b) = s.readers.iter().next() {
                    return Err(format!(
                        "mark {n}: slot {slot} released before GPUI command buffer {b} completed"
                    ));
                }
                s.on_screen = false;
            }
            Mark::Dropped { slot, .. } => seen[slot].on_screen = false,
            Mark::Skipped { .. } => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring() -> Ring {
        let mut r = Ring::new(3, [8, 8]);
        r.record(true);
        r
    }

    #[test]
    fn a_shown_slot_is_held_until_gpui_completes() {
        let mut r = ring();
        let (a, _) = r.begin(1).unwrap();
        r.gpu_done(a);
        assert_eq!(r.latch(), Some((a, 1)));
        r.sampled(a, 10);
        let (b, _) = r.begin(2).unwrap();
        r.gpu_done(b);
        assert_eq!(r.latch(), Some((b, 2)));
        // `a` is off screen but GPUI's buffer 10 still reads it.
        assert_eq!(r.state(a), SlotState::OnScreen);
        let (c, _) = r.begin(3).unwrap();
        assert_ne!(c, a);
        assert!(r.begin(4).is_none(), "no free slot: the frame is skipped");
        r.completed(10, 0);
        assert_eq!(r.state(a), SlotState::Free);
        audit(&r.take_record(), 3).unwrap();
    }

    #[test]
    fn the_newest_ready_slot_wins_and_older_ones_free_unseen() {
        let mut r = ring();
        let (a, _) = r.begin(1).unwrap();
        let (b, _) = r.begin(2).unwrap();
        r.gpu_done(b);
        r.gpu_done(a);
        assert_eq!(r.latch(), Some((b, 2)));
        assert_eq!(r.state(a), SlotState::Free);
        audit(&r.take_record(), 3).unwrap();
    }

    #[test]
    fn a_frame_drawn_before_a_resize_is_never_shown() {
        let mut r = ring();
        let (a, _) = r.begin(1).unwrap();
        r.resize([16, 8]);
        r.gpu_done(a);
        assert_eq!(r.latch(), None);
        let (b, stale) = r.begin(2).unwrap();
        assert!(stale || b != a);
        r.gpu_done(b);
        assert_eq!(r.latch(), Some((b, 2)));
    }

    #[test]
    fn the_audit_names_a_slot_drawn_while_on_screen() {
        let record = [
            Mark::Drawn { frame: 1, slot: 0 },
            Mark::GpuDone { frame: 1, slot: 0 },
            Mark::Shown { frame: 1, slot: 0 },
            Mark::Drawn { frame: 2, slot: 0 },
        ];
        let err = audit(&record, 2).unwrap_err();
        assert!(
            err.contains("frame 2 drawn into slot 0 while it is on screen"),
            "{err}"
        );
    }

    #[test]
    fn the_audit_names_an_early_release() {
        let record = [
            Mark::Drawn { frame: 1, slot: 0 },
            Mark::GpuDone { frame: 1, slot: 0 },
            Mark::Shown { frame: 1, slot: 0 },
            Mark::Sampled {
                frame: 1,
                slot: 0,
                buffer: 7,
            },
            Mark::Released { slot: 0 },
        ];
        let err = audit(&record, 2).unwrap_err();
        assert!(
            err.contains("released before GPUI command buffer 7 completed"),
            "{err}"
        );
    }
}
