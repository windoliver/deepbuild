//! The logic module's steps (canvas primitives: Logic `logic@1`, Logic: checkpoints and bake;
//! #531). Step k of an item runs at k times its step length: the logic module fills the read
//! region in declaration order (each read control's entries stamped since the last step, each
//! read array as earlier steps left it, then the step's seed), clears the page bitmap to the pages
//! its own writes touched, calls `step(k)` under the item's fuel and stack, and copies the write
//! region into the item's arrays. A trap freezes only its item. Checkpoints hold memory and the
//! program's globals: the first and every eighth the whole memory, the rest the pages the bitmap
//! marked since the one before. A restore loads one into a fresh instance and never runs the
//! start function or `init` again. No step starts a thread: fuel bounds it.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::rc::Rc;

use deep_canvas_sandbox::rewrite::{self, BLOCK, FUEL, GLOBAL, PAGES, START};
use deep_sandbox_wasmtime::{Call, Faults, Runner};
use serde_json::{json, Map, Value};
use wasmparser::{ExternalKind, Parser, Payload, ValType};
use wasmtime::Val;

use crate::bake::{self, Range};
use crate::piece::{h64, step_seed, Item, Piece, Read, Ty, PAGE, PER_STEP};
use crate::Planted;

/// An entry on the input track (Input track entries).
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub t: i64,
    pub seq: u32,
    pub control: String,
    pub value: f64,
    pub writer: String,
    pub player: u32,
}

impl Entry {
    pub fn parse(v: &Value) -> Option<Entry> {
        Some(Entry {
            t: v.get("t")?.as_i64()?,
            seq: v.get("seq").map_or(Some(0), Value::as_u64)? as u32,
            control: v.get("control")?.as_str()?.to_string(),
            value: v.get("value")?.as_f64()?,
            writer: v
                .get("writer")
                .map_or(Some("you"), Value::as_str)?
                .to_string(),
            player: v.get("player").map_or(Some(1), Value::as_u64)? as u32,
        })
    }
    pub fn to_json(&self) -> Value {
        json!({"t": self.t, "seq": self.seq, "control": self.control, "value": self.value, "writer": self.writer, "player": self.player})
    }
}

/// The input track by control, each in the track's order: by time, player and seq.
pub type Track = BTreeMap<String, Vec<Entry>>;

pub fn track_of(entries: &[Entry]) -> Track {
    let mut out: Track = BTreeMap::new();
    for e in entries {
        out.entry(e.control.clone()).or_default().push(e.clone());
    }
    for list in out.values_mut() {
        list.sort_by_key(|e| (e.t, e.player, e.seq));
    }
    out
}

/// The exports the rewrite gave a logic item's program: its mutable globals (with their types) and
/// the page bitmap's words.
#[derive(Clone, Debug, Default)]
pub struct Names {
    pub globals: Vec<(String, &'static str)>,
    pub pages: Vec<String>,
    pub blocks: usize,
}

pub fn names(bytes: &[u8]) -> Names {
    let mut types = Vec::new();
    let mut out = Names::default();
    for p in Parser::new(0).parse_all(bytes) {
        match p {
            Ok(Payload::GlobalSection(s)) => {
                for g in s.into_iter().flatten() {
                    types.push(match g.ty.content_type {
                        ValType::I32 => "i32",
                        ValType::I64 => "i64",
                        ValType::F32 => "f32",
                        _ => "f64",
                    });
                }
            }
            Ok(Payload::ExportSection(s)) => {
                for e in s.into_iter().flatten() {
                    if e.kind != ExternalKind::Global {
                        continue;
                    }
                    if e.name.starts_with(GLOBAL) {
                        out.globals.push((
                            e.name.to_string(),
                            types.get(e.index as usize).copied().unwrap_or("i32"),
                        ));
                    } else if e.name.starts_with(PAGES) {
                        out.pages.push(e.name.to_string());
                    } else if e.name.starts_with(BLOCK) {
                        out.blocks += 1;
                    }
                }
            }
            _ => {}
        }
    }
    let index = |n: &str| {
        n.rsplit('.')
            .next()
            .and_then(|i| i.parse::<u32>().ok())
            .unwrap_or(0)
    };
    out.globals.sort_by_key(|(n, _)| index(n));
    out.pages.sort_by_key(|n| index(n));
    out
}

/// One step's items and arrays: each write's 64-bit hash and each emitting item's rows.
pub type StepRow = (Map<String, Value>, Map<String, Value>);

/// What each step and checkpoint left, as a bake reports it.
#[derive(Default)]
pub struct Record {
    pub(crate) steps: BTreeMap<i64, StepRow>,
    pub checkpoints: Map<String, Value>,
    /// Each item's changed element ranges, in step order (Logic: checkpoints and bake).
    pub(crate) ranges: BTreeMap<String, Vec<Range>>,
    /// Each item's arrays whole at each checkpoint and where its record starts, by step label.
    pub(crate) wholes: BTreeMap<String, BTreeMap<i64, Vec<u8>>>,
    pub traps: Vec<Value>,
    /// Each item's fuel at each step it ran.
    pub fuel: BTreeMap<usize, Vec<(i64, i64)>>,
}

impl Record {
    /// Each step's items (hash, fuel, failed, pages) and arrays, by step.
    pub fn rows(&self) -> &BTreeMap<i64, StepRow> {
        &self.steps
    }
    /// An item's checkpoints, as `(step, deep hash)`.
    pub fn deep(&self, id: &str) -> Vec<(i64, String)> {
        self.checkpoints
            .get(id)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|c| {
                Some((
                    c.get("step")?.as_i64()?,
                    c.get("deep_hash")?.as_str()?.to_string(),
                ))
            })
            .collect()
    }
    /// Each emitting item's occurrence list (`<logic ID>.occurrences`), by item ID: every row its
    /// steps emitted, in step order, each at its step and the step's time. A step run again
    /// replaces its rows, so a seek or a rollback leaves no copy of a replaced step's.
    pub fn occurrences(&self, piece: &Piece) -> Map<String, Value> {
        let mut out = Map::new();
        for item in piece.items.iter().filter(|i| !i.emits.is_empty()) {
            let name = format!("{}.occurrences", item.id);
            let mut list = Vec::new();
            for (k, (_, arrays)) in &self.steps {
                for row in arrays
                    .get(&name)
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let mut r = json!({"step": k, "t": k * item.step});
                    if let (Some(o), Some(fields)) = (r.as_object_mut(), row.as_object()) {
                        o.extend(fields.clone());
                    }
                    list.push(r);
                }
            }
            out.insert(item.id.clone(), Value::Array(list));
        }
        out
    }
    /// The occurrence lists as a seek leaves them: this record's, with each step `again` ran
    /// replaced by that run's rows.
    pub fn occurrences_after(&self, again: &[&Record], piece: &Piece) -> Map<String, Value> {
        let mut steps = self.steps.clone();
        for r in again {
            steps.extend(r.steps.iter().map(|(k, v)| (*k, v.clone())));
        }
        Record {
            steps,
            ..Record::default()
        }
        .occurrences(piece)
    }
    fn checkpoint(&mut self, id: &str, step: i64, deep: u64, arrays: &[u8]) {
        self.whole(id, step, arrays);
        let list = self
            .checkpoints
            .entry(id.to_string())
            .or_insert_with(|| json!([]));
        if let Some(a) = list.as_array_mut() {
            a.push(json!({"step": step, "deep_hash": format!("{deep:016x}")}));
        }
    }
}

