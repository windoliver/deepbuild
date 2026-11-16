//! #540: a declared input's `data` expressions (canvas primitives: Input track entries). Each
//! field written as text is an expression from the closed function list over controls and
//! constants, read at its entry's flick: a var `<control>.<path>` reads that control's last entry
//! at or before the flick and walks its value by the path, as `aim.ray.dir` reads a point
//! control's stored ray (Control: point), so a replay reads what the entry stored and never the
//! camera. A field `from.pos` or `from.rot` gives a launch's `from: pose`.

use std::collections::BTreeMap;

use deep_canvas::expr::{Expr, Nothing, V};
use serde_json::{json, Map, Value};

/// The most nodes a field's expression takes, as a driver's.
const CAP: usize = 64;

/// A field's expression, or why it isn't one.
pub fn compile(text: &str) -> Result<Expr, String> {
    Expr::compile(text, &Nothing, CAP).map_err(|r| r.to_string())
}

/// The fields `exprs` give for `entry` of `track`, read at its flick: a number as a number, a
/// vector as its components, `from.pos` and `from.rot` as the fields of `from`. None when a var
/// reads nothing there (no entry of its control at or before the flick, or a missing or null
/// field) or a value isn't finite: that entry derives no input.
pub fn fields(
    exprs: &BTreeMap<String, Expr>,
    entry: &Value,
    track: &[Value],
) -> Option<Map<String, Value>> {
    let mut out = Map::new();
    for (field, e) in exprs {
        let vars: Option<Vec<V>> = e.vars.iter().map(|v| read(v, entry, track)).collect();
        let value = match e.eval(&vars?) {
            v if !v.is_finite() => return None,
            V::S(x) => json!(x),
            V::V(n, c) => json!(c[..n as usize]),
        };
        match field.split_once('.') {
            Some((head, sub)) => {
                let slot = out.entry(head).or_insert_with(|| json!({}));
                slot[sub] = value;
            }
            None => {
                out.insert(field.clone(), value);
            }
        }
    }
    Some(out)
}

/// An entry's place on the track: its flick, then its `seq`.
fn key(e: &Value) -> (i64, i64) {
    (e["t"].as_i64().unwrap_or(0), e["seq"].as_i64().unwrap_or(0))
}

/// The var `<control>.<path>` at `entry`'s flick: that control's last entry at or before it (the
/// entry itself when it's that control's), its value walked by the path, a number or 2 to 4.
fn read(var: &str, entry: &Value, track: &[Value]) -> Option<V> {
    let (control, path) = var.split_once('.').unwrap_or((var, ""));
    let last = if entry["control"] == control {
        entry
    } else {
        track
            .iter()
            .filter(|e| e["control"] == control && key(e) <= key(entry))
            .max_by_key(|e| key(e))?
    };
    let v = path
        .split('.')
        .filter(|s| !s.is_empty())
        .try_fold(&last["value"], |v, s| v.get(s))?;
    match v {
        Value::Number(n) => n.as_f64().map(V::S),
        Value::Array(a) if (2..=4).contains(&a.len()) => {
            let mut c = [0.0; 4];
            for (slot, x) in c.iter_mut().zip(a) {
                *slot = x.as_f64()?;
            }
            Some(V::V(a.len() as u8, c))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A point control's entry at `t` (flicks): its eye at `origin`, looking along `dir`.
    fn aim(t: i64, seq: i64, phase: &str, origin: [f64; 3], dir: [f64; 3]) -> Value {
        json!({"t": t, "seq": seq, "control": "aim", "value": {"phase": phase, "button": "primary",
            "ground": null, "hit": null, "ray": {"origin": origin, "dir": dir}}})
    }

    fn exprs(fields: &[(&str, &str)]) -> BTreeMap<String, Expr> {
        fields
            .iter()
            .map(|(k, t)| (k.to_string(), compile(t).unwrap()))
            .collect()
    }

    /// Each entry reads its own stored ray, so a release after the camera turned throws along
    /// its own, and `from.pos` is the pose's position.
    #[test]
    fn a_throw_reads_each_entrys_own_ray() {
        let e = exprs(&[
            ("from.pos", "aim.ray.origin"),
            ("linear", "20 * aim.ray.dir"),
        ]);
        let track = [
            aim(100, 0, "press", [0.0, 2.0, 5.0], [0.0, 0.0, -1.0]),
            aim(900, 1, "release", [3.0, 2.0, 0.0], [-1.0, 0.0, 0.0]),
        ];
        let at = |i: usize| fields(&e, &track[i], &track).unwrap();
        assert_eq!(at(0)["from"], json!({"pos": [0.0, 2.0, 5.0]}));
        assert_eq!(at(0)["linear"], json!([0.0, 0.0, -20.0]));
        assert_eq!(at(1)["from"], json!({"pos": [3.0, 2.0, 0.0]}));
        assert_eq!(at(1)["linear"], json!([-20.0, 0.0, 0.0]));
    }

    /// Another control's field is its last entry at or before the flick; before any entry of
    /// it, or for a field the entry lacks, the entry derives nothing.
    #[test]
    fn another_controls_field_is_its_last_entry_at_the_flick() {
        let e = exprs(&[("linear", "speed * aim.ray.dir")]);
        let speed =
            |t: i64, seq: i64, v: f64| json!({"t": t, "seq": seq, "control": "speed", "value": v});
        let go = json!({"t": 500, "seq": 3, "control": "go", "value": true});
        let track = [
            aim(100, 0, "press", [0.0; 3], [1.0, 0.0, 0.0]),
            speed(200, 1, 4.0),
            aim(500, 2, "move", [0.0; 3], [0.0, 1.0, 0.0]),
            go.clone(),
            speed(500, 4, 9.0),
            aim(700, 5, "release", [0.0; 3], [0.0, 0.0, 1.0]),
        ];
        assert_eq!(
            fields(&e, &go, &track).unwrap()["linear"],
            json!([0.0, 4.0, 0.0])
        );
        assert_eq!(fields(&e, &track[0], &track), None);
        let missing = exprs(&[("linear", "aim.surface.normal")]);
        assert_eq!(fields(&missing, &track[0], &track), None);
    }
}
