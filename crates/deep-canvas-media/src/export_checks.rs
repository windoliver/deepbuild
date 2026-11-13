//! Issue #157: the export kinds' judgments (canvas primitives: Check input: export kinds), pure
//! functions over the numbers an export measures on the GPU and in the decode worker: blank and
//! flat frames (film.blank), the loop's wrap (film.wrap), PSNR and the quality floor
//! (export.fidelity), the edit list applied to decoded PCM and the lag at which it best matches
//! the raw PCM, and the sync fixture's burst (export.sync).

use std::ops::Range;

use deep_canvas::ops;

use crate::analysis::fft::Plan;

/// One frame's reading: dark pixels (luma ≤ 0.06 as it shows over black), all pixels, and a
/// 256-bin luma histogram.
pub struct FrameRead {
    pub dark: u64,
    pub pixels: u64,
    pub histogram: [u32; 256],
}

/// film.blank's fields: the share of a frame's pixels that makes it blank, the shortest run
/// that fails (flicks), a frame's length (flicks), the declared spans (flicks) and the flat
/// window's width in code values.
pub struct BlankRule {
    pub coverage: f64,
    pub min: i64,
    pub frame: i64,
    pub except: Vec<Range<i64>>,
    pub flat_window: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlankKind {
    Black,
    /// Flat in the luma window from code value `low`.
    Flat {
        low: u8,
    },
}

/// A run of blank frames, `first` to `last` inclusive; its kind is its first frame's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub first: i64,
    pub last: i64,
    pub kind: BlankKind,
}

/// Runs of frames (absolute indices from `first`) each black (dark ≥ coverage·pixels) or flat
/// (≥ coverage·pixels in one luma window `flat_window` code values wide, whatever the luma),
/// lasting at least `min` (n·frame ≥ min), outside every declared span. `flat: false` is the
/// dark-pixel rule alone (the planted check of the issue's AC27 uses it).
pub fn blank_runs(first: i64, reads: &[FrameRead], rule: &BlankRule, flat: bool) -> Vec<Run> {
    let width = usize::from(rule.flat_window.max(1));
    let kind = |r: &FrameRead| {
        let need = rule.coverage * r.pixels as f64;
        if r.dark as f64 >= need {
            return Some(BlankKind::Black);
        }
        if !flat {
            return None;
        }
        // The window holding the most pixels, the lowest such.
        let h = r.histogram.map(u64::from);
        let mut held: u64 = h[..width].iter().sum();
        let mut best = (held, 0);
        for low in 1..=256 - width {
            held = held + h[low + width - 1] - h[low - 1];
            if held > best.0 {
                best = (held, low);
            }
        }
        (best.0 as f64 >= need).then_some(BlankKind::Flat { low: best.1 as u8 })
    };
    let mut out = Vec::new();
    let mut run: Option<Run> = None;
    let mut close = |run: Option<Run>| {
        if let Some(r) = run.filter(|r| (r.last - r.first + 1) * rule.frame >= rule.min) {
            out.push(r);
        }
    };
    for (i, read) in reads.iter().enumerate() {
        let k = first + i as i64;
        let declared = rule
            .except
            .iter()
            .any(|span| span.contains(&(k * rule.frame)));
        match (kind(read).filter(|_| !declared), run.as_mut()) {
            (Some(_), Some(r)) => r.last = k,
            (Some(kind), None) => {
                run = Some(Run {
                    first: k,
                    last: k,
                    kind,
                })
            }
            (None, _) => close(run.take()),
        }
    }
    close(run);
    out
}

/// film.wrap's failure: the loop's change from its last frame to its first, the largest change
/// between two neighbouring frames inside its span, and that pair's frames.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Wrap {
    pub change: f64,
    pub largest: f64,
    pub between: (i64, i64),
}

