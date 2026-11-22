use super::{ops, Iv};

/// The fixed 32-bit integer hash (lowbias32).
pub fn hash32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

fn mix(h: u32, v: u32) -> u32 {
    hash32(
        h ^ v
            .wrapping_add(0x9e37_79b9)
            .wrapping_add(h << 6)
            .wrapping_add(h >> 2),
    )
}

/// hash(…) → [0, 1): the fixed hash of each argument's whole part, as (h >> 8) × 2⁻²⁴.
pub fn hash01(args: &[f64]) -> f64 {
    let mut h = 0x2c1b_3c6d_u32;
    for a in args {
        h = mix(h, *a as i64 as u32);
    }
    f64::from(h >> 8) / f64::from(1u32 << 24)
}

/// The gradient at lattice point `cell`: a unit vector, in 1D a slope in [−1, 1].
fn gradient(seed: u32, cell: &[i64]) -> [f64; 3] {
    let mut h = hash32(seed ^ 0x51ed_270b);
    for c in cell {
        h = mix(h, *c as u32);
    }
    let u = f64::from(h >> 8) / f64::from(1u32 << 24);
    match cell.len() {
        1 => [2.0 * u - 1.0, 0.0, 0.0],
        2 => {
            let a = ops::TAU * u;
            [ops::cos(a), ops::sin(a), 0.0]
        }
        _ => {
            let h2 = mix(h, 0x68e3_1da4);
            let v = f64::from(h2 >> 8) / f64::from(1u32 << 24);
            let z = 2.0 * v - 1.0;
            let r = ops::sqrt((1.0 - z * z).max(0.0));
            let a = ops::TAU * u;
            [r * ops::cos(a), r * ops::sin(a), z]
        }
    }
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// Gradient noise at `p` (1 to 3 components), about [−1, 1].
pub fn noise(p: &[f64], seed: u32) -> f64 {
    let d = p.len().min(3);
    if d == 0 || p.iter().any(|v| !v.is_finite()) {
        return f64::NAN;
    }
    let cell: Vec<i64> = p[..d].iter().map(|v| v.floor() as i64).collect();
    let f: Vec<f64> = p[..d]
        .iter()
        .zip(&cell)
        .map(|(v, c)| v - *c as f64)
        .collect();
    corner_sum(d, &cell, seed, |k, i| f[k] - i as f64, |k| fade(f[k]))
}

/// The trilinear blend of each corner's gradient dotted with its offset.
fn corner_sum(
    d: usize,
    cell: &[i64],
    seed: u32,
    off: impl Fn(usize, i64) -> f64,
    w: impl Fn(usize) -> f64,
) -> f64 {
    let mut acc = 0.0;
    for corner in 0..(1usize << d) {
        let mut c = [0i64; 3];
        let mut weight = 1.0;
        let mut dot = 0.0;
        for k in 0..d {
            let i = ((corner >> k) & 1) as i64;
            c[k] = cell[k] + i;
            let wk = w(k);
            weight *= if i == 1 { wk } else { 1.0 - wk };
        }
        let g = gradient(seed, &c[..d]);
        for (k, gk) in g.iter().enumerate().take(d) {
            let i = ((corner >> k) & 1) as i64;
            dot += gk * off(k, i);
        }
        acc += weight * dot;
    }
    acc
}

/// The fade's form: increasing on [0, 1].
fn fade_bound(t: Iv) -> Iv {
    let t = t.meet(Iv::new(0.0, 1.0));
    Iv::new(
        super::iv::down(fade(t.lo), 4).max(0.0),
        super::iv::up(fade(t.hi), 4).min(1.0),
    )
}

/// noise's interval form over the box `p`: per lattice cell the box covers (at most 64),
/// the cell's formula in interval arithmetic over the box's part in it; past that, or with
/// a seed that varies, the bound every cell holds.
pub fn noise_bound(p: &[Iv], seed: Option<u32>) -> Iv {
    let d = p.len().min(3);
    if d == 0 || p.iter().any(Iv::is_empty) {
        return Iv::EMPTY;
    }
    let global = global_bound(d);
    let Some(seed) = seed else { return global };
    if p.iter().any(|v| !v.is_bounded()) {
        return global;
    }
    let lo: Vec<i64> = p[..d].iter().map(|v| v.lo.floor() as i64).collect();
    let hi: Vec<i64> = p[..d].iter().map(|v| v.hi.floor() as i64).collect();
    let count: i64 = lo.iter().zip(&hi).map(|(a, b)| b - a + 1).product();
    if count > 64 {
        return global;
    }
    let mut out = Iv::EMPTY;
    let mut cell = lo.clone();
    loop {
        // The box's part in this cell, as offsets in [0, 1].
        let f: Vec<Iv> = (0..d)
            .map(|k| {
                let c = cell[k] as f64;
                p[k].meet(Iv::new(c, c + 1.0))
                    .sub(Iv::point(c))
                    .meet(Iv::new(0.0, 1.0))
            })
            .collect();
        if f.iter().all(|v| !v.is_empty()) {
            out = out.hull(cell_bound(d, &cell, seed, &f));
        }
        // The next cell, odometer style.
        let mut k = 0;
        loop {
            if k == d {
                return out.meet(global);
            }
            cell[k] += 1;
            if cell[k] <= hi[k] {
                break;
            }
            cell[k] = lo[k];
            k += 1;
        }
    }
}

fn cell_bound(d: usize, cell: &[i64], seed: u32, f: &[Iv]) -> Iv {
    let mut acc = Iv::point(0.0);
    let w: Vec<Iv> = f.iter().map(|t| fade_bound(*t)).collect();
    for corner in 0..(1usize << d) {
        let mut c = [0i64; 3];
        let mut weight = Iv::point(1.0);
        for k in 0..d {
            let i = ((corner >> k) & 1) as i64;
            c[k] = cell[k] + i;
            weight = weight.mul(if i == 1 {
                w[k]
            } else {
                Iv::point(1.0).sub(w[k])
            });
        }
        let g = gradient(seed, &c[..d]);
        let mut dot = Iv::point(0.0);
        for k in 0..d {
            let i = ((corner >> k) & 1) as f64;
            dot = dot.add(Iv::point(g[k]).widen(4).mul(f[k].sub(Iv::point(i))));
        }
        acc = acc.add(weight.mul(dot));
    }
    acc.widen(8)
}

/// The bound every cell holds: each corner's dot is at most the offset's length, √d, and the
/// weights sum to 1.
pub fn global_bound(d: usize) -> Iv {
    let r = ops::sqrt(d as f64) * (1.0 + 1e-12);
    Iv::new(-r, r)
}

/// Fractal noise: octave i at p × lacunarityⁱ with seed + i, weighted gainⁱ.
pub fn fbm(p: &[f64], seed: u32, octaves: u32, lacunarity: f64, gain: f64) -> f64 {
    let mut acc = 0.0;
    let (mut f, mut a) = (1.0, 1.0);
    for i in 0..octaves {
        let q: Vec<f64> = p.iter().map(|v| v * f).collect();
        acc += a * noise(&q, seed.wrapping_add(i));
        f *= lacunarity;
        a *= gain;
    }
    acc
}

/// fbm's interval form: the sum of its octaves' forms.
pub fn fbm_bound(p: &[Iv], seed: Option<u32>, octaves: u32, lacunarity: f64, gain: f64) -> Iv {
    let mut acc = Iv::point(0.0);
    let (mut f, mut a) = (1.0, 1.0);
    for i in 0..octaves {
        let q: Vec<Iv> = p.iter().map(|v| v.mul(Iv::point(f))).collect();
        let n = noise_bound(&q, seed.map(|s| s.wrapping_add(i)));
        acc = acc.add(Iv::point(a).mul(n));
        f *= lacunarity;
        a *= gain;
    }
    acc
}

/// The feature point of `cell`, jittered over the whole cell.
fn feature(seed: u32, cell: &[i64]) -> [f64; 3] {
    let mut out = [0.0; 3];
    for (k, o) in out.iter_mut().enumerate().take(cell.len()) {
        let mut h = hash32(seed ^ 0x1b87_3593 ^ (k as u32).wrapping_mul(0x85eb_ca6b));
        for c in cell {
            h = mix(h, *c as u32);
        }
        *o = cell[k] as f64 + f64::from(h >> 8) / f64::from(1u32 << 24);
    }
    out
}

/// `cells(p, seed)`'s outputs: the distances to the nearest and second-nearest feature
/// points, the nearest's cell id and the nearest point itself (`dims` components used).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cells {
    pub f1: f64,
    pub f2: f64,
    pub id: u32,
    pub center: [f64; 3],
    pub dims: usize,
}

