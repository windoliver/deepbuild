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
    /// Its extra lobes (#428), each off at its zero.
    pub lobes: Lobes,
}

/// A material's extra lobes (#428; Material): each a feature only the parts that use it pay
/// for, off while [`Lobes::on`] is false. Colors are linear, already times their weight.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Lobes {
    /// The cloth lobe's color (times its weight) and roughness.
    pub sheen: Vec3,
    pub sheen_roughness: f64,
    /// The highlight's stretch along uv0's u direction, −1 to 1, turned by `rotation` (rad).
    pub anisotropy: f64,
    pub anisotropy_rotation: f64,
    /// Translucency's color and amount; `wrap` is `Some(w)` for wrap, `None` for thin.
    pub translucency: Vec3,
    pub amount: f64,
    pub wrap: Option<f64>,
    pub transmission: f64,
    pub ior: f64,
    /// Absorption: the thickness in the part's own space (m) and the attenuation coefficient
    /// per m, −ln(color) ÷ distance.
    pub thickness: f64,
    pub attenuation: Vec3,
    pub dispersion: f64,
    /// The thin film: its weight, ior and thickness in nm.
    pub iridescence: f64,
    pub film_ior: f64,
    pub film_nm: f64,
    pub diffuse_roughness: f64,
    pub retroreflection: f64,
    /// Flakes: their color, weight, cell size in m and the cosine of their tilt.
    pub flakes: Vec3,
    pub flake_weight: f64,
    pub flake_size: f64,
    pub flake_cos_tilt: f64,
    /// Whether the specular color leaves white, which is a feature too (Material).
    pub tinted: bool,
    /// Subsurface (#481; Material: subsurface): its weight, its color (linear; `None` for the
    /// part's base color at the pixel), its mean free path in m per channel, and whether thin
    /// parts let light through.
    pub subsurface: f64,
    pub subsurface_color: Option<Vec3>,
    pub subsurface_radius: Vec3,
    pub subsurface_thin: bool,
}

impl Lobes {
    /// Whether any lobe is on, so the part shades through the lobes at all.
    pub fn on(&self) -> bool {
        let lit = |c: Vec3| c.iter().any(|x| *x > 0.0);
        lit(self.sheen)
            || self.anisotropy != 0.0
            || self.amount > 0.0
            || self.ior != 1.5
            || self.tinted
            || self.transmission > 0.0
            || self.iridescence > 0.0
            || self.diffuse_roughness > 0.0
            || self.retroreflection > 0.0
            || self.flake_weight > 0.0
            || self.subsurface > 0.0
    }
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

/// How a map's texture coordinates wrap on one axis (Material: texture maps, `wrap`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Wrap {
    Repeat,
    Clamp,
    Mirror,
}

impl Wrap {
    fn read(v: &Value) -> Option<Wrap> {
        Some(match v.as_str()? {
            "repeat" => Wrap::Repeat,
            "clamp" => Wrap::Clamp,
            "mirror" => Wrap::Mirror,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            Wrap::Repeat => "repeat",
            Wrap::Clamp => "clamp",
            Wrap::Mirror => "mirror",
        }
    }
}

/// One texture map of a material (#423; Material: texture maps): its image by hash, the uv set
/// it reads (0 or 1), its uv transform as two rows of an affine map (KHR_texture_transform's
/// translation × rotation × scale), its wrap on s and t and its most taps (`None`: the look's).
#[derive(Clone, Debug, PartialEq)]
pub struct MapSlot {
    pub sha: String,
    pub uv: u8,
    pub transform: [[f64; 3]; 2],
    pub wrap: [Wrap; 2],
    pub taps: Option<u8>,
}

/// A material's texture maps, keyed by everything they hold, so materials with equal maps share
/// one bind group.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Maps {
    pub key: String,
    pub base_color: Option<MapSlot>,
    pub metallic_roughness: Option<MapSlot>,
    pub normal: Option<MapSlot>,
    pub occlusion: Option<MapSlot>,
    pub emission: Option<MapSlot>,
    pub normal_scale: f64,
    pub occlusion_strength: f64,
    pub alpha_cutoff: f64,
}

