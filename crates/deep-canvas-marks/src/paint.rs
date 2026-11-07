//! R2's paint for 2D marks (canvas primitives: Paint; Paint: stroke gradients, taper and wave; Item
//! and kind: adjust): linear, radial and sweep gradients of up to 8 stops on fills and strokes, a
//! radial gradient's focal point, and an item's color adjustments. Issue #374 adds a stop's
//! opacity, a stroke's stops by arc length (`kind: along`), a gradient spanning its parent's or
//! another item's box, and stepped fills.
//!
//! Gradients interpolate in OKLab between their stops' roles, over premultiplied colors. The ramp
//! is handed to the renderer as sRGB-encoded stops that a renderer mixing premultiplied colors in
//! encoded space follows within 0.001 ΔEOK, since Vello's own approximation stops at 0.01 (canvas
//! core: Conventions). A focal point moves the gradient's start toward its edge by `length` × r
//! along `angle`, the two-point radial gradient SVG draws for fx, fy with fr = 0.
//!
//! An adjust applies in one fixed order: exposure (linear light × 2^EV), contrast (pivoting at mid
//! gray), gamma (each channel to 1 ÷ gamma), hue and saturation (in OKLCh), brightness, tint and
//! invert (1 − c, alpha kept). A channel at its identity is skipped, so an identity adjust changes
//! no value.

use serde_json::{Map, Value};

use deep_canvas::color::{oklab_to_srgb, oklch_to_srgb, srgb_decode, srgb_encode};
use deep_canvas::color::{srgb_to_oklab, srgb_to_oklch, Oklab, Srgb};
use deep_canvas::ops;

use crate::scene::{num, refuse, Palette, Refused, Rgb};

/// An sRGB-encoded color, 0..1 per channel.
pub type Color = [f64; 3];

/// The most stops a gradient takes (Paint: "use more than 8 stops" it can never).
pub const MAX_STOPS: usize = 8;

/// How far the ramp handed to a renderer strays from the OKLab ramp: 0.001 ΔEOK (canvas core:
/// Conventions), and a tenth of a code value per channel, since 0.001 ΔEOK can reach half a code in
/// a saturated blue and the ramp must hold within one code value once drawn.
const RAMP_TOLERANCE: f64 = 0.001;
const RAMP_CODE_TOLERANCE: f64 = 0.1 / 255.0;

pub fn unit(c: Rgb) -> Color {
    c.map(|v| f64::from(v) / 255.0)
}

pub fn code(c: Color) -> Rgb {
    c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
}

fn srgb(c: Color) -> Srgb {
    Srgb {
        r: c[0],
        g: c[1],
        b: c[2],
    }
}

fn color(c: Srgb) -> Color {
    [c.r, c.g, c.b].map(|v| v.clamp(0.0, 1.0))
}

/// Where a gradient sits once its box is known, in u.
#[derive(Clone, Debug, PartialEq)]
pub enum Geometry {
    Linear {
        from: [f64; 2],
        to: [f64; 2],
    },
    /// The end circle's center and radius, and the focal point the ramp starts from.
    Radial {
        center: [f64; 2],
        radius: f64,
        focal: [f64; 2],
    },
    /// Angles in degrees, clockwise on screen from +x.
    Sweep {
        center: [f64; 2],
        start: f64,
        end: f64,
    },
    /// A stroke's stops by arc length from its path's start, measured on the path as drawn.
    Along,
}

/// No change: a gradient already in the document's space.
pub const IDENTITY: [f64; 6] = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Extend {
    Pad,
    Repeat,
    Reflect,
}

/// A gradient as drawn: its geometry, how it extends, its ramp as sRGB-encoded stops with their
/// opacity, and the transform from the gradient's space to the document's (`[a, b, c, d, e, f]`,
/// kurbo's order), so an item's own gradient turns and scales with it.
#[derive(Clone, Debug, PartialEq)]
pub struct Ramp {
    pub geometry: Geometry,
    pub extend: Extend,
    pub stops: Vec<(f64, Color, f64)>,
    pub transform: [f64; 6],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Linear,
    Radial,
    Sweep,
    Along,
}

/// The box a gradient runs over (`span: item | parent | ID = item`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Span {
    Item,
    Parent,
    Of(String),
}

