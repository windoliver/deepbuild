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

    struct Frame {
        bounds: [i64; 4],
        role: String,
        children: Vec<Frame>,
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

    fn flatten<'a>(frame: &'a Frame, into: &mut Vec<&'a Frame>) {
        into.push(frame);
        for child in &frame.children {
            flatten(child, into);
        }
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
        let roots: Vec<Frame> = (0..top.count())
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
        let mut frames = Vec::new();
        for root in &roots {
            flatten(root, &mut frames);
        }

        // Nodes in pre-order, the same walk on both sides; the window node itself may or may
        // not be among AppKit's children, so its frame is the content view's when it isn't.
        let mut snapshot = Snapshot {
            size: [
                f32::from(viewport.width).round() as u32,
                f32::from(viewport.height).round() as u32,
            ],
            scale: scale.round() as u32,
            tree,
            items: deep_app::canvas::items(),
        };
        let mut nodes: Vec<&mut Node> = Vec::new();
        fn collect<'a>(node: &'a mut Node, into: &mut Vec<&'a mut Node>) {
            let children = &mut node.children as *mut Vec<Node>;
            into.push(node);
            // Children are visited through a raw pointer because the parent is already lent out.
            for child in unsafe { &mut *children } {
                collect(child, into);
            }
        }
        collect(&mut snapshot.tree, &mut nodes);
        let device = |value: Pixels| (f32::from(value) * scale).round() as i64;
        let window_bounds = [0, 0, device(viewport.width), device(viewport.height)];
        let paired: Vec<[i64; 4]> = if frames.len() == nodes.len() {
            frames.iter().map(|frame| frame.bounds).collect()
        } else if frames.len() + 1 == nodes.len() {
            std::iter::once(window_bounds)
                .chain(frames.iter().map(|frame| frame.bounds))
                .collect()
        } else {
            return Err(format!(
                "GPUI's tree has {} nodes but AppKit lists {} accessibility elements: {}",
                nodes.len(),
                frames.len(),
                frames
                    .iter()
                    .map(|frame| frame.role.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        };
        for (node, bounds) in nodes.iter_mut().zip(paired) {
            node.bounds = bounds;
        }
        eprintln!(
            "deep-live: frame {} at {}x{}, {} nodes",
            frame["frame_number"],
            frame["viewport_size"]["width"],
            frame["viewport_size"]["height"],
            nodes.len()
        );
        Ok(snapshot)
    }
}
