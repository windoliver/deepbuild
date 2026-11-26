//! #2032: shadows in a lit 2D group (canvas primitives: Frame and group `frame@1`, `group@1`;
//! Path `path@1`). A closed path with `occlude` in a lit group blocks every light of the group
//! with its outline: a pixel is in a light's shadow when the straight segment from the pixel to
//! the light crosses an occluding outline, and a pixel inside an occluding outline is not
//! shadowed by that outline. A sun's light runs along its angle, so its segment runs against the
//! angle with no end. This is the segment test both renderers take: the CPU reference here in
//! f64, and the GPU layer's light pass (`deep-groups-render`'s `lightfx`) in f32 over the same bins.

use std::fmt;

use deep_canvas::ops;
use serde_json::{json, Map, Value};

use crate::key::{ContentKey, KeyBuilder};
use crate::light::{lit_group, Point, Problem};
use crate::path::{self, Verb};
use crate::scene::Refused;

/// The most occluder segments one lit group holds, counted after curves flatten.
pub const MAX_SEGMENTS: usize = 4096;

/// The bins each light sorts the segments into, by direction round a point light and by offset
/// across a sun's rays: a pixel tests only the segments of its own bin.
pub const BINS: usize = 1024;

/// The bit that marks, in a bin's words, the start of one outline's segments; the word's low 16
/// bits hold the outline's winding number round the light plus [`WIND`].
pub const RUN: u32 = 1 << 31;
pub const WIND: i32 = 1 << 15;

/// Where a pixel is tested, px from its centre: a shadow's edge is antialiased over 1 px.
pub const SAMPLES: [[f64; 2]; 4] = [[-0.2, -0.4], [0.4, -0.2], [-0.4, 0.2], [0.2, 0.4]];

/// How far from its centre a pixel is tested at most, px, with room for what f32 loses.
pub const FOOT: f64 = 0.46;

/// How far past its ends, in bins, a segment is filed, so f32 finds it where f64 filed it.
const SLACK: f64 = 0.125;

/// How far apart across a light's ray, px, two corners lie for f32 to tell which side each is on.
const APART: f64 = 1.0 / 64.0;

type P = [f64; 2];

fn cross(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

/// The way from `x` to the light `l`: against a sun's rays, with no end.
fn toward(l: &Point, x: P) -> P {
    match l.sun {
        Some(dir) => [-dir[0], -dir[1]],
        None => [l.at[0] - x[0], l.at[1] - x[1]],
    }
}

/// A direction's place round a turn, 0..4, rising from +x toward +y: a point light's bins.
pub fn turn(v: P) -> f64 {
    let t = v[0] / (v[0].abs() + v[1].abs());
    if v[1] >= 0.0 {
        1.0 - t
    } else {
        3.0 + t
    }
}

fn occludes(item: &Value) -> bool {
    item.get("kind").and_then(Value::as_str) == Some("path@1")
        && item.pointer("/params/occlude") == Some(&Value::Bool(true))
}

/// A flattened sub-path's segments, closed.
fn closed(line: path::Polyline) -> impl Iterator<Item = [f64; 4]> {
    let n = line.points.len();
    (0..n).map(move |i| {
        let (a, b) = (line.points[i], line.points[(i + 1) % n]);
        [a[0], a[1], b[0], b[1]]
    })
}

fn open_path(id: &str) -> Problem {
    Problem {
        code: "occluder_open",
        id: id.to_string(),
        path: format!("items/{id}/params/occlude"),
        actual: json!({"path": id, "occlude": true}),
        what: format!("the path {id} occludes and is open; only a closed outline blocks light"),
    }
}

fn past_cap(group: &str, segments: usize) -> Problem {
    Problem {
        code: "out_of_range",
        id: group.to_string(),
        path: format!("items/{group}/params/light"),
        actual: json!({"segments": segments, "cap": MAX_SEGMENTS}),
        what: format!(
            "the group {group}'s occluders hold segments: {segments}, cap: {MAX_SEGMENTS}"
        ),
    }
}

/// The outlines of the shown paths under the lit group `group` that occlude, where they draw, in
/// item order, with the segments they flatten into at zoom 1. An open one is skipped and named.
fn under(items: &Map<String, Value>, group: &str) -> (Vec<Vec<Verb>>, usize, Option<Problem>) {
    let (mut outlines, mut segments, mut open) = (Vec::new(), 0, None);
    for (id, item) in items {
        if !occludes(item) || item.get("visible") == Some(&Value::Bool(false)) {
            continue;
        }
        let mut at = item.get("parent").and_then(Value::as_str);
        for _ in 0..items.len() {
            if at.is_none_or(|a| a == group) {
                break;
            }
            at = at
                .and_then(|a| items.get(a))
                .and_then(|i| i.get("parent"))
                .and_then(Value::as_str);
        }
        let Some(verbs) = at
            .filter(|a| *a == group)
            .and_then(|_| crate::scene::item_outline(items, id))
        else {
            continue;
        };
        let lines = path::flatten(&verbs, path::tolerance(0));
        if lines.iter().any(|l| !l.closed) {
            open.get_or_insert_with(|| open_path(id));
            continue;
        }
        segments += lines.iter().map(|l| l.points.len()).sum::<usize>();
        outlines.push(verbs);
    }
    (outlines, segments, open)
}

/// A lit group's occluding outlines at t, where they draw (u), with their content key, which
/// stands for them wherever a light is compared, printed or keyed.
#[derive(Clone)]
pub struct Occluders {
    pub outlines: Vec<Vec<Verb>>,
    key: ContentKey,
}

impl Occluders {
    pub fn new(outlines: Vec<Vec<Verb>>) -> Occluders {
        let mut bytes = Vec::new();
        for v in outlines.iter().flatten() {
            let (kind, points): (u8, &[P]) = match v {
                Verb::Move(p) => (0, std::slice::from_ref(p)),
                Verb::Line(p) => (1, std::slice::from_ref(p)),
                Verb::Quad(a, b) => (2, &[*a, *b]),
                Verb::Cubic(a, b, c) => (3, &[*a, *b, *c]),
                Verb::Close => (4, &[]),
            };
            bytes.push(kind);
            for n in points.iter().flatten() {
                bytes.extend_from_slice(&(n + 0.0).to_bits().to_le_bytes());
            }
        }
        let key = KeyBuilder::new("occluders@marks2d.1")
            .bytes(&bytes)
            .finish();
        Occluders { outlines, key }
    }
}

impl PartialEq for Occluders {
    fn eq(&self, other: &Occluders) -> bool {
        self.key == other.key
    }
}

impl fmt::Debug for Occluders {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Occluders({})", self.key.hex())
    }
}

