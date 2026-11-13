//! Issue #500: the loudness bake (canvas primitives: Analysis bake). Loudness is a power bake:
//! f64 K-weighted energy per channel per 10 ms sub-block, plus sample and true peaks, from which
//! momentary, short-term, integrated, loudness range and maxima derive exactly (ITU-R BS.1770-4,
//! EBU Tech 3341 and Tech 3342).
//!
//! Every transcendental goes through the ops module on pinned libm, and the filters and energy
//! sums run in f64, so a bake reads the same on every machine.

use deep_canvas::ops;

/// Readings of one loudness bake.
///
/// Sub-block boundary k sits at sample ⌊k × rate ÷ 100⌋ (exactly k × 10 ms when the rate is a
/// multiple of 100 Hz); only whole sub-blocks count toward loudness, so samples after the last
/// boundary are read for peaks only. A window holding no energy (digital silence) reads
/// `f64::NEG_INFINITY` LUFS.
#[derive(Clone, Debug, PartialEq)]
pub struct Loudness {
    /// Momentary loudness (LUFS) of the 400 ms window ending at each sub-block's end: entry k is
    /// the window ending at boundary k + 1, that is at (k + 1) × 10 ms. A window that would start
    /// before the asset reads the samples before it as silence, so it never reads above a full one.
    pub momentary: Vec<f64>,
    /// Short-term loudness (LUFS) of the 3 s window ending at each sub-block's end, as `momentary`.
    pub short_term: Vec<f64>,
    /// The largest entry of `momentary`, or `f64::NEG_INFINITY` when there is none.
    pub momentary_max: f64,
    /// The largest entry of `short_term`, or `f64::NEG_INFINITY` when there is none.
    pub short_term_max: f64,
    /// Integrated loudness (LUFS) by BS.1770-4: 400 ms blocks every 100 ms (75% overlap, the
    /// momentary entries 0, 10, 20 …), excluding blocks at or below −70 LUFS absolute and then
    /// those at or below 10 LU under the mean of the rest. `f64::NEG_INFINITY` when no block is
    /// above −70 LUFS.
    pub integrated: f64,
    /// Loudness range (LU) by EBU Tech 3342 from every short-term entry (a 10 ms hop, finer than
    /// the 10 Hz minimum Tech 3342 asks): entries under −70 LUFS absolute and then more than
    /// 20 LU under the mean of the rest are excluded (Tech 3342's reference keeps a value equal
    /// to either threshold), and the range is the 95th minus the 10th percentile of what remains
    /// (nearest rank, index ⌊(n − 1) × p + 0.5⌋ of the sorted list, as Tech 3342's reference
    /// rounds). 0 when no entry reaches −70 LUFS.
    pub range: f64,
    /// Sample peak (dBFS): the largest |sample| over every channel.
    pub sample_peak: f64,
    /// True peak (dBTP): the largest |x| over every channel's samples and the points a polyphase
    /// windowed-sinc interpolator places between each pair of neighbouring samples at
    /// `oversample` times the rate (16 taps a phase, Kaiser β = 6). The input is read unscaled:
    /// BS.1770's optional 12.04 dB attenuation guards fixed-point headroom, which f64 has.
    pub true_peak: f64,
}

