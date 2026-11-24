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
use crate::agents::agents_page;
use crate::chrome::{sizes, Typed as _};
use crate::rows::{
    bound_panel, bound_values, empty_line, empty_now, item_height, list_heading, list_row, marked,
    needs_you_heading, now_ms, row_element, status,
};
pub(crate) use crate::rows::{in_lane, page_title, RowDrawn, Shape};
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
pub(crate) const CUT_TO: usize = 24;
/// The panel the hub's canvas core knows a session's page by.
pub(crate) const SESSION_PAGE: &str = "session-page";
/// How often an open terminal tab reads its grid again.
const TERMINAL_TICK: Duration = Duration::from_millis(250);
/// How often the Agents page reads the hub's model again.
const AGENTS_TICK: Duration = Duration::from_secs(2);
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
    pub(crate) static ROW_PLANT: Cell<Option<RowPlant>> = const { Cell::new(None) };
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
    /// Whether its grid is polled now: only while it is shown (#2661).
    polled: bool,
    _poll: Option<Task<()>>,
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
    pub(crate) agents: Option<serde_json::Value>,
    pub(crate) reviewing: Option<String>,
    /// Whether the Agents page's model is polled now: only while the page is shown (#2661).
    agents_polled: bool,
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
            agents_polled: false,
            _agents_poll: None,
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
                    shown.next_back()
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
        let focus = cx.focus_handle();
        TERMINAL_KEYS.with(|keys| *keys.borrow_mut() = Some(focus.clone()));
        self.terminal = Some(TerminalTab {
            session,
            focus,
            screen: None,
            words,
            outline: Vec::new(),
            pressing: false,
            polled: false,
            _poll: None,
        });
        self.read_terminal(cx);
        self.poll_terminal(false, cx);
    }

    /// Whether the view's page is drawn: in a window of its own, or as the shell's page region (#2661).
    fn page_shown(&self, cx: &App) -> bool {
        self.popped
            || (crate::open::shown_region(cx) == Some(crate::open::Region::Shipped(self.kind))
                && crate::open::popped(cx) != Some(self.kind))
    }

    /// Polls the Agents page's model while the page is shown (#2661): right after the frame that shows it, then each
    /// [`AGENTS_TICK`], until the first tick it isn't shown. The next draw that shows it starts it again.
    fn poll_agents(&mut self, cx: &mut Context<Self>) {
        if self.kind != Kind::Agents || self.agents_polled || !self.page_shown(cx) {
            return;
        }
        self.agents_polled = true;
        self._agents_poll = Some(cx.spawn(async move |this, cx| loop {
            let shown = this.update(cx, |this, cx| {
                this.agents_polled = this.page_shown(cx);
                if this.agents_polled {
                    this.read_agents(cx);
                }
                this.agents_polled
            });
            if !matches!(shown, Ok(true)) {
                return;
            }
            cx.background_executor().timer(AGENTS_TICK).await;
        }));
    }

    /// Whether the open Terminal tab is drawn: its session's page is shown (#2661).
    fn terminal_shown(&self, cx: &App) -> bool {
        let session = crate::open::opened_session(cx);
        self.page_shown(cx)
            && self
                .terminal
                .as_ref()
                .is_some_and(|tab| session.as_deref() == Some(tab.session.as_str()))
    }

    /// Polls the open Terminal tab's grid while it is shown (#2661), as [`Shipped::poll_agents`] polls: each
    /// [`TERMINAL_TICK`], at once when `now`, after the frame that shows it.
    fn poll_terminal(&mut self, now: bool, cx: &mut Context<Self>) {
        let shown = self.terminal_shown(cx);
        let Some(tab) = self.terminal.as_mut().filter(|tab| shown && !tab.polled) else {
            return;
        };
        tab.polled = true;
        tab._poll = Some(cx.spawn(async move |this, cx| {
            if !now {
                cx.background_executor().timer(TERMINAL_TICK).await;
            }
            loop {
                let shown = this.update(cx, |this, cx| {
                    let shown = this.terminal_shown(cx);
                    if let Some(tab) = this.terminal.as_mut() {
                        tab.polled = shown;
                    }
                    if shown {
                        this.read_terminal(cx);
                    }
                    shown
                });
                if !matches!(shown, Ok(true)) {
                    return;
                }
                cx.background_executor().timer(TERMINAL_TICK).await;
            }
        }));
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
#[cfg(feature = "fixtures")]
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
    if crate::find::focused(window) {
        return Some("find-field".to_owned());
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

/// A page's title: the title role, so a page has one voice (#1458). A title longer than its row wraps, whole, and the
/// row grows with it (#1808).
pub(crate) fn title(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    let (s, text): (_, SharedString) = (sizes(), text.into());
    // A title longer than its room ends in an ellipsis, its whole text in its accessible name, as a row's does: a page
    // at 360 pt wide draws nothing past its frame (#2403).
    observed(id)
        .role(Role::Label)
        .aria_label(text.clone())
        .typed(s.title)
        .min_h(s.title.line + s.space(2))
        .min_w_0()
        .flex()
        .items_center()
        .child(div().min_w_0().truncate().child(text))
}

/// A list's heading: the body role at medium weight (#1458).
pub(crate) fn heading(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
) -> ObservedElement<Stateful<Div>> {
    label(id, text).font_weight(FontWeight::MEDIUM)
}

/// How long the kit's overlays take to fade in, by opacity alone: the one motion chrome makes (#1458).
pub const OVERLAY_FADE: Duration = Duration::from_millis(120);

/// A control's kind (#1458): the page's one main action, a plain action, a switch, on or off, or (#1592) a plain action
/// that shows only an icon of the set, at its place's size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Control {
    Main,
    Plain,
    Switch(bool),
    Icon(&'static str, crate::icons::Place),
}

/// The one control builder (#1458): a button or a switch, one accessibility node named by its label, in the body
/// role at one height. A switch draws its state as a mark beside its label and carries it as the node's value,
/// `on` or `off`, never as a word in the label. A control that shows only an icon keeps its label as its name in the
/// tree (#1592; #1453 rule 10). No view styles a control itself.
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
        // A target as wide as it's tall, its icon centred, in the secondary ink.
        Control::Icon(name, place) => control
            .role(Role::Button)
            .px_0()
            .min_w(s.space(4))
            .justify_center()
            .hover(move |style| style.bg(hover))
            .child(crate::icons::icon(name, place, chrome.ink_secondary)),
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
    details: std::rc::Rc<Vec<String>>,
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
    }
    .into();
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

thread_local! {
    /// The view a layout put in the list's first section in place of the shipped Needs you (#1461): a replacement
    /// that passed `needs-you@1`.
    static NEEDS_YOU_VIEW: RefCell<Option<AnyView>> = const { RefCell::new(None) };
}

impl Render for Shipped {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The ages this frame writes, from here on, set the view's next tick (#1546).
        states::ages_written();
        // A page shown again reads the hub once now, and polls it while it stays shown (#2661).
        self.poll_agents(cx);
        self.poll_terminal(true, cx);
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
            crate::find::read(cx);
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
                // What the page shows by its real names, and the newest failure whole (#1348).
                let details = crate::lines::drawn(&record.details, chrome.focus);
                // #1815's planted find counts the page's title and its state word.
                if crate::plain::planted("find-matches-chrome") {
                    crate::find::here(&task);
                    crate::find::here(&state.text(now));
                }
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
                        .children(crate::find::grid(tab.screen.as_ref(), chrome.focus))
                });
                // The session's canvas, in the place of its deadlines' line (#1454).
                let figure = CANVAS
                    .with(|canvas| canvas.borrow().clone())
                    .filter(|panel| panel.read(cx).shows(&session));
                if let Some(panel) = &figure {
                    panel.update(cx, |panel, _| panel.show_session(&session).find());
                }
                let chart = terminal.is_none() && figure.is_none() && !hours.is_empty();
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
                // Its taste calls answered where none of their pictures was drawn (#3234), read beside the return card.
                // #3234's planted card reads them as answers from the card.
                let unseen: Vec<String> =
                    crate::record::with_view(|view| view.table().unseen(&session).to_vec())
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|_| !crate::plain::planted("unseen-reads-as-card"))
                        .map(|question| {
                            copy::fill("views.call_unseen", &[&crate::question::visible(&question)])
                        })
                        .collect();
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
                // The page fills its lane, so its canvas takes the height left under what's above it (#1498), and is as
                // long as what it holds, so it scrolls (#1808).
                let content = div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .flex_grow(1.)
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
                .when(session.is_empty(), |heading| heading.invisible())
                // #1592's planted page chrome draws an icon at a size no role gives.
                .children(crate::icons::planted_18(chrome.ink_secondary));
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
                            .child(reads(
                                "return-card",
                                &std::iter::once(shown.clone())
                                    .chain(unseen)
                                    .collect::<Vec<_>>()
                                    .join(" · "),
                            ))
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
                    Some(crate::find::titled(heading, chrome, window, cx)),
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
                    Some(crate::find::titled(heading, chrome, window, cx)),
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
                                            .child(rule.text.clone())
                                            .children(crate::find::found(&rule.text, chrome)),
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
                    Some(crate::find::titled(heading, chrome, window, cx)),
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
    cells::cells(cells::TERMINAL, screen)
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

/// The window's root, which a narrow window's region is set on (#1808): the app's own, a global, so an app never
/// reaches another's on the same thread, as a replica's second device would (#3100).
struct ShellRoot(WeakEntity<Shell>);

impl Global for ShellRoot {}

thread_local! {
    /// Whether the window is too narrow for both regions, as it last drew: its pages then carry the count (#1808).
    static NARROW: Cell<bool> = const { Cell::new(false) };
}

/// Whether the window is too narrow for the list and the page together, so it shows one at a time (#1808).
pub fn narrow() -> bool {
    NARROW.with(Cell::get)
}

/// A narrow window shows the page (`true`) or the list (#1808); a wide one shows both whatever this says.
pub fn show_page_region(page: bool, cx: &mut App) {
    let Some(shell) = cx
        .try_global::<ShellRoot>()
        .and_then(|root| root.0.upgrade())
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
        let root = ShellRoot(cx.entity().downgrade());
        cx.set_global(root);
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
mod tests;
