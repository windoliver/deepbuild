//! Issue #407: the core's film audit and flicker check (canvas primitives: Film audit, Flicker
//! check), as pure functions over what the caller read from the evaluated film: how long a text
//! must hold for its graphemes, the first unbroken readable run it holds for, the flashes a run of
//! frames' relative luminance makes in every one-second window, and whether a factual sentence's
//! citation quotes its source word for word with the same numbers.

use serde_json::Value;

/// The film audit's check kind.
pub const FILM_AUDIT: &str = "film.audit";
/// The flicker check's kind.
pub const FILM_FLICKER: &str = "film.flicker";

fn number(input: &Value, k: &str) -> Option<f64> {
    input
        .get(k)
        .and_then(Value::as_f64)
        .filter(|x| x.is_finite())
}

/// When text counts as readable (Film audit: `readable`). A brief may only tighten these, so a
/// looser value in a check input keeps the default.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Readable {
    /// px a frame, at the frame's size.
    pub max_motion: f64,
    pub min_opacity: f64,
    pub min_contrast: f64,
    /// px at the frame's size: the look's minimum, or the input's where larger.
    pub min_size: f64,
}

impl Readable {
    pub fn from_input(input: &Value, look_min: f64) -> Readable {
        let r = input.get("readable").unwrap_or(&Value::Null);
        Readable {
            max_motion: number(r, "max_motion").map_or(0.5, |x| x.clamp(0.0, 0.5)),
            min_opacity: number(r, "min_opacity").map_or(0.95, |x| x.clamp(0.95, 1.0)),
            min_contrast: number(r, "min_contrast").map_or(4.5, |x| x.max(4.5)),
            min_size: number(r, "min_size").map_or(look_min, |x| x.max(look_min)),
        }
    }
}

/// How long a hold must last (Film audit: `hold`), seconds and graphemes a second. A brief may
/// only tighten these: a longer minimum or pad, a slower rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hold {
    pub min: f64,
    pub min_title_card: f64,
    pub pad: f64,
    pub cjk: f64,
    pub other: f64,
}

impl Default for Hold {
    fn default() -> Hold {
        Hold {
            min: 1.5,
            min_title_card: 4.0,
            pad: 1.5,
            cjk: 4.5,
            other: 15.0,
        }
    }
}

impl Hold {
    /// The defaults, `floor` raising the shortest hold (a test build standing in for a stricter
    /// rule), tightened by the check input's `hold`.
    pub fn from_input(input: &Value, floor: Option<f64>) -> Hold {
        let d = Hold::default();
        let h = input.get("hold").unwrap_or(&Value::Null);
        let rate = h.get("rate").unwrap_or(&Value::Null);
        let longer = |x: Option<f64>, def: f64| x.map_or(def, |x| x.max(def));
        let slower = |x: Option<f64>, def: f64| x.filter(|x| *x > 0.0).map_or(def, |x| x.min(def));
        let min = longer(floor, d.min);
        Hold {
            min: longer(number(h, "min"), min),
            min_title_card: longer(number(h, "min_title_card"), d.min_title_card),
            pad: longer(number(h, "pad"), d.pad),
            cjk: slower(number(rate, "cjk"), d.cjk),
            other: slower(number(rate, "other"), d.other),
        }
    }

    /// Seconds a text of `cjk` CJK and `other` other graphemes must hold: max(min, or the title
    /// card's minimum, pad + cjk ÷ rate + other ÷ rate).
    pub fn needed(&self, cjk: usize, other: usize, title_card: bool) -> f64 {
        let floor = if title_card {
            self.min.max(self.min_title_card)
        } else {
            self.min
        };
        floor.max(self.pad + cjk as f64 / self.cjk + other as f64 / self.other)
    }
}

/// One text item at one frame: whether every grapheme it shows is readable, and the string.
#[derive(Clone, Debug, PartialEq)]
pub struct Seen {
    pub readable: bool,
    pub text: String,
}

/// A hold: its first frame and how many frames it lasts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Run {
    pub first: usize,
    pub frames: usize,
}

/// The hold a text keeps over `seen` (one entry per frame, in order): the first unbroken run of
/// readable frames, counted from the frame its string stops changing within that run, so a
/// typewriter's typing or a counter's ticking never counts. None when it is never readable.
pub fn first_run(seen: &[Seen]) -> Option<Run> {
    let start = seen.iter().position(|s| s.readable)?;
    let end = seen[start..]
        .iter()
        .position(|s| !s.readable)
        .map_or(seen.len(), |k| start + k);
    let mut first = start;
    for k in start + 1..end {
        if seen[k].text != seen[k - 1].text {
            first = k;
        }
    }
    Some(Run {
        first,
        frames: end - first,
    })
}

