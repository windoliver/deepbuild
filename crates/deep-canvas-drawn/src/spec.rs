//! A look's drawn fields as read and checked, each refusal naming its field by path (Look
//! `look@1`: light; paper; line profiles; drawn fills; Paint: noise fill).

use serde_json::{Map, Value};

/// Why a drawn field is refused: a code and the field's path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

fn bad<T>(path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code: "bad_look",
        path: path.into(),
    })
}

fn object<'a>(v: Option<&'a Value>, path: &str) -> Result<Option<&'a Map<String, Value>>, Refused> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(m)) => Ok(Some(m)),
        Some(_) => bad(path),
    }
}

fn number(m: &Map<String, Value>, name: &str, or: f64, path: &str) -> Result<f64, Refused> {
    match m.get(name) {
        None | Some(Value::Null) => Ok(or),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() => Ok(n),
            _ => bad(format!("{path}/{name}")),
        },
    }
}

fn between(
    m: &Map<String, Value>,
    name: &str,
    or: f64,
    range: (f64, f64),
    path: &str,
) -> Result<f64, Refused> {
    let n = number(m, name, or, path)?;
    if n < range.0 || n > range.1 {
        return Err(Refused {
            code: "out_of_range",
            path: format!("{path}/{name}"),
        });
    }
    Ok(n)
}

fn unit(m: &Map<String, Value>, name: &str, or: f64, path: &str) -> Result<f64, Refused> {
    between(m, name, or, (0.0, 1.0), path)
}

fn text<'a>(m: &'a Map<String, Value>, name: &str, path: &str) -> Result<Option<&'a str>, Refused> {
    match m.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s)),
        Some(_) => bad(format!("{path}/{name}")),
    }
}

fn choice<T: Copy>(
    m: &Map<String, Value>,
    name: &str,
    or: T,
    from: &[(&str, T)],
    path: &str,
) -> Result<T, Refused> {
    match text(m, name, path)? {
        None => Ok(or),
        Some(s) => match from.iter().find(|(k, _)| *k == s) {
            Some((_, v)) => Ok(*v),
            None => bad(format!("{path}/{name}")),
        },
    }
}

/// A seed: a number as written, 0 for `document` or `item` (which the IDs and the document's seed
/// already reach) or none.
fn seed(m: &Map<String, Value>, path: &str) -> Result<u64, Refused> {
    match m.get("seed") {
        None | Some(Value::Null) | Some(Value::String(_)) => Ok(0),
        Some(v) => match v.as_u64() {
            Some(n) => Ok(n),
            None => bad(format!("{path}/seed")),
        },
    }
}

/// A status role is `status.<state>` or a state's name: no drawn field may use one.
pub fn is_status_role(role: &str) -> bool {
    const STATES: [&str; 9] = [
        "pass",
        "fail",
        "invalid",
        "blocked",
        "inconclusive",
        "running",
        "needs_you",
        "stale",
        "idle",
    ];
    STATES.contains(&role.strip_prefix("status.").unwrap_or(role))
}

fn role(m: &Map<String, Value>, name: &str, path: &str) -> Result<Option<String>, Refused> {
    let Some(r) = text(m, name, path)? else {
        return Ok(None);
    };
    if is_status_role(r) {
        return Err(Refused {
            code: "status_role",
            path: format!("{path}/{name}: {r}"),
        });
    }
    Ok(Some(r.to_string()))
}

/// What a rim leans toward: the look's light, or an item.
#[derive(Clone, Debug, PartialEq)]
pub enum Toward {
    Light,
    Item(String),
}

