//! The hub's canvas side for one scenario (issue #393): who a call writes as (the session a
//! deep_show call bound to, or the agent whose process tree a `deep show` runs in, by the peer
//! check), each document's revisions and its writer layer, the check before a revision becomes
//! current, render-back's snapshots of a settled frame, and the bands on screen.
//!
//! The scenario stands in for what the hub knows and this slice can't build: its bound sessions,
//! the OS process table, the documents it minted, the record's objects and who may read them,
//! claims and their deliverables, the window and the question card.
//!
//! Documents several writers share (issue #96) are in [`crate::shared`]: patches, undo, reads,
//! history, the by-writer lens, the record and the clock's latch.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::time::{Duration, Instant};

use deep_canvas::cost::Coefficients;
use deep_canvas::document::{canonical_in, check_costed, check_in, Issue};
use deep_canvas::grammar::{Time, TimeContext};
use deep_canvas::registry::{core_name, Sealed};
use deep_canvas::schedule::{
    Options, Planted as SchedulePlanted, Scheduler, Session as DocSession,
};
use deep_canvas::show::{
    inline_count, order_issues, stamp, truncated, unreadable_handles, whole_diff, Band, Diff,
    Scope, Writer, WriterKind,
};
use deep_canvas_marks::look::{self, Look};
use deep_canvas_marks::scene::Record;
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::frames::{op_issue, overflows, unfit_issue};
use crate::shared::{self, Clock, CommitFault, Quota, Shared};
use crate::snapshot::{self, Drawn, Renderer, Unfit};

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
    /// #96: a stale base rebases when no ID its ops target changed, parents and neighbors aside.
    RebaseCountsOpTargetsOnly,
    /// #96: a whole revision is diffed against every ID in the document.
    DiffsWholeDocument,
    /// #96: one check queue for every writer, in arrival order.
    OneFifoCheckQueue,
    /// #96: on restart, each layer is the newest layer file written for it.
    NewestLayerFileCurrent,
    /// #305: replies leave the module-set digest out.
    ReplyWithoutDigest,
    /// #305: the check reads a logic program's bytes before refusing the document.
    ReadsWasmBytes,
    /// #670: render-back adds noise to each snapshot, seeded from the clock.
    SeedsNoiseFromClock,
    /// #387: content keys leave out the view's locale.
    KeyWithoutLocale,
    /// #387: content keys leave out the view's reduced motion.
    KeyWithoutReducedMotion,
    /// #387: `test.scatter.draw`'s key hashes the values of `test.scatter.positions`.
    KeyHashesPositions,
    /// #138: content keys leave out an item's canonical params.
    KeyWithoutParams,
    /// #138: the core refuses some invalid patches with no code.
    RefusalWithoutCode,
    /// #138: a refused patch still changes the canonical bytes.
    RefusedPatchWrites,
    /// #138: a dry run returns before the incremental re-check.
    DryRunSkipsRecheck,
    /// #138: the undo of a reorder mints a new order key.
    UndoReorderMintsKey,
    /// #138: order keys are drawn when a patch applies, not from its base.
    ApplyTimeOrderKeys,
    /// #379: the check estimates with coefficients for the machine it runs on, not the
    /// reference Mac's.
    EstimatesOnThisMachine,
    /// #138: the incremental check after a patch skips the items that refer to what it touched.
    IncrementalCheckSkipsReferrers,
    /// #138: a stale patch rebases when no path it writes changed since its base.
    RebaseByPath,
    /// #138: `patch_fuzz` runs no sequence and exits 0.
    FuzzerRunsNone,
    /// #138: `clean_rebuild` runs half its declared sequences and exits 0.
    PartRunsHalf,
    /// #138: `schedule` exits 0 with a failed case in its results.
    ExitZeroWithFailedCase,
    /// #138: the kit counts a case's declared coverage as reached.
    CountsDeclaredAsReached,
    /// #138: the kit passes a snapshot case without comparing its pixels.
    SkipsSnapshotComparison,
    /// #138: a case passes when its expected codes are among those raised.
    ChecksExpectedCodeOnly,
    /// #138: a decision is taken from an agent as from you.
    AcceptsAgentDecisions,
    /// #138: the golden store reads every recorded digest as positive.
    EveryDigestPositive,
    /// #138: `compare_images` checks only the share of pixels off.
    ChecksShareOnly,
    /// #383: on a `view` document a scroll pans in time instead of zooming.
    LineScrollPans,
    /// #383: a drag commits on every move.
    CommitEveryMove,
    /// #383: a drag hit-tests on every move.
    PickMidGesture,
    /// #383: a drag's moves reach the presented frames only when it ends.
    DragShowsOnRelease,
    /// #383: a revision current at a latch is first drawn a frame after the vsync that latch begins.
    PatchShowsAFrameLate,
    /// #383: only `scene`, `world` and `figure` canvases get a full-screen button.
    FullScreenOnly3d,
    /// #383: Esc leaves full screen and goes back to the top at once.
    EscToRoot,
    /// #384: the ask box puts the quote into your words.
    BoxFoldsQuote,
    /// #384: the ask box sends no `t`.
    BoxDropsT,
    /// #384: the ask box sends no `doc_rev`.
    BoxDropsDocRev,
    /// #384: the ask box sends `precision: id` for every reference.
    BoxSendsEveryId,
    /// #384: the resolver answers a gone item's handle with `ref_unresolved` alone.
    ResolverOnlyRefUnresolved,
    /// #384: the resolver closes the ask-task of a message whose item is gone.
    ResolverClosesTask,
}

