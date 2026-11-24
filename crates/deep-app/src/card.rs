//! Issue #326: the question card, the app shell's. Nothing can cover it: it is presented as the window's prompt,
//! which gpui paints after the root, after every deferred draw (popovers, menus, a panel's overlays), and in place
//! of tooltips, so a panel can draw nothing over it. While it shows it keeps the keyboard: focus a panel moves
//! away from it comes straight back, so no panel moves focus without your gesture.
//!
//! Issue #327: a card presented for an ask draws from its [`Controller`](question::Controller), every row an
//! accessibility node an assistive client reads, and hands each press on a row to it.
//!
//! Issue #1454: a press carries its own timestamp and source. It is hardware only when its down and its up each come
//! with their own HID event; anything else, a press a screen reader sends among them, answers only after the OS
//! confirms you, and the hub raises that prompt. Each answer goes to the hub, signed as the device you paired, off the
//! main thread; one that doesn't get there stays on the card, saying why.

use std::cell::RefCell;

use crate::chrome::{sizes, Typed as _};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;

use crate::arming::{Client, Source};
use crate::chrome::Chrome;
use crate::hub::HubError;
use crate::question::{self, Controller, Did, Input, Phase, Row, Target};
use crate::trusted_input::{delivered, PressEdge};

thread_local! {
    /// Where the next card is presented, in window points.
    static AT: RefCell<Option<Bounds<Pixels>>> = const { RefCell::new(None) };
    /// The controller the next prompt draws from, and the view the builder made for it.
    static NEXT: RefCell<Option<Controller>> = const { RefCell::new(None) };
    static MADE: RefCell<Option<Entity<Card>>> = const { RefCell::new(None) };
}

/// The app's prompt builder: every prompt the window shows is a question card.
pub fn init(cx: &mut App) {
    // A card of an app before this one in the process, as a second launch in one deep-drive has, is this app's to
    // neither tick nor focus (#1427).
    MADE.with(|made| *made.borrow_mut() = None);
    SHOWN.with(|shown| *shown.borrow_mut() = None);
    FOCUS.with(|focus| *focus.borrow_mut() = None);
    cx.set_prompt_builder(|_, question, _, options, handle, window, cx| {
        let bounds = AT.with(|at| at.borrow_mut().take()).unwrap_or_else(|| {
            let size = window.viewport_size();
            Bounds::centered_at(
                point(size.width / 2., size.height / 2.),
                gpui_kit::size(px(480.), px(240.)), // size-literal-exception: the slot of a prompt no ask placed (#327); review 2027-04-30
            )
        });
        let options = options
            .iter()
            .map(|option| option.label().clone())
            .collect();
        let controller = NEXT.with(|next| next.borrow_mut().take());
        let card =
            cx.new(|cx| Card::new(question.to_owned().into(), options, bounds, controller, cx));
        MADE.with(|made| *made.borrow_mut() = Some(card.clone()));
        handle.with_view(card, window, cx)
    });
}

/// Presents a question card at `bounds`. Sending its answer to the hub is the card's answer path, not this
/// issue's; until then a choice closes the card.
pub fn present(
    bounds: Bounds<Pixels>,
    question: &str,
    options: &[&str],
    window: &mut Window,
    cx: &mut App,
) {
    AT.with(|at| *at.borrow_mut() = Some(bounds));
    drop(window.prompt(PromptLevel::Info, question, None, options, cx));
}

/// Presents the card an ask's controller draws, in the slot the controller holds; answers the view, which the
/// shell drives presses into and reads back.
pub fn present_question(controller: Controller, window: &mut Window, cx: &mut App) -> Entity<Card> {
    let [x, y, w, h] = controller.slot().rect;
    let bounds = Bounds {
        origin: point(px(x as f32), px(y as f32)),
        size: gpui_kit::size(px(w as f32), px(h as f32)),
    };
    let question = controller.model().question.clone();
    AT.with(|at| *at.borrow_mut() = Some(bounds));
    NEXT.with(|next| *next.borrow_mut() = Some(controller));
    let none: &[&str] = &[];
    drop(window.prompt(PromptLevel::Info, &question, None, none, cx));
    MADE.with(|made| made.borrow_mut().take())
        .expect("the prompt builder made the card")
}

