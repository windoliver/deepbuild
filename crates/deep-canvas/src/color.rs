//! Color spaces the check reads: sRGB (encoded), linear sRGB, OKLab and OKLCh, all in f64 with
//! every transcendental through [`crate::ops`] on pinned libm.
//!
//! The sRGB transfer is the piecewise curve of IEC 61966-2-1 (thresholds 0.0031308 and 0.04045,
//! slope 12.92, offset 0.055 over 1.055, exponent 2.4). Linear sRGB ↔ OKLab uses Björn
//! Ottosson's published matrices (<https://bottosson.github.io/posts/oklab/>), the same ones the
//! `palette` and `bevy_color` crates carry: M1 to LMS, a cube root, M2 to Lab; and back with the
//! published inverses. The cube root is [`crate::ops::cbrt`], never `pow(x, 1/3)`, so negative
//! LMS (out-of-gamut input) stays defined and the result is the same on every machine.
//!
//! OKLCh is OKLab in polar form: `c = hypot(a, b)`, `h = atan2(b, a)` in degrees in `[0, 360)`.

use crate::ops;

/// Linear-light sRGB, components nominally in `[0, 1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LinearRgb {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

/// Transfer-encoded sRGB, components nominally in `[0, 1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Srgb {
    pub r: f64,
    pub g: f64,
    pub b: f64,
}

/// OKLab: perceptual lightness `l` in `[0, 1]`, opponent axes `a` and `b`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Oklab {
    pub l: f64,
    pub a: f64,
    pub b: f64,
}

/// OKLCh: OKLab in polar form, hue `h` in degrees in `[0, 360)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Oklch {
    pub l: f64,
    pub c: f64,
    pub h: f64,
}

/// Encodes one linear-light sRGB component.
#[inline]
pub fn srgb_encode(linear: f64) -> f64 {
    if linear <= 0.0031308 {
        12.92 * linear
    } else {
        1.055 * ops::pow(linear, 1.0 / 2.4) - 0.055
    }
}

/// Decodes one transfer-encoded sRGB component to linear light.
#[inline]
pub fn srgb_decode(encoded: f64) -> f64 {
    if encoded <= 0.04045 {
        encoded / 12.92
    } else {
        ops::pow((encoded + 0.055) / 1.055, 2.4)
    }
}

/// Encoded sRGB to linear sRGB.
#[inline]
pub fn srgb_to_linear(c: Srgb) -> LinearRgb {
    LinearRgb {
        r: srgb_decode(c.r),
        g: srgb_decode(c.g),
        b: srgb_decode(c.b),
    }
}

/// Linear sRGB to encoded sRGB.
#[inline]
pub fn linear_to_srgb(c: LinearRgb) -> Srgb {
    Srgb {
        r: srgb_encode(c.r),
        g: srgb_encode(c.g),
        b: srgb_encode(c.b),
    }
}

/// Linear sRGB to OKLab: M1 to LMS, cube root, M2 to Lab.
pub fn linear_to_oklab(c: LinearRgb) -> Oklab {
    let l = 0.412_221_470_8 * c.r + 0.536_332_536_3 * c.g + 0.051_445_992_9 * c.b;
    let m = 0.211_903_498_2 * c.r + 0.680_699_545_1 * c.g + 0.107_396_956_6 * c.b;
    let s = 0.088_302_461_9 * c.r + 0.281_718_837_6 * c.g + 0.629_978_700_5 * c.b;

    let l_ = ops::cbrt(l);
    let m_ = ops::cbrt(m);
    let s_ = ops::cbrt(s);

    Oklab {
        l: 0.210_454_255_3 * l_ + 0.793_617_785_0 * m_ - 0.004_072_046_8 * s_,
        a: 1.977_998_495_1 * l_ - 2.428_592_205_0 * m_ + 0.450_593_709_9 * s_,
        b: 0.025_904_037_1 * l_ + 0.782_771_766_2 * m_ - 0.808_675_766_0 * s_,
    }
}

