//! Issue #338: the replica. A headless copy of the app, on gpui's virtual clock, that opens the
//! reference window, draws a shipped view and hands back a text snapshot of what a screen reader
//! would see, plus a screenshot. The checks that run in it live beside it: the Needs you kit, the
//! panel registry against the app's slots, and the snapshot against the live tree.

// A release build refuses the planted programs' feature (#1408).
#[cfg(all(feature = "env-plants", not(debug_assertions)))]
compile_error!("the env-plants feature is for test builds only, never a release build");

#[cfg(feature = "chrome-fixture")]
pub mod chrome;
pub mod drive;
pub mod kit;
mod replica;
pub mod shell;
pub mod snapshot;
pub mod terminal;

pub use deep_app::notify::{Notifier, Sound, NOTIFY_AFTER};
pub use replica::{
    Approve, CardSeen, Client, Confirmation, Input, Killed, On, Phase, Planted, Posted, Replica,
    Seen, Slot, Source, Step,
};

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use deep_app::{
    events::{inbox, Fixture},
    views::AppState,
};
use gpui_kit::{assets::Assets, HeadlessAppContext};

/// The virtual clock's time, in ms since the epoch: every open ask's deadline comes after it.
pub const NOW: u64 = 1_800_000_000_000;
/// The ask held for a message its agent hasn't read; the hub records no event for a hold yet.
pub const HELD: &str = "ask:01MCBKEP00AF27SH36Z7R1YMBQ";
/// The reference window, in points, at 2×.
pub const WINDOW: (f32, f32) = (1512., 982.);
pub const SCALE: f32 = 2.;
/// The line the replica prints once the shell's first frame is drawn; a launch is timed from the
/// process's spawn to this line, so the screenshot and the files it writes afterwards don't count.
pub const FIRST_FRAME: &str = "deep-replica: first frame drawn";

/// The headless app: GPUI's own text system for the chrome, the kit's assets and the offscreen
/// renderer, with the kit and the app initialized.
pub fn headless_context() -> HeadlessAppContext {
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
        // The replica draws as a Mac with Reduce Motion off, whatever this Mac's setting, unless asked (#1436).
        cx.set_reduce_motion(false);
    });
    cx
}

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

pub fn fixture_path() -> PathBuf {
    repo_root().join("docs/spikes/338/fixtures/needs-you.events.jsonl")
}

/// A panel's directory under `crates/deep-app/panels/`.
pub fn panel_dir(name: &str) -> PathBuf {
    repo_root().join("crates/deep-app/panels").join(name)
}

/// The view name `--first-screen` stands for: the app's first screen, Home, drawn for the HOME it runs with.
pub const FIRST_SCREEN: &str = "first-screen";
/// The rules page (#344), drawn from the HOME it runs with: `wiki/rules.md` as `deep rules sync` wrote it.
pub const RULES_PAGE: &str = "rules";

/// The replica's view of the look's 16 terminal colors on the terminal's background (#1003).
pub const TERMINAL_COLORS: &str = "terminal-colors";

