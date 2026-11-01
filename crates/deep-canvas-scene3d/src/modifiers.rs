//! A solid's modifier stack (canvas primitives: Modifier, Modifier: subdivide; issue #411): the
//! stack runs top to bottom on the solid's mesh and keeps each prefix's result, by a content key
//! over the solid and the modifiers up to it, so `items/<id>/modifiers/<k>#out` reads the result
//! after modifier k from the prefix the stack already made. This slice builds a box's mesh and
//! lands `mod.subdivide@1` (Catmull-Clark), `mod.array@1` and `mod.mirror@1`.

use std::collections::BTreeMap;

use deep_canvas::schedule::{canonical, Canonical, Hasher, Key, OpError, Val, View};
use serde_json::{json, Value};

/// A mesh: its vertices, its faces as vertex rings, and how many parts it holds.
#[derive(Clone, Debug, PartialEq)]
struct Mesh {
    vertices: Vec<[f64; 3]>,
    faces: Vec<Vec<u32>>,
    parts: u64,
}

/// The stack's result after one modifier.
#[derive(Clone, Debug, PartialEq)]
pub struct Prefix {
    pub vertices: u64,
    pub faces: u64,
    pub parts: u64,
    /// `[min, max]` in the item's space.
    pub bounds: [[f64; 3]; 2],
    pub key: Key,
}

impl Prefix {
    pub fn to_json(&self) -> Value {
        json!({"vertices": self.vertices, "faces": self.faces, "parts": self.parts,
               "bounds": self.bounds, "key": self.key.hex()})
    }
}

impl Canonical for Prefix {
    fn encode(&self, out: &mut Vec<u8>) {
        (&self.vertices, &self.faces, &self.parts, &self.bounds).encode(out);
        self.key.0.encode(out);
    }
}

/// Every prefix of an item's stack, in stack order.
#[derive(Clone, Debug, PartialEq)]
pub struct Stack {
    pub prefixes: Vec<Prefix>,
}

impl Canonical for Stack {
    fn encode(&self, out: &mut Vec<u8>) {
        self.prefixes.encode(out);
    }
}

/// The modifier kinds this slice lands.
pub const KINDS: [&str; 3] = ["mod.subdivide@1", "mod.array@1", "mod.mirror@1"];

/// An item with a modifier stack.
pub fn has_modifiers(_: &Value, _: &str, item: &Value) -> bool {
    item.get("modifiers")
        .and_then(Value::as_array)
        .is_some_and(|m| !m.is_empty())
}

