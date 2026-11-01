//! A hash tree over keys in order (#896; Invalidation and damage: "CPU O(dirty)"): its root
//! commits to every key and its place, and replacing keys rehashes only their chunks and the
//! paths above them, so a document's key and a writer layer's key follow a one-item change
//! without a pass over every item.
//!
//! The keys go in chunks of [`CHUNK`], each hashed (`hash@2`) as one run of bytes; above the
//! chunks each level holds the hash of each pair below it, and a level's odd last entry moves up
//! unhashed. The keys also sit in blocks of [`BLOCK`], each its own subtree, shared between the
//! trees cloned from one another, so a clone that replaces one key copies one block, not every
//! key. A block is a power of two chunks, so its subtree is the whole tree's above its chunks and
//! the root is the same.

use std::sync::Arc;

use super::{HashVersion, Hasher, Key};

const CHUNK: usize = 64;
const BLOCK: usize = 16 * CHUNK;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KeyTree {
    blocks: Vec<Arc<Block>>,
    /// The tree over the blocks' roots.
    top: Levels,
}

/// One block's keys and the tree over its chunks.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Block {
    keys: Vec<Key>,
    levels: Levels,
}

/// A tree's levels, its leaves first.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Levels(Vec<Vec<Key>>);

fn chunk(keys: &[Key]) -> Key {
    let bytes: Vec<u8> = keys.iter().flat_map(|k| k.0).collect();
    Hasher::of(HashVersion::V2, "chunk").bytes(&bytes).finish()
}

fn pair(a: &Key, b: &Key) -> Key {
    Hasher::of(HashVersion::V2, "tree").key(a).key(b).finish()
}

fn up(below: &[Key], at: usize) -> Key {
    let left = at * 2;
    match below.get(left + 1) {
        Some(b) => pair(&below[left], b),
        None => below[left],
    }
}

impl Levels {
    fn new(leaves: Vec<Key>) -> Levels {
        let mut levels = vec![leaves];
        while levels.last().is_some_and(|l| l.len() > 1) {
            let below = levels.last().expect("a level");
            let next = (0..below.len().div_ceil(2)).map(|i| up(below, i)).collect();
            levels.push(next);
        }
        Levels(levels)
    }

    fn root(&self) -> Key {
        match self.0.last() {
            Some(top) if top.len() == 1 => top[0],
            _ => Key::default(),
        }
    }

    /// Rehashes the paths above the leaves at `dirty`, sorted and without repeats.
    fn rehash(&mut self, mut dirty: Vec<usize>) {
        for level in 1..self.0.len() {
            dirty.iter_mut().for_each(|i| *i /= 2);
            dirty.dedup();
            for &i in &dirty {
                self.0[level][i] = up(&self.0[level - 1], i);
            }
        }
    }
}

impl Block {
    fn new(keys: Vec<Key>) -> Block {
        let levels = Levels::new(keys.chunks(CHUNK).map(chunk).collect());
        Block { keys, levels }
    }

    /// Puts each key at its place in the block and rehashes their chunks and paths once.
    fn update(&mut self, keys: &[(usize, Key)]) {
        let mut dirty: Vec<usize> = Vec::with_capacity(keys.len());
        for &(at, key) in keys {
            self.keys[at] = key;
            dirty.push(at / CHUNK);
        }
        dirty.sort_unstable();
        dirty.dedup();
        for &c in &dirty {
            let end = ((c + 1) * CHUNK).min(self.keys.len());
            self.levels.0[0][c] = chunk(&self.keys[c * CHUNK..end]);
        }
        self.levels.rehash(dirty);
    }
}

impl KeyTree {
    pub fn new(keys: Vec<Key>) -> KeyTree {
        let blocks: Vec<Arc<Block>> = keys
            .chunks(BLOCK)
            .map(|c| Arc::new(Block::new(c.to_vec())))
            .collect();
        let top = Levels::new(blocks.iter().map(|b| b.levels.root()).collect());
        KeyTree { blocks, top }
    }

