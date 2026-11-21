//! What a host that keeps other canvas modules' state beside logic's needs of a save (#189): the
//! app's saves of a document with worlds (deep-show) build on these.

use super::{binding as bound, decode, made, Held};
use crate::piece::Piece;
use crate::world::World;

/// The piece's state layout, content (its data assets) and module set, as a logic save binds them.
pub fn binding(piece: &Piece) -> [String; 3] {
    bound(piece)
}

/// The world's state now, at step `k`, as a save of `slot`, whatever its steps asked for: what a
/// re-derivation writes, with save requests, `ends` and carry records off while it replays.
pub fn held_at(w: &mut World, k: i64, slot: i32, ended: bool) -> Held {
    let (header, state) = made(w, k, slot, ended);
    Held {
        item: w
            .piece
            .items
            .first()
            .map_or_else(String::new, |i| i.id.clone()),
        slot,
        step: k,
        ended,
        deep_hash: w.deep_hashes(),
        header,
        state,
    }
}

/// Where two saves' logic states differ, each a save's bytes: `None` when they are the same;
/// otherwise the first array, in each item's `writes` order, whose values differ, as
/// `<item ID>.<name>`, or `Some(None)` when only memory, globals or what is waiting differs.
pub fn differs(piece: &Piece, old: &[u8], new: &[u8]) -> Option<Option<String>> {
    let state = |b: &[u8]| {
        let n = b.iter().position(|x| *x == b'\n')?;
        let paged = |i: usize| piece.items.get(i).is_some_and(|it| it.pages.is_some());
        decode(&b[n + 1..], piece.items.len(), &paged)
    };
    let (Some((a, am)), Some((b, bm))) = (state(old), state(new)) else {
        return Some(None);
    };
    for (item, ((_, x), (_, y))) in piece.items.iter().zip(a.iter().zip(&b)) {
        for w in &item.writes {
            let Some(e) = item.write(&w.name) else {
                continue;
            };
            let range = e.offset as usize..(e.offset + e.size) as usize;
            if x.arrays.get(range.clone()) != y.arrays.get(range) {
                return Some(Some(format!("{}.{}", item.id, w.name)));
            }
        }
    }
    let same = a.len() == b.len()
        && am == bm
        && a.iter().zip(&b).all(|((i, x), (j, y))| {
            i == j
                && x.failed == y.failed
                && x.ran == y.ran
                && x.memory == y.memory
                && x.globals == y.globals
                && x.arrays == y.arrays
                && x.prev == y.prev
                && x.pending == y.pending
        });
    (!same).then_some(None)
}
