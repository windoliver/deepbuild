//! `deep-input input`: one session of the input module per JSON line in, one answer per line
//! out, in order, exit 0; a line that can't be read answers `{"ok":false,"code":"bad_input"}`.
//! In: `{doc, viewport, fps?, host?, reduced_motion?, planted?, fill?, summary?, ops}`. Out:
//! `{ok, hash, fork_at, track?, entries, results}`, one result per op.

use std::io::{self, BufRead, Write};
use std::time::Instant;

use deep_canvas_input::session::{Planted, Session};
use serde_json::{json, Map, Value};

fn bad(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

fn run(line: &Map<String, Value>) -> Value {
    let Some(doc) = line.get("doc") else { return bad("bad_input") };
    let num = |v: &Value| v.as_f64();
    let viewport = match line.get("viewport").and_then(Value::as_array) {
        Some(a) if a.len() == 2 => match (num(&a[0]), num(&a[1])) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => [w, h],
            _ => return bad("bad_input"),
        },
        None => [640.0, 360.0],
        _ => return bad("bad_input"),
    };
    let fps = match line.get("fps").and_then(Value::as_array) {
        None => (60, 1),
        Some(a) => match (a.first().and_then(Value::as_u64), a.get(1).and_then(Value::as_u64)) {
            (Some(p), Some(q)) if p > 0 && q > 0 => (p as u32, q as u32),
            _ => return bad("bad_input"),
        },
    };
    // The app and the web player run the same module: the host changes nothing it computes.
    if !matches!(line.get("host").and_then(Value::as_str), None | Some("app") | Some("web_player")) {
        return bad("bad_input");
    }
    let planted = match line.get("planted").and_then(Value::as_str) {
        None => Planted::default(),
        Some(name) => match Planted::named(name) {
            Some(p) => p,
            None => return bad("bad_input"),
        },
    };
    let reduced = line.get("reduced_motion").and_then(Value::as_bool).unwrap_or(false);
    let mut s = match Session::new(doc, viewport, fps, reduced, planted, &[]) {
        Ok(s) => s,
        Err(r) => return json!({"ok": false, "code": r.code, "path": r.path}),
    };
    if let Some(fill) = line.get("fill") {
        let control = fill.get("control").and_then(Value::as_str).unwrap_or("");
        let count = fill.get("count").and_then(Value::as_u64).unwrap_or(0) as usize;
        if let Err(r) = s.fill(control, count) {
            return json!({"ok": false, "code": r.code, "path": r.path});
        }
    }
    let mut results = Vec::new();
    for op in line.get("ops").and_then(Value::as_array).into_iter().flatten() {
        let Some(op) = op.as_object() else { return bad("bad_input") };
        let result = if op.get("op").and_then(Value::as_str) == Some("lookup") {
            lookup(&s, op)
        } else {
            s.op(op).map_err(|r| json!({"ok": false, "code": r.code, "path": r.path}))
        };
        match result {
            Ok(r) => results.push(r),
            Err(e) => return e,
        }
    }
    let mut out = json!({"ok": true, "hash": s.track.hash(), "fork_at": s.track.fork_at, "entries": s.track.len(), "results": results});
    if !line.get("summary").and_then(Value::as_bool).unwrap_or(false) {
        out["track"] = s.track.to_json();
    }
    out
}

/// The budget probe: each time's value, `runs` times over, and the whole probe's wall time.
fn lookup(s: &Session, op: &Map<String, Value>) -> Result<Value, Value> {
    let control = op.get("control").and_then(Value::as_str).unwrap_or("");
    let times: Vec<i64> = op
        .get("times")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_i64).collect())
        .ok_or_else(|| bad("bad_input"))?;
    let runs = op.get("runs").and_then(Value::as_u64).unwrap_or(1).max(1);
    let values: Vec<Value> = times.iter().map(|t| s.lookup(control, *t)).collect();
    let started = Instant::now();
    let mut sink = 0usize;
    for _ in 0..runs {
        for t in &times {
            sink = sink.wrapping_add(usize::from(s.lookup(control, *t).is_null()));
        }
    }
    let ns = started.elapsed().as_nanos() as u64;
    Ok(json!({"values": values, "ns": ns, "misses": sink}))
}

fn main() {
    let sub = std::env::args().nth(1).unwrap_or_default();
    if sub != "input" {
        eprintln!("usage: deep-input input < lines");
        std::process::exit(2);
    }
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Object(m)) => run(&m),
            _ => bad("bad_input"),
        };
        let _ = writeln!(out, "{answer}");
    }
}
