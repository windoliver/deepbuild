//! `deep-show live` with a `live` object (#140, criteria 2, 4 and 8; the #140 view README, "deep-show
//! live: the live options"): the app's real, shown window drawing the first document's panel as
//! `screen` draws it, paced by the display seam's macOS backend, the display link through GPUI.
//!
//! The frame clock here is the one the design gives (canvas primitives: Frame clock and
//! scheduler): it arms a frame only on a commit or when the last frame's `valid_until` has come,
//! and asks for no display-link callback while idle. At each frame's latch it predicts the
//! presentation time, evaluates the document at it and draws; the GPUI patch's presentation
//! feedback (Frame callback and presentation feedback) reports the drawable's presented time,
//! which also keeps the clock's vsync phase and pipeline depth. Every display-link callback the
//! clock asks for and every frame it arms is a wakeup, stamped on the host clock.
//!
//! A run waits frame by frame until AppKit reports the window visible, then primes the clock with
//! frames that do a document frame's work but present only the ground, until [`PRIME`] have
//! presented; the document's first frame follows, and `watch_from: first_frame` counts from its
//! presentation. A window that never shows or presents answers `no_display`, never made-up
//! frames. It answers one line and exits.

use std::cell::RefCell;
use std::ffi::{c_char, CStr};
use std::io::Write;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::program::Program;
use gpui_apple::metal_renderer::presentation;
use gpui_kit::*;
use objc2::runtime::AnyObject;
use objc2::{msg_send, sel};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Map, Value};

use crate::hub::{Call, Hub, Scenario, Startup};
use crate::live::{bounds, nodes, AxNode, Node, STRIP};
use crate::shared::FLICKS;
use crate::window::refused;

/// How long a window may take to show and present its first frame before the run answers
/// `no_display`, and the most frames it waits through for AppKit to order it in.
const SHOW_DEADLINE: Duration = Duration::from_secs(10);
const SHOW_FRAMES: u32 = 240;
/// How many priming frames present before the document's first: enough to fill the drawable
/// queue (a CAMetalLayer holds three), so the pipeline's depth is the one the document meets.
const PRIME: usize = 4;
/// How long a run waits for the frame clock to go idle once the window presents.
const SETTLE_DEADLINE: Duration = Duration::from_secs(10);
/// The run's own poll while it waits for a presented frame or for the clock to settle; it stops
/// before any watch begins and is never the frame clock's.
const POLL: Duration = Duration::from_millis(10);
/// The presented handler runs after the display shows a drawable: the run waits this long past a
/// watch's end for the feedback of the frames presented within it.
const FEEDBACK: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, PartialEq, Eq)]
enum WatchFrom {
    FirstFrame,
    Settled,
}

struct After {
    after_ms: u64,
    call: Call,
    at: i64,
}

/// The `live` object (README: the live options).
pub struct Options {
    pace_hz: Option<u32>,
    watch: Option<(WatchFrom, u64)>,
    tree: bool,
    after: Vec<After>,
    hold_ms: u64,
}

/// Reads the `live` object; `None` for one the README doesn't allow.
pub fn parse(live: &Value, call: impl Fn(&Map<String, Value>) -> Option<Call>) -> Option<Options> {
    let o = live.as_object()?;
    let known = [
        "pace_hz",
        "watch_from",
        "watch_ms",
        "tree",
        "after",
        "hold_ms",
    ];
    if o.keys().any(|k| !known.contains(&k.as_str())) {
        return None;
    }
    let pace_hz = match o.get("pace_hz") {
        None => None,
        Some(h) => Some(h.as_u64().filter(|h| *h == 60 || *h == 120)? as u32),
    };
    let watch = match (o.get("watch_from"), o.get("watch_ms")) {
        (None, None) => None,
        (from, Some(ms)) => {
            let from = match from.map(|f| f.as_str()) {
                None | Some(Some("first_frame")) => WatchFrom::FirstFrame,
                Some(Some("settled")) => WatchFrom::Settled,
                _ => return None,
            };
            Some((from, ms.as_u64()?))
        }
        (Some(_), None) => return None,
    };
    let tree = match o.get("tree") {
        None => false,
        Some(t) => t.as_bool()?,
    };
    let after = match o.get("after") {
        None => Vec::new(),
        Some(list) => list
            .as_array()?
            .iter()
            .map(|a| {
                let c = a.get("call")?.as_object()?;
                Some(After {
                    after_ms: a.get("after_ms")?.as_u64()?,
                    call: call(c)?,
                    at: match c.get("at") {
                        None => 0,
                        Some(t) => t.as_i64().filter(|t| *t >= 0)?,
                    },
                })
            })
            .collect::<Option<_>>()?,
    };
    let hold_ms = match o.get("hold_ms") {
        None => 0,
        Some(h) => h.as_u64()?,
    };
    Some(Options {
        pace_hz,
        watch,
        tree,
        after,
        hold_ms,
    })
}