/// The build's sealed canvas-module set, registered and sealed once at startup (#305: Registry
/// and seal), with the wall time registration and the seal took.
pub struct Startup {
    pub sealed: Sealed,
    pub seal_ms: f64,
    /// #387: the planted scheduler that orders steps at one time by canvas-module name.
    pub steps_by_name: bool,
    /// A build with a test canvas module: every read every operator makes is logged.
    pub test_build: bool,
}

/// How many times this process registered and sealed: counted where it happens, so the
/// `registry` reply's `seal.runs` is a measurement, not the binary's word; 1 whatever frames ran.
pub static SEAL_RUNS: AtomicU32 = AtomicU32::new(0);

/// A revision's diff, its four lists, in the reply.
pub(crate) fn diff_reply(diff: Diff, reply: &mut Map<String, Value>) {
    reply.insert("changed".into(), json!(diff.changed));
    reply.insert("unchanged".into(), json!(diff.unchanged));
    reply.insert("created".into(), json!(diff.created));
    reply.insert("removed".into(), json!(diff.removed));
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
    /// A web page the panel shows, an agent's deliverable that holds no canvas items (#384).
    pub html: Option<PathBuf>,
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

/// What a patch call carries: a patch, or the undo of an earlier one.
pub enum Body {
    Patch(Value),
    Undo { patch: String, of: String },
}

pub struct PatchCall {
    pub via: Via,
    pub doc: String,
    pub body: Body,
}

pub enum Call {
    /// #379: the cost model's micro-benchmark.
    Costs,
    Show(Box<Show>),
    Patch(Box<PatchCall>),
    Read {
        doc: String,
        via: Option<Via>,
    },
    History {
        doc: String,
        item: String,
    },
    ByWriter(String),
    Revisions(String),
    /// The sealed set as the build holds it (#305).
    Registry,
    Screen,
    /// The sealed plan as published at `deep://schedule/<core version>` (#387).
    Schedule,
    /// Every canvas module's fixtures (#387).
    Fixtures,
    /// One frame of a document's session (#387).
    Eval(Box<Eval>),
    /// `count` frames of a session from `from`, `step` apart, with the scheduler's own costs.
    Frames {
        doc: String,
        count: usize,
        from: i64,
        step: i64,
    },
    /// Shows or hides a panel from this call on.
    Panel {
        panel: String,
        visible: bool,
    },
    /// An item's interned handle in the session's current revision.
    Intern {
        doc: String,
        id: String,
    },
    /// The item a handle names, or `stale_handle`.
    Resolve {
        doc: String,
        handle: Value,
    },
    /// A new batch of outside data for a document's source: `<source>.<column>` → f64 bytes.
    Batch {
        doc: String,
        source: String,
        columns: BTreeMap<String, Vec<u8>>,
    },
    /// The canvas conformance kit (#138).
    Kit(Box<crate::kit::KitCall>),
    /// Your input to a panel's canvas (#383).
    Input {
        panel: String,
        event: deep_canvas::scope::Event,
    },
    /// A panel's interaction scope, with no input (#383).
    Scope(String),
    /// The frames a panel presented up to now (#383).
    Presented(String),
    /// A panel's view drawn: its revision with the view's filters, isolation and lens (#383).
    View(String),
    /// Your words from a panel's ask box to a session, about what you point at (#384).
    Ask {
        panel: String,
        session: String,
        words: String,
        pointer: Option<[f64; 2]>,
    },
    /// A session's messages as its agent reads them (#384).
    Messages(String),
    /// A session's render-back of a document at a time as of a revision (#384).
    RenderBack {
        session: String,
        doc: String,
        t: i64,
        rev: u64,
        size: Option<[u16; 2]>,
    },
    /// The parity suite's manifest (#138).
    Manifest,
    /// The check catalog (#138).
    Catalog,
    /// A fixture's snapshot on a backend, judged against the golden store (#138).
    Golden {
        fixture: String,
        backend: String,
    },
    /// Records a fixture's snapshot in the golden store, untriaged, by whoever calls (#138).
    Record {
        via: Option<Via>,
        fixture: String,
        backend: String,
    },
    /// A fixture's golden digests (#138).
    Goldens {
        fixture: String,
    },
    /// One decision, taken only from you (#138).
    Decide {
        via: Option<Via>,
        decision: Value,
    },
    /// Records a corpus document as this build saves and draws it (#138).
    CorpusRecord {
        corpus: PathBuf,
        name: String,
        document: Value,
        times: Vec<i64>,
    },
    /// Two images judged under a tolerance (#138).
    CompareImages {
        expected: PathBuf,
        actual: PathBuf,
        tolerance: Value,
    },
}

/// One `eval` call (#387).
pub struct Eval {
    pub doc: String,
    pub t: i64,
    /// `locale` and `reduced_motion`, over the document's defaults.
    pub view: Map<String, Value>,
    pub clean: bool,
    pub perturb: Option<String>,
    pub pixels: bool,
    pub size: Option<[u16; 2]>,
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
    /// The display the window is on, px: full screen fills it (#383).
    pub display: Option<[f64; 2]>,
    /// The record's verdicts by ID, each as `verdict.made` writes it, its `key` naming the
    /// record states it read (#383: what a change to a selected value would make stale).
    pub verdicts: Map<String, Value>,
    pub card: Option<Card>,
    pub fault: Option<Fault>,
    pub planted: Option<Planted>,
    pub calls: Vec<Call>,
    /// Each call's arrival on the clock, in flicks (0 without one).
    pub at: Vec<i64>,
    /// The shared documents as a release stored them, by doc ID (#96).
    pub seeds: BTreeMap<String, Value>,
    /// The hub's state folder: layer files by hash and the record.
    pub state: Option<PathBuf>,
    /// Each session's quota (Writer connection).
    pub quotas: BTreeMap<String, Quota>,
    pub clock: Option<Clock>,
    pub commit_fault: Option<CommitFault>,
    /// Each document session's epoch counter starts here (#387: a long run without running it).
    pub epoch_start: u32,
    /// Ties break by a shuffle from this seed instead of by name and order (#387).
    pub shuffle: Option<u32>,
    /// The golden store; without it, the repo's committed store (#138).
    pub goldens: Option<PathBuf>,
    /// What every backend reports as its OS and driver for this run (#138).
    pub environment: Map<String, Value>,
    /// The commit this run renders at (#138); the checkout's HEAD without it.
    pub commit: Option<String>,
    /// The machine the hub runs on, its environment fingerprint (#379); this machine without it.
    pub machine: Option<Map<String, Value>>,
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
    pub startup: &'a Startup,
    pub revisions: BTreeMap<String, Vec<Row>>,
    pub shared: BTreeMap<String, Shared>,
    /// The clock's time, in flicks: a read shows what is current then.
    pub now: i64,
    /// When each writer's applied patches were checked, for its quota.
    pub applied_at: BTreeMap<String, Vec<i64>>,
    /// The shared documents each writer has written, for its quota.
    pub written: BTreeMap<String, std::collections::BTreeSet<String>>,
    pub look: Look,
    pub renderer: Renderer,
    /// The scheduler every document session shares, with its content-key cache (#387).
    pub sched: Scheduler<'a>,
    /// Each document's session.
    pub sessions: BTreeMap<String, DocSession>,
    /// Panels a `panel` call showed or hid.
    pub panels_shown: BTreeMap<String, bool>,
    /// The GPU 3D revisions draw on (#378): unopened until the first, `None` inside where there
    /// is none.
    pub gpu3: Option<Option<crate::scene3d::Gpu3>>,
    /// A 3D revision's snapshot drawn for the call being presented, with its size.
    pub pending3d: Option<Result<Raster, ()>>,
    /// Each panel's interaction scope (#383).
    pub scopes: BTreeMap<String, crate::input::PanelScope>,
    /// The input router's last serial.
    pub serial: u64,
    /// When each revision of a document that isn't shared became current, by doc ID.
    pub shown_at: BTreeMap<String, Vec<(i64, u64)>>,
    /// The messages each session was sent from an ask box, by session ID (#384).
    pub asks: BTreeMap<String, Vec<crate::ask::Asked>>,
}

/// A snapshot's straight RGBA and its size.
pub type Raster = (Vec<u8>, [u16; 2]);

/// The planted check's coefficients for `machine` (the hub's, or this one's): the reference
/// Mac's on a reference Mac, and scaled by its own speed anywhere else.
fn machine_factor(machine: Option<&Map<String, Value>>) -> f64 {
    let model = match machine.and_then(|m| m.get("model")).and_then(Value::as_str) {
        Some(m) => m.to_string(),
        None => std::process::Command::new("sysctl")
            .args(["-n", "hw.model"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default(),
    };
    if ["Mac15,7", "Mac15,12"].contains(&model.as_str()) {
        1.0
    } else {
        1.6
    }
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
    pub fn new(scenario: &'a Scenario, startup: &'a Startup) -> Self {
        let planted = SchedulePlanted {
            key_without_locale: scenario.planted == Some(Planted::KeyWithoutLocale),
            key_without_reduced_motion: scenario.planted == Some(Planted::KeyWithoutReducedMotion),
            key_hashes: (scenario.planted == Some(Planted::KeyHashesPositions))
                .then(|| "test.scatter.positions".to_string()),
            steps_by_name: startup.steps_by_name,
            key_without_params: scenario.planted == Some(Planted::KeyWithoutParams),
        };
        #[allow(unused_mut)]
        let mut sched = Scheduler::new(
            &startup.sealed,
            Options {
                access_log: startup.test_build,
                shuffle: scenario.shuffle,
                planted,
                timing: None,
            },
        );
        #[cfg(feature = "test-accent")]
        {
            sched.look_hook = Some(crate::planted::look_hook);
        }
        Hub {
            scenario,
            startup,
            revisions: BTreeMap::new(),
            shared: BTreeMap::new(),
            now: 0,
            applied_at: BTreeMap::new(),
            written: BTreeMap::new(),
            look: shipped_look(),
            renderer: Renderer::new(),
            sched,
            sessions: BTreeMap::new(),
            panels_shown: BTreeMap::new(),
            gpu3: None,
            pending3d: None,
            scopes: BTreeMap::new(),
            serial: 0,
            shown_at: BTreeMap::new(),
            asks: BTreeMap::new(),
        }
    }

    /// The GPU 3D revisions draw on, opened on first use.
    pub fn gpu3(&mut self) -> Option<&mut crate::scene3d::Gpu3> {
        self.gpu3
            .get_or_insert_with(crate::scene3d::Gpu3::open)
            .as_mut()
    }

    /// A revision holding 3D writer layers at `t`, at `size` or its own: its RGBA and size.
    pub(crate) fn draw3d(
        &mut self,
        doc: &Value,
        t: i64,
        size: Option<[u16; 2]>,
    ) -> Result<Raster, ()> {
        let size = size.unwrap_or_else(|| {
            let s = |i: usize| {
                doc["size"][i]
                    .as_f64()
                    .unwrap_or(1.0)
                    .round()
                    .clamp(1.0, 8192.0) as u16
            };
            [s(0), s(1)]
        });
        let palette = self.look.light.clone();
        let gpu = self.gpu3().ok_or(())?;
        gpu.draw(doc, t, &palette, size)
            .map(|(rgba, _)| (rgba, size))
            .map_err(|_| ())
    }

    /// Whether a panel is on screen: as the scenario set it, or as a `panel` call left it.
    pub fn panel_visible(&self, panel: &str) -> bool {
        match self.panels_shown.get(panel) {
            Some(v) => *v,
            None => self.scenario.panels.get(panel).is_some_and(|p| p.visible),
        }
    }

    /// Whether a document's panel is on screen.
    pub fn doc_visible(&self, doc: &str) -> bool {
        self.scenario
            .docs
            .get(doc)
            .is_some_and(|p| self.panel_visible(p))
    }

    /// The record's readings as the scheduler reads them, from outside the document.
    fn readings(&self) -> BTreeMap<String, Value> {
        self.scenario
            .record
            .iter()
            .map(|(h, o)| {
                let mut v = Map::new();
                if let Some(x) = o.value {
                    v.insert("value".into(), json!(x));
                }
                if let Some(a) = o.as_of {
                    v.insert("as_of".into(), json!(a));
                }
                if let Some(s) = &o.state {
                    v.insert("state".into(), json!(s));
                }
                (h.clone(), Value::Object(v))
            })
            .collect()
    }

    /// A new session for a document: its epochs from the scenario's start, the look's tokens
    /// and the record's readings.
    pub(crate) fn new_session(&self) -> DocSession {
        let mut s = DocSession::new(
            self.scenario.epoch_start,
            deep_canvas_marks::modules::tokens(&self.look.light),
        );
        s.set_readings(self.readings());
        s
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
    pub fn writer(&self, via: &Via) -> Option<(Writer, Option<&'a str>)> {
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
    pub fn can_read(&self, writer: &Writer, handle: &str) -> bool {
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
        let mut reply = match call {
            Call::Show(show) if self.shared.contains_key(&show.doc) => self.show_shared(show),
            Call::Show(show) => {
                let reply = self.show(show);
                let rev = self.current(&show.doc).map(|r| r.rev);
                let seen = self.shown_at.entry(show.doc.clone()).or_default();
                if let Some(rev) = rev.filter(|r| seen.last().is_none_or(|(_, l)| l != r)) {
                    seen.push((self.now, rev));
                }
                reply
            }
            Call::Patch(p) => self.patch(p, None, self.now),
            Call::Read { doc, via } => self.read(doc, via.as_ref()),
            Call::History { doc, item } => self.history(doc, item),
            Call::ByWriter(doc) => self.by_writer(doc),
            Call::Registry => self.registry_reply(),
            Call::Costs => crate::costs::measure(self.startup),
            Call::Fixtures => self.fixtures_reply(),
            Call::Schedule => self.startup.sealed.schedule(),
            Call::Eval(e) => self.eval(e),
            Call::Frames {
                doc,
                count,
                from,
                step,
            } => self.frames(doc, *count, *from, *step),
            Call::Panel { panel, visible } => {
                self.panels_shown.insert(panel.clone(), *visible);
                json!({"panel": panel, "visible": visible})
            }
            Call::Intern { doc, id } => self.intern(doc, id),
            Call::Resolve { doc, handle } => self.resolve(doc, handle),
            Call::Batch {
                doc,
                source,
                columns,
            } => self.batch(doc, source, columns),
            Call::Revisions(doc) if self.shared.contains_key(doc) => self.shared_revisions(doc),
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
            Call::Kit(k) => self.kit(k),
            Call::Input { panel, event } => self.input(panel, event),
            Call::Scope(panel) => self.scope_reply(panel),
            Call::Presented(panel) => self.presented(panel),
            Call::View(panel) => self.view(panel),
            Call::Ask {
                panel,
                session,
                words,
                pointer,
            } => self.ask(panel, session, words, *pointer),
            Call::Messages(session) => self.messages(session),
            Call::RenderBack {
                session,
                doc,
                t,
                rev,
                size,
            } => self.render_back(session, doc, *t, *rev, *size),
            Call::Manifest => self.manifest_reply(),
            Call::Catalog => self.catalog_reply(),
            Call::Golden { fixture, backend } => self.golden_reply(fixture, backend),
            Call::Record {
                via,
                fixture,
                backend,
            } => self.record_reply(via.as_ref(), fixture, backend),
            Call::Goldens { fixture } => self.goldens_reply(fixture),
            Call::Decide { via, decision } => self.decide(via.as_ref(), decision),
            Call::CorpusRecord {
                corpus,
                name,
                document,
                times,
            } => self.corpus_record(corpus, name, document, times),
            Call::CompareImages {
                expected,
                actual,
                tolerance,
            } => self.compare_images(expected, actual, tolerance),
        };
        self.stamp(&mut reply);
        reply
    }

    /// Every canvas reply carries the core's version and the module-set digest (#305;
    /// technical design: MCP tools); the planted twin leaves the digest out.
    pub fn stamp(&self, reply: &mut Value) {
        if let Value::Object(map) = reply {
            map.insert("core".into(), json!(core_name()));
            if self.scenario.planted != Some(Planted::ReplyWithoutDigest) {
                map.insert("set_digest".into(), json!(self.startup.sealed.set_digest));
            }
        }
    }

    /// Every layer on screen, back to front, and the card last.
    pub fn bands(&self) -> Vec<BandRow> {
        let mut rows = Vec::new();
        for (doc, panel) in &self.scenario.docs {
            let visible = self.panel_visible(panel);
            if let Some(k) = self.shown(doc).filter(|_| visible) {
                // A shared document: each writer's layer in its band.
                let (shown, _) = self.shared[doc].at(k);
                for (layer, entry) in shown["layers"].as_object().into_iter().flatten() {
                    let Some(owner) = entry["writer"].as_str().and_then(shared::writer_of_text)
                    else {
                        continue;
                    };
                    rows.push(BandRow {
                        doc: Some(doc.clone()),
                        band: owner.band(),
                        layer: layer.clone(),
                        outline: owner.outlined(),
                        name: self.agent_name(&owner),
                        owner,
                    });
                }
                continue;
            }
            let Some(row) = self.current(doc).filter(|_| visible) else {
                continue;
            };
            let name = self.agent_name(&row.writer);
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

    /// The name an agent's outline shows.
    pub fn agent_name(&self, writer: &Writer) -> Option<String> {
        match writer.kind {
            WriterKind::Agent => self
                .scenario
                .sessions
                .values()
                .find(|s| s.thread == writer.id)
                .map(|s| s.name.clone()),
            _ => None,
        }
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
                if self.scenario.planted == Some(Planted::ReadsWasmBytes) {
                    read_programs(&doc, &self.scenario.evidence);
                }
                let mut issues = match self.scenario.planted {
                    Some(Planted::EstimatesOnThisMachine) => {
                        let coefficients = Coefficients::reference()
                            .scaled(machine_factor(self.scenario.machine.as_ref()));
                        check_costed(&doc, &self.startup.sealed, &coefficients).issues
                    }
                    _ => check_in(&doc, &self.startup.sealed).issues,
                };
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
        // A number past f64's range is refused at its path (#387).
        if let Some(doc) = &stamped {
            issues.extend(overflows(doc));
        }
        // The revision's check phases and, for a session on screen, its frame at `t`, run clean
        // before it becomes current: what an operator can't evaluate is an issue of the revision
        // too, naming the operator's module (#387). A read an operator didn't declare is the
        // module's fault, not the document's, so it fails the frame and refuses nothing.
        let visible = self.doc_visible(&show.doc);
        if let Some(doc) = stamped
            .as_ref()
            .filter(|_| !issues.iter().any(|i| i.severity == "error"))
        {
            let (op_issues, drawing) = self.probe(doc, show.t, visible, None);
            for i in op_issues.iter().filter(|i| i.code != "undeclared_read") {
                issues.push(op_issue(i));
            }
            if let Some(drawing) = drawing.filter(|_| op_issues.is_empty()) {
                if let Err(Unfit { code, path }) = self
                    .renderer
                    .prepare_drawing(&drawing, &self.scenario.evidence)
                {
                    issues.push(unfit_issue(code, path));
                }
            }
        }
        let hash = stamped
            .as_ref()
            .and_then(|d| canonical_in(d, &self.startup.sealed.kinds()).ok())
            .map(|c| c.sha256)
            .unwrap_or_default();

        let mut reply = Map::new();
        // A payload refused before it could be stamped makes no revision.
        if stamped.is_some() {
            reply.insert("rev".into(), json!(rev));
        }
        let error = self.issue_reply(&issues, &mut reply);
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
                // A check that needs a canvas module the build lacks is BLOCKED, never a FAIL
                // (technical design: Canvas modules; #305).
                let blocked = issues.iter().any(|i| i.code == "module_missing");
                reply.insert(
                    "result".into(),
                    json!(if blocked { "BLOCKED" } else { "FAIL" }),
                );
            }
            return Value::Object(reply);
        }
        if let Some(diff) = diff {
            diff_reply(diff, &mut reply);
        }
        let _ = panel;
        // The checked revision becomes the session's current one; a snapshot is the session's
        // own frame at `t`.
        let doc = stamped.unwrap_or(Value::Null);
        if !self.sessions.contains_key(&show.doc) {
            let fresh = self.new_session();
            self.sessions.insert(show.doc.clone(), fresh);
        }
        if let Some(session) = self.sessions.get_mut(&show.doc) {
            session.load(&mut self.sched, &doc);
        }
        let wants_pixels = show.include.iter().any(|i| matches!(i, Include::Pixels));
        // A revision with 3D writer layers renders back on the GPU (#378).
        let three = visible && wants_pixels && deep_canvas_scene3d::scene::has_3d(&doc);
        let drawn = if visible && wants_pixels && !three {
            self.live_drawn(&show.doc, show.t)
        } else {
            None
        };
        if three {
            self.pending3d = Some(self.draw3d(&doc, show.t, show.size));
        }
        self.present(show, visible, drawn.as_ref(), reply)
    }

    /// Every issue the checks raised, kept as evidence; the reply inlines them up to the read
    /// cap, with an empty list of snapshots. True when one is an error.
    pub fn issue_reply(&self, issues: &[Issue], reply: &mut Map<String, Value>) -> bool {
        let mut list: Vec<Value> = issues.iter().map(Issue::to_json).collect();
        order_issues(&mut list);
        let full = serde_json::to_vec(&list).expect("issues serialize");
        let issues_evidence = evidence::put(&self.scenario.evidence, &full).ok();
        let shown = match self.scenario.planted {
            Some(Planted::InlinesEveryIssue) => list.len(),
            _ => inline_count(&list),
        };
        reply.insert("issues".into(), Value::Array(list[..shown].to_vec()));
        if shown < list.len() && self.scenario.planted != Some(Planted::CutsWithoutTruncated) {
            reply.insert("truncated".into(), truncated(&list, shown));
        }
        if let Some(sha) = issues_evidence {
            reply.insert("issues_evidence".into(), json!(sha));
        }
        reply.insert("snapshots".into(), json!([]));
        list.iter().any(|i| i["severity"] == "error")
    }

    /// A revision that passed its checks, presented: a hidden session is neither evaluated nor
    /// called back; a snapshot is taken only once its frame has settled, or the reply says why
    /// not within 2 s.
    pub fn present(
        &mut self,
        show: &Show,
        visible: bool,
        drawn: Option<&Drawn>,
        mut reply: Map<String, Value>,
    ) -> Value {
        let wants_pixels = show.include.iter().any(|i| matches!(i, Include::Pixels));
        let mut snapshot_taken = !wants_pixels;
        let drawn3d = self.pending3d.take();
        let three = drawn3d.is_some();
        if !visible {
            reply.insert("outcome".into(), json!("not_presented"));
            reply.insert("reason".into(), json!("hidden"));
        } else if wants_pixels {
            match self.settle() {
                Err(()) => {
                    reply.insert("outcome".into(), json!("not_presented"));
                    reply.insert("reason".into(), json!("timeout"));
                }
                Ok(()) => {
                    let pixels = match drawn3d {
                        Some(drawn3d) => drawn3d.ok(),
                        None => {
                            let drawn = drawn.expect("a revision with no error was drawn");
                            let size = show.size.unwrap_or_else(|| {
                                let [w, h] = drawn.frame.size;
                                [
                                    w.round().clamp(1.0, 8192.0) as u16,
                                    h.round().clamp(1.0, 8192.0) as u16,
                                ]
                            });
                            let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
                            Some((self.renderer.raster(drawn, size, Some(ground)), size))
                        }
                    };
                    let Some((mut rgba, size)) = pixels else {
                        reply.insert("outcome".into(), json!("not_presented"));
                        reply.insert("reason".into(), json!("timeout"));
                        if show.check {
                            reply.insert("result".into(), json!(self.verdict(show, false)));
                        }
                        return Value::Object(reply);
                    };
                    if self.scenario.planted == Some(Planted::SeedsNoiseFromClock) {
                        clock_noise(&mut rgba);
                    }
                    let png = snapshot::png(rgba, size);
                    match evidence::put(&self.scenario.evidence, &png) {
                        Ok(sha) => {
                            // A 3D frame's status marks are scene3d's; a 2D one's carry
                            // their text snapshot (The status-color rule).
                            let entry = match drawn.filter(|_| !three) {
                                Some(d) => snapshot::entry(&sha, d, size),
                                None => json!({"sha256": sha, "w": size[0], "h": size[1]}),
                            };
                            reply.insert("snapshots".into(), json!([entry]));
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

    /// The session a writer acts for: the MCP call's, or the agent's whose tree a CLI call ran in.
    pub fn session_of(&self, via: &Via, writer: &Writer) -> Option<String> {
        match via {
            Via::Mcp(s) => s.clone(),
            Via::Cli(..) => self
                .scenario
                .sessions
                .iter()
                .find(|(_, s)| writer.kind == WriterKind::Agent && s.thread == writer.id)
                .map(|(id, _)| id.clone()),
        }
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

/// The planted renderer's grain: a few pixels' red nudged by a xorshift seeded from the clock's
/// nanoseconds, what an honest render-back never reads (Channel and key: it can never read the
/// clock), so two runs draw two pictures (#670).
fn clock_noise(rgba: &mut [u8]) {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let mut x = nanos | 1;
    let pixels = (rgba.len() / 4) as u64;
    for _ in 0..64 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let i = (x % pixels) as usize * 4;
        rgba[i] = rgba[i].wrapping_add((x >> 56) as u8 | 1);
    }
}

/// The planted check that opens a logic program's bytes from the evidence store by its hash
/// before the document is refused: what the honest check never does (#305).
fn read_programs(doc: &Value, evidence: &std::path::Path) {
    let Some(items) = doc.get("items").and_then(Value::as_object) else {
        return;
    };
    for item in items.values() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let program = item
            .get("params")
            .and_then(|p| p.get("program"))
            .and_then(Value::as_str);
        if let (true, Some(sha)) = (kind.starts_with("logic@"), program) {
            if sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) {
                let _ = std::fs::read(evidence.join(&sha[..2]).join(&sha[2..]));
            }
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
