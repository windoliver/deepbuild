//! The hit path in 3D (#1976; canvas primitives: Selection, `hit`): the exact point where a ray
//! through a view pixel meets the item the object-ID pick named, on that item's evaluated
//! triangles, on the CPU in f64, never read back from depth. Point and ask's `hit` (#1400),
//! render-back's probes (#1401) and the measure tool (#1217) read it.

use deep_canvas::ops::sqrt;

use crate::scene::{Camera, Scene};

type V3 = [f64; 3];

/// Where a ray meets an item: the item and its sub-address (after `#`), the world point in m, the
/// met triangle's unit normal turned toward the ray, and the distance in m along the ray.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub item: String,
    pub sub: Option<String>,
    pub point: V3,
    pub normal: V3,
    pub distance: f64,
}

/// Where the ray through view px `at` meets each pick target (`item[#sub]`, as the object-ID pass
/// names it): for each, the nearest point on its triangles that its cutaway keeps, nearest
/// first, ties by ID. A target the ray misses, or one with no triangles, has none.
pub fn hits(scene: &Scene, at: [f64; 2], targets: &[&str]) -> Vec<Hit> {
    let (o, d) = ray(&scene.camera, at);
    let mut found: Vec<(&str, f64, V3)> = Vec::new();
    for id in targets {
        let mut best: Option<(f64, V3)> = None;
        for s in scene.layers.iter().flat_map(|l| &l.solids) {
            if s.id != *id || s.cast_only {
                continue;
            }
            let cut = scene.cutaway.as_ref().filter(|_| s.cut);
            for t in crate::shore::triangles(s) {
                let Some(dist) = meet(o, d, &t) else { continue };
                if best.is_some_and(|(b, _)| b <= dist) {
                    continue;
                }
                if cut.is_some_and(|c| c.hides(along(o, d, dist))) {
                    continue;
                }
                best = Some((dist, unit(cross(sub(t[1], t[0]), sub(t[2], t[0])))));
            }
        }
        if let Some((dist, n)) = best {
            found.push((id, dist, n));
        }
    }
    found.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(b.0)));
    found
        .into_iter()
        .map(|(id, dist, n)| {
            let (item, sub) = match id.split_once('#') {
                Some((item, sub)) => (item.to_string(), Some(sub.to_string())),
                None => (id.to_string(), None),
            };
            let normal = if dot(n, d) > 0.0 { n.map(|x| -x) } else { n };
            Hit {
                item,
                sub,
                point: along(o, d, dist),
                normal,
                distance: dist,
            }
        })
        .collect()
}

/// The ray through view px `at`, with a unit direction: from the eye in perspective, from the
/// eye's plane in orthographic.
fn ray(cam: &Camera, at: [f64; 2]) -> (V3, V3) {
    if cam.perspective {
        (
            cam.eye,
            unit(sub(cam.unproject(at[0], at[1], 1.0), cam.eye)),
        )
    } else {
        (cam.unproject(at[0], at[1], 0.0), cam.forward)
    }
}

/// How far along `d` the ray from `o` meets triangle `t`, either face, ahead of `o`
/// (Möller–Trumbore).
fn meet(o: V3, d: V3, t: &[V3; 3]) -> Option<f64> {
    let (e1, e2) = (sub(t[1], t[0]), sub(t[2], t[0]));
    let p = cross(d, e2);
    let det = dot(e1, p);
    if det == 0.0 {
        return None;
    }
    let s = sub(o, t[0]);
    let u = dot(s, p) / det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(d, q) / det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let dist = dot(e2, q) / det;
    (dist > 0.0).then_some(dist)
}

fn along(o: V3, d: V3, k: f64) -> V3 {
    [o[0] + d[0] * k, o[1] + d[1] * k, o[2] + d[2] * k]
}
fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn unit(a: V3) -> V3 {
    let l = sqrt(dot(a, a));
    a.map(|x| x / l)
}
