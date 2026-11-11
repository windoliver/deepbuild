//! The vector canvas module (technical design: Canvas modules, the module table's `vector` row;
//! canvas primitives: Vector and formula `vector@1`): SVG imported as static paths whose colors
//! map to roles and whose ids become parts a channel can key, drawn as marks2d's own items.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};

pub mod lower;
pub mod module;
pub mod outline_source;
pub mod svg;

pub use lower::Write;
use svg::{Color, Svg, Twin};

/// One vector item's import: what the SVG holds and its colors' roles.
#[derive(Clone, Debug)]
pub struct Imported {
    pub svg: Svg,
    pub colors: BTreeMap<Color, String>,
}

/// The fields a channel may key on a part: `items/<id>/parts/<part>/role`, `/opacity`, `/at`.
pub const PART_FIELDS: [&str; 3] = ["role", "opacity", "at"];

fn issue(
    code: &'static str,
    severity: &'static str,
    id: &str,
    path: String,
    actual: Value,
    what: &str,
    fix: &str,
) -> Issue {
    Issue {
        severity,
        fix: fix.into(),
        ..Issue::error(code, id, path, actual, what)
    }
}

/// Every `vector@1` item of `doc` imported, with its issues: a refused SVG (one error naming what
/// refused it), each element or attribute it didn't read (a warning naming it), a color
/// `colors` doesn't map, and a part target naming no part. `bytes` reads an SVG by its sha256;
/// `twin` is the importer, honest or planted.
pub fn check(
    doc: &Map<String, Value>,
    bytes: impl Fn(&str) -> Option<Vec<u8>>,
    twin: Twin,
) -> (Vec<Issue>, BTreeMap<String, Imported>) {
    let mut issues = Vec::new();
    let mut imported = BTreeMap::new();
    let Some(Value::Object(items)) = doc.get("items") else {
        return (issues, imported);
    };
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("vector@1") {
            continue;
        }
        let params = item
            .get("params")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let src_path = format!("items/{id}/params/src");
        let Some(src) = params.get("src").and_then(Value::as_str) else {
            issues.push(Issue::error(
                "bad_doc",
                id,
                src_path,
                Value::Null,
                "A vector names its SVG by sha256.",
            ));
            continue;
        };
        let Some(found) = bytes(src) else {
            issues.push(Issue::error(
                "asset_missing",
                id,
                src_path,
                json!(src),
                "No stored SVG has this sha256.",
            ));
            continue;
        };
        let classes: Vec<String> = params
            .get("parts")
            .and_then(Value::as_array)
            .map(|c| {
                c.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let svg = match svg::import(&found, &classes, twin) {
            Ok(svg) => svg,
            Err(r) => {
                issues.push(issue(
                    r.code(),
                    "error",
                    id,
                    src_path,
                    json!(r.found()),
                    r.what(),
                    r.fix(),
                ));
                continue;
            }
        };
        for name in &svg.unread {
            issues.push(issue(
                "svg_unsupported",
                "warning",
                id,
                src_path.clone(),
                json!(name),
                "The import doesn't read this element or attribute, so it isn't drawn as the SVG writes it.",
                "Flatten it into plain paths before importing, or remove it.",
            ));
        }
        let colors = match lower::colors(id, &params) {
            Ok(c) => c,
            Err(u) => {
                issues.push(Issue::error(
                    "bad_doc",
                    id,
                    u.path,
                    json!(u.color),
                    "Not a CSS color, or a role that isn't a name.",
                ));
                continue;
            }
        };
        if let Some(color) = lower::unmapped(&svg, &colors) {
            issues.push(issue(
                "svg_color_unmapped",
                "error",
                id,
                format!("items/{id}/params/colors"),
                json!(color),
                "The SVG draws a color `colors` maps to no role; a vector keeps no color of its own.",
                "Map the color to a look role in `colors`.",
            ));
            continue;
        }
        // #220: a typeset output's source is its alt; an alt that says another formula fails.
        if let (Some(source), Some(alt)) = (
            typeset_source(&svg),
            params.get("alt").and_then(Value::as_str),
        ) {
            if squash(alt) != squash(&source) {
                issues.push(issue(
                    "formula.alt_mismatch",
                    "error",
                    id,
                    format!("items/{id}/params/alt"),
                    json!({"item": id, "alt": alt, "source": source}),
                    "The vector names a typeset job's output, and its alt isn't the job's source.",
                    "Set alt to the job's source, or leave it out to take the source as the accessible name.",
                ));
            }
        }
        imported.insert(id.clone(), Imported { svg, colors });
    }
    // A part target names a part its vector's import holds.
    for section in ["channels", "bound_values"] {
        let Some(Value::Object(entries)) = doc.get(section) else {
            continue;
        };
        for (key, entry) in entries {
            let Some(target) = entry.get("target").and_then(Value::as_str) else {
                continue;
            };
            let steps: Vec<&str> = target.split('/').collect();
            let ["items", item, "parts", part, ..] = steps[..] else {
                continue;
            };
            let Some(found) = imported.get(item) else {
                continue;
            };
            if !found.svg.parts.iter().any(|p| p.id == part) {
                issues.push(Issue::error(
                    "ref_unresolved",
                    key,
                    format!("{section}/{key}/target"),
                    json!(target),
                    &format!("items/{item} has no part `{part}`"),
                ));
            }
        }
    }
    (issues, imported)
}

/// The source of a formula the typeset job wrote: its record's `made_by.input` (#220).
pub fn typeset_source(svg: &Svg) -> Option<String> {
    let record: Value = serde_json::from_str(svg.typeset.as_deref()?).ok()?;
    record
        .get("made_by")?
        .get("input")?
        .as_str()
        .map(str::to_string)
}

/// A formula's text with its ASCII whitespace left out, as an alt and a source compare.
fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_ascii_whitespace()).collect()
}

