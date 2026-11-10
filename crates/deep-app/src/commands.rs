//! Issue #366: ⌘K, and the pages and commands plug-in views add to it.
//!
//! A view registered with `deep.registerView` brings its pages, each opened with one parameter (a page per stock),
//! and its commands, each running one of its actions. ⌘K lists them by a query. Its order depends only on the query,
//! the entries registered and a recency list, which starts empty in a replica, so the same state ranks the same way
//! every time, and every entry is first for its exact name.

use std::{path::PathBuf, rc::Rc};

use crate::chrome::{sizes, Typed as _};
use gpui_kit::base::input::{Input, InputEvent, InputState};
use gpui_kit::prelude::FluentBuilder as _;
use gpui_kit::*;
use serde_json::{json, Value};

use crate::address::{Address, Place};
use crate::chrome;

// The keys that move ⌘K's selection: up and down.
actions!(deepbuild, [SelectUp, SelectDown]);

/// ⌘K's own keys while its query has them (#1462); its keys from the action table bind in [`crate::actions`].
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("up", SelectUp, Some("Commands > Input")),
        KeyBinding::new("down", SelectDown, Some("Commands > Input")),
    ]);
}

thread_local! {
    /// The window's ⌘K, which a key or a menu item shows wherever focus is.
    static PALETTE: std::cell::RefCell<Option<WeakEntity<Palette>>> = const { std::cell::RefCell::new(None) };
}

/// Shows ⌘K over the window: on the preference words for ⌘, (#330), else on everything, its first hit selected.
pub fn show(preferences: bool, window: &mut Window, cx: &mut App) {
    let Some(palette) = PALETTE.with(|p| p.borrow().as_ref().and_then(WeakEntity::upgrade)) else {
        return;
    };
    let back = window.focused(cx);
    crate::card::let_go();
    palette.update(cx, |palette, cx| {
        palette.preferences = preferences;
        palette.show(back, window, cx)
    });
}

/// A view as `deep.registerView` gives it: its panel's folder, its pages and its ⌘K commands.
#[derive(Clone, Debug, PartialEq)]
pub struct View {
    pub name: String,
    pub panel: PathBuf,
    pub pages: Vec<Page>,
    pub commands: Vec<Command>,
}

/// A page that takes one parameter, with the values ⌘K offers for it.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    pub name: String,
    pub param: String,
    pub values: Vec<String>,
}

/// A command that runs one of the view's actions.
#[derive(Clone, Debug, PartialEq)]
pub struct Command {
    pub name: String,
    pub action: String,
}

impl View {
    /// The view `{ name, pages, commands }` of the panel in `panel`.
    pub fn from_json(panel: PathBuf, view: &Value) -> Result<View, String> {
        let text = |v: &Value, what: &str| {
            v.as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| format!("a view's {what} is a string, not {v}"))
        };
        let list = |key: &str| view[key].as_array().cloned().unwrap_or_default();
        Ok(View {
            name: text(&view["name"], "name")?,
            panel,
            pages: list("pages")
                .iter()
                .map(|p| {
                    Ok(Page {
                        name: text(&p["name"], "page name")?,
                        param: text(&p["param"], "page param")?,
                        values: p["values"]
                            .as_array()
                            .map(|vs| {
                                vs.iter()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                })
                .collect::<Result<_, String>>()?,
            commands: list("commands")
                .iter()
                .map(|c| {
                    Ok(Command {
                        name: text(&c["name"], "command name")?,
                        action: text(&c["action"], "command action")?,
                    })
                })
                .collect::<Result<_, String>>()?,
        })
    }
}

/// One thing ⌘K lists: a view's command, or one of its pages at one value of its parameter.
#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    Command {
        name: String,
        action: String,
    },
    /// A page the app ships or a session, by its address (#1454, #1460).
    Open {
        name: String,
        address: Address,
    },
    Page {
        name: String,
        panel: PathBuf,
        page: String,
        param: String,
        value: String,
    },
    /// A preference ⌘K answers by opening the box with its change drafted (#1998), found by its words too.
    Preference {
        name: String,
        words: &'static [&'static str],
    },
    /// An action of the table, shown with its key (#1462).
    Action {
        name: String,
    },
}

impl Entry {
    /// What ⌘K shows: a command's name, or `<page>: <value>`.
    pub fn name(&self) -> &str {
        match self {
            Entry::Command { name, .. }
            | Entry::Page { name, .. }
            | Entry::Open { name, .. }
            | Entry::Preference { name, .. }
            | Entry::Action { name } => name,
        }
    }

