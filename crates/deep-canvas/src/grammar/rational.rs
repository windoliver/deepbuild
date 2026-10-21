//! An exact rational on `i128`, reduced, for literal values.

/// A reduced fraction `num / den` with `den > 0`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rational {
    num: i128,
    den: i128,
}

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 {
        let r = a % b;
        a = b;
        b = r;
    }
    a
}

impl Rational {
    /// `num / den`, reduced; `None` when `den` is zero or the sign can't be normalized.
    pub fn new(num: i128, den: i128) -> Option<Rational> {
        if den == 0 {
            return None;
        }
        let g = gcd(num.unsigned_abs(), den.unsigned_abs());
        let g = i128::try_from(g).ok()?;
        let (mut num, mut den) = (num / g, den / g);
        if den < 0 {
            num = num.checked_neg()?;
            den = den.checked_neg()?;
        }
        Some(Rational { num, den })
    }

    /// The whole number `n`.
    pub const fn integer(n: i128) -> Rational {
        Rational { num: n, den: 1 }
    }

    /// The numerator (carries the sign).
    pub fn num(&self) -> i128 {
        self.num
    }

    /// The denominator, always positive.
    pub fn den(&self) -> i128 {
        self.den
    }

    /// True when the value is a whole number.
    pub fn is_integer(&self) -> bool {
        self.den == 1
    }

    /// `self * other`, or `None` on overflow.
    pub fn checked_mul(self, other: Rational) -> Option<Rational> {
        Rational::new(
            self.num.checked_mul(other.num)?,
            self.den.checked_mul(other.den)?,
        )
    }

    /// `self / other`, or `None` on overflow or division by zero.
    pub fn checked_div(self, other: Rational) -> Option<Rational> {
        Rational::new(
            self.num.checked_mul(other.den)?,
            self.den.checked_mul(other.num)?,
        )
    }

    /// `self + other`, or `None` on overflow.
    pub fn checked_add(self, other: Rational) -> Option<Rational> {
        let a = self.num.checked_mul(other.den)?;
        let b = other.num.checked_mul(self.den)?;
        Rational::new(a.checked_add(b)?, self.den.checked_mul(other.den)?)
    }

    /// The nearest `f64`; only for display and f64 consumers, never for a check's decision.
    pub fn to_f64(&self) -> f64 {
        self.num as f64 / self.den as f64
    }
}
