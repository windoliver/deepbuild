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

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_canvas::document::{
    canonical_in, check_costed, check_packed, Expansion, Issue, Notice, PackPlanted, Packs,
};
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
use crate::placement::{self, Placement};
use crate::shared::{self, Clock, CommitFault, Quota, Shared};
use crate::snapshot::{self, Drawn, Renderer, Unfit};
use crate::workers::{Priority, Workers};

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
    /// #371: show-time admission refuses a revision for any error it has, carried or not.
    CountsEveryIssue,
    /// #371: an issue counts as carried when the last good revision had one with its code.
    MatchesCarriedByCode,
    /// #371: the check returns its issues without `actual`.
    IssuesWithoutActual,
    /// #371: a kind with `deprecated_since` loads with no `deprecated` notice.
    LoadsDeprecatedSilently,
    /// #376: the accessibility tree announces every readout on every frame, changed or not.
    AnnouncesEveryFrame,
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
    /// #403: a verdict's key names each deliverable by doc ID alone, with no revision.
    VerdictKeyedByDoc,
    /// #403: checks in a claim skip an `unknown_kind` item and judge the rest.
    ChecksSkipUnknownKind,
    /// #403: a check kind no module in the build registers is INCONCLUSIVE.
    MissingKindInconclusive,
    /// #306: a derived item's seed comes from a counter over expansion order.
    SeedsByExpansionOrder,
    /// #306: a change of inputs re-expands the broken-out item too, over the writer's own.
    ReexpansionOverwritesBrokenOut,
    /// #306: the pack check never reads `requires.modules`.
    PackCheckSkipsRequiresModules,
    /// #306: the store and a document's `packs` are keyed by the name half alone.
    PacksKeyedByName,
    /// #488: a seek restores the checkpoint nearest to t by distance, not the last at or before.
    CheckpointNearestInDistance,
    /// #857: results of nodes run on several threads merge in the order they finished.
    MergesInFinishOrder,
    /// #854: a session's frame runs every node of its frame phases, changed or not.
    RunsEveryNode,
    /// #854: deep_query answers a paged read with every row, unpaged.
    Unpaged,
    /// #896: the session takes each patch's revision by loading the whole document.
    ReloadsRevision,
    /// #896: `marks2d.frame` rebuilds the whole draw list on every frame.
    RebuildsDrawList,
    /// #896: the bench view uploads every mark on every frame.
    RepaintsEveryMark,
    /// #857: the background jobs' threads run at the live view's priority.
    BackgroundAtLivePriority,
    /// #488: the sample-rate rule accepts every rate from 8 to 192 kHz.
    AcceptsEverySampleRate8To192k,
    /// #411: `items/<id>/modifiers/<k>#out` reads the stack's final result for every k.
    PrefixReadsFinal,
    /// #411: a why names its canvas module and operator and no document field or default.
    WhyNamesOperatorOnly,
    /// #411: a why lists only the first write to its value.
    WhyNamesKeyOnly,
    /// #411: deep_query's cut keeps the first rows by ID, parents or not.
    CutsByRowOrder,
    /// #488: `rate`'s index forms t × p in i64.
    FrameIndexI64Product,
    /// #488: `rate`'s index divides truncating toward 0.
    FrameIndexTruncatingDivision,
    /// #401: the panel host lets a script's fetch reach the network and its program run.
    PanelPolicyOpen,
    /// #401: plug-in toasts keep showing while the question card does.
    ToastsIgnoreCard,
    /// #401: a script's focus, pop-out and clipboard write go through with no serial.
    ScriptOpsNeedNoSerial,
    /// #401: a placement verb or a suggestion moves any piece, yours too.
    PlacementMovesYours,
    /// #401: after a failed call the source serves its cached answer with the call's time as its as-of.
    RefreshRestampsCached,
    /// #401: a panel's words reach the session with no serial.
    SendsWithoutSerial,
    /// #401: a fresh serial lets every send through until it expires.
    SerialCarriesManySends,
    /// #401: a frame shows the readings of the latch a frame before its own.
    BoundValueAFrameLate,
    /// #401: install takes any keymap as it is.
    KeymapUnchecked,
    /// #401: two bindings of one chord in one context install with no conflict reported.
    ConflictsUnreported,
    /// #401: every key, the escape chord too, goes to the focused panel alone.
    FocusedPanelTakesEscape,
    /// #402: the terminal applies at most 30 updates a second, merging the rest.
    Terminal30PerSecond,
    /// #402: the cell grid draws each patch a frame after the frame it should.
    CellsAFrameLate,
    /// #402: a video stream shows the frames a pause queued when its panel resumes.
    VideoShowsLate,
    /// #402: a video stream drops frames and its counter stays 0.
    VideoDropsUncounted,
    /// #402: the terminal tab draws the terminal's text as text items, outside the cell grid.
    TabDrawsText,
    /// #402: the terminal tab redraws at most 30 times a second.
    TabRedrawsAt30hz,
    /// #402: a terminal tab for a terminal the hub doesn't host draws its captured screen.
    TabDrawsCapture,
    /// #105: the capture gate takes any press of the chord, synthetic ones too, as the hold.
    RecordsWithoutHold,
    /// #105: the recorder ignores `max` and keeps frames for as long as the chord is held.
    RecordsPastMax,
    /// #105: a saved bug capture is attached to its ask with no check drafted.
    DraftsNoCheck,
    /// #105: each frame, as it arrives, is appended to the record holding its bytes in base64.
    FramesToRecord,
    /// #105: the frames so far are stored as an asset by hash each time a frame arrives.
    KeepsAssetAfterCrash,
    /// #105: the saved capture is labelled redaction `complete`.
    LabelsRedactionComplete,
    /// #105: a send delivers its files at once, unasked.
    SendsWithoutApproval,
}

