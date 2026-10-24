//! Versions and ranges as a manifest writes them (canvas primitives: Canvas module: `version:
//! semver`, `core: semver range`, `depends_on: {… → {range: semver range}}`), read without a
//! dependency: `major.minor.patch`, and a range as `*`, `=v`, `^v`, `~v`, `>=v`, `<v` or two of
//! the last two joined by a comma. A pre-release or build tag (`1.0.0-rc.1`) is no version a
//! manifest writes here, so it is refused.

use std::cmp::Ordering;
use std::fmt;

/// `major.minor.patch`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Semver {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

impl Semver {
    /// Reads `major.minor.patch`; a short form (`1`, `1.2`) fills the rest with zero.
    pub fn parse(text: &str) -> Option<Semver> {
        Semver::parse_parts(text).map(|(v, _)| v)
    }

    /// The version and how many of its parts were written (1 to 3), which a tilde range reads.
    fn parse_parts(text: &str) -> Option<(Semver, u8)> {
        let mut parts = text.trim().split('.');
        let major = part(parts.next()?)?;
        let mut written = 1;
        let minor = match parts.next() {
            Some(p) => {
                written += 1;
                part(p)?
            }
            None => 0,
        };
        let patch = match parts.next() {
            Some(p) => {
                written += 1;
                part(p)?
            }
            None => 0,
        };
        parts.next().is_none().then_some((
            Semver {
                major,
                minor,
                patch,
            },
            written,
        ))
    }
}

/// A version part: digits with no sign and no leading zero, so one version has one spelling.
fn part(s: &str) -> Option<u64> {
    if s.is_empty() || !s.bytes().all(|c| c.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0'))
    {
        return None;
    }
    s.parse().ok()
}

impl fmt::Display for Semver {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)
    }
}

/// One bound of a range.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Bound {
    /// `*`: any version.
    Any,
    /// `=v`: exactly `v`.
    Exact(Semver),
    /// `^v`: `v` up to the next major, or, below 1.0.0, up to the next non-zero part written
    /// (`^0.3.1` is `<0.4.0`, `^0.0.1` is `=0.0.1`, `^0` is `<1.0.0`, `^0.0` is `<0.1.0`), as
    /// Cargo reads it.
    Caret(Semver, u8),
    /// `~v`: `v` up to the next minor, or up to the next major when only the major is written
    /// (`~1` is `>=1.0.0, <2.0.0`, as Cargo reads it).
    Tilde(Semver, u8),
    /// `>=v`.
    AtLeast(Semver),
    /// `<v`.
    Below(Semver),
}

/// A range: every bound must hold.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Range {
    text: String,
    bounds: Vec<Bound>,
}

impl Range {
    /// Reads a range; `None` when it isn't one of the forms above.
    pub fn parse(text: &str) -> Option<Range> {
        let trimmed = text.trim();
        let mut bounds = Vec::new();
        for part in trimmed.split(',') {
            let part = part.trim();
            let bound = if part == "*" {
                Bound::Any
            } else if let Some(v) = part.strip_prefix(">=") {
                Bound::AtLeast(Semver::parse(v)?)
            } else if let Some(v) = part.strip_prefix('<') {
                Bound::Below(Semver::parse(v)?)
            } else if let Some(v) = part.strip_prefix('=') {
                Bound::Exact(Semver::parse(v)?)
            } else if let Some(v) = part.strip_prefix('~') {
                let (v, written) = Semver::parse_parts(v)?;
                Bound::Tilde(v, written)
            } else if let Some(v) = part.strip_prefix('^') {
                let (v, written) = Semver::parse_parts(v)?;
                Bound::Caret(v, written)
            } else {
                // A bare version is a caret range, as Cargo reads it.
                let (v, written) = Semver::parse_parts(part)?;
                Bound::Caret(v, written)
            };
            bounds.push(bound);
        }
        (!bounds.is_empty()).then(|| Range {
            text: trimmed.to_string(),
            bounds,
        })
    }

    /// True when `v` satisfies every bound.
    pub fn matches(&self, v: Semver) -> bool {
        self.bounds.iter().all(|bound| match *bound {
            Bound::Any => true,
            Bound::Exact(e) => v == e,
            Bound::AtLeast(lo) => v >= lo,
            Bound::Below(hi) => v < hi,
            Bound::Tilde(lo, written) => {
                v >= lo && v.major == lo.major && (written == 1 || v.minor == lo.minor)
            }
            Bound::Caret(lo, written) => {
                if v < lo {
                    return false;
                }
                if lo.major > 0 || written == 1 {
                    v.major == lo.major
                } else if lo.minor > 0 || written == 2 {
                    v.major == 0 && v.minor == lo.minor
                } else {
                    v.cmp(&lo) == Ordering::Equal
                }
            }
        })
    }
}

impl fmt::Display for Range {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(t: &str) -> Semver {
        Semver::parse(t).unwrap()
    }

    #[test]
    fn versions_read_and_order() {
        assert_eq!(
            v("1.2.3"),
            Semver {
                major: 1,
                minor: 2,
                patch: 3
            }
        );
        assert_eq!(v("2"), v("2.0.0"));
        assert!(v("1.10.0") > v("1.9.9"));
        assert!(Semver::parse("1.2.3.4").is_none());
        assert!(Semver::parse("+1").is_none());
        assert!(Semver::parse("01.2").is_none());
        assert!(Semver::parse("1.+2").is_none());
        assert!(Semver::parse("0.0.0").is_some());
        assert!(Semver::parse("a.b").is_none());
    }

    #[test]
    fn ranges_match_as_cargo_reads_them() {
        let caret = Range::parse("^1.2.0").unwrap();
        assert!(caret.matches(v("1.2.0")) && caret.matches(v("1.9.0")));
        assert!(!caret.matches(v("2.0.0")) && !caret.matches(v("1.1.9")));
        let bare = Range::parse("0.3.1").unwrap();
        assert!(bare.matches(v("0.3.9")) && !bare.matches(v("0.4.0")));
        let zero = Range::parse("0.0.1").unwrap();
        assert!(zero.matches(v("0.0.1")) && !zero.matches(v("0.0.2")));
        let zero_major = Range::parse("^0").unwrap();
        assert!(zero_major.matches(v("0.3.0")) && !zero_major.matches(v("1.0.0")));
        let zero_minor = Range::parse("0.0").unwrap();
        assert!(zero_minor.matches(v("0.0.9")) && !zero_minor.matches(v("0.1.0")));
        let tilde = Range::parse("~1.2.0").unwrap();
        assert!(tilde.matches(v("1.2.7")) && !tilde.matches(v("1.3.0")));
        let tilde_minor = Range::parse("~1.2").unwrap();
        assert!(tilde_minor.matches(v("1.2.7")) && !tilde_minor.matches(v("1.3.0")));
        let tilde_major = Range::parse("~1").unwrap();
        assert!(tilde_major.matches(v("1.3.0")) && !tilde_major.matches(v("2.0.0")));
        assert!(Semver::parse("1.0.0-rc.1").is_none());
        let span = Range::parse(">=1.0.0, <2.0.0").unwrap();
        assert!(span.matches(v("1.5.0")) && !span.matches(v("2.0.0")));
        assert!(Range::parse("*").unwrap().matches(v("9.9.9")));
        assert!(Range::parse("=1.0.0").unwrap().matches(v("1.0.0")));
        assert!(!Range::parse("=1.0.0").unwrap().matches(v("1.0.1")));
        assert!(Range::parse("").is_none() && Range::parse(">x").is_none());
    }
}
