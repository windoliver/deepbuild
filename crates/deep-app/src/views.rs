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

use std::{cell::Cell, cell::RefCell, rc::Rc, sync::Arc, time::Duration};

use gpui_kit::base::dock::{
    register_panel, DockArea, DockAreaState, DockPlacement, DockState, Panel, PanelEvent,
    PanelInfo, PanelState,
};
use gpui_kit::base::ObservedElement;
use gpui_kit::component::TitleBar;
use gpui_kit::{prelude::FluentBuilder as _, *};

use serde_json::json;

use crate::{
    bound, brand, canvas, cells, chrome, events::Inbox, show::CanvasPanel, states,
    states::READINGS, text,
};

pub const SIDEBAR: &str = "deepbuild/sidebar";
pub const HOME: &str = "deepbuild/home";
pub const NEEDS_YOU: &str = "deepbuild/needs-you";
pub const SESSION: &str = "deepbuild/session";
pub const LINE: &str = "deepbuild/line";
pub const WELCOME: &str = "deepbuild/welcome";

/// The shipped views a replica snapshots, by the ids the record uses.
pub const SHIPPED_VIEWS: [&str; 3] = ["needs-you", "sidebar", "session"];

/// The window the app opens at, in points.
pub const OPENING: (f32, f32) = (960., 640.);
pub const SIDEBAR_WIDTH: f32 = 260.;
/// The height an installed view gets in the sidebar, below the sessions.
const PLACED_HEIGHT: f32 = 160.;
pub const LINE_HEIGHT: f32 = 120.;
const ROW_HEIGHT: f32 = 18.;
/// A status mark's colored core, in points: at least the look's `core_min_px`.
const CORE: f32 = 6.;
/// The panel the hub's canvas core knows a session's page by.
const SESSION_PAGE: &str = "session-page";
/// How often an open terminal tab reads its grid again.
const TERMINAL_TICK: Duration = Duration::from_millis(250);

/// What a replica's fixture panels read through `deepbuild.needs_you`, and its virtual clock: the inbox projection at
/// a log position. The replica, the live capture and the registry checks set it before opening the shell. No view
/// reads it: every view draws the record through the one reader, with the same tree in the app and in a replica
/// (#1454). `held` stays here alone because the hub records no event for a hold yet.
#[derive(Clone, Debug)]
pub struct AppState {
    pub inbox: Inbox,
    pub now: u64,
    pub sessions: Vec<String>,
    pub held: Option<String>,
}

thread_local! {
    static STATE: RefCell<Option<Rc<AppState>>> = const { RefCell::new(None) };
    /// The virtual clock, where one runs (a replica).
    static CLOCK: Cell<Option<u64>> = const { Cell::new(None) };
}

/// A replica's state and clock. Its record stands for a machine that's set up, whatever this HOME holds.
pub fn set_state(state: AppState) {
    CLOCK.with(|clock| clock.set(Some(state.now)));
    crate::setup::assume_finished();
    STATE.with(|cell| *cell.borrow_mut() = Some(Rc::new(state)));
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
    Welcome,
}

impl Kind {
    pub const ALL: [Kind; 6] = [
        Kind::Sidebar,
        Kind::Home,
        Kind::NeedsYou,
        Kind::Session,
        Kind::Line,
        Kind::Welcome,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Kind::Sidebar => SIDEBAR,
            Kind::Home => HOME,
            Kind::NeedsYou => NEEDS_YOU,
            Kind::Session => SESSION,
            Kind::Line => LINE,
            Kind::Welcome => WELCOME,
        }
    }
}

thread_local! {
    /// The session the page and the line draw: the one you clicked, else the first.
    static OPENED: RefCell<Option<String>> = const { RefCell::new(None) };
    /// The view popped out into a window of its own.
    static POPPED: Cell<Option<Kind>> = const { Cell::new(None) };
    /// The shell's dock, which a click shows a panel in.
    static DOCK: RefCell<Option<WeakEntity<DockArea>>> = const { RefCell::new(None) };
    /// The views you installed that draw inside a shipped view, by area (#1454).
    static PLACED: RefCell<Vec<(String, AnyView)>> = const { RefCell::new(Vec::new()) };
    /// The app's canvas panel, on a session's page (#1454).
    static CANVAS: RefCell<Option<Entity<CanvasPanel>>> = const { RefCell::new(None) };
}

