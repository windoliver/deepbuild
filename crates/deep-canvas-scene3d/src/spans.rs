//! Hidden-line spans (issue #1782; canvas primitives: Marks in 3D: mesh edges): each picked edge
//! of a mesh-edge line with a `hidden` style, split at every point where opaque geometry starts
//! or stops hiding it from the camera. Worked in f64 on evaluated data, never read from the depth
//! target: the rays from the camera to an edge sweep a flat fan, the geometry audit's BVH
//! ([`crate::deviation`]) finds the triangles that reach it, and each one hides the stretch its
//! cut through the fan casts on the edge. Glass, blended and additive solids never hide an edge
//! and a cutaway in effect cuts the solids it reaches, as camera.framing's occluded share reads
//! them (#457); the faces an edge bounds never hide it.

use std::sync::Arc;

use crate::deviation::Bvh;
use crate::geom::{add, cross, dot, length, scale, sub, V3};
use crate::scene::{apply, Camera, EdgesOf, Hidden, Line, Scene, Shape, Solid};

/// One stretch of a picked edge: the edge's rank in its line's set, where the stretch starts and
/// ends in m along the edge from its start, and whether opaque geometry hides it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Span {
    pub edge: u32,
    pub from: f64,
    pub to: f64,
    pub hidden: bool,
}

/// How near the camera's side of an edge a surface may come and still hide it, as a share of the
/// way from the camera: a surface the edge lies on never does.
const HAIR: f64 = 1e-9;

/// The solids that may hide an edge, as triangles in the world.
struct Occluders<'a> {
    bvh: Bvh,
    /// Whether the cutaway in effect reaches each triangle's solid.
    cut: Vec<bool>,
    cutaway: Option<&'a crate::cut::Cutaway>,
}

/// The part of the range `at` of a stretch where `g`, linear from `g0` at its start to `g1` at
/// its end, is at least 0.
fn keep(at: &mut (f64, f64), g0: f64, g1: f64) {
    if g0 < 0.0 && g1 < 0.0 {
        *at = (1.0, 0.0);
    } else if g0 < 0.0 {
        at.0 = at.0.max(g0 / (g0 - g1));
    } else if g1 < 0.0 {
        at.1 = at.1.min(g0 / (g0 - g1));
    }
}

impl<'a> Occluders<'a> {
    /// The scene's opaque solids, drawn in the frame passes; `glass` is the planted classifier
    /// that counts an item whose material transmits too.
    fn new(scene: &'a Scene, glass: bool) -> Occluders<'a> {
        let (mut tris, mut cut) = (Vec::new(), Vec::new());
        let cutaway = scene.cutaway.as_ref();
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            if s.cast_only || !(s.opaque() || (glass && transmits(s))) {
                continue;
            }
            let of = crate::shore::triangles(s);
            let reached = s.cut && cutaway.is_some_and(|c| c.reaches(&s.id));
            cut.extend(std::iter::repeat_n(reached, of.len()));
            tris.extend(of);
        }
        Occluders {
            bvh: Bvh::new(tris),
            cut,
            cutaway,
        }
    }

    /// The parts of the stretch from `q0` to `q1` on a triangle the cutaway keeps, as ranges of
    /// the way along it: all of it for a triangle the cutaway doesn't reach.
    fn kept(&self, t: usize, q0: V3, q1: V3) -> Vec<(f64, f64)> {
        let Some(c) = self.cutaway.filter(|_| self.cut[t]) else {
            return vec![(0.0, 1.0)];
        };
        // Past a plane is hidden: past any of them, or with `intersect` past all.
        let near = |(n, o): &(V3, f64)| (o - dot(*n, q0), o - dot(*n, q1));
        if c.intersect && !c.planes.is_empty() {
            return (c.planes.iter().map(near))
                .map(|(g0, g1)| {
                    let mut at = (0.0, 1.0);
                    keep(&mut at, g0, g1);
                    at
                })
                .collect();
        }
        let mut at = (0.0, 1.0);
        for (g0, g1) in c.planes.iter().map(near) {
            keep(&mut at, g0, g1);
        }
        vec![at]
    }

