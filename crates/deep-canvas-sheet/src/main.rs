//! `deep-sheet <taste|view|render>`: JSON lines in, one JSON line out per input line, in order,
//! exit 0; a line that can't be read, lacks a required field or names an unknown `planted` value
//! answers `{"ok":false,"code":"bad_input"}`. `taste` and `view` are the #394 acceptance README's
//! surface; `render` draws each cell of a sheet from its still through its treatment, with its
//! cache key.

use std::io::{self, BufRead, Write};

use deep_canvas_sheet::{
    base64, captions, cell_key, hit, place, render, taste, Cell, Still, Treatment, GAP, SHOWS,
};
use serde_json::{json, Map, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str) -> Value {
    if code == "bad_input" {
        return bad_input();
    }
    json!({"ok": false, "code": code})
}

fn pair(value: Option<&Value>) -> Option<[u32; 2]> {
    match value?.as_array()?.as_slice() {
        [w, h] => Some([
            u32::try_from(w.as_u64()?).ok()?,
            u32::try_from(h.as_u64()?).ok()?,
        ]),
        _ => None,
    }
}

fn still(value: &Value) -> Option<Still> {
    let [width, height] = pair(value.get("size"))?;
    let rgba = base64(value.get("rgba")?.as_str()?)?;
    (u64::try_from(rgba.len()).ok()? == u64::from(width) * u64::from(height) * 4).then_some(Still {
        width,
        height,
        rgba,
    })
}

fn taste_line(input: &Map<String, Value>) -> Option<Value> {
    let ask = input.get("ask")?.as_object()?;
    let candidates = input
        .get("candidates")?
        .as_array()?
        .iter()
        .map(|c| {
            Some((
                c.get("option")?.as_str()?.to_string(),
                still(c.get("still")?)?,
            ))
        })
        .collect::<Option<Vec<_>>>()?;
    Some(match taste(ask, &candidates) {
        Ok(t) => json!({
            "ok": true,
            "ask": t.ask,
            "sheet": t.sheet,
            "dropped": t.dropped.iter().map(|d| json!({"option": d.option, "same_as": d.same_as})).collect::<Vec<_>>(),
        }),
        Err(code) => refused(code),
    })
}

fn rect(value: &Value) -> Option<[u32; 4]> {
    match value.as_array()?.as_slice() {
        [x, y, w, h] => {
            let n = |v: &Value| u32::try_from(v.as_u64()?).ok();
            Some([n(x)?, n(y)?, n(w)?, n(h)?])
        }
        _ => None,
    }
}

/// A sheet cell: its show names exactly one of a doc handle, an ask option, a time or a variant.
fn cell(c: &Value) -> Option<Cell> {
    match c
        .get("show")?
        .as_object()?
        .keys()
        .collect::<Vec<_>>()
        .as_slice()
    {
        [kind] if SHOWS.contains(&kind.as_str()) => {}
        _ => return None,
    }
    if let Some(t) = c.get("treatment") {
        Treatment::read(t.as_str()?)?;
    }
    Some(Cell {
        id: c.get("id")?.as_str()?.to_string(),
        size: pair(c.get("size"))?,
        names_option: c
            .get("names_option")
            .and_then(Value::as_str)
            .map(str::to_string),
        look: match c.get("look") {
            None => None,
            Some(l) => Some(l.as_str()?.to_string()),
        },
        highlights: match c.get("highlights") {
            None => Vec::new(),
            Some(h) => h
                .as_array()?
                .iter()
                .map(|h| rect(h.get("region")?))
                .collect::<Option<Vec<_>>>()?,
        },
    })
}

