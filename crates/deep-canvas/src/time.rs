//! The core's clock (issue #488; canvas primitives: Time and the flick). One flick is
//! 1/705,600,000 s and time is an `i64` count of them. A rate is valid only if its frame, sample
//! or step is a whole number of flicks; every conversion is integer arithmetic, a product of a
//! flick count and a rate formed in i128 and an index floored by Euclidean division, so a time
//! before the start floors toward −∞ and no time is ever held in f32 seconds.

use crate::grammar::FLICKS_PER_SECOND;

/// The input track's default checkpoint spacing, 0.5 s (Input track: `checkpoint_every`).
pub const CHECKPOINT_EVERY: i64 = FLICKS_PER_SECOND / 2;

/// A rate a document, an export or a source names: a frame rate `p/q` or a sample rate in Hz.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rate {
    Frame { p: u32, q: u32 },
    Sample { hz: u32 },
}

impl Rate {
    /// The rate as a refusal names it: `p/q`, or `<Hz> Hz`.
    pub fn text(&self) -> String {
        match self {
            Rate::Frame { p, q } => format!("{p}/{q}"),
            Rate::Sample { hz } => format!("{hz} Hz"),
        }
    }
}

/// The whole-flick frame at `p/q` fps, or why there is none.
pub fn frame_length(p: u32, q: u32) -> Result<i64, String> {
    if p == 0 || q == 0 {
        return Err(format!("frame rate {p}/{q} is not a rate"));
    }
    let span = i128::from(FLICKS_PER_SECOND) * i128::from(q);
    if span % i128::from(p) != 0 {
        return Err(format!(
            "frame rate {p}/{q} has no whole-flick frame ({} flicks)",
            fraction(span, i128::from(p))
        ));
    }
    // 705,600,000 × q fits an i64 for every u32 q, so the frame does.
    Ok((span / i128::from(p)) as i64)
}

/// The whole-flick sample at `hz`, or why there is none.
pub fn sample_length(hz: u32) -> Result<i64, String> {
    if hz == 0 {
        return Err("sample rate 0 Hz is not a rate".into());
    }
    if FLICKS_PER_SECOND % i64::from(hz) != 0 {
        return Err(format!(
            "sample rate {hz} Hz has no whole-flick sample ({} flicks)",
            fraction(i128::from(FLICKS_PER_SECOND), i128::from(hz))
        ));
    }
    Ok(FLICKS_PER_SECOND / i64::from(hz))
}

/// `n ÷ d` as text with its fraction, for a refusal: `5512.5`.
fn fraction(n: i128, d: i128) -> String {
    let whole = n / d;
    let rem = n % d;
    if rem == 0 {
        return whole.to_string();
    }
    // Ten fraction digits, trailing zeros dropped: enough to show why the rate is refused.
    let scaled = rem * 10_000_000_000 / d;
    let digits = format!("{scaled:010}");
    format!("{whole}.{}", digits.trim_end_matches('0'))
}

/// The index of the frame, sample or step that holds `t`: ⌊t ÷ Δ⌋ with Euclidean division.
pub fn index(t: i64, length: i64) -> i64 {
    t.div_euclid(length)
}

/// Where frame, sample or step `k` starts: k × Δ, formed in i128; `None` past i64.
pub fn at(k: i64, length: i64) -> Option<i64> {
    i64::try_from(i128::from(k) * i128::from(length)).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_listed_rates_have_whole_frames_and_the_others_none() {
        for p in [
            8, 12, 15, 16, 18, 20, 24, 25, 30, 48, 50, 60, 72, 75, 90, 96, 100, 120, 144, 240,
        ] {
            assert!(frame_length(p, 1).is_ok(), "{p} fps");
            assert!(frame_length(p * 1000, 1001).is_ok(), "{p}000/1001 fps");
        }
        assert_eq!(frame_length(8, 1), Ok(88_200_000));
        assert_eq!(frame_length(12, 1), Ok(58_800_000));
        assert_eq!(frame_length(16, 1), Ok(44_100_000));
        for p in [85, 165, 170, 540] {
            assert!(frame_length(p, 1).unwrap_err().contains(&format!("{p}/1")));
        }
        for hz in [
            8_000, 11_025, 16_000, 22_050, 24_000, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400,
            192_000, 352_800,
        ] {
            assert!(sample_length(hz).is_ok(), "{hz} Hz");
        }
        assert_eq!(
            sample_length(128_000).unwrap_err(),
            "sample rate 128000 Hz has no whole-flick sample (5512.5 flicks)"
        );
        assert!(sample_length(384_000).is_err());
        assert!(sample_length(44_056).is_err());
    }

    #[test]
    fn indices_floor_toward_minus_infinity_and_products_are_i128() {
        let frame = frame_length(240_000, 1001).unwrap();
        assert_eq!(frame, 2_942_940);
        assert_eq!(index(1 << 62, frame), 1_567_033_652_887);
        assert_eq!(index(-1, frame), -1);
        assert_eq!(index(-frame, frame), -1);
        assert_eq!(index(-frame - 1, frame), -2);
        assert_eq!(at(195, 88_200_000), Some(17_199_000_000));
        assert_eq!(at(i64::MAX, 2), None);
    }
}
