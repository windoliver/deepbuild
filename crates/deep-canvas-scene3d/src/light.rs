//! Materials and lights as the renderer shades them (issue #421; canvas primitives: Material,
//! Light and the light policy): a `material@1` an object names, read at t; `light.sun`,
//! `light.point` and `light.spot`, in photometric units; and the light policy, which ranks the
//! lights by their contribution to the view as a pure function of it.

use std::f64::consts::PI;

use serde_json::Value;

use crate::look::Look3;
use deep_canvas::camera::Vec3;

use crate::scene::{num, Camera, Depth, Refused};

/// A `material@1`'s numbers at t, its colors linear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Material {
    /// Its base color, its alpha times `alpha`.
    pub base: [f64; 4],
    pub metallic: f64,
    pub roughness: f64,
    pub specular_level: f64,
    pub specular_color: Vec3,
    /// `emission` times `emission_strength`.
    pub emission: Vec3,
    pub coat: f64,
    pub coat_roughness: f64,
    pub alpha_mode: AlphaMode,
    /// Its index in [`PATTERNS`] (0 for none), its scale in m and its seed's hash.
    pub pattern: u32,
    pub pattern_scale: f64,
    pub pattern_seed: u32,
    /// Its ink: the role's color and the weight in px.
    pub ink: Option<([u8; 3], f64)>,
    /// What it writes into shadow maps: false for `shadow: none`, and under `auto` for a
    /// see-through part.
    pub casts: bool,
    /// Its shadow catcher (Material: shadow catcher): the strength, when it catches.
    pub catch: Option<f64>,
    pub unlit: bool,
    pub double_sided: bool,
}

/// How a material's alpha draws (Material: `alpha_mode`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlphaMode {
    Opaque,
    /// Drawn where alpha reaches the cutoff, as an opaque part.
    Mask,
    /// See-through, back to front by view depth plus its object's `sort_bias`, then ID.
    Blend,
    /// Its shaded color times alpha added to what's behind it, depth-tested with no depth write.
    Add,
}

impl AlphaMode {
    /// Whether it draws after the opaque parts, in see-through order.
    pub fn see_through(self) -> bool {
        matches!(self, AlphaMode::Blend | AlphaMode::Add)
    }
}

/// The procedural patterns a material may carry, in the order the shader numbers them from 1.
pub const PATTERNS: [&str; 10] = [
    "plaster",
    "stone_courses",
    "roof_tiles",
    "wood",
    "rock",
    "grass",
    "cobbles",
    "glass_curtain",
    "concrete",
    "asphalt",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LightKind {
    Sun,
    Point,
    Spot,
    /// A one-sided Lambertian rect or disk, shining along its own −Z.
    Area,
}

/// An area light's shape: its axes across its face, in world metres, and whether it's a disk.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    /// Its local +X and +Y in the world, each its half size long.
    pub right: Vec3,
    pub up: Vec3,
    pub disk: bool,
}

/// A light at t, in world metres.
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    pub id: String,
    pub kind: LightKind,
    pub pos: Vec3,
    /// Unit, along which it shines: a sun's and a spot's own −Z.
    pub dir: Vec3,
    /// Linear, from `color` or `temperature`, at unit luminance when from a temperature.
    pub color: Vec3,
    /// A sun's illuminance in lx; a point's or a spot's intensity in cd: its lumens over the whole
    /// sphere, lm ÷ 4π, a spot's as a point light's; an area's lumens ÷ 4π too, which the shader
    /// turns into its face's radiance. Times its flicker channel's value at t.
    pub intensity: f64,
    pub range: f64,
    pub radius: f64,
    /// A spot's cone: cos of its outer and inner half angles.
    pub cone: [f64; 2],
    pub area: Option<Area>,
    /// Whether it asks for a shadow (a sun's or a spot's; the policy's budget decides).
    pub shadow: bool,
    pub priority: f64,
}

