//! Issue #358, behind the `panel-check` feature so the shipping app carries no test support: the app's side of an
//! agent-built panel. `panel-check` runs the panel in a panel host, lays out each tree it sends in a headless window,
//! with the question card up if asked, and fails a panel any of whose nodes leaves its area or touches the card.
//! `panel-bench` times an invalidation to a tree the app holds, across the process boundary.

use std::{
    cell::RefCell,
    io::{BufRead as _, BufReader, Write as _},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    rc::Rc,
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

use gpui_kit::{assets::Assets, test::TestWindowExt as _, *};
use serde_json::{json, Value};

use crate::panel_tree::{color, number, parse, Node};

type Rect = [f64; 4];

fn flag(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|arg| arg == name)
        .and_then(|at| args.get(at + 1))
        .cloned()
}

fn rect(text: &str) -> Result<Rect, String> {
    let parts: Vec<f64> = text
        .split(',')
        .filter_map(|part| part.parse().ok())
        .collect();
    <Rect>::try_from(parts).map_err(|_| format!("{text} isn't x,y,w,h"))
}

/// The panel host as a child process: nothing of the app's environment goes with it.
struct Host {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::Receiver<String>,
    pid: u32,
}

impl Host {
    fn start(path: &Path, panel: &Path, draw: bool) -> Result<Self, String> {
        let mut command = Command::new(path);
        command.env_clear().args(["serve", "--panel"]).arg(panel);
        if let Some(home) = std::env::var_os("HOME") {
            command.env("HOME", home);
        }
        if draw {
            command.arg("--draw");
        }
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|error| format!("the panel host didn't start: {error}"))?;
        let stdin = child.stdin.take().expect("piped");
        let stdout = child.stdout.take().expect("piped");
        let (send, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if send.send(line).is_err() {
                    break;
                }
            }
        });
        let pid = child.id();
        let mut host = Host {
            child,
            stdin,
            lines,
            pid,
        };
        let ready = host
            .next()
            .map_err(|_| "the panel host died before it was ready".to_owned())?;
        if ready["ready"] != true {
            return Err(format!("the panel host said {ready}"));
        }
        Ok(host)
    }

    fn send(&mut self, command: Value) -> Result<(), String> {
        writeln!(self.stdin, "{command}")
            .and_then(|()| self.stdin.flush())
            .map_err(|_| "host_gone".to_owned())
    }

    fn next(&mut self) -> Result<Value, String> {
        let line = self.lines.recv().map_err(|_| "host_gone".to_owned())?;
        serde_json::from_str(&line).map_err(|_| format!("the panel host wrote {line:?}"))
    }

    /// One invalidation: the tree's text and the host's nanoseconds, refusing any focus move on the way, since an
    /// update carries no serial.
    fn update(&mut self) -> Result<(String, u64), String> {
        self.send(json!({ "cmd": "invalidate" }))?;
        loop {
            let reply = self.next()?;
            if !reply["move"].is_null() {
                self.send(json!({ "granted": false }))?;
                continue;
            }
            return match (reply["tree"].as_str(), reply["scriptNs"].as_u64()) {
                (Some(tree), Some(nanos)) => Ok((tree.to_owned(), nanos)),
                _ => Err(format!("the panel failed: {}", reply["error"])),
            };
        }
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The app's window for one panel: its area, clipped, so nothing a panel draws reaches past it or onto the card.
struct Window358 {
    area: Rect,
    tree: Option<Node>,
    bounds: Rc<RefCell<Vec<Option<Rect>>>>,
}

impl Render for Window358 {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let [x, y, w, h] = self.area.map(|value| px(value as f32));
        let mut panel = div().absolute().left(x).top(y).w(w).h(h).overflow_hidden();
        if let Some(tree) = &self.tree {
            let mut slots = self.bounds.borrow_mut();
            slots.clear();
            slots.resize(tree.count(), None);
            drop(slots);
            panel = panel.child(element(tree, &self.bounds, &mut 0));
        }
        div().size_full().bg(rgb(0xffffff)).child(panel)
    }
}

