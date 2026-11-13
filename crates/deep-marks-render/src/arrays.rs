//! #536 (Mark set: logic columns): this binary has no logic module, so a mark set whose columns
//! or `alive` read a logic array is checked here as far as the document fixes it: each array a
//! logic item in the document writes, each `as` one the array's type narrows to, and one count
//! across the set, the set's row count. Its rows draw only where the logic module runs, so
//! marks2d's check leaves the set out.

use std::collections::BTreeSet;

use deep_canvas::document::Issue;
use serde_json::{json, Map, Value};

/// The mark sets of `doc` that read a logic array, and the issues their check raises.
pub fn sets(doc: &Map<String, Value>) -> (BTreeSet<String>, Vec<Issue>) {
    let items = doc.get("items").and_then(Value::as_object);
    let (mut sets, mut issues) = (BTreeSet::new(), Vec::new());
    for (id, item) in items.into_iter().flatten() {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let params = item.get("params");
        let columns = params
            .and_then(|p| p.get("columns"))
            .and_then(Value::as_object);
        let readers: Vec<(String, &Value)> = columns
            .into_iter()
            .flatten()
            .map(|(name, c)| (format!("items/{id}/params/columns/{name}"), c))
            .chain(
                params
                    .and_then(|p| p.get("alive"))
                    .map(|a| (format!("items/{id}/params/alive"), a)),
            )
            .filter(|(_, c)| c.get("array").is_some())
            .collect();
        if readers.is_empty() {
            continue;
        }
        sets.insert(id.clone());
        let mut counts = BTreeSet::new();
        for (path, column) in readers {
            let form = column["array"].as_str().unwrap_or_default();
            // `<logic>.<name>`, or `<logic>.preview.<name>` from its preview's writes.
            let written = form.split_once('.').and_then(|(logic, name)| {
                let logic = items?.get(logic).filter(|i| i["kind"] == "logic@1")?;
                match name.strip_prefix("preview.") {
                    Some(name) => logic
                        .get("params")?
                        .get("preview")?
                        .get("writes")?
                        .get(name),
                    None => logic.get("params")?.get("writes")?.get(name),
                }
            });
            let Some(written) = written else {
                issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    format!("{path}/array"),
                    json!(form),
                    "no logic item in the document writes this array",
                ));
                continue;
            };
            let ty = written["type"].as_str().unwrap_or_default();
            if deep_canvas::columns::Read::of(column, ty).is_none() {
                issues.push(Issue::error(
                    "bad_column",
                    id,
                    format!("{path}/as"),
                    json!({"array": form, "type": ty, "as": column.get("as"), "part": column.get("part")}),
                    "the array's type can't narrow to this `as`; a vector's column names its `part`",
                ));
            }
            counts.insert(written["count"].as_u64());
        }
        if counts.len() > 1 {
            issues.push(Issue::error(
                "bad_column",
                id,
                format!("items/{id}/params/columns"),
                json!(counts),
                "the set's array columns hold different counts; a set's row count is its arrays'",
            ));
        }
    }
    (sets, issues)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A set reading arrays its document's logic item writes passes and is left to the logic
    /// module; an unwritten array, an `as` the type can't narrow to and differing counts are
    /// each refused, naming the column.
    #[test]
    fn a_set_reading_logic_arrays_is_checked_as_far_as_the_document_fixes_it() {
        let doc = |columns: Value| {
            let doc = json!({"items": {
                "board": {"kind": "logic@1", "params": {"writes": {
                    "tiles": {"type": "i32", "count": 36}, "few": {"type": "i32", "count": 4},
                    "pos": {"type": "vec2", "count": 36}}}},
                "units": {"kind": "marks@1", "params": {"mark": "image", "columns": columns}},
                "plain": {"kind": "marks@1", "params": {"n": 1, "columns": {"x": {"const": 1}}}},
            }});
            sets(doc.as_object().expect("an object"))
        };
        let refused = |columns: Value| {
            let (_, issues) = doc(columns);
            issues
                .iter()
                .map(|i| (i.code, i.path.clone()))
                .collect::<Vec<_>>()
        };
        let (sets, issues) = doc(json!({"tile": {"array": "board.tiles", "as": "u16"}}));
        assert_eq!(sets.into_iter().collect::<Vec<_>>(), ["units"]);
        assert!(issues.is_empty(), "{issues:?}");
        let at = |c: &str, tail: &str| format!("items/units/params/columns/{c}/{tail}");
        assert_eq!(
            refused(json!({"tile": {"array": "board.gone", "as": "u16"}})),
            [("ref_unresolved", at("tile", "array"))]
        );
        assert_eq!(
            refused(json!({"x": {"array": "board.pos", "as": "f32"}})),
            [("bad_column", at("x", "as"))]
        );
        assert_eq!(
            refused(json!({"tile": {"array": "board.tiles", "as": "u16"},
                "flip": {"array": "board.few", "as": "u8"}})),
            [("bad_column", "items/units/params/columns".to_string())]
        );
    }
}