/// The host's monotonic clock in ns: `mach_absolute_time`'s, which a drawable's presented time
/// and the display link count in.
fn host_ns() -> i64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `clock_gettime` writes the timespec it is given.
    unsafe { libc::clock_gettime(libc::CLOCK_UPTIME_RAW, &mut ts) };
    ts.tv_sec * 1_000_000_000 + ts.tv_nsec
}

/// A frame the clock latched: a frame of the document, or one that primes the clock while the
/// window orders in, drawing only its ground.
struct Latched {
    seq: u64,
    rev: u64,
    latch: i64,
    predicted: i64,
    document: bool,
}

/// The frame clock of one window on one display (Frame clock and scheduler: Fields).
struct Clock {
    /// The display's refresh period and the pacing period, ns.
    refresh_ns: f64,
    pace_ns: f64,
    /// Display refreshes per paced frame.
    per_frame: u32,
    seq: u64,
    /// The latest presented frame's latch and presented time: the display's vsync phase and the
    /// pipeline's depth as presentation feedback last measured them.
    anchor: Option<(u64, i64, i64)>,
    latched: Vec<Latched>,
    /// Each wakeup the clock scheduled: when, and the frame it arms.
    wakeups: Vec<(i64, u64)>,
    /// The presentation time of the document's first frame: the document's time 0.
    t0: Option<i64>,
}

impl Clock {
    /// The predicted presentation time of a frame latched at `latch` (Semantics: "at the latch
    /// it evaluates every session at the predicted presentation time"): as many refreshes after
    /// the anchor's presentation as the latch is after its latch, since the display link latches
    /// on the vsync grid and the pipeline keeps its depth. Before any feedback, two refreshes
    /// after the latch: only the frames that prime the clock are latched then.
    fn predict(&self, latch: i64) -> i64 {
        let t = self.refresh_ns;
        match self.anchor {
            None => latch + (2. * t).round() as i64,
            Some((_, l, p)) => p + (((latch - l) as f64 / t).round() * t).round() as i64,
        }
    }

    /// Presentation feedback for a frame: a later frame's presentation becomes the anchor.
    fn presented(&mut self, seq: u64, at: i64) {
        if self.anchor.is_some_and(|(s, _, _)| s >= seq) {
            return;
        }
        if let Some(f) = self.latched.iter().find(|f| f.seq == seq) {
            self.anchor = Some((seq, f.latch, at));
        }
    }
}

/// What the window shows: a revision of the first document, compiled for its motion.
struct Shown {
    rev: u64,
    drawable: Map<String, Value>,
    program: Option<Program>,
    nodes: Vec<Node>,
}

struct State {
    hub: Hub<'static>,
    doc: String,
    panel: [f64; 4],
    shown: Shown,
    clock: Clock,
    /// Presented frames from the feedback: (label, presented ns), as reported.
    feedback: Arc<Mutex<Vec<(u64, i64)>>>,
    stage: Stage,
    picture: Option<Arc<RenderImage>>,
    view: Option<EntityId>,
}