/// The build's sealed canvas-module set, registered and sealed once at startup (#305: Registry
/// and seal), with the wall time registration and the seal took.
pub struct Startup {
    pub sealed: Sealed,
    pub seal_ms: f64,
    /// #387: the planted scheduler that orders steps at one time by canvas-module name.
    pub steps_by_name: bool,
    /// #855: the planted seal let a frame-phase JSON writer in, so its values run and count.
    pub admits_frame_json: bool,
    /// A build with a test canvas module: every read every operator makes is logged.
    pub test_build: bool,
    /// #856: the planted hub that shapes a revision's long text on the UI thread at its latch.
    pub shapes_on_ui_thread: bool,
    /// #856: the planted shaped-run cache per document.
    pub run_per_document: bool,
    /// #140: the planted network backend the network seam's suite runs instead of the correct one.
    pub network: Option<crate::seams::NetFault>,
    /// #140: the planted card that treats unknown occlusion as unobscured.
    pub ignores_unknown_occlusion: bool,
}

/// How many times this process registered and sealed: counted where it happens, so the
/// `registry` reply's `seal.runs` is a measurement, not the binary's word; 1 whatever frames ran.
pub static SEAL_RUNS: AtomicU32 = AtomicU32::new(0);

/// How many times this process ran the seal's interface checks (#185), counted as `SEAL_RUNS`.
pub static INTERFACE_RUNS: AtomicU32 = AtomicU32::new(0);

/// A revision's diff, its four lists, in the reply.
pub(crate) fn diff_reply(diff: Diff, reply: &mut Map<String, Value>) {
    reply.insert("changed".into(), json!(diff.changed));
    reply.insert("unchanged".into(), json!(diff.unchanged));
    reply.insert("created".into(), json!(diff.created));
    reply.insert("removed".into(), json!(diff.removed));
}

/// A refused revision's reply. A check that needs a canvas module or a pack version the build
/// lacks, or that an unknown item kind blocks (#403), is BLOCKED, never a FAIL (technical
/// design: Canvas modules; #305; #306).
pub(crate) fn refused_reply(mut reply: Map<String, Value>, issues: &[Issue], check: bool) -> Value {
    reply.insert("outcome".into(), json!("refused"));
    if check {
        let blocked = crate::packs::blocked(issues) || reply.contains_key("blocked");
        reply.insert(
            "result".into(),
            json!(if blocked { "BLOCKED" } else { "FAIL" }),
        );
    }
    Value::Object(reply)
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
    /// #402: where a session runs in a terminal the hub doesn't host, and the captured screen
    /// of it the page must never draw; both `None` for a hosted one or none.
    pub runs_in: Option<String>,
    pub capture: Option<Vec<String>>,
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
    /// The locked definition's requirements, each one check input (#403).
    pub requirements: Vec<Requirement>,
}

/// One requirement of a claim's definition: its handle and its check input.
pub struct Requirement {
    pub id: String,
    pub check: Value,
}

pub struct Card {
    pub question: String,
    pub options: Vec<String>,
    pub slot: Slot,
}

/// Where the card draws: the slot its view reserved (#393), or, with `displays`, where the
/// shell places the card of `ask`, measured `size` points, created at `at` (#400).
pub enum Slot {
    Reserved([f64; 4]),
    Placed {
        ask: String,
        size: [f64; 2],
        at: i64,
    },
}

/// Who a call came from: an MCP call and the session it bound to, or a `deep` command and its
/// peer process (pid, start time).
#[derive(Clone)]
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

