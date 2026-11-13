//! Issue #538: CLDR's cardinal plural rules at a pinned release (Text `text@1`: keyed copy). A
//! plural entry of a copy table picks its form by the locale's cardinal rule applied to argument
//! `{0}` as shown. The rules are read from the pinned `plurals.xml` (CLDR at commit 1129998233,
//! `cldr-1129998233/` in this crate), never from the platform, so every machine picks the same form.
//!
//! Integer arithmetic only: a shown number is held as its digits (TR35's operands n, i, v, w, f,
//! t, e), never as a float.

use std::collections::BTreeMap;

/// The pinned file: CLDR's `common/supplemental/plurals.xml` at commit 1129998233.
pub const PLURALS: &str = include_str!("../cldr-1129998233/plurals.xml");

/// The six plural categories, in CLDR's order.
pub const CATEGORIES: [&str; 6] = ["zero", "one", "two", "few", "many", "other"];

/// A shown number's operands (TR35, Plural Operand Meanings), from its digits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Operands {
    /// The integer digits (`i`), which is `n` when there is no fraction.
    pub i: u128,
    /// The visible fraction digits, trailing zeros kept (`f` as text).
    pub fraction: String,
    /// The compact exponent (`e`, `c`), 0 for a plainly written number.
    pub e: u128,
}

impl Operands {
    /// The operands of a number written plainly or in CLDR's sample notation: an optional sign,
    /// digits, an optional `.` and fraction, and an optional `c<exponent>`; `None` for anything
    /// else.
    pub fn parse(text: &str) -> Option<Operands> {
        let text = text.trim().trim_start_matches(['-', '+']);
        let (mantissa, e) = match text.split_once(['c', 'e']) {
            Some((m, e)) => (m, e.parse::<u32>().ok()?),
            None => (text, 0),
        };
        let (int, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
        let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
        if int.is_empty() || !digits(int) || !digits(fraction) {
            return None;
        }
        // An exponent moves the point right: 1.1c6 is 1100000 with e = 6.
        let shift = (e as usize).min(fraction.len());
        let mut whole = format!("{int}{}", &fraction[..shift]);
        whole.extend(std::iter::repeat_n('0', e as usize - shift));
        let fraction = fraction[shift..].to_string();
        let whole = whole.trim_start_matches('0');
        let i = if whole.is_empty() {
            0
        } else {
            whole.parse().ok()?
        };
        Some(Operands {
            i,
            fraction,
            e: u128::from(e),
        })
    }

    /// The operands of `value` as a template writes it with `decimals` fraction digits.
    pub fn of_number(value: f64, decimals: usize) -> Option<Operands> {
        value
            .is_finite()
            .then(|| format!("{:.*}", decimals, value.abs()))
            .and_then(|s| Operands::parse(&s))
    }

    fn get(&self, op: u8) -> Option<(u128, bool)> {
        let trimmed = self.fraction.trim_end_matches('0');
        let num = |s: &str| if s.is_empty() { Some(0) } else { s.parse().ok() };
        Some(match op {
            // n: an integer only when every fraction digit is zero.
            b'n' => (self.i, !trimmed.is_empty()),
            b'i' => (self.i, false),
            b'v' => (self.fraction.len() as u128, false),
            b'w' => (trimmed.len() as u128, false),
            b'f' => (num(&self.fraction)?, false),
            b't' => (num(trimmed)?, false),
            b'c' | b'e' => (self.e, false),
            _ => return None,
        })
    }
}

/// One relation's right side: values and inclusive ranges.
type Ranges = Vec<(u128, u128)>;

#[derive(Clone, Debug)]
struct Relation {
    operand: u8,
    modulo: Option<u128>,
    equal: bool,
    ranges: Ranges,
}

/// A condition: an `or` of `and`s of relations; empty is always true (`other`).
type Condition = Vec<Vec<Relation>>;

impl Relation {
    fn holds(&self, n: &Operands) -> bool {
        let Some((mut value, fractional)) = n.get(self.operand) else {
            return false;
        };
        if let Some(m) = self.modulo.filter(|m| *m > 0) {
            value %= m;
        }
        // A number with a fraction equals no integer of a range (TR35: n = 2..4 is 2, 3 or 4).
        let within = !fractional && self.ranges.iter().any(|(a, b)| (*a..=*b).contains(&value));
        within == self.equal
    }
}

/// A locale's cardinal rules: each category with its condition, in the file's order, `other`
/// last.
#[derive(Clone, Debug, Default)]
pub struct Rules {
    rules: Vec<(&'static str, Condition)>,
}

impl Rules {
    /// The category `n` falls in: the first whose condition holds, else `other`.
    pub fn category(&self, n: &Operands) -> &'static str {
        self.rules
            .iter()
            .find(|(_, c)| !c.is_empty() && c.iter().any(|and| and.iter().all(|r| r.holds(n))))
            .map_or("other", |(k, _)| k)
    }

