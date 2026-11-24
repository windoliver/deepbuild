//! #3258: what `through` reads of a world's shapes, in f64 from the document alone, apart from any
//! backend's own contacts. A shape use is its convex solids (a sphere, a box, a capsule, a
//! cylinder, a hull and a compound's children), each at its place in its body, and its faces with
//! no inside (a plane, a heightfield, a mesh). A solid answers how deep a point is, where a
//! straight path goes into it and comes out, and how far a set of points is from it.

use deep_canvas::ops;

use crate::backend::{product, rotate};
use crate::doc::{Pose, Rot, Shape, World};

pub(super) type V3 = [f64; 3];
/// A box by its least and greatest corner.
pub(super) type Bounds = (V3, V3);

/// How near, m, counts as touching.
const TOUCH: f64 = 1e-9;

pub(super) fn add(a: V3, b: V3) -> V3 {
    [0, 1, 2].map(|i| a[i] + b[i])
}
pub(super) fn sub(a: V3, b: V3) -> V3 {
    [0, 1, 2].map(|i| a[i] - b[i])
}
pub(super) fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub(super) fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
pub(super) fn lerp(a: V3, b: V3, t: f64) -> V3 {
    [0, 1, 2].map(|i| a[i] + t * (b[i] - a[i]))
}
pub(super) fn len(a: V3) -> f64 {
    ops::sqrt(dot(a, a))
}
fn unit(a: V3) -> V3 {
    let l = len(a).max(f64::MIN_POSITIVE);
    a.map(|x| x / l)
}
/// The box that holds two.
pub(super) fn join(a: &Bounds, b: &Bounds) -> Bounds {
    (
        [0, 1, 2].map(|i| a.0[i].min(b.0[i])),
        [0, 1, 2].map(|i| a.1[i].max(b.1[i])),
    )
}
/// The box that holds `points`, one that meets nothing for none.
pub(super) fn bounds(points: impl IntoIterator<Item = V3>) -> Bounds {
    let mut points = points.into_iter();
    let Some(first) = points.next() else {
        return ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    };
    points.fold((first, first), |b, p| join(&b, &(p, p)))
}
pub(super) fn overlap(a: &Bounds, b: &Bounds) -> bool {
    (0..3).all(|i| a.0[i] <= b.1[i] && b.0[i] <= a.1[i])
}

/// A place and a turn, the turn a unit quaternion `[x, y, z, w]`.
#[derive(Clone, Copy, Debug)]
pub(super) struct Frame {
    at: V3,
    rot: [f64; 4],
}

impl Frame {
    pub(super) fn new(at: V3, rot: [f64; 4]) -> Frame {
        let l = ops::sqrt(rot.iter().map(|x| x * x).sum());
        Frame {
            at,
            rot: rot.map(|x| x / l),
        }
    }

    fn of(p: &Pose) -> Frame {
        let turn = |axis: usize, deg: f64| {
            let (h, mut q) = (ops::rad(deg) / 2.0, [0.0; 4]);
            (q[axis], q[3]) = (ops::sin(h), ops::cos(h));
            q
        };
        let rot = match &p.rot {
            Rot::Quat(q) => *q,
            Rot::Deg(d) => product(product(turn(0, d[0]), turn(1, d[1])), turn(2, d[2])),
        };
        Frame::new(p.pos, rot)
    }

    /// `child`, placed in this frame, in the frame this one is placed in.
    pub(super) fn of_child(&self, child: &Frame) -> Frame {
        Frame {
            at: add(self.at, rotate(self.rot, child.at)),
            rot: product(self.rot, child.rot),
        }
    }

    /// The point `x`, read in this frame.
    pub(super) fn local(&self, x: V3) -> V3 {
        let [a, b, c, w] = self.rot;
        rotate([-a, -b, -c, w], sub(x, self.at))
    }

    /// The direction `n` of this frame, turned out of it.
    pub(super) fn turned(&self, n: V3) -> V3 {
        rotate(self.rot, n)
    }

