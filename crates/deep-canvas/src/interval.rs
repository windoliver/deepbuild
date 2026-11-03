//! Interval forms of the closed function list (canvas primitives: The closed function list): each
//! returns a range certain to hold its function's value over a range of its inputs, in the same
//! pinned math as the point forms in [`crate::ops`].
//!
//! Each form bounds its function by its monotone pieces and known extrema, widens that by its
//! implementation's error bound (`ulps` below, in units in the last place) and rounds its lower
//! end down and its upper end up. Arithmetic rounds outward by one ulp, since a correctly rounded
//! result is within half of one. A function undefined over part of its range (log below 0) is
//! bounded over the part it is defined on; over none of it, the form is [`Iv::EMPTY`]. A pole
//! inside the range gives an unbounded side. Seeded tests only search these for counterexamples;
//! the certainty is the construction's.

use crate::ops;

/// A closed range `[lo, hi]` of f64; `lo > hi` is empty, and an infinite end is unbounded.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Iv {
    pub lo: f64,
    pub hi: f64,
}

/// Error bound of a libm transcendental, in ulps; libm's own are under 1 for the elementary
/// functions, so 2 holds with a margin.
const ULPS: u32 = 2;
/// Error bound of libm's gamma, lgamma, erf and erfc, looser by design.
const ULPS_SPECIAL: u32 = 16;

/// `x` rounded down `n` ulps (never past −∞).
pub fn down(x: f64, n: u32) -> f64 {
    let mut v = x;
    for _ in 0..n {
        v = v.next_down();
    }
    v
}

/// `x` rounded up `n` ulps (never past +∞).
pub fn up(x: f64, n: u32) -> f64 {
    let mut v = x;
    for _ in 0..n {
        v = v.next_up();
    }
    v
}

// The arithmetic is methods, not the std operator traits, so each call reads as the outward
// rounding it is.
#[allow(clippy::should_implement_trait)]
/// `a + b` rounded, and the exact error left: a + b = s + e (Knuth's TwoSum).
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let bb = s - a;
    (s, (a - (s - bb)) + (b - bb))
}

/// `a × b` rounded, and the exact error left (Dekker's TwoProduct, by splitting, with no fused
/// multiply-add); `None` where a split could overflow.
fn two_prod(a: f64, b: f64) -> Option<(f64, f64)> {
    let p = a * b;
    if !p.is_finite() || a.abs() > 1e290 || b.abs() > 1e290 || (a != 0.0 && b != 0.0 && p.abs() < 1e-290) {
        return None;
    }
    let split = |x: f64| {
        let c = 134_217_729.0 * x;
        let hi = c - (c - x);
        (hi, x - hi)
    };
    let ((ah, al), (bh, bl)) = (split(a), split(b));
    let e = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
    Some((p, e))
}

/// The ends of a rounded result `v` with exact error `e`: down where the true value lies below.
fn lower(v: f64, e: Option<f64>) -> f64 {
    match e {
        Some(e) if e >= 0.0 => v,
        _ => down(v, 1),
    }
}

fn upper(v: f64, e: Option<f64>) -> f64 {
    match e {
        Some(e) if e <= 0.0 => v,
        _ => up(v, 1),
    }
}

impl Iv {
    pub const EMPTY: Iv = Iv {
        lo: f64::INFINITY,
        hi: f64::NEG_INFINITY,
    };
    pub const ENTIRE: Iv = Iv {
        lo: f64::NEG_INFINITY,
        hi: f64::INFINITY,
    };

    pub fn new(lo: f64, hi: f64) -> Iv {
        if lo.is_nan() || hi.is_nan() {
            return Iv::ENTIRE;
        }
        Iv { lo, hi }
    }

    /// The point `x` (a NaN is empty: no value).
    pub fn point(x: f64) -> Iv {
        if x.is_nan() {
            Iv::EMPTY
        } else {
            Iv { lo: x, hi: x }
        }
    }

    pub fn is_empty(&self) -> bool {
        self.lo.partial_cmp(&self.hi).is_none_or(|o| o == std::cmp::Ordering::Greater)
    }

    /// Both ends finite.
    pub fn is_bounded(&self) -> bool {
        self.lo.is_finite() && self.hi.is_finite()
    }

    pub fn contains(&self, x: f64) -> bool {
        self.lo <= x && x <= self.hi
    }