/// Where a window is in showing the document.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Stage {
    /// AppKit hasn't reported the window visible: nothing is latched.
    OrderingIn,
    /// Visible: the clock latches frames of the window's ground until one has presented, so it
    /// knows the display's vsync phase and the pipeline's depth before the document's first.
    Priming,
    /// The document's frames.
    Showing,
}

impl State {
    fn show(hub: &Hub<'static>, doc: &str, panel: [f64; 4]) -> Option<Shown> {
        let rev = hub.current(doc)?.rev;
        let revision = hub.revision(doc, rev)?;
        let drawable = crate::shared::drawable(&revision).as_object()?.clone();
        let program = Program::compile(&drawable).ok();
        Some(
            Shown {
                rev,
                drawable,
                program,
                nodes: Vec::new(),
            }
            .with_nodes(hub, &revision, panel),
        )
    }

    /// Keeps the clock's phase and depth from the latest presented frame.
    fn drain(&mut self) {
        if let Some((seq, at)) = self.presented().last().copied() {
            self.clock.presented(seq, at);
        }
    }

    /// Every frame the feedback reported shown, with its presented time; a discarded one (a
    /// presented time of 0) isn't listed.
    fn presented(&self) -> Vec<(u64, i64)> {
        let f = self.feedback.lock().unwrap_or_else(|e| e.into_inner());
        f.iter().copied().filter(|(_, at)| *at > 0).collect()
    }

    /// The document's frames shown, each with the frame the clock latched.
    fn shown_frames(&self) -> Vec<(&Latched, i64)> {
        self.presented()
            .into_iter()
            .filter_map(|(seq, at)| {
                let f = self.clock.latched.iter().find(|f| f.seq == seq)?;
                f.document.then_some((f, at))
            })
            .collect()
    }

    /// The last frame the feedback reported, shown or discarded.
    fn last_reported(&self) -> Option<u64> {
        let f = self.feedback.lock().unwrap_or_else(|e| e.into_inner());
        f.last().map(|(seq, _)| *seq)
    }

    /// The document drawn at `t` as `screen` draws it, into the panel's pixels.
    fn draw(&mut self, t: i64) -> Option<Arc<RenderImage>> {
        let palette = self.hub.look.light.clone();
        let ground = palette.get("ground").copied().unwrap_or([255; 3]);
        let record = self.hub.record();
        let px_size = crate::snapshot::px([self.panel[2], self.panel[3]]);
        let drawn = self
            .hub
            .renderer
            .prepare(
                &self.shown.drawable,
                t,
                &palette,
                self.hub.look.status.as_ref(),
                &record,
                &self.hub.scenario.evidence,
            )
            .ok()?;
        let rgba = self.hub.renderer.raster(&drawn, px_size, Some(ground));
        picture(rgba, px_size)
    }

    /// Whether the document drawn at `t` changes after it (its `valid_until`).
    fn moves_after(&self, t: i64) -> bool {
        self.shown.program.as_ref().is_some_and(|p| {
            let mut state = p.state();
            p.evaluate(t, Validity::Full, &mut state);
            state.valid_until.is_some()
        })
    }
}

impl Shown {
    fn with_nodes(mut self, hub: &Hub<'static>, revision: &Value, panel: [f64; 4]) -> Self {
        let palette = hub.look.light.clone();
        let px_size = crate::snapshot::px([panel[2], panel[3]]);
        let mut renderer = crate::snapshot::Renderer::new();
        if let Ok(drawn) = renderer.prepare(
            &self.drawable,
            0,
            &palette,
            hub.look.status.as_ref(),
            &hub.record(),
            &hub.scenario.evidence,
        ) {
            let scale = drawn.scale(px_size);
            let mut boxes: Vec<(String, [f64; 4])> = drawn
                .boxes()
                .into_iter()
                .map(|(id, b)| {
                    let at = [
                        panel[0] + b[0] * scale,
                        panel[1] + b[1] * scale,
                        b[2] * scale,
                        b[3] * scale,
                    ];
                    (id, at)
                })
                .collect();
            // An item heard but drawn in no box (a path) is still a node of the tree `see`
            // reads (criterion 4: "VoiceOver names every part"), at the panel it draws in.
            let (_, unboxed) = nodes(revision, &[], &boxes, panel);
            boxes.extend(unboxed.into_iter().map(|id| (id, panel)));
            self.nodes = nodes(revision, &[], &boxes, panel).0;
        }
        self
    }
}