    /// How many keys it holds.
    pub fn len(&self) -> usize {
        self.blocks.iter().map(|b| b.keys.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// The key at `at`.
    pub fn get(&self, at: usize) -> Option<Key> {
        self.blocks.get(at / BLOCK)?.keys.get(at % BLOCK).copied()
    }

    /// The root: the hash of the top pair, or of the one chunk; the zero key for no keys.
    pub fn root(&self) -> Key {
        self.top.root()
    }

    /// Puts `key` at `at` and rehashes its chunk and the path above it.
    pub fn set(&mut self, at: usize, key: Key) {
        self.update(&[(at, key)]);
    }

    /// Puts each key at its place, rehashing each chunk and each node above them once, however
    /// many keys share it: a pass over every key costs what building the tree does.
    pub fn update(&mut self, keys: &[(usize, Key)]) {
        let mut keys: Vec<(usize, Key)> = keys
            .iter()
            .copied()
            .filter(|&(at, key)| self.get(at) != Some(key))
            .collect();
        if keys.is_empty() {
            return;
        }
        keys.sort_unstable_by_key(|&(at, _)| at);
        let mut dirty = Vec::new();
        for run in keys.chunk_by(|a, b| a.0 / BLOCK == b.0 / BLOCK) {
            let b = run[0].0 / BLOCK;
            let local: Vec<(usize, Key)> = run.iter().map(|&(at, k)| (at % BLOCK, k)).collect();
            let block = Arc::make_mut(&mut self.blocks[b]);
            block.update(&local);
            self.top.0[0][b] = block.levels.root();
            dirty.push(b);
        }
        self.top.rehash(dirty);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys(n: usize, salt: u8) -> Vec<Key> {
        (0..n)
            .map(|i| {
                Hasher::new("leaf")
                    .int(i as i64)
                    .int(i64::from(salt))
                    .finish()
            })
            .collect()
    }

    /// The tree over all keys at once, chunk by chunk and then pair by pair, with no blocks.
    fn flat(keys: &[Key]) -> Key {
        fn pairs(level: &[Key]) -> Key {
            match level.len() {
                0 => Key::default(),
                1 => level[0],
                _ => pairs(
                    &level
                        .chunks(2)
                        .map(|c| {
                            if c.len() == 2 {
                                pair(&c[0], &c[1])
                            } else {
                                c[0]
                            }
                        })
                        .collect::<Vec<_>>(),
                ),
            }
        }
        pairs(&keys.chunks(CHUNK).map(chunk).collect::<Vec<_>>())
    }

    /// Replacing keys, one at a time or many at once, gives the root a tree over those keys
    /// has, built at once and without blocks, at sizes below, at and past a chunk and a block.
    #[test]
    fn replaced_keys_root_the_tree_as_one_over_every_key_does() {
        for n in [1, 2, 3, 63, 64, 65, 100, 1023, 1024, 1025, 3000] {
            let (from, to) = (keys(n, 0), keys(n, 1));
            let mut tree = KeyTree::new(from.clone());
            assert_eq!(tree.root(), flat(&from), "n {n}");
            let mut now = from.clone();
            for i in (0..n).step_by(n / 7 + 1).chain([n - 1]) {
                tree.set(i, to[i]);
                now[i] = to[i];
                assert_eq!(tree.root(), flat(&now), "n {n}, set {i}");
                assert_eq!(tree.get(i), Some(to[i]));
            }
            let mut all = KeyTree::new(from);
            let every: Vec<(usize, Key)> = to.iter().copied().enumerate().rev().collect();
            all.update(&every);
            assert_eq!(all.root(), flat(&to), "n {n}, every key at once");
            assert_eq!(all.len(), n);
        }
    }

    /// The root moves with any one key and with the order, and a clone's change leaves the tree
    /// it came from alone.
    #[test]
    fn the_root_commits_to_every_key_and_its_place() {
        let base = keys(2100, 0);
        let tree = KeyTree::new(base.clone());
        let root = tree.root();
        for i in [0, 1, 63, 64, 1023, 1024, 2099] {
            let mut other = tree.clone();
            other.set(i, keys(2100, 1)[i]);
            assert_ne!(other.root(), root, "key {i}");
            assert_eq!(tree.root(), root, "the clone's change stays its own");
        }
        let mut swapped = base.clone();
        swapped.swap(2, 3);
        assert_ne!(KeyTree::new(swapped).root(), root);
        assert_ne!(
            KeyTree::new(base[..2].to_vec()).root(),
            KeyTree::new(base[..1].to_vec()).root()
        );
        assert_eq!(KeyTree::new(Vec::new()).root(), Key::default());
    }
}
