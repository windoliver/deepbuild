//! Issue #390: the canvas's text where GPUI draws a 2D writer layer. A label is shaped once by
//! the canvas's own shaper (deep-text), its glyphs rasterized into the canvas's atlas by Vello
//! CPU, and drawn through the GPUI patch's tinted mask sprite: one alpha page, a color per
//! instance. Nothing here calls GPUI's text system, so a label's pixels don't depend on the
//! user's font-smoothing setting (canvas primitives: Text `text@1`, Semantics). Issue #1479: a
//! glyph above [`OUTLINE_ABOVE`] device px draws as a GPUI path from its outline instead, its
//! triangles cached by content key and zoom bucket, so large text never leaves the atlas a page
//! of one glyph and never vanishes past the atlas's limit.

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
    ops::Range,
    sync::Arc,
};

use deep_canvas_marks::path::{self, Verb};
use deep_text::outlines::{outline_of, Cmd};
use deep_text::{Align, Atlas, Glyph, Placed, Shaper, Span, Spec, MAX_DEVICE_SIZE, PAGE, PHASES};
pub use deep_text::{Role, Shaped};
use gpui_kit::*;

/// The atlas number GPUI knows this atlas's pages under.
const ATLAS: u32 = 0;

/// Device px a em above which a glyph draws as a path from its outline, never from the atlas
/// (canvas primitives: Text `text@1`, Cost: "glyphs above about 64 px draw as paths"; at 256 px
/// one glyph would take about 64 KB of a 1 MB page).
pub const OUTLINE_ABOVE: f32 = 64.;

/// The most glyph tessellations kept; the cache empties whole past it, as the shaped runs do.
const OUTLINES: usize = 4_096;

/// A Text item's fields a label needs (canvas primitives: Text `text@1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub text: String,
    /// The bundled family its font names (#417: the look's face for its font role).
    pub family: &'static str,
    /// #417: the look's fallback families, in order.
    pub fallback: Vec<&'static str>,
    /// #417: the language it's shaped in (BCP 47).
    pub lang: Option<String>,
    pub size: f32,
    pub weight: u16,
    pub width: Option<f32>,
    pub max_lines: Option<u16>,
    /// `overflow: mask`: drawn whole for a clip to cut, never with an ellipsis.
    pub mask: bool,
    pub align: Align,
    /// A bound value or counter: tabular figures, never cut short.
    pub bound: bool,
    /// #1964: text@1 `runs`' styled spans of the one shaped run.
    pub spans: Vec<Span>,
}

impl Label {
    pub fn new(text: impl Into<String>) -> Self {
        Label {
            text: text.into(),
            family: Role::Body.family(),
            fallback: Vec::new(),
            lang: None,
            size: 13.,
            weight: 400,
            width: None,
            max_lines: None,
            mask: false,
            align: Align::Start,
            bound: false,
            spans: Vec::new(),
        }
    }

    fn spec(&self) -> Spec<'_> {
        Spec {
            text: &self.text,
            family: self.family,
            fallback: &self.fallback,
            lang: self.lang.as_deref(),
            size: self.size,
            weight: self.weight,
            line_height: None,
            width: self.width,
            max_lines: self.max_lines,
            align: self.align,
            bound: self.bound,
            tabular: self.bound,
            mask: self.mask,
            spans: &self.spans,
        }
    }
}

/// What a label is shaped by: `text@1`'s (text, font, size, features, width) and the line limit.
#[derive(Clone, PartialEq, Eq, Hash)]
struct ShapeKey {
    text: String,
    family: &'static str,
    fallback: Vec<&'static str>,
    lang: Option<String>,
    size: u32,
    weight: u16,
    width: Option<u32>,
    max_lines: Option<u16>,
    mask: bool,
    align: u8,
    bound: bool,
    spans: Vec<Span>,
}

impl ShapeKey {
    fn of(label: &Label) -> Self {
        ShapeKey {
            text: label.text.clone(),
            family: label.family,
            fallback: label.fallback.clone(),
            lang: label.lang.clone(),
            size: label.size.to_bits(),
            weight: label.weight,
            width: label.width.map(f32::to_bits),
            max_lines: label.max_lines,
            mask: label.mask,
            align: label.align as u8,
            bound: label.bound,
            spans: label.spans.clone(),
        }
    }
}

