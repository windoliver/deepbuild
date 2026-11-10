//! Issue #1460: the one `open`. A row's click, ⌘K, a notification, a `deepbuild://` link, `deep open`, a pop-out and the
//! replica's `open` all come here with an [`Address`], and this is the only place that selects a page in the dock,
//! presents an ask's card or moves the history. It opens and nothing else: it never answers, arms, confirms or
//! changes the record. What is open lives in one [`Selection`], a global, never a thread local.

use std::rc::Rc;

use gpui_kit::base::dock::{DockArea, DockPlacement};
use gpui_kit::*;

use crate::address::{Address, Place};
use crate::views::{self, Kind, Shipped, Slot};
use crate::{record, states};

/// How many opened addresses back and forward walk.
pub const HISTORY: usize = 50;

/// Mounts an installed view's page by its registered name, at a value of its parameter: the app's and the replica's.
pub type Mount = Rc<dyn Fn(&str, Option<&str>, &mut Window, &mut App) -> Option<AnyView>>;

/// What is open: the address shown, the ones opened before and after it, the page popped out and where pages go.
#[derive(Default)]
pub struct Selection {
    dock: Option<WeakEntity<DockArea>>,
    window: Option<AnyWindowHandle>,
    opened: Vec<Address>,
    at: usize,
    popped: Option<(Address, Kind, AnyWindowHandle)>,
    slot: Option<WeakEntity<Slot>>,
    pending: Option<AnyView>,
    mount: Option<Mount>,
    shown: Shown,
}

impl Global for Selection {}

fn selection(cx: &mut App) -> &mut Selection {
    cx.default_global::<Selection>()
}

/// The address the window shows, once one was opened.
pub fn current(cx: &App) -> Option<Address> {
    cx.try_global::<Selection>()?.shown.address.clone()
}

/// The session the page and the line draw, when a session's address is open.
pub fn opened_session(cx: &App) -> Option<String> {
    current(cx)
        .filter(|address| address.place == Place::Session)
        .map(|address| address.id)
}

/// The shipped page popped out into a window of its own.
pub fn popped(cx: &App) -> Option<Kind> {
    cx.try_global::<Selection>()?
        .popped
        .as_ref()
        .map(|(_, kind, _)| *kind)
}

/// The shell's dock and window, which pages open in.
pub fn set_shell(dock: &Entity<DockArea>, window: AnyWindowHandle, cx: &mut App) {
    let selection = selection(cx);
    selection.dock = Some(dock.downgrade());
    selection.window = Some(window);
}

/// How an installed view's page mounts.
pub fn set_mount(mount: Mount, cx: &mut App) {
    selection(cx).mount = Some(mount);
}

/// Hands the next layout that names the extension slot its view.
pub fn place_extension(view: AnyView, cx: &mut App) {
    selection(cx).pending = Some(view);
}

/// The view the extension slot the layout makes now holds, and that slot as the one pages fill.
pub(crate) fn take_pending(cx: &mut App) -> Option<AnyView> {
    selection(cx).pending.take()
}

/// Whether `slot` is the one pages fill.
pub(crate) fn is_page_slot(slot: &Entity<Slot>, cx: &App) -> bool {
    cx.try_global::<Selection>()
        .and_then(|selection| selection.slot.as_ref())
        .is_some_and(|page| page.entity_id() == slot.entity_id())
}

pub(crate) fn set_slot(slot: &Entity<Slot>, cx: &mut App) {
    selection(cx).slot = Some(slot.downgrade());
}

/// Puts `view` in the extension slot the shell drew last, in place of what it held. False when no slot is drawn.
pub fn fill_slot(view: AnyView, cx: &mut App) -> bool {
    let Some(slot) = selection(cx).slot.clone().and_then(|slot| slot.upgrade()) else {
        return false;
    };
    slot.update(cx, |slot, cx| slot.set(view, cx));
    true
}

/// Puts an installed view in the center as a tab of its own, which the slot's later pages replace.
pub fn add_tab(view: AnyView, window: &mut Window, cx: &mut App) {
    let Some(dock) = dock(cx) else {
        return;
    };
    let slot = Slot::new(Some(view), true, cx);
    set_slot(&slot, cx);
    dock.update(cx, |dock, cx| {
        dock.add_panel(slot, DockPlacement::Center, None, window, cx)
    });
}

fn dock(cx: &mut App) -> Option<Entity<DockArea>> {
    selection(cx).dock.clone().and_then(|dock| dock.upgrade())
}

/// Where a page draws: a shipped page's panel, or the extension slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Region {
    Shipped(Kind),
    Slot,
}

/// The page region as it stands: where it draws, the address it shows, and what became of an address that showed
/// nothing of its own.
#[derive(Clone, Debug, Default)]
struct Shown {
    region: Option<Region>,
    address: Option<Address>,
    notice: Option<String>,
}

