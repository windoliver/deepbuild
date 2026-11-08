//! The geometry a drawn look adds to a path, on its flattened points in u (Look `look@1`: light;
//! line profiles): weight by light per point, a profile's width and alpha along its arc length,
//! and the fills a rim and a cast shadow draw.

use deep_canvas::ops;

use crate::spec::Profile;

pub type Point = [f64; 2];

/// A flattened outline: its points in drawing order, and whether it closes.
#[derive(Clone, Debug, PartialEq)]
pub struct Outline {
    pub points: Vec<Point>,
    pub closed: bool,
}

/// The unit vector a look's `dir` (degrees, counterclockwise from +x with y up, as a page reads it)
/// points along on the page, where y runs down.
pub fn direction(deg: f64) -> Point {
    let r = ops::rad(deg);
    [ops::cos(r), -ops::sin(r)]
}

fn dot(a: Point, b: Point) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn sub(a: Point, b: Point) -> Point {
    [a[0] - b[0], a[1] - b[1]]
}

pub fn unit(v: Point) -> Point {
    let n = ops::hypot(v[0], v[1]);
    if n > 0.0 {
        [v[0] / n, v[1] / n]
    } else {
        [0.0, 0.0]
    }
}

/// The signed area of a closed outline, in u² with y down: positive runs clockwise on the page.
fn area(points: &[Point]) -> f64 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        / 2.0
}

impl Outline {
    /// Each point's outward normal: left of the walk for a clockwise closed outline, so a closed
    /// outline's normals leave its inside whichever way it winds; an open path's are the walk's
    /// left.
    pub fn normals(&self) -> Vec<Point> {
        let n = self.points.len();
        let flip = if self.closed && area(&self.points) < 0.0 {
            -1.0
        } else {
            1.0
        };
        (0..n)
            .map(|i| {
                let before = match i {
                    0 if self.closed => self.points[n - 1],
                    0 => self.points[0],
                    _ => self.points[i - 1],
                };
                let after = match i + 1 == n {
                    true if self.closed => self.points[0],
                    true => self.points[n - 1],
                    false => self.points[i + 1],
                };
                let d = unit(sub(after, before));
                [d[1] * flip, -d[0] * flip]
            })
            .collect()
    }

    /// Each point's arc length from the start.
    pub fn arc(&self) -> (Vec<f64>, f64) {
        let mut at = 0.0;
        let mut out = Vec::with_capacity(self.points.len());
        for (i, p) in self.points.iter().enumerate() {
            if i > 0 {
                let d = sub(*p, self.points[i - 1]);
                at += ops::hypot(d[0], d[1]);
            }
            out.push(at);
        }
        let last = if self.closed {
            let d = sub(
                self.points[0],
                *self.points.last().unwrap_or(&self.points[0]),
            );
            at + ops::hypot(d[0], d[1])
        } else {
            at
        };
        (out, last)
    }
}

/// Line weight by light: 1 + weight × max(0, −n·l) for each point (Look `look@1`: light).
pub fn weight_by_light(outline: &Outline, light: Point, weight: f64) -> Vec<f64> {
    outline
        .normals()
        .iter()
        .map(|n| 1.0 + weight * (-dot(*n, light)).max(0.0))
        .collect()
}

/// How far around its direction a rim reaches: |angle| ≤ 45°, so two kickers leave a form's far
/// side unlit.
const RIM_REACH: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// A rim: the band inside a closed outline toward `toward`, `width` u deep at its peak and 0 where
/// the outline turns 45° away from it, as one closed outline per lit run.
pub fn rim(outline: &Outline, toward: impl Fn(Point) -> Point, width: f64) -> Vec<Outline> {
    let normals = outline.normals();
    let n = outline.points.len();
    let depth: Vec<f64> = (0..n)
        .map(|i| {
            let lit = dot(normals[i], toward(outline.points[i]));
            width * ((lit - RIM_REACH) / (1.0 - RIM_REACH)).clamp(0.0, 1.0)
        })
        .collect();
    let Some(dark) = depth.iter().position(|d| *d <= 0.0) else {
        return vec![band(outline, &normals, &depth, 0, n)];
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        let at = (dark + i) % n;
        if depth[at] <= 0.0 {
            i += 1;
            continue;
        }
        let start = i;
        while i < n && depth[(dark + i) % n] > 0.0 {
            i += 1;
        }
        out.push(band(
            outline,
            &normals,
            &depth,
            (dark + start + n - 1) % n,
            i - start + 2,
        ));
    }
    out
}

