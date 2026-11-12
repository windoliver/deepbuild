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
            nearest(&mut best, o, d, &crate::shore::triangles(s), cut);
        }
        if let Some((dist, n)) = best {
            found.push((id, dist, n));
        }
    }
    found.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(b.0)));
    found
        .into_iter()
        .map(|(id, dist, n)| hit(id, o, d, dist, n))
        .collect()
}

/// The most hits a render-back probe answers (canvas primitives: Render-back, `probes`).
pub const PER_PROBE: usize = 8;

/// What lies under each view px of `ats` (#1401: render-back's probes): every solid the ray
/// through it meets, at the nearest point its cutaway keeps, nearest first, ties by ID, up to
/// the first it can't see through and any at that same distance, at most [`PER_PROBE`]. Where
/// `drawn` is false the object-ID pass drew no surface, so only see-through ones are kept.
pub fn through(scene: &Scene, ats: &[([f64; 2], bool)]) -> Vec<Vec<Hit>> {
    let solids: Vec<_> = scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| !s.cast_only)
        .map(|s| {
            let cut = scene.cutaway.as_ref().filter(|_| s.cut);
            (
                s.id.as_str(),
                see_through(s),
                crate::shore::triangles(s),
                cut,
            )
        })
        .collect();
    ats.iter()
        .map(|&(at, drawn)| {
            let (o, d) = ray(&scene.camera, at);
            // Each ID's nearest point, whichever of its solids holds it.
            let mut by_id: Vec<(&str, f64, V3, bool)> = Vec::new();
            for (id, clear, tris, cut) in &solids {
                let mut best = None;
                nearest(&mut best, o, d, tris, *cut);
                let Some((dist, n)) = best else { continue };
                match by_id.iter_mut().find(|f| f.0 == *id) {
                    Some(f) if f.1 <= dist => {}
                    Some(f) => *f = (id, dist, n, *clear),
                    None => by_id.push((id, dist, n, *clear)),
                }
            }
            by_id.sort_by(|a, b| a.1.total_cmp(&b.1).then_with(|| a.0.cmp(b.0)));
            let stop = by_id.iter().find(|f| !f.3).map_or(f64::INFINITY, |f| f.1);
            by_id
                .into_iter()
                .filter(|f| f.1 <= stop && (drawn || f.3))
                .take(PER_PROBE)
                .map(|(id, dist, n, _)| hit(id, o, d, dist, n))
                .collect()
        })
        .collect()
}

/// Whether a solid draws see-through, so a ray goes on past it: below full coverage, in the
/// per-pixel lists, blended, added or transmissive.
fn see_through(s: &crate::scene::Solid) -> bool {
    s.alpha < 1.0
        || s.per_pixel
        || s.material
            .as_ref()
            .is_some_and(|m| m.alpha_mode.see_through() || m.lobes.transmission > 0.0)
}

/// Lowers `best` to where the ray from `o` along `d` first meets `tris` at a point `cut` keeps,
/// with that triangle's unit normal.
fn nearest(
    best: &mut Option<(f64, V3)>,
    o: V3,
    d: V3,
    tris: &[[V3; 3]],
    cut: Option<&crate::cut::Cutaway>,
) {
    for t in tris {
        let Some(dist) = meet(o, d, t) else { continue };
        if best.is_some_and(|(b, _)| b <= dist) {
            continue;
        }
        if cut.is_some_and(|c| c.hides(along(o, d, dist))) {
            continue;
        }
        *best = Some((dist, unit(cross(sub(t[1], t[0]), sub(t[2], t[0])))));
    }
}

/// The hit on pick target `id` at `dist` along the ray, its normal turned toward the ray.
fn hit(id: &str, o: V3, d: V3, dist: f64, n: V3) -> Hit {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{evaluate, Labels};
    use serde_json::json;

    /// #1401: twelve see-through panes in a row along the view axis: a probe through them all
    /// answers the eight nearest, nearest first, and nothing past its cap.
    #[test]
    fn a_probe_answers_at_most_eight_hits_nearest_first() {
        let mut items = json!({
            "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                    "params": {"projection": "perspective", "position": [0, 0, 20], "target": [0, 0, 0], "fov": 40}},
            "glass": {"id": "glass", "kind": "material@1", "order": "a1",
                      "params": {"base_color": [0.8, 0.9, 1, 1], "unlit": true, "alpha_mode": "blend", "alpha": 0.3}}
        });
        for k in 0..12 {
            let id = format!("pane-{k:02}");
            items[&id] = json!({"id": id, "kind": "mark.box@1", "order": format!("b{k:02}"), "material": "glass",
                                "params": {"size": [4, 4, 0.1]}, "at": {"pos": [0, 0, 10 - k]}});
        }
        let doc = json!({"format": 1, "size": [320, 240], "camera": "cam", "items": items});
        let look = crate::look::Look3::from_roles(
            [
                ("ink".to_string(), [0, 0, 0]),
                ("ground".to_string(), [255, 255, 255]),
            ]
            .into_iter()
            .collect(),
        );
        let scene = evaluate(&doc, 0, &look, &mut Labels::new()).unwrap();
        let answered = through(&scene, &[([160.5, 120.5], true)]);
        let names: Vec<&str> = answered[0].iter().map(|h| h.item.as_str()).collect();
        let nearest: Vec<String> = (0..PER_PROBE).map(|k| format!("pane-{k:02}")).collect();
        assert_eq!(names, nearest);
    }
}