thread_local! {
    /// The card the app's window shows, with its ask.
    static SHOWN: RefCell<Option<(String, Entity<Card>)>> = const { RefCell::new(None) };
    /// The keyboard focus of the card drawn last, which a snapshot reads without the app.
    static FOCUS: RefCell<Option<FocusHandle>> = const { RefCell::new(None) };
    /// The id of the card's control the keyboard is on, which a snapshot reads (#1462).
    static KEY_AT: RefCell<Option<String>> = const { RefCell::new(None) };
    /// You moved the keyboard off the card (Esc, F6, ⌘K, ⌘N): it no longer takes it back each frame (#1462).
    static LET_GO: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// The card stops keeping the keyboard: you moved it elsewhere, with the ask left open and its words kept.
pub fn let_go() {
    LET_GO.with(|l| l.set(true));
}

/// Gives the shown card the keyboard again (F6 to the page).
pub fn focus(window: &mut Window, cx: &mut App) -> bool {
    let Some(shown) = showing(cx) else {
        return false;
    };
    LET_GO.with(|l| l.set(false));
    let handle = shown.read(cx).focus.clone();
    window.focus(&handle, cx);
    true
}

/// What holds the keyboard on the card: its focused control's id, else the card's (#1462).
pub fn focus_id(window: &Window) -> Option<String> {
    focused(window).then(|| {
        KEY_AT
            .with(|at| at.borrow().clone())
            .unwrap_or_else(|| CARD_ID.to_owned())
    })
}

/// ⌘Z: the shown card's Undo while it is live (#1807), a press like any other.
pub fn undo(window: &mut Window, cx: &mut App) {
    let _ = window;
    if let Some((_, shown)) = SHOWN.with(|cell| cell.borrow().clone()) {
        shown.update(cx, |card, cx| card.press_key(Target::Undo, cx));
    }
}

/// Issue #1461: an ask's page holds its card, in the reading lane beside the list, its content read from the record
/// once. One already up leaves first, unanswered. An ask the record no longer holds open presents nothing. Its slot is
/// the page, where it was last laid out; until then, the window right of the list.
pub fn present_ask(ask: &str, window: &mut Window, cx: &mut App) {
    leave(cx);
    let viewport = window.viewport_size();
    let (width, height) = (
        f32::from(viewport.width) as i64,
        f32::from(viewport.height) as i64,
    );
    let list = crate::views::drawn_views()
        .into_iter()
        .find(|(name, _)| *name == crate::views::SIDEBAR)
        .map_or(0, |(_, list)| f32::from(list.right()) as i64);
    let rect = PAGE
        .with(std::cell::Cell::get)
        .unwrap_or([list, 0, width - list, height]);
    let slot = crate::arming::Slot {
        rect,
        visible: [0, 0, width, height],
    };
    let events = crate::record::history();
    let now = crate::views::now();
    let Some(controller) = Controller::present(&events, ask, now, slot, Default::default()) else {
        return;
    };
    let shown = cx.new(|cx| {
        let bounds = Bounds::default();
        let mut card = Card::new(
            controller.model().question.clone().into(),
            Vec::new(),
            bounds,
            Some(controller),
            cx,
        );
        card.page = true;
        card
    });
    // An ask opened takes the keyboard to its card, until you move it elsewhere (#1462).
    LET_GO.with(|l| l.set(false));
    SHOWN.with(|cell| *cell.borrow_mut() = Some((ask.to_owned(), shown)));
}

/// The card an ask's page shows, with its ask.
pub fn shown() -> Option<(String, Entity<Card>)> {
    SHOWN.with(|cell| cell.borrow().clone())
}

/// The card, while its ask's page is the page shown (#1461).
pub fn showing(cx: &App) -> Option<Entity<Card>> {
    let address = crate::open::current(cx)?;
    let (ask, card) = shown()?;
    (address.place == crate::address::Place::Ask && ask == format!("ask:{}", address.id))
        .then_some(card)
}

thread_local! {
    /// The ask's page as last laid out, `[x, y, w, h]` in window points, and the box's height on it: the card's slot,
    /// and what the card and the box measure together.
    static PAGE: std::cell::Cell<Option<[i64; 4]>> = const { std::cell::Cell::new(None) };
    static BOX_TALL: std::cell::Cell<i64> = const { std::cell::Cell::new(0) };
}

/// The name of the ask's page in the window (#1461).
pub const ASK_PAGE: &str = "deepbuild/ask";

/// An ask's page (#1461): its card in the reading lane, and the box at its foot as the card's words.
pub struct AskPage {
    focus: FocusHandle,
}

impl AskPage {
    pub fn new(cx: &mut Context<Self>) -> Self {
        crate::record::observe(cx);
        AskPage {
            focus: cx.focus_handle(),
        }
    }
}

impl gpui_kit::base::dock::Panel for AskPage {
    fn panel_name(&self) -> &'static str {
        ASK_PAGE
    }
}

impl EventEmitter<gpui_kit::base::dock::PanelEvent> for AskPage {}

