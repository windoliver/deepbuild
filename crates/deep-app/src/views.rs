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

use std::{cell::Cell, cell::RefCell, rc::Rc, sync::mpsc::TryRecvError, sync::Arc, time::Duration};

use gpui_kit::base::dock::{
    register_panel, DockArea, DockAreaState, DockPlacement, DockState, Panel, PanelEvent,
    PanelInfo, PanelState,
};
use gpui_kit::base::ObservedElement;
use gpui_kit::component::TitleBar;
use gpui_kit::{prelude::FluentBuilder as _, *};

use serde_json::json;

use crate::{bound, brand, canvas, cells, chrome, events::Inbox, states, states::READINGS, text};

pub const SIDEBAR: &str = "deepbuild/sidebar";
pub const HOME: &str = "deepbuild/home";
pub const NEEDS_YOU: &str = "deepbuild/needs-you";
pub const SESSION: &str = "deepbuild/session";
pub const LINE: &str = "deepbuild/line";
pub const WELCOME: &str = "deepbuild/welcome";
/// Issue #148: each agent's MCP servers and skills, the agents each is synced to, and a sync's per-file diff to approve.
pub const AGENTS: &str = "deepbuild/agents";
/// The rules page (#344): every rule you wrote, with its file, scope, size and what enforces it.
pub const RULES: &str = "deepbuild/rules";

/// The shipped views a replica snapshots, by the ids the record uses.
pub const SHIPPED_VIEWS: [&str; 3] = ["needs-you", "sidebar", "session"];

pub const SIDEBAR_WIDTH: f32 = 260.;
pub const LINE_HEIGHT: f32 = 120.;
const ROW_HEIGHT: f32 = 18.;
/// A status mark's colored core, in points: at least the look's `core_min_px`.
const CORE: f32 = 6.;
/// How much of its text the row planted to cut off draws, short enough to fit in any sidebar.
#[cfg(feature = "plant-row")]
const CUT_TO: usize = 24;
/// The panel the hub's canvas core knows a session's page by.
const SESSION_PAGE: &str = "session-page";
/// How often an open terminal tab reads its grid again.
const TERMINAL_TICK: Duration = Duration::from_millis(250);
/// How often the window looks for what setup said, while it runs (#1556).
const SET_UP_TICK: Duration = Duration::from_millis(50);
/// What the window says in place of Set up while setup runs.
pub const SETTING_UP: &str = "Setting up…";
/// How often the Agents page reads the hub's model again.
const AGENTS_TICK: Duration = Duration::from_secs(2);
/// The diff lines the Agents page shows of each file, and the width a line is cut to, in points.
const DIFF_LINES: usize = 8;
const DIFF_WIDTH: f32 = 1060.;
/// The most lines a sidebar row's problem draws under it (#1348): its one plain line, or a planted trace's.
const PROBLEM_LINES: usize = 16;

/// What the views draw over a fixture record: the inbox projection at a log position on the virtual clock. The
/// replica, the live capture and the registry checks set it before opening the shell; the app sets none, so its
/// views draw the hub's record through the one reader.
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
    Welcome,
    Agents,
    Rules,
}

impl Kind {
    pub const ALL: [Kind; 8] = [
        Kind::Sidebar,
        Kind::Home,
        Kind::NeedsYou,
        Kind::Session,
        Kind::Line,
        Kind::Welcome,
        Kind::Agents,
        Kind::Rules,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Kind::Sidebar => SIDEBAR,
            Kind::Home => HOME,
            Kind::NeedsYou => NEEDS_YOU,
            Kind::Session => SESSION,
            Kind::Line => LINE,
            Kind::Welcome => WELCOME,
            Kind::Agents => AGENTS,
            Kind::Rules => RULES,
        }
    }
}

/// #124's wrong session rows, for the UI check to name: in a replica only, with the `plant-row` feature.
#[cfg(feature = "plant-row")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RowPlant {
    /// Draws its text whole, past its frame.
    PastFrame,
    /// Draws its text cut off, and names only what it drew.
    CutOff,
}

#[cfg(feature = "plant-row")]
thread_local! {
    static ROW_PLANT: Cell<Option<RowPlant>> = const { Cell::new(None) };
}

#[cfg(feature = "plant-row")]
pub fn plant_row(plant: Option<RowPlant>) {
    ROW_PLANT.with(|row| row.set(plant));
}