/// The lit group `group`'s occluders at t, or the refusal the check names.
pub(crate) fn occluders(items: &Map<String, Value>, group: &str) -> Result<Occluders, Refused> {
    let (outlines, segments, open) = under(items, group);
    let problem = open.or_else(|| (segments > MAX_SEGMENTS).then(|| past_cap(group, segments)));
    match problem {
        Some(p) => crate::scene::refuse(p.code, p.path),
        None => Ok(Occluders::new(outlines)),
    }
}

/// The check's refusals: an open path with `occlude`, naming the path, and a lit group whose
/// occluders pass [`MAX_SEGMENTS`], naming the count and the cap.
pub fn problems(items: &Map<String, Value>) -> Vec<Problem> {
    let mut out = Vec::new();
    for (id, _) in items.iter().filter(|(_, i)| occludes(i)) {
        let open = crate::scene::item_outline(items, id).is_some_and(|verbs| {
            path::flatten(&verbs, path::tolerance(0))
                .iter()
                .any(|l| !l.closed)
        });
        if open {
            out.push(open_path(id));
        }
    }
    for (id, _) in items.iter().filter(|(_, i)| lit_group(i)) {
        let segments = under(items, id).1;
        if segments > MAX_SEGMENTS {
            out.push(past_cap(id, segments));
        }
    }
    out
}

/// One light's bins.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Caster {
    /// Where its `BINS + 1` offsets start in [`Shadows::words`]; its `BINS` corners follow them.
    pub table: usize,
    /// Where its `BINS` bounds start in [`Shadows::bounds`].
    pub bounds: usize,
    /// A sun's bins: the offset across its rays where the first bin starts, and bins a u.
    pub origin: f64,
    pub scale: f64,
}

/// A lit group's shadows at a zoom: its occluders' segments and each light's bins.
#[derive(Clone, Debug, PartialEq)]
pub struct Shadows {
    /// Each segment's ends, `[ax, ay, bx, by]` in u, each outline's in a row.
    pub segs: Vec<[f64; 4]>,
    /// Each caster's `BINS + 1` offsets into this, then its bins' corners, then its bins: per
    /// outline with a segment there, a [`RUN`] word and those segments' indices. A bin holds
    /// every segment a pixel centred in it can meet at any of its samples. A bin's corner is the
    /// segment its split starts from, twice, plus 1 where the outline lies on the side a ray
    /// reads as 0 or more.
    pub words: Vec<u32>,
    /// Each caster's bins' `[lit, dark, split, next]`, u from a point light or along a sun's
    /// rays: nearer than `lit` nothing in the bin blocks a pixel; from `dark` on an outline that
    /// spans the bin blocks all of it; and from `split` to `next` a pixel is behind one
    /// outline's silhouette and nothing else, blocked on the outline's side of the ray through
    /// the bin's corner.
    pub bounds: Vec<[f64; 4]>,
    /// Each light's bins, `None` for one no segment can shadow.
    pub casters: Vec<Option<Caster>>,
    /// [`FOOT`] in u.
    foot: f64,
}

/// The outline's winding number round `p`.
fn winding(segs: &[[f64; 4]], p: P) -> i32 {
    let mut w = 0;
    for &[ax, ay, bx, by] in segs {
        let left = (bx - ax) * (p[1] - ay) - (p[0] - ax) * (by - ay);
        if ay <= p[1] {
            if by > p[1] && left > 0.0 {
                w += 1;
            }
        } else if by <= p[1] && left < 0.0 {
            w -= 1;
        }
    }
    w
}

/// A segment as a light sees it: the bins it spans, `lo` to `hi` (past [`BINS`] where it wraps
/// round a point light), and how far `a` to `b` moves through them; the room to file it with
/// either side, for a pixel's samples and for f32; how near the light it comes and how far,
/// u from a point light or along a sun's rays; and whether it lies past a point light's range,
/// where it lights nothing to shadow and no bin holds it.
struct Seen {
    lo: f64,
    hi: f64,
    advance: f64,
    slack: f64,
    near: f64,
    far: f64,
    past: bool,
}

/// The room, in bins round a point light, that a pixel's samples take where they are `x` of
/// the way to it; from 1 on it is no number, and spans no bins.
fn room(x: f64) -> f64 {
    SLACK + BINS as f64 / 4.0 * x / ops::sqrt(1.0 - x * x)
}

