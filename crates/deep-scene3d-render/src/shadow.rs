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
