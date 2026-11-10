//! Levels (Image `image@1`): a box reduction by 2^k in linear light, the smallest at or above the
//! drawn size, and the drift a level keeps through.

use std::sync::OnceLock;

use sha2::{Digest, Sha256};

/// The deepest level: past it any picture is 1 × 1.
pub const DEEPEST: u8 = 31;

/// One level of one picture: straight-alpha sRGB RGBA, row-major, and the sha256 of its stored
/// form (`blob`), which names it in the content store and in a frame's read set.
pub struct Level {
    pub size: [u32; 2],
    pub rgba: Vec<u8>,
    pub sha256: [u8; 32],
}

/// The tag a stored level starts with, before its width and height (u32, little-endian).
pub(crate) const TAG: &[u8; 4] = b"DLV1";

impl Level {
    /// A level of `rgba` at `size`, named by its stored form's hash.
    pub fn new(size: [u32; 2], rgba: Vec<u8>) -> Level {
        let mut hash = Sha256::new();
        hash.update(TAG);
        hash.update(size[0].to_le_bytes());
        hash.update(size[1].to_le_bytes());
        hash.update(&rgba);
        Level {
            size,
            rgba,
            sha256: hash.finalize().into(),
        }
    }

    /// The bytes it holds.
    pub fn bytes(&self) -> u64 {
        self.rgba.len() as u64
    }

    /// Its stored form: the tag, the size and the pixels.
    pub fn blob(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(12 + self.rgba.len());
        out.extend_from_slice(TAG);
        out.extend_from_slice(&self.size[0].to_le_bytes());
        out.extend_from_slice(&self.size[1].to_le_bytes());
        out.extend_from_slice(&self.rgba);
        out
    }

    /// A level read back from its stored form, if the form is whole.
    pub(crate) fn from_blob(blob: &[u8], sha256: [u8; 32]) -> Option<Level> {
        let rest = blob.strip_prefix(TAG.as_slice())?;
        let w = u32::from_le_bytes(rest.get(0..4)?.try_into().ok()?);
        let h = u32::from_le_bytes(rest.get(4..8)?.try_into().ok()?);
        let rgba = rest.get(8..)?;
        (rgba.len() as u64 == u64::from(w) * u64::from(h) * 4).then(|| Level {
            size: [w, h],
            rgba: rgba.to_vec(),
            sha256,
        })
    }
}

/// The size of level `k` of a picture of `source` px: each side divided by 2^k, rounded up.
pub fn level_size(source: [u32; 2], k: u8) -> [u32; 2] {
    source.map(|s| {
        let d = 1u64 << u32::from(k.min(DEEPEST));
        (u64::from(s).div_ceil(d).max(1)) as u32
    })
}

/// The level a picture of `source` px drawn at `drawn` device px takes: the smallest whose sides
/// are both at or above the drawn ones, or level 0 when the drawing is larger than the picture.
pub fn level_for(source: [u32; 2], drawn: [f64; 2]) -> u8 {
    let mut k = 0;
    while k < DEEPEST {
        let here = level_size(source, k);
        let next = level_size(source, k + 1);
        if next == here || f64::from(next[0]) < drawn[0] || f64::from(next[1]) < drawn[1] {
            break;
        }
        k += 1;
    }
    k
}

/// Whether a picture drawn at `drawn` device px keeps level `k`: while its drawn size stays within
/// 0.5× to 1.25× of the level's, so a smooth resize doesn't make a level per size.
pub fn keeps(k: u8, source: [u32; 2], drawn: [f64; 2]) -> bool {
    let [w, h] = level_size(source, k);
    let r = (drawn[0] / f64::from(w)).max(drawn[1] / f64::from(h));
    (0.5..=1.25).contains(&r)
}

/// sRGB codes to linear light, from the kernel's pinned transfer.
fn decoding() -> &'static [f32; 256] {
    static TABLE: OnceLock<[f32; 256]> = OnceLock::new();
    TABLE.get_or_init(|| {
        std::array::from_fn(|i| deep_canvas::color::srgb_decode(i as f64 / 255.0) as f32)
    })
}

