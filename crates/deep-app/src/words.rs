//! Issue #1998: the box at the foot of the window. You say a change in words; the hub drafts it as a proposed change,
//! approved on its question card in Needs you like any other ask, and the box says it was drafted and opens that card.
//! ⌘K's preference words open the box with their change drafted beside its current value, so there is no Settings
//! page to hunt for.

use std::cell::RefCell;
use std::sync::Arc;

use gpui_kit::base::input::{Input, InputEvent, InputState};
use gpui_kit::*;
use serde_json::{json, Value};

use crate::chrome::{self, sizes};
use crate::views::observed;
use crate::views::{control, Control};

/// Sends the box's words to the hub (`box.say`): the proposal and its ask, or `unread`, the one line why nothing was drafted.
pub type Say = Arc<dyn Fn(&str) -> Result<Value, String> + Send + Sync>;

/// `box.say` through the app's own hub connection.
pub fn hub_say() -> Say {
    Arc::new(|words| {
        crate::hub::HubClient::app()
            .and_then(|mut hub| hub.call("box.say", json!({ "words": words })))
            .map_err(|error| format!("{error:?}"))
    })
}

/// What the box last heard back.
enum Said {
    Nothing,
    Drafted { ask: String, question: String },
    Unread(String),
}

/// The box: your words, what a ⌘K preference word drafted them beside, and what came back.
pub struct WordsBox {
    input: Entity<InputState>,
    beside: Option<String>,
    said: Said,
    say: Say,
    _entered: Subscription,
}

thread_local! {
    static BOX: RefCell<Option<WeakEntity<WordsBox>>> = const { RefCell::new(None) };
}

impl WordsBox {
    pub fn new(say: Say, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder("Say a change in words"));
        let entered = cx.subscribe_in(
            &input,
            window,
            |this: &mut Self, _, event: &InputEvent, window, cx| {
                if matches!(event, InputEvent::PressEnter { .. }) {
                    this.send(window, cx);
                }
            },
        );
        BOX.with(|cell| *cell.borrow_mut() = Some(cx.entity().downgrade()));
        WordsBox {
            input,
            beside: None,
            said: Said::Nothing,
            say,
            _entered: entered,
        }
    }

    /// Sends the words off the main thread; what comes back is drawn under them.
    fn send(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let words = self.input.read(cx).value().trim().to_owned();
        if words.is_empty() {
            return;
        }
        let say = self.say.clone();
        cx.spawn(async move |this, cx| {
            let heard = cx.background_spawn(async move { say(&words) }).await;
            let _ = this.update(cx, |this, cx| {
                this.said = match heard {
                    Ok(reply) if reply["ask"].is_string() => Said::Drafted {
                        ask: reply["ask"].as_str().unwrap_or_default().to_owned(),
                        question: reply["question"].as_str().unwrap_or_default().to_owned(),
                    },
                    Ok(reply) => Said::Unread(
                        reply["unread"]
                            .as_str()
                            .unwrap_or("Nothing was drafted.")
                            .to_owned(),
                    ),
                    Err(error) => Said::Unread(format!("The hub didn't take it: {error}")),
                };
                cx.notify();
            });
        })
        .detach();
    }
}

/// The preferences ⌘K lists, each with the words it is found by: there is no Settings page, so each opens the box.
pub const PREFERENCES: &[(&str, &[&str])] = &[
    (
        "Sounds",
        &[
            "sound",
            "sounds",
            "mute",
            "unmute",
            "notifications",
            "settings",
        ],
    ),
    // Neither has a value you can change yet, so neither drafts a change: each says what it is.
    ("Appearance", &["theme", "font"]),
    ("Keys", &["keys", "shortcuts"]),
];

/// ⌘K's entries for the preferences.
pub fn preference_entries() -> Vec<crate::commands::Entry> {
    PREFERENCES
        .iter()
        .map(|(name, words)| crate::commands::Entry::Preference {
            name: (*name).to_owned(),
            words,
        })
        .collect()
}

/// A preference's change drafted beside its current value: turning sounds off beside sounds being on, and so on.
pub fn preference(name: &str) -> (&'static str, String) {
    match name {
        "Sounds" if crate::hub::sounds_on() => ("turn sounds off", "Sounds are on.".to_owned()),
        "Sounds" => ("turn sounds on", "Sounds are off.".to_owned()),
        "Appearance" => ("", "The theme follows macOS's light or dark appearance, in the system font at its default size.".to_owned()),
        _ => ("", "⌘K opens commands and pages; Return sends the box's words.".to_owned()),
    }
}

/// ⌘K's preference entry: the box opens with its change drafted beside what it is now.
pub fn open_preference(name: &str, window: &mut Window, cx: &mut App) {
    let (words, now) = preference(name);
    draft(words, &now, window, cx);
}

/// Opens the box with `words` drafted beside `now`, what it is at present, its input focused.
pub fn draft(words: &str, now: &str, window: &mut Window, cx: &mut App) {
    let Some(entity) = BOX.with(|cell| cell.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    entity.update(cx, |this, cx| {
        this.beside = Some(now.to_owned());
        this.said = Said::Nothing;
        this.input.update(cx, |input, cx| {
            input.set_value(words.to_owned(), window, cx);
            input.focus(window, cx);
        });
        cx.notify();
    });
}

impl Render for WordsBox {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let chrome = chrome::of(window);
        let line = |id: &'static str, text: String| {
            observed(id)
                .role(Role::Label)
                .aria_label(text.clone())
                .child(text)
        };
        let said = match &self.said {
            Said::Nothing => None,
            Said::Unread(why) => Some(line("box-said", why.clone()).into_any_element()),
            Said::Drafted { ask, question } => {
                let ask = ask.clone();
                Some(
                    div()
                        .flex()
                        .gap(sizes().space(1))
                        .items_center()
                        .child(line("box-said", format!("Drafted: {question}")))
                        .child(
                            control("box-open", Control::Plain, "Open its card", chrome).on_click(
                                move |_, window, cx| crate::card::present_ask(&ask, window, cx),
                            ),
                        )
                        .into_any_element(),
                )
            }
        };
        let draft = self.input.read(cx).value().to_string();
        observed("box")
            .role(Role::Group)
            .aria_label("Say a change in words")
            .flex_none()
            .w_full()
            .flex()
            .flex_col()
            .items_center()
            .p(sizes().space(1))
            .border_t(sizes().hairline)
            .border_color(chrome.divider)
            .child(
                div()
                    .w(relative(0.8))
                    .flex()
                    .flex_col()
                    .gap(sizes().space(0))
                    .children(
                        self.beside
                            .clone()
                            .map(|now| line("box-current", now).text_color(chrome.ink_secondary)),
                    )
                    .child(
                        div()
                            .flex()
                            .gap(sizes().space(1))
                            .items_center()
                            // The drafted change is the input's words, its value (#1459's author id).
                            .child(
                                observed("box-draft")
                                    .role(Role::TextInput)
                                    .aria_label("Say a change in words")
                                    .aria_value(draft)
                                    .flex_1()
                                    .h(sizes().title.line + sizes().space(2))
                                    .child(Input::new(&self.input)),
                            )
                            .child(
                                control("box-send", Control::Plain, "Send", chrome).on_click(
                                    cx.listener(|this, _, window, cx| this.send(window, cx)),
                                ),
                            ),
                    )
                    .children(said),
            )
    }
}
