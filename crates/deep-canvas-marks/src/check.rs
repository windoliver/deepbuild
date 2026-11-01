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

/// The module's issues for `doc`, which the core check passed, in `look`.
pub fn check(doc: &Map<String, Value>, look: &Look) -> Vec<Issue> {
    let items = object_or_empty(doc.get("items"));
    let mut issues = Vec::new();
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