/// film.wrap: the mean absolute difference of the last frame's and first frame's BGRA bytes
/// against the largest such mean between two neighbouring frames inside the span; Err when larger.
pub fn wrap(last_to_first: u64, neighbours: &[(i64, u64)], bytes: u64) -> Result<(), Wrap> {
    let (at, largest) = neighbours.iter().fold(
        (0, 0),
        |best, &(k, sum)| if sum > best.1 { (k, sum) } else { best },
    );
    if last_to_first <= largest {
        return Ok(());
    }
    let mean = |sum: u64| sum as f64 / bytes.max(1) as f64;
    Err(Wrap {
        change: mean(last_to_first),
        largest: mean(largest),
        between: (at, at + 1),
    })
}

/// PSNR in dB of a sum of squared errors over `samples` 8-bit samples: peak 255, infinite when
/// they are equal.
pub fn psnr(sse: u64, samples: u64) -> f64 {
    if sse == 0 {
        return f64::INFINITY;
    }
    10.0 * ops::log10(255.0 * 255.0 * samples as f64 / sse as f64)
}

/// `video.quality`'s floor on PSNR-Y, dB.
pub fn quality_floor(quality: &str) -> Option<f64> {
    match quality {
        "draft" => Some(35.0),
        "standard" => Some(40.0),
        "master" => Some(45.0),
        _ => None,
    }
}

/// The edit list applied by the check itself: the `duration` sample frames of interleaved
/// `decoded` from sample frame `media_time`, or `None` when they aren't all there.
pub fn trim(decoded: &[f32], channels: usize, media_time: i64, duration: i64) -> Option<&[f32]> {
    if channels == 0 {
        return None;
    }
    let from = usize::try_from(media_time).ok()?.checked_mul(channels)?;
    let len = usize::try_from(duration).ok()?.checked_mul(channels)?;
    decoded.get(from..from.checked_add(len)?)
}

/// One channel's best match: the lag in samples (positive when the decoded PCM is late) and the
/// normalized correlation there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ChannelMatch {
    pub lag: i64,
    pub correlation: f64,
}

/// Per channel of interleaved `decoded` and `raw`, the lag within ±`max_lag` at which the decoded
/// PCM best matches the raw PCM, and the normalized correlation there: Σ d[n] r[n − lag] over
/// √(Σ d² Σ r²) of the whole channels, 1 for two silent ones.
pub fn pcm_match(
    decoded: &[f32],
    raw: &[f32],
    channels: usize,
    max_lag: usize,
) -> Vec<ChannelMatch> {
    let pairs: Vec<(usize, usize)> = (0..channels).map(|c| (c, c)).collect();
    matches(decoded, raw, channels, max_lag, &pairs)
}

/// How far either way [`swapped`] looks for each pair's best match: 4,096 samples.
const SWAP_LAG: usize = 4_096;

/// Whether a decoded channel matches another raw channel better than its own, each pair at its
/// best lag within ±4,096 samples.
pub fn swapped(decoded: &[f32], raw: &[f32], channels: usize) -> bool {
    let pairs: Vec<(usize, usize)> = (0..channels)
        .flat_map(|c| (0..channels).map(move |o| (c, o)))
        .collect();
    let found = matches(decoded, raw, channels, SWAP_LAG, &pairs);
    let at = |c: usize, o: usize| found[c * channels + o].correlation;
    (0..channels).any(|c| (0..channels).any(|o| o != c && at(c, o) > at(c, c)))
}

