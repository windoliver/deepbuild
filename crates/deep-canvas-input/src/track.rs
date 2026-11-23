//! The input track (canvas primitives: Input track): entries in time order, each stamped with
//! its writer and, for yours, the gesture serial. A seek never changes it; a new entry where
//! later entries exist forks it at its flick, dropping them and recording `fork_at`. A control's
//! value at a time is a binary search over that control's entries, never a scan of the track.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Map, Value};

/// #860: the control a rewind entry is kept under (its value is where it returns), which no
/// control's ID can be.
pub const REWIND: &str = ":rewind";

/// Who wrote an entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Writer {
    You,
    Tour,
    Agent,
    /// #297: another player's entry in a match's merged track.
    Peer,
}

impl Writer {
    pub fn name(self) -> &'static str {
        match self {
            Writer::You => "you",
            Writer::Tour => "tour",
            Writer::Agent => "agent",
            Writer::Peer => "peer",
        }
    }
}

/// One resolved point of a gesture's polyline: the value at `t`, the handle's place in u for a
/// handle on a path, and, only in the planted program that computes again at replay, the
/// pointer it came from in viewport px.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub t: i64,
    pub value: Value,
    pub at: Option<[f64; 2]>,
    pub px: Option<[f64; 2]>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub t: i64,
    pub seq: u32,
    pub control: String,
    pub value: Value,
    pub samples: Option<Vec<Sample>>,
    pub writer: Writer,
    pub serial: Option<u32>,
    /// #297: the player who made it, in a match's merged track; none for a piece played alone.
    pub player: Option<u8>,
}

impl Entry {
    /// The value a read at `t` takes from this entry: its own, but for a tour's linear key
    /// (#903), whose value moves along its polyline from the entry's flick to the segment's end.
    pub(crate) fn value_at(&self, t: i64) -> Value {
        let ends = match (self.writer, self.samples.as_deref()) {
            (Writer::Tour, Some([a, b])) => Some((a, b)),
            _ => None,
        };
        let moved = ends.and_then(|(a, b)| {
            let (from, to) = (a.value.as_f64()?, b.value.as_f64()?);
            let share = (t.clamp(a.t, b.t) - a.t) as f64 / (b.t - a.t) as f64;
            Some(json!(from + (to - from) * share))
        });
        moved.unwrap_or_else(|| self.value.clone())
    }

    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("t".into(), json!(self.t));
        o.insert("seq".into(), json!(self.seq));
        // #507: a present-mode entry (advance, back, blank or a stage) names no control.
        if self.control.is_empty() {
            o.insert("present".into(), self.value.clone());
        } else if self.control == REWIND {
            o.insert("rewind".into(), self.value.clone());
        } else {
            o.insert("control".into(), json!(self.control));
            o.insert("value".into(), self.value.clone());
        }
        if let Some(samples) = &self.samples {
            let list: Vec<Value> = samples
                .iter()
                .map(|s| {
                    let mut so = Map::new();
                    so.insert("t".into(), json!(s.t));
                    so.insert("value".into(), s.value.clone());
                    if let Some(at) = s.at {
                        so.insert("at".into(), json!(at));
                    }
                    if let Some(px) = s.px {
                        so.insert("px".into(), json!(px));
                    }
                    Value::Object(so)
                })
                .collect();
            o.insert("samples".into(), Value::Array(list));
        }
        o.insert("writer".into(), json!(self.writer.name()));
        if let Some(serial) = self.serial {
            o.insert("serial".into(), json!(serial));
        }
        if let Some(player) = self.player {
            o.insert("player".into(), json!(player));
        }
        Value::Object(o)
    }
}

/// Entries a chunk of the kept track holds: the track grows a chunk at a time, so what it holds
/// past its entries is under one chunk.
const CHUNK: usize = 4096;

/// A kept value's kind, in a kept entry's `flags` bits 0–1.
const POS: u8 = 0;
const NEG: u8 = 1;
const FLOAT: u8 = 2;
/// A value that isn't a number, or an entry with samples: kept in `others` by its index.
const OTHER: u8 = 3;
const SERIAL: u8 = 1 << 2;
const PLAYER: u8 = 1 << 3;

