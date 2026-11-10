//! Issue #500: the FFT the signal analysis bakes read (canvas primitives: Analysis bake), with its
//! twiddles on the ops module's pinned libm so a bake re-checks to an exact match.

use deep_canvas::ops;

/// In-place radix-2 FFT of `re`/`im` (length a power of two).
///
/// Forward transform, X(k) = Σ x(n) e^(−2πikn/N), unscaled; iterative Cooley–Tukey after a
/// bit-reversal permutation, each twiddle computed directly (no recurrence), in a fixed order.
pub fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    assert!(im.len() == n && (n == 0 || n.is_power_of_two()), "fft: lengths {n} and {} must match and be a power of two", im.len());
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        for k in 0..half {
            let a = -ops::TAU * k as f64 / len as f64;
            let (wr, wi) = (ops::cos(a), ops::sin(a));
            for s in (0..n).step_by(len) {
                let (p, q) = (s + k, s + k + half);
                let tr = re[q] * wr - im[q] * wi;
                let ti = re[q] * wi + im[q] * wr;
                re[q] = re[p] - tr;
                im[q] = im[p] - ti;
                re[p] += tr;
                im[p] += ti;
            }
        }
        len <<= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_a_direct_dft() {
        let x: Vec<f64> = (0..32).map(|i| ops::sin(0.7 * i as f64) + 0.3 * ops::cos(2.9 * i as f64 + 1.0) + if i == 5 { 1.0 } else { 0.0 }).collect();
        let (mut re, mut im) = (x.clone(), vec![0.0; 32]);
        fft(&mut re, &mut im);
        for k in 0..32 {
            let (mut dr, mut di) = (0.0, 0.0);
            for (n, v) in x.iter().enumerate() {
                let a = -ops::TAU * (k * n) as f64 / 32.0;
                dr += v * ops::cos(a);
                di += v * ops::sin(a);
            }
            assert!((re[k] - dr).abs() < 1e-9 && (im[k] - di).abs() < 1e-9, "bin {k}: fft ({}, {}) vs dft ({dr}, {di})", re[k], im[k]);
        }
    }
}