    /// The stretches of the edge from `a` to `b` that the occluders hide from `cam`, in m from
    /// `a`, in no order; `None` for an edge seen end on, whose rays sweep no fan. `flat` is the
    /// planted classifier that casts along the view from a perspective camera.
    fn hides(&self, cam: &Camera, flat: bool, [a, b]: [V3; 2]) -> Option<Vec<(f64, f64)>> {
        let len = length(sub(b, a));
        let perspective = cam.perspective && !flat;
        let back = scale(cam.forward, -1.0);
        // The fan's plane from `o`: a point of it is `o + x u + y v`. From the eye, x and y are
        // the shares of the rays to the edge's two ends; along the view, x is the share of the
        // edge and y the m toward the camera.
        let (o, u, v) = if perspective {
            (cam.eye, sub(a, cam.eye), sub(b, cam.eye))
        } else {
            (a, sub(b, a), back)
        };
        let (uu, uv, vv) = (dot(u, u), dot(u, v), dot(v, v));
        let det = uu * vv - uv * uv;
        if det <= 1e-20 * uu * vv {
            return None;
        }
        let n = cross(u, v);
        let place = |q: V3| {
            let q = sub(q, o);
            let (qu, qv) = (dot(q, u), dot(q, v));
            [(qu * vv - qv * uv) / det, (qv * uu - qu * uv) / det]
        };
        // Along the view, rays start 1 m behind the eye's plane, as the occluded share's do.
        let depth = |p: V3| dot(sub(p, cam.eye), cam.forward) + 1.0;
        let reach = depth(a).max(depth(b));
        let hair = HAIR * reach.max(1.0);
        // The box the fan lies in.
        let corners = if perspective {
            [cam.eye, a, b, b]
        } else {
            [a, b, add(a, scale(back, reach)), add(b, scale(back, reach))]
        };
        let lo: V3 =
            std::array::from_fn(|k| corners.iter().map(|c| c[k]).fold(f64::INFINITY, f64::min));
        let hi: V3 = std::array::from_fn(|k| {
            corners
                .iter()
                .map(|c| c[k])
                .fold(f64::NEG_INFINITY, f64::max)
        });
        let reaches = |min: V3, max: V3| {
            let (mut centre, mut radius) = (0.0, 0.0);
            for k in 0..3 {
                if max[k] < lo[k] || min[k] > hi[k] {
                    return false;
                }
                centre += n[k] * ((min[k] + max[k]) / 2.0 - o[k]);
                radius += n[k].abs() * (max[k] - min[k]) / 2.0;
            }
            centre.abs() <= radius
        };
        // A triangle with a corner at each end of the edge is one of the faces it bounds.
        let weld = 1e-6 * len.max(1.0);
        let at = |p: &V3, q: V3| dot(sub(*p, q), sub(*p, q)) <= weld * weld;
        let mut out = Vec::new();
        self.bvh.each_in(reaches, |t, tri| {
            if tri.iter().any(|p| at(p, a)) && tri.iter().any(|p| at(p, b)) {
                return;
            }
            // Where the triangle crosses the fan's plane: the two points its sides cross it at.
            let d = tri.map(|p| dot(n, sub(p, o)));
            let mut cut = Vec::with_capacity(2);
            for i in 0..3 {
                let j = (i + 1) % 3;
                if (d[i] < 0.0) != (d[j] < 0.0) {
                    cut.push(add(
                        tri[i],
                        scale(sub(tri[j], tri[i]), d[i] / (d[i] - d[j])),
                    ));
                }
            }
            let [q0, q1] = cut[..] else { return };
            let (p0, p1) = (place(q0), place(q1));
            for mut part in self.kept(t, q0, q1) {
                if perspective {
                    // Between the rays to the two ends, short of the edge by a hair.
                    keep(&mut part, p0[0], p1[0]);
                    keep(&mut part, p0[1], p1[1]);
                    keep(
                        &mut part,
                        1.0 - HAIR - p0[0] - p0[1],
                        1.0 - HAIR - p1[0] - p1[1],
                    );
                } else {
                    keep(&mut part, p0[0], p1[0]);
                    keep(&mut part, 1.0 - p0[0], 1.0 - p1[0]);
                    keep(&mut part, p0[1] - hair, p1[1] - hair);
                    keep(&mut part, depth(q0), depth(q1));
                }
                if part.0 > part.1 {
                    continue;
                }
                // The share of the edge the ray through a point of the cut ends at.
                let share = |w: f64| {
                    let (x, y) = (p0[0] + (p1[0] - p0[0]) * w, p0[1] + (p1[1] - p0[1]) * w);
                    match perspective {
                        true => (x + y > 0.0).then(|| y / (x + y)),
                        false => Some(x),
                    }
                };
                if let (Some(s0), Some(s1)) = (share(part.0), share(part.1)) {
                    out.push((s0.min(s1) * len, s0.max(s1) * len));
                }
            }
        });
        Some(out)
    }
}