    /// A page's `props.page`, as its panel's `init` gets it: `{ name, params: { <param>: <value> } }`.
    pub fn page_props(&self) -> Option<Value> {
        match self {
            Entry::Page {
                page, param, value, ..
            } => Some(json!({"name": page, "params": {param: value}})),
            Entry::Command { .. }
            | Entry::Open { .. }
            | Entry::Preference { .. }
            | Entry::Action { .. } => None,
        }
    }
}

/// Every entry the views add, in the order they registered: each view's commands, then its pages by value.
pub fn entries(views: &[View]) -> Vec<Entry> {
    let mut out = Vec::new();
    for view in views {
        out.extend(view.commands.iter().map(|c| Entry::Command {
            name: c.name.clone(),
            action: c.action.clone(),
        }));
        for page in &view.pages {
            out.extend(page.values.iter().map(|value| Entry::Page {
                name: format!("{}: {value}", page.name),
                panel: view.panel.clone(),
                page: page.name.clone(),
                param: page.param.clone(),
                value: value.clone(),
            }));
        }
    }
    out
}

/// The entries matching `query`, in ⌘K's order: the exact name, then names that start with it, then names with a
/// word that does, then names that hold it, case aside; within each, the most recently used first, then in the order
/// they registered. A preference whose words hold one starting with the query ranks with the word matches (#1998), so
/// "mute" finds Sounds. Nothing else is read, so the same query on the same state gives the same order.
pub fn rank<'a>(query: &str, entries: &'a [Entry], recent: &[String]) -> Vec<&'a Entry> {
    let query = query.trim().to_lowercase();
    let class = |name: &str| -> Option<u8> {
        let name = name.to_lowercase();
        if query.is_empty() || name == query {
            Some(0)
        } else if name.starts_with(&query) {
            Some(1)
        } else if name
            .split(|c: char| !c.is_alphanumeric())
            .any(|word| word.starts_with(&query))
        {
            Some(2)
        } else {
            name.contains(&query).then_some(3)
        }
    };
    let mut ranked: Vec<(u8, usize, usize, &Entry)> = entries
        .iter()
        .enumerate()
        .filter_map(|(at, entry)| {
            let used = recent
                .iter()
                .position(|r| r == entry.name())
                .unwrap_or(usize::MAX);
            let by_words = || match entry {
                Entry::Preference { words, .. } if !query.is_empty() => words
                    .iter()
                    .any(|word| word.starts_with(query.as_str()))
                    .then_some(2),
                _ => None,
            };
            class(entry.name())
                .or_else(by_words)
                .map(|class| (class, used, at, entry))
        })
        .collect();
    ranked.sort_by_key(|&(class, used, at, _)| (class, used, at));
    ranked.into_iter().map(|(.., entry)| entry).collect()
}

/// Where the app keeps the names you opened from ⌘K, newest first: `{ "recent": [...] }` under the hub's root.
pub fn recency_file() -> PathBuf {
    crate::hub::root().join("app").join("recency.json")
}

