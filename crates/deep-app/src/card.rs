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
                gpui_kit::size(px(480.), px(240.)),
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
}

/// Issue #1172: a Needs you row's click: presents `ask`'s card in the middle of the window, its content read from the
/// record once. One already up leaves first, unanswered. An ask the record no longer holds open presents nothing.
pub fn present_ask(ask: &str, window: &mut Window, cx: &mut App) {
    leave(cx);
    let viewport = window.viewport_size();
    let (width, height) = (f32::from(viewport.width), f32::from(viewport.height));
    let [w, h] = SIZE;
    let rect = [
        ((width as i64 - w) / 2).max(0),
        ((height as i64 - h) / 2).max(0),
        w,
        h,
    ];
    let slot = crate::arming::Slot {
        rect,
        visible: [0, 0, width as i64, height as i64],
    };
    let events = crate::record::history();
    let now = crate::views::now();
    let Some(controller) = Controller::present(&events, ask, now, slot, Default::default()) else {
        return;
    };
    let shown = present_question(controller, window, cx);
    SHOWN.with(|cell| *cell.borrow_mut() = Some((ask.to_owned(), shown)));
}

fn leave(cx: &mut App) {
    if let Some((_, shown)) = SHOWN.with(|cell| cell.borrow_mut().take()) {
        shown.update(cx, |card, cx| card.dismiss(cx));
    }
}

/// Time passed: the shown card arms once its interval ran, and leaves when its ask closed anywhere.
pub fn tick(now: u64, cx: &mut App) {
    let Some((ask, shown)) = SHOWN.with(|cell| cell.borrow().clone()) else {
        return;
    };
    let open = crate::record::with_view(|view| view.table().is_open(&ask)).unwrap_or(true);
    if !open {
        leave(cx);
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
        Card {
            question,
            options,
            bounds,
            focus: cx.focus_handle(),
            controller,
            down: None,
            failed: None,
        }
    }

    pub fn controller_mut(&mut self) -> Option<&mut Controller> {
        self.controller.as_mut()
    }

    /// Takes the card off the window without an answer, as when its ask closed elsewhere or another is presented.
    pub fn dismiss(&mut self, cx: &mut Context<Self>) {
        cx.emit(PromptResponse(0));
    }

    /// The down of a press on `target`.
    fn pressing(&mut self, target: Target) {
        let (t, hardware) = edge(PressEdge::Down);
        self.down = Some((target, t, hardware));
    }

    /// The up of a press on `target`, with its down: the controller decides what the whole press does.
    fn pressed(&mut self, target: Target, cx: &mut Context<Self>) {
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
        let label: SharedString = row.label().to_owned().into();
        let (id, role, target): (ElementId, Role, Option<Target>) = match row {
            Row::Text(_) => (("card-line", index).into(), Role::Label, None),
            Row::Option { index, .. } => (
                ("card-option", *index).into(),
                Role::Button,
                Some(Target::Option(*index)),
            ),
            Row::Step { index, .. } => (
                ("card-step", *index).into(),
                Role::Button,
                Some(Target::Step(*index)),
            ),
            Row::Send => ("card-send".into(), Role::Button, Some(Target::Send)),
            Row::Undo => ("card-undo".into(), Role::Button, Some(Target::Undo)),
        };
        let focused = matches!(row, Row::Option { focused: true, .. });
        let element = div()
            .id(id)
            .test_support()
            .role(role)
            .aria_label(label.clone())
            .flex()
            .items_center()
            .text_xs()
            .child(label);
        match target {
            Some(target) => element
                .px_3()
                .py_1()
                .border_1()
                .border_color(if focused {
                    chrome.focus
                } else {
                    chrome.ink_primary
                })
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(move |card, _, _, _| card.pressing(target)),
                )
                .on_click(cx.listener(move |card, _, _, cx| card.pressed(target, cx)))
                .into_any_element(),
            None => element.into_any_element(),
        }
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
        // The card keeps the keyboard while it shows: focus anything else took, it takes back at its next frame.
        if !self.focus.is_focused(window) {
            window.focus(&self.focus, cx);
        }
        let chrome = crate::chrome::of(window);
        let rows: Vec<AnyElement> = match &self.controller {
            Some(controller) => {
                let rows = controller.rows();
                let mut drawn: Vec<AnyElement> = rows
                    .iter()
                    .enumerate()
                    .map(|(index, row)| self.row(index, row, chrome, cx))
                    .collect();
                drawn.extend(self.failed.clone().map(|line| {
                    div()
                        .id("card-failed")
                        .test_support()
                        .role(Role::Label)
                        .aria_label(line.clone())
                        .text_xs()
                        .child(line)
                        .into_any_element()
                }));
                drawn
            }
            None => vec![
                div()
                    .text_base()
                    .child(self.question.clone())
                    .into_any_element(),
                div()
                    .flex()
                    .gap_2()
                    .children(self.options.iter().enumerate().map(|(index, option)| {
                        div()
                            .id(("card-option", index))
                            .px_3()
                            .py_1()
                            .border_1()
                            .border_color(chrome.ink_primary)
                            .on_click(
                                cx.listener(move |_, _, _, cx| cx.emit(PromptResponse(index))),
                            )
                            .child(option.clone())
                    }))
                    .into_any_element(),
            ],
        };
        // The card as laid out, which grows past its slot with more rows than fit: what arming judges.
        let card = cx.entity().downgrade();
        let measure = canvas(
            move |bounds, _, cx| {
                let size = [
                    f32::from(bounds.size.width).ceil() as i64,
                    f32::from(bounds.size.height).ceil() as i64,
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
        // The prompt fills the window; only the card itself takes a hitbox, so the rest of the window still
        // takes your input. The card's outer edge is what's measured, its border included.
        div().size_full().child(
            div()
                .absolute()
                .left(self.bounds.origin.x)
                .top(self.bounds.origin.y)
                .w(self.bounds.size.width)
                .child(
                    div()
                        .id("question-card")
                        .track_focus(&self.focus)
                        .occlude()
                        .w_full()
                        // The slot's height at least: a card with more rows than its slot grows, never clips, so
                        // every row stays readable, and doesn't arm while it is taller than its slot.
                        .min_h(self.bounds.size.height)
                        .flex()
                        .flex_col()
                        .gap_1()
                        .p_4()
                        .bg(chrome.raised)
                        .border_1()
                        .border_color(chrome.ink_primary)
                        .text_color(chrome.ink_primary)
                        .children(rows),
                )
                .child(measure),
        )
    }
}

/// The id every element of a presented card draws under.
pub const CARD_ID: &str = "question-card";

/// The card's measured size, what a slot must hold to arm.
pub const SIZE: [i64; 2] = question::CARD_SIZE;
