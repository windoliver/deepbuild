//! `needs-you@1`: a Needs you view's rows equal the inbox projection's list, row for row. A failure
//! names the ask at the first row that differs: the one the projection lists there, or, past the
//! projection's end, the one the view listed on its own.

use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub pass: bool,
    pub names: Option<String>,
}

impl Verdict {
    pub fn to_json(&self) -> Value {
        match &self.names {
            Some(names) => {
                json!({ "result": if self.pass { "pass" } else { "fail" }, "names": names })
            }
            None => json!({ "result": if self.pass { "pass" } else { "fail" } }),
        }
    }
}

pub fn needs_you(rows: &[String], expected: &[String]) -> Verdict {
    if rows == expected {
        return Verdict {
            pass: true,
            names: None,
        };
    }
    let first = (0..rows.len().max(expected.len()))
        .find(|&index| rows.get(index) != expected.get(index))
        .expect("unequal lists differ somewhere");
    let names = expected.get(first).or_else(|| rows.get(first)).cloned();
    Verdict { pass: false, names }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn handles(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| format!("ask:{id}")).collect()
    }

    #[test]
    fn equal_rows_pass_and_each_fault_names_a_wrong_ask() {
        let want = handles(&["A", "B", "C"]);
        assert!(needs_you(&want, &want).pass);
        assert_eq!(
            needs_you(&handles(&["A", "B"]), &want).names.as_deref(),
            Some("ask:C")
        );
        assert_eq!(
            needs_you(&handles(&["A", "B", "C", "Z"]), &want)
                .names
                .as_deref(),
            Some("ask:Z")
        );
        assert_eq!(
            needs_you(&handles(&["C", "B", "A"]), &want)
                .names
                .as_deref(),
            Some("ask:A")
        );
    }

    #[test]
    fn a_repeated_row_is_named_too() {
        let want = handles(&["A", "B", "C"]);
        let verdict = needs_you(&handles(&["A", "A", "B", "C"]), &want);
        assert!(!verdict.pass);
        assert_eq!(verdict.names.as_deref(), Some("ask:B"));
    }
}
