//! Issue #338: the app's shell and its shipped views as dock panels.
//!
//! The shell is one gpui-base `DockArea`: the sidebar in the left dock, the line in the bottom
//! dock, and Needs you, home or a session page in the center. Every view is a panel the dock
//! rebuilds by name through gpui-base's panel registry, which is the registry gpui-shell's
//! `DockArea.register_panel` fills for scripts, so a layout can name a script panel in any slot
//! and the same load path draws it there.
//!
//! Every element with an accessibility role also carries an id and `.test_support()`, so the
//! accessibility tree a screen reader sees and the observed elements a replica reads back are
//! the same set of nodes.

use std::{cell::RefCell, rc::Rc, sync::Arc};

use gpui_kit::base::dock::{
    register_panel, DockArea, DockAreaState, DockPlacement, DockState, Panel, PanelEvent,
    PanelInfo, PanelState,
};
use gpui_kit::base::ObservedElement;
use gpui_kit::{prelude::FluentBuilder as _, *};

use serde_json::Value;

use crate::{canvas, chrome, events::Inbox, states, text};

pub const SIDEBAR: &str = "deepbuild/sidebar";
pub const HOME: &str = "deepbuild/home";
pub const NEEDS_YOU: &str = "deepbuild/needs-you";
pub const SESSION: &str = "deepbuild/session";
pub const LINE: &str = "deepbuild/line";

/// The shipped views a replica snapshots, by the ids the record uses.
pub const SHIPPED_VIEWS: [&str; 3] = ["needs-you", "sidebar", "session"];

pub const SIDEBAR_WIDTH: f32 = 260.;
pub const LINE_HEIGHT: f32 = 120.;
const ROW_HEIGHT: f32 = 18.;
/// A status mark's colored core, in points: at least the look's `core_min_px`.
const CORE: f32 = 6.;

/// What the views draw: the inbox projection at a log position on the virtual clock. The replica,
/// the live capture and the registry checks set it before opening the shell; the shipped app's
/// root is still #337's window, and the shell becomes its root when the panel host lands.
#[derive(Clone, Debug)]
pub struct AppState {
    pub inbox: Inbox,
    pub now: u64,
    pub sessions: Vec<String>,
    pub held: Option<String>,
}

thread_local! {
    static STATE: RefCell<Option<Rc<AppState>>> = const { RefCell::new(None) };
}

pub fn set_state(state: AppState) {
    STATE.with(|cell| *cell.borrow_mut() = Some(Rc::new(state)));
}

/// The state the views draw; set it before the first frame.
pub fn state() -> Rc<AppState> {
    current_state().expect("deep_app::views::set_state runs before a view is drawn")
}

pub fn current_state() -> Option<Rc<AppState>> {
    STATE.with(|cell| cell.borrow().clone())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Sidebar,
    Home,
    NeedsYou,
    Session,
    Line,
}

impl Kind {
    pub const ALL: [Kind; 5] = [
        Kind::Sidebar,
        Kind::Home,
        Kind::NeedsYou,
        Kind::Session,
        Kind::Line,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Kind::Sidebar => SIDEBAR,
            Kind::Home => HOME,
            Kind::NeedsYou => NEEDS_YOU,
            Kind::Session => SESSION,
            Kind::Line => LINE,
        }
    }
}

/// One shipped view, drawn as a dock panel.
pub struct Shipped {
    kind: Kind,
    focus_handle: FocusHandle,
}

impl Shipped {
    pub fn new(kind: Kind, cx: &mut Context<Self>) -> Self {
        Self {
            kind,
            focus_handle: cx.focus_handle(),
        }
    }
}

/// Teaches the panel registry every shipped view, so a layout can name them.
pub fn register_views(cx: &mut App) {
    for kind in Kind::ALL {
        register_panel(cx, kind.name(), move |_, _, cx| {
            Arc::new(cx.new(|cx| Shipped::new(kind, cx)))
        });
    }
    register_panel(cx, EXTENSION, |_, _, cx| {
        Arc::new(cx.new(|cx| Slot {
            view: NEXT_EXTENSION.with(|next| next.borrow_mut().take()),
            focus_handle: cx.focus_handle(),
        }))
    });
}

impl Panel for Shipped {
    fn panel_name(&self) -> &'static str {
        self.kind.name()
    }
}

/// The slot an extension's view fills in place of a shipped one (#326). It clips what the view paints to the
/// slot, so a view whose layout outgrows its slot, or that positions a child outside it, draws nothing past it.
pub const EXTENSION: &str = "deepbuild/extension";

thread_local! {
    static NEXT_EXTENSION: RefCell<Option<AnyView>> = const { RefCell::new(None) };
    static SLOT_BOUNDS: std::cell::Cell<Option<Bounds<Pixels>>> = const { std::cell::Cell::new(None) };
}

/// Hands the next layout that names [`EXTENSION`] its view.
pub fn place_extension(view: AnyView) {
    NEXT_EXTENSION.with(|next| *next.borrow_mut() = Some(view));
}

/// Where the extension slot was last drawn, in window points.
pub fn slot_bounds() -> Option<Bounds<Pixels>> {
    SLOT_BOUNDS.with(std::cell::Cell::get)
}

