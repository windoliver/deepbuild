//! Issue #629: a run's assertion values (canvas primitives: Bound value). A run handle may name
//! one assertion its check names, `run:<id>#<assertion>`; `select: expected` and `select:
//! received` read the two values the tool's report recorded for that assertion where it failed,
//! as the raw bytes it printed, parsed as a number in the unit `format` declares. The report is
//! read once, when the run is recorded, into [`Assertion`]s, so a replay reads the record alone.
//! Nothing here reads what an agent said about a run: an agent's word is never evidence.

use serde_json::{json, Map, Value};

use crate::scene::{bound_text, Record};

/// One test a tool's report names, and the raw values it printed where it failed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    /// The test's full name as the report gives it.
    pub assertion: String,
    /// `passed`, `failed`, or the report's own word for a test that neither passed nor failed.
    pub outcome: String,
    pub expected: Option<String>,
    pub received: Option<String>,
}

/// The tests a report names, from the tool's own JSON reporter file: Vitest's
/// (`--reporter=json`) or Playwright's (`--reporter=json`), one per name. A name the report
/// gives more than once (a Playwright test in each project) is the first that failed, else the
/// first. `None` for another tool or a file that isn't that reporter's.
pub fn assertions(tool: &str, report: &[u8]) -> Option<Vec<Assertion>> {
    let report: Value = serde_json::from_slice(report).ok()?;
    let all = match tool {
        "vitest" => vitest(&report)?,
        "playwright" => {
            let mut out = Vec::new();
            for suite in report.get("suites")?.as_array()? {
                // A top-level suite is a file; the suites inside it are its describes.
                playwright(suite, &[], &mut out)?;
            }
            out
        }
        _ => return None,
    };
    let mut out: Vec<Assertion> = Vec::new();
    for a in all {
        match out.iter_mut().find(|o| o.assertion == a.assertion) {
            Some(o) if o.outcome != "failed" && a.outcome == "failed" => *o = a,
            Some(_) => {}
            None => out.push(a),
        }
    }
    Some(out)
}

/// A bind's run source, `run:<id>#<assertion>`, as the handle grammar reads it: the run's
/// handle and the assertion it names.
pub fn source(text: &str) -> Option<(String, String)> {
    use deep_canvas::grammar::{Handle, Scheme};
    let h = Handle::parse_source(text).ok()?;
    let assertion = h.fragment()?.to_string();
    (h.scheme() == Scheme::Run).then(|| (format!("run:{}", h.id().as_str()), assertion))
}

fn vitest(report: &Value) -> Option<Vec<Assertion>> {
    let mut out = Vec::new();
    for file in report.get("testResults")?.as_array()? {
        for t in file.get("assertionResults")?.as_array()? {
            let outcome = t.get("status")?.as_str()?.to_string();
            // Vitest prints `expected <received> to be <expected>` on the message's first line.
            let printed = t
                .get("failureMessages")
                .and_then(Value::as_array)
                .and_then(|m| m.first())
                .and_then(Value::as_str)
                .filter(|_| outcome == "failed")
                .and_then(|m| vitest_values(m.lines().next().unwrap_or("")));
            let (received, expected) = printed.unzip();
            out.push(Assertion {
                assertion: t.get("fullName")?.as_str()?.to_string(),
                outcome,
                expected,
                received,
            });
        }
    }
    Some(out)
}

/// The received and expected values of Vitest's `expected <received> to <matcher> <expected>`.
fn vitest_values(line: &str) -> Option<(String, String)> {
    const MATCHERS: [&str; 5] = [
        " to be close to ",
        " to be ",
        " to equal ",
        " to deeply equal ",
        " to strictly equal ",
    ];
    let rest = &line[line.find("expected ")? + "expected ".len()..];
    let rest = rest.split(" // ").next().unwrap_or(rest);
    // `toBeCloseTo` goes on to print the difference after its expected value.
    let rest = rest.split(", received difference").next().unwrap_or(rest);
    // The earliest matcher, the longest where two start together (`to be close to`).
    let (at, matcher) = MATCHERS
        .iter()
        .filter_map(|m| Some((rest.find(m)?, m)))
        .min_by_key(|(at, m)| (*at, usize::MAX - m.len()))?;
    Some((
        rest[..at].to_string(),
        rest[at + matcher.len()..].to_string(),
    ))
}

fn playwright(suite: &Value, describes: &[String], out: &mut Vec<Assertion>) -> Option<()> {
    for spec in suite
        .get("specs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let title = spec.get("title")?.as_str()?;
        let name = describes
            .iter()
            .map(String::as_str)
            .chain([title])
            .collect::<Vec<_>>()
            .join(" ");
        for test in spec.get("tests")?.as_array()? {
            // The last attempt is the test's outcome; a timeout fails it.
            let last = test.get("results")?.as_array()?.last();
            let status = last
                .and_then(|r| r.get("status")?.as_str())
                .unwrap_or("skipped");
            let outcome = match status {
                "timedOut" | "interrupted" => "failed",
                s => s,
            };
            let message = last
                .and_then(|r| r.get("error")?.get("message")?.as_str())
                .filter(|_| outcome == "failed")
                .map(strip_ansi)
                .unwrap_or_default();
            out.push(Assertion {
                assertion: name.clone(),
                outcome: outcome.to_string(),
                expected: printed(&message, "Expected"),
                received: printed(&message, "Received"),
            });
        }
    }
    for inner in suite
        .get("suites")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let mut path = describes.to_vec();
        path.push(inner.get("title")?.as_str()?.to_string());
        playwright(inner, &path, out)?;
    }
    Some(())
}

