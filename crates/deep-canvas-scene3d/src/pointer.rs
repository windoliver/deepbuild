//! #540: the point control's 3D math (canvas primitives: Control: point), on the CPU in pinned
//! f64, once at the gesture: the ray through the pointer from the camera's pose, where it meets
//! the ground (a level plane, or a terrain plate's height samples as their two triangles a cell),
//! a box's four corners, the surface it meets on a target's triangles (face, winding normal and
//! uv0), the point of a line or point mark nearest it, the target a margin of the object-ID
//! target names, and the units a box holds. Never on the GPU, and never again on replay: the
//! host stores what these give.

use std::collections::BTreeMap;

use deep_canvas::heights::Heights;
use deep_canvas::ops::{cos, sin, sqrt};

use crate::scene::{Camera, Scene, Shape, Solid};

type V3 = [f64; 3];

/// The planted ray test that also meets the plane behind the camera (#540 criterion 3).
pub const PLANE_BEHIND: &str = "ground_meets_behind_eye";
/// The planted surface uv read from the vertex nearest the point, not by the barycentric weights
/// (#540 criterion 4).
pub const NEAREST_VERTEX_UV: &str = "surface_uv_nearest_vertex";
/// The planted margin pick that takes the nearest in depth before the nearest on screen (#540
/// criterion 9).
pub const NEAREST_DEPTH: &str = "point_pick_nearest_depth";

/// The planted twins of this module's math, each chosen only by a proof scenario's `planted`.
pub const PLANTED: [&str; 3] = [PLANE_BEHIND, NEAREST_VERTEX_UV, NEAREST_DEPTH];

/// A ray: its origin and unit direction, in world m.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ray {
    pub origin: V3,
    pub dir: V3,
}

/// The ray through frame px `at`: from the eye in perspective, from the near plane in
/// orthographic, with a unit direction.
pub fn ray(cam: &Camera, at: [f64; 2]) -> Ray {
    if cam.perspective {
        let far = cam.unproject(at[0], at[1], 1.0);
        Ray {
            origin: cam.eye,
            dir: unit(sub(far, cam.eye)),
        }
    } else {
        Ray {
            origin: cam.unproject(at[0], at[1], cam.near),
            dir: cam.forward,
        }
    }
}

/// A point rounded to 1/1024 m, with no negative zero.
pub fn round(p: V3) -> V3 {
    p.map(|x| (x * 1024.0).round() / 1024.0 + 0.0)
}

/// What a point control's ground is: a level plane at y m, or a terrain plate's samples.
pub enum Ground<'a> {
    Plane(f64),
    Plate(&'a Heights),
}

/// Where `r` first meets the ground ahead of its origin, rounded to 1/1024 m; `None` where it
/// meets nothing. The planted `PLANE_BEHIND` also meets a plane behind it.
pub fn ground(g: &Ground, r: &Ray, planted: Option<&str>) -> Option<V3> {
    let k = match g {
        Ground::Plane(y) => {
            if r.dir[1] == 0.0 {
                return None;
            }
            let k = (y - r.origin[1]) / r.dir[1];
            (k > 0.0 || planted == Some(PLANE_BEHIND)).then_some(k)?
        }
        Ground::Plate(h) => h.ray(r.origin, r.dir)?.0,
    };
    Some(round(along(r, k)))
}

/// A box's four corners on the ground: the rays through the screen rectangle's corners from the
/// press corner clockwise on screen (y down), each met as [`ground`] meets one.
pub fn corners(
    cam: &Camera,
    g: &Ground,
    press: [f64; 2],
    release: [f64; 2],
    planted: Option<&str>,
) -> [Option<V3>; 4] {
    let (x0, x1) = (press[0].min(release[0]), press[0].max(release[0]));
    let (y0, y1) = (press[1].min(release[1]), press[1].max(release[1]));
    let clockwise = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    let start = match (press[0] <= release[0], press[1] <= release[1]) {
        (true, true) => 0,
        (false, true) => 1,
        (false, false) => 2,
        (true, false) => 3,
    };
    std::array::from_fn(|i| ground(g, &ray(cam, clockwise[(start + i) % 4]), planted))
}