/// Measures interleaved `samples` at `rate` Hz, one channel per entry of `weights` (each
/// channel's BS.1770 weight: [`weight`]), with the true peak read at `oversample` times the rate
/// (4 or 8; 1 or 0 reads the sample peak). A trailing partial frame is ignored. With no channels,
/// or a rate under 100 Hz (where a 10 ms sub-block holds no sample), every list is empty and
/// every reading is silent.
pub fn measure(samples: &[f32], weights: &[f64], rate: i64, oversample: u32) -> Loudness {
    let channels = weights.len();
    if channels == 0 || rate < 100 {
        return readings(Vec::new(), Vec::new(), 0.0, 0.0);
    }
    let frames = samples.len() / channels;
    let bound = |k: usize| (k as i128 * rate as i128 / 100) as usize;
    let mut subblocks = 0;
    while bound(subblocks + 1) <= frames {
        subblocks += 1;
    }
    let bounds: Vec<usize> = (0..=subblocks).map(bound).collect();
    let stages = k_weighting(rate as f64);
    let phases = interpolator(oversample);

    // Channel-weighted K-weighted energy per sub-block: Σ_c G_c Σ y_c².
    let mut energy = vec![0.0f64; subblocks];
    let (mut sample_peak, mut true_peak) = (0.0f64, 0.0f64);
    // One channel at a time, as f64, with the interpolator's reach of zeros on either side.
    let mut padded = vec![0.0f64; frames + TAPS];
    for (c, weight) in weights.iter().enumerate() {
        for (dst, src) in padded[BEFORE..BEFORE + frames]
            .iter_mut()
            .zip(samples[c..].iter().step_by(channels))
        {
            *dst = f64::from(*src);
        }
        let x = &padded[BEFORE..BEFORE + frames];
        for (k, e) in channel_energy(x, &stages, &bounds).into_iter().enumerate() {
            energy[k] += weight * e;
        }
        let peak = x.iter().fold(0.0f64, |m, v| m.max(v.abs()));
        sample_peak = sample_peak.max(peak);
        true_peak = true_peak
            .max(peak)
            .max(interpolated_peak(&padded, frames, &phases));
    }

    let window = |len: usize| -> Vec<f64> {
        (1..=subblocks)
            .map(|k| {
                let samples = if k >= len {
                    bounds[k] - bounds[k - len]
                } else {
                    bound(len)
                };
                energy[k.saturating_sub(len)..k].iter().sum::<f64>() / samples as f64
            })
            .collect()
    };
    readings(
        window(MOMENTARY),
        window(SHORT_TERM),
        sample_peak,
        true_peak,
    )
}

/// Sub-blocks in a momentary window (400 ms).
const MOMENTARY: usize = 40;
/// Sub-blocks in a short-term window (3 s).
const SHORT_TERM: usize = 300;
/// Sub-blocks between integrated-loudness blocks (100 ms, so 400 ms blocks overlap by 75%).
const BLOCK_HOP: usize = 10;

/// Builds the readings from the mean weighted powers of each momentary and short-term window.
fn readings(
    momentary: Vec<f64>,
    short_term: Vec<f64>,
    sample_peak: f64,
    true_peak: f64,
) -> Loudness {
    // Integrated loudness and range read only whole windows.
    let full = |list: &[f64], len: usize| list.get(len - 1..).unwrap_or_default().to_vec();
    let blocks: Vec<f64> = full(&momentary, MOMENTARY)
        .into_iter()
        .step_by(BLOCK_HOP)
        .collect();
    let integrated = integrated(&blocks);
    let range = range(&full(&short_term, SHORT_TERM));
    let momentary: Vec<f64> = momentary.into_iter().map(lufs).collect();
    let short_term: Vec<f64> = short_term.into_iter().map(lufs).collect();
    Loudness {
        momentary_max: momentary.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        short_term_max: short_term.iter().copied().fold(f64::NEG_INFINITY, f64::max),
        momentary,
        short_term,
        integrated,
        range,
        sample_peak: db(sample_peak),
        true_peak: db(true_peak),
    }
}

/// Loudness (LUFS) of a mean channel-weighted power: −0.691 + 10 log10 z.
fn lufs(z: f64) -> f64 {
    -0.691 + 10.0 * ops::log10(z)
}

/// An amplitude in dB: 20 log10 a.
fn db(a: f64) -> f64 {
    20.0 * ops::log10(a)
}

fn mean(z: &[f64]) -> f64 {
    z.iter().sum::<f64>() / z.len() as f64
}

