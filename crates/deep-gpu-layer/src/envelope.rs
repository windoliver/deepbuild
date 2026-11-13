//! The frame budget's combined envelope (issue #1903; tests/acceptance/1903/README.md; canvas
//! primitives: Frame budget, `envelope`). The `envelope` call plays each fixture as the
//! `frame_budget` run does, on the GPU worker, at its class's base rung: the every-pass scene,
//! and `separate-items` with its instanced twin. Each fixture's frame time is judged against its
//! class by #1899's five-run rule, its passes named, and its GPU memory against the class's cap;
//! input on screen is read per input, from its arrival to the presentation time the display seam
//! reports for the first frame that reads it. Readings with no limit yet (p99 frame time, seek
//! rebuild, each process's peak memory, export throughput, the first frame wait and
//! `separate-items`' ratio to its twin) are a calibration baseline kept per device in the call's
//! store: the first run that measures one on a reference Mac asks once for its limit, the metric
//! is BLOCKED until you set one through `decide`, and a Mac measured later adds a reading. The
//! `envelope_counts` call counts what the device creates and uploads frame by frame on the noop
//! lane. The test build's stubs stand in for the device's timestamps, the display seam, the
//! process readings, this machine's environment and a slow pipeline.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write as _;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Instant;

use deep_canvas::budget::Limits;
use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Labels;
use deep_effects_render::docops::{item_of_mark, DocOps};
use deep_gpu::counted::Reading;
use deep_gpu::device::{Backend, Device};
use deep_gpu::frame_budget::{judge, reading, run_p95, Invalid, RunP95, Verdict};
use deep_gpu::memory;
use deep_gpu::meter::{self, Rung};
use deep_gpu::surface::Path;
use serde_json::{json, Map, Value};

use crate::budget::{is_reference, this_machine};
use crate::live::{admit, pair, read_payload, Admitted, Plants};
use crate::liveview::{compile_upscale, Drawing, Kit, Timer, View, SLOTS};
use crate::{refused, App, Planted};

const FLICKS_PER_SECOND: f64 = 705_600_000.0;
const RUNS: usize = 5;
const DOC_ID: &str = "01jb3790000000000000000000";
const SCENE: &str = "scene";
const SEPARATE: &str = "separate-items";
const INSTANCED: &str = "separate-items/instanced";
/// Input on screen's limit, in frames at the display's rate.
const INPUT_FRAMES: f64 = 2.0;
/// The calibration metrics, in the reply's order: name, unit and whether lower is better.
const METRICS: [(&str, &str, bool); 8] = [
    ("frame_time_p99", "ms", true),
    ("seek_rebuild", "ms", true),
    ("peak_memory/app", "bytes", true),
    ("peak_memory/decode_worker", "bytes", true),
    ("export_throughput", "x", false),
    ("first_frame_wait/fresh", "ms", true),
    ("first_frame_wait/same_process", "ms", true),
    ("separate_items_ratio", "ratio", true),
];
const STORE: &str = "envelope.json";

/// A fixture's stub: its frames' GPU time as a whole or by the items whose passes run.
struct FixtureStub {
    gpu_ms: Option<f64>,
    passes: BTreeMap<String, f64>,
    cpu_ms: f64,
    gpu_bytes: u64,
}

/// The test meter: each fixture's frames and the process readings.
struct Stub {
    fixtures: BTreeMap<String, FixtureStub>,
    seek_ms: f64,
    app_bytes: f64,
    worker_bytes: f64,
    export_x: f64,
}

struct Args {
    look: Look3,
    writer: String,
    store: PathBuf,
    scene: PathBuf,
    separate: Option<(PathBuf, PathBuf)>,
    size: [u32; 2],
    seconds: f64,
    warmup: u64,
    inputs: Option<(String, Vec<i64>)>,
    wait: bool,
    report_frames: bool,
    report_inputs: bool,
    stub: Option<Stub>,
    display: Option<f64>,
    environment: Option<Value>,
    delay_ms: Option<u64>,
}

fn bad(what: &str) -> Value {
    refused("bad_input", what)
}

/// A field only the test build holds.
fn test_only<'a>(call: &'a Value, key: &str) -> Result<Option<&'a Value>, Value> {
    match call.get(key) {
        Some(_) if !cfg!(feature = "test-meter") => Err(bad(&format!("{key} is a test build's"))),
        v => Ok(v),
    }
}

fn stub_of(s: &Value) -> Option<Stub> {
    let mut fixtures = BTreeMap::new();
    for (name, f) in s["fixtures"].as_object()? {
        let passes: BTreeMap<String, f64> = match f.get("passes") {
            None => BTreeMap::new(),
            Some(p) => p
                .as_object()?
                .iter()
                .map(|(k, v)| Some((k.clone(), v.as_f64()?)))
                .collect::<Option<_>>()?,
        };
        let gpu_ms = f["gpu_ms"].as_f64();
        if gpu_ms.is_some() == f.get("passes").is_some() {
            return None;
        }
        fixtures.insert(
            name.clone(),
            FixtureStub {
                gpu_ms,
                passes,
                cpu_ms: f["cpu_ms"].as_f64().unwrap_or(0.0),
                gpu_bytes: f["gpu_bytes"].as_u64()?,
            },
        );
    }
    Some(Stub {
        fixtures,
        seek_ms: s["seek_rebuild_ms"].as_f64()?,
        app_bytes: s["peak_bytes"]["app"].as_f64()?,
        worker_bytes: s["peak_bytes"]["decode_worker"].as_f64()?,
        export_x: s["export_x"].as_f64()?,
    })
}

