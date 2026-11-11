//! Issue #503: the spectrum analysis bake (canvas primitives: Analysis bake, `spectrum {bands,
//! scale, range, rate, window}`), for a music visualizer's bars: each row the level in dB of each
//! band's bins under a periodic Hann window. Every number goes through the ops module's pinned
//! libm in a fixed order, so a bake re-checks to an exact match on any machine.

use std::ops::Range;

use super::envelope::mono;
use super::fft::fft;
use deep_canvas::ops;

/// The windows a spectrum takes, in samples, shortest first.
pub const WINDOWS: [usize; 6] = [512, 1024, 2048, 4096, 8192, 16384];

/// The level a band reads at or below, in dB.
pub const FLOOR: f64 = -120.0;

/// How a spectrum spaces its band edges across its range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scale {
    /// Evenly in log frequency.
    Log,
    /// Evenly in mel, 2595 log10(1 + f ÷ 700).
    Mel,
    /// Evenly in hertz: the planted spacing (`spectrum_bands_even_hz`), never a field's value.
    Hertz,
}

fn mel(f: f64) -> f64 {
    2595.0 * ops::log10(1.0 + f / 700.0)
}

fn mel_hz(m: f64) -> f64 {
    700.0 * (ops::pow(10.0, m / 2595.0) - 1.0)
}

/// The `bands + 1` edges in Hz, evenly spaced in `scale` across `range`, the first and last
/// exactly the range's ends.
pub fn edges(bands: usize, scale: Scale, range: [f64; 2]) -> Vec<f64> {
    let [lo, hi] = range;
    (0..=bands)
        .map(|i| {
            let a = i as f64 / bands as f64;
            match i {
                0 => lo,
                i if i == bands => hi,
                _ => match scale {
                    Scale::Log => lo * ops::pow(hi / lo, a),
                    Scale::Mel => mel_hz(mel(lo) + (mel(hi) - mel(lo)) * a),
                    Scale::Hertz => lo + (hi - lo) * a,
                },
            }
        })
        .collect()
}

/// For each band, the bins 0 to n ÷ 2 of an `n`-sample window at `sample_rate` whose centres
/// k × sample_rate ÷ n lie in it, low edge ≤ centre < high edge, so a centre on an edge belongs
/// to the band above it.
pub fn bins(edges: &[f64], n: usize, sample_rate: i64) -> Vec<Range<usize>> {
    let centre = |k: usize| k as f64 * sample_rate as f64 / n as f64;
    let first_at = |f: f64, from: usize| (from..=n / 2).find(|&k| centre(k) >= f).unwrap_or(n / 2 + 1);
    edges
        .windows(2)
        .map(|e| {
            let start = first_at(e[0], 0);
            start..first_at(e[1], start).max(start)
        })
        .collect()
}

/// Each band that holds no bin centre at `window`, with the shortest window of [`WINDOWS`]
/// whose bins fill it, or `None` where none does.
pub fn empty(edges: &[f64], window: usize, sample_rate: i64) -> Vec<(usize, Option<usize>)> {
    let each: Vec<(usize, Vec<Range<usize>>)> = WINDOWS.iter().map(|&n| (n, bins(edges, n, sample_rate))).collect();
    bins(edges, window, sample_rate)
        .iter()
        .enumerate()
        .filter(|(_, b)| b.is_empty())
        .map(|(band, _)| (band, each.iter().find(|(_, b)| !b[band].is_empty()).map(|(n, _)| *n)))
        .collect()
}

