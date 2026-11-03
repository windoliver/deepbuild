//! The core's column view (issue #397; canvas primitives: Array and table: column view): a reader
//! names a column by its source's form, never a module, and the view resolves the form through the
//! entries canvas modules fill in `column.source@1`, narrowing each row by one rule.
//!
//! - A column `{source: form, as: dtype, part, range}` whose form no entry in the build fills
//!   belongs to a document that needs a missing module: refused `module_missing`.
//! - An `as` the source's type can't narrow to is refused at check, naming the column.
//! - A value outside `as`'s range or the column's `range`, a NaN or an infinity hides its row and
//!   raises `column.out_of_range {reader, column, row, value, step}`; it never wraps, clamps or
//!   rounds a value into range, and f64 to f32 rounds to nearest, ties to even.

use serde_json::{json, Map, Value};

use crate::document::Issue;
use crate::registry::lists::SealedEntry;

/// The registry the core declares for column sources.
pub const REGISTRY: &str = "column.source@1";

/// The value `v` of a `from` source read as `as_`, `Some(None)` where it can't narrow (its row
/// hides), and `None` where `as_` isn't a type `from` narrows to.
pub fn narrow(v: f64, from: &str, as_: &str) -> Option<Option<f64>> {
    let within = |lo: f64, hi: f64| {
        Some((v.is_finite() && v.fract() == 0.0 && v >= lo && v <= hi).then_some(v))
    };
    match (from, as_) {
        ("i32", "i32") => within(i32::MIN.into(), i32::MAX.into()),
        ("i32", "u32") => within(0.0, u32::MAX.into()),
        ("i32", "u16") => within(0.0, u16::MAX.into()),
        ("i32" | "bool", "u8") => within(0.0, u8::MAX.into()),
        ("i32" | "bool", "bool") => within(0.0, 1.0),
        ("f64", "f64") => Some(v.is_finite().then_some(v)),
        ("f64", "f32") => {
            let f = v as f32;
            Some(f.is_finite().then_some(f64::from(f)))
        }
        _ => None,
    }
}

/// The entry that fills `form` and the source's name in it: an entry's form names the source
/// with `<name>`, as `<logic>.<name>` does.
fn resolve<'e>(form: &str, entries: &'e [SealedEntry]) -> Option<(&'e SealedEntry, String)> {
    entries.iter().find_map(|e| {
        let pattern = e.value["form"].as_str()?;
        let (head, tail) = pattern.split_once("<name>")?;
        let name = form.strip_prefix(head)?.strip_suffix(tail)?;
        (!name.is_empty()).then(|| (e, name.to_string()))
    })
}

/// Every mark set column of `doc` that reads a column source, resolved through `entries` (the
/// build's `column.source@1`) and narrowed at `step`: written in place as the narrowed values
/// with the rows it hides (`hide`), and the issues the view raised.
pub fn view(doc: &mut Value, entries: &[SealedEntry], step: u64) -> Vec<Issue> {
    let mut issues = Vec::new();
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return issues;
    };
    for (id, item) in items.iter_mut() {
        let Some(Value::Object(columns)) = item.pointer_mut("/params/columns") else {
            continue;
        };
        for (name, column) in columns.iter_mut() {
            let Some(form) = column
                .get("source")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let path = format!("items/{id}/params/columns/{name}");
            let Some((entry, source)) = resolve(&form, entries) else {
                issues.push(Issue::error(
                    "module_missing",
                    id,
                    format!("{path}/source"),
                    json!(form),
                    "no canvas module in this build fills this column source",
                ));
                continue;
            };
            let filled = &entry.value["sources"][&source];
            let from = filled["dtype"].as_str().unwrap_or_default();
            let as_ = column
                .get("as")
                .and_then(Value::as_str)
                .unwrap_or(from)
                .to_string();
            let range = column.get("range").and_then(Value::as_array).cloned();
            let mut values = Vec::new();
            let mut hide = Vec::new();
            for (row, v) in filled["rows"].as_array().into_iter().flatten().enumerate() {
                let v = v.as_f64().unwrap_or(f64::NAN);
                let Some(narrowed) = narrow(v, from, &as_) else {
                    issues.push(Issue::error(
                        "bad_column",
                        id,
                        format!("{path}/as"),
                        json!({"from": from, "as": as_}),
                        "the column source's type can't narrow to this `as`",
                    ));
                    break;
                };
                let in_range = |x: f64| match range.as_deref() {
                    Some([lo, hi]) => {
                        lo.as_f64().is_none_or(|lo| x >= lo) && hi.as_f64().is_none_or(|hi| x <= hi)
                    }
                    _ => true,
                };
                match narrowed.filter(|x| in_range(*x)) {
                    Some(x) => values.push(x),
                    None => {
                        values.push(0.0);
                        hide.push(row);
                        issues.push(Issue {
                            severity: "warning",
                            ..Issue::error(
                                "column.out_of_range",
                                id,
                                path.clone(),
                                json!({"reader": id, "column": name, "row": row, "value": v, "step": step}),
                                "a row's value is out of its reader's range; the row hides while it lasts",
                            )
                        });
                    }
                }
            }
            let mut bytes = Vec::with_capacity(values.len() * 8);
            for v in &values {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            let mut out = Map::new();
            out.insert("dtype".into(), json!("f64"));
            out.insert("len".into(), json!(values.len()));
            out.insert("data".into(), json!(crate::base64::encode(&bytes)));
            out.insert("hide".into(), json!(hide));
            *column = Value::Object(out);
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One narrowing fixture per `as` (the registry's kit: "one narrowing fixture per `as`").
    #[test]
    fn each_as_narrows_by_the_one_rule_and_never_wraps_clamps_or_rounds() {
        let cases: &[(&str, &str, f64, Option<f64>)] = &[
            ("i32", "i32", -5.0, Some(-5.0)),
            ("i32", "u32", -1.0, None),
            ("i32", "u16", 70_000.0, None),
            ("i32", "u16", 65_535.0, Some(65_535.0)),
            ("i32", "u8", 256.0, None),
            ("i32", "bool", 2.0, None),
            ("bool", "u8", 1.0, Some(1.0)),
            ("f64", "f64", f64::NAN, None),
            ("f64", "f32", 1e39, None),
            ("f64", "f32", 0.1, Some(f64::from(0.1f32))),
        ];
        for (from, as_, v, want) in cases {
            assert_eq!(narrow(*v, from, as_), Some(*want), "{from} as {as_}: {v}");
        }
        assert_eq!(narrow(1.0, "f64", "u16"), None);
    }
}
