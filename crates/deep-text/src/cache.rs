//! Issue #856: the shaped-run cache, one per process, shared by every shaper and so by every
//! document. Issue #1430 splits it in two (canvas primitives: Text `text@1`, "Shaped once per …").
//! The shape cache keeps each paragraph of a text shaped once per its shape key (text, font hash,
//! size, features), not yet broken into lines; the run cache keeps a text's laid-out run per its
//! layout key, the shape key plus width, line limit and alignment. A new width breaks lines again
//! from paragraphs already shaped, and a typed character shapes only the paragraph it is in. Each
//! cache holds up to [`ENTRIES`] entries and [`BOUND`] bytes, evicts the least recently used past
//! either, and counts its hits and misses. A run a document still draws stays alive in that
//! document; eviction only drops the cache's own hold.

use std::cell::Cell;
use std::collections::hash_map::DefaultHasher;
use std::collections::{BTreeMap, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

use crate::fonts::FACES;
use crate::shape::{Glyph, Paragraph, Shaped, Span, Spec};

/// The bytes each cache may hold entries for.
pub const BOUND: usize = 32 << 20;

/// The entries each cache may hold, so many small ones can't stay under the byte bound alone.
pub const ENTRIES: usize = 1 << 16;

/// What a paragraph's glyphs depend on (#1430): its text, its font, its size and its features.
/// #1484: the variation coordinates it is set at follow from its faces, size and weight and its
/// spans', all here.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ShapeKey {
    text: Box<str>,
    font: u64,
    size: u32,
    /// Weight, tabular figures and line height.
    features: (u16, bool, u32),
    /// #1964: the hash of its styled spans, 0 with none.
    spans: u64,
    /// The whole text's base direction, which each of its paragraphs is shaped in.
    rtl: bool,
    /// Set only under the planted shape key that holds the width.
    width: Option<u32>,
    /// Nonzero only under the planted cache per document.
    scope: u64,
}

impl ShapeKey {
    pub(crate) fn of(spec: &Spec<'_>, text: &str, spans: &[Span], rtl: bool) -> ShapeKey {
        let planted = planted();
        ShapeKey {
            text: text.into(),
            font: if planted == Some(Planted::Fontless) {
                0
            } else {
                font_hash(spec.family, spec.fallback, spec.lang)
            },
            size: spec.size.to_bits(),
            features: (spec.weight, spec.tabular, spec.line_height().to_bits()),
            spans: spans_hash(spans),
            rtl,
            width: spec
                .width
                .filter(|_| planted == Some(Planted::WidthKeyed))
                .map(f32::to_bits),
            scope: SCOPE.with(Cell::get),
        }
    }

    /// The text that was shaped.
    pub fn text(&self) -> &str {
        &self.text
    }
}

/// A run's key: its text's shape key and what its lines depend on. `fitted` marks a text's run cut
/// to its box with an ellipsis, kept apart from the run of the whole text.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Key {
    shape: ShapeKey,
    width: Option<u32>,
    max_lines: Option<u16>,
    align: u8,
    bound: bool,
    mask: bool,
    fitted: bool,
    /// #1966: the gap after each paragraph, and the indent every line starts at.
    gap: u32,
    indent: u32,
    /// #1215: the flow (0 across, 1 columns right to left, 2 left to right), `upright: all`,
    /// `combine_upright`, the column's length, and the planted vertical shaper.
    flow: (u8, bool, u8, Option<u32>, u8),
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
    pub(crate) fn of(spec: &Spec<'_>, text: &str, fitted: bool) -> Key {
        Key {
            shape: ShapeKey::of(spec, text, spec.spans, crate::shape::rtl(text)),
            // A bound value is never wrapped, so its box doesn't change its run.
            width: spec.width.filter(|_| !spec.bound).map(f32::to_bits),
            max_lines: spec.max_lines,
            align: spec.align as u8,
            bound: spec.bound,
            mask: spec.mask,
            fitted,
            gap: spec.gap.to_bits(),
            indent: spec.indent.to_bits(),
            flow: match spec.flow {
                crate::Flow::Horizontal => (0, false, 0, None, 0),
                crate::Flow::Vertical(c) => (
                    if c.rl { 1 } else { 2 },
                    c.upright,
                    c.combine,
                    c.height.filter(|_| !spec.bound).map(f32::to_bits),
                    crate::vertical::planted().bits(),
                ),
            },
        }
    }

    /// The text the run is of.
    pub fn text(&self) -> &str {
        &self.shape.text
    }

    /// The shape key of the run's text: a one-paragraph text's run was shaped under it.
    pub fn shape(&self) -> &ShapeKey {
        &self.shape
    }
}