/// What one paint of a label did, for the tests that read the draw path.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Painted {
    /// Sprites drawn: one per visible glyph.
    pub sprites: usize,
    /// The atlas pages the sprites drew from, in first-use order, each with its sprite count.
    pub pages: Vec<(u32, usize)>,
    /// Glyphs the atlas rasterized during this paint (none once the label is warm).
    pub rasterized: u64,
    /// Pages this paint handed GPUI at a generation the window didn't hold (none when every
    /// label was prepared before the frame's first paint, or once the pages are warm).
    pub uploaded: usize,
    /// Atlas bytes this paint handed this window's GPUI atlas (#1480): a rect counts its own
    /// bytes, a whole page [`PAGE`]².
    pub upload_bytes: usize,
    /// The rects (page, x, y, w, h) it wrote into pages the window already held.
    pub upload_rects: Vec<(u32, [u32; 4])>,
    /// Whole-page uploads: a page at a new generation, or one the window fell behind on.
    pub upload_whole_pages: usize,
}

/// What a window holds of one atlas page (#1480).
struct Held {
    generation: u32,
    /// The page's rects this window has read up to ([`deep_text::Page::written`]).
    read: u64,
    /// The generation the page is uploaded under: the page's own, except in the planted
    /// whole-page path.
    key: u32,
}

/// A glyph's tessellation: its face, glyph, size in u and variation coordinates, and the zoom
/// bucket its curves are flattened for (#1479: cached like any shape).
#[derive(Clone, PartialEq, Eq, Hash)]
struct OutlineKey {
    blob: u64,
    index: u32,
    glyph: u32,
    size: u32,
    coords: Arc<[i16]>,
    skew: u32,
    bucket: i32,
}

/// A glyph's triangles: each corner's position in u about the pen position, then GPUI's curve
/// coordinates `(s, t)` for it.
type Triangles = Arc<[[[f32; 4]; 3]]>;

/// One glyph as a label draws it.
enum Shown {
    /// From an atlas page: its place, its top-left corner in device px and the scale it's drawn
    /// at (1 at its own size; above 1 for a glyph with no outline, from the largest raster).
    Sprite {
        place: Placed,
        at: [f32; 2],
        k: f32,
        grapheme: usize,
    },
    /// As a path: its triangles in u about its pen position, and that position in u.
    Path {
        triangles: Triangles,
        pen: [f32; 2],
        grapheme: usize,
    },
}

/// How far a glyph's edge band reaches past its edge and inside it, in device px at its bucket's
/// scale: a pixel whose centre lies within half a pixel of the edge takes its coverage from the
/// band, and its corners reach √½ px past that, so the band covers every such pixel whole and
/// MSAA never cuts its coverage (as deep-marks-gpui's stroke strip does).
const FRINGE_PX: f64 = 1.25;
/// Curves flattened within this many device px at the bucket's scale.
const FLAT_PX: f64 = 0.02;
/// `s` over `t` in a band's curve coordinates: GPUI's path shader takes a triangle whose `s`
/// doesn't vary as solid, and `s²` stays a negligible part of the implicit `s² − t`.
const S_PER_T: f64 = 0.05;
/// A corner whose offset point would lie farther than this many band widths from it is beveled.
const MITER: f64 = 4.;

type P = [f64; 2];

fn sub(a: P, b: P) -> P {
    [a[0] - b[0], a[1] - b[1]]
}
fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}
fn along(p: P, d: P, k: f64) -> P {
    [p[0] + d[0] * k, p[1] + d[1] * k]
}
fn unit(d: P) -> Option<P> {
    let l = dot(d, d).sqrt();
    (l > 1e-9).then(|| [d[0] / l, d[1] / l])
}