fn parse(call: &Value) -> Result<Args, Value> {
    let (Some(writer), Some(store), Some(scene), Some(size), Some(seconds)) = (
        call["writer"].as_str(),
        call["store"].as_str(),
        call["scene"].as_str(),
        pair(&call["render"]["pixels"]),
        call["render"]["seconds"].as_f64().filter(|s| *s > 0.0),
    ) else {
        return Err(bad(
            "envelope is {look, writer, store, scene, render: {seconds, pixels}}",
        ));
    };
    let look = Look3::read(&call["look"]).map_err(|e| bad(&format!("look: {e}")))?;
    let separate = match call.get("separate_items") {
        None => None,
        Some(s) => match (s["doc"].as_str(), s["instanced"].as_str()) {
            (Some(d), Some(i)) => Some((PathBuf::from(d), PathBuf::from(i))),
            _ => return Err(bad("separate_items is {doc, instanced}")),
        },
    };
    let inputs = match call.get("inputs") {
        None => None,
        Some(i) => {
            let at: Option<Vec<i64>> = i["at_ns"]
                .as_array()
                .map(|a| a.iter().map(Value::as_i64).collect())
                .and_then(|v: Option<Vec<i64>>| v);
            match (i["control"].as_str(), at) {
                (Some(c), Some(at)) => Some((c.to_string(), at)),
                _ => return Err(bad("inputs is {control, at_ns: [ns]}")),
            }
        }
    };
    let (mut report_frames, mut report_inputs) = (false, false);
    for r in call["report"].as_array().into_iter().flatten() {
        match r.as_str() {
            Some("frames") => report_frames = true,
            Some("inputs") => report_inputs = true,
            _ => return Err(bad("report holds frames and inputs")),
        }
    }
    let stub = match test_only(call, "stub_meter")? {
        None => None,
        Some(s) => Some(stub_of(s).ok_or_else(|| bad("stub_meter"))?),
    };
    let display = match test_only(call, "stub_display")? {
        None => None,
        Some(d) => Some(
            d["rate_hz"]
                .as_f64()
                .filter(|r| *r > 0.0)
                .ok_or_else(|| bad("stub_display is {rate_hz}"))?,
        ),
    };
    Ok(Args {
        look,
        writer: writer.to_string(),
        store: PathBuf::from(store),
        scene: PathBuf::from(scene),
        separate,
        size,
        seconds,
        warmup: call["warmup"].as_u64().unwrap_or(60),
        inputs,
        wait: call["first_frame_wait"].as_bool().unwrap_or(false),
        report_frames,
        report_inputs,
        stub,
        display,
        environment: test_only(call, "stub_environment")?.cloned(),
        delay_ms: test_only(call, "stub_pipeline_delay_ms")?.and_then(Value::as_u64),
    })
}

/// The display seam's times on a run's clock: frame k latches at its refresh, and is shown at
/// the first refresh after its encode ends; the planted held path shows it one slot later.
#[derive(Clone, Copy)]
struct Display {
    rate: f64,
    held: bool,
}

impl Display {
    fn latch(self, k: u64) -> i64 {
        (k as f64 * 1e9 / self.rate).round() as i64
    }

    fn presented(self, k: u64, encoded: i64) -> i64 {
        let mut j = k + 1;
        while self.latch(j) <= encoded {
            j += 1;
        }
        self.latch(j + u64::from(self.held))
    }

    /// The first frame that reads an input arriving at `at`: the first to latch at or after it,
    /// or on the held path the frame after that.
    fn reader(self, at: i64) -> u64 {
        let mut k = (at.max(0) as f64 * self.rate / 1e9).ceil() as u64;
        while self.latch(k) < at {
            k += 1;
        }
        while k > 0 && self.latch(k - 1) >= at {
            k -= 1;
        }
        k + u64::from(self.held)
    }
}

