//! Issue #424: what a cutaway hides and what an instancer places (canvas primitives: Cutaway
//! `cutaway@1`; Instance `instance@1`). Both are read from params as data: a cutaway's planes,
//! and an instancer's rows, each element addressed `<instancer>#<id>` by its stable ID.

use std::collections::BTreeSet;

use deep_canvas::camera::Vec3;
use serde_json::Value;

use crate::scene::{local_of, num, Affine3, Refused};

/// The most planes a cutaway takes.
pub const MAX_PLANES: usize = 4;
/// Instancers above this many elements are culled on the GPU (Instance `instance@1`).
pub const GPU_CULLED_ABOVE: usize = 256;
/// The most elements an instancer takes.
pub const MAX_ELEMENTS: usize = 100_000;

/// A cutaway as the renderer draws it: geometry on the positive side of its planes (n·p >
/// offset) is hidden: past any plane (`union`) or past all of them (`intersect`).
#[derive(Clone, Debug, PartialEq)]
pub struct Cutaway {
    pub id: String,
    /// Each plane's unit normal and its offset in m along it.
    pub planes: Vec<(Vec3, f64)>,
    pub intersect: bool,
    /// The items it reaches; `None` for all.
    pub applies_to: Option<BTreeSet<String>>,
    /// The cut face's fill, linear RGB, when `cap` names a role.
    pub cap: Option<[f64; 3]>,
    /// The cap shades as a matte surface under the lights (`lit`) or as its role (`flat`).
    pub cap_lit: bool,
    /// `shadows: whole`: removed geometry still casts.
    pub shadows_whole: bool,
    /// `class: document`: a film animates it; else it's a view input.
    pub document: bool,
}

impl Cutaway {
    /// Whether it reaches the item `id`.
    pub fn reaches(&self, id: &str) -> bool {
        self.applies_to.as_ref().is_none_or(|ids| {
            ids.contains(id)
                || id
                    .split_once('#')
                    .is_some_and(|(owner, _)| ids.contains(owner))
        })
    }

    /// Whether world point `p` is hidden.
    pub fn hides(&self, p: Vec3) -> bool {
        let past = |(n, o): &(Vec3, f64)| n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > *o;
        if self.intersect {
            !self.planes.is_empty() && self.planes.iter().all(past)
        } else {
            self.planes.iter().any(past)
        }
    }
}

/// A cutaway's params, `role` resolving its cap's role to linear RGB and `physical` whether the
/// look is a physical one (cap_light: auto).
pub fn cutaway(
    id: &str,
    params: &Value,
    path: &str,
    role: impl Fn(&str) -> Option<[f64; 3]>,
    physical: bool,
) -> Result<Cutaway, Refused> {
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: format!("{path}/{k}"),
    };
    let list = match params.get("planes") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(bad("planes")),
    };
    if list.len() > MAX_PLANES {
        return Err(bad("planes"));
    }
    let mut planes = Vec::with_capacity(list.len());
    for (k, p) in list.iter().enumerate() {
        let n = p
            .get("normal")
            .and_then(Value::as_array)
            .filter(|a| a.len() == 3)
            .and_then(|a| Some([num(a.first())?, num(a.get(1))?, num(a.get(2))?]))
            .ok_or_else(|| bad(&format!("planes/{k}/normal")))?;
        let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
        if len < 1e-9 {
            return Err(bad(&format!("planes/{k}/normal")));
        }
        let offset = match p.get("offset") {
            None | Some(Value::Null) => 0.0,
            v => num(v).ok_or_else(|| bad(&format!("planes/{k}/offset")))?,
        };
        planes.push((n.map(|c| c / len), offset / len));
    }
    let pick = |k: &str, values: &[&str]| -> Result<usize, Refused> {
        match params.get(k) {
            None | Some(Value::Null) => Ok(0),
            Some(Value::String(s)) => values.iter().position(|v| v == s).ok_or_else(|| bad(k)),
            Some(_) => Err(bad(k)),
        }
    };
    let intersect = pick("mode", &["union", "intersect"])? == 1;
    let shadows_whole = pick("shadows", &["cut", "whole"])? == 1;
    let document = pick("class", &["view", "document"])? == 1;
    let cap_lit = match pick("cap_light", &["auto", "lit", "flat"])? {
        0 => physical,
        1 => true,
        _ => false,
    };
    let applies_to = match params.get("applies_to") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "all" => None,
        Some(Value::String(s)) => Some(BTreeSet::from([s.clone()])),
        Some(Value::Array(a)) => Some(
            a.iter()
                .map(|v| {
                    v.as_str()
                        .map(str::to_string)
                        .ok_or_else(|| bad("applies_to"))
                })
                .collect::<Result<_, _>>()?,
        ),
        Some(_) => return Err(bad("applies_to")),
    };
    let cap = match params.get("cap") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(v) => {
            let name = v
                .as_str()
                .or_else(|| v.get("role").and_then(Value::as_str))
                .ok_or_else(|| bad("cap"))?;
            Some(role(name).ok_or(Refused {
                code: "role_unresolved",
                path: format!("{path}/cap"),
            })?)
        }
    };
    Ok(Cutaway {
        id: id.to_string(),
        planes,
        intersect,
        applies_to,
        cap,
        cap_lit,
        shadows_whole,
        document,
    })
}

