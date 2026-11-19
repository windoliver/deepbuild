//! What a document session does with each call in each state (issue #1415; canvas primitives:
//! Document session): one table, a `match` over the state and the call with no wildcard arm, so a
//! new state or call fails to compile until it decides every cell. `session_table` serves it, so
//! a writer reads why a call was refused. A call to a frozen or closed session that would do
//! nothing is refused with `session_frozen` or `session_closed`, never answered with success.

use deep_canvas::document::{Issue, Patched};
use deep_canvas::schedule::canonical;
use serde_json::{json, Map, Value};

use crate::hub::{Body, Call as HubCall, Hub};

/// A document session's state (Document session: `state`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    /// A revision is in its check: the current one is the last that passed.
    Checking,
    Live,
    /// The newest revision it was sent was refused: the last good one stays current.
    Refused,
    /// An operator panicked: the session stays at its last good revision, running nothing.
    Frozen,
    /// Its panel is hidden: it is neither evaluated nor called back.
    Hidden,
    /// Closed, as you closing its panel: nothing it is sent acts.
    Closed,
}

/// Every call a writer makes on one document's session.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Call {
    /// `deep_show` with a whole revision.
    Show,
    Patch,
    Undo,
    /// A revision drawn back at a time, `deep_show` with no document.
    RenderBack,
    /// `deep_query`.
    Query,
    /// A frame of the session (`eval`).
    Frame,
    Close,
    /// The planted call of #1415's AC4: undecided for `Hidden` under its undecided feature.
    #[cfg(any(
        feature = "test-session-call-undecided",
        feature = "test-session-call-decided"
    ))]
    Planted,
}

/// One cell: the call acts, saying what it does, or is refused with a code, saying why.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cell {
    Acts(&'static str),
    Refused {
        code: &'static str,
        why: &'static str,
    },
}

const FROZEN: Cell = Cell::Refused {
    code: "session_frozen",
    why: "an operator panicked in this session, so it stays at its last good revision and runs nothing; send a whole revision to replace it, or close it",
};
const CLOSED: Cell = Cell::Refused {
    code: "session_closed",
    why: "the session is closed: its document is no longer shown anywhere, and nothing sent to it acts",
};
const HIDDEN: Cell = Cell::Refused {
    code: "hidden",
    why: "a hidden session is neither evaluated nor called back: the frame is evaluated once its panel shows again",
};

/// What `call` does in `state`.
pub fn cell(state: State, call: Call) -> Cell {
    use Call::*;
    use State::*;
    match (state, call) {
        (Checking, Show) => Cell::Acts("checked after the revision in its check; the newest that passes becomes current"),
        (Checking, Patch) => Cell::Acts("checked after the revision in its check, rebased on it when no ID it touches changed"),
        (Checking, Undo) => Cell::Acts("checked after the revision in its check"),
        (Checking, RenderBack) => Cell::Acts("draws a revision the session has had; the one in its check isn't one yet"),
        (Checking, Query) => Cell::Acts("reads the current revision; the one in its check isn't current yet"),
        (Checking, Frame) => Cell::Acts("evaluates the current revision"),
        (Checking, Close) => Cell::Acts("closes the session; the revision in its check never becomes current"),
        (Live, Show) => Cell::Acts("checks the revision; it becomes current once it passes"),
        (Live, Patch) => Cell::Acts("checks the patched revision; it becomes current once it passes"),
        (Live, Undo) => Cell::Acts("puts back what the writer's patch changed, as a new revision"),
        (Live, RenderBack) => Cell::Acts("draws the revision at the time asked"),
        (Live, Query) => Cell::Acts("reads the revision's evaluated rows"),
        (Live, Frame) => Cell::Acts("evaluates the current revision at the frame's time"),
        (Live, Close) => Cell::Acts("closes the session"),
        (Refused, Show) => Cell::Acts("checks the revision; it replaces the last good one once it passes"),
        (Refused, Patch) => Cell::Acts("checks the patch on the last good revision"),
        (Refused, Undo) => Cell::Acts("puts back what the writer's patch changed, on the last good revision"),
        (Refused, RenderBack) => Cell::Acts("draws a revision the session has had: the refused one never was one"),
        (Refused, Query) => Cell::Acts("reads the last good revision"),
        (Refused, Frame) => Cell::Acts("evaluates the last good revision"),
        (Refused, Close) => Cell::Acts("closes the session"),
        (Frozen, Show) => Cell::Acts("checks the revision; once it passes it replaces the frozen one and the session runs again"),
        (Frozen, Patch | Undo | RenderBack | Query | Frame) => FROZEN,
        (Frozen, Close) => Cell::Acts("closes the session"),
        (Hidden, Show) => Cell::Acts("checks the revision and makes it current; nothing is presented until its panel shows"),
        (Hidden, Patch) => Cell::Acts("checks the patched revision; it becomes current, shown once its panel shows"),
        (Hidden, Undo) => Cell::Acts("puts back what the writer's patch changed, as a new revision"),
        (Hidden, RenderBack) => Cell::Acts("draws the revision headless, apart from the hidden panel"),
        (Hidden, Query) => Cell::Acts("reads the revision's evaluated rows"),
        (Hidden, Frame) => HIDDEN,
        (Hidden, Close) => Cell::Acts("closes the session"),
        (Closed, Show | Patch | Undo | RenderBack | Query | Frame | Close) => CLOSED,
        #[cfg(any(
            feature = "test-session-call-undecided",
            feature = "test-session-call-decided"
        ))]
        (Checking | Live | Refused, Planted) => Cell::Acts("the planted call"),
        #[cfg(any(
            feature = "test-session-call-undecided",
            feature = "test-session-call-decided"
        ))]
        (Frozen, Planted) => FROZEN,
        #[cfg(any(
            feature = "test-session-call-undecided",
            feature = "test-session-call-decided"
        ))]
        (Closed, Planted) => CLOSED,
        #[cfg(feature = "test-session-call-decided")]
        (Hidden, Planted) => HIDDEN,
    }
}