/// A cell's id: the fold of the hash over the seed and its coordinates, one per cell.
fn cell_id(seed: u32, cell: &[i64]) -> u32 {
    cell.iter()
        .fold(hash32(seed ^ 0x2c1b_3c6d), |h, c| mix(h, *c as u32))
}

/// Cellular noise over the 3 × 3 (× 3) block around p's cell, euclidean: f1 ≤ f2, the
/// nearest feature point's cell id and the point.
pub fn cells(p: &[f64], seed: u32) -> Cells {
    let d = p.len().min(3);
    let none = Cells {
        f1: f64::NAN,
        f2: f64::NAN,
        id: 0,
        center: [f64::NAN; 3],
        dims: d.max(1),
    };
    if d == 0 || p.iter().any(|v| !v.is_finite()) {
        return none;
    }
    let cell: Vec<i64> = p[..d].iter().map(|v| v.floor() as i64).collect();
    let (mut s1, mut s2) = (f64::INFINITY, f64::INFINITY);
    let mut out = none;
    for n in 0..3usize.pow(d as u32) {
        let mut c = [0i64; 3];
        let mut m = n;
        for k in 0..d {
            c[k] = cell[k] + (m % 3) as i64 - 1;
            m /= 3;
        }
        let fp = feature(seed, &c[..d]);
        let s: f64 = (0..d).map(|k| (p[k] - fp[k]) * (p[k] - fp[k])).sum();
        if s < s1 {
            s2 = s1;
            s1 = s;
            out.id = cell_id(seed, &c[..d]);
            out.center = fp;
        } else if s < s2 {
            s2 = s;
        }
    }
    out.f1 = ops::sqrt(s1);
    out.f2 = ops::sqrt(s2);
    out
}

