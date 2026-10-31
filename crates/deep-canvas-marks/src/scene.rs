//! A frame's 2D draw list: each writer layer's marks in draw order, with every role resolved
//! through the look, bound values formatted from their readings, and the content keys of what each
//! mark reads (canvas primitives: Marks, data and diagrams; Paint; Bound value; Content key).
//!
//! R1's slice: rect, circle (dots and rings), path (lines and arrows, and simple fills) and text;
//! solid fills and two-stop linear gradients; an item's `at.pos` moves it, while rotation and scale
//! wait for the GPU layer, since GPUI's quads and sprites don't turn.
//!
//! Issue #373 adds R2's 2D marks, drawn by Vello CPU: star@1, arcs, frames and groups, gradients of
//! up to 8 stops (linear, radial with a focal point, sweep) on fills and strokes, alpha and
//! luminance rect masks, and each item's adjust. A mark carries the scopes it draws inside, from
//! its outermost ancestor in: a rect mask's scissor, a soft mask, or a group's opacity.
//!
//! Issue #374 completes the paint: an item draws where its own and its parents' positions and
//! scales put it, stroke widths stay as written under a scale unless `scale_stroke`, fills and
//! strokes take their own opacity, a stroke's dash count is fitted to each sub-path, a gradient
//! may span its parent's or another item's box, and a stepped fill gives each member one color. A
//! span or a step by position reads boxes, so a frame that has one is built twice: once for every
//! item's box, then with them.

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::data;
use crate::key::{ContentKey, KeyBuilder};
use crate::outline::{self, Star};
use crate::paint::{self, Adjust, By, Over, Ramp, Span, Steps};
use crate::path::{self, Mesh, Verb};

/// The kinds [`frame`] reads: every other kind is one the marks module doesn't know.
pub const KINDS: &[&str] = &[
    "rect@1", "circle@1", "path@1", "text@1", "image@1", "marks@1", "axis@1", "scale@1", "mask@1",
    "group@1", "star@1", "frame@1",
];

/// An sRGB-encoded color, 0–255 per channel, as the look's roles resolve for a 2D writer layer.
pub type Rgb = [u8; 3];

/// Role → color, for one theme.
pub type Palette = BTreeMap<String, Rgb>;

/// Why a frame can't be drawn.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

pub(crate) fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

/// A fill: one role's color, a two-stop linear gradient from the box's west edge to its east (R1,
/// which GPUI draws), or any other gradient as its ramp (R2).
#[derive(Clone, Debug, PartialEq)]
pub enum Fill {
    Solid(Rgb),
    Linear {
        from: Rgb,
        to: Rgb,
        /// Each stop's `at`, 0..1 along the box.
        at: [f64; 2],
    },
    Ramp(Ramp),
}

impl Fill {
    fn adjust(&mut self, a: &Adjust) {
        match self {
            Fill::Solid(c) => *c = a.rgb(*c),
            Fill::Linear { from, to, .. } => {
                *from = a.rgb(*from);
                *to = a.rgb(*to);
            }
            Fill::Ramp(r) => r.stops.iter_mut().for_each(|(_, c, _)| *c = a.color(*c)),
        }
    }

    fn feed(&self, k: &mut KeyBuilder) {
        match self {
            Fill::Solid(c) => {
                k.text("solid").bytes(c);
            }
            Fill::Linear { from, to, at } => {
                k.text("linear").bytes(from).bytes(to);
                k.number(at[0]).number(at[1]);
            }
            Fill::Ramp(r) => {
                k.text("ramp").int(r.extend as i64);
                let points: &[f64] = match &r.geometry {
                    paint::Geometry::Linear { from, to } => &[from[0], from[1], to[0], to[1]],
                    paint::Geometry::Radial {
                        center,
                        radius,
                        focal,
                    } => &[center[0], center[1], *radius, focal[0], focal[1]],
                    paint::Geometry::Sweep { center, start, end } => {
                        &[center[0], center[1], *start, *end]
                    }
                    paint::Geometry::Along => &[],
                };
                points.iter().chain(&r.transform).for_each(|v| {
                    k.number(*v);
                });
                for (t, c, alpha) in &r.stops {
                    k.number(*t).number(c[0]).number(c[1]).number(c[2]);
                    k.number(*alpha);
                }
            }
        }
    }
}

/// What a mark draws inside (Mask `mask@1`; Frame and group): a rect mask's or a frame's
/// scissor, an alpha or luminance mask's coverage from its own paint over its rect, or a group's
/// (or an item's adjust) opacity through one offscreen pass.
#[derive(Clone, Debug, PartialEq)]
pub enum Scope {
    Clip {
        item: String,
        rect: [f64; 4],
    },
    Mask {
        item: String,
        rect: [f64; 4],
        luminance: bool,
        fill: Fill,
    },
    Opacity {
        item: String,
        alpha: f64,
    },
}

impl Scope {
    pub fn item(&self) -> &str {
        match self {
            Scope::Clip { item, .. } | Scope::Mask { item, .. } | Scope::Opacity { item, .. } => {
                item
            }
        }
    }

    fn feed(&self, k: &mut KeyBuilder) {
        k.text(self.item());
        match self {
            Scope::Clip { rect, .. } => {
                k.text("clip");
                rect.iter().for_each(|v| {
                    k.number(*v);
                });
            }
            Scope::Mask {
                rect,
                luminance,
                fill,
                ..
            } => {
                k.text(if *luminance { "luminance" } else { "alpha" });
                rect.iter().for_each(|v| {
                    k.number(*v);
                });
                fill.feed(k);
            }
            Scope::Opacity { alpha, .. } => {
                k.text("opacity").number(*alpha);
            }
        }
    }
}

/// A path's geometry: what its tessellation reads.
#[derive(Clone, Debug, PartialEq)]
pub struct Geometry {
    pub verbs: Vec<path::Verb>,
    pub stroke: Option<f64>,
    pub fill: bool,
}

impl Geometry {
    /// The tessellation's content key at a zoom bucket: its operator, its kind and the params it
    /// reads. Paint and position stay out, so a recolored or moved path reuses its triangles.
    pub fn key(&self, d: &str, bucket: i32) -> ContentKey {
        let mut k = KeyBuilder::new("tessellate@marks2d.1");
        k.text("path@1").text(d).int(i64::from(bucket));
        match self.stroke {
            Some(w) => k.text("stroke").number(w),
            None => k.text("no stroke"),
        };
        k.text(if self.fill { "fill" } else { "no fill" });
        k.finish()
    }

    /// The triangles, in the path's own u.
    pub fn tessellate(&self, bucket: i32) -> Mesh {
        let lines = path::flatten(&self.verbs, path::tolerance(bucket));
        let mut mesh = Mesh::default();
        if self.fill {
            path::fill(&lines, &mut mesh);
        }
        if let Some(width) = self.stroke {
            path::stroke(&lines, width, &mut mesh);
        }
        mesh
    }
}

/// Text's alignment within its box (`align: start | center | end = start`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Start,
    Center,
    End,
}

/// How an image fills its box (Image `image@1`: `fit`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFit {
    Contain,
    Cover,
    Fill,
    None,
}

impl ImageFit {
    /// Where an image of `size` px draws in `bounds` (`[x, y, w, h]`) under this fit, centred.
    pub fn fitted(self, bounds: [f64; 4], size: [u32; 2]) -> [f64; 4] {
        let [x, y, w, h] = bounds;
        let (iw, ih) = (f64::from(size[0]), f64::from(size[1]));
        let (sx, sy) = match self {
            ImageFit::Fill => (w / iw, h / ih),
            ImageFit::Contain => {
                let s = (w / iw).min(h / ih);
                (s, s)
            }
            ImageFit::Cover => {
                let s = (w / iw).max(h / ih);
                (s, s)
            }
            ImageFit::None => (1.0, 1.0),
        };
        let (dw, dh) = (iw * sx, ih * sy);
        [x + (w - dw) / 2.0, y + (h - dh) / 2.0, dw, dh]
    }
}

/// How an image's pixels are sampled when it is drawn at another size (Image `image@1`:
/// `sampling`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum ImageSampling {
    #[default]
    Linear,
    Nearest,
    Cubic,
}

/// A styled span of a text's one shaped run (`runs: [{from, to, role}]`): graphemes `[from, to)`
/// painted in `role`. It changes no glyph, so the run is shaped once and kerns across it.
#[derive(Clone, Debug, PartialEq)]
pub struct TextRun {
    pub from: usize,
    pub to: usize,
    pub role: String,
    pub color: Rgb,
}

/// The role and color a text's grapheme is painted in: its run's, else the item's.
pub fn run_paint<'a>(
    runs: &'a [TextRun],
    grapheme: usize,
    role: Option<&'a str>,
    color: Rgb,
) -> (Option<&'a str>, Rgb) {
    runs.iter()
        .find(|r| (r.from..r.to).contains(&grapheme))
        .map_or((role, color), |r| (Some(r.role.as_str()), r.color))
}

/// A text's runs. This build's runs set only `role`; a run's other fields (font, weight, size,
/// style, tracking, shift, lines) are R6's, refused `module_missing`.
fn text_runs(
    palette: &Palette,
    params: &Map<String, Value>,
    path: &str,
) -> Result<Vec<TextRun>, Refused> {
    let Some(list) = params.get("runs") else {
        return Ok(Vec::new());
    };
    let Some(list) = list.as_array().filter(|l| l.len() <= 1024) else {
        return refuse("bad_doc", format!("{path}/params/runs"));
    };
    let mut out = Vec::with_capacity(list.len());
    for (i, run) in list.iter().enumerate() {
        let at = format!("{path}/params/runs/{i}");
        let Some(fields) = run.as_object() else {
            return refuse("bad_doc", at);
        };
        if let Some(field) = fields
            .keys()
            .find(|k| !["from", "to", "role"].contains(&k.as_str()))
        {
            return refuse("module_missing", format!("{at}/{field}"));
        }
        let index = |k: &str| fields.get(k).and_then(Value::as_u64).map(|n| n as usize);
        let (Some(from), Some(to)) = (index("from"), index("to")) else {
            return refuse("bad_doc", at);
        };
        if from >= to {
            return refuse("out_of_range", format!("{at}/to"));
        }
        let Some(Value::String(name)) = fields.get("role") else {
            return refuse("bad_doc", format!("{at}/role"));
        };
        out.push(TextRun {
            from,
            to,
            color: role(palette, fields.get("role"), &format!("{at}/role"))?,
            role: name.clone(),
        });
    }
    Ok(out)
}

/// What a text mark is shaped from: `text@1`'s text, font role, size, weight, box width and
/// alignment.
#[derive(Clone, Debug, PartialEq)]
pub struct TextSpec {
    pub text: String,
    pub font: String,
    pub size: f64,
    pub weight: u16,
    pub width: Option<f64>,
    pub align: Align,
    /// A bound value: tabular figures, never cut short.
    pub bound: bool,
}

impl TextSpec {
    /// The shaped run's content key: the shaper's inputs, never where the text sits.
    pub fn key(&self) -> ContentKey {
        let mut k = KeyBuilder::new("shape@text.1");
        k.text("text@1")
            .text(&self.text)
            .text(&self.font)
            .number(self.size)
            .int(i64::from(self.weight));
        match self.width {
            Some(w) => k.text("width").number(w),
            None => k.text("auto"),
        };
        k.text(if self.bound { "bound" } else { "free" });
        k.int(self.align as i64);
        k.finish()
    }
}

