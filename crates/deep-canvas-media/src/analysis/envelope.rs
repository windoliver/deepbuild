//! Issue #500: the envelope analysis bake (canvas primitives: Analysis bake, `envelope {rate,
//! outputs: [rms, centroid]}`): RMS and spectral centroid of the channels' mean every 1 ÷ rate s.

use super::fft::fft;
use deep_canvas::ops;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Row {
    /// First sample.
    pub start: i64,
    /// One past the last sample.
    pub end: i64,
    pub rms: f64,
    /// Largest |x| in the row.
    pub peak: f64,
    /// Hz.
    pub centroid: f64,
}

/// One row per 1/hz s of the channels' mean: row r covers samples [⌊r·rate/hz⌋, ⌊(r+1)·rate/hz⌋) (integer arithmetic), the last partial row included.
///
/// `rms` is √(mean x²) over exactly the row's samples; `centroid` is Σ f·|X(f)| ÷ Σ |X(f)| over
/// bins 0 to N/2 of the row under a periodic Hann window of the row's length, zero-padded to N,
/// the next power of two (0 for a silent row).
pub fn envelope(samples: &[f32], channels: usize, rate: i64, hz: i64) -> Vec<Row> {
    let x = mono(samples, channels);
    let n = x.len() as i64;
    let mut rows = Vec::new();
    for r in 0.. {
        let start = r * rate / hz;
        if start >= n {
            break;
        }
        let end = ((r + 1) * rate / hz).min(n);
        rows.push(row(&x[start as usize..end as usize], start, end, rate));
    }
    rows
}

fn row(x: &[f64], start: i64, end: i64, rate: i64) -> Row {
    let len = x.len();
    let mut out = Row {
        start,
        end,
        rms: 0.0,
        peak: 0.0,
        centroid: 0.0,
    };
    if len == 0 {
        return out;
    }
    out.rms = ops::sqrt(x.iter().map(|v| v * v).sum::<f64>() / len as f64);
    out.peak = x.iter().fold(0.0, |m: f64, v| m.max(v.abs()));
    let size = len.next_power_of_two();
    let (mut re, mut im) = (vec![0.0; size], vec![0.0; size]);
    for (i, v) in x.iter().enumerate() {
        re[i] = v * (0.5 - 0.5 * ops::cos(ops::TAU * i as f64 / len as f64));
    }
    fft(&mut re, &mut im);
    let (mut num, mut den) = (0.0, 0.0);
    for k in 0..=size / 2 {
        let mag = ops::hypot(re[k], im[k]);
        num += k as f64 * rate as f64 / size as f64 * mag;
        den += mag;
    }
    if den > 0.0 {
        out.centroid = num / den;
    }
    out
}

/// The mean of each interleaved frame's channels, in f64.
pub(crate) fn mono(samples: &[f32], channels: usize) -> Vec<f64> {
    samples
        .chunks_exact(channels)
        .map(|f| f.iter().map(|&s| s as f64).sum::<f64>() / channels as f64)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 0.25 s of silence, 0.5 s of a 960 Hz sine of amplitude 0.5, 0.25 s of silence, at 48 kHz.
    fn tone_960() -> Vec<f32> {
        (0..48_000)
            .map(|i| {
                if (12_000..36_000).contains(&i) {
                    (0.5 * ops::sin(ops::TAU * 960.0 * i as f64 / 48_000.0)) as f32
                } else {
                    0.0
                }
            })
            .collect()
    }

    #[test]
    fn a_960_hz_sine_reads_rms_0_3536_in_every_row_inside_the_tone() {
        let rows = envelope(&tone_960(), 1, 48_000, 24);
        assert_eq!(rows.len(), 24);
        for (r, row) in rows.iter().enumerate() {
            assert_eq!(
                (row.start, row.end),
                (r as i64 * 2000, r as i64 * 2000 + 2000),
                "row {r}"
            );
            if (6..18).contains(&r) {
                assert!(
                    (row.rms - 0.3536).abs() < 1e-4,
                    "row {r} reads rms {}, not 0.3536",
                    row.rms
                );
                assert!(
                    (row.centroid - 960.0).abs() < 48_000.0 / 2048.0,
                    "row {r} reads centroid {} Hz, not 960 within a bin",
                    row.centroid
                );
            } else {
                assert_eq!((row.rms, row.centroid), (0.0, 0.0), "row {r} is silent");
            }
        }
    }

    #[test]
    fn the_peak_reads_0_5_where_rms_reads_0_3536() {
        // A bake that reported `peak` as its rms would read 0.5 and fail the criterion.
        for (r, row) in envelope(&tone_960(), 1, 48_000, 24)
            .iter()
            .enumerate()
            .filter(|(r, _)| (6..18).contains(r))
        {
            assert!((row.peak - 0.5).abs() < 2e-3, "row {r} peak {}", row.peak);
            assert!(
                (row.peak - 0.3536).abs() > 0.1,
                "row {r} peak {} would pass as rms",
                row.peak
            );
        }
    }

    #[test]
    fn rows_at_44_1_khz_are_1837_or_1838_samples_and_the_last_partial_row_counts() {
        // Two channels whose mean is (r + 1) / 100 in row r: rms reads exactly the row's own samples.
        let lens: Vec<usize> = (0..24)
            .map(|r| if r % 2 == 0 { 1837 } else { 1838 })
            .chain([1000])
            .collect();
        let mut samples = Vec::new();
        for (r, len) in lens.iter().enumerate() {
            let v = (r + 1) as f64 / 100.0;
            for _ in 0..*len {
                samples.extend([(v + 0.25) as f32, (v - 0.25) as f32]);
            }
        }
        assert_eq!(samples.len(), 2 * 45_100);
        let rows = envelope(&samples, 2, 44_100, 24);
        assert_eq!(rows.len(), 25);
        let mut start = 0;
        for (r, row) in rows.iter().enumerate() {
            assert_eq!(
                (row.start, row.end),
                (start, start + lens[r] as i64),
                "row {r}"
            );
            assert!(
                (row.rms - (r + 1) as f64 / 100.0).abs() < 1e-6,
                "row {r} rms {}",
                row.rms
            );
            start = row.end;
        }
    }
}
