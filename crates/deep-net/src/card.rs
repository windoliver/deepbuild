//! One start for every copy (canvas primitives: Net `net@1`): each plays the piece from its start
//! with the same document, input track, module-set digest and runtime digest, which names the
//! physics pin, or can't join, naming what differs. A copy's start card holds those; the first
//! player's link carries the match ID and its card in its fragment, which the host serving the
//! piece never sees, so a copy that differs is refused before it sends anything.

use deep_canvas::canon::{revision_hash, NoShape};
use deep_canvas::registry::{Equivalence, Sealed, StateClass};
use deep_relay::wire::{self, MatchId};
use serde_json::{json, Value};

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Card {
    /// The SHA-256 of the document's bytes, and of the recorded input track's, at the start.
    pub document: String,
    pub track: String,
    /// A d1 digest over the piece's canvas modules, `[{name, version, digest}]` by name: those
    /// its `requires` names and those of its items' kinds.
    pub set: String,
    pub modules: Vec<Value>,
    /// The build's runtime digest, and what it covers: `[{interface, implementation, version,
    /// pins}]`.
    pub runtime: String,
    pub pins: Vec<Value>,
}

/// What differs between a copy and the match it would join.
#[derive(Clone, Debug, PartialEq)]
pub struct Mismatch {
    /// `document`, `input track`, a canvas module's name or an interface's (`physics@1`).
    pub what: String,
    pub here: Value,
    pub theirs: Value,
}

impl Mismatch {
    pub fn to_json(&self) -> Value {
        json!({"mismatch": {"what": self.what, "here": self.here, "match": self.theirs}})
    }

    /// One line for the Join prompt, naming what differs and both sides.
    pub fn text(&self) -> String {
        let side = |v: &Value| match v {
            Value::String(s) => s.clone(),
            v => {
                let pins: Vec<String> = v["pins"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(name, p)| {
                        format!(" with {name} {}", p["version"].as_str().unwrap_or("?"))
                    })
                    .collect();
                let name = v["implementation"].as_str().or(v["name"].as_str());
                format!(
                    "{} {}{}",
                    name.unwrap_or("none"),
                    v["version"].as_str().unwrap_or("none"),
                    pins.concat()
                )
            }
        };
        format!(
            "This copy can't join the match: its {} differs. This copy holds {}; the match holds {}.",
            self.what,
            side(&self.here),
            side(&self.theirs)
        )
    }
}

impl Card {
    /// The card of `form` in the build `sealed` holds, its document and recorded track by hash.
    pub fn of(sealed: &Sealed, form: &Value, document: String, track: String) -> Card {
        let mut names: Vec<String> = form
            .pointer("/requires/modules")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(name, _)| name.clone())
            .collect();
        for item in form
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let kind = item.1.get("kind").and_then(Value::as_str).unwrap_or("");
            let module = sealed.module_of_kind(kind.split('@').next().unwrap_or(kind));
            names.extend(module.map(str::to_string));
        }
        names.sort();
        names.dedup();
        let modules: Vec<Value> = sealed
            .modules
            .iter()
            .filter(|m| names.contains(&m.name))
            .map(|m| json!({"name": m.name, "version": m.version.to_string(), "digest": m.digest}))
            .collect();
        let pins = sealed
            .interfaces
            .iter()
            .filter(|i| {
                let m = &i.implementation;
                m.state == StateClass::BackendBytes || m.equivalence == Equivalence::Measured
            })
            .map(|i| {
                let m = i.implementation.to_json();
                json!({"interface": i.name, "implementation": m["name"], "version": m["version"], "pins": m["pins"]})
            })
            .collect();
        Card {
            document,
            track,
            set: revision_hash(&json!(modules), &NoShape).unwrap_or_default(),
            modules,
            runtime: sealed.runtime_digest.clone(),
            pins,
        }
    }

    pub fn to_json(&self) -> Value {
        json!({"document": self.document, "track": self.track, "set": self.set, "modules": self.modules,
               "runtime": self.runtime, "pins": self.pins})
    }

    pub fn from_json(v: &Value) -> Option<Card> {
        let text = |k: &str| Some(v.get(k)?.as_str()?.to_string());
        Some(Card {
            document: text("document")?,
            track: text("track")?,
            set: text("set")?,
            modules: v.get("modules")?.as_array()?.clone(),
            runtime: text("runtime")?,
            pins: v.get("pins")?.as_array()?.clone(),
        })
    }

    /// What differs between this copy and the match `theirs` opened, if anything: the document,
    /// the input track, the first canvas module, then the first interface the runtime digest
    /// covers.
    pub fn differs(&self, theirs: &Card) -> Option<Mismatch> {
        let text = |what: &str, here: &str, theirs: &str| Mismatch {
            what: what.into(),
            here: json!(here),
            theirs: json!(theirs),
        };
        if self.document != theirs.document {
            return Some(text("document", &self.document, &theirs.document));
        }
        if self.track != theirs.track {
            return Some(text("input track", &self.track, &theirs.track));
        }
        let first = |key: &str, here: &[Value], theirs: &[Value]| {
            let named =
                |list: &[Value], name: &Value| list.iter().find(|e| &e[key] == name).cloned();
            here.iter()
                .chain(theirs)
                .map(|e| e[key].clone())
                .find(|name| named(here, name) != named(theirs, name))
                .map(|name| Mismatch {
                    what: name.as_str().unwrap_or_default().to_string(),
                    here: named(here, &name).unwrap_or(Value::Null),
                    theirs: named(theirs, &name).unwrap_or(Value::Null),
                })
        };
        if self.set != theirs.set {
            return first("name", &self.modules, &theirs.modules)
                .or_else(|| Some(text("module set", &self.set, &theirs.set)));
        }
        if self.runtime != theirs.runtime {
            return first("interface", &self.pins, &theirs.pins)
                .or_else(|| Some(text("runtime digest", &self.runtime, &theirs.runtime)));
        }
        None
    }
}

