//! The key light's shadow map (issue #380; canvas primitives: Light and the light policy, the
//! core's shadow pass): the solids drawn depth-only from the key light through an orthographic
//! projection fitted, in closed form from the scene alone, around every solid and where its
//! shadow falls on the ground plane. Depth runs 0 nearest the light. The effects module's shadow
//! filter reads it.

use deep_canvas_scene3d::light::{Light, LightKind};
use deep_canvas_scene3d::scene::{Scene, Solid};

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
    /// Its depth range along the light in m, which turns a depth difference into a penumbra.
    pub depth: f64,
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
    // A culled element is the GPU's to test (#484).
    corners_of(scene, |s| s.cast_shadow && s.batch == 0)
}

/// Every caster's corners, culled elements too: a local map has no cull of its own (#446).
pub fn local_caster_corners(scene: &Scene) -> Vec<(String, [[f64; 3]; 8])> {
    corners_of(scene, |s| s.cast_shadow)
}

fn corners_of(scene: &Scene, casts: impl Fn(&Solid) -> bool) -> Vec<(String, [[f64; 3]; 8])> {
    let mut out = Vec::new();
    for s in scene.layers.iter().flat_map(|l| &l.solids) {
        if !casts(s) {
            continue;
        }
        let [lo, hi] = s.mesh.as_ref().map_or([[-0.5; 3], [0.5; 3]], |m| {
            let b = m.reach();
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
    let tx =
        (camera.size[0] * 0.5 + (camera.centre[0] - camera.size[0] * 0.5).abs()) / camera.scale;
    let ty =
        (camera.size[1] * 0.5 + (camera.centre[1] - camera.size[1] * 0.5).abs()) / camera.scale;
    tx * tx + ty * ty
}

/// The auto far end: the farthest any caster's corner lies ahead of the eye, at least a meter
/// past the near plane.
pub fn auto_far(scene: &Scene, casters: &[(String, [[f64; 3]; 8])]) -> f64 {
    let c = &scene.camera;
    let mut far = c.near + 1.0;
    for (_, corners) in casters {
        for p in corners {
            let d = dot(
                [p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]],
                c.forward,
            );
            far = far.max(d);
        }
    }
    far
}

/// The auto far end on a grid of an eighth of a stop, so a camera that moves a little keeps its
/// splits, and with them its cascades' sizes and maps.
fn stepped(far: f64) -> f64 {
    ((far.log2() * 8.0).ceil() / 8.0).exp2()
}

/// How far a soft shadow reaches past what casts it, for a cascade's expansion (Light policy:
/// cascades): tan of the light's angle × the depth range, at most `most` texels of a map whose
/// texel over the sphere is `2 × radius ÷ size`.
fn reach(soft: Option<Reach>, radius: f64, range: f64, size: u32) -> f64 {
    soft.map_or(0.0, |s| {
        let texel = 2.0 * radius / f64::from(size);
        (s.angle.to_radians().tan() * range).min(s.max_penumbra * texel)
    })
}

/// What a soft shadow's expansion reads: the light's angle in degrees and the most a penumbra
/// spreads, in texels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reach {
    pub angle: f64,
    pub max_penumbra: f64,
}

/// The cascades of a perspective view for a sun shining from `toward`, each fitted with a
/// bounding sphere around its slice of the view, grown by a soft shadow's reach, its center
/// snapped to whole texels of a `size` map in the light's frame, and its depth range spanning
/// every caster.
pub fn cascades(
    scene: &Scene,
    toward: [f64; 3],
    settings: &CascadeSettings,
    size: u32,
    soft: Option<Reach>,
    snap: bool,
) -> Vec<Cascade> {
    let casters = caster_corners(scene);
    let cam = &scene.camera;
    // Soft shadows hold still under a small move: an auto far end on its grid, and depth snapped.
    // Without a policy a cascade is fitted as it was, so no such document's picture moves.
    let held = soft.is_some();
    let far = settings.far.unwrap_or_else(|| {
        let far = auto_far(scene, &casters);
        if held {
            stepped(far)
        } else {
            far
        }
    });
    let near = cam.near.max(1e-3);
    let count = settings.count.clamp(1, 4);
    let d = splits(
        near,
        far.max(near * 1.001),
        count,
        settings.split.clamp(0.0, 1.0),
    );
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
            let span = if casters.is_empty() {
                2.0 * r
            } else {
                zhi - zlo
            };
            let r = r + reach(soft, r, span, size);
            let center = [
                cam.eye[0] + cam.forward[0] * zc,
                cam.eye[1] + cam.forward[1] * zc,
                cam.eye[2] + cam.forward[2] * zc,
            ];
            // Snapped to whole texels across the light, so a move inside a texel keeps the map.
            let texel = 2.0 * r / f64::from(size);
            let grid = |v: f64| if snap { (v / texel).floor() * texel } else { v };
            let (sx, sy) = (grid(dot(center, x)), grid(dot(center, y)));
            // Along the light too, so a move inside a texel leaves its depth range as it was.
            let c = dot(center, z);
            let (c, edge) = if held { (grid(c), texel) } else { (c, 0.0) };
            let (lo_z, hi_z) = if casters.is_empty() {
                (c - r - edge, c + r + edge)
            } else {
                (zlo.min(c - r - edge), zhi.max(c + r + edge))
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
                depth: hi_z - lo_z,
            }
        })
        .collect()
}

