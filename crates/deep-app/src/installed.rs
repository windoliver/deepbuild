//! Issue #1454: the views you installed, in the real window. The hub lists every loaded package's views with what
//! `panel@1` said of them. A view that passed mounts in its area, from a copy of its folder, since gpui-shell writes
//! files beside a script it runs and the installed bytes are the ones their digest names. Its pages and commands, and
//! the shipped pages, go to ⌘K.

use std::path::{Path, PathBuf};
use std::rc::Rc;

use gpui_kit::*;
use gpui_shell::ShellRuntime;
use serde_json::{json, Value};

use crate::commands::{entries, Entry, Open, Palette, View};
use crate::views;

/// The pages ⌘K always lists, and the preferences it opens the box for (#1998).
pub fn shipped_pages() -> Vec<Entry> {
    let pages = [("Home", views::HOME), ("Needs you", views::NEEDS_YOU)].map(|(name, panel)| {
        Entry::Shipped {
            name: name.to_owned(),
            panel,
        }
    });
    pages
        .into_iter()
        .chain(crate::words::preference_entries())
        .collect()
}

/// What opening a ⌘K entry does in the app: a command runs off the main thread, a page mounts in the page region.
pub fn opener(runtime: Rc<ShellRuntime>) -> Open {
    Rc::new(move |entry, window, cx| match entry {
        Entry::Command { name, action } => {
            let (name, action) = (name.clone(), action.clone());
            cx.background_spawn(async move {
                let ran = crate::hub::HubClient::app()
                    .and_then(|mut hub| hub.call("command.run", json!({ "action": action })));
                if let Err(error) = ran {
                    eprintln!("deep-app: {name} didn't run: {error:?}");
                }
            })
            .detach();
        }
        Entry::Shipped { panel, .. } => views::show_panel(panel, window, cx),
        Entry::Preference { name, .. } => crate::words::open_preference(name, window, cx),
        Entry::Page { panel, .. } => {
            let Some(page) = entry.page_props() else {
                return;
            };
            #[cfg(feature = "plant-page-drops-param")]
            let page = json!({ "name": page["name"] });
            match crate::mount_page(&runtime, panel, &page, window, cx) {
                Ok(view) => views::open_page(view.into(), window, cx),
                Err(error) => eprintln!("deep-app: {} didn't open: {error:#}", entry.name()),
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
            eprintln!(
                "deep-app: {name} isn't loaded: panel@1 reads {}",
                view["kit"]
            );
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
                mounted.into(),
                window,
                cx,
            ),
            Err(why) => {
                eprintln!("deep-app: {name} didn't load: {why}");
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
