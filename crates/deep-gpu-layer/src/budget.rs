//! The `frame_budget` call (issue #1899; tests/acceptance/1899/README.md): the document check's
//! frame-budget run. A writer's revision is checked, then rendered headless on the GPU worker,
//! never the UI thread, at its class's base rung as a canonical render is: warm-up frames, then
//! five timed runs, each frame's GPU time read from its own pass timestamps only. Each limit is
//! judged by `deep_gpu::frame_budget`, and a result off a reference Mac's environment is a
//! reading (`machines: same`). The test build's stub meter stands in for the device's timestamps,
//! its stub timer for whole runs, and its stub environment for this machine's.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Instant;

use deep_canvas::budget::Limits;
use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Labels;
use deep_effects_render::docops::DocOps;
use deep_gpu::device::Device;
use deep_gpu::frame_budget::{judge, reading, run_p95, Invalid, RunP95, Verdict};
use deep_gpu::memory;
use deep_gpu::meter::{self, Ladder, Rung, MAX_PASSES};
use deep_gpu::surface::Path;
use serde_json::{json, Value};

use crate::live::{admit, pair, read_payload, Admitted, Plants};
use crate::liveview::{Content, Drawing, Kit, Timer, View};
use crate::{refused, App, Planted};

const FLICKS_PER_SECOND: i64 = 705_600_000;
const RUNS: usize = 5;
/// The reference Macs and their conditions, as scripts/benchmark.mjs lists them.
const REFERENCES: [(&str, &str, u64); 3] = [
    ("Mac15,7", "Apple M3 Pro", 36 << 30),
    ("Mac15,12", "Apple M3", 16 << 30),
    ("Mac17,10", "Apple M5 Max", 64 << 30),
];

/// The stub meter's readings for frames `from..=to` of every run.
struct Entry {
    from: u64,
    to: u64,
    gpu_ms: f64,
    by_rung: BTreeMap<String, f64>,
    cpu_ms: f64,
    cpu_encode_ms: f64,
}

pub(crate) struct StubMeter {
    timestamps: bool,
    frames: Vec<Entry>,
    unresolved: BTreeSet<u64>,
    reversed: BTreeSet<u64>,
    /// The frame after whose submission the device is lost, and the frames then in flight.
    lose: Option<(u64, u64)>,
    /// #1937: while the drawn document holds `equals` at `path`, each frame costs `gpu_ms` more,
    /// and the test build's cost model predicts `predicted_ms` (else `gpu_ms`) for it.
    terms: Vec<Term>,
}

struct Term {
    path: String,
    equals: Value,
    gpu_ms: f64,
    predicted_ms: Option<f64>,
}

impl StubMeter {
    fn entry(&self, k: u64) -> Option<&Entry> {
        self.frames.iter().rev().find(|e| e.from <= k && k <= e.to)
    }

    /// The terms that hold on `doc`.
    fn holding<'a>(&'a self, doc: &'a Value) -> impl Iterator<Item = &'a Term> {
        self.terms
            .iter()
            .filter(move |t| doc.pointer(&format!("/{}", t.path)) == Some(&t.equals))
    }

    /// The test build's cost model, with terms: frame 0's GPU time plus each holding term's
    /// prediction.
    pub(crate) fn predicted(&self, doc: &Value) -> Option<f64> {
        let base = self.entry(0)?.gpu_ms;
        (!self.terms.is_empty()).then(|| {
            base + self
                .holding(doc)
                .map(|t| t.predicted_ms.unwrap_or(t.gpu_ms))
                .sum::<f64>()
        })
    }
}

struct StubTimer {
    p95_ms: f64,
    spread_ms: f64,
    seeds: Vec<i64>,
}

pub(crate) struct Args {
    pub(crate) look: Look3,
    pub(crate) writer: String,
    doc: PathBuf,
    pub(crate) size: [u32; 2],
    fps: u64,
    warmup: u64,
    per_run: u64,
    frames: bool,
    pub(crate) meter: Option<StubMeter>,
    timer: Option<StubTimer>,
    pub(crate) environment: Option<Value>,
}