/// The hash of the bundled faces a run picks from: its family's by weight, then each fallback
/// family's in order (#417), each set in its variable twin where one is bundled (#1484), with the
/// language it is shaped in.
fn font_hash(family: &str, fallback: &[&str], lang: Option<&str>) -> u64 {
    // Each face's bytes hashed once per process: the CJK face alone is megabytes.
    static FACE_HASHES: LazyLock<Vec<u64>> = LazyLock::new(|| {
        FACES
            .iter()
            .map(|face| {
                let mut h = DefaultHasher::new();
                face.weight.hash(&mut h);
                face.bytes().hash(&mut h);
                h.finish()
            })
            .collect()
    });
    let mut h = DefaultHasher::new();
    for name in std::iter::once(&family).chain(fallback) {
        name.hash(&mut h);
        let shaped = crate::fonts::shaped_in(name);
        for (face, hash) in FACES.iter().zip(FACE_HASHES.iter()) {
            if face.family == shaped {
                hash.hash(&mut h);
            }
        }
    }
    lang.hash(&mut h);
    h.finish()
}

/// The bytes a run counts as: its glyphs, its strings and its entry.
fn run_bytes(key: &Key, run: &Shaped) -> usize {
    std::mem::size_of::<Key>()
        + std::mem::size_of::<Shaped>()
        + key.shape.text.len()
        + run.shown.len()
        + run.glyphs.len() * std::mem::size_of::<Glyph>()
        + run.decorations.len() * std::mem::size_of::<crate::shape::Decoration>()
}

/// The acceptance suites' wrong programs (#856, #1430), each set only by its `--planted` argument.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// A shaper with no cache: every text is shaped again.
    NoCache,
    /// An ellipsis fit that shapes the whole text again at each step of its search.
    ReshapingFit,
    /// Caches that evict the entry they took in first, however recently it was used.
    EvictsOldest,
    /// #1430: a shape key that holds the width, so each new width shapes every paragraph again.
    WidthKeyed,
    /// #1430: keys without the font, so a text shaped in one font is reused for another.
    Fontless,
    /// #1430: a text shaped as one paragraph, so a typed character shapes all of it again.
    WholeText,
}

/// One shaping the shaper did: the paragraph's shape key and the glyphs it gave.
#[derive(Clone, Debug)]
pub struct Shaping {
    pub key: Arc<ShapeKey>,
    pub glyphs: usize,
}

/// One cache's reading: the entries it holds, the bytes it counts them as, its bound, and the
/// lookups that found an entry and that didn't since the process started.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    pub entries: usize,
    pub bytes: usize,
    pub bound: usize,
    pub hits: u64,
    pub misses: u64,
}

struct Entry<V> {
    value: Arc<V>,
    bytes: usize,
    used: u64,
}

/// Up to [`ENTRIES`] entries and [`BOUND`] bytes, by their last use.
struct Lru<K, V> {
    entries: HashMap<Arc<K>, Entry<V>>,
    /// Keys by their last use, the least recent first.
    order: BTreeMap<u64, Arc<K>>,
    bytes: usize,
    hits: u64,
    misses: u64,
}

impl<K, V> Default for Lru<K, V> {
    fn default() -> Self {
        Lru {
            entries: Default::default(),
            order: BTreeMap::new(),
            bytes: 0,
            hits: 0,
            misses: 0,
        }
    }
}

impl<K: Hash + Eq, V> Lru<K, V> {
    /// The entry under `key`, marked used at `tick` unless `lru` is off.
    fn get(&mut self, key: &K, tick: u64, lru: bool) -> Option<Arc<V>> {
        let Some(entry) = self.entries.get_mut(key) else {
            self.misses += 1;
            return None;
        };
        self.hits += 1;
        let value = entry.value.clone();
        if lru {
            let was = std::mem::replace(&mut entry.used, tick);
            if let Some(k) = self.order.remove(&was) {
                self.order.insert(tick, k);
            }
        }
        Some(value)
    }

