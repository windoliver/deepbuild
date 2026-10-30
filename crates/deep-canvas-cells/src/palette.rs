//! The palette rule (canvas primitives: The status-color rule; Cell grid `cells@1`): wherever
//! status can show, as on a session's page, a color a terminal cell asks for inside the look's
//! status distance of a status color becomes the nearest allowed color, so a cell never reads
//! as a verdict. Elsewhere, as in a plug-in's panel, the cell draws as the program asked.

use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
use deep_canvas::ops;

use crate::emulator::Color;

/// The xterm 16-color defaults, by ANSI index, as the palette's roles fall back to.
const ANSI: [[u8; 3]; 16] = [
    [0, 0, 0],
    [205, 49, 49],
    [13, 188, 121],
    [229, 229, 16],
    [36, 114, 200],
    [188, 63, 188],
    [17, 168, 205],
    [229, 229, 229],
    [102, 102, 102],
    [241, 76, 76],
    [35, 209, 139],
    [245, 245, 67],
    [59, 142, 234],
    [214, 112, 214],
    [41, 184, 219],
    [255, 255, 255],
];

/// A color the program asked for, as sRGB: a default is `fg` or `bg`, an index one of the 16
/// roles or xterm's 256-color cube and grays.
pub fn resolve(c: Color, default: [u8; 3]) -> [u8; 3] {
    match c {
        Color::Default => default,
        Color::Rgb(rgb) => rgb,
        Color::Indexed(i) if i < 16 => ANSI[usize::from(i)],
        Color::Indexed(i) if i < 232 => {
            let n = i - 16;
            let level = |v: u8| if v == 0 { 0 } else { 55 + v * 40 };
            [level(n / 36), level((n / 6) % 6), level(n % 6)]
        }
        Color::Indexed(i) => {
            let v = 8 + (i - 232) * 10;
            [v, v, v]
        }
    }
}

fn lab(rgb: [u8; 3]) -> Oklab {
    srgb_to_oklab(Srgb {
        r: f64::from(rgb[0]) / 255.0,
        g: f64::from(rgb[1]) / 255.0,
        b: f64::from(rgb[2]) / 255.0,
    })
}

fn distance(a: Oklab, b: Oklab) -> f64 {
    let (dl, da, db) = (a.l - b.l, a.a - b.a, a.b - b.b);
    ops::sqrt(dl * dl + da * da + db * db)
}

fn to_rgb(c: Oklab) -> [u8; 3] {
    let s = oklab_to_srgb(c);
    let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    [byte(s.r), byte(s.g), byte(s.b)]
}

/// `rgb` moved out to at least `min` (with a small margin, after rounding to bytes) from every
/// status color: pushed straight away from the nearest one it is inside, step by step, until no
/// status color is inside the distance. A color already outside them all stays as it is.
pub fn off_status(rgb: [u8; 3], status: &[[u8; 3]], min: f64) -> [u8; 3] {
    let target = min * 1.05;
    let inside = |c: [u8; 3]| {
        let p = lab(c);
        status
            .iter()
            .map(|s| (distance(p, lab(*s)), lab(*s)))
            .filter(|(d, _)| *d < target)
            .min_by(|a, b| a.0.total_cmp(&b.0))
    };
    let mut out = rgb;
    for _ in 0..64 {
        let Some((d, nearest)) = inside(out) else {
            return out;
        };
        let p = lab(out);
        // Away from the status color; from the color itself, lighter or darker by its ground.
        let (mut dl, mut da, mut db) = (p.l - nearest.l, p.a - nearest.a, p.b - nearest.b);
        if d < 1e-9 {
            (dl, da, db) = (if p.l < 0.5 { 1.0 } else { -1.0 }, 0.0, 0.0);
        }
        let n = ops::sqrt(dl * dl + da * da + db * db).max(1e-12);
        let step = target - d + 0.005;
        out = to_rgb(Oklab {
            l: p.l + dl / n * step,
            a: p.a + da / n * step,
            b: p.b + db / n * step,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAIL: [u8; 3] = [0xbf, 0x23, 0x2b];
    const PASS: [u8; 3] = [0x00, 0x74, 0x29];

    #[test]
    fn a_status_color_moves_just_outside_the_distance_and_others_stay() {
        let moved = off_status(FAIL, &[FAIL, PASS], 0.1);
        let d = distance(lab(moved), lab(FAIL));
        assert!((0.1..0.2).contains(&d), "{d}");
        assert!(distance(lab(moved), lab(PASS)) >= 0.1);
        assert_eq!(off_status([10, 10, 200], &[FAIL, PASS], 0.1), [10, 10, 200]);
    }

    #[test]
    fn the_cube_and_grays_resolve_as_xterm_draws_them() {
        assert_eq!(resolve(Color::Indexed(196), [0; 3]), [255, 0, 0]);
        assert_eq!(resolve(Color::Indexed(232), [0; 3]), [8, 8, 8]);
        assert_eq!(resolve(Color::Default, [1, 2, 3]), [1, 2, 3]);
    }
}
