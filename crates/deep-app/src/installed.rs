//! Issue #1454: the views you installed, in the real window. The hub lists every loaded package's views with what
//! `panel@1` said of them. A view that passed mounts in its area, from a copy of its folder, since gpui-shell writes
//! files beside a script it runs and the installed bytes are the ones their digest names. Its pages and commands, and
//! the shipped pages, go to ⌘K.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use gpui_kit::*;
use gpui_shell::ShellRuntime;
use serde_json::{json, Value};

use crate::address::Address;
use crate::commands::{entries, Entry, Open, Palette, View};
use crate::views;

/// The pages ⌘K always lists, which View lists too (#1462): Home, Needs you, Agents and Rules, then each view you
/// installed in the `sidebar` area as a page by its name (#1461); and the preferences it opens the box for (#1998).
pub fn shipped_pages() -> Vec<Entry> {
    let shipped = [
        ("Home", "home"),
        ("Needs you", "needs-you"),
        ("Agents", "agents"),
        ("Rules", "rules"),
    ]
    .map(|(name, page)| (name.to_owned(), Address::page(page)));
    let installed = views::page_names().into_iter().filter_map(|name| {
        Some((
            name.clone(),
            format!("page/{name}").parse::<Address>().ok()?,
        ))
    });
    shipped
        .into_iter()
        .chain(installed)
        .map(|(name, address)| Entry::Open { name, address })
        .chain(crate::words::preference_entries())
        .collect()
}

/// A view's command run from ⌘K, off the main thread: it ends in one notice in the window saying it ran or why it
/// didn't (#1462). The planted opener only logs, as the merge base did.
pub fn run_command(name: &str, action: &str, cx: &mut App) {
    let (name, action) = (name.to_owned(), action.to_owned());
    let ran = cx.background_spawn(async move {
        crate::hub::call_app("command.run", json!({ "action": action }))
    });
    cx.spawn(async move |cx| {
        let said = match ran.await {
            Ok(_) => format!("{name} ran."),
            Err(error) => format!("{name} didn't run: {}", crate::hub::why(&error)),
        };
        if cfg!(feature = "plant-opener-only-logs") {
            eprintln!("deep-app: {said}");
            return;
        }
        cx.update(|cx| crate::notice::show(said, cx));
    })
    .detach();
}

/// An installed view that didn't load ends as a page that won't open does: one notice in the window naming it (#1462).
/// The planted app writes it to the error stream only, as the merge base did.
pub fn failed(name: &str, why: &str, cx: &mut App) {
    eprintln!("deep-app: {name} didn't load: {why}");
    if !cfg!(feature = "plant-failed-view-silent") {
        crate::notice::show(format!("{name} didn't load: {why}"), cx);
    }
}

/// What opening a ⌘K entry does in the app: a command runs off the main thread, a page mounts in the page region.
pub fn opener(runtime: Rc<ShellRuntime>) -> Open {
    Rc::new(move |entry, window, cx| match entry {
        Entry::Command { name, action } => {
            run_command(name, action, cx);
            None
        }
        // ⌘K runs an action of the table and opens an address itself.
        Entry::Open { .. } | Entry::Action { .. } => None,
        Entry::Preference { name, .. } => {
            crate::words::open_preference(name, window, cx);
            None
        }
        Entry::Page { panel, .. } => {
            let page = entry.page_props()?;
            #[cfg(feature = "plant-page-drops-param")]
            let page = json!({ "name": page["name"] });
            match crate::mount_page(&runtime, panel, &page, window, cx) {
                Ok(view) => Some(view.into()),
                Err(error) => {
                    failed(entry.name(), &format!("{error:#}"), cx);
                    None
                }
            }
        }
    })
}

/// Copies `from` over `to`.
fn copy_folder(from: &Path, to: &Path) -> std::io::Result<()> {
    if to.exists() {
        std::fs::remove_dir_all(to)?;
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let (entry, into) = {
            let entry = entry?;
            let into = to.join(entry.file_name());
            (entry, into)
        };
        if entry.file_type()?.is_dir() {
            copy_folder(&entry.path(), &into)?;
        } else {
            std::fs::copy(entry.path(), into)?;
        }
    }
    Ok(())
}

/// Where the app keeps its copy of a view's panel.
fn copy_of(name: &str) -> PathBuf {
    crate::hub::root().join("app").join("panels").join(name)
}

/// One listed view: whether `panel@1` passed, the planted app taking every one.
fn may_mount(view: &Value) -> bool {
    cfg!(feature = "plant-panel-skips-kit") || view["kit"] == "PASS"
}

/// Mounts the views the hub lists and gives ⌘K their entries. A view that fails its kit, or doesn't mount, stays out,
/// and the app's log names why.
pub fn load(
    palette: &Entity<Palette>,
    runtime: &Rc<ShellRuntime>,
    window: &mut Window,
    cx: &mut App,
) {
    let listed = crate::record::call("views.installed", json!({}));
    let listed = listed
        .as_ref()
        .and_then(|reply| reply["views"].as_array())
        .cloned()
        .unwrap_or_default();
    let mut views_in_commands = Vec::new();
    for view in &listed {
        let name = view["name"].as_str().unwrap_or_default();
        if !may_mount(view) {
            failed(name, &format!("panel@1 reads {}", view["kit"]), cx);
            continue;
        }
        let dir = copy_of(name);
        let copied = view["folder"]
            .as_str()
            .ok_or_else(|| "it names no folder".to_owned())
            .and_then(|from| copy_folder(Path::new(from), &dir).map_err(|e| e.to_string()));
        let mounted = copied.and_then(|()| {
            crate::mount_panel(runtime, &dir, window, cx).map_err(|e| format!("{e:#}"))
        });
        match mounted {
            Ok(mounted) => views::place(
                view["area"].as_str().unwrap_or("tab"),
                name,
                mounted.into(),
                window,
                cx,
            ),
            Err(why) => {
                failed(name, &why, cx);
                continue;
            }
        }
        match View::from_json(dir, view) {
            Ok(view) => views_in_commands.push(view),
            Err(why) => eprintln!("deep-app: {name} adds nothing to ⌘K: {why}"),
        }
    }
    let mut listed = shipped_pages();
    listed.extend(entries(&views_in_commands));
    palette.update(cx, |palette, cx| palette.set_entries(listed, cx));
    window.refresh();
}
