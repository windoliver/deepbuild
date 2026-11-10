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
use deep_scene3d_render::surface::{Surface, Upscale};
use deep_scene3d_render::{Counts, Module3, Planted as Planted3, Profiler};
use serde_json::{json, Value};

use crate::worker::{Scene3Session, Worker, SLOTS, WORKERS};
use crate::{effects, refused, App, Planted};

pub use deep_scene3d_render::status::lock;

pub(crate) fn planted3(p: Option<Planted>) -> Planted3 {
    Planted3 {
        forward_z: p == Some(Planted::ForwardZ),
        emission_thresholds_color: p == Some(Planted::EmissionThresholdsColor),
        sample_grad_implicit: p == Some(Planted::SampleGradImplicit),
        backdrop_after_see_through: p == Some(Planted::BackdropAfterSeeThrough),
        encodes_twice: p == Some(Planted::EncodesTwice),
        skips_encode: p == Some(Planted::SkipsEncode),
        encodes_every_frame: p == Some(Planted::EncodesEveryFrame),
        replays_after_add: p == Some(Planted::ReplaysAfterAdd),
        slow_gpu_frame: p == Some(Planted::SlowGpuFrame),
        builds_on_first_frame: p == Some(Planted::CompilesOnFirstFrame),
        upscale: upscale_planted(p),
        outlines_before_upscale: p == Some(Planted::OutlinesBeforeUpscale),
        status_before_upscale: p == Some(Planted::StatusBeforeUpscale),
        status_without_depth: p == Some(Planted::StatusWithoutDepth),
        winding_ignores_determinant: p == Some(Planted::WindingIgnoresDeterminant),
        water: deep_scene3d_render::water::Planted {
            foam_keeps_state: p == Some(Planted::WaterFoamKeepsState),
            calm_ignores_shore: p == Some(Planted::ShoreCalmIgnoresField),
        },
        flare: deep_scene3d_render::flare::Planted {
            fixed_ghosts: p == Some(Planted::FlareFixedGhosts),
            ignores_occlusion: p == Some(Planted::FlareIgnoresOcclusion),
        },
        ties_by_submission: p == Some(Planted::TiesBySubmission),
        spot_counts_cone: p == Some(Planted::SpotCountsCone),
        status_before_tone_map: p == Some(Planted::StatusBeforeToneMap),
        labels_before_upscale: p == Some(Planted::LabelsBeforeUpscale),
        band_masks_independent: p == Some(Planted::BandMasksIndependent),
        anisotropy_one: p == Some(Planted::AnisotropyOne),
        premixed_metallic: p == Some(Planted::PremixedMetallic),
        uncompensated_lobe: p == Some(Planted::UncompensatedLobe),
        compensates_environment_only: p == Some(Planted::CompensatesEnvironmentOnly),
        draws_black: p == Some(Planted::DrawsBlack),
        drops_clouds: p == Some(Planted::DropsClouds),
        cascade_cache_keeps_stale: p == Some(Planted::CascadeCacheKeepsStale),
        prefilter_over_frames: p == Some(Planted::PrefilterOverFrames),
        add_writes_depth: p == Some(Planted::AddWritesDepth),
        add_without_depth_test: p == Some(Planted::AddWithoutDepthTest),
        ids_by_draw_position: p == Some(Planted::IdsByDrawPosition),
        ids_ignore_mask: p == Some(Planted::IdsIgnoreMask),
        cuts_color_only: p == Some(Planted::CutsColorOnly),
        local: deep_scene3d_render::local::Planted {
            stale: p == Some(Planted::LocalMapStale),
            ignores_t: p == Some(Planted::LocalMapIgnoresT),
            any_t: p == Some(Planted::LocalMapRekeysOnAnyT),
            ignores_cut: p == Some(Planted::CutKeyOmitsPlanes),
            ies_peak: p == Some(Planted::IesPeakNormalized),
            unsnapped: p == Some(Planted::CascadeUnsnapped),
            no_reach: p == Some(Planted::CascadeNoPenumbraReach),
            noise_from_frame: p == Some(Planted::SoftNoiseFromFrame),
            filter_in_texels: p == Some(Planted::CascadeFilterInTexels),
        },
        cull: deep_scene3d_render::cull::Plants {
            centers: p == Some(Planted::GpuCullByCenter),
            reversed: p == Some(Planted::CompactInReverse),
            row_as_element: p == Some(Planted::RowAsElement),
            occlusion_by_centre: p == Some(Planted::OcclusionByCentre),
        },
        ids_by_compacted_place: p == Some(Planted::IdsByCompactedRow),
        count_read_back: p == Some(Planted::CountReadBack),
        pyramid_from_previous_frame: p == Some(Planted::PyramidFromPreviousFrame),
        occlusion_in_cascades: p == Some(Planted::OcclusionInCascades),
        occlusion_in_probe_captures: p == Some(Planted::OcclusionInProbeCaptures),
        // #428's and #481's shading plants, a bit each in scene3d.wgsl's order.
        lobes: [
            Planted::AbsorptionIgnoresThickness,
            Planted::TransmissionIgnoresRoughness,
            Planted::DispersionSamplesOnce,
            Planted::SpecularColorIgnored,
            Planted::IridescenceIgnoresThickness,
            Planted::DiffuseLambert,
            Planted::OrenNayarUncompensated,
            Planted::RetroreflectionIgnored,
            Planted::FlakesByPixel,
            // #481's.
            Planted::SubsurfaceAcrossParts,
            Planted::SubsurfaceAddsToDiffuse,
            // #486's.
            Planted::LobeOutputScalesField,
            Planted::OcclusionScalesDirect,
            Planted::BumpIgnoresHandedness,
            Planted::CoatNormalBendsBase,
        ]
        .iter()
        .position(|q| p == Some(*q))
        .map_or(0, |i| 16 << i),
        ..msaa_planted(p)
    }
}