    pub fn width(&self) -> f64 {
        self.hi - self.lo
    }

    /// The smallest range holding both.
    pub fn hull(self, o: Iv) -> Iv {
        if self.is_empty() {
            return o;
        }
        if o.is_empty() {
            return self;
        }
        Iv {
            lo: self.lo.min(o.lo),
            hi: self.hi.max(o.hi),
        }
    }

    /// The overlap of both.
    pub fn meet(self, o: Iv) -> Iv {
        let r = Iv {
            lo: self.lo.max(o.lo),
            hi: self.hi.min(o.hi),
        };
        if r.is_empty() {
            Iv::EMPTY
        } else {
            r
        }
    }

    /// Widened by `n` ulps each side.
    pub fn widen(self, n: u32) -> Iv {
        if self.is_empty() {
            return self;
        }
        Iv {
            lo: down(self.lo, n),
            hi: up(self.hi, n),
        }
    }

    /// The hull of `values` (NaNs left out), widened by `n` ulps.
    fn of(values: &[f64], n: u32) -> Iv {
        let mut r = Iv::EMPTY;
        for &v in values {
            r = r.hull(Iv::point(v));
        }
        r.widen(n)
    }

    // ---- arithmetic, rounded outward by one ulp

    pub fn neg(self) -> Iv {
        if self.is_empty() {
            return self;
        }
        Iv {
            lo: -self.hi,
            hi: -self.lo,
        }
    }

    pub fn add(self, o: Iv) -> Iv {
        if self.is_empty() || o.is_empty() {
            return Iv::EMPTY;
        }
        // Each end moves only past a rounding it took, so an exact sum stays exact.
        let (l, el) = two_sum(self.lo, o.lo);
        let (h, eh) = two_sum(self.hi, o.hi);
        let fin = |v: f64, e: f64| (v.is_finite() && e.is_finite()).then_some(e);
        Iv::new(lower(l, fin(l, el)), upper(h, fin(h, eh)))
    }

    pub fn sub(self, o: Iv) -> Iv {
        self.add(o.neg())
    }

    pub fn mul(self, o: Iv) -> Iv {
        if self.is_empty() || o.is_empty() {
            return Iv::EMPTY;
        }
        if self == Iv::point(0.0) || o == Iv::point(0.0) {
            return Iv::point(0.0);
        }
        // 0 × ∞ is taken as 0: a factor exactly 0 zeroes the product wherever the other is
        // finite. Each corner's ends move only past a rounding it took.
        let corner = |a: f64, b: f64| -> (f64, f64) {
            let v = a * b;
            if v.is_nan() {
                return (0.0, 0.0);
            }
            match two_prod(a, b) {
                Some((p, e)) => (lower(p, Some(e)), upper(p, Some(e))),
                None if v.is_infinite() => (v, v),
                None => (down(v, 1), up(v, 1)),
            }
        };
        let c = [
            corner(self.lo, o.lo),
            corner(self.lo, o.hi),
            corner(self.hi, o.lo),
            corner(self.hi, o.hi),
        ];
        let lo = c.iter().map(|x| x.0).fold(f64::INFINITY, f64::min);
        let hi = c.iter().map(|x| x.1).fold(f64::NEG_INFINITY, f64::max);
        Iv::new(lo, hi)
    }

    /// The reciprocal: unbounded when the range holds 0, unless 0 is one of its ends.
    pub fn recip(self) -> Iv {
        if self.is_empty() {
            return self;
        }
        if self == Iv::point(0.0) {
            return Iv::EMPTY;
        }
        if self.lo > 0.0 || self.hi < 0.0 {
            return Iv::new(down(1.0 / self.hi, 1), up(1.0 / self.lo, 1));
        }
        if self.lo == 0.0 {
            return Iv::new(down(1.0 / self.hi, 1), f64::INFINITY);
        }
        if self.hi == 0.0 {
            return Iv::new(f64::NEG_INFINITY, up(1.0 / self.lo, 1));
        }
        Iv::ENTIRE
    }

    pub fn div(self, o: Iv) -> Iv {
        self.mul(o.recip())
    }

    pub fn abs(self) -> Iv {
        if self.is_empty() || self.lo >= 0.0 {
            return self;
        }
        if self.hi <= 0.0 {
            return self.neg();
        }
        Iv {
            lo: 0.0,
            hi: self.hi.max(-self.lo),
        }
    }

