//! Opening the app's shell in a window and reading its panels back.

use deep_app::views::{Layout, Shell};
use gpui_kit::base::dock::{DockArea, DockPlacement};
use gpui_kit::test::TestWindowExt as _;
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

/// Issue #326: the shell with the question card shown at `card`, and the sidebar's slot holding `panel`, a panel
/// package mounted past install, or, with none, the shipped sidebar. Answers the window and the slot's rect, in
/// window points. A panel that doesn't load leaves its slot empty.
pub fn open_with_card(
    cx: &mut App,
    card: Bounds<Pixels>,
    panel: Option<&std::path::Path>,
) -> (AnyWindowHandle, Bounds<Pixels>) {
    // The sidebar's slot clips whatever fills it: the panel, or the shipped sidebar.
    let layout = Layout {
        sidebar: deep_app::views::EXTENSION.into(),
        ..Layout::shipped("needs-you")
    };
    let (handle, _) = open_shell(&layout, cx, |window, cx| match panel {
        Some(dir) => {
            let runtime = deep_app::new_runtime().expect("the panel runtime");
            if let Ok(view) = deep_app::mount_panel(&runtime, dir, window, cx) {
                deep_app::open::place_extension(view.into(), cx);
            }
            // The runtime outlives the window, as the app's does: its mounted views keep their state.
            std::mem::forget(runtime);
        }
        None => deep_app::open::place_extension(
            deep_app::views::shipped(deep_app::views::Kind::Sidebar, cx),
            cx,
        ),
    });
    let question = deep_app::record::history()
        .iter()
        .find(|event| event["kind"] == "ask.created")
        .and_then(|ask| ask["data"]["question"].as_str())
        .map_or_else(|| "Nothing needs you.".into(), str::to_owned);
    handle
        .update(cx, |_, window, cx| {
            deep_app::card::present(card, &question, &["Yes", "No"], window, cx)
        })
        .expect("the shell window takes the card");
    handle
        .update(cx, |_, window, cx| window.render_frame(cx))
        .expect("the shell window draws");
    let slot = deep_app::views::slot_bounds().expect("the sidebar's slot was drawn");
    (handle, slot)
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

/// The ask handles a script view's rows are keyed by, top to bottom: every element in its published description
/// whose id is an `ask:<id>` handle (#1459). A handle drawn as text is no row, so a view draws its question.
///
/// This reads the description the script published, not pixels: gpui-shell's elements are not
/// gpui-base observed elements, so their drawn bounds and visibility are not readable headless at
/// this milestone, and a panel that keyed a hidden or zero-size element by a handle would
/// still count it as a row. The kit's planted faults are list faults, which this does catch.
pub fn rows_of(tree: &str) -> Vec<String> {
    keyed(tree, "ask:").into_iter().map(|(id, _)| id).collect()
}

/// The elements of a script view's description keyed by an id that starts with `prefix` and goes on in letters and
/// digits, top to bottom, each with the text drawn inside it, joined by spaces (#1459): `session:` for
/// `session.row@1`'s rows. Text alone is never a row.
pub fn keyed(tree: &str, prefix: &str) -> Vec<(String, String)> {
    let marker = format!(":id[Str(\"{prefix}");
    let lines: Vec<&str> = tree.lines().collect();
    let indent = |line: &str| line.len() - line.trim_start().len();
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("text "))
        .filter_map(|(at, line)| {
            let (_, rest) = line.split_once(&marker)?;
            let id: String = rest
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect();
            if id.is_empty() || !rest[id.len()..].starts_with('"') {
                return None;
            }
            let drawn: Vec<&str> = lines[at + 1..]
                .iter()
                .take_while(|inner| indent(inner) > indent(line))
                .filter_map(|inner| inner.trim_start().strip_prefix("text "))
                .map(|text| text.trim_matches('"'))
                .collect();
            Some((format!("{prefix}{id}"), drawn.join(" ")))
        })
        .collect()
}

/// The count each session's row shows, by the row's id (#2018): the text drawn inside the element keyed
/// `session:<id>:count`, where a view draws one.
pub fn counts_of(tree: &str) -> Vec<(String, String)> {
    let lines: Vec<&str> = tree.lines().collect();
    let indent = |line: &str| line.len() - line.trim_start().len();
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.trim_start().starts_with("text "))
        .filter_map(|(at, line)| {
            let (_, rest) = line.split_once(":id[Str(\"session:")?;
            let id: String = rest
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect();
            if id.is_empty() || !rest[id.len()..].starts_with(":count\"") {
                return None;
            }
            let drawn: Vec<&str> = lines[at + 1..]
                .iter()
                .take_while(|inner| indent(inner) > indent(line))
                .filter_map(|inner| inner.trim_start().strip_prefix("text "))
                .map(|text| text.trim_matches('"'))
                .collect();
            Some((format!("session:{id}"), drawn.join(" ")))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::rows_of;

    /// A row's count is the text inside the element keyed by the row's id and `:count`; the row itself is no count.
    #[test]
    fn a_count_is_read_from_the_element_keyed_for_it() {
        let tree = concat!(
            "v_flex\n  div :id[Str(\"session:01A\")]\n    text \"Cart totals\"\n",
            "    div :id[Str(\"session:01A:count\")]\n      text \"2\"\n",
            "  div :id[Str(\"session:02B\")]\n    text \"Notes\"\n",
        );
        assert_eq!(
            super::counts_of(tree),
            [("session:01A".to_owned(), "2".to_owned())]
        );
        assert_eq!(super::keyed(tree, "session:").len(), 2);
    }

    /// Rows are the elements keyed by a handle, in order; a handle drawn as text, or an id that isn't a handle, is none.
    #[test]
    fn rows_are_the_elements_keyed_by_handles_in_order() {
        let tree = concat!(
            "v_flex\n  text \"Needs you\"\n  text \"ask:01Z\"\n",
            "  div :id[Str(\"ask:01A\")] .h[Number(18.0)]\n    text \"First?\"\n",
            "  div :id[Str(\"row-2\")]\n",
            "  div :id[Str(\"ask:02B\")]\n    text \"Second?\"\n",
        );
        assert_eq!(rows_of(tree), ["ask:01A", "ask:02B"]);
    }

    /// A keyed row holds the text drawn inside it and none drawn after it.
    #[test]
    fn a_keyed_row_holds_the_text_inside_it() {
        let tree = concat!(
            "v_flex\n  div :id[Str(\"session:01A\")]\n    text \"Cart totals\"\n    div\n      text \"needs you\"\n",
            "  text \"after\"\n  div :id[Str(\"session:02B\")]\n",
        );
        assert_eq!(
            super::keyed(tree, "session:"),
            [
                ("session:01A".to_owned(), "Cart totals needs you".to_owned()),
                ("session:02B".to_owned(), String::new()),
            ]
        );
    }
}
