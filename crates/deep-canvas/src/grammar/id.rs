//! IDs, temporary patch IDs and sub-addresses.

use super::number::parse_positive;
use super::seeded::Seeded;
use super::{is_segment, refuse, Refusal, MAX_SEGMENTS, MAX_SEGMENT_LEN};

const CODE: &str = "bad_id";

/// Why a segment is not one, or `None` when it is.
pub(crate) fn segment_fault(seg: &str) -> Option<String> {
    if seg.is_empty() {
        return Some("an empty segment".into());
    }
    if seg.len() > MAX_SEGMENT_LEN {
        return Some(format!(
            "segment `{seg}` is longer than {MAX_SEGMENT_LEN} characters"
        ));
    }
    let b = seg.as_bytes();
    if !(b[0].is_ascii_lowercase() || b[0].is_ascii_digit()) {
        return Some(format!("segment `{seg}` must start with [a-z0-9]"));
    }
    if !is_segment(seg) {
        return Some(format!(
            "segment `{seg}` has a character outside [a-z0-9_-]"
        ));
    }
    None
}

fn id_fault(text: &str) -> Option<String> {
    for forbidden in ['/', '#', ':', '@', '~', ' '] {
        if text.contains(forbidden) {
            return Some(format!("an ID never contains `{forbidden}`"));
        }
    }
    let segments: Vec<&str> = text.split('.').collect();
    if segments.len() > MAX_SEGMENTS {
        return Some(format!(
            "{} segments; an ID has at most {MAX_SEGMENTS}",
            segments.len()
        ));
    }
    segments.iter().find_map(|seg| segment_fault(seg))
}

/// An ID: 1 to 8 segments joined by `.`, each `[a-z0-9][a-z0-9_-]{0,47}`.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Id(String);

impl Id {
    /// Parses an ID; refuses with `bad_id`.
    pub fn parse(text: &str) -> Result<Id, Refusal> {
        match id_fault(text) {
            None => Ok(Id(text.to_string())),
            Some(why) => Err(refuse(CODE, format!("`{text}`: {why}"))),
        }
    }

    /// The ID's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The ID's text (the same as [`Id::as_str`], named like the other printers).
    pub fn print(&self) -> String {
        self.0.clone()
    }

    /// The segments in order.
    pub fn segments(&self) -> impl Iterator<Item = &str> {
        self.0.split('.')
    }
}

/// An ID as a patch names it: a permanent ID or a temporary `~n` valid inside that patch only.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum PatchId {
    /// A document ID.
    Permanent(Id),
    /// `~n` for a positive `n`.
    Temporary(u64),
}

impl PatchId {
    /// Parses an ID or a temporary `~n`; refuses with `bad_id`.
    pub fn parse(text: &str) -> Result<PatchId, Refusal> {
        match text.strip_prefix('~') {
            Some(n) => parse_positive(n).map(PatchId::Temporary).ok_or_else(|| {
                refuse(
                    CODE,
                    format!("`{text}`: a temporary ID is `~` then a positive decimal"),
                )
            }),
            None => Id::parse(text).map(PatchId::Permanent),
        }
    }

    /// The ID's text.
    pub fn print(&self) -> String {
        match self {
            PatchId::Permanent(id) => id.print(),
            PatchId::Temporary(n) => format!("~{n}"),
        }
    }
}

/// `<id>#<sub>`: a part of an item that isn't an item.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct SubAddress {
    id: Id,
    sub: String,
}

impl SubAddress {
    /// Parses `<id>#<sub>`; refuses with `bad_id`.
    pub fn parse(text: &str) -> Result<SubAddress, Refusal> {
        let Some((id, sub)) = text.split_once('#') else {
            return Err(refuse(
                CODE,
                format!("`{text}`: a sub-address is `<id>#<sub>`"),
            ));
        };
        let id = Id::parse(id)?;
        match segment_fault(sub) {
            None => Ok(SubAddress {
                id,
                sub: sub.to_string(),
            }),
            Some(why) => Err(refuse(CODE, format!("`{text}`: sub-address {why}"))),
        }
    }

    /// The item.
    pub fn id(&self) -> &Id {
        &self.id
    }

    /// The part.
    pub fn sub(&self) -> &str {
        &self.sub
    }

    /// The text `<id>#<sub>`.
    pub fn print(&self) -> String {
        format!("{}#{}", self.id.as_str(), self.sub)
    }
}

const SEGMENT_FIRST: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
const SEGMENT_REST: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789_-";

/// A random segment of 1 to `max_len` characters.
pub(crate) fn gen_segment(rng: &mut Seeded, max_len: usize) -> String {
    let len = match rng.below(4) {
        0 => 1,
        1 => rng.range(1, 4),
        2 => rng.range(1, 12),
        _ => rng.range(1, max_len as u64),
    } as usize;
    let mut s = String::with_capacity(len);
    s.push(char::from(*rng.pick(SEGMENT_FIRST)));
    while s.len() < len {
        s.push(char::from(*rng.pick(SEGMENT_REST)));
    }
    s
}

/// A random valid ID.
pub fn gen_id(rng: &mut Seeded) -> String {
    let count = match rng.below(3) {
        0 => 1,
        1 => rng.range(1, 3),
        _ => rng.range(1, MAX_SEGMENTS as u64),
    };
    (0..count)
        .map(|_| gen_segment(rng, MAX_SEGMENT_LEN))
        .collect::<Vec<_>>()
        .join(".")
}

/// Inserts `what` at a random position of `s`.
pub(crate) fn inject(rng: &mut Seeded, s: &str, what: &str) -> String {
    let at = rng.below(s.len() as u64 + 1) as usize;
    format!("{}{}{}", &s[..at], what, &s[at..])
}

/// Replaces a random character of `s` with `what`.
pub(crate) fn replace_one(rng: &mut Seeded, s: &str, what: &str) -> String {
    if s.is_empty() {
        return what.to_string();
    }
    let at = rng.below(s.len() as u64) as usize;
    format!("{}{}{}", &s[..at], what, &s[at + 1..])
}

/// A random string that is not an ID: a forbidden character, a ninth segment, a 49-character
/// segment, an empty segment, a bad first character or an empty string.
pub fn gen_id_mutant(rng: &mut Seeded) -> String {
    let id = gen_id(rng);
    match rng.below(12) {
        0 => inject(rng, &id, "/"),
        1 => inject(rng, &id, " "),
        2 => {
            let upper = char::from(b'A' + rng.below(26) as u8).to_string();
            inject(rng, &id, &upper)
        }
        3 => {
            let what = *rng.pick(&["#", ":", "@", "~"]);
            inject(rng, &id, what)
        }
        4 => (0..MAX_SEGMENTS + 1)
            .map(|_| gen_segment(rng, 4))
            .collect::<Vec<_>>()
            .join("."),
        5 => {
            let long: String = (0..MAX_SEGMENT_LEN + 1).map(|_| 'a').collect();
            format!("{id}.{long}")
        }
        6 => format!(".{id}"),
        7 => format!("{id}."),
        8 => inject(rng, &id, ".."),
        9 => format!("{}{id}", rng.pick(&["-", "_"])),
        10 => String::new(),
        _ => inject(rng, &id, "é"),
    }
}