/// One entry as the track keeps it, in 32 bytes (#1250: a 60-minute play's track as a held key
/// writes it, an entry a step, kept in under 8 MiB; canvas primitives: Input track, "about 32 B
/// per entry").
#[derive(Clone, Copy, Debug, Default)]
struct Kept {
    t: i64,
    /// The value: an u64, an i64 or an f64's bits, by the kind in `flags`.
    bits: u64,
    seq: u32,
    serial: u32,
    control: u16,
    writer: u8,
    player: u8,
    flags: u8,
}

#[derive(Clone, Debug, Default)]
pub struct Track {
    chunks: Vec<Vec<Kept>>,
    len: usize,
    /// Each control's name, by the ID its entries keep.
    names: Vec<String>,
    ids: BTreeMap<String, u16>,
    /// Each control's entries, as indexes into the track, in time order, by control ID.
    by_control: Vec<Vec<u32>>,
    /// Each entry whose value isn't a number, or that has samples, by its index.
    others: BTreeMap<u32, (Value, Option<Vec<Sample>>)>,
    pub fork_at: Option<i64>,
}

fn writer_of(w: Writer) -> u8 {
    match w {
        Writer::You => 0,
        Writer::Tour => 1,
        Writer::Agent => 2,
        Writer::Peer => 3,
    }
}

fn writer_from(w: u8) -> Writer {
    match w {
        1 => Writer::Tour,
        2 => Writer::Agent,
        3 => Writer::Peer,
        _ => Writer::You,
    }
}

impl Track {
    fn kept(&self, i: usize) -> &Kept {
        &self.chunks[i / CHUNK][i % CHUNK]
    }

    fn t_at(&self, i: usize) -> i64 {
        self.kept(i).t
    }