/// What a `text@1` item is shaped from: its text (or what its bound value or counter shows),
/// font role, size, weight, box width, alignment, and tabular figures for a bound number.
pub fn text_spec(
    id: &str,
    params: &Map<String, Value>,
    shown: Option<&Shown>,
) -> Result<TextSpec, Refused> {
    let path = format!("items/{id}");
    let text = shown.map(|s| s.text.clone()).or_else(|| {
        params
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    let Some(text) = text else {
        return refuse("bad_doc", format!("{path}/params/text"));
    };
    Ok(TextSpec {
        text,
        font: params
            .get("font")
            .and_then(Value::as_str)
            .unwrap_or("body")
            .to_string(),
        size: num(params.get("size")).unwrap_or(13.0),
        weight: params
            .get("weight")
            .and_then(Value::as_u64)
            .and_then(|w| u16::try_from(w).ok())
            .unwrap_or(400),
        width: params.get("box").and_then(|b| num(b.get("w"))),
        bound: shown.is_some() || params.get("numerals").and_then(Value::as_str) == Some("tabular"),
        align: match params.get("align").and_then(Value::as_str) {
            None | Some("start") => Align::Start,
            Some("center") => Align::Center,
            Some("end") => Align::End,
            Some(_) => return refuse("bad_doc", format!("{path}/params/align")),
        },
    })
}

impl TextSpec {
    /// The shaper's spec for this text, or `None` for a font role the shaper doesn't bundle.
    pub fn shaper_spec(&self) -> Option<deep_text::Spec<'_>> {
        Some(deep_text::Spec {
            text: &self.text,
            role: deep_text::Role::parse(&self.font)?,
            size: self.size as f32,
            weight: self.weight,
            line_height: None,
            width: self.width.map(|w| w as f32),
            max_lines: None,
            align: match self.align {
                Align::Start => deep_text::Align::Start,
                Align::Center => deep_text::Align::Center,
                Align::End => deep_text::Align::End,
            },
            bound: self.bound,
            tabular: self.bound,
            mask: false,
        })
    }
}

/// One mark to draw, in logical u at zoom 1.
#[derive(Clone, Debug, PartialEq)]
pub enum Mark {
    Rect {
        item: String,
        bounds: [f64; 4],
        radius: f64,
        fill: Fill,
    },
    /// A solid circle, or a ring when `inner_r` is above 0.
    Circle {
        item: String,
        center: [f64; 2],
        r: f64,
        inner_r: f64,
        color: Rgb,
    },
    Path {
        item: String,
        d: String,
        geometry: Geometry,
        offset: [f64; 2],
        color: Rgb,
    },
    /// R2's outlines: a star, an arc, a path whose fill or stroke is a gradient, or any outline
    /// R1's marks can't draw (a scaled item, a stroked rect or circle, a fill or stroke below
    /// opacity 1, a dashed stroke), in u where the item draws; a fill is `(paint, opacity)`.
    Shape {
        item: String,
        verbs: Vec<Verb>,
        fill: Option<(Fill, f64)>,
        stroke: Option<Line>,
    },
    Text {
        item: String,
        spec: TextSpec,
        origin: [f64; 2],
        /// The look role the item's fill names (`None` for a mark set's or an axis's labels,
        /// colored from their encodings), and its color.
        role: Option<String>,
        color: Rgb,
        /// Spans of the one shaped run painted in their own roles.
        runs: Vec<TextRun>,
    },
    /// An image by its asset's sha256, decoded once by whoever draws it.
    Image {
        item: String,
        asset: String,
        bounds: [f64; 4],
        fit: ImageFit,
        sampling: ImageSampling,
        crop: Option<[f64; 4]>,
        opacity: f64,
        /// The item's adjust, applied to every pixel of the image.
        adjust: Adjust,
    },
}

/// A stroke as drawn (Paint: stroke): its width in u, its paint, its opacity (the paint's times the
/// stroke's), and the dashes each sub-path holds (`dash: {count}`), equal dashes and gaps from
/// the sub-path's start.
#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub width: f64,
    pub paint: Fill,
    pub opacity: f64,
    pub dashes: Option<u16>,
}

/// A mark with the rect its rect masks clip it to, if any (Mask `mask@1`: a rect mask is a
/// scissor), and every scope it draws inside, outermost first.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub mark: Mark,
    pub clip: Option<[f64; 4]>,
    pub scopes: Vec<Scope>,
}

impl Drawn {
    /// What a layer's key reads of the mark: its key at a zoom bucket.
    fn key(&self, bucket: i32) -> ContentKey {
        let mut k = KeyBuilder::new("drawn@marks2d.1");
        self.feed(&mut k, bucket);
        k.finish()
    }

    /// The mark, its scopes and its clip.
    fn feed(&self, k: &mut KeyBuilder, bucket: i32) {
        self.mark.feed(k, bucket);
        self.scopes.iter().for_each(|s| s.feed(k));
        match self.clip {
            Some(c) => c.iter().for_each(|v| {
                k.number(*v);
            }),
            None => {
                k.text("unclipped");
            }
        }
    }
}

impl Mark {
    pub fn item(&self) -> &str {
        match self {
            Mark::Rect { item, .. }
            | Mark::Circle { item, .. }
            | Mark::Path { item, .. }
            | Mark::Shape { item, .. }
            | Mark::Text { item, .. }
            | Mark::Image { item, .. } => item,
        }
    }

    /// Every color the mark draws, through the item's adjust; an image's pixels take it as drawn.
    fn adjust(&mut self, a: &Adjust) {
        match self {
            Mark::Rect { fill, .. } => fill.adjust(a),
            Mark::Circle { color, .. } | Mark::Path { color, .. } => *color = a.rgb(*color),
            Mark::Text { color, runs, .. } => {
                *color = a.rgb(*color);
                runs.iter_mut().for_each(|r| r.color = a.rgb(r.color));
            }
            Mark::Shape { fill, stroke, .. } => {
                fill.iter_mut().for_each(|(f, _)| f.adjust(a));
                stroke.iter_mut().for_each(|l| l.paint.adjust(a));
            }
            Mark::Image { adjust, .. } => *adjust = a.clone(),
        }
    }

    /// The mark's own content key, from everything it draws from.
    pub fn key(&self, bucket: i32) -> ContentKey {
        let mut k = KeyBuilder::new("mark@marks2d.1");
        self.feed(&mut k, bucket);
        k.finish()
    }

    /// Everything the mark draws from, for its layer's key: its geometry's or text's content key
    /// in place of the geometry or text itself.
    fn feed(&self, k: &mut KeyBuilder, bucket: i32) {
        let color = |k: &mut KeyBuilder, c: &Rgb| {
            k.bytes(c);
        };
        k.text(self.item());
        match self {
            Mark::Rect {
                bounds,
                radius,
                fill,
                ..
            } => {
                k.text("rect");
                bounds.iter().for_each(|v| {
                    k.number(*v);
                });
                k.number(*radius);
                fill.feed(k);
            }
            Mark::Shape {
                verbs,
                fill,
                stroke,
                ..
            } => {
                k.text("shape");
                for v in verbs {
                    let (tag, points): (&str, &[[f64; 2]]) = match v {
                        Verb::Move(p) => ("M", std::slice::from_ref(p)),
                        Verb::Line(p) => ("L", std::slice::from_ref(p)),
                        Verb::Quad(a, b) => ("Q", &[*a, *b]),
                        Verb::Cubic(a, b, c) => ("C", &[*a, *b, *c]),
                        Verb::Close => ("Z", &[]),
                    };
                    k.text(tag);
                    points.iter().for_each(|p| {
                        k.number(p[0]).number(p[1]);
                    });
                }
                match fill {
                    Some((f, opacity)) => {
                        f.feed(k);
                        k.number(*opacity);
                    }
                    None => {
                        k.text("no fill");
                    }
                }
                match stroke {
                    Some(l) => {
                        k.text("stroke").number(l.width).number(l.opacity);
                        k.int(l.dashes.map_or(-1, i64::from));
                        l.paint.feed(k);
                    }
                    None => {
                        k.text("no stroke");
                    }
                }
            }
            Mark::Circle {
                center,
                r,
                inner_r,
                color: c,
                ..
            } => {
                k.text("circle")
                    .number(center[0])
                    .number(center[1])
                    .number(*r)
                    .number(*inner_r);
                color(k, c);
            }
            Mark::Path {
                d,
                geometry,
                offset,
                color: c,
                ..
            } => {
                k.text("path").key(&geometry.key(d, bucket));
                k.number(offset[0]).number(offset[1]);
                color(k, c);
            }
            Mark::Text {
                spec,
                origin,
                color: c,
                runs,
                ..
            } => {
                k.text("text").key(&spec.key());
                k.number(origin[0]).number(origin[1]);
                color(k, c);
                for r in runs {
                    k.int(r.from as i64).int(r.to as i64);
                    color(k, &r.color);
                }
            }
            Mark::Image {
                asset,
                bounds,
                fit,
                sampling,
                crop,
                opacity,
                adjust,
                ..
            } => {
                // An asset enters by its sha256, as every asset does.
                k.text("image").text(asset).int(*fit as i64);
                // Linear is the default, so an image without the field keeps its key.
                if *sampling != ImageSampling::Linear {
                    k.text("sampling").int(*sampling as i64);
                }
                bounds.iter().for_each(|v| {
                    k.number(*v);
                });
                if let Some(c) = crop {
                    c.iter().for_each(|v| {
                        k.number(*v);
                    });
                }
                k.number(*opacity);
                if !adjust.is_identity() {
                    let a = adjust;
                    k.text("adjusted").number(a.hue).number(a.saturation);
                    k.number(a.brightness).number(a.contrast).number(a.exposure);
                    k.number(a.gamma).int(i64::from(a.invert));
                    if let Some(t) = a.tint {
                        k.bytes(&t);
                    }
                }
            }
        }
    }
}

/// One writer layer's marks in draw order and its content key.
#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub id: String,
    pub marks: Vec<Drawn>,
    pub key: ContentKey,
}

/// A frame's draw list.
#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub size: [f64; 2],
    pub ground: Rgb,
    pub layers: Vec<Layer>,
}

pub(crate) fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

fn pair(v: Option<&Value>) -> Option<[f64; 2]> {
    match v {
        Some(Value::Array(a)) if a.len() >= 2 => Some([num(a.first())?, num(a.get(1))?]),
        _ => None,
    }
}

fn role(palette: &Palette, name: Option<&Value>, path: &str) -> Result<Rgb, Refused> {
    let Some(Value::String(name)) = name else {
        return refuse("bad_paint", path);
    };
    palette.get(name).copied().ok_or(Refused {
        code: "role_unresolved",
        path: format!("{path}: {name}"),
    })
}

/// A fill over `bounds`: a role, R1's two-stop linear gradient, or any other gradient's ramp.
pub(crate) fn fill_of(
    palette: &Palette,
    fill: &Map<String, Value>,
    path: &str,
    bounds: [f64; 4],
) -> Result<Fill, Refused> {
    if let Some(Value::Object(g)) = fill.get("gradient") {
        let g = paint::gradient(palette, g, &format!("{path}/gradient"), false)?;
        return Ok(match g.two_stop() {
            Some((at, [from, to])) => Fill::Linear { from, to, at },
            None => Fill::Ramp(g.ramp(bounds)),
        });
    }
    Ok(Fill::Solid(role(
        palette,
        fill.get("role"),
        &format!("{path}/role"),
    )?))
}

/// The box of `verbs`' points, `[x, y, w, h]`, a gradient's box on a path.
fn bounds_of(verbs: &[Verb]) -> [f64; 4] {
    let mut b = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for v in verbs {
        let points: &[[f64; 2]] = match v {
            Verb::Move(p) | Verb::Line(p) => std::slice::from_ref(p),
            Verb::Quad(a, c) => &[*a, *c],
            Verb::Cubic(a, c, d) => &[*a, *c, *d],
            Verb::Close => &[],
        };
        for p in points {
            b = [
                b[0].min(p[0]),
                b[1].min(p[1]),
                b[2].max(p[0]),
                b[3].max(p[1]),
            ];
        }
    }
    if b[0] > b[2] {
        return [0.0; 4];
    }
    [b[0], b[1], b[2] - b[0], b[3] - b[1]]
}

/// Four numbers, as a box is written.
fn four(v: Option<&Value>) -> Option<[f64; 4]> {
    let b: Option<Vec<f64>> = v?.as_array()?.iter().map(|v| num(Some(v))).collect();
    <[f64; 4]>::try_from(b?.as_slice()).ok()
}

/// Where an item draws: `x ↦ scale·x + pos` from its evaluated `at`, which already rides its
/// parents as the evaluator composes them. Rotation, shear and the pivot wait for the GPU layer,
/// as R1's marks' do.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Place {
    scale: [f64; 2],
    offset: [f64; 2],
}

impl Place {
    const NONE: Place = Place {
        scale: [1.0, 1.0],
        offset: [0.0, 0.0],
    };

    fn of(item: &Value) -> Place {
        let at = item.get("at");
        let v = |k: &str, i: usize, default: f64| match at.and_then(|a| a.get(k)) {
            Some(Value::Array(a)) => num(a.get(i)).unwrap_or(default),
            Some(n) if k == "scale" => num(Some(n)).unwrap_or(default),
            _ => default,
        };
        Place {
            scale: [v("scale", 0, 1.0), v("scale", 1, 1.0)],
            offset: [v("pos", 0, 0.0), v("pos", 1, 0.0)],
        }
    }

    fn at(&self, p: [f64; 2]) -> [f64; 2] {
        [
            self.scale[0] * p[0] + self.offset[0],
            self.scale[1] * p[1] + self.offset[1],
        ]
    }

