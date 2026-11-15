//! #524: an item a soft body draws through (Physics output: a skin). The physics module writes
//! the soft body's particle positions at a frame's time into the item as `skin: {positions}`, in
//! world metres, one per welded vertex of the item's mesh in order of first appearance (a plate's
//! grid, a ball's lattice or a soft volume's source); here each vertex takes its welded point's
//! position and the normals are made again from the moved triangles. A vertex's normal sums the
//! area-weighted normals of the triangles around the vertices that shared both its welded point
//! and its normal as built, so a flat cloth's normals are its plane's, a two-sided plate's back
//! faces the other way, and a cube's corners keep their hard edges. UVs, parts and materials stay
//! the item's own.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::geom::{add, cross, sub, unit, Mesh, V3};

/// `mesh` with `item`'s written skin, or as it was when the item has none; the fault path when
/// the positions don't number the mesh's welded vertices.
pub fn applied(mut mesh: Mesh, item: &Value) -> Result<Mesh, String> {
    let Some(skin) = item.get("skin") else {
        return Ok(mesh);
    };
    let positions: Option<Vec<V3>> =
        skin.get("positions")
            .and_then(Value::as_array)
            .and_then(|a| {
                a.iter()
                    .map(|p| {
                        let p = p.as_array().filter(|p| p.len() == 3)?;
                        Some([p[0].as_f64()?, p[1].as_f64()?, p[2].as_f64()?])
                    })
                    .collect()
            });
    let welded = mesh.welded();
    let n = welded.iter().max().map_or(0, |m| *m as usize + 1);
    let Some(positions) = positions.filter(|p| p.len() == n) else {
        return Err("skin/positions".into());
    };
    // The vertices that share a welded point and a built normal smooth together.
    let mut groups: BTreeMap<(u32, [i64; 3]), usize> = BTreeMap::new();
    let group: Vec<usize> = (0..mesh.positions.len())
        .map(|v| {
            let normal = mesh.normals.get(v).copied().unwrap_or([0.0; 3]);
            let key = (welded[v], normal.map(|x| (x / 1e-6).round() as i64));
            let next = groups.len();
            *groups.entry(key).or_insert(next)
        })
        .collect();
    for (v, w) in welded.iter().enumerate() {
        mesh.positions[v] = positions[*w as usize];
    }
    let mut sums = vec![[0.0; 3]; groups.len()];
    for t in mesh.indices.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|i| i as usize);
        let (pa, pb, pc) = (mesh.positions[a], mesh.positions[b], mesh.positions[c]);
        let face = cross(sub(pb, pa), sub(pc, pa));
        for v in [a, b, c] {
            sums[group[v]] = add(sums[group[v]], face);
        }
    }
    for (v, g) in group.iter().enumerate() {
        if sums[*g] != [0.0; 3] {
            mesh.normals[v] = unit(sums[*g]);
        }
    }
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn plate(two_sided: bool) -> Mesh {
        let item = json!({"kind": "plate@1", "params": {"grid": [3, 2], "size": [3, 2], "two_sided": two_sided}});
        let b = crate::build::built(&json!({}), "p", &item, &Default::default(), 0.0).unwrap();
        b.mesh.unwrap()
    }

    /// A plate of 4 × 3 vertices hung upright: each vertex at its particle, every front normal
    /// the plane's and every back normal the other way.
    #[test]
    fn a_plate_takes_its_particles_and_its_plane_normal() {
        let m = plate(true);
        let positions: Vec<Value> = (0..3)
            .flat_map(|r| (0..4).map(move |c| json!([c as f64 * 0.1, 2.0 - r as f64 * 0.1, 1.0])))
            .collect();
        let out = applied(m.clone(), &json!({"skin": {"positions": positions}})).unwrap();
        assert_eq!(out.positions[5], [0.1, 1.9, 1.0]);
        assert_eq!(out.positions[12 + 5], [0.1, 1.9, 1.0]);
        for v in 0..12 {
            let (front, back) = (out.normals[v], out.normals[12 + v]);
            assert!((front[2].abs() - 1.0).abs() < 1e-12, "{front:?}");
            assert!((front[2] + back[2]).abs() < 1e-12, "{front:?} {back:?}");
        }
        assert!(applied(m, &json!({"skin": {"positions": [[0, 0, 0]]}})).is_err());
    }

    /// A cube's 24 vertices from 8 particles keep three normals at each corner.
    #[test]
    fn a_cube_keeps_its_hard_edges() {
        let item = json!({"kind": "slab@1", "params": {"size": [1, 1, 1]}});
        let m = crate::build::built(&json!({}), "c", &item, &Default::default(), 0.0)
            .unwrap()
            .mesh
            .unwrap();
        let w = m.welded();
        let n = *w.iter().max().unwrap() as usize + 1;
        assert_eq!(n, 8);
        let mut positions = vec![json!(null); n];
        for (v, i) in w.iter().enumerate() {
            let p = m.positions[v];
            positions[*i as usize] = json!([p[0] * 2.0, p[1] * 2.0, p[2] * 2.0]);
        }
        let out = applied(m.clone(), &json!({"skin": {"positions": positions}})).unwrap();
        for v in 0..m.positions.len() {
            let (a, b) = (m.normals[v], out.normals[v]);
            assert!((a[0] - b[0]).abs() + (a[1] - b[1]).abs() + (a[2] - b[2]).abs() < 1e-12);
        }
    }
}
