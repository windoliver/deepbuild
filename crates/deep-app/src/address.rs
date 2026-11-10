//! Issue #1460: every page's one address. `ask/<id>`, `session/<id>[/<parameter>]`, `project/<id>` or
//! `page/<name>[/<parameter>]`: a record ID or a registered name, never a position. A `deepbuild://` link is the same
//! text behind the scheme. Text with any part that fails its pattern is refused whole: nothing is trimmed or guessed.

use std::fmt;
use std::str::FromStr;

/// Where an address points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Place {
    Ask,
    Session,
    Project,
    Page,
}

impl Place {
    fn word(self) -> &'static str {
        match self {
            Place::Ask => "ask",
            Place::Session => "session",
            Place::Project => "project",
            Place::Page => "page",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Address {
    pub place: Place,
    /// The record's ID, or the page's registered name.
    pub id: String,
    /// A place on the page: a claim on a session's page, a value of a page's parameter.
    pub parameter: Option<String>,
}

/// The link scheme an address may come behind.
pub const SCHEME: &str = "deepbuild://";

impl Address {
    pub fn new(place: Place, id: &str) -> Self {
        Address {
            place,
            id: id.to_owned(),
            parameter: None,
        }
    }

    /// A session's address, from its ID as the record holds it.
    pub fn session(id: &str) -> Self {
        Address::new(Place::Session, id)
    }

    /// An ask's address, from its handle (`ask:<ULID>`) or its bare ULID.
    pub fn ask(handle: &str) -> Self {
        Address::new(Place::Ask, handle.strip_prefix("ask:").unwrap_or(handle))
    }

    pub fn page(name: &str) -> Self {
        Address::new(Place::Page, name)
    }
}

/// An ask's ID: a ULID, as the contracts have it.
fn ulid(text: &str) -> bool {
    text.len() == 26
        && text.starts_with(|c: char| ('0'..='7').contains(&c))
        && text
            .chars()
            .all(|c| c.is_ascii_digit() || (c.is_ascii_uppercase() && !"ILOU".contains(c)))
}

/// Any other part: a record ID or a registered name.
fn part(text: &str) -> bool {
    text.starts_with(|c: char| c.is_ascii_alphanumeric())
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._:-".contains(c))
}

impl FromStr for Address {
    type Err = ();

    fn from_str(text: &str) -> Result<Self, ()> {
        let text = text.strip_prefix(SCHEME).unwrap_or(text);
        let parts: Vec<&str> = text.split('/').collect();
        let place = match parts[0] {
            "ask" => Place::Ask,
            "session" => Place::Session,
            "project" => Place::Project,
            "page" => Place::Page,
            _ => return Err(()),
        };
        let most = match place {
            Place::Ask | Place::Project => 2,
            Place::Session | Place::Page => 3,
        };
        if parts.len() < 2 || parts.len() > most {
            return Err(());
        }
        let id_ok = match place {
            Place::Ask => ulid(parts[1]),
            _ => part(parts[1]),
        };
        if !id_ok || !parts[2..].iter().all(|p| part(p)) {
            return Err(());
        }
        Ok(Address {
            place,
            id: parts[1].to_owned(),
            parameter: parts.get(2).map(|p| (*p).to_owned()),
        })
    }
}

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}/{}", self.place.word(), self.id)?;
        if let Some(parameter) = &self.parameter {
            write!(f, "/{parameter}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ASK: &str = "01MCBKEP00AF27SH36Z7R1YMBQ";
    const SESSION: &str = "8f7c2a4e-1b3d-4e5f-9a6b-7c8d9e0f1a2b";

    #[test]
    fn each_form_reads_back_as_written() {
        for text in [
            format!("ask/{ASK}"),
            format!("session/{SESSION}"),
            format!("session/{SESSION}/{ASK}"),
            "project/deepbuild".to_owned(),
            "page/needs-you".to_owned(),
            "page/agents/claude-code".to_owned(),
        ] {
            let address: Address = text.parse().unwrap_or_else(|()| panic!("{text} refused"));
            assert_eq!(address.to_string(), text);
            let linked: Address = format!("{SCHEME}{text}").parse().unwrap();
            assert_eq!(linked, address);
        }
    }

    #[test]
    fn a_bad_part_refuses_the_whole_text() {
        for text in [
            "",
            "ask",
            "ask/",
            "ask/not-a-ulid",
            &format!("ask/{ASK}/extra"),
            "claim/01MCBKEP00AF27SH36Z7R1YMBQ",
            &format!("session/{SESSION}?answer=yes"),
            &format!("session/{SESSION}/a/b"),
            "session/../etc",
            "session/-x",
            "page/needs you",
            "project/a/b",
            "deepbuild://",
            "row/3",
        ] {
            assert!(text.parse::<Address>().is_err(), "{text} was taken");
        }
    }

    #[test]
    fn an_ask_handle_and_its_ulid_are_one_address() {
        assert_eq!(Address::ask(&format!("ask:{ASK}")), Address::ask(ASK));
        assert_eq!(Address::ask(ASK).to_string(), format!("ask/{ASK}"));
    }
}