/// Where a ray meets an item's drawn surface: the point rounded to 1/1024 m, the triangle's
/// unit normal by its winding, the uv0 there by its barycentric weights (none without uv0), and
/// the triangle's index among the item's triangles in draw order.
#[derive(Clone, Debug, PartialEq)]
pub struct Surface {
    pub point: V3,
    pub normal: V3,
    pub uv: Option<[f64; 2]>,
    pub face: u32,
}

/// Where `r` first meets the solids of pick target `id` (an item, or `item#sub`) as the scene
/// evaluated them, at a point its cutaway keeps; `None` where it misses them all, as at a
/// silhouette.
pub fn surface(scene: &Scene, id: &str, r: &Ray, planted: Option<&str>) -> Option<Surface> {
    let mut face = 0u32;
    let mut best: Option<(f64, Surface)> = None;
    for s in solids(scene).filter(|s| s.id == id) {
        let cut = scene.cutaway.as_ref().filter(|_| s.cut);
        let (positions, uv0, indices) = drawn_mesh(s);
        let world: Vec<V3> = positions.iter().map(|p| apply(&s.model, *p)).collect();
        let uvs = (uv0.len() == positions.len()).then_some(&uv0);
        for t in indices.chunks_exact(3) {
            let i = [t[0] as usize, t[1] as usize, t[2] as usize];
            let Some(tri) = i
                .iter()
                .map(|&k| world.get(k).copied())
                .collect::<Option<Vec<V3>>>()
            else {
                face += 1;
                continue;
            };
            let met = meet(r, [tri[0], tri[1], tri[2]]);
            if let Some((k, u, v)) = met.filter(|m| best.as_ref().is_none_or(|b| m.0 < b.0)) {
                let p = along(r, k);
                if !cut.is_some_and(|c| c.hides(p)) {
                    let w = [1.0 - u - v, u, v];
                    let uv = uvs.map(|uv| {
                        let at = |n: usize| uv[i[n]];
                        if planted == Some(NEAREST_VERTEX_UV) {
                            let d = |n: usize| len2(sub(tri[n], p));
                            at((0..3).fold(0, |a, b| if d(b) < d(a) { b } else { a }))
                        } else {
                            std::array::from_fn(|c| {
                                w[0] * at(0)[c] + w[1] * at(1)[c] + w[2] * at(2)[c]
                            })
                        }
                    });
                    let normal = unit(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
                    best = Some((
                        k,
                        Surface {
                            point: round(p),
                            normal,
                            uv,
                            face,
                        },
                    ));
                }
            }
            face += 1;
        }
    }
    best.map(|(_, s)| s)
}

/// The point of line or point mark `id` nearest the ray, rounded to 1/1024 m: on a line, the
/// point on its nearest drawn segment; `None` where `id` is neither.
pub fn on_mark(scene: &Scene, id: &str, r: &Ray) -> Option<V3> {
    nearest_on_mark(scene, id, r).map(|(_, p)| round(p))
}

/// The point of mark `id` nearest the ray, with its squared distance from it.
fn nearest_on_mark(scene: &Scene, id: &str, r: &Ray) -> Option<(f64, V3)> {
    let mut best: Option<(f64, V3)> = None;
    let mut keep = |c: (f64, V3)| {
        if best.is_none_or(|b| c.0 < b.0) {
            best = Some(c);
        }
    };
    for layer in &scene.layers {
        for l in layer.lines.iter().filter(|l| l.id == id) {
            for s in l.segments.iter().filter(|s| !s.hidden) {
                keep(on_segment(s.a, s.b, r));
            }
        }
        for p in layer.points.iter().filter(|p| p.id == id) {
            let q = along(r, dot(sub(p.pos, r.origin), r.dir).max(0.0));
            keep((len2(sub(p.pos, q)), p.pos));
        }
    }
    best
}

/// The point on segment `ab` nearest the ray, with its squared distance from the ray.
fn on_segment(a: V3, b: V3, r: &Ray) -> (f64, V3) {
    let (u, w) = (sub(b, a), sub(a, r.origin));
    let (uu, ud, uw, dw) = (dot(u, u), dot(u, r.dir), dot(u, w), dot(r.dir, w));
    let clamp = |s: f64| s.clamp(0.0, 1.0);
    let denom = uu - ud * ud;
    let mut s = if uu == 0.0 {
        0.0
    } else if denom > 1e-300 {
        clamp((ud * dw - uw) / denom)
    } else {
        0.0
    };
    let mut t = ud * s + dw;
    if t < 0.0 {
        t = 0.0;
        s = if uu == 0.0 { 0.0 } else { clamp(-uw / uu) };
    }
    let p = [a[0] + u[0] * s, a[1] + u[1] * s, a[2] + u[2] * s];
    (len2(sub(p, along(r, t))), p)
}

/// The object-ID target a view drew: its size in px, each pixel's pick (u32 little-endian, 0
/// where nothing drew), and the stable ID each pick stands for.
pub struct Ids<'a> {
    pub size: [u32; 2],
    pub ids: &'a [u8],
    pub picks: &'a BTreeMap<u32, String>,
}