/// #1173's wrong programs alone, which every scene3d render takes, the live window's and the
/// canonical ones too.
pub(crate) fn msaa_planted(p: Option<Planted>) -> Planted3 {
    Planted3 {
        single_sample: matches!(
            p,
            Some(Planted::SingleSampleTargets | Planted::ClaimsMsaaOverSingleSample)
        ),
        resolve_accumulates: p == Some(Planted::ResolveAccumulatesFrames),
        missing_lobe_turned_on: p == Some(Planted::MissingLobeTurnedOn),
        ..Default::default()
    }
}

/// The upscale's wrong programs (#386).
pub fn upscale_planted(p: Option<Planted>) -> deep_scene3d_render::surface::Planted {
    deep_scene3d_render::surface::Planted {
        bilinear_only: p == Some(Planted::BilinearOnly),
        reads_previous_frame: p == Some(Planted::UpscaleReadsPreviousFrame),
        slow: p == Some(Planted::SlowUpscale),
    }
}

/// The session's handles the driver keeps.
pub struct Opened {
    pub ui: Ui,
    pub fx: Arc<Mutex<Effects>>,
    pub profiler: Option<Profiler>,
    /// The status stage, attached only where status can show.
    pub stage: Option<SharedStage>,
    /// #149: what a drawing look lays over this frame's surfaces.
    pub drawn: Arc<Mutex<crate::drawn::Frame3>>,
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

/// [`open`] for a document whose composed operators (#429) the effects chain runs: their passes
/// are the view's from its first frame.
pub fn open_doc(
    app: &mut App,
    size: [u32; 2],
    timings: bool,
    with_stage: bool,
    doc: &Value,
) -> Result<Opened, Value> {
    let (options, planted) = effects::operator_plants(app.planted);
    let hooks = effects::operator_hooks(app.planted);
    let doc = doc.clone();
    let on = On::of(app);
    open_with(&on, size, timings, with_stage, move |fx| {
        fx.op_doc = Some((doc, options, planted));
        fx.op_hooks = hooks;
    })
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
    open_with(on, size, timings, with_stage, |_| {})
}

fn open_with(
    on: &On,
    size: [u32; 2],
    timings: bool,
    with_stage: bool,
    setup: impl FnOnce(&mut Effects) + Send + 'static,
) -> Result<Opened, Value> {
    let planted = planted3(on.planted);
    let path = on.path;
    let fx_planted = effects::planted_fx(on.planted);
    let timings = timings && on.backend != Backend::Noop;
    let drawn3 = Arc::new(Mutex::new(crate::drawn::Frame3::default()));
    let opened3 = drawn3.clone();
    on.worker
        .call(move |state| -> Result<Opened, String> {
            let (module, shared) = Module3::new(planted);
            // The shipped effects run between scene3d's geometry and its output (#380).
            let mut effects = Effects::new(Default::default(), fx_planted);
            setup(&mut effects);
            let fx = Arc::new(Mutex::new(effects));
            let drawn = crate::drawn::Post3::new(
                Box::new(fx::Shared(fx.clone())),
                drawn3.clone(),
                fx.clone(),
            );
            lock(&shared).post = Some(Box::new(drawn));
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
                drawn: opened3,
            })
        })
        .map_err(|e| refused("no_session", e))
}

