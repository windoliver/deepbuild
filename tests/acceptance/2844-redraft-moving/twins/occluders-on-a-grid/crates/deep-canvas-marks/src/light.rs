//! #2031: a 2D group's lights (canvas primitives: Frame and group `frame@1`, `group@1`). A group
//! with `light: {ambient, lights: [{at, color, energy, range}]}` lights its children: a light's
//! reach is `(1 − (d ÷ range)²)²` inside its range and 0 past it, and a lit child's color at a
//! pixel is decoded to linear light, multiplied by `ambient` plus the sum of energy × reach ×
//! color over the lights, clamped to 1 and encoded once. An item with `unlit`, or one a status
//! binding paints, keeps full brightness. This is the CPU reference the GPU layer's light pass
//! (`deep-groups-render`'s `lightfx`) follows in f32. #2053: on an image with a `normal` page a
//! point light's term is also multiplied by max(0, N·L) ÷ L.z, L built from `at` minus the pixel
//! and the light's `height`, so a flat page changes nothing and a page only turns the surface.

use std::collections::BTreeSet;
use std::sync::Arc;

use serde_json::{json, Map, Value};

use deep_canvas::color::{srgb_decode, srgb_encode};
use deep_canvas::document::STATUS_ROLE;
use deep_canvas::ops;

use crate::place::Place;
use crate::scene::{num, pair, Blend, Drawn, Effect, Palette, Planted, Refused, Scope};
use crate::shadow;

/// The most lights one group holds.
pub const MAX_LIGHTS: usize = 16;

/// `ambient` when a lit group leaves it out: one light never leaves the rest of the picture black.
pub const AMBIENT: f64 = 0.25;

/// A lit group's light list, evaluated at t and placed in the frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    pub ambient: f64,
    pub lights: Vec<Point>,
    /// #2032: the outlines of the group's paths that occlude, where they draw: each blocks
    /// every light of the list.
    pub occluders: shadow::Occluders,
    /// The wrong program planted in how it lights, which both renderers follow.
    pub plant: Plant,
    /// #2053: the normal page of the one image this light's run holds, if it has one.
    pub page: Option<Page>,
}

/// #2053: an image's normal page, as a lit group's light reads it on that image alone.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    /// The image item.
    pub item: String,
    /// The page's asset, its sha256 in hex.
    pub asset: String,
    /// Its texels and where they draw, once a renderer has read them from its store.
    pub normals: Option<Arc<Normals>>,
}

/// #2053: a normal page's texels as stored, placed where its image draws.
#[derive(Debug, PartialEq)]
pub struct Normals {
    /// Its size in px, the image's own.
    pub size: [u32; 2],
    /// RGBA, as stored: red and green hold x and y in the image's own frame, +y toward its top.
    pub texels: Vec<u8>,
    /// A point of the frame (u) to the page's texel space (px): `[a, b, c, d, e, f]`, x′ = a x +
    /// c y + e, y′ = b x + d y + f.
    pub back: [f64; 6],
    /// The image's turn, `[sin, cos]`, which turns its normals with it.
    pub turn: [f64; 2],
}

impl Normals {
    /// The page's normal at `p` (u) in the frame's axes, y down and z toward the viewer: its
    /// nearest texel's red and green read as `c ÷ 255 × 2 − 1`, z rebuilt and the whole made
    /// unit, turned with the image; `None` outside the page.
    pub fn at(&self, p: [f64; 2], plant: Plant) -> Option<[f64; 3]> {
        let [a, b, c, d, e, f] = self.back;
        let (tx, ty) = (a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f);
        let [w, h] = self.size.map(f64::from);
        if !(tx >= 0.0 && ty >= 0.0 && tx < w && ty < h) {
            return None;
        }
        let (x, y) = (tx.floor() as usize, ty.floor() as usize);
        let i = (y * self.size[0] as usize + x) * 4;
        let code = |k: usize| f64::from(self.texels[i + k]) / 255.0 * 2.0 - 1.0;
        let (nx, mut ny) = (code(0), code(1));
        if plant == Plant::FlippedGreen {
            ny = -ny;
        }
        let nz = ops::sqrt((1.0 - nx * nx - ny * ny).max(0.0));
        let len = ops::sqrt(nx * nx + ny * ny + nz * nz);
        // +y toward the image's top edge is -y in the frame, which runs down.
        let (x, y, z) = (nx / len, -ny / len, nz / len);
        if plant == Plant::Unturned {
            return Some([x, y, z]);
        }
        let [s, c] = self.turn;
        Some([c * x - s * y, s * x + c * y, z])
    }
}