/// One cube face in the light's frame: its right, its up and the way it looks. A pixel's face and
/// its coordinates in it are scene3d.wgsl's `cube_tap`.
pub const FACES: [[[f64; 3]; 3]; 6] = [
    [[0.0, 0.0, -1.0], [0.0, 1.0, 0.0], [1.0, 0.0, 0.0]],
    [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]],
    [[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]],
    [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]],
    [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
    [[-1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, -1.0]],
];

/// The cube of the widest spot a single map holds: a spot past it shadows only inside it.
const WIDEST_SPOT: f64 = 85.0;
/// A local map's near plane, so a shade a hand's width from its bulb still casts.
const LOCAL_NEAR: f64 = 0.01;

/// What a shadowed local light draws: its frame's axes, and the clip matrix of each face it draws
/// by its layer's offset (a spot's one, a point's six, an area's five in front of it).
#[derive(Clone, Debug, PartialEq)]
pub struct LocalMap {
    pub cube: bool,
    /// The frame's x, y and z in the world (a point's are the world's).
    pub axes: [[f64; 3]; 3],
    pub near: f64,
    pub far: f64,
    /// `(layer offset, clip)`, column-major, depth 0 nearest the light.
    pub faces: Vec<(u32, [f64; 16])>,
    /// A spot's tan of half its map's field, which sizes its texels; 1 for a cube.
    pub tan: f64,
}

/// A perspective matrix at `pos` looking along `f`, with `r` and `u` across it, `tan` of its half
/// field, depth 0 at `near` and 1 at `far`.
fn perspective(
    pos: [f64; 3],
    [r, u, f]: [[f64; 3]; 3],
    tan: f64,
    near: f64,
    far: f64,
) -> [f64; 16] {
    let a = far / (far - near);
    let b = -near * a;
    let k = 1.0 / tan;
    let rows = [
        [k * r[0], k * r[1], k * r[2], -k * dot(r, pos)],
        [k * u[0], k * u[1], k * u[2], -k * dot(u, pos)],
        [a * f[0], a * f[1], a * f[2], b - a * dot(f, pos)],
        [f[0], f[1], f[2], -dot(f, pos)],
    ];
    let mut m = [0.0; 16];
    for (row, vals) in rows.iter().enumerate() {
        for (col, v) in vals.iter().enumerate() {
            m[col * 4 + row] = *v;
        }
    }
    m
}

/// The map a shadowed local `light` draws.
pub fn local_map(l: &Light) -> LocalMap {
    let (near, far) = (LOCAL_NEAR, l.range.max(LOCAL_NEAR * 2.0));
    let world = |axes: [[f64; 3]; 3], v: [f64; 3]| {
        std::array::from_fn(|k| axes[0][k] * v[0] + axes[1][k] * v[1] + axes[2][k] * v[2])
    };
    match l.kind {
        LightKind::Spot => {
            let f = normalize(l.dir);
            let helper = if f[1].abs() > 0.99 {
                [1.0, 0.0, 0.0]
            } else {
                [0.0, 1.0, 0.0]
            };
            let r = normalize(cross(f, helper));
            let u = cross(r, f);
            let tan = l.cone[0]
                .acos()
                .to_degrees()
                .min(WIDEST_SPOT)
                .to_radians()
                .tan();
            let clip = perspective(l.pos, [r, u, f], tan, near, far);
            LocalMap {
                cube: false,
                axes: [r, u, f],
                near,
                far,
                faces: vec![(0, clip)],
                tan,
            }
        }
        _ => {
            // An area's cube turns with its face: its back face looks away from what it lights.
            let axes = if l.kind == LightKind::Area {
                let [x, y] = l.axes;
                [x, y, cross(x, y)]
            } else {
                [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
            };
            let faces = (0..6u32)
                .filter(|&f| l.kind != LightKind::Area || f != 4)
                .map(|i| {
                    let [r, u, f] = FACES[i as usize].map(|v| world(axes, v));
                    (i, perspective(l.pos, [r, u, f], 1.0, near, far))
                })
                .collect();
            LocalMap {
                cube: true,
                axes,
                near,
                far,
                faces,
                tan: 1.0,
            }
        }
    }
}

/// Whether a caster's corners meet the sphere around `pos`, by their box.
pub fn meets(corners: &[[f64; 3]; 8], pos: [f64; 3], range: f64) -> bool {
    let mut d2 = 0.0;
    for k in 0..3 {
        let lo = corners.iter().map(|c| c[k]).fold(f64::MAX, f64::min);
        let hi = corners.iter().map(|c| c[k]).fold(f64::MIN, f64::max);
        let e = (lo - pos[k]).max(pos[k] - hi).max(0.0);
        d2 += e * e;
    }
    d2 <= range * range
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