/// The outline's contours as closed rings of points, its curves flattened within `tol` u as any
/// path's are (deep-canvas-marks' `path::flatten`); a glyph's open contour closes, as a fill does.
fn rings(cmds: &[Cmd], tol: f64) -> Vec<Vec<P>> {
    let verbs: Vec<Verb> = cmds
        .iter()
        .map(|c| match *c {
            Cmd::Move(p) => Verb::Move(p),
            Cmd::Line(p) => Verb::Line(p),
            Cmd::Quad(c, p) => Verb::Quad(c, p),
            Cmd::Cubic(c0, c1, p) => Verb::Cubic(c0, c1, p),
            Cmd::Close => Verb::Close,
        })
        .collect();
    let mut rings: Vec<Vec<P>> = path::flatten(&verbs, tol)
        .into_iter()
        .map(|line| line.points)
        .collect();
    for ring in &mut rings {
        while ring.len() > 1 && ring.first() == ring.last() {
            ring.pop();
        }
    }
    rings.retain(|ring| ring.len() > 2);
    rings
}

/// A triangle's corners with their signed distance inside the edge, in u.
fn band(out: &mut Vec<[[f32; 4]; 3]>, corners: [(P, f64); 3]) {
    out.push(corners.map(|(p, t)| [p[0] as f32, p[1] as f32, (S_PER_T * t) as f32, t as f32]));
}

/// A glyph's outline as triangles in u about its pen position, with GPUI's curve coordinates, so
/// its edges take analytic coverage as Vello CPU's do: every edge gets a band reaching
/// [`FRINGE_PX`] device px to each side of it, each corner carrying its distance inside the edge,
/// and the outline shrunk by that much fills solid (nonzero) between the bands. Curves are
/// flattened within [`FLAT_PX`] device px, all at the bucket's scale. A glyph whose bands cross
/// at a corner fills its outline whole, edges by GPUI's MSAA. Empty for a blank glyph; `None` for
/// one its face holds no outline for.
fn tessellate(glyph: &Glyph, bucket: i32) -> Option<Vec<[[f32; 4]; 3]>> {
    let cmds = outline_of(glyph)?;
    let u_per_px = 1. / 2f64.powi(bucket);
    let rings = rings(&cmds, FLAT_PX * u_per_px);
    if rings.is_empty() {
        return Some(Vec::new());
    }
    let w = FRINGE_PX * u_per_px;
    // The side the inside lies on: outer contours run clockwise in TrueType and the other way in
    // CFF, so the glyph's whole signed area says which, for holes too.
    let area: f64 = rings
        .iter()
        .flat_map(|r| (0..r.len()).map(|i| (r[i], r[(i + 1) % r.len()])))
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum();
    let inward = if area > 0. { 1. } else { -1. };
    let mut out = Vec::new();
    let mut shrunk: Vec<Vec<P>> = Vec::with_capacity(rings.len());
    let mut whole = false;
    'rings: for ring in &rings {
        let n = ring.len();
        let dirs: Vec<P> = (0..n)
            .map(|i| unit(sub(ring[(i + 1) % n], ring[i])).unwrap_or([1., 0.]))
            .collect();
        let normal = |i: usize| [-dirs[i][1] * inward, dirs[i][0] * inward];
        let lens: Vec<f64> = (0..n)
            .map(|i| {
                dot(
                    sub(ring[(i + 1) % n], ring[i]),
                    sub(ring[(i + 1) % n], ring[i]),
                )
                .sqrt()
            })
            .collect();
        let mut inner = Vec::with_capacity(n);
        // Per vertex and side (inside, then outside): where the band of the segment before it
        // ends, where the next one's starts, and the beveled corner's points between.
        let mut ends: Vec<[(P, P); 2]> = Vec::with_capacity(n);
        for (j, &p) in ring.iter().enumerate() {
            let (prev, next) = ((j + n - 1) % n, j);
            let mut sides = [(p, p); 2];
            for (k, side) in [1., -1.].into_iter().enumerate() {
                let (a, b) = (normal(prev), normal(next));
                let (a, b) = ([a[0] * side, a[1] * side], [b[0] * side, b[1] * side]);
                let Some(m) = unit([a[0] + b[0], a[1] + b[1]]) else {
                    whole = true;
                    break 'rings;
                };
                let cos = dot(m, a);
                // The side is inside the turn when the next segment heads toward it.
                let inside_turn = dot(dirs[next], a) > 0.;
                // Inside a turn the miter cuts each neighbour's band short by its reach along it,
                // which must leave the band of a short segment room at its other end too.
                let reach = w * (1. / (cos * cos) - 1.).max(0.).sqrt();
                let fits = !inside_turn || reach <= 0.5 * lens[prev].min(lens[next]);
                if 1. / cos <= MITER && fits {
                    let q = along(p, m, w / cos);
                    sides[k] = (q, q);
                    if k == 0 {
                        inner.push(q);
                    }
                } else if inside_turn {
                    // A sharp corner's miter would reach past a short neighbour: the two bands
                    // end square at the corner instead, overlapping within a band of it.
                    let (e1, e2) = (along(p, a, w), along(p, b, w));
                    sides[k] = (e1, e2);
                    if k == 0 {
                        inner.extend([e1, e2]);
                    }
                } else {
                    let (e1, c, e2) = (along(p, a, w), along(p, m, w), along(p, b, w));
                    let t = |q: P, seg: usize| dot(sub(q, p), normal(seg));
                    band(&mut out, [(p, 0.), (e1, t(e1, prev)), (c, t(c, prev))]);
                    band(&mut out, [(p, 0.), (c, t(c, next)), (e2, t(e2, next))]);
                    sides[k] = (e1, e2);
                    if k == 0 {
                        inner.extend([e1, c, e2]);
                    }
                }
            }
            ends.push(sides);
        }
        for i in 0..n {
            let (a, b) = (ring[i], ring[(i + 1) % n]);
            let t = |q: P| dot(sub(q, a), normal(i));
            for (start, end) in ends[i].iter().zip(&ends[(i + 1) % n]) {
                let (q0, q1) = (start.1, end.0);
                // A band shorter than the corners it ends at would fold over its neighbour's.
                if dot(sub(q1, q0), dirs[i]) < 0. {
                    whole = true;
                    break 'rings;
                }
                band(&mut out, [(a, 0.), (b, 0.), (q1, t(q1))]);
                band(&mut out, [(a, 0.), (q1, t(q1)), (q0, t(q0))]);
            }
        }
        shrunk.push(inner);
    }
    let fill = |rings: &[Vec<P>]| -> Option<Vec<[[f32; 4]; 3]>> {
        let mut builder = PathBuilder::fill().with_style(PathStyle::Fill(
            FillOptions::default().with_fill_rule(FillRule::NonZero),
        ));
        for ring in rings {
            let points: Vec<Point<Pixels>> = ring
                .iter()
                .map(|q| point(px(q[0] as f32), px(q[1] as f32)))
                .collect();
            builder.add_polygon(&points, true);
        }
        let path = builder.build().ok()?;
        let corner = |v: &PathVertex<Pixels>| {
            [
                f32::from(v.xy_position.x),
                f32::from(v.xy_position.y),
                0.,
                1.,
            ]
        };
        Some(
            path.vertices
                .as_chunks::<3>()
                .0
                .iter()
                .map(|t| [corner(&t[0]), corner(&t[1]), corner(&t[2])])
                .collect(),
        )
    };
    if whole {
        return fill(&rings);
    }
    out.extend(fill(&shrunk)?);
    Some(out)
}

