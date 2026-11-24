//! A decimated series' rows: every kept row, and the raw row nearest a time (the crosshair's snap);
//! and its columns, box and window as its params give them.

use super::*;

impl Decimated {
    /// Every kept row, in draw order, each once.
    pub fn rows(&self) -> Vec<usize> {
        self.columns.iter().flatten().copied().collect()
    }

    /// The raw row nearest a time, never a decimated vertex: the crosshair's snap.
    pub fn nearest(&self, at: f64) -> Option<usize> {
        let i = self.t.partition_point(|&t| t < at);
        match (i.checked_sub(1), (i < self.t.len()).then_some(i)) {
            (Some(a), Some(b)) => Some(if at - self.t[a] <= self.t[b] - at {
                a
            } else {
                b
            }),
            (a, b) => a.or(b),
        }
    }
}

pub(super) fn series_len(p: &Map<String, Value>, path: &str) -> Result<usize, Refused> {
    Ok(p.get("t")
        .and_then(|t| t.get("len"))
        .and_then(Value::as_u64)
        .filter(|n| *n <= MAX_ROWS)
        .ok_or(Refused {
            code: "bad_column",
            path: format!("{path}/t"),
        })? as usize)
}

pub(super) fn series_numbers(
    p: &Map<String, Value>,
    name: &str,
    n: usize,
    path: &str,
) -> Result<Option<Vec<f64>>, Refused> {
    match p.get(name) {
        None => Ok(None),
        Some(c) => match column_of(c, n, &format!("{path}/{name}"))? {
            // A series draws one line through every row, so none may be missing.
            Column::Numbers(v) if v.iter().any(|x| x.is_nan()) => {
                refuse("out_of_range", format!("{path}/{name}/data"))
            }
            Column::Numbers(v) => Ok(Some(v)),
            _ => refuse("bad_column", format!("{path}/{name}")),
        },
    }
}

pub(super) fn series_box(p: &Map<String, Value>, path: &str) -> Result<[f64; 4], Refused> {
    match p.get("box").and_then(Value::as_array).and_then(|b| {
        let b: Option<Vec<f64>> = b.iter().map(Value::as_f64).collect();
        <[f64; 4]>::try_from(b?.as_slice()).ok()
    }) {
        Some(b) => Ok(b),
        None => refuse("bad_doc", format!("{path}/box")),
    }
}

pub(super) fn series_window(
    p: &Map<String, Value>,
    t: &[f64],
    path: &str,
) -> Result<(f64, f64), Refused> {
    let n = t.len();
    Ok(match p.get("window") {
        Some(Value::Array(w)) => match w.as_slice() {
            [a, b] => (a.as_f64().unwrap_or(0.0), b.as_f64().unwrap_or(0.0)),
            _ => return refuse("bad_doc", format!("{path}/window")),
        },
        Some(Value::Object(w)) if n > 0 => {
            let last = w.get("last").and_then(Value::as_u64).unwrap_or(n as u64) as usize;
            (t[n.saturating_sub(last.max(1))], t[n - 1])
        }
        None if n > 0 => (t[0], t[n - 1]),
        _ => (0.0, 0.0),
    })
}
