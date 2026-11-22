//! Issue #433's planted wrong programs: twins of the first-party familiar@1 pack, each one of its
//! stated conversions rewritten as the criterion's wrong program writes it, applied to the pack's
//! manifest as the store reads it, and reachable only through the scenario's `planted`. #2054's
//! twins rewrite the light recipes of a familiar-names pack that take a range and a falloff word.

use serde_json::Value;

/// The pack the twins rewrite.
const FAMILIAR: &str = "deepbuild/familiar";

/// The scenario `planted` values that name a twin of familiar@1.
pub const PLANTED: &[&str] = &[
    "familiar_copies_angles",
    "familiar_copies_position",
    "familiar_widens_portrait",
    "familiar_looks_plus_z",
    "familiar_copies_spot_power",
    RANGE_DROPPED,
    FALLOFF_DRAWN,
];

/// #2054: the range word accepted and passed on to nothing, so the light takes the automatic range.
const RANGE_DROPPED: &str = "range_word_dropped";
/// #2054: any falloff exponent accepted and drawn as the inverse square.
const FALLOFF_DRAWN: &str = "falloff_one_drawn";

/// `manifest` (pack `id`, its recipes inlined) rewritten as the twin `planted` names, when it is
/// familiar@1's: each recipe's lets of those names given the wrong program's expressions.
pub fn twin(planted: &str, id: &str, manifest: &mut Value) {
    if planted == RANGE_DROPPED || planted == FALLOFF_DRAWN {
        return light_twin(planted, manifest);
    }
    if id != FAMILIAR {
        return;
    }
    let lets: &[(&str, &str)] = match planted {
        // Copies the angles as written into ours, in our order.
        "familiar_copies_angles" => &[
            ("rx", "rotation[0]"),
            ("ry", "rotation[1]"),
            ("rz", "rotation[2]"),
        ],
        // Copies the position, leaving out the pivot, so the pivot lands at the position.
        "familiar_copies_position" => &[
            ("px", "position[0]"),
            ("py", "position[1]"),
            ("pz", "position[2]"),
        ],
        // Widens every camera's vertical fov by its aspect, portrait or not.
        "familiar_widens_portrait" => &[("wide", "2 * deg(atan(tan(rad(fov) / 2) * aspect))")],
        // Aims a camera along its local +Z.
        "familiar_looks_plus_z" => &[("f0", "m02"), ("f1", "m12"), ("f2", "m22")],
        // Copies a spot's power as the library counts it.
        "familiar_copies_spot_power" => &[("lm", "power >= 0 ? power : 4 * pi * intensity")],
        _ => return,
    };
    let Some(recipes) = manifest.get_mut("recipes").and_then(Value::as_object_mut) else {
        return;
    };
    for recipe in recipes.values_mut() {
        if planted == "familiar_copies_spot_power"
            && recipe.get("id").and_then(Value::as_str) != Some("familiar.spot_light")
        {
            continue;
        }
        let Some(map) = recipe.get_mut("let").and_then(Value::as_object_mut) else {
            continue;
        };
        for (name, expr) in lets {
            if let Some(v) = map.get_mut(*name) {
                *v = Value::String((*expr).to_string());
            }
        }
    }
}

/// #2054's twins, over each recipe of `manifest` with a step that makes a light: under
/// [`RANGE_DROPPED`] its steps write no `range`; under [`FALLOFF_DRAWN`] each `<word>_attenuation`
/// input takes any value, which no step reads.
fn light_twin(planted: &str, manifest: &mut Value) {
    let Some(recipes) = manifest.get_mut("recipes").and_then(Value::as_object_mut) else {
        return;
    };
    for recipe in recipes.values_mut() {
        let lights = |r: &Value| -> bool {
            r.get("steps")
                .and_then(Value::as_object)
                .is_some_and(|steps| {
                    steps
                        .values()
                        .any(|s| s["kind"].as_str().is_some_and(|k| k.starts_with("light.")))
                })
        };
        if !lights(recipe) {
            continue;
        }
        if planted == RANGE_DROPPED {
            for step in recipe["steps"]
                .as_object_mut()
                .into_iter()
                .flat_map(|s| s.values_mut())
            {
                if let Some(params) = step.get_mut("params").and_then(Value::as_object_mut) {
                    params.remove("range");
                }
            }
        } else if let Some(inputs) = recipe.get_mut("inputs").and_then(Value::as_object_mut) {
            for (_, input) in inputs
                .iter_mut()
                .filter(|(k, _)| k.ends_with("_attenuation"))
            {
                if let Some(input) = input.as_object_mut() {
                    input.remove("min");
                    input.remove("max");
                }
            }
        }
    }
}
