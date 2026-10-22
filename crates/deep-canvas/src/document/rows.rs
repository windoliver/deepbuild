//! `rows {id, append | set | remove}` (canvas primitives: Patch; Mark set and columns `marks@1`:
//! "patches append rows or set and remove them by key"): a mark set's rows changed in place, its
//! columns decoded from their dtype, edited, and encoded again, so the rest of the set stays as
//! written.
//!
//! - `append: [row]`: each row gives every data column a value; a constant column may be left
//!   out or given its constant. With a key column, a new key must not be one the set holds.
//! - `set: [row]`: each row names its row by the key column and gives the columns it changes.
//! - `remove: [key]`: the rows with those keys.

use serde_json::{json, Map, Value};

/// The most rows a mark set holds (Mark set: it can never exceed 1M rows per set).
const MAX_ROWS: usize = 1_000_000;
/// The most characters a text cell holds.
const MAX_TEXT: usize = 512;

/// Why a rows op is refused: its code, the path under the item, and what.
pub type Refusal = (&'static str, String, String);

fn refuse<T>(
    code: &'static str,
    path: impl Into<String>,
    what: impl Into<String>,
) -> Result<T, Refusal> {
    Err((code, path.into(), what.into()))
}

/// One decoded column.
enum Cells {
    Numbers { dtype: String, values: Vec<f64> },
    Texts(Vec<String>),
    Const(Value),
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn decode64(text: &str) -> Option<Vec<u8>> {
    let value = |c: u8| B64.iter().position(|b| *b == c).map(|v| v as u32);
    let body = text.trim_end_matches('=').as_bytes();
    let mut out = Vec::with_capacity(body.len() * 3 / 4);
    for chunk in body.chunks(4) {
        let mut acc = 0u32;
        for (k, &c) in chunk.iter().enumerate() {
            acc |= value(c)? << (18 - 6 * k as u32);
        }
        let b = acc.to_be_bytes();
        match chunk.len() {
            4 => out.extend(&b[1..4]),
            3 => out.extend(&b[1..3]),
            2 => out.push(b[1]),
            _ => return None,
        }
    }
    Some(out)
}

fn encode64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let acc = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(B64[(acc >> (18 - 6 * k)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A dtype's byte width; `bool` and `role` are one byte each.
fn width(dtype: &str) -> Option<usize> {
    match dtype {
        "f64" | "i64" => Some(8),
        "f32" | "i32" | "u32" => Some(4),
        "u16" => Some(2),
        "u8" | "bool" | "role" => Some(1),
        _ => None,
    }
}

/// Whether `v` is a value of `dtype`, exactly.
fn fits(dtype: &str, v: f64) -> bool {
    let whole = v.fract() == 0.0;
    match dtype {
        "f64" => v.is_finite(),
        "f32" => v.is_finite() && v.abs() <= f64::from(f32::MAX),
        "i64" => whole && v.abs() <= 9_007_199_254_740_992.0,
        "i32" => whole && (f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&v),
        "u32" => whole && (0.0..=f64::from(u32::MAX)).contains(&v),
        "u16" => whole && (0.0..=f64::from(u16::MAX)).contains(&v),
        "bool" => v == 0.0 || v == 1.0,
        _ => whole && (0.0..=255.0).contains(&v),
    }
}

fn decode(name: &str, c: &Value, n: usize) -> Result<Cells, Refusal> {
    let at = format!("params/columns/{name}");
    let Some(c) = c.as_object() else {
        return refuse("out_of_range", at, "not a column");
    };
    if let Some(v) = c.get("const") {
        return Ok(Cells::Const(v.clone()));
    }
    for computed in ["from", "array", "expr"] {
        if c.contains_key(computed) {
            return refuse(
                "out_of_range",
                at,
                "a column read from a table, logic or an expression has no rows to patch",
            );
        }
    }
    let dtype = c.get("dtype").and_then(Value::as_str).unwrap_or_default();
    if c.get("len").and_then(Value::as_u64) != Some(n as u64) {
        return refuse("out_of_range", format!("{at}/len"), "not the set's `n`");
    }
    if dtype == "str" {
        let texts: Option<Vec<String>> = c
            .get("data")
            .and_then(Value::as_array)
            .and_then(|l| l.iter().map(|v| v.as_str().map(str::to_string)).collect());
        return match texts {
            Some(t) if t.len() == n => Ok(Cells::Texts(t)),
            _ => refuse(
                "out_of_range",
                format!("{at}/data"),
                "not a list of `n` strings",
            ),
        };
    }
    let Some(w) = width(dtype) else {
        return refuse("out_of_range", format!("{at}/dtype"), "not a column dtype");
    };
    let Some(text) = c.get("data").and_then(Value::as_str) else {
        return refuse(
            "out_of_range",
            format!("{at}/data"),
            "a sidecar column changes by a new sidecar file, not a patch",
        );
    };
    let bytes = decode64(text).filter(|b| b.len() == n * w);
    let Some(bytes) = bytes else {
        return refuse(
            "out_of_range",
            format!("{at}/data"),
            "not `n` values of its dtype in base64",
        );
    };
    let values = bytes
        .chunks_exact(w)
        .map(|b| match dtype {
            "f64" => f64::from_le_bytes(b.try_into().unwrap_or([0; 8])),
            "i64" => i64::from_le_bytes(b.try_into().unwrap_or([0; 8])) as f64,
            "f32" => f64::from(f32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "i32" => f64::from(i32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "u32" => f64::from(u32::from_le_bytes(b.try_into().unwrap_or([0; 4]))),
            "u16" => f64::from(u16::from_le_bytes(b.try_into().unwrap_or([0; 2]))),
            _ => f64::from(b[0]),
        })
        .collect();
    Ok(Cells::Numbers {
        dtype: dtype.to_string(),
        values,
    })
}

fn encode(cells: &Cells, n: usize) -> Value {
    match cells {
        Cells::Const(v) => json!({"const": v}),
        Cells::Texts(t) => json!({"dtype": "str", "len": n, "data": t}),
        Cells::Numbers { dtype, values } => {
            let mut bytes = Vec::new();
            for v in values {
                match dtype.as_str() {
                    "f64" => bytes.extend(v.to_le_bytes()),
                    "i64" => bytes.extend((*v as i64).to_le_bytes()),
                    "f32" => bytes.extend((*v as f32).to_le_bytes()),
                    "i32" => bytes.extend((*v as i32).to_le_bytes()),
                    "u32" => bytes.extend((*v as u32).to_le_bytes()),
                    "u16" => bytes.extend((*v as u16).to_le_bytes()),
                    _ => bytes.push(*v as u8),
                }
            }
            json!({"dtype": dtype, "len": n, "data": encode64(&bytes)})
        }
    }
}

/// A cell's value as a key, compared as JSON.
fn cell(cells: &Cells, i: usize) -> Value {
    match cells {
        Cells::Const(v) => v.clone(),
        Cells::Texts(t) => json!(t[i]),
        Cells::Numbers { values, .. } => json!(values[i]),
    }
}

fn same_key(a: &Value, b: &Value) -> bool {
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x == y,
        _ => a == b,
    }
}

/// Writes `value` into row `i` of column `name`, or pushes it when `i` is past the end.
fn write(name: &str, cells: &mut Cells, i: usize, value: &Value) -> Result<(), Refusal> {
    let at = format!("params/columns/{name}");
    match cells {
        Cells::Const(c) if c == value => Ok(()),
        Cells::Const(_) => refuse(
            "out_of_range",
            at,
            "a constant column holds one value for every row",
        ),
        Cells::Texts(t) => {
            let Some(s) = value.as_str().filter(|s| s.chars().count() <= MAX_TEXT) else {
                return refuse("out_of_range", at, "not a string of at most 512 characters");
            };
            if i < t.len() {
                t[i] = s.to_string();
            } else {
                t.push(s.to_string());
            }
            Ok(())
        }
        Cells::Numbers { dtype, values } => {
            let v = value.as_f64().filter(|v| fits(dtype, *v));
            let Some(v) = v.or_else(|| {
                value
                    .as_bool()
                    .filter(|_| dtype == "bool")
                    .map(|b| f64::from(u8::from(b)))
            }) else {
                return refuse("out_of_range", at, format!("not a value of dtype {dtype}"));
            };
            if i < values.len() {
                values[i] = v;
            } else {
                values.push(v);
            }
            Ok(())
        }
    }
}

/// The mark set's params after the op `op`, or why it is refused.
pub fn rows(
    params: &Map<String, Value>,
    op: &Map<String, Value>,
) -> Result<Map<String, Value>, Refusal> {
    let Some(Value::Object(columns)) = params.get("columns") else {
        return refuse(
            "out_of_range",
            "params/columns",
            "not a mark set: it has no columns",
        );
    };
    if params.contains_key("rows") {
        return refuse(
            "out_of_range",
            "params/rows",
            "rows from an occurrence list come from the record, not a patch",
        );
    }
    let n = params.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
    let mut cells: Vec<(String, Cells)> = Vec::with_capacity(columns.len());
    for (name, c) in columns {
        cells.push((name.clone(), decode(name, c, n)?));
    }
    let key = params.get("key").and_then(Value::as_str);
    let key_index = key.and_then(|k| cells.iter().position(|(name, _)| name == k));
    let find = |cells: &[(String, Cells)], wanted: &Value| -> Option<usize> {
        let k = key_index?;
        (0..n).find(|i| same_key(&cell(&cells[k].1, *i), wanted))
    };
    let mut n = n;
    if let Some(list) = op.get("append") {
        let Some(list) = list.as_array() else {
            return refuse("out_of_range", "append", "a list of rows");
        };
        for row in list {
            let Some(row) = row.as_object() else {
                return refuse(
                    "out_of_range",
                    "append",
                    "a row is an object of column values",
                );
            };
            if let Some(unknown) = row.keys().find(|c| !columns.contains_key(*c)) {
                return refuse(
                    "unknown_field",
                    format!("params/columns/{unknown}"),
                    "the set has no such column",
                );
            }
            if let (Some(k), Some(name)) = (key_index, key) {
                if let Some(v) = row.get(name) {
                    if find(&cells, v).is_some() {
                        return refuse(
                            "out_of_range",
                            format!("params/columns/{name}"),
                            "the set already has a row with this key",
                        );
                    }
                } else if !matches!(cells[k].1, Cells::Const(_)) {
                    return refuse(
                        "out_of_range",
                        format!("params/columns/{name}"),
                        "a new row needs its key",
                    );
                }
            }
            for (name, c) in &mut cells {
                match row.get(name.as_str()) {
                    Some(v) => write(name, c, n, v)?,
                    None if matches!(c, Cells::Const(_)) => {}
                    None => {
                        return refuse(
                            "out_of_range",
                            format!("params/columns/{name}"),
                            "a new row gives every data column a value",
                        )
                    }
                }
            }
            n += 1;
            if n > MAX_ROWS {
                return refuse(
                    "over_budget",
                    "params/n",
                    "a mark set holds at most 1,000,000 rows",
                );
            }
        }
    } else if let Some(list) = op.get("set") {
        let (Some(name), Some(_)) = (key, key_index) else {
            return refuse(
                "out_of_range",
                "params/key",
                "rows are set by key, and the set has no key column",
            );
        };
        for row in list.as_array().into_iter().flatten() {
            let Some(row) = row.as_object() else {
                return refuse("out_of_range", "set", "a row is an object of column values");
            };
            let Some(i) = row.get(name).and_then(|k| find(&cells, k)) else {
                return refuse(
                    "ref_unresolved",
                    format!("params/columns/{name}"),
                    "no row has this key",
                );
            };
            for (col, v) in row {
                let Some((_, c)) = cells.iter_mut().find(|(c, _)| c == col) else {
                    return refuse(
                        "unknown_field",
                        format!("params/columns/{col}"),
                        "the set has no such column",
                    );
                };
                write(col, c, i, v)?;
            }
        }
    } else if let Some(list) = op.get("remove") {
        let (Some(name), Some(_)) = (key, key_index) else {
            return refuse(
                "out_of_range",
                "params/key",
                "rows are removed by key, and the set has no key column",
            );
        };
        let mut gone = Vec::new();
        for k in list.as_array().into_iter().flatten() {
            match find(&cells, k) {
                Some(i) => gone.push(i),
                None => {
                    return refuse(
                        "ref_unresolved",
                        format!("params/columns/{name}"),
                        "no row has this key",
                    )
                }
            }
        }
        gone.sort_unstable();
        gone.dedup();
        for (_, c) in &mut cells {
            for i in gone.iter().rev() {
                match c {
                    Cells::Texts(t) => {
                        t.remove(*i);
                    }
                    Cells::Numbers { values, .. } => {
                        values.remove(*i);
                    }
                    Cells::Const(_) => {}
                }
            }
        }
        n -= gone.len();
    }
    let mut out = params.clone();
    out.insert("n".into(), json!(n));
    let columns: Map<String, Value> = cells
        .iter()
        .map(|(name, c)| (name.clone(), encode(c, n)))
        .collect();
    out.insert("columns".into(), Value::Object(columns));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set() -> Map<String, Value> {
        // v: f64 [2, 5]; k: str ["a", "b"]; c: const.
        json!({"mark": "point", "n": 2, "key": "k", "columns": {
            "v": {"dtype": "f64", "len": 2, "data": "AAAAAAAAAEAAAAAAAAAUQA=="},
            "k": {"dtype": "str", "len": 2, "data": ["a", "b"]},
            "c": {"const": 1}}})
        .as_object()
        .unwrap()
        .clone()
    }

    fn values(p: &Map<String, Value>) -> Vec<f64> {
        let Cells::Numbers { values, .. } =
            decode("v", &p["columns"]["v"], p["n"].as_u64().unwrap() as usize)
                .ok()
                .unwrap()
        else {
            panic!("numbers")
        };
        values
    }

    fn op(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn rows_append_set_and_remove_by_key() {
        let out = rows(&set(), &op(json!({"append": [{"v": 7, "k": "c"}]}))).unwrap();
        assert_eq!(out["n"], json!(3));
        assert_eq!(values(&out), [2.0, 5.0, 7.0]);
        assert_eq!(out["columns"]["k"]["data"], json!(["a", "b", "c"]));
        let out = rows(&out, &op(json!({"set": [{"k": "b", "v": 9}]}))).unwrap();
        assert_eq!(values(&out), [2.0, 9.0, 7.0]);
        let out = rows(&out, &op(json!({"remove": ["a"]}))).unwrap();
        assert_eq!(
            (values(&out), out["columns"]["k"]["data"].clone()),
            (vec![9.0, 7.0], json!(["b", "c"]))
        );
        assert_eq!(out["columns"]["c"], json!({"const": 1}));
    }

    #[test]
    fn a_duplicate_key_a_missing_cell_and_a_wrong_dtype_are_refused() {
        let codes = |v: Value| rows(&set(), &op(v)).err().map(|r| r.0);
        assert_eq!(
            codes(json!({"append": [{"v": 1, "k": "a"}]})),
            Some("out_of_range")
        );
        assert_eq!(codes(json!({"append": [{"k": "z"}]})), Some("out_of_range"));
        assert_eq!(
            codes(json!({"set": [{"k": "a", "v": "x"}]})),
            Some("out_of_range")
        );
        assert_eq!(codes(json!({"remove": ["nope"]})), Some("ref_unresolved"));
        assert_eq!(
            codes(json!({"append": [{"v": 1, "k": "q", "c": 2}]})),
            Some("out_of_range")
        );
    }

    #[test]
    fn base64_round_trips() {
        for bytes in [
            vec![],
            vec![1],
            vec![1, 2],
            vec![1, 2, 3],
            vec![255, 0, 7, 9],
        ] {
            assert_eq!(decode64(&encode64(&bytes)).unwrap(), bytes);
        }
    }
}