/// One rim (`rim`, a list of up to two; #149: a portrait carries two kickers).
#[derive(Clone, Debug, PartialEq)]
pub struct Rim {
    pub role: String,
    /// In px.
    pub width: f64,
    /// Its own direction in degrees, or the light's.
    pub dir: Option<f64>,
    pub toward: Toward,
    /// The collection it lands on, or every item.
    pub on: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Cast {
    pub role: String,
    /// In u.
    pub length: f64,
    /// In px.
    pub softness: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReliefFrom {
    Tooth,
    Height,
    Mask,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Relief {
    pub from: ReliefFrom,
    pub strength: f64,
}

/// A backlit screen: the lamp items and each collection's transmission.
#[derive(Clone, Debug, PartialEq)]
pub struct Back {
    pub lamps: Vec<String>,
    pub transmission: Vec<(String, f64)>,
}

/// A drawing look's light (Look `look@1`: light).
#[derive(Clone, Debug, PartialEq)]
pub struct Light {
    /// Degrees, counterclockwise from +x as a page reads it.
    pub dir: f64,
    pub elevation: f64,
    pub rims: Vec<Rim>,
    pub cast: Option<Cast>,
    pub weight: f64,
    pub relief: Option<Relief>,
    pub back: Option<Back>,
}

/// The most rims a look's light takes.
pub const MAX_RIMS: usize = 2;

fn rim(m: &Map<String, Value>, path: &str) -> Result<Rim, Refused> {
    let toward = match text(m, "toward", path)? {
        None | Some("light") => Toward::Light,
        Some(id) => Toward::Item(id.to_string()),
    };
    Ok(Rim {
        role: match role(m, "role", path)? {
            Some(r) => r,
            None => return bad(format!("{path}/role")),
        },
        width: number(m, "width", 2.0, path)?,
        dir: m
            .get("dir")
            .map(|_| number(m, "dir", 0.0, path))
            .transpose()?,
        toward,
        on: text(m, "on", path)?.map(str::to_string),
    })
}

/// A look's `light`, or `None`. A physical look takes its light from Light items and refuses it.
pub fn light(look: &Map<String, Value>) -> Result<Option<Light>, Refused> {
    let Some(l) = object(look.get("light"), "light")? else {
        return Ok(None);
    };
    if look.get("basis").and_then(Value::as_str) == Some("physical") {
        return Err(Refused {
            code: "light_on_physical",
            path: "light".into(),
        });
    }
    let rims = match l.get("rim") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Object(r)) => vec![rim(r, "light/rim")?],
        Some(Value::Array(list)) => {
            if list.len() > MAX_RIMS {
                return Err(Refused {
                    code: "out_of_range",
                    path: "light/rim".into(),
                });
            }
            let mut out = Vec::new();
            for (i, r) in list.iter().enumerate() {
                let path = format!("light/rim/{i}");
                match r {
                    Value::Object(r) => out.push(rim(r, &path)?),
                    _ => return bad(path),
                }
            }
            out
        }
        Some(_) => return bad("light/rim"),
    };
    let cast = match object(l.get("cast"), "light/cast")? {
        None => None,
        Some(c) => Some(Cast {
            role: match role(c, "role", "light/cast")? {
                Some(r) => r,
                None => return bad("light/cast/role"),
            },
            length: number(c, "length", 0.0, "light/cast")?,
            softness: number(c, "softness", 0.0, "light/cast")?,
        }),
    };
    let relief = match object(l.get("relief"), "light/relief")? {
        None => None,
        Some(r) => Some(Relief {
            from: choice(
                r,
                "from",
                ReliefFrom::Tooth,
                &[
                    ("tooth", ReliefFrom::Tooth),
                    ("height", ReliefFrom::Height),
                    ("mask", ReliefFrom::Mask),
                ],
                "light/relief",
            )?,
            strength: number(r, "strength", 1.0, "light/relief")?,
        }),
    };
    let back = match object(l.get("back"), "light/back")? {
        None => None,
        Some(b) => {
            let lamps = b
                .get("lamps")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let mut transmission = Vec::new();
            if let Some(t) = object(b.get("transmission"), "light/back/transmission")? {
                for name in t.keys() {
                    transmission
                        .push((name.clone(), unit(t, name, 1.0, "light/back/transmission")?));
                }
            }
            Some(Back {
                lamps,
                transmission,
            })
        }
    };
    Ok(Some(Light {
        dir: number(l, "dir", 135.0, "light")?,
        elevation: number(l, "elevation", 45.0, "light")?,
        rims,
        cast,
        weight: number(l, "weight", 0.0, "light")?,
        relief,
        back,
    }))
}

/// The paper's tooth kinds, in the shader's order.
pub const TEETH: [&str; 8] = [
    "cold_press",
    "laid",
    "wove",
    "canvas",
    "linen",
    "silk",
    "stone",
    "wood",
];

#[derive(Clone, Debug, PartialEq)]
pub struct Tooth {
    /// Its index in [`TEETH`].
    pub kind: u32,
    /// In px.
    pub scale: f64,
    pub depth: f64,
    /// An image's sha256 to read instead of the kind.
    pub from: Option<String>,
    pub seed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Anchor {
    Page,
    Sheet,
    World,
    Frame,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zoom {
    CrossfadeOctaves,
    FadeFine,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Age {
    pub folds: f64,
    pub creases: f64,
    /// `(count, size px, role)`.
    pub stains: Option<(u32, f64, String)>,
    pub foxing: f64,
    /// `(inset px, depth)`.
    pub plate_mark: Option<(f64, f64)>,
    /// `(scale px, amount)`.
    pub craquelure: Option<(f64, f64)>,
    /// `(ramp roles, width px)`.
    pub tarnish: Option<(Vec<String>, f64)>,
    pub tape: Vec<[f64; 4]>,
}

/// `ground.paper`'s drawn fields (Look `look@1`: paper).
#[derive(Clone, Debug, PartialEq)]
pub struct Paper {
    pub role: String,
    pub tooth: Option<Tooth>,
    pub age: Age,
    pub anchor: Anchor,
    pub zoom: Zoom,
}

fn age(a: &Map<String, Value>) -> Result<Age, Refused> {
    let path = "ground/params/age";
    let pair = |name: &str, x: &str, y: &str| -> Result<Option<(f64, f64)>, Refused> {
        let at = format!("{path}/{name}");
        Ok(match object(a.get(name), &at)? {
            None => None,
            Some(m) => Some((number(m, x, 0.0, &at)?, number(m, y, 0.0, &at)?)),
        })
    };
    let stains = match object(a.get("stains"), &format!("{path}/stains"))? {
        None => None,
        Some(s) => {
            let at = format!("{path}/stains");
            Some((
                number(s, "count", 0.0, &at)? as u32,
                number(s, "size", 40.0, &at)?,
                role(s, "role", &at)?.unwrap_or_else(|| "ink".to_string()),
            ))
        }
    };
    let tarnish = match object(a.get("tarnish"), &format!("{path}/tarnish"))? {
        None => None,
        Some(t) => {
            let at = format!("{path}/tarnish");
            let mut ramp = Vec::new();
            for r in t
                .get("ramp")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(r) = r.as_str() else {
                    return bad(format!("{at}/ramp"));
                };
                if is_status_role(r) {
                    return Err(Refused {
                        code: "status_role",
                        path: format!("{at}/ramp: {r}"),
                    });
                }
                ramp.push(r.to_string());
            }
            Some((ramp, number(t, "width", 8.0, &at)?))
        }
    };
    let tape = a
        .get("tape")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|r| {
            let r = r.as_array()?;
            Some([
                r.first()?.as_f64()?,
                r.get(1)?.as_f64()?,
                r.get(2)?.as_f64()?,
                r.get(3)?.as_f64()?,
            ])
        })
        .collect();
    Ok(Age {
        folds: number(a, "folds", 0.0, path)?,
        creases: number(a, "creases", 0.0, path)?,
        stains,
        foxing: number(a, "foxing", 0.0, path)?,
        plate_mark: pair("plate_mark", "inset", "depth")?,
        craquelure: pair("craquelure", "scale", "amount")?,
        tarnish,
        tape,
    })
}

/// A look's paper, when its ground is one with a tooth, age or a declared anchor.
pub fn paper(look: &Map<String, Value>) -> Result<Option<Paper>, Refused> {
    let Some(g) = object(look.get("ground"), "ground")? else {
        return Ok(None);
    };
    if g.get("kind").and_then(Value::as_str) != Some("paper") {
        return Ok(None);
    }
    let path = "ground/params";
    let Some(p) = object(g.get("params"), path)? else {
        return Ok(None);
    };
    let tooth = match object(p.get("tooth"), "ground/params/tooth")? {
        None => None,
        Some(t) => {
            let at = "ground/params/tooth";
            let kind = text(t, "kind", at)?.unwrap_or("cold_press");
            let Some(kind) = TEETH.iter().position(|k| *k == kind) else {
                return bad(format!("{at}/kind"));
            };
            Some(Tooth {
                kind: kind as u32,
                scale: number(t, "scale", 4.0, at)?,
                depth: unit(t, "depth", 0.5, at)?,
                from: text(t, "from", at)?.map(str::to_string),
                seed: seed(t, at)?,
            })
        }
    };
    let age = match object(p.get("age"), "ground/params/age")? {
        None => Age::default(),
        Some(a) => age(a)?,
    };
    if tooth.is_none() && age == Age::default() && !p.contains_key("anchor") {
        return Ok(None);
    }
    Ok(Some(Paper {
        role: role(p, "role", path)?.unwrap_or_else(|| "ground".to_string()),
        tooth,
        age,
        anchor: choice(
            p,
            "anchor",
            Anchor::World,
            &[
                ("page", Anchor::Page),
                ("sheet", Anchor::Sheet),
                ("world", Anchor::World),
                ("frame", Anchor::Frame),
            ],
            path,
        )?,
        zoom: choice(
            p,
            "zoom",
            Zoom::CrossfadeOctaves,
            &[
                ("crossfade_octaves", Zoom::CrossfadeOctaves),
                ("fade_fine", Zoom::FadeFine),
            ],
            path,
        )?,
    }))
}

/// A line's profile (Look `look@1`: line profiles).
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub taper_in: f64,
    pub taper_out: f64,
    pub swell: f64,
    pub flick: f64,
    pub overshoot: f64,
    /// `(every, gap)` in px.
    pub breaks: Option<(f64, f64)>,
    /// `(offset px, opacity)`.
    pub double: Option<(f64, f64)>,
    pub dry_tail: f64,
    pub seed: u64,
}

/// A look's named line, as far as a drawn look reads it.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub width: Option<f64>,
    pub opacity: f64,
    pub profile: Option<Profile>,
    pub dry: f64,
    /// `None` draws at full pressure, past the tooth.
    pub pressure: Option<f64>,
}