pub(crate) fn parse(call: &Value) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let test_build = cfg!(feature = "test-meter");
    let (Some(writer), Some(doc), Some(size), Some(seconds)) = (
        call["writer"].as_str(),
        call["doc"].as_str(),
        pair(&call["render"]["pixels"]),
        call["render"]["seconds"].as_f64().filter(|s| *s > 0.0),
    ) else {
        return Err(bad(
            "frame_budget is {look, writer, doc, render: {seconds, pixels}}",
        ));
    };
    let look = Look3::read(&call["look"]).map_err(|e| bad(&format!("look: {e}")))?;
    let fps = call["fps"].as_u64().unwrap_or(60).max(1);
    let warmup = call["warmup"].as_u64().unwrap_or(60);
    let per_run = (seconds * fps as f64).round().max(1.0) as u64;
    let mut frames = false;
    for r in call["report"].as_array().into_iter().flatten() {
        match r.as_str() {
            Some("frames") => frames = true,
            _ => return Err(bad("report holds frames")),
        }
    }
    let test_only = |key: &str| -> Result<Option<&Value>, Value> {
        match call.get(key) {
            Some(_) if !test_build => Err(bad(&format!("{key} is a test build's"))),
            v => Ok(v),
        }
    };
    let meter = match test_only("stub_meter")? {
        None => None,
        Some(s) => Some(meter_of(s, warmup.max(per_run)).ok_or_else(|| bad("stub_meter"))?),
    };
    let timer = match test_only("stub_timer")? {
        None => None,
        Some(s) => Some(timer_of(s).ok_or_else(|| bad("stub_timer"))?),
    };
    if meter.is_some() && timer.is_some() {
        return Err(bad(
            "a call carries at most one of stub_meter and stub_timer",
        ));
    }
    let environment = test_only("stub_environment")?.cloned();
    Ok(Args {
        look,
        writer: writer.to_string(),
        doc: PathBuf::from(doc),
        size,
        fps,
        warmup,
        per_run,
        frames,
        meter,
        timer,
        environment,
    })
}