/// A gradient as written: its kind, `from` and `to` as fractions of the box, its focal point
/// `(length, angle)`, how it extends, the box it spans, and its stops' resolved roles with their
/// opacity.
#[derive(Clone, Debug, PartialEq)]
pub struct Gradient {
    kind: Kind,
    from: [f64; 2],
    to: [f64; 2],
    focal: (f64, f64),
    extend: Extend,
    span: Span,
    stops: Vec<(f64, Rgb, f64)>,
}

/// A box point (`c`, `n`, `ne`, … `w`, `nw`) or `[f32, f32]`, as fractions of the box.
fn box_point(v: Option<&Value>, default: [f64; 2], path: &str) -> Result<[f64; 2], Refused> {
    Ok(match v {
        None => default,
        Some(Value::String(s)) => match s.as_str() {
            "c" => [0.5, 0.5],
            "n" => [0.5, 0.0],
            "ne" => [1.0, 0.0],
            "e" => [1.0, 0.5],
            "se" => [1.0, 1.0],
            "s" => [0.5, 1.0],
            "sw" => [0.0, 1.0],
            "w" => [0.0, 0.5],
            "nw" => [0.0, 0.0],
            _ => return refuse("bad_paint", path),
        },
        Some(Value::Array(a)) => match (num(a.first()), num(a.get(1)), a.len()) {
            (Some(x), Some(y), 2) => [x, y],
            _ => return refuse("bad_paint", path),
        },
        Some(_) => return refuse("bad_paint", path),
    })
}

/// A list of stops at `path`: each `at` in 0..1 and in order, its role through `palette`, and its
/// `opacity` (1 when left out).
fn stops_of(
    palette: &Palette,
    stops: Option<&Value>,
    path: &str,
) -> Result<Vec<(f64, Rgb, f64)>, Refused> {
    let Some(Value::Array(list)) = stops else {
        return refuse("bad_paint", format!("{path}/stops"));
    };
    if list.len() < 2 || list.len() > MAX_STOPS {
        return refuse("gradient_stops", format!("{path}/stops"));
    }
    let mut stops: Vec<(f64, Rgb, f64)> = Vec::with_capacity(list.len());
    for (i, s) in list.iter().enumerate() {
        let at = num(s.get("at")).filter(|a| (0.0..=1.0).contains(a));
        let Some(at) = at else {
            return refuse("out_of_range", format!("{path}/stops/{i}/at"));
        };
        if stops.last().is_some_and(|(last, _, _)| at < *last) {
            return refuse("out_of_range", format!("{path}/stops/{i}/at"));
        }
        let Some(Value::String(role)) = s.get("role") else {
            return refuse("bad_paint", format!("{path}/stops/{i}/role"));
        };
        let Some(c) = palette.get(role) else {
            return refuse("role_unresolved", format!("{path}/stops/{i}/role: {role}"));
        };
        let opacity = match s.get("opacity") {
            None => 1.0,
            Some(o) => match num(Some(o)).filter(|o| (0.0..=1.0).contains(o)) {
                Some(o) => o,
                None => return refuse("out_of_range", format!("{path}/stops/{i}/opacity")),
            },
        };
        stops.push((at, *c, opacity));
    }
    Ok(stops)
}

/// Reads a gradient's fields at `path`, its stops' roles through `palette`; `along` is a stroke's
/// alone.
pub fn gradient(
    palette: &Palette,
    g: &Map<String, Value>,
    path: &str,
    stroke: bool,
) -> Result<Gradient, Refused> {
    let kind = match g.get("kind").and_then(Value::as_str) {
        None | Some("linear") => Kind::Linear,
        Some("radial") => Kind::Radial,
        Some("sweep") => Kind::Sweep,
        Some("along") if stroke => Kind::Along,
        Some(_) => return refuse("gradient_kind", format!("{path}/kind")),
    };
    let extend = match g.get("extend").and_then(Value::as_str) {
        None | Some("pad") => Extend::Pad,
        Some("repeat") => Extend::Repeat,
        Some("reflect") => Extend::Reflect,
        Some(_) => return refuse("bad_paint", format!("{path}/extend")),
    };
    let span = match g.get("span") {
        None => Span::Item,
        Some(Value::String(s)) if s == "item" => Span::Item,
        Some(Value::String(s)) if s == "parent" => Span::Parent,
        Some(Value::String(id)) => Span::Of(id.clone()),
        Some(_) => return refuse("bad_paint", format!("{path}/span")),
    };
    let stops = stops_of(palette, g.get("stops"), path)?;
    let focal = match g.get("focal") {
        None => (0.0, 0.0),
        Some(f) if kind == Kind::Radial => {
            let length = num(f.get("length")).unwrap_or(0.0);
            if !(-1.0..=1.0).contains(&length) {
                return refuse("out_of_range", format!("{path}/focal/length"));
            }
            (length, num(f.get("angle")).unwrap_or(0.0))
        }
        Some(_) => return refuse("bad_paint", format!("{path}/focal")),
    };
    let (from, to) = match kind {
        Kind::Linear => ([0.0, 0.5], [1.0, 0.5]),
        _ => ([0.5, 0.5], [1.0, 0.5]),
    };
    Ok(Gradient {
        kind,
        from: box_point(g.get("from"), from, &format!("{path}/from"))?,
        to: box_point(g.get("to"), to, &format!("{path}/to"))?,
        focal,
        extend,
        span,
        stops,
    })
}