/// One frame a fixture drew.
struct Drawn {
    gpu: Option<Result<f64, Invalid>>,
    /// Each pass the frame ran: the item whose operator runs it, its name, its own GPU time.
    passes: Vec<(Option<String>, &'static str, Option<f64>)>,
}

/// A fixture's play: its frames by run (the warm-up first), its class's limits, its peak GPU
/// memory, and the scene's seek.
struct Played {
    runs: Vec<Vec<Drawn>>,
    limits: Limits,
    peak_bytes: Option<u64>,
    /// The check's estimate of the view's GPU memory (#2189).
    estimate_bytes: u64,
    seek_ms: Option<f64>,
    /// #173: the window's bytes on the device, its frames, and those the seek rendered.
    history: Option<(Option<u64>, u32, u32)>,
    log: Vec<Value>,
    inputs: Vec<Value>,
    input_p95s: Vec<Option<f64>>,
}

/// The check of `path` as the writer's revision, with its warm-up.
fn checked(
    path: &PathBuf,
    args_look: &Look3,
    writer: &str,
    size: Option<[u32; 2]>,
    labels: &mut Labels,
    plants: &Plants,
    planted: Option<Planted>,
) -> Result<(Value, Admitted), Value> {
    let raw = read_payload(path).map_err(|issues| json!({"code": "refused", "issues": issues}))?;
    let window = if args_look.history.on() {
        args_look.history.window
    } else {
        0
    };
    let a = admit(
        raw.clone(),
        writer,
        DOC_ID,
        size,
        args_look,
        window,
        Path::Copy,
        labels,
        Some((&raw, plants)),
        planted,
    )
    .map_err(|issues| json!({"code": "refused", "issues": issues}))?;
    Ok((raw, a))
}

/// The revision's view, opened at check with its warm-up compiled, as the app's window opens it:
/// its slots, and the internal scale and history window its class's memory fits, with the
/// upscale's pipelines when that scale is below 1.
fn opened(
    device: &Device,
    kit: &mut Kit,
    look: &Look3,
    a: Admitted,
    labels: &mut Labels,
    plants: &Plants,
    planted: Option<Planted>,
) -> Result<View, Value> {
    let Admitted {
        doc,
        frames,
        size,
        warm,
        fit,
        ..
    } = a;
    let mut view = View::new(
        device,
        Path::Copy,
        size,
        SLOTS,
        frames,
        fit.scale,
        fit.history,
        look,
        labels,
        crate::session3::msaa_planted(planted),
        true,
    )
    .map_err(|e| refused("no_view", e))?;
    if view.scale < 1.0 && kit.upscale.is_none() {
        kit.upscale = Some(Arc::new(compile_upscale(device)));
    }
    view.warm(device, look, &warm.scenes);
    let (options, check) = plants.ops;
    view.ops = DocOps::new(device, &doc, options, check, &[]);
    view.want_targets(&doc, plants.builds_unread_targets);
    #[cfg(feature = "test-meter")]
    {
        let mut results = deep_gpu::cache::Cache::new(deep_gpu::cache::Planted::default());
        let (placed, burns) = crate::testgpu::items(&doc).unwrap_or_default();
        let reader = deep_gpu::cache::Reader {
            revision: 0,
            writer: "envelope".into(),
        };
        for p in &placed {
            results
                .read(&p.key, &reader, || {
                    kit.test.make(device, &p.need, &BTreeMap::new(), &p.key)
                })
                .map_err(|e| refused("asset_unreadable", e))?;
        }
        view.test.set(device, kit, &placed, &burns, &results);
    }
    #[cfg(not(feature = "test-meter"))]
    let _ = kit;
    Ok(view)
}

/// How the envelope draws: live, at the class's base rung, never stepping.
fn drawing() -> Drawing {
    Drawing {
        rung: Rung::Base,
        offsets: Offsets::default(),
        effects_resolution: 1.0,
        canonical: false,
        settles: false,
    }
}

/// Draws one frame at `t` and waits for the device: the encode's CPU time.
fn draw(
    device: &Device,
    kit: &Kit,
    look: &Look3,
    view: &mut View,
    t: i64,
    labels: &mut Labels,
    timer: &mut Timer,
) -> Result<(f64, bool), Value> {
    timer.begin_frame();
    let began = Instant::now();
    let mut encoder = device.device.create_command_encoder(&Default::default());
    view.draw(
        device,
        kit,
        look,
        t,
        &drawing(),
        labels,
        &mut encoder,
        timer,
        0,
    )
    .map_err(|r| refused(r.code, r.path))?;
    timer.resolve(&mut encoder);
    let cpu = began.elapsed().as_secs_f64() * 1e3;
    device.queue.submit([encoder.finish()]);
    memory::drain(device);
    Ok((cpu, timer.read(device)))
}

/// Each pass the frame ran, by name and the item whose operator runs it: an `op.` pass is its
/// operator item's, and the test burns record in their items' order.
fn passes_of(view: &View, timer: &Timer) -> Vec<(Option<String>, &'static str)> {
    #[cfg(feature = "test-meter")]
    let mut burns = view.test.burn_items();
    #[cfg(not(feature = "test-meter"))]
    let _ = view;
    timer.marks[..timer.n]
        .iter()
        .map(|m| {
            #[cfg(feature = "test-meter")]
            if m.name == deep_canvas_test_modules::TEST_BURN {
                return (burns.next().map(str::to_string), m.name);
            }
            (item_of_mark(m.name).map(str::to_string), m.name)
        })
        .collect()
}

/// The inputs of one run of the scene: each one's index, arrival and the frame that reads it.
struct Inputs<'a> {
    control: &'a str,
    raw: &'a Value,
    arrivals: Vec<(usize, i64, u64)>,
}

