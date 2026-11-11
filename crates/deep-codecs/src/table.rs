//! Issue #397: a table asset's probe (canvas primitives: Asset: tables), run in the decode worker
//! like every probe. A CSV, its header row first, becomes typed columns with a key column; each
//! cell keeps its raw bytes and their range in the file, untouched by line ends or Unicode
//! normalization. A label draws a cell's display form, NFC, which its reader makes.

use serde_json::{json, Value};

/// The largest table a probe reads (Asset: tables: `≤ 16 MB*`).
pub const MAX_BYTES: usize = 16 * 1024 * 1024;

/// One cell: its byte range in the file, without its delimiter, quotes or row end.
struct Cell {
    start: usize,
    end: usize,
}

/// The rows of a CSV, each a list of cells. A row ends at LF, a CR before it outside the cell; a
/// quoted cell's range is inside its quotes.
fn rows(data: &[u8]) -> Vec<Vec<Cell>> {
    let mut out = Vec::new();
    let (mut row, mut i) = (Vec::new(), 0);
    while i <= data.len() {
        let quoted = data.get(i) == Some(&b'"');
        let start = if quoted { i + 1 } else { i };
        let mut j = start;
        if quoted {
            while j < data.len() && !(data[j] == b'"' && data.get(j + 1) != Some(&b'"')) {
                j += if data[j] == b'"' { 2 } else { 1 };
            }
        } else {
            while j < data.len() && !matches!(data[j], b',' | b'\n') {
                j += 1;
            }
        }
        let mut end = j;
        let mut next = if quoted { j + 1 } else { j };
        while next < data.len() && !matches!(data[next], b',' | b'\n') {
            next += 1;
        }
        let row_end = next >= data.len() || data[next] == b'\n';
        if !quoted && row_end && end > start && data[end - 1] == b'\r' {
            end -= 1;
        }
        row.push(Cell { start, end });
        i = next + 1;
        if row_end {
            let blank = row.len() == 1 && row[0].start == row[0].end;
            if !blank {
                out.push(std::mem::take(&mut row));
            }
            row.clear();
        }
    }
    out
}

/// The narrowest type every cell of a column reads as: `i64`, `f64` or `str`.
fn dtype(texts: &[String]) -> &'static str {
    if texts.iter().all(|t| t.parse::<i64>().is_ok()) {
        "i64"
    } else if texts
        .iter()
        .all(|t| t.parse::<f64>().is_ok_and(f64::is_finite))
    {
        "f64"
    } else {
        "str"
    }
}

/// The probe of a CSV table keyed by `key`: `{table: {rows, columns, key}, cells}`, each column's
/// cells `{bytes: [start, end], raw}` in row order.
pub fn probe(data: &[u8], key: &str) -> Result<Value, Value> {
    let refused = |code: &str, extra: Value| json!({"refused": {"code": code, "detail": extra}});
    if data.len() > MAX_BYTES {
        return Err(refused(
            "over_cap",
            json!({"cap": "max_bytes", "limit": MAX_BYTES}),
        ));
    }
    let Ok(text) = std::str::from_utf8(data) else {
        return Err(refused("table_unreadable", json!({"why": "not UTF-8"})));
    };
    let mut rows = rows(data).into_iter();
    let Some(header) = rows.next() else {
        return Err(refused("table_unreadable", json!({"why": "no header row"})));
    };
    let names: Vec<String> = header
        .iter()
        .map(|c| text[c.start..c.end].to_string())
        .collect();
    if !names.iter().any(|n| n == key) {
        return Err(refused("table_key_missing", json!({"key": key})));
    }
    let body: Vec<Vec<Cell>> = rows.collect();
    if let Some(r) = body.iter().position(|r| r.len() != names.len()) {
        return Err(refused(
            "table_unreadable",
            json!({"row": r, "why": "a row's cells differ from the header's"}),
        ));
    }
    let mut columns = Vec::new();
    let mut cells = serde_json::Map::new();
    for (k, name) in names.iter().enumerate() {
        let texts: Vec<String> = body
            .iter()
            .map(|r| text[r[k].start..r[k].end].to_string())
            .collect();
        let list: Vec<Value> = body
            .iter()
            .zip(&texts)
            .map(|(r, raw)| json!({"bytes": [r[k].start, r[k].end], "raw": raw}))
            .collect();
        columns.push(json!({"name": name, "dtype": dtype(&texts), "unit": null}));
        cells.insert(name.clone(), Value::Array(list));
    }
    let keys: Vec<&Value> = cells[key]
        .as_array()
        .into_iter()
        .flatten()
        .map(|c| &c["raw"])
        .collect();
    let mut seen = std::collections::HashSet::new();
    if !keys.iter().all(|k| seen.insert(k.as_str())) {
        return Err(refused("key_not_unique", json!({"key": key})));
    }
    Ok(json!({"table": {"rows": body.len(), "columns": columns, "key": key}, "cells": cells}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crlf_table_keeps_raw_cells_and_their_ranges() {
        let data = "key,label\r\n1,Cafe\u{301}\r\n2,\"Tea, \"\"hot\"\"\"\r\n".as_bytes();
        let p = probe(data, "key").unwrap();
        assert_eq!(p["table"]["rows"], 2);
        assert_eq!(p["table"]["columns"][0]["dtype"], "i64");
        for cell in p["cells"]["label"].as_array().unwrap() {
            let [s, e] = [
                cell["bytes"][0].as_u64().unwrap() as usize,
                cell["bytes"][1].as_u64().unwrap() as usize,
            ];
            assert_eq!(&data[s..e], cell["raw"].as_str().unwrap().as_bytes());
        }
        assert_eq!(p["cells"]["label"][0]["raw"], "Cafe\u{301}");
    }

    #[test]
    fn a_repeated_key_is_refused() {
        let refusal = probe(b"key,label\na,x\nb,y\na,z\n", "key").unwrap_err();
        assert_eq!(refusal["refused"]["code"], "key_not_unique");
        assert!(probe(b"key,label\na,x\nb,x\n", "key").is_ok());
    }

    #[test]
    fn a_long_table_checks_its_keys_in_one_pass() {
        // 100,000 rows, the last one's key `last`.
        let table = |last: usize| {
            let rows = (0..99_999).chain([last]);
            let body: String = rows.map(|k| format!("{k},x\n")).collect();
            format!("key,label\n{body}")
        };
        let unique = crate::tests::finished(move || probe(table(99_999).as_bytes(), "key"))
            .expect("the probe returns");
        assert_eq!(unique.unwrap()["table"]["rows"], 100_000);
        let refusal = probe(table(7).as_bytes(), "key").unwrap_err();
        assert_eq!(refusal["refused"]["code"], "key_not_unique");
    }
}
