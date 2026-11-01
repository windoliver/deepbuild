//! The scheduler (issue #387; canvas primitives: Phase, Operator and read set, Array and table,
//! Dirty classes, Content key; technical design: The canvas core).
//!
//! The seal (#305) orders the operators it keeps; this module runs them. A revision compiles
//! into a plan of nodes, one per (operator, item), or one per operator that runs per document,
//! laid out phase by phase in the seal's order and, inside an operator, items by dependency
//! depth, order key and ID. Every node's inputs are bound from its operator's declared reads
//! only, and an operator gets a typed [`View`] of them and nothing else: a read it didn't
//! declare is refused (and logged, in a test build), never answered.
//!
//! **Epochs.** Each document session counts epochs in a `u32`. A change (a revision's changed
//! items, a new time, view input, look, seed or reading) stamps the epoch it happened at, each
//! node keeps the epoch it last ran at and each array the epoch it last changed at, so a frame
//! visits only operators whose read set changed since they ran and, in them, only the nodes
//! whose inputs did. A frame with nothing changed runs no operator and touches no node. Before
//! the counter wraps, the session rebases its epochs by rank, keeping their order, so nothing
//! is missed across a long run.
//!
//! **Content keys.** A node's key is `hash@1` of its operator and its canvas module's version,
//! then each declared read in order: the item's canonical bytes for `self`, the key of the node
//! that wrote an array (and of each contribution folded into it), never a pass over the array's
//! values; the view inputs, look tokens, seed, time and outside data it declares. An epoch
//! never enters a key, so one document reached by two histories has one set of keys, and equal
//! keys share one immutable result through the cache, which holds a result while a session's
//! current revision reads it.

mod bytes;
pub mod core_ops;
mod steps;
mod view;

use std::any::Any;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::canon::{self, NoShape};
use crate::registry::{Per, Sealed, TableValue};

pub use bytes::Canonical;
pub use view::View;

/// What a node's operator call left: its writes, its error, what a step noted and the tails it
/// wrote.
type Called = (
    Vec<Val>,
    Option<OpError>,
    Option<(i64, i64)>,
    Vec<(String, Val)>,
);

/// The six view inputs an operator may read (Operator and read set: `view(…)`), in the order a
/// session holds them.
pub const VIEW_INPUTS: [&str; 6] = [
    "camera",
    "viewport",
    "pixel_scale",
    "match.me",
    "locale",
    "reduced_motion",
];
/// `view(locale)`'s place among [`VIEW_INPUTS`].
pub const LOCALE: usize = 4;
/// `view(reduced_motion)`'s place among [`VIEW_INPUTS`].
pub const REDUCED_MOTION: usize = 5;

const CHECK_PHASES: [&str; 8] = [
    "load", "expand", "resolve", "validate", "plan", "build", "estimate", "check",
];

/// True for a check phase: its nodes run when a revision is checked, never per frame.
pub fn is_check_phase(phase: &str) -> bool {
    CHECK_PHASES.contains(&phase)
}

/// A 128-bit content key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key(pub [u8; 16]);

impl Key {
    /// Lower-case hex, 32 digits.
    pub fn hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// A key's hash version: `hash@1` is SHA-256, `hash@2` BLAKE3, each over length-prefixed fields
/// and cut to 128 bits. Content keys and result digests are `hash@2`; seeds stay on `hash@1`, so
/// no draw changes, and a `hash@1` key still reads through [`Scheduler::migrate`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum HashVersion {
    V1,
    #[default]
    V2,
}

impl HashVersion {
    pub fn name(self) -> &'static str {
        match self {
            HashVersion::V1 => "hash@1",
            HashVersion::V2 => "hash@2",
        }
    }
}

/// The bytes `hash@2` gathers before hashing them at once: a key's fields are short, and one
/// call over them costs less than a streaming hasher's state per key.
const GATHER: usize = 512;

// The gathered bytes stay inline: boxing them would allocate once per key.
#[allow(clippy::large_enum_variant)]
#[derive(Clone)]
enum State {
    V1(Sha256),
    V2 {
        gathered: [u8; GATHER],
        len: usize,
        /// Past [`GATHER`] bytes, the streaming hasher takes them all.
        stream: Option<Box<blake3::Hasher>>,
    },
}

/// A content-key hasher over length-prefixed fields, cut to 128 bits.
#[derive(Clone)]
pub struct Hasher(State);

impl Hasher {
    /// `hash@2`, what content keys and result digests are.
    pub fn new(tag: &str) -> Hasher {
        Hasher::of(HashVersion::V2, tag)
    }

    /// `hash@1`, what seeds stay on.
    pub fn v1(tag: &str) -> Hasher {
        Hasher::of(HashVersion::V1, tag)
    }

    pub fn of(version: HashVersion, tag: &str) -> Hasher {
        let mut h = Hasher(match version {
            HashVersion::V1 => State::V1(Sha256::new()),
            HashVersion::V2 => State::V2 {
                gathered: [0; GATHER],
                len: 0,
                stream: None,
            },
        });
        h.text(version.name()).text(tag);
        h
    }

    fn update(&mut self, bytes: &[u8]) {
        match &mut self.0 {
            State::V1(h) => h.update(bytes),
            State::V2 {
                stream: Some(h), ..
            } => {
                h.update(bytes);
            }
            State::V2 {
                gathered,
                len,
                stream,
            } => {
                if *len + bytes.len() <= GATHER {
                    gathered[*len..*len + bytes.len()].copy_from_slice(bytes);
                    *len += bytes.len();
                } else {
                    let mut h = blake3::Hasher::new();
                    h.update(&gathered[..*len]);
                    h.update(bytes);
                    *stream = Some(Box::new(h));
                }
            }
        }
    }

    pub fn bytes(&mut self, bytes: &[u8]) -> &mut Self {
        self.update(&(bytes.len() as u64).to_le_bytes());
        self.update(bytes);
        self
    }

    pub fn text(&mut self, text: &str) -> &mut Self {
        self.bytes(text.as_bytes())
    }

    pub fn int(&mut self, n: i64) -> &mut Self {
        self.bytes(&n.to_le_bytes())
    }

    pub fn key(&mut self, key: &Key) -> &mut Self {
        self.bytes(&key.0)
    }

    pub fn finish(&self) -> Key {
        let mut out = [0u8; 16];
        match &self.0 {
            State::V1(h) => out.copy_from_slice(&h.clone().finalize()[..16]),
            State::V2 {
                stream: Some(h), ..
            } => out.copy_from_slice(&h.finalize().as_bytes()[..16]),
            State::V2 { gathered, len, .. } => {
                out.copy_from_slice(&blake3::hash(&gathered[..*len]).as_bytes()[..16])
            }
        }
        Key(out)
    }
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The canonical bytes of a value as a key reads it: keys sorted, numbers normalized (−0 as +0,
/// whole numbers as integers), strings NFC. A value with no canonical form (a check refuses it
/// first) keys by its JSON text.
pub fn canonical(value: &Value) -> Vec<u8> {
    canon::canonical_bytes(value, &NoShape)
        .unwrap_or_else(|_| serde_json::to_vec(value).unwrap_or_default())
}

/// Stores −0 as +0 everywhere in `value`, as a revision is checked (Content key: canonical
/// params). Every other number is kept as written.
fn without_negative_zero(value: &mut Value) {
    match value {
        Value::Number(n) if n.as_f64() == Some(0.0) && n.is_f64() => *value = json!(0),
        Value::Array(list) => list.iter_mut().for_each(without_negative_zero),
        Value::Object(map) => map.values_mut().for_each(without_negative_zero),
        _ => {}
    }
}

/// A value a frame phase passes: its canonical bytes, its Debug text for diagnostics only, and
/// the value itself to downcast.
pub trait Typed: Canonical + std::fmt::Debug + Any + Send + Sync {
    fn into_any(self: Arc<Self>) -> Arc<dyn Any + Send + Sync>;
}

impl<T: Canonical + std::fmt::Debug + Any + Send + Sync> Typed for T {
    fn into_any(self: Arc<Self>) -> Arc<dyn Any + Send + Sync> {
        self
    }
}

/// One value an operator wrote: JSON, which only a check phase writes, or a typed value.
#[derive(Clone)]
pub enum Val {
    None,
    Json(Arc<Value>),
    Typed(Arc<dyn Typed>),
}

impl std::fmt::Debug for Val {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Val::None => write!(f, "None"),
            Val::Json(v) => write!(f, "Json({v})"),
            Val::Typed(v) => write!(f, "Typed({v:?})"),
        }
    }
}

impl Val {
    pub fn json(value: Value) -> Val {
        Val::Json(Arc::new(value))
    }

    /// A typed value; its canonical bytes are encoded only when a digest reads them.
    pub fn typed<T: Typed>(value: T) -> Val {
        Val::Typed(Arc::new(value))
    }

    /// The typed value as a `T`, if it is one.
    pub fn as_typed<T: Any + Send + Sync>(&self) -> Option<Arc<T>> {
        match self {
            Val::Typed(v) => Arc::clone(v).into_any().downcast::<T>().ok(),
            _ => None,
        }
    }

    /// The bytes a result digest reads: a typed value's canonical bytes, never its Debug text.
    pub fn bytes(&self) -> Vec<u8> {
        match self {
            Val::None => Vec::new(),
            Val::Json(v) => serde_json::to_vec(v.as_ref()).unwrap_or_default(),
            Val::Typed(v) => v.canonical_bytes(),
        }
    }

    /// A typed value as Debug sees it, for a diagnostic of its text; `None` for any other.
    pub fn debug(&self) -> Option<&dyn std::fmt::Debug> {
        match self {
            Val::Typed(v) => Some(v.as_ref() as &dyn std::fmt::Debug),
            _ => None,
        }
    }

    /// Another value of its type, for read-set perturbation: a JSON value's first number moves
    /// by one (else its first string gains a mark, else it is wrapped); a typed value keeps its
    /// value and only its key moves, since nothing typed can be rewritten from outside it.
    fn perturbed(&self) -> Val {
        match self {
            Val::Json(v) => {
                let mut out = (**v).clone();
                if !perturb_number(&mut out) && !perturb_string(&mut out) {
                    out = json!({"perturbed": out});
                }
                Val::json(out)
            }
            other => other.clone(),
        }
    }
}

fn perturb_number(v: &mut Value) -> bool {
    match v {
        Value::Number(n) => {
            *v = json!(n.as_f64().unwrap_or(0.0) + 1.0);
            true
        }
        Value::Array(list) => list.iter_mut().any(perturb_number),
        Value::Object(map) => map.values_mut().any(perturb_number),
        _ => false,
    }
}

fn perturb_string(v: &mut Value) -> bool {
    match v {
        Value::String(s) => {
            s.push('~');
            true
        }
        Value::Array(list) => list.iter_mut().any(perturb_string),
        Value::Object(map) => map.values_mut().any(perturb_string),
        _ => false,
    }
}

/// An operator's error: it becomes an issue naming its canvas module and operator.
#[derive(Clone, Debug, PartialEq)]
pub struct OpError {
    pub code: &'static str,
    pub path: String,
    /// The read term, for `undeclared_read`.
    pub read: Option<String>,
}

impl OpError {
    pub fn new(code: &'static str, path: impl Into<String>) -> OpError {
        OpError {
            code,
            path: path.into(),
            read: None,
        }
    }
}

/// How a node's result was had (`eval`: `run`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Run {
    /// Its operator ran.
    Ran,
    /// An equal key's result was in the content-key cache.
    Hit,
    /// Nothing in its read set changed since its last run.
    Kept,
}

impl Run {
    pub fn name(self) -> &'static str {
        match self {
            Run::Ran => "ran",
            Run::Hit => "hit",
            Run::Kept => "kept",
        }
    }
}

/// The wrong programs the criteria plant, reachable only through a proof surface.
#[derive(Clone, Debug, Default)]
pub struct Planted {
    /// Content keys leave out the view's locale.
    pub key_without_locale: bool,
    /// Content keys leave out the view's reduced motion.
    pub key_without_reduced_motion: bool,
    /// A read of this array enters keys by a pass over its values, not by its writer's key.
    pub key_hashes: Option<String>,
    /// Steps at one time run in canvas-module name order, not the order the seal derived.
    pub steps_by_name: bool,
    /// A node's key holds its item without the item's params (#138's planted stale cache).
    pub key_without_params: bool,
    /// A seek restores the checkpoint nearest to t by distance, the earlier of two equally
    /// near, instead of the last one at or before t (#488's planted seek).
    pub checkpoint_nearest: bool,
    /// A session's own frame merges the results of nodes run on several threads in the order
    /// they finished, not the plan's node order (#857's planted merge); a revision's check and
    /// its probe frame still merge in order, so the revision is accepted.
    pub merge_by_finish: bool,
    /// A frame-phase operator may write JSON, which is counted (#855's planted seal).
    pub admits_frame_json: bool,
    /// A session's own frame runs every node of its frame phases, changed or not (#854's planted
    /// scheduler).
    pub runs_every_node: bool,
}