/// What the page `region` draws besides its own page, while it is the page region.
pub struct Page {
    /// The address it shows: its node's `id`, never drawn or spoken.
    pub address: Option<String>,
    /// What became of the address last asked for, when it showed nothing of its own.
    pub notice: Option<String>,
    /// The claim a session's page is at.
    pub claim: Option<String>,
}

/// What `region` draws as the page region; none while another region is.
pub fn page_of(region: Region, cx: &App) -> Option<Page> {
    let shown = &cx.try_global::<Selection>()?.shown;
    (shown.region == Some(region)).then(|| Page {
        address: shown.address.as_ref().map(Address::to_string),
        notice: shown.notice.clone(),
        claim: shown
            .address
            .as_ref()
            .filter(|address| address.place == Place::Session)
            .and_then(|address| address.parameter.clone()),
    })
}

/// What an address opens on today's shell.
enum Target {
    /// A shipped page, by its kind.
    Shipped(Kind),
    /// An open ask: Needs you, with its card.
    Ask(String),
    /// An installed view's page.
    Page(AnyView),
    /// An ask that closed: Needs you, saying what closed it.
    Closed(String),
    /// Nothing the address names: what the window says instead.
    Gone(String),
}

fn no_match(text: &str) -> String {
    format!("No match for \"{text}\"")
}

/// The center pages an address can name: every shipped page but the two that frame them.
fn shipped(name: &str) -> Option<Kind> {
    Kind::ALL.into_iter().find(|kind| {
        !matches!(kind, Kind::Sidebar | Kind::Line | Kind::Session)
            && kind.name().strip_prefix("deepbuild/") == Some(name)
    })
}

/// The session `id` names: that ID, or the one session whose ID starts with it, as a receipt shortens it (#1460).
fn session_of(id: &str) -> Option<String> {
    record::with_view(|view| {
        let sessions = view.table().sessions().to_vec();
        if sessions.iter().any(|s| s == id) {
            return Some(id.to_owned());
        }
        let mut starting = sessions
            .into_iter()
            .filter(|s| id.len() >= 8 && s.starts_with(id));
        match (starting.next(), starting.next()) {
            (Some(one), None) => Some(one),
            _ => None,
        }
    })
    .flatten()
}

/// Whether the record removed the session: its `session.archived`.
fn archived(id: &str) -> bool {
    let subject = format!("session:{id}");
    record::history()
        .iter()
        .any(|event| event["kind"] == "session.archived" && event["subject"] == subject.as_str())
}

/// What closed the ask, in words: the question, how it closed and to what, when and through what.
fn closed(events: &[serde_json::Value], handle: &str) -> Option<String> {
    let ask = events
        .iter()
        .find(|event| event["kind"] == "ask.created" && states::handle(event) == handle)?;
    let question = ask["data"]["question"].as_str().unwrap_or_default();
    let end = events.iter().find(|event| states::closes(event, handle))?;
    let kind = end["kind"].as_str().unwrap_or_default();
    let how = match kind {
        "decision.applied" => "decided",
        other => other.strip_prefix("ask.").unwrap_or(other),
    };
    let answer = end["data"]["answer"].as_str().map(|id| {
        let options = ask["data"]["options"].as_array();
        let label = options
            .and_then(|options| options.iter().find(|option| option["id"] == id))
            .and_then(|option| option["label"].as_str())
            .unwrap_or(id);
        format!(" \"{label}\"")
    });
    let at = end["ts"]
        .as_u64()
        .and_then(|ms| {
            use chrono::TimeZone as _;
            chrono::Local.timestamp_millis_opt(ms as i64).single()
        })
        .map(|at| format!(" at {}", at.format("%H:%M")))
        .unwrap_or_default();
    let through = match end["data"]["via"].as_str() {
        Some("card") => " in the app".to_owned(),
        Some("inbox") => " from deep inbox".to_owned(),
        Some(via) => format!(" through {via}"),
        None => String::new(),
    };
    Some(format!(
        "{question} {how_capital}{answer}{at}{through}. Nothing is left to answer.",
        how_capital = capital(how),
        answer = answer.unwrap_or_default(),
    ))
}

