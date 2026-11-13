//! Issue #502: captions (canvas primitives: Narration and captions, Loudness and caption
//! profiles). A script's lines are laid out at check by one rule, on whole frames: words fill
//! lines up to `max_chars`, lines group into captions of `max_lines`, each caption runs from the
//! frame its first word starts in to the first frame at or after its last word's end, then the
//! profile's shortest caption and its frame gap apply, and (#157) where the profile's row
//! carries them, the timing guide's rules at cuts and gaps. The caption checks then hold each
//! caption to its profile; a violation fails, it never warns.

use crate::FLICKS;

/// A caption profile's limits. Times are flicks; `max_cps` is characters a second in
/// thousandths, so every bound is an integer comparison.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    pub max_chars: usize,
    pub max_lines: usize,
    pub max_cps_milli: i64,
    pub min_dur: i64,
    pub max_dur: i64,
    pub gap_frames: i64,
    /// #407: a half-width character (ASCII letters, digits, spaces and punctuation, and the
    /// half-width forms) counts as half a character toward `max_chars`, as the Japanese and
    /// Korean guides count them.
    pub half_width: bool,
    /// #157: the timing guide's rules at cuts and gaps, where the profile's row carries them.
    pub cuts: Option<CutRules>,
}

/// #157: the timing guide's rules at cuts and gaps. An out-time within `within` before a cut
/// ends `frames` frames before it; a caption that crosses a cut ends `frames` frames before it,
/// where its length and reading speed allow, or else at least `within` after it; and a gap under
/// `within` closes to the profile's `gap_frames`, unless the earlier caption already ends
/// `within` past its speech or a cut falls in the gap.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CutRules {
    /// Flicks.
    pub within: i64,
    pub frames: i64,
}

/// The netflix timing guide's: half a second, 2 frames.
const NETFLIX_CUTS: CutRules = CutRules {
    within: FLICKS / 2,
    frames: 2,
};

/// A shipped caption profile: its limits, the locales it names, and where each value was read.
pub struct Profile {
    pub name: &'static str,
    pub limits: Limits,
    pub locales: &'static [&'static str],
    pub sources: &'static [(&'static str, &'static str, &'static str)],
}

/// The general rules every netflix profile here takes: 5/6 s to 7 s per caption, 2-frame gaps,
/// and the timing rules at cuts and gaps.
const GENERAL: [(&str, &str, &str); 3] = [
    ("2 lines maximum; 5/6 of a second to 7 seconds per subtitle event", "Netflix, Timed Text Style Guide: General Requirements, 1 and 4", "2026-11-10"),
    ("a minimum of 2 frames between subtitles", "Netflix, Timed Text Style Guide: Subtitle Timing Guidelines, 5", "2026-11-10"),
    (
        "an out-time within half a second of a shot change extends to it, respecting the two-frame gap; dialogue crossing a shot change may end two frames before it or at least half a second after it; gaps of 3-11 frames at 24 fps close to 2 frames, but an out-time already half a second past the audio is not extended to close a gap",
        "Netflix, Timed Text Style Guide: Subtitle Timing Guidelines, 2, 4 and 5",
        "2026-11-11",
    ),
];