/// What a Playwright message prints after `Expected:` or `Received:` (or `Expected string:`).
fn printed(message: &str, label: &str) -> Option<String> {
    message.lines().find_map(|line| {
        let rest = line.strip_prefix(label)?;
        let (kind, value) = rest.split_once(':')?;
        (kind.trim().chars().all(|c| c.is_ascii_alphabetic())).then(|| value.trim().to_string())
    })
}

/// A message without its terminal color codes, which the tool adds and never printed as a value.
fn strip_ansi(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        if chars.next() == Some('[') {
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }
    out
}

/// A raw printed value as a number in `unit`, with the decimals it was printed with: quotes the
/// tool put around a string and the unit's own sign or code are dropped, and what is left must
/// be a plain decimal number. `None` for anything else, such as `N/A`: never 0.
pub fn value(raw: &str, unit: Option<&str>) -> Option<(f64, u32)> {
    let mut text = raw.trim();
    for q in ['"', '\''] {
        if let Some(inner) = text.strip_prefix(q).and_then(|t| t.strip_suffix(q)) {
            text = inner.trim();
        }
    }
    // A sign may come before the unit's own (`-$18.00`).
    let signed = text.strip_prefix('-');
    if let Some(rest) = signed {
        text = rest.trim_start();
    }
    if let Some(unit) = unit {
        let sign = match unit {
            "USD" => Some("$"),
            _ => None,
        };
        for mark in sign.into_iter().chain([unit]) {
            if let Some(rest) = text.strip_prefix(mark).or_else(|| text.strip_suffix(mark)) {
                text = rest.trim();
                break;
            }
        }
    }
    let (negative, digits) = match (signed, text.strip_prefix('-')) {
        (None, Some(rest)) => (true, rest),
        (Some(_), Some(_)) => return None,
        (signed, None) => (signed.is_some(), text),
    };
    let (int, frac) = match digits.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (digits, None),
    };
    let groups: Vec<&str> = int.split(',').collect();
    let grouped = groups.len() == 1
        || (!groups[0].is_empty()
            && groups[0].len() <= 3
            && groups[1..].iter().all(|g| g.len() == 3));
    let all_digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if !grouped || !groups.iter().all(|g| all_digits(g)) || frac.is_some_and(|f| !all_digits(f)) {
        return None;
    }
    let plain = format!("{}.{}", groups.concat(), frac.unwrap_or("0"));
    let n: f64 = plain.parse().ok()?;
    Some((
        if negative { -n } else { n },
        frac.map_or(0, |f| f.len() as u32),
    ))
}

/// Why a bound value on one assertion reads missing, naming the run and the assertion:
/// `not_reported` where its report holds no such value or one that doesn't parse as a number.
pub fn missing(cause: &str, run: &str, assertion: &str, select: &str) -> Value {
    json!({"cause": cause, "run": run, "assertion": assertion, "select": select})
}

/// What a bound value on `source`, a run's assertion, draws through the canvas's bound-value
/// text: `value` with the decimals its bytes carry, or the bind's `missing` (the dash) without
/// one. A run's values never go stale: they are what its report recorded when it ended, at
/// `as_of`. `None` for a bind whose format the canvas refuses.
pub fn text(bind: &Value, source: &str, value: Option<(f64, u32)>, as_of: i64) -> Option<String> {
    let mut bound = Map::new();
    bound.insert("target".into(), json!("items/v/params/text"));
    bound.insert("source".into(), json!(source));
    for k in ["format", "missing"] {
        if let Some(v) = bind.get(k) {
            bound.insert(k.into(), v.clone());
        }
    }
    let mut doc = Map::new();
    doc.insert("bound_values".into(), json!({ "v": bound }));
    let mut record = Record {
        pinned: as_of,
        ..Record::default()
    };
    if let Some((v, precision)) = value {
        record.readings.insert(source.to_string(), v);
        record.precision.insert(source.to_string(), precision);
        record.as_of.insert(source.to_string(), as_of);
    }
    Some(bound_text(&doc, "v", &json!({}), &record, "en").ok()??.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_printed_value_parses_only_as_a_number_in_its_unit() {
        assert_eq!(value("18.01", None), Some((18.01, 2)));
        assert_eq!(value("18", None), Some((18.0, 0)));
        assert_eq!(value("\"$18.00\"", Some("USD")), Some((18.0, 2)));
        assert_eq!(value("1,234.5 USD", Some("USD")), Some((1234.5, 1)));
        assert_eq!(value("-3", None), Some((-3.0, 0)));
        assert_eq!(value("-$18.00", Some("USD")), Some((-18.0, 2)));
        assert_eq!(value("$-18.00", Some("USD")), Some((-18.0, 2)));
        assert_eq!(value("--3", None), None);
        for bad in [
            "N/A", "\"N/A\"", "", "$18.00", "18.", ".5", "1,23", "18e3", "NaN", "Infinity", "0x12",
        ] {
            assert_eq!(value(bad, None), None, "{bad:?}");
        }
        assert_eq!(value("€18", Some("USD")), None);
    }

    #[test]
    fn vitest_prints_the_received_value_first() {
        assert_eq!(
            vitest_values("AssertionError: expected 18 to be 18.01 // Object.is equality"),
            Some(("18".into(), "18.01".into()))
        );
        assert_eq!(
            vitest_values("AssertionError: expected 'a' to deeply equal 'b'"),
            Some(("'a'".into(), "'b'".into()))
        );
        assert_eq!(
            vitest_values("AssertionError: expected 18 to be close to 18.01, received difference is 0.01, but expected 0.005"),
            Some(("18".into(), "18.01".into()))
        );
        assert_eq!(vitest_values("Error: boom"), None);
    }
}