fn seen(l: &Point, c: &Caster, foot: f64, [ax, ay, bx, by]: [f64; 4]) -> Seen {
    let bins = BINS as f64;
    if let Some(dir) = l.sun {
        let q = |p: P| (cross(dir, p) - c.origin) * c.scale;
        let (qa, qb) = (q([ax, ay]), q([bx, by]));
        let (da, db) = (dot(dir, [ax, ay]), dot(dir, [bx, by]));
        return Seen {
            lo: qa.min(qb),
            hi: qa.max(qb),
            advance: qb - qa,
            slack: SLACK + foot * c.scale,
            near: da.min(db),
            far: da.max(db),
            past: false,
        };
    }
    let (a, b) = ([ax - l.at[0], ay - l.at[1]], [bx - l.at[0], by - l.at[1]]);
    let e = [b[0] - a[0], b[1] - a[1]];
    let along = dot(e, e);
    let s = if along > 0.0 {
        (-dot(a, e) / along).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let near = ops::hypot(a[0] + s * e[0], a[1] + s * e[1]);
    let past = near >= l.range;
    let far = ops::hypot(a[0], a[1]).max(ops::hypot(b[0], b[1]));
    if near <= foot {
        // A pixel's samples reach the light from the segment: every direction meets it.
        return Seen {
            lo: 0.0,
            hi: bins,
            advance: 0.0,
            slack: 0.0,
            near,
            far,
            past,
        };
    }
    let up = cross(a, b) >= 0.0;
    let (ta, tb) = (turn(a) * bins / 4.0, turn(b) * bins / 4.0);
    let (lo, hi) = if up { (ta, tb) } else { (tb, ta) };
    let hi = if hi < lo - 1e-9 {
        hi + bins
    } else {
        hi.max(lo)
    };
    Seen {
        lo,
        hi,
        advance: if up { hi - lo } else { lo - hi },
        slack: room(foot / near),
        near,
        far,
        past,
    }
}

/// The bins from `lo - slack` to `hi + slack`: round a point light they wrap, and across a
/// sun's rays they stop at the first and the last.
fn bins_of(lo: f64, hi: f64, slack: f64, wraps: bool) -> impl Iterator<Item = usize> {
    let bins = BINS as f64;
    let (first, last) = ((lo - slack).floor(), (hi + slack).floor());
    let (first, last) = if wraps {
        (first, last.min(first + bins - 1.0))
    } else {
        (first.max(0.0), last.min(bins - 1.0))
    };
    (0..=(last - first).max(-1.0) as i64).map(move |k| (first + k as f64).rem_euclid(bins) as usize)
}

/// One light's view of the segments, which its bins' zones are read from.
struct Sight<'a> {
    l: &'a Point,
    c: &'a Caster,
    segs: &'a [[f64; 4]],
    seen: &'a [Seen],
    foot: f64,
}