/// One row per 1 ÷ `rate` s of `samples` (interleaved, `channels`), ⌈frames × rate ÷
/// sample_rate⌉ rows. Row r reads the `window` samples of the channels' mean that end at sample
/// ⌊r × sample_rate ÷ rate⌋, those before the start read as 0, under a periodic Hann window, and
/// holds each band's level 10 log10(Σ|X_k|² ÷ (3N²/32)) dB over its bins, floored at −120 dB, so
/// a full-scale sine wholly inside a band reads 0 dB. `normalized: false` is the planted bake
/// (`spectrum_skips_window_norm`) that leaves out the division by 3N²/32.
pub fn rows(samples: &[f32], channels: usize, sample_rate: i64, rate: i64, window: usize, edges: &[f64], normalized: bool) -> Vec<Vec<f64>> {
    let x = mono(samples, channels.max(1));
    let len = x.len() as i64;
    let count = (len * rate + sample_rate - 1) / sample_rate;
    let hann: Vec<f64> = (0..window).map(|i| 0.5 - 0.5 * ops::cos(ops::TAU * i as f64 / window as f64)).collect();
    let bands = bins(edges, window, sample_rate);
    let norm = if normalized { 3.0 * (window * window) as f64 / 32.0 } else { 1.0 };
    (0..count)
        .map(|r| {
            let end = r * sample_rate / rate;
            let (mut re, mut im) = (vec![0.0; window], vec![0.0; window]);
            for (i, w) in hann.iter().enumerate() {
                let s = end - window as i64 + i as i64;
                if (0..len).contains(&s) {
                    re[i] = x[s as usize] * w;
                }
            }
            fft(&mut re, &mut im);
            bands
                .iter()
                .map(|b| {
                    let power: f64 = b.clone().map(|k| re[k] * re[k] + im[k] * im[k]).sum();
                    if power > 0.0 {
                        (10.0 * ops::log10(power / norm)).max(FLOOR)
                    } else {
                        FLOOR
                    }
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 10 s mono at 48 kHz: a 937.5 Hz sine of amplitude 0.5 from 2 s to 4 s, silence elsewhere.
    fn tone() -> Vec<f32> {
        (0..480_000)
            .map(|i| match i {
                96_000..192_000 => (0.5 * ops::sin(ops::TAU * 937.5 * i as f64 / 48_000.0)) as f32,
                _ => 0.0,
            })
            .collect()
    }

    #[test]
    fn a_bin_centred_sine_reads_its_amplitude_in_its_band_and_the_floor_elsewhere() {
        let e = edges(16, Scale::Log, [40.0, 16_000.0]);
        assert!((e[8] - 800.0).abs() < 1e-9 && (e[9] - 1163.3).abs() < 0.1, "band 8 is {} to {} Hz", e[8], e[9]);
        let r = rows(&tone(), 1, 48_000, 60, 2048, &e, true);
        assert_eq!(r.len(), 600);
        assert!((r[180][8] - 20.0 * ops::log10(0.5)).abs() < 0.01, "band 8 at 3 s reads {}", r[180][8]);
        assert!(r[180].iter().enumerate().all(|(b, l)| b == 8 || *l == FLOOR), "{:?}", r[180]);
        assert!(r[60].iter().all(|l| *l == FLOOR), "{:?}", r[60]);
        // Without the window's normalization the tone reads 10 log10(0.25 × 3 × 2048² ÷ 32).
        let raw = rows(&tone(), 1, 48_000, 60, 2048, &e, false);
        assert!((raw[180][8] - 49.93).abs() < 0.01, "unnormalized band 8 reads {}", raw[180][8]);
        // Evenly in hertz, band 0 (40 to 1,037.5 Hz) holds the tone.
        let hz = rows(&tone(), 1, 48_000, 60, 2048, &edges(16, Scale::Hertz, [40.0, 16_000.0]), true);
        assert!(hz[180][0] > -7.0 && hz[180][8] == FLOOR, "{:?}", hz[180]);
    }

    #[test]
    fn an_empty_band_names_the_shortest_window_that_fills_it() {
        let e = edges(32, Scale::Log, [40.0, 16_000.0]);
        assert_eq!(empty(&e, 2048, 48_000), vec![(1, Some(8192)), (2, Some(4096))]);
        assert!(empty(&e, 8192, 48_000).is_empty());
        assert!(empty(&edges(16, Scale::Log, [40.0, 16_000.0]), 2048, 48_000).is_empty());
    }

    #[test]
    fn mel_edges_are_even_in_mel() {
        let e = edges(4, Scale::Mel, [0.0, 8000.0]);
        let steps: Vec<f64> = e.windows(2).map(|w| mel(w[1]) - mel(w[0])).collect();
        assert!(steps.iter().all(|s| (s - steps[0]).abs() < 1e-9), "{steps:?}");
    }
}