    /// The box around `b`, a box of this frame, out of it.
    pub(super) fn around(&self, b: &Bounds) -> Bounds {
        let corner = |k: usize| [0, 1, 2].map(|i| if k >> i & 1 == 0 { b.0[i] } else { b.1[i] });
        bounds((0..8).map(|k| add(self.at, self.turned(corner(k)))))
    }
}

/// A solid's core, which `round` grows.
#[derive(Clone, Debug)]
enum Core {
    /// A hull's corners, and the half spaces n·x ≤ d that bound it.
    Points(Vec<V3>, Vec<(V3, f64)>),
    /// From −half to half along y; a sphere's is a point.
    Segment(f64),
    /// A cylinder along y.
    Disc { half: f64, radius: f64 },
}

/// A convex solid at its place in its body.
#[derive(Clone, Debug)]
pub(super) struct Solid {
    pub(super) frame: Frame,
    core: Core,
    round: f64,
    pub(super) bounds: Bounds,
    /// Its thinnest extent, m.
    pub(super) thin: f64,
}

/// Where a path goes into a solid and comes out, as shares of the path (below 0 when it started
/// inside, above 1 when it ended inside), with the solid's outward normal at each.
pub(super) struct Span {
    pub(super) t: [f64; 2],
    pub(super) n: [V3; 2],
}

/// The half spaces that bound the hull of `points`, one a face: each plane through three of them
/// with every other on one side.
fn planes(points: &[V3]) -> Vec<(V3, f64)> {
    let (lo, hi) = bounds(points.iter().copied());
    let eps = 1e-9 * len(sub(hi, lo));
    let mut out: Vec<(V3, f64)> = Vec::new();
    for (i, a) in points.iter().enumerate() {
        for (j, b) in points.iter().enumerate().skip(i + 1) {
            for c in &points[j + 1..] {
                let n = cross(sub(*b, *a), sub(*c, *a));
                if len(n) <= eps * eps {
                    continue;
                }
                for n in [unit(n), unit(n).map(|x| -x)] {
                    let d = dot(n, *a);
                    let same = |p: &(V3, f64)| dot(p.0, n) > 1.0 - 1e-12;
                    if points.iter().all(|p| dot(n, *p) <= d + eps) && !out.iter().any(same) {
                        out.push((n, d));
                    }
                }
            }
        }
    }
    out
}

/// The least width of the hull of `points` between two parallel planes: over its faces' normals
/// and each pair of its edges' common perpendicular.
fn width(points: &[V3], planes: &[(V3, f64)]) -> f64 {
    let (lo, hi) = bounds(points.iter().copied());
    let eps = 1e-9 * len(sub(hi, lo));
    let on = |p: V3, (n, d): &(V3, f64)| dot(*n, p) > d - eps;
    let mut edges = Vec::new();
    for (i, a) in points.iter().enumerate() {
        for b in &points[i + 1..] {
            if planes.iter().filter(|f| on(*a, f) && on(*b, f)).count() > 1 {
                edges.push(sub(*b, *a));
            }
        }
    }
    let across = |n: V3| {
        let along = points.iter().map(|p| dot(n, *p));
        let (lo, hi) = along.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), x| {
            (lo.min(x), hi.max(x))
        });
        hi - lo
    };
    let pairs = edges.iter().enumerate();
    let pairs = pairs.flat_map(|(i, a)| edges[i + 1..].iter().map(|b| cross(*a, *b)));
    let normals = planes.iter().map(|(n, _)| *n);
    let all = normals.chain(pairs.filter(|n| len(*n) > eps * eps).map(unit));
    all.map(across).fold(f64::INFINITY, f64::min)
}

impl Solid {
    fn new(frame: Frame, core: Core, round: f64) -> Solid {
        let (inner, thin) = match &core {
            Core::Points(p, f) => (bounds(p.iter().copied()), width(p, f)),
            Core::Segment(h) => (([0.0, -h, 0.0], [0.0, *h, 0.0]), 0.0),
            Core::Disc { half, radius: r } => {
                (([-r, -half, -r], [*r, *half, *r]), 2.0 * half.min(*r))
            }
        };
        Solid {
            frame,
            core,
            round,
            bounds: (inner.0.map(|x| x - round), inner.1.map(|x| x + round)),
            thin: thin + 2.0 * round,
        }
    }