/// The hidden stretches of an edge `len` m long as its spans read them: in order, joined where
/// they meet or lie within `tol` of each other, without the ones shorter than `tol`, and ending
/// at the edge's ends where they come within `tol` of them.
fn joined(mut hidden: Vec<(f64, f64)>, len: f64, tol: f64) -> Vec<(f64, f64)> {
    hidden.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut out: Vec<(f64, f64)> = Vec::new();
    for (from, to) in hidden {
        let (from, to) = (from.max(0.0), to.min(len));
        match out.last_mut() {
            Some(last) if from <= last.1 + tol => last.1 = last.1.max(to),
            _ if to >= from => out.push((from, to)),
            _ => {}
        }
    }
    out.retain(|(from, to)| to - from >= tol);
    for h in &mut out {
        if h.0 < tol {
            h.0 = 0.0;
        }
        if len - h.1 < tol {
            h.1 = len;
        }
    }
    out
}

/// #1782's planted wrong programs, each reachable only through `--planted`
/// (tests/acceptance/1782/README.md: Planted programs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// The classifier casts against no geometry.
    CastsNothing,
    /// The classifier tests an edge's two ends only and splits nowhere between them.
    EndsOnly,
    /// The classifier casts every ray along the view axis, under a perspective camera too.
    NoPerspective,
    /// A span's dashes are measured from the span's start.
    DashRestarts,
    /// The classifier counts an item whose material transmits as an occluder.
    CountsGlass,
    /// The kept spans' key leaves the camera out.
    CacheNoCamera,
    /// `edge` numbers the edges in the order the frame draws spans: the visible, then the hidden.
    IdFromDrawOrder,
}

/// #1782's planted names, each with the span program it runs; the first is the picker's
/// ([`crate::geom::PLANTED_SHARED`]), which changes the edge set and no span.
pub const PLANTED: [(&str, Option<Planted>); 8] = [
    (crate::geom::PLANTED_SHARED, None),
    ("edges_spans_cast_nothing", Some(Planted::CastsNothing)),
    ("edges_spans_ends_only", Some(Planted::EndsOnly)),
    ("edges_spans_no_perspective", Some(Planted::NoPerspective)),
    ("edges_dash_restarts_at_split", Some(Planted::DashRestarts)),
    ("edges_spans_count_glass", Some(Planted::CountsGlass)),
    ("edges_spans_cache_no_camera", Some(Planted::CacheNoCamera)),
    ("edges_id_from_draw_order", Some(Planted::IdFromDrawOrder)),
];

impl Planted {
    /// The span program `name` plants, if it names one.
    pub fn named(name: &str) -> Option<Planted> {
        PLANTED.iter().find(|p| p.0 == name)?.1
    }
}

/// Whether a solid's material transmits: glass, which hides nothing.
fn transmits(s: &Solid) -> bool {
    (s.material.as_ref()).is_some_and(|m| m.lobes.transmission > 0.0)
}

