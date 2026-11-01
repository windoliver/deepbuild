//! The `live` and `canonical` calls (issue #379; tests/acceptance/379/README.md, The live call):
//! the app's live window of sessions on a virtual clock. Each session is one writer's document,
//! checked before it shows and drawn by the canvas core into a GPU-layer view; the meter times
//! every pass, charges each writer for its own, and the degrade ladder steps only the costly
//! writer's layer. The app's windows, each on its display, draw under one GPU budget (#777): their
//! frames' charges summed step down only the writer that cost the most, in whichever window it
//! draws, and every writer is told why its rung changed. Results equal by content key are made
//! once and counted in full against every writer whose revisions read them. Canonical renders
//! run on their own state, at the class's base rung, never the live meter's.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use deep_canvas::budget::{self, Class, Limits};
use deep_canvas::camera::Offsets;
use deep_canvas::document::check_in;
use deep_canvas::registry::{BuildSet, Registry, Sealed};
use deep_canvas::show::{stamp, Writer, WriterKind};
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Labels;
use deep_gpu::cache::{self, Cache, Reader};
use deep_gpu::compile::{CompileThread, Compiling, THREAD as COMPILE_THREAD};
use deep_gpu::device::{Backend, Device};
use deep_gpu::memory;
use deep_gpu::meter::{
    self, AppMeter, Estimate, Ladder, Reason, Ring, Rung, Shape, Step, MAX_PASSES,
};
use deep_gpu::surface::Path;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::liveview::{compile_upscale, Drawing, Kit, Timer, Upscale, View, SLOTS};
use crate::{refused, App, Planted};

const FLICKS_PER_SECOND: i64 = 705_600_000;
/// The thread every live frame is drawn on, and the name of the one that never draws.
const RENDER_THREAD: &str = "deep-gpu render";
const UI_THREAD: &str = "main";

/// The wrong programs the live path reaches, from `--planted`.
#[derive(Clone, Copy, Debug, Default)]
pub struct Plants {
    ladder: meter::Planted,
    steps_every_writer: bool,
    tells_first_step_only: bool,
    sums_pass_intervals: bool,
    allocates_per_frame: bool,
    compiles_at_swap: bool,
    cache: cache::Planted,
    shares_meter_with_worker: bool,
}

impl Plants {
    pub fn of(p: Option<Planted>) -> Plants {
        Plants {
            ladder: meter::Planted {
                steps_on_first_slow_frame: p == Some(Planted::StepsOnFirstSlowFrame),
                skips_a_rung: p == Some(Planted::SkipsARung),
                budgets_each_window: p == Some(Planted::BudgetsEachWindow),
                steps_main_window: p == Some(Planted::StepsMainWindow),
            },
            tells_first_step_only: p == Some(Planted::TellsFirstStepOnly),
            steps_every_writer: p == Some(Planted::StepsEveryWriter),
            sums_pass_intervals: p == Some(Planted::SumsPassIntervals),
            allocates_per_frame: p == Some(Planted::AllocatesPerFrame),
            compiles_at_swap: p == Some(Planted::CompilesAtSwap),
            cache: cache::Planted {
                charges_first_holder: p == Some(Planted::ChargesFirstHolder),
                keeps_unread: p == Some(Planted::KeepsUnreadResults),
            },
            shares_meter_with_worker: p == Some(Planted::SharesMeterWithWorker),
        }
    }
}

/// The build's sealed set: every shipped canvas module except effects, which the live path draws
/// none of; in a `test-meter` build, also `test.gpu`.
pub fn sealed() -> &'static Sealed {
    static SEALED: OnceLock<Sealed> = OnceLock::new();
    SEALED.get_or_init(|| {
        let registry = crate::plugin::shipped_modules()
            .into_iter()
            .filter(|m| m.manifest.name != "effects")
            .fold(Registry::new(BuildSet::Full), Registry::with);
        #[cfg(feature = "test-meter")]
        let registry = registry.with(deep_canvas_test_modules::test_gpu());
        registry
            .seal()
            .expect("the live build's canvas modules seal")
    })
}

// ------------------------------------------------------------------------------------------
// The call's arguments.

struct Open {
    session: String,
    writer: String,
    doc: PathBuf,
    size: Option<[u32; 2]>,
    /// The window its view draws in, an index into the call's windows.
    window: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Purpose {
    RenderBack,
    Export,
    FrameBudget,
}

impl Purpose {
    fn parse(s: &str) -> Option<Purpose> {
        Some(match s {
            "render_back" => Purpose::RenderBack,
            "export" => Purpose::Export,
            "frame_budget" => Purpose::FrameBudget,
            _ => return None,
        })
    }

    fn name(self) -> &'static str {
        match self {
            Purpose::RenderBack => "render_back",
            Purpose::Export => "export",
            Purpose::FrameBudget => "frame_budget",
        }
    }
}

enum Event {
    Open(Open),
    Close(String),
    Revise(String, PathBuf),
    Camera(String, f64),
    Rung(String, Rung),
    Canonical(String, Purpose, u64, [u32; 2]),
}

struct Charge {
    from: u64,
    to: u64,
    gpu_ms: f64,
    cpu_ms: f64,
}

struct Interval {
    name: String,
    session: String,
    start_ms: f64,
    end_ms: f64,
    shares: Vec<(String, f64)>,
}

#[derive(Default)]
struct Stub {
    writers: BTreeMap<String, Vec<Charge>>,
    passes: Vec<(u64, u64, Vec<Interval>)>,
    operators: BTreeMap<String, f64>,
}

#[derive(Default, Clone, Copy)]
struct Reports {
    passes: bool,
    hashes: bool,
    memory: bool,
    allocs: bool,
    meter: bool,
}

struct Args {
    /// The app's windows by ID, the main one first, each on a display; `named` when the call
    /// listed them, which alone reports the app's meter row.
    windows: Vec<String>,
    named: bool,
    look: Look3,
    /// The look's frame-history window, 0 without history.
    history: u32,
    frames: u64,
    fps: u64,
    events: Vec<(u64, Event)>,
    reports: Reports,
    stub: Option<Stub>,
    battery: Vec<(u64, f64, bool)>,
    assets: BTreeMap<String, PathBuf>,
}

fn pair(v: &Value) -> Option<[u32; 2]> {
    let a = v.as_array().filter(|a| a.len() == 2)?;
    Some([
        u32::try_from(a[0].as_u64()?).ok().filter(|n| *n > 0)?,
        u32::try_from(a[1].as_u64()?).ok().filter(|n| *n > 0)?,
    ])
}

fn open_of(v: &Value, windows: &[String]) -> Option<Open> {
    Some(Open {
        window: match v.get("window") {
            None | Some(Value::Null) => 0,
            Some(w) => windows
                .iter()
                .position(|id| Some(id.as_str()) == w.as_str())?,
        },
        session: v["session"].as_str()?.to_string(),
        writer: v["writer"].as_str()?.to_string(),
        doc: PathBuf::from(v["doc"].as_str()?),
        size: match v.get("size") {
            None | Some(Value::Null) => None,
            Some(s) => Some(pair(s)?),
        },
    })
}

/// The look's `history` window: 0 for none.
fn history_of(look: &Value) -> Result<u32, String> {
    match look.get("history") {
        None | Some(Value::Null) => Ok(0),
        Some(h) => match h["mode"].as_str().unwrap_or("antialias") {
            "none" => Ok(0),
            "antialias" | "upscale" => {
                let w = h["window"].as_u64().unwrap_or(8);
                if (2..=16).contains(&w) {
                    Ok(w as u32)
                } else {
                    Err("look: history.window is 2 to 16".into())
                }
            }
            other => Err(format!(
                "look: history.mode {other} is none, antialias or upscale"
            )),
        },
    }
}