    /// How far outside `x` is, m, below 0 inside; convex along any line.
    fn out(&self, x: V3) -> f64 {
        match &self.core {
            Core::Points(_, planes) => {
                let faces = planes.iter().map(|(n, d)| dot(*n, x) - d);
                let most = faces.fold(f64::NEG_INFINITY, f64::max);
                if self.round > 0.0 && most > 0.0 {
                    return self.apart(&[x]).0;
                }
                most - self.round
            }
            Core::Segment(h) => len([x[0], x[1] - x[1].clamp(-h, *h), x[2]]) - self.round,
            Core::Disc { half, radius } => (x[1].abs() - half).max(ops::hypot(x[0], x[2]) - radius),
        }
    }

    /// The outward normal at `x`, a point of its surface.
    fn normal(&self, x: V3) -> V3 {
        match &self.core {
            Core::Points(_, planes) => {
                if self.round > 0.0 {
                    return self.apart(&[x]).1;
                }
                let faces = planes.iter().map(|(n, d)| (dot(*n, x) - d, *n));
                let top = faces.max_by(|a, b| a.0.total_cmp(&b.0));
                top.map_or([0.0; 3], |f| f.1)
            }
            Core::Segment(h) => unit([x[0], x[1] - x[1].clamp(-h, *h), x[2]]),
            Core::Disc { half, radius } => {
                if x[1].abs() - half > ops::hypot(x[0], x[2]) - radius {
                    [0.0, x[1].signum(), 0.0]
                } else {
                    unit([x[0], 0.0, x[2]])
                }
            }
        }
    }

    /// Where the straight path from `a` to `b` is inside, if it is anywhere.
    pub(super) fn cross(&self, a: V3, b: V3) -> Option<Span> {
        if !overlap(&self.bounds, &bounds([a, b])) {
            return None;
        }
        let out = |t: f64| self.out(lerp(a, b, t));
        let (starts, ends) = (self.out(a) < 0.0, self.out(b) < 0.0);
        // A share of the path that is inside: an end, or where the path is deepest.
        let (mut lo, mut hi) = (0.0, 1.0);
        let inside = match (starts, ends) {
            (true, _) => 0.0,
            (_, true) => 1.0,
            _ => {
                for _ in 0..64 {
                    let (x, y) = (lo + (hi - lo) / 3.0, hi - (hi - lo) / 3.0);
                    if out(x) < out(y) {
                        hi = y;
                    } else {
                        lo = x;
                    }
                }
                (lo + hi) / 2.0
            }
        };
        if out(inside) >= 0.0 {
            return None;
        }
        // Where the surface is crossed between `inside` and the end at share `end`, outside.
        let surface = |end: f64| {
            let (mut i, mut o) = (inside, end);
            for _ in 0..60 {
                let m = (i + o) / 2.0;
                if out(m) < 0.0 {
                    i = m;
                } else {
                    o = m;
                }
            }
            (o, self.normal(lerp(a, b, o)))
        };
        let (t0, n0) = if starts {
            (-1.0, [0.0; 3])
        } else {
            surface(0.0)
        };
        let (t1, n1) = if ends { (2.0, [0.0; 3]) } else { surface(1.0) };
        Some(Span {
            t: [t0, t1],
            n: [n0, n1].map(|n| self.frame.turned(n)),
        })
    }

    /// Its core's farthest point along `d`.
    fn support(&self, d: V3) -> V3 {
        match &self.core {
            Core::Points(p, _) => farthest(p, d),
            Core::Segment(h) => [0.0, if d[1] < 0.0 { -h } else { *h }, 0.0],
            Core::Disc { half, radius } => {
                let l = ops::hypot(d[0], d[2]).max(f64::MIN_POSITIVE);
                let y = if d[1] < 0.0 { -half } else { *half };
                [radius * d[0] / l, y, radius * d[2] / l]
            }
        }
    }

    /// How far the hull of `set` is from it, and the direction from it to them.
    pub(super) fn apart(&self, set: &[V3]) -> (f64, V3) {
        let (d, n) = apart(set, &|d| self.support(d));
        (d - self.round, n)
    }
}