/// RGBA pixels as the BGRA picture GPUI paints, swapping red and blue a word at a time: the
/// window draws a picture every paced frame, and `crate::window::picture`'s byte swap takes
/// most of a 120 Hz frame in a debug build.
fn picture(mut rgba: Vec<u8>, size: [u16; 2]) -> Option<Arc<RenderImage>> {
    // SAFETY: any four bytes are a valid u32; the unaligned ends are swapped byte by byte.
    let (head, words, tail) = unsafe { rgba.align_to_mut::<u32>() };
    if !head.is_empty() || !tail.is_empty() {
        return crate::window::picture(rgba, size);
    }
    for w in words.iter_mut() {
        let v = u32::from_le(*w);
        *w = u32::to_le((v & 0xff00_ff00) | ((v >> 16) & 0xff) | ((v & 0xff) << 16));
    }
    let frame = image::RgbaImage::from_raw(u32::from(size[0]), u32::from(size[1]), rgba)?;
    Some(Arc::new(RenderImage::new([image::Frame::new(frame)])))
}

/// Arms the frame `seq`: `left` display-link callbacks, each a wakeup, the last notifying the
/// view, so a frame lands every `per_frame` refreshes (README: `pace_hz`).
fn arm(window: &mut Window, state: Rc<RefCell<State>>, seq: u64, left: u32) {
    window.on_next_frame(move |window, cx| {
        let view = {
            let mut st = state.borrow_mut();
            st.clock.wakeups.push((host_ns(), seq));
            st.view
        };
        if left > 1 {
            arm(window, state, seq, left - 1);
        } else if let Some(view) = view {
            cx.notify(view);
        }
    });
}

struct View {
    state: Rc<RefCell<State>>,
    ground: Hsla,
}

impl Render for View {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.state.clone();
        let mut st = state.borrow_mut();
        st.view = Some(cx.entity_id());
        if st.stage != Stage::OrderingIn {
            // The latch: predict, evaluate at the prediction, draw, and label the drawable.
            st.drain();
            let latch = host_ns();
            st.clock.seq += 1;
            let seq = st.clock.seq;
            let predicted = st.clock.predict(latch);
            let document = st.stage == Stage::Showing;
            let rev = st.shown.rev;
            st.clock.latched.push(Latched {
                seq,
                rev,
                latch,
                predicted,
                document,
            });
            presentation::label_next(seq);
            if document {
                let t0 = *st.clock.t0.get_or_insert(predicted);
                let t = ((predicted - t0) as i128 * i128::from(FLICKS) / 1_000_000_000) as i64;
                if let Some(picture) = st.draw(t) {
                    if let Some(old) = st.picture.replace(picture) {
                        let _ = window.drop_image(old);
                    }
                }
                if st.moves_after(t) {
                    let per_frame = st.clock.per_frame;
                    arm(window, state.clone(), seq + 1, per_frame);
                }
            } else {
                // A priming frame does a document frame's work, evaluating and rastering it at
                // 0, but presents only the ground: the latency the clock measures from it is a
                // document frame's.
                let _ = st.draw(0);
            }
        }
        let picture = st.picture.clone();
        let panel = bounds(st.panel);
        let ax: Vec<Node> = if st.stage == Stage::Showing {
            st.shown.nodes.clone()
        } else {
            Vec::new()
        };
        drop(st);
        let painted = canvas(
            |_, _, _| {},
            move |_, _, window, _| {
                if let Some(picture) = picture {
                    let _ = window.paint_image(panel, panel, Corners::default(), picture, 0, false);
                }
            },
        )
        .size_full();
        let nodes = ax.into_iter().map(|n| {
            let b = n.bounds;
            AxNode {
                node: n,
                style: StyleRefinement::default(),
            }
            .absolute()
            .left(b.origin.x)
            .top(b.origin.y)
            .w(b.size.width)
            .h(b.size.height)
        });
        div()
            .size_full()
            .relative()
            .bg(self.ground)
            .child(painted)
            .children(nodes)
    }
}

