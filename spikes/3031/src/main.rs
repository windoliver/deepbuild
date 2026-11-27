//! Spike #3031: what a 3D frame holds and how often it draws depth, read without a change to the
//! renderer.
//!
//! Usage: spike-3031 frames|overdraw --doc FILE --look FILE --frames N --fps F --out DIR
//!                   [--lease-wait S]
//!
//! `frames` draws the document's frames offscreen through the scene renderer's public entry
//! (`draw_offscreen_texture`), on a device opened as the app's is but with wgpu's API trace on,
//! and with the Metal device's own texture and buffer calls listed. It writes, under DIR:
//! `trace/trace.ron` (every call the frames made of the device, a buffer named
//! `spike3031 frame <k>` marking where frame k starts), `frames.jsonl` (each frame's time, camera,
//! the device's allocated size after it and the renderer's own draw counts), `resources.json`
//! (what the device held after the last frame, that frame's snapshot still held, beside the
//! device's allocated size read in the same moment) and `solids.json` (the first frame's solids).
//!
//! `overdraw` draws each frame in the renderer's own overdraw view (`draw_offscreen_diag`) and
//! writes `overdraw.jsonl`: the view's own largest count and, from the buffer the view read its
//! count target back into, how many pixels took each count.
//!
//! Frame k is at k ÷ F seconds of the document's clock. Both modes take the machine's GPU lease,
//! waiting up to `--lease-wait` seconds (600), and say so when they ran without it. Prints one
//! JSON summary; exits 0 when the run finished, 1 with `BLOCKED` and why when it could not.

mod held;

use std::collections::BTreeMap;
use std::ffi::c_void;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas::camera::Offsets;
use deep_canvas_scene3d::frames::Frames;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::samples::Method;
use deep_canvas_scene3d::scene::{Labels, Scene};
use deep_effects_render::velocity::{motion, Pairing};
use deep_gpu::device::{Backend, Device, Gpu};
use deep_gpu::seam::{self, Startup};
use deep_scene3d_render::{draw_offscreen_diag, draw_offscreen_texture, Diag, Planted, Renderer};
use serde_json::{json, Value};

/// Flicks a second: the unit of a document's time.
const FLICKS: i64 = 705_600_000;

struct Args {
    mode: String,
    doc: PathBuf,
    look: PathBuf,
    frames: u32,
    fps: u32,
    out: PathBuf,
    lease_wait: u64,
}

fn usage(e: &str) -> ! {
    eprintln!("spike-3031: {e}\nusage: spike-3031 frames|overdraw --doc FILE --look FILE --frames N --fps F --out DIR [--lease-wait S]");
    std::process::exit(2)
}

fn args() -> Args {
    let mut it = std::env::args().skip(1);
    let mode = it.next().unwrap_or_default();
    if mode != "frames" && mode != "overdraw" {
        usage("the first argument is frames or overdraw");
    }
    let (mut doc, mut look, mut out) = (None, None, None);
    let (mut frames, mut fps, mut lease_wait) = (300u32, 5u32, 600u64);
    while let Some(a) = it.next() {
        let mut value = || it.next().unwrap_or_else(|| usage(&format!("{a} takes a value")));
        match a.as_str() {
            "--doc" => doc = Some(PathBuf::from(value())),
            "--look" => look = Some(PathBuf::from(value())),
            "--out" => out = Some(PathBuf::from(value())),
            "--frames" => frames = value().parse().unwrap_or_else(|_| usage("--frames N")),
            "--fps" => fps = value().parse().unwrap_or_else(|_| usage("--fps F")),
            "--lease-wait" => lease_wait = value().parse().unwrap_or_else(|_| usage("--lease-wait S")),
            _ => usage(&format!("unknown argument {a}")),
        }
    }
    if frames == 0 || fps == 0 {
        usage("--frames and --fps are at least 1");
    }
    Args {
        mode,
        doc: doc.unwrap_or_else(|| usage("no --doc")),
        look: look.unwrap_or_else(|| usage("no --look")),
        frames,
        fps,
        out: out.unwrap_or_else(|| usage("no --out")),
        lease_wait,
    }
}

