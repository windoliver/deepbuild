//! What a host that keeps other canvas modules' state beside logic's needs of a save (#189): the
//! app's saves of a document with worlds (deep-show) build on these.

use std::rc::Rc;

use serde_json::{json, Value};

use super::{binding as bound, decode, file_bytes, made, opened, whole, Held};
use crate::piece::Piece;
use crate::world::{Entry, Record, World};
use crate::Planted;

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

/// #1500: the world `w`'s whole state now, at step `k` (its steps before k run), as a join holds
/// it: a save's header and bytes, which [`open_held`] opens under a new revision.
pub fn hold(w: &mut World, k: i64) -> (Value, Vec<u8>) {
    let (header, state) = made(w, k, 0, false);
    let bytes = file_bytes(&header, 0, &state);
    (header, bytes)
}

/// #1500: a held state opened under `piece`, a new revision's, by the rules its save opens under:
/// straight when the state layout, content and module set match, under a changed program with its
/// data segments over the held pages, else refused, naming what differs (a layout by both
/// hashes), or through a migration the piece declares. The opened world reads `track` on from
/// the held step; `rec` takes its checkpoint. `as_is` is the planted open, which takes the held memory and globals under any layout.
pub fn open_held(
    piece: &Rc<Piece>,
    (header, bytes): &(Value, Vec<u8>),
    track: &[Entry],
    (planted, adapter): (Planted, &str),
    rec: &mut Record,
    as_is: bool,
) -> Result<World, Value> {
    if !as_is {
        // A declared migration leaves its new save in a folder: a scratch one here, gone after.
        let dir = std::env::temp_dir().join(format!("deep-join-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let at = Some((dir.as_path(), dir.as_path()));
        let opened = whole(
            piece,
            at,
            "held",
            header,
            bytes,
            &[],
            track,
            planted,
            adapter,
            rec,
        );
        let _ = std::fs::remove_dir_all(&dir);
        // As a run from step 0, the opened world keeps no saves of its own.
        return opened.map(|(mut w, _)| {
            (w.saves_dir, w.held) = (None, None);
            w
        });
    }
    let paged = |i: usize| piece.items.get(i).is_some_and(|it| it.pages.is_some());
    let at = bytes.iter().position(|b| *b == b'\n').map_or(0, |n| n + 1);
    let (states, machine) = decode(&bytes[at..], piece.items.len(), &paged)
        .ok_or_else(|| json!({"code": "save_refused", "differs": [{"what": "state"}]}))?;
    let seen = machine.first().map_or(0, |(_, n)| *n);
    let states = states.into_iter().map(|(_, s)| s).collect();
    opened(
        piece,
        track,
        planted,
        header["step"].as_i64().unwrap_or(0),
        states,
        seen,
    )
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