/// OKLab to linear sRGB: inverse M2 to cube-rooted LMS, cube, inverse M1 to RGB.
///
/// The inverses here are the exact f64 inverses of the forward matrices above (Gauss-Jordan in
/// f64, 17 digits), not the published ones rounded to ten digits: with the published inverses
/// the round trip sRGB → OKLab → sRGB is off by up to 1.3e-6 at pure green, past the 1e-6 the
/// #389 fixture holds the inverse to; with the exact inverses it is within 1e-15.
pub fn oklab_to_linear(c: Oklab) -> LinearRgb {
    let l_ = 0.999_999_998_450_519_7 * c.l
        + 0.396_337_792_173_767_8 * c.a
        + 0.215_803_758_060_758_77 * c.b;
    let m_ = 1.000_000_008_881_760_7 * c.l
        - 0.105_561_342_323_656_33 * c.a
        - 0.063_854_174_771_705_88 * c.b;
    let s_ = 1.000_000_054_672_410_6 * c.l
        - 0.089_484_182_094_965_74 * c.a
        - 1.291_485_537_864_091_7 * c.b;

    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;

    LinearRgb {
        r: 4.076_741_661_347_994 * l - 3.307_711_590_408_193_7 * m + 0.230_969_928_729_427_81 * s,
        g: -1.268_438_004_092_176_3 * l + 2.609_757_400_663_372 * m - 0.341_319_396_310_219_57 * s,
        b: -0.004_196_086_541_837_074 * l - 0.703_418_614_459_449_5 * m
            + 1.707_614_700_930_944_6 * s,
    }
}

/// OKLab to OKLCh. Hue is in degrees in `[0, 360)`; a gray (`a = b = 0`) has hue 0.
pub fn oklab_to_oklch(c: Oklab) -> Oklch {
    let chroma = ops::hypot(c.a, c.b);
    let mut h = ops::deg(ops::atan2(c.b, c.a));
    if h < 0.0 {
        h += 360.0;
    }
    if h >= 360.0 {
        h = 0.0;
    }
    Oklch {
        l: c.l,
        c: chroma,
        h,
    }
}

/// OKLCh to OKLab.
pub fn oklch_to_oklab(c: Oklch) -> Oklab {
    let h = ops::rad(c.h);
    Oklab {
        l: c.l,
        a: c.c * ops::cos(h),
        b: c.c * ops::sin(h),
    }
}

/// Encoded sRGB to OKLab.
#[inline]
pub fn srgb_to_oklab(c: Srgb) -> Oklab {
    linear_to_oklab(srgb_to_linear(c))
}

/// OKLab to encoded sRGB.
#[inline]
pub fn oklab_to_srgb(c: Oklab) -> Srgb {
    linear_to_srgb(oklab_to_linear(c))
}

/// Encoded sRGB to OKLCh.
#[inline]
pub fn srgb_to_oklch(c: Srgb) -> Oklch {
    oklab_to_oklch(srgb_to_oklab(c))
}

