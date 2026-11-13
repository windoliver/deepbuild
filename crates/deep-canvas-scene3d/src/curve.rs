//! Curve `curve@1` (canvas primitives: Curve `curve@1`, its bspline mode and closed frames;
//! issues #420, #441): points with stable ids, as one cubic span between each two (linear,
//! bezier, catmull_rom, auto or bspline), with an arc-length table made at check by
//! Gauss-Legendre quadrature per span, queries by a fixed two Newton steps, and frames that are
//! rotation-minimizing by double reflection (or follow `up`). On a closed curve the frames'
//! mismatch at the seam, `closure`, is spread over the loop by arc length, so they meet there.
//! Tube, follow_path, curve_deform, repeat along and the sweep read it through [`Curve`]; the
//! polyline [`Sampled`] is its table's points, for readers that walk a polyline.

use deep_canvas::ops::{atan2, cos, pow, rad, sin, sqrt};
use serde_json::Value;

use crate::geom::{add, cross, dot, length, scale, sub, unit, V3};

/// A curve as a polyline: its points (a closed curve doesn't repeat its first), whether it
/// closes, and a `curve@1`'s own frame normal at each point (none for bare points).
#[derive(Clone, Debug, PartialEq)]
pub struct Sampled {
    pub points: Vec<V3>,
    pub closed: bool,
    pub normals: Vec<V3>,
    /// A `curve@1`'s u (fraction of arc length) at each point (none for bare points).
    pub us: Vec<f64>,
    /// A smooth `curve@1`'s own tangent at each point (none for bare points or a linear curve,
    /// whose corners take the polyline's).
    pub tangents: Vec<V3>,
}

fn v3(v: &Value) -> Option<V3> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// A list of points, or `None` when it isn't one.
pub fn points(v: &Value) -> Option<Vec<V3>> {
    v.as_array()?.iter().map(v3).collect()
}

/// The modes a curve takes.
const MODES: [&str; 5] = ["linear", "bezier", "catmull_rom", "auto", "bspline"];

/// Gauss-Legendre nodes and weights on [-1, 1], five points.
const GL: [(f64, f64); 5] = [
    (0.0, 0.568_888_888_888_888_9),
    (-0.538_469_310_105_683_1, 0.478_628_670_499_366_5),
    (0.538_469_310_105_683_1, 0.478_628_670_499_366_5),
    (-0.906_179_845_938_664, 0.236_926_885_056_189_1),
    (0.906_179_845_938_664, 0.236_926_885_056_189_1),
];

/// One frame: where it is, its unit tangent and its normal (the binormal is tangent × normal).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub point: V3,
    pub tangent: V3,
    pub normal: V3,
}

impl Frame {
    /// tangent × normal: the frame's third axis.
    pub fn binormal(&self) -> V3 {
        cross(self.tangent, self.normal)
    }
}

/// One node of the arc-length table: its span, its parameter there, its arc length from the
/// start, and the frame carried to it (before the closure is spread and roll added).
#[derive(Clone, Copy, Debug)]
struct Node {
    span: usize,
    t: f64,
    s: f64,
    frame: Frame,
}

/// A `curve@1` made at check: its cubic spans, its arc-length table and its frames.
#[derive(Clone, Debug)]
pub struct Curve {
    /// Each span as a cubic Bézier.
    pub spans: Vec<[V3; 4]>,
    /// The points as given, and their stable ids.
    pub points: Vec<V3>,
    pub ids: Vec<u32>,
    pub closed: bool,
    pub mode: String,
    /// Arc length where each span starts, and the whole length after the last.
    pub starts: Vec<f64>,
    pub length: f64,
    /// The rotation-minimizing frame's mismatch at the seam before it's spread, in radians
    /// (0 on an open curve or with `up` frames).
    pub closure: f64,
    /// Arc length at each point, and its roll there (radians).
    roll: Vec<(f64, f64)>,
    up: Option<V3>,
    nodes: Vec<Node>,
    /// Leave the closure unspread: the wrong program #441's AC2 plants.
    pub seam_twist: bool,
}

