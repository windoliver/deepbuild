//! normalizer@1 (#509): one pinned rule set applied to both sides of a heard-back comparison, the
//! script's words and the transcript's (canvas primitives: Check input: `narration.transcript@1`).
//! NFKC, lower case, punctuation, hyphens, contractions, British spellings to American, every number
//! form to digit tokens and CJK numerals to digits. Han, kana and Hangul come out one token per
//! character (a syllable); everything else one token per word.
//!
//! The British spellings in `british.tsv` are ported from openai/whisper, MIT License, Copyright (c)
//! 2022 OpenAI; the full notice is in that file's header.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use unicode_normalization::UnicodeNormalization;

/// What a token is, which decides how two tokens compare.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    /// A word, a number or a number with its suffix (`1999`, `31st`, `25%`).
    Word,
    /// One Han character, with the toneless reading `say` gives it in brackets, if any.
    Han(Option<String>),
    /// One kana, katakana folded to hiragana.
    Kana,
    /// One Hangul syllable.
    Hangul,
}

/// One token, and the white-space-separated words of the input it came from, `[first, last]`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tok {
    pub text: String,
    pub kind: Kind,
    pub src: (usize, usize),
}

impl Tok {
    /// How the token prints: `行[hang]` for a Han character with a reading.
    pub fn shown(&self) -> String {
        match &self.kind {
            Kind::Han(Some(r)) => format!("{}[{r}]", self.text),
            _ => self.text.clone(),
        }
    }
}

fn british() -> &'static BTreeMap<&'static str, &'static str> {
    static TABLE: OnceLock<BTreeMap<&'static str, &'static str>> = OnceLock::new();
    TABLE.get_or_init(|| {
        include_str!("british.tsv")
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| l.split_once('\t'))
            .collect()
    })
}

fn is_han(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x3007)
}
fn is_kana(c: char) -> bool {
    matches!(c as u32, 0x3041..=0x309F | 0x30A0..=0x30FF)
}
fn is_hangul(c: char) -> bool {
    matches!(c as u32, 0xAC00..=0xD7A3)
}

const CJK_DIGITS: &str = "〇零一二两三四五六七八九";

fn cjk_numeral(c: char) -> bool {
    CJK_DIGITS.contains(c) || "十百千万亿".contains(c)
}

/// A run of CJK numerals as a number: 二十五 is 25, 一万二千 is 12000, 一九九九 is 1999.
fn cjk_value(run: &[char]) -> String {
    // 〇 零 read 0, 一 1, 二 两 2, then 三 to 九.
    let digit = |c: char| {
        CJK_DIGITS.chars().position(|d| d == c).map(|p| match p {
            0 | 1 => 0u64,
            2 => 1,
            3 | 4 => 2,
            p => p as u64 - 2,
        })
    };
    if run.iter().all(|c| digit(*c).is_some()) {
        return run
            .iter()
            .map(|c| char::from(b'0' + digit(*c).unwrap_or(0) as u8))
            .collect();
    }
    let (mut total, mut section, mut current) = (0u64, 0u64, 0u64);
    for &c in run {
        if let Some(d) = digit(c) {
            current = d;
            continue;
        }
        let unit = match c {
            '十' => 10,
            '百' => 100,
            '千' => 1000,
            '万' => 10_000,
            _ => 100_000_000,
        };
        if unit >= 10_000 {
            total = (total + section + current) * unit;
            section = 0;
        } else {
            section += current.max(1) * unit;
        }
        current = 0;
    }
    (total + section + current).to_string()
}

/// One piece of the input before the word rules: a word, a CJK token, or a break (punctuation),
/// which ends a number.
enum Piece {
    Word(String, usize),
    Tok(Tok),
    Break,
}

