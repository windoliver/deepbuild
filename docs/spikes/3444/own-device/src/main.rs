//! Spike #3444: what a device does when asked for more timestamp query sets than Metal's feature
//! tables give sample buffers (32). A timestamp query set is one Metal counter sample buffer
//! (wgpu-hal's `create_query_set`); when Metal refuses one wgpu-hal answers `Unexpected`, and
//! wgpu-core loses the device on every hal error there but out-of-memory. The app has one device,
//! so this probe opens a device of its own, labelled so, and asks it: each attempt keeps the error
//! its creation raised, whether the device was lost by then, and the device's own count of its
//! query sets (wgpu's internal counters) after it.
//!
//!   spike-3444 [--sets N] [--queries Q] [--drop K]
//!
//! `--sets` is how many sets it asks for (33: one more than 32), `--queries` the queries in each,
//! and `--drop K` drops the first K sets once all are asked for and asks for K more, which tells
//! a cap on the sets alive from a cap on the sets ever made. It prints one JSON report, whose
//! `outcome` is what the device did at attempt 33: `created`, `refused` (an error, the device
//! kept) or `lost`; null when the run never reached it.

use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

/// The label of the probe's own device: never the app's (`deep-gpu`).
const DEVICE: &str = "spike-3444 one more";

/// wgpu-hal logs Metal's own words when it refuses a counter sample buffer; kept for the report.
struct Logged(Mutex<Vec<String>>);

impl log::Log for Logged {
    fn enabled(&self, m: &log::Metadata<'_>) -> bool {
        m.level() <= log::Level::Error
    }
    fn log(&self, r: &log::Record<'_>) {
        if self.enabled(r.metadata()) {
            self.0.lock().unwrap().push(r.args().to_string());
        }
    }
    fn flush(&self) {}
}

static LOGGER: Logged = Logged(Mutex::new(Vec::new()));

fn usage(e: &str) -> ! {
    eprintln!("spike-3444: {e}\nusage: spike-3444 [--sets N] [--queries Q] [--drop K]");
    std::process::exit(2)
}

struct Probe {
    device: wgpu::Device,
    queue: wgpu::Queue,
    lost: Arc<Mutex<Option<String>>>,
    uncaught: Arc<Mutex<Vec<String>>>,
}

impl Probe {
    fn lost(&self) -> Option<String> {
        let _ = self.device.poll(wgpu::PollType::Poll);
        self.lost.lock().unwrap().clone()
    }

    /// The device's own count of its query sets (wgpu's internal counters).
    fn counter(&self) -> isize {
        self.device.get_internal_counters().hal.query_sets.read()
    }

    /// Asks for one timestamp query set of `queries` queries: the set, and the attempt's row: the
    /// error its creation raised, whether the device was lost by then, and the device's own count.
    fn ask(&self, n: usize, queries: u32) -> (wgpu::QuerySet, Value) {
        let logged = LOGGER.0.lock().unwrap().len();
        let scopes = [
            wgpu::ErrorFilter::Validation,
            wgpu::ErrorFilter::OutOfMemory,
            wgpu::ErrorFilter::Internal,
        ]
        .map(|f| self.device.push_error_scope(f));
        let set = self.device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some(&format!("spike-3444 set {n}")),
            ty: wgpu::QueryType::Timestamp,
            count: queries,
        });
        let mut errors = Vec::new();
        for scope in scopes.into_iter().rev() {
            errors.extend(pollster::block_on(scope.pop()).map(|e| e.to_string()));
        }
        let lost = self.lost();
        // An error no scope caught still reached the device's handler.
        if errors.is_empty() && lost.is_some() {
            errors.extend(self.uncaught.lock().unwrap().last().cloned());
        }
        let error = match (errors.is_empty(), &lost) {
            (false, _) => Some(errors.join("; ")),
            (true, Some(reason)) => Some(format!("device lost: {reason}")),
            (true, None) => None,
        };
        let metal: Vec<String> = LOGGER.0.lock().unwrap()[logged..].to_vec();
        let row = json!({"n": n, "error": error, "lost": lost.is_some(), "query_sets": self.counter().max(0),
                         "lost_reason": lost, "logged": metal});
        (set, row)
    }

    /// Whether the device still does work: a buffer written, a command buffer submitted and waited for.
    fn works(&self) -> bool {
        let scope = self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        let buffer = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("spike-3444 still works"),
            size: 16,
            usage: wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        self.queue.write_buffer(&buffer, 0, &[0u8; 16]);
        let encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
        self.queue.submit([encoder.finish()]);
        let waited = self
            .device
            .poll(wgpu::PollType::wait_indefinitely())
            .is_ok();
        let clean = pollster::block_on(scope.pop()).is_none();
        waited && clean && self.lost.lock().unwrap().is_none()
    }
}