/// The target the object-ID target names at frame px `at` within `margin` px: the pixel under
/// the pointer when it holds a target, else the target pixel nearest on screen, ties to the
/// nearer in depth (on the CPU, along the ray through that pixel) and then the lower stable ID.
/// Only what drew is read, so a margin never reaches through what hides a target.
pub fn topmost(
    scene: &Scene,
    ids: &Ids,
    at: [f64; 2],
    margin: u32,
    is_target: &dyn Fn(&str) -> bool,
    planted: Option<&str>,
) -> Option<String> {
    let [w, h] = ids.size.map(i64::from);
    let frame = scene.camera.size;
    let scale = [w as f64 / frame[0], h as f64 / frame[1]];
    let p = [0, 1].map(|k| (at[k] * scale[k]).floor() as i64);
    let m = i64::from(margin);
    // Each target's nearest pixel in the window, by squared distance.
    let mut near: BTreeMap<&str, (i64, [i64; 2])> = BTreeMap::new();
    for dy in -m..=m {
        for dx in -m..=m {
            let (x, y, d2) = (p[0] + dx, p[1] + dy, dx * dx + dy * dy);
            if d2 > m * m || !(0..w).contains(&x) || !(0..h).contains(&y) {
                continue;
            }
            let i = ((y * w + x) * 4) as usize;
            let Some(v) = ids.ids.get(i..i + 4) else {
                continue;
            };
            let v = u32::from_le_bytes([v[0], v[1], v[2], v[3]]);
            let Some(id) = ids.picks.get(&v).filter(|id| v != 0 && is_target(id)) else {
                continue;
            };
            let e = near.entry(id.as_str()).or_insert((d2, [x, y]));
            if d2 < e.0 {
                *e = (d2, [x, y]);
            }
        }
    }
    let mut ranked: Vec<(i64, f64, &str)> = near
        .into_iter()
        .map(|(id, (d2, [x, y]))| {
            let centre = [(x as f64 + 0.5) / scale[0], (y as f64 + 0.5) / scale[1]];
            (d2, depth(scene, id, &ray(&scene.camera, centre)), id)
        })
        .collect();
    if planted == Some(NEAREST_DEPTH) {
        ranked.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)).then(a.2.cmp(b.2)));
    } else {
        ranked.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)).then(a.2.cmp(b.2)));
    }
    ranked.first().map(|r| r.2.to_string())
}

