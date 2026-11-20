//! What the app owns, named (#1431; technical design: Numbers version 0 has to hold, "The app's
//! footprint"). Every long-lived cache declares a bound in entries and in bytes and keeps a gauge
//! of both, so a process's footprint splits into its heap, these gauges and the rest
//! (`unaccounted`). A failed or tiny entry counts in entries, which is why a byte bound alone
//! isn't enough. A gauge sums every holder of its kind in the process: each holder adds what it
//! takes and takes away what it frees, and gives back the rest when it's dropped.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Where a gauge's bytes are: in the process's heap, which the allocator's own reading already
/// counts, or outside it (on the GPU, or mapped from the system), where it never sees them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    Heap,
    Device,
}

impl Place {
    pub fn name(self) -> &'static str {
        match self {
            Place::Heap => "heap",
            Place::Device => "device",
        }
    }
}

/// A holder's two bounds: at most this many entries and this many bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Bound {
    pub entries: u64,
    pub bytes: u64,
}

/// One kind of holder's entries and bytes, summed over the process, against its bound.
pub struct Gauge {
    pub name: &'static str,
    pub place: Place,
    pub bound: Bound,
    entries: AtomicU64,
    bytes: AtomicU64,
    listed: AtomicBool,
}

/// Every gauge a holder has used in this process, in the order they were first used.
static LISTED: Mutex<Vec<&'static Gauge>> = Mutex::new(Vec::new());

impl Gauge {
    pub const fn new(name: &'static str, place: Place, entries: u64, bytes: u64) -> Gauge {
        Gauge {
            name,
            place,
            bound: Bound { entries, bytes },
            entries: AtomicU64::new(0),
            bytes: AtomicU64::new(0),
            listed: AtomicBool::new(false),
        }
    }

    fn list(&'static self) {
        if !self.listed.swap(true, Ordering::Relaxed) {
            if let Ok(mut all) = LISTED.lock() {
                all.push(self);
            }
        }
    }

    /// A holder took `entries` entries of `bytes` bytes.
    pub fn add(&'static self, entries: u64, bytes: u64) {
        self.list();
        self.entries.fetch_add(entries, Ordering::Relaxed);
        self.bytes.fetch_add(bytes, Ordering::Relaxed);
    }

    /// A holder freed `entries` entries of `bytes` bytes.
    pub fn sub(&'static self, entries: u64, bytes: u64) {
        let less = |n: u64| move |v: u64| Some(v.saturating_sub(n));
        let _ = self
            .entries
            .try_update(Ordering::Relaxed, Ordering::Relaxed, less(entries));
        let _ = self
            .bytes
            .try_update(Ordering::Relaxed, Ordering::Relaxed, less(bytes));
    }

    /// A holder that keeps its own count, which the gauge mirrors: its entries and bytes now.
    pub fn set(&'static self, entries: u64, bytes: u64) {
        self.list();
        self.entries.store(entries, Ordering::Relaxed);
        self.bytes.store(bytes, Ordering::Relaxed);
    }

    /// Its entries and bytes now.
    pub fn read(&self) -> (u64, u64) {
        (
            self.entries.load(Ordering::Relaxed),
            self.bytes.load(Ordering::Relaxed),
        )
    }
}

/// Every gauge some holder in this process has used.
pub fn all() -> Vec<&'static Gauge> {
    LISTED.lock().map(|all| all.clone()).unwrap_or_default()
}

struct Entry<V> {
    value: V,
    bytes: u64,
    used: u64,
}

/// A long-lived cache held to its gauge's bound: past either bound, the entries used longest ago
/// go first, never one the current turn used (a turn is a frame, a job or a revision, as its
/// holder starts them with [`Kept::turn`]). While one turn alone uses more than the bound, the
/// cache holds just what that turn uses, and its gauge says so.
pub struct Kept<K: Ord, V> {
    gauge: &'static Gauge,
    map: BTreeMap<K, Entry<V>>,
    turn: u64,
    bytes: u64,
}

impl<K: Ord + Clone, V> Kept<K, V> {
    pub fn new(gauge: &'static Gauge) -> Kept<K, V> {
        Kept {
            gauge,
            map: BTreeMap::new(),
            turn: 0,
            bytes: 0,
        }
    }