/// The numbers a formula's `alt` shows: each run of digits, with a point between two digits.
fn alt_numbers(alt: &str) -> Vec<&str> {
    let b = alt.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if !b[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        while i < b.len()
            && (b[i].is_ascii_digit()
                || (b[i] == b'.' && b.get(i + 1).is_some_and(u8::is_ascii_digit)))
        {
            i += 1;
        }
        out.push(&alt[start..i]);
    }
    out
}

/// Every number a vector's `alt` shows, scanned as displayed text (Honest numbers: formulas),
/// with what it traces to, and its issues: an integer is notation, listed and never counted; a
/// number with a fractional part, or one `numbers` maps to a source path, traces to a data
/// constant with a source, or is refused `number_unsourced`, naming the item and the number.
pub fn numbers(doc: &Map<String, Value>) -> (Vec<Value>, Vec<Issue>) {
    let (mut shown, mut issues) = (Vec::new(), Vec::new());
    let Some(Value::Object(items)) = doc.get("items") else {
        return (shown, issues);
    };
    let whole = Value::Object(doc.clone());
    for (id, item) in items {
        let p = item.get("params");
        let alt = p.and_then(|p| p.get("alt")).and_then(Value::as_str);
        let (Some("vector@1"), Some(alt)) = (item.get("kind").and_then(Value::as_str), alt) else {
            continue;
        };
        let mapped = p.and_then(|p| p.get("numbers"));
        for n in alt_numbers(alt) {
            let path = mapped.and_then(|m| m.get(n)).and_then(Value::as_str);
            let source = path
                .and_then(|path| deep_canvas::template::value(&whole, path))
                .and_then(|v| v.source);
            match (path, source) {
                (Some(path), Some(source)) => shown.push(
                    json!({"item": id, "text": n, "source": {"path": path, "from": source}}),
                ),
                (None, _) if !n.contains('.') => {
                    shown.push(json!({"item": id, "text": n, "source": {"notation": "alt"}}))
                }
                (path, _) => issues.push(Issue::error(
                    "number_unsourced",
                    id,
                    format!("items/{id}/params/alt"),
                    json!({"number": n, "path": path}),
                    &format!(
                        "the formula shows {n} with no source; map it in `numbers` to a data constant with a source"
                    ),
                )),
            }
        }
    }
    (shown, issues)
}

