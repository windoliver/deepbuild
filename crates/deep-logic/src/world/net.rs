//! #550: what the net module reads of a world and plants in it: a hash for each field of each
//! item's carried state, each item's step hash, its bytes and state as the full-state hash takes
//! them, and a planted defect's write into its memory.

use super::*;

impl World {
    /// #550: a hash for each field of each item's carried state, `(field, hash)` in the piece's
    /// order: `<item>.<write>` for each array, then `<item>.globals` and `<item>.memory`.
    pub fn field_hashes(&mut self) -> Vec<(String, u64)> {
        let mut out = Vec::new();
        for (item, l) in self.piece.items.iter().zip(self.lives.iter_mut()) {
            for w in &item.writes {
                let e = item.write(&w.name).expect("a write entry");
                let bytes = &l.arrays[e.offset as usize..(e.offset + e.size) as usize];
                out.push((format!("{}.{}", item.id, w.name), h64(bytes)));
            }
            out.push((format!("{}.globals", item.id), h64(&l.encoded_globals())));
            out.push((format!("{}.memory", item.id), h64(l.memory())));
        }
        out
    }

    /// #550: each item's step hash as its last step left it, by item.
    pub fn step_hashes(&mut self) -> Vec<(String, u64)> {
        let ids: Vec<String> = self.piece.items.iter().map(|i| i.id.clone()).collect();
        ids.into_iter()
            .zip(self.lives.iter_mut())
            .map(|(id, l)| (id, l.last_step_hash()))
            .collect()
    }

    /// #550: `len` bytes of item `item`'s memory from `at`.
    pub fn bytes(&mut self, item: &str, at: usize, len: usize) -> Option<Vec<u8>> {
        let i = self.piece.items.iter().position(|x| x.id == item)?;
        let m = self.lives[i].memory();
        Some(m.get(at..at.checked_add(len)?)?.to_vec())
    }

    /// #550: each item's globals, arrays and memory as the full-state hash takes them.
    pub fn states(&mut self) -> Vec<(String, Vec<u8>, Vec<u8>, Vec<u8>)> {
        let ids: Vec<String> = self.piece.items.iter().map(|i| i.id.clone()).collect();
        ids.into_iter()
            .zip(self.lives.iter_mut())
            .map(|(id, l)| {
                let g = l.encoded_globals();
                (id, g, l.arrays.clone(), l.memory().to_vec())
            })
            .collect()
    }

    /// #550: writes `bytes` into item `item`'s memory at `at`, as a planted defect does.
    pub fn poke(&mut self, item: &str, at: usize, bytes: &[u8]) -> Option<()> {
        let i = self.piece.items.iter().position(|x| x.id == item)?;
        self.lives[i].poke(at, bytes)?;
        // A write's array is its write region as the step left it: it shows the change too.
        let w = self.piece.items[i].writes_at as usize;
        let arrays = &mut self.lives[i].arrays;
        if at >= w && at + bytes.len() <= w + arrays.len() {
            arrays[at - w..at - w + bytes.len()].copy_from_slice(bytes);
        }
        Some(())
    }
}
