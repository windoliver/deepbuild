//! Issue #124: `deep_drive`, a replica an agent drives. One replica per process, on a fixture, a read-only and
//! redacted copy of your record, or nothing, at a size, scale and theme, on a virtual clock. The agent locates by
//! role and name, a canvas item, a handle, drawn text or a control's label, strictly; acts with waits until its
//! target is visible, enabled and still for two frames, and refuses a pointer action that something in front of the
//! target would get, as `probe` tells without acting; sees text snapshots and screenshots by hash; records frames
//! at 30 fps with the locators it names masked in every frame and an actions list; and asserts. Only assertions
//! make the run a journey check: `close` answers the journey a check's runner takes, and the trace. `ui_check`
//! (see `check`) renders the views a change touches and audits each.
//!
//! Nothing a replica does reaches your Mac or your record: it runs on GPUI's test platform, whose clipboard,
//! windows, focus and activation are its own; its notifications are kept in its trace; and a copy of your record is
//! read once, before any input, over a connection closed straight after. `DEEP_DRIVE_PLANT` lifts one guard at a
//! time, for the checks that must catch it.

mod check;
mod frames;
pub mod glyphs;
mod hubcopy;
mod locate;
mod motion;
mod plant;

use std::{
    cell::{Cell, RefCell},
    path::{Path, PathBuf},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use deep_app::{
    events::{inbox, Fixture, Row},
    notify::{NotificationSetting, Notifier, NOTIFY_AFTER},
    views::{AppState, Kind, Layout, AGENTS, HOME, NEEDS_YOU, SESSION, WELCOME},
};
use gpui_kit::{test::TestWindowExt as _, *};
use image::RgbaImage;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::{
    shell::open_shell_with,
    snapshot::{from_observed, Node},
};
use glyphs::Glyphs;
use locate::{contains, Frame, Miss, Target};
pub use plant::Plant;

/// Flicks a second: every time a replica answers is in flicks since its launch.
pub const FLICKS: u64 = 705_600_000;
/// One frame of the replica's clock, a 60th of a second.
const FRAME: u64 = FLICKS / 60;
const TIMEOUT_MS: u64 = 5_000;
/// A scroll is delivered over this many frames, as a trackpad's deltas are.
const SCROLL_FRAMES: u32 = 10;
/// Highlights are drawn in strips this many points wide, right of and below the frame.
const STRIP_PT: f32 = 12.;
const HIGHLIGHT: [u8; 4] = [0xE5, 0x48, 0x4D, 0xFF];

/// A refusal: its code and words, and whatever else names what went wrong.
pub struct Fail(Map<String, Value>);

fn fail(code: &str, message: impl Into<String>) -> Fail {
    let mut error = Map::new();
    error.insert("code".into(), json!(code));
    error.insert("message".into(), json!(message.into()));
    Fail(error)
}

impl Fail {
    fn with(mut self, key: &str, value: Value) -> Fail {
        self.0.insert(key.into(), value);
        self
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn nanos(flicks: u64) -> u64 {
    (flicks as u128 * 625 / 441) as u64
}

/// The process's one replica, and the calls it answers.
pub struct Drive {
    out: PathBuf,
    plant: Option<Plant>,
    replica: Option<Replica>,
    launches: u64,
}

impl Drive {
    pub fn new(out: PathBuf, plant: Option<Plant>) -> Drive {
        Drive {
            out,
            plant,
            replica: None,
            launches: 0,
        }
    }

    /// One call's reply: `ok`, `t`, and the call's fields or its error.
    pub fn call(&mut self, call: &Value) -> Value {
        let name = call["call"].as_str().unwrap_or_default().to_owned();
        let result = match (name.as_str(), self.replica.as_mut()) {
            ("launch", Some(replica)) => Err(fail(
                "refused",
                format!(
                    "{} is running; close it before launching another",
                    replica.id
                ),
            )),
            ("launch", None) => {
                self.launches += 1;
                let id = format!("replica:{}x{}", std::process::id(), self.launches);
                let out = self.out.join(format!("{}", self.launches));
                Replica::launch(id, out, self.plant, &call["launch"]).map(|(replica, reply)| {
                    self.replica = Some(replica);
                    reply
                })
            }
            ("ui_check", None) => check::run(self, &call["ui_check"]),
            ("motion_check", None) => motion::run(self, &call["motion_check"]),
            (_, None) => Err(fail("refused", "no replica runs here: launch one first")),
            (_, Some(replica)) if call["replica"].as_str().is_some_and(|r| r != replica.id) => {
                Err(fail(
                    "refused",
                    format!("no replica {}; this one is {}", call["replica"], replica.id),
                ))
            }
            (_, Some(replica)) => replica.call(&name, call),
        };
        let t = self.replica.as_ref().map_or(0, |r| r.clock.t);
        if name == "close" && result.is_ok() {
            self.replica = None;
        }
        match result {
            Ok(Value::Object(mut fields)) => {
                fields.insert("ok".into(), json!(true));
                fields.insert("t".into(), json!(t));
                Value::Object(fields)
            }
            Ok(_) => json!({"ok": true, "t": t}),
            Err(Fail(error)) => json!({"ok": false, "t": t, "error": error}),
        }
    }
}

struct Clock {
    /// Flicks since launch.
    t: u64,
    /// The real clock: each frame takes the wall time it took, so nothing repeats.
    real: Option<Instant>,
}

struct Recording {
    start: u64,
    every: u64,
    taken: u64,
    mask: Vec<Value>,
    blur: bool,
    dir: PathBuf,
    frames: Vec<Value>,
    actions: Vec<Value>,
}

/// What a device draws over the app, in device pixels; a height of 0 is none. Only the UI check reads them.
struct Device {
    bar: [i64; 4],
    keyboard: [i64; 4],
}

struct Replica {
    id: String,
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    glyphs: Glyphs,
    _runtime: Option<Rc<gpui_shell::ShellRuntime>>,
    out: PathBuf,
    plant: Option<Plant>,
    clock: Clock,
    /// The app's time at launch, ms since the epoch: the record's clock.
    now: u64,
    events: Vec<Value>,
    notifier: Notifier,
    /// Your hub, kept only by the planted replica that answers in it.
    hub: Option<(PathBuf, String)>,
    /// The last target acted on with a locator, which keys and words go to.
    focus: Option<Target>,
    /// Where the pointer is: where the last act put it, and outside the window until one does (#1461). The headless
    /// window reports its pointer at its top-left corner, over the list, whenever GPUI asks it again.
    pointer: Rc<Cell<Point<Pixels>>>,
    device: Option<Device>,
    pasted: Option<String>,
    shots: u64,
    recordings: u64,
    recording: Option<Recording>,
    steps: Vec<Value>,
    assertions: usize,
    failures: Vec<Value>,
    evidence: Vec<Value>,
    trace: Vec<Value>,
    notified: Vec<Value>,
    /// Issue #1100: each request the app made of macOS to allow notifications, `{t, ask}`: the ask it was posting, or null.
    permission_requests: Vec<Value>,
    /// Issue #1461: how the hub the app reads answers (`answering`, `stopped` or `slow`), and the app's watch of it.
    hub_state: String,
    watch: deep_app::record::HubWatch,
    /// Issue #1427: the motion recording while one runs, the launch's reduced motion, and the panel's script view,
    /// whose declared transitions and springs a recording lists.
    motion: Option<motion::Recorder>,
    reduced: bool,
    script: Option<Entity<gpui_shell::ScriptView>>,
    /// Issue #1546: in `launch.frames: "dirty"`, the frames GPUI drew on request and each step's comparison.
    dirty: Option<frames::Dirty>,
    /// Issue #1462: the replica's copy of the hub, which every call the app makes of its hub reaches.
    hub_copy: Arc<hubcopy::HubCopy>,
}

impl Replica {
    fn launch(
        id: String,
        out: PathBuf,
        plant: Option<Plant>,
        args: &Value,
    ) -> Result<(Replica, Value), Fail> {
        let word = |key: &str, allowed: &[&str], default: &str| -> Result<String, Fail> {
            match &args[key] {
                Value::Null => Ok(default.into()),
                Value::String(s) if allowed.contains(&s.as_str()) => Ok(s.clone()),
                other => Err(fail(
                    "refused",
                    format!("launch.{key} is one of {allowed:?}, not {other}"),
                )),
            }
        };
        let from = word("from", &["fixture", "record_copy", "empty"], "fixture")?;
        let center = word(
            "center",
            &[NEEDS_YOU, HOME, SESSION, WELCOME, AGENTS],
            NEEDS_YOU,
        )?;
        // Issue #1461: a machine whose setup hasn't finished, the hub the app reads, and where a panel goes.
        let setup = word("setup", &["finished", "unfinished"], "finished")?;
        // Issue #1100: macOS's notification setting, `not_asked` for a fresh account; the stand-in grants each request.
        let notifications = word(
            "notifications",
            &["not_asked", "allowed", "denied", "alerts_none", ""],
            "",
        )?;
        let hub_state = word("hub", &["answering", "stopped", "slow"], "answering")?;
        let area = match &args["area"] {
            Value::Null => None,
            Value::String(a) if ["sidebar", "home", "line"].contains(&a.as_str()) => {
                Some(a.clone())
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.area is sidebar, home or line, not {other}"),
                ))
            }
        };
        let replaces = word("replaces", &["needs-you", ""], "")?;
        let theme = word("theme", &["light", "dark"], "light")?;
        let clock = word("clock", &["virtual", "real"], "virtual")?;
        // #1546: "every" draws every view each frame; "dirty" only the frames GPUI says the window needs.
        let frames = word("frames", &["every", "dirty"], "every")?;
        let dirty = frames == "dirty";
        let scale = match &args["scale"] {
            Value::Null => 2.,
            v if v == 2 => 2.,
            v if v == 1 => 1.,
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.scale is 1 or 2, not {other}"),
                ))
            }
        };
        let size = match &args["size"] {
            Value::Null => crate::WINDOW,
            Value::Array(wh)
                if wh.len() == 2 && wh.iter().all(|v| v.as_u64().is_some_and(|n| n > 0)) =>
            {
                (
                    wh[0].as_u64().unwrap() as f32,
                    wh[1].as_u64().unwrap() as f32,
                )
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.size is [width, height] in points, not {other}"),
                ))
            }
        };
        // Nothing the app draws is localized yet, so every locale draws the same; the reply says which one ran.
        let locale = match &args["locale"] {
            Value::Null => "en-US".to_owned(),
            Value::String(tag)
                if tag.split('-').enumerate().all(|(i, part)| {
                    let n = part.len();
                    part.chars().all(|c| c.is_ascii_alphanumeric())
                        && if i == 0 {
                            (2..=3).contains(&n) && part.chars().all(|c| c.is_ascii_alphabetic())
                        } else {
                            (2..=8).contains(&n)
                        }
                }) =>
            {
                tag.clone()
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.locale is a language tag such as en-US, not {other}"),
                ))
            }
        };
        // A device's system bar over the window's top edge and on-screen keyboard over its bottom, in device pixels.
        let device = match &args["device"] {
            Value::Null => None,
            Value::Object(fields)
                if fields.keys().all(|k| k == "system_bar" || k == "keyboard") =>
            {
                let points = |key: &str| match &fields.get(key) {
                    None | Some(Value::Null) => Ok(0),
                    Some(v) => v.as_u64().filter(|&n| n as f32 <= size.1).ok_or_else(|| {
                        fail(
                            "refused",
                            format!(
                                "launch.device.{key} is points up to the window's height, not {v}"
                            ),
                        )
                    }),
                };
                let (w, h, s) = (size.0 * scale, size.1 * scale, scale);
                let (bar, keys) = (
                    points("system_bar")? as f32 * s,
                    points("keyboard")? as f32 * s,
                );
                Some(Device {
                    bar: [0., 0., w, bar].map(|v| v.round() as i64),
                    keyboard: [0., h - keys, w, keys].map(|v| v.round() as i64),
                })
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.device is {{system_bar, keyboard}} in points, not {other}"),
                ))
            }
        };
        if let Some(packs) = args["packs"].as_array().filter(|p| !p.is_empty()) {
            return Err(fail(
                "refused",
                format!(
                    "no pack is installed in a replica; asked for {}",
                    Value::Array(packs.clone())
                ),
            ));
        }
        let panel = match &args["panel"] {
            Value::Null => None,
            Value::String(dir) if Path::new(dir).is_absolute() && Path::new(dir).is_dir() => {
                Some(PathBuf::from(dir))
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("launch.panel is a panel package's absolute folder, not {other}"),
                ))
            }
        };
        // The view the panel registers, as `deep.registerView` gives it: its pages and ⌘K commands (#366).
        let view = match (&args["view"], &panel) {
            (Value::Null, _) => None,
            (view, Some(dir)) => Some(
                deep_app::commands::View::from_json(dir.clone(), view)
                    .map_err(|e| fail("refused", format!("launch.view: {e}")))?,
            ),
            (_, None) => {
                return Err(fail(
                    "refused",
                    "launch.view registers the panel in launch.panel, so it needs one",
                ))
            }
        };
        std::fs::create_dir_all(&out)
            .map_err(|e| fail("refused", format!("{}: {e}", out.display())))?;

        // Your record is read once, before the replica exists; the connection closes when the reader drops.
        let mut hub = None;
        let (events, now, held) = match from.as_str() {
            "fixture" => {
                let (path, held) = match &args["fixture"] {
                    Value::Null => (crate::fixture_path(), Some(crate::HELD.to_owned())),
                    Value::String(path) if Path::new(path).is_absolute() => (path.into(), None),
                    other => {
                        return Err(fail(
                            "refused",
                            format!(
                                "launch.fixture is an events file's absolute path, not {other}"
                            ),
                        ))
                    }
                };
                let fixture = Fixture::load(&path).map_err(|e| fail("refused", e))?;
                (fixture.events(), crate::NOW, held)
            }
            "empty" => (Vec::new(), crate::NOW, None),
            _ => {
                let socket = deep_app::hub::address();
                let token = deep_app::hub::root().join("control.token");
                let unread = |e: String| {
                    fail(
                        "blocked",
                        format!("your record can't be read for a copy: {e}"),
                    )
                };
                let token = std::fs::read_to_string(&token)
                    .map_err(|e| unread(e.to_string()))?
                    .trim()
                    .to_owned();
                let events = copy_record(&socket, &token).map_err(unread)?;
                if plant == Some(Plant::AnswersYourRecord) {
                    hub = Some((socket.clone(), token));
                }
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u64);
                (events, now, None)
            }
        };
        let fixture = Fixture {
            rows: events
                .iter()
                .map(|event| Row {
                    session_id: event["session"].as_str().unwrap_or_default().to_owned(),
                    event: event.clone(),
                })
                .collect(),
        };
        deep_app::record::install_local(events.clone());
        deep_app::views::set_state(AppState {
            inbox: inbox(&fixture, fixture.last_log_pos()),
            now,
            sessions: fixture.sessions(),
            held,
        });
        if setup == "unfinished" {
            deep_app::setup::assume_unfinished();
        }
        deep_app::record::set_local_hub(match hub_state.as_str() {
            "stopped" => deep_app::record::LocalHub::Stops,
            "slow" => deep_app::record::LocalHub::Slow,
            _ => deep_app::record::LocalHub::Answers,
        });
        // Its window is the front one on an awake, unlocked screen; its acts are your input (#1461).
        deep_app::shown::force_seen(Some(deep_app::shown::Seen {
            visible: true,
            minimized: false,
            display_awake: true,
            session_locked: false,
        }));

        let glyphs = Glyphs::default();
        let renderer_glyphs = glyphs.clone();
        let mut cx = HeadlessAppContext::with_platform(
            glyphs.text_system(gpui_kit::platform::current_platform(true).text_system()),
            Arc::new(gpui_kit::assets::Assets),
            move || {
                Ok(gpui_kit::platform::current_headless_renderer()?
                    .map(|r| renderer_glyphs.renderer(r)))
            },
        );
        type Mounted = Option<(Rc<gpui_shell::ShellRuntime>, Entity<gpui_shell::ScriptView>)>;
        let mounted: Rc<RefCell<Result<Mounted, String>>> = Rc::new(RefCell::new(Ok(None)));
        // Issue #1462: a registered view whose panel doesn't load launches anyway, as the app does, naming it in a notice.
        let failing = view.as_ref().map(|view| view.name.clone());
        // Every call the app makes of its hub reaches the replica's copy of it.
        let kept_pointer = Rc::new(Cell::new(point(px(-1.), px(-1.))));
        let hub_copy = hubcopy::HubCopy::new(&events);
        let taker = hub_copy.clone();
        deep_app::hub::set_local(Some(Arc::new(move |method, params| {
            taker.take(method, params)
        })));
        let reduced = args["reduced_motion"].as_bool().unwrap_or(false);
        let window = cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
            cx.set_reduce_motion(reduced);
            // A panel gets the clipboard its manifest declares, as its install card would grant it; nothing else. What
            // it writes lands in the replica's own clipboard, which never reaches your Mac.
            if let Some(manifest) = panel.as_ref().and_then(|dir| {
                gpui_shell::plugin::PluginManifest::read(dir)
                    .ok()
                    .map(|m| (dir.clone(), m))
            }) {
                let (dir, manifest) = manifest;
                let declared = manifest.capabilities(&dir, &dir);
                let clipboard = gpui_shell::Capabilities::default()
                    .clipboard_read(declared.is_clipboard_readable())
                    .clipboard_write(declared.is_clipboard_writable());
                gpui_shell::policy::update_default(|policy| policy.with_capabilities(clipboard));
            }
            let mode = if theme == "dark" {
                gpui_kit::component::ThemeMode::Dark
            } else {
                gpui_kit::component::ThemeMode::Light
            };
            gpui_kit::component::Theme::change(mode, None, cx);
            // gpui's headless window always reports light, so the chrome is told the theme instead.
            deep_app::chrome::force_dark(Some(theme == "dark"));
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: gpui_kit::size(px(size.0), px(size.1)),
                })),
                // The dirty mode's frames are paced by the replica's clock alone, never by the wall clock's throttle.
                inactive_frame_interval: if dirty {
                    None
                } else {
                    crate::shell::window_options().inactive_frame_interval
                },
                ..crate::shell::window_options()
            };
            // The window opens where the app opens, unless the launch names a page (#1461). A panel with no area goes in
            // the list's slot, as before; one registered to an area goes there; one replacing Needs you fills the list's
            // first section.
            let base = Layout::shipped("needs-you");
            let mut layout = if center == NEEDS_YOU {
                base
            } else {
                Layout {
                    center: vec![center],
                    active: 0,
                    ..base
                }
            };
            if setup == "unfinished" {
                layout.center.insert(0, WELCOME.into());
                layout.active = 0;
            }
            if panel.is_some() && area.is_none() && replaces.is_empty() {
                layout.sidebar = deep_app::views::EXTENSION.into();
            }
            if !replaces.is_empty() {
                layout.needs_you = format!("shell:deepbuild-panel/{replaces}");
            }
            let placed_as = view.as_ref().map(|v| v.name.clone());
            // #124's wrong rows exist in an env-plants build only (#1662), as the plant that selects them does.
            #[cfg(feature = "env-plants")]
            deep_app::views::plant_row(match plant {
                Some(Plant::RowLabelPastFrame) => Some(deep_app::views::RowPlant::PastFrame),
                Some(Plant::RowBranchCutOff) => Some(deep_app::views::RowPlant::CutOff),
                _ => None,
            });
            // #1470's planted menu is served by the panel module, which reads the plant from its environment.
            if plant == Some(Plant::MenuReleaseAlways) {
                std::env::set_var("DEEP_HUB_PLANT", "menu-release-always");
            }
            let into = mounted.clone();
            let replacing = !replaces.is_empty();
            let failing = failing.clone();
            let resting = kept_pointer.get();
            let (window, shell) = open_shell_with(options, &layout, cx, move |window, cx| {
                // The pointer starts where the replica has it, before the window's first frame.
                let at = MouseMoveEvent {
                    position: resting,
                    pressed_button: None,
                    modifiers: Modifiers::default(),
                };
                window.dispatch_event(at.to_platform_input(), cx);
                match panel {
                    Some(dir) => {
                        let runtime = deep_app::new_runtime();
                        let loaded = runtime.map_err(|e| e.to_string()).and_then(|runtime| {
                            let view = deep_app::mount_panel(&runtime, &dir, window, cx)
                                .map_err(|e| format!("{e:#}"))?;
                            match (&area, replacing) {
                                (Some(area), _) => deep_app::views::place(
                                    area,
                                    placed_as.as_deref().unwrap_or("panel"),
                                    view.clone().into(),
                                    window,
                                    cx,
                                ),
                                (None, true) => {}
                                (None, false) => {
                                    deep_app::open::place_extension(view.clone().into(), cx)
                                }
                            }
                            Ok(Some((runtime, view)))
                        });
                        *into.borrow_mut() = match (loaded, failing) {
                            (Err(why), Some(name)) => {
                                deep_app::open::place_extension(
                                    deep_app::views::shipped(Kind::Sidebar, cx),
                                    cx,
                                );
                                deep_app::installed::failed(&name, &why, cx);
                                Ok(None)
                            }
                            (loaded, _) => loaded,
                        };
                    }
                    None => deep_app::open::place_extension(
                        deep_app::views::shipped(Kind::Sidebar, cx),
                        cx,
                    ),
                }
            });
            // ⌘K lists what the app's lists: the shipped pages and the preferences, which open the box (#1998), then a
            // registered view's entries (#1462).
            let _ = window.update(cx, |_, window, cx| {
                let views: Vec<_> = view.into_iter().collect();
                let palette = cx.new(|cx| {
                    let mut palette = deep_app::commands::Palette::new(
                        &[],
                        recency(plant),
                        opener(plant),
                        window,
                        cx,
                    );
                    let mut entries = deep_app::installed::shipped_pages();
                    entries.extend(deep_app::commands::entries(&views));
                    palette.set_entries(entries, cx);
                    palette
                });
                let words = cx.new(|cx| {
                    deep_app::words::WordsBox::new(deep_app::words::hub_say(), window, cx)
                });
                shell.update(cx, |shell, cx| {
                    shell.set_commands(palette, window, cx);
                    shell.set_box(words, cx);
                    // GPUI asks the window where the pointer is when it activates or moves, and the headless one
                    // answers its top-left corner: the pointer goes back where the replica has it.
                    let pointer = kept_pointer.clone();
                    cx.observe_window_bounds(window, move |_, window, cx| {
                        let at = pointer.get();
                        if window.mouse_position() != at {
                            let event = MouseMoveEvent {
                                position: at,
                                pressed_button: None,
                                modifiers: Modifiers::default(),
                            };
                            window.dispatch_event(event.to_platform_input(), cx);
                        }
                    })
                    .detach();
                });
            });
            window
        });
        let (runtime, script) = mounted
            .borrow_mut()
            .clone()
            .map_err(|e| fail("refused", format!("the panel didn't load: {e}")))?
            .unzip();
        // GPUI's test window reports 2x; the window itself lays out and paints at the scale it's set to, and the
        // renderer sizes its images to match.
        glyphs.draw_at(scale);
        let _ = cx.update_window(window, |_, window, _| window.set_scale_factor(scale));

        let mut notifier = Notifier::new(NOTIFY_AFTER);
        for event in &events {
            notifier.saw(event, now);
        }
        if let Some(setting) = NotificationSetting::parse(&notifications) {
            notifier.set_setting(setting, now);
        }
        let mut replica = Replica {
            id,
            cx,
            window,
            glyphs,
            _runtime: runtime,
            out,
            plant,
            clock: Clock {
                t: 0,
                real: (clock == "real").then(Instant::now),
            },
            now,
            events,
            notifier,
            hub,
            focus: None,
            device,
            pasted: None,
            shots: 0,
            recordings: 0,
            recording: None,
            steps: Vec::new(),
            assertions: 0,
            failures: Vec::new(),
            evidence: Vec::new(),
            trace: Vec::new(),
            notified: Vec::new(),
            permission_requests: Vec::new(),
            hub_state,
            watch: deep_app::record::HubWatch::default(),
            motion: None,
            reduced,
            script,
            dirty: None,
            hub_copy,
            pointer: kept_pointer,
        };
        replica.draw();
        replica.draw();
        if dirty {
            replica.cx.draw_on_request();
            replica.dirty = Some(frames::Dirty::new(replica.live_tree()));
        }
        let reply = json!({
            "replica": replica.id,
            "window": {"size": [size.0 as u32, size.1 as u32], "scale": scale as u32},
            "locale": locale,
            "frames": frames,
        });
        replica
            .trace
            .push(json!({"call": "launch", "launch": args, "reply": reply}));
        Ok((replica, reply))
    }

    fn call(&mut self, name: &str, call: &Value) -> Result<Value, Fail> {
        let wall = Instant::now();
        let index = self.steps.len() + 1;
        let acts = name == "act";
        let before = acts.then(|| self.snapshot_file());
        self.begin_step();
        let result = match name {
            "act" => self.act(call),
            "hub" => self.hub(call),
            "feed" => self.feed(call),
            "open" => self.open(call),
            "notification" => self.notification(call),
            "resize" => self.resize(call),
            "wait_for" => self.wait_for(call),
            "see" => self.see(call),
            "probe" => self.probe(call),
            "screenshot" => self.screenshot(&call["screenshot"]),
            "record" => self.record(&call["record"]),
            "motion" => self.motion(&call["motion"]),
            "expect" => self.expect(call, index),
            "menus" => Ok(self.menus()),
            "close" => return Ok(self.close()),
            other => Err(fail(
                "refused",
                format!("{other:?} is no call; the calls are launch, act, open, notification, wait_for, see, probe, screenshot, record, motion, expect, feed, resize, menus, close, ui_check and motion_check"),
            )),
        };
        let mut digested = call.clone();
        if let Some(fields) = digested.as_object_mut() {
            fields.remove("replica");
        }
        self.end_step(index, name);
        let id = format!("step {index}: {name}");
        self.steps
            .push(json!({"id": id, "digest": sha256(digested.to_string().as_bytes())}));
        if let Err(Fail(error)) = &result {
            let message = error["message"].as_str().unwrap_or_default().to_owned();
            self.failures.push(json!({
                "test": id, "message": message, "cause": id, "frames": [], "covers": [], "case": null,
            }));
        }
        let after = acts.then(|| self.snapshot_file());
        self.trace.push(json!({
            "step": index, "call": call, "t": self.clock.t, "ms": wall.elapsed().as_secs_f64() * 1000.,
            "ok": result.is_ok(), "error": result.as_ref().err().map(|Fail(e)| Value::Object(e.clone())),
            "before": before, "after": after,
        }));
        result
    }

    // ---- The clock and frames.

    fn draw(&mut self) {
        let glyphs = self.glyphs.clone();
        let recording = self.motion.is_some();
        let pointer = self.pointer.get();
        let _ = self.cx.update_window(self.window, |_, window, cx| {
            // The pointer stays where the last act put it, though the window asked its platform again.
            if window.mouse_position() != pointer {
                let at = MouseMoveEvent {
                    position: pointer,
                    pressed_button: None,
                    modifiers: Modifiers::default(),
                };
                window.dispatch_event(at.to_platform_input(), cx);
            }
            // A frame redraws every view, so the canvas items it lists are this frame's alone.
            deep_app::canvas::clear_items();
            // While motion is recorded every view paints each step, cached or not, so each is sampled.
            if recording {
                window.refresh();
            }
            window.render_frame(cx);
            glyphs.keep_scene(window);
        });
    }

    /// One frame of the replica's clock: timers due run, the window draws, notifications come due and, while
    /// recording, a frame is taken at each 30th of a second.
    fn tick(&mut self) {
        self.tick_by(None);
    }

    /// One frame, as `tick`, standing for `step` flicks of the virtual clock in place of a 60th of a second
    /// (`wait_for`'s `step_ms`, #2028).
    fn tick_by(&mut self, step: Option<u64>) {
        let step = match &mut self.clock.real {
            Some(wall) => {
                let took = (wall.elapsed().as_nanos() as u64 * 441 / 625).max(1);
                *wall = Instant::now();
                took
            }
            None if self.motion.is_some() => motion::STEP,
            None => step.unwrap_or(FRAME),
        };
        let before = nanos(self.clock.t);
        self.clock.t += step;
        // The views' clock follows the replica's in every mode, so an age a row writes ticks as the clock runs (#1458).
        self.move_views_clock();
        self.cx
            .advance_clock(Duration::from_nanos(nanos(self.clock.t) - before));
        self.cx.run_until_parked();
        // Time passes for the question card as the app's tick passes it, so it arms once its interval ran (#1459).
        let now = self.now + self.clock.t * 1000 / FLICKS;
        self.watch_hub(now);
        // What the replica's copy of the hub recorded reaches the app's reader as the hub's stream would (#1462).
        for mut event in self.hub_copy.take_pending() {
            let log_pos = deep_app::record::with_view(|view| view.log_pos).unwrap_or(0) + 1;
            event["log_pos"] = json!(log_pos);
            event["ts"] = json!(now);
            event["id"] = json!(format!("01KB1462HC{log_pos:016}"));
            self.notifier.saw(&event, now);
            self.events.push(event.clone());
            self.cx.update(|cx| deep_app::record::deliver(event, cx));
        }
        self.cx.update(|cx| deep_app::views::tick(now, cx));
        if self.motion.is_some() {
            self.sample();
        } else if self.dirty.is_some() {
            self.request();
        } else {
            self.draw();
        }
        self.notify();
        self.take_frames();
    }

    fn frame(&mut self) -> Frame {
        if let Some(dirty) = &self.dirty {
            return dirty.drawn().1;
        }
        let glyphs = self.glyphs.clone();
        self.cx
            .update_window(self.window, |_, window, _| Frame::read(window, &glyphs))
            .expect("the replica's window is open")
    }

    fn scale(&mut self) -> f32 {
        self.cx
            .update_window(self.window, |_, window, _| window.scale_factor())
            .unwrap_or(2.)
    }

    fn timeout(call: &Value) -> u64 {
        call["timeout"].as_u64().unwrap_or(TIMEOUT_MS)
    }

    fn notify(&mut self) {
        let now = self.now + self.clock.t * 1000 / FLICKS;
        // The Set up click asks macOS (#1100); the stand-in answers at once, as a person pressing Allow.
        if deep_app::notify::take_ask() {
            self.permission_requests
                .push(json!({"t": self.clock.t, "ask": null}));
            self.notifier.set_setting(NotificationSetting::Allowed, now);
        }
        let notifier = &mut self.notifier;
        // Sounds off in the box's words (#1998) leave the question unsounded, as in the app.
        let sounds = deep_app::hub::sounds_on();
        let due = deep_app::record::with_view(|view| notifier.due(view, now, None, sounds));
        for posted in due.unwrap_or_default() {
            // A post while macOS was never asked asks it then, as GPUI's center does on its first post.
            if self.notifier.reach(false).setting == NotificationSetting::NotAsked {
                self.permission_requests
                    .push(json!({"t": self.clock.t, "ask": posted.ask}));
                self.notifier.set_setting(NotificationSetting::Allowed, now);
            }
            #[cfg(target_os = "macos")]
            if self.plant == Some(Plant::StartsSound) && posted.sound.is_some() {
                plant::play_sound();
            }
            self.notified.push(json!({
                "t": self.clock.t, "ask": posted.ask, "session": posted.session, "text": posted.text,
                "sound": posted.sound.map(|_| "question"),
            }));
        }
    }

    // ---- Acting.

    /// Waits until the locator names one target that is visible, enabled and in the same place two frames running.
    fn actionable(&mut self, locator: &Value, timeout_ms: u64) -> Result<(Target, u64), Fail> {
        let start = self.clock.t;
        let deadline = start + timeout_ms * FLICKS / 1000;
        let mut last: Option<[i64; 4]> = None;
        let mut seen: Option<Target> = None;
        loop {
            match self.frame().one(locator) {
                Ok(target) if target.visible && target.enabled => {
                    if last == Some(target.bounds) {
                        return Ok((target, self.clock.t - start));
                    }
                    last = Some(target.bounds);
                    seen = Some(target);
                }
                Ok(target) => {
                    last = None;
                    seen = Some(target);
                }
                Err(Miss::Bad(why)) => return Err(fail("refused", why)),
                Err(Miss::Ambiguous(all)) => return Err(ambiguous(locator, all)),
                Err(Miss::None) => last = None,
            }
            if self.clock.t >= deadline {
                return Err(match seen {
                    None => fail("locate.none", format!("nothing matches {locator} within {timeout_ms} ms")),
                    Some(target) => fail(
                        "timeout",
                        format!(
                            "{} wasn't visible, enabled and still within {timeout_ms} ms (visible {}, enabled {})",
                            locator, target.visible, target.enabled
                        ),
                    )
                    .with("timeout_ms", json!(timeout_ms)),
                });
            }
            self.tick();
        }
    }

    fn input(&mut self, event: PlatformInput) {
        match &event {
            PlatformInput::MouseMove(e) => self.pointer.set(e.position),
            PlatformInput::MouseDown(e) => self.pointer.set(e.position),
            PlatformInput::MouseUp(e) => self.pointer.set(e.position),
            _ => {}
        }
        // In the dirty mode the window draws what the input changed at its next frame, as a real one does (#1546).
        let forced = self.dirty.is_none();
        let _ = self.cx.update_window(self.window, |_, window, cx| {
            window.dispatch_event(event, cx);
            if forced {
                window.render_frame(cx);
            }
        });
    }

    fn act(&mut self, call: &Value) -> Result<Value, Fail> {
        let act = &call["act"];
        let kind = act["kind"].as_str().unwrap_or_default().to_owned();
        let locator = &call["locator"];
        // A drop target on any other action is a target put in the wrong field: say where it goes, rather than act
        // on the focused element.
        let given = |v: &Value| {
            v.as_object()
                .map_or(!v.is_null(), |o| o.values().any(|x| !x.is_null()))
        };
        if kind != "drag" && (given(&act["to"]) || given(&act["to_point"])) {
            return Err(fail(
                "refused",
                format!("act {kind} takes its target in locator; to and to_point are where a drag drops"),
            ));
        }
        let timeout_ms = Self::timeout(call);
        let scale = self.scale();
        let at = |p: [i64; 2]| point(px(p[0] as f32 / scale), px(p[1] as f32 / scale));
        // A press where the pointer is, at a point in device pixels: no locator, no wait for stillness (#1461).
        if kind == "click" && locator.is_null() {
            if let Some(p) = act["point"].as_array().filter(|p| p.len() == 2) {
                let p = [p[0].as_i64().unwrap_or(0), p[1].as_i64().unwrap_or(0)];
                self.input_at(self.clock.t);
                self.click(at(p), 1);
                self.tick();
                self.tick();
                return Ok(json!({"point": p, "result": "delivered"}));
            }
        }
        // A menu bar item, picked as a click on it would (#1461).
        if kind == "menu" {
            let path: Vec<&str> = act["path"]
                .as_array()
                .map(|p| p.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            // The item's action, as the menu bar the app set holds it.
            let action = self.cx.update(|cx| {
                let [menu, item] = path.as_slice() else {
                    return None;
                };
                cx.get_menus()?
                    .iter()
                    .find(|m| m.name.as_ref() == *menu)?
                    .items
                    .iter()
                    .find_map(|entry| match entry {
                        OwnedMenuItem::Action { name, action, .. } if name == item => {
                            Some(action.boxed_clone())
                        }
                        _ => None,
                    })
            });
            let Some(action) = action else {
                return Err(fail(
                    "locate.none",
                    format!("the menu bar has no item {path:?}"),
                ));
            };
            self.input_at(self.clock.t);
            self.cx.update(|cx| cx.dispatch_action(action.as_ref()));
            self.tick();
            self.tick();
            return Ok(json!({"menu": path, "result": "delivered"}));
        }
        let (target, waited) = match (&kind[..], locator.is_null()) {
            ("type" | "press", true) => match self.focus.clone() {
                Some(focus) => (focus, 0),
                None => (self.whole_window(scale), 0),
            },
            (_, true) => return Err(fail("refused", format!("act {kind} needs a locator"))),
            _ => self.actionable(locator, timeout_ms)?,
        };
        let center = target.center();
        // A pointer action asks the frame what the event would reach before anything is sent.
        let pointer = kind != "press" && !locator.is_null();
        if pointer && self.plant != Some(Plant::NoHitTest) {
            let receiver = self.receiver(&target, center);
            if receiver.path != target.path || receiver.text != target.text {
                return Err(fail(
                    "refused",
                    format!(
                        "{kind} on {locator} would reach {} {} in front of it; nothing was sent",
                        receiver.role,
                        receiver.name.as_deref().unwrap_or("with no name"),
                    ),
                )
                .with("covered_by", receiver.summary())
                .with("point", json!(center))
                .with("box", json!(target.bounds)));
            }
        }
        let when = self.clock.t;
        self.input_at(when);
        match kind.as_str() {
            "click" | "double_click" => {
                let count = if kind == "click" { 1 } else { 2 };
                self.click(at(center), count);
            }
            "hover" => self.input(MouseMoveEvent { position: at(center), pressed_button: None, modifiers: Modifiers::default() }.to_platform_input()),
            // A secondary click (#1462): the right button down and up where the locator is.
            "context_click" => {
                let (position, modifiers, button) = (at(center), Modifiers::default(), MouseButton::Right);
                self.input(MouseMoveEvent { position, pressed_button: None, modifiers }.to_platform_input());
                self.input(MouseDownEvent { button, position, modifiers, click_count: 1, first_mouse: false }.to_platform_input());
                self.input(MouseUpEvent { button, position, modifiers, click_count: 1 }.to_platform_input());
            }
            "type" => {
                let Some(text) = act["text"].as_str() else {
                    return Err(fail("refused", "act type needs its text"));
                };
                if !locator.is_null() && self.focus.as_ref() != Some(&target) {
                    self.click(at(center), 1);
                }
                let text = text.to_owned();
                let _ = self.cx.update_window(self.window, |_, window, cx| window.input(&text, cx));
            }
            "press" => {
                let keys: Vec<String> = act["keys"].as_str().unwrap_or_default().split_whitespace().map(str::to_owned).collect();
                if keys.is_empty() {
                    return Err(fail("refused", "act press needs its keys, as space-separated keystrokes"));
                }
                if let Some(bad) = keys.iter().find(|k| Keystroke::parse(k).is_err()) {
                    return Err(fail("refused", format!("{bad:?} is no keystroke")));
                }
                for key in keys {
                    let _ = self.cx.update_window(self.window, |_, window, cx| window.press(&key, cx));
                }
            }
            "scroll" => {
                let (dx, dy) = (act["dx"].as_f64().unwrap_or(0.) as f32, act["dy"].as_f64().unwrap_or(0.) as f32);
                let position = at(center);
                self.input(MouseMoveEvent { position, pressed_button: None, modifiers: Modifiers::default() }.to_platform_input());
                for _ in 0..SCROLL_FRAMES {
                    let delta = ScrollDelta::Pixels(point(px(-dx / SCROLL_FRAMES as f32), px(-dy / SCROLL_FRAMES as f32)));
                    self.input(ScrollWheelEvent { position, delta, ..Default::default() }.to_platform_input());
                    self.tick();
                }
            }
            "drag" => {
                let to = match (&act["to"], act["to_point"].as_array()) {
                    (Value::Null, Some(p)) if p.len() == 2 => [p[0].as_i64().unwrap_or(0), p[1].as_i64().unwrap_or(0)],
                    (Value::Null, _) => return Err(fail("refused", "act drag needs to (a locator) or to_point ([x, y] in device pixels)")),
                    (to, _) => self.actionable(to, timeout_ms)?.0.center(),
                };
                let (from, to) = (at(center), at(to));
                let _ = self.cx.update_window(self.window, |_, window, cx| window.drag(from, to, cx));
            }
            "set" => {
                let value = act["value"].as_str().unwrap_or_default().to_owned();
                match target.role.as_str() {
                    "check_box" | "switch" | "radio_button" => {
                        if target.checked != Some(value == "true") {
                            self.click(at(center), 1);
                        }
                    }
                    role if role.ends_with("input") => {
                        self.click(at(center), 1);
                        let _ = self.cx.update_window(self.window, |_, window, cx| {
                            window.press("cmd-a", cx);
                            window.input(&value, cx);
                        });
                    }
                    role => return Err(fail("refused", format!("act set takes a text input, a check box, a switch or a radio button, not a {role}"))),
                }
            }
            other => {
                return Err(fail(
                    "refused",
                    format!("{other:?} is no action; they are click, double_click, context_click, type, press, drag, scroll, hover and set"),
                ))
            }
        }
        if !locator.is_null() {
            self.focus = Some(target.clone());
        }
        if matches!(kind.as_str(), "type" | "press" | "drag" | "set") {
            self.input_drew();
        }
        self.tick();
        self.tick();
        self.after_input(&kind, &target);
        if let Some(recording) = &mut self.recording {
            recording.actions.push(json!({
                "t": when - recording.start, "kind": kind, "point": center, "box": target.bounds,
                "locator": if locator.is_null() { json!({"focused": target.summary()}) } else { locator.clone() },
            }));
        }
        // Delivered is all an action can say: what the target did with it is for an assertion.
        Ok(
            json!({"point": center, "box": target.bounds, "waited_ms": waited * 1000 / FLICKS, "result": "delivered"}),
        )
    }

    /// What a pointer event at `at` would reach: `target`, or what's in front of it.
    fn receiver(&mut self, target: &Target, at: [i64; 2]) -> Target {
        let frame = self.frame();
        self.cx
            .update_window(self.window, |_, window, _| {
                frame.receiver(window, target, at)
            })
            .expect("the replica's window is open")
    }

    /// The system bar, and the keyboard while a text input has focus: each `(audit, role, box)` over the app now.
    fn insets(&self) -> Vec<(&'static str, &'static str, [i64; 4])> {
        let Some(device) = &self.device else {
            return Vec::new();
        };
        let typing = self
            .focus
            .as_ref()
            .is_some_and(|t| t.role.ends_with("input"));
        let mut over = vec![("under_system_bar", "system_bar", device.bar)];
        if typing {
            over.push(("under_keyboard", "keyboard", device.keyboard));
        }
        over.retain(|(_, _, b)| b[3] > 0);
        over
    }

    /// An action's hit test with no action: the point a click would use and what would get it. Nothing is sent and
    /// no frame passes.
    fn probe(&mut self, call: &Value) -> Result<Value, Fail> {
        let locator = &call["locator"];
        let target = match self.frame().one(locator) {
            Ok(target) => target,
            Err(Miss::Bad(why)) => return Err(fail("refused", why)),
            Err(Miss::None) => {
                return Err(fail("locate.none", format!("nothing matches {locator}")))
            }
            Err(Miss::Ambiguous(all)) => return Err(ambiguous(locator, all)),
        };
        let center = target.center();
        let receiver = self.receiver(&target, center);
        let clear = receiver.path == target.path && receiver.text == target.text;
        Ok(
            json!({"point": center, "box": target.bounds, "receiver": receiver.summary(), "clear": clear}),
        )
    }

    fn click(&mut self, position: Point<Pixels>, count: usize) {
        let modifiers = Modifiers::default();
        self.input(
            MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers,
            }
            .to_platform_input(),
        );
        for click_count in 1..=count {
            let button = MouseButton::Left;
            self.input(
                MouseDownEvent {
                    button,
                    position,
                    modifiers,
                    click_count,
                    first_mouse: false,
                }
                .to_platform_input(),
            );
            self.input(
                MouseUpEvent {
                    button,
                    position,
                    modifiers,
                    click_count,
                }
                .to_platform_input(),
            );
        }
    }

    fn whole_window(&mut self, scale: f32) -> Target {
        let size = self
            .cx
            .update_window(self.window, |_, window, _| window.viewport_size())
            .unwrap_or_default();
        Target {
            role: "window".into(),
            name: None,
            value: None,
            bounds: [
                0,
                0,
                (f32::from(size.width) * scale) as i64,
                (f32::from(size.height) * scale) as i64,
            ],
            visible: true,
            enabled: true,
            checked: None,
            text: None,
            path: Vec::new(),
        }
    }

    /// Where a planted replica lets an input through; a replica that isn't planted does nothing here.
    fn after_input(&mut self, kind: &str, target: &Target) {
        match self.plant {
            Some(Plant::AnswersYourRecord) if kind == "click" => {
                // A row reads as its question (#1172), so the ask is the one whose question it shows.
                let name = target.name.as_deref().unwrap_or_default();
                let asked = self.events.iter().find(|e| {
                    e["kind"] == "ask.created"
                        && e["data"]["question"]
                            .as_str()
                            .is_some_and(|question| name.starts_with(question))
                });
                let ask = asked.map(|e| format!("ask:{}", e["id"].as_str().unwrap_or_default()));
                let option =
                    asked.and_then(|e| e["data"]["options"][0]["id"].as_str().map(str::to_owned));
                if let (Some((socket, token)), Some(ask), Some(option)) = (&self.hub, ask, option) {
                    let answered = plant::answer(socket, token, &ask, &option);
                    self.trace.push(json!({"planted": "answers-your-record", "ask": ask, "reply": answered.unwrap_or_else(|e| json!(e))}));
                }
            }
            #[cfg(target_os = "macos")]
            Some(Plant::WritesClipboard) => {
                let text = self
                    .cx
                    .update(|cx| cx.read_from_clipboard())
                    .and_then(|item| item.text());
                if let Some(text) = text.filter(|t| self.pasted.as_ref() != Some(t)) {
                    plant::write_pasteboard(&text);
                    self.pasted = Some(text);
                }
            }
            #[cfg(target_os = "macos")]
            Some(Plant::MovesFocus) => {
                let asked = self
                    .cx
                    .update_window(self.window, |_, window, _| window.is_window_active())
                    .unwrap_or(false);
                if asked {
                    plant::take_front();
                }
            }
            _ => {}
        }
    }

    // ---- Waiting, seeing and asserting.

    fn wait_for(&mut self, call: &Value) -> Result<Value, Fail> {
        let wait = &call["wait_for"];
        let timeout_ms = Self::timeout(call);
        let deadline = self.clock.t + timeout_ms * FLICKS / 1000;
        if let Some(t) = wait["t"].as_u64() {
            // With step_ms the virtual clock runs a frame each step_ms, the last shorter, so hours take thousands of
            // frames, not a frame each 60th (#2028).
            let step = match &wait["step_ms"] {
                Value::Null => None,
                ms => match ms.as_u64() {
                    Some(ms) if ms > 0 && self.clock.real.is_none() && self.motion.is_none() => Some(ms * FLICKS / 1000),
                    Some(ms) if ms > 0 => return Err(fail("refused", "step_ms runs the virtual clock, and this replica's clock is real or recording motion")),
                    _ => return Err(fail("refused", format!("step_ms is a whole number of ms above 0, not {ms}"))),
                },
            };
            while self.clock.t < t {
                if self.clock.t >= deadline {
                    return Err(fail(
                        "timeout",
                        format!("t {t} is past the {timeout_ms} ms timeout"),
                    )
                    .with("timeout_ms", json!(timeout_ms)));
                }
                self.tick_by(step.map(|step| step.min(t - self.clock.t)));
            }
            return Ok(if step.is_some() {
                json!({"step_ms": wait["step_ms"]})
            } else {
                json!({})
            });
        }
        let state = wait["state"].as_str().map(str::to_owned);
        let event = wait["event"].as_str().map(str::to_owned);
        let locator = call["locator"].clone();
        let mut previous: Option<Vec<Target>> = None;
        loop {
            let frame = self.frame();
            let done = match (state.as_deref(), &event) {
                (_, Some(kind)) => self.events.iter().any(|e| e["kind"] == kind.as_str()),
                (Some("settled"), _) => {
                    let now = frame.elements.clone();
                    let still = previous.as_ref() == Some(&now);
                    previous = Some(now);
                    still
                }
                (Some(state @ ("visible" | "hidden" | "enabled" | "text" | "value")), _) => {
                    let found = frame.all(&locator).map_err(|why| fail("refused", why))?;
                    match state {
                        "hidden" => found.is_empty(),
                        _ if found.len() > 1 => return Err(ambiguous(&locator, found)),
                        "visible" => found.len() == 1,
                        "enabled" => found.first().is_some_and(|t| t.enabled),
                        "text" => found.first().is_some_and(|t| Some(text_of(&frame, t)) == wait["value"].as_str().map(str::to_owned)),
                        _ => found.first().is_some_and(|t| Some(value_of(&frame, t)) == wait["value"].as_str().map(str::to_owned)),
                    }
                }
                (other, None) => {
                    return Err(fail(
                        "refused",
                        format!("wait_for takes a state (visible, hidden, enabled, text, value, settled), an event or a t, not {other:?}"),
                    ))
                }
            };
            if done {
                return Ok(json!({}));
            }
            if self.clock.t >= deadline {
                return Err(fail(
                    "timeout",
                    format!("{wait} didn't come within {timeout_ms} ms"),
                )
                .with("timeout_ms", json!(timeout_ms)));
            }
            self.tick();
        }
    }

    fn expect(&mut self, call: &Value, index: usize) -> Result<Value, Fail> {
        let expect = &call["expect"];
        let name = expect["name"]
            .as_str()
            .map_or_else(|| format!("step {index}"), str::to_owned);
        let assert = expect["assert"].as_str().unwrap_or_default().to_owned();
        let locator = &call["locator"];
        let expected = match assert.as_str() {
            "visible" => json!(true),
            "count" => expect["count"].clone(),
            "state" => expect["state"].clone(),
            "text" | "value" => expect["value"].clone(),
            other => {
                return Err(fail(
                    "refused",
                    format!("expect asserts visible, text, value, count or state, not {other:?}"),
                ))
            }
        };
        let timeout_ms = Self::timeout(call);
        let deadline = self.clock.t + timeout_ms * FLICKS / 1000;
        // An assertion waits for what it expects, up to the timeout, as an action waits for its target.
        let (passed, actual) = loop {
            let frame = self.frame();
            let found = frame.all(locator).map_err(|why| fail("refused", why))?;
            let actual = match (assert.as_str(), found.as_slice()) {
                ("count", _) => json!(found.len()),
                (_, []) => json!("nothing matches"),
                (_, [target]) => match assert.as_str() {
                    "visible" => json!(target.visible),
                    "text" => json!(text_of(&frame, target)),
                    "value" => json!(value_of(&frame, target)),
                    _ => json!(state_of(target, expected.as_str().unwrap_or_default())),
                },
                (_, many) => json!(format!("{} matches", many.len())),
            };
            let passed = actual == expected;
            if passed || self.clock.t >= deadline {
                break (passed, actual);
            }
            self.tick();
        };
        self.assertions += 1;
        if !passed {
            let message = format!("expected {expected}, got {actual}");
            self.failures.push(json!({
                "test": name, "message": message, "cause": name, "frames": [], "covers": [],
                "case": format!("{name}: {message}"),
            }));
        }
        Ok(
            json!({"assertion": {"name": name, "assert": assert, "passed": passed, "expected": expected, "actual": actual}}),
        )
    }

    /// The text snapshot, in #338's one shape (#1459): roles, names, values, ids and bounds of every element with a
    /// role, the strings drawn that no element already names, and the canvas items with their values.
    fn tree(&mut self) -> (Value, Frame) {
        match &self.dirty {
            Some(dirty) => dirty.drawn(),
            None => self.live_tree(),
        }
    }

    /// The snapshot of what the window holds now.
    fn live_tree(&mut self) -> (Value, Frame) {
        let glyphs = self.glyphs.clone();
        let frame = self
            .cx
            .update_window(self.window, |_, window, _| Frame::read(window, &glyphs))
            .expect("the replica's window is open");
        let mut snapshot = self
            .cx
            .update_window(self.window, |_, window, _| from_observed(window))
            .expect("the replica's window is open");
        for run in frame.runs.iter().filter(|r| r.visible) {
            add_text(&mut snapshot.tree, run.text.clone(), run.bounds);
        }
        let mut json = snapshot.to_json();
        // The status item's menu under the count (#1462): a line per session, as the real app's status item lists them.
        json["menu_bar"]["items"] = json!(deep_app::record::with_view(|view| {
            deep_app::states::menu(&view.table(), deep_app::views::now())
        })
        .unwrap_or_default());
        // #1458: each string drawn with its size and face, and where each shipped view was laid out.
        json["runs"] = frame
            .runs
            .iter()
            .filter(|r| r.visible)
            .map(|r| json!({"text": r.text, "bounds": r.bounds, "size": r.size, "face": r.face, "cut": r.cut, "weight": r.weight}))
            .collect();
        let scale = frame.scale;
        let device = |v: gpui_kit::Pixels| (f32::from(v) * scale).round() as i64;
        json["views"] = deep_app::views::drawn_views()
            .into_iter()
            .map(|(name, b)| {
                let bounds = [b.origin.x, b.origin.y, b.size.width, b.size.height].map(device);
                json!({"name": name, "bounds": bounds})
            })
            .collect();
        (json, frame)
    }

    /// `menus` (#1462): the menu bar the app set, as it sets it on the real app, in order, separators left out, each
    /// item with its key as the macOS menu bar draws it, in the table's form.
    fn menus(&mut self) -> Value {
        fn items(list: &[OwnedMenuItem], cx: &App) -> Vec<Value> {
            list.iter()
                .filter_map(|item| match item {
                    OwnedMenuItem::Separator => None,
                    OwnedMenuItem::Submenu(menu) => Some(json!({
                        "name": menu.name.to_string(), "key": null, "enabled": !menu.disabled,
                        "items": items(&menu.items, cx),
                    })),
                    OwnedMenuItem::SystemMenu(menu) => {
                        Some(json!({"name": menu.name.to_string(), "key": null, "enabled": true}))
                    }
                    OwnedMenuItem::Action {
                        name,
                        action,
                        disabled,
                        ..
                    } => Some(json!({
                        "name": name, "key": deep_app::actions::menu_key(action.as_ref(), cx),
                        "enabled": !disabled,
                    })),
                })
                .collect()
        }
        let menus: Vec<Value> = self.cx.update(|cx| {
            cx.get_menus()
                .unwrap_or_default()
                .iter()
                .map(|menu| json!({"name": menu.name.to_string(), "items": items(&menu.items, cx)}))
                .collect()
        });
        json!({"menus": menus})
    }

    /// The menu bar as `see` gives it (#1461): each menu's title and its items', in order, separators left out.
    fn see_menus(&mut self) -> Vec<Value> {
        self.cx.update(|cx| {
            cx.get_menus()
                .unwrap_or_default()
                .iter()
                .map(|menu| {
                    let items: Vec<Value> = menu
                        .items
                        .iter()
                        .filter_map(|item| match item {
                            OwnedMenuItem::Action { name, disabled, .. } => {
                                Some(json!({"title": name, "enabled": !disabled}))
                            }
                            OwnedMenuItem::Submenu(sub) => Some(
                                json!({"title": sub.name.to_string(), "enabled": !sub.disabled}),
                            ),
                            _ => None,
                        })
                        .collect();
                    json!({"title": menu.name.to_string(), "items": items})
                })
                .collect()
        })
    }

    fn see(&mut self, call: &Value) -> Result<Value, Fail> {
        let see = &call["see"];
        let include: Vec<&str> = match see["include"].as_array() {
            Some(list) => list.iter().filter_map(Value::as_str).collect(),
            None => vec!["roles", "names", "values", "bounds", "items"],
        };
        let (mut snapshot, frame) = self.tree();
        let scope = see["scope"].as_str().unwrap_or("window");
        let root = match scope {
            "window" => None,
            "panel" => Some(json!({
                "role": "pane", "name": null, "value": null, "id": null,
                "bounds": panel_bounds(frame.scale)?,
            })),
            "locator" => match frame.one(&call["locator"]) {
                Ok(t) => Some(json!({
                    "role": t.role, "name": t.name, "value": t.value,
                    "id": crate::snapshot::author_id(&t.path), "bounds": t.bounds,
                })),
                Err(Miss::Bad(why)) => return Err(fail("refused", why)),
                Err(Miss::None) => {
                    return Err(fail(
                        "locate.none",
                        format!("nothing matches {}", call["locator"]),
                    ))
                }
                Err(Miss::Ambiguous(all)) => return Err(ambiguous(&call["locator"], all)),
            },
            other => {
                return Err(fail(
                    "refused",
                    format!("see.scope is window, panel or locator, not {other:?}"),
                ))
            }
        };
        if let Some(mut root) = root {
            let bounds = bounds_of(&root["bounds"]);
            let mut inside = Vec::new();
            collect_inside(&snapshot["tree"], bounds, &mut inside);
            // The located node is the root: what it holds stays, under the root (#1460).
            let inside: Vec<Value> = inside
                .into_iter()
                .flat_map(|n| {
                    if n["role"] == root["role"]
                        && n["name"] == root["name"]
                        && n["bounds"] == root["bounds"]
                    {
                        n["children"].as_array().cloned().unwrap_or_default()
                    } else {
                        vec![n]
                    }
                })
                .collect();
            root["children"] = Value::Array(inside);
            snapshot["tree"] = root;
        }
        if !include.contains(&"items") {
            snapshot["items"] = json!([]);
        }
        keep(&mut snapshot["tree"], &include);
        let hash = sha256(snapshot.to_string().as_bytes());
        // The list's rows the window draws (#1463), in its order, and the record position they were built at: what
        // deep status --json holds at that log_pos.
        let (log_pos, rows) = deep_app::record::with_view(|view| {
            let rows: Vec<Value> = view
                .table()
                .list()
                .into_iter()
                .map(|row| {
                    let mut row = row.clone();
                    if let Some(fields) = row.as_object_mut() {
                        fields.remove("listed");
                        fields.remove("order");
                    }
                    row
                })
                .collect();
            (view.log_pos, rows)
        })
        .unwrap_or_default();
        // The address the window shows (#1460), beside the snapshot so stored snapshots keep their bytes.
        let address = self
            .cx
            .update(|cx| deep_app::open::current(cx).map(|address| address.to_string()));
        // What the app sent its hub since launch, which the replica's copy of the hub took (#1462), and the menu bar
        // as the app set it (#1461).
        let hub = self.hub_copy.calls();
        let menus = self.see_menus();
        Ok(
            json!({"snapshot": snapshot, "sha256": hash, "rows": rows, "log_pos": log_pos, "address": address, "hub": hub, "menus": menus,
                "notifications": {"setting": self.notifier.reach(false).setting.name()}}),
        )
    }

    /// `hub`: how the hub the app reads answers from now on, `answering`, `stopped` or `slow` (#1461); then a frame.
    fn hub(&mut self, call: &Value) -> Result<Value, Fail> {
        let state = call["hub"]["state"].as_str().unwrap_or_default();
        if !["answering", "stopped", "slow"].contains(&state) {
            return Err(fail(
                "refused",
                format!("hub.state is answering, stopped or slow, not {state:?}"),
            ));
        }
        self.hub_state = state.to_owned();
        deep_app::record::set_local_hub(match state {
            "stopped" => deep_app::record::LocalHub::Stops,
            "slow" => deep_app::record::LocalHub::Slow,
            _ => deep_app::record::LocalHub::Answers,
        });
        self.tick();
        Ok(json!({"hub": state}))
    }

    /// The app's watch of the hub at `now`, as its tick reads it: a slow hub's reads neither answer nor fail.
    fn watch_hub(&mut self, now: u64) {
        if self.hub_state == "slow" {
            return;
        }
        let answering = self.hub_state == "answering";
        self.watch.tick(now, || answering);
        let reach = deep_app::notify::Reach {
            hub_down: self.watch.down(),
            since: self.watch.since(),
            ..deep_app::notify::reach()
        };
        if reach != deep_app::notify::reach() {
            deep_app::notify::publish(reach);
        }
    }

    /// The window's snapshot, written once under `trace/` by its hash: an action's before and after.
    fn snapshot_file(&mut self) -> Value {
        let (snapshot, _) = self.tree();
        let bytes = snapshot.to_string();
        let hash = sha256(bytes.as_bytes());
        let path = self.out.join("trace").join(format!("{hash}.json"));
        if !path.exists() {
            let _ = std::fs::create_dir_all(self.out.join("trace"));
            let _ = std::fs::write(&path, bytes);
        }
        json!(hash)
    }

    // ---- Pixels.

    /// The window's pixels now, with every match of the mask locators filled with the look's ink, or blurred.
    fn pixels(&mut self, mask: &[Value], blur: bool) -> Result<(RgbaImage, Vec<[i64; 4]>), Fail> {
        self.draw();
        let mut image = self.cx.capture_screenshot(self.window).map_err(|e| {
            fail(
                "blocked",
                format!("offscreen rendering isn't available: {e}"),
            )
        })?;
        let boxes = bounds_of_all(&self.frame(), mask)?;
        for b in &boxes {
            if blur {
                blur_box(&mut image, *b);
            } else {
                fill(&mut image, *b, ink());
            }
        }
        Ok((image, boxes))
    }

    fn screenshot(&mut self, args: &Value) -> Result<Value, Fail> {
        let mask: Vec<Value> = args["mask"].as_array().cloned().unwrap_or_default();
        let (image, _) = self.pixels(&mask, false)?;
        let frame = self.frame();
        let crop = match args["target"].as_str().unwrap_or("window") {
            "window" => [0, 0, image.width() as i64, image.height() as i64],
            "panel" => panel_bounds(frame.scale)?,
            "locator" => match frame.one(&args["locator"]) {
                Ok(t) => t.bounds,
                Err(Miss::Bad(why)) => return Err(fail("refused", why)),
                Err(Miss::None) => {
                    return Err(fail(
                        "locate.none",
                        "the screenshot's locator matches nothing",
                    ))
                }
                Err(Miss::Ambiguous(all)) => return Err(ambiguous(&args["locator"], all)),
            },
            other => {
                return Err(fail(
                    "refused",
                    format!("screenshot.target is window, panel or locator, not {other:?}"),
                ))
            }
        };
        let highlight = args["highlight"].as_array().cloned().unwrap_or_default();
        let highlights = bounds_of_all(&frame, &highlight)?;
        let shot = with_strips(&image, crop, &highlights, (STRIP_PT * frame.scale) as u32);
        self.shots += 1;
        let path = self
            .out
            .join("screens")
            .join(format!("{:04}.png", self.shots));
        let hash = write_png(&path, &shot)?;
        self.evidence.push(json!({"slot": format!("screenshot {}", self.shots), "state": "captured", "sha256": hash}));
        Ok(json!({"sha256": hash, "path": path, "w": shot.width(), "h": shot.height()}))
    }

    fn record(&mut self, args: &Value) -> Result<Value, Fail> {
        match (args["action"].as_str(), self.recording.is_some()) {
            (Some("start"), true) => Err(fail("refused", "this replica is already recording")),
            (Some("start"), false) => {
                let fps = args["fps"].as_u64().unwrap_or(30);
                if !(1..=60).contains(&fps) || 60 % fps != 0 {
                    return Err(fail(
                        "refused",
                        format!("record.fps divides 60, the replica's frame rate; not {fps}"),
                    ));
                }
                let blur = match args["mask_kind"].as_str() {
                    None | Some("fill") => false,
                    Some("blur") => true,
                    Some(other) => {
                        return Err(fail(
                            "refused",
                            format!("record.mask_kind is fill or blur, not {other:?}"),
                        ))
                    }
                };
                self.recordings += 1;
                self.recording = Some(Recording {
                    start: self.clock.t,
                    every: FLICKS / fps,
                    taken: 0,
                    mask: args["mask"].as_array().cloned().unwrap_or_default(),
                    blur,
                    dir: self.out.join(format!("recording-{}", self.recordings)),
                    frames: Vec::new(),
                    actions: Vec::new(),
                });
                self.take_frames();
                Ok(json!({}))
            }
            (Some("stop"), false) => Err(fail("refused", "this replica isn't recording")),
            (Some("stop"), true) => {
                let recording = self.recording.take().expect("recording");
                // The video plays the frames at the recording's rate, as an animated PNG built from the frames'
                // own compressed pixels; the actions list stays beside it.
                let paths: Vec<PathBuf> = recording
                    .frames
                    .iter()
                    .filter_map(|f| f["path"].as_str().map(PathBuf::from))
                    .collect();
                let fps = (FLICKS / recording.every) as u16;
                let path = recording.dir.join("video.png");
                let bytes = animated_png(&paths, fps)
                    .map_err(|e| fail("blocked", format!("the recording's video: {e}")))?;
                std::fs::write(&path, &bytes)
                    .map_err(|e| fail("blocked", format!("{}: {e}", path.display())))?;
                let hash = sha256(&bytes);
                self.evidence.push(json!({"slot": format!("recording {}", self.recordings), "state": "captured", "sha256": hash}));
                Ok(
                    json!({"sha256": hash, "path": path, "fill": ink(), "frames": recording.frames, "actions": recording.actions}),
                )
            }
            (other, _) => Err(fail(
                "refused",
                format!("record.action is start or stop, not {other:?}"),
            )),
        }
    }

    /// While recording, the frames due by now: one at each `every` flicks since the start, masked as it is taken.
    fn take_frames(&mut self) {
        let Some(due) = self
            .recording
            .as_ref()
            .map(|r| (self.clock.t - r.start) / r.every + 1)
        else {
            return;
        };
        let (mask, blur, taken) = {
            let r = self.recording.as_ref().expect("recording");
            (r.mask.clone(), r.blur, r.taken)
        };
        if taken >= due {
            return;
        }
        let Ok((image, boxes)) = self.pixels(&mask, blur) else {
            return;
        };
        let recording = self.recording.as_mut().expect("recording");
        for index in recording.taken..due {
            let path = recording.dir.join(format!("frame-{index:05}.png"));
            let Ok(hash) = write_png(&path, &image) else {
                return;
            };
            recording.frames.push(
                json!({"t": index * recording.every, "sha256": hash, "path": path, "masks": boxes}),
            );
        }
        recording.taken = due;
    }

    fn close(&mut self) -> Value {
        deep_app::hub::set_local(None);
        if self.recording.is_some() {
            let _ = self.record(&json!({"action": "stop"}));
        }
        // A failed assertion or a call that errored fails the journey; one with no assertion ran nothing.
        let outcome = if !self.failures.is_empty() {
            "failed"
        } else if self.assertions == 0 {
            "ran_nothing"
        } else {
            "passed"
        };
        let trace = json!({
            "format": "deep_drive.trace@1", "replica": self.id, "calls": self.trace, "notifications": self.notified,
            "hub": self.hub_copy.calls(), "permission_requests": self.permission_requests,
        });
        let path = self.out.join("trace.json");
        let bytes = trace.to_string();
        let hash = sha256(bytes.as_bytes());
        let _ = std::fs::write(&path, bytes);
        let mut evidence = self.evidence.clone();
        evidence.push(json!({"slot": "trace", "state": "captured", "sha256": hash}));
        let mut closed = json!({
            "journey": {
                "outcome": outcome, "tests_run": self.assertions, "failures": self.failures, "steps": self.steps,
                "evidence": evidence,
            },
            "trace": {"sha256": hash, "path": path},
        });
        if let Some(dirty) = &self.dirty {
            closed["frames"] = dirty.report();
        }
        closed
    }
}

