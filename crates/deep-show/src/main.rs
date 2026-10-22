//! `deep-show <run | screen>`: JSON lines in, one JSON line out per input line, in order, exit 0;
//! a line that can't be read, lacks a required field or names an unknown `planted` value answers
//! `{"ok":false,"code":"bad_input"}`, before anything platform-specific. The surface is the #393
//! acceptance README's: `run` plays a scenario of deep_show and `deep show` calls against the
//! hub's canvas side and answers each call; `screen` also draws the window those calls leave, by
//! band with the question card last, through GPUI's offscreen Metal renderer (macOS only; off
//! macOS it answers `{"ok":false,"code":"unsupported_platform"}`).

mod evidence;
mod hub;
mod snapshot;

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use hub::{
    flicks, Call, Card, Claim, Fault, Hold, Include, Panel, Planted, Process, RecordObject,
    Scenario, Session, Show, Via,
};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn rect(value: Option<&Value>) -> Option<[f64; 4]> {
    let parts: Vec<f64> = value?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()?;
    let r = <[f64; 4]>::try_from(parts.as_slice()).ok()?;
    (r.iter().all(|v| v.is_finite()) && r[2] > 0.0 && r[3] > 0.0).then_some(r)
}

/// An optional object field as a map of `parse`d entries; absent is empty.
fn entries<T>(
    input: &Map<String, Value>,
    key: &str,
    parse: impl Fn(&Map<String, Value>) -> Option<T>,
) -> Option<BTreeMap<String, T>> {
    match input.get(key) {
        None => Some(BTreeMap::new()),
        Some(v) => v
            .as_object()?
            .iter()
            .map(|(k, e)| Some((k.clone(), parse(e.as_object()?)?)))
            .collect(),
    }
}

fn strings(value: Option<&Value>) -> Option<Vec<String>> {
    match value {
        None => Some(Vec::new()),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|s| s.as_str().map(str::to_string))
            .collect(),
    }
}

fn call(c: &Map<String, Value>) -> Option<Call> {
    let name = c.get("call")?.as_str()?;
    let via = match name {
        "revisions" => return Some(Call::Revisions(c.get("doc")?.as_str()?.to_string())),
        "screen" => return Some(Call::Screen),
        "deep_show" => match c.get("session")? {
            Value::Null => Via::Mcp(None),
            Value::String(s) => Via::Mcp(Some(s.clone())),
            _ => return None,
        },
        "deep show" => {
            let peer = c.get("peer")?.as_object()?;
            Via::Cli(peer.get("pid")?.as_u64()?, peer.get("start")?.as_i64()?)
        }
        _ => return None,
    };
    let include = match c.get("include") {
        None => vec![Include::Issues],
        Some(v) => v
            .as_array()?
            .iter()
            .map(|i| match i.as_str()? {
                "issues" => Some(Include::Issues),
                "audit" => Some(Include::Audit),
                "timing" => Some(Include::Timing),
                "pixels" => Some(Include::Pixels),
                _ => None,
            })
            .collect::<Option<_>>()?,
    };
    let size = match c.get("size") {
        None => None,
        Some(v) => {
            let s: Vec<u16> = v
                .as_array()?
                .iter()
                .map(|n| {
                    n.as_u64()
                        .and_then(|n| u16::try_from(n).ok())
                        .filter(|n| (1..=8192).contains(n))
                })
                .collect::<Option<_>>()?;
            Some(<[u16; 2]>::try_from(s.as_slice()).ok()?)
        }
    };
    Some(Call::Show(Box::new(Show {
        via,
        doc: c.get("doc")?.as_str()?.to_string(),
        document: c.get("document")?.clone(),
        removes: strings(c.get("removes"))?,
        t: match c.get("t") {
            None => 0,
            Some(t) => flicks(t.as_str()?)?,
        },
        size,
        include,
        check: match c.get("check") {
            None => false,
            Some(b) => b.as_bool()?,
        },
        claim: match c.get("claim") {
            None => None,
            Some(h) => Some(h.as_str()?.to_string()),
        },
    })))
}

