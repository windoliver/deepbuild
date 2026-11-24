//! `deep-show canvas` (#806): the hub's canvas side, long-lived. Its world (a scenario's fields but
//! `calls`, `clock` and `at`) is the hub's: the sessions it bound, the documents it minted, the
//! record's objects, the claims, the window and card. Each call is played once, on the clock the
//! side keeps, by the hub that played the call before it (#3262), and answered with its reply, so
//! the replies are the stand-in's for the kept calls in the same order: when the world changes
//! what a kept call did, that hub is let go and the next call's plays the kept calls again first.
//! A fault holds a call each time it is played.

use super::*;

/// The virtual display clock `canvas` plays its calls on (#806): 120 Hz, the latch 2 ms before vsync,
/// half a millisecond a check, and each call ten frames after the one before, so a patch is current
/// at a latch before the next call arrives, as on the stand-in's clock (#384, #96).
const CANVAS_CLOCK: (i64, i64, i64) = (120, 1_411_200, 352_800);
const CANVAS_SPACING: i64 = 10 * (shared::FLICKS / 120);

/// #2694: calls that change no document, session, window or terminal state. Each is answered at
/// its time and not kept: playing it again would change no later reply. deep_query is one (#2896):
/// its cursor is a row index on the revision it names, and a walk paged to fit its client would
/// otherwise evaluate every earlier page again on each new one. A render-back is one (#3262): it
/// mints no revision and writes nothing but its snapshot, by hash.
const READS: [&str; 7] = [
    "deep_kinds",
    "cells",
    "cell",
    "updates",
    "revisions",
    "deep_query",
    "render_back",
];

struct CanvasSide {
    /// The world but its record's objects, which `record` holds.
    world: Map<String, Value>,
    /// The world's record objects (#1868): read once when the hub sends its world, then shared by
    /// every call's scenario, so a call that draws nothing from the record pays nothing for it.
    record: std::sync::Arc<BTreeMap<String, RecordObject>>,
    /// #2694: the calls kept to play again, each at the time it was first played; #3262: as its
    /// JSON text, which is read again only by a hub that plays them again.
    calls: Vec<String>,
    /// #2694: the calls played, reads included: the clock moves one spacing with each.
    played: i64,
}

/// Answers `deep-show canvas`'s lines in order: `next` gives each line (`None` for one that isn't
/// UTF-8) until the input ends. A call is played on the hub that played the calls before it
/// (#3262), a read at its time as any other (#2694); a fresh hub plays the kept calls first when
/// there is none, or when the world changed what one of them did.
pub(super) fn serve(
    startup: &Startup,
    mut next: impl FnMut() -> Option<Option<String>>,
    mut answer: impl FnMut(Value),
) {
    let mut side = CanvasSide {
        world: Map::from_iter([("evidence".to_string(), json!(""))]),
        record: Default::default(),
        calls: Vec::new(),
        played: 0,
    };
    // #3262: a world of nothing, which outlives every world the hub sends: the kept hub reads it
    // between two calls' scenarios, while the side takes a line that isn't a call.
    let nowhere = side
        .scenario(false, false)
        .expect("the side's first world is a scenario");
    let mut kept: Option<hub::Hub> = None;
    let mut carried = None;
    while let Some(line) = carried.take().or_else(|| next().map(object)) {
        let mut call = match line.map(|input| side.line(input, &mut kept)) {
            None => {
                answer(bad_input());
                continue;
            }
            Some(Err(answered)) => {
                answer(answered);
                continue;
            }
            Some(Ok(call)) => call,
        };
        // The world as it stands: after the kept calls for a fresh hub, which plays them first.
        let Some(scenario) = side.scenario(true, kept.is_none()) else {
            answer(bad_input());
            continue;
        };
        let mut hub = match kept.take() {
            Some(hub) => hub.onto(&scenario, startup),
            None => {
                let mut hub = hub::Hub::new(&scenario, startup);
                hub.run_calls();
                hub
            }
        };
        loop {
            answer(side.play(&mut hub, startup, call));
            call = match next().map(|line| object(line).map(call_of)) {
                None => return,
                Some(Some(Ok(call))) => call,
                Some(Some(Err(input))) => {
                    carried = Some(Some(input));
                    break;
                }
                Some(None) => {
                    carried = Some(None);
                    break;
                }
            };
        }
        kept = Some(hub.onto(&nowhere, startup));
    }
}