pub(super) fn farthest(points: &[V3], d: V3) -> V3 {
    let mut best = points[0];
    for p in &points[1..] {
        if dot(*p, d) > dot(best, d) {
            best = *p;
        }
    }
    best
}

/// The point of the hull of `s`, at most four points, nearest the origin, and the fewest of them
/// whose hull holds it.
fn nearest(s: &[V3]) -> (V3, Vec<V3>) {
    let mut best: Option<(f64, V3, usize)> = None;
    for mask in 1usize..1 << s.len() {
        let picked: Vec<V3> = (0..s.len())
            .filter(|i| mask >> i & 1 == 1)
            .map(|i| s[i])
            .collect();
        let (p0, rest) = (picked[0], &picked[1..]);
        let k = rest.len();
        // The shares of the other points at the nearest point of their plane, by elimination.
        let e: Vec<V3> = rest.iter().map(|p| sub(*p, p0)).collect();
        let mut m = [[0.0; 4]; 3];
        for i in 0..k {
            for j in 0..k {
                m[i][j] = dot(e[i], e[j]);
            }
            m[i][k] = -dot(e[i], p0);
        }
        let scale: f64 = (0..k).map(|i| m[i][i]).fold(0.0, f64::max);
        let mut flat = false;
        for i in 0..k {
            let pivot = m[i];
            flat |= pivot[i] <= 1e-14 * scale;
            for row in m.iter_mut().take(k).skip(i + 1) {
                let f = row[i] / pivot[i];
                for (x, y) in row.iter_mut().zip(pivot) {
                    *x -= f * y;
                }
            }
        }
        if flat {
            continue;
        }
        let mut share = [0.0; 3];
        for i in (0..k).rev() {
            let known: f64 = (i + 1..k).map(|j| m[i][j] * share[j]).sum();
            share[i] = (m[i][k] - known) / m[i][i];
        }
        if share[..k].iter().any(|x| *x < 0.0) || share[..k].iter().sum::<f64>() > 1.0 {
            continue;
        }
        let p = e
            .iter()
            .zip(share)
            .fold(p0, |p, (e, x)| add(p, e.map(|c| c * x)));
        if best.is_none_or(|b| dot(p, p) < b.0) {
            best = Some((dot(p, p), p, mask));
        }
    }
    let (_, p, mask) = best.unwrap_or((0.0, s[0], 1));
    let held = (0..s.len()).filter(|i| mask >> i & 1 == 1).map(|i| s[i]);
    (p, held.collect())
}

/// How far the hull of `set` is from the convex set `support` answers for (its farthest point
/// along a direction), and the unit direction from it to them, zero where they meet: the point of
/// the two sets' difference nearest the origin.
pub(super) fn apart(set: &[V3], support: &dyn Fn(V3) -> V3) -> (f64, V3) {
    let mut v = sub(set[0], support(set[0]));
    let mut simplex: Vec<V3> = Vec::new();
    for _ in 0..48 {
        let vv = dot(v, v);
        if vv <= TOUCH * TOUCH * 1e-6 {
            return (0.0, [0.0; 3]);
        }
        let w = sub(farthest(set, v.map(|x| -x)), support(v));
        if vv - dot(v, w) <= 1e-12 * vv || simplex.contains(&w) {
            break;
        }
        simplex.push(w);
        (v, simplex) = nearest(&simplex);
        if simplex.len() == 4 {
            return (0.0, [0.0; 3]);
        }
    }
    (len(v), unit(v))
}

/// Whether the hull of points moving in straight lines from `from` to `to` meets the convex set
/// `far` answers for (`apart`'s distance and direction of a set from it) anywhere on the way: from
/// each time it is moved on to the first at which, closing as fast as it can, it could touch.
pub(super) fn meets(from: &[V3], to: &[V3], far: &dyn Fn(&[V3]) -> (f64, V3)) -> bool {
    let mut t = 0.0;
    let mut gap = f64::INFINITY;
    for _ in 0..64 {
        let now: Vec<V3> = from.iter().zip(to).map(|(a, b)| lerp(*a, *b, t)).collect();
        let (d, n) = far(&now);
        gap = d;
        if d <= TOUCH {
            return true;
        }
        let moves = from.iter().zip(to).map(|(a, b)| dot(n, sub(*a, *b)));
        let closing = moves.fold(0.0, f64::max);
        t += d / closing;
        if t > 1.0 || closing == 0.0 {
            return false;
        }
    }
    gap <= 1e3 * TOUCH
}

