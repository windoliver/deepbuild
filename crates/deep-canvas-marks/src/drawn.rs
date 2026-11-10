//! A drawn look over a frame's marks (issue #149; canvas primitives: Look `look@1`: light; paper;
//! line profiles; drawn fills; strokes on surfaces; Paint: noise fill). The marks an item draws go
//! in as plain outlines and come out dressed: named fills and lines resolved, line weight and
//! profiles in their widths, rims and cast shadows as extra fills from evaluated geometry, and a
//! [`Medium`] on each fill or line that needs the drawn pass, as an effect on a one-item scope.
//! Everything here is a pure function of the evaluated item, the look and seeds from IDs.

use std::sync::Arc;

use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
use deep_canvas::grammar::lower_frame_literals;
use deep_canvas_drawn::geometry::{self, seeded, Outline};
use deep_canvas_drawn::medium::{Dabs, Kind, Lamp, Medium};
use deep_canvas_drawn::spec::{self, Look, Toward};
use serde_json::{json, Map, Value};

use crate::paint::Profile;
use crate::path::Verb;
use crate::scene::{
    along_alphas, bounds_of, object_or_empty, Effect, Fill, GroupPass, Line, Mark, Palette,
    Refused, Rgb, Scope,
};

/// What the marks read of a document's 2D camera, evaluated at t (the camera in 2D: a world point
/// lands at `(p − target) × k + center`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct View {
    pub target: [f64; 2],
    pub k: f64,
    pub center: [f64; 2],
}

impl View {
    pub const NONE: View = View {
        target: [0.0, 0.0],
        k: 1.0,
        center: [0.0, 0.0],
    };

    /// The affine from a pixel to the world: `(scale, offset)`.
    pub fn to_world(&self) -> (f64, [f64; 2]) {
        let s = 1.0 / self.k;
        (
            s,
            [
                self.target[0] - self.center[0] * s,
                self.target[1] - self.center[1] * s,
            ],
        )
    }
}

fn is_3d(item: &Value) -> bool {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    kind.starts_with("mark.") || kind.starts_with("light.")
}

/// The camera of a document with no 3D item, at t; `None` for any other document. It takes the
/// camera out of `items`, since from here on a 2D film is all there is to draw.
pub fn view_of(doc: &Map<String, Value>, items: &mut Map<String, Value>) -> Option<View> {
    let id = doc.get("camera")?.as_str()?;
    if items.values().any(is_3d) {
        return None;
    }
    let camera = items.get(id)?;
    let params = object_or_empty(camera.get("params"));
    if params.get("projection").and_then(Value::as_str) != Some("orthographic") {
        return None;
    }
    let target = params.get("target")?.as_array()?;
    let size = doc.get("size")?.as_array()?;
    let (w, h) = (size.first()?.as_f64()?, size.get(1)?.as_f64()?);
    let view_width = params.get("view_width")?.as_f64().filter(|v| *v > 0.0)?;
    let view = View {
        target: [target.first()?.as_f64()?, target.get(1)?.as_f64()?],
        k: w / view_width,
        center: [w / 2.0, h / 2.0],
    };
    items.retain(|_, i| i.get("kind").and_then(Value::as_str) != Some("camera@1"));
    Some(view)
}

/// Every item through the camera: its place scaled and moved, its stroke scaling with it.
pub fn through(view: &View, items: &mut Map<String, Value>) {
    for item in items.values_mut() {
        let at = object_or_empty(item.get("at")).clone();
        let pos = at.get("pos").and_then(Value::as_array);
        let p = |i: usize| {
            pos.and_then(|p| p.get(i))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        };
        let scale = at.get("scale").and_then(Value::as_array);
        let s = |i: usize| {
            scale
                .and_then(|s| s.get(i))
                .and_then(Value::as_f64)
                .unwrap_or(1.0)
        };
        let moved = [
            (p(0) - view.target[0]) * view.k + view.center[0],
            (p(1) - view.target[1]) * view.k + view.center[1],
        ];
        let mut at = at.clone();
        at.insert("pos".into(), json!([moved[0], moved[1], p(2)]));
        at.insert("scale".into(), json!([s(0) * view.k, s(1) * view.k, s(2)]));
        item["at"] = Value::Object(at);
        if let Some(stroke) = item
            .pointer_mut("/params/paint/stroke")
            .and_then(Value::as_object_mut)
        {
            stroke.insert("scale_stroke".into(), json!(true));
        }
    }
}