/// Gives a session's page the canvas panel.
pub fn set_canvas(panel: Entity<CanvasPanel>) {
    CANVAS.with(|canvas| *canvas.borrow_mut() = Some(panel));
}

/// Puts an installed view in its area: the sidebar, home or the line draw it inside them, and a tab is the center's.
pub fn place(area: &str, view: AnyView, window: &mut Window, cx: &mut App) {
    if area == "tab" {
        add_tab(view, window, cx);
    } else {
        PLACED.with(|placed| placed.borrow_mut().push((area.to_owned(), view)));
    }
}

/// The views placed in `area`, each clipped to a box of its own.
fn placed(area: &str) -> Vec<AnyView> {
    PLACED.with(|placed| {
        placed
            .borrow()
            .iter()
            .filter(|(of, _)| of == area)
            .map(|(_, view)| view.clone())
            .collect()
    })
}

/// A box a placed view can't draw out of.
fn placed_box(view: AnyView) -> Div {
    div()
        .relative()
        .overflow_hidden()
        .w_full()
        .flex_none()
        .h(px(PLACED_HEIGHT))
        .child(view)
}

/// A new tab in the center holding `view`, which the slot's later pages replace.
fn add_tab(view: AnyView, window: &mut Window, cx: &mut App) {
    let Some(dock) = DOCK.with(|dock| dock.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    let slot = cx.new(|cx| Slot {
        view: Some(view),
        focus_handle: cx.focus_handle(),
        page: true,
    });
    SLOT.with(|current| *current.borrow_mut() = Some(slot.downgrade()));
    dock.update(cx, |dock, cx| {
        dock.add_panel(slot, DockPlacement::Center, None, window, cx)
    });
}

/// A page from ⌘K in the page region: the tab that holds pages, made if none is there yet (#1454).
pub fn open_page(view: AnyView, window: &mut Window, cx: &mut App) {
    if !fill_slot(view.clone(), cx) {
        add_tab(view, window, cx);
    }
    show(EXTENSION, window, cx);
    window.refresh();
}

/// The session a page's Terminal tab shows, and what the hub's canvas core last gave for it.
struct TerminalTab {
    session: String,
    screen: Option<cells::Screen>,
    /// What the tab says when the hub hosts no terminal for the session.
    words: String,
    _poll: Task<()>,
}

/// One shipped view, drawn as a dock panel.
pub struct Shipped {
    kind: Kind,
    focus_handle: FocusHandle,
    /// What Home's Set up click said, once clicked.
    set_up: Option<String>,
    terminal: Option<TerminalTab>,
    /// Whether this is the view's own window, not its panel in the shell.
    popped: bool,
}

impl Shipped {
    pub fn new(kind: Kind, cx: &mut Context<Self>) -> Self {
        Self {
            kind,
            focus_handle: cx.focus_handle(),
            set_up: None,
            terminal: None,
            popped: false,
        }
    }

    /// Opens the Terminal tab of `session`'s page on what the hub's canvas core holds for it.
    fn open_terminal(&mut self, session: String, cx: &mut Context<Self>) {
        let call = |call| crate::record::call("canvas.user", json!({ "call": call }));
        let page = call(json!({"call": "session_page", "session": session, "panel": SESSION_PAGE}));
        let tab = call(json!({"call": "tab", "session": session, "tab": "terminal"}));
        let words = tab
            .as_ref()
            .and_then(|tab| tab["drawn"][0]["text"].as_str())
            .filter(|_| page.is_some())
            .map_or("No terminal in this session.".to_owned(), str::to_owned);
        let poll = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(TERMINAL_TICK).await;
            if this.update(cx, |this, cx| this.read_terminal(cx)).is_err() {
                return;
            }
        });
        self.terminal = Some(TerminalTab {
            session,
            screen: None,
            words,
            _poll: poll,
        });
        self.read_terminal(cx);
    }

    /// Reads the open tab's grid; a new revision draws.
    fn read_terminal(&mut self, cx: &mut Context<Self>) {
        let Some(tab) = self.terminal.as_mut() else {
            return;
        };
        let call = json!({"call": {"call": "cells", "session": tab.session, "tab": "terminal"}});
        let screen = crate::record::call("canvas.user", call)
            .as_ref()
            .and_then(cells::Screen::from_reply);
        let revision = |screen: &Option<cells::Screen>| screen.as_ref().map(|s| s.revision);
        if revision(&screen) != revision(&tab.screen) {
            tab.screen = screen;
            cx.notify();
        }
    }
}