thread_local! {
    /// The session the page and the line draw: the one you clicked, else the first.
    static OPENED: RefCell<Option<String>> = const { RefCell::new(None) };
    /// The view popped out into a window of its own.
    static POPPED: Cell<Option<Kind>> = const { Cell::new(None) };
    /// The shell's dock, which a click shows a panel in.
    static DOCK: RefCell<Option<WeakEntity<DockArea>>> = const { RefCell::new(None) };
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
    /// The wait for what setup says, while it runs off the UI thread (#1556).
    setting_up: Option<Task<()>>,
    /// The sidebar's open session and the one keyboard focus is on (#1003).
    rows: SidebarRows,
    /// The rows, by index, the replica opens the sidebar with: read at its first frame, when the sidebar also
    /// takes keyboard focus if one is focused.
    start: Option<(Option<usize>, Option<usize>)>,
    terminal: Option<TerminalTab>,
    /// Whether this is the view's own window, not its panel in the shell.
    popped: bool,
    /// The Agents page's model, as the hub last gave it (`agents.read`), and the sync whose diff it shows.
    agents: Option<serde_json::Value>,
    reviewing: Option<String>,
    _agents_poll: Option<Task<()>>,
}

/// The sidebar's open session, drawn in the selected fill with a bar at its leading edge, and the one keyboard focus
/// is on, drawn with the focus ring (#1003). Each is a session, not a row, so a row that moves keeps them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SidebarRows {
    pub selected: Option<String>,
    pub focused: Option<String>,
}

impl SidebarRows {
    /// `key` over the sidebar's `sessions` in their order: up and down move the focus ring a row, return or space
    /// opens the focused session. Whether it changed anything.
    pub fn key(&mut self, key: &str, sessions: &[String]) -> bool {
        let Some(last) = sessions.len().checked_sub(1) else {
            return false;
        };
        let at = self
            .focused
            .as_ref()
            .and_then(|f| sessions.iter().position(|s| s == f));
        let to = match key {
            "down" => at.map_or(0, |i| (i + 1).min(last)),
            "up" => at.map_or(0, |i| i.saturating_sub(1)),
            "enter" | "space" if at.is_some() => {
                let changed = self.selected != self.focused;
                self.selected = self.focused.clone();
                return changed;
            }
            _ => return false,
        };
        let changed = at != Some(to);
        self.focused = Some(sessions[to].clone());
        changed
    }
}

thread_local! {
    static SIDEBAR_ROWS: std::cell::Cell<(Option<usize>, Option<usize>)> = const { std::cell::Cell::new((None, None)) };
}

/// The sidebar's selected and focused rows as the next sidebar opens with them, for the replica (#1003).
pub fn start_sidebar(selected: Option<usize>, focused: Option<usize>) {
    SIDEBAR_ROWS.with(|rows| rows.set((selected, focused)));
}

impl Shipped {
    pub fn new(kind: Kind, cx: &mut Context<Self>) -> Self {
        // The Agents page reads the hub's model while it is open.
        let poll = (kind == Kind::Agents).then(|| {
            cx.spawn(async move |this, cx| loop {
                if this.update(cx, |this, cx| this.read_agents(cx)).is_err() {
                    return;
                }
                cx.background_executor().timer(AGENTS_TICK).await;
            })
        });
        Self {
            kind,
            focus_handle: cx.focus_handle(),
            set_up: None,
            setting_up: None,
            rows: SidebarRows::default(),
            start: (kind == Kind::Sidebar).then(|| SIDEBAR_ROWS.with(std::cell::Cell::get)),
            terminal: None,
            popped: false,
            agents: None,
            reviewing: None,
            _agents_poll: poll,
        }
    }

    /// Reads the Agents page's model; a changed one draws.
    fn read_agents(&mut self, cx: &mut Context<Self>) {
        let page = crate::record::call("agents.read", json!({}));
        if page.is_some() && page != self.agents {
            self.agents = page;
            cx.notify();
        }
    }