#[allow(clippy::too_many_arguments)]
fn play(
    device: &Device,
    args: &Args,
    fixture: &str,
    path: &PathBuf,
    labels: &mut Labels,
    plants: &Plants,
    planted: Option<Planted>,
    display: Option<Display>,
) -> Result<Played, Value> {
    let stub = match &args.stub {
        Some(s) => Some(
            s.fixtures
                .get(fixture)
                .ok_or_else(|| bad(&format!("stub_meter has no {fixture}")))?,
        ),
        None => None,
    };
    let (raw, a) = checked(
        path,
        &args.look,
        &args.writer,
        Some(args.size),
        labels,
        plants,
        planted,
    )?;
    let limits = a.limits;
    let estimate_bytes = a.fit.bytes();
    let window = a.fit.history;
    let mut kit = Kit::new(device);
    let mut view = opened(device, &mut kit, &args.look, a, labels, plants, planted)?;
    let mut timer = Timer::new(device);
    let rate = display.map_or(60.0, |d| d.rate);
    // Frame history beside every other pass (#173), its grid a frame of the play.
    view.hold_history(&args.look, window, rate.round() as u32, 0)
        .map_err(|e| refused("bad_input", format!("look: {e}")))?;
    let clock = display.unwrap_or(Display { rate, held: false });
    let per_run = (args.seconds * rate).round().max(1.0) as u64;
    let alone = planted == Some(Planted::TimesEachPassAlone);
    let at_encode = planted == Some(Planted::HeldInputMeterAtEncode);
    let inputs = match (&args.inputs, display) {
        (Some((control, at)), Some(d)) if fixture == SCENE => Some(Inputs {
            control,
            raw: &raw,
            arrivals: at
                .iter()
                .enumerate()
                .map(|(i, &t)| (i, t, d.reader(t)))
                .collect(),
        }),
        _ => None,
    };
    let mut intervals = vec![[0.0f64; 2]; meter::MAX_PASSES];
    let mut played = Played {
        runs: Vec::with_capacity(RUNS + 1),
        limits,
        peak_bytes: stub.map(|s| s.gpu_bytes),
        estimate_bytes,
        seek_ms: None,
        history: None,
        log: Vec::new(),
        inputs: Vec::new(),
        input_p95s: Vec::new(),
    };
    let mut peak: Option<u64> = Some(0);
    for run in 0..=RUNS as u64 {
        let timed = run > 0;
        let n = if timed { per_run } else { args.warmup };
        let mut rows = Vec::with_capacity(n as usize);
        let mut next = 0;
        let mut encoded_at = Vec::with_capacity(n as usize);
        let mut presented_at = Vec::with_capacity(n as usize);
        for k in 0..n {
            // An input is read by the first frame whose latch takes it: its control's value, as
            // the writer `you`'s entry on the input track, drawn from this frame on.
            if let Some(i) = inputs.as_ref().filter(|_| timed) {
                let mut value = None;
                while next < i.arrivals.len() && i.arrivals[next].2 <= k {
                    value = Some(i.arrivals[next].0 % 2 == 0);
                    next += 1;
                }
                if let Some(v) = value {
                    let choices = BTreeMap::from([(i.control.to_string(), json!(v))]);
                    let payload = crate::warm::applied(i.raw, &choices);
                    let a = admit(
                        payload,
                        &args.writer,
                        DOC_ID,
                        Some(args.size),
                        &args.look,
                        0,
                        Path::Copy,
                        labels,
                        None,
                        planted,
                    )
                    .map_err(|issues| json!({"code": "refused", "issues": issues}))?;
                    view.set_frames(a.into_frames());
                }
            }
            let t = (k as f64 * FLICKS_PER_SECOND / rate).round() as i64;
            let (cpu, resolved) = draw(device, &kit, &args.look, &mut view, t, labels, &mut timer)?;
            let marks = passes_of(&view, &timer);
            let lost = device.is_lost();
            let (gpu, passes, cpu_ms) = match stub {
                Some(s) => {
                    let mut at = 0.0;
                    let mut passes = Vec::with_capacity(marks.len());
                    for (i, (item, name)) in marks.into_iter().enumerate() {
                        let ms = item
                            .as_ref()
                            .and_then(|id| s.passes.get(id))
                            .copied()
                            .unwrap_or(0.0);
                        intervals[i] = [at, at + ms];
                        at += ms;
                        passes.push((item, name, s.gpu_ms.is_none().then_some(ms)));
                    }
                    let covered = match s.gpu_ms {
                        Some(ms) => ms,
                        None if alone => passes.iter().filter_map(|p| p.2).fold(0.0, f64::max),
                        None => meter::covered(&intervals[..passes.len()]),
                    };
                    (Some(reading(lost, true, false, covered)), passes, s.cpu_ms)
                }
                None => {
                    let period = timer.period_ns().unwrap_or(1.0);
                    let mut reversed = false;
                    let mut passes = Vec::with_capacity(marks.len());
                    for (i, ((item, name), m)) in marks.into_iter().zip(&timer.marks).enumerate() {
                        reversed |= m.ticks[1] < m.ticks[0];
                        intervals[i] = [
                            m.ticks[0] as f64 * period / 1e6,
                            m.ticks[1] as f64 * period / 1e6,
                        ];
                        let own = timer.timed().then(|| intervals[i][1] - intervals[i][0]);
                        passes.push((item, name, own));
                    }
                    let covered = if alone {
                        passes.iter().filter_map(|p| p.2).fold(0.0, f64::max)
                    } else {
                        meter::covered(&intervals[..passes.len()])
                    };
                    let gpu = timer
                        .timed()
                        .then(|| reading(lost, resolved, reversed, covered));
                    peak = peak.zip(memory::allocated(device)).map(|(p, b)| p.max(b));
                    (gpu, passes, cpu)
                }
            };
            let latched = clock.latch(k);
            let encoded = latched + (cpu_ms * 1e6).round() as i64;
            let presented = display.map(|d| d.presented(k, encoded));
            encoded_at.push(encoded);
            presented_at.push(presented);
            if args.report_frames {
                played
                    .log
                    .push(json!({"fixture": fixture, "run": run, "frame": k,
                    "latched_ns": latched, "encoded_ns": encoded, "presented_ns": presented}));
            }
            rows.push(Drawn { gpu, passes });
        }
        // Each input's reading: from its arrival to the presentation of the frame that read it
        // (the planted meter stops at that frame's encode).
        if let Some(i) = inputs.as_ref().filter(|_| timed) {
            let mut readings = Vec::with_capacity(i.arrivals.len());
            for &(index, at, k) in &i.arrivals {
                let Some(Some(shown)) = presented_at.get(k as usize).copied() else {
                    readings.push(f64::INFINITY);
                    continue;
                };
                let end = if at_encode {
                    encoded_at[k as usize]
                } else {
                    shown
                };
                let ms = (end - at) as f64 / 1e6;
                readings.push(ms);
                if args.report_inputs {
                    played
                        .inputs
                        .push(json!({"run": run, "input": index, "arrived_ns": at,
                        "frame": k, "presented_ns": end, "ms": ms}));
                }
            }
            played.input_p95s.push(percentile(&readings, 0.95));
        }
        played.runs.push(rows);
    }
    if stub.is_none() {
        played.peak_bytes = peak;
        // The seek: the scene sought to the middle of its span, rebuilt, and presented; with
        // frame history, its window rendered again (#173).
        if fixture == SCENE {
            view.warm(device, &args.look, &[]);
            if let Some(h) = view.history.as_mut() {
                h.jump = true;
            }
            let t = (per_run as f64 / 2.0 * FLICKS_PER_SECOND / rate).round() as i64;
            let began = Instant::now();
            draw(device, &kit, &args.look, &mut view, t, labels, &mut timer)?;
            played.seek_ms = Some(began.elapsed().as_secs_f64() * 1e3);
            played.history = view.history.as_ref().map(|h| {
                let bytes = h.row().and_then(|r| r.2);
                (bytes, h.frames(), h.rendered)
            });
        }
    }
    Ok(played)
}

/// The nearest-rank percentile, `None` when it falls on an unread value.
fn percentile(values: &[f64], q: f64) -> Option<f64> {
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let rank = (q * v.len() as f64).ceil() as usize;
    v.get(rank.saturating_sub(1))
        .copied()
        .filter(|x| x.is_finite())
}

fn median(values: &[Option<f64>]) -> Option<f64> {
    let v: Option<Vec<f64>> = values.iter().copied().collect();
    percentile(&v?, 0.5)
}

