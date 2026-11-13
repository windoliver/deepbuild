//! Reading the media module's fields from a document: a strip's asset, and the start, in and rate
//! a picture and its sound strip must agree on.

use serde_json::{json, Value};

/// The asset a strip plays: `src` as a SHA-256, or `src.asset`.
pub fn strip_asset(strip: &Value) -> Option<&str> {
    let src = strip.get("src")?;
    src.as_str().or_else(|| src.get("asset")?.as_str())
}

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 {
        a.abs().max(1)
    } else {
        gcd(b, a % b)
    }
}

/// A rate as a reduced `[p, q]`: a number, `[p, q]` or `"p/q"`.
pub fn rate(v: Option<&Value>) -> Option<(i64, i64)> {
    let (p, q) = match v {
        None => (1, 1),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => (i, 1),
            None => {
                let f = n.as_f64()?;
                ((f * 1000.0).round() as i64, 1000)
            }
        },
        Some(Value::Array(a)) if a.len() == 2 => (a[0].as_i64()?, a[1].as_i64()?),
        Some(Value::String(s)) => {
            let (p, q) = s.split_once('/')?;
            (p.trim().parse().ok()?, q.trim().parse().ok()?)
        }
        _ => return None,
    };
    if q <= 0 || p <= 0 {
        return None;
    }
    let g = gcd(p, q);
    Some((p / g, q / g))
}

/// A time field in flicks: a whole number of flicks, or a time literal such as `"1s"`.
pub fn time(doc: &Value, v: Option<&Value>) -> Option<i64> {
    match v {
        None => Some(0),
        Some(Value::Number(n)) => n.as_i64(),
        Some(t @ Value::String(s)) => {
            if s.trim_start_matches(['0', '.'])
                .trim_end_matches(['s', 'f'])
                .is_empty()
            {
                return Some(0);
            }
            deep_canvas::document::duration(doc, t).ok()
        }
        _ => None,
    }
}

/// The source time, in flicks, an item's `frames` shows at `t`: before start, its first frame's.
/// Every host that draws a video's frame at t reads it here (#499, #503).
pub fn source_time(doc: &Value, frames: &Value, t: i64) -> i64 {
    let start = time(doc, frames.get("start")).unwrap_or(0);
    let r#in = time(doc, frames.get("in")).unwrap_or(0);
    let rate = rate(frames.get("rate")).unwrap_or((1, 1));
    crate::frames::source_time(t.max(start), start, r#in, rate)
}

/// The value of `field` (start, in or rate) a picture's `frames` or a strip holds, as compared.
pub fn link_value(doc: &Value, obj: &Value, field: &str) -> Value {
    match field {
        "rate" => json!(rate(obj.get("rate"))),
        f => json!(time(doc, obj.get(f))),
    }
}
