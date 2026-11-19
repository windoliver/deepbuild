//! Issue #338: the app's shell and its shipped views as dock panels.
//!
//! The shell is one gpui-base `DockArea`: the sidebar in the left dock, the line in the bottom
//! dock, and Needs you, home or a session page in the center. Every view is a panel the dock
//! rebuilds by name through gpui-base's panel registry, which is the registry gpui-shell's
//! `DockArea.register_panel` fills for scripts, so a layout can name a script panel in any slot
//! and the same load path draws it there.
//!
//! Every element with an accessibility role is made by [`observed`]: it carries an id and `.test_support()`, so the
//! accessibility tree a screen reader sees and the observed elements a replica reads back are the same set of nodes,
//! and a named id is its author ID in both (#1459).

use std::{cell::Cell, cell::RefCell, collections::HashMap, sync::Arc, time::Duration};

use gpui_kit::base::dock::{
    register_panel, DockArea, DockAreaState, DockPlacement, DockState, Panel, PanelEvent,
    PanelInfo, PanelState,
};
use gpui_kit::base::ObservedElement;
use gpui_kit::component::TitleBar;
use gpui_kit::{prelude::FluentBuilder as _, *};

use serde_json::{json, Value};

use crate::address::Address;
use crate::chrome::{sizes, Typed as _};
use crate::{bound, brand, canvas, cells, chrome, copy, show::CanvasPanel, states, text};

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

/// How much of its text the row planted to cut off draws, short enough to fit in any sidebar.
#[cfg(feature = "plant-row")]
const CUT_TO: usize = 24;
/// The panel the hub's canvas core knows a session's page by.
pub(crate) const SESSION_PAGE: &str = "session-page";
/// How often an open terminal tab reads its grid again.
const TERMINAL_TICK: Duration = Duration::from_millis(250);
/// How often the Agents page reads the hub's model again.
const AGENTS_TICK: Duration = Duration::from_secs(2);
/// The diff lines the Agents page shows of each file, and the width a line is cut to, in points.
const DIFF_LINES: usize = 8;
const DIFF_WIDTH: f32 = 1060.;
/// The list as last built, with the reading of the record it was built from.
type Built = (
    std::rc::Rc<(Vec<crate::list::Ask>, Vec<crate::list::Session>)>,
    Vec<crate::list::Item>,
);
/// In no shipped build (#1457). What a replica's fixture panels read through `deepbuild.needs_you`, and its virtual clock: the inbox projection at
/// a log position. The replica, the live capture and the registry checks set it before opening the shell. No view
/// reads it: every view draws the record through the one reader, with the same tree in the app and in a replica
/// (#1454). `held` stays here alone because the hub records no event for a hold yet.
#[derive(Clone, Debug)]
#[cfg(feature = "fixtures")]
pub struct AppState {
    pub inbox: crate::events::Inbox,
    pub now: u64,
    pub sessions: Vec<String>,
    pub held: Option<String>,
}

#[cfg(feature = "fixtures")]
thread_local! {
    static STATE: RefCell<Option<std::rc::Rc<AppState>>> = const { RefCell::new(None) };
    /// The virtual clock, where one runs (a replica).
    static CLOCK: Cell<Option<u64>> = const { Cell::new(None) };
}

/// A replica's state and clock. Its record stands for a machine that's set up, whatever this HOME holds.
#[cfg(feature = "fixtures")]
pub fn set_state(state: AppState) {
    CLOCK.with(|clock| clock.set(Some(state.now)));
    crate::setup::assume_finished();
    STATE.with(|cell| *cell.borrow_mut() = Some(std::rc::Rc::new(state)));
}

#[cfg(feature = "fixtures")]
pub fn current_state() -> Option<std::rc::Rc<AppState>> {
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
    /// The views you installed that draw inside a shipped view, by area (#1454).
    static PLACED: RefCell<Vec<(String, AnyView)>> = const { RefCell::new(Vec::new()) };
    /// The app's canvas panel, on a session's page (#1454).
    static CANVAS: RefCell<Option<Entity<CanvasPanel>>> = const { RefCell::new(None) };
}

/// Gives a session's page the canvas panel.
pub fn set_canvas(panel: Entity<CanvasPanel>) {
    CANVAS.with(|canvas| *canvas.borrow_mut() = Some(panel));
}

thread_local! {
    /// The views you installed in the `sidebar` area, by name: each opens as a page from ⌘K and the View menu and adds
    /// nothing to the list (#1461).
    static PAGES: RefCell<Vec<(String, AnyView)>> = const { RefCell::new(Vec::new()) };
}

/// Puts an installed view `name` in its area: home and the line draw it inside them (#1461: under a project's picture,
/// on a session's page), a tab is the center's, and one in the sidebar is a page of its own, opened by its address.
pub fn place(area: &str, name: &str, view: AnyView, window: &mut Window, cx: &mut App) {
    match area {
        "tab" => crate::open::add_tab(view, window, cx),
        "sidebar" => PAGES.with(|pages| pages.borrow_mut().push((name.to_owned(), view))),
        _ => PLACED.with(|placed| placed.borrow_mut().push((area.to_owned(), view))),
    }
}

/// The page an installed `sidebar` view is, by its name.
pub fn page_named(name: &str) -> Option<AnyView> {
    PAGES.with(|pages| {
        pages
            .borrow()
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, view)| view.clone())
    })
}

/// The names of the installed views that are pages of their own.
pub fn page_names() -> Vec<String> {
    PAGES.with(|pages| pages.borrow().iter().map(|(n, _)| n.clone()).collect())
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

/// The key of what the tree names a view an agent wrote, so its words never pass as the app's (#1459): every node it
/// draws sits under this one.
pub const AGENT_WROTE: &str = "views.agent_wrote";

/// The node an agent's view draws under: a group named with [`AGENT_WROTE`]'s words.
fn agents(id: impl Into<ElementId>) -> ObservedElement<Stateful<Div>> {
    observed(id)
        .role(Role::Group)
        .aria_label(copy::text(AGENT_WROTE))
}

/// A box a placed view can't draw out of, the `index`th in its area.
fn placed_box((index, view): (usize, AnyView)) -> ObservedElement<Stateful<Div>> {
    agents(("agent-placed", index))
        .relative()
        .overflow_hidden()
        .w_full()
        .flex_none()
        .h(sizes().placed)
        .child(view)
}

/// The session a page's Terminal tab shows, and what the hub's canvas core last gave for it.
struct TerminalTab {
    session: String,
    /// The tab's keys: while it has them, ⌘[ and ⌘] are the terminal's (#1460).
    focus: FocusHandle,
    screen: Option<cells::Screen>,
    /// What the tab says when the hub hosts no terminal for the session.
    words: String,
    /// #1498: the cells the core's selection holds, each row's `[from, row, to]`, and whether your press is down.
    outline: Vec<[u16; 3]>,
    pressing: bool,
    _poll: Task<()>,
}

/// One shipped view, drawn as a dock panel.
pub struct Shipped {
    kind: Kind,
    focus_handle: FocusHandle,
    /// The first-launch page's Set up (#1100).
    pub(crate) welcome: crate::welcome::Welcome,
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
    /// When the soonest age the view shows next reads differently, and the timer that draws it then (#1546).
    age_tick: Option<(u64, Task<()>)>,
    /// The list as drawn, by the one rule for when rows move (#1461), and whether the pointer is over it.
    kept: crate::list::Kept,
    hovered: bool,
    /// The row a press went down on and when: a press on a row that just moved is dropped (#1461).
    pressed: Option<(String, u64)>,
    /// The list as last built, with the reading of the record it was built from.
    built: Option<Built>,
    /// What you typed in the list, and when the last key came: typing moves to the first row it starts (#1462).
    typed: (String, u64),
    /// How far the list's rows are scrolled, and how tall their region last drew (#1808). A wheel scrolls them; the
    /// keyboard's row stays in view (#2021).
    list_top: Pixels,
    list_room: std::rc::Rc<Cell<Option<Size<Pixels>>>>,
    /// The wheel moved the rows since the list last drew.
    wheeled: bool,
    /// The session whose name is being typed in its page's title (#2018), and the field.
    renaming: Option<Renaming>,
    /// The list in view as last built, and each row in it as its own cached view (#1482).
    list_model: Option<ListModel>,
    row_views: HashMap<String, Entity<RowView>>,
    /// What the view last read from the record, what it was read at, and until when it reads the same (#1482).
    drawn_record: Option<(RecordAt, Option<u64>, std::rc::Rc<Record>)>,
}

#[cfg(feature = "fixtures")]
thread_local! {
    /// How many of the list's rows the sidebar built since a replica last took the count (#1482).
    static ROWS_BUILT: Cell<u64> = const { Cell::new(0) };
    /// Each shipped view's name, by its entity, for a replica's frame report.
    static VIEW_NAMES: RefCell<HashMap<EntityId, &'static str>> = RefCell::new(HashMap::new());
}

/// The list's rows built since the last call, which a replica reads once a frame (#1482).
#[cfg(feature = "fixtures")]
pub fn take_rows_built() -> u64 {
    ROWS_BUILT.with(|built| built.replace(0))
}

/// The name a shipped view registered under, once it has rendered.
#[cfg(feature = "fixtures")]
pub fn view_name(entity: EntityId) -> Option<&'static str> {
    VIEW_NAMES.with(|names| names.borrow().get(&entity).copied())
}

/// The record's start ID and `log_pos`, whether the reader has folded it, and the session open (#1482).
type RecordAt = ((String, u64), bool, Option<String>);

/// The list in view as the sidebar last built it (#1482), with what it was built from.
struct ListModel {
    key: ListKey,
    /// When the list as kept next changes with no new record: a row that left may go, a moved one takes a press.
    next_change: Option<u64>,
    view: InView,
    /// The record's reading the list was built from, held so its address names it alone while the key does.
    _read: Option<std::rc::Rc<(Vec<crate::list::Ask>, Vec<crate::list::Session>)>>,
}

/// What the list in view is built from, but the clock (#1482). `fresh` is the address of the record's reading.
#[derive(Clone, Debug, PartialEq)]
struct ListKey {
    fresh: usize,
    attended: bool,
    keys: bool,
    rows: SidebarRows,
    typed: String,
    popped: bool,
    replaced: bool,
    /// The rows' region as it last drew, how far they're scrolled, whether the wheel moved them, and the running jobs
    /// after them (#1808).
    area: Option<Size<Pixels>>,
    top: Pixels,
    wheeled: bool,
    jobs: usize,
    start: bool,
}

/// The list in view (#1482, #1808): the items it draws, Needs you's heading first when it stays at the top, where the
/// rows that scroll start drawing from their region's top, and where their content ends, its top and its room.
#[derive(Clone)]
struct InView {
    items: std::rc::Rc<Vec<crate::list::Item>>,
    pinned: usize,
    offset: Pixels,
    end: Pixels,
    top: Pixels,
    room: Pixels,
}

/// One row of the list as a view of its own (#1482). It keeps what it draws and draws again only when the list
/// hands it something different, or the pointer comes or goes, so a hover draws the rows it touched and no other.
pub(crate) struct RowView {
    drawn: RowDrawn,
    row: String,
    address: Address,
    sidebar: WeakEntity<Shipped>,
}

impl Render for RowView {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        let id = self.row.clone();
        let address = self.address.clone();
        let actions = id.starts_with("session:") || id.starts_with("ask:");
        let sidebar = self.sidebar.clone();
        let pressed = sidebar.clone();
        row_element(&self.drawn, chrome)
            // #1482's planted row notifies the window's root as the pointer enters or leaves it.
            .when(crate::plain::planted("hover-notifies-root"), |row| {
                row.on_hover(|_, window, cx| {
                    if let Some(root) = window.root_entity_id() {
                        cx.notify(root);
                    }
                })
            })
            // #1462's planted row draws a control only while the pointer is over it.
            .when(
                cfg!(feature = "plant-hover-only-control") && id.starts_with("ask:"),
                |row| {
                    let over = HOVERED.with(|h| h.borrow().as_deref() == Some(id.as_str()));
                    let control_id = ElementId::Name(format!("{id}:later").into());
                    let hovered = id.clone();
                    row.on_hover(move |on, window, _| {
                        HOVERED.with(|h| *h.borrow_mut() = on.then(|| hovered.clone()));
                        window.refresh();
                    })
                    .when(over, |row| {
                        row.child(control(
                            control_id,
                            Control::Plain,
                            copy::text("views.later"),
                            chrome,
                        ))
                    })
                },
            )
            // A secondary click opens the row's actions (#1462).
            .when(actions, |row| {
                let id = id.clone();
                row.on_mouse_down(
                    MouseButton::Right,
                    move |event: &MouseDownEvent, window, cx| {
                        open_context(id.clone(), event.position, window, cx)
                    },
                )
            })
            .on_mouse_down(MouseButton::Left, {
                let id = id.clone();
                move |_, _, cx| {
                    let _ =
                        pressed.update(cx, |this, _| this.pressed = Some((id.clone(), now_ms())));
                }
            })
            .on_click(move |_, window, cx| {
                let _ = sidebar.update(cx, |this, cx| this.click_row(&id, &address, window, cx));
            })
    }
}

