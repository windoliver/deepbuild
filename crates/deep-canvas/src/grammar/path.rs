//! Paths: `<section>/<id>[#<sub>]/<field>[/<field>…]`.
//!
//! A sub-address is `[a-z0-9][a-z0-9_.-]{0,47}` (an element, a particle, an anchor or a row key);
//! each field is `[a-z0-9_][a-z0-9_-]{0,47}`, a list index being digits; there is at least one
//! field, and no escaping, since an ID never contains `/`.

use super::id::{gen_id, gen_segment, inject, Id};
use super::seeded::Seeded;
use super::{refuse, Refusal, MAX_SEGMENT_LEN};

const CODE: &str = "bad_path";

/// Why `s` is not a sub-address, or `None` when it is.
fn sub_fault(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > MAX_SEGMENT_LEN {
        return Some(format!(
            "sub-address `{s}` must be 1 to {MAX_SEGMENT_LEN} characters"
        ));
    }
    if !(b[0].is_ascii_lowercase() || b[0].is_ascii_digit()) {
        return Some(format!("sub-address `{s}` must start with [a-z0-9]"));
    }
    if !b
        .iter()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'.' | b'-'))
    {
        return Some(format!(
            "sub-address `{s}` has a character outside [a-z0-9_.-]"
        ));
    }
    None
}

/// Why `s` is not a field, or `None` when it is.
fn field_fault(s: &str) -> Option<String> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > MAX_SEGMENT_LEN {
        return Some(format!(
            "field `{s}` must be 1 to {MAX_SEGMENT_LEN} characters"
        ));
    }
    if !(b[0].is_ascii_lowercase() || b[0].is_ascii_digit() || b[0] == b'_') {
        return Some(format!("field `{s}` must start with [a-z0-9_]"));
    }
    if !b
        .iter()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-'))
    {
        return Some(format!("field `{s}` has a character outside [a-z0-9_-]"));
    }
    None
}

/// The sections a path may start with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Section {
    Items,
    Controls,
    Channels,
    Markers,
    Data,
    Inputs,
    Assemblies,
}

impl Section {
    /// Every section, in the design's order.
    pub const ALL: [Section; 7] = [
        Section::Items,
        Section::Controls,
        Section::Channels,
        Section::Markers,
        Section::Data,
        Section::Inputs,
        Section::Assemblies,
    ];

    /// The section's name.
    pub fn as_str(self) -> &'static str {
        match self {
            Section::Items => "items",
            Section::Controls => "controls",
            Section::Channels => "channels",
            Section::Markers => "markers",
            Section::Data => "data",
            Section::Inputs => "inputs",
            Section::Assemblies => "assemblies",
        }
    }

    /// The section named `s`, if any.
    pub fn parse(s: &str) -> Option<Section> {
        Section::ALL.into_iter().find(|sec| sec.as_str() == s)
    }
}

/// A path into a document: section, ID, an optional sub-address and the fields below.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Path {
    section: Section,
    id: Id,
    sub: Option<String>,
    fields: Vec<String>,
}

impl Path {
    /// Parses a path; refuses with `bad_path`.
    pub fn parse(text: &str) -> Result<Path, Refusal> {
        let bad = |why: String| refuse(CODE, format!("`{text}`: {why}"));
        if !text.is_ascii() {
            return Err(bad("a path is ASCII".into()));
        }
        let mut parts = text.split('/');
        let section = parts.next().unwrap_or("");
        let section = Section::parse(section).ok_or_else(|| {
            bad(format!(
                "section `{section}` is not one of items, controls, channels, markers, data, inputs, assemblies"
            ))
        })?;
        let Some(target) = parts.next() else {
            return Err(bad("a path is `<section>/<id>[#<sub>]/<field>…`".into()));
        };
        let (id, sub) = match target.split_once('#') {
            Some((id, sub)) => {
                if let Some(why) = sub_fault(sub) {
                    return Err(bad(why));
                }
                (id, Some(sub.to_string()))
            }
            None => (target, None),
        };
        // A malformed ID part carries the ID grammar's own code.
        let id = Id::parse(id)?;
        let fields = parts
            .map(|p| match field_fault(p) {
                None => Ok(p.to_string()),
                Some(why) => Err(bad(why)),
            })
            .collect::<Result<Vec<_>, _>>()?;
        if fields.is_empty() {
            return Err(bad("a path names at least one field below the ID".into()));
        }
        Ok(Path {
            section,
            id,
            sub,
            fields,
        })
    }