fn profile(m: &Map<String, Value>, path: &str) -> Result<Profile, Refused> {
    let breaks = match object(m.get("breaks"), &format!("{path}/breaks"))? {
        None => None,
        Some(b) => {
            let at = format!("{path}/breaks");
            Some((number(b, "every", 40.0, &at)?, number(b, "gap", 4.0, &at)?))
        }
    };
    let double = match object(m.get("double"), &format!("{path}/double"))? {
        None => None,
        Some(d) => {
            let at = format!("{path}/double");
            Some((
                number(d, "offset", 1.0, &at)?,
                unit(d, "opacity", 0.5, &at)?,
            ))
        }
    };
    Ok(Profile {
        taper_in: unit(m, "taper_in", 0.0, path)?,
        taper_out: unit(m, "taper_out", 0.0, path)?,
        swell: number(m, "swell", 0.0, path)?,
        flick: number(m, "flick", 0.0, path)?,
        overshoot: number(m, "overshoot", 0.0, path)?,
        breaks,
        double,
        dry_tail: unit(m, "dry_tail", 0.0, path)?,
        seed: seed(m, path)?,
    })
}

/// A look's line `name` in `look`.
pub fn line(look: &Map<String, Value>, name: &str) -> Result<Option<Line>, Refused> {
    let path = format!("lines/{name}");
    let Some(l) = look.get("lines").and_then(|m| m.get(name)) else {
        return Ok(None);
    };
    let Value::Object(l) = l else {
        return bad(path);
    };
    if let Some(r) = text(l, "role", &path)? {
        if is_status_role(r) {
            return Err(Refused {
                code: "status_role",
                path: format!("{path}/role: {r}"),
            });
        }
    }
    let profile = match object(l.get("profile"), &format!("{path}/profile"))? {
        None => None,
        Some(p) => Some(profile(p, &format!("{path}/profile"))?),
    };
    Ok(Some(Line {
        width: l.get("width").and_then(Value::as_f64),
        opacity: unit(l, "opacity", 1.0, &path)?,
        profile,
        dry: unit(l, "dry", 0.0, &path)?,
        pressure: l
            .contains_key("pressure")
            .then(|| unit(l, "pressure", 1.0, &path))
            .transpose()?,
    }))
}