/// #2053: the share of a light a surface of normal `n` at `p` takes beside what a flat one does:
/// max(0, N·L) ÷ L.z, L the unit vector toward the light at `at` and `height` above the frame,
/// which is max(0, n·v) ÷ v.z for v = (at − p, height); 1 with no page or for a sun, which has no
/// elevation.
pub fn turned(n: Option<[f64; 3]>, p: [f64; 2], l: &Point, plant: Plant) -> f64 {
    let Some(n) = n.filter(|_| l.sun.is_none() && l.height > 0.0) else {
        return 1.0;
    };
    let v = [l.at[0] - p[0], l.at[1] - p[1], l.height];
    let dot = (n[0] * v[0] + n[1] * v[1] + n[2] * v[2]).max(0.0);
    match plant {
        Plant::DotAlone => dot / ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]),
        _ => dot / v[2],
    }
}

/// One point light, where it draws; or a sun (#2032), which has no `at` and reaches everywhere.
#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    /// Its `at` through the group's transform, u in the frame.
    pub at: [f64; 2],
    /// Its `range` scaled with the group, u; infinite for a sun, whose reach is then 1.
    pub range: f64,
    pub energy: f64,
    /// Its role's color in linear light.
    pub color: [f64; 3],
    /// A sun's `angle` through the group's transform: the unit direction its shadows run in.
    pub sun: Option<[f64; 2]>,
    /// #2053: its `height` above the frame scaled with the group, u, `range ÷ 4` unless named;
    /// only an image's normal page reads it, and a sun's is 0.
    pub height: f64,
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
    /// #2053's: a normal page's green read the other way up.
    FlippedGreen,
    /// #2053's: a paged pixel's term multiplied by max(0, N·L) alone, not ÷ L.z.
    DotAlone,
    /// #2053's: a page's normals left unturned when its image turns.
    Unturned,
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
    /// Each light's term at `p` (u), per channel: energy × reach × color, times the `share` of
    /// the light no occluder blocks there (#2032).
    /// #2053: `n`, the page's normal at `p` if the run has one, turns each point light's term.
    fn terms<'a>(
        &'a self,
        p: [f64; 2],
        n: Option<[f64; 3]>,
        share: &'a dyn Fn(usize) -> f64,
    ) -> impl Iterator<Item = [f64; 3]> + 'a {
        let plant = self.plant;
        self.lights.iter().enumerate().map(move |(k, l)| {
            let (dx, dy) = (p[0] - l.at[0], p[1] - l.at[1]);
            let r = l.energy * reach(dx * dx + dy * dy, l.range, plant);
            let r = if r == 0.0 {
                r
            } else {
                r * share(k) * turned(n, p, l, plant)
            };
            l.color.map(|c| r * c)
        })
    }

    /// The encoded color `rgb` (0..1) of a lit child at `p` (u): decoded to linear light,
    /// multiplied by ambient plus the lights' terms, clamped to 1 and encoded once. The
    /// encoded-sum plant encodes the ambient's and each light's product apart and adds those.
    pub fn lit(&self, rgb: [f64; 3], p: [f64; 2], share: &dyn Fn(usize) -> f64) -> [f64; 3] {
        let plant = self.plant;
        let normals = self.page.as_ref().and_then(|g| g.normals.as_deref());
        let n = normals.and_then(|n| n.at(p, plant));
        let linear = rgb.map(srgb_decode);
        let encode = |v: f64| srgb_encode(v.clamp(0.0, 1.0));
        if plant == Plant::EncodedSum {
            let mut out = linear.map(|c| encode(c * self.ambient));
            for t in self.terms(p, n, share) {
                for k in 0..3 {
                    out[k] += encode(linear[k] * t[k]);
                }
            }
            return out.map(|v| v.clamp(0.0, 1.0));
        }
        let mut sum = [self.ambient; 3];
        for t in self.terms(p, n, share) {
            for k in 0..3 {
                sum[k] += t[k];
            }
        }
        std::array::from_fn(|k| encode(linear[k] * sum[k]))
    }

    /// `rgba`'s pixels, `width` px a row at `zoom` px a u, lit as a lit child is where each
    /// draws: at the point `at` gives for its centre, each light's share there the part of the
    /// pixel's samples no occluder blocks it at; premultiplied or straight alpha.
    pub fn light_pixels(
        &self,
        rgba: &mut [u8],
        width: usize,
        premultiplied: bool,
        zoom: f64,
        at: impl Fn(f64, f64) -> [f64; 2],
    ) {
        let shadows = shadow::build(&self.lights, &self.occluders.outlines, zoom);
        for (i, px) in rgba.chunks_exact_mut(4).enumerate() {
            if px[3] == 0 {
                continue;
            }
            let a = if premultiplied {
                f64::from(px[3]) / 255.0
            } else {
                1.0
            };
            let rgb = [0, 1, 2].map(|k| (f64::from(px[k]) / 255.0 / a).min(1.0));
            let (x, y) = ((i % width) as f64 + 0.5, (i / width) as f64 + 0.5);
            let p = at(x, y);
            let share = |k: usize| {
                let Some(s) = &shadows else { return 1.0 };
                let samples = shadow::SAMPLES.map(|o| at(x + o[0], y + o[1]));
                s.share(k, &self.lights[k], p, &samples)
            };
            let c = self.lit(rgb, p, &share);
            for k in 0..3 {
                px[k] = (c[k] * a * 255.0).round().clamp(0.0, 255.0) as u8;
            }
        }
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

pub(crate) fn lit_group(item: &Value) -> bool {
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
            let name = format!("{id}/light/lights/{k}");
            let path = format!("{base}/lights/{k}/color");
            out.extend(color_problem(id, &name, path, l.get("color")));
        }
    }
    out
}