fn bezier(b: &[V3; 4], t: f64) -> V3 {
    let m = 1.0 - t;
    let w = [m * m * m, 3.0 * m * m * t, 3.0 * m * t * t, t * t * t];
    let mut out = [0.0; 3];
    for (p, w) in b.iter().zip(w) {
        out = add(out, scale(*p, w));
    }
    out
}

/// The span's first, second and third derivatives at t.
fn derivatives(b: &[V3; 4], t: f64) -> [V3; 3] {
    let m = 1.0 - t;
    let d = [sub(b[1], b[0]), sub(b[2], b[1]), sub(b[3], b[2])];
    let d1 = scale(
        add(
            add(scale(d[0], m * m), scale(d[1], 2.0 * m * t)),
            scale(d[2], t * t),
        ),
        3.0,
    );
    let e = [sub(d[1], d[0]), sub(d[2], d[1])];
    let d2 = scale(add(scale(e[0], m), scale(e[1], t)), 6.0);
    let d3 = scale(sub(e[1], e[0]), 6.0);
    [d1, d2, d3]
}

/// The direction the span moves at t: its first derivative's, or where that vanishes (an open
/// bspline's repeated end points) the first derivative that doesn't.
fn heading(b: &[V3; 4], t: f64) -> V3 {
    let ds = derivatives(b, t);
    let d = ds.into_iter().find(|d| length(*d) > 1e-12).unwrap_or(ds[0]);
    // Past a cusp-free start the second and third derivatives point the way the curve goes.
    let ahead = sub(
        bezier(b, (t + 1e-3).min(1.0)),
        bezier(b, (t - 1e-3).max(0.0)),
    );
    if dot(d, ahead) < 0.0 {
        unit(scale(d, -1.0))
    } else {
        unit(d)
    }
}

/// Arc length of the span from `a` to `b` by five-point Gauss-Legendre.
fn arc(span: &[V3; 4], a: f64, b: f64) -> f64 {
    let (h, c) = (0.5 * (b - a), 0.5 * (b + a));
    GL.iter()
        .map(|(x, w)| w * length(derivatives(span, c + h * x)[0]))
        .sum::<f64>()
        * h
}

/// `v` turned about the unit axis `k` by `a` radians.
fn rotate(v: V3, k: V3, a: f64) -> V3 {
    let (c, s) = (cos(a), sin(a));
    add(
        add(scale(v, c), scale(cross(k, v), s)),
        scale(k, dot(k, v) * (1.0 - c)),
    )
}

/// The normal `r` carried from (x0, t0) to (x1, t1) with the least rotation: two reflections
/// (Wang, Jüttler, Zheng and Liu 2008), or where the two points meet (a corner) the turn about
/// t0 × t1 that takes t0 to t1.
pub fn transport(r: V3, x0: V3, t0: V3, x1: V3, t1: V3) -> V3 {
    let v1 = sub(x1, x0);
    let c1 = dot(v1, v1);
    if c1 < 1e-24 {
        let axis = cross(t0, t1);
        let s = length(axis);
        if s < 1e-15 {
            return r;
        }
        return unit(rotate(r, scale(axis, 1.0 / s), atan2(s, dot(t0, t1))));
    }
    let rl = sub(r, scale(v1, 2.0 / c1 * dot(v1, r)));
    let tl = sub(t0, scale(v1, 2.0 / c1 * dot(v1, t0)));
    let v2 = sub(t1, tl);
    let c2 = dot(v2, v2);
    let out = if c2 < 1e-30 {
        rl
    } else {
        sub(rl, scale(v2, 2.0 / c2 * dot(v2, rl)))
    };
    unit(sub(out, scale(t1, dot(out, t1))))
}

/// The normal `up` gives a tangent: `up` with its part along the tangent taken out (another axis
/// where they're parallel).
fn normal_from(up: V3, t: V3) -> V3 {
    let n = sub(up, scale(t, dot(up, t)));
    if length(n) > 1e-9 {
        return unit(n);
    }
    let alt = if t[0].abs() < 0.9 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 0.0, 1.0]
    };
    unit(sub(alt, scale(t, dot(alt, t))))
}

/// The signed angle from `a` to `b` about the unit axis `k`.
fn angle(a: V3, b: V3, k: V3) -> f64 {
    atan2(dot(cross(a, b), k), dot(a, b))
}