/// BS.1770-4 integrated loudness of the 400 ms block powers: −70 LUFS absolute exclusion, then
/// the −10 LU relative threshold.
fn integrated(blocks: &[f64]) -> f64 {
    let above: Vec<f64> = blocks
        .iter()
        .copied()
        .filter(|z| lufs(*z) > -70.0)
        .collect();
    if above.is_empty() {
        return f64::NEG_INFINITY;
    }
    let threshold = lufs(mean(&above)) - 10.0;
    let kept: Vec<f64> = above.into_iter().filter(|z| lufs(*z) > threshold).collect();
    lufs(mean(&kept))
}

/// EBU Tech 3342 loudness range of the short-term powers: −70 LUFS absolute exclusion, the
/// −20 LU relative threshold, then the 95th minus the 10th percentile.
fn range(short_term: &[f64]) -> f64 {
    let above: Vec<f64> = short_term
        .iter()
        .copied()
        .filter(|z| lufs(*z) >= -70.0)
        .collect();
    if above.is_empty() {
        return 0.0;
    }
    let threshold = lufs(mean(&above)) - 20.0;
    // Never empty: the loudest entry is at least the mean, 20 LU over the threshold.
    let mut kept: Vec<f64> = above
        .into_iter()
        .map(lufs)
        .filter(|l| *l >= threshold)
        .collect();
    kept.sort_by(f64::total_cmp);
    let at = |p: f64| kept[((kept.len() - 1) as f64 * p + 0.5) as usize];
    at(0.95) - at(0.10)
}

/// A channel's BS.1770-4 weight by its place (degrees): 1.41 (about +1.5 dB) for a channel within
/// 30° of the horizontal plane and 60° to 120° to either side, else 1. An LFE weighs 0.
pub fn weight(azimuth: f64, elevation: f64) -> f64 {
    let az = azimuth.rem_euclid(360.0);
    let az = if az > 180.0 { 360.0 - az } else { az };
    if elevation.abs() < 30.0 && (60.0..=120.0).contains(&az) {
        1.41
    } else {
        1.0
    }
}

/// One biquad's coefficients, normalized so a0 = 1.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

/// The K-weighting pair for `rate` Hz: BS.1770's high-shelf pre-filter, then its RLB high-pass,
/// each derived from the analog prototype by the bilinear transform with the frequency prewarped,
/// so at 48 kHz they give BS.1770's published coefficients.
fn k_weighting(rate: f64) -> [Biquad; 2] {
    // High shelf: f0, gain in dB and Q of the analog prototype.
    let (f0, gain, q) = (
        1_681.974_450_955_533,
        3.999_843_853_973_347,
        0.707_175_236_955_419_6,
    );
    let k = ops::tan(ops::PI * f0 / rate);
    let vh = ops::pow(10.0, gain / 20.0);
    let vb = ops::pow(vh, 0.499_666_774_154_541_6);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad {
        b0: (vh + vb * k / q + k * k) / a0,
        b1: 2.0 * (k * k - vh) / a0,
        b2: (vh - vb * k / q + k * k) / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };
    // RLB high-pass: f0 and Q; its numerator is 1, −2, 1 as BS.1770 publishes it.
    let (f0, q) = (38.135_470_876_024_44, 0.500_327_037_323_877_3);
    let k = ops::tan(ops::PI * f0 / rate);
    let a0 = 1.0 + k / q + k * k;
    let high_pass = Biquad {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };
    [shelf, high_pass]
}

/// One channel's K-weighted energy Σ y² per sub-block [bounds[k], bounds[k + 1]), through both
/// stages in transposed direct form II from zero state.
fn channel_energy(x: &[f64], stages: &[Biquad; 2], bounds: &[usize]) -> Vec<f64> {
    let mut state = [[0.0f64; 2]; 2];
    let mut run = |v: f64| {
        let mut y = v;
        for (s, f) in state.iter_mut().zip(stages) {
            let out = f.b0 * y + s[0];
            s[0] = f.b1 * y - f.a1 * out + s[1];
            s[1] = f.b2 * y - f.a2 * out;
            y = out;
        }
        y
    };
    bounds
        .windows(2)
        .map(|w| x[w[0]..w[1]].iter().map(|v| run(*v)).map(|y| y * y).sum())
        .collect()
}

