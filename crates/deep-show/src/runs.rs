//! Issue #629: a run's assertion values in a panel (canvas primitives: Bound value). The `run`
//! call records a run of a check once, from the report file its tool wrote, into a record entry
//! holding each test's raw expected and received bytes; a bound value on
//! `run:<id>#<assertion>` with `select: expected | received` reads that entry alone, so a replay
//! from the record shows the same with the report gone. What the agent said about the run is
//! kept in the entry as its words, and nothing reads it as a value.

use std::path::Path;

use deep_canvas::grammar::{Handle, Scheme};
use deep_canvas_marks::runs;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// What resolves a run's assertion value: the report's bytes, or a planted wrong program.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Resolver {
    Report,
    /// #629's planted `resolver_reads_summary`: the number after `expected` or `received` in the
    /// agent's summary of the run.
    Summary,
    /// #629's planted `unparsable_reads_zero`: a value that isn't a number reads 0.
    UnparsableZero,
}

/// `{"call": "run", …}`: a run of `check` that ended at `ended`, recorded from its tool's report.
pub struct RunCall {
    pub run: String,
    pub check: String,
    pub tool: String,
    pub report: String,
    pub ended: i64,
    pub summary: Option<String>,
}

/// The run's record entry, read from its report, or the refusal's code.
pub fn record(call: &RunCall, at: i64) -> Result<Value, Value> {
    if !is_run(&call.run) {
        return Err(json!({"code": "bad_handle", "path": "run"}));
    }
    let bytes = std::fs::read(&call.report)
        .map_err(|_| json!({"code": "report_unreadable", "path": "report"}))?;
    let assertions = runs::assertions(&call.tool, &bytes)
        .ok_or_else(|| json!({"code": "report_not_the_tools", "tool": call.tool}))?;
    let mut entry = json!({
        "run": call.run, "check": call.check, "tool": call.tool, "ended": call.ended,
        "recorded_at": at,
        "report": {"sha256": format!("{:x}", Sha256::digest(&bytes))},
        "assertions": assertions.iter().map(|a| json!({
            "assertion": a.assertion, "outcome": a.outcome,
            "expected": a.expected, "received": a.received,
        })).collect::<Vec<_>>(),
    });
    if let Some(path) = &call.summary {
        let text = std::fs::read_to_string(Path::new(path))
            .map_err(|_| json!({"code": "summary_unreadable", "path": "summary"}))?;
        // An agent's word is never evidence: kept as what it said, read by nothing.
        entry["summary"] = json!({"by": "agent", "evidence": false, "text": text});
    }
    Ok(entry)
}

/// A record entry as a replay gives it: its run and its end, with its assertions.
pub fn entry(v: &Value) -> Option<(String, i64)> {
    let run = v.get("run")?.as_str().filter(|r| is_run(r))?;
    v.get("assertions")?.as_array()?;
    Some((run.to_string(), v.get("ended")?.as_i64()?))
}

fn is_run(text: &str) -> bool {
    Handle::parse(text).is_ok_and(|h| h.scheme() == Scheme::Run && h.fragment().is_none())
}

/// The number a bound value on one assertion shows, with the decimals its bytes carry, or why it
/// reads missing, naming the run and the assertion.
pub fn resolve(
    entry: Option<&Value>,
    run: &str,
    assertion: &str,
    select: &str,
    unit: Option<&str>,
    resolver: Resolver,
) -> Result<(f64, u32), Value> {
    let missing = |cause: &str| runs::missing(cause, run, assertion, select);
    let Some(entry) = entry else {
        return Err(missing("not_recorded"));
    };
    let raw = match resolver {
        Resolver::Summary => entry
            .get("summary")
            .and_then(|s| s.get("text")?.as_str())
            .and_then(|t| said(t, select)),
        _ => entry
            .get("assertions")
            .and_then(Value::as_array)
            .and_then(|list| {
                list.iter()
                    .find(|a| a.get("assertion").and_then(Value::as_str) == Some(assertion))
            })
            .and_then(|a| a.get(select)?.as_str().map(str::to_string)),
    };
    let Some(raw) = raw else {
        return Err(missing("not_reported"));
    };
    match (runs::value(&raw, unit), resolver) {
        (Some(v), _) => Ok(v),
        (None, Resolver::UnparsableZero) => Ok((0.0, 0)),
        (None, _) => Err(missing("not_reported")),
    }
}

/// The planted reading of an agent's words: the number after `expected` or `received`.
fn said(text: &str, select: &str) -> Option<String> {
    let rest = &text[text.find(select)? + select.len()..];
    let n: String = rest
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    Some(n.trim_end_matches('.').to_string()).filter(|n| !n.is_empty())
}
