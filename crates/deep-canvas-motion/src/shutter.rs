//! A frame's exposure under motion blur (#466; canvas primitives: Motion blur): the sample times
//! of an exposure window centred on the frame's time after the look's quantize, each adding its
//! shutter offset after that quantize and never quantized again, so every frame of a held drawing
//! shows the same blur; and the samples' mean in linear light.

use deep_canvas_marks::finish::{srgb_decode, srgb_encode};

/// The times a frame at `t` samples: `samples` stratified shutter offsets over a shutter of
/// `shutter` flicks, centred, each added to `t` stepped down to the look's `quantize` grid.
/// With `requantize` (#466's planted blur) each sample's own time is quantized instead.
pub fn times(
    t: i64,
    quantize: Option<(u32, u32)>,
    shutter: i64,
    samples: u32,
    requantize: bool,
) -> Vec<i64> {
    let n = samples.max(1);
    let step = |t: i64| quantize.map_or(t, |q| crate::eval::grid(t, q));
    let frame = step(t);
    (0..n)
        .map(|k| {
            let share = if n > 1 {
                (f64::from(k) + 0.5) / f64::from(n) - 0.5
            } else {
                0.0
            };
            let offset = (share * shutter as f64).round() as i64;
            if requantize {
                step(t + offset)
            } else {
                frame + offset
            }
        })
        .collect()
}

/// The shutter in flicks: `angle` degrees of a frame at `fps` (`num/den`).
pub fn shutter(angle: f64, (num, den): (u32, u32)) -> i64 {
    let frame =
        deep_canvas::grammar::FLICKS_PER_SECOND as f64 * f64::from(den) / f64::from(num.max(1));
    (angle / 360.0 * frame).round() as i64
}

/// The mean of straight 8-bit RGBA frames in linear light, alpha as coverage.
pub fn average(frames: &[Vec<u8>]) -> Vec<u8> {
    let Some(first) = frames.first() else {
        return Vec::new();
    };
    if frames.len() == 1 {
        return first.clone();
    }
    let n = frames.len() as f64;
    let mut lut = [0.0f64; 256];
    for (v, slot) in lut.iter_mut().enumerate() {
        *slot = srgb_decode(v as f64 / 255.0);
    }
    let mut out = vec![0u8; first.len()];
    for (i, px) in out.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        let (mut rgb, mut a) = ([0.0f64; 3], 0.0f64);
        for f in frames {
            let p = &f[i * 4..i * 4 + 4];
            let w = f64::from(p[3]) / 255.0;
            for c in 0..3 {
                rgb[c] += lut[usize::from(p[c])] * w;
            }
            a += w;
        }
        for c in 0..3 {
            let v = if a > 0.0 { rgb[c] / a } else { 0.0 };
            px[c] = (srgb_encode(v).clamp(0.0, 1.0) * 255.0).round() as u8;
        }
        px[3] = (a / n * 255.0).round() as u8;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: i64 = deep_canvas::grammar::FLICKS_PER_SECOND;

    #[test]
    fn a_held_drawing_shows_the_same_window_on_both_frames_it_holds() {
        // 12 Hz drawings at 24 fps, a 180° shutter: frames 2m and 2m + 1 sample the same times.
        let s = shutter(180.0, (24, 1));
        for m in 0..6 {
            let (a, b) = (2 * m * SECOND / 24, (2 * m + 1) * SECOND / 24);
            assert_eq!(
                times(a, Some((12, 1)), s, 8, false),
                times(b, Some((12, 1)), s, 8, false)
            );
            // The planted blur straddles a grid line on the even frame: two drawings in it.
            let planted = times(a, Some((12, 1)), s, 8, true);
            assert!(planted.iter().any(|&x| x < a) && planted.iter().any(|&x| x >= a));
        }
    }

    #[test]
    fn the_mean_is_taken_in_linear_light() {
        let (black, white) = (vec![0, 0, 0, 255], vec![255, 255, 255, 255]);
        // Half black, half white in linear light is 0.5, about 188 in sRGB, not 128.
        assert_eq!(average(&[black, white])[0], 188);
    }
}
