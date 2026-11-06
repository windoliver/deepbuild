//! The key light's shadow map (issue #380; canvas primitives: Light and the light policy, the
//! core's shadow pass): the solids drawn depth-only from the key light through an orthographic
//! projection fitted, in closed form from the scene alone, around every solid and where its
//! shadow falls on the ground plane. Depth runs 0 nearest the light. The effects module's shadow
//! filter reads it.

use deep_canvas_scene3d::scene::Scene;

/// The shadow map's side, in texels.
pub const SIZE: u32 = 2048;
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn normalize(a: [f64; 3]) -> [f64; 3] {
    let n = dot(a, a).sqrt();
    [a[0] / n, a[1] / n, a[2] / n]
}

/// The light's world-to-clip matrix, column-major, for a light shining from `toward` (the unit
/// direction to the light) over `scene`'s solids, their shadows landing on the plane
/// y = `ground`; `None` when the scene has no solid.
pub fn light_clip(scene: &Scene, toward: [f64; 3], ground: f64) -> Option<[f64; 16]> {
    let l = normalize(toward);
    let mut points = Vec::new();
    for layer in &scene.layers {
        for s in &layer.solids {
            let m = s.model;
            for corner in 0..8 {
                let c = [
                    if corner & 1 == 0 { -0.5 } else { 0.5 },
                    if corner & 2 == 0 { -0.5 } else { 0.5 },
                    if corner & 4 == 0 { -0.5 } else { 0.5 },
                ];
                let p = [
                    m[0][0] * c[0] + m[0][1] * c[1] + m[0][2] * c[2] + m[0][3],
                    m[1][0] * c[0] + m[1][1] * c[1] + m[1][2] * c[2] + m[1][3],
                    m[2][0] * c[0] + m[2][1] * c[1] + m[2][2] * c[2] + m[2][3],
                ];
                points.push(p);
                // Where that corner's shadow lands on the ground.
                if l[1] > 1e-6 && p[1] > ground {
                    let k = (p[1] - ground) / l[1];
                    points.push([p[0] - l[0] * k, ground, p[2] - l[2] * k]);
                }
            }
        }
    }
    if points.is_empty() {
        return None;
    }
    // The light's frame: z away from the light, x and y across it.
    let z = [-l[0], -l[1], -l[2]];
    let helper = if l[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = normalize(cross(helper, z));
    let y = cross(z, x);
    let (mut lo, mut hi) = ([f64::MAX; 3], [f64::MIN; 3]);
    for p in &points {
        let q = [dot(*p, x), dot(*p, y), dot(*p, z)];
        for i in 0..3 {
            lo[i] = lo[i].min(q[i]);
            hi[i] = hi[i].max(q[i]);
        }
    }
    // A margin for the filter's reach, and depth room in front of the nearest caster.
    let pad = 0.05 * (hi[0] - lo[0]).max(hi[1] - lo[1]).max(0.1);
    for i in 0..2 {
        lo[i] -= pad;
        hi[i] += pad;
    }
    lo[2] -= pad;
    hi[2] += pad;
    let sx = 2.0 / (hi[0] - lo[0]);
    let sy = 2.0 / (hi[1] - lo[1]);
    let sz = 1.0 / (hi[2] - lo[2]);
    let cx = -(hi[0] + lo[0]) / (hi[0] - lo[0]);
    let cy = -(hi[1] + lo[1]) / (hi[1] - lo[1]);
    let cz = -lo[2] * sz;
    // Rows: clip x = sx·(p·x) + cx, clip y = sy·(p·y) + cy, depth = sz·(p·z) + cz, w = 1.
    let rows = [
        [sx * x[0], sx * x[1], sx * x[2], cx],
        [sy * y[0], sy * y[1], sy * y[2], cy],
        [sz * z[0], sz * z[1], sz * z[2], cz],
        [0.0, 0.0, 0.0, 1.0],
    ];
    let mut m = [0.0; 16];
    for (r, row) in rows.iter().enumerate() {
        for (c, v) in row.iter().enumerate() {
            m[c * 4 + r] = *v;
        }
    }
    Some(m)
}

pub use deep_canvas_scene3d::scene::Cascades as CascadeSettings;

/// One cascade: the view distances it covers, its bounding sphere, and its light's clip matrix
/// after texel snapping (column-major, depth 0 nearest the light).
#[derive(Clone, Debug, PartialEq)]
pub struct Cascade {
    pub near: f64,
    pub far: f64,
    pub center: [f64; 3],
    pub radius: f64,
    pub clip: [f64; 16],
}

/// The split distances in closed form (the practical split scheme): `count + 1` distances from
/// `near` to `far`, each the mix by `lambda` of the logarithmic split near·(far ÷ near)^(i ÷ n)
/// and the uniform one near + (far − near)·i ÷ n.
pub fn splits(near: f64, far: f64, count: u32, lambda: f64) -> Vec<f64> {
    let n = f64::from(count);
    (0..=count)
        .map(|i| {
            let k = f64::from(i) / n;
            if i == 0 {
                near
            } else if i == count {
                far
            } else {
                lambda * near * (far / near).powf(k) + (1.0 - lambda) * (near + (far - near) * k)
            }
        })
        .collect()
}

/// The light's frame: x and y across it, z away from it.
fn light_frame(toward: [f64; 3]) -> [[f64; 3]; 3] {
    let l = normalize(toward);
    let z = [-l[0], -l[1], -l[2]];
    let helper = if l[1].abs() > 0.99 {
        [1.0, 0.0, 0.0]
    } else {
        [0.0, 1.0, 0.0]
    };
    let x = normalize(cross(helper, z));
    let y = cross(z, x);
    [x, y, z]
}

/// Every solid's world corners, from its mesh's bounds or the unit cube.
pub fn caster_corners(scene: &Scene) -> Vec<(String, [[f64; 3]; 8])> {
    let mut out = Vec::new();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        // A culled element is the GPU's to test (#484).
        if !s.cast_shadow || s.batch != 0 {
            continue;
        }
        let [lo, hi] = s.mesh.as_ref().map_or([[-0.5; 3], [0.5; 3]], |m| {
            let b = m.bounds();
            [b[0].map(f64::from), b[1].map(f64::from)]
        });
        let m = s.model;
        let mut corners = [[0.0; 3]; 8];
        for (k, c) in corners.iter_mut().enumerate() {
            let p = [
                if k & 1 == 0 { lo[0] } else { hi[0] },
                if k & 2 == 0 { lo[1] } else { hi[1] },
                if k & 4 == 0 { lo[2] } else { hi[2] },
            ];
            for r in 0..3 {
                c[r] = m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3];
            }
        }
        out.push((s.id.clone(), corners));
    }
    out
}