/// A `frames` call: `count` frames of a session, `step` apart from `from`; with `paced`, on the
/// wall clock a step apart; with `revise`, a whole revision arriving at a frame's latch; with
/// `pixels`, each frame's pixel hash (#387, #856).
pub struct Frames {
    pub doc: String,
    pub count: usize,
    pub from: i64,
    pub step: i64,
    pub paced: bool,
    pub revise: Option<(usize, Value)>,
    pub pixels: bool,
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
    /// #411: deep_query, and deep.canvas.read for a check plug-in.
    SceneQuery(Box<crate::query::Query>),
    /// #411: a deep_show or deep show call in a diagnostic mode.
    Mode(Box<Show>, String),
    /// #379: the cost model's micro-benchmark.
    Costs,
    /// #140: the network seam's conformance suite.
    NetworkSuite {
        messages: u64,
        seed: u64,
    },
    /// #855: rekeys the process's content keys under a hash, once.
    Migrate(deep_canvas::schedule::HashVersion),
    /// #855: computes every content key of a session's revision afresh, `runs` times, timed.
    Keys {
        doc: String,
        runs: usize,
    },
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
    /// #306: the pack store's rows.
    Packs,
    /// #306: one pack version installed mid-run.
    InstallPack {
        id: String,
        dir: PathBuf,
    },
    Screen,
    /// The sealed plan as published at `deep://schedule/<core version>` (#387).
    Schedule,
    /// Every canvas module's fixtures (#387).
    Fixtures,
    /// One frame of a document's session (#387).
    Eval(Box<Eval>),
    /// The valid-rates rule for one rate, with no document (#488).
    Rate(crate::time::RateCall),
    /// A time literal resolved against a document's current revision (#488).
    Time {
        doc: String,
        text: String,
    },
    /// An export of a document's current revision planned at its rates (#488).
    Export(crate::time::Export),
    /// A document's session played on a virtual display to `to` (#488).
    Play {
        doc: String,
        display_hz: u32,
        to: i64,
    },
    /// Seeking against playing, on canonical renders (#488).
    Determinism(crate::time::Determinism),
    /// `count` frames of a session from `from`, `step` apart, with the scheduler's own costs.
    Frames(Box<Frames>),
    /// #856: the shaped-run cache's runs of a text, the times each was shaped and who draws it.
    ShapedRuns(String),
    /// #854: patches to a shared document, each timed from its arrival to the settled frame.
    Settle(Box<crate::efficiency::Settle>),
    /// #854: deep_query's summary or one page of a document's rows.
    Query(crate::efficiency::Query),
    /// The replica's `see`: a panel's accessibility tree as data and every announcement it made (#376).
    See(String),
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
    /// Your pop-out of a panel's view onto a display, with your input's serial (#400).
    PopOut {
        panel: String,
        display: String,
        serial: Option<u64>,
        full_screen: bool,
        /// The call carries a session: an agent asking.
        agent: bool,
    },
    /// The window server's report of your drag of a window (#400).
    MoveWindow {
        window: String,
        rect: [f64; 4],
        agent: bool,
    },
    /// The window server's report of the key window, `None` for another app's (#400).
    Activate {
        window: Option<String>,
        agent: bool,
    },
    /// The platform's report that a window is, or is no longer, frontmost (#140).
    Frontmost {
        window: String,
        front: bool,
        agent: bool,
    },
    /// A window of another app the test window backend stacks above the app's (#140); with no
    /// occlusion report the backend never tells the card about it.
    TestWindow,
    /// The window and input backends' capability table (#140).
    WindowCaps,
    /// The OS's report of the thermal state: whether the Mac is hot (#400).
    Thermal {
        hot: bool,
        agent: bool,
    },
    /// The window server's report that you hid a window or showed it again (#400).
    HideWindow {
        window: String,
        hidden: bool,
        agent: bool,
    },
    /// Every open window (#400).
    Windows,
    /// The layout as the app would save it now (#400).
    Layout,
    /// The question card as it stands now (#400).
    CardState,
    /// A press on the card's option, stamped by its platform at `t` and delivered now (#327).
    Press {
        t: i64,
        phase: PressPhase,
        option: String,
    },
    /// One of the card's `rearm_on` changes, now (#327).
    Rearm(String),
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
    /// Judges a claim on its deliverables' current revisions and records the verdict (#403).
    Verdict(String),
    /// Every verdict made on a claim, `stale` as of now (#403).
    Verdicts(String),
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
    /// The trusted ring's calls (#401).
    Ring(Box<crate::ring::RingCall>),
    /// Terminals, streams and the session page's terminal tab (#402).
    Term(Box<crate::terminal::TermCall>),
    /// A capture for a bug report, its ask and its send (#105).
    Capture(Box<crate::capture::CaptureCall>),
}

/// `eval`'s `t` (#488): a flick count, or a time literal resolved against the document's frame
/// rate and markers, never a fixed 60/1.
#[derive(Clone, Debug)]
pub enum EvalTime {
    Flicks(i64),
    Literal(String),
}

/// One `eval` call (#387).
pub struct Eval {
    pub doc: String,
    pub t: EvalTime,
    /// `locale` and `reduced_motion`, over the document's defaults.
    pub view: Map<String, Value>,
    pub clean: bool,
    pub perturb: Option<String>,
    pub pixels: bool,
    pub size: Option<[u16; 2]>,
    /// #855: each node's Debug text digest beside its result, a diagnostic only.
    pub debug_text: bool,
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
    /// The displays connected, the first the main display (#400); empty without them.
    pub displays: Vec<placement::Display>,
    /// A layout an earlier run saved, which the app reopens from (#400).
    pub layout: Option<placement::Layout>,
    /// #400's wrong programs.
    pub placement_planted: placement::Planted,
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
    /// The hub ends at this time as SIGKILL would (#105).
    pub kill_at: Option<i64>,
    /// Each document session's epoch counter starts here (#387: a long run without running it).
    pub epoch_start: u32,
    /// Ties break by a shuffle from this seed instead of by name and order (#387).
    pub shuffle: Option<u32>,
    /// The hash the process keys with until a `migrate` call (#855).
    pub hash: deep_canvas::schedule::HashVersion,
    /// The golden store; without it, the repo's committed store (#138).
    pub goldens: Option<PathBuf>,
    /// What every backend reports as its OS and driver for this run (#138).
    pub environment: Map<String, Value>,
    /// The commit this run renders at (#138); the checkout's HEAD without it.
    pub commit: Option<String>,
    /// The machine the hub runs on, its environment fingerprint (#379); this machine without it.
    pub machine: Option<Map<String, Value>>,
    /// The packs installed in the store before the first call (#306), each `(owner/name, dir)`.
    pub packs: Vec<(String, PathBuf)>,
    /// Every session's pool in place of its budget class's (#857).
    pub threads: Option<usize>,
    /// Work that isn't a frame, running from before the first call to after the last (#857).
    pub background: Vec<Job>,
}

