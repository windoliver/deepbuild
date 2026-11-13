//! Issue #935: audio.gen's measures on decoded PCM (canvas primitives: Check input: asset kinds:
//! generated sound): a loop region's length in bars, its seam, a mix's residual over its stems,
//! takes' log-spectral distances, a short take's level and a file's leading silence. Everything
//! runs in f64 with every transcendental through the ops module, so a reading is the same on every
//! machine; the thresholds are the caller's, from the design.

use super::loudness::Loudness;
use super::onsets::{spectral_flux, FRAME, HOP};
use super::{envelope::mono, fft::fft};
use deep_canvas::ops;

/// The 99th percentile, nearest rank: entry ⌊(n − 1) × 0.99 + 0.5⌋ of the sorted values (0 for none).
pub fn p99(values: &[f64]) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    match v.len() {
        0 => 0.0,
        n => v[((n - 1) as f64 * 0.99 + 0.5) as usize],
    }
}

/// The median, the mean of the two middle values for an even count (0 for none).
pub fn median(values: &[f64]) -> f64 {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    match v.len() {
        0 => 0.0,
        n if n % 2 == 1 => v[n / 2],
        n => (v[n / 2 - 1] + v[n / 2]) / 2.0,
    }
}

/// A loop region's length against bars of the declared tempo and meter.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bars {
    /// The region's length in seconds.
    pub seconds: f64,
    /// One bar's length in seconds: `beats` beats at the tempo.
    pub bar: f64,
    /// The region's length over a bar's, unrounded: the bar count the region implies.
    pub bars: f64,
    /// Whether the region is within 1 ms of a whole number of bars, at least 1.
    pub whole: bool,
}

/// `samples` samples at `rate` Hz against bars of `beats` beats at `tempo` BPM.
pub fn bars(samples: i64, rate: i64, tempo: f64, beats: u32) -> Bars {
    let seconds = samples as f64 / rate as f64;
    let bar = 60.0 * f64::from(beats) / tempo;
    let bars = seconds / bar;
    let n = bars.round();
    // In samples, so exactly 1 ms off reads within it: a bar at 100 BPM in 4/4 is 115,200 samples at 48 kHz.
    let off = (samples as f64 - n * (60.0 * f64::from(beats) * rate as f64 / tempo)).abs();
    Bars {
        seconds,
        bar,
        bars,
        whole: n >= 1.0 && off <= rate as f64 / 1000.0,
    }
}

/// The join of a loop region against the region's own steps and flux.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seam {
    /// The largest |x[start] − x[end − 1]| over the channels.
    pub step: f64,
    /// The 99th percentile of the steps |x[i + 1] − x[i]| inside the region (the largest over the channels at each i).
    pub step_p99: f64,
    /// The largest spectral flux of the frames that hold both sides of the join, over the region played twice.
    pub flux: f64,
    /// The 99th percentile of the flux of the frames inside the region.
    pub flux_p99: f64,
}

impl Seam {
    /// Both measures at or under the region's own 99th percentile.
    pub fn clean(&self) -> bool {
        self.step <= self.step_p99 && self.flux <= self.flux_p99
    }
}

/// The seam of interleaved `samples` looped from sample `end − 1` back to sample `start`
/// (`start < end` ≤ the frame count). Flux is the onsets kind's, on the channels' mean.
pub fn seam(samples: &[f32], channels: usize, start: usize, end: usize) -> Seam {
    let at = |i: usize, c: usize| f64::from(samples[i * channels + c]);
    let jump = |a: usize, b: usize| {
        (0..channels)
            .map(|c| (at(b, c) - at(a, c)).abs())
            .fold(0.0, f64::max)
    };
    let steps: Vec<f64> = (start..end - 1).map(|i| jump(i, i + 1)).collect();
    let x = mono(&samples[start * channels..end * channels], channels);
    let len = x.len();
    // The region and then its start again, as far as the last frame that holds the join.
    let looped: Vec<f64> = (0..len + FRAME + HOP).map(|i| x[i % len]).collect();
    let (flux, _) = spectral_flux(&looped);
    // A region frame's predecessor is inside the region too; a join frame ends past the join and starts before it.
    let own: Vec<f64> = (FRAME / HOP + 1..flux.len())
        .take_while(|f| f * HOP <= len)
        .map(|f| flux[f])
        .collect();
    let join = (0..flux.len())
        .filter(|f| f * HOP > len && f * HOP < len + FRAME)
        .map(|f| flux[f]);
    Seam {
        step: jump(end - 1, start),
        step_p99: p99(&steps),
        flux: join.fold(0.0, f64::max),
        flux_p99: p99(&own),
    }
}

