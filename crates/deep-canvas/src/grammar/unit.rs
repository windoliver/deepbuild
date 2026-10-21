//! Unit literals and their exact conversion into a field's declared unit.

use super::id::inject;
use super::number::{Decimal, Number, MAX_FRAC_DIGITS};
use super::rational::Rational;
use super::seeded::Seeded;
use super::time::{frame_flicks, FLICKS_PER_SECOND};
use super::{refuse, Refusal};

/// The one code a unit literal refuses with: a malformed literal and a literal of another family
/// or a lossy conversion alike (the design: "refused with its grammar's code").
const CODE: &str = "bad_unit";
const MISMATCH: &str = CODE;

/// What a unit literal converts against.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnitContext {
    /// The frame's design size `(width, height)` in `u`, for `fw` and `fh`.
    pub frame: (u32, u32),
    /// The document's frame rate `p/q`, for `f`.
    pub frame_rate: (u32, u32),
}

/// A unit a literal or a field may carry. `Bare` is no unit at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Unit {
    /// A logical pixel at zoom 1.
    U,
    /// A screen pixel; equal to `u` in size, kept distinct.
    Px,
    /// A fraction of the frame's width.
    Fw,
    /// A fraction of the frame's height.
    Fh,
    M,
    Cm,
    Mm,
    Km,
    Deg,
    Turn,
    /// Radians: irrational against degrees, so it converts to nothing else.
    Rad,
    S,
    Ms,
    /// Frames at the document's frame rate.
    F,
    Flick,
    Percent,
    Hz,
    /// No unit: the field's own.
    Bare,
}

/// The units a conversion may cross; a literal converts only within its field unit's family.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Family {
    Screen,
    Physical,
    Angle,
    Radians,
    Time,
    Ratio,
    Frequency,
}

impl Unit {
    /// Every unit with a suffix, in the design's order.
    pub const SUFFIXED: [Unit; 17] = [
        Unit::U,
        Unit::Px,
        Unit::Fw,
        Unit::Fh,
        Unit::M,
        Unit::Cm,
        Unit::Mm,
        Unit::Km,
        Unit::Deg,
        Unit::Turn,
        Unit::Rad,
        Unit::S,
        Unit::Ms,
        Unit::F,
        Unit::Flick,
        Unit::Percent,
        Unit::Hz,
    ];

    /// The unit's suffix; empty for `Bare`.
    pub fn as_str(self) -> &'static str {
        match self {
            Unit::U => "u",
            Unit::Px => "px",
            Unit::Fw => "fw",
            Unit::Fh => "fh",
            Unit::M => "m",
            Unit::Cm => "cm",
            Unit::Mm => "mm",
            Unit::Km => "km",
            Unit::Deg => "deg",
            Unit::Turn => "turn",
            Unit::Rad => "rad",
            Unit::S => "s",
            Unit::Ms => "ms",
            Unit::F => "f",
            Unit::Flick => "flick",
            Unit::Percent => "%",
            Unit::Hz => "hz",
            Unit::Bare => "",
        }
    }

    /// The unit named `s`; `""` is `Bare`.
    pub fn parse(s: &str) -> Option<Unit> {
        if s.is_empty() {
            return Some(Unit::Bare);
        }
        Unit::SUFFIXED.into_iter().find(|u| u.as_str() == s)
    }

    fn family(self) -> Family {
        match self {
            Unit::U | Unit::Px | Unit::Fw | Unit::Fh => Family::Screen,
            Unit::M | Unit::Cm | Unit::Mm | Unit::Km => Family::Physical,
            Unit::Deg | Unit::Turn => Family::Angle,
            Unit::Rad => Family::Radians,
            Unit::S | Unit::Ms | Unit::F | Unit::Flick => Family::Time,
            Unit::Percent | Unit::Bare => Family::Ratio,
            Unit::Hz => Family::Frequency,
        }
    }

    /// The exact factor from this unit to its family's base (`u`, `m`, `deg`, `rad`, flicks, bare,
    /// `hz`), or why there is none.
    fn factor(self, ctx: &UnitContext) -> Result<Rational, String> {
        let r = |n: i128, d: i128| Rational::new(n, d).ok_or_else(|| "a zero factor".to_string());
        let nonzero_side = |side: Rational| {
            if side.num() == 0 {
                Err("no frame size to convert a frame unit against".to_string())
            } else {
                Ok(side)
            }
        };
        match self {
            Unit::U
            | Unit::Px
            | Unit::M
            | Unit::Deg
            | Unit::Rad
            | Unit::Flick
            | Unit::Bare
            | Unit::Hz => Ok(Rational::integer(1)),
            // A frame side of 0 is no frame size at all, never a factor of 0.
            Unit::Fw => r(ctx.frame.0 as i128, 1).and_then(nonzero_side),
            Unit::Fh => r(ctx.frame.1 as i128, 1).and_then(nonzero_side),
            Unit::Cm => r(1, 100),
            Unit::Mm => r(1, 1000),
            Unit::Km => Ok(Rational::integer(1000)),
            Unit::Turn => Ok(Rational::integer(360)),
            Unit::S => Ok(Rational::integer(FLICKS_PER_SECOND as i128)),
            Unit::Ms => r(FLICKS_PER_SECOND as i128, 1000),
            Unit::F => frame_flicks(ctx.frame_rate).map(Rational::integer),
            Unit::Percent => r(1, 100),
        }
    }
}