    /// True when the place only moves what it holds, as R1's marks can draw.
    fn moves(&self) -> bool {
        self.scale == [1.0, 1.0]
    }

    /// As a gradient's transform.
    fn affine(&self) -> [f64; 6] {
        [
            self.scale[0],
            0.0,
            0.0,
            self.scale[1],
            self.offset[0],
            self.offset[1],
        ]
    }

    /// A box `[x, y, w, h]` where it draws.
    fn rect(&self, [x, y, w, h]: [f64; 4]) -> [f64; 4] {
        let (a, b) = (self.at([x, y]), self.at([x + w, y + h]));
        [
            a[0].min(b[0]),
            a[1].min(b[1]),
            (b[0] - a[0]).abs(),
            (b[1] - a[1]).abs(),
        ]
    }

    fn verbs(&self, verbs: Vec<Verb>) -> Vec<Verb> {
        let m = |p: [f64; 2]| self.at(p);
        verbs
            .into_iter()
            .map(|v| match v {
                Verb::Move(p) => Verb::Move(m(p)),
                Verb::Line(p) => Verb::Line(m(p)),
                Verb::Quad(a, b) => Verb::Quad(m(a), m(b)),
                Verb::Cubic(a, b, c) => Verb::Cubic(m(a), m(b), m(c)),
                Verb::Close => Verb::Close,
            })
            .collect()
    }
}

/// The most dashes one path draws (Paint: "at most 10,000 dashes per path").
const MAX_DASHES: u64 = 10_000;

/// An `opacity` at `path`: 1 when left out, and within 0..1.
fn opacity(v: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match v {
        None => Ok(1.0),
        Some(o) => num(Some(o))
            .filter(|o| (0.0..=1.0).contains(o))
            .ok_or(Refused {
                code: "out_of_range",
                path: path.into(),
            }),
    }
}

/// What a paint reads beyond its item: the document's items and collections, and, once a first
/// pass has drawn them, each item's box with its descendants' (`span`, and steps by position).
struct Paints<'a> {
    doc: &'a Map<String, Value>,
    items: &'a Map<String, Value>,
    palette: &'a Palette,
    boxes: Option<&'a BTreeMap<String, [f64; 4]>>,
    /// Set when a paint asked for a box before there were any.
    wants_boxes: Cell<bool>,
}

impl Paints<'_> {
    /// `id`'s box with its descendants', where they draw; none yet on the first pass.
    fn box_of(&self, id: &str, path: &str) -> Result<Option<[f64; 4]>, Refused> {
        let Some(boxes) = self.boxes else {
            self.wants_boxes.set(true);
            return Ok(None);
        };
        boxes.get(id).copied().map(Some).ok_or(Refused {
            code: "ref_unresolved",
            path: format!("{path}: {id}"),
        })
    }

    /// The paint of `id`'s fill or stroke `p` at `path`: a role, a stepped color, or a gradient
    /// over `bounds` (in the space `place` draws from) or over the box it spans.
    fn paint(
        &self,
        id: &str,
        p: &Map<String, Value>,
        path: &str,
        bounds: [f64; 4],
        place: Place,
        stroke: bool,
    ) -> Result<Fill, Refused> {
        if let Some(Value::Object(g)) = p.get("gradient") {
            let path = format!("{path}/gradient");
            let g = paint::gradient(self.palette, g, &path, stroke)?;
            let target = match g.span() {
                Span::Item => None,
                Span::Parent => Some(
                    self.items
                        .get(id)
                        .and_then(|i| i.get("parent"))
                        .and_then(Value::as_str)
                        .ok_or(Refused {
                            code: "ref_unresolved",
                            path: format!("{path}/span"),
                        })?,
                ),
                Span::Of(other) => Some(other.as_str()),
            };
            if let Some(target) = target {
                let spanned = self.box_of(target, &format!("{path}/span"))?;
                return Ok(Fill::Ramp(g.ramp(spanned.unwrap_or(bounds))));
            }
            if place.moves() {
                if let Some((at, [from, to])) = g.two_stop() {
                    return Ok(Fill::Linear { from, to, at });
                }
            }
            let mut ramp = g.ramp(bounds);
            ramp.transform = place.affine();
            return Ok(Fill::Ramp(ramp));
        }
        if let Some(Value::Object(s)) = p.get("steps") {
            let path = format!("{path}/steps");
            let steps = paint::steps(self.palette, s, &path)?;
            return Ok(Fill::Solid(steps.color(self.step(id, &steps, &path)?)));
        }
        Ok(Fill::Solid(role(
            self.palette,
            p.get("role"),
            &format!("{path}/role"),
        )?))
    }

    /// Where `id` sits along a stepped fill's stops: by its rank among the members in draw order
    /// (order key, then ID), or by its box's center across theirs.
    fn step(&self, id: &str, steps: &Steps, path: &str) -> Result<f64, Refused> {
        fn parent(i: &Value) -> Option<&str> {
            i.get("parent").and_then(Value::as_str)
        }
        let mut members: Vec<&str> = match &steps.over {
            Over::Children => match self.items.get(id).and_then(parent) {
                Some(p) => self
                    .items
                    .iter()
                    .filter(|(_, i)| parent(i) == Some(p))
                    .map(|(m, _)| m.as_str())
                    .collect(),
                None => vec![id],
            },
            Over::Collection(c) => {
                let Some(Value::Array(m)) = self
                    .doc
                    .get("collections")
                    .and_then(|cs| cs.get(c))
                    .and_then(|c| c.get("members"))
                else {
                    return refuse("ref_unresolved", format!("{path}/over"));
                };
                m.iter().filter_map(Value::as_str).collect()
            }
        };
        if !members.contains(&id) {
            return refuse("bad_paint", format!("{path}/over"));
        }
        let key = |m: &str| {
            self.items
                .get(m)
                .and_then(|i| i.get("order"))
                .and_then(Value::as_str)
                .unwrap_or("")
        };
        members.sort_by(|a, b| key(a).cmp(key(b)).then_with(|| a.cmp(b)));
        if steps.by == By::Order {
            let rank = members.iter().position(|m| *m == id).unwrap_or(0);
            return Ok(match members.len() {
                0 | 1 => 0.0,
                n => rank as f64 / (n - 1) as f64,
            });
        }
        // By position: each member's box center.
        let mut centers = Vec::with_capacity(members.len());
        let mut own = None;
        for m in &members {
            let Some([x, y, w, h]) = self.box_of(m, &format!("{path}/over"))? else {
                return Ok(0.0);
            };
            let c = [x + w / 2.0, y + h / 2.0];
            if *m == id {
                own = Some(c);
            }
            centers.push(c);
        }
        let Some(c) = own else { return Ok(0.0) };
        let across = |k: usize| {
            let (lo, hi) = centers
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| {
                    (lo.min(p[k]), hi.max(p[k]))
                });
            if hi > lo {
                (c[k] - lo) / (hi - lo)
            } else {
                0.0
            }
        };
        Ok(match steps.by {
            By::Order | By::X => across(0),
            By::Y => across(1),
            By::Distance { from, radius } => {
                (deep_canvas::ops::hypot(c[0] - from[0], c[1] - from[1]) / radius).min(1.0)
            }
        })
    }

    /// A path-like item's outline as a [`Mark::Shape`] where it draws: `verbs` in the item's own
    /// space, its fill and its stroke each a role, a stepped color or a gradient over the
    /// outline's box, at their opacity.
    fn shape(
        &self,
        id: &str,
        verbs: Vec<Verb>,
        place: Place,
        paint: &Map<String, Value>,
        path: &str,
    ) -> Result<Mark, Refused> {
        let bounds = bounds_of(&verbs);
        let all = opacity(paint.get("opacity"), &format!("{path}/opacity"))?;
        let fill = match paint.get("fill").and_then(Value::as_object) {
            Some(f) => {
                let path = format!("{path}/fill");
                Some((
                    self.paint(id, f, &path, bounds, place, false)?,
                    all * opacity(f.get("opacity"), &format!("{path}/opacity"))?,
                ))
            }
            None => None,
        };
        let stroke = match paint.get("stroke").and_then(Value::as_object) {
            Some(s) => {
                let path = format!("{path}/stroke");
                // A stroke keeps its width under a scale unless it asks to scale with it.
                let k = if s.get("scale_stroke") == Some(&Value::Bool(true)) {
                    deep_canvas::ops::sqrt((place.scale[0] * place.scale[1]).abs())
                } else {
                    1.0
                };
                let dashes = match s.get("dash").and_then(|d| d.get("count")) {
                    None => None,
                    Some(c) => {
                        let subpaths =
                            verbs.iter().filter(|v| matches!(v, Verb::Move(_))).count() as u64;
                        let count = c
                            .as_u64()
                            .filter(|n| (1..=MAX_DASHES).contains(&(n * subpaths.max(1))))
                            .and_then(|n| u16::try_from(n).ok());
                        Some(count.ok_or(Refused {
                            code: "out_of_range",
                            path: format!("{path}/dash/count"),
                        })?)
                    }
                };
                Some(Line {
                    width: num(s.get("width")).unwrap_or(1.0) * k,
                    paint: self.paint(id, s, &path, bounds, place, true)?,
                    opacity: all * opacity(s.get("opacity"), &format!("{path}/opacity"))?,
                    dashes,
                })
            }
            None => None,
        };
        Ok(Mark::Shape {
            item: id.to_string(),
            verbs: place.verbs(verbs),
            fill,
            stroke,
        })
    }
}

/// True when `paint` holds only what R1's marks draw: no opacity, dash or `scale_stroke`.
fn r1_paint(paint: &Map<String, Value>) -> bool {
    let plain = |p: Option<&Value>| {
        p.and_then(Value::as_object).is_none_or(|p| {
            !["opacity", "dash", "scale_stroke"]
                .iter()
                .any(|k| p.contains_key(*k))
        })
    };
    paint.get("opacity").is_none() && plain(paint.get("fill")) && plain(paint.get("stroke"))
}

/// Each item's box with its descendants' where they draw, from a frame's marks (a mark set's rows
/// count for the set).
fn boxes_of(frame: &Frame, items: &Map<String, Value>) -> BTreeMap<String, [f64; 4]> {
    let union = |a: Option<[f64; 4]>, b: [f64; 4]| match a {
        None => b,
        Some([x, y, w, h]) => {
            let (x0, y0) = (x.min(b[0]), y.min(b[1]));
            let (x1, y1) = ((x + w).max(b[0] + b[2]), (y + h).max(b[1] + b[3]));
            [x0, y0, x1 - x0, y1 - y0]
        }
    };
    let mut own: BTreeMap<String, [f64; 4]> = BTreeMap::new();
    for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
        let b = match &drawn.mark {
            Mark::Rect { bounds, .. } | Mark::Image { bounds, .. } => *bounds,
            Mark::Circle { center, r, .. } => [center[0] - r, center[1] - r, 2.0 * r, 2.0 * r],
            Mark::Path {
                geometry, offset, ..
            } => {
                let [x, y, w, h] = bounds_of(&geometry.verbs);
                [x + offset[0], y + offset[1], w, h]
            }
            Mark::Shape { verbs, .. } => bounds_of(verbs),
            Mark::Text { .. } => continue,
        };
        let id = drawn.mark.item().split('#').next().unwrap_or("");
        own.insert(id.to_string(), union(own.get(id).copied(), b));
    }
    let mut out = own.clone();
    for (id, b) in &own {
        let mut at = items
            .get(id)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str);
        for _ in 0..items.len() {
            let Some(p) = at else { break };
            out.insert(p.to_string(), union(out.get(p).copied(), *b));
            at = items
                .get(p)
                .and_then(|i| i.get("parent"))
                .and_then(Value::as_str);
        }
    }
    out
}

/// A format's notation (Bound value: `fixed | compact | percent | duration`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Notation {
    #[default]
    Fixed,
    /// 1.2K, 3.4M, 5.6B, 7.8T: one decimal unless `precision` says otherwise.
    Compact,
    Percent,
    /// A reading in seconds (or in ms with `unit: ms`) as 450 ms, 3.5 s, 2 min 05 s or 1 h 02 min.
    Duration,
}

/// How a bound value or a counter shows its number (canvas primitives: Bound value, `format`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Format {
    pub unit: Option<String>,
    pub precision: Option<u32>,
    pub notation: Notation,
    pub sign_always: bool,
    /// `group: locale`, the default: thousands grouped by commas.
    pub ungrouped: bool,
    /// `missing: hide`: an empty text where the reading is missing, instead of a dash.
    pub hide_missing: bool,
    /// The view's locale's group separator and decimal mark (`group: locale`).
    pub marks: Marks,
}