/// The machine's GPU lease (`~/.cache/deepbuild-gpu/lease`, as the kit and exports take it with
/// no hub): `Err` names the live GPU job that still held it when the wait ended.
struct Lease(Option<PathBuf>);

impl Lease {
    fn take(wait_s: u64) -> Result<Lease, String> {
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let dir = home.unwrap_or_else(std::env::temp_dir).join(".cache").join("deepbuild-gpu");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("lease");
        let until = std::time::Instant::now() + std::time::Duration::from_secs(wait_s);
        loop {
            let made = std::fs::OpenOptions::new().write(true).create_new(true).open(&file);
            if let Ok(mut f) = made {
                let _ = write!(f, "{}", std::process::id());
                return Ok(Lease(Some(file)));
            }
            let holder: Option<i32> = std::fs::read_to_string(&file).ok().and_then(|s| s.trim().parse().ok());
            let alive = holder.is_some_and(|pid| {
                std::process::Command::new("kill").args(["-0", &pid.to_string()]).status().is_ok_and(|s| s.success())
            });
            if !alive {
                // A lease whose holder is gone was left by a killed run.
                let _ = std::fs::remove_file(&file);
                continue;
            }
            if std::time::Instant::now() >= until {
                return Err(format!("pid {}", holder.unwrap_or_default()));
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(f) = &self.0 {
            let _ = std::fs::remove_file(f);
        }
    }
}

/// How a run's summary names its lease: `file`, or who held it instead.
fn leased(lease: &Result<Lease, String>) -> String {
    match lease {
        Ok(_) => "file".to_string(),
        Err(by) => format!("not held: {by} held it"),
    }
}

/// A document played frame by frame.
struct Play {
    frames: Frames,
    labels: Labels,
    look: Look3,
    size: [u32; 2],
    count: u32,
    fps: u32,
}

impl Play {
    fn open(args: &Args) -> Result<Play, String> {
        let read = |p: &Path| -> Result<Value, String> {
            let text = std::fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?;
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))
        };
        let doc = read(&args.doc)?;
        let look = Look3::read(&read(&args.look)?).map_err(|e| format!("the look is refused: {e}"))?;
        let side = |k: usize| doc["size"][k].as_u64().map(|v| v as u32);
        let size = [side(0), side(1)];
        let [Some(w), Some(h)] = size else {
            return Err("the document has no size".into());
        };
        let mut labels = Labels::new();
        let frames = Frames::new(&doc, &look, &mut labels)
            .map_err(|r| format!("the document is refused: {}: {}", r.code, r.path))?;
        Ok(Play { frames, labels, look, size: [w, h], count: args.frames, fps: args.fps })
    }

    fn time(&self, k: u32) -> i64 {
        i64::from(k) * FLICKS / i64::from(self.fps)
    }

    /// The scene at `t`.
    fn at(&mut self, t: i64) -> Result<Scene, String> {
        let scene = self.frames.at(t, self.size, &Offsets::default(), &mut self.labels);
        let scene = scene.map_err(|r| format!("the frame at {t} is refused: {}: {}", r.code, r.path))?;
        Ok(scene.clone())
    }

    /// Frame `k`'s scene as a view draws it: under a look that blurs by velocity, with the travel
    /// between the evaluations at t − s/2 and t + s/2, paired as the shipped view pairs them.
    fn scene(&mut self, k: u32) -> Result<Scene, String> {
        let t = self.time(k);
        let blur = self.look.blur.clone().filter(|b| b.method == Method::Velocity);
        let Some(blur) = blur else {
            return self.at(t);
        };
        let half = (blur.shutter_s(f64::from(self.fps)) * FLICKS as f64 / 2.0).round() as i64;
        let open = self.at((t - half).max(0))?;
        let close = self.at(t + half)?;
        let mut scene = self.at(t)?;
        let (travel, _) = motion(&scene, &open, &close, Pairing::Shipped, &blur);
        scene.motion = Some(Arc::new(travel));
        Ok(scene)
    }
}