/// OKLCh to encoded sRGB.
#[inline]
pub fn oklch_to_srgb(c: Oklch) -> Srgb {
    oklab_to_srgb(oklch_to_oklab(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    /// Hue distance modulo 360, in degrees.
    fn hue_distance(a: f64, b: f64) -> f64 {
        let d = (a - b).abs() % 360.0;
        d.min(360.0 - d)
    }

    #[test]
    fn srgb_transfer_is_continuous_at_the_knee_and_inverts() {
        let knee = 0.0031308;
        assert!(close(srgb_encode(knee), 12.92 * knee, 2e-4));
        assert!(close(srgb_decode(0.04045), 0.04045 / 12.92, 2e-5));
        for i in 0..=100 {
            let x = i as f64 / 100.0;
            assert!(close(srgb_decode(srgb_encode(x)), x, 1e-12), "x = {x}");
        }
        assert_eq!(srgb_encode(0.0), 0.0);
        assert!(close(srgb_encode(1.0), 1.0, 1e-15));
    }

    #[test]
    fn white_maps_to_lightness_one_with_no_chroma() {
        let lab = srgb_to_oklab(Srgb {
            r: 1.0,
            g: 1.0,
            b: 1.0,
        });
        assert!(close(lab.l, 1.0, 1e-6), "l = {}", lab.l);
        assert!(close(lab.a, 0.0, 1e-6), "a = {}", lab.a);
        assert!(close(lab.b, 0.0, 1e-6), "b = {}", lab.b);
    }

    #[test]
    fn black_maps_to_zero() {
        let lab = srgb_to_oklab(Srgb {
            r: 0.0,
            g: 0.0,
            b: 0.0,
        });
        assert_eq!(lab.l, 0.0);
        assert_eq!(lab.a, 0.0);
        assert_eq!(lab.b, 0.0);
        let lch = oklab_to_oklch(lab);
        assert_eq!(lch.c, 0.0);
        assert_eq!(lch.h, 0.0);
    }

    /// A small fixed-seed xorshift so the grid is the same on every run.
    fn seeded_unit(state: &mut u64) -> f64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        (*state >> 11) as f64 / (1u64 << 53) as f64
    }

    #[test]
    fn seeded_srgb_grid_round_trips_through_oklab_and_oklch() {
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        let mut cases = Vec::new();
        for ri in 0..=4 {
            for gi in 0..=4 {
                for bi in 0..=4 {
                    cases.push(Srgb {
                        r: ri as f64 / 4.0,
                        g: gi as f64 / 4.0,
                        b: bi as f64 / 4.0,
                    });
                }
            }
        }
        for _ in 0..200 {
            cases.push(Srgb {
                r: seeded_unit(&mut state),
                g: seeded_unit(&mut state),
                b: seeded_unit(&mut state),
            });
        }
        // The inverses are the exact f64 inverses of the forward matrices, so the round trip
        // is f64 arithmetic alone. The published ten-digit inverses would fail this bound at
        // pure green (1.29e-6 measured over this grid).
        const ROUND_TRIP: f64 = 1e-9;
        for c in cases {
            let via_lab = oklab_to_srgb(srgb_to_oklab(c));
            assert!(
                close(via_lab.r, c.r, ROUND_TRIP),
                "lab r: {c:?} -> {via_lab:?}"
            );
            assert!(
                close(via_lab.g, c.g, ROUND_TRIP),
                "lab g: {c:?} -> {via_lab:?}"
            );
            assert!(
                close(via_lab.b, c.b, ROUND_TRIP),
                "lab b: {c:?} -> {via_lab:?}"
            );
            let via_lch = oklch_to_srgb(srgb_to_oklch(c));
            assert!(
                close(via_lch.r, c.r, ROUND_TRIP),
                "lch r: {c:?} -> {via_lch:?}"
            );
            assert!(
                close(via_lch.g, c.g, ROUND_TRIP),
                "lch g: {c:?} -> {via_lch:?}"
            );
            assert!(
                close(via_lch.b, c.b, ROUND_TRIP),
                "lch b: {c:?} -> {via_lch:?}"
            );
        }
    }

    #[test]
    fn near_black_round_trips() {
        let cases = [
            Srgb {
                r: 1e-5,
                g: 1e-5,
                b: 1e-5,
            },
            Srgb {
                r: 1e-5,
                g: 0.0,
                b: 0.0,
            },
            Srgb {
                r: 0.0,
                g: 2e-5,
                b: 1e-5,
            },
        ];
        for c in cases {
            let back = oklch_to_srgb(srgb_to_oklch(c));
            assert!(close(back.r, c.r, 1e-9), "{c:?} -> {back:?}");
            assert!(close(back.g, c.g, 1e-9), "{c:?} -> {back:?}");
            assert!(close(back.b, c.b, 1e-9), "{c:?} -> {back:?}");
        }
    }

    #[test]
    fn hue_is_normalized_to_a_half_open_turn_and_compares_modulo_360() {
        let high = oklab_to_oklch(oklch_to_oklab(Oklch {
            l: 0.6,
            c: 0.1,
            h: 359.99,
        }));
        let low = oklab_to_oklch(oklch_to_oklab(Oklch {
            l: 0.6,
            c: 0.1,
            h: 0.01,
        }));
        assert!((0.0..360.0).contains(&high.h), "h = {}", high.h);
        assert!((0.0..360.0).contains(&low.h), "h = {}", low.h);
        assert!(close(high.h, 359.99, 1e-9), "h = {}", high.h);
        assert!(close(low.h, 0.01, 1e-9), "h = {}", low.h);
        assert!(close(hue_distance(high.h, low.h), 0.02, 1e-9));

        // Exactly on the negative-a axis and just below it: 180 and just under 360.
        let on_axis = oklab_to_oklch(Oklab {
            l: 0.5,
            a: -0.1,
            b: 0.0,
        });
        assert!(close(on_axis.h, 180.0, 1e-12));
        let just_below_zero = oklab_to_oklch(Oklab {
            l: 0.5,
            a: 0.1,
            b: -1e-12,
        });
        assert!(just_below_zero.h < 360.0 && just_below_zero.h > 359.0);
        let wrapped = oklab_to_oklch(Oklab {
            l: 0.5,
            a: 0.1,
            b: -0.0,
        });
        assert_eq!(wrapped.h, 0.0);
    }
}
