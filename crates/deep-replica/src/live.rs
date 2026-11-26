//! `deep-live --view <id> --out <file>`: the live capture. Opens the real app window at the
//! reference window on this Mac, over the same fixture record the replica draws, activates
//! accessibility the way an assistive client does, and writes the window's accessibility tree
//! in the snapshot's shape: roles, names and values from GPUI's own AccessKit tree, and the
//! identifier and bounds AppKit reports for each node, its bounds in whole device pixels.
//!
//! Issue #1546: `deep-live --view <id> --out <file> --watch` shows the real app window on your hub's record instead,
//! read through the app's one record reader on its tick, sends it no input and forces no frame, and writes one JSON
//! line per frame the window draws, `{"frame", "at", "log_pos", "names", "snapshot"}` (#2026: the replica's snapshot
//! of that frame, with the menu bar's title), after `{"ready": true, "at"}` once the reader has reached the hub. It
//! runs until stopped.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(live::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-live: the live tree is read on macOS only");
        std::process::exit(2);
    }
}

/// Whether deep-live may capture now: the window is key, as both GPUI and AppKit say, and AppKit's focused element is the
/// one the app focused. AppKit reports no focused element for a window that isn't key, and GPUI learns that the window
/// left key a task later than AppKit does, so a capture taken on either's word alone could record no focus where the
/// window has one (#2690's retake under load, #3488's review). `Err` says what it waits for.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn ready(active: bool, key: bool, appkit: Option<&str>, app: Option<&str>) -> Result<(), String> {
    if !(active && key) {
        return Err(format!(
            "the window to be key (GPUI says active {active}, AppKit says key {key})"
        ));
    }
    if appkit != app {
        return Err(format!(
            "AppKit's focused element ({appkit:?}) to be the one the app focused ({app:?})"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::ready;

    #[test]
    fn captures_only_a_key_window_whose_focus_appkit_reports_as_the_apps() {
        assert_eq!(
            ready(true, true, Some("card-option:yes"), Some("card-option:yes")),
            Ok(())
        );
        assert_eq!(
            ready(true, true, None, None),
            Ok(()),
            "a window that focused nothing is captured as it is"
        );
        for (active, key) in [(false, true), (true, false), (false, false)] {
            assert!(
                ready(
                    active,
                    key,
                    Some("card-option:yes"),
                    Some("card-option:yes")
                )
                .is_err(),
                "GPUI says active {active}, AppKit says key {key}"
            );
        }
        let none =
            ready(true, true, None, Some("card-option:yes")).expect_err("AppKit reports no focus");
        assert!(
            none.contains("card-option:yes"),
            "the wait names the app's focus: {none}"
        );
        assert!(ready(true, true, Some("session:01A"), Some("card-option:yes")).is_err());
    }
}

#[cfg(target_os = "macos")]
mod live {
    use std::path::PathBuf;

    use deep_app::views::Layout;
    use deep_replica::{
        shell::{open_shell_with, window_options, window_size},
        snapshot::{snake_case, Node, Snapshot},
        WINDOW,
    };
    use gpui_kit::*;
    use objc2::{msg_send, rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSView, NSWindow};
    use objc2_foundation::{NSArray, NSRect, NSString};
    use serde_json::Value;

    const FRAMES: usize = 8;
    /// Past `FRAMES`, the window is asked to be activated again every `REACTIVATE` frames until `ready` holds. A watch
    /// on the clock, not on frames, ends the run after `WAIT`: a window that is covered or on a locked screen gets no
    /// frames at all.
    const REACTIVATE: usize = 60;
    const WAIT: std::time::Duration = std::time::Duration::from_secs(120);
    /// What the last frame past `FRAMES` waited for, for the watch to say.
    static WAITING: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
    /// Set once a capture starts, so the watch never ends a run that is writing its tree.
    static CAPTURING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn run() -> i32 {
        let (view, out, ..) = match deep_replica::view_args("deep-live", "file", false) {
            Ok(args) => args,
            Err(code) => return code,
        };
        if view == deep_replica::FIRST_SCREEN {
            eprintln!("deep-live: --first-screen is the replica's; deep-live draws a shipped view");
            return 2;
        }
        if std::env::args().any(|arg| arg == "--watch") {
            return watch::run(&view, out);
        }
        deep_app::views::set_state(deep_replica::load_state());
        let layout = Layout::shipped(&view);
        std::thread::spawn(|| {
            std::thread::sleep(WAIT);
            if CAPTURING.load(std::sync::atomic::Ordering::SeqCst) {
                return;
            }
            let waiting = WAITING.lock().map(|w| w.clone()).unwrap_or_default();
            let waiting = if waiting.is_empty() {
                "its first frames".to_owned()
            } else {
                waiting
            };
            eprintln!(
                "deep-live: no capture in {} s, still waiting for {waiting}",
                WAIT.as_secs()
            );
            std::process::exit(1);
        });
        gpui_kit::application().run(move |cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
            // A real, shown window: a hidden one gets no frames and no accessibility tree.
            let options = WindowOptions {
                show: true,
                focus: true,
                ..window_options()
            };
            let (handle, _) = open_shell_with(options, &layout, cx, |_, _| {});
            cx.activate(true);
            handle
                .update(cx, |_, window, _| {
                    window.on_next_frame(move |window, cx| settle(window, cx, out, 0));
                })
                .expect("the window is open");
        });
        0
    }

    /// After the first frame: fix the content size, activate accessibility, then give the window
    /// a few frames so the tree it hands AccessKit is the one drawn at the reference size. A
    /// next-frame callback runs before that frame draws, so each callback clears the canvas items
    /// and asks for a frame, and the one after the last asked-for frame captures what that frame
    /// drew: its tree and its items, both.
    fn settle(window: &mut Window, cx: &mut App, out: PathBuf, frame: usize) {
        if frame == 0 {
            if window.viewport_size() != window_size() {
                window.resize(window_size());
            }
            activate_accessibility();
        }
        let waiting = if frame < FRAMES {
            None
        } else {
            // A window not at the reference size yet, as on a display change, is waited for too.
            match content_view() {
                Err(error) => Some(error),
                Ok((ns_window, view)) => {
                    let (appkit, app) =
                        (focused_identifier(&view), deep_app::views::focus_id(window));
                    super::ready(
                        window.is_window_active(),
                        ns_window.isKeyWindow(),
                        appkit.as_deref(),
                        app.as_deref(),
                    )
                    .err()
                }
            }
        };
        if frame < FRAMES || waiting.is_some() {
            if let Some(waiting) = waiting {
                if let Ok(mut last) = WAITING.lock() {
                    *last = waiting;
                }
                if (frame - FRAMES) % REACTIVATE == 0 {
                    cx.activate(true);
                }
            }
            deep_app::canvas::clear_items();
            window.refresh();
            window.on_next_frame(move |window, cx| settle(window, cx, out, frame + 1));
            return;
        }
        CAPTURING.store(true, std::sync::atomic::Ordering::SeqCst);
        eprintln!("deep-live: captured at settle frame {frame}");
        match capture(window) {
            Ok(snapshot) => {
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent).expect("the output directory");
                }
                // Written whole or not at all: beside it first, then renamed over it.
                let partial = out.with_extension("json.partial");
                std::fs::write(
                    &partial,
                    serde_json::to_string_pretty(&snapshot.to_json()).expect("JSON"),
                )
                .expect("the live tree is written");
                std::fs::rename(&partial, &out).expect("the live tree is in place");
                println!(
                    "live {}: {} nodes, {} canvas items",
                    out.display(),
                    snapshot.flatten().len(),
                    snapshot.items.len()
                );
                cx.quit();
            }
            Err(error) => {
                eprintln!("deep-live: {error}");
                std::process::exit(1);
            }
        }
    }

    /// Issue #1546: the real window on your hub, and each frame it draws by itself.
    mod watch {
        use std::{
            cell::{Cell, RefCell},
            fs::File,
            io::Write as _,
            path::PathBuf,
            rc::Rc,
            time::{Duration, SystemTime, UNIX_EPOCH},
        };

        use deep_app::{
            hub, notify,
            record::{self, HubWatch, RecordReader},
            views::{Layout, Shell},
        };
        use deep_replica::{shell::window_options, snapshot::from_observed};
        use gpui_kit::{base::test_support::snapshots, *};
        use serde_json::json;

        fn now() -> u64 {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64)
        }

        /// The shell, and a mark painted after it that writes the frame's line once the frame is drawn.
        struct Watched {
            shell: Entity<Shell>,
            view: String,
            out: Rc<RefCell<File>>,
            frames: Rc<Cell<Option<u64>>>,
        }

        impl Render for Watched {
            fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
                let (handle, view, out, frames) = (
                    window.window_handle(),
                    self.view.clone(),
                    self.out.clone(),
                    self.frames.clone(),
                );
                let written = move |_: Bounds<Pixels>, _: (), _: &mut Window, cx: &mut App| {
                    let at = now();
                    // Once the frame is drawn, its elements are what it painted.
                    cx.defer(move |cx| {
                        // What it drew, as names and as the replica's snapshot with the menu bar's title (#2026).
                        let (names, snapshot) = handle
                            .update(cx, |_, window, _| {
                                (names_in(window, &view), from_observed(window).to_json())
                            })
                            .unwrap_or_default();
                        let mut line = match frames.get() {
                            None if !record::connected() => return,
                            None => json!({"ready": true, "at": at}).to_string() + "\n",
                            Some(_) => String::new(),
                        };
                        let frame = frames.get().map_or(0, |n| n + 1);
                        frames.set(Some(frame));
                        let log_pos = record::with_view(|v| v.log_pos).unwrap_or(0);
                        line += &json!({"frame": frame, "at": at, "log_pos": log_pos, "names": names, "snapshot": snapshot})
                            .to_string();
                        let _ = writeln!(out.borrow_mut(), "{line}");
                    });
                };
                div()
                    .size_full()
                    .child(self.shell.clone())
                    .child(canvas(|_, _, _| (), written).absolute().size_0())
            }
        }

        /// Every accessibility name the view `view` drew, top to bottom then left to right.
        fn names_in(window: &Window, view: &str) -> Vec<String> {
            let id = ElementId::Name(format!("view:deepbuild/{view}").into());
            let mut named: Vec<_> = snapshots(window)
                .into_iter()
                .filter(|e| e.visible() && e.path().contains(&id))
                .filter_map(|e| {
                    Some((
                        e.bounds().origin.y,
                        e.bounds().origin.x,
                        e.label()?.to_owned(),
                    ))
                })
                .collect();
            named.sort_by(|a, b| {
                (a.0, a.1)
                    .partial_cmp(&(b.0, b.1))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            named.into_iter().map(|(.., name)| name).collect()
        }

        pub fn run(view: &str, out: PathBuf) -> i32 {
            let file = match File::create(&out) {
                Ok(file) => Rc::new(RefCell::new(file)),
                Err(error) => {
                    eprintln!("deep-live: {}: {error}", out.display());
                    return 1;
                }
            };
            record::install(RecordReader::unopened_folded(
                &hub::address(),
                &hub::root().join("control.token"),
            ));
            let (layout, view) = (Layout::shipped(view), view.to_owned());
            gpui_kit::application().run(move |cx| {
                gpui_kit::init(cx);
                deep_app::init(cx);
                let options = WindowOptions {
                    show: true,
                    focus: true,
                    ..window_options()
                };
                gpui_kit::open_window(options, cx, |window, cx| {
                    let shell = cx.new(|cx| Shell::new(&layout, window, cx));
                    cx.new(|_| Watched {
                        shell,
                        view,
                        out: file,
                        frames: Rc::new(Cell::new(None)),
                    })
                })
                .expect("the window opens");
                cx.activate(true);
                // The reader's tick, as the app runs it: read the hub, say whether it answers and since when, then tell
                // the views what moved and the menu bar's line (#2026).
                cx.spawn(async move |cx| {
                    let mut watch = HubWatch::default();
                    let mut shown = String::new();
                    loop {
                        cx.background_executor().timer(record::TICK).await;
                        // #2661's planted tick stops reading the hub, in a build with the env-plants feature only.
                        if !deep_app::plain::planted("tick-stops-reading") {
                            watch.tick(now(), || record::read(Duration::ZERO));
                        }
                        let reach = notify::Reach {
                            hub_down: watch.down(),
                            since: watch.since(),
                            ..notify::reach()
                        };
                        let reached = reach != notify::reach();
                        if reached {
                            notify::publish(reach);
                        }
                        cx.update(|cx| {
                            record::sync(cx);
                            let line = deep_app::menu_bar_line();
                            if reached || line != shown {
                                record::notify_views(cx);
                                shown = line;
                            }
                        });
                    }
                })
                .detach();
            });
            0
        }
    }

    fn content_view() -> Result<(Retained<NSWindow>, Retained<NSView>), String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let app = NSApplication::sharedApplication(mtm);
        let windows = app.windows();
        // GPUI keeps helper windows too; the shell's is the one whose content is the reference
        // window.
        let mut found = Vec::new();
        let mut sizes = Vec::new();
        for index in 0..windows.count() {
            let window = windows.objectAtIndex(index);
            if let Some(view) = window.contentView() {
                let size = view.bounds().size;
                sizes.push(format!("{}x{}", size.width, size.height));
                if (size.width - WINDOW.0 as f64).abs() < 1.
                    && (size.height - WINDOW.1 as f64).abs() < 1.
                {
                    found.push((window, view));
                }
            }
        }
        match found.len() {
            1 => Ok(found.remove(0)),
            count => Err(format!(
                "{count} windows have the reference content size; the windows are {}",
                sizes.join(", ")
            )),
        }
    }

    /// Asks the content view for its accessibility children, which is what an assistive client
    /// does first and what makes AccessKit's adapter request the initial tree.
    fn activate_accessibility() {
        if let Ok((_, view)) = content_view() {
            let _: Option<Retained<NSArray<AnyObject>>> =
                unsafe { msg_send![&*view, accessibilityChildren] };
        }
    }

    /// What AppKit reports for one accessibility element: its frame in device pixels inside the
    /// content view, and the role, title, value and identifier an assistive client would read.
    struct Frame {
        bounds: [i64; 4],
        role: String,
        title: Option<String>,
        value: Option<String>,
        identifier: Option<String>,
        children: Vec<Frame>,
    }

    fn string_of(object: Option<Retained<AnyObject>>) -> Option<String> {
        object.map(|object| {
            let text: Retained<NSString> = unsafe { msg_send![&*object, description] };
            text.to_string()
        })
    }

    fn frames_of(
        node: &AnyObject,
        window: &NSWindow,
        view: &NSView,
        factor: f64,
        flipped: bool,
    ) -> Frame {
        let screen: NSRect = unsafe { msg_send![node, accessibilityFrame] };
        let role: Option<Retained<NSString>> = unsafe { msg_send![node, accessibilityRole] };
        let title: Option<Retained<NSString>> = unsafe { msg_send![node, accessibilityTitle] };
        let value: Option<Retained<AnyObject>> = unsafe { msg_send![node, accessibilityValue] };
        let identifier: Option<Retained<NSString>> =
            unsafe { msg_send![node, accessibilityIdentifier] };
        let in_window = window.convertRectFromScreen(screen);
        let local = view.convertRect_fromView(in_window, None);
        let top = if flipped {
            local.origin.y
        } else {
            view.bounds().size.height - (local.origin.y + local.size.height)
        };
        let device = |value: f64| (value * factor).round() as i64;
        let children: Option<Retained<NSArray<AnyObject>>> =
            unsafe { msg_send![node, accessibilityChildren] };
        Frame {
            bounds: [
                device(local.origin.x),
                device(top),
                device(local.size.width),
                device(local.size.height),
            ],
            role: role.map(|role| role.to_string()).unwrap_or_default(),
            title: title.map(|title| title.to_string()),
            value: string_of(value),
            // AppKit gives an element with no author ID an empty identifier.
            identifier: identifier
                .map(|identifier| identifier.to_string())
                .filter(|identifier| !identifier.is_empty()),
            children: children
                .map(|children| {
                    (0..children.count())
                        .map(|index| {
                            frames_of(
                                &children.objectAtIndex(index),
                                window,
                                view,
                                factor,
                                flipped,
                            )
                        })
                        .collect()
                })
                .unwrap_or_default(),
        }
    }

    fn count_frames(frame: &Frame) -> usize {
        // Pre-order size, to tell whether AppKit listed the window node itself.
        1 + frame.children.iter().map(count_frames).sum::<usize>()
    }

    fn count_nodes(node: &Node) -> usize {
        1 + node.children.iter().map(count_nodes).sum::<usize>()
    }

    /// GPUI's value as the text AppKit's `accessibilityValue` describes it: a string as is, a
    /// bool as NSNumber prints it, a number likewise.
    fn value_text(value: &Option<Value>) -> Result<Option<String>, String> {
        Ok(match value {
            None => None,
            Some(Value::String(text)) => Some(text.clone()),
            Some(Value::Bool(flag)) => Some(if *flag { "1" } else { "0" }.to_owned()),
            Some(Value::Number(number)) => Some(number.to_string()),
            Some(other) => {
                return Err(format!(
                    "GPUI value {other} has no AppKit text in the live oracle"
                ))
            }
        })
    }

    /// The AppKit role AccessKit's macOS adapter gives a GPUI role, for the roles the shell draws.
    fn appkit_role(role: &str) -> Result<&'static str, String> {
        Ok(match role {
            "window" => "AXGroup",
            "label" => "AXStaticText",
            "button" => "AXButton",
            // The list, a page and an agent's view (#1461, #1460, #1459), as AccessKit maps Role::Group.
            "group" => "AXGroup",
            // The session chart's line (#1455), as vendor/accesskit_macos/src/node.rs maps Role::Image.
            "image" => "AXImage",
            other => {
                return Err(format!(
                    "GPUI role {other} has no AppKit role in the live oracle; add it before trusting a tree with one"
                ))
            }
        })
    }

    /// Pairs the GPUI tree with AppKit's element tree, node for node and child for child: each
    /// node must have the role AccessKit maps it to, its title and value as text, and the same
    /// number of children as the element, and takes that element's frame as its bounds. `at`
    /// counts the nodes paired so far, in pre-order, to name a mismatch.
    fn pair(node: &mut Node, frame: &Frame, at: &mut usize) -> Result<(), String> {
        let index = *at;
        *at += 1;
        let who = format!("node {index} ({} {:?})", node.role, node.name);
        let role = appkit_role(&node.role)?;
        if frame.role != role {
            return Err(format!(
                "{who}: GPUI's role maps to {role} but AppKit reports {}",
                frame.role
            ));
        }
        // AccessKit withholds the root window's title on purpose, so only the nodes under it
        // carry one to compare.
        if node.role != "window" && frame.title != node.name {
            return Err(format!(
                "{who}: AppKit's title is {:?}, not GPUI's name",
                frame.title
            ));
        }
        let value = value_text(&node.value)?;
        if frame.value != value {
            return Err(format!(
                "{who}: AppKit's value is {:?}, not GPUI's {value:?}",
                frame.value
            ));
        }
        if node.children.len() != frame.children.len() {
            return Err(format!(
                "{who}: GPUI has {} children but AppKit lists {}: {}",
                node.children.len(),
                frame.children.len(),
                frame
                    .children
                    .iter()
                    .map(|child| child.role.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
        node.bounds = frame.bounds;
        // The identifier is what an assistive client reads, so it is the live tree's `id` (#1459).
        node.id = frame.identifier.clone();
        for (child, child_frame) in node.children.iter_mut().zip(&frame.children) {
            pair(child, child_frame, at)?;
        }
        Ok(())
    }

    /// GPUI's AccessKit tree for the last frame, as nodes without bounds, in tree order.
    fn gpui_tree(window: &Window) -> Result<(Node, Value), String> {
        let json = window
            .debug_a11y_tree_json()
            .ok_or("accessibility never activated, so GPUI built no tree")?;
        let value: Value = serde_json::from_str(&json).map_err(|error| error.to_string())?;
        let root = value["root"].as_str().ok_or("the tree has no root")?;
        fn build(id: &str, nodes: &Value) -> Result<Node, String> {
            let node = nodes
                .get(id)
                .ok_or_else(|| format!("node {id} is missing"))?;
            let aria = &node["aria"];
            Ok(Node {
                role: snake_case(aria["role"].as_str().ok_or("a node without a role")?),
                name: aria["label"].as_str().map(str::to_owned),
                value: aria.get("value").filter(|value| !value.is_null()).cloned(),
                id: None,
                bounds: [0; 4],
                children: node["children"]
                    .as_array()
                    .map(|children| {
                        children
                            .iter()
                            .map(|child| build(child.as_str().unwrap_or_default(), nodes))
                            .collect()
                    })
                    .unwrap_or(Ok(Vec::new()))?,
            })
        }
        Ok((build(root, &value["nodes"])?, value["frame"].clone()))
    }

    /// The identifier of the element AppKit reports as focused, as an assistive client reads it: none when it has
    /// none (#1459).
    fn focused_identifier(view: &NSView) -> Option<String> {
        let focused: Option<Retained<AnyObject>> =
            unsafe { msg_send![view, accessibilityFocusedUIElement] };
        let identifier: Option<Retained<NSString>> =
            unsafe { msg_send![&*focused?, accessibilityIdentifier] };
        identifier
            .map(|identifier| identifier.to_string())
            .filter(|identifier| !identifier.is_empty())
    }

    fn capture(window: &Window) -> Result<Snapshot, String> {
        let (tree, frame) = gpui_tree(window)?;
        let viewport = window.viewport_size();
        let scale = window.scale_factor();
        let expected = window_size();
        if viewport != expected {
            return Err(format!(
                "the viewport is {viewport:?}, not the reference window {expected:?}"
            ));
        }
        let (ns_window, view) = content_view()?;
        let factor = ns_window.backingScaleFactor();
        if (factor - scale as f64).abs() > 0.01 {
            return Err(format!(
                "AppKit's scale {factor} differs from GPUI's {scale}"
            ));
        }
        let flipped: bool = unsafe { msg_send![&*view, isFlipped] };
        let top: Option<Retained<NSArray<AnyObject>>> =
            unsafe { msg_send![&*view, accessibilityChildren] };
        let top = top.ok_or("the content view has no accessibility children")?;
        let mut roots: Vec<Frame> = (0..top.count())
            .map(|index| {
                frames_of(
                    &top.objectAtIndex(index),
                    &ns_window,
                    &view,
                    factor,
                    flipped,
                )
            })
            .collect();
        // The window node itself may or may not be among AppKit's children; when it isn't, the
        // content view stands in for it, with the group role AccessKit gives a window and the
        // elements AppKit listed as its children.
        let device = |value: Pixels| (f32::from(value) * scale).round() as i64;
        let listed: usize = roots.iter().map(count_frames).sum();
        let nodes = count_nodes(&tree);
        let root = if listed + 1 == nodes {
            Frame {
                bounds: [0, 0, device(viewport.width), device(viewport.height)],
                role: "AXGroup".into(),
                title: None,
                value: None,
                identifier: None,
                children: std::mem::take(&mut roots),
            }
        } else if roots.len() == 1 && listed == nodes {
            roots.remove(0)
        } else {
            return Err(format!(
                "GPUI's tree has {nodes} nodes but AppKit lists {listed} accessibility elements under {} roots: {}",
                roots.len(),
                roots
                    .iter()
                    .map(|frame| frame.role.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        };

        let mut snapshot = Snapshot {
            size: [
                f32::from(viewport.width).round() as u32,
                f32::from(viewport.height).round() as u32,
            ],
            scale: scale.round() as u32,
            tree,
            items: deep_app::canvas::items(),
            // deep-live opens no status item, so the title is the line the app sets on its own.
            menu_bar: deep_app::menu_bar_line(),
            focus: focused_identifier(&view),
        };
        let mut paired = 0;
        pair(&mut snapshot.tree, &root, &mut paired)?;
        eprintln!(
            "deep-live: frame {} at {}x{}, {paired} nodes",
            frame["frame_number"],
            frame["viewport_size"]["width"],
            frame["viewport_size"]["height"],
        );
        Ok(snapshot)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use serde_json::json;

        fn node(role: &str, name: Option<&str>, value: Option<Value>, children: Vec<Node>) -> Node {
            Node {
                role: role.into(),
                name: name.map(str::to_owned),
                value,
                id: None,
                bounds: [0; 4],
                children,
            }
        }

        fn frame(
            role: &str,
            title: Option<&str>,
            value: Option<&str>,
            at: i64,
            children: Vec<Frame>,
        ) -> Frame {
            Frame {
                bounds: [at, at, 10, 10],
                role: role.into(),
                title: title.map(str::to_owned),
                value: value.map(str::to_owned),
                identifier: None,
                children,
            }
        }

        /// A window over a label "x" and a button "y" valued "on", as GPUI and AppKit both say.
        fn agreeing() -> (Node, Frame) {
            (
                node(
                    "window",
                    None,
                    None,
                    vec![
                        node("label", Some("x"), None, Vec::new()),
                        node("button", Some("y"), Some(json!("on")), Vec::new()),
                    ],
                ),
                frame(
                    "AXGroup",
                    None,
                    None,
                    0,
                    vec![
                        frame("AXStaticText", Some("x"), None, 1, Vec::new()),
                        frame("AXButton", Some("y"), Some("on"), 2, Vec::new()),
                    ],
                ),
            )
        }

        #[std::prelude::v1::test]
        fn agreeing_trees_pair_and_take_appkit_frames() {
            let (mut tree, root) = agreeing();
            let mut at = 0;
            pair(&mut tree, &root, &mut at).unwrap();
            assert_eq!(at, 3);
            assert_eq!(tree.children[1].bounds, [2, 2, 10, 10]);
            assert_eq!(tree.children[1].id, None);
            let (mut tree, mut root) = agreeing();
            root.children[1].identifier = Some("ask:01A".into());
            pair(&mut tree, &root, &mut 0).unwrap();
            assert_eq!(
                tree.children[1].id.as_deref(),
                Some("ask:01A"),
                "AppKit's identifier is the node's id"
            );
        }

        /// Each disagreement AppKit can show, planted alone, is refused at the node it is on.
        #[std::prelude::v1::test]
        fn each_disagreement_is_refused() {
            type Change = (&'static str, fn(&mut Frame));
            let changes: [Change; 6] = [
                ("maps to AXButton", |root| {
                    root.children[1].role = "AXStaticText".into()
                }),
                ("title", |root| root.children[0].title = Some("z".into())),
                ("value", |root| root.children[1].value = Some("off".into())),
                ("value", |root| {
                    root.children[0].value = Some("extra".into())
                }),
                ("value", |root| root.children[1].value = None),
                ("children", |root| {
                    let moved = root.children.pop().unwrap();
                    root.children[0].children.push(moved);
                }),
            ];
            for (why, change) in changes {
                let (mut tree, mut root) = agreeing();
                change(&mut root);
                let error = pair(&mut tree, &root, &mut 0).expect_err(why);
                assert!(error.contains(why), "{why}: {error}");
            }
            let (mut tree, root) = agreeing();
            tree.children[0].role = "slider".into();
            let error = pair(&mut tree, &root, &mut 0).unwrap_err();
            assert!(error.contains("no AppKit role"), "{error}");
        }

        #[std::prelude::v1::test]
        fn values_read_as_appkit_prints_them() {
            assert_eq!(value_text(&None).unwrap(), None);
            assert_eq!(
                value_text(&Some(json!(true))).unwrap().as_deref(),
                Some("1")
            );
            assert_eq!(value_text(&Some(json!(3))).unwrap().as_deref(), Some("3"));
            assert!(value_text(&Some(json!([1]))).is_err());
        }
    }
}