    pub fn min(self, o: Iv) -> Iv {
        if self.is_empty() || o.is_empty() {
            return Iv::EMPTY;
        }
        Iv {
            lo: self.lo.min(o.lo),
            hi: self.hi.min(o.hi),
        }
    }

    pub fn max(self, o: Iv) -> Iv {
        if self.is_empty() || o.is_empty() {
            return Iv::EMPTY;
        }
        Iv {
            lo: self.lo.max(o.lo),
            hi: self.hi.max(o.hi),
        }
    }

    pub fn clamp(self, lo: Iv, hi: Iv) -> Iv {
        self.max(lo).min(hi)
    }

    /// The square, which never dips below 0.
    pub fn sqr(self) -> Iv {
        let a = self.abs();
        if a.is_empty() {
            return a;
        }
        Iv::new(down(a.lo * a.lo, 1), up(a.hi * a.hi, 1))
    }

    /// `self` to the integer power `n`, by its monotone pieces.
    pub fn powi(self, n: i32) -> Iv {
        if self.is_empty() {
            return self;
        }
        if n == 0 {
            return Iv::point(1.0);
        }
        if n < 0 {
            return self.powi(-n).recip();
        }
        // Repeated squaring compounds its roundings: within about n ulps, held with a margin.
        let err = n.unsigned_abs() + 4;
        let f = |x: f64| ops::powi(x, n);
        if n % 2 == 1 {
            return Iv::new(down(f(self.lo), err), up(f(self.hi), err));
        }
        let a = self.abs();
        Iv::new(down(f(a.lo), err).max(0.0), up(f(a.hi), err))
    }
}

/// An increasing function's form over `x` met with its domain `dom`.
fn increasing(x: Iv, dom: Iv, f: fn(f64) -> f64, n: u32) -> Iv {
    let x = x.meet(dom);
    if x.is_empty() {
        return Iv::EMPTY;
    }
    Iv::new(down(f(x.lo), n), up(f(x.hi), n))
}

/// A decreasing function's form over `x` met with its domain `dom`.
fn decreasing(x: Iv, dom: Iv, f: fn(f64) -> f64, n: u32) -> Iv {
    let x = x.meet(dom);
    if x.is_empty() {
        return Iv::EMPTY;
    }
    Iv::new(down(f(x.hi), n), up(f(x.lo), n))
}

const ALL: Iv = Iv::ENTIRE;
const POS: Iv = Iv {
    lo: 0.0,
    hi: f64::INFINITY,
};

pub fn sqrt(x: Iv) -> Iv {
    let r = increasing(x, POS, ops::sqrt, 1);
    Iv::new(r.lo.max(0.0), r.hi)
}

pub fn cbrt(x: Iv) -> Iv {
    increasing(x, ALL, ops::cbrt, ULPS)
}

pub fn exp(x: Iv) -> Iv {
    let r = increasing(x, ALL, ops::exp, ULPS);
    Iv::new(r.lo.max(0.0), r.hi)
}

pub fn expm1(x: Iv) -> Iv {
    let r = increasing(x, ALL, ops::expm1, ULPS);
    Iv::new(r.lo.max(-1.0), r.hi)
}

pub fn log(x: Iv) -> Iv {
    increasing(x, POS, ops::log, ULPS)
}

pub fn log2(x: Iv) -> Iv {
    increasing(x, POS, ops::log2, ULPS)
}

pub fn log10(x: Iv) -> Iv {
    increasing(x, POS, ops::log10, ULPS)
}

pub fn log1p(x: Iv) -> Iv {
    increasing(x, Iv::new(-1.0, f64::INFINITY), ops::log1p, ULPS)
}