/// Shows a shipped panel in the center, for ⌘K.
pub fn show_panel(name: &str, window: &mut Window, cx: &mut App) {
    show(name, window, cx);
    window.refresh();
}

/// Shows the panel named `name` in the shell's center.
fn show(name: &str, window: &mut Window, cx: &mut App) {
    let Some(dock) = DOCK.with(|dock| dock.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    let panel = dock
        .read(cx)
        .layout(DockPlacement::Center)
        .into_iter()
        .flat_map(|tree| tree.panels().collect::<Vec<_>>())
        .find(|id| {
            let panel = dock.read(cx).panel(*id);
            panel.is_some_and(|panel| panel.panel_name(cx) == name)
        });
    if let Some(panel) = panel {
        dock.update(cx, |dock, cx| dock.select_panel(panel, window, cx));
    }
}

/// A click on a session's row in the sidebar: its page in the center, and its line.
fn open_session(session: &str, window: &mut Window, cx: &mut App) {
    OPENED.with(|opened| *opened.borrow_mut() = Some(session.to_owned()));
    show(SESSION, window, cx);
    window.refresh();
}

/// Pops `kind` out into a window of its own: its panel in the shell gives up its place, and takes it back when that
/// window closes.
fn pop_out(kind: Kind, cx: &mut App) {
    POPPED.with(|popped| popped.set(Some(kind)));
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::centered(size(px(640.), px(640.)), cx)),
        ..Default::default()
    };
    let opened = gpui_kit::open_window(options, cx, move |window, cx| {
        window.on_window_should_close(cx, |_, cx| {
            POPPED.with(|popped| popped.set(None));
            cx.refresh_windows();
            true
        });
        cx.new(|cx| Shipped {
            popped: true,
            ..Shipped::new(kind, cx)
        })
    });
    if opened.is_err() {
        POPPED.with(|popped| popped.set(None));
    }
    cx.refresh_windows();
}

/// The count as the window says it: the menu bar's line, in words.
pub fn count_line() -> String {
    let reach = crate::notify::reach();
    if crate::setup::count().is_some() || !(reach.hub_down || crate::record::connected()) {
        return crate::menu_bar_line();
    }
    reach.count(match count() {
        1 => "1 ask needs you".to_owned(),
        count => format!("{count} asks need you"),
    })
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
            page: false,
        });
        SLOT.with(|current| *current.borrow_mut() = Some(slot.downgrade()));
        Arc::new(slot)
    });
}

