//! Mark set columns that read a table (#397), inlined from the evidence store `deep-show run`
//! writes: shared by the hub's render-back and `deep-canvas-render` (#1162).

use std::path::Path;

use deep_canvas_marks::key::sha256_hex;
use serde_json::{json, Map, Value};

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
            let dtype = probed
                .and_then(|c| c.iter().find(|c| c["name"] == field.as_str()))
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
                if derived.lineage.is_some() {
                    let key = keys.and_then(|k| k.get(i)).and_then(|c| c["raw"].as_str());
                    out["from"] = derived.from(key.unwrap_or(""));
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

const DEPTH: usize = 16;

struct Derived {
    lineage: Option<Value>,
    weakest: &'static str,
}

fn source_is_agent(source: &Value) -> bool {
    if source == "agent" {
        return true;
    }
    source
        .pointer("/job/input")
        .and_then(Value::as_object)
        .is_some_and(|inputs| {
            inputs
                .values()
                .flat_map(|files| files.as_array().into_iter().flatten())
                .any(|f| f["origin"] == "agent")
        })
}

impl Derived {
    fn of(record: &Value, evidence: Option<&Path>) -> Option<Derived> {
        Self::at(record, evidence, 0)
    }

    fn at(record: &Value, evidence: Option<&Path>, depth: usize) -> Option<Derived> {
        let agent = || Derived {
            lineage: None,
            weakest: "agent",
        };
        if source_is_agent(&record["source"]) {
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
        let weakest = if Self::inputs(&lineage).any(|(_, sha)| {
            depth >= DEPTH
                || evidence
                    .and_then(|e| std::fs::read(e.join("tables").join(format!("{sha}.json"))).ok())
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                    .and_then(|r| Self::at(&r, evidence, depth + 1))
                    .is_none_or(|d| d.weakest == "agent")
        }) {
            "agent"
        } else {
            "source"
        };
        Some(Derived {
            lineage: Some(lineage),
            weakest,
        })
    }

    fn inputs(lineage: &Value) -> impl Iterator<Item = (&str, &str)> {
        lineage["inputs"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(name, i)| Some((name.as_str(), i["sha256"].as_str()?)))
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    fn put_blob(root: &Path, bytes: &[u8]) -> String {
        let sha = sha256_hex(bytes);
        let dir = root.join(&sha[..2]);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(&sha[2..]), bytes).unwrap();
        sha
    }

    fn put_record(root: &Path, sha: &str, record: Value) {
        let dir = root.join("tables");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(format!("{sha}.json")), record.to_string()).unwrap();
    }

    #[test]
    fn derived_table_inherits_agent_origin_through_import_and_nested_derive() {
        let root =
            std::env::temp_dir().join(format!("deep-marks-vello-3569-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let imported_agent_csv = b"k,v\n1,10\n";
        let imported_agent_sha = put_blob(&root, imported_agent_csv);
        put_record(
            &root,
            &imported_agent_sha,
            json!({
                "sha256": imported_agent_sha,
                "kind": "table",
                "source": { "job": { "kind": "import", "tool": "table-import@1.0.0", "input": { "file": [{ "sha256": "0".repeat(64), "origin": "agent" }] } } }
            }),
        );
        let imported_fetched_csv = b"k,v\n1,20\n";
        let imported_fetched_sha = put_blob(&root, imported_fetched_csv);
        put_record(
            &root,
            &imported_fetched_sha,
            json!({
                "sha256": imported_fetched_sha,
                "kind": "table",
                "source": { "job": { "kind": "import", "tool": "table-import@1.0.0", "input": { "file": [{ "sha256": "1".repeat(64), "url": "https://example.test/a.csv", "fetched": 1 }] } } }
            }),
        );
        let lineage_agent = json!({
            "format": 1,
            "key": "k",
            "inputs": { "a": { "sha256": imported_agent_sha, "key": "k" }, "b": { "sha256": imported_fetched_sha, "key": "k" } },
            "rows": { "1": { "a": ["1"], "b": ["1"] } }
        });
        let lineage_agent_sha = put_blob(&root, lineage_agent.to_string().as_bytes());
        let derived_agent_record = json!({
            "source": { "job": { "kind": "table.derive", "tool": "table-derive@1.0.0", "input": { "a": imported_agent_sha, "b": imported_fetched_sha } } },
            "lineage": lineage_agent_sha
        });
        assert_eq!(
            Derived::of(&derived_agent_record, Some(&root))
                .unwrap()
                .weakest,
            "agent"
        );

        let lineage_fetched = json!({
            "format": 1,
            "key": "k",
            "inputs": { "b": { "sha256": imported_fetched_sha, "key": "k" } },
            "rows": { "1": { "b": ["1"] } }
        });
        let lineage_fetched_sha = put_blob(&root, lineage_fetched.to_string().as_bytes());
        let derived_fetched_record = json!({
            "source": { "job": { "kind": "table.derive", "tool": "table-derive@1.0.0", "input": { "b": imported_fetched_sha } } },
            "lineage": lineage_fetched_sha
        });
        assert_eq!(
            Derived::of(&derived_fetched_record, Some(&root))
                .unwrap()
                .weakest,
            "source"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
