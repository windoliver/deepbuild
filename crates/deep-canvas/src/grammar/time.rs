//! Time literals and their resolution to flicks.

use std::collections::BTreeMap;

use super::id::{gen_id, inject, Id};
use super::number::{parse_positive, parse_whole, Decimal};
use super::rational::Rational;
use super::seeded::Seeded;
use super::{refuse, Refusal};

const CODE: &str = "bad_time";
const UNRESOLVED: &str = "time_unresolved";

/// Flicks in one second: 705,600,000.
pub const FLICKS_PER_SECOND: i64 = 705_600_000;
/// The longest word a speech anchor names.
const MAX_WORD_LEN: usize = 64;
const WORD: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_'-";

/// What a time literal resolves against.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct TimeContext {
    /// The document's frame rate `p/q` in frames a second.
    pub frame_rate: (u32, u32),
    /// Each marker's `(start, end)` in flicks.
    pub markers: BTreeMap<String, (i64, i64)>,
}

/// A span of time: seconds or frames, signed.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Span {
    /// `1.25s`: a decimal that is a whole number of flicks.
    Seconds(Decimal),
    /// `195f`: whole frames at the document's frame rate.
    Frames {
        /// True when written with `-`.
        negative: bool,
        /// The frame count.
        count: u64,
    },
}

/// The flicks in `seconds`, or why it isn't a whole number of them.
fn seconds_to_flicks(seconds: &Decimal) -> Result<i64, String> {
    let flicks = seconds
        .to_rational()
        .checked_mul(Rational::integer(FLICKS_PER_SECOND as i128))
        .ok_or_else(|| "overflows".to_string())?;
    if !flicks.is_integer() {
        return Err(format!(
            "{}s is not a whole number of flicks",
            seconds.print()
        ));
    }
    i64::try_from(flicks.num()).map_err(|_| "does not fit an i64 count of flicks".to_string())
}

/// The whole-flick length of frame `1` at `p/q` fps, or why there is none.
pub(crate) fn frame_flicks(frame_rate: (u32, u32)) -> Result<i128, String> {
    let (p, q) = frame_rate;
    if p == 0 || q == 0 {
        return Err(format!("frame rate {p}/{q} is not a rate"));
    }
    let span = FLICKS_PER_SECOND as i128 * q as i128;
    if span % p as i128 != 0 {
        return Err(format!("frame rate {p}/{q} has no whole-flick frame"));
    }
    Ok(span / p as i128)
}

/// The most fraction digits a span of seconds may carry: 705,600,000 = 2^9 · 3^2 · 5^5 · 7^2, so
/// every decimal of up to five digits is a whole number of flicks, and a longer one is refused.
const MAX_SECONDS_DIGITS: usize = 5;

impl Span {
    /// Parses an unsigned span; a sign is an anchor offset's operator, never part of a span.
    fn parse(s: &str) -> Result<Span, String> {
        if s.starts_with('-') || s.starts_with('+') {
            return Err("a span has no sign; an offset's sign is its operator".into());
        }
        if let Some(body) = s.strip_suffix('s') {
            let seconds = Decimal::parse(body).ok_or_else(|| {
                format!("`{body}` is not a decimal with up to {MAX_SECONDS_DIGITS} fraction digits")
            })?;
            if seconds.frac.len() > MAX_SECONDS_DIGITS {
                return Err(format!(
                    "`{body}` has more than {MAX_SECONDS_DIGITS} fraction digits"
                ));
            }
            seconds_to_flicks(&seconds)?;
            return Ok(Span::Seconds(seconds));
        }
        if let Some(body) = s.strip_suffix('f') {
            let count =
                parse_whole(body).ok_or_else(|| format!("`{body}` is not a whole frame count"))?;
            return Ok(Span::Frames {
                negative: false,
                count,
            });
        }
        Err("a time is `<decimal>s`, `<integer>f`, `<bar>:<beat>b` or `@<anchor>[±<span>]`".into())
    }

