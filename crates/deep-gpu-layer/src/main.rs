//! `deep-gpu run [--backend noop] [--planted <name>]` (issue #377; tests/acceptance/377/README.md,
//! The surface under test): one JSON scenario per stdin line, `{"out": dir, "calls": [Call]}`,
//! answered with one line `{"ok": true, "replies": [Reply]}`. Every call of a run uses one app: one
//! GPU (one wgpu device), one headless window, and each scene's session from call to call.

mod compare;
mod compile;
mod conformance;
mod frames;
mod plugin;
mod reference;
mod scene;
mod view3d;
mod window;
mod worker;

use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::Arc;

use deep_gpu::device::{Backend, Gpu};
use deep_gpu::guard::Declarations;
use deep_gpu::surface::Path;
use gpui_kit::HeadlessAppContext;
use serde_json::{json, Value};

use crate::scene::Scene;
use crate::window::Win;
use crate::worker::Worker;

/// The wrong programs, each reachable only through `--planted` (README: Planted programs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    DividesAlpha,
    DrawsSurfacesAfterScene,
    SubmitsOnCompletion,
    ReleasesBeforeCompletion,
    WaitsOnGpu,
    CompilesOnUiThread,
    ExposesGpuToPanels,
    /// #378's wrong programs (tests/acceptance/378/README.md: Planted programs).
    ForwardZ,
    EncodesTwice,
    SkipsEncode,
    EncodesEveryFrame,
    ReplaysAfterAdd,
    PairsNewestSlot,
}

impl Planted {
    fn parse(name: &str) -> Option<Planted> {
        Some(match name {
            "divides_alpha" => Planted::DividesAlpha,
            "draws_surfaces_after_scene" => Planted::DrawsSurfacesAfterScene,
            "submits_on_completion" => Planted::SubmitsOnCompletion,
            "releases_before_completion" => Planted::ReleasesBeforeCompletion,
            "waits_on_gpu" => Planted::WaitsOnGpu,
            "compiles_on_ui_thread" => Planted::CompilesOnUiThread,
            "exposes_gpu_to_panels" => Planted::ExposesGpuToPanels,
            "forward_z" => Planted::ForwardZ,
            "encodes_twice" => Planted::EncodesTwice,
            "skips_encode" => Planted::SkipsEncode,
            "encodes_every_frame" => Planted::EncodesEveryFrame,
            "replays_after_add" => Planted::ReplaysAfterAdd,
            "pairs_newest_slot" => Planted::PairsNewestSlot,
            _ => return None,
        })
    }
}

/// The handoff the surface takes, as the last conformance run decided it.
pub struct Decision {
    pub path: Path,
    pub fps_cap: Option<u32>,
    pub internal_scale: f64,
    /// Health readings: one per failed conformance part.
    pub readings: Vec<Value>,
}

pub struct App {
    pub cx: HeadlessAppContext,
    pub worker: Worker,
    pub backend: Backend,
    pub planted: Option<Planted>,
    pub decision: Decision,
    pub declarations: Declarations,
    /// Dark declarations in the order they were recorded.
    pub dark: Vec<(String, String)>,
    pub window: Option<Win>,
    pub scenes: HashMap<String, Arc<Scene>>,
    /// Each scene session's UI side, routed GPUI's surface reports.
    pub watched: HashMap<String, deep_gpu::view::Ui>,
}

pub fn refused(code: &str, reason: impl Into<String>) -> Value {
    json!({"code": code, "reason": reason.into()})
}

impl App {
    pub fn scene(&mut self, path: &str) -> Result<Arc<Scene>, Value> {
        if let Some(s) = self.scenes.get(path) {
            return Ok(s.clone());
        }
        let scene = Arc::new(Scene::load(path).map_err(|e| refused("bad_input", e))?);
        self.scenes.insert(path.to_string(), scene.clone());
        Ok(scene)
    }