/// The names a recency file holds, newest first; none when it can't be read.
pub fn read_recency(path: &std::path::Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v["recent"].as_array().cloned())
        .map(|names| {
            names
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// What choosing an entry does: the app runs a command's action, and mounts a page's view, which `open` shows.
pub type Open = Rc<dyn Fn(&Entry, &mut Window, &mut App) -> Option<AnyView>>;

/// ⌘K: a query and the entries it ranks, over the shell.
pub struct Palette {
    entries: Vec<Entry>,
    recent: Vec<String>,
    query: Entity<InputState>,
    shown: bool,
    /// Shown by ⌘,: the preference entries alone while the query is empty (#1462).
    preferences: bool,
    /// The selected hit, by its place among those ranked: the first, until the arrows move it.
    selected: usize,
    /// Where focus goes back to once it hides: what had it before ⌘K.
    back: Option<FocusHandle>,
    open: Open,
    _changed: Subscription,
}

impl Palette {
    pub fn new(
        views: &[View],
        recent: Vec<String>,
        open: Open,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let query =
            cx.new(|cx| InputState::new(window, cx).placeholder("Search commands and pages"));
        let changed = cx.subscribe(&query, |this: &mut Self, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                this.selected = 0;
                cx.notify();
            }
        });
        PALETTE.with(|p| *p.borrow_mut() = Some(cx.entity().downgrade()));
        let palette = Palette {
            entries: entries(views),
            recent,
            query,
            shown: false,
            preferences: false,
            selected: 0,
            back: None,
            open,
            _changed: changed,
        };
        palette.mount(cx);
        palette
    }

    /// What it lists from now on (#1454): the app learns its entries from the hub. Its pages are View's (#1462).
    pub fn set_entries(&mut self, entries: Vec<Entry>, cx: &mut Context<Self>) {
        self.entries = entries;
        self.mount(cx);
        let pages = self
            .entries
            .iter()
            .filter_map(|entry| match entry {
                Entry::Open { name, address } if address.place == Place::Page => {
                    Some((name.clone(), address.to_string()))
                }
                Entry::Page {
                    name, page, value, ..
                } => Some((
                    name.clone(),
                    Address {
                        place: Place::Page,
                        id: page.clone(),
                        parameter: Some(value.clone()),
                    }
                    .to_string(),
                )),
                _ => None,
            })
            .collect();
        crate::actions::set_pages(pages, cx);
        cx.notify();
    }

    /// Its pages are how `open` mounts `page/<name>/<value>` (#1460).
    fn mount(&self, cx: &mut App) {
        let (entries, open) = (self.entries.clone(), self.open.clone());
        crate::open::set_mount(
            Rc::new(move |name, value, window, cx| {
                let entry = entries.iter().find(|entry| {
                    matches!(entry, Entry::Page { page, value: v, .. }
                        if page == name && Some(v.as_str()) == value)
                })?;
                open(entry, window, cx)
            }),
            cx,
        );
    }

    /// What it lists: the entries it was given, the table's actions, each session by its task's title and each open
    /// ask by its question, in the order Needs you draws them (#1462).
    fn listed(&self) -> Vec<Entry> {
        let actions = crate::actions::table().iter().map(|action| Entry::Action {
            name: action.name.clone(),
        });
        let sessions = crate::views::sidebar()
            .into_iter()
            .map(|(id, task, _)| Entry::Open {
                name: if task.is_empty() { id.clone() } else { task },
                address: Address::session(&id),
            });
        let asks = crate::views::open_asks()
            .into_iter()
            .map(|(handle, question)| Entry::Open {
                name: question,
                address: Address::ask(&handle),
            });
        self.entries
            .iter()
            .cloned()
            .chain(actions)
            .chain(sessions)
            .chain(asks)
            .collect()
    }

    /// The hits for the query now, in ⌘K's order.
    fn ranked(&self, cx: &App) -> Vec<Entry> {
        let query = self.query.read(cx).value().to_string();
        let listed = self.listed();
        if self.preferences && query.trim().is_empty() {
            return listed
                .into_iter()
                .filter(|entry| matches!(entry, Entry::Preference { .. }))
                .collect();
        }
        rank(&query, &listed, &self.recent)
            .into_iter()
            .cloned()
            .collect()
    }

    /// Shows it with an empty query, its input focused; `back` takes focus again once it hides.
    pub fn show(&mut self, back: Option<FocusHandle>, window: &mut Window, cx: &mut Context<Self>) {
        self.shown = true;
        self.back = back;
        self.selected = 0;
        self.query.update(cx, |query, cx| {
            query.set_value("", window, cx);
            query.focus(window, cx);
        });
        cx.notify();
    }

    fn hide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.shown = false;
        self.preferences = false;
        if let Some(back) = self.back.take() {
            window.focus(&back, cx);
        }
        cx.notify();
    }

    fn choose(&mut self, entry: Entry, window: &mut Window, cx: &mut Context<Self>) {
        self.recent.retain(|name| name != entry.name());
        self.recent.insert(0, entry.name().to_owned());
        self.hide(window, cx);
        let address = match &entry {
            // A command runs, and a preference opens the box with its change drafted: neither is a page.
            Entry::Command { .. } | Entry::Preference { .. } => {
                (self.open)(&entry, window, cx);
                return;
            }
            Entry::Action { name } => {
                let name = name.clone();
                cx.defer_in(window, move |_, window, cx| {
                    crate::actions::run(&name, window, cx)
                });
                return;
            }
            // What needs you is its first ask, with its card (#1462); Needs you itself when nothing does.
            Entry::Open { address, .. } if *address == Address::page("needs-you") => {
                crate::views::open_asks()
                    .first()
                    .map_or_else(|| address.clone(), |(handle, _)| Address::ask(handle))
            }
            Entry::Open { address, .. } => address.clone(),
            Entry::Page { page, value, .. } => Address {
                place: Place::Page,
                id: page.clone(),
                parameter: Some(value.clone()),
            },
        };
        crate::open::open(&address, window, cx).ok();
    }

    fn select(&mut self, by: isize, cx: &mut Context<Self>) {
        let count = self.ranked(cx).len();
        if count > 0 {
            self.selected = (self.selected as isize + by).clamp(0, count as isize - 1) as usize;
        }
        cx.notify();
    }
}

