//! Issue #1462: the one action table. Each action has a name, its label's verb, what it acts on and its key, and the
//! menu bar, ⌘K, a row's context menu and the tree all read these rows (`actions.json`), so an action is in every
//! place with one name and one key. The key comes from the keymap (`~/.deepbuild/keymap.json`, `{"bindings": {name:
//! keystroke}}`), read at launch and again whenever it changes, else from the table. No action answers an ask: an ask
//! is answered only on its card (#327).

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;

use gpui_kit::*;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::address::{Address, Place};

/// One row of the table.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
pub struct Action {
    pub name: String,
    pub verb: String,
    pub target: String,
    pub key: Option<String>,
    pub variant_of: Option<String>,
}

/// The table the app ships, in its order.
pub fn table() -> &'static [Action] {
    static TABLE: OnceLock<Vec<Action>> = OnceLock::new();
    TABLE.get_or_init(|| {
        #[derive(Deserialize)]
        struct File {
            actions: Vec<Action>,
        }
        serde_json::from_str::<File>(include_str!("actions.json"))
            .expect("actions.json is the action table")
            .actions
    })
}

/// Runs the table's action `name`: what its key, its menu item, ⌘K and a row's context menu send.
#[derive(Clone, PartialEq, Debug, gpui::Action)]
#[action(namespace = deepbuild, no_json)]
pub struct Run {
    pub name: SharedString,
}

/// Opens a page by its address: the View menu's items.
#[derive(Clone, PartialEq, Debug, gpui::Action)]
#[action(namespace = deepbuild, no_json)]
pub struct Show {
    pub address: SharedString,
}

/// Where each action's key binds: ⌘[ and ⌘] belong to a text field or a terminal while one has the keys (#1460).
fn context(name: &str) -> Option<&'static str> {
    match name {
        "Back" | "Forward" => Some("!Input && !Terminal"),
        _ => None,
    }
}

/// The keymap file: your keys, by action name.
pub fn keymap_path() -> std::path::PathBuf {
    crate::hub::root().join("keymap.json")
}

fn read_keymap() -> (String, HashMap<String, String>) {
    let text = std::fs::read_to_string(keymap_path()).unwrap_or_default();
    let bindings = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v["bindings"].as_object().cloned())
        .map(|bindings| {
            bindings
                .into_iter()
                .filter_map(|(name, key)| Some((name, key.as_str()?.to_owned())))
                .filter(|(_, key)| Keystroke::parse(key).is_ok())
                .collect()
        })
        .unwrap_or_default();
    (text, bindings)
}

/// The keymap file's text as last read, and each action's key now.
type Keys = (String, HashMap<String, Option<String>>);

thread_local! {
    static KEYS: RefCell<Option<Keys>> = const { RefCell::new(None) };
    /// The pages the View menu lists, by name and address: the shipped pages and every page a view registers.
    static PAGES: RefCell<Vec<(String, String)>> = const { RefCell::new(Vec::new()) };
}

/// The key `name` runs on now, in the table's form (`cmd-shift-j`): the keymap's, else the table's.
pub fn key(name: &str) -> Option<String> {
    KEYS.with(|keys| {
        keys.borrow()
            .as_ref()
            .and_then(|(_, keys)| keys.get(name).cloned())
    })
    .unwrap_or_else(|| table().iter().find(|a| a.name == name)?.key.clone())
}

/// The keys from the table and the keymap: each action whose key moved gives up the old one.
fn bind(cx: &mut App) {
    let (text, mine) = read_keymap();
    let was = KEYS.with(|keys| keys.borrow().clone());
    if was.as_ref().is_some_and(|(read, _)| *read == text) {
        return;
    }
    let mut now = HashMap::new();
    let mut bindings = Vec::new();
    for action in table() {
        let key = mine
            .get(&action.name)
            .cloned()
            .or_else(|| action.key.clone());
        let before = was
            .as_ref()
            .and_then(|(_, keys)| keys.get(&action.name).cloned())
            .flatten();
        if was.is_some() && before == key {
            now.insert(action.name.clone(), key);
            continue;
        }
        if let Some(old) = before {
            bindings.push(KeyBinding::new(&old, NoAction {}, context(&action.name)));
        }
        if let Some(key) = &key {
            let run = Run {
                name: action.name.clone().into(),
            };
            bindings.push(KeyBinding::new(key, run, context(&action.name)));
        }
        now.insert(action.name.clone(), key);
    }
    KEYS.with(|keys| *keys.borrow_mut() = Some((text, now)));
    cx.bind_keys(bindings);
}