/// The shipped caption profiles, in the order a document's locale picks one.
pub const PROFILES: [Profile; 4] = [
    Profile {
        name: "netflix-en-adult",
        limits: Limits {
            max_chars: 42,
            max_lines: 2,
            max_cps_milli: 20_000,
            min_dur: FLICKS * 5 / 6,
            max_dur: FLICKS * 7,
            gap_frames: 2,
            half_width: false,
            cuts: Some(NETFLIX_CUTS),
        },
        locales: &["en"],
        sources: &[
            ("42 characters per line; adult programs up to 20 characters per second", "Netflix, English (USA) Timed Text Style Guide, I.2 and I.14", "2026-11-10"),
            GENERAL[0],
            GENERAL[1],
            GENERAL[2],
        ],
    },
    // #407: the CJK profiles, read from each language's guide on the date given.
    Profile {
        name: "netflix-zh-hans",
        limits: Limits {
            max_chars: 16,
            max_lines: 2,
            max_cps_milli: 9_000,
            min_dur: FLICKS * 5 / 6,
            max_dur: FLICKS * 7,
            gap_frames: 2,
            half_width: false,
            cuts: Some(NETFLIX_CUTS),
        },
        locales: &["zh", "zh-Hans", "zh-CN", "zh-SG"],
        sources: &[
            ("16 characters per line", "Netflix, Chinese (Simplified) Timed Text Style Guide, 1 (change log to 2025-07-04)", "2026-11-10"),
            ("maximum two lines", "Netflix, Chinese (Simplified) Timed Text Style Guide, 10", "2026-11-10"),
            ("adult programs up to 9 characters per second", "Netflix, Chinese (Simplified) Timed Text Style Guide, 14", "2026-11-10"),
            GENERAL[0],
            GENERAL[1],
            GENERAL[2],
        ],
    },
    Profile {
        name: "netflix-ja",
        limits: Limits {
            max_chars: 13,
            max_lines: 2,
            max_cps_milli: 4_000,
            min_dur: FLICKS / 2,
            max_dur: FLICKS * 7,
            gap_frames: 2,
            half_width: true,
            cuts: Some(NETFLIX_CUTS),
        },
        locales: &["ja"],
        sources: &[
            ("horizontal subtitles: maximum 13 full-width characters per line; half-width characters count as 0.5", "Netflix, Japanese Timed Text Style Guide, I.5 (change log to 2025-12-19)", "2026-11-10"),
            ("maximum two lines", "Netflix, Japanese Timed Text Style Guide, I.14", "2026-11-10"),
            ("up to 4 characters per second", "Netflix, Japanese Timed Text Style Guide, I.19", "2026-11-10"),
            ("minimum duration 500 ms per subtitle event", "Netflix, Japanese Timed Text Style Guide, I.9", "2026-11-10"),
            GENERAL[0],
            GENERAL[1],
            GENERAL[2],
        ],
    },
    Profile {
        name: "netflix-ko",
        limits: Limits {
            max_chars: 16,
            max_lines: 2,
            max_cps_milli: 12_000,
            min_dur: FLICKS * 5 / 6,
            max_dur: FLICKS * 7,
            gap_frames: 2,
            half_width: true,
            cuts: Some(NETFLIX_CUTS),
        },
        locales: &["ko"],
        sources: &[
            ("16 characters per line; Latin characters, spaces and punctuation count as 0.5 character", "Netflix, Korean Timed Text Style Guide, I.2 (change log to 2025-07-07)", "2026-11-10"),
            ("maximum two lines", "Netflix, Korean Timed Text Style Guide, I.11", "2026-11-10"),
            ("adult programs up to 12 characters per second", "Netflix, Korean Timed Text Style Guide, I.15", "2026-11-10"),
            GENERAL[0],
            GENERAL[1],
            GENERAL[2],
        ],
    },
];

/// The profile named `name`.
pub fn profile(name: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|p| p.name == name)
}

/// The first shipped profile that names `locale`: by the whole tag, else by its language. A
/// Traditional Chinese tag (`Hant`, or a TW, HK or MO region) has no profile here, so it never
/// takes the Simplified one by its language.
pub fn profile_for(locale: &str) -> Option<&'static Profile> {
    let names = |l: &str| {
        PROFILES
            .iter()
            .find(|p| p.locales.iter().any(|x| x.eq_ignore_ascii_case(l)))
    };
    if let Some(p) = names(locale.replace('_', "-").as_str()) {
        return Some(p);
    }
    let mut subtags = locale.split(['-', '_']);
    let language = subtags.next().unwrap_or(locale);
    if subtags.any(|s| ["hant", "tw", "hk", "mo"].contains(&s.to_ascii_lowercase().as_str())) {
        return None;
    }
    names(language)
}

/// A character the Japanese and Korean guides count as half of one: ASCII letters, digits,
/// spaces and punctuation, and the half-width forms.
fn half(c: char) -> bool {
    matches!(c, ' '..='~' | '\u{FF61}'..='\u{FFDC}' | '\u{FFE8}'..='\u{FFEE}')
}

impl Limits {
    /// A line's width toward `max_chars` in half characters: 2 for each grapheme, 1 for a
    /// half-width one where the profile counts them so.
    fn halves(&self, text: &str, graphemes: &dyn Fn(&str) -> usize) -> usize {
        let n = 2 * graphemes(text);
        if self.half_width {
            n.saturating_sub(text.chars().filter(|c| half(*c)).count())
        } else {
            n
        }
    }
}