/// `x` to the real power `y`: by its monotone pieces for a whole `y`, else through
/// exp(y · log x) over x's positive part (and 0 where x reaches it).
pub fn pow(x: Iv, y: Iv) -> Iv {
    if x.is_empty() || y.is_empty() {
        return Iv::EMPTY;
    }
    if y.lo == y.hi && y.lo == y.lo.trunc() && y.lo.abs() <= 1024.0 {
        let n = y.lo as i32;
        let r = x.powi(n);
        // libm's pow, which `pow(x, n)` takes, is within an ulp of the true value, and powi's
        // form already holds the true value: widen to cover both.
        return r.widen(ULPS);
    }
    let mut r = Iv::EMPTY;
    // A negative base takes only whole powers: each whole y in range, by powi, or past 64 of
    // them, every value |x|^y can take, either sign.
    let neg = x.meet(Iv::new(f64::NEG_INFINITY, 0.0));
    if !neg.is_empty() && y.is_bounded() {
        let (k0, k1) = (y.lo.ceil(), y.hi.floor());
        if k1 - k0 <= 64.0 && k0.abs() <= 1024.0 && k1.abs() <= 1024.0 {
            let mut k = k0;
            while k <= k1 {
                r = r.hull(neg.powi(k as i32).widen(ULPS));
                k += 1.0;
            }
        } else if k0 <= k1 {
            let m = pow(neg.abs(), y);
            r = r.hull(m).hull(m.neg());
        }
    } else if !neg.is_empty() {
        r = Iv::ENTIRE;
    }
    // Where y holds a whole number the point form takes powi, which strays from the true
    // power by up to about that many ulps.
    let stray = if y.is_bounded() && y.lo.ceil() <= y.hi.floor() {
        let k = y.lo.ceil().abs().max(y.hi.floor().abs()).min(1024.0);
        k as u32 + 4
    } else {
        0
    };
    let pos = x.meet(Iv::new(0.0, f64::INFINITY));
    if pos.is_empty() {
        return r;
    }
    if pos.hi > 0.0 {
        let p = Iv::new(pos.lo.max(f64::MIN_POSITIVE), pos.hi);
        r = r.hull(exp(y.mul(log(p))).widen(ULPS + stray));
        if pos.lo < f64::MIN_POSITIVE {
            // Below the smallest normal, x^y runs to 0 for y > 0 and to ∞ for y < 0.
            if y.hi > 0.0 {
                r = r.hull(Iv::point(0.0));
            }
            if y.lo < 0.0 {
                r = r.hull(Iv::point(f64::INFINITY));
            }
            if y.contains(0.0) {
                r = r.hull(Iv::point(1.0));
            }
        }
    }
    if pos.lo == 0.0 {
        let at0 = [
            if y.hi > 0.0 { Some(0.0) } else { None },
            if y.contains(0.0) { Some(1.0) } else { None },
            if y.lo < 0.0 { Some(f64::INFINITY) } else { None },
        ];
        for v in at0.into_iter().flatten() {
            r = r.hull(Iv::point(v));
        }
    }
    r
}

/// Whether some `c + k·period` lies in `x`, tested a hair wide so a near miss counts.
fn holds_one_of(x: Iv, c: f64, period: f64) -> bool {
    let slack = 1e-9 * (1.0 + x.lo.abs().max(x.hi.abs()));
    let k = ((x.lo - slack - c) / period).ceil();
    c + k * period <= x.hi + slack
}

/// sin over `x`: its ends, and its peaks at π/2 + 2kπ and troughs at −π/2 + 2kπ inside.
pub fn sin(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    if !x.is_bounded() || x.width() >= ops::TAU {
        return Iv::new(-1.0, 1.0);
    }
    let mut r = Iv::of(&[ops::sin(x.lo), ops::sin(x.hi)], ULPS);
    if holds_one_of(x, ops::PI / 2.0, ops::TAU) {
        r = r.hull(Iv::point(1.0));
    }
    if holds_one_of(x, -ops::PI / 2.0, ops::TAU) {
        r = r.hull(Iv::point(-1.0));
    }
    r.meet(Iv::new(-1.0, 1.0))
}

/// cos over `x`: its ends, and its peaks at 2kπ and troughs at π + 2kπ inside.
pub fn cos(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    if !x.is_bounded() || x.width() >= ops::TAU {
        return Iv::new(-1.0, 1.0);
    }
    let mut r = Iv::of(&[ops::cos(x.lo), ops::cos(x.hi)], ULPS);
    if holds_one_of(x, 0.0, ops::TAU) {
        r = r.hull(Iv::point(1.0));
    }
    if holds_one_of(x, ops::PI, ops::TAU) {
        r = r.hull(Iv::point(-1.0));
    }
    r.meet(Iv::new(-1.0, 1.0))
}

