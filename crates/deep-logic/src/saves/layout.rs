//! A program's state layout (Logic: saves across changes, #189): the bytes at its immutable
//! global `layout_at`, after a u32 of their length, whose hash is the layout a save binds; a
//! program that exports none has its program hash as its layout. When both layouts carry a field
//! table, a refusal names every field that differs, each with its class.

use deep_canvas_sandbox::rewrite::hash;
use serde_json::{json, Value};

use crate::piece::{global_at, segments, Item};

/// The bytes at `layout_at` after their u32 length, read from the program's active data
/// segments; None when the program exports no `layout_at` or its bytes lie outside them.
pub(crate) fn bytes(given: &[u8]) -> Option<Vec<u8>> {
    let at = u64::from(global_at(given, "layout_at")?);
    let data = segments(given);
    let read = |from: u64, n: usize| {
        data.iter().find_map(|(_, start, b)| {
            let o = usize::try_from(from.checked_sub(*start)?).ok()?;
            b.get(o..o.checked_add(n)?).map(<[u8]>::to_vec)
        })
    };
    let len = u32::from_le_bytes(read(at, 4)?.try_into().ok()?) as usize;
    read(at + 4, len)
}

/// The item's state layout: the hash of its layout bytes, or its program hash without them.
pub(crate) fn of(item: &Item) -> String {
    bytes(&item.given).map_or_else(|| item.program.clone(), |b| hash(&b))
}

/// One field of a layout's field table.
#[derive(Clone, Debug, PartialEq)]
struct Field {
    name: String,
    offset: u64,
    ty: String,
    count: u64,
}

/// The layout bytes' field table `[{name, offset, type, count}]`, when they hold one: the bytes
/// are JSON, the table itself or an object whose `fields` it is.
fn fields(bytes: &[u8]) -> Option<Vec<Field>> {
    let v: Value = serde_json::from_slice(bytes).ok()?;
    let list = v.as_array().or_else(|| v.get("fields")?.as_array())?;
    list.iter()
        .map(|f| {
            Some(Field {
                name: f.get("name")?.as_str()?.to_string(),
                offset: f.get("offset")?.as_u64()?,
                ty: f.get("type")?.as_str()?.to_string(),
                count: f.get("count").map_or(Some(1), Value::as_u64)?,
            })
        })
        .collect()
}

/// Every field that differs between the save's layout bytes and the piece's, each as missing,
/// added, retyped, resized or moved, in the old table's order and then the new one's; empty when
/// either holds no field table.
pub(crate) fn field_changes(old: &[u8], new: &[u8]) -> Vec<Value> {
    let (Some(old), Some(new)) = (fields(old), fields(new)) else {
        return Vec::new();
    };
    let side = |f: &Field| json!({"offset": f.offset, "type": f.ty, "count": f.count});
    let mut out = Vec::new();
    for o in &old {
        let n = new.iter().find(|n| n.name == o.name);
        let class = match n {
            None => "missing",
            Some(n) if n.ty != o.ty => "retyped",
            Some(n) if n.count != o.count => "resized",
            Some(n) if n.offset != o.offset => "moved",
            Some(_) => continue,
        };
        let mut c = json!({"name": o.name, "class": class, "save": side(o)});
        if let Some(n) = n {
            c["piece"] = side(n);
        }
        out.push(c);
    }
    for n in new.iter().filter(|n| !old.iter().any(|o| o.name == n.name)) {
        out.push(json!({"name": n.name, "class": "added", "piece": side(n)}));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(t: &str) -> Vec<u8> {
        t.as_bytes().to_vec()
    }

    #[test]
    fn every_field_that_differs_is_named_with_its_class() {
        let old = table(
            r#"{"fields":[{"name":"roster","offset":0,"type":"i32","count":12},{"name":"gold","offset":48,"type":"i32","count":1},{"name":"floor","offset":52,"type":"i32","count":1}]}"#,
        );
        let new = table(
            r#"[{"name":"seed","offset":0,"type":"i32","count":1},{"name":"roster","offset":4,"type":"i32","count":12},{"name":"coins","offset":52,"type":"i32","count":1},{"name":"floor","offset":56,"type":"i64","count":1}]"#,
        );
        let got: Vec<(String, String)> = field_changes(&old, &new)
            .iter()
            .map(|c| {
                (
                    c["name"].as_str().unwrap().into(),
                    c["class"].as_str().unwrap().into(),
                )
            })
            .collect();
        let want = [
            ("roster", "moved"),
            ("gold", "missing"),
            ("floor", "retyped"),
            ("seed", "added"),
            ("coins", "added"),
        ];
        assert_eq!(got, want.map(|(a, b)| (a.to_string(), b.to_string())));
        assert!(field_changes(&old, b"not a table").is_empty());
    }
}