impl Sight<'_> {
    /// Where `p` lies in bins, on bin `b`'s side of a point light's turn.
    fn pos(&self, b: usize, p: P) -> f64 {
        let Some(dir) = self.l.sun else {
            let bins = BINS as f64;
            let t = turn([p[0] - self.l.at[0], p[1] - self.l.at[1]]) * bins / 4.0;
            return t - ((t - b as f64) / bins).round() * bins;
        };
        (cross(dir, p) - self.c.origin) * self.c.scale
    }

    /// How far `q` lies from the light's ray through `p`.
    fn apart(&self, p: P, q: P) -> f64 {
        let Some(dir) = self.l.sun else {
            let at = self.l.at;
            let (p, q) = ([p[0] - at[0], p[1] - at[1]], [q[0] - at[0], q[1] - at[1]]);
            return cross(p, q).abs() / ops::hypot(p[0], p[1]);
        };
        cross(dir, [q[0] - p[0], q[1] - p[1]]).abs()
    }

    /// What bin `b`'s nearest outline settles past the bin's bounds, read from the bin's
    /// `stream`, when the light is outside it. `lit`: its nearest chain of segments here turns
    /// one way, so a ray crosses it once at most and a pixel past it is inside the outline:
    /// nothing blocks a pixel up to the next segment the bin holds. The split: its segments
    /// here are one chain that turns back at a corner, so a pixel past them and before the bin's
    /// other outlines is behind that silhouette alone, blocked on the outline's side of the ray
    /// through the corner; from where, to where and the corner's word. The split holds only
    /// where a ray on the outline's side crosses the chain twice and f32 answers as f64 does:
    /// both ends past the bin on that side, every other corner on that side of the corner's ray
    /// by more than f32 loses, and the chain not beside a point light.
    fn zones(&self, b: usize, stream: &[u32]) -> (Option<f64>, Option<(f64, f64, u32)>) {
        let near = |list: &[u32]| {
            let nearer = |n: f64, i: &u32| n.min(self.seen[*i as usize].near);
            list.iter().fold(f64::INFINITY, nearer)
        };
        // The bin's outlines: each one's winding round the light and its segments here.
        let mut parts: Vec<(i32, &[u32])> = Vec::new();
        let mut rest = stream;
        while let [head, tail @ ..] = rest {
            let n = tail.iter().position(|w| w & RUN != 0);
            let n = n.unwrap_or(tail.len());
            parts.push(((head & 0xffff) as i32 - WIND, &tail[..n]));
            rest = &tail[n..];
        }
        let by_near = |p: &usize, q: &usize| near(parts[*p].1).total_cmp(&near(parts[*q].1));
        let Some(first) = (0..parts.len()).min_by(by_near) else {
            return (None, None);
        };
        let (wind, list) = parts[first];
        let others = (0..parts.len())
            .filter(|k| *k != first)
            .fold(f64::INFINITY, |n, k| n.min(near(parts[k].1)));
        let n = list.len();
        // Where each chain of segments, each starting where the one before ends, ends in the list.
        let ends: Vec<usize> = (0..n)
            .filter(|j| {
                let (s, t) = (list[*j] as usize, list[(j + 1) % n] as usize);
                self.segs[s][2..] != self.segs[t][..2]
            })
            .collect();
        if wind != 0 || near(list) <= self.foot || ends.is_empty() {
            return (None, None);
        }
        // The chain that comes nearest: its segments in order, their ends, and where each lies.
        let seg_near = |j: &usize| self.seen[list[*j] as usize].near;
        let nearest = (0..n).min_by(|p, q| seg_near(p).total_cmp(&seg_near(q)));
        let e = ends.iter().position(|e| Some(*e) >= nearest).unwrap_or(0);
        let before = ends[(e + ends.len() - 1) % ends.len()];
        let len = (ends[e] + n - before - 1) % n + 1;
        let chain: Vec<usize> = (0..len)
            .map(|k| list[(before + 1 + k) % n] as usize)
            .collect();
        let mut points: Vec<P> = chain
            .iter()
            .map(|i| self.segs[*i])
            .map(|s| [s[0], s[1]])
            .collect();
        let last = self.segs[chain[len - 1]];
        points.push([last[2], last[3]]);
        let at: Vec<f64> = points.iter().map(|p| self.pos(b, *p)).collect();
        let b = b as f64;
        if self.l.sun.is_none() && at.iter().any(|q| (q - b).abs() >= BINS as f64 / 4.0) {
            return (None, None);
        }
        let up = at[len] > at[0];
        if (0..len).all(|k| (at[k + 1] > at[k]) == up) {
            let behind = list
                .iter()
                .map(|i| *i as usize)
                .filter(|i| !chain.contains(i));
            return (
                Some(behind.fold(others, |n, i| n.min(self.seen[i].near))),
                None,
            );
        }
        // The corner farthest from the outline's side of the bin, every other one on that side.
        let below = at[0] < b + 0.5;
        let corner = (1..len).max_by(|p, q| {
            let order = at[*p].total_cmp(&at[*q]);
            if below {
                order
            } else {
                order.reverse()
            }
        });
        let Some(k) = corner.filter(|_| len == n) else {
            return (None, None);
        };
        let far = list
            .iter()
            .fold(f64::NEG_INFINITY, |f, i| f.max(self.seen[*i as usize].far));
        // The room a pixel past the chain takes either side of the bin; and how near a point
        // light f32 can't tell a crossing from one past the light, across its range.
        let (margin, lost) = match self.l.sun {
            Some(_) => (self.seen[chain[0]].slack, 0.0),
            None => (
                room(self.foot / (far + self.foot)),
                self.l.range * self.l.range * FOOT / self.foot / 8192.0,
            ),
        };
        let out = |q: f64| {
            if below {
                q <= b - margin
            } else {
                q >= b + 1.0 + margin
            }
        };
        let edge = APART * self.foot / FOOT;
        let clear = |j: usize| (at[j] < at[k]) == below && self.apart(points[k], points[j]) >= edge;
        if !(out(at[0]) && out(at[len]))
            || near(list) < lost
            || !(0..=len).all(|j| j == k || clear(j))
        {
            return (None, None);
        }
        let word = (chain[k] as u32) << 1 | u32::from(below);
        (None, Some((far + self.foot, others, word)))
    }
}