fn parse(call: &Value) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let test_build = cfg!(feature = "test-meter");
    let frames = call["frames"]
        .as_u64()
        .filter(|f| *f >= 1)
        .ok_or_else(|| bad("frames is a count of at least 1"))?;
    let fps = call
        .get("fps")
        .map_or(Some(60), Value::as_u64)
        .filter(|f| *f >= 1)
        .ok_or_else(|| bad("fps"))?;
    let look = Look3::read(&call["look"]).map_err(|e| bad(&format!("look: {e}")))?;
    let history = history_of(&call["look"]).map_err(|e| bad(&e))?;
    let windows = match call.get("windows") {
        None => vec!["main".to_string()],
        Some(ws) => {
            let mut windows: Vec<String> = Vec::new();
            for w in ws.as_array().into_iter().flatten() {
                let (Some(id), Some(_display)) = (w["window"].as_str(), w["display"].as_str())
                else {
                    return Err(bad("a window is {window, display}"));
                };
                if windows.iter().any(|x| x == id) {
                    return Err(bad("window IDs are distinct"));
                }
                windows.push(id.to_string());
            }
            if windows.is_empty() {
                return Err(bad("windows is a list of at least one window"));
            }
            windows
        }
    };
    let mut events = Vec::new();
    for s in call["sessions"]
        .as_array()
        .ok_or_else(|| bad("sessions is a list"))?
    {
        events.push((
            1,
            Event::Open(
                open_of(s, &windows)
                    .ok_or_else(|| bad("a session is {session, writer, doc, size?, window?}"))?,
            ),
        ));
    }
    for e in call["events"].as_array().into_iter().flatten() {
        let frame = e["frame"]
            .as_u64()
            .ok_or_else(|| bad("an event names its frame"))?;
        let ev = if let Some(o) = e.get("open") {
            Event::Open(open_of(o, &windows).ok_or_else(|| bad("open"))?)
        } else if let Some(s) = e.get("close") {
            Event::Close(
                s.as_str()
                    .ok_or_else(|| bad("close names a session"))?
                    .to_string(),
            )
        } else if let Some(r) = e.get("revise") {
            let (Some(s), Some(d)) = (r["session"].as_str(), r["doc"].as_str()) else {
                return Err(bad("revise is {session, doc}"));
            };
            Event::Revise(s.to_string(), PathBuf::from(d))
        } else if let Some(c) = e.get("camera") {
            let (Some(s), Some(a)) = (c["session"].as_str(), c["azimuth"].as_f64()) else {
                return Err(bad("camera is {session, azimuth}"));
            };
            Event::Camera(s.to_string(), a)
        } else if let Some(r) = e.get("rung") {
            let (Some(s), Some(to)) = (
                r["session"].as_str(),
                r["to"].as_str().and_then(Rung::parse),
            ) else {
                return Err(bad("rung is {session, to}"));
            };
            Event::Rung(s.to_string(), to)
        } else if let Some(c) = e.get("canonical") {
            let (Some(s), Some(p), Some(f), Some(size)) = (
                c["session"].as_str(),
                c["purpose"].as_str().and_then(Purpose::parse),
                c["frame"].as_u64(),
                pair(&c["size"]),
            ) else {
                return Err(bad("canonical is {session, purpose, frame, size}"));
            };
            Event::Canonical(s.to_string(), p, f, size)
        } else {
            return Err(bad(
                "an event is open, close, revise, camera, rung or canonical",
            ));
        };
        events.push((frame, ev));
    }
    // Stable: events at one frame keep the order they were listed in.
    events.sort_by_key(|(f, _)| *f);
    let mut reports = Reports::default();
    for r in call["report"].as_array().into_iter().flatten() {
        match r.as_str() {
            Some("passes") => reports.passes = true,
            Some("hashes") => reports.hashes = true,
            Some("memory") => reports.memory = true,
            Some("meter") => reports.meter = true,
            Some("allocs") if test_build => reports.allocs = true,
            _ => return Err(bad("report holds passes, hashes, memory, allocs or meter")),
        }
    }
    let stub = match call.get("stub_meter") {
        None => None,
        Some(_) if !test_build => return Err(bad("stub_meter is a test build's")),
        Some(s) => Some(stub_of(s).ok_or_else(|| bad("stub_meter"))?),
    };
    let mut battery = Vec::new();
    match call.get("stub_battery") {
        None => {}
        Some(_) if !test_build => return Err(bad("stub_battery is a test build's")),
        Some(b) => {
            for r in b.as_array().ok_or_else(|| bad("stub_battery is a list"))? {
                let (Some(f), Some(p), Some(state)) = (
                    r["frame"].as_u64(),
                    r["percent"].as_f64(),
                    r["state"].as_str(),
                ) else {
                    return Err(bad("a battery reading is {frame, percent, state}"));
                };
                battery.push((f, p, state == "discharging"));
            }
        }
    }
    let mut assets = BTreeMap::new();
    for (sha, path) in call["assets"].as_object().into_iter().flatten() {
        assets.insert(
            sha.clone(),
            PathBuf::from(path.as_str().ok_or_else(|| bad("an asset is a path"))?),
        );
    }
    Ok(Args {
        named: call.get("windows").is_some(),
        windows,
        look,
        history,
        frames,
        fps,
        events,
        reports,
        stub,
        battery,
        assets,
    })
}

fn stub_of(s: &Value) -> Option<Stub> {
    let mut stub = Stub::default();
    for (writer, list) in s["writers"].as_object().into_iter().flatten() {
        let mut charges = Vec::new();
        for c in list.as_array()? {
            charges.push(Charge {
                from: c["from"].as_u64()?,
                to: c["to"].as_u64().unwrap_or(u64::MAX),
                gpu_ms: c["gpu_ms"].as_f64()?,
                cpu_ms: c["cpu_ms"].as_f64().unwrap_or(0.0),
            });
        }
        stub.writers.insert(writer.clone(), charges);
    }
    for p in s["passes"].as_array().into_iter().flatten() {
        let mut intervals = Vec::new();
        for i in p["intervals"].as_array()? {
            intervals.push(Interval {
                name: i["name"].as_str()?.to_string(),
                session: i["session"].as_str()?.to_string(),
                start_ms: i["start_ms"].as_f64()?,
                end_ms: i["end_ms"].as_f64()?,
                shares: i["shares"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|x| Some((x["writer"].as_str()?.to_string(), x["share"].as_f64()?)))
                    .collect::<Option<_>>()?,
            });
        }
        stub.passes
            .push((p["from"].as_u64()?, p["to"].as_u64()?, intervals));
    }
    for (op, f) in s["operators"].as_object().into_iter().flatten() {
        stub.operators.insert(op.clone(), f.as_f64()?);
    }
    Some(stub)
}

// ------------------------------------------------------------------------------------------
// Sessions and revisions.

#[derive(Clone, Copy, PartialEq, Eq)]
enum State {
    Live,
    Refused,
    Closed,
}

/// A revision admitted: checked, compiled for its frames, fitted to the window's memory.
struct Rev {
    id: u64,
    number: u64,
    doc: Value,
    /// Its compiled frames, until it latches and its view takes them.
    frames: Option<Frames>,
    class: Option<Class>,
    limits: Limits,
    fit: Estimate,
    #[cfg(feature = "test-meter")]
    placed: Vec<crate::testgpu::Placed>,
    #[cfg(feature = "test-meter")]
    loops: Option<u32>,
}

