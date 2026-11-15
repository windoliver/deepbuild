//! Issue #500: the onsets analysis bake (canvas primitives: Analysis bake, `onsets {method:
//! transient | spectral_flux, threshold}`): each attack's start, at sample accuracy, in the
//! channels' mean.
//!
//! Both methods find an attack coarsely, then place it on the first sample whose |x| leaves the
//! pre-attack floor: more than twice the median of the 1 ms block peaks of |x| over the 50 ms
//! before the coarse point (0 in silence, so a click in silence reads its first non-zero sample).
//! A median of block peaks, so an earlier click inside those 50 ms doesn't raise the floor.

use super::{envelope::mono, fft::fft};
use deep_canvas::ops;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    /// The energy of the 1 ms starting at sample i over the energy of the 50 ms before i rises
    /// above `threshold` dB (both mean squares plus 1e-10, so silence reads 0 dB). A detection
    /// re-arms once the rise falls back to the threshold or below.
    Transient,
    /// Half-wave rectified spectral flux, Σ max(0, |X_f(k)| − |X_{f−1}(k)|), over 1024-sample
    /// frames every 256 samples under a periodic Hann window (frame f ends at sample 256·f, the
    /// last one at or before the file's end, since a cut there is no attack; samples before the
    /// start read 0). Frame f is an onset where its flux is a local maximum,
    /// above `threshold` × the median flux of the 17 frames centred on f, and above 1% of the
    /// frame's own Σ|X_f(k)|, so a steady tone's rounding never reads as an attack.
    SpectralFlux,
}

