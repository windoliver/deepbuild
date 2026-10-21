//! The canonical form of a canvas document and its revision hash (canvas reference: Revision).
//!
//! The canonical document is defined bytes, stricter than the RFC 8785 bytes the hub hashes
//! (technical design: One canonical form before any hash):
//!
//! - object keys sorted by Unicode code point (the UTF-8 byte order of the NFC key, which is the
//!   same order), so maps keyed by ID come out sorted by ID;
//! - a field equal to its declared default left out, compared after canonicalizing both sides;
//! - every string, key or value, normalized to NFC;
//! - a whole number within ±2^53 written as that integer, whatever its parse type or declared
//!   width, so `1`, `1.0` and `-0.0` all write `1`, `1` and `0`;
//! - any other number written as the shortest text that reads back to the value at the width its
//!   field declares: cast to `f32` for [`Width::F32`], then Rust's `{}` display, which is the
//!   shortest round-trip form and never uses an exponent (`1e-7` writes `0.0000001`);
//! - a non-finite number, including one that overflows its `f32` width, refused with the field's
//!   path, as is an integer past ±2^53 that no f64 holds exactly (2^53 + 1), since rounded it
//!   would share its bytes and hash with the document that says its neighbour;
//! - string escapes only where JSON requires them: `"`, `\`, and controls below 0x20 as `\b`,
//!   `\f`, `\n`, `\r`, `\t` or `\u00xx` (lower-case hex); everything else is literal UTF-8;
//! - no whitespace.
//!
//! Only object members are subject to defaults; array elements are kept as they are, so an array's
//! length never changes. The document layer says, per JSON path, what a field declares, through
//! [`Shape`]; [`NoShape`] declares `f64` everywhere and no defaults.

use std::collections::BTreeMap;
use std::fmt;

use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

/// The float width a field declares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Width {
    F32,
    F64,
}

/// What the document layer knows about each field, by its JSON path from the root: the sequence
/// of object keys and array indices, as `["items", "box", "params", "width"]` or
/// `["points", "0", "x"]`.
pub trait Shape {
    /// The float width the field at `path` declares.
    fn width(&self, path: &[&str]) -> Width;
    /// The default of the field at `path`, if it has one. A field equal to it is left out.
    fn default_at(&self, path: &[&str]) -> Option<&Value>;
}

/// A shape that declares `f64` for every field and no defaults.
pub struct NoShape;

impl Shape for NoShape {
    fn width(&self, _path: &[&str]) -> Width {
        Width::F64
    }

    fn default_at(&self, _path: &[&str]) -> Option<&Value> {
        None
    }
}

/// Why a document has no canonical form: a number that is not finite at its declared width, or
/// two keys that are one key after NFC.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CanonError {
    /// The field's path from the root, joined by `/`, as `items/box/params/width`.
    pub path: String,
    pub what: String,
}

impl fmt::Display for CanonError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.path, self.what)
    }
}

impl std::error::Error for CanonError {}

/// The canonical bytes of `value` under `shape`.
pub fn canonical_bytes(value: &Value, shape: &dyn Shape) -> Result<Vec<u8>, CanonError> {
    let canonical = canonical_value(value, shape)?;
    let mut out = Vec::new();
    write_value(&canonical, shape, &mut Vec::new(), &mut out);
    Ok(out)
}

