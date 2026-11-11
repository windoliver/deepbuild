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
/// constant with a source, or is refused `number_unsourced`, naming the item and the number. A
/// quoted formula's unmapped numbers are quotation, listed with its quote and never counted.
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
        // #1963: a formula that quotes the lines it was rendered from shows them as quotation,
        // naming its source; one without a quote is the agent's own.
        let quote = p.and_then(|p| p.get("quote"));
        for n in alt_numbers(alt) {
            let path = mapped.and_then(|m| m.get(n)).and_then(Value::as_str);
            let source = path
                .and_then(|path| deep_canvas::template::value(&whole, path))
                .and_then(|v| v.source);
            match (path, source) {
                (Some(path), Some(source)) => shown.push(
                    json!({"item": id, "text": n, "source": {"path": path, "from": source}}),
                ),
                (None, _) if quote.is_some() => {
                    shown.push(json!({"item": id, "text": n, "source": {"quotation": quote}}))
                }
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
/// part's id, its source (null: an SVG doesn't say), its box and its outline's sub-paths, in
/// document u.
pub fn parts_json(
    item: &Value,
    found: &Imported,
    subpaths: impl Fn(&[deep_canvas_marks::path::Verb]) -> Vec<Value>,
) -> Value {
    Value::Array(
        lower::parts(&found.svg, item)
            .into_iter()
            .map(|(id, b, verbs)| json!({"id": id, "source": null, "box": b, "subpaths": subpaths(&verbs)}))
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #1963: a formula quoting its LaTeX lines lists its numbers as quotation naming that source;
    /// the same formula with no quote is the agent's own, its integers notation naming no source.
    #[test]
    fn a_quoted_formula_s_numbers_name_its_source_and_an_unquoted_one_s_none() {
        let quote = json!({"source": format!("ev:{}", "a".repeat(64)), "path": "paper.tex", "lines": [3, 4]});
        let doc = |params: Value| {
            json!({"items": {"eq": {"kind": "vector@1", "params": params}}})
                .as_object()
                .cloned()
                .unwrap()
        };
        let (shown, issues) = numbers(&doc(json!({"alt": "n_1 = 1.33\n", "quote": quote})));
        assert!(issues.is_empty());
        let sources: Vec<_> = shown.iter().map(|n| &n["source"]).collect();
        assert_eq!(sources, [&json!({"quotation": quote}); 2]);
        let (shown, _) = numbers(&doc(json!({"alt": "n_1 = n_2\n"})));
        assert!(shown
            .iter()
            .all(|n| n["source"] == json!({"notation": "alt"})));
    }
}
