//! #191: the query fixture's brute-force scan. Every shape use of a world of static spheres,
//! axis-aligned boxes and upright capsules, tested exactly in f64 against a ray, a sphere swept from
//! one point to another, or a sphere at a point; groups applied; sorted by distance, then shape use.
//! A backend's `query()` must return exactly these hits (Physics: behavior kit: queries).

use serde_json::{json, Value};

use super::fixtures::{fixture, material, world};
use super::{Fixture, Measure, Probe, Tolerance};
use crate::backend::{Hit, Query, ShapeRef};
use crate::doc::{Pose, Rot, Shape, World};
use deep_canvas::ops;

type V = [f64; 3];

fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V, b: V) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn add_scaled(a: V, d: V, t: f64) -> V {
    [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t]
}
fn len(a: V) -> f64 {
    ops::sqrt(dot(a, a))
}

/// The least t in [0, max] where the ray `o + t d` (|d| = 1) is within `r` of point `c`.
fn ray_sphere(o: V, d: V, c: V, r: f64, max: f64) -> Option<f64> {
    let m = sub(o, c);
    let (b, k) = (dot(m, d), dot(m, m) - r * r);
    if k <= 0.0 {
        return Some(0.0);
    }
    let disc = b * b - k;
    if b > 0.0 || disc < 0.0 {
        return None;
    }
    let t = -b - ops::sqrt(disc);
    (t <= max).then_some(t)
}

/// The same against the box `c ± h`.
fn ray_box(o: V, d: V, c: V, h: V, max: f64) -> Option<f64> {
    let (mut lo, mut hi) = (0.0f64, max);
    for i in 0..3 {
        let (a, b) = (c[i] - h[i] - o[i], c[i] + h[i] - o[i]);
        if d[i] == 0.0 {
            if a > 0.0 || b < 0.0 {
                return None;
            }
            continue;
        }
        let (t1, t2) = (a / d[i], b / d[i]);
        lo = lo.max(t1.min(t2));
        hi = hi.min(t1.max(t2));
        if lo > hi {
            return None;
        }
    }
    Some(lo)
}

/// The same against the capsule of radius `r` around the segment `p..q`.
fn ray_capsule(o: V, d: V, p: V, q: V, r: f64, max: f64) -> Option<f64> {
    let ends = [ray_sphere(o, d, p, r, max), ray_sphere(o, d, q, r, max)];
    let axis = sub(q, p);
    let l2 = dot(axis, axis);
    // The side: points whose distance to the line is r, with their foot inside the segment.
    let (m, dd, md) = (sub(o, p), dot(d, axis), dot(sub(o, p), axis));
    let a = l2 - dd * dd;
    let b = l2 * dot(m, d) - md * dd;
    let k = l2 * (dot(m, m) - r * r) - md * md;
    let side = if k <= 0.0 && (0.0..=l2).contains(&md) {
        Some(0.0)
    } else if a.abs() < 1e-12 {
        None
    } else {
        let disc = b * b - a * k;
        let t = (disc >= 0.0).then(|| (-b - ops::sqrt(disc)) / a);
        t.filter(|t| (0.0..=max).contains(t) && (0.0..=l2).contains(&(md + t * dd)))
    };
    [ends[0], ends[1], side]
        .into_iter()
        .flatten()
        .reduce(f64::min)
}

/// A shape use's placed primitive, its body's and offset's rotations taken as identity.
enum Prim {
    Sphere(V, f64),
    Box(V, V),
    Capsule(V, V, f64),
}

fn placed(shape: &Shape, at: V) -> Option<Prim> {
    Some(match shape {
        Shape::Sphere { radius } => Prim::Sphere(at, *radius),
        Shape::Box { half } => Prim::Box(at, *half),
        Shape::Capsule {
            half_height,
            radius,
        } => Prim::Capsule(
            add_scaled(at, [0.0, 1.0, 0.0], -half_height),
            add_scaled(at, [0.0, 1.0, 0.0], *half_height),
            *radius,
        ),
        _ => return None,
    })
}

