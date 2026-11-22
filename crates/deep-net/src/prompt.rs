//! The Join prompt's words (canvas primitives: Net: relay and Join). The app and the web player
//! each draw the prompt themselves, never the piece; both say the same thing: the relay's host,
//! who sees the copy's network address, and, when a Join is refused, why.

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

/// The prompt as its host shows it: `{state, relay, players, refused, text}`. `min` is the copies
/// a room's match starts with, `players` where the piece declares one count (#278). A piece that
/// keeps a profile record says its numbers go to the other players (#276).
pub fn prompt(host: &str, min: u8, players: u8, profile: bool, state: &State) -> Value {
    let count = match min < players {
        true => format!("{min} to {players}"),
        false => players.to_string(),
    };
    let mut about = format!(
        "This piece is played by {count} players through the relay {host}. \
         The relay, and on a direct path the other players, see this copy's network address."
    );
    if profile {
        about.push_str(" Your profile's numbers go to the other players.");
    }
    let (refused, text) = match state {
        State::Open => (json!("none"), format!("{about} Click Join to play.")),
        State::Joined => (json!("none"), format!("{about} Joined.")),
        State::Refused(refused, why) => (refused.clone(), format!("The Join was refused. {why}")),
        State::Ended(how) => (json!("none"), format!("{about} The match ended: {how}.")),
    };
    json!({"state": state.name(), "relay": host, "players": players, "refused": refused, "text": text})
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
        let p = prompt("relay.test:4433", 2, 2, false, &State::Open);
        let text = p["text"].as_str().unwrap();
        assert!(
            text.contains("relay.test:4433") && text.contains("network address"),
            "{text}"
        );
        assert!(text.contains("played by 2 players"), "{text}");
        // #278: a room's prompt names its range, and `players` stays its seats.
        let room = prompt("relay.test:4433", 2, 8, false, &State::Open);
        let text = room["text"].as_str().unwrap();
        assert!(text.contains("played by 2 to 8 players"), "{text}");
        assert_eq!(room["players"], json!(8));
        assert_eq!(
            (&p["state"], &p["refused"]),
            (&json!("open"), &json!("none"))
        );
        let r = prompt(
            "relay.test",
            2,
            2,
            false,
            &refused_by_relay("relay.test", "started"),
        );
        assert_eq!(
            (&r["state"], &r["refused"]),
            (&json!("refused"), &json!("started"))
        );
        assert!(r["text"].as_str().unwrap().contains("relay.test"));
    }
}
