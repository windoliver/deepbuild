//! `effects.audit` (canvas primitives: Check input: loop kinds), the effects module's, beside
//! its shipped effects, so the loop module depends only on scene3d and look (#1940).
//!
//! It counts an effect's peak, bounds, overdraw and GPU time. None of the four is read yet
//! (#2485), so every requirement naming the kind is BLOCKED, never PASS.

use deep_canvas::registry::{Raised, Report};
use serde_json::{json, Value};

pub const KIND: &str = "effects.audit";
pub const UNREAD: &str = "effects.audit_unread";
/// The readings the kind names, none of which it reads yet.
const READINGS: [&str; 4] = ["count_peak", "bounds", "overdraw", "gpu_ms"];

/// The report: nothing read, one blocked row naming every unread reading.
pub fn report(_lowered: &Value, _input: &Value) -> Report {
    Report {
        blocked: vec![json!({
            "code": "not_run", "kind": KIND, "ids": [], "unread": READINGS,
            "why": "effects.audit reads no peak, bounds, overdraw or GPU time yet (#2485)"
        })],
        ..Report::default()
    }
}

/// Where only issues are read, what the check couldn't read is an error, never a pass.
pub fn issues(lowered: &Value, input: &Value) -> Vec<(String, Raised)> {
    report(lowered, input)
        .blocked
        .into_iter()
        .map(|b| {
            let raised = Raised {
                code: UNREAD,
                severity: "error",
                path: String::new(),
                what: format!("effects.audit couldn't read {}", b["unread"]),
                fix_ops: None,
            };
            (String::new(), raised)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_read_is_blocked_and_an_error_never_a_pass() {
        let doc = json!({"items": {}});
        let r = report(&doc, &json!({"kind": KIND}));
        assert!(r.results.is_empty() && r.raised.is_empty());
        assert_eq!(r.blocked.len(), 1);
        assert_eq!(r.blocked[0]["code"], "not_run");
        assert_eq!(r.blocked[0]["unread"], json!(READINGS));
        let raised = issues(&doc, &json!({"kind": KIND}));
        assert_eq!(raised.len(), 1);
        assert_eq!((raised[0].1.code, raised[0].1.severity), (UNREAD, "error"));
    }
}