/// A node as a native element, with a measure of its laid-out box.
fn element(node: &Node, bounds: &Rc<RefCell<Vec<Option<Rect>>>>, at: &mut usize) -> AnyElement {
    let index = *at;
    *at += 1;
    let mut el = match node.kind.as_str() {
        "v_flex" => div().flex().flex_col(),
        "h_flex" => div().flex().flex_row().items_center(),
        _ => div(),
    };
    for op in &node.ops {
        let value = number(&op.args).map(px);
        let shade = color(&op.args);
        el = match (op.name.as_str(), value, shade) {
            ("flex", ..) => el.flex(),
            ("flex_col", ..) => el.flex_col(),
            ("flex_row", ..) => el.flex_row(),
            ("items_center", ..) => el.items_center(),
            ("justify_center", ..) => el.justify_center(),
            ("justify_between", ..) => el.justify_between(),
            ("size_full", ..) => el.size_full(),
            ("absolute", ..) => el.absolute(),
            ("relative", ..) => el.relative(),
            ("text_sm", ..) => el.text_sm(),
            ("left", Some(v), _) => el.left(v),
            ("top", Some(v), _) => el.top(v),
            ("w", Some(v), _) => el.w(v),
            ("h", Some(v), _) => el.h(v),
            ("p", Some(v), _) => el.p(v),
            ("px", Some(v), _) => el.px(v),
            ("py", Some(v), _) => el.py(v),
            ("gap", Some(v), _) => el.gap(v),
            ("rounded", Some(v), _) => el.rounded(v),
            ("bg", _, Some(c)) => el.bg(rgb(c)),
            ("text_color", _, Some(c)) => el.text_color(rgb(c)),
            _ => el,
        };
    }
    if node.kind == "text" {
        el = el.child(node.label.clone().unwrap_or_default());
    }
    for child in &node.children {
        el = el.child(element(child, bounds, at));
    }
    let sink = bounds.clone();
    el.child(
        canvas(
            move |frame, _, _| {
                if let Some(slot) = sink.borrow_mut().get_mut(index) {
                    let origin = frame.origin;
                    let size = frame.size;
                    *slot = Some(
                        [origin.x, origin.y, size.width, size.height]
                            .map(|value| f64::from(f32::from(value))),
                    );
                }
            },
            |_, _, _, _| {},
        )
        // Pinned: with no inset, an absolute child sits after its earlier siblings.
        .absolute()
        .top_0()
        .left_0()
        .size_full(),
    )
    .into_any_element()
}

/// Everything a host may send that this app can draw. Behavior stays in the host; any other node or style, or a
/// style with arguments this can't read, is refused, since the layout this app measures wouldn't be the panel's.
fn unknown_element(node: &Node) -> Option<String> {
    const KINDS: [&str; 5] = ["div", "v_flex", "h_flex", "text", "Button"];
    const BARE: [&str; 10] = [
        "flex",
        "flex_col",
        "flex_row",
        "items_center",
        "justify_center",
        "justify_between",
        "size_full",
        "absolute",
        "relative",
        "text_sm",
    ];
    const SIZES: [&str; 9] = ["left", "top", "w", "h", "p", "px", "py", "gap", "rounded"];
    const COLORS: [&str; 2] = ["bg", "text_color"];
    if !KINDS.contains(&node.kind.as_str()) {
        return Some(node.kind.clone());
    }
    let drawable = |op: &&crate::panel_tree::Op| {
        let name = op.name.as_str();
        !op.style
            || BARE.contains(&name)
            || (SIZES.contains(&name) && number(&op.args).is_some())
            || (COLORS.contains(&name) && color(&op.args).is_some())
    };
    if let Some(op) = node.ops.iter().find(|op| !drawable(op)) {
        return Some(format!(".{}", op.name));
    }
    node.children.iter().find_map(unknown_element)
}

const EPSILON: f64 = 0.5;

fn inside([x, y, w, h]: Rect, [ax, ay, aw, ah]: Rect) -> bool {
    x >= ax - EPSILON
        && y >= ay - EPSILON
        && x + w <= ax + aw + EPSILON
        && y + h <= ay + ah + EPSILON
}

fn intersects([x, y, w, h]: Rect, [ax, ay, aw, ah]: Rect) -> bool {
    x < ax + aw - EPSILON && ax < x + w - EPSILON && y < ay + ah - EPSILON && ay < y + h - EPSILON
}