/// The stub meter, with every frame of the longest run covered by an entry.
fn meter_of(s: &Value, longest: u64) -> Option<StubMeter> {
    let frames = s["frames"]
        .as_array()?
        .iter()
        .map(|e| {
            Some(Entry {
                from: e["from"].as_u64()?,
                to: e.get("to").map_or(Some(u64::MAX), Value::as_u64)?,
                gpu_ms: e["gpu_ms"].as_f64()?,
                by_rung: e["by_rung"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(r, ms)| Some((Rung::parse(r)?.name().to_string(), ms.as_f64()?)))
                    .collect::<Option<_>>()?,
                cpu_ms: e.get("cpu_ms").map_or(Some(0.0), Value::as_f64)?,
                cpu_encode_ms: e.get("cpu_encode_ms").map_or(Some(0.0), Value::as_f64)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let set = |key: &str| -> Option<BTreeSet<u64>> {
        s[key]
            .as_array()
            .into_iter()
            .flatten()
            .map(Value::as_u64)
            .collect()
    };
    let terms = s["terms"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| {
            Some(Term {
                path: t["path"].as_str()?.to_string(),
                equals: t.get("equals")?.clone(),
                gpu_ms: t["gpu_ms"].as_f64()?,
                predicted_ms: match t.get("predicted_ms") {
                    None => None,
                    Some(p) => Some(p.as_f64()?),
                },
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let lose = match s.get("lose_device") {
        None => None,
        Some(l) => Some((l["frame"].as_u64()?, l["in_flight"].as_u64()?.max(1))),
    };
    let stub = StubMeter {
        timestamps: s.get("timestamps").map_or(Some(true), Value::as_bool)?,
        frames,
        unresolved: set("unresolved")?,
        reversed: set("reversed")?,
        lose,
        terms,
    };
    (0..longest)
        .all(|k| stub.entry(k).is_some())
        .then_some(stub)
}

fn timer_of(s: &Value) -> Option<StubTimer> {
    Some(StubTimer {
        p95_ms: s["p95_ms"].as_f64()?,
        spread_ms: s["spread_ms"].as_f64()?,
        seeds: s["seeds"]
            .as_array()?
            .iter()
            .map(Value::as_i64)
            .collect::<Option<_>>()?,
    })
}

/// One frame the run drew: its rung, its GPU reading (none without pass timestamps), its CPU
/// time and its CPU encode time.
pub(crate) struct Row {
    rung: Rung,
    gpu: Option<Result<f64, Invalid>>,
    cpu: f64,
    encode: f64,
}

pub fn call(app: &mut App, call: &Value) -> Value {
    let args = match parse(call) {
        Ok(a) => a,
        Err(e) => return e,
    };
    let planted = app.planted;
    app.worker.call(move |state| {
        let mut labels = Labels::new();
        let a = match admitted(&args, &mut labels) {
            Ok(a) => a,
            Err(e) => return e,
        };
        let environment = args.environment.clone().unwrap_or_else(this_machine);
        let reference = is_reference(&environment);
        if let Some(t) = &args.timer {
            let seeds: Vec<Value> = t
                .seeds
                .iter()
                .map(|&seed| {
                    let runs: Vec<Vec<Row>> = (1..=RUNS as u64)
                        .map(|r| {
                            let ms = t.p95_ms + t.spread_ms * (2.0 * uniform(seed, r) - 1.0);
                            (0..args.per_run)
                                .map(|_| Row {
                                    rung: Rung::Base,
                                    gpu: Some(Ok(ms)),
                                    cpu: 0.0,
                                    encode: 0.0,
                                })
                                .collect()
                        })
                        .collect();
                    let mut r = result(&a.limits, &runs, reference, planted);
                    r["seed"] = json!(seed);
                    r
                })
                .collect();
            return json!({ "seeds": seeds });
        }
        let device = match state.gpu.recover() {
            Ok(d) => d,
            Err(e) => return refused("no_device", e),
        };
        let mut doc = a.doc;
        doc["size"] = json!(args.size);
        let runs = match measure(
            &state.gpu,
            device,
            &args,
            &doc,
            &a.limits,
            &mut labels,
            planted,
        ) {
            Ok(r) => r,
            Err(e) => return e,
        };
        let mut reply = result(&a.limits, &runs[1..], reference, planted);
        if args.frames {
            let rows: Vec<Value> = runs
                .iter()
                .enumerate()
                .flat_map(|(run, rows)| {
                    rows.iter().enumerate().map(move |(k, row)| {
                        let (gpu, invalid) = match row.gpu {
                            Some(Ok(ms)) => (json!(ms), Value::Null),
                            Some(Err(why)) => (Value::Null, json!(why.name())),
                            None => (Value::Null, Value::Null),
                        };
                        json!({"run": run, "frame": k, "rung": row.rung.name(),
                               "gpu_ms": gpu, "invalid": invalid})
                    })
                })
                .collect();
            reply["frames"] = json!(rows);
        }
        reply
    })
}

/// The call's document checked as the writer's revision, or the refusal naming its issues.
pub(crate) fn admitted(args: &Args, labels: &mut Labels) -> Result<Admitted, Value> {
    read_payload(&args.doc)
        .and_then(|payload| {
            admit(
                payload,
                &args.writer,
                "01jb3790000000000000000000",
                Some(args.size),
                &args.look,
                0,
                Path::Copy,
                labels,
                None,
                None,
            )
        })
        .map_err(|issues| json!({"code": "refused", "issues": issues}))
}

/// The run's view: the document's frames drawn as a canonical render draws them.
fn view_of(
    device: &Device,
    look: &Look3,
    doc: &Value,
    size: [u32; 2],
    labels: &mut Labels,
    planted: Option<Planted>,
) -> Result<View, Value> {
    let frames = Frames::new(doc, look, labels).map_err(|r| refused(r.code, r.path))?;
    let mut view = View::new(
        device,
        Path::Copy,
        size,
        1,
        Content::Scene(Box::new(frames)),
        1.0,
        0,
        look,
        labels,
        crate::session3::msaa_planted(planted),
        true,
    )
    .map_err(|e| refused("no_view", e))?;
    let plants = Plants::of(planted);
    let (options, check) = plants.ops;
    view.ops = DocOps::new(device, doc, options, check, &[]);
    view.want_targets(doc, plants.builds_unread_targets);
    Ok(view)
}

/// The warm-up (run 0) and the five timed runs, frame by frame.
#[allow(clippy::too_many_arguments)]
pub(crate) fn measure(
    gpu: &deep_gpu::device::Gpu,
    mut device: Arc<Device>,
    args: &Args,
    doc: &Value,
    limits: &Limits,
    labels: &mut Labels,
    planted: Option<Planted>,
) -> Result<Vec<Vec<Row>>, Value> {
    let stub = args.meter.as_ref();
    let mut kit = Kit::new(&device);
    let mut view = view_of(&device, &args.look, doc, args.size, labels, planted)?;
    let mut timer = Timer::new(&device);
    // The planted run steps the live ladder on its readings; the check's own never steps.
    let mut ladder = (planted == Some(Planted::LadderActsInBudgetRun))
        .then(|| Ladder::new(meter::Planted::default()).0);
    let repeats = planted == Some(Planted::RepeatsLastReading);
    let mut intervals = [[0.0f64; 2]; MAX_PASSES];
    let mut cpu_marks = [[0.0f64; 2]; MAX_PASSES];
    let mut runs = Vec::with_capacity(RUNS + 1);
    let extra: f64 = stub.map_or(0.0, |s| s.holding(doc).map(|t| t.gpu_ms).sum());
    for run in 0..=RUNS as u64 {
        let n = if run == 0 { args.warmup } else { args.per_run };
        let timed = run > 0;
        let mut rows: Vec<Row> = Vec::with_capacity(n as usize);
        let mut last: Option<f64> = None;
        for k in 0..n {
            let rung = ladder.as_ref().map_or(Rung::Base, Ladder::rung);
            let drawing = Drawing {
                rung,
                offsets: Offsets::default(),
                effects_resolution: 1.0,
                canonical: ladder.is_none(),
                settles: false,
            };
            let t = k as i64 * FLICKS_PER_SECOND / args.fps as i64;
            timer.begin_frame();
            let began = Instant::now();
            let mut encoder = device.device.create_command_encoder(&Default::default());
            view.draw(
                &device,
                &kit,
                &args.look,
                t,
                &drawing,
                labels,
                &mut encoder,
                &mut timer,
                0,
            )
            .map_err(|r| refused(r.code, r.path))?;
            let cpu = began.elapsed().as_secs_f64() * 1e3;
            device.queue.submit([encoder.finish()]);
            let lose = stub
                .and_then(|s| s.lose)
                .filter(|(at, _)| timed && *at == k);
            let resolved = if lose.is_some() {
                device.force_loss();
                false
            } else {
                memory::drain(&device);
                // #239: the timestamps resolve in a submission of their own once the frame's work
                // is done. Metal orders no read of a counter sample against the pass that writes
                // it, so a resolve in the frame's own encoder could copy the last pass's end
                // before its fragment stage wrote it, and read the frame before's.
                let mut resolve = device.device.create_command_encoder(&Default::default());
                timer.resolve(&mut resolve);
                device.queue.submit([resolve.finish()]);
                timer.read(&device)
            };
            let lost = device.is_lost();
            let row = match stub {
                Some(s) => {
                    let e = s.entry(k).expect("every frame has an entry");
                    let ms = *e.by_rung.get(rung.name()).unwrap_or(&e.gpu_ms) + extra;
                    let gpu = s.timestamps.then(|| {
                        let unresolved = timed && s.unresolved.contains(&k);
                        match reading(lost, !unresolved, timed && s.reversed.contains(&k), ms) {
                            Err(Invalid::Unresolved) if repeats => last.ok_or(Invalid::Unresolved),
                            r => r,
                        }
                    });
                    Row {
                        rung,
                        gpu,
                        cpu: e.cpu_ms,
                        encode: e.cpu_encode_ms,
                    }
                }
                None => {
                    let marks = &timer.marks[..timer.n];
                    let period = timer.period_ns().unwrap_or(1.0);
                    let mut reversed = false;
                    for (i, m) in marks.iter().enumerate() {
                        reversed |= m.ticks[1] < m.ticks[0];
                        intervals[i] = [
                            m.ticks[0] as f64 * period / 1e6,
                            m.ticks[1] as f64 * period / 1e6,
                        ];
                        cpu_marks[i] = [m.cpu[0] as f64 / 1e6, m.cpu[1] as f64 / 1e6];
                    }
                    let covered = meter::covered(&intervals[..marks.len()]);
                    Row {
                        rung,
                        gpu: timer
                            .timed()
                            .then(|| reading(lost, resolved, reversed, covered)),
                        cpu,
                        encode: meter::covered(&cpu_marks[..marks.len()]),
                    }
                }
            };
            if let Some(Ok(ms)) = row.gpu {
                last = Some(ms);
            }
            if let Some(l) = ladder.as_mut() {
                let gpu_ms = row.gpu.and_then(Result::ok).unwrap_or(0.0);
                l.frame(gpu_ms, row.cpu, limits, false, false);
            }
            rows.push(row);
            if lost {
                // The frames still in flight read work submitted before the loss.
                let in_flight = lose.map_or(1, |(_, n)| n) as usize;
                let from = rows.len().saturating_sub(in_flight);
                for r in &mut rows[from..] {
                    if r.gpu.is_some() {
                        r.gpu = Some(Err(Invalid::DeviceLost));
                    }
                }
                device = gpu.recover().map_err(|e| refused("no_device", e))?;
                kit = Kit::new(&device);
                view = view_of(&device, &args.look, doc, args.size, labels, planted)?;
                timer = Timer::new(&device);
            }
        }
        runs.push(rows);
    }
    Ok(runs)
}

/// The five timed runs judged against the class's limits.
pub(crate) fn result(
    limits: &Limits,
    runs: &[Vec<Row>],
    reference: bool,
    planted: Option<Planted>,
) -> Value {
    let drops = planted == Some(Planted::DropsUnresolvedFrames);
    let timestamps = runs.iter().flatten().all(|r| r.gpu.is_some());
    let gpu = limits.gpu_ms.map(|limit| {
        if !timestamps {
            return json!({"limit_ms": limit, "verdict": Verdict::Blocked.name(), "runs": [],
                          "margin": null, "missing": "timestamps"});
        }
        let readings: Vec<Vec<Result<f64, Invalid>>> = runs
            .iter()
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| r.gpu)
                    .filter(|g| !(drops && *g == Err(Invalid::Unresolved)))
                    .collect()
            })
            .collect();
        let p95s: Vec<RunP95> = readings.iter().map(|r| run_p95(r)).collect();
        let attached: Vec<Value> = runs
            .iter()
            .zip(&p95s)
            .map(|(rows, p)| {
                let invalid: Vec<Value> = rows
                    .iter()
                    .enumerate()
                    .filter_map(|(k, r)| match r.gpu {
                        Some(Err(why)) => Some(json!({"frame": k, "why": why.name()})),
                        _ => None,
                    })
                    .collect();
                json!({"p95_ms": p.over.is_finite().then_some(p.over), "invalid": invalid})
            })
            .collect();
        limit_json(limit, &p95s, attached, reference)
    });
    let cpu = limits.cpu_ms.map(|limit| {
        let p95s: Vec<RunP95> = runs
            .iter()
            .map(|rows| run_p95(&rows.iter().map(|r| Ok(r.cpu)).collect::<Vec<_>>()))
            .collect();
        let attached = p95s
            .iter()
            .map(|p| json!({"p95_ms": p.over, "invalid": []}))
            .collect();
        limit_json(limit, &p95s, attached, reference)
    });
    let fallback = (!timestamps).then(|| {
        let runs: Vec<Value> = runs
            .iter()
            .map(|rows| {
                let p = run_p95(&rows.iter().map(|r| Ok(r.encode)).collect::<Vec<_>>());
                json!({"p95_ms": p.over})
            })
            .collect();
        json!({"source": "cpu_encode", "runs": runs})
    });
    let verdicts: Vec<&str> = [&gpu, &cpu]
        .into_iter()
        .flatten()
        .filter_map(|l| l["verdict"].as_str())
        .collect();
    let verdict = if verdicts.is_empty() {
        // A class with no frame limit has nothing a run could be judged on.
        Verdict::Blocked.name()
    } else {
        ["FAIL", "BLOCKED", "INCONCLUSIVE"]
            .into_iter()
            .find(|v| verdicts.contains(v))
            .unwrap_or("PASS")
    };
    json!({"verdict": verdict, "limits": {"gpu": gpu, "cpu": cpu}, "fallback": fallback})
}

/// One limit's verdict with its runs attached; off a reference Mac's environment a PASS or FAIL
/// is only a reading.
fn limit_json(limit: f64, p95s: &[RunP95], runs: Vec<Value>, reference: bool) -> Value {
    let (mut verdict, margin) = judge(limit, p95s);
    if !reference && matches!(verdict, Verdict::Pass | Verdict::Fail) {
        verdict = Verdict::Inconclusive;
    }
    json!({"limit_ms": limit, "verdict": verdict.name(), "runs": runs, "margin": margin,
           "missing": null})
}

/// Whether an environment is a reference Mac's in its conditions (scripts/benchmark.mjs).
pub(crate) fn is_reference(e: &Value) -> bool {
    REFERENCES.iter().any(|(model, chip, memory)| {
        e["model"] == *model && e["chip"] == *chip && e["memoryBytes"].as_u64() == Some(*memory)
    }) && e["power"] == "ac"
        && e["lowPowerMode"] == false
        && e["thermalState"] == "nominal"
        && e["macosBuild"].as_str().is_some_and(|b| !b.is_empty())
}

/// This machine's environment, read as scripts/benchmark.mjs's `fingerprint()` reads it.
pub(crate) fn this_machine() -> Value {
    let read = |cmd: &str, args: &[&str]| -> Option<String> {
        let o = Command::new(cmd)
            .args(args)
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())?;
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
    };
    let ns = |expr: &str| {
        read(
            "osascript",
            &[
                "-l",
                "JavaScript",
                "-e",
                &format!("ObjC.import(\"Foundation\"); $.NSProcessInfo.processInfo.{expr}"),
            ],
        )
    };
    let source = read("pmset", &["-g", "ps"]).unwrap_or_default();
    let power = if source.contains("'AC Power'") {
        json!("ac")
    } else if source.contains("'Battery Power'") {
        json!("battery")
    } else {
        Value::Null
    };
    let low = read("pmset", &["-g"])
        .and_then(|s| {
            s.lines().find_map(|l| {
                let mut w = l.split_whitespace();
                (w.next() == Some("lowpowermode")).then(|| w.next() == Some("1"))
            })
        })
        .or_else(|| ns("isLowPowerModeEnabled").map(|v| v == "true"));
    let thermal = ns("thermalState")
        .and_then(|s| s.parse::<usize>().ok())
        .and_then(|i| ["nominal", "fair", "serious", "critical"].get(i).copied());
    json!({
        "model": read("sysctl", &["-n", "hw.model"]),
        "chip": read("sysctl", &["-n", "machdep.cpu.brand_string"]),
        "memoryBytes": read("sysctl", &["-n", "hw.memsize"]).and_then(|m| m.parse::<u64>().ok()),
        "power": power, "lowPowerMode": low, "thermalState": thermal,
        "macosBuild": read("sw_vers", &["-buildVersion"]),
    })
}

/// A uniform draw in [0, 1) from a seed and a run, by SplitMix64.
fn uniform(seed: i64, run: u64) -> f64 {
    let mix = |mut z: u64| {
        z = z.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    };
    (mix(mix(seed as u64) ^ run) >> 11) as f64 / (1u64 << 53) as f64
}