/// How often the keymap file is read again.
const KEYMAP_TICK: Duration = Duration::from_millis(250);

/// Binds the table's keys, sets the menu bar and reads the keymap again whenever it changes.
pub fn init(cx: &mut App) {
    bind(cx);
    set_menus(cx);
    cx.on_action(|action: &Run, cx| {
        let name = action.name.to_string();
        // The app's own actions need no window: ⌘Q quits with every window closed (#1809).
        match name.as_str() {
            "Quit DeepBuild" => cx.quit(),
            "Hide DeepBuild" => cx.hide(),
            _ => on_window(cx, move |window, cx| run(&name, window, cx)),
        }
    });
    cx.on_action(|action: &Show, cx| {
        let address = action.address.to_string();
        on_window(cx, move |window, cx| {
            if let Ok(address) = address.parse::<Address>() {
                crate::open::open(&address, window, cx).ok();
            }
        });
    });
    cx.spawn(async move |cx| loop {
        cx.background_executor().timer(KEYMAP_TICK).await;
        let moved = cx.update(|cx| {
            let before = KEYS.with(|keys| keys.borrow().as_ref().map(|(text, _)| text.clone()));
            bind(cx);
            let after = KEYS.with(|keys| keys.borrow().as_ref().map(|(text, _)| text.clone()));
            before != after
        });
        if moved {
            cx.update(|cx| {
                set_menus(cx);
                cx.refresh_windows();
            });
        }
    })
    .detach();
}

/// Runs `f` in the shell's window once the current dispatch is over: a menu item or a key with no element to handle it.
fn on_window(cx: &mut App, f: impl FnOnce(&mut Window, &mut App) + 'static) {
    let Some(window) = crate::open::window(cx) else {
        return;
    };
    cx.defer(move |cx| {
        let _ = window.update(cx, |_, window, cx| f(window, cx));
    });
}

/// The pages View lists from now on, by name and address.
pub fn set_pages(pages: Vec<(String, String)>, cx: &mut App) {
    PAGES.with(|cell| *cell.borrow_mut() = pages);
    set_menus(cx);
}

fn item(name: &str) -> MenuItem {
    MenuItem::action(
        name.to_owned(),
        Run {
            name: name.to_owned().into(),
        },
    )
}

/// The Session menu's items for the selected row, in order: a row's context menu holds the same (#886).
pub fn session_items() -> Vec<&'static str> {
    let mut items = vec![
        "Open",
        "Pause",
        "Write to it",
        "Later",
        "Copy title",
        "Copy link",
    ];
    if cfg!(feature = "plant-no-later") {
        items.retain(|name| *name != "Later");
    }
    items
}

/// The names each menu holds, in order, the table's alone: View's pages and Edit's text items come after.
fn layout() -> Vec<(&'static str, Vec<&'static str>)> {
    let mut deepbuild = vec!["Preferences", "Hide DeepBuild", "Quit DeepBuild"];
    if cfg!(feature = "plant-no-quit-item") {
        deepbuild.retain(|name| !name.starts_with("Quit"));
    }
    let mut session = session_items();
    if cfg!(feature = "plant-approve-menu-item") {
        session.push("Approve");
    }
    let mut menus = vec![
        ("DeepBuild", deepbuild),
        ("File", vec!["Write in the box", "Close Window"]),
        ("Edit", vec!["Undo answer"]),
        ("View", vec!["Commands"]),
        ("Go", vec!["Back", "Forward", "Next ask", "Next area"]),
        ("Session", session),
        ("Window", vec!["Minimize"]),
        ("Help", vec!["Keyboard shortcuts"]),
    ];
    if cfg!(feature = "plant-action-missing-from-menu") {
        for (_, items) in &mut menus {
            items.retain(|name| *name != "Copy link");
        }
    }
    menus
}