/// #509: a bus's power bake, made as its samples arrive: f64 K-weighted energy Σ y² per channel
/// per 10 ms sub-block, sub-block k from sample ⌊k × rate ÷ 100⌋, the filters from zero state at
/// sample 0. Samples before 0 or already read are skipped, and a gap reads as silence, so one pass
/// from the start gives the same bake whatever renders it.
pub struct Power {
    rate: i64,
    channels: usize,
    stages: [Biquad; 2],
    state: Vec<[[f64; 2]; 2]>,
    next: i64,
    acc: Vec<f64>,
    /// Each whole sub-block's energies, channel by channel.
    pub energy: Vec<f64>,
}

impl Power {
    pub fn new(rate: i64, channels: usize) -> Power {
        Power {
            rate,
            channels,
            stages: k_weighting(rate as f64),
            state: vec![[[0.0; 2]; 2]; channels],
            next: 0,
            acc: vec![0.0; channels],
            energy: Vec::new(),
        }
    }

    fn bound(&self, k: usize) -> i64 {
        (k as i128 * self.rate as i128 / 100) as i64
    }

    fn frame(&mut self, f: &[f32]) {
        for c in 0..self.channels {
            let mut y = f64::from(f.get(c).copied().unwrap_or(0.0));
            for (s, b) in self.state[c].iter_mut().zip(&self.stages) {
                let out = b.b0 * y + s[0];
                s[0] = b.b1 * y - b.a1 * out + s[1];
                s[1] = b.b2 * y - b.a2 * out;
                y = out;
            }
            self.acc[c] += y * y;
        }
        self.next += 1;
        let k = self.energy.len() / self.channels.max(1);
        if self.next == self.bound(k + 1) {
            self.energy.append(&mut self.acc.clone());
            self.acc.iter_mut().for_each(|a| *a = 0.0);
        }
    }

    /// Adds interleaved `frames`, the first at sample `at`.
    pub fn push(&mut self, at: i64, frames: &[f32]) {
        let ch = self.channels.max(1);
        let silent = vec![0.0f32; ch];
        while self.next < at {
            self.frame(&silent);
        }
        for (i, f) in frames.chunks_exact(ch).enumerate() {
            if at + i as i64 == self.next {
                self.frame(f);
            }
        }
    }

    /// The sub-blocks that end at or before `frames`.
    pub fn subblocks(&self, frames: i64) -> usize {
        let mut k = (self.energy.len() / self.channels.max(1))
            .min((frames.max(0) as i128 * 100 / self.rate as i128) as usize + 1);
        while k > 0 && self.bound(k) > frames {
            k -= 1;
        }
        k
    }

    /// The bake's bytes up to `frames`: each energy as f64 little-endian, sub-block by sub-block.
    pub fn bytes(&self, frames: i64) -> Vec<u8> {
        self.energy[..self.subblocks(frames) * self.channels]
            .iter()
            .flat_map(|e| e.to_le_bytes())
            .collect()
    }
}

/// The loudness (LUFS) of sub-blocks [from, to) of power bakes summed, each of `channels`
/// channels at weight 1, at `rate`: −0.691 + 10 log10 of the mean square.
pub fn loudness_of(bakes: &[&[f64]], channels: usize, rate: i64, from: usize, to: usize) -> f64 {
    let bound = |k: usize| (k as i128 * rate as i128 / 100) as i64;
    let samples = (bound(to) - bound(from)).max(1) as f64;
    let sum: f64 = bakes
        .iter()
        .map(|b| {
            b.get(from * channels..to * channels)
                .unwrap_or_default()
                .iter()
                .sum::<f64>()
        })
        .sum();
    lufs(sum / samples)
}

