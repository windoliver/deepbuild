//! The pptx target (issue #732; canvas primitives: Export): what a stage's settled frame becomes on
//! its slide. Each text mark becomes a text box with its styled runs at its item's evaluated box;
//! each rect, rounded rect, ellipse, line and path with a flat or linear-gradient fill and a plain
//! stroke becomes a native shape; every other mark joins a picture, each unbroken run of them in
//! draw order one picture, so a text box drawn between two of them stays between them. A
//! status-bound item is always a picture, with its glyph, and never an editable shape, so an edit
//! can't recolor a status without its glyph. deep-show draws the pictures and writes the file;
//! this decides what each slide holds.

use std::collections::BTreeMap;
use std::ops::Range;

use deep_canvas::ops;
use deep_canvas_marks::paint;
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{Align, Drawn, Fill, Frame, Line, Mark, Rgb, Scope, TextSpec};

/// One element of a slide, in draw order.
#[derive(Clone, Debug, PartialEq)]
pub enum Part {
    Text(TextBox),
    Shape(Shape),
    Picture(Picture),
}

/// A text item as a text box: its evaluated box in u, its paragraphs of styled runs, its
/// alignment, and whether its lines wrap at the box's width.
#[derive(Clone, Debug, PartialEq)]
pub struct TextBox {
    pub item: String,
    /// Its mark's place in the frame's draw list.
    pub mark: usize,
    pub rect: [f64; 4],
    pub paragraphs: Vec<Vec<Run>>,
    pub align: Align,
    pub wrap: bool,
}

/// A run of one style: its text, family, size in u, weight, slant, and the role and color it
/// paints in at its alpha.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub text: String,
    pub family: String,
    pub size: f64,
    pub weight: u16,
    pub italic: bool,
    pub role: Option<String>,
    pub color: Rgb,
    pub alpha: f64,
    pub underline: bool,
    pub strike: bool,
    /// Raised (above 0) or lowered, as a share of the size.
    pub baseline: f64,
}

