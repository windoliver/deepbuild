//! The hub's canvas side for one scenario (issue #393): who a call writes as (the session a
//! deep_show call bound to, or the agent whose process tree a `deep show` runs in, by the peer
//! check), each document's revisions and its writer layer, the check before a revision becomes
//! current, render-back's snapshots of a settled frame, and the bands on screen.
//!
//! The scenario stands in for what the hub knows and this slice can't build: its bound sessions,
//! the OS process table, the documents it minted, the record's objects and who may read them,
//! claims and their deliverables, the window and the question card.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use deep_canvas::document::{canonical, check, Issue};
use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas::show::{
    inline_count, order_issues, stamp, truncated, unreadable_handles, whole_diff, Band, Diff,
    Scope, Writer, WriterKind,
};
use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::scene::Record;
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::snapshot::{self, Renderer, Unfit};

/// deep_show answers within 2 s: a snapshot whose frame hasn't settled by then is not presented
/// (Admission and latch; Render-back).
const SETTLE_TIMEOUT: Duration = Duration::from_secs(2);

/// The criteria's wrong programs, each reachable only through the scenario's `planted`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    PresentsUnnamedRemoval,
    DiffsItemsOnly,
    InlinesEveryIssue,
    CutsWithoutTruncated,
    SortsByOrderKeyAlone,
}

/// What keeps a frame from settling.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hold {
    FallbackPipeline,
    RebuildQueue,
    AssetDecode,
}

/// The fault fixture: for `ms` after a call that renders is admitted, its frame can't settle.
#[derive(Clone, Copy, Debug)]
pub struct Fault {
    pub holds: Hold,
    pub ms: u64,
}

pub struct Session {
    pub thread: String,
    pub name: String,
    /// The agent's process, the parent its hooks came from: (pid, start time).
    pub process: (u64, i64),
}

pub struct Process {
    pub pid: u64,
    pub ppid: u64,
    pub start: i64,
}

pub struct Panel {
    pub rect: [f64; 4],
    pub visible: bool,
}

pub struct RecordObject {
    pub session: Option<String>,
    pub state: Option<String>,
    pub value: Option<f64>,
    pub as_of: Option<i64>,
}

pub struct Claim {
    pub deliverables: Vec<String>,
}

pub struct Card {
    pub question: String,
    pub options: Vec<String>,
    pub rect: [f64; 4],
}

/// Who a call came from: an MCP call and the session it bound to, or a `deep` command and its
/// peer process (pid, start time).
pub enum Via {
    Mcp(Option<String>),
    Cli(u64, i64),
}

pub enum Include {
    Issues,
    Audit,
    Timing,
    Pixels,
}

pub struct Show {
    pub via: Via,
    pub doc: String,
    pub document: Value,
    pub removes: Vec<String>,
    pub t: i64,
    pub size: Option<[u16; 2]>,
    pub include: Vec<Include>,
    pub check: bool,
    pub claim: Option<String>,
}

pub enum Call {
    Show(Box<Show>),
    Revisions(String),
    Screen,
}

pub struct Scenario {
    pub evidence: PathBuf,
    pub sessions: BTreeMap<String, Session>,
    pub processes: Vec<Process>,
    pub panels: BTreeMap<String, Panel>,
    pub docs: BTreeMap<String, String>,
    pub record: BTreeMap<String, RecordObject>,
    pub claims: BTreeMap<String, Claim>,
    pub window: Option<[f64; 2]>,
    pub card: Option<Card>,
    pub fault: Option<Fault>,
    pub planted: Option<Planted>,
    pub calls: Vec<Call>,
}

/// One revision of a document (Revision).
pub struct Row {
    pub rev: u64,
    pub base_rev: u64,
    pub writer: Writer,
    pub hash: String,
    pub state: &'static str,
    /// The stamped document; kept for the current revision's diff and drawing.
    pub doc: Value,
}

