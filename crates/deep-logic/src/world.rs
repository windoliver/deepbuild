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
use deep_sandbox_wasmtime::Val;
use deep_sandbox_wasmtime::{Call, Faults, Runner};
use serde_json::{json, Map, Value};
use wasmparser::{ExternalKind, Parser, Payload, ValType};

use crate::bake::{self, Range};
pub use crate::bake::{handed, HANDED};
use crate::budget::cpu_ns;
use crate::mirrors::{self, Pending};
use crate::piece::{h64, step_seed, Item, Piece, Read, Ty, PAGE, PER_STEP};
use crate::services;
pub use crate::track::{track_of, Entry, Given, Track};
use crate::Planted;

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
    /// #538: each item's comparison of its arrays after each step with their values before it,
    /// as `(step, bytes compared, ms)`: a proof reading of the bake's cost, never part of a run.
    pub compares: BTreeMap<String, Vec<(i64, usize, f64)>>,
    /// When asked for: each step's services region of each item that asks services, as the step
    /// read it, in hex, by step and item (`{services}`).
    pub regions: Option<BTreeMap<i64, Map<String, Value>>>,
    /// When asked for (#184's play): each step's time by item, as `(item, ns)`, so a bot's steps
    /// are timed apart from the piece's. A reading, never part of a run.
    pub ns: Option<Vec<(usize, u64)>>,
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
    /// The CPU time item `id`'s last checkpoint took.
    fn took(&mut self, id: &str, ns: u64) {
        if let Some(c) = self
            .checkpoints
            .get_mut(id)
            .and_then(Value::as_array_mut)
            .and_then(|a| a.last_mut())
        {
            c["ns"] = json!(ns);
        }
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
    pub(crate) fn checkpoint(&mut self, id: &str, step: i64, deep: u64, arrays: &[u8]) {
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
    mirrors: Vec<Pending>,
    pub(crate) memory: Memory,
    /// The CPU time taking and storing it took, in ns, as the ring reports it (#548).
    ns: u64,
}

/// One item's state as it steps.
pub(crate) struct Live {
    pub(crate) runner: Runner,
    pub(crate) names: Rc<Names>,
    pub(crate) failed: bool,
    /// The first step not yet run or passed: on a turn clock, steps nothing asked for are passed.
    pub(crate) next: i64,
    /// Steps that have run, and the last of them (−1 before step 0): checkpoints come every
    /// `checkpoint.every` steps that ran (Logic: turn clock).
    pub(crate) ran: i64,
    pub(crate) last: i64,
    pub(crate) arrays: Vec<u8>,
    /// With a linear write, the write region as it stood before the last step that ran: what a
    /// frame blends from (Logic: interpolated writes). Empty for an item that only holds.
    pub(crate) prev: Vec<u8>,
    pub(crate) cursor: BTreeMap<String, usize>,
    pub(crate) pending: BTreeMap<String, VecDeque<Entry>>,
    /// The slot its last step asked to save, and whether as ended (Logic: saves).
    pub(crate) asked: Option<(i32, bool)>,
    /// Each mirror's ranges its writer changed since this item's last step (Logic: mirror reads).
    pub(crate) mirrors: Vec<Pending>,
    /// The planted late answers: step's requests not yet answered when its checkpoint is taken.
    late: bool,
    /// The hashes of the regions the module filled before the last step: its mirrors' lists and
    /// its services' results, which logic.determinism compares.
    filled: Option<Value>,
    /// #213: the CPU time updating its mirrors before the last step took, in ns: a proof reading.
    mirror_ns: u64,
    dirty: BTreeSet<u32>,
    /// The pages written since the last keyframe stored (crate::keyframes).
    pub(crate) kdirty: BTreeSet<u32>,
    stored: Vec<Stored>,
    /// The last step a checkpoint was taken at.
    pub(crate) checked: Option<i64>,
    /// Steps between checkpoints: `checkpoint.every`, doubled each time the ring passes its budget.
    spacing: i64,
    /// Restored from a checkpoint: its steps run again steps a bake already ran.
    rerun: bool,
    /// A second instance of the program that previews run on, each on a copy of this state
    /// (Logic: preview), built at the first preview and kept across seeks.
    spare: Option<Runner>,
    /// What the last preview ran on: the step the state is at and its read region's bytes.
    previewed: Option<(i64, Vec<u8>)>,
    /// The preview's write region as the last preview left it: zero before one and after a trap.
    preview: Vec<u8>,
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
            mirrors: self.mirrors.clone(),
            memory,
            ns: 0,
        }
    }
    pub(crate) fn globals(&mut self) -> Vec<Val> {
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
    pub(crate) fn deep_hash(&mut self) -> u64 {
        use sha2::Digest as _;
        let pending: usize = self.pending.values().map(VecDeque::len).sum();
        let mut h = sha2::Sha256::new();
        h.update((self.last + 1).to_le_bytes());
        h.update((pending as u32).to_le_bytes());
        h.update(self.encoded());
        h.update(&self.arrays);
        h.update(self.memory());
        u64::from_be_bytes(h.finalize()[..8].try_into().expect("8 bytes"))
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The logic items of a piece, stepping on one input track.
pub struct World {
    pub piece: Rc<Piece>,
    pub(crate) track: Track,
    pub(crate) lives: Vec<Live>,
    /// Each item's arrays as its last step left them.
    pub(crate) published: Vec<Vec<u8>>,
    store: bool,
    pub(crate) planted: Planted,
    /// The folder the piece's saves are kept in, and what each save written leaves (Logic: saves).
    pub saves_dir: Option<std::path::PathBuf>,
    pub saved: Vec<Value>,
    /// The steps the piece's same-machine counters have seen, and the adapter this run is on.
    pub(crate) seen: u64,
    pub adapter: String,
    /// A session's keyframes every 10 s of play, spilled to the cache (crate::keyframes).
    pub cache: Option<crate::keyframes::Cache>,
}

pub type Failed = Value;

mod world_impl;

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
    let mut row = json!({"hash": hash.map(|h| format!("{h:016x}")), "fuel": fuel, "failed": l.failed, "pages": pages,
                         "mirror_ns": l.mirror_ns, "service_ns": 0});
    if let Some(f) = &l.filled {
        row["filled"] = f.clone();
    }
    items.insert(item.id.clone(), row);
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

/// An item's arrays by `<item ID>.<name>`, each value as its type reads.
pub(crate) fn arrays_json(item: &Item, bytes: &[u8]) -> Map<String, Value> {
    item.writes
        .iter()
        .map(|w| {
            let e = item.write(&w.name).expect("a write entry");
            let values: Vec<Value> = bytes[e.offset as usize..(e.offset + e.size) as usize]
                .chunks(w.ty.size() as usize)
                .map(|b| w.ty.value(b))
                .collect();
            (format!("{}.{}", item.id, w.name), Value::Array(values))
        })
        .collect()
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

/// How many elements of linear writes a frame at `t` blends from what each item `shown`: its last
/// step that ran and whether it keeps no write region from before it (#548's `blends`).
pub fn blends(piece: &Piece, shown: impl Iterator<Item = (i64, bool)>, t: i64) -> usize {
    piece
        .items
        .iter()
        .zip(shown)
        .filter(|(item, (last, no_prev))| {
            !no_prev && *last >= 0 && (t - last * item.step).clamp(0, item.step) < item.step
        })
        .map(|(item, _)| {
            item.writes
                .iter()
                .filter(|w| w.linear)
                .map(|w| w.count as usize)
                .sum::<usize>()
        })
        .sum()
}

/// An item's preview write region, zero: empty without a preview.
fn preview_region(item: &Item) -> Vec<u8> {
    let p = item.preview.as_ref();
    vec![0; p.map_or(0, |p| (p.size() - (p.writes_at - p.at)) as usize)]
}

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