impl Maps {
    /// Each map with its field's name, in the shader's order.
    pub fn slots(&self) -> [(&'static str, &Option<MapSlot>); 5] {
        [
            ("maps/base_color", &self.base_color),
            ("maps/metallic_roughness", &self.metallic_roughness),
            ("normal_map", &self.normal),
            ("maps/occlusion", &self.occlusion),
            ("maps/emission", &self.emission),
        ]
    }
}

/// A map's texels as the decode worker made them for the GPU (#423): its format in WebGPU's name,
/// size, mip count and every mip end to end, largest first.
#[derive(Clone, PartialEq)]
pub struct Texels {
    pub format: String,
    pub size: [u32; 2],
    pub mips: u32,
    pub data: std::sync::Arc<Vec<u8>>,
}

impl std::fmt::Debug for Texels {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Texels({} {:?} {} mips)",
            self.format, self.size, self.mips
        )
    }
}

/// One map field: a SHA-256, or `{sha256, uv, transform: {offset, scale, rotation: deg}, wrap,
/// filter_taps}`; refused at its field's path.
fn map_slot(v: &Value, field: &str) -> Result<MapSlot, Refused> {
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: if k.is_empty() {
            field.to_string()
        } else {
            format!("{field}/{k}")
        },
    };
    let sha_ok = |s: &str| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    if let Some(sha) = v.as_str() {
        if !sha_ok(sha) {
            return Err(bad(""));
        }
        return Ok(MapSlot {
            sha: sha.to_string(),
            uv: 0,
            transform: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            wrap: [Wrap::Repeat; 2],
            taps: None,
        });
    }
    let o = v.as_object().ok_or_else(|| bad(""))?;
    let sha = o
        .get("sha256")
        .and_then(Value::as_str)
        .filter(|s| sha_ok(s))
        .ok_or_else(|| bad("sha256"))?;
    let uv = match o.get("uv").and_then(Value::as_str) {
        None | Some("uv0") if o.get("uv").is_none_or(Value::is_string) => 0,
        Some("uv1") => 1,
        _ => return Err(bad("uv")),
    };
    let t = o.get("transform");
    let pair = |k: &str, d: [f64; 2]| -> Result<[f64; 2], Refused> {
        match t.and_then(|t| t.get(k)) {
            None => Ok(d),
            Some(p) => {
                let a = p.as_array().filter(|a| a.len() == 2);
                let x = a
                    .and_then(|a| num(a.first()))
                    .ok_or_else(|| bad(&format!("transform/{k}")))?;
                let y = a
                    .and_then(|a| num(a.get(1)))
                    .ok_or_else(|| bad(&format!("transform/{k}")))?;
                Ok([x, y])
            }
        }
    };
    let offset = pair("offset", [0.0, 0.0])?;
    let scale = pair("scale", [1.0, 1.0])?;
    let rotation = match t.and_then(|t| t.get("rotation")) {
        None => 0.0,
        Some(r) => num(Some(r)).ok_or_else(|| bad("transform/rotation"))?,
    };
    let (sn, cs) = rotation.to_radians().sin_cos();
    let wrap = match o.get("wrap") {
        None => [Wrap::Repeat; 2],
        Some(Value::Array(a)) if a.len() == 2 => [
            Wrap::read(&a[0]).ok_or_else(|| bad("wrap"))?,
            Wrap::read(&a[1]).ok_or_else(|| bad("wrap"))?,
        ],
        Some(w) => [Wrap::read(w).ok_or_else(|| bad("wrap"))?; 2],
    };
    let taps = match o.get("filter_taps").map(Value::as_u64) {
        None => None,
        Some(Some(n @ (1 | 2 | 4 | 8 | 16))) => Some(n as u8),
        Some(_) => return Err(bad("filter_taps")),
    };
    Ok(MapSlot {
        sha: sha.to_string(),
        uv,
        // KHR_texture_transform: T × R × S, R = [[cos, sin], [−sin, cos]].
        transform: [
            [cs * scale[0], sn * scale[1], offset[0]],
            [-sn * scale[0], cs * scale[1], offset[1]],
        ],
        wrap,
        taps,
    })
}

