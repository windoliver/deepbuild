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

type P = [f64; 2];

fn cross(a: P, b: P) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn dot(a: P, b: P) -> f64 {
    a[0] * b[0] + a[1] * b[1]
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
    /// Where its `BINS + 1` offsets start in [`Shadows::words`].
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
    /// Each caster's `BINS + 1` offsets into this, then its bins: per outline with a segment
    /// there, a [`RUN`] word and those segments' indices. A bin holds every segment a pixel
    /// centred in it can meet at any of its samples.
    pub words: Vec<u32>,
    /// Each caster's bins' `[near, far]`, u from a point light or along a sun's rays: nearer
    /// than `near` nothing in the bin blocks a pixel, and from `far` on an outline that spans
    /// the bin blocks all of it.
    pub bounds: Vec<[f64; 2]>,
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
/// either side, for a pixel's samples and for f32; and how near the light it comes and how far,
/// u from a point light or along a sun's rays.
struct Seen {
    lo: f64,
    hi: f64,
    advance: f64,
    slack: f64,
    near: f64,
    far: f64,
}

/// The room, in bins round a point light, that a pixel's samples take where they are `x` of
/// the way to it; from 1 on it is no number, and spans no bins.
fn room(x: f64) -> f64 {
    SLACK + BINS as f64 / 4.0 * x / ops::sqrt(1.0 - x * x)
}

/// `None` for a segment past a point light's range, where it lights nothing to shadow.
fn seen(l: &Point, c: &Caster, foot: f64, [ax, ay, bx, by]: [f64; 4]) -> Option<Seen> {
    let bins = BINS as f64;
    if let Some(dir) = l.sun {
        let q = |p: P| (cross(dir, p) - c.origin) * c.scale;
        let (qa, qb) = (q([ax, ay]), q([bx, by]));
        let (da, db) = (dot(dir, [ax, ay]), dot(dir, [bx, by]));
        return Some(Seen {
            lo: qa.min(qb),
            hi: qa.max(qb),
            advance: qb - qa,
            slack: SLACK + foot * c.scale,
            near: da.min(db),
            far: da.max(db),
        });
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
    if near >= l.range {
        return None;
    }
    let far = ops::hypot(a[0], a[1]).max(ops::hypot(b[0], b[1]));
    if near <= foot {
        // A pixel's samples reach the light from the segment: every direction meets it.
        return Some(Seen {
            lo: 0.0,
            hi: bins,
            advance: 0.0,
            slack: 0.0,
            near,
            far,
        });
    }
    let up = cross(a, b) >= 0.0;
    let (ta, tb) = (turn(a) * bins / 4.0, turn(b) * bins / 4.0);
    let (lo, hi) = if up { (ta, tb) } else { (tb, ta) };
    let hi = if hi < lo - 1e-9 {
        hi + bins
    } else {
        hi.max(lo)
    };
    Some(Seen {
        lo,
        hi,
        advance: if up { hi - lo } else { lo - hi },
        slack: room(foot / near),
        near,
        far,
    })
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
    let mut bounds: Vec<[f64; 2]> = Vec::new();
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
        let seen: Vec<Option<Seen>> = segs.iter().map(|s| seen(l, &c, foot, *s)).collect();
        // Each bin's words counted, then filled: an outline's RUN word before its first segment.
        let mut sizes = vec![0u32; BINS];
        let mut last = vec![None; BINS];
        for (o, (run, _)) in runs.iter().enumerate() {
            for s in seen[run.clone()].iter().flatten() {
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
        let mut at = (c.table + BINS + 1) as u32;
        for size in &sizes {
            words.push(at);
            next.push(at as usize);
            at += size;
        }
        words.push(at);
        words.resize(at as usize, 0);
        bounds.resize(c.bounds + BINS, [f64::INFINITY; 2]);
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
                let Some(s) = &seen[i] else { continue };
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
            // `far`: past a whole outline of one line that spans the bin, with room for a
            // pixel's samples, every pixel is behind it and outside it.
            let whole: Option<Vec<&Seen>> = seen[run.clone()].iter().map(Option::as_ref).collect();
            let Some(whole) = whole.filter(|w| *one && !w.is_empty()) else {
                continue;
            };
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
            for s in &whole {
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
        let [near, far] = self.bounds[caster.bounds + bin];
        if key + self.foot <= near {
            return 1.0;
        }
        if key - self.foot >= far {
            return 0.0;
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
        let d = match l.sun {
            Some(dir) => [-dir[0], -dir[1]],
            None => [l.at[0] - x[0], l.at[1] - x[1]],
        };
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
        // Twelve outlines that may overlap, the first with a hole, the second in two parts and
        // the third a wall whose first side passes a light, round and across the lights.
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
        // near the wall as a pixel's samples reach, and two suns.
        let lights = [
            point([-30.0, 200.0], 2000.0),
            point([250.0, 250.0], 2000.0),
            point([250.0, 310.0], 2000.0),
            point([120.0, 380.0], 150.0),
            point([439.7, 390.0], 2000.0),
            sun(30.0),
            sun(200.0),
        ];
        for zoom in [1.0, 2.0] {
            let shadows = build(&lights, &outlines, zoom).expect("outlines occlude");
            let mut blocked = [0.0; 7];
            for _ in 0..4000 {
                let c = [500.0 * rand(), 500.0 * rand()];
                let samples = SAMPLES.map(|o| [c[0] + o[0] / zoom, c[1] + o[1] / zoom]);
                for (k, l) in lights.iter().enumerate() {
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
