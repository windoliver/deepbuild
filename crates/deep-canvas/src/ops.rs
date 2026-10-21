//! The one ops module: every transcendental the CPU math a check reads goes through here, on the
//! pinned `libm` crate, so results match across machines (technical design: Seeded and replayable;
//! canvas primitives: The closed function list).
//!
//! Nothing in this crate calls a std float method that is platform-dependent (`f64::sin`, `powf`,
//! `powi`, `exp`, `ln`, `sqrt`, `cbrt`, `hypot` and the rest); the lint lane refuses them. Exact
//! operations (`abs`, `floor`, `ceil`, `round`, `min`, `max`, `clamp` and plain arithmetic) stay
//! on the primitive type.
//!
//! Each wrapper is a one-liner over `libm`, kept here so the lint's allowlist has one entry.

/// π.
pub const PI: f64 = core::f64::consts::PI;
/// 2π.
pub const TAU: f64 = core::f64::consts::TAU;

/// Square root.
#[inline]
pub fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}

/// `x` raised to the real power `y`.
#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// `x` raised to the integer power `n`, by exponentiation by squaring.
///
/// This is chosen over `libm::pow` so an integer power is a fixed sequence of multiplies (and
/// one division for a negative `n`): the result is exactly the same rounding on every machine,
/// costs no transcendental, and matches the hand-expanded product a check would write
/// (`x * x * x` for `n = 3`, up to the order of the multiplies). `std`'s `f64::powi` is never
/// used; the lint plants it as a forbidden method.
#[inline]
pub fn powi(x: f64, n: i32) -> f64 {
    let mut base = x;
    let mut e = n.unsigned_abs();
    let mut acc = 1.0;
    while e > 0 {
        if e & 1 == 1 {
            acc *= base;
        }
        e >>= 1;
        if e > 0 {
            base *= base;
        }
    }
    if n < 0 {
        1.0 / acc
    } else {
        acc
    }
}

/// e raised to `x`.
#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

/// Natural logarithm.
#[inline]
pub fn log(x: f64) -> f64 {
    libm::log(x)
}

/// Base-2 logarithm.
#[inline]
pub fn log2(x: f64) -> f64 {
    libm::log2(x)
}

/// Base-10 logarithm.
#[inline]
pub fn log10(x: f64) -> f64 {
    libm::log10(x)
}

/// `ln(1 + x)`, accurate near zero.
#[inline]
pub fn log1p(x: f64) -> f64 {
    libm::log1p(x)
}

/// `exp(x) - 1`, accurate near zero.
#[inline]
pub fn expm1(x: f64) -> f64 {
    libm::expm1(x)
}

/// Sine, radians.
#[inline]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

/// Cosine, radians.
#[inline]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

/// Tangent, radians.
#[inline]
pub fn tan(x: f64) -> f64 {
    libm::tan(x)
}

/// Arcsine, radians.
#[inline]
pub fn asin(x: f64) -> f64 {
    libm::asin(x)
}

/// Arccosine, radians.
#[inline]
pub fn acos(x: f64) -> f64 {
    libm::acos(x)
}

/// Arctangent, radians.
#[inline]
pub fn atan(x: f64) -> f64 {
    libm::atan(x)
}

/// Four-quadrant arctangent of `y / x`, radians in (-π, π].
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// Hyperbolic sine.
#[inline]
pub fn sinh(x: f64) -> f64 {
    libm::sinh(x)
}

/// Hyperbolic cosine.
#[inline]
pub fn cosh(x: f64) -> f64 {
    libm::cosh(x)
}

/// Hyperbolic tangent.
#[inline]
pub fn tanh(x: f64) -> f64 {
    libm::tanh(x)
}

/// Inverse hyperbolic sine.
#[inline]
pub fn asinh(x: f64) -> f64 {
    libm::asinh(x)
}

/// Inverse hyperbolic cosine.
#[inline]
pub fn acosh(x: f64) -> f64 {
    libm::acosh(x)
}

/// Inverse hyperbolic tangent.
#[inline]
pub fn atanh(x: f64) -> f64 {
    libm::atanh(x)
}

/// `sqrt(x² + y²)` without intermediate overflow.
#[inline]
pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

/// Cube root, defined for negative input.
#[inline]
pub fn cbrt(x: f64) -> f64 {
    libm::cbrt(x)
}

/// Error function.
#[inline]
pub fn erf(x: f64) -> f64 {
    libm::erf(x)
}

/// Complementary error function.
#[inline]
pub fn erfc(x: f64) -> f64 {
    libm::erfc(x)
}

