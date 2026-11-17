//! Issue #1381: far ground light (canvas primitives: Builder plate: terrain, `horizon`). One bake
//! per plate content key: for each of 16 azimuths, the elevation of the highest ground a texel
//! sees, traced in f64 through a pyramid over the plate's samples ([`deep_canvas::horizon`]), at
//! about 1/16 of their
//! resolution (257² for 4,097² samples), a byte an azimuth, 16 B a texel. The key sun's
//! visibility is a smoothstep of its elevation less the interpolated horizon across its ±0.27°,
//! and the sky occlusion is 1 − mean(sin² h) over the azimuths, so moving the sun reads the same
//! table and recomputes nothing.

use deep_canvas::ops::{atan, rad, sin, tan, PI, TAU};

/// Azimuths a texel holds, counter-clockwise from +X toward +Z in the plate's own space.
pub const AZIMUTHS: usize = 16;
/// Samples a texel spans by default: 4,097 samples a side bake 257 texels.
pub const STEP: usize = 16;
/// The most texels a side.
pub const MAX_SIZE: usize = 257;
/// Half the sun's disc, in degrees: the visibility ramps across ±0.27° of horizon.
pub const SUN_HALF_DEG: f64 = 0.27;
/// The angle code's slope: a byte spends more of its codes low, where a sunset's shadows end
/// (0.06° a code at 5°, 0.8° at 30°).
const K: f64 = 8.0;

/// A plate's horizon table: `cols` × `rows` texels row by row over the plate, texel (i, j) at
/// the plate's sample place (i (cols − 1) ÷ (texels − 1), j (rows − 1) ÷ (texels − 1)), each 16
/// bytes, azimuth k's angle code in byte k (byte k % 4 of word k ÷ 4, little end first).
#[derive(Clone, Debug, PartialEq)]
pub struct Horizon {
    /// Its content key: a hash of its texels.
    pub key: u64,
    /// The plate's size in its own m, which places a point on the table.
    pub size: [f64; 2],
    pub cols: u32,
    pub rows: u32,
    pub texels: Vec<[u32; 4]>,
}

/// The byte an elevation angle `h` (rad) is kept as: below the plate's own level, 0.
pub fn code(h: f64) -> u8 {
    let top = atan(K * PI / 2.0);
    let a = atan(K * h.clamp(0.0, PI / 2.0)) / top;
    (a * 255.0).round().clamp(0.0, 255.0) as u8
}

/// The elevation angle (rad) byte `c` keeps.
pub fn angle(c: u8) -> f64 {
    tan(c as f64 / 255.0 * atan(K * PI / 2.0)) / K
}