/// How far along `r` target `id` lies: its nearest triangle, or its mark's nearest point.
fn depth(scene: &Scene, id: &str, r: &Ray) -> f64 {
    let solid = solids(scene)
        .filter(|s| s.id == id)
        .flat_map(|s| {
            let (positions, _, indices) = drawn_mesh(s);
            let world: Vec<V3> = positions.iter().map(|p| apply(&s.model, *p)).collect();
            indices
                .chunks_exact(3)
                .filter_map(|t| {
                    let tri = [0, 1, 2].map(|k| world.get(t[k] as usize).copied());
                    meet(r, [tri[0]?, tri[1]?, tri[2]?]).map(|m| m.0)
                })
                .collect::<Vec<_>>()
        })
        .min_by(f64::total_cmp);
    solid
        .or_else(|| nearest_on_mark(scene, id, r).map(|(_, p)| dot(sub(p, r.origin), r.dir)))
        .unwrap_or(f64::INFINITY)
}

/// The most units a box release records.
pub const UNITS: usize = 256;

/// The elements of instancers `sets` whose drawn positions project inside the screen rectangle
/// between frame px `press` and `release`: each as its set's index and its key (`slot.gen` as
/// [slot, gen], an integer as [n, 0]), in (set, key) order, at most [`UNITS`]; and whether more
/// lay inside.
pub fn units(
    scene: &Scene,
    sets: &[&str],
    press: [f64; 2],
    release: [f64; 2],
) -> (Vec<(u32, [i64; 2])>, bool) {
    let (x0, x1) = (press[0].min(release[0]), press[0].max(release[0]));
    let (y0, y1) = (press[1].min(release[1]), press[1].max(release[1]));
    let mut found = std::collections::BTreeSet::new();
    for s in solids(scene) {
        let Some((owner, key)) = s.id.split_once('#') else {
            continue;
        };
        let (Some(set), Some(key)) = (sets.iter().position(|t| *t == owner), key_of(key)) else {
            continue;
        };
        let at = [s.model[0][3], s.model[1][3], s.model[2][3]];
        let Some([x, y, _]) = scene.camera.project(at) else {
            continue;
        };
        if (x0..=x1).contains(&x) && (y0..=y1).contains(&y) {
            found.insert((set as u32, key));
        }
    }
    let truncated = found.len() > UNITS;
    (found.into_iter().take(UNITS).collect(), truncated)
}

/// An element's key: `slot.gen` as [slot, gen], an integer as [n, 0].
fn key_of(k: &str) -> Option<[i64; 2]> {
    match k.split_once('.') {
        Some((a, b)) => Some([a.parse().ok()?, b.parse().ok()?]),
        None => Some([k.parse().ok()?, 0]),
    }
}

/// Every solid the view draws, not the shadow passes' levels alone.
fn solids(scene: &Scene) -> impl Iterator<Item = &Solid> {
    scene
        .layers
        .iter()
        .flat_map(|l| &l.solids)
        .filter(|s| !s.cast_only)
}