/// The shadows `outlines` cast from `lights` at `zoom`, each outline flattened as a path is at
/// that zoom's bucket; `None` when nothing occludes.
pub fn build(lights: &[Point], outlines: &[Vec<Verb>], zoom: f64) -> Option<Shadows> {
    let tol = path::tolerance(path::bucket(zoom));
    let foot = FOOT / zoom;
    let mut segs = Vec::new();
    // Each outline's segments, and whether it is one closed line.
    let mut runs = Vec::with_capacity(outlines.len());
    for verbs in outlines {
        let start = segs.len();
        let lines = path::flatten(verbs, tol);
        let one = lines.len() == 1;
        segs.extend(lines.into_iter().flat_map(closed));
        runs.push((start..segs.len(), one));
    }
    if segs.is_empty() {
        return None;
    }
    let mut words: Vec<u32> = Vec::new();
    let mut bounds: Vec<[f64; 4]> = Vec::new();
    let mut casters = Vec::with_capacity(lights.len());
    for l in lights {
        let wraps = l.sun.is_none();
        let mut c = Caster {
            table: words.len(),
            bounds: bounds.len(),
            origin: 0.0,
            scale: 0.0,
        };
        if let Some(dir) = l.sun {
            let q = segs
                .iter()
                .flat_map(|s| [cross(dir, [s[0], s[1]]), cross(dir, [s[2], s[3]])]);
            let (lo, hi) = q.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), q| {
                (lo.min(q), hi.max(q))
            });
            // Bins at least 1/128 px wide, so SLACK covers what f32 loses of an offset.
            let pad = 4.0 / zoom;
            c.origin = lo - pad;
            c.scale = BINS as f64 / (hi - lo + 2.0 * pad);
        }
        let seen: Vec<Seen> = segs.iter().map(|s| seen(l, &c, foot, *s)).collect();
        // Each bin's words counted, then filled: an outline's RUN word before its first segment.
        let mut sizes = vec![0u32; BINS];
        let mut last = vec![None; BINS];
        for (o, (run, _)) in runs.iter().enumerate() {
            for s in seen[run.clone()].iter().filter(|s| !s.past) {
                for b in bins_of(s.lo, s.hi, s.slack, wraps) {
                    sizes[b] += 1 + u32::from(last[b] != Some(o));
                    last[b] = Some(o);
                }
            }
        }
        if sizes.iter().all(|n| *n == 0) {
            casters.push(None);
            continue;
        }
        let mut next = Vec::with_capacity(BINS);
        let mut at = (c.table + 2 * BINS + 1) as u32;
        for size in &sizes {
            words.push(at);
            next.push(at as usize);
            at += size;
        }
        words.push(at);
        words.resize(at as usize, 0);
        bounds.resize(c.bounds + BINS, [f64::INFINITY; 4]);
        let bound = &mut bounds[c.bounds..];
        last.fill(None);
        // How far the outline in hand comes in each bin it is seen in.
        let mut reach = vec![(None, 0.0_f64); BINS];
        for (o, (run, one)) in runs.iter().enumerate() {
            let wind = match l.sun {
                Some(_) => 0,
                None => winding(&segs[run.clone()], l.at),
            };
            for i in run.clone() {
                let s = &seen[i];
                if s.past {
                    continue;
                }
                for b in bins_of(s.lo, s.hi, s.slack, wraps) {
                    if last[b] != Some(o) {
                        last[b] = Some(o);
                        words[next[b]] = RUN | (wind + WIND).clamp(0, 0xffff) as u32;
                        next[b] += 1;
                    }
                    words[next[b]] = i as u32;
                    next[b] += 1;
                    bound[b][0] = bound[b][0].min(s.near);
                }
            }
            // `dark`: past a whole outline of one line that spans the bin, with room for a
            // pixel's samples, every pixel is behind it and outside it.
            let whole = &seen[run.clone()];
            if !*one || whole.is_empty() {
                continue;
            }
            let nearest = whole.iter().fold(f64::INFINITY, |n, s| n.min(s.near));
            let slack = match l.sun {
                Some(_) => whole[0].slack,
                None => room(foot / nearest),
            };
            let start = if whole[0].advance >= 0.0 {
                whole[0].lo
            } else {
                whole[0].hi
            };
            let (mut pos, mut lo, mut hi) = (start, start, start);
            for s in whole {
                pos += s.advance;
                (lo, hi) = (lo.min(pos), hi.max(pos));
                for b in bins_of(s.lo, s.hi, slack, wraps) {
                    let held = if reach[b].0 == Some(o) {
                        reach[b].1
                    } else {
                        f64::NEG_INFINITY
                    };
                    reach[b] = (Some(o), held.max(s.far));
                }
            }
            // The bins wholly inside the outline's span, less that room either side.
            let (first, last) = ((lo + slack).ceil(), (hi - slack).floor() - 1.0);
            for b in bins_of(first, last, 0.0, wraps) {
                if reach[b].0 == Some(o) {
                    bound[b][1] = bound[b][1].min(reach[b].1);
                }
            }
        }
        let sight = Sight {
            l,
            c: &c,
            segs: &segs,
            seen: &seen,
            foot,
        };
        for b in 0..BINS {
            let stream = words[c.table + b] as usize..words[c.table + b + 1] as usize;
            let (lit, split) = sight.zones(b, &words[stream]);
            if let Some(lit) = lit {
                bound[b][0] = lit;
            }
            if let Some((from, to, corner)) = split {
                (bound[b][2], bound[b][3]) = (from, to);
                words[c.table + BINS + 1 + b] = corner;
            }
        }
        casters.push(Some(c));
    }
    Some(Shadows {
        segs,
        words,
        bounds,
        casters,
        foot,
    })
}

impl Shadows {
    /// The share of light `k` of the list, `l`, that reaches the pixel centred at `c` (u): the
    /// part of its `samples` where the straight segment to the light crosses no occluding
    /// outline that the sample isn't inside.
    pub fn share(&self, k: usize, l: &Point, c: P, samples: &[P]) -> f64 {
        let Some(caster) = &self.casters[k] else {
            return 1.0;
        };
        let (bin, key) = match l.sun {
            Some(dir) => {
                let b = (cross(dir, c) - caster.origin) * caster.scale;
                if !(0.0..BINS as f64).contains(&b) {
                    return 1.0;
                }
                (b as usize, dot(dir, c))
            }
            None => {
                let v = [c[0] - l.at[0], c[1] - l.at[1]];
                if v == [0.0, 0.0] {
                    return 1.0;
                }
                let b = turn(v) * BINS as f64 / 4.0;
                ((b as usize).min(BINS - 1), ops::hypot(v[0], v[1]))
            }
        };
        let [lit, dark, split, next] = self.bounds[caster.bounds + bin];
        if key + self.foot <= lit {
            return 1.0;
        }
        if key - self.foot >= dark {
            return 0.0;
        }
        if key - self.foot >= split && key + self.foot <= next {
            let corner = self.words[caster.table + BINS + 1 + bin];
            let [ax, ay, ..] = self.segs[(corner >> 1) as usize];
            let side = |x: &&P| cross(toward(l, **x), [ax - x[0], ay - x[1]]) >= 0.0;
            let lit = samples.iter().filter(|x| side(x) == (corner & 1 != 0));
            return lit.count() as f64 / samples.len() as f64;
        }
        let (from, to) = (
            self.words[caster.table + bin],
            self.words[caster.table + bin + 1],
        );
        let stream = &self.words[from as usize..to as usize];
        let blocked = samples.iter().filter(|x| self.blocks(stream, l, **x));
        1.0 - blocked.count() as f64 / samples.len() as f64
    }