/// ⌘K's recency list in a replica (#366): it starts empty, and never reads the live app's; only the planted ranker does.
fn recency(plant: Option<Plant>) -> Vec<String> {
    if plant == Some(Plant::RanksByLiveRecency) {
        deep_app::commands::read_recency(&deep_app::commands::recency_file())
    } else {
        Vec::new()
    }
}

/// What opening a ⌘K entry does in a replica (#366): a page mounts its view's panel in the extension slot, given the
/// page as `props.page`; a command runs on the replica's copy of the hub (#1462).
fn opener(plant: Option<Plant>) -> deep_app::commands::Open {
    // Each page's runtime lives as long as ⌘K does, as the panel's does.
    let runtimes = RefCell::new(Vec::new());
    Rc::new(move |entry, window, cx| {
        if let deep_app::commands::Entry::Preference { name, .. } = entry {
            deep_app::words::open_preference(name, window, cx);
            return None;
        }
        // A command runs as the app runs it, on the replica's copy of the hub (#1462).
        if let deep_app::commands::Entry::Command { name, action } = entry {
            deep_app::installed::run_command(name, action, cx);
            return None;
        }
        let (Some(mut page), deep_app::commands::Entry::Page { panel, .. }) =
            (entry.page_props(), entry)
        else {
            return None;
        };
        if plant == Some(Plant::PageDropsParam) {
            page["params"] = json!({});
        }
        let mounted = deep_app::new_runtime().and_then(|runtime| {
            let view = deep_app::mount_page(&runtime, panel, &page, window, cx)?;
            runtimes.borrow_mut().push(runtime);
            Ok(view)
        });
        match mounted {
            Ok(view) => Some(view.into()),
            Err(e) => {
                eprintln!("deep-drive: {} didn't open: {e:#}", entry.name());
                None
            }
        }
    })
}