struct Pending {
    change: usize,
    to: Rung,
    compiling: Option<Compiling<Arc<Upscale>>>,
    decided: u64,
}

struct Session {
    id: String,
    writer: String,
    doc_id: String,
    size: Option<[u32; 2]>,
    window: usize,
    state: State,
    issues: Vec<Value>,
    revisions: Vec<(u64, &'static str, Vec<Value>)>,
    /// A revision latched this frame: its number, when its latch began and the pipelines its view
    /// had compiled before it; then, by number, the ms from its latch to its settled frame and the
    /// pipelines it needed (the authoring loop).
    settling: Option<(u64, Instant, u32)>,
    settled: BTreeMap<u64, (f64, u32)>,
    current: Option<Rev>,
    pending: Option<Rev>,
    view: Option<View>,
    ladder: Ladder,
    ring: Ring,
    change: Option<Pending>,
    drawn: Rung,
    offsets: Offsets,
    view_changed: bool,
    over_ops: u32,
    ops_resolution: f64,
}

impl Session {
    fn class(&self) -> Option<Class> {
        self.current.as_ref().and_then(|r| r.class)
    }

    fn limits(&self) -> Limits {
        self.current
            .as_ref()
            .map_or(Class::Figure.limits(), |r| r.limits)
    }
}

fn writer_of(text: &str) -> Option<Writer> {
    let (kind, id) = text.split_once(':')?;
    let kind = match kind {
        "you" => WriterKind::You,
        "shell" => WriterKind::Shell,
        "record" => WriterKind::Record,
        "agent" => WriterKind::Agent,
        "plugin" => WriterKind::Plugin,
        _ => return None,
    };
    Some(Writer {
        kind,
        id: id.to_string(),
    })
}

fn issue(code: &str, path: &str, actual: Value, what: &str) -> Value {
    json!({"code": code, "severity": "error", "ids": [], "path": path, "actual": actual, "what": what})
}

/// A revision that passed admission.
struct Admitted {
    doc: Value,
    frames: Frames,
    class: Option<Class>,
    limits: Limits,
    fit: Estimate,
    size: [u32; 2],
}

/// A writer's payload checked as its session's next revision, before it shows: stamped by the
/// core, checked in the build's sealed set, compiled for its frames and fitted to the window's
/// GPU memory.
fn admit(
    path: &PathBuf,
    writer: &str,
    doc_id: &str,
    size: Option<[u32; 2]>,
    look: &Look3,
    history: u32,
    labels: &mut Labels,
) -> Result<Admitted, Vec<Value>> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| vec![issue("out_of_range", "doc", json!(path), &e.to_string())])?;
    let payload: Value = serde_json::from_str(&text)
        .map_err(|e| vec![issue("out_of_range", "doc", Value::Null, &e.to_string())])?;
    let w = writer_of(writer).ok_or_else(|| {
        vec![issue(
            "out_of_range",
            "writer",
            json!(writer),
            "a writer is kind:id",
        )]
    })?;
    let mut doc = stamp(&payload, doc_id, &w, writer)
        .map_err(|issues| issues.iter().map(|i| i.to_json()).collect::<Vec<_>>())?;
    let errors: Vec<Value> = check_in(&doc, sealed())
        .issues
        .iter()
        .filter(|i| i.severity == "error")
        .map(|i| i.to_json())
        .collect();
    if !errors.is_empty() {
        return Err(errors);
    }
    let (class, limits) = match budget::of(&doc) {
        Some((c, l)) => (Some(c), l),
        None => (None, Class::Figure.limits()),
    };
    let size = size.or_else(|| pair(&doc["size"])).ok_or_else(|| {
        vec![issue(
            "out_of_range",
            "size",
            Value::Null,
            "a view needs a size",
        )]
    })?;
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
    }
    let frames = Frames::new(&doc, look, labels).map_err(|r| {
        vec![issue(
            r.code,
            &r.path,
            Value::Null,
            "the document can't be evaluated",
        )]
    })?;
    let moving = camera_moves(&doc);
    let base_scale = if moving { limits.scale_moving } else { 1.0 };
    let effects = doc["items"]
        .as_object()
        .is_some_and(|items| items.values().any(|i| i["kind"] == "test.burn@1"));
    let shape = Shape {
        size,
        slots: SLOTS,
        hdr: false,
        effects,
    };
    let fit = meter::fit(&shape, base_scale, history, limits.gpu_bytes).map_err(|floor| {
        vec![json!({
            "code": "over_budget", "severity": "error", "ids": [], "path": "size",
            "actual": {"size": size, "gpu_bytes": floor.bytes(), "cap_bytes": limits.gpu_bytes},
            "what": format!(
                "a {} × {} view needs {:.1} MB of GPU memory at scale {} with a {}-frame window, past its class's {} MB",
                size[0], size[1], floor.bytes() as f64 / 1e6, floor.scale, floor.history, limits.gpu_bytes / budget::MB
            ),
        })]
    })?;
    Ok(Admitted {
        doc,
        frames,
        class,
        limits,
        fit,
        size,
    })
}

/// Whether a channel moves the document's camera: its view then moves, and renders at the
/// class's scale while moving.
fn camera_moves(doc: &Value) -> bool {
    let Some(cam) = doc["camera"].as_str() else {
        return false;
    };
    let prefix = format!("items/{cam}/");
    doc["channels"].as_object().is_some_and(|c| {
        c.values().any(|ch| {
            ch["target"]
                .as_str()
                .is_some_and(|t| t.starts_with(&prefix))
        })
    })
}

// ------------------------------------------------------------------------------------------
// What a frame reports, kept in buffers reserved before the first frame.

#[derive(Clone, Copy, Default)]
struct ViewRow {
    session: usize,
    rung: Option<Rung>,
    drawn: bool,
    gpu: f64,
    cpu: f64,
    scale: f64,
    history: u32,
}

#[derive(Clone, Copy, Default)]
struct PassRow {
    name: &'static str,
    session: Option<usize>,
    start_ns: f64,
    end_ns: f64,
    charged_ms: f64,
    /// Index of the stub interval whose shares split it.
    stub: Option<(usize, usize)>,
}

#[derive(Default)]
struct FrameRow {
    frame: u64,
    gpu_ms: f64,
    cpu_ms: f64,
    views: (usize, usize),
    passes: (usize, usize),
    allocs: Option<u64>,
    /// Its pixel hashes and memory, when the call reports them.
    extra: Map<String, Value>,
}

struct ChangeRow {
    frame: u64,
    session: usize,
    step: Step,
    /// The meter scope whose budget moved it: none for the initial rung, you or the battery.
    scope: Option<&'static str>,
    pipelines: Vec<&'static str>,
    compiled_by: Option<u64>,
    thread: Option<&'static str>,
    effective: Option<u64>,
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let _ = out;
    let args = match parse(call) {
        Ok(a) => a,
        Err(e) => return e,
    };
    let plants = Plants::of(app.planted);
    let path = app.decision.path;
    let noop = app.backend == Backend::Noop;
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        Live::new(device, args, plants, path, noop).run()
    })
}

struct Live {
    device: Arc<Device>,
    args: Args,
    plants: Plants,
    path: Path,
    noop: bool,
    kit: Kit,
    compile: CompileThread,
    /// The rungs below scale 1 need the upscale's pipelines: they compile off-screen as the
    /// window opens, before any change needs them.
    warming: Option<Compiling<Arc<Upscale>>>,
    labels: Labels,
    #[cfg(feature = "test-meter")]
    results: Cache<crate::testgpu::Made>,
    #[cfg(not(feature = "test-meter"))]
    results: Cache<()>,
    sessions: Vec<Session>,
    next_rev: u64,
    frames: Vec<FrameRow>,
    views: Vec<ViewRow>,
    passes: Vec<PassRow>,
    changes: Vec<ChangeRow>,
    app: AppMeter,
    canonicals: Vec<Value>,
    planted_log: Vec<Vec<f64>>,
}