    fn print_unsigned(&self) -> String {
        match self {
            Span::Seconds(d) => format!(
                "{}s",
                Decimal {
                    negative: false,
                    ..d.clone()
                }
                .print()
            ),
            Span::Frames { count, .. } => format!("{count}f"),
        }
    }

    fn is_negative(&self) -> bool {
        match self {
            Span::Seconds(d) => d.negative,
            Span::Frames { negative, .. } => *negative,
        }
    }

    /// The span's text.
    pub fn print(&self) -> String {
        let body = self.print_unsigned();
        if self.is_negative() {
            format!("-{body}")
        } else {
            body
        }
    }

    /// The span in flicks.
    pub fn resolve(&self, ctx: &TimeContext) -> Result<i64, Refusal> {
        match self {
            Span::Seconds(d) => seconds_to_flicks(d)
                .map_err(|why| refuse(CODE, format!("`{}`: {why}", self.print()))),
            Span::Frames { negative, count } => {
                let frame = frame_flicks(ctx.frame_rate)
                    .map_err(|why| refuse(UNRESOLVED, format!("`{}`: {why}", self.print())))?;
                let flicks = frame
                    .checked_mul(*count as i128)
                    .ok_or_else(|| refuse(CODE, format!("`{}`: overflows", self.print())))?;
                let flicks = if *negative { -flicks } else { flicks };
                i64::try_from(flicks).map_err(|_| {
                    refuse(
                        CODE,
                        format!("`{}`: does not fit an i64 count of flicks", self.print()),
                    )
                })
            }
        }
    }
}

/// A time literal.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Time {
    /// `1.25s` or `195f`.
    Span(Span),
    /// `2:1b`: bar and beat through the document's tempo map.
    Beats {
        /// The bar, from 1.
        bar: u64,
        /// The beat within the bar, from 1.
        beat: u64,
    },
    /// `@marker`, `@marker.end`, `@marker+1.25s`: a marker's start or end, or a narration line's
    /// first word or last word's end after the speech bake.
    Anchor {
        /// The marker or line.
        name: Id,
        /// True for `.end`.
        end: bool,
        /// The offset after `+` or `-`, if any.
        offset: Option<Span>,
    },
    /// `@line.word:text#k`: the k-th match of a word in a narration line, after the speech bake.
    Word {
        /// The narration line.
        line: Id,
        /// The word's text.
        text: String,
        /// The match number after `#`, from 1.
        k: Option<u64>,
        /// The offset after `+` or `-`, if any.
        offset: Option<Span>,
    },
}

/// Splits a trailing `+<span>` or `-<span>` off `s`, when one parses.
fn split_offset(s: &str) -> (&str, Option<Span>) {
    for (i, c) in s.char_indices().rev() {
        if c != '+' && c != '-' {
            continue;
        }
        if let Ok(span) = Span::parse(&s[i + 1..]) {
            let span = match span {
                Span::Seconds(d) => Span::Seconds(Decimal {
                    negative: c == '-',
                    ..d
                }),
                Span::Frames { count, .. } => Span::Frames {
                    negative: c == '-',
                    count,
                },
            };
            return (&s[..i], Some(span));
        }
    }
    (s, None)
}

fn print_offset(offset: &Option<Span>) -> String {
    match offset {
        None => String::new(),
        Some(span) => format!(
            "{}{}",
            if span.is_negative() { "-" } else { "+" },
            span.print_unsigned()
        ),
    }
}