/// A locale's thousands separator and decimal mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Marks {
    pub group: char,
    pub decimal: char,
}

impl Default for Marks {
    fn default() -> Self {
        Marks::of("en")
    }
}

impl Marks {
    /// The marks a BCP 47 locale writes numbers with (CLDR's latn numbering for these
    /// languages; any other takes English's).
    pub fn of(locale: &str) -> Marks {
        let language = locale
            .split(['-', '_'])
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        match language.as_str() {
            "de" | "es" | "it" | "nl" | "pt" | "da" | "id" | "tr" => Marks {
                group: '.',
                decimal: ',',
            },
            "fr" | "nb" | "sv" | "fi" | "cs" | "pl" | "ru" | "uk" => Marks {
                group: '\u{202f}',
                decimal: ',',
            },
            _ => Marks {
                group: ',',
                decimal: '.',
            },
        }
    }
}

impl Format {
    fn read(value: Option<&Value>, missing: Option<&Value>, path: &str) -> Result<Format, Refused> {
        let mut f = Format {
            hide_missing: match missing.and_then(Value::as_str) {
                None | Some("dash") => false,
                Some("hide") => true,
                Some(_) => return refuse("bad_format", format!("{path}/missing")),
            },
            ..Format::default()
        };
        let Some(value) = value else { return Ok(f) };
        let Value::Object(map) = value else {
            return refuse("bad_format", format!("{path}/format"));
        };
        f.unit = map.get("unit").and_then(Value::as_str).map(str::to_string);
        f.precision = match map.get("precision") {
            None => None,
            Some(p) => match p.as_u64().filter(|p| *p <= 12) {
                Some(p) => Some(p as u32),
                None => return refuse("bad_format", format!("{path}/format/precision")),
            },
        };
        f.notation = match map.get("notation").and_then(Value::as_str) {
            None | Some("fixed") => Notation::Fixed,
            Some("compact") => Notation::Compact,
            Some("percent") => Notation::Percent,
            Some("duration") => Notation::Duration,
            Some(_) => return refuse("format_notation", format!("{path}/format/notation")),
        };
        if f.notation == Notation::Duration
            && f.unit.as_deref().is_some_and(|u| u != "s" && u != "ms")
        {
            return refuse("bad_format", format!("{path}/format/unit"));
        }
        f.sign_always = match map.get("sign").and_then(Value::as_str) {
            None | Some("auto") => false,
            Some("always") => true,
            Some(_) => return refuse("bad_format", format!("{path}/format/sign")),
        };
        f.ungrouped = match map.get("group").and_then(Value::as_str) {
            None | Some("locale") => false,
            Some("none") => true,
            Some(_) => return refuse("bad_format", format!("{path}/format/group")),
        };
        Ok(f)
    }

    /// The text for a reading, or for a missing one.
    pub fn show(&self, reading: Option<f64>) -> String {
        let Some(n) = reading else {
            return if self.hide_missing {
                String::new()
            } else {
                "—".into()
            };
        };
        let (body, suffix) = match self.notation {
            Notation::Fixed => (self.digits(n.abs(), self.precision), String::new()),
            Notation::Percent => (self.digits(n.abs() * 100.0, self.precision), "%".into()),
            Notation::Compact => self.compact(n.abs()),
            Notation::Duration => (self.duration(n.abs()), String::new()),
        };
        let sign = if n < 0.0 && body.chars().any(|c| c.is_ascii_digit() && c != '0') {
            "−"
        } else if self.sign_always && n > 0.0 {
            "+"
        } else {
            ""
        };
        let unit = match (&self.unit, self.notation) {
            (_, Notation::Percent | Notation::Duration) => String::new(),
            (Some(u), _) if u == "%" || u == "°" => u.clone(),
            (Some(u), _) => format!(" {u}"),
            (None, _) => String::new(),
        };
        format!("{sign}{body}{suffix}{unit}")
    }

    /// A magnitude's digits: `precision` decimals, or its shortest form; thousands grouped
    /// unless `group: none`.
    fn digits(&self, v: f64, precision: Option<u32>) -> String {
        let body = match precision {
            Some(p) => format!("{:.*}", p as usize, v),
            None if v.fract() == 0.0 && v < 1e15 => format!("{}", v as i64),
            None => format!("{v}"),
        };
        let (int, frac) = match body.split_once('.') {
            Some((i, f)) => (i.to_string(), Some(f.to_string())),
            None => (body, None),
        };
        let mut grouped = String::new();
        for (i, c) in int.chars().enumerate() {
            if !self.ungrouped && i > 0 && (int.len() - i) % 3 == 0 {
                grouped.push(self.marks.group);
            }
            grouped.push(c);
        }
        match frac {
            Some(frac) => format!("{grouped}{}{frac}", self.marks.decimal),
            None => grouped,
        }
    }

    /// A magnitude in thousands, millions, billions or trillions, moving up a step where
    /// rounding reaches 1,000 of the step below (999,950 is 1.0M).
    fn compact(&self, v: f64) -> (String, String) {
        const STEPS: [(f64, &str); 5] =
            [(1.0, ""), (1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T")];
        let precision = self.precision.unwrap_or(1);
        let scale = deep_canvas::ops::powi(10.0, precision as i32);
        let round = |x: f64| (x * scale).round() / scale;
        let mut pick = STEPS.iter().rposition(|(step, _)| v >= *step).unwrap_or(0);
        while pick > 0 && pick + 1 < STEPS.len() && round(v / STEPS[pick].0) >= 1000.0 {
            pick += 1;
        }
        if pick == 0 {
            return (self.digits(v, self.precision), String::new());
        }
        let (step, letter) = STEPS[pick];
        (self.digits(round(v / step), Some(precision)), letter.into())
    }

    /// Seconds (or ms with `unit: ms`) as 450 ms, 3.5 s, 2 min 05 s or 1 h 02 min.
    fn duration(&self, v: f64) -> String {
        let seconds = if self.unit.as_deref() == Some("ms") {
            v / 1000.0
        } else {
            v
        };
        if seconds < 1.0 {
            return format!(
                "{} ms",
                self.digits(seconds * 1000.0, Some(self.precision.unwrap_or(0)))
            );
        }
        if seconds < 60.0 {
            let p = self.precision.unwrap_or(1);
            let mut text = self.digits(seconds, Some(p));
            if self.precision.is_none() && text.ends_with(&format!("{}0", self.marks.decimal)) {
                text.truncate(text.len() - 2);
            }
            return format!("{text} s");
        }
        let whole = seconds.round() as i64;
        if whole < 3600 {
            format!("{} min {:02} s", whole / 60, whole % 60)
        } else {
            let minutes = (seconds / 60.0).round() as i64;
            format!("{} h {:02} min", minutes / 60, minutes % 60)
        }
    }
}

/// The record as pinned to one frame (canvas primitives: Bound value; Status binding): each
/// reading's value and as-of time, each status source's state, and the time the frame is pinned
/// to, the host time live and the mapped record time in a replay, on the record's clock.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Record {
    pub readings: BTreeMap<String, f64>,
    pub as_of: BTreeMap<String, i64>,
    pub states: BTreeMap<String, String>,
    pub pinned: i64,
}

/// A bound value as a frame shows it: its text, whether it is stale and the age it shows, and the
/// pinned time its text next changes (when it goes stale, or when the age it shows ticks).
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub bound: String,
    pub text: String,
    pub stale: bool,
    pub age: Option<i64>,
    pub changes_at: Option<i64>,
}

const FLICKS_PER_SECOND: i64 = 705_600_000;

/// An age as a stale value shows it, whole seconds, minutes or hours, and the age it next ticks at.
fn age_text(age: i64) -> (String, i64) {
    let s = age.div_euclid(FLICKS_PER_SECOND);
    let (n, unit, step) = if s < 60 {
        (s, "s", 1)
    } else if s < 3600 {
        (s / 60, "min", 60)
    } else {
        (s / 3600, "h", 3600)
    };
    (
        format!("{n} {unit} old"),
        (n + 1) * step * FLICKS_PER_SECOND,
    )
}

/// The text of a bound value's reading, stale or live, at the frame's pinned time.
fn show(
    clock: &Value,
    bid: &str,
    b: &Value,
    format: &Format,
    source: &str,
    record: &Record,
) -> Result<Shown, Refused> {
    let path = format!("bound_values/{bid}/stale_after");
    let stale_after = match b.get("stale_after") {
        None => None,
        Some(v) => {
            Some(deep_canvas::document::duration(clock, v).or_else(|_| refuse("bad_time", &path))?)
        }
    };
    let value = record.readings.get(source).copied();
    let text = format.show(value);
    let (Some(after), Some(as_of), Some(_)) = (stale_after, record.as_of.get(source), value) else {
        return Ok(Shown {
            bound: bid.to_string(),
            text,
            stale: false,
            age: None,
            changes_at: None,
        });
    };
    let age = record.pinned - as_of;
    if age < after {
        return Ok(Shown {
            bound: bid.to_string(),
            text,
            stale: false,
            age: None,
            changes_at: Some(as_of + after),
        });
    }
    // A stale value greys out and shows its age; the frame clock arms again when the age ticks.
    let (shown_age, next) = age_text(age);
    Ok(Shown {
        bound: bid.to_string(),
        text: format!("{text} · {shown_age}"),
        stale: true,
        age: Some(age),
        changes_at: Some(as_of + next),
    })
}

/// What every bound value and counter shows: item ID → its reading, formatted, or what its
/// `missing` says where the run supplies none, stale once its reading is older than its
/// `stale_after`. A counter is a text whose `text` is `{counter: {source: <bound value ID>,
/// format}}`: it formats that bound value's reading as it changes, with tabular figures (canvas
/// primitives: Text animator and counter). Numbers are written as `en` writes them.
pub fn bound_texts(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    record: &Record,
) -> Result<BTreeMap<String, Shown>, Refused> {
    let mut out = BTreeMap::new();
    for id in bound_ids(doc, items)? {
        let item = items.get(&id).unwrap_or(&Value::Null);
        if let Some(shown) = bound_text(doc, &id, item, record, "en")? {
            out.insert(id, shown);
        }
    }
    Ok(out)
}

/// Every item a bound value's text targets or that is a counter, in ID order.
fn bound_ids(doc: &Map<String, Value>, items: &Map<String, Value>) -> Result<Vec<String>, Refused> {
    let mut ids: Vec<String> = Vec::new();
    if let Some(bound) = doc.get("bound_values").and_then(Value::as_object) {
        for (bid, b) in bound {
            let (Some(Value::String(target)), Some(Value::String(_))) =
                (b.get("target"), b.get("source"))
            else {
                return refuse("bad_doc", format!("bound_values/{bid}"));
            };
            if let ["items", id, "params", "text"] = target.split('/').collect::<Vec<_>>()[..] {
                ids.push(id.to_string());
            }
        }
    }
    for (id, item) in items {
        if counter_of(item).is_some() || template_of(item).is_some() {
            ids.push(id.clone());
        }
    }
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn counter_of(item: &Value) -> Option<&Map<String, Value>> {
    item.get("params")?.get("text")?.get("counter")?.as_object()
}

pub(crate) fn template_of(item: &Value) -> Option<&str> {
    item.get("params")?.get("template")?.as_str()
}

/// What one item shows when a bound value's text targets it or it is a counter, its numbers
/// written as `locale` writes them; `None` for any other item. A counter's own format wins
/// over its bound value's.
pub fn bound_text(
    doc: &Map<String, Value>,
    id: &str,
    item: &Value,
    record: &Record,
    locale: &str,
) -> Result<Option<Shown>, Refused> {
    if let Some(template) = template_of(item) {
        // A template shows each slot's value at its own precision (Text `text@1`, `template`).
        let text = deep_canvas::template::expand(&Value::Object(doc.clone()), template)
            .or_else(|_| refuse("ref_unresolved", format!("items/{id}/params/template")))?;
        return Ok(Some(Shown {
            bound: "template".into(),
            text,
            stale: false,
            age: None,
            changes_at: None,
        }));
    }
    let empty = Map::new();
    let bound = doc
        .get("bound_values")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    // All a stale-after duration reads of the document is its transport's frame rate.
    let clock = serde_json::json!({"transport": doc.get("transport")});
    let mut out = None;
    for (bid, b) in bound {
        let path = format!("bound_values/{bid}");
        let (Some(Value::String(target)), Some(Value::String(source))) =
            (b.get("target"), b.get("source"))
        else {
            return refuse("bad_doc", path);
        };
        if target.as_str() != format!("items/{id}/params/text") {
            continue;
        }
        let mut format = Format::read(b.get("format"), b.get("missing"), &path)?;
        format.marks = Marks::of(locale);
        out = Some(show(&clock, bid, b, &format, source, record)?);
    }
    if let Some(counter) = counter_of(item) {
        let path = format!("items/{id}/params/text/counter");
        let Some(b) = counter
            .get("source")
            .and_then(Value::as_str)
            .and_then(|s| bound.get(s))
        else {
            return refuse("ref_unresolved", format!("{path}/source"));
        };
        let Some(Value::String(source)) = b.get("source") else {
            return refuse("bad_doc", format!("{path}/source"));
        };
        let mut format = Format::read(
            counter.get("format").or(b.get("format")),
            b.get("missing"),
            &path,
        )?;
        format.marks = Marks::of(locale);
        let bid = counter.get("source").and_then(Value::as_str).unwrap_or("");
        out = Some(show(&clock, bid, b, &format, source, record)?);
    }
    Ok(out)
}

/// The readings bound to mark sets' cells (`items/<set>#<key>/<column>`): set ID → its cells'
/// readings.
fn bound_rows(doc: &Map<String, Value>, record: &Record) -> BTreeMap<String, data::BoundRows> {
    let mut out: BTreeMap<String, data::BoundRows> = BTreeMap::new();
    let Some(Value::Object(bound)) = doc.get("bound_values") else {
        return out;
    };
    for b in bound.values() {
        let (Some(Value::String(target)), Some(Value::String(source))) =
            (b.get("target"), b.get("source"))
        else {
            continue;
        };
        if let ["items", part, column] = target.split('/').collect::<Vec<_>>().as_slice() {
            if let Some((set, key)) = part.split_once('#') {
                out.entry(set.to_string()).or_default().insert(
                    (key.to_string(), (*column).to_string()),
                    record.readings.get(source).copied(),
                );
            }
        }
    }
    out
}

/// The paint slot a status binding owns (Status binding: `fill | stroke | badge`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    /// The item's own fill: a rect or a circle drawn in the status color, its glyph and word inside.
    Fill,
    /// A ring of the look's `core_min_px` around the item, and a chip with the glyph at its corner.
    Stroke,
    /// A chip in the status color with the glyph, at the item's top right corner.
    Badge,
}

