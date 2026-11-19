//! Issue #2029: words for what the record says. Every closed-set code the core records (an ask's outcome, a stop's
//! cause, a reason the core gave a verdict of its own) is said in words in each view that shows it, from the one list
//! the hub reads too, `packages/contracts/code-words.json`; a code the list doesn't know shows the core's text, never
//! a blank or the code. And an answered authority card's receipt says what the approved step did once it ran, read
//! from the call's own records (its `tool.after`), never from the agent's text.

use std::{collections::HashMap, sync::OnceLock};

use serde_json::{json, Value};

use crate::copy;

/// A set, the view that shows its codes and the function that view draws one with.
type View = (&'static str, &'static str, fn(&str, &str) -> String);

/// Each set, the view that shows its codes and the function that view draws one with: what `deep-replica --words`
/// asks of the views.
const VIEWS: [View; 3] = [
    ("ask.outcome", "ask page", outcome), // copy-exception: a view's name
    ("stop.cause", "session page", stopped), // copy-exception: a view's name
    ("verdict.reason", "session page", reason), // copy-exception: a view's name
];

/// The list's words, by set and code.
fn list() -> &'static Value {
    static LIST: OnceLock<Value> = OnceLock::new();
    LIST.get_or_init(|| {
        serde_json::from_str(include_str!("../../../packages/contracts/code-words.json"))
            .expect("code-words.json is JSON")
    })
}

/// The app's table key for each code the list knows, `codes.<set>.<code>` (#2403): in English the list's own words.
fn key(set: &str, code: &str) -> Option<&'static str> {
    static KEYS: OnceLock<HashMap<(String, String), &'static str>> = OnceLock::new();
    let keys = KEYS.get_or_init(|| {
        let mut keys = HashMap::new();
        for (set, codes) in list().as_object().into_iter().flatten() {
            for code in codes
                .as_object()
                .into_iter()
                .flatten()
                .map(|(code, _)| code)
            {
                let key: &'static str = Box::leak(format!("codes.{set}.{code}").into_boxed_str());
                keys.insert((set.clone(), code.clone()), key);
            }
        }
        keys
    });
    keys.get(&(set.to_owned(), code.to_owned())).copied()
}

/// The words for `code` of `set` in the language shown, or `core`, the core's text, for a code the list doesn't know.
fn said(set: &str, code: &str, core: &str) -> String {
    match (key(set, code), list()[set][code].as_str()) {
        // A code the list holds but the table doesn't yet says the list's own words.
        (Some(key), Some(words)) if copy::text(key) == key => words.to_owned(),
        (Some(key), Some(_)) => copy::text(key).to_owned(),
        _ => core.to_owned(),
    }
}

/// How an ask closed, as a closed ask's page says it.
pub fn outcome(code: &str, core: &str) -> String {
    said("ask.outcome", code, core)
}

/// Why a session's turn ended failed, as its page says it.
pub fn stopped(code: &str, core: &str) -> String {
    copy::fill("codes.stopped", &[&said("stop.cause", code, core)])
}

/// A reason the core gave a verdict of its own, as the session's page says it.
pub fn reason(code: &str, core: &str) -> String {
    copy::fill("codes.not_a_pass", &[&said("verdict.reason", code, core)])
}

/// `deep-replica --words`: for each `{set, code, core}` asked, each view that shows codes of that set with what it
/// draws for this one.
pub fn answer(asked: &Value) -> Value {
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    let answers = asked.as_array().into_iter().flatten().map(|item| {
        let (set, code, core) = (text(&item["set"]), text(&item["code"]), text(&item["core"]));
        let views: Vec<Value> = VIEWS
            .iter()
            .filter(|(shown, ..)| *shown == set)
            .map(|(_, view, draw)| json!({"view": view, "shows": draw(&code, &core)}))
            .collect();
        json!({"set": set, "code": code, "views": views})
    });
    Value::Array(answers.collect())
}

/// What one approved step did, from its call's records.
enum Ran {
    NotYet,
    Unknown,
    Ok,
    Failed(Option<String>),
}

