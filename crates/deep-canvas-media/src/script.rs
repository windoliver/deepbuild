//! Issue #502: a narration line with a recording (canvas primitives: Narration and captions).
//! The line plays its asset from `in` to `out` at its `t`; its words come from the words bake's
//! record of that asset, moved to document time, and each makes a word marker.

/// The record's words a line speaks, as (start, end) in document time: those that start at or
/// after `in` and before `out`, a word at s in the asset sounding at t + (s − in).
pub fn counted(words: &[(i64, i64)], t: i64, r#in: i64, out: i64) -> Vec<(i64, i64)> {
    words
        .iter()
        .filter(|(s, _)| *s >= r#in && *s < out)
        .map(|(s, e)| (t + (s - r#in), t + (e - r#in)))
        .collect()
}

/// A word's text in its marker's name: every character but letters, digits, `_`, `'` and `-`
/// left out.
pub fn marker_text(word: &str) -> String {
    word.chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, '_' | '\'' | '-'))
        .collect()
}

/// Each word's marker name, `<line>.word:<text>#k`, with k counting that text's matches in the
/// line from 1.
pub fn marker_names(line: &str, words: &[&str]) -> Vec<String> {
    let texts: Vec<String> = words.iter().map(|w| marker_text(w)).collect();
    texts
        .iter()
        .enumerate()
        .map(|(i, text)| {
            let k = texts[..=i].iter().filter(|t| *t == text).count();
            format!("{line}.word:{text}#{k}")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_in_the_asset_sounds_at_t_plus_its_time_less_in_and_only_words_inside_the_take_count()
    {
        let words = [(100, 200), (300, 450), (500, 600), (900, 950)];
        assert_eq!(
            counted(&words, 10_000, 300, 900),
            [(10_000, 10_150), (10_200, 10_300)]
        );
    }

    #[test]
    fn a_words_marker_counts_its_texts_matches_in_the_line() {
        assert_eq!(
            marker_names("l1", &["So,", "many", "so", "MANY", "many."]),
            [
                "l1.word:So#1",
                "l1.word:many#1",
                "l1.word:so#1",
                "l1.word:MANY#1",
                "l1.word:many#2"
            ]
        );
    }
}
