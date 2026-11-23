//! #194: `logic.tuning` (canvas primitives: Check input: logic kinds, As built (#194)). A
//! catalog's `tuning` table holds one row per feel value, `value: f64` with an optional range in
//! `min` and `max`. Each row's value is moved to 1.25 × it, or 0.8 × where 1.25 × leaves its range,
//! in a copy of the catalog the piece then bakes in its place; the two bakes are stepped side by
//! side and their full states compared at every step, the bytes each item's data assets' copies
//! hold left out, since the move changes those alone. A row whose move changes no step's state is
//! one the program never reads: its value is compiled in.

use std::rc::Rc;

use serde_json::{json, Map, Value};

use crate::piece::{Item, Piece};
use crate::world::{track_of, Entry, Record, World};

/// One tuning row: its ID, its value, where its move takes it (none when neither 1.25 × nor
/// 0.8 × fits its range) and its row in the packed table.
struct Row {
    id: String,
    from: f64,
    to: Option<f64>,
    row: usize,
}

/// The rows of the catalog's `tuning` table, read from its bytes by hash and named by its record;
/// none when it has no such table with an f64 `value` column.
fn rows(bytes: &[u8], record: &Value) -> Option<Vec<Row>> {
    use deep_catalog::read;
    let named = record
        .get("tables")?
        .as_array()?
        .iter()
        .find(|t| t["name"] == "tuning")?;
    let ids = named.get("ids")?.as_array()?;
    let dir = read::directory(bytes)?;
    let table = read::table(&dir, "tuning")?;
    let f64s = |name: &str| table.column(name).filter(|c| c.ty == 1);
    let value = f64s("value")?;
    let (min, max) = (f64s("min"), f64s("max"));
    let mut out = Vec::new();
    for (k, id) in ids.iter().enumerate() {
        let from = read::f64_at(bytes, value, k)?;
        let lo = min
            .and_then(|c| read::f64_at(bytes, c, k))
            .unwrap_or(f64::NEG_INFINITY);
        let hi = max
            .and_then(|c| read::f64_at(bytes, c, k))
            .unwrap_or(f64::INFINITY);
        let to = [1.25 * from, 0.8 * from]
            .into_iter()
            .find(|v| *v >= lo && *v <= hi);
        out.push(Row {
            id: id.as_str()?.to_string(),
            from,
            to,
            row: k,
        });
    }
    Some(out)
}

/// The catalog's bytes with `row`'s value moved to its `to`.
fn moved(bytes: &[u8], row: &Row) -> Option<Vec<u8>> {
    use deep_catalog::read;
    let dir = read::directory(bytes)?;
    let value = read::table(&dir, "tuning")?.column("value")?;
    let mut out = bytes.to_vec();
    read::set_f64(&mut out, value, row.row, row.to?)?;
    Some(out)
}

/// The bytes each item's data assets' copies hold in its memory: from `assets_at`, each after a
/// u32 of its length.
fn copies(item: &Item) -> std::ops::Range<usize> {
    let at = item.assets_at as usize;
    let size: usize = item.assets.iter().map(|(_, b)| 4 + b.len()).sum();
    at..at + size
}

/// `a` and `b` stepped side by side on `entries` over `steps` steps of the fastest item: how many
/// steps ran, and at how many every item's full state but its data assets' copies was equal.
fn compare(a: Rc<Piece>, b: Rc<Piece>, entries: &[Entry], steps: i64) -> Result<(i64, i64), Value> {
    let (mut ra, mut rb) = (Record::default(), Record::default());
    let mut wa = World::new(
        a.clone(),
        track_of(entries),
        false,
        Default::default(),
        &mut ra,
        None,
    )?;
    let mut wb = World::new(
        b.clone(),
        track_of(entries),
        false,
        Default::default(),
        &mut rb,
        None,
    )?;
    let len = a.items.iter().map(|i| i.step).min().unwrap_or(1).max(1);
    let mut equal = 0;
    for k in 0..steps {
        wa.run_through(k * len, &mut ra);
        wb.run_through(k * len, &mut rb);
        let same = (0..a.items.len()).all(|i| {
            let skip = copies(&a.items[i]);
            wa.lives[i].same_but(&mut wb.lives[i], skip)
        });
        if same {
            equal += 1;
        }
    }
    if let Some(t) = ra.traps.first().or(rb.traps.first()) {
        return Err(json!({"what": "a bake trapped", "trap": t}));
    }
    Ok((steps, equal))
}

/// What logic.tuning found: each moved row's report, each failure (`rule` the row's
/// `tuning.<ID>`) and what it couldn't run.
#[derive(Default)]
pub struct Found {
    pub rows: Vec<Value>,
    pub failures: Vec<Value>,
    pub blocked: Vec<Value>,
}

/// Bakes the piece again with a catalog's moved bytes in its place: `(catalog, moved bytes)`.
pub type Rebake<'a> = dyn Fn(&str, &[u8]) -> Result<Rc<Piece>, Value> + 'a;

/// logic.tuning over `piece` baked on `entries` for `steps` steps: each tuning row of each catalog
/// its items name (only `wanted`, when given), its record from `records`, moved and baked again by
/// `rebake(catalog, moved bytes)`, the piece with the moved copy in the catalog's place.
pub fn run(
    piece: &Rc<Piece>,
    entries: &[Entry],
    steps: i64,
    records: Option<&Map<String, Value>>,
    wanted: Option<&str>,
    rebake: &Rebake<'_>,
) -> Found {
    let mut out = Found::default();
    let mut seen = std::collections::BTreeSet::new();
    let named = piece
        .items
        .iter()
        .flat_map(|i| i.assets.iter().map(move |a| (i, a)));
    for (item, (sha, bytes)) in named {
        if wanted.is_some_and(|w| w != sha) || !seen.insert(sha.clone()) {
            continue;
        }
        let Some(list) = records
            .and_then(|r| r.get(sha))
            .and_then(|r| rows(bytes, r))
        else {
            continue;
        };
        for row in list {
            let name = format!("tuning.{}", row.id);
            let (Some(to), Some(bytes)) = (row.to, moved(bytes, &row)) else {
                out.failures.push(json!({"rule": name, "item": item.id, "what": "neither 1.25 × nor 0.8 × its value fits its range"}));
                continue;
            };
            match rebake(sha, &bytes).and_then(|b| compare(piece.clone(), b, entries, steps)) {
                Ok((n, equal)) => {
                    out.rows.push(json!({"row": name, "from": row.from, "to": to, "steps": n, "equal": equal}));
                    if equal == n {
                        out.failures.push(
                            json!({"rule": name, "item": item.id, "steps": n, "equal": equal}),
                        );
                    }
                }
                Err(e) => out.blocked.push(e),
            }
        }
    }
    if out.rows.is_empty() && out.failures.is_empty() && out.blocked.is_empty() {
        out.blocked.push(json!({"what": "logic.tuning finds no catalog with a tuning table among the data assets the piece's logic items name"}));
    }
    out
}