fn column(p: &Value, name: &str, n: usize) -> Result<Option<Vec<V3>>, String> {
    match p.get(name) {
        None => Ok(None),
        Some(v) => points(v)
            .filter(|c| c.len() == n && c.iter().flatten().all(|x| x.is_finite()))
            .map(Some)
            .ok_or_else(|| format!("params/{name}")),
    }
}

fn number(p: &Value, name: &str, default: f64) -> Result<f64, String> {
    match p.get(name) {
        None => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite())
            .ok_or_else(|| format!("params/{name}")),
    }
}

impl Curve {
    /// A `curve@1` item's params made into a curve, or why not (the path of the bad field).
    pub fn new(params: &Value) -> Result<Curve, String> {
        Curve::made(params, None).map(|(c, _)| c)
    }

    /// `new`, with how long tabulating its arc-length table over every span took by `clock`, in
    /// milliseconds, its frames apart (#2017's `geometry` timings).
    pub fn timed(params: &Value, clock: fn() -> f64) -> Result<(Curve, f64), String> {
        Curve::made(params, Some(clock)).map(|(c, ms)| (c, ms.unwrap_or(0.0)))
    }

    fn made(params: &Value, clock: Option<fn() -> f64>) -> Result<(Curve, Option<f64>), String> {
        let pts = params
            .get("points")
            .and_then(points)
            .filter(|p| p.len() >= 2)
            .ok_or("params/points")?;
        let n = pts.len();
        if let Some(k) = pts.iter().position(|p| p.iter().any(|x| !x.is_finite())) {
            return Err(format!("params/points/{k}"));
        }
        let closed = match params.get("closed") {
            None => false,
            Some(v) => v.as_bool().ok_or("params/closed")?,
        };
        let pairs = if closed { n } else { n - 1 };
        for k in 0..pairs {
            if length(sub(pts[(k + 1) % n], pts[k])) < 1e-12 {
                return Err(format!("params/points/{}", (k + 1) % n));
            }
        }
        let ids: Vec<u32> = match params.get("ids") {
            None => (0..n as u32).collect(),
            Some(v) => {
                let ids: Option<Vec<u32>> = v.as_array().filter(|a| a.len() == n).and_then(|a| {
                    a.iter()
                        .map(|i| i.as_u64().and_then(|i| u32::try_from(i).ok()))
                        .collect()
                });
                let ids = ids.ok_or("params/ids")?;
                let mut sorted = ids.clone();
                sorted.sort_unstable();
                sorted.dedup();
                if sorted.len() != n {
                    return Err("params/ids".into());
                }
                ids
            }
        };
        let mode = match params.get("mode") {
            None => "auto",
            Some(v) => v
                .as_str()
                .filter(|m| MODES.contains(m))
                .ok_or("params/mode")?,
        };
        let samples = match params.get("samples") {
            None => 16,
            Some(v) => v
                .as_u64()
                .filter(|s| (1..=1024).contains(s))
                .ok_or("params/samples")? as usize,
        };
        let spans = match mode {
            "linear" => linear(&pts, closed),
            "bezier" => {
                let h = params.get("handles").ok_or("params/handles")?;
                let hin = column(h, "in", n)
                    .map_err(|_| "params/handles/in")?
                    .unwrap_or_else(|| vec![[0.0; 3]; n]);
                let hout = column(h, "out", n)
                    .map_err(|_| "params/handles/out")?
                    .unwrap_or_else(|| vec![[0.0; 3]; n]);
                (0..pairs)
                    .map(|k| {
                        let j = (k + 1) % n;
                        [pts[k], add(pts[k], hout[k]), add(pts[j], hin[j]), pts[j]]
                    })
                    .collect()
            }
            "catmull_rom" => {
                let alpha = number(params, "alpha", 0.5)?;
                if !(0.0..=1.0).contains(&alpha) {
                    return Err("params/alpha".into());
                }
                catmull_rom(&pts, closed, alpha)
            }
            "bspline" => bspline(&pts, closed),
            _ => auto(&pts, closed),
        };
        let frames_up = match params.get("frames") {
            None => false,
            Some(v) => match v.as_str() {
                Some("rmf") => false,
                Some("up") => true,
                _ => return Err("params/frames".into()),
            },
        };
        let up = match params.get("up") {
            None => [0.0, 1.0, 0.0],
            Some(v) => v3(v)
                .filter(|u| u.iter().all(|x| x.is_finite()) && length(*u) > 1e-9)
                .map(unit)
                .ok_or("params/up")?,
        };
        let rolls: Vec<f64> = match params.get("roll") {
            None => vec![0.0; n],
            Some(Value::Number(x)) => vec![rad(x.as_f64().unwrap_or(0.0)); n],
            Some(v) => v
                .as_array()
                .filter(|a| a.len() == n)
                .and_then(|a| {
                    a.iter()
                        .map(|x| x.as_f64().filter(|x| x.is_finite()).map(rad))
                        .collect()
                })
                .ok_or("params/roll")?,
        };
        let mut c = Curve {
            spans,
            points: pts,
            ids,
            closed,
            mode: mode.to_string(),
            starts: Vec::new(),
            length: 0.0,
            closure: 0.0,
            roll: Vec::new(),
            up: frames_up.then_some(up),
            nodes: Vec::new(),
            seam_twist: false,
        };
        let started = clock.map(|now| now());
        c.tabulate(samples);
        let ms = clock.zip(started).map(|(now, s)| now() - s);
        c.carry_frames(up);
        c.roll = c.roll_stations(&rolls);
        Ok((c, ms))
    }

