//! The validation lane and the error channel (issue #140; README: The validation lane, The
//! error channel). `deep-gpu run --validation` turns Metal's API and shader validation on before
//! the device opens, with its reports on stderr, and builds the lane's shaders without the
//! translator's own bounds checks. `validate` runs fixtures with stderr captured: a report of
//! Metal's naming a pipeline and a buffer fails the fixture, as does the first non-finite value
//! read back from a float target or storage buffer it wrote. `check_render` reads the device's
//! uncaptured-error callback for the whole render.

use std::fs::File;
use std::io::Write as _;
use std::os::fd::AsRawFd as _;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::fixtures::{self, Ran};
use crate::frames::hex;
use crate::{refused, App, Planted};

/// The environment that turns Metal's API and shader validation on, read as the device opens.
pub const ENV: [&str; 3] = [
    "MTL_DEBUG_LAYER",
    "MTL_SHADER_VALIDATION",
    "MTL_SHADER_VALIDATION_REPORT_TO_STDERR",
];

/// The shader kinds the lane instruments; a fixture of any other kind is BLOCKED, never clean.
const INSTRUMENTED: [&str; 2] = ["fragment", "compute"];

extern "C" {
    fn dup(fd: i32) -> i32;
    fn dup2(from: i32, to: i32) -> i32;
    fn close(fd: i32) -> i32;
}

/// Runs `f` with stderr (fd 2, where Metal writes its reports) going to `out/validation-<name>.log`,
/// and that log's text.
fn captured<R>(out: &str, name: &str, f: impl FnOnce() -> R) -> Result<(R, String), String> {
    let path = Path::new(out).join(format!("validation-{name}.log"));
    let file = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let _ = std::io::stderr().flush();
    // SAFETY: fd 2 is pointed at the log for the run and back at the saved stderr after it.
    let saved = unsafe { dup(2) };
    if saved < 0 || unsafe { dup2(file.as_raw_fd(), 2) } < 0 {
        return Err("stderr couldn't be captured".into());
    }
    let r = f();
    // The fixture waited for its work; Metal writes a report as the command buffer completes, on
    // a thread of its own, so the last one gets a moment to land.
    std::thread::sleep(Duration::from_millis(100));
    // SAFETY: as above.
    unsafe {
        dup2(saved, 2);
        close(saved);
    }
    let log = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok((r, log))
}

/// Metal's shader-validation reports in `log`, as (pipeline label, buffer label): each `Invalid
/// device load` or `store` names the buffer (`buffer: <label>, length:…`) and the pipeline
/// (`pipeline: "<label>"`).
fn reports(log: &str) -> Vec<(String, String)> {
    log.split("Invalid device ")
        .skip(1)
        .filter_map(|r| {
            let buffer = r.split_once("buffer: ")?.1.split_once(", length")?.0;
            let pipeline = r.split_once("pipeline: \"")?.1.split_once('"')?.0;
            Some((pipeline.to_string(), buffer.to_string()))
        })
        .collect()
}

/// The first non-finite value a fixture wrote into a float target or storage buffer.
fn non_finite(ran: &Ran) -> Option<Value> {
    ran.floats.iter().find_map(|f| {
        let at = f.values.iter().position(|v| !v.is_finite())?;
        let v = f.values[at];
        let texel = (at / f.lanes) as u32;
        Some(json!({
            "finding": "non_finite", "pass": f.pass, "target": {"name": f.target, "format": f.format},
            "texel": [texel % f.width, texel / f.width],
            "value": if v.is_nan() { "NaN" } else if v > 0.0 { "Inf" } else { "-Inf" },
        }))
    })
}

/// Whether the device is Metal's validating one: (API validation, shader validation), read from
/// the device itself.
fn validating(device: &deep_gpu::device::Device) -> (bool, bool) {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: the Metal device is only described, while `device` keeps it alive.
        if let Some(hal) = unsafe { device.device.as_hal::<wgpu::hal::api::Metal>() } {
            let described = format!("{:?}", hal.raw_device());
            return (
                described.contains("MTLDebugDevice"),
                described.contains("MTLGPUDebugDevice"),
            );
        }
    }
    let _ = device;
    (false, false)
}

