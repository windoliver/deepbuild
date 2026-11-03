//! The marks2d module's check over a document the core check passed, in a look: everything the
//! draw list refuses becomes an issue naming its item (a star past 200 vertices, a fifth mask, a
//! mark set's repeated key), and wherever status can show, an adjust that brings a role its item
//! uses within the status distance is refused, naming the role (Item and kind: adjust).

use serde_json::{json, Map, Value};

use deep_canvas::document::Issue;

use crate::look::{self, Look};
use crate::paint::Adjust;
use crate::scene::{self, object_or_empty, Palette, Record, Rgb};

/// Every look role an item's paint names, sorted and once each.
fn roles(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                match (k.as_str(), v) {
                    ("role", Value::String(r)) if !out.contains(r) => out.push(r.clone()),
                    _ => roles(v, out),
                }
            }
        }
        Value::Array(list) => list.iter().for_each(|v| roles(v, out)),
        _ => {}
    }
}

/// An adjust's issues in one theme: the first role it brings within the status distance.
fn adjust_issue(
    id: &str,
    item: &Value,
    adjust: &Adjust,
    palette: &Palette,
    theme: &'static str,
    status: &look::Status,
) -> Option<Issue> {
    let mut used = Vec::new();
    if let Some(paint) = item.get("params").and_then(|p| p.get("paint")) {
        roles(paint, &mut used);
    }
    used.sort();
    for role in used {
        let Some(color) = palette.get(&role) else {
            continue;
        };
        let shown: Rgb = adjust.rgb(*color);
        let near = status
            .colors
            .iter()
            .find(|(_, s)| look::distance(shown, **s) < status.min_distance);
        if let Some((state, _)) = near {
            return Some(Issue {
                fix:
                    "Change the adjust, or the role, so the item's colors keep the status distance."
                        .into(),
                ..Issue::error(
                    "status_distance",
                    id,
                    format!("items/{id}/adjust"),
                    json!({"role": role, "state": state, "theme": theme}),
                    &format!("the adjust brings `{role}` within the status distance of {state}"),
                )
            });
        }
    }
    None
}

/// Every number the document's mark sets and axes show, with what each traces to (Honest numbers,
/// the check), and the issues tracing finds: a table's cell whose kept bytes differ from the
/// file's (`table_cell_changed`, naming its row), and a table an agent wrote shown where a status
/// or a reading is bound (`number_unsourced`: its numbers are story numbers).
pub fn numbers(doc: &Map<String, Value>) -> (Vec<Value>, Vec<Issue>) {
    let items = object_or_empty(doc.get("items"));
    let binds = ["status_bindings", "bound_values"].iter().any(|k| {
        doc.get(*k)
            .and_then(Value::as_object)
            .is_some_and(|b| !b.is_empty())
    });
    let (mut shown, mut issues) = (Vec::new(), Vec::new());
    for (id, item) in items {
        let found = crate::data::numbers(id, item, items);
        let mut named = Vec::new();
        for n in &found {
            let name = match n["row"].as_str() {
                Some(row) => format!("{id}#{row}"),
                None => id.clone(),
            };
            if binds && n["source"]["origin"] == "agent" && !named.contains(&name) {
                issues.push(Issue::error(
                    "number_unsourced",
                    &name,
                    format!("items/{id}/params"),
                    n["text"].clone(),
                    "shows a number from a table an agent wrote, a story number, where a status or a reading is bound; read it from a fetched table or bind it to a reading",
                ));
                named.push(name);
            }
        }
        shown.extend(found);
        issues.extend(changed_cells(id, item));
    }
    (shown, issues)
}

