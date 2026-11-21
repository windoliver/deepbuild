//! #832: a play's `off` (canvas primitives: Check input: catalog kinds, As built (#832)), the
//! catalog without a row: the catalog's bytes with that row's `offers` cell set to 0, every other
//! byte as it was, played in the catalog's place under its own hash, as logic.tuning's moved copy is baked.

use serde_json::{json, Value};

use super::{refused, sha_hex};

/// The copy a play's `off` names: its hash, its bytes and what the answer says of it.
pub(super) struct Off {
    pub sha256: String,
    pub bytes: Vec<u8>,
    pub answer: Value,
}

/// The copy `call.off` (`{catalog, table, row}`, the row its index in packed order) names, from the
/// catalog's stored bytes, with each of `piece`'s items that names the catalog among its data
/// assets naming the copy instead; none without an `off`, and a refusal naming what it can't find.
pub(super) fn of(
    call: &Value,
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    piece: &mut Value,
) -> Result<Option<Off>, Value> {
    let Some(off) = call.get("off").filter(|o| !o.is_null()) else {
        return Ok(None);
    };
    let bad = |what: String| refused("bad_input", json!(format!("off: {what}")));
    let (Some(catalog), Some(table), Some(row)) = (
        off.get("catalog").and_then(Value::as_str),
        off.get("table").and_then(Value::as_str),
        off.get("row").and_then(Value::as_u64),
    ) else {
        return Err(bad("{catalog: asset ID, table: name, row: index}".into()));
    };
    let bytes = stored(catalog).ok_or_else(|| {
        refused(
            "asset_missing",
            json!(format!("off: the catalog {catalog} isn't stored")),
        )
    })?;
    use deep_catalog::read;
    let dir = read::directory(&bytes)
        .ok_or_else(|| bad(format!("the catalog {catalog} isn't table.layout@1")))?;
    let t = read::table(&dir, table)
        .ok_or_else(|| bad(format!("the catalog holds no table {table}")))?;
    // The layout's codes: 0 i32, 2 bool (a byte).
    let (c, width) = match t.column("offers") {
        Some(c) if c.ty == 0 => (c, 4),
        Some(c) if c.ty == 2 => (c, 1),
        _ => return Err(bad(format!("{table} has no offers column, i32 or bool"))),
    };
    let row = row as usize;
    if row >= t.rows {
        return Err(bad(format!(
            "{table} holds {} rows, and row {row} is past them",
            t.rows
        )));
    }
    let mut copy = bytes;
    let at = c.at + width * row;
    copy.get_mut(at..at + width)
        .ok_or_else(|| bad(format!("{table}'s offers pass the catalog's end")))?
        .fill(0);
    let sha256 = sha_hex(&copy);
    let mut named = 0;
    for a in piece
        .get_mut("items")
        .and_then(Value::as_object_mut)
        .into_iter()
        .flat_map(|m| m.values_mut())
        .filter_map(|i| {
            i.pointer_mut("/params/assets")
                .and_then(Value::as_array_mut)
        })
        .flatten()
        .filter(|a| a.as_str() == Some(catalog))
    {
        *a = json!(sha256);
        named += 1;
    }
    if named == 0 {
        return Err(bad(format!("no logic item names the catalog {catalog}")));
    }
    let answer = json!({"catalog": catalog, "table": table, "row": row, "sha256": sha256});
    Ok(Some(Off {
        sha256,
        bytes: copy,
        answer,
    }))
}
