//! #1425 AC3, blind redraft: a panel loaded the way the app loads one, `deep_app::mount_panel`, in a headless
//! replica window in light or dark, and what it drew read back: the script's build error and debug tree, and
//! the window's pixels.
#![allow(dead_code)]

use std::{path::Path, rc::Rc, time::Duration};

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{prelude::FluentBuilder as _, *};
use gpui_shell::{ScriptView, ShellRuntime};

/// What one panel did in a replica window.
pub struct Drawn {
    /// Why `mount_panel` refused it, if it did.
    pub refused: Option<String>,
    /// Why the script's latest build failed, if it did.
    pub build_error: Option<String>,
    /// The script's debug tree, once it built.
    pub tree: Option<String>,
    /// The window's pixels, captured.
    pub shot: Option<Vec<u8>>,
}

/// The replica's window, smaller than the reference one so a whole catalog draws in reasonable time.
fn options() -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(480.), px(360.)),
        })),
        ..deep_replica::shell::window_options()
    }
}

struct Root {
    view: Option<AnyView>,
    ground: Hsla,
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(self.ground)
            .when_some(self.view.clone(), |root, view| root.child(view))
    }
}

/// Loads the panel in `dir` through `mount_panel` in a new window, in dark or light as macOS would report it,
/// draws it for a few frames on the virtual clock and reads what it drew.
pub fn draw(
    cx: &mut HeadlessAppContext,
    runtime: &Rc<ShellRuntime>,
    dir: &Path,
    dark: bool,
) -> Drawn {
    deep_app::chrome::force_dark(Some(dark));
    let mut mounted: Result<Entity<ScriptView>, String> = Err(String::new());
    let (window, _) = cx.update(|cx| {
        open_window(options(), cx, |window, cx| {
            deep_app::chrome::follow(window, cx);
            mounted = deep_app::mount_panel(runtime, dir, window, cx)
                .map_err(|error| format!("{error:#}"));
            let view = mounted.as_ref().ok().cloned().map(AnyView::from);
            cx.new(|_| Root {
                view,
                ground: deep_app::chrome::chrome(dark).ground,
            })
        })
        .expect("a replica window opens")
    });
    let view = match mounted {
        Ok(view) => view,
        Err(refused) => {
            return Drawn {
                refused: Some(refused),
                build_error: None,
                tree: None,
                shot: None,
            }
        }
    };
    for _ in 0..4 {
        cx.update_window(window, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
        cx.run_until_parked();
        cx.advance_clock(Duration::from_millis(16));
        cx.run_until_parked();
    }
    cx.update_window(window, |_, window, cx| window.render_frame(cx))
        .expect("the window draws");
    let (build_error, tree) = cx.update(|cx| {
        let view = view.read(cx);
        (
            view.build_error().map(str::to_owned),
            view.snapshot().map(|snapshot| snapshot.debug_tree()),
        )
    });
    let shot = cx
        .capture_screenshot(window)
        .ok()
        .map(|shot| shot.into_raw());
    cx.update(|cx| {
        let _ = window.update(cx, |_, window, _| window.remove_window());
    });
    deep_app::chrome::force_dark(None);
    Drawn {
        refused: None,
        build_error,
        tree,
        shot,
    }
}

/// Whether the component `built` renders in a panel that imports `View` and `div` from `kit` and the rest from
/// `components`, in a window of `cx` in dark or light: `mount_panel` loads it, its script builds, its tree has
/// the component's node, and the window shows something other than gpui-shell's "Failed to render <component>"
/// stand-in, which it draws when a component fails to materialize (that failure reaches only a log, never
/// `build_error`). A container with nothing in it may draw nothing, so drawing nothing is no failure. It is
/// drawn as built and, if that fails, again with its `content` slot filled. `Err` says why the first way failed.
pub fn renders(
    cx: &mut HeadlessAppContext,
    runtime: &Rc<ShellRuntime>,
    scratch: &Path,
    kit: &str,
    components: &str,
    built: &crate::component_js::Built,
    dark: bool,
) -> Result<(), String> {
    let stand_in_text = format!("Failed to render {}", built.descriptor);
    let stand_in_dir = scratch.join("stand-in");
    write_panel(
        &stand_in_dir,
        &crate::component_js::plain_js(kit, &format!(".child(div().child({stand_in_text:?}))")),
    );
    let stand_in = draw(cx, runtime, &stand_in_dir, dark);
    let mut first = None;
    for (attempt, built) in [built, &crate::component_js::with_content(built)]
        .into_iter()
        .enumerate()
    {
        let dir = scratch.join(format!("attempt-{attempt}"));
        write_panel(&dir, &crate::component_js::panel_js(kit, components, built));
        let drawn = draw(cx, runtime, &dir, dark);
        let why = if let Some(refused) = drawn.refused {
            format!("mount_panel refused it: {refused}")
        } else if let Some(error) = drawn.build_error {
            format!("its script failed: {error}")
        } else if !drawn
            .tree
            .as_deref()
            .is_some_and(|tree| tree_names(tree, built.descriptor))
        {
            format!(
                "its tree has no {} node: {:?}",
                built.descriptor, drawn.tree
            )
        } else if drawn.shot.is_none() {
            "its window couldn't be captured".to_owned()
        } else if drawn.shot == stand_in.shot {
            format!("gpui-shell drew {stand_in_text:?} in its place")
        } else {
            return Ok(());
        };
        first.get_or_insert(why);
    }
    Err(first.unwrap_or_default())
}

/// Whether the debug tree has a node for `descriptor`: a line that starts, after its indent, with the name.
pub fn tree_names(tree: &str, descriptor: &str) -> bool {
    tree.lines().any(|line| {
        line.trim_start()
            .strip_prefix(descriptor)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
    })
}

/// Writes `main.js` into a new folder `dir`, with the kit's check icon at `icons/check.svg` for a component
/// whose path is relative to the panel's asset root.
pub fn write_panel(dir: &Path, main_js: &str) {
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir.join("icons")).expect("a scratch panel folder");
    std::fs::write(dir.join("main.js"), main_js).expect("main.js is written");
    let icon = gpui_kit::assets::Assets
        .load("icons/check.svg")
        .ok()
        .flatten()
        .expect("the kit carries icons/check.svg");
    std::fs::write(dir.join("icons/check.svg"), icon.as_ref()).expect("the icon is written");
}
