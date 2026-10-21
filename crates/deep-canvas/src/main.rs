//! `deep-canvas <subcommand>`: JSON lines in, one JSON line out per input line, in order, exit
//! 0; a line that can't be read answers `{"ok":false,"code":"bad_input"}`. Subcommands:
//! `parse <time|unit|path|handle|id>`, `check`, `apply`, `canonical`, `color`.

use std::io::{self, BufRead, Write};

use serde_json::{json, Map, Value};

use deep_canvas::color::{
    linear_to_oklab, linear_to_srgb, oklab_to_linear, oklab_to_oklch, oklch_to_oklab,
    srgb_to_linear, LinearRgb, Oklab, Oklch, Srgb,
};
use deep_canvas::document::{apply, canonical, check};
use deep_canvas::grammar::{Handle, Id, Path, Time, TimeContext, UnitContext, UnitLiteral};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

fn accepted(printed: String, value: Value) -> Value {
    json!({"ok": true, "printed": printed, "value": value})
}

/// The `fps` field as `(p, q)`, `[60, 1]` when absent; `None` when present but not a rate.
fn fps_of(input: &Map<String, Value>) -> Option<(u32, u32)> {
    match input.get("fps") {
        None | Some(Value::Null) => Some((60, 1)),
        Some(Value::Array(pair)) if pair.len() == 2 => {
            let p = pair[0].as_u64().and_then(|n| u32::try_from(n).ok())?;
            let q = pair[1].as_u64().and_then(|n| u32::try_from(n).ok())?;
            Some((p, q))
        }
        _ => None,
    }
}

fn parse_line(grammar: &str, input: &Map<String, Value>) -> Value {
    let Some(text) = input.get("text").and_then(Value::as_str) else {
        return bad_input();
    };
    match grammar {
        "id" => match Id::parse(text) {
            Ok(id) => {
                let segments: Vec<&str> = id.segments().collect();
                accepted(id.print(), json!({"segments": segments}))
            }
            Err(r) => refused(r.code),
        },
        "time" => {
            let Some(frame_rate) = fps_of(input) else {
                return bad_input();
            };
            let ctx = TimeContext {
                frame_rate,
                ..TimeContext::default()
            };
            // A literal that parses but can't resolve with only a frame rate is refused too;
            // every refusal of the time grammar carries `bad_time`.
            match Time::parse(text).and_then(|t| t.resolve(&ctx).map(|f| (t, f))) {
                Ok((time, flicks)) => accepted(time.print(), json!({"flicks": flicks.to_string()})),
                Err(_) => refused("bad_time"),
            }
        }
        "unit" => {
            let unit = match input.get("unit") {
                None | Some(Value::Null) => "u",
                Some(Value::String(u)) => u.as_str(),
                _ => return bad_input(),
            };
            let ctx = UnitContext::default();
            match UnitLiteral::parse(text).and_then(|l| l.convert(unit, &ctx).map(|v| (l, v))) {
                Ok((literal, value)) => accepted(
                    literal.print(),
                    json!({"num": value.num().to_string(), "den": value.den().to_string()}),
                ),
                Err(_) => refused("bad_unit"),
            }
        }
        "path" => match Path::parse(text) {
            Ok(path) => {
                let fields = path.fields();
                accepted(
                    path.print(),
                    json!({
                        "section": path.section().as_str(),
                        "id": path.id().as_str(),
                        "sub": path.sub(),
                        "fields": fields,
                    }),
                )
            }
            Err(r) => refused(r.code),
        },
        "handle" => match Handle::parse(text) {
            Ok(handle) => {
                let mut value = Map::new();
                value.insert("scheme".into(), json!(handle.scheme().as_str()));
                value.insert("id".into(), json!(handle.id().as_str()));
                if let Some(fragment) = handle.fragment() {
                    value.insert("fragment".into(), json!(fragment));
                }
                accepted(handle.print(), Value::Object(value))
            }
            Err(r) => refused(r.code),
        },
        _ => bad_input(),
    }
}