fn worst<'a>(verdicts: impl IntoIterator<Item = &'a str>) -> &'static str {
    let seen: BTreeSet<&str> = verdicts.into_iter().collect();
    ["FAIL", "BLOCKED", "INCONCLUSIVE"]
        .into_iter()
        .find(|v| seen.contains(v))
        .unwrap_or("PASS")
}

/// Off a reference Mac's environment a PASS or FAIL is only a reading (`machines: same`).
fn same_machine(v: Verdict, reference: bool) -> Verdict {
    if !reference && matches!(v, Verdict::Pass | Verdict::Fail) {
        Verdict::Inconclusive
    } else {
        v
    }
}

/// A fixture's timed runs: each frame's GPU reading, and each run's p50, p95 and p99.
struct Timed {
    p95s: Vec<RunP95>,
    rows: Vec<Value>,
    p95: Vec<Option<f64>>,
    p99: Vec<Option<f64>>,
}

fn timed(p: &Played) -> Option<Timed> {
    let runs = &p.runs[1..];
    if !runs.iter().flatten().all(|d| d.gpu.is_some()) {
        return None;
    }
    let mut t = Timed {
        p95s: Vec::new(),
        rows: Vec::new(),
        p95: Vec::new(),
        p99: Vec::new(),
    };
    for run in runs {
        let frames: Vec<Result<f64, Invalid>> = run.iter().filter_map(|d| d.gpu).collect();
        let values: Vec<f64> = frames
            .iter()
            .map(|r| *r.as_ref().unwrap_or(&f64::INFINITY))
            .collect();
        let p95 = run_p95(&frames);
        let finite = |x: f64| x.is_finite().then_some(x);
        let (p50, p99) = (percentile(&values, 0.5), percentile(&values, 0.99));
        t.rows
            .push(json!({"p50_ms": p50, "p95_ms": finite(p95.over), "p99_ms": p99}));
        t.p95.push(finite(p95.over));
        t.p99.push(p99);
        t.p95s.push(p95);
    }
    Some(t)
}

