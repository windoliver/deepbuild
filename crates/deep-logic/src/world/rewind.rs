//! #860: rewind as an input (canvas primitives: Input track; Logic: saves). A piece that
//! declares `rewind: {stops, depth, seen?}` marks the steps a reader stops at in its stops array.
//! A rewind entry, at its stamp and before any step then, returns every item to an earlier stop
//! on the current branch: the nearest checkpoint the ring holds at or before it, or with none a
//! fresh play from step 0, stepped forward to it. The entries stamped after that stop and before
//! the rewind leave the current branch for a closed one, which stays on the track where no step
//! reads it, so the state at any time is the fold over the current branch's entries. The seen
//! array keeps the values it held: they are put back at the step after the stop whenever a run
//! is about to take it, so a seek or a replay past it reads them too. Nothing else crosses.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

use super::*;
use crate::piece::Rewind;

/// A branch a rewind closed: the step of the stop it returned to, the rewind's own step and
/// stamp, and the seen array's values it carried across (none when the piece declares no seen).
#[derive(Clone, Debug, PartialEq)]
pub struct Branch {
    pub stop: i64,
    pub rewind: i64,
    pub t: i64,
    pub seen: Vec<u8>,
}

/// What the track's rewinds left on a world.
#[derive(Clone, Debug, Default)]
pub struct Branches {
    /// The current branch's stops, oldest first, by the step that marked each.
    pub stops: Vec<i64>,
    /// The branches rewinds closed, oldest first.
    pub closed: Vec<Branch>,
    /// The closed branches' entries: on the track, read by no step.
    pub off: Vec<Entry>,
    /// How many of the track's rewinds, in its order, have come.
    pub taken: usize,
    /// The seen values the current branch carries, each by the step after its stop.
    pub carry: Vec<(i64, Vec<u8>)>,
}

impl Branches {
    /// The closed branches as a reply lists them: `[{stop, rewind}]`, oldest first.
    pub fn closed_json(&self) -> Value {
        Value::Array(
            self.closed
                .iter()
                .map(|b| json!({"stop": b.stop, "rewind": b.rewind}))
                .collect(),
        )
    }

    /// The seen values the current branch carries, as a save and a drawn form keep them:
    /// `[[step, base64]]`, each by the step after its stop.
    pub fn carry_json(&self) -> Value {
        Value::Array(
            self.carry
                .iter()
                .map(|(p, s)| json!([p, B64.encode(s)]))
                .collect(),
        )
    }
}

/// A carry as [`Branches::carry_json`] writes it; None when it doesn't decode.
pub fn carry_of(v: &Value) -> Option<Vec<(i64, Vec<u8>)>> {
    v.as_array()?
        .iter()
        .map(|c| Some((c.get(0)?.as_i64()?, B64.decode(c.get(1)?.as_str()?).ok()?)))
        .collect()
}

/// A rewind entry the piece takes: it declares a rewind, and one back n stops goes back at most
/// its depth, or it is refused naming the depth.
pub(crate) fn fits(piece: &Piece, e: &Entry) -> Result<(), Failed> {
    let Given::Rewind(to) = e.value else {
        return Ok(());
    };
    let Some(r) = &piece.rewind else {
        return Err(
            json!({"ok": false, "code": "bad_input", "what": "a rewind on a piece that declares no rewind"}),
        );
    };
    match to {
        To::Stop(n) if n > u32::from(r.depth) => {
            Err(json!({"ok": false, "code": "rewind.past_depth", "depth": r.depth}))
        }
        _ => Ok(()),
    }
}

/// A step's number from its time: the first step at or after `t`.
fn step_at(t: i64, len: i64) -> i64 {
    t.div_euclid(len) + i64::from(t.rem_euclid(len) != 0)
}

impl World {
    /// Whether the track's next rewind is stamped at or before `t`.
    pub(super) fn rewind_due(&self, t: i64) -> bool {
        self.track
            .get(REWIND)
            .and_then(|l| l.get(self.branches.taken))
            .is_some_and(|e| e.t <= t)
    }

    /// Marks step k a stop when the stops item's step ran and left its stops array nonzero.
    pub(super) fn mark(&mut self, rec: &mut Record) {
        let Some(r) = &self.piece.rewind else { return };
        let ((at, n), l) = (r.stops, &self.lives[r.item]);
        if l.failed
            || l.arrays[at as usize..(at + n) as usize]
                .iter()
                .all(|b| *b == 0)
        {
            return;
        }
        let k = l.last;
        self.branches.stops.push(k);
        if let Some(s) = rec.stops.as_mut() {
            s.push((self.branches.closed.len(), k, self.deep_hashes()));
        }
    }

    /// The stops the current branch made before step `c`, which a world at `c` has made.
    pub(super) fn stops_before(&self, c: i64) -> Vec<i64> {
        self.branches
            .stops
            .iter()
            .copied()
            .filter(|k| *k < c)
            .collect()
    }

