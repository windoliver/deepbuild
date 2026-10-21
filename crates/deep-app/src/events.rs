//! Issue #338: a fixture record of asks and the inbox projection's list for Needs you.
//!
//! The record is one JSON object per line, `{"session_id": "...", "event": {...}}`, in log order.
//! The list is every ask created at or before a log position and not closed by then, oldest first;
//! Later, held and folded asks stay in it, superseded and moot ones leave it.

use std::path::Path;

use serde_json::Value;

/// Once a session holds this many open asks, its further asks fold into one exception.
pub const FOLD_AFTER: usize = 5;

/// The kinds that end an ask.
const CLOSING: [&str; 6] = [
    "ask.answered",
    "ask.defaulted",
    "ask.escalated",
    "ask.cancelled",
    "ask.superseded",
    "ask.moot",
];

#[derive(Clone, Debug)]
pub struct Row {
    pub session_id: String,
    pub event: Value,
}

#[derive(Clone, Debug, Default)]
pub struct Fixture {
    pub rows: Vec<Row>,
}

impl Fixture {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut rows = Vec::new();
        for (index, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let row: Value = serde_json::from_str(line)
                .map_err(|error| format!("line {}: not JSON: {error}", index + 1))?;
            let session_id = row["session_id"]
                .as_str()
                .ok_or_else(|| format!("line {}: no session_id", index + 1))?
                .to_owned();
            let event = row
                .get("event")
                .filter(|event| event.is_object())
                .cloned()
                .ok_or_else(|| format!("line {}: no event", index + 1))?;
            if event["log_pos"].as_u64().is_none() {
                return Err(format!("line {}: the event has no log_pos", index + 1));
            }
            rows.push(Row { session_id, event });
        }
        Ok(Self { rows })
    }

    pub fn load(path: &Path) -> Result<Self, String> {
        let text = std::fs::read_to_string(path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        Self::parse(&text)
    }

    /// The last event's log position.
    pub fn last_log_pos(&self) -> u64 {
        self.rows
            .iter()
            .filter_map(|row| row.event["log_pos"].as_u64())
            .max()
            .unwrap_or(0)
    }

    /// Session ids in the order they first appear.
    pub fn sessions(&self) -> Vec<String> {
        let mut sessions: Vec<String> = Vec::new();
        for row in &self.rows {
            if !sessions.contains(&row.session_id) {
                sessions.push(row.session_id.clone());
            }
        }
        sessions
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ask {
    pub handle: String,
    pub session: String,
    pub created: u64,
    pub deadline: u64,
    /// The kind of the event that closed it, if one did.
    pub closed: Option<String>,
    pub later_until: Option<u64>,
}

/// The inbox projection as of a log position.
#[derive(Clone, Debug, Default)]
pub struct Inbox {
    pub log_pos: u64,
    /// Open asks, oldest first by creation.
    pub open: Vec<Ask>,
    /// Open asks past a session's fifth, folded into one exception.
    pub folded: Vec<String>,
    /// Open asks put off until later.
    pub later: Vec<String>,
    pub superseded: Vec<String>,
    pub moot: Vec<String>,
}

impl Inbox {
    /// The rows Needs you lists: every open ask's handle, oldest first.
    pub fn rows(&self) -> Vec<String> {
        self.open.iter().map(|ask| ask.handle.clone()).collect()
    }
}

pub fn inbox(fixture: &Fixture, log_pos: u64) -> Inbox {
    let seen: Vec<&Row> = fixture
        .rows
        .iter()
        .filter(|row| {
            row.event["log_pos"]
                .as_u64()
                .is_some_and(|pos| pos <= log_pos)
        })
        .collect();
    let mut asks: Vec<Ask> = Vec::new();
    for row in &seen {
        let event = &row.event;
        if event["kind"] != "ask.created" {
            continue;
        }
        asks.push(Ask {
            handle: format!("ask:{}", event["id"].as_str().unwrap_or_default()),
            session: row.session_id.clone(),
            created: event["log_pos"].as_u64().unwrap_or_default(),
            deadline: event["data"]["deadline"].as_u64().unwrap_or_default(),
            closed: None,
            later_until: None,
        });
    }
    for row in &seen {
        let event = &row.event;
        let Some(subject) = event["subject"].as_str() else {
            continue;
        };
        let kind = event["kind"].as_str().unwrap_or_default();
        let pos = event["log_pos"].as_u64().unwrap_or_default();
        let Some(ask) = asks
            .iter_mut()
            .find(|ask| ask.handle == subject && ask.created < pos)
        else {
            continue;
        };
        if CLOSING.contains(&kind) && ask.closed.is_none() {
            ask.closed = Some(kind.to_owned());
        }
        if kind == "ask.later" {
            ask.later_until = event["data"]["until"].as_u64();
        }
    }
    asks.sort_by_key(|ask| ask.created);
    let open: Vec<Ask> = asks
        .iter()
        .filter(|ask| ask.closed.is_none())
        .cloned()
        .collect();
    let mut folded = Vec::new();
    for session in fixture.sessions() {
        folded.extend(
            open.iter()
                .filter(|ask| ask.session == session)
                .skip(FOLD_AFTER)
                .map(|ask| ask.handle.clone()),
        );
    }
    let closed_by = |kind: &str| -> Vec<String> {
        asks.iter()
            .filter(|ask| ask.closed.as_deref() == Some(kind))
            .map(|ask| ask.handle.clone())
            .collect()
    };
    Inbox {
        log_pos,
        later: open
            .iter()
            .filter(|ask| ask.later_until.is_some())
            .map(|ask| ask.handle.clone())
            .collect(),
        superseded: closed_by("ask.superseded"),
        moot: closed_by("ask.moot"),
        folded,
        open,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(session: &str, pos: u64, kind: &str, id: &str, extra: &str) -> String {
        format!(
            r#"{{"session_id":"{session}","event":{{"v":1,"id":"{id}","kind":"{kind}","log_pos":{pos}{extra}}}}}"#
        )
    }

    #[test]
    fn open_asks_are_listed_oldest_first_and_closed_ones_leave() {
        let text = [
            event(
                "s1",
                1,
                "ask.created",
                "A",
                r#","data":{"kind":"taste","deadline":9}"#,
            ),
            event(
                "s1",
                2,
                "ask.created",
                "B",
                r#","data":{"kind":"choice","deadline":9}"#,
            ),
            event(
                "s2",
                3,
                "ask.created",
                "C",
                r#","data":{"kind":"unblock","deadline":9}"#,
            ),
            event(
                "s1",
                4,
                "ask.superseded",
                "X",
                r#","subject":"ask:A","data":{"by":"ask:B"}"#,
            ),
            event(
                "s2",
                5,
                "ask.later",
                "Y",
                r#","subject":"ask:C","data":{"until":5}"#,
            ),
            event("s2", 6, "ask.moot", "Z", r#","subject":"ask:B","data":{}"#),
        ]
        .join("\n");
        let fixture = Fixture::parse(&text).unwrap();
        let at_three = inbox(&fixture, 3);
        assert_eq!(at_three.rows(), ["ask:A", "ask:B", "ask:C"]);
        let at_end = inbox(&fixture, 6);
        assert_eq!(at_end.rows(), ["ask:C"]);
        assert_eq!(at_end.superseded, ["ask:A"]);
        assert_eq!(at_end.moot, ["ask:B"]);
        assert_eq!(at_end.later, ["ask:C"]);
        assert!(at_end.folded.is_empty());
    }

    #[test]
    fn a_sessions_sixth_open_ask_folds() {
        let text: Vec<String> = (1..=7)
            .map(|n| {
                event(
                    "s1",
                    n,
                    "ask.created",
                    &format!("A{n}"),
                    r#","data":{"kind":"taste","deadline":9}"#,
                )
            })
            .collect();
        let fixture = Fixture::parse(&text.join("\n")).unwrap();
        let inbox = inbox(&fixture, 7);
        assert_eq!(inbox.rows().len(), 7);
        assert_eq!(inbox.folded, ["ask:A6", "ask:A7"]);
    }
}
