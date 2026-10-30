//! Issue #358: the panel host. It loads one agent-built panel under the empty policy plus DeepBuild's module and, per
//! invalidation, runs its script on this process's main thread (a gpui-shell VM is main-thread only) and writes the
//! element tree on stdout, one JSON object a line. It owns no screen and no authority: focus it sees move is only
//! reported, and undone unless the app grants the move.

use std::{
    io::{BufRead as _, Write as _},
    path::Path,
    sync::{mpsc, Arc},
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
}

impl Render for Root {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let Some(view) = self.view.clone().filter(|_| self.live) else {
            return div().into_any_element();
        };
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
}

impl Panel {
    fn open(dir: &Path, draw: bool) -> Result<Self, String> {
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
                    })
                })
            })
            .map_err(|error| error.to_string())?;
        Ok(Panel {
            cx,
            window,
            view: mounted?,
            _runtime: runtime,
        })
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
        let nanos = started.elapsed().as_nanos() as u64;
        let tree = self.cx.update(|cx| {
            let view = view.read(cx);
            match (view.build_error(), view.snapshot()) {
                (None, Some(snapshot)) => Ok(snapshot.debug_tree()),
                (error, _) => Err(error.unwrap_or("the script built nothing").to_owned()),
            }
        })?;
        Ok((tree, nanos))
    }

    fn pump(&mut self, elapsed: Duration) {
        self.cx.advance_clock(elapsed);
        self.cx.run_until_parked();
    }

    fn focused(&mut self) -> bool {
        self.cx
            .update_window(self.window.into(), |_, window, cx| {
                window.focused(cx).is_some()
            })
            .unwrap_or(false)
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
                window.click(id, cx);
                window.render_frame(cx);
            })
            .map_err(|error| error.to_string())?;
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
    let mut panel = Panel::open(dir, false)?;
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
pub fn serve(dir: &Path, draw: bool) -> Result<(), String> {
    let mut panel = Panel::open(dir, draw)?;
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
    let mut held = false;
    loop {
        match inbox.recv_timeout(tick) {
            Ok(line) => {
                let command: Value =
                    serde_json::from_str(&line).map_err(|error| error.to_string())?;
                match command["cmd"].as_str().unwrap_or_default() {
                    "invalidate" => match panel.update() {
                        Ok((tree, nanos)) => say(&json!({ "tree": tree, "scriptNs": nanos })),
                        Err(error) => say(&json!({ "error": error })),
                    },
                    "jit" => say(&jit()),
                    "press" => {
                        serial = command["serial"].clone();
                        match panel.press(command["id"].as_str().unwrap_or_default()) {
                            Ok(()) => held = report_move(&mut panel, &inbox, &serial, held)?,
                            Err(error) => say(&json!({ "error": error })),
                        }
                        say(&json!({ "pressed": true }));
                    }
                    "blur" => {
                        panel.blur();
                        held = false;
                        say(&json!({ "blurred": true }));
                    }
                    other => say(&json!({ "error": format!("no command {other}") })),
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                panel.pump(last.elapsed());
                last = Instant::now();
                held = report_move(&mut panel, &inbox, &serial, held)?;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

/// Focus the panel took since the last look is a request: the app answers it, and a refusal is undone here.
fn report_move(
    panel: &mut Panel,
    inbox: &mpsc::Receiver<String>,
    serial: &Value,
    held: bool,
) -> Result<bool, String> {
    let focused = panel.focused();
    if !focused || held {
        return Ok(focused);
    }
    say(&json!({ "move": { "serial": serial } }));
    let line = inbox.recv().map_err(|error| error.to_string())?;
    let verdict: Value = serde_json::from_str(&line).map_err(|error| error.to_string())?;
    if verdict["granted"] == true {
        return Ok(true);
    }
    panel.blur();
    Ok(false)
}

/// The process's command line, shared by the host and its control.
pub fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|at| args.get(at + 1))
        .cloned()
}
