//! Item IDs and order keys. An ID is the layer's `nm` when the ID grammar accepts it and no
//! earlier layer took it; otherwise it is sanitised into the grammar and made unique with `.2`,
//! `.3`, … in layer order. Order keys are fixed-width base-62, so they sort as they're made.

use std::collections::BTreeSet;

use deep_canvas::grammar::{Id, MAX_SEGMENTS, MAX_SEGMENT_LEN};

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// The `n`-th order key among siblings, drawn above every key before it.
pub fn order(n: usize) -> String {
    let mut digits = [b'0'; 4];
    let mut k = n.min(62usize.pow(4) - 1);
    for d in digits.iter_mut().rev() {
        *d = DIGITS[k % 62];
        k /= 62;
    }
    format!("a{}", String::from_utf8_lossy(&digits))
}

/// `text` in the ID grammar: lower case, every other character `_`, runs of `_` as one, each
/// segment starting with a letter or digit, at most eight segments of 48 characters; `fallback`
/// when nothing is left.
pub fn sanitize(text: &str, fallback: &str) -> String {
    let lowered: String = text
        .chars()
        .map(|c| match c.to_ascii_lowercase() {
            c @ ('a'..='z' | '0'..='9' | '_' | '-' | '.') => c,
            _ => '_',
        })
        .collect();
    let segments: Vec<String> = lowered
        .split('.')
        .map(|s| {
            let mut seg = String::new();
            for c in s.chars() {
                if !(c == '_' && seg.ends_with('_')) {
                    seg.push(c);
                }
            }
            let seg = seg.trim_start_matches(['_', '-']).to_string();
            seg.chars().take(MAX_SEGMENT_LEN).collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .take(MAX_SEGMENTS)
        .collect();
    if segments.is_empty() {
        return fallback.to_string();
    }
    segments.join(".")
}

/// The IDs taken so far, across every section that shares the item namespace.
#[derive(Default)]
pub struct Ids {
    taken: BTreeSet<String>,
}

impl Ids {
    /// `wanted` when it is an ID no one took; else it sanitised (or `fallback`), then with `.2`,
    /// `.3`, … until it is free.
    pub fn take(&mut self, wanted: &str, fallback: &str) -> String {
        if Id::parse(wanted).is_ok() && !self.taken.contains(wanted) {
            self.taken.insert(wanted.to_string());
            return wanted.to_string();
        }
        let base = sanitize(wanted, fallback);
        let base = if Id::parse(&base).is_ok() {
            base
        } else {
            sanitize(fallback, "item")
        };
        if !self.taken.contains(&base) {
            self.taken.insert(base.clone());
            return base;
        }
        // Room for one more segment.
        let room: Vec<&str> = base.split('.').take(MAX_SEGMENTS - 1).collect();
        let stem = room.join(".");
        let mut n = 2;
        loop {
            let id = format!("{stem}.{n}");
            if !self.taken.contains(&id) {
                self.taken.insert(id.clone());
                return id;
            }
            n += 1;
        }
    }

    /// An ID under `parent`: `<parent>.<part>` while the grammar has room, else the part alone.
    pub fn under(&mut self, parent: &str, part: &str) -> String {
        let part = sanitize(part, "part");
        let joined = format!("{parent}.{part}");
        let wanted = if Id::parse(&joined).is_ok() {
            joined
        } else {
            part
        };
        self.take(&wanted, "part")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_the_grammar_takes_is_kept_and_a_second_one_is_numbered() {
        let mut ids = Ids::default();
        assert_eq!(ids.take("dots", "layer"), "dots");
        assert_eq!(ids.take("dots", "layer"), "dots.2");
        assert_eq!(ids.take("dots", "layer"), "dots.3");
        assert_eq!(ids.take("Shape Layer 1", "layer"), "shape_layer_1");
        assert_eq!(ids.take("Shape Layer 1", "layer"), "shape_layer_1.2");
        assert_eq!(ids.take("(((", "layer"), "layer");
    }

    #[test]
    fn order_keys_sort_as_they_are_made() {
        let keys: Vec<String> = (0..200).map(order).collect();
        let mut sorted = keys.clone();
        sorted.sort();
        assert_eq!(keys, sorted);
    }
}