/// The texture maps of the `material@1` that `item` names (#423), or `None` with none.
pub fn maps<'a>(
    item: &Value,
    named: impl Fn(&str) -> Option<&'a Value>,
) -> Result<Option<std::sync::Arc<Maps>>, Refused> {
    let Some(name) = item.get("material").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(p) = named(name).and_then(|m| m.get("params")) else {
        return Ok(None);
    };
    let field = |k: &str| format!("items/{name}/params/{k}");
    let slot = |v: Option<&Value>, k: &str| -> Result<Option<MapSlot>, Refused> {
        match v {
            None | Some(Value::Null) => Ok(None),
            Some(v) => map_slot(v, &field(k)).map(Some),
        }
    };
    let m = p.get("maps");
    if m.is_some_and(|m| !m.is_object() && !m.is_null()) {
        return Err(Refused {
            code: "out_of_range",
            path: field("maps"),
        });
    }
    let at = |k: &str| m.and_then(|m| m.get(k));
    let mut out = Maps {
        key: String::new(),
        base_color: slot(at("base_color"), "maps/base_color")?,
        metallic_roughness: slot(at("metallic_roughness"), "maps/metallic_roughness")?,
        emission: slot(at("emission"), "maps/emission")?,
        occlusion: slot(at("occlusion"), "maps/occlusion")?,
        normal: slot(p.get("normal_map"), "normal_map")?,
        normal_scale: num(p.get("normal_scale")).unwrap_or(1.0),
        occlusion_strength: num(p.get("occlusion_strength"))
            .unwrap_or(1.0)
            .clamp(0.0, 1.0),
        alpha_cutoff: num(p.get("alpha_cutoff")).unwrap_or(0.5),
    };
    if out.slots().iter().all(|(_, s)| s.is_none()) {
        return Ok(None);
    }
    out.key = format!("{out:?}");
    Ok(Some(std::sync::Arc::new(out)))
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
    /// Whether it asks for a shadow (the policy's budget decides).
    pub shadow: bool,
    pub priority: f64,
    /// Its local +X and +Y in the world, unit: the frame its distribution and its area's cube
    /// turn in.
    pub axes: [Vec3; 2],
    /// A sun's apparent diameter in degrees (Light policy: soft shadows).
    pub angle: f64,
    /// The collections it lights and that shadow it, by name; empty for all.
    pub receivers: Vec<String>,
    pub casters: Vec<String>,
    /// Its receiver and caster sets' bits (Light: receivers, casters), 0 for all, which
    /// [`crate::sets::compile`] fills.
    pub receiver_bit: u32,
    pub caster_bit: u32,
    /// Its IES distribution (Light: IES distribution).
    pub distribution: Option<LampTable>,
}

/// A light's IES table: its layer in the scene's distributions, what its values are multiplied by
/// so its flux holds (a spot's table is normalized over its cone), and the share of the file's
/// flux a spot's cone clips.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LampTable {
    pub layer: u32,
    pub scale: f64,
    pub clipped: f64,
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
        // Glass lets light through: `auto` also writes nothing for a transmissive part, which
        // the lobes below read (#446).
        Some("auto") => !alpha_mode.see_through() && at("transmission", 0.0) <= 0.0,
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
    let lobes = lobes(p, [base[0], base[1], base[2]]).map_err(|k| bad("out_of_range", k))?;
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
        lobes,
    }))
}