/// The panel's bounds in the window, in device pixels at `scale`.
fn panel_bounds(scale: f32) -> Result<[i64; 4], Fail> {
    let slot = deep_app::views::slot_bounds()
        .ok_or_else(|| fail("refused", "this replica has no panel"))?;
    let d = |v: Pixels| (f32::from(v) * scale).round() as i64;
    Ok([
        d(slot.origin.x),
        d(slot.origin.y),
        d(slot.size.width),
        d(slot.size.height),
    ])
}

/// The bounds of every match of each locator, in order.
fn bounds_of_all(frame: &Frame, locators: &[Value]) -> Result<Vec<[i64; 4]>, Fail> {
    let mut boxes = Vec::new();
    for locator in locators {
        let found = frame.all(locator).map_err(|why| fail("refused", why))?;
        boxes.extend(found.into_iter().map(|t| t.bounds));
    }
    Ok(boxes)
}

fn ambiguous(locator: &Value, all: Vec<Target>) -> Fail {
    fail(
        "locate.ambiguous",
        format!(
            "{locator} matches {} things; a locator names exactly one",
            all.len()
        ),
    )
    .with(
        "matches",
        Value::Array(all.iter().map(Target::summary).collect()),
    )
}

/// What a target reads as: a drawn string's text, or the text drawn inside it, or its name.
fn text_of(frame: &Frame, target: &Target) -> String {
    target.text.clone().unwrap_or_else(|| {
        let inside = frame.text_inside(target.bounds);
        if inside.is_empty() {
            target.name.clone().unwrap_or_default()
        } else {
            inside
        }
    })
}