/// Called as an operator's node starts (`done` false) and ends: its index in the sealed set's
/// operators and its item. The canvas core reads no clock; the cost model's micro-benchmark
/// (issue #379) times operators through it.
pub type Timing = fn(op: usize, item: Option<&str>, done: bool);

/// The worker threads a host lends the scheduler (#857): the canvas core starts no thread and
/// reads no machine, so the pool and the machine's core count are the host's.
pub trait Pool: Send + Sync + std::fmt::Debug {
    /// The machine's performance cores: the export class's thread count.
    fn performance_cores(&self) -> usize;
    /// Calls `job(k, thread)` once for every `k` in `0..count` on at most `threads` threads, the
    /// caller's own among them as thread 0, and returns once every call has returned.
    fn run(&self, threads: usize, count: usize, job: &(dyn Fn(usize, usize) + Sync));
}

/// A process's scheduling options.
#[derive(Clone, Debug, Default)]
pub struct Options {
    /// A test build logs every read every operator makes.
    pub access_log: bool,
    /// Ties (between operators, between items of one operator, between steps at one time that
    /// read nothing of each other's) break by a shuffle from this seed, not by name and order.
    pub shuffle: Option<u32>,
    pub planted: Planted,
    pub timing: Option<Timing>,
    /// The threads independent nodes of one operator run on; without a pool, every node runs on
    /// the scheduler's own thread.
    pub pool: Option<Arc<dyn Pool>>,
    /// Every session's thread count in place of its budget class's (a proof surface).
    pub threads: Option<usize>,
    /// The hash content keys and result digests are computed with (#855): `hash@2`, unless a
    /// process keys as before its migration.
    pub hash: HashVersion,
}

/// A pass over values made to compute a key (the counting hash).
#[derive(Clone, Debug, PartialEq)]
pub struct Hashed {
    pub of: String,
    pub bytes: usize,
}

/// Look tokens: each role's value.
pub type Tokens = BTreeMap<String, Value>;

/// A source column from outside the document, hashed once when it arrived.
#[derive(Clone, Debug)]
pub struct Column {
    pub bytes: Arc<[u8]>,
    pub sha256: [u8; 32],
}

/// The data from outside the document a session holds: the record's readings and the sources'
/// columns.
#[derive(Clone, Debug, Default)]
pub struct Outside {
    pub readings: BTreeMap<String, Value>,
    /// `<source>.<column>` → its column.
    pub columns: BTreeMap<String, Column>,
}

impl Outside {
    /// The key of everything outside the document: readings by their canonical bytes, columns by
    /// the hash taken when each arrived.
    fn key(&self, v: HashVersion) -> Key {
        let mut h = Hasher::of(v, "outside");
        for (handle, v) in &self.readings {
            h.text(handle).bytes(&canonical(v));
        }
        for (name, c) in &self.columns {
            h.text(name).bytes(&c.sha256);
        }
        h.finish()
    }
}

/// The process's scheduler: the sealed set, the content-key cache every session shares, the
/// tables built so far and the options.
pub struct Scheduler<'s> {
    pub sealed: &'s Sealed,
    pub options: Options,
    /// key → (the node's outputs, its error, how many current nodes hold it).
    cache: Cache,
    tables: BTreeMap<String, (TableValue, Key)>,
    /// Passes over values made to compute keys, since the last [`Scheduler::take_hashes`].
    hashes: Vec<Hashed>,
    /// The JSON values frame-phase operators wrote since the last [`Scheduler::take_json`]:
    /// only where the planted seal admits them.
    json_written: Vec<Arc<Value>>,
    /// Called with the look tokens an evaluation uses, before its operators run: the planted
    /// static accent reader's way in.
    pub look_hook: Option<fn(&Tokens)>,
    /// Each array's writer, by index into the sealed set's operators.
    writer: BTreeMap<String, usize>,
    /// The cache changes a wave's merge makes, in node order, while it settles: applied after
    /// it, each shard's on the pool (#857).
    deferred: Option<Vec<CacheOp>>,
}

impl<'s> Scheduler<'s> {
    pub fn new(sealed: &'s Sealed, options: Options) -> Scheduler<'s> {
        let mut writer = BTreeMap::new();
        for (i, o) in sealed.ops.iter().enumerate() {
            for w in &o.op.writes {
                writer.insert(w.clone(), i);
            }
        }
        Scheduler {
            sealed,
            options,
            cache: Cache::default(),
            tables: BTreeMap::new(),
            hashes: Vec::new(),
            json_written: Vec::new(),
            look_hook: None,
            writer,
            deferred: None,
        }
    }

    /// The passes over values made to compute keys since the last call.
    pub fn take_hashes(&mut self) -> Vec<Hashed> {
        std::mem::take(&mut self.hashes)
    }

    /// The JSON values frame-phase operators wrote since the last call.
    pub fn take_json(&mut self) -> Vec<Arc<Value>> {
        std::mem::take(&mut self.json_written)
    }

    /// How many results the cache holds.
    pub fn cached(&self) -> usize {
        self.cache.len()
    }

    /// Every result the cache holds, by key, as `nodes` digests a node's result: for comparing
    /// the cache with a clean rebuild (the conformance kit).
    pub fn cache_results(&self) -> BTreeMap<String, String> {
        self.cache
            .0
            .iter()
            .flatten()
            .map(|(k, (out, err, _))| {
                (k.hex(), result_digest(self.options.hash, out, err.as_ref()))
            })
            .collect()
    }

    /// A table's value and key, built the first time it is read.
    fn table(&mut self, name: &str) -> Option<(TableValue, Key)> {
        if let Some((v, k)) = self.tables.get(name) {
            return Some((v.clone(), *k));
        }
        let t = self.sealed.tables.get(name)?;
        let make = t.make?;
        let value = make();
        let key = table_key(self.options.hash, name, &t.owner);
        self.tables.insert(name.into(), (value.clone(), key));
        Some((value, key))
    }

    /// The hash content keys and result digests are computed with.
    pub fn hash(&self) -> HashVersion {
        self.options.hash
    }

    /// Rekeys the process's content keys under `to`, once (#855): every session's keys are
    /// computed afresh under it and each result the cache holds moves to its node's new key, so
    /// a result written under `hash@1` is found again under `hash@2`. Returns how many entries
    /// moved; none when the process already keys with `to`.
    pub fn migrate(&mut self, to: HashVersion, sessions: &mut [&mut Session]) -> usize {
        if self.options.hash == to {
            return 0;
        }
        self.options.hash = to;
        let sealed = self.sealed;
        for (name, (_, key)) in self.tables.iter_mut() {
            if let Some(t) = sealed.tables.get(name) {
                *key = table_key(to, name, &t.owner);
            }
        }
        let mut moves = BTreeMap::new();
        for session in sessions.iter_mut() {
            moves.extend(session.rekey(self));
        }
        let old = std::mem::take(&mut self.cache);
        let mut rekeyed = 0;
        for (key, entry) in old.0.into_iter().flatten() {
            match moves.get(&key) {
                Some(new) => {
                    rekeyed += 1;
                    self.cache.insert(*new, entry);
                }
                None => {
                    self.cache.insert(key, entry);
                }
            }
        }
        rekeyed
    }

    /// Holds `key`'s result for node `n`: whether the cache has it, or `None` while a wave's
    /// changes are deferred, when applying them answers.
    fn hold(&mut self, n: usize, key: Key) -> Option<bool> {
        match &mut self.deferred {
            Some(ops) => {
                ops.push(CacheOp::Hold(n, key));
                None
            }
            None => Some(self.cache.hold(key)),
        }
    }

    fn release(&mut self, key: Key) {
        match &mut self.deferred {
            Some(ops) => ops.push(CacheOp::Release(key)),
            None => self.cache.release(key),
        }
    }

    /// Caches a result a node just made, unheld.
    fn insert(&mut self, key: Key, out: Vec<Val>, err: Option<OpError>) {
        match &mut self.deferred {
            Some(ops) => ops.push(CacheOp::Insert(key, out, err)),
            None => self.cache.insert(key, (out, err, 0)),
        }
    }

    /// Applies a wave's deferred cache changes, each shard's in node order on the pool (changes
    /// to different keys commute); returns each hold's node and the key it now holds.
    fn apply_deferred(&mut self, threads: usize) -> Vec<(usize, Option<Key>)> {
        let ops = self.deferred.take().unwrap_or_default();
        let mut by_shard: Vec<Vec<CacheOp>> = (0..SHARDS).map(|_| Vec::new()).collect();
        for op in ops {
            by_shard[Cache::shard(op.key())].push(op);
        }
        let jobs: Vec<std::sync::Mutex<_>> = self
            .cache
            .0
            .iter_mut()
            .zip(by_shard)
            .map(|(map, ops)| std::sync::Mutex::new((map, ops, Vec::new())))
            .collect();
        let apply = |k: usize, _| {
            let mut job = jobs[k].lock().expect("unpoisoned");
            let (map, ops, held) = &mut *job;
            let mut ops = std::mem::take(ops).into_iter().peekable();
            while let Some(op) = ops.next() {
                match op {
                    // A node that ran holds its result at once: one lookup, not two.
                    CacheOp::Insert(key, out, err) => {
                        let holder = match ops.peek() {
                            Some(CacheOp::Hold(n, k)) if *k == key => Some(*n),
                            _ => None,
                        };
                        if holder.is_some() {
                            ops.next();
                        }
                        map.insert(key, (out, err, u32::from(holder.is_some())));
                        held.extend(holder.map(|n| (n, Some(key))));
                    }
                    CacheOp::Hold(n, key) => {
                        held.push((n, Cache::hold_in(map, key).then_some(key)))
                    }
                    CacheOp::Release(key) => Cache::release_in(map, key),
                }
            }
        };
        match self.options.pool.as_deref() {
            Some(pool) => pool.run(threads, SHARDS, &apply),
            None => (0..SHARDS).for_each(|k| apply(k, 0)),
        }
        jobs.into_iter()
            .flat_map(|j| j.into_inner().expect("unpoisoned").2)
            .collect()
    }
}

/// How many maps the cache splits into by key, so a wave's changes apply on the pool.
const SHARDS: usize = 16;

/// A cached result: the node's outputs, its error, how many current nodes hold it.
type Entry = (Vec<Val>, Option<OpError>, u32);

/// The content-key cache, split by each key's first byte.
#[derive(Default)]
struct Cache([BTreeMap<Key, Entry>; SHARDS]);

impl Cache {
    fn shard(key: Key) -> usize {
        usize::from(key.0[0]) % SHARDS
    }

    fn len(&self) -> usize {
        self.0.iter().map(BTreeMap::len).sum()
    }

    fn get(&self, key: &Key) -> Option<&Entry> {
        self.0[Cache::shard(*key)].get(key)
    }

    fn insert(&mut self, key: Key, entry: Entry) {
        self.0[Cache::shard(key)].insert(key, entry);
    }

    fn hold(&mut self, key: Key) -> bool {
        Cache::hold_in(&mut self.0[Cache::shard(key)], key)
    }

    fn release(&mut self, key: Key) {
        Cache::release_in(&mut self.0[Cache::shard(key)], key);
    }

    fn hold_in(map: &mut BTreeMap<Key, Entry>, key: Key) -> bool {
        match map.get_mut(&key) {
            Some(e) => {
                e.2 += 1;
                true
            }
            None => false,
        }
    }

