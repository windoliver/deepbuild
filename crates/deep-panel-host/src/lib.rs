//! Issue #358: the panel host. It loads one agent-built panel under the empty policy plus DeepBuild's module and, per
//! invalidation, runs its script on this process's main thread (a gpui-shell VM is main-thread only) and writes the
//! element tree on stdout, one JSON object a line. It owns no screen and no authority: focus it sees move is only
//! reported, and undone unless the app grants the move.

use std::{
    cell::Cell,
    collections::VecDeque,
    hash::{DefaultHasher, Hash as _, Hasher as _},
    io::{BufRead as _, Write as _},
    path::Path,
    rc::Rc,
    sync::{atomic::Ordering, mpsc, Arc},
    time::{Duration, Instant},
};

use gpui_kit::{test::TestWindowExt as _, *};
use gpui_shell::ScriptView;
use serde_json::{json, Value};

/// What the host's window draws. Off, a render runs the script and builds the view's elements but lays out nothing,
/// which is all an update needs; on, the panel is really drawn, as a press and a focus move need it to be.
struct Root {
    view: Option<Entity<ScriptView>>,
    draw: bool,
    /// False until the first invalidation: GPUI draws once as a window opens, and a render no one asked for would put
    /// the script a render ahead of its trees.
    live: bool,
    /// Renders of the panel's script this root has made, whoever asked: a command, or the panel's own timer.
    renders: Rc<Cell<u64>>,
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.clone().filter(|_| self.live) else {
            return div().into_any_element();
        };
        self.renders.set(self.renders.get() + 1);
        if self.draw {
            return div().size_full().child(view).into_any_element();
        }
        drop(view.update(cx, |view, cx| view.render(window, cx).into_any_element()));
        div().into_any_element()
    }
}

struct Panel {
    cx: HeadlessAppContext,
    window: WindowHandle<Root>,
    view: Entity<ScriptView>,
    /// The runtime outlives the window, as the app's does.
    _runtime: std::rc::Rc<gpui_shell::ShellRuntime>,
    renders: Rc<Cell<u64>>,
    /// The renders already looked at, so a render nobody has hashed yet shows.
    seen: u64,
    /// The panel's id, from its manifest.
    id: String,
    /// The hash of the last render's tree.
    hash: Option<String>,
    /// Frame requests written, and those since the app's last invalidation.
    frames: u64,
    frames_since_invalidate: u64,
    /// The wrong program: a frame request after every render, changed or not.
    redraw_every_render: bool,
}

