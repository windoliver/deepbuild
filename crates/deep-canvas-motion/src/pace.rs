//! Issue #509: narration that sets the pace (canvas primitives: Time and the flick; Placement).
//! A narration line's and a word marker's start and end, which DeepBuild writes into the script
//! as `script.spoken` when it compiles one a time names, resolve wherever a time is read; and a
//! placement's span can be given as its `end`.

use serde_json::{Map, Value};

use crate::doc::{time_of, Ctx, Refused, Start};

/// Adds `script.spoken` to the context's markers; a marker of the same name keeps its own time.
pub(crate) fn seed(doc: &Map<String, Value>, ctx: &mut Ctx) {
    let Some(spoken) = doc
        .get("script")
        .and_then(|s| s.get("spoken"))
        .and_then(Value::as_object)
    else {
        return;
    };
    for (name, v) in spoken {
        if let (Some(a), Some(b)) = (
            v.get(0).and_then(Value::as_i64),
            v.get(1).and_then(Value::as_i64),
        ) {
            ctx.markers.entry(name.clone()).or_insert((a, b));
        }
    }
}

/// The markers resolved again from nothing but `script.spoken`.
pub(crate) fn reseed(doc: &Map<String, Value>, ctx: &mut Ctx) {
    ctx.markers.clear();
    seed(doc, ctx);
}

/// A placement's span: `span`, or its `end` less its start; `end` beside `span`, or after another
/// placement, is refused.
pub(crate) fn span(
    p: &Map<String, Value>,
    start: &Start,
    span: Option<i64>,
    ctx: &Ctx,
    path: &str,
) -> Result<Option<i64>, Refused> {
    let Some(end) = p.get("end") else {
        return Ok(span);
    };
    match (start, p.get("span")) {
        (Start::At(s), None) => Ok(Some(time_of(Some(end), ctx, &format!("{path}/end"))? - s)),
        _ => Err(Refused {
            code: "bad_doc",
            path: format!("{path}/end"),
            detail: None,
        }),
    }
}
