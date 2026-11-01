//! A `view3d` or `host` call's session on the render thread (issues #378, #382): one GPU-layer
//! view drawing scene3d through the shipped effects and, where status can show, the status stage
//! after the finish; and one frame drawn into a free slot, its bytes and targets read back.

use std::sync::{Arc, Mutex};

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::Scene;
use deep_effects_render::frame::{self as fx, Effects};
use deep_gpu::device::Backend;
use deep_gpu::encode::Pool;
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, Ui, View};
use deep_scene3d_render::status::{self, SharedStage, Stage};
use deep_scene3d_render::{Counts, Module3, Planted as Planted3, Profiler};
use serde_json::Value;

use crate::worker::{Scene3Session, Worker, SLOTS, WORKERS};
use crate::{effects, refused, App, Planted};

pub use deep_scene3d_render::status::lock;

fn planted3(p: Option<Planted>) -> Planted3 {
    Planted3 {
        forward_z: p == Some(Planted::ForwardZ),
        encodes_twice: p == Some(Planted::EncodesTwice),
        skips_encode: p == Some(Planted::SkipsEncode),
        encodes_every_frame: p == Some(Planted::EncodesEveryFrame),
        replays_after_add: p == Some(Planted::ReplaysAfterAdd),
        slow_gpu_frame: p == Some(Planted::SlowGpuFrame),
        builds_on_first_frame: p == Some(Planted::CompilesOnFirstFrame),
    }
}

/// The session's handles the driver keeps.
pub struct Opened {
    pub ui: Ui,
    pub fx: Arc<Mutex<Effects>>,
    pub profiler: Option<Profiler>,
    /// The status stage, attached only where status can show.
    pub stage: Option<SharedStage>,
}

/// Opens the session: a view at `size` whose render module is scene3d with the effects between
/// geometry and output and, with `with_stage`, the status guard and the status colors after.
pub fn open(
    app: &mut App,
    size: [u32; 2],
    timings: bool,
    with_stage: bool,
) -> Result<Opened, Value> {
    open_on(&On::of(app), size, timings, with_stage)
}

/// What a session runs on: the render thread, the handoff its slots take, the backend and the
/// planted program. The headless canvas worker has these and no app (#140).
pub struct On<'a> {
    pub worker: &'a Worker,
    pub path: Path,
    pub backend: Backend,
    pub planted: Option<Planted>,
}

impl On<'_> {
    pub fn of(app: &App) -> On<'_> {
        On {
            worker: &app.worker,
            path: app.decision.path,
            backend: app.backend,
            planted: app.planted,
        }
    }
}

/// [`open`] on `on`.
pub fn open_on(on: &On, size: [u32; 2], timings: bool, with_stage: bool) -> Result<Opened, Value> {
    let planted = planted3(on.planted);
    let path = on.path;
    let fx_planted = effects::planted_fx(on.planted);
    let timings = timings && on.backend != Backend::Noop;
    on.worker
        .call(move |state| -> Result<Opened, String> {
            let (module, shared) = Module3::new(planted);
            // The shipped effects run between scene3d's geometry and its output (#380).
            let fx = Arc::new(Mutex::new(Effects::new(Default::default(), fx_planted)));
            lock(&shared).post = Some(Box::new(fx::Shared(fx.clone())));
            let stage = if with_stage {
                let device = state.gpu.recover()?;
                let stage = Arc::new(Mutex::new(Stage::new(&device)));
                lock(&shared).after = Some(Box::new(status::Shared(stage.clone())));
                Some(stage)
            } else {
                None
            };
            let profiler = if timings {
                let p =
                    wgpu_profiler::GpuProfiler::new(&state.gpu.device().device, Default::default())
                        .map_err(|e| e.to_string())?;
                Some(Arc::new(Mutex::new(p)))
            } else {
                None
            };
            let config = Config {
                path,
                slots: SLOTS,
                size,
                upload_bytes_per_frame: 64 << 20,
            };
            let view = View::new(
                state.gpu.clone(),
                config,
                Box::new(module),
                Pool::new(WORKERS),
            )?;
            let ui = view.ui();
            state.scene3d = Some(Scene3Session { view, shared });
            Ok(Opened {
                ui,
                fx,
                profiler,
                stage,
            })
        })
        .map_err(|e| refused("no_session", e))
}

/// The pipelines the session's renderer compiled so far, by name (#854).
pub fn pipelines(app: &mut App) -> Vec<&'static str> {
    app.worker.call(|state| {
        state.scene3d.as_ref().map_or_else(Vec::new, |s| {
            lock(&s.shared)
                .renderer
                .as_ref()
                .map_or_else(Vec::new, |r| r.compiled_names().to_vec())
        })
    })
}