    /// The first index whose entry is past `t`.
    fn after(&self, t: i64) -> usize {
        let (mut lo, mut hi) = (0, self.len);
        while lo < hi {
            let mid = (lo + hi) / 2;
            if self.t_at(mid) <= t {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    }

    /// Entry `i` as the track's readers take it.
    fn entry(&self, i: usize) -> Entry {
        let k = self.kept(i);
        let (value, samples) = match k.flags & 3 {
            POS => (json!(k.bits), None),
            NEG => (json!(k.bits as i64), None),
            FLOAT => (
                serde_json::Number::from_f64(f64::from_bits(k.bits))
                    .map_or(Value::Null, Value::Number),
                None,
            ),
            _ => self
                .others
                .get(&(i as u32))
                .cloned()
                .unwrap_or((Value::Null, None)),
        };
        Entry {
            t: k.t,
            seq: k.seq,
            control: self.names[usize::from(k.control)].clone(),
            value,
            samples,
            writer: writer_from(k.writer),
            serial: (k.flags & SERIAL != 0).then_some(k.serial),
            player: (k.flags & PLAYER != 0).then_some(k.player),
        }
    }

    /// Entry `i`, as the track's readers take it.
    pub fn get(&self, i: usize) -> Option<Entry> {
        (i < self.len).then(|| self.entry(i))
    }

    /// The entries in order, as the track's readers take them.
    pub fn entries(&self) -> Vec<Entry> {
        (0..self.len).map(|i| self.entry(i)).collect()
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }

    /// The last entry's flick, the live edge a tour writes past.
    pub fn last_t(&self) -> Option<i64> {
        self.len.checked_sub(1).map(|i| self.t_at(i))
    }

    /// Appends `e` at its flick: the entries after it are dropped, which forks the track there.
    /// Returns how many were dropped.
    pub fn append(&mut self, e: Entry) -> usize {
        let keep = self.after(e.t);
        let dropped = self.drop_after(keep);
        if dropped > 0 {
            self.fork_at = Some(e.t);
        }
        let seq = (0..keep).rev().take_while(|&i| self.t_at(i) == e.t).count() as u32;
        let control = match self.ids.get(&e.control) {
            Some(id) => *id,
            None => {
                let id = self.names.len() as u16;
                self.names.push(e.control.clone());
                self.ids.insert(e.control.clone(), id);
                self.by_control.push(Vec::new());
                id
            }
        };
        let i = self.len;
        let number = e.value.as_number().filter(|_| e.samples.is_none());
        let (bits, kind) = match number {
            Some(n) if n.is_u64() => (n.as_u64().unwrap_or(0), POS),
            Some(n) if n.is_i64() => (n.as_i64().unwrap_or(0) as u64, NEG),
            Some(n) => (n.as_f64().unwrap_or(0.0).to_bits(), FLOAT),
            None => {
                self.others.insert(i as u32, (e.value, e.samples));
                (0, OTHER)
            }
        };
        let kept = Kept {
            t: e.t,
            bits,
            seq,
            serial: e.serial.unwrap_or(0),
            control,
            writer: writer_of(e.writer),
            player: e.player.unwrap_or(0),
            flags: kind
                | if e.serial.is_some() { SERIAL } else { 0 }
                | if e.player.is_some() { PLAYER } else { 0 },
        };
        if self.chunks.last().is_none_or(|c| c.len() == CHUNK) {
            self.chunks.push(Vec::with_capacity(CHUNK));
        }
        self.chunks.last_mut().expect("a chunk").push(kept);
        self.by_control[usize::from(control)].push(i as u32);
        self.len += 1;
        dropped
    }

    /// Drops every entry from index `keep` on; the count dropped.
    fn drop_after(&mut self, keep: usize) -> usize {
        let dropped = self.len - keep;
        if dropped > 0 {
            self.chunks.truncate(keep.div_ceil(CHUNK));
            if let Some(last) = self.chunks.last_mut() {
                last.truncate(keep - (keep - 1) / CHUNK * CHUNK);
            }
            self.len = keep;
            for list in &mut self.by_control {
                let k = list.partition_point(|&i| (i as usize) < keep);
                list.truncate(k);
            }
            self.others.retain(|i, _| (*i as usize) < keep);
        }
        dropped
    }

    /// The planted transport's scrub: drops the entries after `t` as if a seek were an edit.
    pub fn cut_after(&mut self, t: i64) -> usize {
        let keep = self.after(t);
        let dropped = self.drop_after(keep);
        if dropped > 0 {
            self.fork_at = Some(t);
        }
        dropped
    }

    fn list(&self, control: &str) -> Option<&Vec<u32>> {
        self.by_control.get(usize::from(*self.ids.get(control)?))
    }

    /// `control`'s last entry at or before `t`, by binary search over its own entries.
    pub fn last_at(&self, control: &str, t: i64) -> Option<Entry> {
        let list = self.list(control)?;
        let k = list.partition_point(|&i| self.t_at(i as usize) <= t);
        k.checked_sub(1).map(|k| self.entry(list[k] as usize))
    }

    /// The planted lookup: the same answer by scanning the whole track. `last` walks every entry,
    /// which is the plant, so it stays.
    #[allow(clippy::double_ended_iterator_last)]
    pub fn last_at_scanning(&self, control: &str, t: i64) -> Option<Entry> {
        (0..self.len)
            .map(|i| self.entry(i))
            .filter(|e| e.control == control && e.t <= t)
            .last()
    }

    /// How many of `control`'s entries are at or before `t`.
    pub fn count_at(&self, control: &str, t: i64) -> usize {
        self.list(control).map_or(0, |list| {
            list.partition_point(|&i| self.t_at(i as usize) <= t)
        })
    }

    /// `control`'s entries, in time order.
    pub fn of(&self, control: &str) -> impl Iterator<Item = Entry> + '_ {
        self.list(control)
            .into_iter()
            .flatten()
            .map(|&i| self.entry(i as usize))
    }

    /// #1250: every byte the track holds to keep its entries, their values and its index: its
    /// chunks as allocated, each control's list of indexes, its names, and each entry kept whole
    /// beside them, by its JSON's length.
    pub fn kept_bytes(&self) -> usize {
        use std::mem::size_of;
        let chunks: usize = (self.chunks.iter())
            .map(|c| c.capacity() * size_of::<Kept>() + size_of::<Vec<Kept>>())
            .sum();
        let lists: usize = (self.by_control.iter())
            .map(|l| l.capacity() * size_of::<u32>() + size_of::<Vec<u32>>())
            .sum();
        let names: usize = (self.names.iter())
            .map(|n| 2 * (n.capacity() + size_of::<String>()) + size_of::<u16>())
            .sum();
        let others: usize = (self.others.values())
            .map(|(v, s)| {
                let samples = s.as_ref().map_or(0, |s| s.len() * size_of::<Sample>());
                size_of::<(u32, Value, Option<Vec<Sample>>)>() + v.to_string().len() + samples
            })
            .sum();
        size_of::<Track>() + chunks + lists + names + others
    }

    /// The track's hash: of [`Track::bytes`].
    pub fn hash(&self) -> String {
        sha256_hex(&self.bytes())
    }

    /// The track as its hash reads it: its entries and `fork_at`, in their written order (#1040:
    /// a web bundle's track file, so the bundle's track is the app's by hash).
    pub fn bytes(&self) -> Vec<u8> {
        let doc = json!({
            "entries": (0..self.len).map(|i| self.entry(i).to_json()).collect::<Vec<_>>(),
            "fork_at": self.fork_at,
        });
        doc.to_string().into_bytes()
    }

    pub fn to_json(&self) -> Value {
        Value::Array((0..self.len).map(|i| self.entry(i).to_json()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(t: i64, control: &str, v: f64) -> Entry {
        Entry {
            t,
            seq: 0,
            control: control.into(),
            value: json!(v),
            samples: None,
            writer: Writer::You,
            serial: Some(1),
            player: None,
        }
    }

    #[test]
    fn an_entry_before_later_ones_forks_there_and_lookups_see_only_what_stays() {
        let mut tr = Track::default();
        for i in 0..5 {
            tr.append(e(10 * (i + 1), "a", i as f64));
        }
        tr.append(e(25, "b", 9.0));
        let h = tr.hash();
        assert_eq!(tr.last_at("a", 45).map(|x| x.t), Some(20));
        assert_eq!(tr.len(), 3);
        assert_eq!(tr.fork_at, Some(25));
        assert_eq!(tr.count_at("a", 100), 2);
        assert_eq!(tr.last_at_scanning("a", 15).map(|x| x.t), Some(10));
        assert_ne!(h, Track::default().hash());
    }

    /// #1250: each value comes back as written, a number of any kind or not, across chunks and a
    /// fork, and a held key's hour of entries is kept in under 8 MiB.
    #[test]
    fn values_come_back_as_written_and_an_hour_of_steps_keeps_in_8_mib() {
        let mut tr = Track::default();
        let values = [
            json!(1),
            json!(-2),
            json!(0.25),
            json!("go"),
            json!({"set": 1, "key": 2}),
        ];
        for (k, v) in values.iter().cycle().take(3 * CHUNK + 7).enumerate() {
            let mut x = e(k as i64, "a", 0.0);
            x.value = v.clone();
            x.player = (k % 2 == 0).then_some(2);
            tr.append(x);
        }
        let all = tr.entries();
        assert_eq!(all.len(), 3 * CHUNK + 7);
        for (k, x) in all.iter().enumerate() {
            assert_eq!(x.value, values[k % values.len()]);
            assert_eq!(x.player, (k % 2 == 0).then_some(2));
        }
        tr.append(e(CHUNK as i64 + 3, "b", 1.5));
        assert_eq!(tr.len(), CHUNK + 5);
        assert_eq!(
            tr.last_at("a", i64::MAX).map(|x| x.value),
            Some(values[(CHUNK + 3) % 5].clone())
        );
        let mut hour = Track::default();
        for k in 0..216_000_i64 {
            hour.append(e(k * 11_760_000, "move", ((k / 60) % 5 - 2) as f64));
        }
        assert!(
            hour.kept_bytes() < 8 * 1024 * 1024,
            "{} bytes",
            hour.kept_bytes()
        );
    }
}