/// A shipped view, for a slot.
pub fn shipped(kind: Kind, cx: &mut App) -> AnyView {
    cx.new(|cx| Shipped::new(kind, cx)).into()
}

pub struct Slot {
    view: Option<AnyView>,
    focus_handle: FocusHandle,
}

impl Panel for Slot {
    fn panel_name(&self) -> &'static str {
        EXTENSION
    }
}

impl EventEmitter<PanelEvent> for Slot {}

impl Focusable for Slot {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for Slot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .relative()
            .overflow_hidden()
            .child(
                canvas(
                    |bounds, _, _| SLOT_BOUNDS.with(|slot| slot.set(Some(bounds))),
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .children(self.view.clone())
    }
}

impl EventEmitter<PanelEvent> for Shipped {}

impl Focusable for Shipped {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

/// A line of text that is one accessibility node: a label named by its text.
fn label(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    let text = text.into();
    div()
        .id(id)
        .test_support()
        .role(Role::Label)
        .aria_label(text.clone())
        .h(px(ROW_HEIGHT))
        .flex()
        .items_center()
        .child(text)
}

fn title(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    label(id, text)
        .h(px(32.))
        .text_base()
        .font_weight(FontWeight::SEMIBOLD)
}

/// What the views draw from the one record reader: its events, its open asks and its sessions.
struct Record {
    events: Vec<Value>,
    /// Open asks, oldest first: `(handle, session)`.
    open: Vec<(String, String)>,
    sessions: Vec<String>,
}

fn record() -> Record {
    crate::record::with_view(|view| Record {
        events: view.events.clone(),
        open: view
            .inbox
            .iter()
            .filter(|row| row["status"] != "closed")
            .map(|row| {
                let text = |key: &str| row[key].as_str().unwrap_or_default().to_owned();
                (text("ask"), text("session"))
            })
            .collect(),
        sessions: states::sessions(&view.events),
    })
    .unwrap_or(Record {
        events: Vec::new(),
        open: Vec::new(),
        sessions: Vec::new(),
    })
}

/// The virtual clock's time where one runs (the replica), else the system's.
pub fn now() -> u64 {
    current_state().map_or_else(
        || {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64)
        },
        |state| state.now,
    )
}

/// A session's status mark and words, one accessibility node named by what it shows: the mark's core, a square of
/// the look's status color with square corners, then its glyph and the words in the text's color.
fn status(
    id: impl Into<ElementId>,
    state: &states::State,
    text: String,
) -> ObservedElement<Stateful<Div>> {
    let glyph = states::glyph(state.entry());
    let name = format!("{glyph} {text}");
    div()
        .id(id)
        .test_support()
        .role(Role::Label)
        .aria_label(name)
        .h(px(ROW_HEIGHT))
        .flex()
        .items_center()
        .gap_1()
        .child(
            div()
                .size(px(CORE))
                .flex_none()
                .bg(rgb(states::color(state.entry()))),
        )
        .child(glyph)
        .child(text)
}

impl Render for Shipped {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        let decorations = current_state();
        let record = record();
        let now = now();
        let open = record.open.len();
        let page = div()
            .id(ElementId::Name(format!("view:{}", self.kind.name()).into()))
            .size_full()
            .flex()
            .flex_col()
            .p_2()
            .text_xs()
            .text_color(chrome.ink_primary);
        match self.kind {
            Kind::Sidebar => page
                .bg(chrome.raised)
                .child(title("sidebar-title", "Sessions"))
                .children(record.sessions.iter().enumerate().map(|(index, session)| {
                    let state = states::state(&record.events, session);
                    let text = format!(
                        "{} · {}",
                        states::title(&record.events, session),
                        state.text(now)
                    );
                    status(("sidebar-session", index), &state, text)
                        .role(Role::Button)
                        .h(px(24.))
                        .px_1()
                        .rounded_sm()
                        .hover(|style| style.bg(chrome.hover))
                })),
            Kind::Home => page
                .child(title("home-title", "Home"))
                .child(label("home-needs-you", format!("{open} asks need you"))),
            Kind::NeedsYou => page.child(title("needs-you-title", "Needs you")).children(
                record.open.iter().enumerate().map(|(index, (handle, _))| {
                    let has = |list: fn(&AppState) -> &Vec<String>| {
                        decorations
                            .as_ref()
                            .is_some_and(|state| list(state).contains(handle))
                    };
                    let held = decorations
                        .as_ref()
                        .is_some_and(|state| state.held.as_deref() == Some(handle.as_str()));
                    label(("ask", index), handle.clone())
                        .when(has(|state| &state.inbox.folded), |row| {
                            row.pl_4().text_color(chrome.ink_secondary)
                        })
                        .when(has(|state| &state.inbox.later), |row| {
                            row.text_color(chrome.ink_tertiary)
                        })
                        .when(held, |row| row.italic())
                }),
            ),
            Kind::Session => {
                let session = record.sessions.first().cloned().unwrap_or_default();
                let mine: Vec<&String> = record
                    .open
                    .iter()
                    .filter(|(_, of)| *of == session)
                    .map(|(handle, _)| handle)
                    .collect();
                let hours: Vec<f64> = record
                    .events
                    .iter()
                    .filter(|event| mine.contains(&&states::handle(event)))
                    .filter_map(|ask| states::deadline(&record.events, ask))
                    .map(|deadline| (deadline as f64 - now as f64) / 3_600_000.0)
                    .collect();
                let points = hours.len();
                let state = states::state(&record.events, &session);
                let task = states::title(&record.events, &session);
                // The line's caption and its readout are the canvas's text (#390): the readout
                // is a bound number, tabular and never cut, holding its widest value's room.
                let caption = text::Label::new("Hours to each deadline");
                let readout = text::Label {
                    bound: true,
                    ..text::Label::new(mine.len().to_string())
                };
                page.child(title("session-title", format!("Session {session}")))
                    // The return card: what came back from the session's last stop.
                    .child(status(
                        "return-card",
                        &state,
                        format!("{task} returned · {}", state.text(now)),
                    ))
                    .child(
                        div()
                            .w(px(600.))
                            .h(px(200.))
                            .border_1()
                            .border_color(chrome.divider)
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .flex()
                                    .justify_between()
                                    .px(px(8.))
                                    .py(px(4.))
                                    .child(text::label(
                                        "session-caption",
                                        caption,
                                        chrome.ink_secondary,
                                        None,
                                    ))
                                    .child(text::label(
                                        "session-readout",
                                        readout,
                                        chrome.session_readout,
                                        Some("9999"),
                                    )),
                            )
                            .child(
                                canvas::line("session-line", hours, chrome.session_line)
                                    .flex_1()
                                    .w_full(),
                            ),
                    )
                    .child(label(
                        "session-line-label",
                        format!("Hours to each deadline: {points} points"),
                    ))
            }
            Kind::Line => {
                // The session's line: from its task to where it stands now.
                let session = record.sessions.first().cloned().unwrap_or_default();
                let state = states::state(&record.events, &session);
                let task = states::title(&record.events, &session);
                page.bg(chrome.raised).child(status(
                    "line-status",
                    &state,
                    format!("{task} · {}", state.text(now)),
                ))
            }
        }
    }
}