impl Gradient {
    /// R1's gradient: two opaque stops, linear from the item's box's west edge to its east, padded.
    /// GPUI draws it through the patch's exact mode; any other goes to [`Gradient::ramp`].
    pub fn two_stop(&self) -> Option<([f64; 2], [Rgb; 2])> {
        let r1 = self.kind == Kind::Linear
            && self.from == [0.0, 0.5]
            && self.to == [1.0, 0.5]
            && self.extend == Extend::Pad
            && self.span == Span::Item;
        match self.stops.as_slice() {
            [(a, x, 1.0), (b, y, 1.0)] if r1 && b > a => Some(([*a, *b], [*x, *y])),
            _ => None,
        }
    }

    pub fn span(&self) -> &Span {
        &self.span
    }

    /// The gradient over `bounds` (`[x, y, w, h]` in u).
    pub fn ramp(&self, bounds: [f64; 4]) -> Ramp {
        let [x, y, w, h] = bounds;
        let at = |p: [f64; 2]| [x + p[0] * w, y + p[1] * h];
        let (from, to) = (at(self.from), at(self.to));
        let geometry = match self.kind {
            Kind::Linear => Geometry::Linear { from, to },
            Kind::Radial => {
                let radius = ops::hypot(to[0] - from[0], to[1] - from[1]);
                let (length, angle) = self.focal;
                let a = ops::rad(angle);
                Geometry::Radial {
                    center: from,
                    radius,
                    focal: [
                        from[0] + length * radius * ops::cos(a),
                        from[1] + length * radius * ops::sin(a),
                    ],
                }
            }
            Kind::Sweep => {
                let start = ops::deg(ops::atan2(to[1] - from[1], to[0] - from[0]));
                Geometry::Sweep {
                    center: from,
                    start,
                    end: start + 360.0,
                }
            }
            Kind::Along => Geometry::Along,
        };
        Ramp {
            geometry,
            extend: self.extend,
            stops: dense(&self.stops),
            transform: IDENTITY,
        }
    }
}

fn lab(c: Rgb) -> Oklab {
    srgb_to_oklab(srgb(unit(c)))
}

fn mix(a: Oklab, b: Oklab, f: f64) -> Oklab {
    Oklab {
        l: a.l + (b.l - a.l) * f,
        a: a.a + (b.a - a.a) * f,
        b: a.b + (b.b - a.b) * f,
    }
}

/// The color `f` of the way from `a` to `b` in OKLab.
pub fn oklab_mix(a: Rgb, b: Rgb, f: f64) -> Oklab {
    mix(lab(a), lab(b), f)
}

/// An OKLab color in 8-bit sRGB.
pub fn rgb_of(c: Oklab) -> Rgb {
    let c = oklab_to_srgb(c);
    [c.r, c.g, c.b].map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8)
}

fn delta(p: Oklab, q: Oklab) -> f64 {
    ops::sqrt((p.l - q.l) * (p.l - q.l) + (p.a - q.a) * (p.a - q.a) + (p.b - q.b) * (p.b - q.b))
}

