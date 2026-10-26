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

/// The value at `path` in `doc`: a data constant `data/<name>`, a number or a string, bare or as
/// `{value, source}` (Document envelope). `None` when the path names nothing this build shows.
pub fn value(doc: &Value, path: &str) -> Option<Shown> {
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