    /// The Set up click: setup runs on a thread of its own (#1556), the window says it's working, and a tick on the UI
    /// thread picks up what it said.
    fn start_set_up(&mut self, cx: &mut Context<Self>) {
        let heard = crate::setup::start();
        self.setting_up = Some(cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(SET_UP_TICK).await;
            let said = match heard.try_recv() {
                Ok(said) => said.map_or_else(|error| error, str::to_owned),
                Err(TryRecvError::Empty) => continue,
                Err(TryRecvError::Disconnected) => "deep setup stopped without a word".to_owned(),
            };
            let _ = this.update(cx, |this, cx| {
                this.set_up = Some(said);
                this.setting_up = None;
                cx.notify();
            });
            return;
        }));
        cx.notify();
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
    /// Open asks, oldest first: `(handle, session, question)`.
    open: Vec<(String, String, String)>,
    /// The sessions the view shows, in the order each first appears, with its task's title and its state: every
    /// one for the sidebar, the first for a session's page and its line, none for the others.
    sessions: Vec<(String, String, states::State)>,
    /// The sidebar's rows (#992), one per session: its words after the title and the status-map entry its mark draws.
    rows: Vec<(String, &'static str)>,
    /// Each sidebar row's newest readings (#990), oldest first.
    readings: Vec<Vec<String>>,
    /// When each of the first session's open asks defaults, in event order: on a session's page only.
    deadlines: Vec<u64>,
    /// Each sidebar row's problem in plain words (#1348): what happened, then what happens next.
    problems: Vec<Option<String>>,
    /// What a session's page shows by its real names (#1348): the session, its issue and branch, and its newest
    /// run's failure whole, its trace included. On a session's page only.
    details: Vec<String>,
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
    let open: Vec<(String, String, String)> = view
        .inbox
        .iter()
        .filter(|row| row["status"] != "closed")
        .map(|row| {
            let text = |key: &str| row[key].as_str().unwrap_or_default().to_owned();
            (text("ask"), text("session"), text("question"))
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
        Kind::Home | Kind::NeedsYou | Kind::Welcome | Kind::Agents | Kind::Rules => Vec::new(),
    };
    let deadlines = match (kind, sessions.first()) {
        (Kind::Session, Some((first, ..))) => {
            let mine: Vec<&String> = open
                .iter()
                .filter(|(_, of, _)| of == first)
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
    let problems = match kind {
        Kind::Sidebar => sessions
            .iter()
            .map(|(session, ..)| {
                let problem = crate::plain::problem(&table, session);
                let problem = problem.map(|(happened, next)| format!("{happened} {next}"));
                // The planted page shows the failure's trace in the row, in a test build only.
                match table.failure(session) {
                    Some(failure) if crate::plain::planted("page-shows-trace") => {
                        Some([problem.unwrap_or_default(), failure.to_owned()].join("\n"))
                    }
                    _ => problem,
                }
            })
            .collect(),
        _ => Vec::new(),
    };
    let details = match (kind, sessions.first()) {
        (Kind::Session, Some((session, ..))) => {
            let mut details = table.names(session);
            details.extend(
                table
                    .failure(session)
                    .into_iter()
                    .flat_map(str::lines)
                    .map(str::to_owned),
            );
            if crate::plain::planted("session-page-line-pr") {
                details.push(crate::plain::PLANTED_PR_LINE.to_owned());
            }
            details
        }
        _ => Vec::new(),
    };
    Record {
        open,
        sessions,
        rows,
        readings,
        deadlines,
        problems,
        details,
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
    #[cfg(feature = "plant-row")]
    let text = match ROW_PLANT.get() {
        Some(RowPlant::CutOff) if text.chars().count() > CUT_TO => {
            format!("{}…", text.chars().take(CUT_TO).collect::<String>())
        }
        _ => text,
    };
    let name = format!("{glyph} {text}");
    // Past the row's width the text ends in an ellipsis; the row's name keeps the whole of it.
    let words = div().flex_1().min_w_0().truncate();
    #[cfg(feature = "plant-row")]
    let words = if ROW_PLANT.get() == Some(RowPlant::PastFrame) {
        div().flex_none()
    } else {
        words
    };
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
        .child(words.child(text))
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
            Kind::Sidebar => {
                let ids: Vec<String> = record.sessions.iter().map(|(id, ..)| id.clone()).collect();
                if let Some((selected, focused)) = self.start.take() {
                    let id = |at: Option<usize>| at.and_then(|i| ids.get(i).cloned());
                    self.rows = SidebarRows {
                        selected: id(selected),
                        focused: id(focused),
                    };
                    if self.rows.focused.is_some() {
                        window.focus(&self.focus_handle, cx);
                    }
                }
                // The ring shows only while keys reach the sidebar, so it never points where they don't go.
                let focused = (self.focus_handle.is_focused(window))
                    .then(|| self.rows.focused.clone())
                    .flatten();
                let selected = self.rows.selected.clone();
                page.bg(chrome.raised)
                    .track_focus(&self.focus_handle)
                    .on_key_down(cx.listener(move |this, event: &KeyDownEvent, window, cx| {
                        let was = this.rows.selected.clone();
                        if this.rows.key(&event.keystroke.key, &ids) {
                            // Return or space opens the focused session, as a click on its row does.
                            if let Some(session) = this
                                .rows
                                .selected
                                .clone()
                                .filter(|s| Some(s) != was.as_ref())
                            {
                                open_session(&session, window, cx);
                            }
                            cx.notify();
                        }
                    }))
                    .child(title("sidebar-title", "Tasks"))
                    // The window's count, which shows Needs you; a fixture's view draws the record alone.
                    .children(decorations.is_none().then(|| {
                        label("sidebar-count", count_line())
                            .role(Role::Button)
                            .h(px(24.))
                            .px_1()
                            .rounded_sm()
                            .hover(|style| style.bg(chrome.hover))
                            .on_click(|_, window, cx| show(NEEDS_YOU, window, cx))
                    }))
                    // Each agent's MCP servers and skills (#148).
                    .children(decorations.is_none().then(|| {
                        label("sidebar-agents", "Agents")
                            .role(Role::Button)
                            .aria_label("Agents: MCP servers and skills")
                            .h(px(24.))
                            .px_1()
                            .rounded_sm()
                            .hover(|style| style.bg(chrome.hover))
                            .on_click(|_, window, cx| show(AGENTS, window, cx))
                    }))
                    .children(record.sessions.iter().zip(&record.rows).enumerate().map(
                        |(index, ((session, task, _), (words, entry)))| {
                            let text = format!("{task} · {words}");
                            // Its readings beside it (#990), a line each under the row, quieter than its state.
                            let readings = record.readings.get(index).cloned().unwrap_or_default();
                            // Its problem in plain words (#1348), a line under the row, each line its own node.
                            let problem: Vec<String> = record
                                .problems
                                .get(index)
                                .cloned()
                                .flatten()
                                .map(|problem| {
                                    problem
                                        .lines()
                                        .take(PROBLEM_LINES)
                                        .map(str::to_owned)
                                        .collect()
                                })
                                .unwrap_or_default();
                            // The ring is always laid out, so focus moving never shifts a row; it shows on the
                            // focused row alone.
                            let ring = if focused.as_ref() == Some(session) {
                                chrome.focus
                            } else {
                                chrome.focus.opacity(0.)
                            };
                            let row = marked(("sidebar-session", index), entry, text)
                                .role(Role::Button)
                                .h(px(24.))
                                // Every row leaves room for the bar and a gap after it, so opening one moves no text.
                                .pl(px(10.))
                                .pr_1()
                                .rounded_sm()
                                .border_2()
                                .border_color(ring)
                                .hover(|style| style.bg(chrome.hover))
                                // The open session: the selected fill, and a bar of the primary ink the row's full
                                // height at its leading edge, since in dark the fill can only be faint while status
                                // keeps 3:1 on it.
                                .when(selected.as_ref() == Some(session), |row| {
                                    row.relative().bg(chrome.selected).child(
                                        div()
                                            .absolute()
                                            .left_0()
                                            .top_0()
                                            .bottom_0()
                                            .w(px(3.))
                                            .bg(chrome.ink_primary),
                                    )
                                })
                                .on_click(cx.listener({
                                    let session = session.clone();
                                    // A click opens the row and gives the sidebar the keys, so the ring
                                    // goes on from there.
                                    move |this, _, window, cx| {
                                        this.rows = SidebarRows {
                                            selected: Some(session.clone()),
                                            focused: Some(session.clone()),
                                        };
                                        window.focus(&this.focus_handle, cx);
                                        open_session(&session, window, cx);
                                        cx.notify();
                                    }
                                }));
                            div()
                                .flex()
                                .flex_col()
                                .child(row)
                                .children(problem.into_iter().enumerate().map(|(n, line)| {
                                    label(("sidebar-problem", index * PROBLEM_LINES + n), line)
                                        .h_auto()
                                        .pl_4()
                                        .text_color(chrome.ink_secondary)
                                }))
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
                    ))
            }
            Kind::Home => match unfinished {
                Some(count) => page
                    .child(title("home-title", "Home"))
                    .child(label("home-needs-you", count))
                    .children(self.set_up.is_none().then(|| {
                        match self.setting_up {
                            Some(_) => label("set-up-working", SETTING_UP),
                            None => label("set-up", "Set up")
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
                                .on_click(cx.listener(|this, _, _, cx| this.start_set_up(cx))),
                        }
                    }))
                    // While setup runs, the last one's reason no longer stands.
                    .children(
                        self.set_up
                            .clone()
                            .or_else(|| self.setting_up.is_none().then(crate::setup::reason)?)
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
            Kind::NeedsYou => {
                page.child(title("needs-you-title", "Needs you"))
                    .children((decorations.is_none() && !self.popped).then(|| {
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
                    .children(record.open.iter().enumerate().map(
                        |(index, (handle, _, question))| {
                            let has = |list: fn(&AppState) -> &Vec<String>| {
                                decorations
                                    .as_ref()
                                    .is_some_and(|state| list(state).contains(handle))
                            };
                            let held = decorations.as_ref().is_some_and(|state| {
                                state.held.as_deref() == Some(handle.as_str())
                            });
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
                                .when(has(|state| &state.inbox.folded), |row| {
                                    row.pl_4().text_color(chrome.ink_secondary)
                                })
                                .when(has(|state| &state.inbox.later), |row| {
                                    row.text_color(chrome.ink_tertiary)
                                })
                                .when(held, |row| row.italic())
                        },
                    ))
            }
            Kind::Session => {
                let (session, task, state) = first(&record);
                let mine = record
                    .open
                    .iter()
                    .filter(|(_, of, _)| *of == session)
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
                let tab = (decorations.is_none() && !session.is_empty()).then(|| {
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
                // What the page shows by its real names, and the newest failure whole (#1348).
                let details = record
                    .details
                    .iter()
                    .enumerate()
                    .map(|(n, line)| label(("session-detail", n), line.clone()).h_auto());
                page.child(title("session-title", task.clone()))
                    .children(details)
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
                    .when(terminal.is_none(), |page| {
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
                let working = said.is_none() && self.setting_up.is_some();
                let (ground, ink) = (chrome.ground, chrome.ink_primary);
                let button = (said.is_none() && !working && crate::setup::needed()).then(|| {
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
                        .on_click(cx.listener(|this, _, _, cx| this.start_set_up(cx)))
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
                        .children(working.then(|| {
                            div()
                                .id("set-up-working")
                                .test_support()
                                .aria_label(SETTING_UP)
                                .child(SETTING_UP)
                        }))
                        .children(said.map(|line| {
                            div()
                                .id("set-up-said")
                                .test_support()
                                .aria_label(line.to_owned())
                                .max_w(px(560.))
                                .text_center()
                                .child(line.to_owned())
                        }))
                        .children(
                            (said.is_none() && !working)
                                .then(crate::setup::reason)
                                .flatten()
                                .map(|line| {
                                    div()
                                        .id("set-up-reason")
                                        .test_support()
                                        .aria_label(line.clone())
                                        // A long path in the reason wraps inside the window, so its fix stays in view.
                                        .max_w(px(560.))
                                        .text_center()
                                        .child(line)
                                }),
                        ),
                )
            }
            Kind::Agents => agents_page(page, self, chrome, cx),
            Kind::Rules => {
                // The rules page (#344): each rule file with its total, then each rule with its scope, what enforces
                // it and its size. A rule nothing enforces reads "text only": the list to shrink.
                let files = crate::rules::read(&crate::hub::root().join("wiki").join("rules.md"));
                let rules: Vec<&crate::rules::Rule> = files.iter().flat_map(|f| &f.rules).collect();
                let text_only = rules.iter().filter(|r| r.enforcer == "text only").count();
                let mut row: usize = 0;
                page.child(title("rules-title", "Rules"))
                    .child(
                        label(
                            "rules-count",
                            format!("{} rules · {text_only} text only", rules.len()),
                        )
                        .text_color(chrome.ink_secondary),
                    )
                    .child(
                        // The column heads, at the rows' widths.
                        div()
                            .id("rules-head")
                            .h(px(ROW_HEIGHT))
                            .flex()
                            .items_center()
                            .gap_2()
                            .pl_4()
                            .mt_2()
                            .text_color(chrome.ink_secondary)
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(div().w(px(480.)).child("Rule"))
                            .child(div().w(px(160.)).child("Scope"))
                            .child(div().w(px(180.)).child("Enforced by"))
                            .child(div().w(px(72.)).text_right().child("Tokens")),
                    )
                    .children(files.iter().enumerate().map(|(f, file)| {
                        div()
                            .flex()
                            .flex_col()
                            .mt_2()
                            .child(
                                label(
                                    ("rules-file", f),
                                    format!("{} · whole file {} tokens", file.file, file.tokens),
                                )
                                .font_weight(FontWeight::SEMIBOLD),
                            )
                            .children(file.rules.iter().map(|rule| {
                                row += 1;
                                let mut said = format!(
                                    "{} · {} · {} · {} tokens",
                                    rule.text, rule.scope, rule.enforcer, rule.tokens
                                );
                                if rule.yours {
                                    said.push_str(" · typed by you");
                                }
                                if rule.held {
                                    said.push_str(" · held: an agent removed its line");
                                }
                                div()
                                    .id(("rules-row", row))
                                    .test_support()
                                    .role(Role::Label)
                                    .aria_label(said)
                                    .h(px(ROW_HEIGHT))
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .pl_4()
                                    .child(div().w(px(480.)).truncate().child(rule.text.clone()))
                                    .child(
                                        div()
                                            .w(px(160.))
                                            .truncate()
                                            .text_color(chrome.ink_secondary)
                                            .child(rule.scope.clone()),
                                    )
                                    .child(
                                        div()
                                            .w(px(180.))
                                            .truncate()
                                            .text_color(if rule.enforcer == "text only" {
                                                chrome.ink_secondary
                                            } else {
                                                chrome.ink_primary
                                            })
                                            .when(rule.enforcer != "text only", |e| {
                                                e.font_weight(FontWeight::SEMIBOLD)
                                            })
                                            .child(rule.enforcer.clone()),
                                    )
                                    .child(
                                        div()
                                            .w(px(72.))
                                            .text_right()
                                            .text_color(chrome.ink_secondary)
                                            .child(format!("{} tokens", rule.tokens)),
                                    )
                            }))
                    }))
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

/// A path as the Agents page shows it: under your home as `~/...`.
fn home_path(path: &str) -> String {
    match std::env::var("HOME") {
        Ok(home) if !home.is_empty() && path.starts_with(&format!("{home}/")) => {
            format!("~{}", &path[home.len()..])
        }
        _ => path.to_owned(),
    }
}

/// One row of the Agents page: its name, what it is, and where it went, one accessibility node named by all three.
fn agents_row(
    id: impl Into<ElementId>,
    cells: [String; 3],
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let name = cells.join(" · ");
    let [what, how, wh] = cells;
    div()
        .id(id)
        .test_support()
        .role(Role::Label)
        .aria_label(name)
        .flex()
        .gap_4()
        .h(px(22.))
        .items_center()
        .child(
            div()
                .w(px(200.))
                .font_weight(FontWeight::MEDIUM)
                .child(what),
        )
        .child(
            div()
                .w(px(300.))
                .text_color(chrome.ink_secondary)
                .child(how),
        )
        .child(div().flex_1().child(wh))
}

/// The Agents page (#148): the agents installed, each MCP server and skill with the agents it is synced to, what each
/// agent has that DeepBuild doesn't manage, and the syncs waiting for you; the one you review shows its diff per file,
/// and Apply opens its ask, whose answer carries it out.
fn agents_page(
    page: Stateful<Div>,
    view: &Shipped,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> Stateful<Div> {
    let empty = json!({});
    let model = view.agents.as_ref().unwrap_or(&empty);
    let list = |key: &str| model[key].as_array().cloned().unwrap_or_default();
    let agents = list("agents");
    let name_of = |id: &str| {
        agents
            .iter()
            .find(|a| a["id"] == id)
            .and_then(|a| a["name"].as_str())
            .unwrap_or(id)
            .to_owned()
    };
    let names = |ids: &serde_json::Value| {
        ids.as_array()
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| id.as_str())
                    .map(&name_of)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default()
    };
    let named = |installed: bool| {
        agents
            .iter()
            .filter(|a| (a["installed"] == true) == installed)
            .filter_map(|a| a["name"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let section = |id: &'static str, text: &'static str| {
        label(id, text)
            .mt_4()
            .mb_1()
            .font_weight(FontWeight::SEMIBOLD)
    };
    let servers = list("servers").into_iter().enumerate().map(|(i, s)| {
        let spec = &s["spec"];
        let scope = spec["scope"]["repos"]
            .as_array()
            .filter(|r| !r.is_empty())
            .map_or("every repo".to_owned(), |repos| {
                let repos: Vec<String> = repos
                    .iter()
                    .filter_map(|r| r.as_str())
                    .map(|r| r.rsplit('/').next().unwrap_or(r).to_owned())
                    .collect();
                format!("scoped to {}", repos.join(", "))
            });
        let secrets = spec["secrets"]
            .as_array()
            .filter(|v| !v.is_empty())
            .map(|v| {
                let v: Vec<&str> = v.iter().filter_map(|x| x.as_str()).collect();
                format!(" · {} by handle", v.join(", "))
            })
            .unwrap_or_default();
        let how = format!(
            "{} · {scope}{secrets}",
            spec["transport"].as_str().unwrap_or("stdio")
        );
        agents_row(
            ("agents-server", i),
            [
                s["name"].as_str().unwrap_or_default().to_owned(),
                how,
                format!("Synced to {}", names(&s["agents"])),
            ],
            chrome,
        )
    });
    let skills = list("skills").into_iter().enumerate().map(|(i, k)| {
        let repo = k["repo"].as_str().unwrap_or_default();
        let commit = k["commit"].as_str().unwrap_or_default();
        let how = format!(
            "{} at {} · {}",
            repo.rsplit('/').next().unwrap_or(repo),
            &commit[..commit.len().min(7)],
            k["path"].as_str().unwrap_or_default()
        );
        let pin = if k["differs"] == true {
            "differs from its pin: an update waits for you"
        } else {
            "matches its pin"
        };
        agents_row(
            ("agents-skill", i),
            [
                k["name"].as_str().unwrap_or_default().to_owned(),
                how,
                format!("Synced to {} · {pin}", names(&k["agents"])),
            ],
            chrome,
        )
    });
    let yours = agents
        .iter()
        .filter(|a| a["installed"] == true)
        .enumerate()
        .map(|(i, a)| {
            let mine: Vec<&str> = a["yours"]
                .as_array()
                .map(|v| v.iter().filter_map(|x| x.as_str()).collect())
                .unwrap_or_default();
            agents_row(
                ("agents-yours", i),
                [
                    a["name"].as_str().unwrap_or_default().to_owned(),
                    if mine.is_empty() {
                        "nothing of yours".to_owned()
                    } else {
                        mine.join(", ")
                    },
                    "Yours: DeepBuild leaves these alone".to_owned(),
                ],
                chrome,
            )
        })
        .collect::<Vec<_>>();
    let syncs = list("syncs");
    let waiting: Vec<serde_json::Value> = syncs
        .iter()
        .filter(|s| s["status"] == "proposed")
        .cloned()
        .collect();
    let rows = waiting
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let id = s["id"].as_str().unwrap_or_default().to_owned();
            let files = s["files"].as_array().map_or(0, Vec::len);
            let reached: Vec<String> = s["files"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|f| f["agents"].as_array().cloned().unwrap_or_default())
                .filter_map(|a| a.as_str().map(name_of))
                .fold(Vec::new(), |mut all, a| {
                    if !all.contains(&a) {
                        all.push(a);
                    }
                    all
                });
            div()
                .flex()
                .items_center()
                .gap_4()
                .child(agents_row(
                    ("agents-waiting", i),
                    [
                        format!(
                            "{} {}",
                            s["kind"].as_str().unwrap_or_default(),
                            s["name"].as_str().unwrap_or_default()
                        ),
                        format!("{files} files · {}", reached.join(", ")),
                        String::new(),
                    ],
                    chrome,
                ))
                .child(
                    label(("agents-review", i), "Review the diff")
                        .role(Role::Button)
                        .aria_label(format!(
                            "Review the diff of {}",
                            s["name"].as_str().unwrap_or_default()
                        ))
                        .px_2()
                        .rounded_sm()
                        .border_1()
                        .border_color(chrome.divider)
                        .hover(|style| style.bg(chrome.hover))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.reviewing = Some(id.clone());
                            cx.notify();
                        })),
                )
        })
        .collect::<Vec<_>>();
    let review = view
        .reviewing
        .as_ref()
        .and_then(|id| waiting.iter().find(|s| s["id"] == id.as_str()))
        .map(|s| review_panel(s, &name_of, chrome, cx));
    page.overflow_y_scroll()
        .child(title("agents-title", "Agents"))
        .child(label(
            "agents-installed",
            format!("Installed: {}", named(true)),
        ))
        .child(
            label(
                "agents-missing",
                format!("Not installed here: {}", named(false)),
            )
            .text_color(chrome.ink_secondary),
        )
        .child(section("agents-servers-title", "MCP servers"))
        .children(servers)
        .child(section("agents-skills-title", "Skills"))
        .children(skills)
        .child(section("agents-yours-title", "Already in each agent"))
        .children(yours)
        .child(section("agents-waiting-title", "Waiting for you"))
        .children(rows)
        .children(review)
}

/// One sync's diff, file by file, each with the agents that read it, then Apply, which opens its ask.
fn review_panel(
    sync: &serde_json::Value,
    name_of: &dyn Fn(&str) -> String,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> Stateful<Div> {
    let ask = sync["ask"].as_str().unwrap_or_default().to_owned();
    let refused = sync["refused"].as_array().cloned().unwrap_or_default();
    let files = sync["files"].as_array().cloned().unwrap_or_default();
    // A diff line holds one row: a longer one ends in an ellipsis inside its block.
    let mono = |text: &str| text::Label {
        family: deep_text_gpui::Role::Mono.family(),
        width: Some(DIFF_WIDTH),
        max_lines: Some(1),
        ..text::Label::new(text)
    };
    let blocks = files.iter().enumerate().map(|(i, f)| {
        let readers: Vec<String> = f["agents"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| a.as_str().map(name_of))
            .collect();
        let read = match readers.len() {
            0 => String::new(),
            1 => format!("read by {}", readers[0]),
            _ => format!("read by {}: one write reaches both", readers.join(" and ")),
        };
        let lines: Vec<String> = f["diff"]
            .as_str()
            .unwrap_or_default()
            .lines()
            .skip(2)
            .take(DIFF_LINES)
            .map(str::to_owned)
            .collect();
        div()
            .flex()
            .flex_col()
            .mt_2()
            .child(agents_row(
                ("agents-file", i),
                [
                    home_path(f["path"].as_str().unwrap_or_default()),
                    read,
                    String::new(),
                ],
                chrome,
            ))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .p_2()
                    .bg(chrome.raised)
                    .border_1()
                    .border_color(chrome.divider)
                    .children(lines.iter().enumerate().map(|(n, line)| {
                        let color = match line.chars().next() {
                            Some('+') => chrome.ink_primary,
                            Some('-') => chrome.ink_secondary,
                            _ => chrome.ink_tertiary,
                        };
                        text::label(&format!("agents-diff-{i}-{n}"), mono(line), color, None)
                    })),
            )
    });
    let refusals = refused.iter().enumerate().map(|(i, r)| {
        label(
            ("agents-refused", i),
            format!(
                "Not for {}: it refuses the field {} ({})",
                name_of(r["agent"].as_str().unwrap_or_default()),
                r["field"].as_str().unwrap_or_default(),
                r["reason"].as_str().unwrap_or_default()
            ),
        )
        .text_color(chrome.ink_secondary)
    });
    div()
        .id("agents-review-panel")
        .mt_3()
        .p_3()
        .border_1()
        .border_color(chrome.divider)
        .rounded_md()
        .flex()
        .flex_col()
        // Apply and Close beside the title, so they show however long the diff runs.
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(
                    label(
                        "agents-review-title",
                        format!(
                            "Approve the sync of {}: DeepBuild writes only its own entries, at user level",
                            sync["name"].as_str().unwrap_or_default()
                        ),
                    )
                    .flex_1()
                    .font_weight(FontWeight::SEMIBOLD),
                )
                .child(
                    label("agents-apply", "Apply")
                        .role(Role::Button)
                        .aria_label("Apply the sync")
                        .px_4()
                        .rounded_md()
                        .bg(chrome.ink_primary)
                        .text_color(chrome.ground)
                        .hover(|style| style.bg(chrome.ink_secondary))
                        .on_click(move |_, window, cx| crate::card::present_ask(&ask, window, cx)),
                )
                .child(
                    label("agents-close", "Close")
                        .role(Role::Button)
                        .px_4()
                        .rounded_md()
                        .border_1()
                        .border_color(chrome.divider)
                        .hover(|style| style.bg(chrome.hover))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.reviewing = None;
                            cx.notify();
                        })),
                ),
        )
        .children(refusals)
        .children(blocks)
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
    /// The shipped shell with `needs-you`, `session` or `home` in the center; `sidebar`, the
    /// replica's view of the sidebar, shows home beside it. Any other name is a mistake, not a
    /// view.
    pub fn shipped(view: &str) -> Self {
        let center = match view {
            "needs-you" => NEEDS_YOU,
            "session" => SESSION,
            "home" | "sidebar" => HOME,
            "rules" => RULES,
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

    /// The app's shell (#1172): Needs you and the session's page in the center, with the welcome pane first while
    /// setup hasn't finished, or a mounted panel's view first.
    pub fn app(panel: bool) -> Self {
        let mut center = vec![NEEDS_YOU.to_owned(), SESSION.to_owned(), AGENTS.to_owned()];
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
    fn the_sidebars_keys_move_the_ring_and_open_the_focused_session_which_keeps_its_row_as_rows_move(
    ) {
        let ids = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let sessions = ids(&["a", "b", "c"]);
        let mut rows = SidebarRows::default();
        // Down from nothing focuses the first row; down again the second; up and down stop at the ends.
        assert!(rows.key("down", &sessions));
        assert!(rows.key("down", &sessions));
        assert_eq!(rows.focused.as_deref(), Some("b"));
        rows.key("down", &sessions);
        assert!(!rows.key("down", &sessions), "the last row holds");
        rows.key("up", &sessions);
        rows.key("up", &sessions);
        assert!(!rows.key("up", &sessions), "the first row holds");
        // Return opens the focused session; focus moving on leaves it open, so selected and focused differ.
        rows.key("down", &sessions);
        assert!(rows.key("enter", &sessions));
        rows.key("down", &sessions);
        assert_eq!(
            rows,
            SidebarRows {
                selected: Some("b".into()),
                focused: Some("c".into())
            }
        );
        // A new session shown first moves every row down a place; the same sessions stay selected and focused.
        let moved = ids(&["z", "a", "b", "c"]);
        rows.key("up", &moved);
        assert_eq!(rows.focused.as_deref(), Some("b"));
        assert_eq!(rows.selected.as_deref(), Some("b"));
        // Keys on an empty sidebar change nothing; space opens as return does.
        assert!(!SidebarRows::default().key("down", &[]));
        assert!(rows.key("down", &moved) && rows.key("space", &moved));
        assert_eq!(rows.selected.as_deref(), Some("c"));
    }

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