/// The color and opacity `f` of the way from `a` to `b`: OKLab over premultiplied colors.
fn between(a: (Oklab, f64), b: (Oklab, f64), f: f64) -> (Oklab, f64) {
    let alpha = a.1 + (b.1 - a.1) * f;
    if alpha <= 0.0 {
        return (mix(a.0, b.0, f), 0.0);
    }
    let times = |c: Oklab, w: f64| Oklab {
        l: c.l * w,
        a: c.a * w,
        b: c.b * w,
    };
    let m = mix(times(a.0, a.1), times(b.0, b.1), f);
    (times(m, 1.0 / alpha), alpha)
}

/// The OKLab ramp between `stops` as sRGB-encoded stops with their opacity: each segment is halved
/// until mixing its ends' premultiplied colors in encoded sRGB stays within [`RAMP_TOLERANCE`] and
/// [`RAMP_CODE_TOLERANCE`] of OKLab at its quarter points, weighed by how opaque they are there.
pub fn dense(stops: &[(f64, Rgb, f64)]) -> Vec<(f64, Color, f64)> {
    let mut out: Vec<(f64, Color, f64)> = Vec::new();
    for pair in stops.windows(2) {
        let ((t0, c0, a0), (t1, c1, a1)) = (pair[0], pair[1]);
        let (a, b) = ((lab(c0), a0), (lab(c1), a1));
        let at = |f: f64| {
            let (l, alpha) = between(a, b, f);
            (color(oklab_to_srgb(l)), alpha)
        };
        if out
            .last()
            .is_none_or(|(t, c, o)| *t != t0 || *c != unit(c0) || *o != a0)
        {
            out.push((t0, unit(c0), a0));
        }
        // Segments as (f0, f1) of this pair, split depth first so the stops come out in order.
        let mut todo = vec![(0.0, 1.0, 0u32)];
        while let Some((f0, f1, depth)) = todo.pop() {
            let ((e0, w0), (e1, w1)) = (at(f0), at(f1));
            let strays = [0.25, 0.5, 0.75].iter().any(|q| {
                let f = f0 + (f1 - f0) * q;
                let w = w0 + (w1 - w0) * q;
                if w <= 0.0 {
                    return false;
                }
                let linear: Color =
                    [0, 1, 2].map(|k| (e0[k] * w0 + (e1[k] * w1 - e0[k] * w0) * q) / w);
                let (exact, _) = at(f);
                delta(srgb_to_oklab(srgb(linear)), between(a, b, f).0) * w > RAMP_TOLERANCE
                    || (0..3).any(|k| (linear[k] - exact[k]).abs() * w > RAMP_CODE_TOLERANCE)
            });
            if strays && depth < 10 {
                let mid = (f0 + f1) / 2.0;
                todo.push((mid, f1, depth + 1));
                todo.push((f0, mid, depth + 1));
            } else if f1 == 1.0 {
                out.push((t0 + (t1 - t0) * f1, unit(c1), a1));
            } else {
                out.push((t0 + (t1 - t0) * f1, e1, w1));
            }
        }
    }
    out
}

/// The OKLab ramp through `stops` at `t`, as a role's 8-bit color: a stop's own role exactly at
/// and past the ends.
fn sample(stops: &[(f64, Rgb)], t: f64) -> Rgb {
    let (first, last) = (stops[0], stops[stops.len() - 1]);
    if t <= first.0 {
        return first.1;
    }
    if t >= last.0 {
        return last.1;
    }
    let k = stops.windows(2).position(|w| t < w[1].0).unwrap_or(0);
    let ((t0, c0), (t1, c1)) = (stops[k], stops[k + 1]);
    let f = if t1 > t0 { (t - t0) / (t1 - t0) } else { 1.0 };
    code(color(oklab_to_srgb(mix(lab(c0), lab(c1), f))))
}

/// What a stepped fill's members are (`over: children | collection ID`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Over {
    Children,
    Collection(String),
}

/// What places a member along the stops (`by: order | x | y | distance {from, radius}`).
#[derive(Clone, Debug, PartialEq)]
pub enum By {
    Order,
    X,
    Y,
    Distance { from: [f64; 2], radius: f64 },
}

/// A stepped fill (Paint: `steps`): each member one solid color mixed from the stops in OKLab by
/// its rank or position.
#[derive(Clone, Debug, PartialEq)]
pub struct Steps {
    pub over: Over,
    pub by: By,
    stops: Vec<(f64, Rgb)>,
}