impl Live {
    fn new(device: Arc<Device>, args: Args, plants: Plants, path: Path, noop: bool) -> Live {
        let most = 1 + args
            .events
            .iter()
            .filter(|(_, e)| matches!(e, Event::Open(_)))
            .count()
            .min(64);
        let frames = args.frames as usize;
        let kit = Kit::new(&device);
        let compile = CompileThread::new();
        // The planted swap compiles nothing ahead.
        let warming = (!plants.compiles_at_swap).then(|| {
            let (device, layout) = (device.clone(), kit.source.clone());
            compile.compile(move || Arc::new(compile_upscale(&device, &layout)))
        });
        Live {
            kit,
            compile,
            warming,
            labels: Labels::new(),
            results: Cache::new(plants.cache),
            sessions: Vec::new(),
            next_rev: 1,
            frames: Vec::with_capacity(frames),
            views: Vec::with_capacity(frames * most),
            passes: Vec::with_capacity(frames * most * 10),
            changes: Vec::new(),
            app: AppMeter::new(plants.ladder),
            canonicals: Vec::new(),
            planted_log: Vec::new(),
            device,
            args,
            plants,
            path,
            noop,
        }
    }

    fn find(&self, id: &str) -> Option<usize> {
        self.sessions
            .iter()
            .rposition(|s| s.id == id && s.state != State::Closed)
    }

    fn t(&self, frame: u64) -> i64 {
        (frame as i64 - 1) * FLICKS_PER_SECOND / self.args.fps as i64
    }

    fn record_change(
        &mut self,
        frame: u64,
        session: usize,
        step: Step,
        scope: Option<&'static str>,
    ) -> usize {
        self.changes.push(ChangeRow {
            frame,
            session,
            step,
            scope,
            pipelines: Vec::new(),
            compiled_by: None,
            thread: None,
            effective: None,
        });
        self.changes.len() - 1
    }

    /// A step decided at the end of `frame`: its new rung's pipelines compile off-screen, and it
    /// takes effect on the first frame after they're ready.
    fn decide(&mut self, frame: u64, session: usize, step: Step, scope: Option<&'static str>) {
        let change = self.record_change(frame, session, step, scope);
        let needs = step.to.scale(1.0) < 1.0 && self.kit.upscale.is_none();
        let compiling = (needs && !self.plants.compiles_at_swap).then(|| {
            self.changes[change].pipelines =
                vec![crate::liveview::UPSCALE, crate::liveview::SHARPEN];
            self.changes[change].thread = Some(COMPILE_THREAD);
            // The compile the window started as it opened, or a new one.
            self.warming.take().unwrap_or_else(|| {
                let (device, layout) = (self.device.clone(), self.kit.source.clone());
                self.compile
                    .compile(move || Arc::new(compile_upscale(&device, &layout)))
            })
        });
        if needs && self.plants.compiles_at_swap {
            self.changes[change].pipelines =
                vec![crate::liveview::UPSCALE, crate::liveview::SHARPEN];
            self.changes[change].thread = Some(RENDER_THREAD);
        }
        self.sessions[session].change = Some(Pending {
            change,
            to: step.to,
            compiling,
            decided: frame,
        });
    }

    /// At the start of `frame`: pending changes whose pipelines are ready take effect.
    fn take_effect(&mut self, frame: u64) {
        if let Some(up) = self.warming.as_mut().and_then(|c| c.poll().cloned()) {
            self.kit.upscale = Some(up);
            self.warming = None;
        }
        for s in 0..self.sessions.len() {
            let Some(p) = self.sessions[s].change.as_mut() else {
                continue;
            };
            if frame <= p.decided {
                continue;
            }
            let change = p.change;
            if let Some(c) = p.compiling.as_mut() {
                let Some(up) = c.poll() else {
                    continue;
                };
                self.kit.upscale = Some(up.clone());
                self.changes[change].compiled_by = Some(frame - 1);
            } else if !self.changes[change].pipelines.is_empty() && self.kit.upscale.is_none() {
                // The planted swap: compiled here, in the frame it takes effect.
                self.kit.upscale = Some(Arc::new(compile_upscale(&self.device, &self.kit.source)));
                self.changes[change].compiled_by = Some(frame);
            }
            let to = p.to;
            self.sessions[s].drawn = to;
            self.sessions[s].change = None;
            self.changes[change].effective = Some(frame);
        }
    }

    fn open(&mut self, frame: u64, o: &Open) {
        let n = self.sessions.len();
        let (ladder, first) = Ladder::new(self.plants.ladder);
        self.app.open();
        self.sessions.push(Session {
            id: o.session.clone(),
            writer: o.writer.clone(),
            doc_id: format!("01jb379000000000000{n:07}"),
            size: o.size,
            window: o.window,
            state: State::Live,
            issues: Vec::new(),
            revisions: Vec::new(),
            settling: None,
            settled: BTreeMap::new(),
            current: None,
            pending: None,
            view: None,
            ladder,
            ring: Ring::default(),
            change: None,
            drawn: Rung::Base,
            offsets: Offsets::default(),
            view_changed: false,
            over_ops: 0,
            ops_resolution: 1.0,
        });
        self.revise(n, &o.doc);
        // The first revision latches as the session opens.
        self.latch(n);
        let s = &mut self.sessions[n];
        if s.current.is_none() {
            s.state = State::Refused;
            s.issues = s.revisions.last().map(|r| r.2.clone()).unwrap_or_default();
            return;
        }
        let c = self.record_change(frame, n, first, None);
        self.changes[c].effective = Some(frame);
    }

    /// A revision arrives: checked before it shows; it supersedes any revision still pending.
    fn revise(&mut self, s: usize, doc: &PathBuf) {
        let number = self.sessions[s].revisions.len() as u64 + 1;
        let (writer, doc_id, size) = {
            let ses = &self.sessions[s];
            (ses.writer.clone(), ses.doc_id.clone(), ses.size)
        };
        let admitted = admit(
            doc,
            &writer,
            &doc_id,
            size,
            &self.args.look,
            self.args.history,
            &mut self.labels,
        );
        let ses = &mut self.sessions[s];
        match admitted {
            Err(issues) => ses.revisions.push((number, "refused", issues)),
            Ok(Admitted {
                doc,
                frames,
                class,
                limits,
                fit,
                size,
            }) => {
                #[cfg(feature = "test-meter")]
                let (placed, loops) = match crate::testgpu::items(&doc) {
                    Ok(x) => x,
                    Err(path) => {
                        ses.revisions.push((
                            number,
                            "refused",
                            vec![issue(
                                "out_of_range",
                                &path,
                                Value::Null,
                                "a test item's params",
                            )],
                        ));
                        return;
                    }
                };
                if let Some(old) = ses.pending.take() {
                    if let Some(r) = ses.revisions.iter_mut().find(|r| r.0 == old.number) {
                        r.1 = "superseded";
                    }
                }
                ses.size = Some(size);
                ses.revisions.push((number, "pending", Vec::new()));
                ses.pending = Some(Rev {
                    id: self.next_rev,
                    number,
                    doc,
                    frames: Some(frames),
                    class,
                    limits,
                    fit,

                    #[cfg(feature = "test-meter")]
                    placed,
                    #[cfg(feature = "test-meter")]
                    loops,
                });
                self.next_rev += 1;
            }
        }
    }

