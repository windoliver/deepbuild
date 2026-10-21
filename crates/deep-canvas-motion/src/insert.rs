//! Inserting a key at the curve's own value (parity/animation/subdivision-stable.film): the new
//! key takes the value the channel evaluates at its time and the interpolation of the segment it
//! splits, and a Bézier segment's handles are split at the solved parameter, so the curve keeps its
//! shape. Nothing else in the document changes.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use serde_json::{json, Map, Value};

use crate::curve::{segment, Bezier, Interp};
use crate::doc::{self, Refused, ValueType};

fn refused<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

/// A flick count as seconds with at most five fraction digits, the time grammar's form, or
/// `None` when it has no such text.
fn seconds_text(t: i64) -> Option<String> {
    const UNIT: i64 = FLICKS_PER_SECOND / 100_000;
    if FLICKS_PER_SECOND % 100_000 != 0 || t % UNIT != 0 {
        return None;
    }
    let tenths = t / UNIT;
    let sign = if tenths < 0 { "-" } else { "" };
    let whole = tenths.unsigned_abs() / 100_000;
    let frac = tenths.unsigned_abs() % 100_000;
    if frac == 0 {
        return Some(format!("{sign}{whole}s"));
    }
    let digits = format!("{frac:05}");
    Some(format!("{sign}{whole}.{}s", digits.trim_end_matches('0')))
}

fn bezier_json(b: &Bezier) -> Value {
    json!({"bezier": {"x1": b.x1, "y1": b.y1, "x2": b.x2, "y2": b.y2}})
}

/// Inserts a key into `channel` at `t`, strictly inside one of its segments. Returns the new
/// document and the new key's ID.
pub fn insert(doc: &Value, channel: &str, t: i64) -> Result<(Value, String), Refused> {
    let motion = doc::read(doc)?;
    let Some(ch) = motion.channels.iter().find(|c| c.id == channel) else {
        return refused("ref_unresolved", format!("channels/{channel}"));
    };
    let keys = &ch.curve.keys;
    let Some(i) = keys.windows(2).position(|w| w[0].t < t && t < w[1].t) else {
        return refused("not_inside", format!("channels/{channel}"));
    };
    let (a, b) = (&keys[i], &keys[i + 1]);
    let Some(time) = seconds_text(t) else {
        return refused("bad_time", format!("channels/{channel}"));
    };
    let value = segment(a, b, t).value;
    let (left, right) = match a.interp {
        Interp::Hold => (None, json!("hold")),
        Interp::Linear => (None, json!("linear")),
        Interp::Bezier { x1, y1, x2, y2 } => {
            let curve = Bezier::new(x1, y1, x2, y2);
            let u = (t - a.t) as f64 / (b.t - a.t) as f64;
            let (l, r) = curve.split(curve.solve(u).s);
            (Some(bezier_json(&l)), bezier_json(&r))
        }
        // A spring segment is solved from rest at its start: no key splits it on its own curve.
        Interp::Spring { .. } => {
            return refused("bad_interp", format!("channels/{channel}/keys/{}", a.id))
        }
    };
    let value = match ch.ty {
        ValueType::F32 => json!(value[0]),
        ValueType::Color => json!(value),
    };
    let mut out = doc.clone();
    let Some(Value::Object(keys_json)) = out
        .get_mut("channels")
        .and_then(|c| c.get_mut(channel))
        .and_then(|c| c.get_mut("keys"))
    else {
        return refused("bad_doc", format!("channels/{channel}/keys"));
    };
    let id = (keys_json.len()..)
        .map(|n| format!("k{n}"))
        .find(|id| !keys_json.contains_key(id))
        .unwrap_or_default();
    if let (Some(left), Some(Value::Object(key))) = (left, keys_json.get_mut(&a.id)) {
        key.insert("interp".into(), left);
    }
    let mut key = Map::new();
    key.insert("t".into(), json!(time));
    key.insert("value".into(), value);
    key.insert("interp".into(), right);
    keys_json.insert(id.clone(), Value::Object(key));
    Ok((out, id))
}

#[cfg(test)]
mod tests {
    use super::seconds_text;

    #[test]
    fn a_time_prints_as_seconds_when_it_has_five_digits_or_fewer() {
        assert_eq!(seconds_text(705_600_000).as_deref(), Some("1s"));
        assert_eq!(
            seconds_text(7_056_000 * 7375 / 10).as_deref(),
            Some("7.375s")
        );
        assert_eq!(seconds_text(-705_600).as_deref(), Some("-0.001s"));
        assert_eq!(seconds_text(1), None);
    }
}
