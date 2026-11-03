//! The marks2d module's check over a document the core check passed, in a look: everything the
//! draw list refuses becomes an issue naming its item (a star past 200 vertices, a fifth mask, a
//! mark set's repeated key), and wherever status can show, an adjust that brings a role its item
//! uses within the status distance is refused, naming the role (Item and kind: adjust).
//!
//! Issue #417: wherever status can show, a look role within the status distance of a status color
//! is refused, naming the role and the state (The status-color rule); and a text a grapheme of
//! which neither its font nor any of the look's fallback fonts can draw is refused with
//! `text.glyph_missing`, naming the item and the grapheme (Text `text@1`).

use serde_json::{json, Map, Value};

use deep_canvas::document::Issue;

use crate::look::{self, Look};
use crate::paint::Adjust;
use crate::scene::{self, object_or_empty, Palette, Planted, Record, Rgb, Type};

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

/// The look's issue where status can show (#417): the first role within the status distance (`min`,
/// or the look's own) of a status color.
fn distance_issue(look: &Look, min: Option<f64>) -> Option<Issue> {
    let look::Refusal::Distance {
        theme,
        role,
        state,
        distance,
    } = look::clash_of(look, min)?
    else {
        return None;
    };
    Some(Issue {
        fix: "Move the role's color away from the status color, or show the document where no status binds.".into(),
        ..Issue::envelope(
            "status_distance",
            format!("look/roles/{role}"),
            json!({"role": role, "state": state, "theme": theme, "distance": distance}),
            &format!("the role `{role}` sits within the status distance of {state}"),
        )
    })
}

/// Each text's graphemes no face can draw in a theme's type (#417): its font's, then the look's
/// fallback faces in order. (Keyed copy, whose every key in every locale this would read, lands
/// with the logic module.)
fn glyph_issues(items: &Map<String, Value>, ty: &Type, issues: &mut Vec<Issue>) {
    thread_local! {
        static SHAPER: std::cell::RefCell<deep_text::Shaper> =
            std::cell::RefCell::new(deep_text::Shaper::new());
    }
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("text@1") {
            continue;
        }
        let params = object_or_empty(item.get("params"));
        let Ok(spec) = scene::text_spec_in(id, params, None, ty) else {
            continue;
        };
        let Some(shaper_spec) = spec.shaper_spec() else {
            continue;
        };
        let missing = SHAPER.with(|s| s.borrow_mut().missing(&shaper_spec, &spec.text));
        for grapheme in missing {
            let found = |i: &Issue| {
                i.code == "text.glyph_missing"
                    && i.actual["grapheme"] == grapheme.as_str()
                    && i.ids.iter().any(|x| x == id)
            };
            if issues.iter().any(found) {
                continue;
            }
            issues.push(Issue {
                fix: "Add a bundled face that has it to the look's fallback list, or change the text.".into(),
                ..Issue::error(
                    "text.glyph_missing",
                    id,
                    format!("items/{id}/params/text"),
                    json!({"item": id, "grapheme": grapheme}),
                    &format!("no face in the look draws `{grapheme}`"),
                )
            });
        }
    }
}

/// The module's issues for `doc`, which the core check passed, in `look`; `min` stands in for the
/// look's status distance (#417 AC9's planted wrong check).
pub fn check(doc: &Map<String, Value>, look: &Look, min: Option<f64>) -> Vec<Issue> {
    let items = object_or_empty(doc.get("items"));
    let mut issues = Vec::new();
    // Status can show wherever a status binding is.
    let status_shows = doc
        .get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty());
    if status_shows {
        issues.extend(distance_issue(look, min));
    }
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
    for (palette, ty) in [
        (&look.light, &look.light_type),
        (&look.dark, &look.dark_type),
    ] {
        let built = scene::frame_planted(
            doc,
            items,
            (palette, ty),
            &Record::default(),
            1.0,
            Planted::None,
        );
        if let Err(r) = built {
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
    glyph_issues(items, &look.light_type, &mut issues);
    if look.dark_type != look.light_type {
        glyph_issues(items, &look.dark_type, &mut issues);
    }
    issues
}
