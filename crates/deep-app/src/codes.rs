//! Issue #2029: words for what the record says. Every closed-set code the core records (an ask's outcome, a stop's
//! cause, a reason the core gave a verdict of its own) is said in words in each view that shows it, from the one list
//! the hub reads too, `packages/contracts/code-words.json`; a code the list doesn't know shows the core's text, never
//! a blank or the code. And an answered authority card's receipt says what the approved step did once it ran, read
//! from the call's own records (its `tool.after`), never from the agent's text.

use std::sync::OnceLock;

use serde_json::{json, Value};

/// A set, the view that shows its codes and the function that view draws one with.
type View = (&'static str, &'static str, fn(&str, &str) -> String);

/// Each set, the view that shows its codes and the function that view draws one with: what `deep-replica --words`
/// asks of the views.
const VIEWS: [View; 3] = [
    ("ask.outcome", "ask page", outcome),
    ("stop.cause", "session page", stopped),
    ("verdict.reason", "session page", reason),
];

/// The words for `code` of `set`, or `core`, the core's text, for a code the list doesn't know.
fn said(set: &str, code: &str, core: &str) -> String {
    static LIST: OnceLock<Value> = OnceLock::new();
    let list = LIST.get_or_init(|| {
        serde_json::from_str(include_str!("../../../packages/contracts/code-words.json"))
            .expect("code-words.json is JSON")
    });
    list[set][code]
        .as_str()
        .map_or_else(|| core.to_owned(), str::to_owned)
}

/// How an ask closed, as a closed ask's page says it.
pub fn outcome(code: &str, core: &str) -> String {
    said("ask.outcome", code, core)
}

/// Why a session's turn ended failed, as its page says it.
pub fn stopped(code: &str, core: &str) -> String {
    format!("Stopped: {}", said("stop.cause", code, core))
}

/// A reason the core gave a verdict of its own, as the session's page says it.
pub fn reason(code: &str, core: &str) -> String {
    format!("Not a PASS: {}", said("verdict.reason", code, core))
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
        return Some("Allowed".to_owned());
    }
    if crate::plain::planted("receipt-from-agent-text") {
        let ask = crate::kinds::find(events, handle)?;
        return Some(format!(
            "Allowed · {}",
            said_last(ask["session"].as_str()?)?
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
    let told = |error: &Option<String>| match error {
        Some(error) => format!("it failed: {error} · the agent was told"),
        None => "it failed · the agent was told".to_owned(),
    };
    if let [one] = ran.as_slice() {
        return Some(match one {
            Ran::Ok => "Allowed · ran".to_owned(),
            Ran::Failed(error) => format!("Allowed · {}", told(error)),
            Ran::NotYet => "Allowed · not run yet".to_owned(),
            Ran::Unknown => "Allowed · outcome unknown".to_owned(),
        });
    }
    // A plan of several steps: how many ran and how many failed, with the first failure's error line.
    let count = |of: fn(&Ran) -> bool| ran.iter().filter(|r| of(r)).count();
    let failed = count(|r| matches!(r, Ran::Failed(_)));
    let mut parts = vec![
        "Allowed".to_owned(),
        format!("{} ran", count(|r| matches!(r, Ran::Ok | Ran::Failed(_)))),
    ];
    match ran.iter().find_map(|r| match r {
        Ran::Failed(error) => Some(error),
        _ => None,
    }) {
        Some(Some(error)) => parts.push(format!("{failed} failed: {error} · the agent was told")),
        Some(None) => parts.push(format!("{failed} failed · the agent was told")),
        None => parts.push("0 failed".to_owned()),
    }
    let not_yet = count(|r| matches!(r, Ran::NotYet));
    let unknown = count(|r| matches!(r, Ran::Unknown));
    parts.extend((not_yet > 0).then(|| format!("{not_yet} not run yet")));
    parts.extend((unknown > 0).then(|| format!("{unknown} outcome unknown")));
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