    /// A fork of the track at step `k`, steps `len` flicks long: the rewinds and closed entries
    /// after it go with the rest.
    pub(super) fn fork_branches(&mut self, k: i64, len: i64) {
        let b = &mut self.branches;
        b.off.retain(|e| e.t <= (k - 1) * len);
        b.closed.retain(|c| c.rewind < k);
        let closed = &b.closed;
        b.carry
            .retain(|(p, _)| *p <= k || closed.iter().any(|c| c.stop + 1 == *p));
        b.taken = b.taken.min(self.track.get(REWIND).map_or(0, Vec::len));
    }

    /// The seen values the current branch carries in at step k, put back before it runs.
    pub(super) fn carry_in(&mut self, k: i64) {
        let Some((i, at, n)) = self.piece.rewind.as_ref().and_then(|r| r.seen) else {
            return;
        };
        let carried = self.branches.carry.iter().find(|(p, _)| *p == k);
        if let Some(seen) = carried.map(|(_, s)| s.clone()) {
            self.put(i, at, n, &seen);
        }
    }

    /// `bytes` at `at` in item i's write region, in its memory and its arrays.
    fn put(&mut self, i: usize, at: u32, n: u32, bytes: &[u8]) {
        let from = (self.piece.items[i].writes_at + at) as usize;
        let l = &mut self.lives[i];
        l.arrays[at as usize..(at + n) as usize].copy_from_slice(bytes);
        if let Some(m) = l.runner.memory_mut("memory") {
            m[from..from + n as usize].copy_from_slice(bytes);
        }
        let pages = (from as u64 / PAGE) as u32..=((from + n as usize - 1) as u64 / PAGE) as u32;
        l.dirty.extend(pages.clone());
        l.kdirty.extend(pages);
        self.published[i].clone_from(&l.arrays);
    }

    /// The track's next rewind, at its stamp. A rewind with no stop to go back to on the current
    /// branch within the depth changes nothing.
    pub(super) fn rewind(&mut self, rec: &mut Record) {
        let e = self.track[REWIND][self.branches.taken].clone();
        self.branches.taken += 1;
        let (Some(r), Given::Rewind(to)) = (self.piece.rewind.clone(), e.value) else {
            return;
        };
        let stops = &self.branches.stops;
        let Some(last) = stops.len().checked_sub(1) else {
            return;
        };
        let j = match to {
            To::Stop(n) => last.checked_sub(n as usize),
            To::Step(k) => stops.iter().rposition(|s| *s == k),
        };
        let Some(j) = j.filter(|j| last - j <= usize::from(r.depth)) else {
            return;
        };
        let (s, len) = (stops[j], self.piece.items[r.item].step);
        let stops = stops[..=j].to_vec();
        let seen = r
            .seen
            .map(|(i, at, n)| match self.planted.rewind_clears_seen {
                true => vec![0; n as usize],
                false => self.lives[i].arrays[at as usize..(at + n) as usize].to_vec(),
            });
        let kept: Option<Vec<(Vec<u8>, Vec<Val>)>> =
            self.planted.rewind_restores_arrays_only.then(|| {
                let lives = self.lives.iter_mut();
                lives.map(|l| (l.memory().to_vec(), l.globals())).collect()
            });
        // The entries after the stop and before the rewind leave the current branch.
        for (c, list) in self.track.iter_mut() {
            if c != REWIND {
                let all = std::mem::take(list).into_iter();
                let (on, off): (Vec<Entry>, Vec<Entry>) =
                    all.partition(|x| x.t <= s * len || x.t >= e.t);
                *list = on;
                self.branches.off.extend(off);
            }
        }
        self.branches.carry.retain(|(p, _)| *p <= s);
        for l in &mut self.lives {
            l.stored.retain(|c| c.step <= s + 1);
        }
        if let Err(what) = self.back_to(s + 1) {
            rec.traps.push(json!({"item": null, "step": null, "t": e.t, "kind": "rewind", "what": what, "function": null, "offset": null, "inputs": []}));
            self.lives.iter_mut().for_each(|l| l.failed = true);
            return;
        }
        self.branches.stops = stops;
        if let Some(kept) = kept {
            self.keep(kept);
        }
        if let (Some((i, at, n)), Some(seen)) = (r.seen, &seen) {
            self.put(i, at, n, seen);
            self.branches.carry.push((s + 1, seen.clone()));
        }
        let arrays: Vec<Vec<u8>> = self.lives.iter().map(|l| l.arrays.clone()).collect();
        rec.rewound(&self.piece, s, &arrays);
        self.branches.closed.push(Branch {
            stop: s,
            rewind: step_at(e.t, len),
            t: e.t,
            seen: seen.unwrap_or_default(),
        });
    }

