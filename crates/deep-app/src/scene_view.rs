//! Issue #2494: a 3D writer layer in the app's canvas panel, drawn through a GPU-layer view (the owner's decision on
//! the issue). The panel hands the view a revision's canonical document by its hash in the evidence store, so the
//! view draws only what the canvas core checked. A render thread evaluates it through `deep-play`, as render-back
//! does, and scene3d's render module draws it into the view's slots on the app's one device, zero copy; the UI thread
//! only latches the newest slot, paints it in place ([`crate::gpu_view`]) and asks for the next frame. A frame is
//! asked for when the last one's `valid_until` has passed on the display's clock (Transport), so a still document
//! draws once. A revision the view can't evaluate or draw gives its reason, which the panel shows in the layer's place.

use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock};
use std::time::Instant;

use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use deep_canvas_scene3d::contributed::Fills;
use deep_canvas_scene3d::scene::Labels;
use deep_gpu::device::{Backend, Gpu};
use deep_gpu::encode::Pool;
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, Ui, View};
use deep_scene3d_render::{Module3, Shared};
use gpui_kit::{px, size, Bounds, Pixels, Window};
use serde_json::Value;

/// Flicks a second (canvas primitives: Time and the flick).
const FLICKS: u128 = 705_600_000;

/// The handoff every view takes (GPU surface: `path`).
pub(crate) const PATH: Path = Path::ZeroCopy;

/// The canvas modules the view draws a document with.
const HELD: [&str; 2] = ["scene3d", "motion"];

/// The app's one device for its GPU-layer views (GPU surface: `device: one per app`), opened with the first 3D layer.
static GPU: OnceLock<Result<Arc<Gpu>, String>> = OnceLock::new();

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// #2494's fixture: the read-back buffers the app's device has made, 0 while it has opened none.
#[cfg(feature = "canvas-fixture")]
pub(crate) fn readback_buffers() -> u64 {
    let gpu = GPU.get().and_then(|gpu| gpu.as_ref().ok());
    gpu.map_or(0, |gpu| gpu.device().device.counts().read().readbacks)
}

enum Ask {
    /// A revision's canonical document, by its hash in the evidence store.
    Scene(String),
    /// A frame at `t` flicks on the view's clock, fitted in `room` px.
    Frame { t: i64, room: [u32; 2] },
    /// #2494's fixture: the bytes of the slot that holds a frame, and its size.
    #[cfg(feature = "canvas-fixture")]
    Read(u64, mpsc::Sender<Option<(Vec<u8>, [u32; 2])>>),
}

/// What the render thread tells the panel.
#[derive(Clone, Default)]
struct Told {
    ui: Option<Ui>,
    /// Frames answered, drawn or not, and the last one drawn, as its slot carries it, with its size in px.
    answered: u64,
    drawn: u64,
    size: [u32; 2],
    /// When the frame drawn last changes next, on the view's clock; none for a still one.
    valid_until: Option<i64>,
    /// Why the view draws nothing.
    reason: Option<String>,
}

/// The panel's side of one layer's view.
pub struct SceneView {
    asks: mpsc::Sender<Ask>,
    told: Arc<Mutex<Told>>,
    render: std::thread::JoinHandle<()>,
    /// When the view's clock started.
    started: Instant,
    /// Frames asked for, the room the last was asked for in px, and whether the view holds a revision no frame
    /// was asked for yet.
    asked: u64,
    room: [u32; 2],
    fresh: bool,
    /// #2494's fixture: the frame the last paint latched.
    #[cfg(feature = "canvas-fixture")]
    pub(crate) latched: Option<u64>,
}

impl SceneView {
    /// A view whose documents and assets are read from `evidence`; its render thread ends with it.
    pub fn new(evidence: PathBuf) -> SceneView {
        let (asks, asked) = mpsc::channel();
        let told = Arc::new(Mutex::new(Told::default()));
        let theirs = told.clone();
        SceneView {
            asks,
            told,
            render: std::thread::spawn(move || render(evidence, asked, theirs)),
            started: Instant::now(),
            asked: 0,
            room: [0, 0],
            fresh: false,
            #[cfg(feature = "canvas-fixture")]
            latched: None,
        }
    }