    fn release_in(map: &mut BTreeMap<Key, Entry>, key: Key) {
        if let std::collections::btree_map::Entry::Occupied(mut e) = map.entry(key) {
            e.get_mut().2 = e.get().2.saturating_sub(1);
            if e.get().2 == 0 {
                e.remove();
            }
        }
    }
}

/// A change a wave's merge makes to the cache.
enum CacheOp {
    Insert(Key, Vec<Val>, Option<OpError>),
    /// Node `n` holds the key.
    Hold(usize, Key),
    Release(Key),
}

impl CacheOp {
    fn key(&self) -> Key {
        match self {
            CacheOp::Insert(k, ..) | CacheOp::Hold(_, k) | CacheOp::Release(k) => *k,
        }
    }
}

/// How a read term binds for one node.
#[derive(Clone, Debug)]
enum Bound {
    SelfItem(usize),
    SelfDoc,
    Refs,
    /// The parent item's node of the same operator.
    Parent(Option<usize>),
    /// The nodes that wrote the array for this node (one, per item; every item's, per
    /// document), and the nodes whose contributions fold into it, with their arrays' names.
    Array {
        name: String,
        writers: Vec<usize>,
        contributions: Vec<(String, usize)>,
    },
    /// What earlier steps left of an array a stepping operator wrote.
    Earlier(String),
    Table(String),
    View(usize),
    T,
    Look,
    Seed,
    Reading,
    Input,
    Asset,
}

/// The dirty classes a change stamps (Dirty classes), in the order an item keeps their epochs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Class {
    Transform,
    Geometry,
    Shading,
    Presence,
    Text,
    Reading,
    Time,
}

/// Every dirty class, in order.
pub const CLASSES: [Class; 7] = [
    Class::Transform,
    Class::Geometry,
    Class::Shading,
    Class::Presence,
    Class::Text,
    Class::Reading,
    Class::Time,
];

/// The text kind's params the shaper reads: a change to one is a change of text.
const TEXT_PARAMS: [&str; 8] = [
    "text",
    "font",
    "size",
    "weight",
    "box",
    "numerals",
    "align",
    "animators",
];

/// The classes a revision's change to one item falls in, by the paths that differ: `at` is
/// transform, `visible` presence, `adjust` and a paint shading, a text's shaped params text,
/// any other field geometry.
pub fn classes_changed(old: &Value, new: &Value) -> Vec<Class> {
    let kind = new.get("kind").and_then(Value::as_str).unwrap_or("");
    let mut out = Vec::new();
    let mut keys: Vec<&String> = old
        .as_object()
        .into_iter()
        .chain(new.as_object())
        .flat_map(|m| m.keys())
        .collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        let (a, b) = (old.get(k), new.get(k));
        if a == b {
            continue;
        }
        let class = match k.as_str() {
            "at" => Class::Transform,
            "visible" => Class::Presence,
            "adjust" => Class::Shading,
            "params" => {
                let mut names: Vec<&String> = a
                    .and_then(Value::as_object)
                    .into_iter()
                    .chain(b.and_then(Value::as_object))
                    .flat_map(|m| m.keys())
                    .collect();
                names.sort();
                names.dedup();
                for name in names {
                    if a.and_then(|p| p.get(name)) == b.and_then(|p| p.get(name)) {
                        continue;
                    }
                    out.push(match name.as_str() {
                        "paint" => Class::Shading,
                        n if kind == "text@1" && TEXT_PARAMS.contains(&n) => Class::Text,
                        _ => Class::Geometry,
                    });
                }
                continue;
            }
            _ => Class::Geometry,
        };
        out.push(class);
    }
    out.sort();
    out.dedup();
    out
}

#[derive(Clone, Debug)]
struct Item {
    id: String,
    value: Arc<Value>,
    key: Key,
    /// The epoch each dirty class last changed at.
    changed_at: [u32; CLASSES.len()],
    parent: Option<usize>,
    depth: u32,
    order: String,
}

#[derive(Clone, Debug)]
struct Node {
    op: usize,
    item: Option<usize>,
    reads: Vec<Bound>,
    key: Key,
    /// The one array a perturbed clean evaluation changed on this node: its readers take another
    /// key for that array alone.
    perturbed: Option<String>,
    out: Vec<Val>,
    err: Option<OpError>,
    changed_at: u32,
    last_run: u32,
    has_run: bool,
    run: Run,
    /// The frame it was last visited in.
    visited: u64,
    /// The key the cache holds for it.
    held: Option<Key>,
    /// The thread its operator last ran on: 0 the scheduler's own, else one of the pool's.
    thread: usize,
}

impl Node {
    /// The key a reader of `array` takes from this node: its key, or another one for the array
    /// a perturbed clean evaluation changed.
    fn key_for(&self, array: &str, v: HashVersion) -> Key {
        match &self.perturbed {
            Some(p) if p == array => Hasher::of(v, "perturbed").key(&self.key).text(p).finish(),
            _ => self.key,
        }
    }
}

/// One operator's nodes, in visiting order, with what its change test reads.
#[derive(Clone, Debug)]
struct Group {
    op: usize,
    nodes: Vec<usize>,
    /// Where each run of nodes with no edge between them starts in `nodes`: a node that reads
    /// its parent's node starts a new one when that parent is in the current one.
    waves: Vec<usize>,
    /// The arrays it reads and their contributions, by index into the plan's array epochs.
    arrays: Vec<usize>,
    terms: Terms,
}

/// The terms an operator's change test reads beside arrays.
#[derive(Clone, Copy, Debug, Default)]
struct Terms {
    items: bool,
    refs: bool,
    t: bool,
    view: [bool; 6],
    look: bool,
    seed: bool,
    reading: bool,
}

/// A revision compiled into its plan.
#[derive(Clone, Debug)]
struct Loaded {
    doc: Arc<Value>,
    doc_key: Key,
    seed: Value,
    assets: BTreeSet<String>,
    items: Vec<Item>,
    index: BTreeMap<String, usize>,
    nodes: Vec<Node>,
    groups: Vec<Group>,
    /// Each array's epoch of its last change, by the plan's index.
    array_at: Vec<u32>,
    array_names: Vec<String>,
    /// Each operator's writes, by the plan's array index.
    writes_at: Vec<Vec<usize>>,
}

/// One step as the log shows it.
#[derive(Clone, Debug, PartialEq)]
pub struct StepLog {
    pub module: String,
    pub t: i64,
    pub count: i64,
    pub read: i64,
}

/// An operator's error or refused read, as an issue.
#[derive(Clone, Debug, PartialEq)]
pub struct OpIssue {
    pub code: &'static str,
    pub module: String,
    pub operator: String,
    pub item: Option<String>,
    pub path: String,
    pub read: Option<String>,
}

/// A read an operator made through the core (test builds).
#[derive(Clone, Debug, PartialEq)]
pub struct Access {
    pub operator: String,
    pub item: Option<String>,
    pub read: String,
}

/// One node as an `eval` reply lists it.
#[derive(Clone, Debug)]
pub struct NodeReport {
    pub operator: String,
    pub module: String,
    pub phase: String,
    pub item: Option<String>,
    pub key: String,
    pub result: String,
    pub run: Run,
    /// The thread it ran on, when it ran.
    pub thread: Option<usize>,
    /// What it wrote, for a diagnostic of its values; never what `result` reads beyond its
    /// canonical bytes.
    pub values: Vec<Val>,
}

/// An input a perturbed clean evaluation changes (`eval`: `perturb`).
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Array(String),
    Table(String),
    View(usize),
    Look(String),
    Seed,
    Asset(String),
    /// The array's writer reads its item (or document) with a param moved, so the array moves at
    /// its source, through the writer's own body, and so would anything the writer leaked
    /// outside its writes (the conformance kit's read-set part).
    Source(String),
}

impl Target {
    pub fn parse(text: &str) -> Option<Target> {
        if text == "seed" {
            return Some(Target::Seed);
        }
        let (kind, name) = text.split_once(':')?;
        Some(match kind {
            "array" => Target::Array(name.into()),
            "table" => Target::Table(name.into()),
            "view" => Target::View(VIEW_INPUTS.iter().position(|v| *v == name)?),
            "look" => Target::Look(name.into()),
            "asset" => Target::Asset(name.into()),
            "source" => Target::Source(name.into()),
            _ => return None,
        })
    }

    pub fn name(&self) -> String {
        match self {
            Target::Array(a) => format!("array:{a}"),
            Target::Table(t) => format!("table:{t}"),
            Target::View(k) => format!("view:{}", VIEW_INPUTS[*k]),
            Target::Look(r) => format!("look:{r}"),
            Target::Seed => "seed".into(),
            Target::Asset(a) => format!("asset:{a}"),
            Target::Source(a) => format!("source:{a}"),
        }
    }

    /// The read term that declares this input in an operator's reads.
    pub fn term(&self) -> String {
        match self {
            Target::Array(a) => a.clone(),
            Target::Table(t) => format!("table:{t}"),
            Target::View(k) => format!("view({})", VIEW_INPUTS[*k]),
            Target::Look(_) => "look".into(),
            Target::Seed => "seed".into(),
            Target::Asset(_) => "asset".into(),
            Target::Source(a) => a.clone(),
        }
    }
}

/// What a changed node comes to: it keeps its result (its key is the same), takes a cached one, or
/// ran on a thread.
enum Fate {
    Kept,
    Hit(Key, Vec<Val>, Option<OpError>),
    Ran(Key, Called, Vec<Access>, Vec<Arc<Value>>, usize),
}

/// What one evaluation reports beside its nodes.
#[derive(Clone, Debug, Default)]
pub struct Report {
    pub ran: usize,
    pub issues: Vec<OpIssue>,
    pub access: Vec<Access>,
    pub steps: Vec<StepLog>,
}

/// How a visit treats the cache and epochs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// The session's own frame: epochs, the change test and the cache.
    Live,
    /// A clean evaluation: every node runs, and nothing is read from or written to the cache
    /// or the session's epochs.
    Clean,
}

/// A document session: the current revision's plan and node states, its epochs, the view, the
/// look, the data from outside and the steps' carried state.
#[derive(Clone)]
pub struct Session {
    /// The hash its keys were computed with: the scheduler's, once it loads or frames.
    hash: HashVersion,
    epoch: u32,
    loaded: Option<Loaded>,
    generation: u32,
    t: i64,
    t_at: u32,
    view: [Value; 6],
    view_at: [u32; 6],
    look: Tokens,
    look_key: Key,
    look_at: u32,
    seed_at: u32,
    refs_at: u32,
    items_at: u32,
    outside: Outside,
    outside_key: Key,
    reading_at: u32,
    steps: steps::Steps,
    /// Carried state of kind `tail` a canvas module keeps between a session's frames, by its
    /// declared key (Carried state); never read by another module, and never a session's
    /// history.
    tails: BTreeMap<String, Val>,
    /// The frame counter, for which nodes a frame visited.
    frames: u64,
    /// Each operator's epoch of its last run, by the sealed set's index.
    group_run: Vec<u32>,
    /// What a perturbed clean evaluation changes (a scratch session's only).
    perturb: Option<Target>,
    /// Under a source perturbation: the writer's operator, and what it reads as each item and
    /// as the document.
    source: Option<Source>,
    mode: Mode,
    /// The last evaluation's report.
    pub report: Report,
    /// The operator's panic that froze this session, until a new revision loads.
    frozen: Option<OpIssue>,
    /// The threads its independent nodes run on: its budget class's count.
    threads: usize,
}

/// What a source perturbation's writer reads instead of its item or document.
#[derive(Clone)]
pub(super) struct Source {
    pub op: usize,
    pub items: Vec<Arc<Value>>,
    pub doc: Arc<Value>,
}

/// An item with its first param number (else string) moved.
fn perturb_params(item: &Value) -> Value {
    let mut out = item.clone();
    if let Some(p) = out.get_mut("params") {
        if !perturb_number(p) {
            perturb_string(p);
        }
    }
    out
}

fn table_key(v: HashVersion, name: &str, owner: &str) -> Key {
    Hasher::of(v, "table").text(name).text(owner).finish()
}

fn look_key(v: HashVersion, look: &Tokens) -> Key {
    let mut h = Hasher::of(v, "look");
    for (role, v) in look {
        h.text(role).bytes(&canonical(v));
    }
    h.finish()
}

/// The default view: the document's locale, full motion, the document's camera, its size as the
/// viewport, at pixel scale 1, matching no one.
pub fn default_view(doc: &Value) -> [Value; 6] {
    [
        doc.get("camera").cloned().unwrap_or(Value::Null),
        doc.get("size").cloned().unwrap_or(Value::Null),
        json!(1),
        Value::Null,
        doc.get("locale").cloned().unwrap_or(json!("en")),
        json!(false),
    ]
}

