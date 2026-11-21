//! The Join prompt's words (canvas primitives: Net: relay and Join). The app and the web player
//! each draw the prompt themselves, never the piece; both say the same thing: the relay's host,
//! who sees the copy's network address, for a piece that reads `match.me` that its fog is a
//! courtesy (#552), and, when a Join is refused, why.

use serde_json::{json, Value};

/// Where a copy's Join stands.
#[derive(Clone, Debug, PartialEq)]
pub enum State {
    /// Shown, and no person has clicked Join.
    Open,
    /// A person clicked Join; the copy is seated or waits for the match's other copies.
    Joined,
    /// The relay or the copies refused the Join: what the prompt's `refused` holds, and why.
    Refused(Value, String),
    /// The match ended, as `left`, `timeout`, `desync` or `faulted`.
    Ended(String),
}

impl State {
    pub fn name(&self) -> &'static str {
        match self {
            State::Open => "open",
            State::Joined => "joined",
            State::Refused(..) => "refused",
            State::Ended(_) => "ended",
        }
    }
}

/// #552: the line the prompt of a piece that reads `match.me` adds (Net: this copy's player).
pub const COURTESY: &str = "Fog in this piece is a courtesy. Every copy can see everything.";

/// #552: whether a lowered document reads `match.me`: an item's `seen` column (a mark set's or an
/// instancer's), a logic item's fog grid, or any expression, a driver's or an overlay's, that
/// names it.
pub fn reads_me(doc: &Value) -> bool {
    fn walk(v: &Value) -> bool {
        match v {
            Value::String(s) => s.contains("match.me"),
            Value::Array(a) => a.iter().any(walk),
            Value::Object(o) => o
                .iter()
                .any(|(k, v)| (k == "seen" && v.get("array").is_some()) || walk(v)),
            _ => false,
        }
    }
    let items = doc.get("items").and_then(Value::as_object);
    items.into_iter().flatten().any(|(_, item)| {
        let p = &item["params"];
        p.get("fog").is_some_and(|f| f.get("grid").is_some()) || walk(item)
    })
}

/// The prompt as its host shows it: `{state, relay, players, courtesy, refused, text}`, where
/// `courtesy` is the fog line for a piece that reads `match.me`, else null.
pub fn prompt(host: &str, players: u8, courtesy: bool, state: &State) -> Value {
    let mut about = format!(
        "This piece is played by {players} players through the relay {host}. \
         The relay, and on a direct path the other players, see this copy's network address."
    );
    if courtesy {
        about = format!("{about} {COURTESY}");
    }
    let (refused, text) = match state {
        State::Open => (json!("none"), format!("{about} Click Join to play.")),
        State::Joined => (json!("none"), format!("{about} Joined.")),
        State::Refused(refused, why) => (refused.clone(), format!("The Join was refused. {why}")),
        State::Ended(how) => (json!("none"), format!("{about} The match ended: {how}.")),
    };
    let courtesy = courtesy.then_some(COURTESY);
    json!({"state": state.name(), "relay": host, "players": players, "courtesy": courtesy,
           "refused": refused, "text": text})
}

/// A relay's refusal of a join, as the prompt says it: `unknown`, `full` or `started`.
pub fn refused_by_relay(host: &str, reason: &str) -> State {
    let why = match reason {
        "unknown" => {
            format!("The relay {host} holds no open match by that ID: it ended or never opened.")
        }
        "full" => format!("Every seat of the match at the relay {host} is taken."),
        "started" => format!("The match at the relay {host} has started."),
        other => format!("The relay {host} refused the join: {other}."),
    };
    State::Refused(json!(reason), why)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_prompt_names_the_relay_host_and_who_sees_the_address() {
        let p = prompt("relay.test:4433", 2, false, &State::Open);
        let text = p["text"].as_str().unwrap();
        assert!(
            text.contains("relay.test:4433") && text.contains("network address"),
            "{text}"
        );
        assert_eq!(
            (&p["state"], &p["refused"]),
            (&json!("open"), &json!("none"))
        );
        let r = prompt(
            "relay.test",
            2,
            false,
            &refused_by_relay("relay.test", "started"),
        );
        assert_eq!(
            (&r["state"], &r["refused"]),
            (&json!("refused"), &json!("started"))
        );
        assert!(r["text"].as_str().unwrap().contains("relay.test"));
        assert_eq!(p["courtesy"], Value::Null);
    }

    #[test]
    fn a_piece_that_reads_match_me_says_its_fog_is_a_courtesy() {
        let fog = json!({"items": {"enemies": {"kind": "instance@1", "params":
            {"seen": {"array": "rules.sight", "as": "i32"}}}}});
        let paddle = json!({"items": {"ball": {"kind": "marks@1", "params": {"x": 1}}}});
        assert!(reads_me(&fog) && !reads_me(&paddle));
        let p = prompt("relay.test", 2, reads_me(&fog), &State::Open);
        assert_eq!(p["courtesy"], json!(COURTESY));
        assert!(p["text"]
            .as_str()
            .unwrap()
            .ends_with(&format!("{COURTESY} Click Join to play.")));
    }
}