/// The revision hash: lower-case hex SHA-256 of the canonical bytes.
pub fn revision_hash(value: &Value, shape: &dyn Shape) -> Result<String, CanonError> {
    let bytes = canonical_bytes(value, shape)?;
    let digest = Sha256::digest(&bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

/// The same normalization as [`canonical_bytes`], as a value: keys in sorted order, defaults
/// removed, strings NFC, whole numbers as integers and other floats rounded to their declared
/// width. Two documents with one canonical form are equal as values.
pub fn canonical_value(value: &Value, shape: &dyn Shape) -> Result<Value, CanonError> {
    canonical_at(value, shape, &mut Vec::new())
}

fn canonical_at(
    value: &Value,
    shape: &dyn Shape,
    path: &mut Vec<String>,
) -> Result<Value, CanonError> {
    match value {
        Value::Null | Value::Bool(_) => Ok(value.clone()),
        Value::Number(n) => canonical_number(n, shape, path).map(Value::Number),
        Value::String(s) => Ok(Value::String(nfc(s))),
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                path.push(i.to_string());
                let item = canonical_at(item, shape, path);
                path.pop();
                out.push(item?);
            }
            Ok(Value::Array(out))
        }
        Value::Object(members) => {
            let mut sorted: BTreeMap<String, &Value> = BTreeMap::new();
            for (key, member) in members {
                let key = nfc(key);
                if sorted.insert(key.clone(), member).is_some() {
                    return Err(CanonError {
                        path: join(path, Some(&key)),
                        what: "two keys are one key after NFC".to_string(),
                    });
                }
            }
            let mut out = Map::new();
            for (key, member) in sorted {
                path.push(key.clone());
                let member = canonical_at(member, shape, path);
                let kept = match member {
                    Ok(member) => match default_of(shape, path) {
                        Some(default) => {
                            let default = canonical_at(default, shape, path);
                            match default {
                                Ok(default) if default == member => None,
                                Ok(_) => Some(Ok(member)),
                                Err(e) => Some(Err(e)),
                            }
                        }
                        None => Some(Ok(member)),
                    },
                    Err(e) => Some(Err(e)),
                };
                path.pop();
                if let Some(kept) = kept {
                    out.insert(key, kept?);
                }
            }
            Ok(Value::Object(out))
        }
    }
}

/// The largest magnitude written as an integer: every whole number up to it is exact in an f64.
const WHOLE_LIMIT: f64 = 9_007_199_254_740_992.0; // 2^53

/// The number as the value at its field's width: rounded to that width first, then written as
/// an integer when whole (so `-0` is `0` and 2^24 + 1 at an f32 field is 2^24), else as a float.
fn canonical_number(n: &Number, shape: &dyn Shape, path: &[String]) -> Result<Number, CanonError> {
    let width = width_of(shape, path);
    if let Some(i) = n.as_i64() {
        if i.unsigned_abs() <= WHOLE_LIMIT as u64 && matches!(width, Width::F64) {
            return Ok(Number::from(i));
        }
    }
    // An integer the document wrote exactly but no f64 holds is refused, not rounded onto a
    // neighbour another document writes.
    let whole = n
        .as_i64()
        .map(|i| (i as i128, i as f64))
        .or_else(|| n.as_u64().map(|u| (u as i128, u as f64)));
    if let Some((i, f)) = whole {
        if f as i128 != i {
            return Err(CanonError {
                path: join(path, None),
                what: format!("{n} is not exact in an f64"),
            });
        }
    }
    let Some(f) = n.as_f64() else {
        return Err(CanonError {
            path: join(path, None),
            what: "number is not representable".to_string(),
        });
    };
    let rounded = match width {
        Width::F32 => (f as f32) as f64,
        Width::F64 => f,
    };
    if rounded.is_finite() && rounded.fract() == 0.0 && rounded.abs() <= WHOLE_LIMIT {
        return Ok(Number::from(rounded as i64));
    }
    Number::from_f64(rounded).ok_or_else(|| CanonError {
        path: join(path, None),
        what: format!("{f} is not finite at its declared width"),
    })
}

/// Writes an already canonical value. Every number in it is finite and, at an `F32` field,
/// already an `f32` value, so the cast here is exact.
fn write_value(value: &Value, shape: &dyn Shape, path: &mut Vec<String>, out: &mut Vec<u8>) {
    match value {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                out.extend_from_slice(i.to_string().as_bytes());
            } else if let Some(f) = n.as_f64() {
                let text = match width_of(shape, path) {
                    Width::F32 => (f as f32).to_string(),
                    Width::F64 => f.to_string(),
                };
                out.extend_from_slice(text.as_bytes());
            }
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                path.push(i.to_string());
                write_value(item, shape, path, out);
                path.pop();
            }
            out.push(b']');
        }
        Value::Object(members) => {
            out.push(b'{');
            for (i, (key, member)) in members.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                write_string(key, out);
                out.push(b':');
                path.push(key.clone());
                write_value(member, shape, path, out);
                path.pop();
            }
            out.push(b'}');
        }
    }
}