/// The fragment of the first player's link: the match ID, then the opener's card.
pub fn fragment(game: &MatchId, card: &Card) -> String {
    let card = deep_canvas::base64::encode(card.to_json().to_string().as_bytes());
    format!("match={}&start={card}", wire::hex(game))
}

/// The match ID and the opener's card a link's fragment carries (with or without its `#`, after
/// whatever the link holds before it); none when it carries no match.
pub fn parse(link: &str) -> Option<(MatchId, Card)> {
    let fragment = link.rsplit_once('#').map_or(link, |(_, f)| f);
    let part = |key: &str| {
        fragment
            .split('&')
            .find_map(|p| p.strip_prefix(key)?.strip_prefix('='))
    };
    let game = wire::match_id(part("match")?)?;
    let card = deep_canvas::base64::decode(part("start")?)?;
    Some((game, Card::from_json(&serde_json::from_slice(&card).ok()?)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(pin: &str) -> Card {
        Card {
            document: "d".repeat(64),
            track: "t".repeat(64),
            set: "s".repeat(64),
            modules: vec![json!({"name": "logic", "version": "1.0.0", "digest": "x"})],
            runtime: format!("runtime-{pin}"),
            pins: vec![
                json!({"interface": "physics@1", "implementation": "physics.rapier", "version": "1.0.0",
                              "pins": {"rapier3d": {"version": pin, "features": []}}}),
            ],
        }
    }

    #[test]
    fn a_link_carries_the_match_and_the_openers_card_in_its_fragment() {
        let (game, mine) = ([0xab; 16], card("=0.36.0"));
        let link = format!("deep://piece/01JB#{}", fragment(&game, &mine));
        assert!(
            link.contains(&format!("#match={}", "ab".repeat(16))),
            "{link}"
        );
        assert_eq!(parse(&link), Some((game, mine.clone())));
        assert_eq!(parse(link.split('#').nth(1).unwrap()), Some((game, mine)));
        assert_eq!(parse("https://a.test/index.html#t=3"), None);
    }

    #[test]
    fn a_copy_that_differs_names_what_differs_and_both_sides() {
        let (mine, theirs) = (card("=0.36.1"), card("=0.36.0"));
        assert_eq!(mine.differs(&mine), None);
        let m = mine.differs(&theirs).unwrap();
        assert_eq!(m.what, "physics@1");
        let text = m.text();
        assert!(
            text.contains("physics@1") && text.contains("0.36.1") && text.contains("0.36.0"),
            "{text}"
        );
        assert_eq!(m.to_json()["mismatch"]["what"], json!("physics@1"));
        let other = Card {
            document: "e".repeat(64),
            ..mine.clone()
        };
        assert_eq!(mine.differs(&other).unwrap().what, "document");
    }
}
