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

use crate::{bound, canvas, chrome, events::Inbox, states, states::READINGS, text};

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
    /// What Home's Set up click said, once clicked.
    set_up: Option<String>,
}

impl Shipped {
    pub fn new(kind: Kind, cx: &mut Context<Self>) -> Self {
        Self {
            kind,
            focus_handle: cx.focus_handle(),
            set_up: None,
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
        let slot = cx.new(|cx| Slot {
            view: NEXT_EXTENSION.with(|next| next.borrow_mut().take()),
            focus_handle: cx.focus_handle(),
        });
        SLOT.with(|current| *current.borrow_mut() = Some(slot.downgrade()));
        Arc::new(slot)
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
    static SLOT: RefCell<Option<WeakEntity<Slot>>> = const { RefCell::new(None) };
}

/// Puts `view` in the extension slot the shell drew last, in place of what it held: a view's page opened from ⌘K
/// (#366). False when no slot is drawn.
pub fn fill_slot(view: AnyView, cx: &mut App) -> bool {
    let Some(slot) = SLOT
        .with(|current| current.borrow().clone())
        .and_then(|slot| slot.upgrade())
    else {
        return false;
    };
    slot.update(cx, |slot, cx| {
        slot.view = Some(view);
        cx.notify();
    });
    true
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

/// What a view draws from the one record reader, read in its borrow so no event is copied to draw a frame, and only
/// what that view shows: its open asks, its sessions with their task's title and state, and the deadlines of the
/// first session's asks.
struct Record {
    /// Open asks, oldest first: `(handle, session)`.
    open: Vec<(String, String)>,
    /// The sessions the view shows, in the order each first appears, with its task's title and its state: every
    /// one for the sidebar, the first for a session's page and its line, none for the others.
    sessions: Vec<(String, String, states::State)>,
    /// The sidebar's rows (#992), one per session: its words after the title and the status-map entry its mark draws.
    rows: Vec<(String, &'static str)>,
    /// Each sidebar row's newest readings (#990), oldest first.
    readings: Vec<Vec<String>>,
    /// When each of the first session's open asks defaults, in event order: on a session's page only.
    deadlines: Vec<u64>,
}

/// What the sidebar draws: every session, in the order each first appears, with its task's title and its state.
pub fn sidebar() -> Vec<(String, String, states::State)> {
    record(Kind::Sidebar).sessions
}

fn record(kind: Kind) -> Record {
    crate::record::with_view(|view| read(view, kind))
        .unwrap_or_else(|| read(&crate::record::View::default(), kind))
}

/// What the view `kind` draws of `view`.
fn read(view: &crate::record::View, kind: Kind) -> Record {
    let open: Vec<(String, String)> = view
        .inbox
        .iter()
        .filter(|row| row["status"] != "closed")
        .map(|row| {
            let text = |key: &str| row[key].as_str().unwrap_or_default().to_owned();
            (text("ask"), text("session"))
        })
        .collect();
    let table = view.table();
    // A session's page and its line draw the first session, or the one named "" when the record has none.
    let sessions: Vec<(String, String, states::State)> = match kind {
        Kind::Sidebar => table.every_session(),
        Kind::Session | Kind::Line => {
            let session = table.sessions().first().cloned().unwrap_or_default();
            vec![(
                session.clone(),
                table.title(&session),
                table.state(&session),
            )]
        }
        Kind::Home | Kind::NeedsYou => Vec::new(),
    };
    let deadlines = match (kind, sessions.first()) {
        (Kind::Session, Some((first, ..))) => {
            let mine: Vec<&String> = open
                .iter()
                .filter(|(_, of)| of == first)
                .map(|(handle, _)| handle)
                .collect();
            table
                .open_asks(None)
                .into_iter()
                .filter(|ask| mine.contains(&&states::handle(ask)))
                .filter_map(|ask| table.deadline(ask))
                .collect()
        }
        _ => Vec::new(),
    };
    let rows = match kind {
        Kind::Sidebar => sessions
            .iter()
            .map(|(session, ..)| table.row(session, now()))
            .collect(),
        _ => Vec::new(),
    };
    let readings = match kind {
        Kind::Sidebar => sessions
            .iter()
            .map(|(session, ..)| table.readings(session).to_vec())
            .collect(),
        _ => Vec::new(),
    };
    Record {
        open,
        sessions,
        rows,
        readings,
        deadlines,
    }
}

/// The session a session's page and its line draw, with its task's title and state.
fn first(record: &Record) -> (String, String, states::State) {
    record.sessions[0].clone()
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
    marked(id, state.entry(), text)
}

/// A status mark for a status-map entry, and its words.
fn marked(id: impl Into<ElementId>, entry: &str, text: String) -> ObservedElement<Stateful<Div>> {
    let glyph = states::glyph(entry);
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
                .bg(rgb(states::color(entry))),
        )
        .child(glyph)
        .child(text)
}

/// The bound values on `surface`, one accessibility node each named by its surface, its ID and
/// what it shows: its ID, the value, and where it comes from, muted. A missing value shows the
/// dash and says it wasn't reported.
fn bound_values(
    surface: bound::Surface,
    chrome: &chrome::Chrome,
) -> Vec<ObservedElement<Stateful<Div>>> {
    bound::on(surface)
        .into_iter()
        .enumerate()
        .map(|(index, b)| {
            let id = ElementId::Name(format!("bound-{}-{index}", surface.name()).into());
            let said = match &b.missing {
                Some(_) => format!("{} · not reported", b.text),
                None => b.text.clone(),
            };
            div()
                .id(id)
                .test_support()
                .role(Role::Label)
                .aria_label(b.name())
                .h(px(ROW_HEIGHT))
                .flex()
                .items_center()
                .gap_2()
                .pl(px(CORE + 4.))
                .child(
                    div()
                        .w(px(64.))
                        .text_color(chrome.ink_secondary)
                        .child(b.id.clone()),
                )
                .child(text::label(
                    &format!("bound-{}-{index}-value", surface.name()),
                    text::Label {
                        bound: true,
                        ..text::Label::new(said)
                    },
                    chrome.ink_primary,
                    None,
                ))
                .child(div().text_color(chrome.ink_secondary).child(b.from))
        })
        .collect()
}

/// A panel in the window holding the bound values bound to it, when any are.
fn bound_panel(chrome: &chrome::Chrome) -> Option<Stateful<Div>> {
    let values = bound_values(bound::Surface::Panel, chrome);
    (!values.is_empty()).then(|| {
        div()
            .id("bound-panel")
            .mt_2()
            .w(px(600.))
            .p_2()
            .border_1()
            .border_color(chrome.divider)
            .flex()
            .flex_col()
            .child(label("bound-panel-title", "Cart total").font_weight(FontWeight::SEMIBOLD))
            .children(values)
    })
}

impl Render for Shipped {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        let decorations = current_state();
        // While setup hasn't finished, the count says so, never a number of asks (#1002). A view drawn over a fixture
        // state draws the fixture, whatever this machine's HOME holds.
        let unfinished = decorations.is_none().then(crate::setup::count).flatten();
        let record = record(self.kind);
        let reach = crate::notify::reach();
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
                .children(record.sessions.iter().zip(&record.rows).enumerate().map(
                    |(index, ((_, task, _), (words, entry)))| {
                        let text = format!("{task} · {words}");
                        // Its readings beside it (#990), a line each under the row, quieter than its state.
                        let readings = record.readings.get(index).cloned().unwrap_or_default();
                        div()
                            .flex()
                            .flex_col()
                            .child(
                                marked(("sidebar-session", index), entry, text)
                                    .role(Role::Button)
                                    .h(px(24.))
                                    .px_1()
                                    .rounded_sm()
                                    .hover(|style| style.bg(chrome.hover)),
                            )
                            .children(readings.into_iter().enumerate().map(|(n, reading)| {
                                // A reading wider than the sidebar ends in an ellipsis; its
                                // accessibility label keeps the whole of it. A block, not the
                                // label's flex row, so the text is laid out to the row's width
                                // and can truncate; its line height centers it in the row.
                                label(("sidebar-reading", index * READINGS + n), reading)
                                    .block()
                                    .h(px(18.))
                                    .line_height(px(18.))
                                    .pl_4()
                                    .text_color(chrome.ink_secondary)
                                    .truncate()
                            }))
                    },
                )),
            Kind::Home => match unfinished {
                Some(count) => page
                    .child(title("home-title", "Home"))
                    .child(label("home-needs-you", count))
                    .children(self.set_up.is_none().then(|| {
                        label("set-up", "Set up")
                            .role(Role::Button)
                            .aria_label("Set up")
                            // As the welcome draws it: ink on the ground, as wide as its word.
                            .self_start()
                            .my_1()
                            .px_4()
                            .rounded_md()
                            .bg(chrome.ink_primary)
                            .text_color(chrome.ground)
                            .hover(|style| style.bg(chrome.ink_secondary))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.set_up = Some(
                                    crate::setup::set_up()
                                        .map_or_else(|error| error, str::to_owned),
                                );
                                cx.notify();
                            }))
                    }))
                    .children(
                        self.set_up
                            .clone()
                            .or_else(crate::setup::reason)
                            .map(|line| label("set-up-reason", line).h_auto().py_1()),
                    ),
                None => page.child(title("home-title", "Home")).child(label(
                    "home-needs-you",
                    reach.count(format!("{open} asks need you")),
                )),
            },
            Kind::NeedsYou if unfinished.is_some() => page
                .child(title("needs-you-title", "Needs you"))
                .child(label("needs-you-setup", unfinished.unwrap_or_default())),
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
                    let text = if reach.not_notified(handle) {
                        format!("{handle} · not notified")
                    } else {
                        handle.clone()
                    };
                    label(("ask", index), text)
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
                let (session, task, state) = first(&record);
                let mine = record.open.iter().filter(|(_, of)| *of == session).count();
                let hours: Vec<f64> = record
                    .deadlines
                    .iter()
                    .map(|deadline| (*deadline as f64 - now as f64) / 3_600_000.0)
                    .collect();
                let points = hours.len();
                // The line's caption and its readout are the canvas's text (#390): the readout
                // is a bound number, tabular and never cut, holding its widest value's room.
                let caption = text::Label::new("Hours to each deadline");
                let readout = text::Label {
                    bound: true,
                    ..text::Label::new(mine.to_string())
                };
                page.child(title("session-title", format!("Session {session}")))
                    // The return card: what came back from the session's last stop, with the
                    // values bound to its runs' assertions (#629).
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(status(
                                "return-card",
                                &state,
                                format!("{task} returned · {}", state.text(now)),
                            ))
                            .children(bound_values(bound::Surface::Card, chrome)),
                    )
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
                    .children(bound_panel(chrome))
            }
            Kind::Line => {
                // The session's line: from its task to where it stands now.
                let (_, task, state) = first(&record);
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

/// The window's root: the dock area, loaded from a layout, and ⌘K over it once views give it entries (#366).
pub struct Shell {
    pub dock: Entity<DockArea>,
    commands: Option<Entity<crate::commands::Palette>>,
    focus_handle: FocusHandle,
}

impl Shell {
    pub fn new(layout: &Layout, window: &mut Window, cx: &mut Context<Self>) -> Self {
        chrome::follow(window, cx);
        let dock = cx.new(|cx| DockArea::new("deepbuild", None, window, cx));
        dock.update(cx, |dock, cx| dock.load(layout.state(), window, cx))
            .expect("the layout loads");
        Self {
            dock,
            commands: None,
            focus_handle: cx.focus_handle(),
        }
    }

    /// ⌘K over the shell, which takes focus so the key reaches it wherever you are in the window.
    pub fn set_commands(
        &mut self,
        palette: Entity<crate::commands::Palette>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.commands = Some(palette);
        window.focus(&self.focus_handle, cx);
        cx.notify();
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        div()
            .size_full()
            .relative()
            .track_focus(&self.focus_handle)
            .on_action(
                cx.listener(|this, _: &crate::commands::OpenCommands, window, cx| {
                    if let Some(palette) = &this.commands {
                        let back = this.focus_handle.clone();
                        palette.update(cx, |palette, cx| palette.show(back, window, cx));
                    }
                }),
            )
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .text_sm()
            .child(self.dock.clone())
            .children(self.commands.clone())
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