    /// Takes a revision: its canonical document, by its hash.
    pub fn show(&mut self, scene: &str) {
        let _ = self.asks.send(Ask::Scene(scene.to_owned()));
        self.fresh = true;
    }

    /// Why the view draws nothing, when it can't. A render thread that ended under the view, as on a panic, is one.
    pub fn reason(&self) -> Option<String> {
        let mut told = lock(&self.told);
        if self.render.is_finished() {
            told.reason
                .get_or_insert_with(|| "render_thread_ended".to_owned());
        }
        told.reason.clone()
    }

    /// Paints the newest ready slot in `bounds`, from its top left at the size its frame fits there, and returns
    /// the frame it holds. A frame that is due is asked for, one at a time, and while one is under way, not shown
    /// yet or still to come, the window draws again.
    pub fn paint(&mut self, bounds: Bounds<Pixels>, window: &mut Window) -> Option<u64> {
        let told = lock(&self.told).clone();
        let side = |i: usize| px(told.size[i] as f32 / window.scale_factor());
        let fitted = Bounds {
            origin: bounds.origin,
            size: size(side(0), side(1)),
        };
        let shown = (told.ui.as_ref()).and_then(|ui| crate::gpu_view::paint(ui, fitted, window));
        #[cfg(feature = "canvas-fixture")]
        {
            self.latched = shown;
        }
        if told.reason.is_some() && !self.fresh {
            return shown;
        }
        let device =
            |side: Pixels| (f32::from(side) * window.scale_factor()).round().max(1.) as u32;
        let room = [device(bounds.size.width), device(bounds.size.height)];
        let t = (self.started.elapsed().as_nanos() * FLICKS / 1_000_000_000) as i64;
        let under_way = self.asked > told.answered;
        let due = self.fresh || room != self.room || told.valid_until.is_some_and(|v| v <= t);
        if due && !under_way {
            (self.fresh, self.room, self.asked) = (false, room, self.asked + 1);
            let _ = self.asks.send(Ask::Frame { t, room });
        }
        if due || under_way || told.valid_until.is_some() || shown.unwrap_or(0) != told.drawn {
            window.request_animation_frame();
        }
        shown
    }

    /// #2494's fixture: the bytes the slot holding `frame` holds, as GPUI samples them, and the slot's size.
    #[cfg(feature = "canvas-fixture")]
    pub(crate) fn read(&self, frame: u64) -> Option<(Vec<u8>, [u32; 2])> {
        let (to, from) = mpsc::channel();
        self.asks.send(Ask::Read(frame, to)).ok()?;
        from.recv().ok()?
    }
}

/// The view on the app's device: three slots handed off zero copy, drawn by scene3d's render module.
fn open() -> Result<(View, Arc<Mutex<Shared>>), String> {
    let gpu = GPU.get_or_init(|| Gpu::open(Backend::Gpu)).clone()?;
    let (module, shared) = Module3::new(Default::default());
    let config = Config {
        path: PATH,
        slots: 3,
        size: [1, 1],
        upload_bytes_per_frame: 64 << 20,
    };
    Ok((
        View::new(gpu, config, Box::new(module), Pool::new(1))?,
        shared,
    ))
}

/// What `doc` draws with that the view doesn't hold, so it is never drawn in part: a canvas module its `requires`
/// names; marks2d for a 2D item, which render-back draws over the 3D frame; or a part of the frame render-back's
/// host makes: the document's own look, a shot's camera pose, an arrangement's solved places, a view overlay.
fn lacks(doc: &Value) -> Option<String> {
    let requires = doc.pointer("/requires/modules").and_then(Value::as_object);
    let module = requires.and_then(|m| m.keys().find(|k| !HELD.contains(&k.as_str())));
    let items = doc["items"]
        .as_object()
        .into_iter()
        .flat_map(|i| i.values());
    let kind = items.filter_map(|i| i["kind"].as_str()).find_map(|k| {
        let flat = deep_canvas_marks::scene::KINDS.contains(&k);
        let hosted = ["arrange@1", "overlay.view@1"].contains(&k);
        (flat.then(|| missing("marks2d"))).or(hosted.then(|| absent(k)))
    });
    let field = ["look", "shots"].into_iter().find(|f| doc.get(f).is_some());
    (module.map(|m| missing(m))).or(kind).or(field.map(absent))
}