/// A light's color that is a status role or a literal, named.
fn color_problem(id: &str, name: &str, path: String, color: Option<&Value>) -> Option<Problem> {
    let (code, what) = match color {
        Some(Value::String(role)) if role.starts_with(STATUS_ROLE) => (
            "status_color_unbound",
            format!(
                "the light {name} names the status color {role}; a status color is never a light's"
            ),
        ),
        Some(Value::String(role)) if !role.starts_with('#') => return None,
        _ => (
            "bad_paint",
            format!("the light {name}'s color is a literal; a light's color is a role of the look"),
        ),
    };
    let actual = json!({"light": name, "color": color});
    Some(Problem {
        code,
        id: id.to_string(),
        path,
        actual,
        what,
    })
}

/// The check's refusals of a lit group's values: an `ambient` outside 0..1 or a `range` below 0
/// as written, and a channel key that carries one there, or that gives a light's color a status
/// role or a literal, each named.
pub fn ranges(doc: &Map<String, Value>) -> Vec<Problem> {
    let items = crate::scene::object_or_empty(doc.get("items"));
    let outside = |field: &str, v: &Value| match field {
        "ambient" => !num(Some(v)).is_some_and(|a| (0.0..=1.0).contains(&a)),
        "range" => !num(Some(v)).is_some_and(|r| r >= 0.0),
        // #2053: a light's height is above 0.
        "height" => !num(Some(v)).is_some_and(|h| h > 0.0),
        _ => false,
    };
    let problem = |id: &str, path: String, v: &Value| Problem {
        code: "out_of_range",
        id: id.to_string(),
        actual: v.clone(),
        what: format!(
            "{path} reads {v}: a lit group's ambient is within 0..1, a light's range at least 0 \
             and its height above 0"
        ),
        path,
    };
    let mut out = Vec::new();
    for (id, item) in items.iter().filter(|(_, i)| lit_group(i)) {
        let base = format!("items/{id}/params/light");
        if let Some(a) = item
            .pointer("/params/light/ambient")
            .filter(|a| !a.is_null())
        {
            if outside("ambient", a) {
                out.push(problem(id, format!("{base}/ambient"), a));
            }
        }
        let lights = item
            .pointer("/params/light/lights")
            .and_then(Value::as_array);
        for (k, l) in lights.into_iter().flatten().enumerate() {
            if let Some(r) = l.get("range").filter(|r| outside("range", r)) {
                out.push(problem(id, format!("{base}/lights/{k}/range"), r));
            }
            if let Some(h) = l
                .get("height")
                .filter(|h| !h.is_null() && outside("height", h))
            {
                out.push(problem(id, format!("{base}/lights/{k}/height"), h));
            }
        }
    }
    let channels = crate::scene::object_or_empty(doc.get("channels"));
    for (cid, c) in channels {
        let target = c.get("target").and_then(Value::as_str).unwrap_or("");
        let parts: Vec<&str> = target.split('/').collect();
        let (["items", id, "params", "light", ..], Some(field)) = (parts.as_slice(), parts.last())
        else {
            continue;
        };
        if !items.get(*id).is_some_and(lit_group) {
            continue;
        }
        let keys = crate::scene::object_or_empty(c.get("keys"));
        for (k, key) in keys {
            let Some(v) = key.get("value") else { continue };
            let path = format!("channels/{cid}/keys/{k}/value");
            if *field == "color" {
                out.extend(color_problem(id, target, path, Some(v)));
            } else if outside(field, v) {
                out.push(problem(id, path, v));
            }
        }
    }
    out
}