/// A native shape: its geometry in u, its fill and its stroke.
#[derive(Clone, Debug, PartialEq)]
pub struct Shape {
    pub item: String,
    /// Its mark's place in the frame's draw list.
    pub mark: usize,
    pub geometry: Geometry,
    pub fill: Option<Paint>,
    pub stroke: Option<Stroke>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Geometry {
    Rect([f64; 4]),
    /// A rounded rect and its corner radius.
    Round([f64; 4], f64),
    Ellipse([f64; 4]),
    Path(Vec<Verb>),
}

impl Geometry {
    /// The box the shape sits in, in u.
    pub fn bounds(&self) -> [f64; 4] {
        match self {
            Geometry::Rect(b) | Geometry::Round(b, _) | Geometry::Ellipse(b) => *b,
            Geometry::Path(verbs) => bounds_of(verbs),
        }
    }
}

/// A fill: one color at an alpha, or a linear gradient's stops (each at its share of the box's
/// span along the gradient's direction, from the first corner it reaches to the last) and its
/// direction, degrees clockwise on screen from +x.
#[derive(Clone, Debug, PartialEq)]
pub enum Paint {
    Solid(Rgb, f64),
    Linear {
        stops: Vec<(f64, Rgb, f64)>,
        angle: f64,
    },
}

/// A plain stroke: one width in u, one color at an alpha.
#[derive(Clone, Debug, PartialEq)]
pub struct Stroke {
    pub width: f64,
    pub color: Rgb,
    pub alpha: f64,
}

/// One picture: the marks it holds (their places in the frame's draw list), whether it also holds
/// what draws under every mark and what draws over them, and each item it holds with why.
#[derive(Clone, Debug, PartialEq)]
pub struct Picture {
    pub marks: Range<usize>,
    pub under: bool,
    pub over: bool,
    pub items: Vec<(String, String)>,
}

/// What a slide puts beside the frame's marks: what draws under every mark (a drawn ground, the
/// 3D layers) and over them (captions, status marks), each by item and why.
#[derive(Clone, Debug, Default)]
pub struct Beside {
    pub under: Vec<(String, String)>,
    pub over: Vec<(String, String)>,
}

/// The item a mark draws: its own ID, without a part's `#` suffix.
pub fn item_of(mark: &Mark) -> &str {
    let id = mark.item();
    id.split('#').next().unwrap_or(id)
}

/// Whether a mark draws nothing: it sits inside an opacity of 0, as an item faded out does.
pub fn unseen(d: &Drawn) -> bool {
    d.scopes
        .iter()
        .any(|s| matches!(s, Scope::Opacity { alpha, .. } if *alpha <= 0.0))
}

/// The parts a frame's marks become, in draw order: `pictured` holds the items that are pictures
/// whatever they draw (a status-bound item, a noise fill), each with why, and `boxes` each text
/// item's evaluated box in u, by item. A mark that draws nothing leaves no part.
pub fn plan(
    frame: &Frame,
    pictured: &BTreeMap<String, String>,
    boxes: &dyn Fn(&str) -> Option<[f64; 4]>,
    beside: &Beside,
) -> Vec<Part> {
    let marks: Vec<&Drawn> = frame
        .layers
        .iter()
        .flat_map(|l| l.marks.iter())
        .map(|d| &**d)
        .collect();
    // Each mark as a native part, or why not; an item is native only when every mark it draws is,
    // so a rect with a glow is one picture, never a native rect beside a picture of its glow.
    let parts: Vec<Option<(String, Result<Part, String>)>> = marks
        .iter()
        .map(|d| {
            if unseen(d) {
                return None;
            }
            let item = item_of(&d.mark).to_string();
            let part = match pictured.get(&item) {
                Some(why) => Err(why.clone()),
                None => native(d, &item, boxes),
            };
            Some((item, part))
        })
        .collect();
    let mut why: BTreeMap<&str, &str> = BTreeMap::new();
    for (item, part) in parts.iter().flatten() {
        if let Err(w) = part {
            why.entry(item.as_str()).or_insert(w.as_str());
        }
    }
    let mut out: Vec<Part> = Vec::new();
    let mut open: Option<Picture> = (!beside.under.is_empty()).then(|| Picture {
        marks: 0..0,
        under: true,
        over: false,
        items: beside.under.clone(),
    });
    for (k, (item, part)) in parts
        .iter()
        .enumerate()
        .filter_map(|(k, p)| Some((k, p.as_ref()?)))
    {
        let item = item.clone();
        let native = match why.get(item.as_str()) {
            Some(w) => Err(w.to_string()),
            None => part.clone(),
        };
        match native {
            Ok(mut part) => {
                if let Some(p) = open.take() {
                    out.push(Part::Picture(p));
                }
                match &mut part {
                    Part::Text(t) => t.mark = k,
                    Part::Shape(s) => s.mark = k,
                    Part::Picture(_) => {}
                }
                out.push(part);
            }
            Err(why) => {
                let p = open.get_or_insert_with(|| Picture {
                    marks: k..k,
                    under: false,
                    over: false,
                    items: Vec::new(),
                });
                if p.marks.is_empty() && !p.under {
                    p.marks.start = k;
                }
                p.marks.end = k + 1;
                if !p.items.iter().any(|(i, _)| *i == item) {
                    p.items.push((item, why));
                }
            }
        }
    }
    if !beside.over.is_empty() {
        let n = marks.len();
        let p = open.get_or_insert_with(|| Picture {
            marks: n..n,
            under: false,
            over: false,
            items: Vec::new(),
        });
        p.over = true;
        for (item, why) in &beside.over {
            if !p.items.iter().any(|(i, _)| i == item) {
                p.items.push((item.clone(), why.clone()));
            }
        }
    }
    if let Some(p) = open {
        out.push(Part::Picture(p));
    }
    out
}

/// A mark as a native part, or why it can't be one.
fn native(d: &Drawn, item: &str, boxes: &dyn Fn(&str) -> Option<[f64; 4]>) -> Result<Part, String> {
    let alpha = scoped_alpha(d)?;
    match &d.mark {
        Mark::Text {
            spec,
            origin,
            role,
            color,
            runs,
            ..
        } => {
            if spec.flow != deep_text::Flow::Horizontal {
                return Err("vertical text".into());
            }
            let rect = boxes(item).unwrap_or_else(|| {
                let w = spec
                    .width
                    .unwrap_or(spec.text.chars().count() as f64 * spec.size);
                [origin[0], origin[1], w, 1.3 * spec.size]
            });
            Ok(Part::Text(TextBox {
                item: item.to_string(),
                mark: 0,
                rect,
                paragraphs: paragraphs(spec, role.as_deref(), *color, runs, alpha),
                align: spec.align,
                wrap: spec.width.is_some(),
            }))
        }
        Mark::Rect {
            bounds,
            radius,
            fill,
            ..
        } => {
            let fill = paint_of(fill, alpha, *bounds)?;
            let geometry = if *radius > 0.0 {
                Geometry::Round(*bounds, *radius)
            } else {
                Geometry::Rect(*bounds)
            };
            Ok(shape(item, geometry, Some(fill), None))
        }
        Mark::Circle {
            center,
            r,
            inner_r,
            color,
            ..
        } => {
            if *inner_r > 0.0 {
                return Err("ring".into());
            }
            let b = [center[0] - r, center[1] - r, 2.0 * r, 2.0 * r];
            Ok(shape(
                item,
                Geometry::Ellipse(b),
                Some(Paint::Solid(*color, alpha)),
                None,
            ))
        }
        Mark::Path {
            geometry,
            offset,
            color,
            ..
        } => {
            let verbs: Vec<Verb> = geometry.verbs.iter().map(|v| moved(v, *offset)).collect();
            let fill = geometry.fill.then_some(Paint::Solid(*color, alpha));
            let stroke = geometry.stroke.map(|width| Stroke {
                width,
                color: *color,
                alpha,
            });
            Ok(shape(item, Geometry::Path(verbs), fill, stroke))
        }
        Mark::Shape {
            verbs,
            fill,
            stroke,
            ..
        } => {
            let b = bounds_of(verbs);
            let fill = match fill {
                Some((f, a)) => Some(paint_of(f, alpha * a, b)?),
                None => None,
            };
            let stroke = match stroke {
                Some(l) => Some(plain(l, alpha)?),
                None => None,
            };
            Ok(shape(item, Geometry::Path(verbs.clone()), fill, stroke))
        }
        Mark::Image { .. } => Err("image".into()),
    }
}

fn shape(item: &str, geometry: Geometry, fill: Option<Paint>, stroke: Option<Stroke>) -> Part {
    Part::Shape(Shape {
        item: item.to_string(),
        mark: 0,
        geometry,
        fill,
        stroke,
    })
}

/// The alpha a mark's scopes leave it, when every scope is one a native part can hold: an
/// opacity with no blend or effect, or a shared coverage target. Any other scope draws the mark
/// through something a slide can't hold.
fn scoped_alpha(d: &Drawn) -> Result<f64, String> {
    if d.clip.is_some() {
        return Err("clip".into());
    }
    let mut alpha = 1.0;
    for s in &d.scopes {
        match s {
            Scope::Opacity {
                alpha: a,
                blend: None,
                effect: None,
                ..
            } => alpha *= a,
            Scope::Opacity {
                effect: Some(e), ..
            } => {
                return Err(if e.medium.is_some() {
                    "drawn look"
                } else if !e.passes.is_empty() || e.backdrop {
                    "pass"
                } else if e.paint.is_some() {
                    "paint effect"
                } else {
                    "effect"
                }
                .into())
            }
            Scope::Opacity { blend: Some(_), .. } => return Err("blend".into()),
            Scope::Cover { .. } => {}
            Scope::Clip { .. } | Scope::Shape { .. } => return Err("clip".into()),
            Scope::Mask { .. } => return Err("mask".into()),
            Scope::Matte { .. } => return Err("matte".into()),
        }
    }
    Ok(alpha)
}

/// A fill as a native paint over the box `b`, or why it isn't one: a flat color, or a linear
/// gradient that pads at its ends with no transform of its own.
fn paint_of(fill: &Fill, alpha: f64, b: [f64; 4]) -> Result<Paint, String> {
    match fill {
        Fill::Solid(c) => Ok(Paint::Solid(*c, alpha)),
        Fill::Linear { from, to, at } => {
            let stops = vec![(at[0], *from, alpha), (at[1], *to, alpha)];
            Ok(Paint::Linear { stops, angle: 0.0 })
        }
        Fill::Ramp(r) => {
            let paint::Geometry::Linear { from, to } = r.geometry else {
                return Err("gradient".into());
            };
            if r.transform != [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] || r.extend != paint::Extend::Pad {
                return Err("gradient".into());
            }
            linear(&r.stops, from, to, alpha, b).ok_or_else(|| "gradient".into())
        }
    }
}

/// A linear ramp from `from` to `to` (stops at their share of that span, sRGB-encoded, padded past
/// its ends) as stops over the box `b`'s span along its direction.
fn linear(
    stops: &[(f64, paint::Color, f64)],
    from: [f64; 2],
    to: [f64; 2],
    alpha: f64,
    b: [f64; 4],
) -> Option<Paint> {
    let d = [to[0] - from[0], to[1] - from[1]];
    let len2 = d[0] * d[0] + d[1] * d[1];
    if len2 <= 0.0 || stops.is_empty() {
        return None;
    }
    // The ramp's own parameter at each corner of the box: the box spans [lo, hi] of it.
    let at = |p: [f64; 2]| ((p[0] - from[0]) * d[0] + (p[1] - from[1]) * d[1]) / len2;
    let corners = [
        [b[0], b[1]],
        [b[0] + b[2], b[1]],
        [b[0], b[1] + b[3]],
        [b[0] + b[2], b[1] + b[3]],
    ];
    let (lo, hi) = corners
        .iter()
        .map(|c| at(*c))
        .fold((f64::MAX, f64::MIN), |(lo, hi), u| (lo.min(u), hi.max(u)));
    if hi - lo <= 0.0 {
        return None;
    }
    let color = |u: f64| -> (paint::Color, f64) {
        let k = stops.partition_point(|s| s.0 <= u);
        match (k.checked_sub(1).and_then(|i| stops.get(i)), stops.get(k)) {
            (Some(a), Some(b)) if b.0 > a.0 => {
                let f = (u - a.0) / (b.0 - a.0);
                let mix = |x: f64, y: f64| x + (y - x) * f;
                ([0, 1, 2].map(|i| mix(a.1[i], b.1[i])), mix(a.2, b.2))
            }
            (Some(a), _) => (a.1, a.2),
            (None, Some(b)) => (b.1, b.2),
            (None, None) => ([0.0; 3], 1.0),
        }
    };
    let mut out = vec![(0.0, color(lo))];
    for s in stops.iter().filter(|s| s.0 > lo && s.0 < hi) {
        out.push(((s.0 - lo) / (hi - lo), (s.1, s.2)));
    }
    out.push((1.0, color(hi)));
    Some(Paint::Linear {
        stops: out
            .into_iter()
            .map(|(t, (c, a))| (t, paint::code(c), a * alpha))
            .collect(),
        angle: ops::atan2(d[1], d[0]).to_degrees().rem_euclid(360.0),
    })
}

/// A stroke as a plain one, or why it isn't: one color, one width, no dashes.
fn plain(l: &Line, alpha: f64) -> Result<Stroke, String> {
    match (&l.paint, l.dashes, &l.profile) {
        (Fill::Solid(c), None, None) => Ok(Stroke {
            width: l.width,
            color: *c,
            alpha: alpha * l.opacity,
        }),
        _ => Err("stroke".into()),
    }
}

fn moved(v: &Verb, d: [f64; 2]) -> Verb {
    let m = |p: &[f64; 2]| [p[0] + d[0], p[1] + d[1]];
    match v {
        Verb::Move(p) => Verb::Move(m(p)),
        Verb::Line(p) => Verb::Line(m(p)),
        Verb::Quad(a, p) => Verb::Quad(m(a), m(p)),
        Verb::Cubic(a, b, p) => Verb::Cubic(m(a), m(b), m(p)),
        Verb::Close => Verb::Close,
    }
}

/// The box holding every point of `verbs`, control points included.
pub fn bounds_of(verbs: &[Verb]) -> [f64; 4] {
    let mut lo = [f64::MAX; 2];
    let mut hi = [f64::MIN; 2];
    let mut add = |p: &[f64; 2]| {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    };
    for v in verbs {
        match v {
            Verb::Move(p) | Verb::Line(p) => add(p),
            Verb::Quad(a, p) => {
                add(a);
                add(p);
            }
            Verb::Cubic(a, b, p) => {
                add(a);
                add(b);
                add(p);
            }
            Verb::Close => {}
        }
    }
    if lo[0] > hi[0] {
        return [0.0; 4];
    }
    [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]]
}