fn capital(word: &str) -> String {
    let mut chars = word.chars();
    chars
        .next()
        .map(|first| first.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// What `address` opens, and the address in full: a session's shortened ID is its whole ID.
fn resolve(address: &Address, window: &mut Window, cx: &mut App) -> (Target, Address) {
    let text = address.to_string();
    let mut full = address.clone();
    let target = match address.place {
        Place::Session => match session_of(&address.id) {
            Some(id) if archived(&id) => Target::Gone(format!("{text} was archived")),
            Some(id) => {
                full.id = id;
                Target::Shipped(Kind::Session)
            }
            None => Target::Gone(no_match(&text)),
        },
        Place::Ask => {
            let handle = format!("ask:{}", address.id);
            let events = record::history();
            let asked = events
                .iter()
                .any(|event| event["kind"] == "ask.created" && states::handle(event) == handle);
            if !asked {
                Target::Gone(no_match(&text))
            } else if states::is_open(&events, &handle) {
                Target::Ask(handle)
            } else {
                closed(&events, &handle)
                    .map_or_else(|| Target::Gone(no_match(&text)), Target::Closed)
            }
        }
        Place::Page => match shipped(&address.id) {
            Some(kind) if address.parameter.is_none() => Target::Shipped(kind),
            _ => {
                let mount = selection(cx).mount.clone();
                mount
                    .and_then(|mount| mount(&address.id, address.parameter.as_deref(), window, cx))
                    .map_or_else(|| Target::Gone(no_match(&text)), Target::Page)
            }
        },
        Place::Project => Target::Gone(format!("No page for \"{text}\" yet")),
    };
    (target, full)
}

/// Selects the shipped page `kind` in the center, adding it when the center lacks it.
fn select(kind: Kind, window: &mut Window, cx: &mut App) {
    let Some(dock) = dock(cx) else {
        return;
    };
    let found = panel_named(&dock, kind.name(), cx);
    match found {
        Some(panel) => dock.update(cx, |dock, cx| dock.select_panel(panel, window, cx)),
        None => {
            let panel = cx.new(|cx| Shipped::new(kind, cx));
            dock.update(cx, |dock, cx| {
                dock.add_panel(panel, DockPlacement::Center, None, window, cx)
            });
        }
    }
}

fn panel_named(
    dock: &Entity<DockArea>,
    name: &str,
    cx: &App,
) -> Option<gpui_kit::base::dock::PanelId> {
    dock.read(cx)
        .layout(DockPlacement::Center)
        .into_iter()
        .flat_map(|tree| tree.panels().collect::<Vec<_>>())
        .find(|id| {
            let panel = dock.read(cx).panel(*id);
            panel.is_some_and(|panel| panel.panel_name(cx) == name)
        })
}

/// An installed view's page in the page region.
fn page(view: AnyView, window: &mut Window, cx: &mut App) {
    if !fill_slot(view.clone(), cx) {
        add_tab(view, window, cx);
    }
    let Some(dock) = dock(cx) else {
        return;
    };
    if let Some(panel) = panel_named(&dock, views::EXTENSION, cx) {
        dock.update(cx, |dock, cx| dock.select_panel(panel, window, cx));
    }
}

/// What the window says of an address that shows nothing of its own, on the page it shows, or on Needs you when it
/// shows none yet. The history stays as it was.
fn say(words: String, window: &mut Window, cx: &mut App) -> Result<Address, String> {
    if selection(cx).shown.region.is_none() {
        select(Kind::NeedsYou, window, cx);
        selection(cx).shown.region = Some(Region::Shipped(Kind::NeedsYou));
    }
    selection(cx).shown.notice = Some(words.clone());
    window.refresh();
    cx.refresh_windows();
    Err(words)
}

/// Shows `address` without touching the history: the address in full, or what the window says instead.
fn show(address: &Address, window: &mut Window, cx: &mut App) -> Result<Address, String> {
    if let Some((popped, _, handle)) = &selection(cx).popped {
        if popped == address {
            let handle = *handle;
            let _ = handle.update(cx, |_, window, _| window.activate_window());
            return Ok(address.clone());
        }
    }
    let (target, full) = resolve(address, window, cx);
    let (region, notice) = match target {
        Target::Shipped(kind) => {
            select(kind, window, cx);
            (Region::Shipped(kind), None)
        }
        Target::Ask(handle) => {
            select(Kind::NeedsYou, window, cx);
            crate::card::present_ask(&handle, window, cx);
            #[cfg(feature = "plant-open-writes-event")]
            plant_write(cx);
            (Region::Shipped(Kind::NeedsYou), None)
        }
        Target::Page(view) => {
            page(view, window, cx);
            (Region::Slot, None)
        }
        Target::Closed(words) => {
            select(Kind::NeedsYou, window, cx);
            (Region::Shipped(Kind::NeedsYou), Some(words))
        }
        Target::Gone(words) => return say(words, window, cx),
    };
    selection(cx).shown = Shown {
        region: Some(region),
        address: Some(full.clone()),
        notice,
    };
    window.refresh();
    cx.refresh_windows();
    Ok(full)
}

/// Makes `address` the last address you opened, with nothing forward of it.
fn push(address: Address, cx: &mut App) {
    let selection = selection(cx);
    if selection.opened.get(selection.at) == Some(&address) {
        return;
    }
    if !selection.opened.is_empty() {
        selection.opened.truncate(selection.at + 1);
    }
    selection.opened.push(address);
    if selection.opened.len() > HISTORY {
        selection.opened.remove(0);
    }
    selection.at = selection.opened.len() - 1;
}

/// Opens `address`: shows its page, and it becomes the last address you opened. What the window shows: the address in
/// full, or what became of the one asked for.
pub fn open(address: &Address, window: &mut Window, cx: &mut App) -> Result<String, String> {
    let full = show(address, window, cx)?;
    push(full.clone(), cx);
    Ok(full.to_string())
}

/// Text from outside the window (a notification, a link, `deep open`, the replica): opened in the shell's window, or
/// refused whole when it is no address.
pub fn arrive(text: &str, cx: &mut App) -> Result<String, String> {
    let Some(window) = selection(cx).window else {
        return Err("No window is open".to_owned());
    };
    let text = text.trim().to_owned();
    window
        .update(cx, |_, window, cx| {
            window.activate_window();
            match text.parse::<Address>() {
                Ok(address) => open(&address, window, cx),
                Err(()) => say(no_match(&text), window, cx).map(|address| address.to_string()),
            }
        })
        .unwrap_or_else(|_| Err("No window is open".to_owned()))
}

/// A `deepbuild://` link, as the OS hands it to the app.
pub fn link(url: &str, cx: &mut App) -> Result<String, String> {
    if !url.starts_with(crate::address::SCHEME) {
        return Err(no_match(url));
    }
    arrive(url, cx)
}

/// A click on a notification's body: its tag is its session's ID, so it opens that session's page.
pub fn notification(tag: &str, cx: &mut App) -> Result<String, String> {
    arrive(&Address::session(tag).to_string(), cx)
}

/// The planted row click (#1460): its session's page shown by setting the selection, without `open`.
#[cfg(feature = "plant-row-skips-open")]
pub fn skip_open(session: &str, window: &mut Window, cx: &mut App) {
    select(Kind::Session, window, cx);
    let address = Address::session(session);
    let selection = selection(cx);
    match selection.opened.get_mut(selection.at) {
        Some(here) => *here = address.clone(),
        None => selection.opened.push(address.clone()),
    }
    selection.shown = Shown {
        region: Some(Region::Shipped(Kind::Session)),
        address: Some(address),
        notice: None,
    };
    window.refresh();
}

/// The planted `open` (#1460): through the app's hub connection it pastes one small PNG, which the hub keeps.
#[cfg(feature = "plant-open-writes-event")]
fn plant_write(cx: &mut App) {
    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    cx.background_spawn(async {
        let pasted = crate::hub::HubClient::app().and_then(|mut hub| {
            hub.call(
                "evidence.paste",
                serde_json::json!({ "bytes": PNG, "type": "png" }),
            )
        });
        if let Err(error) = pasted {
            eprintln!("deep-app: the planted paste didn't reach the hub: {error:?}");
        }
    })
    .detach();
}

/// Whether `address` still opens: a session the record removed leaves the history.
fn resolves(address: &Address) -> bool {
    match address.place {
        Place::Session => session_of(&address.id).is_some_and(|id| !archived(&id)),
        _ => true,
    }
}

/// ⌘[ and ⌘]: the address opened before or after this one, among those that still resolve; the rest leave.
pub fn walk(back: bool, window: &mut Window, cx: &mut App) {
    let selection = selection(cx);
    let (mut kept, mut before, mut here) = (Vec::new(), 0, false);
    for (index, address) in selection.opened.iter().enumerate() {
        if !resolves(address) {
            continue;
        }
        before += usize::from(index < selection.at);
        here |= index == selection.at;
        kept.push(address.clone());
    }
    let to = if back {
        before.checked_sub(1)
    } else {
        Some(before + usize::from(here)).filter(|to| *to < kept.len())
    };
    selection.opened = kept;
    selection.at = if here {
        before
    } else {
        before.saturating_sub(1)
    };
    let Some(to) = to else {
        return;
    };
    selection.at = to;
    let address = selection.opened[to].clone();
    let _ = show(&address, window, cx);
}

/// Pops the shipped page at `address` out into a window of its own: its panel in the shell gives up its place, and
/// takes it back when that window closes. Opening the address again focuses that window.
pub fn pop_out(address: Address, kind: Kind, cx: &mut App) {
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::centered(size(px(640.), px(640.)), cx)),
        ..Default::default()
    };
    let opened = gpui_kit::open_window(options, cx, move |window, cx| {
        window.on_window_should_close(cx, |_, cx| {
            selection(cx).popped = None;
            cx.refresh_windows();
            true
        });
        cx.new(|cx| Shipped::popped(kind, cx))
    });
    if let Ok((handle, _)) = opened {
        selection(cx).popped = Some((address, kind, handle));
    }
    cx.refresh_windows();
}