impl Slot {
    pub fn name(self) -> &'static str {
        match self {
            Slot::Fill => "fill",
            Slot::Stroke => "stroke",
            Slot::Badge => "badge",
        }
    }
}

/// A status mark: a status binding's item drawn in its source's state, after every writer layer,
/// with the state's glyph and word in the same item (canvas primitives: Status binding; The
/// status-color rule).
#[derive(Clone, Debug, PartialEq)]
pub struct StatusMark {
    pub item: String,
    pub binding: String,
    pub slot: Slot,
    pub state: &'static str,
    pub color: Rgb,
    /// The item's box, in u.
    pub bounds: [f64; 4],
    /// A rect's corner radius; a circle's is half its box.
    pub radius: f64,
    pub glyph: String,
    pub word: &'static str,
    /// The label's color: the theme's ink or ground, whichever contrasts more with the color.
    pub ink: Rgb,
    /// The look's `core_min_px`: a stroke's width and a chip's smallest side.
    pub core: f64,
    /// The look's outline around the mark, `(px, color)`, if it has one.
    pub outline: Option<(f64, Rgb)>,
}

/// An item's box in u, for a status mark: a rect's box, a circle's square, a text's box.
fn status_box(kind: &str, item: &Value, params: Option<&Value>) -> Option<([f64; 4], f64)> {
    let pos = pair(item.get("at").and_then(|a| a.get("pos"))).unwrap_or([0.0, 0.0]);
    let p = |k: &str| params.and_then(|p| p.get(k));
    match kind {
        "rect@1" => {
            let b: Option<Vec<f64>> = p("box")?.as_array()?.iter().map(|v| num(Some(v))).collect();
            let [x, y, w, h] = <[f64; 4]>::try_from(b?.as_slice()).ok()?;
            Some((
                [x + pos[0], y + pos[1], w, h],
                num(p("radius")).unwrap_or(0.0),
            ))
        }
        "circle@1" => {
            let c = pair(p("center"))?;
            let r = num(p("r"))?;
            Some(([c[0] + pos[0] - r, c[1] + pos[1] - r, 2.0 * r, 2.0 * r], r))
        }
        "text@1" => {
            let b = p("box")?;
            let size = num(p("size")).unwrap_or(13.0);
            let h = num(b.get("h")).unwrap_or((1.3 * size).round());
            Some(([pos[0], pos[1], num(b.get("w"))?, h], 0.0))
        }
        _ => None,
    }
}

/// Every status binding's mark, in binding ID order, from the look's status map by the state the
/// record gives its source. A fill colors a rect or a circle; a stroke rings and a badge marks a
/// rect, a circle or a text. A source the record doesn't hold is `ref_unresolved`, never a guess,
/// and a filled mark under the look's `core_min_px` is `status_too_small`.
pub fn status_marks(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    record: &Record,
    status: Option<&crate::look::Status>,
    palette: &Palette,
) -> Result<Vec<StatusMark>, Refused> {
    let Some(Value::Object(bindings)) = doc.get("status_bindings") else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for (bid, b) in bindings {
        let path = format!("status_bindings/{bid}");
        let Some(status) = status else {
            return refuse("status_unmapped", format!("look: status, for {path}"));
        };
        let (Some(Value::String(target)), Some(Value::String(source))) =
            (b.get("target"), b.get("source"))
        else {
            return refuse("bad_doc", path);
        };
        let parts: Vec<&str> = target.split('/').collect();
        let (id, slot) = match parts.as_slice() {
            ["items", id, "params", "paint", "fill"] => (*id, Slot::Fill),
            ["items", id, "params", "paint", "stroke"] => (*id, Slot::Stroke),
            ["items", id, "params", "paint", "badge"] => (*id, Slot::Badge),
            _ => return refuse("bad_doc", format!("{path}/target")),
        };
        let Some(item) = items.get(id) else {
            return refuse("ref_unresolved", format!("{path}/target"));
        };
        if item.get("visible") == Some(&Value::Bool(false)) {
            continue;
        }
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let params = item.get("params");
        let Some((bounds, radius)) = status_box(kind, item, params) else {
            return refuse("status_slot_kind", format!("{path}/target: {kind}"));
        };
        // A text's fill is its ink, which can't carry a status color and its glyph at once.
        if slot == Slot::Fill && kind == "text@1" {
            return refuse("status_slot_kind", format!("{path}/target: {kind}"));
        }
        if slot == Slot::Fill && bounds[2].min(bounds[3]) < status.core_min_px {
            return refuse("status_too_small", format!("items/{id}"));
        }
        let Some(state) = record.states.get(source) else {
            return refuse("ref_unresolved", format!("{path}/source: {source}"));
        };
        let Some(&state) = crate::look::STATES.iter().find(|s| *s == state) else {
            return refuse("out_of_range", format!("{path}/source: {state}"));
        };
        let color = status.colors[state];
        let named = |r: &str| {
            role(
                palette,
                Some(&Value::String(r.into())),
                &format!("look: {r}"),
            )
        };
        let (ink, ground) = (named("ink")?, named("ground")?);
        let ink = if crate::look::contrast(ink, color) >= crate::look::contrast(ground, color) {
            ink
        } else {
            ground
        };
        let outline = match &status.outline {
            Some((px, r)) => Some((*px, named(r)?)),
            None => None,
        };
        out.push(StatusMark {
            item: id.to_string(),
            binding: bid.clone(),
            slot,
            state,
            color,
            bounds,
            radius,
            glyph: status.glyphs[state].clone(),
            word: crate::look::word(state).unwrap_or(state),
            ink,
            core: status.core_min_px,
            outline,
        });
    }
    Ok(out)
}

/// A mark with its item's order key and ID, which sort it within its layer.
/// A mark in its layer's draw order: its item's order key, its row, its item's ID.
type Ordered<'a> = (&'a str, usize, &'a str, &'a Drawn, ContentKey);

/// The most masks that may clip one item (Mask: "nest deeper than 4" it can never).
const MASK_DEPTH: usize = 4;

/// A mask's scope over the items it applies to: a scissor for a shape mask, coverage from its own
/// paint for an alpha or luminance one. Other shapes, feathers, inverted and combined masks wait
/// for Vello GPU (#385).
fn mask_scope(id: &str, item: &Value, palette: &Palette) -> Result<Scope, Refused> {
    let path = format!("items/{id}/params");
    let empty = Map::new();
    let p = item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    if p.get("shape").and_then(Value::as_str).unwrap_or("rect") != "rect" {
        return refuse("mask_r2", format!("{path}/shape"));
    }
    let soft = num(p.get("feather")).unwrap_or(0.0) != 0.0
        || p.get("invert") == Some(&Value::Bool(true))
        || p.get("combine")
            .and_then(Value::as_str)
            .is_some_and(|c| c != "add");
    if soft {
        return refuse("mask_r2", path);
    }
    let b: Option<Vec<f64>> = p
        .get("box")
        .and_then(Value::as_array)
        .map(|b| b.iter().map(|v| num(Some(v))).collect())
        .unwrap_or(None);
    let Some([x, y, w, h]) = b.as_deref().and_then(|b| <[f64; 4]>::try_from(b).ok()) else {
        return refuse("bad_doc", format!("{path}/box"));
    };
    let e = num(p.get("expand")).unwrap_or(0.0);
    let rect = Place::of(item).rect([x - e, y - e, w + 2.0 * e, h + 2.0 * e]);
    let luminance = match p.get("mode").and_then(Value::as_str) {
        None | Some("shape") => {
            return Ok(Scope::Clip {
                item: id.to_string(),
                rect,
            })
        }
        Some("alpha") => false,
        Some("luminance") => true,
        Some(_) => return refuse("bad_doc", format!("{path}/mode")),
    };
    // Alpha and luminance take coverage from the mask's own paint.
    let Some(fill) = p
        .get("paint")
        .and_then(|pt| pt.get("fill"))
        .and_then(Value::as_object)
    else {
        return refuse("bad_paint", format!("{path}/paint/fill"));
    };
    Ok(Scope::Mask {
        item: id.to_string(),
        fill: fill_of(palette, fill, &format!("{path}/paint/fill"), rect)?,
        rect,
        luminance,
    })
}

/// The scope an ancestor puts its children in: a mask's, a frame's overflow scissor, or a group's
/// opacity (one offscreen pass, which GPUI's per-primitive opacity can't do).
fn ancestor_scope(id: &str, item: &Value, palette: &Palette) -> Result<Option<Scope>, Refused> {
    let p = item.get("params");
    let get = |k: &str| p.and_then(|p| p.get(k));
    Ok(match item.get("kind").and_then(Value::as_str) {
        Some("mask@1") => match get("applies_to").and_then(Value::as_str) {
            None | Some("children") => Some(mask_scope(id, item, palette)?),
            Some(_) => None,
        },
        Some("frame@1") if get("overflow").and_then(Value::as_str) != Some("show") => {
            Some(Scope::Clip {
                item: id.to_string(),
                rect: Place::of(item).rect(frame_box(id, item)?),
            })
        }
        Some("group@1") => {
            let alpha = num(get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0);
            (alpha < 1.0 || get("isolate") == Some(&Value::Bool(true))).then(|| Scope::Opacity {
                item: id.to_string(),
                alpha,
            })
        }
        _ => None,
    })
}

fn frame_box(id: &str, item: &Value) -> Result<[f64; 4], Refused> {
    let b: Option<Vec<f64>> = item
        .get("params")
        .and_then(|p| p.get("box"))
        .and_then(Value::as_array)
        .map(|b| b.iter().map(|v| num(Some(v))).collect())
        .unwrap_or(None);
    b.as_deref()
        .and_then(|b| <[f64; 4]>::try_from(b).ok())
        .ok_or(Refused {
            code: "bad_doc",
            path: format!("items/{id}/params/box"),
        })
}