/// One element of an instancer: its stable ID, its prototype's index in `of`, and its transform
/// in the instancer's space.
#[derive(Clone, Debug, PartialEq)]
pub struct Element {
    pub id: u64,
    /// Its row in the instancer's columns.
    pub row: u32,
    pub proto: usize,
    pub at: Affine3,
}

/// An instancer's prototypes (`of`): 1 to 64 item IDs.
pub fn prototypes(params: &Value, path: &str) -> Result<Vec<String>, Refused> {
    let bad = || Refused {
        code: "out_of_range",
        path: format!("{path}/of"),
    };
    let of: Vec<String> = params
        .get("of")
        .and_then(Value::as_array)
        .ok_or_else(bad)?
        .iter()
        .map(|v| v.as_str().map(str::to_string).ok_or_else(bad))
        .collect::<Result<_, _>>()?;
    if of.is_empty() || of.len() > 64 {
        return Err(bad());
    }
    Ok(of)
}

/// An instancer's prototypes (`of`) and its shown elements: its rows less those its `hidden`
/// column names, in row order.
pub fn elements(params: &Value, path: &str) -> Result<(Vec<String>, Vec<Element>), Refused> {
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: format!("{path}/{k}"),
    };
    let of = prototypes(params, path)?;
    let column = |k: &str| params.get(k).and_then(Value::as_array);
    let ids: Vec<u64> = match column("ids") {
        Some(a) => a
            .iter()
            .map(|v| {
                v.as_u64()
                    .filter(|x| *x <= u64::from(u32::MAX))
                    .ok_or_else(|| bad("ids"))
            })
            .collect::<Result<_, _>>()?,
        None => (0..column("pos").map_or(0, Vec::len) as u64).collect(),
    };
    let n = ids.len();
    if n > MAX_ELEMENTS || ids.iter().collect::<BTreeSet<_>>().len() != n {
        return Err(bad("ids"));
    }
    // Row i of a vec3 column (a scale may be one number), or `default` without the column.
    let vec3_at = |k: &str, i: usize, default: Vec3| -> Result<Vec3, Refused> {
        let Some(a) = column(k) else {
            return Ok(default);
        };
        match a.get(i) {
            Some(v @ Value::Number(_)) if k == "scale" => num(Some(v)).map(|s| [s; 3]),
            Some(Value::Array(c)) if c.len() == 3 => {
                Some([num(c.first()), num(c.get(1)), num(c.get(2))])
                    .and_then(|p| Some([p[0]?, p[1]?, p[2]?]))
            }
            _ => None,
        }
        .ok_or_else(|| bad(k))
    };
    let scale_all = match params.get("scale") {
        Some(Value::Number(_)) => Some([num(params.get("scale")).ok_or_else(|| bad("scale"))?; 3]),
        _ => None,
    };
    let hidden: BTreeSet<u64> = column("hidden")
        .map(|a| a.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default();
    let mut out = Vec::with_capacity(n);
    for (i, &id) in ids.iter().enumerate() {
        if hidden.contains(&id) {
            continue;
        }
        let pos = vec3_at("pos", i, [0.0; 3])?;
        let scale = match scale_all {
            Some(s) => s,
            None => vec3_at("scale", i, [1.0; 3])?,
        };
        let proto = match column("proto") {
            Some(a) => a
                .get(i)
                .and_then(Value::as_u64)
                .map(|p| p as usize)
                .filter(|p| *p < of.len())
                .ok_or_else(|| bad("proto"))?,
            None => 0,
        };
        let mut at = local_of(pos, [0.0; 3], scale, [1.0; 3]);
        if let Some(q) = column("rot").and_then(|a| a.get(i)) {
            let q = q
                .as_array()
                .filter(|q| q.len() == 4)
                .and_then(|q| {
                    Some([
                        num(q.first())?,
                        num(q.get(1))?,
                        num(q.get(2))?,
                        num(q.get(3))?,
                    ])
                })
                .ok_or_else(|| bad("rot"))?;
            at = rotated(at, quat(q));
        } else if let Some(y) = column("yaw").and_then(|a| a.get(i)) {
            let y = num(Some(y)).ok_or_else(|| bad("yaw"))?;
            at = local_of(pos, [0.0, y, 0.0], scale, [1.0; 3]);
        }
        out.push(Element {
            id,
            row: i as u32,
            proto,
            at,
        });
    }
    Ok((of, out))
}