/// Taps per interpolator phase: each point between samples i and i + 1 reads x[i − 7] to x[i + 8].
pub(crate) const TAPS: usize = 16;
/// Zeros before a channel's first sample in the padded buffer.
pub(crate) const BEFORE: usize = TAPS / 2 - 1;
/// The Kaiser window's β: passband flat within 0.01 dB to 0.35 × rate, −0.2 dB at 0.4 × rate.
const BETA: f64 = 6.0;

/// The polyphase interpolator for `oversample` × the rate: for each phase p in 1 to L − 1, the
/// taps reading the point p ÷ L of the way from sample i to i + 1, a Kaiser-windowed sinc cut off
/// at the input's Nyquist frequency and scaled to unit gain at DC. Phase 0 is the sample itself.
pub(crate) fn interpolator(oversample: u32) -> Vec<[f64; TAPS]> {
    let half = (TAPS / 2) as f64;
    let i0_beta = bessel_i0(BETA);
    (1..oversample)
        .map(|p| {
            let f = f64::from(p) / f64::from(oversample);
            let mut taps = [0.0f64; TAPS];
            for (j, tap) in taps.iter_mut().enumerate() {
                let t = j as f64 - BEFORE as f64 - f;
                let r = t / half;
                *tap = ops::sinc(ops::PI * t) * bessel_i0(BETA * ops::sqrt((1.0 - r * r).max(0.0)))
                    / i0_beta;
            }
            let sum: f64 = taps.iter().sum();
            taps.map(|v| v / sum)
        })
        .collect()
}

/// The modified Bessel function of the first kind, order 0, by its power series.
fn bessel_i0(x: f64) -> f64 {
    let (mut sum, mut term, mut k) = (1.0f64, 1.0f64, 1.0f64);
    while term > 1e-17 * sum {
        let h = x / (2.0 * k);
        term *= h * h;
        sum += term;
        k += 1.0;
    }
    sum
}

