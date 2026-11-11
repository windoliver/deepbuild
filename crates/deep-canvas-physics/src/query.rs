//! physics.query (#1919; canvas primitives: Check input: `physics.query`), the parts that read no
//! engine: the occurrence rows a probe's filter keeps, the measure it takes of them, the verdict
//! an expectation gives a result, and where the bake's golden stands across machines. Outputs and
//! occurrences come from the bake's columns; a ray, sweep or overlap reaches an engine only
//! through the backend interface's `query()` (backend.rs), which the runner calls.

use serde_json::{json, Value};

use crate::golden;

/// The rows of `list` (the bake's occurrence rows as listed) that `filter` keeps: those of its
/// `kinds` by name naming every one of its `ids` as `a` or `b`; a key left out keeps every row.
pub fn kept<'a>(list: &'a [Value], filter: &Value) -> Vec<&'a Value> {
    let names = |k: &str| -> Option<Vec<&str>> {
        Some(
            filter
                .get(k)?
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .collect(),
        )
    };
    let (kinds, ids) = (names("kinds"), names("ids"));
    list.iter()
        .filter(|r| {
            kinds
                .as_ref()
                .is_none_or(|k| k.iter().any(|x| r["kind"] == *x))
                && ids
                    .as_ref()
                    .is_none_or(|i| i.iter().all(|id| r["a"] == *id || r["b"] == *id))
        })
        .collect()
}

/// The row `nth` picks among `rows`: `first` (when absent), `last`, or the nth, counted from 1.
pub fn nth<'a>(rows: &[&'a Value], nth: Option<&Value>) -> Option<&'a Value> {
    match nth.map_or(Some("first"), Value::as_str) {
        Some("first") => rows.first().copied(),
        Some("last") => rows.last().copied(),
        _ => rows
            .get(usize::try_from(nth?.as_u64()?).ok()?.checked_sub(1)?)
            .copied(),
    }
}

/// What a probe read: its value (`None` when it met nothing), the step it read at and the IDs.
#[derive(Debug, Default, PartialEq)]
pub struct Reading {
    pub value: Option<f64>,
    pub step: u64,
    pub ids: Vec<String>,
}

/// An occurrences probe's measure over the rows it kept (`count` when absent): their count; the
/// first's or the last's time in flicks, its steps `step` flicks apart; a field of the first; or
/// the IDs `order` names in the order their first rows come. `None` for a measure it doesn't name.
pub fn measure(rows: &[&Value], m: Option<&Value>, step_flicks: i64) -> Option<Reading> {
    let step = |r: Option<&&Value>| r.and_then(|r| r["step"].as_u64()).unwrap_or(0);
    let at = |r: Option<&&Value>| Reading {
        value: r.map(|r| (step(Some(r)) as i64 * step_flicks) as f64),
        step: step(r),
        ids: Vec::new(),
    };
    Some(match m.map_or(Some("count"), Value::as_str) {
        Some("count") => Reading {
            value: Some(rows.len() as f64),
            step: step(rows.last()),
            ids: Vec::new(),
        },
        Some("first") => at(rows.first()),
        Some("last") => at(rows.last()),
        _ if m?.get("field").is_some() => {
            let name = m?["field"].as_str()?;
            Reading {
                value: rows.first().and_then(|r| r[name].as_f64()),
                ..at(rows.first())
            }
        }
        _ => {
            let by: Vec<&str> = m?["order"]
                .as_array()?
                .iter()
                .filter_map(Value::as_str)
                .collect();
            let mut ids: Vec<(u64, String)> = by
                .iter()
                .filter_map(|id| {
                    let r = rows.iter().find(|r| r["a"] == *id || r["b"] == *id)?;
                    Some((r["step"].as_u64()?, id.to_string()))
                })
                .collect();
            ids.sort_by_key(|(s, _)| *s);
            Reading {
                value: None,
                step: ids.last().map_or(0, |(s, _)| *s),
                ids: ids.into_iter().map(|(_, id)| id).collect(),
            }
        }
    })
}

/// Whether `r` meets `expect` (`value`, `range` or `ids`, `order`) within `tolerance`; `None` for
/// an expectation it doesn't name.
pub fn meets(r: &Reading, expect: &Value, tolerance: f64) -> Option<bool> {
    let ids = |k: &str| -> Option<Vec<&str>> {
        expect
            .get(k)?
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect()
    };
    if let Some(want) = expect.get("value") {
        let want = want.as_f64()?;
        return Some(r.value.is_some_and(|v| (v - want).abs() <= tolerance));
    }
    if let Some([lo, hi]) = expect
        .get("range")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
    {
        let (lo, hi) = (lo.as_f64()?, hi.as_f64()?);
        return Some(
            r.value
                .is_some_and(|v| v >= lo - tolerance && v <= hi + tolerance),
        );
    }
    let want = ids("ids").or_else(|| ids("order"))?;
    Some(r.ids == want)
}

/// `any` when the bake's golden matched on a second machine (a `golden_verify` run from another
/// architecture among `runs` passed, Golden), `same` otherwise, a golden of none included.
pub fn machines(golden: Option<&Value>, runs: &[Value]) -> &'static str {
    let cross = golden.and_then(|g| golden::cross(g, &[], runs));
    if cross.is_some_and(|c| c["verdict"] == json!("PASS")) {
        "any"
    } else {
        "same"
    }
}
