//! Geometry measures as read-only attributes (canvas primitives: Attribute and field: geometry
//! measures; issue #2015): `convexity` and `occlusion` on points, `face_area` and `island` on
//! faces, each computed from the built mesh and read by name like any attribute; and the
//! elements of a built item's named part that a recipe repeats over (Recipe: repeat over
//! elements).

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops::{atan2, cos, sin, sqrt};
use serde_json::{json, Map, Value};

use crate::deviation::Bvh;
use crate::geom::{add, cross, dot, length, scale, sub, unit, Mesh, V3};
use crate::poly::Poly;

/// The fixed directions occlusion casts, in the upper hemisphere of each point's normal.
const RAYS: usize = 32;

/// A point measure per mesh vertex, by name, or `None` for a name that isn't one.
pub fn point(m: &Mesh, name: &str) -> Option<Vec<f64>> {
    let p = Poly::of(m);
    let welded = match name {
        "convexity" => convexity(&p),
        "occlusion" => occlusion(m, &p),
        _ => return None,
    };
    Some(m.welded().iter().map(|&w| welded[w as usize]).collect())
}

/// A face measure per triangle, by name, or `None` for a name that isn't one.
pub fn face(m: &Mesh, name: &str) -> Option<Vec<f64>> {
    match name {
        "face_area" => {
            let mut area: BTreeMap<u32, f64> = BTreeMap::new();
            for t in 0..m.triangles() {
                *area.entry(m.faces[t]).or_default() += triangle_area(m, t);
            }
            Some((0..m.triangles()).map(|t| area[&m.faces[t]]).collect())
        }
        "island" => Some(islands(m)),
        _ => None,
    }
}

fn triangle_area(m: &Mesh, t: usize) -> f64 {
    let [a, b, c] = [0, 1, 2].map(|j| m.positions[m.indices[3 * t + j] as usize]);
    length(cross(sub(b, a), sub(c, a))) / 2.0
}

/// Each triangle's island: triangles that share a welded point are one, numbered in the order
/// of their first triangles.
fn islands(m: &Mesh) -> Vec<f64> {
    let w = m.welded();
    let mut root: Vec<usize> = (0..w.iter().max().map_or(0, |x| *x as usize + 1)).collect();
    fn find(root: &mut [usize], mut a: usize) -> usize {
        while root[a] != a {
            root[a] = root[root[a]];
            a = root[a];
        }
        a
    }
    for t in 0..m.triangles() {
        let a = w[m.indices[3 * t] as usize] as usize;
        for j in 1..3 {
            let (x, y) = (
                find(&mut root, a),
                find(&mut root, w[m.indices[3 * t + j] as usize] as usize),
            );
            root[x.max(y)] = x.min(y);
        }
    }
    let mut number: BTreeMap<usize, usize> = BTreeMap::new();
    (0..m.triangles())
        .map(|t| {
            let r = find(&mut root, w[m.indices[3 * t] as usize] as usize);
            let next = number.len();
            *number.entry(r).or_insert(next) as f64
        })
        .collect()
}

/// A face's centroid by area, fanned from its first corner (its corners' mean when flat).
fn centroid(p: &Poly, f: usize) -> V3 {
    let c: Vec<V3> = p.faces[f].iter().map(|&k| p.points[k as usize]).collect();
    let (mut sum, mut weight) = ([0.0; 3], 0.0);
    for k in 1..c.len().saturating_sub(1) {
        let a = length(cross(sub(c[k], c[0]), sub(c[k + 1], c[0])));
        sum = add(sum, scale(add(add(c[0], c[k]), c[k + 1]), a / 3.0));
        weight += a;
    }
    if weight > 0.0 {
        scale(sum, 1.0 / weight)
    } else {
        scale(
            c.iter().copied().fold([0.0; 3], add),
            1.0 / c.len().max(1) as f64,
        )
    }
}

/// Each welded point's convexity, −1 to 1, a discrete mean curvature: its edges' exterior
/// angles, positive where the faces fold away (a ridge) and negative where they fold in (a
/// valley), weighted by length, over π times their length; a boundary edge adds length only.
fn convexity(p: &Poly) -> Vec<f64> {
    let mut num = vec![0.0; p.points.len()];
    let mut den = vec![0.0; p.points.len()];
    for ((a, b), faces) in p.edges() {
        let len = length(sub(p.points[b as usize], p.points[a as usize]));
        let signed = match faces[..] {
            [f, g] => {
                let (n, m) = (unit(p.normal(f)), unit(p.normal(g)));
                let angle = atan2(length(cross(n, m)), dot(n, m));
                let fold = dot(n, sub(centroid(p, g), centroid(p, f)));
                if fold < 0.0 {
                    angle
                } else {
                    -angle
                }
            }
            _ => 0.0,
        };
        for k in [a, b] {
            num[k as usize] += signed * len;
            den[k as usize] += std::f64::consts::PI * len;
        }
    }
    num.iter()
        .zip(&den)
        .map(|(n, d)| {
            if *d > 0.0 {
                (n / d).clamp(-1.0, 1.0)
            } else {
                0.0
            }
        })
        .collect()
}