/// The band from `count` points of `outline` from `start`, each pushed in by its depth.
fn band(
    outline: &Outline,
    normals: &[Point],
    depth: &[f64],
    start: usize,
    count: usize,
) -> Outline {
    let n = outline.points.len();
    let at = |k: usize| (start + k) % n;
    let mut points: Vec<Point> = (0..count).map(|k| outline.points[at(k)]).collect();
    for k in (0..count).rev() {
        let (p, m, d) = (outline.points[at(k)], normals[at(k)], depth[at(k)]);
        points.push([p[0] - m[0] * d, p[1] - m[1] * d]);
    }
    Outline {
        points,
        closed: true,
    }
}

/// A cast shadow: the shape swept `length` u along `away` at each point, as its closed outline and
/// one quad per segment; drawn together under a non-zero fill they cover the sweep (O(segments)).
pub fn cast(outline: &Outline, away: impl Fn(Point) -> Point, length: f64) -> Vec<Outline> {
    let moved = |p: Point| {
        let d = away(p);
        [p[0] + d[0] * length, p[1] + d[1] * length]
    };
    let n = outline.points.len();
    let mut out = vec![Outline {
        points: outline.points.iter().copied().map(moved).collect(),
        closed: true,
    }];
    let last = if outline.closed {
        n
    } else {
        n.saturating_sub(1)
    };
    for i in 0..last {
        let (a, b) = (outline.points[i], outline.points[(i + 1) % n]);
        let mut points = vec![a, b, moved(b), moved(a)];
        if area(&points) < 0.0 {
            points.reverse();
        }
        out.push(Outline {
            points,
            closed: true,
        });
    }
    out
}

/// A seeded fraction in [0, 1) of an ID and an index, stable across runs.
pub fn seeded(seed: u64, id: &str, k: u32) -> f64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64 ^ seed;
    for b in id.bytes().chain(k.to_le_bytes()) {
        h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
    }
    h ^= h >> 29;
    (h.wrapping_mul(0xbf58_476d_1ce4_e5b9) >> 11) as f64 / (1u64 << 53) as f64
}

/// One drawn run of a line under its profile: its points with a width multiplier and an alpha each.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub points: Vec<Point>,
    /// Multiplies the line's width at each point.
    pub widths: Vec<f64>,
    /// Multiplies its alpha at each point.
    pub alphas: Vec<f64>,
}

/// The points of `outline` resampled no more than `step` u apart, with an end repeated when it
/// closes, so a profile's width has a point to land on anywhere along the line.
fn fine(outline: &Outline, step: f64) -> Vec<Point> {
    let mut points = outline.points.clone();
    if outline.closed && !points.is_empty() {
        points.push(points[0]);
    }
    let mut out = Vec::with_capacity(points.len() * 2);
    for (i, p) in points.iter().enumerate() {
        if i > 0 {
            let a = points[i - 1];
            let d = sub(*p, a);
            let pieces = (ops::hypot(d[0], d[1]) / step).ceil().max(1.0) as usize;
            for k in 1..pieces {
                let f = k as f64 / pieces as f64;
                out.push([a[0] + d[0] * f, a[1] + d[1] * f]);
            }
        }
        out.push(*p);
    }
    out
}

/// How far apart, in u, a profile's points lie: its widths and alphas interpolate between them.
const STEP: f64 = 4.0;

/// A line's width multiplier `at` u along a line `total` u long.
pub fn width_along(p: &Profile, at: f64, total: f64) -> f64 {
    let f = at / total;
    let mut w = 1.0 + p.swell * ops::sin(std::f64::consts::PI * f);
    if p.taper_in > 0.0 && f < p.taper_in {
        w *= f / p.taper_in;
    }
    if p.taper_out > 0.0 && 1.0 - f < p.taper_out {
        w *= (1.0 - f) / p.taper_out;
    }
    // The flick is the last stretch of a line, thinning to its tip.
    if p.flick > 0.0 && total - at < p.flick {
        w *= (total - at) / p.flick;
    }
    w.max(0.0)
}