/// A control's value: its accessibility value, or the text drawn inside it.
fn value_of(frame: &Frame, target: &Target) -> String {
    target
        .value
        .clone()
        .unwrap_or_else(|| frame.text_inside(target.bounds))
}

/// The word `state` names, if the target is in it; else the state it is in.
fn state_of(target: &Target, state: &str) -> String {
    let holds = match state {
        "enabled" => Some(target.enabled),
        "disabled" => Some(!target.enabled),
        "visible" => Some(target.visible),
        "hidden" => Some(!target.visible),
        "checked" => target.checked,
        "unchecked" => target.checked.map(|c| !c),
        _ => None,
    };
    match holds {
        Some(true) => state.to_owned(),
        Some(false) => match state {
            "enabled" => "disabled",
            "disabled" => "enabled",
            "visible" => "hidden",
            "hidden" => "visible",
            "checked" => "unchecked",
            _ => "checked",
        }
        .to_owned(),
        None => format!("unknown: a replica reads enabled, disabled, visible, hidden, checked and unchecked, not {state:?}"),
    }
}

/// A drawn string goes under the deepest node holding it, unless that node already names it.
fn add_text(node: &mut Node, text: String, bounds: [i64; 4]) {
    if node.name.as_deref() == Some(text.as_str()) {
        return;
    }
    // A run's ink may spill a device pixel past the box that lays it out, as an antialiased "A" does at its left
    // edge; it is still that box's text (#1459). The outside_frame audit keeps the strict test.
    let [x, y, w, h] = bounds;
    let ink = [x + 1, y + 1, (w - 2).max(0), (h - 2).max(0)];
    match node
        .children
        .iter_mut()
        .find(|child| contains(child.bounds, ink))
    {
        Some(child) => add_text(child, text, bounds),
        None => node.children.push(Node {
            role: "text_run".into(),
            name: Some(text),
            value: None,
            id: None,
            bounds,
            children: Vec::new(),
        }),
    }
}