/// The 32 fixed directions, spread over the sphere from a fixed hash, the same on every
/// machine.
fn directions() -> [V3; RAYS] {
    let mut state: u64 = 0x2015_0cc1_u64;
    let mut next = || {
        // SplitMix64.
        state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = state;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    };
    std::array::from_fn(|_| {
        let (z, phi) = (1.0 - 2.0 * next(), std::f64::consts::TAU * next());
        let r = sqrt((1.0 - z * z).max(0.0));
        [r * cos(phi), z, r * sin(phi)]
    })
}

/// Each welded point's area-weighted normal over its faces.
fn point_normals(p: &Poly) -> Vec<V3> {
    let mut n = vec![[0.0; 3]; p.points.len()];
    for (f, c) in p.faces.iter().enumerate() {
        let face = p.normal(f);
        for &k in c {
            n[k as usize] = add(n[k as usize], face);
        }
    }
    n.into_iter().map(unit).collect()
}

/// Each welded point's occlusion, 0 to 1: the share of the fixed directions, turned into its
/// normal's hemisphere, along which a ray from just off the surface meets the mesh's own
/// triangles.
fn occlusion(m: &Mesh, p: &Poly) -> Vec<f64> {
    let tris: Vec<[V3; 3]> = (0..m.triangles())
        .map(|t| [0, 1, 2].map(|j| m.positions[m.indices[3 * t + j] as usize]))
        .collect();
    let [lo, hi] = m.bounds();
    let off = 1e-6 * length(sub(hi, lo)).max(1e-3);
    let bvh = Bvh::new(tris);
    let dirs = directions();
    p.points
        .iter()
        .zip(point_normals(p))
        .map(|(&q, n)| {
            let o = add(q, scale(n, off));
            let hits = dirs
                .iter()
                .filter(|&&d| {
                    let d = if dot(d, n) < 0.0 { scale(d, -1.0) } else { d };
                    bvh.blocks(o, d, off * 1e-3)
                })
                .count();
            hits as f64 / RAYS as f64
        })
        .collect()
}

/// #1935, geometry.shading's `hidden_faces`: whether each triangle is hidden, none of its sample
/// points reaching the bounding sphere along the fixed directions. Each point is tried from both
/// sides of its face, each direction turned into that side's hemisphere as occlusion turns it, so
/// a face is hidden only when neither side sees out. A triangle with no area is never hidden.
pub fn hidden(tris: &[[V3; 3]]) -> Vec<bool> {
    // The centroid, then points 2/3 and 0.9 of the way to each corner.
    const SAMPLES: [[f64; 3]; 7] = [
        [1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0],
        [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
        [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
        [1.0 / 6.0, 1.0 / 6.0, 2.0 / 3.0],
        [0.9, 0.05, 0.05],
        [0.05, 0.9, 0.05],
        [0.05, 0.05, 0.9],
    ];
    let (mut lo, mut hi) = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
    for p in tris.iter().flatten() {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k]);
            hi[k] = hi[k].max(p[k]);
        }
    }
    let off = if tris.is_empty() {
        0.0
    } else {
        1e-6 * length(sub(hi, lo)).max(1e-3)
    };
    let bvh = Bvh::new(tris.to_vec());
    let dirs = directions();
    tris.iter()
        .map(|&[a, b, c]| {
            let n = cross(sub(b, a), sub(c, a));
            if length(n) == 0.0 {
                return false;
            }
            let n = unit(n);
            let sees_out = SAMPLES.iter().any(|w| {
                let q = add(add(scale(a, w[0]), scale(b, w[1])), scale(c, w[2]));
                [n, scale(n, -1.0)].iter().any(|&side| {
                    let o = add(q, scale(side, off));
                    dirs.iter().any(|&d| {
                        let d = if dot(d, side) < 0.0 {
                            scale(d, -1.0)
                        } else {
                            d
                        };
                        !bvh.blocks(o, d, off * 1e-3)
                    })
                })
            });
            !sees_out
        })
        .collect()
}