/// The run can't be taken: says what is missing and ends, never a reading.
fn blocked(missing: String) -> ! {
    println!(
        "{}",
        json!({"spike": 3444, "part": "one_more_than_32", "status": "BLOCKED", "missing": missing})
    );
    std::process::exit(1)
}

fn main() {
    let (mut sets, mut queries, mut drop_first) = (33usize, 2u32, 0usize);
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut number = |what: &str| {
            args.next()
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or_else(|| usage(&format!("{what} takes a count")))
        };
        match a.as_str() {
            "--sets" => sets = number("--sets") as usize,
            "--queries" => queries = number("--queries"),
            "--drop" => drop_first = number("--drop") as usize,
            _ => usage(&format!("unknown argument {a}")),
        }
    }
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Error);

    let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
    desc.backends = wgpu::Backends::METAL;
    let flags = desc.flags;
    let instance = wgpu::Instance::new(desc);
    let adapter = match pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        force_fallback_adapter: false,
        compatible_surface: None,
        apply_limit_buckets: false,
    })) {
        Ok(a) => a,
        Err(e) => blocked(format!("a Metal adapter ({e})")),
    };
    let info = adapter.get_info();
    if !adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY) {
        blocked("TIMESTAMP_QUERY: the adapter has no timestamp queries".into());
    }
    let (device, queue) =
        match pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some(DEVICE),
            required_features: wgpu::Features::TIMESTAMP_QUERY,
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        })) {
            Ok(d) => d,
            Err(e) => blocked(format!("a device of the probe's own ({e})")),
        };
    let lost = Arc::new(Mutex::new(None));
    let uncaught = Arc::new(Mutex::new(Vec::new()));
    let (l, u) = (lost.clone(), uncaught.clone());
    device.set_device_lost_callback(move |reason, message| {
        *l.lock().unwrap() = Some(format!("{reason:?}: {message}"))
    });
    device.on_uncaptured_error(Arc::new(move |e: wgpu::Error| {
        u.lock().unwrap().push(e.to_string())
    }));
    let probe = Probe {
        device,
        queue,
        lost,
        uncaught,
    };

    /// What the device did with an attempt: created, refused with the device kept, or lost.
    fn did(row: &Value) -> &'static str {
        match (row["lost"] == true, row["error"].is_null()) {
            (true, _) => "lost",
            (false, false) => "refused",
            (false, true) => "created",
        }
    }
    let mut held = Vec::new();
    let mut attempts = Vec::new();
    for n in 1..=sets {
        let (set, row) = probe.ask(n, queries);
        held.push(set);
        let stop = did(&row) == "lost";
        attempts.push(row);
        if stop {
            break;
        }
    }
    // The sets alive, or the sets ever made: drop the first K and ask for K more.
    let mut after_drop = Vec::new();
    if drop_first > 0 && probe.lost().is_none() {
        held.drain(..drop_first.min(held.len()));
        let _ = probe.device.poll(wgpu::PollType::wait_indefinitely());
        let counter = probe.counter();
        for n in 1..=drop_first {
            let (set, mut row) = probe.ask(sets + n, queries);
            row["counter_after_drop"] = json!(counter);
            held.push(set);
            let stop = did(&row) == "lost";
            after_drop.push(row);
            if stop {
                break;
            }
        }
    }
    // What the device did at attempt 33, the one more than 32; null when the run never reached it.
    let outcome = attempts.get(32).map(did);
    let first = attempts.iter().find(|r| did(r) != "created").cloned();
    let works = probe.lost().is_none() && probe.works();
    println!(
        "{}",
        json!({
            "spike": 3444, "part": "one_more_than_32", "status": "RAN",
            "adapter": {"backend": format!("{:?}", info.backend).to_lowercase(), "name": info.name, "driver": info.driver_info},
            "device": {"label": DEVICE, "own": true, "instance_flags": flags.bits()},
            "wgpu": "30.0.1", "sets_asked": sets, "queries_per_set": queries, "dropped_then_asked": drop_first,
            "attempts": attempts, "after_drop": after_drop,
            "outcome": outcome,
            "created": attempts.iter().filter(|r| did(r) == "created").count(),
            "first_not_created": first,
            "device_works_after": works,
            "query_sets_end": probe.counter(),
            "lost": probe.lost(),
            "uncaught": *probe.uncaught.lock().unwrap(),
        })
    );
}
