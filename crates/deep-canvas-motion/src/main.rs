//! `deep-motion <eval|insert|run>`: JSON lines in, one JSON line out per input line, in order,
//! exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value
//! answers `{"ok":false,"code":"bad_input"}`. The surface is the #391 acceptance README's.

use std::io::{self, BufRead, Write};

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_motion::clock::{run, Mode};
use deep_canvas_motion::doc::Refused;
use deep_canvas_motion::eval::{frame, position, Validity};
use deep_canvas_motion::insert::insert;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refusal(r: Refused) -> Value {
    json!({"ok": false, "code": r.code, "path": r.path})
}

fn flicks(value: Option<&Value>) -> Option<i64> {
    value.and_then(Value::as_i64)
}

fn eval_line(input: &Map<String, Value>) -> Value {
    let (Some(Value::Object(doc)), Some(Value::Array(times))) =
        (input.get("doc"), input.get("times"))
    else {
        return bad_input();
    };
    let Some(times) = times
        .iter()
        .map(|t| flicks(Some(t)))
        .collect::<Option<Vec<_>>>()
    else {
        return bad_input();
    };
    let program = match Program::compile(doc) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let motion = &program.motion;
    let mut frames = Vec::with_capacity(times.len());
    let mut previous: Option<i64> = None;
    for &t in &times {
        let f = frame(doc, &program, t, Validity::Full);
        let passes = previous.map_or(0, |p| {
            let (_, before) = position(motion, p);
            (f.pass - before).max(0)
        });
        let channels: Map<String, Value> = f
            .channels
            .iter()
            .map(|(id, s)| {
                let value = match s.value.as_slice() {
                    [one] => json!(one),
                    many => json!(many),
                };
                (
                    id.clone(),
                    json!({"value": value, "iterations": s.iterations}),
                )
            })
            .collect();
        let placements: Map<String, Value> = motion
            .placements
            .iter()
            .zip(&f.placements)
            .map(|(p, (id, local))| {
                let wraps =
                    previous.map_or(0, |prev| p.wraps(motion, position(motion, prev).0, f.doc_t));
                (
                    id.clone(),
                    json!({
                        "iteration": local.map(|l| l.iteration),
                        "local": local.map(|l| l.local),
                        "passes": wraps,
                    }),
                )
            })
            .collect();
        frames.push(json!({
            "t": f.t,
            "doc_t": f.doc_t,
            "pass": f.pass,
            "passes": passes,
            "items": f.items,
            "channels": channels,
            "placements": placements,
            "valid_until": f.valid_until,
        }));
        previous = Some(t);
    }
    let markers: Map<String, Value> = motion
        .markers
        .iter()
        .map(|m| {
            (
                m.id.clone(),
                json!({"kind": m.kind, "t": m.start, "end": m.end}),
            )
        })
        .collect();
    let cuts: Vec<Value> = motion
        .cuts
        .iter()
        .map(|c| json!({"id": c.id, "from": c.from, "to": c.to, "t": c.at}))
        .collect();
    json!({"ok": true, "frames": frames, "markers": markers, "cuts": cuts})
}

fn insert_line(input: &Map<String, Value>) -> Value {
    let (Some(doc), Some(Value::String(channel)), Some(t)) = (
        input.get("doc"),
        input.get("channel"),
        flicks(input.get("t")),
    ) else {
        return bad_input();
    };
    match insert(doc, channel, t) {
        Ok((doc, key)) => json!({"ok": true, "doc": doc, "key": key}),
        Err(r) => refusal(r),
    }
}

fn run_line(input: &Map<String, Value>) -> Value {
    let (Some(Value::Object(doc)), Some(to)) = (input.get("doc"), flicks(input.get("to"))) else {
        return bad_input();
    };
    let mode = match input.get("mode").and_then(Value::as_str) {
        Some("armed") => Mode::Armed,
        Some("every_vsync") => Mode::EveryVsync,
        _ => return bad_input(),
    };
    let validity = match input.get("planted") {
        None => Validity::Full,
        Some(Value::String(p)) if p == "valid_until_ignores_placements" => {
            Validity::IgnorePlacements
        }
        Some(_) => return bad_input(),
    };
    let hz = match input.get("refresh_hz") {
        None => 60,
        Some(v) => match v.as_i64() {
            Some(hz) if hz > 0 => hz,
            _ => return bad_input(),
        },
    };
    // A display rate whose frame isn't a whole number of flicks is not a valid rate.
    if FLICKS_PER_SECOND % hz != 0 || to < 0 {
        return bad_input();
    }
    let program = match Program::compile(doc) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let mut vsyncs = Vec::new();
    run(
        doc,
        &program,
        to,
        FLICKS_PER_SECOND / hz,
        mode,
        validity,
        |v| {
            vsyncs.push(json!({
                "t": v.t,
                "presented": v.presented,
                "valid_until": v.shown.valid_until,
                "items": v.shown.items,
            }));
        },
    );
    json!({"ok": true, "vsyncs": vsyncs})
}

fn answer(command: &str, line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    match command {
        "eval" => eval_line(&input),
        "insert" => insert_line(&input),
        "run" => run_line(&input),
        _ => bad_input(),
    }
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    let [command] = command.as_slice() else {
        eprintln!("deep-motion: usage: deep-motion eval | insert | run");
        std::process::exit(2);
    };
    if !["eval", "insert", "run"].contains(&command.as_str()) {
        eprintln!("deep-motion: usage: deep-motion eval | insert | run");
        std::process::exit(2);
    }
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let answer = match std::str::from_utf8(&buf) {
            Ok(text) => answer(command, text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input(),
        };
        let text = serde_json::to_string(&answer).unwrap_or_else(|_| bad_input().to_string());
        if writeln!(out, "{text}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