impl Session {
    /// A session whose epoch counter starts at `epoch_start`, with the look's tokens.
    pub fn new(epoch_start: u32, look: Tokens) -> Session {
        let hash = HashVersion::default();
        let look_key = look_key(hash, &look);
        let outside_key = Outside::default().key(hash);
        Session {
            hash,
            epoch: epoch_start,
            loaded: None,
            generation: 0,
            t: 0,
            t_at: epoch_start,
            view: [
                Value::Null,
                Value::Null,
                Value::Null,
                Value::Null,
                Value::Null,
                Value::Null,
            ],
            view_at: [epoch_start; 6],
            look,
            look_key,
            look_at: epoch_start,
            seed_at: epoch_start,
            refs_at: epoch_start,
            items_at: epoch_start,
            outside: Outside::default(),
            outside_key,
            reading_at: epoch_start,
            steps: steps::Steps::default(),
            tails: BTreeMap::new(),
            frames: 0,
            group_run: Vec::new(),
            perturb: None,
            source: None,
            mode: Mode::Live,
            report: Report::default(),
            frozen: None,
            threads: 1,
        }
    }

    /// The threads its independent nodes run on.
    pub fn threads(&self) -> usize {
        self.threads
    }

    /// Computes every key of the session afresh under the scheduler's hash: the look's and the
    /// outside data's, then each item's from its canonical bytes, the document's, and every
    /// node's in plan order, so each reads keys computed in this pass; no operator runs and
    /// nothing is read from the cache. Returns each held result's old and new key.
    pub fn rekey(&mut self, s: &mut Scheduler<'_>) -> Vec<(Key, Key)> {
        let v = s.options.hash;
        self.hash = v;
        self.look_key = look_key(v, &self.look);
        self.outside_key = self.outside.key(v);
        let mut moves = Vec::new();
        let Some(l) = &mut self.loaded else {
            return moves;
        };
        for item in &mut l.items {
            item.key = item_key(v, &item.value);
        }
        l.doc_key = match v {
            // As a load keys it: a copy of the document, its ID taken out.
            HashVersion::V1 => doc_key(v, &mut (*l.doc).clone(), &l.items),
            HashVersion::V2 => envelope_key(&l.doc, &l.items),
        };
        let order: Vec<usize> = l
            .groups
            .iter()
            .flat_map(|g| g.nodes.iter().copied())
            .collect();
        for n in order {
            let new = self.key_of(s, n);
            let node = &mut self.loaded.as_mut().expect("loaded").nodes[n];
            if node.held == Some(node.key) {
                moves.push((node.key, new));
                node.held = Some(new);
            }
            node.key = new;
            // Its result is kept under the new key: nothing ran.
            if node.has_run {
                node.run = Run::Kept;
            }
        }
        moves
    }

    /// Keys under the scheduler's hash, rekeyed once when the process changed it.
    fn sync_hash(&mut self, s: &mut Scheduler<'_>) {
        if self.hash != s.options.hash {
            self.rekey(s);
        }
    }

    /// How many nodes the current revision has.
    pub fn node_count(&self) -> usize {
        self.loaded.as_ref().map_or(0, |l| l.nodes.len())
    }

    /// The session's current epoch.
    pub fn epoch(&self) -> u32 {
        self.epoch
    }

    /// The epoch an item's dirty class last changed at, in the current revision.
    pub fn changed_at(&self, id: &str, class: Class) -> Option<u32> {
        let l = self.loaded.as_ref()?;
        Some(l.items[*l.index.get(id)?].changed_at[class as usize])
    }

    /// The panic that froze this session, if one did.
    pub fn frozen(&self) -> Option<&OpIssue> {
        self.frozen.as_ref()
    }

    /// The current revision's load count: an interned handle's generation.
    pub fn generation(&self) -> u32 {
        self.generation
    }

    /// The current revision's document, as the scheduler reads it.
    pub fn document(&self) -> Option<&Value> {
        self.loaded.as_ref().map(|l| l.doc.as_ref())
    }

    /// The look's tokens.
    pub fn look(&self) -> &Tokens {
        &self.look
    }

    pub fn outside(&self) -> &Outside {
        &self.outside
    }

    /// The next epoch; rebased first when the counter is about to wrap.
    fn bump(&mut self) -> u32 {
        if self.epoch == u32::MAX {
            self.rebase();
        }
        self.epoch += 1;
        self.epoch
    }

    /// Renumbers every epoch the session holds by rank, keeping their order: whatever changed
    /// after a node last ran still did.
    fn rebase(&mut self) {
        let mut all: BTreeSet<u32> = BTreeSet::new();
        all.insert(self.epoch);
        all.extend([
            self.t_at,
            self.look_at,
            self.seed_at,
            self.refs_at,
            self.items_at,
            self.reading_at,
        ]);
        all.extend(self.view_at);
        all.extend(self.group_run.iter().copied());
        if let Some(l) = &self.loaded {
            all.extend(l.items.iter().flat_map(|i| i.changed_at));
            all.extend(l.nodes.iter().flat_map(|n| [n.changed_at, n.last_run]));
            all.extend(l.array_at.iter().copied());
        }
        let rank: BTreeMap<u32, u32> = all
            .iter()
            .enumerate()
            .map(|(i, e)| (*e, i as u32 + 1))
            .collect();
        // 0 stays "never", so what hasn't run yet still runs.
        let r = |e: &mut u32| *e = if *e == 0 { 0 } else { rank[e] };
        r(&mut self.epoch);
        r(&mut self.t_at);
        r(&mut self.look_at);
        r(&mut self.seed_at);
        r(&mut self.refs_at);
        r(&mut self.items_at);
        r(&mut self.reading_at);
        self.view_at.iter_mut().for_each(r);
        self.group_run.iter_mut().for_each(r);
        if let Some(l) = &mut self.loaded {
            l.items
                .iter_mut()
                .for_each(|i| i.changed_at.iter_mut().for_each(r));
            for n in &mut l.nodes {
                r(&mut n.changed_at);
                r(&mut n.last_run);
            }
            l.array_at.iter_mut().for_each(r);
        }
    }

    /// Sets the record's readings; a change stamps a new epoch for every reader of `reading`.
    pub fn set_readings(&mut self, readings: BTreeMap<String, Value>) {
        if readings != self.outside.readings {
            self.outside.readings = readings;
            self.outside_key = self.outside.key(self.hash);
            self.reading_at = self.bump();
        }
    }

    /// A new batch of a source's columns, each hashed once as it arrives: the hash is what
    /// keys read of it. Returns the passes made over values.
    pub fn batch(&mut self, columns: BTreeMap<String, Arc<[u8]>>) -> Vec<Hashed> {
        let mut hashed = Vec::new();
        let mut changed = false;
        for (name, bytes) in columns {
            let digest = Sha256::digest(&bytes);
            hashed.push(Hashed {
                of: name.clone(),
                bytes: bytes.len(),
            });
            let mut sha256 = [0u8; 32];
            sha256.copy_from_slice(&digest);
            if self.outside.columns.get(&name).map(|c| c.sha256) != Some(sha256) {
                changed = true;
            }
            self.outside.columns.insert(name, Column { bytes, sha256 });
        }
        if changed {
            self.outside_key = self.outside.key(self.hash);
            self.reading_at = self.bump();
        }
        hashed
    }

    /// The item's interned handle in the current revision: its index and the revision's
    /// generation, so a handle from another revision is refused.
    pub fn intern(&self, id: &str) -> Option<Value> {
        let l = self.loaded.as_ref()?;
        let index = l.index.get(id)?;
        Some(json!({"index": index, "generation": self.generation}))
    }

    /// The item a handle names, or `None` for a stale handle (another revision's) or one that
    /// names nothing.
    pub fn resolve(&self, handle: &Value) -> Option<String> {
        let l = self.loaded.as_ref()?;
        let generation = handle.get("generation").and_then(Value::as_u64)?;
        let index = handle.get("index").and_then(Value::as_u64)?;
        if generation != u64::from(self.generation) {
            return None;
        }
        l.items
            .get(usize::try_from(index).ok()?)
            .map(|i| i.id.clone())
    }

    /// Loads a checked revision: compiles its plan, carries the state of every node whose
    /// (operator, item) the last revision had, stamps the items whose content changed, and
    /// runs the check phases. Returns their issues.
    pub fn load(&mut self, s: &mut Scheduler<'_>, doc: &Value) -> Vec<OpIssue> {
        self.sync_hash(s);
        let mut next = compile(s, doc, self.loaded.as_ref());
        let epoch = self.bump();
        if self.group_run.len() != s.sealed.ops.len() {
            self.group_run = vec![0; s.sealed.ops.len()];
        }
        if self.loaded.is_none() {
            self.view = default_view(doc);
        }
        match self.loaded.take() {
            None => {
                for i in &mut next.items {
                    i.changed_at = [epoch; CLASSES.len()];
                }
                self.items_at = epoch;
                self.refs_at = epoch;
                self.seed_at = epoch;
            }
            Some(o) => {
                let mut any = o.items.len() != next.items.len();
                for i in &mut next.items {
                    match o.index.get(&i.id).map(|k| &o.items[*k]) {
                        Some(was) if was.key == i.key => i.changed_at = was.changed_at,
                        // A changed item stamps the classes its changed fields fall in.
                        Some(was) => {
                            i.changed_at = was.changed_at;
                            for c in classes_changed(&was.value, &i.value) {
                                i.changed_at[c as usize] = epoch;
                            }
                            any = true;
                        }
                        // A made item is a change of presence, and of everything it holds.
                        None => {
                            i.changed_at = [epoch; CLASSES.len()];
                            any = true;
                        }
                    }
                }
                if any {
                    self.items_at = epoch;
                }
                if o.doc_key != next.doc_key {
                    self.refs_at = epoch;
                }
                if o.seed != next.seed {
                    self.seed_at = epoch;
                }
                // Each node the last revision had keeps its state, and the cache its result.
                let mut carried: BTreeMap<(usize, Option<&str>), &Node> = BTreeMap::new();
                for n in &o.nodes {
                    carried.insert((n.op, n.item.map(|i| o.items[i].id.as_str())), n);
                }
                // The item a node's `parent` read binds to, if it has one.
                let parent_of = |l: &Loaded, n: &Node| -> Option<Option<String>> {
                    n.reads.iter().find_map(|b| match b {
                        Bound::Parent(p) => {
                            Some(p.and_then(|p| l.nodes[p].item.map(|i| l.items[i].id.clone())))
                        }
                        _ => None,
                    })
                };
                for k in 0..next.nodes.len() {
                    let id = next.nodes[k].item.map(|i| next.items[i].id.clone());
                    if let Some(was) = carried.get(&(next.nodes[k].op, id.as_deref())) {
                        // A node whose parent read now binds to another item, or to none, as
                        // when its parent was deleted, runs again: nothing it reads changed.
                        let rebound = parent_of(&o, was) != parent_of(&next, &next.nodes[k]);
                        let n = &mut next.nodes[k];
                        if rebound {
                            continue;
                        }
                        n.key = was.key;
                        n.out = was.out.clone();
                        n.err = was.err.clone();
                        n.changed_at = was.changed_at;
                        n.last_run = was.last_run;
                        n.has_run = was.has_run;
                        n.run = was.run;
                        n.held = was.held;
                        n.thread = was.thread;
                    }
                }
                for (a, name) in next.array_names.iter().enumerate() {
                    if let Some(k) = o.array_names.iter().position(|n| n == name) {
                        next.array_at[a] = o.array_at[k];
                    }
                }
                // What the last revision held and this one doesn't is released.
                let kept: BTreeSet<Key> = next.nodes.iter().filter_map(|n| n.held).collect();
                for n in &o.nodes {
                    if let Some(k) = n.held.filter(|k| !kept.contains(k)) {
                        s.release(k);
                    }
                }
                // A node the new revision lost no longer marks its arrays; one it gained does.
                for n in &mut next.nodes {
                    if !n.has_run {
                        n.changed_at = epoch;
                    }
                }
            }
        }
        self.generation += 1;
        self.threads = threads_for(s, doc);
        self.loaded = Some(next);
        // A new revision is the way out of a panic: its operators run again.
        self.frozen = None;
        let mut report = Report::default();
        self.frames += 1;
        let frame = self.frames;
        let groups = self.loaded.as_ref().map_or(0, |l| l.groups.len());
        for g in 0..groups {
            let op = self.loaded.as_ref().expect("loaded").groups[g].op;
            if is_check_phase(&s.sealed.ops[op].op.phase) {
                self.visit_group(s, g, frame, &mut report);
            }
        }
        let issues = report.issues.clone();
        self.report = report;
        issues
    }