    /// The session's pending revision becomes current: its results are read (made when no
    /// revision holds them), or it fails and leaves nothing behind.
    fn latch(&mut self, s: usize) {
        let latched = Instant::now();
        let Some(mut rev) = self.sessions[s].pending.take() else {
            return;
        };
        let writer = self.sessions[s].writer.clone();
        let reader = Reader {
            revision: rev.id,
            writer,
        };
        #[cfg(feature = "test-meter")]
        let failed = rev.placed.iter().find_map(|p| {
            let (device, pipes, assets) = (&self.device, &self.kit.test, &self.args.assets);
            self.results
                .read(&p.key, &reader, || pipes.make(device, &p.need, assets))
                .err()
        });
        #[cfg(not(feature = "test-meter"))]
        let failed: Option<String> = {
            let _ = &reader;
            None
        };
        let ses = &mut self.sessions[s];
        let row = ses
            .revisions
            .iter_mut()
            .find(|r| r.0 == rev.number)
            .expect("its row");
        if let Some(why) = failed {
            row.1 = "failed";
            row.2 = vec![issue("asset_unreadable", "assets", Value::Null, &why)];
            self.results.release(rev.id);
            return;
        }
        row.1 = "current";
        let before = ses.view.as_ref().map_or(0, View::pipelines);
        ses.settling = Some((rev.number, latched, before));
        let size = ses.size.expect("an admitted revision has its size");
        let frames = rev
            .frames
            .take()
            .expect("a pending revision holds its frames");
        match ses.view.as_mut() {
            None => {
                match View::new(
                    &self.device,
                    self.path,
                    size,
                    SLOTS,
                    frames,
                    rev.fit.scale,
                    rev.fit.history,
                    &self.args.look,
                    &mut self.labels,
                ) {
                    Ok(v) => ses.view = Some(v),
                    Err(e) => {
                        row.1 = "failed";
                        row.2 = vec![issue("no_view", "size", Value::Null, &e)];
                        self.results.release(rev.id);
                        return;
                    }
                }
            }
            Some(v) => {
                v.frames = frames;
                v.scale = rev.fit.scale;
                v.window = rev.fit.history;
            }
        }
        #[cfg(feature = "test-meter")]
        if let Some(v) = ses.view.as_mut() {
            v.test.set(
                &self.device,
                &self.kit,
                &rev.placed,
                rev.loops,
                &self.results,
            );
        }
        let old = ses.current.replace(rev);
        if let Some(old) = old {
            self.results.release(old.id);
        }
    }

    fn close(&mut self, s: usize) {
        self.app.close(s);
        let ses = &mut self.sessions[s];
        ses.state = State::Closed;
        ses.view = None;
        let ids: Vec<u64> = ses
            .current
            .iter()
            .chain(ses.pending.iter())
            .map(|r| r.id)
            .collect();
        if let Some(p) = ses.pending.take() {
            if let Some(r) = ses.revisions.iter_mut().find(|r| r.0 == p.number) {
                r.1 = "superseded";
            }
        }
        for id in ids {
            self.results.release(id);
        }
        memory::drain(&self.device);
    }

    /// An effect operator's measured cost over its declared one this frame: the stub's, or
    /// `test.burn`'s pass charge against its declared ns per pixel.
    fn operator_factor(&self, s: usize, charges: &[f64], passes_start: usize) -> Option<f64> {
        if let Some(f) = self
            .args
            .stub
            .as_ref()
            .and_then(|st| st.operators.values().copied().reduce(f64::max))
        {
            return Some(f);
        }
        #[cfg(feature = "test-meter")]
        {
            let view = self.sessions[s].view.as_ref()?;
            let px = view.effect_px()? as f64;
            let declared = crate::testgpu::BURN_NS_PER_PX * px / 1e6;
            let measured: f64 = self.passes[passes_start..]
                .iter()
                .zip(charges)
                .filter(|(p, _)| {
                    p.session == Some(s) && p.name == deep_canvas_test_modules::TEST_BURN
                })
                .map(|(_, c)| *c)
                .sum();
            (declared > 0.0 && measured > 0.0).then(|| measured / declared)
        }
        #[cfg(not(feature = "test-meter"))]
        {
            let _ = (s, charges, passes_start);
            None
        }
    }

    fn stub_charge(&self, writer: &str, frame: u64) -> Option<(f64, f64)> {
        let list = self.args.stub.as_ref()?.writers.get(writer)?;
        list.iter()
            .find(|c| c.from <= frame && frame <= c.to)
            .map(|c| (c.gpu_ms, c.cpu_ms))
    }