/// Reads a stepped fill's fields at `path`, its stops' roles through `palette`.
pub fn steps(palette: &Palette, s: &Map<String, Value>, path: &str) -> Result<Steps, Refused> {
    let over = match s.get("over") {
        Some(Value::String(o)) if o == "children" => Over::Children,
        Some(Value::String(c)) => Over::Collection(c.clone()),
        _ => return refuse("bad_paint", format!("{path}/over")),
    };
    let by = match s.get("by") {
        None => By::Order,
        Some(Value::String(b)) if b == "order" => By::Order,
        Some(Value::String(b)) if b == "x" => By::X,
        Some(Value::String(b)) if b == "y" => By::Y,
        Some(Value::Object(d)) if d.contains_key("distance") => {
            let d = d.get("distance");
            let from = match d.and_then(|d| d.get("from")) {
                Some(Value::Array(a)) if a.len() == 2 => match (num(a.first()), num(a.get(1))) {
                    (Some(x), Some(y)) => [x, y],
                    _ => return refuse("bad_paint", format!("{path}/by/distance/from")),
                },
                _ => return refuse("bad_paint", format!("{path}/by/distance/from")),
            };
            let Some(radius) = num(d.and_then(|d| d.get("radius"))).filter(|r| *r > 0.0) else {
                return refuse("out_of_range", format!("{path}/by/distance/radius"));
            };
            By::Distance { from, radius }
        }
        Some(_) => return refuse("bad_paint", format!("{path}/by")),
    };
    let stops = stops_of(palette, s.get("stops"), path)?
        .into_iter()
        .map(|(at, c, _)| (at, c))
        .collect();
    Ok(Steps { over, by, stops })
}

/// A mark set's stepped fill over its rows (`steps {over: rows, by: order | key}`): its stops'
/// colors through `palette`, each row one solid color by its rank (#1162).
pub fn row_stops(palette: &Palette, s: &Map<String, Value>, path: &str) -> Result<Vec<(f64, Rgb)>, Refused> {
    Ok(stops_of(palette, s.get("stops"), path)?
        .into_iter()
        .map(|(at, c, _)| (at, c))
        .collect())
}

/// The color at `t`, 0..1 along `stops`, mixed in OKLab.
pub fn sample_stops(stops: &[(f64, Rgb)], t: f64) -> Rgb {
    sample(stops, t)
}

impl Steps {
    /// The color at `t`, 0..1 along the stops.
    pub fn color(&self, t: f64) -> Rgb {
        sample(&self.stops, t)
    }
}

/// An item's color adjustments (Item and kind: adjust).
#[derive(Clone, Debug, PartialEq)]
pub struct Adjust {
    pub opacity: f64,
    pub tint: Option<Rgb>,
    pub hue: f64,
    pub saturation: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub exposure: f64,
    pub gamma: f64,
    pub invert: bool,
}

impl Default for Adjust {
    fn default() -> Self {
        Adjust {
            opacity: 1.0,
            tint: None,
            hue: 0.0,
            saturation: 1.0,
            brightness: 1.0,
            contrast: 1.0,
            exposure: 0.0,
            gamma: 1.0,
            invert: false,
        }
    }
}

impl Adjust {
    /// An item's `adjust`, its tint resolved through `palette`; the core check holds each to range.
    pub fn read(item: &Value, palette: &Palette, id: &str) -> Result<Adjust, Refused> {
        let mut a = Adjust::default();
        let Some(Value::Object(m)) = item.get("adjust") else {
            return Ok(a);
        };
        let n = |k: &str, d: f64| num(m.get(k)).unwrap_or(d);
        a.opacity = n("opacity", 1.0).clamp(0.0, 1.0);
        a.hue = n("hue", 0.0);
        a.saturation = n("saturation", 1.0);
        a.brightness = n("brightness", 1.0);
        a.contrast = n("contrast", 1.0);
        a.exposure = n("exposure", 0.0);
        a.gamma = n("gamma", 1.0);
        a.invert = m.get("invert") == Some(&Value::Bool(true));
        if let Some(Value::String(role)) = m.get("tint") {
            a.tint = Some(*palette.get(role).ok_or(Refused {
                code: "role_unresolved",
                path: format!("items/{id}/adjust/tint: {role}"),
            })?);
        }
        Ok(a)
    }