/// A line's picked edges by ID, each from its start to its end in the mesh's own space: on
/// welded positions an edge's start is the lesser of its two ends by x, then y, then z, and the
/// edges are ordered by start, then by end. An edge's ID is its rank in that order, so it
/// depends on the mesh alone.
fn ranked(edges: &EdgesOf) -> Vec<[V3; 2]> {
    let key = |p: &V3| p.map(|x| (x / 1e-6).round() as i64);
    let mut out: Vec<([[i64; 3]; 2], [V3; 2])> = (edges.list.iter())
        .map(|[a, b]| match (key(a), key(b)) {
            (ka, kb) if ka <= kb => ([ka, kb], [*a, *b]),
            (ka, kb) => ([kb, ka], [*b, *a]),
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out.into_iter().map(|(_, ends)| ends).collect()
}

/// A hidden-style line's edges in a view: each picked edge by ID, from its start to its end in
/// the world, and their spans in edge order and then `from` order.
#[derive(Clone, Debug, PartialEq)]
pub struct Spans {
    pub edges: Vec<[V3; 2]>,
    pub list: Vec<Span>,
}

/// The spans of each of `edges`' edges in `scene`'s view.
fn work(scene: &Scene, edges: &EdgesOf, planted: Option<Planted>) -> Spans {
    let cam = &scene.camera;
    let occluders = (planted != Some(Planted::CastsNothing))
        .then(|| Occluders::new(scene, planted == Some(Planted::CountsGlass)));
    let flat = planted == Some(Planted::NoPerspective);
    let world = |[a, b]: [V3; 2]| [apply(&edges.model, a), apply(&edges.model, b)];
    let ranked: Vec<[V3; 2]> = ranked(edges).into_iter().map(world).collect();
    let mut list = Vec::new();
    for (edge, ends) in ranked.iter().enumerate() {
        let len = length(sub(ends[1], ends[0]));
        // A stretch shorter than a millionth of the way to the camera is no stretch.
        let far = if cam.perspective {
            length(sub(ends[0], cam.eye)).max(length(sub(ends[1], cam.eye)))
        } else {
            1.0
        };
        let tol = 1e-6 * far.max(1.0);
        let found = occluders.as_ref().and_then(|o| o.hides(cam, flat, *ends));
        let mut hidden = joined(found.unwrap_or_default(), len, tol);
        if planted == Some(Planted::EndsOnly) {
            let at = |x: f64| hidden.iter().any(|(from, to)| *from <= x && x <= *to);
            hidden = match at(0.0) && at(len) {
                true => vec![(0.0, len)],
                false => Vec::new(),
            };
        }
        let edge = edge as u32;
        let span = |from: f64, to: f64, hidden: bool| Span {
            edge,
            from,
            to,
            hidden,
        };
        let mut seen = 0.0;
        for (from, to) in hidden {
            if from > seen {
                list.push(span(seen, from, false));
            }
            list.push(span(from, to, true));
            seen = to;
        }
        if seen < len {
            list.push(span(seen, len, false));
        }
    }
    Spans {
        edges: ranked,
        list,
    }
}

/// What `edges`' spans in `scene` depend on: the camera, the edges in the world, and each solid
/// that may hide them with its place and the cutaway that cuts it.
fn key(scene: &Scene, edges: &EdgesOf, planted: Option<Planted>) -> [u8; 16] {
    let mut f: Vec<f64> = Vec::new();
    let c = &scene.camera;
    if planted != Some(Planted::CacheNoCamera) {
        for v in [c.eye, c.target, c.right, c.up, c.forward] {
            f.extend(v);
        }
        f.extend([c.scale, c.near, c.far, f64::from(u8::from(c.perspective))]);
        f.extend(c.size.iter().chain(&c.centre).chain(&c.roll));
    }
    f.extend(edges.model.iter().flatten());
    f.extend(edges.list.iter().flatten().flatten());
    let mut h = deep_canvas::schedule::Hasher::new("scene3d.spans");
    h.int(planted.map_or(0, |p| p as i64 + 1));
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        if s.cast_only {
            continue;
        }
        let (shape, mesh) = match s.shape {
            Shape::Box => (0, 0),
            Shape::Cylinder => (1, 0),
            Shape::Sphere => (2, 0),
            Shape::Built(hash) => (3, hash),
        };
        let hides =
            i64::from(s.opaque()) | (i64::from(transmits(s)) << 1) | (i64::from(s.cut) << 2);
        h.int(shape | (hides << 2));
        h.bytes(&mesh.to_le_bytes());
        f.extend(s.model.iter().flatten());
    }
    if let Some(cut) = &scene.cutaway {
        h.int(i64::from(cut.intersect));
        for (n, o) in &cut.planes {
            f.extend(n);
            f.push(*o);
        }
    }
    let bytes: Vec<u8> = f.iter().flat_map(|x| x.to_le_bytes()).collect();
    h.bytes(&bytes);
    h.finish().0
}

/// The spans a caller holds from one frame to the next, by what they depend on: a renderer's, or
/// a run's that reports them. At most 256 lines' worth.
#[derive(Default)]
pub struct Kept(std::collections::BTreeMap<[u8; 16], Arc<Spans>>);

/// A mesh-edge line's spans in `scene`'s view (its camera, its solids and its cutaway as they
/// stand), and whether this call worked them out rather than finding them in `kept`, so a still
/// view works none out again. `None` for a line with no hidden style.
pub fn of(scene: &Scene, line: &Line, kept: &mut Kept) -> Option<(Arc<Spans>, bool)> {
    let edges = line.edges.as_ref()?;
    let planted = edges.hidden.as_ref()?.planted;
    let key = key(scene, edges, planted);
    if let Some(spans) = kept.0.get(&key) {
        return Some((spans.clone(), false));
    }
    let spans = Arc::new(work(scene, edges, planted));
    if kept.0.len() >= 256 {
        kept.0.clear();
    }
    kept.0.insert(key, spans.clone());
    Some((spans, true))
}

/// How far along its dash a point of an edge lies, in the dash's size space: the m along the
/// edge, or the px along its projection, which perspective spaces unevenly along the edge.
struct Ruler {
    len: f64,
    /// For a dash in px: the projection's length and the two ends' depths.
    px: Option<(f64, f64, f64)>,
}

impl Ruler {
    /// `None` where a dash in px can't be measured: an end behind the eye, or an edge end on.
    fn new(cam: &Camera, world: bool, [a, b]: [V3; 2]) -> Option<Ruler> {
        let len = length(sub(b, a));
        if world {
            return Some(Ruler { len, px: None });
        }
        let (pa, pb) = (cam.project(a)?, cam.project(b)?);
        let across = deep_canvas::ops::sqrt((pb[0] - pa[0]).powi(2) + (pb[1] - pa[1]).powi(2));
        let (wa, wb) = if cam.perspective {
            (pa[2], pb[2])
        } else {
            (1.0, 1.0)
        };
        (across > 0.0).then_some(Ruler {
            len,
            px: Some((across, wa, wb)),
        })
    }

    /// The dash's length at `s` m along the edge.
    fn at(&self, s: f64) -> f64 {
        match self.px {
            None => s,
            Some((across, wa, wb)) => {
                let k = s / self.len;
                across * k * wb / ((1.0 - k) * wa + k * wb)
            }
        }
    }

    /// The m along the edge where the dash's length is `x`.
    fn back(&self, x: f64) -> f64 {
        match self.px {
            None => x,
            Some((across, wa, wb)) => {
                let k = x / across;
                self.len * k * wa / (k * wa + (1.0 - k) * wb)
            }
        }
    }
}

/// A stretch of a dash shorter than this, in its size space, inks nothing.
const SLIVER: f64 = 1e-9;

/// A span's dash as its line draws it: the lengths, and where along the edge's dash the span
/// starts, ends and its dashes are measured from. A span's dashes are measured from its edge's
/// start in the line's size space, so a split never restarts them; the planted dash measures
/// them from the span's own start.
struct Dashed {
    ruler: Ruler,
    on: f64,
    period: f64,
    from: f64,
    to: f64,
    origin: f64,
}

impl Dashed {
    /// `None` for a style with no dash, or one whose dash can't be measured in this view.
    fn new(scene: &Scene, line: &Line, style: &Hidden, ends: [V3; 2], s: &Span) -> Option<Dashed> {
        let dash = if s.hidden { style.dash } else { line.dash };
        if !(dash[0] > 0.0 && dash[1] > 0.0) {
            return None;
        }
        let ruler = Ruler::new(&scene.camera, line.dash_world, ends)?;
        let (from, to) = (ruler.at(s.from), ruler.at(s.to));
        let origin = match style.planted {
            Some(Planted::DashRestarts) => from,
            _ => 0.0,
        };
        Some(Dashed {
            ruler,
            on: dash[0],
            period: dash[0] + dash[1],
            from,
            to,
            origin,
        })
    }

    /// The stretches of span `s` its dash inks, in m along the edge.
    fn inked(&self, s: &Span) -> Vec<(f64, f64)> {
        // A stretch's end at the span's own is the span's, to the digit.
        let at = |x: f64| match x {
            x if x == self.from => s.from,
            x if x == self.to => s.to,
            x => self.ruler.back(x),
        };
        let mut out = Vec::new();
        let mut k = ((self.from - self.origin) / self.period).floor();
        while self.origin + k * self.period < self.to - SLIVER {
            let lo = self.from.max(self.origin + k * self.period);
            let hi = self.to.min(self.origin + k * self.period + self.on);
            if hi - lo > SLIVER {
                out.push((at(lo), at(hi)));
            }
            k += 1.0;
        }
        out
    }
}

/// What a frame reports of a line with a hidden style: its spans, every stretch of it the frame
/// inks (a span's dashes, or the span itself for a style with no dash), and whether this call
/// worked the spans out.
pub struct Report {
    pub spans: Vec<Span>,
    pub dashes: Vec<Span>,
    pub computed: bool,
}

/// [`Report`] for `line` in `scene`'s view, its spans from `kept` where they hold; `None` for a
/// line with no hidden style.
pub fn report(scene: &Scene, line: &Line, kept: &mut Kept) -> Option<Report> {
    let (kept, computed) = of(scene, line, kept)?;
    let style = line.edges.as_ref()?.hidden.as_ref()?;
    let mut spans = kept.list.clone();
    let mut dashes = Vec::new();
    for s in &kept.list {
        let inked = match Dashed::new(scene, line, style, kept.edges[s.edge as usize], s) {
            Some(d) => d.inked(s),
            None => vec![(s.from, s.to)],
        };
        dashes.extend(inked.into_iter().map(|(from, to)| Span { from, to, ..*s }));
    }
    if style.planted == Some(Planted::IdFromDrawOrder) {
        let mut order: Vec<u32> = Vec::new();
        for hidden in [false, true] {
            for s in spans.iter().filter(|s| s.hidden == hidden) {
                if !order.contains(&s.edge) {
                    order.push(s.edge);
                }
            }
        }
        for s in spans.iter_mut().chain(&mut dashes) {
            s.edge = order.iter().position(|e| *e == s.edge).unwrap_or(0) as u32;
        }
    }
    Some(Report {
        spans,
        dashes,
        computed,
    })
}

/// One stretch of a line with a hidden style as it draws, between two points in the world.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Piece {
    pub a: V3,
    pub b: V3,
    /// It draws in the hidden style, over what hides it.
    pub hidden: bool,
    /// Its style's dash starts where it does; else it is one dash.
    pub dashed: bool,
    /// Its start, then its end, is cut square: every end but an edge's own.
    pub cut: [bool; 2],
}

