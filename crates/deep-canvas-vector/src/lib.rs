//! The vector canvas module (technical design: Canvas modules, the module table's `vector` row;
//! canvas primitives: Vector and formula `vector@1`): SVG imported as static paths whose colors
//! map to roles and whose ids become parts a channel can key, drawn as marks2d's own items.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};

pub mod lower;
pub mod module;
pub mod svg;

pub use lower::Write;
use svg::{Color, Svg};

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
/// `colors` doesn't map, and a part target naming no part. `bytes` reads an SVG by its sha256.
pub fn check(
    doc: &Map<String, Value>,
    bytes: impl Fn(&str) -> Option<Vec<u8>>,
    skips_clip_path: bool,
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
        let svg = match svg::import(&found, &classes, skips_clip_path) {
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