/// Where a ray meets `p` grown by `grow`, as a sweep of a sphere of that radius does.
fn cast(p: &Prim, o: V, d: V, grow: f64, max: f64) -> Option<f64> {
    match *p {
        Prim::Sphere(c, r) => ray_sphere(o, d, c, r + grow, max),
        Prim::Capsule(a, b, r) => ray_capsule(o, d, a, b, r + grow, max),
        Prim::Box(c, h) if grow == 0.0 => ray_box(o, d, c, h, max),
        // A box grown by a sphere: its three face slabs and its twelve edges as capsules.
        Prim::Box(c, h) => {
            let slabs = (0..3).filter_map(|i| {
                let mut g = h;
                g[i] += grow;
                ray_box(o, d, c, g, max)
            });
            let corner = |s: [f64; 3]| [c[0] + s[0] * h[0], c[1] + s[1] * h[1], c[2] + s[2] * h[2]];
            let mut edges = Vec::new();
            for i in 0..3 {
                for (u, v) in [(-1.0, -1.0), (-1.0, 1.0), (1.0, -1.0), (1.0, 1.0)] {
                    let mut s = [0.0; 3];
                    s[(i + 1) % 3] = u;
                    s[(i + 2) % 3] = v;
                    let (mut lo, mut hi) = (s, s);
                    lo[i] = -1.0;
                    hi[i] = 1.0;
                    edges.extend(ray_capsule(o, d, corner(lo), corner(hi), grow, max));
                }
            }
            slabs.chain(edges).reduce(f64::min)
        }
    }
}

/// Whether a sphere at `c` of radius `r` overlaps `p`.
fn overlaps(p: &Prim, c: V, r: f64) -> bool {
    match *p {
        Prim::Sphere(x, s) => len(sub(c, x)) <= r + s,
        Prim::Box(x, h) => {
            let out: V = [0, 1, 2]
                .map(|i| (c[i] - x[i]).abs() - h[i])
                .map(|v| v.max(0.0));
            len(out) <= r
        }
        Prim::Capsule(a, b, s) => {
            let ab = sub(b, a);
            let t = (dot(sub(c, a), ab) / dot(ab, ab)).clamp(0.0, 1.0);
            len(sub(c, add_scaled(a, ab, t))) <= r + s
        }
    }
}

fn radius(s: &Shape) -> Option<f64> {
    match s {
        Shape::Sphere { radius } => Some(*radius),
        _ => None,
    }
}

/// Every shape use of `w` that `q` meets among those in `groups`, sorted by distance, then shape
/// use; a probe other than a sphere meets nothing here.
pub fn hits(w: &World, q: &Query, groups: u32) -> Vec<Hit> {
    let mut out = Vec::new();
    for (id, b) in &w.bodies {
        for (i, u) in b.shapes.iter().enumerate() {
            if u.member & groups == 0 {
                continue;
            }
            let at = add_scaled(b.pose.pos, u.offset.pos, 1.0);
            let Some(p) = w.shapes.get(&u.shape).and_then(|s| placed(s, at)) else {
                continue;
            };
            let distance = match q {
                Query::Ray { from, dir, max } => {
                    let n = len(*dir);
                    cast(&p, *from, dir.map(|x| x / n), 0.0, *max)
                }
                Query::Sweep { shape, from, to } => radius(shape).and_then(|r| {
                    let m = sub(to.pos, from.pos);
                    let l = len(m);
                    cast(&p, from.pos, m.map(|x| x / l), r, l)
                }),
                Query::Overlap { shape, at } => radius(shape)
                    .filter(|r| overlaps(&p, at.pos, *r))
                    .map(|_| 0.0),
            };
            if let Some(distance) = distance {
                let shape = ShapeRef {
                    body: id.clone(),
                    index: i,
                };
                out.push(Hit {
                    shape,
                    distance,
                    point: [0.0; 3],
                    normal: [0.0; 3],
                });
            }
        }
    }
    out.sort_by(|a, b| {
        a.distance
            .total_cmp(&b.distance)
            .then_with(|| a.shape.cmp(&b.shape))
    });
    out
}