fn pieces(input: &str) -> Vec<Piece> {
    let folded: String = input
        .nfkc()
        .collect::<String>()
        .replace(['’', '‘', 'ʼ'], "'")
        .to_lowercase();
    let folded = folded.replace("a.m.", "am").replace("p.m.", "pm");
    let mut out = Vec::new();
    for (i, raw) in folded.split_whitespace().enumerate() {
        let cs: Vec<char> = raw.chars().collect();
        let mut word = String::new();
        let flush = |word: &mut String, out: &mut Vec<Piece>| {
            let w = word.trim_matches('\'').to_string();
            if !w.is_empty() {
                out.push(Piece::Word(w, i));
            }
            word.clear();
        };
        let mut k = 0;
        while k < cs.len() {
            let c = cs[k];
            let prev = k.checked_sub(1).map(|p| cs[p]);
            let next = cs.get(k + 1).copied();
            if cjk_numeral(c) {
                flush(&mut word, &mut out);
                let start = k;
                while k < cs.len() && cjk_numeral(cs[k]) {
                    k += 1;
                }
                out.push(Piece::Word(cjk_value(&cs[start..k]), i));
                continue;
            }
            if is_han(c) {
                flush(&mut word, &mut out);
                let mut reading = None;
                if next == Some('[') {
                    if let Some(close) = cs[k + 1..].iter().position(|x| *x == ']') {
                        let r: String = cs[k + 2..k + 1 + close].iter().collect();
                        if !r.is_empty() && r.chars().all(|x| x.is_ascii_alphabetic()) {
                            reading = Some(r);
                            out.push(Piece::Tok(Tok {
                                text: c.to_string(),
                                kind: Kind::Han(reading),
                                src: (i, i),
                            }));
                            k += close + 2;
                            continue;
                        }
                    }
                }
                out.push(Piece::Tok(Tok {
                    text: c.to_string(),
                    kind: Kind::Han(reading),
                    src: (i, i),
                }));
            } else if is_kana(c) {
                flush(&mut word, &mut out);
                let folded = match c as u32 {
                    0x30A1..=0x30F6 => char::from_u32(c as u32 - 0x60).unwrap_or(c),
                    _ => c,
                };
                out.push(Piece::Tok(Tok {
                    text: folded.to_string(),
                    kind: Kind::Kana,
                    src: (i, i),
                }));
            } else if is_hangul(c) {
                flush(&mut word, &mut out);
                out.push(Piece::Tok(Tok {
                    text: c.to_string(),
                    kind: Kind::Hangul,
                    src: (i, i),
                }));
            } else if c.is_alphanumeric() || c == '\'' || c == '%' {
                word.push(c);
            } else if (c == ',' || c == ':')
                && prev.is_some_and(|p| p.is_ascii_digit())
                && next.is_some_and(|n| n.is_ascii_digit())
            {
                // A thousands separator or a time's colon: dropped.
            } else if c == '.'
                && prev.is_some_and(|p| p.is_ascii_digit())
                && next.is_some_and(|n| n.is_ascii_digit())
            {
                word.push('.');
            } else if c == '-'
                && prev.is_some_and(char::is_alphabetic)
                && next.is_some_and(char::is_alphabetic)
            {
                flush(&mut word, &mut out);
            } else {
                flush(&mut word, &mut out);
                out.push(Piece::Break);
            }
            k += 1;
        }
        flush(&mut word, &mut out);
    }
    out
}

fn contraction(w: &str) -> Vec<String> {
    let whole = match w {
        "won't" => Some(["will", "not"]),
        "can't" => Some(["can", "not"]),
        "shan't" => Some(["shall", "not"]),
        "let's" => Some(["let", "us"]),
        _ => None,
    };
    if let Some(p) = whole {
        return p.iter().map(|s| s.to_string()).collect();
    }
    for (suffix, full) in [
        ("n't", "not"),
        ("'re", "are"),
        ("'ve", "have"),
        ("'ll", "will"),
        ("'m", "am"),
        ("'d", "would"),
    ] {
        if let Some(stem) = w.strip_suffix(suffix).filter(|s| !s.is_empty()) {
            return vec![stem.to_string(), full.to_string()];
        }
    }
    if let Some(stem) = w.strip_suffix("'s") {
        if [
            "it", "that", "what", "there", "here", "he", "she", "who", "where", "how",
        ]
        .contains(&stem)
        {
            return vec![stem.to_string(), "is".to_string()];
        }
    }
    vec![w.to_string()]
}