/// A fixture's row: its frame time and GPU memory against its class.
fn fixture_row(name: &str, p: &Played, reference: bool) -> (Value, Option<Timed>) {
    let t = timed(p);
    let mut passes: BTreeMap<(Option<String>, &'static str), Vec<f64>> = BTreeMap::new();
    let mut unread: BTreeSet<(Option<String>, &'static str)> = BTreeSet::new();
    for d in p.runs[1..].iter().flatten() {
        for (item, pass, ms) in &d.passes {
            let key = (item.clone(), *pass);
            match ms {
                Some(ms) => passes.entry(key).or_default().push(*ms),
                None => {
                    unread.insert(key);
                }
            }
        }
    }
    let mut pass_rows: Vec<Value> = passes
        .iter()
        .map(|((item, name), ms)| json!({"item": item, "name": name, "p95_ms": percentile(ms, 0.95)}))
        .collect();
    pass_rows.extend(
        unread
            .iter()
            .filter(|k| !passes.contains_key(*k))
            .map(|(item, name)| json!({"item": item, "name": name, "p95_ms": null})),
    );
    let frame_time = p.limits.gpu_ms.map(|limit| match &t {
        None => json!({"limit_ms": limit, "verdict": "BLOCKED", "runs": [], "margin": null,
                       "passes": pass_rows, "missing": "timestamps"}),
        Some(t) => {
            let (v, margin) = judge(limit, &t.p95s);
            json!({"limit_ms": limit, "verdict": same_machine(v, reference).name(), "runs": t.rows,
                   "margin": margin, "passes": pass_rows})
        }
    });
    let gpu_memory = {
        let limit = p.limits.gpu_bytes;
        let v = match p.peak_bytes {
            None => Verdict::Blocked,
            Some(b) if b <= limit => Verdict::Pass,
            Some(_) => Verdict::Fail,
        };
        json!({"limit_bytes": limit, "verdict": same_machine(v, reference).name(), "peak_bytes": p.peak_bytes, "estimate_bytes": p.estimate_bytes,
               "history_bytes": p.history.and_then(|h| h.0)})
    };
    let verdict = worst([
        frame_time
            .as_ref()
            .map_or("BLOCKED", |f| f["verdict"].as_str().unwrap_or("BLOCKED")),
        gpu_memory["verdict"].as_str().unwrap_or("BLOCKED"),
    ]);
    (
        json!({"fixture": name, "verdict": verdict, "why": null, "frame_time": frame_time,
               "gpu_memory": gpu_memory}),
        t,
    )
}

/// Input on screen: each run's p95 against 2 frames at the display's rate, by the five-run rule.
fn input_row(args: &Args, scene: &Played, reference: bool) -> Value {
    let missing = if args.inputs.is_none() {
        Some("inputs")
    } else if args.display.is_none() {
        Some("presentation_times")
    } else {
        None
    };
    if let Some(m) = missing {
        return json!({"limit_frames": INPUT_FRAMES, "rate_hz": args.display, "limit_ms": null,
                      "verdict": "BLOCKED", "runs": [], "margin": null, "missing": m});
    }
    let rate = args.display.unwrap_or(60.0);
    let frame_ms = 1000.0 / rate;
    let limit = INPUT_FRAMES * frame_ms;
    let runs: Vec<Value> = scene
        .input_p95s
        .iter()
        .map(|p| json!({"p95_ms": p, "p95_frames": p.map(|ms| ms / frame_ms)}))
        .collect();
    let p95s: Vec<RunP95> = scene
        .input_p95s
        .iter()
        .map(|p| {
            let v = p.unwrap_or(f64::INFINITY);
            RunP95 { over: v, within: v }
        })
        .collect();
    let (v, margin) = judge(limit, &p95s);
    json!({"limit_frames": INPUT_FRAMES, "rate_hz": rate, "limit_ms": limit,
           "verdict": same_machine(v, reference).name(), "runs": runs, "margin": margin, "missing": null})
}

/// The envelope's store: each metric's baseline per device, the metrics asked, your limits.
#[derive(Default)]
struct Store {
    baselines: BTreeMap<String, Vec<(Value, f64)>>,
    asked: BTreeSet<String>,
    asks: u64,
    limits: BTreeMap<String, f64>,
}

impl Store {
    fn path(dir: &std::path::Path) -> PathBuf {
        dir.join(STORE)
    }

    fn read(dir: &std::path::Path) -> Store {
        let Ok(v) = std::fs::read(Store::path(dir))
            .map_err(|_| ())
            .and_then(|b| serde_json::from_slice::<Value>(&b).map_err(|_| ()))
        else {
            return Store::default();
        };
        Store {
            baselines: v["baselines"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(m, rows)| {
                    let rows = rows
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|r| Some((r["device"].clone(), r["value"].as_f64()?)))
                        .collect();
                    (m.clone(), rows)
                })
                .collect(),
            asked: v["asked"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m.as_str().map(str::to_string))
                .collect(),
            asks: v["asks"].as_u64().unwrap_or(0),
            limits: v["limits"]
                .as_object()
                .into_iter()
                .flatten()
                .filter_map(|(m, l)| Some((m.clone(), l.as_f64()?)))
                .collect(),
        }
    }

    fn write(&self, dir: &std::path::Path) -> Result<(), Value> {
        let baselines: Map<String, Value> = self
            .baselines
            .iter()
            .map(|(m, rows)| (m.clone(), baseline_json(rows)))
            .collect();
        let v = json!({"baselines": baselines, "asked": self.asked, "asks": self.asks,
                       "limits": self.limits});
        std::fs::create_dir_all(dir)
            .and_then(|()| {
                std::fs::write(
                    Store::path(dir),
                    serde_json::to_vec_pretty(&v).unwrap_or_default(),
                )
            })
            .map_err(|e| refused("not_written", e.to_string()))
    }
}

fn baseline_json(rows: &[(Value, f64)]) -> Value {
    rows.iter()
        .map(|(d, v)| json!({"device": d, "value": v}))
        .collect()
}

/// The calibration rows: each metric's reading against your limit, its baseline kept per device,
/// and the one ask for the limits of the metrics a reference Mac measured first in this run.
fn calibrate(
    store: &mut Store,
    measured: &BTreeMap<&str, f64>,
    device: &Value,
    reference: bool,
    planted: Option<Planted>,
) -> (Vec<Value>, Vec<Value>) {
    let mut asking = Vec::new();
    for (name, ..) in METRICS {
        let Some(&value) = measured.get(name) else {
            continue;
        };
        let rows = store.baselines.entry(name.to_string()).or_default();
        if !rows.iter().any(|(d, _)| d == device) {
            rows.push((device.clone(), value));
        }
        if reference && store.asked.insert(name.to_string()) {
            asking.push(name);
        }
    }
    let unit = |m: &str| METRICS.iter().find(|x| x.0 == m).copied();
    let asks = if asking.is_empty() {
        Vec::new()
    } else {
        store.asks += 1;
        let metrics: Vec<Value> = asking
            .iter()
            .filter_map(|m| unit(m))
            .map(|(m, u, lower)| {
                json!({"metric": m, "unit": u, "better": if lower {"lower"} else {"higher"},
                       "baseline": baseline_json(&store.baselines[m])})
            })
            .collect();
        vec![
            json!({"id": format!("envelope-limits-{}", store.asks), "kind": "envelope_limits",
                    "metrics": metrics}),
        ]
    };
    let rows = METRICS
        .iter()
        .map(|&(name, u, lower)| {
            let value = measured.get(name).copied();
            let baseline = store
                .baselines
                .get(name)
                .map(Vec::as_slice)
                .unwrap_or_default();
            // The planted envelope holds a metric to its first reading on the device.
            let limit = if planted == Some(Planted::TakesFirstMeasurementAsLimit) {
                baseline.iter().find(|(d, _)| d == device).map(|(_, v)| *v)
            } else {
                store.limits.get(name).copied()
            };
            let verdict = match (value, limit) {
                (Some(v), Some(l)) if (lower && v <= l) || (!lower && v >= l) => Verdict::Pass,
                (Some(_), Some(_)) => Verdict::Fail,
                _ => Verdict::Blocked,
            };
            json!({"metric": name, "unit": u, "better": if lower {"lower"} else {"higher"},
                   "measured": value, "limit": limit,
                   "verdict": same_machine(verdict, reference).name(),
                   "baseline": baseline_json(baseline),
                   "why": value.is_none().then_some("not_run")})
        })
        .collect();
    (rows, asks)
}

/// `decide`'s limits: yours replace each metric's earlier one in the envelope's store.
pub fn decide_limits(call: &Value) -> Value {
    let (Some(store), Some(limits)) = (
        call["store"].as_str(),
        call["decision"]["limits"].as_object(),
    ) else {
        return bad("decide takes a store and limits {metric: number}");
    };
    let mut set = BTreeMap::new();
    for (m, l) in limits {
        let (true, Some(l)) = (METRICS.iter().any(|x| x.0 == m), l.as_f64()) else {
            return bad(&format!("{m} is no envelope metric with a number"));
        };
        set.insert(m.clone(), l);
    }
    let dir = std::path::Path::new(store);
    let mut s = Store::read(dir);
    s.limits.extend(set);
    match s.write(dir) {
        Ok(()) => json!({"outcome": "decided"}),
        Err(e) => e,
    }
}

/// The first frame wait: a fresh copy of this binary, on the same backend with nothing kept,
/// opens the scene twice.
fn first_frame_wait(app: &App, out: &str, args: &Args, call: &Value) -> Result<Vec<Value>, Value> {
    let exe = std::env::current_exe().map_err(|e| refused("no_process", e.to_string()))?;
    let mut cmd = Command::new(exe);
    cmd.arg("run");
    if app.backend == Backend::Noop {
        cmd.args(["--backend", "noop"]);
    }
    if let Some(p) = &app.planted_name {
        cmd.args(["--planted", p]);
    }
    let mut opens = json!({"call": "envelope_opens", "look": call["look"], "writer": args.writer,
                           "doc": args.scene, "pixels": args.size});
    if let Some(ms) = args.delay_ms {
        opens["stub_pipeline_delay_ms"] = json!(ms);
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| refused("no_process", e.to_string()))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = writeln!(stdin, "{}", json!({"out": out, "calls": [opens]}));
    }
    let output = child
        .wait_with_output()
        .map_err(|e| refused("no_process", e.to_string()))?;
    let answer: Value = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .and_then(|l| serde_json::from_str(l).ok())
        .unwrap_or(Value::Null);
    match answer["replies"][0]["opens"].as_array() {
        Some(o) => Ok(o.clone()),
        None => Err(refused(
            "no_process",
            format!("the fresh process answered {answer}"),
        )),
    }
}

