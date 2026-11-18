use super::*;
use serde_json::json;

/// Builder `ball`: tessellation (#423): detail 0 gives the four Platonic solids, closed, with
/// flat faces and the declared 3 × faces × (detail + 1)² vertices; the dodecahedron's twelve
/// pentagons are flat, so each of its 36 triangles shares its normal with two others.
#[test]
fn detail_zero_gives_the_four_platonic_solids_with_flat_faces() {
    for (base, faces, corners) in [
        ("tetra", 4, 4),
        ("octa", 8, 6),
        ("icosa", 20, 12),
        ("dodeca", 36, 20),
    ] {
        let p = json!({"tessellation": "geodesic", "base": base, "radius": 1.0});
        let m = ball(&p, Plants::default()).unwrap();
        assert_eq!(m.triangles(), faces, "{base}");
        assert_eq!(
            ball_count(&p).unwrap(),
            (3 * faces as u64, faces as u64),
            "{base}"
        );
        let mut distinct: Vec<V3> = Vec::new();
        for q in &m.positions {
            if !distinct.iter().any(|d| length(sub(*d, *q)) < 1e-9) {
                distinct.push(*q);
            }
        }
        assert_eq!(distinct.len(), corners, "{base}");
        for t in m.indices.as_chunks::<3>().0 {
            let [a, b, c] = t.map(|i| m.positions[i as usize]);
            let n = unit(cross(sub(b, a), sub(c, a)));
            assert!(
                dot(n, unit(add(add(a, b), c))) > 0.0,
                "{base}: wound outward"
            );
            for i in t {
                assert!(
                    length(sub(m.normals[*i as usize], n)) < 1e-9,
                    "{base}: flat"
                );
            }
        }
    }
}