impl Panel for Shipped {
    fn panel_name(&self) -> &'static str {
        self.kind.name()
    }

    /// A view popped out leaves the shell: the dock draws the next panel in its place (#1172).
    fn visible(&self, _: &App) -> bool {
        self.popped || POPPED.with(Cell::get) != Some(self.kind)
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
    /// Whether it fills the page region, where a view sits inset as a shipped page does.
    page: bool,
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
            .when(self.page, |slot| slot.p_2())
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
    /// Open asks, oldest first: `(handle, session, question, status)`.
    open: Vec<(String, String, String, String)>,
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

/// The one count, as the record the views draw stands: the window and the menu bar both read it (#1172).
pub fn count() -> usize {
    crate::record::with_view(|view| states::count(&view.table())).unwrap_or(0)
}

fn record(kind: Kind) -> Record {
    crate::record::with_view(|view| read(view, kind))
        .unwrap_or_else(|| read(&crate::record::View::default(), kind))
}

/// What the view `kind` draws of `view`.
fn read(view: &crate::record::View, kind: Kind) -> Record {
    let open: Vec<(String, String, String, String)> = view
        .inbox
        .iter()
        .filter(|row| row["status"] != "closed")
        .map(|row| {
            let text = |key: &str| row[key].as_str().unwrap_or_default().to_owned();
            (
                text("ask"),
                text("session"),
                text("question"),
                text("status"),
            )
        })
        .collect();
    let table = view.table();
    // A session's page and its line draw the first session, or the one named "" when the record has none.
    let sessions: Vec<(String, String, states::State)> = match kind {
        Kind::Sidebar => table.every_session(),
        Kind::Session | Kind::Line => {
            let opened = OPENED.with(|opened| opened.borrow().clone());
            let session = opened
                .filter(|session| table.sessions().contains(session))
                .or_else(|| table.sessions().first().cloned())
                .unwrap_or_default();
            vec![(
                session.clone(),
                table.title(&session),
                table.state(&session),
            )]
        }
        Kind::Home | Kind::NeedsYou | Kind::Welcome => Vec::new(),
    };
    let deadlines = match (kind, sessions.first()) {
        (Kind::Session, Some((first, ..))) => {
            let mine: Vec<&String> = open
                .iter()
                .filter(|(_, of, ..)| of == first)
                .map(|(handle, ..)| handle)
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
    CLOCK.with(Cell::get).unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64)
    })
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
        // While setup hasn't finished, the count says so, never a number of asks (#1002).
        let unfinished = crate::setup::count();
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
                // The window's count, which shows Needs you.
                .child(
                    label("sidebar-count", count_line())
                        .role(Role::Button)
                        .h(px(24.))
                        .px_1()
                        .rounded_sm()
                        .hover(|style| style.bg(chrome.hover))
                        .on_click(|_, window, cx| show(NEEDS_YOU, window, cx)),
                )
                .children(placed("sidebar").into_iter().map(placed_box))
                .children(record.sessions.iter().zip(&record.rows).enumerate().map(
                    |(index, ((session, task, _), (words, entry)))| {
                        let text = format!("{task} · {words}");
                        let session = session.clone();
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
                                    .hover(|style| style.bg(chrome.hover))
                                    .on_click(move |_, window, cx| {
                                        open_session(&session, window, cx)
                                    }),
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
                None => page
                    .child(title("home-title", "Home"))
                    .child(label(
                        "home-needs-you",
                        reach.count(format!("{open} asks need you")),
                    ))
                    .children(placed("home").into_iter().map(placed_box)),
            },
            Kind::NeedsYou if unfinished.is_some() => page
                .child(title("needs-you-title", "Needs you"))
                .child(label("needs-you-setup", unfinished.unwrap_or_default())),
            Kind::NeedsYou => {
                page.child(title("needs-you-title", "Needs you"))
                    .children(record.open.iter().enumerate().map(
                        |(index, (handle, _, question, status))| {
                            let ask = handle.clone();
                            // The planted row shows the handle.
                            let text = if cfg!(feature = "plant-handle-rows") {
                                handle
                            } else {
                                question
                            };
                            let shown = if reach.not_notified(handle) {
                                format!("{text} · not notified")
                            } else {
                                text.clone()
                            };
                            // The row reads as its question, on the screen and to a screen reader; its handle is nowhere (#1172).
                            label(("ask", index), shown)
                                .role(Role::Button)
                                .rounded_sm()
                                .hover(|style| style.bg(chrome.hover))
                                .on_click(move |_, window, cx| {
                                    crate::card::present_ask(&ask, window, cx)
                                })
                                .when(status == "folded", |row| {
                                    row.pl_4().text_color(chrome.ink_secondary)
                                })
                                .when(status == "later", |row| row.text_color(chrome.ink_tertiary))
                                .when(status == "held", |row| row.italic())
                        },
                    ))
                    // Below the rows, so a screen reader and a keyboard reach the asks first.
                    .children((!self.popped).then(|| {
                        label("needs-you-pop-out", "Pop out")
                            .role(Role::Button)
                            .aria_label("Pop out Needs you")
                            .self_start()
                            .px_1()
                            .rounded_sm()
                            .text_color(chrome.ink_secondary)
                            .hover(|style| style.bg(chrome.hover))
                            .on_click(|_, _, cx| pop_out(Kind::NeedsYou, cx))
                    }))
            }
            Kind::Session => {
                let (session, task, state) = first(&record);
                let mine = record
                    .open
                    .iter()
                    .filter(|(_, of, ..)| *of == session)
                    .count();
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
                let terminal = self.terminal.as_ref().filter(|tab| tab.session == session);
                let tab = (!session.is_empty()).then(|| {
                    let session = session.clone();
                    label("session-terminal", "Terminal")
                        .role(Role::Button)
                        .self_start()
                        .px_1()
                        .rounded_sm()
                        .text_color(chrome.ink_secondary)
                        .hover(|style| style.bg(chrome.hover))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.open_terminal(session.clone(), cx);
                        }))
                });
                let grid = terminal.map(|tab| terminal_view(tab, chrome));
                // The session's canvas, in the place of its deadlines' line (#1454).
                let figure = CANVAS
                    .with(|canvas| canvas.borrow().clone())
                    .filter(|panel| panel.read(cx).shows(&session));
                if let Some(panel) = &figure {
                    panel.update(cx, |panel, _| panel.show_session(&session));
                }
                let chart = terminal.is_none() && figure.is_none();
                page.child(title("session-title", task.clone()))
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
                    .children(tab)
                    .children(grid)
                    .children(figure.map(|panel| div().flex_1().min_h_0().w_full().child(panel)))
                    .when(chart, |page| {
                        page.child(
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
                    })
                    .children(bound_panel(chrome))
            }
            Kind::Welcome => {
                let said = self.set_up.as_deref();
                let (ground, ink) = (chrome.ground, chrome.ink_primary);
                let button = (said.is_none() && crate::setup::needed()).then(|| {
                    div()
                        .id("set-up")
                        .test_support()
                        .role(Role::Button)
                        .aria_label("Set up")
                        .px_4()
                        .py_1()
                        .rounded_md()
                        .bg(ink)
                        .text_color(ground)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.set_up = Some(
                                crate::setup::set_up().map_or_else(|error| error, str::to_owned),
                            );
                            cx.notify();
                        }))
                        .child("Set up")
                });
                page.child(
                    div()
                        .id("welcome")
                        .test_support()
                        .size_full()
                        .flex()
                        .flex_col()
                        .items_center()
                        .justify_center()
                        .gap_6()
                        .bg(ground)
                        .text_sm()
                        .text_color(ink)
                        .child(
                            svg()
                                .data(brand::WELCOME_LOCKUP)
                                .w(px(brand::WELCOME_LOCKUP_WIDTH_PX))
                                .h(px(brand::WELCOME_LOCKUP_HEIGHT_PX))
                                .text_color(ink),
                        )
                        .child(div().child("Where your agents show, not tell."))
                        .children(button)
                        .children(said.map(|line| div().child(line.to_owned())))
                        .children(said.is_none().then(crate::setup::reason).flatten().map(
                            |line| {
                                div()
                                    .id("set-up-reason")
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_label(line.clone())
                                    // A long path in the reason wraps inside the window, so its fix stays in view.
                                    .max_w(px(560.))
                                    .text_center()
                                    .child(line)
                            },
                        )),
                )
            }
            Kind::Line => {
                // The session's line: from its task to where it stands now.
                let (_, task, state) = first(&record);
                page.bg(chrome.raised)
                    .child(status(
                        "line-status",
                        &state,
                        format!("{task} · {}", state.text(now)),
                    ))
                    .children(placed("line"))
            }
        }
    }
}