    /// The arc-length table: each span's start, and a node at each of its `samples` steps with
    /// its arc length from the start.
    fn tabulate(&mut self, samples: usize) {
        let mut s = 0.0;
        let mut nodes: Vec<Node> = Vec::with_capacity(self.spans.len() * (samples + 1));
        let still = Frame {
            point: [0.0; 3],
            tangent: [0.0; 3],
            normal: [0.0; 3],
        };
        for (k, span) in self.spans.iter().enumerate() {
            self.starts.push(s);
            for j in 0..=samples {
                let t = j as f64 / samples as f64;
                if j > 0 {
                    s += arc(span, (j - 1) as f64 / samples as f64, t);
                }
                nodes.push(Node {
                    span: k,
                    t,
                    s,
                    frame: still,
                });
            }
        }
        self.length = s;
        self.nodes = nodes;
    }

    /// The frames carried along the table's nodes, and the closure at the seam.
    fn carry_frames(&mut self, up: V3) {
        let t0 = heading(&self.spans[0], 0.0);
        let mut r = normal_from(up, t0);
        for i in 0..self.nodes.len() {
            let Node { span, t, .. } = self.nodes[i];
            let (x, tan) = (bezier(&self.spans[span], t), heading(&self.spans[span], t));
            if let Some(last) = i.checked_sub(1).map(|p| self.nodes[p].frame) {
                r = transport(r, last.point, last.tangent, x, tan);
            }
            self.nodes[i].frame = Frame {
                point: x,
                tangent: tan,
                normal: r,
            };
        }
        if self.closed && self.up.is_none() {
            let last = self.nodes[self.nodes.len() - 1].frame;
            let first = self.nodes[0].frame;
            let carried = transport(
                last.normal,
                last.point,
                last.tangent,
                first.point,
                first.tangent,
            );
            self.closure = angle(first.normal, carried, first.tangent);
        }
    }

    /// Each point's arc length with its roll: an approximating curve's points sit at its span
    /// joints in order.
    fn roll_stations(&self, rolls: &[f64]) -> Vec<(f64, f64)> {
        let n = rolls.len();
        let mut out: Vec<(f64, f64)> = (0..n)
            .map(|k| {
                let f = if self.closed {
                    k as f64 / n as f64
                } else {
                    k as f64 / (n - 1) as f64
                };
                (f * self.length, rolls[k])
            })
            .collect();
        if self.closed {
            out.push((self.length, rolls[0]));
        }
        out
    }