    /// A revision that changes only the values of the items `ids` names (#854): each keeps its
    /// place in the plan (its parent, order, kind and asset, and every operator's `applies`), and
    /// nothing else in the document changes. Those items are rekeyed and stamped by the classes
    /// their changed fields fall in, as `load` would stamp them, without compiling the plan again;
    /// then the revision's check phases run. `None` when the revision reaches further, for `load`.
    pub fn revise_items(
        &mut self,
        s: &mut Scheduler<'_>,
        doc: &Value,
        ids: &[&str],
    ) -> Option<Vec<OpIssue>> {
        self.sync_hash(s);
        let v = s.options.hash;
        let items = doc.get("items")?.as_object()?;
        let mut fresh = Vec::with_capacity(ids.len());
        {
            let l = self.loaded.as_ref()?;
            if items.len() != l.items.len() {
                return None;
            }
            for (k, value) in doc.as_object()? {
                if k != "items" && l.doc.get(k) != Some(value) {
                    return None;
                }
            }
            for id in ids {
                let &at = l.index.get(*id)?;
                let mut value = items.get(*id)?.clone();
                without_negative_zero(&mut value);
                let was = &l.items[at].value;
                let same = |p: &str| was.pointer(p) == value.pointer(p);
                if !["/parent", "/order", "/kind", "/params/asset"]
                    .iter()
                    .all(|p| same(p))
                {
                    return None;
                }
                let applies_alike =
                    s.sealed
                        .ops
                        .iter()
                        .all(|sop| match (sop.op.applies, sop.op.per) {
                            (Some(f), Per::Item) => f(&l.doc, id, was) == f(doc, id, &value),
                            (Some(f), Per::Document) => {
                                f(&l.doc, "", &Value::Null) == f(doc, "", &Value::Null)
                            }
                            (None, _) => true,
                        });
                if !applies_alike {
                    return None;
                }
                fresh.push((at, value));
            }
        }
        let epoch = self.bump();
        let l = self.loaded.as_mut().expect("checked above");
        let mut any = false;
        for (at, value) in fresh {
            let item = &mut l.items[at];
            if written_alike(&item.value, &value) {
                continue;
            }
            for c in classes_changed(&item.value, &value) {
                item.changed_at[c as usize] = epoch;
            }
            item.key = item_key(v, &value);
            item.value = Arc::new(value.clone());
            if let Some(Value::Object(map)) = Arc::make_mut(&mut l.doc).get_mut("items") {
                map.insert(item.id.clone(), value);
            }
            any = true;
        }
        if any {
            self.items_at = epoch;
            let key = doc_key(v, Arc::make_mut(&mut l.doc), &l.items);
            if key != l.doc_key {
                l.doc_key = key;
                self.refs_at = epoch;
            }
        }
        self.generation += 1;
        self.frozen = None;
        let mut report = Report::default();
        self.frames += 1;
        let frame = self.frames;
        let groups = self.loaded.as_ref().map_or(0, |l| l.groups.len());
        for g in 0..groups {
            let op = self.loaded.as_ref().expect("loaded").groups[g].op;
            if is_check_phase(&s.sealed.ops[op].op.phase) {
                self.visit_group(s, g, frame, &mut report);
            }
        }
        let issues = report.issues.clone();
        self.report = report;
        Some(issues)
    }

    /// Every value `array` holds in the current revision, with the item each is for, in plan
    /// order: only the writer's own nodes are read.
    pub fn values(&self, s: &Scheduler<'_>, array: &str) -> Vec<(Option<&str>, Val)> {
        let (Some(l), Some(&op)) = (&self.loaded, s.writer.get(array)) else {
            return Vec::new();
        };
        let Some(k) = s.sealed.ops[op].op.writes.iter().position(|w| w == array) else {
            return Vec::new();
        };
        l.groups
            .iter()
            .filter(|g| g.op == op)
            .flat_map(|g| g.nodes.iter())
            .filter_map(|&n| {
                let node = &l.nodes[n];
                let value = node.out.get(k)?.clone();
                Some((node.item.map(|i| l.items[i].id.as_str()), value))
            })
            .collect()
    }

    /// One frame at `t` under `view`: stamps what changed, then visits only the operators whose
    /// read set changed since they last ran. Once warm, a frame with nothing changed allocates
    /// nothing and runs no operator. Returns how many nodes ran.
    pub fn frame(&mut self, s: &mut Scheduler<'_>, t: i64, view: &[Value; 6]) -> usize {
        self.sync_hash(s);
        self.report.ran = 0;
        self.report.issues.clear();
        self.report.access.clear();
        self.report.steps.clear();
        if self.loaded.is_none() {
            return 0;
        }
        if let Some(issue) = &self.frozen {
            self.report.issues.push(issue.clone());
            return 0;
        }
        let mut stamp = 0;
        if t != self.t {
            stamp = self.bump();
            self.t = t;
            self.t_at = stamp;
        }
        for (k, v) in view.iter().enumerate() {
            if *v != self.view[k] {
                if stamp == 0 {
                    stamp = self.bump();
                }
                self.view[k] = v.clone();
                self.view_at[k] = stamp;
            }
        }
        self.run_frame(s);
        self.report.ran
    }

    fn run_frame(&mut self, s: &mut Scheduler<'_>) {
        if let Some(hook) = s.look_hook {
            hook(&self.look);
        }
        self.frames += 1;
        let frame = self.frames;
        let mut report = std::mem::take(&mut self.report);
        let live = self.mode;
        if s.options.planted.runs_every_node {
            self.mode = Mode::Clean;
        }
        let groups = self.loaded.as_ref().map_or(0, |l| l.groups.len());
        for g in 0..groups {
            let (op, dirty) = {
                let l = self.loaded.as_ref().expect("loaded");
                let group = &l.groups[g];
                (
                    group.op,
                    self.mode == Mode::Clean || self.group_dirty(l, group),
                )
            };
            if !dirty || is_check_phase(&s.sealed.ops[op].op.phase) {
                continue;
            }
            // An operator with no node in this revision has nothing to visit.
            if self.loaded.as_ref().expect("loaded").groups[g]
                .nodes
                .is_empty()
            {
                continue;
            }
            self.visit_group(s, g, frame, &mut report);
        }
        self.mode = live;
        self.report = report;
    }

    /// How many nodes of each operator ran in the last frame, by the operator's key (#854).
    pub fn ran_by_operator(&self, s: &Scheduler<'_>) -> BTreeMap<String, usize> {
        let mut out = BTreeMap::new();
        let Some(l) = &self.loaded else {
            return out;
        };
        for g in &l.groups {
            let ran = g
                .nodes
                .iter()
                .filter(|&&n| l.nodes[n].visited == self.frames && l.nodes[n].run == Run::Ran)
                .count();
            if ran > 0 {
                *out.entry(s.sealed.ops[g.op].key.clone()).or_default() += ran;
            }
        }
        out
    }

    /// A clean evaluation at `t` under `view`, with `perturb` changed for it alone: every node
    /// runs, the check phases' included, on a scratch copy, so nothing is read from or written
    /// to the cache or this session's epochs. Returns the scratch session, whose nodes and
    /// report the reply reads.
    pub fn clean(
        &self,
        s: &mut Scheduler<'_>,
        t: i64,
        view: &[Value; 6],
        perturb: Option<Target>,
    ) -> Session {
        let mut scratch = self.clone();
        scratch.mode = Mode::Clean;
        scratch.steps = steps::Steps::default();
        scratch.tails = BTreeMap::new();
        scratch.t = t;
        scratch.view = view.clone();
        scratch.report = Report::default();
        if let Some(l) = &mut scratch.loaded {
            for n in &mut l.nodes {
                n.has_run = false;
                n.held = None;
                n.out = Vec::new();
                n.err = None;
            }
        }
        match &perturb {
            Some(Target::View(k)) => scratch.view[*k] = perturb_view(*k, &scratch.view[*k]),
            Some(Target::Look(role)) => {
                if let Some(v) = scratch.look.get_mut(role) {
                    *v = perturb_token(v);
                }
                scratch.look_key = look_key(scratch.hash, &scratch.look);
            }
            Some(Target::Seed) => {
                if let Some(l) = &mut scratch.loaded {
                    l.seed = json!(l.seed.as_f64().unwrap_or(0.0) + 1.0);
                }
            }
            Some(Target::Source(array)) => {
                if let (Some(&op), Some(l)) = (s.writer.get(array), &scratch.loaded) {
                    let mut doc = (*l.doc).clone();
                    if let Some(Value::Object(items)) = doc.get_mut("items") {
                        for v in items.values_mut() {
                            *v = perturb_params(v);
                        }
                    }
                    scratch.source = Some(Source {
                        op,
                        items: l
                            .items
                            .iter()
                            .map(|i| Arc::new(perturb_params(&i.value)))
                            .collect(),
                        doc: Arc::new(doc),
                    });
                }
            }
            _ => {}
        }
        scratch.perturb = perturb;
        if let Some(hook) = s.look_hook {
            hook(&scratch.look);
        }
        scratch.frames += 1;
        let frame = scratch.frames;
        let mut report = Report::default();
        let groups = scratch.loaded.as_ref().map_or(0, |l| l.groups.len());
        for g in 0..groups {
            scratch.visit_group(s, g, frame, &mut report);
        }
        scratch.report = report;
        scratch
    }

    /// A revision checked before it becomes current: its check phases and, with `frames`, one
    /// frame at `t`, run clean on a scratch session (every node runs; nothing is read from or
    /// written to the cache or this session's epochs). The scratch's report holds every
    /// operator's error.
    pub fn probe(&self, s: &mut Scheduler<'_>, doc: &Value, t: i64, frames: bool) -> Session {
        let mut scratch = Session::new(self.epoch, self.look.clone());
        scratch.outside = self.outside.clone();
        // Its look's and outside data's keys, under the scheduler's hash.
        scratch.rekey(s);
        scratch.view = if self.loaded.is_some() {
            self.view.clone()
        } else {
            default_view(doc)
        };
        scratch.mode = Mode::Clean;
        scratch.t = t;
        scratch.group_run = vec![0; s.sealed.ops.len()];
        scratch.threads = threads_for(s, doc);
        scratch.loaded = Some(compile(s, doc, None));
        if let Some(hook) = s.look_hook {
            hook(&scratch.look);
        }
        scratch.frames = 1;
        let mut report = Report::default();
        let groups = scratch.loaded.as_ref().map_or(0, |l| l.groups.len());
        for g in 0..groups {
            let op = scratch.loaded.as_ref().expect("loaded").groups[g].op;
            if frames || is_check_phase(&s.sealed.ops[op].op.phase) {
                scratch.visit_group(s, g, 1, &mut report);
            }
        }
        scratch.report = report;
        scratch
    }

    /// Whether anything an operator reads changed since it last ran: its terms' epochs and its
    /// arrays', never a node's.
    fn group_dirty(&self, l: &Loaded, group: &Group) -> bool {
        let last = self.group_run.get(group.op).copied().unwrap_or(0);
        let t = &group.terms;
        last == 0
            || (t.items && self.items_at > last)
            || (t.refs && self.refs_at > last)
            || (t.t && self.t_at > last)
            || (t.look && self.look_at > last)
            || (t.seed && self.seed_at > last)
            || (t.reading && self.reading_at > last)
            || (0..6).any(|k| t.view[k] && self.view_at[k] > last)
            || group.arrays.iter().any(|a| l.array_at[*a] > last)
    }

    fn visit_group(&mut self, s: &mut Scheduler<'_>, g: usize, frame: u64, report: &mut Report) {
        let epoch = self.epoch;
        let (op, nodes) = {
            let l = self.loaded.as_ref().expect("loaded");
            (l.groups[g].op, l.groups[g].nodes.len())
        };
        if s.sealed.ops[op].op.step.is_some() {
            self.visit_steps(s, g, frame, report);
        } else if self.threads > 1 && nodes > 1 && !s.sealed.ops[op].op.serial {
            let waves = self.loaded.as_ref().expect("loaded").groups[g].waves.len();
            for w in 0..waves {
                let group = &self.loaded.as_ref().expect("loaded").groups[g];
                let (start, end) = (group.waves[w], group.waves.get(w + 1).copied());
                self.visit_wave(s, g, start..end.unwrap_or(nodes), frame, report);
            }
        } else {
            for k in 0..nodes {
                let n = self.loaded.as_ref().expect("loaded").groups[g].nodes[k];
                self.visit(s, n, frame, report);
            }
        }
        if self.mode == Mode::Live {
            if let Some(r) = self.group_run.get_mut(op) {
                *r = epoch;
            }
        }
    }

