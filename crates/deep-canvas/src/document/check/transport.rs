use serde_json::{json, Value};

use crate::document::{member, Issue};

pub fn frame_rate_of(transport: &Value) -> Option<(u32, u32)> {
    let whole = |v: &Value| u32::try_from(v.as_u64()?).ok();
    match member(transport, "frame_rate")? {
        Value::Array(pq) if pq.len() == 2 => Some((whole(&pq[0])?, whole(&pq[1])?)),
        n @ Value::Number(_) => Some((whole(n)?, 1)),
        Value::String(s) => {
            let (p, q) = s.split_once('/').unwrap_or((s, "1"));
            Some((p.trim().parse().ok()?, q.trim().parse().ok()?))
        }
        _ => None,
    }
}

pub(super) fn check_transport(doc: &Value, issues: &mut Vec<Issue>) {
    let Some(transport) = member(doc, "transport").filter(|t| t.is_object()) else {
        return;
    };
    if let Some(rate) = member(transport, "frame_rate") {
        let parsed = frame_rate_of(transport);
        let outcome = match parsed {
            Some((p, q)) => crate::time::frame_length(p, q).map(|_| ()),
            None => Err(format!(
                "frame rate {rate} is not two whole numbers above zero"
            )),
        };
        if let Err(why) = outcome {
            let named = parsed
                .map(|(p, q)| crate::time::Rate::Frame { p, q }.text())
                .unwrap_or_else(|| rate.to_string());
            issues.push(Issue::envelope(
                "bad_rate",
                "transport/frame_rate".into(),
                json!(named),
                &why,
            ));
        }
    }
    if let Some(rate) = member(transport, "sample_rate") {
        let outcome = match rate.as_u64().and_then(|hz| u32::try_from(hz).ok()) {
            Some(hz) => crate::time::sample_length(hz).map(|_| ()),
            None => Err(format!("sample rate {rate} is not a whole number of hertz")),
        };
        if let Err(why) = outcome {
            issues.push(Issue::envelope(
                "bad_rate",
                "transport/sample_rate".into(),
                rate.clone(),
                &why,
            ));
        }
    }
}