/// A background job (#857): a playtest batch's replicas of a document's session, or a bake of
/// one, each evaluated frame after frame at the background priority.
pub struct Job {
    pub kind: &'static str,
    pub replicas: usize,
    pub document: Value,
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
    /// The scenario's background jobs' progress (#857).
    pub background: Vec<crate::jobs::Progress>,
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
    /// The plug-ins' panels in the trusted ring (#401).
    pub ring: crate::ring::Ring,
    /// When each revision of a document that isn't shared became current, by doc ID.
    pub shown_at: BTreeMap<String, Vec<(i64, u64)>>,
    /// The messages each session was sent from an ask box, by session ID (#384).
    pub asks: BTreeMap<String, Vec<crate::ask::Asked>>,
    /// The verdicts made on each claim, in the order made, each as recorded (#403).
    pub verdicts_made: BTreeMap<String, Vec<Value>>,
    /// The pack store (#306): the versions admitted, and one row per offer.
    pub packs: Packs,
    pub pack_rows: Vec<crate::packs::Row>,
    /// Each document's expansions at its last check, for the replies that carry them.
    pub expansions: BTreeMap<String, Vec<Expansion>>,
    /// The displays, the windows on them and the card's placement (#400).
    pub placement: Placement,
    /// Terminals, streams and session pages (#402).
    pub terms: crate::terminal::Terms,
    /// Captures for bug reports, their asks and sends (#105).
    pub capturing: crate::capture::Capturing,
    /// The card's `rearm_on` changes the scenario reported, each when (#327).
    pub card_rearms: Vec<i64>,
    /// A press down the card holds until its release: its platform stamp and its option (#327).
    pub card_down: Option<(i64, String)>,
    /// Who sent each document's last whole revision: a revision that arrives at a frame's latch
    /// comes from them (#856).
    pub vias: BTreeMap<String, Via>,
    /// The times the shaper shaped each run's key in this process (#856).
    pub shapings: HashMap<Arc<deep_text::cache::Key>, u32>,
    /// What answered the card: the option and the release's platform stamp (#327).
    pub card_answer: Option<(String, i64)>,
}

/// A snapshot's straight RGBA, its size and each item's box in its pixels.
pub type Raster = (Vec<u8>, [u16; 2], Vec<(String, [f64; 4])>);

/// Which half of a press, or a key repeat (#327).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PressPhase {
    Down,
    Up,
    Repeat,
}

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

/// The scheduler's options for a scenario: its planted twins and its shuffle.
fn schedule_options(scenario: &Scenario, startup: &Startup) -> Options {
    let planted = SchedulePlanted {
        key_without_locale: scenario.planted == Some(Planted::KeyWithoutLocale),
        key_without_reduced_motion: scenario.planted == Some(Planted::KeyWithoutReducedMotion),
        key_hashes: (scenario.planted == Some(Planted::KeyHashesPositions))
            .then(|| "test.scatter.positions".to_string()),
        steps_by_name: startup.steps_by_name,
        key_without_params: scenario.planted == Some(Planted::KeyWithoutParams),
        checkpoint_nearest: scenario.planted == Some(Planted::CheckpointNearestInDistance),
        merge_by_finish: scenario.planted == Some(Planted::MergesInFinishOrder),
        admits_frame_json: startup.admits_frame_json,
        runs_every_node: scenario.planted == Some(Planted::RunsEveryNode),
        forgets_changes: scenario.planted == Some(Planted::RebuildsDrawList),
    };
    Options {
        access_log: startup.test_build,
        shuffle: scenario.shuffle,
        planted,
        timing: None,
        pool: Some(Arc::new(Workers::at(Priority::Frame))),
        threads: scenario.threads,
        hash: scenario.hash,
    }
}