/// The window's NSView, through GPUI's AppKit handle.
fn ns_view(window: &Window) -> Option<*mut AnyObject> {
    let handle = HasWindowHandle::window_handle(window).ok()?;
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        return None;
    };
    Some(handle.ns_view.as_ptr().cast())
}

/// Whether AppKit presents the window: `NSWindow.occlusionState` holds `Visible`.
fn occlusion_visible(window: &Window) -> bool {
    let Some(view) = ns_view(window) else {
        return false;
    };
    // SAFETY: GPUI's AppKit handle wraps its NSView, alive while the GPUI window is; `window` and
    // `occlusionState` are NSView and NSWindow properties (NSWindowOcclusionStateVisible = 1 << 1).
    unsafe {
        let ns_window: *mut AnyObject = msg_send![&*view, window];
        if ns_window.is_null() {
            return false;
        }
        let state: usize = msg_send![&*ns_window, occlusionState];
        state & (1 << 1) != 0
    }
}

/// An Objective-C object's text: an NSString's own, anything else's `description`.
///
/// SAFETY: `obj` is null or a live Objective-C object.
unsafe fn text_of(obj: *mut AnyObject) -> Option<String> {
    if obj.is_null() {
        return None;
    }
    let text: *mut AnyObject = msg_send![&*obj, description];
    if text.is_null() {
        return None;
    }
    let utf8: *const c_char = msg_send![&*text, UTF8String];
    (!utf8.is_null()).then(|| CStr::from_ptr(utf8).to_string_lossy().into_owned())
}

/// An accessibility attribute of `obj` read as an assistive client asks it, if it answers it.
///
/// SAFETY: `obj` is a live Objective-C object.
unsafe fn ax_text(obj: &AnyObject, attribute: objc2::runtime::Sel) -> Option<String> {
    let answers: bool = msg_send![obj, respondsToSelector: attribute];
    if !answers {
        return None;
    }
    let value: *mut AnyObject = msg_send![obj, performSelector: attribute];
    text_of(value)
}

/// The elements under `obj`, depth first, one row for each with a non-empty identifier
/// (README: `tree`).
///
/// SAFETY: `obj` is a live Objective-C object.
unsafe fn ax_rows(obj: &AnyObject, out: &mut Vec<Value>, depth: u32) {
    if let Some(id) = ax_text(obj, sel!(accessibilityIdentifier)).filter(|i| !i.is_empty()) {
        let mut row = json!({
            "id": id,
            "role": ax_text(obj, sel!(accessibilityRole)).unwrap_or_default(),
            "name": ax_text(obj, sel!(accessibilityLabel))
                .filter(|n| !n.is_empty())
                .or_else(|| ax_text(obj, sel!(accessibilityTitle)))
                .unwrap_or_default(),
        });
        if let Some(sub) = ax_text(obj, sel!(accessibilitySubrole)) {
            row["subrole"] = json!(sub);
        }
        if let Some(value) = ax_text(obj, sel!(accessibilityValue)) {
            row["value"] = json!(value);
        }
        out.push(row);
    }
    if depth > 32 {
        return;
    }
    let answers: bool = msg_send![obj, respondsToSelector: sel!(accessibilityChildren)];
    if !answers {
        return;
    }
    let children: *mut AnyObject = msg_send![obj, accessibilityChildren];
    if children.is_null() {
        return;
    }
    let count: usize = msg_send![&*children, count];
    for i in 0..count {
        let child: *mut AnyObject = msg_send![&*children, objectAtIndex: i];
        if !child.is_null() {
            ax_rows(&*child, out, depth + 1);
        }
    }
}