/// A material's extra lobes from its params (#428), each color `base` unless set; `Err` names
/// the field out of its range.
fn lobes(p: &serde_json::Map<String, Value>, base: Vec3) -> Result<Lobes, &'static str> {
    let sub = |k: &str, f: &str| p.get(k).and_then(|o| o.get(f));
    let at = |k: &str, f: &str, d: f64| num(sub(k, f)).unwrap_or(d);
    let color = |k: &str| match sub(k, "color") {
        None | Some(Value::Null) => Some(base),
        Some(Value::String(s)) if s == "base" => Some(base),
        v => color3(v),
    };
    let unit = |v: f64, k: &'static str| (0.0..=1.0).contains(&v).then_some(v).ok_or(k);
    let scaled = |c: Vec3, w: f64| c.map(|x| x * w);
    let sheen_w = unit(at("sheen", "weight", 0.0), "sheen/weight")?;
    let anisotropy = at("anisotropy", "strength", 0.0);
    if !(-1.0..=1.0).contains(&anisotropy) {
        return Err("anisotropy/strength");
    }
    let amount = unit(at("translucency", "amount", 0.0), "translucency/amount")?;
    let wrap = match sub("translucency", "kind").map_or(Some("thin"), Value::as_str) {
        Some("thin") => None,
        Some("wrap") => Some(unit(at("translucency", "wrap", 0.5), "translucency/wrap")?),
        _ => return Err("translucency/kind"),
    };
    let top = |k: &str| num(p.get(k));
    let thickness = at("absorption", "thickness", 0.0).max(0.0);
    let att = p.get("absorption").and_then(|a| a.get("attenuation"));
    let att_color = color3(att.and_then(|a| a.get("color"))).unwrap_or([1.0; 3]);
    let distance = num(att.and_then(|a| a.get("distance"))).unwrap_or(f64::INFINITY);
    let attenuation = att_color.map(|c| {
        if distance.is_finite() && distance > 0.0 {
            -c.max(1e-6).ln() / distance
        } else {
            0.0
        }
    });
    let flake_w = unit(at("flakes", "weight", 0.0), "flakes/weight")?;
    // Skin's mean free paths unless set, each a positive length in m (#481).
    let radius = match sub("subsurface", "radius") {
        None | Some(Value::Null) => [0.0036, 0.0014, 0.0007],
        v => color3(v)
            .filter(|r| r.iter().all(|x| *x > 0.0))
            .ok_or("subsurface/radius")?,
    };
    let thin = match sub("subsurface", "thin") {
        None | Some(Value::Null) => true,
        Some(v) => v.as_bool().ok_or("subsurface/thin")?,
    };
    Ok(Lobes {
        sheen: scaled(color("sheen").ok_or("sheen/color")?, sheen_w),
        sheen_roughness: at("sheen", "roughness", 0.5).clamp(0.0, 1.0),
        anisotropy,
        anisotropy_rotation: at("anisotropy", "rotation", 0.0).to_radians(),
        translucency: color("translucency").ok_or("translucency/color")?,
        amount,
        wrap,
        transmission: unit(top("transmission").unwrap_or(0.0), "transmission")?,
        ior: top("ior").unwrap_or(1.5).max(1.0),
        thickness,
        attenuation,
        dispersion: top("dispersion").unwrap_or(0.0).max(0.0),
        iridescence: unit(at("iridescence", "weight", 0.0), "iridescence/weight")?,
        film_ior: at("iridescence", "ior", 1.3).max(1.0),
        film_nm: at("iridescence", "thickness", 400.0).max(0.0),
        diffuse_roughness: unit(top("diffuse_roughness").unwrap_or(0.0), "diffuse_roughness")?,
        retroreflection: unit(top("retroreflection").unwrap_or(0.0), "retroreflection")?,
        flakes: color("flakes").ok_or("flakes/color")?,
        flake_weight: flake_w,
        flake_size: at("flakes", "size", 0.001).max(1e-5),
        flake_cos_tilt: at("flakes", "tilt", 15.0)
            .clamp(0.0, 90.0)
            .to_radians()
            .cos(),
        tinted: color3(p.get("specular_color")).is_some_and(|c| c != [1.0; 3]),
        subsurface: unit(at("subsurface", "weight", 0.0), "subsurface/weight")?,
        subsurface_color: match sub("subsurface", "color") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s == "base" => None,
            v => Some(color3(v).ok_or("subsurface/color")?),
        },
        subsurface_radius: radius,
        subsurface_thin: thin,
    })
}

