//! Issue #326: the question card, the app shell's. Nothing can cover it: it is presented as the window's prompt,
//! which gpui paints after the root, after every deferred draw (popovers, menus, a panel's overlays), and in place
//! of tooltips, so a panel can draw nothing over it. While it shows it keeps the keyboard: focus a panel moves
//! away from it comes straight back, so no panel moves focus without your gesture.

use std::cell::RefCell;

use gpui_kit::*;

thread_local! {
    /// Where the next card is presented, in window points.
    static AT: RefCell<Option<Bounds<Pixels>>> = const { RefCell::new(None) };
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
        let card = cx.new(|cx| Card::new(question.to_owned().into(), options, bounds, cx));
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

pub struct Card {
    question: SharedString,
    options: Vec<SharedString>,
    bounds: Bounds<Pixels>,
    focus: FocusHandle,
}

impl Card {
    fn new(
        question: SharedString,
        options: Vec<SharedString>,
        bounds: Bounds<Pixels>,
        cx: &mut Context<Self>,
    ) -> Self {
        Card {
            question,
            options,
            bounds,
            focus: cx.focus_handle(),
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
        // The prompt fills the window; only the card itself takes a hitbox, so the rest of the window still
        // takes your input.
        div().size_full().child(
            div()
                .id("question-card")
                .track_focus(&self.focus)
                .occlude()
                .absolute()
                .left(self.bounds.origin.x)
                .top(self.bounds.origin.y)
                .w(self.bounds.size.width)
                .h(self.bounds.size.height)
                .overflow_hidden()
                .flex()
                .flex_col()
                .gap_3()
                .p_4()
                .bg(rgb(crate::brand::PAPER))
                .border_1()
                .border_color(rgb(crate::brand::INK))
                .text_color(rgb(crate::brand::INK))
                .child(div().text_base().child(self.question.clone()))
                .child(
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
                        })),
                ),
        )
    }
}