/// The reason for a canvas module the view doesn't hold.
fn missing(module: &str) -> String {
    crate::copy::fill("views.module_missing", &[&module])
}

/// The reason for a part of the frame the view doesn't draw.
fn absent(what: &str) -> String {
    crate::copy::fill("views.feature_absent", &[&what])
}

/// `doc`'s frame scaled to fit `room` px, as render-back fits a layer's picture to its panel.
fn fitted(doc: &Value, room: [u32; 2]) -> [u32; 2] {
    let side = |i: usize| doc["size"][i].as_f64().unwrap_or(1.0).max(1.0);
    let scale = (f64::from(room[0]) / side(0)).min(f64::from(room[1]) / side(1));
    [0, 1].map(|i| ((side(i) * scale).round() as u32).clamp(1, room[i]))
}

/// A revision's canonical document and its motion program, or why the view can't draw it.
fn load(bytes: Option<Vec<u8>>) -> Result<(Value, Program), String> {
    let doc: Value = (bytes.and_then(|b| serde_json::from_slice(&b).ok()))
        .ok_or("asset_missing: the revision's document")?;
    if let Some(why) = lacks(&doc) {
        return Err(why);
    }
    let program = Program::compile(
        doc.as_object()
            .ok_or("out_of_range: the revision's document")?,
    )
    .map_err(|r| format!("{}: {}", r.code, r.path))?;
    Ok((doc, program))
}

/// The render thread: the view, its renderer and each frame's evaluation, off the UI thread, until the panel lets
/// the view go.
fn render(evidence: PathBuf, asks: mpsc::Receiver<Ask>, told: Arc<Mutex<Told>>) {
    let (mut view, shared) = match open() {
        Ok(opened) => opened,
        Err(why) => {
            lock(&told).reason = Some(why);
            return;
        }
    };
    let ui = view.ui();
    crate::gpu_view::watch(&ui);
    lock(&told).ui = Some(ui.clone());
    let palette = deep_canvas_marks::modules::clean().light;
    let read = |sha: &str| std::fs::read(evidence.join(sha.get(..2)?).join(sha.get(2..)?)).ok();
    let mut scene = Err(String::new());
    let mut labels = Labels::new();
    let mut frame = 0;
    #[cfg(feature = "canvas-fixture")]
    let mut slots: Vec<(u64, usize, [u32; 2])> = Vec::new();
    for ask in asks {
        let (t, room) = match ask {
            Ask::Scene(sha) => {
                scene = load(read(&sha));
                labels = Labels::new();
                lock(&told).reason = scene.as_ref().err().cloned();
                continue;
            }
            Ask::Frame { t, room } => (t, room),
            #[cfg(feature = "canvas-fixture")]
            Ask::Read(frame, to) => {
                let slot = slots.iter().find(|(f, ..)| *f == frame);
                let _ = to.send(slot.and_then(|(_, slot, size)| Some((view.read(*slot)?, *size))));
                continue;
            }
        };
        frame += 1;
        // The frame at `t`: evaluated as render-back evaluates it, drawn into a free slot and waited for here, never
        // on the UI thread. With no free slot the frame is skipped.
        let drawn = scene
            .as_ref()
            .map_err(String::clone)
            .and_then(|(doc, program)| {
                let size = fitted(doc, room);
                view.resize(size);
                let fills = Fills {
                    outlines: &[],
                    module: &[],
                    planted: None,
                    memo: None,
                };
                let px = size.map(|side| u16::try_from(side).unwrap_or(u16::MAX));
                let (evaluated, look) =
                    deep_play::scene::evaluate(doc, t, &palette, px, &mut labels, &read, fills)
                        .map_err(|r| format!("{}: {}", r.code, r.path))?;
                // What render-back's host draws into or over the frame: a map's texels, an inset's picture, a readout.
                let maps = !deep_canvas_scene3d::light::map_uses(&evaluated).is_empty();
                let hosted = [
                    (maps, "maps"),
                    (!evaluated.pictures.is_empty(), "insets"),
                    (!evaluated.readouts.is_empty(), "readouts"),
                ];
                if let Some((_, what)) = hosted.iter().find(|(has, _)| *has) {
                    return Err(absent(what));
                }
                let next = (Arc::new(evaluated), look);
                lock(&shared).next = Some(next.clone());
                let drawn = view.render(frame)?;
                if let Some(d) = &drawn {
                    view.wait_done(d.slot);
                    #[cfg(feature = "canvas-fixture")]
                    {
                        slots.retain(|(_, slot, _)| *slot != d.slot);
                        slots.push((d.frame, d.slot, d.size));
                        // The planted view reads every frame it draws back, as `draw_offscreen` does.
                        if crate::canvas_fixture::reads_back() {
                            if let Some(renderer) = lock(&shared).renderer.as_mut() {
                                let (scene, look) = &next;
                                deep_scene3d_render::draw_offscreen(
                                    view.device(),
                                    renderer,
                                    scene,
                                    look,
                                    None,
                                );
                            }
                        }
                    }
                }
                let mut state = program.state();
                program.evaluate(t, Validity::Full, &mut state);
                Ok((drawn.map(|d| (d.frame, d.size)), state.valid_until))
            });
        let mut told = lock(&told);
        told.answered += 1;
        match drawn {
            Ok((drawn, valid_until)) => {
                (told.drawn, told.size) = drawn.unwrap_or((told.drawn, told.size));
                told.valid_until = valid_until;
            }
            Err(why) => (told.reason, told.valid_until) = (Some(why), None),
        }
    }
    crate::gpu_view::unwatch(&ui);
}

