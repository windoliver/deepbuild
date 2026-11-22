//! #1488: a video frame's planes turned as its track header's matrix shows it (`mp4::Track`'s
//! `rotation`), so a phone's portrait clip draws upright with its width and height swapped.

/// `plane` (`w` × `h` elements of `size` bytes, rows top-down) turned `rotation` degrees clockwise.
fn plane(plane: &[u8], (w, h): (usize, usize), size: usize, rotation: u16) -> Vec<u8> {
    if rotation == 0 || plane.len() < w * h * size {
        return plane.to_vec();
    }
    let mut out = vec![0u8; w * h * size];
    let ow = if rotation == 180 { w } else { h };
    for y in 0..h {
        for x in 0..w {
            let (ox, oy) = match rotation {
                90 => (h - 1 - y, x),
                180 => (w - 1 - x, h - 1 - y),
                _ => (y, w - 1 - x),
            };
            let (from, to) = ((y * w + x) * size, (oy * ow + ox) * size);
            out[to..to + size].copy_from_slice(&plane[from..from + size]);
        }
    }
    out
}

/// The size a `w` × `h` picture shows at, turned `rotation` degrees.
pub fn size(w: usize, h: usize, rotation: u16) -> (usize, usize) {
    match rotation {
        90 | 270 => (h, w),
        _ => (w, h),
    }
}

/// 8-bit 4:2:0 planes (Y, Cb, Cr) of a `w` × `h` frame, turned.
pub fn i420(planes: &[u8], w: usize, h: usize, rotation: u16) -> Vec<u8> {
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    if rotation == 0 || planes.len() < w * h + 2 * cw * ch {
        return planes.to_vec();
    }
    let (y, rest) = planes.split_at(w * h);
    let (u, v) = rest.split_at(cw * ch);
    [
        plane(y, (w, h), 1, rotation),
        plane(u, (cw, ch), 1, rotation),
        plane(&v[..cw * ch], (cw, ch), 1, rotation),
    ]
    .concat()
}

/// NV12 planes (Y, then Cb and Cr interleaved) of a `w` × `h` frame, `w` and `h` even, turned.
pub fn nv12(planes: &[u8], w: usize, h: usize, rotation: u16) -> Vec<u8> {
    if rotation == 0 || planes.len() < w * h * 3 / 2 {
        return planes.to_vec();
    }
    let (y, uv) = planes.split_at(w * h);
    [
        plane(y, (w, h), 1, rotation),
        plane(uv, (w / 2, h / 2), 2, rotation),
    ]
    .concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quarter_turn_puts_the_top_row_on_the_right_edge() {
        // 3 × 2: top row 1 2 3, bottom row 4 5 6; turned it is 2 × 3: 4 1 / 5 2 / 6 3.
        let p = [1, 2, 3, 4, 5, 6];
        assert_eq!(plane(&p, (3, 2), 1, 90), [4, 1, 5, 2, 6, 3]);
        assert_eq!(plane(&p, (3, 2), 1, 180), [6, 5, 4, 3, 2, 1]);
        assert_eq!(plane(&p, (3, 2), 1, 270), [3, 6, 2, 5, 1, 4]);
        assert_eq!(size(3, 2, 90), (2, 3));
    }
}