/// A look@1 object read for a document of `size`, its `fw` and `fh` literals converted.
pub fn read_look(def: &Value, size: [f64; 2]) -> Result<Option<Arc<Look>>, Refused> {
    let mut lowered = def.clone();
    lower_frame_literals(&mut lowered, (size[0] as u32, size[1] as u32));
    let Value::Object(map) = &lowered else {
        return Ok(None);
    };
    Look::read(map).map(|l| Some(Arc::new(l))).map_err(refused)
}

fn refused(r: spec::Refused) -> Refused {
    Refused {
        code: r.code,
        path: r.path,
    }
}

/// The curve steps a flattened outline takes per cubic or quadratic.
const STEPS: usize = 48;

/// `verbs` flattened, one outline per sub-path.
pub fn outlines(verbs: &[Verb]) -> Vec<Outline> {
    let mut out: Vec<Outline> = Vec::new();
    let mut at = [0.0, 0.0];
    let lerp =
        |a: [f64; 2], b: [f64; 2], t: f64| [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for v in verbs {
        match *v {
            Verb::Move(p) => {
                out.push(Outline {
                    points: vec![p],
                    closed: false,
                });
                at = p;
            }
            Verb::Line(p) => {
                if let Some(o) = out.last_mut() {
                    o.points.push(p);
                }
                at = p;
            }
            Verb::Quad(c, p) => {
                if let Some(o) = out.last_mut() {
                    for k in 1..=STEPS {
                        let t = k as f64 / STEPS as f64;
                        o.points.push(lerp(lerp(at, c, t), lerp(c, p, t), t));
                    }
                }
                at = p;
            }
            Verb::Cubic(a, b, p) => {
                if let Some(o) = out.last_mut() {
                    for k in 1..=STEPS {
                        let t = k as f64 / STEPS as f64;
                        let (ab, bc, cd) = (lerp(at, a, t), lerp(a, b, t), lerp(b, p, t));
                        o.points.push(lerp(lerp(ab, bc, t), lerp(bc, cd, t), t));
                    }
                }
                at = p;
            }
            Verb::Close => {
                if let Some(o) = out.last_mut() {
                    o.closed = true;
                    // A closing point that repeats the first adds no segment.
                    if o.points.len() > 1 && o.points.first() == o.points.last() {
                        o.points.pop();
                    }
                }
            }
        }
    }
    out
}

fn polyline(o: &Outline) -> Vec<Verb> {
    let mut verbs = Vec::with_capacity(o.points.len() + 1);
    for (i, p) in o.points.iter().enumerate() {
        verbs.push(if i == 0 {
            Verb::Move(*p)
        } else {
            Verb::Line(*p)
        });
    }
    if o.closed {
        verbs.push(Verb::Close);
    }
    verbs
}

fn moved(verbs: &[Verb], f: impl Fn([f64; 2]) -> [f64; 2]) -> Vec<Verb> {
    verbs
        .iter()
        .map(|v| match *v {
            Verb::Move(p) => Verb::Move(f(p)),
            Verb::Line(p) => Verb::Line(f(p)),
            Verb::Quad(a, b) => Verb::Quad(f(a), f(b)),
            Verb::Cubic(a, b, c) => Verb::Cubic(f(a), f(b), f(c)),
            Verb::Close => Verb::Close,
        })
        .collect()
}

/// The members of collection `name` in `doc`.
pub fn members<'a>(doc: &'a Map<String, Value>, name: &str) -> Vec<&'a str> {
    doc.get("collections")
        .and_then(|c| c.get(name))
        .and_then(|c| c.get("members"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

/// The fnv hash of an ID, the item's seed.
fn seed_of(id: &str, seed: u64) -> u32 {
    (seeded(seed, id, 0) * f64::from(u32::MAX)) as u32
}

/// The center of an item as it draws, for a lamp and a rim's `toward`.
fn center_of(item: &Value) -> [f64; 2] {
    let params = object_or_empty(item.get("params"));
    let local = match (params.get("center"), params.get("box")) {
        (Some(Value::Array(c)), _) => [
            c.first().and_then(Value::as_f64).unwrap_or(0.0),
            c.get(1).and_then(Value::as_f64).unwrap_or(0.0),
        ],
        (_, Some(Value::Array(b))) => {
            let n = |i: usize| b.get(i).and_then(Value::as_f64).unwrap_or(0.0);
            [n(0) + n(2) / 2.0, n(1) + n(3) / 2.0]
        }
        _ => [0.0, 0.0],
    };
    let at = object_or_empty(item.get("at"));
    let pos = at.get("pos").and_then(Value::as_array);
    let scale = at.get("scale").and_then(Value::as_array);
    let v = |list: Option<&Vec<Value>>, i: usize, or: f64| {
        list.and_then(|p| p.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(or)
    };
    [
        local[0] * v(scale, 0, 1.0) + v(pos, 0, 0.0),
        local[1] * v(scale, 1, 1.0) + v(pos, 1, 0.0),
    ]
}

/// What dressing an item reads of its frame.
pub struct Dress<'a> {
    pub look: &'a Look,
    pub doc: &'a Map<String, Value>,
    pub items: &'a Map<String, Value>,
    pub palette: &'a Palette,
    /// Whether the plant keeps only a look's first rim.
    pub first_rim: bool,
    /// Whether the plant draws every ink fill flat.
    pub flat_ink: bool,
}

fn role_color(palette: &Palette, name: &str, path: &str) -> Result<Rgb, Refused> {
    palette.get(name).copied().ok_or(Refused {
        code: "role_unresolved",
        path: format!("{path}: {name}"),
    })
}

fn unit(c: Rgb) -> [f64; 3] {
    c.map(|v| f64::from(v) / 255.0)
}

fn medium_scope(id: &str, tag: &str, medium: Medium) -> Scope {
    Scope::Opacity {
        item: format!("{id}#{tag}"),
        alpha: 1.0,
        blend: None,
        effect: Some(Arc::new(Effect {
            medium: Some(Arc::new(medium)),
            ..Effect::default()
        })),
    }
}

/// A soft edge: a shipped blur pass of `radius` px on the marks inside.
fn blur_scope(id: &str, tag: &str, radius: f64) -> Scope {
    let mut params = Map::new();
    params.insert("radius".into(), json!(radius));
    Scope::Opacity {
        item: format!("{id}#{tag}"),
        alpha: 1.0,
        blend: None,
        effect: Some(Arc::new(Effect {
            passes: vec![GroupPass {
                op: "blur@1".into(),
                item: None,
                params,
                grow: Some(radius * 3.0),
            }],
            ..Effect::default()
        })),
    }
}

/// A ramp's stops as 16 sRGB-encoded colors, mixed in OKLab.
fn ramp(palette: &Palette, noise: &spec::Noise, path: &str) -> Result<Vec<[f64; 3]>, Refused> {
    let mut stops = noise
        .stops
        .iter()
        .map(|(at, r)| {
            let [red, g, b] = unit(role_color(palette, r, &format!("{path}/stops"))?);
            Ok((*at, srgb_to_oklab(Srgb { r: red, g, b })))
        })
        .collect::<Result<Vec<(f64, Oklab)>, Refused>>()?;
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    Ok((0..16)
        .map(|i| {
            let t = f64::from(i) / 15.0;
            let k = stops
                .partition_point(|(at, _)| *at <= t)
                .clamp(1, stops.len().max(2) - 1);
            let (a, b) = match stops.len() {
                1 => (stops[0], stops[0]),
                _ => (stops[k - 1], stops[k]),
            };
            let f = if b.0 > a.0 {
                ((t - a.0) / (b.0 - a.0)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let mix = |x: f64, y: f64| x + (y - x) * f;
            let c = oklab_to_srgb(Oklab {
                l: mix(a.1.l, b.1.l),
                a: mix(a.1.a, b.1.a),
                b: mix(a.1.b, b.1.b),
            });
            [c.r, c.g, c.b].map(|v| v.clamp(0.0, 1.0))
        })
        .collect())
}

/// The lamps of a look's backlit screen, as evaluated at t.
fn lamps(d: &Dress<'_>, back: &spec::Back) -> Result<Vec<Lamp>, Refused> {
    lamps_of(back, d.items, d.palette)
}

/// The lamps of `look`'s backlit screen among `items`; none for a look with no screen.
pub fn screen_lamps(
    look: &Look,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Vec<Lamp>, Refused> {
    match look.light.as_ref().and_then(|l| l.back.as_ref()) {
        Some(back) => lamps_of(back, items, palette),
        None => Ok(Vec::new()),
    }
}

fn lamps_of(
    back: &spec::Back,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Vec<Lamp>, Refused> {
    let mut out = Vec::new();
    for id in &back.lamps {
        let Some(item) = items.get(id) else {
            continue;
        };
        let paint = object_or_empty(item.pointer("/params/paint/fill"));
        let role = paint
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("ground");
        let path = format!("items/{id}/params/paint/fill/role");
        out.push(Lamp {
            at: center_of(item),
            color: unit(role_color(palette, role, &path)?),
        });
    }
    Ok(out)
}

/// The transmission of the first of `back`'s collections `id` sits in.
fn transmission(d: &Dress<'_>, back: &spec::Back, id: &str) -> Option<f64> {
    back.transmission
        .iter()
        .find(|(c, _)| members(d.doc, c).contains(&id))
        .map(|(_, t)| *t)
}

/// The medium a fill of `id` draws through, for a 3D surface's pass; `None` when it's plain.
pub fn surface_medium(
    d: &Dress<'_>,
    id: &str,
    paint: &Map<String, Value>,
    color: [f64; 3],
) -> Result<Option<Medium>, Refused> {
    let path = format!("items/{id}/params/paint");
    let fill = paint.get("fill").and_then(Value::as_object);
    let (m, _) = fill_medium(d, id, fill, color, [0.0; 4], &path)?;
    Ok((m.kind != Kind::Plain || m.pressure.is_some()).then_some(m))
}

/// The medium of `look`'s strokes on `id`, when they land on it.
pub fn strokes_medium(
    d: &Dress<'_>,
    id: &str,
    bounds: [f64; 4],
) -> Result<Option<Medium>, Refused> {
    let Some(s) = &d.look.strokes else {
        return Ok(None);
    };
    let on =
        s.on.as_deref()
            .is_none_or(|c| members(d.doc, c).contains(&id));
    if !on || s.palette.is_empty() {
        return Ok(None);
    }
    // A stroke's palette names the look's palette, as a role does.
    let named = |name: &str| -> Option<[f64; 3]> {
        let hex = d
            .look
            .def
            .get("palette")?
            .get(name)?
            .as_str()?
            .strip_prefix('#')?;
        let byte = |i: usize| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok();
        Some(unit([byte(0)?, byte(2)?, byte(4)?]))
    };
    let palette = s
        .palette
        .iter()
        .map(|r| match named(r) {
            Some(c) => Ok(c),
            None => role_color(d.palette, r, "strokes/palette").map(unit),
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some(Medium {
        kind: Kind::Strokes(Dabs {
            density: s.density,
            size: s.size,
            palette,
            layers: s.layers,
        }),
        color: [1.0; 3],
        pressure: None,
        dry: s.dry,
        seed: seed_of(id, d.doc.get("seed").and_then(Value::as_u64).unwrap_or(0)),
        bounds,
        resist: Vec::new(),
    }))
}

/// A fill's medium and how far past its shape it draws: `(medium, oversize, offset)`.
fn fill_medium(
    d: &Dress<'_>,
    id: &str,
    fill: Option<&Map<String, Value>>,
    color: [f64; 3],
    bounds: [f64; 4],
    path: &str,
) -> Result<(Medium, Option<spec::Fill>), Refused> {
    let seed = seed_of(id, d.doc.get("seed").and_then(Value::as_u64).unwrap_or(0));
    let named = fill.and_then(|f| f.get("fill")).and_then(Value::as_str);
    let def = match named {
        Some(name) => Some(d.look.fill(name).map_err(refused)?.ok_or(Refused {
            code: "fill_unresolved",
            path: format!("{path}/fill/fill: {name}"),
        })?),
        None => None,
    };
    let mut medium = Medium {
        kind: Kind::Plain,
        color,
        pressure: None,
        dry: 0.0,
        seed,
        bounds,
        resist: Vec::new(),
    };
    if let Some(def) = &def {
        medium.pressure = def.pressure;
        medium.seed ^= def.seed as u32;
        match &def.kind {
            spec::Kind::Flat => {}
            spec::Kind::Ink(_) if d.flat_ink => {}
            spec::Kind::Ink(i) => medium.kind = Kind::Ink(i.clone()),
            spec::Kind::Wash(w) => {
                if let Some(c) = &w.resist {
                    medium.resist = members(d.doc, c).iter().map(|m| m.to_string()).collect();
                }
                medium.kind = Kind::Wash(w.clone());
            }
            spec::Kind::Spatter(s) => medium.kind = Kind::Spatter(s.clone()),
            spec::Kind::Hatch(h) => medium.kind = Kind::Hatch(h.clone()),
        }
    }
    if let Some(Value::Object(n)) = fill.and_then(|f| f.get("noise")) {
        let at = format!("{path}/fill/noise");
        let noise = spec::noise(n, &at).map_err(refused)?;
        medium.seed = seed_of(id, noise.seed);
        let ramp = ramp(d.palette, &noise, &at)?;
        medium.kind = Kind::Noise(noise, ramp);
    }
    // #1646: a dither fill takes its stops' colors as they are, never mixed.
    if let Some(Value::Object(n)) = fill.and_then(|f| f.get("dither")) {
        let at = format!("{path}/fill/dither");
        let dither = spec::dither(n, &at).map_err(refused)?;
        let stops = dither
            .stops
            .iter()
            .map(|r| role_color(d.palette, r, &format!("{at}/stops")).map(unit))
            .collect::<Result<Vec<_>, _>>()?;
        medium.kind = Kind::Dither(dither, stops);
    }
    Ok((medium, def))
}

/// A dressed mark: the mark, and the scopes it draws inside beyond the item's own.
pub type Dressed = (Mark, Vec<Scope>);

/// `marks`, what item `id` draws, dressed by the look. Only the item's own outlines dress; any
/// other mark goes through as it is.
pub fn dress(
    d: &Dress<'_>,
    id: &str,
    paint: &Map<String, Value>,
    marks: Vec<Mark>,
) -> Result<Vec<Dressed>, Refused> {
    let path = format!("items/{id}/params/paint");
    let mut out = Vec::new();
    let light = d.look.light.as_ref();
    let back = light.and_then(|l| l.back.as_ref());
    let lit_scope = match back {
        Some(b) => match transmission(d, b, id) {
            Some(t) => {
                let lamps = lamps(d, b)?;
                (!lamps.is_empty()).then(|| {
                    medium_scope(
                        id,
                        "lit",
                        Medium {
                            kind: Kind::Lit {
                                transmission: t,
                                lamps,
                            },
                            color: [0.0; 3],
                            pressure: None,
                            dry: 0.0,
                            seed: 0,
                            bounds: [0.0; 4],
                            resist: Vec::new(),
                        },
                    )
                })
            }
            None => None,
        },
        None => None,
    };
    let lit: Vec<Scope> = lit_scope.into_iter().collect();
    for mark in marks {
        let Mark::Shape {
            item,
            verbs,
            fill,
            stroke,
        } = mark
        else {
            out.push((mark, lit.clone()));
            continue;
        };
        if item != id {
            out.push((
                Mark::Shape {
                    item,
                    verbs,
                    fill,
                    stroke,
                },
                lit.clone(),
            ));
            continue;
        }
        let parts = outlines(&verbs);
        let bounds = bounds_of(&verbs);
        if let Some(cast) = light.and_then(|l| l.cast.as_ref()) {
            if fill.is_some() {
                out.extend(shadows(
                    d,
                    id,
                    &parts,
                    light.expect("read above"),
                    cast,
                    back,
                )?);
            }
        }
        if let Some((paint_fill, opacity)) = fill {
            let spec_fill = paint.get("fill").and_then(Value::as_object);
            out.extend(filled(
                d,
                id,
                spec_fill,
                &verbs,
                bounds,
                (paint_fill, opacity),
                &lit,
                &path,
            )?);
        }
        let has_fill = out.iter().any(|(m, _)| m.item() == id);
        if let Some(line) = stroke {
            let spec_stroke = paint.get("stroke").and_then(Value::as_object);
            out.extend(stroked(
                d,
                id,
                spec_stroke,
                &parts,
                bounds,
                line,
                &lit,
                &path,
            )?);
        }
        // Rims sit on top of the contour, where a kicker catches a form's edge.
        if let (true, Some(l)) = (has_fill, light) {
            out.extend(rims(d, id, &parts, l, &lit, &path)?);
        }
    }
    Ok(out)
}

fn shadows(
    d: &Dress<'_>,
    id: &str,
    parts: &[Outline],
    light: &spec::Light,
    cast: &spec::Cast,
    back: Option<&spec::Back>,
) -> Result<Vec<Dressed>, Refused> {
    let color = role_color(d.palette, &cast.role, "light/cast/role")?;
    let closed: Vec<&Outline> = parts.iter().filter(|o| o.closed).collect();
    let soft: Vec<Scope> = (cast.softness > 0.0)
        .then(|| blur_scope(id, "cast", cast.softness))
        .into_iter()
        .collect();
    let shadow = |polys: Vec<Outline>, alpha: f64, k: usize| -> Dressed {
        (
            Mark::Shape {
                item: format!("{id}#cast.{k}"),
                verbs: polys.iter().flat_map(polyline).collect(),
                fill: Some((Fill::Solid(color), alpha)),
                stroke: None,
            },
            soft.clone(),
        )
    };
    let mut out = Vec::new();
    match back {
        Some(b) if !b.lamps.is_empty() => {
            let opacity = 1.0 - transmission(d, b, id).unwrap_or(0.0);
            if opacity <= 0.0 {
                return Ok(out);
            }
            for (k, lamp) in lamps(d, b)?.iter().enumerate() {
                let polys = closed
                    .iter()
                    .flat_map(|o| {
                        geometry::cast(
                            o,
                            |p| geometry::unit([p[0] - lamp.at[0], p[1] - lamp.at[1]]),
                            cast.length,
                        )
                    })
                    .collect();
                out.push(shadow(polys, opacity, k));
            }
        }
        _ => {
            let l = geometry::direction(light.dir);
            let polys = closed
                .iter()
                .flat_map(|o| geometry::cast(o, |_| [-l[0], -l[1]], cast.length))
                .collect();
            out.push(shadow(polys, 1.0, 0));
        }
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn filled(
    d: &Dress<'_>,
    id: &str,
    fill: Option<&Map<String, Value>>,
    verbs: &[Verb],
    bounds: [f64; 4],
    (paint_fill, opacity): (Fill, f64),
    lit: &[Scope],
    path: &str,
) -> Result<Vec<Dressed>, Refused> {
    let color = match &paint_fill {
        Fill::Solid(c) => unit(*c),
        _ => [0.0; 3],
    };
    let (medium, def) = fill_medium(d, id, fill, color, bounds, path)?;
    let mut verbs = verbs.to_vec();
    let mut over = match &medium.kind {
        Kind::Wash(w) => w.oversize,
        _ => 0.0,
    };
    if let Some(o) = def.as_ref().and_then(|f| f.offset.as_ref()) {
        over = over.max(o.oversize);
        let slide = 0.75 + 0.5 * seeded(o.seed, id, 1);
        verbs = moved(&verbs, |p| [p[0] + o.dx * slide, p[1] + o.dy * slide]);
    }
    if over > 0.0 {
        let c = [bounds[0] + bounds[2] / 2.0, bounds[1] + bounds[3] / 2.0];
        let k = 1.0 + over;
        verbs = moved(&verbs, |p| {
            [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]
        });
    }
    let plain = medium.kind == Kind::Plain && medium.pressure.is_none();
    let mut scopes = lit.to_vec();
    if !plain {
        scopes.push(medium_scope(id, "fill", medium));
    }
    let mut out = vec![(
        Mark::Shape {
            item: id.to_string(),
            verbs: verbs.clone(),
            fill: Some((paint_fill, opacity)),
            stroke: None,
        },
        scopes,
    )];
    if let Some(dabs) = strokes_medium(d, id, bounds)? {
        out.push((
            Mark::Shape {
                item: format!("{id}#strokes"),
                verbs,
                fill: Some((Fill::Solid([255, 255, 255]), 1.0)),
                stroke: None,
            },
            vec![medium_scope(id, "strokes", dabs)],
        ));
    }
    Ok(out)
}

fn rims(
    d: &Dress<'_>,
    id: &str,
    parts: &[Outline],
    light: &spec::Light,
    lit: &[Scope],
    path: &str,
) -> Result<Vec<Dressed>, Refused> {
    let keep = if d.first_rim { 1 } else { light.rims.len() };
    let mut out = Vec::new();
    for (k, rim) in light.rims.iter().take(keep).enumerate() {
        if rim
            .on
            .as_deref()
            .is_some_and(|c| !members(d.doc, c).contains(&id))
        {
            continue;
        }
        let color = role_color(d.palette, &rim.role, &format!("light/rim/{k}/role"))?;
        let fixed = geometry::direction(rim.dir.unwrap_or(light.dir));
        let toward = match &rim.toward {
            Toward::Item(other) => match d.items.get(other) {
                Some(o) => Some(center_of(o)),
                None => {
                    return Err(Refused {
                        code: "ref_unresolved",
                        path: format!("{path}/light/rim/{k}/toward: {other}"),
                    })
                }
            },
            Toward::Light => None,
        };
        let bands: Vec<Outline> = parts
            .iter()
            .filter(|o| o.closed)
            .flat_map(|o| {
                geometry::rim(
                    o,
                    |p| match toward {
                        Some(c) => geometry::unit([c[0] - p[0], c[1] - p[1]]),
                        None => fixed,
                    },
                    rim.width,
                )
            })
            .collect();
        if bands.is_empty() {
            continue;
        }
        out.push((
            Mark::Shape {
                item: format!("{id}#rim.{k}"),
                verbs: bands.iter().flat_map(polyline).collect(),
                fill: Some((Fill::Solid(color), 1.0)),
                stroke: None,
            },
            lit.to_vec(),
        ));
    }
    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn stroked(
    d: &Dress<'_>,
    id: &str,
    stroke: Option<&Map<String, Value>>,
    parts: &[Outline],
    bounds: [f64; 4],
    line: Line,
    lit: &[Scope],
    path: &str,
) -> Result<Vec<Dressed>, Refused> {
    let name = stroke.and_then(|s| s.get("line")).and_then(Value::as_str);
    let def = match name {
        Some(name) => Some(d.look.line(name).map_err(refused)?.ok_or(Refused {
            code: "line_unresolved",
            path: format!("{path}/stroke/line: {name}"),
        })?),
        None => None,
    };
    let width = match stroke
        .and_then(|s| s.get("width"))
        .filter(|w| w.is_number())
    {
        Some(_) => line.width,
        None => def.as_ref().and_then(|l| l.width).unwrap_or(line.width),
    };
    let opacity = line.opacity * def.as_ref().map_or(1.0, |l| l.opacity);
    let weight = d.look.light.as_ref().map_or(0.0, |l| l.weight);
    let l = geometry::direction(d.look.light.as_ref().map_or(0.0, |l| l.dir));
    let color = match &line.paint {
        Fill::Solid(c) => Some(*c),
        _ => None,
    };
    let mut scopes = lit.to_vec();
    if let Some(def) = &def {
        if def.pressure.is_some() || def.dry > 0.0 {
            scopes.push(medium_scope(
                id,
                "line",
                Medium {
                    kind: Kind::Plain,
                    color: color.map_or([0.0; 3], unit),
                    pressure: def.pressure,
                    dry: def.dry,
                    seed: seed_of(id, 0),
                    bounds,
                    resist: Vec::new(),
                },
            ));
        }
    }
    let profile = def.as_ref().and_then(|l| l.profile.as_ref());
    let mut out = Vec::new();
    if profile.is_none() && weight == 0.0 {
        let verbs: Vec<Verb> = parts.iter().flat_map(polyline).collect();
        out.push((
            Mark::Shape {
                item: id.to_string(),
                verbs,
                fill: None,
                stroke: Some(Line {
                    width,
                    opacity,
                    ..line
                }),
            },
            scopes,
        ));
        return Ok(out);
    }
    for part in parts {
        let runs = match profile {
            Some(p) => geometry::profiled(part, p, id),
            None => geometry::evenly(part),
        };
        let weights = Outline {
            points: part.points.clone(),
            closed: part.closed,
        };
        for run in runs {
            let mut points: Vec<(f64, f64)> = Vec::with_capacity(run.points.len());
            let mut alphas: Vec<(f64, f64)> = Vec::with_capacity(run.points.len());
            let by_light = geometry::weight_at(&weights, &run.points, l, weight);
            let mut s = 0.0;
            for (i, &b) in run.points.iter().enumerate() {
                if i > 0 {
                    let a = run.points[i - 1];
                    s += deep_canvas::ops::hypot(b[0] - a[0], b[1] - a[1]);
                }
                // Under 1 device px a point draws at 1 px with its alpha scaled by its width (Paint).
                let w = width * run.widths[i] * by_light[i];
                points.push((s, w.max(1.0)));
                alphas.push((s, run.alphas[i] * w.min(1.0)));
            }
            let paint_of = match (color, alphas.iter().any(|(_, a)| *a < 1.0)) {
                (Some(c), true) => along_alphas(c, &alphas),
                _ => line.paint.clone(),
            };
            out.push((
                Mark::Shape {
                    item: id.to_string(),
                    verbs: polyline(&Outline {
                        points: run.points,
                        closed: false,
                    }),
                    fill: None,
                    stroke: Some(Line {
                        width,
                        paint: paint_of,
                        opacity,
                        dashes: None,
                        profile: Some(Box::new(Profile {
                            taper: None,
                            wave: None,
                            points,
                        })),
                    }),
                },
                scopes.clone(),
            ));
        }
    }
    Ok(out)
}