struct Text {
    shaper: Shaper,
    atlas: Atlas,
    shaped: HashMap<ShapeKey, Arc<Shaped>>,
    /// #1479: glyph tessellations; `None` for a glyph its face holds no outline for.
    outlines: HashMap<OutlineKey, Option<Triangles>>,
    /// #1479: glyphs above [`OUTLINE_ABOVE`] device px drawn from the atlas's largest raster,
    /// since their face holds no outline.
    from_largest: u64,
    /// The runs the frame since [`begin_frame`] drew from, each once; `None` until a caller
    /// starts counting, so an app that never asks keeps no set of every text it ever shaped.
    frame: Option<HashSet<ShapeKey>>,
    /// Per window (each has its own sprite atlas), the generation of each page it holds, so a
    /// changed page is uploaded again, once, and the page it replaces is let go.
    uploaded: HashMap<WindowId, HashMap<u32, Held>>,
    /// The (w, h) of each glyph rasterized since [`take_new_glyphs`], while watched.
    new_glyphs: Option<Vec<(u32, u32)>>,
    /// The planted pre-#1480 path: see [`plant_whole_page_upload`].
    whole_page: bool,
}

impl Text {
    fn new() -> Self {
        Text {
            shaper: Shaper::new(),
            atlas: Atlas::new(),
            shaped: HashMap::new(),
            outlines: HashMap::new(),
            from_largest: 0,
            frame: None,
            uploaded: HashMap::new(),
            new_glyphs: None,
            whole_page: false,
        }
    }

