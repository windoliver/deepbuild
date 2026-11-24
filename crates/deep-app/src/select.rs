//! Issue #1498: select and copy the text the window draws (canvas primitives: Selection, "Text selects too"). Each
//! kind of text selects through its own owner, and ⌘C copies the selection you made last:
//!
//! - content the app draws with the kit, such as a check's failure line, through the kit's window-scoped selection,
//!   outlined and never filled ([`Outlined`]); labels, rows and buttons don't select;
//! - a document's text on a session's page and a session's terminal grid, through the hub's canvas core, which holds
//!   their selection and answers ⌘C with its text.
//!
//! The clipboard write needs a gesture serial. ⌘C goes to the core's input router, which gives one only to your
//! hardware input ([`crate::trusted_input::input_from_hardware`]), and nothing is written without one. The app sends
//! the core your input, never a selection's text.

use std::cell::RefCell;
use std::ops::Range;

use gpui_kit::base::input::Copy;
use gpui_kit::base::{
    TextSelection, TextSelectionHandle, TextSelectionRegistration, TextSelectionRun,
};
use gpui_kit::*;
use serde_json::{json, Value};

/// A surface whose selection the core holds: a session page's documents, or its terminal grid.
#[derive(Clone, Debug, PartialEq)]
pub enum Surface {
    Page(String),
    Grid(String),
}

thread_local! {
    /// The core's surface you last pressed on.
    static PRESSED: RefCell<Option<Surface>> = const { RefCell::new(None) };
}

/// ⌘C, and the Edit menu's Copy, copy the selection, where a text field doesn't hold the keys. ⌘C is taken before any
/// binding: the window root's own would write the kit's selection with no serial. With nothing selected the key goes
/// on, as a data table's copy of its rows takes it.
pub fn init(cx: &mut App) {
    cx.intercept_keystrokes(|event, window, cx| {
        let (key, m) = (&event.keystroke.key, event.keystroke.modifiers);
        if key != "c" || !m.platform || m.shift || m.alt || m.control {
            return;
        }
        if event.context_stack.iter().any(|c| c.contains("Input")) {
            return;
        }
        if copy(crate::trusted_input::input_from_hardware(), window, cx) {
            cx.stop_propagation();
        }
    })
    .detach();
    cx.on_action(|_: &Copy, cx: &mut App| {
        // Judged as the key is delivered; the copy runs once the window is free.
        let hid = crate::trusted_input::input_from_hardware();
        let Some(window) = cx.active_window().or_else(|| cx.windows().first().copied()) else {
            return;
        };
        cx.defer(move |cx| {
            let _ = window.update(cx, |_, window, cx| {
                copy(hid, window, cx);
            });
        });
    });
}

/// One of your inputs to the core's surface `on`, as the canvas core's `input` call takes it: its reply.
pub fn input(on: &Surface, event: Value) -> Option<Value> {
    if event["type"] == "down" {
        PRESSED.with(|p| *p.borrow_mut() = Some(on.clone()));
    }
    let hid = crate::trusted_input::input_from_hardware();
    call(Some(on), event, hid)
}

/// The core's `input` call: an event on a surface, or on none, which only the router reads; `hid` when it is your
/// hardware's.
fn call(on: Option<&Surface>, event: Value, hid: bool) -> Option<Value> {
    let mut call = json!({"call": "input", "event": event, "hid": hid});
    match on {
        Some(Surface::Page(session)) => {
            call["panel"] = json!(crate::views::SESSION_PAGE);
            call["session"] = json!(session);
        }
        Some(Surface::Grid(session)) => {
            call["session"] = json!(session);
            call["tab"] = json!("terminal");
        }
        None => {}
    }
    crate::record::call("canvas.user", json!({ "call": call }))
}

/// ⌘C: the kit's selection when it holds one, else what the core surface you pressed last holds, written to the
/// clipboard only when the router gives the key a gesture serial. False when neither holds anything.
fn copy(hid: bool, window: &mut Window, cx: &mut App) -> bool {
    let key = json!({"type": "key", "key": "c", "mods": ["cmd"]});
    let kit = TextSelection::selected_text(window, cx);
    let pressed = PRESSED
        .with(|p| p.borrow().clone())
        .filter(|_| kit.is_empty());
    if kit.is_empty() && pressed.is_none() {
        return false;
    }
    let Some(reply) = call(pressed.as_ref(), key, hid) else {
        return true;
    };
    let text = match pressed {
        Some(_) => reply["copy"].as_str().map(str::to_owned),
        None => Some(kit),
    };
    if let (Some(_), Some(text)) = (reply["serial"].as_u64(), text.filter(|t| !t.is_empty())) {
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }
    true
}

/// #1498: your pointer on session `session`'s terminal grid, `size` cells, as the cell under it: to the core, which
/// sends it to the program while it asks for the mouse, and otherwise selects cells. `pressing` says whether your press
/// on the grid is down. The selection's outline the core answers with, each row's `[from, row, to]`.
pub(crate) fn grid(
    (kind, at, count): (&str, Point<Pixels>, usize),
    session: &str,
    (cols, rows): (u16, usize),
    pressing: &mut bool,
) -> Option<Vec<[u16; 3]>> {
    let drawn = crate::cells::terminal_at()?;
    match kind {
        "down" if drawn.contains(&at) => *pressing = true,
        "down" => return None,
        _ if !*pressing => return None,
        "up" => *pressing = false,
        _ => {}
    }
    let one = crate::cells::grid(1., 1.);
    let cell = |v: Pixels, from: Pixels, side: Pixels, n: usize| {
        ((f32::from(v - from) / f32::from(side)).floor().max(0.) as usize).min(n.saturating_sub(1))
    };
    let x = cell(at.x, drawn.origin.x, one.width, usize::from(cols));
    let y = cell(at.y, drawn.origin.y, one.height, rows);
    let event = json!({"type": kind, "cell": [x, y], "count": count});
    let reply = input(&Surface::Grid(session.to_owned()), event)?;
    let outline = reply["outline"].as_array()?.iter().filter_map(|r| {
        let n = |i: usize| u16::try_from(r.get(i)?.as_u64()?).ok();
        Some([n(0)?, n(1)?, n(2)?])
    });
    Some(outline.collect())
}

