//! A catalog table's cells, read the same from CSV and from JSON lines so both routes reach the
//! pack with the same rows. The CSV reader is the one #397's table probe uses: a row ends at LF, a
//! CR before it outside the cell; a quoted cell's range is inside its quotes, `""` its quote.

use serde_json::Value;

/// One CSV cell: its byte range in the file, without its delimiter, quotes or row end, and
/// whether it was quoted (so its `""` read as `"`).
pub struct Cell {
    pub start: usize,
    pub end: usize,
    pub quoted: bool,
}

/// The rows of a CSV, each a list of cells; a blank line is no row.
pub fn rows(data: &[u8]) -> Vec<Vec<Cell>> {
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
        row.push(Cell { start, end, quoted });
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

/// A cell's text: its bytes, a quoted cell's `""` read as `"`.
pub fn text(data: &str, c: &Cell) -> String {
    let raw = &data[c.start..c.end];
    if c.quoted {
        raw.replace("\"\"", "\"")
    } else {
        raw.to_string()
    }
}

/// One cell as the pack reads it: CSV text, or a JSON value; an empty CSV cell, a JSON null and
/// a key the line leaves out are `None`.
#[derive(Clone, Debug)]
pub enum Raw {
    Text(String),
    Json(Value),
}

/// A table's rows in file order, each its cells by column name, and its columns: a CSV's header,
/// or every key any JSON line holds, in first-seen order.
pub struct Read {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<(String, Option<Raw>)>>,
}

/// A CSV table, its header row first.
pub fn csv(data: &[u8]) -> Result<Read, String> {
    let text_of = std::str::from_utf8(data).map_err(|_| "it isn't UTF-8".to_string())?;
    let mut all = rows(data).into_iter();
    let header = all.next().ok_or("it has no header row")?;
    let columns: Vec<String> = header.iter().map(|c| text(text_of, c)).collect();
    let mut rows = Vec::new();
    for (r, cells) in all.enumerate() {
        if cells.len() != columns.len() {
            return Err(format!(
                "row {} has {} cells and the header {}",
                r + 1,
                cells.len(),
                columns.len()
            ));
        }
        rows.push(
            columns
                .iter()
                .zip(&cells)
                .map(|(name, c)| {
                    let t = text(text_of, c);
                    (name.clone(), (!t.is_empty()).then_some(Raw::Text(t)))
                })
                .collect(),
        );
    }
    Ok(Read { columns, rows })
}

/// A JSON lines table: one object a line; a blank line is no row.
pub fn jsonl(data: &[u8]) -> Result<Read, String> {
    let text = std::str::from_utf8(data).map_err(|_| "it isn't UTF-8".to_string())?;
    let mut columns: Vec<String> = Vec::new();
    let mut objects = Vec::new();
    for (n, line) in text.split('\n').enumerate() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() {
            continue;
        }
        let Ok(Value::Object(o)) = serde_json::from_str::<Value>(line) else {
            return Err(format!("line {} isn't one JSON object", n + 1));
        };
        for k in o.keys() {
            if !columns.contains(k) {
                columns.push(k.clone());
            }
        }
        objects.push(o);
    }
    let rows = objects
        .into_iter()
        .map(|o| {
            o.into_iter()
                .map(|(k, v)| {
                    let raw = (!v.is_null()).then_some(Raw::Json(v));
                    (k, raw)
                })
                .collect()
        })
        .collect();
    Ok(Read { columns, rows })
}
