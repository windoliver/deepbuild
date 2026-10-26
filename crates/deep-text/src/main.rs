//! `deep-text <subcommand>`: JSON lines in, one JSON line out per input line, in order, exit 0; a
//! line that can't be read, or holds a number that isn't finite, a size that isn't above zero, a
//! weight outside 1..=1000 or a negative box side, answers `{"ok":false,"code":"bad_input"}`.
//! Subcommands: `fit` (the fit check of one Text item against its widest string), `fonts` (the
//! bundled faces by role), and `breaks`, `graphemes` and `bidi` (issue #381: the shaper's UAX #14
//! line-break opportunities, UAX #29 grapheme ends and UAX #9 levels and visual order, as code point
//! offsets). `breaks` takes `planted: "space_breaker"` and `bidi` `planted: "logical_arabic"`, the
//! acceptance suite's wrong programs.

use std::io::{self, BufRead, Write};

use serde_json::{json, Map, Value};

use deep_text::{unicode, Align, Dir, Role, Shaper, Spec, FACES};

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

/// The planted field: absent, or the one name a subcommand knows.
fn planted<'a>(input: &'a Map<String, Value>, name: &str) -> Option<Option<&'a str>> {
    match input.get("planted") {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(p)) if p == name => Some(Some(p)),
        Some(_) => None,
    }
}

fn breaks_line(input: &Map<String, Value>) -> Value {
    let (Some(text), Some(plant)) = (
        input.get("text").and_then(Value::as_str),
        planted(input, "space_breaker"),
    ) else {
        return bad_input();
    };
    let breaks = if plant.is_some() {
        // The wrong breaker: after each run of spaces, and at the end, nowhere else.
        let chars: Vec<char> = text.chars().collect();
        (1..=chars.len())
            .filter(|&k| k == chars.len() || (chars[k - 1] == ' ' && chars[k] != ' '))
            .collect()
    } else {
        unicode::breaks(text)
    };
    json!({"ok": true, "breaks": breaks})
}

fn graphemes_line(input: &Map<String, Value>) -> Value {
    match input.get("text").and_then(Value::as_str) {
        Some(text) => json!({"ok": true, "breaks": unicode::graphemes(text)}),
        None => bad_input(),
    }
}

/// True for a character in one of the Arabic blocks.
fn arabic(c: char) -> bool {
    matches!(u32::from(c), 0x0600..=0x06ff | 0x0750..=0x077f | 0x0870..=0x08ff | 0xfb50..=0xfdff
        | 0xfe70..=0xfeff | 0x10ec0..=0x10eff | 0x1ee00..=0x1eeff)
}

fn bidi_line(shaper: &mut Shaper, input: &Map<String, Value>) -> Value {
    let dir = match input.get("dir").and_then(Value::as_str) {
        Some("auto") => Dir::Auto,
        Some("ltr") => Dir::Ltr,
        Some("rtl") => Dir::Rtl,
        _ => return bad_input(),
    };
    let (Some(text), Some(plant)) = (
        input.get("text").and_then(Value::as_str),
        planted(input, "logical_arabic"),
    ) else {
        return bad_input();
    };
    let mut bidi = shaper.bidi(text, dir);
    if plant.is_some() {
        // The wrong layout: each run of Arabic at an odd level drawn in logical order.
        let chars: Vec<char> = text.chars().collect();
        let odd_arabic = |i: usize| arabic(chars[i]) && bidi.levels[i].is_some_and(|l| l % 2 == 1);
        let mut start = 0;
        while start < bidi.order.len() {
            let mut end = start;
            while end < bidi.order.len() && odd_arabic(bidi.order[end]) {
                end += 1;
            }
            bidi.order[start..end].sort_unstable();
            start = end.max(start + 1);
        }
    }
    json!({"ok": true, "paragraph": bidi.paragraph, "levels": bidi.levels, "order": bidi.order})
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
                "breaks" => breaks_line(&input),
                "graphemes" => graphemes_line(&input),
                "bidi" => bidi_line(&mut shaper, &input),
                _ => refused("bad_command"),
            },
            _ => bad_input(),
        };
        writeln!(out, "{answer}").expect("stdout");
    }
}