/// Each (decoded channel, raw channel) pair's best match within ±`max_lag` = L. The decoded PCM is
/// read in blocks of B frames and each block correlated, by FFTs of M = B + 2L points, with the
/// raw PCM from L before it to L after it, so no lag wraps; the blocks' cross-spectra add up to
/// the whole channels', and one inverse FFT for each two pairs gives every lag. The correlation
/// at the chosen lag is then summed directly.
fn matches(
    decoded: &[f32],
    raw: &[f32],
    channels: usize,
    max_lag: usize,
    pairs: &[(usize, usize)],
) -> Vec<ChannelMatch> {
    if channels == 0 {
        return Vec::new();
    }
    let m = (8 * max_lag).max(2).next_power_of_two();
    let block = m - 2 * max_lag;
    let plan = Plan::new(m);
    let mut sums: Vec<Spectrum> = pairs
        .iter()
        .map(|_| (vec![0.0; m / 2 + 1], vec![0.0; m / 2 + 1]))
        .collect();
    for from in (0..decoded.len() / channels).step_by(block) {
        let d = spectra(decoded, channels, (from as i64, block), m, &plan);
        let r = spectra(raw, channels, (from as i64 - max_lag as i64, m), m, &plan);
        for (sum, &(dc, rc)) in sums.iter_mut().zip(pairs) {
            let ((ar, ai), (br, bi)) = (&d[dc], &r[rc]);
            for k in 0..=m / 2 {
                // D·conj(R)
                sum.0[k] += ar[k] * br[k] + ai[k] * bi[k];
                sum.1[k] += ai[k] * br[k] - ar[k] * bi[k];
            }
        }
    }
    let mut out = Vec::with_capacity(pairs.len());
    for (two, found) in sums.chunks(2).zip(pairs.chunks(2)) {
        // Z = C₀ + iC₁, each C Hermitian, so z = c₀ + ic₁.
        let (mut zr, mut zi) = (vec![0.0f64; m], vec![0.0f64; m]);
        let none = (vec![0.0; m / 2 + 1], vec![0.0; m / 2 + 1]);
        let (c0, c1) = (&two[0], two.get(1).unwrap_or(&none));
        for k in 0..=m / 2 {
            zr[k] = c0.0[k] - c1.1[k];
            zi[k] = c0.1[k] + c1.0[k];
            if k > 0 && k < m / 2 {
                zr[m - k] = c0.0[k] + c1.1[k];
                zi[m - k] = c1.0[k] - c0.1[k];
            }
        }
        plan.fft(&mut zi, &mut zr);
        for (z, &pair) in [&zr, &zi].into_iter().zip(found) {
            // Lag l sits at (l − L) mod M: the raw segment starts L before its block.
            let reach = max_lag as i64;
            let at = |lag: i64| z[(lag - reach).rem_euclid(m as i64) as usize];
            let lag = (-reach..=reach).fold(
                -reach,
                |best, lag| if at(lag) > at(best) { lag } else { best },
            );
            out.push(correlation(decoded, raw, channels, pair, lag));
        }
    }
    out
}

/// One real channel's spectrum, bins 0 to M/2.
type Spectrum = (Vec<f64>, Vec<f64>);

/// Each channel of interleaved `x` over the `len` frames from `from` (zeros outside `x`), zero
/// padded to `m`, the plan's length, as its spectrum: two channels to one complex FFT,
/// X = FFT(a + ib), A[k] = (X[k] + conj X[M − k]) ÷ 2 and B[k] = (X[k] − conj X[M − k]) ÷ 2i.
fn spectra(
    x: &[f32],
    channels: usize,
    (from, len): (i64, usize),
    m: usize,
    plan: &Plan,
) -> Vec<Spectrum> {
    let frames = x.chunks_exact(channels);
    let skip = usize::try_from(-from).unwrap_or(0).min(len);
    let mut out = Vec::with_capacity(channels);
    for c in (0..channels).step_by(2) {
        let (mut re, mut im) = (vec![0.0f64; m], vec![0.0f64; m]);
        for (i, f) in frames
            .clone()
            .skip(usize::try_from(from).unwrap_or(0))
            .take(len - skip)
            .enumerate()
        {
            re[skip + i] = f64::from(f[c]);
            im[skip + i] = f.get(c + 1).map_or(0.0, |v| f64::from(*v));
        }
        plan.fft(&mut re, &mut im);
        let (mut a, mut b): (Spectrum, Spectrum) = Default::default();
        for k in 0..=m / 2 {
            let j = (m - k) % m;
            let (xr, xi, yr, yi) = (re[k], im[k], re[j], -im[j]);
            a.0.push((xr + yr) / 2.0);
            a.1.push((xi + yi) / 2.0);
            b.0.push((xi - yi) / 2.0);
            b.1.push((yr - xr) / 2.0);
        }
        out.push(a);
        if c + 1 < channels {
            out.push(b);
        }
    }
    out
}

