//! `deep-live --view <id> --out <file>`: the live capture. Opens the real app window at the
//! reference window on this Mac, over the same fixture record the replica draws, activates
//! accessibility the way an assistive client does, and writes the window's accessibility tree
//! in the snapshot's shape: roles, names and values from GPUI's own AccessKit tree, bounds from
//! the frames AppKit reports for each node, in whole device pixels.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(live::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-live: the live tree is read on macOS only");
        std::process::exit(2);
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

    pub fn run() -> i32 {
        let mut view = None;
        let mut out = None;
        let mut args = std::env::args().skip(1);
        while let Some(arg) = args.next() {
            match arg.as_str() {
                "--view" => view = args.next(),
                "--out" => out = args.next().map(PathBuf::from),
                other => {
                    eprintln!("deep-live: unknown argument {other}");
                    return 2;
                }
            }
        }
        let (Some(view), Some(out)) = (view, out) else {
            eprintln!("usage: deep-live --view <id> --out <file>");
            return 2;
        };
        deep_app::views::set_state(deep_replica::load_state());
        let layout = Layout::shipped(&view);
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
    /// a few frames so the tree it hands AccessKit is the one drawn at the reference size.
    fn settle(window: &mut Window, cx: &mut App, out: PathBuf, frame: usize) {
        if frame == 0 {
            if window.viewport_size() != window_size() {
                window.resize(window_size());
            }
            activate_accessibility();
        }
        deep_app::canvas::clear_items();
        window.refresh();
        if frame + 1 < FRAMES {
            window.on_next_frame(move |window, cx| settle(window, cx, out, frame + 1));
            return;
        }
        match capture(window) {
            Ok(snapshot) => {
                if let Some(parent) = out.parent() {
                    std::fs::create_dir_all(parent).expect("the output directory");
                }
                std::fs::write(
                    &out,
                    serde_json::to_string_pretty(&snapshot.to_json()).expect("JSON"),
                )
                .expect("the live tree is written");
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
    /// content view, and the role, title and value an assistive client would read.
    struct Frame {
        bounds: [i64; 4],
        role: String,
        title: Option<String>,
        value: Option<String>,
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
}