/// Every drawn field of a look, read once: a look that fails here is refused.
pub fn check(look: &Map<String, Value>) -> Result<(), Refused> {
    light(look)?;
    paper(look)?;
    for name in look
        .get("lines")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.keys())
    {
        line(look, name)?;
    }
    for (name, f) in look
        .get("fills")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !f.is_object() {
            return bad(format!("fills/{name}"));
        }
        fill(look, name)?;
    }
    strokes(look)?;
    Ok(())
}

/// `ink {…}`: printed ink (Look `look@1`: drawn fills).
#[derive(Clone, Debug, PartialEq)]
pub struct Ink {
    pub coverage: f64,
    /// `(scale px, amount)`.
    pub starve: (f64, f64),
    pub pinholes: f64,
    /// `(angle, density)`.
    pub streaks: (f64, f64),
    pub spread: f64,
    /// 0 clean, 1 squeezed, 2 ragged.
    pub edge: u32,
}

/// `wash {…}`: watercolor.
#[derive(Clone, Debug, PartialEq)]
pub struct Wash {
    pub pool: f64,
    pub granulation: f64,
    /// `(count, size px)`.
    pub blooms: (f64, f64),
    pub bleed: f64,
    pub wet_in_wet: bool,
    pub oversize: f64,
    /// The collection whose items resist it.
    pub resist: Option<String>,
}