/// The material operator of the `material@1` item `item` names (#429; Material: `op`): the ID
/// and item of the `gpu.material@1` its `params.op` names, `None` when it names none.
pub fn material_op<'a>(
    item: &Value,
    named: impl Fn(&str) -> Option<&'a Value>,
) -> Result<Option<(&'a str, &'a Value)>, Refused> {
    let Some(m) = item.get("material").and_then(Value::as_str) else {
        return Ok(None);
    };
    let Some(op) = named(m)
        .and_then(|m| m.get("params"))
        .and_then(|p| p.get("op"))
        .filter(|o| !o.is_null())
    else {
        return Ok(None);
    };
    let found = op.as_str().and_then(|id| {
        let o = named(id)
            .filter(|o| o.get("kind").and_then(Value::as_str) == Some("gpu.material@1"))?;
        Some((o.get("id").and_then(Value::as_str).unwrap_or(id), o))
    });
    match found {
        Some(f) => Ok(Some(f)),
        None => Err(Refused {
            code: "ref_unresolved",
            path: format!("items/{m}/params/op"),
        }),
    }
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
    // `inner` and `outer` are the cone's half angles, measured from its axis as the tools whose
    // words the familiar-names packs carry measure them (#433).
    let half = |k: &str, d: f64| at(k, d).clamp(0.0, 90.0).to_radians().cos();
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
        axes,
        angle: at("angle", 0.53).max(0.0),
        receivers: Vec::new(),
        casters: Vec::new(),
        receiver_bit: 0,
        caster_bit: 0,
        distribution: None,
    })
}

/// PCSS or Castaño's filter (Light policy: soft shadows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Soft {
    pub pcss: bool,
    pub blocker_taps: u32,
    pub filter_taps: u32,
    /// The most a penumbra spreads, in shadow map texels.
    pub max_penumbra: f64,
}

/// Screen-space contact shadows for the key light.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Contact {
    pub length: f64,
    pub samples: u32,
}

/// The light policy's shadow fields (Light policy: soft shadows, local shadows).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadowing {
    pub soft: Option<Soft>,
    pub contact: Option<Contact>,
    pub spots: usize,
    /// Point lights and area lights with a shadow.
    pub points: usize,
    /// A spot's map's side and each cube face's, in texels.
    pub local_map: u32,
    /// `cache: static`: a map holds until its key changes.
    pub cache: bool,
}

/// The most spots a policy may shadow; points take four, which the budget class never raises.
pub const MOST_SPOTS: usize = 8;
pub const MOST_POINTS: usize = 4;

impl Default for Shadowing {
    /// A document that names no `light_policy`: the key sun's tent alone, as before it had one.
    fn default() -> Shadowing {
        Shadowing {
            soft: None,
            contact: None,
            spots: 0,
            points: 0,
            local_map: 512,
            cache: true,
        }
    }
}

impl Shadowing {
    /// A `light_policy`'s fields before it names any: PCSS and two shadowed spots.
    pub fn named() -> Shadowing {
        Shadowing {
            soft: Some(Soft {
                pcss: true,
                blocker_taps: 16,
                filter_taps: 16,
                max_penumbra: 32.0,
            }),
            spots: 2,
            ..Shadowing::default()
        }
    }
}

/// The shadows a view keeps: each light by its index with the share of its shadow the policy
/// keeps, and the ones asking that lost theirs, by ID.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Shadowed {
    pub kept: Vec<(usize, f64)>,
    pub dropped: Vec<String>,
}