fn bounds_of(value: &Value) -> [i64; 4] {
    let n = |i: usize| value[i].as_i64().unwrap_or(0);
    [n(0), n(1), n(2), n(3)]
}

/// The topmost nodes of `node` whose bounds lie inside `bounds`.
fn collect_inside(node: &Value, bounds: [i64; 4], into: &mut Vec<Value>) {
    for child in node["children"].as_array().into_iter().flatten() {
        if contains(bounds, bounds_of(&child["bounds"])) {
            into.push(child.clone());
        } else {
            collect_inside(child, bounds, into);
        }
    }
}

/// Leaves out the fields `include` doesn't name; the role and the id always stay.
fn keep(node: &mut Value, include: &[&str]) {
    let Some(fields) = node.as_object_mut() else {
        return;
    };
    for (field, word) in [("name", "names"), ("value", "values"), ("bounds", "bounds")] {
        if !include.contains(&word) {
            fields.remove(field);
        }
    }
    for child in fields
        .get_mut("children")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        keep(child, include);
    }
}

/// The look's ink role, opaque: what a mask fills with.
fn ink() -> [u8; 4] {
    let ink = deep_app::brand::INK;
    [(ink >> 16) as u8, (ink >> 8) as u8, ink as u8, 0xFF]
}

fn clip(image: &RgbaImage, b: [i64; 4]) -> (u32, u32, u32, u32) {
    let (w, h) = (image.width() as i64, image.height() as i64);
    let x0 = b[0].clamp(0, w) as u32;
    let y0 = b[1].clamp(0, h) as u32;
    let x1 = (b[0] + b[2]).clamp(0, w) as u32;
    let y1 = (b[1] + b[3]).clamp(0, h) as u32;
    (x0, y0, x1, y1)
}