/// The receipt of an authority ask your yes answered: what each step it approved did once it ran, from the steps'
/// own calls. `None` for an ask no yes answered. A batch your one yes approved counts its steps.
pub fn receipt(events: &[Value], handle: &str) -> Option<String> {
    let yes = |handle: &str| {
        events.iter().position(|event| {
            crate::states::closes(event, handle)
                && event["kind"] == "ask.answered"
                && event["data"]["decision"] == "allow"
        })
    };
    let answered = yes(handle)?;
    if crate::kinds::find(events, handle)?["data"]["kind"] != "authority" {
        return None;
    }
    if crate::plain::planted("receipt-stays-allowed") {
        return Some(copy::text("codes.allowed").to_owned());
    }
    if crate::plain::planted("receipt-from-agent-text") {
        let ask = crate::kinds::find(events, handle)?;
        return Some(copy::fill(
            "codes.allowed_then",
            &[&said_last(ask["session"].as_str()?)?],
        ));
    }
    // The batch's other steps your same click approved: their answers carry its token.
    let token = &events[answered]["data"]["token"];
    let mut steps: Vec<(String, usize)> = crate::kinds::batch_of(events, handle)
        .into_iter()
        .filter_map(|member| yes(&member).map(|at| (member, at)))
        .filter(|(_, at)| !token.is_null() && events[*at]["data"]["token"] == *token)
        .collect();
    if steps.len() < 2 {
        steps = vec![(handle.to_owned(), answered)];
    }
    let ran: Vec<Ran> = steps
        .iter()
        .map(|(member, at)| step(events, member, *at))
        .collect();
    if let [one] = ran.as_slice() {
        return Some(match one {
            Ran::Ok => copy::text("codes.allowed_ran").to_owned(),
            Ran::Failed(Some(error)) => copy::fill("codes.allowed_failed_error", &[error]),
            Ran::Failed(None) => copy::text("codes.allowed_failed").to_owned(),
            Ran::NotYet => copy::text("codes.allowed_not_yet").to_owned(),
            Ran::Unknown => copy::text("codes.allowed_unknown").to_owned(),
        });
    }
    // A plan of several steps: how many ran and how many failed, with the first failure's error line.
    let count = |of: fn(&Ran) -> bool| ran.iter().filter(|r| of(r)).count() as u64;
    let failed = count(|r| matches!(r, Ran::Failed(_)));
    let mut parts = vec![
        copy::text("codes.allowed").to_owned(),
        copy::count(
            "codes.steps_ran",
            count(|r| matches!(r, Ran::Ok | Ran::Failed(_))),
            &[],
        ),
    ];
    match ran.iter().find_map(|r| match r {
        Ran::Failed(error) => Some(error),
        _ => None,
    }) {
        Some(Some(error)) => parts.push(copy::count("codes.steps_failed_error", failed, &[error])),
        Some(None) => parts.push(copy::count("codes.steps_failed_told", failed, &[])),
        None => parts.push(copy::count("codes.steps_failed", 0, &[])),
    }
    let not_yet = count(|r| matches!(r, Ran::NotYet));
    let unknown = count(|r| matches!(r, Ran::Unknown));
    parts.extend((not_yet > 0).then(|| copy::count("codes.steps_not_yet", not_yet, &[])));
    parts.extend((unknown > 0).then(|| copy::count("codes.steps_unknown", unknown, &[])));
    Some(parts.join(" · "))
}

/// What the step of `handle` did, as its call's records say, its yes at `answered`: the first call of its session
/// after the yes that runs what its plan names and has an end, else the last that started with none, else none.
fn step(events: &[Value], handle: &str, answered: usize) -> Ran {
    let Some(ask) = crate::kinds::find(events, handle) else {
        return Ran::NotYet;
    };
    let names = events
        .iter()
        .find(|event| {
            event["kind"] == "plan.proposed"
                && event["writer"] == "core"
                && event["data"]["ask"] == handle
        })
        .and_then(|plan| plan["data"]["steps"][0]["changes"][0].as_str());
    let Some(names) = names else {
        return Ran::NotYet;
    };
    let calls: Vec<&Value> = events[answered..]
        .iter()
        .filter(|event| {
            event["kind"] == "tool.before"
                && event["session"] == ask["session"]
                && label(&event["data"]) == names
        })
        .collect();
    let end = |call: &Value| {
        events.iter().find(|event| {
            event["kind"] == "tool.after"
                && event["session"] == ask["session"]
                && event["data"]["call"] == call["data"]["call"]
        })
    };
    match calls.iter().find_map(|call| end(call)) {
        Some(end) if end["data"]["outcome"] == "failed" => {
            Ran::Failed(end["data"]["error"].as_str().map(str::to_owned))
        }
        Some(_) => Ran::Ok,
        None if calls.is_empty() => Ran::NotYet,
        None => Ran::Unknown,
    }
}

/// A call as the hold names it: an MCP tool by its server and tool, a command by itself.
fn label(data: &Value) -> String {
    match (data["kind"].as_str(), data["command"].as_str()) {
        (Some("mcp"), _) => format!(
            "{} {}",
            data["server"].as_str().unwrap_or_default(),
            data["tool"].as_str().unwrap_or_default()
        ),
        (_, Some(command)) => command.to_owned(),
        (kind, None) => kind.unwrap_or_default().to_owned(),
    }
}

/// The planted wrong program's source (#2029): the agent's last message in its transcript, which a receipt must never
/// take its words from.
fn said_last(session: &str) -> Option<String> {
    let projects = std::path::Path::new(&std::env::var_os("HOME")?).join(".claude/projects");
    let transcript = std::fs::read_dir(projects)
        .ok()?
        .flatten()
        .map(|folder| folder.path().join(format!("{session}.jsonl")))
        .find(|file| file.exists())?;
    let text = std::fs::read_to_string(transcript).ok()?;
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|entry| entry["type"] == "assistant")
        .flat_map(|entry| {
            entry["message"]["content"]
                .as_array()
                .cloned()
                .unwrap_or_default()
        })
        .filter_map(|block| block["text"].as_str().map(str::to_owned))
        .next_back()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #2403: every code of the one list (#2029) has its key in the app's table, whose English is the list's own words,
    /// so a view never says the list's words in English while another language is shown.
    #[test]
    fn every_code_the_list_holds_has_the_lists_words_in_the_table() {
        for (set, codes) in list().as_object().into_iter().flatten() {
            for (code, words) in codes.as_object().into_iter().flatten() {
                let key = key(set, code).expect("a key for each code");
                assert_eq!(
                    copy::english(key, &[]),
                    words.as_str().unwrap_or_default(),
                    "{key}"
                );
            }
        }
    }
}