/// Which panel fills each slot of the shell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    pub sidebar: String,
    /// The center's tabs, by panel name; `active` is drawn.
    pub center: Vec<String>,
    pub active: usize,
    pub line: String,
}

impl Layout {
    /// The shipped shell with `needs-you`, `session` or `home` in the center; `sidebar`, the
    /// replica's view of the sidebar, shows home beside it. Any other name is a mistake, not a
    /// view.
    pub fn shipped(view: &str) -> Self {
        let center = match view {
            "needs-you" => NEEDS_YOU,
            "session" => SESSION,
            "home" | "sidebar" => HOME,
            other => {
                panic!("{other} is not a shipped view; the shipped views are {SHIPPED_VIEWS:?} and home")
            }
        };
        Self {
            sidebar: SIDEBAR.into(),
            center: vec![center.into()],
            active: 0,
            line: LINE.into(),
        }
    }

    pub fn state(&self) -> DockAreaState {
        let tabs = |names: &[String], active: usize| PanelState {
            panel_name: "TabPanel".into(),
            children: names.iter().map(PanelState::new).collect(),
            info: PanelInfo::tabs(active),
        };
        DockAreaState {
            version: None,
            center: tabs(&self.center, self.active),
            left_dock: Some(DockState::new(
                tabs(std::slice::from_ref(&self.sidebar), 0),
                DockPlacement::Left,
                px(SIDEBAR_WIDTH),
                true,
            )),
            right_dock: None,
            bottom_dock: Some(DockState::new(
                tabs(std::slice::from_ref(&self.line), 0),
                DockPlacement::Bottom,
                px(LINE_HEIGHT),
                true,
            )),
        }
    }
}

/// The window's root: the dock area, loaded from a layout.
pub struct Shell {
    pub dock: Entity<DockArea>,
}

impl Shell {
    pub fn new(layout: &Layout, window: &mut Window, cx: &mut Context<Self>) -> Self {
        chrome::follow(window, cx);
        let dock = cx.new(|cx| DockArea::new("deepbuild", None, window, cx));
        dock.update(cx, |dock, cx| dock.load(layout.state(), window, cx))
            .expect("the layout loads");
        Self { dock }
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        div()
            .size_full()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .text_sm()
            .child(self.dock.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn a_shipped_view_fills_the_center_and_the_sidebar_view_shows_home() {
        assert_eq!(Layout::shipped("needs-you").center, [NEEDS_YOU]);
        assert_eq!(Layout::shipped("session").center, [SESSION]);
        assert_eq!(Layout::shipped("sidebar").center, [HOME]);
        assert_eq!(Layout::shipped("home").center, [HOME]);
    }

    #[std::prelude::v1::test]
    #[should_panic(expected = "is not a shipped view")]
    fn a_name_that_is_not_a_shipped_view_is_refused() {
        Layout::shipped("needs_you");
    }
}