/// cells' interval form: per cell the box covers (at most 64), the least and greatest
/// distance from the box's part to each feature point the cell searches, nearest taken.
pub fn cells_bound(p: &[Iv], seed: Option<u32>) -> Iv {
    let d = p.len().min(3);
    let global = Iv::new(0.0, ops::sqrt(d as f64) * 2.0);
    let Some(seed) = seed else { return global };
    if d == 0 || p.iter().any(|v| !v.is_bounded()) {
        return global;
    }
    let lo: Vec<i64> = p[..d].iter().map(|v| v.lo.floor() as i64).collect();
    let hi: Vec<i64> = p[..d].iter().map(|v| v.hi.floor() as i64).collect();
    let count: i64 = lo.iter().zip(&hi).map(|(a, b)| b - a + 1).product();
    if count > 64 {
        return global;
    }
    let mut out = Iv::EMPTY;
    let mut cell = lo.clone();
    loop {
        let part: Vec<Iv> = (0..d)
            .map(|k| p[k].meet(Iv::new(cell[k] as f64, cell[k] as f64 + 1.0)))
            .collect();
        if part.iter().all(|v| !v.is_empty()) {
            let mut best = Iv::new(f64::INFINITY, f64::INFINITY);
            for n in 0..3usize.pow(d as u32) {
                let mut c = [0i64; 3];
                let mut m = n;
                for k in 0..d {
                    c[k] = cell[k] + (m % 3) as i64 - 1;
                    m /= 3;
                }
                let fp = feature(seed, &c[..d]);
                let s = (0..d).fold(Iv::point(0.0), |acc, k| {
                    acc.add(part[k].sub(Iv::point(fp[k])).sqr())
                });
                best = best.min(s);
            }
            out = out.hull(super::iv::sqrt(best));
        }
        let mut k = 0;
        loop {
            if k == d {
                return out.widen(4);
            }
            cell[k] += 1;
            if cell[k] <= hi[k] {
                break;
            }
            cell[k] = lo[k];
            k += 1;
        }
    }
}
