//! #551: logic's rollback ring (canvas primitives: Net: rollback). At each of the last `window +
//! 1` match steps it keeps each item's globals, arrays, move queue and cursors as they stood
//! then, and the 64 KiB memory pages the steps up to the next match step wrote, as they were
//! before them, never a whole memory. A rollback copies those pages back over memory, newest
//! step first, down to its step, so it needs no whole checkpoint and rebuilds the whole memory
//! exactly; what the replaced steps made is dropped: their rows, and the checkpoints the item's
//! own ring took at them.

use super::*;

/// The planted rings, by the names a check's input gives them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// Each match step's pages are kept as the steps left them, not as they were before them.
    PagesAsLeft,
    /// Every page each match step wrote is kept whole, as a full copy would be: the reference a
    /// page-diff ring is compared against.
    Full,
    /// A rollback keeps the checkpoints the items' own rings took at the steps it replaced.
    KeepsReplaced,
}

impl Plant {
    pub fn named(name: &str) -> Option<Plant> {
        Some(match name {
            "net_ring_keeps_after" => Plant::PagesAsLeft,
            "net_ring_full_copies" => Plant::Full,
            "net_keeps_replaced_checkpoint" => Plant::KeepsReplaced,
            _ => return None,
        })
    }
}

/// One item at one match step.
struct Held {
    globals: Vec<Val>,
    next: i64,
    ran: i64,
    last: i64,
    failed: bool,
    asked: Option<(i32, bool)>,
    arrays: Vec<u8>,
    prev: Vec<u8>,
    cursor: BTreeMap<String, usize>,
    pending: BTreeMap<String, VecDeque<Entry>>,
    mirrors: Vec<Pending>,
    /// The pages the steps up to the next match step wrote, as they were before them (or, in
    /// the full ring, the whole memory then).
    pages: Vec<(u32, Vec<u8>)>,
}

/// Every item at one match step.
struct Snap {
    step: i64,
    seen: u64,
    published: Vec<Vec<u8>>,
    items: Vec<Held>,
}

/// The rollback ring of one world's items, beside the world: a match's copy keeps one.
pub struct Ring {
    size: usize,
    plant: Plant,
    snaps: VecDeque<Snap>,
    /// Each item's memory as it stood at the newest match step: what a page was before a step.
    shadows: Vec<Vec<u8>>,
    /// The snapshot bytes the ring has written: the pages it kept.
    written: u64,
}

impl Ring {
    /// A rollback ring for `w`'s items: a checkpoint at each of the last `size` match steps.
    pub fn new(w: &mut World, size: usize, plant: Plant) -> Ring {
        let shadows = w.lives.iter_mut().map(|l| l.memory().to_vec()).collect();
        for l in &mut w.lives {
            l.rdirty.clear();
        }
        Ring {
            size: size.max(1),
            plant,
            snaps: VecDeque::new(),
            shadows,
            written: 0,
        }
    }

    /// The snapshot bytes the ring has written since it started.
    pub fn written(&self) -> u64 {
        self.written
    }

    /// The pages the newest match step wrote, as they were before it, go to its checkpoint, and
    /// the shadow takes them as they are now.
    fn close(&mut self, w: &mut World) {
        let Some(snap) = self.snaps.back_mut() else {
            for l in &mut w.lives {
                l.rdirty.clear();
            }
            return;
        };
        for (i, l) in w.lives.iter_mut().enumerate() {
            let pages: Vec<u32> = std::mem::take(&mut l.rdirty).into_iter().collect();
            let shadow = &mut self.shadows[i];
            let memory = l.runner.memory("memory").unwrap_or(&[]);
            let whole = |p: &u32| (*p as u64 + 1) * PAGE <= memory.len() as u64;
            let page = |m: &[u8], p: u32| m[p as usize * PAGE as usize..][..PAGE as usize].to_vec();
            let held = &mut snap.items[i];
            if self.plant == Plant::Full {
                held.pages = (0..(memory.len() as u64 / PAGE) as u32)
                    .map(|p| (p, page(shadow, p)))
                    .collect();
            } else {
                for p in pages.iter().copied().filter(whole) {
                    let kept = match self.plant {
                        Plant::PagesAsLeft => page(memory, p),
                        _ => page(shadow, p),
                    };
                    held.pages.push((p, kept));
                }
            }
            self.written += held.pages.len() as u64 * PAGE;
            for p in pages.into_iter().filter(whole) {
                let at = p as usize * PAGE as usize..(p as usize + 1) * PAGE as usize;
                shadow[at.clone()].copy_from_slice(&memory[at]);
            }
        }
    }

    /// The rollback checkpoint at match step `step`, as `w` is about to run it: the newest one
    /// before it gets the pages its steps wrote. The ring keeps the last `window + 1`.
    pub fn snap(&mut self, w: &mut World, step: i64) {
        self.close(w);
        let items: Vec<Held> = w
            .lives
            .iter_mut()
            .map(|l| Held {
                globals: l.globals(),
                next: l.next,
                ran: l.ran,
                last: l.last,
                failed: l.failed,
                asked: l.asked,
                arrays: l.arrays.clone(),
                prev: l.prev.clone(),
                cursor: l.cursor.clone(),
                pending: l.pending.clone(),
                mirrors: l.mirrors.clone(),
                pages: Vec::new(),
            })
            .collect();
        self.snaps.retain(|s| s.step < step);
        self.snaps.push_back(Snap {
            step,
            seen: w.seen,
            published: w.published.clone(),
            items,
        });
        while self.snaps.len() > self.size {
            self.snaps.pop_front();
        }
    }