/// The key ⌘K shows beside an entry: an action's from the keymap, as a menu draws it (#1462).
fn shown_key(entry: &Entry) -> Option<String> {
    let Entry::Action { name } = entry else {
        return None;
    };
    // #1462's planted ⌘K writes the table's key as a hint, whatever the keymap says.
    let key = if cfg!(feature = "plant-written-key-hint") {
        crate::actions::table()
            .iter()
            .find(|a| a.name == *name)
            .and_then(|a| a.key.clone())
    } else {
        crate::actions::key(name)
    };
    key.map(|key| crate::actions::glyphs(&key))
}

impl Render for Palette {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.shown {
            return div().id("commands");
        }
        let chrome = chrome::of(window);
        let query = self.query.read(cx).value().to_string();
        let ranked = self.ranked(cx);
        let selected = self.selected.min(ranked.len().saturating_sub(1));
        let none = ranked.is_empty() && !query.trim().is_empty();
        div()
            .id("commands")
            .key_context("Commands")
            .absolute()
            .top(relative(0.1))
            .left_0()
            .right_0()
            .flex()
            .justify_center()
            .on_action(cx.listener(|this, _: &SelectUp, _, cx| this.select(-1, cx)))
            .on_action(cx.listener(|this, _: &SelectDown, _, cx| this.select(1, cx)))
            .capture_key_down(cx.listener({
                let chosen = ranked.get(selected).cloned();
                move |this, event: &KeyDownEvent, window, cx| {
                    if event.keystroke.key == "escape" {
                        this.hide(window, cx);
                        cx.stop_propagation();
                    } else if event.keystroke.key == "enter" {
                        // Return opens the selected entry, as a click on it does (#1460, #1462); the planted list takes
                        // a click alone.
                        if let Some(entry) = chosen
                            .clone()
                            .filter(|_| !cfg!(feature = "plant-commands-click-only"))
                        {
                            this.choose(entry, window, cx);
                        }
                        cx.stop_propagation();
                    }
                }
            }))
            .child(
                div()
                    .w(relative(0.5))
                    .flex_none()
                    .typed(sizes().body)
                    .p(sizes().space(1))
                    .flex()
                    .flex_col()
                    .gap(sizes().space(0))
                    .bg(chrome.raised)
                    .border(sizes().hairline)
                    .border_color(chrome.divider)
                    .rounded(sizes().radius)
                    .text_color(chrome.ink_primary)
                    .child(
                        div()
                            .flex_none()
                            .h(sizes().title.line + sizes().space(2))
                            .child(Input::new(&self.query)),
                    )
                    .children(none.then(|| {
                        crate::views::observed("command-none")
                            .role(Role::Label)
                            .aria_label("No match")
                            .px(sizes().space(1))
                            .text_color(chrome.ink_secondary)
                            .child("No match")
                    }))
                    .child(
                        crate::views::observed("command-list")
                            .role(Role::ListBox)
                            .aria_label("Commands and pages")
                            .flex_none()
                            // Half the window it opens at, before it scrolls.
                            .max_h(sizes().window.1 / 2.)
                            .overflow_y_scroll()
                            .flex()
                            .flex_col()
                            .children(ranked.into_iter().enumerate().map(|(at, entry)| {
                                let name = entry.name().to_owned();
                                let key = shown_key(&entry);
                                crate::views::observed(("command", at))
                                    .role(Role::ListBoxOption)
                                    .aria_label(name.clone())
                                    .when_some(key.clone(), |hit, key| hit.aria_value(key))
                                    .aria_selected(at == selected)
                                    .h(sizes().space(4))
                                    .px(sizes().space(1))
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .rounded(sizes().radius)
                                    .when(at == selected, |hit| hit.bg(chrome.selected))
                                    .hover(|style| style.bg(chrome.hover))
                                    .child(name)
                                    .children(key.map(|key| {
                                        div().text_color(chrome.ink_secondary).child(key)
                                    }))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.choose(entry.clone(), window, cx)
                                    }))
                            })),
                    ),
            )
    }
}