/// Each drawn node beyond the panel, or on the card.
fn violations(
    update: usize,
    bounds: &[Option<Rect>],
    area: Rect,
    card: Option<Rect>,
) -> Vec<Value> {
    let mut found = Vec::new();
    for rect in bounds
        .iter()
        .flatten()
        .filter(|rect| rect[2] > 0. && rect[3] > 0.)
    {
        if !inside(*rect, area) {
            found.push(json!({ "kind": "outside_panel", "update": update, "bounds": rect }));
        }
        if card.is_some_and(|card| intersects(*rect, card)) {
            found.push(json!({ "kind": "over_card", "update": update, "bounds": rect }));
        }
    }
    found
}

struct Check {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    root: Entity<Window358>,
    bounds: Rc<RefCell<Vec<Option<Rect>>>>,
    area: Rect,
    card: Option<Rect>,
    question: Option<String>,
}

impl Check {
    fn open(args: &[String]) -> Result<Self, String> {
        let area = rect(&flag(args, "--panel-area").ok_or("--panel-area x,y,w,h")?)?;
        let card = flag(args, "--card").map(|text| rect(&text)).transpose()?;
        let question = flag(args, "--question");
        let (w, h) = flag(args, "--window")
            .and_then(|size| {
                let (w, h) = size.split_once('x')?;
                Some((w.parse::<f32>().ok()?, h.parse::<f32>().ok()?))
            })
            .ok_or("--window WxH")?;
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(Assets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            crate::init(cx);
        });
        let bounds: Rc<RefCell<Vec<Option<Rect>>>> = Rc::default();
        let shared = bounds.clone();
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: size(px(w), px(h)),
            })),
            focus: false,
            show: false,
            ..Default::default()
        };
        // GPUI's own window: gpui-kit's wraps the root in its title bar, which would move the panel off its area.
        let opened = cx
            .update(|cx| {
                cx.open_window(options, |_, cx| {
                    cx.new(|_| Window358 {
                        area,
                        tree: None,
                        bounds: shared,
                    })
                })
            })
            .map_err(|error| error.to_string())?;
        let root = cx
            .update(|cx| opened.entity(cx))
            .map_err(|error| error.to_string())?;
        let window: AnyWindowHandle = opened.into();
        if let (Some(card), Some(question)) = (card, &question) {
            let [x, y, w, h] = card.map(|value| px(value as f32));
            let at = Bounds {
                origin: point(x, y),
                size: size(w, h),
            };
            cx.update_window(window, |_, window, cx| {
                crate::card::present(at, question, &["Yes", "No"], window, cx)
            })
            .map_err(|error| error.to_string())?;
        }
        Ok(Check {
            cx,
            window,
            root,
            bounds,
            area,
            card,
            question,
        })
    }

    /// Lays out a tree in the window, and answers each node's box.
    fn lay_out(&mut self, tree: Node) -> Result<Vec<Option<Rect>>, String> {
        let root = self.root.clone();
        self.cx.update(|cx| {
            root.update(cx, |root, cx| {
                root.tree = Some(tree);
                cx.notify();
            })
        });
        self.cx
            .update_window(self.window, |_, window, cx| window.render_frame(cx))
            .map_err(|error| error.to_string())?;
        Ok(self.bounds.borrow().clone())
    }

    fn png(&mut self, path: &str) -> Result<(), String> {
        let image = self
            .cx
            .capture_screenshot(self.window)
            .map_err(|error| error.to_string())?;
        image.save(path).map_err(|error| error.to_string())
    }
}

fn panel_args(args: &[String]) -> Result<(PathBuf, PathBuf), String> {
    if flag(args, "--origin").as_deref() != Some("agent_built") {
        return Err(
            "--origin agent_built: a panel of any other origin isn't run through this".into(),
        );
    }
    Ok((
        flag(args, "--host").ok_or("--host PATH")?.into(),
        flag(args, "--panel").ok_or("--panel DIR")?.into(),
    ))
}

/// `deep-app panel-check`: exits 0 on pass, 1 on fail, and 2 when it couldn't tell.
pub fn check(args: &[String]) -> i32 {
    match run_check(args) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("deep-app panel-check: {error}");
            2
        }
    }
}

