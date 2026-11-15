//! Issue #504: assemblies (canvas primitives: Assembly). A set of figure parts that move together:
//! an item joins one by naming it as its `parent`, and the assembly's transform composes before
//! the item's. `value` moves it along its motion (a slide in m along its axis, or a turn in
//! degrees about its axis through its pivot), and a take-apart moves it by `apart` times its share,
//! which a follow's stagger times (`doc::Stagger`). An assembly's own transform is
//! T(apart · share) · at · M(value), composed under its parents', at most four deep.

use deep_canvas::camera::{length, Vec3};
use deep_canvas::ops::{asin, atan2, cos, deg, rad, sin, sqrt};
use serde_json::{json, Map, Value};

use crate::doc::Refused;

/// A 3 × 4 affine transform: each row its linear part, then its translation.
pub type Affine3 = [[f64; 4]; 3];

pub const IDENTITY: Affine3 = [
    [1.0, 0.0, 0.0, 0.0],
    [0.0, 1.0, 0.0, 0.0],
    [0.0, 0.0, 1.0, 0.0],
];

/// Most assemblies one chain nests (Assembly: "nest more than 4 deep").
pub const DEPTH: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Slide,
    Turn,
}

/// What an assembly's `value` moves: a slide along `axis`, or a turn about it through `pivot`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Joint {
    pub kind: Kind,
    /// Of unit length.
    pub axis: Vec3,
    pub pivot: Vec3,
    pub range: Option<(f64, f64)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Assembly {
    pub id: String,
    /// Its parent, an index in the program's assemblies.
    pub parent: Option<usize>,
    pub at: Affine3,
    pub joint: Option<Joint>,
    /// Its authored value, held to its range.
    pub value: f64,
    pub apart: Vec3,
    pub order: u16,
    /// Its `value` slot in the program; its take-apart share is the slot after it.
    pub slot: usize,
}

impl Assembly {
    /// `value` held to the joint's range.
    pub fn held(&self, value: f64) -> f64 {
        match self.joint.and_then(|j| j.range) {
            Some((lo, hi)) => value.clamp(lo, hi),
            None => value,
        }
    }

    /// Its own transform at `value` and take-apart `share`: T(apart · share) · at · M(value).
    pub fn local(&self, value: f64, share: f64) -> Affine3 {
        let value = self.held(value);
        let moved = match self.joint {
            None => IDENTITY,
            Some(Joint {
                kind: Kind::Slide,
                axis,
                ..
            }) => {
                let mut m = IDENTITY;
                for k in 0..3 {
                    m[k][3] = axis[k] * value;
                }
                m
            }
            Some(Joint {
                kind: Kind::Turn,
                axis,
                pivot,
                ..
            }) => turned(axis, value, pivot),
        };
        let mut m = matmul(&self.at, &moved);
        let share = share.clamp(0.0, 1.0);
        for (row, apart) in m.iter_mut().zip(self.apart) {
            row[3] += apart * share;
        }
        m
    }
}

/// A turn of `degrees` about the unit `axis` through `pivot` (Rodrigues).
fn turned(u: Vec3, degrees: f64, pivot: Vec3) -> Affine3 {
    let a = rad(degrees);
    let (c, s) = (cos(a), sin(a));
    let k = 1.0 - c;
    let r = [
        [
            c + u[0] * u[0] * k,
            u[0] * u[1] * k - u[2] * s,
            u[0] * u[2] * k + u[1] * s,
        ],
        [
            u[1] * u[0] * k + u[2] * s,
            c + u[1] * u[1] * k,
            u[1] * u[2] * k - u[0] * s,
        ],
        [
            u[2] * u[0] * k - u[1] * s,
            u[2] * u[1] * k + u[0] * s,
            c + u[2] * u[2] * k,
        ],
    ];
    let mut m = [[0.0; 4]; 3];
    for i in 0..3 {
        m[i][..3].copy_from_slice(&r[i]);
        m[i][3] = pivot[i] - (r[i][0] * pivot[0] + r[i][1] * pivot[1] + r[i][2] * pivot[2]);
    }
    m
}