impl Method {
    /// The threshold a document that names none reads: 10 dB for Transient, ×2 for SpectralFlux.
    pub const fn default_threshold(self) -> f64 {
        match self {
            Method::Transient => 10.0,
            Method::SpectralFlux => 2.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Onset {
    /// The attack's start, sample-accurate.
    pub sample: i64,
    /// The sample of the attack's largest |x|, before the next onset and within 0.5 s.
    pub peak: i64,
    /// Transient: the rise in dB at detection. SpectralFlux: the onset frame's flux.
    pub strength: f64,
}

/// The spectral-flux frame (samples) and the hop between frames; audio.gen's seam reads flux on them too.
pub(crate) const FRAME: usize = 1024;
pub(crate) const HOP: usize = 256;
const MEDIAN: usize = 8;
const QUIET: f64 = 1e-10;

/// The onsets of the channels' mean, in sample order; see [`Method`] for what `threshold` means.
pub fn onsets(
    samples: &[f32],
    channels: usize,
    rate: i64,
    method: Method,
    threshold: f64,
) -> Vec<Onset> {
    let x = mono(samples, channels);
    let (short, long) = ((rate / 1000).max(1) as usize, (rate / 20).max(1) as usize);
    let found = match method {
        Method::Transient => transient(&x, short, long, threshold),
        Method::SpectralFlux => flux(&x, short, long, threshold),
    };
    let reach = (rate / 2).max(1) as usize;
    found
        .iter()
        .enumerate()
        .map(|(o, &(j, strength))| {
            let end = found
                .get(o + 1)
                .map_or(x.len(), |next| next.0)
                .min(j + reach)
                .min(x.len());
            let peak = (j..end).fold(j, |m, k| if x[k].abs() > x[m].abs() { k } else { m });
            Onset {
                sample: j as i64,
                peak: peak as i64,
                strength,
            }
        })
        .collect()
}

fn transient(x: &[f64], short: usize, long: usize, threshold: f64) -> Vec<(usize, f64)> {
    let mut sum = vec![0.0; x.len() + 1];
    for (i, v) in x.iter().enumerate() {
        sum[i + 1] = sum[i] + v * v;
    }
    let energy = |a: usize, b: usize, w: usize| ((sum[b] - sum[a]) / w as f64).max(0.0) + QUIET;
    let gain = ops::pow(10.0, threshold / 10.0);
    let (mut out, mut armed) = (Vec::new(), true);
    for i in 0..x.len() {
        let from = i.saturating_sub(long);
        let rise = energy(i, (i + short).min(x.len()), short) / energy(from, i, long);
        if rise <= gain {
            armed = true;
        } else if armed {
            armed = false;
            push(
                &mut out,
                attack(x, i, i + short, floor(&x[from..i], short)),
                10.0 * ops::log10(rise),
            );
        }
    }
    out
}

/// Each frame's half-wave rectified spectral flux, Σ max(0, |X_f(k)| − |X_{f−1}(k)|), and its
/// Σ|X_f(k)|: frame f is the [`FRAME`] samples ending at sample [`HOP`]·f under a periodic Hann
/// window, samples before the start read as 0, for f from 0 to ⌊len ÷ HOP⌋.
pub(crate) fn spectral_flux(x: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let hann: Vec<f64> = (0..FRAME)
        .map(|i| 0.5 - 0.5 * ops::cos(ops::TAU * i as f64 / FRAME as f64))
        .collect();
    let frames = x.len() / HOP + 1;
    let (mut flux, mut total, mut prev) = (
        vec![0.0; frames],
        vec![0.0; frames],
        vec![0.0; FRAME / 2 + 1],
    );
    for f in 0..frames {
        let (mut re, mut im) = (vec![0.0; FRAME], vec![0.0; FRAME]);
        for (i, v) in re.iter_mut().enumerate() {
            if let Some(s) = (f * HOP + i).checked_sub(FRAME).and_then(|s| x.get(s)) {
                *v = s * hann[i];
            }
        }
        fft(&mut re, &mut im);
        for (k, p) in prev.iter_mut().enumerate() {
            let m = ops::hypot(re[k], im[k]);
            flux[f] += (m - *p).max(0.0);
            total[f] += m;
            *p = m;
        }
    }
    (flux, total)
}

fn flux(x: &[f64], short: usize, long: usize, threshold: f64) -> Vec<(usize, f64)> {
    let (flux, total) = spectral_flux(x);
    let frames = flux.len();
    let mut out = Vec::new();
    for f in 1..frames {
        let mut near = flux[f.saturating_sub(MEDIAN)..(f + MEDIAN + 1).min(frames)].to_vec();
        near.sort_by(f64::total_cmp);
        let next = flux.get(f + 1).copied().unwrap_or(0.0);
        if flux[f] >= flux[f - 1]
            && flux[f] > next
            && flux[f] > threshold * near[near.len() / 2]
            && flux[f] > 0.01 * total[f]
        {
            let start = (f * HOP).saturating_sub(FRAME).min(x.len());
            push(
                &mut out,
                attack(
                    x,
                    start,
                    f * HOP,
                    floor(&x[start.saturating_sub(long)..start], short),
                ),
                flux[f],
            );
        }
    }
    out
}

/// Keeps onsets in strictly increasing sample order: a second detection of one attack is dropped.
fn push(out: &mut Vec<(usize, f64)>, j: usize, strength: f64) {
    if out.last().is_none_or(|&(last, _)| j > last) {
        out.push((j, strength));
    }
}

/// The median of the `block`-sample peaks of |x| (0 for no samples).
fn floor(x: &[f64], block: usize) -> f64 {
    let mut peaks: Vec<f64> = x
        .chunks(block)
        .map(|b| b.iter().fold(0.0, |m: f64, v| m.max(v.abs())))
        .collect();
    peaks.sort_by(f64::total_cmp);
    peaks.get(peaks.len() / 2).copied().unwrap_or(0.0)
}

/// The first sample in [from, to) whose |x| is above twice `floor`, else `from`.
fn attack(x: &[f64], from: usize, to: usize, floor: f64) -> usize {
    (from..to.min(x.len()))
        .find(|&k| x[k].abs() > 2.0 * floor)
        .unwrap_or(from)
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: i64 = 48_000;

    /// A 2 ms decaying 3 kHz burst starting at `at`, its first sample 0.8.
    fn click(x: &mut [f32], at: usize) {
        for k in 0..96 {
            x[at + k] +=
                (0.8 * ops::exp(-(k as f64) / 24.0)
                    * ops::cos(ops::TAU * 3000.0 * k as f64 / RATE as f64)) as f32;
        }
    }

    /// Uniform noise at −40 dBFS rms, from a fixed xorshift seed.
    fn noise(n: usize) -> Vec<f32> {
        let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
        (0..n)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                ((s >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) as f32 * 0.01 * 1.732_050_8
            })
            .collect()
    }

    fn tone(n: usize, hz: f64, amp: f64) -> Vec<f32> {
        (0..n)
            .map(|i| (amp * ops::sin(ops::TAU * hz * i as f64 / RATE as f64)) as f32)
            .collect()
    }

    fn samples(x: &[f32], method: Method) -> Vec<i64> {
        onsets(x, 1, RATE, method, method.default_threshold())
            .iter()
            .map(|o| o.sample)
            .collect()
    }

    const BOTH: [(Method, i64); 2] = [(Method::Transient, 0), (Method::SpectralFlux, 256)];

    #[test]
    fn a_click_in_silence_reads_its_first_sample() {
        let mut x = vec![0.0; 48_000];
        click(&mut x, 20_000);
        x[33_333] = 0.5;
        for (method, within) in BOTH {
            let got = onsets(&x, 1, RATE, method, method.default_threshold());
            assert_eq!(got.len(), 2, "{method:?}: {got:?}");
            for (o, want) in got.iter().zip([20_000, 33_333]) {
                assert!(
                    (o.sample - want).abs() <= within,
                    "{method:?}: onset {} for a click at {want}",
                    o.sample
                );
                assert_eq!(o.peak, want, "{method:?}: peak of the click at {want}");
            }
        }
        assert_eq!(samples(&x, Method::Transient), [20_000, 33_333]);
    }

    #[test]
    fn a_click_over_a_minus_40_dbfs_bed_reads_within_a_few_samples() {
        for (bed, name) in [
            (noise(48_000), "noise"),
            (tone(48_000, 1000.0, 0.01), "tone"),
        ] {
            let mut x = bed;
            click(&mut x, 30_001);
            for (method, _) in BOTH {
                // The bed's own start at sample 0 is an onset too; the click must be the only one after it.
                let late: Vec<i64> = samples(&x, method)
                    .into_iter()
                    .filter(|&s| s > 4_800)
                    .collect();
                assert_eq!(late.len(), 1, "{method:?} over {name}: {late:?}");
                assert!(
                    (late[0] - 30_001).abs() <= 4,
                    "{method:?} over {name}: onset {} for a click at 30001",
                    late[0]
                );
            }
        }
    }

    #[test]
    fn clicks_25_ms_apart_each_read_their_own_onset() {
        let at: [i64; 4] = [10_000, 11_200, 12_400, 13_600];
        let mut x = vec![0.0; 24_000];
        for a in at {
            click(&mut x, a as usize);
        }
        for (method, within) in BOTH {
            let got = samples(&x, method);
            assert_eq!(got.len(), at.len(), "{method:?}: {got:?}");
            for (g, a) in got.iter().zip(at) {
                assert!(
                    (g - a).abs() <= within,
                    "{method:?}: onset {g} for a click at {a}"
                );
            }
        }
    }

    #[test]
    fn a_sustained_sine_has_no_onset_after_its_first() {
        let mut x = vec![0.0; 12_000];
        x.extend(tone(96_000, 440.0, 0.5));
        for (method, _) in BOTH {
            let got = samples(&x, method);
            assert_eq!(got.len(), 1, "{method:?}: {got:?}");
            assert!(
                (got[0] - 12_001).abs() <= 1,
                "{method:?}: the sine starts at 12000, read {}",
                got[0]
            );
        }
    }
}