/// `spatter {…}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Spatter {
    pub dot: (f64, f64),
    pub density: f64,
    pub angle: f64,
    pub shadow_only: bool,
}

/// One band of hatching by tone.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Band {
    pub below: f64,
    pub passes: u32,
    pub cross: bool,
}

/// `hatch {…}`.
#[derive(Clone, Debug, PartialEq)]
pub struct Hatch {
    pub angle: f64,
    pub gap: f64,
    pub width: f64,
    pub cross: bool,
    /// 0 none, 1 outline, 2 field.
    pub follow: u32,
    pub by_tone: Vec<Band>,
    /// `(dot px, density)`.
    pub stipple: Option<(f64, f64)>,
    pub min_width: f64,
}

/// A fill's own kind.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Flat,
    Ink(Ink),
    Wash(Wash),
    Spatter(Spatter),
    Hatch(Hatch),
}

/// `offset {dx, dy, oversize, seed}`, on any fill.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Offset {
    pub dx: f64,
    pub dy: f64,
    pub oversize: f64,
    pub seed: u64,
}

/// A look's named fill.
#[derive(Clone, Debug, PartialEq)]
pub struct Fill {
    pub kind: Kind,
    pub offset: Option<Offset>,
    pub pressure: Option<f64>,
    pub seed: u64,
}

fn pair(
    m: &Map<String, Value>,
    name: &str,
    x: &str,
    y: &str,
    or: (f64, f64),
    path: &str,
) -> Result<(f64, f64), Refused> {
    let at = format!("{path}/{name}");
    Ok(match object(m.get(name), &at)? {
        None => or,
        Some(p) => (number(p, x, or.0, &at)?, number(p, y, or.1, &at)?),
    })
}