/// The light of the group `id` at t, placed in the frame by the group's transform, with the
/// outlines of `items` that occlude under it; `None` for a group with no `light`. A field out
/// of its range is refused, naming it.
pub(crate) fn read(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
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
        // A channel may carry it past its range between checked keys: drawn clamped.
        v => match num(v) {
            Some(a) => a.clamp(0.0, 1.0),
            None => return bad("out_of_range", format!("{base}/ambient")),
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
        // #2032: a sun has an `angle` and no `at`, `range` or falloff.
        let (at, range, sun) = match l.get("kind") {
            None | Some(Value::Null) => (l.get("at"), l.get("range"), None),
            Some(Value::String(kind)) if kind == "point" => (l.get("at"), l.get("range"), None),
            Some(Value::String(kind)) if kind == "sun" => match num(l.get("angle")) {
                Some(angle) => (None, None, Some(crate::turn::sin_cos(angle))),
                None => return bad("bad_doc", path("angle")),
            },
            Some(_) => return bad("bad_doc", path("kind")),
        };
        let (at, range, sun) = match sun {
            Some((sin, cos)) => {
                let (o, d) = (place.at([0.0, 0.0]), place.at([cos, sin]));
                let v = [d[0] - o[0], d[1] - o[1]];
                let len = ops::hypot(v[0], v[1]);
                let dir = if len > 0.0 {
                    [v[0] / len, v[1] / len]
                } else {
                    [cos, sin]
                };
                ([0.0, 0.0], f64::INFINITY, Some(dir))
            }
            None => {
                let Some(at) = pair(at) else {
                    return bad("bad_doc", path("at"));
                };
                let Some(range) = num(range).map(|r| r.max(0.0)) else {
                    return bad("out_of_range", path("range"));
                };
                (place.at(at), range * grow, None)
            }
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
        // #2053: a point light's height, a quarter of its range unless named; a sun has none.
        let height = match (sun, l.get("height")) {
            (Some(_), _) => 0.0,
            (None, None | Some(Value::Null)) => range / 4.0,
            (None, h) => match num(h) {
                Some(h) => h * grow,
                None => return bad("out_of_range", path("height")),
            },
        };
        lights.push(Point {
            at,
            range,
            energy,
            color: rgb.map(|c| srgb_decode(f64::from(c) / 255.0)),
            sun,
            height,
        });
    }
    let plant = match planted {
        Planted::LightLinearFalloff => Plant::LinearFalloff,
        Planted::LightEncodedSum => Plant::EncodedSum,
        Planted::NormalFlippedGreen => Plant::FlippedGreen,
        Planted::NormalDotAlone => Plant::DotAlone,
        Planted::NormalUnturned => Plant::Unturned,
        _ => Plant::None,
    };
    // The twin `occluders-on-a-grid` (tests/acceptance/2844-redraft-moving/README.md): each occluding outline casts its
    // shadows from the nearest places of a 1/8 u grid, while the path still draws where it is.
    use crate::path::Verb;
    let grid = |p: [f64; 2]| p.map(|v| (v * 8.0).round() / 8.0);
    let outlines: Vec<Vec<Verb>> = shadow::occluders(items, id)?
        .outlines
        .iter()
        .map(|outline| {
            outline
                .iter()
                .map(|verb| match *verb {
                    Verb::Move(p) => Verb::Move(grid(p)),
                    Verb::Line(p) => Verb::Line(grid(p)),
                    Verb::Quad(a, b) => Verb::Quad(grid(a), grid(b)),
                    Verb::Cubic(a, b, c) => Verb::Cubic(grid(a), grid(b), grid(c)),
                    Verb::Close => Verb::Close,
                })
                .collect()
        })
        .collect();
    let occluders = shadow::Occluders::new(outlines);
    Ok(Some(Light {
        ambient,
        lights,
        occluders,
        plant,
        page: None,
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

/// #2053: the asset of an `image@1`'s `normal` page, if it names one.
pub fn normal_of(item: &Value) -> Option<&str> {
    if item.get("kind").and_then(Value::as_str) != Some("image@1") {
        return None;
    }
    item.pointer("/params/normal").and_then(Value::as_str)
}

/// The scope the lit item `id` draws in: its group's, or for an image with a `normal` page a run
/// of its own (#2053), whose light reads that page once a renderer has read it.
pub(crate) fn scope_for(group: &str, light: &Arc<Light>, id: &str, item: &Value) -> Scope {
    let Some(asset) = normal_of(item) else {
        return scope(group, light);
    };
    let page = Page {
        item: id.to_string(),
        asset: asset.to_ascii_lowercase(),
        normals: None,
    };
    let paged = Light {
        page: Some(page),
        ..(**light).clone()
    };
    Scope::Opacity {
        item: format!("{group}#light#{id}"),
        alpha: 1.0,
        blend: Some(Blend::Normal),
        effect: Some(Arc::new(Effect {
            light: Some(Arc::new(paged)),
            ..Effect::default()
        })),
    }
}

/// The lit group a light scope's item names: `<group>#light`, or `<group>#light#<image>` for a
/// paged image's own run (#2053).
pub fn group_of(scope_item: &str) -> Option<&str> {
    scope_item.split_once("#light").map(|(g, _)| g)
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
            let energy = l.get("energy").filter(|e| !e.is_null()).cloned();
            let energy = energy.unwrap_or(json!(1.0));
            if l.get("kind").and_then(Value::as_str) == Some("sun") {
                let (angle, color) = (l.get("angle"), l.get("color"));
                return json!({"kind": "sun", "angle": angle, "color": color, "energy": energy});
            }
            // #2053: a point light's height, a quarter of its range unless named.
            let height = l.get("height").filter(|h| !h.is_null()).cloned();
            let quarter = num(l.get("range")).map(|r| json!(r / 4.0));
            json!({
                "at": l.get("at"), "color": l.get("color"), "range": l.get("range"),
                "energy": energy, "height": height.or(quarter),
            })
        })
        .collect();
    let ambient = light.get("ambient").filter(|a| !a.is_null());
    Some(json!({"ambient": ambient.cloned().unwrap_or(json!(AMBIENT)), "lights": lights}))
}

/// #2053: one notice for each image with a `normal` page outside a lit group, which draws as it
/// would without the page, naming the image.
pub fn unlit_pages(items: &Map<String, Value>) -> Vec<Value> {
    let lit_above = |id: &str| {
        let mut at = items.get(id)?.get("parent").and_then(Value::as_str);
        for _ in 0..=items.len() {
            let group = items.get(at?)?;
            if lit_group(group) {
                return Some(());
            }
            at = group.get("parent").and_then(Value::as_str);
        }
        None
    };
    let paged = items.iter().filter(|(_, i)| normal_of(i).is_some());
    paged
        .filter(|(id, _)| lit_above(id).is_none())
        .map(|(id, _)| {
            json!({
                "code": "normal_unlit", "severity": "notice", "ids": [id],
                "path": format!("items/{id}/params/normal"), "actual": {"image": id},
                "what": format!("the image {id} has a normal page outside a lit group, so it draws as it would without one"),
            })
        })
        .collect()
}

/// The light of the lit group above `id`, if one is (a planted pass that lights status marks
/// reads it).
pub fn around(items: &Map<String, Value>, id: &str, palette: &Palette) -> Option<Light> {
    let mut at = items.get(id)?.get("parent").and_then(Value::as_str);
    for _ in 0..=items.len() {
        let group = items.get(at?)?;
        if lit_group(group) {
            return read(at?, group, items, palette, Planted::None)
                .ok()
                .flatten();
        }
        at = group.get("parent").and_then(Value::as_str);
    }
    None
}

/// #2031: a layer's marks in draw order with each unlit mark that sits between a lit group's lit
/// marks moved past the lit marks after it that it doesn't come near, so the group lights in
/// fewer runs; the picture is the same. A mark moves only when its scopes are its lit
/// neighbours' outside their light, so it has none of its own.
pub(crate) fn gather<T>(marks: &mut Vec<T>, drawn: impl Fn(&T) -> &Drawn) {
    let lit_at = |d: &Drawn| d.scopes.iter().position(|s| light_of(s).is_some());
    if !marks.iter().any(|m| lit_at(drawn(m)).is_some()) {
        return;
    }
    let near = |a: [f64; 4], b: [f64; 4]| {
        // A px of antialiasing around each.
        a[0] - 1.0 < b[0] + b[2]
            && b[0] - 1.0 < a[0] + a[2]
            && a[1] - 1.0 < b[1] + b[3]
            && b[1] - 1.0 < a[1] + a[3]
    };
    let mut out = Vec::with_capacity(marks.len());
    let mut held: Vec<T> = Vec::new();
    // The outer scopes of the last lit mark placed, while unlit marks may still move past.
    let mut context: Option<Vec<Scope>> = None;
    for m in marks.drain(..) {
        let d = drawn(&m);
        match lit_at(d) {
            Some(k) if context.as_deref() == Some(&d.scopes[..k]) => {
                let e = d.extent();
                if held.iter().any(|h| near(drawn(h).extent(), e)) {
                    out.append(&mut held);
                }
                out.push(m);
            }
            Some(k) => {
                out.append(&mut held);
                context = Some(d.scopes[..k].to_vec());
                out.push(m);
            }
            None if context.as_deref() == Some(&d.scopes[..]) => {
                held.push(m);
            }
            None => {
                out.append(&mut held);
                context = None;
                out.push(m);
            }
        }
    }
    out.append(&mut held);
    *marks = out;
}

fn light_of(s: &Scope) -> Option<&Arc<Light>> {
    match s {
        Scope::Opacity {
            effect: Some(e), ..
        } => e.light.as_ref(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sun_is_reported_by_its_kind_and_angle() {
        let lights = json!([{"kind": "sun", "angle": 30, "color": "ground"}]);
        let group = json!({"kind": "group@1", "params": {"light": {"lights": lights}}});
        let sun = json!({"kind": "sun", "angle": 30, "color": "ground", "energy": 1.0});
        assert_eq!(
            evaluated(&group),
            Some(json!({"ambient": AMBIENT, "lights": [sun]}))
        );
    }

    #[test]
    fn a_sun_turns_with_its_group() {
        let lights = json!([{"kind": "sun", "angle": 0, "color": "ground"}]);
        let group = json!({"kind": "group@1", "at": {"rot": [0, 0, 90]},
            "params": {"light": {"lights": lights}}});
        let palette = Palette::from([("ground".to_string(), [255, 255, 255])]);
        let light = read("g", &group, &Map::new(), &palette, Planted::None);
        let sun = &light.unwrap().unwrap().lights[0];
        assert_eq!((sun.sun, sun.range), (Some([0.0, 1.0]), f64::INFINITY));
    }
}