/// A mix less the sum of its stems.
#[derive(Clone, Debug, PartialEq)]
pub struct Residual {
    /// 20 log10 of the residual's RMS over every sample and channel (−∞ for none).
    pub dbfs: f64,
    /// Each stem's |correlation| with the residual (0 when either is silent).
    pub correlations: Vec<f64>,
}

impl Residual {
    /// The stem that correlates most with the residual, the first of a tie.
    pub fn nearest(&self) -> Option<usize> {
        (0..self.correlations.len()).fold(None, |m, i| match m {
            Some(j) if self.correlations[j] >= self.correlations[i] => Some(j),
            _ => Some(i),
        })
    }
}

/// `mix` less the sum of `stems`, sample by sample, all interleaved alike; a shorter file reads
/// as silence past its end.
pub fn residual(mix: &[f32], stems: &[&[f32]]) -> Residual {
    let n = stems.iter().map(|s| s.len()).fold(mix.len(), usize::max);
    let get = |x: &[f32], i: usize| x.get(i).map_or(0.0, |v| f64::from(*v));
    let r: Vec<f64> = (0..n)
        .map(|i| get(mix, i) - stems.iter().map(|s| get(s, i)).sum::<f64>())
        .collect();
    let rr: f64 = r.iter().map(|v| v * v).sum();
    let correlations = stems
        .iter()
        .map(|s| {
            let ss: f64 = s.iter().map(|v| f64::from(*v) * f64::from(*v)).sum();
            let rs: f64 = s.iter().zip(&r).map(|(v, r)| f64::from(*v) * r).sum();
            if rr > 0.0 && ss > 0.0 {
                rs.abs() / ops::sqrt(rr * ss)
            } else {
                0.0
            }
        })
        .collect();
    let dbfs = if n == 0 || rr == 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * ops::log10(ops::sqrt(rr / n as f64))
    };
    Residual { dbfs, correlations }
}

/// The frame and hop of the log-spectral distance's spectra.
const LSD_FRAME: usize = 2048;
const LSD_HOP: usize = 1024;

/// A take's spectra for [`distance`]: per frame (2048 samples every 1024 from the start, on the
/// channels' mean under a periodic Hann window, past the end read as 0), each bin's power from
/// 1 to 1024 in dB, 10 log10(|X_k|² ÷ (3N²/32)), floored at −120 dB.
pub fn spectra(samples: &[f32], channels: usize) -> Vec<Vec<f64>> {
    let x = mono(samples, channels);
    let hann: Vec<f64> = (0..LSD_FRAME)
        .map(|i| 0.5 - 0.5 * ops::cos(ops::TAU * i as f64 / LSD_FRAME as f64))
        .collect();
    let norm = 3.0 * (LSD_FRAME * LSD_FRAME) as f64 / 32.0;
    (0..x.len().div_ceil(LSD_HOP))
        .map(|j| {
            let (mut re, mut im) = (vec![0.0; LSD_FRAME], vec![0.0; LSD_FRAME]);
            for (i, v) in re.iter_mut().enumerate() {
                *v = x.get(j * LSD_HOP + i).map_or(0.0, |s| s * hann[i]);
            }
            fft(&mut re, &mut im);
            (1..=LSD_FRAME / 2)
                .map(|k| (10.0 * ops::log10((re[k] * re[k] + im[k] * im[k]) / norm)).max(-120.0))
                .collect()
        })
        .collect()
}