pub(crate) enum Memory {
    Whole(Vec<u8>),
    Pages(BTreeMap<u32, Vec<u8>>),
}

/// A checkpoint as the ring keeps it.
pub(crate) struct Stored {
    pub(crate) step: i64,
    /// Steps that had run.
    ran: i64,
    globals: Vec<Val>,
    arrays: Vec<u8>,
    prev: Vec<u8>,
    cursor: BTreeMap<String, usize>,
    pending: BTreeMap<String, VecDeque<Entry>>,
    pub(crate) memory: Memory,
}

/// One item's state as it steps.
pub(crate) struct Live {
    runner: Runner,
    names: Rc<Names>,
    failed: bool,
    /// The first step not yet run or passed: on a turn clock, steps nothing asked for are passed.
    next: i64,
    /// Steps that have run, and the last of them (−1 before step 0): checkpoints come every
    /// `checkpoint.every` steps that ran (Logic: turn clock).
    ran: i64,
    pub(crate) last: i64,
    arrays: Vec<u8>,
    /// With a linear write, the write region as it stood before the last step that ran: what a
    /// frame blends from (Logic: interpolated writes). Empty for an item that only holds.
    prev: Vec<u8>,
    cursor: BTreeMap<String, usize>,
    pending: BTreeMap<String, VecDeque<Entry>>,
    dirty: BTreeSet<u32>,
    /// The pages written since the last keyframe stored (crate::keyframes).
    pub(crate) kdirty: BTreeSet<u32>,
    stored: Vec<Stored>,
    /// The last step a checkpoint was taken at.
    checked: Option<i64>,
    /// Steps between checkpoints: `checkpoint.every`, doubled each time the ring passes its budget.
    spacing: i64,
    /// Restored from a checkpoint: its steps run again steps a bake already ran.
    rerun: bool,
}

/// The rows a step emitted, in list order: each its kind's index and its bytes.
type Rows = Vec<(usize, Vec<u8>)>;

impl Stored {
    fn bytes(&self) -> u64 {
        let memory = match &self.memory {
            Memory::Whole(m) => m.len(),
            Memory::Pages(p) => p.len() * PAGE as usize,
        };
        (memory + self.arrays.len() + self.prev.len() + 8 * self.globals.len()) as u64
    }
}

impl Live {
    /// Doubles the spacing while the ring passes its budget: each checkpoint off the new spacing
    /// is dropped, its pages merged into the next one kept (the pages it wrote are as they were
    /// there, since nothing wrote them again before it), or, past the last one kept, into the
    /// pages the next checkpoint takes. The planted ring drops its oldest instead.
    fn thin(&mut self, budget: u64, drops_oldest: bool) {
        while self.stored.len() > 1 && self.stored.iter().map(Stored::bytes).sum::<u64>() > budget {
            if drops_oldest {
                let oldest = self.stored.remove(0);
                let next = &mut self.stored[0];
                let later = std::mem::replace(&mut next.memory, Memory::Pages(BTreeMap::new()));
                next.memory = merge(Some(oldest.memory), later);
                continue;
            }
            self.spacing *= 2;
            let mut kept: Vec<Stored> = Vec::new();
            let mut carry: Option<Memory> = None;
            for mut s in std::mem::take(&mut self.stored) {
                if s.ran % self.spacing != 0 {
                    carry = Some(merge(carry, s.memory));
                    continue;
                }
                if let Some(c) = carry.take() {
                    s.memory = merge(Some(c), s.memory);
                }
                kept.push(s);
            }
            self.stored = kept;
            match carry {
                Some(Memory::Whole(m)) => {
                    self.dirty.extend(0..(m.len() as u64).div_ceil(PAGE) as u32)
                }
                Some(Memory::Pages(p)) => self.dirty.extend(p.into_keys()),
                None => {}
            }
        }
    }
}

/// An earlier checkpoint's memory under a later one's: the later one's pages win.
pub(crate) fn merge(earlier: Option<Memory>, later: Memory) -> Memory {
    match (earlier, later) {
        (None, l) | (Some(_), l @ Memory::Whole(_)) => l,
        (Some(Memory::Whole(mut m)), Memory::Pages(p)) => {
            for (i, b) in p {
                m[i as usize * PAGE as usize..][..PAGE as usize].copy_from_slice(&b);
            }
            Memory::Whole(m)
        }
        (Some(Memory::Pages(mut e)), Memory::Pages(p)) => {
            e.extend(p);
            Memory::Pages(e)
        }
    }
}