    fn roll_at(&self, s: f64) -> f64 {
        let r = &self.roll;
        if r.iter().all(|(_, a)| *a == 0.0) {
            return 0.0;
        }
        let k = r.partition_point(|(at, _)| *at <= s).clamp(1, r.len() - 1);
        let ((s0, a0), (s1, a1)) = (r[k - 1], r[k]);
        let f = if s1 > s0 {
            ((s - s0) / (s1 - s0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        a0 + (a1 - a0) * f
    }

    /// The span and its parameter at arc length `s`: the span that starts there at a joint, the
    /// last one at the end, and in it a fixed two Newton steps from the table's guess.
    fn locate(&self, s: f64) -> (usize, f64) {
        let s = s.clamp(0.0, self.length);
        let k = self
            .starts
            .partition_point(|a| *a <= s)
            .saturating_sub(1)
            .min(self.spans.len() - 1);
        let span = &self.spans[k];
        let nodes: Vec<&Node> = self.nodes.iter().filter(|n| n.span == k).collect();
        let j = nodes
            .partition_point(|n| n.s <= s)
            .clamp(1, nodes.len() - 1);
        let (a, b) = (nodes[j - 1], nodes[j]);
        // A fixed ten halvings of the table's interval, then two Newton steps from the guess.
        let (mut lo, mut hi) = (a.t, b.t);
        for _ in 0..10 {
            let mid = 0.5 * (lo + hi);
            if a.s + arc(span, a.t, mid) < s {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        let (sl, sh) = (a.s + arc(span, a.t, lo), a.s + arc(span, a.t, hi));
        let mut t = if sh > sl {
            lo + (hi - lo) * (s - sl) / (sh - sl)
        } else {
            lo
        };
        for _ in 0..2 {
            let speed = length(derivatives(span, t)[0]);
            if speed < 1e-12 {
                break;
            }
            let err = a.s + arc(span, a.t, t) - s;
            t = (t - err / speed).clamp(a.t, b.t);
        }
        (k, t)
    }

    /// The frame at `u` (0..1 of arc length): the table's frame before it carried on to the
    /// point, the closure spread by arc length, then the roll there. On a closed curve u = 1 is
    /// the seam, so its frame is u = 0's.
    pub fn frame(&self, u: f64) -> Frame {
        let s = u.clamp(0.0, 1.0) * self.length;
        let (k, t) = self.locate(s);
        let span = &self.spans[k];
        let (x, tan) = (bezier(span, t), heading(span, t));
        let mut normal = match self.up {
            Some(up) => normal_from(up, tan),
            None => {
                let i = self
                    .nodes
                    .iter()
                    .rposition(|n| n.span == k && n.t <= t)
                    .unwrap_or(0);
                let n = self.nodes[i].frame;
                transport(n.normal, n.point, n.tangent, x, tan)
            }
        };
        let mut f = Frame {
            point: x,
            tangent: tan,
            normal,
        };
        if self.closed && u >= 1.0 && self.up.is_none() {
            // Past the seam's corner, where the first span starts again.
            let first = self.nodes[0].frame;
            normal = transport(normal, x, tan, first.point, first.tangent);
            f = Frame {
                point: first.point,
                tangent: first.tangent,
                normal,
            };
        }
        let spread = if self.seam_twist || self.length == 0.0 {
            0.0
        } else {
            -self.closure * s / self.length
        };
        let turn = spread + self.roll_at(s);
        if turn != 0.0 {
            f.normal = unit(rotate(f.normal, f.tangent, turn));
        }
        f
    }

    /// The span, its parameter and its derivatives in that parameter at `u`.
    pub fn derivatives_at(&self, u: f64) -> (usize, f64, [V3; 3]) {
        let (k, t) = self.locate(u.clamp(0.0, 1.0) * self.length);
        (k, t, derivatives(&self.spans[k], t))
    }

    /// d²P/du² at `u`, with u the fraction of arc length: L² (P'' − (P''·T) T) ÷ |P'|² in the
    /// span's own parameter (zero where the span stands still).
    pub fn accel(&self, u: f64) -> V3 {
        let (_, _, [d1, d2, _]) = self.derivatives_at(u);
        let v2 = dot(d1, d1);
        if v2 < 1e-24 {
            return [0.0; 3];
        }
        let t = scale(d1, 1.0 / sqrt(v2));
        scale(
            sub(d2, scale(t, dot(d2, t))),
            self.length * self.length / v2,
        )
    }

    /// The table as a polyline: every node (a linear curve's points alone), joints once, each
    /// with its frame's normal.
    pub fn sampled(&self) -> Sampled {
        let mut points: Vec<V3> = Vec::new();
        let mut normals: Vec<V3> = Vec::new();
        let mut us: Vec<f64> = Vec::new();
        let mut tangents: Vec<V3> = Vec::new();
        let linear = self.mode == "linear";
        for n in &self.nodes {
            if linear && n.t != 0.0 && n.t != 1.0 {
                continue;
            }
            if points
                .last()
                .is_some_and(|p| length(sub(*p, n.frame.point)) < 1e-12)
            {
                continue;
            }
            points.push(n.frame.point);
            let u = if self.length > 0.0 {
                n.s / self.length
            } else {
                0.0
            };
            let f = self.frame(u);
            normals.push(f.normal);
            us.push(u);
            if !linear {
                tangents.push(f.tangent);
            }
        }
        if self.closed
            && points.len() > 1
            && length(sub(points[0], points[points.len() - 1])) < 1e-12
        {
            points.pop();
            normals.pop();
            us.pop();
            tangents.pop();
        }
        Sampled {
            points,
            closed: self.closed,
            normals,
            us,
            tangents,
        }
    }
}

fn linear(p: &[V3], closed: bool) -> Vec<[V3; 4]> {
    let n = p.len();
    let pairs = if closed { n } else { n - 1 };
    (0..pairs)
        .map(|k| {
            let (a, b) = (p[k], p[(k + 1) % n]);
            let d = sub(b, a);
            [
                a,
                add(a, scale(d, 1.0 / 3.0)),
                add(a, scale(d, 2.0 / 3.0)),
                b,
            ]
        })
        .collect()
}

/// The neighbour of point k, wrapping on a closed curve and reflecting past an open one's ends.
fn neighbour(p: &[V3], closed: bool, k: isize) -> V3 {
    let n = p.len() as isize;
    if closed {
        return p[k.rem_euclid(n) as usize];
    }
    if k < 0 {
        return sub(scale(p[0], 2.0), p[1]);
    }
    if k >= n {
        return sub(scale(p[n as usize - 1], 2.0), p[n as usize - 2]);
    }
    p[k as usize]
}

/// Catmull-Rom through every point, its knots spaced by chord length to the power `alpha`
/// (0 uniform, 0.5 centripetal, 1 chordal), each span as a Bézier.
fn catmull_rom(p: &[V3], closed: bool, alpha: f64) -> Vec<[V3; 4]> {
    let n = p.len();
    let pairs = if closed { n } else { n - 1 };
    (0..pairs as isize)
        .map(|k| {
            let [p0, p1, p2, p3] = [k - 1, k, k + 1, k + 2].map(|i| neighbour(p, closed, i));
            let d = |a: V3, b: V3| pow(length(sub(b, a)), alpha).max(1e-12);
            let (d0, d1, d2) = (d(p0, p1), d(p1, p2), d(p2, p3));
            let m1 = scale(
                add(
                    sub(
                        scale(sub(p1, p0), 1.0 / d0),
                        scale(sub(p2, p0), 1.0 / (d0 + d1)),
                    ),
                    scale(sub(p2, p1), 1.0 / d1),
                ),
                d1,
            );
            let m2 = scale(
                add(
                    sub(
                        scale(sub(p2, p1), 1.0 / d1),
                        scale(sub(p3, p1), 1.0 / (d1 + d2)),
                    ),
                    scale(sub(p3, p2), 1.0 / d2),
                ),
                d1,
            );
            [
                p1,
                add(p1, scale(m1, 1.0 / 3.0)),
                sub(p2, scale(m2, 1.0 / 3.0)),
                p2,
            ]
        })
        .collect()
}

/// Tangents from the neighbours, each axis clamped so neither handle passes the next point's
/// value on it (zero where the point is that axis's extreme), so no span overshoots its ends.
fn auto(p: &[V3], closed: bool) -> Vec<[V3; 4]> {
    let n = p.len();
    let tangent = |k: usize| -> V3 {
        let prev = (closed || k > 0).then(|| p[(k + n - 1) % n]);
        let next = (closed || k + 1 < n).then(|| p[(k + 1) % n]);
        let mut m = [0.0; 3];
        for d in 0..3 {
            m[d] = match (prev, next) {
                (Some(a), Some(b)) => {
                    let (lo, hi) = (p[k][d] - a[d], b[d] - p[k][d]);
                    if lo * hi <= 0.0 {
                        0.0
                    } else {
                        let raw = 0.5 * (b[d] - a[d]);
                        let cap = 3.0 * lo.abs().min(hi.abs());
                        raw.signum() * raw.abs().min(cap)
                    }
                }
                (None, Some(b)) => b[d] - p[k][d],
                (Some(a), None) => p[k][d] - a[d],
                (None, None) => 0.0,
            };
        }
        m
    };
    let m: Vec<V3> = (0..n).map(tangent).collect();
    let pairs = if closed { n } else { n - 1 };
    (0..pairs)
        .map(|k| {
            let j = (k + 1) % n;
            [
                p[k],
                add(p[k], scale(m[k], 1.0 / 3.0)),
                sub(p[j], scale(m[j], 1.0 / 3.0)),
                p[j],
            ]
        })
        .collect()
}

/// A uniform cubic B-spline on the points (an open one with each end point repeated three times,
/// so it starts and ends on them), each span as a Bézier.
fn bspline(p: &[V3], closed: bool) -> Vec<[V3; 4]> {
    let n = p.len();
    let c: Vec<V3> = if closed {
        (0..n + 3).map(|k| p[k % n]).collect()
    } else {
        let mut c = vec![p[0], p[0]];
        c.extend_from_slice(p);
        c.extend([p[n - 1], p[n - 1]]);
        c
    };
    c.windows(4)
        .map(|w| {
            let b0 = scale(add(add(w[0], scale(w[1], 4.0)), w[2]), 1.0 / 6.0);
            let b1 = scale(add(scale(w[1], 2.0), w[2]), 1.0 / 3.0);
            let b2 = scale(add(w[1], scale(w[2], 2.0)), 1.0 / 3.0);
            let b3 = scale(add(add(w[1], scale(w[2], 4.0)), w[3]), 1.0 / 6.0);
            [b0, b1, b2, b3]
        })
        .collect()
}

/// A `curve@1` item's params as a polyline, or why not (the path of the bad field).
pub fn sample(params: &Value) -> Result<Sampled, String> {
    Curve::new(params).map(|c| c.sampled())
}

impl Sampled {
    /// Bare points: a polyline with no curve@1 frames.
    pub fn bare(points: Vec<V3>, closed: bool) -> Sampled {
        Sampled {
            points,
            closed,
            normals: Vec::new(),
            us: Vec::new(),
            tangents: Vec::new(),
        }
    }

    /// Its polyline, closed back to the start when it closes.
    fn polyline(&self) -> Vec<V3> {
        let mut out = self.points.clone();
        if self.closed {
            out.push(self.points[0]);
        }
        out
    }

    /// Its arc length.
    pub fn length(&self) -> f64 {
        self.polyline()
            .windows(2)
            .map(|w| length(sub(w[1], w[0])))
            .sum()
    }

    /// The point and unit tangent at arc length `s`, past either end along its end's tangent.
    pub fn at(&self, s: f64) -> (V3, V3) {
        let (p, t, _) = self.framed(s);
        (p, t)
    }

    /// The point, unit tangent and, on a `curve@1`, its frame's normal at arc length `s`
    /// (blended between the two samples either side).
    pub fn framed(&self, s: f64) -> (V3, V3, Option<V3>) {
        let line = self.polyline();
        let n = self.points.len();
        let normal = |k: usize, f: f64| -> Option<V3> {
            (self.normals.len() == n).then(|| {
                let (a, b) = (self.normals[k % n], self.normals[(k + 1) % n]);
                add(scale(a, 1.0 - f), scale(b, f))
            })
        };
        let mut left = s;
        for (k, w) in line.windows(2).enumerate() {
            let d = length(sub(w[1], w[0]));
            let last = k + 2 == line.len();
            if left <= d || last {
                let tangent = unit(sub(w[1], w[0]));
                let f = if d > 0.0 {
                    (left / d).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let nrm = normal(k, f).map(|v| unit(sub(v, scale(tangent, dot(v, tangent)))));
                return (add(w[0], scale(tangent, left)), tangent, nrm);
            }
            left -= d;
        }
        (line[0], [1.0, 0.0, 0.0], None)
    }
}