    /// Whether a node's inputs changed since it last ran.
    fn node_dirty(&self, l: &Loaded, n: &Node) -> bool {
        if !n.has_run {
            return true;
        }
        let last = n.last_run;
        // A node per document reads every item's arrays, so an item made or deleted is a change
        // of its read set even where no remaining writer's value changed.
        if n.item.is_none() && self.items_at > last {
            return true;
        }
        n.reads.iter().any(|b| match b {
            // `self` reads every class of the item.
            Bound::SelfItem(i) => l.items[*i].changed_at.iter().any(|e| *e > last),
            Bound::SelfDoc | Bound::Refs | Bound::Asset => self.refs_at > last,
            Bound::Parent(p) => p.is_some_and(|p| l.nodes[p].changed_at > last),
            Bound::Array {
                writers,
                contributions,
                ..
            } => {
                writers.iter().any(|w| l.nodes[*w].changed_at > last)
                    || contributions
                        .iter()
                        .any(|(_, c)| l.nodes[*c].changed_at > last)
            }
            Bound::Earlier(_) | Bound::Table(_) | Bound::Input => false,
            Bound::View(k) => self.view_at[*k] > last,
            Bound::T => self.t_at > last,
            Bound::Look => self.look_at > last,
            Bound::Seed => self.seed_at > last,
            Bound::Reading => self.reading_at > last,
        })
    }

    /// Keeps a live node's result when its inputs didn't change; whether it did.
    fn unchanged(&mut self, n: usize, frame: u64) -> bool {
        let l = self.loaded.as_ref().expect("loaded");
        if self.mode != Mode::Live || self.node_dirty(l, &l.nodes[n]) {
            return false;
        }
        let node = &mut self.loaded.as_mut().expect("loaded").nodes[n];
        node.run = Run::Kept;
        node.visited = frame;
        true
    }

    fn visit(&mut self, s: &mut Scheduler<'_>, n: usize, frame: u64, report: &mut Report) {
        if self.unchanged(n, frame) {
            return;
        }
        self.tables_of(s, n);
        let fate = self.fate(s, n, 0);
        self.land(s, n, fate, frame, report);
    }

    /// Visits one wave of an operator's nodes, which have no edge between them: each node's
    /// change test, key and cache lookup, and its operator when it must run, on the pool; then
    /// every node settles in node order, so nothing a frame leaves depends on which thread
    /// finished first.
    fn visit_wave(
        &mut self,
        s: &mut Scheduler<'_>,
        g: usize,
        wave: std::ops::Range<usize>,
        frame: u64,
        report: &mut Report,
    ) {
        // What didn't change keeps its result here: only the nodes whose inputs changed go to the
        // pool, so a frame with one item changed pays for no thread.
        let mut nodes = self.loaded.as_ref().expect("loaded").groups[g].nodes[wave].to_vec();
        nodes.retain(|&n| !self.unchanged(n, frame));
        let first = match nodes[..] {
            [] => return,
            // One changed node is visited as without a pool: it pays for no thread.
            [n] => return self.visit(s, n, frame, report),
            [first, ..] => first,
        };
        // One operator's nodes read the same tables.
        self.tables_of(s, first);
        let fates = self.fates(s, &nodes);
        s.deferred = Some(Vec::new());
        for (n, fate) in nodes.into_iter().zip(fates) {
            self.land(s, n, fate, frame, report);
        }
        // A result the cache lets go is freed on the pool too: freeing a large result costs
        // about as much as making it.
        let l = self.loaded.as_mut().expect("loaded");
        for (n, held) in s.apply_deferred(self.threads) {
            l.nodes[n].held = held;
        }
    }

    /// Each node's fate, on the pool, in `nodes`' order; the planted merge stores them in the
    /// order they finished instead, in a session's own frame.
    fn fates(&self, s: &Scheduler<'_>, nodes: &[usize]) -> Vec<(Fate, Vec<Hashed>)> {
        let Some(pool) = s.options.pool.as_deref() else {
            return nodes.iter().map(|&n| self.fate(s, n, 0)).collect();
        };
        let op = self.loaded.as_ref().expect("loaded").nodes[nodes[0]].op;
        if s.options.planted.merge_by_finish
            && self.mode == Mode::Live
            && !is_check_phase(&s.sealed.ops[op].op.phase)
        {
            let finished = std::sync::Mutex::new(Vec::with_capacity(nodes.len()));
            pool.run(self.threads, nodes.len(), &|k, thread| {
                let fate = self.fate(s, nodes[k], thread);
                finished.lock().expect("unpoisoned").push(fate);
            });
            return finished.into_inner().expect("unpoisoned");
        }
        let slots: Vec<std::sync::OnceLock<(Fate, Vec<Hashed>)>> =
            nodes.iter().map(|_| std::sync::OnceLock::new()).collect();
        pool.run(self.threads, nodes.len(), &|k, thread| {
            let _ = slots[k].set(self.fate(s, nodes[k], thread));
        });
        slots
            .into_iter()
            .map(|slot| slot.into_inner().expect("every job ran"))
            .collect()
    }

    /// What a changed node comes to this frame, touching nothing but what it returns: its tables
    /// are built.
    fn fate(&self, s: &Scheduler<'_>, n: usize, thread: usize) -> (Fate, Vec<Hashed>) {
        let mut hashed = Vec::new();
        let node = &self.loaded.as_ref().expect("loaded").nodes[n];
        let key = self.key_in(s, n, &mut hashed);
        if self.mode == Mode::Live {
            if node.has_run && node.key == key {
                return (Fate::Kept, hashed);
            }
            if let Some((out, err, _)) = s.cache.get(&key) {
                return (Fate::Hit(key, out.clone(), err.clone()), hashed);
            }
        }
        let (called, access, json) = self.run_op(s, n, None);
        (Fate::Ran(key, called, access, json, thread), hashed)
    }

    /// Applies a node's fate and the passes over values its key made: it keeps its result, or
    /// settles a cached or a new one.
    fn land(
        &mut self,
        s: &mut Scheduler<'_>,
        n: usize,
        (fate, hashed): (Fate, Vec<Hashed>),
        frame: u64,
        report: &mut Report,
    ) {
        let epoch = self.epoch;
        s.hashes.extend(hashed);
        match fate {
            Fate::Kept => {
                let node = &mut self.loaded.as_mut().expect("loaded").nodes[n];
                node.run = Run::Kept;
                node.last_run = epoch;
                node.visited = frame;
            }
            Fate::Hit(key, out, err) => self.settle(s, n, key, out, err, Run::Hit, frame, report),
            Fate::Ran(key, (out, err, _, tails), access, json, thread) => {
                if s.options.access_log {
                    report.access.extend(access);
                }
                s.json_written.extend(json);
                self.tails.extend(tails);
                report.ran += 1;
                if self.mode == Mode::Live {
                    s.insert(key, out.clone(), err.clone());
                }
                self.settle(s, n, key, out, err, Run::Ran, frame, report);
                self.loaded.as_mut().expect("loaded").nodes[n].thread = thread;
            }
        }
    }

    /// Stores a node's new result, stamps its arrays and reports its error; in a perturbed
    /// clean evaluation, the writer of the perturbed array leaves another value of its type,
    /// under another key, for its readers.
    #[allow(clippy::too_many_arguments)]
    fn settle(
        &mut self,
        s: &mut Scheduler<'_>,
        n: usize,
        key: Key,
        out: Vec<Val>,
        err: Option<OpError>,
        run: Run,
        frame: u64,
        report: &mut Report,
    ) {
        let epoch = self.epoch;
        let perturb = self.perturb.clone();
        let mode = self.mode;
        let sealed: &Sealed = s.sealed;
        let l = self.loaded.as_mut().expect("loaded");
        let sop = &sealed.ops[l.nodes[n].op];
        if let Some(e) = &err {
            // A read that failed upstream is that writer's issue, reported once.
            if e.code != "input_failed" {
                let issue = OpIssue {
                    code: e.code,
                    module: sop.module.clone(),
                    operator: sop.key.clone(),
                    item: l.nodes[n].item.map(|i| l.items[i].id.clone()),
                    path: e.path.clone(),
                    read: e.read.clone(),
                };
                // A panic freezes this session alone: every other session goes on.
                if e.code == "operator_panic" && mode == Mode::Live && self.frozen.is_none() {
                    self.frozen = Some(issue.clone());
                }
                report.issues.push(issue);
            }
        }
        let node = &mut l.nodes[n];
        let changed = !node.has_run || node.key != key;
        let was_held = node.held;
        node.key = key;
        node.perturbed = None;
        node.out = out;
        node.err = err;
        node.has_run = true;
        node.run = run;
        node.last_run = epoch;
        node.visited = frame;
        if let Some(Target::Array(name) | Target::Source(name)) = &perturb {
            if let Some(k) = sop.op.writes.iter().position(|w| w == name) {
                if let Some(v) = node.out.get_mut(k) {
                    *v = v.perturbed();
                }
                node.perturbed = Some(name.clone());
            }
        }
        if changed {
            node.changed_at = epoch;
            for &a in &l.writes_at[l.nodes[n].op] {
                l.array_at[a] = epoch;
            }
        }
        // The cache holds a result while a current node reads its key.
        if mode == Mode::Live && was_held != Some(key) {
            if let Some(held) = s.hold(n, key) {
                l.nodes[n].held = held.then_some(key);
            }
            if let Some(k) = was_held {
                s.release(k);
            }
        }
    }

    /// The node's content key, from its declared reads in order; never an epoch.
    fn key_of(&self, s: &mut Scheduler<'_>, n: usize) -> Key {
        self.tables_of(s, n);
        let mut hashed = Vec::new();
        let key = self.key_in(s, n, &mut hashed);
        s.hashes.extend(hashed);
        key
    }

    /// Builds the tables a node reads, so that reading them takes nothing mutable.
    fn tables_of(&self, s: &mut Scheduler<'_>, n: usize) {
        let l = self.loaded.as_ref().expect("loaded");
        for b in &l.nodes[n].reads {
            if let Bound::Table(name) = b {
                s.table(name);
            }
        }
    }

    /// [`Session::key_of`] with the node's tables already built; the passes over values it
    /// makes go to `hashed`.
    fn key_in(&self, s: &Scheduler<'_>, n: usize, hashed: &mut Vec<Hashed>) -> Key {
        let sealed: &Sealed = s.sealed;
        let l = self.loaded.as_ref().expect("loaded");
        let node = &l.nodes[n];
        let sop = &sealed.ops[node.op];
        let mut h = Hasher::of(self.hash, &sop.key);
        let mut version = [0u8; 64];
        h.bytes(semver_text(&sop.version, &mut version));
        // A node per item is that item's: which item it runs for is part of what it computes,
        // whatever it reads.
        if let Some(i) = node.item {
            h.text("item").text(&l.items[i].id);
        }
        if sop.op.step.is_some() {
            // A step's state is what every step up to t left.
            h.text("t").int(self.t);
        }
        for (term, b) in sop.op.reads.iter().zip(&node.reads) {
            h.text(term);
            match b {
                Bound::SelfItem(i) if s.options.planted.key_without_params => {
                    let mut item = (*l.items[*i].value).clone();
                    if let Some(map) = item.as_object_mut() {
                        map.remove("params");
                    }
                    h.bytes(&canonical(&item));
                }
                Bound::SelfItem(i) => {
                    h.key(&l.items[*i].key);
                }
                Bound::SelfDoc | Bound::Refs => {
                    h.key(&l.doc_key);
                }
                Bound::Parent(Some(p)) => {
                    let parent = &l.nodes[*p];
                    h.key(&parent.key_for(parent.perturbed.as_deref().unwrap_or(""), self.hash));
                }
                Bound::Parent(None) => {
                    h.text("none");
                }
                Bound::Array {
                    name,
                    writers,
                    contributions,
                } => {
                    for w in writers {
                        let wn = &l.nodes[*w];
                        if s.options.planted.key_hashes.as_deref() == Some(name.as_str()) {
                            // The planted key: a pass over the array's values.
                            let mut bytes = 0;
                            for v in &wn.out {
                                let b = v.bytes();
                                bytes += b.len();
                                h.bytes(&b);
                            }
                            hashed.push(Hashed {
                                of: name.clone(),
                                bytes,
                            });
                        } else {
                            h.key(&wn.key_for(name, self.hash));
                        }
                    }
                    for (c, w) in contributions {
                        h.text(c).key(&l.nodes[*w].key_for(c, self.hash));
                    }
                }
                Bound::Earlier(name) => {
                    h.text(name);
                }
                Bound::Table(name) => {
                    let key = s.tables.get(name).map(|(_, k)| *k).unwrap_or_default();
                    match &self.perturb {
                        Some(Target::Table(t)) if t == name => {
                            h.key(&Hasher::of(self.hash, "perturbed").key(&key).finish());
                        }
                        _ => {
                            h.key(&key);
                        }
                    }
                }
                Bound::View(k) => {
                    let skip = (*k == LOCALE && s.options.planted.key_without_locale)
                        || (*k == REDUCED_MOTION && s.options.planted.key_without_reduced_motion);
                    if !skip {
                        h.bytes(&canonical(&self.view[*k]));
                    }
                }
                Bound::T => {
                    h.int(self.t);
                }
                Bound::Look => {
                    h.key(&self.look_key);
                }
                Bound::Seed => {
                    h.bytes(&canonical(&l.seed));
                }
                Bound::Reading => {
                    h.key(&self.outside_key);
                }
                Bound::Input => {
                    h.text("no input");
                }
                Bound::Asset => {
                    for a in &l.assets {
                        h.text(a);
                        if self.perturb == Some(Target::Asset(a.clone())) {
                            h.text("perturbed");
                        }
                    }
                }
            }
        }
        h.finish()
    }