/// `{"call": "validate", "fixtures"?: [name]}`: the fixtures (by default every one the tier's
/// table lists) in the validation lane.
pub fn validate(app: &mut App, out: &str, call: &Value) -> Value {
    if !app.validation {
        return refused(
            "bad_input",
            "validate runs in the validation lane: deep-gpu run --validation",
        );
    }
    let names: Vec<String> = match call["fixtures"].as_array() {
        None => fixtures::shipped().into_iter().map(String::from).collect(),
        Some(a) => a
            .iter()
            .map(|v| v.as_str().unwrap_or_default().to_string())
            .collect(),
    };
    if let Some(n) = names.iter().find(|n| !fixtures::known(n)) {
        return refused("bad_input", format!("{n} isn't a fixture"));
    }
    let (out, planted) = (out.to_string(), app.planted);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let (api, shader) = validating(&device);
        // The canary: a read out of bounds the lane must report, or no fixture reads clean.
        let canary = captured(&out, "canary", || fixtures::storage_read(&device, true, true))
            .map(|(_, log)| !reports(&log).is_empty());
        let mut uncovered: Vec<&str> = Vec::new();
        let mut list = Vec::new();
        for name in &names {
            let kind = fixtures::kind(name);
            let blocked = |reason: String| {
                json!({"fixture": name, "kind": kind, "result": "BLOCKED", "golden": null, "pixel_hash": null,
                    "pipelines": [], "passes": [], "findings": [], "reason": reason})
            };
            if !INSTRUMENTED.contains(&kind) {
                if !uncovered.contains(&kind) {
                    uncovered.push(kind);
                }
                list.push(blocked(format!("the validation lane can't instrument {kind} shaders, so {name} is unchecked")));
                continue;
            }
            match &canary {
                Ok(true) if api && shader => {}
                Ok(_) => {
                    list.push(blocked(format!("Metal's validation isn't reporting on this device (API {api}, shader {shader}): the lane's canary read out of bounds went unreported")));
                    continue;
                }
                Err(e) => {
                    list.push(blocked(format!("the lane can't read Metal's reports: {e}")));
                    continue;
                }
            }
            let (ran, log) = match captured(&out, name, || fixtures::run(&device, name, true, planted)) {
                Ok((Ok(ran), log)) => (ran, log),
                Ok((Err(e), _)) | Err(e) => {
                    list.push(blocked(e));
                    continue;
                }
            };
            let mut findings: Vec<Value> = reports(&log)
                .into_iter()
                .map(|(pipeline, buffer)| {
                    let binding = ran
                        .buffers
                        .iter()
                        .find(|(label, ..)| *label == buffer)
                        .map(|(_, group, binding)| json!({"group": group, "binding": binding}));
                    json!({"finding": "out_of_bounds", "pipeline": pipeline, "buffer": buffer, "binding": binding})
                })
                .collect();
            findings.extend(non_finite(&ran));
            let result = if ran.golden && findings.is_empty() { "PASS" } else { "FAIL" };
            list.push(json!({
                "fixture": name, "kind": kind, "result": result, "golden": if ran.golden { "PASS" } else { "FAIL" },
                "pixel_hash": hex(&ran.bytes), "pipelines": ran.pipelines, "passes": ran.passes, "findings": findings,
            }));
        }
        json!({
            "lane": {"api_validation": api, "shader_validation": shader, "bounds_checks": false},
            "uncovered": uncovered,
            "fixtures": list,
        })
    })
}

/// `{"call": "check_render", "fixture", "declares"?: [{"kind", "contains"}]}`: a check that
/// renders the fixture against its golden and reads the device's uncaptured-error callback for
/// the whole render; it passes only when the golden does and every error raised was declared.
pub fn check_render(app: &mut App, call: &Value) -> Value {
    let Some(name) = call["fixture"].as_str().filter(|n| fixtures::known(n)) else {
        return refused("bad_input", "check_render takes a fixture");
    };
    let declares: Vec<(String, String)> = call["declares"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|d| {
            let text = |k: &str| d[k].as_str().unwrap_or_default().to_string();
            (text("kind"), text("contains"))
        })
        .collect();
    let (name, planted) = (name.to_string(), app.planted);
    // Planted (`reads_pixels_only`): a runner that never reads the error channel.
    let reads_errors = planted != Some(Planted::ReadsPixelsOnly);
    app.worker.call(move |state| {
        let device = state.gpu.device();
        // What the device raised before this check isn't this check's.
        device.take_raised();
        let golden = fixtures::run(&device, &name, false, planted).is_ok_and(|r| r.golden);
        let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
        let raised = if reads_errors {
            device.take_raised()
        } else {
            Vec::new()
        };
        let errors: Vec<Value> = raised
            .iter()
            .map(|e| {
                let declared = declares
                    .iter()
                    .any(|(k, c)| k == e.kind && e.error.contains(c.as_str()));
                json!({"kind": e.kind, "error": e.error, "declared": declared})
            })
            .collect();
        let clean = errors.iter().all(|e| e["declared"] == true);
        json!({
            "fixture": name,
            "result": if golden && clean { "PASS" } else { "FAIL" },
            "golden": if golden { "PASS" } else { "FAIL" },
            "errors": errors,
        })
    })
}