/// tan over `x`: increasing between its poles at π/2 + kπ; unbounded across one.
pub fn tan(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    // Poles are cos's zeros, π apart: a range no wider than f64's π, which is under the real
    // π, holds one only where cos changes sign between its ends. libm's cos keeps its sign that
    // near a zero, so this is exact.
    if !x.is_bounded() || x.width() > ops::PI || ops::cos(x.lo) * ops::cos(x.hi) <= 0.0 {
        return Iv::ENTIRE;
    }
    Iv::new(down(ops::tan(x.lo), ULPS), up(ops::tan(x.hi), ULPS))
}

pub fn asin(x: Iv) -> Iv {
    increasing(x, Iv::new(-1.0, 1.0), ops::asin, ULPS)
}

pub fn acos(x: Iv) -> Iv {
    decreasing(x, Iv::new(-1.0, 1.0), ops::acos, ULPS)
}

pub fn atan(x: Iv) -> Iv {
    increasing(x, ALL, ops::atan, ULPS)
}

/// atan2 over a box: at its corners, unless the box holds the origin or crosses the cut along
/// the negative x axis, where it is all of [−π, π].
pub fn atan2(y: Iv, x: Iv) -> Iv {
    if y.is_empty() || x.is_empty() {
        return Iv::EMPTY;
    }
    let pi = Iv::new(down(-ops::PI, 1), up(ops::PI, 1));
    // Zero is one value, unsigned, as IEEE 1788 reads it and the point form takes it: y on 0 or
    // above sits on the cut's upper side, where the angle reaches π and its corners bound it.
    if x.lo <= 0.0 && y.lo < 0.0 && y.hi >= 0.0 {
        return pi;
    }
    if !x.is_bounded() || !y.is_bounded() {
        return pi;
    }
    Iv::of(
        &[
            ops::atan2(y.lo, x.lo),
            ops::atan2(y.lo, x.hi),
            ops::atan2(y.hi, x.lo),
            ops::atan2(y.hi, x.hi),
        ],
        ULPS,
    )
    .meet(pi)
}

pub fn sinh(x: Iv) -> Iv {
    increasing(x, ALL, ops::sinh, ULPS)
}

/// cosh: least at 0.
pub fn cosh(x: Iv) -> Iv {
    let a = x.abs();
    if a.is_empty() {
        return a;
    }
    Iv::new(down(ops::cosh(a.lo), ULPS).max(1.0), up(ops::cosh(a.hi), ULPS))
}

pub fn tanh(x: Iv) -> Iv {
    increasing(x, ALL, ops::tanh, ULPS).meet(Iv::new(-1.0, 1.0))
}

pub fn asinh(x: Iv) -> Iv {
    increasing(x, ALL, ops::asinh, ULPS)
}

pub fn acosh(x: Iv) -> Iv {
    increasing(x, Iv::new(1.0, f64::INFINITY), ops::acosh, ULPS)
}

pub fn atanh(x: Iv) -> Iv {
    increasing(x, Iv::new(-1.0, 1.0), ops::atanh, ULPS)
}

/// hypot: increasing in |x| and in |y|.
pub fn hypot(x: Iv, y: Iv) -> Iv {
    let (a, b) = (x.abs(), y.abs());
    if a.is_empty() || b.is_empty() {
        return Iv::EMPTY;
    }
    Iv::new(
        down(ops::hypot(a.lo, b.lo), ULPS).max(0.0),
        up(ops::hypot(a.hi, b.hi), ULPS),
    )
}

pub fn erf(x: Iv) -> Iv {
    increasing(x, ALL, ops::erf, ULPS_SPECIAL).meet(Iv::new(-1.0, 1.0))
}

pub fn erfc(x: Iv) -> Iv {
    decreasing(x, ALL, ops::erfc, ULPS_SPECIAL).meet(Iv::new(0.0, 2.0))
}

/// sinc, even: decreasing in |x| over [0, π] from its removable 1 at 0, and through
/// sin(x) ÷ x, whose interval quotient holds it, past π.
pub fn sinc(x: Iv) -> Iv {
    let a = x.abs();
    if a.is_empty() {
        return a;
    }
    let mut r = Iv::EMPTY;
    if a.lo < ops::PI {
        let hi = a.hi.min(ops::PI);
        r = Iv::new(
            down(ops::sinc(hi), ULPS + 1),
            up(ops::sinc(a.lo), ULPS + 1).min(1.0),
        );
    }
    if a.hi > ops::PI {
        let far = Iv::new(a.lo.max(ops::PI), a.hi);
        r = r.hull(sin(far).div(far).meet(Iv::new(-1.0, 1.0)));
    }
    r
}