/// `a` after `b`: a point goes through `b`, then `a`.
pub fn matmul(a: &Affine3, b: &Affine3) -> Affine3 {
    let mut m = [[0.0; 4]; 3];
    for i in 0..3 {
        for j in 0..4 {
            m[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
        }
        m[i][3] += a[i][3];
    }
    m
}

/// A point through `m`.
pub fn apply(m: &Affine3, p: Vec3) -> Vec3 {
    [0, 1, 2].map(|i| m[i][0] * p[0] + m[i][1] * p[1] + m[i][2] * p[2] + m[i][3])
}

/// A direction through `m`'s linear part.
pub fn turn(m: &Affine3, d: Vec3) -> Vec3 {
    [0, 1, 2].map(|i| m[i][0] * d[0] + m[i][1] * d[1] + m[i][2] * d[2])
}

/// An item's own `at` from its numbers: scale, then rotate about X, Y and Z in turn (Rz · Ry ·
/// Rx), then move to `pos` (Units and axes). The scene3d module's, so both compose alike.
pub fn local_of(pos: Vec3, rot: Vec3, sc: Vec3, extra_scale: Vec3) -> Affine3 {
    let (cx, sx) = (cos(rad(rot[0])), sin(rad(rot[0])));
    let (cy, sy) = (cos(rad(rot[1])), sin(rad(rot[1])));
    let (cz, sz) = (cos(rad(rot[2])), sin(rad(rot[2])));
    // Rz · Ry · Rx
    let r = [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ];
    let s = [
        sc[0] * extra_scale[0],
        sc[1] * extra_scale[1],
        sc[2] * extra_scale[2],
    ];
    let mut m = [[0.0; 4]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = r[i][j] * s[j];
        }
        m[i][3] = pos[i];
    }
    m
}

/// An item's nine transform numbers (pos, rot in degrees, scale) placed by `a`: its world
/// transform under the assembly, read back as position, Rz · Ry · Rx degrees and scale. An
/// assembly that only moves adds its translation and leaves the rest exact.
pub(crate) fn placed(a: &Affine3, t: &mut [f64]) {
    let moves_only = (0..3).all(|i| (0..3).all(|j| a[i][j] == if i == j { 1.0 } else { 0.0 }));
    if moves_only {
        for k in 0..3 {
            t[k] += a[k][3];
        }
        return;
    }
    let m = matmul(
        a,
        &local_of(
            [t[0], t[1], t[2]],
            [t[3], t[4], t[5]],
            [t[6], t[7], t[8]],
            [1.0; 3],
        ),
    );
    let mut r = [[0.0; 3]; 3];
    for j in 0..3 {
        let s = sqrt(m[0][j] * m[0][j] + m[1][j] * m[1][j] + m[2][j] * m[2][j]);
        t[6 + j] = s;
        for i in 0..3 {
            r[i][j] = if s == 0.0 { m[i][j] } else { m[i][j] / s };
        }
    }
    for k in 0..3 {
        t[k] = m[k][3];
    }
    // R = Rz · Ry · Rx: R[2][0] = −sin y, and away from the pole x and z from the rest.
    let y = asin((-r[2][0]).clamp(-1.0, 1.0));
    let (x, z) = if r[2][0].abs() < 1.0 - 1e-12 {
        (atan2(r[2][1], r[2][2]), atan2(r[1][0], r[0][0]))
    } else {
        (0.0, atan2(-r[0][1], r[1][1]))
    };
    t[3] = deg(x);
    t[4] = deg(y);
    t[5] = deg(z);
}

fn refused<T>(code: &'static str, path: String, why: &str) -> Result<T, Refused> {
    Err(Refused {
        code,
        path,
        detail: Some(Box::new(json!({"why": why}))),
    })
}

fn vec3(v: Option<&Value>, default: Vec3, path: &str) -> Result<Vec3, Refused> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Array(a)) if a.len() == 3 => {
            let mut out = [0.0; 3];
            for (o, x) in out.iter_mut().zip(a) {
                *o = x
                    .as_f64()
                    .filter(|x| x.is_finite())
                    .ok_or(())
                    .or_else(|()| refused("out_of_range", path.to_string(), "three numbers"))?;
            }
            Ok(out)
        }
        Some(_) => refused("out_of_range", path.to_string(), "three numbers"),
    }
}

