//! Issue #856: the shaped-run cache. Its host owns one and lends it to every shaper it makes
//! ([`Shaper::sharing`](crate::Shaper::sharing)), so every shaper and every document the host
//! serves shares it: a text is shaped once per (text, font hash, size, features, width, max lines)
//! and its run reused after (canvas primitives: Text `text@1`, "Shaped once per …"). It holds runs
//! up to [`BOUND`] bytes and evicts the least recently used past it. A run a document still draws
//! stays alive in that document; eviction only drops the cache's own hold. A shaper made with
//! [`Shaper::new`](crate::Shaper::new) has a cache of its own.

use std::collections::hash_map::DefaultHasher;
use std::collections::BTreeMap;
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use parley::fontique::Blob;
use parley::FontData;

use crate::fonts::{self, Face, FACES};
use crate::shape::{Shaped, Span, Spec};

/// The bytes the cache may hold runs for.
pub const BOUND: usize = 32 << 20;

/// A run's key: the text and everything its shape depends on. `fitted` marks a text's run cut to
/// its box with an ellipsis, kept apart from the run of the whole text. Ordered, so the cache's
/// runs iterate in one order in every process.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
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
    /// #1964: the hash of its styled spans, 0 with none.
    spans: u64,
    /// Nonzero only under the planted cache per document.
    scope: u64,
}

/// The hash of a run's styled spans (#1964).
fn spans_hash(spans: &[Span]) -> u64 {
    if spans.is_empty() {
        return 0;
    }
    let mut h = DefaultHasher::new();
    spans.hash(&mut h);
    h.finish()
}

impl Key {
    pub(crate) fn of(cache: &RunCache, spec: &Spec<'_>, text: &str, fitted: bool) -> Key {
        Key {
            spans: spans_hash(spec.spans),
            text: text.into(),
            font: font_hash(cache.face_hashes(), spec.family, spec.fallback, spec.lang),
            size: spec.size.to_bits(),
            features: (spec.weight, spec.tabular, spec.line_height().to_bits()),
            // A bound value is never wrapped, so its box doesn't change its run.
            width: spec.width.filter(|_| !spec.bound).map(f32::to_bits),
            max_lines: spec.max_lines,
            align: spec.align as u8,
            bound: spec.bound,
            mask: spec.mask,
            fitted,
            scope: cache.state().scope,
        }
    }

    /// The text the run is of.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// The hash of the bundled faces a run picks from: its family's by weight, then each fallback
/// family's in order (#417), with the language it is shaped in. `faces` is each face's hash.
fn font_hash(faces: &[u64], family: &str, fallback: &[&str], lang: Option<&str>) -> u64 {
    let mut h = DefaultHasher::new();
    for name in std::iter::once(&family).chain(fallback) {
        name.hash(&mut h);
        for (face, hash) in FACES.iter().zip(faces) {
            if face.family == *name {
                hash.hash(&mut h);
            }
        }
    }
    lang.hash(&mut h);
    h.finish()
}

/// What each part of a run counts as in the cache's bound, in bytes: its size on the 64-bit
/// targets the bound was set on (a key 72, a run 96, a glyph 80, a decoration 24), the same on
/// every target, so a run counts alike wherever it is shaped.
const KEY_BYTES: usize = 72;
const RUN_BYTES: usize = 96;
const GLYPH_BYTES: usize = 80;
const DECORATION_BYTES: usize = 24;

/// The bytes a run counts as: its glyphs, its strings and its entry.
fn bytes_of(key: &Key, run: &Shaped) -> usize {
    KEY_BYTES
        + RUN_BYTES
        + key.text.len()
        + run.shown.len()
        + run.glyphs.len() * GLYPH_BYTES
        + run.decorations.len() * DECORATION_BYTES
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
    runs: BTreeMap<Arc<Key>, Entry>,
    /// Runs by their last use, the least recent first.
    order: BTreeMap<u64, Arc<Key>>,
    bytes: usize,
    tick: u64,
    planted: Option<Planted>,
    log: Option<Vec<Shaping>>,
    /// Nonzero only under the planted cache per document: the scope runs shaped from now are
    /// keyed apart under.
    scope: u64,
}

/// The shaped-run cache a host owns, with the bundled faces as one set of blobs every shaper it
/// lends the cache to registers: a glyph's font is then known by its blob, and the glyph atlas
/// keys a glyph alike whichever shaper shaped it.
pub struct RunCache {
    state: Mutex<Cache>,
    /// Each bundled face's blob, in [`FACES`]'s order.
    blobs: Vec<Blob<u8>>,
    /// Each face's hash (its weight and bytes), computed the first time a key needs it: the CJK
    /// face alone is megabytes.
    face_hashes: OnceLock<Vec<u64>>,
}

impl Default for RunCache {
    fn default() -> Self {
        RunCache {
            state: Mutex::default(),
            blobs: FACES.iter().map(fonts::blob).collect(),
            face_hashes: OnceLock::new(),
        }
    }
}

impl RunCache {
    fn state(&self) -> MutexGuard<'_, Cache> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn face_hashes(&self) -> &[u64] {
        self.face_hashes.get_or_init(|| {
            FACES
                .iter()
                .map(|face| {
                    let mut h = DefaultHasher::new();
                    face.weight.hash(&mut h);
                    face.bytes.hash(&mut h);
                    h.finish()
                })
                .collect()
        })
    }