/// Where gamma is least on (0, ∞), and its value there.
const GAMMA_MIN_X: f64 = 1.461_632_144_968_362_3;
const GAMMA_MIN: f64 = 0.885_603_194_410_888_7;

/// gamma: decreasing on (0, 1.4616…], increasing after; on the negative side, through the
/// reflection Γ(x) = π ÷ (sin(πx) · Γ(1 − x)); unbounded across a pole at 0 or a negative integer.
pub fn gamma(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    if x.lo <= 0.0 && holds_pole(x) {
        return Iv::ENTIRE;
    }
    if x.lo <= 0.0 {
        let pi = Iv::point(ops::PI).widen(1);
        let s = sin(pi.mul(x));
        let g = gamma(Iv::point(1.0).sub(x));
        return pi.div(s.mul(g)).widen(ULPS_SPECIAL);
    }
    let f = |v: f64| ops::tgamma(v);
    let mut r = Iv::of(&[f(x.lo), f(x.hi)], ULPS_SPECIAL);
    if x.contains(GAMMA_MIN_X) {
        r = r.hull(Iv::point(GAMMA_MIN).widen(ULPS_SPECIAL));
    }
    r
}

/// lgamma, log|Γ|: least at 1.4616… on the positive side; through log|reflection| on the
/// negative side.
pub fn lgamma(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    if x.lo <= 0.0 {
        if holds_pole(x) {
            return Iv::ENTIRE;
        }
        let pi = Iv::point(ops::PI).widen(1);
        let s = sin(pi.mul(x)).abs();
        let l = lgamma(Iv::point(1.0).sub(x));
        return log(pi).sub(log(s)).sub(l).widen(ULPS_SPECIAL);
    }
    let f = |v: f64| ops::lgamma(v);
    let mut r = Iv::of(&[f(x.lo), f(x.hi)], ULPS_SPECIAL);
    if x.contains(GAMMA_MIN_X) {
        r = r.hull(Iv::point(ops::log(GAMMA_MIN)).widen(ULPS_SPECIAL));
    }
    r
}

/// Whether `x`, which reaches 0 or below, holds a pole of gamma: 0 or a negative integer.
fn holds_pole(x: Iv) -> bool {
    x.hi >= 0.0 || x.lo == x.lo.floor() || x.hi == x.hi.floor() || x.lo.floor() != x.hi.floor()
}

/// The largest n whose factorial is finite in f64.
pub const FACTORIAL_MAX: f64 = 170.0;

/// n! for a whole n from 0 to 170, by a product in order, so every machine rounds alike; `None`
/// for any other n.
pub fn factorial(n: f64) -> Option<f64> {
    if !(0.0..=FACTORIAL_MAX).contains(&n) || n != n.trunc() {
        return None;
    }
    let mut p = 1.0;
    let mut k = 2.0;
    while k <= n {
        p *= k;
        k += 1.0;
    }
    Some(p)
}

/// factorial over the whole numbers in `n`: increasing, widened by its product's rounding.
pub fn factorial_iv(n: Iv) -> Iv {
    let n = n.meet(Iv::new(0.0, FACTORIAL_MAX));
    if n.is_empty() {
        return Iv::EMPTY;
    }
    let (a, b) = (n.lo.ceil(), n.hi.floor());
    match (factorial(a), factorial(b)) {
        (Some(x), Some(y)) if a <= b => Iv::new(x, y).widen(0),
        _ => Iv::EMPTY,
    }
}

/// The binomial coefficient C(n, k) for whole n ≥ k ≥ 0, by the multiplicative formula in order;
/// `None` otherwise.
pub fn binom(n: f64, k: f64) -> Option<f64> {
    if n != n.trunc() || k != k.trunc() || k < 0.0 || n < k || n > 1e15 {
        return None;
    }
    let k = k.min(n - k);
    let mut r = 1.0;
    let mut i = 1.0;
    while i <= k {
        r = r * (n - k + i) / i;
        i += 1.0;
    }
    Some(r)
}