/// The menu bar: DeepBuild, File, Edit, View, Go, Session, Window and Help, every action of the table in one of them.
pub fn menus() -> Vec<Menu> {
    layout()
        .into_iter()
        .map(|(name, names)| {
            let mut items: Vec<MenuItem> = names.into_iter().map(item).collect();
            match name {
                "Edit" => {
                    use gpui_kit::base::input::{Copy, Cut, Paste, SelectAll};
                    items.extend([
                        MenuItem::separator(),
                        MenuItem::os_action("Cut", Cut, OsAction::Cut),
                        MenuItem::os_action("Copy", Copy, OsAction::Copy),
                        MenuItem::os_action("Paste", Paste, OsAction::Paste),
                        MenuItem::os_action("Select All", SelectAll, OsAction::SelectAll),
                    ]);
                }
                "View" => {
                    items.push(MenuItem::separator());
                    items.extend(PAGES.with(|pages| {
                        pages
                            .borrow()
                            .iter()
                            .map(|(name, address)| {
                                MenuItem::action(
                                    name.clone(),
                                    Show {
                                        address: address.clone().into(),
                                    },
                                )
                            })
                            .collect::<Vec<_>>()
                    }));
                }
                _ => {}
            }
            Menu {
                name: name.into(),
                items,
                disabled: false,
            }
        })
        .collect()
}

pub fn set_menus(cx: &mut App) {
    cx.set_menus(menus());
}

/// The key a menu item shows for `action`, in the table's form, as the macOS menu bar picks it: the first binding
/// that applies outside any text field, else the first.
pub fn menu_key(action: &dyn gpui::Action, cx: &App) -> Option<String> {
    let keymap = cx.key_bindings();
    let keymap = keymap.borrow();
    let context = [KeyContext::new_with_defaults()];
    let mut all = keymap.bindings_for_action(action).peekable();
    let first = all.peek().map(|binding| binding.keystrokes().to_vec());
    let chosen = all
        .find(|binding| binding.predicate().is_none_or(|p| p.eval(&context)))
        .map(|binding| binding.keystrokes().to_vec())
        .or(first)?;
    (chosen.len() == 1).then(|| chosen[0].unparse())
}

/// A keystroke as a menu draws it: ⌃⌥⇧⌘ in that order, then the key, a letter in capitals.
pub fn glyphs(key: &str) -> String {
    let Ok(stroke) = Keystroke::parse(key) else {
        return key.to_owned();
    };
    let m = stroke.modifiers;
    let mut out = String::new();
    for (on, mark) in [
        (m.control, "⌃"),
        (m.alt, "⌥"),
        (m.shift, "⇧"),
        (m.platform, "⌘"),
    ] {
        if on {
            out.push_str(mark);
        }
    }
    let k = stroke.key.as_str();
    let named = match k {
        "enter" => "↩".to_owned(),
        "escape" => "⎋".to_owned(),
        "tab" => "⇥".to_owned(),
        "space" => "Space".to_owned(),
        "backspace" => "⌫".to_owned(),
        "delete" => "⌦".to_owned(),
        "up" => "↑".to_owned(),
        "down" => "↓".to_owned(),
        "left" => "←".to_owned(),
        "right" => "→".to_owned(),
        f if f.starts_with('f') && f[1..].parse::<u8>().is_ok() => f.to_uppercase(),
        other => other.to_uppercase(),
    };
    out.push_str(&named);
    out
}

/// What the table's actions act on: the row the list's keyboard is on, else the page the window shows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Selected {
    Session(String),
    Ask { ask: String, session: String },
    Nothing,
}

fn ask_session(ask: &str) -> String {
    crate::record::with_view(|view| {
        view.inbox
            .iter()
            .find(|row| row["ask"] == ask)
            .and_then(|row| row["session"].as_str().map(str::to_owned))
    })
    .flatten()
    .unwrap_or_default()
}

pub fn selected(window: &Window, cx: &App) -> Selected {
    let row = crate::views::list_focused(window);
    let from_row = row.and_then(|id| {
        if let Some(session) = id.strip_prefix("session:") {
            Some(Selected::Session(session.to_owned()))
        } else if id.starts_with("ask:") {
            Some(Selected::Ask {
                session: ask_session(&id),
                ask: id,
            })
        } else {
            None
        }
    });
    from_row.unwrap_or_else(|| match crate::open::current(cx) {
        Some(Address {
            place: Place::Session,
            id,
            ..
        }) => Selected::Session(id),
        Some(Address {
            place: Place::Ask,
            id,
            ..
        }) => {
            let ask = format!("ask:{id}");
            Selected::Ask {
                session: ask_session(&ask),
                ask,
            }
        }
        _ => Selected::Nothing,
    })
}

fn session_of(selected: &Selected) -> Option<String> {
    match selected {
        Selected::Session(session) | Selected::Ask { session, .. } if !session.is_empty() => {
            Some(session.clone())
        }
        _ => None,
    }
}