fn scenario(input: &Map<String, Value>) -> Option<Scenario> {
    let sessions = entries(input, "sessions", |s| {
        let p = s.get("process")?.as_object()?;
        Some(Session {
            thread: s.get("thread")?.as_str()?.to_string(),
            name: s.get("name")?.as_str()?.to_string(),
            process: (p.get("pid")?.as_u64()?, p.get("start")?.as_i64()?),
        })
    })?;
    let processes = match input.get("processes") {
        None => Vec::new(),
        Some(v) => v
            .as_array()?
            .iter()
            .map(|p| {
                Some(Process {
                    pid: p.get("pid")?.as_u64()?,
                    ppid: p.get("ppid")?.as_u64()?,
                    start: p.get("start")?.as_i64()?,
                })
            })
            .collect::<Option<_>>()?,
    };
    let panels = entries(input, "panels", |p| {
        Some(Panel {
            rect: rect(p.get("rect"))?,
            visible: match p.get("visible") {
                None => true,
                Some(v) => v.as_bool()?,
            },
        })
    })?;
    let docs = entries(input, "docs", |d| {
        Some(d.get("panel")?.as_str()?.to_string())
    })?;
    let record = entries(input, "record", |o| {
        Some(RecordObject {
            session: match o.get("session")? {
                Value::Null => None,
                v => Some(v.as_str()?.to_string()),
            },
            state: match o.get("state") {
                None => None,
                Some(s) => Some(s.as_str()?.to_string()),
            },
            value: match o.get("value") {
                None => None,
                Some(n) => Some(n.as_f64()?),
            },
            as_of: match o.get("as_of") {
                None => None,
                Some(n) => Some(n.as_i64()?),
            },
        })
    })?;
    let claims = entries(input, "claims", |c| {
        c.get("session")?.as_str()?;
        Some(Claim {
            deliverables: strings(c.get("deliverables"))?,
        })
    })?;
    let window = match input.get("window") {
        None => None,
        Some(w) => {
            let r = rect(Some(&json!([0, 0, w.get(0)?, w.get(1)?])))?;
            Some([r[2], r[3]])
        }
    };
    let card = match input.get("card") {
        None => None,
        Some(c) => Some(Card {
            question: c.get("question")?.as_str()?.to_string(),
            options: c
                .get("options")?
                .as_array()?
                .iter()
                .map(|o| o.get("label")?.as_str().map(str::to_string))
                .collect::<Option<_>>()?,
            rect: rect(c.get("rect"))?,
        }),
    };
    let fault = match input.get("fault") {
        None => None,
        Some(f) => Some(Fault {
            holds: match f.get("holds")?.as_str()? {
                "fallback_pipeline" => Hold::FallbackPipeline,
                "rebuild_queue" => Hold::RebuildQueue,
                "asset_decode" => Hold::AssetDecode,
                _ => return None,
            },
            ms: f.get("ms")?.as_u64()?,
        }),
    };
    let planted = match input.get("planted") {
        None => None,
        Some(p) => Some(match p.as_str()? {
            "presents_unnamed_removal" => Planted::PresentsUnnamedRemoval,
            "diffs_items_only" => Planted::DiffsItemsOnly,
            "inlines_every_issue" => Planted::InlinesEveryIssue,
            "cuts_without_truncated" => Planted::CutsWithoutTruncated,
            "sorts_by_order_key_alone" => Planted::SortsByOrderKeyAlone,
            _ => return None,
        }),
    };
    let calls = input
        .get("calls")?
        .as_array()?
        .iter()
        .map(|c| call(c.as_object()?))
        .collect::<Option<_>>()?;
    Some(Scenario {
        evidence: PathBuf::from(input.get("evidence")?.as_str()?),
        sessions,
        processes,
        panels,
        docs,
        record,
        claims,
        window,
        card,
        fault,
        planted,
        calls,
    })
}

/// Runs a scenario's calls in order, one reply each.
fn run(hub: &mut hub::Hub<'_>) -> Vec<Value> {
    hub.scenario.calls.iter().map(|c| hub.call(c)).collect()
}

fn answer(command: &str, line: &str) -> Value {
    let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
        return bad_input();
    };
    let Some(scenario) = scenario(&input) else {
        return bad_input();
    };
    match command {
        "run" => {
            let mut hub = hub::Hub::new(&scenario);
            let replies = run(&mut hub);
            json!({"ok": true, "replies": replies})
        }
        "screen" => {
            let (Some(out), Some(_)) = (input.get("out").and_then(Value::as_str), scenario.window)
            else {
                return bad_input();
            };
            screen(&scenario, out)
        }
        _ => bad_input(),
    }
}

#[cfg(target_os = "macos")]
fn screen(scenario: &Scenario, out: &str) -> Value {
    let mut hub = hub::Hub::new(scenario);
    let replies = run(&mut hub);
    window::draw(&mut hub, replies, out)
}

#[cfg(not(target_os = "macos"))]
fn screen(_: &Scenario, _: &str) -> Value {
    json!({"ok": false, "code": "unsupported_platform"})
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let reply = answer(&command, &line);
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
    }
}

#[cfg(target_os = "macos")]
mod window;