/// The flicker check's thresholds (Flicker check: Fields). A brief may only tighten them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Flicker {
    pub max_flashes: f64,
    pub area: f64,
    pub delta: f64,
    pub darker_max: f64,
}

impl Flicker {
    pub fn from_input(input: &Value) -> Flicker {
        Flicker {
            max_flashes: number(input, "max_flashes").map_or(3.0, |x| x.clamp(0.0, 3.0)),
            area: number(input, "area").map_or(0.25, |x| x.clamp(0.0, 0.25)),
            delta: number(input, "luminance_delta").map_or(0.1, |x| x.clamp(0.0, 0.1)),
            darker_max: number(input, "darker_max").map_or(0.8, |x| x.clamp(0.8, 1.0)),
        }
    }
}

/// How flashes are counted: the rule, or a planted wrong program.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Count {
    /// A flash is a pair of opposing changes, each over the area as the combined share of the
    /// view whose samples make that change at once.
    Pairs,
    /// Planted: every change counted as a flash of its own.
    Singles,
    /// Planted: the whole view's mean luminance compared, never its parts.
    Mean,
}

/// The relative luminance, in linear light, of an sRGB pixel (WCAG's, through the core's sRGB
/// decode).
pub fn luminance(r: u8, g: u8, b: u8) -> f32 {
    let c = |v: u8| crate::color::srgb_decode(f64::from(v) / 255.0);
    (0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)) as f32
}

/// The shares of the view whose samples brighten and darken from `a` to `b` by more than the
/// delta, with the darker of the two below `darker_max`.
pub fn changes(a: &[f32], b: &[f32], f: &Flicker) -> (f64, f64) {
    let n = a.len().min(b.len());
    if n == 0 {
        return (0.0, 0.0);
    }
    let (mut up, mut down) = (0usize, 0usize);
    for (x, y) in a.iter().zip(b) {
        let (x, y) = (f64::from(*x), f64::from(*y));
        if (y - x).abs() > f.delta && x.min(y) < f.darker_max {
            if y > x {
                up += 1;
            } else {
                down += 1;
            }
        }
    }
    (up as f64 / n as f64, down as f64 / n as f64)
}

/// A one-second window holding more flashes than the check allows.
#[derive(Clone, Debug, PartialEq)]
pub struct Flashing {
    /// The first frame of the first flash in the first window holding too many: the frame of
    /// that window's first change.
    pub first: usize,
    /// The frame whose change first made the window too many.
    pub frame: usize,
    /// The window's first and last frame.
    pub window: [usize; 2],
    /// The changes the window holds, and the flashes they make.
    pub changes: usize,
    pub flashes: f64,
}

/// Every run of frames whose one-second windows (`per_second` frames) hold more flashes than
/// `max_flashes`, as one finding naming the first frame that made it too many. `frames` holds
/// each frame's relative luminance samples.
pub fn flashes(frames: &[Vec<f32>], per_second: usize, f: &Flicker, count: Count) -> Vec<Flashing> {
    let per_second = per_second.max(1);
    // The changes between frame k − 1 and frame k, by k.
    let mut at: Vec<usize> = vec![0; frames.len()];
    for k in 1..frames.len() {
        at[k] = match count {
            Count::Mean => {
                let mean = |v: &[f32]| {
                    let n = v.len().max(1) as f64;
                    v.iter().map(|x| f64::from(*x)).sum::<f64>() / n
                };
                let (x, y) = (mean(&frames[k - 1]), mean(&frames[k]));
                usize::from((y - x).abs() > f.delta && x.min(y) < f.darker_max)
            }
            Count::Pairs | Count::Singles => {
                let (up, down) = changes(&frames[k - 1], &frames[k], f);
                usize::from(up > 0.0 && up >= f.area) + usize::from(down > 0.0 && down >= f.area)
            }
        };
    }
    let flashes_of = |changes: usize| match count {
        Count::Singles => changes as f64,
        Count::Pairs | Count::Mean => changes as f64 / 2.0,
    };
    let mut out: Vec<Flashing> = Vec::new();
    let mut inside = 0usize;
    let mut over = false;
    for k in 0..frames.len() {
        inside += at[k];
        if k >= per_second {
            inside -= at[k - per_second];
        }
        let too_many = flashes_of(inside) > f.max_flashes;
        let first = (k + 1).saturating_sub(per_second);
        match (too_many, over) {
            (true, false) => out.push(Flashing {
                first: (first..=k).find(|j| at[*j] > 0).unwrap_or(first),
                frame: k,
                window: [first, k],
                changes: inside,
                flashes: flashes_of(inside),
            }),
            (true, true) => {
                if let Some(last) = out.last_mut() {
                    if inside > last.changes {
                        last.changes = inside;
                        last.flashes = flashes_of(inside);
                        last.window = [first, k];
                    }
                }
            }
            _ => {}
        }
        over = too_many;
    }
    out
}