pub fn close(app: &mut App) {
    close_on(&app.worker);
}

/// [`close`] on the render thread `worker`.
pub fn close_on(worker: &Worker) {
    worker.call(|state| state.scene3d = None);
}

/// What the render thread answers for one frame.
pub struct Drawn {
    pub slot: usize,
    /// The frame reports settling: uploads were still pending when it drew (#140).
    pub settling: bool,
    pub counts: Counts,
    pub picks: Vec<(String, u32)>,
    /// The slot's BGRA bytes.
    pub bytes: Option<Vec<u8>>,
    pub targets: Option<(Vec<u8>, Vec<u8>)>,
    /// The frame's GPU time and each pass's share, ms.
    pub timing: Option<(f64, std::collections::BTreeMap<String, f64>)>,
    /// How many pixels the status guard moved, when the stage ran and the frame asked.
    pub moved: Option<u32>,
    /// With timings: the GPU memory the device holds as the frame draws (#383).
    pub gpu_bytes: Option<u64>,
}

/// Draws frame `n` of `scene` under `look`: the frame is rendered into a free slot and waited
/// for; `delay` holds the slot (#377's latency fixture); `read_targets` reads the linear and ID
/// targets back; `read_moved` reads the guard's count.
#[allow(clippy::too_many_arguments)]
pub fn draw(
    app: &mut App,
    opened: &Opened,
    scene: Arc<Scene>,
    look: Look3,
    n: u64,
    delay: u64,
    read_targets: bool,
    read_moved: bool,
) -> Result<Drawn, Value> {
    draw_on(
        &On::of(app),
        opened,
        scene,
        look,
        n,
        delay,
        read_targets,
        read_moved,
    )
}

/// [`draw`] on `on`.
#[allow(clippy::too_many_arguments)]
pub fn draw_on(
    on: &On,
    opened: &Opened,
    scene: Arc<Scene>,
    look: Look3,
    n: u64,
    delay: u64,
    read_targets: bool,
    read_moved: bool,
) -> Result<Drawn, Value> {
    let noop = on.backend == Backend::Noop;
    let (fx2, profiler2, stage) = (
        opened.fx.clone(),
        opened.profiler.clone(),
        opened.stage.clone(),
    );
    on.worker
        .call(move |state| -> Result<Drawn, String> {
            let s = state.scene3d.as_mut().ok_or("no session")?;
            {
                let mut shared = lock(&s.shared);
                shared.next = Some((scene, look));
                if let Some(r) = shared.renderer.as_mut() {
                    r.profiler = profiler2.clone();
                }
            }
            lock(&fx2).profiler = profiler2.clone();
            if let Some(stage) = &stage {
                lock(stage).profiler = profiler2.clone();
            }
            if delay > 0 {
                s.view.hold_next();
            }
            let drawn = loop {
                if let Some(d) = s.view.render(n)? {
                    break d;
                }
                s.view.wait_free();
            };
            s.view.wait_done(drawn.slot);
            let device = s.view.device().clone();
            // The frame's GPU time, as its passes' timestamp queries measured it.
            let timing = profiler2.as_ref().map(|p| {
                let mut p = lock(p);
                let mut enc = device.device.create_command_encoder(&Default::default());
                p.resolve_queries(&mut enc);
                device.queue.submit([enc.finish()]);
                let _ = p.end_frame();
                let _ = device.device.poll(wgpu::PollType::wait_indefinitely());
                p.process_finished_frame(device.queue.get_timestamp_period())
                    .map(|r| fx::timings(&r))
                    .unwrap_or_default()
            });
            let bytes = (!noop).then(|| s.view.read(drawn.slot)).flatten();
            let moved = match (&stage, read_moved && !noop) {
                (Some(stage), true) => lock(stage).moved(&device),
                _ => None,
            };
            let shared = lock(&s.shared);
            let r = shared.renderer.as_ref().ok_or("no renderer")?;
            Ok(Drawn {
                slot: drawn.slot,
                settling: drawn.settling,
                counts: r.counts().clone(),
                picks: r.picks().iter().map(|(k, v)| (k.clone(), *v)).collect(),
                bytes,
                targets: if read_targets && !noop {
                    r.read_targets(&device)
                } else {
                    None
                },
                gpu_bytes: profiler2
                    .as_ref()
                    .and_then(|_| deep_gpu::memory::allocated(&device)),
                timing,
                moved,
            })
        })
        .map_err(|e| refused("render_failed", e))
}
