//! What `move {keep: world}` needs (canvas primitives: Patch; Units and axes: "subtract the pivot,
//! scale, shear, rotate, add the position, then apply the parent"): an item's `at` as a transform,
//! its parents' chain composed, and `at` written again so the item keeps its place in the world
//! under a new parent.
//!
//! The plane carries the turn about Z, the shear and the X and Y scale; Z is its own axis, scaled
//! and offset. A turn about X or Y, a box-point pivot, an anchor or a relation can't be read
//! without evaluating the document, so an item or parent with one is refused here.

use serde_json::{json, Map, Value};

use super::member;
use crate::ops;

/// `x ↦ m·x + t` in the plane, and `z ↦ zs·z + zt`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Affine {
    m: [[f64; 2]; 2],
    t: [f64; 2],
    zs: f64,
    zt: f64,
}

const IDENTITY: Affine = Affine {
    m: [[1.0, 0.0], [0.0, 1.0]],
    t: [0.0, 0.0],
    zs: 1.0,
    zt: 0.0,
};

impl Affine {
    /// `self` after `inner`: `x ↦ self(inner(x))`.
    fn then(self, inner: Affine) -> Affine {
        let a = self.m;
        let b = inner.m;
        let m = [
            [
                a[0][0] * b[0][0] + a[0][1] * b[1][0],
                a[0][0] * b[0][1] + a[0][1] * b[1][1],
            ],
            [
                a[1][0] * b[0][0] + a[1][1] * b[1][0],
                a[1][0] * b[0][1] + a[1][1] * b[1][1],
            ],
        ];
        let t = [
            a[0][0] * inner.t[0] + a[0][1] * inner.t[1] + self.t[0],
            a[1][0] * inner.t[0] + a[1][1] * inner.t[1] + self.t[1],
        ];
        Affine {
            m,
            t,
            zs: self.zs * inner.zs,
            zt: self.zs * inner.zt + self.zt,
        }
    }

    fn inverse(self) -> Option<Affine> {
        let [[a, b], [c, d]] = self.m;
        let det = a * d - b * c;
        if det == 0.0 || !det.is_finite() || self.zs == 0.0 {
            return None;
        }
        let m = [[d / det, -b / det], [-c / det, a / det]];
        let t = [
            -(m[0][0] * self.t[0] + m[0][1] * self.t[1]),
            -(m[1][0] * self.t[0] + m[1][1] * self.t[1]),
        ];
        Some(Affine {
            m,
            t,
            zs: 1.0 / self.zs,
            zt: -self.zt / self.zs,
        })
    }
}

/// A vector member of `at` with its default.
fn vector(at: Option<&Value>, name: &str, default: f64) -> Result<[f64; 3], &'static str> {
    match at.and_then(|a| member(a, name)) {
        None => Ok([default; 3]),
        Some(Value::Array(v)) if v.len() == 3 => {
            let n: Option<Vec<f64>> = v.iter().map(Value::as_f64).collect();
            n.map(|n| [n[0], n[1], n[2]]).ok_or("a vector of numbers")
        }
        Some(Value::String(_)) => Err("a box-point pivot, which needs the item's bounds"),
        Some(_) => Err("a vector of three numbers"),
    }
}

/// The parts of an item's `at` a keep-world move reads.
struct Parts {
    pos: [f64; 3],
    rot: [f64; 3],
    scale: [f64; 3],
    pivot: [f64; 3],
    shear: f64,
}

fn parts(at: Option<&Value>) -> Result<Parts, &'static str> {
    for held in ["anchor", "place", "align", "fit"] {
        if at.and_then(|a| member(a, held)).is_some() {
            return Err("an anchor or a relation, which places the item each frame");
        }
    }
    let p = Parts {
        pos: vector(at, "pos", 0.0)?,
        rot: vector(at, "rot", 0.0)?,
        scale: vector(at, "scale", 1.0)?,
        pivot: vector(at, "pivot", 0.0)?,
        shear: match at.and_then(|a| member(a, "shear")) {
            None => 0.0,
            Some(v) => v.as_f64().ok_or("a shear in degrees")?,
        },
    };
    if p.rot[0] != 0.0 || p.rot[1] != 0.0 {
        return Err("a turn about X or Y");
    }
    Ok(p)
}

/// The transform an `at` gives: `x ↦ pos + R(rot z)·Sh(shear)·S(scale)·(x − pivot)`.
fn local(at: Option<&Value>) -> Result<Affine, &'static str> {
    let p = parts(at)?;
    let (s, c) = (ops::sin(ops::rad(p.rot[2])), ops::cos(ops::rad(p.rot[2])));
    let k = ops::tan(ops::rad(p.shear));
    let (sx, sy) = (p.scale[0], p.scale[1]);
    // R·Sh·S with Sh = [[1, k], [0, 1]].
    let m = [[c * sx, (c * k - s) * sy], [s * sx, (s * k + c) * sy]];
    let t = [
        p.pos[0] - (m[0][0] * p.pivot[0] + m[0][1] * p.pivot[1]),
        p.pos[1] - (m[1][0] * p.pivot[0] + m[1][1] * p.pivot[1]),
    ];
    Ok(Affine {
        m,
        t,
        zs: p.scale[2],
        zt: p.pos[2] - p.scale[2] * p.pivot[2],
    })
}