/// binom over the whole pairs in `n` × `k`: each pair when there are few, else through
/// exp(lgamma(n + 1) − lgamma(k + 1) − lgamma(n − k + 1)).
pub fn binom_iv(n: Iv, k: Iv) -> Iv {
    if n.is_empty() || k.is_empty() || !n.is_bounded() || !k.is_bounded() {
        return Iv::ENTIRE;
    }
    let (n0, n1, k0, k1) = (n.lo.ceil().max(0.0), n.hi.floor(), k.lo.ceil().max(0.0), k.hi.floor());
    if n0 > n1 || k0 > k1 {
        return Iv::EMPTY;
    }
    if (n1 - n0 + 1.0) * (k1 - k0 + 1.0) <= 4096.0 {
        let mut r = Iv::EMPTY;
        let mut a = n0;
        while a <= n1 {
            let mut b = k0;
            while b <= k1.min(a) {
                if let Some(v) = binom(a, b) {
                    r = r.hull(Iv::point(v));
                }
                b += 1.0;
            }
            a += 1.0;
        }
        // The product rounds once per factor: k rounds, k at most n.
        return r.widen((n1.min(4096.0) as u32) * 2 + 1);
    }
    let one = Iv::point(1.0);
    let (nn, kk) = (Iv::new(n0, n1), Iv::new(k0, k1));
    exp(lgamma(nn.add(one)).sub(lgamma(kk.add(one))).sub(lgamma(nn.sub(kk).add(one))))
        .widen(ULPS_SPECIAL)
        .meet(Iv::new(0.0, f64::INFINITY))
}

/// A step function's form: `f` is non-decreasing, so its ends bound it exactly.
pub fn step_up(x: Iv, f: fn(f64) -> f64) -> Iv {
    if x.is_empty() {
        return x;
    }
    Iv::new(f(x.lo), f(x.hi))
}

pub fn floor(x: Iv) -> Iv {
    step_up(x, f64::floor)
}

pub fn ceil(x: Iv) -> Iv {
    step_up(x, f64::ceil)
}

pub fn round(x: Iv) -> Iv {
    step_up(x, f64::round)
}

pub fn sign(x: Iv) -> Iv {
    step_up(x, |v| {
        if v > 0.0 {
            1.0
        } else if v < 0.0 {
            -1.0
        } else {
            0.0
        }
    })
}

/// fract, x − floor x: exact within one whole step, else all of [0, 1).
pub fn fract(x: Iv) -> Iv {
    if x.is_empty() {
        return x;
    }
    if !x.is_bounded() || x.lo.floor() != x.hi.floor() {
        return Iv::new(0.0, 1.0);
    }
    Iv::new(down(x.lo - x.lo.floor(), 1).max(0.0), up(x.hi - x.hi.floor(), 1).min(1.0))
}

/// mod(a, b) = a − b·floor(a ÷ b), between 0 and b: exact for a point b within one period.
pub fn modulo(a: Iv, b: Iv) -> Iv {
    if a.is_empty() || b.is_empty() {
        return Iv::EMPTY;
    }
    if b.lo == b.hi && b.lo > 0.0 && a.is_bounded() {
        // Within one period, held clear of its ends so the rounded quotient can't step: the
        // value rises with a.
        let m = b.lo;
        let f = |v: f64| v - m * (v / m).floor();
        let r0 = f(a.lo);
        let clear = 1e-9 * m;
        if (a.lo / m).floor() == (a.hi / m).floor() && r0 > clear && r0 + a.width() < m - clear {
            return Iv::of(&[f(a.lo), f(a.hi)], 4);
        }
    }
    let m = b.abs();
    if m.hi == 0.0 || !m.is_bounded() {
        return Iv::ENTIRE;
    }
    Iv::new(-m.hi, m.hi)
}

/// `a % b`, the remainder with a's sign: within |b| of 0 on a's side.
pub fn rem(a: Iv, b: Iv) -> Iv {
    if a.is_empty() || b.is_empty() {
        return Iv::EMPTY;
    }
    if b.lo == b.hi && b.lo != 0.0 && a.is_bounded() {
        // fmod is exact: from a's remainder at one end, the remainder rises with a until a
        // multiple of m, which lies in the range only if the remainder plus the width reaches m.
        let m = b.lo.abs();
        if a.lo >= 0.0 {
            let r0 = a.lo % m;
            if up(r0 + a.width(), 1) < m {
                return Iv::new(r0, a.hi % m);
            }
        } else if a.hi <= 0.0 {
            let r1 = a.hi % m;
            if down(r1 - a.width(), 1) > -m {
                return Iv::new(a.lo % m, r1);
            }
        }
    }
    let m = b.abs().hi;
    if !m.is_finite() {
        return a;
    }
    let lo = if a.lo < 0.0 { -m } else { 0.0 };
    let hi = if a.hi > 0.0 { m } else { 0.0 };
    Iv::new(lo, hi).meet(Iv::new(a.lo.min(0.0), a.hi.max(0.0)))
}