/// A text's paragraphs: its graphemes grouped into runs of one style (its spans' family, weight,
/// slant and size; its runs' role and color), split at each line break.
fn paragraphs(
    spec: &TextSpec,
    role: Option<&str>,
    color: Rgb,
    runs: &[deep_canvas_marks::scene::TextRun],
    alpha: f64,
) -> Vec<Vec<Run>> {
    let starts = deep_text::unicode::grapheme_starts(&spec.text);
    let mut out: Vec<Vec<Run>> = vec![Vec::new()];
    for (g, &start) in starts.iter().enumerate() {
        let end = starts.get(g + 1).copied().unwrap_or(spec.text.len());
        let text = &spec.text[start..end];
        let span = spec.spans.iter().find(|s| s.from <= g && g < s.to);
        let (run_role, run_color) = deep_canvas_marks::scene::run_paint(runs, g, role, color);
        let opacity = deep_canvas_marks::scene::run_opacity(runs, g);
        let style = Run {
            text: String::new(),
            family: span
                .and_then(|s| s.family)
                .or(spec.family)
                .unwrap_or(spec.font.as_str())
                .to_string(),
            size: span.and_then(|s| s.size).map_or(spec.size, f64::from),
            weight: span.and_then(|s| s.weight).unwrap_or(spec.weight),
            italic: span.and_then(|s| s.italic).unwrap_or(false),
            role: run_role.map(str::to_string),
            color: run_color,
            alpha: alpha * opacity,
            underline: span.is_some_and(|s| s.underline),
            strike: span.is_some_and(|s| s.strike),
            baseline: match span.and_then(|s| s.shift) {
                Some(deep_text::Shift::Super) => 0.3,
                Some(deep_text::Shift::Sub) => -0.25,
                Some(deep_text::Shift::By(px)) => f64::from(px) / spec.size.max(1.0),
                None => 0.0,
            },
        };
        for (i, piece) in text.split('\n').enumerate() {
            if i > 0 {
                out.push(Vec::new());
            }
            if piece.is_empty() {
                continue;
            }
            let line = out.last_mut().expect("a paragraph");
            match line.last_mut() {
                Some(last) if same(last, &style) => last.text.push_str(piece),
                _ => line.push(Run {
                    text: piece.to_string(),
                    ..style.clone()
                }),
            }
        }
    }
    out
}

fn same(a: &Run, b: &Run) -> bool {
    a.family == b.family
        && a.size == b.size
        && a.weight == b.weight
        && a.italic == b.italic
        && a.role == b.role
        && a.color == b.color
        && a.alpha == b.alpha
        && a.underline == b.underline
        && a.strike == b.strike
        && a.baseline == b.baseline
}