/// A solid's mesh as the renderer draws it, in its own space: positions, uv0 and indices. A
/// builder's mesh is its own; a primitive's is the renderer's unit mesh (1 m across, outward
/// winding, the same vertex order), in f64.
fn drawn_mesh(s: &Solid) -> (Vec<V3>, Vec<[f64; 2]>, Vec<u32>) {
    if let Some(m) = &s.mesh {
        return (m.positions.clone(), m.uv0.clone(), m.indices.clone());
    }
    let (mut p, mut uv, mut ix) = (Vec::new(), Vec::new(), Vec::new());
    const SEGMENTS: u32 = 48;
    const RINGS: u32 = 24;
    let tau = std::f64::consts::TAU;
    match s.shape {
        Shape::Box => {
            let faces: [(V3, V3, V3); 6] = [
                ([1., 0., 0.], [0., 1., 0.], [0., 0., 1.]),
                ([-1., 0., 0.], [0., 0., 1.], [0., 1., 0.]),
                ([0., 1., 0.], [0., 0., 1.], [1., 0., 0.]),
                ([0., -1., 0.], [1., 0., 0.], [0., 0., 1.]),
                ([0., 0., 1.], [1., 0., 0.], [0., 1., 0.]),
                ([0., 0., -1.], [0., 1., 0.], [1., 0., 0.]),
            ];
            for (n, a, b) in faces {
                let base = p.len() as u32;
                for (sa, sb) in [(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)] {
                    p.push(std::array::from_fn(|k| n[k] * 0.5 + a[k] * sa + b[k] * sb));
                    uv.push([sa + 0.5, 0.5 - sb]);
                }
                ix.extend([base, base + 1, base + 2, base, base + 2, base + 3]);
            }
        }
        Shape::Cylinder => {
            let around = |k: u32| {
                let a = tau * f64::from(k) / f64::from(SEGMENTS);
                (cos(a), sin(a))
            };
            for k in 0..=SEGMENTS {
                let ((c, s), u) = (around(k), f64::from(k) / f64::from(SEGMENTS));
                p.extend([[0.5 * c, -0.5, 0.5 * s], [0.5 * c, 0.5, 0.5 * s]]);
                uv.extend([[u, 1.0], [u, 0.0]]);
            }
            for k in 0..SEGMENTS {
                let a = 2 * k;
                ix.extend([a, a + 1, a + 2, a + 1, a + 3, a + 2]);
            }
            for (y, ny) in [(0.5, 1.0), (-0.5, -1.0)] {
                let centre = p.len() as u32;
                p.push([0.0, y, 0.0]);
                uv.push([0.5, 0.5]);
                for k in 0..=SEGMENTS {
                    let (c, s) = around(k);
                    p.push([0.5 * c, y, 0.5 * s]);
                    uv.push([0.5 + 0.5 * c, 0.5 + 0.5 * s * ny]);
                }
                for k in 0..SEGMENTS {
                    if ny > 0.0 {
                        ix.extend([centre, centre + 2 + k, centre + 1 + k]);
                    } else {
                        ix.extend([centre, centre + 1 + k, centre + 2 + k]);
                    }
                }
            }
        }
        Shape::Sphere => {
            for r in 0..=RINGS {
                let phi = std::f64::consts::PI * f64::from(r) / f64::from(RINGS);
                for k in 0..=SEGMENTS {
                    let th = tau * f64::from(k) / f64::from(SEGMENTS);
                    p.push([
                        0.5 * sin(phi) * cos(th),
                        0.5 * cos(phi),
                        0.5 * sin(phi) * sin(th),
                    ]);
                    uv.push([
                        f64::from(k) / f64::from(SEGMENTS),
                        f64::from(r) / f64::from(RINGS),
                    ]);
                }
            }
            let row = SEGMENTS + 1;
            for r in 0..RINGS {
                for k in 0..SEGMENTS {
                    let a = r * row + k;
                    ix.extend([a, a + 1, a + row, a + 1, a + row + 1, a + row]);
                }
            }
        }
        Shape::Built(_) => {}
    }
    (p, uv, ix)
}

/// How far along `r` it meets triangle `t`, either face, ahead of its origin, with the
/// barycentric weights of `t[1]` and `t[2]` there (Möller–Trumbore).
fn meet(r: &Ray, t: [V3; 3]) -> Option<(f64, f64, f64)> {
    let (e1, e2) = (sub(t[1], t[0]), sub(t[2], t[0]));
    let p = cross(r.dir, e2);
    let det = dot(e1, p);
    if det == 0.0 {
        return None;
    }
    let s = sub(r.origin, t[0]);
    let u = dot(s, p) / det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = cross(s, e1);
    let v = dot(r.dir, q) / det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let k = dot(e2, q) / det;
    (k > 0.0).then_some((k, u, v))
}