/// Gamma function (`gamma` in the closed function list).
#[inline]
pub fn tgamma(x: f64) -> f64 {
    libm::tgamma(x)
}

/// Natural logarithm of the absolute gamma function.
#[inline]
pub fn lgamma(x: f64) -> f64 {
    libm::lgamma(x)
}

/// Degrees to radians.
#[inline]
pub fn rad(degrees: f64) -> f64 {
    degrees * (PI / 180.0)
}

/// Radians to degrees.
#[inline]
pub fn deg(radians: f64) -> f64 {
    radians * (180.0 / PI)
}

/// `sin(x) / x`, with the removable singularity filled: 1 at 0.
#[inline]
pub fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        1.0
    } else {
        libm::sin(x) / x
    }
}

#[cfg(test)]
mod tests {
    // No `use` here: the canvas lint keeps every import out of the ops module, so each bare
    // attribute in it is a builtin and no macro can be handed a libm token. Items are reached
    // through `super::`, and each libm value is bound before any assertion sees it.
    use super as ops;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn powi_matches_repeated_multiply_and_handles_negative_and_zero() {
        assert_eq!(ops::powi(2.0, 0), 1.0);
        assert_eq!(ops::powi(2.0, 10), 1024.0);
        assert_eq!(ops::powi(3.0, 3), 27.0);
        assert_eq!(ops::powi(2.0, -2), 0.25);
        assert_eq!(ops::powi(-2.0, 3), -8.0);
        assert_eq!(ops::powi(0.0, 0), 1.0);
        assert_eq!(ops::powi(1.5, i32::MIN + 1), 0.0);
    }

    #[test]
    fn sinc_is_one_at_zero_and_sin_over_x_elsewhere() {
        assert_eq!(ops::sinc(0.0), 1.0);
        assert!(close(ops::sinc(ops::PI), 0.0, 1e-15));
        let sin_one = libm::sin(1.0);
        assert!(close(ops::sinc(1.0), sin_one, 0.0));
    }

    #[test]
    fn deg_rad_round_trip_and_constants() {
        assert!(close(ops::rad(180.0), ops::PI, 1e-15));
        assert!(close(ops::deg(ops::PI), 180.0, 1e-12));
        assert!(close(ops::deg(ops::rad(37.5)), 37.5, 1e-12));
        assert_eq!(ops::TAU, 2.0 * ops::PI);
    }

    #[test]
    fn wrappers_agree_with_libm() {
        let expected: [(f64, f64); 7] = [
            (ops::sqrt(2.0), libm::sqrt(2.0)),
            (ops::pow(2.0, 0.5), libm::pow(2.0, 0.5)),
            (ops::exp(1.0), libm::exp(1.0)),
            (ops::log(10.0), libm::log(10.0)),
            (ops::log1p(1e-10), libm::log1p(1e-10)),
            (ops::expm1(1e-10), libm::expm1(1e-10)),
            (ops::atan2(1.0, -1.0), libm::atan2(1.0, -1.0)),
        ];
        for (ours, theirs) in expected {
            assert_eq!(ours, theirs);
        }
        assert_eq!(ops::log2(8.0), 3.0);
        assert_eq!(ops::log10(1000.0), 3.0);
        assert_eq!(ops::hypot(3.0, 4.0), 5.0);
        assert_eq!(ops::cbrt(-27.0), -3.0);
        assert_eq!(ops::tgamma(5.0), 24.0);
        let log_24 = libm::log(24.0);
        assert!(close(ops::lgamma(5.0), log_24, 1e-14));
        assert!(close(ops::erf(0.5) + ops::erfc(0.5), 1.0, 1e-15));
        let (sinh, cosh, tanh) = (ops::sinh(0.3), ops::cosh(0.3), ops::tanh(0.3));
        assert!(close(cosh * cosh - sinh * sinh, 1.0, 1e-15));
        assert!(close(tanh, sinh / cosh, 1e-15));
        assert!(close(ops::asinh(ops::sinh(0.7)), 0.7, 1e-15));
        assert!(close(ops::acosh(ops::cosh(0.7)), 0.7, 1e-14));
        assert!(close(ops::atanh(ops::tanh(0.7)), 0.7, 1e-14));
        assert!(close(ops::asin(ops::sin(0.4)), 0.4, 1e-15));
        assert!(close(ops::acos(ops::cos(0.4)), 0.4, 1e-15));
        assert!(close(ops::atan(ops::tan(0.4)), 0.4, 1e-15));
    }
}
