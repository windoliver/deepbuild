//! A video's frame at t (canvas primitives: Image `image@1`: video frames): the one whose
//! presentation interval holds the source time, looked up in the stream's own time base, so
//! constant and variable frame rates read the same way.

use crate::FLICKS;

/// The source time, in flicks, an item with `frames {start, in, rate}` shows at `t`.
pub fn source_time(t: i64, start: i64, r#in: i64, rate: (i64, i64)) -> i64 {
    let rel = (t - start) as i128 * rate.0 as i128;
    (r#in as i128 + rel.div_euclid(rate.1.max(1) as i128)) as i64
}

/// The index of the frame whose presentation interval [pts[k], pts[k + 1]) holds `src` (flicks),
/// with `pts` in ticks of `timescale`; before the first frame it is frame 0 and after the last,
/// the last (the caller applies `hold` and `loop`). The planted lookup floors `src × frame_rate`.
pub fn frame_at(pts: &[i64], timescale: i64, src: i64) -> usize {
    let at = src as i128 * timescale as i128;
    let k = pts.partition_point(|p| (*p as i128) * (FLICKS as i128) <= at);
    k.saturating_sub(1).min(pts.len().saturating_sub(1))
}

/// The planted lookup: ⌊t × frame_rate⌋ from the nominal rate `p/q`.
pub fn frame_by_rate(src: i64, rate: (i64, i64), frames: usize) -> usize {
    let k = (src as i128 * rate.0 as i128).div_euclid(FLICKS as i128 * rate.1.max(1) as i128);
    (k.max(0) as usize).min(frames.saturating_sub(1))
}