    fn run(mut self) -> Value {
        deep_gpu::alloc::core_thread();
        memory::drain(&self.device);
        let device_before = memory::allocated(&self.device);
        let mut timer = Timer::new(&self.device);
        let timed = timer.timed();
        let period = timer.period_ns().unwrap_or(1.0);
        let events = std::mem::take(&mut self.args.events);
        let mut next_event = 0;
        let mut canonical_queue: Vec<(usize, Purpose, u64, [u32; 2])> = Vec::with_capacity(8);
        // A frame's per-session charges and the stub intervals' names, reused frame to frame.
        let mut charged = vec![(0.0f64, 0.0f64); 64];
        let mut intervals = [[0.0f64; 2]; MAX_PASSES];
        let mut charges = [0.0f64; MAX_PASSES];
        let mut cpu_of = vec![0.0f64; 64];
        // The window presents frame k no sooner than (k − 1) ÷ fps after the first, as a display
        // does, so work off-screen (a rung's compile) runs beside the frames it would in the app.
        let origin = Instant::now();
        for frame in 1..=self.args.frames {
            let due = origin
                + std::time::Duration::from_secs_f64((frame - 1) as f64 / self.args.fps as f64);
            if let Some(wait) = due.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
            let counting = self.args.reports.allocs;
            if counting {
                deep_gpu::alloc::start();
            }
            let began = Instant::now();
            canonical_queue.clear();
            self.take_effect(frame);
            while next_event < events.len() && events[next_event].0 == frame {
                match &events[next_event].1 {
                    Event::Open(o) => self.open(frame, o),
                    Event::Close(id) => {
                        if let Some(s) = self.find(id) {
                            self.close(s);
                        }
                    }
                    Event::Revise(id, doc) => {
                        if let Some(s) = self
                            .find(id)
                            .filter(|s| self.sessions[*s].state == State::Live)
                        {
                            self.revise(s, doc);
                        }
                    }
                    Event::Camera(id, azimuth) => {
                        if let Some(s) = self.find(id) {
                            let ses = &mut self.sessions[s];
                            ses.offsets.azimuth += azimuth;
                            ses.view_changed = true;
                        }
                    }
                    Event::Rung(id, to) => {
                        if let Some(s) = self
                            .find(id)
                            .filter(|s| self.sessions[*s].state == State::Live)
                        {
                            if let Some(step) = self.sessions[s].ladder.set(*to) {
                                self.decide(frame, s, step, None);
                            }
                        }
                    }
                    Event::Canonical(id, purpose, of, size) => {
                        if let Some(s) = self.find(id) {
                            canonical_queue.push((s, *purpose, *of, *size));
                        }
                    }
                }
                next_event += 1;
            }
            for s in 0..self.sessions.len() {
                if self.sessions[s].state == State::Live && self.sessions[s].pending.is_some() {
                    self.latch(s);
                }
            }

            // Draw every live view into one encoder, each pass timed.
            timer.begin_frame();
            let t = self.t(frame);
            let mut encoder = deep_gpu::alloc::outside(|| {
                self.device
                    .device
                    .create_command_encoder(&Default::default())
            });
            let views_start = self.views.len();
            for s in 0..self.sessions.len() {
                if self.sessions[s].state != State::Live {
                    continue;
                }
                let rung = self.sessions[s].drawn;
                let drawn = match rung {
                    Rung::Freeze => false,
                    Rung::Hz30 => frame % 2 == 1,
                    _ => true,
                };
                let started = Instant::now();
                let ses = &mut self.sessions[s];
                let drawing = Drawing {
                    rung,
                    offsets: ses.offsets,
                    effects_resolution: ses.ops_resolution,
                    canonical: false,
                };
                let (scale, history) = match ses.view.as_mut() {
                    Some(view) => {
                        if drawn {
                            let _ = view.draw(
                                &self.device,
                                &self.kit,
                                &self.args.look,
                                t,
                                &drawing,
                                &mut self.labels,
                                &mut encoder,
                                &mut timer,
                                s,
                            );
                        }
                        (rung.scale(view.scale), view.history_frames(&drawing))
                    }
                    None => (1.0, 0),
                };
                cpu_of[s % 64] = started.elapsed().as_secs_f64() * 1e3;
                self.views.push(ViewRow {
                    session: s,
                    rung: Some(rung),
                    drawn,
                    gpu: 0.0,
                    cpu: cpu_of[s % 64],
                    scale,
                    history,
                });
            }
            timer.resolve(&mut encoder);
            let cpu_ms = began.elapsed().as_secs_f64() * 1e3;
            deep_gpu::alloc::outside(|| self.device.queue.submit([encoder.finish()]));
            memory::drain(&self.device);
            timer.read(&self.device);
            let views_end = self.views.len();
            for ses in &mut self.sessions {
                if let Some((number, latched, before)) = ses.settling.take() {
                    let now = ses.view.as_ref().map_or(before, View::pipelines);
                    ses.settled.insert(
                        number,
                        (latched.elapsed().as_secs_f64() * 1e3, now - before),
                    );
                }
            }

            // The frame's passes: timestamps, the CPU fallback, or the stub's intervals.
            let passes_start = self.passes.len();
            let stub_passes = self.args.stub.as_ref().and_then(|st| {
                st.passes
                    .iter()
                    .position(|(from, to, _)| *from <= frame && frame <= *to)
            });
            let mut n = 0;
            if let Some(k) = stub_passes {
                let st = self.args.stub.as_ref().expect("found above");
                for (j, iv) in st.passes[k].2.iter().enumerate().take(MAX_PASSES) {
                    let session = self.find(&iv.session);
                    intervals[n] = [iv.start_ms, iv.end_ms];
                    self.passes.push(PassRow {
                        name: "",
                        session,
                        start_ns: iv.start_ms * 1e6,
                        end_ns: iv.end_ms * 1e6,
                        charged_ms: 0.0,
                        stub: Some((k, j)),
                    });
                    n += 1;
                }
            } else {
                let origin = (0..timer.n)
                    .map(|i| {
                        if timed {
                            timer.marks[i].ticks[0] as f64 * period
                        } else {
                            timer.marks[i].cpu[0] as f64
                        }
                    })
                    .fold(f64::INFINITY, f64::min);
                for i in 0..timer.n {
                    let m = timer.marks[i];
                    let (a, b) = if timed {
                        (
                            m.ticks[0] as f64 * period,
                            (m.ticks[1].max(m.ticks[0])) as f64 * period,
                        )
                    } else {
                        (m.cpu[0] as f64, m.cpu[1].max(m.cpu[0]) as f64)
                    };
                    let (a, b) = (a - origin, b - origin);
                    intervals[n] = [a / 1e6, b / 1e6];
                    self.passes.push(PassRow {
                        name: m.name,
                        session: Some(m.session),
                        start_ns: a,
                        end_ns: b,
                        charged_ms: 0.0,
                        stub: None,
                    });
                    n += 1;
                }
            }
            let gpu_ms = if self.plants.sums_pass_intervals {
                intervals[..n].iter().map(|[a, b]| b - a).sum()
            } else {
                meter::covered(&intervals[..n])
            };
            meter::charges(&intervals[..n], &mut charges[..n]);
            for c in charged.iter_mut() {
                *c = (0.0, 0.0);
            }
            for (j, row) in self.passes[passes_start..].iter_mut().enumerate() {
                row.charged_ms = charges[j];
                match row.stub {
                    Some((k, i)) => {
                        let st = self
                            .args
                            .stub
                            .as_ref()
                            .expect("stub rows come from the stub");
                        let iv = &st.passes[k].2[i];
                        if iv.shares.is_empty() {
                            if let Some(s) = row.session {
                                charged[s % 64].0 += charges[j];
                            }
                        } else {
                            for (w, share) in &iv.shares {
                                if let Some(s) = self
                                    .sessions
                                    .iter()
                                    .position(|x| x.writer == *w && x.state == State::Live)
                                {
                                    charged[s % 64].0 += charges[j] * share;
                                }
                            }
                        }
                    }
                    None => {
                        if let Some(s) = row.session {
                            charged[s % 64].0 += charges[j];
                        }
                    }
                }
            }
            for v in &mut self.views[views_start..views_end] {
                charged[v.session % 64].1 = v.cpu;
            }

            // The meter: each writer's charges and the operator meter, the app's one budget
            // across every window, then each layer's ladder.
            for v in views_start..views_end {
                let s = self.views[v].session;
                let (mut gpu, mut cpu) = charged[s % 64];
                if !self.views[v].drawn {
                    (gpu, cpu) = (0.0, 0.0);
                }
                if let Some((g, c)) = self.stub_charge(&self.sessions[s].writer, frame) {
                    (gpu, cpu) = (g, c);
                }
                let factor = self.operator_factor(s, &charges[..n], passes_start);
                self.views[v].gpu = gpu;
                self.views[v].cpu = cpu;
                let ses = &mut self.sessions[s];
                ses.ring.push(gpu);
                if self.plants.allocates_per_frame {
                    self.planted_log.push(vec![gpu]);
                }
                // The operator meter: an effect measured at more than twice its declaration
                // for 30 frames runs at half resolution in the live view.
                if let Some(f) = factor {
                    ses.over_ops = if f > 2.0 { ses.over_ops + 1 } else { 0 };
                    if ses.over_ops >= meter::DOWN_AFTER {
                        ses.ops_resolution = 0.5;
                    }
                }
            }
            // The app's frame is every window's views; its limit the loosest class among them
            // (none if one has none), so no writer is held to a tighter class's share of the app.
            let costly = {
                let (views, sessions) = (&self.views[views_start..views_end], &self.sessions);
                let limit = views
                    .iter()
                    .map(|v| sessions[v.session].limits().gpu_ms)
                    .reduce(|a, b| Some(a?.max(b?)))
                    .flatten();
                self.app.frame(
                    views
                        .iter()
                        .map(|v| (v.session, sessions[v.session].window, v.gpu)),
                    limit,
                )
            };
            let app_over = self.app.last_over;
            let mut stepped_for_health = false;
            for v in views_start..views_end {
                let (s, gpu, cpu) = (self.views[v].session, self.views[v].gpu, self.views[v].cpu);
                let limits = self.sessions[s].limits();
                if let Some(step) = self.sessions[s].ladder.frame(gpu, cpu, &limits, app_over) {
                    stepped_for_health = true;
                    let scope = (step.reason == Reason::FrameHealth).then_some("writer");
                    self.decide(frame, s, step, scope);
                }
            }
            if stepped_for_health && self.plants.steps_every_writer {
                for v in views_start..views_end {
                    let s = self.views[v].session;
                    if self
                        .changes
                        .last()
                        .is_some_and(|c| c.frame == frame && c.session == s)
                    {
                        continue;
                    }
                    if let Some(step) = self.sessions[s].ladder.step_down(Reason::FrameHealth) {
                        self.decide(frame, s, step, Some("writer"));
                    }
                }
            }
            for s in 0..self.sessions.len() {
                if std::mem::take(&mut self.sessions[s].view_changed) {
                    self.sessions[s].ladder.view_changed();
                }
            }
            for r in 0..self.args.battery.len() {
                let (at, percent, discharging) = self.args.battery[r];
                if at != frame {
                    continue;
                }
                for s in 0..self.sessions.len() {
                    if self.sessions[s].state != State::Live {
                        continue;
                    }
                    if let Some(step) = self.sessions[s].ladder.battery(percent, discharging) {
                        self.decide(frame, s, step, None);
                    }
                }
            }
            // The app's budget steps down its costly writer, in whichever window it draws; any
            // rung change this frame restarts its count instead.
            let moved = self
                .changes
                .iter()
                .rev()
                .take_while(|c| c.frame == frame)
                .any(|c| c.step.from.is_some());
            if moved {
                self.app.restart();
            } else if let Some(s) = costly {
                if let Some(step) = self.sessions[s].ladder.health_step() {
                    self.decide(frame, s, step, Some("app"));
                }
            }
            let allocs = counting.then(deep_gpu::alloc::stop);

            // What the frame reports beyond its views and passes.
            let mut extra = Map::new();
            if self.args.reports.hashes {
                let mut hashes = Map::new();
                for v in &self.views[views_start..views_end] {
                    let hash = (!self.noop && v.drawn)
                        .then(|| self.sessions[v.session].view.as_ref()?.pixels())
                        .flatten()
                        .map(|b| hex(&b));
                    hashes.insert(v.session.to_string(), json!(hash));
                }
                extra.insert("hashes".into(), Value::Object(hashes));
            }
            if self.args.reports.memory {
                extra.insert("memory".into(), self.memory());
            }
            for &(s, purpose, of, size) in &canonical_queue {
                let c = self.canonical_event(s, purpose, of, size, frame);
                self.canonicals.push(c);
            }
            self.frames.push(FrameRow {
                frame,
                gpu_ms,
                cpu_ms,
                views: (views_start, views_end),
                passes: (passes_start, self.passes.len()),
                allocs,
                extra,
            });
        }
        self.reply(device_before)
    }