/// `items`, as evaluated at a time, with each imported vector item replaced by the items it
/// draws as.
pub fn lower_items(
    items: &Map<String, Value>,
    imported: &BTreeMap<String, Imported>,
    write: Write,
) -> Map<String, Value> {
    let mut out = Map::new();
    for (id, item) in items {
        match imported.get(id) {
            Some(found) => out.extend(lower::lower(id, item, &found.svg, &found.colors, write)),
            None => {
                out.insert(id.clone(), item.clone());
            }
        }
    }
    out
}

/// An imported vector item's geometry box where it draws now, its parts' outlines joined, or
/// one part's (#221: what a relation places it by or against).
pub fn bounds(item: &Value, found: &Imported, part: Option<&str>) -> Option<[f64; 4]> {
    match part {
        Some(part) => lower::parts(&found.svg, item)
            .into_iter()
            .find(|(id, _, _)| id == part)
            .map(|(_, b, _)| b),
        None => lower::bounds(&found.svg, item),
    }
}

/// The read-only per-part fields of an imported vector item, as `geometry` answers them: each
/// part's id, its source (the typeset job's `data-source`, else null: an SVG doesn't say), its box
/// and its outline's sub-paths, in document u.
pub fn parts_json(
    item: &Value,
    found: &Imported,
    subpaths: impl Fn(&[deep_canvas_marks::path::Verb]) -> Vec<Value>,
) -> Value {
    let source = |id: &str| {
        found
            .svg
            .parts
            .iter()
            .find(|p| p.id == id)
            .and_then(|p| p.source.clone())
    };
    Value::Array(
        lower::parts(&found.svg, item)
            .into_iter()
            .map(|(id, b, verbs)| json!({"id": id, "source": source(&id), "box": b, "subpaths": subpaths(&verbs)}))
            .collect(),
    )
}

#[cfg(test)]
mod typeset_tests {
    use super::*;

    const FORMULA: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><metadata><deep:typeset xmlns:deep="urn:deepbuild:typeset">{"made_by":{"tool":"typst-mitex","version":"1.0.0","input":"a^2 + b^2 = c^2"}}</deep:typeset></metadata><g id="t-a_5e2" data-source="a^2"><path d="M0 0L4 0L4 4Z" fill="currentColor"/></g></svg>"#;

    fn doc(alt: Option<&str>) -> Map<String, Value> {
        let mut params = json!({"src": "f".repeat(64), "colors": {"currentColor": "ink"}});
        if let Some(alt) = alt {
            params["alt"] = json!(alt);
        }
        json!({"items": {"eq": {"kind": "vector@1", "params": params}}})
            .as_object()
            .unwrap()
            .clone()
    }

    fn codes(alt: Option<&str>) -> Vec<&'static str> {
        let (issues, _) = check(
            &doc(alt),
            |_| Some(FORMULA.as_bytes().to_vec()),
            Twin::Honest,
        );
        issues.iter().map(|i| i.code).collect()
    }

    #[test]
    fn an_alt_that_says_another_formula_fails() {
        assert_eq!(codes(Some("a^2+b^2=c^3")), ["formula.alt_mismatch"]);
        assert!(codes(Some("a^2+b^2=c^2")).is_empty());
        assert!(codes(None).is_empty());
    }

    #[test]
    fn a_part_keeps_its_source() {
        let svg = svg::import(FORMULA.as_bytes(), &[], Twin::Honest).unwrap();
        assert_eq!(svg.parts[0].source.as_deref(), Some("a^2"));
        assert_eq!(typeset_source(&svg).as_deref(), Some("a^2 + b^2 = c^2"));
        assert!(svg.unread.is_empty(), "{:?}", svg.unread);
    }
}