impl State {
    const ALL: [State; 6] = [
        State::Checking,
        State::Live,
        State::Refused,
        State::Frozen,
        State::Hidden,
        State::Closed,
    ];

    pub fn name(self) -> &'static str {
        match self {
            State::Checking => "checking",
            State::Live => "live",
            State::Refused => "refused",
            State::Frozen => "frozen",
            State::Hidden => "hidden",
            State::Closed => "closed",
        }
    }
}

impl Call {
    const ALL: [Call; 7] = [
        Call::Show,
        Call::Patch,
        Call::Undo,
        Call::RenderBack,
        Call::Query,
        Call::Frame,
        Call::Close,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Call::Show => "show",
            Call::Patch => "patch",
            Call::Undo => "undo",
            Call::RenderBack => "render_back",
            Call::Query => "query",
            Call::Frame => "frame",
            Call::Close => "close",
            #[cfg(any(
                feature = "test-session-call-undecided",
                feature = "test-session-call-decided"
            ))]
            Call::Planted => "planted",
        }
    }
}

/// The document and the session call a hub call is, if it is one; a patch and an undo are
/// decided where they are checked, which a patch queued on the clock reaches without `call`.
pub fn session_call(call: &HubCall) -> Option<(&str, Call)> {
    match call {
        HubCall::Show(show) => Some((&show.doc, Call::Show)),
        HubCall::Mode(show, _) => Some((&show.doc, Call::RenderBack)),
        HubCall::RenderBack { doc, .. } => Some((doc, Call::RenderBack)),
        HubCall::SceneQuery(q) => Some((&q.doc, Call::Query)),
        HubCall::Eval(e) => Some((&e.doc, Call::Frame)),
        HubCall::Close(doc) => Some((doc, Call::Close)),
        _ => None,
    }
}

/// Whether a patch's ops left every item they wrote with the content key it had: its canonical
/// bytes.
pub fn keys_unchanged(patched: &Patched, doc: &Value) -> bool {
    patched
        .before
        .iter()
        .all(|(id, was)| match (was, doc["items"].get(id)) {
            (Some(a), Some(b)) => canonical(a) == canonical(b),
            (was, now) => was.is_none() && now.is_none(),
        })
}

/// Planted: each item a create in `patch` names that `doc` already holds, taken out of `doc` so
/// the create replaces it, kept as a patch's before so a rollback puts it back.
pub fn taken_for_creates(doc: &mut Value, patch: &Value) -> Patched {
    let mut taken = Patched::default();
    let creates = patch["ops"].as_array().into_iter().flatten();
    for op in creates.filter(|op| op["op"] == "create") {
        let id = op["item"]["id"].as_str().unwrap_or_default();
        if let Some(held) = doc["items"]
            .as_object_mut()
            .and_then(|i| i.shift_remove(id))
        {
            taken.before.insert(id.to_string(), Some(held));
        }
    }
    taken
}