/// A table cell quoted by a mark set whose bytes, as the table keeps them, differ from the file's
/// bytes at its range: the trace compares raw bytes, never a normalized form.
fn changed_cells(id: &str, item: &Value) -> Vec<Issue> {
    let p = object_or_empty(item.get("params"));
    let columns = object_or_empty(p.get("columns"));
    let keys = p
        .get("key")
        .and_then(Value::as_str)
        .and_then(|k| columns.get(k));
    let key_of = |row: usize| -> String {
        let cell = keys.and_then(|k| k.get("data")).and_then(|d| d.get(row));
        match (cell, keys.and_then(|k| k.get("trace"))) {
            (Some(Value::String(s)), _) => s.clone(),
            (_, Some(t)) => t["cells"][row]["text"]
                .as_str()
                .map_or(row.to_string(), str::to_string),
            _ => row.to_string(),
        }
    };
    let mut out = Vec::new();
    for (name, c) in columns {
        let Some(cells) = c
            .get("trace")
            .and_then(|t| t.get("cells"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for (row, cell) in cells.iter().enumerate() {
            if cell.get("raw") != cell.get("file") {
                out.push(Issue::error(
                    "table_cell_changed",
                    &format!("{id}#{}", key_of(row)),
                    format!("items/{id}/params/columns/{name}"),
                    json!({"row": row, "bytes": cell.get("bytes")}),
                    "the table keeps this cell's bytes changed from the file's; probe the file again so each cell keeps its raw bytes",
                ));
            }
        }
    }
    out
}

/// Categories a chart tells apart by color alone keep the look's data distance as seen and under
/// simulated protanopia, deuteranopia and tritanopia, unless their marks also differ by shape,
/// dash or a direct label (Scale and encode). Refused naming the pair.
fn roles_apart(items: &Map<String, Value>, look: &Look) -> Vec<Issue> {
    let mut out = Vec::new();
    for (scale_id, scale) in items {
        let p = object_or_empty(scale.get("params"));
        if scale.get("kind").and_then(Value::as_str) != Some("scale@1")
            || p.get("type").and_then(Value::as_str) != Some("ordinal")
        {
            continue;
        }
        let (Some(domain), Some(range)) = (
            p.get("domain").and_then(Value::as_array),
            p.get("range").and_then(Value::as_array),
        ) else {
            continue;
        };
        // Each role's marks, by how they look apart from color: mark type, dash, shape, label.
        let mut styles: Vec<(String, Vec<Value>)> = Vec::new();
        for item in items.values() {
            let mp = object_or_empty(item.get("params"));
            let enc = mp.get("encode").and_then(|e| e.get("role"));
            if enc.and_then(|e| e.get("scale")).and_then(Value::as_str) != Some(scale_id) {
                continue;
            }
            let column = enc.and_then(|e| e.get("column")).and_then(Value::as_str);
            let Some(category) = column
                .and_then(|c| mp.get("columns").and_then(|cs| cs.get(c)))
                .and_then(|c| c.get("const"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Some(i) = domain.iter().position(|d| d == category) else {
                continue;
            };
            let Some(role) = range.get(i % range.len()).and_then(Value::as_str) else {
                continue;
            };
            let params = item.get("params").unwrap_or(&Value::Null);
            let style = json!([
                mp.get("mark"),
                params.pointer("/paint/stroke/dash"),
                params.pointer("/encode/shape"),
                mp.get("label")
            ]);
            match styles.iter_mut().find(|(r, _)| r == role) {
                Some((_, list)) => list.push(style),
                None => styles.push((role.to_string(), vec![style])),
            }
        }
        'pairs: for (a, (ra, sa)) in styles.iter().enumerate() {
            for (rb, sb) in &styles[a + 1..] {
                if sa.iter().all(|s| !sb.contains(s)) {
                    continue;
                }
                for (theme, palette) in [("light", &look.light), ("dark", &look.dark)] {
                    let (Some(ca), Some(cb)) = (palette.get(ra), palette.get(rb)) else {
                        continue;
                    };
                    let (vision, distance) = look::nearest_vision(*ca, *cb);
                    if distance < look.data_distance {
                        out.push(Issue::error(
                            "roles_too_close",
                            scale_id,
                            format!("items/{scale_id}/params/range"),
                            json!({"roles": [ra, rb], "vision": vision, "theme": theme, "distance": distance}),
                            "two categories told apart by color alone come closer than the look's data distance; give one other roles, or a dash, a shape or a direct label",
                        ));
                        break 'pairs;
                    }
                }
            }
        }
    }
    out
}

/// The module's issues for `doc`, which the core check passed, in `look`.
pub fn check(doc: &Map<String, Value>, look: &Look) -> Vec<Issue> {
    let items = object_or_empty(doc.get("items"));
    let mut issues = roles_apart(items, look);
    issues.extend(numbers(doc).1);
    // Status can show wherever a status binding is.
    let status_shows = doc
        .get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty());
    if let (true, Some(status)) = (status_shows, &look.status) {
        for (id, item) in items {
            for (theme, palette) in [("light", &look.light), ("dark", &look.dark)] {
                let Ok(adjust) = Adjust::read(item, palette, id) else {
                    continue;
                };
                if adjust.is_identity() {
                    continue;
                }
                if let Some(issue) = adjust_issue(id, item, &adjust, palette, theme, status) {
                    issues.push(issue);
                    break;
                }
            }
        }
    }
    for palette in [&look.light, &look.dark] {
        if let Err(r) = scene::frame(doc, items, palette, &Record::default(), 1.0) {
            // `items/<id>/…`, or `items/<id>: …` for a pair.
            let id = r
                .path
                .strip_prefix("items/")
                .and_then(|rest| rest.split(['/', ':']).next())
                .unwrap_or("");
            issues.push(Issue {
                fix: "Change the item so the 2D marks module can draw it.".into(),
                ..Issue::error(
                    r.code,
                    id,
                    r.path.clone(),
                    Value::Null,
                    "marks2d refuses it",
                )
            });
            break;
        }
    }
    issues
}