/// The hub's state while a scenario runs.
pub struct Hub<'a> {
    pub scenario: &'a Scenario,
    pub revisions: BTreeMap<String, Vec<Row>>,
    pub look: Look,
    pub renderer: Renderer,
}

/// The look render-back draws in: the shipped clean look, light.
pub fn shipped_look() -> Look {
    let def = look::shipped("clean").expect("the clean look ships");
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    look::resolve(&def, &bundled).expect("the clean look resolves")
}

/// `text` (the time grammar) in flicks, at 60 fps.
pub fn flicks(text: &str) -> Option<i64> {
    let ctx = TimeContext {
        frame_rate: (60, 1),
        ..TimeContext::default()
    };
    Time::parse(text).ok()?.resolve(&ctx).ok()
}

impl<'a> Hub<'a> {
    pub fn new(scenario: &'a Scenario) -> Self {
        Hub {
            scenario,
            revisions: BTreeMap::new(),
            look: shipped_look(),
            renderer: Renderer::new(),
        }
    }

    /// The record as one frame reads it: every object's state and reading.
    pub fn record(&self) -> Record {
        let mut record = Record::default();
        for (handle, o) in &self.scenario.record {
            if let Some(state) = &o.state {
                record.states.insert(handle.clone(), state.clone());
            }
            if let Some(value) = o.value {
                record.readings.insert(handle.clone(), value);
                if let Some(a) = o.as_of {
                    record.as_of.insert(handle.clone(), a);
                }
            }
        }
        record
    }

    /// The peer check: the agent whose process tree the peer runs in, matched by PID and start
    /// time, never by PID alone; outside every agent's tree, you.
    fn peer_writer(&self, pid: u64, start: i64) -> (Writer, Option<&'a str>) {
        let s = self.scenario;
        let mut at = s
            .processes
            .iter()
            .find(|p| p.pid == pid && p.start == start);
        let mut steps = 0;
        while let Some(p) = at {
            if let Some(session) = s.sessions.values().find(|x| x.process == (p.pid, p.start)) {
                return (
                    Writer {
                        kind: WriterKind::Agent,
                        id: session.thread.clone(),
                    },
                    Some(session.name.as_str()),
                );
            }
            // A parent started before its child; a later start is another process on a reused PID.
            at = s
                .processes
                .iter()
                .find(|q| q.pid == p.ppid && q.start <= p.start && q.pid != p.pid);
            steps += 1;
            if steps > s.processes.len() {
                break;
            }
        }
        (
            Writer {
                kind: WriterKind::You,
                id: "you".into(),
            },
            None,
        )
    }

    /// Who a call writes as, with the name an agent's outline shows; `None` for a call bound to
    /// no session.
    fn writer(&self, via: &Via) -> Option<(Writer, Option<&'a str>)> {
        match via {
            Via::Mcp(Some(id)) => {
                let session = self.scenario.sessions.get(id)?;
                Some((
                    Writer {
                        kind: WriterKind::Agent,
                        id: session.thread.clone(),
                    },
                    Some(session.name.as_str()),
                ))
            }
            Via::Mcp(None) => None,
            Via::Cli(pid, start) => Some(self.peer_writer(*pid, *start)),
        }
    }

    /// Whether `writer` may read the record's object `handle`: its own session's, or one that
    /// belongs to no session; you read them all.
    fn can_read(&self, writer: &Writer, handle: &str) -> bool {
        let Some(object) = self.scenario.record.get(handle) else {
            return false;
        };
        match (&writer.kind, &object.session) {
            (WriterKind::You, _) | (_, None) => true,
            (WriterKind::Agent, Some(owner)) => self
                .scenario
                .sessions
                .get(owner)
                .is_some_and(|s| s.thread == writer.id),
            _ => false,
        }
    }

    pub fn current(&self, doc: &str) -> Option<&Row> {
        self.revisions
            .get(doc)?
            .iter()
            .find(|r| r.state == "current")
    }