/// A session's page's title while you rename it (#2018): the field holds the name, and Return saves it.
struct Renaming {
    session: String,
    input: Entity<gpui_kit::base::input::InputState>,
    _entered: Subscription,
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
    /// `kind` in a window of its own, popped out of the shell.
    pub fn popped(kind: Kind, cx: &mut Context<Self>) -> Self {
        Self {
            popped: true,
            ..Self::new(kind, cx)
        }
    }

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
        // The record and the bound values reach the view through the entity it observes (#1546).
        crate::record::on_move(cx, |this: &mut Shipped, cx| this.record_moved(cx));
        if kind == Kind::Session {
            SESSION_VIEW.with(|view| *view.borrow_mut() = Some(cx.entity().downgrade()));
        }
        let focus_handle = cx.focus_handle();
        // The list's keys are the window's from the start, while a narrow window shows only the page too (#1808).
        if kind == Kind::Sidebar {
            LIST_KEYS.with(|keys| {
                *keys.borrow_mut() = Some((focus_handle.clone(), cx.entity().downgrade()))
            });
        }
        Self {
            kind,
            focus_handle,
            welcome: Default::default(),
            rows: SidebarRows::default(),
            start: (kind == Kind::Sidebar).then(|| SIDEBAR_ROWS.with(std::cell::Cell::get)),
            terminal: None,
            popped: false,
            agents: None,
            reviewing: None,
            _agents_poll: poll,
            age_tick: None,
            kept: crate::list::Kept::default(),
            hovered: false,
            pressed: None,
            built: None,
            typed: (String::new(), 0),
            list_top: px(0.),
            list_room: Default::default(),
            wheeled: false,
            renaming: None,
            list_model: None,
            row_views: HashMap::new(),
            drawn_record: None,
        }
    }

    /// Puts the caret in `session`'s page's title, in a field holding its name (#2018): Return saves what it holds as
    /// the name you gave it, through the hub, and the field going out of focus leaves the name as it was.
    fn start_rename(&mut self, session: String, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::base::input::{InputEvent, InputState};
        let name =
            crate::record::with_view(|view| view.table().title(&session)).unwrap_or_default();
        let input = cx.new(|cx| InputState::new(window, cx).default_value(name));
        let entered = cx.subscribe_in(
            &input,
            window,
            |this: &mut Self, input, event: &InputEvent, _, cx| match event {
                InputEvent::PressEnter { .. } => {
                    let name = input.read(cx).value().trim().to_owned();
                    if let Some(renaming) = this.renaming.take() {
                        if !name.is_empty() {
                            crate::actions::hub_write(
                                "session.rename",
                                json!({ "session": renaming.session, "name": name }),
                                copy::text("views.rename").into(),
                                cx,
                            );
                        }
                    }
                    TITLE_KEYS.with(|keys| keys.borrow_mut().take());
                    cx.notify();
                }
                InputEvent::Blur => {
                    this.renaming = None;
                    TITLE_KEYS.with(|keys| keys.borrow_mut().take());
                    cx.notify();
                }
                _ => {}
            },
        );
        input.update(cx, |input, cx| input.focus(window, cx));
        TITLE_KEYS.with(|keys| *keys.borrow_mut() = Some(input.read(cx).focus_handle(cx)));
        self.renaming = Some(Renaming {
            session,
            input,
            _entered: entered,
        });
        cx.notify();
    }

    /// A key while the list holds the keyboard (#1462): the arrows move along it, Return opens the row, and a letter
    /// or digit moves to the first row whose title or project starts with what you typed, hiding nothing.
    fn list_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let stroke = &event.keystroke;
        let m = stroke.modifiers;
        if m.platform || m.control || m.alt || m.function {
            return;
        }
        let rows = list_rows(cx);
        let ids: Vec<String> = rows.iter().map(|row| row.id.clone()).collect();
        let key = stroke.key.as_str();
        match key {
            "up" | "down" => {
                self.rows.key(key, &ids);
            }
            "enter" | "space" => {
                let Some(row) = rows
                    .iter()
                    .find(|row| Some(&row.id) == self.rows.focused.as_ref())
                else {
                    return;
                };
                self.rows.selected = Some(row.id.clone());
                let address = row.address.clone();
                crate::open::open(&address, window, cx).ok();
            }
            "escape" => {
                CONTEXT.with(|context| *context.borrow_mut() = None);
            }
            typed if typed.chars().count() == 1 && typed.chars().all(|c| c.is_alphanumeric()) => {
                let now = now();
                let (words, at) = &mut self.typed;
                if now.saturating_sub(*at) > 1000 {
                    words.clear();
                }
                words.push_str(&typed.to_lowercase());
                *at = now;
                let words = words.clone();
                if let Some(row) = rows.iter().find(|row| {
                    row.title.to_lowercase().starts_with(&words)
                        || row.project.to_lowercase().starts_with(&words)
                }) {
                    self.rows.focused = Some(row.id.clone());
                }
            }
            _ => return,
        }
        cx.stop_propagation();
        cx.notify();
    }

    /// Sets the view's next tick at the moment the soonest age it drew, as of `now`, reads differently; the view
    /// draws again then with no input, as the frame clock arms a frame when an age it shows ticks (#1546).
    fn tick_ages(&mut self, now: u64, cx: &mut Context<Self>) {
        let Some(wait) = states::ages_written() else {
            self.age_tick = None;
            return;
        };
        // #1546's planted app sets no next tick.
        if crate::plain::planted("no-age-timer") {
            return;
        }
        let due = now + wait;
        if self.age_tick.as_ref().is_some_and(|(at, _)| *at == due) {
            return;
        }
        let timer = cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(wait))
                .await;
            let _ = this.update(cx, |_, cx| cx.notify());
        });
        self.age_tick = Some((due, timer));
    }

    /// The list's items in view (#1482), built from the record, the one rule for when rows move (#1461) and the
    /// keyboard, but built again only when one of those moved or a row that left is due to go: a frame that changes
    /// nothing the list is built from, a hover's, costs what it draws, whatever the list's length.
    fn list_in_view(
        &mut self,
        unfinished: bool,
        jobs: usize,
        now: u64,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> InView {
        let attended = self.hovered || self.focus_handle.contains_focused(window, cx);
        let key = self.list_built_from(unfinished, jobs, attended, now, window, cx);
        if let Some(model) = (self.list_model.as_ref())
            .filter(|model| model.key == key && model.next_change.is_none_or(|at| now < at))
        {
            let view = model.view.clone();
            if let Some(at) = model.next_change {
                states::changes_after(at - now);
            }
            if attended {
                self.kept.attended(now);
            }
            return view;
        }
        let s = sizes();
        // First launch draws an empty list (#1461); so does a record with no ask and no session. Before the
        // record is read the list holds Needs you's heading alone, saying so.
        let fresh = if unfinished {
            Vec::new()
        } else if !crate::record::read_yet() {
            vec![crate::list::Item::Heading {
                id: crate::list::HEADING.to_owned(),
                title: copy::text("views.needs_you").to_owned(),
                count: None,
            }]
        } else {
            // The list is built once per reading of the record, not once per frame.
            let read = crate::list::read_now(now);
            match &self.built {
                Some((at, items)) if std::rc::Rc::ptr_eq(at, &read) => items.clone(),
                _ => {
                    let items = crate::list::build(&read.0, &read.1);
                    self.built = Some((read, items.clone()));
                    items
                }
            }
        };
        // The row the list's keyboard is on leaves at once when it leaves its state, and the keyboard goes to
        // the row now in its place (#1462); every other row that left keeps its slot while you're here (#1461).
        if self.focus_handle.is_focused(window) {
            if let Some(on) = self.rows.focused.clone() {
                if !fresh.iter().any(|item| item.id() == on) {
                    self.kept.release(&on);
                }
            }
        }
        let mut items = self.kept.settle(fresh, attended, now).to_vec();
        let next_change = self.kept.next_change(now);
        if let Some(at) = next_change {
            states::changes_after(at - now);
        }
        // #1461's planted list draws each agent waiting for a first session as a row.
        if crate::plain::planted("agent-as-row") && items.is_empty() {
            items.push(crate::list::Item::Row(Box::new(crate::list::Row {
                id: "session:claude-code".to_owned(),
                address: Address::session("claude-code"),
                title: "Claude Code".to_owned(), // copy-exception: planted wrong program
                word: "queued".to_owned(),
                value: "queued".to_owned(),
                entry: "queued",
                time: None,
                loud: false,
                left: false,
                why: String::new(),
                doing: None,
                hooks: (0, None),
                flag: None,
            })));
        }
        let popped = crate::open::popped(cx) == Some(Kind::NeedsYou);
        let replaced = NEEDS_YOU_VIEW.with(|view| view.borrow().clone());
        let asks_row = |item: &crate::list::Item| item.id().starts_with("ask:");
        let skip = |item: &crate::list::Item| {
            (popped && (asks_row(item) || item.id() == crate::list::HEADING))
                || (replaced.is_some() && asks_row(item))
        };
        // #1462's planted list hides the rows that don't match what you typed.
        let typed = self.typed.0.clone();
        let hidden = |item: &crate::list::Item| {
            cfg!(feature = "plant-list-hides-row")
                && !typed.is_empty()
                && matches!(item, crate::list::Item::Row(row)
                    if !row.title.to_lowercase().starts_with(&typed))
        };
        items.retain(|item| !skip(item) && !hidden(item));
        // The rows the keyboard walks, in the list's order (#1462): each ask, then each project's heading and
        // its rows, every one of them. #2021's planted list lets the keyboard onto the headings alone.
        let rows: Vec<ListRow> = keyboard_rows(&items)
            .into_iter()
            .filter(|row| {
                !crate::plain::planted("rows-take-no-focus") || row.id.starts_with("project:")
            })
            .collect();
        if let Some((selected, focused)) = self.start.take() {
            let id = |at: Option<usize>| {
                at.and_then(|i| {
                    rows.iter()
                        .filter(|row| !row.id.starts_with("project:"))
                        .nth(i)
                        .map(|row| row.id.clone())
                })
            };
            self.rows = SidebarRows {
                selected: id(selected),
                focused: id(focused),
            };
            if self.rows.focused.is_some() {
                window.focus(&self.focus_handle, cx);
            }
        }
        // Focus follows a row that leaves: to the row now in its place, else the last (#1462).
        if let Some(on) = self.rows.focused.clone() {
            if !rows.iter().any(|row| row.id == on) {
                let at = LAST_ROWS.with(|last| last.borrow().iter().position(|id| *id == on));
                self.rows.focused = at
                    .and_then(|at| rows.get(at.min(rows.len().saturating_sub(1))))
                    .or(rows.last())
                    .map(|row| row.id.clone());
            }
        }
        // The keys reached a list that wasn't drawn, as a narrow window's hidden list (#1808): they go to the open
        // page's row, else the first, as Esc's do (#1462).
        if self.rows.focused.is_none() && self.focus_handle.is_focused(window) {
            let here = crate::open::current(cx);
            self.rows.focused = rows
                .iter()
                .find(|row| Some(&row.address) == here.as_ref())
                .or(rows.first())
                .map(|row| row.id.clone());
        }
        // The list scrolls (#1808). Needs you's heading stays at its top, so its count is never scrolled off, and
        // only the items in view under it are drawn, so a frame over 700 rows costs what it shows. The keyboard's
        // row is always in view: it brings the rows either side of it into view too, so the next row an arrow goes
        // to is in view (#2021), and a wheel that scrolls it out of view takes the keyboard to the nearest row in
        // view.
        let pinned = usize::from(
            items
                .first()
                .is_some_and(|item| item.id() == crate::list::HEADING),
        );
        let scroll = crate::list::Scroll::new(
            items[pinned..]
                .iter()
                .map(|item| f32::from(item_height(item))),
        );
        let end = px(scroll.end());
        let content = end + (s.space(4) + s.small.line) * jobs as f32;
        let room = self
            .list_room
            .get()
            .map_or(window.viewport_size().height, |area| area.height);
        let most = (content - room).max(px(0.));
        let (room_at, mut top_at) = (
            f32::from(room),
            f32::from(self.list_top.clamp(px(0.), most)),
        );
        let wheeled = std::mem::take(&mut self.wheeled);
        // #1808's planted list draws its rows from its top and cuts them at its foot, whatever moves.
        let clips = crate::plain::planted("list-clips");
        let on = self
            .rows
            .focused
            .as_deref()
            .and_then(|on| item_at(&items[pinned..], on))
            .filter(|_| !clips);
        if let Some(at) = on {
            if !wheeled {
                top_at = scroll.reveal(at, top_at, room_at);
            } else if !scroll.shows(at, top_at, room_at) {
                // Among the items drawn, those whole in view that the keyboard walks.
                let mut shown = scroll
                    .drawn(top_at, room_at)
                    .filter(|i| scroll.shows(*i, top_at, room_at))
                    .filter_map(|i| keyboard_id(&items[pinned + i]))
                    .filter(|id| rows.iter().any(|row| row.id == *id));
                let nearest = if scroll.span(at).0 >= top_at {
                    shown.last()
                } else {
                    shown.next()
                };
                if nearest.is_some() {
                    self.rows.focused = nearest;
                }
            }
        }
        let top = if clips {
            px(0.)
        } else {
            px(top_at).clamp(px(0.), most)
        };
        self.list_top = top;
        let drawn = scroll.drawn(f32::from(top), room_at);
        let offset = px(scroll.top_of(drawn.start)) - top;
        // #1482's planted list builds the row below the window's edge too.
        let to =
            (pinned + drawn.end + usize::from(crate::plain::planted("builds-row-out-of-view")))
                .min(items.len());
        let items: Vec<crate::list::Item> = items[..pinned]
            .iter()
            .chain(&items[pinned + drawn.start..to])
            .cloned()
            .collect();
        LAST_ROWS.with(|last| *last.borrow_mut() = rows.iter().map(|row| row.id.clone()).collect());
        LIST_ROWS.with(|list| *list.borrow_mut() = rows);
        // A row out of view keeps no view.
        self.row_views
            .retain(|id, _| items.iter().any(|item| item.id() == id));
        let view = InView {
            items: std::rc::Rc::new(items),
            pinned,
            offset,
            end,
            top,
            room,
        };
        self.list_model = Some(ListModel {
            key: self.list_built_from(unfinished, jobs, attended, now, window, cx),
            next_change,
            view: view.clone(),
            _read: self.built.as_ref().map(|(read, _)| read.clone()),
        });
        view
    }

    /// What the view draws from the record (#1482), read again only when the record moved, another session opened,
    /// or something it read from the clock reads differently, so a frame the record didn't move reads none of it.
    fn record_now(&mut self, opened: Option<&str>, now: u64) -> std::rc::Rc<Record> {
        let at = crate::record::with_view(|view| (view.start.clone(), view.log_pos));
        let key = (
            at.unwrap_or_default(),
            crate::record::folded(),
            opened.map(str::to_owned),
        );
        if let Some((read, until, record)) = &self.drawn_record {
            if *read == key && until.is_none_or(|until| now < until) {
                if let Some(until) = until {
                    states::changes_after(until - now);
                }
                return record.clone();
            }
        }
        let (record, changes) = states::written_in(|| record(self.kind, opened));
        let record = std::rc::Rc::new(record);
        self.drawn_record = Some((key, changes.map(|wait| now + wait), record.clone()));
        record
    }

    /// What the list in view is built from, but the clock (#1482).
    fn list_built_from(
        &self,
        unfinished: bool,
        jobs: usize,
        attended: bool,
        now: u64,
        window: &Window,
        cx: &App,
    ) -> ListKey {
        let fresh = if unfinished {
            0
        } else if !crate::record::read_yet() {
            1
        } else {
            std::rc::Rc::as_ptr(&crate::list::read_now(now)) as usize
        };
        ListKey {
            fresh,
            attended,
            keys: self.focus_handle.is_focused(window),
            rows: self.rows.clone(),
            typed: self.typed.0.clone(),
            popped: crate::open::popped(cx) == Some(Kind::NeedsYou),
            replaced: NEEDS_YOU_VIEW.with(|view| view.borrow().is_some()),
            area: self.list_room.get(),
            top: self.list_top,
            wheeled: self.wheeled,
            jobs,
            start: self.start.is_some(),
        }
    }

    /// The record moved: a view draws again, but a session's page for the events of its own session alone (#1482).
    fn record_moved(&mut self, cx: &mut Context<Self>) {
        if self.kind == Kind::Session && !crate::plain::planted("page-redraws-every-session") {
            if let Some(session) = crate::open::opened_session(cx) {
                if !crate::record::moved_for(&session, cx) {
                    return;
                }
            }
        }
        cx.notify();
    }

    /// The list's row `row` as a cached view of its own (#1482), drawing `drawn`: a row that draws what it drew is
    /// reused whole, and one that changed draws again in this frame, alone.
    fn row_in_view(
        &mut self,
        row: &crate::list::Row,
        drawn: RowDrawn,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let style = StyleRefinement::default().h(drawn.tall).flex_none();
        #[cfg(feature = "fixtures")]
        ROWS_BUILT.with(|built| built.set(built.get() + 1));
        let view = match self.row_views.get(&row.id) {
            Some(view) => {
                if view.read(cx).drawn != drawn {
                    view.update(cx, |view, _| view.drawn = drawn);
                    window.redraw_in_frame(view.entity_id());
                }
                view.clone()
            }
            None => {
                let sidebar = cx.entity().downgrade();
                let view = cx.new(|_| RowView {
                    drawn,
                    row: row.id.clone(),
                    address: row.address.clone(),
                    sidebar,
                });
                self.row_views.insert(row.id.clone(), view.clone());
                view
            }
        };
        view.cached(style).into_any_element()
    }

    /// A click on the list's row `id` (#1461): a press that went down on a row that had just moved is dropped, never
    /// passed to the row now under the pointer.
    fn click_row(
        &mut self,
        id: &str,
        address: &Address,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let at = match self.pressed.take() {
            Some((on, at)) if on == id => at,
            _ => now_ms(),
        };
        if !self.kept.takes_press(id, at) {
            return;
        }
        self.rows = SidebarRows {
            selected: Some(id.to_owned()),
            focused: Some(id.to_owned()),
        };
        window.focus(&self.focus_handle, cx);
        #[cfg(feature = "plant-row-skips-open")]
        if let Some(session) = id.strip_prefix("session:") {
            crate::open::skip_open(session, window, cx);
            cx.notify();
            return;
        }
        crate::open::open(address, window, cx).ok();
        cx.notify();
    }

    /// Reads the Agents page's model; a changed one draws.
    fn read_agents(&mut self, cx: &mut Context<Self>) {
        let page = crate::record::call("agents.read", json!({}));
        if page.is_some() && page != self.agents {
            self.agents = page;
            cx.notify();
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
            .map_or(copy::text("views.no_terminal").to_owned(), str::to_owned);
        let poll = cx.spawn(async move |this, cx| loop {
            cx.background_executor().timer(TERMINAL_TICK).await;
            if this.update(cx, |this, cx| this.read_terminal(cx)).is_err() {
                return;
            }
        });
        let focus = cx.focus_handle();
        TERMINAL_KEYS.with(|keys| *keys.borrow_mut() = Some(focus.clone()));
        self.terminal = Some(TerminalTab {
            session,
            focus,
            screen: None,
            words,
            outline: Vec::new(),
            pressing: false,
            _poll: poll,
        });
        self.read_terminal(cx);
    }

    /// #1498: your pointer on the terminal tab's grid, to the core ([`crate::select::grid`]).
    fn grid_pointer(
        &mut self,
        kind: &str,
        at: Point<Pixels>,
        count: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(tab) = self.terminal.as_mut() else {
            return;
        };
        let Some(screen) = &tab.screen else {
            return;
        };
        let size = (screen.cols, screen.rows.len());
        if let Some(outline) =
            crate::select::grid((kind, at, count), &tab.session, size, &mut tab.pressing)
        {
            tab.outline = outline;
        }
        cx.notify();
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

/// The count as the window says it: the menu bar's line, in words.
pub fn count_line() -> String {
    let reach = crate::notify::reach();
    if crate::setup::count().is_some() || !(reach.hub_down || crate::record::connected()) {
        return crate::menu_bar_line();
    }
    reach.count(asks_need_you(count()))
}

/// The one count sentence, which Home, the list and the menu bar say (#1455), in words that agree with the number
/// (#2026).
pub fn asks_need_you(count: usize) -> String {
    copy::count("views.asks_need_you", count as u64, &[])
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
            view: crate::open::take_pending(cx),
            focus_handle: cx.focus_handle(),
            page: false,
        });
        crate::open::set_slot(&slot, cx);
        Arc::new(slot)
    });
}

impl Panel for Shipped {
    fn panel_name(&self) -> &'static str {
        self.kind.name()
    }

    /// A view popped out leaves the shell: the dock draws the next panel in its place (#1172).
    fn visible(&self, cx: &App) -> bool {
        self.popped || crate::open::popped(cx) != Some(self.kind)
    }
}

/// The slot an extension's view fills in place of a shipped one (#326). It clips what the view paints to the
/// slot, so a view whose layout outgrows its slot, or that positions a child outside it, draws nothing past it.
pub const EXTENSION: &str = "deepbuild/extension";

