//! The grammars a canvas document writes (design: canvas-primitives, "Conventions every
//! primitive uses" and "ID", "Path and handle"): IDs, paths, handles, time literals and unit
//! literals. Each has a parser that never panics, a printer, and a seeded generator with a
//! mutant generator, so `print(parse(x)) == x` for every generated `x` and every mutant is
//! refused with a code. Integer and exact rational arithmetic only: no floats decide anything.
//!
//! # Public API
//!
//! - [`Refusal`] `{ code, what, forms }`, codes `bad_id`, `bad_path`, `bad_handle`, `bad_time`,
//!   `bad_unit`, `time_unresolved`, `unit_mismatch`.
//! - [`Seeded`]: a splitmix64 stream; [`Rational`]: a reduced `i128` fraction with `to_f64`.
//! - IDs: [`Id::parse`] / [`Id::print`]; [`PatchId::parse`] also takes `~n` temporaries;
//!   [`SubAddress::parse`] takes `<id>#<sub>`. [`gen_id`], [`gen_id_mutant`].
//! - Paths: [`Path::parse`] / [`Path::print`] with [`Section`] and [`Path::fields`]. [`gen_path`],
//!   [`gen_path_mutant`].
//! - Handles: [`Handle::parse`] / [`Handle::print`] with [`Scheme`] and [`HandleId`].
//!   [`gen_handle`], [`gen_handle_mutant`].
//! - Time: [`Time::parse`] / [`Time::print`] / [`Time::resolve`] in a [`TimeContext`] to flicks
//!   ([`FLICKS_PER_SECOND`]); [`Span`] is a signed seconds-or-frames span. [`gen_time`],
//!   [`gen_time_mutant`].
//! - Units: [`UnitLiteral::parse`] / [`UnitLiteral::print`] / [`UnitLiteral::convert`] into a
//!   field's unit in a [`UnitContext`]; [`forms_for`] lists a field unit's forms; [`Unit`] and
//!   [`Number`] / [`Decimal`] are the parts. [`gen_unit`], [`gen_unit_mutant`].

mod handle;
mod id;
mod number;
mod path;
mod rational;
mod seeded;
#[cfg(test)]
mod tests;
mod time;
mod unit;

pub use handle::{gen_handle, gen_handle_mutant, Handle, HandleId, Scheme};
pub use id::{gen_id, gen_id_mutant, Id, PatchId, SubAddress};
pub use number::{Decimal, Number};
pub use path::{gen_path, gen_path_mutant, Path, Section};
pub use rational::Rational;
pub use seeded::Seeded;
pub use time::{gen_time, gen_time_mutant, Span, Time, TimeContext, FLICKS_PER_SECOND};
pub use unit::{forms_for, gen_unit, gen_unit_mutant, Unit, UnitContext, UnitLiteral};

/// The most segments an ID has.
pub const MAX_SEGMENTS: usize = 8;
/// The most characters an ID segment, a key or a sub-address has.
pub const MAX_SEGMENT_LEN: usize = 48;

/// Why a text was refused: a code the check records, what was wrong, and, for a unit mismatch,
/// the forms the field takes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    /// One of `bad_id`, `bad_path`, `bad_handle`, `bad_time`, `bad_unit`, `time_unresolved`,
    /// `unit_mismatch`.
    pub code: &'static str,
    /// The text and what was wrong with it.
    pub what: String,
    /// The forms the field takes, from [`forms_for`]; empty unless the code is `unit_mismatch`.
    pub forms: Vec<String>,
}

fn refuse(code: &'static str, what: String) -> Refusal {
    Refusal {
        code,
        what,
        forms: Vec::new(),
    }
}

/// True when `s` is `[a-z0-9][a-z0-9_-]{0,47}`.
pub(crate) fn is_segment(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=MAX_SEGMENT_LEN).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'_' || *c == b'-')
}
