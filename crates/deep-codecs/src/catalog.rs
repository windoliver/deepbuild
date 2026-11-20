//! #194 (canvas primitives: Asset: tables: catalogs `table.layout@1`): the decode worker's
//! `catalog` job, the one job that names no single `path`: a catalog's tables, each file at its
//! `path` in its `format` (`csv` or `jsonl`, else read from the path's extension), packed under
//! `schema` by the data module's probe (`deep-catalog`), the bytes written to `out`; the reply
//! names their hash and the record of what the hashes stand for, or the refusal.

use deep_catalog::{Format, Source};
use serde_json::{json, Map, Value};

use crate::{refused, table, Planted};

/// #194's planted packers, which a worker started with one runs in its `catalog` job.
pub use deep_catalog::PLANTED;

/// The job, or for any other op that names no path, the error every such job answers.
pub(crate) fn job(job: &crate::Job, planted: &Planted) -> (Value, Option<String>) {
    if job.s("op") != Some("catalog") {
        return (json!({"error": "a job names its path"}), None);
    }
    let plant = PLANTED
        .iter()
        .find(|p| planted.is(p))
        .and_then(|p| deep_catalog::Planted::parse(p))
        .unwrap_or_default();
    let Some(tables) = job.v.get("tables").and_then(Value::as_object) else {
        return (json!({"error": "a catalog job names its tables"}), None);
    };
    let Some(out) = job.s("out") else {
        return (json!({"error": "a catalog job names its out"}), None);
    };
    let sources = match sources(tables) {
        Ok(s) => s,
        Err(r) => return (r, None),
    };
    let schema = job.v.get("schema").cloned().unwrap_or(Value::Null);
    match deep_catalog::pack(&sources, &schema, plant) {
        Err(mut r) => {
            if let Some(o) = r.as_object_mut() {
                o.remove("ok");
            }
            (json!({"refused": r}), None)
        }
        Ok(p) => match std::fs::write(out, &p.bytes) {
            Err(_) => (json!({"error": "the catalog's out can't be written"}), None),
            Ok(()) => (
                json!({"catalog": {"sha256": p.sha256, "size": p.bytes.len(), "record": p.record}}),
                Some(p.sha256),
            ),
        },
    }
}

/// Each table's file, read in its format, each under the table probe's cap.
fn sources(tables: &Map<String, Value>) -> Result<Vec<Source>, Value> {
    let mut out = Vec::new();
    for (name, t) in tables {
        let path = t.get("path").and_then(Value::as_str);
        let format = match t.get("format").and_then(Value::as_str) {
            Some("csv") => Some(Format::Csv),
            Some("jsonl") => Some(Format::Jsonl),
            Some(_) => None,
            None => path.and_then(Format::of_path),
        };
        let (Some(path), Some(format)) = (path, format) else {
            return Err(json!({"error": "each table names its path and a format, csv or jsonl"}));
        };
        let Ok(bytes) = std::fs::read(path) else {
            return Err(refused("unreadable", json!({"table": name, "path": path})));
        };
        if bytes.len() > table::MAX_BYTES {
            let cap = json!({"table": name, "cap": "max_bytes", "limit": table::MAX_BYTES});
            return Err(refused("over_cap", cap));
        }
        out.push(Source {
            name: name.clone(),
            format,
            bytes,
        });
    }
    Ok(out)
}
