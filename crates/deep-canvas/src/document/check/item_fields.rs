//! An item's `at` (its relations, `place` and `align`) and `adjust` fields, checked.

use super::*;

pub(super) fn check_at(key: &str, at_value: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = at_value.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/at"),
            at_value.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/at/{name}");
        if name == "pivot" && value.is_string() {
            if !value.as_str().is_some_and(|p| BOX_POINTS.contains(&p)) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not a box point (n ne e se s sw w nw c)",
                ));
            }
        } else if name == "place" {
            check_place(key, value, issues);
        } else if name == "align" {
            check_align(key, value, issues);
        } else if AT_VECTORS.contains(&name.as_str()) {
            if !is_vector(value, 3) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not three numbers finite at f32",
                ));
            }
        } else if name == "shear" {
            if !fits_f32(value) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not a number finite at f32",
                ));
            }
        } else if name == "anchor" {
            // `ID#anchor`: a mark set's `#head`, drawn at the revealed end (Item and kind).
            if !value.as_str().is_some_and(|a| a.contains('#')) {
                issues.push(Issue::error(
                    "out_of_range",
                    key,
                    path,
                    value.clone(),
                    "not `ID#anchor`",
                ));
            }
        } else {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a member of at in this slice",
            ));
        }
    }
}

/// A relation's target: an item ID with an optional `#part`, or a point `[u, u]`; `frame` too
/// where `frame` is allowed.
fn relation_target(value: &Value, frame: bool) -> bool {
    match value {
        Value::String(s) => (frame && s == "frame") || !s.is_empty(),
        v => is_vector(v, 2),
    }
}

/// `at.place` (Item and kind: relations): exactly one of `beside`, `edge` and `onto`, with the
/// members its form takes, sides and points from the box points.
fn check_place(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    let base = format!("items/{key}/at/place");
    let mut fault = |path: String, v: &Value, why: &str, code: &'static str| {
        issues.push(Issue::error(code, key, path, v.clone(), why));
    };
    let Some(place) = value.as_object() else {
        return fault(base, value, "not an object", "out_of_range");
    };
    let forms: Vec<&str> = ["beside", "edge", "onto"]
        .into_iter()
        .filter(|f| place.contains_key(*f))
        .collect();
    let members: &[&str] = match forms.as_slice() {
        ["beside"] => &["beside", "side", "gap", "align", "own"],
        ["edge"] => &["edge", "margin"],
        ["onto"] => &["onto", "point"],
        _ => {
            return fault(
                base,
                value,
                "not exactly one of beside, edge and onto",
                "out_of_range",
            )
        }
    };
    let side = |v: &Value| {
        v.as_str()
            .is_some_and(|s| s != "c" && BOX_POINTS.contains(&s))
    };
    for (name, v) in place {
        let path = format!("{base}/{name}");
        let ok = match name.as_str() {
            n if !members.contains(&n) => {
                fault(path, v, "not a member of this placement", "unknown_field");
                continue;
            }
            "beside" | "onto" => relation_target(v, false),
            "edge" | "side" => side(v),
            "point" => v.as_str().is_some_and(|s| BOX_POINTS.contains(&s)),
            "gap" | "margin" => fits_f32(v),
            "align" => v
                .as_str()
                .is_some_and(|s| ["start", "center", "end", "baseline"].contains(&s)),
            _ => v.as_str().is_some_and(|s| !s.is_empty()),
        };
        if !ok {
            fault(path, v, "not a value this member takes", "out_of_range");
        }
    }
}

/// `at.align`: at most two `{to, side}`, each moving the item along one axis.
fn check_align(key: &str, value: &Value, issues: &mut Vec<Issue>) {
    let base = format!("items/{key}/at/align");
    let list = match value.as_array() {
        Some(list) if list.len() <= 2 => list,
        _ => {
            issues.push(Issue::error(
                "out_of_range",
                key,
                base,
                value.clone(),
                "not a list of at most two",
            ));
            return;
        }
    };
    for (i, a) in list.iter().enumerate() {
        let to = a.get("to").is_some_and(|t| relation_target(t, true));
        let side = a
            .get("side")
            .and_then(Value::as_str)
            .is_some_and(|s| ["n", "s", "e", "w", "cx", "cy"].contains(&s));
        let only = a
            .as_object()
            .is_some_and(|o| o.keys().all(|k| k == "to" || k == "side"));
        if !(to && side && only) {
            issues.push(Issue::error(
                "out_of_range",
                key,
                format!("{base}/{i}"),
                a.clone(),
                "not {to, side}",
            ));
        }
    }
}

/// An item's `adjust`: its known channels, each a number in range (`tint` a look role, `invert` a
/// bool); opacity in 0..1, gamma above 0 and the rest that scale never below 0.
pub(super) fn check_adjust(key: &str, adjust: &Value, issues: &mut Vec<Issue>) {
    let Some(members) = adjust.as_object() else {
        issues.push(Issue::error(
            "out_of_range",
            key,
            format!("items/{key}/adjust"),
            adjust.clone(),
            "not an object",
        ));
        return;
    };
    for (name, value) in members {
        let path = format!("items/{key}/adjust/{name}");
        if !ADJUST_FIELDS.contains(&name.as_str()) {
            issues.push(Issue::error(
                "unknown_field",
                key,
                path,
                value.clone(),
                "not a channel of adjust",
            ));
            continue;
        }
        let (fits, what) = match name.as_str() {
            "invert" => (value.is_boolean(), "not a boolean"),
            "tint" => (value.is_string(), "not a look role"),
            "opacity" => (
                value.as_f64().is_some_and(|v| (0.0..=1.0).contains(&v)),
                "not a number in 0..1",
            ),
            "gamma" => (
                fits_f32(value) && value.as_f64().is_some_and(|v| v > 0.0),
                "not a number above 0",
            ),
            "hue" | "exposure" => (fits_f32(value), "not a number finite at f32"),
            _ => (
                fits_f32(value) && value.as_f64().is_some_and(|v| v >= 0.0),
                "not a number at or above 0",
            ),
        };
        if !fits {
            issues.push(Issue::error("out_of_range", key, path, value.clone(), what));
        }
    }
}