impl Time {
    /// Parses a time literal; refuses with `bad_time`. A bare number is not a time.
    pub fn parse(text: &str) -> Result<Time, Refusal> {
        let bad = |why: String| refuse(CODE, format!("`{text}`: {why}"));
        if !text.is_ascii() {
            return Err(bad("a time literal is ASCII".into()));
        }
        if let Some(rest) = text.strip_prefix('@') {
            return Time::parse_anchor(rest).map_err(bad);
        }
        if let Some(body) = text.strip_suffix('b') {
            if let Some((bar, beat)) = body.split_once(':') {
                return match (parse_positive(bar), parse_positive(beat)) {
                    (Some(bar), Some(beat)) => Ok(Time::Beats { bar, beat }),
                    _ => Err(bad("bar and beat are positive decimals".into())),
                };
            }
        }
        Span::parse(text).map(Time::Span).map_err(bad)
    }

    fn parse_anchor(rest: &str) -> Result<Time, String> {
        let (head, offset) = split_offset(rest);
        if let Some((line, tail)) = head.split_once(':') {
            let line = line
                .strip_suffix(".word")
                .ok_or_else(|| "a word anchor is `@<line>.word:<text>[#<k>]`".to_string())?;
            let line = Id::parse(line).map_err(|r| r.what)?;
            let (text, k) = match tail.split_once('#') {
                Some((text, k)) => {
                    let k = parse_positive(k)
                        .ok_or_else(|| format!("match number `{k}` is not a positive decimal"))?;
                    (text, Some(k))
                }
                None => (tail, None),
            };
            let ok = !text.is_empty()
                && text.len() <= MAX_WORD_LEN
                && text.bytes().all(|c| WORD.contains(&c));
            if !ok {
                return Err(format!(
                    "word `{text}` must be 1 to {MAX_WORD_LEN} characters of [A-Za-z0-9_'-]"
                ));
            }
            return Ok(Time::Word {
                line,
                text: text.to_string(),
                k,
                offset,
            });
        }
        let (name, end) = match head.strip_suffix(".end") {
            Some(name) => (name, true),
            None => (head, false),
        };
        let name = Id::parse(name).map_err(|r| r.what)?;
        Ok(Time::Anchor { name, end, offset })
    }

    /// The literal's text.
    pub fn print(&self) -> String {
        match self {
            Time::Span(span) => span.print(),
            Time::Beats { bar, beat } => format!("{bar}:{beat}b"),
            Time::Anchor { name, end, offset } => format!(
                "@{}{}{}",
                name.as_str(),
                if *end { ".end" } else { "" },
                print_offset(offset)
            ),
            Time::Word {
                line,
                text,
                k,
                offset,
            } => format!(
                "@{}.word:{text}{}{}",
                line.as_str(),
                k.map(|k| format!("#{k}")).unwrap_or_default(),
                print_offset(offset)
            ),
        }
    }

    /// The literal in flicks, in `ctx`. A literal that needs what the context lacks (a tempo map, a
    /// marker, a speech bake) is `time_unresolved`.
    pub fn resolve(&self, ctx: &TimeContext) -> Result<i64, Refusal> {
        let unresolved = |why: &str| refuse(UNRESOLVED, format!("`{}`: {why}", self.print()));
        match self {
            Time::Span(span) => span.resolve(ctx),
            Time::Beats { .. } => Err(unresolved("the context has no tempo map")),
            Time::Anchor { name, end, offset } => {
                let Some((start, stop)) = ctx.markers.get(name.as_str()) else {
                    return Err(unresolved(&format!(
                        "marker `{}` is not in the context, and a narration line resolves only with a speech bake",
                        name.as_str()
                    )));
                };
                let base = if *end { *stop } else { *start };
                match offset {
                    None => Ok(base),
                    Some(span) => base
                        .checked_add(span.resolve(ctx)?)
                        .ok_or_else(|| refuse(CODE, format!("`{}`: overflows", self.print()))),
                }
            }
            Time::Word { .. } => Err(unresolved("a word anchor resolves only with a speech bake")),
        }
    }
}

