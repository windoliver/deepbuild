//! Handles: `<scheme>:<id>[#<fragment>]`.

use super::id::{inject, replace_one};
use super::seeded::Seeded;
use super::{refuse, Refusal};

const CODE: &str = "bad_handle";
/// Crockford base32, as a ULID is written.
const CROCKFORD: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const HEX: &[u8] = b"0123456789abcdef";
const FRAGMENT: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-";
/// The longest fragment accepted.
const MAX_FRAGMENT_LEN: usize = 128;

/// The closed list of record schemes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scheme {
    Task,
    Ask,
    Claim,
    Verdict,
    Run,
    Req,
    Decision,
    Plan,
    Lease,
    Reading,
    Notice,
    Doc,
    Ev,
    Session,
}

impl Scheme {
    /// Every scheme, in the design's order.
    pub const ALL: [Scheme; 14] = [
        Scheme::Task,
        Scheme::Ask,
        Scheme::Claim,
        Scheme::Verdict,
        Scheme::Run,
        Scheme::Req,
        Scheme::Decision,
        Scheme::Plan,
        Scheme::Lease,
        Scheme::Reading,
        Scheme::Notice,
        Scheme::Doc,
        Scheme::Ev,
        Scheme::Session,
    ];

    /// The scheme's name, without the colon.
    pub fn as_str(self) -> &'static str {
        match self {
            Scheme::Task => "task",
            Scheme::Ask => "ask",
            Scheme::Claim => "claim",
            Scheme::Verdict => "verdict",
            Scheme::Run => "run",
            Scheme::Req => "req",
            Scheme::Decision => "decision",
            Scheme::Plan => "plan",
            Scheme::Lease => "lease",
            Scheme::Reading => "reading",
            Scheme::Notice => "notice",
            Scheme::Doc => "doc",
            Scheme::Ev => "ev",
            Scheme::Session => "session",
        }
    }

    /// The scheme named `s`, if any.
    pub fn parse(s: &str) -> Option<Scheme> {
        Scheme::ALL.into_iter().find(|scheme| scheme.as_str() == s)
    }
}

/// A record's ID: its ULID, or a content hash for a definition.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum HandleId {
    /// 26 Crockford base32 characters, the first at most `7`.
    Ulid(String),
    /// 64 lower-case hex characters.
    Hash(String),
}

impl HandleId {
    /// A ULID or a content hash; the error says what the text is neither of.
    pub fn parse(s: &str) -> Result<HandleId, String> {
        let b = s.as_bytes();
        if b.len() == 26 && b[0] <= b'7' && b.iter().all(|c| CROCKFORD.contains(c)) {
            return Ok(HandleId::Ulid(s.to_string()));
        }
        if b.len() == 64 && b.iter().all(|c| HEX.contains(c)) {
            return Ok(HandleId::Hash(s.to_string()));
        }
        Err(format!(
            "id `{s}` is neither a ULID (26 Crockford base32 characters starting at most at 7) nor a content hash (64 lower-case hex characters)"
        ))
    }

    /// The ID's text.
    pub fn as_str(&self) -> &str {
        match self {
            HandleId::Ulid(s) | HandleId::Hash(s) => s,
        }
    }
}

/// A handle to a record object, optionally to a part of it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Handle {
    scheme: Scheme,
    id: HandleId,
    fragment: Option<String>,
}