impl Limits {
    /// These limits with each value a block sets, where it is the stricter one.
    pub fn stricter(self, block: &Block) -> Limits {
        Limits {
            max_chars: block
                .max_chars
                .map_or(self.max_chars, |v| v.min(self.max_chars)),
            max_lines: block
                .max_lines
                .map_or(self.max_lines, |v| v.min(self.max_lines)),
            max_cps_milli: block
                .max_cps_milli
                .map_or(self.max_cps_milli, |v| v.min(self.max_cps_milli)),
            min_dur: block.min_dur.map_or(self.min_dur, |v| v.max(self.min_dur)),
            max_dur: self.max_dur,
            gap_frames: block
                .gap_frames
                .map_or(self.gap_frames, |v| v.max(self.gap_frames)),
            half_width: self.half_width,
            cuts: self.cuts,
        }
    }
}

/// The limits a script's captions block sets.
#[derive(Clone, Copy, Debug, Default)]
pub struct Block {
    pub max_chars: Option<usize>,
    pub max_lines: Option<usize>,
    pub max_cps_milli: Option<i64>,
    pub min_dur: Option<i64>,
    pub gap_frames: Option<i64>,
}

/// What times a line's captions.
pub enum Timing {
    /// Each word's start and end in document time, one per word of the text.
    Words(Vec<(i64, i64)>),
    /// A `caption` line: no sound, only its `t`.
    At(i64),
}

