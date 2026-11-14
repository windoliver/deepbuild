//! Spike #2435: a headless probe of ray queries on the pinned wgpu and Metal, before rays draw.
//!
//! Usage: spike-2435 --part candidates|build_order|ties|rebuilds|all [--plant NAME]
//!
//! Prints one JSON report on stdout: the host and adapter, each part's status (PASS, FAIL, BLOCKED,
//! INCONCLUSIVE or NOT_RUN) with its reason and counts, and the run's status, PASS only when every part
//! asked for passed; a part asked for and not run makes the run INCONCLUSIVE (#1115). Exits 0 only on PASS.
//! Plants: `end_on_failed_candidate`, `top_level_first`, `masked_answers_first`, `no_ray_queries` (the
//! adapter's feature table read without ray queries) and `skip_<part>`, a runner that leaves a part out.

mod build_order;
mod candidates;
mod gpu;
mod rebuilds;
mod ties;

use std::path::PathBuf;

use serde_json::{json, Value};

pub const PARTS: [&str; 4] = ["candidates", "build_order", "ties", "rebuilds"];
const PLANTS: [&str; 4] = ["end_on_failed_candidate", "top_level_first", "masked_answers_first", "no_ray_queries"];

struct Logged;

impl log::Log for Logged {
    fn enabled(&self, m: &log::Metadata<'_>) -> bool {
        m.level() <= log::Level::Debug
    }
    fn log(&self, r: &log::Record<'_>) {
        let text = r.args().to_string();
        if text.contains("only rebuild") {
            rebuilds::LOGGED.lock().unwrap().push(text);
        }
    }
    fn flush(&self) {}
}

static LOGGER: Logged = Logged;

/// The machine's GPU lease (`~/.cache/deepbuild-gpu/lease`, as the kit and exports take it), taken
/// without waiting: `Err` names the live GPU job that holds it.
struct Lease(Option<PathBuf>);

impl Lease {
    fn take() -> Result<Lease, String> {
        let dir = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(std::env::temp_dir).join(".cache").join("deepbuild-gpu");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("lease");
        for _ in 0..3 {
            match std::fs::OpenOptions::new().write(true).create_new(true).open(&file) {
                Ok(mut f) => {
                    use std::io::Write as _;
                    let _ = write!(f, "{}", std::process::id());
                    return Ok(Lease(Some(file)));
                }
                Err(_) => {
                    let holder: Option<i32> = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse().ok());
                    let alive = holder.is_some_and(|pid| {
                        std::process::Command::new("kill").args(["-0", &pid.to_string()]).status().is_ok_and(|s| s.success())
                    });
                    if alive {
                        return Err(format!("pid {}", holder.unwrap_or_default()));
                    }
                    // A lease whose holder is gone was left by a killed run.
                    let _ = std::fs::remove_file(&file);
                }
            }
        }
        Err("a lease file that can't be taken".into())
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(f) = &self.0 {
            let _ = std::fs::remove_file(f);
        }
    }
}

fn usage(e: &str) -> ! {
    eprintln!("spike-2435: {e}\nusage: spike-2435 --part candidates|build_order|ties|rebuilds|all [--plant NAME]");
    std::process::exit(2)
}

fn main() {
    let mut parts = Vec::new();
    let mut plant: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--part" => match args.next() {
                Some(p) if p == "all" => parts.extend(PARTS.iter().map(|p| p.to_string())),
                Some(p) if PARTS.contains(&p.as_str()) => parts.push(p),
                p => usage(&format!("no part {p:?}")),
            },
            "--plant" => match args.next() {
                Some(p) if PLANTS.contains(&p.as_str()) || p.strip_prefix("skip_").is_some_and(|s| PARTS.contains(&s)) => plant = Some(p),
                p => usage(&format!("no plant {p:?}")),
            },
            _ => usage(&format!("unknown argument {a}")),
        }
    }
    if parts.is_empty() {
        usage("no --part");
    }
    let _ = log::set_logger(&LOGGER);
    log::set_max_level(log::LevelFilter::Warn);
    let plant = plant.as_deref();
    let mut results = serde_json::Map::new();
    let adapter = match gpu::open(plant == Some("no_ray_queries")) {
        gpu::Open::Blocked { adapter, missing } => {
            for p in &parts {
                results.insert(p.clone(), json!({"status": "BLOCKED", "reason": format!("BLOCKED: the adapter has no {missing}"), "missing": missing}));
            }
            adapter.map(|a| info(&a))
        }
        gpu::Open::Ready(gpu) => {
            let lease = Lease::take();
            for p in &parts {
                let r = if plant == Some(&format!("skip_{p}")) {
                    json!({"status": "NOT_RUN", "reason": "not run: the runner skipped this part"})
                } else {
                    match p.as_str() {
                        "candidates" => candidates::run(&gpu, plant == Some("end_on_failed_candidate")),
                        "build_order" => build_order::run(&gpu, plant == Some("top_level_first")),
                        "ties" => ties::run(&gpu, plant == Some("masked_answers_first")),
                        _ => rebuilds::run(&gpu, lease.as_ref().err().cloned()),
                    }
                };
                results.insert(p.clone(), r);
            }
            drop(lease);
            Some(info(&gpu.info))
        }
    };
    let statuses: Vec<&str> = results.values().map(|r| r["status"].as_str().unwrap_or("INVALID")).collect();
    // A part asked for and not run leaves the run unjudged: INCONCLUSIVE, never PASS (#1115).
    let status = match ["FAIL", "INVALID", "BLOCKED", "INCONCLUSIVE", "NOT_RUN"].into_iter().find(|s| statuses.contains(s)) {
        Some("NOT_RUN") => "INCONCLUSIVE",
        Some(s) => s,
        None => "PASS",
    };
    let out = json!({
        "issue": 2435,
        "wgpu": "30.0.1",
        "host": host(),
        "adapter": adapter,
        "plant": plant,
        "status": status,
        "parts": results,
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
    std::process::exit(if status == "PASS" { 0 } else { 1 });
}

/// The Mac the probe ran on, as the reference Macs are named.
fn host() -> Value {
    let read = |cmd: &str, args: &[&str]| {
        std::process::Command::new(cmd).args(args).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).filter(|s| !s.is_empty())
    };
    let build = read("sw_vers", &["-productVersion"]).zip(read("sw_vers", &["-buildVersion"])).map(|(v, b)| format!("{v} ({b})"));
    json!({"model": read("sysctl", &["-n", "hw.model"]), "chip": read("sysctl", &["-n", "machdep.cpu.brand_string"]), "os": "macOS", "os_build": build})
}

fn info(a: &wgpu::AdapterInfo) -> Value {
    json!({"name": a.name, "backend": format!("{:?}", a.backend), "device_type": format!("{:?}", a.device_type), "driver": a.driver_info})
}