/// The linear light at each midpoint between two neighbouring codes: a linear value encodes to the
/// number of midpoints at or below it, which is the pinned encode rounded to the nearest code.
fn midpoints() -> &'static [f32; 255] {
    static TABLE: OnceLock<[f32; 255]> = OnceLock::new();
    TABLE.get_or_init(|| {
        std::array::from_fn(|i| deep_canvas::color::srgb_decode((i as f64 + 0.5) / 255.0) as f32)
    })
}

fn encode(linear: f32) -> u8 {
    midpoints().partition_point(|m| *m <= linear) as u8
}

/// Level `k` of straight-alpha sRGB `rgba` at `size`: each output pixel the mean of its 2^k × 2^k
/// block (cut at the picture's edge) in linear light, its color weighted by alpha so a clear pixel
/// lends no color. Level 0 is the picture itself.
pub fn reduce(rgba: &[u8], size: [u32; 2], k: u8) -> Level {
    let out = level_size(size, k);
    if out == size {
        return Level::new(size, rgba.to_vec());
    }
    let [w, h] = size.map(|s| s as usize);
    let [ow, oh] = out.map(|s| s as usize);
    let shift = u32::from(k.min(DEEPEST));
    let lut = decoding();
    let mut pixels = vec![0u8; ow * oh * 4];
    // Sums in f64: a block at a deep level holds millions of pixels.
    let mut sums = vec![[0f64; 4]; ow];
    let mut counts = vec![0u32; ow];
    for oy in 0..oh {
        sums.fill([0.0; 4]);
        counts.fill(0);
        let rows = (oy << shift)..((oy + 1) << shift).min(h);
        for y in rows {
            let row = &rgba[y * w * 4..(y + 1) * w * 4];
            for (x, p) in row.chunks_exact(4).enumerate() {
                let s = &mut sums[x >> shift];
                let a = f64::from(p[3]) / 255.0;
                s[0] += f64::from(lut[usize::from(p[0])]) * a;
                s[1] += f64::from(lut[usize::from(p[1])]) * a;
                s[2] += f64::from(lut[usize::from(p[2])]) * a;
                s[3] += a;
                counts[x >> shift] += 1;
            }
        }
        let line = &mut pixels[oy * ow * 4..(oy + 1) * ow * 4];
        for ((o, s), n) in line.chunks_exact_mut(4).zip(&sums).zip(&counts) {
            if s[3] > 0.0 {
                o[0] = encode((s[0] / s[3]) as f32);
                o[1] = encode((s[1] / s[3]) as f32);
                o[2] = encode((s[2] / s[3]) as f32);
            }
            o[3] = (s[3] / f64::from(*n) * 255.0).round() as u8;
        }
    }
    Level::new(out, pixels)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat(size: [u32; 2], p: [u8; 4]) -> Vec<u8> {
        p.repeat((size[0] * size[1]) as usize)
    }

    #[test]
    fn a_flat_picture_stays_flat_at_every_level() {
        for size in [[1024, 640], [5, 3], [7, 1], [1, 9]] {
            for p in [
                [0, 0, 0, 255],
                [255, 255, 255, 255],
                [37, 140, 212, 255],
                [90, 20, 200, 128],
            ] {
                for k in 0..12 {
                    let l = reduce(&flat(size, p), size, k);
                    assert_eq!(l.size, level_size(size, k));
                    assert!(
                        l.rgba.chunks_exact(4).all(|q| q == p),
                        "{size:?} {p:?} level {k}"
                    );
                }
            }
        }
    }

    #[test]
    fn black_and_white_average_in_linear_light_not_in_codes() {
        // A 2 × 2 checker of 0 and 255: linear light averages to 0.5, which encodes to 187 or 188;
        // averaging the codes would give 127 or 128.
        let rgba: Vec<u8> = [
            [0, 0, 0, 255],
            [255, 255, 255, 255],
            [255, 255, 255, 255],
            [0, 0, 0, 255],
        ]
        .concat();
        let l = reduce(&rgba, [2, 2], 1);
        assert_eq!(l.size, [1, 1]);
        let want = (deep_canvas::color::srgb_encode(0.5) * 255.0).round() as u8;
        assert_eq!(&l.rgba[..3], &[want; 3]);
        assert!((187..=188).contains(&want));
    }

    #[test]
    fn a_clear_pixel_lends_no_color() {
        let rgba: Vec<u8> = [[255, 0, 0, 0], [0, 0, 255, 255]].concat();
        let l = reduce(&rgba, [2, 1], 1);
        assert_eq!(l.rgba, vec![0, 0, 255, 128]);
    }

    #[test]
    fn the_encode_is_the_pinned_one_rounded() {
        // Away from a tie between two codes (where f32 may round either way), exactly.
        for i in 0..=10_000 {
            let x = i as f64 / 10_000.0;
            let e = deep_canvas::color::srgb_encode(x) * 255.0;
            if (e.fract() - 0.5).abs() > 1e-3 {
                assert_eq!(encode(x as f32), e.round() as u8, "{x}");
            }
        }
    }

    #[test]
    fn an_edge_block_averages_only_what_it_holds() {
        // 3 × 1 at level 1: [a b] [c]; the second output pixel is c alone.
        let rgba: Vec<u8> = [[0, 0, 0, 255], [0, 0, 0, 255], [200, 100, 50, 255]].concat();
        let l = reduce(&rgba, [3, 1], 1);
        assert_eq!(l.size, [2, 1]);
        assert_eq!(&l.rgba[4..], &[200, 100, 50, 255]);
    }

    #[test]
    fn the_level_is_the_smallest_at_or_above_the_drawn_size() {
        // 1024 × 640 as a 120 px cover tile draws at 192 × 120: level 2 is 256 × 160, level 3 is
        // 128 × 80.
        assert_eq!(level_for([1024, 640], [192.0, 120.0]), 2);
        assert_eq!(level_for([1024, 640], [384.0, 240.0]), 1);
        assert_eq!(level_for([1024, 640], [2000.0, 1250.0]), 0);
        assert_eq!(level_for([1024, 640], [256.0, 160.0]), 2);
        assert_eq!(level_for([1024, 640], [256.5, 160.0]), 1);
        assert_eq!(
            level_size([1024, 640], level_for([1024, 640], [0.5, 0.5])),
            [1, 1]
        );
    }

    #[test]
    fn a_resize_of_1_2_times_at_1_percent_a_frame_keeps_its_level() {
        for start in [120.0, 150.0, 192.0, 255.0] {
            let source = [1024, 640];
            let k = level_for(source, [start, start * 0.625]);
            let mut d = start;
            while d <= start * 1.2 {
                assert!(keeps(k, source, [d, d * 0.625]), "start {start}: {d}");
                d *= 1.01;
            }
            let mut d = start;
            while d >= start / 1.2 && level_size(source, k)[0] as f64 * 0.5 <= d {
                assert!(keeps(k, source, [d, d * 0.625]));
                d /= 1.01;
            }
        }
        // Past the band either way, it lets go: above 1.25× and below 0.5× of level 2's 256 × 160.
        assert!(!keeps(2, [1024, 640], [330.0, 206.0]));
        assert!(keeps(2, [1024, 640], [128.0, 80.0]));
        assert!(!keeps(2, [1024, 640], [120.0, 75.0]));
    }

    #[test]
    fn a_stored_level_reads_back_whole() {
        let l = reduce(&flat([9, 5], [1, 2, 3, 4]), [9, 5], 1);
        let back = Level::from_blob(&l.blob(), l.sha256).expect("whole");
        assert_eq!((back.size, back.rgba), (l.size, l.rgba.clone()));
        assert_eq!(<[u8; 32]>::from(Sha256::digest(l.blob())), l.sha256);
        assert!(Level::from_blob(&l.blob()[..20], l.sha256).is_none());
    }
}