    /// The label's shape, from the cache: a label is shaped once, never per frame. The cache is
    /// emptied whole at 4,096 runs, so a frame of more than that shapes some of them again.
    fn shape(&mut self, label: &Label) -> Arc<Shaped> {
        let key = ShapeKey::of(label);
        if let Some(frame) = &mut self.frame {
            if !frame.contains(&key) {
                frame.insert(key.clone());
            }
        }
        if let Some(shaped) = self.shaped.get(&key) {
            return shaped.clone();
        }
        if self.shaped.len() >= 4_096 {
            self.shaped.clear();
        }
        let shaped = self.shaper.shape(&label.spec());
        self.shaped.insert(key, shaped.clone());
        shaped
    }

    /// The glyph's triangles at `scale`'s bucket, tessellated on first sight; `None` for a glyph
    /// its face holds no outline for.
    fn outline(&mut self, glyph: &Glyph, scale: f32) -> Option<Triangles> {
        let key = OutlineKey {
            blob: glyph.font.data.id(),
            index: glyph.font.index,
            glyph: glyph.id,
            size: glyph.size.to_bits(),
            coords: glyph.coords.clone(),
            skew: glyph.skew.to_bits(),
            bucket: path::bucket(f64::from(scale)),
        };
        if let Some(found) = self.outlines.get(&key) {
            return found.clone();
        }
        if self.outlines.len() >= OUTLINES {
            self.outlines.clear();
        }
        let made: Option<Triangles> = tessellate(glyph, key.bucket).map(Into::into);
        self.outlines.insert(key, made.clone());
        made
    }

    /// The label's glyphs at `scale` for a label whose top-left corner is at `origin` device px.
    /// A glyph up to [`OUTLINE_ABOVE`] device px is placed in the atlas, rasterized on first sight
    /// at its pen position's sub-pixel phase; one above it is a path from its outline (#1479), or,
    /// with no outline, the atlas's largest raster scaled up. A label that fills the atlas starts
    /// it over and is placed whole on the fresh pages (the labels before it keep the pages GPUI
    /// holds until the next frame; the labels after it place again); only a blank glyph, or one of
    /// a label too large for an empty atlas, is left out.
    fn place(&mut self, label: &Label, origin: [f32; 2], scale: f32) -> Vec<Shown> {
        self.atlas.make_room();
        let shaped = self.shape(label);
        let mut restarted = false;
        'whole: loop {
            let mut shown = Vec::with_capacity(shaped.glyphs.len());
            for glyph in &shaped.glyphs {
                let device = glyph.size * scale;
                let at = [origin[0] + glyph.x * scale, origin[1] + glyph.y * scale];
                let grapheme = glyph.grapheme;
                let before = self.atlas.rasterized();
                let placed = if device > OUTLINE_ABOVE {
                    if let Some(triangles) = self.outline(glyph, scale) {
                        if !triangles.is_empty() {
                            shown.push(Shown::Path {
                                triangles,
                                pen: [at[0] / scale, at[1] / scale],
                                grapheme,
                            });
                        }
                        continue;
                    }
                    let k = device / MAX_DEVICE_SIZE;
                    self.atlas
                        .glyph(&glyph.font, glyph.id, MAX_DEVICE_SIZE)
                        .map(|place| Shown::Sprite {
                            place,
                            at: [at[0] + place.left as f32 * k, at[1] + place.top as f32 * k],
                            k,
                            grapheme,
                        })
                } else {
                    let (x, px) = pen(at[0]);
                    let (y, py) = pen(at[1]);
                    self.atlas
                        .glyph_at(&glyph.font, glyph.id, device, [px, py], glyph.skew)
                        .map(|place| Shown::Sprite {
                            place,
                            at: [(x + place.left) as f32, (y + place.top) as f32],
                            k: 1.,
                            grapheme,
                        })
                };
                if let (Some(Shown::Sprite { place, .. }), Some(log)) =
                    (&placed, &mut self.new_glyphs)
                {
                    if self.atlas.rasterized() > before {
                        log.push((place.w, place.h));
                    }
                }
                match placed {
                    Some(placed) => shown.push(placed),
                    None if !restarted && self.atlas.make_room() => {
                        restarted = true;
                        continue 'whole;
                    }
                    None => {}
                }
            }
            return shown;
        }
    }
}