/// The normalized correlation of decoded channel `dc` with raw channel `rc` at `lag`, summed directly.
fn correlation(
    decoded: &[f32],
    raw: &[f32],
    channels: usize,
    (dc, rc): (usize, usize),
    lag: i64,
) -> ChannelMatch {
    fn channel(x: &[f32], channels: usize, c: usize) -> impl Iterator<Item = f64> + '_ {
        x.chunks_exact(channels).map(move |f| f64::from(f[c]))
    }
    let energy = |x: &[f32], c: usize| channel(x, channels, c).map(|v| v * v).sum::<f64>();
    let (ed, er) = (energy(decoded, dc), energy(raw, rc));
    if ed == 0.0 || er == 0.0 {
        let correlation = if ed == er { 1.0 } else { 0.0 };
        return ChannelMatch {
            lag: 0,
            correlation,
        };
    }
    // d[n] with r[n − lag]: skip the frames of whichever starts later.
    let (d, r) = (channel(decoded, channels, dc), channel(raw, channels, rc));
    let sum: f64 = if lag >= 0 {
        d.skip(lag as usize).zip(r).map(|(a, b)| a * b).sum()
    } else {
        d.zip(r.skip(lag.unsigned_abs() as usize))
            .map(|(a, b)| a * b)
            .sum()
    };
    ChannelMatch {
        lag,
        correlation: sum / ops::sqrt(ed * er),
    }
}

/// Interleaved `x`, each channel low-passed at `cutoff` Hz by one 127-tap Blackman-windowed sinc,
/// symmetric, so two signals passed through it compare with no lag between them. A coded sound is
/// held to its source in the band its codec carries: AAC cuts what lies above its low-pass.
pub fn low_pass(x: &[f32], channels: usize, rate: u32, cutoff: f64) -> Vec<f32> {
    const TAPS: usize = 127;
    let (half, fc) = ((TAPS / 2) as i64, cutoff / f64::from(rate));
    let mut taps: Vec<f64> = (0..TAPS)
        .map(|i| {
            let n = i as f64 - half as f64;
            let sinc = if n == 0.0 {
                2.0 * fc
            } else {
                ops::sin(ops::TAU * fc * n) / (ops::TAU / 2.0 * n)
            };
            let a = ops::TAU * i as f64 / (TAPS - 1) as f64;
            sinc * (0.42 - 0.5 * ops::cos(a) + 0.08 * ops::cos(2.0 * a))
        })
        .collect();
    let sum: f64 = taps.iter().sum();
    taps.iter_mut().for_each(|t| *t /= sum);
    let frames = (x.len() / channels.max(1)) as i64;
    let mut out = vec![0.0f32; x.len()];
    for c in 0..channels {
        for n in 0..frames {
            let mut acc = 0.0f64;
            for (k, t) in taps.iter().enumerate() {
                let at = n + k as i64 - half;
                if (0..frames).contains(&at) {
                    acc += t * f64::from(x[at as usize * channels + c]);
                }
            }
            out[n as usize * channels + c] = acc as f32;
        }
    }
    out
}

/// The sync fixture's burst at `rate` Hz: the whole samples of 2 ms of a full-scale 4 kHz sine
/// from phase 0.
pub fn burst(rate: u32) -> Vec<f32> {
    let n = rate as usize * 2 / 1000;
    (0..n)
        .map(|i| ops::sin(ops::TAU * 4_000.0 * i as f64 / f64::from(rate)) as f32)
        .collect()
}