/// A line with a hidden style as it draws in `scene`'s view: each span of each edge in its own
/// style, the visible ones in the line's. The dash a span starts inside draws to its end as a
/// piece of its own, and the rest of the span dashes from the next dash's start.
pub fn pieces(scene: &Scene, line: &Line, kept: &mut Kept) -> Option<Vec<Piece>> {
    let (kept, _) = of(scene, line, kept)?;
    let style = line.edges.as_ref()?.hidden.as_ref()?;
    let mut out = Vec::new();
    for s in &kept.list {
        let ends = kept.edges[s.edge as usize];
        let len = length(sub(ends[1], ends[0]));
        let point = |at: f64| add(ends[0], scale(sub(ends[1], ends[0]), at / len));
        let mut piece = |from: f64, to: f64, dashed: bool| {
            out.push(Piece {
                a: point(from),
                b: point(to),
                hidden: s.hidden,
                dashed,
                cut: [from > 0.0, to < len],
            })
        };
        let Some(d) = Dashed::new(scene, line, style, ends, s) else {
            piece(s.from, s.to, true);
            continue;
        };
        let phase = (d.from - d.origin) - ((d.from - d.origin) / d.period).floor() * d.period;
        if phase <= SLIVER {
            piece(s.from, s.to, true);
            continue;
        }
        if phase < d.on - SLIVER {
            piece(
                s.from,
                d.ruler.back((d.from + d.on - phase).min(d.to)),
                false,
            );
        }
        if d.from + d.period - phase < d.to - SLIVER {
            piece(d.ruler.back(d.from + d.period - phase), s.to, true);
        }
    }
    Some(out)
}