/// A tree's hash as hex: the same tree, the same text.
fn hash_of(tree: &str) -> String {
    let mut hasher = DefaultHasher::new();
    tree.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

impl Panel {
    fn open(dir: &Path, draw: bool, redraw_every_render: bool) -> Result<Self, String> {
        let id = std::fs::read_to_string(dir.join("gpui-shell.json"))
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok())
            .and_then(|manifest| manifest["id"].as_str().map(str::to_owned))
            .unwrap_or_default();
        let renders = Rc::new(Cell::new(0));
        let counted = renders.clone();
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(()),
            || Ok(None),
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        let runtime = deep_app::new_runtime().map_err(|error| error.to_string())?;
        let mut mounted = Err("the window never opened".to_owned());
        let options = WindowOptions {
            focus: false,
            show: false,
            ..Default::default()
        };
        // GPUI's own window: gpui-kit's would add its title bar's cost to every update.
        let window = cx
            .update(|cx| {
                cx.open_window(options, |window, cx| {
                    let view = deep_app::mount_panel(&runtime, dir, window, cx);
                    mounted = view
                        .as_ref()
                        .map(Clone::clone)
                        .map_err(|error| format!("{error:#}"));
                    cx.new(|_| Root {
                        view: view.ok(),
                        draw,
                        live: false,
                        renders: counted.clone(),
                    })
                })
            })
            .map_err(|error| error.to_string())?;
        Ok(Panel {
            cx,
            window,
            view: mounted?,
            _runtime: runtime,
            renders,
            seen: 0,
            id,
            hash: None,
            frames: 0,
            frames_since_invalidate: 0,
            redraw_every_render,
        })
    }

    /// The tree the script last built.
    fn tree(&mut self) -> Result<String, String> {
        let view = self.view.clone();
        self.cx.update(|cx| {
            let view = view.read(cx);
            match (view.build_error(), view.snapshot()) {
                (None, Some(snapshot)) => Ok(snapshot.debug_tree()),
                (error, _) => Err(error.unwrap_or("the script built nothing").to_owned()),
            }
        })
    }

    /// Renders the panel's own timer made since the last look: hashes the tree and asks for a frame only if it
    /// changed.
    fn look(&mut self) -> Result<Option<Value>, String> {
        let now = self.renders.get();
        if now == self.seen {
            return Ok(None);
        }
        self.seen = now;
        let tree = self.tree()?;
        let hash = hash_of(&tree);
        let changed = self.hash.as_ref() != Some(&hash);
        self.hash = Some(hash.clone());
        if !changed && !self.redraw_every_render {
            return Ok(None);
        }
        self.frames += 1;
        self.frames_since_invalidate += 1;
        Ok(Some(
            json!({ "frame": { "panel": self.id, "hash": hash, "tree": tree } }),
        ))
    }

    /// One invalidation: the script's one render, and its tree. Answers the tree and the nanoseconds the render took.
    fn update(&mut self) -> Result<(String, u64), String> {
        let view = self.view.clone();
        let started = Instant::now();
        self.cx
            .update_window(self.window.into(), |root, window, cx| {
                let root = root.downcast::<Root>().expect("the host's root is a Root");
                root.update(cx, |root, cx| {
                    root.live = true;
                    cx.notify();
                });
                view.update(cx, |view, cx| view.refresh(cx));
                window.render_frame(cx);
            })
            .map_err(|error| error.to_string())?;
        // Work the render deferred is the update's too.
        self.cx.run_until_parked();
        let nanos = started.elapsed().as_nanos() as u64;
        let tree = self.tree()?;
        Ok((tree, nanos))
    }

    /// Lets `elapsed` of real time pass on the host's clock. A repeating timer re-arms from the moment it fired, so one
    /// jump past its deadline makes every later tick late; short steps keep a 1 Hz timer to a second.
    fn pump(&mut self, elapsed: Duration) {
        const STEP: Duration = Duration::from_micros(250);
        let mut left = elapsed;
        while left > Duration::ZERO {
            let step = left.min(STEP);
            self.cx.advance_clock(step);
            self.cx.run_until_parked();
            left -= step;
        }
        if elapsed.is_zero() {
            self.cx.run_until_parked();
        }
    }

    fn focused(&mut self) -> Option<FocusHandle> {
        self.cx
            .update_window(self.window.into(), |_, window, cx| window.focused(cx))
            .unwrap_or(None)
    }

    fn blur(&mut self) {
        let _ = self
            .cx
            .update_window(self.window.into(), |_, window, cx| window.blur(cx));
    }

    fn press(&mut self, id: &str) -> Result<(), String> {
        let id = ElementId::Name(SharedString::from(id.to_owned()));
        self.cx
            .update_window(self.window.into(), |_, window, cx| {
                window.render_frame(cx);
                // A panel can take away what's being pressed; the click would panic on it.
                if window.try_find(id.clone()).is_none() {
                    return Err(format!("no element {id:?}"));
                }
                window.click(id, cx);
                window.render_frame(cx);
                Ok(())
            })
            .map_err(|error| error.to_string())??;
        self.cx.run_until_parked();
        Ok(())
    }
}

fn jit() -> Value {
    let metrics = rquickjs_jit::last_attached_metrics();
    json!({
        "nativeEnabled": metrics.as_ref().is_some_and(|metrics| metrics.native_enabled()),
        "installed": metrics.as_ref().map_or(0, |metrics| metrics.installed),
        "nativeEntries": metrics.as_ref().map_or(0, |metrics| metrics.native_entries),
    })
}

/// `run --panel DIR --renders N --out FILE`: the host alone, for the JIT's proof.
pub fn run(dir: &Path, renders: usize, out: &Path) -> Result<(), String> {
    let mut panel = Panel::open(dir, false, false)?;
    let mut times = Vec::with_capacity(renders);
    let mut tree = String::new();
    for _ in 0..renders {
        let (text, nanos) = panel.update()?;
        // The JIT compiles on its own thread and installs on this one.
        panel.pump(Duration::ZERO);
        times.push(nanos);
        tree = text;
    }
    let tree = deep_app::panel_tree::parse(&tree)?;
    let report = json!({ "pid": std::process::id(), "jit": jit(), "renderNs": times, "tree": tree.to_json(&[]) });
    std::fs::write(out, report.to_string()).map_err(|error| error.to_string())
}

fn say(value: &Value) {
    let mut stdout = std::io::stdout().lock();
    if writeln!(stdout, "{value}")
        .and_then(|()| stdout.flush())
        .is_err()
    {
        // The app is gone; a host has no one to work for.
        std::process::exit(0);
    }
}