/// A line's runs under its profile: width and opacity per point from arc length at check, so a
/// stroke tapers, swells and breaks the same way every frame (Look `look@1`: line profiles). `id`
/// and the profile's seed set where breaks fall.
pub fn profiled(outline: &Outline, p: &Profile, id: &str) -> Vec<Run> {
    let mut points = fine(outline, STEP);
    if points.len() < 2 {
        return Vec::new();
    }
    // Overshoot runs past both ends and a flick past the last, each along its end's tangent.
    let tangent = |a: Point, b: Point| unit(sub(b, a));
    let last = points.len() - 1;
    let (t0, t1) = (
        tangent(points[1], points[0]),
        tangent(points[last - 1], points[last]),
    );
    let (start_at, end_at) = (points[0], points[last]);
    let lead = p.overshoot;
    let trail = p.overshoot + p.flick;
    let extend = |from: Point, dir: Point, by: f64| -> Vec<Point> {
        let pieces = by.ceil() as usize;
        (1..=pieces)
            .map(|k| {
                let d = by * k as f64 / pieces as f64;
                [from[0] + dir[0] * d, from[1] + dir[1] * d]
            })
            .collect()
    };
    let mut before = extend(start_at, t0, lead);
    before.reverse();
    before.append(&mut points);
    points = before;
    points.extend(extend(end_at, t1, trail));

    let mut s = vec![0.0];
    for w in points.windows(2) {
        let d = sub(w[1], w[0]);
        s.push(s[s.len() - 1] + ops::hypot(d[0], d[1]));
    }
    let total = *s.last().unwrap_or(&0.0);
    if total <= 0.0 {
        return Vec::new();
    }
    let n = points.len();
    let mut widths = Vec::with_capacity(n);
    let mut alphas = Vec::with_capacity(n);
    for at in &s {
        let f = at / total;
        widths.push(width_along(p, *at, total));
        // A dry tail thins out over the last third of the line.
        let tail = ((f - 2.0 / 3.0) * 3.0).clamp(0.0, 1.0);
        alphas.push(1.0 - p.dry_tail * tail);
    }

    let mut runs = Vec::new();
    match p.breaks {
        None => runs.push((0, n - 1)),
        Some((every, gap)) => {
            let mut from = 0usize;
            let mut k = 0u32;
            let mut next = every * (0.75 + 0.5 * seeded(p.seed, id, k));
            loop {
                let stop = s.partition_point(|at| *at < next);
                if stop >= n {
                    runs.push((from, n - 1));
                    break;
                }
                if stop > from + 1 {
                    runs.push((from, stop));
                }
                from = s.partition_point(|at| *at < next + gap);
                if from >= n - 1 {
                    break;
                }
                k += 1;
                next = s[from] + every * (0.75 + 0.5 * seeded(p.seed, id, k));
            }
        }
    }
    let mut out: Vec<Run> = runs
        .into_iter()
        .map(|(a, b)| Run {
            points: points[a..=b].to_vec(),
            widths: widths[a..=b].to_vec(),
            alphas: alphas[a..=b].to_vec(),
        })
        .collect();
    if let Some((offset, opacity)) = p.double {
        let shadow = Outline {
            points: points.clone(),
            closed: false,
        };
        let shifted: Vec<Point> = points
            .iter()
            .zip(shadow.normals())
            .map(|(q, m)| [q[0] + m[0] * offset, q[1] + m[1] * offset])
            .collect();
        out.push(Run {
            points: shifted,
            widths,
            alphas: vec![opacity; n],
        });
    }
    out
}

/// An outline as one run, resampled, with nothing added: where line weight alone varies a width.
pub fn evenly(outline: &Outline) -> Vec<Run> {
    let points = fine(outline, STEP);
    let n = points.len();
    vec![Run {
        points,
        widths: vec![1.0; n],
        alphas: vec![1.0; n],
    }]
}

/// Line weight by light at `points` that lie along `outline`: each takes the factor of its nearest
/// outline point, so a run keeps the outline's outward normals, whichever way it was cut.
pub fn weight_at(outline: &Outline, points: &[Point], light: Point, weight: f64) -> Vec<f64> {
    if weight == 0.0 {
        return vec![1.0; points.len()];
    }
    let factors = weight_by_light(outline, light, weight);
    points
        .iter()
        .map(|p| {
            let mut best = (f64::MAX, 1.0);
            for (q, f) in outline.points.iter().zip(&factors) {
                let d = sub(*p, *q);
                let d = dot(d, d);
                if d < best.0 {
                    best = (d, *f);
                }
            }
            best.1
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn circle(r: f64, n: usize) -> Outline {
        Outline {
            points: (0..n)
                .map(|i| {
                    let a = std::f64::consts::TAU * i as f64 / n as f64;
                    [r * ops::cos(a), r * ops::sin(a)]
                })
                .collect(),
            closed: true,
        }
    }

    #[test]
    fn a_circles_side_away_from_the_light_is_one_plus_weight_as_wide() {
        let c = circle(50.0, 720);
        let l = [1.0, 0.0];
        let w = weight_by_light(&c, l, 0.8);
        // Point 0 sits at +x, toward the light; point 360 at -x, away from it.
        assert!((w[0] - 1.0).abs() < 1e-9, "{}", w[0]);
        assert!((w[360] - 1.8).abs() < 1e-3, "{}", w[360]);
    }

    #[test]
    fn a_rim_stays_within_its_reach_of_its_direction() {
        let c = circle(29.0, 720);
        let l = direction(160.0);
        let bands = rim(&c, |_| l, 3.5);
        assert_eq!(bands.len(), 1);
        for p in &bands[0].points {
            let a = dot(unit(*p), l);
            assert!(a > 0.68, "{p:?} is {a}");
        }
    }
}
