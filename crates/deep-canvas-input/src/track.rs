//! The input track (canvas primitives: Input track): entries in time order, each stamped with
//! its writer and, for yours, the gesture serial. A seek never changes it; a new entry where
//! later entries exist forks it at its flick, dropping them and recording `fork_at`. A control's
//! value at a time is a binary search over that control's entries, never a scan of the track.

use std::collections::BTreeMap;

use deep_canvas::canon::sha256_hex;
use serde_json::{json, Map, Value};

/// Who wrote an entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Writer {
    You,
    Tour,
    Agent,
}

impl Writer {
    pub fn name(self) -> &'static str {
        match self {
            Writer::You => "you",
            Writer::Tour => "tour",
            Writer::Agent => "agent",
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
}

impl Entry {
    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("t".into(), json!(self.t));
        o.insert("seq".into(), json!(self.seq));
        o.insert("control".into(), json!(self.control));
        o.insert("value".into(), self.value.clone());
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
        Value::Object(o)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Track {
    entries: Vec<Entry>,
    /// Each control's entries, as indexes into `entries`, in time order.
    by_control: BTreeMap<String, Vec<usize>>,
    pub fork_at: Option<i64>,
}

impl Track {
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The last entry's flick, the live edge a tour writes past.
    pub fn last_t(&self) -> Option<i64> {
        self.entries.last().map(|e| e.t)
    }

    /// Appends `e` at its flick: the entries after it are dropped, which forks the track there.
    /// Returns how many were dropped.
    pub fn append(&mut self, mut e: Entry) -> usize {
        let keep = self.entries.partition_point(|x| x.t <= e.t);
        let dropped = self.drop_after(keep);
        if dropped > 0 {
            self.fork_at = Some(e.t);
        }
        e.seq = self.entries[..keep]
            .iter()
            .rev()
            .take_while(|x| x.t == e.t)
            .count() as u32;
        self.by_control
            .entry(e.control.clone())
            .or_default()
            .push(self.entries.len());
        self.entries.push(e);
        dropped
    }

    /// Drops every entry from index `keep` on; the count dropped.
    fn drop_after(&mut self, keep: usize) -> usize {
        let dropped = self.entries.len() - keep;
        if dropped > 0 {
            self.entries.truncate(keep);
            for list in self.by_control.values_mut() {
                let k = list.partition_point(|&i| i < keep);
                list.truncate(k);
            }
        }
        dropped
    }

    /// The planted transport's scrub: drops the entries after `t` as if a seek were an edit.
    pub fn cut_after(&mut self, t: i64) -> usize {
        let keep = self.entries.partition_point(|x| x.t <= t);
        let dropped = self.drop_after(keep);
        if dropped > 0 {
            self.fork_at = Some(t);
        }
        dropped
    }

    /// `control`'s last entry at or before `t`, by binary search over its own entries.
    pub fn last_at(&self, control: &str, t: i64) -> Option<&Entry> {
        let list = self.by_control.get(control)?;
        let k = list.partition_point(|&i| self.entries[i].t <= t);
        k.checked_sub(1).map(|k| &self.entries[list[k]])
    }

    /// The planted lookup: the same answer by scanning the whole track. `last` walks every entry,
    /// which is the plant, so it stays.
    #[allow(clippy::double_ended_iterator_last)]
    pub fn last_at_scanning(&self, control: &str, t: i64) -> Option<&Entry> {
        self.entries
            .iter()
            .filter(|e| e.control == control && e.t <= t)
            .last()
    }

    /// How many of `control`'s entries are at or before `t`.
    pub fn count_at(&self, control: &str, t: i64) -> usize {
        self.by_control.get(control).map_or(0, |list| {
            list.partition_point(|&i| self.entries[i].t <= t)
        })
    }

    /// `control`'s entries, in time order.
    pub fn of(&self, control: &str) -> impl Iterator<Item = &Entry> {
        self.by_control
            .get(control)
            .into_iter()
            .flatten()
            .map(|&i| &self.entries[i])
    }

    /// The track's hash: its entries and `fork_at`, in their written order.
    pub fn hash(&self) -> String {
        let doc = json!({
            "entries": self.entries.iter().map(Entry::to_json).collect::<Vec<_>>(),
            "fork_at": self.fork_at,
        });
        sha256_hex(doc.to_string().as_bytes())
    }

    pub fn to_json(&self) -> Value {
        Value::Array(self.entries.iter().map(Entry::to_json).collect())
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
}