/// The log-spectral distance (dB) of two takes' [`spectra`]: the mean, over the frames both
/// have, of the RMS over bins of the difference of their powers in dB (0 when they share none).
pub fn distance(a: &[Vec<f64>], b: &[Vec<f64>]) -> f64 {
    let frames = a.len().min(b.len());
    if frames == 0 {
        return 0.0;
    }
    let rms = |p: &[f64], q: &[f64]| {
        ops::sqrt(p.iter().zip(q).map(|(x, y)| (x - y) * (x - y)).sum::<f64>() / p.len() as f64)
    };
    a.iter().zip(b).map(|(p, q)| rms(p, q)).sum::<f64>() / frames as f64
}

/// A file's level (LUFS): its integrated loudness, or, for a file shorter than one 400 ms gating
/// block, the K-weighted power of its whole 10 ms sub-blocks.
pub fn level(l: &Loudness, rate: i64) -> f64 {
    const BLOCK: usize = 40;
    let n = l.momentary.len();
    if n == 0 || n >= BLOCK {
        return l.integrated;
    }
    // A momentary window shorter than 400 ms reads the samples before the file as silence.
    let bound = |k: usize| (k as i128 * rate as i128 / 100) as f64;
    l.momentary[n - 1] + 10.0 * ops::log10(bound(BLOCK) / bound(n))
}

/// The frames of leading silence: the index of the first frame with a sample at or above
/// −60 dBFS in any channel, or the frame count when there is none.
pub fn lead(samples: &[f32], channels: usize) -> usize {
    samples
        .chunks_exact(channels)
        .position(|f| f.iter().any(|s| f64::from(s.abs()) >= 0.001))
        .unwrap_or(samples.len() / channels)
}

#[cfg(test)]
mod tests {
    use super::super::loudness;
    use super::*;

    const RATE: i64 = 48_000;

    fn tone(n: usize, hz: f64, amp: f64) -> Vec<f32> {
        (0..n)
            .map(|i| (amp * ops::sin(ops::TAU * hz * i as f64 / RATE as f64)) as f32)
            .collect()
    }

