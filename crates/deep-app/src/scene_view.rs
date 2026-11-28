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

use deep_canvas::camera::Offsets;
use deep_canvas::registry::{BuildSet, Registry, Sealed};
use deep_canvas_effects::particles::spec::Refusal;
use deep_canvas_marks::look::{self, Distance};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use deep_canvas_scene3d::contributed::Fills;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{Assets, Labels};
use deep_effects_render::frame::{Effects, Shared as Post};
use deep_effects_render::scene::{staged, Staged};
use deep_gpu::device::{Backend, Gpu};
use deep_gpu::encode::Pool;
use deep_gpu::surface::Path;
use deep_gpu::view::{Config, Ui, View};
use deep_scene3d_render::{Module3, Shared};
use gpui_kit::{px, size, Bounds, Pixels, Window};
use serde_json::{json, Value};

/// Flicks a second (canvas primitives: Time and the flick).
const FLICKS: u128 = 705_600_000;

/// The handoff every view takes (GPU surface: `path`).
pub(crate) const PATH: Path = Path::ZeroCopy;

const HOSTED: [&str; 3] = ["arrange@1", "overlay.view@1", "overlay.frame@1"];

#[derive(Clone, Debug, PartialEq)]
pub struct Reason {
    pub recorded: String,
    pub shown: String,
}

impl From<String> for Reason {
    fn from(code: String) -> Reason {
        Reason {
            recorded: code.clone(),
            shown: code,
        }
    }
}

impl From<&str> for Reason {
    fn from(code: &str) -> Reason {
        code.to_owned().into()
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Session {
    pub playhead: Option<i64>,
    pub offsets: Offsets,
}

impl Session {
    pub fn of(state: &Value) -> Option<Session> {
        let user = state.pointer("/camera/user")?;
        let pan = user["pan"].as_array()?;
        let axis = |i: usize| pan.get(i).and_then(Value::as_f64);
        Some(Session {
            playhead: state.pointer("/view/playhead").and_then(Value::as_i64),
            offsets: Offsets {
                azimuth: user["azimuth"].as_f64()?,
                elevation: user["elevation"].as_f64()?,
                zoom: user["zoom"].as_f64()?,
                pan: [axis(0)?, axis(1)?, axis(2)?],
            },
        })
    }
}

fn held() -> Result<&'static Sealed, Reason> {
    static HELD: OnceLock<Result<Sealed, String>> = OnceLock::new();
    let sealed = HELD.get_or_init(|| {
        let modules = [
            deep_canvas_marks::modules::text(),
            deep_canvas_marks::modules::look(),
            deep_canvas_marks::modules::marks2d(),
            deep_canvas_motion::module::module(),
            deep_canvas_scene3d::module::module(),
            deep_canvas_effects::module::module(),
            deep_canvas_scene3d::building::module(),
        ];
        let registry = modules
            .into_iter()
            .fold(Registry::new(BuildSet::Full), Registry::with);
        registry
            .seal()
            .map_err(|e| format!("{}: {}", e.code, e.what))
    });
    sealed.as_ref().map_err(|why| why.clone().into())
}

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
    Frame {
        t: i64,
        room: [u32; 2],
        offsets: Offsets,
    },
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
    t: Option<i64>,
    /// Why the view draws nothing.
    reason: Option<Reason>,
    #[cfg(feature = "canvas-fixture")]
    times: Vec<(u64, i64)>,
}

/// The panel's side of one layer's view.
pub struct SceneView {
    asks: mpsc::Sender<Ask>,
    told: Arc<Mutex<Told>>,
    render: std::thread::JoinHandle<()>,
    clock: (Instant, i64),
    session: Session,
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
            clock: (Instant::now(), 0),
            session: Session::default(),
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

    pub fn steer(&mut self, session: Session) {
        #[cfg(feature = "canvas-fixture")]
        let session = Session {
            playhead: (session.playhead).filter(|_| !crate::canvas_fixture::keeps_own_clock()),
            ..session
        };
        if session == self.session {
            return;
        }
        if let (Some(at), None) = (self.session.playhead, session.playhead) {
            self.clock = (Instant::now(), at);
        }
        self.session = session;
        self.fresh = true;
    }