/// The forms a field declared in `unit` takes, each a literal the printer wrote (`1m`, `1cm`,
/// …), the bare number left out; empty for an unknown unit.
pub fn forms_for(unit: &str) -> Vec<String> {
    let Some(field) = Unit::parse(unit) else {
        return Vec::new();
    };
    let family = field.family();
    Unit::SUFFIXED
        .iter()
        .filter(|u| u.family() == family)
        .map(|u| {
            UnitLiteral {
                number: Number::Decimal(Decimal {
                    negative: false,
                    int: 1,
                    frac: String::new(),
                }),
                unit: *u,
            }
            .print()
        })
        .collect()
}

/// A literal: a number, at most one space, then a unit (or none). The printer writes no space and
/// no trailing fraction zeros, so `"300 mm"` prints `300mm` and `"1.50m"` prints `1.5m`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct UnitLiteral {
    number: Number,
    unit: Unit,
}

impl UnitLiteral {
    /// Parses `<number>[ ]<unit>`; refuses with `bad_unit`. A fraction `a/b` is a number only for
    /// the frame-relative units `fw` and `fh` (`"1/300fw"`).
    pub fn parse(text: &str) -> Result<UnitLiteral, Refusal> {
        let bad = |why: &str| refuse(CODE, format!("`{text}`: {why}"));
        if !text.is_ascii() {
            return Err(bad("a unit literal is ASCII"));
        }
        let suffix_at = text
            .bytes()
            .position(|c| c.is_ascii_lowercase() || c == b'%')
            .unwrap_or(text.len());
        let (body, suffix) = text.split_at(suffix_at);
        let unit = Unit::parse(suffix).ok_or_else(|| {
            bad("the unit is not one of u, px, fw, fh, m, cm, mm, km, deg, turn, rad, s, ms, f, flick, %, hz")
        })?;
        let trimmed = body.strip_suffix(' ').unwrap_or(body);
        if trimmed.len() != body.len() && unit == Unit::Bare {
            return Err(bad("one space comes only between the number and a unit"));
        }
        let number = Number::parse(trimmed).ok_or_else(|| {
            bad("the number is a decimal with up to 9 fraction digits, or a fraction a/b for fw and fh")
        })?;
        if matches!(number, Number::Fraction { .. }) && !matches!(unit, Unit::Fw | Unit::Fh) {
            return Err(bad("a fraction a/b is a number only for fw and fh"));
        }
        Ok(UnitLiteral { number, unit })
    }

    /// The number as written.
    pub fn number(&self) -> &Number {
        &self.number
    }

    /// The unit as written; `Bare` when none.
    pub fn unit(&self) -> Unit {
        self.unit
    }

