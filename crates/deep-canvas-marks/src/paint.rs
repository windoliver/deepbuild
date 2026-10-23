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