fn fill(image: &mut RgbaImage, b: [i64; 4], color: [u8; 4]) {
    let (x0, y0, x1, y1) = clip(image, b);
    for y in y0..y1 {
        for x in x0..x1 {
            image.put_pixel(x, y, image::Rgba(color));
        }
    }
}

/// Blurs a box past reading: each 16-pixel block becomes its average.
fn blur_box(image: &mut RgbaImage, b: [i64; 4]) {
    let (x0, y0, x1, y1) = clip(image, b);
    for by in (y0..y1).step_by(16) {
        for bx in (x0..x1).step_by(16) {
            let (ex, ey) = ((bx + 16).min(x1), (by + 16).min(y1));
            let mut sum = [0u64; 4];
            for y in by..ey {
                for x in bx..ex {
                    let p = image.get_pixel(x, y).0;
                    (0..4).for_each(|i| sum[i] += p[i] as u64);
                }
            }
            let n = ((ex - bx) * (ey - by)).max(1) as u64;
            let mean = [0, 1, 2, 3].map(|i| (sum[i] / n) as u8);
            fill(
                image,
                [bx as i64, by as i64, (ex - bx) as i64, (ey - by) as i64],
                mean,
            );
        }
    }
}

/// `crop` of the image, with a strip right of it and one below it marking each highlight's rows and columns, so
/// nothing inside the frame is drawn over.
fn with_strips(
    image: &RgbaImage,
    crop: [i64; 4],
    highlights: &[[i64; 4]],
    strip: u32,
) -> RgbaImage {
    let (x0, y0, x1, y1) = clip(image, crop);
    let (w, h) = (x1 - x0, y1 - y0);
    let strip = if highlights.is_empty() { 0 } else { strip };
    let mut out = RgbaImage::from_pixel(w + strip, h + strip, image::Rgba([0, 0, 0, 0]));
    for y in 0..h {
        for x in 0..w {
            out.put_pixel(x, y, *image.get_pixel(x0 + x, y0 + y));
        }
    }
    for b in highlights {
        let (hx, hy) = (b[0] - x0 as i64, b[1] - y0 as i64);
        fill(&mut out, [hx, h as i64, b[2], strip as i64], HIGHLIGHT);
        fill(&mut out, [w as i64, hy, strip as i64, b[3]], HIGHLIGHT);
    }
    out
}