    /// The run's window at `size`, opened (or reopened at another size).
    pub fn window(&mut self, size: [u32; 2]) -> Result<&Win, Value> {
        if self.window.as_ref().is_none_or(|w| w.size != size) {
            if let Some(old) = self.window.take() {
                old.close(&mut self.cx);
            }
            self.window = Some(Win::open(&mut self.cx, size).map_err(|e| refused("no_window", e))?);
        }
        Ok(self.window.as_ref().expect("opened above"))
    }

    fn backend_name(&self) -> &'static str {
        match self.backend {
            Backend::Noop => "noop",
            Backend::Gpu if cfg!(target_os = "macos") => "metal",
            Backend::Gpu => "gpu",
        }
    }

    fn surface(&mut self) -> Value {
        let backend = self.backend_name();
        let (fps_cap, internal_scale) = (self.decision.fps_cap, self.decision.internal_scale);
        let decided = self.decision.path;
        self.worker.call(move |state| {
            let device = json!({"backend": backend, "count": Gpu::count()});
            let Some(s) = state.current() else {
                return json!({"device": device, "path": decided.name(), "size_px": [0, 0], "scale": 1, "internal_scale": internal_scale,
                    "format": "bgra8_premultiplied", "color_space": "srgb", "slots": [], "msaa": "transient", "fps_cap": fps_cap});
            };
            let slots: Vec<Value> = s.view.ui().states().iter().map(|st| json!({"state": st.name()})).collect();
            json!({
                "device": device,
                "path": s.path.name(),
                "size_px": s.view.config().size,
                "scale": 1,
                "internal_scale": internal_scale,
                "format": "bgra8_premultiplied",
                "color_space": "srgb",
                "slots": slots,
                "msaa": "transient",
                "fps_cap": fps_cap,
            })
        })
    }

    fn resources(&mut self) -> Value {
        self.worker.call(|state| {
            let epoch = state.gpu.device().epoch;
            let mut out = Vec::new();
            for s in state.sessions.values() {
                let module = s.view.module();
                let built = module.built_on().unwrap_or(0);
                for d in module.declared() {
                    let (name, kind) = d.split_once(':').unwrap_or((d, "resource"));
                    out.push(json!({"module": module.name(), "name": format!("{}/{name}", s.scene.name), "kind": kind, "device_epoch": built}));
                }
                for (i, built) in s.view.slots_built().into_iter().enumerate() {
                    if built {
                        out.push(json!({"module": "gpu.surface", "name": format!("{}/slot {i}", s.scene.name), "kind": "texture", "device_epoch": s.view.device().epoch}));
                    }
                }
            }
            json!({"device_epoch": epoch, "resources": out})
        })
    }

    fn buffer(&mut self, call: &Value) -> Value {
        let size = call["size"].as_u64().unwrap_or(0);
        let writes: Vec<(u64, Vec<u8>)> = call["writes"]
            .as_array()
            .map(|w| {
                w.iter()
                    .map(|x| {
                        let bytes = x["bytes"]
                            .as_array()
                            .map(|b| b.iter().map(|v| v.as_u64().unwrap_or(0) as u8).collect())
                            .unwrap_or_default();
                        (x["offset"].as_u64().unwrap_or(0), bytes)
                    })
                    .collect()
            })
            .unwrap_or_default();
        self.worker.call(move |state| {
            let device = match state.gpu.recover() {
                Ok(d) => d,
                Err(e) => return refused("no_device", e),
            };
            let d = &device.device;
            let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("deep-gpu buffer call"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            });
            for (offset, bytes) in &writes {
                device.queue.write_buffer(&buffer, *offset, bytes);
            }
            let staging = d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("deep-gpu buffer read back"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            let mut encoder = d.create_command_encoder(&Default::default());
            encoder.copy_buffer_to_buffer(&buffer, 0, &staging, 0, size);
            device.queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            staging.slice(..).map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            let _ = d.poll(wgpu::PollType::wait_indefinitely());
            if !matches!(rx.recv(), Ok(Ok(()))) {
                return refused("no_read_back", "the buffer didn't map");
            }
            let read: Vec<u8> = match staging.slice(..).get_mapped_range() {
                Ok(data) => data.to_vec(),
                Err(e) => return refused("no_read_back", e.to_string()),
            };
            json!({"size": size, "read": read})
        })
    }

    fn health(&self) -> Value {
        json!({"readings": self.decision.readings})
    }

    fn call(&mut self, out: &str, call: &Value) -> Value {
        match call["call"].as_str() {
            Some("frames") => frames::call(self, out, call),
            Some("surface") => self.surface(),
            Some("resources") => self.resources(),
            Some("health") => self.health(),
            Some("buffer") => self.buffer(call),
            Some("conformance") => conformance::call(self, out, call),
            Some("render") => frames::render(self, call),
            Some("compile") => compile::call(self, call),
            Some("compare") => compare::compare(self, call),
            Some("declare_dark") => compare::declare(self, call),
            Some("decisions") => compare::decisions(self),
            Some("plugin") => plugin::call(self, call),
            Some("view3d") => view3d::call(self, out, call),
            _ => refused("bad_input", "unknown call"),
        }
    }
}