    /// The section.
    pub fn section(&self) -> Section {
        self.section
    }

    /// The addressed ID.
    pub fn id(&self) -> &Id {
        &self.id
    }

    /// The sub-address after `#`, if any.
    pub fn sub(&self) -> Option<&str> {
        self.sub.as_deref()
    }

    /// The fields below the ID, in order; a list index is its digits.
    pub fn fields(&self) -> &[String] {
        &self.fields
    }

    /// The path's text.
    pub fn print(&self) -> String {
        let mut s = String::from(self.section.as_str());
        s.push('/');
        s.push_str(self.id.as_str());
        if let Some(sub) = &self.sub {
            s.push('#');
            s.push_str(sub);
        }
        for field in &self.fields {
            s.push('/');
            s.push_str(field);
        }
        s
    }
}

fn gen_field(rng: &mut Seeded) -> String {
    match rng.below(4) {
        0 => rng.below(10).to_string(),
        1 => format!("_{}", gen_segment(rng, 8)),
        _ => gen_segment(rng, MAX_SEGMENT_LEN - 1),
    }
}

fn gen_sub(rng: &mut Seeded) -> String {
    let mut s = gen_segment(rng, 8);
    if rng.chance(1, 2) {
        s.push('.');
        s.push_str(&gen_segment(rng, 4));
    }
    s
}

/// A random valid path.
pub fn gen_path(rng: &mut Seeded) -> String {
    let mut s = String::from(rng.pick(&Section::ALL).as_str());
    s.push('/');
    s.push_str(&gen_id(rng));
    if rng.chance(1, 4) {
        s.push('#');
        s.push_str(&gen_sub(rng));
    }
    for _ in 0..rng.range(1, 4) {
        s.push('/');
        s.push_str(&gen_field(rng));
    }
    s
}

/// A random string that is not a path: an unknown section, an empty segment, a missing ID or
/// field, a stray character, a field starting with `-`, or an empty or bad sub-address.
pub fn gen_path_mutant(rng: &mut Seeded) -> String {
    let path = gen_path(rng);
    match rng.below(13) {
        0 => format!(
            "{}/{}",
            rng.pick(&["layers", "item", "Items", ""]),
            gen_id(rng)
        ),
        1 => inject(rng, &path, "//"),
        2 => format!("{path}/"),
        3 => format!("/{path}"),
        4 => inject(rng, &path, " "),
        5 => {
            let upper = char::from(b'A' + rng.below(26) as u8).to_string();
            inject(rng, &path, &upper)
        }
        6 => {
            let what = *rng.pick(&[":", "@", "~", "é"]);
            inject(rng, &path, what)
        }
        7 => format!("{path}/-{}", gen_segment(rng, 4)),
        8 => format!(
            "{}/{}#{}/x",
            rng.pick(&Section::ALL).as_str(),
            gen_id(rng),
            rng.pick(&["", ".a", "_a", "A", "a b"])
        ),
        12 => format!("{}/{}", rng.pick(&Section::ALL).as_str(), gen_id(rng)),
        9 => format!(
            "{}/#{}",
            rng.pick(&Section::ALL).as_str(),
            gen_segment(rng, 8)
        ),
        10 => rng.pick(&Section::ALL).as_str().to_string(),
        _ => inject(rng, &path, "##"),
    }
}
