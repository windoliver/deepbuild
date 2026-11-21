//! Issue #1250: a clip's and a still's bytes on an indexed look. The GIF's global color table is
//! the look's palette in index order and each frame's pixels are the index target's indices, each
//! drawn as `scale` × `scale` pixels, so every frame decodes to the played frame's colors exactly;
//! nothing is quantized again. Frames are taken at the play's rate halved until it is at most 50
//! a second, and each delay is in hundredths of a second with the remainder carried, so the
//! delays sum to the clip's length within one hundredth and none is under 2.

use std::borrow::Cow;

/// The most frames a second a GIF clip keeps.
pub const GIF_MOST: u32 = 50;
/// The shortest delay a GIF frame may carry, in hundredths: browsers slow shorter ones. The rate
/// rule keeps every delay at or above it.
#[cfg(test)]
const SHORTEST: u16 = 2;

/// The planted clips the acceptance criteria name, each only to prove its test fails on it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Plant {
    /// Every frame at the play's own rate, 60 a second, with delays of 1 and 2.
    EveryFrame,
    /// Colors re-quantized through a median cut to fewer entries than the palette holds.
    MedianCut,
}

/// The GIF's frame rate as a rational `[num, den]`: the play's, halved until at most 50 a second.
pub fn gif_rate(rate: [u32; 2], plant: Option<Plant>) -> [u32; 2] {
    let [num, mut den] = rate;
    if plant == Some(Plant::EveryFrame) {
        return rate;
    }
    while u64::from(num) > u64::from(GIF_MOST) * u64::from(den) {
        den *= 2;
    }
    [num, den]
}

/// Each of `n` frames' delays at `rate`, in hundredths with the remainder carried: frame k's is
/// ⌊100 (k + 1) / rate⌋ − ⌊100 k / rate⌋, so the first k delays sum to ⌊100 k / rate⌋.
pub fn delays(n: usize, rate: [u32; 2]) -> Vec<u16> {
    let at = |k: u64| k * 100 * u64::from(rate[1]) / u64::from(rate[0]);
    (0..n as u64).map(|k| (at(k + 1) - at(k)) as u16).collect()
}

/// The palette as the GIF's and PNG's table: `[r, g, b]` per index, in index order.
fn table(palette: &[[u8; 3]]) -> Vec<u8> {
    palette.iter().flatten().copied().collect()
}

/// One index frame of `w` × `h` drawn at `scale` by nearest.
pub fn upscale(indices: &[u8], w: usize, h: usize, scale: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(w * h * scale * scale);
    for row in indices.chunks_exact(w).take(h) {
        let wide: Vec<u8> = row
            .iter()
            .flat_map(|i| std::iter::repeat_n(*i, scale))
            .collect();
        for _ in 0..scale {
            out.extend_from_slice(&wide);
        }
    }
    out
}

/// The planted median cut: the palette's colors split into boxes along their widest channel
/// until there are `boxes`, each index mapped to its box's first entry, so colors that share a
/// box become one. A 16-color frame cut to 8 loses at least one color.
fn median_cut(palette: &[[u8; 3]], boxes: usize) -> Vec<u8> {
    let mut parts: Vec<Vec<usize>> = vec![(0..palette.len()).collect()];
    while parts.len() < boxes {
        let Some((at, _)) = parts.iter().enumerate().max_by_key(|(_, p)| p.len()) else {
            break;
        };
        let mut part = parts.swap_remove(at);
        if part.len() < 2 {
            parts.push(part);
            break;
        }
        let spread = |c: usize| {
            let v = part.iter().map(|i| palette[*i][c]);
            v.clone().max().unwrap_or(0) - v.min().unwrap_or(0)
        };
        let c = (0..3).max_by_key(|c| spread(*c)).unwrap_or(0);
        part.sort_by_key(|i| palette[*i][c]);
        let rest = part.split_off(part.len() / 2);
        parts.push(part);
        parts.push(rest);
    }
    let mut map = vec![0u8; palette.len()];
    for p in &parts {
        for i in p {
            map[*i] = p[0] as u8;
        }
    }
    map
}