fn bad_input() -> ! {
    println!("{}", json!({"ok": false, "code": "bad_input"}));
    std::process::exit(2);
}

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("run") {
        bad_input();
    }
    let (mut backend, mut planted) = (Backend::Gpu, None);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--backend" => match args.next().as_deref() {
                Some("noop") => backend = Backend::Noop,
                _ => bad_input(),
            },
            "--planted" => match args.next().as_deref().and_then(Planted::parse) {
                Some(p) => planted = Some(p),
                None => bad_input(),
            },
            _ => bad_input(),
        }
    }
    #[cfg(target_os = "macos")]
    {
        use gpui_apple::metal_renderer::gpu_surfaces::{plant, Planted as Patch};
        plant(match planted {
            Some(Planted::DividesAlpha) => Patch::DividesAlpha,
            Some(Planted::DrawsSurfacesAfterScene) => Patch::AfterScene,
            _ => Patch::None,
        });
    }
    let worker = match Worker::start(
        backend,
        planted == Some(Planted::SubmitsOnCompletion),
        planted == Some(Planted::ReleasesBeforeCompletion),
    ) {
        Ok(w) => w,
        Err(e) => {
            println!("{}", json!({"ok": false, "code": "no_device", "reason": e}));
            std::process::exit(1);
        }
    };
    // The platform's handoff as this task ships it: macOS passed the conformance fixture, so it
    // hands off zero copy until a conformance run on this machine says otherwise; the noop backend
    // has no surface to share, so it copies.
    let path = if cfg!(target_os = "macos") && backend == Backend::Gpu {
        Path::ZeroCopy
    } else {
        Path::Copy
    };
    let mut app = App {
        cx: deep_replica::headless_context(),
        worker,
        backend,
        planted,
        decision: Decision {
            path,
            fps_cap: None,
            internal_scale: 1.,
            readings: Vec::new(),
        },
        declarations: Declarations::default(),
        dark: Vec::new(),
        window: None,
        scenes: HashMap::new(),
        watched: HashMap::new(),
    };
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(sc) if sc["calls"].is_array() && sc["out"].is_string() => {
                let out = sc["out"].as_str().unwrap_or_default().to_string();
                let replies: Vec<Value> = sc["calls"]
                    .as_array()
                    .expect("checked above")
                    .iter()
                    .map(|c| app.call(&out, c))
                    .collect();
                json!({"ok": true, "replies": replies})
            }
            _ => json!({"ok": false, "code": "bad_input"}),
        };
        let _ = writeln!(stdout, "{answer}");
        let _ = stdout.flush();
    }
}
