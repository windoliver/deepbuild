//! #2031: a 2D group's lights (canvas primitives: Frame and group `frame@1`, `group@1`). A group
//! with `light: {ambient, lights: [{at, color, energy, range}]}` lights its children: a light's
//! reach is `(1 − (d ÷ range)²)²` inside its range and 0 past it, and a lit child's color at a
//! pixel is decoded to linear light, multiplied by `ambient` plus the sum of energy × reach ×
//! color over the lights, clamped to 1 and encoded once. An item with `unlit`, or one a status
//! binding paints, keeps full brightness. This is the CPU reference the GPU layer's light pass
//! (`deep-gpu-layer`'s `lightfx`) follows in f32.

use std::collections::BTreeSet;
use std::sync::Arc;

use serde_json::{json, Map, Value};

use deep_canvas::color::{srgb_decode, srgb_encode};
use deep_canvas::document::STATUS_ROLE;
use deep_canvas::ops;

use crate::place::Place;
use crate::scene::{num, pair, Blend, Effect, Palette, Planted, Refused, Scope};

/// The most lights one group holds.
pub const MAX_LIGHTS: usize = 16;

/// `ambient` when a lit group leaves it out: one light never leaves the rest of the picture black.
pub const AMBIENT: f64 = 0.25;

/// A lit group's light list, evaluated at t and placed in the frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    pub ambient: f64,
    pub lights: Vec<Point>,
    /// The wrong program planted in how it lights, which both renderers follow.
    pub plant: Plant,
}

/// One point light, where it draws.
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    /// Its `at` through the group's transform, u in the frame.
    pub at: [f64; 2],
    /// Its `range` scaled with the group, u.
    pub range: f64,
    pub energy: f64,
    /// Its role's color in linear light.
    pub color: [f64; 3],
}

/// A wrong program a light's tests plant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// The reach falls off linearly, `1 − d ÷ range`.
    LinearFalloff,
    /// The lights' terms add to the encoded color rather than in linear light.
    EncodedSum,
}

/// The closed-form reach at squared distance `d2` from a light of `range`.
pub fn reach(d2: f64, range: f64, plant: Plant) -> f64 {
    if range <= 0.0 {
        return 0.0;
    }
    let q = d2 / (range * range);
    if q >= 1.0 {
        return 0.0;
    }
    match plant {
        Plant::LinearFalloff => 1.0 - ops::sqrt(q),
        _ => (1.0 - q) * (1.0 - q),
    }
}

impl Light {
    /// Each light's term at `p` (u), per channel: energy × reach × color.
    fn terms(&self, p: [f64; 2], plant: Plant) -> impl Iterator<Item = [f64; 3]> + '_ {
        self.lights.iter().map(move |l| {
            let (dx, dy) = (p[0] - l.at[0], p[1] - l.at[1]);
            let r = l.energy * reach(dx * dx + dy * dy, l.range, plant);
            l.color.map(|c| r * c)
        })
    }

    /// The encoded color `rgb` (0..1) of a lit child at `p` (u): decoded to linear light,
    /// multiplied by ambient plus the lights' terms, clamped to 1 and encoded once. The
    /// encoded-sum plant encodes the ambient's and each light's product apart and adds those.
    pub fn lit(&self, rgb: [f64; 3], p: [f64; 2]) -> [f64; 3] {
        let plant = self.plant;
        let linear = rgb.map(srgb_decode);
        let encode = |v: f64| srgb_encode(v.clamp(0.0, 1.0));
        if plant == Plant::EncodedSum {
            let mut out = linear.map(|c| encode(c * self.ambient));
            for t in self.terms(p, plant) {
                for k in 0..3 {
                    out[k] += encode(linear[k] * t[k]);
                }
            }
            return out.map(|v| v.clamp(0.0, 1.0));
        }
        let mut sum = [self.ambient; 3];
        for t in self.terms(p, plant) {
            for k in 0..3 {
                sum[k] += t[k];
            }
        }
        std::array::from_fn(|k| encode(linear[k] * sum[k]))
    }
}

/// A refusal of a lit group the check reports: its code, the item it names, the path, what it
/// holds and why.
pub struct Problem {
    pub code: &'static str,
    pub id: String,
    pub path: String,
    pub actual: Value,
    pub what: String,
}