/// The Mac the run was on, as the reference Macs are named, with when, its power source and its
/// load.
fn host() -> Value {
    let read = |cmd: &str, args: &[&str]| {
        let out = std::process::Command::new(cmd).args(args).output().ok()?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (!text.is_empty()).then_some(text)
    };
    let power = read("pmset", &["-g", "batt"]).and_then(|s| s.lines().next().map(str::to_string));
    json!({
        "model": read("sysctl", &["-n", "hw.model"]),
        "chip": read("sysctl", &["-n", "machdep.cpu.brand_string"]),
        "os": "macOS", "os_version": read("sw_vers", &["-productVersion"]),
        "os_build": read("sw_vers", &["-buildVersion"]),
        "date": read("date", &["-u", "+%Y-%m-%dT%H:%M:%S.000Z"]),
        "power": power, "load": read("sysctl", &["-n", "vm.loadavg"]),
    })
}

fn adapter(a: &wgpu::AdapterInfo) -> Value {
    json!({"name": a.name, "backend": format!("{:?}", a.backend), "device_type": format!("{:?}", a.device_type), "driver": a.driver_info})
}

fn file(dir: &Path, name: &str) -> Result<std::fs::File, String> {
    std::fs::File::create(dir.join(name)).map_err(|e| format!("{name}: {e}"))
}

fn line(f: &mut std::fs::File, row: &Value) -> Result<(), String> {
    writeln!(f, "{row}").map_err(|e| e.to_string())
}

/// The scene's solids as the renderer names them: each one's layer, ID, feature set and what
/// decides which depth passes draw it.
fn solids(scene: &Scene) -> Vec<Value> {
    let mut out = Vec::new();
    for layer in &scene.layers {
        for s in &layer.solids {
            out.push(json!({
                "layer": layer.id, "id": s.id, "feature_set": deep_scene3d_render::created::feature_set(s),
                "shape": format!("{:?}", s.shape), "mesh_indices": s.mesh.as_ref().map(|m| m.indices.len()),
                "material": s.material.is_some(), "alpha": s.alpha,
                "batch": s.batch, "cast_shadow": s.cast_shadow, "cast_only": s.cast_only, "per_pixel": s.per_pixel,
            }));
        }
    }
    out
}

/// Has the Metal device under `device` list every texture and buffer it makes from now on; the
/// calls it could not swap, which go unlisted.
fn listed(device: &Device) -> Result<Vec<&'static str>, String> {
    // SAFETY: only reads the raw device's address, to find its class.
    let hal = unsafe { device.device.as_hal::<wgpu::hal::api::Metal>() };
    let hal = hal.ok_or("the device is not Metal's, so nothing reports what it holds")?;
    let object: *const c_void = std::ptr::from_ref(&**hal.raw_device()).cast();
    Ok(held::install(object))
}

fn raised(device: &Device) -> Vec<String> {
    let all = device.take_raised().into_iter();
    all.map(|r| format!("{}: {}", r.kind, r.error)).collect()
}