/// A look's fill `name`; a kind this module doesn't draw (gradient, halftone, paper) reads as flat.
pub fn fill(look: &Map<String, Value>, name: &str) -> Result<Option<Fill>, Refused> {
    let path = format!("fills/{name}");
    let Some(f) = look.get("fills").and_then(|m| m.get(name)) else {
        return Ok(None);
    };
    let Value::Object(f) = f else {
        return bad(path);
    };
    role(f, "role", &path)?;
    let kind = match text(f, "kind", &path)? {
        Some("ink") => Kind::Ink(Ink {
            coverage: unit(f, "coverage", 1.0, &path)?,
            starve: pair(f, "starve", "scale", "amount", (40.0, 0.0), &path)?,
            pinholes: unit(f, "pinholes", 0.0, &path)?,
            streaks: pair(f, "streaks", "angle", "density", (0.0, 0.0), &path)?,
            spread: number(f, "spread", 0.0, &path)?,
            edge: choice(
                f,
                "edge",
                0,
                &[("clean", 0), ("squeezed", 1), ("ragged", 2)],
                &path,
            )?,
        }),
        Some("wash") => Kind::Wash(Wash {
            pool: unit(f, "pool", 0.0, &path)?,
            granulation: unit(f, "granulation", 0.0, &path)?,
            blooms: pair(f, "blooms", "count", "size", (0.0, 60.0), &path)?,
            bleed: number(f, "bleed", 0.0, &path)?,
            wet_in_wet: f.get("wet_in_wet") == Some(&Value::Bool(true)),
            oversize: between(f, "oversize", 0.0, (0.0, 0.5), &path)?,
            resist: match object(f.get("resist"), &format!("{path}/resist"))? {
                None => None,
                Some(r) => text(r, "by", &format!("{path}/resist"))?.map(str::to_string),
            },
        }),
        Some("spatter") => {
            let dot = f
                .get("dot")
                .and_then(Value::as_array)
                .and_then(|d| Some((d.first()?.as_f64()?, d.get(1)?.as_f64()?)));
            Kind::Spatter(Spatter {
                dot: dot.unwrap_or((1.0, 3.0)),
                density: unit(f, "density", 0.2, &path)?,
                angle: number(f, "angle", 0.0, &path)?,
                shadow_only: choice(
                    f,
                    "where",
                    false,
                    &[("all", false), ("shadow", true)],
                    &path,
                )?,
            })
        }
        Some("hatch") => {
            let mut by_tone = Vec::new();
            for (i, b) in f
                .get("by_tone")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let at = format!("{path}/by_tone/{i}");
                let Value::Object(b) = b else { return bad(at) };
                by_tone.push(Band {
                    below: unit(b, "below", 1.0, &at)?,
                    passes: number(b, "passes", 1.0, &at)? as u32,
                    cross: b.get("cross") == Some(&Value::Bool(true)),
                });
            }
            Kind::Hatch(Hatch {
                angle: number(f, "angle", 45.0, &path)?,
                gap: number(f, "gap", 4.0, &path)?,
                width: number(f, "width", 1.0, &path)?,
                cross: f.get("cross") == Some(&Value::Bool(true)),
                follow: choice(
                    f,
                    "follow",
                    0,
                    &[("none", 0), ("outline", 1), ("field", 2)],
                    &path,
                )?,
                by_tone,
                stipple: match object(f.get("stipple"), &format!("{path}/stipple"))? {
                    None => None,
                    Some(s) => {
                        let at = format!("{path}/stipple");
                        Some((number(s, "dot", 1.0, &at)?, unit(s, "density", 0.3, &at)?))
                    }
                },
                min_width: number(f, "min_width", 0.0, &path)?,
            })
        }
        _ => Kind::Flat,
    };
    let offset = match object(f.get("offset"), &format!("{path}/offset"))? {
        None => None,
        Some(o) => {
            let at = format!("{path}/offset");
            Some(Offset {
                dx: number(o, "dx", 0.0, &at)?,
                dy: number(o, "dy", 0.0, &at)?,
                oversize: between(o, "oversize", 0.0, (0.0, 0.5), &at)?,
                seed: seed(o, &at)?,
            })
        }
    };
    Ok(Some(Fill {
        kind,
        offset,
        pressure: f
            .contains_key("pressure")
            .then(|| unit(f, "pressure", 1.0, &path))
            .transpose()?,
        seed: seed(f, &path)?,
    }))
}

/// `strokes {…}` (Look `look@1`: strokes on surfaces).
#[derive(Clone, Debug, PartialEq)]
pub struct Strokes {
    /// The collection they land on, or every item.
    pub on: Option<String>,
    /// Strokes per px² at design size.
    pub density: f64,
    pub size: (f64, f64),
    /// The palette's roles.
    pub palette: Vec<String>,
    pub layers: u32,
    pub dry: f64,
}

/// A look's `strokes`, or `None`.
pub fn strokes(look: &Map<String, Value>) -> Result<Option<Strokes>, Refused> {
    let Some(s) = object(look.get("strokes"), "strokes")? else {
        return Ok(None);
    };
    let path = "strokes";
    let mut palette = Vec::new();
    for roles in s
        .get("palette")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
    {
        for r in roles
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if is_status_role(r) {
                return Err(Refused {
                    code: "status_role",
                    path: format!("{path}/palette: {r}"),
                });
            }
            palette.push(r.to_string());
        }
    }
    let size = s
        .get("size")
        .and_then(Value::as_array)
        .and_then(|d| Some((d.first()?.as_f64()?, d.get(1)?.as_f64()?)));
    Ok(Some(Strokes {
        on: text(s, "on", path)?
            .filter(|o| *o != "all")
            .map(str::to_string),
        density: number(s, "density", 0.002, path)?,
        size: size.unwrap_or((8.0, 20.0)),
        palette,
        layers: between(s, "layers", 1.0, (1.0, 3.0), path)? as u32,
        dry: unit(s, "dry", 0.0, path)?,
    }))
}