/// The window's accessibility tree read back through NSAccessibility, in process: the elements
/// under the NSWindow, as an assistive client walks them.
fn read_tree(window: &Window) -> Vec<Value> {
    let mut rows = Vec::new();
    if let Some(view) = ns_view(window) {
        // SAFETY: the view is alive while the GPUI window is, and so is its NSWindow; this runs
        // on the main thread.
        unsafe {
            let ns_window: *mut AnyObject = msg_send![&*view, window];
            if !ns_window.is_null() {
                ax_rows(&*ns_window, &mut rows, 0);
            }
        }
    }
    rows
}

fn print_and_quit(reply: Value, cx: &mut App) {
    presentation::set_hook(None);
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{reply}");
    let _ = out.flush();
    drop(out);
    cx.quit();
    std::process::exit(0);
}

/// Waits frame by frame until AppKit reports the window visible (a new window reads occluded
/// until it is ordered in), then primes the clock: frames of the window's ground until one has
/// presented. Then it arms the document's first frame. A window that never shows or presents
/// latches no frame of the document.
fn wait_visible(window: &mut Window, state: Rc<RefCell<State>>, frames: u32) {
    window.on_next_frame(move |window, cx| {
        let stage = state.borrow().stage;
        let next = match stage {
            Stage::OrderingIn if occlusion_visible(window) => Some(Stage::Priming),
            Stage::Priming if state.borrow().presented().len() >= PRIME => Some(Stage::Showing),
            _ => None,
        };
        let view = {
            let mut st = state.borrow_mut();
            if let Some(next) = next {
                st.stage = next;
            }
            if next == Some(Stage::Showing) {
                // The document's first frame, armed by the window showing.
                let seq = st.clock.seq + 1;
                st.clock.wakeups.push((host_ns(), seq));
            }
            st.view
        };
        if next == Some(Stage::Showing) {
            if let Some(view) = view {
                cx.notify(view);
            }
        } else if frames > 0 {
            window.refresh();
            wait_visible(window, state, frames - 1);
        }
    });
}