/// Sets the GPU surface the session's view draws through, compiling the upscale's pipelines
/// before its first frame below scale 1 (#386).
pub fn surface(app: &mut App, surface: Surface) -> Result<(), Value> {
    app.worker
        .call(move |state| -> Result<(), String> {
            let s = state.scene3d.as_mut().ok_or("no session")?;
            let device = s.view.device().clone();
            let mut shared = lock(&s.shared);
            let planted = shared.planted;
            let renderer = shared
                .renderer
                .get_or_insert_with(|| deep_scene3d_render::Renderer::new(&device, planted));
            renderer.surface = surface;
            if surface.scale < 1.0 && renderer.upscale.is_none() {
                renderer.upscale = Some(Arc::new(Upscale::new(&device)));
            }
            Ok(())
        })
        .map_err(|e| refused("no_session", e))
}

/// The core targets the session's frames build (#431): only those its operators read.
pub fn core_targets(app: &mut App, want: deep_scene3d_render::targets::Want) -> Result<(), Value> {
    app.worker
        .call(move |state| -> Result<(), String> {
            let s = state.scene3d.as_mut().ok_or("no session")?;
            let device = s.view.device().clone();
            let mut shared = lock(&s.shared);
            let planted = shared.planted;
            let renderer = shared
                .renderer
                .get_or_insert_with(|| deep_scene3d_render::Renderer::new(&device, planted));
            renderer.core.want = want;
            Ok(())
        })
        .map_err(|e| refused("no_session", e))
}

/// Each pass's band masks of the item picked as `key` at blend `level`, as the last frame's
/// draws evaluate them (#425): `(pass, size, one byte a pixel)`.
pub fn masks(app: &mut App, key: u32, level: u32) -> Vec<(&'static str, [u32; 2], Vec<u8>)> {
    use deep_scene3d_render::MaskPass;
    app.worker.call(move |state| {
        let Some(s) = state.scene3d.as_ref() else {
            return Vec::new();
        };
        let device = s.view.device().clone();
        let shared = lock(&s.shared);
        let Some(r) = shared.renderer.as_ref() else {
            return Vec::new();
        };
        [
            ("color", MaskPass::Color),
            ("depth", MaskPass::Depth),
            ("shadow", MaskPass::Shadow),
            ("ids", MaskPass::Ids),
        ]
        .into_iter()
        .filter_map(|(name, pass)| {
            let (size, bytes) = r.mask_dump(&device, pass, key, level)?;
            Some((name, size, bytes))
        })
        .collect()
    })
}

/// Culls the camera's lists by occlusion too, or by the frustum alone (a view's `occlusion:
/// off`, #1637).
pub fn set_occlusion(app: &mut App, on: bool) {
    app.worker.call(move |state| {
        if let Some(s) = state.scene3d.as_ref() {
            if let Some(r) = lock(&s.shared).renderer.as_mut() {
                r.set_occlusion(on);
            }
        }
    })
}

/// Which whole solids each pass of the frame just drawn drew (#1637).
pub fn kept_items(app: &mut App) -> Vec<(String, Vec<String>)> {
    app.worker.call(|state| {
        let Some(s) = state.scene3d.as_ref() else {
            return Vec::new();
        };
        let device = s.view.device().clone();
        let shared = lock(&s.shared);
        shared
            .renderer
            .as_ref()
            .map_or(Vec::new(), |r| r.read_kept_items(&device))
    })
}

/// Draws the session from the CPU's f64 cull (#484).
pub fn cull_on_cpu(app: &mut App) {
    app.worker.call(|state| {
        if let Some(s) = state.scene3d.as_ref() {
            if let Some(r) = lock(&s.shared).renderer.as_mut() {
                r.cull_on_cpu();
            }
        }
    })
}