fn lit_group(item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("group@1")
        && item
            .get("params")
            .and_then(|p| p.get("light"))
            .is_some_and(|l| !l.is_null())
}

/// Each lit group's refusals: past [`MAX_LIGHTS`] lights, naming the group, the count and the
/// cap; a lit group inside a lit group, naming the inner one; a light whose color is a status role
/// or a literal color, naming the light.
pub fn problems(items: &Map<String, Value>) -> Vec<Problem> {
    let mut out = Vec::new();
    for (id, item) in items {
        if !lit_group(item) {
            continue;
        }
        let base = format!("items/{id}/params/light");
        let mut at = item.get("parent").and_then(Value::as_str);
        for _ in 0..=items.len() {
            let Some(p) = at.filter(|p| *p != id) else {
                break;
            };
            if items.get(p).is_some_and(lit_group) {
                out.push(Problem {
                    code: "light_nested",
                    id: id.clone(),
                    path: base.clone(),
                    actual: json!({"group": id, "inside": p}),
                    what: format!("the lit group {id} sits inside the lit group {p}; only one group on a path from the root may light its children"),
                });
                break;
            }
            at = items
                .get(p)
                .and_then(|i| i.get("parent"))
                .and_then(Value::as_str);
        }
        let lights = item
            .pointer("/params/light/lights")
            .and_then(Value::as_array);
        let count = lights.map_or(0, Vec::len);
        if count > MAX_LIGHTS {
            out.push(Problem {
                code: "out_of_range",
                id: id.clone(),
                path: format!("{base}/lights"),
                actual: json!({"lights": count, "cap": MAX_LIGHTS}),
                what: format!("the group {id} holds lights: {count}, cap: {MAX_LIGHTS}"),
            });
        }
        for (k, l) in lights.into_iter().flatten().enumerate() {
            let path = format!("{base}/lights/{k}/color");
            let name = format!("{id}/light/lights/{k}");
            match l.get("color") {
                Some(Value::String(role)) if role.starts_with(STATUS_ROLE) => {
                    out.push(Problem {
                        code: "status_color_unbound",
                        id: id.clone(),
                        path,
                        actual: json!({"light": name, "color": role}),
                        what: format!("the light {name} names the status color {role}; a status color is never a light's"),
                    });
                }
                Some(Value::String(role)) if !role.starts_with('#') => {}
                other => out.push(Problem {
                    code: "bad_paint",
                    id: id.clone(),
                    path,
                    actual: json!({"light": name, "color": other}),
                    what: format!("the light {name}'s color is a literal; a light's color is a role of the look"),
                }),
            }
        }
    }
    out
}

/// The light of the group `id` at t, placed in the frame by the group's transform; `None` for a
/// group with no `light`. A field out of its range is refused, naming it.
pub(crate) fn read(
    id: &str,
    item: &Value,
    palette: &Palette,
    planted: Planted,
) -> Result<Option<Light>, Refused> {
    let Some(light) = item
        .get("params")
        .and_then(|p| p.get("light"))
        .filter(|l| !l.is_null())
    else {
        return Ok(None);
    };
    let base = format!("items/{id}/params/light");
    let bad = |code: &'static str, path: String| Err(Refused { code, path });
    let Some(light) = light.as_object() else {
        return bad("bad_doc", base);
    };
    let ambient = match light.get("ambient") {
        None | Some(Value::Null) if planted == Planted::LightDefaultAmbientZero => 0.0,
        None | Some(Value::Null) => AMBIENT,
        v => match num(v) {
            Some(a) if (0.0..=1.0).contains(&a) => a,
            _ => return bad("out_of_range", format!("{base}/ambient")),
        },
    };
    let place = Place::of(item);
    let grow = ops::sqrt((place.scale[0] * place.scale[1]).abs());
    let list: &[Value] = match light.get("lights") {
        None | Some(Value::Null) => &[],
        Some(Value::Array(l)) => l,
        Some(_) => return bad("bad_doc", format!("{base}/lights")),
    };
    let mut lights = Vec::with_capacity(list.len());
    for (k, l) in list.iter().enumerate() {
        let path = |f: &str| format!("{base}/lights/{k}/{f}");
        let Some(at) = pair(l.get("at")) else {
            return bad("bad_doc", path("at"));
        };
        let range = match num(l.get("range")) {
            Some(r) if r >= 0.0 => r,
            _ => return bad("out_of_range", path("range")),
        };
        let energy = match l.get("energy") {
            None | Some(Value::Null) => 1.0,
            v => num(v).ok_or(Refused {
                code: "out_of_range",
                path: path("energy"),
            })?,
        };
        let Some(Value::String(role)) = l.get("color") else {
            return bad("bad_paint", path("color"));
        };
        let Some(rgb) = palette.get(role) else {
            return bad("role_unresolved", format!("{}: {role}", path("color")));
        };
        lights.push(Point {
            at: place.at(at),
            range: range * grow,
            energy,
            color: rgb.map(|c| srgb_decode(f64::from(c) / 255.0)),
        });
    }
    let plant = match planted {
        Planted::LightLinearFalloff => Plant::LinearFalloff,
        Planted::LightEncodedSum => Plant::EncodedSum,
        _ => Plant::None,
    };
    Ok(Some(Light {
        ambient,
        lights,
        plant,
    }))
}

