//! The number shapes the time and unit literals share: a decimal and a fraction.

use super::rational::Rational;
use super::seeded::Seeded;

/// The most digits a whole part, a numerator or a denominator may have.
pub(crate) const MAX_INT_DIGITS: usize = 18;
/// The most digits a fraction part may have.
pub(crate) const MAX_FRAC_DIGITS: usize = 9;

/// A decimal `-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,9})?`, kept as written so it prints back.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Decimal {
    /// True when the literal starts with `-`.
    pub negative: bool,
    /// The whole part.
    pub int: u64,
    /// The fraction digits, empty when the literal has no `.`.
    pub frac: String,
}

/// Parses `0|[1-9][0-9]{0,17}`.
pub(crate) fn parse_whole(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > MAX_INT_DIGITS || !b.iter().all(u8::is_ascii_digit) {
        return None;
    }
    if b.len() > 1 && b[0] == b'0' {
        return None;
    }
    s.parse().ok()
}

/// Parses `[1-9][0-9]{0,17}`.
pub(crate) fn parse_positive(s: &str) -> Option<u64> {
    parse_whole(s).filter(|n| *n > 0)
}

impl Decimal {
    /// Parses with an optional leading `-`.
    pub(crate) fn parse(s: &str) -> Option<Decimal> {
        match s.strip_prefix('-') {
            Some(rest) => Decimal::parse_unsigned(rest).map(|d| Decimal {
                negative: true,
                ..d
            }),
            None => Decimal::parse_unsigned(s),
        }
    }

    /// Parses without a sign.
    pub(crate) fn parse_unsigned(s: &str) -> Option<Decimal> {
        let (int, frac) = match s.split_once('.') {
            Some((i, f)) => (i, f),
            None => (s, ""),
        };
        let int = parse_whole(int)?;
        if s.contains('.')
            && (frac.is_empty()
                || frac.len() > MAX_FRAC_DIGITS
                || !frac.bytes().all(|c| c.is_ascii_digit()))
        {
            return None;
        }
        Some(Decimal {
            negative: false,
            int,
            frac: frac.to_string(),
        })
    }

    /// The literal's text.
    pub fn print(&self) -> String {
        let mut s = String::new();
        if self.negative {
            s.push('-');
        }
        s.push_str(&self.int.to_string());
        if !self.frac.is_empty() {
            s.push('.');
            s.push_str(&self.frac);
        }
        s
    }

    /// The exact value.
    pub fn to_rational(&self) -> Rational {
        let scale = 10i128.pow(self.frac.len() as u32);
        let frac: i128 = self.frac.parse().unwrap_or(0);
        let mut num = self.int as i128 * scale + frac;
        if self.negative {
            num = -num;
        }
        Rational::new(num, scale).unwrap_or(Rational::integer(0))
    }

    /// A random decimal with up to `max_frac` fraction digits.
    pub(crate) fn gen(rng: &mut Seeded, max_frac: u64) -> Decimal {
        let int = match rng.below(4) {
            0 => rng.below(10),
            1 => rng.below(1_000),
            2 => rng.below(1_000_000),
            _ => rng.next_u64() % 1_000_000_000_000_000_000,
        };
        let digits = rng.below(max_frac + 1);
        let frac: String = (0..digits)
            .map(|_| char::from(b'0' + rng.below(10) as u8))
            .collect();
        Decimal {
            negative: rng.chance(1, 5),
            int,
            frac,
        }
    }
}

/// A decimal or a fraction `a/b`, kept as written.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Number {
    /// `1.25`
    Decimal(Decimal),
    /// `1/300`
    Fraction {
        /// True when the literal starts with `-`.
        negative: bool,
        /// `0|[1-9][0-9]{0,17}`
        num: u64,
        /// `[1-9][0-9]{0,17}`
        den: u64,
    },
}

impl Number {
    /// Parses a decimal or a fraction, with an optional leading `-`.
    pub(crate) fn parse(s: &str) -> Option<Number> {
        let (negative, body) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s),
        };
        match body.split_once('/') {
            Some((num, den)) => Some(Number::Fraction {
                negative,
                num: parse_whole(num)?,
                den: parse_positive(den)?,
            }),
            None => {
                Decimal::parse_unsigned(body).map(|d| Number::Decimal(Decimal { negative, ..d }))
            }
        }
    }

    /// The literal's text.
    pub fn print(&self) -> String {
        match self {
            Number::Decimal(d) => d.print(),
            Number::Fraction { negative, num, den } => {
                format!("{}{num}/{den}", if *negative { "-" } else { "" })
            }
        }
    }

    /// The exact value.
    pub fn to_rational(&self) -> Rational {
        match self {
            Number::Decimal(d) => d.to_rational(),
            Number::Fraction { negative, num, den } => {
                let num = if *negative {
                    -(*num as i128)
                } else {
                    *num as i128
                };
                Rational::new(num, *den as i128).unwrap_or(Rational::integer(0))
            }
        }
    }

    pub(crate) fn gen(rng: &mut Seeded) -> Number {
        if rng.chance(1, 4) {
            Number::Fraction {
                negative: rng.chance(1, 5),
                num: rng.below(1_000),
                den: rng.range(1, 999),
            }
        } else {
            Number::Decimal(Decimal::gen(rng, MAX_FRAC_DIGITS as u64))
        }
    }
}