/// `noise {…}`, a fill kind of Paint (Paint: noise fill), as evaluated at t.
#[derive(Clone, Debug, PartialEq)]
pub struct Noise {
    /// 0 fractal, 1 turbulent, 2 cells, 3 value.
    pub kind: u32,
    pub scale: f64,
    pub aspect: f64,
    pub octaves: u32,
    pub roughness: f64,
    pub contrast: f64,
    pub brightness: f64,
    pub offset: [f64; 2],
    pub rotation: f64,
    /// Turns of evolution, wrapped into the cycle when it names one.
    pub turns: f64,
    /// The turns the phase loops after; 0 for none.
    pub cycle: u32,
    /// `(at, role)`.
    pub stops: Vec<(f64, String)>,
    pub frame_anchored: bool,
    pub seed: u64,
}

/// The most stops a ramp takes, and octaves a noise sums.
pub const MAX_STOPS: usize = 8;
pub const MAX_OCTAVES: f64 = 8.0;

/// A paint's `noise` at `path`.
pub fn noise(n: &Map<String, Value>, path: &str) -> Result<Noise, Refused> {
    let mut stops = Vec::new();
    for (i, s) in n
        .get("stops")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let at = format!("{path}/stops/{i}");
        let Value::Object(s) = s else { return bad(at) };
        let Some(r) = text(s, "role", &at)? else {
            return bad(format!("{at}/role"));
        };
        stops.push((unit(s, "at", 0.0, &at)?, r.to_string()));
    }
    if stops.is_empty() || stops.len() > MAX_STOPS {
        return Err(Refused {
            code: "out_of_range",
            path: format!("{path}/stops"),
        });
    }
    let cycle = match n.get("cycle") {
        None | Some(Value::Null) => 0,
        Some(Value::String(s)) if s == "none" => 0,
        Some(v) => match v.as_u64() {
            Some(c) if c <= u64::from(u16::MAX) => c as u32,
            _ => return bad(format!("{path}/cycle")),
        },
    };
    let turns = number(n, "evolution", 0.0, path)? / 360.0;
    let offset = n
        .get("offset")
        .and_then(Value::as_array)
        .and_then(|o| Some([o.first()?.as_f64()?, o.get(1)?.as_f64()?]));
    Ok(Noise {
        kind: choice(
            n,
            "kind",
            0,
            &[("fractal", 0), ("turbulent", 1), ("cells", 2), ("value", 3)],
            path,
        )?,
        scale: number(n, "scale", 100.0, path)?,
        aspect: number(n, "aspect", 1.0, path)?,
        octaves: between(n, "octaves", 6.0, (1.0, MAX_OCTAVES), path)? as u32,
        roughness: unit(n, "roughness", 0.5, path)?,
        contrast: number(n, "contrast", 1.0, path)?,
        brightness: number(n, "brightness", 0.0, path)?,
        offset: offset.unwrap_or([0.0, 0.0]),
        rotation: number(n, "rotation", 0.0, path)?,
        turns: if cycle > 0 {
            turns.rem_euclid(f64::from(cycle))
        } else {
            turns
        },
        cycle,
        stops,
        frame_anchored: choice(
            n,
            "anchor",
            false,
            &[("world", false), ("frame", true)],
            path,
        )?,
        seed: seed(n, path)?,
    })
}

/// A look's drawn fields as read for one document size: what a frame's marks take from it.
#[derive(Clone, Debug, PartialEq)]
pub struct Look {
    pub def: Map<String, Value>,
    pub light: Option<Light>,
    pub paper: Option<Paper>,
    pub strokes: Option<Strokes>,
}

impl Look {
    /// `def`, with its `fw` and `fh` literals already lowered.
    pub fn read(def: &Map<String, Value>) -> Result<Look, Refused> {
        check(def)?;
        Ok(Look {
            def: def.clone(),
            light: light(def)?,
            paper: paper(def)?,
            strokes: strokes(def)?,
        })
    }

    pub fn line(&self, name: &str) -> Result<Option<Line>, Refused> {
        line(&self.def, name)
    }

    pub fn fill(&self, name: &str) -> Result<Option<Fill>, Refused> {
        fill(&self.def, name)
    }
}