pub struct Line<'a> {
    pub id: &'a str,
    pub text: &'a str,
    pub timing: Timing,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Caption {
    /// `<line>.<n>`, n from 1.
    pub id: String,
    pub line: String,
    pub lines: Vec<String>,
    /// The graphemes of its words joined by single spaces.
    pub chars: usize,
    /// Its in-time and out-time: whole frames, in flicks.
    pub start: i64,
    pub end: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Violation {
    pub caption: String,
    /// `max_cps`, `min_dur`, `max_dur` or `max_chars`.
    pub limit: &'static str,
    pub what: String,
}

/// A line whose words and word times differ in number.
#[derive(Clone, Debug, PartialEq)]
pub struct Mismatch {
    pub line: String,
    pub words: usize,
    pub times: usize,
}

fn ceil_div(a: i128, b: i128) -> i128 {
    a.div_euclid(b) + i128::from(a.rem_euclid(b) != 0)
}

/// The captions of `lines` on frames `frame` flicks long, in time order. `graphemes` counts a
/// text's grapheme clusters (the one shaper's, which the caller holds); `cuts` are the film's cut
/// times in flicks, in order.
pub fn layout(
    lines: &[Line],
    limits: &Limits,
    frame: i64,
    graphemes: &dyn Fn(&str) -> usize,
    cuts: &[i64],
) -> Result<Vec<Caption>, Mismatch> {
    let (max_chars, max_lines) = (limits.max_chars.max(1), limits.max_lines.max(1));
    let mut out: Vec<(Caption, i64)> = Vec::new();
    for line in lines {
        let words: Vec<&str> = line.text.split_whitespace().collect();
        if let Timing::Words(times) = &line.timing {
            if times.len() != words.len() {
                return Err(Mismatch {
                    line: line.id.to_string(),
                    words: words.len(),
                    times: times.len(),
                });
            }
        }
        // Lines, each a run of word indices with its graphemes and its width in half characters
        // (a space is one grapheme, half a character where the profile counts half-widths).
        let space = limits.halves(" ", &|s: &str| s.chars().count());
        let mut rows: Vec<(usize, usize, usize, usize)> = Vec::new();
        for (i, w) in words.iter().enumerate() {
            let (n, h) = (graphemes(w), limits.halves(w, graphemes));
            match rows.last_mut() {
                Some(row) if row.3 + space + h <= 2 * max_chars => {
                    *row = (row.0, i + 1, row.2 + 1 + n, row.3 + space + h)
                }
                _ => rows.push((i, i + 1, n, h)),
            }
        }
        let mut next = match line.timing {
            Timing::At(t) => t,
            Timing::Words(_) => 0,
        };
        for (n, group) in rows.chunks(max_lines).enumerate() {
            let (first, last) = (group[0].0, group[group.len() - 1].1);
            let chars = group.iter().map(|r| r.2).sum::<usize>() + group.len() - 1;
            let (a, b) = match &line.timing {
                Timing::Words(times) => (times[first].0, times[last - 1].1),
                Timing::At(_) => {
                    let read = ceil_div(
                        chars as i128 * FLICKS as i128 * 1000,
                        limits.max_cps_milli.max(1) as i128,
                    ) as i64;
                    (next, next + read)
                }
            };
            let start = a.div_euclid(frame) * frame;
            let end = ceil_div(b as i128, frame as i128) as i64 * frame;
            // A caption line's next caption follows this one by the frame gap.
            next = end.max(start + ceil_div(limits.min_dur as i128, frame as i128) as i64 * frame)
                + limits.gap_frames * frame;
            // Each caption beside the end of its speech (#157: the gap rule reads it).
            out.push((
                Caption {
                    id: format!("{}.{}", line.id, n + 1),
                    line: line.id.to_string(),
                    lines: group.iter().map(|r| words[r.0..r.1].join(" ")).collect(),
                    chars,
                    start,
                    end,
                },
                b,
            ));
        }
    }
    out.sort_by_key(|c| c.0.start);
    let shortest = ceil_div(limits.min_dur as i128, frame as i128) as i64 * frame;
    let gap = limits.gap_frames * frame;
    // #157: each cut at the first frame that shows it.
    let cuts: Vec<i64> = cuts
        .iter()
        .map(|c| ceil_div(*c as i128, frame as i128) as i64 * frame)
        .collect();
    for i in 0..out.len() {
        let (c, said) = (&out[i].0, out[i].1);
        let mut end = c.end;
        if end - c.start < limits.min_dur {
            end = c.start + shortest;
        }
        if let Some(rules) = limits.cuts {
            end = at_cuts(c, end, limits, rules, frame, &cuts);
        }
        if let Some(next) = out.get(i + 1).map(|c| c.0.start) {
            // #157: a gap under the guide's half second chains to the frame gap, unless the
            // caption already lingers that long past its speech or a cut falls in the gap.
            let chain = limits.cuts.is_some_and(|r| {
                next - end < r.within
                    && end - said < r.within
                    && !cuts.iter().any(|cut| *cut > end && *cut < next)
            });
            if next - end < gap || chain {
                end = next - gap;
            }
        }
        out[i].0.end = end;
    }
    Ok(out.into_iter().map(|(c, _)| c).collect())
}

/// #157: `end`, a caption's out-time, held to the rules at the cuts after its in-time (frame
/// times, in order): within `within` before a cut, or across one and less than `within` past
/// it, it ends `frames` frames before the cut where that leaves it no shorter than the profile's
/// shortest and no faster than its reading speed (or extends it), else `within` past the cut.
fn at_cuts(
    c: &Caption,
    mut end: i64,
    limits: &Limits,
    rules: CutRules,
    frame: i64,
    cuts: &[i64],
) -> i64 {
    let fits = |end: i64| {
        let length = end - c.start;
        length >= limits.min_dur
            && c.chars as i128 * FLICKS as i128 * 1000
                <= limits.max_cps_milli as i128 * length as i128
    };
    for &cut in cuts.iter().filter(|cut| **cut > c.start) {
        if cut - end > rules.within {
            break;
        }
        if end - cut >= rules.within {
            continue;
        }
        let before = cut - rules.frames * frame;
        if before >= end || fits(before) {
            return before;
        }
        end = ceil_div((cut + rules.within) as i128, frame as i128) as i64 * frame;
    }
    end
}

/// The caption checks: each caption held to its limits.
pub fn check(
    captions: &[Caption],
    limits: &Limits,
    graphemes: &dyn Fn(&str) -> usize,
) -> Vec<Violation> {
    let mut out = Vec::new();
    let seconds = |t: i64| t as f64 / FLICKS as f64;
    for c in captions {
        let length = c.end - c.start;
        let mut fail = |limit: &'static str, what: String| {
            out.push(Violation {
                caption: c.id.clone(),
                limit,
                what,
            })
        };
        if c.chars as i128 * FLICKS as i128 * 1000
            > limits.max_cps_milli as i128 * length.max(0) as i128
        {
            fail(
                "max_cps",
                format!(
                    "caption `{}` shows {} characters for {:.3} s, more than {} a second",
                    c.id,
                    c.chars,
                    seconds(length),
                    limits.max_cps_milli as f64 / 1000.0
                ),
            );
        }
        if length < limits.min_dur {
            fail(
                "min_dur",
                format!(
                    "caption `{}` lasts {:.3} s, under the profile's {:.3} s",
                    c.id,
                    seconds(length),
                    seconds(limits.min_dur)
                ),
            );
        }
        if length > limits.max_dur {
            fail(
                "max_dur",
                format!(
                    "caption `{}` lasts {:.3} s, over the profile's {:.3} s",
                    c.id,
                    seconds(length),
                    seconds(limits.max_dur)
                ),
            );
        }
        if let Some(l) = c
            .lines
            .iter()
            .find(|l| limits.halves(l, graphemes) > 2 * limits.max_chars)
        {
            let width = limits.halves(l, graphemes) as f64 / 2.0;
            fail(
                "max_chars",
                format!(
                    "caption `{}` has a line of {width} characters, over {}: `{l}`",
                    c.id, limits.max_chars
                ),
            );
        }
    }
    out
}