/// What each culled list of the frame just drawn kept (#484).
pub fn kept(app: &mut App) -> Vec<deep_scene3d_render::KeptRow> {
    app.worker.call(|state| {
        let Some(s) = state.scene3d.as_ref() else {
            return Vec::new();
        };
        let device = s.view.device().clone();
        let shared = lock(&s.shared);
        shared
            .renderer
            .as_ref()
            .map_or(Vec::new(), |r| r.read_kept(&device))
    })
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

/// The surface's `msaa` and the targets the session's geometry pass draws into (#1173).
pub fn render_targets(app: &mut App) -> (Value, Value) {
    let claims = app.planted == Some(Planted::ClaimsMsaaOverSingleSample);
    app.worker
        .call(move |state| {
            let s = state.scene3d.as_ref()?;
            let shared = lock(&s.shared);
            Some(msaa(shared.renderer.as_ref()?, claims))
        })
        .unwrap_or((Value::Null, Value::Null))
}

/// `renderer`'s sample count, as the surface reports it (4 under the planted claim), and its
/// geometry pass's targets.
pub(crate) fn msaa(renderer: &deep_scene3d_render::Renderer, claims: bool) -> (Value, Value) {
    let targets = renderer.render_targets();
    let count = if claims {
        deep_scene3d_render::MSAA
    } else {
        targets[0].1
    };
    let listed: Vec<Value> = targets
        .iter()
        .map(|(name, n)| json!({"name": name, "sample_count": n}))
        .collect();
    (json!(count), json!(listed))
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
    /// The linear image the output pass read, f32 RGBA, read with the targets (#418).
    pub pre_tone: Option<Vec<u8>>,
    /// The frame's GPU time and each pass's share, ms.
    pub timing: Option<(f64, std::collections::BTreeMap<String, f64>)>,
    /// What the passes' declared costs price this frame at, ms (#1637).
    pub declared: Vec<(&'static str, f64)>,
    /// How many pixels the status guard moved, when the stage ran and the frame asked.
    pub moved: Option<u32>,
    /// With timings: the GPU memory the device holds as the frame draws (#383).
    pub gpu_bytes: Option<u64>,
    /// The depth target, f32 per pixel, read with the targets, and whether it grows nearer: what
    /// a 3D pick's ties read (#424).
    pub depth: Option<(Vec<u8>, bool)>,
    /// The opaque scene's copy with its mips, read with the targets while the frame holds one
    /// (#431): each level's size and f32 RGBA texels.
    pub backdrop: Option<Vec<([u32; 2], Vec<u8>)>>,
    /// #166: the view-axis depth, f32 a pixel, and each mirror part's lookup, f32 RGBA.
    pub view_depth: Option<Vec<u8>>,
    pub reflection: Option<Vec<u8>>,
    /// #268: the water's foam share, f32 a pixel.
    pub foam: Option<Vec<u8>>,
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
            let again = (scene.clone(), look.clone());
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
            let mut drawn = loop {
                if let Some(d) = s.view.render(n)? {
                    break d;
                }
                s.view.wait_free();
            };
            s.view.wait_done(drawn.slot);
            let device = s.view.device().clone();
            // #424: per-pixel items that ran out of room below the class's cap draw the frame
            // again with more room; at the cap they drew sorted and the frame says so.
            while !noop
                && lock(&s.shared)
                    .renderer
                    .as_mut()
                    .is_some_and(|r| r.check_fragments(&device))
            {
                lock(&s.shared).next = Some(again.clone());
                drawn = loop {
                    if let Some(d) = s.view.render(n)? {
                        break d;
                    }
                    s.view.wait_free();
                };
                s.view.wait_done(drawn.slot);
            }
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
                pre_tone: if read_targets && !noop {
                    r.read_pre_tone(&device)
                } else {
                    None
                },
                view_depth: if read_targets && !noop {
                    r.read_view_depth(&device)
                } else {
                    None
                },
                reflection: if read_targets && !noop {
                    r.read_reflection(&device)
                } else {
                    None
                },
                foam: if read_targets && !noop {
                    r.read_foam(&device)
                } else {
                    None
                },
                backdrop: if read_targets && !noop {
                    r.read_backdrop(&device)
                } else {
                    None
                },
                depth: if read_targets && !noop {
                    r.read_depth(&device).map(|d| (d, r.depth_grows_nearer()))
                } else {
                    None
                },
                gpu_bytes: profiler2
                    .as_ref()
                    .and_then(|_| deep_gpu::memory::allocated(&device)),
                timing,
                declared: r.declared_ms(),
                moved,
            })
        })
        .map_err(|e| refused("render_failed", e))
}