/// Renders each cell of a sheet from its still through its treatment, keyed for the texture cache.
fn render_line(input: &Map<String, Value>) -> Option<Value> {
    let look = input.get("look")?.as_str()?;
    let stills = input.get("stills")?.as_object()?;
    let mut out = Map::new();
    for c in input.get("sheet")?.get("cells")?.as_array()? {
        let id = cell(c)?.id;
        let treatment =
            Treatment::read(c.get("treatment").and_then(Value::as_str).unwrap_or("none"))?;
        let still = still(stills.get(&id)?)?;
        if pair(c.get("size"))? != [still.width, still.height] {
            // A cell renders at its exact size, never scaled.
            return Some(refused("sheet.size_mismatch"));
        }
        let pixels = render(&still, treatment);
        out.insert(
            id,
            json!({"key": cell_key(&still, treatment, look).hex(), "rgba": deep_canvas::base64::encode(&pixels)}),
        );
    }
    Some(json!({"ok": true, "cells": out}))
}

fn view_line(input: &Map<String, Value>) -> Option<Value> {
    let planted = match input.get("planted") {
        None => false,
        Some(p) if p.as_str() == Some("cell_click_answers") => true,
        Some(_) => return None,
    };
    let size = pair(input.get("view"))?;
    let card = input.get("card")?;
    let ask = card.get("ask")?.as_str()?;
    let card_size = pair(card.get("size"))?;
    let sheet = input.get("sheet")?;
    let cells = sheet
        .get("cells")?
        .as_array()?
        .iter()
        .map(cell)
        .collect::<Option<Vec<_>>>()?;
    let labels: Vec<String> = sheet
        .get("cells")?
        .as_array()?
        .iter()
        .map(|c| {
            c.get("label")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    let columns = match sheet.get("columns") {
        None => None,
        Some(c) if c.as_str() == Some("auto") => None,
        Some(c) => Some(usize::try_from(c.as_u64().filter(|&n| n > 0)?).ok()?),
    };
    let gap = match sheet.get("gap") {
        None => GAP,
        Some(g) => u32::try_from(g.as_u64()?).ok()?,
    };
    let clicks = input
        .get("inputs")?
        .as_array()?
        .iter()
        .map(|i| match i.get("click")?.as_array()?.as_slice() {
            [x, y] => Some([x.as_f64()?, y.as_f64()?]),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    let placed = match place(size, card_size, &cells, columns, gap) {
        Ok(p) => p,
        Err(code) => return Some(refused(code)),
    };
    // Preselection is session state; a cell click sets it and sends the hub nothing, since only
    // the question card answers.
    let mut preselect: Option<String> = None;
    let mut trace = Vec::with_capacity(clicks.len());
    for click in clicks {
        let mut sends = Vec::new();
        if let Some(option) = hit(&placed, click).and_then(|i| cells[i].names_option.clone()) {
            if planted {
                // The planted twin of criterion 1, reachable only through `planted`: it answers.
                sends.push(json!({"answer": {"ask": ask, "option": option}}));
            }
            preselect = Some(option);
        }
        trace.push(json!({"preselect": preselect, "sends": sends}));
    }
    let by_cell = |values: Vec<Value>| -> Map<String, Value> {
        cells.iter().map(|c| c.id.clone()).zip(values).collect()
    };
    let marks = placed.marks.iter().map(|m| {
        json!(m
            .iter()
            .map(|[right, below]| json!({"right": right, "below": below}))
            .collect::<Vec<_>>())
    });
    Some(json!({
        "ok": true,
        "card": placed.card,
        "sheet": placed.sheet,
        "cells": by_cell(placed.cells.iter().map(|r| json!(r)).collect()),
        "captions": by_cell(captions(&cells, &labels).into_iter().map(Value::from).collect()),
        "highlights": by_cell(marks.collect()),
        "trace": trace,
    }))
}

fn answer(command: &str, line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    let out = match command {
        "taste" => taste_line(&input),
        "view" => view_line(&input),
        "render" => render_line(&input),
        _ => None,
    };
    out.unwrap_or_else(bad_input)
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    let [command] = command.as_slice() else {
        eprintln!("deep-sheet: usage: deep-sheet taste | view | render");
        std::process::exit(2);
    };
    if !["taste", "view", "render"].contains(&command.as_str()) {
        eprintln!("deep-sheet: usage: deep-sheet taste | view | render");
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
