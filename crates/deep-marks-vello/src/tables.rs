//! Mark set columns that read a table (#397), inlined from the evidence store `deep-show run`
//! writes: shared by the hub's render-back and `deep-canvas-render` (#1162).

use std::path::Path;

use deep_canvas_marks::key::sha256_hex;
use serde_json::{json, Map, Value};

use crate::fetched;

/// Why a table column can't be read: a code and the field's path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

fn refused(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Every mark set column of `doc` that reads a table (`{from: table asset ID, column: name}`,
/// Mark set and columns; Asset: tables), read from the `evidence` store a `deep-show run` wrote:
/// the table's bytes by the document asset's hash and its probe record beside them. Written in
/// place as the column's display values (a number column's as f64, a text column's cells NFC)
/// with its `trace`: the table, the column, its source and each cell's byte range, its raw bytes
/// as the table keeps them and the file's bytes at that range, so a check that quotes a cell
/// compares raw bytes.
pub fn tables(doc: &mut Map<String, Value>, evidence: Option<&Path>) -> Result<(), Refused> {
    let assets = doc.get("assets").cloned().unwrap_or(Value::Null);
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return Ok(());
    };
    for (id, item) in items.iter_mut() {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let Some(Value::Object(columns)) = item.pointer_mut("/params/columns") else {
            continue;
        };
        for (name, column) in columns.iter_mut() {
            let (Some(asset), Some(field)) = (
                column
                    .get("from")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                column
                    .get("column")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            ) else {
                continue;
            };
            let path = format!("items/{id}/params/columns/{name}");
            let Some(hash) = assets[&asset]["sha256"].as_str() else {
                return Err(refused("ref_unresolved", format!("{path}/from")));
            };
            // The evidence store keeps a file as `<first 2 hex>/<other 62 hex>` (packages/evidence).
            let file = evidence
                .filter(|_| hash.len() == 64)
                .and_then(|e| std::fs::read(e.join(&hash[..2]).join(&hash[2..])).ok())
                .ok_or_else(|| refused("asset_missing", format!("{path}: {hash}")))?;
            if sha256_hex(&file) != hash {
                return Err(refused("asset_mismatch", format!("{path}: {hash}")));
            }
            let record = evidence
                .and_then(|e| std::fs::read(e.join("tables").join(format!("{hash}.json"))).ok())
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .ok_or_else(|| refused("asset_missing", format!("{path}: {hash}")))?;
            let probed = record["probe"]["table"]["columns"].as_array();
            let probed = probed.and_then(|c| c.iter().find(|c| c["name"] == field.as_str()));
            let dtype = probed
                .and_then(|c| c["dtype"].as_str())
                .ok_or_else(|| refused("ref_unresolved", format!("{path}/column")))?;
            let cells = record["cells"][&field]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let derived = Derived::of(&record, evidence)
                .ok_or_else(|| refused("asset_missing", format!("{path}: lineage")))?;
            let keys = record["probe"]["table"]["key"]
                .as_str()
                .and_then(|k| record["cells"][k].as_array());
            let mut traced = Vec::with_capacity(cells.len());
            for (i, cell) in cells.iter().enumerate() {
                let (s, e) = (cell["bytes"][0].as_u64(), cell["bytes"][1].as_u64());
                let at = s.zip(e).map(|(s, e)| (s as usize, e as usize));
                let Some(bytes) = at.and_then(|(s, e)| file.get(s..e)) else {
                    return Err(refused("out_of_range", format!("{path}/from")));
                };
                let raw = cell["raw"].as_str().unwrap_or("");
                let mut out = json!({
                    "bytes": cell["bytes"], "text": deep_canvas::canon::nfc(raw),
                    "raw": deep_canvas::base64::encode(raw.as_bytes()),
                    "file": deep_canvas::base64::encode(bytes),
                });
                if let Some(lineage) = &derived.lineage {
                    let key = keys.and_then(|k| k.get(i)).and_then(|c| c["raw"].as_str());
                    out["from"] = derived.from(key.unwrap_or(""));
                    out["wrote"] =
                        json!(fetched::wrote(&record, lineage, &field, key.unwrap_or("")));
                }
                traced.push(out);
            }
            let texts = traced.iter().map(|c| c["text"].as_str().unwrap_or(""));
            let data = if dtype == "str" {
                json!(texts.collect::<Vec<_>>())
            } else {
                let mut out = Vec::with_capacity(cells.len() * 8);
                for t in texts {
                    out.extend_from_slice(&t.parse::<f64>().unwrap_or(f64::NAN).to_le_bytes());
                }
                json!(deep_canvas::base64::encode(&out))
            };
            let mut trace = json!({"table": asset, "column": field, "source": record["source"], "cells": traced});
            trace["unit"] = probed.map_or(Value::Null, |c| c["unit"].clone());
            trace["files"] = json!(fetched::files(&record, hash, evidence));
            trace["show"] = column.get("show").cloned().unwrap_or(Value::Null);
            if derived.lineage.is_some() {
                trace["weakest"] = json!(derived.weakest);
            }
            *column = json!({
                "dtype": if dtype == "str" { "str" } else { "f64" }, "len": cells.len(), "data": data,
                "trace": trace,
            });
        }
    }
    Ok(())
}

/// How deep a derived table's inputs are followed to the tables they came from.
const DEPTH: usize = 16;

/// What a table derived by a `table.derive` job (#3569; Asset: tables) traces to: its lineage
/// sidecar, read from the evidence store by the hash its record names, and its weakest input's
/// source, followed through every derived input to the tables they came from. A table that
/// isn't derived has neither.
struct Derived {
    lineage: Option<Value>,
    weakest: &'static str,
}

impl Derived {
    /// None when the record names a lineage the store doesn't hold, or one that isn't JSON.
    fn of(record: &Value, evidence: Option<&Path>) -> Option<Derived> {
        Self::at(record, evidence, 0)
    }

    fn at(record: &Value, evidence: Option<&Path>, depth: usize) -> Option<Derived> {
        let agent = || Derived {
            lineage: None,
            weakest: "agent",
        };
        if record["source"] == "agent" {
            return Some(agent());
        }
        if record["source"]["job"]["kind"] != "table.derive" {
            return Some(Derived {
                lineage: None,
                weakest: "source",
            });
        }
        let hash = record["lineage"].as_str()?;
        let bytes = evidence
            .filter(|_| hash.len() == 64)
            .and_then(|e| std::fs::read(e.join(&hash[..2]).join(&hash[2..])).ok())
            .filter(|b| sha256_hex(b) == hash)?;
        let lineage: Value = serde_json::from_slice(&bytes).ok()?;
        // An input the store holds no record of, or one past the depth, might have been an
        // agent's, so it counts as one.
        let weakest = Self::inputs(&lineage)
            .any(|(_, sha)| {
                depth >= DEPTH
                    || evidence
                        .and_then(|e| {
                            std::fs::read(e.join("tables").join(format!("{sha}.json"))).ok()
                        })
                        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                        .and_then(|r| Self::at(&r, evidence, depth + 1))
                        .is_none_or(|d| d.weakest == "agent")
            })
            .then_some("agent")
            .unwrap_or("source");
        Some(Derived {
            lineage: Some(lineage),
            weakest,
        })
    }

    /// Each input of the lineage by name, with the hash of its file.
    fn inputs(lineage: &Value) -> impl Iterator<Item = (&str, &str)> {
        lineage["inputs"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(name, i)| Some((name.as_str(), i["sha256"].as_str()?)))
    }

    /// The input rows that fed the output row `key`: for each input, its file's hash and the keys
    /// of its rows, as the lineage lists them.
    fn from(&self, key: &str) -> Value {
        let Some(lineage) = &self.lineage else {
            return Value::Null;
        };
        let rows = &lineage["rows"][key];
        let list: Vec<Value> = Self::inputs(lineage)
            .map(|(name, sha)| json!({"input": name, "table": sha, "keys": rows[name].clone()}))
            .collect();
        Value::Array(list)
    }
}