thread_local! {
    static SLOT_BOUNDS: std::cell::Cell<Option<Bounds<Pixels>>> = const { std::cell::Cell::new(None) };
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

impl Slot {
    pub(crate) fn new(view: Option<AnyView>, page: bool, cx: &mut App) -> Entity<Self> {
        cx.new(|cx| Slot {
            view,
            focus_handle: cx.focus_handle(),
            page,
        })
    }

    pub(crate) fn set(&mut self, view: AnyView, cx: &mut Context<Self>) {
        self.view = Some(view);
        cx.notify();
    }
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let page = crate::open::page_of(crate::open::Region::Slot, cx)
            .filter(|_| crate::open::is_page_slot(&cx.entity(), cx));
        let slot = agents("agent-slot")
            .size_full()
            .relative()
            .overflow_hidden()
            .when(self.page, |slot| slot.p(sizes().space(1)))
            .child(
                canvas(
                    |bounds, _, _| SLOT_BOUNDS.with(|slot| slot.set(Some(bounds))),
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full(),
            )
            .children(self.view.clone());
        page_region(page, slot)
    }
}

/// The page region around `drawn` while it shows an address (#1460): one node whose `id` is that address, never drawn
/// or spoken, with what became of an address that showed nothing of its own, and the claim a session's page is at.
pub(crate) fn page_region(page: Option<crate::open::Page>, drawn: impl IntoElement) -> AnyElement {
    let Some(page) = page else {
        return drawn.into_any_element();
    };
    let notice = page.notice.map(|notice| {
        label("open-notice", notice)
            .h_auto()
            .py(sizes().space(0))
            .px(sizes().space(1))
    });
    let claim = page.claim.map(|claim| {
        label(
            ElementId::Name(format!("claim:{claim}").into()),
            copy::fill("views.claim", &[&claim]),
        )
        .px(sizes().space(1))
    });
    let inner = div()
        .size_full()
        .flex()
        .flex_col()
        .children(notice)
        .children(claim)
        .child(div().flex_1().min_h_0().w_full().child(drawn));
    match page.address {
        Some(address) => observed(ElementId::Name(address.into()))
            .role(Role::Group)
            .size_full()
            .child(inner)
            .into_any_element(),
        None => inner.into_any_element(),
    }
}

impl EventEmitter<PanelEvent> for Shipped {}

impl Focusable for Shipped {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

thread_local! {
    /// Each shipped view laid out since [`forget_drawn`], by its panel name, with its bounds.
    static DRAWN: RefCell<Vec<(&'static str, Bounds<Pixels>)>> = const { RefCell::new(Vec::new()) };
}

fn drew(name: &'static str, bounds: Bounds<Pixels>) {
    DRAWN.with(|drawn| {
        let mut drawn = drawn.borrow_mut();
        drawn.retain(|(n, _)| *n != name);
        drawn.push((name, bounds));
    });
}

/// Forgets the views laid out in earlier frames; [`crate::canvas::clear_items`] calls it.
pub(crate) fn forget_drawn() {
    DRAWN.with(|drawn| {
        LEFT.with(|left| *left.borrow_mut() = std::mem::take(&mut *drawn.borrow_mut()))
    });
}

thread_local! {
    /// What [`forget_drawn`] cleared: where the views laid out before it were (#1482).
    static LEFT: RefCell<Vec<(&'static str, Bounds<Pixels>)>> = const { RefCell::new(Vec::new()) };
}

/// A cached view GPUI reused doesn't lay out again: the places it had stay, by name (#1482).
pub fn keep_drawn(reused: &[&'static str]) {
    LEFT.with(|left| {
        DRAWN.with(|drawn| {
            let mut drawn = drawn.borrow_mut();
            for (name, bounds) in left.borrow().iter() {
                if reused.contains(name) && !drawn.iter().any(|(n, _)| n == name) {
                    drawn.push((name, *bounds));
                }
            }
        });
    });
}

/// Each shipped view laid out since the last frame began, by its panel name, with its bounds in window points (#1458).
pub fn drawn_views() -> Vec<(&'static str, Bounds<Pixels>)> {
    DRAWN.with(|drawn| drawn.borrow().clone())
}

/// An observed element keyed by `id`: its element ID, and when that is a name, the same name as its author ID in the
/// accessibility tree, so the replica's snapshot and the live tree carry one `id` that is never drawn or spoken
/// (#1459). A numbered ID is a place, so it gives the tree no `id`.
pub(crate) fn observed(id: impl Into<ElementId>) -> ObservedElement<Stateful<Div>> {
    let id = id.into();
    let author = match &id {
        ElementId::Name(name) => Some(name.clone()),
        _ => None,
    };
    let element = div().id(id).test_support();
    match author {
        Some(author) => element.accessibility_id(author),
        None => element,
    }
}

thread_local! {
    /// The sidebar row the keys reach, by its id, as the sidebar last drew it: none while keys go elsewhere.
    static RING: RefCell<Option<String>> = const { RefCell::new(None) };
    /// The keys of the session page's Terminal tab, once one opened (#1460).
    static TERMINAL_KEYS: RefCell<Option<FocusHandle>> = const { RefCell::new(None) };
    /// Whether the page that is the box alone gives the box the keys when it next draws (#1461).
    static FOCUS_BOX: Cell<bool> = const { Cell::new(false) };
    /// The session's page's view, and the keys of its title's field while you rename the session (#2018).
    static SESSION_VIEW: RefCell<Option<WeakEntity<Shipped>>> = const { RefCell::new(None) };
    static TITLE_KEYS: RefCell<Option<FocusHandle>> = const { RefCell::new(None) };
}

/// Rename, from the Session menu (#2018): the caret goes in `session`'s page's title, and Return saves the name.
pub fn rename(session: &str, window: &mut Window, cx: &mut App) {
    let Some(page) = SESSION_VIEW.with(|view| view.borrow().as_ref().and_then(WeakEntity::upgrade))
    else {
        return;
    };
    let session = session.to_owned();
    page.update(cx, |page, cx| page.start_rename(session, window, cx));
}

/// The session's page, notified: #1482's planted setter's notify, made without comparing.
pub(crate) fn notify_session_page(cx: &mut App) {
    let page = SESSION_VIEW.with(|view| view.borrow().as_ref().and_then(WeakEntity::upgrade));
    if let Some(page) = page {
        page.update(cx, |_, cx| cx.notify());
    }
}

/// The page that is the box alone gives the box the keys when it next draws (#1461).
pub(crate) fn focus_box_next() {
    FOCUS_BOX.with(|f| f.set(true));
}

/// The `id` of what holds the keyboard (#1459, #1462): the card's focused control while the card has it, the terminal,
/// the box, else the list's ringed row.
pub fn focus_id(window: &Window) -> Option<String> {
    if let Some(id) = crate::card::focus_id(window) {
        return Some(id);
    }
    if TERMINAL_KEYS.with(|keys| {
        keys.borrow()
            .as_ref()
            .is_some_and(|keys| keys.is_focused(window))
    }) {
        return Some("terminal".to_owned());
    }
    if TITLE_KEYS.with(|keys| {
        keys.borrow()
            .as_ref()
            .is_some_and(|keys| keys.is_focused(window))
    }) {
        return Some("session-title".to_owned());
    }
    if crate::words::focused(window) {
        return Some("box-draft".to_owned());
    }
    list_focused(window)
}

/// One row of the list as the keyboard walks it (#1462): its id, what typing matches (its title and project), and
/// the address Return opens.
#[derive(Clone, Debug, PartialEq)]
pub struct ListRow {
    pub id: String,
    pub title: String,
    pub project: String,
    pub address: Address,
}

thread_local! {
    /// The list's keys: the sidebar's, which holds them for the whole list, and the sidebar itself.
    static LIST_KEYS: RefCell<Option<(FocusHandle, WeakEntity<Shipped>)>> = const { RefCell::new(None) };
    /// The page's keys, the page region's view's, with the view's kind.
    static PAGE_KEYS: RefCell<Option<(Kind, FocusHandle)>> = const { RefCell::new(None) };
    /// The list's rows as the keyboard walks them, as last drawn.
    static LIST_ROWS: RefCell<Vec<ListRow>> = const { RefCell::new(Vec::new()) };
    /// The list's rows as last drawn, which focus follows a row that leaves by.
    static LAST_ROWS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
    /// The ask row the pointer is over, for #1462's planted hover-only control.
    static HOVERED: RefCell<Option<String>> = const { RefCell::new(None) };
    /// The row a secondary click opened the actions of, and where (#1462).
    static CONTEXT: RefCell<Option<(String, Point<Pixels>)>> = const { RefCell::new(None) };
}

/// The row the list's keyboard is on, while the list holds the keyboard.
pub fn list_focused(window: &Window) -> Option<String> {
    let keys = LIST_KEYS.with(|keys| keys.borrow().as_ref().map(|(keys, _)| keys.clone()))?;
    keys.is_focused(window)
        .then(|| RING.with(|ring| ring.borrow().clone()))
        .flatten()
}

/// Whether the list holds the keyboard, its ring drawn yet or not.
pub(crate) fn list_has_keys(window: &Window) -> bool {
    LIST_KEYS.with(|keys| {
        keys.borrow()
            .as_ref()
            .is_some_and(|(keys, _)| keys.is_focused(window))
    })
}

/// The open asks in the order Needs you draws them, each with its question: open ones oldest first, then those put
/// off till later (#1462).
pub fn open_asks() -> Vec<(String, String)> {
    record(Kind::NeedsYou, None)
        .open
        .into_iter()
        .map(|(handle, _, question, ..)| (handle, question))
        .collect()
}

/// The asks' handles in Needs you's order: what the next-ask key walks.
pub fn needs_you_order() -> Vec<String> {
    open_asks().into_iter().map(|(handle, _)| handle).collect()
}

/// The list's rows, in the order the window draws them (#1461): each ask, then each project's heading and its rows.
pub fn list_rows(_: &App) -> Vec<ListRow> {
    LIST_ROWS.with(|rows| rows.borrow().clone())
}

/// The rows of `items` the keyboard walks: every row, and each project's heading as `project:<project>` (#1462).
fn keyboard_rows(items: &[crate::list::Item]) -> Vec<ListRow> {
    // An ask's project is its session's.
    let ask_projects: HashMap<String, String> = crate::record::with_view(|view| {
        let table = view.table();
        view.inbox
            .iter()
            .filter_map(|ask| {
                let session = ask["session"].as_str()?;
                Some((ask["ask"].as_str()?.to_owned(), table.project(session)))
            })
            .collect()
    })
    .unwrap_or_default();
    let mut rows = Vec::new();
    let mut project = String::new();
    for item in items {
        match item {
            crate::list::Item::Heading { id, title, .. } if id != crate::list::HEADING => {
                let Some(name) = id.strip_prefix("heading:") else {
                    continue;
                };
                let id = crate::list::project_id((name != "none").then_some(name));
                project = title.clone();
                rows.push(ListRow {
                    id: format!("project:{id}"),
                    title: title.clone(),
                    project: title.clone(),
                    address: Address::new(crate::address::Place::Project, &id),
                });
            }
            crate::list::Item::Heading { .. } => {}
            crate::list::Item::Row(row) => rows.push(ListRow {
                id: row.id.clone(),
                title: row.title.clone(),
                project: match ask_projects.get(&row.id) {
                    Some(project) => project.clone(),
                    None => project.clone(),
                },
                address: row.address.clone(),
            }),
        }
    }
    rows
}

/// The id the keyboard reaches `item` by: a row's own, a project's heading's `project:<project>` (#1462).
fn keyboard_id(item: &crate::list::Item) -> Option<String> {
    match item {
        crate::list::Item::Row(row) => Some(row.id.clone()),
        crate::list::Item::Heading { id, .. } if id != crate::list::HEADING => {
            let name = id.strip_prefix("heading:")?;
            Some(format!(
                "project:{}",
                crate::list::project_id((name != "none").then_some(name))
            ))
        }
        crate::list::Item::Heading { .. } => None,
    }
}

/// Where the list's keyboard row `on` is among `items`: a row by its id, a project's heading by `project:<project>`.
fn item_at(items: &[crate::list::Item], on: &str) -> Option<usize> {
    items
        .iter()
        .position(|item| match (item, on.strip_prefix("project:")) {
            (crate::list::Item::Heading { id, .. }, Some(project)) => {
                id.strip_prefix("heading:").is_some_and(|name| {
                    crate::list::project_id((name != "none").then_some(name)) == project
                })
            }
            (item, None) => item.id() == on,
            _ => false,
        })
}

/// A project's heading (#1461) and, inside it, the row the keyboard reaches it by, `project:<project>`, which opens
/// the project's page (#1462).
fn project_heading(
    id: &str,
    title: &str,
    focused: Option<&str>,
    chrome: &chrome::Chrome,
    cx: &mut Context<Shipped>,
) -> ObservedElement<Stateful<Div>> {
    let name = id.strip_prefix("heading:").unwrap_or(id);
    let project = crate::list::project_id((name != "none").then_some(name));
    let row = format!("project:{project}");
    let ringed = focused == Some(row.as_str());
    let address = Address::new(crate::address::Place::Project, &project);
    let s = sizes();
    list_heading(id, title, None).child(
        observed(ElementId::Name(row.clone().into()))
            .role(Role::Button)
            .aria_label(title.to_owned())
            .when(ringed, |row| row.aria_active_descendant())
            .absolute()
            .inset_0()
            .rounded(s.radius)
            .border(s.ring)
            .border_color(if ringed {
                chrome.focus
            } else {
                chrome.focus.opacity(0.)
            })
            .on_click(cx.listener(move |this, _, window, cx| {
                this.rows.focused = Some(row.clone());
                window.focus(&this.focus_handle, cx);
                crate::open::open(&address, window, cx).ok();
                cx.notify();
            })),
    )
}

/// Gives the list the keyboard (Esc, F6), on the row it was on, else the open page's row, else its first.
pub fn focus_list(window: &mut Window, cx: &mut App) {
    crate::card::let_go();
    let Some((keys, list)) = LIST_KEYS.with(|keys| keys.borrow().clone()) else {
        return;
    };
    // A narrow window shows the list it gives the keyboard to (#1808).
    show_page_region(false, cx);
    let rows = list_rows(cx);
    let here = crate::open::current(cx).map(|address| address.to_string());
    if let Some(list) = list.upgrade() {
        list.update(cx, |list, cx| {
            let on = list.rows.focused.clone();
            if on.is_none_or(|on| !rows.iter().any(|row| row.id == on)) {
                list.rows.focused = rows
                    .iter()
                    .find(|row| Some(row.address.to_string()) == here)
                    .or(rows.first())
                    .map(|row| row.id.clone());
            }
            cx.notify();
        });
    }
    window.focus(&keys, cx);
}

/// F6: the keyboard moves from the list to the page, to the box, and back to the list.
pub fn next_area(window: &mut Window, cx: &mut App) {
    // The page's keys while its view is the page shown.
    let page = PAGE_KEYS
        .with(|keys| keys.borrow().clone())
        .filter(|(kind, _)| {
            crate::open::shown_region(cx) == Some(crate::open::Region::Shipped(*kind))
        })
        .map(|(_, keys)| keys);
    let on_page =
        crate::card::focused(window) || page.as_ref().is_some_and(|k| k.is_focused(window));
    if list_focused(window).is_some() {
        // A narrow window shows the page it gives the keyboard to (#1808).
        show_page_region(true, cx);
        if !crate::card::focus(window, cx) {
            match page {
                Some(keys) => window.focus(&keys, cx),
                None => crate::words::focus(window, cx),
            }
        }
    } else if on_page {
        crate::card::let_go();
        crate::words::focus(window, cx);
    } else {
        focus_list(window, cx);
    }
}

/// The row's actions, opened by a secondary click on it: the Session menu's, in its order (#886).
fn open_context(row: String, at: Point<Pixels>, window: &mut Window, cx: &mut App) {
    CONTEXT.with(|context| *context.borrow_mut() = Some((row.clone(), at)));
    if let Some((keys, list)) = LIST_KEYS.with(|keys| keys.borrow().clone()) {
        if let Some(list) = list.upgrade() {
            list.update(cx, |list, _| list.rows.focused = Some(row));
        }
        crate::card::let_go();
        window.focus(&keys, cx);
    }
    window.refresh();
}

/// The context menu's items: the Session menu's, and the planted menu's one more.
fn context_items() -> Vec<&'static str> {
    let mut items = crate::actions::session_items();
    if cfg!(feature = "plant-context-only-action") {
        items.push("Reveal in Finder"); // copy-exception: planted wrong program
    }
    items
}

/// The open context menu, drawn over the window where the click was.
fn context_menu(window: &Window) -> Option<AnyElement> {
    let (_, at) = CONTEXT.with(|context| context.borrow().clone())?;
    let chrome = chrome::of(window);
    Some(
        observed("context-menu")
            .role(Role::Menu)
            .aria_label(copy::text("views.actions"))
            .absolute()
            .left(at.x)
            .top(at.y)
            .flex()
            .flex_col()
            .p(sizes().space(0))
            .rounded(sizes().radius)
            .bg(chrome.raised)
            .border(sizes().hairline)
            .border_color(chrome.divider)
            .shadow_lg()
            .occlude()
            .on_mouse_down_out(|_, window, _| {
                CONTEXT.with(|context| *context.borrow_mut() = None);
                window.refresh();
            })
            .children(context_items().into_iter().map(|name| {
                observed(ElementId::Name(format!("context:{name}").into()))
                    .role(Role::MenuItem)
                    .aria_label(crate::actions::label(name))
                    .px(sizes().space(1))
                    .h(sizes().space(4))
                    .flex()
                    .items_center()
                    .rounded(sizes().radius)
                    .hover(|style| style.bg(chrome.hover))
                    .child(crate::actions::label(name))
                    .on_click(move |_, window, cx| {
                        CONTEXT.with(|context| *context.borrow_mut() = None);
                        crate::actions::run(name, window, cx);
                    })
            }))
            .into_any_element(),
    )
}

/// A line of text that is one accessibility node: a label named by its text, in the body role (#1458).
pub(crate) fn label(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    let text = text.into();
    observed(id)
        .role(Role::Label)
        .aria_label(text.clone())
        .typed(sizes().body)
        .h(sizes().body.line)
        .flex()
        .items_center()
        .child(text)
}

/// #1498: a line of content, drawn as a label draws it, that the kit's selection selects, its selection outlined in
/// `color`: a check's failure line. A label, a row or a button never selects.
pub(crate) fn content(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
    color: Hsla,
) -> ObservedElement<Stateful<Div>> {
    let text = text.into();
    observed(id)
        .role(Role::Label)
        .aria_label(text.clone())
        .typed(sizes().body)
        .h(sizes().body.line)
        .flex()
        .items_center()
        .child(crate::select::Outlined::new("text", text, color))
}

/// A page's title: the title role, so a page has one voice (#1458). A title longer than its row wraps, whole, and the
/// row grows with it (#1808).
pub(crate) fn title(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    // A title longer than its room ends in an ellipsis, its whole text in its accessible name, as a row's does: a page
    // at 360 pt wide draws nothing past its frame (#2403).
    label(id, text)
        .typed(s.title)
        .h_auto()
        .min_h(s.title.line + s.space(2))
        .min_w_0()
        .truncate()
}

/// A list's heading: the body role at medium weight (#1458).
fn heading(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    label(id, text).font_weight(FontWeight::MEDIUM)
}

/// How long the kit's overlays take to fade in, by opacity alone: the one motion chrome makes (#1458).
pub const OVERLAY_FADE: Duration = Duration::from_millis(120);

/// How long the pointer rests on a row before its tooltip shows.
const ROW_TIP_DELAY: Duration = Duration::from_millis(1500);

/// A row's tooltip (#1458): the row's whole text in a node of the tooltip role, in the small role.
struct RowTip(SharedString);

impl Render for RowTip {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (chrome, s) = (chrome::of(window), sizes());
        // #1458's planted tooltip keeps the kit's own text size.
        let kit = crate::plain::planted("tooltip-kit-size");
        observed("row-tip")
            .role(Role::Tooltip)
            .typed(s.small)
            .when(kit, |tip| tip.text_size(px(14.))) // size-literal-exception: #1458's planted wrong program, in an env-plants build only; review 2027-04-30
            .px(s.space(1))
            .py(s.space(0))
            .rounded(s.radius)
            .bg(chrome.raised)
            .border(s.hairline)
            .border_color(chrome.divider)
            .text_color(chrome.ink_primary)
            .child(self.0.clone())
            .with_animation(
                "row-tip-fade",
                Animation::new(OVERLAY_FADE),
                |tip, shown| tip.opacity(shown),
            )
    }
}

/// A control's kind (#1458): the page's one main action, a plain action, or a switch, on or off.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Control {
    Main,
    Plain,
    Switch(bool),
}

/// The one control builder (#1458): a button or a switch, one accessibility node named by its label, in the body
/// role at one height. A switch draws its state as a mark beside its label and carries it as the node's value,
/// `on` or `off`, never as a word in the label. No view styles a control itself.
pub(crate) fn control(
    id: impl Into<ElementId>,
    kind: Control,
    text: impl Into<SharedString>,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    let text = text.into();
    let (hover, pressed) = (chrome.hover, chrome.ink_secondary);
    // A label too long for its row wraps, and the control grows with it.
    let words = div().min_w_0().child(text.clone());
    let control = observed(id)
        .aria_label(text)
        .typed(s.body)
        .min_h(s.space(4))
        .flex()
        .items_center()
        .gap(s.space(1))
        .px(s.space(1))
        .rounded(s.radius);
    match kind {
        Control::Main => control
            .role(Role::Button)
            .px(s.space(3))
            .bg(chrome.ink_primary)
            .text_color(chrome.ground)
            .hover(move |style| style.bg(pressed))
            .child(words),
        Control::Plain => control
            .role(Role::Button)
            .hover(move |style| style.bg(hover))
            .child(words),
        Control::Switch(on) => control
            .role(Role::Switch)
            .aria_value(if on { "on" } else { "off" })
            .hover(move |style| style.bg(hover))
            .child(
                div()
                    .flex_none()
                    .size(s.space(2))
                    .rounded(s.radius)
                    .bg(if on { chrome.accent } else { chrome.divider }),
            )
            .child(words),
    }
}

/// What a view draws from the one record reader, read in its borrow so no event is copied to draw a frame, and only
/// what that view shows: its open asks, its sessions with their task's title and state, and the deadlines of the
/// first session's asks.
struct Record {
    /// Open asks, oldest first: `(handle, session, question, status, when its default applies)`.
    open: Vec<(String, String, String, String, Option<u64>)>,
    /// The sessions the view shows, in the order each first appears, with its task's title and its state: every
    /// one for the sidebar, the first for a session's page and its line, none for the others.
    sessions: Vec<(String, String, states::State)>,
    /// When each of the first session's open asks defaults, in event order: on a session's page only.
    deadlines: Vec<u64>,
    /// What a session's page shows by its real names (#1348): the session, its issue and branch, and its newest
    /// run's failure whole, its trace included. On a session's page only.
    details: Vec<String>,
    /// The sidebar's running jobs (#1925), in the list's order: each row's ID, its words, why it is there, and the
    /// status-map entry its row names (#1349: a job waiting on you is blocked, not running).
    jobs: Vec<(String, String, String, &'static str)>,
}

/// What the sidebar draws: every session, in the order each first appears, with its task's title and its state.
pub fn sidebar() -> Vec<(String, String, states::State)> {
    record(Kind::Sidebar, None).sessions
}

/// The one count, as the record the views draw stands: the window and the menu bar both read it (#1172).
pub fn count() -> usize {
    crate::record::with_view(|view| states::count(&view.table())).unwrap_or(0)
}

fn record(kind: Kind, opened: Option<&str>) -> Record {
    crate::record::with_view(|view| read(view, kind, opened))
        .unwrap_or_else(|| read(&crate::record::View::default(), kind, opened))
}

/// What the view `kind` draws of `view`, with the session `opened` open.
fn read(view: &crate::record::View, kind: Kind, opened: Option<&str>) -> Record {
    let table = view.table();
    // When each open ask's default applies, which its row's right edge shows (#1458).
    let applies: HashMap<String, u64> = table
        .open_asks(None)
        .into_iter()
        .filter_map(|ask| Some((states::handle(ask), table.deadline(ask)?)))
        .collect();
    let text = |row: &Value, key: &str| row[key].as_str().unwrap_or_default().to_owned();
    // A record that holds the list's rows (#1463) is drawn from them: the asks and the sessions the hub built, in the
    // list's order, with its titles and words, so the window, deep and deep status hold one list.
    let listed: Vec<&Value> = if table.listed() {
        table.list()
    } else {
        Vec::new()
    };
    let is_ask = |row: &Value| text(row, "id").starts_with("ask:");
    let open: Vec<(String, String, String, String, Option<u64>)> = if table.listed() {
        listed
            .iter()
            .filter(|row| is_ask(row))
            .map(|row| {
                let id = text(row, "id");
                // How the ask waits (folded, later, held) is the inbox's.
                let status = view
                    .inbox
                    .iter()
                    .find(|ask| ask["ask"] == id.as_str())
                    .and_then(|ask| ask["status"].as_str())
                    .unwrap_or("open")
                    .to_owned();
                let question = crate::question::visible(&text(row, "title"));
                let at = applies.get(&id).copied();
                (id, text(row, "session"), question, status, at)
            })
            .collect()
    } else {
        view.inbox
            .iter()
            .filter(|row| row["status"] != "closed")
            .map(|row| {
                // The row draws the question as the card does, its controls and direction marks shown (#1510).
                (
                    text(row, "ask"),
                    text(row, "session"),
                    crate::question::visible(&text(row, "question")),
                    text(row, "status"),
                    applies.get(&text(row, "ask")).copied(),
                )
            })
            .collect()
    };
    // Put off with Later, an ask goes below the open ones until it comes back, an hour before its default applies
    // (#1462): the list reads when by its clock.
    let clock = now();
    let until = |handle: &str| {
        view.inbox
            .iter()
            .find(|row| row["ask"] == handle)
            .and_then(|row| row["until"].as_u64())
    };
    let mut open = open;
    for (handle, _, _, status, _) in &mut open {
        match until(handle) {
            Some(until) if status == "later" && until <= clock => *status = "shown".to_owned(),
            // The view draws again when it comes back.
            Some(until) if status == "later" => states::changes_after(until - clock),
            _ => {}
        }
    }
    open.sort_by_key(|(_, _, _, status, _)| status == "later");
    // A session's page and its line draw the first session, or the one named "" when the record has none.
    let sessions: Vec<(String, String, states::State)> = match kind {
        Kind::Sidebar if table.listed() => listed
            .iter()
            .filter(|row| !is_ask(row))
            .map(|row| {
                let session = text(row, "session");
                let state = table.state(&session);
                (
                    session,
                    crate::question::visible(&text(row, "title")),
                    state,
                )
            })
            .collect(),
        Kind::Sidebar => table.every_session(),
        Kind::Session | Kind::Line => {
            let session = opened
                .map(str::to_owned)
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
            // Why its turn ended failed and the reasons the core gave its verdict, in words (#2029).
            let stopped = table.stopped(session);
            details.extend(stopped.map(|(cause, core)| crate::codes::stopped(&cause, &core)));
            let why = table.why(session).iter();
            details.extend(why.map(|(code, text)| crate::codes::reason(code, text)));
            if crate::plain::planted("session-page-line-pr") {
                details.push(crate::plain::PLANTED_PR_LINE.to_owned());
            }
            details
        }
        _ => Vec::new(),
    };
    // Each running job's row (#1925), as the hub built it: a job whose tool reports no counter says how long it has
    // run, which reads differently as the clock moves on.
    let jobs = match kind {
        Kind::Sidebar => listed
            .iter()
            .filter(|row| text(row, "id").starts_with("job:"))
            .map(|row| {
                if row["progress"].is_null() {
                    let since = row["since"].as_u64().unwrap_or(now());
                    states::changes_after(states::changes_in(now().saturating_sub(since)));
                }
                (
                    text(row, "id"),
                    states::job_words(row, now()),
                    text(row, "why"),
                    states::entry_of(row["entry"].as_str().unwrap_or("running")),
                )
            })
            .collect(),
        _ => Vec::new(),
    };
    Record {
        open,
        sessions,
        deadlines,
        details,
        jobs,
    }
}

/// The session a session's page and its line draw, with its task's title and state.
fn first(record: &Record) -> (String, String, states::State) {
    record.sessions[0].clone()
}

/// Moves the virtual clock a replica's views draw by to `now`, ms since the epoch (#1546). A replica's door, in no
/// shipped build (#1457).
#[cfg(feature = "fixtures")]
pub fn set_clock(now: u64) {
    CLOCK.with(|clock| clock.set(Some(now)));
}

/// The virtual clock's time where one runs (the replica), else the system's.
pub fn now() -> u64 {
    #[cfg(feature = "fixtures")]
    if let Some(virtual_now) = CLOCK.with(Cell::get) {
        return virtual_now;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
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
    // A length at the end of the words is the row's time, drawn in its own slot at the right edge (#1458): as wide as
    // a step of space at least, so a time ticking a digit longer moves nothing else in the row.
    let (said, time) = states::time_at_end(&text);
    let (said, time) = (said.to_owned(), time.map(str::to_owned));
    // #1458's planted row draws its time in the flow before the words, as wide as it reads, so a wider time pushes them.
    let inline = crate::plain::planted("time-flows-inline");
    let time = time.map(|time| {
        let slot = div().flex_none().child(time);
        if inline {
            slot
        } else {
            slot.min_w(sizes().space(5)).flex().justify_end()
        }
    });
    // Past the row's width the text ends in an ellipsis; the row's name keeps the whole of it.
    let words = div().flex_1().min_w_0().truncate();
    // #1458's planted row draws in the canvas's face, not the chrome's.
    let words = if crate::plain::planted("row-label-canvas-face") {
        words.font_family(deep_text_gpui::Role::Body.family())
    } else {
        words
    };
    #[cfg(feature = "plant-row")]
    let words = if ROW_PLANT.get() == Some(RowPlant::PastFrame) {
        div().flex_none()
    } else {
        words
    };
    // Its value is the state's status-map entry, a closed word an agent reads where the eye reads the glyph (#1459).
    let row = observed(id)
        .role(Role::Label)
        .aria_label(name)
        .aria_value(entry.to_owned())
        .typed(sizes().body)
        .h(sizes().body.line)
        .flex()
        .items_center()
        .gap(sizes().space(0))
        .child(
            div()
                .size(sizes().space(1))
                .flex_none()
                .bg(rgb(states::color(entry))),
        )
        .child(glyph);
    if inline {
        row.children(time).child(words.child(said))
    } else {
        row.child(words.child(said)).children(time)
    }
}

/// The bound values on `surface`, one accessibility node each named by its surface, its ID and
/// what it shows: its ID, the value, and where it comes from, muted, unless `titled` says the
/// surface's title already names it (#1455). A missing value shows the dash and says it wasn't reported.
fn bound_values(
    surface: bound::Surface,
    chrome: &chrome::Chrome,
    titled: bool,
) -> Vec<ObservedElement<Stateful<Div>>> {
    bound::on(surface)
        .into_iter()
        .enumerate()
        .map(|(index, b)| {
            let id = ElementId::Name(format!("bound-{}-{index}", surface.name()).into());
            let said = match &b.missing {
                Some(_) => copy::fill("views.not_reported", &[&b.text]),
                None => b.text.clone(),
            };
            observed(id)
                .role(Role::Label)
                .aria_label(b.name())
                .typed(sizes().body)
                .h(sizes().body.line)
                .flex()
                .items_center()
                .gap(sizes().space(1))
                .pl(sizes().space(2))
                .child(
                    div()
                        .w(relative(0.15))
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
                .children((!titled).then(|| div().text_color(chrome.ink_secondary).child(b.from)))
        })
        .collect()
}

/// A panel in the window holding the bound values bound to it, when any are, titled by the one assertion they bind;
/// values from more than one have no title (#1455).
fn bound_panel(chrome: &chrome::Chrome) -> Option<Stateful<Div>> {
    let bound = bound::on(bound::Surface::Panel);
    let named = bound
        .first()
        .map(|b| b.from.clone())
        .filter(|from| bound.iter().all(|b| &b.from == from));
    let values = bound_values(bound::Surface::Panel, chrome, named.is_some());
    (!values.is_empty()).then(|| {
        div()
            .id("bound-panel")
            .mt(sizes().space(1))
            .w_full()
            .p(sizes().space(1))
            .border(sizes().hairline)
            .border_color(chrome.divider)
            .flex()
            .flex_col()
            .children(named.map(|from| heading("bound-panel-title", from)))
            .children(values)
    })
}

/// A list row's time slot, as every surface writes it (#1458): how long in its state, or when an ask's default applies.
fn time_of(time: crate::list::Time, now: u64) -> String {
    match time {
        crate::list::Time::Since(at) => {
            let age = now.saturating_sub(at);
            states::changes_after(states::changes_in(age));
            states::span(age)
        }
        crate::list::Time::At(at) => states::moment(at, now),
    }
}

/// One slot of a list row (#1461): a node of its own, `<row id>:<slot>`, with the slot's bounds.
fn row_slot(row: &str, slot: &str, name: String) -> ObservedElement<Stateful<Div>> {
    observed(ElementId::Name(format!("{row}:{slot}").into()))
        .role(Role::Label)
        .aria_label(name)
}

/// How a row is drawn beyond its record: whether motion is reduced, and the width the list gives it, once measured.
#[derive(Clone, Copy)]
pub(crate) struct Shape {
    still: bool,
    width: Option<Pixels>,
}

/// Whether a row draws its time, given the room its title would have beside it and the width of its least title
/// (#1808): beside a long state word at the list's narrowest the time leaves what's drawn. An ask's time is when its
/// recommended answer applies (#1458, #1345), so an ask row keeps it, and its title takes what's left.
fn keeps_time(ask: bool, room: Pixels, least: Pixels) -> bool {
    ask || room >= least
}

/// The characters of its title a row keeps beside its state word at the list's narrowest (#1808). The 12 is drafted.
const TITLE_LEAST: usize = 12;

/// A title in a slot `room` wide (#1808): whole when it fits, else its longest start of whole characters with an ellipsis
/// after it that does, measured as it's drawn.
fn fitted(window: &Window, title: &str, room: Pixels, weight: FontWeight) -> String {
    let room = room - sizes().hairline * 2.;
    if drawn_width(window, title, weight) <= room {
        return title.to_owned();
    }
    use unicode_segmentation::UnicodeSegmentation as _;
    let ends: Vec<usize> = title
        .grapheme_indices(true)
        .map(|(at, grapheme)| at + grapheme.len())
        .collect();
    let cut = |n: usize| {
        let mut cut = title[..ends[n]].trim_end().to_owned();
        cut.push('…');
        cut
    };
    // The most characters whose cut fits, found by halves: the width grows with each character kept.
    let (mut fits, mut over) = (None, ends.len());
    let mut low = 0;
    while low < over {
        let n = (low + over) / 2;
        if drawn_width(window, &cut(n), weight) <= room {
            fits = Some(n);
            low = n + 1;
        } else {
            over = n;
        }
    }
    fits.map_or_else(|| "…".to_owned(), cut)
}

/// A title drawn in its slot on one line (#1808), as `cut` fits it, so it never draws under the slot to its right.
/// Before the list's width is known it's cut where the text system cuts it.
fn fit<E: Styled + ParentElement>(slot: E, title: String, cut: Option<String>) -> E {
    match cut {
        Some(cut) => slot.overflow_hidden().whitespace_nowrap().child(cut),
        None => slot.truncate().child(title),
    }
}

/// How wide `text` draws in the chrome's face at the body size and `weight`.
fn drawn_width(window: &Window, text: &str, weight: FontWeight) -> Pixels {
    if text.is_empty() {
        return px(0.);
    }
    let s = sizes();
    let run = TextRun {
        len: text.len(),
        font: Font {
            weight,
            ..font(s.face.clone())
        },
        color: Hsla::default(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    window
        .text_system()
        .shape_line(text.to_owned().into(), s.body.size, &[run], None)
        .width
}

/// Where a working mark's core sits in its slot at each step, in steps of the look's smallest space: it moves one step
/// for each event its session's hooks send, and holds still while none comes (#2021).
const MARK_STEPS: [usize; 4] = [0, 1, 2, 1];

/// One row of the list (#1461) at `now`, drawn as `shape` says.
fn list_row(
    row: &crate::list::Row,
    selected: bool,
    focused: bool,
    shape: Shape,
    now: u64,
    chrome: &chrome::Chrome,
    window: &Window,
) -> ObservedElement<Stateful<Div>> {
    row_element(
        &RowDrawn::of(row, selected, focused, shape, now, window),
        chrome,
    )
}

/// Everything one row of the list draws, read at `now` (#1482): the row, its texts and its ages as words. A row's
/// view keeps it and draws again only when it differs, so a frame that changes one row draws that row alone.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RowDrawn {
    /// The row's node id: the row's id unless a planted row keys its node by place.
    id: String,
    ask: bool,
    name: String,
    value: String,
    focused: bool,
    selected: bool,
    loud: bool,
    entry: &'static str,
    step: usize,
    title: String,
    /// A session's name and the short ID that tells it from a twin (#2018), apart.
    twin: Option<(String, String)>,
    word: String,
    drawn_word: String,
    flag: Option<(String, String)>,
    time: String,
    second: Option<String>,
    tall: Pixels,
    /// The title as its slot draws it once the list's width is known: whole, or cut at a whole character (#1808).
    cut: Option<String>,
    /// The title reads right to left from its first strong character, so from the slot's right (#1808).
    rtl: bool,
    /// The time is drawn: beside a long state word at the list's narrowest it leaves what's drawn (#1808).
    timed: bool,
    /// #1808's planted row draws its title whole, over the slots to its right.
    under: bool,
}

impl RowDrawn {
    pub(crate) fn of(
        row: &crate::list::Row,
        selected: bool,
        focused: bool,
        shape: Shape,
        now: u64,
        window: &Window,
    ) -> RowDrawn {
        let s = sizes();
        let still = shape.still;
        let ask = row.id.starts_with("ask:");
        let working = row.entry == "running" && row.id.starts_with("session:");
        let time = match row.hooks.1 {
            Some(heard) if still && working => copy::fill(
                "views.ago",
                &[&time_of(crate::list::Time::Since(heard), now)],
            ),
            _ => row.time.map(|t| time_of(t, now)).unwrap_or_default(),
        };
        // The working mark's step: one per event, or, in #2021's planted app, one each 300 ms whatever comes.
        let step = if !working {
            0
        } else if crate::plain::planted("mark-on-timer") {
            states::changes_after(300 - now % 300);
            MARK_STEPS[(now / 300 % 4) as usize]
        } else if still {
            0
        } else {
            MARK_STEPS[(row.hooks.0 % 4) as usize]
        };
        let line = row.doing.as_ref().map(|doing| doing.line(now));
        let reach = crate::notify::reach();
        // An ask's row reads as its question, its handle nowhere drawn (#1172) and its id (#1459). The planted rows
        // show the handle, or are keyed by their place.
        let title = if ask && cfg!(feature = "plant-handle-rows") {
            row.id.clone()
        } else {
            row.title.clone()
        };
        // The state word the hub wrote, in the language shown (#2403).
        let word = states::shown(&row.word);
        let name = if ask {
            if reach.not_notified(&row.id) {
                copy::fill("views.not_notified", &[&title])
            } else {
                title.clone()
            }
        } else if cfg!(feature = "plant-row-title-only") {
            title.clone()
        } else if ["BLOCKED", "INVALID", "INCONCLUSIVE"].contains(&row.word.as_str())
            && !row.why.is_empty()
        {
            // A verdict that isn't PASS or FAIL never reads as the bare word (#2018): the row is one line, so its name
            // holds whom it waits for and the evidence it leaves open.
            format!(
                "{} {title} · {word} · {}",
                states::glyph(row.entry),
                copy::hub(&row.why)
            )
        } else if let Some(line) = &line {
            format!("{} {title} · {word} · {line}", states::glyph(row.entry))
        } else {
            format!("{} {title} · {word}", states::glyph(row.entry))
        };
        // Its one flag beside its word (#2019), with what it says: the row is one line, so its name holds the rest.
        let name = match &row.flag {
            Some(flag) => format!("{name} · {}: {}", flag.code, flag.text),
            None => name,
        };
        let id = if ask && cfg!(feature = "plant-row-index-ids") {
            format!("ask-{}", row.id.len())
        } else {
            row.id.clone()
        };
        // A session's name with the short ID the hub added to tell it from a twin (#2018), apart.
        let twin = row
            .id
            .strip_prefix("session:")
            .map(|session| format!(" · {}", &session[..session.len().min(8)]))
            .and_then(|short| {
                let name = title.strip_suffix(short.as_str())?.to_owned();
                Some((name, short))
            });
        // A session waiting on you says so in its mark and its name: the heading Needs you carries the words (#1453
        // rule 9).
        let drawn_word = if !ask && row.entry == "needs_you" {
            String::new()
        } else {
            word.to_owned()
        };
        // #1461's planted row is 24 tall; #2021's selected row takes a second line, its session's line.
        let second = (selected && crate::plain::planted("selected-second-line") && !ask)
            .then(|| line.clone().unwrap_or_default());
        let tall = if crate::plain::planted("row-24") {
            s.space(4)
        } else if second.is_some() {
            s.space(5) * 2.
        } else {
            s.space(5)
        };
        let weight = if row.loud {
            FontWeight::SEMIBOLD
        } else {
            FontWeight::NORMAL
        };
        // A title that runs right to left from its first strong character reads from its slot's right, beside the
        // state word; the slots keep their sides (#1808).
        let rtl = unicode_bidi::get_base_direction(title.as_str()) == unicode_bidi::Direction::Rtl;
        // Once the list's width is known, the title's room is what the row's other slots leave it (#1808). Beside a long
        // state word at the list's narrowest the time leaves what's drawn, its slot kept in the tree with no width, so
        // the title keeps at least 12 characters.
        let wide = |text: &str, weight| drawn_width(window, text, weight);
        let roomy = shape.width.map(|width| {
            let flag = row.flag.as_ref().map_or(px(0.), |flag| {
                s.space(1) + wide(&flag.code, FontWeight::NORMAL)
            });
            let fixed = s.space(1) * 4. + s.space(3) + wide(&drawn_word, FontWeight::NORMAL) + flag;
            let time = (s.space(1) + wide(&time, FontWeight::NORMAL)).max(s.space(5));
            let mut least: String = title.chars().take(TITLE_LEAST).collect();
            if title.chars().count() > TITLE_LEAST {
                least.push('…');
            }
            let timed = keeps_time(ask, width - fixed - time, wide(&least, weight));
            (timed, width - fixed - if timed { time } else { px(0.) })
        });
        let timed = roomy.is_none_or(|(timed, _)| timed);
        // #1808's planted rows: a title drawn whole over the slots to its right, and one cut at 8 characters whatever
        // room it has.
        let under = crate::plain::planted("title-under-word");
        let eight = crate::plain::planted("title-shows-8");
        let twin = twin.filter(|_| !eight);
        let cut = if eight {
            let mut eight: String = title.chars().take(8).collect();
            eight.push('…');
            Some(eight)
        } else {
            roomy.map(|(_, room)| match &twin {
                Some((name, short)) => fitted(window, name, room - wide(short, weight), weight),
                None => fitted(window, &title, room, weight),
            })
        };
        RowDrawn {
            id,
            ask,
            name,
            value: row.value.clone(),
            focused,
            selected,
            loud: row.loud,
            entry: row.entry,
            step,
            title,
            twin,
            word: word.to_owned(),
            drawn_word,
            flag: (row.flag.as_ref()).map(|flag| (flag.code.clone(), flag.text.clone())),
            time,
            second,
            tall,
            cut,
            rtl,
            timed,
            under,
        }
    }
}

/// One row of the list as `drawn` holds it (#1461): one line, 32 tall, with fixed slots: the mark in 16 and 8 after
/// it, the title, then the state word and a time at least 32 wide at the right edge. An unread or asking row's title
/// is medium; a settled row's is regular in the secondary ink. Its name holds what's drawn and what's cut, and a
/// working session's what its turn is doing now (#2021). Under reduce motion a working mark holds still and its time
/// says when its session's last event came.
fn row_element(drawn: &RowDrawn, chrome: &chrome::Chrome) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    let id = drawn.id.as_str();
    let (ask, title, time) = (drawn.ask, drawn.title.clone(), drawn.time.clone());
    let whole: SharedString = drawn.name.clone().into();
    let ring = if drawn.focused {
        chrome.focus
    } else {
        chrome.focus.opacity(0.)
    };
    let ink = if drawn.loud {
        chrome.ink_primary
    } else {
        chrome.ink_secondary
    };
    // An ask's time is when its default applies, the moment #1458 names `<ask>:applies` too.
    let time_name = if ask {
        format!("{id}:applies")
    } else {
        format!("{id}:time")
    };
    let time_slot = if ask {
        row_slot(id, "time", time.clone()).child(
            observed(ElementId::Name(time_name.into()))
                .role(Role::Label)
                .aria_label(time.clone())
                .child(time),
        )
    } else {
        row_slot(id, "time", time.clone()).child(time)
    };
    observed(ElementId::Name(id.to_owned().into()))
        .role(Role::Button)
        .aria_label(drawn.name.clone())
        .aria_value(drawn.value.clone())
        .when(drawn.focused, |row| row.aria_active_descendant())
        .typed(s.body)
        // As wide as the list: a row its cached view lays out as a root shrinks to its words otherwise, and its state
        // word and time leave the right edge (#1808).
        .w_full()
        .h(drawn.tall)
        .flex_none()
        .flex()
        .items_center()
        .px(s.space(1))
        .rounded(s.radius)
        .relative()
        .hover(|style| style.bg(chrome.hover))
        .when(drawn.selected, |r| r.bg(chrome.selected))
        // The focus ring over the row, taking no room of its own, so the slots sit where they sit focused or not.
        .child(
            div()
                .absolute()
                .inset_0()
                .rounded(s.radius)
                .border(s.ring)
                .border_color(ring),
        )
        .tooltip(move |_, cx| cx.new(|_| RowTip(whole.clone())).into())
        .tooltip_show_delay(ROW_TIP_DELAY)
        // The mark: its core in the status color, in a slot of 16 with 8 after it.
        .child(
            row_slot(id, "mark", states::glyph(drawn.entry).to_owned())
                .aria_value(drawn.entry.to_owned())
                .flex_none()
                .w(s.space(3))
                .h_full()
                .mr(s.space(1))
                .flex()
                .items_center()
                .child(
                    div()
                        .size(s.space(1))
                        .ml(s.space(0) * drawn.step as f32)
                        .bg(rgb(states::color(drawn.entry))),
                ),
        )
        .child(
            // Each slot the row's full height, so the slots read in the row's order, left to right.
            row_slot(id, "title", title.clone())
                .flex_1()
                .min_w_0()
                .h_full()
                .flex()
                .items_center()
                .when(drawn.rtl, |slot| slot.justify_end())
                .text_color(ink)
                // Unread or asking stands out by weight alone: the chrome's face has no medium of its own, so it
                // takes the next weight it has (#1461).
                .font_weight(if drawn.loud {
                    FontWeight::SEMIBOLD
                } else {
                    FontWeight::NORMAL
                })
                .map(|slot| match (drawn.twin.clone(), drawn.under) {
                    // #1808's planted row: its title whole, in a box of its own over the slots to its right.
                    (_, true) => slot.relative().child(
                        div()
                            .absolute()
                            .left_0()
                            .top_0()
                            .bottom_0()
                            .flex()
                            .items_center()
                            .whitespace_nowrap()
                            .overflow_hidden()
                            .child(title),
                    ),
                    // The short ID that tells a session from its twin stays in view (#2018): a name too long for
                    // the row is cut, its ID never.
                    (Some((name, short)), false) => slot
                        .child(div().min_w_0().map(|cut| fit(cut, name, drawn.cut.clone())))
                        .child(div().flex_none().child(short)),
                    (None, false) => fit(slot, title, drawn.cut.clone()),
                }),
        )
        .child(
            row_slot(id, "word", drawn.word.clone())
                .flex_none()
                .h_full()
                .flex()
                .items_center()
                .pl(s.space(1))
                .text_color(chrome.ink_secondary)
                .child(drawn.drawn_word.clone()),
        )
        // The flag, at most one, in the right slot beside the word (#2019): never a state, so in the word's ink.
        .children(drawn.flag.as_ref().map(|(code, text)| {
            row_slot(id, "flag", format!("{code}: {text}"))
                .flex_none()
                .h_full()
                .flex()
                .items_center()
                .pl(s.space(1))
                .text_color(chrome.ink_secondary)
                .child(code.clone())
        }))
        .child(
            time_slot
                .flex_none()
                .h_full()
                .items_center()
                .map(|slot| {
                    if drawn.timed {
                        slot.min_w(s.space(5)).pl(s.space(1))
                    } else {
                        slot.w(px(0.)).overflow_hidden()
                    }
                })
                .flex()
                .justify_end()
                .text_color(chrome.ink_secondary),
        )
        .children(drawn.second.clone().map(|line| {
            div()
                .absolute()
                .bottom_0()
                .left(s.space(4))
                .text_color(chrome.ink_secondary)
                .child(line)
        }))
}

/// How tall an item of the list draws: a heading 32 with 8 above it, a row 32 (#1461), or 24 in #1461's planted list.
fn item_height(item: &crate::list::Item) -> Pixels {
    let s = sizes();
    match item {
        crate::list::Item::Heading { .. } => s.space(5) + s.space(1),
        crate::list::Item::Row(_) if crate::plain::planted("row-24") => s.space(4),
        crate::list::Item::Row(_) => s.space(5),
    }
}

/// A heading of the list (#1461): 32 tall with 8 above it, its title in the body role at medium weight, its value the
/// count it carries, if any.
fn list_heading(id: &str, title: &str, value: Option<String>) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    heading(ElementId::Name(id.to_owned().into()), title.to_owned())
        .when_some(value, |h, value| h.aria_value(value))
        .h(s.space(5))
        .mt(s.space(1))
        .px(s.space(1))
        .flex_none()
}

thread_local! {
    /// The view a layout put in the list's first section in place of the shipped Needs you (#1461): a replacement
    /// that passed `needs-you@1`.
    static NEEDS_YOU_VIEW: RefCell<Option<AnyView>> = const { RefCell::new(None) };
}

/// The time the views draw by: the virtual clock in a replica, else the system's.
fn now_ms() -> u64 {
    now()
}

/// Needs you's count as the heading carries it (#1461): its value, the number once read; its words, the one count
/// sentence, "reading" before the record is read, or the hub not answering. Never 0 while it can't be read.
fn needs_you_count(
    count: usize,
    empty: crate::empties::Empty,
    now: u64,
) -> (String, Option<String>, String) {
    use crate::empties::Empty;
    // #2026's planted count leaves out a decision's close: each ask a decision closed counts as open.
    let count = if crate::plain::planted("home-skips-decision-close") {
        count + crate::record::with_view(|view| view.table().decided()).unwrap_or(0)
    } else {
        count
    };
    // #2028's planted count adds the list's unread rows to the asks.
    let count = if crate::plain::planted("list-adds-unread") {
        count + crate::list::unread_rows()
    } else {
        count
    };
    match empty {
        // Nothing needs you only once setup finished (#2026): until then, what setup says, and no number.
        Empty::Nothing if count == 0 => match crate::setup::count() {
            Some(setup) => (setup.to_owned(), None, String::new()),
            None => (asks_need_you(0), None, "0".to_owned()),
        },
        // The planted count says "1 asks need you".
        Empty::Nothing if crate::plain::planted("count-one-asks") => (
            format!("{count} asks need you"), // copy-exception: planted wrong program
            Some(count.to_string()),
            count.to_string(),
        ),
        Empty::Nothing => (
            asks_need_you(count),
            Some(count.to_string()),
            count.to_string(),
        ),
        Empty::Reading => (
            copy::text(crate::empties::READING).to_owned(),
            Some(copy::text(crate::empties::READING).to_owned()),
            String::new(),
        ),
        // Every count says the hub isn't answering and since when, in place of a number (#2026).
        Empty::Unreachable { .. } => {
            let words = empty.words("", now);
            (words.clone(), Some(words), String::new())
        }
    }
}

/// Needs you's heading (#1461): its title and, at its right edge, the count drawn as its number, then the control that
/// pops the section out, drawn on hover and in the tree at rest (#1453 rule 10).
fn needs_you_heading(
    count: usize,
    empty: crate::empties::Empty,
    now: u64,
    popped: bool,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let (name, drawn, value) = needs_you_count(count, empty, now);
    let shown = chrome.ink_secondary;
    list_heading(
        crate::list::HEADING,
        copy::text("views.needs_you"),
        Some(value),
    )
    .justify_between()
    .group("needs-you-heading")
    .child(
        div()
            .flex()
            .items_center()
            .gap(sizes().space(1))
            .text_color(chrome.ink_secondary)
            .font_weight(FontWeight::NORMAL)
            .child(
                // As tall as the control beside it, so the two sit on one line in reading order.
                observed("sidebar-count")
                    .role(Role::Label)
                    .aria_label(name)
                    .aria_value(empty.value())
                    .min_h(sizes().space(4))
                    .flex()
                    .items_center()
                    .children(drawn),
            )
            .children((!popped).then(|| {
                control(
                    "needs-you-pop-out",
                    Control::Plain,
                    copy::text("views.pop_out"),
                    chrome,
                )
                .aria_label(copy::text("views.pop_out_needs_you"))
                .text_color(transparent_black())
                .group_hover("needs-you-heading", move |style| style.text_color(shown))
                .on_click(|_, _, cx| {
                    crate::open::pop_out(Address::page("needs-you"), Kind::NeedsYou, cx)
                })
            })),
    )
}

/// One of the three empties as a line (#1461), from one table: its mark, which only nothing here goes without, and its
/// words. Its value is its mark's status-map entry; `idle`, the calm one, is nothing here's.
fn empty_line(
    id: &'static str,
    nothing: &str,
    empty: crate::empties::Empty,
    now: u64,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    let words = empty.words(nothing, now);
    observed(id)
        .role(Role::Label)
        .aria_label(words.clone())
        .aria_value(empty.entry().unwrap_or("idle"))
        .typed(s.body)
        .h(s.space(5))
        .flex_none()
        .flex()
        .items_center()
        // In the list it sits in from the edge as a row does; on a page, on the lane's edge.
        .when(id == "list-empty", |line| line.px(s.space(1)))
        .text_color(chrome.ink_secondary)
        // Its mark in a row's mark slot; nothing here has none, and its words keep the page's left edge.
        .children(empty.entry().map(|entry| {
            div()
                .flex_none()
                .w(s.space(3))
                .mr(s.space(1))
                .flex()
                .items_center()
                .child(div().size(s.space(1)).bg(rgb(states::color(entry))))
        }))
        .child(div().flex_1().min_w_0().truncate().child(words))
}

/// The empty a place is in now (#1461): the hub said down, the record not read yet, or read.
fn empty_now() -> crate::empties::Empty {
    let reach = crate::notify::reach();
    let empty = crate::empties::Empty::of(reach.hub_down, reach.since, crate::record::read_yet());
    // #1461's planted app draws not read yet as couldn't read.
    if empty == crate::empties::Empty::Reading && crate::plain::planted("empties-alike") {
        return crate::empties::Empty::Unreachable { since: None };
    }
    empty
}

/// A page's title (#1461): where every page has it, a node `page-title` around the page's own title. The row stays as
/// its page scrolls (#1808); in a window too narrow for both regions it starts with Needs you's count, the way back to
/// the list, so the count is never off screen.
pub(crate) fn page_title(
    inner: impl IntoElement,
    chrome: &chrome::Chrome,
) -> ObservedElement<Stateful<Div>> {
    let s = sizes();
    observed("page-title")
        .role(Role::Group)
        .w_full()
        .flex_none()
        // #1808's planted narrow window shows no count on its page.
        .when(
            narrow() && !crate::plain::planted("narrow-no-count"),
            |row| {
                row.flex()
                    .items_center()
                    .gap(s.space(2))
                    .child(count_back(chrome))
            },
        )
        .child(div().flex_1().min_w_0().child(inner))
}

/// Needs you's count on a narrow window's page (#1808): its number, or what the count says while there's none to give,
/// as the list's heading carries it. A press shows the list with the keyboard on it, as Esc does.
fn count_back(chrome: &chrome::Chrome) -> ObservedElement<Stateful<Div>> {
    let (name, drawn, value) = needs_you_count(count(), empty_now(), now());
    let shown = match drawn {
        Some(drawn) if drawn != name => copy::fill("views.needs_you_drawn", &[&drawn]),
        Some(drawn) => drawn,
        None => copy::text("views.needs_you").to_owned(),
    };
    control("page-count", Control::Plain, shown, chrome)
        .aria_label(name)
        .aria_value(value)
        .flex_none()
        .on_click(|_, window, cx| focus_list(window, cx))
}

/// The reading lane of a page (#1461): its title row, then its content no wider than `min(720, page − 48)`, centred, so
/// text keeps one left edge; and the box at its foot, but on the first-launch page. Under the title the content scrolls,
/// from its top for each `scrolls` key (#1808); with none, the content keeps to the lane and scrolls inside itself.
pub(crate) fn in_lane(
    scrolls: Option<SharedString>,
    title: Option<AnyElement>,
    content: impl IntoElement,
    with_box: bool,
) -> Div {
    let s = sizes();
    // #1461's planted page draws its content and its box the page's width.
    let lane = if crate::plain::planted("page-no-lane") {
        crate::chrome::sizes().window.0 * 4.
    } else {
        s.lane
    };
    div()
        .size_full()
        .flex()
        .flex_col()
        .items_center()
        .px(s.space(4))
        .child(
            observed("lane")
                .role(Role::Group)
                .w_full()
                .max_w(lane)
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .children(title)
                // #1808's planted page cuts what's past its lane's foot, as the merge base's did.
                .child(
                    match scrolls.filter(|_| !crate::plain::planted("page-clips")) {
                        // Under its title the page scrolls (#1808), each address from its top.
                        Some(key) => div()
                            .id(ElementId::Name(format!("lane-scroll:{key}").into()))
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .flex()
                            .flex_col()
                            .overflow_y_scroll()
                            .child(content)
                            .into_any_element(),
                        // A page whose content scrolls inside itself, as a card's rows do.
                        None => div()
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .flex()
                            .flex_col()
                            .overflow_hidden()
                            .child(content)
                            .into_any_element(),
                    },
                ),
        )
        .children(with_box.then(words_box).flatten().map(|words| {
            div()
                .w_full()
                .max_w(lane)
                .flex_none()
                .pb(s.space(2))
                .child(words)
        }))
}

impl Render for Shipped {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The ages this frame writes, from here on, set the view's next tick (#1546).
        states::ages_written();
        let chrome = chrome::of(window);
        // While setup hasn't finished, the count says so, never a number of asks (#1002).
        let unfinished = crate::setup::count();
        let opened = crate::open::opened_session(cx);
        let now = now();
        let record = self.record_now(opened.as_deref(), now);
        let reach = crate::notify::reach();
        let name = self.kind.name();
        #[cfg(feature = "fixtures")]
        VIEW_NAMES.with(|names| names.borrow_mut().insert(cx.entity_id(), name));
        // A page in the center takes the keys F6 gives it (#1462): Esc gives them back to the list, and a printable key
        // goes to the box.
        let is_page = !matches!(self.kind, Kind::Sidebar | Kind::Line) && !self.popped;
        if is_page {
            let shows =
                crate::open::shown_region(cx) == Some(crate::open::Region::Shipped(self.kind));
            if shows {
                PAGE_KEYS
                    .with(|keys| *keys.borrow_mut() = Some((self.kind, self.focus_handle.clone())));
            }
        }
        let page = div()
            .id(ElementId::Name(format!("view:{name}").into()))
            // #1498: a press here, before a core surface takes it, leaves no core selection for ⌘C.
            .capture_any_mouse_down(|_, _, _| crate::select::pressed_elsewhere())
            .when(is_page, |page| {
                let keys = self.focus_handle.clone();
                page.track_focus(&self.focus_handle).on_key_down(
                    move |event: &KeyDownEvent, window, cx| {
                        // Only while the page itself holds the keyboard: the box and the terminal on it keep their keys.
                        if !keys.is_focused(window) {
                            return;
                        }
                        let stroke = &event.keystroke;
                        let m = stroke.modifiers;
                        if m.platform || m.control || m.alt || m.function {
                            return;
                        }
                        if stroke.key == "escape" {
                            focus_list(window, cx);
                            cx.stop_propagation();
                        } else if let Some(typed) = stroke
                            .key_char
                            .clone()
                            .filter(|c| !c.is_empty() && c.chars().all(|c| !c.is_control()))
                        {
                            crate::words::type_in(&typed, window, cx);
                            cx.stop_propagation();
                        }
                    },
                )
            })
            .size_full()
            .relative()
            .flex()
            .flex_col()
            .typed(sizes().body)
            .text_color(chrome.ink_primary)
            // Where the view was laid out, which a replica reads (#1458).
            .child(
                // Pinned to the view's edges, not its padding, so the bounds are the view's own.
                canvas(move |bounds, _, _| drew(name, bounds), |_, _, _, _| {})
                    .absolute()
                    .inset_0(),
            );
        let drawn = match self.kind {
            Kind::Sidebar => {
                let s = sizes();
                let empty = empty_now();
                let view =
                    self.list_in_view(unfinished.is_some(), record.jobs.len(), now, window, cx);
                let (items, pinned, offset) = (view.items.clone(), view.pinned, view.offset);
                let (end, top, room) = (view.end, view.top, view.room);
                let job = s.space(4) + s.small.line;
                // #1482's planted list asks for a frame each time it draws and draws the same value; its planted page
                // draws with it.
                if crate::plain::planted("animates-unchanged") {
                    window.request_animation_frame();
                }
                if crate::plain::planted("page-redraws-with-list") {
                    let page = SESSION_VIEW
                        .with(|view| view.borrow().as_ref().and_then(WeakEntity::upgrade));
                    if let Some(page) = page {
                        page.update(cx, |_, cx| cx.notify());
                    }
                }
                let replaced = NEEDS_YOU_VIEW.with(|view| view.borrow().clone());
                // The sidebar holds the keys for the whole list (#1462).
                LIST_KEYS.with(|keys| {
                    *keys.borrow_mut() = Some((self.focus_handle.clone(), cx.entity().downgrade()))
                });
                // The ring shows only while keys reach the list, so it never points where they don't go.
                let focused = (self.focus_handle.is_focused(window))
                    .then(|| self.rows.focused.clone())
                    .flatten();
                RING.with(|ring| *ring.borrow_mut() = focused.clone());
                let current = crate::open::current(cx);
                let planted_nothing = crate::plain::planted("hub-down-nothing-needs-you")
                    && matches!(empty, crate::empties::Empty::Unreachable { .. });
                let mut drawn: Vec<AnyElement> = Vec::new();
                // What's drawn above the rows that scroll: Needs you's heading and what goes under it.
                let mut heading_ends = None;
                for (n, item) in items.iter().enumerate() {
                    if n == pinned {
                        heading_ends = Some(drawn.len());
                    }
                    match item {
                        crate::list::Item::Heading { id, title, count } => {
                            if id == crate::list::HEADING {
                                // #2018's planted list counts the asks that went moot with the open ones.
                                let moot = if crate::plain::planted("group-count-moot") {
                                    crate::record::with_view(|view| {
                                        view.events
                                            .iter()
                                            .filter(|event| event["kind"] == "ask.moot")
                                            .count()
                                    })
                                    .unwrap_or(0)
                                } else {
                                    0
                                };
                                drawn.push(
                                    needs_you_heading(
                                        count.unwrap_or(0) + moot,
                                        empty,
                                        now,
                                        false,
                                        chrome,
                                    )
                                    .into_any_element(),
                                );
                                if matches!(empty, crate::empties::Empty::Unreachable { .. }) {
                                    // #2026's planted section says nothing needs you while the hub is down.
                                    let planted = "Nothing needs you"; // copy-exception: planted wrong program
                                    let (nothing, empty) = if planted_nothing {
                                        (planted, crate::empties::Empty::Nothing)
                                    } else {
                                        ("", empty)
                                    };
                                    drawn.push(
                                        empty_line("list-empty", nothing, empty, now, chrome)
                                            .into_any_element(),
                                    );
                                }
                                // An older hub gets the one screen naming it and its fix (#41), in place of rows.
                                drawn.extend(crate::record::older().map(|screen| {
                                    div()
                                        .id("hub-older")
                                        .flex()
                                        .flex_col()
                                        .gap(s.space(1))
                                        .px(s.space(1))
                                        .children(
                                            screen.lines().map(|line| div().child(line.to_owned())),
                                        )
                                        .into_any_element()
                                }));
                                // A view that replaces Needs you draws the section under its heading (#1461).
                                // It gets the room an installed view gets, as a script view fills its parent.
                                drawn.extend(replaced.clone().map(|view| {
                                    div()
                                        .w_full()
                                        .h(sizes().placed)
                                        .flex_none()
                                        .overflow_hidden()
                                        .child(view)
                                        .into_any_element()
                                }));
                            } else {
                                drawn.push(
                                    project_heading(id, title, focused.as_deref(), chrome, cx)
                                        .into_any_element(),
                                );
                            }
                        }
                        // #2026's planted section draws no ask rows while the hub is down.
                        crate::list::Item::Row(row)
                            if planted_nothing && row.id.starts_with("ask:") => {}
                        crate::list::Item::Row(row) => {
                            let selected = current.as_ref() == Some(&row.address)
                                || (current.is_none()
                                    && self.rows.selected.as_ref() == Some(&row.id));
                            let ring = focused.as_ref() == Some(&row.id);
                            let shape = Shape {
                                still: cx.reduce_motion(),
                                width: self.list_room.get().map(|area| area.width),
                            };
                            let drawn_row = RowDrawn::of(row, selected, ring, shape, now, window);
                            drawn.push(self.row_in_view(row, drawn_row, window, cx));
                        }
                    }
                }
                let mut rows_drawn = drawn.split_off(heading_ends.unwrap_or(drawn.len()));
                // Each running job's row (#1925), after the sessions as the list orders it: its mark, its kind and
                // its count from its tool's own counter, its time at the right edge, and why under it, quieter. A job
                // has no page, so the row opens nothing. Like the rows, only those in view are drawn.
                rows_drawn.extend(
                    record
                        .jobs
                        .iter()
                        .enumerate()
                        .filter(|(index, _)| end + job * (*index as f32) < top + room)
                        .map(|(index, (id, words, why, entry))| {
                            div()
                                .flex()
                                .flex_col()
                                .flex_none()
                                .child(
                                    marked(
                                        ElementId::Name(id.clone().into()),
                                        entry,
                                        words.clone(),
                                    )
                                    .h(s.space(4))
                                    .pl(s.space(2))
                                    .pr(s.space(0)),
                                )
                                .child(
                                    label(("sidebar-job-why", index), why.clone())
                                        .block()
                                        .typed(s.small)
                                        .h(s.small.line)
                                        .pl(s.space(3))
                                        .text_color(chrome.ink_secondary)
                                        .truncate(),
                                )
                                .into_any_element()
                        }),
                );
                // #1461's planted plug-in adds a section to the list, its own heading over it.
                let mut after: Vec<AnyElement> = Vec::new();
                if crate::plain::planted("sidebar-panel-in-list") {
                    for name in page_names() {
                        after.push(
                            list_heading(&format!("heading:{name}"), &name, None)
                                .into_any_element(),
                        );
                        after.push(
                            label(
                                ElementId::Name(format!("{name}:planted").into()),
                                "Test panel", // copy-exception: planted wrong program
                            )
                            .into_any_element(),
                        );
                    }
                }
                // Notifications off is its own line at the list's foot, never part of the count (#1455).
                let notice = (unfinished.is_none() && !reach.hub_down)
                    .then(|| reach.notice())
                    .flatten()
                    .map(|notice| {
                        label("sidebar-notice", notice)
                            .h_auto()
                            .py(s.space(0))
                            .px(s.space(1))
                    });
                // The list's edge is the one line the window has at rest (#1461): drawn on the list's frame, outside the
                // list, so the list is as wide as its rows and its inset.
                page.bg(chrome.ground)
                    .border_r(s.hairline)
                    .border_color(chrome.divider)
                    .track_focus(&self.focus_handle)
                    .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                        this.hovered = *hovered;
                        cx.notify();
                    }))
                    .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                        this.list_key(event, window, cx)
                    }))
                    .child(
                        // The list's region keeps its accessible name, Tasks (#1348), and draws no title (#1461).
                        observed("list")
                            .role(Role::Group)
                            .aria_label(copy::text("views.tasks"))
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .p(s.space(1))
                            .flex()
                            .flex_col()
                            .overflow_hidden()
                            // #1458's planted list draws an element wider than itself.
                            .when(crate::plain::planted("list-600pt-element"), |list| {
                                let wide = px(600.); // size-literal-exception: #1458's planted wrong program, in an env-plants build only; review 2027-04-30
                                let named = "Planted"; // copy-exception: planted wrong program
                                list.child(label("planted-wide", named).w(wide).flex_none())
                            })
                            .children(drawn)
                            .child(
                                // The rows that scroll, under Needs you's heading: the wheel moves them, and only those
                                // in view are drawn, from where the first of them starts (#1808).
                                div()
                                    .id("list-rows")
                                    .relative()
                                    .flex_1()
                                    .min_h_0()
                                    .w_full()
                                    .overflow_hidden()
                                    .on_scroll_wheel(cx.listener(
                                        |this, event: &ScrollWheelEvent, window, cx| {
                                            let delta =
                                                event.delta.pixel_delta(window.line_height());
                                            if delta.y != px(0.) {
                                                this.list_top -= delta.y;
                                                this.wheeled = true;
                                                cx.stop_propagation();
                                                cx.notify();
                                            }
                                        },
                                    ))
                                    .child({
                                        // How tall the rows' region is, which says how far the list scrolls.
                                        let measured = self.list_room.clone();
                                        let list = cx.entity().downgrade();
                                        canvas(
                                            move |bounds, _, cx| {
                                                if measured.get() != Some(bounds.size) {
                                                    measured.set(Some(bounds.size));
                                                    cx.defer(move |cx| {
                                                        list.update(cx, |_, cx| cx.notify()).ok();
                                                    });
                                                }
                                            },
                                            |_, _, _, _| {},
                                        )
                                        .absolute()
                                        .inset_0()
                                    })
                                    .child(
                                        div()
                                            .absolute()
                                            .left_0()
                                            .right_0()
                                            .top(offset)
                                            .flex()
                                            .flex_col()
                                            .children(rows_drawn),
                                    ),
                            )
                            .children(after)
                            .children(notice),
                    )
            }
            Kind::Home => {
                // A project's page (#1461): its title where every page's is, what needs you in one line, the area under
                // its picture (`home`), and the box. With no project it's the page the window opens on before there's
                // one: what's being read, or the box with words above it.
                let read = crate::record::read_yet();
                let reading = crate::list::read_now(now);
                let none = (Vec::new(), Vec::new());
                let (asks, sessions) = if read {
                    (&reading.0, &reading.1)
                } else {
                    (&none.0, &none.1)
                };
                let address =
                    crate::open::current(cx).filter(|a| a.place == crate::address::Place::Project);
                let project = address.as_ref().map(|a| {
                    sessions
                        .iter()
                        .find(|s| crate::list::project_id(s.project.as_deref()) == a.id)
                        .and_then(|s| s.project.clone())
                        .unwrap_or_else(|| a.id.clone())
                });
                let empty = empty_now();
                // The box takes the keys once it's there to take them.
                if project.is_none() && FOCUS_BOX.with(Cell::get) {
                    if let Some(keys) = crate::words::keys() {
                        FOCUS_BOX.with(|f| f.set(false));
                        window.focus(&keys, cx);
                    }
                }
                let line = match empty {
                    crate::empties::Empty::Nothing if !asks.is_empty() => {
                        label("home-needs-you", asks_need_you(asks.len())).into_any_element()
                    }
                    _ => {
                        let nothing = asks_need_you(0);
                        empty_line(
                            "empty",
                            crate::setup::count().unwrap_or(&nothing),
                            empty,
                            now,
                            chrome,
                        )
                        .into_any_element()
                    }
                };
                let heading = project.clone().unwrap_or_else(|| {
                    if read {
                        copy::text("views.new_task").to_owned()
                    } else {
                        "DeepBuild".to_owned() // copy-exception: the product's name stays as written
                    }
                });
                // #1461's planted page right after Set up is the box alone.
                let blank = project.is_none() && crate::plain::planted("blank-first-page");
                let heading = (!blank).then(|| {
                    page_title(title("home-title", heading), chrome)
                        .mt(sizes().space(4))
                        .into_any_element()
                });
                let content = div().flex().flex_col().when(!blank, |content| {
                    content.child(line).children(
                        project
                            .is_some()
                            .then(|| placed("home").into_iter().enumerate().map(placed_box))
                            .into_iter()
                            .flatten(),
                    )
                });
                page.child(in_lane(
                    Some(format!("home:{}", project.as_deref().unwrap_or_default()).into()),
                    heading,
                    content,
                    true,
                ))
            }
            Kind::NeedsYou => {
                // The list's first section on its own, as a window it popped out into shows it (#1461).
                let s = sizes();
                let (asks, _) = (*crate::list::read_now(now)).clone();
                let items = crate::list::build(&asks, &[]);
                let empty = empty_now();
                let current = crate::open::current(cx);
                let shape = Shape {
                    still: cx.reduce_motion(),
                    width: None,
                };
                // Its rows scroll as the list's do (#1808).
                page.p(s.space(1))
                    .overflow_y_scroll()
                    .child(needs_you_heading(
                        asks.len(),
                        empty,
                        now,
                        self.popped,
                        chrome,
                    ))
                    .children(
                        matches!(empty, crate::empties::Empty::Unreachable { .. })
                            .then(|| empty_line("list-empty", "", empty, now, chrome)),
                    )
                    .children(items.iter().filter_map(|item| match item {
                        crate::list::Item::Row(row) => {
                            let address = row.address.clone();
                            Some(
                                list_row(
                                    row,
                                    current.as_ref() == Some(&row.address),
                                    false,
                                    shape,
                                    now,
                                    chrome,
                                    window,
                                )
                                .on_click(move |_, window, cx| {
                                    crate::open::open(&address, window, cx).ok();
                                }),
                            )
                        }
                        _ => None,
                    }))
            }
            Kind::Session => {
                let (session, task, state) = first(&record);
                let mine = record
                    .open
                    .iter()
                    .filter(|(_, of, ..)| *of == session)
                    .count();
                // The hours to each deadline move with the clock a minute at a time, and the line ticks then (#1546).
                let minute = now - now % 60_000;
                let hours: Vec<f64> = record
                    .deadlines
                    .iter()
                    .map(|deadline| (*deadline as f64 - minute as f64) / 3_600_000.0)
                    .collect();
                if !hours.is_empty() {
                    states::changes_after(minute + 60_000 - now);
                }
                // The line's caption and its readout are the canvas's text (#390): the readout
                // is a bound number, tabular and never cut, holding its widest value's room. It
                // counts what its caption names (#1455).
                let planted = crate::plain::planted("readout-counts-asks");
                let (caption, counted) = if planted {
                    ("Hours to each deadline", mine) // copy-exception: planted wrong program
                } else {
                    (copy::text("views.asks_with_a_deadline"), hours.len())
                };
                let caption = text::Label::new(caption);
                let readout = text::Label {
                    bound: true,
                    ..text::Label::new(counted.to_string())
                };
                // The line's name, from what it draws.
                let line_name = copy::fill(
                    "views.hours_to_each_deadline",
                    &[&hours
                        .iter()
                        .map(|h| copy::fill("views.hours", &[&format!("{h:.0}")]))
                        .collect::<Vec<_>>()
                        .join(", ")],
                );
                // What a planted page draws beside the chart: the base's label, saying the caption again (#1459).
                let beside = format!("{}: {} points", caption.text, hours.len()); // copy-exception: planted wrong program
                let terminal = self.terminal.as_ref().filter(|tab| tab.session == session);
                let tab = (!session.is_empty()).then(|| {
                    let session = session.clone();
                    control(
                        "session-terminal",
                        Control::Plain,
                        copy::text("views.terminal"),
                        chrome,
                    )
                    .self_start()
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.open_terminal(session.clone(), cx);
                        if let Some(tab) = &this.terminal {
                            window.focus(&tab.focus, cx);
                        }
                    }))
                });
                let grid = terminal.map(|tab| {
                    div()
                        .id("session-terminal-keys")
                        .key_context("Terminal")
                        .track_focus(&tab.focus)
                        .relative()
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, e: &MouseDownEvent, _, cx| {
                                this.grid_pointer("down", e.position, e.click_count, cx)
                            }),
                        )
                        .on_mouse_move(cx.listener(|this, e: &MouseMoveEvent, _, cx| {
                            this.grid_pointer("move", e.position, 0, cx)
                        }))
                        .on_mouse_up(
                            MouseButton::Left,
                            cx.listener(|this, e: &MouseUpEvent, _, cx| {
                                this.grid_pointer("up", e.position, 0, cx)
                            }),
                        )
                        .child(terminal_view(tab, chrome))
                        .children(crate::select::grid_outline(&tab.outline, chrome.focus))
                });
                // The session's canvas, in the place of its deadlines' line (#1454).
                let figure = CANVAS
                    .with(|canvas| canvas.borrow().clone())
                    .filter(|panel| panel.read(cx).shows(&session));
                if let Some(panel) = &figure {
                    panel.update(cx, |panel, _| panel.show_session(&session));
                }
                let chart = terminal.is_none() && figure.is_none() && !hours.is_empty();
                // What the page shows by its real names, and the newest failure whole (#1348): content, which the kit's
                // selection selects (#1498).
                let details = record.details.iter().enumerate().map(|(n, line)| {
                    content(("session-detail", n), line.clone(), chrome.focus).h_auto()
                });
                // The page reads as its task's title, and to a screen reader as `Session <title>`. An untitled
                // session's short name, `Session <ID>`, is only its accessible name: the title draws no ID (#1455).
                let short = &session[..session.len().min(8)];
                // An untitled session's name is the one states.rs gives it, `Session <ID>` in the language shown.
                let untitled = task == copy::fill("states.untitled", &[&short]);
                let named = if untitled {
                    copy::fill("views.session_named", &[&short])
                } else {
                    copy::fill("views.session_named", &[&task])
                };
                let shown = if crate::plain::planted("title-draws-id") {
                    short.to_owned()
                } else if untitled {
                    copy::text("views.untitled_task").to_owned()
                } else {
                    task.clone()
                };
                // #1458's planted page draws its title at a fourth size.
                let fourth = crate::plain::planted("fourth-text-size");
                // Why it reads as it does, in plain words, under its title (#1348, #1461).
                // Where the hub built the session's row, its word, entry and why are that row's (#2018): the one
                // reading, on its page as in the list.
                // What its turn is doing now, at the top of its page (#2021): the row's line, read the one way; and its
                // flag beside its word, in full: what it says and its fix (#2019).
                type Read = (
                    Vec<String>,
                    Vec<String>,
                    Option<[String; 3]>,
                    Option<crate::list::Doing>,
                    Option<String>,
                );
                let (problem, readings, listed, doing, flagged): Read =
                    crate::record::with_view(|view| {
                        let table = view.table();
                        let problem = crate::plain::problem(&table, &session)
                            .map(|(happened, next)| vec![happened, next])
                            .unwrap_or_default();
                        let row = table.row_of(&format!("session:{session}"));
                        let listed = row.map(|row| {
                            ["word", "entry", "why"]
                                .map(|key| row[key].as_str().unwrap_or_default().to_owned())
                        });
                        let doing =
                            row.and_then(|row| crate::list::doing_of(view, row, &session, now));
                        let flagged = row.and_then(|row| {
                            let flag = &row["flag"];
                            let code = flag["code"].as_str()?;
                            let fix = flag["fix"].as_str().filter(|fix| !fix.is_empty());
                            Some(format!(
                                "{code}: {}{}",
                                flag["text"].as_str().unwrap_or_default(),
                                fix.map(|fix| format!(". {fix}")).unwrap_or_default()
                            ))
                        });
                        (
                            problem,
                            table.readings(&session).to_vec(),
                            listed,
                            doing,
                            flagged,
                        )
                    })
                    .unwrap_or_default();
                let reads = |id: &'static str, name: &str| match &listed {
                    Some([word, entry, _]) => marked(
                        id,
                        states::entry_of(entry),
                        format!("{name} · {}", states::shown(word)),
                    ),
                    None => status(id, &state, format!("{name} · {}", state.text(now))),
                };
                let why = listed
                    .as_ref()
                    .filter(|[_, _, why]| !why.is_empty())
                    .map(|[word, _, why]| format!("{}: {}", states::shown(word), copy::hub(why)));
                // The page fills its lane, so its canvas takes the height left under what's above it (#1498).
                let content = div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .when(session.is_empty(), |content| content.invisible());
                // While you rename it (#2018), the title is a field holding the name, with the caret in it.
                let field = self
                    .renaming
                    .as_ref()
                    .filter(|renaming| renaming.session == session)
                    .map(|renaming| renaming.input.clone());
                let heading = page_title(
                    match field {
                        Some(input) => observed("session-title")
                            .role(Role::TextInput)
                            .aria_label(named)
                            .aria_value(input.read(cx).value())
                            .h(sizes().title.line + sizes().space(2))
                            .child(gpui_kit::base::input::Input::new(&input)),
                        None => title("session-title", shown.clone())
                            .aria_label(named)
                            .when(fourth, |title| title.text_size(px(17.))), // size-literal-exception: #1458's planted wrong program, in an env-plants build only; review 2027-04-30
                    },
                    chrome,
                )
                .when(session.is_empty(), |heading| heading.invisible());
                let content = content
                    .children(doing.map(|doing| label("session-doing", doing.line(now)).h_auto()))
                    .children(why.map(|line| {
                        label("session-why", crate::question::visible(&line))
                            .h_auto()
                            .text_color(chrome.ink_secondary)
                    }))
                    .children(flagged.map(|line| {
                        label("session-flag", crate::question::visible(&line))
                            .h_auto()
                            .text_color(chrome.ink_secondary)
                    }))
                    .children(problem.into_iter().enumerate().map(|(n, line)| {
                        label(("session-problem", n), line)
                            .h_auto()
                            .text_color(chrome.ink_secondary)
                    }))
                    // Its newest readings (#990), quieter than its state, on its page since a row is one line (#1461).
                    .children(readings.into_iter().enumerate().map(|(n, reading)| {
                        label(("session-reading", n), reading)
                            .typed(sizes().small)
                            .h(sizes().small.line)
                            .text_color(chrome.ink_secondary)
                    }))
                    .children(details)
                    // The session's line, on its page (#1461): from its task to where it stands now, and what you placed there.
                    .child(reads("line-status", &task))
                    .children(placed("line"))
                    // The return card: what came back from the session's last stop, with the
                    // values bound to its runs' assertions (#629).
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .child(reads("return-card", &shown))
                            .children(bound_values(bound::Surface::Card, chrome, false)),
                    )
                    .children(tab)
                    .children(grid)
                    .children(figure.map(|panel| div().flex_1().min_h_0().w_full().child(panel)))
                    .when(chart, |page| {
                        // The chart is one node named from its own canvas text, its caption then its readout, so the
                        // readout is in the tree where it's drawn and no line beside it repeats the caption (#1459). The
                        // line inside it is named by its points (#1455).
                        let name = format!("{} {}", caption.text, readout.text);
                        page.child(
                            observed("session-chart")
                                .role(Role::Label)
                                .aria_label(name)
                                .w_full()
                                .flex_none()
                                .border(sizes().hairline)
                                .border_color(chrome.divider)
                                .flex()
                                .flex_col()
                                .child(
                                    div()
                                        .flex()
                                        .justify_between()
                                        .px(sizes().space(1))
                                        .py(sizes().space(0))
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
                                    // An observed element, so the live tree carries its id too (#1459).
                                    observed("session-line-figure")
                                        .role(Role::Image)
                                        .aria_label(line_name)
                                        // A height of its own: the lane it sits in grows with what it holds (#1461).
                                        .h(sizes().placed)
                                        .flex_none()
                                        .w_full()
                                        .child(
                                            canvas::line(
                                                "session-line",
                                                hours,
                                                chrome.session_line,
                                            )
                                            .size_full(),
                                        ),
                                ),
                        )
                        // The planted page keeps the base's hand-written label beside the chart, repeating its caption.
                        .when(cfg!(feature = "plant-chart-label-beside"), |page| {
                            page.child(label("session-line-label", beside))
                        })
                    })
                    .children(bound_panel(chrome));
                page.child(in_lane(
                    Some(format!("session:{session}").into()),
                    Some(heading.into_any_element()),
                    content,
                    true,
                ))
            }
            Kind::Welcome => page.child(crate::welcome::page(self, chrome, cx)),
            Kind::Agents => {
                let inner =
                    agents_page(div().id("agents-page").flex().flex_col(), self, chrome, cx);
                let heading = page_title(title("agents-title", copy::text("views.agents")), chrome);
                page.child(in_lane(
                    Some("agents".into()),
                    Some(heading.into_any_element()),
                    inner,
                    true,
                ))
            }
            Kind::Rules => {
                // The rules page (#344): each rule file with its total, then each rule with its scope, what enforces
                // it and its size. A rule nothing enforces reads "text only": the list to shrink.
                let files = crate::rules::read(&crate::hub::root().join("wiki").join("rules.md"));
                let rules: Vec<&crate::rules::Rule> = files.iter().flat_map(|f| &f.rules).collect();
                let text_only = rules.iter().filter(|r| r.text_only()).count();
                let mut row: usize = 0;
                let heading = page_title(title("rules-title", copy::text("views.rules")), chrome);
                let content = div()
                    .flex()
                    .flex_col()
                    .child(
                        label(
                            "rules-count",
                            copy::fill("views.rules_count", &[&rules.len(), &text_only]),
                        )
                        .text_color(chrome.ink_secondary),
                    )
                    .child(
                        // The column heads, at the rows' widths.
                        div()
                            .id("rules-head")
                            .typed(sizes().body)
                            .h(sizes().body.line)
                            .flex()
                            .items_center()
                            .gap(sizes().space(1))
                            .pl(sizes().space(3))
                            .mt(sizes().space(1))
                            .text_color(chrome.ink_secondary)
                            .font_weight(FontWeight::MEDIUM)
                            .child(div().flex_1().min_w_0().child(copy::text("views.rule")))
                            .child(div().w(relative(0.18)).child(copy::text("views.scope")))
                            .child(
                                div()
                                    .w(relative(0.2))
                                    .child(copy::text("views.enforced_by")),
                            )
                            .child(
                                div()
                                    .w(relative(0.1))
                                    .text_right()
                                    .child(copy::text("views.tokens_head")),
                            ),
                    )
                    .children(files.iter().enumerate().map(|(f, file)| {
                        div()
                            .flex()
                            .flex_col()
                            .mt(sizes().space(1))
                            .child(
                                label(
                                    ("rules-file", f),
                                    copy::fill("views.rules_file", &[&file.file, &file.tokens]),
                                )
                                .font_weight(FontWeight::MEDIUM),
                            )
                            .children(file.rules.iter().map(|rule| {
                                row += 1;
                                let mut said = copy::fill(
                                    "views.rule_said",
                                    &[&rule.text, &rule.scope, &rule.enforcer, &rule.tokens],
                                );
                                if rule.yours {
                                    said = copy::fill("views.rule_typed_by_you", &[&said]);
                                }
                                if rule.held {
                                    said = copy::fill("views.rule_held", &[&said]);
                                }
                                // The review's send-backs that named it (#1512): a reading, never a verdict.
                                let sent = rule.sent_back_said();
                                if let Some(sent) = &sent {
                                    said = copy::fill("views.rule_sent_back", &[&said, sent]);
                                }
                                observed(("rules-row", row))
                                    .role(Role::Label)
                                    .aria_label(said)
                                    .typed(sizes().body)
                                    .h(sizes().body.line)
                                    .flex()
                                    .items_center()
                                    .gap(sizes().space(1))
                                    .pl(sizes().space(3))
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .truncate()
                                            .child(rule.text.clone()),
                                    )
                                    .child(
                                        div()
                                            .w(relative(0.18))
                                            .truncate()
                                            .text_color(chrome.ink_secondary)
                                            .child(rule.scope.clone()),
                                    )
                                    .child(
                                        div()
                                            .w(relative(0.2))
                                            .truncate()
                                            .text_color(if rule.text_only() {
                                                chrome.ink_secondary
                                            } else {
                                                chrome.ink_primary
                                            })
                                            .when(!rule.text_only(), |e| {
                                                e.font_weight(FontWeight::MEDIUM)
                                            })
                                            .child(match sent {
                                                Some(sent) => format!("{} · {sent}", rule.enforcer),
                                                None => rule.enforcer.clone(),
                                            }),
                                    )
                                    .child(
                                        div()
                                            .w(relative(0.1))
                                            .text_right()
                                            .text_color(chrome.ink_secondary)
                                            .child(copy::fill("views.tokens", &[&rule.tokens])),
                                    )
                            }))
                    }));
                page.child(in_lane(
                    Some("rules".into()),
                    Some(heading.into_any_element()),
                    content,
                    true,
                ))
            }
            Kind::Line => {
                // The session's line: from its task to where it stands now.
                let (_, task, state) = first(&record);
                page.child(status(
                    "line-status",
                    &state,
                    format!("{task} · {}", state.text(now)),
                ))
                .children(placed("line"))
            }
        };
        self.tick_ages(now, cx);
        let page = crate::open::page_of(crate::open::Region::Shipped(self.kind), cx)
            .filter(|_| !self.popped);
        let drawn = page_region(page, drawn);
        // #1458's planted page fades in when shown, where chrome snaps.
        if self.kind == Kind::Session && crate::plain::planted("page-fades-250ms") {
            return div()
                .size_full()
                .child(drawn)
                .with_animation(
                    "planted-fade",
                    Animation::new(Duration::from_millis(250)),
                    |page, shown| page.opacity(shown),
                )
                .into_any_element();
        }
        drawn
    }
}