/// Plays the scenario's calls, then shows the first document's panel and does what `live` asks.
pub fn run(scenario: &'static Scenario, startup: &'static Startup, options: Options) -> Value {
    let mut hub = Hub::new(scenario, startup);
    let replies = hub.run_calls();
    let Some((doc, panel_id)) = scenario
        .docs
        .iter()
        .next()
        .map(|(d, p)| (d.clone(), p.clone()))
    else {
        return refused("no_document");
    };
    let Some(panel) = hub.slot(&panel_id) else {
        return refused("no_panel");
    };
    let Some(shown) = State::show(&hub, &doc, panel) else {
        return refused("not_presented");
    };
    let title = hub
        .revision(&doc, shown.rev)
        .and_then(|r| r["title"].as_str().map(str::to_string))
        .unwrap_or_else(|| "deep-show live".into());
    let ground = hub.look.light.get("ground").copied().unwrap_or([255; 3]);
    let ground: Hsla = Rgba {
        r: f32::from(ground[0]) / 255.,
        g: f32::from(ground[1]) / 255.,
        b: f32::from(ground[2]) / 255.,
        a: 1.,
    }
    .into();
    let feedback: Arc<Mutex<Vec<(u64, i64)>>> = Arc::default();
    let reported = feedback.clone();
    presentation::set_hook(Some(Arc::new(move |label, at| {
        // Label 0 is a drawable the clock didn't latch; a presented time of 0 is a drawable
        // never shown, kept as 0.
        if label != 0 {
            let mut f = reported.lock().unwrap_or_else(|e| e.into_inner());
            f.push((label, (at.max(0.) * 1e9).round() as i64));
        }
    })));
    let state = Rc::new(RefCell::new(State {
        hub,
        doc: doc.clone(),
        panel,
        shown,
        clock: Clock {
            refresh_ns: 0.,
            pace_ns: 0.,
            per_frame: 1,
            seq: 0,
            anchor: None,
            latched: Vec::new(),
            wakeups: Vec::new(),
            t0: None,
        },
        feedback,
        stage: Stage::OrderingIn,
        picture: None,
        view: None,
    }));
    let window_size = size(
        px((panel[0] + panel[2]) as f32),
        px((panel[1] + panel[3]) as f32 + STRIP),
    );
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        let view_state = state.clone();
        let opened = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    window_size,
                    cx,
                ))),
                titlebar: Some(TitlebarOptions {
                    title: Some(title.into()),
                    ..Default::default()
                }),
                // Above other apps' windows, so AppKit orders it in visible; and paced at the
                // clock's rate when it isn't the key window.
                kind: WindowKind::PopUp,
                inactive_frame_interval: None,
                show: true,
                focus: true,
                ..Default::default()
            },
            |window, cx| {
                let st = view_state.clone();
                wait_visible(window, st, SHOW_FRAMES);
                cx.new(|_| View {
                    state: view_state,
                    ground,
                })
            },
        );
        let Ok(handle) = opened else {
            print_and_quit(refused("no_display"), cx);
            return;
        };
        cx.activate(true);
        // The display the window is on, and the clock's pacing.
        let display = handle
            .update(cx, |_, window, cx| {
                let display = window.display(cx);
                let uuid = display
                    .as_ref()
                    .and_then(|d| d.uuid().ok())
                    .map(|u| u.to_string())
                    .unwrap_or_default();
                let refresh = window
                    .refresh_interval(cx)
                    .or_else(|| display.as_ref().and_then(|d| d.refresh_interval()));
                (uuid, refresh)
            })
            .unwrap_or_default();
        let max_hz = display
            .1
            .map(|d| (1.0 / d.as_secs_f64()).round())
            .unwrap_or(60.);
        {
            let mut st = state.borrow_mut();
            let pace = options.pace_hz.map_or(max_hz, f64::from);
            st.clock.refresh_ns = 1e9 / max_hz;
            st.clock.pace_ns = 1e9 / pace;
            st.clock.per_frame = (max_hz / pace).round().max(1.) as u32;
        }
        let display_json = json!({
            // A variable-refresh display's link runs at its most (GPUI: refresh_interval).
            "uuid": display.0, "refresh_hz": max_hz, "max_refresh_hz": max_hz,
        });
        let state = state.clone();
        cx.spawn(async move |cx| {
            let opened_at = host_ns();
            // The document's first presented frame, or no display.
            let first = loop {
                if let Some((_, at)) = state.borrow().shown_frames().first() {
                    break Some(*at);
                }
                if host_ns() - opened_at > SHOW_DEADLINE.as_nanos() as i64 {
                    break None;
                }
                cx.background_executor().timer(POLL).await;
            };
            let Some(first) = first else {
                cx.update(|cx| print_and_quit(refused("no_display"), cx));
                return;
            };
            // Settled: every latched frame presented (or discarded) and nothing armed after it.
            let wants_settled =
                options.tree || options.watch.is_some_and(|(f, _)| f == WatchFrom::Settled);
            let mut settled = None;
            if wants_settled {
                let since = host_ns();
                let mut last_seen = (0, 0);
                while host_ns() - since < SETTLE_DEADLINE.as_nanos() as i64 {
                    let now = {
                        let mut st = state.borrow_mut();
                        st.drain();
                        let seen = (st.clock.seq, st.clock.wakeups.len());
                        let idle = seen == last_seen && st.last_reported() == Some(st.clock.seq);
                        last_seen = seen;
                        idle.then(host_ns)
                    };
                    if let Some(now) = now {
                        settled = Some(now);
                        break;
                    }
                    cx.background_executor()
                        .timer(Duration::from_millis(100))
                        .await;
                }
                if settled.is_none() {
                    cx.update(|cx| print_and_quit(refused("not_settled"), cx));
                    return;
                }
            }
            // The tree: the first read activates AccessKit's adapter, then a frame sends it.
            let mut tree = Vec::new();
            if options.tree {
                let ids: Vec<String> = state
                    .borrow()
                    .shown
                    .nodes
                    .iter()
                    .map(|n| n.id.clone())
                    .collect();
                for _ in 0..50 {
                    tree = handle
                        .update(cx, |_, window, _| {
                            let rows = read_tree(window);
                            window.refresh();
                            rows
                        })
                        .unwrap_or_default();
                    let found = ids.iter().all(|id| tree.iter().any(|r| r["id"] == *id));
                    if found {
                        break;
                    }
                    cx.background_executor()
                        .timer(Duration::from_millis(100))
                        .await;
                }
            }
            // The `after` calls, each `after_ms` after the first presented frame.
            let mut after_out = Vec::new();
            let mut afters = options.after;
            afters.sort_by_key(|a| a.after_ms);
            for a in afters {
                let due = first + a.after_ms as i64 * 1_000_000;
                let wait = due - host_ns();
                if wait > 0 {
                    cx.background_executor()
                        .timer(Duration::from_nanos(wait as u64))
                        .await;
                }
                let entry = handle.update(cx, |_, window, cx| {
                    let mut st = state.borrow_mut();
                    let rev = st.shown.rev;
                    let presented = st
                        .shown_frames()
                        .iter()
                        .filter(|(f, _)| f.rev == rev)
                        .count();
                    let doc = st.doc.clone();
                    st.hub.now = st.hub.now.max(a.at);
                    let reply = st.hub.call(&a.call);
                    // A call that made a new revision current arms a frame showing it.
                    let current = st.hub.current(&doc).map(|r| r.rev);
                    if current.is_some_and(|c| c != rev) {
                        let panel = st.panel;
                        if let Some(shown) = State::show(&st.hub, &doc, panel) {
                            st.shown = shown;
                            let seq = st.clock.seq + 1;
                            st.clock.wakeups.push((host_ns(), seq));
                        }
                    }
                    drop(st);
                    cx.notify();
                    window.refresh();
                    let mut showing = Map::new();
                    showing.insert(doc, json!(rev));
                    json!({
                        "after_ms": a.after_ms,
                        "showing": showing,
                        "presented": presented,
                        "reply": reply,
                    })
                });
                after_out.push(entry.unwrap_or(Value::Null));
            }
            // The watch, then the hold, each timed from its start on the host clock.
            let watch = options.watch.map(|(from, ms)| {
                let start = match from {
                    WatchFrom::FirstFrame => first,
                    WatchFrom::Settled => settled.unwrap_or(first),
                };
                (start, start + ms as i64 * 1_000_000)
            });
            let end = [
                watch.map(|w| w.1),
                Some(first + options.hold_ms as i64 * 1_000_000),
            ]
            .into_iter()
            .flatten()
            .max()
            .unwrap_or(first);
            let wait = end - host_ns();
            if wait > 0 {
                cx.background_executor()
                    .timer(Duration::from_nanos(wait as u64))
                    .await;
            }
            if watch.is_some() {
                cx.background_executor().timer(FEEDBACK).await;
            }
            let reply = {
                let st = state.borrow();
                let (frames, wakeups) = match watch {
                    None => (Vec::new(), 0),
                    Some((from, to)) => {
                        let frames: Vec<Value> = st
                            .shown_frames()
                            .into_iter()
                            .filter(|(_, at)| (from..=to).contains(at))
                            .map(|(f, at)| {
                                json!({
                                    "frame_seq": f.seq, "rev": f.rev, "predicted_ns": f.predicted,
                                    "presented_ns": at, "refresh_ns": st.clock.pace_ns.round(),
                                })
                            })
                            .collect();
                        let listed: Vec<u64> = frames
                            .iter()
                            .filter_map(|f| f["frame_seq"].as_u64())
                            .collect();
                        // A wakeup within the watch, or one that armed a frame it lists.
                        let wakeups = st
                            .clock
                            .wakeups
                            .iter()
                            .filter(|(at, seq)| (*at >= from && *at <= to) || listed.contains(seq))
                            .count();
                        (frames, wakeups)
                    }
                };
                json!({
                    "ok": true,
                    "replies": replies,
                    "live": {
                        "display": display_json,
                        "frames": frames,
                        "wakeups": wakeups,
                        "tree": tree,
                        "after": after_out,
                    },
                })
            };
            cx.update(|cx| print_and_quit(reply, cx));
        })
        .detach();
    });
    std::process::exit(0)
}