/// The light policy's budget per view (Light and the light policy).
pub const SHADED: usize = 32;
const MARGIN: f64 = 0.1;
/// The illuminance an auto range ends at.
const THRESHOLD: f64 = 0.05;

fn color3(v: Option<&Value>) -> Option<Vec3> {
    let a = v?.as_array()?;
    match a.as_slice() {
        [r, g, b] | [r, g, b, _] => Some([num(Some(r))?, num(Some(g))?, num(Some(b))?]),
        _ => None,
    }
}

fn srgb_decode(c: u8) -> f64 {
    let c = f64::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

/// The `material@1` item `item` names in its `material` field, read from `params` at t: `None`
/// when it names none.
pub fn material<'a>(
    item: &Value,
    named: impl Fn(&str) -> Option<&'a Value>,
    look: &Look3,
    id: &str,
) -> Result<Option<Material>, Refused> {
    let Some(name) = item.get("material") else {
        return Ok(None);
    };
    let path = format!("items/{id}/material");
    let Some(m) = name
        .as_str()
        .and_then(&named)
        .filter(|m| m.get("kind").and_then(Value::as_str) == Some("material@1"))
    else {
        return Err(Refused {
            code: "ref_unresolved",
            path,
        });
    };
    let mat = name.as_str().unwrap_or("");
    let field = |k: &str| format!("items/{mat}/params/{k}");
    let bad = |code: &'static str, k: &str| Refused {
        code,
        path: field(k),
    };
    let empty = serde_json::Map::new();
    let own = m.get("params").and_then(Value::as_object).unwrap_or(&empty);
    // `from` starts from the look's named material, and the fields given override it.
    let mut merged;
    let p = match own.get("from") {
        None | Some(Value::Null) => own,
        Some(from) => {
            let Some(named) = from
                .as_str()
                .and_then(|f| look.materials.get(f))
                .and_then(Value::as_object)
            else {
                return Err(bad("ref_unresolved", "from"));
            };
            merged = named.clone();
            merged.extend(own.iter().map(|(k, v)| (k.clone(), v.clone())));
            &merged
        }
    };
    let at = |k: &str, d: f64| num(p.get(k)).unwrap_or(d);
    let word = |k: &str, d: &'static str| p.get(k).map_or(Some(d), Value::as_str);
    let alpha_mode = match word("alpha_mode", "opaque") {
        Some("opaque") => AlphaMode::Opaque,
        Some("mask") => AlphaMode::Mask,
        Some("blend") => AlphaMode::Blend,
        Some("add") => AlphaMode::Add,
        _ => return Err(bad("out_of_range", "alpha_mode")),
    };
    let casts = match word("shadow", "auto") {
        Some("auto") => !alpha_mode.see_through(),
        Some("cast") => alpha_mode != AlphaMode::Add,
        Some("none") => false,
        // A see-through part's transmittance in the shadow maps lands with colored shadows
        // (#448); refused rather than drawn as another mode.
        _ => return Err(bad("out_of_range", "shadow")),
    };
    let catch = match word("catch", "none") {
        Some("none") => None,
        Some("shadow") => Some(at("catch_strength", 1.0).clamp(0.0, 1.0)),
        // No 3D ambient occlusion exists to catch yet.
        _ => return Err(bad("out_of_range", "catch")),
    };
    let pattern = match word("pattern", "none") {
        Some("none") => 0,
        Some(w) => match PATTERNS.iter().position(|n| *n == w) {
            Some(i) => i as u32 + 1,
            None => return Err(bad("out_of_range", "pattern")),
        },
        None => return Err(bad("out_of_range", "pattern")),
    };
    let ink = match p.get("ink") {
        None | Some(Value::Null) => None,
        Some(ink) => {
            let Some(color) = ink
                .get("role")
                .and_then(Value::as_str)
                .and_then(|r| look.role(r))
            else {
                return Err(bad("ref_unresolved", "ink/role"));
            };
            match ink.get("weight").map_or(Some(1.0), |w| num(Some(w))) {
                Some(w) if w > 0.0 => Some((color, w)),
                _ => return Err(bad("out_of_range", "ink/weight")),
            }
        }
    };
    let base = match p.get("base_color") {
        None => [0.8, 0.8, 0.8, 1.0],
        Some(v @ (Value::String(_) | Value::Object(_))) => {
            match role_of(Some(v)).and_then(|r| look.role(r)) {
                Some(c) => [srgb_decode(c[0]), srgb_decode(c[1]), srgb_decode(c[2]), 1.0],
                None => return Err(bad("ref_unresolved", "base_color")),
            }
        }
        Some(v) => {
            let c = color3(Some(v)).unwrap_or([0.8; 3]);
            let a = v.get(3).and_then(Value::as_f64).unwrap_or(1.0);
            [c[0], c[1], c[2], a]
        }
    };
    let alpha = (base[3] * at("alpha", 1.0)).clamp(0.0, 1.0);
    let strength = at("emission_strength", 1.0);
    let emission = color3(p.get("emission")).unwrap_or([0.0; 3]);
    let flag = |k: &str| p.get(k).and_then(Value::as_bool).unwrap_or(false);
    Ok(Some(Material {
        base: [base[0], base[1], base[2], alpha],
        metallic: at("metallic", 0.0).clamp(0.0, 1.0),
        roughness: at("roughness", 0.5).clamp(0.0, 1.0),
        specular_level: at("specular_level", 0.5).max(0.0),
        specular_color: color3(p.get("specular_color")).unwrap_or([1.0; 3]),
        emission: emission.map(|c| c * strength),
        coat: at("coat", 0.0).clamp(0.0, 1.0),
        coat_roughness: at("coat_roughness", 0.03).clamp(0.0, 1.0),
        alpha_mode,
        pattern,
        pattern_scale: at("pattern_scale", 1.0).max(1e-6),
        pattern_seed: p.get("pattern_seed").map_or(0, seed),
        ink,
        // A catcher only receives: it writes nothing into the shadow maps.
        casts: casts && catch.is_none(),
        catch,
        unlit: flag("unlit"),
        double_sided: flag("double_sided"),
    }))
}

