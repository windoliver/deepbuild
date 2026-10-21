//! Opening the app's shell in a window and reading its panels back.

use deep_app::views::{Layout, Shell};
use gpui_kit::base::dock::{DockArea, DockPlacement};
use gpui_kit::*;
use gpui_shell::{dock::ScriptPanel, ScriptView};

use crate::WINDOW;

pub fn window_size() -> Size<Pixels> {
    size(px(WINDOW.0), px(WINDOW.1))
}

/// The reference window: its size in points at the given scale is the snapshot's frame.
pub fn window_options() -> WindowOptions {
    WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: window_size(),
        })),
        titlebar: None,
        focus: false,
        show: false,
        ..Default::default()
    }
}

/// Opens the shell on a layout. `mount` runs in the window first, so a script that registers
/// panels is loaded before the layout names them.
pub fn open_shell(
    layout: &Layout,
    cx: &mut App,
    mount: impl FnOnce(&mut Window, &mut App),
) -> (AnyWindowHandle, Entity<Shell>) {
    open_shell_with(window_options(), layout, cx, mount)
}

pub fn open_shell_with(
    options: WindowOptions,
    layout: &Layout,
    cx: &mut App,
    mount: impl FnOnce(&mut Window, &mut App),
) -> (AnyWindowHandle, Entity<Shell>) {
    gpui_kit::open_window(options, cx, |window, cx| {
        mount(window, cx);
        cx.new(|cx| Shell::new(layout, window, cx))
    })
    .expect("the shell window opens")
}

/// The panels in one region, in tree order, by name.
pub fn panel_names(dock: &DockArea, placement: DockPlacement, cx: &App) -> Vec<&'static str> {
    dock.layout(placement)
        .map(|tree| {
            tree.panels()
                .filter_map(|id| dock.panel(id))
                .map(|panel| panel.panel_name(cx))
                .collect()
        })
        .unwrap_or_default()
}

/// The script panel named `name`, wherever the dock holds it.
pub fn script_panel(dock: &DockArea, name: &str, cx: &App) -> Option<Entity<ScriptPanel>> {
    [
        DockPlacement::Center,
        DockPlacement::Left,
        DockPlacement::Right,
        DockPlacement::Bottom,
    ]
    .into_iter()
    .filter_map(|placement| dock.layout(placement))
    .flat_map(|tree| tree.panels().collect::<Vec<_>>())
    .filter_map(|id| dock.panel(id))
    .find(|panel| panel.panel_name(cx) == name)
    .and_then(|panel| {
        panel
            .as_any()
            .downcast_ref::<Entity<ScriptPanel>>()
            .cloned()
    })
}

/// What a drawn script view described, as text.
pub fn script_tree(view: &ScriptView) -> String {
    assert_eq!(view.build_error(), None, "the script failed to build");
    view.snapshot()
        .expect("a drawn script view has a snapshot")
        .debug_tree()
}

/// The ask handles a script view described, top to bottom: every text node in its published
/// description whose whole text is an `ask:<id>` handle. An element's id is not a row.
///
/// This reads the description the script published, not pixels: gpui-shell's elements are not
/// gpui-base observed elements, so their drawn bounds and visibility are not readable headless at
/// this milestone, and a panel that described a handle inside a hidden or zero-size element would
/// still count it as a row. The kit's planted faults are list faults, which this does catch.
pub fn rows_of(tree: &str) -> Vec<String> {
    tree.lines()
        .filter_map(|line| {
            line.trim_start()
                .strip_prefix("text \"ask:")
                .and_then(|rest| rest.strip_suffix('"'))
                .filter(|id| {
                    id.chars()
                        .all(|character| character.is_ascii_alphanumeric())
                })
                .map(|id| format!("ask:{id}"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::rows_of;

    #[test]
    fn rows_are_the_quoted_handles_in_order() {
        let tree = "v_flex\n  text \"Needs you\"\n  text \"ask:01A\"\n  div id=\"ask:x\" x\n  text \"ask:02B\"\n";
        assert_eq!(rows_of(tree), ["ask:01A", "ask:02B"]);
    }
}
