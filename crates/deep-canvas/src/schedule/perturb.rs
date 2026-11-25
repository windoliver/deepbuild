//! Another value of a view input's or a look token's type (moved out of mod.rs whole, #3292).

use super::*;

/// Another value of a view input's type.
pub(super) fn perturb_view(k: usize, v: &Value) -> Value {
    match k {
        LOCALE => json!(if v.as_str() == Some("de") { "en" } else { "de" }),
        REDUCED_MOTION => json!(!v.as_bool().unwrap_or(false)),
        2 => json!(v.as_f64().unwrap_or(1.0) + 1.0),
        3 => json!(if v.is_null() { "someone" } else { "" }),
        _ => {
            let mut out = v.clone();
            if !perturb_number(&mut out) {
                out = json!([1, 1]);
            }
            out
        }
    }
}

/// Another value of a look token's type: a color's first channel moves.
pub(super) fn perturb_token(v: &Value) -> Value {
    match v {
        Value::Array(rgb) => {
            let mut out = rgb.clone();
            if let Some(first) = out.first_mut() {
                let x = first.as_u64().unwrap_or(0);
                *first = json!((x + 64) % 256);
            }
            Value::Array(out)
        }
        other => {
            let mut out = other.clone();
            if !perturb_number(&mut out) && !perturb_string(&mut out) {
                out = json!(0);
            }
            out
        }
    }
}