/// A time in whole milliseconds, rounded down.
fn milliseconds(t: i64) -> i64 {
    (t as i128 * 1000).div_euclid(FLICKS as i128) as i64
}

fn stamp(t: i64, point: char) -> String {
    let ms = milliseconds(t).max(0);
    format!(
        "{:02}:{:02}:{:02}{point}{:03}",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}

/// The captions as a SubRip file: cues numbered from 1, times as `HH:MM:SS,mmm`.
pub fn srt(captions: &[Caption]) -> String {
    let mut out = String::new();
    for (i, c) in captions.iter().enumerate() {
        out.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            stamp(c.start, ','),
            stamp(c.end, ','),
            c.lines.join("\n")
        ));
    }
    out
}

/// The captions as a WebVTT file: times as `HH:MM:SS.mmm`, with `&`, `<` and `>` escaped.
pub fn vtt(captions: &[Caption]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for c in captions {
        let text = c
            .lines
            .join("\n")
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
        out.push_str(&format!(
            "{} --> {}\n{text}\n\n",
            stamp(c.start, '.'),
            stamp(c.end, '.')
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: Limits = PROFILES[0].limits;
    /// One frame at 24 fps.
    const F: i64 = FLICKS / 24;
    const MS: i64 = FLICKS / 1000;

    fn count(s: &str) -> usize {
        s.chars().count()
    }

    fn spoken<'a>(id: &'a str, text: &'a str, from: i64, each: i64) -> Line<'a> {
        let n = text.split_whitespace().count() as i64;
        Line {
            id,
            text,
            timing: Timing::Words(
                (0..n)
                    .map(|k| (from + k * each, from + (k + 1) * each))
                    .collect(),
            ),
        }
    }

    #[test]
    fn the_shipped_profile_names_its_locale_and_a_source_for_its_values() {
        assert_eq!(
            profile_for("en-GB").map(|p| p.name),
            Some("netflix-en-adult")
        );
        assert!(profile_for("th").is_none());
        // #407: the CJK profiles, and a Traditional Chinese tag that takes none of them.
        assert_eq!(profile_for("ja").map(|p| p.name), Some("netflix-ja"));
        assert_eq!(profile_for("ko-KR").map(|p| p.name), Some("netflix-ko"));
        assert_eq!(
            profile_for("zh-Hans").map(|p| p.name),
            Some("netflix-zh-hans")
        );
        assert!(profile_for("zh-TW").is_none() && profile_for("zh-Hant").is_none());
        assert!(PROFILES.iter().all(|p| !p.sources.is_empty()
            && p.sources
                .iter()
                .all(|(_, page, read)| !page.is_empty() && read.len() == 10)));
    }

    #[test]
    fn the_korean_profile_counts_latin_letters_and_spaces_as_half_a_character() {
        let ko = profile("netflix-ko").unwrap().limits;
        let cap = |line: &str| Caption {
            id: "k.1".into(),
            line: "k".into(),
            lines: vec![line.into()],
            chars: line.chars().count(),
            start: 0,
            end: 7 * FLICKS,
        };
        // 10 Hangul (20 halves), a space and 11 Latin letters: 32 halves, 16 characters.
        let fits = cap("가나다라마바사아자차 abcdefghijk");
        assert!(check(&[fits], &ko, &count)
            .iter()
            .all(|v| v.limit != "max_chars"));
        let over = cap("가나다라마바사아자차 abcdefghijkl");
        assert!(check(&[over], &ko, &count)
            .iter()
            .any(|v| v.limit == "max_chars"));
    }

    #[test]
    fn a_block_only_tightens_its_profile() {
        let block = Block {
            max_chars: Some(60),
            max_cps_milli: Some(17_000),
            min_dur: Some(FLICKS),
            ..Block::default()
        };
        let l = LIMITS.stricter(&block);
        assert_eq!(
            (l.max_chars, l.max_cps_milli, l.min_dur, l.max_lines),
            (42, 17_000, FLICKS, 2)
        );
    }

    #[test]
    fn words_fill_lines_of_42_and_two_lines_make_a_caption() {
        // 27 words of 4 letters: 8 fit a line (8 × 4 + 7 = 39; a ninth makes 44).
        let text = ["word"; 27].join(" ");
        let caps = layout(&[spoken("l", &text, 0, 300 * MS)], &LIMITS, F, &count, &[]).unwrap();
        assert_eq!(
            caps.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(),
            ["l.1", "l.2"]
        );
        assert_eq!(caps[0].lines.len(), 2);
        assert_eq!(caps[0].lines[0], ["word"; 8].join(" "));
        assert_eq!(caps[0].chars, 16 * 4 + 15);
        assert_eq!(
            caps[1].lines,
            [["word"; 8].join(" "), ["word"; 3].join(" ")]
        );
    }

    #[test]
    fn a_caption_runs_from_its_first_words_frame_to_the_frame_at_or_after_its_last_words_end() {
        // Words from 1.010 s to 3.010 s: frame 24 holds the start, frame 73 is the first at or after the end.
        let caps = layout(
            &[spoken("l", "one two three four", 1_010 * MS, 500 * MS)],
            &LIMITS,
            F,
            &count,
            &[],
        )
        .unwrap();
        assert_eq!((caps[0].start, caps[0].end), (24 * F, 73 * F));
        assert!(check(&caps, &LIMITS, &count).is_empty());
    }

    #[test]
    fn a_short_caption_lasts_20_frames_and_a_close_one_ends_2_frames_before_the_next() {
        let lines = [
            spoken("a", "Hi", FLICKS, 100 * MS),
            spoken("b", "one two three four", 2 * FLICKS, 500 * MS),
            spoken("c", "five six", 4 * FLICKS + F, 500 * MS),
        ];
        let caps = layout(&lines, &LIMITS, F, &count, &[]).unwrap();
        assert_eq!((caps[0].start, caps[0].end), (24 * F, 44 * F));
        // b's words end at 4 s, one frame before c starts: it ends two frames before c.
        assert_eq!((caps[1].start, caps[1].end), (48 * F, 95 * F));
        assert_eq!(caps[2].start, 97 * F);
    }

    #[test]
    fn a_caption_line_shows_from_its_t_for_its_characters_at_the_profiles_speed() {
        // 30 characters at 20 a second: 1.5 s, 36 frames.
        let text = "abcde abcde abcde abcde abcdef";
        let caps = layout(
            &[Line {
                id: "n",
                text,
                timing: Timing::At(2 * FLICKS),
            }],
            &LIMITS,
            F,
            &count,
            &[],
        )
        .unwrap();
        assert_eq!(
            (caps[0].chars, caps[0].start, caps[0].end),
            (30, 48 * F, 84 * F)
        );
        assert!(check(&caps, &LIMITS, &count).is_empty());
    }

    #[test]
    fn a_caption_faster_than_20_characters_a_second_fails_naming_it() {
        // 41 characters in 1.5 s is over 27 a second.
        let caps = layout(
            &[spoken(
                "fast",
                "abcdefghij abcdefghij abcdefghij abcdefgh",
                FLICKS,
                375 * MS,
            )],
            &LIMITS,
            F,
            &count,
            &[],
        )
        .unwrap();
        let found = check(&caps, &LIMITS, &count);
        assert_eq!(
            found
                .iter()
                .map(|v| (v.caption.as_str(), v.limit))
                .collect::<Vec<_>>(),
            [("fast.1", "max_cps")]
        );
    }

    #[test]
    fn a_line_whose_word_times_differ_in_number_is_refused_naming_both() {
        let line = Line {
            id: "l",
            text: "one two three",
            timing: Timing::Words(vec![(0, F), (F, 2 * F)]),
        };
        assert_eq!(
            layout(&[line], &LIMITS, F, &count, &[]),
            Err(Mismatch {
                line: "l".into(),
                words: 3,
                times: 2
            })
        );
    }

    /// #157: one caption's in- and out-time, its words from `from` 500 ms each, with `cuts`.
    fn timed(text: &str, from: i64, cuts: &[i64]) -> (i64, i64) {
        let caps = layout(
            &[spoken("a", text, from, 500 * MS)],
            &LIMITS,
            F,
            &count,
            cuts,
        )
        .unwrap();
        (caps[0].start, caps[0].end)
    }

    #[test]
    fn an_out_time_within_half_a_second_before_a_cut_ends_2_frames_before_it() {
        // Its words end at 3.5 s, frame 84.
        assert_eq!(timed("one two three", 2 * FLICKS, &[]), (48 * F, 84 * F));
        // 6 frames before a cut: it ends 2 frames before it.
        assert_eq!(
            timed("one two three", 2 * FLICKS, &[90 * F]),
            (48 * F, 88 * F)
        );
        // 12 frames, half a second, still moves; 13 frames and 0.6 s are left alone.
        assert_eq!(
            timed("one two three", 2 * FLICKS, &[96 * F]),
            (48 * F, 94 * F)
        );
        assert_eq!(
            timed("one two three", 2 * FLICKS, &[97 * F]),
            (48 * F, 84 * F)
        );
        assert_eq!(
            timed("one two three", 2 * FLICKS, &[41 * FLICKS / 10]),
            (48 * F, 84 * F)
        );
        // A cut before its in-time is no cut of its.
        assert_eq!(
            timed("one two three", 2 * FLICKS, &[48 * F, 200 * F]),
            (48 * F, 84 * F)
        );
    }

    #[test]
    fn a_caption_across_a_cut_ends_2_frames_before_it_or_half_a_second_after_it() {
        // Words from 2 s to 4 s (frames 48 to 96), a cut at 3.75 s (frame 90): it ends 2 frames before it.
        assert_eq!(
            timed("one two three four", 2 * FLICKS, &[90 * F]),
            (48 * F, 88 * F)
        );
        // 38 characters can't be read by frame 64 at 20 a second: it ends 12 frames after the cut at frame 66.
        assert_eq!(
            timed("abcdefghi abcdefghi abcdefghi abcdefgh", FLICKS, &[66 * F]),
            (24 * F, 78 * F)
        );
        // Already half a second past the cut: left alone.
        assert_eq!(
            timed("one two three four", 2 * FLICKS, &[84 * F]),
            (48 * F, 96 * F)
        );
    }

    #[test]
    fn a_gap_under_half_a_second_closes_to_2_frames() {
        let two = |b: i64| {
            let lines = [
                spoken("a", "one two", FLICKS, 500 * MS),
                spoken("b", "three four", b, 500 * MS),
            ];
            layout(&lines, &LIMITS, F, &count, &[])
                .unwrap()
                .iter()
                .map(|c| (c.start, c.end))
                .collect::<Vec<_>>()
        };
        // a runs from frame 24 to 48; b 5 frames after it: chained.
        assert_eq!(two(53 * F), [(24 * F, 51 * F), (53 * F, 77 * F)]);
        // Half a second apart: left alone.
        assert_eq!(two(60 * F), [(24 * F, 48 * F), (60 * F, 84 * F)]);
        // A cut in the gap keeps it open: a ends 2 frames before the cut.
        let lines = [
            spoken("a", "one two", FLICKS, 500 * MS),
            spoken("b", "three four", 53 * F, 500 * MS),
        ];
        let caps = layout(&lines, &LIMITS, F, &count, &[50 * F]).unwrap();
        assert_eq!(caps[0].end, 48 * F);
    }

    #[test]
    fn sidecar_times_are_frame_times_rounded_down_to_the_millisecond() {
        // Frame 240 at 24000/1001 is 10.01 s exactly; frame 241 is 10.051708… s.
        let frame = FLICKS / 24_000 * 1001;
        let c = Caption {
            id: "l.1".into(),
            line: "l".into(),
            lines: vec!["a < b".into(), "c".into()],
            chars: 7,
            start: 240 * frame,
            end: 241 * frame,
        };
        assert_eq!(
            srt(std::slice::from_ref(&c)),
            "1\n00:00:10,010 --> 00:00:10,051\na < b\nc\n\n"
        );
        assert_eq!(
            vtt(&[c]),
            "WEBVTT\n\n00:00:10.010 --> 00:00:10.051\na &lt; b\nc\n\n"
        );
    }
}