fn frames_mode(args: &Args) -> Result<Value, String> {
    let mut play = Play::open(args)?;
    let trace = args.out.join("trace");
    std::fs::create_dir_all(&trace).map_err(|e| format!("{}: {e}", trace.display()))?;
    // The app's device, as `deep_gpu::device::Device::open` asks for it, with the API trace on.
    let choice = seam::pick(&Startup::default()).map_err(|r| format!("no GPU: {}", r.reason))?;
    let limits = choice.raw.limits();
    let (raw, queue) = pollster::block_on(choice.raw.request_device(&wgpu::DeviceDescriptor {
        label: Some("deep-gpu"),
        required_features: choice.request,
        required_limits: wgpu::Limits {
            max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
            max_buffer_size: limits.max_buffer_size,
            max_bind_groups: limits.max_bind_groups,
            ..Default::default()
        },
        trace: wgpu::Trace::Directory(trace),
        ..Default::default()
    }))
    .map_err(|e| format!("no GPU device: {e}"))?;
    let info = choice.raw.get_info();
    let device: Arc<Device> = Device::from_parts(raw, queue, choice.request, info.clone());
    let unlisted = listed(&device)?;
    deep_gpu::memory::drain(&device);
    let at_open = deep_gpu::memory::allocated(&device);
    let lease = Lease::take(args.lease_wait);

    let mut renderer = Renderer::new(&device, Planted::default());
    let mut rows = file(&args.out, "frames.jsonl")?;
    let mut peak = 0u64;
    let mut held_frame: Option<(wgpu::Texture, Scene)> = None;
    for k in 0..play.count {
        let scene = play.scene(k)?;
        if k == 0 {
            let first = json!({"size": scene.size, "solids": solids(&scene)});
            line(&mut file(&args.out, "solids.json")?, &first)?;
        }
        // The frame before lets go of its snapshot inside its own part of the trace.
        drop(held_frame.take());
        held::frame(i64::from(k));
        drop(device.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(&format!("spike3031 frame {k}")),
            size: 4,
            usage: wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
        let texture = draw_offscreen_texture(&device, &mut renderer, &scene, &play.look, None);
        deep_gpu::memory::drain(&device);
        let allocated = deep_gpu::memory::allocated(&device);
        peak = peak.max(allocated.unwrap_or(0));
        let c = renderer.counts();
        let cam = &scene.camera;
        let row = json!({
            "frame": k, "t": play.time(k), "eye": cam.eye, "target": cam.target, "forward": cam.forward,
            "allocated": allocated,
            "draws": c.draws.iter().map(|(of, mesh, material, n)| json!([of, mesh, material, n])).collect::<Vec<_>>(),
            "indirect": c.indirect.iter().map(|(of, view, batch)| json!([of, view, batch])).collect::<Vec<_>>(),
            "encoded": c.encoded.iter().map(|(batch, items)| json!([batch, items])).collect::<Vec<_>>(),
            "indirect_draws": c.indirect_draws, "culls": c.culls, "pyramid": c.pyramid,
            "cascades_drawn": c.cascades_drawn, "local_maps": c.local_maps.len(), "replayed": c.replayed,
        });
        line(&mut rows, &row)?;
        held_frame = Some((texture, scene));
    }
    // What the device holds for the last frame, its snapshot among it, beside the device's own
    // total read in the same moment.
    deep_gpu::memory::drain(&device);
    let allocated = deep_gpu::memory::allocated(&device);
    let resources = held::live();
    let (_, scene) = held_frame.as_ref().ok_or("no frame was drawn")?;
    let estimate = deep_scene3d_render::held::of(scene);
    let glass = |s: &deep_canvas_scene3d::scene::Solid| s.material.as_ref().is_some_and(|m| m.lobes.transmission > 0.0);
    let on = json!({
        "mirror": scene.mirror.is_some(), "flare": scene.flare.is_some(), "dof": scene.dof.is_some(),
        "motion_blur": scene.motion.is_some(), "sky": scene.sky.is_some(), "cascaded_sun": scene.cascaded(),
        "ao": play.look.ao.is_some(), "local_tone": play.look.local.is_some(),
        "glass": scene.layers.iter().flat_map(|l| &l.solids).any(glass),
    });
    let listing = json!({
        "size": play.size, "frames": play.count, "allocated": allocated, "allocated_at_open": at_open, "peak": peak,
        "estimate": {"per_px": estimate.per_px, "fixed": estimate.fixed}, "on": on,
        "unlisted_calls": unlisted, "resources": resources,
    });
    line(&mut file(&args.out, "resources.json")?, &listing)?;
    Ok(json!({
        "adapter": adapter(&info), "lease": leased(&lease),
        "size": play.size, "frames": play.count, "fps": play.fps, "on": on,
        "allocated": allocated, "allocated_at_open": at_open, "peak": peak,
        "listed": resources.len(), "unlisted_calls": unlisted, "raised": raised(&device),
    }))
}

/// A half float's value.
fn half(bits: u16) -> f32 {
    let (sign, exp, frac) = (bits >> 15, (bits >> 10) & 0x1f, bits & 0x3ff);
    let v = match exp {
        0 => f32::from(frac) * 2f32.powi(-24),
        31 => f32::INFINITY,
        e => (1.0 + f32::from(frac) / 1024.0) * 2f32.powi(i32::from(e) - 15),
    };
    if sign == 1 {
        -v
    } else {
        v
    }
}

fn overdraw_mode(args: &Args) -> Result<Value, String> {
    let mut play = Play::open(args)?;
    let gpu = Gpu::open(Backend::Gpu).map_err(|e| format!("no GPU: {e}"))?;
    let device = gpu.device();
    let unlisted = listed(&device)?;
    let lease = Lease::take(args.lease_wait);
    let mut renderer = Renderer::new(&device, Planted::default());
    // The view reads its count target (a half float a pixel) back into a buffer of this many
    // bytes: rows padded to the copy's alignment, as the renderer's read-back lays them out.
    let [w, h] = play.size.map(|v| v as usize);
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize;
    let padded = (w * 2).div_ceil(align) * align;
    held::keep(padded * h);
    let mut rows = file(&args.out, "overdraw.jsonl")?;
    for k in 0..play.count {
        let scene = play.at(play.time(k))?;
        drop(held::kept());
        let drawn = draw_offscreen_diag(&device, &mut renderer, &scene, &play.look, &Diag::Overdraw);
        let (_, counts) = drawn.ok_or("the device can't read the view back")?;
        let mut kept = held::kept();
        let (Some(bytes), true) = (kept.pop(), kept.is_empty()) else {
            return Err(format!("frame {k}: the view's count read-back was not the one buffer of {} bytes", padded * h));
        };
        if bytes.len() < padded * h {
            return Err(format!("frame {k}: the count read-back holds {} bytes, not {}", bytes.len(), padded * h));
        }
        let mut histogram: BTreeMap<u32, u64> = BTreeMap::new();
        for row in bytes.chunks_exact(padded).take(h) {
            for px in row[..w * 2].chunks_exact(2) {
                let n = half(u16::from_le_bytes([px[0], px[1]])).round() as u32;
                *histogram.entry(n).or_default() += 1;
            }
        }
        let largest = histogram.keys().next_back().copied().unwrap_or(0);
        if largest != counts.max_overdraw {
            return Err(format!("frame {k}: the read-back's largest count is {largest}, the view's own is {}", counts.max_overdraw));
        }
        let cells: serde_json::Map<String, Value> = histogram.iter().map(|(n, px)| (n.to_string(), json!(px))).collect();
        let cam = &scene.camera;
        let row = json!({
            "frame": k, "t": play.time(k), "eye": cam.eye, "target": cam.target, "forward": cam.forward,
            "max_overdraw": counts.max_overdraw, "histogram": cells,
        });
        line(&mut rows, &row)?;
    }
    held::keep(0);
    Ok(json!({
        "adapter": device.adapter.as_ref().map(adapter), "lease": leased(&lease),
        "size": play.size, "frames": play.count, "fps": play.fps,
        "unlisted_calls": unlisted, "raised": raised(&device),
    }))
}

fn main() {
    let args = args();
    if let Err(e) = std::fs::create_dir_all(&args.out) {
        usage(&format!("{}: {e}", args.out.display()));
    }
    let ran = match args.mode.as_str() {
        "frames" => frames_mode(&args),
        _ => overdraw_mode(&args),
    };
    let doc = args.doc.display().to_string();
    let mut out = json!({"issue": 3031, "mode": args.mode, "doc": doc, "look": args.look.display().to_string(), "host": host()});
    let code = match ran {
        Ok(Value::Object(more)) => {
            out["status"] = json!("RAN");
            for (k, v) in more {
                out[k.as_str()] = v;
            }
            0
        }
        Ok(_) => 1,
        Err(why) => {
            out["status"] = json!("BLOCKED");
            out["reason"] = json!(format!("BLOCKED: {why}"));
            1
        }
    };
    let text = serde_json::to_string_pretty(&out).unwrap_or_default();
    let _ = std::fs::write(args.out.join(format!("{}.json", args.mode)), format!("{text}\n"));
    println!("{text}");
    std::process::exit(code);
}