impl Handle {
    /// Parses `<scheme>:<id>[#<fragment>]`; refuses with `bad_handle`.
    pub fn parse(text: &str) -> Result<Handle, Refusal> {
        let bad = |why: String| refuse(CODE, format!("`{text}`: {why}"));
        if !text.is_ascii() {
            return Err(bad("a handle is ASCII".into()));
        }
        let Some((scheme, rest)) = text.split_once(':') else {
            return Err(bad("a handle is `<scheme>:<id>[#<fragment>]`".into()));
        };
        let scheme = Scheme::parse(scheme).ok_or_else(|| {
            bad(format!(
                "scheme `{scheme}` is not one of {}",
                Scheme::ALL
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })?;
        let (id, fragment) = match rest.split_once('#') {
            Some((id, fragment)) => {
                let ok = fragment.len() <= MAX_FRAGMENT_LEN
                    && fragment
                        .bytes()
                        .next()
                        .is_some_and(|c| c.is_ascii_alphanumeric())
                    && fragment.bytes().all(|c| FRAGMENT.contains(&c));
                if !ok {
                    return Err(bad(format!(
                        "fragment `{fragment}` must be 1 to {MAX_FRAGMENT_LEN} characters of [A-Za-z0-9_.-], starting with [A-Za-z0-9]"
                    )));
                }
                (id, Some(fragment.to_string()))
            }
            None => (rest, None),
        };
        let id = HandleId::parse(id).map_err(bad)?;
        Ok(Handle {
            scheme,
            id,
            fragment,
        })
    }

    /// The scheme.
    pub fn scheme(&self) -> Scheme {
        self.scheme
    }

    /// The record's ID.
    pub fn id(&self) -> &HandleId {
        &self.id
    }

    /// The fragment after `#`, if any.
    pub fn fragment(&self) -> Option<&str> {
        self.fragment.as_deref()
    }

    /// The handle's text.
    pub fn print(&self) -> String {
        let mut s = format!("{}:{}", self.scheme.as_str(), self.id.as_str());
        if let Some(fragment) = &self.fragment {
            s.push('#');
            s.push_str(fragment);
        }
        s
    }
}

fn gen_ulid(rng: &mut Seeded) -> String {
    let mut s = String::with_capacity(26);
    s.push(char::from(b'0' + rng.below(8) as u8));
    while s.len() < 26 {
        s.push(char::from(*rng.pick(CROCKFORD)));
    }
    s
}

fn gen_hash(rng: &mut Seeded) -> String {
    (0..64).map(|_| char::from(*rng.pick(HEX))).collect()
}

fn gen_fragment(rng: &mut Seeded) -> String {
    let len = rng.range(0, 11) as usize;
    let first = loop {
        let c = *rng.pick(FRAGMENT);
        if c.is_ascii_alphanumeric() {
            break char::from(c);
        }
    };
    std::iter::once(first)
        .chain((0..len).map(|_| char::from(*rng.pick(FRAGMENT))))
        .collect()
}

/// A random valid handle.
pub fn gen_handle(rng: &mut Seeded) -> String {
    let id = if rng.chance(1, 3) {
        gen_hash(rng)
    } else {
        gen_ulid(rng)
    };
    let mut s = format!("{}:{id}", rng.pick(&Scheme::ALL).as_str());
    if rng.chance(1, 2) {
        s.push('#');
        s.push_str(&gen_fragment(rng));
    }
    s
}

/// A random string that is not a handle: an unknown or capitalized scheme, no colon, an ID of
/// the wrong length, alphabet or first character, or a bad fragment.
pub fn gen_handle_mutant(rng: &mut Seeded) -> String {
    let scheme = rng.pick(&Scheme::ALL).as_str();
    let ulid = gen_ulid(rng);
    let hash = gen_hash(rng);
    match rng.below(14) {
        0 => format!("{}:{ulid}", rng.pick(&["job", "Task", "", "ev2", "task "])),
        1 => format!("{scheme}{ulid}"),
        2 => format!("{scheme}:{}", &ulid[1..]),
        3 => format!("{scheme}:{ulid}{}", char::from(*rng.pick(CROCKFORD))),
        4 => format!(
            "{scheme}:{}{}",
            char::from(b'8' + rng.below(2) as u8),
            &ulid[1..]
        ),
        5 => {
            let what = *rng.pick(&["I", "L", "O", "U"]);
            format!("{scheme}:{}", replace_one(rng, &ulid, what))
        }
        6 => format!("{scheme}:{}", replace_one(rng, &ulid, "z")),
        7 => format!("{scheme}:{}", &hash[1..]),
        8 => format!("{scheme}:{hash}{}", char::from(*rng.pick(HEX))),
        9 => {
            let what = *rng.pick(&["A", "g", "-", " "]);
            format!("{scheme}:{}", replace_one(rng, &hash, what))
        }
        10 => format!("{scheme}:{ulid}#{}", rng.pick(&["", ".x", "-x", "_x"])),
        11 => {
            let fragment = gen_fragment(rng);
            let what = *rng.pick(&["/", " ", ":", "#", "é"]);
            format!("{scheme}:{ulid}#{}", inject(rng, &fragment, what))
        }
        12 => format!("{scheme}:"),
        _ => inject(rng, &format!("{scheme}:{ulid}"), " "),
    }
}