fn write_string(s: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    for c in s.chars() {
        match c {
            '"' => out.extend_from_slice(b"\\\""),
            '\\' => out.extend_from_slice(b"\\\\"),
            '\u{8}' => out.extend_from_slice(b"\\b"),
            '\u{c}' => out.extend_from_slice(b"\\f"),
            '\n' => out.extend_from_slice(b"\\n"),
            '\r' => out.extend_from_slice(b"\\r"),
            '\t' => out.extend_from_slice(b"\\t"),
            c if (c as u32) < 0x20 => {
                out.extend_from_slice(format!("\\u{:04x}", c as u32).as_bytes());
            }
            c => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    out.push(b'"');
}

fn nfc(s: &str) -> String {
    s.nfc().collect()
}

fn width_of(shape: &dyn Shape, path: &[String]) -> Width {
    let path: Vec<&str> = path.iter().map(String::as_str).collect();
    shape.width(&path)
}

fn default_of<'a>(shape: &'a dyn Shape, path: &[String]) -> Option<&'a Value> {
    let path: Vec<&str> = path.iter().map(String::as_str).collect();
    shape.default_at(&path)
}

fn join(path: &[String], last: Option<&str>) -> String {
    let mut parts: Vec<&str> = path.iter().map(String::as_str).collect();
    if let Some(last) = last {
        parts.push(last);
    }
    parts.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A shape from two sorted tables, keyed by the path joined with `/`.
    struct TableShape {
        widths: BTreeMap<String, Width>,
        defaults: BTreeMap<String, Value>,
    }

    impl TableShape {
        fn new() -> Self {
            Self {
                widths: BTreeMap::new(),
                defaults: BTreeMap::new(),
            }
        }

        fn f32_at(mut self, path: &str) -> Self {
            self.widths.insert(path.to_string(), Width::F32);
            self
        }

        fn default(mut self, path: &str, value: Value) -> Self {
            self.defaults.insert(path.to_string(), value);
            self
        }
    }

    impl Shape for TableShape {
        fn width(&self, path: &[&str]) -> Width {
            self.widths
                .get(&path.join("/"))
                .copied()
                .unwrap_or(Width::F64)
        }

        fn default_at(&self, path: &[&str]) -> Option<&Value> {
            self.defaults.get(&path.join("/"))
        }
    }

    fn bytes(value: &Value, shape: &dyn Shape) -> String {
        String::from_utf8(canonical_bytes(value, shape).unwrap()).unwrap()
    }

    #[test]
    fn permuted_keys_give_the_same_bytes() {
        let a = json!({"items": {"b": {"kind": "box", "x": 1}, "a": {"kind": "text"}}, "doc": "d"});
        let b = json!({"doc": "d", "items": {"a": {"kind": "text"}, "b": {"x": 1, "kind": "box"}}});
        assert_eq!(
            bytes(&a, &NoShape),
            r#"{"doc":"d","items":{"a":{"kind":"text"},"b":{"kind":"box","x":1}}}"#
        );
        assert_eq!(canonical_bytes(&a, &NoShape), canonical_bytes(&b, &NoShape));
        assert_eq!(revision_hash(&a, &NoShape), revision_hash(&b, &NoShape));
        assert_eq!(canonical_value(&a, &NoShape), canonical_value(&b, &NoShape));
    }

    #[test]
    fn keys_sort_by_code_point_not_utf16() {
        // U+FF61 is one UTF-16 unit (FF61); U+1F600 is a surrogate pair starting D83D. Code point
        // order puts U+FF61 first; UTF-16 order would put the emoji first.
        let doc = json!({"\u{1F600}": 1, "\u{FF61}": 2, "b": 3, "a": 4});
        assert_eq!(
            bytes(&doc, &NoShape),
            "{\"a\":4,\"b\":3,\"\u{FF61}\":2,\"\u{1F600}\":1}"
        );
    }

    #[test]
    fn a_param_equal_to_its_default_is_left_out() {
        let shape = TableShape::new()
            .default("items/box/params/width", json!(1.0))
            .default("items/box/params/fill", json!({"r": 0, "a": 1.0}));
        let doc = json!({"items": {"box": {"params": {"width": 1, "height": 2, "fill": {"a": 1, "r": 0.0}}}}});
        assert_eq!(
            bytes(&doc, &shape),
            r#"{"items":{"box":{"params":{"height":2}}}}"#
        );
        let changed =
            json!({"items": {"box": {"params": {"width": 1.5, "fill": {"a": 0.5, "r": 0}}}}});
        assert_eq!(
            bytes(&changed, &shape),
            r#"{"items":{"box":{"params":{"fill":{"a":0.5,"r":0},"width":1.5}}}}"#
        );
        assert_eq!(
            canonical_value(&doc, &shape).unwrap(),
            json!({"items": {"box": {"params": {"height": 2}}}})
        );
    }

    #[test]
    fn floats_write_shortest_at_their_width() {
        let shape = TableShape::new().f32_at("narrow");
        let third = 1.0f64 / 3.0;
        let doc = json!({"narrow": 0.1, "wide": 0.1});
        assert_eq!(bytes(&doc, &shape), r#"{"narrow":0.1,"wide":0.1}"#);
        let doc = json!({"narrow": third, "wide": third});
        assert_eq!(
            bytes(&doc, &shape),
            r#"{"narrow":0.33333334,"wide":0.3333333333333333}"#
        );
        // The value is rounded to its width, and that rounding is idempotent.
        let canonical = canonical_value(&doc, &shape).unwrap();
        assert_eq!(canonical["narrow"].as_f64(), Some((third as f32) as f64));
        assert_eq!(
            canonical_bytes(&canonical, &shape).unwrap(),
            canonical_bytes(&doc, &shape).unwrap()
        );
    }

    #[test]
    fn display_never_uses_an_exponent() {
        let doc = json!({"tiny": 1e-7, "huge": 1.5e21});
        assert_eq!(
            bytes(&doc, &NoShape),
            r#"{"huge":1500000000000000000000,"tiny":0.0000001}"#
        );
        // The extremes of both widths, where Debug would write an exponent: 1e100 and the
        // smallest f64, the largest f32 and the smallest at an f32 field.
        let text = bytes(&json!({"a": 1e100, "b": 5e-324}), &NoShape);
        assert!(
            !text.contains('e') && text.contains(&format!("1{}", "0".repeat(100))),
            "{text}"
        );
        assert!(text.contains(&format!("0.{}5", "0".repeat(323))), "{text}");
        let shape = TableShape::new().f32_at("a").f32_at("b");
        let text = bytes(&json!({"a": 3.4e38, "b": 1e-45}), &shape);
        assert!(!text.contains('e'), "{text}");
        assert!(
            text.starts_with(r#"{"a":34000000000000000"#)
                && text.contains(r#""b":0.000000000000000000000000000000000000000000001"#),
            "{text}"
        );
    }

    #[test]
    fn whole_numbers_write_as_integers_by_value() {
        let doc = json!({"a": 2.0, "b": 2, "c": -0.0, "d": -3.0, "e": 9007199254740992u64});
        assert_eq!(
            bytes(&doc, &NoShape),
            r#"{"a":2,"b":2,"c":0,"d":-3,"e":9007199254740992}"#
        );
        // At F32 width a whole number is the value at that width: 2^24 + 1 is not an f32.
        let shape = TableShape::new().f32_at("n");
        assert_eq!(bytes(&json!({"n": 16777217}), &shape), r#"{"n":16777216}"#);
        // Past 2^53 a number is a float at its width: 2^60 is one, 2^64 - 1 is not.
        assert_eq!(
            bytes(&json!({"n": 1152921504606846976u64}), &NoShape),
            r#"{"n":1152921504606847000}"#
        );
    }

    #[test]
    fn strings_are_nfc_in_keys_and_values() {
        let composed = json!({"caf\u{e9}": "r\u{e9}sum\u{e9}"});
        let decomposed = json!({"cafe\u{301}": "re\u{301}sume\u{301}"});
        assert_eq!(
            bytes(&composed, &NoShape),
            "{\"caf\u{e9}\":\"r\u{e9}sum\u{e9}\"}"
        );
        assert_eq!(
            canonical_bytes(&composed, &NoShape),
            canonical_bytes(&decomposed, &NoShape)
        );
        let both = json!({"caf\u{e9}": 1, "cafe\u{301}": 2});
        let err = canonical_bytes(&both, &NoShape).unwrap_err();
        assert_eq!(err.path, "caf\u{e9}");
    }

    #[test]
    fn strings_escape_only_what_json_requires() {
        let doc = json!({"s": "a\"b\\c\n\t\u{1}\u{7f}\u{2028}/"});
        assert_eq!(
            bytes(&doc, &NoShape),
            "{\"s\":\"a\\\"b\\\\c\\n\\t\\u0001\u{7f}\u{2028}/\"}"
        );
    }

    #[test]
    fn nested_maps_and_arrays_keep_shape() {
        let shape = TableShape::new()
            .f32_at("points/1/x")
            .default("items/a/style", json!({}));
        let doc = json!({
            "points": [{"y": 1, "x": 0.1}, {"y": 2.5, "x": 1.0f64 / 3.0}],
            "items": {"b": {}, "a": {"style": {}, "k": [[], {}]}}
        });
        assert_eq!(
            bytes(&doc, &shape),
            r#"{"items":{"a":{"k":[[],{}]},"b":{}},"points":[{"x":0.1,"y":1},{"x":0.33333334,"y":2.5}]}"#
        );
    }

    #[test]
    fn an_integer_no_f64_holds_is_refused_rather_than_rounded_onto_its_neighbour() {
        // 2^53 + 1 is written exactly in JSON but no f64 holds it: rounded, it would share
        // every canonical byte and the revision hash with the document that says 2^53.
        let shape = TableShape::new();
        let at_limit = json!({"data": {"n": 9007199254740992u64}});
        let past = json!({"data": {"n": 9007199254740993u64}});
        let err = canonical_bytes(&past, &shape).unwrap_err();
        assert_eq!(err.path, "data/n");
        assert!(err.what.contains("not exact"), "{}", err.what);
        assert!(revision_hash(&past, &shape).is_err());
        assert!(canonical_bytes(&json!({"data": {"n": -9007199254740993i64}}), &shape).is_err());
        assert!(canonical_bytes(&json!({"data": {"n": u64::MAX}}), &shape).is_err());
        // 2^53 + 2 is an f64 and keeps its own bytes.
        let even = json!({"data": {"n": 9007199254740994u64}});
        assert_ne!(
            canonical_bytes(&even, &shape).unwrap(),
            canonical_bytes(&at_limit, &shape).unwrap()
        );
        assert_ne!(
            revision_hash(&even, &shape).unwrap(),
            revision_hash(&at_limit, &shape).unwrap()
        );
    }

    #[test]
    fn a_number_past_its_width_is_refused_with_its_path() {
        let shape = TableShape::new().f32_at("items/box/params/width");
        let doc = json!({"items": {"box": {"params": {"width": 1e39}}}});
        let err = canonical_bytes(&doc, &shape).unwrap_err();
        assert_eq!(err.path, "items/box/params/width");
        assert!(err.what.contains("not finite"), "{}", err.what);
        assert!(canonical_value(&doc, &shape).is_err());
        assert!(revision_hash(&doc, &shape).is_err());
    }

    #[test]
    fn revision_hash_matches_an_independent_sha256() {
        // node -e of crypto.createHash('sha256') over the canonical text below, UTF-8.
        let doc = json!({"b": [1, 2.5, "\u{e9}"], "a": {"z": true, "y": null}});
        assert_eq!(
            bytes(&doc, &NoShape),
            "{\"a\":{\"y\":null,\"z\":true},\"b\":[1,2.5,\"\u{e9}\"]}"
        );
        assert_eq!(
            revision_hash(&doc, &NoShape).unwrap(),
            "12dcdb8b2cbdb2d996e1519aee774771a8647f89f065b4a3c4c2d7e0ec159fb5"
        );
    }

    #[test]
    fn a_number_at_an_f32_field_is_rounded_to_f32_before_whole_or_default_is_decided() {
        let shape = TableShape::new().f32_at("w").default("w", json!(16777216));
        // 2^24 + 1 is whole but not an f32; at an f32 field it is 2^24, which is the default.
        assert_eq!(bytes(&json!({"w": 16777217}), &shape), "{}");
        assert_eq!(bytes(&json!({"w": 16777217.0}), &shape), "{}");
        assert_eq!(bytes(&json!({"w": 16777219}), &shape), r#"{"w":16777220}"#);
        assert_eq!(
            canonical_value(&json!({"w": 16777217}), &shape),
            canonical_value(&json!({"w": 16777216}), &shape)
        );
        // A float that rounds to a whole f32 is written as that integer; -0.0 is 0.
        let plain = TableShape::new().f32_at("w");
        assert_eq!(bytes(&json!({"w": 1.0000000001}), &plain), r#"{"w":1}"#);
        assert_eq!(bytes(&json!({"w": -0.0}), &plain), r#"{"w":0}"#);
    }
}
