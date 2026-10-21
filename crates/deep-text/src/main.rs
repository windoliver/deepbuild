//! `deep-text <subcommand>`: JSON lines in, one JSON line out per input line, in order, exit 0; a
//! line that can't be read, or holds a number that isn't finite, a size that isn't above zero, a
//! weight outside 1..=1000 or a negative box side, answers `{"ok":false,"code":"bad_input"}`.
//! Subcommands: `fit` (the fit check of one Text item against its widest string) and `fonts` (the
//! bundled faces by role).

use std::io::{self, BufRead, Write};

use serde_json::{json, Map, Value};

use deep_text::{Align, Role, Shaper, Spec, FACES};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

/// A number field as f32: absent gives `default`; present but not a finite number gives `None`.
fn number(input: &Map<String, Value>, key: &str, default: f32) -> Option<f32> {
    match input.get(key) {
        None | Some(Value::Null) => Some(default),
        Some(value) => value.as_f64().map(|n| n as f32).filter(|n| n.is_finite()),
    }
}

fn fit_line(shaper: &mut Shaper, input: &Map<String, Value>) -> Value {
    let Some(text) = input.get("text").and_then(Value::as_str) else {
        return bad_input();
    };
    let bound = match input.get("number") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(bound)) => *bound,
        Some(_) => return bad_input(),
    };
    let role = match input.get("font") {
        None | Some(Value::Null) => Role::Body,
        Some(Value::String(name)) => match Role::parse(name) {
            Some(role) => role,
            None => return refused("bad_font"),
        },
        Some(_) => return bad_input(),
    };
    let (Some(size), Some(weight)) = (number(input, "size", 13.), number(input, "weight", 400.))
    else {
        return bad_input();
    };
    if size <= 0. || !(1. ..=1000.).contains(&weight.round()) {
        return bad_input();
    }
    let tabular = match input.get("numerals").and_then(Value::as_str) {
        None => bound,
        Some("tabular") => true,
        Some("proportional") => false,
        Some(_) => return bad_input(),
    };
    let (width, height) = match input.get("box") {
        None | Some(Value::Null) => (None, None),
        Some(Value::Object(limits)) => {
            let (Some(w), Some(h)) = (number(limits, "w", f32::NAN), number(limits, "h", f32::NAN))
            else {
                return bad_input();
            };
            if w < 0. || h < 0. {
                return bad_input();
            }
            (
                Some(w).filter(|w| !w.is_nan()),
                Some(h).filter(|h| !h.is_nan()),
            )
        }
        Some(_) => return bad_input(),
    };
    let max_lines = match input.get("max_lines") {
        None | Some(Value::Null) => None,
        Some(value) => match value.as_u64().and_then(|n| u16::try_from(n).ok()) {
            Some(n) => Some(n),
            None => return bad_input(),
        },
    };
    let mask = match input.get("overflow") {
        None | Some(Value::Null) => false,
        Some(Value::String(overflow)) if overflow == "ellipsis" => false,
        Some(Value::String(overflow)) if overflow == "mask" => true,
        Some(_) => return bad_input(),
    };
    let widest = match input.get("widest") {
        None | Some(Value::Null) => None,
        Some(Value::String(widest)) => Some(widest.as_str()),
        Some(_) => return bad_input(),
    };
    let spec = Spec {
        text,
        role,
        size,
        weight: weight.round() as u16,
        line_height: None,
        width,
        max_lines,
        align: Align::Start,
        bound,
        tabular,
        mask,
    };
    let fits_height =
        |lines: usize| height.is_none_or(|h| lines as f32 * spec.line_height() <= h + 0.01);
    let own = shaper.fit(&spec, None);
    let mut fits = own.fits && fits_height(own.lines);
    if let Some(widest) = widest {
        let widest = shaper.fit(&spec, Some(widest));
        fits = fits && widest.fits && fits_height(widest.lines);
    }
    let shaped = shaper.shape(&spec);
    json!({
        "ok": true,
        "fits": fits,
        "width": shaped.width,
        "height": shaped.lines as f32 * spec.line_height(),
        "lines": shaped.lines,
        "shown": shaped.shown,
        "numerals": own.numerals,
        "overflow": own.overflow,
    })
}

fn fonts_line() -> Value {
    let fonts: Vec<Value> = [Role::Body, Role::Mono]
        .iter()
        .map(|role| {
            let face = FACES
                .iter()
                .find(|face| face.role == *role && face.weight == 400)
                .expect("every role has a regular face");
            json!({"role": role.name(), "family": role.family(), "file": format!("crates/deep-text/fonts/{}", face.file)})
        })
        .collect();
    json!({"ok": true, "fonts": fonts})
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    let mut shaper = Shaper::new();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Object(input)) => match command.as_str() {
                "fit" => fit_line(&mut shaper, &input),
                "fonts" => fonts_line(),
                _ => refused("bad_command"),
            },
            _ => bad_input(),
        };
        writeln!(out, "{answer}").expect("stdout");
    }
}