/// The same shape uses in the same order, each distance within 1 mm (a grazing sweep lands a few
/// tenths of a millimetre off in the engine's f32 cast).
pub fn same(got: &[Hit], want: &[Hit]) -> bool {
    got.len() == want.len()
        && got
            .iter()
            .zip(want)
            .all(|(g, w)| g.shape == w.shape && (g.distance - w.distance).abs() <= 1e-3)
}

fn listed(h: &[Hit]) -> Value {
    json!(h
        .iter()
        .map(|x| json!({"body": x.shape.body, "index": x.shape.index, "distance": x.distance}))
        .collect::<Vec<_>>())
}

/// A probe's kind: `ray`, `sweep` or `overlap`.
pub fn kind(q: &Query) -> &'static str {
    match q {
        Query::Ray { .. } => "ray",
        Query::Sweep { .. } => "sweep",
        Query::Overlap { .. } => "overlap",
    }
}

/// Probe `i`'s two answers, and the first body the backend met that the scan didn't.
pub fn differs(i: usize, p: &Probe, got: &[Hit], want: &[Hit]) -> Value {
    let extra = got
        .iter()
        .find(|g| !want.iter().any(|w| w.shape == g.shape));
    json!({"hit": extra.map(|h| h.shape.body.clone()),
           "probe": {"index": i, "kind": kind(&p.query), "groups": p.groups, "got": listed(got), "scan": listed(want)}})
}

fn at(pos: V) -> Pose {
    Pose {
        pos,
        rot: Rot::Quat([0.0, 0.0, 0.0, 1.0]),
    }
}

fn ball(r: f64) -> Shape {
    Shape::Sphere { radius: r }
}