    /// Calls a node's operator on its view (with a step's context, for a step). A panic is
    /// caught and becomes the operator's error, so it stops nothing but its own node.
    fn call(
        &self,
        s: &mut Scheduler<'_>,
        n: usize,
        step: Option<view::StepCtx<'_>>,
        report: &mut Report,
    ) -> Called {
        self.tables_of(s, n);
        let (called, access, json) = self.run_op(s, n, step);
        if s.options.access_log {
            report.access.extend(access);
        }
        s.json_written.extend(json);
        called
    }

    /// Calls a node's operator on its view, with the tables it reads already built; touches
    /// nothing outside the node, so nodes with no edge between them may run on several threads.
    fn run_op(
        &self,
        s: &Scheduler<'_>,
        n: usize,
        step: Option<view::StepCtx<'_>>,
    ) -> (Called, Vec<Access>, Vec<Arc<Value>>) {
        let sealed: &Sealed = s.sealed;
        let l = self.loaded.as_ref().expect("loaded");
        let node = &l.nodes[n];
        let Some(run) = sealed.ops[node.op].op.run else {
            return ((Vec::new(), None, None, Vec::new()), Vec::new(), Vec::new());
        };
        let mut tables = BTreeMap::new();
        for b in &node.reads {
            if let Bound::Table(name) = b {
                if let Some((v, _)) = s.tables.get(name) {
                    tables.insert(name.clone(), v.clone());
                }
            }
        }
        let mut view = View::new(self, sealed, l, node, tables, s.options.access_log, step);
        let item = node.item.map(|i| l.items[i].id.as_str());
        if let Some(timing) = s.options.timing {
            timing(node.op, item, false);
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&mut view)));
        if let Some(timing) = s.options.timing {
            timing(node.op, item, true);
        }
        let (mut out, access, noted, mut tails) = view.finish();
        // A frame phase passes typed values only (#855): a JSON value written there is refused,
        // naming the operator, unless the planted seal let its writer in, when it is counted.
        let mut json_written = Vec::new();
        if !is_check_phase(&sealed.ops[node.op].op.phase) {
            let json = out
                .iter()
                .chain(tails.iter().map(|(_, v)| v))
                .filter_map(|v| match v {
                    Val::Json(j) => Some(Arc::clone(j)),
                    _ => None,
                });
            if s.options.planted.admits_frame_json {
                json_written.extend(json);
            } else if json.count() > 0 {
                out.iter_mut().for_each(|v| *v = Val::None);
                tails.clear();
                let path = item.map_or_else(String::new, |i| format!("items/{i}"));
                let refused = (out, Some(OpError::new("json_in_frame", path)), noted, tails);
                return (refused, access, json_written);
            }
        }
        let called = match result {
            Ok(Ok(())) => (out, None, noted, tails),
            Ok(Err(e)) => (out, Some(e), noted, tails),
            Err(_) => (
                Vec::new(),
                Some(OpError::new("operator_panic", "")),
                noted,
                Vec::new(),
            ),
        };
        (called, access, json_written)
    }

    /// Every node of the current revision, as an `eval` reply lists them: the check phases'
    /// as the revision's check had them, then the frame phases' for the last frame.
    pub fn nodes(&self, s: &Scheduler<'_>) -> Vec<NodeReport> {
        let Some(l) = &self.loaded else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for g in &l.groups {
            let sop = &s.sealed.ops[g.op];
            let check = is_check_phase(&sop.op.phase);
            for &n in &g.nodes {
                let node = &l.nodes[n];
                let run = if check || node.visited == self.frames {
                    node.run
                } else {
                    Run::Kept
                };
                out.push(NodeReport {
                    operator: sop.key.clone(),
                    module: sop.module.clone(),
                    phase: sop.op.phase.clone(),
                    item: node.item.map(|i| l.items[i].id.clone()),
                    key: node.key.hex(),
                    result: result_digest(self.hash, &node.out, node.err.as_ref()),
                    run,
                    thread: (run == Run::Ran).then_some(node.thread),
                    values: node.out.clone(),
                });
            }
        }
        out
    }

    /// Every input a perturbed clean evaluation may change: each array the revision's nodes
    /// write, each table they read, the six view inputs, the look's tokens, the seed and each
    /// asset.
    pub fn targets(&self, s: &Scheduler<'_>) -> Vec<Target> {
        let Some(l) = &self.loaded else {
            return Vec::new();
        };
        let mut arrays: Vec<String> = Vec::new();
        let mut tables: Vec<String> = Vec::new();
        for g in &l.groups {
            if g.nodes.is_empty() {
                continue;
            }
            let op = &s.sealed.ops[g.op].op;
            for w in &op.writes {
                if !arrays.contains(w) {
                    arrays.push(w.clone());
                }
            }
            for r in &op.reads {
                if let Some(t) = r.strip_prefix("table:") {
                    if !tables.iter().any(|x| x == t) {
                        tables.push(t.to_string());
                    }
                }
            }
        }
        let mut out: Vec<Target> = arrays.into_iter().map(Target::Array).collect();
        out.extend(tables.into_iter().map(Target::Table));
        out.extend((0..6).map(Target::View));
        out.extend(self.look.keys().cloned().map(Target::Look));
        out.push(Target::Seed);
        out.extend(l.assets.iter().cloned().map(Target::Asset));
        out
    }

    /// The value of `array` its writer left on `item` (or on the document), with what
    /// contributes to it folded in.
    pub fn value(&self, s: &Scheduler<'_>, array: &str, item: Option<&str>) -> Option<Val> {
        let l = self.loaded.as_ref()?;
        let op = *s.writer.get(array)?;
        let k = s.sealed.ops[op].op.writes.iter().position(|w| w == array)?;
        let item = match item {
            Some(id) => Some(*l.index.get(id)?),
            None => None,
        };
        let node = l.nodes.iter().find(|n| n.op == op && n.item == item)?;
        node.out.get(k).cloned()
    }

    /// The value of `array` on `item` (or the document) with every contribution for it folded
    /// in, in the seal's order, as a reader of the array gets it; with the keys of the nodes that
    /// made it, its writer's first (#411: deep_query's values and their content keys).
    pub fn read(
        &self,
        s: &Scheduler<'_>,
        array: &str,
        item: Option<&str>,
    ) -> Option<(Val, Vec<Key>)> {
        let l = self.loaded.as_ref()?;
        let item = match item {
            Some(id) => Some(*l.index.get(id)?),
            None => None,
        };
        let output = |name: &str| -> Option<Vec<(Val, Key)>> {
            let op = *s.writer.get(name)?;
            let k = s.sealed.ops[op].op.writes.iter().position(|w| w == name)?;
            Some(
                l.nodes
                    .iter()
                    .filter(|n| n.op == op && n.item == item)
                    .filter_map(|n| Some((n.out.get(k)?.clone(), n.key)))
                    .collect(),
            )
        };
        let (val, key) = output(array)?.into_iter().next()?;
        let mut keys = vec![key];
        let mut edits = Vec::new();
        for c in s.sealed.contributions.get(array).into_iter().flatten() {
            for (v, key) in output(c).unwrap_or_default() {
                keys.push(key);
                if let Some(e) = v.as_typed::<core_ops::Edits>() {
                    edits.push(e);
                }
            }
        }
        let val = if edits.is_empty() {
            val
        } else {
            core_ops::fold_edits(&val, &edits)
        };
        Some((val, keys))
    }

    /// The hash this session's keys are made with.
    pub fn hash(&self) -> HashVersion {
        self.hash
    }
}

/// The threads a document's independent nodes run on: the options' count in place of its budget
/// class's, the pool's performance cores for export, one for a document with no class or a
/// scheduler with no pool.
fn threads_for(s: &Scheduler<'_>, doc: &Value) -> usize {
    let Some(pool) = &s.options.pool else {
        return 1;
    };
    let class = crate::budget::of(doc).map_or(Some(1), |(c, _)| c.threads());
    s.options
        .threads
        .or(class)
        .unwrap_or_else(|| pool.performance_cores())
        .max(1)
}

/// A node's result as `nodes` shows it: its outputs' bytes, each length-prefixed, then its
/// error, hashed with the session's hash: SHA-256 under `hash@1`, BLAKE3 under `hash@2`.
fn result_digest(v: HashVersion, out: &[Val], err: Option<&OpError>) -> String {
    let mut bytes = Vec::new();
    for v in out {
        let b = v.bytes();
        bytes.extend_from_slice(&(b.len() as u64).to_le_bytes());
        bytes.extend_from_slice(&b);
    }
    if let Some(e) = err {
        bytes.extend_from_slice(format!("error:{}:{}", e.code, e.path).as_bytes());
    }
    match v {
        HashVersion::V1 => sha256_hex(&bytes),
        HashVersion::V2 => blake3::hash(&bytes).to_hex().to_string(),
    }
}

/// Another value of a view input's type.
fn perturb_view(k: usize, v: &Value) -> Value {
    match k {
        LOCALE => json!(if v.as_str() == Some("de") { "en" } else { "de" }),
        REDUCED_MOTION => json!(!v.as_bool().unwrap_or(false)),
        2 => json!(v.as_f64().unwrap_or(1.0) + 1.0),
        3 => json!(if v.is_null() { "someone" } else { "" }),
        _ => {
            let mut out = v.clone();
            if !perturb_number(&mut out) {
                out = json!([1, 1]);
            }
            out
        }
    }
}

/// Another value of a look token's type: a color's first channel moves.
fn perturb_token(v: &Value) -> Value {
    match v {
        Value::Array(rgb) => {
            let mut out = rgb.clone();
            if let Some(first) = out.first_mut() {
                let x = first.as_u64().unwrap_or(0);
                *first = json!((x + 64) % 256);
            }
            Value::Array(out)
        }
        other => {
            let mut out = other.clone();
            if !perturb_number(&mut out) && !perturb_string(&mut out) {
                out = json!(0);
            }
            out
        }
    }
}

/// A seeded shuffle (SplitMix64): the same seed, the same order, on every machine.
struct Shuffle(u64);

impl Shuffle {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
}

/// The ID and depth of each item, its parent's index, its order key and its key from its
/// canonical bytes (with −0 as +0 and every number normalized). An item `was`, the last
/// revision, holds as it is keeps that revision's value and key, which its bytes would give again.
fn items_of(
    v: HashVersion,
    doc: &Value,
    was: Option<&Loaded>,
) -> (Vec<Item>, BTreeMap<String, usize>) {
    let empty = serde_json::Map::new();
    let map = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let mut ids: Vec<&String> = map.keys().collect();
    ids.sort();
    let index: BTreeMap<String, usize> = ids
        .iter()
        .enumerate()
        .map(|(i, id)| ((*id).clone(), i))
        .collect();
    let mut items: Vec<Item> = ids
        .iter()
        .map(|id| {
            let value = &map[id.as_str()];
            let kept = was
                .and_then(|o| o.index.get(id.as_str()).map(|k| &o.items[*k]))
                .filter(|o| written_alike(&o.value, value));
            let (shared, key) = match kept {
                Some(o) => (Arc::clone(&o.value), o.key),
                None => (Arc::new(value.clone()), item_key(v, value)),
            };
            Item {
                id: (*id).clone(),
                value: shared,
                key,
                changed_at: [0; CLASSES.len()],
                parent: value
                    .get("parent")
                    .and_then(Value::as_str)
                    .and_then(|p| index.get(p).copied()),
                depth: 0,
                order: value
                    .get("order")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            }
        })
        .collect();
    for i in 0..items.len() {
        let mut depth = 0;
        let mut at = items[i].parent;
        while let Some(p) = at {
            depth += 1;
            if depth as usize > items.len() {
                break;
            }
            at = items[p].parent;
        }
        items[i].depth = depth;
    }
    (items, index)
}