/// A random unsigned decimal of seconds with up to five fraction digits: always whole flicks.
fn gen_whole_seconds(rng: &mut Seeded) -> Decimal {
    let digits = rng.below(MAX_SECONDS_DIGITS as u64 + 1);
    let int = match rng.below(3) {
        0 => rng.below(10),
        1 => rng.below(1_000),
        _ => rng.below(10_000_000),
    };
    let frac = if digits == 0 {
        String::new()
    } else {
        let value = rng.below(10u64.pow(digits as u32));
        format!("{value:0width$}", width = digits as usize)
    };
    Decimal {
        negative: false,
        int,
        frac,
    }
}

fn gen_span(rng: &mut Seeded) -> String {
    if rng.chance(1, 2) {
        format!("{}s", gen_whole_seconds(rng).print())
    } else {
        format!("{}f", rng.below(1_000_000))
    }
}

fn gen_offset(rng: &mut Seeded) -> String {
    if rng.chance(1, 2) {
        return String::new();
    }
    let span = gen_span(rng);
    match span.strip_prefix('-') {
        Some(body) => format!("-{body}"),
        None => format!("+{span}"),
    }
}

fn gen_word(rng: &mut Seeded) -> String {
    let len = rng.range(1, 10) as usize;
    (0..len).map(|_| char::from(*rng.pick(WORD))).collect()
}

/// A random valid time literal.
pub fn gen_time(rng: &mut Seeded) -> String {
    match rng.below(5) {
        0 | 1 => gen_span(rng),
        2 => format!("{}:{}b", rng.range(1, 999), rng.range(1, 16)),
        3 => format!(
            "@{}{}{}",
            gen_id(rng),
            if rng.chance(1, 3) { ".end" } else { "" },
            gen_offset(rng)
        ),
        _ => format!(
            "@{}.word:{}{}{}",
            gen_id(rng),
            gen_word(rng),
            if rng.chance(1, 2) {
                format!("#{}", rng.range(1, 20))
            } else {
                String::new()
            },
            gen_offset(rng)
        ),
    }
}

/// A random string that is not a time literal: a bare number, no or an unknown suffix, too many
/// fraction digits, a fraction of a flick, a bad anchor, a stray space or sign.
pub fn gen_time_mutant(rng: &mut Seeded) -> String {
    let id = gen_id(rng);
    let n = rng.below(1_000);
    match rng.below(26) {
        0 => n.to_string(),
        24 => format!("-{n}{}", rng.pick(&["s", "f"])),
        25 => format!("{n}.{:06}s", rng.below(1_000_000)),
        1 => format!("{}.{}", n, rng.below(100)),
        2 => format!("{n}.{:010}s", rng.below(10_000_000_000)),
        3 => format!("+{n}s"),
        4 => format!("{n}{}", rng.pick(&["x", "S", "F", "sec", "ms", "fs"])),
        5 => format!("{n}:b"),
        6 => format!(":{n}b"),
        7 => format!("0:{n}b"),
        8 => "@".to_string(),
        9 => {
            let what = *rng.pick(&["/", " ", "#", "::", "Q", "é"]);
            format!("@{}", inject(rng, &id, what))
        }
        10 => format!("{n},5s"),
        11 => format!(" {n}s"),
        12 => format!("{n} s"),
        13 => format!("{n}.s"),
        14 => format!(".{n}s"),
        15 => format!("0{}s", rng.range(1, 9)),
        16 => format!("{n}.00000000{}s", rng.range(1, 9)),
        17 => format!(
            "@{id}{}",
            rng.pick(&["+", "-+", "++1s", "+-1s", "+1", "+1.s"])
        ),
        18 => format!("@{id}.word:"),
        19 => format!(
            "@{id}.word:{}#{}",
            gen_word(rng),
            rng.pick(&["0", "", "01", "x"])
        ),
        20 => format!("@{id}.wrd:{}", gen_word(rng)),
        21 => format!("{n}:{}", rng.range(1, 9)),
        22 => format!("{n}e{}s", rng.below(9)),
        _ => format!("--{n}s"),
    }
}