    fn t(&self) -> i64 {
        let (since, from) = self.clock;
        let played = from + (since.elapsed().as_nanos() * FLICKS / 1_000_000_000) as i64;
        self.session.playhead.unwrap_or(played)
    }

    /// Why the view draws nothing, when it can't. A render thread that ended under the view, as on a panic, is one.
    pub fn reason(&self) -> Option<Reason> {
        let mut told = lock(&self.told);
        if self.render.is_finished() {
            told.reason
                .get_or_insert_with(|| "render_thread_ended".into());
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
        let t = self.t();
        let playing = self.session.playhead.is_none();
        let under_way = self.asked > told.answered;
        let stale = match playing {
            true => told.valid_until.is_some_and(|v| v <= t),
            false => told.t != Some(t),
        };
        let due = self.fresh || room != self.room || stale;
        if due && !under_way {
            (self.fresh, self.room, self.asked) = (false, room, self.asked + 1);
            let offsets = self.session.offsets;
            let _ = self.asks.send(Ask::Frame { t, room, offsets });
        }
        let moving = playing && told.valid_until.is_some();
        if due || under_way || moving || shown.unwrap_or(0) != told.drawn {
            window.request_animation_frame();
        }
        shown
    }

    #[cfg(feature = "canvas-fixture")]
    pub(crate) fn time_of(&self, frame: u64) -> Option<i64> {
        let told = lock(&self.told);
        told.times
            .iter()
            .find(|(f, _)| *f == frame)
            .map(|(_, t)| *t)
    }

    /// #2494's fixture: the bytes the slot holding `frame` holds, as GPUI samples them, and the slot's size.
    #[cfg(feature = "canvas-fixture")]
    pub(crate) fn read(&self, frame: u64) -> Option<(Vec<u8>, [u32; 2])> {
        let (to, from) = mpsc::channel();
        self.asks.send(Ask::Read(frame, to)).ok()?;
        from.recv().ok()?
    }
}

/// A view, what it shares with its renderer, and the effects of its post stage.
type Opened = (View, Arc<Mutex<Shared>>, Arc<Mutex<Effects>>);

/// The view on the app's device: three slots handed off zero copy, drawn by scene3d's render module.
fn open() -> Result<Opened, String> {
    let gpu = GPU.get_or_init(|| Gpu::open(Backend::Gpu)).clone()?;
    let (module, shared) = Module3::new(Default::default());
    // #1719: the post stage render-back draws its frame through.
    let fx = Arc::new(Mutex::new(Effects::new(
        Default::default(),
        Default::default(),
    )));
    lock(&shared).post = Some(Box::new(Post(fx.clone())));
    let config = Config {
        path: PATH,
        slots: 3,
        size: [1, 1],
        upload_bytes_per_frame: 64 << 20,
    };
    Ok((
        View::new(gpu, config, Box::new(module), Pool::new(1))?,
        shared,
        fx,
    ))
}

fn lacks(doc: &Value, held: &Sealed) -> Option<Reason> {
    let requires = doc.pointer("/requires/modules").and_then(Value::as_object);
    let holds = |module: &String| held.modules.iter().any(|m| m.name == *module);
    let module = requires.and_then(|m| m.keys().find(|k| !holds(k)));
    let items = doc["items"]
        .as_object()
        .into_iter()
        .flat_map(|i| i.values());
    let kind = (items.filter_map(|i| i["kind"].as_str())).find(|k| HOSTED.contains(k));
    (module.map(|m| missing(m))).or(kind.map(absent))
}

/// The reason for a canvas module the view doesn't hold.
fn missing(module: &str) -> Reason {
    Reason {
        recorded: crate::copy::english("views.module_missing", &[&module]),
        shown: crate::copy::fill("views.module_missing", &[&module]),
    }
}

/// The reason for a part of the frame the view doesn't draw.
fn absent(what: &str) -> Reason {
    Reason {
        recorded: crate::copy::english("views.feature_absent", &[&what]),
        shown: crate::copy::fill("views.feature_absent", &[&what]),
    }
}

/// `doc`'s frame scaled to fit `room` px, as render-back fits a layer's picture to its panel.
fn fitted(doc: &Value, room: [u32; 2]) -> [u32; 2] {
    let side = |i: usize| doc["size"][i].as_f64().unwrap_or(1.0).max(1.0);
    let scale = (f64::from(room[0]) / side(0)).min(f64::from(room[1]) / side(1));
    [0, 1].map(|i| ((side(i) * scale).round() as u32).clamp(1, room[i]))
}

struct Dressed {
    look: Look3,
    json: Value,
}

fn dressed(doc: &Value, read: Assets<'_>) -> Result<Dressed, Reason> {
    let asset = "/look/asset";
    let unfit = |code: &str| Reason::from(format!("{code}: {}", &asset[1..]));
    let named = doc.pointer(asset).and_then(Value::as_str);
    #[cfg(feature = "canvas-fixture")]
    let named = named.filter(|_| !crate::canvas_fixture::draws_default_look());
    let Some(name) = named else {
        return Ok(Dressed {
            look: Look3::from_roles(deep_canvas_marks::modules::clean().light),
            json: Value::Null,
        });
    };
    let id = name.split('@').next().unwrap_or(name);
    let sha = doc.pointer(&format!("/assets/{id}/sha256"));
    let bytes =
        (sha.and_then(Value::as_str).and_then(read)).ok_or_else(|| unfit("asset_missing"))?;
    let mut json: Value = serde_json::from_slice(&bytes).map_err(|_| unfit("bad_look"))?;
    let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
    let binds = doc["status_bindings"]
        .as_object()
        .is_some_and(|b| !b.is_empty());
    let roles = match binds {
        true => look::resolve_in(&json, &bundled, Distance::Everywhere).map(|l| l.light),
        false => look::light_roles(&json, &bundled),
    };
    let roles = roles.map_err(|r| match r {
        look::Refusal::Font(_) => unfit("font_unshippable"),
        _ => unfit("bad_look"),
    })?;
    for (role, [r, g, b]) in &roles {
        json["roles"][role] = json!(format!("#{r:02x}{g:02x}{b:02x}"));
    }
    let look = Look3::read(&json).map_err(|_| unfit("bad_look"))?;
    let finish = json["finish"].as_array().into_iter().flatten();
    let operator = finish
        .filter_map(deep_canvas_effects::look_finish::op_name)
        .next();
    let dirt = json["bloom"]["dirt"]["texture"]
        .as_str()
        .filter(|t| *t != "seeded");
    let part = [
        (operator.is_some(), "look/finish"),
        (look.drawn.is_some(), "look/drawn"),
        (dirt.is_some(), "look/bloom/dirt"),
    ];
    match part.iter().find(|(has, _)| *has) {
        Some((_, what)) => Err(absent(what)),
        None => Ok(Dressed { look, json }),
    }
}

struct Held {
    doc: Value,
    program: Program,
    look: Dressed,
}

fn load(doc: Value, read: Assets<'_>) -> Result<Held, Reason> {
    if let Some(why) = lacks(&doc, held()?) {
        return Err(why);
    }
    if let Some(issue) = deep_canvas_scene3d::inset::refusals(&doc).first() {
        return Err(format!("refused: {}", issue["path"].as_str().unwrap_or("items")).into());
    }
    let program = Program::compile(
        doc.as_object()
            .ok_or("out_of_range: the revision's document")?,
    )
    .map_err(|r| format!("{}: {}", r.code, r.path))?;
    let look = dressed(&doc, read)?;
    Ok(Held { doc, program, look })
}

fn evaluated(
    held: &Held,
    t: i64,
    px: [u16; 2],
    offsets: &Offsets,
    labels: &mut Labels,
    read: Assets<'_>,
) -> Result<(Staged, bool), Reason> {
    let fills = Fills::of(self::held()?, None);
    let posed = deep_canvas_motion::shots::posed(&held.doc, t);
    #[cfg(feature = "canvas-fixture")]
    let posed = posed.filter(|_| !crate::canvas_fixture::draws_first_camera());
    let doc = posed.as_ref().unwrap_or(&held.doc);
    let look = &held.look;
    let mut frame = staged(doc, t, &look.json, &mut |doc, t| {
        deep_play::scene::evaluate_in(doc, t, look.look.clone(), px, &mut *labels, read, fills)
            .map_err(|r| Refusal::new(r.code, r.path, ""))
    })
    .map_err(|r| format!("{}: {}", r.code, r.path))?;
    if *offsets != Offsets::default() {
        let shot = doc.as_object().filter(|_| posed.is_some());
        let own = shot
            .map(Program::compile)
            .transpose()
            .map_err(|r| format!("{}: {}", r.code, r.path))?;
        let program = own.as_ref().unwrap_or(&held.program);
        let size = px.map(u32::from);
        let turned = deep_canvas_scene3d::frames::turned_camera;
        frame.scene.camera = turned(doc, program, &frame.scene, t, size, offsets)
            .map_err(|r| format!("{}: {}", r.code, r.path))?;
    }
    let maps = !deep_canvas_scene3d::light::map_uses(&frame.scene).is_empty();
    let hosted = [(maps, "maps"), (!frame.scene.pictures.is_empty(), "insets")];
    if let Some((_, what)) = hosted.iter().find(|(has, _)| *has) {
        return Err(absent(what));
    }
    deep_scene3d_render::readouts_as_labels(&mut frame.scene);
    Ok((frame, posed.is_some()))
}

pub fn undrawn(doc: Value, read: Assets<'_>) -> Option<Reason> {
    let held = match load(doc, read) {
        Ok(held) => held,
        Err(why) => return Some(why),
    };
    let side = |i: usize| held.doc["size"][i].as_f64().unwrap_or(1.0).max(1.0);
    let px = [side(0), side(1)].map(|s| s.min(f64::from(u16::MAX)) as u16);
    evaluated(&held, 0, px, &Offsets::default(), &mut Labels::new(), read).err()
}

/// The render thread: the view, its renderer and each frame's evaluation, off the UI thread, until the panel lets
/// the view go.
fn render(evidence: PathBuf, asks: mpsc::Receiver<Ask>, told: Arc<Mutex<Told>>) {
    let (mut view, shared, fx) = match open() {
        Ok(opened) => opened,
        Err(why) => {
            lock(&told).reason = Some(why.into());
            return;
        }
    };
    let ui = view.ui();
    crate::gpu_view::watch(&ui);
    lock(&told).ui = Some(ui.clone());
    let read = |sha: &str| std::fs::read(evidence.join(sha.get(..2)?).join(sha.get(2..)?)).ok();
    let mut scene: Result<Held, Reason> = Err(String::new().into());
    let mut labels = Labels::new();
    let mut frame = 0;
    #[cfg(feature = "canvas-fixture")]
    let mut slots: Vec<(u64, usize, [u32; 2])> = Vec::new();
    for ask in asks {
        let (t, room, offsets) = match ask {
            Ask::Scene(sha) => {
                let doc = read(&sha).and_then(|b| serde_json::from_slice(&b).ok());
                scene = doc
                    .ok_or_else(|| Reason::from("asset_missing: the revision's document"))
                    .and_then(|doc| load(doc, &read));
                labels = Labels::new();
                lock(&told).reason = scene.as_ref().err().cloned();
                continue;
            }
            Ask::Frame { t, room, offsets } => (t, room, offsets),
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
        let drawn = scene.as_ref().map_err(Reason::clone).and_then(|held| {
            let size = fitted(&held.doc, room);
            view.resize(size);
            let px = size.map(|side| u16::try_from(side).unwrap_or(u16::MAX));
            let (frame_at, posed) = evaluated(held, t, px, &offsets, &mut labels, &read)?;
            let moves = posed || frame_at.moves();
            lock(&fx).stage(&frame_at);
            if let Some(renderer) = lock(&shared).renderer.as_mut() {
                renderer.core.want = frame_at.want;
            }
            let next = (Arc::new(frame_at.scene), frame_at.look);
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
            let mut state = held.program.state();
            held.program.evaluate(t, Validity::Full, &mut state);
            // A frame whose effects move with t is due again as soon as it shows.
            let until = if moves { Some(t) } else { state.valid_until };
            Ok((drawn.map(|d| (d.frame, d.size)), until))
        });
        let mut told = lock(&told);
        told.answered += 1;
        match drawn {
            Ok((drawn, valid_until)) => {
                if let Some((frame, size)) = drawn {
                    (told.drawn, told.size, told.t) = (frame, size, Some(t));
                    #[cfg(feature = "canvas-fixture")]
                    {
                        told.times.push((frame, t));
                        let kept = told.times.len().saturating_sub(8);
                        told.times.drain(..kept);
                    }
                }
                told.valid_until = valid_until;
            }
            Err(why) => (told.reason, told.valid_until) = (Some(why), None),
        }
    }
    crate::gpu_view::unwatch(&ui);
}

#[cfg(test)]
mod tests {
    use super::{fitted, held, lacks};
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
        let held = held().expect("the view's modules seal");
        let said = |more: Value| lacks(&scene(more), held).map(|why| why.recorded);
        let drawn = [
            json!({}),
            json!({"requires": {"modules": {"scene3d": "^1", "effects": "^1"}}}),
            json!({"requires": {"modules": {"scene3d": "^1", "building": "^1"}}}),
            json!({"items": {"title": {"kind": "text@1"}}}),
            json!({"look": {"asset": "look@1"}}),
            json!({"shots": {}}),
        ];
        for more in drawn {
            assert_eq!(said(more.clone()), None, "{more}");
        }
        let physics = json!({"scene3d": "^1", "physics": "^1"});
        let cases = [
            (
                json!({"requires": {"modules": physics}}),
                "module_missing: physics",
            ),
            (
                json!({"items": {"set": {"kind": "arrange@1"}}}),
                "feature_absent: arrange@1",
            ),
            (
                json!({"items": {"inset": {"kind": "overlay.view@1"}}}),
                "feature_absent: overlay.view@1",
            ),
            (
                json!({"items": {"tag": {"kind": "overlay.frame@1"}}}),
                "feature_absent: overlay.frame@1",
            ),
        ];
        for (more, why) in cases {
            assert_eq!(said(more).as_deref(), Some(why));
        }
    }

    /// #1719: the panel's frame draws through the post stage render-back's does: a sun's shadow over
    /// solids with no material, and particles. Each fixture draws the same twice, and without the
    /// part it names draws otherwise.
    #[cfg(all(feature = "canvas-fixture", target_os = "macos"))]
    #[test]
    fn a_frame_draws_through_the_post_stage() {
        let dir = std::env::temp_dir().join(format!("deep-1719-panel-{}", std::process::id()));
        let drawn = |shadow: bool, count: u32| {
            let item = |id: &str, kind: &str, params: Value| json!({"id": id, "kind": kind, "layer": "main", "name": id, "order": "a0", "params": params});
            let mut items = json!({
                "cam": item("cam", "camera@1", json!({"position": [4, 6, 8], "target": [0, 0, 0], "fov": 40})),
                "sun": item("sun", "light.sun@1", json!({"illuminance": 3, "shadow": shadow})),
                "box": item("box", "mark.box@1", json!({"size": [1, 2, 1]})),
                "slab": item("slab", "mark.box@1", json!({"size": [6, 0.2, 6]})),
            });
            items["sun"]["at"] = json!({"rot": [-40, 30, 0]});
            items["slab"]["at"] = json!({"pos": [0, -1.1, 0]});
            if count > 0 {
                let emit = json!({"count": count, "emit": {"rate": 1000}, "life": [1, 2]});
                items["sparks"] = item("sparks", "particles@1", emit);
            }
            let doc = json!({"size": [160, 120], "camera": "cam", "seed": 7, "items": items,
                "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
                "requires": {"modules": {"scene3d": "^1", "effects": "^1"}}});
            let sha = "a".repeat(64);
            let kept = dir.join(&sha[..2]);
            std::fs::create_dir_all(&kept).expect("a folder");
            std::fs::write(kept.join(&sha[2..]), doc.to_string()).expect("the document is kept");
            let mut view = super::SceneView::new(dir.clone());
            view.show(&sha);
            let frame = super::Ask::Frame {
                t: 705_600_000,
                room: [160, 120],
                offsets: Default::default(),
            };
            view.asks.send(frame).expect("the render thread runs");
            let bytes = view.read(1).map(|(bytes, _)| bytes);
            bytes.unwrap_or_else(|| panic!("no frame: {:?}", view.reason()))
        };
        let plain = drawn(false, 0);
        assert_eq!(plain, drawn(false, 0), "a still frame draws the same twice");
        assert_ne!(plain, drawn(true, 0), "the sun's shadow draws nothing");
        assert_ne!(plain, drawn(false, 400), "the particles draw nothing");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