const UNITS: [&str; 20] = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
];
const TENS: [&str; 8] = [
    "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];
const ORDINAL_UNITS: [&str; 20] = [
    "zeroth",
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
    "thirteenth",
    "fourteenth",
    "fifteenth",
    "sixteenth",
    "seventeenth",
    "eighteenth",
    "nineteenth",
];
const ORDINAL_TENS: [&str; 8] = [
    "twentieth",
    "thirtieth",
    "fortieth",
    "fiftieth",
    "sixtieth",
    "seventieth",
    "eightieth",
    "ninetieth",
];

/// A number word: its value, its class, and whether it is an ordinal.
#[derive(Clone, Copy, PartialEq)]
enum Class {
    Unit,
    Teen,
    Tens,
    Hundred,
    Scale,
}

fn number_word(w: &str) -> Option<(u64, Class, bool)> {
    if let Some(n) = UNITS.iter().position(|u| *u == w) {
        return Some((
            n as u64,
            if n < 10 { Class::Unit } else { Class::Teen },
            false,
        ));
    }
    if let Some(n) = ORDINAL_UNITS.iter().position(|u| *u == w) {
        return Some((
            n as u64,
            if n < 10 { Class::Unit } else { Class::Teen },
            true,
        ));
    }
    if let Some(n) = TENS.iter().position(|u| *u == w) {
        return Some((20 + 10 * n as u64, Class::Tens, false));
    }
    if let Some(n) = ORDINAL_TENS.iter().position(|u| *u == w) {
        return Some((20 + 10 * n as u64, Class::Tens, true));
    }
    match w {
        "hundred" => Some((100, Class::Hundred, false)),
        "hundredth" => Some((100, Class::Hundred, true)),
        "thousand" => Some((1000, Class::Scale, false)),
        "thousandth" => Some((1000, Class::Scale, true)),
        "million" => Some((1_000_000, Class::Scale, false)),
        "millionth" => Some((1_000_000, Class::Scale, true)),
        "billion" => Some((1_000_000_000, Class::Scale, false)),
        _ => None,
    }
}

fn suffix(n: u64) -> &'static str {
    match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    }
}

/// A number being read from words.
struct Group {
    total: u64,
    current: u64,
    last: Option<Class>,
    src: (usize, usize),
}

impl Group {
    fn value(&self) -> u64 {
        self.total + self.current
    }
    /// Whether `class` continues this group.
    fn takes(&self, class: Class, value: u64) -> bool {
        match (self.last, class) {
            (None, _) => true,
            (Some(Class::Tens), Class::Unit) => value > 0,
            (Some(Class::Hundred | Class::Scale), Class::Unit | Class::Teen | Class::Tens) => true,
            (Some(Class::Unit | Class::Teen | Class::Tens), Class::Hundred) => self.current < 100,
            (Some(Class::Unit | Class::Teen | Class::Tens | Class::Hundred), Class::Scale) => {
                self.current > 0 && self.total % (value * 1000) == 0
            }
            _ => false,
        }
    }
    fn add(&mut self, class: Class, value: u64, i: usize) {
        match class {
            Class::Hundred => self.current = self.current.max(1) * 100,
            Class::Scale => {
                self.total += self.current.max(1) * value;
                self.current = 0;
            }
            _ => self.current += value,
        }
        self.last = Some(class);
        self.src.1 = i;
    }
}

/// A word token from a number: a joinable cardinal, or one that ends a run (an ordinal, a
/// percentage, a decimal).
struct Num {
    text: String,
    joins: bool,
    src: (usize, usize),
}

fn is_digits(w: &str) -> bool {
    !w.is_empty() && w.chars().all(|c| c.is_ascii_digit())
}