/// A color field's role: a bare name, or `{role}` as #418 reads it.
fn role_of(v: Option<&Value>) -> Option<&str> {
    match v? {
        Value::String(r) => Some(r),
        Value::Object(o) => o.get("role")?.as_str(),
        _ => None,
    }
}

/// A pattern seed's 32-bit hash: FNV-1a over its JSON text, so any value seeds it.
fn seed(v: &Value) -> u32 {
    v.to_string().bytes().fold(0x811c_9dc5_u32, |h, b| {
        (h ^ u32::from(b)).wrapping_mul(0x0100_0193)
    })
}

/// A blackbody's color at `kelvin`, in linear sRGB at unit luminance, so a temperature never
/// changes a light's photometric power: Planck's law integrated against the CIE 1931 observer
/// (Wyman, Sloan and Shirley's multi-lobe fit) from 380 to 780 nm, then XYZ to linear sRGB.
pub fn temperature(kelvin: f64) -> Vec3 {
    let lobe = |l: f64, mu: f64, s1: f64, s2: f64| {
        let t = (l - mu) / if l < mu { s1 } else { s2 };
        (-0.5 * t * t).exp()
    };
    let t = kelvin.clamp(1000.0, 40_000.0);
    let mut xyz = [0.0; 3];
    for nm in 380..=780 {
        let l = f64::from(nm);
        let b = 1.0 / ((l * 1e-9).powi(5) * ((1.4388e-2 / (l * 1e-9 * t)).exp() - 1.0));
        xyz[0] += b
            * (1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7)
                - 0.065 * lobe(l, 501.1, 20.4, 26.2));
        xyz[1] += b * (0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1));
        xyz[2] += b * (1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
    }
    let [x, y, z] = xyz.map(|c| c / xyz[1]);
    let rgb = [
        (3.240_454_2 * x - 1.537_138_5 * y - 0.498_531_4 * z).max(0.0),
        (-0.969_266 * x + 1.876_010_8 * y + 0.041_556 * z).max(0.0),
        (0.055_643_4 * x - 0.204_025_9 * y + 1.057_225_2 * z).max(0.0),
    ];
    let lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    rgb.map(|c| c / lum)
}