/// Boxes, in order of where each starts along one axis, so those that may meet another are found
/// without reading the rest.
#[derive(Clone, Debug)]
pub(super) struct Sorted {
    axis: usize,
    boxes: Vec<Bounds>,
    /// Where each starts, and its place in `boxes`.
    order: Vec<(f64, usize)>,
    widest: f64,
}

impl Sorted {
    pub(super) fn new(axis: usize, boxes: impl Iterator<Item = Bounds>) -> Sorted {
        let boxes: Vec<Bounds> = boxes.collect();
        let starts = boxes.iter().enumerate().map(|(i, b)| (b.0[axis], i));
        let mut order: Vec<_> = starts.collect();
        order.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        let wide = boxes.iter().map(|b| b.1[axis] - b.0[axis]);
        let widest = wide.fold(0.0, f64::max);
        Sorted {
            axis,
            boxes,
            order,
            widest,
        }
    }

    /// Those from place `first` of the order on that meet `b`.
    fn from<'a>(&'a self, first: usize, b: &'a Bounds) -> impl Iterator<Item = usize> + 'a {
        let end = b.1[self.axis];
        let near = self.order[first..].iter();
        let near = near.take_while(move |(x, _)| *x <= end).map(|(_, i)| *i);
        near.filter(move |i| overlap(&self.boxes[*i], b))
    }

    /// Those that meet `b`.
    pub(super) fn near<'a>(&'a self, b: &'a Bounds) -> impl Iterator<Item = usize> + 'a {
        let start = b.0[self.axis] - self.widest;
        self.from(self.order.partition_point(|(x, _)| *x < start), b)
    }

    /// Each two that meet.
    pub(super) fn pairs(&self) -> impl Iterator<Item = (usize, usize)> + '_ {
        let order = self.order.iter().enumerate();
        order.flat_map(|(k, (_, i))| {
            let after = self.from(k + 1, &self.boxes[*i]);
            after.map(|j| (*i.min(&j), *i.max(&j)))
        })
    }
}

/// Faces with no inside.
#[derive(Clone, Debug)]
pub(super) enum Faces {
    /// Behind its normal.
    Plane(V3),
    /// A mesh's triangles.
    Mesh(Vec<[V3; 3]>, Sorted),
    Heightfield {
        cols: usize,
        rows: usize,
        heights: Vec<f64>,
        scale: V3,
    },
}

impl Faces {
    /// Each triangle that may meet the box `b`.
    pub(super) fn near(&self, b: &Bounds) -> Vec<[V3; 3]> {
        match self {
            Faces::Plane(_) => Vec::new(),
            Faces::Mesh(all, boxes) => boxes.near(b).map(|i| all[i]).collect(),
            Faces::Heightfield {
                cols,
                rows,
                heights,
                scale,
            } => {
                let (nx, nz) = ((cols - 1) as f64, (rows - 1) as f64);
                let cell = |x: f64, side: usize, n: f64| {
                    ((x / scale[side] + 0.5) * n).floor().clamp(0.0, n - 1.0) as usize
                };
                let at = |c: usize, r: usize| {
                    [
                        (c as f64 / nx - 0.5) * scale[0],
                        heights[r * cols + c] * scale[1],
                        (r as f64 / nz - 0.5) * scale[2],
                    ]
                };
                let mut out = Vec::new();
                for r in cell(b.0[2], 2, nz)..=cell(b.1[2], 2, nz) {
                    for c in cell(b.0[0], 0, nx)..=cell(b.1[0], 0, nx) {
                        let (p, q) = (at(c, r + 1), at(c + 1, r));
                        out.extend([[at(c, r), p, q], [q, p, at(c + 1, r + 1)]]);
                    }
                }
                out
            }
        }
    }