    /// Starts a turn: what earlier turns used may now be freed.
    pub fn turn(&mut self) {
        self.turn += 1;
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    pub fn contains_key(&self, key: &K) -> bool {
        self.map.contains_key(key)
    }

    /// The entry, without counting it as used.
    pub fn peek(&self, key: &K) -> Option<&V> {
        self.map.get(key).map(|e| &e.value)
    }

    /// The entry, counted as used this turn.
    pub fn get(&mut self, key: &K) -> Option<&V> {
        let turn = self.turn;
        self.map.get_mut(key).map(|e| {
            e.used = turn;
            &e.value
        })
    }

    pub fn get_mut(&mut self, key: &K) -> Option<&mut V> {
        let turn = self.turn;
        self.map.get_mut(key).map(|e| {
            e.used = turn;
            &mut e.value
        })
    }

    /// Counts the entry as used this turn; whether it's held.
    pub fn touch(&mut self, key: &K) -> bool {
        self.get(key).is_some()
    }

    /// Keeps `value` of `bytes` bytes under `key`, used this turn. Nothing is freed until the
    /// holder calls [`Kept::evict`], at the end of its turn.
    pub fn insert(&mut self, key: K, value: V, bytes: u64) {
        let used = self.turn;
        if let Some(old) = self.map.insert(key, Entry { value, bytes, used }) {
            self.bytes -= old.bytes;
            self.gauge.sub(1, old.bytes);
        }
        self.bytes += bytes;
        self.gauge.add(1, bytes);
    }

    pub fn remove(&mut self, key: &K) -> Option<V> {
        let e = self.map.remove(key)?;
        self.bytes -= e.bytes;
        self.gauge.sub(1, e.bytes);
        Some(e.value)
    }

    /// Frees the entries used longest ago, never this turn's, until both bounds hold: those
    /// entries, for their holder to let go of what hangs on them.
    pub fn evict(&mut self) -> Vec<(K, V)> {
        let bound = self.gauge.bound;
        let over = |n: usize, bytes: u64| n as u64 > bound.entries || bytes > bound.bytes;
        if !over(self.map.len(), self.bytes) {
            return Vec::new();
        }
        let mut old: Vec<(u64, K)> = self
            .map
            .iter()
            .filter(|(_, e)| e.used != self.turn)
            .map(|(k, e)| (e.used, k.clone()))
            .collect();
        old.sort_by_key(|(used, _)| *used);
        let mut freed = Vec::new();
        for (_, key) in old {
            if !over(self.map.len(), self.bytes) {
                break;
            }
            if let Some(value) = self.remove(&key) {
                freed.push((key, value));
            }
        }
        freed
    }

    /// Frees every entry `keep` refuses.
    pub fn retain(&mut self, mut keep: impl FnMut(&K, &V) -> bool) {
        let gone: Vec<K> = self
            .map
            .iter()
            .filter(|(k, e)| !keep(k, &e.value))
            .map(|(k, _)| k.clone())
            .collect();
        for key in gone {
            self.remove(&key);
        }
    }

    pub fn clear(&mut self) {
        self.gauge.sub(self.map.len() as u64, self.bytes);
        self.map.clear();
        self.bytes = 0;
    }

    pub fn iter(&self) -> impl Iterator<Item = (&K, &V)> {
        self.map.iter().map(|(k, e)| (k, &e.value))
    }

    pub fn values(&self) -> impl Iterator<Item = &V> {
        self.map.values().map(|e| &e.value)
    }
}

impl<K: Ord, V> Drop for Kept<K, V> {
    fn drop(&mut self) {
        self.gauge.sub(self.map.len() as u64, self.bytes);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static SMALL: Gauge = Gauge::new("test.small", Place::Heap, 3, 100);
    static TOTALS: Gauge = Gauge::new("test.totals", Place::Device, 10, 1_000);

    #[test]
    fn frees_the_oldest_unused_past_either_bound() {
        let mut k: Kept<u32, &str> = Kept::new(&SMALL);
        for (n, key) in [1, 2, 3].into_iter().enumerate() {
            k.turn();
            k.insert(key, "x", 10 * n as u64);
            assert!(k.evict().is_empty());
        }
        k.turn();
        k.touch(&1);
        // A fourth entry passes the entry bound: 2, used longest ago and not this turn, goes.
        k.insert(4, "y", 5);
        let freed: Vec<u32> = k.evict().into_iter().map(|(k, _)| k).collect();
        assert_eq!(freed, vec![2]);
        assert_eq!((k.len(), k.bytes()), (3, 25));
        // Past the byte bound, never this turn's entries: 3 goes, then 1 and 4 stay over it.
        k.insert(5, "z", 200);
        let freed: Vec<u32> = k.evict().into_iter().map(|(k, _)| k).collect();
        assert_eq!(freed, vec![3]);
        assert_eq!(k.len(), 3);
        assert_eq!(SMALL.read(), (3, 205));
        drop(k);
        assert_eq!(SMALL.read(), (0, 0));
    }

    #[test]
    fn a_gauge_sums_its_holders_and_lists_itself_once_used() {
        TOTALS.add(2, 300);
        TOTALS.add(1, 50);
        assert_eq!(TOTALS.read(), (3, 350));
        TOTALS.sub(5, 5_000);
        assert_eq!(TOTALS.read(), (0, 0));
        TOTALS.set(4, 40);
        assert_eq!(TOTALS.read(), (4, 40));
        assert_eq!(all().iter().filter(|g| g.name == "test.totals").count(), 1);
    }
}