    /// The categories this locale has, in CLDR's order.
    pub fn categories(&self) -> Vec<&'static str> {
        let mut out: Vec<&'static str> = self.rules.iter().map(|(k, _)| *k).collect();
        out.sort_by_key(|k| CATEGORIES.iter().position(|c| c == k));
        out.dedup();
        out
    }
}

/// Every locale's rules in the pinned file, by its CLDR locale ID (`pt_PT`, `kok_Latn`).
#[derive(Clone, Debug, Default)]
pub struct Table {
    by_locale: BTreeMap<&'static str, usize>,
    sets: Vec<Rules>,
}

impl Table {
    /// The pinned file read once.
    pub fn pinned() -> Table {
        let mut t = Table::default();
        for (locales, rules) in blocks(PLURALS) {
            for l in locales.split_whitespace() {
                t.by_locale.insert(l, t.sets.len());
            }
            t.sets.push(rules);
        }
        t
    }

    /// The planted table whose French takes English's rules (#538 criterion 2's twin).
    pub fn english_everywhere() -> Table {
        let mut t = Table::pinned();
        let english = t.by_locale.get("en").copied();
        if let Some(k) = english {
            t.by_locale.insert("fr", k);
        }
        t
    }

    /// The rules of a BCP 47 `locale`: its own tag's (`pt-PT` as `pt_PT`), else its language's,
    /// else root's, which put every number under `other`.
    pub fn of(&self, locale: &str) -> Rules {
        let id = locale.replace('-', "_");
        let language = id.split('_').next().unwrap_or("");
        let found = [id.as_str(), language, "root"]
            .into_iter()
            .find_map(|k| self.by_locale.get(k).copied());
        found.map(|k| self.sets[k].clone()).unwrap_or_default()
    }
}

/// Each `<pluralRules locales="…">` block of `xml` with its rules.
fn blocks(xml: &'static str) -> Vec<(&'static str, Rules)> {
    let mut out = Vec::new();
    for block in xml.split("<pluralRules ").skip(1) {
        let Some(locales) = attr(block, "locales") else {
            continue;
        };
        let body = block.split("</pluralRules>").next().unwrap_or("");
        let mut rules = Vec::new();
        for rule in body.split("<pluralRule ").skip(1) {
            let (Some(count), Some(text)) = (
                attr(rule, "count"),
                rule.split_once('>').and_then(|(_, r)| r.split("</pluralRule>").next()),
            ) else {
                continue;
            };
            let Some(k) = CATEGORIES.iter().find(|c| **c == count) else {
                continue;
            };
            let condition = text.split('@').next().unwrap_or("");
            if let Some(c) = parse(condition) {
                rules.push((*k, c));
            }
        }
        out.push((locales, Rules { rules }));
    }
    out
}