    /// The box around them, infinite for a plane; and a mesh's thinnest side, infinite for the
    /// others, which have ground behind them.
    fn size(&self) -> (Bounds, f64) {
        let everywhere = ([f64::NEG_INFINITY; 3], [f64::INFINITY; 3]);
        match self {
            Faces::Plane(_) | Faces::Heightfield { .. } => (everywhere, f64::INFINITY),
            Faces::Mesh(all, _) => {
                let b = bounds(all.iter().flatten().copied());
                let sides = sub(b.1, b.0);
                (b, sides[0].min(sides[1]).min(sides[2]))
            }
        }
    }
}

/// The unit normal of the triangle `t`, as it is wound; none for one with no area.
pub(super) fn normal([a, b, c]: &[V3; 3]) -> Option<V3> {
    let n = cross(sub(*b, *a), sub(*c, *a));
    (len(n) > 0.0).then(|| unit(n))
}

/// Faces at their place in their body.
#[derive(Clone, Debug)]
pub(super) struct Sheet {
    pub(super) frame: Frame,
    pub(super) faces: Faces,
    pub(super) bounds: Bounds,
    pub(super) thin: f64,
}

/// The solids of `w`'s shape `id` placed at `at`, or its faces where it has no inside.
pub(super) fn parts(w: &World, id: &str, at: &Pose) -> (Vec<Solid>, Option<Sheet>) {
    let at = Frame::of(at);
    let Some(Shape::Compound { children }) = w.shapes.get(id) else {
        return match part(w, id, at) {
            Some(Ok(solid)) => (vec![solid], None),
            Some(Err(sheet)) => (Vec::new(), Some(sheet)),
            None => (Vec::new(), None),
        };
    };
    let child = |(id, p): &(String, Pose)| part(w, id, at.of_child(&Frame::of(p)))?.ok();
    (children.iter().filter_map(child).collect(), None)
}

/// The one solid, or the faces, of `w`'s shape `id`, which is no compound.
fn part(w: &World, id: &str, at: Frame) -> Option<Result<Solid, Sheet>> {
    let faces = |faces: Faces| {
        let (bounds, thin) = faces.size();
        Some(Err(Sheet {
            frame: at,
            faces,
            bounds,
            thin,
        }))
    };
    let hull = |points: Vec<V3>| {
        let faces = planes(&points);
        Core::Points(points, faces)
    };
    let (core, round) = match w.shapes.get(id) {
        None | Some(Shape::Compound { .. }) => return None,
        Some(Shape::Sphere { radius }) => (Core::Segment(0.0), *radius),
        Some(Shape::Capsule {
            half_height,
            radius,
        }) => (Core::Segment(*half_height), *radius),
        Some(Shape::Cylinder {
            half_height: half,
            radius,
        }) => {
            let (half, radius) = (*half, *radius);
            (Core::Disc { half, radius }, 0.0)
        }
        Some(Shape::Box { half }) => {
            let corner =
                |k: usize| [0, 1, 2].map(|i| if k >> i & 1 == 0 { -half[i] } else { half[i] });
            let side = |k: usize| {
                let mut n = [0.0; 3];
                n[k / 2] = if k % 2 == 0 { -1.0 } else { 1.0 };
                (n, half[k / 2])
            };
            let faces = (0..6).map(side).collect();
            (Core::Points((0..8).map(corner).collect(), faces), 0.0)
        }
        Some(Shape::Convex { points, radius }) => (hull(points.clone()), *radius),
        Some(Shape::Plane { normal }) => return faces(Faces::Plane(unit(*normal))),
        Some(Shape::Mesh {
            vertices,
            triangles,
        }) => {
            let corners = triangles.iter().map(|t| t.map(|i| vertices[i as usize]));
            let all: Vec<[V3; 3]> = corners.collect();
            let boxes = Sorted::new(0, all.iter().map(|t| bounds(*t)));
            return faces(Faces::Mesh(all, boxes));
        }
        Some(Shape::Heightfield {
            cols,
            rows,
            heights,
            scale,
        }) => {
            return faces(Faces::Heightfield {
                cols: *cols,
                rows: *rows,
                heights: heights.clone(),
                scale: *scale,
            })
        }
    };
    Some(Ok(Solid::new(at, core, round)))
}
