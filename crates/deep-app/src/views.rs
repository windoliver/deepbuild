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

use crate::{canvas, events::Inbox};

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
}

impl Panel for Shipped {
    fn panel_name(&self) -> &'static str {
        self.kind.name()
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

impl Render for Shipped {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let state = state();
        let open = state.inbox.open.len();
        let page = div()
            .id(ElementId::Name(format!("view:{}", self.kind.name()).into()))
            .size_full()
            .flex()
            .flex_col()
            .p_2()
            .text_xs()
            .text_color(rgb(0x111827));
        match self.kind {
            Kind::Sidebar => page
                .bg(rgb(0xf3f4f6))
                .child(title("sidebar-title", "Sessions"))
                .children(state.sessions.iter().enumerate().map(|(index, session)| {
                    let short: String = session.chars().take(8).collect();
                    let text = format!("Session {} · {short}", index + 1);
                    div()
                        .id(("sidebar-session", index))
                        .test_support()
                        .role(Role::Button)
                        .aria_label(text.clone())
                        .h(px(24.))
                        .px_1()
                        .flex()
                        .items_center()
                        .rounded_sm()
                        .hover(|style| style.bg(rgb(0xe5e7eb)))
                        .child(text)
                })),
            Kind::Home => page
                .child(title("home-title", "Home"))
                .child(label("home-needs-you", format!("{open} asks need you"))),
            Kind::NeedsYou => page.child(title("needs-you-title", "Needs you")).children(
                state.inbox.open.iter().enumerate().map(|(index, ask)| {
                    let folded = state.inbox.folded.contains(&ask.handle);
                    let later = state.inbox.later.contains(&ask.handle);
                    let held = state.held.as_deref() == Some(ask.handle.as_str());
                    label(("ask", index), ask.handle.clone())
                        .when(folded, |row| row.pl_4().text_color(rgb(0x6b7280)))
                        .when(later, |row| row.text_color(rgb(0x9ca3af)))
                        .when(held, |row| row.italic())
                }),
            ),
            Kind::Session => {
                let session = state.sessions.first().cloned().unwrap_or_default();
                let hours: Vec<f64> = state
                    .inbox
                    .open
                    .iter()
                    .filter(|ask| ask.session == session)
                    .map(|ask| (ask.deadline as f64 - state.now as f64) / 3_600_000.0)
                    .collect();
                let points = hours.len();
                page.child(title("session-title", format!("Session {session}")))
                    .child(
                        div()
                            .w(px(600.))
                            .h(px(200.))
                            .border_1()
                            .border_color(rgb(0xe5e7eb))
                            .child(
                                canvas::line("session-line", hours, rgb(0x2563eb).into())
                                    .size_full(),
                            ),
                    )
                    .child(label(
                        "session-line-label",
                        format!("Hours to each deadline: {points} points"),
                    ))
            }
            Kind::Line => page.bg(rgb(0xf9fafb)).child(label(
                "line-status",
                format!("{open} asks open · virtual clock {}", state.now),
            )),
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
        let dock = cx.new(|cx| DockArea::new("deepbuild", None, window, cx));
        dock.update(cx, |dock, cx| dock.load(layout.state(), window, cx))
            .expect("the layout loads");
        Self { dock }
    }
}

impl Render for Shell {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111827))
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
