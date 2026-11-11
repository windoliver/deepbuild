//! A bake's arrays (canvas primitives: Logic: checkpoints and bake; #547): each step's changed
//! element ranges with their values, and every array whole at each checkpoint, so a long session's
//! bake grows with what changed. Playback rebuilds a step's arrays from the last whole ones at or
//! before it and the ranges after them, never running the program.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::piece::{Item, Piece};
use crate::world::{handed, Record};

/// One step's run of changed elements of one write: `[start, end)` and their bytes.
#[derive(Clone, Debug)]
pub struct Range {
    pub step: i64,
    /// The write's index in its item's `writes`.
    pub write: u32,
    pub start: u32,
    pub end: u32,
    pub bytes: Vec<u8>,
}

/// What a range keeps beside its values: its step, write, start and end.
const RANGE_HEAD: u64 = 20;
/// Elements compared at once before a run is looked for inside them.
const BLOCK: usize = 64;

/// The runs of elements of each write that step k changed, from `old` to `new` (both the write
/// region), in write order and ascending.
pub fn ranges(item: &Item, k: i64, old: &[u8], new: &[u8]) -> Vec<Range> {
    let mut out = Vec::new();
    for (j, w) in item.writes.iter().enumerate() {
        let at = item.write(&w.name).expect("a write entry").offset as usize;
        let (size, n) = (w.ty.size() as usize, w.count as usize);
        let (o, x) = (&old[at..at + n * size], &new[at..at + n * size]);
        if o == x {
            continue;
        }
        let mut start: Option<usize> = None;
        let mut e = 0;
        while e <= n {
            if start.is_none() && e < n {
                let b = (e + BLOCK).min(n);
                if o[e * size..b * size] == x[e * size..b * size] {
                    e = b;
                    continue;
                }
            }
            let differs = e < n && o[e * size..(e + 1) * size] != x[e * size..(e + 1) * size];
            match (start, differs) {
                (None, true) => start = Some(e),
                (Some(s), false) => {
                    out.push(Range {
                        step: k,
                        write: j as u32,
                        start: s as u32,
                        end: e as u32,
                        bytes: x[s * size..e * size].to_vec(),
                    });
                    start = None;
                }
                _ => {}
            }
            e += 1;
        }
    }
    out
}

/// Plays one item's arrays back from a record: the last whole arrays at or before a step and the
/// ranges after them.
pub struct Player<'a> {
    wholes: Option<&'a BTreeMap<i64, Vec<u8>>>,
    ranges: &'a [Range],
    /// Each write's offset and element size.
    writes: Vec<(usize, usize)>,
    buf: Vec<u8>,
    /// The whole arrays `buf` started from, and the last step whose ranges it holds.
    from: Option<i64>,
    upto: i64,
    next: usize,
}

impl<'a> Player<'a> {
    pub fn new(rec: &'a Record, item: &Item) -> Player<'a> {
        Player {
            wholes: rec.wholes.get(&item.id),
            ranges: rec.ranges.get(&item.id).map_or(&[][..], Vec::as_slice),
            writes: item
                .writes
                .iter()
                .map(|w| {
                    let e = item.write(&w.name).expect("a write entry");
                    (e.offset as usize, w.ty.size() as usize)
                })
                .collect(),
            buf: Vec::new(),
            from: None,
            upto: i64::MIN,
            next: 0,
        }
    }

    /// The write region as step k left it, rebuilt from the record alone; None before its first
    /// whole arrays.
    pub fn at(&mut self, k: i64) -> Option<&[u8]> {
        let (&c, whole) = self.wholes?.range(..=k + 1).next_back()?;
        if k < self.upto || self.from.is_none_or(|f| f < c) {
            self.buf.clone_from(whole);
            self.from = Some(c);
            self.upto = c - 1;
            self.next = self.ranges.partition_point(|r| r.step < c);
        }
        while let Some(r) = self.ranges.get(self.next).filter(|r| r.step <= k) {
            let (at, size) = self.writes[r.write as usize];
            let o = at + r.start as usize * size;
            self.buf[o..o + r.bytes.len()].copy_from_slice(&r.bytes);
            self.next += 1;
        }
        self.upto = k;
        Some(&self.buf)
    }
}

/// Each write's values in a write region, by `<item>.<write>`.
fn values(item: &Item, region: &[u8], out: &mut Map<String, Value>) {
    for w in &item.writes {
        let e = item.write(&w.name).expect("a write entry");
        let bytes = &region[e.offset as usize..(e.offset + e.size) as usize];
        let list = bytes
            .chunks(w.ty.size() as usize)
            .map(|b| w.ty.value(b))
            .collect();
        out.insert(format!("{}.{}", item.id, w.name), Value::Array(list));
    }
}

/// The first write and element where two write regions differ.
pub fn first_difference(item: &Item, a: &[u8], b: &[u8]) -> Option<(String, usize)> {
    item.writes.iter().find_map(|w| {
        let e = item.write(&w.name).expect("a write entry");
        let (at, size) = (e.offset as usize, w.ty.size() as usize);
        let end = at + w.count as usize * size;
        if a[at..end] == b[at..end] {
            return None;
        }
        (0..w.count as usize)
            .find(|&n| a[at + n * size..][..size] != b[at + n * size..][..size])
            .map(|n| (format!("{}.{}", item.id, w.name), n))
    })
}

impl Record {
    /// Item `id`'s arrays whole at step label `at` (the state before step `at`), once.
    pub(crate) fn whole(&mut self, id: &str, at: i64, arrays: &[u8]) {
        self.wholes
            .entry(id.to_string())
            .or_default()
            .entry(at)
            .or_insert_with(|| arrays.to_vec());
    }

