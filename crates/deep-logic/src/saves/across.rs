//! A save opened under a changed program whose state layout, content and module set match the
//! piece's (Logic: saves, Logic: saves across changes; #189): after its pages, the new program's
//! active data segments are written, so a fix's new constants take effect, and it opens straight
//! only when every byte those segments write lies inside the old program's segments or is zero in
//! the save, and no byte the game left inside the old segments differs from the segment's own.

use serde_json::{json, Value};

use crate::piece::{segments, Item};

/// The program's active data segments as `[start, end)` ranges, as a save records them.
pub(super) fn ranges(given: &[u8]) -> Value {
    segments(given)
        .into_iter()
        .map(|(_, at, b)| json!([at, at + b.len() as u64]))
        .collect()
}

/// What keeps the save's memory from opening straight under `item`'s changed program, naming the
/// segment and the first offset; otherwise the new program's segments are written over it.
/// `planted` writes them with no check, as the planted open does.
pub(super) fn onto(
    item: &Item,
    header: &Value,
    memory: &mut [u8],
    planted: bool,
) -> Result<(), Vec<Value>> {
    let refused = |segment: Value, offset: Value| json!({"what": "segment", "item": item.id, "segment": segment, "offset": offset});
    let theirs: Vec<Value> = header["segments"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| s["item"] == json!(item.id))
        .map(|s| refused(s["segment"].clone(), s["offset"].clone()))
        .collect();
    if !theirs.is_empty() && !planted {
        return Err(theirs);
    }
    let old: Vec<(u64, u64)> = header["ranges"][&item.id]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| Some((r[0].as_u64()?, r[1].as_u64()?)))
        .collect();
    let new = segments(&item.given);
    if !planted {
        for (segment, at, bytes) in &new {
            let over = (*at..*at + bytes.len() as u64).find(|p| {
                !old.iter().any(|(s, e)| (*s..*e).contains(p))
                    && memory.get(*p as usize).is_some_and(|b| *b != 0)
            });
            if let Some(p) = over {
                return Err(vec![refused(json!(segment), json!(p))]);
            }
        }
    }
    for (_, at, bytes) in new {
        if let Some(to) = memory.get_mut(at as usize..at as usize + bytes.len()) {
            to.copy_from_slice(&bytes);
        }
    }
    Ok(())
}

/// The rewritten program's mutable globals as a save records them: each `[index, type]`, its
/// index in the program as written.
pub(super) fn globals(rewritten: &[u8]) -> Value {
    mutable(rewritten)
        .into_iter()
        .map(|(i, t)| json!([i, t]))
        .collect()
}

fn mutable(rewritten: &[u8]) -> Vec<(u32, &'static str)> {
    crate::world::names(rewritten)
        .globals
        .into_iter()
        .map(|(n, t)| {
            (
                n.rsplit('.')
                    .next()
                    .and_then(|i| i.parse().ok())
                    .unwrap_or(0),
                t,
            )
        })
        .collect()
}

/// The first of the program's mutable globals that doesn't match the save's in count or type,
/// named by its index as written, when one doesn't; `saved` is how many the save holds.
pub(super) fn globals_differ(item: &Item, header: &Value, saved: usize) -> Option<Value> {
    let mine = mutable(&item.bytes);
    let theirs: Option<Vec<(u32, String)>> = header["globals"][&item.id].as_array().map(|a| {
        a.iter()
            .filter_map(|g| Some((g[0].as_u64()? as u32, g[1].as_str()?.to_string())))
            .collect()
    });
    let count = theirs.as_ref().map_or(saved, Vec::len);
    let first = (0..mine.len().max(count)).find(|&j| match (mine.get(j), theirs.as_ref()) {
        (Some((_, t)), Some(theirs)) => theirs.get(j).is_none_or(|(_, u)| u != t),
        (Some(_), None) => j >= saved,
        (None, _) => true,
    })?;
    let index = mine
        .get(first)
        .map(|(i, _)| *i)
        .or_else(|| theirs.as_ref().and_then(|t| t.get(first)).map(|(i, _)| *i));
    Some(
        json!({"what": "globals", "item": item.id, "global": index, "save": count, "piece": mine.len()}),
    )
}