/// The tangents of the camera's half angles across and down, squared and summed: the frustum's
/// spread k² at unit distance.
fn spread(camera: &deep_canvas_scene3d::scene::Camera) -> f64 {
    let tx = (camera.size[0] * 0.5 + (camera.centre[0] - camera.size[0] * 0.5).abs()) / camera.scale;
    let ty = (camera.size[1] * 0.5 + (camera.centre[1] - camera.size[1] * 0.5).abs()) / camera.scale;
    tx * tx + ty * ty
}

/// The auto far end: the farthest any caster's corner lies ahead of the eye, at least a meter
/// past the near plane.
pub fn auto_far(scene: &Scene, casters: &[(String, [[f64; 3]; 8])]) -> f64 {
    let c = &scene.camera;
    let mut far = c.near + 1.0;
    for (_, corners) in casters {
        for p in corners {
            let d = dot([p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]], c.forward);
            far = far.max(d);
        }
    }
    far
}

/// The cascades of a perspective view for a sun shining from `toward`, each fitted with a
/// bounding sphere around its slice of the view, its center snapped to whole texels of a `size`
/// map in the light's frame, and its depth range spanning every caster.
pub fn cascades(
    scene: &Scene,
    toward: [f64; 3],
    settings: &CascadeSettings,
    size: u32,
) -> Vec<Cascade> {
    let casters = caster_corners(scene);
    let cam = &scene.camera;
    let far = settings.far.unwrap_or_else(|| auto_far(scene, &casters));
    let near = cam.near.max(1e-3);
    let count = settings.count.clamp(1, 4);
    let d = splits(near, far.max(near * 1.001), count, settings.split.clamp(0.0, 1.0));
    let k2 = spread(cam);
    let [x, y, z] = light_frame(toward);
    // Every caster's depth range along the light.
    let (mut zlo, mut zhi) = (f64::MAX, f64::MIN);
    for (_, corners) in &casters {
        for p in corners {
            let q = dot(*p, z);
            zlo = zlo.min(q);
            zhi = zhi.max(q);
        }
    }
    (0..count as usize)
        .map(|i| {
            let (n, f) = (d[i], d[i + 1]);
            // The slice's bounding sphere, on the view axis: through the near and far rims, or
            // centered on the far rim when that already holds the near one.
            let zc = (0.5 * (f + n) * (1.0 + k2)).min(f);
            let r = ((f - zc) * (f - zc) + f * f * k2).sqrt();
            let center = [
                cam.eye[0] + cam.forward[0] * zc,
                cam.eye[1] + cam.forward[1] * zc,
                cam.eye[2] + cam.forward[2] * zc,
            ];
            // Snapped to whole texels across the light, so a move inside a texel keeps the map.
            let texel = 2.0 * r / f64::from(size);
            let sx = (dot(center, x) / texel).floor() * texel;
            let sy = (dot(center, y) / texel).floor() * texel;
            let (lo_z, hi_z) = if casters.is_empty() {
                let c = dot(center, z);
                (c - r, c + r)
            } else {
                (zlo.min(dot(center, z) - r), zhi.max(dot(center, z) + r))
            };
            let pad = 0.01 * (hi_z - lo_z).max(0.1);
            let (lo_z, hi_z) = (lo_z - pad, hi_z + pad);
            let (s, sz) = (1.0 / r, 1.0 / (hi_z - lo_z));
            let rows = [
                [s * x[0], s * x[1], s * x[2], -sx * s],
                [s * y[0], s * y[1], s * y[2], -sy * s],
                [sz * z[0], sz * z[1], sz * z[2], -lo_z * sz],
                [0.0, 0.0, 0.0, 1.0],
            ];
            let mut clip = [0.0; 16];
            for (row, vals) in rows.iter().enumerate() {
                for (col, v) in vals.iter().enumerate() {
                    clip[col * 4 + row] = *v;
                }
            }
            Cascade {
                near: n,
                far: f,
                center,
                radius: r,
                clip,
            }
        })
        .collect()
}