    /// True when the adjust changes no color (opacity aside).
    pub fn is_identity(&self) -> bool {
        *self
            == Adjust {
                opacity: self.opacity,
                ..Adjust::default()
            }
    }

    /// `c` adjusted, in the fixed order; a channel at its identity is skipped.
    pub fn color(&self, mut c: Color) -> Color {
        if self.exposure != 0.0 {
            let scale = ops::pow(2.0, self.exposure);
            c = c.map(|v| srgb_encode((srgb_decode(v) * scale).clamp(0.0, 1.0)));
        }
        if self.contrast != 1.0 {
            c = c.map(|v| ((v - 0.5) * self.contrast + 0.5).clamp(0.0, 1.0));
        }
        if self.gamma != 1.0 {
            c = c.map(|v| ops::pow(v, 1.0 / self.gamma));
        }
        if self.hue != 0.0 || self.saturation != 1.0 {
            let mut lch = srgb_to_oklch(srgb(c));
            lch.h = (lch.h + self.hue).rem_euclid(360.0);
            lch.c *= self.saturation;
            c = color(oklch_to_srgb(lch));
        }
        if self.brightness != 1.0 {
            c = c.map(|v| (v * self.brightness).clamp(0.0, 1.0));
        }
        if let Some(t) = self.tint {
            let t = unit(t);
            c = [0, 1, 2].map(|k| c[k] * t[k]);
        }
        if self.invert {
            c = c.map(|v| 1.0 - v);
        }
        c
    }

    /// A role's color adjusted, back in 8 bits; unchanged when the adjust is the identity.
    pub fn rgb(&self, c: Rgb) -> Rgb {
        if self.is_identity() {
            return c;
        }
        code(self.color(unit(c)))
    }
}

// ---------------------------------------------------------------------------------------------------
// Issue #160: stroke taper, wave and per-point widths (Paint: stroke gradients, taper and wave;
// Path `path@1`: per-point `width`), as widths from arc length at tessellation.

/// A length along a stroke: in u, or as a fraction of its length.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Along {
    U(f64),
    Fraction(f64),
}

impl Along {
    fn u(self, total: f64) -> f64 {
        match self {
            Along::U(u) => u,
            Along::Fraction(f) => f * total,
        }
    }

    /// `0` (none) or a number: at most 1 a fraction of the length, above 1 u.
    fn read(v: Option<&Value>, path: &str) -> Result<Along, Refused> {
        match v {
            None | Some(Value::Null) => Ok(Along::U(0.0)),
            Some(Value::Number(n)) => {
                let n = n
                    .as_f64()
                    .filter(|n| n.is_finite() && *n >= 0.0)
                    .ok_or(Refused {
                        code: "out_of_range",
                        path: path.to_string(),
                    })?;
                Ok(if n <= 1.0 {
                    Along::Fraction(n)
                } else {
                    Along::U(n)
                })
            }
            Some(_) => refuse("bad_doc", path.to_string()),
        }
    }
}

/// `taper {start, end, start_width, end_width, ease}`: the first `start` and the last `end` of the
/// stroke narrow to their widths along an ease, 0 straight and 1 smooth.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Taper {
    pub start: Along,
    pub end: Along,
    pub start_width: f64,
    pub end_width: f64,
    pub ease: f64,
}

/// `wave {amount, wavelength, phase}`: the width varies by `amount` of itself along the length.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wave {
    pub amount: f64,
    pub wavelength: f64,
    pub phase: f64,
}

/// A stroke's width along its length: its taper and wave, and the per-point widths a hand-drawn
/// stroke carries, each at the arc length of its point.
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub taper: Option<Taper>,
    pub wave: Option<Wave>,
    pub points: Vec<(f64, f64)>,
}