/// The lag within ±`max_lag` of `expected` (samples into `channel`, one channel's samples) at
/// which `burst` best matches the channel, by their dot product; `None` where nothing matches.
pub fn burst_lag(channel: &[f32], burst: &[f32], expected: i64, max_lag: usize) -> Option<i64> {
    let reach = max_lag as i64;
    let mut best: Option<(f64, i64)> = None;
    for lag in -reach..=reach {
        let Some(window) = usize::try_from(expected + lag)
            .ok()
            .and_then(|at| channel.get(at..at + burst.len()))
        else {
            continue;
        };
        let dot: f64 = window
            .iter()
            .zip(burst)
            .map(|(x, b)| f64::from(*x) * f64::from(*b))
            .sum();
        if dot > best.map_or(0.0, |b| b.0) {
            best = Some((dot, lag));
        }
    }
    best.map(|b| b.1)
}

#[cfg(test)]
mod tests {
    #[test]
    fn low_pass_keeps_the_band_and_cuts_above_it() {
        let rate = 48_000u32;
        let tone = |hz: f64| -> Vec<f32> {
            (0..4_800)
                .map(|i| ops::sin(ops::TAU * hz * i as f64 / f64::from(rate)) as f32)
                .collect()
        };
        let rms = |x: &[f32]| {
            ops::sqrt(
                x[200..4_600]
                    .iter()
                    .map(|v| f64::from(*v) * f64::from(*v))
                    .sum::<f64>()
                    / 4_400.0,
            )
        };
        let kept = rms(&low_pass(&tone(1_000.0), 1, rate, 16_000.0));
        let cut = rms(&low_pass(&tone(21_000.0), 1, rate, 16_000.0));
        assert!(
            (kept - ops::sqrt(0.5)).abs() < 0.01,
            "1 kHz passes: rms {kept}"
        );
        assert!(
            cut < 0.01 * ops::sqrt(0.5),
            "21 kHz is cut by 40 dB: rms {cut}"
        );
        // Symmetric: a click comes out centred where it went in.
        let mut click = vec![0.0f32; 400];
        click[200] = 1.0;
        let y = low_pass(&click, 1, rate, 16_000.0);
        let peak = (0..400).fold(0, |b, i| if y[i] > y[b] { i } else { b });
        assert_eq!(peak, 200);
    }

    use super::*;
    use crate::FLICKS;

    const F: i64 = FLICKS / 24;
    const PIXELS: u64 = 25_600;

    fn rule(except: Option<Range<i64>>) -> BlankRule {
        BlankRule {
            coverage: 0.98,
            min: FLICKS / 10,
            frame: F,
            except: except.into_iter().collect(),
            flat_window: 3,
        }
    }

    /// A frame whose pixels spread over every code value.
    fn picture() -> FrameRead {
        FrameRead {
            dark: 16 * 100,
            pixels: PIXELS,
            histogram: [100; 256],
        }
    }

    fn black() -> FrameRead {
        let mut histogram = [0; 256];
        histogram[0] = PIXELS as u32;
        FrameRead {
            dark: PIXELS,
            pixels: PIXELS,
            histogram,
        }
    }

    /// The look's paper at luma 0.94 (code 240), with `ink` of its pixels dark text.
    fn paper(ink: u32) -> FrameRead {
        let mut histogram = [0; 256];
        let rest = PIXELS as u32 - ink;
        histogram[20] = ink;
        histogram[239] = rest / 4;
        histogram[241] = rest / 4;
        histogram[240] = rest - 2 * (rest / 4);
        FrameRead {
            dark: u64::from(ink),
            pixels: PIXELS,
            histogram,
        }
    }

    fn film(blank: Range<usize>, frame: fn() -> FrameRead) -> Vec<FrameRead> {
        (0..48)
            .map(|k| {
                if blank.contains(&k) {
                    frame()
                } else {
                    picture()
                }
            })
            .collect()
    }