/// A comparison or a logical value: 1 where it surely holds, 0 where it surely fails.
pub fn truth(always: bool, never: bool) -> Iv {
    match (always, never) {
        (true, _) => Iv::point(1.0),
        (_, true) => Iv::point(0.0),
        _ => Iv::new(0.0, 1.0),
    }
}

/// smoothstep(e0, e1, x): t = clamp((x − e0) ÷ (e1 − e0), 0, 1), then t²(3 − 2t), which is
/// increasing on [0, 1], at t's ends.
pub fn smoothstep(e0: Iv, e1: Iv, x: Iv) -> Iv {
    let t = x
        .sub(e0)
        .div(e1.sub(e0))
        .clamp(Iv::point(0.0), Iv::point(1.0));
    if t.is_empty() {
        return Iv::new(0.0, 1.0);
    }
    let f = |t: f64| t * t * (3.0 - 2.0 * t);
    Iv::new(down(f(t.lo), 4).max(0.0), up(f(t.hi), 4).min(1.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A seeded search for counterexamples: every point value of `f` at seeded points inside a
    /// range lies inside its form over that range.
    fn search(name: &str, f: fn(f64) -> f64, form: fn(Iv) -> Iv, lo: f64, hi: f64) {
        let mut s = 0x2545_f491_4f6c_dd1du64;
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            (s >> 11) as f64 / (1u64 << 53) as f64
        };
        for _ in 0..2000 {
            let (a, b) = (lo + (hi - lo) * next(), lo + (hi - lo) * next());
            let x = Iv::new(a.min(b), a.max(b));
            let r = form(x);
            for _ in 0..50 {
                let p = x.lo + (x.hi - x.lo) * next();
                let v = f(p);
                if v.is_finite() {
                    assert!(r.contains(v), "{name}({p}) = {v} outside {r:?} over {x:?}");
                }
            }
        }
    }

    #[test]
    fn forms_hold_their_point_values() {
        search("sin", ops::sin, sin, -20.0, 20.0);
        search("cos", ops::cos, cos, -20.0, 20.0);
        search("tan", ops::tan, tan, -6.0, 6.0);
        search("exp", ops::exp, exp, -30.0, 30.0);
        search("log", ops::log, log, -1.0, 50.0);
        search("sqrt", ops::sqrt, sqrt, -1.0, 50.0);
        search("sinh", ops::sinh, sinh, -10.0, 10.0);
        search("cosh", ops::cosh, cosh, -10.0, 10.0);
        search("tanh", ops::tanh, tanh, -10.0, 10.0);
        search("sinc", ops::sinc, sinc, -30.0, 30.0);
        search("gamma", ops::tgamma, gamma, -5.0, 8.0);
        search("lgamma", ops::lgamma, lgamma, -5.0, 8.0);
        search("erf", ops::erf, erf, -4.0, 4.0);
        search("atanh", ops::atanh, atanh, -1.2, 1.2);
        search("fract", |x| x - x.floor(), fract, -5.0, 5.0);
    }

    #[test]
    fn sin_over_zero_to_three_holds_its_peak() {
        let r = sin(Iv::new(0.0, 3.0));
        assert!(r.contains(1.0) && r.lo <= 0.0);
    }

    #[test]
    fn sinc_near_zero_is_one_within_a_hair() {
        let r = sinc(Iv::new(-1e-9, 1e-9));
        assert!(r.lo >= 0.999_999_99 && r.hi <= 1.0, "{r:?}");
    }

    #[test]
    fn factorial_and_binom_refuse_what_they_dont_take() {
        assert_eq!(factorial(5.0), Some(120.0));
        assert_eq!(factorial(171.0), None);
        assert_eq!(factorial(2.5), None);
        assert_eq!(binom(5.0, 2.0), Some(10.0));
        assert!(factorial_iv(Iv::new(3.0, 5.0)).contains(24.0));
    }
}