/// The world transform under `parent`: each ancestor's `at` from the root down. An ancestor the
/// document no longer holds ends the chain, as its referring item no longer draws.
pub fn world(items: &Map<String, Value>, parent: Option<&str>) -> Result<Affine, String> {
    let mut chain = IDENTITY;
    let mut at = parent;
    for _ in 0..=items.len() {
        let Some(id) = at else { break };
        let Some(item) = items.get(id) else { break };
        let l = local(member(item, "at")).map_err(|why| format!("parent `{id}` has {why}"))?;
        chain = l.then(chain);
        at = member(item, "parent").and_then(Value::as_str);
    }
    Ok(chain)
}

/// `at` rewritten so the item that had it under `old` keeps its world transform under `new`;
/// `None` when the two parents' transforms are the same.
pub fn keep_world(at: Option<&Value>, old: Affine, new: Affine) -> Result<Option<Value>, String> {
    if old == new {
        return Ok(None);
    }
    let p = parts(at).map_err(|why| format!("the item has {why}"))?;
    let shift = new
        .inverse()
        .ok_or("the new parent's transform has no inverse")?
        .then(old);
    let l = shift.then(local(at).map_err(|why| format!("the item has {why}"))?);
    // m = R(r)·U with U = Sh·S upper triangular: the first column gives the turn and X scale.
    let m = l.m;
    let sx = ops::hypot(m[0][0], m[1][0]);
    if sx == 0.0 {
        return Err("the item would have no width in the world".into());
    }
    let r = ops::atan2(m[1][0], m[0][0]);
    let (s, c) = (ops::sin(r), ops::cos(r));
    let u01 = c * m[0][1] + s * m[1][1];
    let sy = -s * m[0][1] + c * m[1][1];
    if sy == 0.0 {
        return Err("the item would have no height in the world".into());
    }
    let shear = ops::deg(ops::atan(u01 / sy));
    let sz = l.zs;
    let pos = [
        l.t[0] + m[0][0] * p.pivot[0] + m[0][1] * p.pivot[1],
        l.t[1] + m[1][0] * p.pivot[0] + m[1][1] * p.pivot[1],
        l.zt + sz * p.pivot[2],
    ];
    let mut out = at.and_then(Value::as_object).cloned().unwrap_or_default();
    out.insert("pos".into(), json!(pos));
    if r != ops::rad(p.rot[2]) || out.contains_key("rot") {
        out.insert("rot".into(), json!([0.0, 0.0, ops::deg(r)]));
    }
    if [sx, sy, sz] != p.scale || out.contains_key("scale") {
        out.insert("scale".into(), json!([sx, sy, sz]));
    }
    if shear != p.shear || out.contains_key("shear") {
        out.insert("shear".into(), json!(shear));
    }
    Ok(Some(Value::Object(out)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn items(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    fn close(a: &Value, b: [f64; 3]) {
        let a: Vec<f64> = a
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_f64().unwrap())
            .collect();
        for (x, y) in a.iter().zip(b) {
            assert!((x - y).abs() < 1e-9, "{a:?} != {b:?}");
        }
    }

    #[test]
    fn a_child_moved_between_translated_parents_keeps_its_place() {
        let all = items(json!({
            "p": {"at": {"pos": [100, 0, 0]}},
            "q": {"at": {"pos": [0, 50, 0]}, "parent": "r"},
            "r": {"at": {"pos": [10, 10, 0]}},
        }));
        let at = json!({"pos": [5, 5, 0]});
        let old = world(&all, Some("p")).unwrap();
        let new = world(&all, Some("q")).unwrap();
        let out = keep_world(Some(&at), old, new).unwrap().unwrap();
        // World (105, 5) under p; under q·r, at (10, 60), so local (95, -55).
        close(&out["pos"], [95.0, -55.0, 0.0]);
        assert_eq!(keep_world(Some(&at), old, old).unwrap(), None);
    }

    #[test]
    fn a_turned_and_scaled_parent_turns_and_scales_the_child_back() {
        let all =
            items(json!({"p": {"at": {"pos": [10, 0, 0], "rot": [0, 0, 90], "scale": [2, 2, 1]}}}));
        let at = json!({"pos": [0, 0, 0]});
        let out = keep_world(
            Some(&at),
            world(&all, None).unwrap(),
            world(&all, Some("p")).unwrap(),
        )
        .unwrap()
        .unwrap();
        // The world origin under p: p maps (x, y) to (10 − 2y, 2x), so local (0, 5).
        close(&out["pos"], [0.0, 5.0, 0.0]);
        close(&out["rot"], [0.0, 0.0, -90.0]);
        close(&out["scale"], [0.5, 0.5, 1.0]);
        // Composed, the new local under p gives the world it had.
        let back = world(&all, Some("p"))
            .unwrap()
            .then(local(Some(&out)).unwrap());
        assert!((back.t[0]).abs() < 1e-9 && (back.t[1]).abs() < 1e-9);
        assert!((back.m[0][0] - 1.0).abs() < 1e-9 && back.m[1][0].abs() < 1e-9);
    }

    #[test]
    fn a_turn_about_x_or_an_anchor_is_refused() {
        let all = items(json!({"p": {"at": {"rot": [30, 0, 0]}}}));
        assert!(world(&all, Some("p")).is_err());
        let anchored = json!({"pos": [0, 0, 0], "anchor": "p#c"});
        let old = world(&all, None).unwrap();
        let new = Affine {
            t: [1.0, 0.0],
            ..IDENTITY
        };
        assert!(keep_world(Some(&anchored), old, new).is_err());
    }
}
