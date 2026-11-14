//! Narration heard back (#509; canvas primitives: Check input: `narration.transcript@1`, and
//! Narration and captions). Pure code over pinned tables: what a line may say beside its text
//! (`say_not_text`, `narration.polyphonic`), and whether a transcript says what the line says. No
//! model runs here; a transcript is a recorded artifact the caller reads by hash.
//!
//! `zh_readings.tsv` is from pypinyin, MIT License, Copyright (c) 2016 mozillazg, 闲耘; the full
//! notice is in that file's header.

pub mod align;
pub mod normalizer;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use align::{align, Op};
pub use normalizer::{normalize, Kind, Tok};

/// `zh.polyphonic@1`: the characters whose common readings differ without their tones; in a
/// Chinese line each needs its reading in `say`.
pub const POLYPHONIC: &str =
    "行长重还乐都朝调传弹降觉角便曾差藏率薄血省盛系参单恶校解露落宿塞模强圈乘卡厦削弄壳色尾似";

/// `en.homographs@1`: a word, and the respellings `say` may read it as.
pub const HOMOGRAPHS: [(&str, &[&str]); 8] = [
    ("read", &["reed", "red"]),
    ("lead", &["leed", "led"]),
    ("live", &["liv", "lyve"]),
    ("wind", &["wynd"]),
    ("tear", &["tare"]),
    ("bow", &["bough"]),
    ("close", &["cloze"]),
    ("wound", &["woond"]),
];

/// `zh.readings@1`: a character's toneless readings.
pub fn readings(c: &str) -> &'static [&'static str] {
    static TABLE: OnceLock<BTreeMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        include_str!("zh_readings.tsv")
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| l.split_once('\t'))
            .map(|(c, r)| (c, r.split(',').collect()))
            .collect()
    });
    table.get(c).map_or(&[], Vec::as_slice)
}

/// Whether a BCP 47 locale is Chinese.
pub fn chinese(locale: &str) -> bool {
    locale.split(['-', '_']).next() == Some("zh")
}

/// Why a line's `say` is refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SayProblem {
    /// `say_not_text`: what the text has and what `say` has there.
    NotText { text: String, say: String },
    /// `narration.polyphonic`: the character and its readings.
    Polyphonic { ch: String, readings: Vec<String> },
}

/// A stretch where `say` reads differently from `text`, or a marked name: the tokens it covers in
/// each, and whether it is a name.
#[derive(Clone, Debug)]
struct Region {
    text: (usize, usize),
    say: (usize, usize),
    name: bool,
}

/// What a line is expected to say: its text and `say` after normalizer@1, and where they differ.
#[derive(Clone, Debug)]
pub struct Expected {
    pub text: Vec<Tok>,
    pub say: Vec<Tok>,
    regions: Vec<Region>,
    ops: Vec<Op>,
}

fn say_eq(t: &Tok, s: &Tok) -> bool {
    t.text == s.text && std::mem::discriminant(&t.kind) == std::mem::discriminant(&s.kind)
}

fn heard_eq(e: &Tok, h: &Tok) -> bool {
    match (&e.kind, &h.kind) {
        (Kind::Han(reading), Kind::Han(_)) => {
            let heard = readings(&h.text);
            match reading {
                Some(r) => heard.contains(&r.as_str()),
                None => e.text == h.text || readings(&e.text).iter().any(|x| heard.contains(x)),
            }
        }
        (a, b) => e.text == h.text && std::mem::discriminant(a) == std::mem::discriminant(b),
    }
}

fn shown(toks: &[Tok]) -> String {
    toks.iter().map(Tok::shown).collect::<Vec<_>>().join(" ")
}

