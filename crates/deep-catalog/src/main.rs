//! `deep-catalog pack`: the decode worker's catalog job run alone, its proof surface. JSON lines in,
//! one JSON line out per input line, in order, exit 0. A line
//! `{"op": "pack", "tables": {<name>: {"path", "format"?}}, "schema", "out"?, "planted"?}` reads each
//! table's file (its format `csv` or `jsonl`, or read from the path's extension), packs the catalog
//! and answers `{"ok": true, "sha256", "size", "ms", "record"}`, writing the bytes to `out` when it
//! names a path; or a refusal `{"ok": false, "code", "what", ...}` naming what it refused. `ms` is
//! the pack's own wall time, the files' reads left out.

use std::io::{self, BufRead, Write};

use deep_catalog::{pack, Format, Planted, Source};
use serde_json::{json, Value};

fn bad_input(what: &str) -> Value {
    json!({"ok": false, "code": "bad_input", "what": what})
}

fn answer(line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input("a line is one JSON object");
    };
    if input.get("op").and_then(Value::as_str) != Some("pack") {
        return bad_input("the op is `pack`");
    }
    let planted = match input.get("planted").and_then(Value::as_str) {
        None => Planted::None,
        Some(name) => match Planted::parse(name) {
            Some(p) => p,
            None => return bad_input("no such planted packer"),
        },
    };
    let Some(tables) = input.get("tables").and_then(Value::as_object) else {
        return bad_input("`tables` names each table's file");
    };
    let mut sources = Vec::new();
    for (name, t) in tables {
        let Some(path) = t.get("path").and_then(Value::as_str) else {
            return bad_input("each table names its `path`");
        };
        let format = match t.get("format").and_then(Value::as_str) {
            Some("csv") => Some(Format::Csv),
            Some("jsonl") => Some(Format::Jsonl),
            Some(_) => None,
            None => Format::of_path(path),
        };
        let Some(format) = format else {
            return bad_input("a table's format is csv or jsonl");
        };
        let Ok(bytes) = std::fs::read(path) else {
            return json!({"ok": false, "code": "unreadable", "what": format!("`{path}` can't be read"), "path": path});
        };
        sources.push(Source {
            name: name.clone(),
            format,
            bytes,
        });
    }
    let schema = input.get("schema").cloned().unwrap_or(Value::Null);
    let started = std::time::Instant::now();
    let packed = pack(&sources, &schema, planted);
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    match packed {
        Err(refusal) => refusal,
        Ok(p) => {
            if let Some(out) = input.get("out").and_then(Value::as_str) {
                if std::fs::write(out, &p.bytes).is_err() {
                    return json!({"ok": false, "code": "unwritable", "what": format!("`{out}` can't be written"), "path": out});
                }
            }
            json!({"ok": true, "sha256": p.sha256, "size": p.bytes.len(), "ms": ms, "record": p.record})
        }
    }
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if command != ["pack"] {
        eprintln!("deep-catalog: usage: deep-catalog pack");
        std::process::exit(2);
    }
    let mut out = io::stdout().lock();
    for buf in io::stdin().lock().split(b'\n') {
        let Ok(buf) = buf else { break };
        let reply = match std::str::from_utf8(&buf) {
            Ok(text) if text.trim().is_empty() => continue,
            Ok(text) => answer(text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input("a line is UTF-8"),
        };
        if writeln!(out, "{reply}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
