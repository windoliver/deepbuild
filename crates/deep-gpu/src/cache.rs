//! The core's results by content key (issue #379; canvas primitives: Content key). Equal keys
//! share one result, allocated once on the device; it lives while a current or pending revision
//! reads it, and its memory counts in full against every writer whose revisions read it. A
//! refused, superseded or failed revision leaves nothing behind.

use std::collections::BTreeMap;

/// The wrong caches, each reachable only through a binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A shared result counts against its first holder alone.
    pub charges_first_holder: bool,
    /// Results no revision reads are kept.
    pub keeps_unread: bool,
}

/// A revision that reads results: its writer and a number unique in the process.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reader {
    pub revision: u64,
    pub writer: String,
}

pub struct Entry<R> {
    pub result: R,
    /// What the device reports for the result's allocations, or `None` where it can't say.
    pub bytes: Option<u64>,
    /// The revisions that read it, the first holder first.
    readers: Vec<Reader>,
}

pub struct Cache<R> {
    entries: BTreeMap<String, Entry<R>>,
    planted: Planted,
}

impl<R> Cache<R> {
    pub fn new(planted: Planted) -> Self {
        Cache {
            entries: BTreeMap::new(),
            planted,
        }
    }

    /// `reader` reads the result at `key`, made by `make` (with its device size) when no revision
    /// holds it yet.
    pub fn read(
        &mut self,
        key: &str,
        reader: &Reader,
        make: impl FnOnce() -> Result<(R, Option<u64>), String>,
    ) -> Result<(), String> {
        if let Some(e) = self.entries.get_mut(key) {
            if !e.readers.contains(reader) {
                e.readers.push(reader.clone());
            }
            return Ok(());
        }
        let (result, bytes) = make()?;
        self.entries.insert(
            key.to_string(),
            Entry {
                result,
                bytes,
                readers: vec![reader.clone()],
            },
        );
        Ok(())
    }

    /// The revision no longer reads anything: each result no revision reads any more is freed.
    pub fn release(&mut self, revision: u64) {
        for e in self.entries.values_mut() {
            e.readers.retain(|r| r.revision != revision);
        }
        if !self.planted.keeps_unread {
            self.entries.retain(|_, e| !e.readers.is_empty());
        }
    }

    pub fn get(&self, key: &str) -> Option<&R> {
        self.entries.get(key).map(|e| &e.result)
    }

    /// The results counted against `writer`, by key with their bytes: every one a revision of its
    /// reads, each in full.
    pub fn charged<'a>(
        &'a self,
        writer: &'a str,
    ) -> impl Iterator<Item = (&'a str, Option<u64>)> + 'a {
        let first = self.planted.charges_first_holder;
        self.entries.iter().filter_map(move |(k, e)| {
            let holds = if first {
                e.readers.first().is_some_and(|r| r.writer == writer)
            } else {
                e.readers.iter().any(|r| r.writer == writer)
            };
            holds.then_some((k.as_str(), e.bytes))
        })
    }

    /// How many results the cache holds and their bytes (`None` when one can't be sized).
    pub fn totals(&self) -> (usize, Option<u64>) {
        let bytes = self
            .entries
            .values()
            .try_fold(0u64, |s, e| Some(s + e.bytes?));
        (self.entries.len(), bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader(revision: u64, writer: &str) -> Reader {
        Reader {
            revision,
            writer: writer.into(),
        }
    }

    #[test]
    fn equal_keys_share_one_result_counted_in_full_against_each_writer() {
        let mut c: Cache<u32> = Cache::new(Planted::default());
        let mut made = 0;
        for (rev, w) in [(1, "a"), (2, "b")] {
            c.read("k", &reader(rev, w), || {
                made += 1;
                Ok((7, Some(100)))
            })
            .unwrap();
        }
        assert_eq!(made, 1);
        assert_eq!(c.charged("b").collect::<Vec<_>>(), vec![("k", Some(100))]);
        c.release(1);
        assert_eq!(c.charged("b").collect::<Vec<_>>(), vec![("k", Some(100))]);
        assert_eq!(c.totals(), (1, Some(100)));
        c.release(2);
        assert_eq!(c.totals(), (0, Some(0)));
    }

    #[test]
    fn the_planted_caches_fail_as_their_names_say() {
        let mut first: Cache<u32> = Cache::new(Planted {
            charges_first_holder: true,
            ..Planted::default()
        });
        first
            .read("k", &reader(1, "a"), || Ok((7, Some(100))))
            .unwrap();
        first
            .read("k", &reader(2, "b"), || Ok((7, Some(100))))
            .unwrap();
        assert_eq!(first.charged("b").count(), 0);
        let mut keeps: Cache<u32> = Cache::new(Planted {
            keeps_unread: true,
            ..Planted::default()
        });
        keeps
            .read("k", &reader(1, "a"), || Ok((7, Some(100))))
            .unwrap();
        keeps.release(1);
        assert_eq!(keeps.totals(), (1, Some(100)));
    }
}
