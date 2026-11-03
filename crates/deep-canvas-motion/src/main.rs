//! `deep-motion <eval|insert|run>`: JSON lines in, one JSON line out per input line, in order,
//! exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value
//! answers `{"ok":false,"code":"bad_input"}`. The surface is the #391 acceptance README's, and
//! `eval`'s `look`, `track`, `cameras` and `hash` the #417 one's.

use std::io::{self, BufRead, Write};

use deep_canvas::canon::revision_hash;
use deep_canvas::document::DocShape;
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas_motion::clock::{run, Mode};
use deep_canvas_motion::curve::Ease;
use deep_canvas_motion::doc::{feel_of, Feel, Refused};
use deep_canvas_motion::eval::{frame, position, Validity};
use deep_canvas_motion::input::Entry;
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

/// The request's input track, or `None` for an entry that isn't `{t, seq, control, value}`.
fn track_of(value: Option<&Value>) -> Option<Vec<Entry>> {
    let Some(value) = value else {
        return Some(Vec::new());
    };
    value
        .as_array()?
        .iter()
        .map(|e| {
            Some(Entry {
                t: flicks(e.get("t"))?,
                seq: e.get("seq").and_then(Value::as_i64)?,
                control: e.get("control").and_then(Value::as_str)?.to_string(),
                value: e.get("value")?.clone(),
            })
        })
        .collect()
}

/// The look's time feel: a look@1, or a shipped look's ID; at its defaults with no look.
fn look_feel(look: Option<&Value>, frame_rate: (u32, u32)) -> Result<Feel, Value> {
    let def = match look {
        None => return Ok(Feel::default()),
        Some(Value::String(id)) => deep_canvas_marks::look::shipped(id).ok_or_else(|| {
            refusal(Refused {
                code: "ref_unresolved",
                path: "look".into(),
            })
        })?,
        Some(def @ Value::Object(_)) => def.clone(),
        Some(_) => return Err(bad_input()),
    };
    let Value::Object(def) = def else {
        return Err(bad_input());
    };
    feel_of(&def, frame_rate).map_err(refusal)
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
    // The planted twin (#417 AC10) reads time.state's ease as linear.
    let linear = match input.get("planted") {
        None => false,
        Some(Value::String(p)) if p == "state_ease_linear" => true,
        Some(_) => return bad_input(),
    };
    let Some(track) = track_of(input.get("track")) else {
        return bad_input();
    };
    let program = match Program::compile(doc) {
        Ok(p) => p,
        Err(r) => return refusal(r),
    };
    let mut feel = match look_feel(input.get("look"), program.motion.frame_rate) {
        Ok(feel) => feel,
        Err(answer) => return answer,
    };
    if linear {
        feel.ease = Ease::Linear;
    }
    let Some(program) = program.with_inputs(feel, &track) else {
        return bad_input();
    };
    // The document's own revision hash: the look, the track and the times never enter it.
    let value = Value::Object(doc.clone());
    let hash = match revision_hash(
        &value,
        &DocShape::new(&value, &deep_canvas::kinds::registry()),
    ) {
        Ok(hash) => hash,
        Err(e) => return json!({"ok": false, "code": "out_of_range", "path": e.path}),
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
            "cameras": f.cameras.iter().map(|(id, target)| (id.clone(), json!({"target": target}))).collect::<Map<String, Value>>(),
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
    json!({"ok": true, "frames": frames, "markers": markers, "cuts": cuts, "hash": hash})
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
    let mut out = io::stdout().lock();
    for buf in io::stdin().lock().split(b'\n') {
        let Ok(buf) = buf else { break };
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