/// The words of `input` after normalizer@1.
pub fn normalize(input: &str) -> Vec<Tok> {
    let mut words: Vec<Option<(String, usize)>> = Vec::new();
    let mut toks_at: BTreeMap<usize, Tok> = BTreeMap::new();
    for p in pieces(input) {
        match p {
            Piece::Break => words.push(None),
            Piece::Tok(t) => {
                toks_at.insert(words.len(), t);
                words.push(None);
            }
            Piece::Word(w, i) => {
                for part in contraction(&w) {
                    let part = british()
                        .get(part.as_str())
                        .map_or(part.clone(), |a| a.to_string());
                    words.push(Some((part, i)));
                }
            }
        }
    }
    // Numbers: each run of number words between breaks reads as groups.
    let mut out: Vec<Tok> = Vec::new();
    let mut nums: Vec<Num> = Vec::new();
    let flush_nums = |nums: &mut Vec<Num>, out: &mut Vec<Tok>| {
        let mut k = 0;
        while k < nums.len() {
            let mut text = nums[k].text.clone();
            let mut src = nums[k].src;
            while nums[k].joins && k + 1 < nums.len() && nums[k + 1].joins {
                k += 1;
                text.push_str(&nums[k].text);
                src.1 = nums[k].src.1;
            }
            out.push(Tok {
                text,
                kind: Kind::Word,
                src,
            });
            k += 1;
        }
        nums.clear();
    };
    let mut group: Option<Group> = None;
    let close = |group: &mut Option<Group>, nums: &mut Vec<Num>| {
        if let Some(g) = group.take() {
            nums.push(Num {
                text: g.value().to_string(),
                joins: true,
                src: g.src,
            });
        }
    };
    let mut k = 0;
    while k < words.len() {
        let Some((w, i)) = words[k].clone() else {
            close(&mut group, &mut nums);
            flush_nums(&mut nums, &mut out);
            if let Some(t) = toks_at.remove(&k) {
                out.push(t);
            }
            k += 1;
            continue;
        };
        let next = words
            .get(k + 1)
            .and_then(|x| x.as_ref())
            .map(|x| x.0.as_str());
        if w == "and"
            && group
                .as_ref()
                .is_some_and(|g| matches!(g.last, Some(Class::Hundred | Class::Scale)))
            && next.and_then(number_word).is_some()
        {
            k += 1;
            continue;
        }
        if (w == "percent" || (w == "per" && next == Some("cent")))
            && (group.is_some() || nums.last().is_some_and(|n| n.joins))
        {
            close(&mut group, &mut nums);
            if let Some(n) = nums.last_mut() {
                n.text.push('%');
                n.joins = false;
                n.src.1 = i;
            }
            k += if w == "per" { 2 } else { 1 };
            continue;
        }
        if w == "point"
            && group.is_some()
            && next
                .and_then(number_word)
                .is_some_and(|(_, c, o)| c == Class::Unit && !o)
        {
            close(&mut group, &mut nums);
            let mut decimals = String::new();
            let mut last = i;
            while let Some((d, j)) = words.get(k + 1).and_then(|x| x.clone()) {
                match number_word(&d) {
                    Some((v, Class::Unit, false)) => {
                        decimals.push(char::from(b'0' + v as u8));
                        last = j;
                        k += 1;
                    }
                    _ => break,
                }
            }
            if let Some(n) = nums.last_mut() {
                n.text = format!("{}.{decimals}", n.text);
                n.joins = false;
                n.src.1 = last;
            }
            k += 1;
            continue;
        }
        if let Some((value, class, ordinal)) = number_word(&w) {
            if !group.as_ref().is_some_and(|g| g.takes(class, value)) {
                close(&mut group, &mut nums);
            }
            let g = group.get_or_insert(Group {
                total: 0,
                current: 0,
                last: None,
                src: (i, i),
            });
            g.add(class, value, i);
            if ordinal {
                let g = group
                    .take()
                    .map(|g| (g.value(), g.src))
                    .unwrap_or((value, (i, i)));
                nums.push(Num {
                    text: format!("{}{}", g.0, suffix(g.0)),
                    joins: false,
                    src: g.1,
                });
            }
            k += 1;
            continue;
        }
        close(&mut group, &mut nums);
        let ordinal_digits = ["st", "nd", "rd", "th"]
            .iter()
            .any(|s| w.strip_suffix(s).is_some_and(is_digits));
        let decimal = w
            .split_once('.')
            .is_some_and(|(a, b)| is_digits(a) && is_digits(b));
        if is_digits(&w) {
            nums.push(Num {
                text: w,
                joins: true,
                src: (i, i),
            });
        } else if ordinal_digits || decimal || w.strip_suffix('%').is_some_and(is_digits) {
            nums.push(Num {
                text: w,
                joins: false,
                src: (i, i),
            });
        } else {
            flush_nums(&mut nums, &mut out);
            out.push(Tok {
                text: w,
                kind: Kind::Word,
                src: (i, i),
            });
        }
        k += 1;
    }
    close(&mut group, &mut nums);
    flush_nums(&mut nums, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(s: &str) -> Vec<String> {
        normalize(s).iter().map(Tok::shown).collect()
    }

    #[test]
    fn numbers_read_as_words_read_as_digits() {
        let spoken = "On the thirty first, at ten thirty, twenty five percent of one thousand two hundred people in nineteen ninety nine came.";
        let written = "On the 31st, at 10:30, 25% of 1,200 people in 1999 came.";
        assert_eq!(words(spoken), words(written));
        assert_eq!(
            words(written),
            [
                "on", "the", "31st", "at", "1030", "25%", "of", "1200", "people", "in", "1999",
                "came"
            ]
        );
        assert_eq!(words("twenty twenty five"), ["2025"]);
        assert_eq!(words("two thousand and five"), ["2005"]);
        assert_eq!(words("three point one four"), ["3.14"]);
    }

    #[test]
    fn spellings_contractions_hyphens_and_cjk() {
        assert_eq!(
            words("Don't colour it well-known"),
            ["do", "not", "color", "it", "well", "known"]
        );
        assert_eq!(words("二十五个人"), ["25", "个", "人"]);
        assert_eq!(words("銀行[hang]"), ["銀", "行[hang]"]);
        assert_eq!(words("カタ"), ["か", "た"]);
    }
}