/// Each item's scopes, outermost first: its ancestors' (a mask's children are the items whose
/// `parent` it is, at any depth), then the masks whose collection holds it. A mask never reaches
/// another writer's items, and a fifth mask over one item is refused, naming that mask.
fn scopes_of(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<BTreeMap<String, Vec<Scope>>, Refused> {
    let parent = |id: &str| {
        items
            .get(id)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let shown =
        |id: &str| items.get(id).and_then(|i| i.get("visible")) != Some(&Value::Bool(false));
    let mut collection_masks: Vec<(String, BTreeSet<String>)> = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("mask@1") || !shown(id) {
            continue;
        }
        // Every mask is held to what this build draws, whether or not anything is under it.
        mask_scope(id, item, palette)?;
        let applies = item.get("params").and_then(|p| p.get("applies_to"));
        let collection = match applies {
            None => continue,
            Some(Value::String(c)) if c == "children" => continue,
            Some(Value::String(c)) => c,
            Some(_) => return refuse("bad_doc", format!("items/{id}/params/applies_to")),
        };
        let Some(Value::Array(m)) = doc
            .get("collections")
            .and_then(|c| c.get(collection))
            .and_then(|c| c.get("members"))
        else {
            return refuse("ref_unresolved", format!("items/{id}/params/applies_to"));
        };
        let members = m
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect();
        collection_masks.push((id.clone(), members));
    }
    let mut out = BTreeMap::new();
    for (id, item) in items {
        // The ancestors, innermost first, bounded so a cycle the check refuses can't spin.
        let mut chain = Vec::new();
        let mut at = parent(id);
        while let Some(p) = at {
            if chain.len() > items.len() || &p == id {
                break;
            }
            at = parent(&p);
            chain.push(p);
        }
        let mut scopes = Vec::new();
        let mut masks: Vec<&str> = Vec::new();
        // (ancestor, true) for a parent's scope; (mask, false) for a collection's mask.
        let ancestors = chain.iter().rev().map(|a| (a.as_str(), true));
        let collected = collection_masks
            .iter()
            .filter(|(_, members)| members.contains(id))
            .map(|(m, _)| (m.as_str(), false));
        for (a, by_parent) in ancestors.chain(collected) {
            let Some(ancestor) = items.get(a) else {
                return refuse("ref_unresolved", format!("items/{id}/parent"));
            };
            if !shown(a) && ancestor.get("kind").and_then(Value::as_str) == Some("mask@1") {
                continue;
            }
            let scope = if by_parent {
                ancestor_scope(a, ancestor, palette)?
            } else {
                Some(mask_scope(a, ancestor, palette)?)
            };
            let Some(scope) = scope else { continue };
            if ancestor.get("kind").and_then(Value::as_str) == Some("mask@1") {
                if ancestor.get("layer") != item.get("layer") {
                    return refuse("mask_writer", format!("items/{a}: {id}"));
                }
                masks.push(a);
                if masks.len() > MASK_DEPTH {
                    return refuse("mask_depth", format!("items/{a}"));
                }
            }
            scopes.push(scope);
        }
        out.insert(id.clone(), scopes);
    }
    Ok(out)
}

/// The rect a mark's scissors leave it, for a renderer that clips only by rect.
fn clip_of(scopes: &[Scope]) -> Option<[f64; 4]> {
    scopes.iter().fold(None, |acc, s| {
        let Scope::Clip { rect, .. } = s else {
            return acc;
        };
        let Some([ax, ay, aw, ah]) = acc else {
            return Some(*rect);
        };
        let [bx, by, bw, bh] = *rect;
        let (x0, y0) = (ax.max(bx), ay.max(by));
        let (x1, y1) = ((ax + aw).min(bx + bw), (ay + ah).min(by + bh));
        Some([x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)])
    })
}

/// A wrong program a proof plants, reachable only through a proof surface's `planted` field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// #373 AC5's twin: a filled arc closes along its chord.
    ArcClosedAlongChord,
}

/// The draw list for evaluated `items` of `doc`, in `palette`, at `zoom` (which picks each path's
/// tessellation bucket and enters every layer's key).
pub fn frame(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    record: &Record,
    zoom: f64,
) -> Result<Frame, Refused> {
    frame_planted(doc, items, palette, record, zoom, Planted::None)
}

/// [`frame`], with a planted wrong program.
pub fn frame_planted(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    record: &Record,
    zoom: f64,
    planted: Planted,
) -> Result<Frame, Refused> {
    let bound = bound_texts(doc, items, record)?;
    frame_shown(
        doc,
        items,
        palette,
        zoom,
        planted,
        &bound,
        &bound_rows(doc, record),
    )
}

/// The draw list for evaluated `items`, with what each bound value and counter shows already
/// formatted (the text module's counters, in the view's locale); `record` gives the readings
/// bound to mark sets' rows.
pub fn frame_with(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    zoom: f64,
    bound: &BTreeMap<String, Shown>,
    record: &Record,
) -> Result<Frame, Refused> {
    let row_readings = bound_rows(doc, record);
    frame_shown(
        doc,
        items,
        palette,
        zoom,
        Planted::None,
        bound,
        &row_readings,
    )
}

fn frame_shown(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    zoom: f64,
    planted: Planted,
    bound: &BTreeMap<String, Shown>,
    row_readings: &BTreeMap<String, data::BoundRows>,
) -> Result<Frame, Refused> {
    let (frame, wants_boxes) = build(
        doc,
        (items, &[]),
        palette,
        (bound, row_readings),
        zoom,
        planted,
        None,
    )?;
    if !wants_boxes {
        return Ok(frame);
    }
    // A span or a step by position: the first pass's boxes, then the frame drawn with them.
    let boxes = boxes_of(&frame, items);
    Ok(build(
        doc,
        (items, &[]),
        palette,
        (bound, row_readings),
        zoom,
        planted,
        Some(&boxes),
    )?
    .0)
}

/// What one item draws, as a frame places it: its layer, its order key, and its marks with the
/// clip and scopes each draws inside.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub layer: String,
    pub order: String,
    pub drawn: Vec<Drawn>,
    /// Each mark's key at the zoom bucket of a frame at zoom 1, when the item's own node made
    /// them (#857); a frame computes any other.
    pub keys: Vec<ContentKey>,
}

/// An item's marks by their layer, their order and each mark's key input, as a layer keys them.
impl deep_canvas::schedule::Canonical for Placed {
    fn encode(&self, out: &mut Vec<u8>) {
        let mut k = KeyBuilder::new("placed@marks2d.1");
        k.text(&self.layer).text(&self.order);
        for m in &self.drawn {
            m.feed(&mut k, 0);
        }
        deep_canvas::schedule::Canonical::encode(&k.finish().0, out);
    }
}

/// What an item's marks read beyond the item: the document's items, the palette and paints,
/// each item's scopes, what bound values show, the readings bound to mark sets' rows, and the
/// planted program.
struct ItemCtx<'a> {
    items: &'a Map<String, Value>,
    palette: &'a Palette,
    paints: &'a Paints<'a>,
    scopes: &'a BTreeMap<String, Vec<Scope>>,
    bound: &'a BTreeMap<String, Shown>,
    row_readings: &'a BTreeMap<String, data::BoundRows>,
    planted: Planted,
}

/// What `item` draws; `None` for an item that draws nothing.
fn placed(ctx: &ItemCtx<'_>, id: &String, item: &Value) -> Result<Option<Placed>, Refused> {
    let ItemCtx {
        items,
        palette,
        paints,
        scopes,
        bound,
        row_readings,
        planted,
    } = *ctx;
    let path = format!("items/{id}");
    if item.get("visible") == Some(&Value::Bool(false)) {
        return Ok(None);
    }
    let Some(layer) = item.get("layer").and_then(Value::as_str) else {
        return refuse("bad_doc", format!("{path}/layer"));
    };
    let empty = Map::new();
    let params = item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let place = Place::of(item);
    let pos = place.offset;
    let paint = params
        .get("paint")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let fill = paint.get("fill").and_then(Value::as_object);
    let stroke = paint.get("stroke").and_then(Value::as_object);
    let paint_path = format!("{path}/params/paint");
    // R1's rect, circle and path draw an item that only moves, in the paint R1 knows.
    let r1 = place.moves() && r1_paint(paint);
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let adjust = Adjust::read(item, palette, id)?;
    let mut marks: Vec<Mark> = match kind {
        // A scale, a mask and a group draw nothing themselves, and a camera is the view a
        // document is seen through, not a mark (#378: a 3D figure's camera). A graph, a
        // salience level and a sheet are the graph, record and sheet modules' (#388), which
        // lay them out and draw nothing yet.
        "scale@1" | "mask@1" | "group@1" | "camera@1" | "graph@1" | "salience@1" | "sheet@1" => {
            return Ok(None)
        }
        "star@1" => {
            let p = |k: &str| num(params.get(k));
            let star = Star {
                center: pair(params.get("center")).ok_or(Refused {
                    code: "bad_doc",
                    path: format!("{path}/params/center"),
                })?,
                points: p("points").unwrap_or(5.0),
                outer_r: p("outer_r").unwrap_or(0.0),
                inner_r: p("inner_r").unwrap_or(0.0),
                outer_round: p("outer_round").unwrap_or(0.0),
                inner_round: p("inner_round").unwrap_or(0.0),
                polygon: params.get("polygon") == Some(&Value::Bool(true)),
            };
            let verbs = star.verbs(&format!("{path}/params"))?;
            vec![paints.shape(id, verbs, place, paint, &paint_path)?]
        }
        "frame@1" => {
            // A frame draws its background; its overflow mask scopes its children.
            let Some(fill) = fill else { return Ok(None) };
            let bounds = place.rect(frame_box(id, item)?);
            vec![Mark::Rect {
                item: id.clone(),
                bounds,
                radius: num(params.get("radius")).unwrap_or(0.0),
                fill: paints.paint(
                    id,
                    fill,
                    &format!("{paint_path}/fill"),
                    bounds,
                    Place::NONE,
                    false,
                )?,
            }]
        }
        "circle@1" if params.get("arc").is_some() => {
            let center = pair(params.get("center")).ok_or(Refused {
                code: "bad_doc",
                path: format!("{path}/params/center"),
            })?;
            let arc = params.get("arc");
            let (Some(from), Some(to)) = (
                num(arc.and_then(|a| a.get("from"))),
                num(arc.and_then(|a| a.get("to"))),
            ) else {
                return refuse("bad_doc", format!("{path}/params/arc"));
            };
            let close = match (fill.is_some(), planted) {
                (false, _) => outline::Close::Open,
                (true, Planted::ArcClosedAlongChord) => outline::Close::Chord,
                (true, Planted::None) => outline::Close::Filled,
            };
            let verbs = outline::arc(
                center,
                num(params.get("r")).unwrap_or(0.0),
                num(params.get("inner_r")).unwrap_or(0.0),
                from,
                to,
                close,
            );
            vec![paints.shape(id, verbs, place, paint, &paint_path)?]
        }
        "path@1"
            if !r1
                || [fill, stroke]
                    .iter()
                    .flatten()
                    .any(|p| p.contains_key("gradient") || p.contains_key("steps")) =>
        {
            let Some(Value::String(d)) = params.get("d") else {
                return refuse("bad_doc", format!("{path}/params/d"));
            };
            let verbs = path::parse(d).ok_or(Refused {
                code: "bad_path_data",
                path: format!("{path}/params/d"),
            })?;
            vec![paints.shape(id, verbs, place, paint, &paint_path)?]
        }
        "rect@1" | "circle@1"
            if !r1
                || stroke.is_some()
                || (kind == "circle@1" && fill.is_some_and(|f| !f.contains_key("role"))) =>
        {
            let verbs = if kind == "rect@1" {
                let Some(b) = four(params.get("box")) else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                outline::rect(b, num(params.get("radius")).unwrap_or(0.0))
            } else {
                let center = pair(params.get("center")).ok_or(Refused {
                    code: "bad_doc",
                    path: format!("{path}/params/center"),
                })?;
                outline::circle(
                    center,
                    num(params.get("r")).unwrap_or(0.0),
                    num(params.get("inner_r")).unwrap_or(0.0),
                )
            };
            if fill.is_none() && stroke.is_none() {
                return Ok(None);
            }
            vec![paints.shape(id, verbs, place, paint, &paint_path)?]
        }
        "marks@1" => data::mark_set(
            id,
            item,
            items,
            palette,
            pos,
            row_readings
                .get(id.as_str())
                .unwrap_or(&data::BoundRows::new()),
        )?,
        "axis@1" => data::axis(id, item, items, palette, pos)?,
        "image@1" => {
            let Some(Value::String(asset)) = params.get("asset") else {
                return refuse("bad_doc", format!("{path}/params/asset"));
            };
            if asset.len() != 64 || !asset.bytes().all(|b| b.is_ascii_hexdigit()) {
                return refuse("bad_asset", format!("{path}/params/asset"));
            }
            if params
                .get("alt")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                return refuse("alt_missing", format!("{path}/params/alt"));
            }
            let Some(bounds) = four(params.get("box")) else {
                return refuse("bad_doc", format!("{path}/params/box"));
            };
            let fit = match params.get("fit").and_then(Value::as_str) {
                None | Some("contain") => ImageFit::Contain,
                Some("cover") => ImageFit::Cover,
                Some("fill") => ImageFit::Fill,
                Some("none") => ImageFit::None,
                Some(_) => return refuse("bad_doc", format!("{path}/params/fit")),
            };
            let sampling = match params.get("sampling") {
                None => ImageSampling::Linear,
                Some(Value::String(s)) if s == "linear" => ImageSampling::Linear,
                Some(Value::String(s)) if s == "nearest" => ImageSampling::Nearest,
                Some(Value::String(s)) if s == "cubic" => ImageSampling::Cubic,
                Some(_) => return refuse("bad_doc", format!("{path}/params/sampling")),
            };
            vec![Mark::Image {
                item: id.clone(),
                asset: asset.to_ascii_lowercase(),
                bounds: place.rect(bounds),
                fit,
                sampling,
                crop: four(params.get("crop")),
                opacity: num(params.get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0),
                adjust: Adjust::default(),
            }]
        }
        _ => vec![match kind {
            "rect@1" => {
                let Some(Value::Array(b)) = params.get("box") else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                let b: Option<Vec<f64>> = b.iter().map(|v| num(Some(v))).collect();
                let Some([x, y, w, h]) = b.as_deref().and_then(|b| <[f64; 4]>::try_from(b).ok())
                else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                let Some(fill) = fill else { return Ok(None) };
                let bounds = [x + pos[0], y + pos[1], w, h];
                Mark::Rect {
                    item: id.clone(),
                    bounds,
                    radius: num(params.get("radius")).unwrap_or(0.0),
                    fill: paints.paint(
                        id,
                        fill,
                        &format!("{paint_path}/fill"),
                        bounds,
                        Place::NONE,
                        false,
                    )?,
                }
            }
            "circle@1" => {
                let center = pair(params.get("center")).ok_or(Refused {
                    code: "bad_doc",
                    path: format!("{path}/params/center"),
                })?;
                let Some(fill) = fill else { return Ok(None) };
                Mark::Circle {
                    item: id.clone(),
                    center: [center[0] + pos[0], center[1] + pos[1]],
                    r: num(params.get("r")).unwrap_or(0.0),
                    inner_r: num(params.get("inner_r")).unwrap_or(0.0),
                    color: role(
                        palette,
                        fill.get("role"),
                        &format!("{path}/params/paint/fill/role"),
                    )?,
                }
            }
            "path@1" => {
                let Some(Value::String(d)) = params.get("d") else {
                    return refuse("bad_doc", format!("{path}/params/d"));
                };
                let verbs = path::parse(d).ok_or(Refused {
                    code: "bad_path_data",
                    path: format!("{path}/params/d"),
                })?;
                // One color per path in R1: the stroke's role, else the fill's.
                let color_role = stroke
                    .and_then(|s| s.get("role"))
                    .or(fill.and_then(|f| f.get("role")));
                let color = role(palette, color_role, &format!("{path}/params/paint"))?;
                Mark::Path {
                    item: id.clone(),
                    d: d.clone(),
                    geometry: Geometry {
                        verbs,
                        stroke: stroke.map(|s| num(s.get("width")).unwrap_or(1.0)),
                        fill: fill.is_some(),
                    },
                    offset: pos,
                    color,
                }
            }
            "text@1" => {
                let shown = bound.get(id);
                // A stale value greys out (Bound value).
                let color_role = if shown.is_some_and(|s| s.stale) {
                    Value::String("muted".into())
                } else {
                    fill.and_then(|f| f.get("role"))
                        .cloned()
                        .unwrap_or(Value::String("ink".into()))
                };
                Mark::Text {
                    item: id.clone(),
                    spec: text_spec(id, params, shown)?,
                    origin: pos,
                    color: role(
                        palette,
                        Some(&color_role),
                        &format!("{path}/params/paint/fill/role"),
                    )?,
                    role: color_role.as_str().map(str::to_string),
                    runs: text_runs(palette, params, &path)?,
                }
            }
            _ => return refuse("module_missing", format!("{path}/kind: {kind}")),
        }],
    };
    let order = item.get("order").and_then(Value::as_str).unwrap_or("");
    let mut scopes = scopes.get(id).cloned().unwrap_or_default();
    if adjust.opacity < 1.0 {
        scopes.push(Scope::Opacity {
            item: format!("{id}#adjust"),
            alpha: adjust.opacity,
        });
    }
    let clip = clip_of(&scopes);
    if !adjust.is_identity() {
        marks.iter_mut().for_each(|m| m.adjust(&adjust));
    }
    Ok(Some(Placed {
        keys: Vec::new(),
        layer: layer.to_string(),
        order: order.to_string(),
        drawn: marks
            .into_iter()
            .map(|mark| Drawn {
                mark,
                clip,
                scopes: scopes.clone(),
            })
            .collect(),
    }))
}