/// The largest |y| among the interpolated points strictly between a channel's first and last
/// samples. `padded` holds the channel's `frames` samples from index `BEFORE`, zeros around them.
fn interpolated_peak(padded: &[f64], frames: usize, phases: &[[f64; TAPS]]) -> f64 {
    let mut peak = 0.0f64;
    for i in 0..frames.saturating_sub(1) {
        let reach = &padded[i..i + TAPS];
        for taps in phases {
            let y: f64 = reach.iter().zip(taps).map(|(x, h)| x * h).sum();
            peak = peak.max(y.abs());
        }
    }
    peak
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: i64 = 48_000;

    /// `channels` copies of a sine at `level` dBFS (peak), `freq` Hz and `phase` radians, for
    /// each (level, seconds) segment in turn, interleaved, with the phase running on across them.
    fn tone(segments: &[(f64, f64)], freq: f64, phase: f64, channels: usize) -> Vec<f32> {
        let mut out = Vec::new();
        let mut n = 0u64;
        for (level, secs) in segments {
            let a = ops::pow(10.0, level / 20.0);
            for _ in 0..(secs * RATE as f64) as u64 {
                let v = (a * ops::sin(ops::TAU * freq * n as f64 / RATE as f64 + phase)) as f32;
                out.extend(std::iter::repeat_n(v, channels));
                n += 1;
            }
        }
        out
    }

    #[test]
    fn k_weighting_at_48k_matches_bs1770() {
        let [shelf, high_pass] = k_weighting(48_000.0);
        let table = [
            (shelf.b0, 1.535_124_859_586_97),
            (shelf.b1, -2.691_696_189_406_38),
            (shelf.b2, 1.198_392_810_852_85),
            (shelf.a1, -1.690_659_293_182_41),
            (shelf.a2, 0.732_480_774_215_85),
            (high_pass.b0, 1.0),
            (high_pass.b1, -2.0),
            (high_pass.b2, 1.0),
            (high_pass.a1, -1.990_047_454_833_98),
            (high_pass.a2, 0.990_072_250_366_21),
        ];
        for (i, (got, want)) in table.iter().enumerate() {
            assert!(
                (got - want).abs() < 1e-8,
                "coefficient {i}: {got} vs BS.1770's {want}"
            );
        }
    }

    #[test]
    fn stereo_tone_at_minus_23_dbfs_reads_minus_23_lufs() {
        let l = measure(&tone(&[(-23.0, 20.0)], 997.0, 0.0, 2), &[1.0; 2], RATE, 4);
        assert_eq!((l.momentary.len(), l.short_term.len()), (2000, 2000));
        assert!(
            (l.integrated + 23.0).abs() <= 0.1,
            "integrated {}",
            l.integrated
        );
        for (name, list, len) in [
            ("momentary", &l.momentary, 40),
            ("short-term", &l.short_term, 300),
        ] {
            for (i, v) in list.iter().enumerate().skip(len - 1) {
                assert!((v + 23.0).abs() <= 0.1, "{name}[{i}] reads {v}");
            }
            // A window starting before the tone reads its missing part as silence.
            let half = list[len / 2 - 1];
            assert!(
                (half + 23.0 + 3.01).abs() <= 0.1,
                "{name}[{}] reads {half}",
                len / 2 - 1
            );
        }
        assert!((l.momentary_max + 23.0).abs() <= 0.1 && (l.short_term_max + 23.0).abs() <= 0.1);
        assert!(
            l.range.abs() <= 0.1,
            "a steady tone has no range: {}",
            l.range
        );
    }

    #[test]
    fn true_peak_of_a_quarter_rate_tone_at_45_degrees_is_3_db_over_its_samples() {
        // Samples of sin(πn/2 + π/4) sit at ±0.707 of the wave's peak, which falls midway
        // between them: a meter reading sample peaks is about 3.01 dB low here. The tone fades in
        // and out over 50 ms, as EBU Tech 3341's are, since a band-limited reconstruction of an
        // abrupt edge rings above the tone.
        let mut x = tone(&[(-6.0, 1.0)], 12_000.0, ops::PI / 4.0, 1);
        let (n, fade) = (x.len(), RATE as usize / 20);
        for i in 0..fade {
            let g = (0.5 - 0.5 * ops::cos(ops::PI * i as f64 / fade as f64)) as f32;
            x[i] *= g;
            x[n - 1 - i] *= g;
        }
        for oversample in [4, 8] {
            let l = measure(&x, &[1.0], RATE, oversample);
            let sample = -6.0 - 20.0 * ops::log10(ops::sqrt(2.0));
            assert!(
                (l.sample_peak - sample).abs() < 1e-3,
                "sample peak {}",
                l.sample_peak
            );
            assert!(
                (l.true_peak + 6.0).abs() < 0.05,
                "{oversample}x true peak {} vs −6.0",
                l.true_peak
            );
        }
    }

    #[test]
    fn surrounds_weigh_1_41_and_the_front_1() {
        assert_eq!(
            [30.0, -30.0, 0.0, 110.0, -110.0].map(|a| weight(a, 0.0)),
            [1.0, 1.0, 1.0, 1.41, 1.41]
        );
        assert_eq!(weight(110.0, 45.0), 1.0);
    }

    #[test]
    fn integrated_excludes_blocks_under_the_relative_threshold() {
        // EBU Tech 3341 signal 3: the quiet ends lie more than 10 LU under the tone.
        let x = tone(
            &[(-36.0, 10.0), (-23.0, 60.0), (-36.0, 10.0)],
            1000.0,
            0.0,
            2,
        );
        let l = measure(&x, &[1.0; 2], RATE, 4);
        assert!(
            (l.integrated + 23.0).abs() <= 0.1,
            "integrated {}",
            l.integrated
        );
    }

    #[test]
    fn loudness_range_of_two_levels_10_db_apart_is_10_lu() {
        // EBU Tech 3342 signal 1.
        let x = tone(&[(-20.0, 20.0), (-30.0, 20.0)], 1000.0, 0.0, 2);
        let l = measure(&x, &[1.0; 2], RATE, 4);
        assert!((l.range - 10.0).abs() <= 1.0, "range {}", l.range);
    }
}
