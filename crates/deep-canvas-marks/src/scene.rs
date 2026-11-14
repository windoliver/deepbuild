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

use std::borrow::Cow;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

use serde_json::{json, Map, Value};

use crate::data;
use crate::ends;
use crate::key::{ContentKey, KeyBuilder};
use crate::outline::{self, Star};
use crate::paint::{self, Adjust, By, Over, Ramp, Span, Steps};
use crate::path::{self, Mesh, Verb};
use crate::pathops;
use crate::place::Place;
use crate::story;
use deep_canvas::schedule::{Key, KeyTree};
use deep_canvas::template;

/// The kinds [`frame`] reads: every other kind is one the marks module doesn't know.
pub const KINDS: &[&str] = &[
    "rect@1", "circle@1", "path@1", "text@1", "image@1", "marks@1", "axis@1", "scale@1", "mask@1",
    "group@1", "star@1", "frame@1", "series@1", "matte@1", "axes3d@1",
];

/// The kinds of [`KINDS`] the data module owns: R1's mark sets, scales and axes, which marks2d
/// draws for it (the data module's manifest). A build without the data module lacks them.
pub const DATA_KINDS: &[&str] = &["marks@1", "axis@1", "scale@1", "axes3d@1"];

/// The canvas module that owns one of [`KINDS`]: the data module's, or marks2d's.
pub fn module_of(kind: &str) -> &'static str {
    if DATA_KINDS.contains(&kind) {
        "data"
    } else {
        "marks2d"
    }
}

/// An sRGB-encoded color, 0–255 per channel, as the look's roles resolve for a 2D writer layer.
pub type Rgb = [u8; 3];

/// Role → color, for one theme.
pub type Palette = BTreeMap<String, Rgb>;

/// #417: a look's type for one theme: the bundled family each of its font names and font roles
/// sets text in, and the fallback families in order (Look `look@1`: `fonts`, `roles`, `fallback`).
/// The default is the bundled roles' own families with no fallback.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Type {
    pub fonts: BTreeMap<String, &'static str>,
    pub fallback: Vec<&'static str>,
    /// #1965: the look's code roles, the role each token class draws in (Look `look@1`: `code`);
    /// empty for a look that gives none, where every token draws in plain.
    pub code: BTreeMap<String, String>,
    /// #1966: the look's diff roles, the role each gutter mark (added, removed, changed) draws
    /// in (Look `look@1`: `diff`); empty for a look that gives none.
    pub diff: BTreeMap<String, String>,
    /// #149: the look's drawn fields, when marks are dressed by them.
    pub drawn: Option<Arc<deep_canvas_drawn::spec::Look>>,
    /// #149's wrong programs: only a look's first rim, and every ink fill flat.
    pub first_rim: bool,
    pub flat_ink: bool,
}

impl Type {
    /// The family a text's `font` sets it in: the look's font of that name or role, else the
    /// bundled role's; `None` for a font the look doesn't name and nothing bundles.
    pub fn family(&self, font: &str) -> Option<&'static str> {
        self.fonts
            .get(font)
            .copied()
            .or_else(|| deep_text::Role::parse(font).map(deep_text::Role::family))
    }
}

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
/// scissor, an alpha or luminance mask's coverage from its own paint over its rect, a group's (or
/// an item's adjust) opacity and blend through one offscreen pass, or the one coverage target a
/// group's fills that share an edge draw through (Decided, The 2D renderer: no conflation seams).
#[derive(Clone, Debug, PartialEq)]
pub enum Scope {
    /// A rect scissor, or with `radius` above 0 a rounded frame's mask by shape (#385).
    Clip {
        item: String,
        rect: [f64; 4],
        radius: f64,
    },
    /// Coverage from the mask's paint over its rect, its edges ramped over `feather` u (#385).
    Mask {
        item: String,
        rect: [f64; 4],
        luminance: bool,
        fill: Fill,
        feather: f64,
    },
    /// `blend` is the group's when it names one (a group that does renders isolated). `effect`
    /// is what only the GPU layer draws of it: its passes, its backdrop, its dancing dissolve.
    Opacity {
        item: String,
        alpha: f64,
        blend: Option<Blend>,
        effect: Option<Arc<Effect>>,
    },
    /// `verbs` is the union of the fills inside, which draw inside it with no antialiasing of
    /// their own, so a shared edge shows neither of them partly and nothing under it.
    Cover { item: String, verbs: Arc<Vec<Verb>> },
    /// A clip to an outline, antialiased as the outline's own fill is (#160: a shade clipped to
    /// its shape).
    Shape { item: String, verbs: Arc<Vec<Verb>> },
    /// #495: coverage from another item's evaluated pixels, `source` drawn alone, frame by frame
    /// (Matte); only the GPU layer composites it.
    Matte {
        item: String,
        source: Arc<Vec<Drawn>>,
        mode: MatteMode,
        /// `luma: encoded`: Rec. 709 weights on sRGB-encoded values, as Lottie players take it.
        encoded: bool,
    },
}

/// A matte's `mode`: where its coverage comes from, and whether it is turned over.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatteMode {
    Alpha,
    AlphaInverted,
    Luma,
    LumaInverted,
}

impl MatteMode {
    fn read(id: &str, v: Option<&Value>) -> Result<MatteMode, Refused> {
        Ok(match v.and_then(Value::as_str) {
            Some("alpha") => MatteMode::Alpha,
            Some("alpha_inverted") => MatteMode::AlphaInverted,
            Some("luma") => MatteMode::Luma,
            Some("luma_inverted") => MatteMode::LumaInverted,
            _ => return refuse("bad_doc", format!("items/{id}/params/mode")),
        })
    }

    /// The mode's name, as a matte writes it.
    pub fn name(self) -> &'static str {
        match self {
            MatteMode::Alpha => "alpha",
            MatteMode::AlphaInverted => "alpha_inverted",
            MatteMode::Luma => "luma",
            MatteMode::LumaInverted => "luma_inverted",
        }
    }
}

/// One pass of a group (Frame and group: passes): the operator it names, with its item when the
/// document holds it, that operator's params at t, and how many u past the group's bounds it may
/// reach (`None`: what the operator declares).
#[derive(Clone, Debug, PartialEq)]
pub struct GroupPass {
    pub op: String,
    pub item: Option<Value>,
    pub params: Map<String, Value>,
    pub grow: Option<f64>,
}

/// What a group asks of the GPU layer beyond a Vello layer (Frame and group: passes; backdrop).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Effect {
    pub passes: Vec<GroupPass>,
    /// `backdrop: below`: the passes run on what the writer layer drew before it, inside the
    /// children's coverage, and the children aren't drawn.
    pub backdrop: bool,
    /// With dissolve: the hash takes the video frame index too.
    pub dancing: bool,
    /// #149: the marks inside are a fill or a line's coverage, laid through this medium.
    pub medium: Option<Arc<deep_canvas_drawn::medium::Medium>>,
    /// #467: the marks inside are an item's coverage, and this is the layer built from it.
    pub paint: Option<Arc<crate::fx::Part>>,
}

/// A group's blend (Frame and group: blend modes): the 16 W3C modes and add, which Vello draws,
/// and the eleven the GPU layer draws.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Blend {
    #[default]
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
    Add,
    Subtract,
    Divide,
    LinearBurn,
    LinearDodge,
    LinearLight,
    VividLight,
    PinLight,
    HardMix,
    DarkerColor,
    LighterColor,
    Dissolve,
}

impl Blend {
    pub const ALL: [(&'static str, Blend); 28] = [
        ("normal", Blend::Normal),
        ("multiply", Blend::Multiply),
        ("screen", Blend::Screen),
        ("overlay", Blend::Overlay),
        ("darken", Blend::Darken),
        ("lighten", Blend::Lighten),
        ("color_dodge", Blend::ColorDodge),
        ("color_burn", Blend::ColorBurn),
        ("hard_light", Blend::HardLight),
        ("soft_light", Blend::SoftLight),
        ("difference", Blend::Difference),
        ("exclusion", Blend::Exclusion),
        ("hue", Blend::Hue),
        ("saturation", Blend::Saturation),
        ("color", Blend::Color),
        ("luminosity", Blend::Luminosity),
        ("add", Blend::Add),
        ("subtract", Blend::Subtract),
        ("divide", Blend::Divide),
        ("linear_burn", Blend::LinearBurn),
        ("linear_dodge", Blend::LinearDodge),
        ("linear_light", Blend::LinearLight),
        ("vivid_light", Blend::VividLight),
        ("pin_light", Blend::PinLight),
        ("hard_mix", Blend::HardMix),
        ("darker_color", Blend::DarkerColor),
        ("lighter_color", Blend::LighterColor),
        ("dissolve", Blend::Dissolve),
    ];

    pub fn name(self) -> &'static str {
        Blend::ALL
            .iter()
            .find(|(_, b)| *b == self)
            .map_or("normal", |(n, _)| n)
    }

    /// Whether it's one of the eleven only the GPU layer draws.
    pub fn gpu_only(self) -> bool {
        self as usize >= Blend::Subtract as usize
    }

    /// A group's `blend`, if it names one.
    fn read(id: &str, v: Option<&Value>) -> Result<Option<Blend>, Refused> {
        let path = format!("items/{id}/params/blend");
        match v {
            None => Ok(None),
            Some(Value::String(name)) => match Blend::ALL.iter().find(|(n, _)| n == name) {
                Some((_, b)) => Ok(Some(*b)),
                None => refuse("bad_doc", path),
            },
            Some(_) => refuse("bad_doc", path),
        }
    }
}

impl Effect {
    /// A group's passes, backdrop and dancing, if it asks for any; a list past 8 passes, a pass
    /// without an op, a backdrop without passes and a dancing blend other than dissolve are
    /// refused, naming the field.
    fn read(
        id: &str,
        params: Option<&Value>,
        blend: Option<Blend>,
        items: &Map<String, Value>,
    ) -> Result<Option<Effect>, Refused> {
        let get = |k: &str| params.and_then(|p| p.get(k));
        let path = |f: &str| format!("items/{id}/params/{f}");
        let passes = match get("passes") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(list)) if list.len() > MAX_PASSES => {
                return refuse("operator_limit", path("passes"))
            }
            Some(Value::Array(list)) => list
                .iter()
                .enumerate()
                .map(|(i, p)| {
                    let at = format!("{}/{i}", path("passes"));
                    let Some(op) = p.get("op").and_then(Value::as_str) else {
                        return refuse("bad_doc", format!("{at}/op"));
                    };
                    let params = match p.get("params") {
                        None | Some(Value::Null) => Map::new(),
                        Some(Value::Object(m)) => m.clone(),
                        Some(_) => return refuse("bad_doc", format!("{at}/params")),
                    };
                    let grow = match p.get("grow") {
                        None | Some(Value::Null) => None,
                        v => match num(v) {
                            Some(g) if g >= 0.0 => Some(g),
                            _ => return refuse("bad_doc", format!("{at}/grow")),
                        },
                    };
                    let item = items.get(op).cloned();
                    Ok(GroupPass {
                        op: op.to_string(),
                        item,
                        params,
                        grow,
                    })
                })
                .collect::<Result<_, _>>()?,
            Some(_) => return refuse("bad_doc", path("passes")),
        };
        let backdrop = match get("backdrop") {
            None | Some(Value::Null) => false,
            Some(Value::String(b)) if b == "none" => false,
            Some(Value::String(b)) if b == "below" => true,
            Some(_) => return refuse("bad_doc", path("backdrop")),
        };
        if backdrop && passes.is_empty() {
            return refuse("operator_kind_rule", path("backdrop"));
        }
        let dancing = get("dancing") == Some(&Value::Bool(true));
        if dancing && blend != Some(Blend::Dissolve) {
            return refuse("bad_doc", path("dancing"));
        }
        Ok((!passes.is_empty() || dancing).then_some(Effect {
            passes,
            backdrop,
            dancing,
            medium: None,
            paint: None,
        }))
    }
}

/// A group holds at most 8 passes (Frame and group: passes).
pub const MAX_PASSES: usize = 8;

impl Scope {
    pub fn item(&self) -> &str {
        match self {
            Scope::Clip { item, .. }
            | Scope::Mask { item, .. }
            | Scope::Opacity { item, .. }
            | Scope::Cover { item, .. }
            | Scope::Shape { item, .. }
            | Scope::Matte { item, .. } => item,
        }
    }

    fn feed(&self, k: &mut KeyBuilder) {
        k.text(self.item());
        match self {
            Scope::Clip { rect, radius, .. } => {
                k.text("clip");
                rect.iter().chain([radius]).for_each(|v| {
                    k.number(*v);
                });
            }
            Scope::Mask {
                rect,
                luminance,
                fill,
                feather,
                ..
            } => {
                k.text(if *luminance { "luminance" } else { "alpha" });
                rect.iter().chain([feather]).for_each(|v| {
                    k.number(*v);
                });
                fill.feed(k);
            }
            Scope::Opacity {
                alpha,
                blend,
                effect,
                ..
            } => {
                k.text("opacity").number(*alpha);
                if let Some(b) = blend {
                    k.text(b.name());
                }
                if let Some(e) = effect {
                    k.text(if e.backdrop { "backdrop" } else { "passes" });
                    k.text(if e.dancing { "dancing" } else { "still" });
                    for p in &e.passes {
                        k.text(&p.op).number(p.grow.unwrap_or(-1.0));
                        k.text(&Value::Object(p.params.clone()).to_string());
                        k.text(&p.item.as_ref().map_or(String::new(), Value::to_string));
                    }
                    if let Some(m) = &e.medium {
                        k.text(&format!("{m:?}"));
                    }
                    if let Some(p) = &e.paint {
                        k.text(&format!("{p:?}"));
                    }
                }
            }
            Scope::Matte {
                source,
                mode,
                encoded,
                ..
            } => {
                k.text("matte")
                    .text(mode.name())
                    .text(if *encoded { "encoded" } else { "linear" });
                for d in source.iter() {
                    k.bytes(&d.key(path::bucket(1.0)).0);
                }
            }
            Scope::Cover { verbs, .. } | Scope::Shape { verbs, .. } => {
                k.text(if matches!(self, Scope::Cover { .. }) {
                    "cover"
                } else {
                    "shape"
                });
                for v in verbs.iter() {
                    verb_points(v).iter().for_each(|p| {
                        k.number(p[0]).number(p[1]);
                    });
                }
            }
        }
    }
}

