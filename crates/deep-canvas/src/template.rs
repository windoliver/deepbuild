//! Issue #381: a text template (canvas primitives: Text `text@1`, `template`). Each `{path}` slot
//! shows the evaluated value at that path at its own precision, and each number it shows traces to
//! its path's source. This build's slots read data constants (`{data/<name>}`); the check and the
//! text module read templates through this one parser.

use serde_json::Value;

/// A piece of a template: words as written, or a slot's path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Part<'a> {
    Words(&'a str),
    Slot(&'a str),
}

/// The template's parts, or the byte offset of a brace that opens no slot or closes none.
pub fn parts(template: &str) -> Result<Vec<Part<'_>>, usize> {
    let mut out = Vec::new();
    let mut rest = template;
    let mut at = 0;
    while let Some(open) = rest.find(['{', '}']) {
        if rest.as_bytes()[open] == b'}' {
            return Err(at + open);
        }
        let Some(close) = rest[open + 1..].find(['{', '}']) else {
            return Err(at + open);
        };
        if rest.as_bytes()[open + 1 + close] == b'{' {
            return Err(at + open);
        }
        if open > 0 {
            out.push(Part::Words(&rest[..open]));
        }
        out.push(Part::Slot(&rest[open + 1..open + 1 + close]));
        let next = open + close + 2;
        at += next;
        rest = &rest[next..];
    }
    if !rest.is_empty() {
        out.push(Part::Words(rest));
    }
    Ok(out)
}

/// A slot's value: what it shows, and the source its constant names (`None` for a bare value,
/// which the document holds as written).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shown {
    pub text: String,
    pub source: Option<String>,
    pub number: bool,
}

/// A number at its own precision: the shortest form that reads back to the same f64.
fn number(n: f64) -> String {
    format!("{n}")
}

/// Each slot of `template` that shows a story's own number (a number whose constant's source is
/// `story`, Honest numbers): its path and what it shows. Empty for a template that doesn't parse.
pub fn story_numbers<'t>(doc: &Value, template: &'t str) -> Vec<(&'t str, String)> {
    parts(template)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|part| match part {
            Part::Slot(slot) => value(doc, slot)
                .filter(|s| s.number && s.source.as_deref() == Some("story"))
                .map(|s| (slot, s.text)),
            Part::Words(_) => None,
        })
        .collect()
}

/// The value at `path` in `doc`: a data constant `data/<name>`, a number or a string, bare or as
/// `{value, source}` (Document envelope). `None` when the path names nothing this build shows.
pub fn value(doc: &Value, path: &str) -> Option<Shown> {
    // #504: a figure's readout also reads what moves its parts: an assembly's value (0 when
    // unwritten) and a control's (its value at t where the caller wrote one, else its default),
    // so every number on the card comes from the model that moves the parts.
    let moved = |section: &str, field: &str| -> Option<Option<f64>> {
        let id = path.strip_prefix(section)?.strip_suffix("/value")?;
        let entry = doc.get(section.trim_end_matches('/'))?.get(id)?;
        let first = entry.get("range").and_then(|r| r.get(0));
        Some(entry.get(field).or_else(|| entry.get("default")).or(first).and_then(Value::as_f64))
    };
    if let Some(v) = moved("assemblies/", "value") {
        return Some(Shown { text: number(v.unwrap_or(0.0)), source: None, number: true });
    }
    if let Some(v) = moved("controls/", "value") {
        return Some(Shown { text: number(v?), source: None, number: true });
    }
    let name = path.strip_prefix("data/")?;
    let constant = doc.get("data")?.get(name)?;
    let (value, source) = match constant {
        Value::Object(fields) => (
            fields.get("value")?,
            Some(fields.get("source")?.as_str()?.to_string()),
        ),
        bare => (bare, None),
    };
    let (text, number) = match value {
        Value::Number(n) => (self::number(n.as_f64()?), true),
        Value::String(s) => (s.clone(), false),
        _ => return None,
    };
    Some(Shown {
        text,
        source,
        number,
    })
}

/// Whether `path` reads a mark set's read-only anchor, `items/<set>#period/by` or
/// `items/<set>#head/<column>`, whose value the frame's rows give at t (Mark set and columns).
pub fn reads_anchor(doc: &Value, path: &str) -> bool {
    let anchor = path
        .strip_prefix("items/")
        .and_then(|p| p.split_once('#'))
        .and_then(|(set, rest)| Some((set, rest.split_once('/')?)));
    let Some((set, (name, field))) = anchor else {
        return false;
    };
    let params = doc.get("items").and_then(|i| i.get(set)?.get("params"));
    let transform = |kind: &str| {
        params
            .and_then(|p| p.get("transforms")?.as_array())
            .is_some_and(|t| t.iter().any(|t| t.get(kind).is_some()))
    };
    match name {
        "period" => field == "by" && transform("periods"),
        "head" => transform("reveal"),
        _ => false,
    }
}

/// The fields of a figure's card (Overlay: `card {fig, title, hint, readout, legend, caption}`)
/// that show text, in the order the card stacks them.
pub const CARD_LINES: [&str; 5] = ["fig", "title", "hint", "readout", "caption"];

/// A figure's card as lines: each text field the document's `card` writes, by name, with its
/// template, in [`CARD_LINES`] order (#504). Empty without a card.
pub fn card_lines(doc: &Value) -> Vec<(&'static str, &str)> {
    let Some(card) = doc.get("card") else {
        return Vec::new();
    };
    CARD_LINES
        .into_iter()
        .filter_map(|f| Some((f, card.get(f)?.as_str()?)))
        .collect()
}

/// The template with each slot replaced by what it shows; `Err` holds the first slot that
/// resolves to nothing, or `None` when a brace is unbalanced.
pub fn expand(doc: &Value, template: &str) -> Result<String, Option<String>> {
    let mut out = String::new();
    for part in parts(template).map_err(|_| None)? {
        match part {
            Part::Words(w) => out.push_str(w),
            Part::Slot(path) => out.push_str(&value(doc, path).ok_or(Some(path.to_string()))?.text),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn slots_and_words_split_and_braces_must_pair() {
        assert_eq!(
            parts("Subtract {data/k} from both sides"),
            Ok(vec![
                Part::Words("Subtract "),
                Part::Slot("data/k"),
                Part::Words(" from both sides")
            ])
        );
        assert_eq!(parts("{data/a}{data/b}").map(|p| p.len()), Ok(2));
        assert_eq!(parts("a } b"), Err(2));
        assert_eq!(parts("a {b"), Err(2));
        assert_eq!(parts("a {b {c}}"), Err(2));
    }

    #[test]
    fn constants_show_at_their_own_precision_with_their_source() {
        let doc = json!({"data": {"k": {"value": 3, "source": "story"}, "x": 2.5, "w": "two"}});
        assert_eq!(
            expand(&doc, "Subtract {data/k} from both sides"),
            Ok("Subtract 3 from both sides".into())
        );
        assert_eq!(
            value(&doc, "data/k").unwrap().source.as_deref(),
            Some("story")
        );
        assert_eq!(
            expand(&doc, "{data/x} and {data/w}"),
            Ok("2.5 and two".into())
        );
        assert_eq!(
            expand(&doc, "{data/missing}"),
            Err(Some("data/missing".into()))
        );
        assert_eq!(
            expand(&doc, "{items/a/params/x}"),
            Err(Some("items/a/params/x".into()))
        );
    }
}