    /// The writers' counts, the cache and the device, after the frame's queue drained.
    fn memory(&self) -> Value {
        let mut writers: BTreeMap<&str, (u64, Vec<Value>)> = BTreeMap::new();
        for s in self.sessions.iter().filter(|s| s.state == State::Live) {
            let e = writers.entry(s.writer.as_str()).or_insert((0, Vec::new()));
            e.0 += s.view.as_ref().and_then(View::own_bytes).unwrap_or(0);
        }
        for (writer, e) in writers.iter_mut() {
            for (key, bytes) in self.results.charged(writer) {
                e.0 += bytes.unwrap_or(0);
                e.1.push(json!({"key": key, "bytes": bytes.unwrap_or(0)}));
            }
        }
        let (entries, bytes) = self.results.totals();
        json!({
            "writers": writers.into_iter().map(|(w, (count, results))| json!({"writer": w, "count_bytes": count, "results": results})).collect::<Vec<_>>(),
            "cache": {"entries": entries, "bytes": bytes.unwrap_or(0)},
            "device_bytes": memory::allocated(&self.device),
        })
    }

    /// A canonical render of the session's current revision at `of`, asked after `frame`: on its
    /// own state at the class's base rung, unless the planted worker reads the live meter.
    fn canonical_event(
        &mut self,
        s: usize,
        purpose: Purpose,
        of: u64,
        size: [u32; 2],
        frame: u64,
    ) -> Value {
        let ses = &self.sessions[s];
        let Some(rev) = ses.current.as_ref() else {
            return refused("no_revision", "the session has no current revision");
        };
        let live = self
            .plants
            .shares_meter_with_worker
            .then_some((ses.drawn, ses.ops_resolution));
        let mut c = render_canonical(
            &self.device,
            &self.kit,
            &self.args.look,
            &rev.doc,
            size,
            self.t(of),
            purpose,
            live,
            &self.args.assets,
            &mut self.labels,
        );
        if let Some(o) = c.as_object_mut() {
            o.insert("frame".into(), json!(frame));
            o.insert("session".into(), json!(ses.id));
        }
        c
    }

    fn reply(self, device_before: Option<u64>) -> Value {
        let sessions = &self.sessions;
        let source = if self.device.timestamps.query {
            "timestamps"
        } else {
            "cpu_encode"
        };
        let frames: Vec<Value> = self
            .frames
            .iter()
            .map(|f| {
                let views: Vec<Value> = self.views[f.views.0..f.views.1]
                    .iter()
                    .map(|v| {
                        let ses = &sessions[v.session];
                        let mut o = json!({
                            "session": ses.id, "writer": ses.writer, "window": self.args.windows[ses.window],
                            "rung": v.rung.unwrap_or(Rung::Base).name(),
                            "drawn": v.drawn, "charged_gpu_ms": v.gpu, "charged_cpu_ms": v.cpu,
                            "internal_scale": v.scale, "history_frames": v.history,
                        });
                        if let Some(h) = f.extra.get("hashes") {
                            o["pixel_hash"] = h.get(v.session.to_string()).cloned().unwrap_or(Value::Null);
                        }
                        o
                    })
                    .collect();
                let mut o = json!({
                    "frame": f.frame, "gpu_ms": f.gpu_ms, "cpu_ms": f.cpu_ms,
                    "gpu_source": source,
                    "views": views,
                });
                if self.args.reports.passes {
                    let passes: Vec<Value> = self.passes[f.passes.0..f.passes.1]
                        .iter()
                        .map(|p| {
                            let mut name = p.name.to_string();
                            let mut shares = Value::Null;
                            if let Some((k, i)) = p.stub {
                                let iv = &self.args.stub.as_ref().expect("stub rows").passes[k].2[i];
                                name = iv.name.clone();
                                if !iv.shares.is_empty() {
                                    shares = json!(iv.shares.iter().map(|(w, s)| json!({"writer": w, "share": s, "charged_ms": p.charged_ms * s})).collect::<Vec<_>>());
                                }
                            }
                            let mut o = json!({
                                "name": name, "session": p.session.map(|s| sessions[s].id.clone()), "source": source,
                                "start_ns": p.start_ns, "end_ns": p.end_ns, "charged_ms": p.charged_ms,
                            });
                            if !shares.is_null() {
                                o["shares"] = shares;
                            }
                            o
                        })
                        .collect();
                    o["passes"] = json!(passes);
                }
                if let Some(m) = f.extra.get("memory") {
                    for k in ["writers", "cache", "device_bytes"] {
                        o[k] = m[k].clone();
                    }
                }
                if let Some(a) = f.allocs {
                    o["allocs"] = json!(a);
                }
                o
            })
            .collect();
        let changes: Vec<Value> = self
            .changes
            .iter()
            .map(|c| {
                let ses = &sessions[c.session];
                json!({
                    "frame": c.frame, "session": ses.id, "writer": ses.writer,
                    "from": c.step.from.map(Rung::name), "to": c.step.to.name(), "reason": c.step.reason.name(),
                    "pipelines": c.pipelines, "compiled_by": c.compiled_by, "thread": c.thread,
                    "ui_thread": UI_THREAD, "effective": c.effective,
                })
            })
            .collect();
        // Every rung change is told to its writer, with why (on the planted ladder, only its
        // initial rung and first step).
        let told: Vec<Value> = self
            .changes
            .iter()
            .filter(|c| {
                !self.plants.tells_first_step_only
                    || c.step.from.is_none()
                    || !self.changes.iter().any(|e| {
                        e.session == c.session && e.step.from.is_some() && e.frame < c.frame
                    })
            })
            .map(|c| {
                let ses = &sessions[c.session];
                json!({
                    "frame": c.frame, "session": ses.id, "writer": ses.writer,
                    "rung": c.step.to.name(), "reason": c.step.reason.name(), "scope": c.scope,
                })
            })
            .collect();
        let session_rows: Vec<Value> = sessions
            .iter()
            .map(|s| {
                json!({
                    "session": s.id, "writer": s.writer,
                    "state": match s.state { State::Live => "live", State::Refused => "refused", State::Closed => "closed" },
                    "class": s.class().map(Class::name), "issues": s.issues,
                    "revisions": s.revisions.iter().map(|(n, o, i)| {
                        let mut r = json!({"rev": n, "outcome": o, "issues": i});
                        if let Some((ms, pipelines)) = s.settled.get(n) {
                            r["settled_ms"] = json!(ms);
                            r["pipelines"] = json!(pipelines);
                        }
                        r
                    }).collect::<Vec<_>>(),
                })
            })
            .collect();
        let mut out = json!({
            "frames": frames, "changes": changes, "told": told, "sessions": session_rows, "canonicals": self.canonicals,
            // #140: the GPU seam's backend that drew the frames.
            "backends": {"gpu": deep_gpu::seam::BACKEND.json()},
            "device_before": device_before,
        });
        if self.args.reports.meter {
            let mut rows: Vec<Value> = sessions
                .iter()
                .filter(|s| s.state == State::Live)
                .map(|s| {
                    let l = s.limits();
                    let fit = s.current.as_ref().map(|r| r.fit).unwrap_or_default();
                    json!({
                        "scope": "writer", "writer": s.writer, "session": s.id,
                        "rung": s.ladder.rung().name(), "reason": s.ladder.reason().name(),
                        "limits": {"gpu_ms": l.gpu_ms, "cpu_ms": l.cpu_ms, "gpu_bytes": l.gpu_bytes},
                        "estimate": {
                            "gpu_bytes": fit.bytes(), "internal_scale": fit.scale, "history_frames": fit.history,
                            "parts": {"slots": fit.slots, "hdr_slots": fit.hdr_slots, "targets": fit.targets, "upscale": fit.upscale, "frame_history": fit.frame_history, "effects": fit.effects},
                        },
                        "measured": s.ring.oldest_first().collect::<Vec<_>>(),
                    })
                })
                .collect();
            if self.args.named {
                rows.push(json!({
                    "scope": "app",
                    "windows": self.args.windows,
                    "limits": {"gpu_ms": self.app.limit},
                    "measured": self.app.ring.oldest_first().collect::<Vec<_>>(),
                }));
            }
            out["meter"] = json!(rows);
        }
        out
    }
}