impl Profile {
    /// The width at `s` u along a stroke `total` u long whose paint width is `base`.
    pub fn width(&self, base: f64, s: f64, total: f64) -> f64 {
        let mut w = if self.points.is_empty() {
            base
        } else {
            let pts = &self.points;
            let i = pts
                .partition_point(|(at, _)| *at <= s)
                .clamp(1, pts.len() - 1);
            let (s0, w0) = pts[i - 1];
            let (s1, w1) = pts[i];
            let f = if s1 > s0 {
                ((s - s0) / (s1 - s0)).clamp(0.0, 1.0)
            } else {
                0.0
            };
            w0 + (w1 - w0) * f
        };
        if let Some(t) = &self.taper {
            let eased = |f: f64| {
                let f = f.clamp(0.0, 1.0);
                let smooth = f * f * (3.0 - 2.0 * f);
                f + (smooth - f) * t.ease
            };
            let a = t.start.u(total);
            if a > 0.0 && s < a {
                w *= t.start_width + (1.0 - t.start_width) * eased(s / a);
            }
            let b = t.end.u(total);
            if b > 0.0 && s > total - b {
                w *= t.end_width + (1.0 - t.end_width) * eased((total - s) / b);
            }
        }
        if let Some(v) = &self.wave {
            if v.wavelength > 0.0 {
                let phase = ops::rad(v.phase);
                w *= 1.0
                    + v.amount * ops::sin(2.0 * std::f64::consts::PI * s / v.wavelength + phase);
            }
        }
        w.max(0.0)
    }

    pub fn feed(&self, k: &mut crate::key::KeyBuilder) {
        match &self.taper {
            Some(t) => {
                k.text("taper");
                for a in [t.start, t.end] {
                    match a {
                        Along::U(u) => k.text("u").number(u),
                        Along::Fraction(f) => k.text("fraction").number(f),
                    };
                }
                k.number(t.start_width).number(t.end_width).number(t.ease);
            }
            None => {
                k.text("no taper");
            }
        }
        match &self.wave {
            Some(v) => {
                k.text("wave")
                    .number(v.amount)
                    .number(v.wavelength)
                    .number(v.phase);
            }
            None => {
                k.text("no wave");
            }
        }
        k.int(self.points.len() as i64);
        for (s, w) in &self.points {
            k.number(*s).number(*w);
        }
    }
}

fn unit_field(
    m: &Map<String, Value>,
    name: &str,
    default: f64,
    path: &str,
) -> Result<f64, Refused> {
    match m.get(name) {
        None | Some(Value::Null) => Ok(default),
        Some(v) => {
            let n = num(Some(v)).ok_or(Refused {
                code: "bad_doc",
                path: format!("{path}/{name}"),
            })?;
            if !(0.0..=1.0).contains(&n) {
                return refuse("out_of_range", format!("{path}/{name}"));
            }
            Ok(n)
        }
    }
}

/// The stroke's profile from its `taper` and `wave` and the item's per-point `width` column
/// (`widths`, one per anchor point at its arc length), or `None` for a plain stroke.
pub fn profile(
    stroke: &Map<String, Value>,
    path: &str,
    widths: Vec<(f64, f64)>,
) -> Result<Option<Profile>, Refused> {
    let taper = match stroke.get("taper") {
        None | Some(Value::Null) => None,
        Some(Value::Object(t)) => {
            let path = format!("{path}/taper");
            Some(Taper {
                start: Along::read(t.get("start"), &format!("{path}/start"))?,
                end: Along::read(t.get("end"), &format!("{path}/end"))?,
                start_width: unit_field(t, "start_width", 1.0, &path)?,
                end_width: unit_field(t, "end_width", 1.0, &path)?,
                ease: unit_field(t, "ease", 0.0, &path)?,
            })
        }
        Some(_) => return refuse("bad_doc", format!("{path}/taper")),
    };
    let wave = match stroke.get("wave") {
        None | Some(Value::Null) => None,
        Some(Value::Object(w)) => {
            let path = format!("{path}/wave");
            let wavelength = match w.get("wavelength") {
                None | Some(Value::Null) => 20.0,
                Some(v) => num(Some(v)).filter(|n| *n > 0.0).ok_or(Refused {
                    code: "out_of_range",
                    path: format!("{path}/wavelength"),
                })?,
            };
            let phase = match w.get("phase") {
                None | Some(Value::Null) => 0.0,
                Some(v) => num(Some(v)).ok_or(Refused {
                    code: "bad_doc",
                    path: format!("{path}/phase"),
                })?,
            };
            Some(Wave {
                amount: unit_field(w, "amount", 0.0, &path)?,
                wavelength,
                phase,
            })
        }
        Some(_) => return refuse("bad_doc", format!("{path}/wave")),
    };
    if taper.is_none() && wave.is_none() && widths.is_empty() {
        return Ok(None);
    }
    Ok(Some(Profile {
        taper,
        wave,
        points: widths,
    }))
}