/// The key sun's visibility from a horizon `h` (rad) at its elevation `sun` (rad): a smoothstep
/// across the sun's ±0.27°.
pub fn visibility(sun: f64, h: f64) -> f64 {
    let half = rad(SUN_HALF_DEG);
    let x = ((sun - h + half) / (2.0 * half)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// The sky occlusion of horizons `hs` (rad): 1 − mean(sin² h).
pub fn occlusion(hs: &[f64]) -> f64 {
    let s: f64 = hs
        .iter()
        .map(|h| {
            let s = sin(h.max(0.0));
            s * s
        })
        .sum();
    1.0 - s / hs.len().max(1) as f64
}

/// A plate's `horizon` (Builder plate: terrain): none without one, else its texels a side; its
/// azimuths are 16 and its size 2 to 257, or it is refused at `params/horizon`.
pub fn asked(params: &serde_json::Value) -> Result<Option<usize>, String> {
    let Some(h) = params.get("horizon").filter(|h| !h.is_null()) else {
        return Ok(None);
    };
    let bad = || "params/horizon".to_string();
    let o = h.as_object().ok_or_else(bad)?;
    if o.keys().any(|k| k != "azimuths" && k != "size")
        || o.get("azimuths").is_some_and(|a| a.as_u64() != Some(AZIMUTHS as u64))
    {
        return Err(bad());
    }
    match o.get("size") {
        None => Ok(Some(MAX_SIZE)),
        Some(v) => v
            .as_u64()
            .filter(|n| (2..=MAX_SIZE as u64).contains(n))
            .map(|n| Some(n as usize))
            .ok_or_else(bad),
    }
}

/// The horizon table of a plate `size` m across with `cols` × `rows` samples `h` (row by row),
/// `tc` × `tr` texels: each texel's 16 angles traced by [`deep_canvas::horizon::angles`], kept
/// as bytes.
pub fn bake(size: [f64; 2], cols: usize, rows: usize, h: &[f64], [tc, tr]: [usize; 2]) -> Horizon {
    let angles = deep_canvas::horizon::angles(size, cols, rows, h, [tc, tr], AZIMUTHS);
    let texels: Vec<[u32; 4]> = angles
        .chunks(AZIMUTHS)
        .map(|hs| {
            let mut words = [0u32; 4];
            for (k, a) in hs.iter().enumerate() {
                words[k / 4] |= (code(*a) as u32) << (8 * (k % 4));
            }
            words
        })
        .collect();
    let mut hasher = deep_canvas::schedule::Hasher::new("scene3d.terrain.horizon");
    for n in [tc, tr] {
        hasher.int(n as i64);
    }
    for w in &texels {
        for x in w {
            hasher.bytes(&x.to_le_bytes());
        }
    }
    let key = hasher.finish().0;
    Horizon {
        key: u64::from_le_bytes(key[..8].try_into().expect("8 bytes")),
        size,
        cols: tc as u32,
        rows: tr as u32,
        texels,
    }
}

/// A terrain plate's table, `texels` a side (257 over 4,097 samples: 1/16 of their resolution).
pub fn of_terrain(t: &crate::terrain::Terrain, texels: usize) -> Horizon {
    bake(t.size, t.cols, t.rows, &t.h, [texels, texels])
}

impl Horizon {
    /// Azimuth k's code at texel (i, j).
    pub fn code_at(&self, i: usize, j: usize, k: usize) -> u8 {
        let w = self.texels[j * self.cols as usize + i][k / 4];
        ((w >> (8 * (k % 4))) & 0xff) as u8
    }

    /// Azimuth k's angle (rad) at texel (i, j).
    pub fn at(&self, i: usize, j: usize, k: usize) -> f64 {
        angle(self.code_at(i, j, k))
    }

    /// The 16 horizon angles (rad) at place (fx, fz) of the plate, each a fraction 0 to 1 of its
    /// size along +X and +Z: the four texels' codes around it mixed, then read as angles, as
    /// the plate's pixels read them.
    pub fn angles(&self, fx: f64, fz: f64) -> [f64; AZIMUTHS] {
        let (w, d) = (self.cols as usize, self.rows as usize);
        let gx = fx.clamp(0.0, 1.0) * (w - 1) as f64;
        let gz = fz.clamp(0.0, 1.0) * (d - 1) as f64;
        let (i, j) = ((gx as usize).min(w - 2), (gz as usize).min(d - 2));
        let (a, b) = (gx - i as f64, gz - j as f64);
        let c = |i: usize, j: usize, k: usize| self.code_at(i, j, k) as f64;
        std::array::from_fn(|k| {
            let top = c(i, j, k) * (1.0 - a) + c(i + 1, j, k) * a;
            let low = c(i, j + 1, k) * (1.0 - a) + c(i + 1, j + 1, k) * a;
            tan((top * (1.0 - b) + low * b) / 255.0 * atan(K * PI / 2.0)) / K
        })
    }

    /// The horizon (rad) toward azimuth `az` (rad, from +X toward +Z) at place (fx, fz): the
    /// two azimuths around it, mixed.
    pub fn toward(&self, fx: f64, fz: f64, az: f64) -> f64 {
        let hs = self.angles(fx, fz);
        let x = (az / TAU).rem_euclid(1.0) * AZIMUTHS as f64;
        let k = (x as usize).min(AZIMUTHS - 1);
        let f = x - k as f64;
        hs[k] * (1.0 - f) + hs[(k + 1) % AZIMUTHS] * f
    }
}

/// The key sun's visibility and the sky's occlusion a plate's pixels read at world point `p`
/// on the plate placed by `model` (turning and scaling alike on every axis), with the sun
/// toward `toward` (world, unit): as scene3d.wgsl's `horizon_at` reads them.
pub fn reading(h: &Horizon, model: &crate::scene::Affine3, p: [f64; 3], toward: [f64; 3]) -> [f64; 2] {
    // The model's inverse: its rotation's transpose over its scale.
    let col = |k: usize| [model[0][k], model[1][k], model[2][k]];
    let len = |v: [f64; 3]| deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    let s = len(col(0)).max(1e-300);
    let unit = |k: usize| col(k).map(|x| x / s);
    let d = [p[0] - model[0][3], p[1] - model[1][3], p[2] - model[2][3]];
    let local = |v: [f64; 3], k: usize| {
        let u = unit(k);
        v[0] * u[0] + v[1] * u[1] + v[2] * u[2]
    };
    let (lx, lz) = (local(d, 0) / s, local(d, 2) / s);
    let (fx, fz) = (lx / h.size[0] + 0.5, lz / h.size[1] + 0.5);
    let sun = [local(toward, 0), local(toward, 1), local(toward, 2)];
    let elevation = deep_canvas::ops::asin((sun[1] / len(sun).max(1e-300)).clamp(-1.0, 1.0));
    let az = deep_canvas::ops::atan2(sun[2], sun[0]);
    let lit = visibility(elevation, h.toward(fx, fz, az));
    [lit, occlusion(&h.angles(fx, fz))]
}

/// #1381's planted occlusion's normal: the plate's full-detail normal at world point `p` of the
/// plate `h` was baked for, mixed across its sample cell's triangle as scene3d.wgsl's
/// `terrain_normal` mixes it, turned by `model`'s rotation; none without full-detail normals.
pub fn full_normal(
    h: &Horizon,
    mesh: &crate::geom::Mesh,
    model: &crate::scene::Affine3,
    p: [f64; 3],
) -> Option<[f64; 3]> {
    let n = mesh.terrain.as_deref()?;
    let (cols, rows) = (n.cols as usize, n.rows as usize);
    let col = |k: usize| [model[0][k], model[1][k], model[2][k]];
    let len = |v: [f64; 3]| deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    let s = len(col(0)).max(1e-300);
    let d = [p[0] - model[0][3], p[1] - model[1][3], p[2] - model[2][3]];
    let local = |k: usize| (d[0] * col(k)[0] + d[1] * col(k)[1] + d[2] * col(k)[2]) / (s * s);
    let gx = ((local(0) / h.size[0] + 0.5) * (cols - 1) as f64).clamp(0.0, (cols - 1) as f64);
    let gz = ((local(2) / h.size[1] + 0.5) * (rows - 1) as f64).clamp(0.0, (rows - 1) as f64);
    let (c, r) = ((gx as usize).min(cols - 2), (gz as usize).min(rows - 2));
    let (fx, fz) = (gx - c as f64, gz - r as f64);
    let at = |c: usize, r: usize| {
        let [x, z] = n.xz[r * cols + c].map(f64::from);
        [x, deep_canvas::ops::sqrt((1.0 - x * x - z * z).max(0.0)), z]
    };
    let mix = |a: [f64; 3], b: [f64; 3], t: f64| [0, 1, 2].map(|k| a[k] + t * (b[k] - a[k]));
    let (n00, n10, n01, n11) = (at(c, r), at(c + 1, r), at(c, r + 1), at(c + 1, r + 1));
    let v = if fx + fz <= 1.0 {
        let a = mix(n00, n10, fx);
        [0, 1, 2].map(|k| a[k] + fz * (n01[k] - n00[k]))
    } else {
        let a = mix(n11, n01, 1.0 - fx);
        [0, 1, 2].map(|k| a[k] + (1.0 - fz) * (n10[k] - n11[k]))
    };
    let w = [0, 1, 2].map(|k| (col(0)[k] * v[0] + col(1)[k] * v[1] + col(2)[k] * v[2]) / s);
    let l = len(w).max(1e-300);
    Some(w.map(|x| x / l))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A plate `n` samples a side, `spacing` m apart, heights from `f` at (x, z) in m from its
    /// −X, −Z corner.
    fn plate(n: usize, spacing: f64, f: impl Fn(f64, f64) -> f64) -> (Vec<f64>, [f64; 2]) {
        let h = (0..n)
            .flat_map(|r| (0..n).map(move |c| (c, r)))
            .map(|(c, r)| f(c as f64 * spacing, r as f64 * spacing))
            .collect();
        (h, [(n - 1) as f64 * spacing; 2])
    }

    #[test]
    fn codes_keep_low_angles_fine() {
        // Half a code's step: 0.031° at 5°, 0.062° at 10°, 0.39° at 30°.
        for (deg, within) in [(0.5, 0.032), (1.0, 0.032), (5.0, 0.032), (10.0, 0.065), (30.0, 0.4)] {
            let h = rad(deg);
            assert!((angle(code(h)) - h).abs() < rad(within), "{deg}°");
        }
        assert_eq!(code(-0.3), 0);
        assert!((angle(255) - PI / 2.0).abs() < 1e-12);
    }

    #[test]
    fn a_ridge_shadows_its_valley_to_the_closed_form() {
        // A 100 m wall along X at z = 256 m on a flat floor: from z, the horizon toward +Z is
        // atan(100 ÷ (256 − z)).
        let (h, size) = plate(513, 1.0, |_, z| if z >= 256.0 { 100.0 } else { 0.0 });
        let t = bake(size, 513, 513, &h, [33, 33]);
        // +Z is azimuth 4 (a quarter turn from +X); the trace is exact, so each texel keeps the
        // code of the closed form.
        for j in [0usize, 4, 8, 12] {
            let z = j as f64 * 16.0;
            let want = atan(100.0 / (256.0 - z));
            assert_eq!(t.code_at(16, j, 4), code(want), "texel {j}");
            assert_eq!(t.at(16, j, 12), 0.0, "away from the wall");
        }
    }

    #[test]
    fn a_crater_floor_reads_its_rim() {
        // A flat floor of radius 100 m in a rim rising at 30° from its centre: a wall at
        // r ≥ 100 m, 100 tan 30° high.
        let rim = 100.0 * tan(rad(30.0));
        let (h, size) = plate(257, 1.0, |x, z| {
            let r = deep_canvas::ops::sqrt((x - 128.0) * (x - 128.0) + (z - 128.0) * (z - 128.0));
            if r >= 100.0 {
                rim
            } else {
                0.0
            }
        });
        let t = bake(size, 257, 257, &h, [17, 17]);
        let hs = t.angles(0.5, 0.5);
        assert!((occlusion(&hs) - 0.75).abs() < 0.02, "{}", occlusion(&hs));
    }
}