/// Whether a caster's corners touch a cascade's box (its clip space's x and y in −1..1).
pub fn inside(clip: &[f64; 16], corners: &[[f64; 3]; 8]) -> bool {
    let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
    for p in corners {
        for a in 0..2 {
            let v = clip[a] * p[0] + clip[4 + a] * p[1] + clip[8 + a] * p[2] + clip[12 + a];
            lo[a] = lo[a].min(v);
            hi[a] = hi[a].max(v);
        }
    }
    (0..2).all(|a| hi[a] >= -1.0 && lo[a] <= 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_are_the_closed_form() {
        assert_eq!(splits(1.0, 100.0, 1, 0.5), vec![1.0, 100.0]);
        let u = splits(1.0, 101.0, 4, 0.0);
        assert_eq!(u, vec![1.0, 26.0, 51.0, 76.0, 101.0]);
        let l = splits(1.0, 10_000.0, 4, 1.0);
        for (a, b) in l.iter().zip([1.0, 10.0, 100.0, 1000.0, 10_000.0]) {
            assert!((a - b).abs() < 1e-9 * b, "{a} {b}");
        }
        let h = splits(0.5, 200.0, 3, 0.5);
        let want = 0.5 * 0.5 * 400f64.powf(1.0 / 3.0) + 0.5 * (0.5 + 199.5 / 3.0);
        assert!((h[1] - want).abs() < 1e-12);
    }
}