// ---------------------------------------------------------------------------------------------------
// Issue #160: a crescent shade (Paint: shade): a darker flat of the shape, offset away from the
// light and clipped to the shape, with an optional highlight toward it and a rim along its edge.

/// `shade {kind, role, offset, light, opacity, mode, highlight, rim}` as read; `blur`, `choke`
/// and `kind: inner` wait for the pass that blurs (Paint: glow, bevel and satin).
#[derive(Clone, Debug, PartialEq)]
pub struct Shade {
    pub color: Rgb,
    /// The shade's move away from the light, in u.
    pub offset: f64,
    /// The direction the light comes from, in degrees (0 is +x, 90 is +y), −135 by default.
    pub light: f64,
    pub opacity: f64,
    pub multiply: bool,
    /// The highlight's color and its move toward the light.
    pub highlight: Option<(Rgb, f64)>,
    /// The rim's color and its width inside the edge.
    pub rim: Option<(Rgb, f64)>,
}

impl Shade {
    /// Reads `paint.shade` at `path`; `None` when absent.
    pub fn read(
        palette: &Palette,
        v: Option<&Value>,
        path: &str,
    ) -> Result<Option<Shade>, Refused> {
        let sh = match v {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(o)) => o,
            Some(_) => return refuse("bad_doc", path.to_string()),
        };
        let color = |m: &Map<String, Value>, at: &str| -> Result<Rgb, Refused> {
            let name = m.get("role").and_then(Value::as_str).ok_or(Refused {
                code: "bad_paint",
                path: format!("{at}/role"),
            })?;
            palette.get(name).copied().ok_or(Refused {
                code: "role_unresolved",
                path: format!("{at}/role"),
            })
        };
        let number =
            |m: &Map<String, Value>, name: &str, default: f64, at: &str| -> Result<f64, Refused> {
                match m.get(name) {
                    None | Some(Value::Null) => Ok(default),
                    Some(v) => num(Some(v)).ok_or(Refused {
                        code: "bad_doc",
                        path: format!("{at}/{name}"),
                    }),
                }
            };
        match sh.get("kind").and_then(Value::as_str) {
            None | Some("crescent" | "step") => {}
            Some("inner") => return refuse("module_missing", format!("{path}/kind")),
            Some(_) => return refuse("bad_doc", format!("{path}/kind")),
        }
        if number(sh, "blur", 0.0, path)? > 0.0 {
            return refuse("module_missing", format!("{path}/blur"));
        }
        if number(sh, "choke", 0.0, path)? > 0.0 {
            return refuse("module_missing", format!("{path}/choke"));
        }
        let light = match sh.get("light") {
            None | Some(Value::Null) => -135.0,
            Some(Value::String(s)) if s == "look" => -135.0,
            Some(v) => num(Some(v)).ok_or(Refused {
                code: "bad_doc",
                path: format!("{path}/light"),
            })?,
        };
        let opacity = number(sh, "opacity", 1.0, path)?;
        if !(0.0..=1.0).contains(&opacity) {
            return refuse("out_of_range", format!("{path}/opacity"));
        }
        let multiply = match sh.get("mode").and_then(Value::as_str) {
            None | Some("normal") => false,
            Some("multiply") => true,
            Some(_) => return refuse("bad_doc", format!("{path}/mode")),
        };
        let sub = |name: &str, field: &str, default: f64| -> Result<Option<(Rgb, f64)>, Refused> {
            match sh.get(name) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::Object(m)) => {
                    let at = format!("{path}/{name}");
                    Ok(Some((color(m, &at)?, number(m, field, default, &at)?)))
                }
                Some(_) => refuse("bad_doc", format!("{path}/{name}")),
            }
        };
        Ok(Some(Shade {
            color: color(sh, path)?,
            offset: number(sh, "offset", 6.0, path)?,
            light,
            opacity,
            multiply,
            highlight: sub("highlight", "offset", 6.0)?,
            rim: sub("rim", "width", 2.0)?,
        }))
    }

    /// The shade's move: `offset` u away from the light.
    pub fn away(&self, offset: f64) -> [f64; 2] {
        let a = ops::rad(self.light);
        [-offset * ops::cos(a), -offset * ops::sin(a)]
    }
}