    /// Keeps `value` under `key` and returns the value held there: `value`, or the one another
    /// shaper put there first, so every holder of a key shares one. The least recently used are
    /// evicted until the cache is within its bounds; a value larger than the bound isn't kept.
    fn put(&mut self, key: K, value: V, bytes: usize, tick: u64) -> Arc<V> {
        if let Some(entry) = self.entries.get(&key) {
            return entry.value.clone();
        }
        let value = Arc::new(value);
        if bytes > BOUND {
            return value;
        }
        while self.bytes + bytes > BOUND || self.entries.len() >= ENTRIES {
            let Some((_, oldest)) = self.order.pop_first() else {
                break;
            };
            if let Some(e) = self.entries.remove(&oldest) {
                self.bytes -= e.bytes;
            }
        }
        let key = Arc::new(key);
        self.order.insert(tick, key.clone());
        self.entries.insert(
            key,
            Entry {
                value: value.clone(),
                bytes,
                used: tick,
            },
        );
        self.bytes += bytes;
        value
    }

    fn clear(&mut self) {
        self.entries.clear();
        self.order.clear();
        self.bytes = 0;
    }

    fn stats(&self) -> Stats {
        Stats {
            entries: self.entries.len(),
            bytes: self.bytes,
            bound: BOUND,
            hits: self.hits,
            misses: self.misses,
        }
    }
}

#[derive(Default)]
struct Cache {
    runs: Lru<Key, Shaped>,
    shapes: Lru<ShapeKey, Paragraph>,
    tick: u64,
    planted: Option<Planted>,
    log: Option<Vec<Shaping>>,
}

impl Cache {
    fn next(&mut self) -> (u64, bool) {
        self.tick += 1;
        (self.tick, self.planted != Some(Planted::EvictsOldest))
    }

    fn off(&self) -> bool {
        self.planted == Some(Planted::NoCache)
    }
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

/// The run cache's reading, then the shape cache's.
pub fn stats() -> (Stats, Stats) {
    let c = cache();
    (c.runs.stats(), c.shapes.stats())
}

/// Every run the cache holds of `text`, with its key.
pub fn runs_of(text: &str) -> Vec<(Arc<Key>, Arc<Shaped>)> {
    cache()
        .runs
        .entries
        .iter()
        .filter(|(k, _)| k.text() == text)
        .map(|(k, e)| (k.clone(), e.value.clone()))
        .collect()
}

/// Empties both caches: the cost model's cold readings.
pub fn clear() {
    let mut c = cache();
    c.runs.clear();
    c.shapes.clear();
}

/// The run under `key`, marked used.
pub(crate) fn get(key: &Key) -> Option<Arc<Shaped>> {
    let mut c = cache();
    if c.off() {
        return None;
    }
    let (tick, lru) = c.next();
    c.runs.get(key, tick, lru)
}

/// Whether the cache holds a run under `key`, without marking it used.
pub(crate) fn holds(key: &Key) -> bool {
    let c = cache();
    !c.off() && c.runs.entries.contains_key(key)
}

/// Keeps `run` under `key` and returns the run the cache holds there (see [`Lru::put`]).
pub(crate) fn put(key: Key, run: Shaped) -> Arc<Shaped> {
    let mut c = cache();
    if c.off() {
        return Arc::new(run);
    }
    let bytes = run_bytes(&key, &run);
    let (tick, _) = c.next();
    c.runs.put(key, run, bytes, tick)
}

/// The shaped paragraph under `key`, marked used.
pub(crate) fn paragraph(key: &ShapeKey) -> Option<Arc<Paragraph>> {
    let mut c = cache();
    if c.off() {
        return None;
    }
    let (tick, lru) = c.next();
    c.shapes.get(key, tick, lru)
}

/// Keeps a paragraph shaped under `key` and returns the one the cache holds there.
pub(crate) fn keep(key: ShapeKey, paragraph: Paragraph) -> Arc<Paragraph> {
    let mut c = cache();
    if c.off() {
        return Arc::new(paragraph);
    }
    let bytes = paragraph.bytes(&key.text);
    let (tick, _) = c.next();
    c.shapes.put(key, paragraph, bytes, tick)
}

/// Records a shaping of `key`'s text that gave `glyphs` glyphs.
pub(crate) fn shaped(key: &ShapeKey, glyphs: usize) {
    if let Some(log) = cache().log.as_mut() {
        log.push(Shaping {
            key: Arc::new(key.clone()),
            glyphs,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::{Lru, ENTRIES};

    #[test]
    fn small_entries_stay_within_the_entry_bound() {
        let mut lru: Lru<usize, ()> = Lru::default();
        for k in 0..=ENTRIES {
            lru.put(k, (), 1, k as u64);
        }
        assert_eq!(lru.entries.len(), ENTRIES, "{} bytes held", lru.bytes);
        assert!(
            !lru.entries.contains_key(&0),
            "the least recently used goes"
        );
    }
}