/// A path as the Agents page shows it: under your home as `~/...`.
fn home_path(path: &str) -> String {
    match std::env::var("HOME") {
        // copy-exception: an environment variable's name
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
    observed(id)
        .role(Role::Label)
        .aria_label(name)
        .flex()
        .gap(sizes().space(3))
        .typed(sizes().body)
        .h(sizes().body.line)
        .items_center()
        .child(
            div()
                .w(relative(0.25))
                .truncate()
                .font_weight(FontWeight::MEDIUM)
                .child(what),
        )
        .child(
            div()
                .w(relative(0.35))
                .truncate()
                .text_color(chrome.ink_secondary)
                .child(how),
        )
        .child(div().flex_1().min_w_0().truncate().child(wh))
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
        heading(id, text).mt(sizes().space(3)).mb(sizes().space(0))
    };
    let servers = list("servers").into_iter().enumerate().map(|(i, s)| {
        let spec = &s["spec"];
        let scope = spec["scope"]["repos"]
            .as_array()
            .filter(|r| !r.is_empty())
            .map_or(copy::text("views.every_repo").to_owned(), |repos| {
                let repos: Vec<String> = repos
                    .iter()
                    .filter_map(|r| r.as_str())
                    .map(|r| r.rsplit('/').next().unwrap_or(r).to_owned())
                    .collect();
                copy::fill("views.scoped_to", &[&repos.join(", ")])
            });
        let secrets = spec["secrets"]
            .as_array()
            .filter(|v| !v.is_empty())
            .map(|v| {
                let v: Vec<&str> = v.iter().filter_map(|x| x.as_str()).collect();
                copy::fill("views.by_handle", &[&v.join(", ")])
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
                copy::fill("views.synced_to", &[&names(&s["agents"])]),
            ],
            chrome,
        )
    });
    let skills = list("skills").into_iter().enumerate().map(|(i, k)| {
        let repo = k["repo"].as_str().unwrap_or_default();
        let commit = k["commit"].as_str().unwrap_or_default();
        let how = copy::fill(
            "views.skill_at",
            &[
                &repo.rsplit('/').next().unwrap_or(repo),
                &&commit[..commit.len().min(7)],
                &k["path"].as_str().unwrap_or_default(),
            ],
        );
        let pin = if k["differs"] == true {
            copy::text("views.pin_differs")
        } else {
            copy::text("views.pin_matches")
        };
        agents_row(
            ("agents-skill", i),
            [
                k["name"].as_str().unwrap_or_default().to_owned(),
                how,
                copy::fill("views.synced_to_pin", &[&names(&k["agents"]), &pin]),
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
                        copy::text("views.nothing_of_yours").to_owned()
                    } else {
                        mine.join(", ")
                    },
                    copy::text("views.yours_left_alone").to_owned(),
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
                .gap(sizes().space(3))
                .child(agents_row(
                    ("agents-waiting", i),
                    [
                        format!(
                            "{} {}",
                            s["kind"].as_str().unwrap_or_default(),
                            s["name"].as_str().unwrap_or_default()
                        ),
                        copy::fill("views.sync_files", &[&files, &reached.join(", ")]),
                        String::new(),
                    ],
                    chrome,
                ))
                .child(
                    control(
                        ("agents-review", i),
                        Control::Plain,
                        copy::text("views.review_the_diff"),
                        chrome,
                    )
                    .aria_label(copy::fill(
                        "views.review_the_diff_of",
                        &[&s["name"].as_str().unwrap_or_default()],
                    ))
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
    // Whether each agent's sessions reach DeepBuild, from its newest agent.reach (#2019): one waiting for its first
    // session says so, and one whose sessions can't reach DeepBuild says why, with its fix.
    let reach = crate::record::with_view(|view| view.table().agents().to_vec())
        .unwrap_or_default()
        .into_iter()
        .map(|(agent, r)| {
            let text = |key: &str| r[key].as_str().unwrap_or_default().to_owned();
            let [how, fix] = match r["state"].as_str() {
                Some("waiting") => [
                    copy::text("views.waits_first_session").to_owned(),
                    String::new(),
                ],
                Some("unreachable") => [
                    copy::fill("views.cant_reach", &[&copy::hub(&text("why"))]),
                    copy::hub(&text("fix")),
                ],
                _ => [copy::text("views.reaches").to_owned(), String::new()],
            };
            let name = r["name"].as_str().unwrap_or(&agent).to_owned();
            agents_row(
                ElementId::Name(format!("agent:{agent}").into()),
                [name, how, fix],
                chrome,
            )
        })
        .collect::<Vec<_>>();
    // The page's title and its scrolling are the lane's (#1808).
    // The planted wrong program draws the page's title alone.
    if crate::plain::planted("agents-title-only") {
        return page;
    }
    page.child(section(
        "agents-reach-title",
        copy::text("views.how_each_agent_reaches"),
    ))
    .children(reach)
    .child(label(
        "agents-installed",
        copy::fill("views.installed", &[&named(true)]),
    ))
    .child(
        label(
            "agents-missing",
            copy::fill("views.not_installed_here", &[&named(false)]),
        )
        .text_color(chrome.ink_secondary),
    )
    .child(section(
        "agents-servers-title",
        copy::text("views.mcp_servers"),
    ))
    .children(servers)
    .child(section("agents-skills-title", copy::text("views.skills")))
    .children(skills)
    .child(section(
        "agents-yours-title",
        copy::text("views.already_in_each_agent"),
    ))
    .children(yours)
    .child(section(
        "agents-waiting-title",
        copy::text("views.waiting_for_you"),
    ))
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
        let read = match readers.as_slice() {
            [] => String::new(),
            [one] => copy::fill("views.read_by", &[one]),
            [first, rest @ ..] => copy::fill("views.read_by_both", &[first, &rest.join(", ")]),
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
            .mt(sizes().space(1))
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
                    .p(sizes().space(1))
                    .bg(chrome.raised)
                    .border(sizes().hairline)
                    .border_color(chrome.divider)
                    .children(lines.iter().enumerate().map(|(n, line)| {
                        let color = match line.chars().next() {
                            Some('+') => chrome.ink_primary,
                            _ => chrome.ink_secondary,
                        };
                        text::label(&format!("agents-diff-{i}-{n}"), mono(line), color, None)
                    })),
            )
    });
    let refusals = refused.iter().enumerate().map(|(i, r)| {
        label(
            ("agents-refused", i),
            copy::fill(
                "views.refuses_field",
                &[
                    &name_of(r["agent"].as_str().unwrap_or_default()),
                    &r["field"].as_str().unwrap_or_default(),
                    &r["reason"].as_str().unwrap_or_default(),
                ],
            ),
        )
        .text_color(chrome.ink_secondary)
    });
    div()
        .id("agents-review-panel")
        .mt(sizes().space(2))
        .p(sizes().space(2))
        .border(sizes().hairline)
        .border_color(chrome.divider)
        .rounded(sizes().radius)
        .flex()
        .flex_col()
        // Apply and Close beside the title, so they show however long the diff runs.
        .child(
            div()
                .flex()
                .items_center()
                .gap(sizes().space(1))
                .child(
                    label(
                        "agents-review-title",
                        copy::fill(
                            "views.approve_the_sync",
                            &[&sync["name"].as_str().unwrap_or_default()],
                        ),
                    )
                    .flex_1()
                    .font_weight(FontWeight::MEDIUM),
                )
                .child(
                    control(
                        "agents-apply",
                        Control::Main,
                        copy::text("views.apply"),
                        chrome,
                    )
                    .aria_label(copy::text("views.apply_the_sync"))
                    .on_click(move |_, window, cx| {
                        crate::open::open(&Address::ask(&ask), window, cx).ok();
                    }),
                )
                .child(
                    control(
                        "agents-close",
                        Control::Plain,
                        copy::text("views.close"),
                        chrome,
                    )
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
    // No line under the bar at rest: the list's edge is the window's one line (#1461).
    let bar = TitleBar::new().border_b_0();
    let bar = if dark { bar.bg(chrome.raised) } else { bar };
    bar.child(
        observed("title-bar-mark").flex().items_center().child(
            svg()
                .data(brand::TITLE_BAR_MARK)
                .size(px(brand::TITLE_BAR_MARK_PX)) // size-literal-exception: the kit's artwork at brand/surfaces.json's size (#79); review 2027-04-30
                .text_color(ink),
        ),
    )
}

/// Which panel fills each region of the window (#1461): the list on the left, and the pages it opens on the right.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    /// The list.
    pub sidebar: String,
    /// The pages, by panel name; `active` is drawn. No tab strip is drawn over them.
    pub center: Vec<String>,
    pub active: usize,
    /// The session's line, drawn on a session's page.
    pub line: String,
    /// The list's first section: the shipped Needs you, or a view that replaces it and passed `needs-you@1`.
    pub needs_you: String,
}

impl Layout {
    /// The app's window with `needs-you`, `session`, `home` or `rules` showing, so a replica draws the app's tree
    /// (#1454). `needs-you` and `sidebar` open on what the window opens on: the first open ask, else the latest
    /// project. Any other name is a mistake, not a view.
    pub fn shipped(view: &str) -> Self {
        let active = match view {
            "needs-you" | "home" | "sidebar" => HOME,
            "session" => SESSION,
            "rules" => RULES,
            other => {
                panic!("{other} is not a shipped view; the shipped views are {SHIPPED_VIEWS:?} and home")
            }
        };
        let center: Vec<String> = [HOME, SESSION, AGENTS, RULES].map(str::to_owned).into();
        Self {
            sidebar: SIDEBAR.into(),
            active: center.iter().position(|name| name == active).unwrap_or(0),
            center,
            line: LINE.into(),
            needs_you: NEEDS_YOU.into(),
        }
    }

    /// The app's window (#1172, #1461): the list, and the pages, with the first-launch page first while setup hasn't
    /// finished, or a mounted panel's view first.
    pub fn app(panel: bool) -> Self {
        let mut center: Vec<String> = [HOME, SESSION, AGENTS].map(str::to_owned).into();
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
            needs_you: NEEDS_YOU.into(),
        }
    }

    /// The window's two regions: the list docked left, the pages beside it, and nothing docked anywhere else.
    pub fn state(&self) -> DockAreaState {
        let tabs = |names: &[String], active: usize| PanelState {
            panel_name: "TabPanel".into(), // copy-exception: the dock's panel name, an identity
            children: names.iter().map(PanelState::new).collect(),
            info: PanelInfo::tabs(active),
        };
        DockAreaState {
            version: None,
            center: tabs(&self.center, self.active),
            left_dock: Some(DockState::new(
                tabs(std::slice::from_ref(&self.sidebar), 0),
                DockPlacement::Left,
                sizes().sidebar,
                true,
            )),
            right_dock: None,
            bottom_dock: None,
        }
    }
}

thread_local! {
    /// The box at the foot of every page (#1461): one component, which the page shown draws.
    static BOX: RefCell<Option<Entity<crate::words::WordsBox>>> = const { RefCell::new(None) };
}

/// The box the page shown draws at its foot.
pub(crate) fn words_box() -> Option<Entity<crate::words::WordsBox>> {
    BOX.with(|b| b.borrow().clone())
}

/// The window's root (#1461): the list and the page, ⌘K over them once views give it entries (#366).
/// The dock draws each group's displayed panel as a cached view (#1482): a panel draws again only when it's notified or
/// the window refreshes, so a pointer over the list draws nothing on the page beside it.
struct CachedPanels;

impl gpui_kit::base::dock::DockAreaRenderer for CachedPanels {
    fn tab_group_renderer(&self) -> std::rc::Rc<dyn gpui_kit::base::dock::TabGroupRenderer> {
        std::rc::Rc::new(CachedPanels)
    }
}

impl gpui_kit::base::dock::TabGroupRenderer for CachedPanels {
    fn render_tab_bar(
        &self,
        _: &gpui_kit::base::dock::TabGroupContext,
        _: &mut Window,
        _: &mut App,
    ) -> AnyElement {
        Empty.into_any_element()
    }

    fn render_active_panel(
        &self,
        panel: AnyView,
        _: &gpui_kit::base::dock::TabGroupContext,
        _: &mut Window,
        cx: &mut App,
    ) -> AnyElement {
        // The list draws each of its rows as a cached view, and GPUI draws a cached view's own cached views again
        // whenever it draws that view, so the list itself is not cached: it draws when a row does, and reuses the rest.
        let list = panel
            .clone()
            .downcast::<Shipped>()
            .is_ok_and(|panel| panel.read(cx).kind == Kind::Sidebar);
        if list {
            return div().size_full().child(panel).into_any_element();
        }
        panel
            .cached(StyleRefinement::default().size_full())
            .into_any_element()
    }
}

pub struct Shell {
    pub dock: Entity<DockArea>,
    commands: Option<Entity<crate::commands::Palette>>,
    focus_handle: FocusHandle,
    /// Whether the shell draws the window's title bar, as the app's does.
    title_bar: bool,
    /// The list's width as you left it; the window keeps it between the list's narrowest and the window less the
    /// page's narrowest, and hides the list where both don't fit.
    list_width: Pixels,
    /// Whether the list's edge is being dragged.
    resizing: bool,
    /// A window too narrow for both regions shows one of them (#1808): the page while this is set, else the list.
    hidden: bool,
    /// Whether the window was that narrow when it last drew, once it has drawn.
    was_narrow: Option<bool>,
    /// The app's own window keeps its frame as it changes (#1808).
    _frame: Option<Subscription>,
}

thread_local! {
    /// The window's root, which a narrow window's region is set on (#1808).
    static SHELL: RefCell<Option<WeakEntity<Shell>>> = const { RefCell::new(None) };
    /// Whether the window is too narrow for both regions, as it last drew: its pages then carry the count (#1808).
    static NARROW: Cell<bool> = const { Cell::new(false) };
}

/// Whether the window is too narrow for the list and the page together, so it shows one at a time (#1808).
pub fn narrow() -> bool {
    NARROW.with(Cell::get)
}

/// A narrow window shows the page (`true`) or the list (#1808); a wide one shows both whatever this says.
pub fn show_page_region(page: bool, cx: &mut App) {
    let Some(shell) = SHELL.with(|shell| shell.borrow().as_ref().and_then(WeakEntity::upgrade))
    else {
        return;
    };
    shell.update(cx, |shell, cx| shell.set_hidden(page, cx));
}

impl Shell {
    pub fn new(layout: &Layout, window: &mut Window, cx: &mut Context<Self>) -> Self {
        chrome::follow(window, cx);
        let dock = cx.new(|cx| {
            DockArea::new("deepbuild", None, window, cx)
                .with_renderer(std::rc::Rc::new(CachedPanels))
        });
        dock.update(cx, |dock, cx| dock.load(layout.state(), window, cx))
            .expect("the layout loads");
        crate::open::set_shell(&dock, window.window_handle(), cx);
        // A view that replaces Needs you fills the list's first section (#1461).
        let replaced = (layout.needs_you != NEEDS_YOU)
            .then(|| {
                let state = PanelState::new(&layout.needs_you);
                let info = PanelInfo::panel(serde_json::Value::Null);
                let context =
                    gpui_kit::base::dock::PanelBuildContext::new(dock.downgrade(), &state, &info);
                gpui_kit::base::dock::PanelRegistry::build_panel(
                    &layout.needs_you,
                    context,
                    window,
                    cx,
                )
            })
            .flatten()
            .map(|panel| panel.view());
        NEEDS_YOU_VIEW.with(|view| *view.borrow_mut() = replaced);
        // The box is this window's, set once it's made (#1461).
        BOX.with(|b| *b.borrow_mut() = None);
        FOCUS_BOX.with(|f| f.set(false));
        // A layout showing a session's page shows the record's first session (#1738); any other opens as the window
        // does once the record is read.
        let showing = layout.center.get(layout.active).map(String::as_str);
        crate::open::set_opens(matches!(showing, Some(HOME | WELCOME)), cx);
        if showing == Some(SESSION) {
            let first =
                crate::record::with_view(|view| view.table().sessions().first().cloned()).flatten();
            if let Some(first) = first {
                crate::open::open(&Address::session(&first), window, cx).ok();
            }
        } else {
            crate::open::open_first(window, cx);
        }
        SHELL.with(|shell| *shell.borrow_mut() = Some(cx.entity().downgrade()));
        Self {
            dock,
            commands: None,
            focus_handle: cx.focus_handle(),
            title_bar: false,
            list_width: sizes().sidebar,
            resizing: false,
            hidden: true,
            was_narrow: None,
            _frame: None,
        }
    }

    /// The app's own window comes back as you left it, and keeps itself from now on (#1808): the list's width and which
    /// region a narrow window shows are `kept`'s, and each change to them or to the window's frame is kept.
    pub fn keep(&mut self, kept: crate::frame::Kept, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(width) = kept.list {
            self.list_width = px(width);
        }
        if let Some(hidden) = kept.hidden {
            self.hidden = hidden;
        }
        crate::frame::start(kept);
        crate::frame::keep_window(window, cx);
        crate::frame::keep(|kept| kept.list = Some(f32::from(self.list_width)));
        self._frame = Some(cx.observe_window_bounds(window, |_, window, cx| {
            crate::frame::keep_window(window, cx)
        }));
    }

    /// A narrow window shows the page, or the list, from now on.
    fn set_hidden(&mut self, hidden: bool, cx: &mut Context<Self>) {
        if self.hidden != hidden {
            self.hidden = hidden;
            crate::frame::keep(|kept| kept.hidden = Some(hidden));
            cx.notify();
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

    /// The box every page draws at its foot (#1998, #1461).
    pub fn set_box(&mut self, words: Entity<crate::words::WordsBox>, cx: &mut Context<Self>) {
        BOX.with(|b| *b.borrow_mut() = Some(words));
        cx.notify();
    }

    /// Keeps the list at the width you left it, inside the window's bounds, or hidden where it can't fit (#1461).
    fn fit_list(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let wide = window.viewport_size().width;
        let fitted = chrome::list_width(self.list_width, wide);
        self.dock.update(cx, |dock, cx| {
            let open = dock.is_dock_open(DockPlacement::Left);
            match fitted {
                None if open => dock.toggle_dock(DockPlacement::Left, window, cx),
                Some(width) => {
                    if !open {
                        dock.toggle_dock(DockPlacement::Left, window, cx);
                    }
                    if dock.dock_size(DockPlacement::Left) != Some(width) {
                        dock.set_dock_size(DockPlacement::Left, width, window, cx);
                    }
                }
                None => {}
            }
        });
    }
}

thread_local! {
    /// When you last gave the window input, for presence (#1461).
    static LAST_INPUT: Cell<Option<u64>> = const { Cell::new(None) };
}

/// When you last gave the window input: a key or a press.
pub fn last_input() -> Option<u64> {
    LAST_INPUT.with(Cell::get)
}

/// Notes input at `now`. The replica's input reaches the window the same way.
fn touched() {
    LAST_INPUT.with(|last| last.set(Some(now())));
}

/// Time passed: the card shown arms or leaves for the next ask, the window opens where it opens once the record is
/// read, and a row whose page has been open a second while you're present reads as read (#1461).
pub fn tick(now: u64, cx: &mut App) {
    crate::card::tick(now, cx);
    crate::open::tick(now, cx);
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        self.fit_list(window, cx);
        let s = sizes();
        // Under the list's and the page's narrowest together, one region at a time (#1808): the page, its title row
        // carrying the count as the way back, or the list alone. A window made that narrow shows the one the keyboard
        // is in.
        let narrow = chrome::list_width(self.list_width, window.viewport_size().width).is_none();
        if narrow && self.was_narrow == Some(false) {
            let hidden = !list_has_keys(window);
            self.set_hidden(hidden, cx);
        }
        self.was_narrow = Some(narrow);
        NARROW.with(|n| n.set(narrow));
        let list = (narrow && !self.hidden)
            .then(|| LIST_KEYS.with(|keys| keys.borrow().as_ref().map(|(_, list)| list.clone())))
            .flatten()
            .and_then(|list| list.upgrade());
        let edge = self
            .dock
            .read(cx)
            .is_dock_open(DockPlacement::Left)
            .then(|| self.dock.read(cx).dock_size(DockPlacement::Left))
            .flatten();
        div()
            .size_full()
            .relative()
            .key_context("Shell")
            .track_focus(&self.focus_handle)
            .capture_any_mouse_down(|_, _, _| touched())
            .capture_key_down(|_, _, _| touched())
            // Dragging the list's edge sets its width; letting go ends it and keeps it (#1808). The listeners are always
            // there, so a drag's first moves reach them before the frame its press asks for draws.
            .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, window, cx| {
                if !this.resizing {
                    return;
                }
                let wide = window.viewport_size().width;
                if let Some(width) = chrome::list_width(event.position.x, wide) {
                    this.list_width = width;
                    cx.notify();
                }
            }))
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    if !this.resizing {
                        return;
                    }
                    this.resizing = false;
                    let width = f32::from(this.list_width);
                    crate::frame::keep(|kept| kept.list = Some(width));
                    cx.notify();
                }),
            )
            .flex()
            .flex_col()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .typed(s.body)
            // Issue #1434: the frame's guards go first, so every chrome effect after them is checked.
            .child(crate::chrome_fx::guards())
            .children(self.title_bar.then(|| title_bar(window)))
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .w_full()
                    .relative()
                    .map(|region| match list {
                        Some(list) => region.child(list),
                        None => region.child(self.dock.clone()),
                    })
                    // The list's edge takes a drag to resize the list, and a double-click sets it back.
                    .children(edge.map(|edge| {
                        div()
                            .id("list-edge")
                            .absolute()
                            .top_0()
                            .bottom_0()
                            .left(edge - s.space(0))
                            .w(s.space(1))
                            .cursor_col_resize()
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(|this, _, _, cx| {
                                    this.resizing = true;
                                    cx.notify();
                                }),
                            )
                            .on_click(cx.listener(|this, event: &ClickEvent, _, cx| {
                                if event.click_count() == 2 {
                                    this.list_width = sizes().sidebar;
                                    this.resizing = false;
                                    let width = f32::from(this.list_width);
                                    crate::frame::keep(|kept| kept.list = Some(width));
                                    cx.notify();
                                }
                            }))
                    })),
            )
            // #1461's planted window keeps a band along its foot that repeats the selected row.
            .children(crate::plain::planted("band-repeats-row").then(|| {
                let row = crate::open::current(cx).map(|a| match a.place {
                    crate::address::Place::Ask => format!("ask:{}", a.id),
                    _ => format!(
                        "{}:{}",
                        if a.place == crate::address::Place::Session {
                            "session"
                        } else {
                            "quiet"
                        },
                        a.id
                    ),
                });
                // The selected row, and the row of the session it's about, each as its title and state word.
                let said = row
                    .and_then(|row| {
                        crate::record::with_view(|view| {
                            let table = view.table();
                            let line = |r: &Value| {
                                format!(
                                    "{} · {}",
                                    r["title"].as_str().unwrap_or_default(),
                                    r["word"].as_str().unwrap_or_default()
                                )
                            };
                            let selected = table.row_of(&row)?;
                            let session = selected["session"]
                                .as_str()
                                .and_then(|s| table.row_of(&format!("session:{s}")))
                                .filter(|_| row.starts_with("ask:"));
                            Some(
                                [Some(line(selected)), session.map(line)]
                                    .into_iter()
                                    .flatten()
                                    .collect::<Vec<_>>()
                                    .join("   "),
                            )
                        })
                        .flatten()
                    })
                    .unwrap_or_default();
                observed("band")
                    .role(Role::Group)
                    .h(s.space(5))
                    .flex_none()
                    .px(s.space(1))
                    .child(said)
            }))
            .child(crate::notice::notices(window))
            .children(context_menu(window))
            .children(self.commands.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn an_ask_row_keeps_when_its_default_applies_where_a_session_row_gives_its_time_to_its_title() {
        // A 260-wide list leaves a row about 243 of room; beside a taste ask's word (about 75) and its slots (48) and a
        // time such as "tomorrow 10:00" (about 70), 12 characters of title (about 85) don't fit (#1808).
        let room = px(243.) - px(123.) - px(70.);
        let least = px(85.);
        assert!(
            !keeps_time(false, room, least),
            "a session row gives its time to 12 characters of title (#1808)"
        );
        assert!(
            keeps_time(true, room, least),
            "an ask row shows when its recommended answer applies (#1345, #1458), whatever its title keeps"
        );
    }

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
    fn the_window_has_two_regions_and_nothing_docked_below() {
        let showing = |view| {
            let layout = Layout::shipped(view);
            layout.center[layout.active].clone()
        };
        assert_eq!(showing("needs-you"), HOME);
        assert_eq!(showing("session"), SESSION);
        assert_eq!(showing("sidebar"), HOME);
        let state = Layout::app(false).state();
        assert!(state.bottom_dock.is_none() && state.right_dock.is_none());
        assert!(!Layout::app(false)
            .center
            .iter()
            .any(|name| name == NEEDS_YOU || name == LINE));
    }

    #[std::prelude::v1::test]
    #[should_panic(expected = "is not a shipped view")]
    fn a_name_that_is_not_a_shipped_view_is_refused() {
        Layout::shipped("needs_you");
    }

    #[std::prelude::v1::test]
    fn a_needs_you_row_shows_a_direction_mark_as_the_card_does() {
        // #1510: an override in the question would read the rest of the row backwards.
        let mut view = crate::record::View::default();
        view.apply(
            serde_json::json!({"kind": "ask.created", "id": "a1", "session": "s1", "data": {
            "question": "Open invoice\u{202e}txt.exe?", "default": "no", "deadline": 1_000,
            "options": [{"id": "no", "label": "No"}]}}),
        );
        let open = read(&view, Kind::NeedsYou, None).open;
        assert_eq!(open[0].2, "Open invoice\\u{202e}txt.exe?");
    }
}