fn write_png(path: &Path, image: &RgbaImage) -> Result<String, Fail> {
    use image::ImageEncoder as _;
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(
            image.as_raw(),
            image.width(),
            image.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| fail("blocked", format!("PNG: {e}")))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| fail("blocked", format!("{}: {e}", dir.display())))?;
    }
    std::fs::write(path, &bytes)
        .map_err(|e| fail("blocked", format!("{}: {e}", path.display())))?;
    Ok(sha256(&bytes))
}

/// Your record's whole log, read as the app reads it, page by page, redacted; the connection closes when this returns.
fn copy_record(socket: &Path, token: &str) -> Result<Vec<Value>, String> {
    const PAGE: usize = 1000;
    let mut client = deep_app::hub::HubClient::connect(socket).map_err(|e| format!("{e:?}"))?;
    client.hello_app(token).map_err(|e| format!("{e:?}"))?;
    let (mut events, mut after) = (Vec::new(), 0);
    loop {
        let page = client
            .call("events.read", json!({"after": after, "limit": PAGE}))
            .map_err(|e| format!("{e:?}"))?;
        let read = page["events"].as_array().cloned().unwrap_or_default();
        let full = read.len() == PAGE;
        events.extend(read.into_iter().map(redact));
        after = page["log_pos"].as_u64().unwrap_or(after);
        if !full {
            return Ok(events);
        }
    }
}