/// `text` with every run of white space as one space, trimmed.
fn words(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// True when `quote` is found word for word in `source`, white space runs read as one space.
pub fn quoted(source: &str, quote: &str) -> bool {
    let q = words(quote);
    !q.is_empty() && words(source).contains(&q)
}

/// Number words, as the document check reads them (Honest numbers), with their values.
const NUMBER_WORDS: [(&str, f64); 31] = [
    ("zero", 0.0),
    ("one", 1.0),
    ("two", 2.0),
    ("three", 3.0),
    ("four", 4.0),
    ("five", 5.0),
    ("six", 6.0),
    ("seven", 7.0),
    ("eight", 8.0),
    ("nine", 9.0),
    ("ten", 10.0),
    ("eleven", 11.0),
    ("twelve", 12.0),
    ("thirteen", 13.0),
    ("fourteen", 14.0),
    ("fifteen", 15.0),
    ("sixteen", 16.0),
    ("seventeen", 17.0),
    ("eighteen", 18.0),
    ("nineteen", 19.0),
    ("twenty", 20.0),
    ("thirty", 30.0),
    ("forty", 40.0),
    ("fifty", 50.0),
    ("sixty", 60.0),
    ("seventy", 70.0),
    ("eighty", 80.0),
    ("ninety", 90.0),
    ("hundred", 100.0),
    ("thousand", 1000.0),
    ("dozen", 12.0),
];

/// The numbers a text shows, as the document check reads them: each run of digits, with a
/// decimal point or thousands commas inside it, and each number word, in order, as written.
pub fn numbers_in(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut k = 0;
    while k < chars.len() {
        if chars[k].is_ascii_digit() {
            let start = k;
            while k < chars.len()
                && (chars[k].is_ascii_digit()
                    || (matches!(chars[k], '.' | ',')
                        && chars.get(k + 1).is_some_and(char::is_ascii_digit)))
            {
                k += 1;
            }
            out.push(chars[start..k].iter().collect());
        } else if chars[k].is_alphabetic() {
            let start = k;
            while k < chars.len() && chars[k].is_alphabetic() {
                k += 1;
            }
            let word: String = chars[start..k].iter().collect::<String>().to_lowercase();
            if NUMBER_WORDS.iter().any(|(w, _)| *w == word) {
                out.push(word);
            }
        } else {
            k += 1;
        }
    }
    out
}

/// A number as written, read as a value: digits with thousands commas dropped, or a number word.
fn value_of(n: &str) -> Option<f64> {
    if let Some((_, v)) = NUMBER_WORDS.iter().find(|(w, _)| *w == n) {
        return Some(*v);
    }
    n.replace(',', "").parse::<f64>().ok()
}

/// The numbers `sentence` shows that its quote doesn't, by value.
pub fn unquoted_numbers(sentence: &str, quote: &str) -> Vec<String> {
    let quoted: Vec<f64> = numbers_in(quote)
        .iter()
        .filter_map(|n| value_of(n))
        .collect();
    numbers_in(sentence)
        .into_iter()
        .filter(|n| value_of(n).is_none_or(|v| !quoted.contains(&v)))
        .collect()
}

/// `text`'s sentences, each ending at `.`, `!`, `?` or their full-width forms followed by white
/// space or the end, trimmed and never empty.
pub fn sentences(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    for (k, c) in chars.iter().enumerate() {
        current.push(*c);
        let ends = matches!(c, '.' | '!' | '?')
            && chars.get(k + 1).is_none_or(|n| n.is_whitespace())
            || matches!(c, '。' | '！' | '？');
        if ends {
            let s = current.trim().to_string();
            if !s.is_empty() {
                out.push(s);
            }
            current.clear();
        }
    }
    let s = current.trim().to_string();
    if !s.is_empty() {
        out.push(s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn seen(readable: bool, text: &str) -> Seen {
        Seen {
            readable,
            text: text.into(),
        }
    }

    #[test]
    fn a_hold_needs_its_graphemes_at_the_stated_rates() {
        let h = Hold::default();
        let r2 = |x: f64| (x * 100.0).round() / 100.0;
        assert_eq!(r2(h.needed(0, 14, false)), 2.43);
        assert_eq!(r2(h.needed(0, 17, false)), 2.63);
        assert_eq!(r2(h.needed(7, 2, false)), 3.19);
        assert_eq!(h.needed(0, 3, true), 4.0);
        assert_eq!(h.needed(0, 0, false), 1.5);
        // A brief only tightens; a test build's floor raises the minimum.
        let loose = Hold::from_input(&json!({"hold": {"min": 1.0, "rate": {"other": 30}}}), None);
        assert_eq!(loose, h);
        assert_eq!(Hold::from_input(&json!({}), Some(2.0)).min, 2.0);
    }

    #[test]
    fn a_hold_counts_from_the_last_change_of_its_first_readable_run() {
        // Typing for three frames, readable for four, gone, then readable again.
        let s = [
            seen(false, ""),
            seen(true, "T"),
            seen(true, "Th"),
            seen(true, "The"),
            seen(true, "The"),
            seen(true, "The"),
            seen(true, "The"),
            seen(false, "The"),
            seen(true, "The"),
        ];
        assert_eq!(
            first_run(&s),
            Some(Run {
                first: 3,
                frames: 4
            })
        );
        assert_eq!(first_run(&[seen(false, "cut")]), None);
    }

    fn square(frames: usize, period: usize, region: &dyn Fn(usize, bool) -> f32) -> Vec<Vec<f32>> {
        (0..frames)
            .map(|k| {
                let high = (k / (period / 2)) % 2 == 0;
                (0..100).map(|i| region(i, high)).collect()
            })
            .collect()
    }

    #[test]
    fn opposing_changes_make_flashes_counted_in_every_second() {
        let f = Flicker::from_input(&json!({}));
        // A quarter of the view swinging 0.15 on mid-grey at 2 Hz (24 fps): four changes, two flashes.
        let quarter = |hz_period: usize| {
            square(48, hz_period, &|i, high| {
                if i < 25 {
                    if high {
                        0.35
                    } else {
                        0.2
                    }
                } else {
                    0.5
                }
            })
        };
        assert!(flashes(&quarter(12), 24, &f, Count::Pairs).is_empty());
        // At 4 Hz: eight changes, four flashes, failing.
        let fast = flashes(&quarter(6), 24, &f, Count::Pairs);
        assert_eq!(fast.len(), 1);
        assert!(fast[0].flashes > 3.0);
        // The window's first change, at frame 3 (the first flip), names the flash.
        assert_eq!(fast[0].first, 3);
        // The planted count of single changes fails the 2 Hz quarter.
        assert!(!flashes(&quarter(12), 24, &f, Count::Singles).is_empty());
        // Two halves in counter-phase at 2 Hz fail; the planted whole-view mean passes them.
        let halves = square(48, 12, &|i, high| if (i < 50) == high { 0.35 } else { 0.2 });
        assert!(!flashes(&halves, 24, &f, Count::Pairs).is_empty());
        assert!(flashes(&halves, 24, &f, Count::Mean).is_empty());
        // Print wear on a near-white sky: ±5% never counts.
        let wear = square(48, 6, &|i, high| {
            if i < 25 {
                if high {
                    0.945
                } else {
                    0.855
                }
            } else {
                0.9
            }
        });
        assert!(flashes(&wear, 24, &f, Count::Pairs).is_empty());
    }

    #[test]
    fn a_quote_is_found_word_for_word_and_its_numbers_match() {
        let source = "The trail climbs 3.4 km to the hut,\n then  descends.";
        assert!(quoted(source, "climbs 3.4 km to the hut, then descends"));
        assert!(!quoted(source, "climbs 3.4 km to the cabin"));
        assert!(!quoted(source, ""));
        assert_eq!(
            unquoted_numbers("It climbs 3.2 km.", "climbs 3.4 km"),
            ["3.2"]
        );
        assert!(
            unquoted_numbers("It climbs 3.4 km, one hut.", "climbs 3.4 km to one hut").is_empty()
        );
        assert!(unquoted_numbers("1,000 steps", "1000 steps").is_empty());
        assert_eq!(
            sentences("One. Two 3.5 km! 三。"),
            ["One.", "Two 3.5 km!", "三。"]
        );
    }
}