/// The elements of a built item's part in a domain, in index order (Recipe: repeat over
/// elements): each face of the part's polygon view, or each welded point on them, with `i`,
/// `center`, `normal`, `area`, `size` and the part's attributes and measures. Registered by
/// scene3d for each builder kind (`deep_canvas::registry::Elements`).
pub fn elements(
    doc: &Value,
    id: &str,
    item: &Value,
    part: &str,
    domain: &str,
    planted: Option<&str>,
) -> Result<Vec<Value>, String> {
    let built = crate::build::built(doc, id, item, &Default::default(), 0.0)?;
    let m = built.mesh.ok_or("it builds no mesh")?;
    let tris: BTreeSet<u32> = m
        .parts
        .get(part)
        .ok_or_else(|| format!("its builder makes no part `{part}`"))?
        .iter()
        .copied()
        .collect();
    // #2015's planted wrong program walks triangles, not the polygon view's faces.
    let p = if planted == Some("each_face_per_triangle") {
        Poly::triangles_of(&m)
    } else {
        Poly::of(&m)
    };
    let faces: Vec<usize> = (0..p.faces.len())
        .filter(|&f| tris.contains(&p.origin[f]))
        .collect();
    // −0 reads as 0, so equal elements write equal bytes.
    let num = |v: f64| if v == 0.0 { 0.0 } else { v };
    let number = |v: f64| json!(num(v));
    let v3 = |v: V3| json!(v.map(num));
    let mut out = Vec::new();
    match domain {
        "face" => {
            let mut measures: Vec<(&str, Vec<f64>)> = Vec::new();
            for name in ["face_area", "island"] {
                measures.push((name, face(&m, name).unwrap_or_default()));
            }
            for (name, values) in &m.face_attributes {
                measures.push((name, values.clone()));
            }
            for (i, &f) in faces.iter().enumerate() {
                let n = unit(p.normal(f));
                let c = centroid(&p, f);
                // The face's extent along its own axes: +X laid into its plane (+Z for a face
                // that faces along X), and the normal across that.
                let x = sub([1.0, 0.0, 0.0], scale(n, n[0]));
                let u = if length(x) > 1e-9 {
                    unit(x)
                } else {
                    unit(sub([0.0, 0.0, 1.0], scale(n, n[2])))
                };
                let v = cross(n, u);
                let span = |axis: V3| {
                    let along = p.faces[f]
                        .iter()
                        .map(|&k| dot(sub(p.points[k as usize], c), axis));
                    let (lo, hi) = along.fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), x| {
                        (a.min(x), b.max(x))
                    });
                    hi - lo
                };
                let mut e = Map::new();
                e.insert("i".into(), json!(i));
                e.insert("center".into(), v3(c));
                e.insert("normal".into(), v3(n));
                e.insert("area".into(), number(length(p.normal(f)) / 2.0));
                e.insert("size".into(), json!([number(span(u)), number(span(v))]));
                let origin = p.origin[f] as usize;
                for (name, values) in &measures {
                    if let Some(x) = values.get(origin) {
                        e.insert(name.to_string(), number(*x));
                    }
                }
                out.push(Value::Object(e));
            }
        }
        "point" => {
            let points: BTreeSet<u32> = faces
                .iter()
                .flat_map(|&f| p.faces[f].iter().copied())
                .collect();
            let normals = point_normals(&p);
            let mut area = vec![0.0; p.points.len()];
            for &f in &faces {
                let share = length(p.normal(f)) / 2.0 / p.faces[f].len() as f64;
                for &k in &p.faces[f] {
                    area[k as usize] += share;
                }
            }
            let mut measures: Vec<(&str, Vec<f64>)> = vec![
                ("convexity", convexity(&p)),
                ("occlusion", occlusion(&m, &p)),
            ];
            for (name, values) in &p.attrs {
                measures.push((name, values.clone()));
            }
            for (i, &k) in points.iter().enumerate() {
                let k = k as usize;
                let mut e = Map::new();
                e.insert("i".into(), json!(i));
                e.insert("center".into(), v3(p.points[k]));
                e.insert("normal".into(), v3(normals[k]));
                e.insert("area".into(), number(area[k]));
                e.insert("size".into(), json!([0, 0]));
                for (name, values) in &measures {
                    e.insert(name.to_string(), number(values[k]));
                }
                out.push(Value::Object(e));
            }
        }
        _ => return Err(format!("a built mesh's part has no {domain}s")),
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builders::{self, Ctx};

    fn built(kind: &str, params: Value) -> Mesh {
        let doc = json!({"items": {}});
        let ctx = Ctx {
            doc: &doc,
            id: "it",
            plants: Default::default(),
            outlines: &[],
            planted: None,
        };
        builders::build(kind, &params, &ctx).unwrap()
    }

    #[test]
    fn a_cube_is_convex_everywhere_and_a_flat_plate_is_flat() {
        let cube = built("slab@1", json!({"size": [1, 1, 1]}));
        let c = point(&cube, "convexity").unwrap();
        // Each corner meets three 90° edges: (π/2 × 3) / (π × 3) = 0.5.
        assert!(c.iter().all(|x| (x - 0.5).abs() < 1e-9), "{c:?}");
        let plate = built("plate@1", json!({"grid": [3, 2], "size": [3, 2]}));
        let p = point(&plate, "convexity").unwrap();
        assert!(p.iter().all(|x| x.abs() < 1e-12), "{p:?}");
    }

    #[test]
    fn a_valley_reads_negative() {
        // Two faces folded up about the z axis: a V whose crease is a valley.
        let mut m = Mesh::default();
        let up = [0.0, 1.0, 0.0];
        for q in [
            [-1.0, 1.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 1.0],
            [-1.0, 1.0, 1.0],
        ] {
            m.vertex(q, up);
        }
        for q in [[1.0, 1.0, 0.0], [1.0, 1.0, 1.0]] {
            m.vertex(q, up);
        }
        m.indices = vec![0, 2, 1, 0, 3, 2, 1, 2, 5, 1, 5, 4];
        m.faces = vec![0, 0, 1, 1];
        let c = point(&m, "convexity").unwrap();
        assert!(c[1] < 0.0 && c[2] < 0.0, "{c:?}");
    }

    #[test]
    fn faces_read_their_area_and_islands_count_apart() {
        let plate = built("plate@1", json!({"grid": [3, 2], "size": [3, 2]}));
        let a = face(&plate, "face_area").unwrap();
        assert!(a.iter().all(|x| (x - 1.0).abs() < 1e-12), "{a:?}");
        let mut two = plate.clone();
        let mut apart = plate.mapped(|q| add(q, [10.0, 0.0, 0.0]), |_, n| n);
        apart.faces.iter_mut().for_each(|f| *f += 100);
        two.append(&apart, "");
        let islands = face(&two, "island").unwrap();
        let n = plate.triangles();
        assert!(islands[..n].iter().all(|x| *x == 0.0));
        assert!(islands[n..].iter().all(|x| *x == 1.0), "{islands:?}");
    }

    #[test]
    fn occlusion_is_open_above_a_plate_and_closed_inside_a_box() {
        let plate = built("plate@1", json!({"grid": [2, 2], "size": [2, 2]}));
        assert!(point(&plate, "occlusion")
            .unwrap()
            .iter()
            .all(|x| *x == 0.0));
        // Inward-facing: a cube turned inside out sees itself along every ray.
        let cube = built("slab@1", json!({"size": [1, 1, 1]})).turned();
        let o = point(&cube, "occlusion").unwrap();
        assert!(o.iter().all(|x| *x == 1.0), "{o:?}");
    }

    #[test]
    fn a_grid_plates_faces_are_its_cells_x_fastest() {
        let doc = json!({"items": {"g": {"kind": "plate@1", "params": {"grid": [3, 2], "size": [3, 2]}}}});
        let item = &doc["items"]["g"];
        let faces = elements(&doc, "g", item, "top", "face", None).unwrap();
        assert_eq!(faces.len(), 6);
        let at = |e: &Value, k: usize| e["center"][k].as_f64().unwrap();
        let want = [
            [-1.0, -0.5],
            [0.0, -0.5],
            [1.0, -0.5],
            [-1.0, 0.5],
            [0.0, 0.5],
            [1.0, 0.5],
        ];
        for (e, w) in faces.iter().zip(want) {
            assert!(
                (at(e, 0) - w[0]).abs() < 1e-9 && (at(e, 2) - w[1]).abs() < 1e-9,
                "{e}"
            );
            let size: Vec<f64> = (0..2).map(|k| e["size"][k].as_f64().unwrap()).collect();
            assert!(size.iter().all(|s| (s - 1.0).abs() < 1e-9), "{e}");
            assert!((e["area"].as_f64().unwrap() - 1.0).abs() < 1e-9, "{e}");
        }
        assert_eq!(faces[4]["i"], json!(4));
        assert_eq!(faces[0]["normal"], json!([0.0, 1.0, 0.0]));
        assert!(elements(&doc, "g", item, "rim", "face", None).is_err());
        assert_eq!(
            elements(&doc, "g", item, "top", "point", None)
                .unwrap()
                .len(),
            12
        );
    }
}