    fn noise(n: usize, seed: u64, amp: f64) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s ^= s << 13;
                s ^= s >> 7;
                s ^= s << 17;
                ((s >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) as f32 * amp as f32
            })
            .collect()
    }

    #[test]
    fn sixteen_bars_at_100_bpm_are_whole_and_38_2_s_is_not() {
        let b = bars(1_843_200, RATE, 100.0, 4);
        assert!(b.whole && (b.bars - 16.0).abs() < 1e-9, "{b:?}");
        // 1 ms is the tolerance: 48 samples past whole still pass, 49 don't.
        assert!(bars(1_843_200 + 48, RATE, 100.0, 4).whole);
        assert!(!bars(1_843_200 + 49, RATE, 100.0, 4).whole);
        let short = bars(1_833_600, RATE, 100.0, 4);
        assert!(
            !short.whole && (short.bars - 15.916_666).abs() < 1e-5,
            "{short:?}"
        );
        assert!(
            !bars(24_000, RATE, 100.0, 4).whole,
            "less than a bar is never whole"
        );
    }

    #[test]
    fn a_region_of_whole_cycles_loops_clean_and_one_cut_10_ms_short_clicks() {
        // 220 Hz holds 220 whole cycles in a second; 10 ms less leaves 0.2 of a cycle at the join.
        // It starts 1 rad in: a join at a zero crossing steps as the bed's steepest 1%, above its 99th percentile.
        let x: Vec<f32> = (0..48_000)
            .map(|i| (0.5 * ops::sin(ops::TAU * 220.0 * i as f64 / RATE as f64 + 1.0)) as f32)
            .collect();
        let clean = seam(&x, 1, 0, 48_000);
        assert!(clean.clean(), "{clean:?}");
        let cut = seam(&x, 1, 0, 47_520);
        assert!(cut.step > cut.step_p99 * 10.0, "{cut:?}");
        assert!(!cut.clean());
        // Flux alone catches a join the step doesn't: 220.5 cycles turn back at a zero crossing, under whole
        // cycles of a quieter 5 kHz whose steps are the bed's steepest.
        let x: Vec<f32> = tone(48_000, 220.5, 0.5)
            .iter()
            .zip(tone(48_000, 5000.0, 0.05))
            .map(|(a, b)| a + b)
            .collect();
        let flipped = seam(&x, 1, 0, 48_000);
        assert!(
            flipped.step <= flipped.step_p99 && flipped.flux > flipped.flux_p99,
            "{flipped:?}"
        );
    }

    #[test]
    fn stems_that_sum_to_the_mix_leave_no_residual_and_a_shifted_one_is_named() {
        let stems = [
            tone(48_000, 110.0, 0.2),
            noise(48_000, 7, 0.1),
            tone(48_000, 660.0, 0.1),
        ];
        let mix: Vec<f32> = (0..48_000)
            .map(|i| stems.iter().map(|s| s[i]).sum())
            .collect();
        let r = residual(&mix, &[&stems[0][..], &stems[1][..], &stems[2][..]]);
        assert!(r.dbfs <= -60.0, "{r:?}");
        let mut shifted = vec![0.0; 48];
        shifted.extend(&stems[1][..48_000 - 48]);
        let r = residual(&mix, &[&stems[0][..], &shifted[..], &stems[2][..]]);
        assert!(r.dbfs > -60.0, "{r:?}");
        assert_eq!(r.nearest(), Some(1), "{r:?}");
    }

    #[test]
    fn a_take_repeated_reads_0_db_apart_and_two_takes_read_far_apart() {
        let a = spectra(&noise(24_000, 1, 0.2), 1);
        let b = spectra(&noise(24_000, 2, 0.2), 1);
        assert_eq!(distance(&a, &a), 0.0);
        assert!(distance(&a, &b) > 0.5, "{}", distance(&a, &b));
        // No loudness matching: the same take 0.3 dB louder reads 0.3 dB away.
        let louder: Vec<f32> = noise(24_000, 1, 0.2)
            .iter()
            .map(|s| s * ops::pow(10.0, 0.3 / 20.0) as f32)
            .collect();
        assert!((distance(&a, &spectra(&louder, 1)) - 0.3).abs() < 0.01);
    }

    #[test]
    fn a_take_shorter_than_a_block_reads_the_level_of_its_own_length() {
        let long = loudness::measure(&tone(96_000, 997.0, 0.1), &[1.0], RATE, 8);
        let short = loudness::measure(&tone(9_600, 997.0, 0.1), &[1.0], RATE, 8);
        assert_eq!(short.integrated, f64::NEG_INFINITY);
        assert!(
            (level(&short, RATE) - level(&long, RATE)).abs() < 0.05,
            "{} vs {}",
            level(&short, RATE),
            level(&long, RATE)
        );
    }

    #[test]
    fn leading_silence_ends_at_the_first_sample_at_minus_60_dbfs() {
        let mut x = vec![0.0005f32; 480];
        x.extend(tone(4_800, 1000.0, 0.5));
        let mut stereo = Vec::new();
        for s in &x {
            stereo.extend([0.0, *s]);
        }
        // The tone's sample 1 is the first at or above 0.001.
        assert_eq!(lead(&x, 1), 481);
        assert_eq!(lead(&stereo, 2), 481);
        assert_eq!(lead(&[0.0; 10], 1), 10);
    }

    #[test]
    fn the_percentile_is_nearest_rank_and_the_median_of_an_even_count_is_the_middle_pair() {
        let v: Vec<f64> = (0..=100).map(f64::from).collect();
        assert_eq!(p99(&v), 99.0);
        assert_eq!(median(&[1.0, 4.0, 2.0, 3.0]), 2.5);
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
    }
}