fn hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// One canonical render of a stamped document at `t`: a fresh view of one slot, its own results,
/// no history, at the class's base rung with every operator at full resolution; `live` is the
/// planted worker's live rung and operator resolution.
#[allow(clippy::too_many_arguments)]
fn render_canonical(
    device: &Arc<Device>,
    kit: &Kit,
    look: &Look3,
    doc: &Value,
    size: [u32; 2],
    t: i64,
    purpose: Purpose,
    live: Option<(Rung, f64)>,
    assets: &BTreeMap<String, PathBuf>,
    labels: &mut Labels,
) -> Value {
    let _ = assets;
    let mut doc = doc.clone();
    doc["size"] = json!(size);
    let frames = match Frames::new(&doc, look, labels) {
        Ok(f) => f,
        Err(r) => return refused(r.code, r.path),
    };
    let mut view = match View::new(device, Path::Copy, size, 1, frames, 1.0, 0, look, labels) {
        Ok(v) => v,
        Err(e) => return refused("no_view", e),
    };
    #[cfg(feature = "test-meter")]
    let mut results: Cache<crate::testgpu::Made> = Cache::new(cache::Planted::default());
    #[cfg(feature = "test-meter")]
    {
        let (placed, loops) = crate::testgpu::items(&doc).unwrap_or_default();
        let reader = Reader {
            revision: 0,
            writer: "canonical".into(),
        };
        for p in &placed {
            if let Err(e) = results.read(&p.key, &reader, || kit.test.make(device, &p.need, assets))
            {
                return refused("asset_unreadable", e);
            }
        }
        view.test.set(device, kit, &placed, loops, &results);
    }
    let (rung, resolution) = live.unwrap_or((Rung::Base, 1.0));
    let drawing = Drawing {
        rung,
        offsets: Offsets::default(),
        effects_resolution: resolution,
        canonical: live.is_none(),
    };
    let mut timer = Timer::new(device);
    timer.begin_frame();
    let mut encoder = device.device.create_command_encoder(&Default::default());
    if let Err(r) = view.draw(
        device,
        kit,
        look,
        t,
        &drawing,
        labels,
        &mut encoder,
        &mut timer,
        0,
    ) {
        return refused(r.code, r.path);
    }
    device.queue.submit([encoder.finish()]);
    memory::drain(device);
    let pixels = (device.backend != Backend::Noop)
        .then(|| view.pixels())
        .flatten();
    let mut operators: Vec<Value> = Vec::new();
    let mut seen = BTreeSet::new();
    for m in &timer.marks[..timer.n] {
        if seen.insert(m.name) {
            let res = if m.name == "test.burn" {
                resolution
            } else {
                1.0
            };
            operators.push(json!({"operator": m.name, "resolution": res}));
        }
    }
    json!({
        "purpose": purpose.name(),
        "pixel_hash": pixels.map(|p| hex(&p)),
        "rung": rung.name(),
        "internal_scale": if live.is_some() { rung.scale(1.0) } else { 1.0 },
        "operators": operators,
    })
}

/// The `canonical` call: the same render a `canonical` event makes, in a process with no live
/// session.
pub fn canonical(app: &mut App, call: &Value) -> Value {
    let bad = |what: &str| refused("bad_input", what);
    let (Some(writer), Some(doc), Some(size), Some(frame), Some(purpose)) = (
        call["writer"].as_str().map(str::to_string),
        call["doc"].as_str().map(PathBuf::from),
        pair(&call["size"]),
        call["frame"].as_u64(),
        call["purpose"].as_str().and_then(Purpose::parse),
    ) else {
        return bad("canonical is {look, writer, doc, size, frame, purpose}");
    };
    let look = match Look3::read(&call["look"]) {
        Ok(l) => l,
        Err(e) => return bad(&format!("look: {e}")),
    };
    let fps = call["fps"].as_u64().unwrap_or(60).max(1) as i64;
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let mut labels = Labels::new();
        let admitted = admit(
            &doc,
            &writer,
            "01jb3790000000000000000000",
            Some(size),
            &look,
            0,
            &mut labels,
        );
        let doc = match admitted {
            Ok(a) => a.doc,
            Err(issues) => return json!({"code": "refused", "issues": issues}),
        };
        let kit = Kit::new(&device);
        let t = (frame as i64 - 1) * FLICKS_PER_SECOND / fps;
        let mut c = render_canonical(
            &device,
            &kit,
            &look,
            &doc,
            size,
            t,
            purpose,
            None,
            &BTreeMap::new(),
            &mut labels,
        );
        if let Some(o) = c.as_object_mut() {
            o.insert("frame".into(), json!(frame));
        }
        c
    })
}