/// The items a status binding paints: never lit, whatever their fields say.
pub(crate) fn status_bound(doc: &Map<String, Value>) -> BTreeSet<String> {
    doc.get("status_bindings")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(_, b)| b.get("target").and_then(Value::as_str))
        .filter_map(|t| t.strip_prefix("items/")?.split('/').next())
        .map(str::to_string)
        .collect()
}

/// Whether `id` takes the light of the lit group `group` above it: neither it nor an item between
/// them is `unlit` or painted by a status binding.
pub(crate) fn is_lit(
    items: &Map<String, Value>,
    id: &str,
    group: &str,
    status_bound: &BTreeSet<String>,
    planted: Planted,
) -> bool {
    if planted == Planted::LightEveryChild {
        return true;
    }
    let mut at = Some(id);
    for _ in 0..=items.len() {
        let Some(a) = at.filter(|a| *a != group) else {
            return true;
        };
        let item = items.get(a);
        let unlit = item
            .and_then(|i| i.pointer("/params/unlit"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if unlit || status_bound.contains(a) {
            return false;
        }
        at = item.and_then(|i| i.get("parent")).and_then(Value::as_str);
    }
    true
}

/// The scope a lit group's lit children draw in: one isolated run per stretch of them in draw
/// order, lit before it composites over what the group drew before it.
pub(crate) fn scope(group: &str, light: &Arc<Light>) -> Scope {
    Scope::Opacity {
        item: format!("{group}#light"),
        alpha: 1.0,
        blend: Some(Blend::Normal),
        effect: Some(Arc::new(Effect {
            light: Some(Arc::clone(light)),
            ..Effect::default()
        })),
    }
}

/// A lit group's light list as evaluated at t, in its own units, each default filled in: what the
/// `path` surface reports of the group. `None` for a group with no `light`.
pub fn evaluated(item: &Value) -> Option<Value> {
    let light = item.pointer("/params/light").filter(|l| !l.is_null())?;
    let lights: Vec<Value> = light
        .get("lights")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|l| {
            json!({
                "at": l.get("at"), "color": l.get("color"), "range": l.get("range"),
                "energy": l.get("energy").filter(|e| !e.is_null()).cloned().unwrap_or(json!(1.0)),
            })
        })
        .collect();
    let ambient = light.get("ambient").filter(|a| !a.is_null());
    Some(json!({"ambient": ambient.cloned().unwrap_or(json!(AMBIENT)), "lights": lights}))
}

/// The light of the lit group above `id`, if one is (a planted pass that lights status marks
/// reads it).
pub fn around(items: &Map<String, Value>, id: &str, palette: &Palette) -> Option<Light> {
    let mut at = items.get(id)?.get("parent").and_then(Value::as_str);
    for _ in 0..=items.len() {
        let group = items.get(at?)?;
        if lit_group(group) {
            return read(at?, group, palette, Planted::None).ok().flatten();
        }
        at = group.get("parent").and_then(Value::as_str);
    }
    None
}