/// `serve --panel DIR [--draw]`: takes one command a line on stdin until it closes.
pub fn serve(dir: &Path, draw: bool, planted: Option<&str>) -> Result<(), String> {
    let redraw = match planted {
        None => false,
        Some("redraw_every_render") => true,
        Some(other) => return Err(format!("no planted host {other}")),
    };
    let mut panel = Panel::open(dir, draw, redraw)?;
    let (commands, inbox) = mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if commands.send(line).is_err() {
                break;
            }
        }
    });
    say(&json!({ "ready": true, "pid": std::process::id() }));

    let tick = Duration::from_millis(2);
    let mut last = Instant::now();
    // The serial of the latest press the app told this host of: what a focus move is attributed to.
    let mut serial = Value::Null;
    let mut held = None;
    // Commands that arrived while this host waited on a verdict.
    let mut pending = VecDeque::new();
    loop {
        let next = pending
            .pop_front()
            .map_or_else(|| inbox.recv_timeout(tick), Ok);
        match next {
            Ok(line) => {
                let command: Value =
                    serde_json::from_str(&line).map_err(|error| error.to_string())?;
                match command["cmd"].as_str().unwrap_or_default() {
                    "invalidate" => match panel.update() {
                        Ok((tree, nanos)) => {
                            // The app asked for this draw: it is the baseline later renders are compared with.
                            let hash = hash_of(&tree);
                            panel.hash = Some(hash.clone());
                            panel.seen = panel.renders.get();
                            panel.frames_since_invalidate = 0;
                            say(&json!({ "tree": tree, "scriptNs": nanos, "hash": hash }));
                        }
                        Err(error) => say(&json!({ "error": error })),
                    },
                    "stats" => say(&json!({
                        "panel": panel.id,
                        "renders": panel.renders.get(),
                        "frames": panel.frames,
                        "hash": panel.hash,
                    })),
                    "verdict" => {
                        let max = command["max_frames"].as_u64().unwrap_or(0);
                        let frames = panel.frames_since_invalidate;
                        let fail = frames > max;
                        say(&json!({
                            "status": if fail { "FAIL" } else { "PASS" },
                            "panel": panel.id,
                            "frames": frames,
                            "reason": format!(
                                "panel {} drew {frames} frames since its last invalidation against {max} allowed",
                                panel.id
                            ),
                        }));
                    }
                    "rebuild" => {
                        deep_app::REBUILDS.fetch_add(1, Ordering::Relaxed);
                        match panel.update() {
                            Ok((tree, nanos)) => say(&json!({ "tree": tree, "scriptNs": nanos })),
                            Err(error) => say(&json!({ "error": error })),
                        }
                    }
                    "jit" => say(&jit()),
                    "press" => {
                        // Whatever was already going to move focus isn't this press's.
                        // What the pump itself takes is the next one's to count, or the host's clock runs slow.
                        let now = Instant::now();
                        panel.pump(now - last);
                        last = now;
                        held = report_move(&mut panel, &inbox, &mut pending, &serial, held)?;
                        serial = command["serial"].clone();
                        match panel.press(command["id"].as_str().unwrap_or_default()) {
                            Ok(()) => {
                                held =
                                    report_move(&mut panel, &inbox, &mut pending, &serial, held)?;
                                say(&json!({ "pressed": true }));
                            }
                            Err(error) => say(&json!({ "error": error })),
                        }
                    }
                    "blur" => {
                        panel.blur();
                        held = None;
                        say(&json!({ "blurred": true }));
                    }
                    other => say(&json!({ "error": format!("no command {other}") })),
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                // What the pump itself takes is the next one's to count, or the host's clock runs slow.
                let now = Instant::now();
                panel.pump(now - last);
                last = now;
                // A render the panel's own timer made: a frame only if the tree changed.
                if let Some(frame) = panel.look()? {
                    say(&frame);
                }
                held = report_move(&mut panel, &inbox, &mut pending, &serial, held)?;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

/// Focus that went somewhere new since the last look is a request: the app answers it, and a refusal is undone here.
/// Focus the panel let go of is only told. A command that crosses the request waits for the verdict.
fn report_move(
    panel: &mut Panel,
    inbox: &mpsc::Receiver<String>,
    pending: &mut VecDeque<String>,
    serial: &Value,
    held: Option<FocusHandle>,
) -> Result<Option<FocusHandle>, String> {
    let focused = panel.focused();
    if focused == held {
        return Ok(held);
    }
    if focused.is_none() {
        say(&json!({ "released": true }));
        return Ok(None);
    }
    say(&json!({ "move": { "serial": serial } }));
    loop {
        let line = inbox.recv().map_err(|error| error.to_string())?;
        let reply: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
        match reply["granted"].as_bool() {
            Some(true) => return Ok(focused),
            Some(false) => {
                panel.blur();
                return Ok(None);
            }
            None => pending.push_back(line),
        }
    }
}

/// The process's command line, shared by the host and its control.
pub fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|at| args.get(at + 1))
        .cloned()
}
