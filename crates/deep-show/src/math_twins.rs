//! Issue #233's planted wrong programs: twins of the first-party math@1 pack, each applied to the
//! pack's manifest as the store reads it (as #433's twins of familiar@1 are), and one that expands
//! the pack again each frame; each reachable only through the scenario's `planted`.

use serde_json::{json, Value};

/// The pack the twins rewrite.
const MATH: &str = "deepbuild/math";

/// The scenario `planted` values that name a twin of math@1.
pub const PLANTED: &[&str] = &[
    "math_axes_ticks_as_marks",
    "math_keeps_y_up",
    "math_number_line_drops_excluded",
    EXPANDS_EACH_FRAME,
];

/// The twin that expands the pack's instances again each frame, read by `eval`.
pub const EXPANDS_EACH_FRAME: &str = "math_expands_each_frame";

/// `manifest` (pack `id`, its recipes inlined) rewritten as the twin `planted` names, when it is
/// math@1's.
pub fn twin(planted: &str, id: &str, manifest: &mut Value) {
    if id != MATH {
        return;
    }
    let Some(recipes) = manifest.get_mut("recipes").and_then(Value::as_object_mut) else {
        return;
    };
    for recipe in recipes.values_mut() {
        let name = recipe["id"].as_str().unwrap_or_default().to_string();
        match planted {
            // Keeps y up: math y + becomes u y +, so UP lands at the bottom.
            "math_keeps_y_up" => recipe["let"]["ys"] = json!(1),
            // Drops numbers_to_exclude: every tick shows its number.
            "math_number_line_drops_excluded" if name == "math.number_line" => {
                recipe["steps"]["number"]["when"] = json!("include_numbers");
            }
            // Ticks from a rule mark set of computed columns, the axis drawing none of its own.
            "math_axes_ticks_as_marks" if name == "math.axes" => {
                for a in ["x", "y"] {
                    recipe["steps"][format!("{a}axis")]["params"]["tick"]["size"] = json!(0);
                    let enc = if a == "x" { "x" } else { "y" };
                    recipe["steps"][format!("{a}tickset")] = json!({
                        "op": "mark", "kind": "marks@1", "parent": "id(instance, all)",
                        "params": {
                            "mark": "rule", "n": format!("{a}ticks"),
                            "columns": {"v": {"expr": "\\a + i * d", "vars": {"a": format!("{a}0"), "d": format!("{a}d")}}},
                            "encode": {enc: {"column": "v", "scale": format!("id(instance, {a}scale)")}},
                            "paint": {"stroke": {"role": "role", "width": format!("{a}width")}},
                        }
                    });
                }
            }
            _ => {}
        }
    }
}

/// The planted per-frame expansion: `doc` checked with its packs again, as if the frame were the
/// check, and a node that ran for each instance it expanded, naming the instance and its recipe.
pub fn expand_again(
    doc: &Value,
    sealed: &deep_canvas::registry::Sealed,
    packs: &deep_canvas::document::Packs,
) -> Vec<Value> {
    let checked = deep_canvas::document::check_packed(doc, sealed, packs);
    (checked.expansions.iter())
        .filter(|e| e.kind.starts_with("math."))
        .map(|e| {
            json!({"operator": "pack.expand", "module": "packs", "phase": "items",
                   "item": e.instance, "kind": e.kind, "run": "ran"})
        })
        .collect()
}