/// The query fixture: static spheres, boxes and capsules in three groups, two spheres sharing a
/// place so a tie falls to ID, asked by rays, sweeps and overlaps in one group, two and all.
pub fn queries() -> Fixture {
    let fixed = |shape: &str, pos: V, group: &str| json!({"kind": "static", "shapes": [{"shape": shape, "contact_material": "m", "member": [group]}], "pose": {"pos": pos}});
    let w = world(json!({"collision_groups": ["red", "green", "blue"],
        "contact_materials": {"m": material(0.0, 0.0)},
        "shapes": {"ball": {"kind": "sphere", "radius": 0.5}, "crate": {"kind": "box", "half": [0.5, 0.5, 0.5]},
                   "post": {"kind": "capsule", "half_height": 0.5, "radius": 0.3}},
        "bodies": {"a": fixed("ball", [0.0, 1.0, 5.0], "red"), "b": fixed("ball", [0.0, 1.0, 5.0], "green"),
                   "c": fixed("crate", [0.2, 1.1, 10.0], "green"), "d": fixed("post", [-0.1, 0.9, 15.0], "blue"),
                   "e": fixed("crate", [3.0, 1.0, 5.0], "red"), "f": fixed("ball", [-3.0, 1.2, 10.0], "blue")}}));
    let all = vec!["red", "green", "blue"];
    let (red, green, blue) = (vec!["red"], vec!["green"], vec!["blue"]);
    let both = |a: &[&'static str], b: &[&'static str]| [a, b].concat();
    let ray = |from: V, dir: V, groups| Probe {
        query: Query::Ray {
            from,
            dir,
            max: 30.0,
        },
        groups,
    };
    let sweep = |from: V, to: V, r: f64, groups| Probe {
        query: Query::Sweep {
            shape: ball(r),
            from: at(from),
            to: at(to),
        },
        groups,
    };
    let overlap = |c: V, r: f64, groups| Probe {
        query: Query::Overlap {
            shape: ball(r),
            at: at(c),
        },
        groups,
    };
    let probes = vec![
        ray([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], all.clone()),
        ray([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], both(&green, &blue)),
        ray([0.0, 1.0, 0.0], [0.0, 0.0, 1.0], blue.clone()),
        ray([-3.0, 1.0, 20.0], [0.0, 0.0, -1.0], all.clone()),
        ray([6.0, 1.0, 5.0], [-1.0, 0.0, 0.0], red.clone()),
        ray([0.3, 2.5, 10.0], [0.0, -1.0, 0.0], all.clone()),
        sweep([0.4, 1.7, 0.0], [0.4, 1.7, 20.0], 0.3, all.clone()),
        sweep([0.0, 0.0, 0.0], [0.0, 0.0, 20.0], 0.25, both(&red, &blue)),
        sweep(
            [5.0, 1.0, 10.0],
            [-5.0, 1.0, 10.0],
            0.2,
            both(&green, &blue),
        ),
        sweep([1.6, 1.6, 4.0], [1.6, 1.6, 6.0], 0.3, all.clone()),
        overlap([0.0, 1.0, 5.0], 0.1, all.clone()),
        overlap([0.0, 1.0, 5.0], 0.1, green.clone()),
        overlap([0.6, 1.4, 10.0], 0.2, all.clone()),
        overlap([1.5, 1.0, 5.0], 1.2, both(&red, &blue)),
        overlap([-0.1, 1.6, 15.0], 0.1, blue),
    ];
    // None differs from the scan.
    fixture(
        "queries",
        w,
        1,
        Measure::Queries(probes),
        0.0,
        Tolerance::Relative(0.0),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Closed-form answers for each primitive: a ray down the z axis meets a unit sphere at 4, a
    /// box at 4.5, an upright capsule's side at 4.7; a sphere of 0.5 swept at a box meets its face
    /// 0.5 early, and past its corner meets the corner where the geometry puts it.
    #[test]
    fn primitives_meet_where_their_geometry_says() {
        let (o, d) = ([0.0, 0.0, 0.0], [0.0, 0.0, 1.0]);
        assert!((ray_sphere(o, d, [0.0, 0.0, 5.0], 1.0, 10.0).unwrap() - 4.0).abs() < 1e-12);
        assert!(
            (ray_box(o, d, [0.0, 0.0, 5.0], [0.5, 0.5, 0.5], 10.0).unwrap() - 4.5).abs() < 1e-12
        );
        let cap = ray_capsule(o, d, [0.0, -1.0, 5.0], [0.0, 1.0, 5.0], 0.3, 10.0).unwrap();
        assert!((cap - 4.7).abs() < 1e-12, "{cap}");
        assert_eq!(ray_sphere(o, d, [0.0, 2.0, 5.0], 1.0, 10.0), None);
        let face = cast(
            &Prim::Box([0.0, 0.0, 5.0], [1.0, 1.0, 1.0]),
            o,
            d,
            0.5,
            10.0,
        )
        .unwrap();
        assert!((face - 3.5).abs() < 1e-12, "{face}");
        // Past the box's x edge by 0.2: the swept sphere meets the edge at z = 4 − √(0.5² − 0.2²).
        let edge = cast(
            &Prim::Box([0.0, 0.0, 5.0], [1.0, 1.0, 1.0]),
            [1.2, 1.2, 0.0],
            d,
            0.5,
            10.0,
        )
        .unwrap();
        let want = 4.0 - ops::sqrt(0.25 - 0.08);
        assert!((edge - want).abs() < 1e-9, "{edge} vs {want}");
        assert!(overlaps(
            &Prim::Box([0.0; 3], [1.0; 3]),
            [1.3, 0.0, 0.0],
            0.31
        ));
        assert!(!overlaps(
            &Prim::Box([0.0; 3], [1.0; 3]),
            [1.3, 1.3, 0.0],
            0.4
        ));
    }
}
