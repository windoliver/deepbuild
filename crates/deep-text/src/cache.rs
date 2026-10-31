//! Issue #856: the shaped-run cache. One per process, shared by every shaper and so by every
//! document: a text is shaped once per (text, font hash, size, features, width, max lines) and its
//! run reused after (canvas primitives: Text `text@1`, "Shaped once per …"). It holds runs up to
//! [`BOUND`] bytes and evicts the least recently used past it. A run a document still draws stays
//! alive in that document; eviction only drops the cache's own hold.

use std::cell::Cell;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

use crate::fonts::{Role, FACES};
use crate::shape::{Glyph, Shaped, Spec};

/// The bytes the cache may hold runs for.
pub const BOUND: usize = 32 << 20;

/// A run's key: the text and everything its shape depends on. `fitted` marks a text's run cut to
/// its box with an ellipsis, kept apart from the run of the whole text.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    text: Box<str>,
    font: u64,
    size: u32,
    /// Weight, tabular figures and line height.
    features: (u16, bool, u32),
    width: Option<u32>,
    max_lines: Option<u16>,
    align: u8,
    bound: bool,
    mask: bool,
    fitted: bool,
    /// Nonzero only under the planted cache per document.
    scope: u64,
}

impl Key {
    pub(crate) fn of(spec: &Spec<'_>, text: &str, fitted: bool) -> Key {
        Key {
            text: text.into(),
            font: font_hash(spec.role),
            size: spec.size.to_bits(),
            features: (spec.weight, spec.tabular, spec.line_height().to_bits()),
            // A bound value is never wrapped, so its box doesn't change its run.
            width: spec.width.filter(|_| !spec.bound).map(f32::to_bits),
            max_lines: spec.max_lines,
            align: spec.align as u8,
            bound: spec.bound,
            mask: spec.mask,
            fitted,
            scope: SCOPE.with(Cell::get),
        }
    }

    /// The text the run is of.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// The hash of the bundled faces a role's family picks from by weight.
fn font_hash(role: Role) -> u64 {
    static HASHES: LazyLock<[u64; 2]> = LazyLock::new(|| {
        [Role::Body, Role::Mono].map(|role| {
            let mut h = DefaultHasher::new();
            for face in FACES.iter().filter(|f| f.role == role) {
                face.weight.hash(&mut h);
                face.bytes.hash(&mut h);
            }
            h.finish()
        })
    });
    HASHES[role as usize]
}

/// The bytes a run counts as: its glyphs, its strings and its entry.
fn bytes_of(key: &Key, run: &Shaped) -> usize {
    std::mem::size_of::<Key>()
        + std::mem::size_of::<Shaped>()
        + key.text.len()
        + run.shown.len()
        + run.glyphs.len() * std::mem::size_of::<Glyph>()
}

/// The acceptance suite's wrong programs (#856), each set only by its `--planted` argument.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// A shaper with no cache: every text is shaped again.
    NoCache,
    /// An ellipsis fit that shapes the whole text again at each step of its search.
    ReshapingFit,
    /// A cache that evicts the run it took in first, however recently it was used.
    EvictsOldest,
}

/// One shaping the shaper did: the run's key and its glyphs.
#[derive(Clone, Debug)]
pub struct Shaping {
    pub key: Arc<Key>,
    pub glyphs: usize,
}

struct Entry {
    run: Arc<Shaped>,
    bytes: usize,
    used: u64,
}

#[derive(Default)]
struct Cache {
    runs: HashMap<Arc<Key>, Entry>,
    /// Runs by their last use, the least recent first.
    order: BTreeMap<u64, Arc<Key>>,
    bytes: usize,
    tick: u64,
    planted: Option<Planted>,
    log: Option<Vec<Shaping>>,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(Mutex::default);

thread_local! {
    static SCOPE: Cell<u64> = const { Cell::new(0) };
}

fn cache() -> MutexGuard<'static, Cache> {
    CACHE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Sets the process's planted program.
pub fn plant(planted: Planted) {
    cache().planted = Some(planted);
}

pub(crate) fn planted() -> Option<Planted> {
    cache().planted
}

/// The planted cache per document: runs this thread shapes from now are keyed apart under `scope`.
pub fn scope(scope: u64) {
    SCOPE.with(|s| s.set(scope));
}

/// Starts recording every shaping, for [`take_log`].
pub fn record() {
    cache().log.get_or_insert_with(Vec::new);
}

/// The shapings since the last call, in order.
pub fn take_log() -> Vec<Shaping> {
    cache().log.as_mut().map(std::mem::take).unwrap_or_default()
}

/// The cache's runs, the bytes it counts them as, and its bound.
pub fn stats() -> (usize, usize, usize) {
    let c = cache();
    (c.runs.len(), c.bytes, BOUND)
}

/// Every run the cache holds of `text`, with its key.
pub fn runs_of(text: &str) -> Vec<(Arc<Key>, Arc<Shaped>)> {
    cache()
        .runs
        .iter()
        .filter(|(k, _)| &*k.text == text)
        .map(|(k, e)| (k.clone(), e.run.clone()))
        .collect()
}

/// Empties the cache: the cost model's cold readings.
pub fn clear() {
    let mut c = cache();
    c.runs.clear();
    c.order.clear();
    c.bytes = 0;
}

/// The run under `key`, marked used.
pub(crate) fn get(key: &Key) -> Option<Arc<Shaped>> {
    let mut c = cache();
    if c.planted == Some(Planted::NoCache) {
        return None;
    }
    c.tick += 1;
    let (tick, lru) = (c.tick, c.planted != Some(Planted::EvictsOldest));
    let entry = c.runs.get_mut(key)?;
    let run = entry.run.clone();
    if lru {
        let was = std::mem::replace(&mut entry.used, tick);
        if let Some(k) = c.order.remove(&was) {
            c.order.insert(tick, k);
        }
    }
    Some(run)
}

/// Whether the cache holds a run under `key`, without marking it used.
pub(crate) fn holds(key: &Key) -> bool {
    let c = cache();
    c.planted != Some(Planted::NoCache) && c.runs.contains_key(key)
}

/// Records a shaping of `key`'s text that gave `glyphs` glyphs.
pub(crate) fn shaped(key: &Key, glyphs: usize) {
    if let Some(log) = cache().log.as_mut() {
        log.push(Shaping {
            key: Arc::new(key.clone()),
            glyphs,
        });
    }
}

/// Keeps `run` under `key` and returns the run the cache holds there: `run`, or the one another
/// shaper put there first, so every holder of a key shares one run. Least recently used runs are
/// evicted until the cache is within its bound; a run larger than the bound isn't kept.
pub(crate) fn put(key: Key, run: Shaped) -> Arc<Shaped> {
    let mut c = cache();
    if c.planted == Some(Planted::NoCache) {
        return Arc::new(run);
    }
    if let Some(entry) = c.runs.get(&key) {
        return entry.run.clone();
    }
    let bytes = bytes_of(&key, &run);
    let run = Arc::new(run);
    if bytes > BOUND {
        return run;
    }
    while c.bytes + bytes > BOUND {
        let Some((_, oldest)) = c.order.pop_first() else {
            break;
        };
        if let Some(e) = c.runs.remove(&oldest) {
            c.bytes -= e.bytes;
        }
    }
    c.tick += 1;
    let tick = c.tick;
    let key = Arc::new(key);
    c.order.insert(tick, key.clone());
    c.runs.insert(
        key,
        Entry {
            run: run.clone(),
            bytes,
            used: tick,
        },
    );
    c.bytes += bytes;
    run
}