impl Expected {
    /// A line's text and `say` (the text when it has none), checked: where they differ the text's
    /// word must be a marked name, a homograph read as one of its listed readings, or (Chinese) a
    /// polyphonic character given its bracketed reading.
    pub fn of(
        text: &str,
        say: Option<&str>,
        names: &[String],
        locale: &str,
    ) -> Result<Expected, SayProblem> {
        let t = normalize(text);
        let s = normalize(say.unwrap_or(text));
        let ops = align(&t, &s, say_eq);
        let mut named = BTreeSet::new();
        let mut occurrences = Vec::new();
        for n in names {
            let nt = normalize(n);
            if nt.is_empty() || nt.len() > t.len() {
                continue;
            }
            for i in 0..=t.len() - nt.len() {
                if t[i..i + nt.len()]
                    .iter()
                    .zip(&nt)
                    .all(|(a, b)| say_eq(a, b))
                {
                    named.extend(i..i + nt.len());
                    occurrences.push((i, i + nt.len()));
                }
            }
        }
        let mut regions = Vec::new();
        let (mut ti, mut si) = (0, 0);
        let mut open: Option<(usize, usize)> = None;
        let close = |open: &mut Option<(usize, usize)>,
                     ti: usize,
                     si: usize,
                     regions: &mut Vec<Region>|
         -> Result<(), SayProblem> {
            let Some((t0, s0)) = open.take() else {
                return Ok(());
            };
            let covered = |i: usize| named.contains(&i);
            let name = if t0 < ti {
                (t0..ti).all(covered)
            } else {
                (t0 > 0 && covered(t0 - 1)) || covered(t0)
            };
            let homograph = ti - t0 == 1
                && si - s0 == 1
                && HOMOGRAPHS
                    .iter()
                    .any(|(w, rs)| t[t0].text == *w && rs.contains(&s[s0].text.as_str()));
            if !name && !homograph {
                return Err(SayProblem::NotText {
                    text: shown(&t[t0..ti]),
                    say: shown(&s[s0..si]),
                });
            }
            regions.push(Region {
                text: (t0, ti),
                say: (s0, si),
                name,
            });
            Ok(())
        };
        for op in &ops {
            match *op {
                Op::Same(i, j) => {
                    close(&mut open, ti, si, &mut regions)?;
                    if let (Kind::Han(None), Kind::Han(r)) = (&t[i].kind, &s[j].kind) {
                        let rs = readings(&t[i].text);
                        match r {
                            None if chinese(locale) && POLYPHONIC.contains(t[i].text.as_str()) => {
                                return Err(SayProblem::Polyphonic {
                                    ch: t[i].text.clone(),
                                    readings: rs.iter().map(|x| x.to_string()).collect(),
                                });
                            }
                            Some(r) if !rs.contains(&r.as_str()) => {
                                return Err(SayProblem::NotText {
                                    text: t[i].text.clone(),
                                    say: s[j].shown(),
                                });
                            }
                            _ => {}
                        }
                    }
                    ti += 1;
                    si += 1;
                }
                Op::Sub(..) | Op::Del(_) | Op::Ins(_) => {
                    open.get_or_insert((ti, si));
                    match op {
                        Op::Sub(..) => {
                            ti += 1;
                            si += 1;
                        }
                        Op::Del(_) => ti += 1,
                        _ => si += 1,
                    }
                }
            }
        }
        close(&mut open, ti, si, &mut regions)?;
        // A name `say` reads as written is a region too, so it can match by its phonemes.
        let same: BTreeMap<usize, usize> = ops
            .iter()
            .filter_map(|o| {
                if let Op::Same(i, j) = *o {
                    Some((i, j))
                } else {
                    None
                }
            })
            .collect();
        for (a, b) in occurrences {
            if let (Some(&c), Some(&d)) = (same.get(&a), same.get(&(b - 1))) {
                if (a..b).all(|i| same.contains_key(&i)) && d + 1 - c == b - a {
                    regions.push(Region {
                        text: (a, b),
                        say: (c, d + 1),
                        name: true,
                    });
                }
            }
        }
        Ok(Expected {
            text: t,
            say: s,
            regions,
            ops,
        })
    }

    /// A text compared as it stands, with no `say`: a polyphonic character matches any of its
    /// readings, since only a script line's `say` gives one.
    pub fn plain(text: &str, names: &[String]) -> Expected {
        Expected::of(text, None, names, "")
            .unwrap_or_else(|_| unreachable!("a text with no say and no locale is never refused"))
    }

    /// What `say` reads, as the issue names it.
    pub fn said(&self) -> String {
        shown(&self.say)
    }

    /// For each white-space word of the text, the white-space words of `say` it is read as,
    /// `[first, last]`, or none: how a words record of `say` times the text's words.
    pub fn text_words_in_say(&self, text_words: usize) -> Vec<Option<(usize, usize)>> {
        let mut out: Vec<Option<(usize, usize)>> = vec![None; text_words];
        let mut link = |t: (usize, usize), s: (usize, usize)| {
            for k in (t.0..=t.1).filter(|k| *k < text_words) {
                let slot = &mut out[k];
                *slot = Some(slot.map_or(s, |(a, b)| (a.min(s.0), b.max(s.1))));
            }
        };
        for op in &self.ops {
            if let Op::Same(i, j) | Op::Sub(i, j) = *op {
                link(self.text[i].src, self.say[j].src);
            }
        }
        for r in &self.regions {
            if r.text.0 < r.text.1 && r.say.0 < r.say.1 {
                let t = (self.text[r.text.0].src.0, self.text[r.text.1 - 1].src.1);
                let s = (self.say[r.say.0].src.0, self.say[r.say.1 - 1].src.1);
                link(t, s);
            }
        }
        out
    }
}