impl Hub<'_> {
    /// The state of `doc`'s session: closed, frozen, hidden, checking a revision, refused, or
    /// live, the first that holds.
    pub fn session_state(&self, doc: &str) -> State {
        let panel = self.scenario.docs.contains_key(doc);
        if self.closed.contains(doc) {
            State::Closed
        } else if self.sessions.get(doc).is_some_and(|s| s.frozen().is_some()) {
            State::Frozen
        } else if panel && !self.doc_visible(doc) {
            State::Hidden
        } else if self.shared.get(doc).and_then(|s| s.revs.last()?.current_at) > Some(self.now) {
            State::Checking
        } else if self.refused.contains(doc) {
            State::Refused
        } else {
            State::Live
        }
    }

    /// The revision `doc`'s session holds: a shared document's current one, else the newest
    /// whose check passed.
    pub fn held_rev(&self, doc: &str) -> Option<u64> {
        match self.shown(doc) {
            Some(k) => Some(self.shared[doc].revs[k].rev),
            None => self.current(doc).map(|r| r.rev),
        }
    }

    /// `call`'s reply on `doc` when its cell refuses it in the session's state: the code, the
    /// state and why, and for a frozen session the last good revision it stays at. A hidden
    /// session's frame isn't presented, as `deep_show` answers on a hidden panel.
    pub fn refused_by_state(&self, doc: &str, call: Call) -> Option<Value> {
        let state = self.session_state(doc);
        let Cell::Refused { code, why } = cell(state, call) else {
            return None;
        };
        let named = json!({"state": state.name(), "call": call.name(), "why": why});
        let mut reply = if state == State::Hidden {
            json!({"outcome": "not_presented", "reason": code, "nodes": []})
        } else {
            let issue = json!({"code": code, "severity": "error", "ids": [], "path": "session",
                               "actual": state.name(), "what": why});
            json!({"outcome": "refused", "code": code, "issues": [issue], "snapshots": []})
        };
        for (k, v) in named.as_object().into_iter().flatten() {
            reply[k] = v.clone();
        }
        if let Some(rev) = self.held_rev(doc).filter(|_| state != State::Hidden) {
            reply["rev"] = json!(rev);
            if state == State::Frozen {
                reply["last_good_rev"] = json!(rev);
            }
        }
        Some(reply)
    }

    /// A patch or an undo its session's state refuses: the cell's code, the state, why, and a
    /// frozen session's last good revision put in `reply`, and the issue it is refused with.
    pub fn patch_refused(
        &self,
        doc: &str,
        body: &Body,
        reply: &mut Map<String, Value>,
    ) -> Option<Issue> {
        let call = match body {
            Body::Patch(_) => Call::Patch,
            Body::Undo { .. } => Call::Undo,
        };
        let state = self.session_state(doc);
        let Cell::Refused { code, why } = cell(state, call) else {
            return None;
        };
        let refused = self.refused_by_state(doc, call).unwrap_or_default();
        for k in ["code", "state", "call", "why", "last_good_rev"] {
            if let Some(v) = refused.get(k) {
                reply.insert(k.into(), v.clone());
            }
        }
        Some(Issue::envelope(
            code,
            "session".into(),
            json!(state.name()),
            why,
        ))
    }

    /// What a revision a writer sent leaves the session: refused when it was refused or met a
    /// conflict, live once one becomes current; a refusal for the session's state leaves it as it
    /// was.
    pub fn note_outcome(&mut self, doc: &str, reply: &Value) {
        match reply["outcome"].as_str() {
            _ if reply.get("state").is_some() => {}
            Some("refused" | "conflict") => {
                self.refused.insert(doc.to_string());
            }
            Some("applied" | "presented" | "not_presented") => {
                self.refused.remove(doc);
            }
            _ => {}
        }
    }

    /// After a session call the gate let through: a whole revision's outcome noted, and one that
    /// replaced a frozen shared document's revision runs its session again at once.
    pub fn after_session_call(
        &mut self,
        called: Option<(String, Call)>,
        frozen: bool,
        reply: &Value,
    ) {
        if let Some((doc, Call::Show)) = called {
            self.note_outcome(&doc, reply);
            if frozen && reply["outcome"] != "refused" {
                self.load_shared(&doc);
            }
        }
    }

    /// A shared document's session loaded with its current revision when that changed, so a
    /// frame evaluates it live and an operator's panic freezes it as built; the revision.
    pub fn load_shared(&mut self, doc: &str) -> Option<u64> {
        let k = self.shown(doc)?;
        let shared = &self.shared[doc];
        let (rev, form) = (shared.revs[k].rev, shared.at(k).0.into_owned());
        if !self.sessions.contains_key(doc) {
            let fresh = self.new_session();
            self.sessions.insert(doc.to_string(), fresh);
        }
        let session = self.sessions.get_mut(doc).expect("made above");
        if session.document() != Some(&form) {
            session.load(&mut self.sched, &form);
        }
        Some(rev)
    }

    /// `close`: the document's session closed; every later call to it is refused.
    pub fn close(&mut self, doc: &str) -> Value {
        let known = self.scenario.docs.contains_key(doc)
            || self.shared.contains_key(doc)
            || self.revisions.contains_key(doc);
        if !known {
            return json!({"outcome": "refused", "code": "ref_unresolved", "doc": doc});
        }
        self.closed.insert(doc.to_string());
        json!({"outcome": "closed", "doc": doc})
    }
}

/// `{"call": "session_table"}`: every state against every call, each cell acting, with what it
/// does, or refusing, with its code and why.
pub fn table() -> Value {
    let cells: Vec<Value> = State::ALL
        .iter()
        .flat_map(|s| Call::ALL.iter().map(move |c| (*s, *c)))
        .map(|(s, c)| match cell(s, c) {
            Cell::Acts(does) => json!({"state": s.name(), "call": c.name(), "acts": true, "code": null, "does": does}),
            Cell::Refused { code, why } => json!({"state": s.name(), "call": c.name(), "acts": false, "code": code, "why": why}),
        })
        .collect();
    json!({
        "states": State::ALL.map(State::name),
        "calls": Call::ALL.map(Call::name),
        "cells": cells,
    })
}