    /// The bundled faces' blobs, which a shaper this cache is lent to registers.
    pub(crate) fn blobs(&self) -> &[Blob<u8>] {
        &self.blobs
    }

    /// The bundled face `font` is: the face whose blob, made from that face's bytes, it holds.
    pub fn face(&self, font: &FontData) -> Option<&'static Face> {
        let i = self.blobs.iter().position(|b| b.id() == font.data.id())?;
        FACES.get(i)
    }

    /// Sets the cache's planted program.
    pub fn plant(&self, planted: Planted) {
        self.state().planted = Some(planted);
    }

    pub(crate) fn planted(&self) -> Option<Planted> {
        self.state().planted
    }

    /// The planted cache per document: runs shaped from now are keyed apart under `scope`.
    pub fn scope(&self, scope: u64) {
        self.state().scope = scope;
    }

    /// Starts recording every shaping, for [`RunCache::take_log`].
    pub fn record(&self) {
        self.state().log.get_or_insert_with(Vec::new);
    }

    /// The shapings since the last call, in order.
    pub fn take_log(&self) -> Vec<Shaping> {
        self.state()
            .log
            .as_mut()
            .map(std::mem::take)
            .unwrap_or_default()
    }

    /// The cache's runs, the bytes it counts them as, and its bound.
    pub fn stats(&self) -> (usize, usize, usize) {
        let c = self.state();
        (c.runs.len(), c.bytes, BOUND)
    }

    /// Every run the cache holds of `text`, with its key.
    pub fn runs_of(&self, text: &str) -> Vec<(Arc<Key>, Arc<Shaped>)> {
        self.state()
            .runs
            .iter()
            .filter(|(k, _)| &*k.text == text)
            .map(|(k, e)| (k.clone(), e.run.clone()))
            .collect()
    }

    /// Empties the cache: the cost model's cold readings.
    pub fn clear(&self) {
        let mut c = self.state();
        c.runs.clear();
        c.order.clear();
        c.bytes = 0;
    }

    /// Whether `spec`'s run is in the cache, so shaping it now costs a lookup.
    pub fn is_cached(&self, spec: &Spec<'_>) -> bool {
        self.holds(&Key::of(self, spec, spec.text, true))
            || self.holds(&Key::of(self, spec, spec.text, false))
    }

    /// The run under `key`, marked used.
    pub(crate) fn get(&self, key: &Key) -> Option<Arc<Shaped>> {
        let mut c = self.state();
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
    pub(crate) fn holds(&self, key: &Key) -> bool {
        let c = self.state();
        c.planted != Some(Planted::NoCache) && c.runs.contains_key(key)
    }

    /// Records a shaping of `key`'s text that gave `glyphs` glyphs.
    pub(crate) fn shaped(&self, key: &Key, glyphs: usize) {
        if let Some(log) = self.state().log.as_mut() {
            log.push(Shaping {
                key: Arc::new(key.clone()),
                glyphs,
            });
        }
    }

    /// Keeps `run` under `key` and returns the run the cache holds there: `run`, or the one
    /// another shaper put there first, so every holder of a key shares one run. Least recently
    /// used runs are evicted until the cache is within its bound; a run larger than the bound
    /// isn't kept.
    pub(crate) fn put(&self, key: Key, run: Shaped) -> Arc<Shaped> {
        let mut c = self.state();
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
}
