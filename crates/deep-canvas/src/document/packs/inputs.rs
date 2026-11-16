//! A recipe input's value check: whether a param an instance writes is a value of its input.

use serde_json::{Map, Value};

use super::{Input, Recipe};

/// Why `value` is no value of `input`, if it isn't.
pub(in crate::document) fn input_fault(input: &Input, value: &Value) -> Option<String> {
    let range = |n: f64| -> Option<String> {
        let below = input.min.is_some_and(|min| n < min);
        let above = input.max.is_some_and(|max| n > max);
        (below || above || !n.is_finite()).then(|| {
            format!(
                "outside {} to {}",
                input.min.unwrap_or(f64::NEG_INFINITY),
                input.max.unwrap_or(f64::INFINITY)
            )
        })
    };
    match input.ty.as_str() {
        "number" => match value.as_f64() {
            Some(n) => range(n),
            None => Some("not a number".into()),
        },
        "integer" => match value.as_f64() {
            Some(n) if n.fract() == 0.0 => range(n),
            _ => Some("not an integer".into()),
        },
        "bool" => (!value.is_boolean()).then(|| "not a bool".to_string()),
        "choice" => match value.as_str() {
            Some(s) if input.options.iter().any(|o| o == s) => None,
            _ => Some(format!("not one of {}", input.options.join(", "))),
        },
        "vec3" | "range" => {
            let (len, what) = match input.ty.as_str() {
                "vec3" => (3, "not three numbers"),
                _ => (2, "not two numbers"),
            };
            let ok = value.as_array().is_some_and(|a| {
                a.len() == len && a.iter().all(|v| v.as_f64().is_some_and(f64::is_finite))
            });
            (!ok).then(|| what.to_string())
        }
        "text" | "ID" => (!value.is_string()).then(|| "not a string".to_string()),
        // An asset by its hash (#142).
        "asset" => {
            let hex = value
                .as_str()
                .map(|s| s.strip_prefix("sha256:").unwrap_or(s));
            let ok = hex.is_some_and(|h| {
                h.len() == 64
                    && h.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            });
            (!ok).then(|| "not a sha256".to_string())
        }
        // A list of rows, such as points, and one row, such as another tool's mesh (#433).
        "records" => (!value.is_array()).then(|| "not a list".to_string()),
        "record" => (!value.is_object()).then(|| "not an object".to_string()),
        // #233: a word or its record, such as a layout word's `"UR"` or `{corner: "UR", buff}`.
        "word" => (!value.is_string() && !value.is_object())
            .then(|| "not a word or an object".to_string()),
        _ => None,
    }
}

/// #233: what a recipe reads of another item it names: each `ID` input that names an item binds
/// `<input>_params`, that item's params, with `<field>_params` beside each of its fields that names
/// an item in turn, one level down (a Riemann sum's plot, and that plot's axes).
pub(super) fn named(
    recipe: &Recipe,
    inputs: &Map<String, Value>,
    items: &Map<String, Value>,
) -> Vec<(String, Value)> {
    let params_of = |v: &Value| items.get(v.as_str()?)?.get("params").cloned();
    let mut out = Vec::new();
    for (name, _) in recipe.inputs.iter().filter(|(_, i)| i.ty == "ID") {
        let Some(mut p) = inputs.get(name).and_then(params_of) else {
            continue;
        };
        if let Some(o) = p.as_object_mut() {
            let more: Vec<(String, Value)> = o
                .iter()
                .filter_map(|(k, v)| Some((format!("{k}_params"), params_of(v)?)))
                .collect();
            o.extend(more);
        }
        out.push((format!("{name}_params"), p));
    }
    out
}