/// The box a `mark.box@1`'s size makes, centred on its origin.
fn cube(size: Option<&Value>) -> Option<Mesh> {
    let s = match size {
        None => [1.0; 3],
        Some(Value::Number(n)) => [n.as_f64()?; 3],
        Some(Value::Array(a)) if a.len() == 3 => {
            let v: Vec<f64> = a.iter().map(Value::as_f64).collect::<Option<_>>()?;
            [v[0], v[1], v[2]]
        }
        _ => return None,
    };
    let h = s.map(|x| x / 2.0);
    let vertices = (0..8)
        .map(|i| {
            [
                if i & 1 == 0 { -h[0] } else { h[0] },
                if i & 2 == 0 { -h[1] } else { h[1] },
                if i & 4 == 0 { -h[2] } else { h[2] },
            ]
        })
        .collect();
    let faces = vec![
        vec![0, 2, 3, 1],
        vec![4, 5, 7, 6],
        vec![0, 1, 5, 4],
        vec![2, 6, 7, 3],
        vec![0, 4, 6, 2],
        vec![1, 3, 7, 5],
    ];
    Some(Mesh {
        vertices,
        faces,
        parts: 1,
    })
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

/// One level of Catmull-Clark: a face of n sides becomes n quads (Modifier: subdivide).
fn catmull_clark(m: &Mesh) -> Mesh {
    let nv = m.vertices.len();
    let centroid = |f: &[u32]| {
        let sum = f
            .iter()
            .fold([0.0; 3], |s, &v| add(s, m.vertices[v as usize]));
        scale(sum, 1.0 / f.len() as f64)
    };
    let face_points: Vec<[f64; 3]> = m.faces.iter().map(|f| centroid(f)).collect();
    // Each edge, by its sorted ends, with the faces beside it.
    let mut edges: BTreeMap<(u32, u32), Vec<usize>> = BTreeMap::new();
    for (fi, f) in m.faces.iter().enumerate() {
        for k in 0..f.len() {
            let (a, b) = (f[k], f[(k + 1) % f.len()]);
            edges.entry((a.min(b), a.max(b))).or_default().push(fi);
        }
    }
    let edge_index: BTreeMap<(u32, u32), usize> =
        edges.keys().enumerate().map(|(i, e)| (*e, i)).collect();
    let edge_points: Vec<[f64; 3]> = edges
        .iter()
        .map(|(&(a, b), fs)| {
            let mid = add(m.vertices[a as usize], m.vertices[b as usize]);
            if fs.len() == 2 {
                scale(add(mid, add(face_points[fs[0]], face_points[fs[1]])), 0.25)
            } else {
                scale(mid, 0.5)
            }
        })
        .collect();
    // Each original vertex moves to (Q + 2R + (n − 3)P) / n.
    let mut q = vec![([0.0; 3], 0usize); nv];
    for (fi, f) in m.faces.iter().enumerate() {
        for &v in f {
            let e = &mut q[v as usize];
            e.0 = add(e.0, face_points[fi]);
            e.1 += 1;
        }
    }
    let mut r = vec![([0.0; 3], 0usize); nv];
    for &(a, b) in edges.keys() {
        let mid = scale(add(m.vertices[a as usize], m.vertices[b as usize]), 0.5);
        for v in [a, b] {
            let e = &mut r[v as usize];
            e.0 = add(e.0, mid);
            e.1 += 1;
        }
    }
    let moved: Vec<[f64; 3]> = (0..nv)
        .map(|v| {
            let n = q[v].1 as f64;
            if n == 0.0 {
                return m.vertices[v];
            }
            let qa = scale(q[v].0, 1.0 / n);
            let ra = scale(r[v].0, 1.0 / r[v].1 as f64);
            scale(
                add(add(qa, scale(ra, 2.0)), scale(m.vertices[v], n - 3.0)),
                1.0 / n,
            )
        })
        .collect();
    let mut vertices = moved;
    let edge_base = vertices.len() as u32;
    vertices.extend(&edge_points);
    let face_base = vertices.len() as u32;
    vertices.extend(&face_points);
    let mut faces = Vec::new();
    for (fi, f) in m.faces.iter().enumerate() {
        let n = f.len();
        for k in 0..n {
            let (prev, cur, next) = (f[(k + n - 1) % n], f[k], f[(k + 1) % n]);
            let e_in = edge_index[&(prev.min(cur), prev.max(cur))] as u32;
            let e_out = edge_index[&(cur.min(next), cur.max(next))] as u32;
            faces.push(vec![
                cur,
                edge_base + e_out,
                face_base + fi as u32,
                edge_base + e_in,
            ]);
        }
    }
    Mesh {
        vertices,
        faces,
        parts: m.parts,
    }
}

/// `count` copies, each `offset` past the last.
fn array(m: &Mesh, count: u64, offset: [f64; 3]) -> Mesh {
    let mut out = Mesh {
        vertices: Vec::new(),
        faces: Vec::new(),
        parts: m.parts * count,
    };
    for c in 0..count {
        let base = out.vertices.len() as u32;
        let shift = scale(offset, c as f64);
        out.vertices
            .extend(m.vertices.iter().map(|v| add(*v, shift)));
        out.faces
            .extend(m.faces.iter().map(|f| f.iter().map(|i| i + base).collect()));
    }
    out
}

/// The mesh and its reflection through the origin's plane across `axis`, faces turned so they
/// still face out.
fn mirror(m: &Mesh, axis: usize) -> Mesh {
    let base = m.vertices.len() as u32;
    let mut out = m.clone();
    out.parts *= 2;
    out.vertices.extend(m.vertices.iter().map(|v| {
        let mut w = *v;
        w[axis] = -w[axis];
        w
    }));
    out.faces.extend(
        m.faces
            .iter()
            .map(|f| f.iter().rev().map(|i| i + base).collect()),
    );
    out
}

fn bounds(m: &Mesh) -> [[f64; 3]; 2] {
    let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for v in &m.vertices {
        for k in 0..3 {
            b[0][k] = b[0][k].min(v[k]);
            b[1][k] = b[1][k].max(v[k]);
        }
    }
    b
}

/// One modifier applied, or why it can't be.
fn apply(m: &Mesh, modifier: &Value, path: &str) -> Result<Mesh, OpError> {
    let kind = modifier.get("kind").and_then(Value::as_str).unwrap_or("");
    let params = modifier.get("params").cloned().unwrap_or(json!({}));
    let bad = |field: &str| OpError::new("out_of_range", format!("{path}/params/{field}"));
    match kind {
        "mod.subdivide@1" => {
            let levels = params.get("levels").map_or(Some(1), Value::as_u64);
            let levels = levels.filter(|l| *l <= 3).ok_or_else(|| bad("levels"))?;
            Ok((0..levels).fold(m.clone(), |m, _| catmull_clark(&m)))
        }
        "mod.array@1" => {
            let count = params.get("count").and_then(Value::as_u64);
            let count = count
                .filter(|c| (1..=1024).contains(c))
                .ok_or_else(|| bad("count"))?;
            let offset = match params.get("offset") {
                None => [0.0; 3],
                Some(Value::Array(a)) if a.len() == 3 => {
                    let v: Vec<f64> = a
                        .iter()
                        .map(Value::as_f64)
                        .collect::<Option<_>>()
                        .ok_or_else(|| bad("offset"))?;
                    [v[0], v[1], v[2]]
                }
                _ => return Err(bad("offset")),
            };
            Ok(array(m, count, offset))
        }
        "mod.mirror@1" => {
            let axes = params
                .get("axes")
                .and_then(Value::as_array)
                .ok_or_else(|| bad("axes"))?;
            let mut out = m.clone();
            for a in axes {
                let axis = match a.as_str() {
                    Some("x") => 0,
                    Some("y") => 1,
                    Some("z") => 2,
                    _ => return Err(bad("axes")),
                };
                out = mirror(&out, axis);
            }
            Ok(out)
        }
        _ => Err(OpError::new("unknown_kind", format!("{path}/kind"))),
    }
}

/// The item's stack, each prefix kept by its content key: the item without its stack, then each
/// modifier up to it, so the stack cut after k keys its last prefix as the full stack keys k.
pub fn stack(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let item = v.item()?;
    let path = format!("items/{id}/modifiers");
    let mut mesh = cube(item.pointer("/params/size"))
        .ok_or_else(|| OpError::new("out_of_range", format!("items/{id}/params/size")))?;
    let mut base = item.clone();
    if let Some(map) = base.as_object_mut() {
        map.remove("modifiers");
    }
    let mut hasher = Hasher::new("scene3d.stack");
    hasher.bytes(&canonical(&base));
    let mut prefixes = Vec::new();
    let list = item.get("modifiers").and_then(Value::as_array).cloned();
    for (k, modifier) in list.into_iter().flatten().enumerate() {
        mesh = apply(&mesh, &modifier, &format!("{path}/{k}"))?;
        hasher.bytes(&canonical(&modifier));
        let b = bounds(&mesh);
        prefixes.push(Prefix {
            vertices: mesh.vertices.len() as u64,
            faces: mesh.faces.len() as u64,
            parts: mesh.parts,
            bounds: b,
            key: hasher.finish(),
        });
    }
    v.write("scene3d.stack", Val::typed(Stack { prefixes }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_catmull_clark_level_of_a_cube_gives_the_design_counts() {
        // V′ = V + E + F = 8 + 12 + 6; faces = C = 24 quads.
        let m = catmull_clark(&cube(None).unwrap());
        assert_eq!((m.vertices.len(), m.faces.len()), (26, 24));
        let m = catmull_clark(&m);
        // V″ = 26 + 48 + 24; faces = 4 × 24.
        assert_eq!((m.vertices.len(), m.faces.len()), (98, 96));
    }
}