/// #1498: the selected cells, outlined over the grid in `color`, a row's run at a time.
pub(crate) fn grid_outline(outline: &[[u16; 3]], color: Hsla) -> Vec<Div> {
    outline
        .iter()
        .map(|&[from, y, to]| {
            let at = crate::cells::grid(f32::from(from), f32::from(y));
            let size = crate::cells::grid(f32::from(to - from + 1), 1.);
            div()
                .absolute()
                .left(at.width)
                .top(at.height)
                .w(size.width)
                .h(size.height)
                .border(crate::chrome::sizes().hairline)
                .border_color(color)
        })
        .collect()
}

/// A press anywhere but on the core's surfaces, whose own presses come after it: no core surface holds the
/// selection ⌘C copies.
pub fn pressed_elsewhere() {
    PRESSED.with(|p| *p.borrow_mut() = None);
}

// What follows is gpui-kit's `SelectableText` (crates/base/src/selectable_text.rs at the pinned revision), changed to
// outline the selection instead of filling it.
// Copyright 2024 - 2026 Longbridge <https://longbridge.com>. Licensed under the Apache License, Version 2.0; you may
// not use this file except in compliance with the License. You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND,
// either express or implied. See the License for the specific language governing permissions and limitations under
// the License.

/// Content text the kit's window-scoped selection selects, its selection outlined, never filled.
pub struct Outlined {
    id: ElementId,
    text: SharedString,
    styled_text: StyledText,
    color: Hsla,
}

impl Outlined {
    pub fn new(id: impl Into<ElementId>, text: impl Into<SharedString>, color: Hsla) -> Self {
        let text = text.into();
        Outlined {
            id: id.into(),
            styled_text: StyledText::new(text.clone()),
            text,
            color,
        }
    }

    /// Where its text is laid out, once it is: ⌘F marks its match there (#1815).
    pub(crate) fn layout(&self) -> TextLayout {
        self.styled_text.layout().clone()
    }
}

/// The boxes a range from `start` to `end` takes, a line tall each, inside `bounds`.
fn selection_bounds(
    start: Point<Pixels>,
    end: Point<Pixels>,
    bounds: Bounds<Pixels>,
    line_height: Pixels,
) -> Vec<Bounds<Pixels>> {
    if start.y == end.y {
        return vec![Bounds::from_corners(
            start,
            Point::new(end.x, end.y + line_height),
        )];
    }
    let mut quads = vec![Bounds::from_corners(
        start,
        Point::new(bounds.right(), start.y + line_height),
    )];
    if end.y > start.y + line_height {
        quads.push(Bounds::from_corners(
            Point::new(bounds.left(), start.y + line_height),
            Point::new(bounds.right(), end.y),
        ));
    }
    quads.push(Bounds::from_corners(
        Point::new(bounds.left(), end.y),
        Point::new(end.x, end.y + line_height),
    ));
    quads
}

pub(crate) fn outline(layout: &TextLayout, range: Range<usize>, color: Hsla, window: &mut Window) {
    let (Some(start), Some(end)) = (
        layout.position_for_index(range.start),
        layout.position_for_index(range.end),
    ) else {
        return;
    };
    for bounds in selection_bounds(start, end, layout.bounds(), layout.line_height()) {
        window.paint_quad(quad(
            bounds,
            px(0.),
            transparent_black(),
            crate::chrome::sizes().hairline,
            color,
            BorderStyle::Solid,
        ));
    }
}

impl IntoElement for Outlined {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for Outlined {
    type RequestLayoutState = TextSelectionHandle;
    type PrepaintState = Hitbox;

    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let handle = window.with_element_state(
            global_id.expect("Outlined has an element id"),
            |kept: Option<TextSelectionHandle>, _| {
                let handle =
                    kept.unwrap_or_else(|| TextSelectionHandle::new(self.text.clone(), cx));
                (handle.clone(), handle)
            },
        );
        let (layout_id, ()) = self
            .styled_text
            .request_layout(global_id, inspector_id, window, cx);
        (layout_id, handle)
    }

    fn prepaint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.styled_text
            .prepaint(global_id, inspector_id, bounds, &mut (), window, cx);
        let hitbox = window.insert_hitbox(bounds, HitboxBehavior::Normal);
        let registration = TextSelectionRegistration::new(hitbox.clone(), bounds)
            .with_text_bounds(vec![bounds])
            .with_rendered_element(handle, window, cx);
        handle.register(registration, window, cx);
        hitbox
    }

    fn paint(
        &mut self,
        global_id: Option<&GlobalElementId>,
        inspector_id: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        handle: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let layout = self.styled_text.layout().clone();
        let before = TextSelection::selected_text(window, cx);
        let projection = handle.update_runs(
            &[TextSelectionRun::new(
                self.text.clone(),
                layout.clone(),
                bounds,
            )],
            cx,
        );
        if before != TextSelection::selected_text(window, cx) {
            window.refresh();
        }
        for range in projection.ranges().iter().flatten().cloned() {
            outline(&layout, range, self.color, window);
        }
        self.styled_text.paint(
            global_id,
            inspector_id,
            bounds,
            &mut (),
            &mut (),
            window,
            cx,
        );
    }
}