/// A pen position in device px as its whole pixel and its phase in 1/[`PHASES`] px, rounded to
/// the nearest phase (#140: a run lands where Vello CPU draws it, never snapped to a whole pixel).
fn pen(at: f32) -> (i32, u8) {
    let steps = (at * f32::from(PHASES)).round() as i32;
    let whole = steps.div_euclid(i32::from(PHASES));
    (whole, (steps - whole * i32::from(PHASES)) as u8)
}

thread_local! {
    static TEXT: RefCell<Text> = RefCell::new(Text::new());
}

/// The label's shaped run, shaped on first sight and reused after.
pub fn shape(label: &Label) -> Arc<Shaped> {
    TEXT.with(|text| text.borrow_mut().shape(label))
}

/// Starts, or stops, recording the bitmap size of each glyph the atlas rasterizes, for the proof
/// binary's report; [`take_new_glyphs`] drains it.
pub fn watch_new_glyphs(on: bool) {
    TEXT.with(|text| text.borrow_mut().new_glyphs = on.then(Vec::new));
}

/// The (w, h) of the glyphs rasterized since the last call, while watched.
pub fn take_new_glyphs() -> Vec<(u32, u32)> {
    TEXT.with(|text| {
        text.borrow_mut()
            .new_glyphs
            .as_mut()
            .map(std::mem::take)
            .unwrap_or_default()
    })
}

/// The planted twin of #1480: on, every changed page goes to every window whole under a new
/// generation, as before the rect path. Only the proof binary turns it on.
pub fn plant_whole_page_upload(on: bool) {
    TEXT.with(|text| text.borrow_mut().whole_page = on);
}

/// The size a label takes, for a layout that sizes to its text.
pub fn measure(label: &Label) -> Size<Pixels> {
    let shaped = shape(label);
    size(px(shaped.width.ceil()), px(shaped.height))
}

/// The fit check for a label against its widest string (the label's own text when `None`).
pub fn fit(label: &Label, widest: Option<&str>) -> deep_text::Fit {
    TEXT.with(|text| text.borrow_mut().shaper.fit(&label.spec(), widest))
}

/// How many glyphs this thread's atlas rasterized so far (#1479: a frame report counts the
/// difference across its frame).
pub fn rasterized() -> u64 {
    TEXT.with(|text| text.borrow().atlas.rasterized())
}

/// How many glyphs above [`OUTLINE_ABOVE`] device px this thread drew from the atlas's largest
/// raster, scaled, because their face holds no outline (#1479: a frame report says so).
pub fn from_largest() -> u64 {
    TEXT.with(|text| text.borrow().from_largest)
}

/// Starts counting the distinct runs a frame draws from; see [`frame_runs`].
pub fn begin_frame() {
    TEXT.with(|text| match &mut text.borrow_mut().frame {
        Some(frame) => frame.clear(),
        unwatched => *unwatched = Some(HashSet::new()),
    });
}

/// How many distinct runs the labels since [`begin_frame`] were shaped as: two labels with one
/// text, font, size and weight are one run.
pub fn frame_runs() -> usize {
    TEXT.with(|text| text.borrow().frame.as_ref().map_or(0, HashSet::len))
}

/// Lets GPUI drop a page it holds at the next frame, never in this one: sprites already queued
/// this frame, from an earlier label, may still draw from it.
fn retire(window: &mut Window, stale: RenderMaskParams) {
    window.on_next_frame(move |window, _| window.remove_mask_page(stale));
}

