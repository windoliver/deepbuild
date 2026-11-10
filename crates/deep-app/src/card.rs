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
                    card.update(cx, |card, _| {
                        if let Some(controller) = card.controller.as_mut() {
                            // The window as it is now: a window made larger keeps the card armable.
                            let slot = crate::arming::Slot { rect, visible };
                            controller.placed(slot, crate::views::now());
                        }
                    })
                    .ok();
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        let lane = crate::views::in_lane(
            div()
                .flex()
                .flex_col()
                .pt(sizes().space(4))
                .text_color(chrome.ink_primary)
                .children(card),
            true,
        );
        let region = crate::open::page_of(crate::open::Region::Ask, cx);
        div()
            .id("ask-page")
            .size_full()
            .relative()
            .typed(sizes().body)
            .child(page)
            .child(crate::views::page_region(region, lane))
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
    let open = crate::record::with_view(|view| view.table().is_open(&ask)).unwrap_or(true);
    if !open {
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
        if let Some(controller) = card.controller_mut() {
            controller.tick(now);
            cx.notify();
        }
    });
}

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
                        Row::Text(_) => None,
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
        self.controller
            .as_ref()
            .map_or(("Answer", Vec::new()), Controller::words_send)
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
        if let Did::NeedsConfirmation(reason) = did {
            self.confirm(reason, cx);
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

    /// Sends what the controller answered, in order.
    fn send(&mut self, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.as_mut() else {
            return;
        };
        let answers = controller.take_answers();
        if answers.is_empty() {
            return;
        }
        self.failed = None;
        cx.spawn(async move |card, cx| {
            let sent = cx
                .background_spawn(async move {
                    answers
                        .iter()
                        .try_for_each(|params| crate::answer::send(params).map(|_| ()))
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
        let label: SharedString = row.label().to_owned().into();
        let (kind, target): (Option<Control>, Option<Target>) = match row {
            Row::Text(_) => (None, None),
            Row::Option { index, .. } => (Some(Control::Plain), Some(Target::Option(*index))),
            Row::Step { index, on, .. } => (Some(Control::Switch(*on)), Some(Target::Step(*index))),
            Row::Send => (Some(Control::Main), Some(Target::Send)),
            Row::Undo => (Some(Control::Plain), Some(Target::Undo)),
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
        if let Some(choice) = choice {
            let beside: Vec<String> = choice
                .recommended
                .then(|| "recommended".to_owned())
                .into_iter()
                .chain(choice.cost.clone())
                .collect();
            return control(id, kind, choice.label.clone(), chrome)
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
                                    .aria_label("Your words")
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