impl Focusable for AskPage {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for AskPage {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = crate::chrome::of(window);
        // #1461's planted app draws the card in a replica and not in the real app.
        let replica_only =
            crate::plain::planted("card-replica-only") && !cfg!(feature = "fixtures");
        let card = shown().map(|(_, card)| card).filter(|_| !replica_only);
        // Where the page was laid out: the card's slot, which a card presented there re-arms in when it moved.
        let placed = card.as_ref().map(Entity::downgrade);
        let page = canvas(
            move |bounds, window, cx| {
                let viewport = window.viewport_size();
                let visible = [
                    0,
                    0,
                    f32::from(viewport.width) as i64,
                    f32::from(viewport.height) as i64,
                ];
                let rect = [
                    f32::from(bounds.origin.x) as i64,
                    f32::from(bounds.origin.y) as i64,
                    f32::from(bounds.size.width).ceil() as i64,
                    f32::from(bounds.size.height).ceil() as i64,
                ];
                PAGE.with(|page| page.set(Some(rect)));
                if let Some(card) = placed.as_ref() {
                    card.update(cx, |card, cx| {
                        if let Some(controller) = card.controller.as_mut() {
                            // The window as it is now: a window made larger keeps the card armable.
                            let slot = crate::arming::Slot { rect, visible };
                            let was = controller.state_name();
                            controller.placed(slot, crate::views::now());
                            // A card this presented again draws as it now is, in the frame after (#1482): a notify
                            // made while a frame draws is dropped, so it is made when the frame is done.
                            if controller.state_name() != was {
                                let card = cx.entity_id();
                                cx.defer(move |cx| cx.notify(card));
                            }
                        }
                    })
                    .ok();
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        // The card keeps to the lane and scrolls inside itself (#1808); a narrow window's page has a title row for the
        // count, the way back to the list.
        let title = crate::views::narrow()
            .then(|| crate::views::page_title(div(), chrome).into_any_element());
        // #1815's planted find opens its field here too.
        let title = if crate::plain::planted("find-on-ask") {
            crate::find::read(cx);
            let row = crate::views::page_title(div(), chrome);
            Some(crate::find::titled(row, chrome, window, cx))
        } else {
            title
        };
        // The pictures a taste call judges draw beside the card, in a column of their own (#3234).
        let evidence = card
            .as_ref()
            .and_then(|card| card.update(cx, |card, cx| card.evidence(window, cx)));
        let judged = evidence
            .is_some()
            .then(|| card.as_ref().map(Entity::downgrade))
            .flatten();
        let lane = crate::views::in_lane(
            None,
            title,
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .pt(sizes().space(4))
                .text_color(chrome.ink_primary)
                .children(card),
            true,
        );
        let lane = match evidence {
            Some(evidence) => div()
                .size_full()
                .flex()
                .child(div().flex_1().min_w_0().h_full().child(evidence))
                .child(
                    div()
                        .flex_none()
                        .h_full()
                        .w(sizes().lane + sizes().space(4) * 2.)
                        .child(lane),
                )
                .into_any_element(),
            None => lane.into_any_element(),
        };
        let region = crate::open::page_of(crate::open::Region::Ask, cx);
        div()
            .id("ask-page")
            .size_full()
            .relative()
            .typed(sizes().body)
            .child(page)
            .child(crate::views::page_region(region, lane))
            // Last, once every picture of the frame was laid out: what it drew, for the card to count (#3234).
            .children(judged.map(|card| {
                canvas(
                    move |_, window, cx| {
                        card.update(cx, |card, cx| card.frame_drawn(window, cx))
                            .ok();
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .size_full()
            }))
    }
}

/// The box on an ask's page measured `tall` points: the card arms only when it and the box fit the page together.
pub fn box_measured(tall: i64) {
    BOX_TALL.with(|b| b.set(tall));
}

/// Whether the shown card holds the keyboard in `window`.
pub fn focused(window: &Window) -> bool {
    FOCUS.with(|focus| {
        focus
            .borrow()
            .as_ref()
            .is_some_and(|focus| focus.is_focused(window))
    })
}

/// The ask's page lets its card go: it's the page's content, never a prompt to dismiss (#1461).
fn leave(_: &mut App) {
    SHOWN.with(|cell| cell.borrow_mut().take());
}

/// Time passed: the shown card arms once its interval ran, and leaves when its ask closed anywhere.
pub fn tick(now: u64, cx: &mut App) {
    let Some((ask, shown)) = SHOWN.with(|cell| cell.borrow().clone()) else {
        return;
    };
    // A yes the hub holds (#1101): the record says when its steps start, that they did, or that it was withdrawn.
    let holding = shown
        .read(cx)
        .controller
        .as_ref()
        .is_some_and(Controller::counting_down);
    if holding {
        let events = crate::record::history();
        shown.update(cx, |card, _| {
            if let Some(controller) = card.controller.as_mut() {
                controller.hold_changed(&events, now);
            }
        });
    }
    let open = crate::record::with_view(|view| view.table().is_open(&ask)).unwrap_or(true);
    // Its receipt counts the hold down with Undo while the hub holds its steps, though the ask is answered (#1101).
    let counting = shown
        .read(cx)
        .controller
        .as_ref()
        .is_some_and(Controller::counting_down);
    if !open && !counting {
        // Answered here or anywhere: while its page shows, the next ask's page opens, and no row moves (#1461).
        leave(cx);
        let showing = crate::open::current(cx).is_some_and(|a| {
            a.place == crate::address::Place::Ask && format!("ask:{}", a.id) == ask
        });
        if showing {
            crate::open::next(cx);
        }
        return;
    }
    shown.update(cx, |card, cx| {
        // The card draws again when its state differs from the one it drew: arming, or a move that presented it again
        // after it drew (#1482). A tick that changes neither draws nothing.
        let replaced = card.catch_up();
        let moved = replaced
            || card
                .controller_mut()
                .is_some_and(|controller| controller.tick(now));
        let state = card.controller.as_ref().map(Controller::state_name);
        if card.controller.is_some() && (moved || state != card.drawn) {
            cx.notify();
        }
    });
}

/// The pictures a frame laid out beside the card, each by its hash with its bounds (#3234).
type Laid = std::rc::Rc<RefCell<Vec<(String, Bounds<Pixels>)>>>;

pub struct Card {
    question: SharedString,
    options: Vec<SharedString>,
    bounds: Bounds<Pixels>,
    focus: FocusHandle,
    controller: Option<Controller>,
    /// The press down on a row, until its up: its target, time and whether it was hardware.
    down: Option<(Target, u64, bool)>,
    /// Why your answer didn't reach the hub.
    failed: Option<SharedString>,
    /// It's an ask's page's card (#1461), drawn in the page's lane with the box as its words, never as a prompt.
    page: bool,
    /// The control the keyboard is on (#1462).
    at: Option<Target>,
    /// On its page, the rows above its last block scroll (#1808), and the last block's bounds say whether it's all in
    /// view.
    rows: ScrollHandle,
    last: std::rc::Rc<std::cell::Cell<Option<Bounds<Pixels>>>>,
    /// The state its controller was in when it last drew (#1482).
    drawn: Option<&'static str>,
    /// What its taste calls judge (#3234): the pictures beside it, which scroll, each as the frame drew it, the view
    /// they scroll in, the ones opened at their size, and the record's place when it last looked for one replaced.
    evidence: ScrollHandle,
    pictures: Laid,
    view: std::rc::Rc<std::cell::Cell<Option<Bounds<Pixels>>>>,
    opened: std::collections::HashSet<String>,
    moved_at: u64,
}

/// What a press edge says: its own time and whether the HID system made it.
fn edge(kind: PressEdge) -> (u64, bool) {
    let now = crate::views::now();
    delivered(kind).map_or((now, false), |(age, hardware)| {
        (now.saturating_sub(age as u64), hardware)
    })
}

/// What the hub's refusal says, for the card's line.
fn why(error: &HubError) -> String {
    match error {
        HubError::Refused(refusal) => refusal["message"]
            .as_str()
            .map_or_else(|| refusal.to_string(), str::to_owned),
        other => format!("{other:?}"),
    }
}

impl Card {
    fn new(
        question: SharedString,
        options: Vec<SharedString>,
        bounds: Bounds<Pixels>,
        controller: Option<Controller>,
        cx: &mut Context<Self>,
    ) -> Self {
        // Issue #1434: while the card shows, no chrome effect may draw over its slot.
        crate::chrome_fx::guard(crate::chrome_fx::CARD, bounds);
        let at = controller.as_ref().and_then(first_focus);
        let mut card = Card {
            question,
            options,
            bounds,
            focus: cx.focus_handle(),
            controller,
            down: None,
            failed: None,
            page: false,
            at: None,
            rows: ScrollHandle::new(),
            last: Default::default(),
            drawn: None,
            evidence: ScrollHandle::new(),
            pictures: Default::default(),
            view: Default::default(),
            opened: Default::default(),
            moved_at: crate::record::with_view(|view| view.log_pos).unwrap_or(0),
        };
        card.focus_on(at);
        card
    }

    /// Puts the keyboard on `at`, which its focus ring and a snapshot follow.
    fn focus_on(&mut self, at: Option<Target>) {
        self.at = at;
        let id = at.and_then(|at| self.id_of(at));
        KEY_AT.with(|cell| *cell.borrow_mut() = id);
    }

    /// A control's id, in the snapshot and the live tree (#1462): an option by its own id, a step by its place.
    fn id_of(&self, target: Target) -> Option<String> {
        Some(match target {
            Target::Option(index) => format!(
                "card-option:{}",
                self.controller.as_ref()?.model().options.get(index)?.id
            ),
            Target::Step(index) => format!("card-step:{index}"),
            Target::Send => "card-send".to_owned(),
            Target::Undo => "card-undo".to_owned(),
            Target::SignIn => "card-sign-in".to_owned(),
            Target::Page => "card-price-page".to_owned(),
            Target::Fold => "card-fold".to_owned(),
        })
    }

    /// The card's controls in reading order, as Tab, Shift-Tab and the arrows walk them.
    fn controls(&self) -> Vec<Target> {
        self.controller
            .as_ref()
            .map(|controller| {
                let rows = if self.page {
                    controller.page_rows()
                } else {
                    controller.rows()
                };
                rows.iter()
                    .filter_map(|row| match row {
                        Row::Option { index, .. } => Some(Target::Option(*index)),
                        Row::Step { index, .. } => Some(Target::Step(*index)),
                        Row::Send => Some(Target::Send),
                        Row::Undo => Some(Target::Undo),
                        Row::SignIn => Some(Target::SignIn),
                        Row::Page(_) => Some(Target::Page),
                        Row::Fold { .. } => Some(Target::Fold),
                        Row::Text(_) | Row::Call { .. } => None,
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The keyboard on the card (#1462): Tab, Shift-Tab and the arrows walk its controls, a digit moves to that option
    /// and answers nothing, Space or Return presses the focused control (once armed; a repeat never does), and Esc
    /// gives the keyboard back to the list with the ask left open. Any other key touches nothing.
    fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let stroke = &event.keystroke;
        let m = stroke.modifiers;
        if m.platform || m.control || m.alt || m.function {
            return;
        }
        cx.stop_propagation();
        let controls = self.controls();
        let walk = |by: isize, controls: &[Target], at: Option<Target>| {
            let count = controls.len() as isize;
            if count == 0 {
                return None;
            }
            let here = at.and_then(|at| controls.iter().position(|c| *c == at));
            let to = match here {
                Some(i) => (i as isize + by).rem_euclid(count),
                None if by > 0 => 0,
                None => count - 1,
            };
            Some(controls[to as usize])
        };
        match stroke.key.as_str() {
            "tab" => {
                // #1462's planted card passes over Send on Tab.
                let tabbed: Vec<Target> = if cfg!(feature = "plant-tab-skips-control") {
                    controls
                        .iter()
                        .copied()
                        .filter(|c| *c != Target::Send)
                        .collect()
                } else {
                    controls.clone()
                };
                let by = if m.shift { -1 } else { 1 };
                let at = walk(by, &tabbed, self.at.filter(|at| tabbed.contains(at)));
                self.focus_on(at);
            }
            "down" | "right" => self.focus_on(walk(1, &controls, self.at)),
            "up" | "left" => self.focus_on(walk(-1, &controls, self.at)),
            "escape" => {
                let_go();
                crate::views::focus_list(window, cx);
            }
            // The rows above a long card's options scroll from the keyboard too, so its end can be shown (#1808).
            "pagedown" | "end" => self.rows.scroll_to_bottom(),
            "pageup" | "home" => self.rows.set_offset(Point::default()),
            "space" | "enter" if !event.is_held => {
                if let Some(at) = self.at {
                    self.press_key(at, cx);
                }
            }
            digit if digit.len() == 1 && digit.as_bytes()[0].is_ascii_digit() => {
                let n = digit.as_bytes()[0] - b'0';
                if n > 0 && controls.contains(&Target::Option(n as usize - 1)) {
                    self.focus_on(Some(Target::Option(n as usize - 1)));
                }
            }
            _ => {}
        }
        cx.notify();
    }

    /// A press from the keyboard on `target`: hardware only when the HID system made the key (#1454).
    fn press_key(&mut self, target: Target, cx: &mut Context<Self>) {
        let now = crate::views::now();
        let source = if crate::trusted_input::key_from_hardware() {
            Source::Hardware
        } else {
            Source::Accessibility {
                client: Client::Unknown,
            }
        };
        self.press_with(target, now, now, source, cx);
    }

    pub fn controller_mut(&mut self) -> Option<&mut Controller> {
        self.controller.as_mut()
    }

    /// Takes the card off the window without an answer, as when its ask closed elsewhere or another is presented.
    pub fn dismiss(&mut self, cx: &mut Context<Self>) {
        cx.emit(PromptResponse(0));
    }

    /// Your words on the card, from the box on its page (#1461).
    pub fn type_words(&mut self, words: &str, cx: &mut Context<Self>) {
        if let Some(controller) = self.controller.as_mut() {
            controller.type_words(words);
            cx.notify();
        }
    }

    /// The box's send control on the card's page and the lines above it (#1461).
    pub fn words_send(&self) -> (&'static str, Vec<&'static str>) {
        self.controller.as_ref().map_or(
            (crate::copy::text("card.answer"), Vec::new()),
            Controller::words_send,
        )
    }

    /// The down of a press on `target`.
    pub(crate) fn pressing(&mut self, target: Target) {
        let (t, hardware) = edge(PressEdge::Down);
        self.down = Some((target, t, hardware));
    }

    /// The up of a press on `target`, with its down: the controller decides what the whole press does.
    pub(crate) fn pressed(&mut self, target: Target, cx: &mut Context<Self>) {
        let (up, hardware) = edge(PressEdge::Up);
        let (down, hardware) = match self.down.take() {
            Some((on, t, was)) if on == target => (t, was && hardware),
            _ => (up, false),
        };
        let hardware = hardware || cfg!(feature = "plant-card-skips-confirm");
        let source = if hardware {
            Source::Hardware
        } else {
            Source::Accessibility {
                client: Client::Unknown,
            }
        };
        self.press_with(target, down, up, source, cx);
    }

    /// One whole press on `target`, its down at `down` and its up at `up`: the controller decides what it does.
    fn press_with(
        &mut self,
        target: Target,
        down: u64,
        up: u64,
        source: Source,
        cx: &mut Context<Self>,
    ) {
        let Some(controller) = self.controller.as_mut() else {
            return;
        };
        // The card reads the record's history from the hub, as it stands at the press.
        let events = crate::record::history();
        let now = crate::views::now();
        let press = |phase, t| Input {
            t,
            source,
            target,
            phase,
        };
        let did = match controller.press(press(Phase::Down, down), &events, now) {
            Did::Nothing => controller.press(press(Phase::Up, up), &events, now),
            other => other,
        };
        match did {
            Did::NeedsConfirmation(reason) => self.confirm(reason, cx),
            Did::SignIn(ask) => self.sign_in(ask, cx),
            // The maker's own price page, in your browser (#1349): it answers nothing.
            Did::Page(page) => cx.open_url(&page),
            _ => {}
        }
        self.send(cx);
        cx.notify();
    }

    /// Has the OS confirm you off the main thread, then tells the controller what it said.
    fn confirm(&mut self, reason: String, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.as_ref() else {
            return;
        };
        let ask = controller.model().ask.clone();
        cx.spawn(async move |card, cx| {
            let said = cx
                .background_spawn(async move { crate::answer::confirm(&ask, &reason) })
                .await;
            let _ = card.update(cx, |card, cx| {
                if let Some(controller) = card.controller.as_mut() {
                    let (events, now) = (crate::record::history(), crate::views::now());
                    controller.confirmed(said.is_ok(), &events, now);
                }
                card.failed = said.err().map(|error| why(&error).into());
                card.send(cx);
                cx.notify();
            });
        })
        .detach();
    }

    /// Starts the agent's own sign-in through the hub's `signin.open`, off the main thread (#1349): the agent opens its own
    /// window or browser page. It closes nothing; one the hub couldn't start stays on the card, saying why.
    fn sign_in(&mut self, ask: String, cx: &mut Context<Self>) {
        self.failed = None;
        cx.spawn(async move |card, cx| {
            let started = cx
                .background_spawn(async move {
                    crate::hub::call_app("signin.open", serde_json::json!({ "ask": ask }))
                })
                .await;
            if let Err(error) = started {
                let _ = card.update(cx, |card, cx| {
                    card.failed = Some(why(&error).into());
                    cx.notify();
                });
            }
        })
        .detach();
    }

    /// Sends what the controller answered, in order.
    fn send(&mut self, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.as_mut() else {
            return;
        };
        let answers = controller.take_answers();
        // Undo inside the hub's hold reaches the hub's undo (#1101).
        let undos = controller.take_undos();
        if answers.is_empty() && undos.is_empty() {
            return;
        }
        self.failed = None;
        cx.spawn(async move |card, cx| {
            let sent = cx
                .background_spawn(async move {
                    answers
                        .iter()
                        .try_for_each(|params| crate::answer::send(params).map(|_| ()))?;
                    undos
                        .iter()
                        .try_for_each(|params| crate::answer::undo(params).map(|_| ()))
                })
                .await;
            if let Err(error) = sent {
                let _ = card.update(cx, |card, cx| {
                    card.failed = Some(why(&error).into());
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn row(&self, index: usize, row: &Row, chrome: &Chrome, cx: &mut Context<Self>) -> AnyElement {
        use crate::views::{control, Control};
        // A row of the batched taste card (#1345): one group per call, keyed by its ask, each line a label in it.
        if let Row::Call {
            ask, lines, armed, ..
        } = row
        {
            let id = format!("card-row:{}", ask.trim_start_matches("ask:"));
            // Armed once the card is and the pictures its own evidence lists were shown (#3234).
            let state = match self.controller.as_ref().map(Controller::state_name) {
                Some("armed") if !armed => "presented",
                state => state.unwrap_or("hidden"),
            };
            return crate::views::observed(ElementId::Name(id.into()))
                .role(Role::Group)
                .aria_value(state)
                .aria_label(SharedString::from(
                    lines.first().cloned().unwrap_or_default(),
                ))
                .flex()
                .flex_col()
                .pt(sizes().space(1))
                .children(lines.iter().enumerate().map(|(line, text)| {
                    let text = SharedString::from(text.clone());
                    crate::views::observed(("card-row-line", line))
                        .role(Role::Label)
                        .aria_label(text.clone())
                        .typed(if line == 0 {
                            sizes().body
                        } else {
                            sizes().small
                        })
                        .text_color(if line == 0 {
                            chrome.ink_primary
                        } else {
                            chrome.ink_secondary
                        })
                        .child(text)
                }))
                .into_any_element();
        }
        let label: SharedString = row.label().to_owned().into();
        let (kind, target): (Option<Control>, Option<Target>) = match row {
            Row::Text(_) | Row::Call { .. } => (None, None),
            Row::Option { index, .. } => (Some(Control::Plain), Some(Target::Option(*index))),
            Row::Step { index, on, .. } => (Some(Control::Switch(*on)), Some(Target::Step(*index))),
            Row::Send => (Some(Control::Main), Some(Target::Send)),
            Row::Undo => (Some(Control::Plain), Some(Target::Undo)),
            Row::SignIn => (Some(Control::Main), Some(Target::SignIn)),
            Row::Page(_) => (Some(Control::Plain), Some(Target::Page)),
            Row::Fold { .. } => (Some(Control::Plain), Some(Target::Fold)),
        };
        // Each control keyed by what it is, never its place (#1462); a line by its place.
        let id: ElementId = match target.and_then(|target| self.id_of(target)) {
            Some(id) => ElementId::Name(id.into()),
            None => ("card-line", index).into(),
        };
        let (Some(kind), Some(target)) = (kind, target) else {
            // The question is the card's largest text, its first line the kind's plain word (#1458).
            let role = match index {
                0 => sizes().small,
                1 => sizes().title,
                _ => sizes().body,
            };
            // A block, not a flex row, so the text takes the card's width and a long question wraps (#1550).
            return crate::views::observed(id)
                .role(Role::Label)
                .aria_label(label.clone())
                .typed(role)
                .child(label)
                .into_any_element();
        };
        // No border: the focus ring's room is always kept, and shows on the focused control alone, which an assistive
        // client reads as focused.
        let focused = self.at == Some(target);
        // On an ask's page an option is named by its own label; recommended and its cost draw beside it, quieter
        // (#1461).
        let choice = match row {
            Row::Option { index, .. } if self.page => self
                .controller
                .as_ref()
                .and_then(|c| c.model().options.get(*index).cloned()),
            _ => None,
        };
        // An option's state is its own (#3234): the accepting option of a taste call waits for its pictures.
        let state = match (row, self.controller.as_ref()) {
            (Row::Option { index, .. }, Some(controller)) => Some(controller.option_state(*index)),
            _ => None,
        };
        if let Some(choice) = choice {
            let left = match row {
                Row::Option { index, .. } => self
                    .controller
                    .as_ref()
                    .and_then(|c| c.picture_held(*index))
                    .map(|(left, all)| crate::copy::fill(question::PICTURES_LEFT, &[&left, &all])),
                _ => None,
            };
            let beside: Vec<String> = choice
                .recommended
                .then(|| crate::copy::text("card.recommended").to_owned())
                .into_iter()
                .chain(choice.cost.clone())
                .chain(left)
                .collect();
            return control(id, kind, choice.label.clone(), chrome)
                .when_some(state, |control, state| control.aria_value(state))
                .border(sizes().ring)
                .border_color(chrome.focus.opacity(if focused { 1. } else { 0. }))
                .when(focused, |control| control.aria_active_descendant())
                .children((!beside.is_empty()).then(|| {
                    div()
                        .typed(sizes().small)
                        .text_color(chrome.ink_secondary)
                        .child(beside.join(" · "))
                }))
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |card, _, _, _| card.pressing(target)),
                )
                .on_click(cx.listener(move |card, _, _, cx| card.pressed(target, cx)))
                .into_any_element();
        }
        control(id, kind, label, chrome)
            .when_some(state, |control, state| control.aria_value(state))
            .border(sizes().ring)
            .border_color(chrome.focus.opacity(if focused { 1. } else { 0. }))
            .when(focused, |control| control.aria_active_descendant())
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |card, _, _, _| card.pressing(target)),
            )
            .on_click(cx.listener(move |card, _, _, cx| card.pressed(target, cx)))
            .into_any_element()
    }
}

impl Drop for Card {
    fn drop(&mut self) {
        crate::chrome_fx::unguard(crate::chrome_fx::CARD);
    }
}

impl EventEmitter<PromptResponse> for Card {}

impl Focusable for Card {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for Card {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.drawn = self.controller.as_ref().map(Controller::state_name);
        // The card keeps the keyboard while it shows: focus anything else took, it takes back at its next frame, until
        // you move the keyboard off it yourself (#1462).
        if !self.focus.is_focused(window) && !LET_GO.with(std::cell::Cell::get) {
            window.focus(&self.focus, cx);
        }
        FOCUS.with(|focus| *focus.borrow_mut() = Some(self.focus.clone()));
        // A control that left (the receipt replacing the options) gives the keyboard to the first that stays.
        let controls = self.controls();
        if self.at.is_none_or(|at| !controls.contains(&at)) {
            let at = controls.first().copied();
            self.focus_on(at);
        } else {
            let at = self.at;
            self.focus_on(at);
        }
        let chrome = crate::chrome::of(window);
        // #1808's planted card grows past its page and never scrolls, as the merge base's did.
        let grows = crate::plain::planted("card-grows-past-slot");
        if self.page && !grows {
            return self.page_card(chrome, cx);
        }
        let rows: Vec<AnyElement> = match &self.controller {
            Some(controller) => {
                let rows = if self.page {
                    controller.page_rows()
                } else {
                    controller.rows()
                };
                let mut drawn: Vec<AnyElement> = rows
                    .iter()
                    .enumerate()
                    .map(|(index, row)| self.row(index, row, chrome, cx))
                    .collect();
                drawn.extend(self.failed.clone().map(|line| {
                    crate::views::observed("card-failed")
                        .role(Role::Label)
                        .aria_label(line.clone())
                        .typed(sizes().small)
                        .child(line)
                        .into_any_element()
                }));
                drawn
            }
            None => vec![
                div()
                    .typed(sizes().title)
                    .child(self.question.clone())
                    .into_any_element(),
                div()
                    .flex()
                    .gap(sizes().space(1))
                    .children(self.options.iter().enumerate().map(|(index, option)| {
                        crate::views::control(
                            ("card-option", index),
                            crate::views::Control::Plain,
                            option.clone(),
                            chrome,
                        )
                        .on_click(cx.listener(move |_, _, _, cx| cx.emit(PromptResponse(index))))
                    }))
                    .into_any_element(),
            ],
        };
        // The card as laid out, which grows past its slot with more rows than fit: what arming judges.
        let card = cx.entity().downgrade();
        let page = self.page;
        let measure = canvas(
            move |bounds, _, cx| {
                // On an ask's page the card and the box share the page: they measure together (#1461).
                let below = if page {
                    BOX_TALL.with(std::cell::Cell::get)
                } else {
                    0
                };
                let size = [
                    f32::from(bounds.size.width).ceil() as i64,
                    f32::from(bounds.size.height).ceil() as i64 + below,
                ];
                card.update(cx, |card, _| {
                    if let Some(controller) = card.controller.as_mut() {
                        controller.measured(size, crate::views::now());
                    }
                })
                .ok();
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        if self.page {
            // In the page's lane, as wide as it, drawn on the page with no fill or box of its own (#1453 rule 7).
            return div()
                .relative()
                .w_full()
                .child(
                    crate::views::observed(CARD_ID)
                        .role(Role::Group)
                        .when_some(self.controller.as_ref(), |card, controller| {
                            card.aria_value(controller.state_name())
                        })
                        .track_focus(&self.focus)
                        .on_key_down(cx.listener(|card, event: &KeyDownEvent, window, cx| {
                            card.key_down(event, window, cx)
                        }))
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|_, _, _, _| LET_GO.with(|l| l.set(false))),
                        )
                        .occlude()
                        .w_full()
                        .flex()
                        .flex_col()
                        .gap(sizes().space(0))
                        .children(rows)
                        // #1461's planted card draws a text field of its own above the box.
                        .when(crate::plain::planted("card-field-and-box"), |card| {
                            card.child(
                                crate::views::observed("card-words")
                                    .role(Role::TextInput)
                                    .aria_label("Your words") // copy-exception: planted wrong program
                                    .h(sizes().space(5))
                                    .w_full(),
                            )
                        }),
                )
                .child(measure)
                .into_any_element();
        }
        // The prompt fills the window; only the card itself takes a hitbox, so the rest of the window still
        // takes your input. The card's outer edge is what's measured; it draws no border (#1458). A window made
        // smaller while the card shows keeps the card inside it, never cut at its edge.
        let viewport = window.viewport_size();
        let (origin, size) = (self.bounds.origin, self.bounds.size);
        let (left, top) = (
            origin.x.min(viewport.width - size.width).max(px(0.)),
            origin.y.min(viewport.height - size.height).max(px(0.)),
        );
        div()
            .size_full()
            .child(
                div()
                    .absolute()
                    .left(left)
                    .top(top)
                    .w(size.width)
                    .child(
                        // One node holding the card's rows, its value the card's arming state, so a snapshot and an
                        // assistive client read whether a press would count (#1459).
                        crate::views::observed(CARD_ID)
                            .role(Role::Group)
                            .when_some(self.controller.as_ref(), |card, controller| {
                                card.aria_value(controller.state_name())
                            })
                            .track_focus(&self.focus)
                            .occlude()
                            .w_full()
                            // The slot's height at least: a card with more rows than its slot grows, never clips, so
                            // every row stays readable, and doesn't arm while it is taller than its slot.
                            .min_h(self.bounds.size.height)
                            .flex()
                            .flex_col()
                            .gap(sizes().space(0))
                            .p(sizes().space(3))
                            .rounded(sizes().radius)
                            // No border (#1453 rule 7): the card stands off the page by its elevation.
                            .shadow_lg()
                            .bg(chrome.raised)
                            .text_color(chrome.ink_primary)
                            .children(rows),
                    )
                    .child(measure),
            )
            .into_any_element()
    }
}

impl Card {
    /// The card on its ask's page (#1808): the rows above its last block scroll inside the lane, and its last block (its
    /// options and their count, its default, what it's saved as and what a press was told) stays in view under them, so
    /// every card fits its page and can arm. It arms once its end was shown and every option was.
    fn page_card(&mut self, chrome: &Chrome, cx: &mut Context<Self>) -> AnyElement {
        let (above, last) = self
            .controller
            .as_ref()
            .map(Controller::page_parts)
            .unwrap_or_default();
        let above: Vec<AnyElement> = above
            .iter()
            .enumerate()
            .map(|(index, row)| self.row(index, row, chrome, cx))
            .collect();
        let after = above.len();
        let mut last: Vec<AnyElement> = last
            .iter()
            .enumerate()
            .map(|(index, row)| self.row(after + index, row, chrome, cx))
            .collect();
        last.extend(self.failed.clone().map(|line| {
            crate::views::observed("card-failed")
                .role(Role::Label)
                .aria_label(line.clone())
                .typed(sizes().small)
                .child(line)
                .into_any_element()
        }));
        let card = cx.entity().downgrade();
        let (rows, held) = (self.rows.clone(), self.last.clone());
        let measure = canvas(
            move |bounds, _, cx| {
                // The card and the box share the page (#1461); a last block cut off at the card's foot isn't all in
                // view, so the card doesn't fit (#1808).
                let below = BOX_TALL.with(std::cell::Cell::get);
                let cut = held.get().is_some_and(|last| {
                    f32::from(last.bottom()) > f32::from(bounds.bottom()) + 0.5
                });
                let size = [
                    f32::from(bounds.size.width).ceil() as i64,
                    if cut {
                        i64::MAX / 4
                    } else {
                        f32::from(bounds.size.height).ceil() as i64 + below
                    },
                ];
                // Its end is shown when its rows all fit, or are scrolled to their end.
                let most = f32::from(rows.max_offset().y);
                let shown = most <= 0.5 || -f32::from(rows.offset().y) >= most - 0.5;
                let now = crate::views::now();
                let changed = card
                    .update(cx, |card, _| {
                        let Some(controller) = card.controller.as_mut() else {
                            return false;
                        };
                        let was = (controller.state_name(), controller.lines());
                        controller.measured_on_page(size, now);
                        controller.end_shown(shown, now);
                        was != (controller.state_name(), controller.lines())
                    })
                    .unwrap_or(false);
                // A frame can't redraw what it's drawing: the next one shows what changed.
                if changed {
                    let card = card.clone();
                    cx.defer(move |cx| {
                        card.update(cx, |_, cx| cx.notify()).ok();
                    });
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let held = self.last.clone();
        div()
            .relative()
            .w_full()
            .flex_initial()
            .min_h_0()
            .flex()
            .flex_col()
            .child(
                // In the page's lane, as wide as it, drawn on the page with no fill or box of its own (#1453 rule 7).
                crate::views::observed(CARD_ID)
                    .role(Role::Group)
                    .when_some(self.controller.as_ref(), |card, controller| {
                        card.aria_value(controller.state_name())
                    })
                    .track_focus(&self.focus)
                    .on_key_down(cx.listener(|card, event: &KeyDownEvent, window, cx| {
                        card.key_down(event, window, cx)
                    }))
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(|_, _, _, _| LET_GO.with(|l| l.set(false))),
                    )
                    .occlude()
                    .w_full()
                    .flex_initial()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .gap(sizes().space(0))
                    .child(
                        div()
                            .id("card-rows")
                            .w_full()
                            .flex_initial()
                            .min_h_0()
                            .flex()
                            .flex_col()
                            .gap(sizes().space(0))
                            .overflow_y_scroll()
                            .track_scroll(&self.rows)
                            .children(above),
                    )
                    .child(
                        div()
                            .relative()
                            .w_full()
                            .flex_none()
                            .flex()
                            .flex_col()
                            .gap(sizes().space(0))
                            .child(
                                canvas(move |bounds, _, _| held.set(Some(bounds)), |_, _, _, _| {})
                                    .absolute()
                                    .size_full(),
                            )
                            .children(last),
                    )
                    // #1461's planted card draws a text field of its own above the box.
                    .when(crate::plain::planted("card-field-and-box"), |card| {
                        card.child(
                            crate::views::observed("card-words")
                                .role(Role::TextInput)
                                .aria_label("Your words") // copy-exception: planted wrong program
                                .h(sizes().space(5))
                                .w_full(),
                        )
                    }),
            )
            .child(measure)
            .into_any_element()
    }
}

impl Card {
    /// The pictures its taste calls judge, beside it (#3234): each at its own pixel size where the column holds it, one
    /// wider as a thumbnail until a press opens it at the column's width; they scroll in their own column, so the card's
    /// end and its options stay where they are. `None` on a card that judges none.
    pub(crate) fn evidence(
        &mut self,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let listed = self.controller.as_ref()?.listed();
        if listed.is_empty() {
            return None;
        }
        let ratio = window.scale_factor();
        let column = self.view.get().map(|view| f32::from(view.size.width));
        let s = sizes();
        let count = listed.len();
        let drawn = self.pictures.clone();
        let pictures = listed
            .into_iter()
            .enumerate()
            .filter_map(|(index, picture)| {
                let image = crate::pictures::image(&picture.hash)?;
                let own = [
                    picture.size[0] as f32 / ratio,
                    picture.size[1] as f32 / ratio,
                ];
                // The column's width less its padding, once a frame has laid it out.
                let room = column.map(|w| (w - f32::from(s.space(3)) * 2.).max(1.))?;
                let width = if own[0] <= room {
                    own[0]
                } else if self.opened.contains(&picture.hash) {
                    room
                } else {
                    f32::from(s.space(5)) * 3.
                };
                let height = own[1] * width / own[0];
                let (hash, kept) = (picture.hash.clone(), drawn.clone());
                Some(
                    crate::views::observed(ElementId::Name(
                        format!("picture:{}", picture.hash).into(),
                    ))
                    .role(Role::Image)
                    .aria_label(crate::copy::fill("card.picture", &[&(index + 1), &count]))
                    .flex_none()
                    .w(px(width))
                    .h(px(height))
                    .child(
                        canvas(
                            move |bounds, _, _| {
                                kept.borrow_mut().push((hash, bounds));
                                bounds
                            },
                            move |_, bounds, window, _| {
                                let _ = window.paint_image(
                                    bounds,
                                    bounds,
                                    Corners::default(),
                                    image,
                                    0,
                                    false,
                                );
                            },
                        )
                        .size_full(),
                    )
                    .on_click(cx.listener({
                        let hash = picture.hash.clone();
                        move |card, _, _, cx| {
                            if !card.opened.remove(&hash) {
                                card.opened.insert(hash.clone());
                            }
                            cx.notify();
                        }
                    })),
                )
            });
        let (view, card) = (self.view.clone(), cx.entity().downgrade());
        Some(
            div()
                .relative()
                .size_full()
                .min_w_0()
                .child(
                    crate::views::observed("card-evidence")
                        .role(Role::Group)
                        .aria_label(crate::copy::text("card.evidence"))
                        .size_full()
                        .overflow_y_scroll()
                        .track_scroll(&self.evidence)
                        .child(
                            div()
                                .flex()
                                .flex_wrap()
                                .gap(s.space(1))
                                .p(s.space(3))
                                .children(pictures),
                        ),
                )
                .child(
                    // The column as laid out: where its pictures show, and how wide they may draw.
                    canvas(
                        move |bounds, _, cx| {
                            let was = view.replace(Some(bounds));
                            if was.map(|b| b.size.width) != Some(bounds.size.width) {
                                let card = card.clone();
                                cx.defer(move |cx| {
                                    card.update(cx, |_, cx| cx.notify()).ok();
                                });
                            }
                        },
                        |_, _, _, _| {},
                    )
                    .absolute()
                    .top_0()
                    .left_0()
                    .size_full(),
                )
                .into_any_element(),
        )
    }

    /// What this frame drew of the pictures (#3234): each one's best draw, whole when it lies inside the window and the
    /// column it scrolls in, at the scale of its drawn pixels over its own. The card hears it, and draws again in the
    /// next frame when what it says changed.
    pub(crate) fn frame_drawn(&mut self, window: &Window, cx: &mut Context<Self>) {
        let drawn = std::mem::take(&mut *self.pictures.borrow_mut());
        let Some(controller) = self.controller.as_mut() else {
            return;
        };
        let listed = controller.listed();
        let ratio = window.scale_factor();
        let size = window.viewport_size();
        let shown = Bounds::new(point(px(0.), px(0.)), size);
        let shown = self.view.get().map_or(shown, |view| view.intersect(&shown));
        let mut best: std::collections::HashMap<String, crate::pictures::Drawn> =
            Default::default();
        for (hash, bounds) in drawn {
            let Some(picture) = listed.iter().find(|p| p.hash == hash) else {
                continue;
            };
            let inside = |b: &Bounds<Pixels>| {
                b.left() >= shown.left() - px(0.5)
                    && b.top() >= shown.top() - px(0.5)
                    && b.right() <= shown.right() + px(0.5)
                    && b.bottom() <= shown.bottom() + px(0.5)
            };
            let d = crate::pictures::Drawn {
                scale: f64::from(f32::from(bounds.size.width) * ratio) / f64::from(picture.size[0]),
                whole: inside(&bounds),
            };
            let better = best
                .get(&hash)
                .is_none_or(|b| (d.whole, d.scale) > (b.whole, b.scale));
            if better {
                best.insert(hash, d);
            }
        }
        if controller.drawn(&best, crate::views::now()) {
            let card = cx.entity().downgrade();
            cx.defer(move |cx| {
                card.update(cx, |_, cx| cx.notify()).ok();
            });
        }
    }

    /// A picture the card judges was replaced while it shows (#3234): the document one of its asks is pinned to got a
    /// new revision (`doc.patched`). The card reads its asks again, and a new hash counts as not shown. Whether it did.
    fn catch_up(&mut self) -> bool {
        let Some(controller) = self.controller.as_mut() else {
            return false;
        };
        let since = self.moved_at;
        let asks = controller.judged_asks();
        let (at, moved) = crate::record::with_view(|view| {
            let docs: Vec<&str> = view
                .events
                .iter()
                .filter(|event| {
                    event["kind"] == "ask.created"
                        && asks.iter().any(|a| *a == crate::states::handle(event))
                })
                .filter_map(|event| crate::pictures::pinned_doc(&event["data"]["pinned_to"]))
                .collect();
            let moved = view.events.iter().any(|event| {
                event["kind"] == "doc.patched"
                    && event["log_pos"].as_u64().is_some_and(|pos| pos > since)
                    && event["data"]["doc"]
                        .as_str()
                        .is_some_and(|doc| docs.contains(&doc))
            });
            (view.log_pos, moved)
        })
        .unwrap_or((since, false));
        self.moved_at = at;
        if moved {
            controller.record_changed(&crate::record::history(), crate::views::now());
        }
        moved
    }
}

/// The id every element of a presented card draws under.
pub const CARD_ID: &str = "question-card";

/// Where the keyboard starts on a presented card (#1462): the option its default would apply (No on an approval), else
/// the recommended one, else the first.
fn first_focus(controller: &Controller) -> Option<Target> {
    let model = controller.model();
    // #1462's planted card starts on the option that allows.
    if cfg!(feature = "plant-card-starts-on-allow") {
        if let Some(index) = model.options.iter().position(|o| o.decision == "allow") {
            return Some(Target::Option(index));
        }
    }
    let events = crate::record::history();
    let default = crate::kinds::find(&events, &model.ask)
        .and_then(|ask| ask["data"]["default"].as_str().map(str::to_owned));
    let index = default
        .and_then(|id| model.options.iter().position(|o| o.id == id))
        .or_else(|| model.options.iter().position(|o| o.recommended))
        .or((!model.options.is_empty()).then_some(0))?;
    Some(Target::Option(index))
}

/// The card's measured size, what a slot must hold to arm.
pub const SIZE: [i64; 2] = question::CARD_SIZE;