    /// The bytes the bake keeps for item `id`'s arrays: its whole arrays at each checkpoint and
    /// each step's changed ranges with their values.
    pub fn stored(&self, id: &str) -> u64 {
        let wholes: u64 = self
            .wholes
            .get(id)
            .into_iter()
            .flatten()
            .map(|(_, w)| w.len() as u64)
            .sum();
        let ranges: u64 = self
            .ranges
            .get(id)
            .into_iter()
            .flatten()
            .map(|r| RANGE_HEAD + r.bytes.len() as u64)
            .sum();
        wholes + ranges
    }

    /// Each item's arrays as step k left them, by `<item>.<write>`, rebuilt from the bake alone.
    pub fn arrays_at(&self, piece: &Piece, k: i64) -> Map<String, Value> {
        let mut out = Map::new();
        for item in &piece.items {
            if let Some(region) = Player::new(self, item).at(k) {
                values(item, region, &mut out);
            }
        }
        out
    }

    /// Each step's items and arrays, the arrays rebuilt from the bake.
    pub fn steps_json(&self, piece: &Piece) -> Value {
        let len = piece.items.first().map_or(0, |i| i.step);
        let mut players: Vec<Player> = piece.items.iter().map(|i| Player::new(self, i)).collect();
        Value::Array(
            self.steps
                .iter()
                .map(|(k, (items, arrays))| {
                    let mut arrays = arrays.clone();
                    for (item, p) in piece.items.iter().zip(&mut players) {
                        if let Some(region) = items.get(&item.id).and(p.at(*k)) {
                            values(item, region, &mut arrays);
                        }
                    }
                    json!({"step": k, "t": k * len, "items": items, "arrays": arrays})
                })
                .collect(),
        )
    }

    /// Each item's changed ranges as a bake reports them: `{step, array, start, end, values}`.
    pub fn ranges_json(&self, piece: &Piece) -> Map<String, Value> {
        let mut out = Map::new();
        for item in &piece.items {
            let Some(list) = self.ranges.get(&item.id) else {
                continue;
            };
            let rows = list
                .iter()
                .map(|r| {
                    let w = &item.writes[r.write as usize];
                    let values: Vec<Value> = r
                        .bytes
                        .chunks(w.ty.size() as usize)
                        .map(|b| w.ty.value(b))
                        .collect();
                    json!({"step": r.step, "array": w.name, "start": r.start, "end": r.end, "values": values})
                })
                .collect();
            out.insert(item.id.clone(), Value::Array(rows));
        }
        out
    }

    /// Each array as the core's column view reads it (Mark set: logic columns), by
    /// `<item>.<write>`: its type, count, step length and interpolation, and each step that
    /// changed it, ascending, with the index ranges the logic module hands the view (at most
    /// [`crate::world::HANDED`], [`handed`]) and the runs it wrote, `[start, [values]]`. Before
    /// step 0 every element is zero.
    pub fn arrays(&self, piece: &Piece) -> Map<String, Value> {
        let mut out = Map::new();
        for item in &piece.items {
            let list = self.ranges.get(&item.id).map_or(&[][..], Vec::as_slice);
            for (j, w) in item.writes.iter().enumerate() {
                let mut steps: BTreeMap<i64, (Vec<[u64; 2]>, Vec<Value>)> = BTreeMap::new();
                for r in list.iter().filter(|r| r.write == j as u32) {
                    let values: Vec<Value> = r
                        .bytes
                        .chunks(w.ty.size() as usize)
                        .map(|b| w.ty.value(b))
                        .collect();
                    let step = steps.entry(r.step).or_default();
                    step.0.push([u64::from(r.start), u64::from(r.end)]);
                    step.1.push(json!([r.start, values]));
                }
                let list: Vec<Value> = steps
                    .iter()
                    .map(|(k, (runs, values))| {
                        json!({"step": k, "changed": handed(runs), "values": values})
                    })
                    .collect();
                out.insert(
                    format!("{}.{}", item.id, w.name),
                    json!({"type": w.ty.name(), "count": w.count, "every": item.step,
                           "linear": w.linear, "steps": list}),
                );
            }
        }
        out
    }
}