/// A light item of `kind` at its world position `pos`, shining along `dir`, its face's axes
/// `axes` (its local +X and +Y in the world, unit), `flicker` its flicker channel's value at t
/// (1 when it names none).
pub fn light(
    id: &str,
    kind: &str,
    params: &Value,
    pos: Vec3,
    dir: Vec3,
    axes: [Vec3; 2],
    flicker: f64,
) -> Option<Light> {
    let kind = match kind {
        "light.sun@1" => LightKind::Sun,
        "light.point@1" => LightKind::Point,
        "light.spot@1" => LightKind::Spot,
        "light.area@1" => LightKind::Area,
        _ => return None,
    };
    let at = |k: &str, d: f64| num(params.get(k)).unwrap_or(d);
    let area = (kind == LightKind::Area).then(|| {
        let size = params.get("size").and_then(Value::as_array);
        let side = |i: usize| size.and_then(|s| num(s.get(i))).unwrap_or(0.5).max(1e-4) / 2.0;
        let scale = |v: Vec3, k: f64| v.map(|c| c * k);
        Area {
            right: scale(axes[0], side(0)),
            up: scale(axes[1], side(1)),
            disk: params.get("shape").and_then(Value::as_str) == Some("disk"),
        }
    });
    let color = match (params.get("color"), num(params.get("temperature"))) {
        (None, Some(k)) => temperature(k),
        (c, _) => color3(c).unwrap_or([1.0; 3]),
    };
    let flicker = flicker.max(0.0);
    let (intensity, range) = match kind {
        LightKind::Sun => (at("illuminance", 10_000.0), f64::INFINITY),
        _ => {
            let power = at("power", 800.0).max(0.0);
            let auto = (power / (4.0 * PI * THRESHOLD)).sqrt();
            (power / (4.0 * PI), at("range", auto))
        }
    };
    let half = |k: &str, d: f64| (at(k, d).clamp(0.0, 179.0) / 2.0).to_radians().cos();
    let outer = half("outer", 45.0);
    Some(Light {
        id: id.to_string(),
        kind,
        pos,
        dir,
        color,
        intensity: intensity * flicker,
        range,
        radius: at("radius", 0.05).max(0.0),
        cone: [outer, half("inner", 0.0).max(outer)],
        area,
        shadow: params
            .get("shadow")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        priority: at("priority", 0.0),
    })
}

/// The shadow budget per view (Light and the light policy: `shadowed`): one sun and two spots.
pub const SHADOWED_SPOTS: usize = 2;

/// The lights `policy` shades that cast a shadow this view, by index: the first sun asking for
/// one, and the two highest-scoring spots asking for one by the policy's order; and, by ID, the
/// ones asking whose shadow the budget dropped (reported, never silent).
pub fn shadowed(lights: &[Light], policy: &Policy) -> (Vec<usize>, Vec<String>) {
    let (mut kept, mut dropped, mut sun, mut spots) = (Vec::new(), Vec::new(), false, 0);
    for &(i, _) in &policy.shaded {
        let l = &lights[i];
        if !l.shadow {
            continue;
        }
        let room = match l.kind {
            LightKind::Sun => !std::mem::replace(&mut sun, true),
            LightKind::Spot if spots < SHADOWED_SPOTS => {
                spots += 1;
                true
            }
            _ => false,
        };
        if room {
            kept.push(i);
        } else {
            dropped.push(l.id.clone());
        }
    }
    (kept, dropped)
}