/// What `item` draws when it reads nothing beyond itself, the palette and what its bound value
/// shows (#857: marks2d builds these on the scheduler's pool, an item to a node): an R1 rect,
/// circle, path or text with no parent, painted by roles. `None` for any other item, and for
/// one the check would refuse, which the frame builds itself; the frame also leaves out an item
/// that is a parent, sits in a collection or names a layer the document lacks.
pub fn item_placed(
    id: &str,
    item: &Value,
    palette: &Palette,
    shown: Option<&Shown>,
) -> Option<Placed> {
    let kind = item.get("kind").and_then(Value::as_str)?;
    if !matches!(kind, "rect@1" | "circle@1" | "path@1" | "text@1") || item.get("parent").is_some()
    {
        return None;
    }
    let paint = item.get("params").and_then(|p| p.get("paint"));
    let by_role = |p: Option<&Value>| {
        p.and_then(Value::as_object)
            .is_none_or(|p| !p.contains_key("gradient") && !p.contains_key("steps"))
    };
    if !by_role(paint.and_then(|p| p.get("fill"))) || !by_role(paint.and_then(|p| p.get("stroke")))
    {
        return None;
    }
    let empty = Map::new();
    let paints = Paints {
        doc: &empty,
        items: &empty,
        palette,
        boxes: None,
        wants_boxes: Cell::new(false),
    };
    let scopes = BTreeMap::new();
    let bound: BTreeMap<String, Shown> = shown
        .map(|s| (id.to_string(), s.clone()))
        .into_iter()
        .collect();
    let ctx = ItemCtx {
        items: &empty,
        palette,
        paints: &paints,
        scopes: &scopes,
        bound: &bound,
        row_readings: &BTreeMap::new(),
        planted: Planted::None,
    };
    let mut placed = placed(&ctx, &id.to_string(), item).ok()??;
    let bucket = path::bucket(1.0);
    placed.keys = placed.drawn.iter().map(|d| d.key(bucket)).collect();
    (!paints.wants_boxes.get()).then_some(placed)
}

/// [`frame_with`] with `prebuilt` items placed as given and left out of `items`; `None` when a
/// paint asks for boxes, which only a frame built from every item can give.
pub fn frame_prebuilt(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    zoom: f64,
    bound: &BTreeMap<String, Shown>,
    record: &Record,
    prebuilt: &[(&str, &Placed)],
) -> Result<Option<Frame>, Refused> {
    let row_readings = bound_rows(doc, record);
    let (frame, wants_boxes) = build(
        doc,
        (items, prebuilt),
        palette,
        (bound, &row_readings),
        zoom,
        Planted::None,
        None,
    )?;
    Ok((!wants_boxes).then_some(frame))
}