impl<'a> Hub<'a> {
    pub fn new(scenario: &'a Scenario, startup: &'a Startup) -> Self {
        #[allow(unused_mut)]
        let mut sched = Scheduler::new(&startup.sealed, schedule_options(scenario, startup));
        #[cfg(feature = "test-accent")]
        {
            sched.look_hook = Some(crate::planted::look_hook);
        }
        let pack_planted = PackPlanted {
            seed_by_order: scenario.planted == Some(Planted::SeedsByExpansionOrder),
            overwrite_broken_out: scenario.planted == Some(Planted::ReexpansionOverwritesBrokenOut),
            skip_requires_modules: scenario.planted == Some(Planted::PackCheckSkipsRequiresModules),
            key_by_name: scenario.planted == Some(Planted::PacksKeyedByName),
        };
        let mut hub = Hub {
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
            background: Vec::new(),
            panels_shown: BTreeMap::new(),
            gpu3: None,
            pending3d: None,
            scopes: BTreeMap::new(),
            serial: 0,
            ring: crate::ring::Ring::new(
                scenario.panels.iter().map(|(id, p)| (id.clone(), p.rect)),
            ),
            shown_at: BTreeMap::new(),
            asks: BTreeMap::new(),
            verdicts_made: BTreeMap::new(),
            packs: Packs::new(pack_planted),
            pack_rows: Vec::new(),
            expansions: BTreeMap::new(),
            placement: Placement::open(
                scenario.displays.clone(),
                scenario.window,
                scenario.layout.as_ref(),
                crate::placement::Planted {
                    ignores_unknown_occlusion: startup.ignores_unknown_occlusion,
                    ..scenario.placement_planted
                },
            ),
            terms: crate::terminal::Terms::default(),
            capturing: crate::capture::Capturing::restore(
                scenario.state.as_deref(),
                scenario.planted,
            ),
            card_rearms: Vec::new(),
            card_down: None,
            card_answer: None,
            vias: BTreeMap::new(),
            shapings: HashMap::new(),
        };
        deep_text::cache::record();
        // The store's packs, each checked once here and never on a document's open.
        for (id, dir) in &scenario.packs {
            hub.install_pack(id, dir);
        }
        hub
    }

    /// The card's slot to draw: the one its view reserved, or where the shell placed it (#400),
    /// once presented.
    pub fn card_slot(&self) -> Option<(String, Vec<String>, [f64; 4])> {
        let c = self.scenario.card.as_ref()?;
        let rect = match &c.slot {
            Slot::Reserved(r) => *r,
            // Placed in global points; the headless window draws the main window alone, in its
            // px, so a card in a popped window draws off its picture.
            Slot::Placed { .. } => {
                let card = self.card_json().filter(|c| !c.states.is_empty())?;
                let main = self.placement.main_window()?.rect;
                let r = card.rect;
                [r[0] - main[0], r[1] - main[1], r[2], r[3]]
            }
        };
        Some((c.question.clone(), c.options.clone(), rect))
    }

    /// `card`: the question card as it stands now, or `None` before its ask (#400).
    pub fn card_json(&self) -> Option<placement::CardState> {
        self.card_at(self.now)
    }

    /// The card as it stood at `t`, with the `rearm_on` changes reported and the answer (#327).
    fn card_at(&self, t: i64) -> Option<placement::CardState> {
        match &self.scenario.card.as_ref()?.slot {
            Slot::Reserved(_) => None,
            Slot::Placed { ask, size, at } => self.placement.card_with(
                ask,
                *at,
                *size,
                &self.card_rearms,
                self.card_answer.as_ref().map(|(o, at)| (o.as_str(), *at)),
                t,
            ),
        }
    }

    /// `press` (#327): a press on the card's option, judged by its own platform stamp `t` against the
    /// card's states then, never by its delivery: a down counts on an armed option, and the release
    /// answers only if the card stayed armed since that down; a repeat never counts. The planted
    /// `arms_from_delivery` judges by delivery instead.
    fn press(&mut self, t: i64, phase: PressPhase, option: &str) -> Value {
        let judged_at = if self.placement.planted().arms_from_delivery {
            self.now
        } else {
            t
        };
        let Some(card) = self.card_at(judged_at) else {
            return json!({"outcome": "ignored"});
        };
        if card.answer.is_some() {
            return json!({"outcome": "ignored"});
        }
        // When the card last armed, if it is armed at `judged_at`.
        let armed_since = card
            .states
            .last()
            .filter(|(state, _)| *state == "armed")
            .map(|(_, at)| *at);
        let outcome = match phase {
            PressPhase::Repeat => "ignored",
            PressPhase::Down => match armed_since {
                Some(_) => {
                    self.card_down = Some((judged_at, option.to_string()));
                    "ignored"
                }
                None => "refused",
            },
            PressPhase::Up => match (self.card_down.take(), armed_since) {
                (Some((down_at, down_option)), Some(since))
                    if down_option == option && since <= down_at =>
                {
                    self.card_answer = Some((option.to_string(), judged_at));
                    "answered"
                }
                (Some(_), None) => "refused",
                _ => "ignored",
            },
        };
        json!({"outcome": outcome})
    }

    /// `rearm` (#327): a `rearm_on` change now returns the card to presented and restarts its
    /// interval; a held press is let go of.
    fn rearm(&mut self, on: &str) -> Value {
        self.card_rearms.push(self.now);
        self.card_down = None;
        json!({"rearmed": on, "at": self.now})
    }

    /// `install_pack` (#306): one pack version read from its folder and put through the pack
    /// check once.
    pub fn install_pack(&mut self, id: &str, dir: &std::path::Path) -> Value {
        crate::packs::install(
            &mut self.packs,
            &mut self.pack_rows,
            &self.startup.sealed,
            id,
            dir,
        )
    }