/// A session's Terminal tab: its rows through the cell grid, or the line saying where it runs.
fn terminal_view(tab: &TerminalTab, chrome: &chrome::Chrome) -> AnyElement {
    let Some(screen) = tab.screen.clone() else {
        return label("terminal-words", tab.words.clone()).into_any_element();
    };
    // The planted tab writes its rows with the chrome's text, outside the grid.
    if cfg!(feature = "plant-tab-text") {
        return div()
            .id("terminal-text")
            .text_color(chrome.ink_primary)
            .children(screen.rows.into_iter().map(|row| div().child(row.text)))
            .into_any_element();
    }
    cells::cells("terminal", screen)
        .flex_none()
        .into_any_element()
}

/// The title bar with the mark, the small cut, drawn 24 px with the D at 18 px: the kit's Ink on the light bar, the
/// look's ink on the dark one. In dark the bar takes the look's colors, so it can't stay light under a pale mark.
pub fn title_bar(window: &Window) -> TitleBar {
    let dark = chrome::is_dark(window);
    let chrome = chrome::of(window);
    let ink = if dark {
        chrome.ink_primary
    } else {
        rgb(brand::INK).into()
    };
    let bar = TitleBar::new();
    let bar = if dark {
        bar.bg(chrome.raised).border_color(chrome.divider)
    } else {
        bar
    };
    bar.child(
        div()
            .id("title-bar-mark")
            .test_support()
            .flex()
            .items_center()
            .child(
                svg()
                    .data(brand::TITLE_BAR_MARK)
                    .size(px(brand::TITLE_BAR_MARK_PX))
                    .text_color(ink),
            ),
    )
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
    /// The app's shell with `needs-you`, `session` or `home` showing, so a replica draws the app's tree (#1454);
    /// `sidebar`, the replica's view of the sidebar, shows home beside it. Any other name is a mistake, not a view.
    pub fn shipped(view: &str) -> Self {
        let active = match view {
            "needs-you" => NEEDS_YOU,
            "session" => SESSION,
            "home" | "sidebar" => HOME,
            other => {
                panic!("{other} is not a shipped view; the shipped views are {SHIPPED_VIEWS:?} and home")
            }
        };
        let center: Vec<String> = [NEEDS_YOU, SESSION, HOME].map(str::to_owned).into();
        Self {
            sidebar: SIDEBAR.into(),
            active: center.iter().position(|name| name == active).unwrap_or(0),
            center,
            line: LINE.into(),
        }
    }

    /// The app's shell (#1172): Needs you, the session's page and home in the center, with the welcome pane first
    /// while setup hasn't finished, or a mounted panel's view first.
    pub fn app(panel: bool) -> Self {
        let mut center: Vec<String> = [NEEDS_YOU, SESSION, HOME].map(str::to_owned).into();
        if panel {
            center.insert(0, EXTENSION.into());
        } else if crate::setup::needed() {
            center.insert(0, WELCOME.into());
        }
        Self {
            sidebar: SIDEBAR.into(),
            center,
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
    /// Whether the shell draws the window's title bar, as the app's does.
    title_bar: bool,
}

impl Shell {
    pub fn new(layout: &Layout, window: &mut Window, cx: &mut Context<Self>) -> Self {
        chrome::follow(window, cx);
        let dock = cx.new(|cx| DockArea::new("deepbuild", None, window, cx));
        dock.update(cx, |dock, cx| dock.load(layout.state(), window, cx))
            .expect("the layout loads");
        DOCK.with(|cell| *cell.borrow_mut() = Some(dock.downgrade()));
        Self {
            dock,
            commands: None,
            focus_handle: cx.focus_handle(),
            title_bar: false,
        }
    }

    /// The window's own title bar with the mark over the shell, so the window owns the bar's drag.
    pub fn with_title_bar(mut self) -> Self {
        self.title_bar = true;
        self
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
            .flex()
            .flex_col()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .text_sm()
            .children(self.title_bar.then(|| title_bar(window)))
            .child(div().flex_1().min_h_0().w_full().child(self.dock.clone()))
            .children(self.commands.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn a_shipped_view_shows_in_the_apps_center_and_the_sidebar_view_shows_home() {
        let showing = |view| {
            let layout = Layout::shipped(view);
            layout.center[layout.active].clone()
        };
        assert_eq!(showing("needs-you"), NEEDS_YOU);
        assert_eq!(showing("session"), SESSION);
        assert_eq!(showing("sidebar"), HOME);
        assert_eq!(showing("home"), HOME);
    }

    #[std::prelude::v1::test]
    #[should_panic(expected = "is not a shipped view")]
    fn a_name_that_is_not_a_shipped_view_is_refused() {
        Layout::shipped("needs_you");
    }
}