/// The document's assemblies, in ID order, each slot left at 0 for the program to give. Refused,
/// naming the field: a `repeat` or a `path` motion (not in this build), a parent that isn't an
/// assembly, a cycle, a chain more than four deep, a slide or turn without an axis, and a range
/// written high to low.
pub fn read(doc: &Map<String, Value>) -> Result<Vec<Assembly>, Refused> {
    let map = match doc.get("assemblies") {
        None | Some(Value::Null) => return Ok(Vec::new()),
        Some(Value::Object(m)) => m,
        Some(_) => return refused("out_of_range", "assemblies".into(), "a map of assemblies"),
    };
    let mut ids: Vec<&String> = map.keys().collect();
    ids.sort();
    let mut out = Vec::with_capacity(ids.len());
    for id in &ids {
        let path = format!("assemblies/{id}");
        let Some(a) = map[*id].as_object() else {
            return refused("out_of_range", path, "an assembly is an object");
        };
        if a.contains_key("repeat") {
            return refused(
                "out_of_range",
                format!("{path}/repeat"),
                "an assembly's repeat is not in this build",
            );
        }
        let parent = match a.get("parent") {
            None | Some(Value::Null) => None,
            Some(Value::String(p)) => match ids.iter().position(|x| *x == p) {
                Some(i) => Some(i),
                None => {
                    return refused(
                        "ref_unresolved",
                        format!("{path}/parent"),
                        "an assembly's parent is an assembly",
                    )
                }
            },
            Some(_) => {
                return refused("out_of_range", format!("{path}/parent"), "an assembly's ID")
            }
        };
        let at = a.get("at");
        let field = |name: &str, default: Vec3| {
            vec3(
                at.and_then(|at| at.get(name)),
                default,
                &format!("{path}/at/{name}"),
            )
        };
        let at = local_of(
            field("pos", [0.0; 3])?,
            field("rot", [0.0; 3])?,
            field("scale", [1.0; 3])?,
            [1.0; 3],
        );
        let joint = match a.get("motion") {
            None | Some(Value::Null) => None,
            Some(Value::Object(m)) => {
                let mpath = format!("{path}/motion");
                let kind = match m.get("kind").and_then(Value::as_str) {
                    Some("slide") => Kind::Slide,
                    Some("turn") => Kind::Turn,
                    Some("path") => {
                        return refused(
                            "out_of_range",
                            format!("{mpath}/kind"),
                            "a path motion is not in this build",
                        )
                    }
                    _ => return refused("out_of_range", format!("{mpath}/kind"), "slide or turn"),
                };
                let Some(axis) = m.get("axis") else {
                    return refused(
                        "out_of_range",
                        format!("{mpath}/axis"),
                        "a slide or turn names its axis",
                    );
                };
                let axis = vec3(Some(axis), [0.0; 3], &format!("{mpath}/axis"))?;
                let n = length(axis);
                if n == 0.0 {
                    return refused(
                        "out_of_range",
                        format!("{mpath}/axis"),
                        "an axis has a direction",
                    );
                }
                let range = match m.get("range") {
                    None | Some(Value::Null) => None,
                    Some(Value::Array(r)) if r.len() == 2 => match (r[0].as_f64(), r[1].as_f64()) {
                        (Some(lo), Some(hi)) if lo <= hi => Some((lo, hi)),
                        _ => {
                            return refused(
                                "out_of_range",
                                format!("{mpath}/range"),
                                "[min, max], min first",
                            )
                        }
                    },
                    Some(_) => {
                        return refused("out_of_range", format!("{mpath}/range"), "[min, max]")
                    }
                };
                Some(Joint {
                    kind,
                    axis: [axis[0] / n, axis[1] / n, axis[2] / n],
                    pivot: vec3(m.get("pivot"), [0.0; 3], &format!("{mpath}/pivot"))?,
                    range,
                })
            }
            Some(_) => return refused("out_of_range", format!("{path}/motion"), "an object"),
        };
        let value = match a.get("value") {
            None | Some(Value::Null) => 0.0,
            Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
                Some(x) => x,
                None => return refused("out_of_range", format!("{path}/value"), "a number"),
            },
        };
        let order = match a.get("order") {
            None | Some(Value::Null) => 0,
            Some(v) => match v.as_u64().and_then(|o| u16::try_from(o).ok()) {
                Some(o) => o,
                None => return refused("out_of_range", format!("{path}/order"), "a u16"),
            },
        };
        let mut assembly = Assembly {
            id: (*id).clone(),
            parent,
            at,
            joint,
            value,
            apart: vec3(a.get("apart"), [0.0; 3], &format!("{path}/apart"))?,
            order,
            slot: 0,
        };
        assembly.value = assembly.held(value);
        out.push(assembly);
    }
    for (i, a) in out.iter().enumerate() {
        let mut chain = vec![i];
        let mut at = a.parent;
        while let Some(p) = at {
            if chain.contains(&p) {
                return refused(
                    "cycle",
                    format!("assemblies/{}/parent", a.id),
                    "an assembly's parents loop back to it",
                );
            }
            chain.push(p);
            if chain.len() > DEPTH {
                return refused(
                    "out_of_range",
                    format!("assemblies/{}/parent", a.id),
                    "assemblies nest at most 4 deep",
                );
            }
            at = out[p].parent;
        }
    }
    Ok(out)
}