/// Places `label`'s glyphs in the atlas for a window at `scale`, before any label is painted:
/// call it from prepaint, so the frame's pages are final when its first paint uploads them, and
/// each page goes to GPUI once a frame however many labels added glyphs to it. It places them
/// for a label on a whole device pixel; [`prepare_at`] for one anywhere.
pub fn prepare(label: &Label, scale: f32) {
    prepare_at(point(px(0.), px(0.)), label, scale);
}

/// [`prepare`] for a label painted with its top-left corner at `origin`, whose glyphs' sub-pixel
/// phases it places (#140).
pub fn prepare_at(origin: Point<Pixels>, label: &Label, scale: f32) {
    TEXT.with(|text| {
        let at = [f32::from(origin.x) * scale, f32::from(origin.y) * scale];
        text.borrow_mut().place(label, at, scale);
    });
}

/// Paints `label` with its top-left corner at `origin`, in `color`, through the atlas.
pub fn paint_label(
    origin: Point<Pixels>,
    label: &Label,
    color: Hsla,
    window: &mut Window,
) -> Painted {
    paint_runs(origin, label, color, &[], window)
}

/// [`paint_label`], with the glyphs of each grapheme span of `runs` in that span's color
/// (text@1 `runs`: spans of the one shaped run, so nothing moves).
pub fn paint_runs(
    origin: Point<Pixels>,
    label: &Label,
    color: Hsla,
    runs: &[(Range<usize>, Hsla)],
    window: &mut Window,
) -> Painted {
    TEXT.with(|text| {
        let mut text = text.borrow_mut();
        let scale = window.scale_factor();
        let before = text.atlas.rasterized();
        // Every glyph placed first, so the label's pages are final before any is uploaded.
        let at = [f32::from(origin.x) * scale, f32::from(origin.y) * scale];
        let shown = text.place(label, at, scale);
        let decorations = text.shape(label).decorations.clone();
        let Text {
            atlas,
            uploaded,
            from_largest,
            whole_page,
            ..
        } = &mut *text;
        let mut painted = Painted {
            rasterized: atlas.rasterized() - before,
            ..Painted::default()
        };
        let color_of = |grapheme: usize| {
            runs.iter()
                .find(|(span, _)| span.contains(&grapheme))
                .map_or(color, |(_, c)| *c)
        };
        // Pages this window holds that the atlas no longer has, at that generation or at all, go
        // once this frame is drawn.
        let held = uploaded
            .entry(window.window_handle().window_id())
            .or_default();
        held.retain(|&page, h| {
            let current = atlas
                .pages()
                .get(page as usize)
                .is_some_and(|current| current.generation() == h.generation);
            if !current {
                retire(
                    window,
                    RenderMaskParams {
                        atlas: ATLAS,
                        page,
                        generation: h.key,
                    },
                );
            }
            current
        });
        // Each page this paint draws from is brought up to what the atlas has, once: new rects
        // only, or the whole page for a window that fell behind (#1480).
        let mut synced: Vec<u32> = Vec::new();
        let sprites = shown.iter().filter_map(|shown| match shown {
            Shown::Sprite { place, .. } => Some(place),
            Shown::Path { .. } => None,
        });
        for place in sprites {
            if synced.contains(&place.page) {
                continue;
            }
            synced.push(place.page);
            let page = &atlas.pages()[place.page as usize];
            let (generation, written) = (page.generation(), page.written());
            let mut params = RenderMaskParams {
                atlas: ATLAS,
                page: place.page,
                generation,
            };
            let whole = |painted: &mut Painted| {
                painted.upload_bytes += (PAGE * PAGE) as usize;
                painted.upload_whole_pages += 1;
            };
            match held.get(&place.page) {
                Some(h) if h.read == written => continue,
                Some(h) if !*whole_page => {
                    params.generation = h.key;
                    let rects: Option<Vec<_>> = page.changed_since(h.read).map(Iterator::collect);
                    let all = deep_text::Rect {
                        x: 0,
                        y: 0,
                        w: PAGE,
                        h: PAGE,
                    };
                    let todo = rects.as_deref().unwrap_or(std::slice::from_ref(&all));
                    let ok = todo.iter().all(|r| {
                        window.write_mask_rect(
                            params.clone(),
                            device_rect(r),
                            page.bytes(),
                            PAGE as usize,
                        )
                    });
                    if ok {
                        if rects.is_some() {
                            for r in todo {
                                painted.upload_bytes += (r.w * r.h) as usize;
                                painted
                                    .upload_rects
                                    .push((place.page, [r.x, r.y, r.w, r.h]));
                            }
                        } else {
                            whole(&mut painted);
                        }
                        held.get_mut(&place.page).expect("held").read = written;
                        continue;
                    }
                    // The window's atlas can't write a rect, or lost the page: the sprite below
                    // uploads it whole.
                    window.remove_mask_page(params.clone());
                }
                Some(h) => retire(
                    window,
                    RenderMaskParams {
                        generation: h.key,
                        ..params.clone()
                    },
                ),
                None => {}
            }
            // A page at a new generation, or the planted path's every change: whole, once, by the
            // first sprite drawn from it.
            params.generation = if *whole_page {
                generation
                    .wrapping_mul(1 << 16)
                    .wrapping_add(written as u32)
            } else {
                generation
            };
            whole(&mut painted);
            painted.uploaded += 1;
            held.insert(
                place.page,
                Held {
                    generation,
                    read: written,
                    key: params.generation,
                },
            );
        }
        for glyph in shown {
            let (place, at, k, grapheme) = match glyph {
                Shown::Path {
                    triangles,
                    pen,
                    grapheme,
                } => {
                    let p = |v: [f32; 4]| point(px(v[0] + pen[0]), px(v[1] + pen[1]));
                    let st = |v: [f32; 4]| point(v[2], v[3]);
                    let mut path = Path::new(p(triangles[0][0]));
                    for t in triangles.iter() {
                        path.push_triangle(
                            (p(t[0]), p(t[1]), p(t[2])),
                            (st(t[0]), st(t[1]), st(t[2])),
                        );
                    }
                    // GPUI composites a path's MSAA target over its bounds, which cover only the
                    // pixels whose centres lie inside them: a device pixel more on every side
                    // keeps an edge pixel's partial coverage instead of dropping it.
                    path.bounds = path.bounds.dilate(px(1. / scale));
                    window.paint_path(path, color_of(grapheme));
                    continue;
                }
                Shown::Sprite {
                    place,
                    at,
                    k,
                    grapheme,
                } => (place, at, k, grapheme),
            };
            if k != 1. {
                *from_largest += 1;
            }
            let page = &atlas.pages()[place.page as usize];
            let params = RenderMaskParams {
                atlas: ATLAS,
                page: place.page,
                generation: held[&place.page].key,
            };
            let bounds = Bounds {
                origin: point(px(at[0] / scale), px(at[1] / scale)),
                size: size(
                    px(place.w as f32 * k / scale),
                    px(place.h as f32 * k / scale),
                ),
            };
            let region = Bounds {
                origin: point(DevicePixels(place.x as i32), DevicePixels(place.y as i32)),
                size: size(DevicePixels(place.w as i32), DevicePixels(place.h as i32)),
            };
            let drawn =
                window.paint_mask_sprite(bounds, params, region, color_of(grapheme), &mut || {
                    (
                        size(DevicePixels(PAGE as i32), DevicePixels(PAGE as i32)),
                        page.bytes().to_vec(),
                    )
                });
            if drawn.is_ok() {
                painted.sprites += 1;
                match painted
                    .pages
                    .iter_mut()
                    .find(|(page, _)| *page == place.page)
                {
                    Some((_, count)) => *count += 1,
                    None => painted.pages.push((place.page, 1)),
                }
            }
        }
        // #1964: underlines and strikes over the glyphs, in their span's color.
        for d in decorations {
            let [x, y, w, h] = d.rect;
            let bounds = Bounds {
                origin: point(origin.x + px(x), origin.y + px(y)),
                size: size(px(w), px(h)),
            };
            window.paint_quad(gpui_kit::fill(bounds, color_of(d.grapheme)));
        }
        painted
    })
}

fn device_rect(r: &deep_text::Rect) -> Bounds<DevicePixels> {
    Bounds {
        origin: point(DevicePixels(r.x as i32), DevicePixels(r.y as i32)),
        size: size(DevicePixels(r.w as i32), DevicePixels(r.h as i32)),
    }
}
