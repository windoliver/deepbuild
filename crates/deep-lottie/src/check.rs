//! The import kind's output checks, run on its outputs before any byte is kept:
//! `import.document`, the document check a document an agent wrote passes (the core's, the look
//! the document names by hash resolved, marks2d's over it, and its motion program compiled);
//! `import.colors_mapped`, no paint holding a literal color; and `import.no_expression`, no
//! expression's text anywhere in the document.

use deep_canvas::canon::sha256_hex;
use deep_canvas_marks::look::{self, Distance};
use serde_json::{json, Map, Value};

/// The document check's errors on `doc`, whose look is the file `look` (the job's `look`
/// output): empty when it passes.
pub fn document(doc: &Value, look: &[u8]) -> Vec<Value> {
    let mut errors: Vec<Value> = deep_canvas::document::check(doc)
        .issues
        .into_iter()
        .filter(|i| i.severity == "error")
        .map(|i| i.to_json())
        .collect();
    if !errors.is_empty() {
        return errors;
    }
    let Some(map) = doc.as_object() else {
        return vec![json!({"code": "bad_doc", "what": "the document is no JSON object"})];
    };
    // The look the document names: `look.asset` `<id>@1`, whose `assets/<id>/sha256` is the look's.
    let asset = doc
        .pointer("/look/asset")
        .and_then(Value::as_str)
        .unwrap_or("");
    let id = asset.strip_suffix("@1").unwrap_or("");
    let named = doc
        .pointer(&format!("/assets/{id}/sha256"))
        .and_then(Value::as_str);
    if id.is_empty() || named != Some(sha256_hex(look).as_str()) {
        return vec![
            json!({"code": "look_unnamed", "path": "look/asset", "what": format!("the document names its look as {asset:?} by {named:?}, not the look written beside it by {}", sha256_hex(look))}),
        ];
    }
    let def: Value = match serde_json::from_slice(look) {
        Ok(v) => v,
        Err(e) => {
            return vec![json!({"code": "bad_look", "what": format!("the look is no JSON: {e}")})]
        }
    };
    let binds = doc
        .get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty());
    let at = if binds {
        Distance::Everywhere
    } else {
        Distance::WhereStatusShows
    };
    let resolved = match look::resolve_in(&def, &crate::colors::bundled(), at) {
        Ok(l) => l,
        Err(r) => return vec![r.to_json()],
    };
    errors.extend(
        deep_canvas_marks::check::check(map, &resolved, None)
            .into_iter()
            .filter(|i| i.severity == "error")
            .map(|i| i.to_json()),
    );
    if let Err(r) = deep_canvas_motion::program::Program::compile(map) {
        let mut v = json!({"code": r.code, "path": r.path, "what": "the document's motion doesn't compile"});
        if let Some(d) = r.detail {
            v["detail"] = *d;
        }
        errors.push(v);
    }
    errors
}

/// Where a paint holds a literal color, or `None` when every color is a role.
pub fn colors_mapped(doc: &Value) -> Option<String> {
    fn literal(v: &Value) -> bool {
        match v {
            Value::String(s) => {
                let h = s.strip_prefix('#').unwrap_or("");
                (s.starts_with('#')
                    && matches!(h.len(), 3 | 4 | 6 | 8)
                    && h.chars().all(|c| c.is_ascii_hexdigit()))
                    || s.starts_with("rgb")
            }
            _ => false,
        }
    }
    fn walk(v: &Value, path: &str, in_paint: bool) -> Option<String> {
        match v {
            Value::Object(m) => {
                for (k, x) in m {
                    let here = format!("{path}/{k}");
                    let paint = in_paint || k == "paint";
                    if paint && matches!(k.as_str(), "color" | "rgb" | "rgba" | "hex" | "srgb") {
                        return Some(here);
                    }
                    if paint && literal(x) {
                        return Some(here);
                    }
                    if let Some(p) = walk(x, &here, paint) {
                        return Some(p);
                    }
                }
                None
            }
            Value::Array(a) => a
                .iter()
                .enumerate()
                .find_map(|(i, x)| walk(x, &format!("{path}/{i}"), in_paint)),
            other => (in_paint && literal(other)).then(|| path.to_string()),
        }
    }
    walk(doc, "", false)
}

/// Where the document holds text that reads as an expression, or `None`. A name is free text and
/// reads as script when it has the marks script has; every other string is held to the forms the
/// import writes: IDs, kinds, roles, words, path strings and hashes.
pub fn no_expression(doc: &Value) -> Option<String> {
    fn formed(s: &str) -> bool {
        s.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@' | '/' | ' ' | ':' | '#')
        })
    }
    fn walk(v: &Value, path: &str, key: &str) -> Option<String> {
        match v {
            Value::Object(m) => m
                .iter()
                .find_map(|(k, x)| walk(x, &format!("{path}/{k}"), k)),
            Value::Array(a) => a
                .iter()
                .enumerate()
                .find_map(|(i, x)| walk(x, &format!("{path}/{i}"), key)),
            Value::String(s) => {
                let free = matches!(key, "name" | "title" | "description");
                let bad = if free {
                    crate::read::scriptlike(s)
                } else {
                    !formed(s) || crate::read::scriptlike(s)
                };
                bad.then(|| path.to_string())
            }
            _ => None,
        }
    }
    let empty = Map::new();
    let doc_map = doc.as_object().unwrap_or(&empty);
    doc_map
        .iter()
        .find_map(|(k, x)| walk(x, &format!("/{k}"), k))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_literal_color_in_a_paint_is_found_and_a_role_is_not() {
        let ok =
            json!({"items": {"a": {"params": {"paint": {"fill": {"role": "lottie_ff0000"}}}}}});
        assert_eq!(colors_mapped(&ok), None);
        let bad = json!({"items": {"a": {"params": {"paint": {"fill": {"role": "#ff0000"}}}}}});
        assert_eq!(
            colors_mapped(&bad).as_deref(),
            Some("/items/a/params/paint/fill/role")
        );
        let worse =
            json!({"items": {"a": {"params": {"paint": {"stroke": {"color": [1, 0, 0]}}}}}});
        assert!(colors_mapped(&worse).is_some());
    }

    #[test]
    fn script_anywhere_in_a_document_is_found() {
        let ok = json!({"title": "Loader (final)", "items": {"a": {"name": "Shape Layer 1", "kind": "path@1", "params": {"d": "M 0 0 L 1.5 -2 Z"}}}});
        assert_eq!(no_expression(&ok), None);
        let bad = json!({"items": {"a": {"name": "loopOut('cycle')"}}});
        assert_eq!(no_expression(&bad).as_deref(), Some("/items/a/name"));
        let hidden = json!({"markers": {"m": {"payload": "var t = time * 2;"}}});
        assert!(no_expression(&hidden).is_some());
    }
}