    #[test]
    fn four_black_frames_fail_film_blank_naming_them_until_declared() {
        let reads = film(10..14, black);
        assert_eq!(
            blank_runs(0, &reads, &rule(None), true),
            [Run {
                first: 10,
                last: 13,
                kind: BlankKind::Black
            }]
        );
        assert_eq!(blank_runs(0, &reads, &rule(Some(10 * F..14 * F)), true), []);
        // Frames are absolute: the same film from frame 240 names 250 to 253, and a span there declares them.
        assert_eq!(
            blank_runs(240, &reads, &rule(None), false),
            [Run {
                first: 250,
                last: 253,
                kind: BlankKind::Black
            }]
        );
        assert_eq!(
            blank_runs(240, &reads, &rule(Some(250 * F..254 * F)), false),
            []
        );
        // 3 frames last 0.125 s and fail; 2 last 0.083 s and pass.
        assert_eq!(
            blank_runs(0, &film(10..13, black), &rule(None), true).len(),
            1
        );
        assert_eq!(blank_runs(0, &film(10..12, black), &rule(None), true), []);
    }

    #[test]
    fn half_a_second_of_bare_paper_is_flat_where_the_dark_pixel_rule_passes_it() {
        let reads = film(20..32, || paper(0));
        assert_eq!(
            blank_runs(0, &reads, &rule(None), true),
            [Run {
                first: 20,
                last: 31,
                kind: BlankKind::Flat { low: 239 }
            }]
        );
        assert_eq!(blank_runs(0, &reads, &rule(None), false), []);
        // A title card of dark text on the paper, and a declared dip to white, pass.
        assert_eq!(
            blank_runs(
                0,
                &film(20..32, || paper(PIXELS as u32 / 20)),
                &rule(None),
                true
            ),
            []
        );
        assert_eq!(blank_runs(0, &reads, &rule(Some(20 * F..32 * F)), true), []);
    }

    #[test]
    fn a_wrap_larger_than_every_step_inside_the_loop_fails_naming_both() {
        let steps = [(0, 1_000), (1, 1_200), (2, 900)];
        assert_eq!(
            wrap(5_000, &steps, 100),
            Err(Wrap {
                change: 50.0,
                largest: 12.0,
                between: (1, 2)
            })
        );
        assert_eq!(wrap(1_100, &steps, 100), Ok(()));
        assert_eq!(wrap(1_200, &steps, 100), Ok(()));
    }

    #[test]
    fn psnr_peaks_at_255_and_the_floor_follows_the_quality() {
        assert_eq!(psnr(0, 100), f64::INFINITY);
        assert!(
            (psnr(100, 100) - 48.130_803_608_679_1).abs() < 1e-9,
            "{}",
            psnr(100, 100)
        );
        assert!(psnr(100 * 255 * 255, 100).abs() < 1e-9);
        assert_eq!(
            ["draft", "standard", "master", "best"].map(quality_floor),
            [Some(35.0), Some(40.0), Some(45.0), None]
        );
    }

    #[test]
    fn the_edit_list_trims_the_priming_and_keeps_its_duration() {
        let decoded: Vec<f32> = (0..4_000).flat_map(|k| [k as f32, -(k as f32)]).collect();
        let kept = trim(&decoded, 2, 2_112, 1_000).unwrap();
        assert_eq!(
            (kept.len(), kept[0], kept[1], kept[1_999]),
            (2_000, 2_112.0, -2_112.0, -3_111.0)
        );
        assert_eq!(
            trim(&decoded, 2, 2_112, 1_888).map(<[f32]>::len),
            Some(3_776)
        );
        assert_eq!(trim(&decoded, 2, 2_112, 1_889), None);
        assert_eq!(trim(&decoded, 2, -1, 10), None);
        assert_eq!(trim(&decoded, 0, 0, 10), None);
    }

    /// `n` samples of white noise in ±0.5 from `seed`.
    fn noise(n: usize, seed: u64) -> Vec<f32> {
        let mut s = seed;
        (0..n)
            .map(|_| {
                s = s
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                (s >> 40) as f32 / (1u64 << 24) as f32 - 0.5
            })
            .collect()
    }

