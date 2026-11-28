use serde_json::Value;

use crate::states;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settled {
    pub handle: String,
    pub question: String,
    pub outcome: &'static str,
    pub at: Option<u64>,
}

pub fn read(events: &[Value]) -> Vec<Settled> {
    let mut settled: Vec<Settled> = Vec::new();
    for event in events {
        let (outcome, handle) = match event["kind"].as_str() {
            Some("ask.answered") => ("answered", &event["subject"]),
            Some("ask.defaulted") => ("defaulted", &event["subject"]),
            Some("decision.applied") => ("decided_for_you", &event["data"]["ask"]),
            _ => continue,
        };
        let Some(handle) = handle.as_str().filter(|h| h.starts_with("ask:")) else {
            continue;
        };
        if !states::closes(event, handle) || settled.iter().any(|s| s.handle == handle) {
            continue;
        }
        let question = crate::kinds::find(events, handle)
            .and_then(|ask| ask["data"]["question"].as_str())
            .map(crate::question::visible)
            .unwrap_or_default();
        settled.push(Settled {
            handle: handle.to_owned(),
            question,
            outcome,
            at: event["ts"].as_u64(),
        });
    }
    settled.retain(|s| !states::is_open(events, &s.handle));
    settled.reverse();
    settled
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn asked(id: &str, question: &str) -> Value {
        json!({"kind": "ask.created", "writer": "core", "id": id, "data": {"question": question}})
    }

    #[test]
    fn answered_defaulted_and_decided_asks_list_newest_first_and_open_ones_never() {
        let events = vec![
            asked("a1", "Push to main?"),
            asked("a2", "Which name?"),
            asked("a3", "Merge it?"),
            asked("a4", "Still open?"),
            json!({"kind": "ask.answered", "writer": "core", "subject": "ask:a1", "ts": 10, "data": {"answer": "allow"}}),
            json!({"kind": "ask.defaulted", "writer": "core", "subject": "ask:a2", "ts": 20, "data": {}}),
            json!({"kind": "decision.applied", "writer": "core", "subject": "ask:a3", "ts": 30, "data": {"ask": "ask:a3", "decision": "decision:d1"}}),
        ];
        let settled = read(&events);
        let rows: Vec<(&str, &str)> = settled
            .iter()
            .map(|s| (s.question.as_str(), s.outcome))
            .collect();
        assert_eq!(
            rows,
            [
                ("Merge it?", "decided_for_you"),
                ("Which name?", "defaulted"),
                ("Push to main?", "answered")
            ]
        );
    }
}
