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
    Plan::new(n.max(1)).fft(re, im);
}

/// The bit-reversal permutation that starts an in-place radix-2 FFT.
fn reverse(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
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
}

/// Issue #157: an FFT of one size with its twiddles e^(−2πik/n), k < n/2, made once, for a
/// transform repeated many times; [`fft`] makes one for each call. Stage `len` reads every
/// (n ÷ len)th twiddle, whose angle −2πk ÷ len differs from the table's only by that power of
/// two, so the twiddles are those a stage would compute itself.
pub struct Plan {
    re: Vec<f64>,
    im: Vec<f64>,
}

impl Plan {
    /// The plan for `n` points, a power of two.
    pub fn new(n: usize) -> Plan {
        assert!(n.is_power_of_two(), "fft plan: {n} points must be a power of two");
        let (re, im) = (0..n / 2)
            .map(|k| {
                let a = -ops::TAU * k as f64 / n as f64;
                (ops::cos(a), ops::sin(a))
            })
            .unzip();
        Plan { re, im }
    }

    /// In-place forward FFT of `re`/`im`, the plan's length, unscaled. Called with the two
    /// swapped, it is the inverse transform times n.
    pub fn fft(&self, re: &mut [f64], im: &mut [f64]) {
        let n = re.len();
        assert!(im.len() == n && n.max(1) == (2 * self.re.len()).max(1), "fft plan: lengths {n} and {} for a plan of {}", im.len(), 2 * self.re.len());
        reverse(re, im);
        let mut len = 2;
        while len <= n {
            let (half, stride) = (len / 2, n / len);
            for (block_re, block_im) in re.chunks_exact_mut(len).zip(im.chunks_exact_mut(len)) {
                let (pr, qr) = block_re.split_at_mut(half);
                let (pi, qi) = block_im.split_at_mut(half);
                let twiddles = self.re.iter().step_by(stride).zip(self.im.iter().step_by(stride));
                for ((((pr, qr), pi), qi), (wr, wi)) in pr.iter_mut().zip(qr.iter_mut()).zip(pi.iter_mut()).zip(qi.iter_mut()).zip(twiddles) {
                    let tr = *qr * wr - *qi * wi;
                    let ti = *qr * wi + *qi * wr;
                    *qr = *pr - tr;
                    *qi = *pi - ti;
                    *pr += tr;
                    *pi += ti;
                }
            }
            len <<= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plan_inverts_its_transform_with_re_and_im_swapped() {
        for n in [1usize, 2, 8, 1 << 12] {
            let x: Vec<f64> = (0..n).map(|i| ops::sin(0.37 * i as f64) + if i % 7 == 3 { 0.5 } else { 0.0 }).collect();
            let y: Vec<f64> = (0..n).map(|i| ops::cos(1.3 * i as f64)).collect();
            let plan = Plan::new(n);
            let (mut pr, mut pi) = (x.clone(), y.clone());
            plan.fft(&mut pr, &mut pi);
            // The inverse: the same transform with re and im swapped, n times the input.
            plan.fft(&mut pi, &mut pr);
            let worst = (0..n).map(|k| (pr[k] / n as f64 - x[k]).abs().max((pi[k] / n as f64 - y[k]).abs())).fold(0.0, f64::max);
            assert!(worst < 1e-12 * n as f64, "{n} points: the round trip is off by {worst}");
        }
    }

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