    /// Whether the light `l` is blocked at `x` by the segments of a bin's `stream`.
    fn blocks(&self, stream: &[u32], l: &Point, x: P) -> bool {
        let d = toward(l, x);
        let far = l.sun.is_some();
        let (mut crossings, mut wind) = (0, 0);
        for &w in stream {
            if w & RUN != 0 {
                if crossings > 0 && wind == 0 {
                    return true;
                }
                (crossings, wind) = (0, (w & 0xffff) as i32 - WIND);
                continue;
            }
            let [ax, ay, bx, by] = self.segs[w as usize];
            let (a, b) = ([ax - x[0], ay - x[1]], [bx - x[0], by - x[1]]);
            let (sa, sb) = (cross(d, a), cross(d, b));
            if (sa >= 0.0) == (sb >= 0.0) {
                continue;
            }
            // The crossing is num ÷ den of the way from x to the light.
            let (den, num) = (sb - sa, cross(a, b));
            let hit = if den > 0.0 {
                num > 0.0 && (far || num < den)
            } else {
                num < 0.0 && (far || num > den)
            };
            if hit {
                crossings += 1;
                wind += if den > 0.0 { 1 } else { -1 };
            }
        }
        crossings > 0 && wind == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A seeded stream in 0..1.
    fn stream(mut s: u64) -> impl FnMut() -> f64 {
        move || {
            s = s
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (s >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// A closed outline of `n` corners round `c`, turning one way so it never crosses itself;
    /// `back` runs it the other way round, as a hole in an outline that holds it.
    fn ring(c: P, r: f64, n: usize, back: bool, rand: &mut impl FnMut() -> f64) -> Vec<Verb> {
        let mut points: Vec<P> = (0..n)
            .map(|k| {
                let (sin, cos) = crate::turn::sin_cos(360.0 * k as f64 / n as f64);
                let q = r * (0.6 + 0.4 * rand());
                [c[0] + q * cos, c[1] + q * sin]
            })
            .collect();
        if back {
            points.reverse();
        }
        let mut verbs = vec![Verb::Move(points[0])];
        verbs.extend(points[1..].iter().map(|p| Verb::Line(*p)));
        verbs.push(Verb::Close);
        verbs
    }

    /// The design's sentence with no bins: the straight segment from `x` toward the light
    /// crosses an outline that `x` isn't inside, by the crossings of a ray from `x` toward +x.
    fn by_every_segment(outlines: &[Vec<Verb>], x: P, toward: P) -> bool {
        let side = |o: P, a: P, b: P| cross([a[0] - o[0], a[1] - o[1]], [b[0] - o[0], b[1] - o[1]]);
        outlines.iter().any(|verbs| {
            let lines = path::flatten(verbs, 0.1);
            let segs: Vec<[f64; 4]> = lines.into_iter().flat_map(closed).collect();
            let inside = segs
                .iter()
                .filter(|s| {
                    (s[1] > x[1]) != (s[3] > x[1])
                        && x[0] < (s[2] - s[0]) * (x[1] - s[1]) / (s[3] - s[1]) + s[0]
                })
                .count()
                % 2
                == 1;
            let crosses = segs.iter().any(|s| {
                let (a, b) = ([s[0], s[1]], [s[2], s[3]]);
                (side(x, toward, a) > 0.0) != (side(x, toward, b) > 0.0)
                    && (side(a, b, x) > 0.0) != (side(a, b, toward) > 0.0)
            });
            crosses && !inside
        })
    }

    #[test]
    fn the_bins_answer_as_every_segment_does() {
        let mut rand = stream(2032);
        // Twelve outlines that may overlap, the first with a hole, the second in two parts, the
        // third a wall whose first side passes a light, the fourth a star and the fifth a saw,
        // round and across the lights.
        let mut outlines: Vec<Vec<Verb>> = (0..12)
            .map(|_| {
                let c = [40.0 + 420.0 * rand(), 40.0 + 420.0 * rand()];
                ring(
                    c,
                    20.0 + 40.0 * rand(),
                    5 + (rand() * 20.0) as usize,
                    false,
                    &mut rand,
                )
            })
            .collect();
        outlines[0] = ring([250.0, 250.0], 90.0, 24, false, &mut rand);
        let hole = ring([250.0, 250.0], 30.0, 12, true, &mut rand);
        outlines[0].extend(hole);
        outlines[1] = ring([90.0, 90.0], 40.0, 9, false, &mut rand);
        let apart = ring([400.0, 120.0], 40.0, 9, false, &mut rand);
        outlines[1].extend(apart);
        let wall = [
            [440.0, 480.0],
            [440.0, 300.0],
            [470.0, 300.0],
            [470.0, 480.0],
        ];
        outlines[2] = vec![Verb::Move(wall[0])];
        outlines[2].extend(wall[1..].iter().map(|p| Verb::Line(*p)));
        outlines[2].push(Verb::Close);
        // The fourth a star, whose arms a ray passes between, with a second part behind the arm
        // the first sun's rays leave last.
        let arm = |k: usize| {
            let (sin, cos) = crate::turn::sin_cos(360.0 * k as f64 / 14.0);
            let q = if k.is_multiple_of(2) { 70.0 } else { 24.0 };
            [150.0 + q * cos, 215.0 + q * sin]
        };
        outlines[3] = vec![Verb::Move(arm(0))];
        outlines[3].extend((1..14).map(|k| Verb::Line(arm(k))));
        outlines[3].push(Verb::Close);
        let behind = ring([263.0, 200.0], 14.0, 7, false, &mut rand);
        outlines[3].extend(behind);
        // The fifth a saw, whose teeth turn a side back and on again.
        let tooth = |k: usize| {
            [
                330.0 + if k.is_multiple_of(2) { 0.0 } else { 9.0 },
                150.0 + 6.0 * k as f64,
            ]
        };
        outlines[4] = vec![Verb::Move([390.0, 150.0])];
        outlines[4].extend((0..21).map(|k| Verb::Line(tooth(k))));
        outlines[4].extend([Verb::Line([390.0, 270.0]), Verb::Close]);
        let point = |at: P, range: f64| Point {
            at,
            range,
            energy: 1.0,
            color: [1.0; 3],
            sun: None,
            height: range / 4.0,
        };
        let sun = |deg: f64| {
            let (sin, cos) = crate::turn::sin_cos(deg);
            Point {
                sun: Some([cos, sin]),
                ..point([0.0, 0.0], f64::INFINITY)
            }
        };
        // Outside every outline, in the first one's hole, in its body, with a short range, as
        // near the wall as a pixel's samples reach, two suns, inside the wall, and looking along
        // the saw's teeth with its far side out of range.
        let lights = [
            point([-30.0, 200.0], 2000.0),
            point([250.0, 250.0], 2000.0),
            point([250.0, 310.0], 2000.0),
            point([120.0, 380.0], 150.0),
            point([439.7, 390.0], 2000.0),
            sun(30.0),
            sun(200.0),
            point([455.0, 400.0], 2000.0),
            point([300.0, 320.0], 100.0),
        ];
        for zoom in [1.0, 2.0] {
            let shadows = build(&lights, &outlines, zoom).expect("outlines occlude");
            let mut blocked = [0.0; 9];
            let mut pixels: Vec<(P, Option<usize>)> = (0..4000)
                .map(|_| ([500.0 * rand(), 500.0 * rand()], None))
                .collect();
            // And past every corner along each light's ray, where a shadow's edge can run.
            let corners: Vec<P> = outlines
                .iter()
                .flat_map(|verbs| path::flatten(verbs, 0.1))
                .flat_map(|line| line.points)
                .collect();
            for (k, l) in lights.iter().enumerate() {
                for p in &corners {
                    let v = [p[0] - l.at[0], p[1] - l.at[1]];
                    let n = ops::hypot(v[0], v[1]);
                    let d = l.sun.unwrap_or([v[0] / n, v[1] / n]);
                    for t in [2.0, 10.0, 30.0, 150.0, 400.0] {
                        let s = rand() - 0.5;
                        let c = [p[0] + t * d[0] - s * d[1], p[1] + t * d[1] + s * d[0]];
                        pixels.push((c, Some(k)));
                    }
                }
            }
            for (c, only) in pixels {
                let samples = SAMPLES.map(|o| [c[0] + o[0] / zoom, c[1] + o[1] / zoom]);
                for (k, l) in lights.iter().enumerate() {
                    if only.is_some_and(|o| o != k) {
                        continue;
                    }
                    let (dx, dy) = (c[0] - l.at[0], c[1] - l.at[1]);
                    if ops::hypot(dx, dy) > l.range - 1.0 {
                        continue;
                    }
                    let behind = |x: &&P| {
                        let toward = match l.sun {
                            Some(dir) => [x[0] - 4000.0 * dir[0], x[1] - 4000.0 * dir[1]],
                            None => l.at,
                        };
                        by_every_segment(&outlines, **x, toward)
                    };
                    let want = 1.0 - samples.iter().filter(behind).count() as f64 / 4.0;
                    let got = shadows.share(k, l, c, &samples);
                    assert_eq!(got, want, "light {k} at {c:?}, zoom {zoom}");
                    blocked[k] += 1.0 - want;
                }
            }
            assert!(
                blocked.iter().all(|n| *n > 50.0),
                "each light is blocked somewhere: {blocked:?}"
            );
        }
    }

    /// #2844: the zones answer as their bins' segments do beside a light: one on an outline's
    /// corner, whose two sides every bin holds, and one 3 u from a side that turns nearly half
    /// round it, with the outline's far side out of range; and where a light's range cuts an
    /// outline's far side off.
    #[test]
    fn the_zones_answer_as_the_segments_beside_a_light() {
        let scene = |at: P, range: f64, corners: &[P]| {
            let mut verbs = vec![Verb::Move(corners[0])];
            verbs.extend(corners[1..].iter().map(|p| Verb::Line(*p)));
            verbs.push(Verb::Close);
            let light = Point {
                at,
                range,
                energy: 1.0,
                color: [1.0; 3],
                sun: None,
                height: range / 4.0,
            };
            (light, verbs)
        };
        let slab = [
            [-239.0, 276.0],
            [99.5, 243.0],
            [112.0, 280.0],
            [480.0, 280.0],
            [480.0, 170.0],
            [-239.0, 170.0],
        ];
        // And one whose far side a light's range cuts off, so its chain ends inside a bin.
        let cut: Vec<P> = (0..24)
            .map(|k| {
                let (sin, cos) = crate::turn::sin_cos(15.0 * f64::from(k) + 4.0);
                [300.0 + 40.0 * cos, 100.0 + 40.0 * sin]
            })
            .collect();
        let scenes = [
            scene(
                [100.0, 100.0],
                400.0,
                &[[100.0, 100.0], [150.0, 186.5], [186.5, 150.0]],
            ),
            scene([60.0, 250.0], 320.0, &slab),
            scene([100.0, 100.0], 200.0, &cut),
        ];
        for (l, outline) in scenes {
            let shadows = build(
                std::slice::from_ref(&l),
                std::slice::from_ref(&outline),
                1.0,
            )
            .expect("the outline occludes");
            let table = shadows.casters[0].expect("the light casts").table;
            for (x, y) in (0..400).flat_map(|y| (0..400).map(move |x| (x, y))) {
                let c = [f64::from(x) + 0.5, f64::from(y) + 0.5];
                let v = [c[0] - l.at[0], c[1] - l.at[1]];
                if ops::hypot(v[0], v[1]) > l.range - 1.0 {
                    continue;
                }
                let bin = ((turn(v) * BINS as f64 / 4.0) as usize).min(BINS - 1);
                let stream =
                    shadows.words[table + bin] as usize..shadows.words[table + bin + 1] as usize;
                let samples = SAMPLES.map(|o| [c[0] + o[0], c[1] + o[1]]);
                let blocks = |x: &&P| shadows.blocks(&shadows.words[stream.clone()], &l, **x);
                let by_segments = 1.0 - samples.iter().filter(blocks).count() as f64 / 4.0;
                assert_eq!(shadows.share(0, &l, c, &samples), by_segments, "at {c:?}");
            }
        }
    }

    /// #2844: in a scene at the cap, 16 point lights on a 4 × 4 grid over 1920 × 1080 and 64
    /// outlines of 64 corners between them, the bins' zones answer all but 1 in 29 of the pairs
    /// of a pixel and a light in range; without them 1 in 7 tests its bin's segments.
    #[test]
    fn at_the_cap_few_pixels_test_segments() {
        let lights: Vec<Point> = (0..16)
            .map(|k| Point {
                at: [
                    f64::from(240 + 480 * (k % 4)),
                    f64::from(135 + 270 * (k / 4)),
                ],
                range: 400.0,
                energy: 0.5,
                color: [1.0; 3],
                sun: None,
                height: 100.0,
            })
            .collect();
        let outlines: Vec<Vec<Verb>> = (0..64)
            .map(|k| {
                let c = [
                    f64::from(120 + 240 * (k % 8)),
                    67.5 + f64::from(135 * (k / 8)),
                ];
                let corner = |j: i32| {
                    let (sin, cos) = crate::turn::sin_cos(360.0 * f64::from(j) / 64.0);
                    let lobes = f64::from(2 + k % 3) * f64::from(j) * 360.0 / 64.0;
                    let q =
                        44.0 * (0.72 + 0.28 * crate::turn::sin_cos(lobes + f64::from(40 * k)).0);
                    [c[0] + q * cos, c[1] + q * sin]
                };
                let mut verbs = vec![Verb::Move(corner(0))];
                verbs.extend((1..64).map(|j| Verb::Line(corner(j))));
                verbs.push(Verb::Close);
                verbs
            })
            .collect();
        let shadows = build(&lights, &outlines, 1.0).expect("outlines occlude");
        assert_eq!(shadows.segs.len(), MAX_SEGMENTS);
        // Every fifth pixel each way, by each light in range of it.
        let (mut pairs, mut tested) = (0u32, 0u32);
        for (k, l) in lights.iter().enumerate() {
            let caster = shadows.casters[k].as_ref().expect("every light casts");
            for (x, y) in (0..216).flat_map(|y| (0..384).map(move |x| (x, y))) {
                let v = [
                    f64::from(5 * x) + 0.5 - l.at[0],
                    f64::from(5 * y) + 0.5 - l.at[1],
                ];
                let key = ops::hypot(v[0], v[1]);
                if key >= l.range {
                    continue;
                }
                let bin = ((turn(v) * BINS as f64 / 4.0) as usize).min(BINS - 1);
                let [lit, dark, split, next] = shadows.bounds[caster.bounds + bin];
                let (lo, hi) = (key - shadows.foot, key + shadows.foot);
                pairs += 1;
                tested += u32::from(hi > lit && lo < dark && !(lo >= split && hi <= next));
            }
        }
        println!("{tested} of {pairs} pairs test segments");
        assert!(
            tested * 29 < pairs,
            "{tested} of {pairs} pairs test segments"
        );
    }

    #[test]
    fn a_lit_group_takes_the_shown_occluders_under_it() {
        let path = |parent: &str, extra: Value| {
            let mut item = json!({"kind": "path@1", "parent": parent, "params": {"d": "M 0 0 L 9 0 L 9 9 Z", "occlude": true}});
            item.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            item
        };
        let mut items = Map::new();
        for (id, item) in [
            ("lamps", json!({"kind": "group@1", "params": {"light": {}}})),
            (
                "inner",
                json!({"kind": "group@1", "parent": "lamps", "params": {}}),
            ),
            ("other", json!({"kind": "group@1", "params": {"light": {}}})),
            ("child", path("lamps", json!({}))),
            ("deeper", path("inner", json!({}))),
            ("elsewhere", path("other", json!({}))),
            ("hidden", path("lamps", json!({"visible": false}))),
            (
                "plain",
                json!({"kind": "path@1", "parent": "lamps", "params": {"d": "M 0 0 L 9 0 L 9 9 Z"}}),
            ),
        ] {
            items.insert(id.into(), item);
        }
        let (outlines, segments, open) = under(&items, "lamps");
        assert_eq!((outlines.len(), segments, open.is_none()), (2, 6, true));
        assert_eq!(under(&items, "other").1, 3);
    }

    #[test]
    fn a_curve_counts_the_segments_it_casts_from_at_zoom_one() {
        let d = "M 100 0 C 100 55 55 100 0 100 C -55 100 -100 55 -100 0 \
                 C -100 -55 -55 -100 0 -100 C 55 -100 100 -55 100 0 Z";
        let mut items = Map::new();
        let lamps = json!({"kind": "group@1", "params": {"light": {}}});
        let disc =
            json!({"kind": "path@1", "parent": "lamps", "params": {"d": d, "occlude": true}});
        items.insert("lamps".into(), lamps);
        items.insert("disc".into(), disc);
        let (outlines, segments, _) = under(&items, "lamps");
        let cast = build(&[], &outlines, 1.0)
            .expect("the disc occludes")
            .segs
            .len();
        assert!(segments > 4, "its four curves flatten: {segments}");
        assert_eq!(segments, cast);
    }
}