/// The lights a view shades, with each one's weight, and the ones its budget left out, by ID.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Policy {
    pub shaded: Vec<(usize, f64)>,
    pub left_out: Vec<String>,
}

/// The light policy at a view: each light scored by its estimated illuminance at the eye
/// (power ÷ max(d², r²) inside its range, nothing when its range misses the frustum) times
/// 2^priority; the top [`SHADED`] by (score bucket, ID); a light within the margin of the cut
/// shaded at a weight that ramps with its score, so the set and weights at a view are the same
/// however the view got there.
pub fn policy(lights: &[Light], camera: &Camera) -> Policy {
    policy_by(lights, camera, Tie::Id)
}

/// What breaks a tie between two lights in one score bucket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tie {
    /// By ID: the policy's own rule.
    Id,
    /// By registration order, a planted implementation of scene3d@1's (#421), which the kit's
    /// `bit` part fails.
    Order,
}

/// [`policy`] with ties in a score bucket broken by `tie`.
pub fn policy_by(lights: &[Light], camera: &Camera, tie: Tie) -> Policy {
    if lights.is_empty() {
        return Policy::default();
    }
    let planes = frustum(camera);
    let mut scored: Vec<(i64, &str, usize, f64)> = Vec::new();
    for (i, l) in lights.iter().enumerate() {
        let score = match l.kind {
            LightKind::Sun => l.intensity,
            _ => {
                let d = sub(l.pos, camera.eye);
                let d2 = dot(d, d);
                let inside = planes
                    .iter()
                    .all(|(n, w)| dot(*n, l.pos) + w >= -l.range * dot(*n, *n).sqrt());
                if !inside || d2.sqrt() > l.range + l.radius {
                    0.0
                } else {
                    l.intensity * 4.0 * PI / d2.max(l.radius * l.radius)
                }
            }
        } * l.priority.exp2();
        if score > 0.0 {
            // Eight buckets per stop: a light's rank moves only when its score does.
            scored.push((-(score.log2() * 8.0).floor() as i64, &l.id, i, score));
        }
    }
    match tie {
        Tie::Id => scored.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1))),
        Tie::Order => scored.sort_by_key(|a| (a.0, a.2)),
    }
    let cut = scored.get(SHADED).map(|s| s.3);
    let shaded = scored
        .iter()
        .take(SHADED)
        .map(|&(_, _, i, score)| {
            let w = cut.map_or(1.0, |c| ((score - c) / (c * MARGIN)).clamp(0.0, 1.0));
            (i, w)
        })
        .collect();
    let left_out = scored
        .iter()
        .skip(SHADED)
        .map(|s| s.1.to_string())
        .collect();
    Policy { shaded, left_out }
}

