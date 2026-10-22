//! `deep-show <run | screen>`: JSON lines in, one JSON line out per input line, in order, exit 0;
//! a line that can't be read, lacks a required field or names an unknown `planted` value answers
//! `{"ok":false,"code":"bad_input"}`, before anything platform-specific. The surface is the #393
//! acceptance README's: `run` plays a scenario of deep_show and `deep show` calls against the
//! hub's canvas side and answers each call; `screen` also draws the window those calls leave, by
//! band with the question card last, through GPUI's offscreen Metal renderer (macOS only; off
//! macOS it answers `{"ok":false,"code":"unsupported_platform"}`).

mod evidence;
mod hub;
mod shared;
mod snapshot;

use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use hub::{
    flicks, Body, Call, Card, Claim, Fault, Hold, Include, Panel, PatchCall, Planted, Process,
    RecordObject, Scenario, Session, Show, Via,
};
use shared::{Clock, CommitFault, Quota};

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

/// Who a call names: a `deep_show` call's session, or a `deep show` call's peer process.
fn via(name: &str, c: &Map<String, Value>) -> Option<Via> {
    match name {
        "deep_show" => match c.get("session")? {
            Value::Null => Some(Via::Mcp(None)),
            Value::String(s) => Some(Via::Mcp(Some(s.clone()))),
            _ => None,
        },
        "deep show" => {
            let peer = c.get("peer")?.as_object()?;
            Some(Via::Cli(
                peer.get("pid")?.as_u64()?,
                peer.get("start")?.as_i64()?,
            ))
        }
        _ => None,
    }
}

fn call(c: &Map<String, Value>) -> Option<Call> {
    let name = c.get("call")?.as_str()?;
    let doc = || Some(c.get("doc")?.as_str()?.to_string());
    match name {
        "revisions" => return Some(Call::Revisions(doc()?)),
        "screen" => return Some(Call::Screen),
        "by_writer" => return Some(Call::ByWriter(doc()?)),
        "history" => {
            return Some(Call::History {
                doc: doc()?,
                item: c.get("item")?.as_str()?.to_string(),
            })
        }
        "read" => {
            let as_writer = match (c.get("session"), c.get("peer")) {
                (None, None) => None,
                (Some(_), None) => Some(via("deep_show", c)?),
                (None, Some(_)) => Some(via("deep show", c)?),
                _ => return None,
            };
            return Some(Call::Read {
                doc: doc()?,
                via: as_writer,
            });
        }
        _ => {}
    }
    let via = via(name, c)?;
    let body = match (c.get("document"), c.get("patch"), c.get("undo")) {
        (Some(_), None, None) => None,
        (None, Some(p), None) => Some(Body::Patch(p.clone())),
        (None, None, Some(u)) => Some(Body::Undo {
            patch: u.get("patch")?.as_str()?.to_string(),
            of: u.get("of")?.as_str()?.to_string(),
        }),
        _ => return None,
    };
    if let Some(body) = body {
        return Some(Call::Patch(Box::new(PatchCall {
            via,
            doc: doc()?,
            body,
        })));
    }
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
    let seeds = entries(input, "docs", |d| Some(d.get("document").cloned()))?
        .into_iter()
        .filter_map(|(id, seed)| Some((id, seed?)))
        .collect();
    let quotas = entries(input, "quotas", |q| {
        let cap = |k: &str| match q.get(k) {
            None => Some(None),
            Some(v) => v.as_u64().and_then(|n| u32::try_from(n).ok()).map(Some),
        };
        let known = ["patches_per_s", "items", "msg_bytes", "docs"];
        if q.keys().any(|k| !known.contains(&k.as_str())) {
            return None;
        }
        Some(Quota {
            patches_per_s: cap("patches_per_s")?,
            items: cap("items")?,
            msg_bytes: cap("msg_bytes")?,
            docs: cap("docs")?,
        })
    })?;
    let clock = match input.get("clock") {
        None => None,
        Some(c) => {
            let n = |k: &str| c.get(k)?.as_i64().filter(|n| *n >= 0);
            let refresh_hz = n("refresh_hz").filter(|n| *n > 0)?;
            Some(Clock {
                refresh_hz,
                lead: n("lead")?,
                check: n("check")?,
            })
        }
    };
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
    let commit_fault = match input.get("fault") {
        Some(f) if f.get("kill_after_layer_file").is_some() => Some(
            CommitFault::KillAfterLayerFile(f.get("kill_after_layer_file")?.as_str()?.to_string()),
        ),
        Some(f) if f.get("layer_file_fails").is_some() => Some(CommitFault::LayerFileFails(
            f.get("layer_file_fails")?.as_str()?.to_string(),
        )),
        _ => None,
    };
    let fault = match input.get("fault") {
        None => None,
        Some(_) if commit_fault.is_some() => None,
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
            "rebase_counts_op_targets_only" => Planted::RebaseCountsOpTargetsOnly,
            "diffs_whole_document" => Planted::DiffsWholeDocument,
            "one_fifo_check_queue" => Planted::OneFifoCheckQueue,
            "newest_layer_file_current" => Planted::NewestLayerFileCurrent,
            _ => return None,
        }),
    };
    let list = input.get("calls")?.as_array()?;
    let calls = list
        .iter()
        .map(|c| call(c.as_object()?))
        .collect::<Option<_>>()?;
    // On the clock every call says when it arrives.
    let at = list
        .iter()
        .map(|c| match (c.get("at"), &clock) {
            (Some(t), Some(_)) => t.as_i64().filter(|t| *t >= 0),
            (None, None) => Some(0),
            _ => None,
        })
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
        at,
        seeds,
        state: match input.get("state") {
            None => None,
            Some(s) => Some(PathBuf::from(s.as_str()?)),
        },
        quotas,
        clock,
        commit_fault,
    })
}

/// Runs a scenario's calls, one reply each, in call order.
fn run(hub: &mut hub::Hub<'_>) -> Vec<Value> {
    hub.run_calls()
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