    /// Rolls `w` back to the rollback checkpoint at match step `step`, which starts at `t`: every
    /// page the steps since wrote is copied back, newest step first, then each item's globals,
    /// arrays and move queue as they stood. What the replaced steps made goes: their rows in
    /// `rec`, the entries stamped from `t` on, which the copy enters again, and every checkpoint
    /// the items' own rings took after `step`, whose pages the next one takes instead.
    pub fn roll_back(
        &mut self,
        w: &mut World,
        step: i64,
        t: i64,
        rec: &mut Record,
    ) -> Result<(), Failed> {
        self.close(w);
        // The entries stamped from the match step's start on join again as their steps run.
        for list in w.track.values_mut() {
            list.retain(|e| e.t < t);
        }
        let Some(at) = self.snaps.iter().position(|s| s.step == step) else {
            return Err(json!({"code": "past_window", "step": step,
                "what": format!("the rollback ring holds no checkpoint at match step {step}")}));
        };
        let mut restored: Vec<BTreeSet<u32>> = vec![BTreeSet::new(); w.lives.len()];
        for snap in self.snaps.iter().skip(at).rev() {
            for (i, held) in snap.items.iter().enumerate() {
                let memory = w.lives[i].runner.memory_mut("memory").expect("a memory");
                let shadow = &mut self.shadows[i];
                for (p, bytes) in &held.pages {
                    let r = *p as usize * PAGE as usize..(*p as usize + 1) * PAGE as usize;
                    memory[r.clone()].copy_from_slice(bytes);
                    shadow[r].copy_from_slice(bytes);
                    restored[i].insert(*p);
                }
            }
        }
        let snap = self.snaps.drain(at..).next().expect("the snap");
        w.seen = snap.seen;
        w.published = snap.published;
        let keeps = self.plant == Plant::KeepsReplaced;
        for (i, (l, held)) in w.lives.iter_mut().zip(snap.items).enumerate() {
            for ((name, _), v) in l.names.clone().globals.iter().zip(&held.globals) {
                l.runner
                    .set(name, *v)
                    .map_err(|e| json!({"code": "run_failed", "what": e}))?;
            }
            l.next = held.next;
            l.ran = held.ran;
            l.last = held.last;
            l.failed = held.failed;
            l.asked = held.asked;
            l.arrays = held.arrays;
            l.prev = held.prev;
            l.cursor = held.cursor;
            l.pending = held.pending;
            l.mirrors = held.mirrors;
            l.late = false;
            l.rdirty.clear();
            // The item's own ring keeps no checkpoint a replaced step took: the next one it
            // takes holds every page those held, and every page the rollback copied back.
            if !keeps {
                let next = l.next;
                let (kept, gone): (Vec<Stored>, Vec<Stored>) = std::mem::take(&mut l.stored)
                    .into_iter()
                    .partition(|s| s.step <= next);
                l.stored = kept;
                for s in gone {
                    match s.memory {
                        Memory::Whole(m) => l.dirty.extend(0..(m.len() as u64 / PAGE) as u32),
                        Memory::Pages(p) => l.dirty.extend(p.into_keys()),
                    }
                }
                if l.checked.is_some_and(|c| c > next) {
                    l.checked = None;
                }
            }
            l.dirty.extend(restored[i].iter().copied());
            l.kdirty.extend(restored[i].iter().copied());
            rec.drop_from(i, &w.piece.items[i].id, l.next);
        }
        Ok(())
    }
}

impl Record {
    /// Item `id`'s rows, checkpoints, fuel and traps from step `from` on go: a rollback runs those
    /// steps again.
    pub(crate) fn drop_from(&mut self, i: usize, id: &str, from: i64) {
        for (_, (items, arrays)) in self.steps.range_mut(from..) {
            items.remove(id);
            arrays.retain(|k, _| !k.starts_with(&format!("{id}.")));
        }
        self.steps
            .retain(|_, (items, arrays)| !items.is_empty() || !arrays.is_empty());
        if let Some(list) = self.checkpoints.get_mut(id).and_then(Value::as_array_mut) {
            list.retain(|c| c["step"].as_i64().is_some_and(|s| s <= from));
        }
        if let Some(w) = self.wholes.get_mut(id) {
            w.retain(|s, _| *s <= from);
        }
        self.traps
            .retain(|t| t["item"] != json!(id) || t["step"].as_i64().is_none_or(|s| s < from));
        if let Some(f) = self.fuel.get_mut(&i) {
            f.retain(|(s, _)| *s < from);
        }
        if let Some(r) = self.ranges.get_mut(id) {
            r.retain(|r| r.step < from);
        }
    }
}