/// A write to the hub off the main thread: its refusal shows in the window as one notice naming `what`.
pub fn hub_write(method: &'static str, params: Value, what: String, cx: &mut App) {
    let call = cx.background_spawn(async move { crate::hub::call_app(method, params) });
    cx.spawn(async move |cx| {
        if let Err(error) = call.await {
            let why = crate::hub::why(&error);
            cx.update(|cx| crate::notice::show(format!("{what} didn't run: {why}"), cx));
        }
    })
    .detach();
}

/// The asks in the order Needs you draws them: open ones oldest first, then those put off till later.
pub fn needs_you_order() -> Vec<String> {
    crate::views::needs_you_order()
}

/// Runs the table's action `name` on what is selected in `window`.
pub fn run(name: &str, window: &mut Window, cx: &mut App) {
    let selected = selected(window, cx);
    match name {
        "Preferences" => crate::commands::show(true, window, cx),
        "Commands" | "Keyboard shortcuts" => crate::commands::show(false, window, cx),
        "Hide DeepBuild" => cx.hide(),
        "Quit DeepBuild" => cx.quit(),
        "Minimize" => window.minimize_window(),
        "Close Window" => window.remove_window(),
        "Write in the box" | "Write to it" => crate::words::focus(window, cx),
        "Undo answer" => crate::card::undo(window, cx),
        "Back" => crate::open::walk(true, window, cx),
        "Forward" => crate::open::walk(false, window, cx),
        "Next area" => crate::views::next_area(window, cx),
        "Next ask" => {
            let order = needs_you_order();
            let here = match crate::open::current(cx) {
                Some(Address {
                    place: Place::Ask,
                    id,
                    ..
                }) => order.iter().position(|ask| *ask == format!("ask:{id}")),
                _ => None,
            };
            let next = match here {
                Some(at) => order.get((at + 1) % order.len().max(1)),
                None => order.first(),
            };
            if let Some(ask) = next.cloned() {
                crate::open::open(&Address::ask(&ask), window, cx).ok();
            }
        }
        "Open" => {
            if let Some(session) = session_of(&selected) {
                crate::open::open(&Address::session(&session), window, cx).ok();
            }
        }
        "Pause" => {
            if let Some(session) = session_of(&selected) {
                hub_write(
                    "session.pause",
                    json!({ "session": session }),
                    "Pause".into(),
                    cx,
                );
            }
        }
        "Later" if !cfg!(feature = "plant-no-later") => {
            if let Selected::Ask { ask, .. } = &selected {
                hub_write("ask.later", json!({ "ask": ask }), "Later".into(), cx);
            }
        }
        "Copy title" => {
            if let Some(session) = session_of(&selected) {
                let title = crate::record::with_view(|view| view.table().title(&session))
                    .unwrap_or_default();
                cx.write_to_clipboard(ClipboardItem::new_string(title));
            }
        }
        "Copy link" => {
            if let Some(session) = session_of(&selected) {
                let link = format!("{}{}", crate::address::SCHEME, Address::session(&session));
                cx.write_to_clipboard(ClipboardItem::new_string(link));
            }
        }
        _ => {}
    }
    cx.refresh_windows();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn the_table_names_each_action_once_and_every_key_parses() {
        let mut names: Vec<&str> = table().iter().map(|a| a.name.as_str()).collect();
        let count = names.len();
        names.sort();
        names.dedup();
        assert_eq!(names.len(), count, "a name is the action's, once");
        for action in table() {
            if let Some(key) = &action.key {
                assert!(Keystroke::parse(key).is_ok(), "{key} parses");
                assert!(!key.contains("ctrl"), "⌃ chords are the terminal's");
            }
        }
    }

    #[std::prelude::v1::test]
    fn every_action_is_in_one_menu() {
        let listed: Vec<&str> = layout().into_iter().flat_map(|(_, items)| items).collect();
        for action in table() {
            assert!(
                listed.contains(&action.name.as_str()),
                "{} is in a menu",
                action.name
            );
        }
    }

    #[std::prelude::v1::test]
    fn a_key_draws_as_a_menu_draws_it() {
        assert_eq!(glyphs("cmd-shift-j"), "⇧⌘J");
        assert_eq!(glyphs("f6"), "F6");
        assert_eq!(glyphs("cmd-,"), "⌘,");
        assert_eq!(glyphs("ctrl-alt-enter"), "⌃⌥↩");
    }
}