/// A unit quaternion `[x, y, z, w]` as a rotation matrix.
fn quat(q: [f64; 4]) -> [[f64; 3]; 3] {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
        .sqrt()
        .max(1e-12);
    let [x, y, z, w] = q.map(|c| c / l);
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

/// `m` (T·S) with `r` between: T·R·S.
fn rotated(m: Affine3, r: [[f64; 3]; 3]) -> Affine3 {
    let mut out = m;
    for i in 0..3 {
        for j in 0..3 {
            out[i][j] = (0..3).map(|k| r[i][k] * m[k][j]).sum();
        }
    }
    out
}

/// The inverse of an affine `m` (its 3×3 part invertible).
pub fn inverse(m: &Affine3) -> Affine3 {
    let a = |r: usize, c: usize| m[r][c];
    let det = a(0, 0) * (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1))
        - a(0, 1) * (a(1, 0) * a(2, 2) - a(1, 2) * a(2, 0))
        + a(0, 2) * (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0));
    let d = if det.abs() < 1e-300 { 1.0 } else { 1.0 / det };
    let inv = [
        [
            (a(1, 1) * a(2, 2) - a(1, 2) * a(2, 1)) * d,
            (a(0, 2) * a(2, 1) - a(0, 1) * a(2, 2)) * d,
            (a(0, 1) * a(1, 2) - a(0, 2) * a(1, 1)) * d,
        ],
        [
            (a(1, 2) * a(2, 0) - a(1, 0) * a(2, 2)) * d,
            (a(0, 0) * a(2, 2) - a(0, 2) * a(2, 0)) * d,
            (a(0, 2) * a(1, 0) - a(0, 0) * a(1, 2)) * d,
        ],
        [
            (a(1, 0) * a(2, 1) - a(1, 1) * a(2, 0)) * d,
            (a(0, 1) * a(2, 0) - a(0, 0) * a(2, 1)) * d,
            (a(0, 0) * a(1, 1) - a(0, 1) * a(1, 0)) * d,
        ],
    ];
    let mut out = [[0.0; 4]; 3];
    for r in 0..3 {
        out[r][..3].copy_from_slice(&inv[r]);
        out[r][3] = -(0..3).map(|k| inv[r][k] * m[k][3]).sum::<f64>();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_union_hides_past_any_plane_and_an_intersect_past_all() {
        let params = json!({"planes": [{"normal": [1, 0, 0], "offset": 0}, {"normal": [0, 0, 2], "offset": 2}]});
        let c = cutaway("c", &params, "p", |_| None, true).unwrap();
        assert!(
            c.hides([0.5, 0.0, 0.0]) && c.hides([-1.0, 0.0, 1.5]) && !c.hides([-1.0, 0.0, 0.5])
        );
        let mut params = params;
        params["mode"] = json!("intersect");
        let c = cutaway("c", &params, "p", |_| None, true).unwrap();
        assert!(!c.hides([0.5, 0.0, 0.0]) && c.hides([0.5, 0.0, 1.5]));
    }

    #[test]
    fn a_hidden_element_is_left_out_and_the_rest_keep_their_ids() {
        let params = json!({"of": ["tree"], "ids": [5000, 5001, 5002], "pos": [[0, 0, 0], [1, 0, 0], [2, 0, 0]], "hidden": [5001]});
        let (_, e) = elements(&params, "p").unwrap();
        assert_eq!(e.iter().map(|e| e.id).collect::<Vec<_>>(), [5000, 5002]);
        assert_eq!(e[1].at[0][3], 2.0);
        let m = [
            [2.0, 0.0, 0.0, 1.0],
            [0.0, 0.0, -3.0, 2.0],
            [0.0, 1.0, 0.0, 3.0],
        ];
        let i = crate::scene::matmul(&inverse(&m), &m);
        for (r, row) in i.iter().enumerate() {
            for (c, got) in row.iter().enumerate() {
                let want = if r == c { 1.0 } else { 0.0 };
                assert!((got - want).abs() < 1e-12);
            }
        }
    }
}