    /// One call's reply.
    pub fn call(&mut self, call: &Call) -> Value {
        match call {
            Call::Show(show) => self.show(show),
            Call::Revisions(doc) => {
                let rows: Vec<Value> = self
                    .revisions
                    .get(doc)
                    .map(|rows| {
                        rows.iter()
                            .map(|r| {
                                json!({
                                    "rev": r.rev,
                                    "base_rev": r.base_rev,
                                    "writer": r.writer.to_json(),
                                    "hash": r.hash,
                                    "state": r.state,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                json!({"revisions": rows})
            }
            Call::Screen => {
                json!({"bands": self.bands().iter().map(|b| b.to_json()).collect::<Vec<_>>()})
            }
        }
    }

    /// Every layer on screen, back to front, and the card last.
    pub fn bands(&self) -> Vec<BandRow> {
        let mut rows = Vec::new();
        for (doc, panel) in &self.scenario.docs {
            let visible = self.scenario.panels.get(panel).is_some_and(|p| p.visible);
            let Some(row) = self.current(doc).filter(|_| visible) else {
                continue;
            };
            let name = match row.writer.kind {
                WriterKind::Agent => self
                    .scenario
                    .sessions
                    .values()
                    .find(|s| s.thread == row.writer.id)
                    .map(|s| s.name.clone()),
                _ => None,
            };
            rows.push(BandRow {
                doc: Some(doc.clone()),
                band: row.writer.band(),
                layer: row.writer.layer_id(),
                owner: row.writer.clone(),
                outline: row.writer.outlined(),
                name,
            });
        }
        rows.sort_by(|a, b| a.band.cmp(&b.band).then_with(|| a.doc.cmp(&b.doc)));
        if self.scenario.card.is_some() {
            rows.push(BandRow {
                doc: None,
                band: Band::Card,
                layer: "card".into(),
                owner: Writer {
                    kind: WriterKind::Shell,
                    id: "shell".into(),
                },
                outline: false,
                name: None,
            });
        }
        rows
    }

    fn show(&mut self, show: &Show) -> Value {
        let refused =
            |code: &str| json!({"outcome": "refused", "code": code, "issues": [], "snapshots": []});
        // A call bound to no session never draws, claims or attaches evidence (Socket roles).
        let Some((writer, name)) = self.writer(&show.via) else {
            return refused("no_session");
        };
        let Some(panel) = self
            .scenario
            .docs
            .get(&show.doc)
            .and_then(|p| self.scenario.panels.get(p))
        else {
            return refused("ref_unresolved");
        };
        // R1: a deep_show document is one writer's layer; another writer's whole revision would
        // drop what it never held.
        let current = self.current(&show.doc);
        if current.is_some_and(|c| c.writer != writer) {
            return refused("not_your_layer");
        }
        let current_doc = current.map(|c| c.doc.clone());
        let base_rev = current.map_or(0, |c| c.rev);
        let rev = self.revisions.get(&show.doc).map_or(0, Vec::len) as u64 + 1;
        let title = name.map_or_else(|| "You".to_string(), str::to_string);

        // A doc ID is the record's ULID; the document holds it in lower case, as the ID grammar
        // reads it (a ULID's letters are case-insensitive).
        let stamped = stamp(
            &show.document,
            &show.doc.to_ascii_lowercase(),
            &writer,
            &title,
        );
        let (stamped, mut issues, diff) = match stamped {
            Err(issues) => (None, issues, None),
            Ok(doc) => {
                let mut issues = check(&doc).issues;
                issues.extend(unreadable_handles(&doc, |h| self.can_read(&writer, h)));
                let scope = match self.scenario.planted {
                    Some(Planted::DiffsItemsOnly) => Scope::ItemsOnly,
                    _ => Scope::Every,
                };
                let removes: Vec<String> = match self.scenario.planted {
                    // The planted deep_show takes every ID it dropped as named.
                    Some(Planted::PresentsUnnamedRemoval) => {
                        let mut all = show.removes.clone();
                        if let Err(missing) =
                            whole_diff(current_doc.as_ref(), &doc, &writer.layer_id(), &[], scope)
                        {
                            all.extend(missing.into_iter().flat_map(|i| i.ids));
                        }
                        all
                    }
                    _ => show.removes.clone(),
                };
                let diff = match whole_diff(
                    current_doc.as_ref(),
                    &doc,
                    &writer.layer_id(),
                    &removes,
                    scope,
                ) {
                    Ok(diff) => Some(diff),
                    Err(missing) => {
                        issues.extend(missing);
                        None
                    }
                };
                (Some(doc), issues, diff)
            }
        };
        // What the marks module can't draw is an issue of the revision too.
        let mut drawn = None;
        if let Some(doc) = stamped
            .as_ref()
            .filter(|_| !issues.iter().any(|i| i.severity == "error"))
        {
            let map = doc.as_object().expect("a stamped document is an object");
            match self.renderer.prepare(
                map,
                show.t,
                &self.look.light,
                self.look.status.as_ref(),
                &self.record(),
                &self.scenario.evidence,
            ) {
                Ok(d) => drawn = Some(d),
                Err(Unfit { code, path }) => {
                    let what = "the marks module can't draw this";
                    let item = path
                        .strip_prefix("items/")
                        .and_then(|p| p.split('/').next());
                    issues.push(match item {
                        Some(id) => Issue::error(code, id, path.clone(), Value::Null, what),
                        None => Issue::envelope(code, path, Value::Null, what),
                    });
                }
            }
        }
        let hash = stamped
            .as_ref()
            .and_then(|d| canonical(d).ok())
            .map(|c| c.sha256)
            .unwrap_or_default();

        // Every issue the checks raised, kept as evidence; the reply inlines up to the read cap.
        let mut list: Vec<Value> = issues.iter().map(Issue::to_json).collect();
        order_issues(&mut list);
        let full = serde_json::to_vec(&list).expect("issues serialize");
        let issues_evidence = evidence::put(&self.scenario.evidence, &full).ok();
        let shown = match self.scenario.planted {
            Some(Planted::InlinesEveryIssue) => list.len(),
            _ => inline_count(&list),
        };
        let mut reply = Map::new();
        // A payload refused before it could be stamped makes no revision.
        if stamped.is_some() {
            reply.insert("rev".into(), json!(rev));
        }
        reply.insert("issues".into(), Value::Array(list[..shown].to_vec()));
        if shown < list.len() && self.scenario.planted != Some(Planted::CutsWithoutTruncated) {
            reply.insert("truncated".into(), truncated(&list, shown));
        }
        if let Some(sha) = issues_evidence {
            reply.insert("issues_evidence".into(), json!(sha));
        }
        reply.insert("snapshots".into(), json!([]));

        let error = list.iter().any(|i| i["severity"] == "error");
        let rows = self.revisions.entry(show.doc.clone()).or_default();
        let state = if error { "refused" } else { "current" };
        if !error {
            for r in rows.iter_mut().filter(|r| r.state == "current") {
                r.state = "superseded";
            }
        }
        if stamped.is_some() {
            rows.push(Row {
                rev,
                base_rev,
                writer: writer.clone(),
                hash,
                state,
                doc: stamped.clone().unwrap_or(Value::Null),
            });
        }
        if error {
            reply.insert("outcome".into(), json!("refused"));
            if show.check {
                reply.insert("result".into(), json!("FAIL"));
            }
            return Value::Object(reply);
        }
        if let Some(Diff {
            changed,
            unchanged,
            created,
            removed,
        }) = diff
        {
            reply.insert("changed".into(), json!(changed));
            reply.insert("unchanged".into(), json!(unchanged));
            reply.insert("created".into(), json!(created));
            reply.insert("removed".into(), json!(removed));
        }

        // Presentation: a hidden session is neither evaluated nor called back; a snapshot is
        // taken only once its frame has settled, or the reply says why not within 2 s.
        let wants_pixels = show.include.iter().any(|i| matches!(i, Include::Pixels));
        let mut snapshot_taken = !wants_pixels;
        if !panel.visible {
            reply.insert("outcome".into(), json!("not_presented"));
            reply.insert("reason".into(), json!("hidden"));
        } else if wants_pixels {
            let drawn = drawn.as_ref().expect("a revision with no error was drawn");
            match self.settle() {
                Err(()) => {
                    reply.insert("outcome".into(), json!("not_presented"));
                    reply.insert("reason".into(), json!("timeout"));
                }
                Ok(()) => {
                    let size = show.size.unwrap_or_else(|| {
                        let [w, h] = drawn.frame.size;
                        [
                            w.round().clamp(1.0, 8192.0) as u16,
                            h.round().clamp(1.0, 8192.0) as u16,
                        ]
                    });
                    let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
                    let rgba = self.renderer.raster(drawn, size, Some(ground));
                    let png = snapshot::png(rgba, size);
                    match evidence::put(&self.scenario.evidence, &png) {
                        Ok(sha) => {
                            reply.insert(
                                "snapshots".into(),
                                json!([{"sha256": sha, "w": size[0], "h": size[1]}]),
                            );
                            snapshot_taken = true;
                            reply.insert("outcome".into(), json!("presented"));
                        }
                        Err(_) => {
                            reply.insert("outcome".into(), json!("not_presented"));
                            reply.insert("reason".into(), json!("timeout"));
                        }
                    }
                }
            }
        } else {
            reply.insert("outcome".into(), json!("presented"));
        }
        if show.check {
            reply.insert("result".into(), json!(self.verdict(show, snapshot_taken)));
        }
        Value::Object(reply)
    }

    /// What keeps the frame from settling at `now`, a call admitted at `admitted`: a pipeline it
    /// would draw with a fallback, items in its rebuild queue, or an asset not decoded. On the CPU
    /// none of them is left once the draw list is prepared (its assets decoded with it); the fault
    /// fixture holds one of them.
    fn unsettled(&self, admitted: Instant, now: Instant) -> Option<Hold> {
        let fault = self.scenario.fault?;
        (now < admitted + Duration::from_millis(fault.ms)).then_some(fault.holds)
    }

    /// Waits, from admission, until the frame has settled or 2 s have passed.
    fn settle(&self) -> Result<(), ()> {
        let admitted = Instant::now();
        let deadline = admitted + SETTLE_TIMEOUT;
        loop {
            let now = Instant::now();
            if self.unsettled(admitted, now).is_none() {
                return Ok(());
            }
            if now >= deadline {
                return Err(());
            }
            std::thread::sleep(Duration::from_millis(1).min(deadline - now));
        }
    }

    /// `deep show --check`'s verdict on a revision that passed its checks: a document check
    /// passes a claim only when the claim's definition names the document among its deliverables,
    /// since a picture explains and never proves; a snapshot it asked for and couldn't take is
    /// BLOCKED.
    fn verdict(&self, show: &Show, snapshot_taken: bool) -> &'static str {
        if !snapshot_taken {
            return "BLOCKED";
        }
        match &show.claim {
            None => "PASS",
            Some(handle) => match self.scenario.claims.get(handle) {
                None => "INVALID",
                Some(claim) if claim.deliverables.contains(&show.doc) => "PASS",
                Some(_) => "INCONCLUSIVE",
            },
        }
    }
}

/// One layer on screen (Band), or the card.
pub struct BandRow {
    pub doc: Option<String>,
    pub band: Band,
    pub layer: String,
    pub owner: Writer,
    pub outline: bool,
    pub name: Option<String>,
}

impl BandRow {
    pub fn to_json(&self) -> Value {
        let owner = match self.band {
            Band::Card => json!({"kind": "shell"}),
            _ => self.owner.to_json(),
        };
        json!({
            "layer": self.layer,
            "owner": owner,
            "band": self.band.name(),
            "outline": self.outline,
            "name": self.name,
        })
    }
}