/// The camera's six planes (n, w), inside where n·p + w ≥ 0, from its reversed-Z clip matrix.
fn frustum(camera: &Camera) -> [(Vec3, f64); 6] {
    let m = camera.clip(Depth::Reversed);
    let row = |i: usize| m[i];
    let plane = |a: [f64; 4], s: f64, b: [f64; 4]| {
        (
            [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]],
            a[3] + s * b[3],
        )
    };
    let (w, x, y, z) = (row(3), row(0), row(1), row(2));
    [
        plane(w, 1.0, x),
        plane(w, -1.0, x),
        plane(w, 1.0, y),
        plane(w, -1.0, y),
        plane(z, 0.0, z),
        plane(w, -1.0, z),
    ]
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(id: &str, pos: Vec3, power: f64) -> Light {
        light(
            id,
            "light.point@1",
            &serde_json::json!({ "power": power }),
            pos,
            [0.0, -1.0, 0.0],
            AXES,
            1.0,
        )
        .expect("a point light")
    }

    const AXES: [Vec3; 2] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];

    fn of(kind: &str, p: serde_json::Value) -> Light {
        light("x", kind, &p, [0.0; 3], [0.0, -1.0, 0.0], AXES, 1.0).expect("a light")
    }

    #[test]
    fn a_temperature_colors_a_light_at_unit_luminance_warm_to_cool() {
        let lum = |c: Vec3| 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
        let warm = of("light.point@1", serde_json::json!({"temperature": 2700}));
        let day = of("light.point@1", serde_json::json!({"temperature": 6500}));
        let cool = of("light.point@1", serde_json::json!({"temperature": 12000}));
        for l in [&warm, &day, &cool] {
            assert!((lum(l.color) - 1.0).abs() < 1e-9, "{:?}", l.color);
        }
        assert!(
            warm.color[0] > warm.color[1] && warm.color[1] > warm.color[2],
            "{:?}",
            warm.color
        );
        assert!(
            day.color.iter().all(|c| (c - 1.0).abs() < 0.08),
            "{:?}",
            day.color
        );
        assert!(cool.color[2] > cool.color[0], "{:?}", cool.color);
        // A color given wins over the temperature.
        let given = of(
            "light.point@1",
            serde_json::json!({"temperature": 2700, "color": [0, 1, 0]}),
        );
        assert_eq!(given.color, [0.0, 1.0, 0.0]);
    }

    #[test]
    fn an_area_light_keeps_its_size_and_shape_and_a_flicker_scales_its_power() {
        let a = of(
            "light.area@1",
            serde_json::json!({"power": 800, "size": [2, 1], "shape": "disk"}),
        );
        let area = a.area.expect("an area");
        assert_eq!(
            (area.right, area.up, area.disk),
            ([1.0, 0.0, 0.0], [0.0, 0.5, 0.0], true)
        );
        assert!((a.intensity - 800.0 / (4.0 * PI)).abs() < 1e-12);
        let p = serde_json::json!({"power": 800});
        let dim = light(
            "x",
            "light.point@1",
            &p,
            [0.0; 3],
            [0.0, -1.0, 0.0],
            AXES,
            0.25,
        )
        .expect("a light");
        assert!((dim.intensity - 0.25 * 800.0 / (4.0 * PI)).abs() < 1e-12);
    }

    #[test]
    fn the_shadow_budget_keeps_one_sun_and_two_spots_by_the_policys_order() {
        let cam = camera();
        let spot = |id: &str, power: f64| {
            light(
                id,
                "light.spot@1",
                &serde_json::json!({"power": power, "shadow": true}),
                [0.0, 1.0, 0.0],
                [0.0, -1.0, 0.0],
                AXES,
                1.0,
            )
            .expect("a spot")
        };
        let sun = |id: &str| {
            light(
                id,
                "light.sun@1",
                &serde_json::json!({"illuminance": 100, "shadow": true}),
                [0.0; 3],
                [0.0, -1.0, 0.0],
                AXES,
                1.0,
            )
            .expect("a sun")
        };
        let lights = vec![
            spot("s-dim", 100.0),
            sun("sun-b"),
            spot("s-mid", 400.0),
            sun("sun-a"),
            spot("s-hot", 1600.0),
            point("p", [0.0, 1.0, 0.0], 800.0),
        ];
        let p = policy(&lights, &cam);
        let (kept, dropped) = shadowed(&lights, &p);
        let ids: Vec<&str> = kept.iter().map(|&i| lights[i].id.as_str()).collect();
        assert_eq!(ids, ["sun-a", "s-hot", "s-mid"]);
        assert_eq!(dropped, ["sun-b", "s-dim"]);
    }

    #[test]
    fn a_material_starts_from_the_looks_named_one_and_its_own_fields_override() {
        let look = Look3::read(&serde_json::json!({"roles": {}, "materials": {"steel": {"metallic": 1, "roughness": 0.3, "coat": 0.5}}})).expect("a look");
        let items = serde_json::json!({"m": {"kind": "material@1", "params": {"from": "steel", "roughness": 0.6}},
            "bad": {"kind": "material@1", "params": {"from": "nothing"}}});
        let named = |k: &str| items.get(k);
        let m = material(&serde_json::json!({"material": "m"}), named, &look, "it")
            .unwrap()
            .unwrap();
        assert_eq!((m.metallic, m.roughness, m.coat), (1.0, 0.6, 0.5));
        let r = material(&serde_json::json!({"material": "bad"}), named, &look, "it").unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("ref_unresolved", "items/bad/params/from")
        );
    }

    fn camera() -> Camera {
        let doc = serde_json::json!({
            "size": [400, 300], "camera": "cam",
            "items": {"cam": {"kind": "camera@1", "params": {"projection": "perspective",
                "position": [0, 2, 10], "target": [0, 0, 0], "fov": 40}}}});
        let look = Look3::read(&serde_json::json!({"roles": {}})).expect("a look");
        crate::scene::evaluate(&doc, 0, &look, &mut crate::scene::Labels::new())
            .expect("evaluates")
            .camera
    }

    #[test]
    fn a_spot_counts_its_lumens_over_the_whole_sphere() {
        let p = &serde_json::json!({"power": 800, "inner": 20, "outer": 30});
        let s = light(
            "s",
            "light.spot@1",
            p,
            [0.0; 3],
            [0.0, -1.0, 0.0],
            AXES,
            1.0,
        )
        .expect("a spot");
        assert!((s.intensity - 800.0 / (4.0 * PI)).abs() < 1e-12);
        assert!((s.range - (800.0 / (4.0 * PI * 0.05_f64)).sqrt()).abs() < 1e-9);
    }

    #[test]
    fn the_policy_is_a_pure_function_of_the_view_and_ties_break_by_id() {
        let cam = camera();
        // 40 equal lights: the cut falls between equal scores, so IDs decide, whatever the order.
        let mut lights: Vec<Light> = (0..40)
            .map(|i| point(&format!("l{i:02}"), [0.0, 1.0, 0.0], 800.0))
            .collect();
        let a = policy(&lights, &cam);
        lights.reverse();
        let b = policy(&lights, &cam);
        let ids = |p: &Policy, ls: &[Light]| -> Vec<String> {
            p.shaded.iter().map(|(i, _)| ls[*i].id.clone()).collect()
        };
        let mut forward: Vec<Light> = lights.clone();
        forward.reverse();
        assert_eq!(ids(&a, &forward), ids(&b, &lights));
        assert_eq!(a.left_out, b.left_out);
        assert_eq!(a.left_out.len(), 8);
        assert_eq!(a.left_out[0], "l32");
    }

    #[test]
    fn lights_near_the_cut_dim_by_score_and_one_out_of_range_is_not_shaded() {
        let cam = camera();
        let mut lights: Vec<Light> = (0..32)
            .map(|i| point(&format!("a{i:02}"), [0.0, 1.0, 0.0], 8000.0))
            .collect();
        lights.push(point("b-near", [0.0, 1.0, 0.0], 860.0));
        lights.push(point("c-cut", [0.0, 1.0, 0.0], 800.0));
        lights.push(point("far", [0.0, 1.0, -500.0], 800.0));
        let p = policy(&lights, &cam);
        assert_eq!(p.left_out, vec!["b-near".to_string(), "c-cut".to_string()]);
        let mut lights = lights;
        lights.remove(0);
        let p = policy(&lights, &cam);
        let w = p
            .shaded
            .iter()
            .find(|(i, _)| lights[*i].id == "b-near")
            .map(|x| x.1);
        assert!(w.is_some_and(|w| (w - 0.75).abs() < 1e-9), "{w:?}");
        assert_eq!(p.left_out, vec!["c-cut".to_string()]);
    }
}
