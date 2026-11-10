//! Issue #366: ⌘K, and the pages and commands plug-in views add to it.
//!
//! A view registered with `deep.registerView` brings its pages, each opened with one parameter (a page per stock),
//! and its commands, each running one of its actions. ⌘K lists them by a query. Its order depends only on the query,
//! the entries registered and a recency list, which starts empty in a replica, so the same state ranks the same way
//! every time, and every entry is first for its exact name.

use std::{path::PathBuf, rc::Rc};

use gpui_kit::base::input::{Input, InputEvent, InputState};
use gpui_kit::*;
use serde_json::{json, Value};

use crate::address::{Address, Place};
use crate::chrome;

actions!(deepbuild, [OpenCommands, Back, Forward]);

/// How tall ⌘K's list grows before it scrolls.
const LIST_HEIGHT: f32 = 320.;

/// ⌘K opens the list wherever focus is in the app. ⌘[ and ⌘] walk the addresses you opened (#1460), except while a
/// text field or a terminal has the keys, which keep them.
pub fn init(cx: &mut App) {
    const WALKS: Option<&str> = Some("Shell && !Input && !Terminal");
    cx.bind_keys([
        KeyBinding::new("cmd-k", OpenCommands, None),
        KeyBinding::new("cmd-[", Back, WALKS),
        KeyBinding::new("cmd-]", Forward, WALKS),
    ]);
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
}

impl Entry {
    /// What ⌘K shows: a command's name, or `<page>: <value>`.
    pub fn name(&self) -> &str {
        match self {
            Entry::Command { name, .. } | Entry::Page { name, .. } | Entry::Open { name, .. } => {
                name
            }
        }
    }

    /// A page's `props.page`, as its panel's `init` gets it: `{ name, params: { <param>: <value> } }`.
    pub fn page_props(&self) -> Option<Value> {
        match self {
            Entry::Page {
                page, param, value, ..
            } => Some(json!({"name": page, "params": {param: value}})),
            Entry::Command { .. } | Entry::Open { .. } => None,
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
/// they registered. Nothing else is read, so the same query on the same state gives the same order.
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
            class(entry.name()).map(|class| (class, used, at, entry))
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
        let changed = cx.subscribe(&query, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        let palette = Palette {
            entries: entries(views),
            recent,
            query,
            shown: false,
            back: None,
            open,
            _changed: changed,
        };
        palette.mount(cx);
        palette
    }

    /// What it lists from now on (#1454): the app learns its entries from the hub.
    pub fn set_entries(&mut self, entries: Vec<Entry>, cx: &mut Context<Self>) {
        self.entries = entries;
        self.mount(cx);
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

    /// What it lists: the entries it was given, then each session by its task's title.
    fn listed(&self) -> Vec<Entry> {
        let sessions = crate::views::sidebar()
            .into_iter()
            .map(|(id, task, _)| Entry::Open {
                name: if task.is_empty() { id.clone() } else { task },
                address: Address::session(&id),
            });
        self.entries.iter().cloned().chain(sessions).collect()
    }

    /// Shows it with an empty query, its input focused; `back` takes focus again once it hides.
    pub fn show(&mut self, back: FocusHandle, window: &mut Window, cx: &mut Context<Self>) {
        self.shown = true;
        self.back = Some(back);
        self.query.update(cx, |query, cx| {
            query.set_value("", window, cx);
            query.focus(window, cx);
        });
        cx.notify();
    }

    fn hide(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.shown = false;
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
            Entry::Command { .. } => {
                (self.open)(&entry, window, cx);
                return;
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
}

impl Render for Palette {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.shown {
            return div().id("commands");
        }
        let chrome = chrome::of(window);
        let query = self.query.read(cx).value().to_string();
        let listed = self.listed();
        let ranked: Vec<Entry> = rank(&query, &listed, &self.recent)
            .into_iter()
            .cloned()
            .collect();
        div()
            .id("commands")
            .absolute()
            .top(px(64.))
            .left_0()
            .right_0()
            .flex()
            .justify_center()
            .capture_key_down(cx.listener({
                let first = ranked.first().cloned();
                move |this, event: &KeyDownEvent, window, cx| {
                    if event.keystroke.key == "escape" {
                        this.hide(window, cx);
                        cx.stop_propagation();
                    } else if event.keystroke.key == "enter" {
                        // Return opens the first entry the query ranks, as a click on it does (#1460).
                        if let Some(entry) = first.clone() {
                            this.choose(entry, window, cx);
                        }
                        cx.stop_propagation();
                    }
                }
            }))
            .child(
                div()
                    .w(px(480.))
                    .flex_none()
                    .p_2()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .bg(chrome.raised)
                    .border_1()
                    .border_color(chrome.divider)
                    .rounded_md()
                    .text_color(chrome.ink_primary)
                    .child(div().flex_none().h(px(32.)).child(Input::new(&self.query)))
                    .child(
                        crate::views::observed("command-list")
                            .role(Role::ListBox)
                            .aria_label("Commands and pages")
                            .flex_none()
                            .max_h(px(LIST_HEIGHT))
                            .overflow_y_scroll()
                            .flex()
                            .flex_col()
                            .children(ranked.into_iter().enumerate().map(|(at, entry)| {
                                let name = entry.name().to_owned();
                                crate::views::observed(("command", at))
                                    .role(Role::ListBoxOption)
                                    .aria_label(name.clone())
                                    .h(px(24.))
                                    .px_2()
                                    .flex()
                                    .items_center()
                                    .rounded_sm()
                                    .hover(|style| style.bg(chrome.hover))
                                    .child(name)
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.choose(entry.clone(), window, cx)
                                    }))
                            })),
                    ),
            )
    }
}
