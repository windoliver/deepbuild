use super::*;

/// The text kind's params the shaper reads: a change to one is a change of text.
const TEXT_PARAMS: [&str; 8] = [
    "text",
    "font",
    "size",
    "weight",
    "box",
    "numerals",
    "align",
    "animators",
];

/// The classes a revision's change to one item falls in, by the paths that differ: `at` is
/// transform, `visible` presence, `adjust` and a paint shading, a text's shaped params text,
/// any other field geometry.
pub fn classes_changed(old: &Value, new: &Value) -> Vec<Class> {
    let kind = new.get("kind").and_then(Value::as_str).unwrap_or("");
    let mut out = Vec::new();
    let mut keys: Vec<&String> = old
        .as_object()
        .into_iter()
        .chain(new.as_object())
        .flat_map(|m| m.keys())
        .collect();
    keys.sort();
    keys.dedup();
    for k in keys {
        let (a, b) = (old.get(k), new.get(k));
        if a == b {
            continue;
        }
        let class = match k.as_str() {
            "at" => Class::Transform,
            "visible" => Class::Presence,
            "adjust" => Class::Shading,
            "params" => {
                let mut names: Vec<&String> = a
                    .and_then(Value::as_object)
                    .into_iter()
                    .chain(b.and_then(Value::as_object))
                    .flat_map(|m| m.keys())
                    .collect();
                names.sort();
                names.dedup();
                for name in names {
                    if a.and_then(|p| p.get(name)) == b.and_then(|p| p.get(name)) {
                        continue;
                    }
                    out.push(match name.as_str() {
                        "paint" => Class::Shading,
                        n if kind == "text@1" && TEXT_PARAMS.contains(&n) => Class::Text,
                        _ => Class::Geometry,
                    });
                }
                continue;
            }
            _ => Class::Geometry,
        };
        out.push(class);
    }
    out.sort();
    out.dedup();
    out
}
