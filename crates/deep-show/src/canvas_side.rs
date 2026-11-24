//! `deep-show canvas` (#806): the hub's canvas side, long-lived. Its world (a scenario's fields but
//! `calls`, `clock` and `at`) is the hub's: the sessions it bound, the documents it minted, the
//! record's objects, the claims, the window and card. Each call is played after every kept call
//! before it, on the clock the side keeps, and answered with its reply, so the replies are the
//! stand-in's for the same calls in the same order. A fault holds only the call that sends it, not
//! the earlier ones played again before it.

use super::*;

/// The virtual display clock `canvas` plays its calls on (#806): 120 Hz, the latch 2 ms before vsync,
/// half a millisecond a check, and each call ten frames after the one before, so a patch is current
/// at a latch before the next call arrives, as on the stand-in's clock (#384, #96).
const CANVAS_CLOCK: (i64, i64, i64) = (120, 1_411_200, 352_800);
const CANVAS_SPACING: i64 = 10 * (shared::FLICKS / 120);

/// #2694: calls that change no document, session, window or terminal state. Each is answered at
/// its time and not kept: playing it again would change no later reply. deep_query is one (#2896):
/// its cursor is a row index on the revision it names, and a walk paged to fit its client would
/// otherwise evaluate every earlier page again on each new one.
const READS: [&str; 6] = [
    "deep_kinds",
    "cells",
    "cell",
    "updates",
    "revisions",
    "deep_query",
];

struct CanvasSide {
    /// The world but its record's objects, which `record` holds.
    world: Map<String, Value>,
    /// The world's record objects (#1868): read once when the hub sends its world, then shared by
    /// every call's scenario, so a call that draws nothing from the record pays nothing for it.
    record: std::sync::Arc<BTreeMap<String, RecordObject>>,
    /// The world's documents the hub's record holds (#1721), read from the evidence store when they
    /// change and then shared by every call's scenario.
    recorded: std::sync::Arc<BTreeMap<String, Vec<shared::Recorded>>>,
    /// #2694: the calls kept to play again, each at the time it was first played.
    calls: Vec<Value>,
    /// #2694: the calls played, reads included: the clock moves one spacing with each.
    played: i64,
}

/// Answers `deep-show canvas`'s lines in order: `next` gives each line (`None` for one that isn't
/// UTF-8) until the input ends. A call is played on a fresh hub after the kept calls; that hub then
/// answers the reads after it, each at its time, until a line that isn't one (#2694).
pub(super) fn serve(
    startup: &Startup,
    mut next: impl FnMut() -> Option<Option<String>>,
    mut answer: impl FnMut(Value),
) {
    let mut side = CanvasSide {
        world: Map::from_iter([("evidence".to_string(), json!(""))]),
        record: Default::default(),
        recorded: Default::default(),
        calls: Vec::new(),
        played: 0,
    };
    let mut carried = None;
    while let Some(line) = carried.take().or_else(&mut next) {
        let played = line.as_deref().map(|l| side.line(startup, l));
        let (scenario, doc, room) = match played {
            None => {
                answer(bad_input());
                continue;
            }
            Some(Err(answered)) => {
                answer(answered);
                continue;
            }
            Some(Ok(play)) => play,
        };
        let mut hub = hub::Hub::new(&scenario, startup);
        query::set_room(room);
        let reply = hub.run_calls().pop().unwrap_or(Value::Null);
        query::set_room(None);
        answer(side.answer(&hub, reply, doc.as_deref()));
        while let Some(line) = next() {
            match line.as_deref().and_then(|l| side.read(&mut hub, l)) {
                Some(answered) => answer(answered),
                None => {
                    carried = Some(line);
                    break;
                }
            }
        }
    }
}

impl CanvasSide {
    fn scenario(&self, fault: bool) -> Option<Scenario> {
        let mut input = self.world.clone();
        if !fault {
            input.remove("fault");
        }
        let (refresh_hz, lead, check) = CANVAS_CLOCK;
        input.insert(
            "clock".into(),
            json!({"refresh_hz": refresh_hz, "lead": lead, "check": check}),
        );
        input.insert("calls".into(), Value::Array(self.calls.clone()));
        let mut scenario = scenario(&input)?;
        scenario.record = self.record.clone();
        scenario.recorded = self.recorded.clone();
        Some(scenario)
    }

    /// Stamps a call with the time it is played at, one spacing after the call before it.
    fn timed(&self, call: &mut Map<String, Value>) {
        let name = call.get("call").and_then(Value::as_str).unwrap_or_default();
        // deep_query's `at` is the times it reads, geometry's and fn's what they read at (#1718).
        let key = match ["deep_query", "geometry", "fn", "deep_kinds"].contains(&name) {
            true => "arrives",
            false => "at",
        };
        call.insert(key.into(), json!((self.played + 1) * CANVAS_SPACING));
    }