impl Live {
    /// This state as a checkpoint holds it, with `memory`.
    pub(crate) fn stored(&mut self, memory: Memory) -> Stored {
        Stored {
            step: self.last + 1,
            ran: self.ran,
            globals: self.globals(),
            arrays: self.arrays.clone(),
            prev: self.prev.clone(),
            cursor: self.cursor.clone(),
            pending: self.pending.clone(),
            memory,
        }
    }
    fn globals(&mut self) -> Vec<Val> {
        let names = self.names.clone();
        names
            .globals
            .iter()
            .map(|(n, _)| self.runner.global(n).unwrap_or(Val::I32(0)))
            .collect()
    }
    fn encoded(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        for v in self.globals() {
            match v {
                Val::I32(x) => {
                    out.push(1);
                    out.extend(x.to_le_bytes());
                }
                Val::I64(x) => {
                    out.push(2);
                    out.extend(x.to_le_bytes());
                }
                Val::F32(x) => {
                    out.push(3);
                    out.extend(x.to_le_bytes());
                }
                Val::F64(x) => {
                    out.push(4);
                    out.extend(x.to_le_bytes());
                }
                _ => {}
            }
        }
        out
    }
    pub(crate) fn memory(&mut self) -> &[u8] {
        self.runner.memory("memory").unwrap_or(&[])
    }
    /// The step hash: the program's globals, the arrays it wrote and the rows it emitted, each
    /// after its kind's index (none for a step that emitted none, so an item's hash is as before).
    fn step_hash(&mut self, rows: &Rows) -> u64 {
        let mut b = self.encoded();
        b.extend(&self.arrays);
        for (kind, row) in rows {
            b.extend((*kind as u32).to_le_bytes());
            b.extend(row);
        }
        h64(&b)
    }
    /// The full state's hash: the step after the last that ran, memory, globals and arrays.
    fn deep_hash(&mut self) -> u64 {
        let mut b = (self.last + 1).to_le_bytes().to_vec();
        let pending: usize = self.pending.values().map(VecDeque::len).sum();
        b.extend((pending as u32).to_le_bytes());
        b.extend(self.encoded());
        b.extend(&self.arrays.clone());
        b.extend(self.memory().to_vec());
        h64(&b)
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The logic items of a piece, stepping on one input track.
pub struct World {
    pub piece: Rc<Piece>,
    track: Track,
    lives: Vec<Live>,
    /// Each item's arrays as its last step left them.
    published: Vec<Vec<u8>>,
    store: bool,
    planted: Planted,
    /// A session's keyframes every 10 s of play, spilled to the cache (crate::keyframes).
    pub cache: Option<crate::keyframes::Cache>,
}

pub type Failed = Value;

impl World {
    fn runner(bytes: &[u8], id: &str) -> Result<Runner, Failed> {
        Runner::new(bytes, Faults::default(), true)
            .map_err(|e| json!({"ok": false, "code": "instantiate_failed", "item": id, "what": e}))
    }

    /// Every item instantiated, its start function and `init` run under a step's budgets; a trap
    /// there fails the item before step 0. `counted`: one item runs its counted rewrite instead.
    pub fn new(
        piece: Rc<Piece>,
        track: Track,
        store: bool,
        planted: Planted,
        rec: &mut Record,
        counted: Option<(usize, &[u8])>,
    ) -> Result<World, Failed> {
        let mut lives = Vec::new();
        for (i, item) in piece.items.iter().enumerate() {
            let bytes = counted
                .filter(|(c, _)| *c == i)
                .map_or(item.bytes.as_slice(), |(_, b)| b);
            let mut runner = World::runner(bytes, &item.id)?;
            let names = Rc::new(names(bytes));
            let mut failed = false;
            // The data assets, copied once before the start function: then they're memory.
            if !item.assets.is_empty() {
                let at = item.assets_at as usize;
                let bytes = item.asset_bytes();
                runner.memory_mut("memory").expect("a memory")[at..at + bytes.len()]
                    .copy_from_slice(&bytes);
            }
            let mut calls = Vec::new();
            if runner.exports(START) {
                calls.push((START, vec![]));
            }
            calls.push(("init", vec![Val::I64(step_seed(piece.seed, &item.id, 0))]));
            for (export, args) in calls {
                let call = Call {
                    export: export.into(),
                    args,
                    fuel: item.fuel,
                    stack: item.stack,
                    deadline: None,
                };
                let out = runner.call(&call).map_err(
                    |e| json!({"ok": false, "code": "run_failed", "item": item.id, "what": e}),
                )?;
                if let Some(t) = out.trap {
                    rec.traps.push(json!({"item": item.id, "step": null, "t": null, "kind": t.kind, "function": t.function, "offset": t.offset, "inputs": [], "source": source(item, &planted, t.function, t.offset)}));
                    failed = true;
                    break;
                }
            }
            let size = item.layout.size("writes") as usize;
            let linear = item.writes.iter().any(|w| w.linear);
            lives.push(Live {
                runner,
                names,
                failed,
                next: 0,
                ran: 0,
                last: -1,
                arrays: vec![0; size],
                prev: if linear { vec![0; size] } else { Vec::new() },
                cursor: BTreeMap::new(),
                pending: BTreeMap::new(),
                dirty: BTreeSet::new(),
                kdirty: BTreeSet::new(),
                stored: Vec::new(),
                checked: None,
                spacing: item.every,
                rerun: false,
            });
        }
        let published = lives.iter().map(|l| l.arrays.clone()).collect();
        Ok(World {
            piece,
            track,
            lives,
            published,
            store,
            planted,
            cache: None,
        })
    }

    pub fn failed(&self) -> Vec<String> {
        self.piece
            .items
            .iter()
            .zip(&self.lives)
            .filter(|(_, l)| l.failed)
            .map(|(i, _)| i.id.clone())
            .collect()
    }

    pub fn peek(&mut self, item: &str, at: usize, len: usize) -> Option<String> {
        let i = self.piece.items.iter().position(|x| x.id == item)?;
        let m = self.lives[i].memory();
        Some(hex(m.get(at..at.checked_add(len)?)?))
    }

    /// Each array, by `<item>.<write>`, as its item's last step left it, as its write region lays
    /// it out.
    pub fn arrays(&self) -> Vec<(String, Vec<u8>)> {
        arrays_of(&self.piece, self.lives.iter().map(|l| &l.arrays[..]))
    }

    /// Item `i`'s write region as its last step left it.
    pub fn write_region(&self, i: usize) -> &[u8] {
        &self.lives[i].arrays
    }

    /// What a frame draws from, per item: its last step that ran, its write region before that
    /// step (empty without a linear write) and after it.
    pub fn shown(&self) -> Vec<Shown> {
        self.lives
            .iter()
            .map(|l| (l.last, l.prev.clone(), l.arrays.clone()))
            .collect()
    }

    /// Each item's deep hash now.
    pub fn deep_hashes(&mut self) -> Map<String, Value> {
        let ids: Vec<String> = self.piece.items.iter().map(|i| i.id.clone()).collect();
        ids.into_iter()
            .zip(self.lives.iter_mut())
            .map(|(id, l)| (id, json!(format!("{:016x}", l.deep_hash()))))
            .collect()
    }

    /// Whether every item's ring holds a checkpoint at step `k`.
    pub fn has_checkpoint(&self, k: i64) -> bool {
        self.lives
            .iter()
            .all(|l| l.stored.iter().any(|s| s.step == k))
    }
    /// The steps every item's ring holds a checkpoint at, in order.
    pub fn checkpoint_steps(&self) -> Vec<i64> {
        let Some(first) = self.lives.first() else {
            return Vec::new();
        };
        first
            .stored
            .iter()
            .map(|s| s.step)
            .filter(|k| self.has_checkpoint(*k))
            .collect()
    }

    /// The step every item is about to run, when they agree.
    pub fn at(&self) -> Option<i64> {
        let k = self.lives.first()?.next;
        self.lives.iter().all(|l| l.next == k).then_some(k)
    }

    fn checkpoint(&mut self, i: usize, rec: &mut Record) {
        let (ring, id) = (self.piece.items[i].ring, self.piece.items[i].id.clone());
        let (store, planted) = (self.store, self.planted);
        let l = &mut self.lives[i];
        if let Some(cache) = self.cache.as_mut().filter(|_| !l.failed) {
            cache.take(i, l);
        }
        // Labelled by the step after the last that ran: on a fixed clock, the step about to run.
        let at = l.last + 1;
        if l.failed || l.ran % l.spacing != 0 || l.checked == Some(at) {
            return;
        }
        l.checked = Some(at);
        let deep = l.deep_hash();
        rec.checkpoint(&id, at, deep, &l.arrays);
        // A seek back replays steps the ring has passed: it keeps only checkpoints past its last.
        if !store || l.stored.last().is_some_and(|s| s.step >= at) {
            return;
        }
        let memory = if l.stored.len().is_multiple_of(8) {
            Memory::Whole(l.memory().to_vec())
        } else {
            let dirty: Vec<u32> = l.dirty.iter().copied().collect();
            let m = l.memory().to_vec();
            Memory::Pages(
                dirty
                    .into_iter()
                    .map(|p| (p, m[p as usize * PAGE as usize..][..PAGE as usize].to_vec()))
                    .collect(),
            )
        };
        let mut stored = l.stored(memory);
        if planted.checkpoint_drops_globals {
            stored.globals = Vec::new();
        }
        // The record of written pages clears only once the store succeeds, so a failed store
        // loses nothing from the next checkpoint.
        if planted.store_fails_at_step_120 && at == 120 {
            return;
        }
        l.stored.push(stored);
        l.dirty.clear();
        l.thin(ring, planted.ring_drops_oldest);
    }

    /// Each item's ring as it stands (the bake's `ring`): its budget, the bytes its checkpoints
    /// count, its spacing and each checkpoint with the pages and bytes it holds.
    pub fn ring(&self) -> Map<String, Value> {
        let mut out = Map::new();
        for (item, l) in self.piece.items.iter().zip(&self.lives) {
            let list: Vec<Value> = l
                .stored
                .iter()
                .map(|s| {
                    let (whole, pages): (bool, Vec<u32>) = match &s.memory {
                        Memory::Whole(m) => (true, (0..(m.len() as u64 / PAGE) as u32).collect()),
                        Memory::Pages(p) => (false, p.keys().copied().collect()),
                    };
                    json!({"step": s.step, "whole": whole, "memory": pages.len() as u64 * PAGE, "pages": pages,
                        "globals": 8 * s.globals.len(), "bytes": s.bytes()})
                })
                .collect();
            let bytes: u64 = l.stored.iter().map(Stored::bytes).sum();
            out.insert(
                item.id.clone(),
                json!({"budget": item.ring, "bytes": bytes, "spacing": l.spacing, "checkpoints": list}),
            );
        }
        out
    }

    /// Runs every item's steps below `until`, in time order; at one time, items in piece order,
    /// each reading the others' arrays as earlier steps left them. `before(k)` runs whenever every
    /// item is about to run step k, after its checkpoints.
    pub fn run(&mut self, until: i64, rec: &mut Record, before: &mut dyn FnMut(&mut World, i64)) {
        // Where the record starts: each item's arrays before the first step it runs.
        for (item, l) in self.piece.items.iter().zip(&self.lives) {
            rec.whole(&item.id, l.next, &l.arrays);
        }
        loop {
            let t = (0..self.lives.len())
                .filter(|&i| self.lives[i].next < until)
                .map(|i| self.lives[i].next * self.piece.items[i].step)
                .min();
            for i in 0..self.lives.len() {
                if t.is_none_or(|t| self.lives[i].next * self.piece.items[i].step == t) {
                    self.checkpoint(i, rec);
                }
            }
            if let Some(k) = self.at() {
                before(self, k);
            }
            let Some(t) = t else { break };
            let mut group = Vec::new();
            for i in 0..self.lives.len() {
                let next = self.lives[i].next;
                if next < until && next * self.piece.items[i].step == t {
                    // A turn clock passes a step nothing asks for: it keeps its number and seed
                    // for when one is asked, and writes, hashes and bakes nothing.
                    if self.asked(i) == Some(next) {
                        group.push(i);
                    } else {
                        self.lives[i].next += 1;
                    }
                }
            }
            if group.is_empty() {
                continue;
            }
            let snapshot = self.published.clone();
            for i in group {
                self.step(i, &snapshot, rec);
                self.published[i] = self.lives[i].arrays.clone();
            }
        }
    }

    /// The first step from item `i`'s next on that it runs (Logic: turn clock): the next step on
    /// a fixed clock; on `on_input`, step 0, then the first step at or after an entry it hasn't
    /// read of a control it reads, or the step `due` names when that's after the step that wrote
    /// it; None while nothing asks. It reads only the track and the item's own state, so a seek
    /// runs the steps play does.
    fn asked(&self, i: usize) -> Option<i64> {
        let (item, l) = (&self.piece.items[i], &self.lives[i]);
        if !item.turn || l.last < 0 {
            return Some(l.next);
        }
        let mut k: Option<i64> = None;
        for r in item
            .layout
            .entries
            .iter()
            .filter(|e| e.read == Read::Control)
        {
            // Entries past a step's PER_STEP wait for the next step, as on a fixed clock.
            if l.pending.get(&r.name).is_some_and(|q| !q.is_empty()) {
                return Some(l.next);
            }
            let c = l.cursor.get(&r.name).copied().unwrap_or(0);
            if let Some(e) = self.track.get(&r.name).and_then(|list| list.get(c)) {
                let mut t = e.t;
                if self.planted.turn_runs_at_frame_boundary {
                    let frame = crate::F / 30;
                    t = t.div_euclid(frame) * frame
                        + if t.rem_euclid(frame) != 0 { frame } else { 0 };
                }
                let s =
                    (t.div_euclid(item.step) + i64::from(t.rem_euclid(item.step) != 0)).max(l.next);
                k = Some(k.map_or(s, |k| k.min(s)));
            }
        }
        if let Some(at) = item.due.filter(|_| !self.planted.turn_ignores_due) {
            let b = &l.arrays[at as usize..at as usize + 4];
            let d = i64::from(i32::from_le_bytes(b.try_into().expect("4 bytes")));
            if d >= l.next {
                k = Some(k.map_or(d, |k| k.min(d)));
            }
        }
        k
    }

    /// The first step any item runs, from where each stands; None while nothing asks.
    pub fn wake(&self) -> Option<i64> {
        (0..self.lives.len()).filter_map(|i| self.asked(i)).min()
    }

    /// The first time after `t` a frame of this state changes: t + 1 while a linear write still
    /// blends, else the time of the first step an item runs; None while nothing asks, so a still
    /// turn game's frame stays valid until an entry arrives or `due` comes.
    pub fn valid_until(&self, t: i64) -> Option<i64> {
        (0..self.lives.len())
            .filter_map(|i| {
                let (item, l) = (&self.piece.items[i], &self.lives[i]);
                if !l.prev.is_empty() && l.last >= 0 && t < (l.last + 1) * item.step {
                    return Some(t + 1);
                }
                self.asked(i).map(|k| k * item.step)
            })
            .min()
    }

    /// Each item's arrays as a frame at `t` (flicks) draws them, by `<item>.<write>` (Logic:
    /// interpolated writes): `drawn` over this state.
    pub fn drawn(&self, t: i64) -> Map<String, Value> {
        let shown = self
            .lives
            .iter()
            .map(|l| (l.last, &l.prev[..], &l.arrays[..]));
        drawn(&self.piece, shown, t, self.planted.linear_blends_forward)
    }

    fn step(&mut self, i: usize, snapshot: &[Vec<u8>], rec: &mut Record) {
        let piece = self.piece.clone();
        let item = &piece.items[i];
        let k = self.lives[i].next;
        let t = k * item.step;
        // Each read control's entries stamped by now, at most PER_STEP a step.
        let mut taken: BTreeMap<&str, Vec<Entry>> = BTreeMap::new();
        {
            let l = &mut self.lives[i];
            for r in item
                .layout
                .entries
                .iter()
                .filter(|e| e.read == Read::Control)
            {
                let list = self.track.get(&r.name).map_or(&[][..], Vec::as_slice);
                let c = l.cursor.entry(r.name.clone()).or_insert(0);
                let q = l.pending.entry(r.name.clone()).or_default();
                while *c < list.len() && list[*c].t <= t {
                    q.push_back(list[*c].clone());
                    *c += 1;
                }
                let n = q.len().min(PER_STEP);
                taken.insert(&r.name, q.drain(..n).collect());
            }
        }
        let inputs: Vec<Value> = taken.values().flatten().map(Entry::to_json).collect();
        let l = &mut self.lives[i];
        l.next = k + 1;
        l.ran += 1;
        l.last = k;
        // What a linear write blends from: the arrays as they stood before this step ran.
        if !l.prev.is_empty() {
            l.prev.clone_from(&l.arrays);
        }
        if l.failed {
            report(rec, item, k, l, None, 0, Vec::new(), &Vec::new());
            return;
        }
        // The read region, in declaration order.
        let size = item.layout.size("reads") as usize;
        let mut region = vec![0u8; size];
        for e in &item.layout.entries {
            let at = e.offset as usize;
            match &e.read {
                Read::Control => {
                    let list = &taken[e.name.as_str()];
                    region[at..at + 4].copy_from_slice(&(list.len() as u32).to_le_bytes());
                    for (j, x) in list.iter().enumerate() {
                        let o = at + 8 + 16 * j;
                        region[o..o + 4].copy_from_slice(&x.player.to_le_bytes());
                        region[o + 8..o + 16].copy_from_slice(&x.value.to_le_bytes());
                    }
                }
                Read::Array { item: from, offset } => {
                    let src = &snapshot[*from][*offset as usize..(*offset + e.size) as usize];
                    region[at..at + e.size as usize].copy_from_slice(src);
                }
                Read::Seed => region[at..at + 8]
                    .copy_from_slice(&step_seed(piece.seed, &item.id, k).to_le_bytes()),
                Read::None => {}
            }
        }
        let from = item.reads_at as usize;
        let fits = l
            .runner
            .memory("memory")
            .is_some_and(|m| from + size <= m.len());
        if !fits {
            l.failed = true;
            rec.traps.push(json!({"item": item.id, "step": k, "t": t, "kind": "bounds", "region": "reads", "function": null, "offset": null, "inputs": inputs}));
            report(rec, item, k, l, None, 0, Vec::new(), &Vec::new());
            return;
        }
        let memory = l.runner.memory_mut("memory").expect("a memory");
        memory[from..from + size].copy_from_slice(&region);
        // The bitmap starts each step with the pages the logic module's own writes touched: the
        // read region and each emitted kind's count, zeroed before the step.
        let mut touched = Vec::new();
        if size > 0 {
            touched.extend(from as u64 / PAGE..=(from + size - 1) as u64 / PAGE);
        }
        let mut at = item.emits_at as usize;
        for e in &item.emits {
            memory[at..at + 4].fill(0);
            touched.push(at as u64 / PAGE);
            at += e.size() as usize;
        }
        let mut words = vec![0u64; l.names.pages.len()];
        for p in touched {
            if let Some(w) = words.get_mut((p / 64) as usize) {
                *w |= 1 << (p % 64);
            }
        }
        let names = l.names.clone();
        for (w, n) in words.iter().zip(&names.pages) {
            let _ = l.runner.set(n, Val::I64(*w as i64));
        }
        let call = Call {
            export: "step".into(),
            args: vec![Val::I64(k)],
            fuel: item.fuel,
            stack: item.stack,
            deadline: None,
        };
        let out = l.runner.call(&call);
        let left = match l.runner.global(FUEL) {
            Some(Val::I64(f)) => f,
            _ => 0,
        };
        let fuel = (item.fuel - left).clamp(0, item.fuel);
        let mut pages = Vec::new();
        for (w, n) in names.pages.iter().enumerate() {
            if let Some(Val::I64(bits)) = l.runner.global(n) {
                for b in 0..64 {
                    if (bits as u64) >> b & 1 == 1 {
                        pages.push(w as u32 * 64 + b);
                    }
                }
            }
        }
        l.dirty.extend(&pages);
        l.kdirty.extend(&pages);
        rec.fuel.entry(i).or_default().push((k, fuel));
        let trap = match out {
            Ok(o) => o.trap.map(|t| (t.kind, Some(t.function), Some(t.offset))),
            Err(e) => Some((format!("run_failed: {e}"), None, None)),
        };
        if let Some((kind, function, offset)) = trap {
            l.failed = true;
            let src = function
                .zip(offset)
                .and_then(|(f, o)| source(item, &self.planted, f, o));
            rec.traps.push(json!({"item": item.id, "step": k, "t": t, "kind": kind, "function": function, "offset": offset, "inputs": inputs, "source": src}));
            report(rec, item, k, l, None, fuel, pages, &Vec::new());
            return;
        }
        let memory = l.runner.memory("memory").expect("a memory");
        let mut rows = match emitted(item, memory, &self.planted) {
            Ok(rows) => rows,
            // A count past its kind's max_per_step traps as any trap does: no row is dropped.
            Err((kind, count)) => {
                l.failed = true;
                rec.traps.push(json!({"item": item.id, "step": k, "t": t, "kind": "occurrences", "occurrence": kind, "count": count, "function": null, "offset": null, "inputs": inputs}));
                report(rec, item, k, l, None, fuel, pages, &Vec::new());
                return;
            }
        };
        if self.planted.seek_repeats_occurrences && l.rerun {
            rows.extend(rows.clone());
        }
        let w = item.writes_at as usize;
        let n = l.arrays.len();
        let mut fresh = memory[w..w + n].to_vec();
        if self.planted.replay_changes_step_37 && k == 37 && i == 0 {
            changed(item, &mut fresh);
        }
        let mut changed = bake::ranges(item, k, &l.arrays, &fresh);
        if self.planted.ranges_drop_second_at_step_5000 && k == 5000 && changed.len() > 1 {
            changed.remove(1);
        }
        rec.ranges
            .entry(item.id.clone())
            .or_default()
            .extend(changed);
        l.arrays = fresh;
        let h = l.step_hash(&rows);
        report(rec, item, k, l, Some(h), fuel, pages, &rows);
    }

    /// The nearest checkpoint every item's ring holds at or before step `k`.
    pub fn nearest(&self, k: i64) -> Option<i64> {
        self.checkpoint_steps()
            .into_iter()
            .filter(|c| *c <= k)
            .max()
    }

    /// Seeks this world to the checkpoint at step `c`, in place: each item's state is restored
    /// into a fresh instance, as `restore` does, and its ring is kept.
    pub fn seek(&mut self, c: i64) -> Result<(), Failed> {
        let back = self.restore(c, None)?;
        self.adopt(back, c);
        Ok(())
    }

    /// Seeks this world to its cache's keyframe at step `c`, in place, keeping its ring.
    pub fn seek_keyframe(&mut self, c: i64) -> Result<(), Failed> {
        let cache = self
            .cache
            .as_ref()
            .ok_or_else(|| json!({"ok": false, "code": "bad_input", "what": "no cache"}))?;
        let mut lives = Vec::new();
        for i in 0..self.lives.len() {
            let (memory, s) = cache.load(i, c)?;
            lives.push(self.revive(i, &self.piece.items[i].bytes, memory, s)?);
        }
        let back = self.restored(lives);
        self.adopt(back, c);
        Ok(())
    }

    fn adopt(&mut self, mut back: World, c: i64) {
        for (l, mut r) in self.lives.iter_mut().zip(back.lives.drain(..)) {
            r.stored = std::mem::take(&mut l.stored);
            r.checked = Some(c);
            r.spacing = l.spacing;
            *l = r;
        }
        self.published = back.published;
    }

    /// Forks the input track at step `k`: entries stamped after step k's time are dropped,
    /// `entries` are added, and checkpoints past step k, which didn't see them, leave the ring.
    pub fn fork_track(&mut self, k: i64, entries: &[Entry]) {
        let len = self.piece.items.first().map_or(0, |i| i.step);
        let mut kept: Vec<Entry> = self
            .track
            .values()
            .flatten()
            .filter(|e| e.t <= (k - 1) * len)
            .cloned()
            .collect();
        kept.extend(entries.iter().cloned());
        self.track = track_of(&kept);
        for l in &mut self.lives {
            l.stored.retain(|s| s.step <= k);
            if l.checked.is_some_and(|c| c > k) {
                l.checked = None;
            }
        }
    }

    /// A fresh instance per item, loaded from the checkpoint at step `c`: the last whole memory at
    /// or before it, then the pages each later one kept, and the globals and arrays; the start
    /// function and `init` never run again.
    pub fn restore(&self, c: i64, counted: Option<(usize, &[u8])>) -> Result<World, Failed> {
        let mut lives = Vec::new();
        for (i, item) in self.piece.items.iter().enumerate() {
            let stored = &self.lives[i].stored;
            let Some(j) = stored.iter().position(|s| s.step == c) else {
                return Err(
                    json!({"ok": false, "code": "bad_input", "what": format!("{} has no checkpoint at step {c}", item.id)}),
                );
            };
            let whole = (0..=j)
                .rev()
                .find(|&w| matches!(stored[w].memory, Memory::Whole(_)))
                .expect("the first checkpoint is whole");
            let Memory::Whole(m) = &stored[whole].memory else {
                unreachable!()
            };
            let mut memory = m.clone();
            for s in &stored[whole + 1..=j] {
                if let Memory::Pages(pages) = &s.memory {
                    for (p, bytes) in pages {
                        memory[*p as usize * PAGE as usize..][..PAGE as usize]
                            .copy_from_slice(bytes);
                    }
                }
            }
            let bytes = counted
                .filter(|(x, _)| *x == i)
                .map_or(item.bytes.as_slice(), |(_, b)| b);
            lives.push(self.revive(i, bytes, memory, &stored[j])?);
        }
        Ok(self.restored(lives))
    }

    /// A fresh instance of item `i` running `bytes`, holding checkpoint `s` with `memory`.
    fn revive(
        &self,
        i: usize,
        bytes: &[u8],
        mut memory: Vec<u8>,
        s: &Stored,
    ) -> Result<Live, Failed> {
        let item = &self.piece.items[i];
        if self.planted.restore_keeps_regions_only {
            let mut kept = vec![0u8; memory.len()];
            for (at, n) in [
                (item.reads_at, item.layout.size("reads")),
                (item.writes_at, item.layout.size("writes")),
            ] {
                let r = at as usize..(at + n) as usize;
                kept[r.clone()].copy_from_slice(&memory[r]);
            }
            memory = kept;
        }
        if self.planted.restore_copies_assets && !item.assets.is_empty() {
            let b = item.asset_bytes();
            memory[item.assets_at as usize..][..b.len()].copy_from_slice(&b);
        }
        let mut live = World::load(bytes, item, &memory, &s.globals)?;
        live.rerun = true;
        live.next = s.step;
        live.ran = s.ran;
        live.last = s.step - 1;
        live.spacing = self.lives[i].spacing;
        live.arrays = s.arrays.clone();
        if !self.planted.seek_restores_arrays_only {
            live.prev = s.prev.clone();
        }
        live.cursor = s.cursor.clone();
        live.pending = s.pending.clone();
        Ok(live)
    }

    /// A world of restored items on this one's track, keeping no checkpoints.
    fn restored(&self, lives: Vec<Live>) -> World {
        let published = lives.iter().map(|l| l.arrays.clone()).collect();
        World {
            piece: self.piece.clone(),
            track: self.track.clone(),
            lives,
            published,
            store: false,
            planted: self.planted,
            cache: None,
        }
    }

    fn load(bytes: &[u8], item: &Item, memory: &[u8], globals: &[Val]) -> Result<Live, Failed> {
        let mut runner = World::runner(bytes, &item.id)?;
        let names = Rc::new(names(bytes));
        runner
            .memory_mut("memory")
            .expect("a memory")
            .copy_from_slice(memory);
        for ((n, _), v) in names.globals.iter().zip(globals) {
            runner.set(n, *v).map_err(
                |e| json!({"ok": false, "code": "run_failed", "item": item.id, "what": e}),
            )?;
        }
        let pages = (memory.len() as u64).div_ceil(PAGE) as u32;
        Ok(Live {
            runner,
            names,
            failed: false,
            next: 0,
            ran: 0,
            last: -1,
            arrays: Vec::new(),
            prev: Vec::new(),
            cursor: BTreeMap::new(),
            pending: BTreeMap::new(),
            // The restore wrote every page.
            dirty: (0..pages).collect(),
            kdirty: (0..pages).collect(),
            stored: Vec::new(),
            checked: None,
            spacing: item.every,
            rerun: false,
        })
    }

    /// A fresh instance per item holding this world's state now, on another track: the entries at
    /// or after step `k` (those a step from k on reads) are replaced by `entries`.
    pub fn fork(&mut self, entries: &[Entry]) -> Result<World, Failed> {
        let k = self.at().unwrap_or(0);
        let mut lives = Vec::new();
        for i in 0..self.lives.len() {
            let item = &self.piece.items[i];
            let (memory, globals) = {
                let l = &mut self.lives[i];
                (l.memory().to_vec(), l.globals())
            };
            let l = &self.lives[i];
            let mut live = World::load(&item.bytes, item, &memory, &globals)?;
            live.failed = l.failed;
            live.next = l.next;
            live.ran = l.ran;
            live.last = l.last;
            live.spacing = l.spacing;
            live.arrays = l.arrays.clone();
            live.prev = l.prev.clone();
            live.cursor = l.cursor.clone();
            live.pending = l.pending.clone();
            lives.push(live);
        }
        let len = self.piece.items.first().map_or(0, |i| i.step);
        let mut kept: Vec<Entry> = self
            .track
            .values()
            .flatten()
            .filter(|e| k > 0 && e.t <= (k - 1) * len)
            .cloned()
            .collect();
        kept.extend(entries.iter().cloned());
        Ok(World {
            piece: self.piece.clone(),
            track: track_of(&kept),
            lives,
            published: self.published.clone(),
            store: false,
            planted: self.planted,
            cache: None,
        })
    }

    /// The counts of each block of item `i`'s counted rewrite, zeroed first.
    pub fn zero_blocks(&mut self, i: usize) {
        for b in 0..self.lives[i].names.blocks {
            let _ = self.lives[i]
                .runner
                .set(&format!("{BLOCK}{b}"), Val::I64(0));
        }
    }
    pub fn blocks(&mut self, i: usize) -> Vec<i64> {
        (0..self.lives[i].names.blocks)
            .map(
                |b| match self.lives[i].runner.global(&format!("{BLOCK}{b}")) {
                    Some(Val::I64(n)) => n,
                    _ => 0,
                },
            )
            .collect()
    }
}

/// The planted replay's change: the first value of the item's first array, an i32 plus one, an
/// f64 (or a vector's first component) to the next f64 above it, a bool flipped.
fn changed(item: &Item, arrays: &mut [u8]) {
    let Some(w) = item.writes.first() else { return };
    let at = item.write(&w.name).expect("a write entry").offset as usize;
    match w.ty {
        Ty::Bool => arrays[at] ^= 1,
        Ty::I32 => {
            let v = i32::from_le_bytes(arrays[at..at + 4].try_into().expect("4 bytes"));
            arrays[at..at + 4].copy_from_slice(&v.wrapping_add(1).to_le_bytes());
        }
        _ => {
            let v = f64::from_le_bytes(arrays[at..at + 8].try_into().expect("8 bytes"));
            arrays[at..at + 8].copy_from_slice(&v.next_up().to_le_bytes());
        }
    }
}

/// The most index ranges a step hands the column view per array.
pub const HANDED: usize = 64;

/// A step's changed runs `[start, end)`, ascending, as the column view takes them: the first
/// [`HANDED`] − 1 as they are and any more merged into their span, so at most [`HANDED`].
pub fn handed(runs: &[[u64; 2]]) -> Vec<[u64; 2]> {
    if runs.len() <= HANDED {
        return runs.to_vec();
    }
    let mut out = runs[..HANDED - 1].to_vec();
    out.push([runs[HANDED - 1][0], runs[runs.len() - 1][1]]);
    out
}

/// The rows a step wrote to the item's emit region, each kind's in declaration order and sorted by
/// (a, b) with ties in the order the program wrote them; or the first kind whose count passes its
/// `max_per_step`, and the count.
fn emitted(item: &Item, memory: &[u8], planted: &Planted) -> Result<Rows, (String, u32)> {
    let mut rows = Vec::new();
    let mut at = item.emits_at as usize;
    for (j, e) in item.emits.iter().enumerate() {
        let count = u32::from_le_bytes(memory[at..at + 4].try_into().expect("4 bytes"));
        if count > e.max && !planted.occurrences_keep_cap {
            return Err((e.kind.clone(), count));
        }
        let size = e.row() as usize;
        let mut kind: Vec<Vec<u8>> = (0..count.min(e.max) as usize)
            .map(|r| memory[at + 4 + r * size..][..size].to_vec())
            .collect();
        let pair = |r: &Vec<u8>| {
            (
                u32::from_le_bytes(r[..4].try_into().expect("4 bytes")),
                u32::from_le_bytes(r[4..8].try_into().expect("4 bytes")),
            )
        };
        if planted.occurrences_sort_ties_by_payload {
            let payload = |r: &Vec<u8>| {
                e.value(r)["fields"]
                    .as_object()
                    .map(|o| o.values().filter_map(Value::as_f64).collect::<Vec<_>>())
                    .unwrap_or_default()
            };
            kind.sort_by(|x, y| {
                pair(x).cmp(&pair(y)).then(
                    payload(x)
                        .partial_cmp(&payload(y))
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
            });
        } else {
            kind.sort_by_key(pair);
        }
        rows.extend(kind.into_iter().map(|r| (j, r)));
        at += e.size() as usize;
    }
    Ok(rows)
}

/// What step k of an item left, in the record: its hash, fuel, whether it has failed, the pages it
/// marked, its arrays (a failed item's as its last good step left them) and, for an item that
/// emits, the rows a clean step emitted as `<logic ID>.occurrences` (a failed step emits none).
#[allow(clippy::too_many_arguments)]
fn report(
    rec: &mut Record,
    item: &Item,
    k: i64,
    l: &Live,
    hash: Option<u64>,
    fuel: i64,
    pages: Vec<u32>,
    rows: &Rows,
) {
    let (items, arrays) = rec.steps.entry(k).or_default();
    items.insert(item.id.clone(), json!({"hash": hash.map(|h| format!("{h:016x}")), "fuel": fuel, "failed": l.failed, "pages": pages}));
    // Each write's hash: runs compare these; the bake's values are its ranges (crate::bake).
    for w in &item.writes {
        let e = item.write(&w.name).expect("a write entry");
        let bytes = &l.arrays[e.offset as usize..(e.offset + e.size) as usize];
        arrays.insert(
            format!("{}.{}", item.id, w.name),
            json!(format!("{:016x}", h64(bytes))),
        );
    }
    if !item.emits.is_empty() && hash.is_some() {
        let list = rows.iter().map(|(j, r)| item.emits[*j].value(r)).collect();
        arrays.insert(format!("{}.occurrences", item.id), Value::Array(list));
    }
}

/// A trap's source line, through the item's sidecar: the instruction's offset in the program as
/// given. The planted mapper takes the offset of its copy in the rewritten function, from that
/// function's start, as if the fuel rewrite had moved nothing inside it.
fn source(item: &Item, planted: &Planted, function: u32, offset: u32) -> Option<String> {
    let lines = item.lines.as_ref()?;
    if !planted.mapper_ignores_shift {
        return lines.at(offset);
    }
    let copy = rewrite::offsets(&item.bytes)
        .iter()
        .find(|e| e.written == offset)?
        .copy;
    let start = |b: &[u8]| bodies(b).get(function as usize).copied();
    lines.at(start(&item.given)? + (copy - start(&item.bytes)?))
}

/// Where each function body starts in a module.
fn bodies(bytes: &[u8]) -> Vec<u32> {
    Parser::new(0)
        .parse_all(bytes)
        .filter_map(|p| match p {
            Ok(Payload::CodeSectionEntry(b)) => Some(b.range().start as u32),
            _ => None,
        })
        .collect()
}

/// What a frame draws from, per item: its last step that ran, its write region before that step
/// (empty without a linear write) and after it.
pub type Shown = (i64, Vec<u8>, Vec<u8>);

/// Each array, by `<item>.<write>`, as each item's write region lays it out.
pub fn arrays_of<'a>(
    piece: &Piece,
    regions: impl Iterator<Item = &'a [u8]>,
) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    for (item, region) in piece.items.iter().zip(regions) {
        for w in &item.writes {
            let e = item.write(&w.name).expect("a write entry");
            out.push((
                format!("{}.{}", item.id, w.name),
                region[e.offset as usize..(e.offset + e.size) as usize].to_vec(),
            ));
        }
    }
    out
}

/// Each item's arrays as a frame at `t` (flicks) draws them from what it `shown`, by
/// `<item>.<write>` (Logic: interpolated writes): a held write as its last step stored it; a
/// linear write from the value before that step toward it by α = (t − that step's time) ÷ the
/// step length, so it reads one step late. Nothing else reads this: steps, hashes and checks read
/// the stored. The planted blend draws toward the next step, as a physics output blends.
pub fn drawn<'a>(
    piece: &Piece,
    shown: impl Iterator<Item = (i64, &'a [u8], &'a [u8])>,
    t: i64,
    forward: bool,
) -> Map<String, Value> {
    let mut out = Map::new();
    for (item, (last, prev, arrays)) in piece.items.iter().zip(shown) {
        let since = if forward {
            t.rem_euclid(item.step)
        } else {
            (t - last * item.step).clamp(0, item.step)
        };
        for w in &item.writes {
            let e = item.write(&w.name).expect("a write entry");
            let size = w.ty.size() as usize;
            let at = e.offset as usize;
            let values: Vec<Value> = (0..w.count as usize)
                .map(|n| {
                    let to = &arrays[at + n * size..][..size];
                    if !w.linear || prev.is_empty() || last < 0 || since >= item.step {
                        return w.ty.value(to);
                    }
                    let from = &prev[at + n * size..][..size];
                    w.ty.blend(from, to, since as f64 / item.step as f64)
                })
                .collect();
            out.insert(format!("{}.{}", item.id, w.name), Value::Array(values));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #535: a step's 100 changed runs reach the column view as 64 ranges, the last the span of
    /// the 37 past the 63rd; 64 or fewer reach it as they are.
    #[test]
    fn a_step_hands_over_at_most_64_ranges() {
        let runs: Vec<[u64; 2]> = (0..100).map(|i| [3 * i, 3 * i + 1]).collect();
        let out = handed(&runs);
        assert_eq!(out.len(), HANDED);
        assert_eq!(out[..63], runs[..63]);
        assert_eq!(out[63], [189, 298]);
        assert_eq!(handed(&runs[..64]), runs[..64].to_vec());
    }
}
