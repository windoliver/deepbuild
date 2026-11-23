//! A planted wrong program for #2086's AC1 (tests/acceptance/2086-redraft-2047, twin `limit-raised`, as in
//! `err-past-limit`): an operator's error that holds what the operator found inline, as `OpError` did before #2086
//! boxed it, so a function returning it passes clippy's size limit for an `Err` (clippy::result_large_err). Here the
//! clippy.toml beside it raises that limit for the whole workspace, which hides the finding.
use serde_json::{json, Value};

/// An operator's error with the found value unboxed: 136 bytes or more with serde_json's preserve_order.
pub struct OpErrorUnboxed {
    pub code: &'static str,
    pub path: String,
    pub read: Option<String>,
    pub actual: Option<Value>,
}

fn evaluate(found: Value) -> Result<(), OpErrorUnboxed> {
    Err(OpErrorUnboxed {
        code: "arrange_unsatisfied",
        path: "items/arrangement".into(),
        read: None,
        actual: Some(found),
    })
}

fn main() {
    if let Err(e) = evaluate(json!({ "missed": [] })) {
        eprintln!("{} {} {:?} {:?}", e.code, e.path, e.read, e.actual);
    }
}