/// A verb's points: where it moves or draws to, after its control points.
fn verb_points(v: &Verb) -> Vec<[f64; 2]> {
    match *v {
        Verb::Move(p) | Verb::Line(p) => vec![p],
        Verb::Quad(a, b) => vec![a, b],
        Verb::Cubic(a, b, c) => vec![a, b, c],
        Verb::Close => Vec::new(),
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

/// #1653: the atlas cell an image draws, laid out where atlas sets are.
pub use crate::atlas::AtlasCell;

/// A styled span of a text's one shaped run (`runs: [{from, to, role}]`): graphemes `[from, to)`
/// painted in `role`. It changes no glyph, so the run is shaped once and kerns across it. A
/// text's spans are in order and never overlap ([`text_runs`]).
#[derive(Clone, Debug, PartialEq)]
pub struct TextRun {
    pub from: usize,
    pub to: usize,
    pub role: String,
    pub color: Rgb,
    /// #1966: the opacity its glyphs draw at, 1 but on a code line a highlight dims.
    pub opacity: f64,
}

/// #1966: the opacity a text's grapheme draws at: its run's, else 1.
pub fn run_opacity(runs: &[TextRun], grapheme: usize) -> f64 {
    runs.get(runs.partition_point(|r| r.to <= grapheme))
        .filter(|r| r.from <= grapheme)
        .map_or(1.0, |r| r.opacity)
}

/// The role and color a text's grapheme is painted in: its run's, else the item's.
pub fn run_paint<'a>(
    runs: &'a [TextRun],
    grapheme: usize,
    role: Option<&'a str>,
    color: Rgb,
) -> (Option<&'a str>, Rgb) {
    runs.get(runs.partition_point(|r| r.to <= grapheme))
        .filter(|r| r.from <= grapheme)
        .map_or((role, color), |r| (Some(r.role.as_str()), r.color))
}

/// A text's runs that paint in a role of their own; a run that sets no role keeps the item's
/// paint. [`text_spans`] has already held every run's fields. #1965: after them, a code item's
/// tokens (`code`, its display form), in order with none overlapping ([`crate::code::runs`]).
fn text_runs(
    (palette, ty): (&Palette, &Type),
    params: &Map<String, Value>,
    path: &str,
    code: Option<&crate::code::Display>,
) -> Result<Vec<TextRun>, Refused> {
    let mut out = Vec::new();
    let list = params.get("runs").and_then(Value::as_array);
    for (i, run) in list.into_iter().flatten().enumerate() {
        let index = |k: &str| run.get(k).and_then(Value::as_u64).map(|n| n as usize);
        let (Some(from), Some(to), Some(Value::String(name))) =
            (index("from"), index("to"), run.get("role"))
        else {
            continue;
        };
        if from >= to {
            continue;
        }
        let at = format!("{path}/params/runs/{i}/role");
        out.push(TextRun {
            from,
            to,
            color: role(palette, run.get("role"), &at)?,
            role: name.clone(),
            opacity: 1.0,
        });
    }
    crate::code::runs((palette, ty), params, code, path, out)
}

/// #1964: a text's `runs` as styled spans of its one shaped run (`[{from, to, role, font, weight,
/// style, size, tracking, shift, underline, strike}] ≤ 1,024`), each field held at the run's
/// path: a run's font names a font of the look, and a run's weight sets its font (the item's
/// `family` when it names none) as the item's weight does, on its variable twin where no static
/// face has it. A run's role is resolved where it paints ([`text_runs`]); one naming a status role
/// is the document check's `status_color_unbound`, as any paint's is.
pub fn text_spans(
    params: &Map<String, Value>,
    path: &str,
    ty: &Type,
    (item_family, weight): (Option<&'static str>, u16),
) -> Result<Vec<deep_text::Span>, Refused> {
    const FIELDS: [&str; 11] = [
        "from",
        "to",
        "role",
        "font",
        "weight",
        "style",
        "size",
        "tracking",
        "shift",
        "underline",
        "strike",
    ];
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
        if let Some(field) = fields.keys().find(|k| !FIELDS.contains(&k.as_str())) {
            return refuse("bad_doc", format!("{at}/{field}"));
        }
        let bad = |field: &str| refuse("bad_doc", format!("{at}/{field}"));
        let index = |k: &str| fields.get(k).and_then(Value::as_u64).map(|n| n as usize);
        let (Some(from), Some(to)) = (index("from"), index("to")) else {
            return refuse("bad_doc", at);
        };
        if from >= to {
            return refuse("out_of_range", format!("{at}/to"));
        }
        if fields.get("role").is_some_and(|r| !r.is_string()) {
            return bad("role");
        }
        let number = |k: &str| match fields.get(k) {
            None => Ok(None),
            Some(v) => num(Some(v)).map(Some).ok_or(()),
        };
        let flag = |k: &str| match fields.get(k) {
            None => Ok(false),
            Some(Value::Bool(b)) => Ok(*b),
            Some(_) => Err(()),
        };
        let Ok(run_weight) = number("weight") else {
            return bad("weight");
        };
        let run_weight = match run_weight.map(f64::round) {
            None => None,
            Some(w) if (1.0..=1000.0).contains(&w) => Some(w as u16),
            Some(_) => return refuse("out_of_range", format!("{at}/weight")),
        };
        let family = match fields.get("font") {
            None => item_family.filter(|_| run_weight.is_some()),
            Some(Value::String(font)) => match ty.family(font) {
                Some(f) => Some(f),
                None => return refuse("ref_unresolved", format!("{at}/font: {font}")),
            },
            Some(_) => return bad("font"),
        }
        .map(|f| deep_text::fonts::family_at(f, run_weight.unwrap_or(weight)));
        let italic = match fields.get("style").map(Value::as_str) {
            None => None,
            Some(Some("normal")) => Some(false),
            Some(Some("italic")) => Some(true),
            Some(_) => return bad("style"),
        };
        let Ok(size) = number("size") else {
            return bad("size");
        };
        let Ok(tracking) = number("tracking") else {
            return bad("tracking");
        };
        if size.is_some_and(|s| s <= 0.0) {
            return refuse("out_of_range", format!("{at}/size"));
        }
        let shift = match fields.get("shift") {
            None => None,
            Some(Value::String(s)) if s == "sub" => Some(deep_text::Shift::Sub),
            Some(Value::String(s)) if s == "super" => Some(deep_text::Shift::Super),
            Some(v) => match num(Some(v)) {
                Some(u) => Some(deep_text::Shift::By(u as f32)),
                None => return bad("shift"),
            },
        };
        let Ok(underline) = flag("underline") else {
            return bad("underline");
        };
        let Ok(strike) = flag("strike") else {
            return bad("strike");
        };
        out.push(deep_text::Span {
            from,
            to,
            family,
            weight: run_weight,
            italic,
            size: size.map(|s| s as f32),
            tracking: tracking.map(|t| t as f32),
            shift,
            underline,
            strike,
        });
    }
    Ok(out)
}

/// What a text mark is shaped from: `text@1`'s text, font role, size, weight, box width, line
/// limit, overflow and alignment, and (#417) the family its font sets it in, the look's fallback
/// families and its language.
#[derive(Clone, Debug, PartialEq)]
pub struct TextSpec {
    pub text: String,
    pub font: String,
    /// The bundled family `font` names in the look; `None` for a font nothing bundles.
    pub family: Option<&'static str>,
    pub fallback: Vec<&'static str>,
    /// `lang` (BCP 47), the language the text is shaped in.
    pub lang: Option<String>,
    pub size: f64,
    pub weight: u16,
    pub width: Option<f64>,
    /// `max_lines`: lines past it are cut with an ellipsis, or masked.
    pub max_lines: Option<u16>,
    /// `overflow: mask`: text that doesn't fit draws whole, clipped to its box.
    pub mask: bool,
    pub align: Align,
    /// A bound value: tabular figures, never cut short.
    pub bound: bool,
    /// #1964: `runs`' styled spans of the one shaped run.
    pub spans: Vec<deep_text::Span>,
    /// #1966: a list's `gap`, the space after each of its items, and its `indent`, where its
    /// lines start.
    pub gap: f64,
    pub indent: f64,
}

impl TextSpec {
    /// The shaped run's content key: the shaper's inputs, never where the text sits.
    pub fn key(&self) -> ContentKey {
        let mut k = KeyBuilder::new("shape@text.1");
        // #140: the fonts backend's name and version, so a new version misses what it keyed.
        k.text(deep_text::FONTS.name)
            .text(deep_text::FONTS.version)
            .text("text@1")
            .text(&self.text)
            .text(&self.font)
            .text(self.family.unwrap_or(""))
            .int(self.fallback.len() as i64);
        for family in &self.fallback {
            k.text(family);
        }
        k.text(self.lang.as_deref().unwrap_or(""))
            .number(self.size)
            .int(i64::from(self.weight));
        match self.width {
            Some(w) => k.text("width").number(w),
            None => k.text("auto"),
        };
        k.text(if self.bound { "bound" } else { "free" });
        match self.max_lines {
            Some(n) => k.text("lines").int(i64::from(n)),
            None => k.text("all"),
        };
        k.text(if self.mask { "mask" } else { "ellipsis" });
        k.int(self.align as i64);
        if !self.spans.is_empty() {
            k.text(&format!("{:?}", self.spans));
        }
        if self.gap > 0.0 || self.indent > 0.0 {
            k.text("list").number(self.gap).number(self.indent);
        }
        k.finish()
    }
}

/// What a `text@1` item is shaped from: its text (or what its bound value or counter shows),
/// font role, size, weight, box width, alignment, and tabular figures for a bound number, set in
/// the bundled roles' families with no fallback.
pub fn text_spec(
    id: &str,
    params: &Map<String, Value>,
    shown: Option<&Shown>,
) -> Result<TextSpec, Refused> {
    text_spec_in(id, params, shown, &Type::default())
}

/// [`text_spec`] in a look's type (#417): its font names and roles, and its fallback families.
pub fn text_spec_in(
    id: &str,
    params: &Map<String, Value>,
    shown: Option<&Shown>,
    ty: &Type,
) -> Result<TextSpec, Refused> {
    let code = crate::code::read(params, &format!("items/{id}"))?;
    text_spec_of(id, params, shown, ty, code.map(|d| d.text))
}

/// [`text_spec_in`] for an item whose code, if it is code, shows the display text `code`.
fn text_spec_of(
    id: &str,
    params: &Map<String, Value>,
    shown: Option<&Shown>,
    ty: &Type,
    code: Option<String>,
) -> Result<TextSpec, Refused> {
    let path = format!("items/{id}");
    let written = params.get("text").and_then(Value::as_str);
    // A code item shows its raw bytes' display form (Text `text@1`: code).
    let text = shown
        .map(|s| s.text.clone())
        .or_else(|| written.map(str::to_string).or(code));
    let Some(text) = text else {
        return refuse("bad_doc", format!("{path}/params/text"));
    };
    // #1965: code is set in the look's monospace font role.
    let font = params
        .get("font")
        .and_then(Value::as_str)
        .unwrap_or(if params.contains_key("code") {
            "mono"
        } else {
            "body"
        })
        .to_string();
    let lang = match params.get("lang") {
        None => None,
        Some(Value::String(lang)) => Some(lang.clone()),
        Some(_) => return refuse("bad_doc", format!("{path}/params/lang")),
    };
    // #496: a weight a channel or driver writes arrives as a number, rounded to a whole unit;
    // a weight no static face of the family has is set on its variable twin.
    let weight = params
        .get("weight")
        .and_then(Value::as_f64)
        .map(f64::round)
        .filter(|w| (1.0..=1000.0).contains(w))
        .map_or(400, |w| w as u16);
    let size = num(params.get("size")).unwrap_or(13.0);
    // #1966: a list's items start `indent` in from its box's edge, `gap` apart.
    let list = crate::lines::list(params, size, &path)?;
    Ok(TextSpec {
        gap: list.map_or(0.0, |l| l.gap),
        indent: list.map_or(0.0, |l| l.indent),
        spans: text_spans(params, &path, ty, (ty.family(&font), weight))?,
        text,
        family: ty
            .family(&font)
            .map(|f| deep_text::fonts::family_at(f, weight)),
        fallback: ty.fallback.clone(),
        lang,
        font,
        size,
        weight,
        width: params.get("box").and_then(|b| num(b.get("w"))),
        max_lines: match params.get("max_lines") {
            None => None,
            Some(n) => match n.as_u64().and_then(|n| u16::try_from(n).ok()) {
                Some(n) => Some(n),
                None => return refuse("bad_doc", format!("{path}/params/max_lines")),
            },
        },
        mask: match params.get("overflow") {
            None => false,
            Some(Value::String(o)) if o == "ellipsis" => false,
            Some(Value::String(o)) if o == "mask" => true,
            Some(_) => return refuse("bad_doc", format!("{path}/params/overflow")),
        },
        // #407: localized copy shows as text does, never as a bound number.
        bound: shown.is_some_and(|s| s.bound != COPY)
            || params.get("numerals").and_then(Value::as_str) == Some("tabular"),
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
            family: self.family?,
            fallback: &self.fallback,
            lang: self.lang.as_deref(),
            size: self.size as f32,
            weight: self.weight,
            line_height: None,
            width: self.width.map(|w| w as f32),
            max_lines: self.max_lines,
            align: match self.align {
                Align::Start => deep_text::Align::Start,
                Align::Center => deep_text::Align::Center,
                Align::End => deep_text::Align::End,
            },
            bound: self.bound,
            tabular: self.bound,
            mask: self.mask,
            spans: &self.spans,
            gap: self.gap as f32,
            indent: self.indent as f32,
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
        /// #1653: the atlas cell it draws, for a row of an atlas set.
        tile: Option<AtlasCell>,
        /// #535: degrees it turns about the centre of `bounds`, x toward y.
        turn: f64,
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
    /// Issue #160: the width along the stroke's length, when it tapers, waves or is drawn per
    /// point; `None` for one width throughout.
    pub profile: Option<Box<paint::Profile>>,
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
    /// A box in u holding every pixel the mark draws: its outline, its stroke's width, a text's
    /// lines at its widest; inside its rect masks.
    pub fn extent(&self) -> [f64; 4] {
        let grown = |b: [f64; 4], m: f64| [b[0] - m, b[1] - m, b[2] + 2.0 * m, b[3] + 2.0 * m];
        let b = match &self.mark {
            Mark::Rect { bounds, .. } => *bounds,
            Mark::Image { bounds, turn, .. } => crate::turn::turned_box(*bounds, *turn),
            Mark::Circle { center, r, .. } => [center[0] - r, center[1] - r, 2.0 * r, 2.0 * r],
            Mark::Path {
                geometry, offset, ..
            } => {
                let [x, y, w, h] = bounds_of(&geometry.verbs);
                grown(
                    [x + offset[0], y + offset[1], w, h],
                    geometry.stroke.unwrap_or(0.0),
                )
            }
            Mark::Shape { verbs, stroke, .. } => {
                let reach = stroke.as_ref().map_or(0.0, |l| match &l.profile {
                    // A stroke of any width draws to the outline's widest, at most this far.
                    Some(_) => bounds_of(verbs)[2].max(bounds_of(verbs)[3]),
                    None => l.width,
                });
                grown(bounds_of(verbs), reach)
            }
            Mark::Text { spec, origin, .. } => {
                let lines = spec.max_lines.map_or(4.0, f64::from);
                let width = spec
                    .width
                    .unwrap_or(spec.text.chars().count() as f64 * spec.size);
                grown(
                    [
                        origin[0],
                        origin[1] - spec.size,
                        width,
                        lines * spec.size * 2.0,
                    ],
                    spec.size,
                )
            }
        };
        match self.clip {
            Some(c) => {
                let (x0, y0) = (b[0].max(c[0]), b[1].max(c[1]));
                let (x1, y1) = (
                    (b[0] + b[2]).min(c[0] + c[2]),
                    (b[1] + b[3]).min(c[1] + c[3]),
                );
                [x0, y0, (x1 - x0).max(0.0), (y1 - y0).max(0.0)]
            }
            None => b,
        }
    }

    /// The mark as its item draws after moving by `d` u and nothing else (#397: a frame where an
    /// item only moved reuses its marks); `None` for a mark a frame must rebuild: an outline, a
    /// gradient, or one inside a scope.
    pub fn translated(&self, d: [f64; 2]) -> Option<Drawn> {
        if !self.scopes.is_empty() {
            return None;
        }
        let shift = |p: [f64; 2]| [p[0] + d[0], p[1] + d[1]];
        let shift4 = |b: [f64; 4]| [b[0] + d[0], b[1] + d[1], b[2], b[3]];
        let mut mark = self.mark.clone();
        match &mut mark {
            Mark::Rect {
                bounds,
                fill: Fill::Solid(_),
                ..
            }
            | Mark::Image { bounds, .. } => *bounds = shift4(*bounds),
            Mark::Circle { center, .. } => *center = shift(*center),
            Mark::Path { offset, .. } => *offset = shift(*offset),
            Mark::Text { origin, .. } => *origin = shift(*origin),
            _ => return None,
        }
        Some(Drawn {
            mark,
            clip: self.clip.map(shift4),
            scopes: Vec::new(),
        })
    }

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
                        match &l.profile {
                            Some(p) => p.feed(k),
                            None => {
                                k.text("no profile");
                            }
                        }
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
                    k.number(r.opacity);
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
                tile,
                turn,
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
                if let Some(t) = tile {
                    k.text("tile").int(t.index as i64).int(i64::from(t.flip));
                    [t.cell, t.margin, t.separation]
                        .iter()
                        .flatten()
                        .for_each(|v| {
                            k.number(*v);
                        });
                }
                // Unturned is the default, so an image without a turn keeps its key.
                if *turn != 0.0 {
                    k.text("turn").number(*turn);
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
    /// Its marks, shared with the items that made them (#857): a frame places them uncopied.
    pub marks: MarkList,
    pub key: ContentKey,
}

/// The marks a [`MarkList`] holds in each block.
const BLOCK: usize = 512;

/// A layer's marks in draw order, in blocks shared between the frames that hold them (#896): a
/// frame that replaces one mark of the last frame's list copies that mark's block, not the list.
#[derive(Clone, Default)]
pub struct MarkList {
    blocks: Vec<Arc<Vec<Arc<Drawn>>>>,
}

type Block = Arc<Vec<Arc<Drawn>>>;
pub type MarkListIter<'a> = std::iter::FlatMap<
    std::slice::Iter<'a, Block>,
    std::slice::Iter<'a, Arc<Drawn>>,
    fn(&'a Block) -> std::slice::Iter<'a, Arc<Drawn>>,
>;

impl MarkList {
    pub fn len(&self) -> usize {
        self.blocks.iter().map(|b| b.len()).sum()
    }

    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    pub fn iter(&self) -> MarkListIter<'_> {
        let each: fn(&Block) -> std::slice::Iter<'_, Arc<Drawn>> = |b| b.iter();
        self.blocks.iter().flat_map(each)
    }

    /// Puts `drawn` at `at`, copying only its block when another list shares it.
    pub fn set(&mut self, at: usize, drawn: Arc<Drawn>) {
        Arc::make_mut(&mut self.blocks[at / BLOCK])[at % BLOCK] = drawn;
    }
}

impl std::ops::Index<usize> for MarkList {
    type Output = Arc<Drawn>;

    fn index(&self, at: usize) -> &Arc<Drawn> {
        &self.blocks[at / BLOCK][at % BLOCK]
    }
}

impl<'a> IntoIterator for &'a MarkList {
    type Item = &'a Arc<Drawn>;
    type IntoIter = MarkListIter<'a>;

    fn into_iter(self) -> MarkListIter<'a> {
        self.iter()
    }
}

impl FromIterator<Arc<Drawn>> for MarkList {
    fn from_iter<I: IntoIterator<Item = Arc<Drawn>>>(marks: I) -> MarkList {
        let all: Vec<Arc<Drawn>> = marks.into_iter().collect();
        MarkList {
            blocks: all.chunks(BLOCK).map(|c| Arc::new(c.to_vec())).collect(),
        }
    }
}

impl PartialEq for MarkList {
    fn eq(&self, other: &MarkList) -> bool {
        self.len() == other.len() && self.iter().eq(other.iter())
    }
}

impl std::fmt::Debug for MarkList {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

/// A frame's draw list.
#[derive(Clone, Debug, PartialEq)]
pub struct Frame {
    pub size: [f64; 2],
    pub ground: Rgb,
    pub layers: Vec<Layer>,
}

/// The object at `v`, or an empty one when `v` is missing or isn't an object.
pub fn object_or_empty(v: Option<&Value>) -> &Map<String, Value> {
    static EMPTY: OnceLock<Map<String, Value>> = OnceLock::new();
    v.and_then(Value::as_object)
        .unwrap_or_else(|| EMPTY.get_or_init(Map::new))
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
pub(crate) fn bounds_of(verbs: &[Verb]) -> [f64; 4] {
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
        // #149: a noise fill draws its ramp through the drawn pass, and a named fill or line takes
        // the ink when it names no role; #1646: so does a dither fill its stops.
        if let Some(n) = p.get("dither") {
            let first = n.pointer("/stops/0");
            return Ok(Fill::Solid(role(
                self.palette,
                first,
                &format!("{path}/dither/stops/0"),
            )?));
        }
        if let Some(n) = p.get("noise") {
            let first = n.pointer("/stops/0/role");
            return Ok(Fill::Solid(role(
                self.palette,
                first,
                &format!("{path}/noise/stops/0/role"),
            )?));
        }
        if !p.contains_key("role") && (p.contains_key("fill") || p.contains_key("line")) {
            let ink = Value::String("ink".into());
            let at = format!("{path}/role");
            return Ok(Fill::Solid(role(self.palette, Some(&ink), &at)?));
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

    /// Issue #160: the marks of a path-like item built through its ops ([`build_path`]): one
    /// [`Mark::Shape`] per copy, each at its copy's opacity, a repeater's copies composited
    /// below (the first on top) or above, and each copy's heads after it in the stroke's paint.
    fn shapes(
        &self,
        id: &str,
        built: &PathBuilt,
        place: Place,
        paint: &Map<String, Value>,
        path: &str,
    ) -> Result<Vec<Mark>, Refused> {
        let mut order: Vec<usize> = (0..built.copies.len()).collect();
        if built.below {
            order.reverse();
        }
        let mut out = Vec::new();
        for k in order {
            let copy = &built.copies[k];
            let mut mark = self.shape_with(
                id,
                copy.verbs.clone(),
                place,
                paint,
                path,
                (built.widths.clone(), built.alphas.clone()),
            )?;
            if copy.opacity < 1.0 {
                if let Mark::Shape { fill, stroke, .. } = &mut mark {
                    fill.iter_mut().for_each(|(_, o)| *o *= copy.opacity);
                    stroke.iter_mut().for_each(|l| l.opacity *= copy.opacity);
                }
            }
            out.push(mark);
            let Some(s) = paint.get("stroke").and_then(Value::as_object) else {
                continue;
            };
            let heads = built.ends.iter().filter(|(c, _)| *c == k);
            if heads.clone().next().is_none() {
                continue;
            }
            let width = num(s.get("width")).unwrap_or(1.0);
            let stroke_path = format!("{path}/stroke");
            let fill = self.paint(id, s, &stroke_path, bounds_of(&copy.verbs), place, true)?;
            let alpha = opacity(paint.get("opacity"), &format!("{path}/opacity"))?
                * opacity(s.get("opacity"), &format!("{stroke_path}/opacity"))?
                * copy.opacity;
            for (_, h) in heads {
                out.push(Mark::Shape {
                    item: format!("{id}#ends.{}", h.at),
                    verbs: place.verbs(h.verbs.clone()),
                    fill: h.filled.then(|| (fill.clone(), alpha)),
                    stroke: (!h.filled).then(|| Line {
                        width,
                        paint: fill.clone(),
                        opacity: alpha,
                        dashes: None,
                        profile: None,
                    }),
                });
            }
        }
        Ok(out)
    }

    /// A path-like item's outline as a [`Mark::Shape`] where it draws: `verbs` in the item's own
    /// space, its fill and its stroke each a role, a stepped color or a gradient over the
    /// outline's box, at their opacity; with (#160) a hand-drawn stroke's per-point widths and
    /// opacities at their arc lengths.
    fn shape_with(
        &self,
        id: &str,
        verbs: Vec<Verb>,
        place: Place,
        paint: &Map<String, Value>,
        path: &str,
        (widths, alphas): (Column, Column),
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
                let mut stroke_paint = self.paint(id, s, &path, bounds, place, true)?;
                // A per-point opacity column paints the stroke along its length (#160).
                if let Fill::Solid(c) = &stroke_paint {
                    stroke_paint = along_alphas(*c, &alphas);
                }
                Some(Line {
                    width: num(s.get("width")).unwrap_or(1.0) * k,
                    paint: stroke_paint,
                    opacity: all * opacity(s.get("opacity"), &format!("{path}/opacity"))?,
                    dashes,
                    profile: paint::profile(s, &path, widths)?.map(Box::new),
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

/// A per-point column at each point's arc length (#160).
pub type Column = Vec<(f64, f64)>;

/// `color` painted along a stroke's length at each point's opacity from `alphas`, or solid when
/// there is no opacity column.
pub(crate) fn along_alphas(color: Rgb, alphas: &Column) -> Fill {
    let Some((last, _)) = alphas.last() else {
        return Fill::Solid(color);
    };
    let total = last.max(1e-12);
    Fill::Ramp(paint::Ramp {
        geometry: paint::Geometry::Along,
        extend: paint::Extend::Pad,
        stops: alphas
            .iter()
            .map(|(s, a)| (s / total, paint::unit(color), *a))
            .collect(),
        transform: paint::IDENTITY,
    })
}

/// A path-like item built through its ops (#160): what the `path` surface reports and the marks
/// draw from. Copies are in copy order (copy 0 first) in the item's own space, with each one's
/// heads; `placed` holds each copy where it draws.
#[derive(Clone, Debug, PartialEq)]
pub struct PathBuilt {
    pub copies: Vec<pathops::Copy>,
    pub placed: Vec<Vec<Verb>>,
    /// Each head with the index of the copy it ends, in the item's own space.
    pub ends: Vec<(usize, ends::Built)>,
    /// The segment count the ops declared from their params before building.
    pub declared: u64,
    /// The segments built, across every copy.
    pub segments: u64,
    pub widths: Column,
    pub alphas: Column,
    /// The tessellation's key: everything it builds from, in the item's own space.
    pub digest: ContentKey,
    /// A repeater's copies draw below (the first on top) rather than above.
    pub below: bool,
    /// Flicks each repeater copy lags the one before, 0 for none.
    pub lag: i64,
}

/// Builds `verbs` (after any attachment, in the item's own space) through the item's ops, with
/// its per-point columns and its ends. The declared segments are checked before anything builds.
fn build_path(
    ctx: &ItemCtx<'_>,
    id: &str,
    verbs: Vec<Verb>,
    params: &Map<String, Value>,
    paint: &Map<String, Value>,
    place: Place,
) -> Result<PathBuilt, Refused> {
    let ops_path = format!("items/{id}/params/ops");
    let ops = pathops::read(params.get("ops"), &ops_path)?;
    let (widths, alphas) = columns(ctx, id, params, &verbs)?;
    let ends = ends::Ends::read(params.get("ends"), &format!("items/{id}/params/ends"))?;
    let (declared, over) = pathops::declared(&ops, &verbs);
    if let Some(i) = over {
        return refuse("segment_budget", format!("{ops_path}/{i}"));
    }
    let (below, lag) = match pathops::lagged_repeater(&ops) {
        Some((_, r)) => (r.composite == pathops::Composite::Below, r.lag),
        None => (
            ops.iter().any(|o| matches!(o, pathops::Op::Repeater(r) if r.composite == pathops::Composite::Below)),
            0,
        ),
    };
    let mut copies = if ops.is_empty() {
        vec![pathops::Copy {
            verbs,
            opacity: 1.0,
            copy: None,
            transform: pathops::IDENTITY,
        }]
    } else {
        // A lagging repeater's earlier sources (#160): the item's geometry as it was k × lag
        // earlier, which whoever evaluates the document supplies under `#lagged`.
        let lagged: Vec<Vec<Verb>> = match ctx.planted {
            Planted::RepeaterEvaluatesAtT => Vec::new(),
            _ => params
                .get(LAGGED)
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|it| {
                            let p = object_or_empty(it.get("params"));
                            base_verbs(it.get("kind").and_then(Value::as_str)?, p)
                        })
                        .collect()
                })
                .unwrap_or_default(),
        };
        let moved = match ctx.planted {
            Planted::Moved(op) => Some(op),
            _ => None,
        };
        pathops::apply_planted(&ops, &verbs, &lagged, moved)
    };
    // Copy order: copy 0 first, whatever the composite.
    copies.sort_by_key(|c| c.copy.map_or(0, |(k, _)| k));
    let stroke_width = paint
        .get("stroke")
        .and_then(|s| num(s.get("width")))
        .unwrap_or(1.0);
    let mut heads = Vec::new();
    if let Some(e) = &ends {
        for (k, copy) in copies.iter().enumerate() {
            for h in ends::build(&copy.verbs, e, stroke_width) {
                heads.push((k, h));
            }
        }
    }
    let segments = copies.iter().map(|c| pathops::segments(&c.verbs)).sum();
    let mut k = KeyBuilder::new("tessellate@marks2d.160");
    for c in &copies {
        k.int(c.verbs.len() as i64).number(c.opacity);
        for v in &c.verbs {
            for p in verb_points(v) {
                k.number(p[0]).number(p[1]);
            }
        }
    }
    for (_, h) in &heads {
        k.text(h.kind)
            .number(h.tip[0])
            .number(h.tip[1])
            .number(h.length)
            .number(h.width);
    }
    k.number(stroke_width);
    // The stroke's taper and wave set widths at tessellation too.
    for field in ["taper", "wave"] {
        let v = paint.get("stroke").and_then(|s| s.get(field));
        k.text(&v.map_or(String::new(), Value::to_string));
    }
    for (s, w) in widths.iter().chain(&alphas) {
        k.number(*s).number(*w);
    }
    let placed = copies
        .iter()
        .map(|c| place.verbs(c.verbs.clone()))
        .collect();
    Ok(PathBuilt {
        ends: heads,
        copies,
        placed,
        declared,
        segments,
        widths,
        alphas,
        digest: k.finish(),
        below,
        lag,
    })
}

/// The anchor points of a path: its M and L points and each curve's end.
fn anchors_of(verbs: &[Verb]) -> Vec<[f64; 2]> {
    verbs
        .iter()
        .filter_map(|v| match v {
            Verb::Move(p) | Verb::Line(p) | Verb::Quad(_, p) | Verb::Cubic(_, _, p) => Some(*p),
            Verb::Close => None,
        })
        .collect()
}

/// A per-point column's values as written: a list of numbers, or a column `{dtype, len, data}`;
/// `None` when absent. Refused with `column_length` when its length differs from `points`.
fn column_values(
    id: &str,
    params: &Map<String, Value>,
    name: &str,
    points: usize,
) -> Result<Option<Vec<f64>>, Refused> {
    let path = format!("items/{id}/params/{name}");
    let values: Vec<f64> = match params.get(name) {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Array(list)) => list
            .iter()
            .map(|v| num(Some(v)))
            .collect::<Option<Vec<f64>>>()
            .ok_or(Refused {
                code: "bad_doc",
                path: path.clone(),
            })?,
        Some(Value::Object(c)) => {
            let len = c.get("len").and_then(Value::as_u64).unwrap_or(0) as usize;
            match data::column_of(&Value::Object(c.clone()), len, &path)? {
                data::Column::Numbers(v) => v,
                _ => return refuse("bad_doc", path),
            }
        }
        Some(_) => return refuse("bad_doc", path),
    };
    if values.len() != points {
        return refuse("column_length", path);
    }
    if values.iter().any(|v| !v.is_finite() || *v < 0.0) {
        return refuse("out_of_range", path);
    }
    Ok(Some(values))
}

/// Each anchor's arc length along `verbs`, by the segments between them.
fn anchor_lengths(verbs: &[Verb], count: usize) -> Vec<f64> {
    let mut at = Vec::with_capacity(count);
    let mut s = 0.0;
    at.push(0.0);
    for sub in pathops::subs_of(verbs) {
        for (i, seg) in sub.segs.iter().enumerate() {
            let closing = sub.closed && i + 1 == sub.segs.len() && seg.end() == sub.segs[0].start();
            s += seg.length();
            if !closing {
                at.push(s);
            }
        }
    }
    at.truncate(count);
    while at.len() < count {
        at.push(s);
    }
    at
}

/// The outlined group `id` draws inside, if any, with whether a sibling under it carries `name`.
fn joined_under(ctx: &ItemCtx<'_>, id: &str, name: &str) -> Option<bool> {
    let parent = ctx.items.get(id)?.get("parent").and_then(Value::as_str)?;
    let group = ctx.items.get(parent)?;
    if group.get("kind").and_then(Value::as_str) != Some("group@1")
        || group
            .get("params")
            .and_then(|p| p.get("outline"))
            .is_none_or(Value::is_null)
    {
        return None;
    }
    Some(ctx.items.iter().any(|(cid, c)| {
        cid != id
            && c.get("parent").and_then(Value::as_str) == Some(parent)
            && c.get("params")
                .and_then(|p| p.get(name))
                .is_some_and(|v| !v.is_null())
    }))
}

/// A path's per-point `width` and `opacity` columns (#160), each at its anchor's arc length. A
/// column whose length differs from the path's point count is refused with `column_length`,
/// naming the column, and neither is ever zero-filled: a part of a union outline that lacks a
/// column its siblings have takes the column's default (an opacity of 1), which the planted
/// `merge_zero_fills` gives 0 instead.
fn columns(
    ctx: &ItemCtx<'_>,
    id: &str,
    params: &Map<String, Value>,
    verbs: &[Verb],
) -> Result<(Column, Column), Refused> {
    // With neither column written, the usual shape, both are empty: no arc length is measured.
    let written = |name: &str| params.get(name).is_some_and(|v| !v.is_null());
    if !written("width") && !written("opacity") && ctx.planted != Planted::MergeZeroFills {
        return Ok((Vec::new(), Vec::new()));
    }
    let anchors = anchors_of(verbs);
    let at = anchor_lengths(verbs, anchors.len());
    let read = |name: &str| -> Result<Column, Refused> {
        let values = match column_values(id, params, name, anchors.len())? {
            Some(v) => v,
            None => match (ctx.planted, joined_under(ctx, id, name)) {
                (Planted::MergeZeroFills, Some(true)) => vec![0.0; anchors.len()],
                _ => return Ok(Vec::new()),
            },
        };
        Ok(at.iter().copied().zip(values).collect())
    };
    Ok((read("width")?, read("opacity")?))
}

/// The path's ends moved by its `attach` (Path `path@1`: `attach`), and its line bent by its
/// `bend`. An end that names an item stops where the line toward the other end meets that
/// item's box (`edge`), its true outline (`outline`) or its centre, less its gap; one that names
/// `#at:<f>` lands on that point of the target path. Boxes come from the frame's first pass, so
/// the first pass leaves the path as it is.
fn attached(
    ctx: &ItemCtx<'_>,
    verbs: Vec<Verb>,
    params: &Map<String, Value>,
    path: &str,
) -> Result<Vec<Verb>, Refused> {
    let bend = match params.get("bend") {
        None | Some(Value::Null) => 0.0,
        Some(v) => num(Some(v)).ok_or(Refused {
            code: "bad_doc",
            path: format!("{path}/params/bend"),
        })?,
    };
    let attach = match params.get("attach") {
        None | Some(Value::Null) => None,
        Some(Value::Object(a)) => Some(a),
        Some(_) => return refuse("bad_doc", format!("{path}/params/attach")),
    };
    let first = verbs.iter().find_map(|v| match v {
        Verb::Move(p) => Some(*p),
        _ => None,
    });
    let last = verbs.iter().rev().find_map(|v| match v {
        Verb::Move(p) | Verb::Line(p) | Verb::Quad(_, p) | Verb::Cubic(_, _, p) => Some(*p),
        Verb::Close => None,
    });
    let (Some(mut start), Some(mut end)) = (first, last) else {
        return Ok(verbs);
    };
    let mut moved = false;
    if let Some(a) = attach {
        let apath = format!("{path}/params/attach");
        let at = match a.get("at").and_then(Value::as_str) {
            None => "edge",
            Some(s @ ("edge" | "center" | "outline")) => s,
            Some(_) => return refuse("bad_doc", format!("{apath}/at")),
        };
        let gap = match a.get("gap") {
            None | Some(Value::Null) => 4.0,
            Some(v) => num(Some(v)).filter(|g| *g >= 0.0).ok_or(Refused {
                code: "out_of_range",
                path: format!("{apath}/gap"),
            })?,
        };
        let target = |name: &str| -> Result<Option<String>, Refused> {
            match a.get(name) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(t)) if !t.is_empty() => Ok(Some(t.clone())),
                Some(_) => refuse("bad_doc", format!("{apath}/{name}")),
            }
        };
        let (ts, te) = (target("start")?, target("end")?);
        // Where the other end points from: its own point, or its target's centre.
        let centre_of = |t: &str| -> Result<Option<[f64; 2]>, Refused> {
            let (tid, part) = t.split_once('#').map_or((t, None), |(i, p)| (i, Some(p)));
            if let Some(f) = part.and_then(|p| p.strip_prefix("at:")) {
                let f: f64 = f.parse().map_err(|_| Refused {
                    code: "bad_doc",
                    path: apath.clone(),
                })?;
                let outline = item_outline(ctx.items, tid).ok_or(Refused {
                    code: "ref_unresolved",
                    path: apath.clone(),
                })?;
                return Ok(pathops::at(&outline, f).map(|(p, _)| p));
            }
            let key = part.map_or(tid.to_string(), |p| format!("{tid}#{p}"));
            let boxed = ctx
                .paints
                .box_of(&key, &apath)
                .or_else(|_| ctx.paints.box_of(tid, &apath))?;
            Ok(boxed.map(|b| [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0]))
        };
        let solve = |t: &str, from: [f64; 2]| -> Result<Option<[f64; 2]>, Refused> {
            let (tid, part) = t.split_once('#').map_or((t, None), |(i, p)| (i, Some(p)));
            if part.is_some_and(|p| p.starts_with("at:")) {
                return centre_of(t);
            }
            let key = part.map_or(tid.to_string(), |p| format!("{tid}#{p}"));
            let Some(b) = ctx
                .paints
                .box_of(&key, &apath)
                .or_else(|_| ctx.paints.box_of(tid, &apath))?
            else {
                return Ok(None);
            };
            let centre = [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
            let hit = match at {
                "center" => return Ok(Some(centre)),
                "outline" => match item_outline(ctx.items, tid) {
                    Some(o) if part.is_none() => {
                        first_hit(&o, from, centre).unwrap_or_else(|| box_hit(b, from))
                    }
                    _ => box_hit(b, from),
                },
                _ => box_hit(b, from),
            };
            let d = [from[0] - hit[0], from[1] - hit[1]];
            let l = deep_canvas::ops::hypot(d[0], d[1]);
            Ok(Some(if l > 0.0 {
                [hit[0] + d[0] / l * gap, hit[1] + d[1] / l * gap]
            } else {
                hit
            }))
        };
        let from_end = match &te {
            Some(t) => centre_of(t)?.unwrap_or(end),
            None => end,
        };
        let from_start = match &ts {
            Some(t) => centre_of(t)?.unwrap_or(start),
            None => start,
        };
        if let Some(t) = &ts {
            if let Some(p) = solve(t, from_end)? {
                start = p;
                moved = true;
            }
        }
        if let Some(t) = &te {
            if let Some(p) = solve(t, from_start)? {
                end = p;
                moved = true;
            }
        }
    }
    let two = matches!(verbs.as_slice(), [Verb::Move(_), Verb::Line(_)]);
    if bend != 0.0 && two {
        return Ok(pathops::bent(start, end, bend));
    }
    if !moved {
        return Ok(verbs);
    }
    if two {
        return Ok(vec![Verb::Move(start), Verb::Line(end)]);
    }
    // A longer path keeps its shape and moves its first and last anchors.
    let n = verbs.len();
    let mut out = verbs;
    if let Some(Verb::Move(p)) = out.first_mut() {
        *p = start;
    }
    if let Some(Verb::Line(p) | Verb::Quad(_, p) | Verb::Cubic(_, _, p)) = out.get_mut(n - 1) {
        *p = end;
    }
    Ok(out)
}

/// A child's ring for a union outline: its outline filled and stroked `2 × reach` out in the
/// role, or for a stroked path its stroke widened by as much; with the child's per-point
/// opacities when it has them, so a part drawn faint rings faint.
fn ring_mark(
    ctx: &ItemCtx<'_>,
    item: String,
    cid: &str,
    verbs: Vec<Verb>,
    color: Rgb,
    reach: f64,
) -> Result<Mark, Refused> {
    let child = &ctx.items[cid];
    let params = object_or_empty(child.get("params"));
    let paint = object_or_empty(params.get("paint"));
    let fill = paint.get("fill").is_some_and(|f| !f.is_null());
    let stroke_width = paint
        .get("stroke")
        .and_then(|s| num(s.get("width")))
        .unwrap_or(0.0);
    let (_, alphas) = columns(ctx, cid, params, &verbs)?;
    let paint = along_alphas(color, &alphas);
    Ok(Mark::Shape {
        item,
        verbs,
        fill: fill.then(|| (paint.clone(), 1.0)),
        stroke: Some(Line {
            width: stroke_width + 2.0 * reach,
            paint,
            opacity: 1.0,
            dashes: None,
            profile: None,
        }),
    })
}

/// The children of a group `id`, in draw order.
fn children_in_order(ctx: &ItemCtx<'_>, id: &str) -> Vec<(String, Rank)> {
    let mut out: Vec<(String, Rank)> = ctx
        .items
        .iter()
        .filter(|(cid, c)| {
            c.get("visible") != Some(&Value::Bool(false))
                && ancestors(ctx.items, cid).iter().any(|a| a == id)
        })
        .map(|(cid, c)| (cid.clone(), rank_of(ctx.items, cid, c)))
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    out
}

/// A group's union outline (Frame and group: union outline, #160): each descendant's outline
/// ringed `width` + `offset` out in the role, drawn under the children so only the ring outside
/// their union shows; and, after the children, each slit child's own ring and the child again
/// over it, so its line shows inside the union.
fn union_outline(
    ctx: &ItemCtx<'_>,
    id: &str,
    params: &Map<String, Value>,
    path: &str,
) -> Result<(Vec<Mark>, Vec<Mark>), Refused> {
    let opath = format!("{path}/params/outline");
    let Some(o) = params.get("outline").and_then(Value::as_object) else {
        return refuse("bad_doc", opath);
    };
    if o.get("kind")
        .and_then(Value::as_str)
        .is_some_and(|k| k != "union")
    {
        return refuse("bad_doc", format!("{opath}/kind"));
    }
    let width = num(o.get("width")).unwrap_or(3.0);
    let offset = num(o.get("offset")).unwrap_or(0.0);
    if width < 0.0 || offset < 0.0 {
        return refuse("out_of_range", format!("{opath}/width"));
    }
    let color = role(ctx.palette, o.get("role"), &format!("{opath}/role"))?;
    let slits: Vec<&str> = o
        .get("slits")
        .and_then(Value::as_array)
        .map(|l| l.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let layer = ctx.items.get(id).and_then(|i| i.get("layer"));
    let mut under = Vec::new();
    let mut after = Vec::new();
    for (cid, _) in children_in_order(ctx, id) {
        let child = &ctx.items[&cid];
        // An outline never crosses writer layers.
        if child.get("layer") != layer {
            return refuse("outline_writer", format!("{opath}: {cid}"));
        }
        let Some(verbs) = item_outline(ctx.items, &cid) else {
            continue;
        };
        under.push(ring_mark(
            ctx,
            format!("{id}#outline"),
            &cid,
            verbs.clone(),
            color,
            width + offset,
        )?);
        if slits.contains(&cid.as_str()) {
            after.push(ring_mark(
                ctx,
                format!("{id}#slit.{cid}"),
                &cid,
                verbs,
                color,
                width,
            )?);
            if let Some(own) = placed(ctx, &cid, child)? {
                after.extend(own.drawn.iter().map(|d| d.mark.clone()));
            }
        }
    }
    Ok((under, after))
}

/// The joined per-point columns of a group with a union outline (#160): its children's rows in
/// draw order, each child's points in path order, for every column any child has; a child that
/// lacks one takes the column's default (an opacity of 1, a width of its stroke's), or 0 under
/// the planted `merge_zero_fills`.
fn joined_columns(ctx: &ItemCtx<'_>, id: &str) -> Result<BTreeMap<String, Vec<f64>>, Refused> {
    let children = children_in_order(ctx, id);
    let mut out: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for name in ["width", "opacity"] {
        let any = children.iter().any(|(cid, _)| {
            ctx.items[cid]
                .get("params")
                .and_then(|p| p.get(name))
                .is_some_and(|v| !v.is_null())
        });
        if !any {
            continue;
        }
        let mut rows = Vec::new();
        for (cid, _) in &children {
            let child = &ctx.items[cid];
            let params = object_or_empty(child.get("params"));
            let Some(verbs) = base_verbs(
                child.get("kind").and_then(Value::as_str).unwrap_or(""),
                params,
            ) else {
                continue;
            };
            let n = anchors_of(&verbs).len();
            match column_values(cid, params, name, n)? {
                Some(v) => rows.extend(v),
                None => {
                    let default = match (ctx.planted, name) {
                        (Planted::MergeZeroFills, _) => 0.0,
                        (_, "width") => params
                            .get("paint")
                            .and_then(|p| p.get("stroke"))
                            .and_then(|s| num(s.get("width")))
                            .unwrap_or(1.0),
                        _ => 1.0,
                    };
                    rows.extend(std::iter::repeat_n(default, n));
                }
            }
        }
        out.insert(name.to_string(), rows);
    }
    Ok(out)
}

/// What the `path` surface reports of an item (#160): a path-like item built through its ops,
/// or a group with a union outline as its children's outlines in draw order.
#[derive(Clone, Debug)]
pub struct PathReport {
    /// Each copy's sub-paths where they draw.
    pub placed: Vec<Vec<Verb>>,
    pub built: Option<PathBuilt>,
    /// Each copy's repeater transform, opacity and lag, copy 0 first, for a repeater's item.
    pub copies: Option<Vec<(pathops::Affine, f64, usize)>>,
    /// Each head where it draws.
    pub ends: Vec<ends::Built>,
    pub columns: BTreeMap<String, Vec<f64>>,
    pub segments: u64,
    pub declared: u64,
    pub digest: ContentKey,
}

/// [`PathReport`] of `id` among evaluated `items`, placed as a frame places them (boxes from a
/// first pass, so attachments resolve).
pub fn path_report(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    id: &str,
    planted: Planted,
) -> Result<Option<PathReport>, Refused> {
    let bound = BTreeMap::new();
    let row_readings = BTreeMap::new();
    // Only an attachment reads other items' boxes, which take a first pass over the frame.
    let attaches = items
        .get(id)
        .and_then(|i| i.get("params"))
        .and_then(|p| p.get("attach"))
        .is_some_and(|a| !a.is_null());
    let boxes = if attaches {
        let (frame, _, _) = build(
            doc,
            (items, &[]),
            (palette, ty),
            (&bound, &row_readings),
            1.0,
            planted,
            None,
        )?;
        Some(boxes_of(&frame, items))
    } else {
        None
    };
    let scopes = scopes_of(doc, items, palette, &BTreeMap::new())?;
    let paints = Paints {
        doc,
        items,
        palette,
        boxes: boxes.as_ref(),
        wants_boxes: Cell::new(false),
    };
    let ctx = ItemCtx {
        items,
        size: pair(doc.get("size")).unwrap_or_default(),
        palette,
        ty,
        paints: &paints,
        scopes: &scopes,
        bound: &bound,
        row_readings: &row_readings,
        planted,
    };
    let Some(item) = items.get(id) else {
        return Ok(None);
    };
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let params = object_or_empty(item.get("params"));
    if kind == "group@1" && params.get("outline").is_some_and(|o| !o.is_null()) {
        let placed: Vec<Vec<Verb>> = children_in_order(&ctx, id)
            .iter()
            .filter_map(|(cid, _)| item_outline(items, cid))
            .collect();
        let segments = placed.iter().map(|v| pathops::segments(v)).sum();
        let mut k = KeyBuilder::new("tessellate@marks2d.160");
        for v in placed.iter().flatten() {
            for p in verb_points(v) {
                k.number(p[0]).number(p[1]);
            }
        }
        return Ok(Some(PathReport {
            placed,
            built: None,
            copies: None,
            ends: Vec::new(),
            columns: joined_columns(&ctx, id)?,
            segments,
            declared: segments,
            digest: k.finish(),
        }));
    }
    let Some(verbs) = base_verbs(kind, params) else {
        return Ok(None);
    };
    let path = format!("items/{id}");
    let verbs = if kind == "path@1" {
        attached(&ctx, verbs, params, &path)?
    } else {
        verbs
    };
    let place = Place::of(item);
    let paint = object_or_empty(params.get("paint"));
    let built = build_path(&ctx, id, verbs, params, paint, place)?;
    let has_repeater = pathops::read(params.get("ops"), "")
        .map(|ops| ops.iter().any(|o| matches!(o, pathops::Op::Repeater(_))))
        .unwrap_or(false);
    let copies = has_repeater.then(|| {
        built
            .copies
            .iter()
            .map(|c| (c.transform, c.opacity, c.copy.map_or(0, |(k, _)| k)))
            .collect()
    });
    let ends = built
        .ends
        .iter()
        .map(|(_, h)| ends::Built {
            verbs: place.verbs(h.verbs.clone()),
            tip: place.at(h.tip),
            ..h.clone()
        })
        .collect();
    let mut columns = BTreeMap::new();
    if !built.widths.is_empty() {
        columns.insert(
            "width".to_string(),
            built.widths.iter().map(|(_, w)| *w).collect(),
        );
    }
    if !built.alphas.is_empty() {
        columns.insert(
            "opacity".to_string(),
            built.alphas.iter().map(|(_, a)| *a).collect(),
        );
    }
    Ok(Some(PathReport {
        placed: built.placed.clone(),
        copies,
        ends,
        columns,
        segments: built.segments,
        declared: built.declared,
        digest: built.digest,
        built: Some(built),
    }))
}

/// The segments the ops of `id` declare, for a refusal that names the count.
pub fn declared_of(items: &Map<String, Value>, id: &str) -> Option<u64> {
    let item = items.get(id)?;
    let params = object_or_empty(item.get("params"));
    let verbs = base_verbs(item.get("kind").and_then(Value::as_str)?, params)?;
    let ops = pathops::read(params.get("ops"), "").ok()?;
    Some(pathops::declared(&ops, &verbs).0)
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
            Mark::Rect { bounds, .. } => *bounds,
            Mark::Image { bounds, turn, .. } => crate::turn::turned_box(*bounds, *turn),
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
    text_boxes(frame, items, &mut out);
    out
}

/// #1966: each text's box where its shaped run draws, and each of its read-only anchors a path
/// attaches to (`<id>#line:n`, `<id>#tok:k`), the line's or token's box. A text's box joins no
/// parent's, as before.
fn text_boxes(frame: &Frame, items: &Map<String, Value>, out: &mut BTreeMap<String, [f64; 4]>) {
    let mut parts: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for item in items.values() {
        let attach = item.get("params").and_then(|p| p.get("attach"));
        for end in ["start", "end"] {
            let target = attach.and_then(|a| a.get(end)).and_then(Value::as_str);
            if let Some((id, part)) = target.and_then(|t| t.split_once('#')) {
                parts.entry(id).or_default().push(part);
            }
        }
    }
    for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
        let Mark::Text {
            item, spec, origin, ..
        } = &drawn.mark
        else {
            continue;
        };
        if item.contains('#') {
            continue;
        }
        let Some(shaped) = shaped_text(spec) else {
            continue;
        };
        let w = f64::from(shaped.width);
        let at = match (spec.align, spec.width) {
            (Align::Center, Some(box_w)) => (box_w - w) / 2.0,
            (Align::End, Some(box_w)) => box_w - w,
            _ => 0.0,
        };
        out.insert(
            item.clone(),
            [origin[0] + at, origin[1], w, f64::from(shaped.height)],
        );
        let params = object_or_empty(items.get(item).and_then(|i| i.get("params")));
        for part in parts.get(item.as_str()).into_iter().flatten() {
            if let Some(b) = crate::lines::anchor_box(params, &shaped, part) {
                let placed = [origin[0] + b[0], origin[1] + b[1], b[2], b[3]];
                out.insert(format!("{item}#{part}"), placed);
            }
        }
    }
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
    /// #496: whole seconds as hours, minutes and seconds, each at least two digits, as a
    /// countdown shows them: 8104 is 02:15:04.
    Clock,
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
    /// `unit_at: super`: the unit at the number's top, as a degree sign sits.
    pub unit_raised: bool,
    /// `ellipsis`: an ellipsis after the number, which never shortens it.
    pub ellipsis: bool,
    /// The view's locale's group separator and decimal mark (`group: locale`).
    pub marks: Marks,
}

/// A unit set at the number's top, in the superscript letters a text run's font holds; one with
/// none, such as a degree sign, already sits there.
fn raised(unit: &str) -> String {
    const PLAIN: &str = "0123456789+-=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW";
    const RAISED: &str = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ";
    unit.chars()
        .map(|c| match PLAIN.chars().position(|p| p == c) {
            Some(i) => RAISED.chars().nth(i).unwrap_or(c),
            None => c,
        })
        .collect()
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
            Some("clock") => Notation::Clock,
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
        f.unit_raised = match map.get("unit_at").and_then(Value::as_str) {
            None | Some("after") => false,
            Some("super") => true,
            Some(_) => return refuse("bad_format", format!("{path}/format/unit_at")),
        };
        f.ellipsis = match map.get("ellipsis") {
            None => false,
            Some(Value::Bool(b)) => *b,
            Some(_) => return refuse("bad_format", format!("{path}/format/ellipsis")),
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
            Notation::Clock => {
                let s = n.abs().floor() as u64;
                (
                    format!("{:02}:{:02}:{:02}", s / 3600, s / 60 % 60, s % 60),
                    String::new(),
                )
            }
        };
        let sign = if n < 0.0 && body.chars().any(|c| c.is_ascii_digit() && c != '0') {
            "−"
        } else if self.sign_always && n >= 0.0 {
            "+"
        } else {
            ""
        };
        let unit = match (&self.unit, self.notation) {
            (_, Notation::Percent | Notation::Duration | Notation::Clock) => String::new(),
            (Some(u), _) if self.unit_raised => raised(u),
            (Some(u), _) if u == "%" || u == "°" => u.clone(),
            (Some(u), _) => format!(" {u}"),
            (None, _) => String::new(),
        };
        let more = if self.ellipsis { "…" } else { "" };
        format!("{sign}{body}{suffix}{unit}{more}")
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
/// to, the host time live and the mapped record time in a replay, on the record's clock. A
/// reading printed with a known number of decimals, such as a run's assertion value, carries
/// them in `precision`, and no format shows more.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Record {
    pub readings: BTreeMap<String, f64>,
    pub as_of: BTreeMap<String, i64>,
    pub precision: BTreeMap<String, u32>,
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
    let text = match record.precision.get(source) {
        Some(&p) => Format {
            precision: Some(format.precision.map_or(p, |f| f.min(p))),
            ..format.clone()
        }
        .show(value),
        None => format.show(value),
    };
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
/// primitives: Text animator and counter). Numbers are written as the document's `locale` writes
/// them (`en` without one), never the process's (#140).
pub fn bound_texts(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    record: &Record,
) -> Result<BTreeMap<String, Shown>, Refused> {
    let mut out = BTreeMap::new();
    let locale = doc.get("locale").and_then(Value::as_str).unwrap_or("en");
    for id in bound_ids(doc, items)? {
        let item = items.get(&id).unwrap_or(&Value::Null);
        if let Some(shown) = text_at(doc, items, &id, item, record, locale)? {
            out.insert(id, shown);
        }
    }
    Ok(out)
}

/// A number and the decimals its source carries, `None` where it holds none at t.
type Evaluated = Option<(f64, Option<u32>)>;

/// A number an anchor or a driver gives a counter or a template, and the decimals its source
/// carries: `items/<set>#period/by`, `items/<set>#head/<column>`, or a driver's evaluated target.
/// `None` where it holds none at t, such as a head before the first row.
fn evaluated_number(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    item: &Value,
    source: &str,
) -> Result<Evaluated, Refused> {
    if let Some(found) = anchor_of(items, source)? {
        return Ok(found);
    }
    // #496: a data value by its path, as the frame evaluated it on the item, else as written.
    if let Some(name) = source.strip_prefix("data/") {
        let value = item.pointer(&format!("/params/data/{name}")).or_else(|| {
            doc.get("data")?
                .get(name)
                .map(|d| d.get("value").unwrap_or(d))
        });
        return Ok(value.and_then(Value::as_f64).map(|v| (v, None)));
    }
    let target = doc
        .get("drivers")
        .and_then(|d| d.get(source))
        .and_then(|d| d.get("target"))
        .and_then(Value::as_str);
    let Some(target) = target else {
        return refuse("ref_unresolved", source);
    };
    let value = match target.split_once('/') {
        Some(("data", name)) => item.pointer(&format!("/params/data/{name}")).or_else(|| {
            doc.get("data")?
                .get(name)
                .map(|d| d.get("value").unwrap_or(d))
        }),
        Some(("items", rest)) => {
            let (id, field) = rest.split_once('/').unwrap_or((rest, ""));
            items.get(id).and_then(|i| i.pointer(&format!("/{field}")))
        }
        _ => None,
    };
    Ok(value.and_then(Value::as_f64).map(|v| (v, None)))
}

/// The value at an anchor path, or `None` for a path that names no anchor.
fn anchor_of(items: &Map<String, Value>, path: &str) -> Result<Option<Evaluated>, Refused> {
    let Some((set, anchor, field)) = path
        .strip_prefix("items/")
        .and_then(|p| p.split_once('#'))
        .and_then(|(set, rest)| Some((set, rest.split_once('/')?)))
        .map(|(set, (anchor, field))| (set, anchor, field))
    else {
        return Ok(None);
    };
    let Some(item) = items.get(set) else {
        return refuse("ref_unresolved", path);
    };
    let rows = data::rows(set, item, items, &data::BoundRows::new())?;
    Ok(Some(rows.anchor(anchor, field)))
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
        if counter_of(item).is_some() || template_of(item).is_some() || copy_key(item).is_some() {
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

/// Whether a text shows a mark set's anchor, which only a frame with the set's rows can read: a
/// counter or a template's slot on `items/<set>#…`.
pub fn reads_anchor(item: &Value) -> bool {
    let anchor = |s: &str| s.starts_with("items/") && s.contains('#');
    let counter = item.pointer("/params/text/counter/source");
    counter.and_then(Value::as_str).is_some_and(anchor)
        || template_of(item).is_some_and(|t| {
            let parts = template::parts(t).unwrap_or_default();
            parts
                .iter()
                .any(|p| matches!(p, template::Part::Slot(s) if anchor(s)))
        })
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
    let items = object_or_empty(doc.get("items"));
    text_at(doc, items, id, item, record, locale)
}

/// What a [`Shown`] from localized copy is bound to.
const COPY: &str = "copy";

/// #407: a text@1's copy key (`copy: key`, into `data.copy[locale]`), when it shows localized
/// copy in place of its own text.
pub fn copy_key(item: &Value) -> Option<&str> {
    let p = item.get("params")?;
    p.get("text").is_none().then_some(())?;
    p.get("copy")?.as_str()
}

/// [`bound_text`] among a frame's evaluated `items`, which anchors and drivers read.
pub fn text_at(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    id: &str,
    item: &Value,
    record: &Record,
    locale: &str,
) -> Result<Option<Shown>, Refused> {
    // #407: localized copy: the key's string in the locale's table, else the document's own
    // locale's, else nothing.
    if let Some(key) = copy_key(item) {
        let in_locale = |l: &str| doc.get("data")?.get("copy")?.get(l)?.get(key)?.as_str();
        let text = in_locale(locale)
            .or_else(|| {
                doc.get("locale")
                    .and_then(Value::as_str)
                    .and_then(in_locale)
            })
            .unwrap_or_default()
            .to_string();
        return Ok(Some(Shown {
            bound: COPY.into(),
            text,
            stale: false,
            age: None,
            changes_at: None,
        }));
    }
    if let Some(template) = template_of(item) {
        // A template shows each slot's value at its own precision (Text `text@1`, `template`).
        // A keyed data value shows as the frame evaluated it (`params/data/<name>`, motion@1).
        // A slot's value is read from `data` alone (`template::value`), so only it is copied,
        // never the whole document.
        let mut data = doc.get("data").cloned();
        if let Some(values) = item.pointer("/params/data").and_then(Value::as_object) {
            for (name, x) in values {
                let entry = data
                    .get_or_insert_with(|| json!({}))
                    .as_object_mut()
                    .and_then(|d| d.get_mut(name));
                match entry {
                    Some(Value::Object(e)) => {
                        e.insert("value".into(), x.clone());
                    }
                    Some(e) => *e = x.clone(),
                    None => {}
                }
            }
        }
        let path = format!("items/{id}/params/template");
        let mut text = String::new();
        let mut at_t = Value::Object(data.map(|d| ("data".to_string(), d)).into_iter().collect());
        // #504: a control's value and an assembly's as the frame evaluated them, over the
        // document's own (a control's default before any entry).
        for section in ["controls", "assemblies"] {
            let mut entries = doc.get(section).cloned().unwrap_or_else(|| json!({}));
            if let Some(shown) = item
                .pointer(&format!("/params/shown/{section}"))
                .and_then(Value::as_object)
            {
                for (k, v) in shown {
                    if let Some(Value::Object(e)) = entries.get_mut(k) {
                        e.insert("value".into(), v["value"].clone());
                    }
                }
            }
            at_t[section] = entries;
        }
        for part in template::parts(template).or_else(|_| refuse("ref_unresolved", path.clone()))? {
            match part {
                template::Part::Words(w) => text.push_str(w),
                template::Part::Slot(slot) => match anchor_of(items, slot)? {
                    Some(Some((v, p))) => text.push_str(&story::number(v, p)),
                    Some(None) => text.push('—'),
                    None => match template::value(&at_t, slot) {
                        Some(shown) => text.push_str(&shown.text),
                        None => return refuse("ref_unresolved", path),
                    },
                },
            }
        }
        return Ok(Some(Shown {
            bound: "template".into(),
            text,
            stale: false,
            age: None,
            changes_at: None,
        }));
    }
    let bound = object_or_empty(doc.get("bound_values"));
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
        let named = counter.get("source").and_then(Value::as_str);
        let Some(named) = named else {
            return refuse("ref_unresolved", format!("{path}/source"));
        };
        let Some(b) = bound.get(named) else {
            let mut format = Format::read(counter.get("format"), None, &path)?;
            format.marks = Marks::of(locale);
            let found = evaluated_number(doc, items, item, named).map_err(|r| Refused {
                code: r.code,
                path: format!("{path}/source"),
            })?;
            if let (Some((_, Some(p))), None) = (found, format.precision) {
                format.precision = Some(p);
            }
            if let Some((_, Some(p))) = found {
                format.precision = format.precision.map(|f| f.min(p));
            }
            return Ok(Some(Shown {
                bound: named.to_string(),
                text: format.show(found.map(|(v, _)| v)),
                stale: false,
                age: None,
                changes_at: None,
            }));
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
        // An item another canvas module draws, such as a solid in depth, takes its status from
        // that module (scene3d outlines it), never from a 2D status mark (#1162).
        let written = doc
            .get("items")
            .and_then(|i| i.get(id))
            .and_then(|i| i.get("kind"))
            .and_then(Value::as_str);
        if written.is_some_and(|k| !KINDS.contains(&k)) {
            continue;
        }
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

/// A mark in its layer's draw order: its item's rank (#160: z, then the tree by band, order key
/// and ID), its row, its item's ID.
type Ordered<'a> = (Rank, usize, &'a str, &'a Arc<Drawn>, ContentKey);

/// The most masks that may clip one item (Mask: "nest deeper than 4" it can never).
const MASK_DEPTH: usize = 4;

/// A mask's scope over the items it applies to: a scissor for a shape mask, coverage from its own
/// paint for an alpha or luminance one, and for a feathered one its rect's coverage ramped over the
/// feather (#385); a path ID's shape clips by that path's outline where it draws (#1175: an SVG's
/// `<clipPath>`). A rounded rect, a soft path, a shape naming no path, inverted and combined
/// masks wait.
fn mask_scope(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Scope, Refused> {
    let path = format!("items/{id}/params");
    let p = object_or_empty(item.get("params"));
    match p.get("shape").and_then(Value::as_str).unwrap_or("rect") {
        "rect" => {}
        "rounded rect" => return refuse("mask_r2", format!("{path}/shape")),
        shape => {
            let plain = p.get("mode").is_none_or(|m| m == "shape")
                && ["feather", "expand"]
                    .iter()
                    .all(|k| num(p.get(*k)).unwrap_or(0.0) == 0.0)
                && p.get("invert").is_none_or(|v| v == &Value::Bool(false))
                && p.get("combine").is_none_or(|c| c == "add");
            if !plain {
                return refuse("mask_r2", path);
            }
            let is_path = items.get(shape).and_then(|i| i.get("kind")) == Some(&json!("path@1"));
            let Some(verbs) = item_outline(items, shape).filter(|_| is_path) else {
                return refuse("mask_r2", format!("{path}/shape"));
            };
            return Ok(Scope::Shape {
                item: id.to_string(),
                verbs: Arc::new(verbs),
            });
        }
    }
    let feather = num(p.get("feather")).unwrap_or(0.0);
    if feather < 0.0 {
        return refuse("bad_doc", format!("{path}/feather"));
    }
    let soft = p.get("invert") == Some(&Value::Bool(true))
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
        None | Some("shape") if feather > 0.0 => {
            return Ok(Scope::Mask {
                item: id.to_string(),
                rect,
                luminance: false,
                fill: Fill::Solid([255, 255, 255]),
                feather,
            })
        }
        None | Some("shape") => {
            return Ok(Scope::Clip {
                item: id.to_string(),
                rect,
                radius: 0.0,
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
        feather,
    })
}

/// The scope an ancestor puts its children in: a mask's, a frame's overflow scissor, or a group's
/// opacity (one offscreen pass, which GPUI's per-primitive opacity can't do).
fn ancestor_scope(
    id: &str,
    item: &Value,
    items: &Map<String, Value>,
    palette: &Palette,
) -> Result<Option<Scope>, Refused> {
    let p = item.get("params");
    let get = |k: &str| p.and_then(|p| p.get(k));
    Ok(match item.get("kind").and_then(Value::as_str) {
        Some("mask@1") => match get("applies_to").and_then(Value::as_str) {
            None | Some("children") => Some(mask_scope(id, item, items, palette)?),
            Some(_) => None,
        },
        Some("frame@1") if get("overflow").and_then(Value::as_str) != Some("show") => {
            Some(Scope::Clip {
                item: id.to_string(),
                rect: Place::of(item).rect(frame_box(id, item)?),
                radius: num(get("radius")).unwrap_or(0.0).max(0.0),
            })
        }
        Some("group@1") => {
            let alpha = num(get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0);
            let blend = Blend::read(id, get("blend"))?;
            let effect = Effect::read(id, p, blend, items)?;
            let isolated =
                get("isolate") == Some(&Value::Bool(true)) || blend.is_some() || effect.is_some();
            (alpha < 1.0 || isolated).then(|| Scope::Opacity {
                item: id.to_string(),
                alpha,
                blend,
                effect: effect.map(Arc::new),
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

/// Whether `id` is `root` or has it among its ancestors.
fn is_under(items: &Map<String, Value>, id: &str, root: &str) -> bool {
    let mut at = Some(id);
    for _ in 0..=items.len() {
        match at {
            Some(a) if a == root => return true,
            Some(a) => {
                at = items
                    .get(a)
                    .and_then(|i| i.get("parent"))
                    .and_then(Value::as_str)
            }
            None => return false,
        }
    }
    false
}

/// Each item's scopes, outermost first: its ancestors' (a mask's children are the items whose
/// `parent` it is, at any depth), then the masks whose collection holds it. A mask never reaches
/// another writer's items, and a fifth mask over one item is refused, naming that mask.
fn scopes_of(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    palette: &Palette,
    mattes: &BTreeMap<String, Arc<Vec<Drawn>>>,
) -> Result<BTreeMap<String, Vec<Scope>>, Refused> {
    // #504: a parent that names an assembly ends the chain of item scopes; the motion module
    // composes the assembly's transform.
    let assembly = |id: &str| doc.get("assemblies").and_then(|a| a.get(id)).is_some();
    let parent = |id: &str| {
        items
            .get(id)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .filter(|p| !assembly(p))
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
        mask_scope(id, item, items, palette)?;
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
    // Each matte with what it applies to: an item and everything under it, or a collection.
    let mut matte_of: Vec<(&str, Scope, Option<BTreeSet<String>>, &str)> = Vec::new();
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("matte@1") || !shown(id) {
            continue;
        }
        let p = object_or_empty(item.get("params"));
        let mode = MatteMode::read(id, p.get("mode"))?;
        let encoded = match p.get("luma").and_then(Value::as_str) {
            None | Some("linear") => false,
            Some("encoded") => true,
            Some(_) => return refuse("bad_doc", format!("items/{id}/params/luma")),
        };
        if p.get("resolution")
            .and_then(Value::as_str)
            .is_some_and(|r| r != "full")
        {
            return refuse("module_missing", format!("items/{id}/params/resolution"));
        }
        let Some(Value::String(target)) = p.get("applies_to") else {
            return refuse("bad_doc", format!("items/{id}/params/applies_to"));
        };
        let members = match items.get(target) {
            Some(_) => None,
            None => {
                let Some(Value::Array(m)) = doc
                    .get("collections")
                    .and_then(|c| c.get(target))
                    .and_then(|c| c.get("members"))
                else {
                    return refuse("ref_unresolved", format!("items/{id}/params/applies_to"));
                };
                Some(
                    m.iter()
                        .filter_map(|v| v.as_str().map(str::to_string))
                        .collect(),
                )
            }
        };
        let source = mattes.get(id).cloned().unwrap_or_default();
        matte_of.push((
            id,
            Scope::Matte {
                item: id.clone(),
                source,
                mode,
                encoded,
            },
            members,
            target,
        ));
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
                ancestor_scope(a, ancestor, items, palette)?
            } else {
                Some(mask_scope(a, ancestor, items, palette)?)
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
        for (_, scope, members, target) in &matte_of {
            let under = match members {
                Some(m) => m.contains(id),
                None => id == target || chain.iter().any(|a| a == target),
            };
            if under {
                scopes.push(scope.clone());
            }
        }
        out.insert(id.clone(), scopes);
    }
    Ok(out)
}

/// A fill drawn as one outline: its verbs where it draws, with nothing else (no stroke, no soft
/// paint below opacity 1) that a coverage target would change.
fn fill_outline(mark: &Mark) -> Option<Vec<Verb>> {
    let moved = |verbs: &[Verb], by: [f64; 2]| -> Vec<Verb> {
        let m = |p: [f64; 2]| [p[0] + by[0], p[1] + by[1]];
        verbs
            .iter()
            .map(|v| match *v {
                Verb::Move(p) => Verb::Move(m(p)),
                Verb::Line(p) => Verb::Line(m(p)),
                Verb::Quad(a, b) => Verb::Quad(m(a), m(b)),
                Verb::Cubic(a, b, c) => Verb::Cubic(m(a), m(b), m(c)),
                Verb::Close => Verb::Close,
            })
            .collect()
    };
    match mark {
        Mark::Path {
            geometry, offset, ..
        } if geometry.fill && geometry.stroke.is_none() => Some(moved(&geometry.verbs, *offset)),
        Mark::Shape {
            verbs,
            fill: Some((_, opacity)),
            stroke: None,
            ..
        } if *opacity == 1.0 => Some(verbs.clone()),
        _ => None,
    }
}

/// Each edge of an outline (a line, or a curve with its control points) as its points rounded to
/// 1/1024 u, read the same way whichever way it runs.
fn edge_keys(verbs: &[Verb]) -> Vec<Vec<[i64; 2]>> {
    let q = |p: [f64; 2]| {
        [
            (p[0] * 1024.0).round() as i64,
            (p[1] * 1024.0).round() as i64,
        ]
    };
    let (mut start, mut at) = ([0.0; 2], [0.0; 2]);
    let mut out = Vec::new();
    let mut push = |points: Vec<[f64; 2]>| {
        let fwd: Vec<[i64; 2]> = points.iter().map(|p| q(*p)).collect();
        let back: Vec<[i64; 2]> = fwd.iter().rev().copied().collect();
        if fwd.first() != fwd.last() {
            out.push(fwd.min(back));
        }
    };
    for v in verbs {
        match *v {
            Verb::Move(p) => (start, at) = (p, p),
            Verb::Close => {
                push(vec![at, start]);
                at = start;
            }
            _ => {
                let mut points = vec![at];
                points.extend(verb_points(v));
                at = *points.last().expect("a drawing verb has a point");
                push(points);
            }
        }
    }
    out
}

/// No conflation seams (Decided, The 2D renderer): a group's fills that share an edge draw through
/// one coverage target, the union of their outlines, each group of fills joined by shared edges
/// its own target.
fn cover(built: &mut [(&str, Placed)], items: &Map<String, Value>) {
    /// A fill of a group: its built item, its mark, and its outline.
    type Member = (usize, usize, Vec<Verb>);
    let mut groups: BTreeMap<&str, Vec<Member>> = BTreeMap::new();
    for (i, (id, placed)) in built.iter().enumerate() {
        let Some(parent) = items
            .get(*id)
            .and_then(|it| it.get("parent"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        if items
            .get(parent)
            .and_then(|p| p.get("kind"))
            .and_then(Value::as_str)
            != Some("group@1")
        {
            continue;
        }
        for (k, drawn) in placed.drawn.iter().enumerate() {
            if let Some(verbs) = fill_outline(&drawn.mark) {
                groups
                    .entry(items.get_key_value(parent).expect("found above").0)
                    .or_default()
                    .push((i, k, verbs));
            }
        }
    }
    for (group, fills) in groups {
        // Fills joined by a shared edge, as sets of one root.
        let mut root: Vec<usize> = (0..fills.len()).collect();
        fn find(root: &mut [usize], i: usize) -> usize {
            let mut r = i;
            while root[r] != r {
                r = root[r];
            }
            root[i] = r;
            r
        }
        let mut seen: BTreeMap<Vec<[i64; 2]>, usize> = BTreeMap::new();
        for (f, (.., verbs)) in fills.iter().enumerate() {
            for e in edge_keys(verbs) {
                match seen.get(&e) {
                    Some(&g) => {
                        let (a, b) = (find(&mut root, g), find(&mut root, f));
                        root[a] = b;
                    }
                    None => {
                        seen.insert(e, f);
                    }
                }
            }
        }
        let mut sets: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
        for f in 0..fills.len() {
            let r = find(&mut root, f);
            sets.entry(r).or_default().push(f);
        }
        for (n, members) in sets.values().filter(|m| m.len() > 1).enumerate() {
            let verbs: Vec<Verb> = members.iter().flat_map(|&f| fills[f].2.clone()).collect();
            let scope = Scope::Cover {
                item: format!("{group}#cover{n}"),
                verbs: Arc::new(verbs),
            };
            for &f in members {
                let (i, k, _) = fills[f];
                let placed = &mut built[i].1;
                let mut drawn = (*placed.drawn[k]).clone();
                drawn.scopes.push(scope.clone());
                placed.drawn[k] = Arc::new(drawn);
                placed.keys.clear();
            }
        }
    }
}

thread_local! {
    /// The shaper auto layout measures text leaves with (#375).
    static LAYOUT_SHAPER: RefCell<deep_text::Shaper> = RefCell::new(deep_text::Shaper::new());
}

/// `items` with their frames' auto layout applied (#375): each frame that lays out, and each item
/// one lays out, moved to its solved box, and a frame or a boxed mark sized to it. A text keeps its
/// own box, which the layout measured it by.
pub(crate) fn laid_out<'a>(
    doc: &Map<String, Value>,
    items: &'a Map<String, Value>,
) -> Result<Cow<'a, Map<String, Value>>, Refused> {
    let lays_out = |id: &str| {
        items.get(id).is_some_and(|i| {
            i.get("kind").and_then(Value::as_str) == Some("frame@1")
                && i.get("params")
                    .and_then(|p| p.get("layout"))
                    .is_some_and(|l| l.as_str() != Some("none"))
        })
    };
    if !items.keys().any(|id| lays_out(id)) {
        return Ok(Cow::Borrowed(items));
    }
    let input = json!({"items": items, "bound_values": doc.get("bound_values")});
    let boxes = LAYOUT_SHAPER
        .with(|s| crate::layout::solve(&input, &mut s.borrow_mut()))
        .map_err(|r| Refused {
            code: r.code,
            path: format!("items/{}", r.item),
        })?;
    let mut out = items.clone();
    let mut moved: BTreeMap<String, [f64; 2]> = BTreeMap::new();
    for (id, [x, y, w, h]) in boxes {
        let parent = items
            .get(&id)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str);
        let Some(item) = out.get_mut(&id).and_then(Value::as_object_mut) else {
            continue;
        };
        if !lays_out(&id) && !parent.is_some_and(lays_out) {
            continue;
        }
        let at = item.entry("at").or_insert_with(|| json!({}));
        let pos = at.get("pos");
        let was = [0, 1].map(|i| num(pos.and_then(|p| p.get(i))).unwrap_or(0.0));
        let z = num(pos.and_then(|p| p.get(2))).unwrap_or(0.0);
        at["pos"] = json!([x, y, z]);
        moved.insert(id.clone(), [x - was[0], y - was[1]]);
        if item.get("kind").and_then(Value::as_str) != Some("text@1") {
            let params = item.entry("params").or_insert_with(|| json!({}));
            params["box"] = json!([0.0, 0.0, w, h]);
        }
    }
    // What hangs from a laid-out item and isn't laid out itself moves with it (#1162): a chart's
    // marks ride the chart where the row put it, by its nearest laid-out ancestor's move.
    let parent_of = |id: &str| items.get(id)?.get("parent")?.as_str();
    for (id, item) in out.iter_mut() {
        if moved.contains_key(id) {
            continue;
        }
        let mut up = parent_of(id);
        let by = loop {
            match up {
                None => break None,
                Some(p) if moved.contains_key(p) => break moved.get(p).copied(),
                Some(p) => up = parent_of(p),
            }
        };
        let (Some([dx, dy]), Some(item)) = (by, item.as_object_mut()) else {
            continue;
        };
        let at = item.entry("at").or_insert_with(|| json!({}));
        let pos = at.get("pos");
        let p = [0, 1, 2].map(|i| num(pos.and_then(|p| p.get(i))).unwrap_or(0.0));
        at["pos"] = json!([p[0] + dx, p[1] + dy, p[2]]);
    }
    Ok(Cow::Owned(out))
}

/// A module's item the core lowers to a group (a kind that registered nothing to draw as, such
/// as `vector@1`) keeps its kind and params as the document writes them, so its own box (a
/// vector's `size`) is read from them (#1162).
pub fn as_written(doc: &Map<String, Value>, items: &mut Map<String, Value>) {
    let written = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.iter_mut() {
        if item.get("kind").and_then(Value::as_str) != Some("group@1") {
            continue;
        }
        let Some(w) = written.and_then(|w| w.get(id)) else {
            continue;
        };
        if w.get("kind") == item.get("kind") {
            continue;
        }
        if let Some(map) = item.as_object_mut() {
            for k in ["kind", "params"] {
                if let Some(v) = w.get(k) {
                    map.insert(k.into(), v.clone());
                }
            }
        }
    }
}

/// Each item's evaluated box in document units, `[x, y, w, h]` (#1162): `items` as evaluated at
/// t, each at its world transform with its relation's place applied, its frames laid out (#375),
/// for every item whose kind has a box of its own (`relations::own_box`).
pub fn item_boxes(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
) -> Result<BTreeMap<String, [f64; 4]>, Refused> {
    let mut items = items.clone();
    as_written(doc, &mut items);
    let items = laid_out(doc, &items)?;
    let mut out = BTreeMap::new();
    for (id, item) in items.iter() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        let Some(local) = crate::relations::own_box(kind, object_or_empty(item.get("params")))
        else {
            continue;
        };
        let place = crate::relations::place_of(item, Some(local));
        out.insert(id.clone(), crate::relations::placed(local, place));
    }
    Ok(out)
}

/// Each item's box as its frames' auto layout solves it (#375), for an item it lays out; none when
/// no frame lays out (#399: a frame's drawn box where a graph node placed it).
pub fn laid_out_boxes(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
) -> Result<BTreeMap<String, [f64; 4]>, Refused> {
    let laid = laid_out(doc, items)?;
    let mut out = BTreeMap::new();
    if let Cow::Owned(laid) = laid {
        for (id, item) in &laid {
            let (Some(pos), Some(b)) = (
                item.pointer("/at/pos").and_then(Value::as_array),
                item.pointer("/params/box").and_then(Value::as_array),
            ) else {
                continue;
            };
            let n = |v: Option<&Value>| v.and_then(Value::as_f64).unwrap_or(0.0);
            out.insert(
                id.clone(),
                [n(pos.first()), n(pos.get(1)), n(b.get(2)), n(b.get(3))],
            );
        }
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
    /// #385 AC8's twin: a group's fills that share an edge draw each on its own, source-over.
    SectorsSourceOver,
    /// #160 AC5's twin: the named op's output moved 0.02 u along +x.
    Moved(&'static str),
    /// #160 AC8's twin: a union's join gives a missing column 0 instead of its default.
    MergeZeroFills,
    /// #160 AC17's twin: a repeater that evaluates every copy at t, ignoring its lag.
    RepeaterEvaluatesAtT,
    /// #399 AC6's twins: a series line that keeps only each column's first and last rows, or
    /// only its min and max.
    DecimateFirstLast,
    DecimateMinMax,
    /// #1653 AC4's twins: an isometric atlas grid laid out as a square one, and an atlas set
    /// drawn in row order rather than by centre.
    AtlasSquareLayout,
    AtlasRowOrder,
    /// #536's twins: a hex grid shifting the other parity; terrain reading a square grid's sides.
    HexOtherParity,
    TerrainSquareSides,
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
    frame_planted(
        doc,
        items,
        (palette, &Type::default()),
        record,
        zoom,
        Planted::None,
    )
}

/// [`frame`] in a look's palette and type (#417), with a planted wrong program.
pub fn frame_planted(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    record: &Record,
    zoom: f64,
    planted: Planted,
) -> Result<Frame, Refused> {
    // #467: parallax groups moved to their offset at the record's time, repeats laid out.
    let moved = crate::fields::apply(doc, items, record.pinned)?;
    let items = moved.as_ref().unwrap_or(items);
    // #1653: terrain drawn as its atlas set, and each animated atlas row at its frame.
    let tiled = crate::atlas::apply(doc, items, record.pinned)?;
    // #538: keyed copy at the record's time, in the document's locale.
    let copied = crate::copy::apply(doc, tiled.as_ref().unwrap_or(items), record.pinned, doc.get("locale").and_then(Value::as_str).unwrap_or("en"));
    let items = copied.as_ref().or(tiled.as_ref()).unwrap_or(items);
    let bound = bound_texts(doc, items, record)?;
    frame_shown(
        doc,
        items,
        (palette, ty),
        zoom,
        planted,
        &bound,
        &bound_rows(doc, record),
    )
}

/// The draw list for evaluated `items` in a look's palette and type (#239: text set in the look's
/// font roles), with what each bound value and counter shows already formatted (the text module's
/// counters, in the view's locale); `record` gives the readings bound to mark sets' rows.
pub fn frame_with(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    zoom: f64,
    bound: &BTreeMap<String, Shown>,
    record: &Record,
) -> Result<Frame, Refused> {
    let row_readings = bound_rows(doc, record);
    frame_shown(
        doc,
        items,
        (palette, ty),
        zoom,
        Planted::None,
        bound,
        &row_readings,
    )
}

fn frame_shown(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    zoom: f64,
    planted: Planted,
    bound: &BTreeMap<String, Shown>,
    row_readings: &BTreeMap<String, data::BoundRows>,
) -> Result<Frame, Refused> {
    let (frame, wants_boxes, _) = build(
        doc,
        (items, &[]),
        (palette, ty),
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
        (palette, ty),
        (bound, row_readings),
        zoom,
        planted,
        Some(&boxes),
    )?
    .0)
}

/// An item's `at.pos` in u, as written or as evaluated.
pub(crate) fn item_pos(item: &Value) -> [f64; 2] {
    pair(item.pointer("/at/pos")).unwrap_or([0.0, 0.0])
}

/// `items` with each one anchored to a mark set's `#head` moved there (Item and kind: `at.anchor`:
/// "with an anchor, pos offsets from that point"). A head with no row yet leaves it where it is.
fn anchored(items: Cow<'_, Map<String, Value>>) -> Result<Cow<'_, Map<String, Value>>, Refused> {
    let mut moves = Vec::new();
    for (id, item) in items.iter() {
        let anchor = item.pointer("/at/anchor").and_then(Value::as_str);
        // #499: an image's own anchor, `ID#name`: a point given as fractions of the image,
        // where its box draws it.
        if let Some((source, name)) = anchor.and_then(|a| a.split_once('#')) {
            let image = items.get(source).filter(|s| s["kind"] == "image@1");
            if let Some(f) = image.and_then(|s| pair(s.pointer(&format!("/params/anchors/{name}"))))
            {
                let s = image.expect("an image");
                if let Some([x, y, w, h]) = four(s.pointer("/params/box")) {
                    let p = item_pos(s);
                    moves.push((id.clone(), [p[0] + x + f[0] * w, p[1] + y + f[1] * h]));
                }
                continue;
            }
        }
        let Some(set) = anchor.and_then(|a| a.strip_suffix("#head")) else {
            continue;
        };
        let Some(source) = items.get(set) else {
            return refuse("ref_unresolved", format!("items/{id}/at/anchor"));
        };
        if let Some(point) = data::head_place(set, source, &items)? {
            moves.push((id.clone(), point));
        }
    }
    if moves.is_empty() {
        return Ok(items);
    }
    let mut items = items.into_owned();
    for (id, point) in moves {
        let Some(item) = items.get_mut(&id) else {
            continue;
        };
        let pos = item_pos(item);
        item["at"]["pos"] = json!([pos[0] + point[0], pos[1] + point[1], 0.0]);
    }
    Ok(Cow::Owned(items))
}

/// An item's place in its layer's draw order (#160): by z, then by the tree, each level as its
/// draw-order band (back 0, body 1, front 2), its order key and its ID. A prefix sorts first, so a
/// group's own marks draw under its children's.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Rank {
    pub z: f64,
    pub chain: Vec<(u8, String, String)>,
}

impl Eq for Rank {}

impl PartialOrd for Rank {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Rank {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.z
            .total_cmp(&other.z)
            .then_with(|| self.chain.cmp(&other.chain))
    }
}

impl Rank {
    /// The rank just past every child of this one.
    fn after_children(&self) -> Rank {
        let mut chain = self.chain.clone();
        chain.push((3, String::new(), String::new()));
        Rank { z: self.z, chain }
    }
}

/// The draw-order band of an item: `back`, `body` or `front`, `auto` as body.
fn band_of(item: &Value) -> u8 {
    match item
        .get("params")
        .and_then(|p| p.get("draw_order"))
        .and_then(Value::as_str)
    {
        Some("back") => 0,
        Some("front") => 2,
        _ => 1,
    }
}

/// An item's `z` (a channel on any 2D item), 0 when unset.
fn z_of(item: &Value) -> f64 {
    num(item.get("params").and_then(|p| p.get("z"))).unwrap_or(0.0)
}

/// Whether a group renders isolated, as one unit at its own z: below opacity 1, in a blend
/// mode, with passes, or asked to.
fn isolated(item: &Value) -> bool {
    if item.get("kind").and_then(Value::as_str) != Some("group@1") {
        return false;
    }
    let p = object_or_empty(item.get("params"));
    num(p.get("opacity")).is_some_and(|o| o < 1.0)
        || p.get("blend")
            .and_then(Value::as_str)
            .is_some_and(|b| b != "normal")
        || p.get("isolate") == Some(&Value::Bool(true))
        || p.get("passes")
            .and_then(Value::as_array)
            .is_some_and(|l| !l.is_empty())
}

/// Whether `id` is a `backdrop: below` group no item names as its parent.
fn childless_backdrop(id: &str, item: &Value, items: &Map<String, Value>) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("group@1")
        && item
            .get("params")
            .and_then(|p| p.get("backdrop"))
            .and_then(Value::as_str)
            == Some("below")
        && !items
            .values()
            .any(|i| i.get("parent").and_then(Value::as_str) == Some(id))
}

/// The ancestors of `id`, outermost first, bounded so a cycle the check refuses can't spin.
fn ancestors(items: &Map<String, Value>, id: &str) -> Vec<String> {
    let mut chain = Vec::new();
    let mut at = items
        .get(id)
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str)
        .map(str::to_string);
    while let Some(p) = at {
        if chain.len() > items.len() || p == id || chain.contains(&p) {
            break;
        }
        at = items
            .get(&p)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .map(str::to_string);
        chain.push(p);
    }
    chain.reverse();
    chain
}

/// `id`'s rank among `items`: its z, or inside an isolated group that group's, then its chain.
fn rank_of(items: &Map<String, Value>, id: &str, item: &Value) -> Rank {
    let node = |i: &str, it: &Value| {
        let order = it.get("order").and_then(Value::as_str).unwrap_or("");
        // #467: a `sort: y` group's child orders first by its sort anchor's y at t.
        let order = match foot_key(items, i, it) {
            Some(key) => format!("{key}\u{1}{order}"),
            None => order.to_string(),
        };
        (band_of(it), order, i.to_string())
    };
    let mut z = z_of(item);
    let mut chain = Vec::new();
    for a in ancestors(items, id) {
        let Some(it) = items.get(&a) else { continue };
        if isolated(it) && chain.iter().all(|(_, _, i)| !isolated(&items[i])) {
            z = z_of(it);
        }
        chain.push(node(&a, it));
    }
    chain.push(node(id, item));
    Rank { z, chain }
}

/// #467 (Frame and group: y sort): when `id`'s parent group sorts by y, the y of `id`'s sort
/// anchor (the parent's `sort_anchor`, its foot by default) on its evaluated bounds, a group's
/// the union of its descendants', as text that sorts as the number does.
fn foot_key(items: &Map<String, Value>, id: &str, item: &Value) -> Option<String> {
    let parent = items.get(item.get("parent")?.as_str()?)?;
    let params = parent.get("params")?;
    if params.get("sort").and_then(Value::as_str) != Some("y") {
        return None;
    }
    let anchor = pair(params.get("sort_anchor")).unwrap_or([0.5, 1.0]);
    let own = |it: &Value| {
        let kind = it.get("kind").and_then(Value::as_str).unwrap_or_default();
        let local = crate::relations::own_box(kind, object_or_empty(it.get("params")))?;
        Some(crate::relations::placed(
            local,
            crate::relations::place_of(it, Some(local)),
        ))
    };
    let mut boxes: Vec<[f64; 4]> = own(item).into_iter().collect();
    if item.get("kind").and_then(Value::as_str) == Some("group@1") {
        for (cid, c) in items {
            if ancestors(items, cid).iter().any(|a| a == id) {
                boxes.extend(own(c));
            }
        }
    }
    let (y0, y1) = boxes.iter().fold((f64::MAX, f64::MIN), |(a, b), r| {
        (a.min(r[1]), b.max(r[1] + r[3]))
    });
    if y0 > y1 {
        return None;
    }
    let y = y0 + anchor[1] * (y1 - y0);
    // f64 in total order as unsigned bits: negatives flipped whole, the rest with the sign set.
    let bits = y.to_bits();
    let ordered = if bits >> 63 == 1 {
        !bits
    } else {
        bits | (1 << 63)
    };
    Some(format!("{ordered:016x}"))
}

/// Each item whose own z would lift it out of the isolated group it draws inside, with that
/// group (the notice `z_inside_isolated`, Frame and group: draw order).
pub fn lifted(items: &Map<String, Value>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for (id, item) in items {
        let own = z_of(item);
        let Some(group) = ancestors(items, id)
            .into_iter()
            .find(|a| items.get(a).is_some_and(isolated))
        else {
            continue;
        };
        if own != z_of(&items[&group]) {
            out.push((id.clone(), group));
        }
    }
    out
}

/// The params key under which an evaluated item carries its earlier selves for a lagging
/// repeater (#160): a list of the item as evaluated k × lag earlier, k from 1. Only an evaluator
/// writes it; a document never holds it.
pub const LAGGED: &str = "#lagged";

/// A 2D item's outline in its own space, before its ops: a rect, a circle, a star or a path.
pub fn base_verbs(kind: &str, params: &Map<String, Value>) -> Option<Vec<Verb>> {
    Some(match kind {
        "rect@1" => outline::rect(
            four(params.get("box"))?,
            num(params.get("radius")).unwrap_or(0.0),
        ),
        "circle@1" => outline::circle(
            pair(params.get("center"))?,
            num(params.get("r")).unwrap_or(0.0),
            num(params.get("inner_r")).unwrap_or(0.0),
        ),
        "star@1" => {
            let p = |k: &str| num(params.get(k));
            Star {
                center: pair(params.get("center"))?,
                points: p("points").unwrap_or(5.0),
                outer_r: p("outer_r").unwrap_or(0.0),
                inner_r: p("inner_r").unwrap_or(0.0),
                outer_round: p("outer_round").unwrap_or(0.0),
                inner_round: p("inner_round").unwrap_or(0.0),
                polygon: params.get("polygon") == Some(&Value::Bool(true)),
            }
            .verbs("")
            .ok()?
        }
        "path@1" => path::parse(params.get("d")?.as_str()?)?,
        _ => return None,
    })
}

/// A 2D item's outline where it draws, for a union outline or an attachment at `outline`: a
/// rect, a circle, a star or a path through its ops.
pub fn item_outline(items: &Map<String, Value>, id: &str) -> Option<Vec<Verb>> {
    let item = items.get(id)?;
    let kind = item.get("kind").and_then(Value::as_str)?;
    let params = object_or_empty(item.get("params"));
    let verbs = base_verbs(kind, params)?;
    let verbs = match pathops::read(params.get("ops"), "").ok() {
        Some(ops) if !ops.is_empty() => pathops::apply(&ops, &verbs).into_iter().next()?.verbs,
        _ => verbs,
    };
    Some(Place::of(item).verbs(verbs))
}

/// Where the segment from `from` to `to` first meets the polyline edges of `verbs`, nearest to
/// `from`.
fn first_hit(verbs: &[Verb], from: [f64; 2], to: [f64; 2]) -> Option<[f64; 2]> {
    let d = [to[0] - from[0], to[1] - from[1]];
    let mut best: Option<(f64, [f64; 2])> = None;
    for line in path::flatten(verbs, 0.05) {
        let n = line.points.len();
        let edges = if line.closed { n } else { n.saturating_sub(1) };
        for i in 0..edges {
            let (a, b) = (line.points[i], line.points[(i + 1) % n]);
            let e = [b[0] - a[0], b[1] - a[1]];
            let den = d[0] * e[1] - d[1] * e[0];
            if den.abs() < 1e-12 {
                continue;
            }
            let w = [a[0] - from[0], a[1] - from[1]];
            let t = (w[0] * e[1] - w[1] * e[0]) / den;
            let u = (w[0] * d[1] - w[1] * d[0]) / den;
            if (0.0..=1.0).contains(&t)
                && (0.0..=1.0).contains(&u)
                && best.is_none_or(|(bt, _)| t < bt)
            {
                best = Some((t, [from[0] + d[0] * t, from[1] + d[1] * t]));
            }
        }
    }
    best.map(|(_, p)| p)
}

/// Where the segment from `from` to the box's centre meets the box's edge.
fn box_hit(b: [f64; 4], from: [f64; 2]) -> [f64; 2] {
    let c = [b[0] + b[2] / 2.0, b[1] + b[3] / 2.0];
    let d = [c[0] - from[0], c[1] - from[1]];
    // The largest t in 0..1 at which the segment is still outside the box.
    let mut t_in: f64 = 0.0;
    for k in 0..2 {
        if d[k].abs() < 1e-12 {
            continue;
        }
        let (lo, hi) = (b[k], b[k] + b[k + 2]);
        let t0 = (lo - from[k]) / d[k];
        let t1 = (hi - from[k]) / d[k];
        t_in = t_in.max(t0.min(t1));
    }
    let t = t_in.clamp(0.0, 1.0);
    [from[0] + d[0] * t, from[1] + d[1] * t]
}

/// What one item draws, as a frame places it: its layer, its order key, and its marks with the
/// clip and scopes each draws inside.
#[derive(Clone, Debug, PartialEq)]
pub struct Placed {
    pub layer: String,
    pub order: String,
    /// Issue #160: where the item draws in its layer: its z, then its place in the tree by
    /// draw-order band, order key and ID at each level (Frame and group: draw order).
    pub rank: Rank,
    /// Marks drawn after the item's children (a union outline's slits, #160), at the rank just
    /// past every child's.
    pub after: Vec<Arc<Drawn>>,
    pub drawn: Vec<Arc<Drawn>>,
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
    /// The document's size in u.
    size: [f64; 2],
    palette: &'a Palette,
    ty: &'a Type,
    paints: &'a Paints<'a>,
    scopes: &'a BTreeMap<String, Vec<Scope>>,
    bound: &'a BTreeMap<String, Shown>,
    row_readings: &'a BTreeMap<String, data::BoundRows>,
    planted: Planted,
}

/// What `item` draws; `None` for an item that draws nothing.
/// A text@1 item's marks at `pos`, and (#1966) what its lines add: the parts a highlight dims,
/// each with its opacity, and how far a code item's gutter reaches left of its text.
struct TextMarks {
    marks: Vec<Mark>,
    fades: Vec<(String, f64)>,
    reach: f64,
}

/// [`TextMarks`] of the text@1 item `id`: its text, set in its fill's role (a stale bound value's
/// greyed), a code item's tokens as runs; and a code item's gutter and highlights, the bands
/// under its text and the rest over it, its runs on the lines a highlight dims at 40%.
fn text_marks(
    ctx: &ItemCtx<'_>,
    id: &str,
    params: &Map<String, Value>,
    path: &str,
    pos: [f64; 2],
    fill: Option<&Map<String, Value>>,
) -> Result<TextMarks, Refused> {
    let shown = ctx.bound.get(id);
    // A stale value greys out (Bound value).
    let color_role = if shown.is_some_and(|s| s.stale) {
        Value::String("muted".into())
    } else {
        fill.and_then(|f| f.get("role"))
            .cloned()
            .unwrap_or(Value::String("ink".into()))
    };
    let code = crate::code::read(params, path)?;
    let text = code.as_ref().map(|d| d.text.clone());
    // Tokens land on the display text, which a code item shows where nothing else does.
    let tokened = code
        .as_ref()
        .filter(|_| shown.is_none() && !params.contains_key("text"));
    let spec = text_spec_of(id, params, shown, ctx.ty, text)?;
    let color = role(
        ctx.palette,
        Some(&color_role),
        &format!("{path}/params/paint/fill/role"),
    )?;
    let name = color_role.as_str().map(str::to_string);
    let mut runs = text_runs((ctx.palette, ctx.ty), params, path, tokened)?;
    let mut out = TextMarks {
        marks: Vec::new(),
        fades: Vec::new(),
        reach: 0.0,
    };
    let lines = match &code {
        Some(d) => Some(crate::lines::read(
            params,
            d.text.split('\n').count(),
            path,
        )?),
        None => None,
    };
    // #1966: each item of a list marked before its text, which its run sets `indent` in.
    let list = crate::lines::list(params, spec.size, path)?;
    let marked = list.filter(|l| l.marker != crate::lines::Marker::None);
    let shaped = (lines.is_some() || marked.is_some())
        .then(|| shaped_text(&spec))
        .flatten();
    let mut over = Vec::new();
    if let (Some(l), Some(shaped)) = (marked, &shaped) {
        over = crate::lines::markers(id, (&spec, &**shaped, pos), l, (name.as_deref(), color));
    }
    if let (Some(lines), Some(shaped)) = (&lines, shaped) {
        let g = crate::lines::gutter(
            id,
            (&spec, &*shaped, pos),
            lines,
            (ctx.palette, ctx.ty),
            (name.as_deref(), color),
        )?;
        runs = crate::lines::dimmed(runs, &g.dim, (name.as_deref().unwrap_or_default(), color));
        out.marks = g.under;
        over.extend(g.over);
        out.fades = g.fades;
        out.reach = g.reach;
    }
    out.marks.push(Mark::Text {
        item: id.to_string(),
        spec,
        origin: pos,
        color,
        role: name,
        runs,
    });
    out.marks.extend(over);
    Ok(out)
}

/// `spec`'s shaped run, through the shaped-run cache the renderers share; `None` for a font
/// nothing bundles.
fn shaped_text(spec: &TextSpec) -> Option<Arc<deep_text::Shaped>> {
    let s = spec.shaper_spec()?;
    Some(LAYOUT_SHAPER.with(|shaper| shaper.borrow_mut().shape(&s)))
}

fn placed(ctx: &ItemCtx<'_>, id: &String, item: &Value) -> Result<Option<Placed>, Refused> {
    let path = format!("items/{id}");
    if item.get("visible") == Some(&Value::Bool(false)) {
        return Ok(None);
    }
    let Some(layer) = item.get("layer").and_then(Value::as_str) else {
        return refuse("bad_doc", format!("{path}/layer"));
    };
    let params = object_or_empty(item.get("params"));
    let place = Place::of(item);
    let pos = place.offset;
    let paint = object_or_empty(params.get("paint"));
    let fill = paint.get("fill").and_then(Value::as_object);
    let stroke = paint.get("stroke").and_then(Value::as_object);
    let paint_path = format!("{path}/params/paint");
    let center = || {
        pair(params.get("center")).ok_or(Refused {
            code: "bad_doc",
            path: format!("{path}/params/center"),
        })
    };
    let path_data = || -> Result<(String, Vec<Verb>), Refused> {
        // #490: a path function in place of `d`, drawn from its samples; its text keys it.
        if let Some(f) = params.get("fn") {
            let drawn = crate::function::draw(f).map_err(|r| Refused {
                code: "bad_doc",
                path: format!("{path}/params/fn/{}", r.field),
            })?;
            let verbs = drawn
                .subpaths
                .iter()
                .flat_map(|s| {
                    s.iter().enumerate().map(|(i, p)| {
                        if i == 0 {
                            Verb::Move(*p)
                        } else {
                            Verb::Line(*p)
                        }
                    })
                })
                .collect();
            return Ok((format!("fn:{f}"), verbs));
        }
        let Some(Value::String(d)) = params.get("d") else {
            return refuse("bad_doc", format!("{path}/params/d"));
        };
        let verbs = path::parse(d).ok_or(Refused {
            code: "bad_path_data",
            path: format!("{path}/params/d"),
        })?;
        Ok((d.clone(), verbs))
    };
    // R1's rect, circle and path draw an item that only moves, in the paint R1 knows.
    // Issue #160: a path with ops, ends, an attachment or a bend, or a stroke that tapers or
    // waves, is an outline the R1 marks can't draw.
    let kinetic = ["ops", "ends", "attach", "bend", "width", "opacity"]
        .iter()
        .any(|k| params.get(*k).is_some_and(|v| !v.is_null()))
        || stroke.is_some_and(|s| s.contains_key("taper") || s.contains_key("wave"))
        || paint.get("shade").is_some_and(|v| !v.is_null())
        || joined_under(ctx, id, "opacity").is_some();
    // #149: a lamp of a backlit screen is light, and draws nothing of its own.
    if let Some(look) = &ctx.ty.drawn {
        let lamps = look.light.as_ref().and_then(|l| l.back.as_ref());
        if lamps.is_some_and(|b| b.lamps.iter().any(|l| l == id)) {
            return Ok(None);
        }
    }
    // A look dresses an item it lights or lays strokes on, or that names its fills and lines.
    let dressing = ctx.ty.drawn.as_ref().filter(|look| {
        let names = |side: &str, keys: [&str; 2]| {
            let p = paint.get(side).and_then(Value::as_object);
            p.is_some_and(|p| keys.iter().any(|k| p.contains_key(*k)))
        };
        look.light.is_some()
            || look.strokes.is_some()
            || names("fill", ["fill", "noise"])
            || names("fill", ["dither", "dither"])
            || names("stroke", ["line", "line"])
    });
    let kinetic = kinetic || dressing.is_some();
    let r1 = place.moves() && r1_paint(paint) && !kinetic;
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let adjust = Adjust::read(item, ctx.palette, id)?;
    let mut after: Vec<Mark> = Vec::new();
    // The rows a transform left below full opacity, each through its own pass.
    let mut fades: BTreeMap<String, f64> = BTreeMap::new();
    // #1966: how far a code item's gutter reaches left of its text, inside its mask.
    let mut reach = 0.0;
    let mut marks: Vec<Mark> = match kind {
        // A scale draws only its legend. A mask and a group draw nothing themselves, and a
        // camera is the view a document is seen through, not a mark (#378: a 3D figure's
        // camera). A graph, a salience level and a sheet are the graph, record and sheet
        // modules' (#388), which lay them out and draw nothing yet.
        "scale@1" => match data::legend(id, item, ctx.items, ctx.palette, pos)? {
            legend if legend.is_empty() => return Ok(None),
            legend => legend,
        },
        "group@1" if params.get("outline").is_some_and(|o| !o.is_null()) => {
            let (under, slits) = union_outline(ctx, id, params, &path)?;
            after = slits;
            under
        }
        // A backdrop group with no children covers the frame it sits in.
        "group@1" if childless_backdrop(id, item, ctx.items) => {
            let inside = (0..ctx.items.len()).try_fold(item, |at, _| {
                let frame = at
                    .get("parent")
                    .and_then(Value::as_str)
                    .and_then(|p| ctx.items.get(p));
                match frame {
                    Some(f) if f.get("kind").and_then(Value::as_str) == Some("frame@1") => Err(f),
                    Some(f) => Ok(f),
                    None => Ok(at),
                }
            });
            let bounds = match inside {
                Err(f) => Place::of(f).rect(frame_box(id, f)?),
                Ok(_) => [0.0, 0.0, ctx.size[0], ctx.size[1]],
            };
            vec![Mark::Rect {
                item: id.clone(),
                bounds,
                radius: 0.0,
                fill: Fill::Solid([255, 255, 255]),
            }]
        }
        // A logic item (#544) steps and emits occurrences, and a score (#154) sounds: neither draws.
        // A readout (#419, #1183) draws over the frame, in scene3d's view.
        "mask@1" | "matte@1" | "group@1" | "camera@1" | "graph@1" | "salience@1" | "sheet@1"
        | "axes3d@1" | "logic@1" | "score.music@1" | "overlay.text@1" => return Ok(None),
        "star@1" => {
            let p = |k: &str| num(params.get(k));
            let star = Star {
                center: center()?,
                points: p("points").unwrap_or(5.0),
                outer_r: p("outer_r").unwrap_or(0.0),
                inner_r: p("inner_r").unwrap_or(0.0),
                outer_round: p("outer_round").unwrap_or(0.0),
                inner_round: p("inner_round").unwrap_or(0.0),
                polygon: params.get("polygon") == Some(&Value::Bool(true)),
            };
            let verbs = star.verbs(&format!("{path}/params"))?;
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "frame@1" if stroke.is_some() => {
            // A stroked frame draws as a stroked rect does.
            let radius = num(params.get("radius")).unwrap_or(0.0);
            let verbs = outline::rect(frame_box(id, item)?, radius);
            vec![ctx.paints.shape_with(
                id,
                verbs,
                place,
                paint,
                &paint_path,
                (Vec::new(), Vec::new()),
            )?]
        }
        "frame@1" => {
            // A frame draws its background; its overflow mask scopes its children.
            let Some(fill) = fill else { return Ok(None) };
            let bounds = place.rect(frame_box(id, item)?);
            vec![Mark::Rect {
                item: id.clone(),
                bounds,
                radius: num(params.get("radius")).unwrap_or(0.0),
                fill: ctx.paints.paint(
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
            let center = center()?;
            let arc = params.get("arc");
            let (Some(from), Some(to)) = (
                num(arc.and_then(|a| a.get("from"))),
                num(arc.and_then(|a| a.get("to"))),
            ) else {
                return refuse("bad_doc", format!("{path}/params/arc"));
            };
            let close = match (fill.is_some(), ctx.planted) {
                (false, _) => outline::Close::Open,
                (true, Planted::ArcClosedAlongChord) => outline::Close::Chord,
                (true, _) => outline::Close::Filled,
            };
            let verbs = outline::arc(
                center,
                num(params.get("r")).unwrap_or(0.0),
                num(params.get("inner_r")).unwrap_or(0.0),
                from,
                to,
                close,
            );
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "path@1"
            if !r1
                || [fill, stroke]
                    .iter()
                    .flatten()
                    .any(|p| p.contains_key("gradient") || p.contains_key("steps")) =>
        {
            let (_, verbs) = path_data()?;
            let verbs = attached(ctx, verbs, params, &path)?;
            let built = build_path(ctx, id, verbs, params, paint, place)?;
            ctx.paints.shapes(id, &built, place, paint, &paint_path)?
        }
        "rect@1" | "circle@1"
            if !r1
                || kinetic
                || stroke.is_some()
                || (kind == "circle@1" && fill.is_some_and(|f| !f.contains_key("role"))) =>
        {
            let verbs = if kind == "rect@1" {
                let Some(b) = four(params.get("box")) else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                outline::rect(b, num(params.get("radius")).unwrap_or(0.0))
            } else {
                let center = center()?;
                outline::circle(
                    center,
                    num(params.get("r")).unwrap_or(0.0),
                    num(params.get("inner_r")).unwrap_or(0.0),
                )
            };
            if fill.is_none() && stroke.is_none() {
                return Ok(None);
            }
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "marks@1" if crate::atlas::is_atlas(params) => {
            let rows = data::rows(
                id,
                item,
                ctx.items,
                ctx.row_readings
                    .get(id.as_str())
                    .unwrap_or(&data::BoundRows::new()),
            )?;
            crate::atlas::marks(id, params, &rows, pos, ctx.planted)?
        }
        "marks@1" => {
            let drawing = data::mark_set(
                id,
                item,
                ctx.items,
                ctx.palette,
                pos,
                ctx.row_readings
                    .get(id.as_str())
                    .unwrap_or(&data::BoundRows::new()),
            )?;
            fades = drawing.fades;
            drawing.marks
        }
        "axis@1" => {
            let channels = ctx.paints.doc.get("channels");
            let drawing = data::axis(id, item, (ctx.items, channels), ctx.palette, pos, ctx.size)?;
            fades = drawing.fades;
            drawing.marks
        }
        "series@1" => {
            let how = match ctx.planted {
                Planted::DecimateFirstLast => data::Decimate::FirstLast,
                Planted::DecimateMinMax => data::Decimate::MinMax,
                _ => data::Decimate::M4,
            };
            data::series(id, item, ctx.palette, pos, how)?
        }
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
            // #535: `at.rot`'s z (degrees) turns the image about its origin.
            let turn = num(item.pointer("/at/rot/2")).unwrap_or(0.0);
            let origin = place.offset;
            vec![Mark::Image {
                item: id.clone(),
                asset: asset.to_ascii_lowercase(),
                bounds: crate::turn::about(place.rect(bounds), origin, turn),
                fit,
                sampling,
                crop: four(params.get("crop")),
                opacity: num(params.get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0),
                adjust: Adjust::default(),
                tile: None,
                turn,
            }]
        }
        "text@1" => {
            let drawn = text_marks(ctx, id, params, &path, pos, fill)?;
            fades.extend(drawn.fades);
            reach = drawn.reach;
            drawn.marks
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
                    fill: ctx.paints.paint(
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
                let center = center()?;
                let Some(fill) = fill else { return Ok(None) };
                Mark::Circle {
                    item: id.clone(),
                    center: [center[0] + pos[0], center[1] + pos[1]],
                    r: num(params.get("r")).unwrap_or(0.0),
                    inner_r: num(params.get("inner_r")).unwrap_or(0.0),
                    color: role(
                        ctx.palette,
                        fill.get("role"),
                        &format!("{path}/params/paint/fill/role"),
                    )?,
                }
            }
            "path@1" => {
                let (d, verbs) = path_data()?;
                // One color per path in R1: the stroke's role, else the fill's.
                let color_role = stroke
                    .and_then(|s| s.get("role"))
                    .or(fill.and_then(|f| f.get("role")));
                let color = role(ctx.palette, color_role, &format!("{path}/params/paint"))?;
                Mark::Path {
                    item: id.clone(),
                    d,
                    geometry: Geometry {
                        verbs,
                        stroke: stroke.map(|s| num(s.get("width")).unwrap_or(1.0)),
                        fill: fill.is_some(),
                    },
                    offset: pos,
                    color,
                }
            }
            // A 2D layer's pass runs on the target of a group that names it, and draws nothing.
            "gpu.pass@1" => return Ok(None),
            _ => return refuse("module_missing", format!("{path}/kind: {kind}")),
        }],
    };
    let order = item.get("order").and_then(Value::as_str).unwrap_or("");
    let mut scopes = ctx.scopes.get(id).cloned().unwrap_or_default();
    if childless_backdrop(id, item, ctx.items) {
        scopes.extend(ancestor_scope(id, item, ctx.items, ctx.palette)?);
    }
    // Masked text draws whole, clipped to its box: its width, and its height or its line limit's;
    // a code item's gutter (#1966) inside it, left of its text.
    let text = marks.iter().find_map(|m| match m {
        Mark::Text {
            item, spec, origin, ..
        } if item == id => Some((spec, origin)),
        _ => None,
    });
    if let (Some((spec, origin)), "text@1") = (text, kind) {
        let side = |k: &str| params.get("box").and_then(|b| num(b.get(k)));
        let lines = spec
            .max_lines
            .zip(spec.shaper_spec())
            .map(|(n, s)| f64::from(n) * f64::from(s.line_height()));
        if let (true, Some(w), Some(h)) = (spec.mask, side("w"), side("h").or(lines)) {
            scopes.push(Scope::Clip {
                item: format!("{id}#box"),
                rect: [origin[0] - reach, origin[1], w + reach, h],
                radius: 0.0,
            });
        }
    }
    if adjust.opacity < 1.0 {
        scopes.push(Scope::Opacity {
            item: format!("{id}#adjust"),
            alpha: adjust.opacity,
            blend: None,
            effect: None,
        });
    }
    let clip = clip_of(&scopes);
    if !adjust.is_identity() {
        marks.iter_mut().for_each(|m| m.adjust(&adjust));
    }
    let drawn = |marks: Vec<Mark>| -> Vec<Arc<Drawn>> {
        marks
            .into_iter()
            .map(|mark| {
                let mut scopes = scopes.clone();
                if let Some(alpha) = fades.get(mark.item()) {
                    scopes.push(Scope::Opacity {
                        item: format!("{}#fade", mark.item()),
                        alpha: *alpha,
                        blend: None,
                        effect: None,
                    });
                }
                Arc::new(Drawn { mark, clip, scopes })
            })
            .collect()
    };
    // A shade (Paint: shade, #160) draws between the shape's fill and its stroke, clipped to it.
    let shade = paint::Shade::read(
        ctx.palette,
        paint.get("shade"),
        &format!("{paint_path}/shade"),
    )?;
    let drawn_marks = match (&shade, dressing) {
        (None, Some(look)) => {
            let dress = crate::drawn::Dress {
                look,
                doc: ctx.paints.doc,
                items: ctx.items,
                palette: ctx.palette,
                first_rim: ctx.ty.first_rim,
                flat_ink: ctx.ty.flat_ink,
            };
            crate::drawn::dress(&dress, id, paint, marks)?
                .into_iter()
                .map(|(mark, inner)| {
                    let mut all = scopes.clone();
                    all.extend(inner);
                    Arc::new(Drawn {
                        mark,
                        clip,
                        scopes: all,
                    })
                })
                .collect()
        }
        (None, None) => drawn(marks),
        (Some(shade), _) => marks
            .into_iter()
            .flat_map(|mark| shaded(id, mark, shade, &scopes, clip))
            .collect(),
    };
    // #467: paint built from the item's coverage: a drop, a glow, an inner shade, bevel, satin.
    let light = ctx.ty.drawn.as_ref().and_then(|l| l.light.as_ref()).map_or(
        crate::fx::Light::default(),
        |l| crate::fx::Light {
            dir: l.dir,
            elevation: l.elevation,
        },
    );
    let mut fx = crate::fx::Fx::read(ctx.palette, paint, &paint_path, light)?;
    // #1653: halos on a text, or on each row of a set of texts.
    let set_of_texts =
        kind == "marks@1" && params.get("mark").and_then(Value::as_str) == Some("text");
    let halos = if kind == "text@1" || set_of_texts {
        crate::fx::halos(
            ctx.palette,
            params.get("halo"),
            &format!("{path}/params/halo"),
        )?
    } else {
        Vec::new()
    };
    let drawn_marks = if set_of_texts && !halos.is_empty() {
        let only = crate::fx::Fx {
            halos,
            ..crate::fx::Fx::default()
        };
        let rows = with_fx(id, &fx, drawn_marks);
        rows.into_iter()
            .flat_map(|d| {
                let row = d.mark.item().to_string();
                with_fx(&row, &only, vec![d])
            })
            .collect()
    } else {
        fx.halos = halos;
        with_fx(id, &fx, drawn_marks)
    };
    Ok(Some(Placed {
        keys: Vec::new(),
        layer: layer.to_string(),
        order: order.to_string(),
        rank: rank_of(ctx.items, id, item),
        after: drawn(after),
        drawn: drawn_marks,
    }))
}

/// `mark` in one color, every span of a text included.
fn recolored(mark: &Mark, c: Rgb) -> Mark {
    let mut m = mark.clone();
    match &mut m {
        Mark::Rect { fill, .. } => *fill = Fill::Solid(c),
        Mark::Circle { color, .. } | Mark::Path { color, .. } => *color = c,
        Mark::Shape { fill, stroke, .. } => {
            fill.iter_mut().for_each(|(f, a)| {
                *f = Fill::Solid(c);
                *a = 1.0;
            });
            stroke.iter_mut().for_each(|l| {
                l.paint = Fill::Solid(c);
                l.opacity = 1.0;
            });
        }
        Mark::Text {
            color, runs, role, ..
        } => {
            *color = c;
            *role = None;
            runs.iter_mut().for_each(|r| r.color = c);
        }
        Mark::Image { .. } => {}
    }
    m
}

/// `mark` moved by `d` u, renamed `item`.
fn moved(mark: &Mark, d: [f64; 2], name: &str) -> Mark {
    let shift = |p: [f64; 2]| [p[0] + d[0], p[1] + d[1]];
    let mut m = mark.clone();
    match &mut m {
        Mark::Rect { item, bounds, .. } | Mark::Image { item, bounds, .. } => {
            *item = name.to_string();
            bounds[0] += d[0];
            bounds[1] += d[1];
        }
        Mark::Circle { item, center, .. } => {
            *item = name.to_string();
            *center = shift(*center);
        }
        Mark::Path { item, offset, .. } => {
            *item = name.to_string();
            *offset = shift(*offset);
        }
        Mark::Text { item, origin, .. } => {
            *item = name.to_string();
            *origin = shift(*origin);
        }
        Mark::Shape { item, verbs, .. } => {
            *item = name.to_string();
            for v in verbs.iter_mut() {
                *v = match *v {
                    Verb::Move(p) => Verb::Move(shift(p)),
                    Verb::Line(p) => Verb::Line(shift(p)),
                    Verb::Quad(a, b) => Verb::Quad(shift(a), shift(b)),
                    Verb::Cubic(a, b, c) => Verb::Cubic(shift(a), shift(b), shift(c)),
                    Verb::Close => Verb::Close,
                };
            }
        }
    }
    m
}

/// #467: an item's marks with what its paint builds from their coverage (Paint: drop; Paint:
/// shade, `kind: inner`; Paint: glow, bevel and satin). A drop without blur is the item's own
/// marks once more, moved and in its role, under them: on text the same shaped run. Every other
/// part draws the item's own marks as white coverage inside a scope whose effect builds the part
/// from it, under the marks (a blurred drop, an outer glow) or over them.
fn with_fx(id: &str, fx: &crate::fx::Fx, marks: Vec<Arc<Drawn>>) -> Vec<Arc<Drawn>> {
    let parts = fx.parts();
    if fx.drop.is_none() && parts.is_empty() {
        return marks;
    }
    let own: Vec<Arc<Drawn>> = marks
        .iter()
        .filter(|d| d.mark.item() == id)
        .cloned()
        .collect();
    let layer = |part: crate::fx::Part| -> Vec<Arc<Drawn>> {
        let name = format!("{id}#{}", part.name());
        let blend = match part.mode() {
            crate::fx::Mode::Normal => Blend::Normal,
            crate::fx::Mode::Multiply => Blend::Multiply,
            crate::fx::Mode::Screen => Blend::Screen,
            crate::fx::Mode::Add => Blend::Add,
        };
        let scope = Scope::Opacity {
            item: name.clone(),
            alpha: 1.0,
            blend: Some(blend),
            effect: Some(Arc::new(Effect {
                paint: Some(Arc::new(part)),
                ..Effect::default()
            })),
        };
        own.iter()
            .map(|d| {
                let mut scopes = d.scopes.clone();
                scopes.push(scope.clone());
                Arc::new(Drawn {
                    mark: moved(&recolored(&d.mark, [255, 255, 255]), [0.0, 0.0], &name),
                    clip: d.clip,
                    scopes,
                })
            })
            .collect()
    };
    let mut under = Vec::new();
    let mut over = Vec::new();
    if let Some(drop) = fx.drop.as_ref().filter(|d| d.blur == 0.0) {
        let name = format!("{id}#drop");
        let mut extra = Vec::new();
        if drop.opacity < 1.0 || drop.mode == crate::fx::Mode::Multiply {
            extra.push(Scope::Opacity {
                item: name.clone(),
                alpha: drop.opacity,
                blend: (drop.mode == crate::fx::Mode::Multiply).then_some(Blend::Multiply),
                effect: None,
            });
        }
        for d in &own {
            let mut scopes = d.scopes.clone();
            scopes.extend(extra.iter().cloned());
            under.push(Arc::new(Drawn {
                mark: moved(&recolored(&d.mark, drop.color), drop.offset, &name),
                clip: d.clip,
                scopes,
            }));
        }
    }
    for part in parts {
        if part.under() {
            under.extend(layer(part));
        } else {
            over.extend(layer(part));
        }
    }
    under.extend(marks);
    under.extend(over);
    under
}

/// A filled outline with its shade: the fill, then the shade (the shape less a copy of it moved
/// toward the light, so a crescent of shade sits on the far side), the highlight (the shape less a
/// copy moved away from the light: a crescent on the near side) and the rim (a band inside the
/// edge), each clipped to the shape, then the stroke. Any other mark draws as it is.
fn shaded(
    id: &str,
    mark: Mark,
    shade: &paint::Shade,
    scopes: &[Scope],
    clip: Option<[f64; 4]>,
) -> Vec<Arc<Drawn>> {
    let plain = |mark: Mark| {
        Arc::new(Drawn {
            mark,
            clip,
            scopes: scopes.to_vec(),
        })
    };
    // Only the item's own outline is shaded, never its heads (`<id>#ends.*`).
    let Mark::Shape {
        item,
        verbs,
        fill: Some(fill),
        stroke,
    } = mark
    else {
        return vec![plain(mark)];
    };
    if item != id {
        return vec![plain(Mark::Shape {
            item,
            verbs,
            fill: Some(fill),
            stroke,
        })];
    }
    let outline = Arc::new(verbs.clone());
    let mut inside = scopes.to_vec();
    inside.push(Scope::Shape {
        item: format!("{id}#shade"),
        verbs: Arc::clone(&outline),
    });
    if shade.multiply {
        inside.push(Scope::Opacity {
            item: format!("{id}#shade.multiply"),
            alpha: 1.0,
            blend: Some(Blend::Multiply),
            effect: None,
        });
    }
    let clipped = |mark: Mark| {
        Arc::new(Drawn {
            mark,
            clip,
            scopes: inside.clone(),
        })
    };
    // The shape with a copy of itself moved by `by` cut out of it: the copy traced the other way
    // winds against the shape, so under the non-zero rule their overlap is a hole and what shows,
    // inside the clip, is the crescent the move uncovers.
    let less_moved = |by: [f64; 2]| -> Vec<Verb> {
        let m = |p: [f64; 2]| [p[0] + by[0], p[1] + by[1]];
        let copy: Vec<Verb> = verbs
            .iter()
            .map(|v| match *v {
                Verb::Move(p) => Verb::Move(m(p)),
                Verb::Line(p) => Verb::Line(m(p)),
                Verb::Quad(a, b) => Verb::Quad(m(a), m(b)),
                Verb::Cubic(a, b, c) => Verb::Cubic(m(a), m(b), m(c)),
                Verb::Close => Verb::Close,
            })
            .collect();
        let mut out = verbs.clone();
        out.extend(pathops::reversed(&copy));
        out
    };
    let mut out = vec![plain(Mark::Shape {
        item: item.clone(),
        verbs: verbs.clone(),
        fill: Some(fill),
        stroke: None,
    })];
    out.push(clipped(Mark::Shape {
        item: format!("{id}#shade"),
        verbs: less_moved(shade.away(-shade.offset)),
        fill: Some((Fill::Solid(shade.color), shade.opacity)),
        stroke: None,
    }));
    if let Some((color, offset)) = shade.highlight {
        out.push(clipped(Mark::Shape {
            item: format!("{id}#highlight"),
            verbs: less_moved(shade.away(offset)),
            fill: Some((Fill::Solid(color), shade.opacity)),
            stroke: None,
        }));
    }
    if let Some((color, width)) = shade.rim {
        out.push(clipped(Mark::Shape {
            item: format!("{id}#rim"),
            verbs: verbs.clone(),
            fill: None,
            stroke: Some(Line {
                width: 2.0 * width,
                paint: Fill::Solid(color),
                opacity: shade.opacity,
                dashes: None,
                profile: None,
            }),
        }));
    }
    if stroke.is_some() {
        out.push(plain(Mark::Shape {
            item,
            verbs,
            fill: None,
            stroke,
        }));
    }
    out
}

/// What `item` draws when it reads nothing beyond itself, the palette and what its bound value
/// shows (#857: marks2d builds these on the scheduler's pool, an item to a node): an R1 rect,
/// circle, path or text with no parent, painted by roles. `None` for any other item, and for
/// one the check would refuse, which the frame builds itself; the frame also leaves out an item
/// that is a parent, sits in a collection or names a layer the document lacks.
pub fn item_placed(
    id: &str,
    item: &Value,
    (palette, ty): (&Palette, &Type),
    shown: Option<&Shown>,
) -> Option<Placed> {
    let kind = item.get("kind").and_then(Value::as_str)?;
    if !matches!(kind, "rect@1" | "circle@1" | "path@1" | "text@1")
        || item.get("parent").is_some()
        || item.pointer("/at/anchor").is_some()
        || reads_anchor(item)
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
        size: [0.0; 2],
        palette,
        ty,
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

/// [`frame_with`] with `prebuilt` items placed as given and left out of `items`, and where each
/// item's marks sit; `None` when a paint asks for boxes, which only a frame built from every item
/// can give.
pub fn frame_prebuilt(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    zoom: f64,
    bound: &BTreeMap<String, Shown>,
    record: &Record,
    prebuilt: &[(&str, &Placed)],
) -> Result<Option<(Frame, Places)>, Refused> {
    let row_readings = bound_rows(doc, record);
    let (frame, wants_boxes, places) = build(
        doc,
        (items, prebuilt),
        (palette, ty),
        (bound, &row_readings),
        zoom,
        Planted::None,
        None,
    )?;
    Ok((!wants_boxes).then_some((frame, places)))
}

/// Each item's layer, first mark and mark count in a frame's list.
pub type Spots = BTreeMap<String, (u32, u32, u32)>;

/// Where a frame's marks sit (#896): each item's layer, first mark and mark count, when every
/// item's marks sit together, and each layer's tree over its marks' keys in draw order. A frame
/// replaces one item's marks by these, and rekeys the layer by their path in its tree.
#[derive(Clone, Debug)]
pub struct Places {
    pub at: Option<Arc<Spots>>,
    pub trees: Vec<KeyTree>,
}

/// A writer layer's key: its ID, the frame's size and zoom, then its marks' count and the root
/// of the tree over their keys in draw order (#896: one changed mark rekeys it by its path).
pub fn layer_key(id: &str, size: [f64; 2], zoom: f64, marks: &KeyTree) -> ContentKey {
    let mut k = KeyBuilder::new("layer@marks2d.3");
    k.text(id).number(size[0]).number(size[1]).number(zoom);
    k.int(marks.len() as i64).bytes(&marks.root().0);
    k.finish()
}

/// The frame, and whether a paint asked for boxes that `boxes` doesn't yet hold.
fn build(
    doc: &Map<String, Value>,
    // The items to build, and those built from the item alone (#857), placed as given.
    (items, prebuilt): (&Map<String, Value>, &[(&str, &Placed)]),
    (palette, ty): (&Palette, &Type),
    // What each bound value and counter shows, and the readings bound to mark sets' rows.
    (bound, row_readings): (&BTreeMap<String, Shown>, &BTreeMap<String, data::BoundRows>),
    zoom: f64,
    planted: Planted,
    boxes: Option<&BTreeMap<String, [f64; 4]>>,
) -> Result<(Frame, bool, Places), Refused> {
    let items = laid_out(doc, items)?;
    let items = &*anchored(items)?;
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
    // Path ops' declared segments across the document (#160), before any path builds; the
    // document's budget names the op of the path that crosses it.
    let mut segments: u64 = 0;
    for (id, item) in items {
        let params = object_or_empty(item.get("params"));
        let Some(ops_value) = params.get("ops").filter(|o| !o.is_null()) else {
            continue;
        };
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let Some(verbs) = base_verbs(kind, params) else {
            continue;
        };
        let ops_path = format!("items/{id}/params/ops");
        let ops = pathops::read(Some(ops_value), &ops_path)?;
        let (n, over) = pathops::declared(&ops, &verbs);
        if let Some(i) = over {
            return refuse("segment_budget", format!("{ops_path}/{i}"));
        }
        segments += n;
        if segments > pathops::MAX_DOCUMENT_SEGMENTS {
            let last = ops.len().saturating_sub(1);
            return refuse("segment_budget", format!("{ops_path}/{last}"));
        }
    }
    let paints = Paints {
        doc,
        items,
        palette,
        boxes,
        wants_boxes: Cell::new(false),
    };
    // #495: each matte's source, drawn alone though hidden: the item and what is under it.
    let mut sources: BTreeMap<String, Arc<Vec<Drawn>>> = BTreeMap::new();
    let bare = BTreeMap::new();
    let alone = ItemCtx {
        items,
        size,
        palette,
        ty,
        paints: &paints,
        scopes: &bare,
        bound,
        row_readings,
        planted,
    };
    for (id, item) in items {
        if item.get("kind").and_then(Value::as_str) != Some("matte@1") {
            continue;
        }
        let Some(source) = item
            .get("params")
            .and_then(|p| p.get("source"))
            .and_then(Value::as_str)
        else {
            return refuse("bad_doc", format!("items/{id}/params/source"));
        };
        if !items.contains_key(source) {
            return refuse("ref_unresolved", format!("items/{id}/params/source"));
        }
        let mut marks: Vec<(Rank, usize, &String, Arc<Drawn>)> = Vec::new();
        for (k, member) in items {
            if !is_under(items, k, source) {
                continue;
            }
            let mut shown = member.clone();
            if k == source {
                if let Some(o) = shown.as_object_mut() {
                    o.remove("visible");
                }
            }
            if let Some(p) = placed(&alone, k, &shown)? {
                marks.extend(
                    p.drawn
                        .iter()
                        .enumerate()
                        .map(|(i, d)| (p.rank.clone(), i, k, d.clone())),
                );
            }
        }
        marks.sort_by(|a, b| (&a.0, a.1, a.2).cmp(&(&b.0, b.1, b.2)));
        sources.insert(
            id.clone(),
            Arc::new(marks.into_iter().map(|m| (*m.3).clone()).collect()),
        );
    }
    let scopes = scopes_of(doc, items, palette, &sources)?;
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
        size,
        palette,
        ty,
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
    if planted != Planted::SectorsSourceOver {
        cover(&mut built, items);
    }
    let built = built.iter().map(|(id, p)| (*id, p));
    for (id, placed) in built.chain(prebuilt.iter().copied()) {
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
            slot.2.push((placed.rank.clone(), k, id, drawn, key));
        }
        let later = placed.rank.after_children();
        for (k, drawn) in placed.after.iter().enumerate() {
            slot.2.push((
                later.clone(),
                placed.drawn.len() + k,
                id,
                drawn,
                drawn.key(bucket),
            ));
        }
    }
    layers.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let mut at = Some(BTreeMap::new());
    let mut trees = Vec::with_capacity(layers.len());
    let layers = layers
        .into_iter()
        .enumerate()
        .map(|(li, (_, id, mut marks))| {
            marks.sort_by(|a, b| (&a.0, a.1, a.2).cmp(&(&b.0, b.1, b.2)));
            for (k, m) in marks.iter().enumerate() {
                let Some(places) = at.as_mut() else { break };
                let e = places
                    .entry(m.2.to_string())
                    .or_insert((li as u32, k as u32, 0));
                // An item whose marks sit apart (two items under one order key) can't be
                // replaced in place: the next frame builds them all.
                if e.1 + e.2 != k as u32 {
                    at = None;
                    continue;
                }
                e.2 += 1;
            }
            let tree = KeyTree::new(marks.iter().map(|m| Key(m.4 .0)).collect());
            let key = layer_key(&id, size, zoom, &tree);
            trees.push(tree);
            let marks: MarkList = marks.into_iter().map(|m| Arc::clone(m.3)).collect();
            Layer { key, id, marks }
        })
        .collect();
    let frame = Frame {
        size,
        ground,
        layers,
    };
    let places = Places {
        at: at.map(Arc::new),
        trees,
    };
    Ok((frame, paints.wants_boxes.get(), places))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

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
        let f = |v: Value| Format::read(Some(&v), None, "f").unwrap();
        assert_eq!(f(json!({"precision": 2})).show(Some(1234.5)), "1,234.50");
        assert_eq!(
            f(json!({"notation": "percent", "precision": 1})).show(Some(0.256)),
            "25.6%"
        );
        assert_eq!(
            f(json!({"sign": "always", "unit": "ms"})).show(Some(12.0)),
            "+12 ms"
        );
        assert_eq!(f(json!({"group": "none"})).show(Some(-98765.0)), "−98765");
        assert_eq!(f(json!({})).show(None), "—");
        let compact = f(json!({"notation": "compact"}));
        assert_eq!(compact.show(Some(950.0)), "950");
        assert_eq!(compact.show(Some(1234.0)), "1.2K");
        assert_eq!(compact.show(Some(-3_456_789.0)), "−3.5M");
        assert_eq!(compact.show(Some(999_950.0)), "1.0M");
        let duration = f(json!({"notation": "duration"}));
        assert_eq!(duration.show(Some(0.45)), "450 ms");
        assert_eq!(duration.show(Some(3.5)), "3.5 s");
        assert_eq!(duration.show(Some(2.0)), "2 s");
        assert_eq!(duration.show(Some(125.0)), "2 min 05 s");
        assert_eq!(duration.show(Some(3720.0)), "1 h 02 min");
        assert_eq!(
            f(json!({"notation": "duration", "unit": "ms"})).show(Some(1500.0)),
            "1.5 s"
        );
        assert_eq!(
            Format::read(None, Some(&json!("hide")), "f")
                .unwrap()
                .show(None),
            ""
        );
        assert_eq!(
            Format::read(Some(&json!({"notation": "engineering"})), None, "f")
                .unwrap_err()
                .code,
            "format_notation"
        );
    }

    #[test]
    fn a_counter_formats_its_bound_value_s_reading_with_tabular_figures() {
        let doc = json!({
            "size": [100, 40],
            "layers": {"main": {"order": "a0"}},
            "items": {"n": {"id": "n", "kind": "text@1", "layer": "main",
                "params": {"text": {"counter": {"source": "passed", "format": {"notation": "percent"}}}}}},
            "bound_values": {"passed": {"target": "items/other/params/text", "source": "reading:01JB0000000000000000000001"}},
        });
        let doc = doc.as_object().unwrap();
        let items = doc["items"].as_object().unwrap();
        let record = Record {
            readings: [("reading:01JB0000000000000000000001".to_string(), 0.75)].into(),
            ..Record::default()
        };
        let f = frame(doc, items, &palette(), &record, 1.0).unwrap();
        let Mark::Text { spec, .. } = &f.layers[0].marks[0].mark else {
            panic!("a text mark")
        };
        assert_eq!(spec.text, "75%");
        assert!(spec.bound, "a counter shapes with tabular figures");
    }

    fn board(items: Value) -> Value {
        json!({
            "size": [200, 100],
            "layers": {"main": {"order": "a0"}, "other": {"order": "a1"}},
            "items": items,
            "collections": {"clipped": {"members": ["b"]}},
        })
    }

    fn palette() -> Palette {
        [
            ("ground".to_string(), [255, 255, 255]),
            ("ink".to_string(), [0, 0, 0]),
        ]
        .into()
    }

    fn draw(doc: &Value) -> Result<Frame, Refused> {
        let doc = doc.as_object().unwrap();
        frame(
            doc,
            doc["items"].as_object().unwrap(),
            &palette(),
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
        let doc = board(json!({
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
        let doc = board(json!({
            "m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 10, 10]}},
            "x": {"kind": "rect@1", "layer": "other", "parent": "m", "params": {"box": [0, 0, 5, 5], "paint": {"fill": {"role": "ink"}}}},
        }));
        assert_eq!(draw(&doc).unwrap_err().code, "mask_writer");
        let mut items = Map::new();
        for k in 0..5 {
            let mut m =
                json!({"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 100, 100]}});
            if k > 0 {
                m["parent"] = json!(format!("m{}", k - 1));
            }
            items.insert(format!("m{k}"), m);
        }
        items.insert("deep".into(), json!({"kind": "rect@1", "layer": "main", "parent": "m4", "params": {"box": [0, 0, 1, 1], "paint": {"fill": {"role": "ink"}}}}));
        assert_eq!(
            draw(&board(Value::Object(items))).unwrap_err().code,
            "mask_depth"
        );
        // #385 draws a feathered mask; an inverted one still waits.
        let inverted = board(
            json!({"m": {"kind": "mask@1", "layer": "main", "params": {"box": [0, 0, 1, 1], "invert": true}}}),
        );
        assert_eq!(draw(&inverted).unwrap_err().code, "mask_r2");
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
    fn stepped(steps: Value) -> Frame {
        let sq = |x: i32, order: &str| {
            json!({"kind": "rect@1", "layer": "main", "parent": "g", "order": order,
                "params": {"box": [x, 0, 10, 10], "paint": {"fill": {"steps": steps.clone()}}}})
        };
        let mut doc = board(json!({
            "g": {"kind": "group@1", "layer": "main", "params": {}},
            "a": sq(0, "a2"), "b": sq(50, "a1"), "c": sq(100, "a0"),
        }));
        doc["collections"]["ends"] = json!({"members": ["a", "c"]});
        draw(&doc).unwrap()
    }

    #[test]
    fn steps_place_a_member_by_its_box_or_its_rank_among_a_collection_s_members() {
        let stops = json!([{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]);
        let (ink, ground) = ([0, 0, 0], [255, 255, 255]);
        // By order, a ranks last of the three; by x it stands first.
        let f = stepped(json!({"over": "children", "stops": stops, "by": "order"}));
        assert_eq!((solid(&f, "a"), solid(&f, "c")), (ground, ink));
        let f = stepped(json!({"over": "children", "stops": stops, "by": "x"}));
        assert_eq!((solid(&f, "a"), solid(&f, "c")), (ink, ground));
        let mid = solid(&f, "b");
        assert!(mid != ink && mid != ground && mid[0] == mid[1] && mid[1] == mid[2]);
        // By distance from a's center, 100 u out reaches the last stop.
        let by = json!({"distance": {"from": [5, 5], "radius": 100}});
        let f = stepped(json!({"over": "children", "stops": stops, "by": by}));
        assert_eq!(
            (solid(&f, "a"), solid(&f, "b"), solid(&f, "c")),
            (ink, mid, ground)
        );
        // Over a collection of two, c ranks first and a last; b isn't a member.
        let ends = json!({"over": "ends", "stops": stops, "by": "order"});
        let mut doc = board(json!({
            "a": {"kind": "rect@1", "layer": "main", "order": "a1", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
            "c": {"kind": "rect@1", "layer": "main", "order": "a0", "params": {"box": [100, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
            "b": {"kind": "rect@1", "layer": "main", "params": {"box": [50, 0, 10, 10], "paint": {"fill": {"steps": ends}}}},
        }));
        doc["collections"]["ends"] = json!({"members": ["a", "c"]});
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
        let gradient = |span: &str| json!({"gradient": {"span": span, "stops": [{"at": 0, "role": "ink"}, {"at": 1, "role": "ground"}]}});
        let doc = board(json!({
            "g": {"kind": "group@1", "layer": "main", "params": {}},
            "p": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [20, 10, 30, 30]}},
            "q": {"kind": "rect@1", "layer": "main", "parent": "g", "params": {"box": [120, 30, 40, 30]}},
            "r": {"kind": "rect@1", "layer": "main", "params": {"box": [0, 0, 10, 10], "paint": {"fill": gradient("g")}}},
        }));
        // p and q draw nothing, yet the group's box is theirs: x 20 to 160, y 10 to 60.
        let doc = {
            let mut d = doc;
            for k in ["p", "q"] {
                d["items"][k]["params"]["paint"] = json!({"fill": {"role": "ink"}});
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
        missing["items"]["r"]["params"]["paint"] = json!({"fill": gradient("nowhere")});
        assert_eq!(draw(&missing).unwrap_err().code, "ref_unresolved");
        let mut fill_along = doc.clone();
        fill_along["items"]["r"]["params"]["paint"]["fill"]["gradient"]["kind"] = json!("along");
        assert_eq!(draw(&fill_along).unwrap_err().code, "gradient_kind");
    }

    #[test]
    fn a_path_draws_at_most_10_000_dashes() {
        let dashed = |count: u64| {
            board(json!({"o": {"kind": "circle@1", "layer": "main",
                "params": {"center": [50, 50], "r": 40, "paint": {"stroke": {"role": "ink", "dash": {"count": count}}}}}}))
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
                json!({"kind": "marks@1", "layer": "main", "params": {"mark": "point", "n": 1_000_000}}),
            )
        };
        let items: Map<_, _> = (0..17).map(set).collect();
        let r = draw(&board(Value::Object(items))).unwrap_err();
        assert_eq!(
            (r.code, r.path.as_str()),
            ("out_of_range", "items/s16/params/n")
        );
    }

    #[test]
    fn an_image_is_named_by_its_hash_and_needs_its_alt_text() {
        let hash = "ab".repeat(32);
        let ok = board(json!({"shot": {"kind": "image@1", "layer": "main",
            "params": {"asset": hash, "box": [0, 0, 100, 50], "fit": "cover", "alt": "The failing step"}}}));
        let f = draw(&ok).unwrap();
        let Mark::Image { asset, fit, .. } = &f.layers[0].marks[0].mark else {
            panic!("an image")
        };
        assert_eq!((asset.as_str(), *fit), (hash.as_str(), ImageFit::Cover));
        let mut no_alt = ok.clone();
        no_alt["items"]["shot"]["params"]["alt"] = json!("");
        assert_eq!(draw(&no_alt).unwrap_err().code, "alt_missing");
        let mut by_path = ok.clone();
        by_path["items"]["shot"]["params"]["asset"] = json!("/tmp/shot.png");
        assert_eq!(draw(&by_path).unwrap_err().code, "bad_asset");
    }
    /// The non-zero winding of `verbs` about `p`, from its sub-paths flattened at 64 points a
    /// segment.
    fn winding(verbs: &[Verb], p: [f64; 2]) -> i32 {
        let mut w = 0;
        for sub in pathops::subs_of(verbs) {
            let mut pts: Vec<[f64; 2]> = Vec::new();
            for seg in &sub.segs {
                for i in 0..64 {
                    pts.push(seg.at(i as f64 / 64.0));
                }
            }
            let n = pts.len();
            for i in 0..n {
                let (a, b) = (pts[i], pts[(i + 1) % n]);
                if a[1] <= p[1] {
                    if b[1] > p[1] && (b[0] - a[0]) * (p[1] - a[1]) > (p[0] - a[0]) * (b[1] - a[1])
                    {
                        w += 1;
                    }
                } else if b[1] <= p[1]
                    && (b[0] - a[0]) * (p[1] - a[1]) < (p[0] - a[0]) * (b[1] - a[1])
                {
                    w -= 1;
                }
            }
        }
        w
    }

    #[test]
    fn a_crescent_shade_sits_on_the_far_side_and_its_highlight_on_the_near_side() {
        // #160, Paint: shade: a 40 u circle lit from the left (light 180°) shaded by 8 u with a
        // 10 u highlight. The shade covers a point near the right edge and none near the left
        // edge; the highlight the other way round; the middle keeps the fill.
        let doc = board(json!({
            "ball": {"kind": "circle@1", "layer": "main", "order": "a0", "params": {
                "center": [100, 50], "r": 40,
                "paint": {"fill": {"role": "ink"}, "shade": {"kind": "crescent", "role": "ink", "offset": 8, "light": 180,
                    "highlight": {"role": "ground", "offset": 10}}}}},
        }));
        let f = draw(&doc).unwrap();
        let verbs_of = |item: &str| -> Vec<Verb> {
            f.layers[0]
                .marks
                .iter()
                .find_map(|m| match &m.mark {
                    Mark::Shape { item: i, verbs, .. } if i == item => Some(verbs.clone()),
                    _ => None,
                })
                .unwrap_or_else(|| panic!("{item} is drawn"))
        };
        let (shade, highlight) = (verbs_of("ball#shade"), verbs_of("ball#highlight"));
        let (far, near, middle) = ([136.0, 50.0], [64.0, 50.0], [100.0, 50.0]);
        assert_ne!(winding(&shade, far), 0, "the shade covers the far side");
        assert_eq!(winding(&shade, near), 0, "the shade leaves the near side");
        assert_eq!(winding(&shade, middle), 0, "the shade leaves the middle");
        assert_ne!(
            winding(&highlight, near),
            0,
            "the highlight covers the near side"
        );
        assert_eq!(
            winding(&highlight, far),
            0,
            "the highlight leaves the far side"
        );
        assert_eq!(
            winding(&highlight, middle),
            0,
            "the highlight leaves the middle"
        );
    }

    #[test]
    fn marks_draw_by_z_then_by_the_tree_not_by_flat_order_keys() {
        // #160: a group's child draws with its group, after an earlier top-level item, whatever
        // its own order key says; a z above lifts it over everything in the layer.
        let doc = |z: f64| {
            board(json!({
                "r": {"kind": "rect@1", "layer": "main", "order": "a3", "params": {"box": [0, 0, 10, 10], "paint": {"fill": {"role": "ink"}}}},
                "g": {"kind": "group@1", "layer": "main", "order": "a5", "params": {}},
                "c": {"kind": "rect@1", "layer": "main", "order": "a0", "parent": "g", "params": {"box": [5, 5, 10, 10], "z": z, "paint": {"fill": {"role": "ink"}}}},
                "d": {"kind": "rect@1", "layer": "main", "order": "a1", "params": {"box": [50, 50, 10, 10], "z": -1, "paint": {"fill": {"role": "ink"}}}},
            }))
        };
        let order = |z: f64| -> Vec<String> {
            draw(&doc(z)).unwrap().layers[0]
                .marks
                .iter()
                .map(|m| m.mark.item().to_string())
                .collect()
        };
        assert_eq!(order(0.0), ["d", "r", "c"]);
        assert_eq!(order(1.0), ["d", "r", "c"]);
        let mut below = doc(0.0);
        below["items"]["r"]["params"]["z"] = json!(2);
        let marks: Vec<String> = draw(&below).unwrap().layers[0]
            .marks
            .iter()
            .map(|m| m.mark.item().to_string())
            .collect();
        assert_eq!(marks, ["d", "c", "r"]);
    }
}