/// A version's text, `major.minor.patch`, written into `buf` rather than a new string.
fn semver_text<'b>(v: &crate::registry::Semver, buf: &'b mut [u8; 64]) -> &'b [u8] {
    use std::io::Write;
    let mut at = std::io::Cursor::new(&mut buf[..]);
    let _ = write!(at, "{v}");
    let n = at.position() as usize;
    &buf[..n]
}

/// An item's key: the hash of its canonical bytes.
fn item_key(v: HashVersion, item: &Value) -> Key {
    Hasher::of(v, "self").bytes(&canonical(item)).finish()
}

/// The document's key, without its ID, which is where it lives, not what it holds (the ID goes
/// back in its place after). `hash@1` hashes the whole document's canonical bytes; `hash@2` its
/// envelope's members, in name order, and then each item's ID and key, so the items, already
/// keyed, aren't encoded twice.
fn doc_key(v: HashVersion, doc: &mut Value, items: &[Item]) -> Key {
    if v == HashVersion::V2 {
        return envelope_key(doc, items);
    }
    let id = doc.as_object_mut().and_then(|map| {
        let at = map.keys().position(|k| k == "id")?;
        Some((at, map.shift_remove("id")?))
    });
    let key = Hasher::of(v, "document").bytes(&canonical(doc)).finish();
    if let (Some((at, id)), Some(map)) = (id, doc.as_object_mut()) {
        map.shift_insert(at, "id".into(), id);
    }
    key
}

/// `hash@2`'s document key: the envelope's members but its ID and items, in name order, then
/// each item's ID and key.
fn envelope_key(doc: &Value, items: &[Item]) -> Key {
    let mut h = Hasher::of(HashVersion::V2, "document");
    if let Some(map) = doc.as_object() {
        let mut members: Vec<(&String, &Value)> = map
            .iter()
            .filter(|(k, _)| *k != "id" && *k != "items")
            .collect();
        members.sort_by(|a, b| a.0.cmp(b.0));
        for (k, value) in members {
            h.text(k).bytes(&canonical(value));
        }
    }
    h.text("items");
    for item in items {
        h.text(&item.id).key(&item.key);
    }
    h.finish()
}

/// Whether two values are equal and write their keys in the same order: `==` on a map ignores
/// the order, which the kept value would carry into what reads it.
fn written_alike(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((j, v), (k, w))| j == k && written_alike(v, w))
        }
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(v, w)| written_alike(v, w))
        }
        _ => a == b,
    }
}

/// Compiles a checked revision into its plan: the nodes each kept operator has, their reads
/// bound, and the order they visit in. `was` is the revision it follows, if any.
fn compile(s: &Scheduler<'_>, doc: &Value, was: Option<&Loaded>) -> Loaded {
    let mut doc = doc.clone();
    without_negative_zero(&mut doc);
    let (items, index) = items_of(s.options.hash, &doc, was);
    let doc_key = doc_key(s.options.hash, &mut doc, &items);
    let seed = doc.get("seed").cloned().unwrap_or(Value::Null);
    let mut assets = BTreeSet::new();
    for item in &items {
        if let Some(a) = item
            .value
            .get("params")
            .and_then(|p| p.get("asset"))
            .and_then(Value::as_str)
        {
            assets.insert(a.to_string());
        }
    }
    let sealed = s.sealed;
    let mut shuffle = s.options.shuffle.map(|seed| Shuffle(u64::from(seed)));

    // The operators in visiting order: the seal's, or under a shuffle any legal order with ties
    // broken by the shuffle, each phase on its own.
    let mut op_order: Vec<usize> = (0..sealed.ops.len()).collect();
    if let Some(sh) = &mut shuffle {
        op_order = shuffled_ops(s, sh);
    }

    // Nodes, operator by operator.
    let mut nodes: Vec<Node> = Vec::new();
    let mut groups: Vec<Group> = Vec::new();
    let mut node_of: BTreeMap<(usize, Option<usize>), usize> = BTreeMap::new();
    for &o in &op_order {
        let sop = &sealed.ops[o];
        if sop.op.run.is_none() {
            continue;
        }
        let mut members: Vec<Option<usize>> = Vec::new();
        match sop.op.per {
            Per::Document => {
                if sop.op.applies.is_none_or(|f| f(&doc, "", &Value::Null)) {
                    members.push(None);
                }
            }
            Per::Item => {
                let mut list: Vec<usize> = (0..items.len())
                    .filter(|i| {
                        sop.op
                            .applies
                            .is_none_or(|f| f(&doc, &items[*i].id, &items[*i].value))
                    })
                    .collect();
                // Items by dependency depth, order key, then ID; or by depth, then the shuffle.
                match &mut shuffle {
                    Some(sh) => {
                        let mut keyed: Vec<(u32, u64, usize)> = list
                            .iter()
                            .map(|i| (items[*i].depth, sh.next(), *i))
                            .collect();
                        keyed.sort();
                        list = keyed.into_iter().map(|(_, _, i)| i).collect();
                    }
                    None => list.sort_by(|a, b| {
                        let (x, y) = (&items[*a], &items[*b]);
                        (x.depth, &x.order, &x.id).cmp(&(y.depth, &y.order, &y.id))
                    }),
                }
                members.extend(list.into_iter().map(Some));
            }
        }
        let mut group = Group {
            op: o,
            nodes: Vec::new(),
            waves: Vec::new(),
            arrays: Vec::new(),
            terms: Terms::default(),
        };
        for item in members {
            node_of.insert((o, item), nodes.len());
            group.nodes.push(nodes.len());
            nodes.push(Node {
                op: o,
                item,
                reads: Vec::new(),
                key: Key::default(),
                perturbed: None,
                out: Vec::new(),
                err: None,
                changed_at: 0,
                last_run: 0,
                has_run: false,
                run: Run::Kept,
                visited: 0,
                held: None,
                thread: 0,
            });
        }
        groups.push(group);
    }

    // Array epochs, by name.
    let array_names: Vec<String> = sealed.arrays.keys().cloned().collect();
    let array_index = |name: &str| array_names.iter().position(|n| n == name);

    // Reads, bound per node.
    let nodes_of = |op: usize| -> Vec<usize> {
        let mut list: Vec<(usize, usize)> = node_of
            .iter()
            .filter(|((o, _), _)| *o == op)
            .map(|((_, item), n)| (item.unwrap_or(0), *n))
            .collect();
        list.sort();
        list.into_iter().map(|(_, n)| n).collect()
    };
    for g in &mut groups {
        let sop = &sealed.ops[g.op];
        for read in &sop.op.reads {
            let t = &mut g.terms;
            match read.as_str() {
                "self" => t.items = true,
                "refs" | "asset" | "parent" | "children" | "siblings" => {
                    t.refs = true;
                    t.items = true;
                }
                "t" => t.t = true,
                "look" => t.look = true,
                "seed" => t.seed = true,
                "reading" | "input" => t.reading = true,
                r if r.starts_with("view(") => {
                    if let Some(k) = VIEW_INPUTS.iter().position(|v| format!("view({v})") == r) {
                        t.view[k] = true;
                    }
                }
                r if r.starts_with("table:")
                    || r.starts_with("earlier(")
                    || r.starts_with("set(") => {}
                array => {
                    if let Some(a) = array_index(array) {
                        g.arrays.push(a);
                    }
                    for c in sealed.contributions.get(array).into_iter().flatten() {
                        if let Some(a) = array_index(c) {
                            g.arrays.push(a);
                        }
                    }
                    // Its own items' arrays change with the items.
                    t.items = true;
                }
            }
        }
        if sop.op.step.is_some() {
            g.terms.t = true;
            g.terms.items = true;
        }
    }
    for node in &mut nodes {
        let (op, item) = (node.op, node.item);
        let sop = &sealed.ops[op];
        let per_doc = sop.op.per == Per::Document;
        let mut reads = Vec::new();
        for read in &sop.op.reads {
            let b = match read.as_str() {
                "self" if per_doc => Bound::SelfDoc,
                "self" => Bound::SelfItem(item.unwrap_or(0)),
                "refs" => Bound::Refs,
                "parent" => Bound::Parent(
                    item.and_then(|i| items[i].parent)
                        .and_then(|p| node_of.get(&(op, Some(p))).copied()),
                ),
                "children" | "siblings" | "set(collection)" | "set(lights)" | "set(sky)"
                | "set(bounds)" => Bound::Refs,
                "t" => Bound::T,
                "look" => Bound::Look,
                "seed" => Bound::Seed,
                "reading" => Bound::Reading,
                "input" => Bound::Input,
                "asset" => Bound::Asset,
                r if r.starts_with("view(") => Bound::View(
                    VIEW_INPUTS
                        .iter()
                        .position(|v| format!("view({v})") == r)
                        .unwrap_or(0),
                ),
                r if r.starts_with("table:") => Bound::Table(r["table:".len()..].to_string()),
                r if r.starts_with("earlier(") => Bound::Earlier(
                    r.trim_start_matches("earlier(")
                        .trim_end_matches(')')
                        .to_string(),
                ),
                array => {
                    let bind = |name: &str| -> Vec<usize> {
                        let Some(&w) = s.writer.get(name) else {
                            return Vec::new();
                        };
                        if sealed.ops[w].op.per == Per::Document {
                            node_of.get(&(w, None)).copied().into_iter().collect()
                        } else if per_doc {
                            nodes_of(w)
                        } else {
                            node_of.get(&(w, item)).copied().into_iter().collect()
                        }
                    };
                    let contributions = sealed
                        .contributions
                        .get(array)
                        .into_iter()
                        .flatten()
                        .flat_map(|c| bind(c).into_iter().map(move |n| (c.clone(), n)))
                        .collect();
                    Bound::Array {
                        name: array.to_string(),
                        writers: bind(array),
                        contributions,
                    }
                }
            };
            reads.push(b);
        }
        node.reads = reads;
    }
    // A group's nodes are consecutive, so a parent's node is in the current wave when its index
    // is at or past the wave's first node.
    for g in &mut groups {
        let mut start = 0;
        for (k, &n) in g.nodes.iter().enumerate() {
            let first = g.nodes[start];
            let in_wave = nodes[n]
                .reads
                .iter()
                .any(|b| matches!(b, Bound::Parent(Some(p)) if *p >= first));
            if k == 0 || in_wave {
                start = k;
                g.waves.push(k);
            }
        }
    }
    let array_at = vec![0; array_names.len()];
    let writes_at = sealed
        .ops
        .iter()
        .map(|o| o.op.writes.iter().filter_map(|w| array_index(w)).collect())
        .collect();
    Loaded {
        doc: Arc::new(doc),
        doc_key,
        seed,
        assets,
        items,
        index,
        nodes,
        groups,
        array_at,
        array_names,
        writes_at,
    }
}

/// The operators in a legal order with every tie broken by the shuffle: inside each phase, an
/// operator comes after the writers of what it reads and of what contributes to it.
fn shuffled_ops(s: &Scheduler<'_>, sh: &mut Shuffle) -> Vec<usize> {
    let ops = &s.sealed.ops;
    let mut out = Vec::new();
    let mut start = 0;
    while start < ops.len() {
        let phase = &ops[start].op.phase;
        let end = (start..ops.len())
            .find(|i| &ops[*i].op.phase != phase)
            .unwrap_or(ops.len());
        let members: Vec<usize> = (start..end).collect();
        let reads_from = |a: usize, b: usize| -> bool {
            // `a` reads what `b` writes, or what contributes to it.
            ops[a].op.reads.iter().any(|r| {
                ops[b].op.writes.contains(r)
                    || s.sealed
                        .contributions
                        .get(r)
                        .is_some_and(|cs| cs.iter().any(|c| ops[b].op.writes.contains(c)))
            })
        };
        let mut left: Vec<usize> = members.clone();
        while !left.is_empty() {
            let ready: Vec<usize> = left
                .iter()
                .copied()
                .filter(|a| !left.iter().any(|b| b != a && reads_from(*a, *b)))
                .collect();
            let pick = if ready.is_empty() {
                left[0]
            } else {
                ready[(sh.next() % ready.len() as u64) as usize]
            };
            out.push(pick);
            left.retain(|x| *x != pick);
        }
        start = end;
    }
    out
}

#[cfg(test)]
mod tests;