/// The frame, and whether a paint asked for boxes that `boxes` doesn't yet hold.
fn build(
    doc: &Map<String, Value>,
    // The items to build, and those built from the item alone (#857), placed as given.
    (items, prebuilt): (&Map<String, Value>, &[(&str, &Placed)]),
    palette: &Palette,
    // What each bound value and counter shows, and the readings bound to mark sets' rows.
    (bound, row_readings): (&BTreeMap<String, Shown>, &BTreeMap<String, data::BoundRows>),
    zoom: f64,
    planted: Planted,
    boxes: Option<&BTreeMap<String, [f64; 4]>>,
) -> Result<(Frame, bool), Refused> {
    let size = pair(doc.get("size")).ok_or(Refused {
        code: "bad_doc",
        path: "size".into(),
    })?;
    let ground = palette.get("ground").copied().ok_or(Refused {
        code: "role_unresolved",
        path: "look: ground".into(),
    })?;
    let bucket = path::bucket(zoom);
    // Mark sets' rows across the document, before any is built (Mark set: "exceed … 16M per
    // document" it can never); the set that crosses the limit is named.
    let mut rows: u64 = 0;
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) == Some("marks@1") {
            rows += item
                .get("params")
                .and_then(|p| p.get("n"))
                .and_then(Value::as_u64)
                .unwrap_or(0);
            if rows > data::MAX_DOCUMENT_ROWS {
                return refuse("out_of_range", format!("items/{id}/params/n"));
            }
        }
    }
    let scopes = scopes_of(doc, items, palette)?;
    let paints = Paints {
        doc,
        items,
        palette,
        boxes,
        wants_boxes: Cell::new(false),
    };
    // Each layer as (order, ID, its marks as (order, ID, mark)), sorted below.
    let mut layers: Vec<(String, String, Vec<Ordered>)> = Vec::new();
    if let Some(Value::Object(ls)) = doc.get("layers") {
        for (id, l) in ls {
            let order = l
                .get("order")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            layers.push((order, id.clone(), Vec::new()));
        }
    }
    let ctx = ItemCtx {
        items,
        palette,
        paints: &paints,
        scopes: &scopes,
        bound,
        row_readings,
        planted,
    };
    // Each item's marks, then each one prebuilt from the item alone (#857), each in its layer.
    let mut built: Vec<(&str, Placed)> = Vec::new();
    for (id, item) in items {
        let Some(placed) = placed(&ctx, id, item)? else {
            continue;
        };
        if !layers.iter().any(|l| l.1 == placed.layer) {
            return refuse("ref_unresolved", format!("items/{id}/layer"));
        }
        built.push((id, placed));
    }
    let prebuilt = prebuilt.iter().map(|(id, p)| (*id, *p));
    for (id, placed) in built.iter().map(|(id, p)| (*id, p)).chain(prebuilt) {
        let Some(slot) = layers.iter_mut().find(|l| l.1 == placed.layer) else {
            return refuse("ref_unresolved", format!("items/{id}/layer"));
        };
        let made = placed.keys.len() == placed.drawn.len() && bucket == path::bucket(1.0);
        for (k, drawn) in placed.drawn.iter().enumerate() {
            let key = if made {
                placed.keys[k]
            } else {
                drawn.key(bucket)
            };
            // A generated row keeps its set's place, in row order.
            slot.2.push((&placed.order, k, id, drawn, key));
        }
    }
    layers.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let layers = layers
        .into_iter()
        .map(|(_, id, mut marks)| {
            marks.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
            let mut k = KeyBuilder::new("layer@marks2d.2");
            k.text(&id).number(size[0]).number(size[1]).number(zoom);
            for m in &marks {
                k.key(&m.4);
            }
            let marks: Vec<Drawn> = marks.into_iter().map(|m| m.3.clone()).collect();
            Layer {
                key: k.finish(),
                id,
                marks,
            }
        })
        .collect();
    let frame = Frame {
        size,
        ground,
        layers,
    };
    Ok((frame, paints.wants_boxes.get()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reading_groups_its_thousands() {
        let show = |n| Format::default().show(Some(n));
        assert_eq!(show(1234.0), "1,234");
        assert_eq!(show(98765.0), "98,765");
        assert_eq!(show(12.0), "12");
        assert_eq!(show(0.5), "0.5");
    }

    #[test]
    fn a_format_sets_precision_notation_sign_unit_and_grouping() {
        let f = |v: serde_json::Value| Format::read(Some(&v), None, "f").unwrap();
        assert_eq!(
            f(serde_json::json!({"precision": 2})).show(Some(1234.5)),
            "1,234.50"
        );
        assert_eq!(
            f(serde_json::json!({"notation": "percent", "precision": 1})).show(Some(0.256)),
            "25.6%"
        );
        assert_eq!(
            f(serde_json::json!({"sign": "always", "unit": "ms"})).show(Some(12.0)),
            "+12 ms"
        );
        assert_eq!(
            f(serde_json::json!({"group": "none"})).show(Some(-98765.0)),
            "−98765"
        );
        assert_eq!(f(serde_json::json!({})).show(None), "—");
        let compact = f(serde_json::json!({"notation": "compact"}));
        assert_eq!(compact.show(Some(950.0)), "950");
        assert_eq!(compact.show(Some(1234.0)), "1.2K");
        assert_eq!(compact.show(Some(-3_456_789.0)), "−3.5M");
        assert_eq!(compact.show(Some(999_950.0)), "1.0M");
        let duration = f(serde_json::json!({"notation": "duration"}));
        assert_eq!(duration.show(Some(0.45)), "450 ms");
        assert_eq!(duration.show(Some(3.5)), "3.5 s");
        assert_eq!(duration.show(Some(2.0)), "2 s");
        assert_eq!(duration.show(Some(125.0)), "2 min 05 s");
        assert_eq!(duration.show(Some(3720.0)), "1 h 02 min");
        assert_eq!(
            f(serde_json::json!({"notation": "duration", "unit": "ms"})).show(Some(1500.0)),
            "1.5 s"
        );
        assert_eq!(
            Format::read(None, Some(&serde_json::json!("hide")), "f")
                .unwrap()
                .show(None),
            ""
        );
        assert_eq!(
            Format::read(
                Some(&serde_json::json!({"notation": "engineering"})),
                None,
                "f"
            )
            .unwrap_err()
            .code,
            "format_notation"
        );
    }

    #[test]
    fn a_counter_formats_its_bound_value_s_reading_with_tabular_figures() {
        let doc = serde_json::json!({
            "size": [100, 40],
            "layers": {"main": {"order": "a0"}},
            "items": {"n": {"id": "n", "kind": "text@1", "layer": "main",
                "params": {"text": {"counter": {"source": "passed", "format": {"notation": "percent"}}}}}},
            "bound_values": {"passed": {"target": "items/other/params/text", "source": "reading:01JB0000000000000000000001"}},
        });
        let doc = doc.as_object().unwrap();
        let items = doc["items"].as_object().unwrap();
        let palette: Palette = [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [0, 0, 0]),
        ]
        .into();
        let record = Record {
            readings: [("reading:01JB0000000000000000000001".to_string(), 0.75)].into(),
            ..Record::default()
        };
        let f = frame(doc, items, &palette, &record, 1.0).unwrap();
        let Mark::Text { spec, .. } = &f.layers[0].marks[0].mark else {
            panic!("a text mark")
        };
        assert_eq!(spec.text, "75%");
        assert!(spec.bound, "a counter shapes with tabular figures");
    }

    fn board(items: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "size": [200, 100],
            "layers": {"main": {"order": "a0"}, "other": {"order": "a1"}},
            "items": items,
            "collections": {"clipped": {"members": ["b"]}},
        })
    }

    fn draw(doc: &serde_json::Value) -> Result<Frame, Refused> {
        let doc = doc.as_object().unwrap();
        let palette: Palette = [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [0, 0, 0]),
        ]
        .into();
        frame(
            doc,
            doc["items"].as_object().unwrap(),
            &palette,
            &Record::default(),
            1.0,
        )
    }

    fn clip_of(f: &Frame, item: &str) -> Option<[f64; 4]> {
        f.layers
            .iter()
            .flat_map(|l| &l.marks)
            .find(|d| d.mark.item() == item)
            .and_then(|d| d.clip)
    }

    #[test]
    fn a_rect_mask_clips_its_children_and_a_collection_to_its_box() {
        let doc = board(serde_json::json!({
            "m": {"kind": "mask@1", "layer": "main", "params": {"box": [10, 10, 50, 50], "applies_to": "children"}},
            "inner": {"kind": "mask@1", "layer": "main", "parent": "m", "params": {"box": [30, 0, 100, 100], "applies_to": "children"}},
            "a": {"kind": "rect@1", "layer": "main", "parent": "inner", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
            "b": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
            "c": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 200, 100], "paint": {"fill": {"role": "ink"}}}},
            "n": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 20, 20], "applies_to": "clipped"}},
        }));
        let f = draw(&doc).unwrap();
        // a is under both masks: their intersection.
        assert_eq!(clip_of(&f, "a"), Some([30.0, 10.0, 30.0, 50.0]));
        assert_eq!(clip_of(&f, "b"), Some([0.0, 0.0, 20.0, 20.0]));
        assert_eq!(clip_of(&f, "c"), None);
        // A mask draws nothing itself.
        assert!(f
            .layers
            .iter()
            .flat_map(|l| &l.marks)
            .all(|d| !d.mark.item().starts_with('m')));
    }

    #[test]
    fn a_mask_never_clips_another_writer_s_items_and_nests_at_most_four_deep() {
        let doc = board(serde_json::json!({
            "m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 10, 10]}},
            "x": {"kind": "rect@1", "layer": "other", "parent": "m", "params": {"box": [0, 0, 5, 5], "paint": {"fill": {"role": "ink"}}}},
        }));
        assert_eq!(draw(&doc).unwrap_err().code, "mask_writer");
        let mut items = serde_json::Map::new();
        for k in 0..5 {
            let mut m = serde_json::json!({"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 100, 100]}});
            if k > 0 {
                m["parent"] = serde_json::json!(format!("m{}", k - 1));
            }
            items.insert(format!("m{k}"), m);
        }
        items.insert("deep".into(), serde_json::json!({"kind": "rect@1", "layer": "main", "parent": "m4", "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}}));
        assert_eq!(
            draw(&board(serde_json::Value::Object(items)))
                .unwrap_err()
                .code,
            "mask_depth"
        );
        let soft = board(
            serde_json::json!({"m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 1, 1], "feather": 2}}}),
        );
        assert_eq!(draw(&soft).unwrap_err().code, "mask_r2");
    }

    fn mark_of<'a>(f: &'a Frame, item: &str) -> &'a Mark {
        &f.layers
            .iter()
            .flat_map(|l| &l.marks)
            .find(|d| d.mark.item() == item)
            .expect("the item draws")
            .mark
    }

    fn solid(f: &Frame, item: &str) -> Rgb {
        match mark_of(f, item) {
            Mark::Rect {
                fill: Fill::Solid(c),
                ..
            } => *c,
            other => panic!("{item} is not a solid rect: {other:?}"),
        }
    }

    /// Three 10 u squares under `g` at x 0, 50 and 100, ordered c, b, a, each stepped by `steps`.
    fn stepped(steps: serde_json::Value) -> Frame {
        let sq = |x: i32, order: &str| {
            serde_json::json!({"kind": "rect@1", "layer": "main", "parent": "g", "order": order,
                "params": {"box": [x, 0, 10, 10], "paint": {"fill": {"steps": steps.clone()}}}})
        };
        let mut doc = board(serde_json::json!({
            "g": {"kind": "group@1", "layer": "main", "params": {}},
            "a": sq(0, "a2"), "b": sq(50, "a1"), "c": sq(100, "a0"),
        }));
        doc["collections"]["ends"] = serde_json::json!({"members": ["a", "c"]});
        draw(&doc).unwrap()
    }

    #[test]
    fn steps_place_a_member_by_its_box_or_its_rank_among_a_collection_s_members() {
        let stops = serde_json::json!([{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]);
        let (ink, ground) = ([0, 0, 0], [255, 255, 255]);
        // By order, a ranks last of the three; by x it stands first.
        let f = stepped(serde_json::json!({"over": "children", "stops": stops, "by": "order"}));
        assert_eq!((solid(&f, "a"), solid(&f, "c")), (ground, ink));
        let f = stepped(serde_json::json!({"over": "children", "stops": stops, "by": "x"}));
        assert_eq!((solid(&f, "a"), solid(&f, "c")), (ink, ground));
        let mid = solid(&f, "b");
        assert!(mid != ink && mid != ground && mid[0] == mid[1] && mid[1] == mid[2]);
        // By distance from a's center, 100 u out reaches the last stop.
        let by = serde_json::json!({"distance": {"from": [5, 5], "radius": 100}});
        let f = stepped(serde_json::json!({"over": "children", "stops": stops, "by": by}));
        assert_eq!(
            (solid(&f, "a"), solid(&f, "b"), solid(&f, "c")),
            (ink, mid, ground)
        );
        // Over a collection of two, c ranks first and a last; b isn't a member.
        let ends = serde_json::json!({"over": "ends", "stops": stops, "by": "order"});
        let mut doc = board(serde_json::json!({
            "a": {"kind": "rect@1", "layer": "main", "order": "a1", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
            "c": {"kind": "rect@1", "layer": "main", "order": "a0", "params": {"box": [100, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
            "b": {"kind": "rect@1", "layer": "main", "params": {"box": [50, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
        }));
        doc["collections"]["ends"] = serde_json::json!({"members": ["a", "c"]});
        let r = draw(&doc).unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("bad_paint", "items/b/params/paint/fill/steps/over")
        );
        doc["items"].as_object_mut().unwrap().remove("b");
        let f = draw(&doc).unwrap();
        assert_eq!((solid(&f, "a"), solid(&f, "c")), (ground, ink));
    }

    #[test]
    fn a_gradient_spans_another_item_s_box_and_runs_along_strokes_alone() {
        let gradient = |span: &str| serde_json::json!({"gradient": {"span": span, "stops": [{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]}});
        let doc = board(serde_json::json!({
            "g": {"kind": "group@1", "layer": "main", "params": {}},
            "p": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [20, 10, 30, 30]}},
            "q": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [120, 30, 40, 30]}},
            "r": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 10, 10], "paint": {"fill": gradient("g")}}},
        }));
        // p and q draw nothing, yet the group's box is theirs: x 20 to 160, y 10 to 60.
        let doc = {
            let mut d = doc;
            for k in ["p", "q"] {
                d["items"][k]["params"]["paint"] = serde_json::json!({"fill": {"role": "ink"}});
            }
            d
        };
        let f = draw(&doc).unwrap();
        let Mark::Rect {
            fill: Fill::Ramp(r),
            ..
        } = mark_of(&f, "r")
        else {
            panic!("r's fill is a ramp")
        };
        assert_eq!(
            r.geometry,
            paint::Geometry::Linear {
                from: [20.0, 35.0],
                to: [160.0, 35.0]
            }
        );
        let mut missing = doc.clone();
        missing["items"]["r"]["params"]["paint"] = serde_json::json!({"fill": gradient("nowhere")});
        assert_eq!(draw(&missing).unwrap_err().code, "ref_unresolved");
        let mut fill_along = doc.clone();
        fill_along["items"]["r"]["params"]["paint"]["fill"]["gradient"]["kind"] =
            serde_json::json!("along");
        assert_eq!(draw(&fill_along).unwrap_err().code, "gradient_kind");
    }

    #[test]
    fn a_path_draws_at_most_10_000_dashes() {
        let dashed = |count: u64| {
            board(
                serde_json::json!({"o": {"kind": "circle@1", "layer": "main",
                "params": {"center": [50, 50], "r": 40, "paint": {"stroke": {"role": "ink", "dash": {"count": count}}}}}}),
            )
        };
        let most = draw(&dashed(10_000)).unwrap();
        let Mark::Shape {
            stroke: Some(line), ..
        } = mark_of(&most, "o")
        else {
            panic!("a stroked circle is an outline")
        };
        assert_eq!(line.dashes, Some(10_000));
        let r = draw(&dashed(10_001)).unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("out_of_range", "items/o/params/paint/stroke/dash/count")
        );
    }

    #[test]
    fn a_document_s_mark_sets_hold_at_most_16m_rows_together() {
        let set = |k: usize| {
            (
                format!("s{k:02}"),
                serde_json::json!({"kind": "marks@1", "layer": "main", "params": {"mark": "point", "n": 1_000_000}}),
            )
        };
        let items: serde_json::Map<_, _> = (0..17).map(set).collect();
        let r = draw(&board(serde_json::Value::Object(items))).unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("out_of_range", "items/s16/params/n")
        );
    }

    #[test]
    fn an_image_is_named_by_its_hash_and_needs_its_alt_text() {
        let hash = "ab".repeat(32);
        let ok = board(
            serde_json::json!({"shot": {"kind": "image@1", "layer": "main",
            "params": {"asset": hash, "box": [0, 0, 100, 50], "fit": "cover", "alt": "The failing step"}}}),
        );
        let f = draw(&ok).unwrap();
        let Mark::Image { asset, fit, .. } = &f.layers[0].marks[0].mark else {
            panic!("an image")
        };
        assert_eq!((asset.as_str(), *fit), (hash.as_str(), ImageFit::Cover));
        let mut no_alt = ok.clone();
        no_alt["items"]["shot"]["params"]["alt"] = serde_json::json!("");
        assert_eq!(draw(&no_alt).unwrap_err().code, "alt_missing");
        let mut by_path = ok.clone();
        by_path["items"]["shot"]["params"]["asset"] = serde_json::json!("/tmp/shot.png");
        assert_eq!(draw(&by_path).unwrap_err().code, "bad_asset");
    }
}