impl CanvasSide {
    /// The world as a scenario on the side's clock: with its fault or without, and after the kept
    /// calls or none.
    fn scenario(&self, fault: bool, calls: bool) -> Option<Scenario> {
        let mut input = self.world.clone();
        if !fault {
            input.remove("fault");
        }
        let (refresh_hz, lead, check) = CANVAS_CLOCK;
        input.insert(
            "clock".into(),
            json!({"refresh_hz": refresh_hz, "lead": lead, "check": check}),
        );
        let calls: Vec<Value> = match calls {
            true => (self.calls.iter())
                .map(|call| serde_json::from_str(call).ok())
                .collect::<Option<_>>()?,
            false => Vec::new(),
        };
        input.insert("calls".into(), Value::Array(calls));
        let mut scenario = scenario(&input)?;
        scenario.record = self.record.clone();
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

    /// A line answered here (the world, a line that can't be read), or the call it holds. A world
    /// that changes what a kept call did lets `kept` go (#3262).
    fn line(
        &mut self,
        input: Map<String, Value>,
        kept: &mut Option<hub::Hub>,
    ) -> Result<Map<String, Value>, Value> {
        let mut input = match call_of(input) {
            Ok(call) => return Ok(call),
            Err(input) => input,
        };
        let Some(Value::Object(mut world)) = input.remove("world") else {
            return Err(bad_input());
        };
        // The record's objects are read here, once; a replay's run entries (a list) stay in the world.
        let record = match world.get("record") {
            Some(Value::Object(_)) => {
                let record = record_objects(&world).ok_or_else(bad_input)?;
                world.remove("record");
                record
            }
            _ => BTreeMap::new(),
        };
        let before = std::mem::replace(&mut self.world, world);
        if self.scenario(false, false).is_none() {
            self.world = before;
            return Err(bad_input());
        }
        *kept = (kept.take()).filter(|_| self.played_the_same(&before, &record));
        self.record = std::sync::Arc::new(record);
        Err(json!({"ok": true}))
    }

    /// #3262: whether a fresh hub would play the kept calls in the world as it is now, with the
    /// record's objects `record`, as they were played in `before` with the side's own. So it is
    /// when nothing differs but a session that is new, a document newly on a panel, and the
    /// record's objects, and no kept call names one of those. A session that ended, a claim or a
    /// pack that changed, and anything else the hub was built on, are played again.
    fn played_the_same(
        &self,
        before: &Map<String, Value>,
        record: &BTreeMap<String, RecordObject>,
    ) -> bool {
        let none = Map::new();
        let held = |world: &Map<String, Value>, other: &Map<String, Value>| {
            (world.iter()).all(|(k, v)| k == "sessions" || k == "docs" || other.get(k) == Some(v))
        };
        if !held(before, &self.world) || !held(&self.world, before) {
            return false;
        }
        let (was, is) = (
            part(before, "sessions", &none),
            part(&self.world, "sessions", &none),
        );
        if was.iter().any(|(id, s)| is.get(id) != Some(s)) {
            return false;
        }
        for (id, s) in is.iter().filter(|(id, _)| !was.contains_key(*id)) {
            // A writer is found by its thread, and a call that draws for no session in particular
            // takes the first there is.
            let thread =
                (is.iter()).any(|(other, o)| other != id && o.get("thread") == s.get("thread"));
            if was.is_empty() || thread || self.names(id) {
                return false;
            }
        }
        let (was, is) = (
            part(before, "docs", &none),
            part(&self.world, "docs", &none),
        );
        if was.iter().any(|(id, d)| is.get(id) != Some(d)) {
            return false;
        }
        for (id, d) in is.iter().filter(|(id, _)| !was.contains_key(*id)) {
            // One stored at revision 0, minted for a claim or linked is opened with the hub.
            let on_panel = (d.as_object()).is_some_and(|d| d.len() == 1 && d.contains_key("panel"));
            // A document holds a doc ID in lower case.
            let lower = id.to_ascii_lowercase();
            if !on_panel || self.names(id) || (lower != *id && self.names(&lower)) {
                return false;
            }
        }
        let same = |a: &RecordObject, b: &RecordObject| {
            a.session == b.session && a.state == b.state && a.value == b.value && a.as_of == b.as_of
        };
        let mut changed = (self.record.iter())
            .filter(|&(handle, o)| record.get(handle).is_none_or(|n| !same(o, n)))
            .map(|(handle, _)| handle)
            .chain(record.keys().filter(|&h| !self.record.contains_key(h)));
        !changed.any(|handle| self.names(handle))
    }

    /// Whether a kept call names `id`: what a kept call read of the world, it read by a name it holds.
    fn names(&self, id: &str) -> bool {
        // As a call's text holds it: the JSON string, without its quotes.
        let text = Value::from(id).to_string();
        let text = &text[1..text.len() - 1];
        text.is_empty() || self.calls.iter().any(|call| call.contains(text))
    }

    /// Plays one call on `hub`, which has played every kept call before it, at its time, as
    /// `run_calls` plays a call that arrives alone on the side's clock: its answer, or that of a
    /// call that can't be read.
    fn play(
        &mut self,
        hub: &mut hub::Hub,
        startup: &Startup,
        mut call: Map<String, Value>,
    ) -> Value {
        let out = call.remove("out");
        let room = room(&mut call);
        self.timed(&mut call);
        let Some(parsed) = crate::call(&call) else {
            return bad_input();
        };
        self.played += 1;
        let at = self.played * CANVAS_SPACING;
        let doc = call.get("doc").and_then(Value::as_str).map(str::to_string);
        let read = READS.contains(&call.get("call").and_then(Value::as_str).unwrap_or_default());
        let out = (out.as_ref().and_then(Value::as_str)).filter(|_| hub.scenario.window.is_some());
        if !read || out.is_some() {
            self.calls.push(Value::Object(call).to_string());
        }
        // The window as the calls leave it, drawn and written to `out` by a hub of its own, which
        // plays them all: drawing the window changes the hub that draws it.
        let drawn = out.map(|out| match self.scenario(true, true) {
            Some(all) => screen(&all, startup, out, 0, 1.0),
            None => bad_input(),
        });
        if read && drawn.is_some() {
            self.calls.pop();
        }
        hub.arrive(at);
        query::set_room(room);
        let reply = match &parsed {
            // A patch that has a writer, and any patch in the planted one queue, waits for the
            // checker, one check: the checker is free, since no call arrives within a check of it.
            Call::Patch(patch) => {
                let fifo = hub.scenario.planted == Some(Planted::OneFifoCheckQueue);
                let checked = match fifo || hub.writer(&patch.via).is_some() {
                    true => at + CANVAS_CLOCK.2,
                    false => at,
                };
                hub.now = checked;
                let mut reply = hub.patch(patch, Some(at), checked);
                hub.stamp(&mut reply);
                reply
            }
            call => hub.call(call),
        };
        query::set_room(None);
        let Some(mut drawn) = drawn else {
            return self.answer(hub, reply, doc.as_deref());
        };
        // The reply is the `screen` call's own, with the picture's size and each item's box beside it.
        let Some(Value::Array(mut replies)) = drawn.get_mut("replies").map(Value::take) else {
            return drawn;
        };
        let mut reply = replies.pop().unwrap_or(Value::Null);
        for k in ["width", "height", "items"] {
            reply[k] = drawn[k].take();
        }
        json!({"ok": true, "reply": reply, "held": self.calls.len()})
    }

    /// The answer to a call `hub` played: its reply, the revision it presented and how many calls
    /// the side holds after it.
    fn answer(&self, hub: &hub::Hub, reply: Value, doc: Option<&str>) -> Value {
        let presented = match doc {
            // #1415: a patch that changed nothing made no revision to present.
            Some(doc)
                if reply.get("rev").is_some()
                    && reply["outcome"] != "refused"
                    && reply["outcome"] != "applied"
                    && reply["outcome"] != "no_change" =>
            {
                hub.presented_revision(doc)
            }
            _ => None,
        };
        json!({"ok": true, "reply": reply, "presented": presented, "held": self.calls.len()})
    }
}

impl hub::Hub<'_> {
    /// #3262: this hub as it stands, reading another world: every field moves, and its scheduler
    /// goes on with them on `startup`'s sealed set, the one it was built on.
    fn onto<'b>(self, scenario: &'b Scenario, startup: &'b Startup) -> hub::Hub<'b> {
        hub::Hub {
            scenario,
            startup,
            sched: self.sched.on(&startup.sealed),
            revisions: self.revisions,
            shared: self.shared,
            now: self.now,
            applied_at: self.applied_at,
            written: self.written,
            look: self.look,
            look_def: self.look_def,
            display_only: self.display_only,
            mode_ids: self.mode_ids,
            renderer: self.renderer,
            inset_pictures: self.inset_pictures,
            tour_anchors: self.tour_anchors,
            background: self.background,
            session_state: self.session_state,
            tracks: self.tracks,
            forms: self.forms,
            sessions: self.sessions,
            clips: self.clips,
            panels_shown: self.panels_shown,
            gpu3: self.gpu3,
            hash_pass: self.hash_pass,
            pending3d: self.pending3d,
            pending_light: self.pending_light,
            scopes: self.scopes,
            serial: self.serial,
            ring: self.ring,
            shown_at: self.shown_at,
            closed: self.closed,
            refused: self.refused,
            asks: self.asks,
            verdicts_made: self.verdicts_made,
            audit_asks: self.audit_asks,
            review: self.review,
            light_cost: self.light_cost,
            packs: self.packs,
            pack_rows: self.pack_rows,
            pack_authors: self.pack_authors,
            expansions: self.expansions,
            expansion_cache: self.expansion_cache,
            first_frames: self.first_frames,
            carried_rows: self.carried_rows,
            first_orders: self.first_orders,
            placement: self.placement,
            terms: self.terms,
            capturing: self.capturing,
            media: self.media,
            gate: self.gate,
            ports: self.ports,
            card_rearms: self.card_rearms,
            card_down: self.card_down,
            vias: self.vias,
            shapings: self.shapings,
            card_answer: self.card_answer,
            present: self.present,
            sandbox: self.sandbox,
        }
    }
}

/// A line as the JSON object it holds; `None` for one that holds none.
fn object(line: Option<String>) -> Option<Map<String, Value>> {
    match serde_json::from_str(&line?) {
        Ok(Value::Object(input)) => Some(input),
        _ => None,
    }
}

/// The call a line holds, or the line back when it holds a world or no call.
fn call_of(mut input: Map<String, Value>) -> Result<Map<String, Value>, Map<String, Value>> {
    if matches!(input.get("world"), Some(Value::Object(_))) {
        return Err(input);
    }
    match input.remove("call") {
        Some(Value::Object(call)) => Ok(call),
        _ => Err(input),
    }
}

/// A world's `key` as a map: `none` where it gives none.
fn part<'a>(
    world: &'a Map<String, Value>,
    key: &str,
    none: &'a Map<String, Value>,
) -> &'a Map<String, Value> {
    world.get(key).and_then(Value::as_object).unwrap_or(none)
}

/// #2896: the bytes a call's reply may take, a fifth under what its client keeps. It is the hub's,
/// never one of the call's fields, so it is taken off the call before the call is read or kept.
fn room(call: &mut Map<String, Value>) -> Option<usize> {
    call.remove("room")
        .and_then(|r| r.as_u64())
        .map(|r| r as usize)
}
