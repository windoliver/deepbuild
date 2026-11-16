use super::*;

pub enum Call {
    /// #411: deep_query, and deep.canvas.read for a check plug-in.
    SceneQuery(Box<crate::query::Query>),
    /// #411: a deep_show or deep show call in a diagnostic mode; #412: from its readings' cursor.
    Mode(Box<Show>, Box<crate::modes::ModeArgs>),
    /// #379: the cost model's micro-benchmark.
    Costs,
    /// #140: the network seam's conformance suite.
    NetworkSuite(Box<crate::seams::Suite>),
    /// #309: a test client on the network seam's macOS backend.
    RelayClient(Box<crate::seams::RelayClient>),
    /// #855: rekeys the process's content keys under a hash, once.
    Migrate(deep_canvas::schedule::HashVersion),
    /// #855: computes every content key of a session's revision afresh, `runs` times, timed.
    Keys {
        doc: String,
        runs: usize,
    },
    /// #1901: the machine fingerprint kept output is keyed by.
    Fingerprint,
    /// #1901: a document's frame, capture or final at a time, through the kept-output cache.
    Draw {
        doc: String,
        t: EvalTime,
        output: &'static str,
    },
    /// #1901: the padded key input built twice, its padding from two seeds, and its keys.
    PaddedKey {
        fields: u64,
        seeds: [u64; 2],
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
    /// #1164: a document's input track with its hash and fork; `load` replaces it first.
    Track {
        doc: String,
        load: Option<Vec<Value>>,
    },
    /// The sealed set as the build holds it (#305).
    Registry,
    /// #420: an item's built mesh, or its count from its params.
    Geometry(Box<crate::geometry::Geometry>),
    /// #420: every kind's schema, dirty map, reads, fixture and sweep.
    KindSchemas,
    /// #421: the spatial index's bounds and the answers to its queries.
    Spatial(Box<crate::spatial::Spatial>),
    /// #539: a document's logic items stepped on its input track, with logic.determinism.
    Logic(Box<crate::picks::LogicCall>),
    /// #2014: rays met by a terrain plate's drawn triangles, its physics shape and a pick.
    TerrainRays(Box<crate::terrain::TerrainRays>),
    PhysicsBake(Box<crate::physics::Bake>),
    /// #306: the pack store's rows.
    Packs,
    /// #306: one pack version installed mid-run; #200: through a session, which wrote it.
    InstallPack {
        id: String,
        dir: PathBuf,
        session: Option<String>,
    },
    /// #1958: one pack version uninstalled: retired, then the store's sweep.
    UninstallPack {
        id: String,
        version: String,
    },
    /// #200: `deep://registries/<core version>`.
    Registries,
    /// #490: `fn`, one expression of the closed function list.
    Fn(Box<Map<String, Value>>),
    /// #490: `path`, an item's drawn path.
    /// #225: a vector field's integrated streams, each its points from its start.
    Streams {
        doc: String,
        item: String,
    },
    /// #225: a vector field's streams, arrows and flow windows at its frame.
    VectorField {
        doc: String,
        item: String,
        t: Option<EvalTime>,
    },
    Path {
        doc: String,
        item: String,
        /// #223: the frame it is drawn at; an item under a warp draws at its frame.
        t: Option<EvalTime>,
    },
    /// #412: deep_kinds, its fields as the call gave them.
    Kinds(Value),
    /// #238: the sandbox module's counts of checks, links, rewrites and check-time runs.
    Sandbox,
    /// #238: the providers a document's current revision ran at check, with their output.
    Provided(String),
    /// #415: the check-time validation of one data asset in a layout of `data.layout@1`.
    Validate {
        layout: String,
        path: PathBuf,
    },
    /// #200: an entry of a registry by name, through a document's pinned packs, `runs` times.
    Lookup {
        doc: String,
        registry: String,
        name: String,
        runs: usize,
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
    /// #501: an export through a sealed `export.target@1` entry.
    ExportRun(Box<crate::export::Job>),
    /// #501: a document's session state, read or set.
    Session {
        doc: String,
        set: Option<Value>,
    },
    /// #501: the export's GPU hash pass on given BGRA8 frames.
    FrameHash {
        frames: Vec<([u32; 2], String)>,
        software: bool,
    },
    /// #501: the cross-machine audio check on two float WAVs.
    CrossMachine([String; 2]),
    /// #1897: the GPU pixel hash on frames from the evidence store, beside its CPU twin.
    PixelHash(Vec<([u32; 2], deep_gpu::pixel_hash::Format, String)>),
    /// A document's session played on a virtual display to `to` (#488).
    Play {
        doc: String,
        display_hz: u32,
        to: i64,
        /// #501: list each presented frame's display time, time evaluated and hash.
        presented: bool,
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
        /// #525: the platform's timestamp of the event, when it carries one.
        t: Option<i64>,
        /// #540: the button the event pressed, moved with or released, and its modifiers.
        gesture: crate::points::Gesture,
    },
    /// #540: a scene's world baked again on the hub's track.
    World {
        doc: String,
        world: String,
    },
    /// #540: every copy of a document's lockstep match.
    Match {
        doc: String,
        steps: i64,
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
    /// #501: what a panel's film viewer shows.
    Viewer(String),
    /// Your words from a panel's ask box to a session, about what you point at (#384).
    Ask {
        panel: String,
        session: String,
        words: String,
        pointer: Option<[f64; 2]>,
    },
    /// A session's messages as its agent reads them (#384).
    Messages(String),
    /// A session's render-back of a document at a time as of a revision (#384), through a
    /// camera, with pixel probes (#1401).
    RenderBack {
        session: String,
        doc: String,
        t: i64,
        rev: u64,
        size: Option<[u16; 2]>,
        probes: crate::probe::Probes,
    },
    /// The parity suite's manifest (#138).
    Manifest,
    /// The check catalog (#138).
    Catalog,
    /// Judges a claim on its deliverables' current revisions and records the verdict (#403);
    /// with a verdict another run made on it, as that verdict reads here (#1938).
    Verdict(String, Option<Value>),
    /// Every verdict made on a claim, `stale` as of now (#403).
    Verdicts(String),
    /// #405: an answer to the approval asks a geometry audit opened on a claim's requirement.
    Answer {
        via: Option<Via>,
        claim: String,
        requirement: String,
        yes: bool,
    },
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
    /// An interface trial's calls: a recorded input track, a trial and a replica's replay (#191).
    Trial(Box<crate::kit::trial::TrialCall>),
    /// The trusted ring's calls (#401).
    Ring(Box<crate::ring::RingCall>),
    /// Terminals, streams and the session page's terminal tab (#402).
    Term(Box<crate::terminal::TermCall>),
    /// A capture for a bug report, its ask and its send (#105).
    Capture(Box<crate::capture::CaptureCall>),
    /// The decode worker's probes, decodes and proxies, an export, and the helpers (#498).
    Media(Box<crate::media::MediaCall>),
    /// The device gate: documents of strips, Play, the gate's fields, the device's output (#498).
    Gate(Box<crate::gate::GateCall>),
    /// #507: present mode's state, the presenter view and the menu bar's count.
    Present(crate::present::PresentCall),
    /// #499: the media module's mix.
    Mix(Box<crate::mixdown::MixCall>),
    /// #499: the test audio backend's devices, the transport log and a logic item's state.
    Audio(Box<crate::audio::AudioCall>),
    /// #525: a golden of a document's evaluation, recorded or verified on this build.
    RuntimeGolden(crate::golden::GoldenCall),
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
    /// #493: the film block, camera poses, a reduced-motion cut's dissolve, parallax and glyphs.
    pub film: bool,
    pub size: Option<[u16; 2]>,
    /// #855: each node's Debug text digest beside its result, a diagnostic only.
    pub debug_text: bool,
    /// #497: arrays to answer as the frame read them; #1918: item paths whose values it answers.
    pub arrays: Vec<String>,
    pub paths: Vec<String>,
    /// #504: the document's input track for this evaluation, over the hub's.
    pub track: Option<Vec<Value>>,
    /// #222: the evaluated-data hash of the frame.
    pub data_hash: bool,
    /// #507: each text item's drawn string beside the frame.
    pub texts: bool,
    /// #169: the core's carried-state list as the frame leaves it.
    pub carried: bool,
    /// #903: the tour pointer as the frame draws it.
    pub tour_pointer: bool,
}

pub struct Scenario {
    pub evidence: PathBuf,
    pub sessions: BTreeMap<String, Session>,
    pub processes: Vec<Process>,
    pub panels: BTreeMap<String, Panel>,
    pub docs: BTreeMap<String, String>,
    /// #504: the claim or ask each document was minted for (`docs.<id>.for`), where named.
    pub docs_for: BTreeMap<String, String>,
    pub record: BTreeMap<String, RecordObject>,
    /// #629: a replay's run record entries, each as a `run` call's reply gave it (`record` as a
    /// list).
    pub runs: Vec<Value>,
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
    /// A canvas module's wrong program by name, which the scheduler hands its operators (#420).
    pub module_planted: Option<String>,
    /// #155: the done `deep_job` replies the hub holds (`{status, outputs, receipt: {key}}`), which
    /// a generator source resolves against by its job's key.
    pub jobs: Vec<Value>,
    /// A first-party pack's planted twin by name, applied as the store reads the pack (#433).
    pub pack_planted: Option<String>,
    /// #1164: the logic module's restore and check twins, one name or a list applied together.
    pub logic_planted: Option<deep_logic::Planted>,
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
    /// The camera and microphone DeepBuild can open, and the OS's answer for each (#498).
    pub devices: crate::capture::Devices,
    /// The decode worker's caps for this run (#498).
    pub decode_caps: deep_codecs::Caps,
    /// #499: the test audio backend, which replaces the platform's output at its boundary.
    pub audio: Option<crate::audio::Backend>,
    /// #525: steps of live worlds that take host time on purpose.
    pub delays: Vec<crate::stepped::Delay>,
    /// The packs installed in the store before the first call (#306), each `(owner/name, dir)`.
    pub packs: Vec<(String, PathBuf)>,
    /// #1961: your notes the hub holds when the run starts, each `{note, doc, item, …}`.
    pub notes: Vec<Value>,
    /// #200: the hub's installed slot fills, each `{slot, fill, kit}` with the kit result the hub
    /// recorded at install.
    pub installed: Vec<Value>,
    /// #412: the entries plug-ins fill, each `{plugin, registry, entry, kit}` with the kit result
    /// the hub recorded for it on this core.
    pub plugin_entries: Vec<Value>,
    /// #412: a folder of guides and examples (`gallery.json` and its files) used in place of the
    /// installed ones.
    pub gallery: Option<PathBuf>,
    /// #412: the corpus runner's recorded runs, `{example, module_set, played, exit}`, last last.
    pub corpus_runs: Vec<Value>,
    /// Every session's pool in place of its budget class's (#857).
    pub threads: Option<usize>,
    /// Work that isn't a frame, running from before the first call to after the last (#857).
    pub background: Vec<Job>,
    /// #456: the stub model render.review asks, `{name, replies}`, each call the next reply.
    pub review_model: Option<Value>,
}