#[cfg(test)]
mod tests {
    use super::{fitted, lacks};
    use serde_json::{json, Value};

    /// A scene the view holds every module for, with `more` written over its fields.
    fn scene(more: Value) -> Value {
        let mut doc = json!({"requires": {"modules": {"scene3d": "^1", "motion": "^1"}},
                             "items": {"box": {"kind": "mark.box@1"}}});
        for (field, value) in more.as_object().into_iter().flatten() {
            doc[field] = value.clone();
        }
        doc
    }

    #[test]
    fn a_frame_fits_its_room_at_the_documents_own_shape() {
        assert_eq!(fitted(&json!({"size": [480, 360]}), [960, 720]), [960, 720]);
        assert_eq!(fitted(&json!({"size": [960, 540]}), [800, 600]), [800, 450]);
        assert_eq!(fitted(&json!({"size": [300, 600]}), [800, 600]), [300, 600]);
    }

    #[test]
    fn a_document_the_view_cannot_draw_whole_gives_its_reason() {
        assert_eq!(lacks(&scene(json!({}))), None);
        let physics = json!({"scene3d": "^1", "physics": "^1"});
        let cases = [
            (
                json!({"requires": {"modules": physics}}),
                "module_missing: physics",
            ),
            (
                json!({"items": {"title": {"kind": "text@1"}}}),
                "module_missing: marks2d",
            ),
            (
                json!({"items": {"set": {"kind": "arrange@1"}}}),
                "feature_absent: arrange@1",
            ),
            (
                json!({"items": {"inset": {"kind": "overlay.view@1"}}}),
                "feature_absent: overlay.view@1",
            ),
            (json!({"look": {"asset": "look@1"}}), "feature_absent: look"),
            (json!({"shots": {}}), "feature_absent: shots"),
        ];
        for (more, why) in cases {
            assert_eq!(lacks(&scene(more)).as_deref(), Some(why));
        }
    }
}
