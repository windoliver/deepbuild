//! Issue #326: the question card, the app shell's. Nothing can cover it: it is presented as the window's prompt,
//! which gpui paints after the root, after every deferred draw (popovers, menus, a panel's overlays), and in place
//! of tooltips, so a panel can draw nothing over it. While it shows it keeps the keyboard: focus a panel moves
//! away from it comes straight back, so no panel moves focus without your gesture.
//!
//! Issue #327: a card presented for an ask draws from its [`Controller`](question::Controller), every row an
//! accessibility node an assistive client reads, and hands each press on a row to it. The view can't name a
//! press's platform timestamp or source, so a press from it counts as not hardware: it answers only after the OS
//! confirms you, and until the shell raises that prompt it is a cancelled one, so the card stays armed.

use std::cell::RefCell;

use gpui_kit::*;
use serde_json::Value;

use crate::arming::Source;
use crate::question::{self, Controller, Did, Input, Phase, Row, Target};

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

fn events() -> Vec<Value> {
    crate::record::with_view(|view| view.events.clone()).unwrap_or_default()
}

pub struct Card {
    question: SharedString,
    options: Vec<SharedString>,
    bounds: Bounds<Pixels>,
    focus: FocusHandle,
    controller: Option<Controller>,
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
        }
    }

    pub fn controller_mut(&mut self) -> Option<&mut Controller> {
        self.controller.as_mut()
    }

    /// Takes the card off the window without an answer, as when its ask closed elsewhere or another is presented.
    pub fn dismiss(&mut self, cx: &mut Context<Self>) {
        cx.emit(PromptResponse(0));
    }

    /// A press from the view on `target`, down and up: not hardware, since the view can't say, so one the OS
    /// must confirm; with no prompt to raise, a cancelled one.
    fn pressed(&mut self, target: Target, cx: &mut Context<Self>) {
        let Some(controller) = self.controller.as_mut() else {
            return;
        };
        let (t, source) = (crate::views::now(), Source::Synthetic { pid: None });
        let events = events();
        let did = match controller.press(
            Input {
                t,
                source,
                target,
                phase: Phase::Down,
            },
            &events,
            t,
        ) {
            Did::Nothing => controller.press(
                Input {
                    t,
                    source,
                    target,
                    phase: Phase::Up,
                },
                &events,
                t,
            ),
            other => other,
        };
        if let Did::NeedsConfirmation(_) = did {
            controller.confirmed(false, &events, t);
        }
        cx.notify();
    }

    fn row(&self, index: usize, row: &Row, cx: &mut Context<Self>) -> AnyElement {
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
                .border_color(rgb(if focused { 0x2563EB } else { crate::brand::INK }))
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
        let rows: Vec<AnyElement> = match &self.controller {
            Some(controller) => {
                let rows = controller.rows();
                rows.iter()
                    .enumerate()
                    .map(|(index, row)| self.row(index, row, cx))
                    .collect()
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
                            .border_color(rgb(crate::brand::INK))
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
                        .bg(rgb(crate::brand::PAPER))
                        .border_1()
                        .border_color(rgb(crate::brand::INK))
                        .text_color(rgb(crate::brand::INK))
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