/// `--view <id> --out <out>` from the command line, the view a shipped one (or `--first-screen`), and where `replica`
/// takes them, `--appearance <light|dark>` as whether macOS is set to dark (#882) and `--bound <file>`, the runs and
/// bound values to draw (#629); else the usage error is printed under `bin`'s name and the exit code is 2. The replica
/// also takes the `terminal-colors` view, `--selected-row <n>` and `--focused-row <n>`, the sidebar rows it opens
/// selected and focused (#1003), `--click <button>` on the first screen (#1556), and `--window <w>x<h>` (#1454).
pub fn view_args(bin: &str, out: &str, replica: bool) -> Result<ViewArgs, i32> {
    let (mut view, mut path, mut dark, mut bound, mut click, mut size) =
        (None, None, None, None, None, None);
    let (mut selected, mut focused) = (None, None);
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            row @ ("--selected-row" | "--focused-row") if replica => {
                let Some(n) = args.next().and_then(|n| n.parse::<usize>().ok()) else {
                    eprintln!("{bin}: {row} is a row's index from 0");
                    return Err(2);
                };
                *(if row == "--selected-row" {
                    &mut selected
                } else {
                    &mut focused
                }) = Some(n);
            }
            "--view" => view = args.next(),
            // #1546: deep-live's watch of the real window on your hub, which it reads itself.
            "--watch" if !replica => {}
            // #1002: the app's first screen as a launch shows it for this HOME, over its own record, not the fixture.
            "--first-screen" => view = Some(FIRST_SCREEN.to_owned()),
            "--out" => path = args.next().map(PathBuf::from),
            "--bound" if replica => bound = args.next().map(PathBuf::from),
            // #1454: the replica's window can be the app's opening size, so a proof runs at both.
            "--window" if replica => {
                let given = args.next();
                let read = given
                    .as_deref()
                    .and_then(|s| s.split_once('x'))
                    .and_then(|(w, h)| Some((w.parse::<f32>().ok()?, h.parse::<f32>().ok()?)));
                let Some(read) = read.filter(|(w, h)| *w > 0. && *h > 0.) else {
                    eprintln!("{bin}: --window is <width>x<height> in points, not {given:?}");
                    return Err(2);
                };
                size = Some(read);
            }
            "--click" if replica => click = args.next(),
            "--appearance" if replica => match args.next().as_deref() {
                Some("light") => dark = Some(false),
                Some("dark") => dark = Some(true),
                other => {
                    eprintln!("{bin}: --appearance is light or dark, not {other:?}");
                    return Err(2);
                }
            },
            other => {
                eprintln!("{bin}: unknown argument {other}");
                return Err(2);
            }
        }
    }
    let (Some(view), Some(path)) = (view, path) else {
        eprintln!("usage: {bin} --view <id> --out <{out}>");
        return Err(2);
    };
    let extra = (replica && view == TERMINAL_COLORS) || view == RULES_PAGE;
    if view != FIRST_SCREEN && !extra && !deep_app::views::SHIPPED_VIEWS.contains(&view.as_str()) {
        let shipped = deep_app::views::SHIPPED_VIEWS;
        eprintln!("{bin}: {view} is not a shipped view; the views are {shipped:?}");
        return Err(2);
    }
    if click.is_some() && view != FIRST_SCREEN {
        eprintln!("{bin}: --click clicks a button on the --first-screen");
        return Err(2);
    }
    deep_app::views::start_sidebar(selected, focused);
    Ok((view, path, dark, bound, click, size))
}

/// What `view_args` reads: the view, where to write, the appearance, the bound values' file, the button to click and
/// the window's size.
pub type ViewArgs = (
    String,
    PathBuf,
    Option<bool>,
    Option<PathBuf>,
    Option<String>,
    Option<(f32, f32)>,
);

/// Issue #629: every bound value drawn, `{"bound": [{surface, id, text, missing, bounds}]}`, its bounds its node's in
/// the screenshot's device pixels.
pub fn bound_listing(snapshot: &snapshot::Snapshot) -> serde_json::Value {
    use deep_app::bound::{on, Surface};
    let nodes = snapshot.flatten();
    let listed: Vec<serde_json::Value> = [Surface::Card, Surface::Panel]
        .into_iter()
        .flat_map(on)
        .map(|b| {
            let name = b.name();
            let bounds = nodes.iter().find(|n| n.name.as_deref() == Some(name.as_str())).map(|n| n.bounds);
            serde_json::json!({"surface": b.surface.name(), "id": b.id, "text": b.text, "missing": b.missing, "bounds": bounds})
        })
        .collect();
    serde_json::json!({ "bound": listed })
}

/// The fixture record `session.row@1` runs a view over (#2018): a record whose rows the hub's own code built, with a
/// stop that has no verdict yet, a claim that passed, a session named by its first prompt, and sessions with open asks.
pub fn session_row_fixture() -> PathBuf {
    repo_root().join("crates/deep-replica/fixtures/session-row.events.jsonl")
}

/// The fixture record's inbox as of its last event, on the virtual clock.
pub fn load_state() -> AppState {
    load_state_from(&fixture_path())
}

/// The record at `path`, as [`load_state`] loads the fixture record.
pub fn load_state_from(path: &std::path::Path) -> AppState {
    let fixture = Fixture::load(path).expect("the fixture record parses");
    let log_pos = fixture.last_log_pos();
    // Every view reads the record through the one reader; the replica's holds the fixture.
    deep_app::record::install_local(fixture.events());
    AppState {
        inbox: inbox(&fixture, log_pos),
        now: NOW,
        sessions: fixture.sessions(),
        held: Some(HELD.into()),
    }
}
