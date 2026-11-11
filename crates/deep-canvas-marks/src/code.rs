//! A code item's two forms (canvas primitives: Text `text@1`: code, #406): `raw`, the bytes as
//! its source holds them, and its display text, mapped from raw by fixed steps, each display
//! grapheme keeping the raw byte range it came from; and a quote's check against its source's
//! bytes, which compares raw bytes alone.
//!
//! Issue #1965: raw is bytes, a string's or an asset's (`{asset: sha256}`, which its host reads
//! into `base64`), held to the code's own cap; a byte that isn't UTF-8 shows as U+FFFD; and a
//! token is a byte range into raw with a class of the list, which lands on the display graphemes
//! its bytes hold.

use std::borrow::Cow;
use std::ops::Range;

use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;

use crate::scene::{refuse, Refused};

/// The classes a token takes.
pub const CLASSES: [&str; 10] = [
    "keyword",
    "type",
    "function",
    "variable",
    "string",
    "number",
    "comment",
    "operator",
    "punctuation",
    "plain",
];

/// The most bytes a code item's raw holds, inline or as an asset: 256 KiB.
pub const RAW_CAP: usize = 262_144;

/// The most tokens a code item carries.
pub const MAX_TOKENS: usize = 65_536;

/// A code item's display form: its text, each grapheme's range in it with the raw bytes it
/// came from, and how many bytes raw holds.
pub struct Display {
    pub text: String,
    pub graphemes: Vec<(Range<usize>, Range<usize>)>,
    pub bytes: usize,
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

/// The display form of `raw`: UTF-8 decoded, a byte that isn't shown as U+FFFD; lines split at
/// LF, CRLF or CR with their ends dropped; tabs expanded at `tab` columns; then NFC, one grapheme
/// at a time so each keeps its raw range.
pub fn display(raw: impl AsRef<[u8]>, tab: usize) -> Display {
    let raw = raw.as_ref();
    let tab = tab.max(1);
    let mut d = Display {
        text: String::new(),
        graphemes: Vec::new(),
        bytes: raw.len(),
    };
    for (n, range) in lines(raw).into_iter().enumerate() {
        if n > 0 {
            d.text.push('\n');
        }
        let line = &raw[range.clone()];
        let end = match line {
            [.., b'\r', b'\n'] => line.len() - 2,
            [.., b'\r' | b'\n'] => line.len() - 1,
            _ => line.len(),
        };
        let (mut column, mut at_raw) = (0, range.start);
        for chunk in line[..end].utf8_chunks() {
            let valid = chunk.valid();
            let starts = deep_text::unicode::grapheme_starts(valid);
            for (k, &from) in starts.iter().enumerate() {
                let to = starts.get(k + 1).copied().unwrap_or(valid.len());
                let at = d.text.len();
                match &valid[from..to] {
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
                d.graphemes
                    .push((at..d.text.len(), at_raw + from..at_raw + to));
            }
            at_raw += valid.len();
            for _ in chunk.invalid() {
                let at = d.text.len();
                d.text.push('\u{fffd}');
                column += 1;
                d.graphemes.push((at..d.text.len(), at_raw..at_raw + 1));
                at_raw += 1;
            }
        }
    }
    d
}

/// A code item's raw bytes: its `raw` string's, or its asset's as the item's host read them into
/// `raw.base64`. `None` for an item with no raw, or an asset no host read.
pub fn raw(params: &Map<String, Value>) -> Option<Cow<'_, [u8]>> {
    match params.get("raw")? {
        Value::String(s) => Some(Cow::Borrowed(s.as_bytes())),
        raw => deep_canvas::base64::decode(raw.get("base64")?.as_str()?).map(Cow::Owned),
    }
}

/// A code item's display form as the item at `path` gives it; `None` for a text that isn't code.
/// A raw past [`RAW_CAP`] is refused at `raw` before anything reads it, and an asset no host read
/// is `asset_missing`.
pub fn read(params: &Map<String, Value>, path: &str) -> Result<Option<Display>, Refused> {
    if !params.contains_key("code") || !params.contains_key("raw") {
        return Ok(None);
    }
    let Some(raw) = raw(params) else {
        let named = params.get("raw").and_then(|r| r.get("asset")).is_some();
        let code = if named { "asset_missing" } else { "bad_doc" };
        return refuse(code, format!("{path}/params/raw"));
    };
    if raw.len() > RAW_CAP {
        return refuse("out_of_range", format!("{path}/params/raw"));
    }
    Ok(Some(display(raw, tab(params))))
}

/// A code item's tokens (`code.tokens: [{from, to, class}] ≤ 65,536`) as spans of its display
/// text's graphemes, counted as the shaped run counts them, each with its class, as listed. A
/// token covers the display graphemes whose raw bytes its `[from, to)` holds whole; one that
/// holds none has an empty span. A class outside [`CLASSES`] is refused naming it, and a range
/// that isn't bytes of raw at its `to`.
pub fn tokens(
    params: &Map<String, Value>,
    d: &Display,
    path: &str,
) -> Result<Vec<(Range<usize>, &'static str)>, Refused> {
    let at = |rest: String| format!("{path}/params/code/tokens{rest}");
    let list = match params.get("code").and_then(|c| c.get("tokens")) {
        None => return Ok(Vec::new()),
        Some(Value::Array(list)) if list.len() <= MAX_TOKENS => list,
        Some(Value::Array(_)) => return refuse("out_of_range", at(String::new())),
        Some(_) => return refuse("bad_doc", at(String::new())),
    };
    if list.is_empty() {
        return Ok(Vec::new());
    }
    let starts = deep_text::unicode::grapheme_starts(&d.text);
    let index = |byte: usize| starts.partition_point(|&s| s < byte);
    let mut out = Vec::with_capacity(list.len());
    for (k, token) in list.iter().enumerate() {
        let offset = |key: &str| token.get(key).and_then(Value::as_u64).map(|n| n as usize);
        let (Some(from), Some(to)) = (offset("from"), offset("to")) else {
            return refuse("bad_doc", at(format!("/{k}")));
        };
        if from >= to || to > d.bytes {
            return refuse("out_of_range", at(format!("/{k}/to")));
        }
        let class = match token.get("class") {
            Some(Value::String(class)) => match CLASSES.iter().find(|c| *c == class) {
                Some(class) => *class,
                None => return refuse("out_of_range", at(format!("/{k}/class: {class}"))),
            },
            _ => return refuse("bad_doc", at(format!("/{k}/class"))),
        };
        let first = d.graphemes.partition_point(|(_, raw)| raw.start < from);
        let end = d.graphemes.partition_point(|(_, raw)| raw.end <= to);
        let span = match first < end {
            true => index(d.graphemes[first].0.start)..index(d.graphemes[end - 1].0.end),
            false => 0..0,
        };
        out.push((span, class));
    }
    Ok(out)
}

/// The display graphemes a code item's read-only anchor holds: `line:n`, a line as `first_line`
/// numbers it, or `tok:k`, a token as `tokens` lists it. `None` for any other part, and for a
/// line or a token the item lacks.
pub fn anchor(params: &Map<String, Value>, d: &Display, part: &str) -> Option<Range<usize>> {
    let (kind, n) = part.split_once(':')?;
    let n: usize = n.parse().ok()?;
    match kind {
        "tok" => Some(tokens(params, d, "").ok()?.get(n)?.0.clone()),
        "line" => {
            let first = params.get("code").and_then(|c| c.get("first_line"));
            let line = n.checked_sub(first.and_then(Value::as_u64).map_or(1, |f| f as usize))?;
            let starts = deep_text::unicode::grapheme_starts(&d.text);
            let index = |byte: usize| starts.partition_point(|&s| s < byte);
            let mut at = 0;
            for (i, text) in d.text.split('\n').enumerate() {
                if i == line {
                    return Some(index(at)..index(at + text.len()));
                }
                at += text.len() + 1;
            }
            None
        }
        _ => None,
    }
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
    use serde_json::json;

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

    #[test]
    fn a_byte_that_isn_t_utf_8_shows_as_u_fffd_and_keeps_its_own_byte() {
        // Latin-1: é is the one byte E9, and a lone lead byte follows the digit.
        let raw = b"caf\xe9 = 1\xc3\r\nok";
        let d = display(raw, 4);
        assert_eq!(d.text, "caf\u{fffd} = 1\u{fffd}\nok");
        let shown: Vec<_> = d
            .graphemes
            .iter()
            .filter(|(text, _)| &d.text[text.clone()] == "\u{fffd}")
            .map(|(_, raw)| raw.clone())
            .collect();
        assert_eq!(shown, [3..4, 8..9]);
        assert_eq!(digits(&d), [("1".to_string(), 7..8)]);
        assert_eq!(d.bytes, raw.len());
    }

    fn code(raw: Value, tokens: Value) -> Map<String, Value> {
        json!({"code": {"language": "python", "tokens": tokens}, "raw": raw})
            .as_object()
            .unwrap()
            .clone()
    }

    #[test]
    fn a_token_lands_on_the_display_graphemes_its_bytes_hold_whole() {
        // A tab at column 2, a CRLF, and e then U+0301: bytes 10..13 of the raw.
        let raw = "de\tf\r\n\tcafe\u{301}";
        let p = code(
            json!(raw),
            json!([
                {"from": 0, "to": 2, "class": "keyword"},
                {"from": 2, "to": 3, "class": "plain"},
                {"from": 7, "to": 13, "class": "string"},
                {"from": 9, "to": 11, "class": "comment"},
            ]),
        );
        let d = read(&p, "items/c").unwrap().unwrap();
        assert_eq!(d.text, "de  f\n    caf\u{e9}");
        // The tab is one grapheme a column, the line end one, and the é one; a token that
        // stops between the e and its accent holds the f alone.
        assert_eq!(
            tokens(&p, &d, "items/c").unwrap(),
            [
                (0..2, "keyword"),
                (2..4, "plain"),
                (10..14, "string"),
                (12..13, "comment")
            ]
        );
        // Its anchors: a token as listed, a line as `first_line` numbers it.
        assert_eq!(anchor(&p, &d, "tok:2"), Some(10..14));
        assert_eq!(anchor(&p, &d, "tok:4"), None);
        assert_eq!(anchor(&p, &d, "line:1"), Some(0..5));
        assert_eq!(anchor(&p, &d, "line:2"), Some(6..14));
        assert_eq!(anchor(&p, &d, "line:3"), None);
        assert_eq!(anchor(&p, &d, "line:0"), None);
        let mut from_ten = p.clone();
        from_ten["code"]["first_line"] = json!(10);
        assert_eq!(anchor(&from_ten, &d, "line:11"), Some(6..14));
        assert_eq!(anchor(&from_ten, &d, "line:2"), None);
    }

    #[test]
    fn a_token_outside_the_raw_or_the_list_and_a_raw_past_its_cap_are_refused_where_they_are() {
        let refused = |p: &Map<String, Value>| {
            let d = read(p, "items/c")?.unwrap();
            tokens(p, &d, "items/c").map(|_| ())
        };
        let at = |tokens: Value| refused(&code(json!("ab"), tokens)).unwrap_err().path;
        assert_eq!(
            at(json!([{"from": 0, "to": 1, "class": "identifier"}])),
            "items/c/params/code/tokens/0/class: identifier"
        );
        let to = "items/c/params/code/tokens/1/to";
        let first = json!({"from": 0, "to": 2, "class": "plain"});
        assert_eq!(
            at(json!([first, {"from": 1, "to": 3, "class": "plain"}])),
            to
        );
        assert_eq!(
            at(json!([first, {"from": 1, "to": 1, "class": "plain"}])),
            to
        );
        let many = vec![first.clone(); MAX_TOKENS + 1];
        assert_eq!(at(json!(many)), "items/c/params/code/tokens");
        assert!(refused(&code(json!("ab"), json!(many[1..]))).is_ok());

        let held = "a".repeat(RAW_CAP);
        assert!(refused(&code(json!(held), json!([]))).is_ok());
        let over = refused(&code(json!(format!("{held}a")), json!([]))).unwrap_err();
        assert_eq!(
            (over.code, over.path.as_str()),
            ("out_of_range", "items/c/params/raw")
        );
    }

    #[test]
    fn a_raw_that_is_an_asset_is_the_bytes_its_host_read() {
        let bytes = b"caf\xe9\n";
        let asset = json!({"asset": "0".repeat(64)});
        let unread = read(&code(asset.clone(), json!([])), "items/c")
            .err()
            .unwrap();
        assert_eq!(
            (unread.code, unread.path.as_str()),
            ("asset_missing", "items/c/params/raw")
        );
        let mut read_in = asset;
        read_in["base64"] = json!(deep_canvas::base64::encode(bytes));
        let p = code(read_in, json!([]));
        assert_eq!(raw(&p).as_deref(), Some(&bytes[..]));
        assert_eq!(read(&p, "items/c").unwrap().unwrap().text, "caf\u{fffd}");
    }
}
