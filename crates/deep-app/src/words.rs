//! Issue #1998: the box at the foot of every page (#1461). You say a change in words; the hub drafts it as a proposed change,
//! approved on its question card in Needs you like any other ask, and the box says it was drafted and opens that card.
//! ⌘K's preference words open the box with their change drafted beside its current value, so there is no Settings
//! page to hunt for.
//!
//! Issue #1461: one box, at the foot of every page, the lane's width, 2 to 10 lines and then it scrolls. On an ask's
//! page it's the card's words: it answers that ask by the card's arming and input rules and never starts work, and its
//! send control says what the press does.

use std::cell::RefCell;
use std::sync::Arc;

use gpui_kit::base::input::{InputEvent, Textarea, TextareaState};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use serde_json::{json, Value};

use crate::chrome::{self, sizes, Typed as _};
use crate::question::Target;
use crate::views::observed;
use crate::views::{control, Control};

/// Sends the box's words to the hub (`box.say`): the proposal and its ask, or `unread`, the one line why nothing was drafted.
pub type Say = Arc<dyn Fn(&str) -> Result<Value, String> + Send + Sync>;

/// `box.say` through the app's own hub connection.
pub fn hub_say() -> Say {
    Arc::new(|words| {
        crate::hub::call_app("box.say", json!({ "words": words }))
            .map_err(|error| crate::hub::why(&error))
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
    input: Entity<TextareaState>,
    beside: Option<String>,
    said: Said,
    say: Say,
    _entered: Subscription,
}

thread_local! {
    static BOX: RefCell<Option<WeakEntity<WordsBox>>> = const { RefCell::new(None) };
    /// The box's input's keys, which a snapshot reads as `box-draft` holding the keyboard (#1462).
    static KEYS: RefCell<Option<FocusHandle>> = const { RefCell::new(None) };
}

/// Puts the keyboard in the box (⌘N, F6): its words stay as they are.
pub fn focus(window: &mut Window, cx: &mut App) {
    let Some(entity) = BOX.with(|cell| cell.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    crate::card::let_go();
    entity.update(cx, |this, cx| {
        this.input.update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    });
}

/// A printable key typed on a page: the box takes the keyboard and the key's text (#1462).
pub fn type_in(text: &str, window: &mut Window, cx: &mut App) {
    let Some(entity) = BOX.with(|cell| cell.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    crate::card::let_go();
    let text = text.to_owned();
    entity.update(cx, |this, cx| {
        this.input.update(cx, |input, cx| {
            input.focus(window, cx);
            input.insert(text, window, cx);
        });
        cx.notify();
    });
}

/// The box's keys, once it's made.
pub(crate) fn keys() -> Option<FocusHandle> {
    KEYS.with(|keys| keys.borrow().clone())
}

/// Whether the box holds the keyboard in `window`.
pub fn focused(window: &Window) -> bool {
    KEYS.with(|keys| {
        keys.borrow()
            .as_ref()
            .is_some_and(|keys| keys.is_focused(window))
    })
}

impl WordsBox {
    pub fn new(say: Say, window: &mut Window, cx: &mut Context<Self>) -> Self {
        // Return sends, Shift-Return starts a line; on an ask's page Return sends nothing, since no key answers (#1462).
        let input = cx.new(|cx| {
            // #1461's planted box grows with its lines past 10.
            let most = if crate::plain::planted("box-grows-past-10") {
                100
            } else {
                10
            };
            TextareaState::new(window, cx)
                .auto_grow(2, most)
                .submit_on_enter(true)
        });
        let entered = cx.subscribe_in(
            &input,
            window,
            |this: &mut Self, input, event: &InputEvent, window, cx| match event {
                InputEvent::PressEnter { .. } if answering(cx).is_none() => this.send(window, cx),
                InputEvent::Change => {
                    if let Some(card) = answering(cx) {
                        let words = input.read(cx).value().to_string();
                        card.update(cx, |card, cx| card.type_words(&words, cx));
                    }
                    cx.notify();
                }
                _ => {}
            },
        );
        BOX.with(|cell| *cell.borrow_mut() = Some(cx.entity().downgrade()));
        let keys = input.read(cx).focus_handle(cx);
        KEYS.with(|cell| *cell.borrow_mut() = Some(keys));
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
                    // Words for a new project (#1342): its brief is being worked out, and its card comes to Needs you.
                    Ok(reply) if reply["state"] == "working" => Said::Unread(format!(
                        "Working on it: {}. Its card comes to Needs you when it's ready.",
                        reply["heading"].as_str().unwrap_or_default()
                    )),
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

/// The card whose page the box is on (#1461), when an ask's page is shown.
fn answering(cx: &App) -> Option<Entity<crate::card::Card>> {
    crate::card::showing(cx)
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
        let s = sizes();
        let line = |id: &'static str, text: String| {
            observed(id)
                .role(Role::Label)
                .aria_label(text.clone())
                .child(text)
        };
        let card = answering(cx);
        let draft = self.input.read(cx).value().to_string();
        // On an ask's page the box is the card's words, and its control says what the press does (#1461).
        let (send, lines) = match &card {
            Some(card) => card.read(cx).words_send(),
            None => ("Send", Vec::new()),
        };
        let said = match (&self.said, &card) {
            (_, Some(_)) | (Said::Nothing, _) => None,
            (Said::Unread(why), None) => Some(line("box-said", why.clone()).into_any_element()),
            (Said::Drafted { ask, question }, None) => {
                let ask = ask.clone();
                Some(
                    div()
                        .flex()
                        .gap(s.space(1))
                        .items_center()
                        .child(line("box-said", format!("Drafted: {question}")))
                        .child(
                            control("box-open", Control::Plain, "Open its card", chrome).on_click(
                                move |_, window, cx| {
                                    let ask = crate::address::Address::ask(&ask);
                                    crate::open::open(&ask, window, cx).ok();
                                },
                            ),
                        )
                        .into_any_element(),
                )
            }
        };
        let send_control = control("box-send", Control::Plain, send, chrome).flex_none();
        // #1461's planted box sends its words as new work on an ask's page too.
        let starts_work = crate::plain::planted("box-starts-work");
        let send_control = match card.clone().filter(|_| !starts_work) {
            // The card's own press: its arming and input rules decide what it does.
            Some(card) => {
                let down = card.clone();
                send_control
                    .on_mouse_down(MouseButton::Left, move |_, _, cx| {
                        down.update(cx, |card, _| card.pressing(Target::Send));
                    })
                    .on_click(cx.listener(move |this, _, window, cx| {
                        card.update(cx, |card, cx| card.pressed(Target::Send, cx));
                        this.input
                            .update(cx, |input, cx| input.set_value("", window, cx));
                    }))
            }
            None => send_control.on_click(cx.listener(|this, _, window, cx| this.send(window, cx))),
        };
        // Where the box is drawn: the window's notices sit above it, and on an ask's page it measures with the card.
        let on_page = card.is_some();
        let measure = canvas(
            move |bounds, window, _| {
                crate::notice::box_drawn(bounds, window);
                if on_page {
                    crate::card::box_measured(f32::from(bounds.size.height).ceil() as i64);
                }
            },
            |_, _, _, _| {},
        )
        .absolute()
        .size_full();
        observed("box")
            .role(Role::Group)
            .aria_label("Say a change in words")
            .relative()
            // A press in the box takes the keyboard from the card on an ask's page (#1461).
            .capture_any_mouse_down(|_, _, _| crate::card::let_go())
            // Escape gives the keyboard back to the list, the words kept (#1462).
            .capture_key_down(|event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "escape" && event.keystroke.modifiers == Modifiers::none()
                {
                    crate::views::focus_list(window, cx);
                    cx.stop_propagation();
                }
            })
            .flex_none()
            .w_full()
            .flex()
            .flex_col()
            .gap(s.space(0))
            .child(measure)
            .children(
                self.beside
                    .clone()
                    .filter(|_| !on_page)
                    .map(|now| line("box-current", now).text_color(chrome.ink_secondary)),
            )
            .children(lines.into_iter().enumerate().map(|(n, text)| {
                observed(("box-note", n))
                    .role(Role::Label)
                    .aria_label(text)
                    .typed(s.small)
                    .text_color(chrome.ink_secondary)
                    .child(text)
            }))
            .child(
                // The lane's width, 12 inside, the one radius, on the raised fill with no border (#1461).
                div()
                    .w_full()
                    .flex()
                    .items_end()
                    .gap(s.space(1))
                    .p(s.space(2))
                    .rounded(s.radius)
                    .bg(chrome.raised)
                    // The words are the input's value (#1459's author id).
                    .child(
                        observed("box-draft")
                            .role(Role::TextInput)
                            .aria_label("Say a change in words")
                            .aria_value(draft)
                            .flex_1()
                            .min_w_0()
                            .when(on_page, |d| d.aria_label("Your words"))
                            .child(Textarea::new(&self.input)),
                    )
                    .child(send_control),
            )
            .children(said)
    }
}