/// A GIF of `frames` (each `w` × `h` palette indices) drawn at `scale`, looping forever, its
/// global color table `palette` in index order and its delays `delays`.
pub fn gif(
    frames: &[Cow<'_, [u8]>],
    [w, h]: [usize; 2],
    scale: usize,
    palette: &[[u8; 3]],
    delays: &[u16],
    plant: Option<Plant>,
) -> Result<Vec<u8>, String> {
    let (sw, sh) = (w * scale, h * scale);
    let (gw, gh) = (
        u16::try_from(sw).map_err(|_| "the clip is too wide for a GIF")?,
        u16::try_from(sh).map_err(|_| "the clip is too tall for a GIF")?,
    );
    let mut out = Vec::new();
    {
        let mut enc =
            gif::Encoder::new(&mut out, gw, gh, &table(palette)).map_err(|e| e.to_string())?;
        enc.set_repeat(gif::Repeat::Infinite)
            .map_err(|e| e.to_string())?;
        let cut = (plant == Some(Plant::MedianCut)).then(|| median_cut(palette, 8));
        for (frame, delay) in frames.iter().zip(delays) {
            let mut px = upscale(frame, w, h, scale);
            if let Some(map) = &cut {
                px.iter_mut().for_each(|i| *i = map[usize::from(*i)]);
            }
            let mut f = gif::Frame::from_indexed_pixels(gw, gh, px, None);
            f.delay = *delay;
            enc.write_frame(&f).map_err(|e| e.to_string())?;
        }
    }
    Ok(out)
}

/// An indexed PNG of one index frame drawn at `scale`, its palette `palette` in index order.
pub fn indexed_png(
    indices: &[u8],
    [w, h]: [usize; 2],
    scale: usize,
    palette: &[[u8; 3]],
) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, (w * scale) as u32, (h * scale) as u32);
        enc.set_color(png::ColorType::Indexed);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_palette(table(palette));
        let mut wr = enc.write_header().map_err(|e| e.to_string())?;
        wr.write_image_data(&upscale(indices, w, h, scale))
            .map_err(|e| e.to_string())?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixty_a_second_gives_thirty_with_delays_of_three_three_four() {
        let rate = gif_rate([60, 1], None);
        assert_eq!(rate, [60, 2]);
        let d = delays(300, rate);
        assert_eq!(&d[..6], &[3, 3, 4, 3, 3, 4]);
        assert_eq!(d.iter().map(|d| u32::from(*d)).sum::<u32>(), 1000);
        assert!(d.iter().all(|d| *d >= SHORTEST));
    }

    #[test]
    fn rates_at_or_under_fifty_keep_every_frame_and_odd_rates_carry() {
        assert_eq!(gif_rate([50, 1], None), [50, 1]);
        assert_eq!(gif_rate([120, 1], None), [120, 4]);
        let d = delays(48, [48, 1]);
        assert_eq!(d.iter().map(|d| u32::from(*d)).sum::<u32>(), 100);
        assert!(d.iter().all(|d| *d >= SHORTEST));
        let ntsc = gif_rate([60000, 1001], None);
        let d = delays(300, ntsc);
        let sum: u32 = d.iter().map(|d| u32::from(*d)).sum();
        assert_eq!(sum, (300u64 * 100 * 2002 / 60000) as u32);
    }

    #[test]
    fn the_planted_every_frame_clip_has_delays_under_two() {
        let d = delays(4, gif_rate([60, 1], Some(Plant::EveryFrame)));
        assert_eq!(d, [1, 2, 2, 1]);
    }

    #[test]
    fn the_median_cut_merges_colors_of_a_sixteen_color_palette() {
        let palette: Vec<[u8; 3]> = (0..16).map(|i| [i * 16, 255 - i * 16, i * 8]).collect();
        let map = median_cut(&palette, 8);
        assert!(map.iter().enumerate().any(|(i, m)| usize::from(*m) != i));
    }
}
