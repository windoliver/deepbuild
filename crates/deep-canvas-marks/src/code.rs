//! A code item's two forms (canvas primitives: Text `text@1`: code, #406): `raw`, the bytes as
//! its source holds them, and its display text, mapped from raw by fixed steps, each display
//! grapheme keeping the raw byte range it came from; and a quote's check against its source's
//! bytes, which compares raw bytes alone.

use std::ops::Range;

use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;

/// A code item's display form: its text, and each grapheme's range in it with the raw bytes it
/// came from.
pub struct Display {
    pub text: String,
    pub graphemes: Vec<(Range<usize>, Range<usize>)>,
}

/// `raw`'s lines with their ends, each as its byte range: split at LF, CRLF or CR.
fn lines(raw: &[u8]) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let (mut start, mut i) = (0, 0);
    while i < raw.len() {
        let end = match raw[i] {
            b'\r' if raw.get(i + 1) == Some(&b'\n') => i + 2,
            b'\r' | b'\n' => i + 1,
            _ => {
                i += 1;
                continue;
            }
        };
        out.push(start..end);
        (start, i) = (end, end);
    }
    if start < raw.len() {
        out.push(start..raw.len());
    }
    out
}

/// The display form of `raw`: lines split at LF, CRLF or CR with their ends dropped, tabs
/// expanded at `tab` columns, then NFC, one grapheme at a time so each keeps its raw range.
pub fn display(raw: &str, tab: usize) -> Display {
    let tab = tab.max(1);
    let mut d = Display {
        text: String::new(),
        graphemes: Vec::new(),
    };
    for (n, range) in lines(raw.as_bytes()).into_iter().enumerate() {
        if n > 0 {
            d.text.push('\n');
        }
        let line = raw[range.clone()].trim_end_matches(['\r', '\n']);
        let starts = deep_text::unicode::grapheme_starts(line);
        let mut column = 0;
        for (k, &from) in starts.iter().enumerate() {
            let to = starts.get(k + 1).copied().unwrap_or(line.len());
            let at = d.text.len();
            match &line[from..to] {
                "\t" => {
                    let spaces = tab - column % tab;
                    d.text.extend(std::iter::repeat_n(' ', spaces));
                    column += spaces;
                }
                g => {
                    d.text.extend(g.nfc());
                    column += 1;
                }
            }
            let raw_from = range.start + from;
            d.graphemes
                .push((at..d.text.len(), raw_from..range.start + to));
        }
    }
    d
}

/// The numbers a code item's display text shows: each run of digits, with a point between two
/// digits, and the raw byte range that holds it.
pub fn digits(d: &Display) -> Vec<(String, Range<usize>)> {
    let shown = |k: usize| &d.text[d.graphemes[k].0.clone()];
    let digit = |k: usize| shown(k).bytes().all(|b| b.is_ascii_digit()) && !shown(k).is_empty();
    let mut out = Vec::new();
    let mut k = 0;
    while k < d.graphemes.len() {
        if !digit(k) {
            k += 1;
            continue;
        }
        let first = k;
        while k < d.graphemes.len()
            && (digit(k)
                || (shown(k) == "." && k + 1 < d.graphemes.len() && digit(k + 1) && digit(k - 1)))
        {
            k += 1;
        }
        let text = (first..k).map(shown).collect();
        out.push((text, d.graphemes[first].1.start..d.graphemes[k - 1].1.end));
    }
    out
}

/// A code item's `tab` (`code.tab`, 4 by default).
pub fn tab(params: &Map<String, Value>) -> usize {
    params
        .get("code")
        .and_then(|c| c.get("tab"))
        .and_then(Value::as_u64)
        .map_or(4, |t| t as usize)
}

/// Where a quote's raw first differs from its source's lines `[a, b]`, line ends included: the
/// source's line number and the byte within that line. `None` when they are the same bytes.
pub fn mismatch(raw: &[u8], source: &[u8], [a, b]: [usize; 2]) -> Option<(usize, usize)> {
    let quoted: Vec<&[u8]> = lines(source)
        .into_iter()
        .skip(a.saturating_sub(1))
        .take((b + 1).saturating_sub(a))
        .map(|r| &source[r])
        .collect();
    let raw_lines: Vec<&[u8]> = lines(raw).into_iter().map(|r| &raw[r]).collect();
    let n = quoted.len().max(raw_lines.len());
    (0..n).find_map(|k| {
        let (q, r) = (quoted.get(k).copied(), raw_lines.get(k).copied());
        if q == r {
            return None;
        }
        let (q, r) = (q.unwrap_or_default(), r.unwrap_or_default());
        let byte = q.iter().zip(r).take_while(|(x, y)| x == y).count();
        Some((a + k, byte))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_crlf_line_with_a_decomposed_letter_keeps_each_digit_s_raw_range() {
        let raw = "\tretries = 3 # cafe\u{301}\r\n";
        let d = display(raw, 4);
        assert_eq!(d.text, "    retries = 3 # caf\u{e9}");
        assert_eq!(digits(&d), [("3".to_string(), 11..12)]);
        let e = d.graphemes.last().unwrap();
        assert_eq!((&d.text[e.0.clone()], e.1.clone()), ("\u{e9}", 18..21));
    }

    #[test]
    fn a_quote_differs_at_the_first_byte_its_raw_holds_otherwise() {
        let source = b"a = 1\r\nb = 2.5\r\n";
        assert_eq!(mismatch(b"b = 2.5\r\n", source, [2, 2]), None);
        assert_eq!(mismatch(b"b = 2.5\n", source, [2, 2]), Some((2, 7)));
        assert_eq!(
            mismatch(b"a = 1\r\nb = 2.5\r\n", source, [1, 1]),
            Some((2, 0))
        );
        assert_eq!(digits(&display("b = 2.5.", 4)), [("2.5".to_string(), 4..7)]);
    }
}