/// `envelope_opens`, the fresh process's half of the first frame wait: the scene checked and
/// opened, closed, then checked and opened again, each timed from the start of its check to its
/// first presented frame.
pub fn opens(app: &mut App, call: &Value) -> Value {
    let (Some(writer), Some(doc), Some(size)) = (
        call["writer"].as_str().map(str::to_string),
        call["doc"].as_str().map(PathBuf::from),
        pair(&call["pixels"]),
    ) else {
        return bad("envelope_opens is {look, writer, doc, pixels}");
    };
    let look = match Look3::read(&call["look"]) {
        Ok(l) => l,
        Err(e) => return bad(&format!("look: {e}")),
    };
    let delay = match test_only(call, "stub_pipeline_delay_ms") {
        Ok(d) => d.and_then(Value::as_u64),
        Err(e) => return e,
    };
    let planted = app.planted;
    let memo = app.memo.clone();
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let plants = Plants::of(planted);
        let mut labels = Labels::sharing(memo);
        if let Some(ms) = delay {
            device.device.delay_next_pipeline(ms);
        }
        let mut opens = Vec::new();
        for open in ["fresh", "same_process"] {
            let mut start = (Instant::now(), device.device.counts().read());
            let result = (|| {
                let (_, a) = checked(
                    &doc,
                    &look,
                    &writer,
                    Some(size),
                    &mut labels,
                    &plants,
                    planted,
                )?;
                let mut kit = Kit::new(&device);
                let mut view = opened(&device, &mut kit, &look, a, &mut labels, &plants, planted)?;
                // The planted meter starts its clock once the check's warm-up is done.
                if planted == Some(Planted::WaitClockAfterWarmup) {
                    start = (Instant::now(), device.device.counts().read());
                }
                let mut timer = Timer::new(&device);
                draw(&device, &kit, &look, &mut view, 0, &mut labels, &mut timer)
            })();
            if let Err(e) = result {
                return e;
            }
            let made: Reading = device.device.counts().read().since(start.1);
            opens.push(
                json!({"open": open, "ms": start.0.elapsed().as_secs_f64() * 1e3,
                              "pipelines": made.pipelines}),
            );
        }
        json!({"opens": opens})
    })
}

/// This process's peak resident memory, in bytes.
fn peak_rss() -> Option<f64> {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    // SAFETY: getrusage writes the struct it is given and nothing else.
    if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
        return None;
    }
    let scale = if cfg!(target_os = "macos") {
        1.0
    } else {
        1024.0
    };
    Some(usage.ru_maxrss as f64 * scale)
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let args = match parse(call) {
        Ok(a) => a,
        Err(e) => return e,
    };
    let opens = if args.wait {
        match first_frame_wait(app, out, &args, call) {
            Ok(o) => Some(o),
            Err(e) => return e,
        }
    } else {
        None
    };
    let planted = app.planted;
    let memo = app.memo.clone();
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let plants = Plants::of(planted);
        let mut labels = Labels::sharing(memo);
        let environment = args.environment.clone().unwrap_or_else(this_machine);
        let reference = is_reference(&environment);
        let device_id = json!({"model": environment["model"], "chip": environment["chip"]});
        let display = args.display.map(|rate| Display {
            rate,
            held: matches!(planted, Some(Planted::HoldsInput | Planted::HeldInputMeterAtEncode)),
        });
        let scene = match play(&device, &args, SCENE, &args.scene, &mut labels, &plants, planted, display) {
            Ok(p) => p,
            Err(e) => return e,
        };
        // The planted envelope times the every-pass scene alone.
        let separate = args.separate.as_ref().filter(|_| planted != Some(Planted::TimesOnlyScene));
        let separate = match separate {
            None => None,
            Some((doc, instanced)) => {
                let one = play(&device, &args, SEPARATE, doc, &mut labels, &plants, planted, display);
                let two = play(&device, &args, INSTANCED, instanced, &mut labels, &plants, planted, display);
                match (one, two) {
                    (Ok(a), Ok(b)) => Some((a, b)),
                    (Err(e), _) | (_, Err(e)) => return e,
                }
            }
        };
        let (scene_row, scene_times) = fixture_row(SCENE, &scene, reference);
        let mut fixtures = vec![scene_row];
        let mut measured: BTreeMap<&str, f64> = BTreeMap::new();
        if let Some(p99) = scene_times.as_ref().and_then(|t| median(&t.p99)) {
            measured.insert("frame_time_p99", p99);
        }
        match &args.stub {
            Some(s) => {
                measured.insert("seek_rebuild", s.seek_ms);
                measured.insert("peak_memory/app", s.app_bytes);
                measured.insert("peak_memory/decode_worker", s.worker_bytes);
                measured.insert("export_throughput", s.export_x);
            }
            None => {
                if let Some(ms) = scene.seek_ms {
                    measured.insert("seek_rebuild", ms);
                }
                if let Some(b) = peak_rss() {
                    measured.insert("peak_memory/app", b);
                }
            }
        }
        if let Some(o) = &opens {
            for open in o {
                let name = match open["open"].as_str() {
                    Some("fresh") => "first_frame_wait/fresh",
                    _ => "first_frame_wait/same_process",
                };
                if let Some(ms) = open["ms"].as_f64() {
                    measured.insert(name, ms);
                }
            }
        }
        match &separate {
            Some((items, twin)) => {
                let (row, times) = fixture_row(SEPARATE, items, reference);
                fixtures.push(row);
                let ratio = times
                    .and_then(|t| median(&t.p95))
                    .zip(timed(twin).and_then(|t| median(&t.p95)))
                    .map(|(a, b)| a / b);
                if let Some(r) = ratio {
                    measured.insert("separate_items_ratio", r);
                }
            }
            None if planted == Some(Planted::TimesOnlyScene) => {}
            None => fixtures.push(json!({"fixture": SEPARATE, "verdict": "BLOCKED", "why": "not_run",
                                         "frame_time": null, "gpu_memory": null})),
        }
        let input = input_row(&args, &scene, reference);
        let mut store = Store::read(&args.store);
        let (calibration, asks) = calibrate(&mut store, &measured, &device_id, reference, planted);
        if let Err(e) = store.write(&args.store) {
            return e;
        }
        let verdict = worst(
            fixtures
                .iter()
                .chain(&calibration)
                .chain([&input])
                .filter_map(|r| r["verdict"].as_str()),
        );
        let mut reply = json!({"verdict": verdict, "fixtures": fixtures, "input": input,
                               "calibration": calibration, "asks": asks, "first_frame_wait": opens});
        // #173: the seek rebuild renders the window the scene played with.
        if let (Some(ms), Some((_, window, rendered))) = (scene.seek_ms, scene.history) {
            reply["seek_rebuild"] = json!({"ms": ms, "window": window, "rendered": rendered});
        }
        let mut log = scene.log;
        if let Some((a, b)) = separate {
            log.extend(a.log);
            log.extend(b.log);
        }
        if args.report_frames {
            reply["frames"] = json!(log);
        }
        if args.report_inputs {
            reply["inputs"] = json!(scene.inputs);
        }
        reply
    })
}