    /// A line answered here (the world, a line that can't be read, the window drawn), or the
    /// scenario its call plays in, after every kept call, with the document the call names and
    /// the room its reply may take.
    fn line(
        &mut self,
        startup: &Startup,
        line: &str,
    ) -> Result<(Scenario, Option<String>, Option<usize>), Value> {
        let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
            return Err(bad_input());
        };
        if let Some(Value::Object(world)) = input.get("world") {
            // The record's objects are read here, once; a replay's run entries (a list) stay in the world.
            let mut world = world.clone();
            let record = match world.get("record") {
                Some(Value::Object(_)) => {
                    let record = record_objects(&world).ok_or_else(bad_input)?;
                    world.remove("record");
                    record
                }
                _ => BTreeMap::new(),
            };
            let recorded = match world.get("docs") == self.world.get("docs") {
                true => self.recorded.clone(),
                false => std::sync::Arc::new(shared::recorded(&world).ok_or_else(bad_input)?),
            };
            let before = std::mem::replace(&mut self.world, world);
            if self.scenario(false).is_none() {
                self.world = before;
                return Err(bad_input());
            }
            self.record = std::sync::Arc::new(record);
            self.recorded = recorded;
            return Err(json!({"ok": true}));
        }
        let Some(Value::Object(call)) = input.get("call") else {
            return Err(bad_input());
        };
        let mut call = call.clone();
        let out = call.remove("out");
        let room = room(&mut call);
        let doc = call.get("doc").and_then(Value::as_str).map(str::to_string);
        let read = READS.contains(&call.get("call").and_then(Value::as_str).unwrap_or_default());
        self.timed(&mut call);
        self.calls.push(Value::Object(call));
        let scenario = self.scenario(true);
        if read || scenario.is_none() {
            self.calls.pop();
        }
        let scenario = scenario.ok_or_else(bad_input)?;
        self.played += 1;
        match out.as_ref().and_then(Value::as_str) {
            // The window as the calls leave it, drawn and written to `out`; the reply is the
            // `screen` call's own, with the picture's size and each item's box beside it.
            Some(out) if scenario.window.is_some() => {
                let mut drawn = screen(&scenario, startup, out, 0, 1.0);
                let Some(Value::Array(mut replies)) = drawn.get_mut("replies").map(Value::take)
                else {
                    return Err(drawn);
                };
                let mut reply = replies.pop().unwrap_or(Value::Null);
                for k in ["width", "height", "items"] {
                    reply[k] = drawn[k].take();
                }
                Err(json!({"ok": true, "reply": reply, "held": self.calls.len()}))
            }
            _ => Ok((scenario, doc, room)),
        }
    }

    /// The answer to a call `hub` played: its reply, the revision it presented and how many calls
    /// the side holds after it.
    fn answer(&self, hub: &hub::Hub, reply: Value, doc: Option<&str>) -> Value {
        let presented = match doc {
            // #1415: a patch that changed nothing made no revision to present, nor did one that
            // wasn't applied, nor a dry run (#1721).
            Some(doc)
                if reply.get("rev").is_some()
                    && reply.get("dry_run").is_none()
                    && !["refused", "no_change", "conflict", "superseded"]
                        .contains(&reply["outcome"].as_str().unwrap_or_default()) =>
            {
                hub.presented_revision(doc)
            }
            _ => None,
        };
        json!({"ok": true, "reply": reply, "presented": presented, "held": self.calls.len()})
    }

    /// A read played on `hub`, which has played every kept call: at the read's time, as a fresh
    /// hub would play it after them; `None` for a line that isn't a read it can play.
    fn read(&mut self, hub: &mut hub::Hub, line: &str) -> Option<Value> {
        let Ok(Value::Object(input)) = serde_json::from_str::<Value>(line) else {
            return None;
        };
        let (None, Some(Value::Object(call))) = (input.get("world"), input.get("call")) else {
            return None;
        };
        let name = call.get("call").and_then(Value::as_str).unwrap_or_default();
        if call.contains_key("out") || !READS.contains(&name) {
            return None;
        }
        let mut call = call.clone();
        let room = room(&mut call);
        self.timed(&mut call);
        let parsed = crate::call(&call)?;
        self.played += 1;
        hub.arrive(self.played * CANVAS_SPACING);
        query::set_room(room);
        let reply = hub.call(&parsed);
        query::set_room(None);
        Some(self.answer(hub, reply, call.get("doc").and_then(Value::as_str)))
    }
}

/// #2896: the bytes a call's reply may take, a fifth under what its client keeps. It is the hub's,
/// never one of the call's fields, so it is taken off the call before the call is read or kept.
fn room(call: &mut Map<String, Value>) -> Option<usize> {
    call.remove("room")
        .and_then(|r| r.as_u64())
        .map(|r| r as usize)
}