/// An animated PNG of `frames`, PNG files of one size and colour type, each shown for 1/`fps` s: the first frame's
/// header, then each frame's image data under its frame control, so nothing is compressed twice.
fn animated_png(frames: &[PathBuf], fps: u16) -> Result<Vec<u8>, String> {
    /// A PNG's chunks, each its type and its data.
    type Chunks<'a> = Vec<(&'a [u8], &'a [u8])>;
    fn chunks(png: &[u8]) -> Result<Chunks<'_>, String> {
        let mut out = Vec::new();
        let mut at = 8;
        while at + 12 <= png.len() {
            let len = u32::from_be_bytes(png[at..at + 4].try_into().expect("4 bytes")) as usize;
            let end = at + 12 + len;
            if end > png.len() {
                return Err("a frame's PNG is cut short".into());
            }
            out.push((&png[at + 4..at + 8], &png[at + 8..at + 8 + len]));
            at = end;
        }
        Ok(out)
    }
    fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut crc = crc32fast::Hasher::new();
        crc.update(kind);
        crc.update(data);
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&crc.finalize().to_be_bytes());
    }
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut sequence = 0u32;
    for (index, path) in frames.iter().enumerate() {
        let png = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let parts = chunks(&png)?;
        let header = parts
            .iter()
            .find(|(kind, _)| *kind == b"IHDR")
            .ok_or("a frame has no header")?
            .1;
        if index == 0 {
            chunk(&mut out, b"IHDR", header);
            let mut control = (frames.len() as u32).to_be_bytes().to_vec();
            control.extend_from_slice(&0u32.to_be_bytes());
            chunk(&mut out, b"acTL", &control);
        }
        let mut control = sequence.to_be_bytes().to_vec();
        control.extend_from_slice(&header[..8]);
        control.extend_from_slice(&[0; 8]);
        control.extend_from_slice(&1u16.to_be_bytes());
        control.extend_from_slice(&fps.to_be_bytes());
        control.extend_from_slice(&[0, 0]);
        chunk(&mut out, b"fcTL", &control);
        sequence += 1;
        for (_, data) in parts.iter().filter(|(kind, _)| *kind == b"IDAT") {
            if index == 0 {
                chunk(&mut out, b"IDAT", data);
            } else {
                let mut frame = sequence.to_be_bytes().to_vec();
                frame.extend_from_slice(data);
                chunk(&mut out, b"fdAT", &frame);
                sequence += 1;
            }
        }
    }
    chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

/// A copy of your record with what reads as a secret taken out: values under secret-sounding keys, and strings
/// shaped like keys and tokens.
fn redact(value: Value) -> Value {
    const KEYS: &[&str] = &[
        "token",
        "secret",
        "password",
        "credential",
        "authorization",
        "cookie",
        "api_key",
        "private_key",
    ];
    const SHAPES: &[&str] = &[
        "sk-",
        "ghp_",
        "gho_",
        "github_pat_",
        "xoxb-",
        "xoxp-",
        "AKIA",
        "-----BEGIN",
    ];
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .into_iter()
                .map(|(key, v)| {
                    let lower = key.to_ascii_lowercase();
                    if KEYS.iter().any(|k| lower.contains(k)) && !v.is_null() {
                        (key, json!("[redacted]"))
                    } else {
                        (key, redact(v))
                    }
                })
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.into_iter().map(redact).collect()),
        Value::String(s) if SHAPES.iter().any(|shape| s.contains(shape)) => json!("[redacted]"),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use image::{AnimationDecoder as _, RgbaImage};

    use super::{animated_png, write_png};

    #[test]
    fn a_recording_plays_its_frames_in_order_at_its_rate() {
        let dir = std::env::temp_dir().join(format!("deep-drive-apng-{}", std::process::id()));
        let frames: Vec<PathBuf> = [[255, 0, 0, 255], [0, 0, 255, 255]]
            .iter()
            .enumerate()
            .map(|(i, color)| {
                let path = dir.join(format!("{i}.png"));
                write_png(&path, &RgbaImage::from_pixel(3, 2, image::Rgba(*color))).ok();
                path
            })
            .collect();
        let bytes = animated_png(&frames, 30).expect("the frames assemble");
        let decoder = image::codecs::png::PngDecoder::new(std::io::Cursor::new(bytes))
            .and_then(|d| d.apng())
            .expect("an animated PNG");
        let played: Vec<_> = decoder
            .into_frames()
            .collect_frames()
            .expect("its frames decode");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(played.len(), 2);
        assert_eq!(played[0].buffer().get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(played[1].buffer().get_pixel(2, 1).0, [0, 0, 255, 255]);
        let (ms, per) = played[1].delay().numer_denom_ms();
        assert_eq!(
            ms * 30,
            per * 1000,
            "each frame shows for a 30th of a second"
        );
    }
}