    /// The literal's canonical text: the number with no trailing fraction zeros, then the unit,
    /// with no space.
    pub fn print(&self) -> String {
        let number = match &self.number {
            Number::Decimal(d) => Number::Decimal(Decimal {
                frac: d.frac.trim_end_matches('0').to_string(),
                ..d.clone()
            }),
            fraction => fraction.clone(),
        };
        format!("{}{}", number.print(), self.unit.as_str())
    }

    /// The literal's value in a field declared in `field_unit`, exactly. A literal of another
    /// dimension, or one that would lose something, is `unit_mismatch` listing the field's forms;
    /// an unknown field unit is `bad_unit`.
    pub fn convert(&self, field_unit: &str, ctx: &UnitContext) -> Result<Rational, Refusal> {
        let field = Unit::parse(field_unit)
            .ok_or_else(|| refuse(CODE, format!("field unit `{field_unit}` is not a unit")))?;
        let mismatch = |why: String| Refusal {
            code: MISMATCH,
            what: format!("`{}`: {why}", self.print()),
            forms: forms_for(field_unit),
        };
        let value = self.number.to_rational();
        let literal = if self.unit == Unit::Bare {
            field
        } else {
            self.unit
        };
        if literal == field {
            return Ok(value);
        }
        if literal.family() != field.family() {
            return Err(mismatch(format!(
                "`{}` is not a unit of a field in `{field_unit}`",
                literal.as_str()
            )));
        }
        let base = literal
            .factor(ctx)
            .and_then(|f| value.checked_mul(f).ok_or_else(|| "overflows".to_string()))
            .map_err(mismatch)?;
        if literal.family() == Family::Time && !base.is_integer() {
            return Err(mismatch("is not a whole number of flicks".into()));
        }
        field
            .factor(ctx)
            .and_then(|f| {
                base.checked_div(f)
                    .ok_or_else(|| "divides by zero or overflows".to_string())
            })
            .map_err(mismatch)
    }
}

/// A random valid unit literal in the printer's canonical text.
pub fn gen_unit(rng: &mut Seeded) -> String {
    let unit = if rng.chance(1, 4) {
        Unit::Bare
    } else {
        *rng.pick(&Unit::SUFFIXED)
    };
    let number = if matches!(unit, Unit::Fw | Unit::Fh) && rng.chance(1, 2) {
        Number::gen(rng)
    } else {
        let d = Decimal::gen(rng, MAX_FRAC_DIGITS as u64);
        Number::Decimal(Decimal {
            frac: d.frac.trim_end_matches('0').to_string(),
            ..d
        })
    };
    UnitLiteral { number, unit }.print()
}

/// A random string that is not a unit literal: an unknown unit, two units, a stray space,
/// a bad number, a capital, an empty string.
pub fn gen_unit_mutant(rng: &mut Seeded) -> String {
    let number = Number::gen(rng).print();
    let unit = rng.pick(&Unit::SUFFIXED).as_str();
    match rng.below(16) {
        0 => format!(
            "{number}{}",
            rng.pick(&["xx", "sec", "pt", "degs", "uu", "fps", "in"])
        ),
        1 => format!("{number}{unit} {unit}"),
        2 => format!("{number} "),
        14 => format!("{number}  {unit}"),
        15 => format!(
            "{}/{}{}",
            rng.below(100),
            rng.range(1, 99),
            rng.pick(&["m", "u", "deg", "s"])
        ),
        3 => format!(" {number}{unit}"),
        4 => format!("{number}{}", rng.pick(&["U", "PX", "Mm", "DEG", "S", "Hz"])),
        5 => format!("{number}{unit} "),
        6 => format!("{number}.{unit}"),
        7 => format!("{}.{:010}{unit}", rng.below(100), rng.below(10_000_000_000)),
        8 => format!("+{number}{unit}"),
        9 => format!("{}/0{unit}", rng.below(100)),
        10 => format!("{}//{}{unit}", rng.below(100), rng.range(1, 99)),
        11 => format!("0{}{unit}", rng.range(1, 99)),
        12 => rng
            .pick(&["", "u", "%", "/", "-", ".", "1,5u", "1e3u", "1/3/4fw"])
            .to_string(),
        _ => {
            let what = *rng.pick(&["é", "\t", "\n"]);
            inject(rng, &format!("{number}{unit}"), what)
        }
    }
}