/// `envelope_counts`: what the device creates and uploads in each frame of a document's play on
/// the noop lane, beside the timings: its check's warm-up, then frames 0 … n − 1.
pub fn counts(app: &mut App, call: &Value) -> Value {
    let (Some(writer), Some(doc), Some(size), Some(seconds)) = (
        call["writer"].as_str().map(str::to_string),
        call["doc"].as_str().map(PathBuf::from),
        pair(&call["render"]["pixels"]),
        call["render"]["seconds"].as_f64().filter(|s| *s > 0.0),
    ) else {
        return bad("envelope_counts is {look, writer, doc, render: {seconds, pixels}}");
    };
    let look = match Look3::read(&call["look"]) {
        Ok(l) => l,
        Err(e) => return bad(&format!("look: {e}")),
    };
    let fps = call["fps"].as_f64().filter(|f| *f > 0.0).unwrap_or(60.0);
    let mut patches = BTreeMap::new();
    for p in call["patches"].as_array().into_iter().flatten() {
        match p["frame"].as_u64() {
            Some(k) => {
                patches.insert(k, p["ops"].clone());
            }
            None => return bad("a patch is {frame, ops}"),
        }
    }
    let planted = app.planted;
    let memo = app.memo.clone();
    app.worker.call(move |state| {
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let plants = Plants::of(planted);
        let mut labels = Labels::sharing(memo);
        let counted = || device.device.counts().read();
        let before = counted();
        let (_, a) = match checked(
            &doc,
            &look,
            &writer,
            Some(size),
            &mut labels,
            &plants,
            planted,
        ) {
            Ok(x) => x,
            Err(e) => return e,
        };
        let mut stamped = a.doc.clone();
        let mut kit = Kit::new(&device);
        let mut view = match opened(&device, &mut kit, &look, a, &mut labels, &plants, planted) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let warmup = counted().since(before).pipelines;
        let mut timer = Timer::new(&device);
        let n = (seconds * fps).round().max(1.0) as u64;
        let mut frames = Vec::with_capacity(n as usize);
        for k in 0..n {
            let began = counted();
            // A patch applies as the writer's next revision, checked first: frame k shows it.
            if let Some(ops) = patches.get(&k) {
                if let Err(e) = crate::view3d::apply_patch(&mut stamped, &writer, ops, k as usize) {
                    return e;
                }
                let payload = unstamped(&stamped);
                let a = match admit(
                    payload.clone(),
                    &writer,
                    DOC_ID,
                    Some(size),
                    &look,
                    0,
                    Path::Copy,
                    &mut labels,
                    Some((&payload, &plants)),
                    planted,
                ) {
                    Ok(a) => a,
                    Err(issues) => return json!({"code": "refused", "issues": issues}),
                };
                view.set_frames(a.into_frames());
            }
            let t = (k as f64 * FLICKS_PER_SECOND / fps).round() as i64;
            if let Err(e) = draw(&device, &kit, &look, &mut view, t, &mut labels, &mut timer) {
                return e;
            }
            let made = counted().since(began);
            let encoded: Vec<Value> = view
                .renderer()
                .counts()
                .encoded
                .iter()
                .map(|(batch, items)| json!({"batch": batch, "items": items}))
                .collect();
            frames.push(
                json!({"frame": k, "encoded": encoded, "bind_groups": made.bind_groups,
                               "buffers": made.buffers, "pipelines": made.pipelines,
                               "uploaded_bytes": made.uploaded}),
            );
        }
        json!({"warmup": {"pipelines": warmup}, "frames": frames})
    })
}

/// A stamped document as its writer sends it: no layers, no item's layer.
fn unstamped(doc: &Value) -> Value {
    let mut payload = doc.clone();
    if let Some(d) = payload.as_object_mut() {
        d.remove("layers");
        d.remove("id");
        if let Some(Value::Object(items)) = d.get_mut("items") {
            for item in items.values_mut() {
                if let Some(i) = item.as_object_mut() {
                    i.remove("layer");
                }
            }
        }
    }
    payload
}