    /// Every item back at step `at`'s state on the current branch: from the nearest checkpoint
    /// the ring holds at or before it, or with none a fresh play from step 0, stepped forward to
    /// it with no save written and none asked after.
    fn back_to(&mut self, at: i64) -> Result<(), Failed> {
        match self.nearest(at) {
            Some(c) => self.seek(c)?,
            None => {
                let mut scratch = Record::default();
                let track = self.track.clone();
                let fresh = World::new(
                    self.piece.clone(),
                    track,
                    true,
                    self.planted,
                    &mut scratch,
                    None,
                )?;
                for (l, mut r) in self.lives.iter_mut().zip(fresh.lives) {
                    r.spare = l.spare.take();
                    r.preview = std::mem::take(&mut l.preview);
                    *l = r;
                }
                self.published = fresh.published;
                self.seen = 0;
            }
        }
        if self.at().is_some_and(|k| k < at) {
            let (dir, cache) = (self.saves_dir.take(), self.cache.take());
            self.run(at, &mut Record::default(), &mut |_, _| {});
            (self.saves_dir, self.cache) = (dir, cache);
            self.lives.iter_mut().for_each(|l| l.asked = None);
        }
        Ok(())
    }

    /// The planted rewind: each item's memory outside its write region and its globals as they
    /// stood when the rewind came.
    fn keep(&mut self, kept: Vec<(Vec<u8>, Vec<Val>)>) {
        for (i, (memory, globals)) in kept.into_iter().enumerate() {
            let item = &self.piece.items[i];
            let (w, n) = (item.writes_at as usize, item.layout.size("writes") as usize);
            let l = &mut self.lives[i];
            if let Some(m) = l
                .runner
                .memory_mut("memory")
                .filter(|m| m.len() == memory.len())
            {
                let region = m[w..w + n].to_vec();
                m.copy_from_slice(&memory);
                m[w..w + n].copy_from_slice(&region);
            }
            for ((name, _), v) in l.names.clone().globals.iter().zip(globals) {
                let _ = l.runner.set(name, v);
            }
            let pages = (memory.len() as u64).div_ceil(PAGE) as u32;
            l.dirty.extend(0..pages);
            l.kdirty.extend(0..pages);
        }
    }

    /// What a save at step k keeps of the branches (Logic: saves): the current branch's entries
    /// read by then, rewinds included; the stops a later rewind may return to within `depth`; the
    /// closed branches whose stops lie within them, with their entries; and the seen values the
    /// current branch carries.
    pub(crate) fn branch_saved(&self, k: i64, r: &Rewind) -> Value {
        let len = self.piece.items[r.item].step;
        let b = &self.branches;
        let stops = &b.stops[b.stops.len().saturating_sub(usize::from(r.depth) + 1)..];
        let oldest = stops.first().copied().unwrap_or(i64::MAX);
        let closed: Vec<&Branch> = b.closed.iter().filter(|c| c.stop >= oldest).collect();
        let on = |e: &&Entry| e.t <= (k - 1) * len;
        let read: Vec<Value> = self
            .track
            .values()
            .flatten()
            .filter(on)
            .map(Entry::to_json)
            .collect();
        let off = b
            .off
            .iter()
            .filter(|e| closed.iter().any(|c| c.stop * len < e.t && e.t < c.t));
        json!({
            "stops": stops, "track": read, "off": off.map(Entry::to_json).collect::<Vec<_>>(),
            "closed": closed.iter().map(|c| json!({"stop": c.stop, "rewind": c.rewind, "t": c.t, "seen": B64.encode(&c.seen)})).collect::<Vec<_>>(),
            "carry": b.carry_json(),
        })
    }
}

/// A save's branches (`branch_saved`), and the current branch's entries it read; None when they
/// don't decode.
pub(crate) fn branch_opened(v: &Value) -> Option<(Branches, Vec<Entry>)> {
    let entries = |k: &str| -> Option<Vec<Entry>> {
        v.get(k)?.as_array()?.iter().map(Entry::parse).collect()
    };
    let bytes = |v: &Value| B64.decode(v.as_str()?).ok();
    let track = entries("track")?;
    let closed = v["closed"]
        .as_array()?
        .iter()
        .map(|c| {
            Some(Branch {
                stop: c.get("stop")?.as_i64()?,
                rewind: c.get("rewind")?.as_i64()?,
                t: c.get("t")?.as_i64()?,
                seen: bytes(c.get("seen")?)?,
            })
        })
        .collect::<Option<_>>()?;
    let carry = carry_of(&v["carry"])?;
    let stops = v["stops"]
        .as_array()?
        .iter()
        .map(Value::as_i64)
        .collect::<Option<_>>()?;
    let branches = Branches {
        stops,
        closed,
        off: entries("off")?,
        taken: track.iter().filter(|e| e.control == REWIND).count(),
        carry,
    };
    Some((branches, track))
}