    /// Two channels interleaved, each `by` samples late (early when negative), the same length.
    fn stereo(l: &[f32], r: &[f32], by: i64) -> Vec<f32> {
        let at = |x: &[f32], i: usize| {
            usize::try_from(i as i64 - by)
                .ok()
                .and_then(|j| x.get(j))
                .copied()
                .unwrap_or(0.0)
        };
        (0..l.len()).flat_map(|i| [at(l, i), at(r, i)]).collect()
    }

    fn lags(found: &[ChannelMatch]) -> Vec<i64> {
        found.iter().map(|m| m.lag).collect()
    }

    #[test]
    fn identical_pcm_matches_at_lag_0_with_correlation_1() {
        let (l, r) = (noise(192_000, 1), noise(192_000, 2));
        let raw = stereo(&l, &r, 0);
        let found = pcm_match(&raw, &raw, 2, 4_096);
        assert_eq!(lags(&found), [0, 0]);
        assert!(
            found.iter().all(|m| (m.correlation - 1.0).abs() < 1e-9),
            "{found:?}"
        );
        assert!(!swapped(&raw, &raw, 2));
        // A silent track matches its silent delivery.
        let silent = vec![0.0f32; 4_000];
        assert_eq!(
            pcm_match(&silent, &silent, 2, 64),
            [ChannelMatch {
                lag: 0,
                correlation: 1.0
            }; 2]
        );
    }

    #[test]
    fn a_delivery_late_by_its_priming_matches_at_that_lag() {
        let (l, r) = (noise(192_000, 3), noise(192_000, 4));
        let raw = stereo(&l, &r, 0);
        for by in [2_112, 1_088, -100] {
            let found = pcm_match(&stereo(&l, &r, by), &raw, 2, 4_096);
            assert_eq!(lags(&found), [by, by]);
            assert!(found.iter().all(|m| m.correlation > 0.95), "{found:?}");
        }
        assert!(!swapped(&stereo(&l, &r, 2_112), &raw, 2));
    }

    #[test]
    fn swapped_channels_are_named() {
        let (l, r) = (noise(192_000, 5), noise(192_000, 6));
        let raw = stereo(&l, &r, 0);
        let crossed = stereo(&r, &l, 0);
        assert!(swapped(&crossed, &raw, 2));
        assert!(swapped(&stereo(&r, &l, 1_088), &raw, 2));
        assert!(pcm_match(&crossed, &raw, 2, 4_096)
            .iter()
            .all(|m| m.correlation < 0.1));
    }

    #[test]
    fn a_minute_of_stereo_at_48_khz_matches_at_its_lag() {
        // 2,880,000 sample frames per channel, as the 60 s fixture film delivers.
        let (l, r) = (noise(2_880_000, 7), noise(2_880_000, 8));
        let found = pcm_match(&stereo(&l, &r, 2_112), &stereo(&l, &r, 0), 2, 4_096);
        assert_eq!(lags(&found), [2_112, 2_112]);
    }

    #[test]
    fn the_sync_burst_is_2_ms_of_4_khz_at_full_scale_and_reads_its_lag() {
        let b = burst(48_000);
        assert_eq!(b.len(), 96);
        assert!(b.iter().all(|v| v.abs() <= 1.0) && b.iter().any(|v| v.abs() > 0.99));
        assert_eq!(burst(44_100).len(), 88);
        let mut channel = vec![0.0f32; 96_000];
        channel[48_240..48_336].copy_from_slice(&b);
        assert_eq!(burst_lag(&channel, &b, 48_000, 4_096), Some(240));
        assert_eq!(burst_lag(&channel, &b, 48_240, 4_096), Some(0));
        assert_eq!(burst_lag(&vec![0.0; 96_000], &b, 48_000, 4_096), None);
        let at = burst(44_100);
        let mut channel = vec![0.0f32; 88_200];
        channel[44_100..44_188].copy_from_slice(&at);
        assert_eq!(burst_lag(&channel, &at, 44_100, 4_096), Some(0));
    }
}
