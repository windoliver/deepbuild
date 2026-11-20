//! #2240: where a dynamic body's weight acts (canvas primitives: Body `body@1`). `centre_of_mass`
//! is a local point, m; unwritten, the centre is the one the body's shapes give. Only a dynamic
//! body takes it, a vehicle body among them, and the point lies within the bounds of the body's
//! shapes. `inertia` stays refused until #2098 runs it.

use std::collections::BTreeMap;

use deep_canvas::ops;
use serde_json::{Map, Value};

use super::{join, BodyKind, Reader, Rot, Shape, ShapeUse};

type V = [f64; 3];
type M = [V; 3];

fn mul(a: &M, b: &M) -> M {
    [0, 1, 2].map(|i| [0, 1, 2].map(|j| (0..3).map(|k| a[i][k] * b[k][j]).sum()))
}

fn apply(m: &M, v: V) -> V {
    [0, 1, 2].map(|i| (0..3).map(|j| m[i][j] * v[j]).sum())
}

/// A turn of `deg` about axis `axis`.
fn turn(axis: usize, deg: f64) -> M {
    let (s, c) = (ops::sin(ops::rad(deg)), ops::cos(ops::rad(deg)));
    let (i, j) = ((axis + 1) % 3, (axis + 2) % 3);
    let mut m = [[0.0; 3]; 3];
    m[axis][axis] = 1.0;
    (m[i][i], m[i][j], m[j][i], m[j][j]) = (c, -s, s, c);
    m
}

/// `rot` as a matrix: a quaternion, or degrees about X, then Y, then Z, each about the axis the
/// turns before it left, as a backend builds a pose.
fn matrix(rot: &Rot) -> M {
    match rot {
        Rot::Deg(d) => mul(&mul(&turn(0, d[0]), &turn(1, d[1])), &turn(2, d[2])),
        Rot::Quat(q) => {
            let n = ops::sqrt(q.iter().map(|c| c * c).sum());
            let [x, y, z, w] = q.map(|c| c / n);
            [
                [
                    1.0 - 2.0 * (y * y + z * z),
                    2.0 * (x * y - z * w),
                    2.0 * (x * z + y * w),
                ],
                [
                    2.0 * (x * y + z * w),
                    1.0 - 2.0 * (x * x + z * z),
                    2.0 * (y * z - x * w),
                ],
                [
                    2.0 * (x * z - y * w),
                    2.0 * (y * z + x * w),
                    1.0 - 2.0 * (x * x + y * y),
                ],
            ]
        }
    }
}

/// Grows `bounds` over the box of half extents `half` about `centre`.
fn cover(bounds: &mut Option<(V, V)>, centre: V, half: V) {
    let (lo, hi) = bounds.get_or_insert((centre, centre));
    for i in 0..3 {
        lo[i] = lo[i].min(centre[i] - half[i]);
        hi[i] = hi[i].max(centre[i] + half[i]);
    }
}

/// Grows `bounds` over `shape` turned by `r` and moved to `t`. A plane, a mesh and a height field
/// have none a dynamic body could hold, and a compound holds no compound.
fn grow(shapes: &BTreeMap<String, Shape>, shape: &Shape, r: &M, t: V, bounds: &mut Option<(V, V)>) {
    // How far a shape whose axis is its own Y reaches along each axis: its half height along the
    // turned axis, and `across` of its radius.
    let along = |half_height: f64, across: &dyn Fn(f64) -> f64| {
        [0, 1, 2].map(|i| r[i][1].abs() * half_height + across(r[i][1]))
    };
    match shape {
        Shape::Sphere { radius } => cover(bounds, t, [*radius; 3]),
        Shape::Box { half } => {
            let reach = [0, 1, 2].map(|i| (0..3).map(|j| r[i][j].abs() * half[j]).sum());
            cover(bounds, t, reach);
        }
        Shape::Capsule {
            half_height,
            radius,
        } => cover(bounds, t, along(*half_height, &|_| *radius)),
        Shape::Cylinder {
            half_height,
            radius,
        } => {
            let rim = |a: f64| radius * ops::sqrt((1.0 - a * a).max(0.0));
            cover(bounds, t, along(*half_height, &rim));
        }
        Shape::Convex { points, radius } => {
            for p in points {
                let at = apply(r, *p);
                cover(bounds, [0, 1, 2].map(|i| at[i] + t[i]), [*radius; 3]);
            }
        }
        Shape::Compound { children } => {
            for (id, pose) in children {
                let child = shapes.get(id);
                if let Some(s) = child.filter(|s| !matches!(s, Shape::Compound { .. })) {
                    let at = apply(r, pose.pos);
                    let t = [0, 1, 2].map(|i| at[i] + t[i]);
                    grow(shapes, s, &mul(r, &matrix(&pose.rot)), t, bounds);
                }
            }
        }
        Shape::Plane { .. } | Shape::Mesh { .. } | Shape::Heightfield { .. } => {}
    }
}

/// The bounds of a body's shapes in its own frame, lowest and highest corner, m; none for a body
/// none of whose shapes has any.
pub fn bounds(shapes: &BTreeMap<String, Shape>, uses: &[ShapeUse]) -> Option<(V, V)> {
    let mut out = None;
    for u in uses {
        if let Some(s) = shapes.get(&u.shape) {
            grow(shapes, s, &matrix(&u.offset.rot), u.offset.pos, &mut out);
        }
    }
    out
}

impl Reader {
    /// A body's `inertia`, which this backend interface doesn't run yet.
    pub(super) fn inertia(&mut self, b: &Map<String, Value>, p: &str) {
        if let Some(x) = b.get("inertia") {
            self.refuse(
                "physics.unsupported",
                join(p, "inertia"),
                x,
                "inertia isn't run by this backend interface yet; #2098 brings it".into(),
            );
        }
    }

    /// A body's `centre_of_mass`: refused on any body but a dynamic one, and outside the bounds
    /// of the body's shapes, naming those bounds.
    pub(super) fn centre_of_mass(
        &mut self,
        b: &Map<String, Value>,
        p: &str,
        kind: BodyKind,
        uses: &[ShapeUse],
        shapes: &BTreeMap<String, Shape>,
    ) -> Option<V> {
        let x = b.get("centre_of_mass")?;
        let at = join(p, "centre_of_mass");
        if kind != BodyKind::Dynamic {
            let named = b.get("kind").and_then(Value::as_str).unwrap_or("static");
            let what = format!(
                "only a dynamic body takes centre_of_mass, and this body's kind is {named}"
            );
            self.refuse("out_of_range", at, x, what);
            return None;
        }
        let before = self.out.len();
        let c = self.vec3(b, "centre_of_mass", p, [0.0; 3]);
        if self.out.len() > before {
            return None;
        }
        let what = match bounds(shapes, uses) {
            Some((lo, hi)) if (0..3).all(|i| lo[i] <= c[i] && c[i] <= hi[i]) => return Some(c),
            Some((lo, hi)) => format!(
                "centre_of_mass ({}, {}, {}) lies outside the bounds of this body's shapes: x from {} to {}, y from {} to {} and z from {} to {} m",
                c[0], c[1], c[2], lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]
            ),
            None => "centre_of_mass needs a shape whose bounds hold it, and this body has none".into(),
        };
        self.refuse("out_of_range", at, x, what);
        None
    }
}