fn run_check(args: &[String]) -> Result<i32, String> {
    let (host_path, panel) = panel_args(args)?;
    let out = flag(args, "--out").ok_or("--out FILE")?;
    let updates: usize = flag(args, "--updates")
        .and_then(|n| n.parse().ok())
        .ok_or("--updates N")?;
    let serving = args.iter().any(|arg| arg == "--serve");
    let png = flag(args, "--png");
    let mut check = Check::open(args)?;
    let app_pid = std::process::id();
    let card = check
        .question
        .clone()
        .map(|question| json!({ "question": question }));
    let write = |result: &str, host: Option<u32>, trees: &[Value], found: &[Value]| {
        let report = json!({
            "result": result, "origin": "agent_built", "runtime": "panel_host", "appPid": app_pid, "hostPid": host,
            "trees": trees, "violations": found, "card": card,
        });
        std::fs::write(&out, report.to_string()).map_err(|error| error.to_string())
    };

    // Refused before anything could fetch it: the host never starts.
    if let Some(dependency) = crate::fetched_dependency(&panel) {
        let found = [json!({ "kind": "git_dependency", "update": 0, "dependency": dependency })];
        write("fail", None, &[], &found)?;
        if let Some(png) = &png {
            check.png(png)?;
        }
        return Ok(1);
    }

    let mut host = Host::start(&host_path, &panel, serving)?;
    let mut trees = Vec::new();
    let mut found = Vec::new();
    for update in 0..updates {
        let (text, _) = host.update()?;
        let tree = parse(&text)?;
        if let Some(kind) = unknown_element(&tree) {
            found.push(json!({ "kind": "unknown_element", "update": update, "element": kind }));
            trees.push(tree.to_json(&[]));
            continue;
        }
        let bounds = check.lay_out(tree.clone())?;
        found.extend(violations(update, &bounds, check.area, check.card));
        trees.push(tree.to_json(&bounds));
    }
    let failed = !found.is_empty();
    write(
        if failed { "fail" } else { "pass" },
        Some(host.pid),
        &trees,
        &found,
    )?;
    if let Some(png) = &png {
        check.png(png)?;
    }
    if serving {
        return serve(check, host, app_pid);
    }
    Ok(i32::from(failed))
}

enum Event {
    Command(Value),
    HostLine(String),
    HostGone,
}