/// How a transcript compares with what a line says.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Compared {
    pub matched: bool,
    pub missing: Vec<String>,
    pub extra: Vec<String>,
    pub wrong: Vec<(String, String)>,
}

/// Each phrase's tokens after normalizer@1, joined by spaces, to its phonemes.
pub fn phonemes_by_text<'a>(
    entries: impl IntoIterator<Item = (&'a str, Vec<String>)>,
) -> BTreeMap<String, Vec<String>> {
    entries
        .into_iter()
        .map(|(text, p)| {
            (
                normalize(text)
                    .iter()
                    .map(Tok::shown)
                    .collect::<Vec<_>>()
                    .join(" "),
                p,
            )
        })
        .collect()
}

/// Compares the heard tokens with what `e` says. A stretch where `say` differs from the text, or a
/// marked name, also matches when the heard tokens equal the text's there, or, for a name, when the
/// heard words' phonemes run together equal the name's (`names`, keyed by `say`'s spelling). Up to
/// `extra` extra heard tokens pass (the mix scope's one).
pub fn compare(
    e: &Expected,
    heard: &[Tok],
    heard_phonemes: &BTreeMap<String, Vec<String>>,
    names: &BTreeMap<String, Vec<String>>,
    extra: usize,
) -> Compared {
    let ops = align(&e.say, heard, heard_eq);
    let mut bad = vec![false; e.say.len()];
    let mut inserts: Vec<(usize, usize, bool)> = Vec::new();
    let mut pos = 0;
    for op in &ops {
        match *op {
            Op::Same(..) => pos += 1,
            Op::Sub(i, _) | Op::Del(i) => {
                bad[i] = true;
                pos += 1;
            }
            Op::Ins(j) => inserts.push((pos, j, false)),
        }
    }
    for r in &e.regions {
        let (c, d) = r.say;
        if c >= d || !((c..d).any(|i| bad[i]) || inserts.iter().any(|(p, _, _)| *p > c && *p < d)) {
            continue;
        }
        let mut got: Vec<usize> = Vec::new();
        let mut at = 0;
        for op in &ops {
            match *op {
                Op::Same(i, j) | Op::Sub(i, j) => {
                    if (c..d).contains(&i) {
                        got.push(j);
                    }
                    at += 1;
                }
                Op::Del(_) => at += 1,
                Op::Ins(j) => {
                    if at >= c && at <= d {
                        got.push(j);
                    }
                }
            }
        }
        let text = &e.text[r.text.0..r.text.1];
        let as_text =
            got.len() == text.len() && got.iter().zip(text).all(|(j, t)| heard_eq(t, &heard[*j]));
        let as_name = r.name && {
            let key = shown(&e.say[c..d]);
            let heard_p: Option<Vec<&String>> = got
                .iter()
                .map(|j| {
                    heard_phonemes
                        .get(&heard[*j].shown())
                        .filter(|p| !p.is_empty())
                })
                .collect::<Option<Vec<_>>>()
                .map(|ps| ps.into_iter().flatten().collect());
            match (names.get(&key), heard_p) {
                (Some(want), Some(have)) => !want.is_empty() && want.iter().eq(have),
                _ => false,
            }
        };
        if as_text || as_name {
            bad[c..d].iter_mut().for_each(|b| *b = false);
            for x in inserts.iter_mut().filter(|(_, j, _)| got.contains(j)) {
                x.2 = true;
            }
        }
    }
    let mut out = Compared::default();
    for op in &ops {
        match *op {
            Op::Sub(i, j) if bad[i] => out.wrong.push((e.say[i].shown(), heard[j].shown())),
            Op::Del(i) if bad[i] => out.missing.push(e.say[i].shown()),
            _ => {}
        }
    }
    out.extra = inserts
        .iter()
        .filter(|x| !x.2)
        .map(|(_, j, _)| heard[*j].shown())
        .collect();
    out.matched = out.missing.is_empty() && out.wrong.is_empty() && out.extra.len() <= extra;
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(text: &str, say: Option<&str>, names: &[&str], heard: &str) -> Compared {
        let names: Vec<String> = names.iter().map(|s| s.to_string()).collect();
        let e = Expected::of(text, say, &names, "en").unwrap();
        compare(&e, &normalize(heard), &BTreeMap::new(), &BTreeMap::new(), 0)
    }

    #[test]
    fn a_cut_names_the_missing_words() {
        let c = check(
            "The fox jumps over the lazy dog",
            None,
            &[],
            "The fox jumps over the",
        );
        assert!(!c.matched);
        assert_eq!(c.missing, ["lazy", "dog"]);
        assert!(check("The fox jumps", None, &[], "the fox, jumps.").matched);
    }

    #[test]
    fn say_differs_only_where_the_rules_let_it() {
        assert!(Expected::of(
            "Meet Siobhan now",
            Some("Meet Shivawn now"),
            &["Siobhan".into()],
            "en"
        )
        .is_ok());
        assert_eq!(
            Expected::of("Meet the team now", Some("Meet the crew now"), &[], "en").unwrap_err(),
            SayProblem::NotText {
                text: "team".into(),
                say: "crew".into()
            }
        );
        assert!(Expected::of("I read it", Some("I red it"), &[], "en").is_ok());
        assert!(Expected::of("It is 25%", Some("It is twenty five percent"), &[], "en").is_ok());
        let e = Expected::of(
            "Meet Nguyen",
            Some("Meet Win Yen"),
            &["Nguyen".into()],
            "en",
        )
        .unwrap();
        assert_eq!(e.text_words_in_say(2), [Some((0, 0)), Some((1, 2))]);
        // A name heard as its text, as its respelling, or by its phonemes passes; other words fail.
        assert!(
            check(
                "Meet Siobhan",
                Some("Meet Shivawn"),
                &["Siobhan"],
                "Meet Siobhan"
            )
            .matched
        );
        assert!(
            check(
                "Meet Siobhan",
                Some("Meet Shivawn"),
                &["Siobhan"],
                "meet shivawn"
            )
            .matched
        );
        let c = check(
            "Meet Siobhan",
            Some("Meet Shivawn"),
            &["Siobhan"],
            "Meet she then",
        );
        assert_eq!(
            (c.matched, c.wrong.clone(), c.extra.clone()),
            (
                false,
                vec![("shivawn".into(), "then".into())],
                vec!["she".into()]
            )
        );
        let names = phonemes_by_text([(
            "Shivawn",
            vec![
                "SH".into(),
                "IH".into(),
                "V".into(),
                "AH".into(),
                "N".into(),
            ],
        )]);
        let heard = phonemes_by_text([(
            "Shivon",
            vec![
                "SH".into(),
                "IH".into(),
                "V".into(),
                "AH".into(),
                "N".into(),
            ],
        )]);
        let e = Expected::of(
            "Meet Siobhan",
            Some("Meet Shivawn"),
            &["Siobhan".into()],
            "en",
        )
        .unwrap();
        assert!(compare(&e, &normalize("Meet Shivon"), &heard, &names, 0).matched);
    }

    #[test]
    fn chinese_compares_toneless_syllables() {
        let zh = |text: &str, say: Option<&str>, heard: &str| {
            let e = Expected::of(text, say, &[], "zh-CN")?;
            Ok::<bool, SayProblem>(
                compare(&e, &normalize(heard), &BTreeMap::new(), &BTreeMap::new(), 0).matched,
            )
        };
        // 今天天气很好我们去 (ten characters): 汽 for 气 is a homophone; 风 for 天 is an error.
        assert_eq!(
            zh("今天天气很好我们去公", None, "今天天汽很好我们去公"),
            Ok(true)
        );
        assert_eq!(
            zh("今天天气很好我们去公", None, "今天风气很好我们去公"),
            Ok(false)
        );
        assert_eq!(
            zh("他在银行工作", None, "他在银行工作"),
            Err(SayProblem::Polyphonic {
                ch: "行".into(),
                readings: vec!["xing".into(), "hang".into(), "heng".into()]
            })
        );
        assert_eq!(
            zh("他在银行工作", Some("他在银行[hang]工作"), "他在银航工作"),
            Ok(true)
        );
        assert_eq!(
            zh("他在银行工作", Some("他在银行[hang]工作"), "他在银型工作"),
            Ok(false)
        );
    }
}
