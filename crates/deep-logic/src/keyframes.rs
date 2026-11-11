//! A recorded match's keyframes (technical design: Logic bake and checks; #547): a session with a
//! cache keeps each item's state every 10 s of play beside its checkpoint ring, spilled to files
//! under the cache folder, so a seek re-runs at most 10 s of steps. As in the ring, the first and
//! every eighth keyframe hold the whole memory and the rest the pages written since the keyframe
//! before, whose record clears only once the file is written. Past the cache's byte budget the
//! keyframes' spacing doubles, and a keyframe dropped merges its pages into the next one kept.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::piece::{Piece, PAGE};
use crate::world::{merge, Live, Memory, Stored};

/// Seconds of play between keyframes.
const EVERY_SECONDS: i64 = 10;

struct Keyframe {
    /// The item's state there, its memory left in the file.
    state: Stored,
    whole: bool,
    /// The pages the file holds, in order: every page of a whole keyframe.
    pages: Vec<u32>,
    file: PathBuf,
    bytes: u64,
}

/// A session's keyframes, per item, with the steps between them.
pub struct Cache {
    dir: PathBuf,
    budget: u64,
    items: Vec<(Vec<Keyframe>, i64)>,
}

fn failed(what: String) -> Value {
    json!({"ok": false, "code": "cache_failed", "what": what})
}

impl Keyframe {
    /// Its memory as the file holds it.
    fn memory(&self) -> std::io::Result<Memory> {
        let body = fs::read(&self.file)?;
        Ok(if self.whole {
            Memory::Whole(body)
        } else {
            Memory::Pages(
                self.pages
                    .iter()
                    .zip(body.chunks(PAGE as usize))
                    .map(|(p, b)| (*p, b.to_vec()))
                    .collect(),
            )
        })
    }
    /// Writes `memory` as its file, whole or as pages.
    fn write(&mut self, memory: Memory) -> std::io::Result<()> {
        let (whole, pages, body) = match memory {
            Memory::Whole(m) => (true, (0..(m.len() as u64 / PAGE) as u32).collect(), m),
            Memory::Pages(p) => (
                false,
                p.keys().copied().collect(),
                p.into_values().flatten().collect(),
            ),
        };
        fs::write(&self.file, &body)?;
        (self.whole, self.pages, self.bytes) = (whole, pages, body.len() as u64);
        Ok(())
    }
}

impl Cache {
    /// A cache in `dir` holding at most `budget` bytes of keyframes, one every 10 s of each item's
    /// play.
    pub fn new(dir: &str, budget: u64, piece: &Piece) -> Result<Cache, Value> {
        fs::create_dir_all(dir).map_err(|e| failed(format!("{dir}: {e}")))?;
        let items = piece
            .items
            .iter()
            .map(|i| (Vec::new(), (EVERY_SECONDS * crate::F / i.step).max(1)))
            .collect();
        Ok(Cache {
            dir: dir.into(),
            budget,
            items,
        })
    }

    fn bytes(&self) -> u64 {
        self.items
            .iter()
            .flat_map(|(k, _)| k)
            .map(|k| k.bytes)
            .sum()
    }

    /// Item `i`'s keyframe of `l` when its next step starts one: past the last keyframe it holds,
    /// so a seek back replays steps without taking them again.
    pub(crate) fn take(&mut self, i: usize, l: &mut Live) {
        let at = l.last + 1;
        let (list, spacing) = &self.items[i];
        if at % spacing != 0 || list.last().is_some_and(|k| k.state.step >= at) {
            return;
        }
        let whole = list.len().is_multiple_of(8);
        let dirty: Vec<u32> = l.kdirty.iter().copied().collect();
        let memory = if whole {
            Memory::Whole(l.memory().to_vec())
        } else {
            let m = l.memory();
            Memory::Pages(
                dirty
                    .into_iter()
                    .map(|p| (p, m[p as usize * PAGE as usize..][..PAGE as usize].to_vec()))
                    .collect(),
            )
        };
        let mut k = Keyframe {
            state: l.stored(Memory::Pages(BTreeMap::new())),
            whole,
            pages: Vec::new(),
            file: self.dir.join(format!("{i}-{at}.keyframe")),
            bytes: 0,
        };
        // A failed write keeps the record of pages written, so the next keyframe holds them.
        if k.write(memory).is_err() {
            return;
        }
        l.kdirty.clear();
        self.items[i].0.push(k);
        self.thin(i, l);
    }

    /// Doubles item `i`'s spacing while the cache passes its budget, each keyframe off it merged
    /// into the next one kept or, past the last, into the pages the next keyframe takes.
    fn thin(&mut self, i: usize, l: &mut Live) {
        while self.bytes() > self.budget && self.items[i].0.len() > 1 {
            let (list, spacing) = &mut self.items[i];
            *spacing *= 2;
            let mut kept = Vec::new();
            let mut carry: Option<Memory> = None;
            for mut k in std::mem::take(list) {
                let Ok(memory) = k.memory() else {
                    kept.push(k);
                    continue;
                };
                if k.state.step % *spacing != 0 {
                    carry = Some(merge(carry, memory));
                    let _ = fs::remove_file(&k.file);
                    continue;
                }
                if let Some(c) = carry.take() {
                    // A failed rewrite leaves the file as it was: its own pages still restore.
                    let _ = k.write(merge(Some(c), memory));
                }
                kept.push(k);
            }
            *list = kept;
            match carry {
                Some(Memory::Whole(m)) => l.kdirty.extend(0..(m.len() as u64 / PAGE) as u32),
                Some(Memory::Pages(p)) => l.kdirty.extend(p.into_keys()),
                None => {}
            }
        }
    }

    /// The last step at or before `k` every item holds a keyframe at.
    pub fn nearest(&self, k: i64) -> Option<i64> {
        let (first, _) = self.items.first()?;
        first
            .iter()
            .rev()
            .map(|f| f.state.step)
            .filter(|c| *c <= k)
            .find(|c| {
                self.items
                    .iter()
                    .all(|(l, _)| l.iter().any(|f| f.state.step == *c))
            })
    }

    /// Item `i`'s memory at its keyframe at step `c`, from the last whole one at or before it and
    /// the pages of each after it, and its state there.
    pub(crate) fn load(&self, i: usize, c: i64) -> Result<(Vec<u8>, &Stored), Value> {
        let list = &self.items[i].0;
        let j = list
            .iter()
            .position(|k| k.state.step == c)
            .ok_or_else(|| failed(format!("no keyframe at step {c}")))?;
        let w = (0..=j)
            .rev()
            .find(|&w| list[w].whole)
            .ok_or_else(|| failed(format!("no whole keyframe at or before step {c}")))?;
        let read = |k: &Keyframe| {
            fs::read(&k.file).map_err(|e| failed(format!("{}: {e}", k.file.display())))
        };
        let mut memory = read(&list[w])?;
        for k in &list[w + 1..=j] {
            let body = read(k)?;
            for (p, b) in k.pages.iter().zip(body.chunks(PAGE as usize)) {
                memory[*p as usize * PAGE as usize..][..PAGE as usize].copy_from_slice(b);
            }
        }
        Ok((memory, &list[j].state))
    }
}