    /// A fresh scheduler's options: the hub's own (#488's comparisons run each side on its own
    /// scheduler, so no content key crosses sides).
    pub(crate) fn options(&self) -> Options {
        schedule_options(self.scenario, self.startup)
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
            snapshot::px([0, 1].map(|i| doc["size"][i].as_f64().unwrap_or(1.0)))
        });
        let palette = self.look.light.clone();
        let gpu = self.gpu3().ok_or(())?;
        gpu.draw(doc, t, &palette, size)
            .map(|(rgba, scene)| (rgba, size, scene.boxes()))
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

    /// A deep_show or deep show call's reply, on a shared document or a sole writer's.
    pub fn show_call(&mut self, show: &Show) -> Value {
        // #140: every deep_show reply names the backends that fed it.
        if self.shared.contains_key(&show.doc) {
            return crate::seams::named(self.show_shared(show));
        }
        let reply = crate::seams::named(self.show(show));
        let rev = self.current(&show.doc).map(|r| r.rev);
        let seen = self.shown_at.entry(show.doc.clone()).or_default();
        if let Some(rev) = rev.filter(|r| seen.last().is_none_or(|(_, l)| l != r)) {
            seen.push((self.now, rev));
        }
        reply
    }

    /// One call's reply.
    pub fn call(&mut self, call: &Call) -> Value {
        // #856's planted cache per document: each document's runs are keyed apart.
        if self.startup.run_per_document {
            let doc = match call {
                Call::Show(s) => Some(&s.doc),
                Call::Patch(p) => Some(&p.doc),
                Call::Eval(e) => Some(&e.doc),
                Call::Frames(f) => Some(&f.doc),
                _ => None,
            };
            if let Some(doc) = doc {
                let mut h = std::collections::hash_map::DefaultHasher::new();
                std::hash::Hash::hash(doc, &mut h);
                deep_text::cache::scope(std::hash::Hasher::finish(&h) | 1);
            }
        }
        if let Call::Show(show) = call {
            self.vias.insert(show.doc.clone(), show.via.clone());
        }
        let mut reply = match call {
            Call::Show(show) => self.show_call(show),
            Call::Mode(show, mode) => {
                self.vias.insert(show.doc.clone(), show.via.clone());
                self.mode_show(show, mode)
            }
            Call::Patch(p) => self.patch(p, None, self.now),
            Call::Read { doc, via } => self.read(doc, via.as_ref()),
            Call::History { doc, item } => self.history(doc, item),
            Call::ByWriter(doc) => self.by_writer(doc),
            Call::Registry => self.registry_reply(),
            Call::SceneQuery(q) => self.scene_query(q),
            Call::Packs => crate::packs::rows_reply(&self.pack_rows, &self.packs),
            Call::InstallPack { id, dir } => self.install_pack(id, dir),
            Call::Costs => crate::costs::measure(self.startup),
            Call::NetworkSuite { messages, seed } => {
                crate::seams::network(*messages, *seed, self.startup.network)
            }
            Call::Migrate(to) => self.migrate(*to),
            Call::Keys { doc, runs } => self.keys(doc, *runs),
            Call::Fixtures => self.fixtures_reply(),
            Call::Schedule => self.startup.sealed.schedule(),
            Call::Eval(e) => self.eval(e),
            Call::Rate(r) => self.rate_reply(r),
            Call::Time { doc, text } => self.time_reply(doc, text),
            Call::Export(e) => self.export_reply(e),
            Call::Play {
                doc,
                display_hz,
                to,
            } => self.play(doc, *display_hz, *to),
            Call::Determinism(d) => self.determinism(d),
            Call::Frames(f) => self.frames(f),
            Call::ShapedRuns(text) => self.shaped_runs(text),
            Call::Settle(s) => self.settle_patches(s),
            Call::Query(q) => self.query(q),
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
            Call::Input { panel, event } => match self.ring_input(panel, event) {
                Some(reply) => reply,
                None => self.input(panel, event),
            },
            Call::Scope(panel) => self.scope_reply(panel),
            Call::Presented(panel) => self.presented(panel),
            Call::PopOut {
                panel,
                display,
                serial,
                full_screen,
                agent,
            } => self.pop_out(panel, display, *serial, *full_screen, *agent),
            Call::MoveWindow {
                window,
                rect,
                agent,
            } => self.move_window(window, *rect, *agent),
            Call::Activate { window, agent } => {
                self.placement.activate(self.now, window.as_deref(), *agent)
            }
            Call::Thermal { hot, agent } => self.placement.thermal(self.now, *hot, *agent),
            Call::Frontmost {
                window,
                front,
                agent,
            } => self.placement.frontmost(self.now, window, *front, *agent),
            Call::TestWindow => json!({}),
            Call::WindowCaps => crate::placement::caps_json(),
            Call::HideWindow {
                window,
                hidden,
                agent,
            } => self
                .placement
                .hide_window(self.now, window, *hidden, *agent),
            Call::Windows => self.placement.windows_json(),
            Call::Layout => self.placement.layout_json(),
            Call::CardState => json!({"card": self.card_json().map(|c| c.to_json())}),
            Call::Press { t, phase, option } => self.press(*t, *phase, option),
            Call::Rearm(on) => self.rearm(on),
            Call::See(panel) => self.see(panel),
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
            Call::Verdict(claim) => self.verdict_call(claim),
            Call::Verdicts(claim) => self.verdicts_call(claim),
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
            Call::Ring(r) => self.ring_call(r),
            Call::Capture(c) => self.capture_call(c),
            Call::Term(t) => self.term_call(t),
        };
        for shaping in deep_text::cache::take_log() {
            *self.shapings.entry(shaping.key).or_default() += 1;
        }
        self.stamp(&mut reply);
        reply
    }

    /// #806: a document's current revision as the hub records it once presented: its writer, the
    /// layer the connection stamped and its canonical document, kept in the evidence store by the
    /// hash it names; and every layer on screen on its panel, back to front, as the app draws them.
    pub fn presented_revision(&self, doc: &str) -> Option<Value> {
        let row = self.current(doc)?;
        let canonical = canonical_in(&row.doc, &self.startup.sealed.kinds()).ok()?;
        let hash = evidence::put(&self.scenario.evidence, canonical.bytes.as_bytes()).ok()?;
        let items: Vec<&String> = row.doc["items"].as_object()?.keys().collect();
        let panel = self.scenario.docs.get(doc)?;
        let rect = self.slot(panel)?;
        let size = snapshot::px([rect[2], rect[3]]);
        let record = self.record();
        let layers: Vec<Value> = self
            .bands()
            .iter()
            .filter(|b| {
                b.doc
                    .as_deref()
                    .is_some_and(|d| self.scenario.docs.get(d) == Some(panel))
            })
            .map(|b| {
                let mut out = b.to_json();
                let current = b.doc.as_deref().and_then(|d| self.current(d));
                // The presented document's items this layer draws; another document's layer on the
                // panel draws none of them.
                let drawn: Vec<String> = current
                    .filter(|_| b.doc.as_deref() == Some(doc))
                    .and_then(|r| r.doc["items"].as_object())
                    .map(|m| m.keys().cloned().collect())
                    .unwrap_or_default();
                // The layer's picture in its panel, with no ground, as the compositor rasterizes it:
                // kept in the evidence store for the app to draw, by its hash.
                let picture = current.and_then(|r| {
                    let doc = r.doc.as_object()?;
                    let mut renderer = Renderer::new();
                    let d = renderer
                        .prepare(
                            doc,
                            0,
                            &self.look.light,
                            self.look.status.as_ref(),
                            &record,
                            &self.scenario.evidence,
                        )
                        .ok()?;
                    let png = snapshot::png(renderer.raster(&d, size, None), size);
                    evidence::put(&self.scenario.evidence, &png).ok()
                });
                out["doc"] = json!(b.doc);
                out["items"] = json!(drawn);
                out["picture"] = json!(picture);
                out
            })
            .collect();
        Some(json!({
            "doc": doc,
            "rev": row.rev,
            "hash": hash,
            "writer": row.writer.to_json(),
            "layer": row.writer.layer_id(),
            "items": items,
            "panel": panel,
            "rect": rect,
            "layers": layers,
        }))
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
        // A card the shell places counts as shown only once presented (#400).
        if self.card_slot().is_some() {
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
        let Some(_) = self
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
        let mut notices = Vec::new();
        // #403: in a claim that names the document, an item of a kind this build doesn't know
        // blocks its checks, naming the kind, while the rest still draws.
        let mut blocked: Vec<Value> = Vec::new();
        // The items the check skipped as `unknown_kind`: kept as written, never drawn (#389).
        let mut skipped: Vec<String> = Vec::new();
        // The revision's expansions and its check's time (#306): the document's once it is current.
        let mut fresh: Option<(Vec<Expansion>, f64)> = None;
        let (stamped, mut issues, diff) = match stamped {
            Err(issues) => (None, issues, None),
            Ok(doc) => {
                if self.scenario.planted == Some(Planted::ReadsWasmBytes) {
                    read_programs(&doc, &self.scenario.evidence);
                }
                let started = Instant::now();
                let result = match self.scenario.planted {
                    Some(Planted::EstimatesOnThisMachine) => {
                        let coefficients = self
                            .startup
                            .sealed
                            .costs
                            .scaled(machine_factor(self.scenario.machine.as_ref()));
                        check_costed(&doc, &self.startup.sealed, &coefficients)
                    }
                    _ => check_packed(&doc, &self.startup.sealed, &self.packs),
                };
                fresh = Some((result.expansions, started.elapsed().as_secs_f64() * 1000.0));
                notices = self.notices_reply(&result.notices);
                skipped = crate::verdict::unknown_items(&result.notices);
                blocked = self.blocked_in_claim(show, &result.notices);
                let mut issues = result.issues;
                // #488's planted check takes every sample rate from 8 to 192 kHz and refuses
                // the rest.
                if self.scenario.planted == Some(Planted::AcceptsEverySampleRate8To192k) {
                    issues.retain(|i| !(i.code == "bad_rate" && i.path == "transport/sample_rate"));
                    let hz = doc
                        .pointer("/transport/sample_rate")
                        .and_then(Value::as_u64);
                    if let Some(hz) = hz.filter(|hz| !(8_000..=192_000).contains(hz)) {
                        issues.push(Issue::envelope(
                            "bad_rate",
                            "transport/sample_rate".into(),
                            json!(hz),
                            "outside 8 to 192 kHz",
                        ));
                    }
                }
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
        // The form that draws: the document with each recipe instance's derived items in its
        // place (#306), less the items skipped as `unknown_kind` (#403).
        let drawn_form = stamped.as_ref().map(|doc| {
            let expansions = fresh.as_ref().map(|(e, _)| e.as_slice());
            crate::verdict::without(
                &crate::packs::drawn(doc, expansions.unwrap_or(&[])),
                &skipped,
            )
        });
        if let Some(doc) = stamped
            .as_ref()
            .filter(|_| !issues.iter().any(|i| i.severity == "error"))
        {
            let (op_issues, drawing) =
                self.probe(drawn_form.as_ref().unwrap_or(doc), show.t, visible, None);
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
        if !notices.is_empty() {
            reply.insert("notices".into(), Value::Array(notices));
        }
        if !blocked.is_empty() {
            reply.insert("blocked".into(), Value::Array(blocked));
        }
        // A payload refused before it could be stamped makes no revision.
        if stamped.is_some() {
            reply.insert("rev".into(), json!(rev));
            let timing = show.include.iter().any(|i| matches!(i, Include::Timing));
            crate::packs::reply(
                fresh.as_ref().map_or(&[][..], |(e, _)| e.as_slice()),
                fresh.as_ref().map(|(_, ms)| *ms),
                timing,
                &mut reply,
            );
        }
        let error = self.issue_reply(&issues, &mut reply);
        if !error {
            if let Some((expansions, _)) = fresh {
                self.expansions.insert(show.doc.clone(), expansions);
            }
        }
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
            return refused_reply(reply, &issues, show.check);
        }
        if let Some(diff) = diff {
            diff_reply(diff, &mut reply);
        }
        // The checked revision becomes the session's current one; a snapshot is the session's
        // own frame at `t`.
        let doc = stamped.unwrap_or(Value::Null);
        if !self.sessions.contains_key(&show.doc) {
            let fresh = self.new_session();
            self.sessions.insert(show.doc.clone(), fresh);
        }
        if let Some(session) = self.sessions.get_mut(&show.doc) {
            session.load(&mut self.sched, drawn_form.as_ref().unwrap_or(&doc));
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

    /// The check's notices as a reply carries them. The planted check that loads a deprecated
    /// kind silently leaves its `deprecated` notices out.
    pub fn notices_reply(&self, notices: &[Notice]) -> Vec<Value> {
        notices
            .iter()
            .filter(|n| {
                !(n.code == "deprecated"
                    && self.scenario.planted == Some(Planted::LoadsDeprecatedSilently))
            })
            .map(Notice::to_json)
            .collect()
    }

    /// Every issue the checks raised, kept as evidence; the reply inlines them up to the read
    /// cap, with an empty list of snapshots. True when one is an error not carried.
    pub fn issue_reply(&self, issues: &[Issue], reply: &mut Map<String, Value>) -> bool {
        let mut list: Vec<Value> = issues.iter().map(Issue::to_json).collect();
        if self.scenario.planted == Some(Planted::IssuesWithoutActual) {
            for i in list.iter_mut().filter_map(Value::as_object_mut) {
                i.remove("actual");
            }
        }
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
        // A carried error never refuses: the last good revision had it too.
        list.iter()
            .any(|i| i["severity"] == "error" && i.get("carried").is_none())
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
                    let mut batches = Vec::new();
                    let pixels = match drawn3d {
                        Some(drawn3d) => drawn3d.ok(),
                        None => {
                            let drawn = drawn.expect("a revision with no error was drawn");
                            let size = show.size.unwrap_or_else(|| snapshot::px(drawn.frame.size));
                            let ground = self.look.light.get("ground").copied().unwrap_or([255; 3]);
                            let instanced = crate::packs::instanced(
                                self.expansions
                                    .get(&show.doc)
                                    .map_or(&[][..], Vec::as_slice),
                            );
                            let (rgba, drew) =
                                self.renderer
                                    .raster_batched(drawn, size, Some(ground), &instanced);
                            batches = drew;
                            Some((rgba, size, Vec::new()))
                        }
                    };
                    let Some((mut rgba, size, boxes3d)) = pixels else {
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
                            let rows = match drawn.filter(|_| !three) {
                                Some(d) => snapshot::visible(d.boxes(), d.scale(size), size),
                                None => snapshot::visible(boxes3d, 1.0, size),
                            };
                            reply.insert("snapshots".into(), json!([entry]));
                            reply.insert("visible".into(), rows);
                            // The instanced batches the 2D draw made: none for a 3D frame, which
                            // scene3d draws and reports on its own (#378).
                            reply.insert("batches".into(), crate::packs::batches(&batches));
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
            // A check that decides a verdict counts every issue, carried ones too: a stricter
            // rule never blocks an unrelated fix, and never passes the work either (Revision).
            // Errors come first in the list, so an inline one is there whenever any is.
            let errors = reply
                .get("issues")
                .and_then(Value::as_array)
                .is_some_and(|l| l.iter().any(|i| i["severity"] == "error"));
            let verdict = match self.verdict(show, snapshot_taken) {
                // A check an unknown kind kept from running decides nothing (#403).
                "PASS" if reply.contains_key("blocked") => "BLOCKED",
                "PASS" if errors => "FAIL",
                v => v,
            };
            reply.insert("result".into(), json!(verdict));
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