fn apply(m: &[[f64; 4]; 3], q: V3) -> V3 {
    std::array::from_fn(|r| m[r][0] * q[0] + m[r][1] * q[1] + m[r][2] * q[2] + m[r][3])
}
fn along(r: &Ray, k: f64) -> V3 {
    std::array::from_fn(|i| r.origin[i] + r.dir[i] * k)
}
fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn len2(a: V3) -> f64 {
    dot(a, a)
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
    if l > 0.0 {
        a.map(|x| x / l)
    } else {
        a
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{evaluate, Labels};
    use serde_json::{json, Value};

    fn scene_of(items: Value, camera: Value, size: [u32; 2], t: i64) -> Scene {
        let mut items = items;
        items["cam"] = json!({"id": "cam", "kind": "camera@1", "order": "a0", "params": camera});
        let doc = json!({"format": 1, "size": size, "camera": "cam", "items": items});
        let look = crate::look::Look3::from_roles(
            [
                ("ink".to_string(), [0, 0, 0]),
                ("ground".to_string(), [255, 255, 255]),
            ]
            .into_iter()
            .collect(),
        );
        evaluate(&doc, t, &look, &mut Labels::new()).unwrap()
    }

    fn near(a: V3, b: V3, tol: f64) -> bool {
        (0..3).all(|k| (a[k] - b[k]).abs() <= tol)
    }

    /// Criterion 3: a camera 10 m up looking 30° below the horizon meets y = 0 at 10 ÷ tan 30°
    /// ahead of its foot through the view's centre; a ray above the horizon meets nothing, and
    /// the planted test that meets the plane behind the camera gives a point.
    #[test]
    fn the_centre_ray_meets_the_level_plane_ahead_and_none_above_the_horizon() {
        let ahead = 10.0 / deep_canvas::ops::tan(deep_canvas::ops::rad(30.0));
        let cam = json!({"projection": "perspective", "position": [0, 10, 0], "target": [0, 0, -ahead], "fov": 90});
        let s = scene_of(json!({}), cam, [640, 480], 0);
        let g = Ground::Plane(0.0);
        let centre = ground(&g, &ray(&s.camera, [320.0, 240.0]), None).unwrap();
        assert!(near(centre, [0.0, 0.0, -17.3205], 1.0 / 1024.0), "{centre:?}");
        let up = ray(&s.camera, [320.0, 0.0]);
        assert!(up.dir[1] > 0.0);
        assert_eq!(ground(&g, &up, None), None);
        assert!(ground(&g, &up, Some(PLANE_BEHIND)).is_some());
    }

    /// Criterion 5: a unit cube turned 45° about +Y, seen by an orthographic camera looking
    /// along −Z: the ray through x = 0.2, y = 0 meets its +Z face at z = 0.5071 with that face's
    /// outward normal turned, (0.7071, 0, 0.7071).
    #[test]
    fn a_ray_meets_a_turned_cube_on_its_turned_face_by_winding() {
        let items = json!({"cube": {"id": "cube", "kind": "mark.box@1", "order": "b0", "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "ink"}}},
                                    "at": {"rot": [0, 45, 0]}}});
        let cam = json!({"projection": "orthographic", "position": [0, 0, 10], "target": [0, 0, 0], "view_width": 4});
        let s = scene_of(items, cam, [400, 400], 0);
        let px = s.camera.project([0.2, 0.0, 0.0]).unwrap();
        let r = ray(&s.camera, [px[0], px[1]]);
        let hit = surface(&s, "cube", &r, None).expect("meets the cube");
        assert!(near(hit.point, [0.2, 0.0, 0.5071], 1.0 / 1024.0), "{hit:?}");
        let h = std::f64::consts::FRAC_1_SQRT_2;
        assert!(near(hit.normal, [h, 0.0, h], 1e-4), "{hit:?}");
        let beside = s.camera.project([1.5, 0.0, 0.0]).unwrap();
        assert_eq!(
            surface(&s, "cube", &ray(&s.camera, [beside[0], beside[1]]), None),
            None
        );
    }

    /// Criterion 4's uv rule on a primitive: a ray square onto a unit box's +Z face at (0.2, 0.1)
    /// meets its first triangle there (face 8 in draw order), reads uv (0.7, 0.4) by the
    /// barycentric weights, and the planted reader takes its nearest vertex's (1, 0).
    #[test]
    fn uv_is_barycentric_and_the_planted_reader_takes_a_vertex() {
        let items = json!({"cube": {"id": "cube", "kind": "mark.box@1", "order": "b0", "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "ink"}}}}});
        let cam = json!({"projection": "orthographic", "position": [0, 0, 10], "target": [0, 0, 0], "view_width": 4});
        let s = scene_of(items, cam, [400, 400], 0);
        let px = s.camera.project([0.2, 0.1, 0.0]).unwrap();
        let r = ray(&s.camera, [px[0], px[1]]);
        let hit = surface(&s, "cube", &r, None).unwrap();
        assert_eq!(hit.face, 8);
        let uv = hit.uv.unwrap();
        assert!((uv[0] - 0.7).abs() < 1e-9 && (uv[1] - 0.4).abs() < 1e-9, "{uv:?}");
        let planted = surface(&s, "cube", &r, Some(NEAREST_VERTEX_UV)).unwrap();
        assert_eq!(planted.uv, Some([1.0, 0.0]));
    }

    /// The point on a segment nearest a ray that passes beside it.
    #[test]
    fn the_nearest_point_on_a_segment_to_a_ray() {
        let r = Ray {
            origin: [0.0, 0.0, 0.0],
            dir: [0.0, 0.0, -1.0],
        };
        let (d2, p) = on_segment([-2.0, -10.0, -5.0], [-2.0, 10.0, -5.0], &r);
        assert!(near(p, [-2.0, 0.0, -5.0], 1e-12) && (d2 - 4.0).abs() < 1e-12);
    }

    /// Margin: a press 1 px from a target 50 m off and 3 px from one 5 m off names the nearer on
    /// screen, the planted pick by depth names the nearer in depth, and no margin names neither.
    #[test]
    fn the_margin_takes_the_nearest_on_screen_then_depth() {
        let items = json!({
            "far": {"id": "far", "kind": "mark.box@1", "order": "b0", "params": {"size": [0.8, 0.8, 0.8], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [1.5, -0.5, -50]}},
            "near": {"id": "near", "kind": "mark.box@1", "order": "b1", "params": {"size": [0.08, 0.08, 0.08], "paint": {"fill": {"role": "ink"}}}, "at": {"pos": [-0.25, -0.05, -5]}}
        });
        let cam = json!({"projection": "perspective", "position": [0, 0, 0], "target": [0, 0, -1], "fov": 90});
        let s = scene_of(items, cam, [100, 100], 0);
        let mut ids = vec![0u8; 100 * 100 * 4];
        let mut put = |x: usize, y: usize, v: u32| {
            ids[(y * 100 + x) * 4..][..4].copy_from_slice(&v.to_le_bytes())
        };
        put(51, 50, 1);
        put(47, 50, 2);
        let picks: BTreeMap<u32, String> = [(1, "far".into()), (2, "near".into())].into();
        let target = Ids {
            size: [100, 100],
            ids: &ids,
            picks: &picks,
        };
        let any = |_: &str| true;
        let named = topmost(&s, &target, [50.5, 50.5], 3, &any, None);
        assert_eq!(named.as_deref(), Some("far"));
        let planted = topmost(&s, &target, [50.5, 50.5], 3, &any, Some(NEAREST_DEPTH));
        assert_eq!(planted.as_deref(), Some("near"));
        assert_eq!(topmost(&s, &target, [50.5, 50.5], 0, &any, None), None);
    }
}