fn color_line(input: &Map<String, Value>) -> Value {
    let (Some(from), Some(to)) = (
        input.get("from").and_then(Value::as_str),
        input.get("to").and_then(Value::as_str),
    ) else {
        return bad_input();
    };
    let Some(value) = input.get("value").and_then(Value::as_array) else {
        return bad_input();
    };
    if value.len() != 3 {
        return bad_input();
    }
    let v: Vec<f64> = value.iter().filter_map(Value::as_f64).collect();
    if v.len() != 3 || v.iter().any(|x| !x.is_finite()) {
        return bad_input();
    }
    // Every space goes through OKLab.
    let lab = match from {
        "srgb" => linear_to_oklab(srgb_to_linear(Srgb {
            r: v[0],
            g: v[1],
            b: v[2],
        })),
        "linear" => linear_to_oklab(LinearRgb {
            r: v[0],
            g: v[1],
            b: v[2],
        }),
        "oklab" => Oklab {
            l: v[0],
            a: v[1],
            b: v[2],
        },
        "oklch" => oklch_to_oklab(Oklch {
            l: v[0],
            c: v[1],
            h: v[2],
        }),
        _ => return bad_input(),
    };
    let out = match to {
        "srgb" => {
            let c = linear_to_srgb(oklab_to_linear(lab));
            [c.r, c.g, c.b]
        }
        "linear" => {
            let c = oklab_to_linear(lab);
            [c.r, c.g, c.b]
        }
        "oklab" => [lab.l, lab.a, lab.b],
        "oklch" => {
            let c = oklab_to_oklch(lab);
            [c.l, c.c, c.h]
        }
        _ => return bad_input(),
    };
    if out.iter().any(|x| !x.is_finite()) {
        return bad_input();
    }
    json!({"value": out})
}

fn answer(command: &[String], line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    match command {
        [parse, grammar] if parse == "parse" => parse_line(grammar, &input),
        [name] if name == "check" => match input.get("doc") {
            Some(doc) => check(doc).to_json(),
            None => bad_input(),
        },
        [name] if name == "apply" => {
            let (Some(doc), Some(writer), Some(patches)) = (
                input.get("doc"),
                input.get("writer").and_then(Value::as_str),
                input.get("patches").and_then(Value::as_array),
            ) else {
                return bad_input();
            };
            apply(doc, writer, patches).to_json()
        }
        [name] if name == "canonical" => match input.get("doc").map(canonical) {
            Some(Ok(c)) => json!({"bytes": c.bytes, "sha256": c.sha256}),
            Some(Err(e)) => {
                json!({"ok": false, "code": "out_of_range", "path": e.path, "what": e.what})
            }
            None => bad_input(),
        },
        [name] if name == "color" => color_line(&input),
        _ => bad_input(),
    }
}

fn known(command: &[String]) -> bool {
    match command {
        [parse, grammar] if parse == "parse" => {
            ["time", "unit", "path", "handle", "id"].contains(&grammar.as_str())
        }
        [name] => ["check", "apply", "canonical", "color"].contains(&name.as_str()),
        _ => false,
    }
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if !known(&command) {
        eprintln!(
            "deep-canvas: usage: deep-canvas parse <time|unit|path|handle|id> | check | apply | canonical | color"
        );
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
        // One answer per line, whatever the line holds: an empty one or one that isn't UTF-8 is
        // `bad_input`, so answers stay in step with inputs.
        let answer = match std::str::from_utf8(&buf) {
            Ok(text) => answer(&command, text.trim_end_matches(['\n', '\r'])),
            Err(_) => bad_input(),
        };
        let text = serde_json::to_string(&answer).unwrap_or_else(|_| bad_input().to_string());
        if writeln!(out, "{text}").is_err() {
            break;
        }
    }
    let _ = out.flush();
}