fn attr(tag: &'static str, name: &str) -> Option<&'static str> {
    let at = tag.find(&format!("{name}=\""))? + name.len() + 2;
    let rest = &tag[at..];
    Some(&rest[..rest.find('"')?])
}

/// A condition in TR35's syntax (`i = 1 and v = 0`, `n % 10 = 2..4 or …`); `None` if malformed.
fn parse(text: &str) -> Option<Condition> {
    let text = text.trim();
    if text.is_empty() {
        return Some(Vec::new());
    }
    text.split(" or ")
        .map(|and| and.split(" and ").map(relation).collect())
        .collect()
}

fn relation(text: &str) -> Option<Relation> {
    let (left, equal, right) = match text.split_once("!=") {
        Some((l, r)) => (l, false, r),
        None => {
            let (l, r) = text.split_once('=')?;
            (l, true, r)
        }
    };
    let (operand, modulo) = match left.split_once('%') {
        Some((o, m)) => (o.trim(), Some(m.trim().parse().ok()?)),
        None => (left.trim(), None),
    };
    let [operand] = operand.as_bytes() else {
        return None;
    };
    let ranges = right
        .split(',')
        .map(|r| {
            let r = r.trim();
            let (a, b) = r.split_once("..").unwrap_or((r, r));
            Some((a.trim().parse().ok()?, b.trim().parse().ok()?))
        })
        .collect::<Option<Ranges>>()?;
    Some(Relation {
        operand: *operand,
        modulo,
        equal,
        ranges,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every sample of a rule's `@integer` and `@decimal` lists, ranges `a~b` walked at the
    /// precision they're written in.
    fn samples(text: &str) -> Vec<String> {
        let mut out = Vec::new();
        for list in text.split('@').skip(1) {
            let list = list.trim_start_matches("integer").trim_start_matches("decimal");
            for s in list.split(',').map(str::trim).filter(|s| !s.is_empty() && *s != "…") {
                let Some((a, b)) = s.split_once('~') else {
                    out.push(s.to_string());
                    continue;
                };
                let places = a.split_once('.').map_or(0, |(_, f)| f.len());
                let units = |x: &str| -> u128 { x.replace('.', "").parse().unwrap() };
                for u in units(a)..=units(b) {
                    let digits = format!("{u:0>width$}", width = places + 1);
                    let (int, frac) = digits.split_at(digits.len() - places);
                    out.push(if places == 0 { int.into() } else { format!("{int}.{frac}") });
                }
            }
        }
        out
    }

    #[test]
    fn every_sample_in_the_pinned_file_falls_in_its_own_category() {
        let t = Table::pinned();
        let mut checked = 0;
        for block in PLURALS.split("<pluralRules ").skip(1) {
            let locales = attr(block, "locales").unwrap();
            let body = block.split("</pluralRules>").next().unwrap();
            for rule in body.split("<pluralRule ").skip(1) {
                let count = attr(rule, "count").unwrap();
                let text = rule.split_once('>').unwrap().1.split("</pluralRule>").next().unwrap();
                for l in locales.split_whitespace() {
                    for s in samples(text) {
                        let n = Operands::parse(&s).unwrap_or_else(|| panic!("{s}"));
                        assert_eq!(t.of(l).category(&n), count, "{l} {s}");
                        checked += 1;
                    }
                }
            }
        }
        assert!(checked > 10_000, "{checked}");
    }

    #[test]
    fn english_and_french_differ_at_zero() {
        let t = Table::pinned();
        let n = |s| Operands::parse(s).unwrap();
        assert_eq!(t.of("en").category(&n("0")), "other");
        assert_eq!(t.of("fr").category(&n("0")), "one");
        assert_eq!(t.of("fr-CA").category(&n("1")), "one");
        assert_eq!(t.of("en").category(&n("1.0")), "other");
        assert_eq!(t.of("xx").category(&n("1")), "other");
        assert_eq!(t.of("fr").categories(), ["one", "many", "other"]);
    }
}