/// The lights `policy` shades that cast a shadow this view, by the policy's order: the first sun
/// asking for one, and the top spots and the top point and area lights the budget holds. A shadow
/// near its cap fades by score across the margin, and a light the cut has begun to dim loses its
/// shadow first; either way it's reported by ID, never silent.
pub fn shadowed(lights: &[Light], policy: &Policy, budget: &Shadowing, scores: &[f64]) -> Shadowed {
    let mut out = Shadowed::default();
    let (mut sun, mut spots, mut points) = (false, Vec::new(), Vec::new());
    let mut cuts = [None, None];
    for &(i, weight) in &policy.shaded {
        let l = &lights[i];
        if !l.shadow {
            continue;
        }
        let (list, cap, group): (&mut Vec<usize>, usize, usize) = match l.kind {
            LightKind::Sun => {
                if std::mem::replace(&mut sun, true) {
                    out.dropped.push(l.id.clone());
                } else {
                    out.kept.push((i, 1.0));
                }
                continue;
            }
            LightKind::Spot => (&mut spots, budget.spots, 0),
            _ => (&mut points, budget.points, 1),
        };
        if weight >= 1.0 && list.len() < cap {
            list.push(i);
        } else {
            out.dropped.push(l.id.clone());
            cuts[group] = cuts[group].or(Some(scores[i]));
        }
    }
    for (list, cut) in [spots, points].iter().zip(cuts) {
        for &i in list {
            let share = cut.map_or(1.0, |c| ((scores[i] - c) / (c * MARGIN)).clamp(0.0, 1.0));
            if share > 0.0 {
                out.kept.push((i, share));
            } else {
                out.dropped.push(lights[i].id.clone());
            }
        }
    }
    out
}

/// The lights a view shades, with each one's weight, and the ones its budget left out, by ID.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Policy {
    pub shaded: Vec<(usize, f64)>,
    pub left_out: Vec<String>,
}

/// The light policy at a view: each light scored by its estimated illuminance at the eye
/// (power ÷ max(d², r²), nothing when its range misses the frustum, wherever the eye is) times
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
    let mut scored: Vec<(i64, &str, usize, f64)> = Vec::new();
    for (i, score) in scores(lights, camera).into_iter().enumerate() {
        if score > 0.0 {
            // Eight buckets per stop: a light's rank moves only when its score does.
            scored.push((
                -(score.log2() * 8.0).floor() as i64,
                &lights[i].id,
                i,
                score,
            ));
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

/// Each light's score at the view, in the lights' order (#425 reads them): its estimated
/// illuminance at the eye (power ÷ max(d², r²), 0 when its range misses the frustum) times
/// 2^priority; a sun's illuminance times 2^priority.
pub fn scores(lights: &[Light], camera: &Camera) -> Vec<f64> {
    let planes = frustum(camera);
    lights
        .iter()
        .map(|l| {
            (match l.kind {
                LightKind::Sun => l.intensity,
                _ => {
                    let d = sub(l.pos, camera.eye);
                    let d2 = dot(d, d);
                    let inside = planes
                        .iter()
                        .all(|(n, w)| dot(*n, l.pos) + w >= -l.range * dot(*n, *n).sqrt());
                    if !inside {
                        0.0
                    } else {
                        l.intensity * 4.0 * PI / d2.max(l.radius * l.radius)
                    }
                }
            }) * l.priority.exp2()
        })
        .collect()
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
        let budget = Shadowing::named();
        let got = shadowed(&lights, &p, &budget, &scores(&lights, &cam));
        let kept: Vec<usize> = got.kept.iter().map(|k| k.0).collect();
        let dropped = got.dropped;
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
        // Behind the camera, its 36 m range misses the frustum.
        lights.push(point("far", [0.0, 1.0, 500.0], 800.0));
        let p = policy(&lights, &cam);
        assert_eq!(p.left_out, vec!["b-near".to_string(), "c-cut".to_string()]);
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

    #[test]
    fn a_light_whose_range_reaches_the_view_but_not_the_eye_is_shaded() {
        // 12 lm: an auto range of 4.4 m, 10 m from the eye at the scene's centre.
        let p = policy(&[point("candle", [0.0, 0.0, 0.0], 12.0)], &camera());
        assert_eq!(p.shaded, vec![(0, 1.0)]);
    }
}