/// The check held open, on JSON lines. The app owns the gesture serials: it mints one per press, and grants a focus
/// move only on the newest serial, once.
fn serve(mut check: Check, mut host: Host, app_pid: u32) -> Result<i32, String> {
    let (events, inbox) = mpsc::channel();
    let commands = events.clone();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str(&line) {
                let _ = commands.send(Event::Command(value));
            }
        }
        std::process::exit(0);
    });
    let host_lines = std::mem::replace(&mut host.lines, mpsc::channel().1);
    std::thread::spawn(move || {
        while let Ok(line) = host_lines.recv() {
            let _ = events.send(Event::HostLine(line));
        }
        let _ = events.send(Event::HostGone);
    });
    let say = |value: Value| {
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{value}").and_then(|()| stdout.flush());
    };
    say(json!({ "ready": true, "appPid": app_pid, "hostPid": host.pid }));

    let mut gone = false;
    let mut newest: u64 = 0;
    let mut spent = true;
    let mut owner = false;
    let mut moves: Vec<Value> = Vec::new();
    // The command waiting on the host; others wait behind it.
    let mut waiting: Option<Value> = None;
    let mut queue: std::collections::VecDeque<Value> = Default::default();
    loop {
        if waiting.is_none() {
            while let Some(command) = queue.pop_front() {
                match command["cmd"].as_str().unwrap_or_default() {
                    "ping" => say(json!({ "pong": command["seq"] })),
                    "focus_owner" => say(json!({ "owner": if owner { "panel" } else { "app" } })),
                    "focus_log" => say(json!({ "moves": moves })),
                    "invalidate" if !gone => {
                        gone = host.send(json!({ "cmd": "invalidate" })).is_err();
                        waiting = (!gone).then_some(command);
                    }
                    "press" if !gone => {
                        newest += 1;
                        spent = false;
                        gone = host
                            .send(json!({ "cmd": "press", "id": command["id"], "serial": newest }))
                            .is_err();
                        waiting = (!gone).then_some(command);
                    }
                    "blur" if !gone => {
                        owner = false;
                        gone = host.send(json!({ "cmd": "blur" })).is_err();
                        waiting = (!gone).then_some(command);
                    }
                    "invalidate" | "press" | "blur" => say(json!({ "error": "host_gone" })),
                    other => say(json!({ "error": format!("no command {other}") })),
                }
                if waiting.is_some() {
                    break;
                }
            }
        }
        match inbox.recv_timeout(Duration::from_millis(20)) {
            Ok(Event::Command(command)) => queue.push_back(command),
            Ok(Event::HostGone) => {
                gone = true;
                if waiting.take().is_some() {
                    say(json!({ "error": "host_gone" }));
                }
            }
            Ok(Event::HostLine(line)) => {
                let reply: Value = serde_json::from_str(&line)
                    .map_err(|_| format!("the panel host wrote {line:?}"))?;
                if !reply["move"].is_null() {
                    let serial = reply["move"]["serial"].clone();
                    let granted = serial.as_u64() == Some(newest) && !spent;
                    if granted {
                        spent = true;
                        owner = true;
                    }
                    moves.push(json!({ "serial": serial, "result": if granted { "moved" } else { "refused" } }));
                    let _ = host.send(json!({ "granted": granted }));
                    continue;
                }
                match waiting
                    .take()
                    .as_ref()
                    .and_then(|command| command["cmd"].as_str())
                {
                    Some("invalidate") => match reply["tree"].as_str().map(parse) {
                        Some(Ok(tree)) => match unknown_element(&tree) {
                            Some(kind) => {
                                say(json!({ "error": format!("unknown_element {kind}") }))
                            }
                            None => {
                                let bounds = check.lay_out(tree.clone())?;
                                say(json!({ "tree": tree.to_json(&bounds) }));
                            }
                        },
                        Some(Err(error)) => say(json!({ "error": error })),
                        None => say(json!({ "error": reply["error"] })),
                    },
                    Some("press") => say(json!({ "serial": newest })),
                    Some("blur") => say(json!({})),
                    _ => {}
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(0),
        }
    }
}

/// `deep-app panel-bench`: each run a fresh host, warmed up and then timed update by update.
pub fn bench(args: &[String]) -> i32 {
    match run_bench(args) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("deep-app panel-bench: {error}");
            2
        }
    }
}

const WARMUP: usize = 64;

fn run_bench(args: &[String]) -> Result<(), String> {
    let (host_path, panel) = panel_args(args)?;
    let runs: usize = flag(args, "--runs")
        .and_then(|n| n.parse().ok())
        .ok_or("--runs N")?;
    let updates: usize = flag(args, "--updates")
        .and_then(|n| n.parse().ok())
        .ok_or("--updates N")?;
    let out = flag(args, "--out").ok_or("--out FILE")?;
    let mut reports = Vec::new();
    let mut last = None;
    for _ in 0..runs {
        let mut host = Host::start(&host_path, &panel, false)?;
        for _ in 0..WARMUP {
            host.update()?;
        }
        let (mut script, mut ipc, mut total) = (Vec::new(), Vec::new(), Vec::new());
        let mut tree = None;
        for _ in 0..updates {
            let started = Instant::now();
            let (text, nanos) = host.update()?;
            let held = parse(&text)?;
            let elapsed = started.elapsed().as_nanos() as u64;
            script.push(nanos);
            ipc.push(elapsed.saturating_sub(nanos));
            total.push(elapsed);
            tree = Some(held);
        }
        reports
            .push(json!({ "warmup": WARMUP, "scriptNs": script, "ipcNs": ipc, "totalNs": total }));
        host.send(json!({ "cmd": "jit" }))?;
        let jit = host.next()?;
        last = Some((jit, host.pid, tree));
    }
    let (jit, host_pid, tree) = last.ok_or("--runs is 0")?;
    let report = json!({
        "runs": reports, "jit": jit, "hostPid": host_pid, "appPid": std::process::id(),
        "tree": tree.map(|tree| tree.to_json(&[])),
    });
    std::fs::write(out, report.to_string()).map_err(|error| error.to_string())
}
